// shared/strategicDelta.mjs
//
// Computes the difference between two `strategic_snapshot_v1` documents.
//
// Deltas are calculated on demand and never stored: a second large delta blob
// per save would defeat the point of the compact history. Because the compact
// schema is stable, this stays cheap.
//
// Runtime-agnostic so the hosted worker can import it alongside the server.

const asArray = (value) => (Array.isArray(value) ? value : []);

const num = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const round = (value, places = 2) => {
  const parsed = num(value);
  if (parsed === null) return null;
  const factor = 10 ** places;
  return Math.round(parsed * factor) / factor;
};

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

const factionById = (doc, id) =>
  asArray(doc?.summary?.factions).find(f => Number(f.id) === Number(id)) || null;

const dayDiff = (from, to) => {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
};

// Elapsed days must be measured in CAMPAIGN time, not wall-clock. Two saves
// played back to back are minutes apart in real time but can be months apart
// in game, and it is the in-game interval every trend question is about.
const campaignDays = (from, to) => {
  const inGame = dayDiff(from?.meta?.campaignDate, to?.meta?.campaignDate);
  if (inGame !== null) return inGame;
  return dayDiff(from?.meta?.saveLastModified, to?.meta?.saveLastModified);
};

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
    lines.push(delta.hate.crossedWarThreshold === 'up'
      ? 'Crossed the alien war threshold (50)'
      : 'Dropped back below the alien war threshold (50)');
  }
  if (delta.hate?.totalWarDeclared) lines.push('ALIEN TOTAL WAR DECLARED');

  for (const hab of asArray(delta.infrastructure?.lost)) {
    lines.push(`Lost hab ${hab.id}${hab.body ? ` at ${hab.body}` : ''}`);
  }
  for (const hab of asArray(delta.infrastructure?.gained)) {
    lines.push(`Established hab ${hab.id}${hab.body ? ` at ${hab.body}` : ''}`);
  }
  for (const id of asArray(delta.research?.completed)) {
    lines.push(`Completed ${id}`);
  }

  const mc = delta.economy?.missionControlUsed;
  if (mc && mc.delta !== null && mc.delta !== 0) {
    lines.push(`Used Mission Control ${mc.delta > 0 ? 'up' : 'down'} ${Math.abs(mc.delta)} to ${mc.to}`);
  }

  return lines;
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

  const observerId = to.summary?.observerFactionId ?? from.summary?.observerFactionId ?? null;
  const fromObserver = factionById(from, observerId);
  const toObserver = factionById(to, observerId);

  // Aliens are whichever summary faction is not the observer and carries no
  // Earth-side metrics; fall back to the conventional id.
  const alienId = 4717;
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
  // been abandoned); the completed-set hash disambiguates whether anything
  // actually finished.
  const previousProjects = new Set(asArray(from.research?.projects).map(([id]) => id));
  const currentProjects = new Set(asArray(to.research?.projects).map(([id]) => id));
  const resolved = [...previousProjects].filter(id => !currentProjects.has(id));
  const started = [...currentProjects].filter(id => !previousProjects.has(id));
  const completedSetChanged =
    from.research?.completedProjectHash !== to.research?.completedProjectHash;

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
  const threshold = num(to.alienThreat?.warThreshold) ?? 50;
  let crossed = null;
  if (fromHate !== null && toHate !== null) {
    if (fromHate < threshold && toHate >= threshold) crossed = 'up';
    else if (fromHate >= threshold && toHate < threshold) crossed = 'down';
  }

  const delta = {
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
      totalWarDeclared: to.alienThreat?.totalWar === true && from.alienThreat?.totalWar !== true
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
      completed: completedSetChanged ? asArray(to.research?.completedSincePrior) : [],
      completedSetChanged
    }
  };

  delta.events = narrate(delta);
  return delta;
}

export default { buildStrategicDelta };
