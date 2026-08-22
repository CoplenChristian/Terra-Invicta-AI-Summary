// server/intelResources.js
//
// Purpose: CommonJS barrel exposing the shared intel projections to the local Express server.

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
  THRESHOLD_AWARE_RESOURCES,
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
    family = null,
    fleetId = null,
    designId = null,
    quantity = 1,
    status = null,
    sort = null,
    thresholds = null,
    previousSnapshot = null,
    mode = 'player',
    isLatestSnapshot = true,
    detail = DEFAULT_DETAIL_LEVEL
  } = options;
  const identity = snapshotIdentity.readSnapshotIdentity(snapshot);
  // `detail` and the minimum thresholds are echoed only for the resources that
  // honour them, so the echo never implies a parameter did something it did not.
  // The thresholds echo here is the RAW request; what the projection made of it,
  // including any rejection, is on the projection's own `thresholds` block.
  const query = {
    faction: factionId,
    body,
    theater,
    limit,
    destination,
    family,
    fleet: fleetId,
    design: designId,
    quantity,
    status,
    sort,
    ...(DETAIL_AWARE_RESOURCES.has(resource) ? { detail } : {}),
    ...(THRESHOLD_AWARE_RESOURCES.has(resource) ? { ...(thresholds || {}) } : {})
  };
  const projection = buildResourceProjection(snapshot, resource, {
    factionId,
    body,
    theater,
    limit,
    destination,
    family,
    fleetId,
    designId,
    quantity,
    status,
    sort,
    thresholds,
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
    // `difficulty` stays the save's own word because the hate model keys off
    // it. `difficultyLabel` is what a reader should see: it names the
    // customisation so a 200%-rate campaign is not read as a stock one.
    difficultyLabel: snapshot.metadata?.difficultyLabel || snapshot.metadata?.difficulty || null,
    campaignSettings: snapshot.metadata?.campaignSettings || null,
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
  THRESHOLD_AWARE_RESOURCES,
  isDetailLevel,
  parseDetailLevel,
  measureIntelEndpointSizes,
  buildResource
};
