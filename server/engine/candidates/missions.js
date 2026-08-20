/**
 * server/engine/candidates/missions.js
 *
 * Generic data-driven candidate generator pairing MissionSpecs with world targets.
 */

function generateMissionCandidatesFromSpecs(world = {}, catalogue = null) {
  if (!catalogue || catalogue.size === 0) {
    return [];
  }

  const candidates = [];
  const ownFactionId = String(world.observerFactionId || world.observerId || '4712');
  const nations = Array.isArray(world.nations) ? world.nations : [];
  const rivalCouncilors = Array.isArray(world.rivalCouncilors)
    ? world.rivalCouncilors
    : (Array.isArray(world.councilors) ? world.councilors.filter(c => String(c.factionId) !== ownFactionId) : []);

  // 1. Defend Interests candidates
  const defendSpec = catalogue.get('DefendInterests');
  if (defendSpec) {
    for (const nation of nations) {
      const cps = Array.isArray(nation.controlPoints) ? nation.controlPoints : [];
      const ownCps = cps.filter(cp => String(cp.factionId) === ownFactionId);
      for (const cp of ownCps) {
        if (!cp.defended) {
          candidates.push({
            id: `defend-interests-${nation.id || nation.name}-${cp.index || 0}`,
            key: `defend-interests-${nation.id || nation.name}`,
            family: 'defense',
            category: 'defense',
            missionType: 'DefendInterests',
            friendlyName: 'Defend Interests',
            title: `Ward Holdings in ${nation.displayName || nation.name}`,
            target: {
              type: 'nation',
              name: nation.displayName || nation.name,
              nation: nation.displayName || nation.name,
              gdp: nation.gdp || nation.GDP,
              controlPointIndex: cp.index
            },
            missionSpec: defendSpec,
            cost: { resource: 'Influence', kind: 'Flat', amount: 20 },
            successHate: 0,
            failureHate: 0,
            baseValue: 6.0,
            policyNote: `Guarantees protection against rival subversion in ${nation.displayName || nation.name}.`,
            provenance: 'missions-catalogue'
          });
        }
      }
    }
  }

  // 2. Control Nation (GainInfluence) candidates
  const controlSpec = catalogue.get('GainInfluence');
  if (controlSpec) {
    for (const nation of nations) {
      const cps = Array.isArray(nation.controlPoints) ? nation.controlPoints : [];
      const openCps = cps.filter(cp => !cp.factionId || cp.factionId === '0' || String(cp.factionId) === '0');
      if (openCps.length > 0) {
        const gdp = Number(nation.gdp || nation.GDP || 0);
        candidates.push({
          id: `control-nation-${nation.id || nation.name}`,
          key: `control-nation-${nation.id || nation.name}`,
          family: 'expansion',
          category: 'expansion',
          missionType: 'GainInfluence',
          friendlyName: 'Control Nation',
          title: `Secure Control Point in ${nation.displayName || nation.name}`,
          target: {
            type: 'nation',
            name: nation.displayName || nation.name,
            nation: nation.displayName || nation.name,
            gdp: nation.gdp || nation.GDP,
            hasOpenCP: true
          },
          missionSpec: controlSpec,
          cost: { resource: 'Influence', kind: 'Bonus', amount: 20 },
          successHate: 0,
          failureHate: 0,
          baseValue: Math.max(3.5, Math.min(8.0, 3.0 + gdp * 0.5)),
          policyNote: `Claims open control point in ${nation.displayName || nation.name} without hate penalty.`,
          provenance: 'missions-catalogue'
        });
      }
    }
  }

  // 3. Purge / Crackdown candidates on rival CPs
  const purgeSpec = catalogue.get('Purge');
  if (purgeSpec) {
    for (const nation of nations) {
      const cps = Array.isArray(nation.controlPoints) ? nation.controlPoints : [];
      const hostileCps = cps.filter(cp => cp.factionId && String(cp.factionId) !== ownFactionId && String(cp.factionId) !== '0');
      for (const cp of hostileCps) {
        const factionName = cp.factionName || 'Rival';
        candidates.push({
          id: `purge-${nation.id || nation.name}-${cp.index || 0}`,
          key: `purge-${nation.id || nation.name}`,
          family: 'expansion',
          category: 'expansion',
          missionType: 'Purge',
          friendlyName: 'Purge',
          title: `Purge ${factionName} Holding in ${nation.displayName || nation.name}`,
          target: {
            type: 'nation',
            name: nation.displayName || nation.name,
            nation: nation.displayName || nation.name,
            gdp: nation.gdp || nation.GDP,
            controlPointIndex: cp.index,
            factionName
          },
          missionSpec: purgeSpec,
          cost: { resource: 'Influence', kind: 'Bonus', amount: 15 },
          successHate: purgeSpec.successHate || 5,
          failureHate: purgeSpec.failureHate || 1,
          baseValue: 4.5,
          policyNote: `Breaks ${factionName} control in ${nation.displayName || nation.name}.`,
          provenance: 'missions-catalogue'
        });
      }
    }
  }

  // 4. Councilor missions: InvestigateCouncilor & Turn
  const invSpec = catalogue.get('InvestigateCouncilor');
  if (invSpec) {
    for (const rival of rivalCouncilors.slice(0, 4)) {
      candidates.push({
        id: `investigate-councilor-${rival.id}`,
        key: `investigate-councilor-${rival.id}`,
        family: 'intel',
        category: 'intel',
        missionType: 'InvestigateCouncilor',
        friendlyName: 'Investigate Councilor',
        title: `Investigate Councilor: ${rival.displayName || rival.name}`,
        target: {
          type: 'councilor',
          id: rival.id,
          name: rival.displayName || rival.name,
          councilor: rival
        },
        missionSpec: invSpec,
        cost: { resource: 'Operations', kind: 'Bonus', amount: 5 },
        successHate: 0,
        failureHate: 0,
        baseValue: 4.0,
        policyNote: 'Uncovers defender Loyalty and secrets to enable Turn Councilor.',
        provenance: 'missions-catalogue'
      });
    }
  }

  return candidates;
}

module.exports = {
  generateMissionCandidatesFromSpecs
};
