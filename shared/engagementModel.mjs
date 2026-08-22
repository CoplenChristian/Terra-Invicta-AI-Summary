// shared/engagementModel.mjs
//
// Purpose: the seeded Monte Carlo engagement sweep and the wording of its
//   hull band — one hull-count model, shared by the strategic commentary and
//   the per-fleet THREAT estimates.
//
// Moved here from `server/commentary/simulation.js` on 2026-08-22 so the
// Cloudflare worker can compute the same figure the Node server does; the
// per-fleet estimates in `shared/fleetEngagement.mjs` reach the AI markdown
// exports, which the worker renders. `server/commentary/simulation.js` now
// re-exports these same function objects and keeps its own opponent-tier
// builders, so no caller moved and the model is unchanged.
//
// The one addition is `maxHulls`. It defaults to `MAX_SIMULATED_HULLS`, so
// every existing call sweeps exactly the range it always swept and emits the
// same strings; the per-fleet caller passes a wider ceiling because a 34-ship
// alien fleet costs far more than 24 own hulls and a sweep that stops at 24
// reports "not winnable" for an engagement that is merely expensive.
//
// ---------------------------------------------------------------------------
// WHAT THE p20-p80 BAND IS, AND WHAT IT IS NOT
// ---------------------------------------------------------------------------
//
// Corrected 2026-08-21 -- see docs/model-verification-review.md "Claim 7". A
// band emitted as "4-5 hulls" reads as a measurement with an error bar. It is
// not one, and every result carries an `uncertainty` block saying so. Three
// confirmed reasons the band is NARROWER than the true uncertainty:
//
//   1. It captures ONLY Monte Carlo variance across seeds. It does not capture
//      the (larger) uncertainty in the opponent ratings themselves.
//   2. It is computed over WINNABLE SEEDS ONLY. Seeds where no count <= the
//      ceiling reaches P(win) 0.80 are dropped before the percentiles are
//      taken, which understates the spread whenever a meaningful share of
//      seeds is unwinnable. `winnableRatio` is surfaced rather than discarded.
//   3. The engagement model is LINEAR in count (ownCount x ownRating), not the
//      Lanchester square law. That is a deliberate conservative simplification
//      which UNDERSTATES the value of numerical superiority.
//
// The fix is to state the limitation, never to widen the band by a factor
// nobody can compute -- inventing a wider number would be the same defect in
// the opposite direction.
//
// ---------------------------------------------------------------------------
// "NOT WINNABLE" IS NOT A CONCLUSION THIS MODEL CAN REACH
// ---------------------------------------------------------------------------
//
// `simulateEngagement` scores `ownRoll = (0.8 + 0.4r) * count * ownRating`
// against `opponentRoll = (0.8 + 0.4r) * opponentRating`, and an outright win
// needs `ownRoll > opponentRoll * 1.1`. The worst own roll is `0.8 * count *
// ownRating` and the best opponent roll is `1.2 * opponentRating`, so EVERY
// trial is an outright win once
//
//   count > (1.1 * 1.2 / 0.8) * (opponentRating / ownRating)
//         = GUARANTEED_WIN_MARGIN * ratingRatio
//
// P(win) is then 1.0 for every seed. The model is therefore monotonic enough
// in hull count that some finite count always wins: a sweep returning
// `winnable: false` means "the answer is above the ceiling I swept", NEVER
// "this cannot be won". `guaranteedWinHullCount` computes that bound in closed
// form so a caller can size its own ceiling from the model rather than from a
// number somebody picked, and `shared/fleetEngagement.mjs` uses it to keep
// "beyond the modelled range" distinct from "not winnable".
//
// Plain ESM, no Node built-ins -- the hosted worker cannot `require` CommonJS.

import { createPrng, samplePercentile } from './prng.mjs';

export const SIMULATION_SEEDS_COUNT = 120;
export const MAX_SIMULATED_HULLS = 24;
export const TARGET_WIN_PROBABILITY = 0.80;
export const BATTLE_TRIALS_PER_COUNT = 30;

/**
 * The rating ratio above which every trial is an outright win.
 *
 * `1.1 * 1.2 / 0.8` -- the win threshold times the best opponent roll over the
 * worst own roll. Read off `simulateEngagement`'s own arithmetic, not chosen.
 */
export const GUARANTEED_WIN_MARGIN = (1.1 * 1.2) / 0.8;

/**
 * The own-hull count at or above which `simulateEngagement` wins every trial.
 *
 * Absent stays null: a non-positive or unmeasurable rating on either side
 * yields null, never a confident small count.
 *
 * @returns {number|null}
 */
export function guaranteedWinHullCount(ownRating, opponentRating) {
  const own = Number(ownRating);
  const opponent = Number(opponentRating);
  if (!Number.isFinite(own) || !(own > 0)) return null;
  if (!Number.isFinite(opponent) || !(opponent > 0)) return null;
  return Math.floor(GUARANTEED_WIN_MARGIN * (opponent / own)) + 1;
}

/** What the band leaves out, in the wording the result reports. */
function bandExclusionsFor(maxHulls) {
  return Object.freeze([
    'uncertainty in the opponent ratings themselves. Those are inputs to the sweep, and their own error '
      + 'is not propagated into the band.',
    `seeds in which no count up to ${maxHulls} hulls reached P(win) `
      + `${TARGET_WIN_PROBABILITY}. Those seeds are dropped before the percentiles are taken, so the `
      + 'band understates the spread whenever a meaningful share of seeds is unwinnable.',
    'model misspecification. The engagement is a stochastic exchange LINEAR in hull count '
      + '(ownCount x ownRating), not the Lanchester square law, which is a conservative simplification '
      + 'that understates the value of numerical superiority.'
  ]);
}

/**
 * The default-ceiling exclusions, memoised so every default-ceiling result
 * carries the identical frozen array it always did.
 */
export const BAND_EXCLUSIONS = bandExclusionsFor(MAX_SIMULATED_HULLS);

// The ceiling does not appear in this sentence, so it is a constant rather than
// a function of `maxHulls`; only `bandExcludes` names the swept range.
const BAND_COVERS = `run-to-run variance of this stochastic model across ${SIMULATION_SEEDS_COUNT} seeded `
  + `runs of ${BATTLE_TRIALS_PER_COUNT} battle trials per hull count. Nothing else.`;

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
export function describeBandUncertainty({
  winnableSeedCount,
  winnableRatio,
  opponentRatingBasis = null,
  maxHulls = MAX_SIMULATED_HULLS
}) {
  return {
    isMeasurement: false,
    bandCovers: BAND_COVERS,
    bandExcludes: maxHulls === MAX_SIMULATED_HULLS ? BAND_EXCLUSIONS : bandExclusionsFor(maxHulls),
    seedsSimulated: SIMULATION_SEEDS_COUNT,
    battleTrialsPerCount: BATTLE_TRIALS_PER_COUNT,
    maxHullsSwept: maxHulls,
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
export function simulateEngagement(ownCount, ownRating, opponentRating, prng) {
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
 * A p20-p80 hull band in words, pluralised.
 *
 * The one place the band becomes a string. `findRequiredHullsForTier` used to
 * build it inline and rendered a single-hull band as "1 hulls";
 * `shared/fleetEngagement.mjs` worked around that with its own copy of the
 * arithmetic rather than fix it, because doing so would have changed strategic-
 * commentary strings mid-refactor and invalidated the byte-identity proof that
 * the sweep's move into `shared/` changed nothing. That proof is banked, so the
 * two copies collapse to this one and the noun is decided once.
 *
 * @param {number} p20 - the 20th-percentile hull count.
 * @param {number} p80 - the 80th-percentile hull count.
 * @param {string} [prefix] - e.g. `'at least '` for a band over a partial
 *   opponent rating, which is a floor rather than an estimate.
 */
export function hullBandLabel(p20, p80, prefix = '') {
  const span = p20 === p80 ? `${p20}` : `${p20}–${p80}`;
  const noun = (p20 === p80 && p20 === 1) ? 'hull' : 'hulls';
  return `${prefix}${span} ${noun}`;
}

/**
 * Sweeps hull counts from 1 to `maxHulls` to find the minimum count for
 * P(win) >= 0.80.
 *
 * Every return carries `uncertainty`, on both branches. The band is Monte Carlo
 * spread across seeds and nothing more; see the module header and
 * `describeBandUncertainty`.
 *
 * @param {object} [options]
 * @param {string|null} [options.opponentRatingBasis] where `opponentRating` came
 *   from, in the caller's own words. Absent stays null and is reported as
 *   unknown rather than assumed.
 * @param {number} [options.maxHulls] the sweep ceiling. Defaults to
 *   `MAX_SIMULATED_HULLS`, which is what every commentary tier uses.
 */
export function findRequiredHullsForTier(
  ownRating,
  opponentRating,
  baseSeed,
  { opponentRatingBasis = null, maxHulls = MAX_SIMULATED_HULLS } = {}
) {
  const ceiling = Number.isFinite(Number(maxHulls)) && Number(maxHulls) >= 1
    ? Math.floor(Number(maxHulls))
    : MAX_SIMULATED_HULLS;
  const seedResults = [];

  for (let s = 0; s < SIMULATION_SEEDS_COUNT; s++) {
    const prng = createPrng(`${baseSeed}-seed-${s}`);
    let neededHulls = null;

    for (let count = 1; count <= ceiling; count++) {
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
    opponentRatingBasis,
    maxHulls: ceiling
  });

  if (winnableRatio < 0.5 || winnableSeeds.length === 0) {
    return {
      winnable: false,
      p20: null,
      p80: null,
      // "at any count simulated" and not "at any count": see the module header.
      // The exchange always yields to enough hulls, so this branch is a ceiling
      // report, not an impossibility verdict.
      bandLabel: `Not winnable at any count simulated (≤${ceiling})`,
      maxHullsSwept: ceiling,
      simulated: true,
      uncertainty
    };
  }

  const p20 = Math.round(samplePercentile(winnableSeeds, 0.2));
  const p80 = Math.round(samplePercentile(winnableSeeds, 0.8));

  return {
    winnable: true,
    p20,
    p80,
    bandLabel: hullBandLabel(p20, p80),
    maxHullsSwept: ceiling,
    simulated: true,
    uncertainty
  };
}

/**
 * Where each mode's opponent ratings come from, in the words the result reports.
 *
 * Player mode's multipliers are INVENTED. No shipped template, save field or
 * wiki page states that a typical alien combatant is 1.5x the observer's best
 * hull; the 0.7 / 1.5 / 4.0 scaling factors are calibration guesses. They are
 * named here so the band can never be read as though the opponent side of the
 * comparison had been measured.
 */
export const OPPONENT_RATING_BASIS = Object.freeze({
  player: 'UNCALIBRATED ASSUMPTION. Alien ratings are scaled off the observer\'s own best hull by invented '
    + 'constants -- x0.7 escort, x1.5 typical, x4.0 heavy -- each scaled again by (observed armor / 10). No '
    + 'game source states that a typical alien is 1.5x your best hull. Only the armor medians and fleet '
    + 'counts underneath are observed.',
  omniscient: 'Alien ratings are the p10 / p50 / p90 of the alien designs\' own combat values as carried in '
    + 'the snapshot. The values are read rather than invented, but treating a combat value as the exchange '
    + 'currency of this Lanchester-style model is still an assumption, and the x2 / x3 tiers are counts '
    + 'under a model linear in count.'
});
