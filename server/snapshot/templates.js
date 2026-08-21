// server/snapshot/templates.js
//
// The three template-derived static builders. They read the installed game
// templates and depend on no save data at all, which is why they can be called
// standalone by tests and why their output is baked onto every snapshot: the
// hosted worker has no template directory, so anything that reads templates at
// request time works locally and breaks the deployed site.

const templateLoader = require('../templateLoader');

/**
 * Indices into a TIMissionTemplate `hate` array (6 slots, one per mission
 * outcome). Read from the installed templates, not the wiki:
 *   DominateNation [0, 30, 20, 0, 5, 5]  -- slot 1 is worse than slot 2, which
 *     is what identifies them as critical-failure and failure respectively.
 *   Detain         [0, 1, 1, 0, 2, 3]    -- slots 4 and 5 rise together, the
 *     success and critical-success pair.
 * Slots 0 and 3 are unused by every mission in TIMissionTemplate.json
 * (verified 2026-08-20 against the 1.0 templates). `server/directiveAdvisor.js`
 * cites the same slot 4 for its success-hate figures.
 */
const MISSION_HATE_SLOT = Object.freeze({
  criticalFailure: 1,
  failure: 2,
  success: 4,
  criticalSuccess: 5
});

// Attribute modifiers granted by councilor traits, from the game templates.
// The augmentation/implant lines are the significant ones (ExecutiveAI +3
// Administration, CognitiveEnhancer +3 Science). Conditional and overriding
// mods are carried through with flags so the consumer can report them as
// unresolved rather than applying them blindly.
function buildTraitStatMods() {
  const mods = {};
  for (const trait of templateLoader.templates.traits.values()) {
    const name = trait.dataName || trait.friendlyName;
    if (!name) continue;
    const entries = (Array.isArray(trait.statMods) ? trait.statMods : [])
      .filter(mod => mod && mod.stat)
      .map(mod => ({
        stat: mod.stat,
        value: Number(mod.strValue) || 0,
        operation: mod.operation || 'Additive',
        conditional: Boolean(mod.condition)
      }));
    if (entries.length > 0) mods[name] = entries;
  }
  return mods;
}

// Mission rules, read from the installed templates so the engine never has
// to hardcode them. Carries the attack/defence attribute pairing, the base
// difficulty that stacks on the defender's stat, hate by outcome, and cost.
//
// Exposed on the snapshot for the same reason as shipHullStats: the hosted
// worker has no template directory, so anything that reads templates at
// request time works locally and breaks the deployed site.
//
// Measured at ~12.8 KB raw / 1.8 KB gzipped for 43 missions, so no dedupe
// or static/dynamic split is needed the way the tech graph required one.
function buildMissionSpecs() {
  const specs = {};
  for (const mission of templateLoader.templates.missions.values()) {
    const dataName = mission.dataName || mission.friendlyName;
    if (!dataName || mission.disable === true) continue;

    const resolution = mission.resolutionMethod || {};
    const conditions = (Array.isArray(mission.conditions) ? mission.conditions : [])
      .map(c => String(c?.$type || '').replace('TIMissionCondition_', ''))
      .filter(Boolean);

    // Victory missions are endgame triggers, not cycle decisions.
    if (conditions.includes('VictoryCondition')) continue;

    const attacking = Array.isArray(resolution.attackingModifiers) ? resolution.attackingModifiers : [];
    const defending = Array.isArray(resolution.defendingModifiers) ? resolution.defendingModifiers : [];
    const attack = attacking.find(m => m?.attackerAttribute)?.attackerAttribute || null;
    const defend = defending.find(m => m?.defenderAttribute)?.defenderAttribute || null;

    // The wiki's "Base Difficulty" column is a defence-side FlatModifier.
    // It stacks on top of the defender's attribute and is wildly uneven --
    // Turn Councilor carries 15, Crackdown 0 -- so omitting it makes every
    // odds estimate wrong in the direction that matters.
    const flat = defending.find(m => String(m?.$type || '').includes('FlatModifier'));
    const baseDifficulty = flat
      ? (Object.entries(flat).find(([key]) => key !== '$type')?.[1] ?? null)
      : 0;

    const hate = Array.isArray(mission.hate) ? mission.hate : [];
    const cost = mission.cost || {};

    specs[dataName] = {
      friendlyName: mission.friendlyName || dataName,
      // Explicit zeros, never null. Everywhere else in this codebase null
      // means unmeasured, and the hate model depends on that distinction --
      // "costs nothing" and "unknown" must not share a value.
      successHate: typeof hate[MISSION_HATE_SLOT.success] === 'number' ? hate[MISSION_HATE_SLOT.success] : 0,
      criticalHate: typeof hate[MISSION_HATE_SLOT.criticalSuccess] === 'number' ? hate[MISSION_HATE_SLOT.criticalSuccess] : 0,
      // The worse of the two failure branches, so an unread branch never
      // makes a mission look cheaper than its worst outcome.
      failureHate: Math.max(
        typeof hate[MISSION_HATE_SLOT.criticalFailure] === 'number' ? hate[MISSION_HATE_SLOT.criticalFailure] : 0,
        typeof hate[MISSION_HATE_SLOT.failure] === 'number' ? hate[MISSION_HATE_SLOT.failure] : 0
      ),
      attack,
      defend,
      baseDifficulty: typeof baseDifficulty === 'number' ? baseDifficulty : 0,
      contested: String(resolution.$type || '').includes('Contested'),
      costResource: cost.resourceType || null,
      costKind: String(cost.$type || '').replace('TIMissionCost_', '') || null,
      costAmount: typeof cost.value === 'number' ? cost.value : null,
      context: mission.missionContext || null,
      targetKind: String(mission.target?.$type || '').replace('TIMissionTarget_', '') || null,
      conditions,
      utilityScore: typeof mission.utilityScore === 'number' ? mission.utilityScore : null,
      permanentAssignment: Boolean(mission.permanentAssignment),
      persistentEffect: Boolean(mission.persistentEffect)
    };
  }
  return specs;
}

// Per-hull Mission Control cost, construction tier and base build time,
// read from the installed game templates. Mission Control is the sole input
// to the alien minimum-hate floor, so a flat per-design guess makes any
// "what does this fleet do to my hate" projection wrong. Exposed on the
// snapshot because shared/intelResources.mjs must stay free of runtime
// (fs-backed) imports so the hosted worker can import it too.
function buildShipHullStats() {
  const stats = {};
  for (const hull of templateLoader.templates.shipHulls.values()) {
    const name = hull.dataName;
    if (!name) continue;
    stats[name] = {
      missionControl: hull.missionControl ?? null,
      constructionTier: hull.consTier ?? null,
      baseConstructionTimeDays: hull.baseConstructionTime_days ?? null,
      noseHardpoints: hull.noseHardpoints ?? null,
      hullHardpoints: hull.hullHardpoints ?? null,
      structuralIntegrity: hull.structuralIntegrity ?? null,
      requiredProjectName: hull.requiredProjectName || null
    };
  }
  return stats;
}

// ---------------------------------------------------------------------------
// The unlock index: every template family gated behind a research gate,
// reverse-mapped to the gate that unlocks it.
//
// Sixteen families, and the gate is NOT the same field in all of them:
// fifteen carry `requiredProjectName` (a faction project), while orgs carry
// `requiredTechName` (a global tech). Flattening those two into one "required
// project" key would mis-describe 83 of the 1,223 entries, so the gate kind
// travels with the gate id.
//
// Counts here are load-bearing. They are asserted in tests/unlockIndex.test.js
// against the installed templates, because a family that silently stops being
// read looks exactly like a family with nothing gated in it.
// ---------------------------------------------------------------------------

/**
 * family -> { templateKey, gateField, gateKind }.
 *
 * `templateKey` indexes `templateLoader.templates`. `weaponModules` is one map
 * holding six families, so those rows also carry `templateFamily` to select
 * their own slice of it.
 */
const UNLOCK_FAMILIES = Object.freeze([
  { family: 'drive', templateKey: 'drives', gateField: 'requiredProjectName', gateKind: 'project' },
  { family: 'hab_module', templateKey: 'habModules', gateField: 'requiredProjectName', gateKind: 'project' },
  { family: 'laser_weapon', templateKey: 'weaponModules', templateFamily: 'laser_weapon', gateField: 'requiredProjectName', gateKind: 'project' },
  // The one tech-gated family. `requiredProjectName` is absent from every org.
  { family: 'org', templateKey: 'orgs', gateField: 'requiredTechName', gateKind: 'tech' },
  { family: 'magnetic_gun', templateKey: 'weaponModules', templateFamily: 'magnetic_gun', gateField: 'requiredProjectName', gateKind: 'project' },
  { family: 'power_plant', templateKey: 'reactors', gateField: 'requiredProjectName', gateKind: 'project' },
  { family: 'utility_module', templateKey: 'utilityModules', gateField: 'requiredProjectName', gateKind: 'project' },
  { family: 'missile', templateKey: 'weaponModules', templateFamily: 'missile', gateField: 'requiredProjectName', gateKind: 'project' },
  { family: 'particle_weapon', templateKey: 'weaponModules', templateFamily: 'particle_weapon', gateField: 'requiredProjectName', gateKind: 'project' },
  { family: 'ship_hull', templateKey: 'shipHulls', gateField: 'requiredProjectName', gateKind: 'project' },
  { family: 'plasma_weapon', templateKey: 'weaponModules', templateFamily: 'plasma_weapon', gateField: 'requiredProjectName', gateKind: 'project' },
  { family: 'heat_sink', templateKey: 'heatSinks', gateField: 'requiredProjectName', gateKind: 'project' },
  { family: 'radiator', templateKey: 'radiators', gateField: 'requiredProjectName', gateKind: 'project' },
  { family: 'battery', templateKey: 'batteries', gateField: 'requiredProjectName', gateKind: 'project' },
  { family: 'ship_armor', templateKey: 'shipArmor', gateField: 'requiredProjectName', gateKind: 'project' },
  { family: 'gun', templateKey: 'weaponModules', templateFamily: 'gun', gateField: 'requiredProjectName', gateKind: 'project' }
]);

/** Every template entry belonging to one family row, in template order. */
function familyEntries(spec) {
  const map = templateLoader.templates[spec.templateKey];
  if (!map) return [];
  const all = [...map.values()];
  return spec.templateFamily
    ? all.filter(item => item && item.templateFamily === spec.templateFamily)
    : all;
}

/**
 * Reverse-maps every gated template entry to its gate.
 *
 * Shape:
 *   families  family -> { gateField, gateKind, gated, total, ungated }
 *   gates     gateId -> { kind, unlocks: { family: [{ id, displayName }] } }
 *   totals    { families, gates, gatedEntries }
 *
 * Only the gate direction is stored. The item -> gate direction is rebuilt in
 * `shared/unlockIndex.mjs` at request time, which costs one pass over 1,223
 * entries and saves publishing the same relation twice.
 *
 * An entry whose identity does not resolve is DROPPED with a recorded reason
 * rather than keyed on the string `"undefined"` -- the dedupe-collision failure
 * that cost 302 of 303 mission candidates in server/engine/candidates.
 */
function buildUnlockIndex() {
  const families = {};
  const gates = {};
  const unresolved = [];
  let gatedEntries = 0;

  for (const spec of UNLOCK_FAMILIES) {
    const entries = familyEntries(spec);
    let gated = 0;
    for (const item of entries) {
      const gateId = item?.[spec.gateField];
      if (!gateId || typeof gateId !== 'string') continue;
      const id = item.dataName || item.displayName || item.friendlyName || item.templateName;
      if (!id || typeof id !== 'string') {
        unresolved.push({ family: spec.family, gate: gateId, reason: 'template entry has no resolvable identity' });
        continue;
      }
      gated += 1;
      gatedEntries += 1;
      if (!gates[gateId]) gates[gateId] = { kind: spec.gateKind, unlocks: {} };
      if (!gates[gateId].unlocks[spec.family]) gates[gateId].unlocks[spec.family] = [];
      gates[gateId].unlocks[spec.family].push({
        id,
        displayName: item.friendlyName || item.displayName || id
      });
    }
    families[spec.family] = {
      gateField: spec.gateField,
      gateKind: spec.gateKind,
      gated,
      total: entries.length,
      ungated: entries.length - gated
    };
  }

  return {
    families,
    gates,
    unresolved,
    totals: {
      families: UNLOCK_FAMILIES.length,
      gates: Object.keys(gates).length,
      gatedEntries
    }
  };
}

// ---------------------------------------------------------------------------
// Drive stats.
//
// Only the fields the propulsion model and its caveats need, not the whole
// 541-entry template: the snapshot is published to Supabase and carried by the
// war-room export.
//
// `thrustCap` is the reason this exists as its own payload rather than being
// read back out of `techTree`. The tech tree's per-drive `stats` object omits
// it, and it is the entire difference between cruise and combat acceleration.
// ---------------------------------------------------------------------------
function buildDriveStats() {
  const stats = {};
  for (const drive of templateLoader.templates.drives.values()) {
    const name = drive.dataName;
    if (!name) continue;
    stats[name] = {
      displayName: drive.friendlyName || drive.displayName || name,
      // Absent stays null. A drive with no exhaust velocity is unmeasured, and
      // a delta-V of `0 * ln(ratio)` would render as a confident zero km/s.
      EV_kps: typeof drive.EV_kps === 'number' ? drive.EV_kps : null,
      thrust_N: typeof drive.thrust_N === 'number' ? drive.thrust_N : null,
      thrustCap: typeof drive.thrustCap === 'number' ? drive.thrustCap : null,
      propellant: drive.propellant || null,
      driveClassification: drive.driveClassification || null,
      // Non-zero on 54 of 541 drives. A refit onto one of those changes the
      // ship's dry mass, which the constant-mass what-if does not model, so
      // the figure travels with the drive to let the caller say so.
      flatMass_tons: typeof drive.flatMass_tons === 'number' ? drive.flatMass_tons : null,
      requiredProjectName: drive.requiredProjectName || null,
      // 18 of 541 are disabled in the shipped templates and are not buildable.
      disabled: drive.disable === true
    };
  }
  return stats;
}

/**
 * Utility modules that multiply a drive's effective exhaust velocity.
 *
 * Measured against the live save on 2026-08-21: without this term the delta-V
 * model reproduces the game's own `currentDeltaVKps` for only 4 of the 8
 * factions. Five modules carry `EVMultiplier` in `specialModuleRules`
 * (1.2 / 1.35 / 1.5 / 1.5 / 2.0), and all five also carry
 * `RequiresHydrogenPropellant`, so the multiplier applies only to a drive
 * whose propellant is hydrogen.
 */
function buildPropellantModules() {
  const modules = {};
  for (const module of templateLoader.templates.utilityModules.values()) {
    const rules = Array.isArray(module.specialModuleRules) ? module.specialModuleRules : [];
    if (!rules.includes('EVMultiplier')) continue;
    const name = module.dataName;
    if (!name) continue;
    modules[name] = {
      displayName: module.friendlyName || module.displayName || name,
      evMultiplier: typeof module.specialModuleValue === 'number' ? module.specialModuleValue : null,
      requiresHydrogenPropellant: rules.includes('RequiresHydrogenPropellant'),
      requiredProjectName: module.requiredProjectName || null
    };
  }
  return modules;
}

/**
 * Projects that are not open to every faction, or that carry no research cost.
 *
 * Two gates the tech graph does not model, both of which make a project look
 * reachable when it is not:
 *
 *   factionPrereq   103 projects are restricted to named faction templates
 *                   (`AlienCouncil`, `SubmitCouncil`, ...), matched against
 *                   `faction.templateName`. Without this the alien master
 *                   projects read as prerequisite-clear with a 100% monthly
 *                   roll -- an unreachable target presented as imminent.
 *   researchCost -1 marks a project that is never researched at all. Left
 *                   alone it becomes `max(0, -1 - 0)` = 0 remaining, which
 *                   renders as free.
 *
 * Only the restricted projects are stored. The unrestricted majority need no
 * row, and an absent row means "no restriction" rather than "not checked",
 * which is safe here because the map is always built from a complete pass.
 */
function buildProjectGating() {
  const gating = {};
  for (const project of templateLoader.templates.projects.values()) {
    const dataName = project?.dataName;
    // The projects map is keyed by BOTH dataName and friendlyName, so entries
    // are visited twice; keying on dataName alone keeps one row per project.
    if (!dataName) continue;
    const factionPrereq = Array.isArray(project.factionPrereq) && project.factionPrereq.length > 0
      ? project.factionPrereq.filter(entry => typeof entry === 'string' && entry !== '')
      : null;
    const researchCost = typeof project.researchCost === 'number' ? project.researchCost : null;
    const costIsResearchable = researchCost !== null && researchCost >= 0;
    if (!factionPrereq && costIsResearchable) continue;
    gating[dataName] = {
      factionPrereq,
      // Informational only. This is the per-campaign chance that the project
      // exists for a faction at all, rolled once at campaign start -- whether
      // it landed is not derivable here, and `availableProjectNames` is the
      // authority on that. Reported so a caller can see the odds, never used
      // to decide a state.
      factionAvailableChance: typeof project.factionAvailableChance === 'number' ? project.factionAvailableChance : null,
      researchCost,
      researchable: costIsResearchable
    };
  }
  return gating;
}

module.exports = {
  MISSION_HATE_SLOT,
  UNLOCK_FAMILIES,
  buildTraitStatMods,
  buildMissionSpecs,
  buildShipHullStats,
  buildUnlockIndex,
  buildDriveStats,
  buildPropellantModules,
  buildProjectGating
};
