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

// ---------------------------------------------------------------------------
// Component stats -- phase 2 of the research advisor.
//
// The engineering numbers behind the fourteen non-drive unlock families, baked
// for the same reason `buildDriveStats` is: the hosted worker has no template
// directory, so a model that reads templates at request time works locally and
// breaks the deployed site.
//
// THE FAMILY KEYS ARE THE UNLOCK-INDEX FAMILY KEYS. `componentStats[family][id]`
// and `unlockIndex.gates[gate].unlocks[family][].id` are the same namespace, so
// `shared/unlockIndex.buildItemGateMap` resolves the research gate for anything
// in here. That is why NO component below carries `requiredProjectName`: the
// index already holds the whole relation, and re-emitting it measured 14 KB of
// pure duplication on every published row.
//
// Fields are chosen by what the model in `shared/militaryValue.mjs` reads, not
// by what the template happens to carry. Nothing cosmetic (icon, model, sound,
// effect resources), nothing the model does not use. Measured cost is reported
// in tests/militaryValue.test.js, which fails if the payload grows past its
// stated budget.
//
// Absent stays null throughout, and a null field is dropped rather than
// emitted, so a stat the template omits is ABSENT from the record -- never a
// zero that would rank the item last and hide it.
// ---------------------------------------------------------------------------

/** Finite numbers only. A missing or unparseable stat is absent, never zero. */
const stat = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** Drops null/undefined/false/empty-array fields so absence stays absence. */
function compact(record) {
  const out = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === null || value === undefined || value === false) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out;
}

/**
 * The six weapon template files, keyed by their unlock-index family.
 *
 * `templateLoader` already merges them into one `weaponModules` map and tags
 * each entry with `templateFamily`, which is the only way to tell a magnetic
 * gun from a gun -- both are category `Kinetic`.
 */
const WEAPON_FAMILIES = Object.freeze([
  'laser_weapon', 'magnetic_gun', 'gun', 'particle_weapon', 'plasma_weapon', 'missile'
]);

function buildWeaponStats(family) {
  const out = {};
  for (const weapon of templateLoader.templates.weaponModules.values()) {
    if (weapon.templateFamily !== family) continue;
    const id = weapon.dataName;
    if (!id) continue;
    out[id] = compact({
      displayName: weapon.friendlyName || weapon.displayName || id,
      mount: weapon.mount || null,

      // --- damage inputs -------------------------------------------------
      // Beam weapons state the energy delivered per shot outright.
      shotPowerMJ: stat(weapon.shotPower_MJ),
      // Matter weapons do not; their damage is the projectile's kinetic
      // energy, and three families ship a figure to check that against.
      warheadMassKg: stat(weapon.warheadMass_kg),
      muzzleVelocityKps: stat(weapon.muzzleVelocity_kps),
      // The game's OWN damage number where it exists: `damage_MJ` on guns,
      // `expectedDamage_MJ` on plasma, `flatDamage_MJ` on explosive and
      // nuclear missiles. Carried so the model can be pinned against it
      // rather than merely asserted -- see MILITARY_FORMULAE.kineticDamage.
      statedDamageMJ: stat(weapon.damage_MJ) ?? stat(weapon.expectedDamage_MJ) ?? stat(weapon.flatDamage_MJ),
      statedDamageField: typeof weapon.damage_MJ === 'number'
        ? 'damage_MJ'
        : (typeof weapon.expectedDamage_MJ === 'number'
          ? 'expectedDamage_MJ'
          : (typeof weapon.flatDamage_MJ === 'number' ? 'flatDamage_MJ' : null)),
      // 31 of 57 missiles carry no damage figure at all (Fragmentation and
      // Penetrator warheads). Their class is recorded so the model can say
      // WHY it cannot price them instead of scoring them zero.
      warheadClass: weapon.warheadClass || null,
      missileDeltaVKps: stat(weapon.deltaV_kps),

      // --- rate of fire --------------------------------------------------
      cooldownS: stat(weapon.cooldown_s),
      salvoShots: stat(weapon.salvo_shots),
      intraSalvoCooldownS: stat(weapon.intraSalvoCooldown_s),
      // Rounds carried. Absent on every laser and particle weapon, because
      // beam weapons are power-limited rather than ammunition-limited -- a
      // real distinction, not a missing field, and the model says which.
      // Without it the antimatter torpedo's 22.5 TJ warhead reads as a
      // 3.2 GW sustained output it can hold for 28 seconds.
      magazine: stat(weapon.magazine),

      // --- cost and reach ------------------------------------------------
      massTons: stat(weapon.baseWeaponMass_tons),
      targetingRangeKm: stat(weapon.targetingRange_km),
      crew: stat(weapon.crew),
      efficiency: stat(weapon.efficiency),
      bombardmentValue: stat(weapon.bombardmentValue),

      // --- role ----------------------------------------------------------
      // Structural, not name-matched: a weapon that cannot attack but can
      // defend is point defence. Point defence is a SEPARATE axis, never a
      // weaker attack, so this decides which comparison class an entry
      // joins rather than being folded into one score.
      attackMode: weapon.attackMode === true,
      defenseMode: weapon.defenseMode === true,
      pointDefenseTargetable: weapon.isPointDefenseTargetable === true,

      // --- optics (beam spread is MODELLED and never ranked) --------------
      mirrorRadiusCm: stat(weapon.mirrorRadius_cm),
      wavelengthNm: stat(weapon.wavelength_nm),
      beamQuality: stat(weapon.beam_quality),
      jitterRad: stat(weapon.jitter_Rad),
      lensRadiusCm: stat(weapon.lensRadius_cm),
      emittanceMrad: stat(weapon.emittance_mrad),
      // Stated by the template, so it is reported rather than modelled.
      doublingRangeKm: stat(weapon.doublingRange_km),
      // Particle beams carry their own damage-channel split; everything else
      // is inferred from the family. Used to pick which armour axis the
      // observed threat mix loads.
      xRayFraction: stat(weapon.xRayFraction),
      baryonFraction: stat(weapon.baryonFraction),

      disabled: weapon.disable === true
    });
  }
  return out;
}

function buildHullComponentStats() {
  const out = {};
  for (const hull of templateLoader.templates.shipHulls.values()) {
    const id = hull.dataName;
    if (!id) continue;
    out[id] = compact({
      displayName: hull.friendlyName || hull.displayName || id,
      noseHardpoints: stat(hull.noseHardpoints),
      hullHardpoints: stat(hull.hullHardpoints),
      internalModules: stat(hull.internalModules),
      structuralIntegrity: stat(hull.structuralIntegrity),
      massTons: stat(hull.mass_tons),
      missionControl: stat(hull.missionControl),
      baseConstructionTimeDays: stat(hull.baseConstructionTime_days),
      consTier: stat(hull.consTier),
      maxOfficers: stat(hull.maxOfficers),
      crew: stat(hull.crew),
      monthlyIncomeMoney: stat(hull.monthlyIncome_Money),
      alien: hull.alien === true,
      noShipyardBuild: hull.noShipyardBuild === true
    });
  }
  return out;
}

function buildArmorStats() {
  const out = {};
  for (const armor of templateLoader.templates.shipArmor.values()) {
    const id = armor.dataName;
    if (!id) continue;
    out[id] = compact({
      displayName: armor.friendlyName || armor.displayName || id,
      // Half-value layers: the thickness that halves the incoming flux. The
      // two channels are separate because they are separate threats.
      baryonicHalfValueCm: stat(armor.baryonicHalfValue_cm),
      xRayHalfValueCm: stat(armor.xRayHalfValue_cm),
      densityKgM3: stat(armor.density_kgm3),
      heatOfVaporizationMJkg: stat(armor.heatofVaporization_MJkg),
      // `[name, value]` pairs rather than objects: same information, and the
      // object form cost 40% more on the wire for 12 rows x 3 entries.
      specialties: (Array.isArray(armor.specialties) ? armor.specialties : [])
        .filter(entry => entry && entry.armorSpecialty)
        .map(entry => [entry.armorSpecialty, stat(entry.value)])
    });
  }
  return out;
}

function buildPowerPlantStats() {
  const out = {};
  for (const plant of templateLoader.templates.reactors.values()) {
    const id = plant.dataName;
    if (!id) continue;
    out[id] = compact({
      displayName: plant.friendlyName || plant.displayName || id,
      maxOutputGW: stat(plant.maxOutput_GW),
      // Tonnes per gigawatt. Inverted by the model into GW per tonne so the
      // axis reads "more is better" like every other output axis.
      specificPowerTGW: stat(plant.specificPower_tGW),
      efficiency: stat(plant.efficiency),
      powerPlantClass: plant.powerPlantClass || null,
      crew: stat(plant.crew),
      disabled: plant.disable === true
    });
  }
  return out;
}

function buildRadiatorStats() {
  const out = {};
  for (const radiator of templateLoader.templates.radiators.values()) {
    const id = radiator.dataName;
    if (!id) continue;
    out[id] = compact({
      displayName: radiator.friendlyName || radiator.displayName || id,
      specificPowerKWkg: stat(radiator.specificPower_2s_KWkg),
      specificMassKgM2: stat(radiator.specificMass_2s_kgm2),
      operatingTempK: stat(radiator.operatingTemp_K),
      emissivity: stat(radiator.emissivity),
      // Lower is better; carried so the model can report it as its own axis
      // instead of pretending heat rejection is the only thing that matters.
      vulnerability: stat(radiator.vulnerability),
      radiatorType: radiator.radiatorType || null,
      crew: stat(radiator.crew),
      disabled: radiator.disable === true
    });
  }
  return out;
}

function buildHeatSinkStats() {
  const out = {};
  for (const sink of templateLoader.templates.heatSinks.values()) {
    const id = sink.dataName;
    if (!id) continue;
    out[id] = compact({
      displayName: sink.displayName || sink.friendlyName || id,
      heatCapacityGJ: stat(sink.heatCapacity_GJ),
      massTons: stat(sink.mass_tons),
      crew: stat(sink.crew),
      disabled: sink.disable === true
    });
  }
  return out;
}

function buildBatteryStats() {
  const out = {};
  for (const battery of templateLoader.templates.batteries.values()) {
    const id = battery.dataName;
    if (!id) continue;
    out[id] = compact({
      displayName: battery.friendlyName || battery.displayName || id,
      energyCapacityGJ: stat(battery.energyCapacity_GJ),
      massTons: stat(battery.mass_tons),
      rechargeRateGJs: stat(battery.rechargeRate_GJs),
      hp: stat(battery.hp),
      crew: stat(battery.crew),
      disabled: battery.disable === true
    });
  }
  return out;
}

function buildUtilityModuleStats() {
  const out = {};
  for (const module of templateLoader.templates.utilityModules.values()) {
    const id = module.dataName;
    if (!id) continue;
    // `Empty` is the game's placeholder for an unfilled slot -- ship designs
    // reference it by name where a hardpoint or module bay carries nothing. It
    // is the ABSENCE of a component, and baking it would put "nothing" in the
    // catalogue as an ungated, rule-less utility module a player could
    // ostensibly choose. The utility-module template file is the only one that
    // carries such a row.
    if (id === 'Empty') continue;
    out[id] = compact({
      displayName: module.friendlyName || module.displayName || id,
      massTons: stat(module.mass_tons),
      powerRequirementMW: stat(module.powerRequirement_MW),
      // 45 distinct rules across 58 modules. There is no exchange rate
      // between an EV multiplier and a targeting computer, so the model
      // compares within a rule and refuses to compare across rules.
      specialModuleRules: (Array.isArray(module.specialModuleRules) ? module.specialModuleRules : [])
        .filter(rule => typeof rule === 'string' && rule !== ''),
      specialModuleValue: stat(module.specialModuleValue),
      minConsTier: stat(module.minConsTier),
      crew: stat(module.crew),
      disabled: module.disable === true
    });
  }
  return out;
}

function buildHabModuleStats() {
  const out = {};
  for (const module of templateLoader.templates.habModules.values()) {
    const id = module.dataName;
    if (!id) continue;
    out[id] = compact({
      displayName: module.friendlyName || module.displayName || id,
      tier: stat(module.tier),
      baseMassTons: stat(module.baseMass_tons),
      crew: stat(module.crew),
      power: stat(module.power),
      missionControl: stat(module.missionControl),
      spaceCombatModule: module.spaceCombatModule === true,
      buildTimeDays: stat(module.buildTime_Days),
      habType: module.habType || null,
      specialRules: (Array.isArray(module.specialRules) ? module.specialRules : [])
        .filter(rule => typeof rule === 'string' && rule !== ''),
      specialRulesValue: stat(module.specialRulesValue),
      // Deliberately NOT carried: the eleven `income*_month` fields. Hab
      // module value is overwhelmingly ECONOMIC, and economic valuation is
      // spec section 4 -- a later phase with its own payload. Reporting an
      // income here would be valuing it against nothing.
      disabled: module.disable === true
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The effect index -- phase 3 of the research advisor.
//
// The tech tree already publishes each node's effect ids, with `operation`,
// `value`, `effectTarget` and `strValue` on every one. What it does NOT carry
// is the four fields economic valuation turns on:
//
//   contexts        WHICH live quantity the modifier scales. Without it every
//                   effect is an unlabelled number.
//   stackable       whether a second copy compounds or does nothing.
//   instantEffect   the one-time grant kind.
//   effectDuration  permanent versus instant versus temporary.
//
// So only those are baked, keyed by effect dataName, and the tech tree's
// existing per-node effect list is the join. Re-publishing the project ->
// effect relation a second time would have cost ~40 KB of pure duplication for
// a mapping the snapshot already carries.
//
// ONLY EFFECTS REACHABLE FROM A TECH OR PROJECT ARE BAKED. 444 of the 719
// effect templates are never referenced by either -- they belong to narrative
// events, missions and orgs -- and the research advisor can never be asked
// about one. The reachable 275 cost 42.1 KB of effect rows; all 719 would cost
// 68 KB for a set the endpoint cannot reach. With the grant rows and the census
// the whole payload is 51.1 KB raw / 6.8 KB gzipped -- 2.1% of the 2,480 KB
// published player row, against phase 2's 166.6 KB and phase 1's 135.4 KB
// (measured 2026-08-21). The census below records BOTH the effect-file total
// and the reachable count, so the omission is visible rather than looking like
// a family that quietly stopped loading.
// ---------------------------------------------------------------------------

function buildEffectIndex() {
  const techs = [...templateLoader.templates.techs.values()];
  const projects = [...templateLoader.templates.projects.values()];

  // The projects and techs maps are keyed by BOTH dataName and friendlyName,
  // so entries are visited twice; the `seen` set keeps one pass per template.
  const reachable = new Set();
  const seen = new Set();
  const collectFrom = (templates) => {
    for (const template of templates) {
      const id = template?.dataName;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      for (const effectId of (Array.isArray(template.effects) ? template.effects : [])) {
        if (typeof effectId === 'string' && effectId !== '') reachable.add(effectId);
      }
    }
  };
  collectFrom(techs);
  collectFrom(projects);

  const effects = {};
  const contextCounts = {};
  const instantCounts = {};
  const unresolved = [];
  for (const effectId of reachable) {
    const template = templateLoader.templates.effects.get(effectId);
    if (!template) {
      // A referenced effect with no template is a hole in the data, not an
      // effect that does nothing. It is recorded so the consumer can report
      // `effect-not-indexed` rather than pricing it at zero.
      unresolved.push({ effectId, reason: 'referenced by a tech or project but absent from TIEffectTemplate.json' });
      continue;
    }
    const contexts = (Array.isArray(template.contexts) ? template.contexts : [])
      .filter(context => typeof context === 'string' && context !== '');
    for (const context of contexts) contextCounts[context] = (contextCounts[context] || 0) + 1;
    if (template.instantEffect) {
      instantCounts[template.instantEffect] = (instantCounts[template.instantEffect] || 0) + 1;
    }
    effects[effectId] = compact({
      contexts,
      operation: template.operation || null,
      // Absent stays null. `stat()` refuses a non-number, so an effect with no
      // value is ABSENT from the record rather than carrying a zero that would
      // price as "changes nothing" when it is really "unknown".
      value: stat(template.value),
      // Only `true` is emitted; `compact` drops false. The consumer reads a
      // missing key as not-stackable, which matches the 65 reachable effects
      // that state no `stackable` field at all and are all instant grants.
      stackable: template.stackable === true,
      instantEffect: template.instantEffect || null,
      effectTarget: template.effectTarget || null,
      // `permanent` is the majority; emitting it on 209 rows costs more than
      // the two exceptions are worth, so only the exceptions are carried.
      effectDuration: template.effectDuration === 'permanent' ? null : (template.effectDuration || null),
      durationMonths: typeof template.duration_months === 'number' && template.duration_months > 0
        ? template.duration_months
        : null,
      // Names the region, attribute or trait an instant grant targets.
      strValue: typeof template.strValue === 'string' && template.strValue !== '' ? template.strValue : null
    });
  }

  // `resourcesGranted` and `orgGranted` are project fields, not effects, and
  // the tech tree does not carry either. 57 projects grant resources and 19
  // grant an org, so only those rows exist -- an absent row means the project
  // grants nothing, which is safe because the pass below is complete.
  const grants = {};
  const grantSeen = new Set();
  for (const project of projects) {
    const id = project?.dataName;
    if (!id || grantSeen.has(id)) continue;
    grantSeen.add(id);
    const resources = (Array.isArray(project.resourcesGranted) ? project.resourcesGranted : [])
      .filter(entry => entry && typeof entry.resource === 'string' && typeof entry.value === 'number')
      // `[resource, value]` pairs rather than objects, the same choice
      // `buildArmorStats` makes for armour specialties and for the same reason.
      .map(entry => [entry.resource, entry.value]);
    const org = typeof project.orgGranted === 'string' && project.orgGranted !== '' ? project.orgGranted : null;
    if (resources.length === 0 && !org) continue;
    grants[id] = compact({ resources, org });
  }

  return {
    effects,
    grants,
    unresolved,
    census: {
      // Both numbers, deliberately: `indexed` alone reads like the whole file.
      effectTemplatesTotal: templateLoader.templates.effects.size,
      reachableFromResearch: reachable.size,
      indexed: Object.keys(effects).length,
      distinctContexts: Object.keys(contextCounts).length,
      distinctInstantEffects: Object.keys(instantCounts).length,
      contextCounts,
      instantEffectCounts: instantCounts,
      projectsGrantingResources: Object.values(grants).filter(row => Array.isArray(row.resources)).length,
      projectsGrantingOrgs: Object.values(grants).filter(row => row.org).length,
      basis: 'effects referenced by at least one TITechTemplate or TIProjectTemplate `effects` array. Effects reachable only from narrative events, missions or orgs are deliberately omitted; the research advisor cannot be asked about one.'
    }
  };
}

/**
 * `family -> id -> stats` for the fourteen non-drive, non-org unlock families.
 *
 * Drives are already covered by `buildDriveStats` (phase 1) and orgs are
 * tech-gated council equipment rather than ship or hab hardware, so neither
 * appears here. The remaining fourteen keys match `UNLOCK_FAMILIES` exactly,
 * which `tests/militaryValue.test.js` asserts rather than assumes.
 */
function buildComponentStats() {
  const stats = {};
  for (const family of WEAPON_FAMILIES) stats[family] = buildWeaponStats(family);
  stats.ship_hull = buildHullComponentStats();
  stats.ship_armor = buildArmorStats();
  stats.power_plant = buildPowerPlantStats();
  stats.radiator = buildRadiatorStats();
  stats.heat_sink = buildHeatSinkStats();
  stats.battery = buildBatteryStats();
  stats.utility_module = buildUtilityModuleStats();
  stats.hab_module = buildHabModuleStats();
  return stats;
}

module.exports = {
  MISSION_HATE_SLOT,
  UNLOCK_FAMILIES,
  WEAPON_FAMILIES,
  buildTraitStatMods,
  buildMissionSpecs,
  buildShipHullStats,
  buildUnlockIndex,
  buildDriveStats,
  buildPropellantModules,
  buildProjectGating,
  buildComponentStats,
  buildEffectIndex
};
