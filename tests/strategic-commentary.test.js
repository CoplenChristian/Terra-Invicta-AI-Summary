// tests/strategic-commentary.test.js
//
// Purpose: characterisation tests for the Strategic Commentary React panel.
// Drives a real browser through the primitives harness (see mc-budget pattern).

const { test } = require('node:test');
const assert = require('node:assert');
const {
  withStrategicCommentaryHarnessPage,
  getHarnessHtml,
  getHarnessText,
  getModeBadgeText,
  visibleText,
} = require('./fixtures/strategicCommentaryBrowser');
const { loadFixtureFilteredSnapshot } = require('./fixtures/frozenSnapshots');
const { generateStrategicCommentary } = require('../server/commentary');
const { runMonteCarloSimulation } = require('../server/commentary/simulation');

const FORBIDDEN = ['null', 'undefined', 'NaN', '[object Object]'];

function assertNoPlaceholderText(html, label) {
  const text = visibleText(html);
  for (const token of FORBIDDEN) {
    const index = text.indexOf(token);
    assert.strictEqual(
      index,
      -1,
      `${label}: rendered text contains "${token}" near: ${text.slice(Math.max(0, index - 60), index + 60)}`
    );
  }
}

function loadCommentaryFixture(mode) {
  const snapshot = loadFixtureFilteredSnapshot({ mode });
  return generateStrategicCommentary({
    snapshot,
    snapshotId: snapshot.snapshotId || 'fixture',
  });
}

function makeUncertainty(overrides = {}) {
  return {
    isMeasurement: false,
    seedsSimulated: 120,
    battleTrialsPerCount: 30,
    maxHullsSwept: 24,
    targetWinProbability: 0.8,
    winnableSeeds: 120,
    winnableRatio: 1,
    opponentRatingCalibrated: false,
    opponentRatingBasis: 'UNCALIBRATED ASSUMPTION.',
    bandCovers: 'run-to-run variance of this stochastic model across 120 seeded runs of 30 battle trials per hull count. Nothing else.',
    bandExcludes: [
      'uncertainty in the opponent ratings themselves.',
      'seeds in which no count up to 24 hulls reached P(win) 0.8.',
      'model misspecification.',
    ],
    bandComputedOver: 'the winnable seeds only',
    ...overrides,
  };
}

function makeCommentary(overrides = {}) {
  const uncertainty = makeUncertainty();
  return {
    available: true,
    mode: 'player',
    snapshotId: 'commentary-seed',
    headline: 'Hold Posture: Defending holdings while closing the delta-V deficit',
    prose: 'Current campaign telemetry indicates stable operational posture across major theaters.',
    beats: [{
      id: 'capability-gap-widening',
      name: 'Decisive Force Deficit',
      severity: 'watch',
      stance: 'defensive',
      summary: 'Decisive deficit on delta-V (16.9 km/s ours vs 211 km/s alien).',
    }],
    simulation: {
      available: true,
      reason: null,
      source: 'observable_fleet_telemetry',
      ownBestHull: 'Monitor',
      ownBestDesign: 'Cimarron',
      ownRating: 19783,
      tiers: [{
        id: 'typical-alien-combatant',
        label: '1x typical alien combatant',
        description: 'Observed mainline combat element (median armor 8.8cm)',
        winnable: true,
        p20: 2,
        p80: 2,
        bandLabel: '2 hulls',
        simulated: true,
        uncertainty,
      }],
      projections: {
        hateVent: null,
        rebuildClock: {
          available: true,
          targetHull: 'Monitor',
          concurrentBuilds: 5,
          waitingBehindCount: 0,
          shipyardCount: 14,
          nextCompletionDays: 21.2,
          throughputBound: 'lower',
          monthlyThroughputEst: 1.25,
          daysPerHullEst: 24,
        },
      },
    },
    ...overrides,
  };
}

/** An observer with designs but not one combat value between them. */
const unratedFacts = (mode) => ({
  mode,
  snapshotId: 'unrated-observer-seed',
  observerId: 4712,
  observerName: 'the Initiative',
  shipDesigns: [
    { factionId: 4712, hullName: 'Monitor', displayName: 'Cimarron' },
    { factionId: 4717, hullName: 'Alien Cruiser', _unnormalizedCombatValue: 90000 },
  ],
  shipHullStats: { Monitor: { baseConstructionTimeDays: 120, constructionTier: 2 } },
  alienFleets: [{ shipsCount: 4, armorMedian: 14.0, lowestDeltaVKps: 180 }],
  ownQueuedShips: [{ factionId: 4712 }],
  actualAlienHate: mode === 'omniscient' ? 168 : null,
  hateVentRatePerDay: mode === 'omniscient' ? -0.4 : null,
});

// ---------------------------------------------------------------------------
// 1. NORMAL RENDER: PLAYER AND OMNISCIENT
// ---------------------------------------------------------------------------

for (const mode of ['player', 'omniscient']) {
  test(`strategic-commentary renders frozen ${mode} fixture with headline, tiers, and uncertainty qualifiers`, async () => {
    const payload = loadCommentaryFixture(mode);
    assert.strictEqual(payload.available, true, 'fixture must produce available commentary');

    await withStrategicCommentaryHarnessPage(payload, async (page) => {
      const html = await getHarnessHtml(page);
      const text = await getHarnessText(page);
      const badge = await getModeBadgeText(page);

      assert.ok(text.includes(payload.headline), 'headline must render');
      assert.ok(text.includes(payload.prose.slice(0, 40)), 'prose must render');
      assert.ok(text.includes('COMBAT THRESHOLDS'), 'simulation section header must render');
      assert.ok(text.includes('MONTE CARLO SIMULATED'), 'simulation badge must render');

      for (const tier of payload.simulation.tiers) {
        assert.ok(text.includes(tier.bandLabel), `tier band "${tier.bandLabel}" must still render`);
      }

      assert.ok(text.includes('p20–p80 over 120 seeds'), 'defect #13 fix: band qualifier must surface uncertainty');
      assert.ok(text.includes('What these hull counts mean'), 'defect #13 fix: uncertainty footnote must be present');
      assert.ok(!text.includes('UNWINNABLE'), 'winnable tiers must not render UNWINNABLE');

      const expectedBadge = payload.mode === 'omniscient' ? 'OMNISCIENT BLUEPRINTS' : 'OBSERVED TELEMETRY';
      assert.strictEqual(badge, expectedBadge, 'external mode badge must update via effect');

      assertNoPlaceholderText(html, `${mode} normal render`);
    });
  });
}

// ---------------------------------------------------------------------------
// 2. UNAVAILABLE PAYLOAD AND ABSENT INPUT
// ---------------------------------------------------------------------------

test('strategic-commentary renders available:false with carried reason', async () => {
  await withStrategicCommentaryHarnessPage({
    available: false,
    reason: 'Strategic commentary is not produced for this observer.',
  }, async (page) => {
    const text = await getHarnessText(page);
    assert.ok(text.includes('Strategic commentary is not produced for this observer.'));
    assert.ok(!text.includes('COMBAT THRESHOLDS'));
  });
});

test('strategic-commentary handles absent input with honest unavailable state', async () => {
  await withStrategicCommentaryHarnessPage(null, async (page) => {
    const text = await getHarnessText(page);
    assert.ok(text.includes('Strategic commentary telemetry unavailable for this save.'));
  });

  await withStrategicCommentaryHarnessPage(undefined, async (page) => {
    const text = await getHarnessText(page);
    assert.ok(text.includes('Strategic commentary telemetry unavailable for this save.'));
  });
});

// ---------------------------------------------------------------------------
// 3. ABSENT BEATS, ABSENT SIMULATION, UNAVAILABLE SWEEP
// ---------------------------------------------------------------------------

test('strategic-commentary omits beats grid when beats array is absent', async () => {
  const payload = makeCommentary({ beats: undefined });
  await withStrategicCommentaryHarnessPage(payload, async (page) => {
    const html = await getHarnessHtml(page);
    assert.ok(!html.includes('commentary-beats-grid'));
    assert.ok((await getHarnessText(page)).includes(payload.headline));
  });
});

test('strategic-commentary omits simulation block when simulation is absent', async () => {
  const payload = makeCommentary({ simulation: undefined });
  await withStrategicCommentaryHarnessPage(payload, async (page) => {
    const text = await getHarnessText(page);
    assert.ok(!text.includes('COMBAT THRESHOLDS'));
    assert.ok(!text.includes('PRODUCTION THROUGHPUT'), 'projections must also be absent when simulation block is absent');
  });
});

test('strategic-commentary renders unavailable sweep reason instead of vanishing', async () => {
  const sim = runMonteCarloSimulation(unratedFacts('player'));
  const payload = makeCommentary({
    simulation: { ...sim, reason: sim.reason },
  });

  await withStrategicCommentaryHarnessPage(payload, async (page) => {
    const text = await getHarnessText(page);
    assert.match(text, /NOT SIMULATED/);
    assert.ok(text.includes('No default rating is substituted'));
    assert.doesNotMatch(text, /UNWINNABLE/);
    assert.doesNotMatch(text, /\d+\s*(–|-)?\s*\d*\s*hulls?\b/);
    assertNoPlaceholderText(await getHarnessHtml(page), 'unavailable sweep');
  });
});

// ---------------------------------------------------------------------------
// 4. DEFECT FIXES: UNCERTAINTY (#13) AND BEYOND-RANGE (#14)
// ---------------------------------------------------------------------------

test('strategic-commentary renders winnable:false as more than N hulls, never UNWINNABLE', async () => {
  const payload = makeCommentary({
    simulation: {
      available: true,
      ownBestDesign: 'Cimarron',
      tiers: [{
        id: 'heavy-alien-capital',
        label: '1x heavy alien capital (p90)',
        description: 'Observed heavy capital force (p90 armor 14.0cm)',
        winnable: false,
        p20: null,
        p80: null,
        bandLabel: 'Not winnable at any count simulated (≤24)',
        simulated: true,
        uncertainty: makeUncertainty({ winnableSeeds: 0, winnableRatio: 0 }),
      }],
      projections: {},
    },
  });

  await withStrategicCommentaryHarnessPage(payload, async (page) => {
    const text = await getHarnessText(page);
    assert.ok(text.includes('more than 24 hulls'), 'defect #14 fix: ceiling report must use beyond-range wording');
    assert.ok(!text.includes('UNWINNABLE'), 'defect #14 fix: must not print UNWINNABLE');
    assert.ok(!text.includes('Not winnable at any count simulated'), 'misleading bandLabel must not reach the reader');
  });
});

test('strategic-commentary renders unknown winnable state as UNAVAILABLE, not UNWINNABLE', async () => {
  const payload = makeCommentary({
    simulation: {
      available: true,
      ownBestDesign: 'Cimarron',
      tiers: [{
        id: 'unknown-tier',
        label: '1x unknown tier',
        description: 'Tier with unread winnability',
        winnable: null,
        bandLabel: '2 hulls',
        simulated: true,
        uncertainty: makeUncertainty(),
      }],
      projections: {},
    },
  });

  await withStrategicCommentaryHarnessPage(payload, async (page) => {
    const text = await getHarnessText(page);
    assert.ok(text.includes('UNAVAILABLE'));
    assert.ok(!text.includes('UNWINNABLE'), 'unknown winnable must not read as a definite negative claim');
  });
});

test('strategic-commentary surfaces partial-seed warning when winnableRatio is below 1', async () => {
  const payload = makeCommentary({
    simulation: {
      available: true,
      ownBestDesign: 'Cimarron',
      tiers: [{
        id: 'typical-alien-combatant',
        label: '1x typical alien combatant',
        description: 'Observed mainline combat element',
        winnable: true,
        bandLabel: '3–4 hulls',
        simulated: true,
        uncertainty: makeUncertainty({ winnableSeeds: 60, winnableRatio: 0.5 }),
      }],
      projections: {},
    },
  });

  await withStrategicCommentaryHarnessPage(payload, async (page) => {
    const text = await getHarnessText(page);
    assert.ok(text.includes('3–4 hulls'));
    assert.ok(text.includes('band over 50% of seeds only'));
    assert.ok(text.includes('only 50% of seeds reached the target'));
  });
});
