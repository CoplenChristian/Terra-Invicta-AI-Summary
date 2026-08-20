const templateLoader = require('./templateLoader');

/**
 * The output key a capability descriptor writes to.
 *
 * Written out three times before -- twice in resolveCapabilities and once in
 * getDefaultCapabilities -- and the copies had already diverged: two used
 * `descriptor.capability[0]`, which throws on a descriptor with no
 * `capability`, and one used the optional-chained form. This is the defensive
 * form; for every descriptor in the shipped config the three produced the same
 * key, so the only difference is that a malformed config now yields a junk key
 * instead of a TypeError.
 */
const capabilityOutputKey = (descriptor) => descriptor?.outputKey ||
  `can${descriptor?.capability?.[0]?.toUpperCase() || ''}${descriptor?.capability?.slice(1) || ''}`;

/**
 * Intelligence a faction always has about other humans. Constant true in both
 * the resolved and the default capability sets; listed once so the two cannot
 * disagree about what "no capabilities at all" still includes.
 */
const ALWAYS_AVAILABLE_HUMAN_CAPABILITIES = Object.freeze({
  canDetectHumanCouncilors: true,
  canInvestigateHumanCouncilors: true,
  canIdentifyHumanMissions: true // when investigated or turned
});

/**
 * Discovery-gating rules, read from config identically in both capability
 * sets. Emitted as a group so the three keys keep their existing order.
 */
const discoveryRuleFields = (xenoformingRule, facilityRule) => ({
  xenoformingAutomaticVisibilityThreshold: xenoformingRule.automaticVisibilityThreshold ?? 65,
  facilityRequiresRegionDiscovery: facilityRule.requiresRegionDiscovery !== false,
  xenoformingRequiresRegionDiscovery: xenoformingRule.requiresRegionDiscovery !== false
});

class CapabilityResolver {
  constructor() {
    templateLoader.load();
  }

  resolveCapabilities(observerFaction, globalResearchState, storyState = {}) {
    if (!observerFaction) {
      return this.getDefaultCapabilities();
    }

    const finishedProjects = new Set(observerFaction.completedProjects || observerFaction.finishedProjectNames || []);
    const finishedTechs = new Set(globalResearchState?.finishedTechsNames || observerFaction.finishedTechs || []);

    const activeEffects = new Set();

    for (const projId of finishedProjects) {
      const effects = templateLoader.getProjectEffects(projId);
      for (const eff of effects) {
        activeEffects.add(eff);
      }
    }

    for (const techId of finishedTechs) {
      const effects = templateLoader.getTechEffects(techId);
      for (const eff of effects) {
        activeEffects.add(eff);
      }
    }

    // Capability grants are data-driven. The configuration maps each effect to
    // a capability and its fallback project/tech; adding a new grant no longer
    // requires editing this resolver's decision logic.
    const configuredCapabilities = {};
    for (const [effectId, descriptor] of Object.entries(templateLoader.config.analysis?.effects || {})) {
      const enabled = activeEffects.has(effectId) ||
        (descriptor.defaultProject && finishedProjects.has(descriptor.defaultProject)) ||
        (descriptor.defaultTech && finishedTechs.has(descriptor.defaultTech));
      const outputKey = capabilityOutputKey(descriptor);
      configuredCapabilities[outputKey] = Boolean(configuredCapabilities[outputKey] || enabled);
    }
    const canDetectAlienAbductions = configuredCapabilities.canDetectAlienAbductions === true;
    const canDetectAlienHumanContacts = configuredCapabilities.canDetectAlienHumanContacts === true;
    const canDetectAlienOperations = configuredCapabilities.canDetectAlienOperations === true;
    const canEstimateAlienThreat = configuredCapabilities.canEstimateAlienThreat === true;
    const canDirectlyDetectAlienCouncilors = configuredCapabilities.canDirectlyDetectAlienCouncilors === true;
    const canTrackInnerSpaceAssets = configuredCapabilities.canTrackInnerSpaceAssets === true;
    const canTrackSolarSystemSpaceAssets = configuredCapabilities.canTrackSolarSystemSpaceAssets === true;
    const milestones = new Set(storyState.milestones || []);
    const objectiveNames = storyState.objectiveNames || {};
    const objectiveAvailable = (name) => {
      const status = objectiveNames[name];
      if (status === true) return true;
      return typeof status === 'string' && ['unlocked', 'completed'].includes(status.trim().toLowerCase());
    };
    const canDetainAlienCouncilors = configuredCapabilities.canDetainAlienCouncilors === true ||
      milestones.has('AccessLiveHydra') ||
      objectiveAvailable('CaptureAHydra');
    const xenoformingRule = templateLoader.config.analysis?.rules?.xenoforming || {};
    const facilityRule = templateLoader.config.analysis?.rules?.alienFacilities || {};
    const canDetectXenoforming = milestones.has(xenoformingRule.requiresMilestone || 'DetectXenoforming') ||
      objectiveNames.DetectXenoforming === 'Completed';
    const canDetectAlienFacilities = (storyState.knownAlienSiteRegionIds || []).length > 0 ||
      (storyState.intel || []).some(entry => entry.typeName?.includes('TIRegionAlienFacilityState'));

    const projectById = new Map(
      (templateLoader.config.analysis?.strategicProjects || []).map(project => [project.id, project])
    );
    const details = {};
    for (const [effectId, descriptor] of Object.entries(templateLoader.config.analysis?.effects || {})) {
      const outputKey = capabilityOutputKey(descriptor);
      const project = descriptor.defaultProject ? projectById.get(descriptor.defaultProject) : null;
      details[descriptor.capability] = {
        name: descriptor.name || project?.name || descriptor.defaultTech || descriptor.capability,
        active: configuredCapabilities[outputKey] === true,
        requiredProject: descriptor.defaultProject || undefined,
        requiredTech: descriptor.defaultTech || undefined,
        requiredDisplayName: project?.name || descriptor.defaultTech || descriptor.defaultProject || null,
        requiredEffect: effectId,
        description: descriptor.description
      };
    }

    const capabilities = {
      // Preserve every configured output key, including capabilities added by
      // a campaign config that this resolver did not know when it was written.
      // The built-in aliases below remain for backwards-compatible consumers.
      ...configuredCapabilities,
      // Alien ground intelligence
      canDetectAlienAbductions,
      canDetectAlienHumanContacts,
      canDetectAlienOperations,
      canEstimateAlienThreat,
      canDirectlyDetectAlienCouncilors,
      canDetainAlienCouncilors,

      // Human councilors & operations
      ...ALWAYS_AVAILABLE_HUMAN_CAPABILITIES,

      // Facilities and xenoforming are both discovery-gated at the region/entity
      // level. These booleans describe whether the observer has the prerequisite
      // story/intel state; the filter still checks each saved entity.
      canDetectAlienFacilities,
      canDetectXenoforming,
      ...discoveryRuleFields(xenoformingRule, facilityRule),

      // Space intelligence
      canTrackInnerSpaceAssets,
      canTrackSolarSystemSpaceAssets,
      canInspectEnemyHabs: canTrackInnerSpaceAssets,
      canInspectEnemyFleets: canTrackInnerSpaceAssets,

      // Meta / Active effects summary
      activeEffects: Array.from(activeEffects),
      finishedProjectsCount: finishedProjects.size,
      finishedTechsCount: finishedTechs.size,
      storyMilestones: Array.from(milestones),

      // UI explanation helper map. Effect/project unlock metadata is generated
      // from the same configuration that drives the capability flags.
      details: {
        ...details,
        detectAlienFacilities: {
          name: 'Alien Facility Discovery',
          active: canDetectAlienFacilities,
          description: 'Alien facilities are visible only after regional discovery, such as Surveil Location or shared intelligence.'
        },
        detectXenoforming: {
          name: 'Xenoforming Discovery',
          active: canDetectXenoforming,
          description: 'Xenoforming requires the Detect Xenoforming milestone and regional discovery, unless the automatic growth threshold is reached.'
        }
      }
    };

    return capabilities;
  }

  getDefaultCapabilities() {
    const rules = templateLoader.config.analysis?.rules || {};
    const xenoformingRule = rules.xenoforming || {};
    const facilityRule = rules.alienFacilities || {};
    const configuredDefaults = Object.fromEntries(
      Object.values(templateLoader.config.analysis?.effects || {})
        .map(descriptor => [capabilityOutputKey(descriptor), false])
    );
    return {
      ...configuredDefaults,
      canDetectAlienAbductions: false,
      canDetectAlienHumanContacts: false,
      canDetectAlienOperations: false,
      canEstimateAlienThreat: false,
      canDirectlyDetectAlienCouncilors: false,
      canDetainAlienCouncilors: false,
      ...ALWAYS_AVAILABLE_HUMAN_CAPABILITIES,
      canDetectAlienFacilities: false,
      canDetectXenoforming: false,
      ...discoveryRuleFields(xenoformingRule, facilityRule),
      canTrackInnerSpaceAssets: false,
      canTrackSolarSystemSpaceAssets: false,
      canInspectEnemyHabs: false,
      canInspectEnemyFleets: false,
      activeEffects: [],
      finishedProjectsCount: 0,
      finishedTechsCount: 0,
      details: {}
    };
  }
}

module.exports = new CapabilityResolver();
