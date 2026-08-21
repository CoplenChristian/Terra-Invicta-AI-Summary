// server/snapshot/factions.js
//
// Purpose: the faction-level roll-up — relationships, resources and income,
//   power scores, project state, and alien-activity rows.
//
// The faction-level roll-up: relationships, resources and income, power
// scores, project state, and the alien-activity rows that hang off regions.
//
// The power-score components all divide by a configured normalizer. A missing
// or zero normalizer used to produce Infinity -> Math.min(100, Infinity) -> a
// fabricated *perfect* 100. `normalizedScore` returns null instead and the
// composite drops the component rather than scoring it as excellent, which is
// why the weighted sum below re-derives its own denominator.

const templateLoader = require('../templateLoader');
const opportunityScorer = require('../opportunityScorer');
const { INITIATIVE_DISPLAY_NAME } = require('../../shared/constants.mjs');
const {
  roundNumber,
  firstNumericOrNull,
  sumOrNull,
  completionPercent,
  normalizedScore,
  roundResourceMap,
  scaleResourceMap,
  summarizeRecentTransactions
} = require('./numbers');
const { getFactionColor } = require('./lookups');

function normalizeFactionIntelligence(faction) {
  const normalizeEntries = (entries) => (Array.isArray(entries) ? entries : [])
    .map(entry => ({
      id: entry?.Key?.value ?? entry?.Key ?? null,
      typeName: entry?.Key?.$type || null,
      value: entry?.Value ?? null
    }))
    .filter(entry => entry.id !== null);

  return {
    milestones: Array.isArray(faction.milestones) ? faction.milestones : [],
    objectiveNames: faction.objectiveNames && typeof faction.objectiveNames === 'object'
      ? faction.objectiveNames
      : {},
    knownAlienSiteRegionIds: normalizeEntries(faction.knownAlienSites)
      .filter(entry => !entry.typeName || entry.typeName.includes('TIRegionState'))
      .map(entry => entry.id),
    intel: normalizeEntries(faction.intel),
    highestIntel: normalizeEntries(faction.highestIntel),
    alienInvestigations: faction.alienInvestigations || []
  };
}

function buildFactionIntelligence(rawFactions) {
  const factionIntelligence = {};
  for (const f of rawFactions) {
    const factionId = f.ID?.value;
    if (factionId) {
      factionIntelligence[factionId] = normalizeFactionIntelligence(f);
    }
  }
  return factionIntelligence;
}

// FactionHate is stored as a per-faction map in the save. Preserve it as
// an explicit, shallow relationship list so observer-relative screens can
// explain faction posture without exposing the raw save structure.
function buildFactionRelationships(rawFactions) {
  const factionRelationships = [];
  for (const source of rawFactions) {
    const sourceFactionId = source.ID?.value;
    if (!sourceFactionId || !Array.isArray(source.factionHate)) continue;
    for (const entry of source.factionHate) {
      const targetFactionId = entry?.Key?.value ?? entry?.Key?.Value ?? entry?.key?.value ?? entry?.key;
      const hate = entry?.Value ?? entry?.value;
      if (!targetFactionId || typeof hate !== 'number' || !Number.isFinite(hate)) continue;
      const target = rawFactions.find(f => f.ID?.value === targetFactionId);
      if (!target) continue;
      const roundedHate = Math.round(hate * 100) / 100;
      factionRelationships.push({
        sourceFactionId,
        sourceFactionName: source.displayName,
        targetFactionId,
        targetFactionName: target.displayName,
        hate: roundedHate,
        relationship: `HATE ${roundedHate.toFixed(2)}`,
        visibility: 'raw_save_only'
      });
    }
  }
  return factionRelationships;
}

function buildFactions(rawFactions, {
  councilors,
  habs,
  fleets,
  nations,
  controlPointsById,
  shipyardCountByFaction,
  shipyardQueues,
  habResearchByFaction,
  scoreWeights,
  scoreNormalizers,
  gameTimeString
}) {
  const factions = [];
  for (const f of rawFactions) {
    const factionId = f.ID?.value;
    if (!factionId) continue;

    const fCouncilors = councilors.filter(c => c.factionId === factionId);
    const fHabs = habs.filter(h => h.factionId === factionId);
    const fFleets = fleets.filter(fl => fl.factionId === factionId);
    const fShipsCount = fFleets.reduce((acc, fl) => acc + fl.shipsCount, 0);
    const fCombatPowerValues = fFleets
      .map(fl => fl.combatPower)
      .filter(value => typeof value === 'number' && Number.isFinite(value));
    const fCombatPower = fCombatPowerValues.length > 0
      ? Math.round(fCombatPowerValues.reduce((acc, value) => acc + value, 0))
      : null;

    // Controlled CPs and Nations
    const fCPs = Array.from(controlPointsById.values()).filter(cp => cp.factionId === factionId);
    const fNationIds = new Set(fCPs.map(cp => cp.nationId).filter(Boolean));
    const fNations = nations.filter(n => fNationIds.has(n.ID));
    const totalGdp = fNations.reduce((acc, n) => acc + (n.GDP || 0), 0);
    const totalPop = fNations.reduce((acc, n) => acc + (n.population || 0), 0);
    const totalBoost = fNations.reduce((acc, n) => acc + (n.boost || 0), 0);
    // A nation's research is split between its control points, not handed
    // whole to everyone holding one. Official wiki, Nations page (last
    // edited 2026-05-17): "The research, boost, mc and money (from funding
    // and spoils) produced by the nation is divided up equally among all of
    // its control points. Control points that have sustained a Crackdown or
    // are abandoned still get their share, but the owning faction does not
    // receive it." So a crackdown'd point stays in the denominator and drops
    // out of the numerator. Summing each nation whole -- what this did
    // before -- overstates every faction that shares a nation with a rival.
    const earthResearch = roundNumber(fNations.reduce((acc, n) => {
      const allCps = Array.isArray(n.controlPoints) ? n.controlPoints : [];
      if (allCps.length === 0) return acc;
      const earning = allCps.filter(cp => cp.factionId === factionId && cp.benefitsDisabled !== true).length;
      return acc + (n.research || 0) * (earning / allCps.length);
    }, 0), 2);

    // Research output has three candidate readings and they are not equal:
    //
    //  - Earth nations alone (what this used to report) omits every orbital
    //    lab and every org, so it is always short.
    //  - The 30-day transaction ledger (monthlyIncome.Research below) is a
    //    trailing realised total, so it lags a changing rate.
    //  - cachedYearlyRevenue is the game's own current annualised rate: it
    //    tracks the newest "Daily Income" ledger entry x 365.25 to within
    //    0.01% on the live save, across every faction. It already includes
    //    nations, orgs, hab modules and the faction base income.
    //
    // A figure the game states beats one we reconstruct, so the reported
    // rate wins when the save carries it. The recomputed sum is the fallback
    // for saves that do not, and both are published side by side below.
    const habResearch = habResearchByFaction.get(factionId) || { monthly: 0, modules: 0, unresolvedModules: 0 };
    const habResearchMonthly = habResearch.unresolvedModules > 0 ? null : habResearch.monthly;
    const computedMonthlyResearch = habResearchMonthly === null
      ? null
      : roundNumber(earthResearch + habResearchMonthly, 2);
    const reportedYearlyResearch = firstNumericOrNull(f.cachedYearlyRevenue?.Research);
    const reportedMonthlyResearch = reportedYearlyResearch === null
      ? null
      : roundNumber(reportedYearlyResearch / 12, 2);
    const totalResearch = reportedMonthlyResearch !== null
      ? reportedMonthlyResearch
      : computedMonthlyResearch;

    const recent30DayFlow = summarizeRecentTransactions(f.Transactions, gameTimeString, 30);
    const projectedMonthlyIncome = scaleResourceMap(f.cachedYearlyRevenue, 1 / 12);
    const monthlyIncome = recent30DayFlow.income;
    const monthlyExpense = recent30DayFlow.expense;
    const monthlyNet = recent30DayFlow.net;

    // Power Score Components (0-100 scales).
    //
    // Every one of these divides by a configured normalizer. A missing or
    // zero normalizer used to produce Infinity -> Math.min(100, Infinity) ->
    // a fabricated *perfect* 100, or NaN, depending on the numerator. A
    // score that cannot be computed is reported as null and is then dropped
    // from the weighted composite below rather than scored as excellent.
    const earthEconomyScore = normalizedScore(totalGdp, scoreNormalizers.gdp);
    const earthPoliticsScore = normalizedScore(fCPs.length, scoreNormalizers.controlPoints);
    const researchPowerScore = normalizedScore(totalResearch, scoreNormalizers.research);
    const spaceEconomyScore = normalizedScore(fHabs.length, scoreNormalizers.habs);
    const fleetPowerScore = normalizedScore(fCombatPower, scoreNormalizers.combatPower);
    const militaryPowerScore = normalizedScore(
      fNations.reduce((acc, n) => acc + (n.nukes || 0), 0),
      scoreNormalizers.nukes
    );

    const scoreComponents = [
      [earthEconomyScore, scoreWeights.earthEconomy],
      [earthPoliticsScore, scoreWeights.earthPolitics],
      [researchPowerScore, scoreWeights.researchPower],
      [spaceEconomyScore, scoreWeights.spaceEconomy],
      [fleetPowerScore, scoreWeights.fleetPower],
      [militaryPowerScore, scoreWeights.militaryPower]
    ].filter(([value, weight]) => typeof value === 'number' && Number.isFinite(value) && Number(weight) > 0);
    const totalScoreWeight = scoreComponents.reduce((sum, [, weight]) => sum + Number(weight), 0);
    const overallPower = totalScoreWeight > 0
      ? Math.round(scoreComponents.reduce((sum, [value, weight]) => sum + value * Number(weight), 0) / totalScoreWeight)
      : null;

    const completedProjects = Array.isArray(f.finishedProjectNames) ? f.finishedProjectNames : [];
    const availableProjects = Array.isArray(f.availableProjectNames) ? f.availableProjectNames : [];

    const currentProjects = (Array.isArray(f.currentProjectProgress) ? f.currentProjectProgress : []).map(p => {
      const projT = templateLoader.getProject(p.projectTemplateName);
      // Same rule as the global tech slots above: an unresolved project
      // template has an unknown cost, not a default one, and an unknown
      // cost cannot produce a completion percentage.
      const cost = firstNumericOrNull(projT?.researchCost);
      const acc = firstNumericOrNull(p.accumulatedResearch) ?? 0;
      return {
        projectId: p.projectTemplateName,
        displayName: projT?.friendlyName || p.projectTemplateName,
        // Which research slot holds this project. The save states it, and it is
        // the index into `researchWeights` below -- a project in a slot the
        // weight array does not reach receives no research at all. Absent stays
        // null: slot 0 is a real slot, so an unread slot must not become one.
        slot: firstNumericOrNull(p.slot),
        category: projT?.techCategory || null,
        accumulatedResearch: Math.round(acc),
        totalCost: cost,
        totalCostAvailable: cost !== null,
        totalCostSource: cost !== null
          ? 'game template researchCost'
          : 'unavailable: project template not resolved',
        percent: completionPercent(acc, cost)
      };
    });

    const fShipDesigns = (Array.isArray(f.shipDesigns) ? f.shipDesigns : []).map(d => ({
      ...d,
      factionId,
      factionName: f.displayName
    }));

    factions.push({
      ID: factionId,
      displayName: f.displayName,
      templateName: f.templateName,
      color: getFactionColor(f.displayName),
      resources: roundResourceMap(f.resources),
      monthlyIncome,
      monthlyExpense,
      monthlyNet,
      financials: {
        monthlyIncome,
        monthlyExpense,
        monthlyNet,
        monthlyFlowSource: 'last 30 days of the save transaction ledger',
        isRecurringEstimate: false,
        projectedMonthlyIncome,
        projectedMonthlyIncomeSource: 'cachedYearlyRevenue / 12',
        recent30Days: recent30DayFlow
      },
      // Unknown alien hate is NOT zero hate. Defaulting an unmeasured
      // faction to 0 reports the single most reassuring value the field can
      // take -- "the aliens have no grievance with you" -- from no evidence
      // at all, and every downstream war/veto check then reads safe.
      assessedAlienHateOfMe: firstNumericOrNull(f.assessedAlienHateOfMe),
      controlPointsCount: fCPs.length,
      nationsCount: fNations.length,
      totalGdp,
      totalPopulation: totalPop,
      totalBoost,
      totalResearch,
      researchBreakdown: {
        monthly: totalResearch,
        source: reportedMonthlyResearch !== null
          ? "save cachedYearlyRevenue.Research / 12 (the game's own current annualised rate)"
          : 'computed: Earth control-point share + completed hab module research',
        reportedMonthly: reportedMonthlyResearch,
        computedMonthly: computedMonthlyResearch,
        // Components of the fallback only. The reported rate also carries
        // org, trait, unused-Mission-Control and passive faction income,
        // which are not reconstructed here.
        earthControlPointShare: earthResearch,
        habModules: habResearchMonthly,
        habModuleCount: habResearch.modules,
        habModulesUnresolved: habResearch.unresolvedModules
      },
      habsCount: fHabs.length,
      fleetsCount: fFleets.length,
      shipsCount: fShipsCount,
      combatPower: fCombatPower,
      combatPowerAvailable: fFleets.some(fl => fl.combatPowerAvailable),
      councilorsCount: fCouncilors.length,
      powerScore: {
        overall: overallPower,
        earthEconomy: earthEconomyScore,
        earthPolitics: earthPoliticsScore,
        research: researchPowerScore,
        spaceEconomy: spaceEconomyScore,
        fleet: fleetPowerScore,
        military: militaryPowerScore,
        isEstimate: true,
        weights: scoreWeights
      },
      completedProjects,
      currentProjects,
      // The faction's pip weights, one entry per research slot, straight from
      // the save. Not normalised and not reordered: `researchWeights[i]` is the
      // weight for slot index `i`, and shared/researchSlots.mjs joins it to the
      // global tech slots and to `currentProjects[].slot` by that index.
      //
      // A save that does not carry the array yields null rather than [], so
      // "this faction assigns no pips anywhere" stays distinguishable from
      // "this snapshot does not carry pip weights".
      researchWeights: Array.isArray(f.researchWeights)
        ? f.researchWeights.map(weight => firstNumericOrNull(weight))
        : null,
      availableProjectsCount: availableProjects.length,
      availableProjectNames: availableProjects,
      missionControlUsage: Number.isFinite(Number(f.missionControlUsage)) ? Number(f.missionControlUsage) : null,
      // Mission Control capacity is useful context, but it is deliberately
      // kept separate from missionControlUsage because only used MC affects
      // the alien minimum-hate floor.
      //
      // A nation whose Mission Control the save does not carry contributes
      // an unknown amount, not zero, so the whole sum becomes unknown rather
      // than a total that silently understates capacity.
      missionControlCapacity: sumOrNull(fNations.map(nation => nation.missionControl)),
      shipyardCount: shipyardCountByFaction.get(factionId) || 0,
      shipyardQueueCount: shipyardQueues.filter(queue => queue.factionId === factionId).length,
      shipDesigns: fShipDesigns
    });
  }
  return factions;
}

function collectShipDesigns(rawFactions) {
  const allShipDesigns = [];
  for (const f of rawFactions) {
    const factionId = f.ID?.value;
    if (!factionId) continue;
    const rawDesigns = Array.isArray(f.shipDesigns) ? f.shipDesigns : [];
    for (const d of rawDesigns) {
      allShipDesigns.push({
        ...d,
        factionId,
        factionName: f.displayName
      });
    }
  }
  return allShipDesigns;
}

function buildActiveXenoforming(rawXenoforming, { regionsById }) {
  const activeXenoforming = [];
  for (const x of rawXenoforming) {
    if ((x.xenoformingLevel || 0) > 0) {
      const regionId = x.region?.value;
      const reg = regionId ? regionsById.get(regionId) : null;
      activeXenoforming.push({
        id: x.ID?.value,
        regionId,
        regionName: reg?.displayName || 'Unknown Region',
        level: Math.round((x.xenoformingLevel || 0) * 10) / 10
      });
    }
  }
  return activeXenoforming;
}

function buildAlienFacilities(rawAlienFacilities, { regionsById }) {
  const builtAlienFacilities = [];
  for (const af of rawAlienFacilities) {
    const currentHP = firstNumericOrNull(af.currentHP);
    if (af.built || (currentHP !== null && currentHP > 0)) {
      const regionId = af.region?.value;
      const reg = regionId ? regionsById.get(regionId) : null;
      builtAlienFacilities.push({
        id: af.ID?.value,
        regionId,
        regionName: reg?.displayName || 'Unknown Region',
        // A facility whose HP the save does not carry is not a pristine
        // 100 HP facility. Inventing full health understates how close it
        // is to destruction just as badly as inventing zero would overstate.
        currentHP,
        currentHPAvailable: currentHP !== null
      });
    }
  }
  return builtAlienFacilities;
}

// Seed a default target list for consumers that do not have an observer
// context yet. The API filter recomputes this for the selected observer.
function buildDefaultTargets(factions, nations, controlPointsByNationId) {
  const defaultObserverName = templateLoader.config.campaign?.defaultObserverFactionName || INITIATIVE_DISPLAY_NAME;
  const defaultObserver = factions.find(f => f.displayName === defaultObserverName) || factions[0];
  const defaultPriorityTarget = defaultObserver
    ? opportunityScorer.selectPriorityTargetFaction(factions, nations, defaultObserver.ID)
    : null;
  const servantTargets = defaultObserver && defaultPriorityTarget
    ? opportunityScorer.evaluateCampaignTargets(
      nations,
      controlPointsByNationId,
      defaultObserver.ID,
      defaultPriorityTarget.id,
      defaultPriorityTarget.name
    )
    : [];
  return { servantTargets, priorityTargetFaction: defaultPriorityTarget };
}

// Key Tech Matrix (Selected strategic projects across all factions)
function buildTechMatrix(keyProjects, { factions, rawFactions }) {
  return keyProjects.map(projId => {
    const projTemplate = templateLoader.getProject(projId);
    const row = {
      projectId: projId,
      displayName: projTemplate?.friendlyName || projId,
      category: projTemplate?.projectCategory || 'Special',
      effects: projTemplate?.effects || [],
      factions: {}
    };

    for (const f of factions) {
      const rawF = rawFactions.find(rf => rf.ID?.value === f.ID);
      const finished = (rawF?.finishedProjectNames || []).includes(projId);
      const current = (rawF?.currentProjectProgress || []).some(cp => cp.projectTemplateName === projId);
      const available = (rawF?.availableProjectNames || []).includes(projId);

      let status = 'locked';
      if (finished) status = 'completed';
      else if (current) status = 'researching';
      else if (available) status = 'available';

      row.factions[f.ID] = {
        factionName: f.displayName,
        status
      };
    }
    return row;
  });
}

module.exports = {
  normalizeFactionIntelligence,
  buildFactionIntelligence,
  buildFactionRelationships,
  buildFactions,
  collectShipDesigns,
  buildActiveXenoforming,
  buildAlienFacilities,
  buildDefaultTargets,
  buildTechMatrix
};
