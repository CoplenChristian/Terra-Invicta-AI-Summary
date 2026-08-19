import { staticAssets } from './static-assets.js';
import { SUPPORTED_MODES } from '../shared/constants.mjs';
import {
  SUPPORTED_RESOURCES,
  INTEL_ENDPOINT_INDEX,
  INTEL_ENDPOINT_EXAMPLES,
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
  habModuleResourceRow,
  shipyardResourceRow,
  shipyardStationResourceRow,
  arrivalResourceRow,
  friendlyStrengthAtDestination,
  researchResourceRows,
  summaryResource,
  findAlienFaction,
  logisticsResource,
  constructionResource,
  transfersResource,
  shipDesignsResource,
  theatersResource,
  infrastructureResource,
  alienThreatResource,
  deltaResource,
  miningAnalysisResource,
  mobilityResource,
  productionPlanResource,
  bodyStatusResource
} from '../shared/intelResources.mjs';
import {
  buildTechTreeProjection,
  buildTechPathProjection,
  buildTechSearchProjection,
  buildTechMilestonesProjection,
  buildTechMatrixProjection,
  buildTechOpportunitiesProjection,
  buildResearchQueueProjection,
  CATEGORIES
} from '../shared/techGraph.mjs';
import { buildStrategicDelta } from '../shared/strategicDelta.mjs';

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
  if (lowerPath.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
};

const embeddedAsset = (pathname) => {
  const key = pathname.replace(/^\/+/, '') || 'index.html';
  const candidates = [
    key,
    key.endsWith('/') ? `${key}index.html` : `${key}/index.html`
  ];
  const assetKey = candidates.find(candidate => staticAssets[candidate] !== undefined);
  const embedded = assetKey === undefined ? undefined : staticAssets[assetKey];
  if (embedded === undefined) return null;

  const body = embedded && typeof embedded === 'object' && embedded.encoding === 'base64'
    ? Uint8Array.from(atob(embedded.data), character => character.charCodeAt(0))
    : embedded;

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
      // Snapshot data is mutable: publishing a new save moves the campaign
      // pointer and every focused endpoint must observe that same pointer.
      // Edge/browser caching here can otherwise make /summary and /research
      // appear to come from different saves for up to a minute.
      'cache-control': 'no-store',
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
    cache: 'no-store',
    headers: {
      'apikey': anonKey,
      'Authorization': `Bearer ${anonKey}`,
      'Accept': 'application/json',
      'Cache-Control': 'no-cache'
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Supabase API error (${response.status}): ${errorText}`);
  }

  return await response.json();
}

async function readPublicCampaign(env, campaignKey) {
  const campaigns = await querySupabase(
    env,
    `campaigns?campaign_key=eq.${encodeURIComponent(campaignKey)}&is_public=eq.true&select=campaign_key,current_save_last_modified,current_game_time,current_save_filename,published_observers,tech_graph,tech_graph_fingerprint&limit=1`
  );
  return campaigns?.[0] || null;
}

const strategicHistoryMeta = (row) => ({
  saveLastModified: row?.save_last_modified || null,
  saveFilename: row?.save_filename || null,
  gameTime: row?.game_time || null,
  campaignDate: row?.campaign_date || null,
  schemaVersion: row?.schema_version ?? null,
  createdAt: row?.created_at || null
});

const boundedHistoryLimit = (value, fallback = 25) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, 100);
};

async function readStrategicHistory(env, campaignKey, options = {}) {
  const campaign = await readPublicCampaign(env, campaignKey);
  if (!campaign) {
    return {
      found: false,
      status: 404,
      error: `Public campaign '${campaignKey}' not found.`
    };
  }

  const select = options.includePayload
    ? 'save_last_modified,save_filename,game_time,campaign_date,schema_version,created_at,payload'
    : 'save_last_modified,save_filename,game_time,campaign_date,schema_version,created_at';
  let query = `strategic_snapshots?campaign_key=eq.${encodeURIComponent(campaign.campaign_key)}&select=${select}&order=save_last_modified.desc&limit=${boundedHistoryLimit(options.limit)}`;
  if (options.saveLastModified) {
    query += `&save_last_modified=eq.${encodeURIComponent(options.saveLastModified)}`;
  }

  const rows = await querySupabase(env, query);
  return { found: true, campaign, rows: Array.isArray(rows) ? rows : [] };
}

const timestampMs = (value) => {
  const result = new Date(value || '').getTime();
  return Number.isFinite(result) ? result : null;
};

const sameTimestamp = (left, right) => {
  const leftMs = timestampMs(left);
  const rightMs = timestampMs(right);
  return leftMs !== null && rightMs !== null && leftMs === rightMs;
};

const consistencyError = (message) => ({
  found: false,
  status: 409,
  error: `MIXED / STALE INTELLIGENCE: ${message}`
});

async function fetchFromSupabase(env, observerId, requestedMode = 'player') {
  const campaignKey = env.SUPABASE_CAMPAIGN_KEY || 'initiative';
  const safeObserverId = String(observerId);
  const mode = requestedMode;

  // Step 1: Query active public campaign pointer
  const campaign = await readPublicCampaign(env, campaignKey);
  if (!campaign) {
    return { found: false, status: 404, error: `Public campaign '${campaignKey}' not found.` };
  }

  if (!campaign.current_save_last_modified) {
    return { found: false, status: 404, error: `No active save recorded for campaign '${campaignKey}'.` };
  }

  // Step 2: Query the matching published snapshot row for the requested observer and mode.
  const snapshots = await querySupabase(
    env,
    `player_intel_snapshots?campaign_key=eq.${encodeURIComponent(campaignKey)}&save_last_modified=eq.${encodeURIComponent(campaign.current_save_last_modified)}&observer_faction_id=eq.${safeObserverId}&visibility=eq.${encodeURIComponent(mode)}&select=snapshot,chatgpt_export,observer_faction_id,observer_faction_name,save_filename,save_last_modified,game_time,difficulty,campaign_start_year,visibility,generated_at&limit=2`
  );

  if (!snapshots || snapshots.length === 0) {
    return {
      found: false,
      status: 404,
      error: `No ${mode} snapshot found for observer ${safeObserverId} at timestamp ${campaign.current_save_last_modified}.`
    };
  }

  if (snapshots.length > 1) {
    return consistencyError(
      `multiple ${mode} rows exist for observer ${safeObserverId} at active timestamp ${campaign.current_save_last_modified}; republish or repair the duplicate rows.`
    );
  }

  const row = snapshots[0];
  const payload = row.snapshot;

  // Published rows carry only the per-save half of the tech tree; the static
  // ~959 KB of nodes is stored once on the campaign. Splice it back before any
  // consumer reads the graph, so tech endpoints behave identically to a row
  // that embedded its own copy.
  if (payload?.techTree?.graphRef && !Array.isArray(payload.techTree.nodes)) {
    const shared = campaign.tech_graph;
    if (shared && shared.fingerprint === payload.techTree.graphRef.fingerprint) {
      payload.techTree = {
        ...payload.techTree,
        nodes: shared.nodes || [],
        categories: shared.categories || {},
        unlockClasses: shared.unlockClasses || {},
        graphSource: 'campaign-shared'
      };
    } else {
      // Do not silently serve an empty graph: leave the reference in place so
      // graphFromTree reports the tree as unavailable rather than as empty.
      payload.techTree = {
        ...payload.techTree,
        graphUnavailable: shared
          ? 'stored tech graph fingerprint does not match this snapshot; republish the campaign'
          : 'no shared tech graph stored for this campaign; republish to upload it'
      };
    }
  }

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
  if (!sameTimestamp(row.save_last_modified, campaign.current_save_last_modified) ||
      !sameTimestamp(identity.saveModifiedAt, campaign.current_save_last_modified) ||
      !sameTimestamp(identity.saveModifiedAt, row.save_last_modified)) {
    return consistencyError(
      `campaign pointer is ${campaign.current_save_last_modified}, row is ${row.save_last_modified}, dataset is ${identity.saveModifiedAt}.`
    );
  }
  if (row.visibility !== mode) {
    return consistencyError(`requested mode is ${mode}, but the selected row is ${row.visibility}.`);
  }

  // Publishing uploads all rows first and advances the campaign pointer last,
  // but it can still move while this request is in flight. Re-read the pointer
  // before returning so a single response can never claim to be current after
  // a newer publish committed.
  const confirmedCampaign = await readPublicCampaign(env, campaignKey);
  if (!confirmedCampaign ||
      !sameTimestamp(confirmedCampaign.current_save_last_modified, campaign.current_save_last_modified) ||
      confirmedCampaign.current_save_filename !== campaign.current_save_filename) {
    return consistencyError(
      `the active save changed while reading this request (started at ${campaign.current_save_last_modified}, now ${confirmedCampaign?.current_save_last_modified || 'unknown'}); retry.`
    );
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
    mode,
    isLatestSnapshot: true,
    activeSnapshot: {
      snapshotId: identity.snapshotId,
      saveHash: identity.saveHash,
      saveModifiedAt: campaign.current_save_last_modified,
      saveFilename: campaign.current_save_filename || row.save_filename || null,
      campaignDate: campaign.current_game_time || row.game_time || null,
      generatedAt: identity.generatedAt,
      isLatestSnapshot: true
    }
  };
}

const resultIdentity = (result) => {
  const row = result.row || {};
  const snapshot = result.snapshot || {};
  const activeSnapshot = result.activeSnapshot || {};
  const canonicalTimestamp = (value) => {
    const parsed = new Date(value || '');
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : (value || null);
  };
  return {
    snapshotId: activeSnapshot.snapshotId || snapshot.snapshotId || row.snapshot?.snapshotId || null,
    saveHash: activeSnapshot.saveHash || snapshot.saveHash || row.snapshot?.saveHash || null,
    saveModifiedAt: canonicalTimestamp(activeSnapshot.saveModifiedAt || row.save_last_modified),
    saveFilename: activeSnapshot.saveFilename || row.save_filename || null,
    campaignDate: activeSnapshot.campaignDate || row.game_time || null,
    generatedAt: canonicalTimestamp(activeSnapshot.generatedAt || snapshot.generatedAt || row.generated_at),
    isLatestSnapshot: result.isLatestSnapshot === true,
    activeSnapshot: {
      snapshotId: activeSnapshot.snapshotId || snapshot.snapshotId || row.snapshot?.snapshotId || null,
      saveHash: activeSnapshot.saveHash || snapshot.saveHash || row.snapshot?.saveHash || null,
      saveModifiedAt: canonicalTimestamp(activeSnapshot.saveModifiedAt || row.save_last_modified),
      saveFilename: activeSnapshot.saveFilename || row.save_filename || null,
      campaignDate: activeSnapshot.campaignDate || row.game_time || null,
      generatedAt: canonicalTimestamp(activeSnapshot.generatedAt || snapshot.generatedAt || row.generated_at),
      isLatestSnapshot: result.isLatestSnapshot === true
    }
  };
};

const snapshotEnvelope = (result, format = 'compact') => {
  const row = result.row;
  const exports = result.chatgptExport || {};
  const markdown = format === 'full'
    ? (exports.full || exports.compact || '')
    : (exports.compact || exports.full || '');

  return {
    success: true,
    source: 'supabase',
    ...resultIdentity(result),
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
      'cache-control': 'no-store'
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
    ...resultIdentity(result),
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
    // NOTE: 'mining' is handled by the analysis branch further down, which
    // honours ?status and ?sort and returns best-site analysis. A duplicate
    // case label here matched first and made that branch unreachable, so
    // hosted responses silently ignored both parameters.
    case 'fleets':
      items = asArray(snapshot.fleets)
        .filter(fleet => factionMatches(fleet, factionId) && bodyMatches(fleet, body))
        .map(fleetResourceRow);
      break;
    case 'ships':
      items = shipResourceRows(asArray(snapshot.fleets), factionId, body);
      break;
    case 'resources':
      items = asArray(snapshot.factions)
        .filter(faction => factionMatches(faction, factionId))
        .map(factionResourceRow);
      break;
    case 'hab-modules':
      items = asArray(snapshot.habModules)
        .filter(module => factionMatches(module, factionId) && bodyMatches(module, body))
        .map(habModuleResourceRow);
      break;
    case 'shipyards':
      items = asArray(snapshot.shipyardStations)
        .filter(station => factionMatches(station, factionId) && bodyMatches(station, body))
        .map(shipyardStationResourceRow);
      break;
    case 'shipyard-queues':
      items = asArray(snapshot.shipyardQueues)
        .filter(queue => factionMatches(queue, factionId) && bodyMatches(queue, body))
        .map(shipyardResourceRow);
      break;
    case 'arrivals':
      items = asArray(snapshot.fleets)
        .filter(fleet => fleet.arrivalDate && factionMatches(fleet, factionId) && bodyMatches(fleet, body))
        .map(fleet => arrivalResourceRow(fleet, friendlyStrengthAtDestination(fleet, snapshot)));
      break;
    case 'transfers': {
      const destination = url.searchParams.get('destination');
      items = transfersResource(snapshot, factionId, body, destination);
      break;
    }
    case 'logistics': {
      const observerId = snapshot.observerFactionId || 4712;
      const log = logisticsResource(snapshot, observerId);
      return resourceEnvelope(result, resource, log.resources, query, log);
    }
    case 'construction': {
      items = constructionResource(snapshot, factionId, body);
      break;
    }
    case 'ship-designs': {
      items = shipDesignsResource(snapshot, factionId);
      break;
    }
    case 'theaters': {
      const observerId = snapshot.observerFactionId || 4712;
      items = theatersResource(snapshot, observerId);
      break;
    }
    case 'infrastructure': {
      items = infrastructureResource(snapshot, factionId, body);
      break;
    }
    case 'alien-threat': {
      const observerId = snapshot.observerFactionId || 4712;
      const threat = alienThreatResource(snapshot, observerId);
      return resourceEnvelope(result, resource, [], query, threat);
    }
    case 'delta': {
      const observerId = snapshot.observerFactionId || 4712;
      // The hosted worker has no previous raw snapshot to diff against, but
      // the publisher already embedded a computed comparison in every row.
      // Passing null unconditionally made this endpoint permanently report
      // comparisonAvailable:false, even after many saves had been published.
      if (snapshot.changesSincePrevious) {
        return resourceEnvelope(result, resource, [], query, {
          ...snapshot.changesSincePrevious,
          source: 'published-comparison'
        });
      }
      const delta = deltaResource(snapshot, null, observerId);
      return resourceEnvelope(result, resource, [], query, delta);
    }
    case 'mobility': {
      const fleetId = url.searchParams.get('fleet') || url.searchParams.get('fleetId');
      const observerId = snapshot.observerFactionId || 4712;
      const mob = mobilityResource(snapshot, fleetId, observerId);
      return resourceEnvelope(result, resource, mob.transfers || [], query, mob);
    }
    case 'production-plan': {
      const designId = url.searchParams.get('design') || url.searchParams.get('designId') || url.searchParams.get('target');
      const quantity = parseInt(url.searchParams.get('quantity'), 10) || 1;
      const observerId = snapshot.observerFactionId || 4712;
      const plan = productionPlanResource(snapshot, designId, quantity, observerId);
      return resourceEnvelope(result, resource, [], query, plan);
    }
    case 'body-status': {
      const observerId = snapshot.observerFactionId || 4712;
      const statusObj = bodyStatusResource(snapshot, body || 'Mars', observerId);
      return resourceEnvelope(result, resource, [], query, statusObj);
    }
    case 'mining': {
      const status = url.searchParams.get('status');
      const sort = url.searchParams.get('sort');
      const mining = miningAnalysisResource(snapshot, factionId, body, status, sort);
      return resourceEnvelope(result, resource, mining.items, query, mining);
    }
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

const TECH_RESOURCES = new Set([
  'tech-tree', 'tech-path', 'tech-search', 'tech-milestones',
  'tech-matrix', 'tech-opportunities', 'research-queue'
]);

const techIntelResource = (pathName) => {
  const direct = pathName.match(/^\/api\/([^/]+)$/);
  const grouped = pathName.match(/^\/api\/intel\/([^/]+)$/);
  const resource = grouped?.[1] || direct?.[1];
  return resource && TECH_RESOURCES.has(resource) ? resource : null;
};

const buildTechIntelResource = (result, resource, snapshot, url) => {
  const row = result.row;
  const identity = resultIdentity(result);
  const observerId = Number(url.searchParams.get('observer') || row.observer_faction_id || 4712);
  const mode = result.mode || row.visibility || 'player';

  let projection;
  if (resource === 'tech-tree') {
    const category = String(url.searchParams.get('category') || 'all').toLowerCase();
    if (!CATEGORIES.has(category)) {
      return jsonResponse({ success: false, error: `Invalid category '${category}'.` }, 400);
    }
    const includeEffects = String(url.searchParams.get('includeEffects') ?? 'true') !== 'false';
    projection = buildTechTreeProjection(snapshot, mode, observerId, { category, includeEffects });
  } else if (resource === 'tech-path') {
    const rawTarget = url.searchParams.get('target');
    if (!rawTarget) {
      return jsonResponse({ success: false, error: 'Missing required query parameter: target.' }, 400);
    }
    const targets = rawTarget.split(',').map(t => t.trim()).filter(Boolean);
    projection = buildTechPathProjection(snapshot, mode, observerId, targets);
  } else if (resource === 'tech-search') {
    const query = url.searchParams.get('q') || '';
    if (!query) {
      return jsonResponse({ success: false, error: 'Missing required query parameter: q.' }, 400);
    }
    projection = buildTechSearchProjection(snapshot, mode, observerId, query);
  } else if (resource === 'tech-milestones') {
    const category = url.searchParams.get('category') ? String(url.searchParams.get('category')).toLowerCase() : null;
    projection = buildTechMilestonesProjection(snapshot, mode, observerId, category);
  } else if (resource === 'tech-matrix') {
    projection = buildTechMatrixProjection(snapshot, mode, observerId);
  } else if (resource === 'tech-opportunities') {
    projection = buildTechOpportunitiesProjection(snapshot, mode, observerId);
  } else {
    projection = buildResearchQueueProjection(snapshot, mode, observerId);
  }

  return {
    success: true,
    source: 'supabase',
    ...identity,
    difficulty: row.difficulty,
    observerFaction: { id: observerId, name: row.observer_faction_name || null },
    intelMode: mode,
    visibility: row.visibility || mode,
    ...projection
  };
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
      // The publishing fan-out policy may cover only a subset of factions.
      // Advertise which observers actually have rows; a selector offering an
      // unpublished observer returns 404 and clears the dashboard.
      let availableObservers = null;
      try {
        const campaign = await readPublicCampaign(env, env.SUPABASE_CAMPAIGN_KEY || 'initiative');
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
        supportedModes: Array.from(HOSTED_MODES),
        defaultMode: 'player',
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

    if (url.pathname === '/api/intel' || url.pathname === '/api/intel/') {
      const payload = {
        success: true,
        source: 'hosted-worker',
        name: 'Terra Invicta Strategic Intelligence API',
        endpoints: INTEL_ENDPOINT_INDEX,
        examples: INTEL_ENDPOINT_EXAMPLES,
        query: {
          observer: 'Observer faction ID, e.g. 4712',
          mode: 'player | enhanced | omniscient',
          faction: 'Optional faction ID filter',
          body: 'Optional body/theater filter'
        }
      };
      if (url.searchParams.get('format') === 'json' || request.headers.get('accept')?.includes('application/json')) {
        return jsonResponse(payload);
      }

      const links = Object.entries(payload.endpoints).map(([name, endpoint]) => {
        const query = payload.examples[name] || '?observer=4712&mode=omniscient';
        const href = `${endpoint}${query}`.replace(/&/g, '&amp;');
        return `<li><span>${name}</span><a href="${href}">${endpoint}${query}</a></li>`;
      }).join('');
      return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="robots" content="index,follow">
<title>Terra Invicta Strategic Intelligence API</title></head><body>
<main><h1>Terra Invicta Strategic Intelligence API</h1>
<p>Machine-readable endpoint directory. Add or change observer, mode, faction, body, and other filters as needed.</p>
<p><a href="/api/intel?format=json">JSON index</a> · <a href="/v2/">Command Center</a></p>
<ul>${links}</ul></main></body></html>`, {
        status: 200,
        headers: {
          ...corsHeaders,
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'no-referrer'
        }
      });
    }

    // Compact strategic history is intentionally separate from the large
    // observer/mode snapshot table. It remains public read-only data under the
    // campaign's RLS policy and is safe to expose without a mode parameter.
    if (url.pathname === '/api/intel/history' || url.pathname === '/api/intel/history/') {
      if (!isSupabaseConfigured) {
        return jsonResponse({ success: false, error: 'Hosted Supabase is not configured.' }, 503);
      }
      try {
        const campaignKey = url.searchParams.get('campaign') || env.SUPABASE_CAMPAIGN_KEY || 'initiative';
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
        const campaignKey = url.searchParams.get('campaign') || env.SUPABASE_CAMPAIGN_KEY || 'initiative';
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
        const campaignKey = url.searchParams.get('campaign') || env.SUPABASE_CAMPAIGN_KEY || 'initiative';
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
