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

// ---------------------------------------------------------------------------
// The 2026-08-20 review's remaining section-D cluster: the two runtime entry
// points and the publish script. Same invariant as above -- the original path
// stays the public surface and re-exports the SAME function objects.
// ---------------------------------------------------------------------------

test('the publisher keeps its exported surface and re-exports its stage modules', () => {
  const publisher = require('../scripts/push_latest_to_supabase');
  const options = require('../scripts/publish/options');
  const techGraph = require('../scripts/publish/techGraph');

  assert.deepStrictEqual(Object.keys(publisher).sort(), [
    'applyTechTreeMode',
    'main',
    'parseArgs',
    'techGraphFingerprint',
    'usage'
  ]);

  // Same objects, not re-implementations. tests/publisherArgs.test.js exercises
  // these through the original path, so a wrapper there would keep passing
  // while the stage module drifted underneath it.
  assert.strictEqual(publisher.parseArgs, options.parseArgs);
  assert.strictEqual(publisher.usage, options.usage);
  assert.strictEqual(publisher.applyTechTreeMode, techGraph.applyTechTreeMode);
  assert.strictEqual(publisher.techGraphFingerprint, techGraph.techGraphFingerprint);
  assert.strictEqual(typeof publisher.main, 'function');
});

test('only the publisher stage that writes reads the service role key', () => {
  const fs = require('fs');
  const path = require('path');
  const publishDir = path.join(__dirname, '..', 'scripts', 'publish');
  const stripComments = (source) => source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  const readers = fs.readdirSync(publishDir).filter(name => name.endsWith('.js'));
  assert.ok(readers.length >= 4, 'the publisher was split into stages');

  const usesServiceRole = readers.filter(name => stripComments(
    fs.readFileSync(path.join(publishDir, name), 'utf8')
  ).includes('SERVICE_ROLE'));

  // CLAUDE.md: SUPABASE_SERVICE_ROLE_KEY is local-only. Keeping it to the one
  // stage that performs writes means the parse, row-building and option stages
  // can be reused or tested without ever touching it.
  assert.deepStrictEqual(usesServiceRole, ['supabaseWriter.js']);
});

test('the local server keeps its HTTP layer behind server/index.js', () => {
  const app = require('../server');
  assert.equal(typeof app.listen, 'function', 'server/index.js still exports the Express app');

  // The cache is the only mutable state in the HTTP layer, and its three
  // consumers (snapshot routes, intel routes, strategic-delta) must all reach
  // it through the same module instance -- two copies would serve two different
  // parsed saves from one process.
  const snapshotCache = require('../server/http/snapshotCache');
  assert.deepStrictEqual(Object.keys(snapshotCache).sort(), [
    'buildFilteredSnapshot',
    'getPreviousRawSnapshot',
    'loadOrGetSnapshot',
    'resetCache'
  ]);
  assert.strictEqual(require('../server/http/snapshotCache'), snapshotCache, 'the cache module is a singleton');
});

test('every bundled worker module is a sibling the build copies and rewrites', () => {
  const fs = require('fs');
  const path = require('path');
  const workerDir = path.join(__dirname, '..', 'site', 'worker');
  const modules = fs.readdirSync(workerDir).filter(name => name.endsWith('.js'));
  assert.ok(modules.includes('index.js'), 'the entry point is present');
  assert.ok(modules.length >= 6, 'the worker was split into siblings');

  for (const name of modules) {
    const source = fs.readFileSync(path.join(workerDir, name), 'utf8');
    for (const match of source.matchAll(/from '([^']+)'/g)) {
      const specifier = match[1];
      // Only two shapes survive the build's flat copy plus its
      // `../shared/` -> `./shared/` rewrite. A deeper relative path would
      // resolve here and fail at request time in production.
      assert.ok(
        specifier.startsWith('./') || specifier.startsWith('../shared/'),
        `${name} imports '${specifier}', which the hosted build cannot resolve`
      );
      assert.ok(!specifier.startsWith('../../'), `${name} reaches above site/worker/`);
    }
  }
});
