const snapshotIdentity = require('./snapshotIdentity');
const shared = require('../shared/intelResources.mjs');
const { resolveConfig } = require('./config');

const {
  SUPPORTED_RESOURCES,
  INTEL_ENDPOINT_INDEX,
  INTEL_ENDPOINT_EXAMPLES,
  DETAIL_LEVELS,
  DEFAULT_DETAIL_LEVEL,
  DETAIL_AWARE_RESOURCES,
  isDetailLevel,
  parseDetailLevel,
  measureIntelEndpointSizes,
  buildResourceProjection
} = shared;
const runtimeConfig = resolveConfig();

function buildResource(snapshot, resource, options = {}) {
  if (!SUPPORTED_RESOURCES.has(resource)) return null;
  const {
    factionId = null,
    body = null,
    theater = null,
    limit = null,
    destination = null,
    fleetId = null,
    designId = null,
    quantity = 1,
    status = null,
    sort = null,
    previousSnapshot = null,
    mode = 'player',
    isLatestSnapshot = true,
    detail = DEFAULT_DETAIL_LEVEL
  } = options;
  const identity = snapshotIdentity.readSnapshotIdentity(snapshot);
  // `detail` is echoed only for the resources that honour it, so the echo never
  // implies a parameter did something it did not.
  const query = {
    faction: factionId,
    body,
    theater,
    limit,
    destination,
    fleet: fleetId,
    design: designId,
    quantity,
    status,
    sort,
    ...(DETAIL_AWARE_RESOURCES.has(resource) ? { detail } : {})
  };
  const projection = buildResourceProjection(snapshot, resource, {
    factionId,
    body,
    theater,
    limit,
    destination,
    fleetId,
    designId,
    quantity,
    status,
    sort,
    previousSnapshot,
    mode,
    detail,
    weights: runtimeConfig.analysis.miningScarcityWeights
  });
  return {
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
    query,
    ...projection
  };
}

module.exports = {
  SUPPORTED_RESOURCES,
  INTEL_ENDPOINT_INDEX,
  INTEL_ENDPOINT_EXAMPLES,
  DETAIL_LEVELS,
  DEFAULT_DETAIL_LEVEL,
  DETAIL_AWARE_RESOURCES,
  isDetailLevel,
  parseDetailLevel,
  measureIntelEndpointSizes,
  buildResource
};
