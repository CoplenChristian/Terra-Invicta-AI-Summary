/**
 * Hosted Cloudflare / Edge Worker API
 *
 * Exposes published Player Intel and explicitly enabled Omniscient data from
 * Supabase (when configured), or falls back to bundled static Player Intel
 * snapshot files.
 *
 * The 2026-08-20 review (section D) called this a monolith mixing routing,
 * validation, caching, projection and HTML rendering. What is left here is the
 * dispatcher: the order routes are tried in, and the degrade path each takes
 * when Supabase is not configured. Everything else moved to siblings:
 *
 *   http.js             CORS policy and the three response shapes
 *   assets.js           ASSETS binding, embedded fallback, static observer files
 *   supabaseReader.js   every Supabase read and every consistency check on it
 *   envelopes.js        the identity/snapshot/resource response envelopes
 *   projections.js      hosted adapter over the shared projection registries
 *   runtimeDefaults.js  deployment defaults and malformed-variable handling
 *
 * The siblings are ESM and import shared code as `../shared/...`, the exact
 * prefix `scripts/build_static_snapshot.js` rewrites, and that build copies
 * every `site/worker/*.js` beside the entry point. A module the worker and the
 * Express server genuinely share still has to live under `shared/` -- the worker
 * cannot `require` CommonJS. `shared/requestValidation.mjs` is the newest one:
 * both runtimes now take their accept/reject decisions from it, so validation
 * cannot drift between local and hosted.
 */

import { DEFAULT_OBSERVER_FACTION_ID } from '../shared/constants.mjs';
import {
  DEFAULT_CAMPAIGN_KEY,
  buildIntelApiIndex,
  renderIntelApiIndexHtml,
  selectExportMarkdown
} from '../shared/apiSurface.mjs';
import {
  INTEL_ENDPOINT_INDEX,
  INTEL_ENDPOINT_EXAMPLES,
  DETAIL_LEVELS,
  DEFAULT_DETAIL_LEVEL,
  DETAIL_AWARE_RESOURCES,
  measureIntelEndpointSizes
} from '../shared/intelResources.mjs';
import { isPositiveIntegerId } from '../shared/requestValidation.mjs';
import { buildStrategicDelta } from '../shared/strategicDelta.mjs';
import {
  renderThreatsMarkdown,
  renderWarRoomMarkdown
} from '../shared/markdownExports.mjs';

import { corsHeaders, jsonResponse, htmlResponse, markdownSnapshotResponse } from './http.js';
import { asset, observerFile } from './assets.js';
import {
  boundedHistoryLimit,
  fetchFromSupabase,
  isSupabaseReady,
  querySupabase,
  readPublicCampaign,
  readStrategicHistory,
  strategicHistoryMeta
} from './supabaseReader.js';
import { resultIdentity, snapshotEnvelope } from './envelopes.js';
import {
  buildIntelResource,
  buildTechIntelResource,
  intelResource,
  productionPlanPaths,
  techIntelResource,
  validateResourceQuery
} from './projections.js';
import { HOSTED_MODES, positiveIntegerOr, readRuntimeDefaults } from './runtimeDefaults.js';

/**
 * Measured response sizes for the hosted discovery index.
 *
 * Memoised per (snapshot, mode) so a warm isolate answers a repeat index
 * request without re-running thirty projections, and wrapped so that a
 * measurement failure degrades to "no size hints" instead of taking down the
 * route an external client discovers everything else through.
 */
const hostedSizeMemo = new Map();
async function hostedResponseSizes(env, observerId, mode, isSupabaseConfigured) {
  if (!isSupabaseConfigured) {
    return {
      responseSizesUnavailable: {
        all: 'sizes are measured against the published snapshot, which requires the hosted Supabase backend'
      }
    };
  }
  try {
    const result = await fetchFromSupabase(env, observerId, mode);
    if (!result.found) {
      return { responseSizesUnavailable: { all: `sizes could not be measured: ${result.error}` } };
    }
    const snapshot = result.snapshot || {};
    const memoKey = `${snapshot.snapshotId || 'unknown'}|${mode}|${observerId}`;
    if (!hostedSizeMemo.has(memoKey)) {
      hostedSizeMemo.clear();
      hostedSizeMemo.set(memoKey, measureIntelEndpointSizes(snapshot, { mode }));
    }
    const measured = hostedSizeMemo.get(memoKey);
    return {
      responseSizes: measured.sizes,
      responseSizesUnavailable: measured.unavailable,
      responseSizeBasis: measured.basis
    };
  } catch (err) {
    return { responseSizesUnavailable: { all: `sizes could not be measured: ${err.message}` } };
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const runtimeDefaults = await readRuntimeDefaults(env, request);
    const defaultObserverId = positiveIntegerOr(
      runtimeDefaults.defaultObserverFactionId,
      DEFAULT_OBSERVER_FACTION_ID,
      'runtime default observer faction id'
    );
    const observerId = url.searchParams.get('observer') || String(defaultObserverId);
    if (!isPositiveIntegerId(observerId)) {
      return jsonResponse({ success: false, error: `Invalid observer faction '${observerId}'.` }, 400);
    }
    const requestedMode = String(url.searchParams.get('mode') || 'player').toLowerCase();
    if (!HOSTED_MODES.has(requestedMode)) {
      return jsonResponse({ success: false, error: `Unsupported hosted intelligence mode '${requestedMode}'. Use player, enhanced, or omniscient.` }, 400);
    }
    const mode = requestedMode;
    const isSupabaseConfigured = isSupabaseReady(env);

    // The browser uses this capability check to decide whether to show the
    // local publisher control. Hosted deployments are intentionally read-only:
    // they can read published snapshots but never receive the service key or
    // execute a local save parser.
    if (url.pathname === '/api/runtime') {
      // The publishing fan-out policy may cover only a subset of factions.
      // Advertise which observers actually have rows; a selector offering an
      // unpublished observer returns 404 and clears the dashboard.
      let availableObservers = null;
      try {
        const campaign = await readPublicCampaign(env, env.SUPABASE_CAMPAIGN_KEY || runtimeDefaults.campaignKey || DEFAULT_CAMPAIGN_KEY);
        if (Array.isArray(campaign?.published_observers) && campaign.published_observers.length > 0) {
          availableObservers = campaign.published_observers;
        }
      } catch (err) {
        // Leave null (meaning "unknown, allow all") rather than failing the
        // runtime probe the whole dashboard boots from.
      }

      return jsonResponse({
        success: true,
        environment: 'hosted',
        canPublish: false,
        canRefresh: true,
        supportedModes: runtimeDefaults.supportedModes || Array.from(HOSTED_MODES),
        defaultMode: runtimeDefaults.defaultMode || 'player',
        defaults: runtimeDefaults,
        availableObservers,
        source: 'hosted-worker'
      });
    }

    if (url.pathname === '/api/publish') {
      return jsonResponse({
        success: false,
        error: 'Publishing is available only from the local dashboard.'
      }, 404);
    }

    // The payload and directory page come from shared/apiSurface.mjs, the same
    // module the local Express server uses, so a route added to
    // INTEL_ENDPOINT_INDEX appears in both runtimes from one edit instead of
    // requiring the page to be written out twice.
    if (url.pathname === '/api/intel' || url.pathname === '/api/intel/') {
      const payload = {
        ...buildIntelApiIndex({
          source: 'hosted-worker',
          endpoints: INTEL_ENDPOINT_INDEX,
          examples: INTEL_ENDPOINT_EXAMPLES,
          defaultObserverFactionId: defaultObserverId
        }),
        detail: {
          levels: DETAIL_LEVELS,
          default: DEFAULT_DETAIL_LEVEL,
          appliesTo: Array.from(DETAIL_AWARE_RESOURCES),
          description: 'summary returns a manifest; full returns the per-ship payload and is much larger.'
        },
        // Measured, never estimated: the published snapshot is read and each
        // projection is actually run. A deployment with no Supabase, or a read
        // that fails, omits the numbers and says why -- an index without size
        // hints is still usable, an index with invented ones is not.
        ...(await hostedResponseSizes(env, observerId, mode, isSupabaseConfigured))
      };
      if (url.searchParams.get('format') === 'json' || request.headers.get('accept')?.includes('application/json')) {
        return jsonResponse(payload);
      }

      return htmlResponse(renderIntelApiIndexHtml(payload, { defaultObserverFactionId: defaultObserverId }));
    }

    // Compact strategic history is intentionally separate from the large
    // observer/mode snapshot table. It remains public read-only data under the
    // campaign's RLS policy and is safe to expose without a mode parameter.
    if (url.pathname === '/api/intel/history' || url.pathname === '/api/intel/history/') {
      if (!isSupabaseConfigured) {
        return jsonResponse({ success: false, error: 'Hosted Supabase is not configured.' }, 503);
      }
      try {
        const campaignKey = url.searchParams.get('campaign') || env.SUPABASE_CAMPAIGN_KEY || DEFAULT_CAMPAIGN_KEY;
        const result = await readStrategicHistory(env, campaignKey, {
          limit: boundedHistoryLimit(url.searchParams.get('limit'))
        });
        if (!result.found) return jsonResponse({ success: false, error: result.error }, result.status);
        return jsonResponse({
          success: true,
          source: 'supabase',
          schema: 'strategic_snapshot_v1',
          campaignKey: result.campaign.campaign_key,
          count: result.rows.length,
          history: result.rows.map(strategicHistoryMeta)
        });
      } catch (err) {
        return jsonResponse({ success: false, error: err.message }, 500);
      }
    }

    if (url.pathname.startsWith('/api/intel/history/')) {
      if (!isSupabaseConfigured) {
        return jsonResponse({ success: false, error: 'Hosted Supabase is not configured.' }, 503);
      }
      try {
        const saveLastModified = decodeURIComponent(url.pathname.slice('/api/intel/history/'.length));
        if (!saveLastModified) {
          return jsonResponse({ success: false, error: 'A save_last_modified timestamp is required.' }, 400);
        }
        const campaignKey = url.searchParams.get('campaign') || env.SUPABASE_CAMPAIGN_KEY || DEFAULT_CAMPAIGN_KEY;
        const result = await readStrategicHistory(env, campaignKey, {
          saveLastModified,
          limit: 1,
          includePayload: true
        });
        if (!result.found) return jsonResponse({ success: false, error: result.error }, result.status);
        const row = result.rows[0];
        if (!row) {
          return jsonResponse({ success: false, error: `No strategic snapshot for ${saveLastModified}.` }, 404);
        }
        return jsonResponse({
          success: true,
          source: 'supabase',
          schema: 'strategic_snapshot_v1',
          campaignKey: result.campaign.campaign_key,
          ...strategicHistoryMeta(row),
          payload: row.payload || null
        });
      } catch (err) {
        return jsonResponse({ success: false, error: err.message }, 500);
      }
    }

    if (url.pathname === '/api/intel/strategic-delta') {
      if (!isSupabaseConfigured) {
        return jsonResponse({ success: false, error: 'Hosted Supabase is not configured.' }, 503);
      }
      try {
        const campaignKey = url.searchParams.get('campaign') || env.SUPABASE_CAMPAIGN_KEY || DEFAULT_CAMPAIGN_KEY;
        const fromStamp = url.searchParams.get('from');
        const toStamp = url.searchParams.get('to');
        let fromRow = null;
        let toRow = null;

        if (fromStamp && toStamp) {
          const [fromResult, toResult] = await Promise.all([
            readStrategicHistory(env, campaignKey, { saveLastModified: fromStamp, limit: 1, includePayload: true }),
            readStrategicHistory(env, campaignKey, { saveLastModified: toStamp, limit: 1, includePayload: true })
          ]);
          if (!fromResult.found) return jsonResponse({ success: false, error: fromResult.error }, fromResult.status);
          if (!toResult.found) return jsonResponse({ success: false, error: toResult.error }, toResult.status);
          fromRow = fromResult.rows[0] || null;
          toRow = toResult.rows[0] || null;
        } else {
          const recent = await readStrategicHistory(env, campaignKey, { limit: 2, includePayload: true });
          if (!recent.found) return jsonResponse({ success: false, error: recent.error }, recent.status);
          toRow = recent.rows[0] || null;
          fromRow = recent.rows[1] || null;
        }

        if (!toRow) {
          return jsonResponse({ success: false, error: 'No strategic history is available for this campaign.' }, 404);
        }

        return jsonResponse({
          success: true,
          source: 'supabase',
          schema: 'strategic_snapshot_v1',
          campaignKey,
          from: fromRow ? strategicHistoryMeta(fromRow) : null,
          to: strategicHistoryMeta(toRow),
          ...buildStrategicDelta(fromRow?.payload || null, toRow.payload || null)
        });
      } catch (err) {
        return jsonResponse({ success: false, error: err.message }, 500);
      }
    }

    // Mission Control v2 consumes the same generated briefing that the local
    // publisher stores beside each filtered snapshot. This keeps the hosted
    // SITREP, faction dossier, and observer/mode controls data-backed.
    if (url.pathname === '/api/v2/briefing') {
      if (isSupabaseConfigured) {
        try {
          const result = await fetchFromSupabase(env, observerId, mode);
          if (!result.found) {
            return jsonResponse({ success: false, error: result.error }, result.status);
          }
          const snapshot = result.snapshot || {};
          if (!snapshot.missionControlBriefing) {
            return jsonResponse({
              success: false,
              error: 'The published snapshot predates the Mission Control briefing payload. Republish the latest save.'
            }, 503);
          }
          return jsonResponse({
            success: true,
            ...resultIdentity(result),
            briefing: snapshot.missionControlBriefing,
            data: snapshot,
            source: 'supabase'
          });
        } catch (err) {
          return jsonResponse({ success: false, error: err.message }, 500);
        }
      }

      if (mode !== 'player') {
        return jsonResponse({ success: false, error: `${mode[0].toUpperCase()}${mode.slice(1)} briefings require the published Supabase backend.` }, 503);
      }

      const staticResponse = await asset(env, request, observerFile(observerId, 'snapshot'));
      if (!staticResponse.ok) return staticResponse;
      const staticPayload = await staticResponse.json();
      const snapshot = staticPayload.data || {};
      return jsonResponse({
        success: true,
        snapshotId: snapshot.snapshotId || null,
        saveHash: snapshot.saveHash || null,
        saveModifiedAt: snapshot.saveModifiedAt || null,
        generatedAt: snapshot.generatedAt || null,
        campaignDate: snapshot.metadata?.gameTimeString || null,
        saveFilename: snapshot.metadata?.fileName || null,
        isLatestSnapshot: true,
        activeSnapshot: {
          snapshotId: snapshot.snapshotId || null,
          saveHash: snapshot.saveHash || null,
          saveModifiedAt: snapshot.saveModifiedAt || null,
          saveFilename: snapshot.metadata?.fileName || null,
          campaignDate: snapshot.metadata?.gameTimeString || null,
          generatedAt: snapshot.generatedAt || null,
          isLatestSnapshot: true
        },
        briefing: snapshot.missionControlBriefing || null,
        data: snapshot,
        source: 'static'
      });
    }

    // Flat resource endpoints are designed for external analysis tools. Each
    // call returns one focused collection instead of the entire nested snapshot.
    if (request.method === 'POST' && productionPlanPaths.has(url.pathname)) {
      if (!isSupabaseConfigured) {
        return jsonResponse({ success: false, error: 'Hosted Supabase is not configured.' }, 503);
      }
      let body = {};
      try {
        body = await request.json();
      } catch (err) {
        return jsonResponse({ success: false, error: 'Production-plan POST body must be valid JSON.' }, 400);
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return jsonResponse({ success: false, error: 'Production-plan POST body must be a JSON object.' }, 400);
      }
      const requestUrl = new URL(url.toString());
      const design = body.designId || body.design || body.target;
      if (design && !requestUrl.searchParams.has('design') && !requestUrl.searchParams.has('designId')) {
        requestUrl.searchParams.set('design', String(design));
      }
      if (body.quantity !== undefined && !requestUrl.searchParams.has('quantity')) {
        requestUrl.searchParams.set('quantity', String(body.quantity));
      }
      const quantity = Number(requestUrl.searchParams.get('quantity') || 1);
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000) {
        return jsonResponse({ success: false, error: 'Production quantity must be an integer from 1 to 1000.' }, 400);
      }
      try {
        const result = await fetchFromSupabase(env, observerId, mode);
        if (!result.found) return jsonResponse({ success: false, error: result.error }, result.status);
        return jsonResponse(buildIntelResource(result, 'production-plan', requestUrl));
      } catch (err) {
        return jsonResponse({ success: false, error: err.message }, 500);
      }
    }

    const resource = intelResource(url.pathname);
    if (resource) {
      if (request.method !== 'GET') {
        return jsonResponse({ success: false, error: 'This intelligence resource accepts GET requests only.' }, 405);
      }
      const queryError = validateResourceQuery(url);
      if (queryError) return jsonResponse({ success: false, error: queryError }, 400);
      if (!isSupabaseConfigured) {
        return jsonResponse({ success: false, error: 'Hosted Supabase is not configured.' }, 503);
      }

      try {
        const result = await fetchFromSupabase(env, observerId, mode);
        if (!result.found) {
          return jsonResponse({ success: false, error: result.error }, result.status);
        }
        return jsonResponse(buildIntelResource(result, resource, url));
      } catch (err) {
        return jsonResponse({ success: false, error: err.message }, 500);
      }
    }

    // Tech Tree Intelligence endpoints. These project the normalized dependency
    // graph embedded in the published snapshot and answer research-path, search,
    // milestone and queue questions against the live save state.
    const techResource = techIntelResource(url.pathname);
    if (techResource) {
      if (!isSupabaseConfigured) {
        return jsonResponse({ success: false, error: 'Hosted Supabase is not configured.' }, 503);
      }
      try {
        const result = await fetchFromSupabase(env, observerId, mode);
        if (!result.found) {
          return jsonResponse({ success: false, error: result.error }, result.status);
        }
        const snapshot = result.snapshot || {};
        if (!snapshot.techTree) {
          return jsonResponse({
            success: false,
            error: 'The published snapshot predates the tech-tree payload. Republish the latest save to enable tech-tree endpoints.'
          }, 503);
        }
        return jsonResponse(buildTechIntelResource(result, techResource, snapshot, url));
      } catch (err) {
        return jsonResponse({ success: false, error: err.message }, 500);
      }
    }

    // Handle snapshot & refresh routes
    if (url.pathname === '/api/snapshot' || url.pathname === '/api/refresh') {
      if (isSupabaseConfigured) {
        try {
          const result = await fetchFromSupabase(env, observerId, mode);
          if (!result.found) {
            return jsonResponse({ success: false, error: result.error }, result.status);
          }
          return jsonResponse({
            success: true,
            ...resultIdentity(result),
            data: result.snapshot,
            source: 'supabase'
          });
        } catch (err) {
          return jsonResponse({ success: false, error: err.message }, 500);
        }
      }
      if (mode !== 'player') {
        return jsonResponse({ success: false, error: `${mode[0].toUpperCase()}${mode.slice(1)} snapshots require the published Supabase backend.` }, 503);
      }
      // Fallback to static Player Intel asset if Supabase is not configured.
      return asset(env, request, observerFile(observerId, 'snapshot'));
    }

    // Read-only normalized endpoints for external analysis tools. They default
    // to Player Intel and accept mode=omniscient when explicitly requested.
    if (
      url.pathname === '/api/snapshot/compact' ||
      url.pathname === '/api/snapshot/full' ||
      url.pathname === '/latest-snapshot.json' ||
      url.pathname === '/latest-snapshot.md'
    ) {
      if (!isSupabaseConfigured) {
        return jsonResponse({ success: false, error: 'Hosted Supabase is not configured.' }, 503);
      }

      try {
        const format = url.pathname.endsWith('/full') ? 'full' : 'compact';
        const result = await fetchFromSupabase(env, observerId, mode);
        if (!result.found) {
          return jsonResponse({ success: false, error: result.error }, result.status);
        }

        const envelope = snapshotEnvelope(result, format);
        if (url.pathname === '/latest-snapshot.md') {
          return markdownSnapshotResponse(envelope);
        }
        return jsonResponse(envelope);
      } catch (err) {
        return jsonResponse({ success: false, error: err.message }, 500);
      }
    }

    if (url.pathname === '/latest-threats.md' || url.pathname === '/latest-war-room.md') {
      if (!isSupabaseConfigured) {
        return jsonResponse({
          success: false,
          error: 'Real-time markdown reports require the published Supabase backend.'
        }, 503);
      }

      try {
        const result = await fetchFromSupabase(env, observerId, mode);
        if (!result.found) {
          return jsonResponse({ success: false, error: result.error }, result.status);
        }

        const markdown = url.pathname === '/latest-threats.md'
          ? renderThreatsMarkdown(result.snapshot)
          : renderWarRoomMarkdown(result.snapshot);

        return new Response(markdown, {
          status: 200,
          headers: {
            'Content-Type': 'text/markdown; charset=utf-8',
            'Cache-Control': 'no-store',
            ...corsHeaders
          }
        });
      } catch (err) {
        return jsonResponse({ success: false, error: err.message }, 500);
      }
    }

    // Handle export route
    if (url.pathname === '/api/export') {
      const format = url.searchParams.get('format') === 'full' ? 'full' : 'chatgpt';
      if (isSupabaseConfigured) {
        try {
          const result = await fetchFromSupabase(env, observerId, mode);
          if (!result.found) {
            return jsonResponse({ success: false, error: result.error }, result.status);
          }
          const markdown = selectExportMarkdown(result.chatgptExport, format);
          return jsonResponse({
            success: true,
            markdown,
            source: 'supabase',
            ...resultIdentity(result),
            observerFaction: {
              id: result.row.observer_faction_id,
              name: result.row.observer_faction_name
            },
            intelMode: result.mode,
            visibility: result.row.visibility || result.mode
          });
        } catch (err) {
          return jsonResponse({ success: false, error: err.message }, 500);
        }
      }
      if (mode !== 'player') {
        return jsonResponse({ success: false, error: `${mode[0].toUpperCase()}${mode.slice(1)} exports require the published Supabase backend.` }, 503);
      }
      const fileSuffix = format === 'full' ? 'export-full' : 'export-chatgpt';
      return asset(env, request, observerFile(observerId, fileSuffix));
    }

    // Handle templates/effects info
    if (url.pathname === '/api/templates/effects') {
      return asset(env, request, '/data/effects.json');
    }

    // Handle saves list
    if (url.pathname === '/api/saves') {
      if (isSupabaseConfigured) {
        try {
          const campaignKey = env.SUPABASE_CAMPAIGN_KEY || DEFAULT_CAMPAIGN_KEY;
          const campaigns = await querySupabase(
            env,
            `campaigns?campaign_key=eq.${encodeURIComponent(campaignKey)}&is_public=eq.true&select=campaign_key,current_save_last_modified,current_game_time,current_save_filename,published_observers`
          );
          const camp = campaigns?.[0];
          const saves = camp ? [{
            name: camp.current_save_filename || 'Active Save',
            lastModified: camp.current_save_last_modified,
            active: true
          }] : [];
          return jsonResponse({ success: true, saves, source: 'supabase' });
        } catch (err) {
          return jsonResponse({ success: false, error: err.message }, 500);
        }
      }
      return jsonResponse({ success: true, saves: [], staticOnly: true });
    }

    // Default: Static web assets. Sites normally supplies ASSETS, while the
    // embedded fallback keeps the dashboard shell available for deployments
    // where the static binding is not mounted.
    return asset(env, request, url.pathname === '/' ? '/index.html' : url.pathname);
  }
};
