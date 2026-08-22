/**
 * server/commentary/simulation.js
 * Purpose: Layer 3 of the strategic commentary — the opponent-tier builders and
 *   projection simulator over the shared Monte Carlo engagement sweep.
 *
 * Layer 3 — opponent tiers and projections.
 *
 * The SWEEP ITSELF moved to `shared/engagementModel.mjs` on 2026-08-22 so the
 * hosted Cloudflare worker can run the same model for the per-fleet THREAT
 * estimates in `shared/fleetEngagement.mjs`, which reach the AI markdown
 * exports the worker renders. Per CLAUDE.md a split re-exports the SAME
 * function objects rather than wrapping them, so reference-identity holds and
 * no caller moved. The model is unchanged: `findRequiredHullsForTier` gained an
 * optional `maxHulls` that defaults to `MAX_SIMULATED_HULLS`, and every call
 * here still uses that default, so every tier sweeps exactly the range it
 * always swept.
 *
 * What stayed here is what only the commentary needs: the two mode-specific
 * opponent-tier builders and `runMonteCarloSimulation`.
 *
 * Requirements from docs/archive/strategic-commentary-and-layout-plan.md & Review:
 * 1. Player-First: Uses observable alien fleet telemetry in player mode;
 *    never relies on redacted shipDesigns CVs in player mode.
 * 2. Zero-Opponent Guard: Empty opponent list resolves to unavailable, NEVER P(win) = 1.0.
 * 3. Seeded PRNG: Mulberry32 seeded by snapshotId ensures byte-identical results per save.
 * 4. Ranges as Output: p20-p80 percentile bands across 120 seeds (e.g. "4" or "4–5").
 * 5. Unwinnable Handling: If P(win) < 0.80 up to max hulls, reports explicit unwinnable message.
 * 6. Visual Metadata: Simulated numbers are stamped with simulated: true.
 *
 * What the p20-p80 band is and is not, and why "not winnable at any count
 * simulated" is a ceiling report rather than an impossibility verdict, are
 * documented at the top of `shared/engagementModel.mjs`.
 */

'use strict';

const { samplePercentile } = require('./prng');
const { toFiniteNumber, sameId } = require('../../shared/util.mjs');
const {
  BATTLE_TRIALS_PER_COUNT,
  MAX_SIMULATED_HULLS,
  OPPONENT_RATING_BASIS,
  SIMULATION_SEEDS_COUNT,
  TARGET_WIN_PROBABILITY,
  describeBandUncertainty,
  findRequiredHullsForTier,
  guaranteedWinHullCount,
  simulateEngagement
} = require('../../shared/engagementModel.mjs');

/**
 * Builds opponent tiers from observable fleet metrics (Player Mode).
 *
 * The 0.7 / 1.5 / 4.0 multipliers below have no shipped source. See
 * OPPONENT_RATING_BASIS.player -- they are assumptions, and the threshold bands
 * they produce inherit that.
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
  let opponentRatingBasis = OPPONENT_RATING_BASIS.player;

  if (mode === 'omniscient') {
    const alienDesigns = (Array.isArray(shipDesigns) ? shipDesigns : []).filter(
      d => d.factionName === 'the Aliens' || sameId(d.factionId, 4717)
    );
    opponentTiers = buildOmniscientOpponentTiers(alienDesigns);
    opponentSource = 'true_design_blueprints';
    opponentRatingBasis = OPPONENT_RATING_BASIS.omniscient;
  } else {
    opponentTiers = buildPlayerOpponentTiers(alienFleets, ownRating);
    opponentSource = 'observable_fleet_telemetry';
    opponentRatingBasis = OPPONENT_RATING_BASIS.player;
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
    const result = findRequiredHullsForTier(
      ownRating,
      tier.opponentRating,
      `${snapshotId}-${tier.id}`,
      { opponentRatingBasis }
    );
    tierResults.push({
      id: tier.id,
      label: tier.label,
      description: tier.description,
      winnable: result.winnable,
      p20: result.p20,
      p80: result.p80,
      bandLabel: result.bandLabel,
      simulated: true,
      // The band never travels without what it covers. A consumer that renders
      // `bandLabel` alone would otherwise present Monte Carlo spread as though
      // it were the total uncertainty.
      uncertainty: result.uncertainty
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
  buildPlayerOpponentTiers,
  buildOmniscientOpponentTiers,
  // Re-exported, not re-implemented: these are the SAME function objects
  // `shared/engagementModel.mjs` defines, so `require('./simulation')
  // .simulateEngagement === require('shared/engagementModel.mjs')
  // .simulateEngagement` and no caller of the old path moved.
  simulateEngagement,
  findRequiredHullsForTier,
  describeBandUncertainty,
  guaranteedWinHullCount,
  OPPONENT_RATING_BASIS,
  SIMULATION_SEEDS_COUNT,
  MAX_SIMULATED_HULLS,
  TARGET_WIN_PROBABILITY,
  BATTLE_TRIALS_PER_COUNT
};
