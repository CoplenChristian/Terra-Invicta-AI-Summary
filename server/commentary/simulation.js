/**
 * server/commentary/simulation.js
 * Purpose: Layer 3 of the strategic commentary — the Monte Carlo threshold
 *   cruncher and projection simulator.
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
 *
 * ---------------------------------------------------------------------------
 * WHAT THE p20-p80 BAND IS, AND WHAT IT IS NOT
 * ---------------------------------------------------------------------------
 *
 * Corrected 2026-08-21 — see docs/model-verification-review.md "Claim 7". A
 * band emitted as "4–5 hulls" reads as a measurement with an error bar. It is
 * not one, and every result now carries an `uncertainty` block saying so. Three
 * confirmed reasons the band is NARROWER than the true uncertainty:
 *
 *   1. It captures ONLY Monte Carlo variance across seeds. It does not capture
 *      the (larger) uncertainty in the opponent ratings themselves. In player
 *      mode those are invented calibration constants -- ownRating x 0.7 / 1.5 /
 *      4.0, each x (armor / 10). There is no game source for "a typical alien
 *      is 1.5x your best hull"; that is an assumption, not a measurement.
 *   2. It is computed over WINNABLE SEEDS ONLY. Seeds where no count <= 24
 *      reaches P(win) 0.80 are dropped before the percentiles are taken, which
 *      understates the spread whenever a meaningful share of seeds is
 *      unwinnable. `winnableRatio` is now surfaced rather than discarded.
 *   3. The engagement model is LINEAR in count (ownCount x ownRating), not the
 *      Lanchester square law. That is a deliberate conservative simplification
 *      which UNDERSTATES the value of numerical superiority.
 *
 * The fix is to state the limitation, never to widen the band by a factor
 * nobody can compute -- inventing a wider number would be the same defect in
 * the opposite direction.
 */

'use strict';

const { createPrng, samplePercentile } = require('./prng');
const { toFiniteNumber, sameId } = require('../../shared/util.mjs');

const SIMULATION_SEEDS_COUNT = 120;
const MAX_SIMULATED_HULLS = 24;
const TARGET_WIN_PROBABILITY = 0.80;
const BATTLE_TRIALS_PER_COUNT = 30;

/** What the band leaves out. Shared verbatim by the per-tier and summary blocks. */
const BAND_EXCLUSIONS = Object.freeze([
  'uncertainty in the opponent ratings themselves. Those are inputs to the sweep, and their own error '
    + 'is not propagated into the band.',
  `seeds in which no count up to ${MAX_SIMULATED_HULLS} hulls reached P(win) `
    + `${TARGET_WIN_PROBABILITY}. Those seeds are dropped before the percentiles are taken, so the `
    + 'band understates the spread whenever a meaningful share of seeds is unwinnable.',
  'model misspecification. The engagement is a stochastic exchange LINEAR in hull count '
    + '(ownCount x ownRating), not the Lanchester square law, which is a conservative simplification '
    + 'that understates the value of numerical superiority.'
]);

const BAND_COVERS = `run-to-run variance of this stochastic model across ${SIMULATION_SEEDS_COUNT} seeded `
  + `runs of ${BATTLE_TRIALS_PER_COUNT} battle trials per hull count. Nothing else.`;

const BAND_CITATION = 'docs/model-verification-review.md, "Claim 7" (measured 2026-08-21)';

/**
 * The uncertainty provenance that travels with every band.
 *
 * Emitted on BOTH the winnable and the not-winnable branch, so a consumer can
 * never receive a threshold figure without receiving what it does and does not
 * cover alongside it.
 *
 * `opponentRatingBasis` is supplied by the caller because only the caller knows
 * which mode built the tiers. Absent stays null: when no basis is stated, this
 * says the basis was not stated rather than assuming one.
 */
function describeBandUncertainty({ winnableSeedCount, winnableRatio, opponentRatingBasis = null }) {
  return {
    isMeasurement: false,
    bandCovers: BAND_COVERS,
    bandExcludes: BAND_EXCLUSIONS,
    seedsSimulated: SIMULATION_SEEDS_COUNT,
    battleTrialsPerCount: BATTLE_TRIALS_PER_COUNT,
    maxHullsSwept: MAX_SIMULATED_HULLS,
    targetWinProbability: TARGET_WIN_PROBABILITY,
    winnableSeeds: winnableSeedCount,
    winnableRatio: Math.round(winnableRatio * 1e6) / 1e6,
    bandComputedOver: 'the winnable seeds only',
    // The rating calibration is an assumption in every mode: player mode invents
    // the multipliers outright, and omniscient mode reads shipped combat values
    // but still assumes they are the right currency for this exchange model.
    opponentRatingCalibrated: false,
    opponentRatingBasis,
    opponentRatingCaveat: opponentRatingBasis === null
      ? 'the caller did not state where the opponent rating came from, so its basis is unknown here. It '
        + 'is an assumption until stated.'
      : 'the opponent rating is an assumption, not a measurement of alien combat performance, and its own '
        + 'error is not reflected in the band.',
    citation: 'docs/model-verification-review.md, "Claim 7" (measured 2026-08-21)'
  };
}

/**
 * Combat outcome model for Lanchester / stochastic battle evaluation.
 * Returns probability that `ownCount` of `ownForce` defeats `opponentForce`.
 */
function simulateEngagement(ownCount, ownRating, opponentRating, prng) {
  // Stochastic Lanchester engagement with roll variance
  // Force effectiveness scales with rating and square root of count
  let ownWins = 0;
  const BATTLE_TRIALS = BATTLE_TRIALS_PER_COUNT;

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
 *
 * Every return carries `uncertainty`, on both branches. The band is Monte Carlo
 * spread across seeds and nothing more; see the module header and
 * `describeBandUncertainty`.
 *
 * @param {object} [options]
 * @param {string|null} [options.opponentRatingBasis] where `opponentRating` came
 *   from, in the caller's own words. Absent stays null and is reported as
 *   unknown rather than assumed.
 */
function findRequiredHullsForTier(ownRating, opponentRating, baseSeed, { opponentRatingBasis = null } = {}) {
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

  // Surfaced, not discarded: the share of seeds that never reached the target is
  // exactly what tells a reader how much of the spread the band threw away.
  const uncertainty = describeBandUncertainty({
    winnableSeedCount: winnableSeeds.length,
    winnableRatio,
    opponentRatingBasis
  });

  if (winnableRatio < 0.5 || winnableSeeds.length === 0) {
    return {
      winnable: false,
      p20: null,
      p80: null,
      bandLabel: 'Not winnable at any count simulated (≤24)',
      simulated: true,
      uncertainty
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
    simulated: true,
    uncertainty
  };
}

/**
 * Where each mode's opponent ratings come from, in the words the result reports.
 *
 * Player mode's multipliers are INVENTED. No shipped template, save field or
 * wiki page states that a typical alien combatant is 1.5x the observer's best
 * hull; the 0.7 / 1.5 / 4.0 and the (armor / 10) scaling are calibration
 * guesses. They are named here so the band can never be read as though the
 * opponent side of the comparison had been measured.
 */
const OPPONENT_RATING_BASIS = Object.freeze({
  player: 'UNCALIBRATED ASSUMPTION. Alien ratings are scaled off the observer\'s own best hull by invented '
    + 'constants -- x0.7 escort, x1.5 typical, x4.0 heavy -- each scaled again by (observed armor / 10). No '
    + 'game source states that a typical alien is 1.5x your best hull. Only the armor medians and fleet '
    + 'counts underneath are observed.',
  omniscient: 'Alien ratings are the p10 / p50 / p90 of the alien designs\' own combat values as carried in '
    + 'the snapshot. The values are read rather than invented, but treating a combat value as the exchange '
    + 'currency of this Lanchester-style model is still an assumption, and the x2 / x3 tiers are counts '
    + 'under a model linear in count.'
});

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
  simulateEngagement,
  findRequiredHullsForTier,
  buildPlayerOpponentTiers,
  buildOmniscientOpponentTiers,
  SIMULATION_SEEDS_COUNT,
  MAX_SIMULATED_HULLS
};
