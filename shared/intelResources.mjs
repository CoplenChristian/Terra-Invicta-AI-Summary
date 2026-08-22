// shared/intelResources.mjs
//
// Purpose: public entry point for the intel projections — a barrel re-exporting
//   the shared/intel/ domain modules for both runtimes.
//
// Public entry point for the intel projections shared by the local Express
// server (loaded via require(esm)) and the hosted Cloudflare worker (ESM
// import). Keep this file, and everything under `shared/intel/`, free of any
// runtime-specific imports so they stay usable in both.
//
// ---------------------------------------------------------------------------
// This file used to BE the projections -- 2,639 lines holding fifteen domain
// builders, a dispatcher, and a registry. The 2026-08-20 code review flagged
// that as a multi-functional file, so the bodies moved out to one module per
// domain under `shared/intel/` and this file became the barrel. Every export
// below is the SAME function object it always was, re-exported rather than
// wrapped, so both `require()` and `import { x }` of this path are unchanged
// for every caller -- including the build step that rewrites the worker's
// `../shared/` specifiers, which never had to know what is inside this file:
// `server/index.js`, `server/intelResources.js`, `server/snapshotLoader.js`,
// `server/miningExpansion.js`, `site/worker/index.js`, and `scripts/`.
//
//   intel/common.mjs          the mining resource table, filter predicates,
//                             cost normalisation, alien-faction lookup
//   intel/factions.mjs        factions, nations, councilors, research, summary
//   intel/habs.mjs            habs, hab sites, hab modules, infrastructure
//   intel/fleets.mjs          fleets, ships, arrivals, orbital transfers
//   intel/construction.mjs    shipyards, queues, the consolidated build board
//   intel/production.mjs      ship designs and the procurement plan
//   intel/logistics.mjs       the war economy
//   intel/mining.mjs          current yields and scarcity-ranked prospects
//   intel/miningExpansion.mjs capacity, runways, need-weighted site scoring
//   intel/theaters.mjs        per-body posture and the single-body briefing
//   intel/mobility.mjs        fleet transfer feasibility
//   intel/alienThreat.mjs     hate math, floor, total-war gate, retaliation
//   intel/delta.mjs           turn-to-turn comparison
//   intel/propulsion.mjs      research advisor phase 1: delta-V, thrust, refits
//   intel/militaryValue.mjs   research advisor phase 2: what a gate lets you build
//   intel/economicValue.mjs   research advisor phase 3: what a tech DOES, priced
//                             against the observer's own live figures
//   intel/registry.mjs        the ONE endpoint table: route, discovery index,
//                             example, and dispatch, all derived from it
//
// `scripts/build_static_snapshot.js` copies `shared/` recursively beside the
// worker entry point, so the subdirectory needs no build edit.
// ---------------------------------------------------------------------------

// Re-exported so existing importers of these names keep working. The
// definitions themselves live in shared/util.mjs, where they are shared with
// strategicSnapshot / strategicDelta / techGraph / councilorAttributes and the
// server modules instead of being copied into each.
export { asArray, toFiniteNumber as toFinite, sameId } from './util.mjs';

export {
  MINING_RESOURCES,
  normalizeBody,
  factionMatches,
  bodyMatches,
  destinationMatches,
  rateMultiplier,
  normalizeCostObject,
  siteMonthlyOutput,
  combatPowerTotal,
  COMBAT_POWER_SOURCE,
  findAlienFaction
} from './intel/common.mjs';

export {
  factionResourceRow,
  nationResourceRow,
  councilorResourceRow,
  researchResourceRows,
  summaryResource
} from './intel/factions.mjs';

export {
  habResourceRow,
  habSiteResourceRow,
  habModuleResourceRow,
  infrastructureResource
} from './intel/habs.mjs';

export {
  fleetResourceRow,
  fleetSummaryRow,
  fleetSummaryProjection,
  shipResourceRow,
  shipResourceRows,
  shipSummaryProjection,
  FLEET_SUMMARY_OMITTED_FIELDS,
  SHIP_SUMMARY_OMITTED_FIELDS,
  friendlyStrengthAtDestination,
  arrivalResourceRow,
  transferResourceRow,
  transfersResource
} from './intel/fleets.mjs';

export {
  shipyardResourceRow,
  shipyardStationResourceRow,
  constructionResource
} from './intel/construction.mjs';

export {
  shipDesignsResource,
  productionPlanResource
} from './intel/production.mjs';

export { logisticsResource } from './intel/logistics.mjs';

export {
  miningResourceRow,
  miningAnalysisResource,
  MINING_SCARCITY_WEIGHTS,
  miningProspectsResource
} from './intel/mining.mjs';

export {
  EXPANSION_THEATER_ACCESSIBILITY,
  EXPANSION_MISSION_TECH_NAMES,
  EXPANSION_MINE_LIMIT_GRANTS,
  resolveBodyDestinationTech,
  evaluateSaturatingUtility,
  buildMiningCapacity,
  buildMiningResourceRunways,
  scoreMiningSiteCandidate,
  compareMiningCandidates,
  miningExpansionResource
} from './intel/miningExpansion.mjs';

export { theatersResource, bodyStatusResource } from './intel/theaters.mjs';

export { mobilityResource } from './intel/mobility.mjs';

export { alienThreatResource } from './intel/alienThreat.mjs';

export { deltaResource } from './intel/delta.mjs';

export { refitAdvisorResource } from './intel/refitAdvisor.mjs';

export {
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
} from './intel/registry.mjs';
