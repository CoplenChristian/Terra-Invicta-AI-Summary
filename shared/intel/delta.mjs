// shared/intel/delta.mjs
//
// Purpose: three-state turn-to-turn comparison between two snapshots, where a
//   missing side is never a change of zero.
//
// Turn-to-turn comparison between two snapshots. Every measurement here is
// three-state -- from / to / diff plus an `available` flag -- because a
// comparison with one side missing is not a change of zero.

import { DEFAULT_OBSERVER_FACTION_ID } from '../constants.mjs';
import { MS_PER_DAY, toFiniteNumber as toFinite, resolveObserverFaction } from '../util.mjs';
import { MINING_RESOURCES, findAlienFaction } from './common.mjs';

/**
 * 8. Delta: Turn-to-turn changes between snapshots.
 */
export const deltaResource = (snapshot, previousSnapshot, observerId = DEFAULT_OBSERVER_FACTION_ID) => {
  const currentObs = resolveObserverFaction(snapshot.factions, observerId) || {};
  const currentAlien = findAlienFaction(snapshot) || {};
  const curDate = snapshot.metadata?.gameTimeString ? new Date(snapshot.metadata.gameTimeString) : new Date();

  if (!previousSnapshot) {
    return {
      comparisonAvailable: false,
      gameDaysElapsed: null,
      previousDate: null,
      currentDate: snapshot.metadata?.gameTimeString || null,
      changes: null,
      events: ['Single-save context: no previous save comparison available.']
    };
  }

  const prevObs = resolveObserverFaction(previousSnapshot?.factions, observerId) || {};
  const prevAlien = findAlienFaction(previousSnapshot || {}) || {};
  const prevDate = previousSnapshot?.metadata?.gameTimeString ? new Date(previousSnapshot.metadata.gameTimeString) : null;
  const gameDaysElapsed = prevDate && !Number.isNaN(prevDate.getTime())
    ? Math.max(0, Math.round((curDate - prevDate) / MS_PER_DAY))
    : null;

  // Absent stays null on BOTH sides.
  //
  // `assessedAlienHateOfMe ?? 0` was the worst offender in this file: player
  // mode redacts that field, so every player-mode delta reported alien hate as
  // a confident 0 -- an unmeasured value rendered as "no threat at all", the
  // most dangerous direction to be wrong in. `shipsCount ?? 0` then paired a
  // fabricated 0 with `prev ?? cur`, so a missing previous count produced a
  // fabricated "no change" instead of an honest "cannot compare".
  const measure = (from, to) => {
    const a = toFinite(from);
    const b = toFinite(to);
    return {
      from: a === null ? null : Number(a.toFixed(1)),
      to: b === null ? null : Number(b.toFixed(1)),
      diff: a === null || b === null ? null : Number((b - a).toFixed(1)),
      available: a !== null && b !== null
    };
  };

  const curRes = currentObs.resources || {};
  const prevRes = prevObs.resources || {};

  const changes = {
    initiativeShips: measure(prevObs.shipsCount, currentObs.shipsCount),
    alienShips: measure(prevAlien.shipsCount, currentAlien.shipsCount),
    alienHate: measure(prevObs.assessedAlienHateOfMe, currentObs.assessedAlienHateOfMe)
  };
  for (const { saveKey, alias } of MINING_RESOURCES) {
    changes[alias] = measure(prevRes[saveKey], curRes[saveKey]);
  }

  const events = [];
  const ships = changes.initiativeShips;
  if (ships.diff !== null && ships.diff > 0) events.push(`Initiative commissioned ${ships.diff} new ship(s)`);
  else if (ships.diff !== null && ships.diff < 0) events.push(`Initiative lost ${Math.abs(ships.diff)} ship(s)`);

  const alienShips = changes.alienShips;
  if (alienShips.diff !== null && alienShips.diff > 0) events.push(`Aliens deployed ${alienShips.diff} new ship(s)`);

  const hate = changes.alienHate;
  if (hate.diff === null) {
    // Never fall through to "hate unchanged" -- an unevaluable check must say so.
    events.push('Alien hate change UNAVAILABLE — hate is not exposed in this intel mode.');
  } else if (hate.diff > 0) {
    events.push(`Alien hate increased by ${hate.diff.toFixed(1)}`);
  } else if (hate.diff < 0) {
    events.push(`Alien hate decreased by ${Math.abs(hate.diff).toFixed(1)}`);
  }

  if (events.length === 0) events.push('Campaign operational status sustained without major strategic losses.');

  return {
    comparisonAvailable: true,
    gameDaysElapsed,
    previousDate: previousSnapshot?.metadata?.gameTimeString || null,
    currentDate: snapshot.metadata?.gameTimeString || null,
    changes,
    events
  };
};
