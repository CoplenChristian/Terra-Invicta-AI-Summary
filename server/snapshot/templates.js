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

module.exports = {
  MISSION_HATE_SLOT,
  buildTraitStatMods,
  buildMissionSpecs,
  buildShipHullStats
};
