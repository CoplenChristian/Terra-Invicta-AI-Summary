// tests/fixtures/syntheticMarkdownSnapshot.js
//
// A filtered-snapshot-shaped synthetic snapshot for the markdown export
// property and behaviour tests (markdownExports.test.js, markdownBudget.test.js).
//
// It is deliberately NOT real save data, and it is deliberately rich:
//
//   * Property assertions ("output satisfies a bound" -- war room <= 30 KB,
//     threats < 10 KB, section headers survive) need VOLUME, not fidelity.
//     The growth ladder in markdownBudget clones these fleets to breach the
//     caps, so the base only needs to be realistic in shape, not in content.
//   * Behaviour assertions (hostile relevance filtering, design-name rollup,
//     interception-state UNAVAILABLE) need the *shape* of a real save -- real
//     faction names, relevant and below-relevance hostile fleets, per-ship
//     manifests -- but no measured values. A bound is not a value, so synthetic
//     is safe here; only the byte-identical /latest-snapshot.md test needs real
//     trimmed data, and it uses the fixtures the derive script produces.
//
// The shape mirrors the filtered snapshot that server/snapshotLoader produces
// for the renderers in shared/markdownExports.mjs.

const OBSERVER_ID = 4712;
const OBSERVER_NAME = 'the Initiative';

// Design catalogue. The friendly-fleet manifests and shipyard queues reference
// these by hullName, and the renderer must resolve them (never print the raw
// playerShipTemplate... id). Real ship names keep the assertion honest.
const DESIGNS = [
  { dataName: 'playerShipTemplate401', displayName: 'Patapsco', hullName: 'Escort' },
  { dataName: 'playerShipTemplate402', displayName: 'Xingu', hullName: 'Monitor' },
  { dataName: 'playerShipTemplate403', displayName: 'River', hullName: 'Frigate' },
  { dataName: 'playerShipTemplate404', displayName: 'Stiletto', hullName: 'Destroyer' },
  { dataName: 'playerShipTemplate405', displayName: 'Broadsword', hullName: 'Corvette' }
];

// 8 factions, the real names, so the hostile-relevance test can assert that
// the Resistance and Project Exodus -- human factions, not genuinely hostile
// against the Initiative -- never appear in the hostile section.
function makeFactions() {
  const base = {
    combatPowerAvailable: false,
    combatPower: 0,
    controlPointsCount: 10,
    habsCount: 5,
    shipsCount: 5,
    totalGdp: 10e12,
    totalResearch: 1500,
    powerScore: { overall: 50 }
  };
  const F = (id, name) => ({ ID: id, displayName: name, ...base });
  return [
    F(OBSERVER_ID, OBSERVER_NAME),
    { ID: 4710, displayName: 'the Resistance', ...base },
    { ID: 4711, displayName: 'Humanity First', ...base },
    { ID: 4713, displayName: 'the Servants', ...base },
    { ID: 4714, displayName: 'the Protectorate', ...base },
    { ID: 4715, displayName: 'the Academy', ...base },
    { ID: 4716, displayName: 'Project Exodus', ...base },
    { ID: 4717, displayName: 'the Aliens', ...base, isAlien: true }
  ];
}

// Observer-friendly fleets with per-ship manifests that resolve through the
// design catalogue.
function makeFriendlyFleets() {
  const shipsFor = (hullName, count) =>
    Array.from({ length: count }, () => ({
      hullName,
      armorMedian: 12,
      currentMaxDeltaVKps: 80
    }));

  return [
    {
      ID: 1001,
      displayName: 'Sol Patrol',
      factionId: OBSERVER_ID,
      factionName: OBSERVER_NAME,
      shipsCount: 6,
      ships: shipsFor('playerShipTemplate401', 6),
      orbitBody: 'Earth',
      weaponSummary: 'Laser x4 • Missile x2',
      weaponBreakdown: [
        { role: 'Laser', count: 4 },
        { role: 'Missile', count: 2 }
      ],
      dominantWeaponType: 'Laser',
      armorMedian: 12,
      lowestDeltaVKps: 80,
      lowestCombatAccelerationMps2: 0.2,
      mission: 'Patrol',
      inCombat: false
    },
    {
      ID: 1002,
      displayName: 'Mars Escort',
      factionId: OBSERVER_ID,
      factionName: OBSERVER_NAME,
      shipsCount: 4,
      ships: shipsFor('playerShipTemplate402', 4),
      orbitBody: 'Mars',
      weaponSummary: 'Missile x3 • Laser x1',
      weaponBreakdown: [
        { role: 'Missile', count: 3 },
        { role: 'Laser', count: 1 }
      ],
      dominantWeaponType: 'Missile',
      armorMedian: 10,
      lowestDeltaVKps: 90,
      lowestCombatAccelerationMps2: 0.15,
      mission: 'Patrol',
      inCombat: false
    },
    {
      ID: 1003,
      displayName: 'Vesta Squadron',
      factionId: OBSERVER_ID,
      factionName: OBSERVER_NAME,
      shipsCount: 3,
      ships: shipsFor('playerShipTemplate403', 3),
      orbitBody: '4 Vesta',
      weaponSummary: 'Kinetic x2 • Point Defense x1',
      weaponBreakdown: [
        { role: 'Kinetic', count: 2 },
        { role: 'Point Defense', count: 1 }
      ],
      dominantWeaponType: 'Kinetic',
      armorMedian: 8,
      lowestDeltaVKps: 70,
      lowestCombatAccelerationMps2: 0.1,
      mission: 'Patrol',
      inCombat: false
    }
  ];
}

// Hostile fleets. `belowRelevance` are BELOW the relevance bar (< 5 ships,
// distant, not targeting us) so the relevance-omission banner has a real
// number to print; the rest are relevant (>= 10 ships major combat fleets, or
// inbound transfers to an observer theater) so section 3 lists them and the
// omitted count stays strictly below the total.
function makeHostileFleets({ belowRelevance = 120, relevant = 22 } = {}) {
  const fleets = [];
  const bodies = [
    'Quaoar', 'Triton', '97 Klotho', 'Rhea', '38 Leda', 'Titania',
    'Sedna', 'Eris', 'Haumea', 'Makemake', 'Dysnomia', 'Ixion', 'Orcus', 'Varuna'
  ];
  const factionPairs = [
    { factionId: 4713, factionName: 'the Servants' },
    { factionId: 4717, factionName: 'the Aliens' }
  ];

  const hostile = (i, pair, body, shipsCount, extra = {}) => ({
    ID: 5000 + i,
    displayName: `${pair.factionName} Fleet ${i}`,
    factionId: pair.factionId,
    factionName: pair.factionName,
    shipsCount,
    ships: Array.from({ length: shipsCount }, () => ({
      armorMedian: 15,
      currentMaxDeltaVKps: 120
    })),
    orbitBody: body,
    weaponSummary: 'Laser x3 • Missile x2 • Kinetic x1',
    weaponBreakdown: [
      { role: 'Laser', count: 3 },
      { role: 'Missile', count: 2 },
      { role: 'Kinetic', count: 1 }
    ],
    dominantWeaponType: 'Laser',
    armorMedian: 15,
    lowestDeltaVKps: 120,
    lowestCombatAccelerationMps2: 0.25,
    mission: 'Patrol',
    inCombat: false,
    ...extra
  });

  // Below relevance: far away, small.
  let i = 0;
  for (; i < belowRelevance; i += 1) {
    const pair = factionPairs[i % 2];
    const body = bodies[i % bodies.length];
    fleets.push(hostile(i, pair, body, 1 + (i % 3)));
  }
  // Relevant: major combat fleets (>= 10 ships), some inbound to our theater.
  for (; i < belowRelevance + relevant; i += 1) {
    const pair = factionPairs[i % 2];
    const body = bodies[i % bodies.length];
    const inbound = i % 2 === 0;
    fleets.push(hostile(i, pair, body, 10 + ((i * 7) % 20), inbound ? {
      destination: 'Mars',
      destinationId: 90,
      arrivalDate: '2034-03-01T00:00:00Z',
      mission: 'Transfer'
    } : {}));
  }
  return fleets;
}

function makeObserverHabs() {
  const habs = [];
  for (let i = 0; i < 30; i += 1) {
    habs.push({
      ID: 900 + i,
      factionId: OBSERVER_ID,
      displayName: `Initiative Base ${i}`,
      orbitBody: i % 2 === 0 ? 'Earth' : 'Mars',
      tier: 1 + (i % 3),
      habType: i % 2 === 0 ? 'Station' : 'Surface Base',
      inCombat: false,
      underAssault: false,
      underBombardment: false
    });
  }
  return habs;
}

function makeHabModules() {
  const modules = [];
  for (let i = 0; i < 30; i += 1) {
    modules.push({
      habId: 900 + i,
      factionId: OBSERVER_ID,
      templateName: i % 3 === 0 ? 'TIShipyardModule' : (i % 3 === 1 ? 'TIResearchLab' : 'TIMiningModule'),
      constructionStatus: 'operational',
      constructionCompleted: true,
      destroyed: false
    });
  }
  return modules;
}

function makeShipyardStationsAndQueues() {
  const stations = [
    {
      id: 901,
      name: 'Initiative Base 1',
      factionId: OBSERVER_ID,
      orbitBody: 'Earth',
      tier: 2,
      shipyardModulesCount: 2,
      queue: []
    },
    {
      id: 902,
      name: 'Initiative Base 2',
      factionId: OBSERVER_ID,
      orbitBody: 'Mars',
      tier: 3,
      shipyardModulesCount: 3,
      queue: []
    }
  ];
  const queues = [
    {
      id: 777,
      factionId: OBSERVER_ID,
      orbitBody: 'Earth',
      design: 'playerShipTemplate401',
      completionDate: '2034-08-15T00:00:00Z',
      constructionStatus: 'building'
    },
    {
      id: 778,
      factionId: OBSERVER_ID,
      orbitBody: 'Mars',
      design: 'playerShipTemplate404',
      completionDate: '2034-09-01T00:00:00Z',
      constructionStatus: 'building'
    }
  ];
  return { stations, queues };
}

function makeEconomics(mode) {
  return {
    applicable: true,
    actualAlienHate: mode === 'omniscient' ? 49.56 : null,
    visibleHateEstimate: '■■■■■',
    minimumAlienHate: 36.6,
    hateAboveFloor: mode === 'omniscient' ? 12.96 : null,
    warThreshold: 50,
    minimumHateHeadroom: 13.4,
    usedMissionControl: 122,
    missionControlCapacity: 170,
    mcWarFloor: 208.3,
    minimumFloorStatus: 'BELOW PERMANENT-WAR FLOOR',
    currentWarStatus: mode === 'omniscient' ? 'WAR THRESHOLD EXCEEDED' : 'GAME-VISIBLE ESTIMATE',
    formula: { text: '122.00 × 0.30 × 0.80 = 29.28' },
    reductionProjects: [
      { label: 'Strategic Deception', applicable: true, completed: true },
      { label: 'Maskirovka', applicable: true, completed: false }
    ]
  };
}

function makeSnapshot(mode) {
  const { stations, queues } = makeShipyardStationsAndQueues();
  return {
    mode,
    observerFactionId: OBSERVER_ID,
    observerFactionName: OBSERVER_NAME,
    isOmniscient: mode === 'omniscient',
    metadata: {
      gameTimeString: '2/16/2034 12:00:00 PM',
      difficulty: 'Normal'
    },
    capabilities: {
      deepSkywatch: true,
      skywatch: true
    },
    alienIntelligenceStage: {
      abductions: { status: 'AVAILABLE' },
      contacts: { status: 'AVAILABLE' },
      operations: { status: 'AVAILABLE' },
      operatives: { status: 'AVAILABLE', active: true, detectedCount: 0 }
    },
    factions: makeFactions(),
    councilors: [
      { ID: 1, displayName: 'Alien Operative', factionId: 4717, isAlien: true, locationName: 'Earth', status: 'Active' }
    ],
    fleets: [
      ...makeFriendlyFleets(),
      ...makeHostileFleets()
    ],
    habs: makeObserverHabs(),
    habModules: makeHabModules(),
    shipDesigns: DESIGNS,
    shipyardStations: stations,
    shipyardQueues: queues,
    globalResearch: {
      activeSlots: [
        {
          slotNumber: 1,
          displayName: 'Colony Habs',
          percent: 33,
          accumulatedResearch: 11560,
          totalCost: 35000,
          leadFactionName: 'the Protectorate',
          leadContribution: 7028
        },
        {
          slotNumber: 2,
          displayName: 'Arc Lasers',
          percent: 2.5,
          accumulatedResearch: 626,
          totalCost: 25000,
          leadFactionName: 'the Initiative',
          leadContribution: 269
        }
      ]
    },
    alienHateEconomics: makeEconomics(mode),
    servantTargets: [
      {
        nationName: 'India',
        score: 95,
        targetFactionName: 'the Servants',
        targetCPCount: 2,
        totalCPCount: 5,
        gdpTrillion: 19.6,
        nukes: 0,
        reasons: ['Superpower Economy ($19.6T GDP)', 'Strategic Mission Control (27 MC)']
      },
      {
        nationName: 'China',
        score: 78,
        targetFactionName: 'the Servants',
        targetCPCount: 0,
        totalCPCount: 6,
        gdpTrillion: 41.7,
        nukes: 10,
        reasons: ['Superpower Economy ($41.7T GDP)', 'High Research Output (1220/mo)']
      }
    ],
    priorityTargetFaction: { id: 4713, name: 'the Servants' }
  };
}

module.exports = {
  makeMarkdownSnapshot: (mode = 'player') => makeSnapshot(mode),
  OBSERVER_ID,
  OBSERVER_NAME
};