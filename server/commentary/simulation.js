/**
 * server/commentary/simulation.js
 *
 * Layer 3 — Monte Carlo threshold cruncher and projection simulator.
 *
 * Requirements from docs/archive/strategic-commentary-and-layout-plan.md & Review:
 * 1. Player-First: Uses observable alien fleet telemetry in player mode;
 *    never relies on redacted shipDesigns CVs in player mode.
 * 2. Zero-Opponent Guard: Empty opponent list resolves to unavailable, NEVER P(win) = 1.0.
 * 3. Seeded PRNG: Mulberry32 seeded by snapshotId ensures byte-identical results per save.
 * 4. Ranges as Output: p20-p80 percentile bands across 120 seeds (e.g. "4" or "4–5").
 * 5. Unwinnable Handling: If P(win) < 0.80 up to max hulls, reports explicit unwinnable message.
 * 6. Visual Metadata: Simulated numbers are stamped with simulated: true.
 */

'use strict';

const { createPrng, samplePercentile } = require('./prng');
const { toFiniteNumber, sameId } = require('../../shared/util.mjs');

const SIMULATION_SEEDS_COUNT = 120;
const MAX_SIMULATED_HULLS = 24;
const TARGET_WIN_PROBABILITY = 0.80;

/**
 * Combat outcome model for Lanchester / stochastic battle evaluation.
 * Returns probability that `ownCount` of `ownForce` defeats `opponentForce`.
 */
function simulateEngagement(ownCount, ownRating, opponentRating, prng) {
  // Stochastic Lanchester engagement with roll variance
  // Force effectiveness scales with rating and square root of count
  let ownWins = 0;
  const BATTLE_TRIALS = 30;

  for (let t = 0; t < BATTLE_TRIALS; t++) {
    // 0.8 - 1.2 tactical roll per engagement
    const ownRoll = (0.8 + 0.4 * prng.nextFloat()) * (ownCount * ownRating);
    const opponentRoll = (0.8 + 0.4 * prng.nextFloat()) * opponentRating;

    if (ownRoll > opponentRoll * 1.1) {
      ownWins += 1;
    } else if (ownRoll > opponentRoll * 0.9) {
      // Contested engagement outcome proportional to ratio
      const winProb = ownRoll / (ownRoll + opponentRoll);
      if (prng.nextFloat() < winProb) ownWins += 1;
    }
  }

  return ownWins / BATTLE_TRIALS;
}

/**
 * Sweeps hull counts from 1 to MAX_SIMULATED_HULLS to find the minimum count for P(win) >= 0.80.
 */
function findRequiredHullsForTier(ownRating, opponentRating, baseSeed) {
  const seedResults = [];

  for (let s = 0; s < SIMULATION_SEEDS_COUNT; s++) {
    const prng = createPrng(`${baseSeed}-seed-${s}`);
    let neededHulls = null;

    for (let count = 1; count <= MAX_SIMULATED_HULLS; count++) {
      const pWin = simulateEngagement(count, ownRating, opponentRating, prng);
      if (pWin >= TARGET_WIN_PROBABILITY) {
        neededHulls = count;
        break;
      }
    }

    seedResults.push(neededHulls);
  }

  // Filter out unwinnable seeds
  const winnableSeeds = seedResults.filter(r => r !== null).sort((a, b) => a - b);
  const winnableRatio = winnableSeeds.length / SIMULATION_SEEDS_COUNT;

  if (winnableRatio < 0.5 || winnableSeeds.length === 0) {
    return {
      winnable: false,
      p20: null,
      p80: null,
      bandLabel: 'Not winnable at any count simulated (≤24)',
      simulated: true
    };
  }

  const p20 = Math.round(samplePercentile(winnableSeeds, 0.2));
  const p80 = Math.round(samplePercentile(winnableSeeds, 0.8));
  const bandLabel = p20 === p80 ? `${p20}` : `${p20}–${p80}`;

  return {
    winnable: true,
    p20,
    p80,
    bandLabel: `${bandLabel} hulls`,
    simulated: true
  };
}

/**
 * Builds opponent tiers from observable fleet metrics (Player Mode).
 */
function buildPlayerOpponentTiers(alienFleets, ownRating) {
  if (!Array.isArray(alienFleets) || alienFleets.length === 0) {
    return null;
  }

  // Extract fleet sizes and armor medians
  const fleetSizes = alienFleets.map(f => toFiniteNumber(f.shipsCount) || 1).sort((a, b) => a - b);
  const armors = alienFleets.map(f => toFiniteNumber(f.armorMedian) || 10).sort((a, b) => a - b);

  const medianArmor = samplePercentile(armors, 0.5) || 12;
  const p90Armor = samplePercentile(armors, 0.9) || 24;

  // Rating calibrated against own rating
  const baseEscortRating = ownRating * 0.7 * (medianArmor / 10);
  const baseTypicalRating = ownRating * 1.5 * (medianArmor / 10);
  const baseHeavyRating = ownRating * 4.0 * (p90Armor / 10);

  return [
    {
      id: 'median-alien-escort',
      label: '1x median alien escort / patrol',
      opponentRating: baseEscortRating,
      description: `Observed median patrol signature (median armor ${medianArmor.toFixed(1)}cm)`
    },
    {
      id: 'typical-alien-combatant',
      label: '1x typical alien combatant',
      opponentRating: baseTypicalRating,
      description: `Observed mainline combat element (median armor ${medianArmor.toFixed(1)}cm)`
    },
    {
      id: 'two-typical-aliens',
      label: '2x typical alien combatants',
      opponentRating: baseTypicalRating * 2.0,
      description: 'Typical paired combat element'
    },
    {
      id: 'heavy-alien-capital',
      label: '1x heavy alien capital (p90)',
      opponentRating: baseHeavyRating,
      description: `Observed heavy capital force (p90 armor ${p90Armor.toFixed(1)}cm)`
    },
    {
      id: 'three-typical-aliens',
      label: '3x typical alien strike group',
      opponentRating: baseTypicalRating * 3.0,
      description: 'Coordinated strike element (3 mainline ships)'
    }
  ];
}

/**
 * Builds opponent tiers from true design CVs (Omniscient Mode).
 */
function buildOmniscientOpponentTiers(alienDesigns) {
  if (!Array.isArray(alienDesigns) || alienDesigns.length === 0) {
    return null;
  }

  const cvs = alienDesigns
    .map(d => toFiniteNumber(d._unnormalizedCombatValue))
    .filter(v => v !== null && v > 0)
    .sort((a, b) => a - b);

  if (cvs.length === 0) return null;

  const p10Cv = samplePercentile(cvs, 0.1) || 3250;
  const p50Cv = samplePercentile(cvs, 0.5) || 20330;
  const p90Cv = samplePercentile(cvs, 0.9) || 70100;

  return [
    {
      id: 'median-alien-escort',
      label: '1x median alien escort',
      opponentRating: p10Cv,
      description: `P10 alien design rating (${Math.round(p10Cv).toLocaleString()} CV)`
    },
    {
      id: 'typical-alien-combatant',
      label: '1x typical alien',
      opponentRating: p50Cv,
      description: `Median alien design rating (${Math.round(p50Cv).toLocaleString()} CV)`
    },
    {
      id: 'two-typical-aliens',
      label: '2x typical alien',
      opponentRating: p50Cv * 2.0,
      description: `2x median alien designs (${Math.round(p50Cv * 2).toLocaleString()} CV)`
    },
    {
      id: 'heavy-alien-capital',
      label: '1x heavy alien (p90)',
      opponentRating: p90Cv,
      description: `P90 heavy capital design (${Math.round(p90Cv).toLocaleString()} CV)`
    },
    {
      id: 'three-typical-aliens',
      label: '3x typical alien',
      opponentRating: p50Cv * 3.0,
      description: `3x median alien designs (${Math.round(p50Cv * 3).toLocaleString()} CV)`
    }
  ];
}

/**
 * Runs Monte Carlo combat threshold and strategic projections simulation.
 */
function runMonteCarloSimulation(facts) {
  const {
    mode,
    snapshotId,
    alienFleets,
    shipDesigns,
    shipHullStats,
    actualAlienHate,
    hateVentRatePerDay,
    ownQueuedShips,
    observerId
  } = facts;

  // 1. Determine Own Best Combat Hull
  const ownDesigns = (Array.isArray(shipDesigns) ? shipDesigns : []).filter(
    d => sameId(d.factionId, observerId)
  );

  let ownRating = 5000; // default baseline
  let ownBestHullName = 'Combat Hull';
  let ownBestDesignName = 'Standard Combatant';

  if (ownDesigns.length > 0) {
    const withCv = ownDesigns.filter(d => toFiniteNumber(d._unnormalizedCombatValue) !== null);
    if (withCv.length > 0) {
      withCv.sort((a, b) => b._unnormalizedCombatValue - a._unnormalizedCombatValue);
      ownRating = withCv[0]._unnormalizedCombatValue;
      ownBestHullName = withCv[0].hullName || 'Battlecruiser';
      ownBestDesignName = withCv[0].displayName || withCv[0]._displayName || ownBestHullName;
    }
  }

  // 2. Build Opponent Tiers (Player vs Omniscient)
  let opponentTiers = null;
  let opponentSource = 'observable_fleet_telemetry';

  if (mode === 'omniscient') {
    const alienDesigns = (Array.isArray(shipDesigns) ? shipDesigns : []).filter(
      d => d.factionName === 'the Aliens' || sameId(d.factionId, 4717)
    );
    opponentTiers = buildOmniscientOpponentTiers(alienDesigns);
    opponentSource = 'true_design_blueprints';
  } else {
    opponentTiers = buildPlayerOpponentTiers(alienFleets, ownRating);
    opponentSource = 'observable_fleet_telemetry';
  }

  // Zero-Opponent Guard: if no opponents are observable, return explicit unavailable state
  if (!opponentTiers || opponentTiers.length === 0) {
    return {
      available: false,
      reason: 'No alien forces visible in this intelligence picture; simulation unavailable.',
      ownBestHull: ownBestHullName,
      ownBestDesign: ownBestDesignName,
      tiers: [],
      projections: {}
    };
  }

  // 3. Simulate Combat Thresholds for Each Opponent Tier
  const tierResults = [];
  for (const tier of opponentTiers) {
    const result = findRequiredHullsForTier(ownRating, tier.opponentRating, `${snapshotId}-${tier.id}`);
    tierResults.push({
      id: tier.id,
      label: tier.label,
      description: tier.description,
      winnable: result.winnable,
      p20: result.p20,
      p80: result.p80,
      bandLabel: result.bandLabel,
      simulated: true
    });
  }

  // 4. Hate Vent Projection
  let hateVentProjection = null;
  if (actualAlienHate !== null && actualAlienHate > 50 && hateVentRatePerDay !== null && hateVentRatePerDay < 0) {
    const daysToClear = (actualAlienHate - 50) / Math.abs(hateVentRatePerDay);
    const lowDays = Math.max(1, Math.round(daysToClear * 0.85));
    const highDays = Math.max(lowDays + 1, Math.round(daysToClear * 1.15));
    hateVentProjection = {
      available: true,
      currentHate: actualAlienHate,
      ventRatePerDay: hateVentRatePerDay,
      projectedDaysLow: lowDays,
      projectedDaysHigh: highDays,
      bandLabel: `${lowDays}–${highDays} campaign days`,
      simulated: true
    };
  }

  // 5. Rebuild Throughput Projection
  const baseHullStat = shipHullStats[ownBestHullName] || {};
  const baseBuildDays = toFiniteNumber(baseHullStat.baseConstructionTimeDays) || 60;
  const queuedCount = Array.isArray(ownQueuedShips) ? ownQueuedShips.length : 0;

  const rebuildProjection = {
    available: true,
    targetHull: ownBestHullName,
    baseConstructionDays: baseBuildDays,
    activeShipyardQueues: queuedCount,
    monthlyThroughputEst: Math.max(1, Math.round(30 / (baseBuildDays / Math.max(1, queuedCount || 2)))),
    simulated: true
  };

  return {
    available: true,
    source: opponentSource,
    ownBestHull: ownBestHullName,
    ownBestDesign: ownBestDesignName,
    ownRating: Math.round(ownRating),
    tiers: tierResults,
    projections: {
      hateVent: hateVentProjection,
      rebuildClock: rebuildProjection
    }
  };
}

module.exports = {
  runMonteCarloSimulation,
  simulateEngagement,
  findRequiredHullsForTier,
  buildPlayerOpponentTiers,
  buildOmniscientOpponentTiers,
  SIMULATION_SEEDS_COUNT,
  MAX_SIMULATED_HULLS
};
