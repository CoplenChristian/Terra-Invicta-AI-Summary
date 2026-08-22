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
      // `TINationState.numControlPoints` -- the game's OWN divisor in the
      // control-point cost formula (IL read 2026-08-22:
      // `Pow(GDP/PCGDP, 0.6) / (2 * numControlPoints)`).
      //
      // Not the same thing as `controlPoints.length`, and the difference is
      // load-bearing in player mode: `controlPoints` is a projected, filterable
      // list, and dividing by a SHORT list inflates every control point's cost.
      // The save's own count survives redaction. Absent stays null so the
      // consumer can fall back to the list length with a recorded reason rather
      // than dividing by a confident zero.
      controlPointCount: firstNumericOrNull(n.numControlPoints),
      // An alien nation's control points cost nothing:
      // `get_ControlPointMaintenanceCost` returns 0 outright when
      // `alienNation` is set. Boolean, because an absent flag is a measured
      // "not an alien nation" on every save checked.
      alienNation: n.alienNation === true,
      controlPoints: cps,
      executiveFactionId,
      executiveFactionName,
      regionsCount: Array.isArray(n.regions) ? n.regions.length : 0
    });
  }
  return nations;
}

module.exports = { buildNations };
