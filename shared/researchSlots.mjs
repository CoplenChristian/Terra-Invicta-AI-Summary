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
 * That formula is the ONE input to this feature that is not pinned to shipped
 * data, and it was tested before anything was built on it. It does not
 * reproduce -- see `ALLOCATION_MODEL.reproduction` for the measurement. A
 * confident reallocation recommendation computed from a formula that cannot
 * reproduce the observer's own research delivery is exactly the claim this
 * repo's standards forbid, so the recommendation is refused and the refusal
 * carries its reason and its numbers.
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
 * The wiki allocation formula, and the measurement that says not to build on it.
 *
 * Two of its four terms have no source in the shipped data at all: the
 * +5%-per-active-slot and 0.9^(n-1) constants are absent from
 * `TIGlobalConfig.json` (which carries only `globalResearchMultiplier: 1`), and
 * no template or save field states a ProjectBonus. CategoryBonus can be
 * reconstructed from `techBonuses` on orgs, hab modules and councilor traits,
 * but that reconstruction is itself unvalidated.
 */
export const ALLOCATION_MODEL = Object.freeze({
  source: 'Terra Invicta wiki, `Technology`, rev 2026-05-06',
  formula: 'per slot X: base x (100% + 5% per slot with pips) x pips_X / total pips '
    + 'x (100% + CategoryBonus x 0.9^(same-category slots with pips - 1) + ProjectBonus)',
  validatedAgainstGameOutput: false,
  reproducesObservedDelivery: false,
  termsWithNoShippedSource: Object.freeze([
    'the +5%-per-active-slot constant (absent from TIGlobalConfig.json)',
    'the 0.9^(n-1) same-category decay constant (absent from TIGlobalConfig.json)',
    'ProjectBonus (no template or save field states it)'
  ]),
  reproduction: Object.freeze({
    method: 'predicted per-slot delivery for observer 4712 from cachedYearlyRevenue.Research with an '
      + 'unchanged pip layout of [0,0,3,3,3,0], and compared against the research actually delivered to '
      + 'each slot over two consecutive 15.5-day intervals.',
    findings: Object.freeze([
      'the SAME slot with the SAME pips delivered 1.147x the prediction over 12/1-12/16/2033 and 0.993x '
        + 'over 12/16/2033-1/1/2034. A per-slot multiplier the formula treats as constant is not constant.',
      'the two project slots delivered a fixed 1.2073 ratio to each other. With their reconstructed '
        + 'category bonuses (Xenology 0.20, Energy 0.03) the formula can only produce that ratio with '
        + 'ProjectBonus = -0.209 -- a project PENALTY, contradicting the term\'s own definition.',
      'no single (base, ProjectBonus) pair fits all three pip-carrying slots at once.'
    ]),
    whatDidReproduce: 'the RELATIVE share between two slots is stable: the project slot delivered '
      + '2.26216x the tech slot in the first interval and 2.26214x in the second, one part in 10^4 apart. '
      + 'The allocation has a stable structure; this formula is not it.',
    measuredOn: 'ExitSave/Autosave/Autosave2/Autosave3, observer 4712, 2026-08-21'
  }),
  recommendationRefused: 'no reallocation is recommended. The allocation formula does not reproduce the '
    + 'observer\'s own measured research delivery, and a reallocation computed from it would be a '
    + 'confident number resting on an unverified model. The current layout below is measured; the '
    + 'optimum is not offered rather than being offered wrongly.'
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
