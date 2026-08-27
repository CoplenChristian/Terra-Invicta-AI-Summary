// tests/engineMilitaryWorld.test.js
//
// The military read-model the directive engine could not see before.
//
// WHY THESE EXIST
// ---------------
// `server/engine/military.js` builds the `world.military` block: the shared
// theater board, the observer's own shipyards, the (body, hull) build options
// those yards can field, and the alien-hate reading. Grep the engine for
// `arrivals` / `shipyard` / `incoming` / `hostileShips` before this file and
// you find zero -- the component that answers "what should I do this cycle"
// had no view of an inbound alien fleet. This file owns the read-model's shape
// and its honesty rules.
//
// The fixtures are the committed filtered snapshots (`tests/fixtures/
// snapshot-{player,omniscient}-intel.json`, captured for observer 4712). They
// carry 14 of the observer's own shipyards (3 SpaceDock, 11 Shipyard), the 28
// hulls in `shipHullStats`, and a redacted-vs-raw hate reading that differs by
// mode -- exactly the two code paths this module must not collapse.
//
// THE TRAP, TESTED DELIBERATELY
// -----------------------------
// `habTier` on a shipyardStation row is the HAB's tier, not the module's. In
// the committed fixture the two happen to agree, so an assertion against the
// fixture alone could not tell a correct module-tier resolution from one that
// (wrongly) read `habTier`. The test below builds a hand-made snapshot whose
// hab tier is deliberately different from the module tier and asserts the
// MODULE tier wins. See the DELIBERATE-BREAK note at the bottom.
// 
// WHERE THE EXPECTED VALUES COME FROM
// -----------------------------------
// The count of the observer's own yards comes from the fixture's own station
// list; the theater count and the hostile-movement state from the shared board
// on that same fixture. Nothing here was captured from the code under test.
//
// THE FIXTURE / LIVE SPLIT
// ------------------------
// `shipConstructionSpeed` and `shipConstructionTimeEffects` were added to
// `server/snapshot/factions.js` after the fixtures were derived, so the
// committed fixture carries no measured build modifier and refusing every
// (body, hull) is the only honest answer on it. This file asserts that
// refusal path. The positive assertion — `buildOptions.length > 0` with a
// finite positive `fastestDays` — lives in `tests/live/militaryWorld.live
// .test.js` and runs against the current save via `npm run test:live`.

const { test } = require('node:test');
const assert = require('node:assert');

const {
  buildMilitaryWorld,
  resolveModuleTier,
  MODULE_TIER_SOURCE_TABLE,
  MODULE_TIER_SOURCE_UNKNOWN
} = require('../server/engine/military');
const { buildWorld } = require('../server/directiveEngine');
const {
  loadFixtureFilteredSnapshot
} = require('./fixtures/frozenSnapshots');
const { SHIP_CONSTRUCTION_MODULES } = require('../shared/shipBuildTime.mjs');
const { ALIEN_HATE_WAR_THRESHOLD } = require('../shared/alienHateEconomics.mjs');

const OBSERVER = 4712;
const RIVAL = 4717;

function snapshotWithYards(overrides = {}) {
  return {
    observerFactionId: OBSERVER,
    metadata: { gameTimeString: '5/1/2033 12:00:00 AM' },
    factions: [
      // An EMPTY effect list is a genuine reading of x1.0; the campaign speed
      // setting gives the build-time formula the other half of the faction
      // modifier, so the hand-built snapshot below can actually produce a
      // measured days-to-build rather than refusing for want of inputs.
      { ID: OBSERVER, displayName: 'the Initiative', shipConstructionTimeEffects: [] },
      { ID: RIVAL, displayName: 'the Aliens' }
    ],
    campaignSettings: {
      shipConstructionSpeed: { Player: 2, HumanAI: 2, Alien: 2 }
    },
    shipHullStats: {
      Frigate: { baseConstructionTimeDays: 120, constructionTier: 1 },
      Dreadnought: { baseConstructionTimeDays: 300, constructionTier: 3 },
      STOFighter: { baseConstructionTimeDays: 30, constructionTier: 1 }
    },
    shipyardStations: [
      // The observer's own yard, with a hab tier that deliberately differs from
      // the module tier, so a correct module-tier resolution is distinguishable
      // from one that (wrongly) reaches for `habTier`.
      {
        id: 1,
        templateName: 'Shipyard',
        factionId: OBSERVER,
        factionName: 'the Initiative',
        habName: 'Base One',
        habTier: 5,
        orbitBody: 'Mars',
        spaceTheaterKey: 'inner',
        spaceTheaterName: 'INNER / MARS',
        isShipyard: true
      },
      // A rival's yard must never appear in the observer's list.
      {
        id: 2,
        templateName: 'Spaceworks',
        factionId: RIVAL,
        factionName: 'the Aliens',
        habName: 'Alien Yard',
        habTier: 9,
        orbitBody: 'Jupiter',
        spaceTheaterKey: 'outer',
        spaceTheaterName: 'OUTER / JUPITER',
        isShipyard: true
      },
      // A yard whose template name is not a known ship-construction module:
      // unknown, not tier 1.
      {
        id: 3,
        templateName: 'HydroponicsFarm',
        factionId: OBSERVER,
        factionName: 'the Initiative',
        habName: 'Base Two',
        habTier: 3,
        orbitBody: 'Luna',
        spaceTheaterKey: 'inner',
        spaceTheaterName: 'INNER / LUNA',
        isShipyard: false
      }
    ],
    ...overrides
  };
}

// -- Shape: both modes --------------------------------------------------------

test('buildMilitaryWorld reports the theater board in both modes', () => {
  for (const mode of ['player', 'omniscient']) {
    const snapshot = loadFixtureFilteredSnapshot({ mode });
    const world = buildMilitaryWorld(snapshot, OBSERVER);

    assert.equal(world.available, true, mode);
    assert.equal(world.unavailableReason, null, mode);
    assert.ok(Array.isArray(world.theaters), mode);
    assert.equal(world.theaters.length, 12, mode);
    assert.equal(world.hostileMovement.state, 'INBOUND_TO_TRACKED_THEATER', mode);
    assert.equal(world.hostileMovement.reconciles, true, mode);
  }
});

test('shipyards lists ONLY the observer yards, shaped by contract', () => {
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'omniscient' });
  const world = buildMilitaryWorld(snapshot, OBSERVER);
  const observerYards = (snapshot.shipyardStations || []).filter(st => String(st.factionId) === String(OBSERVER));

  assert.equal(world.shipyards.length, observerYards.length);
  assert.ok(world.shipyards.length > 0);
  for (const yard of world.shipyards) {
    for (const key of ['id', 'habName', 'orbitBody', 'spaceTheaterKey', 'spaceTheaterName', 'templateName']) {
      assert.ok(key in yard, `missing ${key}`);
    }
    assert.ok('moduleTier' in yard && 'moduleTierSource' in yard, 'moduleTier keys present');
  }
});

// -- The trap: module tier comes from the template, never from habTier --------

test('module tier resolves from templateName, never from habTier', () => {
  const snapshot = snapshotWithYards();
  const world = buildMilitaryWorld(snapshot, OBSERVER);

  const own = world.shipyards.find(y => y.id === 1);
  assert.equal(own.templateName, 'Shipyard');
  // habTier on the row is 5; the module tier is 2. The module tier must win.
  assert.equal(own.moduleTier, SHIP_CONSTRUCTION_MODULES.Shipyard.tier);
  assert.equal(own.moduleTier, 2);
  assert.equal(own.moduleTierSource, MODULE_TIER_SOURCE_TABLE);

  const unknown = world.shipyards.find(y => y.id === 3);
  assert.equal(unknown.moduleTier, null);
  assert.equal(unknown.moduleTierSource, MODULE_TIER_SOURCE_UNKNOWN);
});

test('a rival yard never leaks into the observer shipyard list', () => {
  const snapshot = snapshotWithYards();
  const world = buildMilitaryWorld(snapshot, OBSERVER);
  assert.equal(world.shipyards.some(y => y.id === 2), false);
  assert.equal(world.shipyards.every(y => String(y.factionId) === String(OBSERVER)), true);
});

// -- Build options and refusals ----------------------------------------------

test('committed fixture: unmeasured build time is a refusal with a named reason, not a fabricated option', () => {
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'omniscient' });
  const world = buildMilitaryWorld(snapshot, OBSERVER);
  // The committed fixture's observer faction carries neither
  // `shipConstructionSpeed` nor `shipConstructionTimeEffects` -- both were added
  // to `server/snapshot/factions.js` after the fixture was derived. With no
  // measured faction build modifier, refusing every (body, hull) is the only
  // honest answer. Producing a row with a guessed `fastestDays` would be the
  // bug this rule exists to prevent. The live test (`tests/live/militaryWorld
  // .live.test.js`) carries the positive assertion against the current save.
  assert.equal(world.buildOptions.length, 0,
    'the committed fixture must not produce a measured build option');
  assert.ok(world.buildRefusals.length > 0, 'every refusal must still be a row');
  const reasons = new Set();
  for (const refusal of world.buildRefusals) {
    assert.ok(refusal.body, 'refusal body');
    assert.ok(refusal.hullName, 'refusal hull');
    assert.equal(typeof refusal.reason, 'string');
    assert.ok(refusal.reason.length > 0,
      `refusal reason for ${refusal.body}/${refusal.hullName} must not be blank`);
    reasons.add(refusal.reason);
  }
  assert.ok(reasons.has('faction-build-modifier-unmeasured'),
    `expected the named reason to appear; got ${JSON.stringify([...reasons])}`);
});

test('a body with no yard the observer can build on produces refusals, not fabrications', () => {
  const snapshot = snapshotWithYards();
  const world = buildMilitaryWorld(snapshot, OBSERVER);
  // Frigate and Dreadnought are shipyard-buildable and the observer holds a
  // Shipyard on Mars, so those are options.
  assert.ok(world.buildOptions.some(o => o.body === 'Mars' && o.hullName === 'Frigate'));
  assert.ok(world.buildOptions.some(o => o.body === 'Mars' && o.hullName === 'Dreadnought'));
  // STOFighter is not shipyard-buildable: it is a refusal row, never a row with
  // a null day count and never "fast".
  const fighterRefusal = world.buildRefusals.find(r => r.hullName === 'STOFighter');
  assert.ok(fighterRefusal, 'STOFighter refusal exists');
  assert.equal(fighterRefusal.reason, 'hull-not-shipyard-buildable');
  assert.equal(world.buildOptions.some(o => o.hullName === 'STOFighter'), false);
});

test('an unmeasured build time is a refusal, not a zero or a default', () => {
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'omniscient' });
  const world = buildMilitaryWorld(snapshot, OBSERVER);
  const reasons = new Set(world.buildRefusals.map(r => r.reason));
  // The fixture has no queue/calibration inputs on the dummy hulls' yards, but
  // every refusal must carry an honest reason string -- never a null-day option.
  for (const refusal of world.buildRefusals) {
    assert.ok(refusal.body, 'refusal body');
    assert.ok(refusal.hullName, 'refusal hull');
    assert.equal(typeof refusal.reason, 'string');
    assert.ok(refusal.reason.length > 0);
  }
  assert.ok(reasons.size > 0);
});

// -- Hate: player mode is a different code path ---------------------------------

test('hate in player mode: actual null, redacted true, floor measured', () => {
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'player' });
  const world = buildMilitaryWorld(snapshot, OBSERVER);
  assert.equal(world.hate.actual, null);
  assert.equal(world.hate.redacted, true);
  assert.equal(world.hate.threshold, ALIEN_HATE_WAR_THRESHOLD);
  assert.equal(typeof world.hate.floor, 'number');
  assert.ok(Number.isFinite(world.hate.floor));
});

test('hate in omniscient mode: actual measured, redacted false', () => {
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'omniscient' });
  const world = buildMilitaryWorld(snapshot, OBSERVER);
  assert.equal(typeof world.hate.actual, 'number');
  assert.equal(world.hate.redacted, false);
  assert.equal(world.hate.threshold, ALIEN_HATE_WAR_THRESHOLD);
  assert.equal(typeof world.hate.floor, 'number');
});

test('hate.actual is never a confident zero in player mode', () => {
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'player' });
  const world = buildMilitaryWorld(snapshot, OBSERVER);
  // A redacted reading must be null (absent), never a confident zero -- the
  // `Number(null) === 0` failure mode this repo keeps re-fixing.
  assert.strictEqual(world.hate.actual, null);
  assert.notStrictEqual(world.hate.actual, 0);
});

// -- unavailable path ---------------------------------------------------------

test('a board that cannot be built reports unavailable, never mock content', () => {
  const throwing = new Proxy({}, {
    get() { throw new Error('boom'); }
  });
  const world = buildMilitaryWorld(throwing, OBSERVER);
  assert.equal(world.available, false);
  assert.ok(world.unavailableReason.includes('military-board-unavailable'));
  assert.equal(world.hostileMovement, null);
  assert.equal(world.theaters, null);
  assert.deepEqual(world.shipyards, []);
  assert.deepEqual(world.buildOptions, []);
  assert.deepEqual(world.buildRefusals, []);
  assert.equal(world.hate.redacted, true);
  assert.equal(world.hate.actual, null);
});

// -- wiring: buildWorld freezes the block -------------------------------------

test('buildWorld freezes the military block onto the world', () => {
  const military = buildMilitaryWorld(loadFixtureFilteredSnapshot({ mode: 'player' }), OBSERVER);
  const world = buildWorld({ observerId: OBSERVER, military });
  assert.strictEqual(world.military, military);
  assert.ok(Object.isFrozen(world));
  const without = buildWorld({ observerId: OBSERVER });
  assert.equal(without.military, null);
});

// -----------------------------------------------------------------------------
// DELIBERATE-BREAK CHECK, run 2026-08-26.
//
// In `server/engine/military.js`, `resolveModuleTier` was edited so an unknown
// template name defaulted to tier 1 instead of refusing:
//
//     -  if (!module) {
//     -    return { moduleTier: null, moduleTierSource: MODULE_TIER_SOURCE_UNKNOWN };
//     +  if (!module) {
//     +    return { moduleTier: 1, moduleTierSource: 'defaulted' };
//
// Result: "module tier resolves from templateName, never from habTier" went
// red on its own -- `unknown.moduleTier` was 1 instead of null. The edit was
// reverted and the suite is green again. Note which test did NOT move: the
// fixture-based shape tests, because the committed fixture's template names
// are all in the table -- the hand-built snapshot with the divergent hab tier
// and the unknown template is the only place the resolution is observable.
//
// A second break, in the hate block, run the same way: `buildHate` was edited
// so a redacted (null) actual became 0 instead of staying null:
//
//     -  const actual = toFiniteNumber(rawActual);
//     +  const actual = toFiniteNumber(rawActual) ?? 0;
//
// Result: "hate in player mode: actual null, redacted true, floor measured"
// and "hate.actual is never a confident zero in player mode" both went red.
// The edit was reverted and the suite is green again. A withheld hate reading
// must stay null with `redacted: true`, never become a confident zero.