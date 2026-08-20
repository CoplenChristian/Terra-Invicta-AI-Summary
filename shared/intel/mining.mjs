// shared/intel/mining.mjs
//
// The mining economy as it stands: per-site yields, the sortable analysis
// board, and the scarcity-weighted ranking of unowned prospects.
//
// The forward-looking expansion model -- capacity, runways, alien-hate cost --
// lives in `miningExpansion.mjs`, which is a different question answered from
// different inputs.

import { asArray, toFiniteNumber as toFinite } from '../util.mjs';
import { MINING_RESOURCES, bodyMatches, factionMatches, siteMonthlyOutput } from './common.mjs';

export const miningResourceRow = (site) => {
  const output = siteMonthlyOutput(site);
  return {
  site: site.displayName,
  owner: site.factionName,
  siteId: site.ID,
  habId: site.habId,
  hab: site.habName,
  body: site.parentBodyName,
  bodyId: site.parentBodyId,
  spaceTheaterKey: site.spaceTheaterKey,
  spaceTheaterName: site.spaceTheaterName,
  visibility: site.visibility || null,
  // Per-resource columns follow the same rule as effectiveMonthlyOutput:
  // absent stays null. `?? 0` printed `water: 0, metals: 0` for a site whose
  // rates were never measured, which is indistinguishable in the output from
  // a site that was measured and found barren.
  water: toFinite(site.water),
  volatiles: toFinite(site.volatiles),
  metals: toFinite(site.metals),
  nobles: toFinite(site.nobleMetals),
  fissiles: toFinite(site.fissiles),
  effectiveMonthlyOutput: output.total,
  effectiveMonthlyOutputMeasured: output.complete,
  measuredResourceCount: output.measuredResources,
  resourceRateUnit: site.resourceRateUnit,
  mineTier: site.mineTier,
  mineModule: site.mineModuleTemplate,
  constructionStatus: site.constructionStatus,
  daysRemaining: site.daysRemaining,
  completionDate: site.completionDate,
  buildDurationDays: site.buildDurationDays
  };
};

/**
 * 9. Mining: Mining economy, sortable yields, and top colonization deposits.
 */
export const miningAnalysisResource = (snapshot, factionId = null, body = null, status = null, sort = null) => {
  let sites = asArray(snapshot.habSites).map(miningResourceRow);

  if (factionId !== null) sites = sites.filter(s => factionMatches(s, factionId));
  if (body) sites = sites.filter(s => bodyMatches(s, body));
  if (status === 'unclaimed') sites = sites.filter(s => !s.owner || s.owner === 'Unclaimed');

  if (sort === 'water') sites.sort((a, b) => b.water - a.water);
  else if (sort === 'volatiles') sites.sort((a, b) => b.volatiles - a.volatiles);
  else if (sort === 'metals') sites.sort((a, b) => b.metals - a.metals);
  else if (sort === 'nobles' || sort === 'nobleMetals') sites.sort((a, b) => b.nobles - a.nobles);
  else if (sort === 'fissiles') sites.sort((a, b) => b.fissiles - a.fissiles);

  const allSites = asArray(snapshot.habSites).map(miningResourceRow);
  const unclaimed = allSites.filter(s => !s.owner || s.owner === 'Unclaimed');

  const bestWater = [...unclaimed].sort((a, b) => b.water - a.water).slice(0, 5);
  const bestNobles = [...unclaimed].sort((a, b) => b.nobles - a.nobles).slice(0, 5);
  const bestFissiles = [...unclaimed].sort((a, b) => b.fissiles - a.fissiles).slice(0, 5);
  const ourBuildingMines = allSites.filter(s => s.owner === snapshot.observerFactionName && s.constructionStatus === 'building');

  return {
    items: sites,
    bestAvailableWaterSites: bestWater,
    bestAvailableNobleSites: bestNobles,
    bestAvailableFissileSites: bestFissiles,
    ourMinesUnderConstruction: ourBuildingMines
  };
};

/**
 * Mining prospects: ranks UNOWNED hab sites as expansion targets.
 *
 * Two percentiles are reported per resource, because "best of its type" and
 * "good in absolute terms" are different questions -- conflating them is what
 * produced the doctrine error of treating generic Common Carbonaceous sites
 * (shared by ~95 of 671 sites) as notable water/volatile producers.
 *
 * Scoring is scarcity-weighted, not raw yield: noble metals bind military
 * construction (17-38% of most component build costs, 0% for drives) and cap
 * far lower across the solar system than base metals, so an unweighted sum
 * would rank metal sites first and reproduce that same mistake.
 */
export const MINING_SCARCITY_WEIGHTS = Object.freeze({
  nobleMetals: 3.0,
  fissiles: 3.0,
  volatiles: 1.5,
  water: 1.0,
  metals: 1.0
});

// Derived from the one MINING_RESOURCES table so the site-rate field names can
// never drift from the stockpile keys they are compared against.
const MINING_RESOURCE_KEYS = Object.freeze(MINING_RESOURCES.map(r => r.key));

const percentileOf = (value, population) => {
  if (!Number.isFinite(value) || population.length === 0) return null;
  const below = population.filter(v => v < value).length;
  const equal = population.filter(v => v === value).length;
  // Midpoint rank, so a value tied with many others lands mid-band rather than
  // at the top -- which is exactly the Fortuna/Zelinda case.
  return Math.round(((below + equal / 2) / population.length) * 100);
};

export const miningProspectsResource = (snapshot, {
  weights = null,
  limit = null,
  theater = null
} = {}) => {
  const effectiveWeights = weights || snapshot.miningScarcityWeights || MINING_SCARCITY_WEIGHTS;
  const sites = asArray(snapshot.habSites);
  const rate = (site, key) => {
    const value = Number(site[key]);
    return Number.isFinite(value) ? value : 0;
  };

  // Global population per resource, across every site in the system.
  const globalPop = {};
  for (const key of MINING_RESOURCE_KEYS) globalPop[key] = sites.map(s => rate(s, key));

  // Population per mining profile, so "best of its type" is answerable.
  const byProfile = new Map();
  for (const site of sites) {
    const profile = site.mineModuleTemplate || site.miningProfileName || 'unknown';
    if (!byProfile.has(profile)) byProfile.set(profile, []);
    byProfile.get(profile).push(site);
  }

  // Raw yield alone ranks the outer system first -- Haumea, Makemake, Varuna --
  // which is useless to a fleet that cannot get there. Theater is therefore a
  // first-class filter, not a display field.
  const wantTheater = theater === null || theater === undefined
    ? null
    : String(theater).toLowerCase();

  const unowned = sites.filter(site => {
    const unclaimed = site.factionId === null || site.factionId === undefined
      || String(site.factionName || '').toLowerCase() === 'unclaimed';
    if (!unclaimed || site.pendingHab) return false;
    if (wantTheater === null) return true;
    return String(site.spaceTheaterKey || '').toLowerCase() === wantTheater
      || String(site.spaceTheaterName || '').toLowerCase() === wantTheater;
  });

  const scored = unowned.map(site => {
    const profile = site.mineModuleTemplate || site.miningProfileName || 'unknown';
    const peers = byProfile.get(profile) || [];

    const resources = {};
    let score = 0;
    for (const key of MINING_RESOURCE_KEYS) {
      const value = rate(site, key);
      const weight = effectiveWeights[key] ?? 1;
      score += value * weight;
      resources[key] = {
        perDay: value,
        globalPercentile: percentileOf(value, globalPop[key]),
        profilePercentile: percentileOf(value, peers.map(p => rate(p, key)))
      };
    }

    return {
      siteId: site.ID,
      name: site.displayName,
      body: site.parentBodyName,
      theater: site.spaceTheaterName || site.spaceTheaterKey || null,
      miningProfile: profile === 'unknown' ? null : profile,
      profilePeerCount: peers.length,
      resources,
      scarcityScore: Number(score.toFixed(3))
    };
  }).sort((a, b) => b.scarcityScore - a.scarcityScore);

  const ranked = limit ? scored.slice(0, Number(limit)) : scored;

  return {
    weights: effectiveWeights,
    totalSites: sites.length,
    unownedSites: unowned.length,
    ranked,
    note: 'Unowned sites only. profilePercentile ranks a site against others sharing its mining profile; globalPercentile ranks it against every site in the system.'
  };
};
