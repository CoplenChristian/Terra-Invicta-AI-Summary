// shared/intel/controlPointCap.mjs
//
// Purpose: /api/intel/control-point-cap — the control-point cap, maintenance
//   cost and headroom per faction, with the accuracy of each verdict stated.
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
// `?faction=` narrows to one faction. Without it every faction in the payload
// is reported, which in player mode means the observer's own row composes and
// every rival's row refuses -- a rival's cap depends on their councilor
// attributes, and those are masked.

import { asArray, sameId } from '../util.mjs';
import { DEFAULT_OBSERVER_FACTION_ID } from '../constants.mjs';
import {
  CONTROL_POINT_CAP_MEASURED_ON,
  CONTROL_POINT_CAP_SOURCES,
  CONTROL_POINT_CAP_ACCURACY,
  CONTROL_POINT_OVERAGE_PENALTY_MULTIPLIER,
  COST_FORMULA,
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
  const observerRow = items.find((item) => sameId(item.factionId, observerId)) || null;

  return {
    count: items.length,
    observerId,
    intelMode: mode,
    // The headline a consumer should read FIRST. Every other number on this
    // endpoint is downstream of it.
    verdict: observerRow ? observerRow.verdict : 'unknown',
    verdictReason: observerRow
      ? observerRow.verdictReason
      : 'the observer faction is not present in this payload, so no headroom verdict is emitted for it',
    // The observer's own position, lifted out so a consumer does not have to
    // find its row. Null rather than 0 when it cannot be established.
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
    items
  };
}

export default { controlPointCapResource };
