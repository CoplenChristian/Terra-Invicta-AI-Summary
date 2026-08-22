// shared/techGraph.mjs
//
// Purpose: pure tech-tree normalisation and dependency-graph helpers shared by
//   the local Express server and the hosted Cloudflare worker.
//
// Pure tech-tree normalization + dependency-graph helpers shared by the local
// Express server and the hosted Cloudflare worker. It has no runtime-specific
// imports so it stays usable in both.
//
// Core principle (from the research spec):
//   Do not hand-maintain a Terra Invicta tech tree. Parse the game's templates
//   into a dependency graph, then overlay the current save's completion /
//   progress state on top of it.

import { asArray, toFiniteNumber, sameId } from './util.mjs';

export const UNLOCK_CLASSES = [
  'ship_hull', 'weapon', 'missile', 'point_defense', 'drive', 'reactor',
  'battery', 'radiator', 'armor', 'utility', 'hab_module', 'mine', 'shipyard',
  'research_bonus', 'intel_capability', 'mission', 'story_progress',
  'resource_bonus', 'other'
];

export const STATUSES = ['completed', 'researching', 'available', 'locked', 'unknown'];

export const CATEGORIES = new Set([
  'all', 'weapons', 'drives', 'ships', 'habs', 'intel', 'economy',
  'xenology', 'computing', 'materials', 'energy', 'social', 'military',
  'space', 'life', 'information', 'general'
]);

// Friendly category filter -> internal classification matcher.
const CATEGORY_PREDICATES = {
  weapons: (node) => /weapon|gun|laser|plasma|particle|rail|coil|missile|point.?defen|torpedo|kinetic/i.test(node.id + ' ' + node.displayName + ' ' + (node.subcategory || '')),
  drives: (node) => /drive|thruster|propuls|torch|burner|fusion|ion|pulsar|mag/i.test(node.id + ' ' + node.displayName),
  ships: (node) => node.unlocks.some(u => u.class === 'ship_hull'),
  habs: (node) => node.unlocks.some(u => u.class === 'hab_module' || u.class === 'mine' || u.class === 'shipyard'),
  intel: (node) => node.unlocks.some(u => u.class === 'intel_capability'),
  economy: (node) => node.unlocks.some(u => u.class === 'resource_bonus') || /econom|boost|mining|industry|infrastructure/i.test(node.id + ' ' + node.displayName),
  xenology: (node) => node.category === 'Xenology' || /xeno|alien|hydra|servant|exotic/i.test(node.id + ' ' + node.displayName),
  computing: (node) => node.category === 'InformationScience' || /comput|software|ai|codex|algorithm/i.test(node.id + ' ' + node.displayName),
  materials: (node) => node.category === 'Materials' || /material|metal|composite|alloy|carbon|noble|superconductor|anti/i.test(node.id + ' ' + node.displayName),
  energy: (node) => node.category === 'Energy' || /fusion|fission|power|reactor|antimatter|torch|propuls/i.test(node.id + ' ' + node.displayName),
  social: (node) => node.category === 'SocialScience' || /social|politics|govern|culture|ideology/i.test(node.id + ' ' + node.displayName),
  military: (node) => node.category === 'MilitaryScience' || /military|war|tactic|armor|combat|weapon/i.test(node.id + ' ' + node.displayName),
  space: (node) => node.category === 'SpaceScience' || /space|orbit|interstellar|system/i.test(node.id + ' ' + node.displayName),
  life: (node) => node.category === 'LifeScience' || /bio|gene|life|medical|physiolog/i.test(node.id + ' ' + node.displayName),
  information: (node) => node.category === 'InformationScience' || /information|data|network|encrypt|quantum/i.test(node.id + ' ' + node.displayName),
  general: () => true
};

const CLASS_FROM_COMPONENT_TYPE = {
  weapon: 'weapon',
  drive: 'drive',
  reactor: 'reactor',
  radiator: 'radiator',
  battery: 'battery',
  utility: 'utility',
  armor: 'armor',
  ship_hull: 'ship_hull',
  hab_module: 'hab_module'
};

// Definitions live in shared/util.mjs; re-exported so existing importers of
// `techGraph.asArray` keep working.
export { asArray } from './util.mjs';

// Absent stays null. `Number(null) === 0` and `Number('') === 0`, so presence
// is checked before coercion.
const numOrNull = toFiniteNumber;

// Research completion as a percentage. `Math.min(100, NaN)` is NaN, not 100,
// so an unguarded progress/cost with a zero or absent cost leaked NaN into
// researchPercent. An unknown percentage is reported as null.
const percentOrNull = (progress, cost) => {
  const done = numOrNull(progress);
  const total = numOrNull(cost);
  if (done === null || total === null || total <= 0) return null;
  return Math.min(100, Math.round((done / total) * 1000) / 10);
};

// Component "stats" extraction, keyed per component type. Kept conservative:
// only fields that exist across the templates are surfaced so the payload stays
// small and truthful.
const WEAPON_STAT_KEYS = [
  'mount', 'targetingRange_km', 'muzzleVelocity_kps', 'cooldown_s',
  'magazine', 'baseWeaponMass_tons', 'crew', 'isPointDefenseTargetable'
];
const DRIVE_STAT_KEYS = [
  'thrust_N', 'EV_kps', 'specificPower_kgMW', 'efficiency', 'thrustRating_GW',
  'req power', 'flatMass_tons', 'requiredPowerPlant', 'propellant', 'driveClassification'
];
const REACTOR_STAT_KEYS = ['maxOutput_GW', 'specificPower_tGW', 'powerPlantClass', 'efficiency'];
const RADIATOR_STAT_KEYS = ['specificMass_2s_kgm2', 'specificPower_2s_KWkg', 'operatingTemp_K', 'emissivity', 'radiatorType'];
const BATTERY_STAT_KEYS = ['energyCapacity_GJ', 'rechargeRate_GJs', 'mass_tons'];
const UTILITY_STAT_KEYS = ['mass_tons', 'powerRequirement_MW', 'grouping', 'minConsTier'];
const ARMOR_STAT_KEYS = ['xRayHalfValue_cm', 'baryonicHalfValue_cm', 'density_kgm3', 'heatofVaporization_MJkg', 'specialties'];
const HULL_STAT_KEYS = ['noseHardpoints', 'hullHardpoints', 'internalModules', 'mass_tons', 'crew', 'length_m', 'structuralIntegrity', 'missionControl', 'baseConstructionTime_days'];
const HAB_MODULE_STAT_KEYS = ['tier', 'crew', 'power', 'baseMass_tons', 'buildTime_Days', 'controlPointCapacity', 'missionControl'];

const STAT_KEYS_BY_TYPE = {
  weapon: WEAPON_STAT_KEYS,
  drive: DRIVE_STAT_KEYS,
  reactor: REACTOR_STAT_KEYS,
  radiator: RADIATOR_STAT_KEYS,
  battery: BATTERY_STAT_KEYS,
  utility: UTILITY_STAT_KEYS,
  armor: ARMOR_STAT_KEYS,
  ship_hull: HULL_STAT_KEYS,
  hab_module: HAB_MODULE_STAT_KEYS
};

function pickStats(item) {
  const stats = {};
  for (const key of STAT_KEYS_BY_TYPE[item.componentType] || []) {
    if (item[key] !== undefined && item[key] !== null) stats[key] = item[key];
  }
  return stats;
}

function classifyComponent(component) {
  const id = String(component.id || '');
  const name = String(component.displayName || '');
  const type = component.componentType;
  const hay = `${id} ${name}`;

  if (type === 'weapon') {
    if (/missile|torpedo|nuke|warhead/i.test(hay)) return 'missile';
    if (/point.?defen/i.test(hay)) return 'point_defense';
    return 'weapon';
  }
  if (type === 'drive') return 'drive';
  if (type === 'reactor') return 'reactor';
  if (type === 'radiator') return 'radiator';
  if (type === 'battery') return 'battery';
  if (type === 'armor') return 'armor';
  if (type === 'utility') return 'utility';
  if (type === 'ship_hull') return 'ship_hull';
  if (type === 'hab_module') {
    if (/mining/i.test(hay)) return 'mine';
    if (/shipyard|construction/i.test(hay)) return 'shipyard';
    return 'hab_module';
  }
  return 'other';
}

// Renders a component into the normalized unlock record consumed by nodes.
function componentUnlock(component) {
  // component.item carries the raw template fields for stats; component itself
  // is the normalized { componentType, id, displayName, item } wrapper produced
  // by the template loader's unlock index.
  const source = component.item || component;
  const statSource = { ...source, componentType: component.componentType };
  return {
    effectId: `Unlock${component.componentType}_${component.id}`,
    type: 'unlock',
    class: classifyComponent(component),
    targetId: component.id,
    displayName: component.displayName,
    componentType: component.componentType,
    stats: pickStats(statSource)
  };
}

// Converts the effect template (TIProjectTemplate.effects entries reference
// TIEffectTemplate.dataName) into an effects record. We resolve the target via
// the component unlock index when possible; otherwise the effect is surfaced
// as a generic effect entry with its dataName and op.
function effectRecord(effectDataName, effectTemplate, componentByEffect) {
  const matched = componentByEffect ? componentByEffect[effectDataName] : null;
  if (matched) {
    return {
      effectId: effectDataName,
      type: 'unlock',
      ...matched
    };
  }
  const eff = effectTemplate || {};
  return {
    effectId: effectDataName,
    type: 'effect',
    operation: eff.operation || null,
    value: eff.value ?? null,
    effectTarget: eff.effectTarget || null,
    strValue: eff.strValue ?? null,
    displayName: effectDataName
  };
}

// Builds a normalized dependency graph from the game templates plus the save
// state. `templates` is an adapter object (see server/templateLoader) that
// exposes the same read interface; `saveState` carries the per-faction and
// global research status overlay.
//
// Returns { nodes, byId, techs, projects, categories, unlockClasses }.
export function buildTechGraph(templates, saveState = {}) {
  const techs = asArray(saveState.techs || (templates && templates.allTechs ? templates.allTechs() : []));
  const projects = asArray(saveState.projects || (templates && templates.allProjects ? templates.allProjects() : []));
  const effects = saveState.effects || {};
  const componentByEffect = saveState.componentByEffect || {};

  const byId = new Map();
  const nodeList = [];

  const seenTechIds = new Set();
  const seenProjectIds = new Set();
  const dedupeTechs = techs.filter(t => {
    const id = t.dataName || t.friendlyName;
    if (seenTechIds.has(id)) return false;
    seenTechIds.add(id);
    return true;
  });
  const dedupeProjects = projects.filter(p => {
    const id = p.dataName || p.friendlyName;
    if (seenProjectIds.has(id)) return false;
    seenProjectIds.add(id);
    return true;
  });

  const allTechIds = new Set(dedupeTechs.map(t => t.dataName || t.friendlyName));
  const allProjectIds = new Set(dedupeProjects.map(p => p.dataName || p.friendlyName));

  const resolvePrereqType = (id) => (allTechIds.has(id) ? 'global_tech' : (allProjectIds.has(id) ? 'faction_project' : 'unknown'));

  const techNode = (template) => {
    const id = template.dataName || template.friendlyName;
    const category = template.techCategory || 'General';
    const prereqRefs = asArray(template.prereqs).map(pr => ({ id: pr, type: resolvePrereqType(pr) }));
    return {
      id,
      displayName: template.friendlyName || id,
      type: 'global_tech',
      category,
      subcategory: template.AI_techRole || null,
      // `|| 0` turned an unresolved cost into a zero cost, and a zero cost
      // makes progress/cost either Infinity or NaN downstream. Absent stays
      // null; researchPercent then reports null rather than NaN.
      researchCost: numOrNull(template.researchCost),
      researchProgress: 0,
      // 0% only means something against a known cost.
      researchPercent: percentOrNull(0, template.researchCost),
      contributors: [],
      prerequisites: prereqRefs,
      effects: asArray(template.effects).map(eid => effectRecord(eid, effects[eid], componentByEffect)),
      unlocks: []
    };
  };

  // Project availability ramps from initialUnlockChance by deltaUnlockChance
  // each month, capped at maxUnlockChance. Expected wait is the mean of the
  // resulting (non-stationary) geometric process.
  const projectAvailability = (template) => {
    const initial = Number(template.initialUnlockChance);
    const delta = Number(template.deltaUnlockChance);
    const max = Number(template.maxUnlockChance);
    if (![initial, delta, max].every(Number.isFinite)) {
      return { known: false, schedulable: null, initialPercent: null, deltaPercent: null, maxPercent: null, expectedMonths: null };
    }

    const schedulable = max >= 100;
    let expectedMonths = null;
    if (max > 0) {
      // E[months] = sum over m of (m * P(first success at m)).
      let survive = 1;
      let expected = 0;
      for (let month = 1; month <= 600 && survive > 1e-6; month++) {
        const p = Math.min(initial + delta * (month - 1), max) / 100;
        expected += month * survive * p;
        survive *= (1 - p);
      }
      expectedMonths = Math.round(expected * 10) / 10;
    }

    return {
      known: true,
      schedulable,
      initialPercent: initial,
      deltaPercent: delta,
      maxPercent: max,
      expectedMonths
    };
  };

  const projectNode = (template) => {
    const id = template.dataName || template.friendlyName;
    const category = template.techCategory || 'General';
    const prereqRefs = asArray(template.prereqs).map(pr => ({ id: pr, type: resolvePrereqType(pr) }));
    // Alternate prereq path (altPrereq0) is a valid alternative to prereqs;
    // expose it as a parallel "or" prerequisite marker.
    const altRefs = template.altPrereq0 ? [{ id: template.altPrereq0, type: resolvePrereqType(template.altPrereq0), alternative: true }] : [];
    const components = templates.componentsForProject ? templates.componentsForProject(id) : [];
    const unlocks = components.map(componentUnlock);
    return {
      id,
      displayName: template.friendlyName || id,
      type: 'faction_project',
      category,
      subcategory: template.AI_projectRole || template.AI_techRole || null,
      // See techNode above: an unresolved cost is unknown, not zero.
      researchCost: numOrNull(template.researchCost),
      researchProgress: 0,
      researchPercent: percentOrNull(0, template.researchCost),
      repeatable: !!template.repeatable,
      oneTimeGlobally: !!template.oneTimeGlobally,
      // Availability is a monthly RNG gate, not a queue position. A project
      // whose maxUnlockChance is below 100 can never be scheduled -- it can
      // only be waited on. Ordering a research plan without this desyncs from
      // the actual project list.
      availability: projectAvailability(template),
      prerequisites: prereqRefs,
      alternatePrerequisites: altRefs,
      effects: asArray(template.effects).map(eid => effectRecord(eid, effects[eid], componentByEffect)),
      unlocks
    };
  };

  for (const t of dedupeTechs) {
    const node = techNode(t);
    byId.set(node.id, node);
    nodeList.push(node);
  }
  for (const p of dedupeProjects) {
    const node = projectNode(p);
    byId.set(node.id, node);
    nodeList.push(node);
  }

  const categories = {};
  const unlockClasses = {};
  for (const node of nodeList) {
    categories[node.category] = (categories[node.category] || 0) + 1;
    for (const u of node.unlocks) {
      unlockClasses[u.class] = (unlockClasses[u.class] || 0) + 1;
    }
  }

  return { nodes: nodeList, byId, techs: nodeList.filter(n => n.type === 'global_tech'), projects: nodeList.filter(n => n.type === 'faction_project'), categories, unlockClasses };
}

// Applies per-faction and global save state onto the graph to produce a single
// observer-relative status for every node. `saveState` provides:
//   finishedTechs: string[]               (global completed tech ids)
//   globalActive:  [{ techId, accumulatedResearch, totalCost, contributors }]
//   faction:       { completedProjects, currentProjects:[{projectId, accumulatedResearch, totalCost}], availableProjectNames }
//   mode:          'player' | 'enhanced' | 'omniscient'
//   includeOtherFactions: bool (unused placeholder for future matrix integration)
export function applySaveState(graph, saveState = {}) {
  const finishedTechs = new Set(asArray(saveState.finishedTechs));
  const globalActive = new Map();
  for (const slot of asArray(saveState.globalActive)) {
    globalActive.set(slot.techId, slot);
  }
  const finishedProjects = new Set(asArray(saveState.faction?.completedProjects));
  const availableProjects = new Set(asArray(saveState.faction?.availableProjectNames));
  const activeProjects = new Map();
  for (const p of asArray(saveState.faction?.currentProjects)) {
    activeProjects.set(p.projectId, p);
  }

  const result = graph.nodes.map(node => {
    const overlay = {
      ...node,
      status: 'locked',
      completed: false,
      researching: false,
      available: false,
      locked: true
    };

    if (node.type === 'global_tech') {
      if (finishedTechs.has(node.id)) {
        overlay.status = 'completed';
        overlay.completed = true;
        overlay.available = true;
        overlay.locked = false;
        overlay.researchProgress = node.researchCost;
        overlay.researchPercent = 100;
      } else {
        const active = globalActive.get(node.id);
        if (active) {
          const cost = numOrNull(active.totalCost) ?? node.researchCost;
          const progress = numOrNull(active.accumulatedResearch) ?? 0;
          overlay.status = 'researching';
          overlay.researching = true;
          overlay.available = true;
          overlay.locked = false;
          overlay.researchCost = cost;
          overlay.researchProgress = progress;
          overlay.researchPercent = percentOrNull(progress, cost);
          overlay.contributors = asArray(active.contributors);
        } else {
          overlay.status = 'available';
          overlay.available = true;
          overlay.locked = false;
        }
      }
    } else {
      if (finishedProjects.has(node.id)) {
        overlay.status = 'completed';
        overlay.completed = true;
        overlay.available = true;
        overlay.locked = false;
        overlay.researchProgress = node.researchCost;
        overlay.researchPercent = 100;
      } else {
        const active = activeProjects.get(node.id);
        if (active) {
          const cost = numOrNull(active.totalCost) ?? node.researchCost;
          const progress = numOrNull(active.accumulatedResearch) ?? 0;
          overlay.status = 'researching';
          overlay.researching = true;
          overlay.available = true;
          overlay.locked = false;
          overlay.researchCost = cost;
          overlay.researchProgress = progress;
          overlay.researchPercent = percentOrNull(progress, cost);
        } else if (availableProjects.has(node.id)) {
          overlay.status = 'available';
          overlay.available = true;
          overlay.locked = false;
        } else {
          overlay.status = 'locked';
        }
      }
    }
    return overlay;
  });

  return { nodes: result, byId: new Map(result.map(n => [n.id, n])) };
}

export function categoryFilter(nodes, category) {
  if (!category || category === 'all') return nodes;
  const predicate = CATEGORY_PREDICATES[category];
  if (!predicate) return nodes;
  return nodes.filter(predicate);
}

// Resolves a node id from an exact internal id or a case-insensitive search on
// display name / id. Returns the matched node or null.
export function resolveNode(graph, target) {
  if (!target) return null;
  const exact = graph.byId.get(target);
  if (exact) return exact;
  const lower = String(target).toLowerCase().replace(/[^a-z0-9]/gi, '');
  for (const node of graph.nodes) {
    const idNorm = String(node.id).toLowerCase().replace(/[^a-z0-9]/gi, '');
    const nameNorm = String(node.displayName).toLowerCase().replace(/[^a-z0-9]/gi, '');
    if (idNorm === lower || nameNorm === lower) return node;
    if (node.unlocks.some(u => String(u.displayName).toLowerCase().replace(/[^a-z0-9]/gi, '') === lower)) return node;
  }
  return null;
}

/**
 * Candidate prerequisite branches for a node.
 * Under Terra Invicta game mechanics, altPrereq0 substitutes for prerequisites[0] only;
 * prerequisites[1..n] (component/tier lineage) still strictly bind across all branches.
 *
 * @param {Object} node
 * @returns {Array<Array<{id: string, type: string, isAlternate?: boolean}>>}
 */
export function getPrerequisiteBranches(node) {
  const prereqs = asArray(node?.prerequisites);
  const alternates = asArray(node?.alternatePrerequisites);

  if (prereqs.length === 0) {
    if (alternates.length > 0) {
      return [alternates.map(alt => ({ ...alt, isAlternate: true }))];
    }
    return [[]];
  }

  const p0 = prereqs[0];
  const rest = prereqs.slice(1);
  const primaryBranch = [p0, ...rest];

  if (alternates.length === 0) {
    return [primaryBranch];
  }

  // Each alternate substitutes for prereqs[0] while keeping prereqs[1..n]
  const alternateBranches = alternates.map(alt => [
    { ...alt, isAlternate: true },
    ...rest
  ]);

  return [primaryBranch, ...alternateBranches];
}

// Computes remaining research cost for a node, accounting for current
// progress. Returns null when the node's cost is unknown or unresearchable
// (sentinel researchCost < 0) -- `|| 0` reported an unresolved or alien node as
// costing nothing more to finish, which understates every path total that
// contains one.
function remainingCost(node) {
  const cost = numOrNull(node?.researchCost);
  if (cost === null || cost < 0) return null;
  const progress = numOrNull(node?.researchProgress) ?? 0;
  return Math.max(0, cost - progress);
}

/**
 * Evaluates the optimal (cheapest satisfying) prerequisite path for targetNode,
 * exploring alternative routes (altPrereq0) where they exist and reporting routes evaluated.
 *
 * `satisfied` is ADDITIVE and carries the other half of the path: the
 * prerequisites already completed along the branch that was chosen. The walker
 * skips those by design, so without it a 12-step path reports nothing about the
 * eleven prerequisites the player has already done, and reads as a to-do list
 * rather than a path. It follows the CHOSEN branch only -- a completed
 * prerequisite on the route not taken is not on this path. `path`, `cost`,
 * `costComplete` and `routesEvaluated` are untouched by it.
 *
 * `ordered` is the second ADDITIVE field, and it is a different order from
 * `path` rather than a reformatting of it. `path` is a PRE-order walk -- a node,
 * then what it needs -- so reversing it does NOT give a dependency order:
 * measured on the live save, `Project_ExoticHybridSystems` and `Project_Exotics`
 * are siblings under one parent while the first also depends on the second, and
 * the reversed pre-order puts the dependent first. `ordered` is the post-order
 * walk with first-occurrence dedupe, which IS a topological order: every node
 * appears after every prerequisite of it that is also on the path.
 */
export function collectOptimalRemainingPath(graph, byId, targetNode, includeSelf = true, activeStack = new Set()) {
  if (!targetNode || targetNode.status === 'completed') {
    return { path: [], routesEvaluated: [], satisfied: [], ordered: [], cost: 0, costComplete: true };
  }

  if (activeStack.has(targetNode.id)) {
    // Cycle detected, break recursion. A cycle has no topological order, so
    // `ordered` is empty here for the same reason `path` is.
    return { path: [], routesEvaluated: [], satisfied: [], ordered: [], cost: 0, costComplete: true };
  }

  const newStack = new Set(activeStack);
  newStack.add(targetNode.id);

  const branches = getPrerequisiteBranches(targetNode);
  const evaluatedBranches = [];

  for (let bIndex = 0; bIndex < branches.length; bIndex++) {
    const branch = branches[bIndex];
    const branchPath = [];
    const branchRoutes = [];
    const branchSatisfied = [];
    const branchSatisfiedIds = new Set();
    const branchOrdered = [];
    const orderedInBranch = new Set();
    const seenInBranch = new Set();
    let branchCost = 0;
    let branchCostComplete = true;

    for (const prereqRef of branch) {
      const prereqNode = byId.get(prereqRef.id);
      if (!prereqNode) continue;
      if (prereqNode.status === 'completed') {
        // The half the remaining-path walk drops. Recorded, never costed: a
        // completed prerequisite contributes nothing to any remaining total.
        if (!branchSatisfiedIds.has(prereqNode.id)) {
          branchSatisfiedIds.add(prereqNode.id);
          branchSatisfied.push(prereqNode);
        }
        continue;
      }

      const subResult = collectOptimalRemainingPath(graph, byId, prereqNode, true, newStack);
      for (const satisfiedNode of subResult.satisfied) {
        if (!branchSatisfiedIds.has(satisfiedNode.id)) {
          branchSatisfiedIds.add(satisfiedNode.id);
          branchSatisfied.push(satisfiedNode);
        }
      }
      // FIRST occurrence wins, which is what makes this a topological order:
      // the first time a node is emitted post-order, everything it needs has
      // already been emitted. A later duplicate can only be earlier than its own
      // prerequisites, so it is dropped rather than moved.
      for (const item of subResult.ordered) {
        if (!orderedInBranch.has(item.id)) {
          orderedInBranch.add(item.id);
          branchOrdered.push(item);
        }
      }
      for (const item of subResult.path) {
        if (!seenInBranch.has(item.id)) {
          seenInBranch.add(item.id);
          branchPath.push(item);
          const c = remainingCost(byId.get(item.id));
          if (c === null) {
            branchCostComplete = false;
          } else {
            branchCost += c;
          }
        }
      }
      for (const r of subResult.routesEvaluated) {
        if (!branchRoutes.some(existing => existing.nodeId === r.nodeId)) {
          branchRoutes.push(r);
        }
      }
      if (!subResult.costComplete) {
        branchCostComplete = false;
      }
    }

    evaluatedBranches.push({
      branchIndex: bIndex,
      isAlternate: bIndex > 0,
      branchRef: branch[0] || null,
      path: branchPath,
      routesEvaluated: branchRoutes,
      satisfied: branchSatisfied,
      ordered: branchOrdered,
      cost: branchCostComplete ? branchCost : null,
      costComplete: branchCostComplete,
      nodeCount: branchPath.length
    });
  }

  // Pick optimal branch:
  // 1. Prefer branches where cost is complete (researchable) over unresearchable/sentinel branches.
  // 2. Among complete branches, pick lowest remaining cost.
  // 3. If tied, pick fewer nodes.
  evaluatedBranches.sort((a, b) => {
    if (a.costComplete && !b.costComplete) return -1;
    if (!a.costComplete && b.costComplete) return 1;
    if (a.cost !== null && b.cost !== null) {
      if (a.cost !== b.cost) return a.cost - b.cost;
    }
    return a.nodeCount - b.nodeCount;
  });

  const bestBranch = evaluatedBranches[0] || {
    branchIndex: 0,
    isAlternate: false,
    path: [],
    routesEvaluated: [],
    satisfied: [],
    ordered: [],
    cost: 0,
    costComplete: true
  };
  const finalRoutes = [...bestBranch.routesEvaluated];

  if (branches.length > 1) {
    const primaryBranch = evaluatedBranches.find(b => b.branchIndex === 0) || evaluatedBranches[0];
    const altBranch = evaluatedBranches.find(b => b.branchIndex > 0) || evaluatedBranches[1];
    const chosen = bestBranch;
    const unchosen = chosen === primaryBranch ? altBranch : primaryBranch;

    if (primaryBranch && altBranch) {
      const chosenFirstRef = chosen.isAlternate
        ? (targetNode.alternatePrerequisites && targetNode.alternatePrerequisites[chosen.branchIndex - 1]) || chosen.branchRef
        : (targetNode.prerequisites && targetNode.prerequisites[0]) || chosen.branchRef;
      const unchosenFirstRef = unchosen.isAlternate
        ? (targetNode.alternatePrerequisites && targetNode.alternatePrerequisites[unchosen.branchIndex - 1]) || unchosen.branchRef
        : (targetNode.prerequisites && targetNode.prerequisites[0]) || unchosen.branchRef;

      const chosenNode = byId.get(chosenFirstRef?.id);
      const unchosenNode = byId.get(unchosenFirstRef?.id);

      const targetSelfCost = remainingCost(targetNode) || 0;
      const chosenTotalBranchCost = chosen.cost !== null ? chosen.cost + targetSelfCost : null;
      const unchosenTotalBranchCost = unchosen.cost !== null ? unchosen.cost + targetSelfCost : null;

      finalRoutes.unshift({
        nodeId: targetNode.id,
        nodeDisplayName: targetNode.displayName,
        chosenRoute: {
          id: chosenFirstRef?.id || null,
          displayName: chosenNode?.displayName || chosenFirstRef?.id || null,
          type: chosen.isAlternate ? 'alternate' : 'primary',
          cost: remainingCost(chosenNode)
        },
        alternativeRoute: {
          id: unchosenFirstRef?.id || null,
          displayName: unchosenNode?.displayName || unchosenFirstRef?.id || null,
          type: unchosen.isAlternate ? 'alternate' : 'primary',
          cost: remainingCost(unchosenNode)
        },
        savings: (chosenTotalBranchCost !== null && unchosenTotalBranchCost !== null)
          ? Math.max(0, unchosenTotalBranchCost - chosenTotalBranchCost)
          : null
      });
    }
  }

  const finalPath = [...bestBranch.path];
  if (includeSelf) {
    finalPath.unshift(targetNode);
  }

  // Post-order: self comes LAST, after everything it depends on.
  const finalOrdered = [...(bestBranch.ordered || [])];
  if (includeSelf) {
    finalOrdered.push(targetNode);
  }

  const selfCost = remainingCost(targetNode);
  const totalCost = (bestBranch.costComplete && selfCost !== null) ? bestBranch.cost + selfCost : null;

  return {
    path: finalPath,
    routesEvaluated: finalRoutes,
    satisfied: bestBranch.satisfied || [],
    ordered: finalOrdered,
    cost: totalCost,
    costComplete: bestBranch.costComplete && selfCost !== null
  };
}

export function collectRemainingPath(graph, byId, targetNode, includeSelf = true) {
  const result = collectOptimalRemainingPath(graph, byId, targetNode, includeSelf);
  return result.path;
}

// A path's satisfied half is small in practice -- the deepest node in the
// 899-node graph (Project_ProtiumConverterTorch, measured 2026-08-21) carries 20
// -- but a cap that never announces itself is the same defect as fabricating
// data, so the true total and the omitted count travel with the list either way.
export const SATISFIED_PREREQUISITE_LIMIT = 60;

// The one thing a "0 remaining" path cannot tell you. Availability is ROLLED
// monthly from initialUnlockChance/deltaUnlockChance/maxUnlockChance, never
// derived from prerequisites (docs/research-advisor-spec.md 3b, measured:
// 104 of 274 prereq-clear projects were not actually available). Carried on the
// payload so an agent reading /api/intel/tech-path sees it, not only the modal.
export const ROLLED_AVAILABILITY_CAVEAT = 'Prerequisites met does not mean startable. Project availability is rolled monthly from each project\'s unlock chance, not derived from its prerequisites, so a path reading zero remaining may still not be offered this month.';

export function buildTechPath(graph, byId, targets) {
  const resolved = [];
  const seen = new Set();
  for (const target of targets) {
    const node = resolveNode(graph, target);
    if (!node) {
      resolved.push({ target, id: null, displayName: null, error: `Target '${target}' not found.` });
      continue;
    }
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    resolved.push({ target, node });
  }

  const alreadyCompleted = [];
  const remainingPath = [];
  const remainingSet = new Set();
  const allRoutesEvaluated = [];
  // The satisfied half of the path. Separate from `alreadyCompleted`, which
  // names TARGETS that are already done; these are the PREREQUISITES already
  // done on the way to a target that is not.
  const satisfiedPrerequisites = [];
  const satisfiedSet = new Set();
  // The same nodes as `remainingPath`, by id, in an order a reader can follow:
  // every node after every prerequisite of it that is also on the path.
  // `remainingPath` itself is pre-order and must not be reordered -- it is
  // consumed by the chain promotion in COMMAND and by the drive-chain rows,
  // both of which read `remainingPath[length - 1]` as the immediate next step.
  const dependencyOrder = [];
  const dependencyOrderSet = new Set();

  for (const { node } of resolved) {
    if (!node) continue;
    if (node.status === 'completed') {
      alreadyCompleted.push({ id: node.id, displayName: node.displayName, type: node.type });
      continue;
    }
    const { path, routesEvaluated, satisfied, ordered } = collectOptimalRemainingPath(graph, byId, node, true);
    for (const item of asArray(ordered)) {
      if (dependencyOrderSet.has(item.id)) continue;
      dependencyOrderSet.add(item.id);
      dependencyOrder.push(item.id);
    }
    for (const item of asArray(satisfied)) {
      if (satisfiedSet.has(item.id)) continue;
      satisfiedSet.add(item.id);
      satisfiedPrerequisites.push({
        id: item.id,
        displayName: item.displayName,
        type: item.type,
        category: item.category,
        cost: item.researchCost,
        status: item.status,
        progressPercent: item.researchPercent
      });
    }
    for (const item of path) {
      if (remainingSet.has(item.id)) continue;
      remainingSet.add(item.id);
      remainingPath.push({
        id: item.id,
        displayName: item.displayName,
        type: item.type,
        category: item.category,
        cost: item.researchCost,
        status: item.status,
        progressPercent: item.researchPercent
      });
    }
    for (const route of routesEvaluated) {
      if (!allRoutesEvaluated.some(r => r.nodeId === route.nodeId)) {
        allRoutesEvaluated.push(route);
      }
    }
  }

  let remainingGlobalResearchCost = 0;
  let remainingFactionResearchCost = 0;
  const uncostedNodes = [];
  let globalCostComplete = true;
  let factionCostComplete = true;

  for (const item of remainingPath) {
    const cost = remainingCost(graph.byId.get(item.id));
    if (cost === null) {
      uncostedNodes.push(item.id);
      if (item.type === 'global_tech') globalCostComplete = false;
      else factionCostComplete = false;
      continue;
    }
    if (item.type === 'global_tech') remainingGlobalResearchCost += cost;
    else remainingFactionResearchCost += cost;
  }

  const researchCostComplete = uncostedNodes.length === 0;
  const single = resolved.length === 1 && resolved[0].node;
  const satisfiedShown = satisfiedPrerequisites.slice(0, SATISFIED_PREREQUISITE_LIMIT);
  const base = {
    alreadyCompleted,
    remainingPath,
    // ADDITIVE. Nothing above or below this reads it, and no cost field counts
    // it: a completed prerequisite has no remaining cost by definition.
    satisfiedPrerequisites: satisfiedShown,
    satisfiedPrerequisiteTotalCount: satisfiedPrerequisites.length,
    satisfiedPrerequisiteOmittedCount: satisfiedPrerequisites.length - satisfiedShown.length,
    // Ids only, so `remainingPath` stays the one place a node's fields live.
    remainingPathDependencyOrder: dependencyOrder,
    availabilityCaveat: ROLLED_AVAILABILITY_CAVEAT,
    remainingGlobalResearchCost: globalCostComplete ? remainingGlobalResearchCost : null,
    remainingFactionResearchCost: factionCostComplete ? remainingFactionResearchCost : null,
    totalRemainingResearchCost: researchCostComplete ? remainingGlobalResearchCost + remainingFactionResearchCost : null,
    uncostedNodes,
    researchCostComplete,
    routesEvaluated: allRoutesEvaluated
  };
  if (single) {
    return {
      target: { id: single.id, displayName: single.displayName, type: single.type },
      ...base
    };
  }
  return {
    targets: resolved.map(r => r.node ? { id: r.node.id, displayName: r.node.displayName, type: r.node.type } : { target: r.target, error: r.error }),
    ...base
  };
}

export function buildTechSearch(graph, query) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return { items: [] };
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/gi, '');
  const qn = norm(q);

  const items = [];
  for (const node of graph.nodes) {
    if (node.type !== 'faction_project') continue;
    const idNorm = norm(node.id);
    const nameNorm = norm(node.displayName);
    const unlockNames = node.unlocks.map(u => norm(u.displayName));
    const effectIds = node.effects.map(e => norm(e.effectId));
    if (idNorm.includes(qn) || nameNorm.includes(qn) ||
        unlockNames.some(u => u.includes(qn)) ||
        effectIds.some(e => e.includes(qn))) {
      items.push({
        id: node.id,
        displayName: node.displayName,
        category: node.category,
        status: node.status,
        unlocks: node.unlocks.map(u => ({ class: u.class, id: u.targetId, displayName: u.displayName })),
        researchCost: node.researchCost
      });
    }
  }
  return { items };
}

const MILESTONE_ORDER = ['ship_hull', 'weapon', 'missile', 'point_defense', 'drive', 'reactor', 'battery', 'radiator', 'armor', 'hab_module', 'mine', 'shipyard', 'intel_capability'];

export function buildTechMilestones(graph, byId, category = null) {
  const items = [];
  const byProject = new Map();
  for (const node of graph.nodes) {
    if (node.type !== 'faction_project') continue;
    for (const unlock of node.unlocks) {
      if (category && unlock.class !== category) continue;
      const key = `${unlock.class}:${unlock.targetId}`;
      if (byProject.has(key)) continue;
      byProject.set(key, {
        category: unlock.class,
        name: unlock.displayName,
        targetId: unlock.targetId,
        status: node.status,
        unlockProject: node.id,
        unlockProjectName: node.displayName,
        // An unresolved cost makes researchability unknown, not false.
        researchable: node.researchCost === null ? null : node.researchCost > 0,
        researchCostAvailable: node.researchCost !== null,
        remainingResearchCost: node.status === 'completed' || node.status === 'researching'
          ? 0
          : (node.researchCost > 0 ? Math.max(0, node.researchCost - (numOrNull(node.researchProgress) ?? 0)) : null)
      });
    }
  }
  for (const value of byProject.values()) items.push(value);
  items.sort((a, b) => {
    const ac = MILESTONE_ORDER.indexOf(a.category);
    const bc = MILESTONE_ORDER.indexOf(b.category);
    if (ac !== bc) return (ac === -1 ? 99 : ac) - (bc === -1 ? 99 : bc);
    return a.name.localeCompare(b.name);
  });
  return { items };
}

// Opportunity view for available projects: cost, unlock count, strategic unlock
// types, and number of downstream nodes unlocked.
export function buildProjectOpportunities(graph, byId) {
  const downstreamCache = new Map();
  const countDownstream = (nodeId) => {
    if (downstreamCache.has(nodeId)) return downstreamCache.get(nodeId);
    let count = 0;
    for (const candidate of graph.nodes) {
      if (candidate.prerequisites.some(p => p.id === nodeId)) {
        count += 1 + countDownstream(candidate.id);
      }
    }
    downstreamCache.set(nodeId, count);
    return count;
  };

  return graph.nodes
    .filter(node => node.type === 'faction_project' && (node.status === 'available' || node.status === 'researching'))
    .map(node => {
      const unlockSummary = {};
      for (const unlock of node.unlocks) {
        unlockSummary[unlock.class] = (unlockSummary[unlock.class] || 0) + 1;
      }
      return {
        id: node.id,
        displayName: node.displayName,
        cost: node.researchCost,
        status: node.status,
        progressPercent: node.researchPercent,
        unlockSummary,
        unlockCount: node.unlocks.length,
        strategicUnlockTypes: Object.keys(unlockSummary),
        downstreamProjects: countDownstream(node.id)
      };
    })
    .sort((a, b) => a.cost - b.cost || b.unlockCount - a.unlockCount);
}

// Per-faction completion matrix for a set of strategic projects.
export function buildTechMatrix(graph, factions) {
  const rows = [];
  const seen = new Set();
  for (const node of graph.nodes) {
    if (node.type !== 'faction_project') continue;
    if (!node.unlocks.length) continue;
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    const row = { projectId: node.id, displayName: node.displayName, category: node.category, factions: {} };
    for (const faction of asArray(factions)) {
      row.factions[faction.ID] = {
        factionName: faction.displayName,
        status: factionStatus(faction, node.id)
      };
    }
    rows.push(row);
  }
  return rows;
}

function factionStatus(faction, projectId) {
  const finished = asArray(faction.completedProjects).includes(projectId);
  if (finished) return 'completed';
  const active = asArray(faction.currentProjects).find(p => (p.projectId || p.ID) === projectId);
  if (active) return 'researching';
  if (asArray(faction.availableProjectNames).includes(projectId)) return 'available';
  return 'locked';
}

export function buildResearchQueue(snapshot, observerFactionId) {
  const globalResearch = snapshot.globalResearch || {};
  const observer = asArray(snapshot.factions).find(f => sameId(f.ID, observerFactionId));
  const globalSlots = asArray(globalResearch.activeSlots).map(slot => ({
    techId: slot.techId,
    displayName: slot.displayName,
    progress: slot.percent / 100,
    accumulatedResearch: slot.accumulatedResearch,
    totalCost: slot.totalCost,
    initiativeContribution: (asArray(slot.contributions).find(c => sameId(c.factionId, observerFactionId)) || {}).contribution || 0,
    leadingFaction: slot.leadFactionName || null
  }));
  const factionProjects = asArray(observer?.currentProjects).map(p => ({
    projectId: p.projectId || p.ID,
    displayName: p.displayName,
    progress: (p.percent || 0) / 100
  }));
  return {
    globalSlots,
    factionProjects,
    monthlyResearch: observer?.totalResearch ?? null
  };
}

// ---------------------------------------------------------------------------
// Snapshot-backed projections
//
// These operate on a filtered snapshot that already carries an embedded
// `techTree` graph (built at publish time from the game templates and the raw
// save state). They resolve the per-observer/mode overlay and produce the same
// normalized payloads for the local dashboard and the hosted worker, which
// cannot read the local template files at request time.
// ---------------------------------------------------------------------------

export function graphFromTree(snapshot) {
  const nodes = snapshot?.techTree?.nodes || [];
  // Published snapshots may omit the tech tree to save storage, leaving a
  // `techTreeRef` marker instead. Surface that explicitly: an empty graph and
  // a deliberately-omitted graph look identical otherwise, and callers would
  // report "no techs" as though it were the truth.
  // Two shapes mean "deliberately not embedded": the legacy whole-tree
  // techTreeRef, and the current graphRef, where only the static nodes are
  // shared per campaign and a reader failed to splice them back in.
  const graphRef = snapshot?.techTree?.graphRef || null;
  const unresolvedGraphRef = !!graphRef && nodes.length === 0;
  const omitted = (!snapshot?.techTree && !!snapshot?.techTreeRef) || unresolvedGraphRef;
  return {
    nodes,
    byId: new Map(nodes.map(n => [n.id, n])),
    techs: nodes.filter(n => n.type === 'global_tech'),
    projects: nodes.filter(n => n.type === 'faction_project'),
    categories: snapshot?.techTree?.categories || snapshot?.techTreeRef?.categories || {},
    unlockClasses: snapshot?.techTree?.unlockClasses || snapshot?.techTreeRef?.unlockClasses || {},
    omitted,
    omittedReason: !omitted
      ? null
      : unresolvedGraphRef
        ? (snapshot.techTree.graphUnavailable
          || `shared tech graph ${graphRef.fingerprint} was not spliced in by the reader`)
        : (snapshot.techTreeRef.reason || 'tech tree omitted from this snapshot'),
    expectedNodeCount: !omitted
      ? nodes.length
      : unresolvedGraphRef
        ? (graphRef.nodeCount ?? null)
        : (snapshot.techTreeRef.nodeCount ?? null)
  };
}

// Resolves the per-observer/mode save-state overlay and applies it to the graph.
export function observerGraph(snapshot, mode, observerId) {
  const tree = snapshot.techTree || {};
  const base = graphFromTree(snapshot);
  const factionStatus = (tree.factionStatus || {})[observerId] || {};
  const saveState = {
    finishedTechs: tree.finishedTechsNames || [],
    globalActive: tree.globalActive || [],
    faction: {
      completedProjects: factionStatus.completedProjects || [],
      availableProjectNames: factionStatus.availableProjectNames || [],
      currentProjects: factionStatus.currentProjects || []
    },
    mode,
    observerId
  };
  return applySaveState(base, saveState);
}

// Builds a single node's normalized projection for the tech-tree endpoint.
function projectTreeNode(node, includeEffects) {
  const out = {
    id: node.id,
    displayName: node.displayName,
    type: node.type,
    category: node.category,
    subcategory: node.subcategory,
    status: node.status,
    researchCost: node.researchCost,
    researchProgress: node.researchProgress,
    researchPercent: node.researchPercent,
    completed: node.completed,
    researching: node.researching,
    available: node.available,
    locked: node.locked,
    prerequisites: node.prerequisites,
    unlocks: node.unlocks.map(u => ({ class: u.class, id: u.targetId, displayName: u.displayName }))
  };
  // Projects are gated by a monthly availability roll, so a research plan that
  // treats them as orderable steps will desync from the real project list.
  if (node.availability) out.availability = node.availability;
  if (node.type === 'global_tech') out.contributors = node.contributors;
  if (includeEffects) {
    out.effects = node.effects;
    out.alternatePrerequisites = node.alternatePrerequisites || [];
  }
  return out;
}

export function buildTechTreeProjection(snapshot, mode, observerId, options = {}) {
  const { category = 'all', includeEffects = true } = options;
  const graph = observerGraph(snapshot, mode, observerId);
  const nodes = categoryFilter(graph.nodes, category).map(node => projectTreeNode(node, includeEffects));
  return {
    resource: 'tech-tree',
    category,
    counts: {
      nodes: nodes.length,
      techs: snapshot?.techTree?.counts?.techs || 0,
      projects: snapshot?.techTree?.counts?.projects || 0
    },
    categories: snapshot?.techTree?.categories || {},
    unlockClasses: snapshot?.techTree?.unlockClasses || {},
    nodes
  };
}

export function buildTechPathProjection(snapshot, mode, observerId, targets) {
  const graph = observerGraph(snapshot, mode, observerId);
  const path = buildTechPath(graph, graph.byId, targets);
  return { resource: 'tech-path', ...path };
}

export function buildTechSearchProjection(snapshot, mode, observerId, query) {
  const graph = observerGraph(snapshot, mode, observerId);
  const result = buildTechSearch(graph, query);
  return { resource: 'tech-search', query, count: result.items.length, items: result.items };
}

export function buildTechMilestonesProjection(snapshot, mode, observerId, category = null) {
  const graph = observerGraph(snapshot, mode, observerId);
  const result = buildTechMilestones(graph, graph.byId, category);
  return { resource: 'tech-milestones', category: category || 'all', count: result.items.length, items: result.items };
}

export function buildTechMatrixProjection(snapshot, mode, observerId) {
  const graph = observerGraph(snapshot, mode, observerId);
  const rows = buildTechMatrix(graph, asArray(snapshot.factions));
  return { resource: 'tech-matrix', count: rows.length, items: rows };
}

export function buildTechOpportunitiesProjection(snapshot, mode, observerId) {
  const graph = observerGraph(snapshot, mode, observerId);
  const items = buildProjectOpportunities(graph, graph.byId);
  return { resource: 'tech-opportunities', count: items.length, items };
}

export function buildResearchQueueProjection(snapshot, mode, observerId) {
  const queue = buildResearchQueue(snapshot, observerId);
  return { resource: 'research-queue', ...queue };
}
