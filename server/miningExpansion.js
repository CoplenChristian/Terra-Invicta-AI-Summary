/**
 * server/miningExpansion.js — CommonJS adapter over the ONE mining-expansion
 * implementation.
 * Purpose: CommonJS adapter exposing the shared mining-expansion projection to
 *   the local Express server.
 *
 * There used to be two. This file carried a full second copy of the capacity
 * model, the runway model and the saturating scorer, while the endpoint the
 * dashboard actually calls (`/api/intel/mining-expansion`) was served by
 * `miningExpansionResource` in `shared/intelResources.mjs`. The two had
 * diverged: this copy had the null-honesty fixes (unknown difficulty -> null
 * hate cost, absent rate -> unmeasured yield, null-safe ranking) and the live
 * one still fabricated `?? 0.3` difficulty and `?? 0` rates. Every fix landed
 * in the copy the user never saw.
 *
 * The scoring now lives in `shared/intelResources.mjs` because that module is
 * the one both the Express server and the Cloudflare worker load, and it must
 * stay free of Node-only imports. This file adds only what needs Node: the
 * body -> space-theater classification table in `./spaceTheater`, used to give
 * the pure destination-tech resolver a theater key when a caller passes only a
 * body name.
 *
 * Verified 2026-08-20 against the live save before collapsing: both copies
 * produced identical partitioning (109 available / 187 unreachable / 3
 * tech-gated groups), identical ordering and identical siteValues in BOTH
 * player and omniscient mode, so nothing measurable was lost in the merge.
 */

const shared = require('../shared/intelResources.mjs');
const spaceTheater = require('./spaceTheater');
const { DEFAULT_OBSERVER_FACTION_ID } = require('../shared/constants.mjs');

const {
  buildMiningCapacity,
  buildMiningResourceRunways,
  evaluateSaturatingUtility,
  scoreMiningSiteCandidate,
  compareMiningCandidates,
  miningExpansionResource,
  resolveBodyDestinationTech,
  EXPANSION_THEATER_ACCESSIBILITY,
  EXPANSION_MISSION_TECH_NAMES,
  EXPANSION_MINE_LIMIT_GRANTS
} = shared;

/**
 * Destination mission tech for a body. The shared resolver needs a space
 * theater key for the Jupiter/Saturn/outer systems (a bare "Ganymede" is not
 * in its name table); `spaceTheater.classifyBody` supplies one from the same
 * table the snapshot builder uses, so a caller with only a body name gets the
 * same answer the endpoint would give.
 */
function getDestinationTechForBody(bodyName, spaceTheaterKey = null) {
  const theaterKey = spaceTheaterKey || spaceTheater.classifyBody(bodyName);
  return resolveBodyDestinationTech(bodyName, theaterKey).tech;
}

/**
 * Same result the `/api/intel/mining-expansion` endpoint returns — this is a
 * direct call into the endpoint's own builder, not a parallel one.
 */
function buildMiningExpansion({ snapshot, observerId = DEFAULT_OBSERVER_FACTION_ID, config = {} } = {}) {
  return miningExpansionResource(snapshot, {
    observerId,
    targetRunwayMonths: config.targetRunwayMonths ?? 12,
    surplusDiscount: config.surplusDiscount ?? 0.05
  });
}

module.exports = {
  buildMiningCapacity,
  buildResourceRunways: buildMiningResourceRunways,
  evaluateUtility: evaluateSaturatingUtility,
  scoreSiteCandidate: scoreMiningSiteCandidate,
  compareMiningCandidates,
  buildMiningExpansion,
  getDestinationTechForBody,
  resolveBodyDestinationTech,
  THEATER_ACCESSIBILITY: EXPANSION_THEATER_ACCESSIBILITY,
  MISSION_TECH_NAMES: EXPANSION_MISSION_TECH_NAMES,
  MINE_LIMIT_GRANTS: EXPANSION_MINE_LIMIT_GRANTS
};
