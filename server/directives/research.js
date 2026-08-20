// server/directives/research.js
//
// The research-department ladder: the two alien-intelligence unlocks and the
// global tech slot the observer is contributing to.
//
// The project and tech names are NOT hardcoded. `unlockLabel` resolves the
// effect id through `config.analysis.effects` to the configured default
// project/tech, so a template rename shows up as the configured id rather than
// as a stale literal in a directive title.
//
// Takes `config` explicitly rather than reading an instance field. It is the
// only directive builder that needs configuration, and passing it in keeps the
// builder a plain function like its four siblings; `briefingGenerator` forwards
// `this.config` so the public method signature is unchanged.

const { sameId, firstAvailableNumber } = require('../briefing/format');
const { getResearchSlots } = require('../briefing/readers');

function buildResearchDirectives(globalResearch, observer, activeAlienStages, options = {}, config = {}) {
  const directives = [];
  const researchSlots = getResearchSlots(globalResearch);
  const stages = activeAlienStages || {};
  const hasStageData = Object.keys(stages).length > 0;
  const effects = config.analysis?.effects || {};
  const projects = new Map(
    (config.analysis?.strategicProjects || []).map(project => [project.id, project])
  );
  const unlockLabel = (effectId, fallback) => {
    const descriptor = effects[effectId] || {};
    const id = descriptor.defaultProject || descriptor.defaultTech;
    if (!id) return fallback;
    const displayName = projects.get(id)?.name || id;
    const kind = descriptor.defaultTech ? 'Tech' : 'Project';
    return `${kind} '${displayName}' (${id})`;
  };

  // Research Vector 1: Alien Threat Meter
  if (hasStageData && stages.operations && stages.operations.active === false) {
    directives.push({
      id: 'res-1',
      title: `Unlock ${unlockLabel('Effect_UpdateAlienThreatMeter', 'the configured alien threat project')}`,
      category: 'STRATEGIC INTEL UNLOCK',
      severity: 'CRITICAL',
      statement: 'Our intelligence command is currently blind to the calibrated Alien Threat Meter and worldwide alien operations.',
      action: 'Prioritize faction engineering slots on Alien Operations to unlock real-time alien hate estimation.',
      successFactor: 'MISSION CRITICAL',
      policyRank: 55
    });
  }

  // Research Vector 2: Direct Hydra Detection
  if (hasStageData && stages.operatives && stages.operatives.active === false) {
    directives.push({
      id: 'res-2',
      title: `Advance ${unlockLabel('Effect_DetectAlienMovements', 'the configured alien movement project')}`,
      category: 'TACTICAL RECONNAISSANCE',
      severity: 'HIGH',
      statement: 'Alien Hydra operatives on Earth cannot be directly targeted or unmasked on satellite telemetry without completed xenobiology tracking.',
      action: 'Direct science leadership to unlock Alien Movements upon completing Alien Operations.',
      successFactor: 'TACTICAL ADVANTAGE'
    });
  }

  // Research Vector 3: Global Tech Dominance
  if (researchSlots.length > 0) {
    const topSlot = researchSlots[0];
    const progress = firstAvailableNumber(topSlot.progressPct, topSlot.percent);
    const displayName = topSlot.displayName || topSlot.techId || 'the current technology';
    const isLeading = topSlot.isLeading === true ||
      sameId(topSlot.leadFactionId, observer?.ID) ||
      (topSlot.leadFactionName && topSlot.leadFactionName === observer?.displayName);
    directives.push({
      id: 'res-3',
      title: `Contribute to Global Technology: ${displayName}`,
      category: 'GLOBAL R&D LEADERSHIP',
      severity: 'STANDARD',
      statement: `Global research slot #${topSlot.slotNumber || 1} is researching '${displayName}' (${progress === null ? 'progress unavailable' : Math.round(progress) + '% complete'}). Leading contributor: ${topSlot.leadFactionName || 'unavailable'}.`,
      action: `Maintain or increase ${observer?.displayName || 'the selected faction'} research allocation when the visible slot data supports leadership.`,
      successFactor: `${isLeading ? 'CURRENT LEADER' : 'CONTESTED'}`
    });
  }

  return directives;
}

module.exports = { buildResearchDirectives };
