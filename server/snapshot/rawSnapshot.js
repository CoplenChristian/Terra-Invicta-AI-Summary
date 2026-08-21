// server/snapshot/rawSnapshot.js
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
const lookups = require('./lookups');
const space = require('./space');
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
  buildProjectGating
} = require('./templates');

// Terra Invicta campaigns begin in 2022. The save's TIMetadataState does not
// record the start year (verified against the live save, 2026-08-20), so this
// is an assumption rather than a measurement and every consumer is told so via
// `metadata.campaignStartYearSource`.
const ASSUMED_CAMPAIGN_START_YEAR = 2022;

function buildRawSnapshot(saveData) {
  const gamestates = saveData.gamestates || {};
  const raw = lookups.readRawCollections(gamestates);
  const {
    rawFactions, rawNations, rawControlPoints, rawCouncilors, rawHabs, rawHabModules,
    rawHabSites, rawFleets, rawAlienFacilities, rawXenoforming, rawGlobalResearch
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

  // Process Global Research
  const globalResearchObj = rawGlobalResearch[0] || {};
  const finishedTechsNames = Array.isArray(globalResearchObj.finishedTechsNames) ? globalResearchObj.finishedTechsNames : [];
  const techProgress = Array.isArray(globalResearchObj.techProgress) ? globalResearchObj.techProgress : [];
  const activeGlobalSlots = buildGlobalResearchSlots(techProgress, { factionsById });

  // Process Factions Summary & Power Scores
  const analysisConfig = templateLoader.config.analysis || {};
  const scoreWeights = analysisConfig.powerScore?.weights || {};
  const scoreNormalizers = analysisConfig.powerScore?.normalizers || {};

  const factionRelationships = factionsModule.buildFactionRelationships(rawFactions);

  const factions = factionsModule.buildFactions(rawFactions, {
    councilors, habs, fleets, nations, controlPointsById, shipyardCountByFaction,
    shipyardQueues, habResearchByFaction, scoreWeights, scoreNormalizers,
    gameTimeString: saveData.gameTimeString
  });

  const allShipDesigns = factionsModule.collectShipDesigns(rawFactions);

  // Active Xenoforming and Alien Facilities
  const activeXenoforming = factionsModule.buildActiveXenoforming(rawXenoforming, { regionsById });
  const builtAlienFacilities = factionsModule.buildAlienFacilities(rawAlienFacilities, { regionsById });

  const { servantTargets, priorityTargetFaction } =
    factionsModule.buildDefaultTargets(factions, nations, controlPointsByNationId);

  const keyProjects = (analysisConfig.strategicProjects || []).map(project => project.id);
  const techMatrix = factionsModule.buildTechMatrix(keyProjects, { factions, rawFactions });

  return {
    miningScarcityWeights: analysisConfig.miningScarcityWeights,
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
      // Verified against the live save on 2026-08-20: TIMetadataState does
      // not carry campaignStartYear at all, so the previous `|| 2022`
      // fabricated an elapsed-campaign measurement for every save. The
      // measured field now stays null; the 2022 series start is offered
      // separately as an explicitly labelled assumption, following the same
      // pattern the hate model already uses for `progressionSpeedAssumed`.
      campaignStartYear: saveData.campaignStartYear ?? null,
      campaignStartYearAvailable: saveData.campaignStartYear !== null && saveData.campaignStartYear !== undefined,
      assumedCampaignStartYear: ASSUMED_CAMPAIGN_START_YEAR,
      campaignStartYearSource: saveData.campaignStartYear !== null && saveData.campaignStartYear !== undefined
        ? 'save metadata'
        : `assumed ${ASSUMED_CAMPAIGN_START_YEAR} (Terra Invicta campaign start; not present in save metadata)`
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
    shipHullStats: buildShipHullStats(),
    missionSpecs: buildMissionSpecs(),
    // Baked for the same reason as the two above: the hosted Cloudflare worker
    // has no template directory, so anything reading templates at request time
    // works locally and breaks the deployed site.
    unlockIndex: buildUnlockIndex(),
    driveStats: buildDriveStats(),
    propellantModules: buildPropellantModules(),
    projectGating: buildProjectGating(),
    techTree: buildTechTree(saveData, finishedTechsNames, activeGlobalSlots, factions)
  };
}

module.exports = { ASSUMED_CAMPAIGN_START_YEAR, buildRawSnapshot };
