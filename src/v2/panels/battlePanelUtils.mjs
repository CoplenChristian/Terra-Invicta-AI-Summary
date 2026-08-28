/**
 * src/v2/panels/battlePanelUtils.mjs
 *
 * Purpose: testable fleet-picker and battle-cap logic behind BattlePanel.jsx.
 */

/** Max ships per side in a single battle wave — stated by the player (2026-08-27), not measured from templates. */
export const BATTLE_SHIP_CAP_PER_SIDE = 40;

export const BATTLE_SHIP_CAP_ATTRIBUTION =
  'player-stated cap (2026-08-27); not measured from game templates';

export function sameId(a, b) {
  return a != null && b != null && String(a) === String(b);
}

export function shipId(ship) {
  if (!ship || ship.id == null) return null;
  return String(ship.id);
}

export function factionsWithFleets(fleets) {
  const byId = new Map();
  for (const fleet of Array.isArray(fleets) ? fleets : []) {
    if (fleet?.factionId == null) continue;
    const key = String(fleet.factionId);
    if (!byId.has(key)) {
      byId.set(key, {
        id: fleet.factionId,
        name: fleet.factionName || `Faction ${fleet.factionId}`,
        fleetCount: 0,
      });
    }
    byId.get(key).fleetCount += 1;
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function fleetsForFaction(fleets, factionId) {
  if (factionId == null) return [];
  return (Array.isArray(fleets) ? fleets : [])
    .filter((fleet) => sameId(fleet.factionId, factionId))
    .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
}

export function fleetById(fleets, fleetId) {
  if (fleetId == null) return null;
  return (Array.isArray(fleets) ? fleets : []).find((fleet) => sameId(fleet.ID, fleetId)) || null;
}

export function presentCount(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function toggleShipSelection(selectedIds, nextShipId, cap = BATTLE_SHIP_CAP_PER_SIDE) {
  const id = nextShipId == null ? null : String(nextShipId);
  if (id == null) return Array.isArray(selectedIds) ? [...selectedIds] : [];
  const set = new Set(Array.isArray(selectedIds) ? selectedIds.map(String) : []);
  if (set.has(id)) {
    set.delete(id);
    return [...set];
  }
  if (set.size >= cap) return [...set];
  set.add(id);
  return [...set];
}

export function selectionBlocked(selectedCount, cap = BATTLE_SHIP_CAP_PER_SIDE) {
  return presentCount(selectedCount) && selectedCount >= cap;
}

/**
 * @returns {{ kind: 'within-cap'|'over-cap'|'unknown', fleetShipCount?: number, selectedCount?: number, deployCount?: number, reinforcementCount?: number, cap?: number }}
 */
export function deploymentSummary({
  fleetShipCount,
  selectedCount,
  cap = BATTLE_SHIP_CAP_PER_SIDE,
} = {}) {
  if (!presentCount(fleetShipCount)) return { kind: 'unknown' };
  const selected = presentCount(selectedCount) ? selectedCount : 0;
  if (fleetShipCount <= cap) {
    return { kind: 'within-cap', fleetShipCount, selectedCount: selected, cap };
  }
  const deployCount = Math.min(selected, cap);
  const reinforcementCount = Math.max(0, fleetShipCount - deployCount);
  return {
    kind: 'over-cap',
    fleetShipCount,
    selectedCount: selected,
    deployCount,
    reinforcementCount,
    cap,
  };
}

export function overCapNotice(summary) {
  if (!summary || summary.kind !== 'over-cap') return null;
  const { fleetShipCount, deployCount, reinforcementCount, cap } = summary;
  return (
    `This fleet has ${fleetShipCount} ships. Battles deploy at most ${cap} per side `
    + `(${BATTLE_SHIP_CAP_ATTRIBUTION}). `
    + `${deployCount} selected to fight in the first wave; `
    + `${reinforcementCount} would arrive as reinforcements.`
  );
}
