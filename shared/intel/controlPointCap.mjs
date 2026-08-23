// shared/intel/controlPointCap.mjs
//
// Purpose: /api/intel/control-point-cap — the control-point cap, maintenance
//   cost and headroom per faction, with the accuracy of each verdict stated,
//   naming the over-cap factions in either mode and counting separately the
//   rows the game's record bounds but does not locate.
//
// The composition follows the game's own methods, cited term by term in
// shared/controlPointCap.mjs, and it now reconciles against the game's own
// daily record to within about one point in eight hundred. So this endpoint
// answers rather than refuses — but each row says WHICH of two bases its
// headroom came from, because they are not equally strong:
//
//   * `recorded` — the save records a positive penalty, so the faction is over
//     cap by exactly three times it. Exact, and no composed cap is involved.
//   * `composed`  — every cap term and the whole cost were measured. The
//     composed cap was measured running ~1 point high on the one faction the
//     record pins, and `accuracy` carries that.
//
// A row still refuses when a term is unreadable, and refuses LOUDLY when the
// composition contradicts the record (a negative composed headroom while the
// game records zero cannot both be true).
//
// WHAT PLAYER MODE ANSWERS, AS OF THE OWNER'S 2026-08-22 INTEL-MODEL DECISION
// (recorded in the header of `shared/controlPointCap.mjs`): the `recorded`
// basis is published in every mode, because it composes nothing. So a rival the
// game records OVER CAP is named in player mode too, with its overage, its
// Influence bill and the bonus it hands hostile missions. A rival the game
// records at ZERO still refuses in player mode -- that zero is the floor of
// `max(0, cost - cap)`, so it bounds without locating, and the terms that would
// locate it (councilor attributes, hab modules, cap projects) are masked. Those
// rows are counted under `boundOnlyCount`, and their verdict is `unknown`, not
// `within-cap`.
//
// `?faction=` narrows to one faction. Without it every faction in the payload
// is reported.

import { asArray, sameId } from '../util.mjs';
import { DEFAULT_OBSERVER_FACTION_ID } from '../constants.mjs';
import {
  CONTROL_POINT_CAP_MEASURED_ON,
  CONTROL_POINT_CAP_SOURCES,
  CONTROL_POINT_CAP_ACCURACY,
  CONTROL_POINT_OVERAGE_PENALTY_MULTIPLIER,
  COST_FORMULA,
  RECORDED_POSITION,
  RECORDED_POSITION_NOTES,
  buildControlPointCapReport
} from '../controlPointCap.mjs';

/**
 * Projects the control-point cap resource.
 *
 * @param {object} snapshot filtered or raw snapshot
 * @param {object} options
 * @param {number|string} [options.observerId] the observer, used when no faction filter is given
 * @param {string} [options.mode] visibility mode, echoed onto each row
 * @param {number|string} [options.factionId] narrow to one faction
 */
export function controlPointCapResource(snapshot, options = {}) {
  const {
    observerId = DEFAULT_OBSERVER_FACTION_ID,
    mode = 'player',
    factionId = null
  } = options;

  const factions = asArray(snapshot?.factions);
  const selected = factionId === null || factionId === undefined || factionId === ''
    ? factions
    : factions.filter((f) => sameId(f?.ID, factionId));

  const items = selected.map((f) => buildControlPointCapReport(snapshot, { factionId: f?.ID, mode }));
  const composed = items.filter((item) => item.capacity.capAvailable);
  const refused = items.filter((item) => !item.capacity.capAvailable);
  const answered = items.filter((item) => item.headroom.available);
  const overCap = items.filter((item) => item.headroom.overCap === true);
  // Rows the game's record BOUNDS but does not LOCATE, and whose composed cap
  // could not supply the magnitude. Counted separately from `refusedCount`,
  // which is about the cap composition alone: these two overlap but are not the
  // same set, and a consumer that sees six refusals should be able to tell "the
  // record says they are not over cap, we just cannot say by how much" from
  // "nothing whatever is known".
  const boundOnly = items.filter((item) =>
    item.recorded.establishes === RECORDED_POSITION.boundOnly && !item.headroom.available);
  const observerRow = items.find((item) => sameId(item.factionId, observerId)) || null;
  // Narrowing with `?faction=` to somebody other than the observer used to
  // headline `unknown` beside a row that plainly said `over-cap`, because the
  // headline only ever spoke for the observer. It now speaks for whichever
  // faction the request is actually about, and NAMES which one -- a verdict
  // whose subject is ambiguous is worse than no verdict.
  const verdictRow = observerRow || (items.length === 1 ? items[0] : null);

  return {
    count: items.length,
    observerId,
    intelMode: mode,
    // The headline a consumer should read FIRST. Every other number on this
    // endpoint is downstream of it.
    verdict: verdictRow ? verdictRow.verdict : 'unknown',
    verdictReason: verdictRow
      ? verdictRow.verdictReason
      : 'this payload carries several factions and none of them is the observer, so no single headline verdict '
        + 'applies; read the per-faction rows',
    verdictFactionId: verdictRow ? verdictRow.factionId : null,
    verdictFactionName: verdictRow ? verdictRow.factionName : null,
    // The observer's own position, lifted out so a consumer does not have to
    // find its row. Null rather than 0 when it cannot be established, and null
    // rather than someone else's number when the observer is not in the payload.
    observerHeadroom: observerRow ? observerRow.headroom.value : null,
    observerHeadroomBasis: observerRow ? observerRow.headroom.basis : null,
    recordingSemantics: Object.freeze({
      field: 'TIFactionState.history_CPCapOverageByDay',
      windowDays: 32,
      ordering: 'newest first -- slot 0 is today, slot 31 is 31 days ago, one slot per in-game day',
      storedQuantity: 'max(0, maintenance cost - cap) x the overage multiplier, i.e. the MISSION-DEFENCE PENALTY',
      overageMultiplier: CONTROL_POINT_OVERAGE_PENALTY_MULTIPLIER,
      overageFromStored: 'overage = stored slot / 0.3333333432674408',
      appliedModifier: 'the mean of the whole window, not slot 0',
      // What each row's `recorded.establishes` value means, so a consumer can
      // read the classification without this module. A ZERO IS A FLOOR: it is
      // the single most misreadable number on this endpoint, because it looks
      // like a measurement of comfortable room and is not one.
      establishes: RECORDED_POSITION_NOTES,
      source: CONTROL_POINT_CAP_SOURCES.recording,
      measuredOn: CONTROL_POINT_CAP_MEASURED_ON
    }),
    accuracy: CONTROL_POINT_CAP_ACCURACY,
    costFormula: COST_FORMULA,
    sources: CONTROL_POINT_CAP_SOURCES,
    // Composed vs refused, so a consumer can see at a glance that player mode
    // answers for the observer and declines for every rival, rather than
    // finding a page of nulls and guessing why.
    composedCount: composed.length,
    answeredCount: answered.length,
    overCapCount: overCap.length,
    overCapFactions: Object.freeze(overCap.map((item) => Object.freeze({
      factionId: item.factionId,
      factionName: item.factionName,
      overage: item.recorded.overage,
      influencePerYear: item.penalties.influencePerYearFromRecorded
    }))),
    refusedCount: refused.length,
    refusedFactions: Object.freeze(refused.map((item) => Object.freeze({
      factionId: item.factionId,
      factionName: item.factionName,
      reason: item.capacity.capReason
    }))),
    // Bounded, not located. These are NOT "within cap" -- see `recordingSemantics.establishes`.
    boundOnlyCount: boundOnly.length,
    boundOnlyFactions: Object.freeze(boundOnly.map((item) => Object.freeze({
      factionId: item.factionId,
      factionName: item.factionName,
      reason: item.headroom.reason
    }))),
    items
  };
}

export default { controlPointCapResource };
