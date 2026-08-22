// shared/intel/miningExpansion.mjs
//
// Purpose: the forward-looking mining expansion board — mine-limit capacity and
//   its MC penalty, per-resource runways, and need-weighted site scoring.
//
// The forward-looking mining expansion board: mine-limit capacity and its
// quadratic Mission Control penalty, per-resource runways, the need-weighted
// saturating score for an unowned site, and the ranked partitioning into
// available / tech-gated / unreachable.
//
// `server/miningExpansion.js` is a thin CommonJS re-export of these same
// functions -- the two used to be parallel implementations and had already
// diverged on null discipline, so the scoring lives here (the runtime-agnostic
// side) and the server module calls in.

import { DEFAULT_OBSERVER_FACTION_ID } from '../constants.mjs';
import { asArray, toFiniteNumber as toFinite, resolveObserverFaction, sameId } from '../util.mjs';
import { buildAlienHateEconomics } from '../alienHateEconomics.mjs';
import {
  applyMiningTechBonus,
  buildMiningTechBonuses,
  MINING_BONUS_STATES
} from '../miningTechBonus.mjs';
import {
  buildMineModuleCapability,
  buildMineUpgradeOpportunities,
  MINE_MODULE_STATES
} from '../mineModuleOutput.mjs';
import { MINING_RESOURCES } from './common.mjs';

/**
 * How reachable each space theater is, as a multiplier on a site's value.
 *
 * A HEURISTIC, not a measurement: it stands in for transfer time and
 * defensibility, which is why a Titan deposit twice as rich as a Ceres one can
 * still rank below it. (In the pre-split file this table sat under a stray
 * "7. Alien Threat" heading that belonged to `alienThreat.mjs`.)
 */
export const EXPANSION_THEATER_ACCESSIBILITY = Object.freeze({
  sol: 1.0,
  mars: 0.9,
  inner: 0.85,
  belt: 0.75,
  jupiter: 0.5,
  saturn: 0.35,
  outer: 0.2,
  unassigned: 0.1
});

export const EXPANSION_MISSION_TECH_NAMES = Object.freeze({
  MissiontotheMoon: 'Mission to the Moon',
  MissiontoMars: 'Mission to Mars',
  MissiontotheInnerPlanets: 'Mission to the Inner Planets',
  MissiontoVenus: 'Mission to Venus',
  MissiontotheAsteroids: 'Mission to the Asteroids',
  MissiontoJupiter: 'Mission to Jupiter',
  MissiontoSaturn: 'Mission to Saturn',
  MissiontotheOuterPlanets: 'Mission to the Outer Planets'
});

export const EXPANSION_MINE_LIMIT_GRANTS = Object.freeze({
  MissiontotheMoon: 3,
  MissiontotheInnerPlanets: 3,
  MissiontoMars: 6,
  MissiontotheAsteroids: 6,
  MissiontoJupiter: 6,
  MissiontoSaturn: 6,
  MissiontotheOuterPlanets: 6,
  FutureTechSpaceScience: 1,
  Project_GoldRush: 6
});

/**
 * Destination mission tech required to reach a body, with the evidence that
 * produced the answer. `source` matters: the last branch is a HEURISTIC --
 * every body the theater table does not name (the ~100 numbered main-belt
 * asteroids in a live save, e.g. "18 Melpomene") falls through to
 * MissiontotheAsteroids. That is right for a main-belt rock and wrong for
 * anything else that lands there, so it is labelled rather than silently
 * presented as a template-derived fact.
 */
export const resolveBodyDestinationTech = (bodyName, spaceTheaterKey) => {
  const normalized = String(bodyName || '').trim().toLowerCase();
  if (normalized === 'luna' || normalized === 'moon') return { tech: 'MissiontotheMoon', source: 'body name' };
  if (normalized === 'mercury') return { tech: 'MissiontotheInnerPlanets', source: 'body name' };
  if (normalized === 'venus') return { tech: 'MissiontoVenus', source: 'body name' };
  if (normalized === 'mars' || normalized === 'phobos' || normalized === 'deimos') {
    return { tech: 'MissiontoMars', source: 'body name' };
  }

  const theater = String(spaceTheaterKey || '').toLowerCase();
  if (theater === 'sol') return { tech: 'MissiontotheMoon', source: 'space theater' };
  if (theater === 'mars') return { tech: 'MissiontoMars', source: 'space theater' };
  if (theater === 'inner') {
    return {
      tech: normalized.includes('venus') ? 'MissiontoVenus' : 'MissiontotheInnerPlanets',
      source: 'space theater'
    };
  }
  if (theater === 'jupiter') return { tech: 'MissiontoJupiter', source: 'space theater' };
  if (theater === 'saturn') return { tech: 'MissiontoSaturn', source: 'space theater' };
  if (theater === 'outer') return { tech: 'MissiontotheOuterPlanets', source: 'space theater' };
  if (theater === 'belt') return { tech: 'MissiontotheAsteroids', source: 'space theater' };
  return { tech: 'MissiontotheAsteroids', source: 'assumed main belt (body not in the theater table)' };
};

export const evaluateSaturatingUtility = (sufficiency, target = 12, surplusDiscount = 0.05) => {
  if (sufficiency === null || !Number.isFinite(sufficiency) || sufficiency <= 0) return 0;
  if (sufficiency <= target) return sufficiency / target;
  return 1.0 + ((sufficiency - target) * surplusDiscount) / target;
};

/**
 * Mine capacity, the quadratic over-limit MC penalty, and its alien-hate cost.
 *
 * The hate terms depend on the difficulty multiplier (Cinematic 0.05 / Normal
 * 0.30 / Veteran 0.60 / Brutal 1.00). An absent difficulty makes them UNKNOWN,
 * not free: `?? 0.3` invented Normal here and could be wrong by 20x, and a
 * penalty reported as 0 tells the player an over-limit mine is costless.
 */
export const buildMiningCapacity = ({
  observer = {},
  completedProjects = [],
  completedTechs = [],
  difficulty = null,
  habSites = []
} = {}) => {
  const completedTechSet = new Set(asArray(completedTechs));
  const completedProjectSet = new Set(asArray(completedProjects));

  let mineLimit = 0;
  let hasMissionGrant = false;
  for (const [id, grant] of Object.entries(EXPANSION_MINE_LIMIT_GRANTS)) {
    if (completedTechSet.has(id) || completedProjectSet.has(id)) {
      mineLimit += grant;
      hasMissionGrant = true;
    }
  }

  const sites = asArray(habSites);
  const minesBuilt = sites.filter(site =>
    site.mineModuleId != null && sameId(site.factionId, observer.ID)
  ).length;

  const headroom = Math.max(0, mineLimit - minesBuilt);
  const overLimit = minesBuilt > mineLimit;
  const excess = Math.max(0, minesBuilt - mineLimit);
  // Wiki: MC penalty past the limit is Max(1, Floor(excess^2 / 2)).
  const penaltyMC = excess > 0 ? Math.max(1, Math.floor((excess * excess) / 2)) : 0;

  const hateEconomics = buildAlienHateEconomics({ observer, difficulty, mode: 'omniscient' });
  const difficultyMultiplier = toFinite(hateEconomics.difficultyMultiplier);
  const concealmentMultiplier = toFinite(hateEconomics.concealmentMultiplier);
  const baseMultiplier = toFinite(hateEconomics.baseMultiplier) ?? (
    difficultyMultiplier !== null && concealmentMultiplier !== null
      ? difficultyMultiplier * concealmentMultiplier
      : null
  );

  const penaltyHate = baseMultiplier === null
    ? null
    : (penaltyMC > 0 ? Number((penaltyMC * baseMultiplier).toFixed(2)) : 0);

  const nextExcess = Math.max(0, (minesBuilt + 1) - mineLimit);
  const nextPenaltyMC = nextExcess > 0 ? Math.max(1, Math.floor((nextExcess * nextExcess) / 2)) : 0;
  const marginalNextMinePenaltyMC = nextPenaltyMC - penaltyMC;
  const marginalNextMinePenaltyHate = baseMultiplier === null
    ? null
    : (marginalNextMinePenaltyMC > 0
      ? Number((marginalNextMinePenaltyMC * baseMultiplier).toFixed(2))
      : 0);

  const mcUsage = toFinite(observer.missionControlUsage);
  const mcWarFloor = toFinite(hateEconomics.mcWarFloor);
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
    hateCostAvailable: baseMultiplier !== null,
    difficulty: hateEconomics.difficulty ?? null,
    difficultyMeasured: difficultyMultiplier !== null,
    difficultyMultiplier,
    concealmentMultiplier
  };
};

/**
 * Stock / income / net / consumption and the resulting runway per mined
 * resource. Every term is null when the save does not carry it, and `status`
 * distinguishes `unmeasured` and `consumption_unknown` from a real reading.
 */
export const buildMiningResourceRunways = (observer = {}) => {
  const stockMap = observer.resources || {};
  const incomeMap = observer.monthlyIncome || {};
  const netMap = observer.monthlyNet || {};
  const runways = {};

  for (const { key, saveKey } of MINING_RESOURCES) {
    const stock = toFinite(stockMap[saveKey]);
    const income = toFinite(incomeMap[saveKey]);
    const net = toFinite(netMap[saveKey]);

    const consumption = (income !== null && net !== null) ? Math.max(0, income - net) : null;

    let runwayMonths = null;
    let status = 'unknown';

    if (stock === null) {
      status = 'unmeasured';
    } else if (consumption === null) {
      status = 'consumption_unknown';
    } else if (consumption === 0) {
      if (stock > 0 || (net !== null && net >= 0)) {
        status = 'surplus / no net consumption';
        runwayMonths = null;
      } else {
        status = 'depleted';
        runwayMonths = 0;
      }
    } else {
      runwayMonths = Number((stock / consumption).toFixed(1));
      if (runwayMonths < 3) status = 'critical';
      else if (runwayMonths < 12) status = 'tight';
      else status = 'comfortable';
    }

    runways[key] = { key, saveKey, stock, income, net, consumption, runwayMonths, status };
  }

  return runways;
};

/**
 * Need-weighted saturating marginal utility for one unowned site.
 *
 * Two absent-vs-zero hazards live here and both have bitten before:
 *  - `Number.isFinite(Number(site.siteDensity))` is TRUE for null, so an
 *    explicitly-null density collapsed the whole site value to 0 while an
 *    absent one scored at full value. The 1.0 fallback is now applied
 *    deliberately and labelled as an assumption.
 *  - an absent daily rate coerced to a confident 0 t/day. It now reports
 *    unmeasured and is named in `unmeasuredResources`, so a partially scored
 *    site is distinguishable from a fully scored one.
 *
 * `config.miningTechBonus` is the observer's per-resource mine-output
 * multiplier (`shared/miningTechBonus.mjs`). The save stores the DEPOSIT rate,
 * not the mine's realised output, so a resource the observer holds a completed
 * project for yields 1.15x per grant more than `site[key]` says. Applying it
 * here is what stops the board ranking a water-rich site as though the
 * observer's water bonus did not exist. When the bonus cannot be resolved the
 * RAW figure stands, `yields[key].bonusApplied` is false and the reason is
 * carried -- never a silent claim that the multiplier is 1.
 *
 * THE MINE MODULE'S OWN MULTIPLIER IS DELIBERATELY NOT IN THIS SCORE. Every
 * site scored here is UNOWNED and carries no mine module -- 272 of 272 on the
 * measured save -- so applying one means DECIDING which tier gets built. The
 * score saturates, so a uniform assumed multiplier reorders the board rather
 * than scaling it (60 of 85 move between x1.00 and x1.25, 64 of 85 between
 * x1.25 and x1.50), and the top nine are identical under every multiplier
 * tested. `config.mineModuleCapability` therefore supplies a BAND over the
 * tiers the observer can actually build, published on each candidate as
 * `moduleMultiplier.projectedRange` and never folded into `siteValue`.
 * `shared/mineModuleOutput.mjs` carries the decision and its evidence.
 */
export const scoreMiningSiteCandidate = (site, runways, capacity, config = {}) => {
  const target = toFinite(config.targetRunwayMonths) ?? 12;
  const surplusDiscount = toFinite(config.surplusDiscount) ?? 0.05;
  const theaterKey = String(site.spaceTheaterKey || '').toLowerCase() || 'unassigned';
  const theaterAccessibility = EXPANSION_THEATER_ACCESSIBILITY[theaterKey]
    ?? EXPANSION_THEATER_ACCESSIBILITY.unassigned;

  const measuredDensity = toFinite(site.siteDensity);
  const siteDensity = measuredDensity ?? 1.0;

  const miningTechBonus = config.miningTechBonus || null;

  let totalUtilityGain = 0;
  const resourceGains = {};
  const yields = {};
  const unmeasuredResources = [];
  const bonusUnresolvedResources = [];

  for (const { key } of MINING_RESOURCES) {
    const dailyRate = toFinite(site[key]);
    if (dailyRate === null) {
      yields[key] = {
        daily: null,
        monthly: null,
        monthlyRaw: null,
        measured: false,
        bonusApplied: false,
        bonusMultiplier: null,
        bonusState: MINING_BONUS_STATES.unknown,
        bonusSource: null
      };
      unmeasuredResources.push(key);
      continue;
    }
    const rawMonthlyYield = dailyRate * 30;
    const adjusted = applyMiningTechBonus(rawMonthlyYield, miningTechBonus, key, { places: 1 });
    // The utility model must see the SAME figure the board reports, or the
    // ranking and the printed yield disagree. When the multiplier is unknown
    // `adjusted.value` is the raw figure, flagged, not a silent 1.0.
    const monthlyYield = adjusted.value;
    if (adjusted.state === MINING_BONUS_STATES.unknown) bonusUnresolvedResources.push(key);
    yields[key] = {
      daily: Number(dailyRate.toFixed(3)),
      monthly: monthlyYield,
      monthlyRaw: Number(rawMonthlyYield.toFixed(1)),
      measured: true,
      bonusApplied: adjusted.applied,
      bonusMultiplier: adjusted.multiplier,
      bonusState: adjusted.state,
      bonusSource: adjusted.source
    };

    const r = runways?.[key];
    // A measured consumption implies a measured net, but the net check stays
    // explicit so a future change to buildMiningResourceRunways cannot slip a
    // `?? 0` net back in -- that would read as "this faction burns nothing".
    if (!r || r.stock === null || r.consumption === null || (r.consumption > 0 && r.net === null)) {
      unmeasuredResources.push(key);
      continue;
    }

    let gain = 0;
    if (r.consumption > 0) {
      const suffBefore = Math.max(0, (r.stock + r.net * 12) / r.consumption);
      const suffAfter = Math.max(0, (r.stock + (r.net + monthlyYield) * 12) / r.consumption);
      gain = Math.max(0, evaluateSaturatingUtility(suffAfter, target, surplusDiscount)
        - evaluateSaturatingUtility(suffBefore, target, surplusDiscount));
    }

    resourceGains[key] = Number(gain.toFixed(4));
    totalUtilityGain += gain;
  }

  // A site where NOTHING could be evaluated -- no rate readable, or no runway
  // to weigh it against -- has an unknown value, not a value of zero. Zero
  // reads as "measured and worthless" and sorts it beside genuinely barren
  // rock. A PARTIAL evaluation still scores, on the part that was measured,
  // and carries `scoreInputsComplete: false`.
  const nothingEvaluated = unmeasuredResources.length >= MINING_RESOURCES.length;
  const siteValue = nothingEvaluated
    ? null
    : Number((totalUtilityGain * siteDensity * theaterAccessibility).toFixed(3));

  const mcCost = 1; // Outpost Mining Complex + Outpost Core base MC.
  const wouldExceedMineLimit = (toFinite(capacity?.headroom) ?? 0) <= 0;
  const baseMultiplier = toFinite(capacity?.baseHateMultiplier);
  const marginalPenaltyMC = toFinite(capacity?.marginalNextMinePenaltyMC) ?? 0;

  let hateCost = null;
  if (baseMultiplier !== null) {
    hateCost = wouldExceedMineLimit
      ? Number(((marginalPenaltyMC + mcCost) * baseMultiplier).toFixed(2))
      : Number((mcCost * baseMultiplier).toFixed(2));
  }

  const valuePerHate = (hateCost === null || siteValue === null)
    ? null
    : (hateCost > 0 ? Number((siteValue / hateCost).toFixed(3)) : siteValue);

  return {
    siteId: site.ID ?? null,
    displayName: site.displayName ?? null,
    parentBodyName: site.parentBodyName ?? null,
    spaceTheaterKey: theaterKey,
    spaceTheaterName: site.spaceTheaterName || site.parentBodyName || null,
    siteDensity,
    siteDensityMeasured: measuredDensity !== null,
    siteDensityAssumed: measuredDensity === null,
    siteDensitySource: measuredDensity === null
      ? 'assumed 1.0 (site template Density not resolved)'
      : 'site template Density',
    yields,
    resourceGains,
    unmeasuredResources,
    // Which of the five could not have their mine-output multiplier resolved.
    // Their `monthly` is the RAW deposit rate x30 and is a LOWER BOUND, which
    // is a different claim from "measured, and unbonused".
    bonusUnresolvedResources,
    yieldsBonusAdjusted: miningTechBonus?.available === true,
    scoreInputsComplete: unmeasuredResources.length === 0,
    siteValue,
    siteValueMeasured: siteValue !== null,
    mcCost,
    hateCost,
    hateCostAvailable: hateCost !== null,
    wouldExceedMineLimit,
    valuePerHate,
    // Unowned sites have no mine under construction, so the save carries no
    // build duration for them. Null, never 0 -- "instant" would be a lie.
    buildTimeDays: toFinite(site.buildDurationDays),
    // The mine module's own output multiplier, which is NOT in `siteValue`
    // above and says so. `multiplier: null` is the point: this site has no
    // mine, so there is nothing to read, and a 1.0 would claim an Outpost
    // complex that does not exist. `projectedRange` is the observer's own
    // buildable band and is an ESTIMATE -- a range rather than a point
    // precisely so it cannot be mistaken for a reading.
    moduleMultiplier: buildCandidateModuleBand(site, config.mineModuleCapability || null)
  };
};

/**
 * The unowned candidate's module-multiplier block: absent measurement, plus the
 * observer's buildable band as a labelled estimate.
 *
 * A site that somehow DOES carry a module (a snapshot that classed an owned
 * site as unowned) reports the measured multiplier rather than the band, so the
 * block never claims "no mine" about a site that has one.
 */
const buildCandidateModuleBand = (site, capability) => {
  const resolved = typeof site?.mineModuleTemplate === 'string' && site.mineModuleTemplate.trim() !== '';
  const range = capability?.projectedMultiplierRange || null;
  // Deliberately terse, and the reason is measured. The band and the reasoning
  // are IDENTICAL on every row -- they are facts about the observer, not about
  // the site -- so carrying them per row duplicated ~290 bytes across 357
  // emitted rows and grew this endpoint by 23%. They live ONCE at the top level
  // in `mineModuleCapability`, and `see` points there. What the row must carry
  // on its own is the part a reader could get wrong: that the multiplier is
  // NOT a number here, and that the score does not contain it.
  return {
    // Never 1.0. See shared/mineModuleOutput.mjs.
    multiplier: null,
    state: resolved ? MINE_MODULE_STATES.unknown : MINE_MODULE_STATES.notBuilt,
    excludedFromScore: true,
    projectedRangeAvailable: range !== null,
    see: 'mineModuleCapability'
  };
};

/**
 * Ordering: hate-free sites first, then value per unit of hate. A site whose
 * hate cost could NOT be evaluated sorts last on that key rather than being
 * compared as though it were free -- `null - number` coerces to 0 and would
 * otherwise rank an unassessable site alongside a costless one.
 */
export const compareMiningCandidates = (a, b) => {
  // Null never enters the arithmetic: `null - 5` is -5, which would rank an
  // unassessable site as though it were a measured zero.
  const byValue = (left, right) => {
    const lv = toFinite(left.siteValue);
    const rv = toFinite(right.siteValue);
    if (lv === null && rv === null) return 0;
    if (lv === null) return 1;
    if (rv === null) return -1;
    return rv - lv;
  };

  const aCostKnown = toFinite(a.hateCost) !== null;
  const bCostKnown = toFinite(b.hateCost) !== null;
  if (aCostKnown !== bCostKnown) return aCostKnown ? -1 : 1;
  if (!aCostKnown) return byValue(a, b);
  if (a.hateCost === 0 && b.hateCost === 0) return byValue(a, b);
  if (a.hateCost === 0) return -1;
  if (b.hateCost === 0) return 1;

  const aPer = toFinite(a.valuePerHate);
  const bPer = toFinite(b.valuePerHate);
  if (aPer === null && bPer !== null) return 1;
  if (bPer === null && aPer !== null) return -1;
  if (aPer !== null && bPer !== null && aPer !== bPer) return bPer - aPer;
  return byValue(a, b);
};

export const miningExpansionResource = (snapshot, {
  observerId = DEFAULT_OBSERVER_FACTION_ID,
  limit = null,
  theater = null,
  targetRunwayMonths = 12,
  surplusDiscount = 0.05
} = {}) => {
  const factions = asArray(snapshot?.factions);
  const observer = resolveObserverFaction(factions, observerId, {
    // Substring, not exact: this board is reached with a bare 'initiative'
    // observer often enough that the looser match is the behaviour it has
    // always had. Kept distinct from logisticsResource's exact-name step
    // rather than silently unified.
    fallbackDisplayName: 'initiative',
    fallbackMatch: 'contains',
    fallbackToFirst: true
  }) || {};

  const completedProjects = asArray(observer.completedProjects || observer.finishedProjectNames);
  // This board is written about the OBSERVER, and the observer's own completed
  // project list is the one list player mode does not truncate
  // (server/intelligenceFilter.js keeps `isObserver ? f.completedProjects :
  // f.completedProjects.slice(0, 5)`). Nothing here reads a rival's list, so
  // no other faction's mine bonuses can leak into player mode.
  //
  // `resolveObserverFaction` can fall back to the first faction when the
  // requested observer is not in the payload. That fallback faction's list is
  // NOT known to be complete, so the bonus resolves to `unknown` rather than to
  // whatever a rival's truncated five entries would imply.
  // `snapshot.observerFactionId` is the faction the payload was FILTERED for,
  // and that is the one whose project list survives player mode intact.
  const isRequestedObserver = observer.ID !== undefined && observer.ID !== null
    && (sameId(observer.ID, observerId) || sameId(observer.ID, snapshot?.observerFactionId));
  const miningTechBonus = buildMiningTechBonuses(observer, {
    projectListComplete: isRequestedObserver
  });
  // The tiers the observer can build. Same completeness gate as the tech
  // bonuses and for the same reason: player mode truncates a rival's completed
  // projects to five entries, so a band read from a fallback faction's list
  // would be wrong rather than absent.
  const mineModuleCapability = buildMineModuleCapability(observer, {
    projectListComplete: isRequestedObserver
  });
  const completedTechs = asArray(snapshot?.techTree?.finishedTechsNames || snapshot?.globalResearch?.finishedTechNames);
  const completedTechSet = new Set(completedTechs);
  const completedProjectSet = new Set(completedProjects);

  // `|| 'Normal'` re-invented the difficulty the save did not carry, and with
  // it the entire alien-hate cost side of this board (the floor multiplier is
  // Cinematic 0.05 / Normal 0.30 / Veteran 0.60 / Brutal 1.00). Absent stays
  // null and the hate terms report unavailable.
  const rawDifficulty = snapshot?.metadata?.difficulty;
  const difficulty = typeof rawDifficulty === 'string' && rawDifficulty.trim() !== ''
    ? rawDifficulty
    : null;
  const habSites = asArray(snapshot?.habSites);

  // 1. Capacity model (M1)
  const capacity = buildMiningCapacity({
    observer,
    completedProjects,
    completedTechs,
    difficulty,
    habSites
  });
  const { headroom, baseHateMultiplier: baseMultiplier } = capacity;

  // 2. Resource runways (M3)
  const resourceRunways = buildMiningResourceRunways(observer);

  // 3. Unowned site scoring & partitioning (M2 + M3)
  const hasOutpostMineTech = completedProjectSet.has('Project_OutpostMiningComplex') ||
                             completedProjectSet.has('Project_AutomatedMiningComplex') ||
                             completedTechSet.has('Project_OutpostMiningComplex');

  const wantTheater = theater ? String(theater).toLowerCase() : null;
  const unownedSites = habSites.filter(site => {
    const isUnclaimed = site.factionId === null || site.factionId === undefined ||
      String(site.factionName || '').toLowerCase() === 'unclaimed';
    if (!isUnclaimed || site.pendingHab) return false;
    if (wantTheater === null) return true;
    return String(site.spaceTheaterKey || '').toLowerCase() === wantTheater ||
           String(site.spaceTheaterName || '').toLowerCase() === wantTheater;
  });

  const available = [];
  const techGatedMap = new Map();
  const unreachableBodies = {};
  const unreachableMissingTechs = {};
  let totalUnreachableSites = 0;

  // `Math.max(0, null)` is 0, so folding an unassessable site into a group's
  // best value used to publish a confident 0 for it. Unmeasured sites are
  // counted separately and never move the best value.
  const addToGatedGroup = (techId, techLabel, candidate) => {
    if (!techGatedMap.has(techId)) {
      techGatedMap.set(techId, {
        missingTech: techId,
        missingTechName: techLabel,
        siteCount: 0,
        unmeasuredSiteCount: 0,
        bestSiteValue: null,
        sites: []
      });
    }
    const entry = techGatedMap.get(techId);
    entry.siteCount++;
    const value = toFinite(candidate.siteValue);
    if (value === null) {
      entry.unmeasuredSiteCount++;
    } else {
      entry.bestSiteValue = entry.bestSiteValue === null ? value : Math.max(entry.bestSiteValue, value);
    }
    entry.sites.push(candidate);
    return entry;
  };

  for (const site of unownedSites) {
    const destination = resolveBodyDestinationTech(
      site.parentBodyName,
      String(site.spaceTheaterKey || '').toLowerCase() || 'unassigned'
    );
    const destTech = destination.tech;
    const destTechName = EXPANSION_MISSION_TECH_NAMES[destTech] || destTech;
    const destTechCompleted = completedTechSet.has(destTech);

    const scored = scoreMiningSiteCandidate(site, resourceRunways, capacity, {
      targetRunwayMonths,
      surplusDiscount,
      miningTechBonus,
      mineModuleCapability
    });
    const candidate = {
      ...scored,
      destinationTech: destTech,
      destinationTechName: destTechName,
      destinationTechSource: destination.source
    };

    if (destTechCompleted && hasOutpostMineTech) {
      available.push(candidate);
    } else if (!destTechCompleted) {
      addToGatedGroup(destTech, destTechName, candidate);

      unreachableBodies[site.parentBodyName] = (unreachableBodies[site.parentBodyName] || 0) + 1;
      unreachableMissingTechs[destTechName] = (unreachableMissingTechs[destTechName] || 0) + 1;
      totalUnreachableSites++;
    } else if (!hasOutpostMineTech) {
      addToGatedGroup('Project_OutpostMiningComplex', 'Outpost Mining Complex', candidate);
    }
  }

  available.sort(compareMiningCandidates);

  const rankedAvailable = limit ? available.slice(0, Number(limit)) : available;
  const assumedDestinationCount = [...available, ...Array.from(techGatedMap.values()).flatMap(e => e.sites)]
    .filter(c => c.destinationTechSource && c.destinationTechSource.startsWith('assumed')).length;

  const descByValue = (a, b) => {
    const av = toFinite(a);
    const bv = toFinite(b);
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return bv - av;
  };
  const techGated = Array.from(techGatedMap.values()).map(entry => ({
    ...entry,
    sites: entry.sites.sort((a, b) => descByValue(a.siteValue, b.siteValue))
  })).sort((a, b) => descByValue(a.bestSiteValue, b.bestSiteValue));

  const unmeasuredAvailableCount = available.filter(c => c.siteValue === null).length;

  const bonusUnresolvedSiteCount = [...available, ...Array.from(techGatedMap.values()).flatMap(e => e.sites)]
    .filter(c => asArray(c.bonusUnresolvedResources).length > 0).length;

  // Upgrading an existing mine multiplies a site the observer ALREADY holds by
  // a measured factor and costs nothing against the mine limit, while the
  // candidates above each cost one of `capacity.headroom`. Both belong on the
  // same board or the board only ever argues for new claims.
  const mineUpgrades = buildMineUpgradeOpportunities({
    habSites,
    observerId: observer.ID ?? observerId,
    capability: mineModuleCapability,
    miningTechBonus,
    resources: MINING_RESOURCES,
    applyTechBonus: applyMiningTechBonus,
    sameId
  });

  return {
    capacity,
    resourceRunways,
    // The observer's per-resource mine-output multipliers, and what they were
    // applied to. `available: false` means the projected yields below are RAW
    // deposit rates and are a lower bound, not that the observer holds nothing.
    miningTechBonus,
    bonusUnresolvedSiteCount,
    // The mine complexes the observer can build, and the band they imply for a
    // site that does not have one yet. This is the ONLY projection on this
    // board and it is a range, never folded into a score.
    mineModuleCapability,
    // The measured half of the same term: what upgrading the observer's own
    // mines is worth, at zero cost against the mine limit. Every number here
    // comes from the save or the templates.
    mineUpgrades,
    available: rankedAvailable,
    availableTotalCount: available.length,
    availableOmittedCount: available.length - rankedAvailable.length,
    // Sites the runway model could not evaluate at all. Their siteValue is
    // null, not 0, so they are not silently ranked as worthless.
    availableUnmeasuredCount: unmeasuredAvailableCount,
    techGated,
    unreachable: {
      totalSites: totalUnreachableSites,
      byBody: unreachableBodies,
      missingTech: unreachableMissingTechs
    },
    assumptions: [
      `Target runway is ${targetRunwayMonths} months (heuristic).`,
      'Theater accessibility multipliers are heuristic based on transfer time and defensibility.',
      'Rankings prioritize hate-free expansion headroom before sorting by value per unit of alien hate.',
      capacity.hateCostAvailable
        ? `Alien-hate costs use the ${capacity.difficulty || 'measured'} floor multiplier ${capacity.baseHateMultiplier}.`
        : 'Alien-hate costs are UNAVAILABLE: the save carries no readable difficulty, and the floor multiplier '
          + '(Cinematic 0.05 / Normal 0.30 / Veteran 0.60 / Brutal 1.00) is what converts Mission Control into hate.',
      assumedDestinationCount > 0
        ? `${assumedDestinationCount} site(s) sit on bodies the space-theater table does not name; their destination `
          + 'tech is ASSUMED to be Mission to the Asteroids (correct for a numbered main-belt rock, a guess otherwise).'
        : 'Every scored site resolved its destination tech from a named body or a classified space theater.',
      // Projected yields are the save's DEPOSIT rate, and the mine module's own
      // 1.0x-4.0x miningModifier is still NOT applied to them, so an adjusted
      // yield remains a lower bound on what a built mine would deliver. Saying
      // so here is the difference between a labelled lower bound and a figure
      // presented as the finished answer.
      miningTechBonus.available
        ? (miningTechBonus.boostedResources.length > 0
          ? `Projected yields apply the observer's completed-project mine bonuses (${miningTechBonus.boostedResources
            .map(key => `${key} x${miningTechBonus.byResource[key].multiplier}`).join(', ')}); `
            + 'they still exclude the mine module\'s own miningModifier (1.0-4.0), so they are a lower bound.'
          : 'The observer holds no completed project that raises mine output, so projected yields are the raw '
            + 'deposit rates; they also exclude the mine module\'s own miningModifier (1.0-4.0).')
        : `Mining tech bonuses are UNRESOLVED (${miningTechBonus.unavailableReason}). Projected yields are `
          + 'RAW deposit rates and are a lower bound, NOT a measured "no bonus".',
      // The refusal, stated where a reader of the ranking will see it. Without
      // this line the ordering reads as though the module multiplier had been
      // accounted for and found not to matter.
      mineModuleCapability.projectedMultiplierRange !== null
        ? 'The mine module\'s own output multiplier is NOT in siteValue and does NOT affect this ranking. '
          + 'Every site here is unowned and has no module, so applying one would be a decision about which '
          + `tier gets built: the observer can build x${mineModuleCapability.projectedMultiplierRange.low} to `
          + `x${mineModuleCapability.projectedMultiplierRange.high}, and the score saturates, so a uniform `
          + 'assumed multiplier reorders the board rather than scaling it (measured: 64 of 85 candidates move '
          + 'between x1.25 and x1.50). Each row carries the band as an ESTIMATE instead.'
        : 'The mine module\'s own output multiplier is NOT in siteValue and does NOT affect this ranking, and '
          + `no band can be stated either: ${mineModuleCapability.available === true
            ? 'the observer has completed no mine-complex project'
            : mineModuleCapability.unavailableReason}.`,
      mineUpgrades.totalMonthlyGainMeasured && mineUpgrades.counts.available > 0
        ? `${mineUpgrades.counts.available} of the observer's own operational mines have a researched upgrade, `
          + 'which multiplies a site it already holds and costs NOTHING against the mine limit, while every '
          + 'candidate above costs one of the remaining headroom. See mineUpgrades — those figures are '
          + 'measured, not projected.'
        : 'No upgrade is available on the observer\'s own mines; see mineUpgrades.counts for why.'
    ]
  };
};
