// shared/techGraph.mjs
//
// Pure tech-tree normalization + dependency-graph helpers shared by the local
// Express server and the hosted Cloudflare worker. It has no runtime-specific
// imports so it stays usable in both.
//
// Core principle (from the research spec):
//   Do not hand-maintain a Terra Invicta tech tree. Parse the game's templates
//   into a dependency graph, then overlay the current save's completion /
//   progress state on top of it.

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

export const asArray = (value) => (Array.isArray(value) ? value : []);

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
      researchCost: template.researchCost || 0,
      researchProgress: 0,
      researchPercent: 0,
      contributors: [],
      prerequisites: prereqRefs,
      effects: asArray(template.effects).map(eid => effectRecord(eid, effects[eid], componentByEffect)),
      unlocks: []
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
      researchCost: template.researchCost || 0,
      researchProgress: 0,
      researchPercent: 0,
      repeatable: !!template.repeatable,
      oneTimeGlobally: !!template.oneTimeGlobally,
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
          const cost = active.totalCost || node.researchCost;
          const progress = active.accumulatedResearch || 0;
          overlay.status = 'researching';
          overlay.researching = true;
          overlay.available = true;
          overlay.locked = false;
          overlay.researchCost = cost;
          overlay.researchProgress = progress;
          overlay.researchPercent = Math.min(100, Math.round((progress / cost) * 1000) / 10);
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
          const cost = active.totalCost || node.researchCost;
          const progress = active.accumulatedResearch || 0;
          overlay.status = 'researching';
          overlay.researching = true;
          overlay.available = true;
          overlay.locked = false;
          overlay.researchCost = cost;
          overlay.researchProgress = progress;
          overlay.researchPercent = Math.min(100, Math.round((progress / cost) * 1000) / 10);
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

// Breadth-first traversal collecting every prerequisite (transitively) that is
// not yet completed. Returns an ordered array of remaining nodes. Nodes that are
// still locked are included: they are part of the remaining research path even
// though they are not yet selectable.
export function collectRemainingPath(graph, byId, targetNode, includeSelf = true) {
  const remaining = [];
  const visited = new Set();
  const queue = [targetNode];
  while (queue.length) {
    const current = queue.shift();
    if (visited.has(current.id)) continue;
    visited.add(current.id);
    if (current.status === 'completed') continue;
    remaining.push(current);
    for (const prereq of current.prerequisites) {
      const prereqNode = byId.get(prereq.id);
      if (prereqNode && !visited.has(prereqNode.id)) queue.push(prereqNode);
    }
    // altPrereq0 is an alternative, not a strict requirement, so it is not
    // traversed as a hard dependency here.
  }
  if (!includeSelf) {
    return remaining.filter(n => n.id !== targetNode.id);
  }
  return remaining;
}

// Computes remaining research cost for a node, accounting for current progress.
function remainingCost(node) {
  const cost = node.researchCost || 0;
  const progress = node.researchProgress || 0;
  return Math.max(0, cost - progress);
}

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
  for (const { node } of resolved) {
    if (!node) continue;
    if (node.status === 'completed') {
      alreadyCompleted.push({ id: node.id, displayName: node.displayName, type: node.type });
      continue;
    }
    const path = collectRemainingPath(graph, byId, node);
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
  }

  let remainingGlobalResearchCost = 0;
  let remainingFactionResearchCost = 0;
  for (const item of remainingPath) {
    const cost = remainingCost(graph.byId.get(item.id));
    if (item.type === 'global_tech') remainingGlobalResearchCost += cost;
    else remainingFactionResearchCost += cost;
  }

  const single = resolved.length === 1 && resolved[0].node;
  const base = {
    alreadyCompleted,
    remainingPath,
    remainingGlobalResearchCost,
    remainingFactionResearchCost,
    totalRemainingResearchCost: remainingGlobalResearchCost + remainingFactionResearchCost
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
        researchable: node.researchCost > 0,
        remainingResearchCost: node.status === 'completed' || node.status === 'researching'
          ? 0
          : (node.researchCost > 0 ? Math.max(0, node.researchCost - (node.researchProgress || 0)) : null)
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
  const observer = asArray(snapshot.factions).find(f => f.ID === observerFactionId);
  const globalSlots = asArray(globalResearch.activeSlots).map(slot => ({
    techId: slot.techId,
    displayName: slot.displayName,
    progress: slot.percent / 100,
    accumulatedResearch: slot.accumulatedResearch,
    totalCost: slot.totalCost,
    initiativeContribution: (asArray(slot.contributions).find(c => c.factionId === observerFactionId) || {}).contribution || 0,
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
  return {
    nodes,
    byId: new Map(nodes.map(n => [n.id, n])),
    techs: nodes.filter(n => n.type === 'global_tech'),
    projects: nodes.filter(n => n.type === 'faction_project'),
    categories: snapshot?.techTree?.categories || {},
    unlockClasses: snapshot?.techTree?.unlockClasses || {}
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
