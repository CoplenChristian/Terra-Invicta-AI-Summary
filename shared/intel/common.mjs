// shared/intel/common.mjs
//
// The primitives every intel projection shares: the one mining resource table,
// the filter predicates, cost normalisation, and the alien-faction lookup.
//
// Extracted from the 2,600-line `shared/intelResources.mjs` so a domain module
// can reuse a predicate instead of re-declaring it. Nothing in here changed in
// the split -- the definitions are the originals, moved.
//
// Like every module under `shared/`, this is plain ESM with NO Node built-ins
// and no imports outside `shared/`: the hosted Cloudflare worker cannot
// `require` CommonJS, and Node's `require(esm)` support lets the CommonJS
// server import it unchanged. `scripts/build_static_snapshot.js` copies the
// whole of `shared/` (this subdirectory included, recursively) beside the
// worker entry point at build time, so a new module here needs no build edit.

import { ALIEN_FACTION_ID, ALIEN_FACTION_DISPLAY_NAME } from '../constants.mjs';
import { asArray, toFiniteNumber as toFinite, sameId } from '../util.mjs';

/**
 * The one mining/economy resource table.
 *
 * The same five resources previously appeared as three separate inline tables
 * plus a bare key array, under three different spellings of noble metals:
 *   key     -- the hab-site rate field   (`site.nobleMetals`)
 *   saveKey -- the faction stockpile key (`faction.resources.NobleMetals`)
 *   alias   -- the reported output name  (`nobles`)
 * Reading one spelling out of a structure that uses another returns undefined,
 * which then coerces to 0 -- a silent, confident, wrong answer.
 */
export const MINING_RESOURCES = Object.freeze([
  Object.freeze({ key: 'water', saveKey: 'Water', alias: 'water', label: 'Water' }),
  Object.freeze({ key: 'volatiles', saveKey: 'Volatiles', alias: 'volatiles', label: 'Volatiles' }),
  Object.freeze({ key: 'metals', saveKey: 'Metals', alias: 'metals', label: 'Metals' }),
  Object.freeze({ key: 'nobleMetals', saveKey: 'NobleMetals', alias: 'nobles', label: 'Noble metals' }),
  Object.freeze({ key: 'fissiles', saveKey: 'Fissiles', alias: 'fissiles', label: 'Fissiles' })
]);

/**
 * A fresh accumulator keyed by the save's own stockpile spelling, in table
 * order. Written out twice as a literal before, which is how a resource key
 * gets added to one accumulator and forgotten in the other.
 */
export const zeroedBySaveKey = () => Object.fromEntries(MINING_RESOURCES.map(({ saveKey }) => [saveKey, 0]));

export const normalizeBody = (value) => String(value || '')
  .trim()
  .replace(/^\d+\s+/, '')
  .replace(/\s+/g, ' ')
  .toLowerCase();

export const factionMatches = (item, factionId) => {
  if (factionId === null || factionId === undefined) return true;
  const controlPointIds = asArray(item.controlPoints).map(cp => cp?.factionId);
  // `item.id` is read alongside `item.ID` only because a few projections
  // re-emit their rows with a lowercased key before this predicate sees them.
  // The save itself carries `ID`; nothing here may rely on `id` existing.
  return [item.ID, item.id, item.factionId, item.executiveFactionId, ...controlPointIds]
    .some(id => sameId(id, factionId));
};

export const bodyMatches = (item, body) => {
  if (!body) return true;
  const itemBody = item.orbitBody || item.parentBodyName || item.body || item.location;
  return normalizeBody(itemBody) === normalizeBody(body);
};

export const destinationMatches = (item, destination) => {
  if (!destination) return true;
  const target = item.destination || item.destinationId || item.orbitBody;
  return normalizeBody(target) === normalizeBody(destination);
};

export const rateMultiplier = (site) => {
  return String(site?.resourceRateUnit || '').toLowerCase().includes('month') ? 1 : 30;
};

export const normalizeCostObject = (cost) => {
  const result = { water: 0, volatiles: 0, metals: 0, nobles: 0, fissiles: 0, money: 0, boost: 0 };
  if (!cost) return result;
  if (Array.isArray(cost)) {
    for (const entry of cost) {
      const name = String(entry.resource || entry.name || '').toLowerCase();
      const amount = Number(entry.amount || entry.value || 0);
      if (name.includes('water')) result.water += amount;
      else if (name.includes('volatile')) result.volatiles += amount;
      else if (name.includes('noble')) result.nobles += amount;
      else if (name.includes('metal')) result.metals += amount;
      else if (name.includes('fissile')) result.fissiles += amount;
      else if (name.includes('money')) result.money += amount;
      else if (name.includes('boost')) result.boost += amount;
    }
  } else if (typeof cost === 'object') {
    for (const [k, v] of Object.entries(cost)) {
      const name = k.toLowerCase();
      const amount = Number(v) || 0;
      if (name.includes('water')) result.water += amount;
      else if (name.includes('volatile')) result.volatiles += amount;
      else if (name.includes('noble')) result.nobles += amount;
      else if (name.includes('metal')) result.metals += amount;
      else if (name.includes('fissile')) result.fissiles += amount;
      else if (name.includes('money')) result.money += amount;
      else if (name.includes('boost')) result.boost += amount;
    }
  }
  for (const k of Object.keys(result)) {
    result[k] = Number(result[k].toFixed(1));
  }
  return result;
};

// Total monthly yield across the five mined resources.
//
// A site with no measured rates at all is UNMEASURED, not a zero producer:
// `(site.water || 0) + ...` used to report a confident 0 t/month for a site
// whose rates were simply absent from the snapshot, which is indistinguishable
// in the output from a genuinely barren site. Partial coverage is summed but
// labelled, so a caller can tell a complete reading from a partial one.
export const siteMonthlyOutput = (site) => {
  const measured = MINING_RESOURCES
    .map(({ key }) => toFinite(site?.[key]))
    .filter(value => value !== null);
  if (measured.length === 0) {
    return { total: null, measuredResources: 0, complete: false };
  }
  const total = measured.reduce((sum, value) => sum + value, 0) * rateMultiplier(site);
  return {
    total: Number(total.toFixed(1)),
    measuredResources: measured.length,
    complete: measured.length === MINING_RESOURCES.length
  };
};

export const findAlienFaction = (snapshot) => {
  const factions = asArray(snapshot.factions);
  return factions.find(faction => sameId(faction.ID, ALIEN_FACTION_ID) || faction.displayName === ALIEN_FACTION_DISPLAY_NAME) || null;
};
