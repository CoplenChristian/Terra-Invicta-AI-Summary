// Synthetic Terra Invicta save-data fixture used by the unit tests. It mirrors
// the shape produced by server/saveParser.readSaveJson() so the snapshot
// pipeline can be exercised without depending on a real game save.

const ref = (value) => ({ value });

function makeFaction(id, displayName, options = {}) {
  return {
    Value: {
      ID: ref(id),
      displayName,
      templateName: options.templateName || displayName,
      resources: {
        Money: options.money ?? 0,
        Influence: 10,
        Operations: 5,
        Boost: 0,
        Water: 0,
        Volatiles: 0,
        Metals: 0,
        NobleMetals: 0,
        Fissiles: 0,
        Exotics: 0
      },
      assessedAlienHateOfMe: options.hate ?? 0,
      missionControlUsage: options.missionControlUsage ?? 0,
      finishedProjectNames: options.finishedProjects || [],
      availableProjectNames: options.availableProjects || [],
      currentProjectProgress: options.currentProjects || [],
      factionHate: (options.factionHate || []).map(entry => ({
        Key: ref(entry.targetId),
        Value: entry.hate
      })),
      knowsIveBeenSeenBy: [],
      milestones: [],
      intel: [],
      knownAlienSites: []
    }
  };
}

function makeControlPoint(id, factionId, nationId, { executive = false } = {}) {
  return {
    Value: {
      ID: ref(id),
      faction: ref(factionId),
      nation: ref(nationId),
      executive: executive,
      controlPointType: executive ? 'Executive' : 'Standard'
    }
  };
}

function makeCouncilor(id, displayName, factionId, options = {}) {
  return {
    Value: {
      ID: ref(id),
      displayName,
      personalName: displayName,
      familyName: 'Test',
      typeTemplateName: options.typeTemplateName || 'TICouncilorTemplate',
      faction: ref(factionId),
      status: 'Active',
      attributes: options.attributes || {
        Persuasion: 10,
        Investigation: 10,
        Espionage: 10,
        Command: 10,
        Administration: 10,
        Science: 10,
        Security: 10,
        Loyalty: 10,
        ApparentLoyalty: 10
      },
      orgs: [],
      traitTemplateNames: [],
      knowsIveBeenSeenBy: (options.seenBy || []).map(ref),
      location: options.location ? ref(options.location) : null,
      homeRegion: options.homeRegion ? ref(options.homeRegion) : null,
      agentForFaction: options.agentForFaction ? ref(options.agentForFaction) : null,
      XP: 0,
      gender: 'M'
    }
  };
}

function makeSpaceBody(id, displayName, position) {
  return {
    Value: {
      ID: ref(id),
      displayName,
      globalPosition: position || { x: 0, y: 0, z: 0 }
    }
  };
}

function makeOrbit(id, barycenterId) {
  return {
    Value: { ID: ref(id), barycenter: ref(barycenterId) }
  };
}

function makeSaveData({ money = 100, ships = 1, gameTimeString = '2025-01-01T00:00:00Z' } = {}) {
  return {
    filePath: 'synthetic.gz',
    fileName: 'synthetic.gz',
    fileSizeBytes: 1,
    lastModified: new Date('2025-01-01T00:00:00Z'),
    parseTimeMs: 1,
    gameTimeString,
    difficulty: 'Veteran',
    campaignStartYear: 2022,
    gamestates: {
      'PavonisInteractive.TerraInvicta.TIMetadataState': [
        { Value: { gameTimeString, difficulty: 'Veteran', campaignStartYear: 2022 } }
      ],
      'PavonisInteractive.TerraInvicta.TIFactionState': [
        makeFaction(4712, 'the Initiative', { money, hate: 5, missionControlUsage: 10, finishedProjects: ['Project_TheirOperations'] }),
        makeFaction(4713, 'the Servants', { money: 200, hate: 90, factionHate: [{ targetId: 4712, hate: 90 }] }),
        makeFaction(4717, 'the Aliens', { money: 0, hate: 100, factionHate: [{ targetId: 4712, hate: 100 }] })
      ],
      'PavonisInteractive.TerraInvicta.TINationState': [
        {
          Value: {
            ID: ref(1),
            displayName: 'United States',
            templateName: 'Nation_USA',
            GDP: 20e12,
            historyPopulation: [300e6],
            historyBoost: [5],
            historyResearch: [800],
            milTech: 5,
            democracy: 8,
            cohesion: 7,
            unrest: 2,
            nuclearWeapons: 10,
            armies: [],
            missionControl: 8,
            regions: [ref(11), ref(12)]
          }
        },
        {
          Value: {
            ID: ref(2),
            displayName: 'China',
            templateName: 'Nation_China',
            GDP: 15e12,
            historyPopulation: [1400e6],
            historyBoost: [3],
            historyResearch: [600],
            milTech: 4,
            democracy: 3,
            cohesion: 5,
            unrest: 3,
            nuclearWeapons: 5,
            armies: [],
            missionControl: 5,
            regions: [ref(21)]
          }
        }
      ],
      'PavonisInteractive.TerraInvicta.TIControlPoint': [
        makeControlPoint(11, 4712, 1, { executive: true }),
        makeControlPoint(12, 4712, 1),
        makeControlPoint(21, 4713, 2, { executive: true }),
        makeControlPoint(22, 4713, 2)
      ],
      'PavonisInteractive.TerraInvicta.TICouncilorState': [
        makeCouncilor(100, 'Ada Lovelace', 4712),
        makeCouncilor(101, 'Enemy Agent', 4713, { seenBy: [4712] }),
        makeCouncilor(102, 'Hydra', 4717, { typeTemplateName: 'AlienCouncilorTemplate', seenBy: [4712] })
      ],
      'PavonisInteractive.TerraInvicta.TIRegionState': [
        { Value: { ID: ref(11), displayName: 'New York' } },
        { Value: { ID: ref(12), displayName: 'California' } },
        { Value: { ID: ref(21), displayName: 'Beijing' } }
      ],
      'PavonisInteractive.TerraInvicta.TIHabState': [
        {
          Value: {
            ID: ref(300),
            displayName: 'Nightingale Station',
            faction: ref(4712),
            habType: 'Station',
            tier: 1,
            orbitState: ref(500),
            inEarthLEO: true,
            inCombat: false,
            underAssault: false,
            underBombardment: false,
            sectors: []
          }
        }
      ],
      'PavonisInteractive.TerraInvicta.TIHabSiteState': [
        {
          Value: {
            ID: ref(400),
            displayName: 'Ceres Deposit A',
            parentBody: ref(700),
            hab: ref(300),
            water_day: 10,
            volatiles_day: 0,
            metals_day: 5,
            nobles_day: 0,
            fissiles_day: 0
          }
        }
      ],
      'PavonisInteractive.TerraInvicta.TISpaceFleetState': [
        {
          Value: {
            ID: ref(600),
            displayName: 'Belt Patrol',
            faction: ref(4712),
            ships: Array.from({ length: ships }, (_, index) => ref(610 + index)),
            orbitState: ref(500),
            inCombat: false
          }
        }
      ],
      'PavonisInteractive.TerraInvicta.TISpaceShipState': [
        {
          Value: {
            ID: ref(610),
            displayName: 'Patrol Craft',
            hullTemplateName: 'Hull_Corvette',
            combatPower: 50,
            noseWeapons: [],
            hullWeapons: [],
            utilityModules: [],
            ammo: []
          }
        },
        {
          Value: {
            ID: ref(611),
            displayName: 'Patrol Craft 2',
            hullTemplateName: 'Hull_Corvette',
            combatPower: 50,
            noseWeapons: [],
            hullWeapons: [],
            utilityModules: [],
            ammo: []
          }
        }
      ],
      'PavonisInteractive.TerraInvicta.TISpaceBodyState': [
        makeSpaceBody(700, 'Ceres', { x: 4.1e11, y: 0, z: 0 }),
        makeSpaceBody(701, 'Saturn', { x: 1.43e12, y: 0, z: 0 })
      ],
      'PavonisInteractive.TerraInvicta.TIOrbitState': [
        makeOrbit(500, 700),
        makeOrbit(501, 701)
      ],
      'PavonisInteractive.TerraInvicta.TIGlobalResearchState': [
        {
          Value: {
            finishedTechsNames: ['Skywatch'],
            techProgress: []
          }
        }
      ],
      'PavonisInteractive.TerraInvicta.TIRegionXenoformingState': [],
      'PavonisInteractive.TerraInvicta.TIRegionAlienFacilityState': [],
      'PavonisInteractive.TerraInvicta.TIMissionState': []
    }
  };
}

module.exports = { makeSaveData };
