// shared/researchCostScaling.mjs
//
// Purpose: the campaign's `researchSpeedMultiplier` applied where it actually
//   acts — on the effective research COST, not on the research income.
//
// ---------------------------------------------------------------------------
// WHAT WAS MEASURED, AND WHAT IT OVERTURNS
// ---------------------------------------------------------------------------
//
// `docs/campaign-settings-spec.md` recorded, on 2026-08-21, that
// `researchSpeedMultiplier` "acts on output, not cost", and every research
// duration has been priced against the raw template `researchCost` since.
// THAT VERDICT IS WRONG, and it is wrong in the direction that makes every
// stated duration on this campaign TWICE what the game will actually charge.
//
// Re-measured 2026-08-22 against four MD5-verified frozen saves plus three
// further campaign saves. Three independent lines, all agreeing:
//
//   1. TRACKED TO COMPLETION. The observer's own slot-5 project
//      `Project_GasCoreFissionReactorVI` carries a template `researchCost` of
//      10,000. At 12/16/2034 12:00 it stood at 4,708.568 accumulated. It was
//      COMPLETE by 1/1/2035, 15.5 days later, and its slot's delivery rate was
//      measured -- not modelled -- at 30.2467 points/day over the preceding
//      interval. Reaching 10,000 needs 174.9 days. Reaching 5,000 needs 9.64.
//      The interval affords 15.5. So the effective cost sits in
//      (4,708.57, 5,177.39]; the successor project's own accrual in the tail of
//      the same interval puts it at ~5,022, i.e. template/2 to within 0.44%.
//
//   2. A HARD CEILING AT 50%. Across the five saves carrying
//      `researchSpeedMultiplier: 200%`, 278 in-progress project rows with any
//      accumulated research: ZERO above 50% of template cost, maximum 0.49716.
//      A quantity caught mid-flight at random does not stop dead at one half.
//
//   3. A TWO-SIDED CONTROL. The corpus is not incapable of showing rows past
//      50%: saves carrying NO readable `researchSpeedMultiplier` do it
//      routinely -- `First.gz` has 13 of 49 rows above 0.5 with a maximum of
//      0.9756, `servant.gz` 1 of 37. CLAUDE.md's warning about one-sided pins
//      is answered: illegal states are observed to be reachable elsewhere, and
//      unreachable here.
//
// `useHarshTree` is `false` in all eight saves examined, so it is not the
// confound.
//
// ---------------------------------------------------------------------------
// WHY THE EARLIER PROOF DID NOT CATCH IT
// ---------------------------------------------------------------------------
//
// The 2026-08-22 measurement in `docs/research-category-rate-spec.md` is
// arithmetically correct and re-reproduces exactly. It showed the observer's
// slots delivering 2.1115x `cachedYearlyRevenue.Research`, against 2.1420x
// predicted by the allocation terms alone, and concluded that the income is
// already post-multiplier because "an income still needing the 200% would have
// delivered 4.2840x".
//
// That comparison CANNOT DISCRIMINATE. Both sides of it are research POINTS;
// cost never enters. "Income already doubled, cost unscaled" and "income never
// doubled, cost halved" predict the identical 2.11x. The 4.2840x alternative it
// ruled out -- income doubled AND everything else unchanged -- was the one
// hypothesis nobody held. The question is decided on the cost side, and the
// cost side had been checked only on `First.gz`, a save that carries no
// `TIMetadataState` custom-difficulty block at all and therefore no evidence
// about a 200% campaign.
//
// The income half of that verdict still stands, for a better reason than the
// one given: the measured delivery matches `cachedYearlyRevenue.Research` times
// the allocation terms to a uniform 1.4%, so whatever the game does internally,
// that revenue figure IS the realised rate and must not be multiplied again.
//
// ---------------------------------------------------------------------------
// WHAT IS MEASURED AND WHAT IS INFERRED
// ---------------------------------------------------------------------------
//
// MEASURED: at `researchSpeedMultiplier: 200%`, effective cost = template / 2.
// INFERRED: the general form `template / (multiplier / 100)`. One multiplier
// value was available to measure. The linear reading is the natural one for a
// setting named "research speed", and it is the identity at 100%, but no second
// value has been observed. `RESEARCH_COST_SCALING_RULE.claimStatus` says so.
//
// NOTHING HERE IS CAMPAIGN-SPECIFIC. The multiplier is read per save; 200 is
// never written down as a number to expect.
//
// Plain ESM, no Node built-ins, no imports outside `shared/`.

// `strictFiniteNumber`, not `toFiniteNumber`, for the COST. The lenient form
// accepts anything `Number()` can coerce, and `Number([]) === 0` -- so an array
// where a cost was expected became a confident zero cost, which renders as
// "already paid for". The multiplier percent goes through the lenient form
// because `campaignSettings` has already parsed and validated it.
import { round, strictFiniteNumber, toFiniteNumber as toFinite } from './util.mjs';

/**
 * How a cost figure came to be what it is. Every duration and every remaining
 * cost carries one of these, because a scaled figure and an unscaled one must
 * never look alike.
 */
export const RESEARCH_COST_SCALING_STATES = Object.freeze({
  /** A non-stock multiplier was read from the save and applied. */
  campaignScaled: 'campaign-scaled',
  /** The multiplier was read and is the stock 100%, so the template cost stands. */
  stock: 'stock',
  /**
   * No multiplier could be read. The template cost is reported UNCHANGED and
   * labelled -- not withdrawn, because that would blank every snapshot
   * published before campaign settings were baked, and not called stock,
   * because unknown is not the same as safe.
   */
  unknown: 'campaign-multiplier-unknown'
});

export const RESEARCH_COST_SCALING_RULE = Object.freeze({
  formula: 'effective research cost = template researchCost / (researchSpeedMultiplier / 100)',
  claimStatus: 'MEASURED at 200% (effective cost = template / 2, three independent lines). The general '
    + 'linear form is an INFERENCE: only one multiplier value was available in the save corpus, so the '
    + 'behaviour at 150% or 50% is not measured. It is the identity at 100%.',
  measuredOn: 'Autosave3.gz 61cc7c1103742fe47d2984d384a3147a, Autosave2.gz 5294cddfb5906d27bfd59bce9f29ccda, '
    + 'Autosave.gz 2ef9643051e675026850b23b380f93f3, ExitSave.gz 5c0d9ef98213c91d8187ae11bf885d57 -- frozen '
    + 'to disk and MD5-verified against the save folder -- plus initiative.gz, Again.gz and Quicksave.gz '
    + 'for the ceiling count and First.gz, second.gz, aliensonearth.gz, servant.gz as controls. 2026-08-22.',
  evidence: Object.freeze([
    'TRACKED TO COMPLETION: the observer\'s Project_GasCoreFissionReactorVI (template researchCost 10,000) '
      + 'stood at 4,708.568 accumulated on 12/16/2034 12:00 and was complete by 1/1/2035. Its slot\'s '
      + 'delivery rate over the preceding 15.5 days was 30.2467 points/day, measured from accumulated '
      + 'deltas. Reaching 10,000 would take 174.9 days; reaching 5,000 takes 9.64. Effective cost brackets '
      + 'to (4,708.57, 5,177.39], and the successor project\'s accrual in the tail of the same interval '
      + 'places it at ~5,022 -- template/2 to 0.44%.',
    'CEILING: 278 in-progress project rows across the five saves carrying researchSpeedMultiplier 200%, '
      + 'ZERO above 50% of template cost, maximum 0.49716.',
    'TWO-SIDED CONTROL: saves with no readable researchSpeedMultiplier DO exceed 50% -- First.gz 13 of 49 '
      + 'rows, maximum 0.9756; servant.gz 1 of 37. So the ceiling is a property of the 200% campaigns, not '
      + 'of the measurement.',
    'CONFOUND RULED OUT: TIGlobalResearchState.useHarshTree is false in all eight saves examined.'
  ]),
  supersedes: 'docs/campaign-settings-spec.md, "Research -- acts on output, not on cost". Its evidence '
    + '(Fleet Logistics at accumulatedResearch 44,780 against a template researchCost of 45,000, still in '
    + 'progress) was measured on First.gz, which carries NO TIMetadataState custom-difficulty block and '
    + 'therefore no researchSpeedMultiplier. It established that a campaign with no multiplier charges '
    + 'template cost -- true, and silent about a campaign that has one.',
  doesNotTouchIncome: '`cachedYearlyRevenue.Research` is the game\'s own realised annualised rate and the '
    + 'observer\'s measured per-slot delivery matches it times the allocation terms to a uniform 1.4%. It '
    + 'is NOT multiplied here or anywhere. Applying the campaign multiplier to both cost and income would '
    + 'be the 4x error the earlier verdict was guarding against.',
  spec: 'docs/campaign-settings-spec.md, docs/research-category-rate-spec.md'
});

/** The unavailable block, so no caller has to invent one. */
export const RESEARCH_COST_SCALING_UNKNOWN = Object.freeze({
  available: false,
  state: RESEARCH_COST_SCALING_STATES.unknown,
  multiplierPercent: null,
  costDivisor: null,
  isStock: null,
  reason: 'this snapshot carries no readable campaign research speed multiplier, so research costs are '
    + 'reported exactly as the templates state them and have NOT been checked against a campaign setting',
  label: 'template cost, campaign research multiplier unknown',
  rule: RESEARCH_COST_SCALING_RULE
});

/**
 * Reads the campaign's research speed multiplier into a cost scaler.
 *
 * @param {Object|null} campaignSettings the block from `buildCampaignSettings`
 * @returns {Object} frozen; `available: false` when the multiplier is unreadable
 */
export function buildResearchCostScaling(campaignSettings) {
  const setting = campaignSettings && typeof campaignSettings === 'object'
    ? campaignSettings.settings?.researchSpeedMultiplier
    : null;

  // `available` on the setting is the parser's own verdict, and it is already
  // strict about the `Number("200%") === NaN` trap. A percent that parsed to
  // zero or a negative is not a multiplier; it is unreadable, because dividing
  // by it would produce Infinity or a negative cost.
  const percent = setting?.available === true ? toFinite(setting.value) : null;
  if (percent === null || !(percent > 0)) return RESEARCH_COST_SCALING_UNKNOWN;

  const divisor = percent / 100;
  const isStock = divisor === 1;

  return Object.freeze({
    available: true,
    state: isStock ? RESEARCH_COST_SCALING_STATES.stock : RESEARCH_COST_SCALING_STATES.campaignScaled,
    multiplierPercent: percent,
    costDivisor: divisor,
    isStock,
    reason: null,
    label: isStock
      ? 'template cost (this campaign runs research speed at the stock 100%)'
      : `template cost divided by this campaign's ${setting.display ?? `${percent}%`} research speed multiplier`,
    rule: RESEARCH_COST_SCALING_RULE
  });
}

/**
 * The effective research cost of one item.
 *
 * Three things it deliberately does NOT do:
 *
 *   - It does not scale a NEGATIVE cost. `researchCost: -1` is the sentinel for
 *     "never researched at all"; halving it to -0.5 would corrupt the marker
 *     every downstream researchability check reads.
 *   - It does not turn an absent cost into a number. `Number(null) === 0` and a
 *     zero cost renders as "already paid for".
 *   - It does not fail closed to 1. An unknown multiplier returns the template
 *     cost UNCHANGED and the caller states that it is unchecked; silently
 *     dividing by 1 would present an unverified figure as a verified one.
 *
 * @param {*} templateCost the cost exactly as the template states it
 * @param {Object|null} scaling from `buildResearchCostScaling`
 * @returns {number|null}
 */
export function effectiveResearchCost(templateCost, scaling) {
  const cost = strictFiniteNumber(templateCost);
  if (cost === null) return null;
  if (cost < 0) return cost;
  const divisor = scaling?.available === true ? toFinite(scaling.costDivisor) : null;
  if (divisor === null || !(divisor > 0) || divisor === 1) return cost;
  // Rounded to 4 places rather than left raw: 7500/2 is exact but 10000/1.5 is
  // 6666.666666666667, and a cost that carries seventeen digits of float noise
  // into a summed chain total reads as false precision.
  return round(cost / divisor, 4);
}

/**
 * The one-line basis a rendered cost or duration carries.
 *
 * @param {Object|null} scaling from `buildResearchCostScaling`
 * @returns {string}
 */
export function researchCostBasis(scaling) {
  if (scaling?.available !== true) return RESEARCH_COST_SCALING_UNKNOWN.label;
  return scaling.label;
}
