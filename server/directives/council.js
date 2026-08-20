// server/directives/council.js
//
// The council-department ladder: exploit an embedded mole, assign an idle
// operative, and leverage the highest-skill councilor.
//
// The idle-operative directive branches on posture: under an escalate-late
// hold the specialty recommendation switches to zero-hate work rather than the
// Crackdown/Sabotage suggestion that would feed alien hate.

const { asArray, sameId } = require('../briefing/format');
const { isOwnCouncilor } = require('../briefing/roster');

function buildCouncilDirectives(councilors, observerId, campaignPosture = {}) {
  const directives = [];
  const visibleCouncilors = asArray(councilors);
  const ownCouncilors = visibleCouncilors.filter(c => isOwnCouncilor(c, observerId));
  const moles = visibleCouncilors.filter(c => c.isTurnedMole === true || sameId(c.agentForFactionId, observerId));

  // Mole Directive
  if (moles.length > 0) {
    const m = moles[0];
    directives.push({
      id: 'c-mole',
      title: `Exploit Embedded Asset '${m.displayName}' (${m.factionName})`,
      category: 'COUNTER-INTELLIGENCE',
      severity: 'CRITICAL',
      statement: `Turned operative ${m.displayName} remains embedded inside ${m.factionName} hierarchy at location ${m.locationName}. Current mission telemetry: ${m.activeMissionName || 'Standby'}.`,
      action: 'Maintain intelligence surveillance stream. Use known enemy movement schedules to preempt hostile council actions.',
      successFactor: 'CONFIRMED STREAM',
      policyRank: 95
    });
  }

  // Operative Readiness Directives
  const idleAgents = ownCouncilors.filter(c => !c.activeMissionName || c.activeMissionName.includes('Idle') || c.activeMissionName.includes('Standby'));
  if (idleAgents.length > 0) {
    const agent = idleAgents[0];
    const attrs = agent.attributes || {};
    const holdProxy = campaignPosture?.escalateLate === true;
    const specialty = holdProxy
      ? (attrs.Persuasion > 10 ? 'Public Campaign or Defend Interests' : 'Defend Interests / Advise Nation, then prepare a proxy operation for a survivable window')
      : (attrs.Persuasion > 10 ? 'Public Campaign' : (attrs.Espionage > 10 ? 'Crackdown / Sabotage' : 'Advise Nation'));
    directives.push({
      id: 'c-idle',
      policyRank: holdProxy ? 50 : 55,
      title: `Assign Mission Orders to ${agent.displayName} (${agent.typeTemplateName})`,
      category: 'OPERATIVE ASSIGNMENT',
      severity: 'HIGH',
      statement: `${agent.displayName} is currently stationed in ${agent.locationName || 'an unknown location'} with no active operations queued (Skills: ADM ${attrs.Administration ?? 'UNAVAILABLE'}, PER ${attrs.Persuasion ?? 'UNAVAILABLE'}, ESP ${attrs.Espionage ?? 'UNAVAILABLE'}).`,
      action: `Deploy on a priority mission matched to specialty: ${specialty}.`,
      successFactor: 'IMMEDIATE',
      missionType: holdProxy ? 'Defend Interests' : (attrs.Persuasion > 10 ? 'Public Campaign' : (attrs.Espionage > 10 ? 'Crackdown / Purge' : 'Advise')),
      missionCost: 'UNAVAILABLE',
      expectedAlienHate: holdProxy ? 'none (Defend Interests)' : 'depends on target'
    });
  }

  // High Stat Specialization
  const masterAgent = [...ownCouncilors].sort((a, b) => (b.totalSkills || 0) - (a.totalSkills || 0))[0];
  if (masterAgent) {
    directives.push({
      id: 'c-master',
      title: `Leverage Master Operative '${masterAgent.displayName}' (Total Skills: ${masterAgent.totalSkills})`,
      category: 'STRATEGIC ASSET',
      severity: 'STANDARD',
      statement: `${masterAgent.displayName} (${masterAgent.typeTemplateName}) possesses our highest operational skill rating with ${masterAgent.orgs?.length || 0} assigned organizations.`,
      action: `Assign to spearhead critical superpower acquisition or council turn operations.`,
      successFactor: 'PEAK EFFICIENCY',
      policyRank: 15
    });
  }

  return directives;
}

module.exports = { buildCouncilDirectives };
