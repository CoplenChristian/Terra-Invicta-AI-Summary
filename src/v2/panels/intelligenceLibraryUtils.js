/**
 * src/v2/panels/intelligenceLibraryUtils.js
 *
 * Purpose: pure formatters and selectors for the intelligence library React
 *   panel — mirrors MissionControlShared null discipline without DOM coupling.
 */

import { parseNumeric } from '../components/parseNumeric.js';

export const EM_DASH = '—';

export function numberValue(value) {
  return parseNumeric(value);
}

export function number(value, decimals = 0) {
  const parsed = numberValue(value);
  if (parsed === null) return EM_DASH;
  return parsed.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function money(value) {
  const parsed = numberValue(value);
  if (parsed === null) return EM_DASH;
  if (Math.abs(parsed) >= 1_000_000_000_000) {
    return `$${(parsed / 1_000_000_000_000).toFixed(2)}T`;
  }
  if (Math.abs(parsed) >= 1_000_000_000) {
    return `$${(parsed / 1_000_000_000).toFixed(1)}B`;
  }
  if (Math.abs(parsed) >= 1_000_000) {
    return `$${(parsed / 1_000_000).toFixed(1)}M`;
  }
  return `$${number(parsed, 0)}`;
}

export function displayText(value, fallback = EM_DASH) {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
}

export function factionMap(snapshot) {
  const map = {};
  (snapshot?.factions || []).forEach((faction) => {
    map[String(faction.ID)] = faction;
  });
  return map;
}

export function factionNameById(id, factions) {
  if (id === null || id === undefined || id === '') return EM_DASH;
  const faction = factions[String(id)];
  return faction ? faction.displayName : 'Unknown faction';
}

export function factionColorById(id, factions) {
  const faction = factions[String(id)];
  return faction?.color ? faction.color : 'var(--accent)';
}

export function activeCouncilors(snapshot) {
  return (snapshot && Array.isArray(snapshot.councilors) ? snapshot.councilors : [])
    .filter((councilor) => {
      if (!councilor || councilor.isActiveCouncilor === false || councilor.isIndependent === true) {
        return false;
      }
      if (councilor.factionId === null || councilor.factionId === undefined || councilor.factionId === '') {
        return false;
      }
      return String(councilor.status || 'Active').toLowerCase() === 'active';
    });
}

export function visibleAttribute(councilor, key) {
  const field = councilor?.maskedAttributes?.[key];
  if (!field || field.visibility === 'unknown' || field.visibility === 'unavailable') {
    return EM_DASH;
  }
  return field.visible === null || field.visible === undefined ? EM_DASH : field.visible;
}

export function topSkill(councilor) {
  const keys = [
    'Administration', 'Persuasion', 'Investigation', 'Espionage',
    'Command', 'Science', 'Security', 'Loyalty',
  ];
  let best = null;
  keys.forEach((key) => {
    const value = numberValue(visibleAttribute(councilor, key));
    if (value !== null && (!best || value > best.value)) {
      best = { key, value };
    }
  });
  return best ? `${best.key.slice(0, 3).toUpperCase()} ${best.value}` : 'UNAVAILABLE';
}

export function countLabel(value, noun) {
  const parsed = numberValue(value);
  if (parsed === null) return 'UNAVAILABLE';
  const plural = noun === 'capability'
    ? 'capabilities'
    : noun === 'facility'
      ? 'facilities'
      : `${noun}s`;
  return `${number(parsed, 0)} ${parsed === 1 ? noun : plural}`;
}

export function visibility(snapshot) {
  if (snapshot?.mode === 'omniscient') return 'OMNISCIENT / FULL SAVE STATE';
  if (snapshot?.mode === 'enhanced') return 'ENHANCED INTELLIGENCE';
  return 'PLAYER INTEL / FILTERED';
}

export function relationFor(factionId, observerId, relationships) {
  const towardObserver = (relationships || []).find(
    (relation) => String(relation.sourceFactionId) === String(factionId)
      && String(relation.targetFactionId) === String(observerId),
  );
  const fromObserver = (relationships || []).find(
    (relation) => String(relation.sourceFactionId) === String(observerId)
      && String(relation.targetFactionId) === String(factionId),
  );
  return {
    hateOfUs: towardObserver ? number(towardObserver.hate, 2) : 'UNAVAILABLE',
    ourHate: fromObserver ? number(fromObserver.hate, 2) : 'UNAVAILABLE',
  };
}

export function councilorProfile(councilor) {
  const orgNames = Array.isArray(councilor?.orgs)
    ? councilor.orgs.map((org) => org.displayName).filter(Boolean)
    : [];
  const traitNames = Array.isArray(councilor?.traits) ? councilor.traits.filter(Boolean) : [];
  const profile = orgNames.concat(traitNames).slice(0, 4).join(' · ');
  if (profile) return profile;
  return councilor?.visibility === 'raw_save_only' || councilor?.visibility === 'confirmed'
    ? 'No attached profile'
    : 'UNAVAILABLE';
}

export function resourceCell(value) {
  return number(value, 2);
}

const BODY_THEATER_MAP = {
  sol: 'sol', earth: 'sol', luna: 'sol', mars: 'mars', mercury: 'inner', venus: 'inner',
  ceres: 'belt', psyche: 'belt', klotho: 'belt', pallas: 'belt', vesta: 'belt', bienor: 'belt',
  jupiter: 'jupiter', io: 'jupiter', europa: 'jupiter', ganymede: 'jupiter', callisto: 'jupiter', leda: 'jupiter',
  saturn: 'saturn', titan: 'saturn', rhea: 'saturn', dione: 'saturn', tethys: 'saturn', mimas: 'saturn', enceladus: 'saturn', iapetus: 'saturn',
  uranus: 'outer', miranda: 'outer', neptune: 'outer', triton: 'outer', pluto: 'outer', charon: 'outer', quaoar: 'outer', sedna: 'outer', eris: 'outer', makemake: 'outer', haumea: 'outer',
};

function bodyKey(body, explicitKey) {
  if (explicitKey) return explicitKey;
  const value = String(body || '').trim().replace(/^\d+\s+/, '').replace(/\s+/g, ' ').toLowerCase();
  return BODY_THEATER_MAP[value] || 'unassigned';
}

export function matchesSpaceTheater(body, theaterKey, explicitTheaterKey) {
  if (!theaterKey) return true;
  if (explicitTheaterKey) return String(explicitTheaterKey) === String(theaterKey);
  return bodyKey(body) === theaterKey;
}

export function factionLogoHtml(faction, className) {
  const shared = typeof window !== 'undefined' ? window.MissionControlShared : null;
  if (shared?.factionLogoImgHtml && faction) {
    return shared.factionLogoImgHtml(faction, { className });
  }
  return '';
}
