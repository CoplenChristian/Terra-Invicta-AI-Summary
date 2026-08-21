/**
 * Research advisor: is a prerequisite chain reachable at all?
 * Purpose: the planning horizon a multi-step research chain has to fit inside
 *   before the advisor will recommend it, derived from the save.
 *
 * Spec: docs/chain-visibility-spec.md, "Rank on per-point, but gate on
 * reachability first".
 *
 * WHY THIS MODULE EXISTS
 *
 * Ranking chains on payoff per point of the whole chain is correct and, on its
 * own, produces advice nobody can take. Measured on the live save at campaign
 * date 1/1/2035:
 *
 *   Pion Torch x6     231x combat acceleration / 1,300,325 pts = 1.77e-4/pt
 *   Exotic Heat Sink  3.88x heat capacity      /    25,000 pts = 1.15e-4/pt
 *
 * The Pion Torch chain wins the ratio and is 413 months of research at the
 * observer's measured 3,144.6/month -- about 34 years. The Exotic Heat Sink
 * chain is 8 months. A ranking that puts the first above the second is
 * arithmetically right and useless, so time to complete is a GATE evaluated
 * BEFORE the ratio, not another term inside it.
 *
 * WHAT THE HORIZON IS, AND WHAT IT IS NOT
 *
 * It is a stated judgement, in the same class as `THREAT_IMMINENT_WINDOW_DAYS`
 * in shared/intel/theaters.mjs: **a plan longer than the campaign already
 * played is past the planning horizon.** Both of its terms are read from the
 * save -- elapsed campaign time, and the observer's measured monthly research
 * income -- so it carries no month count, no point threshold and no project id,
 * which docs/research-advisor-spec.md section 0 forbids outright. A campaign at
 * a tenth of this one's income gets a horizon a tenth as many points wide, and
 * a campaign in its first year gets one a thirteenth as long.
 *
 * It is NOT a measurement of anything the game publishes. Nothing in Terra
 * Invicta states how far ahead a player should plan, so `basis` says the
 * horizon is our inference and `horizonAssumed` says when the campaign age
 * behind it is itself an assumption rather than a reading.
 *
 * ELAPSED CAMPAIGN TIME IS READ, NEVER RE-DERIVED
 *
 * `server/intelligenceFilter.js` already computes it for the alien total-war
 * gate, in both modes, with `yearsElapsedSource` naming whether the start year
 * was measured or assumed -- the save carries no campaign start year, so it is
 * normally the documented 2022 assumption. This module reads that one figure
 * rather than parsing `gameTimeString` a second time. Two parallel derivations
 * of the same quantity is the drift class CLAUDE.md records from the three
 * hand-maintained registry lists.
 *
 * ABSENT STAYS NULL
 *
 * Every branch that cannot be evaluated reports `unknown` and carries its
 * reason. Unknown never promotes: a chain whose duration could not be measured
 * is not a chain that fits.
 */

import { round, toFiniteNumber } from './util.mjs';

const MONTHS_PER_YEAR = 12;

/**
 * The three outcomes of the gate. `unknown` is a distinct answer from
 * `beyond-horizon`: the first says the duration could not be formed, the second
 * says it was formed and is too long. Collapsing them would report an
 * unmeasured chain as measured-and-rejected.
 */
export const REACHABILITY_STATES = Object.freeze({
  withinHorizon: 'within-horizon',
  beyondHorizon: 'beyond-horizon',
  unknown: 'unknown'
});

export const PLANNING_HORIZON_BASIS =
  'a research plan longer than the campaign already played is past the planning horizon. Both terms '
  + 'are read from this save -- elapsed campaign time, and the observer\'s measured monthly research '
  + 'income -- so the horizon moves with the campaign instead of being a fixed number of months or '
  + 'points. It is our inference and not a figure the game publishes: nothing in Terra Invicta states '
  + 'how far ahead a player should plan.';

/**
 * The planning horizon for one snapshot.
 *
 * @param {Object} [options]
 * @param {Object} [options.snapshot]            the filtered snapshot
 * @param {number|null} [options.monthlyResearchIncome] the observer's measured income
 * @returns {{available: boolean, months: number|null, points: number|null,
 *   campaignYearsElapsed: number|null, monthlyResearchIncome: number|null,
 *   horizonAssumed: boolean, campaignAgeSource: string|null, basis: string,
 *   reason: string|null}}
 */
export function buildPlanningHorizon({ snapshot = null, monthlyResearchIncome = null } = {}) {
  const economics = snapshot?.alienHateEconomics || null;
  const yearsElapsed = toFiniteNumber(economics?.yearsElapsed);
  const income = toFiniteNumber(monthlyResearchIncome);
  const campaignAgeSource = typeof economics?.yearsElapsedSource === 'string'
    ? economics.yearsElapsedSource
    : null;
  // `campaignStartYearMeasured` is the filter's own flag for whether the start
  // year was read from the save or assumed. Absent, the honest answer is that
  // we do not know which, so the horizon is reported as assumed rather than as
  // measured -- overstating provenance is the failure this flag exists to stop.
  const horizonAssumed = economics?.campaignStartYearMeasured !== true;

  const unavailable = (reason) => ({
    available: false,
    months: null,
    points: null,
    campaignYearsElapsed: yearsElapsed,
    monthlyResearchIncome: income,
    horizonAssumed,
    campaignAgeSource,
    basis: PLANNING_HORIZON_BASIS,
    reason
  });

  if (yearsElapsed === null) {
    return unavailable('this snapshot carries no elapsed campaign time, so no planning horizon can be '
      + 'formed and no prerequisite chain is promoted on reachability grounds');
  }
  if (income === null || !(income > 0)) {
    return unavailable('the observer\'s monthly research income is not measurable in this snapshot, so '
      + 'no chain has a time to complete and none is promoted');
  }

  const months = round(yearsElapsed * MONTHS_PER_YEAR, 1);
  if (!(months > 0)) {
    return unavailable('the campaign has not yet run a full month, so the horizon is zero months wide '
      + 'and no multi-step chain fits inside it');
  }

  return {
    available: true,
    months,
    points: round(months * income, 1),
    campaignYearsElapsed: yearsElapsed,
    monthlyResearchIncome: income,
    horizonAssumed,
    campaignAgeSource,
    basis: PLANNING_HORIZON_BASIS,
    reason: null
  };
}

/**
 * Does this chain finish inside the horizon?
 *
 * @param {Object} [options]
 * @param {number|null} [options.totalRemainingCost]  the WHOLE chain, not the last step
 * @param {boolean|null} [options.researchCostComplete] false when a step carries the
 *   `researchCost: -1` sentinel, which makes the sum a floor rather than a total
 * @param {Object} [options.horizon]  from `buildPlanningHorizon`
 * @returns {{state: string, months: number|null, horizonMonths: number|null, reason: string}}
 */
export function chainReachability({ totalRemainingCost = null, researchCostComplete = null, horizon = null } = {}) {
  const horizonMonths = horizon?.available === true ? toFiniteNumber(horizon.months) : null;
  const income = toFiniteNumber(horizon?.monthlyResearchIncome);
  const cost = toFiniteNumber(totalRemainingCost);

  const unknown = (reason) => ({
    state: REACHABILITY_STATES.unknown,
    months: null,
    horizonMonths,
    reason
  });

  if (horizon && horizon.available !== true) {
    return unknown(horizon.reason || 'no planning horizon could be formed for this snapshot');
  }
  if (horizonMonths === null || income === null || !(income > 0)) {
    return unknown('no planning horizon could be formed for this snapshot');
  }
  // A chain containing an unresearchable step has an unknown cost, never a
  // number: docs/research-chain-spec.md, the `researchCost: -1` sentinel makes
  // a partial sum LOOK cheaper than the chain really is.
  if (researchCostComplete === false) {
    return unknown('a step in this chain carries no research cost, so the chain total is a floor rather '
      + 'than a total and its time to complete is unknown');
  }
  if (cost === null || !(cost > 0)) {
    return unknown('the remaining cost of this chain is not measurable, so it has no time to complete');
  }

  const months = round(cost / income, 1);
  if (months > horizonMonths) {
    return {
      state: REACHABILITY_STATES.beyondHorizon,
      months,
      horizonMonths,
      reason: `the whole chain is ${months} months of research at the observer's measured income, past `
        + `the ${horizonMonths}-month planning horizon this campaign's own age sets`
    };
  }
  return {
    state: REACHABILITY_STATES.withinHorizon,
    months,
    horizonMonths,
    reason: `the whole chain is ${months} months of research at the observer's measured income, inside `
      + `the ${horizonMonths}-month planning horizon this campaign's own age sets`
  };
}
