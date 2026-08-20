// server/snapshotBuilder.js
//
// Public entry point for the raw-snapshot reducer. Exports the same singleton
// object it always did, so `server/snapshotLoader.js`, `server/index.js`,
// `scripts/build_static_snapshot.js`, `scripts/push_latest_to_supabase.js` and
// the test suites are unchanged.
//
// ---------------------------------------------------------------------------
// This file used to BE the reducer -- 1,941 lines in which `buildRawSnapshot`
// alone ran to 1,240, followed by thirty helper methods hanging off the same
// class. The 2026-08-20 code review (section D) flagged it as a multi-
// functional file, so the bodies moved out to one module per domain under
// `server/snapshot/` and this file became the barrel.
//
// Every method below is the SAME function object the module exports, assigned
// onto the prototype rather than wrapped, so `snapshotBuilder.normalizedScore
// === numbers.normalizedScore` holds and the delegation cannot drift from the
// implementation.
//
//   snapshot/numbers.js     numeric, date and resource-map primitives -- the
//                           "absent stays null" guards every reducer shares
//   snapshot/lookups.js     gamestates -> raw collections -> id maps, plus the
//                           faction-name / orbit-body / colour accessors
//   snapshot/nations.js     nations joined to their control points
//   snapshot/councilors.js  the roster, orgs, and base-vs-resolved attributes
//   snapshot/space.js       fleets, ships, habs, hab sites, hab modules,
//                           shipyard queues and stations, resource transfers
//   snapshot/factions.js    relationships, power scores, projects, xenoforming,
//                           alien facilities, default targets, tech matrix
//   snapshot/research.js    global tech slots and the tech dependency graph
//   snapshot/templates.js   the three save-independent template builders
//   snapshot/rawSnapshot.js the orchestration that runs them in order
//
// Domain boundaries follow what each reducer READS, not file size. `space.js`
// keeps fleets and habs together because both resolve position through the same
// orbit maps and both feed the shipyard join; `numbers.js` is deliberately free
// of domain knowledge so no reducer can grow a softer local copy of a presence
// guard. The `MISSION_HATE_SLOT` / `SATURN_ORBIT_TOLERANCE_AU` / FACTION_COLORS
// constants moved with the code that reads them rather than into a shared bag.
// ---------------------------------------------------------------------------

const templateLoader = require('./templateLoader');
const numbers = require('./snapshot/numbers');
const lookups = require('./snapshot/lookups');
const space = require('./snapshot/space');
const templates = require('./snapshot/templates');
const research = require('./snapshot/research');
const factions = require('./snapshot/factions');
const rawSnapshot = require('./snapshot/rawSnapshot');

class SnapshotBuilder {
  constructor() {
    templateLoader.load();
  }
}

// Assigned rather than declared so each method IS the module's function object.
// Tests call `snapshotBuilder.normalizedScore`, `sumOrNull`, `completionPercent`
// and `lastFiniteNumber` directly; the rest are kept on the surface because they
// were reachable before this split and removing them would be a behaviour
// change dressed as a refactor.
Object.assign(SnapshotBuilder.prototype, {
  buildRawSnapshot: rawSnapshot.buildRawSnapshot,

  // Template-derived static builders.
  buildTraitStatMods: templates.buildTraitStatMods,
  buildMissionSpecs: templates.buildMissionSpecs,
  buildShipHullStats: templates.buildShipHullStats,
  buildTechTree: research.buildTechTree,

  // Numeric / date / resource-map primitives.
  roundNumber: numbers.roundNumber,
  firstNumericOrNull: numbers.firstNumericOrNull,
  sumOrNull: numbers.sumOrNull,
  completionPercent: numbers.completionPercent,
  normalizedScore: numbers.normalizedScore,
  lastFiniteNumber: numbers.lastFiniteNumber,
  dateValueToIso: numbers.dateValueToIso,
  roundResourceMap: numbers.roundResourceMap,
  scaleResourceMap: numbers.scaleResourceMap,
  normalizeResourceCosts: numbers.normalizeResourceCosts,
  summarizeRecentTransactions: numbers.summarizeRecentTransactions,

  // Save-structure lookups.
  getCollection: lookups.getCollection,
  getFactionColor: lookups.getFactionColor,
  resolveFactionName: lookups.resolveFactionName,
  resolveOrbitBodyId: lookups.resolveOrbitBodyId,
  resolveOrbitBody: lookups.resolveOrbitBody,
  resolveOrbitBodyDistanceAU: lookups.resolveOrbitBodyDistanceAU,

  // Space-domain readers.
  readSiteResourceRates: space.readSiteResourceRates,
  habModuleResearchIncome: space.habModuleResearchIncome,
  moduleConstructionStatus: space.moduleConstructionStatus,
  daysRemainingForStatus: space.daysRemainingForStatus,
  classifyHabModule: space.classifyHabModule,
  normalizeArmor: space.normalizeArmor,
  medianArmor: space.medianArmor,
  resolveFleetDestination: space.resolveFleetDestination,
  readShipCombatPower: space.readShipCombatPower,
  registerShipModuleRefs: space.registerShipModuleRefs,
  resolveShipModule: space.resolveShipModule,
  buildWeaponLoadout: space.buildWeaponLoadout,
  summarizeWeaponCounts: space.summarizeWeaponCounts,
  getDominantWeaponType: space.getDominantWeaponType,
  formatWeaponSummary: space.formatWeaponSummary,

  // Faction-domain readers.
  normalizeFactionIntelligence: factions.normalizeFactionIntelligence
});

module.exports = new SnapshotBuilder();
