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
// ---------------------------------------------------------------------------
test('Commentary panel: an unavailable sweep renders its reason instead of vanishing', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');

  const componentPath = path.join(__dirname, '..', 'public', 'v2', 'js',
    'components', 'strategic-commentary.js');
  const elements = {
    strategicCommentary: { innerHTML: '' },
    commentaryModeBadge: { textContent: '' }
  };
  const sandbox = {
    window: {},
    console,
    document: { getElementById: (id) => elements[id] || null }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(componentPath, 'utf8'), sandbox, { filename: componentPath });

  const sim = runMonteCarloSimulation(unratedFacts('player'));
  sandbox.window.MissionControlStrategicCommentary.renderStrategicCommentary({
    available: true,
    mode: 'player',
    headline: 'Campaign Intelligence Assessment: Status quo across major theaters',
    prose: 'Current campaign telemetry indicates stable operational posture.',
    beats: [],
    simulation: { ...sim, reason: sim.reason }
  });

  const html = elements.strategicCommentary.innerHTML;
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

  assert.match(text, /NOT SIMULATED/, 'the panel says the sweep did not run');
  assert.ok(text.includes('No default rating is substituted'),
    'the reason reaches the reader rather than being swallowed');
  assert.doesNotMatch(text, /UNWINNABLE/,
    '"could not be run" must not render as "was run and lost"');
  assert.doesNotMatch(text, /\d+\s*(–|-)?\s*\d*\s*hulls?\b/,
    'no hull COUNT may be shown for a sweep that never ran');
  for (const token of ['null', 'undefined', 'NaN', '[object Object]']) {
    assert.ok(!text.includes(token), `rendered text contains "${token}"`);
  }
});
