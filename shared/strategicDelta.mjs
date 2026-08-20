// shared/strategicDelta.mjs
//
// Computes the difference between two `strategic_snapshot_v1` documents.
//
// Deltas are calculated on demand and never stored: a second large delta blob
// per save would defeat the point of the compact history. Because the compact
// schema is stable, this stays cheap.
//
// This module owns the ONE diff implementation. `strategicSnapshot.deriveEvents`
// re-exports `deriveStructuredEvents` from here rather than re-deriving ship
// losses, hab changes, project transitions and hate crossings a second time --
// the duplicated copy had already drifted (it never learned about total war or
// completed projects) and silently disagreed with this one.
//
// Two consumers, two deliberately different shapes over the same diff:
//   * `buildStrategicDelta(...).events` -> narration STRINGS, for the API.
//   * `deriveStructuredEvents(...)`     -> structured OBJECTS, stored in the
//                                          compact snapshot's `events` array.
//
// Runtime-agnostic so the hosted worker can import it alongside the server.

import { ALIEN_FACTION_ID } from './constants.mjs';
import { ALIEN_HATE_WAR_THRESHOLD } from './alienHateEconomics.mjs';
import { asArray, toFiniteNumber as num, round, sameId, MS_PER_DAY } from './util.mjs';

/**
 * A from/to/delta triple. Returns nulls rather than a fabricated 0 when either
 * side is unknown -- older snapshots predate some fields, and a delta computed
 * against a missing value would invent a trend that never happened.
 */
function change(from, to, places = 2) {
  const a = num(from);
  const b = num(to);
  return {
    from: round(a, places),
    to: round(b, places),
    delta: a === null || b === null ? null : round(b - a, places)
  };
}

// Compact-history summaries carry `id` (lower case), unlike the raw snapshot's
// `ID`. Kept explicit here rather than routed through resolveObserverFaction,
// which reads the raw shape.
const factionById = (doc, id) =>
  asArray(doc?.summary?.factions).find(f => sameId(f?.id, id)) || null;

const dayDiff = (from, to) => {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / MS_PER_DAY);
};

// Elapsed days must be measured in CAMPAIGN time, not wall-clock. Two saves
// played back to back are minutes apart in real time but can be months apart
// in game, and it is the in-game interval every trend question is about.
const campaignDays = (from, to) => {
  const inGame = dayDiff(from?.meta?.campaignDate, to?.meta?.campaignDate);
  if (inGame !== null) return inGame;
  return dayDiff(from?.meta?.saveLastModified, to?.meta?.saveLastModified);
};

// --- alien total war ---------------------------------------------------------
//
// `alienThreat.totalWar` is an object `{ state, ... }` produced by
// buildTotalWarState (shared/alienHateEconomics.mjs). First-generation compact
// rows carried a bare boolean, and rows published before total war was recorded
// at all carry nothing. All three must be readable, and "nothing recorded" must
// resolve to UNKNOWN rather than to a confident "not at war".
//
// Total war needs BOTH the campaign-year gate and 200 hate, so the year gate
// alone settles some cases even when hate is redacted:
//   safe_hate_unknown  -> year gate CLOSED, so total war is impossible: false.
//   armed_hate_unknown -> year gate OPEN and hate redacted: genuinely unknown.
const TOTAL_WAR_UNDECIDABLE_STATES = new Set(['unavailable', 'armed_hate_unknown']);

export const totalWarStateOf = (threat) => {
  const value = threat?.totalWar;
  if (value === true) return 'active';
  if (value === false) return 'inactive';
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof value.state === 'string') return value.state;
  return null;
};

/** true / false / null, where null means "could not be evaluated". */
export const totalWarActive = (threat) => {
  const state = totalWarStateOf(threat);
  if (state === null) return null;
  if (state === 'active') return true;
  if (TOTAL_WAR_UNDECIDABLE_STATES.has(state)) return null;
  return false;
};

// --- research completions ----------------------------------------------------

const idList = (value) => (Array.isArray(value) ? value.map(String) : null);

/**
 * Which projects finished between the two snapshots.
 *
 * Preference order, most trustworthy first:
 *   1. Set difference of the two completed-project ledgers. Exact, and valid
 *      for ANY pair of retained snapshots rather than only adjacent ones.
 *   2. A `completedSincePrior` list the producer recorded itself.
 *   3. Identical completed-set hashes, which prove nothing finished.
 * Otherwise the answer is genuinely unknown, and says so rather than
 * reporting an empty list that reads as "nothing was completed".
 */
function diffCompletedProjects(from, to) {
  const fromLedger = idList(from?.research?.completedProjects);
  const toLedger = idList(to?.research?.completedProjects);
  if (fromLedger && toLedger) {
    const before = new Set(fromLedger);
    return { completed: toLedger.filter(id => !before.has(id)), source: 'completed-project-ledger' };
  }

  const reported = idList(to?.research?.completedSincePrior);
  if (reported) return { completed: reported, source: 'snapshot-reported' };

  const fromHash = from?.research?.completedProjectHash;
  const toHash = to?.research?.completedProjectHash;
  if (fromHash && toHash && fromHash === toHash) {
    return { completed: [], source: 'hash-unchanged' };
  }

  return { completed: null, source: 'unavailable' };
}

/** Human-readable one-liners derived from the structured diff. */
function narrate(delta) {
  const lines = [];
  const ships = delta.military?.observerShips;
  if (ships && ships.delta !== null && ships.delta !== 0) {
    lines.push(ships.delta < 0
      ? `Lost ${Math.abs(ships.delta)} ship(s)`
      : `Gained ${ships.delta} ship(s)`);
  }

  for (const loss of asArray(delta.shipLosses)) {
    lines.push(`Lost ${loss.count}x ${loss.design}`);
  }

  const alien = delta.military?.alienShips;
  if (alien && alien.delta !== null && alien.delta !== 0) {
    lines.push(alien.delta > 0
      ? `Alien fleet grew by ${alien.delta} ship(s)`
      : `Alien fleet shrank by ${Math.abs(alien.delta)} ship(s)`);
  }

  const hate = delta.hate?.actual;
  if (hate && hate.delta !== null && hate.delta !== 0) {
    lines.push(`Alien hate ${hate.delta > 0 ? 'rose' : 'fell'} ${Math.abs(hate.delta)} to ${hate.to}`);
  }
  if (delta.hate?.crossedWarThreshold) {
    // The number quoted here is the shared constant, not a second copy of it.
    // NOTE: the crossing itself is tested against the snapshot's own recorded
    // `alienThreat.warThreshold` (see diffSnapshots), which normally IS this
    // constant. A snapshot that recorded a different one would still be
    // narrated with this figure -- pre-existing, left alone deliberately
    // because changing it would change published narration text.
    lines.push(delta.hate.crossedWarThreshold === 'up'
      ? `Crossed the alien war threshold (${ALIEN_HATE_WAR_THRESHOLD})`
      : `Dropped back below the alien war threshold (${ALIEN_HATE_WAR_THRESHOLD})`);
  }
  // Total war is the single most consequential event in a campaign, so it is
  // announced three ways: a fresh declaration, a declaration we can see but
  // cannot date, and an unevaluable state -- never a silent nothing.
  if (delta.hate?.totalWarDeclared) {
    lines.push('ALIEN TOTAL WAR DECLARED');
  } else if (delta.hate?.totalWarActive === true) {
    lines.push(delta.hate.totalWarPreviouslyActive === true
      ? 'Alien total war remains in effect'
      : 'ALIEN TOTAL WAR ACTIVE (state before this period is unknown)');
  } else if (delta.hate?.totalWarActive === null) {
    lines.push('Alien total war status UNAVAILABLE — the year gate has passed and alien hate is not exposed');
  }

  for (const hab of asArray(delta.infrastructure?.lost)) {
    lines.push(`Lost hab ${hab.id}${hab.body ? ` at ${hab.body}` : ''}`);
  }
  for (const hab of asArray(delta.infrastructure?.gained)) {
    lines.push(`Established hab ${hab.id}${hab.body ? ` at ${hab.body}` : ''}`);
  }
  for (const id of asArray(delta.research?.completed)) {
    lines.push(`Completed ${id}`);
  }
  if (delta.research?.completed === null && delta.research?.completedSetChanged !== false) {
    lines.push('Completed projects changed, but these snapshots do not record which');
  }

  const mc = delta.economy?.missionControlUsed;
  if (mc && mc.delta !== null && mc.delta !== 0) {
    lines.push(`Used Mission Control ${mc.delta > 0 ? 'up' : 'down'} ${Math.abs(mc.delta)} to ${mc.to}`);
  }

  return lines;
}

/**
 * The single diff. Everything both consumers need is computed here exactly
 * once; the callers only choose how to present it.
 */
function diffSnapshots(from, to) {
  const observerId = to.summary?.observerFactionId ?? from.summary?.observerFactionId ?? null;
  const fromObserver = factionById(from, observerId);
  const toObserver = factionById(to, observerId);

  // Aliens are whichever summary faction is not the observer and carries no
  // Earth-side metrics; fall back to the conventional id.
  const alienId = ALIEN_FACTION_ID;
  const fromAlien = factionById(from, alienId);
  const toAlien = factionById(to, alienId);

  // Ship losses by design, from the compact ledger.
  const previousShips = new Map(asArray(from.ships).map(([id, design]) => [id, design]));
  const currentShipIds = new Set(asArray(to.ships).map(([id]) => id));
  const lostByDesign = new Map();
  for (const [id, design] of previousShips.entries()) {
    if (!currentShipIds.has(id)) {
      const key = design || 'unknown';
      lostByDesign.set(key, (lostByDesign.get(key) || 0) + 1);
    }
  }

  const previousHabs = new Map(asArray(from.infrastructure).map(h => [h.id, h]));
  const currentHabs = new Map(asArray(to.infrastructure).map(h => [h.id, h]));
  const habsLost = [...previousHabs.values()].filter(h => !currentHabs.has(h.id));
  const habsGained = [...currentHabs.values()].filter(h => !previousHabs.has(h.id));

  // A project in progress before but absent now has resolved (completed or
  // been abandoned); the completed-project ledger disambiguates which.
  const previousProjects = new Set(asArray(from.research?.projects).map(([id]) => id));
  const currentProjects = new Set(asArray(to.research?.projects).map(([id]) => id));
  const resolved = [...previousProjects].filter(id => !currentProjects.has(id));
  const started = [...currentProjects].filter(id => !previousProjects.has(id));

  const { completed, source: completedSource } = diffCompletedProjects(from, to);
  const fromHash = from.research?.completedProjectHash;
  const toHash = to.research?.completedProjectHash;
  let completedSetChanged = null;
  if (fromHash && toHash) completedSetChanged = fromHash !== toHash;
  else if (completed !== null) completedSetChanged = completed.length > 0;

  const economy = {};
  for (const key of Object.keys(to.economy?.resources || {})) {
    const [fromStock, fromNet] = asArray(from.economy?.resources?.[key]);
    const [toStock, toNet] = asArray(to.economy?.resources?.[key]);
    economy[key] = {
      stockpile: change(fromStock, toStock, 1),
      monthlyNet: change(fromNet, toNet, 1)
    };
  }

  const fromHate = num(from.alienThreat?.hate);
  const toHate = num(to.alienThreat?.hate);
  const threshold = num(to.alienThreat?.warThreshold) ?? ALIEN_HATE_WAR_THRESHOLD;
  let crossed = null;
  if (fromHate !== null && toHate !== null) {
    if (fromHate < threshold && toHate >= threshold) crossed = 'up';
    else if (fromHate >= threshold && toHate < threshold) crossed = 'down';
  }

  const fromTotalWar = totalWarActive(from.alienThreat);
  const toTotalWar = totalWarActive(to.alienThreat);

  return {
    period: {
      from: from.meta?.campaignDate || null,
      to: to.meta?.campaignDate || null,
      days: campaignDays(from, to)
    },
    military: {
      observerShips: change(fromObserver?.ships, toObserver?.ships, 0),
      observerFleets: change(fromObserver?.fleets, toObserver?.fleets, 0),
      observerHabs: change(fromObserver?.habs, toObserver?.habs, 0),
      alienShips: change(fromAlien?.ships, toAlien?.ships, 0),
      alienHabs: change(fromAlien?.habs, toAlien?.habs, 0)
    },
    shipLosses: [...lostByDesign.entries()].map(([design, count]) => ({ design, count })),
    infrastructure: {
      lost: habsLost.map(h => ({ id: h.id, body: h.body })),
      gained: habsGained.map(h => ({ id: h.id, body: h.body }))
    },
    hate: {
      actual: change(fromHate, toHate),
      minimumFloor: change(from.alienThreat?.minimumHate, to.alienThreat?.minimumHate),
      crossedWarThreshold: crossed,
      warThreshold: threshold,
      // Strictly a NEW declaration: previously provably-not-at-war, now at war.
      totalWarDeclared: toTotalWar === true && fromTotalWar === false,
      // Tri-state. null means the check could not be evaluated, which is NOT
      // the same as "at peace".
      totalWarActive: toTotalWar,
      totalWarPreviouslyActive: fromTotalWar,
      totalWarState: { from: totalWarStateOf(from.alienThreat), to: totalWarStateOf(to.alienThreat) }
    },
    economy: {
      ...economy,
      missionControlUsed: change(from.economy?.mc?.used, to.economy?.mc?.used, 0),
      missionControlCap: change(from.economy?.mc?.cap, to.economy?.mc?.cap, 0),
      mines: change(from.economy?.mines?.count, to.economy?.mines?.count, 0)
    },
    research: {
      monthly: change(from.research?.monthly, to.research?.monthly, 0),
      started,
      resolved,
      // Array when known, null when these two snapshots cannot answer it.
      completed,
      completedSource,
      completedSetChanged
    }
  };
}

/**
 * Diff two compact snapshots.
 * @param {object} from Older `strategic_snapshot_v1` document
 * @param {object} to   Newer `strategic_snapshot_v1` document
 */
export function buildStrategicDelta(from, to) {
  if (!to) return { error: 'A "to" snapshot is required.' };
  if (!from) {
    return {
      period: { from: null, to: to.meta?.campaignDate || null, days: null },
      baseline: true,
      note: 'No earlier snapshot to compare against; this is the first in the retained history.'
    };
  }

  const delta = diffSnapshots(from, to);
  delta.events = narrate(delta);
  return delta;
}

/**
 * The same diff rendered as structured event objects for the compact
 * snapshot's `events` array. The snapshot stores objects, not prose, so that
 * downstream analysis can filter on `type` without parsing English.
 */
export function deriveStructuredEvents(from, to) {
  if (!from || !to) return [];
  const delta = diffSnapshots(from, to);
  const events = [];
  const observerFactionId = to.summary?.observerFactionId ?? null;

  const losses = asArray(delta.shipLosses);
  if (losses.length > 0) {
    events.push({
      type: 'ship_loss',
      faction: observerFactionId,
      count: losses.reduce((sum, loss) => sum + loss.count, 0),
      designs: losses.map(loss => [loss.design, loss.count])
    });
  }

  for (const hab of asArray(delta.infrastructure?.lost)) {
    events.push({ type: 'hab_lost', faction: observerFactionId, body: hab.body, id: hab.id });
  }
  for (const hab of asArray(delta.infrastructure?.gained)) {
    events.push({ type: 'hab_gained', body: hab.body, id: hab.id });
  }

  for (const id of asArray(delta.research?.started)) {
    events.push({ type: 'project_started', id });
  }
  for (const id of asArray(delta.research?.resolved)) {
    events.push({ type: 'project_resolved', id });
  }
  for (const id of asArray(delta.research?.completed)) {
    events.push({ type: 'project_completed', id });
  }
  if (delta.research?.completedSetChanged === true) {
    events.push({
      type: 'completed_projects_changed',
      // Absent rather than fabricated when the snapshots cannot name them.
      ids: delta.research.completed,
      source: delta.research.completedSource
    });
  }

  if (delta.hate?.crossedWarThreshold) {
    events.push({
      type: 'hate_threshold_crossed',
      from: delta.hate.actual.from,
      to: delta.hate.actual.to,
      threshold: delta.hate.warThreshold,
      direction: delta.hate.crossedWarThreshold
    });
  }

  if (delta.hate?.totalWarDeclared) {
    events.push({
      type: 'total_war_declared',
      from: delta.hate.totalWarState.from,
      to: delta.hate.totalWarState.to
    });
  } else if (delta.hate?.totalWarActive === true && delta.hate?.totalWarPreviouslyActive !== true) {
    events.push({
      type: 'total_war_active',
      priorStateKnown: false,
      state: delta.hate.totalWarState.to
    });
  } else if (delta.hate?.totalWarActive === null) {
    events.push({
      type: 'total_war_state_unavailable',
      state: delta.hate.totalWarState.to
    });
  }

  return events;
}

export default { buildStrategicDelta, deriveStructuredEvents, totalWarActive, totalWarStateOf };
