// shared/intel/theaters.mjs
//
// Purpose: body-by-body posture — the twelve-body theater board, the hostile
//   movement that lands outside it, and the single-body briefing behind both.
//
// Body-by-body posture: the twelve-body theater board and the single-body
// briefing behind it. Both read the same fleet/hab/site/queue lists and answer
// "who holds this rock, and what is coming for it".
//
// TWELVE BODIES IS NOT THE WHOLE BOARD. Every hostile movement in the live save
// is headed somewhere else -- 16 Psyche, Himalia, Miranda, Triton, 30 Urania,
// Rhea, 433 Eros -- so a twelve-row table alone shows an empty threat picture
// while thirteen hostile fleets are under way. `hostileMovement` is the bucket
// for exactly that, and it exists so a consumer can tell "nothing is moving"
// from "everything is moving somewhere this board does not track". Those are
// completely different situations and they must not render alike.

import { DEFAULT_OBSERVER_FACTION_ID } from '../constants.mjs';
import { asArray, sameId } from '../util.mjs';
import { combatPowerTotal, findAlienFaction, normalizeBody } from './common.mjs';
import { buildDestinationIndex, resolveTransferDestination } from './destinations.mjs';
import { fleetResourceRow, transfersResource } from './fleets.mjs';
import { habResourceRow } from './habs.mjs';
import { miningResourceRow } from './mining.mjs';

/**
 * Days of warning below which an inbound hostile force is called imminent.
 *
 * A judgement call in this repo's own presentation layer, not a game rule --
 * roughly one campaign quarter, the horizon inside which a shipyard queue can
 * still plausibly change the outcome. Named because a bare `<= 120` in a
 * status ladder gives the reader no way to tell a tuned threshold from a
 * measured one.
 */
const THREAT_IMMINENT_WINDOW_DAYS = 120;

/**
 * Cap on the per-row hostile-movement list, with the omitted count reported
 * beside it. Thirteen rows exist in the live save, so this has never fired;
 * it is here because a capped list that does not announce its cap is the same
 * defect class as fabricating the entries it dropped.
 */
const HOSTILE_MOVEMENT_ROW_LIMIT = 100;

const THEATER_BODIES = Object.freeze([
  'Earth', 'Luna', 'Mars', 'Ceres', 'Vesta', 'Mercury',
  'Venus', 'Ganymede', 'Callisto', 'Europa', 'Io', 'Titan'
]);

/**
 * What the whole-board hostile-movement summary is claiming, in one field.
 *
 * The counts below it are authoritative; this names the strongest claim they
 * support, so a consumer that reads one field still gets the right answer.
 * `PARTLY_UNRESOLVED` outranks `NONE_TOWARD_TRACKED_THEATERS` deliberately:
 * with an unresolved destination in the set, "none of it is coming here" is
 * not a claim the data supports, and an unevaluable check must say so rather
 * than fall through to the reassuring answer.
 */
export const HOSTILE_MOVEMENT_STATE = Object.freeze({
  none: 'NO_HOSTILE_MOVEMENT_OBSERVED',
  inbound: 'INBOUND_TO_TRACKED_THEATER',
  partlyUnresolved: 'HOSTILE_MOVEMENT_DESTINATIONS_PARTLY_UNRESOLVED',
  elsewhere: 'HOSTILE_MOVEMENT_NONE_TOWARD_TRACKED_THEATERS'
});

const finiteOrNull = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/**
 * Soonest measured arrival first, unknown arrivals last.
 *
 * Written as an explicit null-last comparator rather than by substituting a
 * large stand-in for the missing day count. The stand-in this file used to
 * carry (`UNKNOWN_ARRIVAL_SORT_DAYS = 999`) was documented as sort-only and
 * then read by `Math.min` into a REPORTED `nearestArrivalDays` and by a `<=`
 * that produced `shipsCompletingBeforeThreatArrival`. An unknown arrival time
 * is not a distant one, and the only way that stays true is for the placeholder
 * not to exist.
 */
const bySoonestKnownArrival = (a, b) => {
  const left = finiteOrNull(a.daysRemaining);
  const right = finiteOrNull(b.daysRemaining);
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
};

const shipsIn = (movements) => movements.reduce((sum, m) => {
  const count = finiteOrNull(m.transfer.shipCount);
  return sum + (count === null ? 0 : count);
}, 0);

const movementRow = (movement, trackedTheater) => ({
  faction: movement.transfer.faction,
  factionId: movement.transfer.factionId,
  fleet: movement.transfer.fleet,
  fleetId: movement.transfer.fleetId,
  shipCount: finiteOrNull(movement.transfer.shipCount),
  origin: movement.transfer.origin,
  statedDestination: movement.transfer.destination,
  destinationType: movement.transfer.destinationType,
  resolvedBody: movement.resolution.body,
  resolutionMethod: movement.resolution.method,
  resolved: movement.resolution.resolved,
  unresolvedReason: movement.resolution.reason,
  // The hop-by-hop derivation, so a reader can audit "this fleet is inbound to
  // Earth" back to the hab it is actually aimed at.
  via: movement.resolution.via,
  trackedTheater,
  daysRemaining: finiteOrNull(movement.transfer.daysRemaining),
  arrival: movement.transfer.arrival ?? null
});

const nearestArrival = (movements) => {
  const soonest = movements.reduce((best, m) => {
    const days = finiteOrNull(m.transfer.daysRemaining);
    if (days === null) return best;
    if (best === null || days < finiteOrNull(best.transfer.daysRemaining)) return m;
    return best;
  }, null);
  return {
    // Absent stays null. When nothing inbound carries an arrival date, there is
    // no nearest arrival -- not a far-off one.
    days: soonest === null ? null : finiteOrNull(soonest.transfer.daysRemaining),
    date: soonest === null ? null : (soonest.transfer.arrival ?? null),
    timingUnknownCount: movements.filter(m => finiteOrNull(m.transfer.daysRemaining) === null).length
  };
};

const summariseHostileMovement = (hostileMovements, trackedBodyKeys) => {
  const toward = [];
  const elsewhere = [];
  const unresolved = [];
  for (const movement of hostileMovements) {
    if (!movement.resolution.resolved) unresolved.push(movement);
    else if (trackedBodyKeys.has(movement.resolution.normalizedBody)) toward.push(movement);
    else elsewhere.push(movement);
  }

  const offBoard = [...elsewhere, ...unresolved]
    .map(m => movementRow(m, false))
    .sort(bySoonestKnownArrival);

  const arrival = nearestArrival(hostileMovements);

  let state = HOSTILE_MOVEMENT_STATE.none;
  if (toward.length > 0) state = HOSTILE_MOVEMENT_STATE.inbound;
  else if (unresolved.length > 0) state = HOSTILE_MOVEMENT_STATE.partlyUnresolved;
  else if (elsewhere.length > 0) state = HOSTILE_MOVEMENT_STATE.elsewhere;

  return {
    state,
    observed: { transfers: hostileMovements.length, ships: shipsIn(hostileMovements) },
    towardTrackedTheaters: { transfers: toward.length, ships: shipsIn(toward) },
    towardUntrackedBodies: { transfers: elsewhere.length, ships: shipsIn(elsewhere) },
    unresolvedDestinations: { transfers: unresolved.length, ships: shipsIn(unresolved) },
    // The three buckets partition the observed set; a consumer that adds them
    // up and gets a different number has found a bug, not a rounding.
    reconciles: toward.length + elsewhere.length + unresolved.length === hostileMovements.length,
    nearestArrivalDays: arrival.days,
    nearestArrivalDate: arrival.date,
    arrivalTimingUnknownTransfers: arrival.timingUnknownCount,
    // What "tracked" means, spelled out, so a reader does not have to infer the
    // board's twelve bodies from the rows that happen to be non-empty.
    trackedBodies: [...THEATER_BODIES],
    offBoardDestinations: offBoard.slice(0, HOSTILE_MOVEMENT_ROW_LIMIT),
    offBoardDestinationsTotalCount: offBoard.length,
    offBoardDestinationsOmittedCount: Math.max(0, offBoard.length - HOSTILE_MOVEMENT_ROW_LIMIT)
  };
};

/**
 * The whole board: the twelve theaters and the hostile movement that misses
 * all of them.
 */
export const theaterBoardResource = (snapshot, observerId = DEFAULT_OBSERVER_FACTION_ID) => {
  const bodies = [...THEATER_BODIES];
  const fleets = asArray(snapshot.fleets);
  const habs = asArray(snapshot.habs);
  const sites = asArray(snapshot.habSites);
  const queues = asArray(snapshot.shipyardQueues);
  const stations = asArray(snapshot.shipyardStations);
  const transfers = transfersResource(snapshot);

  const alienFaction = findAlienFaction(snapshot);
  const alienId = alienFaction?.ID;

  // Written out twice below -- once against a fleet's `factionName` and once
  // against a transfer's `faction` -- so the two spellings of the same test
  // could drift apart. The name substring stays because the Servants are not
  // resolved to an id anywhere in this projection; only the field name differs
  // between the two call sites, which is exactly what the parameter is for.
  const isHostile = (factionId, factionLabel) => sameId(factionId, alienId) ||
    (Boolean(factionLabel) && String(factionLabel).toLowerCase().includes('servant'));

  // Resolved once for the whole board rather than per body: twelve passes over
  // the same eighteen transfers would resolve every rendezvous chain twelve
  // times and, worse, could resolve them twelve different ways if the resolver
  // ever grew state.
  const destinationIndex = buildDestinationIndex(snapshot);
  const movements = transfers.map(transfer => ({
    transfer,
    hostile: isHostile(transfer.factionId, transfer.faction),
    resolution: resolveTransferDestination(transfer, destinationIndex)
  }));
  const hostileMovements = movements.filter(m => m.hostile);
  const trackedBodyKeys = new Set(bodies.map(normalizeBody));

  const theaters = bodies.map(bodyName => {
    const norm = normalizeBody(bodyName);
    const bodyFleets = fleets.filter(f => normalizeBody(f.orbitBody) === norm);
    const bodyHabs = habs.filter(h => normalizeBody(h.orbitBody) === norm);
    const bodySites = sites.filter(s => normalizeBody(s.parentBodyName) === norm);
    const bodyQueues = queues.filter(q => normalizeBody(q.orbitBody) === norm);
    const bodyStations = stations.filter(s => normalizeBody(s.orbitBody) === norm);

    const friendlyFleets = bodyFleets.filter(f => sameId(f.factionId, observerId));
    const hostileFleets = bodyFleets.filter(f => isHostile(f.factionId, f.factionName));

    const friendlyShips = friendlyFleets.reduce((sum, f) => sum + (f.shipsCount || 0), 0);
    const hostileShips = hostileFleets.reduce((sum, f) => sum + (f.shipsCount || 0), 0);
    const friendlyCP = combatPowerTotal(friendlyFleets);
    const hostileCP = combatPowerTotal(hostileFleets);

    const friendlyHabs = bodyHabs.filter(h => sameId(h.factionId, observerId)).length;
    // Read from `shipyardStations`, the collection `/api/intel/shipyards`
    // serves, NOT from the hab record. A hab row carries neither `isShipyard`
    // nor `shipyardCount` -- both spellings are absent from all 177 habs in the
    // save -- so `(h.isShipyard || h.shipyardCount > 0)` could never be true and
    // this counter was a structural, permanent 0 for every body in both modes.
    const friendlyYards = bodyStations.filter(s => sameId(s.factionId, observerId)).length;
    const friendlyMines = bodySites.filter(s => sameId(s.factionId, observerId) && s.mineModuleName).length;

    // Incoming hostile transfers, matched on the RESOLVED body rather than on
    // the destination's literal name. `normalizedBody` is null on an unresolved
    // destination and `norm` never is, so an unresolved destination cannot
    // accidentally match a theater.
    const incomingHostile = hostileMovements.filter(m => m.resolution.normalizedBody === norm);
    const incomingHostileShips = shipsIn(incomingHostile);
    const arrival = nearestArrival(incomingHostile);
    const nearestArrivalDays = arrival.days;

    const observerQueues = bodyQueues.filter(q => sameId(q.factionId, observerId));
    const timedQueues = observerQueues.filter(q => finiteOrNull(q.daysToCompletion) !== null);
    const untimedQueueCount = observerQueues.length - timedQueues.length;

    // "How many hulls land before they do" is a race between two clocks, and it
    // is only answerable when both are on the clock face. An inbound force with
    // no arrival date on record makes the comparison UNEVALUABLE -- the old
    // code answered it anyway, by treating a missing arrival as 999 days and a
    // missing completion date as 999 days, which reported every queued hull as
    // finishing in time. That is the reassuring answer, and it was not measured.
    let shipsCompletingBeforeThreatArrival = null;
    let completionBasis = null;
    if (incomingHostile.length === 0) {
      shipsCompletingBeforeThreatArrival = observerQueues.length;
      completionBasis = 'no inbound hostile force; the whole queue is uncontested';
    } else if (nearestArrivalDays === null) {
      completionBasis = 'unevaluable: an inbound hostile force carries no arrival date on record';
    } else {
      shipsCompletingBeforeThreatArrival = timedQueues
        .filter(q => q.daysToCompletion <= nearestArrivalDays).length;
      completionBasis = untimedQueueCount === 0
        ? 'measured against the nearest inbound arrival'
        : `measured against the nearest inbound arrival; ${untimedQueueCount} queued hull(s) excluded for want of a completion date`;
    }

    // Worst true thing first. THREAT_INBOUND_ARRIVAL_UNKNOWN sits ABOVE
    // CONTESTED because it is the case where the imminence test cannot be run
    // at all: falling through to a calmer label would be an unevaluable check
    // reporting "fine". Gated on the fleet count rather than the ship count,
    // because `transfers.shipCount` is already coerced to 0 upstream when a
    // fleet's complement is not on record, and a contact is a contact.
    let status = 'UNCONTESTED';
    if (incomingHostile.length > 0 && nearestArrivalDays !== null && nearestArrivalDays <= THREAT_IMMINENT_WINDOW_DAYS) {
      status = 'THREAT_IMMINENT';
    } else if (incomingHostile.length > 0 && nearestArrivalDays === null) {
      status = 'THREAT_INBOUND_ARRIVAL_UNKNOWN';
    } else if (hostileShips > 0) {
      status = 'CONTESTED';
    } else if (friendlyShips > 0 || friendlyHabs > 0) {
      status = 'SECURE';
    }

    return {
      body: bodyName,
      status,
      friendly: {
        ships: friendlyShips,
        fleets: friendlyFleets.length,
        // null, never 0, when the save carries no combat power: a 0 on both
        // sides of this row reads as measured parity between the two forces.
        combatPower: friendlyCP.total,
        combatPowerAvailable: friendlyCP.available,
        combatPowerSource: friendlyCP.source,
        habs: friendlyHabs,
        shipyards: friendlyYards,
        mines: friendlyMines
      },
      hostile: {
        ships: hostileShips,
        fleets: hostileFleets.length,
        combatPower: hostileCP.total,
        combatPowerAvailable: hostileCP.available,
        combatPowerSource: hostileCP.source,
        factions: Array.from(new Set(hostileFleets.map(f => f.factionName).filter(Boolean)))
      },
      incoming: {
        hostileShips: incomingHostileShips,
        hostileFleets: incomingHostile.length,
        nearestArrivalDays,
        nearestArrivalDate: arrival.date,
        // How many of the inbound fleets have no arrival date. When this equals
        // `hostileFleets`, `nearestArrivalDays` is null because nothing was
        // measured, NOT because nothing is coming.
        arrivalTimingUnknownFleets: arrival.timingUnknownCount,
        // null, not true, when nothing is inbound: there is no timing to know.
        arrivalTimingKnown: incomingHostile.length === 0 ? null : arrival.timingUnknownCount === 0,
        // Each inbound contact with the hops that resolved it, so the claim is
        // auditable rather than asserted.
        destinations: incomingHostile.map(m => movementRow(m, true)).sort(bySoonestKnownArrival)
      },
      production: {
        shipsCompletingBeforeThreatArrival,
        shipsCompletingBeforeThreatArrivalBasis: completionBasis,
        queuedShipsWithUnknownCompletion: untimedQueueCount,
        totalQueuedShips: observerQueues.length
      }
    };
  });

  return { theaters, hostileMovement: summariseHostileMovement(hostileMovements, trackedBodyKeys) };
};

/**
 * 5. Theaters: Synthesized body-by-body military posture and threat assessment.
 *
 * Still the twelve-row array every existing caller expects. The whole-board
 * view, including the hostile movement that lands outside those twelve, is
 * `theaterBoardResource`.
 */
export const theatersResource = (snapshot, observerId = DEFAULT_OBSERVER_FACTION_ID) =>
  theaterBoardResource(snapshot, observerId).theaters;

/**
 * 12. Body Status: Complete single-body briefing across all domains.
 */
export const bodyStatusResource = (snapshot, bodyName = 'Mars', observerId = DEFAULT_OBSERVER_FACTION_ID) => {
  const norm = normalizeBody(bodyName);
  const habs = asArray(snapshot.habs).filter(h => normalizeBody(h.orbitBody) === norm);
  const fleets = asArray(snapshot.fleets).filter(f => normalizeBody(f.orbitBody) === norm);
  const sites = asArray(snapshot.habSites).filter(s => normalizeBody(s.parentBodyName) === norm);
  const queues = asArray(snapshot.shipyardQueues).filter(q => normalizeBody(q.orbitBody) === norm);
  const allTransfers = transfersResource(snapshot);
  // Same deepened match as the theater board. A literal-name test here missed a
  // fleet inbound to a hab in this body's own orbit -- the Protectorate's
  // Papa-291 is 61 days from Antiochus Station, which orbits Earth, and read as
  // inbound to nowhere.
  const destinationIndex = buildDestinationIndex(snapshot);
  const incoming = allTransfers
    .map(transfer => ({ transfer, resolution: resolveTransferDestination(transfer, destinationIndex) }))
    .filter(({ resolution }) => resolution.normalizedBody === norm)
    .map(({ transfer, resolution }) => ({
      ...transfer,
      resolvedDestinationBody: resolution.body,
      destinationResolutionMethod: resolution.method,
      destinationResolutionVia: resolution.via
    }));

  const friendlyFleets = fleets.filter(f => sameId(f.factionId, observerId));
  const hostileFleets = fleets.filter(f => !sameId(f.factionId, observerId) && f.factionName !== 'Neutral');
  const friendlyCP = combatPowerTotal(friendlyFleets);
  const hostileCP = combatPowerTotal(hostileFleets);
  // Derived over BOTH sides together so a side with no fleets at all cannot
  // make a fully measured reading look like partial coverage.
  const combatPowerSource = combatPowerTotal([...friendlyFleets, ...hostileFleets]).source;

  return {
    body: bodyName,
    habsCount: habs.length,
    fleetsCount: fleets.length,
    miningSitesCount: sites.length,
    militaryBalance: {
      friendlyShips: friendlyFleets.reduce((sum, f) => sum + (f.shipsCount || 0), 0),
      // Same rule as the theater board: an unmeasured combat power is null on
      // both sides, so the balance cannot read as a measured draw.
      friendlyCombatPower: friendlyCP.total,
      friendlyCombatPowerAvailable: friendlyCP.available,
      hostileShips: hostileFleets.reduce((sum, f) => sum + (f.shipsCount || 0), 0),
      hostileCombatPower: hostileCP.total,
      hostileCombatPowerAvailable: hostileCP.available,
      combatPowerSource
    },
    habs: habs.map(habResourceRow),
    fleets: fleets.map(fleetResourceRow),
    incomingTransfers: incoming,
    miningSites: sites.map(miningResourceRow),
    shipyardQueues: queues
  };
};
