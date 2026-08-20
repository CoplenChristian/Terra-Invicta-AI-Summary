// server/directives/space.js
//
// The space-department ladder: the off-world mining grid and orbital fleet
// posture.
//
// Both directives distinguish "no records visible" from "records visible but
// no rates measured". Reporting an unmeasured mining grid as idle, or an
// invisible fleet as absent, would be a fabricated reading of the filtered
// snapshot rather than a description of it.

const directiveAdvisor = require('../directiveAdvisor');
const { asArray, sameId, formatPower } = require('../briefing/format');
const { getFleetCombatPower, getMiningRateSummary } = require('../briefing/readers');

function buildSpaceDirectives(habs, fleets, habSites, observer, observerName = null, campaignPosture = {}) {
  const directives = [];
  const visibleHabs = asArray(habs);
  const visibleFleets = asArray(fleets);
  const visibleHabSites = asArray(habSites);
  const ownHabs = visibleHabs.filter(h => sameId(h.factionId, observer?.ID));
  const ownFleets = visibleFleets.filter(f => sameId(f.factionId, observer?.ID));
  const observerLabel = observerName || observer?.displayName || 'the selected faction';
  const fleetPower = getFleetCombatPower(observer || {}, ownFleets);
  const miningRates = getMiningRateSummary(visibleHabSites, ownHabs, observer?.ID);

  // Directive 1: Mining Infrastructure
  directives.push({
    id: 'sp-1',
    policyRank: 20,
    title: `Review Off-World Mining Grid (${ownHabs.length} Habs Visible)`,
    category: 'LOGISTICS & MINING',
    severity: 'HIGH',
    statement: miningRates
      ? `${observerLabel}'s visible mining sites report ${miningRates}.`
      : visibleHabSites.length > 0
        ? 'Mining-site records are visible, but current production rates are not available.'
        : 'No mining-site records are visible in this filtered snapshot; current off-world production cannot be assessed.',
    action: visibleHabSites.length > 0
      ? 'Prioritize construction or expansion at confirmed high-yield sites after comparing current resource reserves.'
      : 'Acquire prospecting data before assigning a mining expansion order.',
    successFactor: miningRates ? 'DATA-SUPPORTED' : 'INTELLIGENCE REQUIRED'
  });

  // Directive 2: Orbital Fleet Readiness
  const escalateLate = campaignPosture?.escalateLate === true;
  directives.push({
    id: 'sp-2',
    policyRank: escalateLate ? 85 : 35,
    title: escalateLate
      ? `Preserve the fleet — escalate late (${directiveAdvisor.formatShipPosture(campaignPosture)})`
      : `Orbital Defense Squadron Posture (${ownFleets.length} Fleets Active)`,
    category: 'SPACE DEFENSE',
    severity: escalateLate ? 'CRITICAL' : 'STANDARD',
    statement: ownFleets.length > 0
      ? `Visible fleet combat power for ${observerLabel} is ${formatPower(fleetPower)} across ${ownFleets.length} fleet group${ownFleets.length === 1 ? '' : 's'}. ${escalateLate ? 'Doctrine is escalate late: ship count is not combat capability, but this force cannot be assumed to survive the retaliation cycle if proxy actions add more alien hate.' : ''}`
      : 'No own fleet groups are visible in this filtered snapshot; fleet posture cannot be confirmed.',
    action: escalateLate
      ? 'Prioritize fleet preservation: keep experienced hulls intact, limit new Mission Control, and stage proxy operations for a survivable window.'
      : ownFleets.length > 0
        ? 'Maintain a defensive patrol in a relevant inner-system orbit and assign intercept orders when a confirmed threat is identified.'
        : 'Obtain current fleet telemetry before issuing an orbital defense order.',
    successFactor: escalateLate ? 'SURVIVAL FIRST' : (ownFleets.length > 0 ? 'DETERRENCE' : 'INTELLIGENCE REQUIRED'),
    policyNote: escalateLate ? campaignPosture.reasons.join(' · ') : null
  });

  return directives;
}

module.exports = { buildSpaceDirectives };
