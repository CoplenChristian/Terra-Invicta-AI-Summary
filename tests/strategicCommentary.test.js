/**
 * tests/strategicCommentary.test.js
 *
 * Automated test suite for Strategic Commentary Engine (server/commentary).
 *
 * Validates:
 * 1. PRNG determinism (Mulberry32 seed consistency).
 * 2. Null-honesty of facts extraction (no fabricated zeros, player-mode hate privacy).
 * 3. Deterministic narrative beat predicates and required-field suppression.
 * 4. Hold Ground stance coherence (no offensive beats or conflicting advice when Hold Ground is active).
 * 5. Monte Carlo simulation safety:
 *    - Player mode uses observable fleet telemetry.
 *    - Zero visible alien fleets resolves to UNAVAILABLE, never P(win) = 1.0.
 * 6. Zero null / undefined / NaN in grammar output.
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { createPrng, samplePercentile } = require('../server/commentary/prng');
const { extractFacts, medianOf, resolveHullTier } = require('../server/commentary/facts');
const { evaluateBeats, BEAT_DEFINITIONS, isStanceCoherentWithHoldGround } = require('../server/commentary/beats');
const { runMonteCarloSimulation, findRequiredHullsForTier } = require('../server/commentary/simulation');
const { generateGrammar } = require('../server/commentary/grammar');
const { generateStrategicCommentary } = require('../server/commentary');

test('PRNG: Mulberry32 generates deterministic output for same seed and varies for different seeds', () => {
  const prng1 = createPrng('save-alpha-1234');
  const prng2 = createPrng('save-alpha-1234');
  const prng3 = createPrng('save-beta-5678');

  const seq1 = [prng1.nextFloat(), prng1.nextFloat(), prng1.nextInt(1, 10), prng1.choice(['a', 'b', 'c'])];
  const seq2 = [prng2.nextFloat(), prng2.nextFloat(), prng2.nextInt(1, 10), prng2.choice(['a', 'b', 'c'])];
  const seq3 = [prng3.nextFloat(), prng3.nextFloat(), prng3.nextInt(1, 10), prng3.choice(['a', 'b', 'c'])];

  assert.deepStrictEqual(seq1, seq2, 'Same seed must produce byte-identical sequence');
  assert.notDeepStrictEqual(seq1, seq3, 'Different seed must produce distinct sequence');
});

test('Facts: medianOf handles missing values and preserves null-honesty', () => {
  assert.strictEqual(medianOf([]), null);
  assert.strictEqual(medianOf([null, undefined]), null);
  assert.strictEqual(medianOf([1, 3, 2]), 2);
  assert.strictEqual(medianOf([1, 2, 3, 4]), 2.5);
  assert.strictEqual(medianOf([null, 10, null, 20]), 15);
});

test('Facts: resolveHullTier reads constructionTier from shipHullStats, not names', () => {
  const stats = {
    Escort: { constructionTier: 1 },
    Battlecruiser: { constructionTier: 3 },
    Monitor: { constructionTier: 2 }
  };
  const designs = [
    { displayName: 'Chiyou', hullName: 'Escort' },
    { displayName: 'Vanguard', hullName: 'Battlecruiser' }
  ];

  assert.strictEqual(resolveHullTier('Chiyou', designs, stats), 1);
  assert.strictEqual(resolveHullTier('Vanguard', designs, stats), 3);
  assert.strictEqual(resolveHullTier('Monitor', designs, stats), 2);
  assert.strictEqual(resolveHullTier('UnknownHull', designs, stats), null);
});

test('Facts: extractFacts respects player-mode redactions and calculates hull tier distributions', () => {
  const snapshot = {
    mode: 'player',
    observerFactionId: 4712,
    observerFactionName: 'the Initiative',
    shipHullStats: {
      Monitor: { constructionTier: 2 },
      Battlecruiser: { constructionTier: 3 }
    },
    shipDesigns: [
      { displayName: 'FleeingMonitor', hullName: 'Monitor', factionId: 4712 },
      { displayName: 'HeavyBC', hullName: 'Battlecruiser', factionId: 4712 }
    ],
    fleets: [
      {
        factionId: 4712,
        ships: [{ hullName: 'Battlecruiser', displayName: 'HeavyBC' }]
      },
      {
        factionId: 4717,
        factionName: 'the Aliens',
        shipsCount: 5,
        armorMedian: 12.0
      }
    ]
  };

  const posture = {
    actualAlienHate: null, // redacted in player mode
    pips: 4,
    warPressure: 'clear',
    fleetCapability: { canContest: false }
  };

  const changes = {
    hate: { actual: { delta: -15.0 }, crossedWarThreshold: 'down' },
    shipLosses: [{ design: 'FleeingMonitor', count: 3 }]
  };

  const facts = extractFacts({
    snapshot,
    campaignPosture: posture,
    changesSincePrevious: changes,
    snapshotId: 'test-snap-01'
  });

  assert.strictEqual(facts.mode, 'player');
  assert.strictEqual(facts.actualAlienHate, null, 'actualAlienHate must stay null in player mode');
  assert.strictEqual(facts.pips, 4);
  assert.strictEqual(facts.shipsLost, 3);
  assert.strictEqual(facts.medianLostHullTier, 2);
  assert.strictEqual(facts.medianSurvivingHullTier, 3);
  assert.strictEqual(facts.warStateChange, 'exited');
});

test('Beats: forced-fleet-transition fires when losses in lower tier precede higher tier survival and hate vents', () => {
  const facts = {
    shipsLost: 2,
    hateDelta: -8.0,
    warStateChange: 'exited',
    warPressure: 'clear',
    medianLostHullTier: 1,
    medianSurvivingHullTier: 3,
    isHoldGroundActive: false,
    canContest: true,
    actualAlienHate: 32.0,
    warHeadroom: 18.0
  };

  const beats = evaluateBeats(facts);
  const transitionBeat = beats.find(b => b.id === 'forced-fleet-transition');
  assert.ok(transitionBeat, 'forced-fleet-transition beat must fire');
  assert.strictEqual(transitionBeat.severity, 'pivotal');
});

test('Beats: suppress beat when required facts are missing/null', () => {
  const incompleteFacts = {
    shipsLost: 2,
    hateDelta: null, // missing required fact
    warStateChange: 'exited',
    warPressure: 'clear',
    medianLostHullTier: 1,
    medianSurvivingHullTier: 3,
    isHoldGroundActive: false,
    canContest: true
  };

  const beats = evaluateBeats(incompleteFacts);
  const transitionBeat = beats.find(b => b.id === 'forced-fleet-transition');
  assert.strictEqual(transitionBeat, undefined, 'Beat must not fire when required fact is null');
});

test('Beats: Hold Ground stance coherence guard suppresses contradictory offensive stances', () => {
  const holdingFacts = {
    isHoldGroundActive: true,
    canContest: false,
    shipsLost: 0,
    hateDelta: 0,
    warPressure: 'at-war',
    actualAlienHate: null,
    pips: 5,
    dominantDeficit: { label: 'delta-V', decisive: true, text: '20 vs 210 km/s' }
  };

  const beats = evaluateBeats(holdingFacts);
  for (const b of beats) {
    assert.notStrictEqual(b.stance, 'offensive', 'No offensive beat allowed while Hold Ground is active');
    assert.notStrictEqual(b.stance, 'escalate', 'No escalating beat allowed while Hold Ground is active');
  }
});

test('Simulation: Player Mode builds opponent tiers from observable fleet telemetry', () => {
  const facts = {
    mode: 'player',
    snapshotId: 'test-seed-4712',
    observerId: 4712,
    shipDesigns: [
      { factionId: 4712, hullName: 'Battlecruiser', displayName: 'Heavy Rail Mk3', _unnormalizedCombatValue: 18500 }
    ],
    shipHullStats: {
      Battlecruiser: { baseConstructionTimeDays: 75, constructionTier: 3 }
    },
    alienFleets: [
      { shipsCount: 1, armorMedian: 8.0, lowestDeltaVKps: 150 },
      { shipsCount: 3, armorMedian: 12.0, lowestDeltaVKps: 200 },
      { shipsCount: 6, armorMedian: 22.0, lowestDeltaVKps: 280 }
    ],
    ownQueuedShips: [{ factionId: 4712 }, { factionId: 4712 }],
    actualAlienHate: null,
    hateVentRatePerDay: null
  };

  const sim = runMonteCarloSimulation(facts);
  assert.strictEqual(sim.available, true);
  assert.strictEqual(sim.source, 'observable_fleet_telemetry');
  assert.strictEqual(sim.ownBestDesign, 'Heavy Rail Mk3');
  assert.strictEqual(sim.tiers.length, 5);

  const escortTier = sim.tiers.find(t => t.id === 'median-alien-escort');
  assert.ok(escortTier);
  assert.strictEqual(escortTier.winnable, true);
  assert.strictEqual(typeof escortTier.bandLabel, 'string');
});

test('Simulation: Zero-Opponent Guard returns unavailable rather than P(win)=1.0', () => {
  const blindFacts = {
    mode: 'player',
    snapshotId: 'blind-seed',
    observerId: 4712,
    shipDesigns: [
      { factionId: 4712, hullName: 'Escort', displayName: 'Chiyou', _unnormalizedCombatValue: 2500 }
    ],
    shipHullStats: {},
    alienFleets: [], // ZERO visible alien fleets
    ownQueuedShips: [],
    actualAlienHate: null,
    hateVentRatePerDay: null
  };

  const sim = runMonteCarloSimulation(blindFacts);
  assert.strictEqual(sim.available, false, 'Zero visible opponents must resolve to unavailable');
  assert.ok(sim.reason.includes('No alien forces visible'), 'Must state reason for unavailability');
});

test('Simulation: Unwinnable tier produces explicit unwinnable label', () => {
  const weakOwnRating = 100;
  const overwhelmingOpponentRating = 500000;
  const result = findRequiredHullsForTier(weakOwnRating, overwhelmingOpponentRating, 'unwinnable-seed');

  assert.strictEqual(result.winnable, false);
  assert.strictEqual(result.bandLabel, 'Not winnable at any count simulated (≤24)');
});

test('Grammar: generates coherent prose with zero null, undefined, or NaN tokens', () => {
  const facts = {
    mode: 'player',
    snapshotId: 'grammar-test-01',
    observerId: 4712,
    observerName: 'the Initiative',
    isHoldGroundActive: true,
    canContest: false,
    shipsLost: 2,
    hateDelta: -6.5,
    warStateChange: 'exited',
    actualAlienHate: null,
    pips: 4,
    medianSurvivingHullTier: 3,
    dominantDeficit: { label: 'delta-V', text: '20 vs 210 km/s' }
  };

  const beats = [
    {
      id: 'forced-fleet-transition',
      name: 'Forced Fleet Transition',
      severity: 'pivotal',
      stance: 'transitional',
      summary: 'Losses in tier 1, surviving in tier 3.'
    }
  ];

  const simulation = {
    available: true,
    ownBestDesign: 'Heavy Rail Mk3 Battlecruiser',
    ownBestHull: 'Battlecruiser',
    tiers: [
      { id: 'typical-alien-combatant', label: '1x typical alien', winnable: true, bandLabel: '2 hulls' },
      { id: 'heavy-alien-capital', label: '1x heavy alien', winnable: true, bandLabel: '6–7 hulls' }
    ]
  };

  const grammar = generateGrammar({ facts, beats, simulation });

  assert.ok(grammar.headline && grammar.headline.length > 0);
  assert.ok(grammar.prose && grammar.prose.length > 0);
  assert.ok(grammar.advice && grammar.advice.length > 0);

  const fullText = `${grammar.headline} ${grammar.prose} ${grammar.advice}`;
  const forbidden = ['null', 'undefined', 'NaN', '[object Object]'];
  for (const token of forbidden) {
    assert.ok(!fullText.includes(token), `Rendered text must not contain forbidden token '${token}'`);
  }
});

test('End-to-End: generateStrategicCommentary produces complete structured output and deterministic result', () => {
  const mockSnapshot = {
    mode: 'player',
    snapshotId: 'e2e-seed-1234',
    observerFactionId: 4712,
    observerFactionName: 'the Initiative',
    shipHullStats: {
      Escort: { constructionTier: 1, baseConstructionTimeDays: 45 },
      Battlecruiser: { constructionTier: 3, baseConstructionTimeDays: 75 }
    },
    shipDesigns: [
      { factionId: 4712, hullName: 'Battlecruiser', displayName: 'Heavy Rail Mk3', _unnormalizedCombatValue: 19500 }
    ],
    fleets: [
      { factionId: 4712, ships: [{ hullName: 'Battlecruiser', displayName: 'Heavy Rail Mk3' }] },
      { factionId: 4717, factionName: 'the Aliens', shipsCount: 4, armorMedian: 11.5 }
    ],
    changesSincePrevious: {
      hate: { actual: { delta: -12.0 }, crossedWarThreshold: 'down' },
      shipLosses: [{ design: 'OldEscort', count: 2 }],
      period: { days: 15 }
    }
  };

  const posture = {
    actualAlienHate: null,
    pips: 3,
    warPressure: 'clear',
    fleetCapability: { canContest: false, dominantDeficit: { label: 'delta-V', decisive: true, text: '20 vs 210 km/s' } }
  };

  const holdGround = { fires: true, action: 'Hold all hate missions' };

  const res1 = generateStrategicCommentary({
    snapshot: mockSnapshot,
    campaignPosture: posture,
    holdGround,
    changesSincePrevious: mockSnapshot.changesSincePrevious,
    snapshotId: mockSnapshot.snapshotId
  });

  const res2 = generateStrategicCommentary({
    snapshot: mockSnapshot,
    campaignPosture: posture,
    holdGround,
    changesSincePrevious: mockSnapshot.changesSincePrevious,
    snapshotId: mockSnapshot.snapshotId
  });

  assert.deepStrictEqual(res1, res2, 'Strategic commentary must be byte-identical on repeated runs for same snapshotId');
  assert.strictEqual(res1.available, true);
  assert.ok(res1.headline);
  assert.ok(res1.prose);
  assert.ok(Array.isArray(res1.beats));
  assert.ok(res1.simulation.available);
});

// ---------------------------------------------------------------------------
// AN UNMEASURED OWN RATING IS UNKNOWN, NEVER 5000
//
// `runMonteCarloSimulation` opened at `let ownRating = 5000; // default
// baseline`, with `'Combat Hull'` / `'Standard Combatant'` beside it. All three
// fired when the observer had no design carrying a combat value, so a strength
// that could not be MEASURED was simulated as a specific number and every
// threshold downstream inherited it. `shared/fleetEngagement.mjs` already
// answers the same question with `available: false` and says no default was
// substituted; these pin that this file now does the same.
// ---------------------------------------------------------------------------

/** An observer with designs but not one combat value between them. */
const unratedFacts = (mode) => ({
  mode,
  snapshotId: 'unrated-observer-seed',
  observerId: 4712,
  observerName: 'the Initiative',
  shipDesigns: [
    { factionId: 4712, hullName: 'Monitor', displayName: 'Cimarron' },
    { factionId: 4712, hullName: 'Escort', displayName: 'Patapsco', _unnormalizedCombatValue: null },
    { factionId: 4712, hullName: 'Frigate', displayName: 'River', _unnormalizedCombatValue: '' },
    // A rated ALIEN design, so omniscient mode has opponent tiers to build and
    // the unavailability can only be about the observer's own side.
    { factionId: 4717, factionName: 'the Aliens', hullName: 'Alien Cruiser', _unnormalizedCombatValue: 90000 }
  ],
  shipHullStats: { Monitor: { baseConstructionTimeDays: 120, constructionTier: 2 } },
  alienFleets: [
    { shipsCount: 4, armorMedian: 14.0, lowestDeltaVKps: 180 },
    { shipsCount: 9, armorMedian: 26.0, lowestDeltaVKps: 240 }
  ],
  ownQueuedShips: [{ factionId: 4712 }],
  actualAlienHate: mode === 'omniscient' ? 168 : null,
  hateVentRatePerDay: mode === 'omniscient' ? -0.4 : null
});

for (const mode of ['player', 'omniscient']) {
  test(`Simulation: an observer with no rated design reports unavailable and substitutes no rating (${mode})`, () => {
    const sim = runMonteCarloSimulation(unratedFacts(mode));

    assert.strictEqual(sim.available, false,
      'a rating that could not be measured must not produce a runnable simulation');
    assert.strictEqual(sim.ownRating, null, 'absent stays null: the rating is not 5000 and not 0');
    assert.strictEqual(sim.ownBestHull, null, 'no fabricated "Combat Hull"');
    assert.strictEqual(sim.ownBestDesign, null, 'no fabricated "Standard Combatant"');
    assert.deepStrictEqual(sim.tiers, [], 'no tier may carry a band built on an unmeasured rating');
    assert.deepStrictEqual(sim.projections, {});
    assert.match(sim.reason, /No default rating is substituted/,
      'the result has to SAY that no default was substituted');

    // The whole payload, not one field: a confident constant that survived
    // anywhere in it would be just as wrong as one on `ownRating`.
    const serialized = JSON.stringify(sim);
    assert.doesNotMatch(serialized, /5000/, 'the invented baseline rating must appear nowhere');
    assert.doesNotMatch(serialized, /Combat Hull|Standard Combatant|Battlecruiser/,
      'no invented hull or design name may appear');
  });
}

test('Simulation: an unavailable sweep reaches no consumer as a win, a loss, or a hull count', () => {
  for (const mode of ['player', 'omniscient']) {
    const facts = unratedFacts(mode);
    const sim = runMonteCarloSimulation(facts);
    const grammar = generateGrammar({ facts, beats: [], simulation: sim });

    const prose = `${grammar.headline} ${grammar.prose} ${grammar.advice} ${grammar.simulatedThresholdText}`;
    assert.doesNotMatch(prose, /\d+\s*(–|-)?\s*\d*\s*hulls?\b/,
      `${mode}: prose must not report a hull count from a simulation that never ran`);
    assert.doesNotMatch(prose, /80%\s*victory|P\(win\)/i,
      `${mode}: prose must not report a win probability from a simulation that never ran`);
    assert.doesNotMatch(prose, /unwinnable|cannot reliably achieve/i,
      `${mode}: "could not be run" is not "was run and lost"`);
    assert.doesNotMatch(prose, /5000|Combat Hull|Standard Combatant/,
      `${mode}: no invented rating or hull name may reach the prose`);
  }
});

test('Simulation: generateStrategicCommentary carries the unavailability reason to its consumer', () => {
  const snapshot = {
    mode: 'player',
    observerFactionId: 4712,
    snapshotId: 'unrated-observer-seed',
    factions: [
      { ID: 4712, displayName: 'the Initiative' },
      { ID: 4717, displayName: 'the Aliens', isAlien: true }
    ],
    shipDesigns: [{ factionId: 4712, hullName: 'Monitor', displayName: 'Cimarron' }],
    fleets: [{ factionId: 4717, shipsCount: 4, armorMedian: 14.0 }],
    habs: [],
    shipyardQueues: []
  };

  const res = generateStrategicCommentary({ snapshot, snapshotId: snapshot.snapshotId });

  assert.strictEqual(res.simulation.available, false);
  assert.strictEqual(res.simulation.ownRating, null);
  assert.ok(typeof res.simulation.reason === 'string' && res.simulation.reason.length > 0,
    'the reason was built and then dropped by the orchestrator; a consumer given `available: false` '
    + 'and nothing else can only render a blank');
});

// ---------------------------------------------------------------------------
// "1 hulls"
//
// One count is one hull. The label is built in exactly one place now
// (`hullBandLabel`); `shared/fleetEngagement.mjs` used to keep a second copy of
// the arithmetic precisely because this one was wrong.
// ---------------------------------------------------------------------------
test('Simulation: a single-hull band reads "1 hull", and wider bands stay plural', () => {
  const { hullBandLabel } = require('../shared/engagementModel.mjs');

  assert.strictEqual(hullBandLabel(1, 1), '1 hull');
  assert.strictEqual(hullBandLabel(2, 2), '2 hulls');
  assert.strictEqual(hullBandLabel(1, 2), '1–2 hulls');
  assert.strictEqual(hullBandLabel(1, 1, 'at least '), 'at least 1 hull');
  assert.strictEqual(hullBandLabel(43, 46), '43–46 hulls');

  // And through the sweep itself: an opponent this weak is beaten by one hull
  // in every seed, which is the case that rendered "1 hulls".
  const swept = findRequiredHullsForTier(50000, 1, 'single-hull-band-seed');
  assert.strictEqual(swept.winnable, true);
  assert.strictEqual(swept.p20, 1);
  assert.strictEqual(swept.p80, 1);
  assert.strictEqual(swept.bandLabel, '1 hull');
});

// ---------------------------------------------------------------------------
// THE BROWSER SURFACE
//
// The COMMAND panel rendered the combat-threshold table only when the sweep was
// available and simply omitted it otherwise, with no explanation, so a reader
// could not tell "no engagement model was run" from "the model found nothing
// worth warning about". Silence is the same defect class as a confident number.
// Panel rendering for an unavailable sweep is covered in
// tests/strategic-commentary.test.js via the Playwright primitives harness.
// ---------------------------------------------------------------------------
// THE REMAINING CONFIDENT DEFAULTS IN simulation.js
//
// Seven of them, all LATENT on the live save and none of them fixed when the
// `ownRating = 5000` baseline was: `armorMedian || 10`, the `|| 12` / `|| 24`
// armour percentiles, p10/p50/p90 CV fallbacks of 3250 / 20330 / 70100,
// `baseConstructionTimeDays || 60` and `queuedCount || 2`.
//
// MEASURED on ExitSave.gz (md5 5c0d9ef9...), 2026-08-22: 0 of 57 alien fleets
// miss `armorMedian` or `shipsCount`, 82 of 82 alien designs carry a positive
// CV, 24 of 24 observer designs carry a CV, and 0 of 28 hull stats miss
// `baseConstructionTimeDays` (`Monitor` reads 120). So every one of them fires
// only on a save this one does not exercise -- and a save that DID exercise
// them would have published a specific invented number with nothing on the
// surface saying so. Latent is not fixed.
//
// The whole `strategicCommentary` payload is byte-identical in all three modes
// after these changes, which is the evidence that they were latent.
// ---------------------------------------------------------------------------

const {
  buildPlayerOpponentTiers,
  buildOmniscientOpponentTiers
} = require('../server/commentary/simulation');

/**
 * Queue rows shaped the way `buildShipyardQueues` actually shapes them.
 *
 * `constructionStatus` is REQUIRED for the concurrency to be readable at all --
 * a row without one makes the number building unknown rather than smaller --
 * and each build sits at its own `shipyardId`, which is the measured rule: one
 * hull per yard at a time.
 */
const buildingRows = (count, { firstDays = null } = {}) => new Array(count).fill(null).map((_unused, index) => ({
  factionId: 4712,
  shipyardId: 1000 + index,
  design: 'playerShipTemplate1',
  constructionStatus: 'building',
  daysToCompletion: firstDays === null ? null : firstDays + index
}));

const waitingRows = (count, { design = 'playerShipTemplate1', days = 60, shipyardId = 1000, isRefit = false } = {}) =>
  new Array(count).fill(null).map(() => ({
    factionId: 4712, shipyardId, design, isRefit, constructionStatus: 'queued', daysToCompletion: days
  }));

const ratedFacts = (overrides = {}) => ({
  mode: 'player',
  snapshotId: 'default-audit-seed',
  observerId: 4712,
  shipDesigns: [
    { factionId: 4712, hullName: 'Monitor', displayName: 'Sentinel', dataName: 'playerShipTemplate1', _unnormalizedCombatValue: 12000 }
  ],
  shipHullStats: { Monitor: { baseConstructionTimeDays: 120 } },
  alienFleets: [{ shipsCount: 4, armorMedian: 14 }, { shipsCount: 9, armorMedian: 26 }],
  ownQueuedShips: buildingRows(2),
  ownShipyards: new Array(6).fill({ isShipyard: true, factionId: 4712, constructionStatus: 'operational', templateName: 'Shipyard' }),
  actualAlienHate: null,
  hateVentRatePerDay: null,
  ...overrides
});

test('an alien fleet with no readable armour is dropped from the sample, never rated at a default 10cm', () => {
  // A default of 10 is not a neutral choice: it sits between the two measured
  // medians below, so an unreadable fleet would have quietly pulled the median
  // DOWN and reported the aliens as weaker than the readable evidence says.
  const measuredOnly = buildPlayerOpponentTiers([{ armorMedian: 20 }, { armorMedian: 30 }], 1000);
  const withUnreadable = buildPlayerOpponentTiers(
    [{ armorMedian: 20 }, { armorMedian: null }, { armorMedian: 30 }, { armorMedian: 'n/a' }, {}],
    1000
  );
  assert.deepStrictEqual(
    withUnreadable.map(t => t.opponentRating),
    measuredOnly.map(t => t.opponentRating),
    'the unreadable fleets must not move any tier rating'
  );
  assert.match(withUnreadable[0].description, /median armor 25\.0cm/,
    'the median is of the MEASURED fleets, not of a sample padded with 10s');
});

test('no readable armour at all refuses, and says the fleets were seen but not measured', () => {
  assert.strictEqual(buildPlayerOpponentTiers([{ armorMedian: null }, {}], 1000), null,
    'an unmeasurable population must not produce 12cm / 24cm tiers out of nothing');
  // A measured zero would scale every tier to a rating of 0, which reads as
  // "any hull wins" rather than as "this could not be rated".
  assert.strictEqual(buildPlayerOpponentTiers([{ armorMedian: 0 }], 1000), null);

  const sim = runMonteCarloSimulation(ratedFacts({
    alienFleets: [{ shipsCount: 4, armorMedian: null }, { shipsCount: 9 }]
  }));
  assert.strictEqual(sim.available, false);
  assert.match(sim.reason, /2 alien fleet\(s\) are visible but none carries a readable, positive armour median/);
  assert.match(sim.reason, /NOT a report that the alien fleets are weak/);
  assert.ok(!sim.reason.includes('No alien forces visible'),
    '"nothing is out there" and "I cannot measure what is out there" are opposite statements');
});

test('fleet size is not an input to the player opponent rating, and the dead computation is gone', () => {
  // `fleetSizes` was computed from `shipsCount` and never used -- dead since the
  // tiers were rewritten to key off armour medians, and the only place
  // `shipsCount` was read here, so the function read as though fleet size were
  // an input to the rating when it is not.
  const small = buildPlayerOpponentTiers([{ shipsCount: 1, armorMedian: 20 }], 1000);
  const large = buildPlayerOpponentTiers([{ shipsCount: 40, armorMedian: 20 }], 1000);
  const absent = buildPlayerOpponentTiers([{ armorMedian: 20 }], 1000);
  assert.deepStrictEqual(small, large, 'a 40-ship fleet and a 1-ship fleet of the same armour rate identically');
  assert.deepStrictEqual(small, absent, 'and an absent shipsCount changes nothing, because it is never read');
});

test('an alien design population with no readable combat value refuses instead of inventing CVs', () => {
  // HONEST NOTE ON WHAT THIS PROVES. Restoring `|| 3250` / `|| 20330` /
  // `|| 70100` leaves this suite GREEN, and that is the correct result: the
  // sample is filtered to positive finite CVs and refused when empty, and
  // `samplePercentile` returns null only for an empty array, so an interpolation
  // between positive values can be neither null nor 0. Those three fallbacks
  // were UNREACHABLE, not merely latent -- dead code that read as a degrade
  // path. Removing them is therefore a readability fix, and the assertions
  // below pin the FILTER, which is the property that keeps them unreachable.
  // Loosen the filter and the refusal is what catches it.
  assert.strictEqual(buildOmniscientOpponentTiers([{ _unnormalizedCombatValue: null }, {}]), null,
    'p10/p50/p90 of 3250 / 20330 / 70100 are three specific numbers with no source');
  assert.strictEqual(buildOmniscientOpponentTiers([{ _unnormalizedCombatValue: 0 }]), null);
  assert.strictEqual(buildOmniscientOpponentTiers([]), null);
  // A negative CV is excluded too, which is what stops a percentile from
  // interpolating across zero and landing on a falsy value.
  assert.strictEqual(buildOmniscientOpponentTiers([{ _unnormalizedCombatValue: -5 }]), null);
  const mixed = buildOmniscientOpponentTiers([
    { _unnormalizedCombatValue: -5 }, { _unnormalizedCombatValue: 100 }, { _unnormalizedCombatValue: 'x' }
  ]);
  assert.strictEqual(mixed.find(t => t.id === 'median-alien-escort').opponentRating, 100,
    'the negative and the unreadable are dropped, not folded into the sample');

  // A single readable design is still a measurement, and every percentile of a
  // one-element sample is that element.
  const single = buildOmniscientOpponentTiers([{ _unnormalizedCombatValue: 4321 }]);
  assert.strictEqual(single.find(t => t.id === 'median-alien-escort').opponentRating, 4321);

  const sim = runMonteCarloSimulation(ratedFacts({
    mode: 'omniscient',
    shipDesigns: [
      { factionId: 4712, hullName: 'Monitor', displayName: 'Sentinel', _unnormalizedCombatValue: 12000 },
      { factionId: 4717, factionName: 'the Aliens', hullName: 'Alien Cruiser', _unnormalizedCombatValue: null }
    ]
  }));
  assert.strictEqual(sim.available, false);
  assert.match(sim.reason, /1 alien design\(s\) are visible but none carries a readable combat value/);
  assert.match(sim.reason, /No default CV is substituted/);
});

test('the rebuild clock refuses rather than reporting a 60-day hull or two invented shipyards', () => {
  // An unreadable build time became a specific 60 days and an EMPTY queue became
  // two active yards, both under `available: true`, and both went straight into
  // the dashboard's "~N hulls/mo".
  //
  // The build-time refusal moved INSIDE the record on 2026-08-22 rather than
  // taking the whole projection down with it: the measured pipeline (how many
  // hulls are building, at how many yards, arriving when) comes from the save's
  // own countdowns and stands whether or not a build time is readable. What
  // must never happen is a RATE derived from a default, and that is what this
  // pins.
  const noBuildTime = runMonteCarloSimulation(ratedFacts({ shipHullStats: { Monitor: {} } }))
    .projections.rebuildClock;
  assert.strictEqual(noBuildTime.monthlyThroughputEst, null, 'never a rate derived from a 60-day default');
  assert.strictEqual(noBuildTime.daysPerHullEst, null);
  assert.strictEqual(noBuildTime.baseConstructionDays, null, 'and the unreadable input stays null');
  assert.strictEqual(noBuildTime.buildDays, null);
  assert.strictEqual(noBuildTime.buildTimeBasis, null, 'no basis, because no build time was resolved');
  assert.match(noBuildTime.throughputUnavailableReason, /no readable base construction time for Monitor/);
  // The measured half survives the unreadable dividend, and says what it read.
  assert.strictEqual(noBuildTime.concurrentBuilds, 2);
  assert.doesNotMatch(JSON.stringify(noBuildTime), /\b60\b/, 'the invented 60-day hull must appear nowhere');

  const noQueue = runMonteCarloSimulation(ratedFacts({ ownQueuedShips: undefined }))
    .projections.rebuildClock;
  assert.strictEqual(noQueue.available, false);
  assert.strictEqual(noQueue.queuedHullCount, null, 'an unread queue is not a queue of zero');
  assert.strictEqual(noQueue.concurrentBuilds, null, 'and nothing is inferred to be building');
  assert.strictEqual(noQueue.daysPerHullEst, null, 'and no per-hull time is derived from it either');
  assert.match(noQueue.reason, /no readable shipyard queue/);

  // An EMPTY queue is a measurement, and its throughput is a measured zero.
  const emptyQueue = runMonteCarloSimulation(ratedFacts({ ownQueuedShips: [] }))
    .projections.rebuildClock;
  assert.strictEqual(emptyQueue.available, true, 'reading an empty queue is a successful reading');
  assert.strictEqual(emptyQueue.queuedHullCount, 0);
  assert.strictEqual(emptyQueue.concurrentBuilds, 0);
  assert.strictEqual(emptyQueue.monthlyThroughputEst, 0,
    'nothing queued produces nothing, which is not the same as two yards producing one hull a month');
  assert.strictEqual(emptyQueue.daysPerHullEst, null,
    'nothing is being built, so there is no per-hull time — and 0 days would read as instant delivery');
});

// ---------------------------------------------------------------------------
// SERIAL WITHIN A YARD, PARALLEL ACROSS YARDS -- MEASURED, NOT ASSUMED
//
// `rebuildClock` divided the build time by `ownQueuedShips.length`, a count of
// QUEUED HULLS, which assumes every queued hull builds simultaneously. Settled
// on 2026-08-22 against four MD5-verified frozen saves (Autosave3 12/1/2034
// d3225, Autosave2 12/16/2034 d3241, Autosave and ExitSave 1/1/2035 d3256) and
// all eight factions:
//
//   * `nShipyardQueues` is a map keyed by SHIPYARD MODULE, one entry array per
//     yard. Across 129 yard-queues carrying work, ZERO had more than one entry
//     with `costPaid`, and every paid entry sat at index 0.
//   * Only that entry advances. All 15 unpaid entries held `daysToCompletion`
//     EXACTLY frozen over both intervals -- Humanity First's yard 17063 sat at
//     60 / 60 behind a head running 111.80 -> 95.80 -> 80.80 -- while paid
//     entries counted down by exactly the elapsed campaign days.
//
// The observer's own queue happened to be one hull at each of five yards, so
// the published rate did not move; other factions on the same save were
// overstated by up to 3.00x (the Servants, 15 queued against 5 building).
//
// EXPECTED VALUES FROM THE ARITHMETIC, not from the new output: five hulls at
// ONE yard is one build at a time, so 30 / 120 = 0.25/mo, where the old model
// printed 30 / (120 / 5) = 1.25.
// ---------------------------------------------------------------------------
test('five hulls stacked at one shipyard deliver at one yard\'s rate, not five', () => {
  // The four behind it are a DIFFERENT design, so the dividend stays the
  // template's 120 days and this test isolates the divisor. The interaction --
  // a queued hull of the target type stating its own duration -- is pinned
  // separately below.
  const stacked = runMonteCarloSimulation(ratedFacts({
    ownQueuedShips: [
      { factionId: 4712, shipyardId: 900, design: 'playerShipTemplate1', constructionStatus: 'building', daysToCompletion: 40 },
      ...waitingRows(4, { shipyardId: 900, design: 'playerShipTemplate999', days: 96 })
    ]
  })).projections.rebuildClock;

  assert.strictEqual(stacked.queuedHullCount, 5, 'five hulls are in the queue');
  assert.strictEqual(stacked.concurrentBuilds, 1, 'but only one of them is building');
  assert.strictEqual(stacked.waitingBehindCount, 4);
  assert.strictEqual(stacked.shipyardsBuilding, 1, 'all five sit at the same yard');
  assert.strictEqual(stacked.monthlyThroughputEst, 0.25,
    'one build at a time is 30 / 120 = 0.25/mo, not the 1.25 the old queue-length divisor printed');
  assert.strictEqual(stacked.daysPerHullEst, 120);

  // Spread the same five hulls across five yards and they ARE concurrent.
  const spread = runMonteCarloSimulation(ratedFacts({ ownQueuedShips: buildingRows(5) }))
    .projections.rebuildClock;
  assert.strictEqual(spread.concurrentBuilds, 5);
  assert.strictEqual(spread.shipyardsBuilding, 5);
  assert.strictEqual(spread.waitingBehindCount, 0);
  assert.strictEqual(spread.monthlyThroughputEst, 1.25, 'five yards really do deliver five times as fast');

  // The Academy's live state on Autosave3: hulls queued, none started. The old
  // model published two hulls' worth of parallel throughput from a faction
  // delivering nothing at all.
  const stalled = runMonteCarloSimulation(ratedFacts({ ownQueuedShips: waitingRows(2) }))
    .projections.rebuildClock;
  assert.strictEqual(stalled.available, true, 'the queue WAS read');
  assert.strictEqual(stalled.queuedHullCount, 2);
  assert.strictEqual(stalled.concurrentBuilds, 0);
  assert.strictEqual(stalled.monthlyThroughputEst, 0,
    'a queue where nothing has started delivers nothing, and that is a measurement');
  assert.strictEqual(stalled.daysPerHullEst, null);
});

test('a queue row with no readable construction status makes the concurrency UNKNOWN, not smaller', () => {
  // `rows.filter(r => r.constructionStatus === 'building').length` counts an
  // unreadable row as "not building" and hands back a confident smaller number
  // -- the `Number(null) === 0` failure wearing a filter.
  const partial = runMonteCarloSimulation(ratedFacts({
    ownQueuedShips: [...buildingRows(3), { factionId: 4712, shipyardId: 77, design: 'playerShipTemplate1' }]
  })).projections.rebuildClock;

  assert.strictEqual(partial.available, false);
  assert.strictEqual(partial.concurrentBuilds, null, 'three-of-four readable is not a concurrency of three');
  assert.strictEqual(partial.monthlyThroughputEst, null);
  assert.strictEqual(partial.queuedHullCount, 4, 'the queue LENGTH was still readable, and is reported');
  assert.match(partial.reason, /construction status could not be read/);
  assert.match(partial.reason, /UNKNOWN rather than smaller/);
});

// ---------------------------------------------------------------------------
// THE DIVIDEND IS A CEILING, SO THE RATE IS A FLOOR
//
// `baseConstructionTimeDays` is not the build time. Ship construction is scaled
// by the yard's tier (TIHabModuleTemplate.json `constructionTimeModifier`:
// SpaceDock 1.0, Shipyard 0.8, Spaceworks 0.6), by other station modules
// (ConstructionModule 0.9, Nanofactory 0.75, NanofacturingComplex 0.6) and by
// faction tech (`Effect_ShipConstructionTimeReduction` x0.8 and three weaker
// variants). Measured on ExitSave.gz 2026-08-22: the observer HOLDS
// `Effect_ShipConstructionTimeReduction` and runs 11 Shipyard modules beside 3
// Space Docks, and across five factions the ratio of a queued hull's own stated
// duration to its hull template's base runs 0.30 to 0.86.
//
// Every one of those modifiers only SHORTENS the build, so a rate derived from
// the template base can only be too low. It is published as a floor, and a
// duration stated by the observer's own queue is used in preference.
// ---------------------------------------------------------------------------
test('the throughput derived from a hull template base is labelled a floor, and a stated duration wins', () => {
  const fromTemplate = runMonteCarloSimulation(ratedFacts()).projections.rebuildClock;
  assert.strictEqual(fromTemplate.buildDays, 120);
  assert.strictEqual(fromTemplate.buildTimeBasis, 'hull-template-base');
  assert.strictEqual(fromTemplate.throughputBound, 'lower',
    'the template base overstates time, so the rate it yields understates throughput');

  // A NON-REFIT hull of the target type waiting in the observer's own queue
  // states its full duration, with yard tier and tech already in it.
  const fromQueue = runMonteCarloSimulation(ratedFacts({
    ownQueuedShips: [...buildingRows(2), ...waitingRows(1, { days: 76.8, shipyardId: 900 })]
  })).projections.rebuildClock;
  assert.strictEqual(fromQueue.buildDays, 76.8, 'the save\'s own figure, not the 120-day template base');
  assert.strictEqual(fromQueue.buildTimeBasis, 'measured-queue-entry');
  assert.strictEqual(fromQueue.throughputBound, 'measured');
  assert.strictEqual(fromQueue.monthlyThroughputEst, 0.781, '30 / (76.8 / 2), to three significant figures');

  // A REFIT is not a build and must not be read as one: refits are far shorter,
  // so treating one as a build time would overstate throughput badly. On
  // ExitSave.gz all five of the observer's entries are Battlecruiser refits at
  // 21.2 days against a 180-day hull base.
  const refitOnly = runMonteCarloSimulation(ratedFacts({
    ownQueuedShips: [...buildingRows(2), ...waitingRows(1, { days: 21.2, isRefit: true })]
  })).projections.rebuildClock;
  assert.strictEqual(refitOnly.buildTimeBasis, 'hull-template-base',
    'a queued refit does not state a build time for the hull');
  assert.strictEqual(refitOnly.buildDays, 120);

  // And a queued hull of a DIFFERENT class states nothing about this one.
  const otherHull = runMonteCarloSimulation(ratedFacts({
    ownQueuedShips: [...buildingRows(2), ...waitingRows(1, { design: 'playerShipTemplate999', days: 30 })]
  })).projections.rebuildClock;
  assert.strictEqual(otherHull.buildTimeBasis, 'hull-template-base');
  assert.strictEqual(otherHull.buildDays, 120);
});

// ---------------------------------------------------------------------------
// A STATION IS NOT A SHIPYARD, AND THE SAVE STATES THE DELIVERY HORIZONS
//
// One station holds several yard modules: measured on ExitSave.gz the
// observer's 14 shipyard modules sit across only 6 habs, five of them on
// Nearchus Station alone. And `daysToCompletion` on a building hull decrements
// by exactly the elapsed campaign days, so it already contains every modifier
// the template base misses -- it is reported as read, never reconstructed.
// ---------------------------------------------------------------------------
test('the shipyard count is of MODULES, and the delivery horizons come from the save', () => {
  const clock = runMonteCarloSimulation(ratedFacts({
    ownQueuedShips: buildingRows(3, { firstDays: 21.2 }),
    ownShipyards: new Array(14).fill({ isShipyard: true, factionId: 4712, constructionStatus: 'operational' })
  })).projections.rebuildClock;

  assert.strictEqual(clock.shipyardCount, 14, 'modules, not the 6 habs they sit on');
  assert.strictEqual(clock.shipyardsBuilding, 3);
  assert.strictEqual(clock.idleShipyardCount, 11, 'the idle capacity is the actionable half');
  assert.strictEqual(clock.nextCompletionDays, 21.2, 'straight from the save, not reconstructed');
  assert.strictEqual(clock.lastCommittedCompletionDays, 23.2);
  assert.strictEqual(clock.deliveriesWithin30Days, 3);
  assert.strictEqual(clock.completionHorizonsUnreadableCount, 0);

  // An unread module manifest is not a faction with no shipyards.
  const noYards = runMonteCarloSimulation(ratedFacts({ ownShipyards: undefined })).projections.rebuildClock;
  assert.strictEqual(noYards.shipyardCount, null, 'absent stays null: not zero yards');
  assert.strictEqual(noYards.idleShipyardCount, null, 'and no idle count is derived from a null total');
  assert.strictEqual(noYards.concurrentBuilds, 2, 'while the queue reading is unaffected');

  // AN UNREADABLE COUNTDOWN MUST NOT SHRINK THE DELIVERY COUNT.
  const partialHorizons = runMonteCarloSimulation(ratedFacts({
    ownQueuedShips: [
      { factionId: 4712, shipyardId: 1, design: 'playerShipTemplate1', constructionStatus: 'building', daysToCompletion: 10 },
      { factionId: 4712, shipyardId: 2, design: 'playerShipTemplate1', constructionStatus: 'building', daysToCompletion: null }
    ]
  })).projections.rebuildClock;
  assert.strictEqual(partialHorizons.completionHorizonsUnreadableCount, 1);
  assert.strictEqual(partialHorizons.deliveriesWithin30Days, null,
    'one readable hull inside 30 days is not a measurement that ONE hull arrives');
  assert.strictEqual(partialHorizons.nextCompletionDays, 10, 'the horizon that WAS read is still reported');
});

// ---------------------------------------------------------------------------
// A THROUGHPUT FLOOR IS NOT A THROUGHPUT MEASUREMENT
//
// `monthlyThroughputEst` was `Math.max(1, Math.round(30 / (days / queued)))`.
// Both halves destroyed the answer at the low end: `Math.round` takes every
// rate under 0.5 to 0, and `Math.max(1, ...)` replaces that 0 with a 1. So a
// hull the observer can finish once every four months was published to the
// dashboard as "~1 hulls/mo" -- a number the model never produced, with
// nothing on the surface marking it as a floor.
//
// The sub-1 answer is the important one rather than an edge case to smooth
// away: "you cannot replace this hull inside a month" and "you replace one a
// month" lead to opposite decisions about accepting an engagement.
//
// EXPECTED VALUES CAPTURED BEFORE THE CHANGE, from the arithmetic rather than
// from the new output: 30 / (120 / 2) is 0.5 and 30 / (120 / 1) is 0.25, and
// the old code printed 1 for both.
// ---------------------------------------------------------------------------
test('the rebuild clock reports the rate it computed, with no floor and no rounding to whole hulls', () => {
  // Each hull at its OWN yard, which is what makes them concurrent.
  const clockFor = (queued, hullDays = 120) => runMonteCarloSimulation(ratedFacts({
    ownQueuedShips: buildingRows(queued),
    shipHullStats: { Monitor: { baseConstructionTimeDays: hullDays } }
  })).projections.rebuildClock;

  // The two cases the floor used to swallow. Both previously printed 1.
  const two = clockFor(2);
  assert.strictEqual(two.available, true);
  assert.strictEqual(two.baseConstructionDays, 120);
  assert.strictEqual(two.concurrentBuilds, 2);
  assert.strictEqual(two.monthlyThroughputEst, 0.5, '30 / (120 / 2) is 0.5, and 0.5 is the answer');
  assert.strictEqual(two.daysPerHullEst, 60, 'the same measurement read the way a sub-1 rate is usable');

  const one = clockFor(1);
  assert.strictEqual(one.monthlyThroughputEst, 0.25, 'a quarter of a hull a month is not one hull a month');
  assert.strictEqual(one.daysPerHullEst, 120);

  // Above 1 the rounding mattered too: 30 / (120 / 5) is 1.25 and printed 1.
  // This is the LIVE SAVE's state (ExitSave.gz, 1/1/2035, both modes).
  assert.strictEqual(clockFor(5).monthlyThroughputEst, 1.25);
  assert.strictEqual(clockFor(5).daysPerHullEst, 24);

  // THREE SIGNIFICANT FIGURES, not two decimal places. A 4,000-day capital
  // hull with one in the queue runs at 0.0075/mo; `round(x, 2)` would print
  // that as 0 -- a confident measured zero standing in for "one every eleven
  // years", which is the same defect in a second costume.
  const glacial = clockFor(1, 4000);
  assert.strictEqual(glacial.monthlyThroughputEst, 0.0075);
  assert.strictEqual(glacial.daysPerHullEst, 4000);
  assert.notStrictEqual(glacial.monthlyThroughputEst, 0,
    'an extremely slow yard is not a stopped yard');

  // And the floor is gone in the direction that matters: nothing here reports
  // a rate of exactly 1 that the arithmetic did not produce.
  for (const queued of [1, 2, 3, 5]) {
    const clock = clockFor(queued);
    assert.strictEqual(clock.monthlyThroughputEst, Number((30 / (120 / queued)).toPrecision(3)),
      `queue of ${queued}: the published rate must equal the computed rate`);
  }
});

// ---------------------------------------------------------------------------
// AN ABSENT SHIPYARD QUEUE IS NOT AN EMPTY ONE
//
// `facts.js` flattened a missing `snapshot.shipyardQueues` to `[]`, so the
// refusal `simulation.js` added at its own boundary (`queuedCount === null`)
// could never fire: nothing upstream could produce a null. A snapshot nobody
// had read the queues from was reported as a faction building nothing, under
// `available: true`, with a measured-looking throughput of 0.
// ---------------------------------------------------------------------------
test('an absent shipyard queue reaches the simulation as null, and an empty one as a measured zero', () => {
  const baseSnapshot = {
    mode: 'player',
    observerFactionId: 4712,
    shipHullStats: { Monitor: { constructionTier: 2, baseConstructionTimeDays: 120 } },
    shipDesigns: [{ factionId: 4712, hullName: 'Monitor', displayName: 'Cimarron', _unnormalizedCombatValue: 19783 }],
    fleets: [{ factionId: 4717, factionName: 'the Aliens', shipsCount: 4, armorMedian: 14 }]
  };

  // Absent entirely.
  assert.strictEqual(extractFacts({ snapshot: baseSnapshot }).ownQueuedShips, null,
    'a snapshot with no shipyardQueues field has an UNREAD queue, not an empty one');
  // Present but not an array is equally unreadable.
  assert.strictEqual(extractFacts({ snapshot: { ...baseSnapshot, shipyardQueues: null } }).ownQueuedShips, null);
  assert.strictEqual(extractFacts({ snapshot: { ...baseSnapshot, shipyardQueues: 'n/a' } }).ownQueuedShips, null);

  // Present and empty is a reading, and stays one.
  assert.deepStrictEqual(extractFacts({ snapshot: { ...baseSnapshot, shipyardQueues: [] } }).ownQueuedShips, [],
    'an empty array was READ, and "this faction is building nothing" is a real finding');
  // Present with entries filters to the observer's own, as before.
  assert.strictEqual(extractFacts({
    snapshot: {
      ...baseSnapshot,
      shipyardQueues: [{ factionId: 4712 }, { factionID: 4712 }, { factionId: 4717 }]
    }
  }).ownQueuedShips.length, 2);

  // It must NOT reach around the intelligence filter to the raw save: shipyard
  // queues are filtered intelligence, unlike the static hull/design reference
  // data above them.
  assert.strictEqual(
    extractFacts({ snapshot: baseSnapshot, rawSnapshot: { shipyardQueues: [{ factionId: 4712 }] } }).ownQueuedShips,
    null,
    'unreadable through the filter stays unreadable'
  );

  // End to end: the refusal that could never fire now fires.
  const unread = generateStrategicCommentary({ snapshot: baseSnapshot, snapshotId: 'absent-queue-seed' })
    .simulation.projections.rebuildClock;
  assert.strictEqual(unread.available, false, 'a queue nobody read is not a queue of zero ships');
  assert.strictEqual(unread.queuedHullCount, null);
  assert.strictEqual(unread.concurrentBuilds, null);
  assert.strictEqual(unread.monthlyThroughputEst, null);
  assert.match(unread.reason, /no readable shipyard queue/);
  assert.match(unread.reason, /not a report of zero throughput/);

  const read = generateStrategicCommentary({
    snapshot: { ...baseSnapshot, shipyardQueues: [] },
    snapshotId: 'absent-queue-seed'
  }).simulation.projections.rebuildClock;
  assert.strictEqual(read.available, true, 'and reading an empty queue still succeeds');
  assert.strictEqual(read.monthlyThroughputEst, 0);
});

// ---------------------------------------------------------------------------
// FOUR REASONS FOR NO HATE-VENT HORIZON, AND THEY ARE NOT THE SAME REASON
//
// The projection was `null` behind one four-clause `if`, so every reason
// arrived at the consumer identically. One of the four is player mode's
// redaction of `actualAlienHate` -- under which the first clause can never
// pass, so player mode could not produce a horizon under ANY campaign state
// and said so with the same silence it uses for "hostility is below the
// floor". An unmeasurable input reported as a reassuring finding is the shape
// of the Total War veto defect in CLAUDE.md.
// ---------------------------------------------------------------------------
test('the hate vent horizon tells its four unavailable states apart, and never reports redaction as calm', () => {
  const vent = (overrides) => runMonteCarloSimulation(ratedFacts(overrides)).projections.hateVent;

  // 1. Redacted hate. This is the ONLY branch player mode can reach.
  const redacted = vent({ actualAlienHate: null, hateVentRatePerDay: -0.4 });
  assert.strictEqual(redacted.available, false);
  assert.strictEqual(redacted.projectedDaysLow, null, 'absent stays null: not a horizon of zero days');
  assert.match(redacted.reason, /redacted outright/);
  assert.match(redacted.reason, /NOT a report that hostility is stable/);

  // 2. Hate is readable but the TREND is not.
  const noTrend = vent({ actualAlienHate: 168, hateVentRatePerDay: null });
  assert.strictEqual(noTrend.available, false);
  assert.match(noTrend.reason, /no hate trend could be measured/);
  assert.match(noTrend.reason, /NOT a report that hostility is flat/);

  // 3. Hate is RISING. A measured finding, and the opposite of the above.
  const rising = vent({ actualAlienHate: 168, hateVentRatePerDay: 0.4 });
  assert.strictEqual(rising.available, false);
  assert.match(rising.reason, /not venting/);

  // 4. Already below the threshold. Also a measured finding.
  const belowFloor = vent({ actualAlienHate: 42.86, hateVentRatePerDay: -0.4 });
  assert.strictEqual(belowFloor.available, false);
  assert.match(belowFloor.reason, /at or below the 50 war threshold/);
  assert.match(belowFloor.reason, /MEASURED state/);

  // All four are distinguishable from each other, which the single `null` was not.
  const reasons = [redacted.reason, noTrend.reason, rising.reason, belowFloor.reason];
  assert.strictEqual(new Set(reasons).size, 4, 'four states, four reasons');

  // And the available path still produces a band, unchanged.
  const venting = vent({ actualAlienHate: 168, hateVentRatePerDay: -0.4 });
  assert.strictEqual(venting.available, true);
  assert.strictEqual(venting.currentHate, 168);
  assert.match(venting.bandLabel, /^\d+–\d+ campaign days$/);
});
