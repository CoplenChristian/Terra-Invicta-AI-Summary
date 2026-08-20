// server/techIntel.js
//
// Local Express wrapper that projects the tech-tree endpoints from the filtered
// snapshot's embedded techTree graph. The pure projection logic lives in
// shared/techGraph.mjs so the hosted worker can reuse it over published data.

const snapshotIdentity = require('./snapshotIdentity');
const techGraph = require('../shared/techGraph.mjs');
// One id-matching idiom repo-wide. The observer id arrives from an HTTP query
// string while the snapshot's faction ID is numeric, so a strict `===` between
// them silently answers about no faction at all rather than erroring.
const { sameId } = require('../shared/util.mjs');

const {
  buildTechTreeProjection,
  buildTechPathProjection,
  buildTechSearchProjection,
  buildTechMilestonesProjection,
  buildTechMatrixProjection,
  buildTechOpportunitiesProjection,
  buildResearchQueueProjection,
  CATEGORIES
} = techGraph;

function baseEnvelope(snapshot, mode, observerId) {
  const identity = snapshotIdentity.readSnapshotIdentity(snapshot);
  const observer = (snapshot.factions || []).find(f => sameId(f.ID, observerId));
  return {
    success: true,
    source: 'local',
    ...identity,
    campaignDate: snapshot.metadata?.gameTimeString || null,
    saveFilename: snapshot.metadata?.fileName || null,
    difficulty: snapshot.metadata?.difficulty || null,
    observerFaction: { id: observerId, name: observer?.displayName || null },
    intelMode: mode,
    visibility: mode
  };
}

module.exports = {
  CATEGORIES,
  buildTechTree: (snapshot, mode, observerId, options) => ({
    ...baseEnvelope(snapshot, mode, observerId),
    ...buildTechTreeProjection(snapshot, mode, observerId, options)
  }),
  buildPath: (snapshot, mode, observerId, targets) => ({
    ...baseEnvelope(snapshot, mode, observerId),
    ...buildTechPathProjection(snapshot, mode, observerId, targets)
  }),
  buildSearch: (snapshot, mode, observerId, query) => ({
    ...baseEnvelope(snapshot, mode, observerId),
    ...buildTechSearchProjection(snapshot, mode, observerId, query)
  }),
  buildMilestones: (snapshot, mode, observerId, category) => ({
    ...baseEnvelope(snapshot, mode, observerId),
    ...buildTechMilestonesProjection(snapshot, mode, observerId, category)
  }),
  buildMatrix: (snapshot, mode, observerId) => ({
    ...baseEnvelope(snapshot, mode, observerId),
    ...buildTechMatrixProjection(snapshot, mode, observerId)
  }),
  buildOpportunities: (snapshot, mode, observerId) => ({
    ...baseEnvelope(snapshot, mode, observerId),
    ...buildTechOpportunitiesProjection(snapshot, mode, observerId)
  }),
  buildQueue: (snapshot, mode, observerId) => ({
    ...baseEnvelope(snapshot, mode, observerId),
    ...buildResearchQueueProjection(snapshot, mode, observerId)
  })
};
