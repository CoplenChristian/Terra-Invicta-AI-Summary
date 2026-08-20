// server/snapshot/numbers.js
//
// The numeric, date and resource-map primitives every snapshot reducer shares.
//
// These are the guards that implement this repo's "absent stays null" rule at
// the reducer level: `Number(null)` and `Number('')` are both 0, so presence
// has to be established before any coercion, and a value that cannot be
// computed reports null rather than a confident zero or a fabricated maximum.
// They are deliberately free of domain knowledge so a domain module can never
// quietly grow its own softer copy.

const { MS_PER_DAY } = require('../../shared/util.mjs');

function roundNumber(value, decimals = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const factor = 10 ** decimals;
  return Math.round(number * factor) / factor;
}

function firstNumericOrNull(...values) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

// Sum of a list where every entry must be present. Returns null if the list
// is empty or if any entry is unmeasured, because a partial sum reads as a
// complete one and understates the total without saying so.
function sumOrNull(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  let total = 0;
  for (const value of values) {
    const number = Number(value);
    if (value === null || value === undefined || value === '' || !Number.isFinite(number)) return null;
    total += number;
  }
  return total;
}

// Research completion as a percentage of total cost. Returns null when
// either side is unmeasured or the cost is zero: progress/0 is Infinity (or
// NaN when progress is 0 too), and Math.min(100, NaN) is NaN, not 100, so
// an unguarded divide leaks NaN into the payload.
function completionPercent(progress, totalCost) {
  const done = Number(progress);
  const cost = Number(totalCost);
  if (progress === null || progress === undefined || !Number.isFinite(done)) return null;
  if (totalCost === null || totalCost === undefined || !Number.isFinite(cost) || cost <= 0) return null;
  return Math.min(100, Math.round((done / cost) * 1000) / 10);
}

// A 0-100 power-score component. Returns null -- not 0, and not a fabricated
// 100 -- when either the measured value or its configured normalizer is
// missing, non-finite or non-positive, because x/0 is Infinity and
// Math.min(100, Infinity) silently reports a maximum score.
function normalizedScore(value, normalizer) {
  const measured = Number(value);
  const scale = Number(normalizer);
  if (value === null || value === undefined || !Number.isFinite(measured)) return null;
  if (!Number.isFinite(scale) || scale <= 0) return null;
  return Math.min(100, Math.round((measured / scale) * 100));
}

// `firstNumeric` used to return 0 when every candidate was absent, which made
// an unmeasured value indistinguishable from a measured zero. It has been
// removed in favour of `firstNumericOrNull`; absent stays null.

// Most recent measured entry in a history array, or null if it holds none.
// `Number(null) === 0` and `Number('') === 0` are both finite, so a history
// padded with nulls would otherwise report a confident zero.
function lastFiniteNumber(values) {
  if (!Array.isArray(values)) return null;
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const entry = values[index];
    if (entry === null || entry === undefined || entry === '') continue;
    const value = Number(entry);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function dateValueToIso(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) || parsed.getUTCFullYear() <= 1 ? null : parsed.toISOString();
  }
  if (typeof value !== 'object') return null;
  const year = Number(value.year);
  const month = Number(value.month);
  const day = Number(value.day);
  if (!Number.isFinite(year) || year <= 1 || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  const parsed = new Date(Date.UTC(
    year,
    Math.max(0, month - 1),
    day,
    Number(value.hour) || 0,
    Number(value.minute) || 0,
    Number(value.second) || 0,
    Number(value.millisecond) || 0
  ));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function roundResourceMap(resources = {}) {
  const names = [
    'Money', 'Influence', 'Operations', 'Research', 'Projects', 'Boost',
    'MissionControl', 'Water', 'Volatiles', 'Metals', 'NobleMetals',
    'Fissiles', 'Antimatter', 'Exotics'
  ];
  return Object.fromEntries(names.map(name => {
    const value = Number(resources?.[name] || 0);
    const decimals = ['Boost', 'Water', 'Volatiles', 'Metals', 'NobleMetals', 'Fissiles', 'Antimatter', 'Exotics'].includes(name)
      ? 2
      : 0;
    return [name, Number.isFinite(value) ? roundNumber(value, decimals) : 0];
  }));
}

function scaleResourceMap(resources = {}, scale = 1) {
  const rounded = roundResourceMap(resources);
  return Object.fromEntries(Object.entries(rounded).map(([name, value]) => [
    name,
    roundNumber(Number(value) * scale, name === 'Money' || name === 'Influence' || name === 'Operations' || name === 'Research' || name === 'Projects' || name === 'MissionControl' ? 2 : 3)
  ]));
}

function normalizeResourceCosts(value) {
  const costs = Array.isArray(value?.resourceCosts)
    ? value.resourceCosts
    : Array.isArray(value) ? value : [];
  return costs.map(cost => ({
    resource: cost?.resource || cost?.Resource || null,
    amount: firstNumericOrNull(cost?.value, cost?.Amount, cost?.amount)
  })).filter(cost => cost.resource && cost.amount !== null);
}

function summarizeRecentTransactions(transactions, gameTimeString, days = 30) {
  const gameDate = gameTimeString ? new Date(gameTimeString) : null;
  const endMs = gameDate && !Number.isNaN(gameDate.getTime()) ? gameDate.getTime() : null;
  const startMs = endMs === null ? null : endMs - days * MS_PER_DAY;
  const income = {};
  const expense = {};
  if (!transactions || typeof transactions !== 'object') {
    return { windowDays: days, income, expense, net: {}, source: 'save transaction ledger' };
  }
  for (const entries of Object.values(transactions)) {
    const list = Array.isArray(entries) ? entries : [];
    for (const entry of list) {
      const date = dateValueToIso(entry?.Date || entry?.date);
      const dateMs = date ? new Date(date).getTime() : null;
      if (startMs !== null && (dateMs === null || dateMs < startMs || dateMs > endMs)) continue;
      const resource = entry?.Resource || entry?.resource;
      const amount = Number(entry?.Amount ?? entry?.amount);
      if (!resource || !Number.isFinite(amount)) continue;
      const bucket = amount >= 0 ? income : expense;
      bucket[resource] = (bucket[resource] || 0) + Math.abs(amount);
    }
  }
  const resources = new Set([...Object.keys(income), ...Object.keys(expense)]);
  const net = {};
  for (const resource of resources) {
    net[resource] = (income[resource] || 0) - (expense[resource] || 0);
  }
  return {
    windowDays: days,
    income: scaleResourceMap(income, 1),
    expense: scaleResourceMap(expense, 1),
    net: scaleResourceMap(net, 1),
    source: 'save transaction ledger'
  };
}

module.exports = {
  roundNumber,
  firstNumericOrNull,
  sumOrNull,
  completionPercent,
  normalizedScore,
  lastFiniteNumber,
  dateValueToIso,
  roundResourceMap,
  scaleResourceMap,
  normalizeResourceCosts,
  summarizeRecentTransactions
};
