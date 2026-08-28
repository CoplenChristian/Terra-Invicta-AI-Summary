/**
 * src/v2/panels/executiveBoardsUtils.js
 *
 * Purpose: pure formatters and selectors for the executive boards React panel —
 * mirrors MissionControlShared null discipline without DOM coupling.
 */

import { ABSENT_LABEL, UNAVAILABLE_LABEL, resolveValue } from '../components/Value.jsx';
import { parseNumeric } from '../components/parseNumeric.js';

export const EM_DASH = ABSENT_LABEL;
export const BOARD_SCROLL_HINT = 'SWIPE HORIZONTALLY TO VIEW ALL COLUMNS';

const BODY_THEATER_MAP = {
  sol: 'sol', earth: 'sol', luna: 'sol', mars: 'mars', mercury: 'inner', venus: 'inner',
  ceres: 'belt', psyche: 'belt', klotho: 'belt', pallas: 'belt', vesta: 'belt', bienor: 'belt',
  jupiter: 'jupiter', io: 'jupiter', europa: 'jupiter', ganymede: 'jupiter', callisto: 'jupiter', leda: 'jupiter',
  saturn: 'saturn', titan: 'saturn', rhea: 'saturn', dione: 'saturn', tethys: 'saturn', mimas: 'saturn', enceladus: 'saturn', iapetus: 'saturn',
  uranus: 'outer', miranda: 'outer', neptune: 'outer', triton: 'outer', pluto: 'outer', charon: 'outer', quaoar: 'outer', sedna: 'outer', eris: 'outer', makemake: 'outer', haumea: 'outer',
};

export function numberValue(value) {
  return parseNumeric(value);
}

export function isPresentNumeric(value) {
  return numberValue(value) !== null;
}

export function isPresentText(value) {
  return value !== null && value !== undefined && value !== '';
}

export function formatNumber(value, decimals) {
  const parsed = numberValue(value);
  if (parsed === null) return UNAVAILABLE_LABEL;
  return parsed.toLocaleString(undefined, {
    maximumFractionDigits: decimals === undefined ? 0 : decimals,
    minimumFractionDigits: decimals || 0,
  });
}

export function formatGdp(value) {
  const parsed = numberValue(value);
  if (parsed === null) return UNAVAILABLE_LABEL;
  return `$${(parsed / 1e12).toFixed(1)}T`;
}

export function formatDelta(change) {
  if (!change) return EM_DASH;
  const delta = numberValue(change.delta);
  if (delta === null) return EM_DASH;
  if (Math.abs(delta) >= 1e9) return `${delta > 0 ? '+' : ''}${(delta / 1e9).toFixed(1)}B`;
  if (Math.abs(delta) >= 1e6) return `${delta > 0 ? '+' : ''}${(delta / 1e6).toFixed(1)}M`;
  return `${delta > 0 ? '+' : ''}${formatNumber(delta, Math.abs(delta) < 10 && !Number.isInteger(delta) ? 1 : 0)}`;
}

/** String form for non-JSX hosts. */
export function number(value, decimals = 0) {
  return resolveValue({
    value,
    present: isPresentNumeric(value),
    absentLabel: UNAVAILABLE_LABEL,
    format: (raw) => formatNumber(raw, decimals),
  }).text;
}

/** String form for non-JSX hosts. */
export function gdp(value) {
  return resolveValue({
    value,
    present: isPresentNumeric(value),
    absentLabel: UNAVAILABLE_LABEL,
    format: formatGdp,
  }).text;
}

/** String form for non-JSX hosts. */
export function delta(change) {
  const parsed = change ? numberValue(change.delta) : null;
  return resolveValue({
    value: change?.delta,
    present: change && parsed !== null,
    absentLabel: ABSENT_LABEL,
    format: () => formatDelta(change),
  }).text;
}

export function bodyKey(body, explicitKey) {
  if (explicitKey) return explicitKey;
  const value = String(body || '').trim().replace(/^\d+\s+/, '').replace(/\s+/g, ' ').toLowerCase();
  return BODY_THEATER_MAP[value] || 'unassigned';
}

export function bodyLabel(body) {
  const value = String(body || '').trim();
  return value.replace(/^\d+\s+/, '') || 'Unknown body';
}

export function factionById(snapshot, id) {
  return (Array.isArray(snapshot?.factions) ? snapshot.factions : [])
    .find((faction) => String(faction.ID) === String(id)) || null;
}

export function factionName(snapshot, id) {
  return factionById(snapshot, id)?.displayName || 'Unknown faction';
}

export function factionDelta(snapshot, id, metric) {
  const faction = (snapshot?.changesSincePrevious?.factions || [])
    .find((entry) => String(entry.factionId) === String(id));
  return faction?.changes?.find((change) => String(change.metric).toLowerCase() === String(metric).toLowerCase()) || null;
}

export function maxFactionId(factions, key, filter) {
  return factions
    .filter(filter || (() => true))
    .slice()
    .sort((a, b) => (numberValue(b[key]) || 0) - (numberValue(a[key]) || 0))[0]?.ID;
}

export function factionStatus(faction, factions) {
  if (String(faction.displayName).toLowerCase().includes('alien')) return 'ALIEN SPACE MILITARY';
  if (String(faction.ID) === String(maxFactionId(factions, 'totalGdp'))) return 'EARTH ECONOMIC POWER';
  if (String(faction.ID) === String(maxFactionId(factions, 'shipsCount'))) return 'SPACE MILITARY';
  if ((numberValue(faction.controlPointsCount) || 0) >= 50) return 'POLITICAL NETWORK';
  if ((numberValue(faction.habsCount) || 0) >= 15) return 'ORBITAL BUILDUP';
  return 'SCATTERED';
}

export function rankLabel(factions, faction, key, filter) {
  const ranked = factions.filter(filter || (() => true)).slice().sort((a, b) => (numberValue(b[key]) || 0) - (numberValue(a[key]) || 0));
  const index = ranked.findIndex((item) => String(item.ID) === String(faction?.ID));
  if (index < 0) {
    return resolveValue({ present: false, absentLabel: UNAVAILABLE_LABEL }).text;
  }
  return resolveValue({
    value: index + 1,
    present: true,
    format: () => `#${index + 1} / ${ranked.length}`,
  }).text;
}

export function ownWeaponMix(snapshot, observerId) {
  const fleets = (snapshot?.fleets || []).filter((fleet) => String(fleet.factionId) === String(observerId));
  const totals = {};
  fleets.forEach((fleet) => (fleet.weaponBreakdown || []).forEach((entry) => {
    const role = entry.role || entry.category || 'Unknown';
    totals[role] = (totals[role] || 0) + (numberValue(entry.count) || 0);
  }));
  return Object.entries(totals).sort((a, b) => b[1] - a[1]);
}

export function completedProjectSignal(faction, expression, labels) {
  const projects = (faction?.completedProjects || []).map(String);
  const match = projects.find((project) => expression.test(project));
  if (!match) {
    return resolveValue({ present: false, absentLabel: UNAVAILABLE_LABEL }).text;
  }
  const known = labels.find((item) => item.test.test(match));
  const label = known?.label || match.replace(/^Project_/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
  return resolveValue({ value: label, present: true, format: () => label }).text;
}

export function weaponCount(fleet, role) {
  return (fleet?.weaponBreakdown || [])
    .filter((entry) => String(entry.role || entry.category).toLowerCase().includes(role))
    .reduce((total, entry) => total + (numberValue(entry.count) || 0), 0);
}

export function shipLoadoutText(ship) {
  const loadout = Array.isArray(ship?.weaponLoadout) ? ship.weaponLoadout : [];
  if (!loadout.length) return 'Loadout unavailable';
  return loadout.map((entry) => {
    const count = numberValue(entry.count);
    const systems = Array.isArray(entry.systems) && entry.systems.length
      ? entry.systems.join(', ')
      : entry.role || entry.category || 'Unknown system';
    return `${count === null ? '' : `${formatNumber(count)} × `}${systems}`;
  }).join(' · ');
}

export function shipCountLabel(value) {
  const parsed = numberValue(value);
  if (parsed === null) {
    return resolveValue({ present: false, absentLabel: UNAVAILABLE_LABEL }).text;
  }
  return resolveValue({
    value: parsed,
    present: true,
    format: () => `${formatNumber(parsed)} ship${parsed === 1 ? '' : 's'}`,
  }).text;
}

export function alienForceSummary(aliens) {
  const solFleets = aliens.filter((fleet) => bodyKey(fleet.orbitBody, fleet.spaceTheaterKey) === 'sol');
  const totalShips = aliens.reduce((sum, fleet) => sum + (numberValue(fleet.shipsCount) || 0), 0);
  const solShips = solFleets.reduce((sum, fleet) => sum + (numberValue(fleet.shipsCount) || 0), 0);
  const averageSolFleet = solFleets.length ? solShips / solFleets.length : null;
  const fragmentation = averageSolFleet === null
    ? UNAVAILABLE_LABEL
    : averageSolFleet <= 2 ? 'HIGH' : averageSolFleet <= 4 ? 'MODERATE' : 'LOW';
  const bodyGroups = new Map();
  aliens.forEach((fleet) => {
    const body = bodyLabel(fleet.orbitBody);
    const group = bodyGroups.get(body) || { fleets: 0, ships: 0 };
    group.fleets += 1;
    group.ships += numberValue(fleet.shipsCount) || 0;
    bodyGroups.set(body, group);
  });
  const bodies = [...bodyGroups.entries()]
    .sort((a, b) => b[1].ships - a[1].ships || b[1].fleets - a[1].fleets)
    .slice(0, 6);
  return {
    totalShips,
    totalFleets: aliens.length,
    solShips,
    solFleets: solFleets.length,
    averageSolFleet,
    fragmentation,
    bodies,
  };
}

export function skillDetail(councilor, skill) {
  const resolved = councilor?.resolvedAttributes;
  const trusted = resolved && (councilor?.isOwnCouncilor || councilor?.isTurnedMole
    || councilor?.visibility === 'confirmed' || councilor?.visibility === 'raw_save_only');

  if (!trusted) {
    const masked = councilor?.maskedAttributes?.[skill];
    if (masked && typeof masked === 'object') {
      return { value: numberValue(masked.visible), base: numberValue(masked.visible), orgBonus: 0, masked: true };
    }
  }

  if (resolved?.effective && Object.hasOwn(resolved.effective, skill)) {
    const orgBonus = numberValue(resolved.orgBonuses?.[skill]) || 0;
    const traitBonus = numberValue(resolved.traitBonuses?.[skill]) || 0;
    const applied = resolved.appliedBonus?.[skill];
    return {
      value: numberValue(resolved.effective[skill]),
      base: numberValue(resolved.base?.[skill]),
      orgBonus,
      traitBonus,
      bonus: typeof applied === 'number' ? applied : orgBonus + traitBonus,
      capped: resolved.capped?.[skill] === true,
      uncapped: numberValue(resolved.uncapped?.[skill]),
      masked: false,
      orgsInactive: resolved.orgsActive === false,
    };
  }

  const base = numberValue(councilor?.attributes?.[skill]);
  return { value: base, base, orgBonus: 0, masked: false };
}

export function visibleSkill(councilor, skill) {
  return skillDetail(councilor, skill).value;
}

export function operativeRole(councilor) {
  const skills = ['Persuasion', 'Investigation', 'Espionage', 'Command', 'Administration', 'Science', 'Security'];
  const best = skills.map((skill) => ({ skill, value: visibleSkill(councilor, skill) }))
    .filter((entry) => entry.value !== null)
    .sort((a, b) => b.value - a.value)[0];
  if (!best) {
    return resolveValue({ present: true, format: () => UNAVAILABLE_LABEL }).text;
  }
  return best.skill;
}

export function nationPosture(nation, observerId, priorityFactionId) {
  const executiveId = nation.executiveFactionId;
  const unrest = numberValue(nation.unrest) || 0;
  if (String(executiveId) === String(observerId)) return unrest >= 2 ? 'DEFEND' : 'CONSOLIDATE';
  if (String(executiveId) === String(priorityFactionId)) return 'CRACKDOWN';
  if (executiveId) return 'CONTEST';
  return 'WATCH';
}

export function availabilityByProjectId(snapshot) {
  const nodes = (snapshot.techTree && snapshot.techTree.nodes) || [];
  const map = new Map();
  for (const node of nodes) {
    if (node && node.availability) map.set(node.id, node);
  }
  return map;
}

export function factionLogoHtml(faction, className) {
  const shared = typeof window !== 'undefined' ? window.MissionControlShared : null;
  if (shared?.factionLogoImgHtml && faction) {
    return shared.factionLogoImgHtml(faction, { className });
  }
  return '';
}
