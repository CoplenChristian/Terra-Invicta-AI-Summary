// shared/researchCategoryBonus.mjs
//
// Purpose: the observer's per-category research bonuses from all five wiki-named
//   sources — templates, alien-activity investigations and the diminishing-returns curve.
//
// The observer's per-category research exposure, and the reason no duration is
// divided by it.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// ---------------------------------------------------------------------------
//
// `monthsAtIncome` prices every research duration at ONE flat monthly rate.
// Orgs, hab modules and councilor traits grant PER-CATEGORY research bonuses,
// so a project in a boosted category does not finish at the flat rate. Nothing
// read `techBonuses` before this module.
//
// The save carries no computed per-category multiplier of its own -- a raw scan
// of the 98 MB decompressed save for `techBonus`, `categoryBonus`,
// `researchBonus` and `researchMultiplier` returned zero hits (2026-08-21) --
// so the exposure has to be reconstructed from the templates joined to what the
// observer actually holds. `snapshot.techBonusCatalogue` is that template half,
// baked at snapshot-build time because the hosted worker has no template
// directory.
//
// ---------------------------------------------------------------------------
// FIVE SOURCE TYPES, AND ONE OF THEM IS NOT IN ANY TEMPLATE
// ---------------------------------------------------------------------------
//
// The wiki names five sources of a Research Category Bonus. Three of them carry
// a data-driven `techBonuses` array and a template sweep finds them. Two do not:
//
//   * ALIEN ACTIVITY INVESTIGATIONS grant Xenology and are a plain integer on
//     the faction (`alienInvestigations`). The `InvestigateAlienActivity`
//     mission resolves to `TIMissionEffect_InvestigateAlienActivity`, a
//     code-side effect class with no data-driven bonus, so no template sweep
//     can see it. Read from faction state instead.
//   * SHIPS carrying the Mobile Space Science Lab grant SpaceScience. That one
//     IS in a template (`TIUtilityModuleTemplate.json`,
//     `specialModuleRules: ["GenerateSpaceScienceBonus"]`, value 0.05) but under
//     a different shape than `techBonuses`, and the snapshot's fielded ships do
//     not carry their utility-module names. It is declared UNHANDLED with a
//     reason rather than silently omitted -- see `UNHANDLED_SOURCE_TYPES`.
//
// ---------------------------------------------------------------------------
// DIMINISHING RETURNS ARE QUANTIFIED, ABOVE 50%, PER SOURCE TYPE
// ---------------------------------------------------------------------------
//
// Every hab module template that grants a `techBonus` carries the special rule
// `TechBonusDiminishingReturns`, and no shipped template or config states the
// constant it implies. The WIKI states it:
//
//   actual = 50% + 50% x (base - 50%) / (base + 150%),  for base > 50%
//
// applied to each source separately, and alien-activity investigations are
// exempt. The wiki's own summation sentence -- "the sum of these actual bonuses
// from each source TYPE" -- is what fixes the grouping: the threshold is tested
// against a source type's subtotal, not against one org.
//
// ---------------------------------------------------------------------------
// AND THE DELIVERY MECHANISM NOW PINS. SEE `CATEGORY_RATE_MODEL`.
// ---------------------------------------------------------------------------
//
// With investigations folded in and the ProjectBonus READ from the save rather
// than fitted, the wiki allocation formula reproduces every one of the
// observer's four pip-carrying slots to within 0.15% with ZERO free parameters.
// The measurement is recorded below and in `docs/research-category-rate-spec.md`.
//
// Durations are still reported at the FLAT rate, and the reason was CORRECTED
// on 2026-08-22 (tracker 3b). It used to read "the whole allocation multiplier,
// which on this save runs 2.11x" -- true as a whole-faction figure, and a units
// error as a duration claim. 2.1115x is what the observer's FOUR slots deliver
// SUMMED. One project sits in ONE slot and receives 0.4658x, 0.2928x, 1.0602x
// or 0.2928x of the nominal income; those four sum to the 2.1115x. Three of
// them are BELOW 1, so the flat figure is too SHORT there, not too long.
//
// No single scalar can correct that, because the per-slot factor depends on a
// pip share the project does not have until it is given one. So the flat figure
// stands, is labelled as flat, and the measured category bonus is named beside
// it. See `CATEGORY_RATE_MODEL.durationsStillFlatEvidence`.
//
// Plain ESM, no Node built-ins, no imports outside `shared/`.

import { asArray, round, sameId, toFiniteNumber as toFinite } from './util.mjs';
// One-way: the allocation pricing knows nothing about category bonuses, and
// takes an already-resolved bonus number as an argument. Keeping the direction
// one-way is what stops the two models growing a circular dependency.
import { ALLOCATION_SCENARIOS } from './researchAllocationPricing.mjs';

/** How a category's bonus resolved. `measured-zero` is a real, different state from `unresolved`. */
export const CATEGORY_BONUS_STATES = Object.freeze({
  // Sources were enumerated and at least one grants this category a bonus.
  boosted: 'boosted',
  // Sources were enumerated and NONE grants this category a bonus. A measured
  // zero -- the observer genuinely holds nothing here -- which is a different
  // fact from not having been able to look.
  measuredZero: 'measured-zero',
  // The category is not in the shipped research-category vocabulary, so no
  // bonus can be attributed to it. Two shipped orgs name "Information", which
  // is not a category any project or tech carries.
  unknownCategory: 'unknown-category',
  // The model IS available but the thing being priced carries no category at
  // all, so whether it is boosted cannot be decided.
  absentCategory: 'absent-category',
  // The catalogue or the observer's holdings could not be read at all, so the
  // question was never asked. Distinct from every state above, all of which
  // are answers.
  unresolved: 'unresolved'
});

/**
 * The five source types the wiki names, as this module keys them.
 *
 * Ordered as the wiki lists them so a reader can check the list against the
 * source.
 */
export const CATEGORY_BONUS_SOURCE_TYPES = Object.freeze({
  councilorTrait: 'councilor-trait',
  org: 'org',
  habModule: 'hab-module',
  shipUtilityModule: 'ship-utility-module',
  alienInvestigation: 'alien-investigation'
});

/**
 * Source types this module knows about and CANNOT resolve, with the reason.
 *
 * A named-but-unresolved source is why a category's figure is a lower bound.
 * Omitting it silently would present that lower bound as complete.
 */
export const UNHANDLED_SOURCE_TYPES = Object.freeze([Object.freeze({
  sourceType: CATEGORY_BONUS_SOURCE_TYPES.shipUtilityModule,
  categories: Object.freeze(['SpaceScience']),
  grantedBy: 'a fielded ship carrying the Mobile Space Science Lab utility module '
    + '(TIUtilityModuleTemplate.json, specialModuleRules ["GenerateSpaceScienceBonus"], '
    + 'specialModuleValue 0.05)',
  reason: 'the snapshot\'s fielded ships carry a weapon loadout but not their utility-module template '
    + 'names, so how many Mobile Space Science Labs the observer flies cannot be read. The SpaceScience '
    + 'figure is therefore a LOWER BOUND, not a measured total.',
  wouldNeed: 'utility-module template names on each fielded ship in `snapshot.fleets[].ships[]`'
})]);

/**
 * The bonus rules, as the official wiki states them.
 *
 * EVERY NUMBER IN THIS BLOCK IS A WIKI CLAIM, NOT A MEASUREMENT. Neither the
 * 1%-per-investigation rate nor the diminishing-returns constant appears in any
 * shipped template or in `TIGlobalConfig.json` (which carries only
 * `globalResearchMultiplier: 1`), and a raw scan of the decompressed save for
 * `techBonus`, `categoryBonus`, `researchBonus`, `researchMultiplier` and
 * `ProjectBonus` returns zero hits. There is nothing in the shipped data to
 * check them against directly.
 *
 * What IS measured is the consequence: applying them reproduces the observer's
 * own per-slot research delivery to within 0.15% with zero free parameters.
 * See `CATEGORY_RATE_MODEL`. That is corroboration of the rules as a set, not
 * an independent confirmation of either constant on its own.
 */
export const CATEGORY_BONUS_RULES = Object.freeze({
  claimStatus: 'WIKI CLAIM. Not measured from the shipped data, which states neither constant anywhere. '
    + 'Corroborated indirectly by CATEGORY_RATE_MODEL, which reproduces measured delivery when these '
    + 'rules are applied.',
  sources: Object.freeze([
    'Terra Invicta wiki, `Technology`, revision timestamp 2026-05-06, read as raw wikitext 2026-08-21',
    'Terra Invicta wiki, `Aliens`, revision timestamp 2026-04-05, read as raw wikitext 2026-08-21'
  ]),
  sourceTypes: Object.freeze([
    'councilor traits', 'equipped orgs', 'hab modules',
    'ships with the Mobile Space Science Lab utility module (SpaceScience only)',
    'alien activity investigations (Xenology only)'
  ]),

  // ---- alien activity investigations -----------------------------------
  investigationBonusEach: 0.01,
  investigationCategory: 'Xenology',
  investigationBasis: 'Terra Invicta wiki, `Aliens` rev 2026-04-05: "+1% per Alien Activity '
    + 'Investigation" for the xenology category. Read from `alienInvestigations` on the faction, which '
    + 'is a plain integer the save carries directly. The mission itself resolves to '
    + '`TIMissionEffect_InvestigateAlienActivity`, a code-side effect with no data-driven bonus, so no '
    + 'template states this rate.',
  investigationExemptFromDiminishingReturns: true,

  // ---- diminishing returns ---------------------------------------------
  diminishingReturnsThreshold: 0.5,
  diminishingReturnsFormula: 'actual = 50% + 50% x (base - 50%) / (base + 150%), for base > 50%',
  diminishingReturnsAppliedPer: 'source type',
  diminishingReturnsGroupingBasis: 'the wiki applies the rule to "each source ... separately" and then '
    + 'sums "these actual bonuses from each source TYPE", so the threshold is tested against a source '
    + 'type\'s subtotal (all orgs together, all hab modules together), not against one org. That reading '
    + 'is a JUDGEMENT about an ambiguous sentence, not a measurement; on this campaign no source type '
    + 'reaches 50% so the two readings are indistinguishable here.',
  diminishingReturnsExempt: Object.freeze([CATEGORY_BONUS_SOURCE_TYPES.alienInvestigation]),
  diminishingReturnsBasis: 'Terra Invicta wiki, `Technology` rev 2026-05-06: "Except for alien activity '
    + 'investigations, each source will have diminishing returns applied to it separately when its base '
    + 'bonus exceeds 50%. Specifically, if the base bonus is more than 50%, then the actual bonus is set '
    + 'to 50% + 50% x (Base Bonus - 50%) / (Base Bonus + 150%)." No shipped template or config states '
    + 'this constant; `TechBonusDiminishingReturns` names the rule without quantifying it.'
});

/**
 * The wiki diminishing-returns curve. Below the threshold it is the identity.
 *
 * Returns `null` for an unreadable base rather than 0 -- a bonus that could not
 * be summed is not a bonus of zero.
 */
export function applyDiminishingReturns(baseBonus, { exempt = false } = {}) {
  const base = toFinite(baseBonus);
  if (base === null) return null;
  if (exempt === true) return base;
  const threshold = CATEGORY_BONUS_RULES.diminishingReturnsThreshold;
  if (!(base > threshold)) return base;
  return round(threshold + threshold * (base - threshold) / (base + 1.5), 6);
}

/**
 * What was measured about the relation between a category bonus and the rate
 * research is actually delivered at.
 *
 * The numbers come from two consecutive 15.5-day intervals on the observer's
 * own save, compared RELATIVELY (slot against slot within one interval) so any
 * drift in total research income cancels -- the technique
 * `researchSlots.ALLOCATION_MODEL.reproduction` documents.
 */
export const CATEGORY_RATE_MODEL = Object.freeze({
  measuredOn: 'Autosave3 (12/1/2034) -> Autosave2 (12/16/2034 12:00) -> Autosave (1/1/2035), observer '
    + '4712, frozen to disk and MD5-verified against the save folder, 2026-08-21 (re-verified byte-for-'
    + 'byte on 2026-08-21 before this second measurement)',
  method: 'per-slot delivered research differenced across two consecutive 15.5-day intervals with the pip '
    + 'layout [0,0,3,1,3,1] unchanged throughout, then compared as a per-pip RATIO between slots inside '
    + 'one interval so global income drift cancels.',

  // ---- the model, with every term read rather than fitted ---------------
  formula: 'delivered to slot X = base x (1 + 5% per pipped slot) x pips_X / totalPips '
    + 'x (1 + CategoryBonus_X x 0.9^(pipped slots of the same category - 1) + ProjectBonus if X is a project)',
  formulaSource: 'Terra Invicta wiki, `Technology` rev 2026-05-06',
  freeParameters: 0,
  termsRead: Object.freeze({
    base: '`cachedYearlyRevenue.Research` (37,735.23/yr), pro-rated over the interval',
    categoryBonus: 'the reconstructed per-category sum, WITH alien-activity investigations included: '
      + 'Xenology 0.20 from two Xenology Labs + 24 investigations x 1% = 0.44',
    projectBonus: '`cachedYearlyRevenue.Projects` = 21, less the 1 spent on `orgProjectSlotUnlocked` and '
      + 'the 1 spent on `habProjectSlotUnlocked`, x 5% capped at 100% = 0.95. READ FROM THE SAVE, not '
      + 'fitted -- which is what turns this from a fit into a test.'
  }),

  // ---- what reproduced -------------------------------------------------
  pinned: true,
  whatReproduced: Object.freeze({
    everySlotShare: 'interval 1, all four pip-carrying slots at once: predicted share of delivered '
      + 'research against observed share -- global tech LifeScience +0.109%, project MilitaryScience '
      + '-0.044%, project Xenology -0.023%, project Energy -0.044%. Against a per-slot integer-rounding '
      + 'noise floor of 0.059% to 0.213%. Four slots, zero free parameters, every residual inside noise.',
    perPipRatios: 'the four independent per-pip ratios, which cancel total income entirely: Xenology / '
      + 'MilitaryScience predicted 1.207071 observed 1.206823 (0.021%); Energy / MilitaryScience '
      + 'predicted 1.000000 observed 1.000000 (0.000%); MilitaryScience project / LifeScience global '
      + 'tech predicted 1.885714 observed 1.888591 (-0.152%); Xenology project / LifeScience global tech '
      + 'predicted 2.276190 observed 2.279195 (-0.132%).',
    equalBonusEqualDelivery: 'two project slots holding one pip each in DIFFERENT categories that carry '
      + 'the SAME reconstructed bonus (MilitaryScience 0.03 from an org plus a trait, Energy 0.03 from '
      + 'two orgs) delivered exactly 469 points each. Equal bonus, equal delivery, to the last integer -- '
      + 'and across different source types, which is what licenses summing them.',
    absoluteScale: 'the absolute prediction is uniformly 1.4% high across all four slots (observed / '
      + 'predicted 0.98461, 0.98612, 0.98591, 0.98612). One common scale factor, not a structural '
      + 'mis-fit; consistent with income drift inside the interval or a slightly different elapsed-day '
      + 'convention.',
    intervalTwo: 'slots 2 and 5 changed occupant during interval 2 so only slots 3 and 4 are differenceable. '
      + 'Xenology / MilitaryScience observed 1.208696 against 1.207071 predicted (-0.134%), or 1.208902 '
      + '(0.017%) if the 0.9 same-category decay is applied to MilitaryScience, which slot 2 triggered '
      + 'partway through the interval. Both inside noise; the decay term is corroborated, not pinned.'
  }),

  // ---- what the previous run tested, and why it failed ------------------
  naiveModel: 'months = cost / (income x (1 + categoryBonus))',
  naiveModelObservedRatio: Object.freeze([1.206823, 1.208696]),
  naiveModelReproduces: false,
  naiveModelVerdict: 'REFUTED at both Xenology figures, and it was never the category term that was '
    + 'wrong. At the old Xenology 0.20 it predicts 1.16505, 3.46% low; at the corrected 0.44 it predicts '
    + '1.39806, 15.85% high. It brackets the observation because it omits the ProjectBonus term '
    + 'altogether, and both compared slots are projects. Adding that term -- read from the save, not '
    + 'fitted -- brings the same two figures to 0.021%.',
  whyThePreviousRunCouldNotFit: 'it searched for a one-parameter category model. The residual was not in '
    + 'the category term: it was a missing +95% ProjectBonus and a Xenology bonus under-reconstructed by '
    + 'the 24 alien-activity investigations, which no template carries. The previous run recorded that '
    + '`ProjectBonus = -0.209` looked like a project PENALTY and rejected it, and that a true Xenology '
    + 'bonus of >= 0.2435 would collapse the contradiction. Both readings were right; the missing 0.24 '
    + 'was the investigations.',

  // ---- what this does NOT license ---------------------------------------
  durationsStillFlat: true,
  durationsStillFlatReason: 'the pinned model does NOT yield a scalar duration correction, and the '
    + 'earlier claim that it did was a units error corrected on 2026-08-22 (tracker 3b). '
    + '`cachedYearlyRevenue.Research` is indeed the PRE-allocation base and the observer\'s slots did '
    + 'collectively receive 2.1115x it -- but that 2.1115x is the WHOLE FACTION\'s throughput summed over '
    + 'four slots, and a duration is about ONE slot. Per slot the measured factor is 0.4658x, 0.2928x, '
    + '1.0602x and 0.2928x of the nominal income (they sum to the 2.1115x), so the flat figure is too '
    + 'SHORT on three of the four, not too long, and no single scalar corrects it. Correcting the '
    + 'category term alone would move a duration a few per cent in a figure whose per-slot spread is '
    + '3.6x. So durations stay flat, stay labelled flat, and the measured category bonus is named '
    + 'beside them.',
  // The arithmetic behind the sentence above, so the claim is checkable rather
  // than asserted. Every figure is measured; nothing here is a projection.
  durationsStillFlatEvidence: Object.freeze({
    nominalMonthlyIncome: 3144.60,
    nominalMonthlyIncomeSource: '`cachedYearlyRevenue.Research` 37,735.23 / 12 -- the exact divisor '
      + '`monthsAtIncome` uses',
    intervalDays: 15.5,
    perSlotDeliveryFactor: Object.freeze([
      Object.freeze({ slot: 2, kind: 'global-tech', category: 'LifeScience', pips: 3, deliveredOverInterval: 745.85, factorOfNominalIncome: 0.4658, flatFigureIs: 'too short by 2.15x' }),
      Object.freeze({ slot: 3, kind: 'project', category: 'MilitaryScience', pips: 1, deliveredOverInterval: 468.82, factorOfNominalIncome: 0.2928, flatFigureIs: 'too short by 3.42x' }),
      Object.freeze({ slot: 4, kind: 'project', category: 'Xenology', pips: 3, deliveredOverInterval: 1697.71, factorOfNominalIncome: 1.0602, flatFigureIs: 'too long by 1.06x' }),
      Object.freeze({ slot: 5, kind: 'project', category: 'Energy', pips: 1, deliveredOverInterval: 468.82, factorOfNominalIncome: 0.2928, flatFigureIs: 'too short by 3.42x' })
    ]),
    wholeFactionFactor: 2.1115,
    wholeFactionFactorIsTheSum: 'the four per-slot factors sum to it (0.4658 + 0.2928 + 1.0602 + 0.2928 '
      + '= 2.1116, to rounding). That identity IS the error the earlier claim made: it used the sum where '
      + 'a duration needs one term of it.',
    // The one bound the model does yield, stated so the reader is not left with
    // only a negative result.
    fastestAchievable: 'putting EVERY pip on one slot gives that slot pipShare 1 and one pipped slot, so '
      + 'it receives 1.05 x (1 + CategoryBonus + ProjectBonus) x nominal income. That is a real LOWER '
      + 'bound on months, and it is category-dependent, not scalar: 1.1025x for a LifeScience global tech '
      + 'against 2.5095x for a Xenology project on this save -- a spread of 2.28x. The flat figure is an '
      + 'upper bound on THAT best case only (the multiplier is >= 1.05 always), never on the duration at '
      + 'the current allocation.',
    doesNotReapplyTheCampaignMultiplier: 'the 2.079x that a typical project would gain under full '
      + 'concentration on this save lands within 4% of the campaign\'s own 200% researchSpeedMultiplier, '
      + 'which is a coincidence of this campaign carrying a 95% ProjectBonus, and it is why no such '
      + 'factor is applied. Structurally the two are unrelated: ProjectBonus is read per faction from '
      + '`cachedYearlyRevenue.Projects` (measured 0.80 on one rival, 1.00 on four others) and applies to '
      + 'project slots only, while a campaign multiplier would apply to every slot alike. '
      + '`cachedYearlyRevenue.Research` is already post-researchSpeedMultiplier -- see '
      + '`ALLOCATION_MODEL.reproduction.whyTheAbsoluteSwingCannotAnswerThe200Percent`.',
    measuredOn: 'Autosave3.gz -> Autosave2.gz, observer 4712, 15.5 days, MD5-verified frozen copies, '
      + '2026-08-22'
  }),
  untested: Object.freeze([
    'the 0.9^(n-1) same-category decay: every category held exactly one pipped slot in interval 1, so the '
      + 'exponent was 0 everywhere and the term never engaged. Interval 2 corroborates it weakly.',
    'the diminishing-returns curve: no source type on this campaign reaches the 50% threshold, so the '
      + 'curve is the identity throughout and applying it changes nothing here.',
    'the ProjectBonus 100% cap: the observer sits at 95%, below it.'
  ]),
  whatWouldTestTheRest: 'a save in which one source type\'s subtotal exceeds 50% would exercise the '
    + 'diminishing-returns curve, and two pipped slots in the same category would exercise the 0.9 decay.',
  spec: 'docs/research-category-rate-spec.md'
});

/** Months at a flat rate, with the reason the rate is flat. Never fabricates. */
function flatMonths(remainingCost, monthlyIncome) {
  const cost = toFinite(remainingCost);
  const income = toFinite(monthlyIncome);
  if (cost === null || income === null || !(income > 0)) return null;
  return round(cost / income, 1);
}

/** Which named-but-unresolvable source types touch this category. */
function unhandledFor(category) {
  return UNHANDLED_SOURCE_TYPES.filter(entry => entry.categories.includes(category));
}

/**
 * One category's bonus, its state, and every source that contributed to it.
 *
 * `summedBonus` is the plain arithmetic sum of the grants. `effectiveBonus` is
 * the wiki rule applied: each SOURCE TYPE's subtotal passed through the
 * diminishing-returns curve above 50%, with alien-activity investigations
 * exempt, then summed. Below the threshold the two are equal, which is the case
 * on every source type this campaign holds.
 */
function categoryRow(category, contributions, { known }) {
  const sources = contributions ?? [];
  const unhandled = unhandledFor(category);
  const lowerBoundReason = unhandled.length === 0
    ? null
    : unhandled.map(entry => entry.reason).join(' ');

  if (!known) {
    return {
      category,
      state: CATEGORY_BONUS_STATES.unresolved,
      summedBonus: null,
      effectiveBonus: null,
      sources: [],
      sourceCount: null,
      bySourceType: [],
      diminishedSourceTypes: [],
      anySourceTypeDiminished: null,
      isLowerBound: null,
      lowerBoundReason,
      effectiveBonusUnavailableReason: 'the observer\'s bonus-granting holdings could not be read in '
        + 'this snapshot'
    };
  }
  if (sources.length === 0) {
    return {
      category,
      state: CATEGORY_BONUS_STATES.measuredZero,
      // A measured zero: the sources WERE enumerated and none grants this
      // category anything. Distinct from `unresolved`, which is null.
      summedBonus: 0,
      effectiveBonus: 0,
      sources: [],
      sourceCount: 0,
      bySourceType: [],
      diminishedSourceTypes: [],
      anySourceTypeDiminished: false,
      // A category with an unresolvable source type is a lower bound even at
      // zero: "none found" is not "none exists" when one source cannot be read.
      isLowerBound: unhandled.length > 0,
      lowerBoundReason,
      effectiveBonusUnavailableReason: null
    };
  }

  // Group by SOURCE TYPE, because that is the unit the diminishing-returns
  // threshold is tested against -- see CATEGORY_BONUS_RULES.
  const groups = new Map();
  for (const source of sources) {
    const type = source.kind;
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type).push(source);
  }

  const bySourceType = [];
  for (const [sourceType, members] of groups) {
    const exempt = CATEGORY_BONUS_RULES.diminishingReturnsExempt.includes(sourceType);
    const base = round(members.reduce((total, source) => total + source.bonus, 0), 6);
    const actual = applyDiminishingReturns(base, { exempt });
    bySourceType.push({
      sourceType,
      summedBonus: base,
      effectiveBonus: actual,
      exemptFromDiminishingReturns: exempt,
      diminished: exempt === false && actual !== null && actual < base,
      sourceCount: members.length
    });
  }

  const summed = round(bySourceType.reduce((total, group) => total + group.summedBonus, 0), 6);
  const effective = round(bySourceType.reduce((total, group) => total + group.effectiveBonus, 0), 6);
  const diminished = bySourceType.filter(group => group.diminished).map(group => group.sourceType);

  return {
    category,
    state: CATEGORY_BONUS_STATES.boosted,
    summedBonus: summed,
    summedBonusBasis: 'the arithmetic sum of every grant the observer holds in this category, before the '
      + 'diminishing-returns rule. Listed source by source below so the figure is checkable.',
    // Now a number rather than a null: the wiki quantifies the rule the
    // templates only name. Equal to the sum whenever no source type exceeds
    // the 50% threshold, which is every source type on this campaign.
    effectiveBonus: effective,
    effectiveBonusBasis: `the wiki diminishing-returns rule applied per source type (${CATEGORY_BONUS_RULES.diminishingReturnsFormula}), `
      + 'alien-activity investigations exempt, then summed across types. '
      + CATEGORY_BONUS_RULES.claimStatus,
    effectiveBonusUnavailableReason: null,
    bySourceType,
    diminishedSourceTypes: diminished,
    anySourceTypeDiminished: diminished.length > 0,
    // A named source type this module cannot read makes the figure a floor.
    isLowerBound: unhandled.length > 0,
    lowerBoundReason,
    sourceCount: sources.length,
    sources
  };
}

const unavailableResult = (reason) => Object.freeze({
  available: false,
  reason,
  source: null,
  categories: {},
  categoryCount: 0,
  boostedCategories: [],
  knownCategories: [],
  unknownCategoryGrants: [],
  unresolvedTemplates: [],
  unresolvedTemplateCount: null,
  excludedModules: null,
  alienInvestigations: null,
  alienInvestigationsState: 'unresolved',
  rules: CATEGORY_BONUS_RULES,
  unhandledSourceTypes: UNHANDLED_SOURCE_TYPES,
  model: CATEGORY_RATE_MODEL,
  bonusFor: () => ({
    category: null,
    state: CATEGORY_BONUS_STATES.unresolved,
    summedBonus: null,
    effectiveBonus: null,
    sources: [],
    sourceCount: null,
    bySourceType: [],
    diminishedSourceTypes: [],
    anySourceTypeDiminished: null,
    isLowerBound: null,
    lowerBoundReason: null,
    effectiveBonusUnavailableReason: reason
  })
});

/**
 * The observer's per-category research bonuses, with contributing sources.
 *
 * Counts a hab module ONLY when it is powered, construction-complete and not
 * destroyed. An unpowered lab contributes nothing, and a module still being
 * built contributes nothing; both are counted into `excludedModules` so the
 * exclusion is visible rather than silent.
 *
 * @param {Object} snapshot filtered or raw snapshot
 * @param {Object} options
 * @param {number|string} options.observerId
 * @returns {Object} always an object; `available: false` with a reason when the
 *   catalogue or the observer is absent.
 */
export function buildResearchCategoryBonuses(snapshot, { observerId } = {}) {
  const catalogue = snapshot?.techBonusCatalogue;
  if (!catalogue || typeof catalogue !== 'object') {
    return unavailableResult('this snapshot carries no techBonuses catalogue; re-publish with the '
      + 'techBonusCatalogue payload to resolve per-category research bonuses');
  }

  const observer = asArray(snapshot?.factions).find(faction => sameId(faction?.ID, observerId)) || null;
  if (!observer) {
    return unavailableResult('the requested observer is not present in this snapshot, so no per-category '
      + 'research bonus could be read');
  }

  const knownCategories = asArray(catalogue.categories);
  const knownCategorySet = new Set(knownCategories);
  const byCategory = new Map();
  const unknownCategoryGrants = [];
  const unresolvedTemplates = [];
  const excludedModules = { unpowered: 0, incomplete: 0, destroyed: 0, decommissioning: 0 };

  const record = (category, bonus, source) => {
    // A grant naming a category outside the shipped vocabulary cannot be
    // attributed. Mapping "Information" onto "InformationScience" would be a
    // guess, and a guess here silently moves a duration.
    if (!knownCategorySet.has(category)) {
      unknownCategoryGrants.push({ ...source, category, bonus });
      return;
    }
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category).push({ ...source, bonus });
  };

  // --- hab modules ---------------------------------------------------------
  // Only powered, complete, undestroyed modules. Every rejection is counted.
  for (const module of asArray(snapshot?.habModules)) {
    if (!sameId(module?.factionId, observerId)) continue;
    if (module.destroyed === true) { excludedModules.destroyed += 1; continue; }
    if (module.constructionCompleted !== true) { excludedModules.incomplete += 1; continue; }
    if (module.decommissioning === true) { excludedModules.decommissioning += 1; continue; }
    // `powered` is tri-state on the snapshot: true, false, or null when the
    // save did not carry it. Only an explicit `true` counts -- an unknown
    // power state is not a powered lab.
    if (module.powered !== true) { excludedModules.unpowered += 1; continue; }

    const templateName = module.templateName ?? null;
    if (templateName === null) {
      // No template name to look up. Whether this module grants a bonus is
      // unmeasured, not zero, so it is recorded rather than silently skipped.
      unresolvedTemplates.push({ kind: 'hab-module', templateName: null, location: module.habName ?? null });
      continue;
    }
    // The catalogue was built from EVERY installed hab module template and
    // keeps only the bonus-granting ones, so a resolvable name that is absent
    // from it genuinely grants nothing. That is a measured zero, not a gap.
    const entry = catalogue.habModules?.[templateName];
    if (!entry) continue;
    for (const grant of asArray(entry.bonuses)) {
      record(grant.category, grant.bonus, {
        kind: CATEGORY_BONUS_SOURCE_TYPES.habModule,
        templateName,
        displayName: entry.displayName || templateName,
        location: module.habName ?? null,
        diminishingReturns: entry.diminishingReturns === true
      });
    }
  }

  // --- councilor orgs and traits ------------------------------------------
  for (const councilor of asArray(snapshot?.councilors)) {
    if (!sameId(councilor?.factionId, observerId)) continue;
    const holder = councilor.displayName ?? councilor.ID ?? null;

    for (const org of asArray(councilor.orgs)) {
      const templateName = org?.templateName ?? null;
      if (templateName === null) {
        unresolvedTemplates.push({ kind: 'org', templateName: null, location: holder });
        continue;
      }
      const entry = catalogue.orgs?.[templateName];
      if (!entry) continue;
      for (const grant of asArray(entry.bonuses)) {
        record(grant.category, grant.bonus, {
          kind: CATEGORY_BONUS_SOURCE_TYPES.org,
          templateName,
          displayName: org.displayName || entry.displayName || templateName,
          location: holder,
          diminishingReturns: entry.diminishingReturns === true
        });
      }
    }

    for (const traitName of asArray(councilor.traits)) {
      const entry = typeof traitName === 'string' ? catalogue.traits?.[traitName] : null;
      if (!entry) continue;
      for (const grant of asArray(entry.bonuses)) {
        record(grant.category, grant.bonus, {
          kind: CATEGORY_BONUS_SOURCE_TYPES.councilorTrait,
          templateName: traitName,
          displayName: entry.displayName || traitName,
          location: holder,
          diminishingReturns: entry.diminishingReturns === true
        });
      }
    }
  }

  // --- alien-activity investigations --------------------------------------
  // NOT IN ANY TEMPLATE. `InvestigateAlienActivity` resolves to a code-side
  // effect class, so the rate is a wiki claim (Aliens rev 2026-04-05, +1% each)
  // and the count is a plain integer on the faction. Xenology only, and exempt
  // from diminishing returns.
  //
  // Absent stays null: a faction record that does not carry the field has an
  // UNKNOWN investigation count, which is not a count of zero. `Number(null)`
  // is 0, so the guard is on presence.
  const rawInvestigations = observer.alienInvestigations;
  const investigations = toFinite(rawInvestigations);
  const investigationsKnown = investigations !== null && investigations >= 0;
  if (investigationsKnown && investigations > 0) {
    record(CATEGORY_BONUS_RULES.investigationCategory,
      round(investigations * CATEGORY_BONUS_RULES.investigationBonusEach, 6), {
        kind: CATEGORY_BONUS_SOURCE_TYPES.alienInvestigation,
        templateName: null,
        displayName: `${investigations} alien-activity investigation(s)`,
        location: null,
        count: investigations,
        bonusEach: CATEGORY_BONUS_RULES.investigationBonusEach,
        basis: CATEGORY_BONUS_RULES.investigationBasis,
        diminishingReturns: false
      });
  }

  // Every category in the shipped vocabulary gets a row, so a caller can tell
  // "no bonus here" (measured zero) from "never looked" without a lookup miss
  // silently reading as either.
  const categories = {};
  for (const category of knownCategories) {
    const row = categoryRow(category, byCategory.get(category) || [], { known: true });
    // An unreadable investigation count makes the Xenology figure a floor, on
    // exactly the same footing as an unreadable ship utility module. Silence
    // here would present a partial sum as a total.
    if (!investigationsKnown && category === CATEGORY_BONUS_RULES.investigationCategory) {
      row.isLowerBound = true;
      row.lowerBoundReason = [row.lowerBoundReason,
        'this snapshot carries no `alienInvestigations` count for the observer, so the '
        + `${CATEGORY_BONUS_RULES.investigationBonusEach * 100}%-per-investigation Xenology contribution `
        + 'could not be read. It is omitted rather than counted as zero.'
      ].filter(Boolean).join(' ');
    }
    categories[category] = row;
  }

  const bonusFor = (category) => {
    if (typeof category !== 'string' || category === '') {
      return {
        category: category ?? null,
        state: CATEGORY_BONUS_STATES.absentCategory,
        summedBonus: null,
        effectiveBonus: null,
        sources: [],
        sourceCount: null,
        bySourceType: [],
        diminishedSourceTypes: [],
        anySourceTypeDiminished: null,
        isLowerBound: null,
        lowerBoundReason: null,
        effectiveBonusUnavailableReason: 'this project carries no research category, so whether the '
          + 'observer has boosted it cannot be decided'
      };
    }
    if (categories[category]) return categories[category];
    return {
      category,
      state: CATEGORY_BONUS_STATES.unknownCategory,
      summedBonus: null,
      effectiveBonus: null,
      sources: [],
      sourceCount: null,
      bySourceType: [],
      diminishedSourceTypes: [],
      anySourceTypeDiminished: null,
      isLowerBound: null,
      lowerBoundReason: null,
      effectiveBonusUnavailableReason: `'${category}' is not one of the ${knownCategories.length} research `
        + 'categories the installed templates carry, so no bonus can be attributed to it'
    };
  };

  const boosted = Object.values(categories)
    .filter(row => row.state === CATEGORY_BONUS_STATES.boosted)
    .sort((a, b) => b.effectiveBonus - a.effectiveBonus);

  return {
    available: true,
    reason: null,
    source: 'the installed templates\' `techBonuses`, joined to the observer\'s powered completed hab '
      + 'modules and its councilors\' assigned orgs and traits, plus the observer\'s alien-activity '
      + 'investigation count read from faction state',
    inclusionRule: 'a hab module counts only when it is powered, construction-complete and not destroyed '
      + 'or decommissioning. An unpowered lab contributes nothing.',
    // The rules these figures apply, with their wiki citations and the note
    // that they are claims rather than measurements.
    rules: CATEGORY_BONUS_RULES,
    // Source types the wiki names that this module cannot resolve. Named so a
    // reader can see which categories are floors rather than totals.
    unhandledSourceTypes: UNHANDLED_SOURCE_TYPES,
    // Absent stays null: an unreadable count is `null` with state `unresolved`,
    // never 0, because 0 investigations is a real and different fact.
    alienInvestigations: investigationsKnown ? investigations : null,
    alienInvestigationsState: investigationsKnown ? 'measured' : 'unresolved',
    alienInvestigationsBonus: investigationsKnown
      ? round(investigations * CATEGORY_BONUS_RULES.investigationBonusEach, 6)
      : null,
    alienInvestigationsBasis: CATEGORY_BONUS_RULES.investigationBasis,
    categories,
    categoryCount: knownCategories.length,
    knownCategories,
    boostedCategories: boosted.map(row => row.category),
    // Grants naming a category outside the shipped vocabulary. Two shipped orgs
    // do exactly this. Reported, never guessed onto a neighbouring category.
    unknownCategoryGrants,
    unknownCategoryGrantCount: unknownCategoryGrants.length,
    unknownCategoryNote: unknownCategoryGrants.length === 0
      ? null
      : `${unknownCategoryGrants.length} shipped grant(s) name a category that no project or tech carries `
        + `(${[...new Set(unknownCategoryGrants.map(g => g.category))].join(', ')}). They are not `
        + 'attributed to any category, because the nearest real category is a guess.',
    // Holdings whose template name the snapshot does not carry, so whether they
    // grant a bonus is unmeasured. A resolvable name absent from the catalogue
    // is NOT one of these -- the catalogue was built from every installed
    // template, so absence there is a measured "grants nothing".
    unresolvedTemplates,
    unresolvedTemplateCount: unresolvedTemplates.length,
    summedBonusIsCompleteBasis: unresolvedTemplates.length === 0
      ? 'every holding resolved to an installed template, so each summed figure covers all of them'
      : `${unresolvedTemplates.length} holding(s) carry no template name, so each summed figure is a `
        + 'lower bound',
    catalogueScanned: catalogue.scanned ?? null,
    excludedModules,
    diminishingReturnsNote: catalogue.diminishingReturnsNote ?? null,
    model: CATEGORY_RATE_MODEL,
    bonusFor
  };
}

/**
 * The clause that names a row's category bonus beside its flat duration.
 *
 * Returns `''` for a row with nothing to say, so a caller can concatenate it
 * unconditionally. It states the bonus and that it is NOT applied; it does not
 * claim which way or by how much the true figure moves, and that restraint is
 * now the MEASURED position rather than a hedge: the per-slot allocation factor
 * runs 0.29x to 1.06x of the nominal income on the save it was measured
 * against, so a flat duration can be too short or too long depending on the pip
 * share -- see `CATEGORY_RATE_MODEL.durationsStillFlatEvidence`.
 */
export function categoryBonusCaveat({ state, categoryResearchBonus, monthsAreUpperBound } = {}) {
  if (state === CATEGORY_DURATION_STATES.allocationAssumed) {
    return ' — assumes one pip; faster with more';
  }
  if (state === CATEGORY_DURATION_STATES.receivesNothing) {
    return ' — this slot carries no pips, so it receives nothing';
  }
  if (state === CATEGORY_DURATION_STATES.flatRateUnpriced) {
    return ' — flat rate; the observer\'s slot allocation could not be read, so this is not priced';
  }
  if (state === CATEGORY_DURATION_STATES.allocationMeasured && monthsAreUpperBound === true) {
    const bonus = toFinite(categoryResearchBonus);
    return bonus === null
      ? ' — at most; this category\'s research bonus could not be resolved'
      : ` — at most; this category's measured +${round(bonus * 100, 1)}% research is a lower bound`;
  }
  return '';
}

/**
 * What the measured research income already contains, stated wherever that
 * income is reported so no consumer applies a flat multiplier on top of it.
 */
export const MEASURED_INCOME_BASIS = 'read from the save, so every FLAT research bonus the observer runs '
  + '-- engineers at 5% each among them -- is already inside this figure. Applying an engineer or other '
  + 'flat multiplier on top of it double-counts. What a single total CANNOT encode is the per-category '
  + 'variation, which is what `categoryBonuses` covers.';

/**
 * A serialisable projection of the bonus model, for an API response.
 *
 * Drops the `bonusFor` accessor (a function does not survive a JSON response)
 * and keeps every measured field, so the figure a reader sees is checkable
 * against its named sources.
 */
export function categoryBonusSummary(model) {
  if (!model || model.available !== true) {
    return {
      available: false,
      reason: model?.reason ?? 'no per-category research bonus model was built',
      categories: {},
      boostedCategories: [],
      rules: CATEGORY_BONUS_RULES,
      unhandledSourceTypes: UNHANDLED_SOURCE_TYPES,
      alienInvestigations: null,
      alienInvestigationsState: 'unresolved',
      alienInvestigationsBonus: null,
      alienInvestigationsBasis: CATEGORY_BONUS_RULES.investigationBasis,
      durationStates: CATEGORY_DURATION_BASES,
      model: CATEGORY_RATE_MODEL
    };
  }
  return {
    available: true,
    reason: null,
    source: model.source,
    inclusionRule: model.inclusionRule,
    categories: model.categories,
    categoryCount: model.categoryCount,
    knownCategories: model.knownCategories,
    boostedCategories: model.boostedCategories,
    unknownCategoryGrants: model.unknownCategoryGrants,
    unknownCategoryGrantCount: model.unknownCategoryGrantCount,
    unknownCategoryNote: model.unknownCategoryNote,
    unresolvedTemplates: model.unresolvedTemplates,
    unresolvedTemplateCount: model.unresolvedTemplateCount,
    summedBonusIsCompleteBasis: model.summedBonusIsCompleteBasis,
    catalogueScanned: model.catalogueScanned,
    excludedModules: model.excludedModules,
    diminishingReturnsNote: model.diminishingReturnsNote,
    // The wiki rules these figures apply, with their revision dates and the
    // explicit note that they are claims rather than measurements.
    rules: model.rules,
    unhandledSourceTypes: model.unhandledSourceTypes,
    // The source no template carries.
    alienInvestigations: model.alienInvestigations,
    alienInvestigationsState: model.alienInvestigationsState,
    alienInvestigationsBonus: model.alienInvestigationsBonus,
    alienInvestigationsBasis: model.alienInvestigationsBasis,
    // What each row's `monthsAtCurrentIncomeState` means. Stated once here
    // rather than repeated on every row.
    durationStates: CATEGORY_DURATION_BASES,
    model: model.model
  };
}

/**
 * The states a category-aware duration can be in.
 *
 * EVERY state except `unmeasured-income` carries a number. The flat figure is
 * never withdrawn on account of a category bonus: the pinned rate model puts
 * the flat rate's per-slot error at 0.29x to 1.06x of the nominal income
 * depending on pip share (measured), a spread of 3.6x that no category-term
 * correction touches and no single scalar closes. Withdrawing a duration to fix
 * a few per cent would remove a usable figure without touching that. The bonus
 * is NAMED beside the number instead, and the number stays labelled flat.
 */
export const CATEGORY_DURATION_STATES = Object.freeze({
  // ---- the allocation-priced states, 2026-08-22 -------------------------
  // The item occupies a research slot whose pip weight is read from the save,
  // so every term of the rate is measured. This is the only state that is a
  // measurement rather than a scenario.
  allocationMeasured: 'allocation-measured',
  // The item is not in a slot, so a pip allocation had to be ASSUMED. `months`
  // is the `one-pip` scenario and `monthsFastest` is the `all-pips` one; the
  // row names which it assumed. Never present this as a measurement.
  allocationAssumed: 'allocation-assumed',
  // The item sits in a slot carrying no pips. It receives NOTHING, so it has no
  // time to complete: `months` is null with a reason, never a large number and
  // never zero.
  receivesNothing: 'slot-receives-nothing',
  // The allocation model could not be built -- no `researchWeights`, no
  // Projects figure, or no measured income for the observer. The FLAT figure is
  // passed through exactly as it read before this model existed and labelled as
  // unpriced. It is NOT an upper bound: at one pip of eight the flat figure
  // measured 3.42x optimistic.
  flatRateUnpriced: 'flat-rate-unpriced',
  // No measured research income at all, so no duration at any rate.
  unmeasuredIncome: 'unmeasured-income'
});

/**
 * The four states this enum carried until 2026-08-22, kept rather than deleted
 * because a reader who finds one in an older published snapshot needs to know
 * what it meant and why it is gone.
 *
 * All four described the CATEGORY dimension of a duration that was, in every
 * case, the flat whole-faction figure. That dimension has not been dropped --
 * it moved onto explicit fields (`categoryResearchBonus`, and
 * `monthsAreUpperBound` when the bonus is unresolved or a declared lower
 * bound), which is strictly more information than a state code could carry.
 * What changed is that the STATE now names the allocation basis, because that
 * is the axis a reader has to know about: the same category, priced against a
 * 3-pip slot rather than a 1-pip slot, moves by 3.6x.
 */
export const SUPERSEDED_DURATION_STATES = Object.freeze({
  'flat-rate': 'the category carried no bonus, so the flat rate was right for the CATEGORY term. It was '
    + 'still the whole faction\'s income rather than the slot\'s share, so it was wrong for the '
    + 'ALLOCATION term -- by 2.15x to 3.42x on the observer\'s three 1-and-3-pip slots.',
  'flat-rate-boosted': 'the category carried a measured bonus which was named beside the figure and not '
    + 'applied. Now applied, inside the allocation multiplier.',
  'unresolved-category': 'the category could not be resolved, so whether a bonus applied was undecidable. '
    + 'Now priced with the bonus at its floor of zero, which makes the months an explicit UPPER bound '
    + '(`monthsAreUpperBound: true`) rather than an unlabelled point estimate.',
  'category-unchecked': 'the bonus catalogue was absent from the snapshot. Same treatment as above.'
});

/**
 * What each duration state means, stated ONCE per response rather than on
 * every row.
 *
 * A row carries only its state code plus its own numbers. Repeating these
 * sentences per row measured +41 KB on the military-value fixture, which is the
 * duplication `tests/militaryValue.test.js`'s payload ceiling exists to catch --
 * and it is the same "each stated ONCE" pattern the delivery formulae and axis
 * descriptors already follow.
 */
export const CATEGORY_DURATION_BASES = Object.freeze({
  [CATEGORY_DURATION_STATES.allocationMeasured]: 'priced through the allocation this item\'s own research '
    + 'slot receives, with the pip weight read from the save: remaining cost divided by '
    + '`income x (1 + 5% per pipped slot) x pipShare x (1 + CategoryBonus + ProjectBonus)`. Every term is '
    + 'measured. The model reproduces the observer\'s four measured slot deliveries to a single common '
    + 'scale factor of 0.9858, so treat the figure as good to about 1.5%, not to the digit.',
  [CATEGORY_DURATION_STATES.allocationAssumed]: 'this item is not in a research slot, so its pip '
    + 'allocation is ASSUMED and the assumption drives the answer. `months` takes the `one-pip` scenario '
    + '(one of the observer\'s current pips, layout otherwise unchanged -- which is the rate a 1-pip slot '
    + 'is MEASURED to deliver on this save); `monthsFastest` takes `all-pips` (every pip on this item), '
    + 'which is the fastest the game can deliver it and therefore a real lower bound. Do not read either '
    + 'as a measurement.',
  [CATEGORY_DURATION_STATES.receivesNothing]: 'this item sits in a research slot carrying no pips, so it '
    + 'receives no research at all and has no time to complete. `months` is null: a large number would '
    + 'imply slow progress and zero would imply immediate, and neither is true of a slot receiving '
    + 'nothing.',
  [CATEGORY_DURATION_STATES.flatRateUnpriced]: 'the observer\'s slot allocation could not be read from '
    + 'this snapshot, so this is the UNPRICED flat figure: remaining cost divided by the whole faction\'s '
    + 'monthly research income. It is not an upper bound -- a project runs in one slot and receives only '
    + 'that slot\'s share, measured at 0.29x to 1.06x of this income, so at one pip of eight this figure '
    + 'was 3.42x optimistic. The row\'s own reason says which term was missing.',
  [CATEGORY_DURATION_STATES.unmeasuredIncome]: 'no measured research income, so there is no honest '
    + 'number of months at any rate. "0 months" would read as immediate.'
});

/**
 * Months of research for one item, priced through the allocation it would
 * actually receive.
 *
 * REWRITTEN 2026-08-22. It used to return the FLAT figure -- remaining cost
 * divided by the whole faction's monthly research income -- in every state, and
 * name the category bonus beside it without applying it. Both halves of that
 * were wrong, in opposite directions and by very different amounts:
 *
 *   THE ALLOCATION TERM, which was missing entirely. A project runs in ONE
 *   slot and receives only that slot's share. Measured on the observer, the
 *   per-slot factor ran 0.4658x, 0.2928x, 1.0602x and 0.2928x of the flat
 *   income, so the flat figure was 2.15x to 3.42x too SHORT on three slots and
 *   1.06x too long on the fourth. That is now priced by
 *   `shared/researchAllocationPricing.mjs`, and the category bonus is inside
 *   its multiplier rather than named beside an unadjusted number.
 *
 *   THE COST, which was the template figure. The campaign's
 *   `researchSpeedMultiplier` acts on cost, so on a 200% campaign every
 *   remaining cost handed to this function was twice what the game charges.
 *   That is fixed upstream, in the snapshot -- see
 *   `shared/researchCostScaling.mjs` -- so `remainingCost` arrives effective.
 *
 * The engineer multiplier is still NOT applied and must not be: `monthlyIncome`
 * is measured from the save and already includes every flat bonus.
 *
 * `months` is null in exactly two cases, and they are different facts: the
 * income is unmeasured, or the item sits in a slot receiving no pips at all.
 *
 * @param {number|null} remainingCost   EFFECTIVE remaining cost, not template
 * @param {number|null} monthlyIncome   measured research income; engineers included
 * @param {Object|null} categoryRate    a row from `buildResearchCategoryBonuses().bonusFor(category)`
 * @param {Object|null} allocationRate  a row from
 *   `buildResearchAllocationPricing().rateFor(...)`. Absent falls back to the
 *   flat figure, LABELLED `flat-rate-unpriced` -- never silently.
 */
/**
 * The standard duration fields every row carries, so the four intel modules
 * emit one shape rather than four that drift.
 *
 * Deliberately flat and short: the SENTENCES explaining each state are stated
 * once per response in `research.categoryBonuses.durationStates`, never per
 * row. Repeating them per row measured +41 KB on the military-value fixture.
 *
 * @param {Object} duration from `priceResearchDuration`
 */
export function researchDurationFields(duration) {
  return {
    monthsAtCurrentIncome: duration?.months ?? null,
    // A state CODE. `research.categoryBonuses.durationStates` spells each one
    // out once per response.
    //
    // The scenario a headline figure assumed is NOT a separate field: the state
    // carries it. `allocation-assumed` always takes the `one-pip` scenario, and
    // `research.allocationPricing.scenarios` names both ends once per response.
    // A per-row copy of a constant is what the payload ceiling exists to catch.
    // Nor is the slot's own monthly rate a field: it is exactly
    // `remainingResearchCost / monthsAtCurrentIncome`, and the multiplier terms
    // are stated once on `research.allocationPricing`.
    monthsAtCurrentIncomeState: duration?.state ?? null,
    // The second end of the range, and NOT derivable from anything else on the
    // row: the fastest the game can deliver it, every pip on one slot. Null on
    // a measured slot, where there is one rate and no scenario.
    monthsFastestAllocation: duration?.monthsFastest ?? null,
    // True when a term had to be priced at its floor (an unresolved category
    // bonus, a category whose sum is a declared lower bound, or an unresolved
    // slot kind), so the months are at most this and possibly fewer. A
    // correctness flag, not decoration: without it an upper bound and a point
    // estimate render identically.
    monthsAreUpperBound: duration?.monthsAreUpperBound ?? null,
    // The EFFECTIVE category bonus after the wiki diminishing-returns rule, now
    // INSIDE the rate rather than named beside an unadjusted figure.
    categoryResearchBonus: duration?.categoryBonus ?? null,
    // The superseded whole-faction figure, kept so a reader can see what moved.
    // It is a budget number, not a completion time -- see `monthsAtIncome`.
    flatRateMonths: duration?.flatRateMonths ?? null
  };
}

/**
 * The one call every duration-printing surface makes.
 *
 * It exists so the four intel modules cannot drift: joining a category bonus to
 * an allocation rate is four lines that must be identical everywhere, and the
 * `isProject` decision in particular is the kind of thing one copy would get
 * subtly wrong. A tech-tree node's `type` decides it, and an UNRESOLVED type
 * stays `null` rather than defaulting to "project" -- defaulting would apply a
 * +95% bonus to a global tech and halve its stated duration.
 *
 * @param {Object} args
 * @param {number|null} args.remainingCost  EFFECTIVE remaining cost
 * @param {number|null} args.monthlyIncome
 * @param {Object|null} args.categoryBonuses    from `buildResearchCategoryBonuses`
 * @param {Object|null} args.allocationPricing  from `buildResearchAllocationPricing`
 * @param {string|null} args.itemId  the project or global-tech id, to find its slot
 * @param {string|null} args.category
 * @param {string|null} args.type    'faction_project' | 'global_tech' | null
 */
export function priceResearchDuration({
  remainingCost = null, monthlyIncome = null, categoryBonuses = null,
  allocationPricing = null, itemId = null, category = null, type = null
} = {}) {
  const bonus = typeof categoryBonuses?.bonusFor === 'function'
    ? categoryBonuses.bonusFor(category ?? null)
    : null;
  const isProject = type === 'faction_project' ? true : (type === 'global_tech' ? false : null);
  const rate = typeof allocationPricing?.rateFor === 'function'
    ? allocationPricing.rateFor({
      itemId,
      category: category ?? null,
      isProject,
      categoryBonus: bonus?.effectiveBonus ?? null,
      categoryBonusIsLowerBound: bonus?.isLowerBound ?? null
    })
    : null;
  return monthsAtIncomeForCategory(remainingCost, monthlyIncome, bonus, rate);
}

export function monthsAtIncomeForCategory(remainingCost, monthlyIncome, categoryRate, allocationRate = null) {
  const flat = flatMonths(remainingCost, monthlyIncome);
  const category = categoryRate?.category ?? null;
  const bonusState = categoryRate?.state ?? CATEGORY_BONUS_STATES.unresolved;
  // The EFFECTIVE bonus after the wiki diminishing-returns rule, not the raw
  // sum. A category measured at zero is a real measurement of zero; every other
  // unresolved state is null, and null is NOT zero.
  const effectiveBonus = bonusState === CATEGORY_BONUS_STATES.measuredZero
    ? 0
    : (bonusState === CATEGORY_BONUS_STATES.boosted ? (categoryRate.effectiveBonus ?? null) : null);

  const shared = {
    category,
    categoryBonus: effectiveBonus,
    categoryBonusSummed: categoryRate?.summedBonus ?? null,
    categoryBonusState: bonusState,
    // The old whole-faction figure, kept so a reader can see what moved and by
    // how much rather than having to trust that something did.
    flatRateMonths: flat,
    categoryRateModel: CATEGORY_RATE_MODEL
  };

  if (flat === null) {
    return {
      ...shared,
      months: null,
      monthsFastest: null,
      monthsAreUpperBound: null,
      allocationState: allocationRate?.state ?? null,
      allocationScenario: null,
      monthlyRate: null,
      state: CATEGORY_DURATION_STATES.unmeasuredIncome,
      flatRateMonths: null,
      basis: 'no measured research income, so there is no honest number of months at any rate'
    };
  }

  const cost = toFinite(remainingCost);
  const rate = toFinite(allocationRate?.monthlyRate);
  const allocationState = allocationRate?.state ?? null;

  // The allocation could not be formed. Return the flat figure UNCHANGED and
  // say so -- withdrawing it would blank every snapshot published before the
  // pricing existed, and calling it priced would be a lie.
  if (allocationState === null || allocationState === 'allocation-unavailable' || rate === null) {
    return {
      ...shared,
      months: flat,
      monthsFastest: null,
      monthsAreUpperBound: null,
      allocationState,
      allocationScenario: null,
      monthlyRate: null,
      state: CATEGORY_DURATION_STATES.flatRateUnpriced,
      basis: 'this is the UNPRICED flat figure -- remaining cost divided by the whole faction\'s monthly '
        + 'research income -- because the observer\'s slot allocation could not be read: '
        + (allocationRate?.reason || 'no allocation model was supplied for this row')
        + '. It is not an upper bound: a project receives only its own slot\'s share, measured at 0.29x '
        + 'to 1.06x of this income.'
    };
  }

  // A slot carrying no pips receives nothing. Neither a large number nor zero
  // is true of it, so there is no number.
  if (allocationState === 'slot-receives-nothing') {
    return {
      ...shared,
      months: null,
      monthsFastest: null,
      monthsAreUpperBound: false,
      allocationState,
      allocationScenario: null,
      monthlyRate: 0,
      state: CATEGORY_DURATION_STATES.receivesNothing,
      basis: allocationRate.reason || 'this item sits in a research slot carrying no pips, so it receives '
        + 'no research at all and has no time to complete'
    };
  }

  const months = (cost === null || !(rate > 0)) ? null : round(cost / rate, 1);
  const fastestRate = toFinite(allocationRate?.scenarios?.[ALLOCATION_SCENARIOS.allPips]?.monthlyRate);
  const monthsFastest = (cost === null || fastestRate === null || !(fastestRate > 0))
    ? null
    : round(cost / fastestRate, 1);

  return {
    ...shared,
    months,
    // Only an assumed allocation has a second end; a measured slot has one rate.
    monthsFastest: allocationState === 'assumed-allocation' ? monthsFastest : null,
    monthsAreUpperBound: allocationRate.monthsAreUpperBound ?? null,
    allocationState,
    allocationScenario: allocationRate.scenario ?? null,
    monthlyRate: allocationRate.monthlyRate,
    state: allocationState === 'measured-slot-allocation'
      ? CATEGORY_DURATION_STATES.allocationMeasured
      : CATEGORY_DURATION_STATES.allocationAssumed,
    basis: allocationRate.basis
  };
}
