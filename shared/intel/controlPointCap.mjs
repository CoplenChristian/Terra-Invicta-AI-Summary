// shared/intel/controlPointCap.mjs
//
// Purpose: /api/intel/control-point-cap — the composed control-point cap and
//   maintenance cost per faction, with the reconciliation failure stated.
//
// This endpoint reports a MODEL, not a measurement, and says so on every row.
// The composition is cited term by term in shared/controlPointCap.mjs; the
// absolute cap it produces disagrees with the only figure the game records, so
// `headroom.available` is false everywhere and `verdict` is 'unresolved'.
//
// Nothing here may be read as "there is room for another control point". It
// exists so a reader can see WHICH councilor and WHICH project their cap is
// made of -- a councilor dying changes it -- and what one more control point in
// a given nation would cost, which is the one figure that does not depend on
// the unreconciled base.
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
  BASE_CAP_UNRESOLVED,
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

  return {
    count: items.length,
    observerId,
    intelMode: mode,
    // The headline a consumer should read FIRST. Every other number on this
    // endpoint is downstream of it.
    verdict: 'unresolved',
    verdictReason: 'the composed cap does not reconcile against the save\'s own recorded overage, so no faction\'s '
      + 'headroom is emitted and nothing here may gate a decision about taking another control point',
    reconciliationEvidence: Object.freeze({
      measuredOn: CONTROL_POINT_CAP_MEASURED_ON,
      note: 'On ExitSave.gz (1/1/2035) the Protectorate models a cap of 992 against a maintenance cost of 872.47, '
        + 'i.e. no overage, while the save records an overage of 10.02. On CombatAutosave.gz (7/15/2034) the same '
        + 'faction records 5.16. Between the two saves the modelled cap moves by 2 and the cap implied by the '
        + 'recordings moves by 14.09, and no cost exponent reconciles both (solving the pair gives p = 0.5041 with '
        + 'a base cap of -88).'
    }),
    baseCapAmbiguity: BASE_CAP_UNRESOLVED,
    costFormula: COST_FORMULA,
    sources: CONTROL_POINT_CAP_SOURCES,
    // Composed vs refused, so a consumer can see at a glance that player mode
    // answers for the observer and declines for every rival, rather than
    // finding a page of nulls and guessing why.
    composedCount: composed.length,
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
