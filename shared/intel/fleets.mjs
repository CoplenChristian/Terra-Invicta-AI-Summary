// shared/intel/fleets.mjs
//
// Fleets, the ships inside them, inbound arrivals, and the orbital transfers
// derived from fleet movement. `transfersResource` lives here rather than in
// `theaters.mjs` because it is a projection OF the fleet list; theaters and
// body-status are two of its consumers.

import { MS_PER_DAY, asArray, sameId } from '../util.mjs';
import { bodyMatches, destinationMatches, factionMatches, normalizeBody } from './common.mjs';

export const fleetResourceRow = (fleet) => ({
  id: fleet.ID,
  name: fleet.displayName,
  factionId: fleet.factionId,
  factionName: fleet.factionName,
  mission: fleet.mission,
  inCombat: fleet.inCombat ?? false,
  orbitBody: fleet.orbitBody,
  spaceTheaterKey: fleet.spaceTheaterKey,
  spaceTheaterName: fleet.spaceTheaterName,
  visibility: fleet.visibility || null,
  distanceAU: fleet.orbitBodyDistanceAU,
  destination: fleet.destination,
  arrivalDate: fleet.arrivalDate,
  ships: fleet.shipsCount ?? 0,
  combatPower: fleet.combatPower ?? null,
  combatPowerAvailable: fleet.combatPowerAvailable ?? false,
  combatPowerSource: fleet.combatPowerSource,
  dominantWeaponType: fleet.dominantWeaponType,
  weaponSummary: fleet.weaponSummary,
  weaponBreakdown: fleet.weaponBreakdown,
  shipManifest: asArray(fleet.ships).map(ship => shipResourceRow(ship, fleet)),
  lowestDeltaVKps: fleet.lowestDeltaVKps ?? null,
  lowestCombatAccelerationMps2: fleet.lowestCombatAccelerationMps2 ?? null,
  armorMedian: fleet.armorMedian ?? null,
  currentOrders: fleet.currentOrders || null,
  destinationType: fleet.destinationType || null,
  destinationId: fleet.destinationId || null,
  insideSaturnOrbit: fleet.insideSaturnOrbit ?? false
});

export const shipResourceRow = (ship, fleet) => ({
  id: ship.id,
  name: ship.displayName,
  hullName: ship.hullName,
  factionId: fleet.factionId,
  factionName: fleet.factionName,
  fleetId: fleet.ID,
  fleetName: fleet.displayName,
  mission: fleet.mission,
  orbitBody: fleet.orbitBody,
  spaceTheaterKey: fleet.spaceTheaterKey,
  spaceTheaterName: fleet.spaceTheaterName,
  visibility: fleet.visibility || null,
  distanceAU: fleet.orbitBodyDistanceAU,
  destination: fleet.destination,
  combatPower: ship.combatPower ?? null,
  combatPowerSource: ship.combatPowerSource,
  dominantWeaponType: ship.dominantWeaponType,
  weaponLoadout: ship.weaponLoadout,
  currentDeltaVKps: ship.currentDeltaVKps ?? null,
  currentMaxDeltaVKps: ship.currentMaxDeltaVKps ?? null,
  cruiseAccelerationMps2: ship.cruiseAccelerationMps2 ?? null,
  combatAccelerationMps2: ship.combatAccelerationMps2 ?? null,
  currentMassKg: ship.currentMassKg ?? null,
  missionControlConsumption: ship.missionControlConsumption ?? null,
  propellantTons: ship.propellantTons ?? null,
  armor: ship.armor || null,
  armorMedian: ship.armorMedian ?? null
});

export const shipResourceRows = (fleets, factionId, body) => fleets
  .filter(fleet => factionMatches(fleet, factionId) && bodyMatches(fleet, body))
  .flatMap(fleet => asArray(fleet.ships).map(ship => shipResourceRow(ship, fleet)));

export const friendlyStrengthAtDestination = (fleet, snapshot) => {
  const destinationBody = normalizeBody(String(fleet.destination || '').replace(/\s+orbit$/i, ''));
  if (!destinationBody || destinationBody === normalizeBody('in transit')) return null;
  const observerFactionId = snapshot?.observerFactionId;
  if (observerFactionId === null || observerFactionId === undefined) return null;
  const friendlyFleets = asArray(snapshot.fleets).filter(other =>
    sameId(other.factionId, observerFactionId) && normalizeBody(other.orbitBody) === destinationBody
  );
  const currentShips = friendlyFleets.reduce((sum, other) => sum + (Number(other.shipsCount) || 0), 0);
  const combatValues = friendlyFleets
    .map(other => other.combatPower)
    .filter(value => typeof value === 'number' && Number.isFinite(value));
  const completingShips = asArray(snapshot.shipyardQueues).filter(queue =>
    sameId(queue.factionId, observerFactionId) && normalizeBody(queue.orbitBody) === destinationBody
  ).length;
  return {
    currentShips,
    completingShips,
    expectedShips: currentShips + completingShips,
    currentCombatPower: combatValues.length ? combatValues.reduce((sum, value) => sum + value, 0) : null,
    combatPowerAvailable: combatValues.length > 0,
    source: 'current friendly assets plus save-backed shipyard queue',
    futureReinforcementSimulation: false
  };
};

export const arrivalResourceRow = (fleet, friendlyStrength = null) => ({
  fleetId: fleet.ID,
  fleetName: fleet.displayName,
  factionId: fleet.factionId,
  factionName: fleet.factionName,
  currentLocation: fleet.orbitBody,
  destination: fleet.destination,
  destinationType: fleet.destinationType,
  destinationId: fleet.destinationId,
  arrivalDate: fleet.arrivalDate,
  ships: fleet.shipsCount ?? 0,
  combatPower: fleet.combatPower ?? null,
  combatPowerAvailable: fleet.combatPowerAvailable ?? false,
  dominantWeaponType: fleet.dominantWeaponType,
  weaponBreakdown: fleet.weaponBreakdown,
  inCombat: fleet.inCombat ?? false,
  friendlyStrengthAtDestination: friendlyStrength
});

export const transferResourceRow = (transfer) => ({
  id: transfer.id,
  sourceFactionId: transfer.sourceFactionId,
  sourceFactionName: transfer.sourceFactionName,
  targetFactionId: transfer.targetFactionId,
  targetFactionName: transfer.targetFactionName,
  resource: transfer.resource,
  amountPerDay: transfer.amountPerDay,
  expiry: transfer.expiry
});

/**
 * 3. Transfers: Fleet orbital transfers with origin, destination, arrival dates,
 * and days remaining.
 */
export const transfersResource = (snapshot, factionId = null, body = null, destination = null) => {
  const gameDate = snapshot.metadata?.gameTimeString ? new Date(snapshot.metadata.gameTimeString) : null;
  const items = [];

  asArray(snapshot.fleets).forEach(f => {
    const isMoving = f.destination || f.arrivalDate || (f.currentOrders && String(f.currentOrders).toLowerCase().includes('transfer'));
    if (!isMoving) return;
    if (!factionMatches(f, factionId)) return;
    if (body && !bodyMatches(f, body)) return;
    if (destination && !destinationMatches(f, destination)) return;

    const arrivalDate = f.arrivalDate;
    let daysRemaining = null;
    if (arrivalDate && gameDate && !Number.isNaN(gameDate.getTime())) {
      const arr = new Date(arrivalDate);
      if (!Number.isNaN(arr.getTime())) {
        daysRemaining = Math.max(0, Math.round((arr - gameDate) / MS_PER_DAY));
      }
    }

    items.push({
      faction: f.factionName,
      factionId: f.factionId,
      fleet: f.displayName,
      fleetId: f.ID,
      origin: f.orbitBody || 'Unknown',
      destination: f.destination || 'In Transit',
      destinationType: f.destinationType || null,
      departure: f.launchDate || f.departureDate || null,
      arrival: arrivalDate || null,
      daysRemaining,
      shipCount: f.shipsCount || (Array.isArray(f.ships) ? f.ships.length : 0),
      mission: f.mission || f.currentOrders || 'Transfer',
      combatPower: f.combatPower ?? null,
      dominantWeaponType: f.dominantWeaponType || null
    });
  });

  items.sort((a, b) => (a.daysRemaining ?? 9999) - (b.daysRemaining ?? 9999));
  return items;
};
