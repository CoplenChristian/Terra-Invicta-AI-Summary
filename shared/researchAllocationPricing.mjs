// shared/researchAllocationPricing.mjs
//
// Purpose: price a research duration through the slot allocation the item would
//   actually receive, rather than against the whole faction's research income.
//
// ---------------------------------------------------------------------------
// THE DEFECT THIS FIXES
// ---------------------------------------------------------------------------
//
// `monthsAtIncome` divides a remaining cost by the WHOLE FACTION's monthly
// research income. A project does not run on the whole faction's income; it
// runs in ONE slot and receives only that slot's share of it. Measured on the
// observer over 12/1/2034 -> 12/16/2034 12:00, per-slot delivery as a factor of
// that nominal income:
//
//   slot 2  global tech  LifeScience       3 pips   0.4658x   flat figure 2.15x too SHORT
//   slot 3  project      MilitaryScience   1 pip    0.2928x   flat figure 3.42x too SHORT
//   slot 4  project      Xenology          3 pips   1.0602x   flat figure 1.06x too long
//   slot 5  project      Energy            1 pip    0.2928x   flat figure 3.42x too SHORT
//
// The error is per-slot and runs in BOTH directions, which is why no single
// scalar corrects it -- and why the four factors summing to the whole-faction
// 2.1115x is a trap rather than a correction. Dividing every duration by 2.11
// would take the 1-pip slots from 3.4x optimistic to 7.2x.
//
// ---------------------------------------------------------------------------
// TWO CASES, AND THEY MUST NOT BE COLLAPSED
// ---------------------------------------------------------------------------
//
//   ALREADY IN A SLOT. The pip count is read from the save, so every term of
//   the rate is measured. `measured-slot-allocation`.
//
//   NOT YET STARTED. There is no pip count to read, so one has to be ASSUMED,
//   and the assumption drives the answer by a factor of eight on this campaign.
//   A single confident number here would be a counterfactual presented as a
//   measurement, so TWO LABELLED SCENARIOS are reported:
//
//     `one-pip`   this item holds ONE pip with the observer's current layout
//                 otherwise unchanged. On this save that is exactly the rate
//                 slots 3 and 5 are MEASURED to deliver, so the conservative
//                 end is anchored to an observation rather than to a guess.
//     `all-pips`  every pip on this slot alone: 1.05 x (1 + Category + Project)
//                 times income. The fastest the game can deliver it, so a real
//                 LOWER bound on months. Category-dependent, never scalar --
//                 1.1025x for a LifeScience global tech against 2.5095x for a
//                 Xenology project on this save, a spread of 2.28x.
//
//   The headline `months` for an unstarted item is the `one-pip` figure and
//   every payload says which scenario it assumed. Reporting the optimistic end
//   as the answer is how the flat rate came to be 3.42x short to begin with.
//
// A slot holding ZERO pips receives nothing: months are `null` with a reason,
// never a large number and never zero. "Parked in the backlog with progress
// intact" has no time to complete at all.
//
// ---------------------------------------------------------------------------
// ACCURACY, STATED RATHER THAN IMPLIED
// ---------------------------------------------------------------------------
//
// Against the observer's four measured slot deliveries the model reproduces
// with ZERO free parameters to a single common scale factor -- observed over
// predicted 0.98582, 0.98586, 0.98577, 0.98586. That residual is uniform, so it
// is one scale term and not a structural mis-fit, and it is left in rather than
// divided out: a fitted correction of unknown origin is worse than a stated
// 1.5% band. Treat a priced duration as good to about 1.5%, not to the digit.
//
// Plain ESM, no Node built-ins, no imports outside `shared/`.

import { asArray, round, sameId, toFiniteNumber as toFinite } from './util.mjs';
import { ALLOCATION_MODEL, SLOT_KINDS, buildResearchSlotAllocation } from './researchSlots.mjs';

/**
 * ProjectBonus, read rather than fitted.
 *
 * The wiki (`Technology`, rev 2026-05-06): the first Projects point spent from
 * an org unlocks the second project slot, the first from a hab module unlocks
 * the third, and every remaining point adds 5% to what PROJECT slots receive,
 * capped at 100%.
 *
 * This is the term that turned the allocation model from a fit into a test. The
 * project-slot to global-tech-slot per-pip ratio is 1.885714 observed against
 * 1.885714 predicted from the 0.95 this rule produces, and that ratio cancels
 * total income and contains no category term at all.
 */
export const PROJECT_BONUS_RULE = Object.freeze({
  formula: 'ProjectBonus = min(100%, max(0, Projects - orgSlotSpent - habSlotSpent) x 5%)',
  source: 'Terra Invicta wiki, `Technology`, rev 2026-05-06, read as raw wikitext 2026-08-21',
  claimStatus: 'WIKI CLAIM, corroborated by measurement: at 21 Projects with both slot unlocks spent it '
    + 'yields 0.95, and a project pip then delivers 1.885714x a global-tech pip against 1.885714 observed.',
  measuredPerFaction: 'read per faction, never global: 0.80 for Project Exodus (18 Projects), 0.95 for the '
    + 'observer (21), and 1.00 capped for the Resistance (34), Humanity First (37), the Academy (31), the '
    + 'Servants (49) and the Protectorate (56). A campaign-wide multiplier would be identical for all, '
    + 'which is one of the reasons the 2.079x full-concentration figure is NOT a disguised 200% setting.',
  appliesTo: 'project slots only, never global tech slots',
  cap: 1,
  perPoint: 0.05
});

export const PROJECT_BONUS_STATES = Object.freeze({
  measured: 'measured',
  unavailable: 'unavailable'
});

/**
 * The observer's ProjectBonus from the three fields the save carries.
 *
 * Absent stays null throughout. An unread `projectPoints` is not zero points,
 * and an unread slot-unlock flag makes the number of points already SPENT
 * unknown -- which makes the remaining count unknown, not equal to the total.
 *
 * @param {Object} [inputs]
 * @returns {Object}
 */
export function computeProjectBonus({
  projectPoints = null,
  orgProjectSlotUnlocked = null,
  habProjectSlotUnlocked = null
} = {}) {
  const points = toFinite(projectPoints);
  const unavailable = (reason) => ({
    available: false,
    bonus: null,
    state: PROJECT_BONUS_STATES.unavailable,
    projectPoints: points,
    pointsSpentOnSlots: null,
    capped: null,
    reason,
    rule: PROJECT_BONUS_RULE
  });

  if (points === null) {
    return unavailable('this snapshot carries no Projects figure for the observer, so the project-slot '
      + 'research bonus cannot be computed; re-publish the save to restore it');
  }
  if (typeof orgProjectSlotUnlocked !== 'boolean' || typeof habProjectSlotUnlocked !== 'boolean') {
    return unavailable('this snapshot does not record whether the observer has spent Projects points on '
      + 'the org and hab project-slot unlocks, so how many points remain to grant the bonus is unknown');
  }

  const spent = (orgProjectSlotUnlocked ? 1 : 0) + (habProjectSlotUnlocked ? 1 : 0);
  const raw = Math.max(0, points - spent) * PROJECT_BONUS_RULE.perPoint;

  return {
    available: true,
    bonus: round(Math.min(PROJECT_BONUS_RULE.cap, raw), 6),
    state: PROJECT_BONUS_STATES.measured,
    projectPoints: points,
    pointsSpentOnSlots: spent,
    capped: raw > PROJECT_BONUS_RULE.cap,
    reason: null,
    rule: PROJECT_BONUS_RULE
  };
}

/**
 * A serialisable projection of the pricing model, for an API response.
 *
 * Drops the `rateFor` accessor -- a function does not survive a JSON response --
 * and keeps every measured term, so a reader can check a row's division rather
 * than trust it. Also carries the snapshot's research-cost basis, because a
 * duration is a cost over a rate and stating only the rate would leave half the
 * arithmetic unattributed.
 *
 * @param {Object|null} model     from `buildResearchAllocationPricing`
 * @param {Object|null} costScaling `snapshot.metadata.researchCostScaling`
 */
export function allocationPricingSummary(model, costScaling = null) {
  const common = {
    researchCostScaling: costScaling,
    scenarios: ALLOCATION_SCENARIOS,
    rateStates: ALLOCATION_RATE_STATES,
    projectBonusRule: PROJECT_BONUS_RULE
  };
  if (!model || model.available !== true) {
    return {
      ...common,
      available: false,
      reason: model?.reason ?? 'no research allocation pricing model was built',
      monthlyResearchIncome: model?.monthlyResearchIncome ?? null,
      totalPips: null,
      pippedSlotCount: null,
      projectBonus: model?.projectBonus ?? null,
      model: ALLOCATION_MODEL
    };
  }
  return {
    ...common,
    available: true,
    reason: null,
    source: model.source,
    monthlyResearchIncome: model.monthlyResearchIncome,
    monthlyResearchIncomeBasis: model.monthlyResearchIncomeBasis,
    totalPips: model.totalPips,
    pippedSlotCount: model.pippedSlotCount,
    projectBonus: model.projectBonus,
    pippedSlotsByCategory: model.pippedSlotsByCategory,
    sameCategoryDecayBase: model.sameCategoryDecayBase,
    sameCategoryDecayStatus: model.sameCategoryDecayStatus,
    accuracy: model.accuracy,
    model: model.model
  };
}

/** What kind of answer a priced rate is. These must never be collapsed. */
export const ALLOCATION_RATE_STATES = Object.freeze({
  /** The item occupies a slot carrying pips; every term is read from the save. */
  measuredSlot: 'measured-slot-allocation',
  /** It occupies a slot carrying zero pips, so it receives nothing at all. */
  receivesNothing: 'slot-receives-nothing',
  /** It is not in a slot, so a pip allocation had to be assumed. */
  assumed: 'assumed-allocation',
  /** The layout, the income or the project bonus could not be read. */
  unavailable: 'allocation-unavailable'
});

export const ALLOCATION_SCENARIOS = Object.freeze({
  onePip: 'one-pip',
  allPips: 'all-pips'
});

/** The wiki's same-category decay base. Corroborated, not pinned -- see below. */
const SAME_CATEGORY_DECAY_BASE = 0.9;

/**
 * One slot's allocation multiplier over the nominal monthly income.
 *
 * `(1 + 5% per pipped slot) x pipShare x (1 + CategoryBonus x 0.9^(k-1) + ProjectBonus)`
 *
 * @returns {number|null} null when a term is unreadable
 */
function allocationMultiplier({
  pips, totalPips, pippedSlotCount, categoryBonus, projectBonus, isProject, sameCategoryPippedSlots
}) {
  const p = toFinite(pips);
  const total = toFinite(totalPips);
  const n = toFinite(pippedSlotCount);
  const cat = toFinite(categoryBonus) ?? 0;
  // `isProject === null` means the item's slot kind could not be resolved, so
  // whether the ProjectBonus applies is unknown. Omitting it gives the SLOWEST
  // rate the item can have, which makes the resulting months an honest upper
  // bound -- the same treatment an unresolved category bonus gets. Including it
  // on a guess would understate a global tech's duration by nearly half.
  const proj = isProject === true ? toFinite(projectBonus) : 0;
  if (p === null || total === null || n === null || proj === null || !(total > 0)) return null;
  const k = Math.max(1, toFinite(sameCategoryPippedSlots) ?? 1);
  return (1 + 0.05 * n) * (p / total) * (1 + cat * Math.pow(SAME_CATEGORY_DECAY_BASE, k - 1) + proj);
}

const unavailableRate = (reason) => ({
  state: ALLOCATION_RATE_STATES.unavailable,
  monthlyRate: null,
  pips: null,
  pipShare: null,
  multiplier: null,
  scenario: null,
  scenarios: null,
  monthsAreUpperBound: null,
  reason,
  basis: reason
});

/**
 * Prices research durations against the allocation an item would actually get.
 *
 * @param {Object} snapshot            filtered or raw snapshot
 * @param {Object} options
 * @param {number|string} options.observerId
 * @param {Object} [options.allocation] a prebuilt `buildResearchSlotAllocation`
 * @returns {Object} always an object; `available: false` carries a reason and a
 *   `rateFor` that answers `allocation-unavailable` for everything.
 */
export function buildResearchAllocationPricing(snapshot, { observerId, allocation = null } = {}) {
  const layout = allocation || buildResearchSlotAllocation(snapshot, { observerId });
  const observer = asArray(snapshot?.factions).find(faction => sameId(faction?.ID, observerId)) || null;
  const income = toFinite(observer?.totalResearch);
  const projectBonus = computeProjectBonus({
    projectPoints: observer?.projectPoints,
    orgProjectSlotUnlocked: observer?.orgProjectSlotUnlocked,
    habProjectSlotUnlocked: observer?.habProjectSlotUnlocked
  });

  const unavailable = (reason) => ({
    available: false,
    reason,
    monthlyResearchIncome: income,
    totalPips: toFinite(layout?.totalPips),
    pippedSlotCount: toFinite(layout?.slotsWithPips),
    projectBonus,
    scenarios: ALLOCATION_SCENARIOS,
    states: ALLOCATION_RATE_STATES,
    model: ALLOCATION_MODEL,
    rateFor: () => unavailableRate(reason),
    concentratedMonthlyRate: () => ({
      monthlyRate: null, multiplier: null, monthsAreUpperBound: null, category: null, basis: reason
    })
  });

  if (layout?.available !== true) {
    return unavailable(layout?.reason || 'the observer\'s research slot layout could not be read, so no '
      + 'duration can be priced against the allocation an item would receive');
  }
  if (income === null || !(income > 0)) {
    return unavailable('the observer\'s monthly research income is not measurable in this snapshot, so no '
      + 'allocation rate can be formed');
  }
  if (projectBonus.available !== true) {
    return unavailable(projectBonus.reason);
  }

  const totalPips = toFinite(layout.totalPips);
  const pippedSlotCount = toFinite(layout.slotsWithPips);
  if (totalPips === null || !(totalPips > 0) || pippedSlotCount === null) {
    return unavailable('the observer assigns no research pips anywhere in this snapshot, so no slot '
      + 'receives research and no duration can be priced against an allocation');
  }

  // How many PIPPED slots already hold each category, for the 0.9^(k-1) decay.
  const pippedByCategory = new Map();
  for (const slot of asArray(layout.slots)) {
    if (slot?.carriesPips !== true || typeof slot.category !== 'string') continue;
    pippedByCategory.set(slot.category, (pippedByCategory.get(slot.category) || 0) + 1);
  }

  // Where each item sits NOW, keyed by its id, read from the save. Projects
  // come from `currentProjects` (which carries backlog entries at 0 pips too);
  // global techs from the slot rows.
  const occupancy = new Map();
  for (const project of asArray(layout.currentProjects)) {
    if (!project?.projectId) continue;
    occupancy.set(String(project.projectId), {
      id: project.projectId, slot: project.slot, pips: project.pips, category: project.category
    });
  }
  for (const slot of asArray(layout.slots)) {
    if (slot?.kind !== SLOT_KINDS.globalTech || !slot.occupantId) continue;
    occupancy.set(String(slot.occupantId), {
      id: slot.occupantId, slot: slot.index, pips: slot.pips, category: slot.category
    });
  }

  /**
   * @param {Object} query
   * @param {string|null} query.itemId  project or global-tech id, to find its slot
   * @param {string|null} query.category
   * @param {boolean} query.isProject   project slots take the ProjectBonus
   * @param {number|null} query.categoryBonus  the EFFECTIVE bonus, or null
   * @param {boolean|null} query.categoryBonusIsLowerBound
   */
  const rateFor = ({
    itemId = null, category = null, isProject = true,
    categoryBonus = null, categoryBonusIsLowerBound = null
  } = {}) => {
    const catKnown = toFinite(categoryBonus);
    const cat = catKnown ?? 0;
    // An unresolved category bonus is NOT zero -- but zero is its floor, so
    // pricing at zero gives the SLOWEST rate the item can have, which makes the
    // resulting months an honest upper bound rather than a fabricated point
    // estimate. The same holds when the category's own sum is a declared lower
    // bound (the Mobile Space Science Lab that no snapshot field can count),
    // and when the slot kind is unresolved so the ProjectBonus is omitted.
    const monthsAreUpperBound = catKnown === null
      || categoryBonusIsLowerBound === true
      || isProject === null;
    const notes = [];
    if (catKnown === null) {
      notes.push(' This item\'s category bonus could not be resolved, so it is priced at zero -- the '
        + 'slowest rate it can have -- making these months an UPPER bound rather than a point estimate.');
    } else if (categoryBonusIsLowerBound === true) {
      notes.push(' This category\'s measured bonus is a declared lower bound, so the rate is a lower '
        + 'bound and these months are an upper bound.');
    }
    if (isProject === null) {
      notes.push(' Whether this item occupies a project slot could not be resolved, so the project bonus '
        + 'is omitted -- again the slowest rate, and again an upper bound on months.');
    }
    const boundNote = notes.join('');

    const sameCategory = typeof category === 'string' ? (pippedByCategory.get(category) || 0) : 0;
    const held = itemId === null ? null : occupancy.get(String(itemId)) || null;

    if (held) {
      const pips = toFinite(held.pips);
      if (pips === null) {
        return unavailableRate('this item occupies a research slot whose pip weight this snapshot does '
          + 'not carry, so what it receives is unknown');
      }
      if (pips === 0) {
        return {
          state: ALLOCATION_RATE_STATES.receivesNothing,
          monthlyRate: 0,
          pips: 0,
          pipShare: 0,
          multiplier: 0,
          scenario: null,
          scenarios: null,
          monthsAreUpperBound: false,
          reason: 'this item sits in a research slot carrying no pips, so it receives no research at all '
            + 'and has no time to complete until pips are assigned to it',
          basis: 'measured from the save: this slot holds zero of the observer\'s '
            + `${totalPips} assigned pips.`
        };
      }
      const multiplier = allocationMultiplier({
        pips, totalPips, pippedSlotCount, categoryBonus: cat,
        projectBonus: projectBonus.bonus, isProject, sameCategoryPippedSlots: sameCategory
      });
      if (multiplier === null) return unavailableRate('the allocation terms for this slot are incomplete');
      return {
        state: ALLOCATION_RATE_STATES.measuredSlot,
        monthlyRate: round(income * multiplier, 4),
        pips,
        pipShare: round(pips / totalPips, 6),
        multiplier: round(multiplier, 6),
        scenario: null,
        scenarios: null,
        monthsAreUpperBound,
        reason: null,
        basis: `priced through the allocation this item's own slot receives: ${pips} of the observer's `
          + `${totalPips} assigned pips across ${pippedSlotCount} pipped slot(s), times `
          + `(1 + category ${round(cat, 4)}${isProject === true ? ` + project ${projectBonus.bonus}` : ''}). `
          + 'Every term is read from the save.' + boundNote
      };
    }

    // Not in a slot: a pip allocation has to be assumed, so BOTH ends are given.
    const onePip = allocationMultiplier({
      pips: 1, totalPips, pippedSlotCount, categoryBonus: cat,
      projectBonus: projectBonus.bonus, isProject, sameCategoryPippedSlots: sameCategory + 1
    });
    const allPips = allocationMultiplier({
      pips: 1, totalPips: 1, pippedSlotCount: 1, categoryBonus: cat,
      projectBonus: projectBonus.bonus, isProject, sameCategoryPippedSlots: 1
    });
    if (onePip === null || allPips === null) {
      return unavailableRate('the allocation terms for an assumed pip allocation are incomplete');
    }

    const scenarios = {
      [ALLOCATION_SCENARIOS.onePip]: {
        scenario: ALLOCATION_SCENARIOS.onePip,
        multiplier: round(onePip, 6),
        monthlyRate: round(income * onePip, 4),
        assumption: `this item holds ONE of the observer's ${totalPips} pips with the current layout `
          + 'otherwise unchanged. On this save that is the rate a 1-pip slot is measured to deliver, so '
          + 'the conservative end is anchored to an observation.'
      },
      [ALLOCATION_SCENARIOS.allPips]: {
        scenario: ALLOCATION_SCENARIOS.allPips,
        multiplier: round(allPips, 6),
        monthlyRate: round(income * allPips, 4),
        assumption: 'every pip on this item and nothing else pipped -- the fastest the game can deliver '
          + 'it, and therefore a real LOWER bound on months.'
      }
    };

    return {
      state: ALLOCATION_RATE_STATES.assumed,
      monthlyRate: scenarios[ALLOCATION_SCENARIOS.onePip].monthlyRate,
      pips: null,
      pipShare: round(1 / totalPips, 6),
      multiplier: scenarios[ALLOCATION_SCENARIOS.onePip].multiplier,
      scenario: ALLOCATION_SCENARIOS.onePip,
      scenarios,
      monthsAreUpperBound,
      reason: null,
      basis: 'this item is not in a research slot, so its pip allocation is ASSUMED, not measured. The '
        + `headline figure takes the \`one-pip\` scenario (one of ${totalPips} pips, current layout `
        + 'otherwise unchanged); the `all-pips` scenario beside it is the fastest achievable and is a '
        + 'lower bound on months.' + boundNote
    };
  };

  /**
   * The rate ONE item would receive at FULL CONCENTRATION, ignoring where it
   * sits now.
   *
   * This is what a multi-step chain needs. A chain is not in a slot -- it is a
   * plan -- and "how long does this chain take" only has an answer once you say
   * at what effort. Full concentration is the one end of that range the model
   * can state without inventing anything: every pip on the step being worked,
   * one step at a time. It makes a chain duration a genuine LOWER bound, which
   * is the only honest thing to gate a planning horizon on -- a chain that
   * cannot fit even at full concentration certainly cannot fit.
   *
   * The `one-pip` end is deliberately NOT offered for chains: a chain worked at
   * one pip for a decade is not a plan anyone would follow, and publishing it
   * as the headline would push every chain past the horizon.
   */
  const concentratedMonthlyRate = ({
    category = null, isProject = true, categoryBonus = null, categoryBonusIsLowerBound = null
  } = {}) => {
    const catKnown = toFinite(categoryBonus);
    const multiplier = allocationMultiplier({
      pips: 1, totalPips: 1, pippedSlotCount: 1, categoryBonus: catKnown ?? 0,
      projectBonus: projectBonus.bonus, isProject, sameCategoryPippedSlots: 1
    });
    return {
      monthlyRate: multiplier === null ? null : round(income * multiplier, 4),
      multiplier: multiplier === null ? null : round(multiplier, 6),
      // Priced at the floor of every unresolved term, so the RATE is a lower
      // bound and the months are an upper bound within the concentrated case.
      monthsAreUpperBound: catKnown === null || categoryBonusIsLowerBound === true || isProject === null,
      category,
      basis: 'every pip on this step and nothing else pipped -- the fastest the game can deliver it.'
    };
  };

  return {
    available: true,
    reason: null,
    source: 'the save\'s own `researchWeights` and Projects figures for the observer, joined to the '
      + 'measured per-category research bonuses',
    monthlyResearchIncome: income,
    monthlyResearchIncomeBasis: '`cachedYearlyRevenue.Research` / 12 -- the game\'s own realised '
      + 'annualised rate. It is NOT multiplied by the campaign research speed setting: that setting acts '
      + 'on COST, and shared/researchCostScaling.mjs carries the measurement.',
    totalPips,
    pippedSlotCount,
    projectBonus,
    pippedSlotsByCategory: Object.fromEntries(pippedByCategory),
    sameCategoryDecayBase: SAME_CATEGORY_DECAY_BASE,
    sameCategoryDecayStatus: 'CORROBORATED, NOT PINNED. Every category held exactly one pipped slot in '
      + 'the measured interval, so the exponent was 0 everywhere and the term never engaged. It is '
      + 'applied here because it is part of the pinned formula, and on this save it changes a priced '
      + 'multiplier by at most 0.15%.',
    scenarios: ALLOCATION_SCENARIOS,
    states: ALLOCATION_RATE_STATES,
    model: ALLOCATION_MODEL,
    accuracy: 'the model reproduces the observer\'s four measured slot deliveries with ZERO free '
      + 'parameters to a single common scale factor -- observed/predicted 0.98582, 0.98586, 0.98577, '
      + '0.98586. The residual is uniform, so it is one scale term rather than a structural mis-fit, and '
      + 'it is deliberately left in rather than divided out. Treat a priced duration as good to about '
      + '1.5%, not to the digit.',
    rateFor,
    concentratedMonthlyRate
  };
}
