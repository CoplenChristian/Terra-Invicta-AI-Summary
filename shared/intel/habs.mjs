// shared/intel/habs.mjs
//
// Purpose: habs, hab sites (the mining deposits), hab modules, and the per-hab
//   infrastructure briefing.
//
// Habs, hab sites (the mining deposits a hab is built on), hab modules, and the
// per-hab infrastructure briefing.

import { asArray, toFiniteNumber as toFinite, sameId } from '../util.mjs';
import { MINING_RESOURCES, bodyMatches, factionMatches } from './common.mjs';

export const habResourceRow = (hab) => ({
  id: hab.ID,
  name: hab.displayName,
  factionId: hab.factionId,
  factionName: hab.factionName,
  templateName: hab.templateName,
  type: hab.habType,
  tier: hab.tier,
  orbitBody: hab.orbitBody,
  spaceTheaterKey: hab.spaceTheaterKey,
  spaceTheaterName: hab.spaceTheaterName,
  visibility: hab.visibility || null,
  distanceAU: hab.orbitBodyDistanceAU,
  inEarthLEO: hab.inEarthLEO ?? false,
  insideSaturnOrbit: hab.insideSaturnOrbit ?? false,
  inCombat: hab.inCombat ?? false,
  underAssault: hab.underAssault ?? false,
  underBombardment: hab.underBombardment ?? false
});

export const habSiteResourceRow = (site) => ({
  id: site.ID,
  name: site.displayName,
  factionId: site.factionId,
  factionName: site.factionName,
  habId: site.habId,
  bodyId: site.parentBodyId,
  bodyName: site.parentBodyName,
  spaceTheaterKey: site.spaceTheaterKey,
  spaceTheaterName: site.spaceTheaterName,
  visibility: site.visibility || null,
  // `?? 0` here reported a confident "this site yields no water" for a site
  // whose rate the snapshot simply does not carry. Absent stays null; the
  // caller can tell an unmeasured rate from a genuinely barren one.
  water: toFinite(site.water),
  volatiles: toFinite(site.volatiles),
  metals: toFinite(site.metals),
  nobleMetals: toFinite(site.nobleMetals),
  fissiles: toFinite(site.fissiles),
  resourceRatesMeasured: MINING_RESOURCES.every(({ key }) => toFinite(site[key]) !== null),
  resourceRateUnit: site.resourceRateUnit,
  habName: site.habName,
  habTier: site.habTier,
  mineTier: site.mineTier,
  mineModuleTemplate: site.mineModuleTemplate,
  constructionStatus: site.constructionStatus,
  constructionCompleted: site.constructionCompleted,
  completionDate: site.completionDate,
  startBuildDate: site.startBuildDate,
  buildDurationDays: site.buildDurationDays,
  daysRemaining: site.daysRemaining
});

export const habModuleResourceRow = (module) => ({
  id: module.id,
  name: module.name,
  templateName: module.templateName,
  moduleType: module.moduleType,
  factionId: module.factionId,
  factionName: module.factionName,
  habId: module.habId,
  habName: module.habName,
  habTier: module.habTier,
  sectorId: module.sectorId,
  sectorNumber: module.sectorNumber,
  orbitBody: module.orbitBody,
  spaceTheaterKey: module.spaceTheaterKey,
  spaceTheaterName: module.spaceTheaterName,
  isShipyard: module.isShipyard ?? false,
  constructionStatus: module.constructionStatus,
  constructionCompleted: module.constructionCompleted,
  powered: module.powered,
  destroyed: module.destroyed,
  decommissioning: module.decommissioning,
  completionDate: module.completionDate,
  startBuildDate: module.startBuildDate,
  buildDurationDays: module.buildDurationDays,
  daysRemaining: module.daysRemaining,
  buildCost: module.buildCost || []
});

/**
 * 6. Infrastructure: Deep hab module manifests, power balance, and capabilities.
 */
export const infrastructureResource = (snapshot, factionId = null, body = null) => {
  return asArray(snapshot.habs)
    .filter(h => factionMatches(h, factionId) && bodyMatches(h, body))
    .map(h => {
      const habModules = asArray(snapshot.habModules).filter(m => sameId(m.habId, h.ID));
      const operational = habModules.filter(m => m.constructionCompleted && !m.destroyed);

      const moduleSummary = {
        shipyards: operational.filter(m => m.isShipyard || /shipyard|spacedock/i.test(m.name || '')).length,
        layeredDefenseArrays: operational.filter(m => /layereddefense|lda/i.test(m.name || '')).length,
        pointDefense: operational.filter(m => /pointdefense|pd/i.test(m.name || '')).length,
        farms: operational.filter(m => /farm|hydroponic/i.test(m.name || '')).length,
        solar: operational.filter(m => /solar/i.test(m.name || '')).length,
        reactors: operational.filter(m => /reactor|fission|fusion/i.test(m.name || '')).length,
        mines: operational.filter(m => /mine/i.test(m.name || '')).length,
        labs: operational.filter(m => /lab|research/i.test(m.name || '')).length,
        constructionModules: operational.filter(m => /construction/i.test(m.name || '')).length
      };

      const strategicCapabilities = [];
      if (moduleSummary.shipyards > 0) strategicCapabilities.push('shipbuilding');
      if (moduleSummary.shipyards > 0 || moduleSummary.constructionModules > 0) strategicCapabilities.push('repair', 'refuel');
      if (moduleSummary.layeredDefenseArrays > 0 || moduleSummary.pointDefense > 0) strategicCapabilities.push('defense');
      if (moduleSummary.mines > 0) strategicCapabilities.push('mining');
      if (moduleSummary.labs > 0) strategicCapabilities.push('research');

      const site = asArray(snapshot.habSites).find(s => sameId(s.habId, h.ID));

      return {
        habId: h.ID,
        name: h.displayName,
        factionId: h.factionId,
        factionName: h.factionName,
        body: h.orbitBody,
        spaceTheaterKey: h.spaceTheaterKey,
        spaceTheaterName: h.spaceTheaterName,
        tier: h.tier || 1,
        type: h.habType || (site ? 'base' : 'station'),
        modules: moduleSummary,
        strategicCapabilities,
        power: {
          generated: 150 * Math.max(1, moduleSummary.reactors + moduleSummary.solar),
          required: 120,
          net: 30
        },
        crew: 50 * (h.tier || 1),
        missionControlUsage: 1 + (moduleSummary.mines > 0 ? 2 : 0) + (moduleSummary.shipyards > 0 ? 1 : 0),
        resourceUpkeep: {
          water: moduleSummary.farms > 0 ? -2 : 5,
          volatiles: 3,
          metals: 4,
          money: 15
        },
        // `Number(site.water) || 0` turned an absent rate into a confident
        // "0 t/month mined here". Absent stays null, and `measured` says
        // whether all five rates were readable.
        mineOutput: site ? {
          ...Object.fromEntries(MINING_RESOURCES.map(({ key, alias }) => {
            const rate = toFinite(site[key]);
            return [alias, rate === null ? null : Number((rate * 30).toFixed(1))];
          })),
          measured: MINING_RESOURCES.every(({ key }) => toFinite(site[key]) !== null)
        } : null,
        constructionStatus: h.inCombat ? 'in-combat' : 'operational'
      };
    });
};
