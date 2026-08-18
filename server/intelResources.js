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
  researchResourceRows,
  summaryResource,
  findAlienFaction
} = shared;

function buildResource(snapshot, resource, { factionId = null, body = null, mode = 'player' } = {}) {
  if (!SUPPORTED_RESOURCES.has(resource)) return null;
  const identity = snapshotIdentity.readSnapshotIdentity(snapshot);
  const query = { faction: factionId, body };
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

  let items = [];
  switch (resource) {
    case 'factions': items = asArray(snapshot.factions).filter(item => factionMatches(item, factionId)).map(factionResourceRow); break;
    case 'nations': items = asArray(snapshot.nations).filter(item => factionMatches(item, factionId)).map(nationResourceRow); break;
    case 'councilors': items = asArray(snapshot.councilors).filter(item => factionMatches(item, factionId)).map(item => councilorResourceRow(item, mode)); break;
    case 'habs': items = asArray(snapshot.habs).filter(item => factionMatches(item, factionId) && bodyMatches(item, body)).map(habResourceRow); break;
    case 'hab-sites': items = asArray(snapshot.habSites).filter(item => factionMatches(item, factionId) && bodyMatches(item, body)).map(habSiteResourceRow); break;
    case 'mining': items = asArray(snapshot.habSites).filter(item => factionMatches(item, factionId) && bodyMatches(item, body)).map(miningResourceRow); break;
    case 'fleets': items = asArray(snapshot.fleets).filter(item => factionMatches(item, factionId) && bodyMatches(item, body)).map(fleetResourceRow); break;
    case 'ships': items = shipResourceRows(asArray(snapshot.fleets), factionId, body); break;
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