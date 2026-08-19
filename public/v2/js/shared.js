/*
 * MISSION CONTROL / SHARED UTILITIES
 * Single source of truth for HTML escaping, numeric formatting, faction
 * lookups, and the space-body to theater map. Loaded before all components.
 * Exposed as window.MissionControlShared.
 */
(function exposeShared(global) {
  'use strict';

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function display(value, fallback) {
    if (value === null || value === undefined || value === '') return fallback || '—';
    return escapeHtml(value);
  }

  function numberValue(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function toFiniteNumber(value) {
    return numberValue(value);
  }

  function formatNumber(value, decimals) {
    const parsed = numberValue(value);
    if (parsed === null) return 'UNAVAILABLE';
    return parsed.toLocaleString(undefined, {
      maximumFractionDigits: decimals === undefined ? 0 : decimals,
      minimumFractionDigits: decimals || 0
    });
  }

  function number(value, decimals) {
    const parsed = numberValue(value);
    if (parsed === null) return '—';
    return parsed.toLocaleString(undefined, {
      minimumFractionDigits: decimals || 0,
      maximumFractionDigits: decimals || 0
    });
  }

  function formatGdp(value) {
    const parsed = numberValue(value);
    return parsed === null ? 'UNAVAILABLE' : `$${(parsed / 1e12).toFixed(1)}T`;
  }

  function formatDelta(change) {
    if (!change) return '—';
    const delta = numberValue(change.delta);
    if (delta === null) return '—';
    if (Math.abs(delta) >= 1e9) return `${delta > 0 ? '+' : ''}${(delta / 1e9).toFixed(1)}B`;
    if (Math.abs(delta) >= 1e6) return `${delta > 0 ? '+' : ''}${(delta / 1e6).toFixed(1)}M`;
    return `${delta > 0 ? '+' : ''}${formatNumber(delta, Math.abs(delta) < 10 && !Number.isInteger(delta) ? 1 : 0)}`;
  }

  function money(value) {
    const parsed = numberValue(value);
    if (parsed === null) return '—';
    if (Math.abs(parsed) >= 1000000000000) return '$' + (parsed / 1000000000000).toFixed(2) + 'T';
    if (Math.abs(parsed) >= 1000000000) return '$' + (parsed / 1000000000).toFixed(1) + 'B';
    if (Math.abs(parsed) >= 1000000) return '$' + (parsed / 1000000).toFixed(1) + 'M';
    return '$' + number(parsed, 0);
  }

  const BODY_THEATER_MAP = {
    sol: 'sol', earth: 'sol', luna: 'sol', mars: 'mars', mercury: 'inner', venus: 'inner',
    ceres: 'belt', psyche: 'belt', klotho: 'belt', pallas: 'belt', vesta: 'belt', bienor: 'belt',
    jupiter: 'jupiter', io: 'jupiter', europa: 'jupiter', ganymede: 'jupiter', callisto: 'jupiter', leda: 'jupiter',
    saturn: 'saturn', titan: 'saturn', rhea: 'saturn', dione: 'saturn', tethys: 'saturn', mimas: 'saturn', enceladus: 'saturn', iapetus: 'saturn',
    uranus: 'outer', miranda: 'outer', neptune: 'outer', triton: 'outer', pluto: 'outer', charon: 'outer', quaoar: 'outer', sedna: 'outer', eris: 'outer', makemake: 'outer', haumea: 'outer'
  };

  function bodyKey(body, explicitKey) {
    if (explicitKey) return explicitKey;
    const value = String(body || '').trim().replace(/^\d+\s+/, '').replace(/\s+/g, ' ').toLowerCase();
    return BODY_THEATER_MAP[value] || 'unassigned';
  }

  function bodyLabel(body) {
    const value = String(body || '').trim();
    return value.replace(/^\d+\s+/, '') || 'Unknown body';
  }

  function matchesSpaceTheater(body, theaterKey, explicitTheaterKey) {
    if (!theaterKey) return true;
    if (explicitTheaterKey) return String(explicitTheaterKey) === String(theaterKey);
    return bodyKey(body) === theaterKey;
  }

  function factionById(snapshot, id) {
    return (Array.isArray(snapshot && snapshot.factions) ? snapshot.factions : [])
      .find(faction => String(faction.ID) === String(id)) || null;
  }

  function factionName(snapshot, id) {
    return factionById(snapshot, id) && factionById(snapshot, id).displayName || 'Unknown faction';
  }

  global.MissionControlShared = {
    escapeHtml: escapeHtml,
    display: display,
    numberValue: numberValue,
    toFiniteNumber: toFiniteNumber,
    formatNumber: formatNumber,
    number: number,
    formatGdp: formatGdp,
    formatDelta: formatDelta,
    money: money,
    bodyKey: bodyKey,
    bodyLabel: bodyLabel,
    matchesSpaceTheater: matchesSpaceTheater,
    factionById: factionById,
    factionName: factionName
  };
})(window);