/**
 * `/api/intel/research-ranking` -- phase 4 of the research advisor.
 * Purpose: the /api/intel/research-ranking projection composing the phase-4
 *   ranking of research candidates.
 *
 * Spec: docs/research-advisor-spec.md sections 2, 3, 3a, 3b, 7, 9 step 4.
 *
 * COMPOSITION ONLY. Every figure in this response is produced by an earlier
 * phase and is passed through unchanged:
 *
 *   phase 1  shared/intel/propulsion.mjs      delta-V, cruise and combat
 *                                             acceleration per candidate drive,
 *                                             ranked by the design's own role
 *   phase 2  shared/intel/militaryValue.mjs   seventeen comparison classes,
 *                                             each against what the observer
 *                                             currently fields
 *   phase 3  shared/intel/economicValue.mjs   monthly value per unit, priced
 *                                             against this save's quantities
 *   Hold Ground  shared/fleetCapability.mjs   the measured dominant capability
 *                                             deficit
 *
 * This module adds exactly two things: an ORDER, and the reasons a candidate
 * has no place in it. It does not recompute a multiple, a cost, an availability
 * state or a deficit, and a reviewer should be able to grep this file for any
 * arithmetic on game data and find only `(multiple - 1) / cost` -- which lives
 * in shared/researchRanking.mjs, not here.
 *
 * WHY THE TWO TRACKS STAY APART. Section 2 is explicit that military and economic
 * value are never summed into one number without a stated exchange rate, and
 * there is no exchange rate between combat acceleration and research per month.
 * `items` is therefore a CONCATENATION of two independently ordered rankings in
 * a fixed track order, never a merged score, and `ordering.basis` says so in
 * the payload rather than only in this comment.
 */

import { DEFAULT_OBSERVER_FACTION_ID } from '../constants.mjs';
import { asArray, round, sameId, toFiniteNumber } from '../util.mjs';
import { summarizeFleetCapability } from '../fleetCapability.mjs';
import { AVAILABILITY_STATES, buildAvailabilityResolver } from '../researchAvailability.mjs';
import {
  ACTIONABLE_GROUPS,
  ASPIRATIONAL_GROUPS,
  AVAILABILITY_GROUP_LABELS,
  AVAILABILITY_GROUP_ORDER,
  AXIS_KINDS,
  DELIVERY_FLOOR_ORDER,
  DEFICIT_RESEARCH_REMEDIES,
  RANKING_FORMULAE,
  RANKING_METHOD,
  RANK_STATES,
  closesDeficit,
  compareEconomicRows,
  compareMilitaryRows,
  economicRankRows,
  groupByAvailability,
  militaryValuePerResearchPoint,
  orientEconomicRow,
  resolveDeficitOrdering,
  tallyUnrankable
} from '../researchRanking.mjs';
import { buildResearchSlotAllocation } from '../researchSlots.mjs';
import { propulsionResource } from './propulsion.mjs';
import { militaryValueResource } from './militaryValue.mjs';
import { economicValueResource } from './economicValue.mjs';

const DEFAULT_GROUP_LIMIT = 5;
const MAX_GROUP_LIMIT = 50;

// Phase 3 defaults to 25 candidates; the ranking needs the whole set before it
// can say which 5 lead, so it asks for the module's own maximum rather than
// ranking a pre-truncated list.
const ECONOMIC_SCAN_LIMIT = 1000;

const toFinite = toFiniteNumber;

/** A display string is never built from a null. Absent stays absent. */
const nameOr = (value, fallback) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text === '' ? (fallback ?? null) : text;
};

// ---------------------------------------------------------------------------
// MILITARY CANDIDATE ROWS
// ---------------------------------------------------------------------------

/**
 * One military candidate row, in the single shape the ordering understands.
 *
 * `axisLabel` travels on every row because a multiple is meaningless without
 * it: 3.2x armour and 3.2x laser output are not the same claim, and section 7
 * requires every derived metric to state what it measured.
 */
function militaryRow({
  id, source, classKey, ruleKey, itemId, displayName, axisLabel, axisKind, axisBasis,
  multiple, availabilityState, gateProjectId, gateProjectName, remainingResearchCost,
  monthsAtCurrentIncome, unlockChance, clearsFloor, floorReason, alsoUnlocks, context,
  ruleGroupSize, clearsDeliveryFloor, deliveryFloorReason
}) {
  const scored = militaryValuePerResearchPoint(multiple, remainingResearchCost, availabilityState);
  const isZeroCost = scored.state === RANK_STATES.noResearchRequired && scored.gainMultiple !== null && scored.gainMultiple > 0;
  const effectiveState = isZeroCost ? 'buildable-now' : (availabilityState || AVAILABILITY_STATES.unknown);
  return {
    id,
    track: 'military',
    source,
    classKey: classKey ?? null,
    ruleKey: ruleKey ?? null,
    // Tie-break only: how many modules carry this row's rule. Null on every
    // non-rule row, which is what keeps the tie-break inert for them rather
    // than treating "no rule group" as a group of size zero.
    ruleGroupSize: ruleGroupSize ?? null,
    itemId,
    displayName,
    // The unlocked item's own axis, named. Never a bare number.
    axisLabel,
    // Whether that axis has a unit at all. `rule-scalar` rows are ordered after
    // every `measured` row in the same group -- see AXIS_KINDS.
    axisKind: axisKind ?? AXIS_KINDS.measured,
    axisBasis: axisBasis ?? null,
    improvementMultiple: toFinite(multiple),
    valuePerResearchPoint: scored.perResearchPoint,
    gainMultiple: scored.gainMultiple,
    isZeroCost,
    isBuildableNow: isZeroCost,
    rankState: scored.state,
    rankReason: scored.reason,
    availabilityState: effectiveState,
    availabilityLabel: AVAILABILITY_GROUP_LABELS[effectiveState] || effectiveState || 'unknown',
    gateProjectId: gateProjectId ?? null,
    gateProjectName: gateProjectName ?? null,
    remainingResearchCost: isZeroCost ? 0 : toFinite(remainingResearchCost),
    monthsAtCurrentIncome: isZeroCost ? 0 : toFinite(monthsAtCurrentIncome),
    unlockChance: isZeroCost ? null : (unlockChance ?? null),
    // Phase 1 and phase 2 both rank on one axis with a stated floor on the axis
    // it trades against. A candidate that wins its axis by failing the floor is
    // the exact shape of phase 1's finding, so the floor verdict is not
    // optional decoration.
    clearsFloor: clearsFloor ?? null,
    floorReason: floorReason ?? null,
    // Phase 5's second floor, and tri-state for the same reason the first is:
    // null means the floor could not be EVALUATED for this row -- a beam, an
    // observer fielding no comparable munition, or an item whose flight the
    // templates do not describe -- which is not the same as clearing it. Only a
    // measured `false` demotes; see `deliveryFloorRank`.
    clearsDeliveryFloor: clearsDeliveryFloor ?? null,
    deliveryFloorReason: deliveryFloorReason ?? null,
    alsoUnlocks: alsoUnlocks ?? null,
    action: (context?.family === 'ship_hull' || classKey === 'ship_hull') ? 'build' : 'refit',
    context: context ?? null,
    closesDeficit: false,
    missingPrerequisites: null,
    slotAction: isZeroCost ? 'no-slot-needed' : null,
    slotNote: isZeroCost ? 'Fittable today at 0 research cost — requires only a refit or build.' : null
  };
}

/**
 * Drive candidates, from phase 1.
 *
 * One row per (gate project, design role). The reference design for a role is
 * the one with the MOST hulls in service in that role, because a drive's
 * multiple is relative to the drive currently fitted and therefore differs per
 * design -- picking the largest is a stated rule rather than an arbitrary one,
 * and the reference is named on the row.
 *
 * The multiple reported is phase 1's own, on the axis phase 1 ranks that role
 * by (combat acceleration for a warship, delta-V for a transport). This module
 * deliberately does NOT re-rank drives on delta-V even when delta-V is the
 * measured deficit: phase 1 measured that a delta-V-first drive ranking
 * recommends a 1,300x combat-acceleration downgrade. The delta-V multiple rides
 * along beside it instead, so the deficit axis is visible without becoming the
 * ranking axis.
 */
function propulsionRows(propulsion) {
  const designs = asArray(propulsion?.items);
  if (designs.length === 0) return [];

  // `items` arrives sorted by hull count descending, so the first design seen
  // for a role IS that role's largest.
  const referenceByRole = new Map();
  for (const design of designs) {
    const role = design?.role?.role || 'unknown';
    if (!referenceByRole.has(role)) referenceByRole.set(role, design);
  }

  const rows = [];
  for (const [role, design] of referenceByRole) {
    const rankingAxis = nameOr(propulsion?.roles?.ranking?.[role], 'the role\'s own ranking axis');
    const designName = nameOr(design.displayName, design.designId);
    for (const state of AVAILABILITY_GROUP_ORDER) {
      const best = design.bestByState?.[state];
      if (!best) continue;
      const deltaVMultiple = toFinite(best.vsFittedDrive?.deltaVMultiple);
      rows.push(militaryRow({
        id: `propulsion:${role}:${best.gateProjectId ?? best.driveId}`,
        source: 'propulsion',
        itemId: best.driveId,
        displayName: nameOr(best.displayName, best.driveId),
        axisLabel: role === 'warship' ? 'combat acceleration' : 'delta-V',
        axisBasis: `${rankingAxis}; measured against the drive fitted to ${designName}, `
          + `the observer's largest ${role} design in service (${design.shipCount} hulls).`,
        multiple: best.vsFittedDrive?.rankMetricMultiple,
        availabilityState: state,
        gateProjectId: best.gateProjectId,
        gateProjectName: null,
        remainingResearchCost: best.remainingResearchCost,
        monthsAtCurrentIncome: best.monthsAtCurrentIncome,
        unlockChance: best.unlockChance,
        clearsFloor: best.clearsFloor,
        floorReason: best.floorReason,
        context: {
          role,
          referenceDesign: designName,
          referenceHulls: toFinite(design.shipCount),
          deltaVKps: toFinite(best.deltaVKps),
          combatAccelerationMps2: toFinite(best.combatAccelerationMps2),
          cruiseAccelerationMps2: toFinite(best.cruiseAccelerationMps2),
          // The deficit axis, carried beside the ranking axis rather than
          // replacing it. Null when the fitted drive's figure was unmeasurable.
          deltaVMultiple,
          deltaVMultipleBasis: deltaVMultiple === null
            ? 'the drive currently fitted has no measurable delta-V in this snapshot, so no multiple could be formed'
            : 'delta-V under this drive against the drive currently fitted, on the same design'
        }
      }));
    }
  }
  return rows;
}

/**
 * Component candidates, from phase 2.
 *
 * Two shapes, because phase 2 has two: the fifteen RANKED classes report one
 * best row per availability state, and the two RULE-GROUPED classes (utility
 * and hab modules) report a best candidate per special rule, because there is
 * no exchange rate between an exhaust-velocity multiplier and a targeting
 * computer. Both shapes are carried; neither is flattened into the other.
 */
function militaryValueRows(military) {
  const rows = [];
  const axisSets = military?.axisSets || {};
  for (const cls of asArray(military?.items)) {
    const rankBy = nameOr(cls.ranking?.rankBy, null);
    // Phase 2 already ships a human label and a formula for every axis; using
    // the raw field key on screen would put `outputPerTonGWPerTon` in front of
    // a reader and would also lose the unit, which the label carries.
    const descriptor = asArray(axisSets[cls.axisSet]).find(entry => entry?.key === rankBy) || null;
    const axisLabel = nameOr(descriptor?.label, rankBy);
    const axisFormula = nameOr(descriptor?.formula, null);

    if (cls.bestByState) {
      for (const state of AVAILABILITY_GROUP_ORDER) {
        const best = cls.bestByState[state];
        if (!best) continue;
        rows.push(militaryRow({
          id: `military:${cls.classKey}:${state}:${best.id}`,
          source: 'military-value',
          classKey: cls.classKey,
          itemId: best.id,
          displayName: nameOr(best.displayName, best.id),
          // A ranked class with no ranking axis is a real outcome (armour with
          // no observable threat mix declines to rank at all), and the row says
          // so rather than printing a bare multiple with nothing attached.
          axisLabel: rankBy ? axisLabel : 'no ranking axis for this class',
          axisBasis: rankBy
            ? [axisFormula, nameOr(cls.rankRationale, null)].filter(Boolean).join(' — ')
            : nameOr(cls.rankingUnavailableReason, cls.rankRationale),
          multiple: best.vsFielded?.rankMetricMultiple,
          availabilityState: state,
          gateProjectId: best.gateProjectId,
          gateProjectName: best.gateProjectName,
          remainingResearchCost: best.remainingResearchCost,
          monthsAtCurrentIncome: best.monthsAtCurrentIncome,
          unlockChance: best.unlockChance,
          clearsFloor: best.clearsFloor,
          floorReason: best.floorReason,
          clearsDeliveryFloor: best.clearsDeliveryFloor,
          deliveryFloorReason: best.deliveryFloorReason,
          alsoUnlocks: best.alsoUnlocks,
          context: {
            family: cls.family,
            role: cls.role,
            baselineDisplayName: best.vsFielded?.baselineDisplayName ?? null,
            fieldedInClass: toFinite(cls.fielded?.count),
            noBaselineNote: cls.fielded?.count === 0 ? nameOr(cls.fielded?.note, null) : null,
            // Phase 2's fourth correction: a rate needs its magazine beside it.
            // AntimatterTorpedoLauncher's 3.2 GW is held for 28 seconds because
            // the magazine is four rounds, and a sustained-output multiple with
            // no duration next to it overstates exactly that weapon by the most.
            // Null where the axis does not exist -- beam weapons carry no
            // magazine field at all, which is a fact about them rather than a
            // missing measurement.
            sustainedOutputDurationS: toFinite(best.vsFielded?.byAxis?.sustainedOutputDurationS?.candidate),
            magazineEnergyMJ: toFinite(best.vsFielded?.byAxis?.magazineEnergyMJ?.candidate),
            // Phase 5's fifth correction: a damage rate needs to be told
            // whether the round arrives. Null on every row the delivery axis
            // does not apply to -- a beam is not interceptable, and saying
            // nothing about it is the correct answer rather than a gap.
            delivery: best.deliveryShotsPerArrivingRound === null || best.deliveryShotsPerArrivingRound === undefined
              ? null
              : {
                shotsPerArrivingRound: toFinite(best.deliveryShotsPerArrivingRound),
                floorValue: toFinite(best.deliveryFloorValue),
                floorBaselineDisplayName: best.deliveryFloorBaselineDisplayName ?? null,
                multipleOfFloor: (toFinite(best.deliveryFloorValue) === null
                  || !(toFinite(best.deliveryFloorValue) > 0)
                  || toFinite(best.deliveryShotsPerArrivingRound) === null)
                  ? null
                  : round(toFinite(best.deliveryShotsPerArrivingRound) / toFinite(best.deliveryFloorValue), 6),
                flightTimeS: toFinite(best.deliveryFlightTimeS),
                terminalSpeedKps: toFinite(best.deliveryTerminalSpeedKps),
                profileKey: best.deliveryProfileKey ?? null
              }
          }
        }));
      }
    }

    for (const group of asArray(cls.ruleSummary)) {
      const best = group.bestCandidate;
      if (!best) continue;
      rows.push(militaryRow({
        id: `military:${cls.classKey}:rule:${group.rule}:${best.id}`,
        source: 'military-value-rule',
        classKey: cls.classKey,
        ruleKey: group.rule,
        ruleGroupSize: toFinite(group.itemCount),
        itemId: best.id,
        displayName: nameOr(best.displayName, best.id),
        // The rule name IS the axis here: the templates carry no numeric label
        // for a special-module rule, so the honest label is the rule's own name
        // rather than a prettier one this module would be inventing.
        axisLabel: `${group.rule} (rule value)`,
        // ...and because it has no unit, it never displaces a row that does.
        axisKind: AXIS_KINDS.ruleScalar,
        axisBasis: 'compared only WITHIN this special rule AND only against a module carrying the '
          + `identical rule set (${nameOr(best.ruleSignature, 'no rules')}). The template gives each `
          + 'module one specialModuleValue shared across every rule it carries and never says which rule '
          + 'owns it, so only an identical rule set makes the ratio meaningful. There is no exchange rate '
          + 'between an exhaust-velocity multiplier and a targeting computer, and none between a rule '
          + 'scalar and a figure in GW/t either -- which is why this row is ordered after every measured '
          + 'axis in its group.',
        multiple: best.vsFieldedInRule?.multiple,
        availabilityState: best.researchState,
        gateProjectId: best.gateProjectId,
        gateProjectName: null,
        remainingResearchCost: best.remainingResearchCost,
        monthsAtCurrentIncome: best.monthsAtCurrentIncome,
        unlockChance: null,
        clearsFloor: null,
        floorReason: null,
        // A utility or hab module is not a munition, so the delivery floor is
        // not merely unevaluated for it -- it does not exist.
        clearsDeliveryFloor: null,
        deliveryFloorReason: null,
        context: {
          family: cls.family,
          rule: group.rule,
          ruleValue: toFinite(best.ruleValue),
          ruleSignature: best.ruleSignature ?? null,
          itemsInRule: toFinite(group.itemCount),
          fieldedInRule: toFinite(group.fieldedCount),
          // The item the multiple is actually against, which is the
          // same-signature baseline and NOT the group's highest-valued fielded
          // module. Reading the second as the first is the defect this gate
          // closed.
          baselineDisplayName: best.vsFieldedInRule?.baselineDisplayName ?? null,
          noBaselineNote: best.vsFieldedInRule?.unavailable === 'no-fielded-baseline'
            ? 'the observer fields nothing carrying this rule, so there is no baseline and the multiple is null rather than 1'
            : (best.vsFieldedInRule?.unavailable === 'no-same-signature-baseline'
              ? 'the observer fields modules carrying this rule, but none with this module\'s exact rule set, '
                + 'so no ratio of two comparable scalars exists and the multiple is null rather than a number '
                + 'formed across unlike quantities'
              : null)
        }
      }));
    }
  }
  return rows;
}

/**
 * Deduplicates military rows by gate project WITHIN an availability group.
 *
 * One project routinely unlocks the same weapon in seven mount variants and
 * sometimes tops more than one class. Listing it once per class buries
 * everything else; dropping the duplicates silently loses the fact that it
 * improves several things at once. The best-scoring row survives and names the
 * others on `alsoImproves`.
 *
 * A row with no gate project id is never merged with another: `undefined` in a
 * key is how this repo has twice collapsed a whole record set into one.
 *
 * Exported for the test that pins the two rules above; it has no other caller.
 */
export function dedupeByGateProject(rows) {
  const byKey = new Map();
  const passthrough = [];
  for (const row of rows) {
    if (!row.gateProjectId) { passthrough.push(row); continue; }
    const key = `${row.availabilityState}::${row.gateProjectId}`;
    const held = byKey.get(key);
    if (!held) { byKey.set(key, row); continue; }
    const better = compareMilitaryRows(row, held) < 0 ? row : held;
    const other = better === row ? held : row;
    // One project, one research decision. `closesDeficit` is stamped BEFORE
    // this merge, so a gate that unlocks something moving the measured deficit
    // keeps that row as its survivor even when a sibling unlock scores higher:
    // the "closes gap" badge has to sit on the unlock that actually closes it,
    // or the row reads as a radiator closing a delta-V gap. The higher-scoring
    // sibling is named on `alsoImproves` rather than lost. The OR below is the
    // belt to that braces, so the flag survives any future comparator change.
    better.closesDeficit = better.closesDeficit || other.closesDeficit;
    better.alsoImproves = [...(better.alsoImproves || []), {
      classKey: other.classKey,
      ruleKey: other.ruleKey,
      displayName: other.displayName,
      axisLabel: other.axisLabel,
      axisKind: other.axisKind,
      improvementMultiple: other.improvementMultiple,
      rankState: other.rankState
    }];
    byKey.set(key, better);
  }
  return [...passthrough, ...byKey.values()];
}

// ---------------------------------------------------------------------------
// ECONOMIC CANDIDATE ROWS
// ---------------------------------------------------------------------------

/**
 * context -> which way is good, straight from phase 3's own coverage table.
 * Built here rather than restated so the two cannot disagree about a direction.
 */
function directionTable(economic) {
  const table = new Map();
  for (const row of asArray(economic?.contextCoverage?.priced)) {
    if (row?.context && (row.direction === 'higher' || row.direction === 'lower')) {
      table.set(row.context, row.direction);
    }
  }
  return table;
}

function economicRows(economic, directions) {
  const ranked = [];
  const unrankable = [];
  for (const item of asArray(economic?.items)) {
    const scored = economicRankRows(item);
    const shared = {
      id: item.id,
      track: 'economic',
      source: 'economic-value',
      displayName: nameOr(item.displayName, item.id),
      category: item.category ?? null,
      availabilityState: item.availability?.state || AVAILABILITY_STATES.unknown,
      // Same fallback chain as the military rows: a state a later build adds
      // keeps its own name rather than being relabelled "unknown", which would
      // claim the availability could not be read when in fact it could.
      availabilityLabel: AVAILABILITY_GROUP_LABELS[item.availability?.state]
        || item.availability?.state
        || 'unknown',
      valuationState: item.valuationState,
      remainingResearchCost: toFinite(item.availability?.remainingResearchCost),
      monthsAtCurrentIncome: toFinite(item.availability?.monthsAtCurrentIncome),
      unlockChance: item.availability?.unlockChance ?? null,
      contexts: asArray(item.contexts),
      // The specific effect driving the number, which section 8 requires beside
      // every recommendation.
      largestPricedEffect: item.largestPricedEffect ?? null,
      economicContent: item.economicContent ?? null,
      unpriceableCodes: asArray(item.unpriceableCodes),
      inertCodes: asArray(item.inertCodes),
      closesDeficit: false,
      missingPrerequisites: null
    };

    if (scored.state !== RANK_STATES.ranked) {
      unrankable.push({ ...shared, rankState: scored.state, rankReason: scored.reason, unit: null,
        monthlyValue: null, valuePerResearchPoint: null });
      continue;
    }

    for (const entry of scored.rows) {
      const oriented = orientEconomicRow(
        { contexts: shared.contexts, perResearchPoint: entry.perResearchPoint },
        directions
      );
      ranked.push({
        ...shared,
        id: `${item.id}::${entry.unit}`,
        candidateId: item.id,
        unit: entry.unit,
        monthlyValue: entry.monthlyValue,
        valuePerResearchPoint: entry.perResearchPoint,
        // The ordering key. Kept beside the signed value rather than replacing
        // it, so a mission-control saving still prints as the negative delta it
        // is while sorting as the improvement it is.
        orientedValuePerResearchPoint: oriented.orientedValuePerResearchPoint,
        improvementDirection: oriented.direction,
        directionReason: oriented.reason,
        rankState: RANK_STATES.ranked,
        rankReason: null
      });
    }
  }
  return { ranked, unrankable };
}

// ---------------------------------------------------------------------------
// RESOURCE
// ---------------------------------------------------------------------------

/**
 * @param {Object} snapshot
 * @param {Object} [options]
 * @param {number|string} [options.observerId]
 * @param {string} [options.mode]     player | enhanced | omniscient
 * @param {number|null} [options.limit] rows shown per availability group
 * @param {string} [options.detail]   summary | full
 */
export const researchRankingResource = (snapshot, {
  observerId = DEFAULT_OBSERVER_FACTION_ID,
  mode = 'player',
  limit = null,
  detail = 'summary'
} = {}) => {
  const wantsFull = String(detail) === 'full';
  const requested = toFinite(limit);
  const groupLimit = requested === null
    ? DEFAULT_GROUP_LIMIT
    : Math.max(1, Math.min(MAX_GROUP_LIMIT, Math.trunc(requested)));

  const observerFaction = asArray(snapshot?.factions).find(entry => sameId(entry?.ID, observerId)) || null;
  const monthlyResearch = toFinite(observerFaction?.totalResearch);

  // --- the measured deficit, consumed not re-derived ----------------------
  // The same call the Hold Ground directive makes, against the same module.
  const fleetCapability = summarizeFleetCapability({
    observer: observerFaction || {},
    factions: asArray(snapshot?.factions),
    fleets: asArray(snapshot?.fleets)
  });
  const ordering = resolveDeficitOrdering(fleetCapability);

  // --- the three upstream phases ------------------------------------------
  const propulsion = propulsionResource(snapshot, { observerId, mode, limit: 1 });
  const military = militaryValueResource(snapshot, { observerId, mode, detail: 'summary' });
  const economic = economicValueResource(snapshot, { observerId, mode, detail: 'summary', limit: ECONOMIC_SCAN_LIMIT });
  const resolver = buildAvailabilityResolver(snapshot, mode, observerId);
  const slots = buildResearchSlotAllocation(snapshot, { observerId });

  function attachSlotAction(row) {
    if (row.isZeroCost || row.rankState === RANK_STATES.noResearchRequired) {
      row.slotAction = 'no-slot-needed';
      row.slotNote = 'Fittable today at 0 research cost — requires only a refit or build.';
      return row;
    }
    if (row.availabilityState === 'researchable-now') {
      if (!slots || slots.available !== true) {
        row.slotAction = null;
        row.slotNote = null;
        return row;
      }
      const free = slots.freeProjectSlots;
      const cap = slots.projectSlotCapacity;
      if (free !== null && free > 0) {
        row.slotAction = 'free-slot';
        row.freeProjectSlots = free;
        row.slotNote = `${free} of ${cap} project slots free — start now with nothing lost (${row.monthsAtCurrentIncome !== null ? `${row.monthsAtCurrentIncome} mo` : '—'} at current research income).`;
      } else if (free !== null && free === 0 && cap > 0) {
        row.slotAction = 'occupied-slot';
        row.activeOccupants = asArray(slots.activeProjects).map(p => ({
          id: p.projectId,
          displayName: p.displayName,
          accumulatedResearch: p.accumulatedResearch,
          totalCost: p.totalCost,
          percent: p.percent
        }));
        row.slotNote = `All ${cap} project slots active — starting this requires backlogging an active project (progress is retained).`;
      } else {
        row.slotAction = 'no-slot';
        row.slotNote = 'No project slots available to start this research.';
      }
      return row;
    }
    row.slotAction = null;
    row.slotNote = null;
    return row;
  }

  // --- military track ------------------------------------------------------
  // Deficit relevance is stamped BEFORE the dedupe, not after: the dedupe keeps
  // the highest-scoring row per gate project and OR-s the flag across the ones
  // it absorbs, so a project that unlocks a drive keeps its promotion even when
  // some other unlock behind the same project scores higher.
  const militaryAll = dedupeByGateProject([
    ...propulsionRows(propulsion),
    ...militaryValueRows(military)
  ].map(row => {
    row.closesDeficit = closesDeficit(row, ordering);
    return row;
  })).map(row => {
    // Section 8 requires the prerequisite chain beside a recommendation. It comes
    // from the same resolver phases 1-3 use, so a blocked row names what blocks
    // it instead of only saying that something does.
    if (row.gateProjectId && row.availabilityState === AVAILABILITY_STATES.prereqBlocked) {
      const resolved = resolver.resolve(row.gateProjectId);
      row.missingPrerequisites = asArray(resolved.missingPrerequisites)
        .map(entry => nameOr(entry.displayName, entry.id))
        .filter(Boolean);
      if (!row.gateProjectName) row.gateProjectName = nameOr(resolved.displayName, null);
    } else if (row.gateProjectId && !row.gateProjectName) {
      row.gateProjectName = nameOr(resolver.resolve(row.gateProjectId).displayName, null);
    }
    return row;
  });

  const isZeroCostRow = row => row.isZeroCost === true || (row.rankState === RANK_STATES.noResearchRequired && row.gainMultiple > 0);

  const militaryProcurement = militaryAll
    .filter(isZeroCostRow)
    .map(attachSlotAction)
    .sort(compareMilitaryRows);

  const militaryRanked = militaryAll
    .filter(row => !isZeroCostRow(row) && row.rankState === RANK_STATES.ranked)
    .map(attachSlotAction);

  const militaryGroups = groupByAvailability(militaryRanked, compareMilitaryRows)
    .map(group => ({
      ...group,
      actionable: ACTIONABLE_GROUPS.includes(group.state),
      aspirational: ASPIRATIONAL_GROUPS.includes(group.state),
      itemsShown: Math.min(groupLimit, group.items.length),
      items: wantsFull ? group.items : group.items.slice(0, groupLimit)
    }));

  // --- economic track ------------------------------------------------------
  const directions = directionTable(economic);
  const { ranked: economicRanked, unrankable: economicUnrankable } = economicRows(economic, directions);

  // Units, each ranked inside itself. Ordered by how many candidates carry the
  // unit and then by name, which is a census and not a value judgement --
  // ordering the UNITS by their totals would be the cross-unit comparison this
  // endpoint refuses to make.
  const byUnit = new Map();
  for (const row of economicRanked) {
    if (!byUnit.has(row.unit)) byUnit.set(row.unit, []);
    byUnit.get(row.unit).push(attachSlotAction(row));
  }
  const economicUnits = [...byUnit.entries()]
    .sort((a, b) => b[1].length - a[1].length || String(a[0]).localeCompare(String(b[0])))
    .map(([unit, rows]) => ({
      unit,
      count: rows.length,
      groups: groupByAvailability(rows, compareEconomicRows).map(group => ({
        ...group,
        actionable: ACTIONABLE_GROUPS.includes(group.state),
        aspirational: ASPIRATIONAL_GROUPS.includes(group.state),
        itemsShown: Math.min(groupLimit, group.items.length),
        items: wantsFull ? group.items : group.items.slice(0, groupLimit)
      }))
    }));

  // --- the flat envelope list ---------------------------------------------
  // Two rankings concatenated in a fixed track order. NOT a merged score; see
  // `ordering.basis` below, which says the same thing in the payload.
  const headOf = (groups) => groups
    .filter(group => ACTIONABLE_GROUPS.includes(group.state))
    .flatMap(group => group.items.slice(0, groupLimit));
  const items = [
    ...headOf(militaryGroups),
    ...economicUnits.flatMap(unit => headOf(unit.groups))
  ];

  const militaryTally = tallyUnrankable(militaryAll);
  const economicTally = tallyUnrankable([...economicRanked, ...economicUnrankable]);

  // Phase 5's census, aggregated across the classes that declare a delivery
  // floor. A floor that silently removes a row from the top of a ranking is a
  // TRUNCATION, and truncation announces itself: without this the only visible
  // effect on the live save is that the antimatter torpedo is no longer where
  // it was, with nothing on screen saying why.
  const demotedAcrossClasses = asArray(military?.items)
    .flatMap(cls => asArray(cls.deliveryDemoted?.items).map(item => ({ ...item, classKey: cls.classKey, family: cls.family })))
    .sort((a, b) => (toFinite(b.rankValue) ?? -Infinity) - (toFinite(a.rankValue) ?? -Infinity)
      || String(a.id).localeCompare(String(b.id)));
  const demotedTotal = asArray(military?.items)
    .reduce((sum, cls) => sum + (toFinite(cls.deliveryDemoted?.count) ?? 0), 0);
  const classesWithDeliveryFloor = asArray(military?.items).filter(cls => cls.deliveryDemoted !== null).length;

  return {
    resource: 'research-ranking',
    observerFactionId: observerId,
    intelMode: mode,
    detail: wantsFull ? 'full' : 'summary',
    formulae: RANKING_FORMULAE,
    method: RANKING_METHOD,
    states: {
      rank: Object.values(RANK_STATES),
      availability: Object.values(AVAILABILITY_STATES),
      availabilityLabels: AVAILABILITY_GROUP_LABELS,
      actionableGroups: ACTIONABLE_GROUPS,
      aspirationalGroups: ASPIRATIONAL_GROUPS,
      axisKinds: Object.values(AXIS_KINDS)
    },
    ordering: {
      basis: 'two parallel rankings, concatenated in a fixed track order (military, then economic). '
        + 'This is NOT a merged score and the position of an economic row below a military one carries '
        + 'no claim that the military one is worth more -- there is no exchange rate between them. '
        + 'Within a track, ordering is by value per research point inside one availability group, '
        + 'with deficit-closing military candidates promoted ahead of the rest of their group '
        + 'and rule-scalar candidates demoted behind every measured-axis one. Already-unlocked items '
        + 'are partitioned into procurement and not ranked against research.',
      deficitApplied: ordering.applied,
      militaryKeys: ['closesDeficit', 'axisKind', 'deliveryFloor', 'valuePerResearchPoint', 'id'],
      axisKindOrder: Object.values(AXIS_KINDS),
      deliveryFloorOrder: DELIVERY_FLOOR_ORDER,
      ruleScalarDemotion: RANKING_METHOD.ruleScalarDemotion,
      deliveryFloorDemotion: RANKING_METHOD.deliveryFloor,
      groupLimit,
      trackOrder: ['military', 'economic']
    },
    deficit: {
      ...ordering,
      // The full comparison, so a reader can see the axes that were excluded
      // and the detection capability the alien figures came from, rather than
      // taking the headline gap on trust.
      capability: {
        canContest: fleetCapability.canContest,
        verdictReason: fleetCapability.verdictReason,
        decisiveRatio: fleetCapability.decisiveRatio,
        axes: fleetCapability.axes,
        excludedAxes: fleetCapability.excludedAxes,
        rankedDeficits: fleetCapability.rankedDeficits.map(axis => ({
          key: axis.key, label: axis.label, ratio: axis.ratio, text: axis.text, remedyKind: axis.remedyKind
        })),
        alienForceObserved: fleetCapability.alienForceObserved,
        detectionSources: fleetCapability.detectionSources,
        basis: mode === 'player'
          ? 'player mode: alien ship designs are redacted, so the comparison uses observed alien FLEET '
            + 'metrics (armorMedian, lowestDeltaVKps) exactly as the Hold Ground directive does.'
          : 'observed alien fleet metrics (armorMedian, lowestDeltaVKps), the same figures the Hold '
            + 'Ground directive compares.'
      },
      remedyTable: DEFICIT_RESEARCH_REMEDIES
    },
    // Section 6 & Actionability Spec. WHERE the observer's research is currently pointed,
    // how many project slots are free, and which projects are backlogged with progress intact.
    slots,
    research: {
      monthlyResearchIncome: monthlyResearch,
      monthlyResearchIncomeReason: monthlyResearch === null
        ? 'this snapshot carries no research income for the observer, so no candidate can report a time to complete'
        : null,
      availabilityResolvable: resolver.available && resolver.availabilityKnown,
      availabilitySource: resolver.availabilitySource,
      availableProjectCount: resolver.availableProjectCount,
      reason: resolver.available
        ? (resolver.availabilityKnown ? null : 'the observer\'s available-project list is absent in this mode')
        : resolver.reason
    },
    // Whether each upstream phase could answer at all, and why not when it
    // could not. An empty ranking because the catalogue is missing and an empty
    // ranking because there is genuinely nothing to research are opposite facts.
    sources: {
      propulsion: {
        available: propulsion.driveCatalogue?.available ?? false,
        reason: propulsion.driveCatalogue?.reason ?? null,
        designsInService: toFinite(propulsion.fleet?.designsInService),
        note: propulsion.fleet?.note ?? null
      },
      militaryValue: {
        available: military.componentCatalogue?.available ?? false,
        reason: military.componentCatalogue?.reason ?? null,
        comparisonClasses: toFinite(military.count),
        deliveryEnvironment: military.deliveryEnvironment
          ? {
            available: military.deliveryEnvironment.available === true,
            selected: military.deliveryEnvironment.selected ?? null,
            reason: military.deliveryEnvironment.reason ?? null,
            hullsRead: toFinite(military.deliveryEnvironment.profiles?.[military.deliveryEnvironment.selected]?.hullsRead),
            pointDefenseInstallations: toFinite(military.deliveryEnvironment.profiles?.[military.deliveryEnvironment.selected]?.pointDefenseInstallations),
            meanMountsPerHull: toFinite(military.deliveryEnvironment.profiles?.[military.deliveryEnvironment.selected]?.meanMountsPerHull),
            validatedAgainstGameOutput: false
          }
          : null
      },
      economicValue: {
        available: economic.effectIndex?.available ?? false,
        reason: economic.effectIndex?.reason ?? null,
        candidatesConsidered: toFinite(economic.totalCandidates)
      }
    },
    military: {
      orderedBy: 'value per research point inside each availability group, deficit-closing first, '
        + 'munitions failing the delivery floor demoted, and rule-scalar axes last. Already-unlocked items '
        + 'are partitioned into procurement and not ranked against research.',
      axisCaveat: RANKING_METHOD.crossAxisCaveat,
      ruleScalarCaveat: RANKING_METHOD.ruleScalarDemotion,
      deliveryCaveat: RANKING_METHOD.deliveryFloor,
      candidatesConsidered: militaryAll.length,
      rankedCount: militaryRanked.length,
      procurementCount: militaryProcurement.length,
      procurement: militaryProcurement.length === 0 ? null : {
        label: 'Already unlocked, not in service',
        count: militaryProcurement.length,
        itemsShown: Math.min(groupLimit, militaryProcurement.length),
        items: wantsFull ? militaryProcurement : militaryProcurement.slice(0, groupLimit)
      },
      groups: militaryGroups,
      actionableGroups: militaryGroups.filter(g => ACTIONABLE_GROUPS.includes(g.state)),
      aspirationalGroups: militaryGroups.filter(g => ASPIRATIONAL_GROUPS.includes(g.state)),
      deliveryDemoted: classesWithDeliveryFloor === 0 ? null : {
        count: demotedTotal,
        classesWithDeliveryFloor,
        basis: RANKING_METHOD.deliveryFloor,
        itemsShown: Math.min(demotedAcrossClasses.length, groupLimit),
        itemsTotalCount: demotedTotal,
        itemsOmittedCount: Math.max(0, demotedTotal - Math.min(demotedAcrossClasses.length, groupLimit)),
        items: demotedAcrossClasses.slice(0, groupLimit)
      },
      deliveryFloor: {
        applied: classesWithDeliveryFloor > 0,
        classesWithDeliveryFloor,
        demotedCount: demotedTotal,
        demotedItems: wantsFull ? demotedAcrossClasses : demotedAcrossClasses.slice(0, groupLimit),
        rationale: 'phase 5: a point-defence-targetable munition whose delivery is measurably worse than what the observer fields cannot lead on damage per research point alone. Damage that never lands is not damage dealt.'
      },
      unrankable: militaryTally,
      // The unrankable rows themselves, so a caller can see WHICH candidate was
      // a downgrade rather than only how many were. Section 7: never a silent zero.
      unrankableItems: wantsFull
        ? militaryAll.filter(row => row.rankState !== RANK_STATES.ranked && row.rankState !== RANK_STATES.noResearchRequired)
        : militaryAll.filter(row => row.rankState !== RANK_STATES.ranked && row.rankState !== RANK_STATES.noResearchRequired).slice(0, groupLimit)
    },
    economic: {
      orderedBy: 'value per research point, per unit, inside one availability group',
      unitCaveat: 'units are never summed and never ranked against each other. Tonnes per month and '
        + 'dollars per year have no exchange rate.',
      candidatesConsidered: economicRanked.length + economicUnrankable.length,
      rankedCount: economicRanked.length,
      units: economicUnits,
      actionableGroups: economicUnits.flatMap(u => u.groups.filter(g => ACTIONABLE_GROUPS.includes(g.state))),
      aspirationalGroups: economicUnits.flatMap(u => u.groups.filter(g => ASPIRATIONAL_GROUPS.includes(g.state))),
      unrankable: economicTally,
      unrankableItems: wantsFull
        ? economicUnrankable
        : economicUnrankable.slice(0, groupLimit),
      // Phase 3's own coverage figure, carried through rather than restated:
      // most of what research does is not an economic flow, and hiding that
      // would make the economic ranking look more complete than it is.
      contextCoverage: economic.contextCoverage
        ? {
          pricedContextCount: economic.contextCoverage.pricedContextCount,
          unpricedContextCount: economic.contextCoverage.unpricedContextCount,
          coverageOfEffectReferences: economic.contextCoverage.coverageOfEffectReferences,
          coveragePercent: economic.contextCoverage.coverageOfEffectReferences === null
            ? null
            : round(economic.contextCoverage.coverageOfEffectReferences * 100, 1)
        }
        : null
    },
    filter: {
      limit: groupLimit,
      detail: wantsFull ? 'full' : 'summary',
      note: wantsFull
        ? null
        : `summary detail: the top ${groupLimit} rows per availability group per track, plus the full `
          + 'census of what could not be ranked. Add `detail=full` for every row in every group and every '
          + 'unrankable candidate.'
    },
    count: items.length,
    items
  };
};
