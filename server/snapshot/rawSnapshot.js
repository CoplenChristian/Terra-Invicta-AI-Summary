// server/snapshot/rawSnapshot.js
//
// Purpose: the orchestration pass — read the save's collections once, build the
//   shared id maps, run each domain reducer in dependency order.
//
// The orchestration pass: read the save's collections once, build the shared
// id maps, then run each domain reducer in dependency order and assemble the
// raw snapshot every other server module consumes.
//
// The reducers are ordered by what they need, not by importance:
//   control points -> nations       (a nation's output is split per point)
//   habs           -> hab modules   (a module is located through its hab)
//   hab modules    -> shipyards     (a queue hangs off a shipyard module)
//   everything     -> factions      (the faction roll-up counts all of it)
//   factions       -> tech tree     (the graph carries a per-faction overlay)

const templateLoader = require('../templateLoader');
const {
  CAMPAIGN_SETTINGS_UNAVAILABLE,
  describeCampaignDifficulty
} = require('../../shared/campaignSettings.mjs');
const { buildResearchCostScaling } = require('../../shared/researchCostScaling.mjs');
const lookups = require('./lookups');
const space = require('./space');
const { firstNumericOrNull } = require('./numbers');
const { buildNations } = require('./nations');
const { buildCouncilors } = require('./councilors');
const { buildGlobalResearchSlots, buildTechTree } = require('./research');
const factionsModule = require('./factions');
const {
  buildTraitStatMods,
  buildMissionSpecs,
  buildShipHullStats,
  buildUnlockIndex,
  buildDriveStats,
  buildPropellantModules,
  buildProjectGating,
  buildComponentStats,
  buildEffectIndex,
  buildTechBonusCatalogue
} = require('./templates');

// The last-resort start year, used only when the save carries neither
// `TITimeState.daysInCampaign` nor `TIGlobalResearchState.campaignStartYear`.
//
// It is the `ModernDayStart` scenario's start year, and it was the only value
// available while the code looked for `campaignStartYear` on TIMetadataState,
// which never carries it. Measured 2026-08-21 across 14 saves: the older
// `ModernDayStart` campaigns do start in 2022, so the assumption was right for
// them -- and wrong by four years for this campaign's `2026Start` scenario.
// Every consumer is still told which route produced its figure via
// `metadata.campaignStartYearSource` and the resolver in
// shared/campaignElapsed.mjs.
const ASSUMED_CAMPAIGN_START_YEAR = 2022;

function buildRawSnapshot(saveData) {
  const gamestates = saveData.gamestates || {};
  const raw = lookups.readRawCollections(gamestates);
  const {
    meta,
    rawFactions, rawNations, rawControlPoints, rawCouncilors, rawHabs, rawHabModules,
    rawHabSites, rawFleets, rawAlienFacilities, rawXenoforming, rawGlobalResearch,
    rawGlobalValues, rawEffects
  } = raw;

  const factionIntelligence = factionsModule.buildFactionIntelligence(rawFactions);

  // ID Maps
  const maps = lookups.buildIdMaps(raw, {
    registerShipModuleRefs: space.registerShipModuleRefs
  });
  const {
    factionsById, habsById, bodiesById, habSectorsById, habModulesById,
    habModuleLocationById, fleetsById, bodyDistanceAUById, saturnOrbitDistanceAU,
    orbitsById, regionsById, orgsById, missionsById, shipsById, shipModuleRefs
  } = maps;

  const { controlPointsById, controlPointsByNationId } =
    lookups.buildControlPoints(rawControlPoints, factionsById);

  // Process Nations
  const nations = buildNations(rawNations, { controlPointsByNationId, factionsById });

  // Process Councilors
  // Built once for the whole roster rather than per councilor.
  const traitStatMods = buildTraitStatMods();
  const councilors = buildCouncilors(rawCouncilors, {
    factionsById, regionsById, habsById, orgsById, missionsById, traitStatMods
  });

  // Process Space Fleets
  const fleets = space.buildFleets(rawFleets, {
    factionsById, shipsById, shipModuleRefs, fleetsById, habsById, bodiesById,
    orbitsById, bodyDistanceAUById, saturnOrbitDistanceAU
  });

  // Process Habs
  const habs = space.buildHabs(rawHabs, {
    factionsById, bodiesById, orbitsById, bodyDistanceAUById, saturnOrbitDistanceAU
  });

  // Process Hab Sites & Mining Deposits
  const habSites = space.buildHabSites(rawHabSites, {
    rawHabs, factionsById, bodiesById, habSectorsById, habModulesById,
    gameTimeString: saveData.gameTimeString
  });

  // Process hab module detail and shipyard queues.
  const { habModules, shipyardCountByFaction, habModuleRowsById, habResearchByFaction } =
    space.buildHabModules(rawHabModules, {
      habs, habModuleLocationById, factionsById, gameTimeString: saveData.gameTimeString
    });

  const shipyardQueues = space.buildShipyardQueues(rawFactions, { habModuleRowsById, factionsById });
  const resourceTransfers = space.buildResourceTransfers(rawFactions, { factionsById });
  const shipyardStations = space.buildShipyardStations(habModules, shipyardQueues);

  // The campaign settings, read BEFORE research because the research-cost
  // scaler derives from them and every research cost on this snapshot is on
  // the effective basis it decides. saveParser bakes the block; a hand-built
  // saveData that predates the field falls back to the explicit unavailable
  // block rather than to an invented default.
  const campaignSettings = saveData.campaignSettings || CAMPAIGN_SETTINGS_UNAVAILABLE;
  // `researchSpeedMultiplier` acts on the effective research COST, measured
  // 2026-08-22 -- see shared/researchCostScaling.mjs for the three independent
  // lines of evidence and for what it overturns in docs/campaign-settings-spec.md.
  // It is NOT applied to the research income anywhere.
  const researchCostScaling = buildResearchCostScaling(campaignSettings);

  // Process Global Research
  const globalResearchObj = rawGlobalResearch[0] || {};
  const finishedTechsNames = Array.isArray(globalResearchObj.finishedTechsNames) ? globalResearchObj.finishedTechsNames : [];
  const techProgress = Array.isArray(globalResearchObj.techProgress) ? globalResearchObj.techProgress : [];
  const activeGlobalSlots = buildGlobalResearchSlots(techProgress, { factionsById, researchCostScaling });

  // Process Factions Summary & Power Scores
  const analysisConfig = templateLoader.config.analysis || {};
  const scoreWeights = analysisConfig.powerScore?.weights || {};
  const scoreNormalizers = analysisConfig.powerScore?.normalizers || {};

  const factionRelationships = factionsModule.buildFactionRelationships(rawFactions);

  // The game's own per-faction `ControlPointMaintenance` effect lists, indexed
  // by faction id. Authoritative for the cap contribution of completed work --
  // see the note in lookups.readRawCollections.
  const controlPointMaintenanceEffectsByFaction =
    factionsModule.buildControlPointMaintenanceEffects(rawEffects);

  // The additive half of the faction-wide mine-output bonus, read from the same
  // effect state. It cannot come from a completed-project sweep: no project
  // grants `Effect_SpaceMiningBonus5`, two narrative events do.
  const spaceMiningBonusEffectsByFaction =
    factionsModule.buildSpaceMiningBonusEffects(rawEffects);

  // The multiplicative `ShipConstructionTime` effects, read from the same
  // effect state. The research half of the ship-build-time multiplier in
  // shared/shipBuildTime.mjs; it cannot come from a completed-project sweep
  // either -- the Resistance holds `Effect_ShipConstructionTimeReduction5`
  // from a narrative event, and a sweep would score it 1.25% short.
  const shipConstructionTimeEffectsByFaction =
    factionsModule.buildShipConstructionTimeEffects(rawEffects);

  const factions = factionsModule.buildFactions(rawFactions, {
    councilors, habs, fleets, nations, controlPointsById, shipyardCountByFaction,
    shipyardQueues, habResearchByFaction, scoreWeights, scoreNormalizers,
    controlPointMaintenanceEffectsByFaction,
    spaceMiningBonusEffectsByFaction,
    shipConstructionTimeEffectsByFaction,
    gameTimeString: saveData.gameTimeString, researchCostScaling
  });

  const allShipDesigns = factionsModule.collectShipDesigns(rawFactions);

  // Active Xenoforming and Alien Facilities
  const activeXenoforming = factionsModule.buildActiveXenoforming(rawXenoforming, { regionsById });
  const builtAlienFacilities = factionsModule.buildAlienFacilities(rawAlienFacilities, { regionsById });

  const { servantTargets, priorityTargetFaction } =
    factionsModule.buildDefaultTargets(factions, nations, controlPointsByNationId);

  const keyProjects = (analysisConfig.strategicProjects || []).map(project => project.id);
  const techMatrix = factionsModule.buildTechMatrix(keyProjects, { factions, rawFactions });


  // `TIGlobalValuesState.controlPointMaintenanceFreebies` -- THE WHOLE base
  // control-point cap, and the only place the game stores it.
  //
  // CORRECTION 2026-08-22: this used to be described as "half" of the base,
  // with `campaignSettings.controlPointMaintenanceFreebieBonus` supplying the
  // other half. It does not. `TIFactionState::GetControlPointMaintenanceFreebieCap`
  // (Assembly-CSharp.dll 1.0.51, IL read 2026-08-22) reads
  // `GlobalValues.controlPointMaintenanceFreebies` and adds ONLY
  // `scenarioCustomizations.controlPointMaintenanceFreebieBonusAI`, and only for
  // factions the human is not playing. The freebie BONUS is the Customize
  // Campaign knob that produced this stored value; adding it again double-counts
  // it. On this campaign that error was 150 points on a cap of 841.
  //
  // Absent stays null. A base cap read as 0 would render every faction as
  // hundreds of control points over their cap; read as "no limit" it would
  // render the constraint away entirely. Both are worse than unknown, so
  // shared/controlPointCap.mjs refuses to compose a cap without it.
  const rawGlobalValuesRow = rawGlobalValues[0] || {};
  const controlPointMaintenanceFreebies = firstNumericOrNull(
    rawGlobalValuesRow.controlPointMaintenanceFreebies
  );
  // `TIGlobalValuesState.scenarioCustomizations.shipConstructionSpeed{Player,
  // HumanAI,Alien}` -- the campaign's ship-construction speed setting, and the
  // CAMPAIGN-GLOBAL half of the faction build-time multiplier in
  // shared/shipBuildTime.mjs. The game picks one of the three by whether the
  // building faction is the active player, the aliens, or a human AI, so all
  // three are carried and the module resolves the bucket.
  //
  // The setting lives in the SAVE, not in `TIMetadataState`: it is absent from
  // the custom-difficulty block `shared/campaignSettings.mjs` parses, which is
  // why it is carried here beside that block rather than inside its `settings`
  // map. On the live save all three read 2.
  //
  // Absent stays null throughout. `1 / undefined` is NaN and `1 / 0` is
  // Infinity, so an unread bucket must reach the module as null and make it
  // refuse or calibrate, never compute.
  const rawScenarioCustomizations = rawGlobalValuesRow.scenarioCustomizations || {};
  const shipConstructionSpeed = {
    Player: firstNumericOrNull(rawScenarioCustomizations.shipConstructionSpeedPlayer),
    HumanAI: firstNumericOrNull(rawScenarioCustomizations.shipConstructionSpeedHumanAI),
    Alien: firstNumericOrNull(rawScenarioCustomizations.shipConstructionSpeedAlien)
  };
  // The campaign-settings block the rest of the snapshot reads, extended with
  // the save-side ship-construction speed reading. Frozen like the base block
  // so no reducer can move a number the module treats as a reading.
  const campaignSettingsWithShipSpeed = Object.freeze({
    ...campaignSettings,
    shipConstructionSpeed: Object.freeze(shipConstructionSpeed)
  });
  // `TIGlobalValuesState.fixedPCGDPToRaiseBaseCPMaintenanceCostBy1` -- the GDP
  // normalizer inside the control-point cost formula.
  //
  // `TINationState::get_ControlPointMaintenanceCost` (IL read 2026-08-22) is
  //   Pow(GDP / PCGDPToRaiseBaseCPMaintenanceCostBy1, controlPointCostScaling)
  //     / (controlPointMaintenanceDivisor * numControlPoints)
  //     * Time.template.CPMaintenanceModifier
  // and `get_pcgdpToRaiseBaseCPMaintenanceCostBy1` returns a flat 1e9 when the
  // start-time template's `scaleCPMaintenanceWithStartingGDP` is false, and
  // otherwise lazily freezes `globalGDP_CampaignStart * 6.26e-6` for the whole
  // campaign. This campaign stores 994,239,000, so "GDP in billions" -- which is
  // what the wiki says and what this repo used -- is 0.58% off inside the base
  // and 0.35% off in the result.
  //
  // Absent stays null and the cost is reported as unnormalized rather than
  // silently assuming 1e9: an old snapshot and a non-scaling campaign are
  // indistinguishable from here, and only the second justifies the default.
  const controlPointCostGdpNormalizer = firstNumericOrNull(
    rawGlobalValuesRow.fixedPCGDPToRaiseBaseCPMaintenanceCostBy1
  );

  return {
    miningScarcityWeights: analysisConfig.miningScarcityWeights,
    // The campaign-settings block, at the top level as well as under
    // `metadata`, because shared/shipBuildTime.mjs reads `snapshot.campaignSettings`
    // first and falls back to `snapshot.metadata.campaignSettings`. Both point
    // at the same frozen block, so they cannot disagree.
    campaignSettings: campaignSettingsWithShipSpeed,
    metadata: {
      fileName: saveData.fileName,
      fileSizeBytes: saveData.fileSizeBytes,
      lastModified: saveData.lastModified,
      gameTimeString: saveData.gameTimeString,
      // Null when the save's TIMetadataState omits the field. Difficulty
      // selects the alien minimum-hate floor multiplier, so a silent
      // 'Normal' default was a wrong answer presented as a measured one.
      difficulty: saveData.difficulty ?? null,
      // Derived from the value actually being published, so the flag cannot
      // disagree with the field it describes.
      difficultyAvailable: typeof saveData.difficulty === 'string' && saveData.difficulty.trim() !== '',
      // The custom-difficulty block, carried alongside the label rather than
      // replacing it: `difficulty` still selects the alien minimum-hate floor
      // multiplier and must stay exactly the word the save wrote.
      //
      // A save parsed before this field existed -- a committed fixture, a
      // hand-built test snapshot -- reports `available: false` and every
      // consumer falls back to the bare label, so behaviour with the settings
      // absent is unchanged.
      //
      // This is the block extended with `shipConstructionSpeed` from
      // `TIGlobalValuesState.scenarioCustomizations` (see the reading above) --
      // the campaign-global half of the ship-build-time multiplier. A stale
      // snapshot predating the field simply lacks it, and shared/shipBuildTime.mjs
      // then degrades to its calibration path unchanged.
      campaignSettings: campaignSettingsWithShipSpeed,
      // `TIMetadataState.playerFactionName` -- which faction the human is
      // playing. Load-bearing for the control-point cap, because the campaign
      // options set a control-point capacity bonus for every faction AND a
      // separate one that only AI factions receive. Without knowing which
      // faction is the human's, the AI-only term cannot be applied to the right
      // factions, so shared/controlPointCap.mjs leaves it out and says so
      // rather than applying it to everyone or to no one.
      //
      // Absent stays null; an empty string is not a faction name.
      playerFactionName: typeof meta?.playerFactionName === 'string' && meta.playerFactionName.trim() !== ''
        ? meta.playerFactionName.trim()
        : null,
      // See the note where this is read: the WHOLE base control-point cap, and
      // null when the save does not carry it.
      controlPointMaintenanceFreebies,
      // See the note where this is read: the GDP normalizer inside the
      // control-point cost formula, frozen at campaign start. Null when the
      // save does not carry it, which makes the cost unnormalized rather than
      // wrong-by-default.
      controlPointCostGdpNormalizer,
      // Where the campaign's research speed setting actually acts: on the
      // effective research COST. Every `researchCost`, `totalCost` and
      // remaining-cost figure on this snapshot is already on this basis, and
      // this block says which basis that is. Measured 2026-08-22; it overturns
      // the "acts on output, not cost" verdict recorded on 2026-08-21.
      researchCostScaling,
      // The label every surface renders. It is the bare difficulty for a stock
      // campaign and names the customisation for a custom one, so no reader
      // sees "Normal" on a campaign running four rates at 200%.
      difficultyLabel: describeCampaignDifficulty(saveData.difficulty ?? null, campaignSettings),
      difficultyIsCustom: campaignSettings.customDifficulty,
      // Verified against the live save on 2026-08-20: TIMetadataState does
      // not carry campaignStartYear at all, so the previous `|| 2022`
      // fabricated an elapsed-campaign measurement for every save.
      //
      // Re-measured 2026-08-21 across 14 saves: the save DOES carry the start
      // year, in `TIGlobalResearchState` rather than `TIMetadataState`, in 14
      // of 14. `campaignStartYear` below therefore now resolves to a genuine
      // measurement on every real save, and the 2022 assumption is reached only
      // when neither state is readable. `daysInCampaign` -- the game's own
      // campaign-duration counter, also 14 of 14 -- is preferred over both;
      // shared/campaignElapsed.mjs owns that ordering and its reasons.
      campaignStartYear: saveData.campaignStartYear ?? saveData.campaignStartYearFromResearchState ?? null,
      campaignStartYearAvailable: (saveData.campaignStartYear ?? saveData.campaignStartYearFromResearchState ?? null) !== null,
      // Which state answered, so a consumer can tell the two measurements apart
      // rather than being handed one undifferentiated number.
      campaignStartYearState: saveData.campaignStartYear !== null && saveData.campaignStartYear !== undefined
        ? 'TIMetadataState'
        : (saveData.campaignStartYearFromResearchState !== null && saveData.campaignStartYearFromResearchState !== undefined
          ? 'TIGlobalResearchState'
          : null),
      daysInCampaign: saveData.daysInCampaign ?? null,
      daysInCampaignAvailable: saveData.daysInCampaign !== null && saveData.daysInCampaign !== undefined,
      assumedCampaignStartYear: ASSUMED_CAMPAIGN_START_YEAR,
      campaignStartYearSource: (() => {
        if (saveData.daysInCampaign !== null && saveData.daysInCampaign !== undefined) {
          return `measured: TITimeState.daysInCampaign = ${saveData.daysInCampaign}`;
        }
        if (saveData.campaignStartYear !== null && saveData.campaignStartYear !== undefined) {
          return 'measured: TIMetadataState.campaignStartYear';
        }
        if (saveData.campaignStartYearFromResearchState !== null && saveData.campaignStartYearFromResearchState !== undefined) {
          return 'measured: TIGlobalResearchState.campaignStartYear';
        }
        return `assumed ${ASSUMED_CAMPAIGN_START_YEAR} (ModernDayStart scenario start; this save carries neither a campaign duration nor a start year)`;
      })()
    },
    factions,
    factionRelationships,
    nations,
    councilors,
    fleets,
    habs,
    habSites,
    habModules,
    shipyardStations,
    shipyardQueues,
    shipDesigns: allShipDesigns,
    resourceTransfers,
    globalResearch: {
      finishedTechsNames,
      activeSlots: activeGlobalSlots
    },
    factionIntelligence,
    activeXenoforming,
    builtAlienFacilities,
    servantTargets,
    priorityTargetFaction,
    spaceDetection: {
      saturnOrbitDistanceAU,
      skywatchRule: templateLoader.config.analysis?.rules?.spaceAssets?.innerSystemDescription || null,
      deepSystemSkywatchRule: templateLoader.config.analysis?.rules?.spaceAssets?.deepSystemDescription || null
    },
    techMatrix,
    // How much of the installed catalogue the game's own localisation covered,
    // per template file: how many entries resolved, how many the game shows
    // under a DIFFERENT name than the template's internal `friendlyName`, and
    // how many carry no localisation entry and therefore still render that
    // internal name. A fallback is an absence, not a failure -- but it is
    // counted rather than left silent. See docs/live-defect-register.md #10.
    localizationCoverage: templateLoader.getLocalizationCoverage(),
    shipHullStats: buildShipHullStats(),
    missionSpecs: buildMissionSpecs(),
    // Baked for the same reason as the two above: the hosted Cloudflare worker
    // has no template directory, so anything reading templates at request time
    // works locally and breaks the deployed site.
    unlockIndex: buildUnlockIndex(),
    driveStats: buildDriveStats(),
    propellantModules: buildPropellantModules(),
    projectGating: buildProjectGating(),
    // Which org, hab module and councilor trait grants which per-category
    // research bonus. The save carries no computed category multiplier of its
    // own, so this catalogue is the only route to the observer's exposure.
    techBonusCatalogue: buildTechBonusCatalogue(),
    // The fourteen non-drive unlock families, keyed by the same family names
    // the unlock index uses so a gate resolves without a second lookup table.
    componentStats: buildComponentStats(),
    // The effect templates a tech or project can actually reference, carrying
    // only the fields the tech tree's own per-node effect records omit --
    // `contexts`, `stackable`, `instantEffect` and a non-permanent duration --
    // plus the `resourcesGranted` / `orgGranted` rows, which are project fields
    // the tech tree does not carry at all.
    effectIndex: buildEffectIndex(),
    techTree: buildTechTree(saveData, finishedTechsNames, activeGlobalSlots, factions, researchCostScaling)
  };
}

module.exports = { ASSUMED_CAMPAIGN_START_YEAR, buildRawSnapshot };
