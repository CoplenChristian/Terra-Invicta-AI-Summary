// tests/researchCostScaling.test.js
//
// Purpose: pin where the campaign's research speed setting acts -- on the
//   effective research COST -- and the three states a cost figure can be in.
//
// THIS OVERTURNS A RECORDED VERDICT, so the tests are written against the
// evidence rather than against the code. `docs/campaign-settings-spec.md`
// recorded on 2026-08-21 that `researchSpeedMultiplier` "acts on output, not
// cost", and every duration was priced against the raw template cost from then
// until 2026-08-22. The measurement that overturned it is in
// `shared/researchCostScaling.mjs`; what the tests below pin is that the
// measurement reaches the arithmetic, that the `-1` sentinel survives it, and
// that an unknown multiplier is labelled rather than silently treated as 1.
//
// Every expected value here is DERIVED from the multiplier under test rather
// than pinned to this campaign's 200%. A fixture that hardcoded 2 would pass on
// a stock campaign by accident.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  RESEARCH_COST_SCALING_RULE,
  RESEARCH_COST_SCALING_STATES,
  RESEARCH_COST_SCALING_UNKNOWN,
  buildResearchCostScaling,
  effectiveResearchCost,
  researchCostBasis
} = require('../shared/researchCostScaling.mjs');
const { buildCampaignSettings } = require('../shared/campaignSettings.mjs');

/** A `TIMetadataState` carrying one research speed value, as the save writes it. */
const metaWith = (raw) => ({ customDifficulty: true, researchSpeedMultiplier: raw });

// ---------------------------------------------------------------------------
// 1. WHERE THE MULTIPLIER ACTS
// ---------------------------------------------------------------------------

test('a non-stock multiplier divides the cost, and the divisor is derived from it', () => {
  for (const [raw, percent] of [['200%', 200], ['150%', 150], ['50%', 50], ['300%', 300]]) {
    const scaling = buildResearchCostScaling(buildCampaignSettings(metaWith(raw)));
    assert.equal(scaling.available, true, `${raw} must be readable`);
    assert.equal(scaling.state, RESEARCH_COST_SCALING_STATES.campaignScaled);
    assert.equal(scaling.multiplierPercent, percent);
    assert.equal(scaling.costDivisor, percent / 100);
    assert.equal(scaling.isStock, false);
    // Derived from the multiplier, never from a remembered 2. Rounded to 4
    // places the same way the implementation is, because 10000/1.5 is
    // 6666.666666666667 and carrying that into a summed chain total would be
    // false precision -- not because the rounding is being papered over.
    const expected = cost => Math.round((cost / (percent / 100)) * 1e4) / 1e4;
    assert.equal(effectiveResearchCost(10000, scaling), expected(10000));
    assert.equal(effectiveResearchCost(7500, scaling), expected(7500));
  }
});

test('the stock 100% is the identity, and says it is stock rather than scaled', () => {
  const scaling = buildResearchCostScaling(buildCampaignSettings(metaWith('100%')));
  assert.equal(scaling.available, true);
  assert.equal(scaling.state, RESEARCH_COST_SCALING_STATES.stock);
  assert.equal(scaling.isStock, true);
  assert.equal(scaling.costDivisor, 1);
  assert.equal(effectiveResearchCost(10000, scaling), 10000, 'the template cost IS the effective cost');
  assert.match(researchCostBasis(scaling), /stock 100%/);
});

// ---------------------------------------------------------------------------
// 2. ABSENT STAYS NULL, AND UNKNOWN IS NOT SAFE
// ---------------------------------------------------------------------------

test('an unreadable multiplier leaves the cost UNCHANGED and labels it, never divides by a silent 1', () => {
  const unreadable = [
    null,
    undefined,
    {},
    buildCampaignSettings(null),
    buildCampaignSettings(metaWith('')),
    buildCampaignSettings(metaWith('%')),
    buildCampaignSettings(metaWith('abc')),
    // A zero or negative percentage is not a multiplier: dividing by it would
    // produce Infinity or a negative cost.
    buildCampaignSettings(metaWith('0%')),
    buildCampaignSettings(metaWith('-50%'))
  ];
  for (const settings of unreadable) {
    const scaling = buildResearchCostScaling(settings);
    assert.equal(scaling.available, false, `${JSON.stringify(settings)?.slice(0, 40)}: must not be readable`);
    assert.equal(scaling.state, RESEARCH_COST_SCALING_STATES.unknown);
    assert.equal(scaling.costDivisor, null, 'a divisor of 1 would look like a checked stock campaign');
    assert.equal(scaling.multiplierPercent, null);
    assert.equal(scaling.isStock, null, 'unknown is not "stock"');
    // The COST is passed through unchanged: withdrawing it would blank every
    // snapshot published before this existed, on no evidence.
    assert.equal(effectiveResearchCost(10000, scaling), 10000);
    assert.match(researchCostBasis(scaling), /NOT been checked|unknown/i,
      'and the label must say it was not checked, not that it is stock');
  }
});

test('an absent or unreadable COST is null, never zero', () => {
  const scaling = buildResearchCostScaling(buildCampaignSettings(metaWith('200%')));
  for (const cost of [null, undefined, '', 'abc', NaN, Infinity, {}, []]) {
    assert.equal(effectiveResearchCost(cost, scaling), null,
      `${JSON.stringify(cost)}: a zero cost renders as "already paid for"`);
  }
  // Zero itself IS a measurement of zero and survives.
  assert.equal(effectiveResearchCost(0, scaling), 0);
});

test('the researchCost -1 sentinel is NEVER scaled', () => {
  // `-1` marks a project that is never researched at all. Halving it to -0.5
  // would corrupt the marker every downstream researchability check reads, and
  // `researchCost < 0` is exactly how they test it.
  for (const raw of ['200%', '50%', '100%']) {
    const scaling = buildResearchCostScaling(buildCampaignSettings(metaWith(raw)));
    assert.equal(effectiveResearchCost(-1, scaling), -1, `${raw}: the sentinel must survive intact`);
    assert.equal(effectiveResearchCost(-1000, scaling), -1000);
  }
});

// ---------------------------------------------------------------------------
// 3. THE UNAVAILABLE BLOCK, AND THE RECORD OF WHAT IT OVERTURNS
// ---------------------------------------------------------------------------

test('the unknown block is a real block, not a null a caller has to guard on', () => {
  assert.equal(RESEARCH_COST_SCALING_UNKNOWN.available, false);
  assert.equal(RESEARCH_COST_SCALING_UNKNOWN.state, RESEARCH_COST_SCALING_STATES.unknown);
  assert.equal(RESEARCH_COST_SCALING_UNKNOWN.costDivisor, null);
  assert.equal(effectiveResearchCost(1234, RESEARCH_COST_SCALING_UNKNOWN), 1234);
});

test('the rule records what was MEASURED and what was inferred, and does not confuse them', () => {
  // The 200% behaviour is measured; the linear form at other values is not.
  // A record that claimed both were measured would be the overstatement this
  // repo's "say when something is a judgement" rule exists to prevent.
  assert.match(RESEARCH_COST_SCALING_RULE.claimStatus, /MEASURED at 200%/);
  assert.match(RESEARCH_COST_SCALING_RULE.claimStatus, /INFERENCE/);
  assert.match(RESEARCH_COST_SCALING_RULE.claimStatus, /not measured/);

  // Three independent lines, each named.
  const evidence = RESEARCH_COST_SCALING_RULE.evidence.join(' ');
  assert.match(evidence, /4,708\.568/, 'the tracked completion');
  assert.match(evidence, /278 in-progress project rows/, 'the ceiling count');
  assert.match(evidence, /0\.49716/, 'and the maximum it stops at');
  assert.match(evidence, /First\.gz 13 of 49/, 'the two-sided control that shows >0.5 is reachable');
  assert.match(evidence, /useHarshTree/, 'the confound that was ruled out');

  // What it overturns, named rather than quietly replaced.
  assert.match(RESEARCH_COST_SCALING_RULE.supersedes, /campaign-settings-spec/);
  assert.match(RESEARCH_COST_SCALING_RULE.supersedes, /acts on output, not on cost/);
  assert.match(RESEARCH_COST_SCALING_RULE.supersedes, /First\.gz/,
    'and WHY that evidence could not answer the question');

  // The income half must be explicitly refused, or the next reader applies the
  // multiplier twice and lands on a 4x error.
  assert.match(RESEARCH_COST_SCALING_RULE.doesNotTouchIncome, /NOT multiplied/);
  assert.match(RESEARCH_COST_SCALING_RULE.doesNotTouchIncome, /4x/);
});

test('both specs record the correction rather than only the new conclusion', () => {
  const settingsSpec = fs.readFileSync(
    path.join(__dirname, '..', 'docs', 'campaign-settings-spec.md'), 'utf8'
  );
  assert.match(settingsSpec, /WRONG|OVERTURNED/,
    'the research verdict was overturned and the spec must say so, not quietly read the new way');
  assert.match(settingsSpec, /First\.gz/,
    'the superseded evidence came from a save carrying no multiplier, and that is the lesson');
  assert.match(settingsSpec, /0\.49716|4,708\.568/, 'with at least one of the new measurements');

  const rateSpec = fs.readFileSync(
    path.join(__dirname, '..', 'docs', 'research-category-rate-spec.md'), 'utf8'
  );
  assert.match(rateSpec, /cannot discriminate|non-discriminating|CANNOT DISCRIMINATE/i,
    'the 2.11x measurement is consistent with both hypotheses and the spec must say so');
});

// ---------------------------------------------------------------------------
// 4. IT REACHES THE SNAPSHOT, IN BOTH MODES
// ---------------------------------------------------------------------------

test('the scaling block is baked onto the snapshot and survives player mode', () => {
  const snapshotBuilder = require('../server/snapshotBuilder');
  const { makeSaveData } = require('./fixtures/syntheticSave');
  const intelligenceFilter = require('../server/intelligenceFilter');

  const save = makeSaveData();
  save.campaignSettings = buildCampaignSettings(metaWith('200%'));
  const raw = snapshotBuilder.buildRawSnapshot(save);
  assert.equal(raw.metadata.researchCostScaling.state, RESEARCH_COST_SCALING_STATES.campaignScaled);
  assert.equal(raw.metadata.researchCostScaling.costDivisor, 2);

  for (const mode of ['player', 'omniscient']) {
    const view = intelligenceFilter.applyFilter(raw, mode, 4712);
    assert.equal(view.metadata.researchCostScaling.state, RESEARCH_COST_SCALING_STATES.campaignScaled,
      `${mode}: the cost basis is campaign metadata, not faction intel, and must survive redaction`);
    assert.equal(view.metadata.researchCostScaling.costDivisor, 2, `${mode}: with its divisor intact`);
  }
});

test('a save with no campaign settings publishes template costs, labelled unknown', () => {
  const snapshotBuilder = require('../server/snapshotBuilder');
  const { makeSaveData } = require('./fixtures/syntheticSave');

  const save = makeSaveData();
  delete save.campaignSettings;
  const raw = snapshotBuilder.buildRawSnapshot(save);
  assert.equal(raw.metadata.researchCostScaling.state, RESEARCH_COST_SCALING_STATES.unknown);
  assert.equal(raw.metadata.researchCostScaling.available, false);
  // And the graph's costs are the template ones, unchanged -- an older snapshot
  // must read exactly as it always did.
  const costed = raw.techTree.nodes.filter(node => typeof node.researchCost === 'number');
  assert.ok(costed.length > 0, 'the fixture must carry costed nodes, or this passes vacuously');
  for (const node of costed) {
    assert.equal(node.researchCost, node.templateResearchCost,
      `${node.id}: with no readable multiplier the effective cost IS the template cost`);
  }
});
