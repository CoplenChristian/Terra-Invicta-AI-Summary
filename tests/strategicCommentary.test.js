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
