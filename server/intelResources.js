const snapshotIdentity = require('./snapshotIdentity');
const shared = require('../shared/intelResources.mjs');

const {
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
} = shared;

function buildResource(snapshot, resource, {
  factionId = null,
  body = null,
  destination = null,
  fleetId = null,
  designId = null,
  quantity = 1,
  status = null,
  sort = null,
  previousSnapshot = null,
  mode = 'player',
  isLatestSnapshot = true
} = {}) {
  if (!SUPPORTED_RESOURCES.has(resource)) return null;
  const identity = snapshotIdentity.readSnapshotIdentity(snapshot);
  const query = { faction: factionId, body, destination, fleet: fleetId, design: designId, quantity, status, sort };
  const observerId = snapshot.observerFactionId || 4712;

  const base = {
    success: true,
    source: 'local',
    resource,
    ...identity,
    campaignDate: snapshot.metadata?.gameTimeString || null,
    saveFilename: snapshot.metadata?.fileName || null,
    difficulty: snapshot.metadata?.difficulty || null,
    observerFaction: { id: snapshot.observerFactionId, name: snapshot.observerFactionName },
    intelMode: mode,
    visibility: mode,
    isLatestSnapshot,
    activeSnapshot: {
      ...identity,
      saveFilename: snapshot.metadata?.fileName || null,
      campaignDate: snapshot.metadata?.gameTimeString || null,
      isLatestSnapshot
    },
    query
  };

  if (resource === 'summary') {
    return { ...base, count: null, items: [], ...summaryResource(snapshot) };
  }
  if (resource === 'capabilities') {
    return {
      ...base,
      count: 0,
      items: [],
      capabilities: snapshot.capabilities || {},
      activeXenoforming: snapshot.activeXenoforming || [],
      builtAlienFacilities: snapshot.builtAlienFacilities || []
    };
  }
  if (resource === 'alien') {
    const alienFaction = findAlienFaction(snapshot);
    const alienId = alienFaction?.ID;
    const fleets = asArray(snapshot.fleets).filter(fleet => fleet.factionId === alienId && bodyMatches(fleet, body));
    const habs = asArray(snapshot.habs).filter(hab => hab.factionId === alienId && bodyMatches(hab, body));
    const habSites = asArray(snapshot.habSites).filter(site => site.factionId === alienId && bodyMatches(site, body));
    const councilors = asArray(snapshot.councilors).filter(councilor => councilor.factionId === alienId);
    return {
      ...base,
      count: councilors.length + fleets.length + habs.length + habSites.length,
      items: [],
      faction: alienFaction ? factionResourceRow(alienFaction) : null,
      councilors: councilors.map(councilor => councilorResourceRow(councilor, mode)),
      fleets: fleets.map(fleetResourceRow),
      habs: habs.map(habResourceRow),
      habSites: habSites.map(habSiteResourceRow),
      activeXenoforming: snapshot.activeXenoforming || [],
      builtAlienFacilities: snapshot.builtAlienFacilities || []
    };
  }

  if (resource === 'logistics') {
    const log = logisticsResource(snapshot, observerId);
    return { ...base, count: log.resources.length, items: log.resources, ...log };
  }
  if (resource === 'construction') {
    const items = constructionResource(snapshot, factionId, body);
    return { ...base, count: items.length, items };
  }
  if (resource === 'transfers') {
    const items = transfersResource(snapshot, factionId, body, destination);
    return { ...base, count: items.length, items };
  }
  if (resource === 'ship-designs') {
    const items = shipDesignsResource(snapshot, factionId);
    return { ...base, count: items.length, items };
  }
  if (resource === 'theaters') {
    const items = theatersResource(snapshot, observerId);
    return { ...base, count: items.length, items };
  }
  if (resource === 'infrastructure') {
    const items = infrastructureResource(snapshot, factionId, body);
    return { ...base, count: items.length, items };
  }
  if (resource === 'alien-threat') {
    const threat = alienThreatResource(snapshot, observerId);
    return { ...base, count: null, items: [], ...threat };
  }
  if (resource === 'delta') {
    const delta = deltaResource(snapshot, previousSnapshot, observerId);
    return { ...base, count: null, items: [], ...delta };
  }
  if (resource === 'mobility') {
    const mob = mobilityResource(snapshot, fleetId, observerId);
    return { ...base, count: mob.transfers?.length || 0, items: mob.transfers || [], ...mob };
  }
  if (resource === 'production-plan') {
    const plan = productionPlanResource(snapshot, designId, quantity, observerId);
    return { ...base, count: null, items: [], ...plan };
  }
  if (resource === 'body-status') {
    const statusObj = bodyStatusResource(snapshot, body || 'Mars', observerId);
    return { ...base, count: null, items: [], ...statusObj };
  }

  let items = [];
  switch (resource) {
    case 'factions': items = asArray(snapshot.factions).filter(item => factionMatches(item, factionId)).map(factionResourceRow); break;
    case 'nations': items = asArray(snapshot.nations).filter(item => factionMatches(item, factionId)).map(nationResourceRow); break;
    case 'councilors': items = asArray(snapshot.councilors).filter(item => factionMatches(item, factionId)).map(item => councilorResourceRow(item, mode)); break;
    case 'habs': items = asArray(snapshot.habs).filter(item => factionMatches(item, factionId) && bodyMatches(item, body)).map(habResourceRow); break;
    case 'hab-sites': items = asArray(snapshot.habSites).filter(item => factionMatches(item, factionId) && bodyMatches(item, body)).map(habSiteResourceRow); break;
    case 'mining': {
      const mining = miningAnalysisResource(snapshot, factionId, body, status, sort);
      return { ...base, count: mining.items.length, ...mining };
    }
    case 'fleets': items = asArray(snapshot.fleets).filter(item => factionMatches(item, factionId) && bodyMatches(item, body)).map(fleetResourceRow); break;
    case 'ships': items = shipResourceRows(asArray(snapshot.fleets), factionId, body); break;
    case 'resources':
      items = asArray(snapshot.factions)
        .filter(item => factionMatches(item, factionId))
        .map(factionResourceRow);
      break;
    case 'hab-modules':
      items = asArray(snapshot.habModules)
        .filter(item => factionMatches(item, factionId) && bodyMatches(item, body))
        .map(habModuleResourceRow);
      break;
    case 'shipyards':
      items = asArray(snapshot.shipyardStations)
        .filter(item => factionMatches(item, factionId) && bodyMatches(item, body))
        .map(shipyardStationResourceRow);
      break;
    case 'shipyard-queues':
      items = asArray(snapshot.shipyardQueues)
        .filter(item => factionMatches(item, factionId) && bodyMatches(item, body))
        .map(shipyardResourceRow);
      break;
    case 'arrivals':
      items = asArray(snapshot.fleets)
        .filter(item => item.arrivalDate && factionMatches(item, factionId) && bodyMatches(item, body))
        .map(item => arrivalResourceRow(item, friendlyStrengthAtDestination(item, snapshot)));
      break;
    case 'research': {
      const research = researchResourceRows(snapshot);
      return { ...base, count: research.rows.length, items: research.rows, finishedGlobalProjects: research.finishedGlobalProjects };
    }
    default: break;
  }
  return { ...base, count: items.length, items };
}

module.exports = {
  SUPPORTED_RESOURCES,
  buildResource
};
