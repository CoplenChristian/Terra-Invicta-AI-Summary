// shared/intel/fleets.mjs
//
// Purpose: fleets, the ships inside them, inbound arrivals, and the orbital
//   transfers derived from fleet movement.
//
// Fleets, the ships inside them, inbound arrivals, and the orbital transfers
// derived from fleet movement. `transfersResource` lives here rather than in
// `theaters.mjs` because it is a projection OF the fleet list; theaters and
// body-status are two of its consumers.

import { MS_PER_DAY, asArray, sameId } from '../util.mjs';
import { bodyMatches, combatPowerTotal, destinationMatches, factionMatches, normalizeBody } from './common.mjs';

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

// ---------------------------------------------------------------------------
// detail=summary
//
// `/api/intel/fleets` and `/api/intel/ships` were the only two focused
// endpoints an external analysis client could not consume: 909 KB and 766 KB
// respectively, on one line, against a 25 KB-ish median for the rest. Both are
// dominated by per-SHIP payload -- `shipManifest` alone is 84% of the fleets
// response, and `weaponLoadout` + `armor` are 37% of the ships response.
//
// So the shape of the fix follows the shape of the weight: `detail=summary`
// (the default) answers "what exists and where" and `detail=full` keeps the
// exact per-entity payload that was there before. `full` is byte-identical to
// the pre-change response, so an existing consumer restores its old contract by
// appending one query parameter.
//
// Both summaries state what they left out rather than silently truncating.
// ---------------------------------------------------------------------------

/** Per-fleet fields that only `detail=full` carries. Reported, not implied. */
export const FLEET_SUMMARY_OMITTED_FIELDS = Object.freeze([
  'shipManifest', 'weaponBreakdown', 'weaponSummary', 'dominantWeaponType',
  'currentOrders', 'destinationType', 'destinationId', 'spaceTheaterKey',
  'spaceTheaterName', 'distanceAU', 'insideSaturnOrbit', 'inCombat',
  'combatPowerSource', 'lowestDeltaVKps', 'lowestCombatAccelerationMps2',
  'armorMedian', 'factionName'
]);

/**
 * factionId -> displayName for the rows in this projection.
 *
 * Repeating `factionName` on every row cost 9 KB across a 324-row ship roll-up,
 * which is a quarter of the entire size budget spent restating eight strings.
 * The legend is built from the SAME set the rows describe, so an id in `items`
 * always resolves here and no faction the caller cannot see is disclosed.
 */
const factionLegend = (fleets) => {
  const names = new Map();
  for (const fleet of asArray(fleets)) {
    if (fleet.factionId === null || fleet.factionId === undefined) continue;
    if (!names.has(fleet.factionId)) names.set(fleet.factionId, fleet.factionName ?? null);
  }
  return Array.from(names, ([id, name]) => ({ id, name }));
};

/** Per-ship fields that only `detail=full` carries. */
export const SHIP_SUMMARY_OMITTED_FIELDS = Object.freeze([
  'id', 'name', 'weaponLoadout', 'armor', 'armorMedian', 'combatPower',
  'combatPowerSource', 'dominantWeaponType', 'currentDeltaVKps',
  'currentMaxDeltaVKps', 'cruiseAccelerationMps2', 'combatAccelerationMps2',
  'currentMassKg', 'missionControlConsumption', 'propellantTons',
  'fleetName', 'factionName', 'mission', 'destination', 'distanceAU',
  'spaceTheaterKey', 'spaceTheaterName', 'visibility'
]);

/**
 * One fleet, without the per-ship payload.
 *
 * `visibility` is kept deliberately: in player mode it is how the caller knows
 * WHY a hostile fleet is on the board, which is the single most load-bearing
 * field in a redacted view.
 */
export const fleetSummaryRow = (fleet) => ({
  id: fleet.ID,
  name: fleet.displayName,
  factionId: fleet.factionId,
  mission: fleet.mission,
  orbitBody: fleet.orbitBody,
  visibility: fleet.visibility || null,
  destination: fleet.destination,
  arrivalDate: fleet.arrivalDate,
  ships: fleet.shipsCount ?? 0,
  combatPower: fleet.combatPower ?? null,
  combatPowerAvailable: fleet.combatPowerAvailable ?? false
});

/**
 * The fleet manifest projection.
 *
 * Totals are aggregates over the SAME filtered set the rows describe, so a
 * caller can check `shipsTotal` against the rows without a second request.
 */
export const fleetSummaryProjection = (fleets) => {
  const rows = asArray(fleets);
  const power = combatPowerTotal(rows);
  return {
    count: rows.length,
    items: rows.map(fleetSummaryRow),
    detail: 'summary',
    factions: factionLegend(rows),
    fleetsTotal: rows.length,
    shipsTotal: rows.reduce((sum, fleet) => sum + (fleet.shipsCount ?? 0), 0),
    combatPowerTotal: power.total,
    combatPowerAvailable: power.available,
    combatPowerSource: power.source,
    omittedInSummary: FLEET_SUMMARY_OMITTED_FIELDS
  };
};

/**
 * The ship manifest projection: a roll-up, not a per-ship list.
 *
 * This is the one place the two endpoints diverge in shape, and the reason is
 * arithmetic rather than taste. There are 698 ships in this save; the leanest
 * per-ship row that still identifies a ship AND its owner measures ~108 bytes,
 * so ANY per-ship list lands at 75 KB or more -- nearly double the 40 KB the
 * default has to fit inside. Grouping by faction x hull x body answers the
 * question a manifest is actually asked ("who has what, and where") in 33 KB,
 * and `detail=full` still returns every ship.
 *
 * `count` counts the ROWS, per the envelope contract that `count === items.length`
 * everywhere. `shipsTotal` is the ship count, and `groupedBy` names the grouping
 * so the difference cannot be mistaken for a truncation.
 */
export const shipSummaryProjection = (fleets, factionId, body) => {
  const matching = asArray(fleets).filter(fleet => factionMatches(fleet, factionId) && bodyMatches(fleet, body));
  const groups = new Map();
  const ships = [];

  for (const fleet of matching) {
    for (const ship of asArray(fleet.ships)) {
      ships.push(ship);
      // `hullName` may legitimately be absent; null is a distinct group, never
      // folded into a neighbouring hull class or dropped from the count.
      const hullName = ship.hullName ?? null;
      // JSON, not a joined string: a hull name or body name containing the
      // separator would otherwise merge two distinct groups into one, and the
      // ship counts would be wrong in a way nothing downstream could detect.
      const key = JSON.stringify([fleet.factionId, hullName, fleet.orbitBody]);
      let group = groups.get(key);
      if (!group) {
        group = {
          factionId: fleet.factionId,
          hullName,
          orbitBody: fleet.orbitBody,
          ships: 0,
          fleets: new Set()
        };
        groups.set(key, group);
      }
      group.ships += 1;
      group.fleets.add(fleet.ID);
    }
  }

  const items = Array.from(groups.values()).map(group => ({
    factionId: group.factionId,
    hullName: group.hullName,
    orbitBody: group.orbitBody,
    ships: group.ships,
    fleets: group.fleets.size
  }));
  const power = combatPowerTotal(ships);

  return {
    count: items.length,
    items,
    detail: 'summary',
    factions: factionLegend(matching),
    groupedBy: ['factionId', 'hullName', 'orbitBody'],
    shipsTotal: ships.length,
    combatPowerTotal: power.total,
    combatPowerAvailable: power.available,
    combatPowerSource: power.source,
    omittedInSummary: SHIP_SUMMARY_OMITTED_FIELDS
  };
};

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
