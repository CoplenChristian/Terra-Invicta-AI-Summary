// server/snapshot/nations.js
//
// Purpose: the Earth-side reducer — one row per nation, joined to the control
//   points that determine who collects its output.
//
// The Earth-side reducer: one row per nation, joined to the control points
// that determine who collects its output.

const { firstNumericOrNull, lastFiniteNumber } = require('./numbers');
const { resolveFactionName } = require('./lookups');

function buildNations(rawNations, { controlPointsByNationId, factionsById }) {
  const nations = [];
  for (const n of rawNations) {
    const nationId = n.ID?.value;
    if (!nationId) continue;

    const cps = controlPointsByNationId.get(nationId) || [];
    const execCp = cps.find(c => c.isExecutive);
    const executiveFactionId = execCp?.factionId || null;
    const executiveFactionName = resolveFactionName(factionsById, executiveFactionId, 'None');

    const gdp = n.GDP || n.gdp || 0;
    const population = n.population || (n.historyPopulation?.length ? n.historyPopulation[n.historyPopulation.length - 1] : 0);
    const boost = n.historyBoost?.length ? n.historyBoost[n.historyBoost.length - 1] : 0;
    const research = n.historyResearch?.length ? n.historyResearch[n.historyResearch.length - 1] : 0;
    const milTech = n.milTech || n.militaryTechLevel || 0;
    const democracy = n.democracy || 0;
    const cohesion = n.cohesion || 0;
    const unrest = n.unrest || 0;
    const nukes = n.nuclearWeapons || n.nukes || (n.historyNuclearWeapons?.length ? n.historyNuclearWeapons[n.historyNuclearWeapons.length - 1] : 0);
    const armies = Array.isArray(n.armies) ? n.armies.length : 0;
    // Number(null) is 0, so the current reading has to be probed for
    // presence before it is coerced -- otherwise a nation whose save record
    // omits missionControl reports a confident 0 MC and never falls through
    // to its history. Both sources absent stays null.
    const currentMissionControl = firstNumericOrNull(n.missionControl);
    const mc = currentMissionControl !== null
      ? currentMissionControl
      : lastFiniteNumber(n.historyMissionControl);

    nations.push({
      ID: nationId,
      displayName: n.displayName,
      templateName: n.templateName,
      GDP: gdp,
      population,
      boost,
      research,
      milTech,
      democracy,
      cohesion,
      unrest,
      nukes,
      armies,
      missionControl: mc,
      controlPoints: cps,
      executiveFactionId,
      executiveFactionName,
      regionsCount: Array.isArray(n.regions) ? n.regions.length : 0
    });
  }
  return nations;
}

module.exports = { buildNations };
