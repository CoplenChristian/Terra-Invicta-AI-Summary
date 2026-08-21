/**
 * Research advisor, phase 4: the ranking rules.
 * Purpose: the research-advisor phase-4 ranking rules that order candidates by
 *   availability group and priority.
 *
 * Spec: docs/research-advisor-spec.md sections 2, 3, 3a, 3b, 7, 9 step 4.
 *
 * This module holds the ORDERING ONLY. Every number it orders is produced by
 * phases 1-3 and arrives already computed:
 *
 *   shared/intel/propulsion.mjs     delta-V / acceleration per candidate drive
 *   shared/intel/militaryValue.mjs  per-class rank value against what is fielded
 *   shared/intel/economicValue.mjs  monthly value per unit, and value per point
 *   shared/fleetCapability.mjs      the measured dominant capability deficit
 *
 * Nothing here re-derives any of them. Composition is the whole job.
 *
 * THREE RULES THIS FILE EXISTS TO ENFORCE
 *
 * 1. Value per research point, never raw value (section 2). A 150,000-cost tech with
 *    twice the benefit of a 25,000-cost one is worse.
 *
 * 2. Military and economic value are NEVER summed (section 2). There is no exchange
 *    rate between combat acceleration and research per month, so this module
 *    produces two rankings and refuses to produce one. Economic value is split
 *    a second time, by unit, for the same reason: tonnes per month and dollars
 *    per year do not add either.
 *
 * 3. A candidate that cannot be scored is a STATE, not a zero (section 7). Phases 1-3
 *    each emit their own version of this -- `notComparable`, `unpriceable`,
 *    `inert` -- and a ranking that sorts them numerically would put every one
 *    of them last behind a genuine 0.0001. They are carried out of band, in
 *    their own buckets, with the reason attached.
 */

import { round, toFiniteNumber } from './util.mjs';

// ---------------------------------------------------------------------------
// STATES
// ---------------------------------------------------------------------------

/**
 * What happened when this candidate was scored.
 *
 * `ranked` is the only one that carries a number. The other four are the
 * distinct reasons a number could not be produced, and each is a different
 * fact about the candidate:
 *
 *   noImprovement       measured, and measurably not better than what the
 *                       observer already has. A REAL zero-or-worse, which is
 *                       not the same as an unmeasured one -- phase 1's whole
 *                       finding was a researchable drive that is a 6.5x combat
 *                       DOWNGRADE, and hiding it would hide the finding.
 *   noResearchRequired  behind a project already completed, or behind no
 *                       project at all (section 3b's `ungated`). Cost zero, so
 *                       value-per-point would divide by zero. This is good
 *                       news, not a gap: it can be built today.
 *   costUnmeasured      the remaining research cost is null. Section 3b's
 *                       `researchCost: -1` projects land here rather than
 *                       reading as free.
 *   notComparable       the value itself could not be measured: no fielded
 *                       baseline to compare against, or a stat the class ranks
 *                       on that this item does not carry.
 */
export const RANK_STATES = Object.freeze({
  ranked: 'ranked',
  noImprovement: 'no-improvement',
  noResearchRequired: 'no-research-required',
  costUnmeasured: 'cost-unmeasured',
  notComparable: 'not-comparable'
});

/**
 * What KIND of quantity a military row's multiple is a multiple OF.
 *
 * `measured` rows carry a named engineering axis with a unit -- output per
 * hardpoint in MW, heat capacity per tonne in GJ/t, combat acceleration in
 * m/s^2. `ruleScalar` rows carry the ratio of two `specialModuleValue` scalars,
 * and the templates name no quantity for those at all: the value is one number
 * per module shared across every rule the module carries, so the best that can
 * be said of a 1.25x is "a quarter more of whatever this rule set's scalar
 * counts".
 *
 * The distinction exists because the two are NOT commensurable, and sorting
 * them together let a rule-tag ratio lead a capability ranking. Measured
 * 2026-08-21 on the live save: the top military row in both modes read
 * "Cyclotron 40.0x RadHardened (rule value)" -- a particle-beam power bonus of
 * 20 divided by a magazine capacity multiplier of 0.5, filed under a boolean
 * radiation-hardening tag -- outranking a genuine 3.00x reactor improvement in
 * GW/t. The rows are still ranked and still shown; they are ordered after every
 * row that names a real axis, inside the same availability group.
 */
export const AXIS_KINDS = Object.freeze({
  measured: 'measured',
  ruleScalar: 'rule-scalar'
});

export const AXIS_KIND_ORDER = Object.freeze([AXIS_KINDS.measured, AXIS_KINDS.ruleScalar]);

/** Position of a row's axis kind in the ordering. Unknown kinds sort last. */
export function axisKindRank(axisKind) {
  const index = AXIS_KIND_ORDER.indexOf(axisKind);
  return index === -1 ? AXIS_KIND_ORDER.length : index;
}

/**
 * The delivery-floor tier: rows that clear or cannot be evaluated first, rows
 * MEASURED to fail second.
 *
 * Phase 5 gives a point-defence-targetable munition a second floor -- how much
 * defensive fire each arriving round has to survive against the best the
 * observer already fields. `AntimatterTorpedoLauncher` leads the live save's
 * military ranking at 6,687,502.98x on damage per hardpoint and absorbs 3.62x
 * the point-defence fire per arriving round of the Copperhead bay the observer
 * flies, because the bay throws eight rounds a cycle and the launcher throws
 * one. Damage that the defending battery removes in flight is damage that never
 * lands, so that row must not lead on damage alone.
 *
 * THREE STATES, and only the measured `false` demotes:
 *
 *   false  measured, and measurably worse than what the observer fields.
 *   true   measured, and no worse.
 *   null   the floor could not be evaluated -- a beam, which nothing can
 *          intercept; an observer who fields no comparable munition; or an item
 *          whose flight the templates do not describe. This does NOT demote.
 *
 * Treating null as a failure would reorder the entire ranking on the strength
 * of a measurement nobody made, every time the sky happened to be unobserved.
 * "Unknown is not safe" is honoured by carrying the reason on the row and
 * giving it its own badge in the panel, so it never reads as clearing -- not by
 * burying every munition in the catalogue.
 */
export const DELIVERY_FLOOR_ORDER = Object.freeze(['clears-or-unevaluable', 'measured-below-floor']);

export function deliveryFloorRank(row) {
  return row?.clearsDeliveryFloor === false ? 1 : 0;
}

/**
 * Availability groups, in the order they are offered.
 *
 * Section 3b & Actionability Spec: these are not tiers of quality, they are
 * different PROPOSITIONS, and the ranking is done inside each one rather than
 * across them:
 *   - buildable-now: completed or ungated items that improve on fielded equipment at 0 pts
 *   - researchable-now: available this turn in availableProjectNames
 *   - prereq-clear-but-unrolled: monthly dice roll that may never land
 *   - prereq-blocked: prerequisites not met
 */
export const AVAILABILITY_GROUP_ORDER = Object.freeze([
  'buildable-now',
  'researchable-now',
  'researching',
  'prereq-clear-but-unrolled',
  'prereq-blocked',
  'ungated',
  'completed',
  'faction-restricted',
  'unknown'
]);

/** Human labels for the groups above, so no renderer invents its own. */
export const AVAILABILITY_GROUP_LABELS = Object.freeze({
  'buildable-now': 'Fittable now (0 research cost)',
  'researchable-now': 'Researchable now',
  researching: 'In progress',
  'prereq-clear-but-unrolled': 'Not yet available — rolls monthly',
  'prereq-blocked': 'Prerequisites not met',
  ungated: 'Needs no research',
  completed: 'Already researched',
  'faction-restricted': 'Restricted to another faction',
  unknown: 'Availability unknown'
});

/**
 * Actionable groups: what the player can build/fit or research this turn.
 */
export const ACTIONABLE_GROUPS = Object.freeze(['buildable-now', 'researchable-now']);

/**
 * Aspirational groups: what requires monthly dice rolls or prerequisite research.
 */
export const ASPIRATIONAL_GROUPS = Object.freeze(['prereq-clear-but-unrolled', 'prereq-blocked']);

// ---------------------------------------------------------------------------
// DEFICIT -> RESEARCH REMEDY
// ---------------------------------------------------------------------------

/**
 * Which research actually moves each measured capability axis.
 *
 * The axes and the dominant deficit come from `summarizeFleetCapability` in
 * shared/fleetCapability.mjs, unchanged -- this table only says which candidate
 * rows count as closing each one, and states the basis for saying so.
 *
 * `classKeys` are `militaryValue` comparison classes; `ruleKeys` are the
 * within-rule groups of the rule-grouped classes; `sources` promotes an entire
 * candidate source. All three are matched by exact key, never by substring.
 */
export const DEFICIT_RESEARCH_REMEDIES = Object.freeze({
  deltaV: Object.freeze({
    sources: Object.freeze(['propulsion']),
    classKeys: Object.freeze([]),
    ruleKeys: Object.freeze(['EVMultiplier']),
    basis: 'template-derived: a hull\'s delta-V is EV_kps x ln(wet/dry), so it moves with the drive '
      + 'and with the five utility modules that carry an EVMultiplier rule. No other unlock family '
      + 'carries either term.'
  }),
  armor: Object.freeze({
    sources: Object.freeze([]),
    classKeys: Object.freeze(['ship_armor']),
    ruleKeys: Object.freeze([]),
    basis: 'template-derived: XRayResistance and BaryonicResistance are carried by the armour '
      + 'templates and by nothing else, so armour research is the only research that moves this axis.'
  }),
  ships: Object.freeze({
    sources: Object.freeze([]),
    classKeys: Object.freeze([]),
    ruleKeys: Object.freeze([]),
    basis: 'no research closes this axis. The capability model states its remedy is production '
      + '(remedyKind: "production"), not research, so nothing is promoted for it and the panel says so '
      + 'rather than promoting hull research that would not change the hull count.'
  })
});

/**
 * The deficit the military ordering should lead with, or an explicit reason it
 * has none.
 *
 * `unknown` is a first-class answer and is NOT the same as "no deficit": the
 * capability comparison returns `canContest: 'unknown'` whenever no alien force
 * is observable, and a blind observer is not a safe one. In that case the
 * ordering falls back to value-per-research-point with the fallback named.
 */
export function resolveDeficitOrdering(fleetCapability) {
  const capability = fleetCapability || null;
  if (!capability) {
    return {
      applied: false,
      axisKey: null,
      axisLabel: null,
      reason: 'no fleet capability comparison was available for this snapshot, so the military '
        + 'ordering is by value per research point alone.',
      remedy: null,
      canContest: 'unknown'
    };
  }

  const deficit = capability.dominantDeficit || null;
  if (!deficit) {
    return {
      applied: false,
      axisKey: null,
      axisLabel: null,
      reason: capability.canContest === 'unknown'
        ? `${capability.verdictReason} With no measured deficit to close, the military ordering is by `
          + 'value per research point alone.'
        : 'no capability axis reaches the decisive gap, so there is no measured deficit to promote and '
          + 'the military ordering is by value per research point alone.',
      remedy: null,
      canContest: capability.canContest ?? 'unknown'
    };
  }

  const remedy = DEFICIT_RESEARCH_REMEDIES[deficit.key] || null;
  const closesAnything = Boolean(remedy)
    && (remedy.sources.length > 0 || remedy.classKeys.length > 0 || remedy.ruleKeys.length > 0);

  return {
    applied: closesAnything,
    axisKey: deficit.key,
    axisLabel: deficit.label ?? deficit.key,
    axisText: deficit.text ?? null,
    ratio: toFiniteNumber(deficit.ratio),
    own: toFiniteNumber(deficit.own),
    alien: toFiniteNumber(deficit.alien),
    unit: deficit.unit ?? null,
    remedyKind: deficit.remedyKind ?? null,
    remedyLabel: deficit.remedyLabel ?? null,
    deficitMeaning: deficit.deficitMeaning ?? null,
    canContest: capability.canContest ?? 'unknown',
    remedy,
    reason: closesAnything
      ? `${deficit.label} is the widest measured gap, so candidates that move it are ordered first `
        + 'within each availability group, ahead of higher-scoring candidates that do not. '
        + `Basis: ${remedy.basis}`
      : (remedy
        ? `${deficit.label} is the widest measured gap, but ${remedy.basis}`
        : `${deficit.label} is the widest measured gap and this module carries no research remedy `
          + 'mapping for it, so nothing is promoted and the ordering is by value per research point alone.')
  };
}

/** Does this candidate row move the deficit axis? Exact key match only. */
export function closesDeficit(row, ordering) {
  if (!ordering || !ordering.applied || !ordering.remedy) return false;
  const { sources, classKeys, ruleKeys } = ordering.remedy;
  if (row.source && sources.includes(row.source)) return true;
  if (row.classKey && classKeys.includes(row.classKey)) return true;
  if (row.ruleKey && ruleKeys.includes(row.ruleKey)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// VALUE PER RESEARCH POINT
// ---------------------------------------------------------------------------

export const RANKING_FORMULAE = Object.freeze({
  militaryValuePerResearchPoint: Object.freeze({
    formula: 'militaryValuePerResearchPoint = (rankMetricMultiple - 1) / remainingResearchCost',
    reads: 'rankMetricMultiple is phase 2\'s own multiple against the best item the observer '
      + 'currently fields on that class\'s declared ranking axis, or phase 1\'s multiple against the '
      + 'drive actually fitted. This module does not recompute either.',
    unit: 'fractional improvement on that class\'s axis, per research point',
    validatedAgainstGameOutput: false,
    note: 'A multiple of 3.2 is a gain of 2.2, which is why the -1 is there: a 1.0x multiple is not '
      + 'worth a single research point and must not score as though it were worth 1.0.'
  }),
  economicValuePerResearchPoint: Object.freeze({
    formula: 'economicValuePerResearchPoint = monthlyValueInUnit / remainingResearchCost',
    reads: 'taken verbatim from phase 3\'s `valuePerResearchPoint.byUnit[].perResearchPoint`.',
    unit: 'one per unit of monthly value; never summed across units',
    validatedAgainstGameOutput: false
  })
});

/**
 * Value per research point for a military candidate.
 *
 * Returns a state, always, and a number only in the one state that has one.
 * `multiple` is phase 1's or phase 2's own figure and is never recomputed here.
 */
export function militaryValuePerResearchPoint(multiple, remainingResearchCost, availabilityState) {
  const cost = toFiniteNumber(remainingResearchCost);
  const value = toFiniteNumber(multiple);

  if (value === null) {
    return {
      state: RANK_STATES.notComparable,
      perResearchPoint: null,
      gainMultiple: null,
      reason: 'no comparison multiple: the observer fields nothing in this class, or this item does '
        + 'not carry the stat the class ranks on. Not scored zero, which would rank it last and hide it.'
    };
  }

  // Cost first for the two states where the cost is the whole story, so a
  // completed project does not get reported as "no improvement" when the real
  // fact about it is that it is already paid for.
  if (cost === null) {
    return {
      state: RANK_STATES.costUnmeasured,
      perResearchPoint: null,
      gainMultiple: round(value - 1, 6),
      reason: 'the remaining research cost is not measurable for this item, so no value-per-point '
        + 'ratio can be formed. The improvement multiple beside it is still measured.'
    };
  }

  if (cost <= 0) {
    return {
      state: RANK_STATES.noResearchRequired,
      perResearchPoint: null,
      gainMultiple: round(value - 1, 6),
      reason: availabilityState === 'ungated'
        ? 'this item names no research gate at all, so nothing has to be researched to use it.'
        : 'the project that unlocks this is already finished, so it costs no further research.'
    };
  }

  if (value <= 1) {
    return {
      state: RANK_STATES.noImprovement,
      perResearchPoint: null,
      gainMultiple: round(value - 1, 6),
      reason: value === 1
        ? 'measured, and exactly equal to the best the observer already fields on this axis.'
        : 'measured, and measurably WORSE than what the observer already fields on this axis. '
          + 'Listed rather than dropped, because the best researchable option being a downgrade is '
          + 'the answer, not the absence of one.'
    };
  }

  return {
    state: RANK_STATES.ranked,
    perResearchPoint: round((value - 1) / cost, 10),
    gainMultiple: round(value - 1, 6),
    reason: null
  };
}

/**
 * The per-unit value-per-research-point rows for one economic candidate.
 *
 * Phase 3 already computed every number here; this only reshapes its
 * `valuePerResearchPoint.byUnit` into rows and preserves its three pricing
 * states. A candidate that priced nothing yields no ranked row and is counted
 * in its own bucket instead of being ranked with a zero.
 */
export function economicRankRows(item) {
  const vprp = item?.valuePerResearchPoint || null;
  const availabilityState = item?.availability?.state ?? 'unknown';
  const remaining = toFiniteNumber(item?.availability?.remainingResearchCost);

  if (!vprp || vprp.available !== true || !Array.isArray(vprp.byUnit) || vprp.byUnit.length === 0) {
    return {
      rows: [],
      state: remaining === null
        ? RANK_STATES.costUnmeasured
        : (remaining <= 0 ? RANK_STATES.noResearchRequired : RANK_STATES.notComparable),
      // Phase 3's own words, kept rather than replaced: it knows whether the
      // quantity was unmeasured or measured and found to be zero, and this
      // module must not flatten that back into one answer.
      reason: vprp?.reason
        || (item?.valuationState === 'inert'
          ? 'measured, and measurably worth nothing right now'
          : 'nothing about this candidate could be priced against this save')
    };
  }

  return {
    rows: vprp.byUnit
      .map(entry => ({
        unit: entry.unit,
        monthlyValue: toFiniteNumber(entry.total),
        perResearchPoint: toFiniteNumber(entry.perResearchPoint)
      }))
      .filter(entry => entry.perResearchPoint !== null),
    state: RANK_STATES.ranked,
    reason: null,
    availabilityState
  };
}

// ---------------------------------------------------------------------------
// ORDERING
// ---------------------------------------------------------------------------

/**
 * Deterministic comparator for ranked military rows inside one availability
 * group: deficit-closing first, then axis kind, then value per research point,
 * then id.
 *
 * The deficit key comes ahead of everything on purpose and that is section 3's
 * requirement, not an optimisation -- "a save where armour is the gap must not
 * lead with drives" only holds if the measured gap outranks the raw number. It
 * stays ahead of the axis-kind tier too, because `EVMultiplier` is a rule-
 * scalar row AND the only unlock family besides drives that moves delta-V; a
 * delta-V-deficit save must still be able to lead with it.
 *
 * Axis kind comes second: a ratio of two unnamed module scalars is not
 * commensurable with a ratio of two figures in GW/t, so it never displaces one.
 * See `AXIS_KINDS`.
 *
 * The delivery floor comes THIRD, between axis kind and value, and the position
 * is deliberate in both directions. It sits AFTER `axisKind` because a row with
 * a named engineering unit that fails delivery is still more commensurable than
 * a unitless rule scalar -- the antimatter torpedo's megawatts per hardpoint
 * remain a real quantity even though the round arrives alone, so it still
 * outranks a `RadHardened` ratio. It sits BEFORE `valuePerResearchPoint`
 * because that is the whole point: a candidate that wins on damage per research
 * point and loses on whether the round survives the flight must not lead its
 * group on the number it wins. And `closesDeficit` stays first, exactly as it
 * does for `axisKind`: a measured capability gap outranks both.
 */
export function compareMilitaryRows(left, right) {
  if (left.closesDeficit !== right.closesDeficit) return left.closesDeficit ? -1 : 1;
  const leftZeroCost = left.isZeroCost === true || left.rankState === RANK_STATES.noResearchRequired;
  const rightZeroCost = right.isZeroCost === true || right.rankState === RANK_STATES.noResearchRequired;
  if (leftZeroCost !== rightZeroCost) return leftZeroCost ? -1 : 1;

  const leftAxis = axisKindRank(left.axisKind);
  const rightAxis = axisKindRank(right.axisKind);
  if (leftAxis !== rightAxis) return leftAxis - rightAxis;

  if (leftZeroCost && rightZeroCost) {
    const leftMult = toFiniteNumber(left.improvementMultiple);
    const rightMult = toFiniteNumber(right.improvementMultiple);
    if (leftMult !== rightMult) {
      if (leftMult === null) return 1;
      if (rightMult === null) return -1;
      return rightMult - leftMult;
    }
    return String(left.id).localeCompare(String(right.id));
  }

  const leftDelivery = deliveryFloorRank(left);
  const rightDelivery = deliveryFloorRank(right);
  if (leftDelivery !== rightDelivery) return leftDelivery - rightDelivery;
  const leftValue = toFiniteNumber(left.valuePerResearchPoint);
  const rightValue = toFiniteNumber(right.valuePerResearchPoint);
  if (leftValue !== rightValue) {
    if (leftValue === null) return 1;
    if (rightValue === null) return -1;
    return rightValue - leftValue;
  }
  // A PRESENTATION tie-break, and our judgement rather than shipped data.
  //
  // The same module appears once per rule it carries, so two rows can be the
  // same item, the same gate and the same number under different rule names,
  // and the dedupe keeps whichever this comparator puts first -- which is the
  // name the reader sees. Prefer the rule carried by the FEWEST modules: a tag
  // that 17 of 57 utility modules carry (`RadHardened`) or that 8 carry
  // (`FullRepairCost`) says almost nothing about the one in front of you, while
  // `ParticleBeamPowerBonus` with a single carrier says what the number is.
  //
  // It changes no multiple and reorders nothing that is not already tied; the
  // alternative was alphabetical order, which got the right answer here only by
  // accident of spelling.
  const leftGroup = toFiniteNumber(left.ruleGroupSize);
  const rightGroup = toFiniteNumber(right.ruleGroupSize);
  if (leftGroup !== null && rightGroup !== null && leftGroup !== rightGroup) {
    return leftGroup - rightGroup;
  }
  return String(left.id).localeCompare(String(right.id));
}

/**
 * Which way is good for this row's unit, read from phase 3's own direction
 * table rather than from the sign of the number.
 *
 * This matters and it is not cosmetic. The mission-control contexts are
 * `direction: 'lower'`, so their priced delta is NEGATIVE when the tech helps:
 * "-16.65 mission control" is a saving. Sorting those descending puts the
 * SMALLEST saving first -- the ranking inverted, silently, for one unit.
 *
 * `directionByContext` is built from `contextCoverage.priced[].direction`, so
 * no sign convention is invented here. Three outcomes, all named:
 *
 *   higher  the delta is already oriented; use it as it stands
 *   lower   a fall in the quantity is the benefit; the oriented value is negated
 *   mixed / unknown  the row's priced contexts disagree, or none of them is in
 *                    the table. The row keeps its place in the listing but is
 *                    ordered after the oriented ones with the reason attached,
 *                    because guessing which way is good is how a saving becomes
 *                    a cost on screen.
 */
export function orientEconomicRow(row, directionByContext) {
  const table = directionByContext instanceof Map ? directionByContext : new Map();
  const directions = new Set(
    (Array.isArray(row?.contexts) ? row.contexts : [])
      .map(context => table.get(context))
      .filter(direction => direction === 'higher' || direction === 'lower')
  );

  const value = toFiniteNumber(row?.perResearchPoint);
  if (directions.size === 1) {
    const direction = [...directions][0];
    return {
      direction,
      orientedValuePerResearchPoint: value === null ? null : (direction === 'lower' ? -value : value),
      reason: direction === 'lower'
        ? 'this quantity is better when it falls, so the ordering uses the negated value; the delta keeps its own sign'
        : null
    };
  }

  return {
    direction: directions.size > 1 ? 'mixed' : 'unknown',
    orientedValuePerResearchPoint: null,
    reason: directions.size > 1
      ? 'this candidate prices contexts that improve in opposite directions, so no single orientation is '
        + 'correct for it and it is not ordered against rows that have one'
      : 'no priced context on this candidate carries a direction in this snapshot, so which way is good '
        + 'could not be read and the row is not ordered against rows where it could'
  };
}

/**
 * Deterministic comparator for economic rows inside one unit.
 *
 * Orders on `orientedValuePerResearchPoint`, never on the raw signed value --
 * see `orientEconomicRow`. A row with no orientation sorts last rather than
 * being ordered by a sign nobody checked.
 */
export function compareEconomicRows(left, right) {
  const leftValue = toFiniteNumber(left.orientedValuePerResearchPoint);
  const rightValue = toFiniteNumber(right.orientedValuePerResearchPoint);
  if (leftValue !== rightValue) {
    if (leftValue === null) return 1;
    if (rightValue === null) return -1;
    return rightValue - leftValue;
  }
  return String(left.id).localeCompare(String(right.id));
}

/**
 * Groups rows by availability state in the fixed order above.
 *
 * Every group present in the data gets an entry, and no group is invented for
 * data that is absent: an empty `researchable-now` on a turn-1 save must read
 * as "nothing is researchable in this class yet", not as a missing section.
 */
export function groupByAvailability(rows, compare) {
  const byState = new Map();
  for (const row of rows) {
    const state = row.availabilityState || 'unknown';
    if (!byState.has(state)) byState.set(state, []);
    byState.get(state).push(row);
  }
  const known = AVAILABILITY_GROUP_ORDER.filter(state => byState.has(state));
  // A state the game adds later would otherwise vanish silently.
  const extra = [...byState.keys()].filter(state => !AVAILABILITY_GROUP_ORDER.includes(state)).sort();
  return [...known, ...extra].map(state => ({
    state,
    label: AVAILABILITY_GROUP_LABELS[state] || state,
    actionable: ACTIONABLE_GROUPS.includes(state),
    count: byState.get(state).length,
    items: byState.get(state).sort(compare)
  }));
}

/**
 * The census of everything that could NOT be ranked, by reason.
 *
 * This is the section 7 requirement made structural: the counts travel with the
 * ranking so a renderer cannot show the ranked rows without also being handed
 * what was left out and why.
 */
export function tallyUnrankable(rows) {
  const counts = Object.fromEntries(Object.values(RANK_STATES).map(state => [state, 0]));
  const reasons = new Map();
  for (const row of rows) {
    const state = row.rankState || RANK_STATES.notComparable;
    counts[state] = (counts[state] || 0) + 1;
    if (state === RANK_STATES.ranked || !row.rankReason) continue;
    reasons.set(row.rankReason, (reasons.get(row.rankReason) || 0) + 1);
  }
  return {
    counts,
    reasons: [...reasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
  };
}

export const RANKING_METHOD = Object.freeze({
  neverSummed: 'military and economic value are two rankings, never one number. There is no exchange '
    + 'rate between combat acceleration and research per month, and inventing one is the single thing '
    + 'section 2 of the spec forbids outright. Economic value is split again by unit for the same reason.',
  valuePerPoint: 'both rankings are by value per research point, not raw value: a 150,000-cost tech '
    + 'with twice the benefit of a 25,000-cost one is worse.',
  withinAvailability: 'ranking happens INSIDE an availability group, never across. A researchable-now '
    + 'item and a prereq-clear-but-unrolled item are different propositions -- the second is a monthly '
    + 'dice roll that may never land -- and merging them puts an unreachable target at the top.',
  deficitFirst: 'inside a group, military candidates that move the measured capability deficit are '
    + 'ordered ahead of candidates that do not, whatever their value. The deficit is read from the same '
    + 'computation the Hold Ground directive uses; it is not derived here.',
  crossAxisCaveat: 'a multiple on one class\'s axis is NOT commensurable with a multiple on another\'s: '
    + '3.2x armour and 3.2x laser output are different things. Every row names its own axis, and this '
    + 'ordering is a triage aid rather than an exchange rate. It is our inference, not shipped data.',
  ruleScalarDemotion: 'utility and hab modules have no engineering axis at all -- the templates give each '
    + 'module ONE specialModuleValue shared across every rule it carries, and name no quantity for it. A '
    + 'ratio of two such scalars is therefore ordered after every row that names a measured axis, inside '
    + 'the same availability group. It is still ranked and still shown, because within one rule set the '
    + 'ratio is real; it just cannot outrank a figure that has a unit. The exception is a deficit-closing '
    + 'row, which stays first: the EVMultiplier modules are rule-scalar rows and are also the only '
    + 'non-drive unlocks that move delta-V.',
  unrankableVisible: 'anything that could not be scored is carried in its own bucket with the reason, '
    + 'never as a zero. A tech whose value silently computes to 0 gets ranked last and never surfaces.',
  deliveryFloor: 'a point-defence-targetable munition carries a second floor: how much defensive fire '
    + 'each ARRIVING round has to survive, against the best such munition the observer already fields. '
    + 'Damage still leads the ordering, because it decides the outcome of an engagement; delivery is a '
    + 'floor, because it decides whether the outcome happens at all. Only a MEASURED failure demotes -- '
    + 'a beam has no delivery axis, an observer with no comparable munition has no floor, and neither '
    + 'is treated as a failure. Those rows carry their own reason and their own badge instead, so an '
    + 'unevaluated floor never reads as a cleared one. No hit probability is computed anywhere: the '
    + 'game publishes nothing to check one against.'
});
