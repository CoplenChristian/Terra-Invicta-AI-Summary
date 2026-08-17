import { staticAssets } from './static-assets.js';

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
  const body = staticAssets[key];
  if (body === undefined) return null;

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': mimeTypeFor(key),
      'cache-control': key === 'index.html' ? 'no-cache' : 'public, max-age=300'
    }
  });
};

const asset = async (env, request, pathname) => {
  const url = new URL(request.url);
  url.pathname = pathname;

  if (env?.ASSETS?.fetch) {
    const response = await env.ASSETS.fetch(new Request(url.toString(), {
      method: 'GET',
      headers: request.headers
    }));
    if (response.status !== 404) return response;
  }

  return embeddedAsset(pathname) || new Response('Not found', { status: 404 });
};

const observerFile = (observerId, suffix) => {
  const safeObserverId = /^\d+$/.test(observerId || '') ? observerId : '4712';
  return `/data/${suffix}-player-${safeObserverId}.json`;
};

const jsonResponse = (body, status = 200) => {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=60, s-maxage=60'
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
  const safeObserverId = /^\d+$/.test(observerId || '') ? observerId : '4712';
  const mode = requestedMode === 'omniscient' ? 'omniscient' : 'player';

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
    markdown
  };
};

const markdownSnapshotResponse = (envelope) => new Response(
  `${envelope.markdown}\n`,
  {
    status: 200,
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=60, s-maxage=60'
    }
  }
);

const asArray = (value) => Array.isArray(value) ? value : [];

const numericQuery = (value) => /^\d+$/.test(String(value || '')) ? Number(value) : null;

const factionMatches = (item, factionId) => {
  if (factionId === null) return true;
  const controlPointIds = asArray(item.controlPoints).map(cp => cp?.factionId);
  return [item.ID, item.id, item.factionId, item.executiveFactionId, ...controlPointIds]
    .some(id => Number(id) === factionId);
};

const bodyMatches = (item, body) => {
  if (!body) return true;
  return String(item.orbitBody || item.parentBodyName || '').toLowerCase() === body.toLowerCase();
};

const factionResourceRow = (faction) => ({
  id: faction.ID,
  name: faction.displayName,
  templateName: faction.templateName,
  controlPoints: faction.controlPointsCount ?? 0,
  nations: faction.nationsCount ?? 0,
  habs: faction.habsCount ?? 0,
  fleets: faction.fleetsCount ?? 0,
  ships: faction.shipsCount ?? 0,
  totalGdp: faction.totalGdp ?? 0,
  totalPopulation: faction.totalPopulation ?? 0,
  totalBoost: faction.totalBoost ?? 0,
  totalResearch: faction.totalResearch ?? 0,
  combatPower: faction.combatPower ?? null,
  combatPowerAvailable: faction.combatPowerAvailable ?? false,
  powerScore: faction.powerScore?.overall ?? null,
  alienHate: faction.alienHate?.actual ?? faction.alienHate?.visibleEstimate ?? null,
  assessedAlienHateOfMe: faction.assessedAlienHateOfMe ?? null
});

const nationResourceRow = (nation) => ({
  id: nation.ID,
  name: nation.displayName,
  templateName: nation.templateName,
  executiveFactionId: nation.executiveFactionId,
  executiveFactionName: nation.executiveFactionName,
  controlPoints: asArray(nation.controlPoints).map(cp => ({
    factionId: cp?.factionId,
    factionName: cp?.factionName,
    type: cp?.controlPointType || cp?.type,
    control: cp?.control
  })),
  gdp: nation.GDP ?? 0,
  population: nation.population ?? 0,
  boost: nation.boost ?? 0,
  missionControl: nation.missionControl ?? 0,
  militaryTechnology: nation.milTech ?? 0,
  unrest: nation.unrest ?? 0,
  cohesion: nation.cohesion ?? 0,
  democracy: nation.democracy ?? 0,
  research: nation.research ?? 0,
  nukes: nation.nukes ?? 0,
  armies: nation.armies ?? 0,
  regions: nation.regionsCount ?? 0
});

const councilorResourceRow = (councilor, mode) => ({
  id: councilor.ID,
  name: councilor.displayName,
  personalName: councilor.personalName,
  familyName: councilor.familyName,
  factionId: councilor.factionId,
  factionName: councilor.factionName,
  agentForFactionId: councilor.agentForFactionId,
  agentForFactionName: councilor.agentForFactionName,
  type: councilor.typeTemplateName,
  isAlien: councilor.isAlien,
  status: councilor.status,
  location: councilor.locationName,
  locationRegionId: councilor.locationRegionId,
  activeMission: councilor.activeMission,
  visibility: councilor.visibility,
  investigationConfidence: councilor.investigationConfidence,
  isOwnCouncilor: councilor.isOwnCouncilor ?? false,
  isTurnedMole: councilor.isTurnedMole ?? false,
  traits: councilor.traits,
  organizations: councilor.orgs,
  attributes: mode === 'omniscient' ? councilor.attributes : undefined,
  maskedAttributes: councilor.maskedAttributes
});

const habResourceRow = (hab) => ({
  id: hab.ID,
  name: hab.displayName,
  factionId: hab.factionId,
  factionName: hab.factionName,
  templateName: hab.templateName,
  type: hab.habType,
  tier: hab.tier,
  orbitBody: hab.orbitBody,
  distanceAU: hab.orbitBodyDistanceAU,
  inEarthLEO: hab.inEarthLEO ?? false,
  insideSaturnOrbit: hab.insideSaturnOrbit ?? false,
  inCombat: hab.inCombat ?? false,
  underAssault: hab.underAssault ?? false,
  underBombardment: hab.underBombardment ?? false
});

const habSiteResourceRow = (site) => ({
  id: site.ID,
  name: site.displayName,
  factionId: site.factionId,
  factionName: site.factionName,
  habId: site.habId,
  bodyId: site.parentBodyId,
  bodyName: site.parentBodyName,
  water: site.water ?? 0,
  volatiles: site.volatiles ?? 0,
  metals: site.metals ?? 0,
  nobleMetals: site.nobleMetals ?? 0,
  fissiles: site.fissiles ?? 0,
  resourceRateUnit: site.resourceRateUnit
});

const fleetResourceRow = (fleet) => ({
  id: fleet.ID,
  name: fleet.displayName,
  factionId: fleet.factionId,
  factionName: fleet.factionName,
  mission: fleet.mission,
  inCombat: fleet.inCombat ?? false,
  orbitBody: fleet.orbitBody,
  distanceAU: fleet.orbitBodyDistanceAU,
  destination: fleet.destination,
  arrivalDate: fleet.arrivalDate,
  ships: fleet.shipsCount ?? 0,
  combatPower: fleet.combatPower ?? null,
  combatPowerAvailable: fleet.combatPowerAvailable ?? false,
  combatPowerSource: fleet.combatPowerSource,
  dominantWeaponType: fleet.dominantWeaponType,
  weaponSummary: fleet.weaponSummary,
  weaponBreakdown: fleet.weaponBreakdown,
  insideSaturnOrbit: fleet.insideSaturnOrbit ?? false
});

const shipResourceRows = (fleets, factionId, body) => fleets
  .filter(fleet => factionMatches(fleet, factionId) && bodyMatches(fleet, body))
  .flatMap(fleet => asArray(fleet.ships).map(ship => ({
    id: ship.id,
    name: ship.displayName,
    hullName: ship.hullName,
    factionId: fleet.factionId,
    factionName: fleet.factionName,
    fleetId: fleet.ID,
    fleetName: fleet.displayName,
    mission: fleet.mission,
    orbitBody: fleet.orbitBody,
    distanceAU: fleet.orbitBodyDistanceAU,
    destination: fleet.destination,
    combatPower: ship.combatPower ?? null,
    combatPowerSource: ship.combatPowerSource,
    dominantWeaponType: ship.dominantWeaponType,
    weaponLoadout: ship.weaponLoadout
  })));

const researchResourceRows = (snapshot) => {
  const globalResearch = snapshot.globalResearch || {};
  const slots = asArray(globalResearch.activeSlots).map(slot => ({
    type: 'global-slot',
    slotNumber: slot.slotNumber,
    projectId: slot.projectId,
    projectName: slot.displayName,
    percent: slot.percent,
    accumulatedResearch: slot.accumulatedResearch,
    totalCost: slot.totalCost,
    leadFactionId: slot.leadFactionId,
    leadFactionName: slot.leadFactionName
  }));
  const factionProjects = asArray(snapshot.factions).flatMap(faction =>
    asArray(faction.currentProjects).map(project => ({
      type: 'faction-project',
      factionId: faction.ID,
      factionName: faction.displayName,
      projectId: project.projectId || project.ID,
      projectName: project.displayName,
      percent: project.percent,
      accumulatedResearch: project.accumulatedResearch,
      totalCost: project.totalCost
    }))
  );
  return {
    rows: [...slots, ...factionProjects],
    finishedGlobalProjects: asArray(globalResearch.finishedTechsNames)
  };
};

const resourceEnvelope = (result, resource, items, query = {}, extra = {}) => {
  const row = result.row;
  return {
    success: true,
    source: 'supabase',
    resource,
    generatedAt: row.generated_at || null,
    saveModifiedAt: row.save_last_modified,
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
    count: Array.isArray(items) ? items.length : undefined,
    items,
    ...extra
  };
};

const summaryResource = (snapshot) => {
  const alienFaction = asArray(snapshot.factions).find(f => f.ID === 4717 || f.displayName === 'the Aliens');
  const alienFleets = asArray(snapshot.fleets).filter(fleet => fleet.factionId === alienFaction?.ID);
  const alienHabs = asArray(snapshot.habs).filter(hab => hab.factionId === alienFaction?.ID);
  const alienShips = alienFleets.reduce((total, fleet) => total + (fleet.shipsCount || 0), 0);
  const fleetsByBody = {};
  for (const fleet of alienFleets) {
    const body = fleet.orbitBody || 'Deep Space';
    if (!fleetsByBody[body]) fleetsByBody[body] = { fleets: 0, ships: 0 };
    fleetsByBody[body].fleets += 1;
    fleetsByBody[body].ships += fleet.shipsCount || 0;
  }
  const weaponMix = {};
  for (const fleet of alienFleets) {
    const type = fleet.dominantWeaponType || 'Unknown';
    if (!weaponMix[type]) weaponMix[type] = { fleets: 0, ships: 0 };
    weaponMix[type].fleets += 1;
    weaponMix[type].ships += fleet.shipsCount || 0;
  }

  return {
    metadata: snapshot.metadata,
    factions: asArray(snapshot.factions).map(factionResourceRow),
    alien: {
      factionId: alienFaction?.ID ?? null,
      factionName: alienFaction?.displayName ?? null,
      alienHate: alienFaction?.alienHate?.actual ?? alienFaction?.alienHate?.visibleEstimate ?? null,
      fleets: alienFleets.length,
      ships: alienShips,
      habs: alienHabs.length,
      fleetsByBody,
      weaponMix,
      earthMarsHabs: alienHabs.filter(hab => /earth|mars/i.test(hab.orbitBody || '') || hab.inEarthLEO).length,
      councilors: asArray(snapshot.councilors).filter(councilor => councilor.factionId === alienFaction?.ID).length
    },
    capabilities: snapshot.capabilities,
    priorityTargetFaction: snapshot.priorityTargetFaction
  };
};

const intelResource = (pathName) => {
  const direct = pathName.match(/^\/api\/([^/]+)$/);
  const grouped = pathName.match(/^\/api\/intel\/([^/]+)$/);
  const resource = grouped?.[1] || direct?.[1];
  const supported = new Set([
    'summary', 'factions', 'nations', 'councilors', 'habs', 'hab-sites',
    'fleets', 'ships', 'research', 'capabilities', 'alien'
  ]);
  return supported.has(resource) ? resource : null;
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
      return resourceEnvelope(result, resource, null, query, {
        capabilities: snapshot.capabilities || {},
        activeXenoforming: snapshot.activeXenoforming || [],
        builtAlienFacilities: snapshot.builtAlienFacilities || []
      });
    case 'alien': {
      const alienFaction = asArray(snapshot.factions).find(faction => faction.ID === 4717 || faction.displayName === 'the Aliens');
      const alienId = alienFaction?.ID;
      return resourceEnvelope(result, resource, null, query, {
        faction: alienFaction ? factionResourceRow(alienFaction) : null,
        councilors: asArray(snapshot.councilors).filter(councilor => councilor.factionId === alienId).map(councilor => councilorResourceRow(councilor, result.mode)),
        fleets: asArray(snapshot.fleets).filter(fleet => fleet.factionId === alienId && bodyMatches(fleet, body)).map(fleetResourceRow),
        habs: asArray(snapshot.habs).filter(hab => hab.factionId === alienId && bodyMatches(hab, body)).map(habResourceRow),
        habSites: asArray(snapshot.habSites).filter(site => site.factionId === alienId && bodyMatches(site, body)).map(habSiteResourceRow),
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
    const observerId = url.searchParams.get('observer') || '4712';
    const mode = url.searchParams.get('mode') === 'omniscient' ? 'omniscient' : 'player';
    const isSupabaseConfigured = !!(env.SUPABASE_URL && (env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY));

    // Flat resource endpoints are designed for external analysis tools. Each
    // call returns one focused collection instead of the entire nested snapshot.
    const resource = intelResource(url.pathname);
    if (resource) {
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
          return jsonResponse({ success: true, data: result.snapshot, source: 'supabase' });
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
          return jsonResponse({ success: true, markdown, source: 'supabase' });
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
