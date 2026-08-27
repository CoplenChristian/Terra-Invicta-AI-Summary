// Days-to-build: the formula, and the refusals that stop it guessing.
//
// WHAT THESE TESTS DEFEND
// -----------------------
// `docs/cross-aware-advisor-spec.md` needs "build X before they arrive", which
// is a race between two clocks. This file owns the second one. Three facts
// shape every assertion, and each is a reading rather than a convention:
//
//   1. THE FORMULA IS A TIER GAP, NOT A FLAT SCALE. `constructionTimeModifier`
//      is raised to `shipyardTier - hullConsTier` when the yard is oversized,
//      and a SEPARATE global constant 1.5 is raised to the shortfall when it is
//      undersized. Reading the field name as a plain multiplier gets a
//      Dreadnought at a Space Dock wrong by 2.25x, in the direction that says
//      "yes, build it" when the answer is no.
//   2. THE FACTION MULTIPLIER IS TWO TERMS, and one of them is a CAMPAIGN
//      SETTING, not research. `1 / scenarioCustomizations.shipConstructionSpeed`
//      runs at 0.5 on the live campaign, so treating an unread setting as 1.0
//      doubles every estimate. It is refused, never defaulted.
//   3. `daysToCompletion` ON AN UNPAID QUEUE ENTRY IS THE FULL DURATION.
//      `ShipConstructionQueueItem` seeds it from `resourcesCost.
//      completionTime_days` and counts it down only once the cost is paid, so
//      the waiting entries are the save's own statement of the answer.
//
// WHERE THE EXPECTED NUMBERS COME FROM
// ------------------------------------
// `LIVE_QUEUE_ROWS` below is the SAVE'S OWN `daysToCompletion` for all 14
// waiting queue entries on CombatAutosave.gz (12/18/2041), captured 2026-08-26
// alongside the inputs each row needs. Not one figure in it was produced by the
// code under test -- a fixture taken from post-change output passes by
// construction, and this one would have failed against the wrong formula. The
// two faction inputs were read straight out of the save:
// `TIGlobalValuesState.scenarioCustomizations.shipConstructionSpeedPlayer /
// HumanAI / Alien` are all 2, and each faction's effect list is
// `TIEffectsState.factionEffectsNames[].Value.ShipConstructionTime`.
//
// DELIBERATE-BREAK CHECK, run 2026-08-26
// --------------------------------------
// The absent-input discipline was verified by breaking it, not by assuming the
// tests covered it. In `shared/shipBuildTime.mjs`, `estimateShipBuildDays` was
// edited so an unmeasured faction modifier defaulted to zero instead of
// refusing:
//
//     -  if (modifier === null) return refusal(SHIP_BUILD_REFUSALS.factionModifierUnmeasured, inputs, ...);
//     +  const brokenModifier = modifier === null ? 0 : modifier;
//
// Result: 4 of 46 tests went red --
//   "refuses when the faction modifier is unavailable"
//   "an unread faction modifier yields a LABELLED unmodified upper bound, never
//    the answer"
//   "refuses for a faction with no waiting queue entries to calibrate from"
//   "PLAYER MODE: no waiting queue entries are visible, so it refuses rather
//    than guessing"
// -- each because the refusal became `available: true, days: 0, daysExact: 0,
// reason: null`. The edit was reverted and the suite is green again. A zero
// build time is the single most dangerous value this module could emit: it
// wins every race it is entered into.
//
// Note which test did NOT move: "refuses rather than defaulting when the speed
// setting is unread" stayed green, because it exercises
// `factionShipBuildModifier` and the break was one layer up in
// `estimateShipBuildDays`. That is the point of breaking it rather than
// assuming -- the coverage is not where a reading of the test names suggests.
//
// A second, narrower break was run the same way: `hullNameForDesign` was
// changed back to returning the FIRST `_displayName` match instead of requiring
// uniqueness, and "an ambiguous display name resolves to nothing, not to the
// first match" went red on its own.
//
// DELIBERATE-BREAK CHECK for the REDACTION path, run 2026-08-26. In
// `shared/shipBuildTime.mjs`, `shipConstructionEffectsMultiplier` was edited so
// a null (redacted) effect list defaulted to x1.0 instead of refusing:
//
//     -  if (effectNames === null || effectNames === undefined) {
//     -    return { available: false, ... reason: 'ship-construction-effects-not-read' };
//     +  if (effectNames === null || effectNames === undefined) {
//     +    return { available: true, value: 1, ... };
//
// Result: 2 of 49 tests went red --
//   "an empty effect list is a reading of x1.0; an absent one is not read at all"
//   "a faction whose effect list is redacted to null refuses rather than computing"
// -- the first because the null/[] distinction collapsed, the second because a
// redacted rival computed a confident 48-day build time from a speed the module
// was allowed to read and an effect list it was not. The edit was reverted and
// the suite is green again. A redacted rival's build time must come out REFUSED,
// never as a number assembled from half the inputs.

const { test } = require('node:test');
const assert = require('node:assert');

const {
  CALIBRATION_RELATIVE_TOLERANCE,
  NO_SHIPYARD_BUILD_HULLS,
  SHIP_BUILD_REFUSALS,
  SHIP_BUILD_TIME_SOURCES,
  SHIP_CONSTRUCTION_MODULES,
  SHIP_CONSTRUCTION_TIME_EFFECTS,
  SMALL_SHIPYARD_PENALTY_POWER_PER_TIER,
  buildBeatsArrival,
  calibrateFactionShipBuildModifier,
  calibrationRowsFromSnapshot,
  daysUntil,
  estimateShipBuildDays,
  factionShipBuildModifier,
  hullFromSnapshot,
  hullNameForDesign,
  resolveShipConstructionSpeed,
  shipBuildDaysFromSnapshot,
  shipConstructionEffectsMultiplier,
  shipyardFromSnapshot,
  shipyardTierFactor
} = require('../shared/shipBuildTime.mjs');
const { loadFixtureFilteredSnapshot } = require('./fixtures/frozenSnapshots');

// -- The save's own statement of the answer -----------------------------------
// CombatAutosave.gz, campaign date 12/18/2041, read 2026-08-26. Every waiting
// (costPaid: false) queue entry on the save, with the inputs it needs.
const LIVE_SHIP_CONSTRUCTION_SPEED = 2;
const LIVE_QUEUE_ROWS = Object.freeze([
  { faction: 'the Resistance', hull: 'Frigate', base: 120, consTier: 1, yard: 'Shipyard', effects: ['Effect_ShipConstructionTimeReduction5', 'Effect_ShipConstructionTimeReduction'], observedDays: 36.48 },
  { faction: 'the Resistance', hull: 'Frigate', base: 120, consTier: 1, yard: 'Shipyard', effects: ['Effect_ShipConstructionTimeReduction5', 'Effect_ShipConstructionTimeReduction'], observedDays: 36.48 },
  { faction: 'Humanity First', hull: 'Dreadnought', base: 240, consTier: 3, yard: 'SpaceDock', effects: ['Effect_ShipConstructionTimeReduction'], observedDays: 216 },
  { faction: 'Humanity First', hull: 'Destroyer', base: 135, consTier: 2, yard: 'Spaceworks', effects: ['Effect_ShipConstructionTimeReduction'], observedDays: 32.4 },
  { faction: 'Humanity First', hull: 'Cruiser', base: 180, consTier: 2, yard: 'Shipyard', effects: ['Effect_ShipConstructionTimeReduction'], observedDays: 72 },
  { faction: 'Humanity First', hull: 'Destroyer', base: 135, consTier: 2, yard: 'Shipyard', effects: ['Effect_ShipConstructionTimeReduction'], observedDays: 54 },
  { faction: 'Project Exodus', hull: 'Monitor', base: 120, consTier: 2, yard: 'Spaceworks', effects: ['Effect_ShipConstructionTimeReduction5', 'Effect_ShipConstructionTimeReduction'], observedDays: 27.36 },
  { faction: 'the Aliens', hull: 'AlienFrigate', base: 128, consTier: 1, yard: 'AlienSpaceworks', effects: ['Effect_ShipConstructionTimeReduction'], observedDays: 12.8 },
  { faction: 'the Aliens', hull: 'AlienMonitor', base: 256, consTier: 2, yard: 'AlienSpaceworks', effects: ['Effect_ShipConstructionTimeReduction'], observedDays: 51.2 },
  { faction: 'the Aliens', hull: 'AlienMonitor', base: 256, consTier: 2, yard: 'AlienSpaceworks', effects: ['Effect_ShipConstructionTimeReduction'], observedDays: 51.2 },
  { faction: 'the Aliens', hull: 'AlienLancer', base: 360, consTier: 2, yard: 'AlienSpaceworks', effects: ['Effect_ShipConstructionTimeReduction'], observedDays: 72 },
  { faction: 'the Aliens', hull: 'AlienDreadnought', base: 480, consTier: 2, yard: 'AlienSpaceworks', effects: ['Effect_ShipConstructionTimeReduction'], observedDays: 96 },
  { faction: 'the Aliens', hull: 'AlienEscort', base: 96, consTier: 1, yard: 'AlienSpaceworks', effects: ['Effect_ShipConstructionTimeReduction'], observedDays: 9.6 },
  { faction: 'the Aliens', hull: 'AlienMonitor', base: 256, consTier: 2, yard: 'AlienSpaceworks', effects: ['Effect_ShipConstructionTimeReduction'], observedDays: 51.2 }
]);

const hullOf = row => ({ name: row.hull, baseConstructionTimeDays: row.base, constructionTier: row.consTier });
const yardOf = row => ({ templateName: row.yard });
const predict = row => estimateShipBuildDays({
  hull: hullOf(row),
  shipyard: yardOf(row),
  factionModifier: factionShipBuildModifier({
    shipConstructionSpeed: LIVE_SHIP_CONSTRUCTION_SPEED,
    effectNames: row.effects
  })
});

// -- The template constants ---------------------------------------------------

test('the six ship construction modules carry the tier and modifier the templates state', () => {
  // TIHabModuleTemplate.json, allowsShipConstruction: true, read 2026-08-26.
  assert.deepStrictEqual(Object.keys(SHIP_CONSTRUCTION_MODULES).sort(), [
    'AlienShipyard', 'AlienSpacedock', 'AlienSpaceworks', 'Shipyard', 'SpaceDock', 'Spaceworks'
  ]);
  assert.deepStrictEqual(SHIP_CONSTRUCTION_MODULES.SpaceDock, { tier: 1, constructionTimeModifier: 1, alien: false });
  assert.deepStrictEqual(SHIP_CONSTRUCTION_MODULES.Shipyard, { tier: 2, constructionTimeModifier: 0.8, alien: false });
  assert.deepStrictEqual(SHIP_CONSTRUCTION_MODULES.Spaceworks, { tier: 3, constructionTimeModifier: 0.6, alien: false });
  // The alien ladder is NOT a copy of the human one: tier 2 is 0.75 not 0.8 and
  // tier 3 is 0.5 not 0.6, so reusing the human table understates alien output.
  assert.strictEqual(SHIP_CONSTRUCTION_MODULES.AlienShipyard.constructionTimeModifier, 0.75);
  assert.strictEqual(SHIP_CONSTRUCTION_MODULES.AlienSpaceworks.constructionTimeModifier, 0.5);
});

test('the undersized-yard penalty base is the global constant, not the yard modifier', () => {
  assert.strictEqual(SMALL_SHIPYARD_PENALTY_POWER_PER_TIER, 1.5);
});

test('the effect table holds exactly the four ShipConstructionTime effects', () => {
  assert.deepStrictEqual(SHIP_CONSTRUCTION_TIME_EFFECTS, {
    Effect_ShipConstructionTimeReduction: 0.8,
    Effect_ShipConstructionTimeReduction10: 0.9,
    Effect_ShipConstructionTimeReduction5: 0.95,
    Effect_ShipConstructionTimeReductionMinor: 0.9875
  });
});

test('the result cites its sources with dates', () => {
  assert.strictEqual(SHIP_BUILD_TIME_SOURCES.wiki.revision, '2026-05-07T19:37:58Z');
  assert.ok(SHIP_BUILD_TIME_SOURCES.gameCode.types.some(t => t.startsWith('TIShipHullTemplate.constructionTime_Days')));
  assert.strictEqual(SHIP_BUILD_TIME_SOURCES.liveCrossCheck.rowsReproduced, LIVE_QUEUE_ROWS.length);
});

// -- The tier-gap branches ----------------------------------------------------

test('an oversized yard raises its own modifier to the tier gap', () => {
  // Frigate (consTier 1) at a Shipyard (tier 2): gap +1, 0.8^1.
  const one = shipyardTierFactor({ shipyardTier: 2, constructionTimeModifier: 0.8, hullConstructionTier: 1 });
  assert.strictEqual(one.available, true);
  assert.strictEqual(one.tierGap, 1);
  assert.strictEqual(one.factor, 0.8);
  // AlienEscort (consTier 1) at an AlienSpaceworks (tier 3): gap +2, 0.5^2.
  const two = shipyardTierFactor({ shipyardTier: 3, constructionTimeModifier: 0.5, hullConstructionTier: 1 });
  assert.strictEqual(two.tierGap, 2);
  assert.strictEqual(two.factor, 0.25);
});

test('a matched yard applies no factor at all', () => {
  const matched = shipyardTierFactor({ shipyardTier: 2, constructionTimeModifier: 0.8, hullConstructionTier: 2 });
  assert.strictEqual(matched.factor, 1);
  assert.strictEqual(matched.tierGap, 0);
  assert.strictEqual(matched.basis, 'tier-match');
});

test('an undersized yard is penalised by 1.5 per tier, NOT by its own modifier', () => {
  // Dreadnought (consTier 3) at a Space Dock (tier 1): gap -2, 1.5^2 = 2.25.
  // The Space Dock's own modifier is 1.0; using it here would give 1.0 and cut
  // 324 days off the estimate.
  const under = shipyardTierFactor({ shipyardTier: 1, constructionTimeModifier: 1, hullConstructionTier: 3 });
  assert.strictEqual(under.tierGap, -2);
  assert.strictEqual(under.factor, 2.25);
  assert.strictEqual(under.basis, 'undersized-yard-penalty');
  // And it holds for a yard whose modifier is nowhere near 1.5.
  const spaceworks = shipyardTierFactor({ shipyardTier: 3, constructionTimeModifier: 0.6, hullConstructionTier: 4 });
  assert.strictEqual(spaceworks.factor, 1.5);
});

test('the undersized branch does not need the modifier, so an unread one is not fatal there', () => {
  const under = shipyardTierFactor({ shipyardTier: 1, constructionTimeModifier: null, hullConstructionTier: 3 });
  assert.strictEqual(under.available, true);
  assert.strictEqual(under.factor, 2.25);
});

// -- The live cross-check -----------------------------------------------------

test('reproduces all 14 waiting queue entries on the live save exactly', () => {
  const misses = [];
  for (const row of LIVE_QUEUE_ROWS) {
    const result = predict(row);
    if (!result.available || Math.abs(result.daysExact - row.observedDays) > 1e-9) {
      misses.push(`${row.faction} ${row.hull}@${row.yard}: got ${result.daysExact}, save says ${row.observedDays} (${result.reason ?? 'ok'})`);
    }
  }
  assert.deepStrictEqual(misses, []);
});

test('the hand-checkable case: an alien Dreadnought at an Alien Spaceworks', () => {
  // 480 base x 0.5 (tier 3 yard, consTier 2 hull, gap +1) x 0.5 (speed 2)
  //     x 0.8 (Effect_ShipConstructionTimeReduction) = 96 days exactly.
  const row = LIVE_QUEUE_ROWS.find(r => r.hull === 'AlienDreadnought');
  const result = predict(row);
  assert.strictEqual(result.daysExact, 96);
  assert.strictEqual(result.days, 96);
  assert.strictEqual(result.inputs.baseConstructionTimeDays, 480);
  assert.strictEqual(result.yardFactor.factor, 0.5);
  assert.strictEqual(result.factionModifier.settingsMultiplier, 0.5);
  assert.strictEqual(result.factionModifier.effects.value, 0.8);
  assert.strictEqual(result.factionModifier.value, 0.4);
});

test('the penalty case: a Dreadnought at a Space Dock takes 216 days, not 96', () => {
  // The save says 216. Reading constructionTimeModifier as a flat multiplier
  // would give 240 x 1.0 x 0.4 = 96 -- a 120-day error toward "build it".
  const row = LIVE_QUEUE_ROWS.find(r => r.hull === 'Dreadnought' && r.yard === 'SpaceDock');
  const result = predict(row);
  assert.strictEqual(result.daysExact, 216);
  assert.strictEqual(result.yardFactor.factor, 2.25);
  assert.strictEqual(result.yardFactor.tierGap, -2);
});

test('whole days round UP, and the exact value ships beside them', () => {
  const row = LIVE_QUEUE_ROWS[0];
  const result = predict(row);
  assert.strictEqual(result.daysExact, 36.480000000000004);
  assert.strictEqual(result.days, 37, 'a build finishing 36.48 days out is not finished on day 36');
});

test('every result carries the inputs beside the answer', () => {
  const result = predict(LIVE_QUEUE_ROWS[0]);
  assert.deepStrictEqual(result.inputs, {
    hullName: 'Frigate',
    baseConstructionTimeDays: 120,
    hullConstructionTier: 1,
    shipyardTemplateName: 'Shipyard',
    shipyardTier: 2,
    shipyardConstructionTimeModifier: 0.8,
    smallShipyardPenaltyPowerPerTier: 1.5
  });
});

test('the figure names the terms it excludes rather than pretending to be total', () => {
  const result = predict(LIVE_QUEUE_ROWS[0]);
  assert.deepStrictEqual(result.excludes.map(e => e.term), ['earth-materials-delivery', 'queue-wait']);
});

// -- Refusals -----------------------------------------------------------------

test('refuses a hull the game will not let a shipyard build', () => {
  assert.deepStrictEqual([...NO_SHIPYARD_BUILD_HULLS], ['STOFighter', 'SalamanderGunship']);
  for (const name of NO_SHIPYARD_BUILD_HULLS) {
    const result = estimateShipBuildDays({
      hull: { name, baseConstructionTimeDays: 60, constructionTier: 1 },
      shipyard: { templateName: 'Shipyard' },
      factionModifier: { available: true, value: 0.4 }
    });
    assert.strictEqual(result.available, false, `${name} must not be scored`);
    assert.strictEqual(result.reason, SHIP_BUILD_REFUSALS.hullNotShipyardBuildable);
    assert.strictEqual(result.days, null);
  }
});

test('an explicit noShipyardBuild flag beats the fallback list in both directions', () => {
  const buildable = estimateShipBuildDays({
    hull: { name: 'STOFighter', baseConstructionTimeDays: 60, constructionTier: 1, noShipyardBuild: false },
    shipyard: { templateName: 'Shipyard' },
    factionModifier: { available: true, value: 0.4 }
  });
  assert.strictEqual(buildable.available, true);
  const refused = estimateShipBuildDays({
    hull: { name: 'Frigate', baseConstructionTimeDays: 120, constructionTier: 1, noShipyardBuild: true },
    shipyard: { templateName: 'Shipyard' },
    factionModifier: { available: true, value: 0.4 }
  });
  assert.strictEqual(refused.reason, SHIP_BUILD_REFUSALS.hullNotShipyardBuildable);
});

test('refuses an unmeasured base construction time instead of calling it zero days', () => {
  for (const base of [null, undefined, '', '  ', [], {}, true, NaN]) {
    const result = estimateShipBuildDays({
      hull: { name: 'Frigate', baseConstructionTimeDays: base, constructionTier: 1 },
      shipyard: { templateName: 'Shipyard' },
      factionModifier: { available: true, value: 0.4 }
    });
    assert.strictEqual(result.available, false, `base ${JSON.stringify(base)} must refuse`);
    assert.strictEqual(result.reason, SHIP_BUILD_REFUSALS.hullBaseTimeUnmeasured);
    assert.strictEqual(result.days, null);
    assert.strictEqual(result.daysExact, null);
  }
});

test('refuses an unmeasured hull construction tier instead of treating it as tier 0', () => {
  const result = estimateShipBuildDays({
    hull: { name: 'Frigate', baseConstructionTimeDays: 120, constructionTier: null },
    shipyard: { templateName: 'Shipyard' },
    factionModifier: { available: true, value: 0.4 }
  });
  assert.strictEqual(result.reason, SHIP_BUILD_REFUSALS.hullTierUnmeasured);
  assert.strictEqual(result.days, null);
});

test('refuses a hab module that is not a ship construction module', () => {
  // A Nanofactory carries a constructionTimeModifier too -- it just does not
  // apply to ships. Falling back to "tier 1, modifier 1" for anything not in
  // the table would score a mining outpost as a shipyard.
  const result = estimateShipBuildDays({
    hull: { name: 'Frigate', baseConstructionTimeDays: 120, constructionTier: 1 },
    shipyard: { templateName: 'Nanofactory' },
    factionModifier: { available: true, value: 0.4 }
  });
  assert.strictEqual(result.available, false);
  assert.strictEqual(result.reason, SHIP_BUILD_REFUSALS.shipyardNotConstructionModule);
});

test('refuses an absent shipyard', () => {
  const result = estimateShipBuildDays({
    hull: { name: 'Frigate', baseConstructionTimeDays: 120, constructionTier: 1 },
    shipyard: null,
    factionModifier: { available: true, value: 0.4 }
  });
  assert.strictEqual(result.reason, SHIP_BUILD_REFUSALS.shipyardUnknown);
});

test('refuses an absent hull', () => {
  const result = estimateShipBuildDays({ hull: null, shipyard: { templateName: 'Shipyard' }, factionModifier: { available: true, value: 0.4 } });
  assert.strictEqual(result.reason, SHIP_BUILD_REFUSALS.hullUnknown);
});

test('refuses when the faction modifier is unavailable', () => {
  for (const modifier of [null, undefined, { available: false, value: null }, { available: false, value: 0.4 }, { available: true, value: null }]) {
    const result = estimateShipBuildDays({
      hull: { name: 'Frigate', baseConstructionTimeDays: 120, constructionTier: 1 },
      shipyard: { templateName: 'Shipyard' },
      factionModifier: modifier
    });
    assert.strictEqual(result.available, false, `modifier ${JSON.stringify(modifier)} must refuse`);
    assert.strictEqual(result.reason, SHIP_BUILD_REFUSALS.factionModifierUnmeasured);
    assert.strictEqual(result.days, null);
  }
});

test('an unread faction modifier yields a LABELLED unmodified upper bound, never the answer', () => {
  const result = estimateShipBuildDays({
    hull: { name: 'Frigate', baseConstructionTimeDays: 120, constructionTier: 1 },
    shipyard: { templateName: 'Shipyard' },
    factionModifier: { available: false, value: null, reason: 'ship-construction-speed-setting-not-read' }
  });
  // The refusal envelope is untouched: nothing downstream can mistake this for
  // a build time.
  assert.strictEqual(result.available, false);
  assert.strictEqual(result.days, null);
  assert.strictEqual(result.daysExact, null);
  // The template half is stated, with its caveat, so the reader can see the
  // scale of what is missing. 120 x 0.8 = 96 against a real 36.48 on the live
  // campaign -- 2.6x too long, which is exactly why it is not `days`.
  assert.strictEqual(result.unmodified.daysExact, 96);
  assert.strictEqual(result.unmodified.days, 96);
  assert.match(result.unmodified.caveat, /UNMODIFIED/);
  assert.match(result.unmodified.caveat, /upper bound/);
  // And it does not leak into the race.
  assert.strictEqual(buildBeatsArrival({ buildDays: result.days, daysUntilArrival: 120 }).available, false);
});

test('a refusal for any other reason carries no unmodified figure at all', () => {
  // A missing base time or an unknown yard leaves nothing template-grounded to
  // report, and inventing one would be worse than saying nothing.
  const noBase = estimateShipBuildDays({
    hull: { name: 'Frigate', baseConstructionTimeDays: null, constructionTier: 1 },
    shipyard: { templateName: 'Shipyard' },
    factionModifier: { available: true, value: 0.4 }
  });
  assert.strictEqual(noBase.unmodified, null);
  const badYard = estimateShipBuildDays({
    hull: { name: 'Frigate', baseConstructionTimeDays: 120, constructionTier: 1 },
    shipyard: { templateName: 'Nanofactory' },
    factionModifier: { available: true, value: 0.4 }
  });
  assert.strictEqual(badYard.unmodified, null);
});

test('an available answer carries no unmodified figure to be confused with it', () => {
  assert.strictEqual(predict(LIVE_QUEUE_ROWS[0]).unmodified, null);
});

// -- The faction multiplier ---------------------------------------------------

test('refuses rather than defaulting when the speed setting is unread', () => {
  const result = factionShipBuildModifier({ shipConstructionSpeed: null, effectNames: [] });
  assert.strictEqual(result.available, false);
  assert.strictEqual(result.value, null);
  assert.strictEqual(result.reason, 'ship-construction-speed-setting-not-read');
  // 1.0 is the class default in the game, but it is NOT what this campaign runs
  // and guessing it would double every estimate.
  assert.notStrictEqual(result.value, 1);
});

test('refuses a non-positive speed setting instead of dividing by it', () => {
  for (const speed of [0, -2]) {
    const result = factionShipBuildModifier({ shipConstructionSpeed: speed, effectNames: [] });
    assert.strictEqual(result.available, false);
    assert.strictEqual(result.reason, 'ship-construction-speed-setting-not-positive');
    assert.strictEqual(result.value, null, 'a zero speed must not become an infinite build');
  }
});

test('an empty effect list is a reading of x1.0; an absent one is not read at all', () => {
  const none = shipConstructionEffectsMultiplier([]);
  assert.strictEqual(none.available, true);
  assert.strictEqual(none.value, 1);

  const unread = shipConstructionEffectsMultiplier(null);
  assert.strictEqual(unread.available, false);
  assert.strictEqual(unread.value, null);
  assert.strictEqual(unread.reason, 'ship-construction-effects-not-read');
});

test('an unrecognised effect makes the product unknown rather than being skipped', () => {
  const result = shipConstructionEffectsMultiplier(['Effect_ShipConstructionTimeReduction', 'Effect_SomethingNewInAPatch']);
  assert.strictEqual(result.available, false);
  assert.strictEqual(result.value, null);
  assert.deepStrictEqual([...result.unrecognised], ['Effect_SomethingNewInAPatch']);
  assert.strictEqual(result.reason, 'ship-construction-effect-not-in-table');
});

test('effects multiply, and stack', () => {
  const stacked = shipConstructionEffectsMultiplier([
    'Effect_ShipConstructionTimeReduction',
    'Effect_ShipConstructionTimeReduction5'
  ]);
  assert.strictEqual(stacked.value, 0.76);
  const modifier = factionShipBuildModifier({ shipConstructionSpeed: 2, effectNames: ['Effect_ShipConstructionTimeReduction', 'Effect_ShipConstructionTimeReduction5'] });
  assert.strictEqual(modifier.value, 0.38);
  assert.strictEqual(modifier.settingsMultiplier, 0.5);
});

// -- Calibration --------------------------------------------------------------

test('calibration recovers the faction multiplier from waiting queue entries', () => {
  const rows = LIVE_QUEUE_ROWS
    .filter(row => row.faction === 'the Aliens')
    .map((row, index) => ({
      id: `alien-${index}`,
      observedDays: row.observedDays,
      baseConstructionTimeDays: row.base,
      hullConstructionTier: row.consTier,
      shipyardTier: SHIP_CONSTRUCTION_MODULES[row.yard].tier,
      constructionTimeModifier: SHIP_CONSTRUCTION_MODULES[row.yard].constructionTimeModifier
    }));
  const calibrated = calibrateFactionShipBuildModifier({ rows });
  assert.strictEqual(calibrated.available, true);
  assert.strictEqual(calibrated.rowsUsed, 7);
  // 1/2 (speed) x 0.8 (Effect_ShipConstructionTimeReduction) = 0.4, which is
  // what the save's own effect list and settings block independently say.
  assert.ok(Math.abs(calibrated.value - 0.4) < 1e-12, `got ${calibrated.value}`);
  assert.strictEqual(calibrated.basis, 'calibrated-from-queue');
});

test('a leave-one-out calibration predicts the held-out row', () => {
  const alien = LIVE_QUEUE_ROWS.filter(row => row.faction === 'the Aliens');
  for (let held = 0; held < alien.length; held += 1) {
    const rows = alien.filter((_, index) => index !== held).map((row, index) => ({
      id: `train-${index}`,
      observedDays: row.observedDays,
      baseConstructionTimeDays: row.base,
      hullConstructionTier: row.consTier,
      shipyardTier: SHIP_CONSTRUCTION_MODULES[row.yard].tier,
      constructionTimeModifier: SHIP_CONSTRUCTION_MODULES[row.yard].constructionTimeModifier
    }));
    const calibrated = calibrateFactionShipBuildModifier({ rows });
    const target = alien[held];
    const result = estimateShipBuildDays({ hull: hullOf(target), shipyard: yardOf(target), factionModifier: calibrated });
    assert.ok(
      Math.abs(result.daysExact - target.observedDays) < 1e-9,
      `held-out ${target.hull}: got ${result.daysExact}, save says ${target.observedDays}`
    );
  }
});

test('calibration refuses when its rows disagree, and never averages them', () => {
  const rows = [
    { id: 'a', observedDays: 96, baseConstructionTimeDays: 480, hullConstructionTier: 2, shipyardTier: 3, constructionTimeModifier: 0.5 },
    { id: 'b', observedDays: 72, baseConstructionTimeDays: 480, hullConstructionTier: 2, shipyardTier: 3, constructionTimeModifier: 0.5 }
  ];
  const calibrated = calibrateFactionShipBuildModifier({ rows });
  assert.strictEqual(calibrated.available, false);
  assert.strictEqual(calibrated.value, null);
  assert.strictEqual(calibrated.reason, 'calibration-rows-disagree');
  assert.deepStrictEqual({ min: calibrated.spread.min, max: calibrated.spread.max }, { min: 0.3, max: 0.4 });
});

test('the agreement window is relative, and narrower than the smallest real difference', () => {
  // The smallest ShipConstructionTime effect is x0.9875 -- a 1.25% step. The
  // window has to be well inside that or two different factions' multipliers
  // could be merged into one.
  assert.ok(CALIBRATION_RELATIVE_TOLERANCE < (1 - 0.9875) / 10);
  // A row contaminated by a short Earth delivery (the Protectorate's 0.0237-day
  // case on the committed fixture) still calibrates, at the MINIMUM.
  const rows = [
    { id: 'clean', observedDays: 38.4, baseConstructionTimeDays: 120, hullConstructionTier: 1, shipyardTier: 2, constructionTimeModifier: 0.8 },
    { id: 'delayed', observedDays: 120.0237, baseConstructionTimeDays: 200, hullConstructionTier: 3, shipyardTier: 2, constructionTimeModifier: 0.8 }
  ];
  const calibrated = calibrateFactionShipBuildModifier({ rows });
  assert.strictEqual(calibrated.available, true);
  assert.ok(Math.abs(calibrated.value - 0.4) < 1e-12, `got ${calibrated.value}`);
  assert.ok(calibrated.spread.max > calibrated.value, 'the contaminated row must still be visible in the spread');
});

test('refuses for a faction with no waiting queue entries to calibrate from', () => {
  const calibrated = calibrateFactionShipBuildModifier({ rows: [] });
  assert.strictEqual(calibrated.available, false);
  assert.strictEqual(calibrated.value, null);
  assert.strictEqual(calibrated.rowsUsed, 0);
  assert.strictEqual(calibrated.reason, 'no-full-duration-queue-rows-for-faction');
  // And the estimate built on it refuses too, rather than emitting a zero.
  const result = estimateShipBuildDays({
    hull: { name: 'Frigate', baseConstructionTimeDays: 120, constructionTier: 1 },
    shipyard: { templateName: 'Shipyard' },
    factionModifier: calibrated
  });
  assert.strictEqual(result.available, false);
  assert.strictEqual(result.days, null);
  assert.strictEqual(result.reason, SHIP_BUILD_REFUSALS.factionModifierUnmeasured);
});

test('a row with an unmeasured input is skipped, not folded in as a zero', () => {
  const rows = [
    { id: 'good', observedDays: 96, baseConstructionTimeDays: 480, hullConstructionTier: 2, shipyardTier: 3, constructionTimeModifier: 0.5 },
    { id: 'no-observation', observedDays: null, baseConstructionTimeDays: 480, hullConstructionTier: 2, shipyardTier: 3, constructionTimeModifier: 0.5 },
    { id: 'no-tier', observedDays: 96, baseConstructionTimeDays: 480, hullConstructionTier: null, shipyardTier: 3, constructionTimeModifier: 0.5 }
  ];
  const calibrated = calibrateFactionShipBuildModifier({ rows });
  assert.strictEqual(calibrated.rowsUsed, 1);
  assert.strictEqual(calibrated.rowsSkipped, 2);
  assert.strictEqual(calibrated.value, 0.4);
});

// -- The snapshot path, both modes --------------------------------------------

test('reads hull, design and shipyard off the committed omniscient fixture', () => {
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'omniscient' });
  const queue = snapshot.shipyardQueues.find(row => row.costPaid === false);
  assert.ok(queue, 'the omniscient fixture must carry at least one waiting queue entry');

  const hullName = hullNameForDesign(snapshot, queue.design);
  assert.ok(hullName, 'a design must resolve to a hull class');
  assert.notStrictEqual(hullName, queue.hull === hullName ? null : queue.design,
    'the queue row hull field is the design name, not the hull class');

  const hull = hullFromSnapshot(snapshot, hullName);
  assert.ok(Number.isFinite(hull.baseConstructionTimeDays));
  assert.ok(Number.isFinite(hull.constructionTier));

  const yard = shipyardFromSnapshot(snapshot, queue.shipyardId);
  assert.ok(SHIP_CONSTRUCTION_MODULES[yard.templateName], 'the yard must be a ship construction module');
  assert.strictEqual(yard.tier, SHIP_CONSTRUCTION_MODULES[yard.templateName].tier);
});

test('the module tier is the MODULE tier, never the hab tier', () => {
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'omniscient' });
  const mismatch = snapshot.shipyardStations
    .filter(row => SHIP_CONSTRUCTION_MODULES[row.templateName])
    .find(row => Number.isFinite(row.habTier) && row.habTier !== SHIP_CONSTRUCTION_MODULES[row.templateName].tier);
  assert.ok(mismatch, 'the fixture should contain a yard whose hab tier differs from its module tier');
  const yard = shipyardFromSnapshot(snapshot, mismatch.id);
  assert.strictEqual(yard.tier, SHIP_CONSTRUCTION_MODULES[mismatch.templateName].tier);
  assert.notStrictEqual(yard.tier, mismatch.habTier);
});

test('the snapshot path answers on the omniscient fixture by calibrating', () => {
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'omniscient' });
  const queue = snapshot.shipyardQueues.find(row => row.costPaid === false);
  const result = shipBuildDaysFromSnapshot(snapshot, {
    designName: queue.design,
    shipyardId: queue.shipyardId,
    factionId: queue.factionId
  });
  assert.strictEqual(result.available, true, result.reason ?? '');
  assert.strictEqual(result.factionModifier.basis, 'calibrated-from-queue');
  assert.ok(Math.abs(result.daysExact - queue.daysToCompletion) < 1e-6,
    `calibrated estimate ${result.daysExact} vs save ${queue.daysToCompletion}`);
});

test('PLAYER MODE: no waiting queue entries are visible, so it refuses rather than guessing', () => {
  // The committed player fixture carries queue rows but none with costPaid
  // false, so there is nothing to calibrate from and neither faction-modifier
  // input is on the snapshot. The honest answer is "cannot advise", and a
  // feature verified only in omniscient mode is not verified.
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'player' });
  assert.strictEqual(calibrationRowsFromSnapshot(snapshot, 4712).length, 0);
  const yard = snapshot.shipyardStations.find(row => SHIP_CONSTRUCTION_MODULES[row.templateName]);
  assert.ok(yard, 'the player fixture must carry a yard');
  const result = shipBuildDaysFromSnapshot(snapshot, { hullName: 'Frigate', shipyardId: yard.id, factionId: 4712 });
  assert.strictEqual(result.available, false);
  assert.strictEqual(result.days, null);
  assert.strictEqual(result.reason, SHIP_BUILD_REFUSALS.factionModifierUnmeasured);
});

test('PLAYER MODE: supplying the two save readings makes it answer', () => {
  // The refusal above is about what the snapshot carries, not about the mode
  // itself: hand it the settings value and the effect list and player mode
  // computes the same number omniscient mode does.
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'player' });
  const yard = snapshot.shipyardStations.find(row => row.templateName === 'Shipyard')
    ?? snapshot.shipyardStations.find(row => SHIP_CONSTRUCTION_MODULES[row.templateName]);
  const result = shipBuildDaysFromSnapshot(snapshot, {
    hullName: 'Frigate',
    shipyardId: yard.id,
    factionId: 4712,
    shipConstructionSpeed: 2,
    effectNames: ['Effect_ShipConstructionTimeReduction']
  });
  assert.strictEqual(result.available, true, result.reason ?? '');
  assert.strictEqual(result.factionModifier.basis, 'settings-and-effects');
  assert.strictEqual(result.inputs.hullName, 'Frigate');
});

test('the snapshot path answers from campaignSettings speed + the faction\'s own effect list', () => {
  // The exact route shared/shipBuildTime.mjs documents, now that
  // server/snapshot/ carries the two inputs: the campaign-global
  // `shipConstructionSpeed{Player,HumanAI,Alien}` on the campaignSettings block
  // and each faction's own `ShipConstructionTime` effect list. This is the
  // filtered-snapshot shape -- campaignSettings under `metadata`, no top-level
  // copy -- so it exercises the metadata fallback in the reader.
  const snapshot = {
    metadata: { playerFactionName: 'The Initiative' },
    campaignSettings: { shipConstructionSpeed: { Player: 2, HumanAI: 2, Alien: 2 } },
    factions: [
      { ID: 4712, displayName: 'the Initiative', shipConstructionTimeEffects: ['Effect_ShipConstructionTimeReduction'] }
    ],
    shipyardStations: [{ id: 9001, templateName: 'Shipyard', factionId: 4712 }],
    shipHullStats: { Frigate: { baseConstructionTimeDays: 120, constructionTier: 1 } },
    shipyardQueues: []
  };
  const result = shipBuildDaysFromSnapshot(snapshot, { hullName: 'Frigate', shipyardId: 9001, factionId: 4712 });
  assert.strictEqual(result.available, true, result.reason ?? '');
  assert.strictEqual(result.factionModifier.basis, 'settings-and-effects');
  // 120 base x 0.8 (Shipyard tier 2 vs Frigate consTier 1, gap +1)
  //   x 0.5 (speed 2) x 0.8 (Effect_ShipConstructionTimeReduction) = 38.4.
  assert.ok(Math.abs(result.daysExact - 38.4) < 1e-9, `got ${result.daysExact}`);
  assert.strictEqual(result.days, 39, 'a build finishing 38.4 days out is not finished on day 38');
  assert.strictEqual(result.factionModifier.shipConstructionSpeed, 2);
});

test('a faction whose effect list is redacted to null refuses rather than computing', () => {
  // Player mode redacts a RIVAL's effects to ABSENT (null) -- see
  // server/intelligenceFilter.js. The module must refuse for that faction
  // rather than emitting a confident build time from a speed it was allowed to
  // read and an effect list it was not. With no waiting queue rows to calibrate
  // from, there is nothing else to answer with.
  const snapshot = {
    metadata: { playerFactionName: 'The Initiative' },
    campaignSettings: { shipConstructionSpeed: { Player: 2, HumanAI: 2, Alien: 2 } },
    factions: [
      { ID: 4710, displayName: 'the Resistance', shipConstructionTimeEffects: null }
    ],
    shipyardStations: [{ id: 9001, templateName: 'Shipyard', factionId: 4710 }],
    shipHullStats: { Frigate: { baseConstructionTimeDays: 120, constructionTier: 1 } },
    shipyardQueues: []
  };
  const result = shipBuildDaysFromSnapshot(snapshot, { hullName: 'Frigate', shipyardId: 9001, factionId: 4710 });
  assert.strictEqual(result.available, false);
  assert.strictEqual(result.days, null);
  assert.strictEqual(result.daysExact, null);
  assert.strictEqual(result.reason, SHIP_BUILD_REFUSALS.factionModifierUnmeasured);
});

test('the speed bucket resolves by faction scope, case-insensitively on the player name', () => {
  // TIMetadataState.playerFactionName ("The Initiative") and the faction's own
  // displayName ("the Initiative") differ in case on the live save; the player
  // match must not depend on the two agreeing letter-for-letter.
  assert.strictEqual(
    resolveShipConstructionSpeed({ Player: 2, HumanAI: 3, Alien: 4 }, { metadata: { playerFactionName: 'The Initiative' } }, { displayName: 'the Initiative' }),
    2
  );
  // The alien faction takes the Alien bucket regardless of who the player is.
  assert.strictEqual(
    resolveShipConstructionSpeed({ Player: 2, HumanAI: 3, Alien: 4 }, { metadata: { playerFactionName: 'The Initiative' } }, { displayName: 'the Aliens' }),
    4
  );
  // Everyone else is a human AI.
  assert.strictEqual(
    resolveShipConstructionSpeed({ Player: 2, HumanAI: 3, Alien: 4 }, { metadata: { playerFactionName: 'The Initiative' } }, { displayName: 'the Academy' }),
    3
  );
  // A plain number passes through unchanged (the caller-supplied argument).
  assert.strictEqual(resolveShipConstructionSpeed(2, null, null), 2);
  // An absent bucket is unknown, not 0 and not 1.
  assert.strictEqual(resolveShipConstructionSpeed({ Player: 2 }, { metadata: { playerFactionName: 'X' } }, { displayName: 'the Academy' }), null);
});

test('an unresolvable design refuses instead of silently picking a hull', () => {
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'player' });
  const result = shipBuildDaysFromSnapshot(snapshot, { designName: 'noSuchDesign999', shipyardId: 1, factionId: 4712 });
  assert.strictEqual(result.available, false);
  assert.strictEqual(result.reason, SHIP_BUILD_REFUSALS.designUnknown);
});

test('an ambiguous display name resolves to nothing, not to the first match', () => {
  // Two factions may pick the same ship name. Taking the first would hand back
  // the other faction's hull class silently, which is a wrong base time and a
  // wrong construction tier at once.
  const snapshot = {
    shipDesigns: [
      { dataName: 'aTemplate1', _displayName: 'Chiyou', hullName: 'Escort' },
      { dataName: 'bTemplate1', _displayName: 'Chiyou', hullName: 'Dreadnought' }
    ]
  };
  assert.strictEqual(hullNameForDesign(snapshot, 'Chiyou'), null);
  // The unambiguous identity still resolves.
  assert.strictEqual(hullNameForDesign(snapshot, 'bTemplate1'), 'Dreadnought');
  // And a unique display name is still usable.
  assert.strictEqual(
    hullNameForDesign({ shipDesigns: [{ dataName: 'x', _displayName: 'Solo', hullName: 'Frigate' }] }, 'Solo'),
    'Frigate'
  );
});

// -- The race -----------------------------------------------------------------

test('the race refuses when either clock is unknown', () => {
  const noBuild = buildBeatsArrival({ buildDays: null, daysUntilArrival: 120 });
  assert.strictEqual(noBuild.available, false);
  assert.strictEqual(noBuild.verdict, null);
  assert.strictEqual(noBuild.reason, SHIP_BUILD_REFUSALS.buildDaysUnmeasured);

  const noArrival = buildBeatsArrival({ buildDays: 96, daysUntilArrival: null });
  assert.strictEqual(noArrival.available, false);
  assert.strictEqual(noArrival.verdict, null);
  assert.strictEqual(noArrival.reason, SHIP_BUILD_REFUSALS.arrivalUnmeasured);

  // The failure this guards: an unknown build time must not win the race.
  assert.notStrictEqual(noBuild.verdict, 'build-lands-first');
});

test('the race reports the margin when both clocks are readings', () => {
  assert.deepStrictEqual(
    { verdict: buildBeatsArrival({ buildDays: 96, daysUntilArrival: 120 }).verdict, margin: buildBeatsArrival({ buildDays: 96, daysUntilArrival: 120 }).marginDays },
    { verdict: 'build-lands-first', margin: 24 }
  );
  assert.strictEqual(buildBeatsArrival({ buildDays: 216, daysUntilArrival: 120 }).verdict, 'arrival-first');
  assert.strictEqual(buildBeatsArrival({ buildDays: 120, daysUntilArrival: 120 }).verdict, 'simultaneous');
  // A fleet already at the door is a negative arrival horizon, not zero.
  assert.strictEqual(buildBeatsArrival({ buildDays: 10, daysUntilArrival: -5 }).verdict, 'arrival-first');
});

test('daysUntil returns null on an unreadable date rather than today', () => {
  assert.strictEqual(daysUntil(null, '2042-01-01T00:00:00Z'), null);
  assert.strictEqual(daysUntil('2042-01-01T00:00:00Z', 'not a date'), null);
  assert.strictEqual(daysUntil('2042-01-01T00:00:00Z', '2042-01-11T00:00:00Z'), 10);
  assert.strictEqual(daysUntil('2042-01-11T00:00:00Z', '2042-01-01T00:00:00Z'), -10);
});
