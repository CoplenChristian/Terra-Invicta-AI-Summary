// shared/intel/logistics.mjs
//
// Purpose: the war economy — stockpiles, gross vs net flows, resources
//   committed to queues, and production rolled up by body and site.
//
// The war economy: stockpiles, gross vs net flows, resources committed to
// queues, and production rolled up by body and site.

import { DEFAULT_OBSERVER_FACTION_ID, INITIATIVE_DISPLAY_NAME } from '../constants.mjs';
import { asArray, resolveObserverFaction, sameId } from '../util.mjs';
import { MINING_RESOURCES, rateMultiplier, zeroedBySaveKey } from './common.mjs';

/**
 * 1. Logistics: Exposes the actual war economy, gross vs net resource flows,
 * committed queues, and production by body/site.
 */
export const logisticsResource = (snapshot, observerId = DEFAULT_OBSERVER_FACTION_ID) => {
  const factions = asArray(snapshot.factions);
  const observer = resolveObserverFaction(factions, observerId, {
    fallbackDisplayName: INITIATIVE_DISPLAY_NAME,
    fallbackToFirst: true
  }) || {};
  const actualObsId = observer.ID || observerId;
  const stock = observer.resources || {};
  const sites = asArray(snapshot.habSites).filter(s => sameId(s.factionId, actualObsId));

  // The one MINING_RESOURCES table, read here through its stockpile spelling.
  // `saveKeyLower` reproduces the lookup order this reducer has always used on
  // a hab site: the lower-cased stockpile key first (matches water / volatiles
  // / metals / fissiles verbatim), then the reported alias, then the site's own
  // rate field -- which is the only spelling that resolves noble metals.
  const resourceKeys = MINING_RESOURCES.map(({ key, saveKey, alias, label }) => ({
    key: saveKey,
    saveKeyLower: saveKey.toLowerCase(),
    siteKey: key,
    alias,
    label
  }));

  // Upkeep from operational modules
  const ownModules = asArray(snapshot.habModules).filter(m => sameId(m.factionId, actualObsId) && m.constructionCompleted && m.powered !== false);
  const upkeepByResource = { ...zeroedBySaveKey(), Money: 0 };
  for (const mod of ownModules) {
    if (mod.resourceUpkeep) {
      for (const [k, v] of Object.entries(mod.resourceUpkeep)) {
        if (upkeepByResource[k] !== undefined) upkeepByResource[k] += Number(v) || 0;
      }
    }
  }

  // Committed resources in active build queues
  const committedByResource = zeroedBySaveKey();
  const ownQueues = asArray(snapshot.shipyardQueues).filter(q => sameId(q.factionId, actualObsId) && q.constructionStatus !== 'operational');
  for (const q of ownQueues) {
    for (const cost of asArray(q.resourcesCost)) {
      const resName = cost.resource || cost.name;
      if (committedByResource[resName] !== undefined) {
        committedByResource[resName] += Number(cost.amount) || 0;
      }
    }
  }
  const ownBuildingModules = asArray(snapshot.habModules).filter(m => sameId(m.factionId, actualObsId) && m.constructionStatus === 'building');
  for (const m of ownBuildingModules) {
    for (const cost of asArray(m.buildCost)) {
      const resName = cost.resource || cost.name;
      if (committedByResource[resName] !== undefined) {
        committedByResource[resName] += Number(cost.amount) || 0;
      }
    }
  }

  const productionByBody = {};
  const topSites = [];

  for (const s of sites) {
    const body = s.parentBodyName || 'Unknown';
    if (!productionByBody[body]) {
      productionByBody[body] = {
        ...Object.fromEntries(MINING_RESOURCES.map(({ alias }) => [alias, 0])),
        sitesCount: 0
      };
    }
    const mult = rateMultiplier(s);
    // Reads each rate through the site's own spelling (`nobleMetals`) and
    // reports it under the output alias (`nobles`). The `|| 0` coercion is the
    // one this reducer has always applied to a gross-production roll-up; only
    // the hand-written five-name table is gone.
    const yields = MINING_RESOURCES.map(({ key, alias }) => ({
      alias,
      value: (Number(s[key]) || 0) * mult
    }));
    const monthlyTotal = yields.reduce((sum, entry) => sum + entry.value, 0);

    for (const { alias, value } of yields) productionByBody[body][alias] += value;
    productionByBody[body].sitesCount += 1;

    if (s.mineModuleName && monthlyTotal > 0) {
      topSites.push({
        site: s.displayName,
        body,
        monthlyTotal: Number(monthlyTotal.toFixed(1)),
        yields: Object.fromEntries(
          yields.map(({ alias, value }) => [alias, Number(value.toFixed(1))])
        )
      });
    }
  }
  for (const body of Object.keys(productionByBody)) {
    for (const resKey of Object.keys(productionByBody[body])) {
      if (typeof productionByBody[body][resKey] === 'number') {
        productionByBody[body][resKey] = Number(productionByBody[body][resKey].toFixed(1));
      }
    }
  }
  topSites.sort((a, b) => b.monthlyTotal - a.monthlyTotal);

  const resources = resourceKeys.map(({ key, saveKeyLower, siteKey, alias, label }) => {
    const stockpile = Number((Number(stock[key]) || 0).toFixed(1));
    const grossDaily = sites.filter(s => s.mineModuleName)
      .reduce((sum, s) => sum + (Number(s[saveKeyLower] || s[alias] || s[siteKey]) || 0), 0);
    const grossMonthly = Number((grossDaily * 30).toFixed(1));
    const upkeepMonthly = Number((-1 * (upkeepByResource[key] || 0)).toFixed(1));
    const netMonthly = Number((grossMonthly + upkeepMonthly).toFixed(1));
    const committed = Number((committedByResource[key] || 0).toFixed(1));
    const availableAfterQueues = Number(Math.max(0, stockpile - committed).toFixed(1));

    return {
      resource: alias,
      label,
      stockpile,
      grossMonthly,
      upkeepMonthly,
      netMonthly,
      committedConstruction: committed,
      availableAfterQueues
    };
  });

  return {
    money: observer.resources?.Money || 0,
    boost: Number((observer.resources?.Boost || 0).toFixed(1)),
    missionControl: {
      used: observer.missionControlUsage ?? 0,
      cap: observer.missionControlCapacity ?? 0,
      available: Math.max(0, (observer.missionControlCapacity || 0) - (observer.missionControlUsage || 0))
    },
    resources,
    spent30d: observer.financials?.recent30Days?.expense ?? observer.monthlyExpense ?? null,
    spent90d: observer.financials?.recent30Days?.expense ? Number((observer.financials.recent30Days.expense * 3).toFixed(1)) : null,
    productionByBody,
    topSites: topSites.slice(0, 10)
  };
};
