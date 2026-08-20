// tests/serverBarrels.test.js
//
// The 2026-08-20 review (section D) split three server monoliths into per-domain
// modules behind thin barrels at the original paths. These tests pin the two
// invariants that make that safe and that no behavioural test would catch:
//
//   1. The public surface did not shrink. Every method reachable on
//      `snapshotBuilder` / `briefingGenerator` before the split is still
//      reachable, so a caller outside this repo's own tests cannot have been
//      quietly broken.
//   2. The barrel re-exports the SAME function objects the domain modules
//      define, rather than wrapping them. A wrapper passes every behavioural
//      test while letting the barrel and the implementation drift apart.
//
// The single deliberate exception is `briefingGenerator.buildResearchDirectives`,
// which forwards `this.config` and is therefore its own function. It is
// asserted separately, so the exception has to stay deliberate.

const { test } = require('node:test');
const assert = require('node:assert');

const snapshotBuilder = require('../server/snapshotBuilder');
const briefingGenerator = require('../server/briefingGenerator');

const numbers = require('../server/snapshot/numbers');
const lookups = require('../server/snapshot/lookups');
const space = require('../server/snapshot/space');
const snapshotTemplates = require('../server/snapshot/templates');
const research = require('../server/snapshot/research');
const snapshotFactions = require('../server/snapshot/factions');
const rawSnapshot = require('../server/snapshot/rawSnapshot');

const format = require('../server/briefing/format');
const roster = require('../server/briefing/roster');
const readers = require('../server/briefing/readers');
const { buildExecutiveSitrep } = require('../server/briefing/sitrep');
const { buildTheaterStatus } = require('../server/earthTheater');
const directives = require('../server/directives');

function methodNames(instance) {
  return Object.getOwnPropertyNames(Object.getPrototypeOf(instance))
    .filter(name => name !== 'constructor')
    .sort();
}

test('snapshotBuilder keeps its full method surface after the split', () => {
  assert.deepStrictEqual(methodNames(snapshotBuilder), [
    'buildMissionSpecs',
    'buildRawSnapshot',
    'buildShipHullStats',
    'buildTechTree',
    'buildTraitStatMods',
    'buildWeaponLoadout',
    'classifyHabModule',
    'completionPercent',
    'dateValueToIso',
    'daysRemainingForStatus',
    'firstNumericOrNull',
    'formatWeaponSummary',
    'getCollection',
    'getDominantWeaponType',
    'getFactionColor',
    'habModuleResearchIncome',
    'lastFiniteNumber',
    'medianArmor',
    'moduleConstructionStatus',
    'normalizeArmor',
    'normalizeFactionIntelligence',
    'normalizeResourceCosts',
    'normalizedScore',
    'readShipCombatPower',
    'readSiteResourceRates',
    'registerShipModuleRefs',
    'resolveFactionName',
    'resolveFleetDestination',
    'resolveOrbitBody',
    'resolveOrbitBodyDistanceAU',
    'resolveOrbitBodyId',
    'resolveShipModule',
    'roundNumber',
    'roundResourceMap',
    'scaleResourceMap',
    'sumOrNull',
    'summarizeRecentTransactions',
    'summarizeWeaponCounts'
  ]);
});

test('snapshotBuilder methods are the domain modules own functions, not wrappers', () => {
  assert.strictEqual(snapshotBuilder.buildRawSnapshot, rawSnapshot.buildRawSnapshot);
  assert.strictEqual(snapshotBuilder.roundNumber, numbers.roundNumber);
  assert.strictEqual(snapshotBuilder.sumOrNull, numbers.sumOrNull);
  assert.strictEqual(snapshotBuilder.completionPercent, numbers.completionPercent);
  assert.strictEqual(snapshotBuilder.normalizedScore, numbers.normalizedScore);
  assert.strictEqual(snapshotBuilder.lastFiniteNumber, numbers.lastFiniteNumber);
  assert.strictEqual(snapshotBuilder.getCollection, lookups.getCollection);
  assert.strictEqual(snapshotBuilder.resolveFactionName, lookups.resolveFactionName);
  assert.strictEqual(snapshotBuilder.readSiteResourceRates, space.readSiteResourceRates);
  assert.strictEqual(snapshotBuilder.medianArmor, space.medianArmor);
  assert.strictEqual(snapshotBuilder.buildMissionSpecs, snapshotTemplates.buildMissionSpecs);
  assert.strictEqual(snapshotBuilder.buildShipHullStats, snapshotTemplates.buildShipHullStats);
  assert.strictEqual(snapshotBuilder.buildTraitStatMods, snapshotTemplates.buildTraitStatMods);
  assert.strictEqual(snapshotBuilder.buildTechTree, research.buildTechTree);
  assert.strictEqual(snapshotBuilder.normalizeFactionIntelligence, snapshotFactions.normalizeFactionIntelligence);
});

test('briefingGenerator keeps its full method surface after the split', () => {
  assert.deepStrictEqual(methodNames(briefingGenerator), [
    'asArray',
    'attachHateEstimate',
    'buildAdvisableHabs',
    'buildCouncilDirectives',
    'buildExecutiveSitrep',
    'buildGeopoliticalDirectives',
    'buildHoldGroundDirective',
    'buildOperativeRoster',
    'buildResearchDirectives',
    'buildSpaceDirectives',
    'buildTheaterStatus',
    'eligibleOperatives',
    'firstAvailableNumber',
    'formatCount',
    'formatFactionGdp',
    'formatNumber',
    'formatPower',
    'formatResourceSummary',
    'formatTargetGdp',
    'generateMissionControlBriefing',
    'getControlledNationData',
    'getFleetCombatPower',
    'getMiningRateSummary',
    'getResearchSlots',
    'getResourceSnapshot',
    'getTopSkillString',
    'isFilteredDataAvailable',
    'isIdleCouncilor',
    'isOwnCouncilor',
    'readObserverHateTrend',
    'sameId',
    'toFiniteNumber',
    'visibleSkill'
  ]);
});

test('briefingGenerator methods are the domain modules own functions, not wrappers', () => {
  assert.strictEqual(briefingGenerator.buildExecutiveSitrep, buildExecutiveSitrep);
  assert.strictEqual(briefingGenerator.buildTheaterStatus, buildTheaterStatus);
  assert.strictEqual(briefingGenerator.buildOperativeRoster, roster.buildOperativeRoster);
  assert.strictEqual(briefingGenerator.eligibleOperatives, roster.eligibleOperatives);
  assert.strictEqual(briefingGenerator.visibleSkill, roster.visibleSkill);
  assert.strictEqual(briefingGenerator.buildAdvisableHabs, readers.buildAdvisableHabs);
  assert.strictEqual(briefingGenerator.readObserverHateTrend, readers.readObserverHateTrend);
  assert.strictEqual(briefingGenerator.getControlledNationData, readers.getControlledNationData);
  assert.strictEqual(briefingGenerator.attachHateEstimate, directives.attachHateEstimate);
  assert.strictEqual(briefingGenerator.buildHoldGroundDirective, directives.buildHoldGroundDirective);
  assert.strictEqual(briefingGenerator.buildGeopoliticalDirectives, directives.buildGeopoliticalDirectives);
  assert.strictEqual(briefingGenerator.buildCouncilDirectives, directives.buildCouncilDirectives);
  assert.strictEqual(briefingGenerator.buildSpaceDirectives, directives.buildSpaceDirectives);
  assert.strictEqual(briefingGenerator.formatNumber, format.formatNumber);
  assert.strictEqual(briefingGenerator.toFiniteNumber, format.toFiniteNumber);
  assert.strictEqual(briefingGenerator.sameId, format.sameId);

  // The ONE deliberate wrapper: the research ladder is the only builder that
  // reads configuration, so the method forwards `this.config` and is therefore
  // not the module's own function. Its output must still match the module
  // called with that same config.
  assert.notStrictEqual(briefingGenerator.buildResearchDirectives, directives.buildResearchDirectives);
  const slots = [{ slotNumber: 1, displayName: 'Test Tech', percent: 40, leadFactionName: 'the Initiative', leadFactionId: 4712 }];
  assert.deepStrictEqual(
    briefingGenerator.buildResearchDirectives(slots, { ID: 4712, displayName: 'the Initiative' }, {}, {}),
    directives.buildResearchDirectives(slots, { ID: 4712, displayName: 'the Initiative' }, {}, {}, briefingGenerator.config)
  );
});

test('the Earth theater table stays separate from the space theater table', () => {
  // Two different partitions of the world: server/spaceTheater.js maps
  // solar-system bodies into orbital theaters, server/earthTheater.js maps
  // Earth nations into geopolitical ones. Merging them would make
  // `theaterForBody('France')` look answerable.
  const spaceTheater = require('../server/spaceTheater');
  const { EARTH_THEATERS } = require('../server/earthTheater');

  const spaceKeys = new Set(spaceTheater.THEATERS.map(t => t.key));
  const earthIds = new Set(EARTH_THEATERS.map(t => t.id));
  for (const id of earthIds) assert.ok(!spaceKeys.has(id), `theater id ${id} collides across the two tables`);

  const spaceBodies = new Set(spaceTheater.THEATERS.flatMap(t => t.bodies));
  for (const theater of EARTH_THEATERS) {
    for (const nation of theater.nations) {
      assert.ok(!spaceBodies.has(nation.toLowerCase()), `${nation} is in both tables`);
    }
  }
});
