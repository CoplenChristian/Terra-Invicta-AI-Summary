// shared/researchReachability.mjs -- the gate a research chain has to pass
// before the advisor will recommend it.
//
// The rule this module exists to hold: **time to complete is checked BEFORE the
// ratio, not inside it.** Measured on the live save, `Pion Torch x6` wins on
// payoff per point of its whole chain (1.77e-4 against the next chain's
// 1.15e-4) and its chain is 1,300,325 points -- 413 months at the observer's
// measured income, about 34 years. A ranking that puts it first is
// arithmetically correct and useless.
//
// Every number below is a fixture. The live-save assertions live in
// tests/researchRanking.test.js, where the projection and the panel are.

const { test } = require('node:test');
const assert = require('node:assert');

const {
  PLANNING_HORIZON_BASIS,
  REACHABILITY_STATES,
  buildPlanningHorizon,
  chainReachability
} = require('../shared/researchReachability.mjs');

const campaign = (yearsElapsed, measured = false) => ({
  alienHateEconomics: {
    yearsElapsed,
    campaignStartYearMeasured: measured,
    yearsElapsedSource: measured ? 'measured: save metadata campaignStartYear' : 'assumed 2022'
  }
});

// ---------------------------------------------------------------------------
// THE HORIZON
// ---------------------------------------------------------------------------

test('the horizon is derived from the campaign age and the measured income, not from a constant', () => {
  const horizon = buildPlanningHorizon({ snapshot: campaign(13), monthlyResearchIncome: 3000 });

  assert.equal(horizon.available, true);
  assert.equal(horizon.months, 156, '13 campaign years is 156 months of planning');
  assert.equal(horizon.points, 468000, '156 months at 3,000/mo is the point budget it buys');
  assert.equal(horizon.campaignYearsElapsed, 13);
  assert.equal(horizon.monthlyResearchIncome, 3000);
  assert.equal(horizon.reason, null);
  assert.equal(horizon.basis, PLANNING_HORIZON_BASIS);
  assert.match(horizon.basis, /our inference/i,
    'the horizon is a judgement and must say so rather than reading as a measurement');
});

test('a poorer campaign gets a smaller point budget, and a younger one a shorter horizon', () => {
  const rich = buildPlanningHorizon({ snapshot: campaign(13), monthlyResearchIncome: 3000 });
  const poor = buildPlanningHorizon({ snapshot: campaign(13), monthlyResearchIncome: 300 });
  const young = buildPlanningHorizon({ snapshot: campaign(2), monthlyResearchIncome: 3000 });

  // If the gate were a hardcoded point threshold, none of these would move.
  assert.equal(rich.months, poor.months, 'the same campaign age is the same number of months');
  assert.equal(poor.points, rich.points / 10, 'a tenth of the income buys a tenth of the research');
  assert.ok(young.months < rich.months, 'a younger campaign plans less far ahead');
  assert.equal(young.months, 24);
});

test('a campaign not yet a month old has a zero-width horizon, stated rather than applied', () => {
  const horizon = buildPlanningHorizon({ snapshot: campaign(0), monthlyResearchIncome: 500 });
  assert.equal(horizon.available, false);
  assert.equal(horizon.months, null, 'a zero horizon is not a zero-month promise, it is no horizon');
  assert.equal(horizon.points, null);
  assert.match(horizon.reason, /not yet run a full month/);
});

test('an unmeasured income or an unmeasured campaign age is unknown, never zero', () => {
  const noIncome = buildPlanningHorizon({ snapshot: campaign(13), monthlyResearchIncome: null });
  assert.equal(noIncome.available, false);
  // Number(null) === 0, so the failure mode this guards is a confident
  // zero-month horizon that rejects everything while claiming to have measured.
  assert.equal(noIncome.months, null);
  assert.equal(noIncome.points, null);
  assert.match(noIncome.reason, /research income/);

  const noAge = buildPlanningHorizon({ snapshot: {}, monthlyResearchIncome: 3000 });
  assert.equal(noAge.available, false);
  assert.equal(noAge.months, null);
  assert.match(noAge.reason, /elapsed campaign time/);

  const noSnapshot = buildPlanningHorizon();
  assert.equal(noSnapshot.available, false);
  assert.equal(noSnapshot.months, null);
});

test('an assumed campaign start year is reported as an assumption, and a measured one is not', () => {
  const assumed = buildPlanningHorizon({ snapshot: campaign(13, false), monthlyResearchIncome: 3000 });
  assert.equal(assumed.horizonAssumed, true);
  assert.equal(assumed.campaignAgeSource, 'assumed 2022');

  const measured = buildPlanningHorizon({ snapshot: campaign(13, true), monthlyResearchIncome: 3000 });
  assert.equal(measured.horizonAssumed, false);
  assert.match(measured.campaignAgeSource, /measured/);

  // A snapshot that says nothing about provenance is treated as assumed:
  // overstating what was measured is the failure, not understating it.
  const silent = buildPlanningHorizon({
    snapshot: { alienHateEconomics: { yearsElapsed: 13 } },
    monthlyResearchIncome: 3000
  });
  assert.equal(silent.horizonAssumed, true);
  assert.equal(silent.campaignAgeSource, null);
});

// ---------------------------------------------------------------------------
// THE GATE
// ---------------------------------------------------------------------------

const HORIZON = buildPlanningHorizon({ snapshot: campaign(13), monthlyResearchIncome: 3000 });

test('a chain that finishes inside the horizon is within it, and one that does not is beyond', () => {
  const within = chainReachability({ totalRemainingCost: 25000, researchCostComplete: true, horizon: HORIZON });
  assert.equal(within.state, REACHABILITY_STATES.withinHorizon);
  assert.equal(within.months, 8.3, '25,000 points at 3,000/mo');
  assert.equal(within.horizonMonths, 156);
  assert.match(within.reason, /inside the 156-month planning horizon/);

  // The live save's shape: a chain whose ratio is the best on the board.
  const beyond = chainReachability({ totalRemainingCost: 1300325, researchCostComplete: true, horizon: HORIZON });
  assert.equal(beyond.state, REACHABILITY_STATES.beyondHorizon);
  assert.ok(beyond.months > 400);
  assert.match(beyond.reason, /past the 156-month planning horizon/);
});

test('the caller\'s priced months decide the gate, not cost over the whole faction income', () => {
  // A chain is priced at FULL CONCENTRATION by `researchRanking` -- every pip
  // on the step being worked -- which is a genuine lower bound and roughly 2x
  // faster than the whole-faction figure for a project chain. The gate has to
  // test THAT, or it refuses chains the player could actually finish.
  const cost = 1300325;
  const fallback = chainReachability({ totalRemainingCost: cost, researchCostComplete: true, horizon: HORIZON });
  assert.equal(fallback.state, REACHABILITY_STATES.beyondHorizon);
  assert.ok(fallback.months > 400, 'the fallback is cost / whole-faction income');
  assert.match(fallback.reason, /whole measured research income/,
    'and it must say which basis it used, because the two answer differently');

  // The same chain, priced. It now fits, and the verdict flips.
  const priced = chainReachability({
    totalRemainingCost: cost, researchCostComplete: true, months: 120, horizon: HORIZON
  });
  assert.equal(priced.months, 120, 'the supplied months win over cost / income');
  assert.equal(priced.state, REACHABILITY_STATES.withinHorizon);
  assert.match(priced.reason, /at full concentration/,
    'and the reason names the basis rather than implying the old one');

  // Zero is a real answer -- a chain with nothing left -- so the guard is on
  // presence, not truthiness. `months: 0` must not fall back to cost / income.
  const nothingLeft = chainReachability({
    totalRemainingCost: cost, researchCostComplete: true, months: 0, horizon: HORIZON
  });
  assert.equal(nothingLeft.months, 0);
  assert.equal(nothingLeft.state, REACHABILITY_STATES.withinHorizon);
});

test('the boundary is inclusive, so a chain exactly the horizon long still counts as reachable', () => {
  const exact = chainReachability({
    totalRemainingCost: HORIZON.points,
    researchCostComplete: true,
    horizon: HORIZON
  });
  assert.equal(exact.months, HORIZON.months);
  assert.equal(exact.state, REACHABILITY_STATES.withinHorizon);
});

test('an uncosted step makes the whole chain unknown, never cheaper', () => {
  // `researchCost: -1` is a sentinel on alien tech, so a sum containing it is a
  // FLOOR. Treating it as a total reports the chain as faster than it is, which
  // is the one case where a partial sum is worse than no sum at all.
  const sentinel = chainReachability({ totalRemainingCost: 5000, researchCostComplete: false, horizon: HORIZON });
  assert.equal(sentinel.state, REACHABILITY_STATES.unknown);
  assert.equal(sentinel.months, null);
  assert.match(sentinel.reason, /floor rather than a total/);
});

test('an unmeasurable cost or an unavailable horizon is unknown, and unknown never passes', () => {
  const noCost = chainReachability({ totalRemainingCost: null, researchCostComplete: true, horizon: HORIZON });
  assert.equal(noCost.state, REACHABILITY_STATES.unknown);
  assert.equal(noCost.months, null);

  const zeroCost = chainReachability({ totalRemainingCost: 0, researchCostComplete: true, horizon: HORIZON });
  assert.equal(zeroCost.state, REACHABILITY_STATES.unknown);

  const noHorizon = buildPlanningHorizon({ snapshot: {}, monthlyResearchIncome: 3000 });
  const unmeasurable = chainReachability({
    totalRemainingCost: 1000, researchCostComplete: true, horizon: noHorizon
  });
  assert.equal(unmeasurable.state, REACHABILITY_STATES.unknown);
  assert.equal(unmeasurable.months, null);
  assert.equal(unmeasurable.reason, noHorizon.reason,
    'the reason the horizon could not be formed is the reason the chain could not be judged');

  const noArguments = chainReachability();
  assert.equal(noArguments.state, REACHABILITY_STATES.unknown);

  // Three distinct answers, and the caller can tell them apart. Collapsing
  // `unknown` into `beyond-horizon` would report an unmeasured chain as
  // measured-and-rejected.
  assert.notEqual(REACHABILITY_STATES.unknown, REACHABILITY_STATES.beyondHorizon);
  assert.notEqual(REACHABILITY_STATES.unknown, REACHABILITY_STATES.withinHorizon);
});
