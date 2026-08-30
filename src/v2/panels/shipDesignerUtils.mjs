/**
 * src/v2/panels/shipDesignerUtils.mjs
 *
 * Purpose: pure formatters, selection/query shaping, reactor and weapon filtering,
 *   hardpoint labels and affordability math for the DESIGNER React panels — every
 *   rule the UI applies without touching the DOM.
 */

import { mountCost } from '../../../shared/militaryValue.mjs';
import { accel, dec, int, num, power } from './driveExplorerUtils.mjs';

export { accel, dec, int, num, power };

/** Display labels for the six weapon source families in the catalogue. */
export const WEAPON_FAMILY_LABELS = Object.freeze({
  laser_weapon: 'Lasers',
  magnetic_gun: 'Magnetic guns',
  missile: 'Missiles',
  particle_weapon: 'Particle weapons',
  plasma_weapon: 'Plasma weapons',
  gun: 'Guns',
});

/** The seven space resources in ship-design bill order. */
export const MATERIALS = Object.freeze([
  { key: 'water', label: 'Water', saveKey: 'Water' },
  { key: 'volatiles', label: 'Volatiles', saveKey: 'Volatiles' },
  { key: 'metals', label: 'Metals', saveKey: 'Metals' },
  { key: 'nobleMetals', label: 'Noble metals', saveKey: 'NobleMetals' },
  { key: 'fissiles', label: 'Fissiles', saveKey: 'Fissiles' },
  { key: 'exotics', label: 'Exotics', saveKey: 'Exotics' },
  { key: 'antimatter', label: 'Antimatter', saveKey: 'Antimatter' },
]);

export const MOUNT_IDS = Object.freeze([
  'designerComponents',
  'designerPerformance',
  'designerMassHeat',
  'designerCost',
]);

/** Page state at rest. A fresh object every call — it is mutable. */
export function defaultDesignerState() {
  return {
    observer: null,
    mode: null,
    loading: false,
    payload: null,
    stockpile: null,
    stockpileReason: null,
    selection: {
      hull: '',
      drive: '',
      thrusters: 1,
      reactor: '',
      radiator: '',
      armour: '',
      nose: 0,
      lateral: 0,
      tail: 0,
      tanks: 0,
      weapons: [],
    },
    error: null,
  };
}

export function stockpileFromResourcesPayload(payload) {
  if (!payload?.items?.length) {
    return { stockpile: null, reason: 'faction stockpile is not available' };
  }
  const faction = payload.items[0];
  if (!faction?.resources || typeof faction.resources !== 'object') {
    return { stockpile: null, reason: 'faction resources block is not readable' };
  }
  const stockpile = {};
  for (const material of MATERIALS) {
    const raw = faction.resources[material.saveKey];
    stockpile[material.key] = raw === null || raw === undefined ? null : num(raw);
  }
  return { stockpile, reason: null };
}

export function driveVariantId(driveRow, thrusterCount) {
  if (!driveRow) return null;
  const count = num(thrusterCount);
  if (count === null) return driveRow.id;
  const variant = asArray(driveRow.variants).find((entry) => {
    const thrusters = num(entry.thrusters);
    if (thrusters === count) return true;
    const match = String(entry.id || '').match(/x([1-6])$/i);
    return match && num(match[1]) === count;
  });
  return variant?.id || driveRow.id;
}

export function thrusterBounds(driveRow) {
  const range = driveRow?.thrusterRange;
  const min = num(range?.min) ?? 1;
  const max = num(range?.max) ?? 6;
  return { min, max };
}

export function clampThrusters(value, driveRow) {
  const parsed = num(value);
  const { min, max } = thrusterBounds(driveRow);
  if (parsed === null) return min;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

export function filterReactors(reactors, driveRow) {
  const rows = asArray(reactors);
  if (!driveRow) return rows;
  const ids = driveRow.compatibleReactorIds;
  if (!Array.isArray(ids)) return rows;
  const allowed = new Set(ids);
  return rows.filter((row) => allowed.has(row.id));
}

export function reactorFilterCaption(allReactors, filteredReactors, driveRow) {
  if (!driveRow) return null;
  const total = asArray(allReactors).length;
  const count = filteredReactors.length;
  const name = driveRow.displayName || driveRow.id;
  const className = driveRow.requiredPowerPlantClass;
  if (className === 'Any_General') {
    return `${count} of ${total} reactors accept ${name} (any power-plant class)`;
  }
  if (className) {
    return `${count} of ${total} reactors accept ${name} (${className})`;
  }
  return `Reactor compatibility for ${name} is unknown — showing all ${total} reactors`;
}

export function filterWeaponsForPicker(weapons, { mountSide = null } = {}) {
  return asArray(weapons).filter((row) => {
    const mount = row.mount || row.stats?.mount;
    const reading = mountCost(mount);
    if (reading.side === 'installation') return false;
    if (mountSide && reading.side !== mountSide) return false;
    return true;
  });
}

export function groupWeaponsByFamily(rows) {
  const groups = new Map();
  for (const row of asArray(rows)) {
    const key = row.weaponFamily || row.unlockFamily || 'other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

export function weaponsQueryEntries(weapons) {
  return asArray(weapons)
    .filter((entry) => entry.id && entry.count > 0)
    .map((entry) => entry.count > 1 ? `${entry.id}:${entry.count}` : entry.id);
}

export function mergeWeaponSelection(weapons, id, count) {
  const parsed = num(count);
  const add = parsed === null || parsed < 1 ? 1 : Math.round(parsed);
  const list = asArray(weapons);
  const existing = list.find((entry) => entry.id === id);
  if (existing) {
    return list.map((entry) => entry.id === id
      ? { ...entry, count: entry.count + add }
      : entry);
  }
  return [...list, { id, count: add }];
}

export function removeWeaponFromSelection(weapons, id) {
  return asArray(weapons).filter((entry) => entry.id !== id);
}

export function setWeaponCount(weapons, id, count) {
  const parsed = num(count);
  if (parsed === null || parsed < 1) return removeWeaponFromSelection(weapons, id);
  return asArray(weapons).map((entry) => entry.id === id
    ? { ...entry, count: Math.round(parsed) }
    : entry);
}

export function hardpointUsageLabel(weaponCapacity, hullRow) {
  if (weaponCapacity?.limits) {
    const limits = weaponCapacity.limits;
    const required = weaponCapacity.required || {};
    const parts = [];
    if (limits.nose !== null && limits.nose !== undefined) {
      parts.push(`nose ${num(required.nose) ?? 0} / ${limits.nose}`);
    }
    if (limits.hull !== null && limits.hull !== undefined) {
      parts.push(`hull ${num(required.hull) ?? 0} / ${limits.hull}`);
    }
    if (limits.internal !== null && limits.internal !== undefined) {
      parts.push(`internal 0 / ${limits.internal}`);
    }
    return parts.join(' · ');
  }
  const stats = hullRow?.stats || hullRow;
  if (!stats) return null;
  const parts = [];
  if (stats.noseHardpoints != null) parts.push(`nose 0 / ${stats.noseHardpoints}`);
  if (stats.hullHardpoints != null) parts.push(`hull 0 / ${stats.hullHardpoints}`);
  if (stats.internalModules != null) parts.push(`internal 0 / ${stats.internalModules}`);
  return parts.length ? parts.join(' · ') : null;
}

export function optionLabel(row, { mode } = {}) {
  const name = row.displayName || row.id;
  if (row.locked && row.unlockProjectName) {
    return `${name} — needs ${row.unlockProjectName}`;
  }
  if (mode === 'omniscient' && row.unlockProjectName && !row.researched) {
    return `${name} (${row.unlockProjectName})`;
  }
  return name;
}

export function selectionQuery(selection, catalogue) {
  const driveRow = catalogue?.families?.drives?.items?.find((row) => row.id === selection.drive) || null;
  const thrusters = clampThrusters(selection.thrusters, driveRow);
  const params = {
    hull: selection.hull || null,
    drive: driveRow ? driveVariantId(driveRow, thrusters) : (selection.drive || null),
    thrusters: driveRow ? thrusters : null,
    reactor: selection.reactor || null,
    radiator: selection.radiator || null,
    armour: selection.armour || null,
    nose: selection.nose,
    lateral: selection.lateral,
    tail: selection.tail,
    tanks: selection.tanks,
  };
  const weaponEntries = weaponsQueryEntries(selection.weapons);
  if (weaponEntries.length > 0) params.weapons = weaponEntries;
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => {
      if (value === null || value === '' || value === undefined) return false;
      if (Array.isArray(value) && value.length === 0) return false;
      return true;
    }),
  );
}

export function formatMaterialCost(value) {
  const parsed = num(value);
  if (parsed === null) return null;
  if (parsed === 0) return '0';
  const abs = Math.abs(parsed);
  if (abs >= 100) return parsed.toFixed(1);
  if (abs >= 10) return parsed.toFixed(2);
  if (abs >= 1) return parsed.toFixed(3);
  return parsed.toPrecision(3);
}

export function affordabilityFor(costVector, stockpile) {
  if (!costVector || typeof costVector !== 'object') {
    return { affordableCount: null, limitingMaterial: null, shortfalls: null, reason: 'design cost is not calculated' };
  }
  if (!stockpile) {
    return { affordableCount: null, limitingMaterial: null, shortfalls: null, reason: 'faction stockpile is not available' };
  }

  let affordableCount = Infinity;
  let limitingMaterial = null;
  const shortfalls = {};

  for (const material of MATERIALS) {
    const need = num(costVector[material.key]);
    const have = stockpile[material.key];
    if (need === null) {
      return {
        affordableCount: null,
        limitingMaterial: material.key,
        shortfalls: null,
        reason: `${material.label} cost is not readable`,
      };
    }
    if (need <= 0) {
      shortfalls[material.key] = 0;
      continue;
    }
    if (have === null) {
      return {
        affordableCount: null,
        limitingMaterial: material.key,
        shortfalls: null,
        reason: `${material.label} stockpile is not readable`,
      };
    }
    const count = Math.floor(have / need);
    const shortfall = Math.max(0, need - have);
    shortfalls[material.key] = shortfall;
    if (count < affordableCount) {
      affordableCount = count;
      limitingMaterial = material.key;
    }
  }

  return {
    affordableCount: Number.isFinite(affordableCount) ? affordableCount : null,
    limitingMaterial,
    shortfalls,
    reason: null,
  };
}

export function rangeLabel(range, formatter = dec) {
  if (!range || typeof range !== 'object') return null;
  const open = range.Open ?? range.open;
  const closed = range.Closed ?? range.closed;
  if (open === undefined && closed === undefined) return null;
  const openText = open === null || open === undefined ? '—' : formatter(open, 2);
  const closedText = closed === null || closed === undefined ? '—' : formatter(closed, 2);
  return `Open ${openText} · Closed ${closedText}`;
}

export function massEntryLabel(entry) {
  if (!entry) return '—';
  if (entry.displayName) return entry.displayName;
  if (entry.key) return String(entry.key);
  return '—';
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}
