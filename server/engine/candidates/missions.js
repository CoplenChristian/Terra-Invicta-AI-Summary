/**
 * server/engine/candidates/missions.js
 * Purpose: the generic data-driven candidate generator pairing MissionSpecs
 *   with world targets.
 *
 * Generic data-driven candidate generator pairing MissionSpecs with world targets.
 *
 * IDENTITY (see the dedupe set in directiveEngine.generateCandidates):
 * every candidate id is the dedupe key, so an id that resolves to the literal
 * string "undefined" collapses every target of a mission type into one
 * surviving candidate. That is exactly what happened here: the save's nation
 * records carry `ID` / `displayName` / `templateName` and have NO `id` and NO
 * `name`, so `nation.id || nation.name` produced `undefined` for all 295
 * nations. Councilors (`ID`), habs (`ID`) and control points (`id`) have the
 * same shape hazard. Identity is now resolved through resolveEntityId /
 * resolveControlPointId, and a target whose identity cannot be resolved is
 * DROPPED with a recorded reason rather than silently colliding.
 *
 * COSTS AND HATE come from the MissionSpec, never from a literal in this file.
 * The previous version wrote `purgeSpec.successHate || 5`, which fabricates 5
 * alien hate whenever the template legitimately says 0, and hard-coded cost
 * amounts (15/20 Influence) over specs that say `costAmount: null` for a Bonus
 * mission. Absent stays null.
 */

const { toFiniteNumber } = require('../../../shared/util.mjs');
const { DEFAULT_OBSERVER_FACTION_ID } = require('../../../shared/constants.mjs');

/**
 * Identity for a nation / councilor / hab record straight off the snapshot.
 * `ID` is the save's own key and is what every reducer in this repo emits;
 * `id` and `templateName` are accepted for synthetic fixtures. displayName is
 * deliberately NOT a fallback -- it is not unique and it changes with
 * localisation, so using it as a dedupe key hides collisions instead of
 * reporting them.
 */
function resolveEntityId(entity) {
  if (!entity || typeof entity !== 'object') return null;
  const raw = entity.ID ?? entity.id ?? entity.templateName ?? null;
  if (raw === null || raw === undefined || raw === '') return null;
  const text = String(raw);
  return text === 'undefined' || text === 'null' ? null : text;
}

function resolveControlPointId(controlPoint) {
  if (!controlPoint || typeof controlPoint !== 'object') return null;
  const raw = controlPoint.id ?? controlPoint.ID ?? null;
  if (raw === null || raw === undefined || raw === '') return null;
  const text = String(raw);
  return text === 'undefined' || text === 'null' ? null : text;
}

function nationLabel(nation) {
  return nation?.displayName || nation?.name || nation?.templateName || 'this nation';
}

/**
 * GDP as billions. The save stores raw currency units (7.1e10 for a $71Bn
 * economy); fixtures store billions directly. `null` when unmeasured -- never 0.
 */
function gdpBillions(nation) {
  const raw = toFiniteNumber(nation?.GDP ?? nation?.gdp);
  if (raw === null) return null;
  return raw > 1e6 ? raw / 1e9 : raw;
}

/**
 * Same classification directiveEngine's hand-written open-CP generator uses:
 * unformed and absorbed nations both report 0 regions, and population is the
 * only field that separates them. Null when regionsCount itself is unmeasured
 * -- an unclassifiable nation is not guessed into a class.
 */
function territoryClassOf(nation) {
  const regionsCount = toFiniteNumber(nation?.regionsCount);
  if (regionsCount === null) return null;
  if (regionsCount > 0) return 'real';
  const population = toFiniteNumber(nation?.population);
  return population !== null && population > 0 ? 'absorbed' : 'unformed';
}

/**
 * The three hate outcome slots exactly as the template records them. A slot
 * the template does not carry stays null; it is not coerced to 0, because
 * "this mission generates no hate" and "we do not know what this mission
 * generates" are opposite claims.
 */
function specHate(spec) {
  return {
    successHate: typeof spec?.successHate === 'number' ? spec.successHate : null,
    criticalHate: typeof spec?.criticalHate === 'number' ? spec.criticalHate : null,
    failureHate: typeof spec?.failureHate === 'number' ? spec.failureHate : null
  };
}

/**
 * Cost exactly as the template records it. `costKind` is lower-cased here so
 * a single spelling reaches the rules -- the templates emit 'Flat'/'Bonus'
 * while every hand-written candidate in directiveEngine emits 'flat'/'bonus',
 * and cost/affordability tested only the lower-case spelling, so the
 * affordability veto never fired on a catalogue candidate.
 */
function specCost(spec) {
  const kind = spec?.costKind ? String(spec.costKind).toLowerCase() : null;
  return {
    resource: spec?.costResource || null,
    kind,
    amount: typeof spec?.costAmount === 'number' ? spec.costAmount : null
  };
}

function specProvenance(specKey, spec) {
  return {
    source: `missions-catalogue: TIMissionTemplate ${spec?.friendlyName || specKey}`,
    estimateClass: 'heuristic',
    generator: 'missions-catalogue'
  };
}

function drop(diagnostics, missionType, detail, reason = 'unresolvable-target-identity') {
  if (Array.isArray(diagnostics)) {
    diagnostics.push({ missionType, reason, detail });
  }
}

/**
 * @param {object} world
 * @param {MissionCatalogue} catalogue
 * @param {Array} [diagnostics] optional sink for dropped-target reasons
 */
function generateMissionCandidatesFromSpecs(world = {}, catalogue = null, diagnostics = null) {
  if (!catalogue || catalogue.size === 0) {
    return [];
  }

  const candidates = [];
  const ownFactionId = String(world.observerFactionId ?? world.observerId ?? DEFAULT_OBSERVER_FACTION_ID);
  const nations = Array.isArray(world.nations) ? world.nations : [];
  const rivalCouncilors = Array.isArray(world.rivalCouncilors)
    ? world.rivalCouncilors
    : (Array.isArray(world.councilors)
      ? world.councilors.filter(c => c
        && c.isAlien !== true
        && c.factionId !== null
        && c.factionId !== undefined
        && String(c.factionId) !== ownFactionId)
      : []);

  // 1. Defend Interests -- one candidate per NATION, not per control point.
  // The template's targetKind is NationFleetHab: the mission wards a holding,
  // so a per-CP candidate would recommend the same mission several times over.
  // The id deliberately matches directiveEngine's hand-written
  // `defend-interests:<displayName>` so the richer hand-written candidate wins
  // the dedupe for the nations it covers and this fills in the rest.
  const defendSpec = catalogue.get('DefendInterests');
  if (defendSpec) {
    for (const nation of nations) {
      const nationId = resolveEntityId(nation);
      if (nationId === null) {
        drop(diagnostics, 'Defend Interests', `A nation record carries no ID/templateName (${nationLabel(nation)}).`);
        continue;
      }
      const cps = Array.isArray(nation.controlPoints) ? nation.controlPoints : [];
      const ownCps = cps.filter(cp => String(cp.factionId) === ownFactionId);
      const undefendedCps = ownCps.filter(cp => cp.defended !== true);
      if (undefendedCps.length === 0) continue;

      candidates.push({
        id: `defend-interests:${nation.displayName || nationId}`,
        key: `defend-interests:${nationId}`,
        family: 'defense',
        missionType: 'Defend Interests',
        friendlyName: 'Defend Interests',
        title: `Ward Holdings in ${nationLabel(nation)}`,
        target: {
          kind: 'controlPoint',
          type: 'nation',
          id: nationId,
          name: nation.displayName || nationLabel(nation),
          displayName: nation.displayName || nationLabel(nation),
          nation: nation.displayName || nationLabel(nation),
          faction: world.observerName || null,
          controlPointType: undefendedCps[0]?.controlPointType || null,
          isExecutive: undefendedCps[0]?.isExecutive === true,
          GDP: toFiniteNumber(nation.GDP ?? nation.gdp)
        },
        missionSpec: defendSpec,
        ...specHate(defendSpec),
        cost: specCost(defendSpec),
        baseValue: null,
        value: {
          nationName: nation.displayName || nationLabel(nation),
          gdpBn: gdpBillions(nation),
          isDefendInterests: true,
          ownControlPointCount: ownCps.length,
          unprotectedControlPointCount: undefendedCps.length,
          defenseUnknownCount: ownCps.filter(cp => cp.defended !== true && cp.defended !== false).length
        },
        policyNote: `Guarantees protection against rival subversion in ${nationLabel(nation)}.`,
        provenance: specProvenance('DefendInterests', defendSpec),
        unmetPreconditions: []
      });
    }
  }

  // 2. Control Nation (GainInfluence) -- one candidate per OPEN control point.
  // The id format matches directiveEngine's hand-written open-CP generator on
  // purpose: that generator already covers every neutral CP and carries the
  // regionsCount / population / executive-last evidence this one cannot, so
  // the dedupe should keep the richer candidate.
  const controlSpec = catalogue.get('GainInfluence');
  if (controlSpec) {
    for (const nation of nations) {
      const nationId = resolveEntityId(nation);
      if (nationId === null) {
        drop(diagnostics, 'Control Nation', `A nation record carries no ID/templateName (${nationLabel(nation)}).`);
        continue;
      }
      const cps = Array.isArray(nation.controlPoints) ? nation.controlPoints : [];
      const openCps = cps.filter(cp => cp.factionId === null || cp.factionId === undefined || String(cp.factionId) === '0');
      for (const cp of openCps) {
        const cpId = resolveControlPointId(cp);
        if (cpId === null) {
          drop(diagnostics, 'Control Nation', `A control point in ${nationLabel(nation)} carries no id.`);
          continue;
        }
        candidates.push({
          id: `control-nation:${nation.displayName || nationId}:${cp.controlPointType}`,
          key: `control-nation:${nationId}:${cpId}`,
          family: 'expansion',
          missionType: 'Control Nation',
          friendlyName: 'Control Nation',
          title: `Secure the ${cp.controlPointType || 'open'} control point in ${nationLabel(nation)}`,
          target: {
            kind: 'controlPoint',
            type: 'nation',
            id: nationId,
            name: nation.displayName || nationLabel(nation),
            displayName: nation.displayName || nationLabel(nation),
            nation: nation.displayName || nationLabel(nation),
            faction: null,
            controlPointType: cp.controlPointType || null,
            isExecutive: cp.isExecutive === true,
            hasOpenCP: true,
            GDP: toFiniteNumber(nation.GDP ?? nation.gdp)
          },
          missionSpec: controlSpec,
          ...specHate(controlSpec),
          cost: specCost(controlSpec),
          baseValue: null,
          value: {
            nationName: nation.displayName || nationLabel(nation),
            gdpBn: gdpBillions(nation),
            isExecutive: cp.isExecutive === true,
            cpCountInNation: cps.length,
            regionsCount: toFiniteNumber(nation.regionsCount),
            population: toFiniteNumber(nation.population),
            territoryClass: territoryClassOf(nation)
          },
          policyNote: `Claims an open control point in ${nationLabel(nation)}.`,
          provenance: specProvenance('GainInfluence', controlSpec),
          unmetPreconditions: []
        });
      }
    }
  }

  // 3. Purge -- per rival-held control point (template targetKind
  // OwnedControlPoint, so per-CP is the right granularity here).
  const purgeSpec = catalogue.get('Purge');
  if (purgeSpec) {
    for (const nation of nations) {
      const nationId = resolveEntityId(nation);
      if (nationId === null) {
        drop(diagnostics, 'Purge', `A nation record carries no ID/templateName (${nationLabel(nation)}).`);
        continue;
      }
      const cps = Array.isArray(nation.controlPoints) ? nation.controlPoints : [];
      const hostileCps = cps.filter(cp => cp.factionId !== null
        && cp.factionId !== undefined
        && String(cp.factionId) !== ownFactionId
        && String(cp.factionId) !== '0');
      for (const cp of hostileCps) {
        const cpId = resolveControlPointId(cp);
        if (cpId === null) {
          drop(diagnostics, 'Purge', `A control point in ${nationLabel(nation)} carries no id.`);
          continue;
        }
        const factionName = cp.factionName || 'Rival';
        // Faction display names already carry their article ("the Protectorate"),
        // so do not prepend another one.
        const factionPhrase = /^the\s/i.test(factionName) ? factionName : `the ${factionName}`;
        candidates.push({
          id: `purge:${nationId}:${cpId}`,
          key: `purge:${nationId}:${cpId}`,
          family: 'expansion',
          missionType: 'Purge',
          friendlyName: 'Purge',
          title: `Purge ${factionPhrase} hold on ${cp.controlPointType || 'a control point'} in ${nationLabel(nation)}`,
          target: {
            kind: 'controlPoint',
            type: 'nation',
            id: nationId,
            name: nation.displayName || nationLabel(nation),
            displayName: nation.displayName || nationLabel(nation),
            nation: nation.displayName || nationLabel(nation),
            faction: factionName,
            controlPointType: cp.controlPointType || null,
            isExecutive: cp.isExecutive === true,
            controlPointId: cpId,
            GDP: toFiniteNumber(nation.GDP ?? nation.gdp)
          },
          missionSpec: purgeSpec,
          ...specHate(purgeSpec),
          cost: specCost(purgeSpec),
          baseValue: null,
          value: {
            nationName: nation.displayName || nationLabel(nation),
            gdpBn: gdpBillions(nation),
            isExecutive: cp.isExecutive === true,
            cpCountInNation: cps.length,
            regionsCount: toFiniteNumber(nation.regionsCount),
            population: toFiniteNumber(nation.population),
            territoryClass: territoryClassOf(nation),
            heldByFaction: factionName
          },
          policyNote: `Breaks ${factionName} control in ${nationLabel(nation)}.`,
          provenance: specProvenance('Purge', purgeSpec),
          unmetPreconditions: []
        });
      }
    }
  }

  // 4. Investigate Councilor. Ids match directiveEngine's hand-written
  // `investigate-councilor:<ID>` so the two generators dedupe cleanly.
  const invSpec = catalogue.get('InvestigateCouncilor');
  if (invSpec) {
    for (const rival of rivalCouncilors) {
      const rivalId = resolveEntityId(rival);
      if (rivalId === null) {
        drop(diagnostics, 'Investigate Councilor', `A rival councilor record carries no ID (${rival?.displayName || 'unnamed'}).`);
        continue;
      }
      candidates.push({
        id: `investigate-councilor:${rivalId}`,
        key: `investigate-councilor:${rivalId}`,
        family: 'council',
        missionType: 'Investigate Councilor',
        friendlyName: 'Investigate Councilor',
        title: `Investigate ${rival.displayName || rival.name || 'councilor'}${rival.factionName ? ` (${rival.factionName})` : ''}`,
        target: {
          kind: 'councilor',
          type: 'councilor',
          id: rivalId,
          name: rival.displayName || rival.name || 'Councilor',
          councilorId: rivalId,
          councilorName: rival.displayName || rival.name || 'Councilor',
          faction: rival.factionName || null,
          councilor: rival
        },
        missionSpec: invSpec,
        ...specHate(invSpec),
        cost: specCost(invSpec),
        baseValue: null,
        value: {
          councilorId: rivalId,
          targetFaction: rival.factionName || null
        },
        policyNote: 'Uncovers defender Loyalty and secrets to enable Turn Councilor.',
        provenance: specProvenance('InvestigateCouncilor', invSpec),
        unmetPreconditions: []
      });
    }
  }

  // 5. Advise -- nations where we hold a control point, and owned habs.
  const adviseSpec = catalogue.get('Advise');
  if (adviseSpec) {
    for (const nation of nations) {
      const nationId = resolveEntityId(nation);
      if (nationId === null) {
        drop(diagnostics, 'Advise', `A nation record carries no ID/templateName (${nationLabel(nation)}).`);
        continue;
      }
      const cps = Array.isArray(nation.controlPoints) ? nation.controlPoints : [];
      const ownCps = cps.filter(cp => String(cp.factionId) === ownFactionId);
      if (ownCps.length === 0) continue;

      const label = nation.displayName || nationLabel(nation);
      candidates.push({
        id: `advise-nation:${nationId}`,
        key: `advise-nation:${nationId}`,
        family: 'advisory',
        missionType: 'Advise',
        friendlyName: 'Advise',
        title: `Advise Government: ${label}`,
        // The target carries the measured nation fields adviseEconomics reads
        // (unrest, armies, navies, research) rather than a hand-picked subset.
        // assignment.js prices an ACTIVE Advise off the full nation record, so
        // a target missing unrest/armies made "keep advising" and "stop
        // advising" quote two different numbers for the same mission.
        target: {
          kind: 'nation',
          type: 'nation',
          id: nationId,
          name: label,
          displayName: label,
          nation: label,
          hasOurCP: true,
          GDP: toFiniteNumber(nation.GDP ?? nation.gdp),
          gdp: toFiniteNumber(nation.GDP ?? nation.gdp),
          research: toFiniteNumber(nation.research ?? nation.monthlyResearch),
          unrest: toFiniteNumber(nation.unrest),
          armies: nation.armies,
          navies: nation.navies,
          milTech: toFiniteNumber(nation.milTech)
        },
        missionSpec: adviseSpec,
        ...specHate(adviseSpec),
        cost: specCost(adviseSpec),
        baseValue: null,
        value: {
          nationName: label,
          gdpBn: gdpBillions(nation),
          targetResearch: toFiniteNumber(nation.research ?? nation.monthlyResearch),
          ownControlPointCount: ownCps.length,
          isAdvisory: true,
          advisoryTargetType: 'nation'
        },
        policyNote: `Applies councilor Admin (+IP), Science (+Research), and Command (+Miltech) to ${label}.`,
        provenance: specProvenance('Advise', adviseSpec),
        unmetPreconditions: []
      });
    }

    const habs = Array.isArray(world.habs) ? world.habs : [];
    for (const hab of habs) {
      if (String(hab?.factionId) !== ownFactionId) continue;
      const habId = resolveEntityId(hab);
      if (habId === null) {
        drop(diagnostics, 'Advise', `A hab record carries no ID (${hab?.displayName || 'unnamed'}).`);
        continue;
      }
      const label = hab.displayName || hab.name || 'hab';

      // Advise on a hab scales the hab's OWN outputs (+Adm% resources,
      // +Sci% research, +Cmd% marine combat). A hab with none of those
      // measured -- a station with no mining site, on a snapshot that carries
      // no per-hab research figure -- cannot be scored from anything, and
      // scoring it anyway produced a confident directive built on five zeros.
      // It is dropped with a recorded reason instead of being invented.
      const habInputKeys = ['research', 'money', 'water', 'volatiles', 'metals', 'nobleMetals', 'fissiles',
        'marineCombatValue', 'combatValue'];
      const measuredHabInputs = habInputKeys.filter(key => toFiniteNumber(hab[key]) !== null);
      if (measuredHabInputs.length === 0) {
        drop(
          diagnostics,
          'Advise',
          `${label} carries no measurable research, resource output or marine-combat value in this `
            + 'snapshot, so the value of advising it cannot be priced.',
          'unpriceable-advise-target'
        );
        continue;
      }

      candidates.push({
        id: `advise-hab:${habId}`,
        key: `advise-hab:${habId}`,
        family: 'advisory',
        missionType: 'Advise',
        friendlyName: 'Advise',
        title: `Advise Hab: ${label}`,
        target: {
          kind: 'hab',
          type: 'hab',
          id: habId,
          name: label,
          displayName: label,
          hab: label,
          displayNameForBenefit: label,
          research: toFiniteNumber(hab.research),
          money: toFiniteNumber(hab.money),
          water: toFiniteNumber(hab.water),
          volatiles: toFiniteNumber(hab.volatiles),
          metals: toFiniteNumber(hab.metals),
          nobleMetals: toFiniteNumber(hab.nobleMetals),
          fissiles: toFiniteNumber(hab.fissiles),
          marineCombatValue: toFiniteNumber(hab.marineCombatValue ?? hab.combatValue),
          measuredInputs: measuredHabInputs
        },
        missionSpec: adviseSpec,
        ...specHate(adviseSpec),
        cost: specCost(adviseSpec),
        baseValue: null,
        value: {
          habName: label,
          targetResearch: toFiniteNumber(hab.research),
          measuredHabInputs,
          isAdvisory: true,
          advisoryTargetType: 'hab'
        },
        policyNote: `Applies councilor Admin (+Outputs), Science (+Research) and Command (+Marine combat) to `
          + `${label}. Measured inputs: ${measuredHabInputs.join(', ')}.`,
        provenance: specProvenance('Advise', adviseSpec),
        unmetPreconditions: []
      });
    }
  }

  return candidates;
}

module.exports = {
  generateMissionCandidatesFromSpecs,
  resolveEntityId,
  resolveControlPointId
};
