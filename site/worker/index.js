import { staticAssets } from './static-assets.js';
import { SUPPORTED_MODES } from '../shared/constants.mjs';
import {
  SUPPORTED_RESOURCES,
  asArray,
  factionMatches,
  bodyMatches,
  factionResourceRow,
  nationResourceRow,
  councilorResourceRow,
  habResourceRow,
  habSiteResourceRow,
  miningResourceRow,
  fleetResourceRow,
  shipResourceRows,
  researchResourceRows,
  summaryResource,
  findAlienFaction
} from '../shared/intelResources.mjs';

const HOSTED_MODES = SUPPORTED_MODES;

/**
 * Hosted Cloudflare / Edge Worker API
 *
 * Exposes published Player Intel and explicitly enabled Omniscient data from
 * Supabase (when configured), or falls back to bundled static Player Intel
 * snapshot files.
 */

const mimeTypeFor = (pathname) => {
  const lowerPath = pathname.toLowerCase();
  if (lowerPath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (lowerPath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (lowerPath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (lowerPath.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
};

const embeddedAsset = (pathname) => {
  const key = pathname.replace(/^\/+/, '') || 'index.html';
  const candidates = [
    key,
    key.endsWith('/') ? `${key}index.html` : `${key}/index.html`
  ];
  const assetKey = candidates.find(candidate => staticAssets[candidate] !== undefined);
  const body = assetKey === undefined ? undefined : staticAssets[assetKey];
  if (body === undefined) return null;

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': mimeTypeFor(assetKey),
      'cache-control': assetKey === 'index.html' ? 'no-cache' : 'public, max-age=300'
    }
  });
};

const asset = async (env, request, pathname) => {
  const url = new URL(request.url);
  const assetPath = pathname === '/v2' ? '/v2/index.html' : pathname;
  url.pathname = assetPath;

  if (env?.ASSETS?.fetch) {
    const response = await env.ASSETS.fetch(new Request(url.toString(), {
      method: 'GET',
      headers: request.headers
    }));
    if (response.status !== 404) return response;
  }

  return embeddedAsset(assetPath) || new Response('Not found', { status: 404 });
};

const observerFile = (observerId, suffix) => {
  return `/data/${suffix}-player-${observerId}.json`;
};

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'Content-Type, Authorization',
  'access-control-max-age': '86400'
};

const jsonResponse = (body, status = 200) => {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...corsHeaders,
      'cache-control': status >= 400 ? 'no-store' : 'public, max-age=60, s-maxage=60',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer'
    }
  });
};

async function querySupabase(env, pathWithParams) {
  const supabaseUrl = env.SUPABASE_URL;
  const anonKey = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY;

  const url = `${supabaseUrl}/rest/v1/${pathWithParams}`;
  const response = await fetch(url, {
    headers: {
      'apikey': anonKey,
      'Authorization': `Bearer ${anonKey}`,
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Supabase API error (${response.status}): ${errorText}`);
  }

  return await response.json();
}

async function fetchFromSupabase(env, observerId, requestedMode = 'player') {
  const campaignKey = env.SUPABASE_CAMPAIGN_KEY || 'initiative';
  const safeObserverId = String(observerId);
  const mode = requestedMode;

  // Step 1: Query active public campaign pointer
  const campaigns = await querySupabase(
    env,
    `campaigns?campaign_key=eq.${encodeURIComponent(campaignKey)}&is_public=eq.true&select=campaign_key,current_save_last_modified,current_game_time,current_save_filename`
  );

  if (!campaigns || campaigns.length === 0) {
    return { found: false, status: 404, error: `Public campaign '${campaignKey}' not found.` };
  }

  const campaign = campaigns[0];
  if (!campaign.current_save_last_modified) {
    return { found: false, status: 404, error: `No active save recorded for campaign '${campaignKey}'.` };
  }

  // Step 2: Query the matching published snapshot row for the requested observer and mode.
  const snapshots = await querySupabase(
    env,
    `player_intel_snapshots?campaign_key=eq.${encodeURIComponent(campaignKey)}&save_last_modified=eq.${encodeURIComponent(campaign.current_save_last_modified)}&observer_faction_id=eq.${safeObserverId}&visibility=eq.${encodeURIComponent(mode)}&select=snapshot,chatgpt_export,observer_faction_id,observer_faction_name,save_filename,save_last_modified,game_time,difficulty,campaign_start_year,visibility,generated_at`
  );

  if (!snapshots || snapshots.length === 0) {
    return {
      found: false,
      status: 404,
      error: `No ${mode} snapshot found for observer ${safeObserverId} at timestamp ${campaign.current_save_last_modified}.`
    };
  }

  const row = snapshots[0];
  const payload = row.snapshot;
  const identity = {
    snapshotId: payload?.snapshotId || null,
    saveHash: payload?.saveHash || null,
    saveModifiedAt: payload?.saveModifiedAt || row.save_last_modified || null,
    generatedAt: payload?.generatedAt || row.generated_at || null
  };
  if (!identity.snapshotId || !identity.saveHash || !identity.saveModifiedAt || !identity.generatedAt) {
    return {
      found: false,
      status: 409,
      error: 'Published snapshot is missing its consistency identity. Republish the latest save before reading it.'
    };
  }
  if (campaign.current_save_last_modified && new Date(identity.saveModifiedAt).getTime() !== new Date(campaign.current_save_last_modified).getTime()) {
    return {
      found: false,
      status: 409,
      error: `MIXED / STALE INTELLIGENCE: campaign pointer is ${campaign.current_save_last_modified}, dataset is ${identity.saveModifiedAt}.`
    };
  }
  if (payload) {
    payload.mode = mode;
    payload.isOmniscient = mode === 'omniscient';
  }

  return {
    found: true,
    campaign,
    row,
    snapshot: payload,
    chatgptExport: row.chatgpt_export,
    mode
  };
}

const snapshotEnvelope = (result, format = 'compact') => {
  const row = result.row;
  const exports = result.chatgptExport || {};
  const markdown = format === 'full'
    ? (exports.full || exports.compact || '')
    : (exports.compact || exports.full || '');

  return {
    success: true,
    source: 'supabase',
    generatedAt: row.generated_at || null,
    saveModifiedAt: row.save_last_modified,
    saveFilename: row.save_filename,
    campaignDate: row.game_time,
    difficulty: row.difficulty,
    campaignStartYear: row.campaign_start_year,
    observerFaction: {
      id: row.observer_faction_id,
      name: row.observer_faction_name
    },
    intelMode: result.mode || row.visibility || 'player',
    visibility: row.visibility || result.mode || 'player',
    snapshot: result.snapshot,
    markdown,
    snapshotId: result.snapshot?.snapshotId || row.snapshot?.snapshotId || null,
    saveHash: result.snapshot?.saveHash || row.snapshot?.saveHash || null
  };
};

const markdownSnapshotResponse = (envelope) => new Response(
  `${envelope.markdown}\n`,
  {
    status: 200,
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      ...corsHeaders,
      'cache-control': 'public, max-age=60, s-maxage=60'
    }
  }
);

const numericQuery = (value) => {
  if (!/^\d+$/.test(String(value || ''))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
};

const validateResourceQuery = (url) => {
  const faction = url.searchParams.get('faction') || url.searchParams.get('factionId');
  if (faction !== null && numericQuery(faction) === null) {
    return `Invalid faction filter '${faction}'. Use a positive numeric id.`;
  }
  const body = url.searchParams.get('body');
  if (body !== null && (body.length > 80 || /[\u0000-\u001f\u007f]/.test(body))) {
    return 'Invalid body filter. Use a short body name such as Ceres.';
  }
  return null;
};

const resourceEnvelope = (result, resource, items, query = {}, extra = {}) => {
  const row = result.row;
  const snapshot = result.snapshot || {};
  return {
    success: true,
    source: 'supabase',
    resource,
    generatedAt: row.generated_at || null,
    saveModifiedAt: row.save_last_modified,
    snapshotId: snapshot.snapshotId || null,
    saveHash: snapshot.saveHash || null,
    saveFilename: row.save_filename,
    campaignDate: row.game_time,
    difficulty: row.difficulty,
    observerFaction: {
      id: row.observer_faction_id,
      name: row.observer_faction_name
    },
    intelMode: result.mode || row.visibility || 'player',
    visibility: row.visibility || result.mode || 'player',
    query,
    count: items === null ? null : (Array.isArray(items) ? items.length : 0),
    items: Array.isArray(items) ? items : [],
    ...extra
  };
};

const intelResource = (pathName) => {
  const direct = pathName.match(/^\/api\/([^/]+)$/);
  const grouped = pathName.match(/^\/api\/intel\/([^/]+)$/);
  const resource = grouped?.[1] || direct?.[1];
  return SUPPORTED_RESOURCES.has(resource) ? resource : null;
};

const buildIntelResource = (result, resource, url) => {
  const snapshot = result.snapshot || {};
  const factionId = numericQuery(url.searchParams.get('faction') || url.searchParams.get('factionId'));
  const body = url.searchParams.get('body');
  const query = { faction: factionId, body: body || null };

  if (resource === 'summary') {
    return resourceEnvelope(result, resource, null, query, summaryResource(snapshot));
  }

  let items;
  switch (resource) {
    case 'factions':
      items = asArray(snapshot.factions)
        .filter(faction => factionMatches(faction, factionId))
        .map(factionResourceRow);
      break;
    case 'nations':
      items = asArray(snapshot.nations)
        .filter(nation => factionMatches(nation, factionId))
        .map(nationResourceRow);
      break;
    case 'councilors':
      items = asArray(snapshot.councilors)
        .filter(councilor => factionMatches(councilor, factionId))
        .map(councilor => councilorResourceRow(councilor, result.mode));
      break;
    case 'habs':
      items = asArray(snapshot.habs)
        .filter(hab => factionMatches(hab, factionId) && bodyMatches(hab, body))
        .map(habResourceRow);
      break;
    case 'hab-sites':
      items = asArray(snapshot.habSites)
        .filter(site => factionMatches(site, factionId) && bodyMatches(site, body))
        .map(habSiteResourceRow);
      break;
    case 'mining':
      items = asArray(snapshot.habSites)
        .filter(site => factionMatches(site, factionId) && bodyMatches(site, body))
        .map(miningResourceRow);
      break;
    case 'fleets':
      items = asArray(snapshot.fleets)
        .filter(fleet => factionMatches(fleet, factionId) && bodyMatches(fleet, body))
        .map(fleetResourceRow);
      break;
    case 'ships':
      items = shipResourceRows(asArray(snapshot.fleets), factionId, body);
      break;
    case 'research': {
      const research = researchResourceRows(snapshot);
      return resourceEnvelope(result, resource, research.rows, query, {
        finishedGlobalProjects: research.finishedGlobalProjects
      });
    }
    case 'capabilities':
      return resourceEnvelope(result, resource, [], query, {
        capabilities: snapshot.capabilities || {},
        activeXenoforming: snapshot.activeXenoforming || [],
        builtAlienFacilities: snapshot.builtAlienFacilities || []
      });
    case 'alien': {
      const alienFaction = findAlienFaction(snapshot);
      const alienId = alienFaction?.ID;
      const councilors = asArray(snapshot.councilors).filter(councilor => councilor.factionId === alienId).map(councilor => councilorResourceRow(councilor, result.mode));
      const fleets = asArray(snapshot.fleets).filter(fleet => fleet.factionId === alienId && bodyMatches(fleet, body)).map(fleetResourceRow);
      const habs = asArray(snapshot.habs).filter(hab => hab.factionId === alienId && bodyMatches(hab, body)).map(habResourceRow);
      const habSites = asArray(snapshot.habSites).filter(site => site.factionId === alienId && bodyMatches(site, body)).map(habSiteResourceRow);
      return resourceEnvelope(result, resource, null, query, {
        faction: alienFaction ? factionResourceRow(alienFaction) : null,
        count: councilors.length + fleets.length + habs.length + habSites.length,
        councilors,
        fleets,
        habs,
        habSites,
        activeXenoforming: snapshot.activeXenoforming || [],
        builtAlienFacilities: snapshot.builtAlienFacilities || []
      });
    }
    default:
      items = [];
  }

  return resourceEnvelope(result, resource, items, query);
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const observerId = url.searchParams.get('observer') || '4712';
    if (!/^\d+$/.test(observerId) || !Number.isSafeInteger(Number(observerId)) || Number(observerId) <= 0) {
      return jsonResponse({ success: false, error: `Invalid observer faction '${observerId}'.` }, 400);
    }
    const requestedMode = String(url.searchParams.get('mode') || 'player').toLowerCase();
    if (!HOSTED_MODES.has(requestedMode)) {
      return jsonResponse({ success: false, error: `Unsupported hosted intelligence mode '${requestedMode}'. Use player, enhanced, or omniscient.` }, 400);
    }
    const mode = requestedMode;
    const isSupabaseConfigured = !!(env.SUPABASE_URL && (env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY));

    // The browser uses this capability check to decide whether to show the
    // local publisher control. Hosted deployments are intentionally read-only:
    // they can read published snapshots but never receive the service key or
    // execute a local save parser.
    if (url.pathname === '/api/runtime') {
      return jsonResponse({
        success: true,
        environment: 'hosted',
        canPublish: false,
        canRefresh: true,
        supportedModes: Array.from(HOSTED_MODES),
        defaultMode: 'player',
        source: 'hosted-worker'
      });
    }

    if (url.pathname === '/api/publish') {
      return jsonResponse({
        success: false,
        error: 'Publishing is available only from the local dashboard.'
      }, 404);
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
            snapshotId: snapshot.snapshotId,
            saveHash: snapshot.saveHash,
            saveModifiedAt: snapshot.saveModifiedAt,
            generatedAt: snapshot.generatedAt,
            campaignDate: snapshot.metadata?.gameTimeString || null,
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
        briefing: snapshot.missionControlBriefing || null,
        data: snapshot,
        source: 'static'
      });
    }

    // Flat resource endpoints are designed for external analysis tools. Each
    // call returns one focused collection instead of the entire nested snapshot.
    const resource = intelResource(url.pathname);
    if (resource) {
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
            snapshotId: result.snapshot?.snapshotId || null,
            saveHash: result.snapshot?.saveHash || null,
            saveModifiedAt: result.snapshot?.saveModifiedAt || null,
            generatedAt: result.snapshot?.generatedAt || null,
            campaignDate: result.snapshot?.metadata?.gameTimeString || null,
            data: result.snapshot,
            source: 'supabase'
          });
        } catch (err) {
          return jsonResponse({ success: false, error: err.message }, 500);
        }
      }
      if (mode === 'omniscient') {
        return jsonResponse({ success: false, error: 'Omniscient snapshots require the published Supabase backend.' }, 503);
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

    // Handle export route
    if (url.pathname === '/api/export') {
      const format = url.searchParams.get('format') === 'full' ? 'full' : 'chatgpt';
      if (isSupabaseConfigured) {
        try {
          const result = await fetchFromSupabase(env, observerId, mode);
          if (!result.found) {
            return jsonResponse({ success: false, error: result.error }, result.status);
          }
          const exp = result.chatgptExport || {};
          const markdown = format === 'full'
            ? (exp.full || exp.compact || '')
            : (exp.compact || exp.full || '');
          return jsonResponse({
            success: true,
            markdown,
            source: 'supabase',
            snapshotId: result.snapshot?.snapshotId || null,
            saveHash: result.snapshot?.saveHash || null,
            saveModifiedAt: result.snapshot?.saveModifiedAt || result.row.save_last_modified || null,
            generatedAt: result.snapshot?.generatedAt || result.row.generated_at || null,
            campaignDate: result.row.game_time || null,
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
      if (mode === 'omniscient') {
        return jsonResponse({ success: false, error: 'Omniscient exports require the published Supabase backend.' }, 503);
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
          const campaignKey = env.SUPABASE_CAMPAIGN_KEY || 'initiative';
          const campaigns = await querySupabase(
            env,
            `campaigns?campaign_key=eq.${encodeURIComponent(campaignKey)}&is_public=eq.true&select=campaign_key,current_save_last_modified,current_game_time,current_save_filename`
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
