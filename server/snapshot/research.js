// server/snapshot/research.js
//
// Global research: the shared tech slots every faction contributes to, and the
// normalized tech dependency graph the tech-tree endpoints are served from.
//
// The graph is attached to every snapshot (raw and filtered) so the local
// dashboard and the hosted worker answer from the exact same structure. The
// hosted worker has no template directory, so anything template-derived has to
// be baked on here rather than read at request time.

const templateLoader = require('../templateLoader');
const techGraph = require('../../shared/techGraph.mjs');
const { firstNumericOrNull, completionPercent } = require('./numbers');
const { resolveFactionName } = require('./lookups');

function buildGlobalResearchSlots(techProgress, { factionsById }) {
  return techProgress.map((slot, index) => {
    const techTemplate = templateLoader.getTech(slot.techTemplateName);
    // An unresolved tech template has no known cost. Substituting a round
    // 10000 produced a completion percentage that looked measured and was
    // invented, so an unknown cost now yields an unknown percentage.
    const totalCost = firstNumericOrNull(techTemplate?.researchCost);
    const accumulated = firstNumericOrNull(slot.accumulatedResearch) ?? 0;
    const percent = completionPercent(accumulated, totalCost);

    const contributions = [];
    let leadFactionId = null;
    let maxContribution = -1;

    if (Array.isArray(slot.factionContributions)) {
      for (const fc of slot.factionContributions) {
        const fid = fc.Key?.value || fc.Key;
        const val = fc.Value || 0;
        const fname = resolveFactionName(factionsById, fid, 'Unknown');
        contributions.push({ factionId: fid, factionName: fname, contribution: Math.round(val) });
        if (val > maxContribution) {
          maxContribution = val;
          leadFactionId = fid;
        }
      }
    }

    contributions.sort((a, b) => b.contribution - a.contribution);

    return {
      slotNumber: index + 1,
      techId: slot.techTemplateName,
      displayName: techTemplate?.friendlyName || slot.techTemplateName,
      category: techTemplate?.techCategory || 'General',
      accumulatedResearch: Math.round(accumulated),
      totalCost,
      totalCostAvailable: totalCost !== null,
      totalCostSource: totalCost !== null
        ? 'game template researchCost'
        : 'unavailable: tech template not resolved',
      percent,
      contributions,
      leadFactionId,
      leadFactionName: resolveFactionName(factionsById, leadFactionId, 'None'),
      leadContribution: Math.round(maxContribution)
    };
  });
}

// Builds the normalized tech dependency graph from game templates and the
// save's research state. This is attached to every snapshot (raw and filtered)
// so the local dashboard and the hosted worker can serve the tech-tree,
// tech-path, tech-search, tech-milestones and research-queue endpoints from
// the exact same graph. Enemy project status is resolved per-observer/mode at
// projection time, not here.
function buildTechTree(saveData, finishedTechsNames, activeGlobalSlots, factions) {
  const effects = {};
  for (const [id, eff] of templateLoader.templates.effects) effects[id] = eff;

  const globalActive = activeGlobalSlots.map(slot => ({
    techId: slot.techId,
    accumulatedResearch: slot.accumulatedResearch,
    totalCost: slot.totalCost,
    contributors: slot.contributions
  }));

  const templatesAdapter = {
    allTechs: () => Array.from(templateLoader.templates.techs.values()),
    allProjects: () => Array.from(templateLoader.templates.projects.values()),
    componentsForProject: (projectId) =>
      templateLoader.getComponentsForRequiredProject(projectId)
  };

  const rawGraph = techGraph.buildTechGraph(templatesAdapter, {
    techs: templatesAdapter.allTechs(),
    projects: templatesAdapter.allProjects(),
    effects,
    componentByEffect: {}
  });

  // Per-faction status overlay is stored keyed by faction id so any observer
  // / mode combination can be projected later without rebuilding the graph.
  const factionStatus = {};
  for (const faction of factions) {
    factionStatus[faction.ID] = {
      completedProjects: faction.completedProjects,
      availableProjectNames: faction.availableProjectNames,
      currentProjects: faction.currentProjects.map(p => ({
        projectId: p.projectId,
        accumulatedResearch: p.accumulatedResearch,
        totalCost: p.totalCost
      }))
    };
  }

  return {
    nodes: rawGraph.nodes,
    categories: rawGraph.categories,
    unlockClasses: rawGraph.unlockClasses,
    finishedTechsNames,
    globalActive,
    factionStatus,
    counts: { techs: rawGraph.techs.length, projects: rawGraph.projects.length }
  };
}

module.exports = { buildGlobalResearchSlots, buildTechTree };
