/**
 * Mining Expansion Board — Pure intelligence module.
 *
 * Implements:
 * 1. Mining capacity & quadratic MC / alien hate penalty model (M1).
 * 2. Template-derived reachability & destination tech mapping (M2).
 * 3. Need-weighted saturating marginal utility scoring (M3).
 */

const { MINE_LIMIT_GRANTS } = require('../shared/strategicSnapshot.mjs');
const { buildAlienHateEconomics } = require('../shared/alienHateEconomics.mjs');
const spaceTheater = require('./spaceTheater');
const templateLoader = require('./templateLoader');

const DEFAULT_TARGET_RUNWAY_MONTHS = 12;
const DEFAULT_SURPLUS_DISCOUNT = 0.05;

const THEATER_ACCESSIBILITY = Object.freeze({
  sol: 1.0,
  mars: 0.9,
  inner: 0.85,
  belt: 0.75,
  jupiter: 0.5,
  saturn: 0.35,
  outer: 0.2,
  unassigned: 0.1
});

const RESOURCE_KEY_MAPPING = Object.freeze([
  ['water', 'Water'],
  ['volatiles', 'Volatiles'],
  ['metals', 'Metals'],
  ['nobleMetals', 'NobleMetals'],
  ['fissiles', 'Fissiles']
]);

const MISSION_TECH_NAMES = Object.freeze({
  MissiontotheMoon: 'Mission to the Moon',
  MissiontoMars: 'Mission to Mars',
  MissiontotheInnerPlanets: 'Mission to the Inner Planets',
  MissiontoVenus: 'Mission to Venus',
  MissiontotheAsteroids: 'Mission to the Asteroids',
  MissiontoJupiter: 'Mission to Jupiter',
  MissiontoSaturn: 'Mission to Saturn',
  MissiontotheOuterPlanets: 'Mission to the Outer Planets'
});

const toNumOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * Derives the required destination mission exploration tech for a space body.
 */
function getDestinationTechForBody(bodyName) {
  if (!bodyName) return 'MissiontotheAsteroids';
  const normalized = String(bodyName).trim();
  const lower = normalized.toLowerCase();

  if (lower === 'luna' || lower === 'moon') return 'MissiontotheMoon';
  if (lower === 'mercury') return 'MissiontotheInnerPlanets';
  if (lower === 'venus') return 'MissiontoVenus';
  if (lower === 'mars' || lower === 'phobos' || lower === 'deimos') return 'MissiontoMars';

  // Check template lookup if available
  const bodyTemplate = templateLoader?.templates?.spaceBodies?.get(normalized) ||
    templateLoader?.templates?.spaceBodies?.get(bodyName);

  if (bodyTemplate) {
    const barycenter = String(bodyTemplate.barycenterName || '').toLowerCase();
    const dataName = String(bodyTemplate.dataName || '').toLowerCase();

    if (barycenter === 'earth' && dataName === 'luna') return 'MissiontotheMoon';
    if (barycenter === 'mars' || dataName === 'mars') return 'MissiontoMars';
    if (barycenter === 'jupiter' || dataName === 'jupiter') return 'MissiontoJupiter';
    if (barycenter === 'saturn' || dataName === 'saturn') return 'MissiontoSaturn';
    if (barycenter === 'uranus' || barycenter === 'neptune' || dataName === 'uranus' || dataName === 'neptune') {
      return 'MissiontotheOuterPlanets';
    }
    const semiMajor = Number(bodyTemplate.semiMajorAxis_AU);
    if (Number.isFinite(semiMajor)) {
      if (semiMajor > 4.5) return 'MissiontotheOuterPlanets';
      if (semiMajor <= 4.5 && semiMajor >= 0.7) return 'MissiontotheAsteroids';
      if (semiMajor < 0.7) return 'MissiontotheInnerPlanets';
    }
  }

  // Fallback by theater / name heuristics
  const theater = spaceTheater.classifyBody(normalized);
  if (theater === 'sol') return 'MissiontotheMoon';
  if (theater === 'mars') return 'MissiontoMars';
  if (theater === 'inner') return lower.includes('venus') ? 'MissiontoVenus' : 'MissiontotheInnerPlanets';
  if (theater === 'jupiter') return 'MissiontoJupiter';
  if (theater === 'saturn') return 'MissiontoSaturn';
  if (theater === 'outer') return 'MissiontotheOuterPlanets';

  return 'MissiontotheAsteroids';
}

/**
 * Computes mining capacity, usage, quadratic penalty, and alien hate conversion (M1).
 */
function buildMiningCapacity({
  observer = {},
  completedProjects = [],
  completedTechs = [],
  difficulty = 'Normal',
  habSites = []
} = {}) {
  const completedTechSet = new Set(Array.isArray(completedTechs) ? completedTechs : []);
  const completedProjectSet = new Set(Array.isArray(completedProjects) ? completedProjects : []);

  // Compute mine limit from mission techs + Gold Rush
  let mineLimit = 0;
  let hasMissionGrant = false;
  for (const [id, grant] of Object.entries(MINE_LIMIT_GRANTS)) {
    if (completedTechSet.has(id) || completedProjectSet.has(id)) {
      mineLimit += grant;
      hasMissionGrant = true;
    }
  }

  // Count observer mines across hab sites
  const observerId = observer.ID;
  const sites = Array.isArray(habSites) ? habSites : [];
  const observerMines = sites.filter(site =>
    site.mineModuleId != null &&
    Number(site.factionId) === Number(observerId)
  );
  const minesBuilt = observerMines.length;

  const headroom = Math.max(0, mineLimit - minesBuilt);
  const overLimit = minesBuilt > mineLimit;
  const excess = Math.max(0, minesBuilt - mineLimit);

  // Wiki: MC penalty past the limit is Max(1, Floor(excess^2 / 2))
  const penaltyMC = excess > 0 ? Math.max(1, Math.floor((excess * excess) / 2)) : 0;

  // Alien Hate Economics
  const hateEconomics = buildAlienHateEconomics({
    observer,
    difficulty,
    mode: 'omniscient'
  });

  const baseMultiplier = hateEconomics.baseMultiplier ?? (
    (hateEconomics.difficultyMultiplier ?? 0.3) * (hateEconomics.concealmentMultiplier ?? 1.0)
  );

  const penaltyHate = penaltyMC > 0 && baseMultiplier !== null
    ? Number((penaltyMC * baseMultiplier).toFixed(2))
    : 0;

  // Marginal cost of the NEXT mine
  const nextMinesBuilt = minesBuilt + 1;
  const nextExcess = Math.max(0, nextMinesBuilt - mineLimit);
  const nextPenaltyMC = nextExcess > 0 ? Math.max(1, Math.floor((nextExcess * nextExcess) / 2)) : 0;
  const marginalNextMinePenaltyMC = nextPenaltyMC - penaltyMC;
  const marginalNextMinePenaltyHate = marginalNextMinePenaltyMC > 0 && baseMultiplier !== null
    ? Number((marginalNextMinePenaltyMC * baseMultiplier).toFixed(2))
    : 0;

  // Distance to mcWarFloor
  const mcUsage = toNumOrNull(observer.missionControlUsage);
  const mcWarFloor = hateEconomics.mcWarFloor;
  const mcWarFloorDistance = (mcWarFloor !== null && mcUsage !== null)
    ? Math.max(0, Number((mcWarFloor - mcUsage).toFixed(1)))
    : null;

  return {
    minesBuilt,
    mineLimit: hasMissionGrant ? mineLimit : 0,
    headroom,
    overLimit,
    excess,
    penaltyMC,
    penaltyHate,
    marginalNextMinePenaltyMC,
    marginalNextMinePenaltyHate,
    mcWarFloorDistance,
    baseHateMultiplier: baseMultiplier,
    difficultyMultiplier: hateEconomics.difficultyMultiplier,
    concealmentMultiplier: hateEconomics.concealmentMultiplier
  };
}

/**
 * Computes runway and sufficiency per mined resource (M3).
 */
function buildResourceRunways(observer) {
  const stockMap = observer.resources || {};
  const incomeMap = observer.monthlyIncome || {};
  const netMap = observer.monthlyNet || {};
  const runways = {};

  for (const [key, saveKey] of RESOURCE_KEY_MAPPING) {
    const stock = toNumOrNull(stockMap[saveKey]);
    const income = toNumOrNull(incomeMap[saveKey]);
    const net = toNumOrNull(netMap[saveKey]);

    let consumption = null;
    if (income !== null && net !== null) {
      consumption = Math.max(0, income - net);
    }

    let runwayMonths = null;
    let status = 'unknown';

    if (stock === null) {
      status = 'unmeasured';
    } else if (consumption === null) {
      status = 'consumption_unknown';
    } else if (consumption === 0) {
      if (stock > 0 || (net !== null && net >= 0)) {
        status = 'surplus / no net consumption';
        runwayMonths = null; // Unbounded
      } else {
        status = 'depleted';
        runwayMonths = 0;
      }
    } else if (consumption > 0) {
      runwayMonths = Number((stock / consumption).toFixed(1));
      if (runwayMonths < 3) status = 'critical';
      else if (runwayMonths < 12) status = 'tight';
      else status = 'comfortable';
    }

    runways[key] = {
      key,
      saveKey,
      stock,
      income,
      net,
      consumption,
      runwayMonths,
      status
    };
  }

  return runways;
}

/**
 * Marginal utility function with TARGET runway saturation and discounted surplus.
 */
function evaluateUtility(sufficiency, target = DEFAULT_TARGET_RUNWAY_MONTHS, surplusDiscount = DEFAULT_SURPLUS_DISCOUNT) {
  if (sufficiency === null || !Number.isFinite(sufficiency) || sufficiency <= 0) {
    return 0;
  }
  if (sufficiency <= target) {
    return sufficiency / target;
  }
  return 1.0 + ((sufficiency - target) * surplusDiscount) / target;
}

/**
 * Evaluates candidate sites with need-weighted saturating scoring.
 */
function scoreSiteCandidate(site, runways, capacity, config = {}) {
  const target = config.targetRunwayMonths || DEFAULT_TARGET_RUNWAY_MONTHS;
  const surplusDiscount = config.surplusDiscount || DEFAULT_SURPLUS_DISCOUNT;
  const theaterKey = site.spaceTheaterKey || spaceTheater.classifyBody(site.parentBodyName);
  const theaterAccessibility = THEATER_ACCESSIBILITY[theaterKey] ?? THEATER_ACCESSIBILITY.unassigned;
  const siteDensity = Number.isFinite(Number(site.siteDensity)) ? Number(site.siteDensity) : 1.0;

  let totalUtilityGain = 0;
  const resourceGains = {};
  const yields = {};

  for (const [key] of RESOURCE_KEY_MAPPING) {
    const dailyRate = Number.isFinite(Number(site[key])) ? Number(site[key]) : 0;
    const monthlyYield = dailyRate * 30;
    yields[key] = { daily: Number(dailyRate.toFixed(3)), monthly: Number(monthlyYield.toFixed(1)) };

    const r = runways[key];
    if (!r || r.stock === null || r.consumption === null) continue;

    let gain = 0;
    if (r.consumption > 0) {
      const currentNet = r.net ?? 0;
      const currentStock = r.stock ?? 0;

      const suffBefore = Math.max(0, (currentStock + currentNet * 12) / r.consumption);
      const suffAfter = Math.max(0, (currentStock + (currentNet + monthlyYield) * 12) / r.consumption);

      const uBefore = evaluateUtility(suffBefore, target, surplusDiscount);
      const uAfter = evaluateUtility(suffAfter, target, surplusDiscount);
      gain = Math.max(0, uAfter - uBefore);
    } else if (r.consumption === 0) {
      // Zero consumption: resource is in unbounded surplus / no operational burn.
      // Additional yield provides 0 urgent utility.
      gain = 0;
    }

    resourceGains[key] = Number(gain.toFixed(4));
    totalUtilityGain += gain;
  }

  const siteValue = Number((totalUtilityGain * siteDensity * theaterAccessibility).toFixed(3));

  // Cost terms
  const mcCost = 1; // Standard Outpost Mining Complex + Outpost Core base MC
  const wouldExceedMineLimit = capacity.headroom <= 0;
  const baseMultiplier = capacity.baseHateMultiplier ?? 0.3;

  let hateCost = 0;
  if (wouldExceedMineLimit) {
    // Incorporates quadratic penalty from excess mine + base module MC
    hateCost = Number(((capacity.marginalNextMinePenaltyMC + mcCost) * baseMultiplier).toFixed(2));
  } else {
    hateCost = Number((mcCost * baseMultiplier).toFixed(2));
  }

  const valuePerHate = hateCost > 0
    ? Number((siteValue / hateCost).toFixed(3))
    : siteValue;

  return {
    siteId: site.ID,
    displayName: site.displayName,
    parentBodyName: site.parentBodyName,
    spaceTheaterKey: theaterKey,
    spaceTheaterName: site.spaceTheaterName || spaceTheater.theaterForBody(site.parentBodyName).name,
    siteDensity,
    yields,
    resourceGains,
    siteValue,
    mcCost,
    hateCost,
    wouldExceedMineLimit,
    valuePerHate,
    buildTimeDays: site.buildDurationDays || 60
  };
}

/**
 * Main pure builder for Mining Expansion Board (M1–M5).
 */
function buildMiningExpansion({
  snapshot,
  observerId = 4712,
  config = {}
} = {}) {
  const factions = Array.isArray(snapshot?.factions) ? snapshot.factions : [];
  const observer = factions.find(f => Number(f.ID) === Number(observerId)) ||
                   factions.find(f => String(f.displayName || '').toLowerCase().includes('initiative')) ||
                   factions[0] || {};

  const completedProjects = Array.isArray(observer.completedProjects)
    ? observer.completedProjects
    : Array.isArray(observer.finishedProjectNames)
      ? observer.finishedProjectNames
      : [];

  const completedTechs = Array.isArray(snapshot?.techTree?.finishedTechsNames)
    ? snapshot.techTree.finishedTechsNames
    : Array.isArray(snapshot?.globalResearch?.finishedTechNames)
      ? snapshot.globalResearch.finishedTechNames
      : [];

  const difficulty = snapshot?.metadata?.difficulty || 'Normal';
  const habSites = Array.isArray(snapshot?.habSites) ? snapshot.habSites : [];

  // M1: Capacity Model
  const capacity = buildMiningCapacity({
    observer,
    completedProjects,
    completedTechs,
    difficulty,
    habSites
  });

  // M3: Resource Runways
  const resourceRunways = buildResourceRunways(observer);

  // M2: Reachability & Tech Unlocks
  const completedTechSet = new Set(completedTechs);
  const completedProjectSet = new Set(completedProjects);

  // Mine module tech unlocked?
  const hasOutpostMineTech = completedProjectSet.has('Project_OutpostMiningComplex') ||
                             completedProjectSet.has('Project_AutomatedMiningComplex') ||
                             completedTechSet.has('Project_OutpostMiningComplex');

  // Filter to unowned sites (excluding pendingHab)
  const unownedSites = habSites.filter(site => {
    const isUnclaimed = site.factionId === null || site.factionId === undefined ||
      String(site.factionName || '').toLowerCase() === 'unclaimed';
    return isUnclaimed && !site.pendingHab;
  });

  const available = [];
  const techGatedMap = new Map();
  const unreachableBodies = {};
  const unreachableMissingTechs = {};
  let totalUnreachableSites = 0;

  for (const site of unownedSites) {
    const destTech = getDestinationTechForBody(site.parentBodyName);
    const destTechName = MISSION_TECH_NAMES[destTech] || destTech;
    const destTechCompleted = completedTechSet.has(destTech);

    const scored = scoreSiteCandidate(site, resourceRunways, capacity, config);

    if (destTechCompleted && hasOutpostMineTech) {
      available.push(scored);
    } else if (!destTechCompleted) {
      // Tech gated by destination tech
      if (!techGatedMap.has(destTech)) {
        techGatedMap.set(destTech, {
          missingTech: destTech,
          missingTechName: destTechName,
          siteCount: 0,
          bestSiteValue: 0,
          sites: []
        });
      }
      const entry = techGatedMap.get(destTech);
      entry.siteCount++;
      entry.bestSiteValue = Math.max(entry.bestSiteValue, scored.siteValue);
      entry.sites.push(scored);

      // Also track in unreachable summary
      unreachableBodies[site.parentBodyName] = (unreachableBodies[site.parentBodyName] || 0) + 1;
      unreachableMissingTechs[destTechName] = (unreachableMissingTechs[destTechName] || 0) + 1;
      totalUnreachableSites++;
    } else if (!hasOutpostMineTech) {
      // Tech gated by mine module project
      const missingMod = 'Project_OutpostMiningComplex';
      const missingModName = 'Outpost Mining Complex';
      if (!techGatedMap.has(missingMod)) {
        techGatedMap.set(missingMod, {
          missingTech: missingMod,
          missingTechName: missingModName,
          siteCount: 0,
          bestSiteValue: 0,
          sites: []
        });
      }
      const entry = techGatedMap.get(missingMod);
      entry.siteCount++;
      entry.bestSiteValue = Math.max(entry.bestSiteValue, scored.siteValue);
      entry.sites.push(scored);
    }
  }

  // Sort available candidates: zero-hate sites first by siteValue, then by valuePerHate
  available.sort((a, b) => {
    if (a.hateCost === 0 && b.hateCost === 0) {
      return b.siteValue - a.siteValue;
    }
    if (a.hateCost === 0) return -1;
    if (b.hateCost === 0) return 1;
    if (b.valuePerHate !== a.valuePerHate) {
      return b.valuePerHate - a.valuePerHate;
    }
    return b.siteValue - a.siteValue;
  });

  const techGated = Array.from(techGatedMap.values()).map(entry => ({
    ...entry,
    sites: entry.sites.sort((a, b) => b.siteValue - a.siteValue)
  })).sort((a, b) => b.bestSiteValue - a.bestSiteValue);

  return {
    capacity,
    resourceRunways,
    available,
    techGated,
    unreachable: {
      totalSites: totalUnreachableSites,
      byBody: unreachableBodies,
      missingTech: unreachableMissingTechs
    },
    assumptions: [
      `Target runway is ${config.targetRunwayMonths || DEFAULT_TARGET_RUNWAY_MONTHS} months (heuristic).`,
      'Theater accessibility multipliers are heuristic based on transfer time and defensibility.',
      'Rankings prioritize hate-free expansion headroom before sorting by value per unit of alien hate.'
    ]
  };
}

module.exports = {
  buildMiningCapacity,
  buildResourceRunways,
  evaluateUtility,
  scoreSiteCandidate,
  buildMiningExpansion,
  getDestinationTechForBody,
  THEATER_ACCESSIBILITY,
  MISSION_TECH_NAMES
};
