// shared/intel/theaters.mjs
//
// Body-by-body posture: the twelve-body theater board and the single-body
// briefing behind it. Both read the same fleet/hab/site/queue lists and answer
// "who holds this rock, and what is coming for it".

import { DEFAULT_OBSERVER_FACTION_ID } from '../constants.mjs';
import { asArray, sameId } from '../util.mjs';
import { findAlienFaction, normalizeBody } from './common.mjs';
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
 * Sort key for a transfer whose arrival is not on record.
 *
 * NOT a measurement, and deliberately not changed here: it only orders and
 * compares, never gets reported, so an unknown arrival sinks to the bottom of
 * the "soonest first" list instead of being treated as arriving today. It is
 * still an absent value standing in as a number, which the absent-stays-null
 * rule would rather see as null -- fixing that changes output and belongs with
 * the correctness work, not this refactor.
 */
const UNKNOWN_ARRIVAL_SORT_DAYS = 999;

/**
 * 5. Theaters: Synthesized body-by-body military posture and threat assessment.
 */
export const theatersResource = (snapshot, observerId = DEFAULT_OBSERVER_FACTION_ID) => {
  const bodies = ['Earth', 'Luna', 'Mars', 'Ceres', 'Vesta', 'Mercury', 'Venus', 'Ganymede', 'Callisto', 'Europa', 'Io', 'Titan'];
  const fleets = asArray(snapshot.fleets);
  const habs = asArray(snapshot.habs);
  const sites = asArray(snapshot.habSites);
  const queues = asArray(snapshot.shipyardQueues);
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

  return bodies.map(bodyName => {
    const norm = normalizeBody(bodyName);
    const bodyFleets = fleets.filter(f => normalizeBody(f.orbitBody) === norm);
    const bodyHabs = habs.filter(h => normalizeBody(h.orbitBody) === norm);
    const bodySites = sites.filter(s => normalizeBody(s.parentBodyName) === norm);
    const bodyQueues = queues.filter(q => normalizeBody(q.orbitBody) === norm);

    const friendlyFleets = bodyFleets.filter(f => sameId(f.factionId, observerId));
    const hostileFleets = bodyFleets.filter(f => isHostile(f.factionId, f.factionName));

    const friendlyShips = friendlyFleets.reduce((sum, f) => sum + (f.shipsCount || 0), 0);
    const hostileShips = hostileFleets.reduce((sum, f) => sum + (f.shipsCount || 0), 0);
    const friendlyCP = friendlyFleets.reduce((sum, f) => sum + (f.combatPower || 0), 0);
    const hostileCP = hostileFleets.reduce((sum, f) => sum + (f.combatPower || 0), 0);

    const friendlyHabs = bodyHabs.filter(h => sameId(h.factionId, observerId)).length;
    const friendlyYards = bodyHabs.filter(h => sameId(h.factionId, observerId) && (h.isShipyard || h.shipyardCount > 0)).length;
    const friendlyMines = bodySites.filter(s => sameId(s.factionId, observerId) && s.mineModuleName).length;

    // Incoming hostile transfers
    const incomingHostile = transfers.filter(t =>
      normalizeBody(t.destination) === norm && isHostile(t.factionId, t.faction)
    );
    const incomingHostileShips = incomingHostile.reduce((sum, t) => sum + (t.shipCount || 0), 0);
    const nearestArrivalDays = incomingHostile.length > 0
      ? Math.min(...incomingHostile.map(t => t.daysRemaining ?? UNKNOWN_ARRIVAL_SORT_DAYS))
      : null;
    const nearestArrivalDate = incomingHostile.length > 0
      ? incomingHostile.sort((a, b) =>
        (a.daysRemaining ?? UNKNOWN_ARRIVAL_SORT_DAYS) - (b.daysRemaining ?? UNKNOWN_ARRIVAL_SORT_DAYS))[0].arrival
      : null;

    // Ships completing before threat arrival
    const completingBefore = nearestArrivalDays !== null
      ? bodyQueues.filter(q => sameId(q.factionId, observerId) &&
        (q.daysToCompletion ?? UNKNOWN_ARRIVAL_SORT_DAYS) <= nearestArrivalDays).length
      : bodyQueues.filter(q => sameId(q.factionId, observerId)).length;

    let status = 'UNCONTESTED';
    if (incomingHostileShips > 0 && nearestArrivalDays !== null && nearestArrivalDays <= THREAT_IMMINENT_WINDOW_DAYS) {
      status = 'THREAT_IMMINENT';
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
        combatPower: friendlyCP,
        habs: friendlyHabs,
        shipyards: friendlyYards,
        mines: friendlyMines
      },
      hostile: {
        ships: hostileShips,
        fleets: hostileFleets.length,
        combatPower: hostileCP,
        factions: Array.from(new Set(hostileFleets.map(f => f.factionName).filter(Boolean)))
      },
      incoming: {
        hostileShips: incomingHostileShips,
        hostileFleets: incomingHostile.length,
        nearestArrivalDays,
        nearestArrivalDate
      },
      production: {
        shipsCompletingBeforeThreatArrival: completingBefore,
        totalQueuedShips: bodyQueues.filter(q => sameId(q.factionId, observerId)).length
      }
    };
  });
};

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
  const incoming = allTransfers.filter(t => normalizeBody(t.destination) === norm);

  const friendlyFleets = fleets.filter(f => sameId(f.factionId, observerId));
  const hostileFleets = fleets.filter(f => !sameId(f.factionId, observerId) && f.factionName !== 'Neutral');

  return {
    body: bodyName,
    habsCount: habs.length,
    fleetsCount: fleets.length,
    miningSitesCount: sites.length,
    militaryBalance: {
      friendlyShips: friendlyFleets.reduce((sum, f) => sum + (f.shipsCount || 0), 0),
      friendlyCombatPower: friendlyFleets.reduce((sum, f) => sum + (f.combatPower || 0), 0),
      hostileShips: hostileFleets.reduce((sum, f) => sum + (f.shipsCount || 0), 0),
      hostileCombatPower: hostileFleets.reduce((sum, f) => sum + (f.combatPower || 0), 0)
    },
    habs: habs.map(habResourceRow),
    fleets: fleets.map(fleetResourceRow),
    incomingTransfers: incoming,
    miningSites: sites.map(miningResourceRow),
    shipyardQueues: queues
  };
};
