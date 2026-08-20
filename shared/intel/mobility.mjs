// shared/intel/mobility.mjs
//
// Fleet transfer feasibility. Its destination table is a heuristic estimate
// (`isEstimate: true` on every response), which is why it is kept apart from
// the measured fleet projections in `fleets.mjs`.

import { DEFAULT_OBSERVER_FACTION_ID } from '../constants.mjs';
import { MS_PER_DAY, asArray, toFiniteNumber as toFinite, sameId } from '../util.mjs';
import { normalizeBody } from './common.mjs';

/**
 * 10. Mobility: Fleet transfer feasibility and travel-time estimates.
 */
export const mobilityResource = (snapshot, fleetId, observerId = DEFAULT_OBSERVER_FACTION_ID) => {
  const fleets = asArray(snapshot.fleets);

  // A fleet id that does not resolve is an ERROR, not an invitation to answer
  // about some other fleet. The previous fallback chain silently substituted
  // the first observer fleet -- and then the first fleet in the snapshot --
  // so `?fleet=<typo>` returned confident delta-V, travel times and arrival
  // dates for a fleet the caller had never heard of, labelled with that
  // fleet's own id so the substitution was invisible.
  if (fleetId === null || fleetId === undefined || String(fleetId).trim() === '') {
    return {
      error: 'A fleet id is required. Mobility is fleet-specific; there is no meaningful default.',
      requestedFleetId: null,
      fleetId: null,
      availableFleetIds: fleets
        .filter(f => sameId(f.factionId, observerId))
        .map(f => f.ID),
      transfers: [],
      items: []
    };
  }

  const fleet = fleets.find(f => sameId(f.ID, fleetId));
  if (!fleet) {
    return {
      error: `Fleet ${fleetId} not found in this snapshot.`,
      requestedFleetId: fleetId,
      fleetId: null,
      availableFleetIds: fleets
        .filter(f => sameId(f.factionId, observerId))
        .map(f => f.ID),
      transfers: [],
      items: []
    };
  }

  const currentBody = fleet.orbitBody || null;

  // Absent stays null. `fleet.lowestDeltaVKps || 25.0` invented a 25 km/s
  // budget for an unmeasured fleet, and the feasibility verdict below is a
  // direct comparison against it -- an unknown fleet would have been declared
  // capable of reaching Titan.
  const fleetDv = toFinite(fleet.lowestDeltaVKps);
  const fleetAccel = toFinite(fleet.lowestCombatAccelerationMps2);

  const destinations = [
    { name: 'Earth', baseDv: 6.5, baseDays: 75 },
    { name: 'Luna', baseDv: 2.1, baseDays: 5 },
    { name: 'Mars', baseDv: 9.8, baseDays: 160 },
    { name: 'Ceres', baseDv: 14.2, baseDays: 450 },
    { name: 'Vesta', baseDv: 13.5, baseDays: 420 },
    { name: 'Mercury', baseDv: 16.0, baseDays: 110 },
    { name: 'Venus', baseDv: 8.4, baseDays: 95 },
    { name: 'Ganymede', baseDv: 22.0, baseDays: 750 },
    { name: 'Callisto', baseDv: 21.0, baseDays: 730 },
    { name: 'Titan', baseDv: 28.0, baseDays: 1100 }
  ];

  const gameDate = snapshot.metadata?.gameTimeString ? new Date(snapshot.metadata.gameTimeString) : new Date();

  const transferOptions = destinations
    .filter(d => !currentBody || normalizeBody(d.name) !== normalizeBody(currentBody))
    .map(d => {
      const dvRequired = Number(d.baseDv.toFixed(1));
      // Travel time scales with acceleration; without it the duration is
      // unknown rather than "the book value".
      const travelDays = fleetAccel === null
        ? null
        : Math.round(d.baseDays / Math.max(0.5, Math.min(2.0, fleetAccel)));
      const arrivalDate = travelDays === null
        ? null
        : new Date(gameDate.getTime() + travelDays * MS_PER_DAY).toISOString().split('T')[0];

      // Tri-state: true / false / null. A check that cannot be evaluated must
      // report unknown, never fall through to "feasible".
      const feasible = fleetDv === null ? null : fleetDv >= dvRequired;
      let warning = null;
      if (feasible === null) {
        warning = 'delta-V UNAVAILABLE for this fleet — feasibility cannot be evaluated';
      } else if (!feasible) {
        warning = `insufficient delta-V (${fleetDv.toFixed(1)} km/s available vs ${dvRequired} required)`;
      } else if (travelDays !== null && travelDays > 365) {
        warning = 'strategically impractical — long transfer duration';
      }

      return {
        destination: d.name,
        deltaVRequired: dvRequired,
        travelDays,
        propellantCostTons: Math.round(dvRequired * 12),
        arrivalDate,
        feasible,
        warning
      };
    });

  return {
    fleetId: fleet.ID,
    requestedFleetId: fleetId,
    fleetName: fleet.displayName,
    factionId: fleet.factionId,
    currentLocation: currentBody,
    fleetDeltaVKps: fleetDv,
    fleetCombatAccelerationMps2: fleetAccel,
    performanceMeasured: fleetDv !== null && fleetAccel !== null,
    isEstimate: true,
    transfers: transferOptions
  };
};
