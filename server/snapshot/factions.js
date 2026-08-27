// server/snapshot/factions.js
//
// Purpose: the faction-level roll-up — relationships, resources and income,
//   power scores, project state, alien-activity rows and the investigation count.
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
const { templateDisplayName } = require('../localization');
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
const {
  RESEARCH_COST_SCALING_UNKNOWN,
  effectiveResearchCost,
  researchCostBasis
} = require('../../shared/researchCostScaling.mjs');
const {
  CONTROL_POINT_OVERAGE_PENALTY_MULTIPLIER
} = require('../../shared/controlPointCap.mjs');

/**
 * One slot of `history_*CapOverageByDay`, by age in days.
 *
 * Slot 0 is today. Absent, short, or non-numeric stays null -- a slot that was
 * never written is not a measured zero, and `Number(null) === 0` would report
 * an unrecorded faction as comfortably within its cap.
 */
function readControlPointCapPenalty(history, ageInDays) {
  if (!Array.isArray(history) || history.length <= ageInDays) return null;
  return firstNumericOrNull(history[ageInDays]);
}

/**
 * The mean of the whole penalty window -- what the game actually applies to
 * missions defending this faction's control points.
 *
 * Refuses on any unreadable slot rather than averaging the readable ones: a
 * mean over a short window is a different (and smaller) number than a mean over
 * the full one, and nothing downstream could tell them apart.
 */
function averageOrNull(history) {
  if (!Array.isArray(history) || history.length === 0) return null;
  let total = 0;
  for (const slot of history) {
    const value = firstNumericOrNull(slot);
    if (value === null) return null;
    total += value;
  }
  return total / history.length;
}

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
    // A plain integer in the save, not a list. `|| []` turned a genuine 0 and
    // an absent field alike into an empty array, which then read as "zero
    // investigations" downstream. Absent stays null; zero stays zero.
    alienInvestigations: firstNumericOrNull(faction.alienInvestigations)
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

/**
 * The game's own per-faction `ControlPointMaintenance` effect lists.
 *
 * `TIEffectsState.factionEffectsNames` is a list of `{ Key: factionId, Value:
 * { <context>: [effectName, ...] } }`. This is the authoritative source for
 * which cap-raising effects a faction actually holds, and it is NOT the same as
 * sweeping `finishedProjectNames` against the project templates: the Aliens
 * hold four `ControlPointMaintenance` effects granted by none of the 32
 * projects that grant them (measured 2026-08-22 on `ExitSave.gz`), because two
 * of the five effects list `initialFactionsStr: ["AlienCouncil", ...]` and are
 * handed out at campaign start.
 *
 * A faction with no row gets no entry, so a consumer can tell "this faction
 * holds no such effect" (empty array) apart from "this snapshot does not carry
 * the effect state" (absent) -- the second must not read as zero cap.
 */
function buildControlPointMaintenanceEffects(rawEffects) {
  const byFaction = new Map();
  const rows = Array.isArray(rawEffects) && rawEffects.length > 0
    ? rawEffects[0]?.factionEffectsNames
    : null;
  if (!Array.isArray(rows)) return byFaction;

  for (const row of rows) {
    const factionId = row?.Key?.value ?? row?.Key ?? null;
    if (factionId === null || factionId === undefined) continue;
    const contexts = row?.Value;
    if (!contexts || typeof contexts !== 'object') continue;
    const list = contexts.ControlPointMaintenance;
    byFaction.set(factionId, Array.isArray(list) ? list.slice() : []);
  }
  return byFaction;
}

/**
 * The game's own per-faction `SpaceMiningBonus` effect lists.
 *
 * Same source and same shape as `buildControlPointMaintenanceEffects` above,
 * and kept as a separate reader rather than folded into it so neither can move
 * the other's contract. It is deliberately NOT derived from
 * `finishedProjectNames`: **no project grants `Effect_SpaceMiningBonus5`** —
 * the only two grants in the shipped templates are the narrative events
 * `event_Breakthrough_Hab` and `event_ScienceTour` (`TINarrativeEventTemplate.json`,
 * read 2026-08-22) — and the Resistance holds it on `ExitSave.gz`. A project
 * sweep therefore scores that faction 0.05 short and its mined output 5% low.
 *
 * A faction with no row gets no entry, so a consumer can tell "this faction
 * holds no such effect" (empty array) apart from "this snapshot does not carry
 * the effect state" (absent) — the second must not read as a x1.0 bonus.
 */
function buildSpaceMiningBonusEffects(rawEffects) {
  const byFaction = new Map();
  const rows = Array.isArray(rawEffects) && rawEffects.length > 0
    ? rawEffects[0]?.factionEffectsNames
    : null;
  if (!Array.isArray(rows)) return byFaction;

  for (const row of rows) {
    const factionId = row?.Key?.value ?? row?.Key ?? null;
    if (factionId === null || factionId === undefined) continue;
    const contexts = row?.Value;
    if (!contexts || typeof contexts !== 'object') continue;
    const list = contexts.SpaceMiningBonus;
    byFaction.set(factionId, Array.isArray(list) ? list.slice() : []);
  }
  return byFaction;
}

/**
 * The game's own per-faction `ShipConstructionTime` effect lists.
 *
 * Same source and same shape as `buildControlPointMaintenanceEffects` and
 * `buildSpaceMiningBonusEffects` above, kept as a separate reader so neither
 * can move the other's contract. This is the research half of the faction's
 * ship-build-time multiplier consumed by `shared/shipBuildTime.mjs`, and it
 * CANNOT be derived from a completed-project sweep: the Resistance holds
 * `Effect_ShipConstructionTimeReduction5` (x0.95) granted by a NARRATIVE EVENT,
 * not by any project that ships with the game (measured 2026-08-26 on the
 * live save), so a project sweep would score it 1.25% short on every build.
 *
 * A faction with no row gets no entry, so a consumer can tell "this faction
 * holds no such effect" (empty array) apart from "this snapshot does not carry
 * the effect state" (absent) — the second must not read as a x1.0 build time.
 */
function buildShipConstructionTimeEffects(rawEffects) {
  const byFaction = new Map();
  const rows = Array.isArray(rawEffects) && rawEffects.length > 0
    ? rawEffects[0]?.factionEffectsNames
    : null;
  if (!Array.isArray(rows)) return byFaction;

  for (const row of rows) {
    const factionId = row?.Key?.value ?? row?.Key ?? null;
    if (factionId === null || factionId === undefined) continue;
    const contexts = row?.Value;
    if (!contexts || typeof contexts !== 'object') continue;
    const list = contexts.ShipConstructionTime;
    byFaction.set(factionId, Array.isArray(list) ? list.slice() : []);
  }
  return byFaction;
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
  controlPointMaintenanceEffectsByFaction = null,
  spaceMiningBonusEffectsByFaction = null,
  shipConstructionTimeEffectsByFaction = null,
  gameTimeString,
  // The campaign research-cost scaler from `shared/researchCostScaling.mjs`.
  // Absent (an older caller, a hand-built test snapshot) degrades to the
  // unknown block, which returns template costs UNCHANGED and labels them --
  // never a silent divide-by-one presented as a checked figure.
  researchCostScaling = RESEARCH_COST_SCALING_UNKNOWN
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
      //
      // EFFECTIVE, not template. Measured 2026-08-22: the campaign's
      // `researchSpeedMultiplier` acts on the research COST, not on the
      // income -- the observer's own 10,000-point Gas Core Fission Reactor VI
      // completed from 4,708.568 accumulated inside 15.5 days at a measured
      // 30.2467 points/day, which reaches 5,000 and cannot reach 10,000. The
      // template figure made every completion percentage on this campaign
      // read half what the game shows. See shared/researchCostScaling.mjs.
      const templateCost = firstNumericOrNull(projT?.researchCost);
      const cost = effectiveResearchCost(templateCost, researchCostScaling);
      const acc = firstNumericOrNull(p.accumulatedResearch) ?? 0;
      return {
        projectId: p.projectTemplateName,
        displayName: templateDisplayName(projT, p.projectTemplateName),
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
          ? `game template researchCost, ${researchCostBasis(researchCostScaling)}`
          : 'unavailable: project template not resolved',
        // The unscaled template figure, kept beside the effective one so a
        // reader can see what was divided and by what rather than having to
        // trust that something was.
        templateResearchCost: templateCost,
        researchCostScalingState: researchCostScaling?.state ?? null,
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
      // ---- the three inputs to the project-slot research bonus -------------
      //
      // `ProjectBonus = min(100%, max(0, Projects - orgSlotSpent - habSlotSpent)
      // x 5%)` is what makes a project slot deliver 1.885714x a global-tech pip
      // on this observer, and it is the term that turns the allocation model
      // from a fit into a test. The RULE lives in
      // shared/researchAllocationPricing.mjs so both runtimes apply the same
      // one; only its inputs are published here.
      //
      // Absent stays null, and the two flags stay BOOLEAN rather than being
      // coerced: an unread flag means the number of points already spent on
      // slot unlocks is unknown, which makes the remaining count unknown --
      // not equal to the total. `computeProjectBonus` refuses on either.
      //
      // `cachedYearlyRevenue.Projects` is a stock of Projects points despite
      // sitting in a "yearly revenue" map (the observer reads 21 while
      // `financials.projectedMonthlyIncome.Projects` reads 1.75, which is that
      // same 21 divided by twelve and is NOT a monthly flow of anything).
      projectPoints: firstNumericOrNull(f.cachedYearlyRevenue?.Projects),
      orgProjectSlotUnlocked: typeof f.orgProjectSlotUnlocked === 'boolean' ? f.orgProjectSlotUnlocked : null,
      habProjectSlotUnlocked: typeof f.habProjectSlotUnlocked === 'boolean' ? f.habProjectSlotUnlocked : null,
      availableProjectsCount: availableProjects.length,
      availableProjectNames: availableProjects,
      // How many alien-activity investigations this faction has completed. A
      // plain integer in the save, and the ONLY source of the Xenology research
      // category bonus that no template carries -- the `InvestigateAlienActivity`
      // mission resolves to a code-side effect class, so a template sweep cannot
      // see it. `shared/researchCategoryBonus.mjs` prices it at the wiki's
      // +1% each (Aliens rev 2026-04-05).
      //
      // Absent stays null. `Number(null) === 0` and zero investigations is a
      // real, different fact from an unreadable count, so the guard is on
      // presence rather than on truthiness.
      alienInvestigations: firstNumericOrNull(f.alienInvestigations),
      // The cap-raising effects this faction actually holds, from the game's
      // own effect state rather than derived from completed projects. Absent
      // (rather than empty) when this snapshot carries no effect state at all,
      // so shared/controlPointCap.mjs can report the project term as UNKNOWN
      // instead of composing a cap that silently omits it.
      controlPointMaintenanceEffects: controlPointMaintenanceEffectsByFaction
        && controlPointMaintenanceEffectsByFaction.has(factionId)
        ? controlPointMaintenanceEffectsByFaction.get(factionId)
        : null,
      // The additive `SpaceMiningBonus` effects this faction holds, from the
      // game's own effect state. Half of the faction-wide mine-output bonus
      // modelled by `shared/spaceMiningBonus.mjs`; the other half is the
      // `miningBonus` on its councillors' active orgs. Absent (rather than
      // empty) when this snapshot carries no effect state, so the bonus reports
      // UNKNOWN instead of a confident x1.0.
      spaceMiningBonusEffects: spaceMiningBonusEffectsByFaction
        && spaceMiningBonusEffectsByFaction.has(factionId)
        ? spaceMiningBonusEffectsByFaction.get(factionId)
        : null,
      // The multiplicative `ShipConstructionTime` effects this faction holds,
      // from the game's own effect state. The research half of the faction-wide
      // ship-build-time multiplier in `shared/shipBuildTime.mjs`; the other
      // half is the campaign's `shipConstructionSpeed` setting, which is
      // campaign-global and lives on `metadata.campaignSettings`. Absent
      // (rather than empty) when this snapshot carries no effect state, so the
      // module reports the build time UNKNOWN instead of a confident figure.
      shipConstructionTimeEffects: shipConstructionTimeEffectsByFaction
        && shipConstructionTimeEffectsByFaction.has(factionId)
        ? shipConstructionTimeEffectsByFaction.get(factionId)
        : null,
      // `TIFactionState.history_CPCapOverageByDay` -- the game's OWN record of
      // this faction's control-point cap position.
      //
      // THE SEMANTICS ARE NOW MEASURED, AND THEY ARE NOT WHAT THIS FILE USED TO
      // ASSUME. Two corrections, both from the shipped assembly (IL read
      // 2026-08-22, Assembly-CSharp.dll 1.0.51) and both confirmed against the
      // save data:
      //
      //   1. THE ARRAY IS NEWEST-FIRST. Slot 0 is today; slot 31 is 31 days
      //      ago, one slot per in-game day. This file read
      //      `[length - 1]` and called it "the most recent slot", which is the
      //      OLDEST sample -- a month stale. Proven by value alignment across
      //      four saves of one campaign: the arrays for 12/1/2034, 12/16/2034
      //      and 1/1/2035 are the same series shifted by exactly 16, 15 and 31
      //      slots for gaps of 15.5, 15.5 and 31 days, in BOTH this array and
      //      its Mission Control sibling.
      //
      //   2. THE STORED NUMBER IS NOT THE OVERAGE. It is
      //      `GetOneDayControlPointCapMissionPenalty()`, which is
      //      `max(0, cost - cap) * TIMissionModifier_ControlPointOverage_Multiplier`
      //      and that multiplier is 0.3333333432674408f (TIGlobalConfig ctor).
      //      The stored value is the MISSION-DEFENCE PENALTY, i.e. the overage
      //      divided by three. Reading it as the overage understates the real
      //      position by 3x.
      //
      // `GetAveragedControlPointCapPenaltyToMissions()` is `Average()` over the
      // whole array, which is why the game's own tooltip says the penalty "is
      // averaged from how much we have been over the cap during the last month"
      // (UIGeneralControls.en, `CPCapOverageCurrent`). Today's sample and the
      // month mean are therefore DIFFERENT quantities and both are published.
      //
      // A recorded 0 is a measurement -- the penalty is floored at zero, so it
      // means "at or under cap" -- but only for a human faction. The alien
      // faction's cap is a hard-coded 20000, so its 0 is an exemption, not a
      // position. Absent stays null throughout.
      controlPointCapPenaltyToday: readControlPointCapPenalty(f.history_CPCapOverageByDay, 0),
      controlPointCapPenaltyAveraged: averageOrNull(f.history_CPCapOverageByDay),
      // The overage itself: today's penalty times three. Named as before
      // because consumers read it, but it is now the real excess rather than a
      // month-stale third of it.
      recordedControlPointCapOverage: (() => {
        const penalty = readControlPointCapPenalty(f.history_CPCapOverageByDay, 0);
        return penalty === null ? null : penalty / CONTROL_POINT_OVERAGE_PENALTY_MULTIPLIER;
      })(),
      recordedControlPointCapOverageSamples: Array.isArray(f.history_CPCapOverageByDay)
        ? f.history_CPCapOverageByDay.length
        : null,
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
      shipDesigns: fShipDesigns,
      // The player's in-game obsolete markers for designs and parts.
      // Absent stays null throughout: null (unknown) and [] (none) are distinct.
      obsoleteShipDesigns: Array.isArray(f.obsoleteShipDesigns)
        ? f.obsoleteShipDesigns
        : null,
      obsoletedShipParts: Array.isArray(f.obsoletedShipParts)
        ? f.obsoletedShipParts
        : null
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
      displayName: templateDisplayName(projTemplate, projId),
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
  buildControlPointMaintenanceEffects,
  buildSpaceMiningBonusEffects,
  buildShipConstructionTimeEffects,
  buildFactions,
  collectShipDesigns,
  buildActiveXenoforming,
  buildAlienFacilities,
  buildDefaultTargets,
  buildTechMatrix
};
