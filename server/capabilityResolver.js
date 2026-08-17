const templateLoader = require('./templateLoader');

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

    // Direct effect-based checks
    const canDetectAlienAbductions = activeEffects.has('Effect_DetectAbductions') || finishedProjects.has('Project_TheirSignatures');
    const canDetectAlienHumanContacts = activeEffects.has('Effect_DetectEnthralls') || finishedProjects.has('Project_TheirMethods');
    const canDetectAlienOperations = activeEffects.has('Effect_DetectAllOperations') || finishedProjects.has('Project_TheirOperations');
    const canEstimateAlienThreat = activeEffects.has('Effect_UpdateAlienThreatMeter') || finishedProjects.has('Project_TheirOperations');
    const canDirectlyDetectAlienCouncilors = activeEffects.has('Effect_DetectAlienMovements') || finishedProjects.has('Project_TheirMovements');
    const canTrackInnerSpaceAssets = activeEffects.has('Effect_Skywatch') || finishedTechs.has('Skywatch');
    const canTrackSolarSystemSpaceAssets = activeEffects.has('Effect_DeepSkywatch') || finishedTechs.has('DeepSystemSkywatch');
    const milestones = new Set(storyState.milestones || []);
    const objectiveNames = storyState.objectiveNames || {};
    const xenoformingRule = templateLoader.config.intelligenceRules?.xenoforming || {};
    const facilityRule = templateLoader.config.intelligenceRules?.alienFacilities || {};
    const canDetectXenoforming = milestones.has(xenoformingRule.requiresMilestone || 'DetectXenoforming') ||
      objectiveNames.DetectXenoforming === 'Completed';
    const canDetectAlienFacilities = (storyState.knownAlienSiteRegionIds || []).length > 0 ||
      (storyState.intel || []).some(entry => entry.typeName?.includes('TIRegionAlienFacilityState'));

    const capabilities = {
      // Alien ground intelligence
      canDetectAlienAbductions,
      canDetectAlienHumanContacts,
      canDetectAlienOperations,
      canEstimateAlienThreat,
      canDirectlyDetectAlienCouncilors,

      // Human councilors & operations
      canDetectHumanCouncilors: true,
      canInvestigateHumanCouncilors: true,
      canIdentifyHumanMissions: true, // when investigated or turned

      // Facilities and xenoforming are both discovery-gated at the region/entity
      // level. These booleans describe whether the observer has the prerequisite
      // story/intel state; the filter still checks each saved entity.
      canDetectAlienFacilities,
      canDetectXenoforming,
      xenoformingAutomaticVisibilityThreshold: xenoformingRule.automaticVisibilityThreshold ?? 65,
      facilityRequiresRegionDiscovery: facilityRule.requiresRegionDiscovery !== false,
      xenoformingRequiresRegionDiscovery: xenoformingRule.requiresRegionDiscovery !== false,

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

      // UI explanation helper map
      details: {
        detectAlienAbductions: {
          name: "Alien Abduction Detection",
          active: canDetectAlienAbductions,
          requiredProject: "Project_TheirSignatures",
          requiredDisplayName: "Alien Signatures",
          requiredEffect: "Effect_DetectAbductions",
          description: "Allows detection of alien abductions in surveyed regions."
        },
        detectAlienHumanContacts: {
          name: "Alien Contact & Enthrall Detection",
          active: canDetectAlienHumanContacts,
          requiredProject: "Project_TheirMethods",
          requiredDisplayName: "Alien Methods",
          requiredEffect: "Effect_DetectEnthralls",
          description: "Allows detection of alien contact and enthrall activities with human factions."
        },
        detectAlienOperations: {
          name: "Alien Operations Detection",
          active: canDetectAlienOperations,
          requiredProject: "Project_TheirOperations",
          requiredDisplayName: "Alien Operations",
          requiredEffect: "Effect_DetectAllOperations",
          description: "Allows tracking of broader alien operational activities across the globe."
        },
        estimateAlienThreat: {
          name: "Alien Threat Assessment Meter",
          active: canEstimateAlienThreat,
          requiredProject: "Project_TheirOperations",
          requiredDisplayName: "Alien Operations",
          requiredEffect: "Effect_UpdateAlienThreatMeter",
          description: "Estimates alien hostility and hate levels toward human factions."
        },
        detectAlienCouncilors: {
          name: "Direct Alien Operative Detection",
          active: canDirectlyDetectAlienCouncilors,
          requiredProject: "Project_TheirMovements",
          requiredDisplayName: "Alien Movements",
          requiredEffect: "Effect_DetectAlienMovements",
          description: "Directly detects and tracks individual alien operatives (Hydras) operating on Earth."
        },
        trackInnerSpaceAssets: {
          name: "Inner System Space Surveillance",
          active: canTrackInnerSpaceAssets,
          requiredTech: "Skywatch",
          requiredDisplayName: "Skywatch",
          requiredEffect: "Effect_Skywatch",
          description: templateLoader.config.intelligenceRules?.spaceAssets?.innerSystemDescription || "Detects and tracks vessels and structures inside Saturn's orbit."
        },
        trackSolarSystemSpaceAssets: {
          name: "Deep Solar System Surveillance",
          active: canTrackSolarSystemSpaceAssets,
          requiredTech: "DeepSystemSkywatch",
          requiredDisplayName: "Deep System Skywatch",
          requiredEffect: "Effect_DeepSkywatch",
          description: templateLoader.config.intelligenceRules?.spaceAssets?.deepSystemDescription || "Detects and tracks vessels and structures across the entire Solar System."
        },
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
    return {
      canDetectAlienAbductions: false,
      canDetectAlienHumanContacts: false,
      canDetectAlienOperations: false,
      canEstimateAlienThreat: false,
      canDirectlyDetectAlienCouncilors: false,
      canDetectHumanCouncilors: true,
      canInvestigateHumanCouncilors: true,
      canIdentifyHumanMissions: true,
      canDetectAlienFacilities: false,
      canDetectXenoforming: false,
      xenoformingAutomaticVisibilityThreshold: 65,
      facilityRequiresRegionDiscovery: true,
      xenoformingRequiresRegionDiscovery: true,
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
