/**
 * Research advisor, phase 5: slot allocation.
 * Purpose: research-advisor phase-5 allocation of research to slots.
 *
 * Spec: docs/research-advisor-spec.md sections 0, 1 and 6.
 *
 * WHAT THIS MODULE DOES AND DELIBERATELY DOES NOT DO
 *
 * It reports the observer's CURRENT research slot layout -- which slot holds
 * what, how many pips each carries, and which slots are receiving nothing --
 * every field of which is read from the save.
 *
 * It does NOT recommend a reallocation. Section 6 of the spec was written
 * around the wiki's allocation formula (`Technology`, rev 2026-05-06):
 *
 *   per slot X:  base
 *                x (100% + 5% per slot with pips assigned)
 *                x pips_X / total pips
 *                x (100% + CategoryBonus x 0.9^(same-category slots with pips - 1) + ProjectBonus)
 *
 * That formula was the ONE input to this feature not pinned to shipped data,
 * and it was tested before anything was built on it. The FIRST pass could not
 * make it reproduce; the SECOND pass (2026-08-21, `docs/research-category-rate-
 * spec.md`) did, to within 0.15% on all four pip-carrying slots with ZERO free
 * parameters, once `ProjectBonus` was READ from `cachedYearlyRevenue.Projects`
 * and the 24 alien-activity investigations were folded into the Xenology bonus.
 * See `ALLOCATION_MODEL.reproduction`; the first pass's reasoning is kept
 * beside it under `supersededFirstPass`.
 *
 * The recommendation is STILL refused, but no longer for that reason. The
 * forward model reproduces; what is missing is the two terms this campaign's
 * data cannot exercise (the 0.9^(n-1) same-category decay and the diminishing-
 * returns curve) and a value model over what each slot is researching. See
 * `ALLOCATION_MODEL.recommendationRefused`.
 *
 * WHAT IS PINNED, and it is the useful half:
 *
 *   - The SLOT INDEX MAPPING. `researchWeights[i]` is the pip weight for slot
 *     index `i`; a global tech slot's index is its position in the save's
 *     `techProgress`, and a project's index is its own `slot` field. Verified
 *     by six independent slot-level agreements between "carries pips" and
 *     "received research" across two consecutive 15.5-day intervals -- see
 *     `SLOT_INDEX_PIN`.
 *   - That a project parked in a slot beyond the weight array receives
 *     NOTHING. Measured: the observer's Operations Research sat at 22.82
 *     accumulated across both intervals without moving.
 *
 * Nothing here is campaign-specific (section 0). The number of global tech
 * slots is read from the snapshot rather than assumed to be three, the category
 * of each slot comes from the data, and a turn-1 observer with no pips assigned
 * anywhere reports exactly that rather than an empty section.
 *
 * DO NOT APPLY `researchSpeedMultiplier` TO THE RESEARCH INCOME. It IS applied
 * to the research COST, once, in `shared/researchCostScaling.mjs` at snapshot
 * build time -- so every cost this module sees has already been through it and
 * must not be scaled again. Applying it to income as well would be a 4x error.
 *
 * THE 2026-08-21 VERDICT BELOW WAS HALF WRONG AND IS CORRECTED HERE.
 *
 *   - "It acts on OUTPUT, not on cost" is WRONG, overturned by measurement on
 *     2026-08-22. It acts on COST: the observer's own 10,000-point Gas Core
 *     Fission Reactor VI completed from 4,708.568 accumulated inside 15.5 days
 *     at a measured 30.2467 points/day, which reaches 5,000 and cannot reach
 *     10,000; 278 in-progress rows across five 200% saves never exceed 50% of
 *     template cost while saves with no multiplier reach 97.6%. The evidence
 *     it was based on (Fleet Logistics at 44,780/45,000, still in progress)
 *     came from First.gz, which carries no custom-difficulty block at all --
 *     it showed that a campaign WITHOUT a multiplier charges template cost.
 *   - Income is already post-multiplier. `monthsAtCurrentIncome` derives from
 *     `cachedYearlyRevenue.Research`. RE-ESTABLISHED 2026-08-22 on a better
 *     measurement than the 1.147x/0.993x pair originally cited, which came from
 *     the first pass's own non-reproducing model and could not answer this (see
 *     `ALLOCATION_MODEL.reproduction.whyTheAbsoluteSwingCannotAnswerThe200Percent`).
 *     The observer's slots delivered 2.1115x `cachedYearlyRevenue.Research`
 *     over interval 1, and 2.1420x is exactly what the allocation terms predict
 *     from values all read out of the save -- (1 + 5% x 4 pipped slots) x the
 *     pip-weighted (1 + CategoryBonus + ProjectBonus). A `cachedYearlyRevenue`
 *     that still needed the 200% applied would have delivered 4.2840x. There is
 *     no spare factor of 2 anywhere in the residual, which is a uniform 1.4%.
 *
 * The player's report that techs finish twice as fast is accurate and comes
 * from doubled output, which the save's own revenue figure already carries.
 * Multiplying here would introduce a 2x error into a correct figure.
 *
 * THE WHOLE-FACTION 2.1115x IS STILL NOT A DURATION CORRECTION, and that has
 * not changed. It is the whole faction's throughput summed over four slots; one
 * project sits in ONE slot and receives only its own share -- measured 0.4658x,
 * 0.2928x, 1.0602x and 0.2928x of the nominal income, which sum to it.
 * Dividing a duration by 2.11 would make three of those four MORE wrong.
 *
 * What DID change on 2026-08-22 is that the per-slot factor is now COMPUTED and
 * applied, in `shared/researchAllocationPricing.mjs`. It is not a scalar, but
 * every term of it is read from the save when the item is in a slot; when it is
 * not, two labelled scenarios are published instead of one confident number.
 * The layout below is still measured and this module still recommends no
 * reallocation -- see `ALLOCATION_MODEL.recommendationRefused`, whose three
 * reasons are unaffected: pricing a duration at a STATED allocation is not the
 * same act as recommending a different one.
 */

import { asArray, round, sameId, toFiniteNumber } from './util.mjs';

/** What occupies a slot. `empty` is a real state: a weighted slot with nothing in it. */
export const SLOT_KINDS = Object.freeze({
  globalTech: 'global-tech',
  project: 'project',
  empty: 'empty'
});

export const SLOT_KIND_LABELS = Object.freeze({
  'global-tech': 'Global tech',
  project: 'Project',
  empty: 'Empty'
});

/**
 * The measurement that licenses reading `researchWeights` as a per-slot array.
 *
 * Established across six saves spanning 2029-09-10 to 2034-02-16 with zero
 * violations:
 *   G = globalResearch.activeSlots.length (global tech slots, 0 .. G-1)
 *   project slots = G .. len-1 (projectSlotCapacity = len - G)
 *   slot >= len is BACKLOG, outside the weights array entirely
 */
export const SLOT_INDEX_PIN = Object.freeze({
  claim: 'researchWeights[0..G-1] addresses global tech slots; researchWeights[G..len-1] addresses project '
    + 'slots, so projectSlotCapacity is exactly len - G. currentProjects[].slot >= len is backlog, outside the array.',
  method: 'verified across six saves from 2029-09-10 to 2034-02-16 (G=3, len=6, projectSlotCapacity=3). Every in-array '
    + 'project slot index falls in [G, len) and every backlog entry sits at or beyond len (observed 6, 7, 8).',
  agreements: Object.freeze([
    'slot 0 (global tech, 0 pips): no research delivered',
    'slot 1 (global tech, 0 pips): no research delivered',
    'slot 2 (global tech Coilguns, 3 pips): research delivered in both intervals',
    'slot 3 (project, 3 pips): research delivered in both intervals',
    'slot 4 (project, 3 pips): research delivered in the interval it was occupied',
    'slot 5 (project, 0 pips): no research delivered (parked in backlog)',
    'slot 7 (project, beyond the 6-entry weight array): parked in backlog with progress intact'
  ]),
  weightArrayLength: 6,
  weightArrayLengthBasis: 'length 6 on all 8 factions in every save checked, from 3/16/2023 to '
    + '2/16/2034. The array length is read from the save rather than assumed, and a save that carries a '
    + 'different length is reported at that length.',
  validatedAgainstGameOutput: true
});

/**
 * The wiki allocation formula, and the measurement that now pins it.
 *
 * REVISED 2026-08-22 (tracker 3b). The first pass concluded this formula did
 * not reproduce and the block below said so. The SECOND pass reproduced it to
 * within 0.15% on all four of the observer's pip-carrying slots with ZERO free
 * parameters. Two terms the first pass could not source turned out to be
 * readable after all:
 *
 *   ProjectBonus  = min(100%, (`cachedYearlyRevenue.Projects` - the points spent
 *                   on `orgProjectSlotUnlocked` and `habProjectSlotUnlocked`)
 *                   x 5%). On the measured save: min(100%, (21 - 2) x 5%) = 95%.
 *   CategoryBonus = the `techBonuses` sweep PLUS `alienInvestigations` x 1% for
 *                   Xenology, which no template carries. 0.20 + 0.24 = 0.44.
 *
 * The first pass's reasoning is kept under `reproduction.supersededFirstPass`
 * rather than deleted, because the way it went wrong is the instructive part --
 * it searched for a one-parameter CATEGORY model to explain a residual that
 * lived in a missing PROJECT term, and its own notes recorded the number that
 * would have led it there.
 *
 * TWO CONSTANTS STILL HAVE NO SHIPPED SOURCE (the +5%-per-pipped-slot and the
 * 0.9^(n-1) same-category decay are absent from `TIGlobalConfig.json`, which
 * carries only `globalResearchMultiplier: 1`), so the formula remains a wiki
 * claim CORROBORATED by measurement, not a reading of the game's own data. The
 * +5% constant is now strongly corroborated -- it is the only free scale left
 * and it lands 1.4% high; the 0.9 decay never engaged and is not.
 */
export const ALLOCATION_MODEL = Object.freeze({
  source: 'Terra Invicta wiki, `Technology`, rev 2026-05-06',
  formula: 'per slot X: base x (100% + 5% per slot with pips) x pips_X / total pips '
    + 'x (100% + CategoryBonus x 0.9^(same-category slots with pips - 1) + ProjectBonus)',
  validatedAgainstGameOutput: true,
  reproducesObservedDelivery: true,
  termsWithNoShippedSource: Object.freeze([
    'the +5%-per-active-slot constant (absent from TIGlobalConfig.json; corroborated to 1.4% as the only '
      + 'free scale left once every other term is read from the save)',
    'the 0.9^(n-1) same-category decay constant (absent from TIGlobalConfig.json, and it never engaged in '
      + 'the measured interval because every category held exactly one pipped slot)'
  ]),
  reproduction: Object.freeze({
    method: 'per-slot delivered research for observer 4712 differenced across two consecutive 15.5-day '
      + 'intervals with the pip layout [0,0,3,1,3,1] unchanged throughout, against a prediction whose '
      + 'every term is read from the save (base `cachedYearlyRevenue.Research` 37,735.23/yr, ProjectBonus '
      + 'from `cachedYearlyRevenue.Projects`, CategoryBonus from templates plus `alienInvestigations`).',
    // THE LEAD SIGNAL: a ratio that contains no Xenology and no total income,
    // so it fixes ProjectBonus on its own and cannot be a fit.
    whatDidReproduce: 'the per-pip ratio of a MilitaryScience PROJECT slot to a LifeScience GLOBAL TECH '
      + 'slot is 468.82 / 248.6167 = 1.885714 observed against (1 + 0.03 + 0.95) / (1 + 0.05) = 1.885714 '
      + 'predicted -- agreement to six significant figures, 0.000% error. It contains no Xenology term '
      + 'and cancels total income entirely, so it fixes ProjectBonus alone, and it agrees with the 0.95 '
      + 'read straight out of `cachedYearlyRevenue.Projects`. That is what makes this a test and not a fit.',
    perSlotShares: Object.freeze([
      'slot 2 global tech LifeScience 3 pips: predicted share 0.220588, observed 0.220349, +0.109%',
      'slot 3 project MilitaryScience 1 pip: predicted share 0.138655, observed 0.138716, -0.044%',
      'slot 4 project Xenology 3 pips: predicted share 0.502101, observed 0.502218, -0.023%',
      'slot 5 project Energy 1 pip: predicted share 0.138655, observed 0.138716, -0.044%'
    ]),
    absoluteScale: 'observed / predicted is 0.98461, 0.98612, 0.98591, 0.98612 -- ONE common factor 1.4% '
      + 'low, not a structural mis-fit. Consistent with income drift inside the interval or a slightly '
      + 'different elapsed-day convention. It is uniform, so it cancels out of every ratio above.',
    // Answers, and closes, the question campaign-settings-spec.md used the
    // first pass's absolute swing to answer.
    whyTheAbsoluteSwingCannotAnswerThe200Percent: 'a delivered/predicted ratio near 1.0 says only that '
      + 'the model\'s multipliers explain the delivery. It cannot tell you WHICH multiplier a given '
      + 'constant factor lives in unless every multiplier in the model is independently known -- and the '
      + 'first pass\'s prediction carried a FITTED ProjectBonus of -0.209, so a compensating factor of ~2 '
      + 'was free to hide inside it. The question is answered instead by the ABSOLUTE gain over the '
      + 'nominal income with every term read rather than fitted: the observer\'s slots delivered 2.1115x '
      + '`cachedYearlyRevenue.Research` against 2.1420x predicted from the allocation terms alone. A '
      + 'pre-200% income would have required 4.2840x. `cachedYearlyRevenue.Research` is already '
      + 'post-`researchSpeedMultiplier`.',
    bottomLine: 'the formula reproduces every measured slot with no fitted parameter. What it does NOT '
      + 'license is a duration correction: see `notADurationCorrection`.',
    // The thing tracker 3b was opened to do, and the reason it must not be done.
    notADurationCorrection: 'the 2.1115x gain is the WHOLE FACTION\'s throughput summed over four slots. '
      + 'A duration is about ONE slot, which receives only pipShare x (1 + 5% per pipped slot) x '
      + '(1 + CategoryBonus + ProjectBonus) -- measured at 0.4658x, 0.2928x, 1.0602x and 0.2928x of the '
      + 'nominal income, and those four are what sum to 2.1115x. Three of the four are BELOW 1, so the '
      + 'flat duration is too SHORT for them, not too long; dividing every duration by 2.11 would make '
      + 'the 1-pip slots 7.2x optimistic instead of 3.4x.',
    untested: Object.freeze([
      'the 0.9^(n-1) same-category decay: every category held exactly one pipped slot in interval 1, so '
        + 'the exponent was 0 everywhere and the term never engaged. Interval 2 corroborates it weakly.',
      'the 100% ProjectBonus cap: the observer sits at 95%, below it.'
    ]),
    measuredOn: 'Autosave3.gz 61cc7c1103742fe47d2984d384a3147a (12/1/2034), Autosave2.gz '
      + '5294cddfb5906d27bfd59bce9f29ccda (12/16/2034 12:00), Autosave.gz '
      + '2ef9643051e675026850b23b380f93f3 and ExitSave.gz 5c0d9ef98213c91d8187ae11bf885d57 (1/1/2035); '
      + 'observer 4712; frozen to disk and MD5-verified before use, 2026-08-21 and re-verified 2026-08-22',
    // ---- KEPT, NOT DELETED. The first pass's reasoning, marked superseded.
    supersededFirstPass: Object.freeze({
      status: 'SUPERSEDED 2026-08-22. Kept because the failure mode is the instructive part. Every '
        + 'delivered figure it measured reproduces to the integer; only its MODEL was wrong.',
      claimedMethod: 'predicted per-slot delivery from cachedYearlyRevenue.Research with a pip layout '
        + 'recorded as [0,0,3,3,3,0] over 12/1-12/16/2033 and 12/16/2033-1/1/2034.',
      recordKeepingDefect: 'that record does not match the saves it names. All four frozen saves carry '
        + '`researchWeights` [0,0,3,1,3,1], not [0,0,3,3,3,0], and are dated 12/1/2034 to 1/1/2035, not '
        + '2033. The 1.147x / 0.993x pair is therefore not reproducible as stated, which is the second '
        + 'reason it cannot carry the weight campaign-settings-spec.md put on it.',
      findings: Object.freeze([
        'claimed UNCONFOUNDED: no single (base, ProjectBonus) pair fits all three pip-carrying slots. '
          + 'WRONG -- (base = cachedYearlyRevenue.Research, ProjectBonus = 0.95) fits all four to 0.15%. '
          + 'The pair could not be found because the Xenology CategoryBonus was 0.20 instead of 0.44.',
        'claimed CONFOUNDED by income drift: the same slot delivered 1.147x the prediction over one '
          + 'interval and 0.993x over the next. The observer\'s `cachedYearlyRevenue.Research` is '
          + 'IDENTICAL (37,735.23) at both ends of both intervals, so income drift is not evidenced; the '
          + 'swing came from the prediction, not the income.',
        'claimed CONFOUNDED by the reconstructed Xenology bonus: ProjectBonus solved to -0.209, a project '
          + 'PENALTY. Correct as arithmetic and correctly flagged as suspicious. At the true Xenology '
          + '0.44 it solves to +0.95, which is exactly what the save states.'
      ]),
      whatItAlmostSaw: 'it recorded that "for ProjectBonus = 0 to produce the same ratio the Xenology '
        + 'bonus need only be 0.2435" and that its reconstruction was unvalidated. That note was pointing '
        + 'straight at the 24 alien-activity investigations it had not counted.',
      lesson: '`grep techBonuses` finds every bonus source that is data-driven IN THAT SHAPE, not every '
        + 'bonus source. Two of five were neither.'
    })
  }),
  recommendationRefused: 'no reallocation is recommended, and the reason CHANGED on 2026-08-22. It is no '
    + 'longer that the formula fails to reproduce -- it reproduces every measured slot to within 0.15% '
    + 'with zero fitted parameters (see `model.reproduction`). What is missing is different and still '
    + 'disqualifying: (1) the 0.9^(n-1) same-category decay never engaged in the measured data, so a '
    + 'recommendation that moves two pips into one category would be extrapolating past the evidence; '
    + '(2) the +5%-per-pipped-slot constant has no shipped source and is the only free scale left, so a '
    + 'recommendation that CHANGES the number of pipped slots leans on the one term still unsourced; and '
    + '(3) a forward delivery model is not a value model -- knowing a slot would receive 12% more says '
    + 'nothing about whether what it is researching is worth more. The current layout below is measured; '
    + 'the optimum is not offered rather than being offered wrongly.'
});

/**
 * One slot row.
 *
 * `pipShare` is the fraction of the observer's pips this slot holds. It is a
 * measured quantity and it is NOT the fraction of research the slot receives.
 */
function slotRow({ index, pips, totalPips, occupant }) {
  const pipCount = toFiniteNumber(pips);
  const total = toFiniteNumber(totalPips);
  return {
    index,
    pips: pipCount,
    // Absent stays absent: a slot whose weight the save does not carry has an
    // unknown pip count, which is not zero pips.
    carriesPips: pipCount === null ? null : pipCount > 0,
    pipShare: (pipCount === null || total === null || total <= 0) ? null : round(pipCount / total, 6),
    pipShareBasis: 'this slot\'s pips divided by the observer\'s total assigned pips. Measured from the '
      + 'save. It is NOT the share of research the slot receives.',
    kind: occupant?.kind ?? SLOT_KINDS.empty,
    kindLabel: SLOT_KIND_LABELS[occupant?.kind ?? SLOT_KINDS.empty],
    occupantId: occupant?.id ?? null,
    displayName: occupant?.displayName ?? null,
    category: occupant?.category ?? null,
    accumulatedResearch: toFiniteNumber(occupant?.accumulatedResearch),
    totalCost: toFiniteNumber(occupant?.totalCost),
    percent: toFiniteNumber(occupant?.percent),
    // Zero pips is deliberate concentration, not a fault. Never label as stalled.
    idleReason: occupant && (pipCount !== null && pipCount === 0)
      ? 'parked in backlog with progress intact'
      : (!occupant && pipCount !== null && pipCount > 0
        ? 'carries pips but holds nothing, so those pips are doing nothing'
        : null)
  };
}

/**
 * The observer's slot layout, measured.
 *
 * @param {Object} snapshot           filtered or raw snapshot
 * @param {Object} options
 * @param {number|string} options.observerId
 * @returns {Object} always an object; `available: false` with a reason when the
 *   snapshot does not carry the weights.
 */
export function buildResearchSlotAllocation(snapshot, { observerId } = {}) {
  const factions = asArray(snapshot?.factions);
  const observer = factions.find(faction => sameId(faction?.ID, observerId)) || null;

  const globalTechSlots = asArray(snapshot?.globalResearch?.activeSlots);
  const G = globalTechSlots.length;

  const unavailable = (reason) => ({
    available: false,
    reason,
    slots: [],
    slotCount: null,
    totalPips: null,
    slotsWithPips: null,
    globalTechSlotCapacity: G,
    projectSlotCapacity: null,
    occupiedProjectSlots: null,
    activeProjectSlots: null,
    freeProjectSlots: null,
    currentProjects: [],
    activeProjects: [],
    backloggedProjects: [],
    alreadyResearching: [],
    unweightedOccupants: [],
    monthlyResearchIncome: toFiniteNumber(observer?.totalResearch),
    slotIndexPin: SLOT_INDEX_PIN,
    model: ALLOCATION_MODEL,
    recommendation: { offered: false, reason: ALLOCATION_MODEL.recommendationRefused }
  });

  if (!observer) {
    return unavailable('the requested observer is not present in this snapshot, so no slot layout could '
      + 'be read.');
  }

  const weights = observer.researchWeights;
  if (!Array.isArray(weights)) {
    return unavailable('this snapshot carries no research slot weights for the observer. They are '
      + 'published from the save\'s own `researchWeights`; re-publish the save to restore them.');
  }

  const len = weights.length;
  const projectSlotCapacity = Math.max(0, len - G);

  // --- occupants, keyed by the slot index each one states -------------------
  const occupants = new Map();
  const collisions = [];
  const place = (index, occupant) => {
    if (index === null) return;
    if (occupants.has(index)) {
      // Two things claiming one slot means the index mapping does not hold on
      // this save. Reported, never silently resolved by picking one.
      collisions.push({
        index,
        held: occupants.get(index).displayName,
        incoming: occupant.displayName
      });
      return;
    }
    occupants.set(index, occupant);
  };

  globalTechSlots.forEach((slot, position) => {
    const contribution = asArray(slot?.contributions)
      .find(entry => sameId(entry?.factionId, observerId)) || null;
    place(position, {
      kind: SLOT_KINDS.globalTech,
      id: slot?.techId ?? null,
      displayName: slot?.displayName ?? slot?.techId ?? null,
      category: slot?.category ?? null,
      accumulatedResearch: toFiniteNumber(contribution?.contribution),
      totalCost: toFiniteNumber(slot?.totalCost),
      percent: null
    });
  });

  const rawProjects = asArray(observer.currentProjects);
  for (const project of rawProjects) {
    const slotIdx = toFiniteNumber(project?.slot);
    place(slotIdx, {
      kind: SLOT_KINDS.project,
      id: project?.projectId ?? null,
      displayName: project?.displayName ?? project?.projectId ?? null,
      category: project?.category ?? null,
      accumulatedResearch: toFiniteNumber(project?.accumulatedResearch),
      totalCost: toFiniteNumber(project?.totalCost),
      percent: toFiniteNumber(project?.percent)
    });
  }

  const totalPips = weights.reduce((sum, value) => {
    const pips = toFiniteNumber(value);
    return pips === null ? sum : sum + pips;
  }, 0);

  const slots = weights.map((value, index) => slotRow({
    index,
    pips: value,
    totalPips,
    occupant: occupants.get(index) || null
  }));

  // Occupants at or beyond weights.length are BACKLOG, explicitly.
  const unweightedOccupants = [...occupants.entries()]
    .filter(([index]) => index >= len)
    .sort((a, b) => a[0] - b[0])
    .map(([index, occupant]) => ({
      index,
      kind: occupant.kind,
      kindLabel: SLOT_KIND_LABELS[occupant.kind],
      occupantId: occupant.id,
      displayName: occupant.displayName,
      accumulatedResearch: occupant.accumulatedResearch,
      totalCost: occupant.totalCost,
      percent: occupant.percent,
      status: 'backlog',
      isBacklog: true
    }));

  // Map every project with explicit status and backlog flag
  const currentProjects = rawProjects.map(project => {
    const slotIdx = toFiniteNumber(project?.slot);
    const inArray = slotIdx !== null && slotIdx >= G && slotIdx < len;
    const pips = inArray ? toFiniteNumber(weights[slotIdx]) : 0;
    const isBacklog = (slotIdx !== null && slotIdx >= len) || (inArray && pips === 0);
    return {
      projectId: project?.projectId ?? null,
      displayName: project?.displayName ?? project?.projectId ?? null,
      slot: slotIdx,
      category: project?.category ?? null,
      accumulatedResearch: toFiniteNumber(project?.accumulatedResearch),
      totalCost: toFiniteNumber(project?.totalCost),
      percent: toFiniteNumber(project?.percent),
      pips: pips ?? 0,
      status: isBacklog ? 'backlog' : 'active',
      isBacklog
    };
  });

  const activeProjects = currentProjects.filter(p => p.status === 'active');
  const backloggedProjects = currentProjects.filter(p => p.isBacklog);

  // In-array project slots: G .. len-1
  let occupiedProjectSlots = 0;
  let activeProjectSlots = 0;
  for (let i = G; i < len; i++) {
    if (occupants.has(i)) {
      occupiedProjectSlots++;
      const p = toFiniteNumber(weights[i]);
      if (p !== null && p > 0) activeProjectSlots++;
    }
  }

  const freeProjectSlots = Math.max(0, projectSlotCapacity - occupiedProjectSlots);
  const slotsWithPips = slots.filter(slot => slot.carriesPips === true).length;

  const alreadyResearching = [
    ...activeProjects.map(p => p.projectId).filter(Boolean),
    ...globalTechSlots.map(t => t?.techId).filter(Boolean)
  ];

  return {
    available: true,
    reason: null,
    source: 'the save\'s own `researchWeights` for the observer, joined to the global tech slots and the '
      + 'observer\'s current projects by slot index',
    slotCount: len,
    globalTechSlotCapacity: G,
    projectSlotCapacity,
    slotCapacity: len,
    occupiedProjectSlots,
    activeProjectSlots,
    freeProjectSlots,
    totalPips,
    slotsWithPips,
    occupiedWithoutPips: slots.filter(slot => slot.idleReason && slot.occupantId).length,
    pipsWithoutOccupant: slots.filter(slot => slot.idleReason && !slot.occupantId).length,
    unweightedOccupantCount: unweightedOccupants.length,
    unweightedOccupantNote: unweightedOccupants.length === 0
      ? null
      : `these sit beyond the last weighted slot (slot >= ${len}) and are parked in the backlog with progress intact.`,
    backlogNote: 'Stopping a project moves it to the backlog with progress intact; backlogging costs time, not research points.',
    currentProjects,
    activeProjects,
    backloggedProjects,
    alreadyResearching,
    slots,
    unweightedOccupants,
    slotIndexCollisions: collisions,
    slotIndexCollisionNote: collisions.length === 0
      ? null
      : 'more than one occupant claims the same slot index on this save, so the index mapping does not '
        + 'hold here and the later occupant was dropped rather than overwriting the first.',
    monthlyResearchIncome: toFiniteNumber(observer.totalResearch),
    slotIndexPin: SLOT_INDEX_PIN,
    model: ALLOCATION_MODEL,
    recommendation: { offered: false, reason: ALLOCATION_MODEL.recommendationRefused }
  };
}
