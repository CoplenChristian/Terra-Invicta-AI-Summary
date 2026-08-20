// server/briefing/format.js
//
// Coercion and presentation primitives for the briefing layer.
//
// Every formatter here answers 'UNAVAILABLE' for an unmeasured input rather
// than 0 or an empty string. That is the whole point of the module: a briefing
// paragraph reading "0 control points" when the field was simply absent is a
// fabricated measurement, and these are the functions that stop it.
//
// `toFiniteNumber` is the STRICT variant. This layer reads arbitrary snapshot
// fields that may hold a boolean or an array, and `Number(true)` is 1 while
// `Number([])` is 0 -- see shared/util.mjs for why the two coercions are named
// separately.

const {
  asArray,
  strictFiniteNumber,
  sameId,
  ONE_TRILLION
} = require('../../shared/util.mjs');

function toFiniteNumber(value) {
  return strictFiniteNumber(value);
}

function firstAvailableNumber(...values) {
  for (const value of values) {
    const number = toFiniteNumber(value);
    if (number !== null) return number;
  }
  return null;
}

function formatNumber(value, decimals = 0) {
  const number = toFiniteNumber(value);
  if (number === null) return 'UNAVAILABLE';
  return decimals > 0 ? number.toFixed(decimals) : Math.round(number).toString();
}

function formatCount(value) {
  const number = toFiniteNumber(value);
  return number === null ? 'UNAVAILABLE' : Math.round(number).toString();
}

function formatPower(value) {
  const number = toFiniteNumber(value);
  return number === null ? 'UNAVAILABLE' : Math.round(number).toString();
}

function formatFactionGdp(observer, fallbackGdp = null) {
  const totalGdp = firstAvailableNumber(observer?.totalGdp, fallbackGdp);
  if (totalGdp !== null) return (totalGdp / ONE_TRILLION).toFixed(1);
  const alreadyTrillion = toFiniteNumber(observer?.gdpTrillion);
  return alreadyTrillion === null ? 'UNAVAILABLE' : alreadyTrillion.toFixed(1);
}

function formatTargetGdp(target) {
  const targetGdpTrillion = toFiniteNumber(target?.gdpTrillion);
  if (targetGdpTrillion !== null) return targetGdpTrillion.toFixed(2);
  const rawGdp = toFiniteNumber(target?.GDP);
  return rawGdp === null ? 'UNAVAILABLE' : (rawGdp / ONE_TRILLION).toFixed(2);
}

function getResourceSnapshot(resources) {
  if (!resources || typeof resources !== 'object') return null;
  const keys = ['Money', 'Influence', 'Operations', 'Boost', 'Water', 'Volatiles', 'Metals', 'NobleMetals', 'Fissiles', 'Exotics'];
  const snapshot = {};
  for (const key of keys) {
    const value = toFiniteNumber(resources[key]);
    if (value !== null) snapshot[key] = value;
  }
  return Object.keys(snapshot).length > 0 ? snapshot : null;
}

function formatResourceSummary(resources) {
  if (!resources) return 'UNAVAILABLE';
  const labels = [
    ['Money', 'Money', 0],
    ['Influence', 'Influence', 0],
    ['Operations', 'Operations', 0],
    ['Boost', 'Boost', 1],
    ['Water', 'Water', 0],
    ['Volatiles', 'Volatiles', 0],
    ['Metals', 'Metals', 0],
    ['NobleMetals', 'Noble Metals', 0],
    ['Fissiles', 'Fissiles', 0],
    ['Exotics', 'Exotics', 0]
  ];
  const entries = labels
    .filter(([key]) => resources[key] !== undefined)
    .map(([key, label, decimals]) => `${label} ${formatNumber(resources[key], decimals)}`);
  return entries.length > 0 ? entries.join(', ') : 'UNAVAILABLE';
}

function getTopSkillString(attrs) {
  if (!attrs) return 'Standard';
  const skills = [
    { name: 'Administration', val: attrs.Administration || 0, code: 'ADM' },
    { name: 'Persuasion', val: attrs.Persuasion || 0, code: 'PER' },
    { name: 'Investigation', val: attrs.Investigation || 0, code: 'INV' },
    { name: 'Espionage', val: attrs.Espionage || 0, code: 'ESP' },
    { name: 'Command', val: attrs.Command || 0, code: 'CMD' },
    { name: 'Science', val: attrs.Science || 0, code: 'SCI' },
    { name: 'Security', val: attrs.Security || 0, code: 'SEC' }
  ];
  skills.sort((a, b) => b.val - a.val);
  const top = skills[0];
  return `${top.code} ${top.val} (${top.name})`;
}

module.exports = {
  // Re-exported so the briefing layer has one import for its primitives. The
  // definitions live in shared/util.mjs, where they are shared with the
  // snapshot reducers and the intel projections instead of being copied.
  asArray,
  sameId,
  ONE_TRILLION,
  toFiniteNumber,
  firstAvailableNumber,
  formatNumber,
  formatCount,
  formatPower,
  formatFactionGdp,
  formatTargetGdp,
  getResourceSnapshot,
  formatResourceSummary,
  getTopSkillString
};
