// `/api/intel/research-ranking` -- phase 4 of the research advisor, and the
// v2 panel that renders it.
//
// The three rules this phase exists to hold, each with a test that fails if the
// rule is removed:
//
//   1. Ranking is by value per RESEARCH POINT, not raw value.
//   2. Military and economic value are never merged into one number.
//   3. The measured capability deficit outranks raw value inside a group, and
//      the ordering MOVES when the deficit moves. The scenario block below runs
//      the same fixture three times with only the alien fleet's numbers changed
//      and asserts a different candidate leads each time -- which is the spec's
//      own acceptance criterion, "a save where armour is the gap must not
//      recommend drives".
//
// Fixtures follow tests/militaryValue.test.js: a synthetic campaign state over
// the REAL installed templates, so the turn-1 case exercises the same catalogue
// the live save does.

const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const snapshotBuilder = require('../server/snapshotBuilder');
const snapshotIdentity = require('../server/snapshotIdentity');
const intelligenceFilter = require('../server/intelligenceFilter');
const { makeSaveData } = require('./fixtures/syntheticSave');
const {
  INTEL_ENDPOINT_EXAMPLES,
  INTEL_ENDPOINT_INDEX,
  DETAIL_AWARE_RESOURCES,
  SUPPORTED_RESOURCES,
  buildResourceProjection
} = require('../shared/intel/registry.mjs');
const { dedupeByGateProject } = require('../shared/intel/researchRanking.mjs');
const {
  ACTIONABLE_GROUPS,
  ASPIRATIONAL_GROUPS,
  AVAILABILITY_GROUP_ORDER,
  AXIS_KINDS,
  DEFICIT_RESEARCH_REMEDIES,
  RANK_STATES,
  axisKindRank,
  closesDeficit,
  compareEconomicRows,
  compareMilitaryRows,
  economicRankRows,
  groupByAvailability,
  militaryValuePerResearchPoint,
  orientEconomicRow,
  resolveDeficitOrdering
} = require('../shared/researchRanking.mjs');
const { summarizeFleetCapability } = require('../shared/fleetCapability.mjs');

const OBSERVER = 4712;
const ALIEN = 4717;

const AVAILABLE = [
  'Project_Solid-FuelSpaceRockets',
  'Project_Liquid-FuelRockets',
  'Project_NanotubeArmor',
  'Project_NeutronFluxLantern'
];

const TURN_ONE_AVAILABLE = ['Project_Solid-FuelSpaceRockets', 'Project_Liquid-FuelRockets'];

// ---------------------------------------------------------------------------
// FIXTURES
// ---------------------------------------------------------------------------

function filtered(save, mode) {
  const raw = snapshotBuilder.buildRawSnapshot(save);
  const identity = snapshotIdentity.createSnapshotIdentity(
    { fullPath: 'synthetic.gz', lastModified: new Date('2025-01-01T00:00:00Z'), saveHash: 'x' },
    'initiative'
  );
  return intelligenceFilter.applyFilter({ ...raw, ...identity }, mode, OBSERVER);
}

/** Strips the campaign back to a chosen available-project list. */
function reset(snapshot, available) {
  snapshot.habModules = [];
  for (const faction of snapshot.factions) {
    faction.completedProjects = [];
    faction.currentProjects = [];
    faction.availableProjectNames = faction.ID === OBSERVER ? [...available] : [];
    faction.availableProjectsCount = faction.ID === OBSERVER ? available.length : 0;
    faction.totalResearch = faction.ID === OBSERVER ? 500 : 0;
  }
  if (snapshot.techTree) {
    snapshot.techTree.finishedTechsNames = [];
    snapshot.techTree.globalActive = [];
    snapshot.techTree.factionStatus = Object.fromEntries(
      Object.keys(snapshot.techTree.factionStatus || {}).map(id => [id, {
        completedProjects: [],
        availableProjectNames: Number(id) === OBSERVER ? [...available] : [],
        currentProjects: []
      }])
    );
  }
  return snapshot;
}

/** Turn one: nothing flown, nothing completed, two chemical rockets offered. */
function turnOneSnapshot(mode = 'player') {
  const snapshot = reset(filtered(makeSaveData({ ships: 0 }), mode), TURN_ONE_AVAILABLE);
  snapshot.fleets = [];
  snapshot.shipDesigns = [];
  return snapshot;
}

/**
 * An observer with one real warship, and one observable alien hull whose
 * numbers the caller dials.
 *
 * The alien hull carries a real weapon because phase 2 chooses the armour
 * ranking axis from the measured threat mix and declines to rank at all
 * without one -- a fixture with no observable threat is a fixture where armour
 * is deliberately unranked.
 */
function fleetScenario({ ownArmor, ownDeltaV, alienArmor, alienDeltaV, ownShips, alienShips }, mode = 'player') {
  const snapshot = reset(filtered(makeSaveData({ ships: 1 }), mode), AVAILABLE);
  snapshot.shipDesigns = [{
    dataName: 'observerWarship',
    _displayName: 'Test Warship',
    hullName: 'Battlecruiser',
    driveName: 'BurnerDrivex6',
    powerPlantName: 'SolidCoreFissionReactorI',
    radiatorName: 'AluminumFin',
    factionId: OBSERVER,
    noseArmor: { materialName: 'SteelArmor', armorValue: 5 },
    lateralArmor: { materialName: 'SteelArmor', armorValue: 2 },
    tailArmor: { materialName: 'SteelArmor', armorValue: 2 },
    moduleTemplateEntries: [{ moduleName: 'WaterHeatSink' }, { moduleName: 'Lithium-IonBattery' }],
    noseWeaponTemplateEntries: [{ moduleName: 'LightRailCannonMk1' }],
    hullWeaponTemplateEntries: [{ moduleName: 'KraitMissileBay' }],
    propellantTanks: 8
  }];
  snapshot.fleets = [
    {
      ID: 900,
      displayName: 'Observer Fleet',
      factionId: OBSERVER,
      shipsCount: ownShips,
      armorMedian: ownArmor,
      lowestDeltaVKps: ownDeltaV,
      orbitBody: 'Earth',
      ships: [{
        ID: 9001,
        displayName: 'Test Hull',
        hullName: 'observerWarship',
        currentMassKg: 6000000,
        propellantTons: 1500,
        armorMedian: ownArmor,
        currentDeltaVKps: ownDeltaV,
        currentMaxDeltaVKps: ownDeltaV,
        cruiseAccelerationMps2: 0.1,
        combatAccelerationMps2: 0.9,
        missionControlConsumption: 3,
        weaponLoadout: []
      }]
    },
    {
      ID: 901,
      displayName: 'Alien Formation',
      factionId: ALIEN,
      shipsCount: alienShips,
      armorMedian: alienArmor,
      lowestDeltaVKps: alienDeltaV,
      orbitBody: 'Mars',
      visibility: 'Deep System Skywatch',
      ships: [{
        ID: 9101,
        displayName: 'Alien Hull',
        hullName: 'redactedAlienDesign',
        armorMedian: alienArmor,
        currentMaxDeltaVKps: alienDeltaV,
        weaponLoadout: [{ role: 'Kinetic', category: 'Kinetic', count: 1, systems: ['Alien Light Mag Battery'] }]
      }]
    }
  ];
  const observer = snapshot.factions.find(faction => faction.ID === OBSERVER);
  const aliens = snapshot.factions.find(faction => faction.ID === ALIEN);
  if (observer) {
    observer.shipsCount = ownShips;
    observer.researchWeights = [0, 0, 3, 3, 3, 0];
  }
  if (aliens) aliens.shipsCount = alienShips;
  snapshot.globalResearch = {
    activeSlots: [
      { techId: 'G1', displayName: 'Global 1', contributions: [] },
      { techId: 'G2', displayName: 'Global 2', contributions: [] },
      { techId: 'G3', displayName: 'Global 3', contributions: [] }
    ]
  };
  return snapshot;
}

const project = (snapshot, options = {}) =>
  buildResourceProjection(snapshot, 'research-ranking', { mode: 'player', observerId: OBSERVER, ...options });

const groupOf = (result, state) =>
  (result.military.groups || []).find(group => group.state === state) || null;

// ---------------------------------------------------------------------------
// REGISTRATION
// ---------------------------------------------------------------------------

test('the endpoint is registered the same way every other intel endpoint is', () => {
  assert.ok(SUPPORTED_RESOURCES.has('research-ranking'));
  assert.equal(INTEL_ENDPOINT_INDEX.researchRanking, '/api/intel/research-ranking');
  assert.ok(INTEL_ENDPOINT_EXAMPLES.researchRanking, 'the discovery index must carry an example query');
  assert.ok(DETAIL_AWARE_RESOURCES.has('research-ranking'),
    'the full listing is every row of every group in both tracks; it must be opt-in');
});

// ---------------------------------------------------------------------------
// RULE 1 -- VALUE PER RESEARCH POINT, NOT RAW VALUE
// ---------------------------------------------------------------------------

test('a bigger benefit at a bigger cost loses to a smaller benefit at a smaller cost', () => {
  // Spec section 2, verbatim: "a 150,000-cost tech with twice the benefit of a
  // 25,000-cost one is worse".
  const expensive = militaryValuePerResearchPoint(3, 150000, 'researchable-now');
  const cheap = militaryValuePerResearchPoint(2, 25000, 'researchable-now');

  assert.equal(expensive.state, RANK_STATES.ranked);
  assert.equal(cheap.state, RANK_STATES.ranked);
  assert.ok(expensive.gainMultiple > cheap.gainMultiple, 'the expensive one really is the bigger raw gain');
  assert.ok(
    cheap.perResearchPoint > expensive.perResearchPoint,
    'but per research point the cheaper one wins, and that is what the ranking uses'
  );

  const ordered = [
    { id: 'expensive', closesDeficit: false, valuePerResearchPoint: expensive.perResearchPoint },
    { id: 'cheap', closesDeficit: false, valuePerResearchPoint: cheap.perResearchPoint }
  ].sort(compareMilitaryRows);
  assert.equal(ordered[0].id, 'cheap');
});

test('the -1 in the gain is load-bearing: a 1.0x multiple is not worth a research point', () => {
  const parity = militaryValuePerResearchPoint(1, 5000, 'researchable-now');
  assert.equal(parity.state, RANK_STATES.noImprovement,
    'equal to what you already field is not an improvement and must not be ranked as one');
  assert.equal(parity.perResearchPoint, null);
  assert.equal(parity.gainMultiple, 0);
});

// ---------------------------------------------------------------------------
// RULE 2 -- NEVER ONE NUMBER
// ---------------------------------------------------------------------------

test('military and economic value are two rankings and are never summed', () => {
  const result = project(fleetScenario({
    ownArmor: 2, ownDeltaV: 20, alienArmor: 40, alienDeltaV: 25, ownShips: 10, alienShips: 12
  }));

  assert.ok(result.military, 'military track present');
  assert.ok(result.economic, 'economic track present');
  assert.ok(Array.isArray(result.economic.units), 'economic value is split by unit, never totalled');

  // Nothing anywhere in the payload adds the two together.
  const forbiddenKeys = ['combinedScore', 'totalValue', 'overallScore', 'blendedScore'];
  const serialised = JSON.stringify(result);
  for (const key of forbiddenKeys) {
    assert.ok(!serialised.includes(`"${key}"`), `a "${key}" field would be the blended score section 2 forbids`);
  }

  // And every row declares which track it belongs to, so a flat reader cannot
  // mistake the concatenation for a merged ranking.
  for (const row of result.items) {
    assert.ok(row.track === 'military' || row.track === 'economic', 'every row names its track');
  }
  assert.match(result.ordering.basis, /NOT a merged score/);
  assert.deepEqual(result.ordering.trackOrder, ['military', 'economic']);
});

test('economic units are ranked inside themselves, never against each other', () => {
  const result = project(fleetScenario({
    ownArmor: 2, ownDeltaV: 20, alienArmor: 40, alienDeltaV: 25, ownShips: 10, alienShips: 12
  }));
  for (const unit of result.economic.units) {
    for (const group of unit.groups) {
      for (const row of group.items) {
        assert.equal(row.unit, unit.unit, 'a row never appears under a unit that is not its own');
      }
    }
  }
});

// ---------------------------------------------------------------------------
// RULE 3 -- THE DEFICIT MOVES THE ORDERING
// ---------------------------------------------------------------------------

const SCENARIOS = {
  armour: { ownArmor: 2, ownDeltaV: 20, alienArmor: 40, alienDeltaV: 25, ownShips: 10, alienShips: 12 },
  deltaV: { ownArmor: 20, ownDeltaV: 5, alienArmor: 24, alienDeltaV: 400, ownShips: 10, alienShips: 12 },
  hulls: { ownArmor: 20, ownDeltaV: 20, alienArmor: 24, alienDeltaV: 25, ownShips: 2, alienShips: 90 }
};

test('when armour is the measured gap the ranking leads with armour, not drives', () => {
  const result = project(fleetScenario(SCENARIOS.armour));
  assert.equal(result.deficit.axisKey, 'armor');
  assert.equal(result.ordering.deficitApplied, true);

  const now = groupOf(result, 'researchable-now');
  assert.ok(now && now.items.length > 0, 'this fixture has something researchable now');
  assert.equal(now.items[0].classKey, 'ship_armor', 'the armour candidate leads the group');
  assert.equal(now.items[0].closesDeficit, true);
  assert.ok(!now.items.some(row => row.source === 'propulsion' && row.closesDeficit),
    'no drive is promoted when armour is the gap');

  // The load-bearing half. The researchable-now group happens to hold one row,
  // so it would lead however the list were sorted; the blocked group is where
  // the promotion is doing real work. Armour leads it despite an offensive
  // candidate scoring five orders of magnitude higher per research point.
  const blocked = groupOf(result, 'prereq-blocked');
  assert.ok(blocked && blocked.items.length > 1, 'the blocked group holds several candidates');
  assert.equal(blocked.items[0].classKey, 'ship_armor');
  assert.equal(blocked.items[0].closesDeficit, true);
  const topScorer = [...blocked.items].sort((a, b) => b.valuePerResearchPoint - a.valuePerResearchPoint)[0];
  assert.notEqual(topScorer.id, blocked.items[0].id);
  // The margin was 371,000x until phase 5, because the group's top scorer was
  // `AntimatterTorpedoLauncher` at 1,114.58 per point. Phase 5's delivery floor
  // now ranks that row below its own class-mate -- the torpedo absorbs 2.44x
  // the point-defence fire per arriving round of the Krait bay this fixture's
  // observer flies -- so the group's highest scorer is the fission reactor at
  // 0.0081 against armour's 0.0030. The demotion itself is asserted in
  // `tests/munitionDelivery.test.js`; what this line still proves is that the
  // deficit promotion is not an accident of value, which holds at 2.70x.
  assert.ok(topScorer.valuePerResearchPoint > blocked.items[0].valuePerResearchPoint * 2,
    'and the candidate it outranks scores substantially higher, so the ordering cannot be an accident of value');
});

test('when delta-V is the measured gap a drive leads, ahead of a higher-scoring armour candidate', () => {
  const result = project(fleetScenario(SCENARIOS.deltaV));
  assert.equal(result.deficit.axisKey, 'deltaV');
  assert.equal(result.ordering.deficitApplied, true);

  const now = groupOf(result, 'researchable-now');
  assert.ok(now && now.items.length >= 2, 'this fixture offers both a drive and an armour candidate');
  const lead = now.items[0];
  assert.equal(lead.source, 'propulsion', 'the drive leads');
  assert.equal(lead.closesDeficit, true);

  // The whole point: the promoted row is NOT the highest value-per-point one.
  const best = [...now.items].sort((a, b) => b.valuePerResearchPoint - a.valuePerResearchPoint)[0];
  assert.notEqual(best.id, lead.id, 'the fixture is only meaningful if the deficit row is not also the top scorer');
  assert.ok(best.valuePerResearchPoint > lead.valuePerResearchPoint,
    'a strictly higher-scoring candidate exists and is still ordered below the one that closes the gap');
});

test('a deficit whose remedy is production promotes nothing, and says why', () => {
  const result = project(fleetScenario(SCENARIOS.hulls));
  assert.equal(result.deficit.axisKey, 'ships');
  assert.equal(result.deficit.remedyKind, 'production');
  assert.equal(result.ordering.deficitApplied, false,
    'no research candidate closes a hull-count gap, so none is promoted');
  assert.match(result.deficit.reason, /production/);

  for (const group of result.military.groups) {
    for (const row of group.items) {
      assert.equal(row.closesDeficit, false, 'nothing claims to close a gap research cannot close');
    }
  }

  // And with nothing promoted, the ordering falls back to pure value per point.
  const now = groupOf(result, 'researchable-now');
  if (now && now.items.length > 1) {
    for (let i = 1; i < now.items.length; i += 1) {
      assert.ok(now.items[i - 1].valuePerResearchPoint >= now.items[i].valuePerResearchPoint);
    }
  }
});

test('the deficit remedy table maps by exact key, so a lookalike class is not promoted', () => {
  const ordering = resolveDeficitOrdering(summarizeFleetCapability({
    observer: { ID: OBSERVER, shipsCount: 10 },
    factions: [{ ID: OBSERVER }, { ID: ALIEN, templateName: 'AlienCouncil', shipsCount: 12 }],
    fleets: [
      { factionId: OBSERVER, shipsCount: 10, armorMedian: 2, lowestDeltaVKps: 20 },
      { factionId: ALIEN, shipsCount: 12, armorMedian: 40, lowestDeltaVKps: 25 }
    ]
  }));
  assert.equal(ordering.axisKey, 'armor');
  assert.equal(closesDeficit({ classKey: 'ship_armor' }, ordering), true);
  assert.equal(closesDeficit({ classKey: 'ship_hull' }, ordering), false,
    'ship_hull is not ship_armor and a substring match would wrongly promote it');
  assert.equal(closesDeficit({ source: 'propulsion' }, ordering), false);
  assert.deepEqual(DEFICIT_RESEARCH_REMEDIES.ships.classKeys, []);
});

test('one project that unlocks several things keeps its deficit promotion', () => {
  // A gate that unlocks both a drive and a higher-scoring radiator is ONE
  // research decision, so it must appear once. The row that survives is the one
  // that closes the measured deficit, NOT the higher scorer: the "closes gap"
  // badge has to sit on the unlock that actually closes it, or the panel reads
  // as a radiator closing a delta-V gap.
  const rows = [
    {
      id: 'radiator-row', gateProjectId: 'Project_Shared', availabilityState: 'researchable-now',
      classKey: 'radiator', displayName: 'Better Radiator', axisLabel: 'heat rejection',
      valuePerResearchPoint: 9, improvementMultiple: 4, closesDeficit: false
    },
    {
      id: 'drive-row', gateProjectId: 'Project_Shared', availabilityState: 'researchable-now',
      source: 'propulsion', displayName: 'Better Drive', axisLabel: 'combat acceleration',
      valuePerResearchPoint: 1, improvementMultiple: 2, closesDeficit: true
    }
  ];
  const merged = dedupeByGateProject(rows.map(row => ({ ...row })));

  assert.equal(merged.length, 1, 'one project is one row');
  assert.equal(merged[0].id, 'drive-row', 'the deficit-closing unlock is the one shown');
  assert.equal(merged[0].closesDeficit, true);
  assert.equal(merged[0].alsoImproves.length, 1);
  assert.equal(merged[0].alsoImproves[0].displayName, 'Better Radiator',
    'the higher-scoring sibling is named, not silently dropped');

  // With no deficit in play, value decides instead.
  const noDeficit = dedupeByGateProject(rows.map(row => ({ ...row, closesDeficit: false })));
  assert.equal(noDeficit.length, 1);
  assert.equal(noDeficit[0].id, 'radiator-row', 'without a deficit the higher scorer survives');
  assert.equal(noDeficit[0].closesDeficit, false);
});

test('rows with no gate project id are never merged into one another', () => {
  // The repo has twice collapsed a record set by letting `undefined` become a
  // dedupe key. Two ungated items share no project and must stay two rows.
  const kept = dedupeByGateProject([
    { id: 'a', gateProjectId: null, availabilityState: 'ungated', valuePerResearchPoint: 1, closesDeficit: false },
    { id: 'b', gateProjectId: null, availabilityState: 'ungated', valuePerResearchPoint: 2, closesDeficit: false }
  ]);
  assert.equal(kept.length, 2);
  assert.deepEqual(kept.map(row => row.id).sort(), ['a', 'b']);
});

// ---------------------------------------------------------------------------
// AVAILABILITY IS NEVER MIXED (spec section 3b)
// ---------------------------------------------------------------------------

test('ranking happens inside an availability group and never across two', () => {
  const result = project(fleetScenario(SCENARIOS.deltaV));
  const seen = [];
  for (const group of result.military.groups) {
    seen.push(group.state);
    for (const row of group.items) {
      assert.equal(row.availabilityState, group.state,
        'a prereq-clear candidate in the researchable-now group would offer something that cannot be selected');
    }
  }
  // Groups arrive in reachability order, so the actionable ones lead.
  const expectedOrder = AVAILABILITY_GROUP_ORDER.filter(state => seen.includes(state));
  assert.deepEqual(seen, expectedOrder);
  assert.deepEqual(ACTIONABLE_GROUPS, ['buildable-now', 'researchable-now']);
  assert.deepEqual(ASPIRATIONAL_GROUPS, ['prereq-clear-but-unrolled', 'prereq-blocked']);
});

test('zero-cost options sort internally by improvement multiple', () => {
  const zeroCostRowHigh = {
    id: 'propulsion:warship:Drive_Orion',
    displayName: 'Orion Drive x1',
    isZeroCost: true,
    improvementMultiple: 5.14,
    rankState: RANK_STATES.noResearchRequired,
    closesDeficit: false,
    axisKind: AXIS_KINDS.measured,
    valuePerResearchPoint: null
  };
  const zeroCostRowLow = {
    id: 'military:weapon:Project_Laser',
    displayName: 'Heavy Laser',
    isZeroCost: true,
    improvementMultiple: 1.8,
    rankState: RANK_STATES.noResearchRequired,
    closesDeficit: false,
    axisKind: AXIS_KINDS.measured,
    valuePerResearchPoint: null
  };

  assert.ok(compareMilitaryRows(zeroCostRowHigh, zeroCostRowLow) < 0, 'higher improvement multiple must sort first');
  assert.ok(compareMilitaryRows(zeroCostRowLow, zeroCostRowHigh) > 0);
});

test('candidates report slot actionability based on dynamic free capacity', () => {
  const result = project(fleetScenario(SCENARIOS.deltaV));
  assert.ok(result.slots.available, 'slots must be available on live save');
  const free = result.slots.freeProjectSlots;
  assert.ok(typeof free === 'number', 'free project slots must be a number');

  for (const group of result.military.groups) {
    for (const item of group.items) {
      if (item.isZeroCost) {
        assert.equal(item.slotAction, 'no-slot-needed');
        assert.match(item.slotNote, /0 research cost/);
      } else if (item.availabilityState === 'researchable-now') {
        if (free > 0) {
          assert.equal(item.slotAction, 'free-slot');
          assert.match(item.slotNote, /free/);
        } else {
          assert.equal(item.slotAction, 'occupied-slot');
          assert.match(item.slotNote, /backlogging an active project/);
        }
      }
    }
  }
  for (const item of (result.military.procurement ? result.military.procurement.items : [])) {
    assert.equal(item.slotAction, 'no-slot-needed');
    assert.match(item.slotNote, /0 research cost/);
  }
});

test('a prereq-clear-but-unrolled candidate keeps its monthly chance and its cap', () => {
  const result = project(fleetScenario(SCENARIOS.deltaV), { detail: 'full' });
  const unrolled = groupOf(result, 'prereq-clear-but-unrolled');
  if (!unrolled || unrolled.items.length === 0) return; // the fixture may not produce one
  const row = unrolled.items.find(entry => entry.unlockChance);
  assert.ok(row, 'an unrolled candidate carries the roll that decides whether it ever appears');
  assert.ok(Number.isFinite(row.unlockChance.maxPercent), 'the cap is what says whether it can ever land');
});

test('groupByAvailability keeps unknown states rather than dropping them', () => {
  const rows = [
    { id: 'a', availabilityState: 'researchable-now', valuePerResearchPoint: 1, closesDeficit: false },
    { id: 'b', availabilityState: 'a-state-a-later-build-added', valuePerResearchPoint: 9, closesDeficit: false }
  ];
  const groups = groupByAvailability(rows, compareMilitaryRows);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].state, 'researchable-now');
  assert.equal(groups[1].state, 'a-state-a-later-build-added',
    'an unrecognised state is listed last, never silently discarded');
});

// ---------------------------------------------------------------------------
// UNRANKABLE IS A STATE, NOT A ZERO (spec section 7)
// ---------------------------------------------------------------------------

test('an unmeasurable candidate is carried in its own state, never scored zero', () => {
  assert.equal(militaryValuePerResearchPoint(null, 5000, 'researchable-now').state, RANK_STATES.notComparable);
  assert.equal(militaryValuePerResearchPoint(3, null, 'researchable-now').state, RANK_STATES.costUnmeasured);
  assert.equal(militaryValuePerResearchPoint(3, 0, 'completed').state, RANK_STATES.noResearchRequired);
  assert.equal(militaryValuePerResearchPoint(0.15, 5000, 'researchable-now').state, RANK_STATES.noImprovement);

  for (const multiple of [null, 3, 0.15]) {
    for (const cost of [null, 0, 5000]) {
      const scored = militaryValuePerResearchPoint(multiple, cost, 'researchable-now');
      if (scored.state === RANK_STATES.ranked) continue;
      assert.equal(scored.perResearchPoint, null,
        'an unrankable candidate never carries a number a sort could read as a real score');
      assert.ok(scored.reason && scored.reason.length > 0, 'and it always says why');
    }
  }
});

test('the census counts every unrankable candidate and the reasons are populated', () => {
  const result = project(fleetScenario(SCENARIOS.deltaV));
  const counts = result.military.unrankable.counts;
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  assert.equal(total, result.military.candidatesConsidered,
    'every candidate lands in exactly one state; a dropped one would be an invisible zero');
  assert.equal(counts[RANK_STATES.ranked], result.military.rankedCount);
  assert.ok(result.military.unrankable.reasons.length > 0, 'and each unrankable state names its reason');
  assert.ok(result.military.unrankableItems.length > 0, 'with the rows themselves listed, not only counted');
});

test('an economic candidate that priced nothing keeps phase 3 own reason', () => {
  const inert = economicRankRows({
    valuationState: 'inert',
    availability: { state: 'researchable-now', remainingResearchCost: 5000 },
    valuePerResearchPoint: { available: false, reason: 'nothing about this item could be priced', byUnit: [] }
  });
  assert.equal(inert.state, RANK_STATES.notComparable);
  assert.equal(inert.rows.length, 0);
  assert.match(inert.reason, /priced/);
});

// ---------------------------------------------------------------------------
// DIRECTION: A SAVING IS NOT A LOSS
// ---------------------------------------------------------------------------

test('a lower-is-better unit ranks the bigger saving first, not the smaller one', () => {
  // Mission-control contexts are `direction: lower`, so their priced delta is
  // NEGATIVE when the tech helps. Sorting the raw value descending puts the
  // smallest saving first -- the ranking silently inverted for one unit.
  const directions = new Map([['ShipMissionControlReduction', 'lower']]);
  const big = orientEconomicRow(
    { contexts: ['ShipMissionControlReduction'], perResearchPoint: -0.000333 }, directions);
  const small = orientEconomicRow(
    { contexts: ['ShipMissionControlReduction'], perResearchPoint: -0.000108 }, directions);

  assert.equal(big.direction, 'lower');
  assert.ok(big.orientedValuePerResearchPoint > small.orientedValuePerResearchPoint);

  const ordered = [
    { id: 'small', orientedValuePerResearchPoint: small.orientedValuePerResearchPoint },
    { id: 'big', orientedValuePerResearchPoint: big.orientedValuePerResearchPoint }
  ].sort(compareEconomicRows);
  assert.equal(ordered[0].id, 'big', 'the larger mission-control saving leads');
});

test('a row whose contexts disagree about direction is not ordered against ones that agree', () => {
  const directions = new Map([['MiningWaterBonus', 'higher'], ['ShipConstructionTime', 'lower']]);
  const mixed = orientEconomicRow(
    { contexts: ['MiningWaterBonus', 'ShipConstructionTime'], perResearchPoint: 5 }, directions);
  assert.equal(mixed.direction, 'mixed');
  assert.equal(mixed.orientedValuePerResearchPoint, null, 'guessing which way is good is the bug this prevents');
  assert.ok(mixed.reason.length > 0);

  const unknown = orientEconomicRow({ contexts: ['SomeContextWithNoMapping'], perResearchPoint: 5 }, directions);
  assert.equal(unknown.direction, 'unknown');
  assert.equal(unknown.orientedValuePerResearchPoint, null);
});

// ---------------------------------------------------------------------------
// TURN ONE (spec section 0)
// ---------------------------------------------------------------------------

test('a turn-1 save produces an empty-but-explained ranking rather than a crash or a blank', () => {
  for (const mode of ['player', 'omniscient']) {
    const result = project(turnOneSnapshot(mode), { mode });

    assert.equal(result.military.rankedCount, 0,
      'an observer who fields nothing has no baseline, so no military candidate can be compared');
    // On turn one the observer fields NOTHING, so every uncomparable candidate
    // is uncomparable for the same reason: there is no baseline at all. That is
    // `first-in-class`, not `not-comparable` -- the second is for a class that
    // HAS a baseline the item cannot be measured against.
    assert.ok(result.military.unrankable.counts[RANK_STATES.firstInClass] > 0,
      'those candidates are counted in their own state, not dropped');
    assert.equal(result.military.unrankable.counts[RANK_STATES.firstInClass],
      result.military.capabilitiesCount,
      'the census and the capabilities block count the same rows and must agree on how many');
    assert.ok(result.military.unrankable.reasons.length > 0, 'and the reason is stated');

    // The upstream phases still answered; the emptiness is about the campaign,
    // not about a missing catalogue. Those are opposite facts.
    assert.equal(result.sources.militaryValue.available, true);
    assert.equal(result.sources.economicValue.available, true);
    assert.match(result.sources.propulsion.note, /no hulls in service/);

    // No alien force is observable on turn one, and "cannot compare" is not
    // "no threat".
    assert.equal(result.deficit.canContest, 'unknown');
    assert.equal(result.ordering.deficitApplied, false);
    assert.match(result.deficit.reason, /could not be made/);

    // Economic value does NOT depend on a fielded baseline, so it still ranks.
    assert.ok(result.economic.rankedCount > 0, `economic value is still priceable on turn one (${mode})`);
  }
});

// ---------------------------------------------------------------------------
// MODE
// ---------------------------------------------------------------------------

test('both modes rank, and player mode names the basis its alien comparison rests on', () => {
  const scenario = SCENARIOS.deltaV;
  const player = project(fleetScenario(scenario, 'player'), { mode: 'player' });
  const omniscient = project(fleetScenario(scenario, 'omniscient'), { mode: 'omniscient' });

  for (const result of [player, omniscient]) {
    assert.equal(result.resource, 'research-ranking');
    assert.ok(result.military.rankedCount > 0, 'both modes produce a ranking');
  }
  assert.match(player.deficit.capability.basis, /player mode/);
  assert.match(player.deficit.capability.basis, /redacted/);
  assert.ok(!/redacted/.test(omniscient.deficit.capability.basis));
});

test('the same snapshot always yields the same ranking', () => {
  const scenario = SCENARIOS.deltaV;
  const first = project(fleetScenario(scenario));
  const second = project(fleetScenario(scenario));
  assert.deepEqual(
    first.military.groups.map(group => group.items.map(row => row.id)),
    second.military.groups.map(group => group.items.map(row => row.id)),
    'spec section 7: deterministic, same snapshot -> same ranking'
  );
});

// ---------------------------------------------------------------------------
// EVERY RECOMMENDATION CARRIES ITS EVIDENCE (spec section 8)
// ---------------------------------------------------------------------------

test('every ranked military row names its axis, its cost, its time and its gate', () => {
  const result = project(fleetScenario(SCENARIOS.deltaV), { detail: 'full' });
  let checked = 0;
  for (const group of result.military.groups) {
    for (const row of group.items) {
      assert.ok(row.axisLabel && row.axisLabel.length > 0, 'a multiple with no axis is not a usable claim');
      assert.ok(Number.isFinite(row.remainingResearchCost), 'a ranked row has a measured remaining cost');
      assert.ok(Number.isFinite(row.monthsAtCurrentIncome), 'and a time at the current research income');
      assert.ok(row.gateProjectId, 'and the project that unlocks it');
      checked += 1;
    }
  }
  assert.ok(checked > 0, 'the fixture actually produced rows to check');
});

test('a prerequisite-blocked row names the prerequisites that block it', () => {
  const result = project(fleetScenario(SCENARIOS.deltaV), { detail: 'full' });
  const blocked = groupOf(result, 'prereq-blocked');
  assert.ok(blocked && blocked.items.length > 0, 'the fixture has blocked candidates');
  const withChain = blocked.items.filter(row => Array.isArray(row.missingPrerequisites) && row.missingPrerequisites.length > 0);
  assert.ok(withChain.length > 0, 'spec section 8 requires the prerequisite chain beside the recommendation');
  for (const row of withChain) {
    for (const name of row.missingPrerequisites) {
      assert.equal(typeof name, 'string');
      assert.ok(name.length > 0, 'an unresolvable prerequisite name is dropped, never rendered as an empty string');
    }
  }
});

// ---------------------------------------------------------------------------
// THE PANEL
// ---------------------------------------------------------------------------

const repoRoot = path.resolve(__dirname, '..');
const v2ShellPath = path.join(repoRoot, 'public', 'v2', 'index.html');
const missionControlPath = path.join(repoRoot, 'public', 'v2', 'js', 'mission-control.js');

// The REAL escapeHtml and the entity-decoding `visibleText` now live in
// `tests/fixtures/renderHarness.js`, which executes the shipped
// `public/v2/js/shared.js` rather than copying it. Both defects the local
// copies here carried -- a sandbox whose escapeHtml did not escape, and a
// visibleText that did not decode -- are documented at the top of that file.
// `escapeHtml` is still the shipped one; `visibleText` is now applied to markup
// a real browser produced.
const { visibleText } = require('./fixtures/renderHarness');

// THE PANEL IS REACT NOW (2026-08-26). `public/v2/js/components/research-advisor.js`
// was deleted and `src/v2/panels/ResearchAdvisor.jsx` renders through the same
// `window.MissionControlResearchAdvisor` bridge mission-control.js already
// called. `node --test` cannot render a React component out of the Vite bundle,
// so every assertion below now reads markup produced by a real browser driving
// that bridge. Every assertion is unchanged; only the plumbing that produces
// `html` moved, and each renderer became async.
const {
  getResearchAdvisorHarnessPage,
  closeResearchAdvisorHarness,
  renderResearchAdvisorOnPage,
} = require('./fixtures/researchAdvisorBrowser');

// THE FLEET PANEL IS REACT NOW TOO (2026-08-26), on the same wave.
// `public/v2/js/components/fleet-procurement.js` was deleted and
// `src/v2/panels/FleetProcurement.jsx` renders through the same
// `window.MissionControlFleetProcurement` bridge. Two harnesses in one file
// again, but they no longer disagree about what the browser does: both ARE the
// browser.
const {
  getFleetProcurementHarnessPage,
  closeFleetProcurementHarness,
  renderFleetProcurementOnPage,
} = require('./fixtures/fleetProcurementBrowser');

after(async () => {
  await closeResearchAdvisorHarness();
  await closeFleetProcurementHarness();
});

async function renderToString(payload) {
  const page = await getResearchAdvisorHarnessPage();
  return renderResearchAdvisorOnPage(page, payload);
}

async function renderFleetToString(payload) {
  const page = await getFleetProcurementHarnessPage();
  return renderFleetProcurementOnPage(page, payload);
}

const FORBIDDEN = ['null', 'undefined', 'NaN', '[object Object]'];

function assertNoPlaceholderText(html, label) {
  const text = visibleText(html);
  for (const token of FORBIDDEN) {
    const index = text.indexOf(token);
    assert.strictEqual(index, -1,
      `${label}: rendered text contains "${token}" near: ${text.slice(Math.max(0, index - 60), index + 60)}`);
  }
}

// ---------------------------------------------------------------------------
// THE HARNESS ITSELF
//
// Every assertion below this line reads the panel through `visibleText`, so a
// harness that lies about what a reader sees weakens all of them at once. This
// test pins both halves against the case that exposed them -- a chain duration
// under a month, which the panel prints as "<1 mo" -- and, in its last third,
// reproduces the OLD harness to show what it silently dropped. Without that
// third part the test would pass just as happily on the broken version.
// ---------------------------------------------------------------------------

const { escapeHtml } = require('./fixtures/renderHarness');

/** A promoted chain whose whole-chain duration is under one month. */
const subMonthChainPayload = () => ({
  success: true,
  sources: {
    propulsion: { available: true }, militaryValue: { available: true }, economicValue: { available: true }
  },
  research: { monthlyResearchIncome: 4000 },
  ordering: { deficitApplied: false },
  deficit: { applied: false, capability: { canContest: 'unknown' } },
  military: {
    rankedCount: 1,
    candidatesConsidered: 1,
    unrankable: { counts: {}, reasons: [] },
    groups: [{
      state: 'researchable-now',
      label: 'Researchable now',
      actionable: true,
      count: 1,
      items: [{
        id: 'chain-row',
        displayName: 'Destination Hull',
        axisLabel: 'combat acceleration',
        improvementMultiple: 2,
        valuePerResearchPoint: 0.001,
        remainingResearchCost: 900,
        monthsAtCurrentIncome: 0.2,
        clearsFloor: true,
        availabilityState: 'researchable-now',
        chainPromoted: true,
        chain: {
          stepsCount: 2,
          totalRemainingCost: 900,
          monthsAtFullConcentration: 0.22,
          destinationDisplayName: 'Destination Hull',
          immediateNextStep: { displayName: 'First Step', cost: 400 }
        }
      }]
    }]
  },
  economic: { rankedCount: 0, candidatesConsidered: 0, unrankable: { counts: {}, reasons: [] }, units: [] }
});

/**
 * The panel's own markup with the escaping undone — what the pre-2026-08-22
 * sandbox produced, reconstructed.
 *
 * That sandbox was `{ window: {} }`, so the vanilla component fell back to its
 * own `value => String(value ?? '')`, which is not an escaper: the markup
 * carried a raw `<` where the panel now writes `&lt;`. The vanilla file was
 * deleted in the React migration, so the mechanism cannot be re-run — but the
 * DEFECT is exactly "the same panel output with the five entities decoded", and
 * that is reproducible from the real markup. Part 4 below still asks the same
 * question of it, with the same assertions.
 */
const UNESCAPE = [[/&lt;/g, '<'], [/&gt;/g, '>'], [/&quot;/g, '"'], [/&#0?39;/g, "'"], [/&amp;/g, '&']];

function withoutEscaping(html) {
  let markup = String(html);
  for (const [pattern, replacement] of UNESCAPE) markup = markup.replace(pattern, replacement);
  return markup;
}

test('the render harness reports what a browser shows, not the markup, for a sub-month duration', async () => {
  // 1. The escaper is the shipped one and it actually escapes.
  assert.equal(escapeHtml('<1 mo'), '&lt;1 mo');
  assert.equal(escapeHtml('Ceres & Vesta'), 'Ceres &amp; Vesta');
  assert.equal(escapeHtml(null), '', 'a null must not reach the page as the word "null"');

  // 2. `visibleText` decodes, so the entity is reported as the character.
  assert.equal(visibleText('<div class="ra-row">&lt;1 mo</div>'), '<1 mo');
  assert.equal(visibleText('<span>Ceres &amp; Vesta</span>'), 'Ceres & Vesta');
  assert.equal(visibleText('<span>&amp;lt;1 mo</span>'), '&lt;1 mo',
    'a literal ampersand-escape decodes once, not twice');
  assert.equal(visibleText('<span title="hidden prose">shown</span>'), 'shown',
    'and a tooltip is still not counted as visible copy');

  // 3. End to end through the real panel: the duration survives.
  const html = await renderToString(subMonthChainPayload());
  assert.ok(html.includes('&lt;1 mo'), 'the panel escapes the "<" before it reaches the page');
  const text = visibleText(html);
  assert.ok(text.includes('900 pts · <1 mo'),
    `the whole-chain cost and its sub-month duration must both be visible; got: ${text}`);

  // 4. What the OLD harness did with the same payload. The unescaped "<"
  //    opened what the tag-stripper read as a tag and `<1 mo</span>` was
  //    removed whole, so the duration vanished from "what a reader sees" and
  //    the next fragment closed the gap. This assertion is the proof that
  //    parts 1-3 are testing something real rather than passing by luck.
  const brokenText = visibleText(withoutEscaping(html));
  assert.ok(!brokenText.includes('<1 mo'),
    'the pre-2026-08-22 sandbox is expected to LOSE the duration — if it no longer does, '
    + 'the component stopped escaping and this whole harness argument needs revisiting');
  assert.ok(brokenText.includes('900 pts'),
    'and it loses only the duration, which is exactly why nobody noticed');
});

test('the panel is mounted in the COMMAND view and loaded by the shell', () => {
  const html = fs.readFileSync(v2ShellPath, 'utf8');
  const missionControl = fs.readFileSync(missionControlPath, 'utf8');
  const commandPanel = fs.readFileSync(
    path.join(repoRoot, 'src', 'v2', 'panels', 'CommandPanel.jsx'),
    'utf8',
  );

  assert.ok(commandPanel.includes('id="researchAdvisor"'), 'the mount element must exist');
  // Flipped by the React migration (2026-08-26), following the precedent
  // tests/miningBoardRendering.test.js:48 set: the vanilla component is deleted,
  // so its <script> tag must be GONE and the bundle that now supplies
  // `window.MissionControlResearchAdvisor` must be loaded instead. The
  // mission-control.js control below proves the missing-script assertion is not
  // vacuously true — it names the shell itself, which outlives every component.
  assert.ok(!html.includes('/v2/js/components/research-advisor.js'),
    'the deleted classic research advisor must not be loaded');
  assert.ok(html.includes('/v2/js/mission-control.js'),
    'the shell controller is loaded, so a missing-script assertion is meaningful');
  assert.ok(html.includes('/v2/app/bundle.js'),
    'a component with no <script> tag renders nowhere — the React bundle is that tag now');
  assert.ok(html.includes('id="commandPlanner"'),
    'the COMMAND React shell mount must exist in index.html');
  assert.ok(commandPanel.includes('id="researchAdvisor"'),
    'the panel must live inside the view its registry entry claims');

  assert.ok(/panels: \[[\s\S]*?'researchAdvisor'[\s\S]*?\]/.test(missionControl),
    'the view registry must list the panel, so assertViewRegistryIntegrity covers it');
  assert.ok(missionControl.includes('MissionControlResearchAdvisor'),
    'and the render dispatch must actually call it');
});

test('a payload whose every measurement is absent renders honest dashes, never "null"', async () => {
  // Deliberately hostile: this is the shape phases 1-3 produce on a snapshot
  // where nothing could be measured. Every one of these nulls is intentional
  // upstream and would print as the word "null" through a raw interpolation.
  const html = await renderToString({
    success: true,
    sources: {
      propulsion: { available: true, reason: null, designsInService: null, note: null },
      militaryValue: { available: true, reason: null, comparisonClasses: null },
      economicValue: { available: true, reason: null, candidatesConsidered: null }
    },
    research: { monthlyResearchIncome: null },
    ordering: { deficitApplied: false },
    deficit: { applied: false, axisLabel: null, ratio: null, own: null, alien: null, unit: null,
      remedyKind: null, reason: null, capability: { canContest: 'unknown', verdictReason: null } },
    military: {
      rankedCount: null,
      candidatesConsidered: null,
      unrankable: { counts: {}, reasons: [] },
      groups: [{
        state: 'researchable-now', label: 'Researchable now', actionable: true, count: null,
        items: [{
          id: 'x', displayName: 'Nameless Candidate', axisLabel: null, axisBasis: null,
          improvementMultiple: null, valuePerResearchPoint: null, remainingResearchCost: null,
          monthsAtCurrentIncome: null, unlockChance: null, clearsFloor: null, gateProjectId: null,
          gateProjectName: null, availabilityState: 'researchable-now', context: null
        }]
      }]
    },
    economic: {
      rankedCount: null,
      candidatesConsidered: null,
      unrankable: { counts: {}, reasons: [] },
      units: [{
        unit: 'tonnes/month',
        count: null,
        groups: [{
          state: 'researchable-now', label: 'Researchable now', actionable: true, count: null,
          items: [{
            id: 'y', displayName: 'Unpriced Project', unit: 'tonnes/month', monthlyValue: null,
            remainingResearchCost: null, monthsAtCurrentIncome: null, unlockChance: null,
            largestPricedEffect: null, availabilityState: 'researchable-now'
          }]
        }]
      }]
    }
  });
  assertNoPlaceholderText(html, 'all-null payload');
  assert.ok(html.includes('—'), 'an absent measurement renders as the unavailable dash');
});

test('a turn-1 payload renders the reason it is empty rather than an empty box', async () => {
  const payload = project(turnOneSnapshot('player'));
  const html = await renderToString(payload);
  assertNoPlaceholderText(html, 'turn-1 payload');
  const text = visibleText(html);
  assert.match(text, /no baseline to|no hulls|Nothing can be ranked/i,
    'an empty military ranking must say why it is empty');
  assert.match(text, /ranked/, 'and the census still reports what was considered');
});

test('the live-shaped payload renders both tracks with no forbidden token', async () => {
  for (const mode of ['player', 'omniscient']) {
    const payload = project(fleetScenario(SCENARIOS.deltaV, mode), { mode });
    const html = await renderToString(payload);
    assertNoPlaceholderText(html, `${mode} payload`);
    const text = visibleText(html);
    assert.match(text, /MILITARY/);
    assert.match(text, /ECONOMIC/);
  }
});

test('the monthly unlock roll is shown only where a roll is still pending', async () => {
  const base = {
    id: 'x', displayName: 'Candidate', axisLabel: 'combat acceleration', improvementMultiple: 2,
    valuePerResearchPoint: 0.001, remainingResearchCost: 1000, monthsAtCurrentIncome: 2,
    unlockChance: { initialPercent: 5, deltaPercentPerMonth: 5, maxPercent: 50, certain: false },
    clearsFloor: true, gateProjectId: 'Project_X', gateProjectName: 'X', context: null
  };
  const shell = (state, label) => ({
    success: true,
    sources: {
      propulsion: { available: true }, militaryValue: { available: true }, economicValue: { available: true }
    },
    research: { monthlyResearchIncome: 100 },
    ordering: { deficitApplied: false },
    deficit: { applied: false, capability: { canContest: 'unknown' } },
    military: {
      rankedCount: 1, candidatesConsidered: 1, unrankable: { counts: {}, reasons: [] },
      groups: [{ state, label, actionable: true, count: 1, items: [{ ...base, availabilityState: state }] }]
    },
    economic: { rankedCount: 0, candidatesConsidered: 0, unrankable: { counts: {}, reasons: [] }, units: [] }
  });

  const rolling = visibleText(await renderToString(shell('prereq-clear-but-unrolled', 'Not yet available')));
  assert.match(rolling, /rolls 5%\/mo, cap 50%/, 'a pending roll and its cap are the whole proposition');
  assert.match(rolling, /may never land/, 'a cap below 100% may never land, and the player is entitled to know');

  const available = visibleText(await renderToString(shell('researchable-now', 'Researchable now')));
  assert.ok(!/rolls /.test(available),
    'a researchable-now candidate has already rolled; printing its odds describes a dice throw that is over');
});

test('a payload with no valuation inputs renders unavailable rather than an empty ranking', async () => {
  const html = await renderToString({
    success: true,
    sources: {
      propulsion: { available: false, reason: 'driveStats is not present' },
      militaryValue: { available: false, reason: 'componentStats is not present' },
      economicValue: { available: false, reason: 'effectIndex is not present' }
    },
    research: {}, ordering: {}, deficit: {},
    military: { groups: [], unrankable: { counts: {} } },
    economic: { units: [], unrankable: { counts: {} } }
  });
  assertNoPlaceholderText(html, 'no-inputs payload');
  assert.match(visibleText(html), /UNAVAILABLE/);
  assert.match(visibleText(html), /Re-publish/);
});

// ---------------------------------------------------------------------------
// AXIS KIND: A RULE VALUE IS NOT A CAPABILITY AXIS
//
// Utility and hab modules carry ONE `specialModuleValue` shared across every
// rule they carry, and the templates name no quantity for it. A ratio of two
// such scalars has no unit, so it must not displace a ratio of two figures in
// GW/t. Measured on the live save before this gate: the top military row in
// both modes read "Cyclotron 40.0x RadHardened (rule value)", above a 3.00x
// reactor improvement.
// ---------------------------------------------------------------------------

const militaryRowStub = (overrides = {}) => ({
  id: 'row',
  closesDeficit: false,
  axisKind: AXIS_KINDS.measured,
  valuePerResearchPoint: 1,
  ruleGroupSize: null,
  ...overrides
});

test('a unitless rule value never outranks a measured axis, however big the number', () => {
  const ruleScalar = militaryRowStub({ id: 'a-rule', axisKind: AXIS_KINDS.ruleScalar, valuePerResearchPoint: 0.0078 });
  const measured = militaryRowStub({ id: 'z-measured', axisKind: AXIS_KINDS.measured, valuePerResearchPoint: 0.0008 });
  // The live save's exact pairing: 40x on a rule tag scoring 0.0078 per point
  // against 3.00x in GW/t scoring 0.0008. Value alone would put the rule first.
  assert.ok(ruleScalar.valuePerResearchPoint > measured.valuePerResearchPoint,
    'the rule row must genuinely score higher, or the test proves nothing');
  assert.ok(compareMilitaryRows(ruleScalar, measured) > 0, 'the measured axis leads');
  assert.ok(compareMilitaryRows(measured, ruleScalar) < 0, 'and the comparator is antisymmetric about it');
});

test('but the measured deficit still outranks the axis kind', () => {
  // EVMultiplier modules are rule-scalar rows AND the only non-drive unlocks
  // that move delta-V. A delta-V-deficit save must still be able to lead with
  // one, or section 3's requirement and this demotion contradict each other.
  const deficitRule = militaryRowStub({
    id: 'ev', axisKind: AXIS_KINDS.ruleScalar, closesDeficit: true, valuePerResearchPoint: 0.0001
  });
  const measured = militaryRowStub({ id: 'other', axisKind: AXIS_KINDS.measured, valuePerResearchPoint: 5 });
  assert.ok(compareMilitaryRows(deficitRule, measured) < 0);
});

test('an unknown axis kind sorts last rather than sorting as a measured one', () => {
  const unknown = militaryRowStub({ id: 'q', axisKind: 'something-added-later', valuePerResearchPoint: 99 });
  const ruleScalar = militaryRowStub({ id: 'r', axisKind: AXIS_KINDS.ruleScalar, valuePerResearchPoint: 0.1 });
  assert.equal(axisKindRank('something-added-later'), 2);
  assert.ok(compareMilitaryRows(unknown, ruleScalar) > 0);
});

test('a tied row is labelled by the most specific rule it carries, not the broadest tag', () => {
  // One module appears once per rule, so the same item/gate/number arrives under
  // several names and the dedupe keeps whichever sorts first. `RadHardened` is
  // carried by 17 of 57 utility modules and says nothing; `ParticleBeamPowerBonus`
  // is carried by one and says what the number is.
  const broad = militaryRowStub({ id: 'a', axisKind: AXIS_KINDS.ruleScalar, ruleGroupSize: 17 });
  const specific = militaryRowStub({ id: 'z', axisKind: AXIS_KINDS.ruleScalar, ruleGroupSize: 1 });
  assert.ok(compareMilitaryRows(specific, broad) < 0, 'the specific rule wins despite sorting later by id');
  // And it is inert where there is no rule group at all, rather than treating
  // "not a rule row" as a group of size zero.
  const measuredA = militaryRowStub({ id: 'a', ruleGroupSize: null });
  const measuredZ = militaryRowStub({ id: 'z', ruleGroupSize: null });
  assert.ok(compareMilitaryRows(measuredZ, measuredA) > 0, 'non-rule rows still fall back to id');
});

test('inside every group, no unitless row precedes a measured one unless it closes the gap', () => {
  for (const mode of ['player', 'omniscient']) {
    const result = project(fleetScenario(SCENARIOS.deltaV, mode), { mode, detail: 'full' });
    for (const group of result.military.groups) {
      let seenRuleScalar = false;
      for (const row of group.items) {
        assert.ok(['measured', 'rule-scalar'].includes(row.axisKind),
          `${row.id}: every military row must declare an axis kind`);
        if (row.axisKind === 'rule-scalar' && !row.closesDeficit) seenRuleScalar = true;
        else if (row.axisKind === 'measured' && !row.closesDeficit) {
          assert.equal(seenRuleScalar, false,
            `${mode}/${group.state}: ${row.id} names a measured axis but sits below a unitless one`);
        }
      }
    }
  }
});

test('a rule row that cannot be compared is carried with its reason, never dropped or scored', () => {
  const result = project(fleetScenario(SCENARIOS.deltaV, 'player'), { detail: 'full' });
  const ruleRows = [
    ...result.military.groups.flatMap(group => group.items),
    ...result.military.unrankableItems
  ].filter(row => row.source === 'military-value-rule');
  assert.ok(ruleRows.length > 0, 'the fixture must produce rule rows, or this test is vacuous');
  for (const row of ruleRows) {
    if (row.rankState === RANK_STATES.ranked) {
      assert.notEqual(row.improvementMultiple, null);
      // A ranked rule row names the module it was actually measured against.
      assert.ok(row.context.baselineDisplayName, `${row.id}: a ranked rule row must name its baseline`);
    } else {
      assert.equal(row.valuePerResearchPoint, null, `${row.id}: never scored`);
      assert.ok(row.rankReason, `${row.id}: and never silent about why`);
    }
    assert.match(row.axisBasis, /identical rule set/,
      'every rule row must state the comparison rule it was formed under');
  }
});

test('a unitless row is badged as such on the card, and a measured one is not', async () => {
  const row = (overrides) => ({
    id: 'r', displayName: 'A Module', axisLabel: 'Farm (rule value)', axisBasis: 'basis',
    improvementMultiple: 5, valuePerResearchPoint: 0.0008, remainingResearchCost: 5000,
    monthsAtCurrentIncome: 1.6, unlockChance: null, clearsFloor: null, gateProjectId: null,
    gateProjectName: null, availabilityState: 'researchable-now', context: null, closesDeficit: false,
    ...overrides
  });
  const payload = (axisKind) => ({
    success: true,
    sources: { propulsion: { available: true }, militaryValue: { available: true }, economicValue: { available: true } },
    research: { monthlyResearchIncome: 3150 },
    ordering: { deficitApplied: false },
    deficit: { applied: false, capability: { canContest: 'unknown' } },
    military: {
      rankedCount: 1, candidatesConsidered: 1, unrankable: { counts: {} },
      groups: [{ state: 'researchable-now', label: 'Researchable now', actionable: true, count: 1,
        items: [row({ axisKind })] }]
    },
    economic: { rankedCount: 0, candidatesConsidered: 0, unrankable: { counts: {} }, units: [] }
  });

  const unitless = await renderToString(payload('rule-scalar'));
  assert.match(unitless, /ra-tag--unitless/);
  assert.match(visibleText(unitless), /no unit/);
  assert.match(unitless, /no engineering axis/, 'the badge must carry its explanation as a tooltip');
  assertNoPlaceholderText(unitless, 'rule-scalar row');

  const measured = await renderToString(payload('measured'));
  assert.ok(!/ra-tag--unitless/.test(measured), 'a measured axis carries no badge');
});

// ---------------------------------------------------------------------------
// PHASE 5 -- THE DELIVERY FLOOR IN THE ORDERING AND ON THE CARD
// ---------------------------------------------------------------------------

test('the ordering declares the delivery term, in the position that makes it a floor', () => {
  const result = project(fleetScenario(SCENARIOS.armour));
  // The value key is named `chainValuePerResearchPoint` since chains were
  // promoted: the comparator prices the WHOLE remaining chain, which is the same
  // number as the gate's own on every single-step row and a different one on a
  // row standing several projects away.
  assert.deepEqual(result.ordering.militaryKeys,
    ['closesDeficit', 'axisKind', 'deliveryFloor', 'chainValuePerResearchPoint', 'id']);
  // AFTER axisKind, so a named engineering unit that fails delivery still
  // outranks a unitless rule scalar; BEFORE value, because that is the whole
  // point of a floor.
  const keys = result.ordering.militaryKeys;
  assert.ok(keys.indexOf('deliveryFloor') > keys.indexOf('axisKind'));
  assert.ok(keys.indexOf('deliveryFloor') < keys.indexOf('chainValuePerResearchPoint'));
  assert.ok(keys.indexOf('closesDeficit') < keys.indexOf('deliveryFloor'));
  assert.ok(result.military.deliveryCaveat && result.military.deliveryCaveat.length > 0);
  assert.match(result.military.deliveryCaveat, /Only a MEASURED failure demotes/);
  assert.match(result.military.orderedBy, /delivery floor/);
});

test('a munition that fails delivery is demoted, announced, and never silently dropped', () => {
  const result = project(fleetScenario(SCENARIOS.armour), { detail: 'full' });

  const demoted = result.military.deliveryDemoted;
  assert.ok(demoted, 'a response with offensive weapon classes must carry the demotion census');
  assert.ok(demoted.count > 0, 'this fixture demotes something, or the rest of this test is vacuous');
  // Truncation announces itself, in both places it happens.
  assert.equal(typeof demoted.itemsShown, 'number');
  assert.equal(typeof demoted.itemsOmittedCount, 'number');
  assert.equal(demoted.itemsTotalCount, demoted.count);
  assert.equal(demoted.items.length, demoted.itemsShown);

  const lead = demoted.items[0];
  assert.equal(lead.id, 'AntimatterTorpedoLauncher',
    'the highest-damage demoted row leads, because it is the one the reader would otherwise have seen first');
  assert.ok(lead.multipleOfFloor > 1, 'it absorbs measurably more fire per arriving round than the floor');
  assert.ok(lead.floorBaselineDisplayName, 'and it names what it was measured against');
  assert.notEqual(lead.shotsPerArrivingRound, null);

  // The row is demoted, not deleted: it still carries its damage figure.
  assert.ok(lead.rankValue > 0);

  // The environment the whole comparison rests on travels with the response.
  const environment = result.sources.militaryValue.deliveryEnvironment;
  assert.ok(environment);
  assert.equal(environment.available, true);
  assert.equal(environment.selected, 'observed-opposing');
  assert.ok(environment.hullsRead > 0);
  assert.equal(environment.validatedAgainstGameOutput, false);
});

test('a beam candidate carries a null delivery verdict with its own reason, never a pass', () => {
  const result = project(fleetScenario(SCENARIOS.armour), { detail: 'full' });
  // Ranked rows AND unrankable ones: a beam candidate that beats nothing the
  // observer fields is carried in the unrankable bucket, and its delivery
  // verdict has to be honest there too.
  const rows = [...result.military.groups.flatMap(group => group.items), ...result.military.unrankableItems]
    .filter(row => row.source === 'military-value'
      && ['laser_weapon:offensive', 'particle_weapon:offensive', 'plasma_weapon:offensive'].includes(row.classKey));
  assert.ok(rows.length >= 3, 'the fixture must offer beam candidates from all three families, or this test is vacuous');
  for (const row of rows) {
    assert.equal(row.clearsDeliveryFloor, null, `${row.id}: a beam has no delivery verdict`);
    assert.notEqual(row.clearsDeliveryFloor, true, 'unknown must never read as clearing');
    assert.match(row.deliveryFloorReason, /not point-defence targetable/);
    assert.equal(row.context.delivery, null, 'and it carries no delivery context to render');
  }
});

/**
 * A campaign where the only missile on offer is the one that arrives alone.
 *
 * The class-level floor normally hands `bestByState` to a better-delivering
 * sibling, so the failing row never reaches the ranking at all. Narrowing the
 * available-project list to the torpedo forces it through, which is what makes
 * this an END-TO-END check of the comparator wiring rather than a unit test of
 * the comparator.
 *
 * `SCENARIOS.hulls` is used deliberately: its deficit remedy is production
 * rather than research, so nothing is promoted and the ordering is purely
 * value-per-point against the delivery floor.
 */
function torpedoOnlySnapshot(mode = 'player') {
  const snapshot = fleetScenario(SCENARIOS.hulls, mode);
  const offered = ['Project_AntimatterTorpedoLauncher', 'Project_NanotubeArmor'];
  for (const faction of snapshot.factions) {
    faction.availableProjectNames = faction.ID === OBSERVER ? [...offered] : [];
    faction.availableProjectsCount = faction.ID === OBSERVER ? offered.length : 0;
  }
  if (snapshot.techTree) {
    snapshot.techTree.factionStatus = Object.fromEntries(
      Object.keys(snapshot.techTree.factionStatus || {}).map(id => [id, {
        completedProjects: [],
        availableProjectNames: Number(id) === OBSERVER ? [...offered] : [],
        currentProjects: []
      }])
    );
  }
  return snapshot;
}

test('a failing munition is ordered behind a clearing row IN THE PAYLOAD, not just in the comparator', () => {
  const result = project(torpedoOnlySnapshot(), { detail: 'full' });
  assert.equal(result.ordering.deficitApplied, false,
    'this scenario\'s remedy is production, so nothing is promoted and the ordering is purely value against the floor');

  const now = groupOf(result, 'researchable-now');
  assert.ok(now && now.items.length > 1, 'the fixture must offer more than one researchable candidate');

  const torpedo = now.items.find(row => row.itemId === 'AntimatterTorpedoLauncher');
  assert.ok(torpedo, 'the narrowed project list must put the torpedo in the ranking');
  assert.equal(torpedo.clearsDeliveryFloor, false, 'and it must be the row that fails delivery');

  const position = now.items.indexOf(torpedo);
  assert.ok(position > 0, 'a row that fails delivery must not lead its group');

  // ...and it leads on value by an enormous margin, so its position cannot be
  // an accident of scoring.
  const ahead = now.items.slice(0, position);
  assert.ok(ahead.length > 0);
  for (const row of ahead) {
    assert.notEqual(row.clearsDeliveryFloor, false,
      'nothing ordered ahead of it may itself be a measured delivery failure');
    assert.ok(torpedo.valuePerResearchPoint > row.valuePerResearchPoint * 100,
      `${row.displayName} outranks a candidate scoring ${torpedo.valuePerResearchPoint} per point purely on the delivery floor`);
  }

  // The census names it, so the demotion is visible rather than silent.
  const named = (result.military.deliveryDemoted.items || [])
    .some(item => item.id === 'AntimatterTorpedoLauncher');
  assert.ok(named, 'the row the floor moved must be named in the census');
});

test('the delivery badges and the demotion line render, and neither prints a null', async () => {
  const weaponRow = (overrides) => ({
    id: 'r', displayName: 'A Weapon', axisLabel: 'sustained output per hardpoint (MW)', axisBasis: 'basis',
    axisKind: 'measured', improvementMultiple: 6687502.98, valuePerResearchPoint: 334.375,
    remainingResearchCost: 20000, monthsAtCurrentIncome: 6.3, unlockChance: null, clearsFloor: true,
    gateProjectId: null, gateProjectName: null, availabilityState: 'researchable-now',
    closesDeficit: false, clearsDeliveryFloor: null, context: null, ...overrides
  });
  const payload = (row, deliveryDemoted) => ({
    success: true,
    sources: { propulsion: { available: true }, militaryValue: { available: true }, economicValue: { available: true } },
    research: { monthlyResearchIncome: 3150 },
    ordering: { deficitApplied: false },
    deficit: { applied: false, capability: { canContest: 'unknown' } },
    military: {
      rankedCount: 1, candidatesConsidered: 1, unrankable: { counts: {} }, deliveryDemoted,
      groups: [{ state: 'researchable-now', label: 'Researchable now', actionable: true, count: 1, items: [row] }]
    },
    economic: { rankedCount: 0, candidatesConsidered: 0, unrankable: { counts: {} }, units: [] }
  });

  const fails = await renderToString(payload(weaponRow({ clearsDeliveryFloor: false }), null));
  assert.match(visibleText(fails), /fails delivery/);
  assert.match(fails, /ra-tag--warn/);
  assert.match(fails, /decides whether the damage lands/, 'the badge carries its explanation as a tooltip');
  assertNoPlaceholderText(fails, 'fails-delivery row');

  // Unknown gets its OWN badge, visibly distinct from the failure one, because
  // an unevaluated floor must never read as a cleared one.
  const unknown = await renderToString(payload(weaponRow({
    clearsDeliveryFloor: null,
    context: { delivery: { shotsPerArrivingRound: null, floorValue: null, multipleOfFloor: null } }
  }), null));
  assert.match(visibleText(unknown), /delivery unchecked/);
  assert.match(unknown, /This is not a pass/);
  assert.ok(!/fails delivery/.test(visibleText(unknown)));
  assertNoPlaceholderText(unknown, 'delivery-unchecked row');

  // A row with no delivery context at all gets no badge: a reactor has no
  // delivery axis, and badging it would invent one.
  const silent = await renderToString(payload(weaponRow({ clearsDeliveryFloor: null, context: null }), null));
  assert.ok(!/delivery unchecked/.test(visibleText(silent)));
  assert.ok(!/fails delivery/.test(visibleText(silent)));

  // The census line: one line, naming the leader and the multiple.
  const withCensus = await renderToString(payload(weaponRow({ clearsDeliveryFloor: false }), {
    count: 1,
    itemsShown: 1,
    itemsOmittedCount: 0,
    items: [{
      id: 'AntimatterTorpedoLauncher',
      displayName: 'Antimatter Torpedo Launcher',
      shotsPerArrivingRound: 14.278211,
      floorValue: 3.943211,
      floorBaselineDisplayName: 'Copperhead Missile Bay',
      multipleOfFloor: 3.62096
    }]
  }));
  const text = visibleText(withCensus);
  assert.match(text, /1 ranked below its damage/);
  assert.match(text, /Antimatter Torpedo Launcher/);
  assert.match(text, /3\.62/);
  assert.match(text, /Copperhead Missile Bay/);
  assertNoPlaceholderText(withCensus, 'delivery census line');

  // An all-null demoted row still renders the em dash, never the word null.
  const hostile = await renderToString(payload(weaponRow({ clearsDeliveryFloor: false }), {
    count: 2,
    itemsShown: 1,
    itemsOmittedCount: 1,
    items: [{ id: 'x', displayName: 'Nameless Round', shotsPerArrivingRound: null,
      floorValue: null, floorBaselineDisplayName: null, multipleOfFloor: null }]
  }));
  assertNoPlaceholderText(hostile, 'all-null demoted row');
  assert.match(visibleText(hostile), /2 ranked below their damage/);
  assert.match(hostile, /—/);

  // Nothing demoted costs no height at all: the COMMAND column has none spare.
  const clean = await renderToString(payload(weaponRow({ clearsDeliveryFloor: true }),
    { count: 0, itemsShown: 0, itemsOmittedCount: 0, items: [] }));
  assert.ok(!/ranked below/.test(visibleText(clean)));
  const absent = await renderToString(payload(weaponRow({ clearsDeliveryFloor: true }), null));
  assert.ok(!/ranked below/.test(visibleText(absent)));
});

test('the live-shaped payload renders the delivery figures with no forbidden token, in both modes', async () => {
  for (const mode of ['player', 'omniscient']) {
    const payload = project(fleetScenario(SCENARIOS.armour, mode), { mode });
    const html = await renderToString(payload);
    assertNoPlaceholderText(html, `${mode} delivery payload`);
    assert.ok(payload.military.deliveryDemoted, `${mode}: the census must reach the panel`);
  }
});

// ---------------------------------------------------------------------------
// PROJECT NAME VISIBILITY, ZERO-COST ROWS, AND ALSO-UNLOCKS BADGES
// Spec: docs/research-row-naming-spec.md
// ---------------------------------------------------------------------------

test('research rows display the project name as visible lead text and parenthesise unlock item when different', async () => {
  const payload = {
    success: true,
    sources: { propulsion: { available: true }, militaryValue: { available: true }, economicValue: { available: true } },
    research: { monthlyResearchIncome: 1000 },
    ordering: { deficitApplied: false },
    deficit: { applied: false, capability: { canContest: 'unknown' } },
    military: {
      rankedCount: 2, candidatesConsidered: 2, unrankable: { counts: {} },
      groups: [{
        state: 'researchable-now', label: 'Researchable now', actionable: true, count: 2,
        items: [
          {
            id: 'missile', displayName: 'Copperhead Missile Pod',
            gateProjectId: 'Project_CopperheadMissileBay', gateProjectName: 'Hydrolox High Explosive Missiles',
            axisLabel: 'sustained output per hardpoint', improvementMultiple: 3, valuePerResearchPoint: 0.001,
            remainingResearchCost: 2500, monthsAtCurrentIncome: 2.5, isZeroCost: false,
            availabilityState: 'researchable-now', context: null
          },
          {
            id: 'hull', displayName: 'Dreadnought',
            gateProjectId: 'Project_ShipsoftheLine', gateProjectName: 'Ships of the Line',
            axisLabel: 'throw weight', improvementMultiple: 2.07, valuePerResearchPoint: 0.0005,
            remainingResearchCost: 5000, monthsAtCurrentIncome: 5, isZeroCost: false,
            availabilityState: 'researchable-now', context: null
          }
        ]
      }]
    },
    economic: { rankedCount: 0, candidatesConsidered: 0, unrankable: { counts: {} }, units: [] }
  };

  const html = await renderToString(payload);
  assertNoPlaceholderText(html, 'project naming payload');
  const text = visibleText(html);

  // Both project names must be visible text (not merely tooltips).
  assert.ok(text.includes('Hydrolox High Explosive Missiles (Copperhead Missile Pod)'),
    'project name must lead with unlock item parenthesised');
  assert.ok(text.includes('Ships of the Line (Dreadnought)'),
    'project name Ships of the Line must be visible on screen');
  assert.match(html, /ra-row__sub/, 'item name uses subdued styling span');
});

test('zero-cost rows do not render in research-advisor and render in fleet-procurement', async () => {
  const payload = {
    success: true,
    sources: { propulsion: { available: true }, militaryValue: { available: true }, economicValue: { available: true } },
    research: { monthlyResearchIncome: 1000 },
    ordering: { deficitApplied: false },
    deficit: { applied: false, capability: { canContest: 'unknown' } },
    military: {
      rankedCount: 0, candidatesConsidered: 1, procurementCount: 1, unrankable: { counts: {} },
      procurement: {
        label: 'Already unlocked, not in service', count: 1, itemsShown: 1,
        items: [
          {
            id: 'dreadnought-zero', displayName: 'Dreadnought',
            gateProjectId: 'Project_ShipsoftheLine', gateProjectName: 'Ships of the Line',
            axisLabel: 'throw weight', improvementMultiple: 2.07, isZeroCost: true,
            action: 'build', remainingResearchCost: 0, monthsAtCurrentIncome: 0,
            availabilityState: 'buildable-now', context: { family: 'ship_hull' }
          }
        ]
      },
      groups: []
    },
    economic: { rankedCount: 0, candidatesConsidered: 0, unrankable: { counts: {} }, units: [] }
  };

  // 1. Research advisor must contain no procurement block and no zero-cost rows
  const advisorHtml = await renderToString(payload);
  assertNoPlaceholderText(advisorHtml, 'research advisor zero-cost payload');
  assert.ok(!advisorHtml.includes('ra-procurement'), 'research advisor must not render .ra-procurement');
  assert.ok(!advisorHtml.includes('Dreadnought'), 'research advisor must not contain zero-cost items');

  // 2. Fleet procurement component renders the block
  const fleetHtml = await renderFleetToString(payload);
  assertNoPlaceholderText(fleetHtml, 'fleet procurement payload');
  const fleetText = visibleText(fleetHtml);

  assert.ok(fleetText.includes('Dreadnought'), 'fleet procurement shows item name');
  assert.ok(!fleetText.includes('Ships of the Line (Dreadnought)'), 'project name is not leading on zero-cost row');
  assert.ok(!fleetText.includes('0 pts'), 'zero-cost row does not state 0 pts');
  assert.ok(fleetText.includes('build'), 'zero-cost hull row states build');
  assert.match(fleetText, /1 unfielded/i, 'procurement header states unfielded count');
  assert.match(fleetHtml, /title="Dreadnought — unlocked by Ships of the Line \(completed\)"/, 'project name is in tooltip');
});

test('fleet procurement is mounted in FLEET view and loaded by the shell', () => {
  const html = fs.readFileSync(v2ShellPath, 'utf8');
  const missionControl = fs.readFileSync(missionControlPath, 'utf8');

  assert.ok(html.includes('id="fleetProcurement"'), 'the mount element must exist');
  // Flipped by the React migration (2026-08-26), following the same precedent as
  // the research advisor twelve tests above: the vanilla component is deleted, so
  // its <script> tag must be GONE and the bundle that now supplies
  // `window.MissionControlFleetProcurement` must be loaded instead. The
  // mission-control.js control below proves the missing-script assertion is not
  // vacuously true — it names the shell itself, which outlives every component.
  assert.ok(!html.includes('/v2/js/components/fleet-procurement.js'),
    'the deleted classic fleet procurement panel must not be loaded');
  assert.ok(html.includes('/v2/js/mission-control.js'),
    'the shell controller is loaded, so a missing-script assertion is meaningful');
  assert.ok(html.includes('/v2/app/bundle.js'),
    'a component with no <script> tag renders nowhere — the React bundle is that tag now');

  const fleet = html.match(/<section[^>]*id="view-fleet"[\s\S]*?<\/section>/);
  assert.ok(fleet, '#view-fleet must exist');
  assert.ok(fleet[0].includes('id="fleetProcurement"'),
    'the panel must live inside the view its registry entry claims');

  assert.ok(/panels: \[[\s\S]*?'fleetProcurement'[\s\S]*?\]/.test(missionControl),
    'the view registry must list fleetProcurement');
  assert.ok(missionControl.includes('MissionControlFleetProcurement'),
    'and the render dispatch must actually call it');
});

test('matching project and item names render cleanly without redundant parentheses', async () => {
  const payload = {
    success: true,
    sources: { propulsion: { available: true }, militaryValue: { available: true }, economicValue: { available: true } },
    research: { monthlyResearchIncome: 1000 },
    ordering: { deficitApplied: false },
    deficit: { applied: false, capability: { canContest: 'unknown' } },
    military: {
      rankedCount: 1, candidatesConsidered: 1, unrankable: { counts: {} },
      groups: [{
        state: 'researchable-now', label: 'Researchable now', actionable: true, count: 1,
        items: [
          {
            id: 'reactor', displayName: 'Electrostatic Confinement Fusion Reactor I',
            gateProjectId: 'Project_ElectrostaticConfinementFusionReactorI',
            gateProjectName: 'Electrostatic Confinement Fusion Reactor I',
            axisLabel: 'output per tonne', improvementMultiple: 3, valuePerResearchPoint: 0.0008,
            remainingResearchCost: 2500, monthsAtCurrentIncome: 2.5, isZeroCost: false,
            availabilityState: 'researchable-now', context: null
          }
        ]
      }]
    },
    economic: { rankedCount: 0, candidatesConsidered: 0, unrankable: { counts: {} }, units: [] }
  };

  const html = await renderToString(payload);
  assertNoPlaceholderText(html, 'matching-names payload');
  const text = visibleText(html);

  assert.ok(text.includes('Electrostatic Confinement Fusion Reactor I'), 'item name is visible');
  assert.ok(!text.includes('(Electrostatic Confinement Fusion Reactor I)'), 'no duplicate parenthesised name');
  assert.ok(!html.includes('ra-row__sub'), 'no sub-name span rendered for identical names');
});

test('the longest real labels (e.g. 57 characters) render without placeholder tokens', async () => {
  const payload = {
    success: true,
    sources: { propulsion: { available: true }, militaryValue: { available: true }, economicValue: { available: true } },
    research: { monthlyResearchIncome: 1000 },
    ordering: { deficitApplied: false },
    deficit: { applied: false, capability: { canContest: 'unknown' } },
    military: {
      rankedCount: 1, candidatesConsidered: 1, unrankable: { counts: {} },
      groups: [{
        state: 'researchable-now', label: 'Researchable now', actionable: true, count: 1,
        items: [
          {
            id: 'long', displayName: 'Copperhead Missile Pod',
            gateProjectId: 'Project_CopperheadMissileBay',
            gateProjectName: 'Hydrolox High Explosive Missiles',
            axisLabel: 'sustained output per hardpoint', improvementMultiple: 3.0,
            valuePerResearchPoint: 0.001, remainingResearchCost: 2500, monthsAtCurrentIncome: 2.5,
            isZeroCost: false, availabilityState: 'researchable-now', context: null
          }
        ]
      }]
    },
    economic: { rankedCount: 0, candidatesConsidered: 0, unrankable: { counts: {} }, units: [] }
  };

  const html = await renderToString(payload);
  assertNoPlaceholderText(html, 'longest-label payload');
  const text = visibleText(html);
  const expected = 'Hydrolox High Explosive Missiles (Copperhead Missile Pod)';
  assert.equal(expected.length, 57, 'exact 57-character label length');
  assert.ok(text.includes(expected), '57-character label renders in full in visible text');
});

test('alsoUnlocks > 1 is rendered as a visible badge, and <= 1 is not badged', async () => {
  const payload = {
    success: true,
    sources: { propulsion: { available: true }, militaryValue: { available: true }, economicValue: { available: true } },
    research: { monthlyResearchIncome: 1000 },
    ordering: { deficitApplied: false },
    deficit: { applied: false, capability: { canContest: 'unknown' } },
    military: {
      rankedCount: 3, candidatesConsidered: 3, unrankable: { counts: {} },
      groups: [{
        state: 'researchable-now', label: 'Researchable now', actionable: true, count: 3,
        items: [
          {
            id: 'multi-4', displayName: 'Copperhead Missile Pod',
            gateProjectId: 'Project_CopperheadMissileBay', gateProjectName: 'Hydrolox High Explosive Missiles',
            axisLabel: 'sustained output per hardpoint', improvementMultiple: 3, valuePerResearchPoint: 0.001,
            remainingResearchCost: 2500, monthsAtCurrentIncome: 2.5,
            alsoUnlocks: { totalItems: 4, families: { missile: 4 } },
            availabilityState: 'researchable-now', context: null
          },
          {
            id: 'multi-2', displayName: 'Dreadnought',
            gateProjectId: 'Project_ShipsoftheLine', gateProjectName: 'Ships of the Line',
            axisLabel: 'throw weight', improvementMultiple: 2.07, valuePerResearchPoint: 0.0005,
            remainingResearchCost: 5000, monthsAtCurrentIncome: 5,
            alsoUnlocks: { totalItems: 2, families: { ship_hull: 2 } },
            availabilityState: 'researchable-now', context: null
          },
          {
            id: 'single-1', displayName: 'Single Unlock',
            gateProjectId: 'Project_Single', gateProjectName: 'Single Project',
            axisLabel: 'output', improvementMultiple: 1.5, valuePerResearchPoint: 0.001,
            remainingResearchCost: 1000, monthsAtCurrentIncome: 1,
            alsoUnlocks: { totalItems: 1, families: { utility: 1 } },
            availabilityState: 'researchable-now', context: null
          }
        ]
      }]
    },
    economic: { rankedCount: 0, candidatesConsidered: 0, unrankable: { counts: {} }, units: [] }
  };

  const html = await renderToString(payload);
  assertNoPlaceholderText(html, 'alsoUnlocks payload');
  const text = visibleText(html);

  assert.ok(text.includes('4 items'), 'alsoUnlocks 4 renders "4 items" badge');
  assert.ok(text.includes('2 items'), 'alsoUnlocks 2 renders "2 items" badge');
  assert.ok(!text.includes('1 items'), 'alsoUnlocks 1 renders no badge');
  assert.match(html, /Unlocks 4 items across this project \(4 missile\)/, 'tooltip includes family breakdown');
});

test('research-ranking generates drive chains ranked by whole-chain payoff per point', () => {
  const { loadFixtureFilteredSnapshot } = require('./fixtures/frozenSnapshots');
  const liveSnapshot = loadFixtureFilteredSnapshot({ mode: 'player', observer: 4712 });
  const result = project(liveSnapshot, { mode: 'player', observerId: 4712, detail: 'full' });

  assert.ok(result.military.driveChainsCount > 0, 'Must produce drive chain candidates');
  assert.ok(Array.isArray(result.military.driveChains.items), 'driveChains items must be an array');

  const topChain = result.military.driveChains.items[0];
  assert.ok(topChain.valuePerResearchPoint > 0, 'Top drive chain must have positive payoff per research point');
  assert.ok(topChain.chain.stepsCount >= 1, 'Chain must report stepsCount');
  assert.ok(topChain.chain.totalRemainingCost > 0, 'Chain must report totalRemainingCost');
  assert.ok(topChain.chain.immediateNextStep.displayName, 'Chain must report immediateNextStep displayName');
  assert.ok(topChain.chain.immediateNextStep.cost !== undefined, 'Chain must report immediateNextStep cost');
});

test('research-ranking produces capability verdicts for uncompared candidates', () => {
  const { loadFixtureFilteredSnapshot } = require('./fixtures/frozenSnapshots');
  const liveSnapshot = loadFixtureFilteredSnapshot({ mode: 'player', observer: 4712 });
  const result = project(liveSnapshot, { mode: 'player', observerId: 4712, detail: 'full' });

  assert.ok(result.military.capabilitiesCount > 0, 'Must produce capabilities');
  const caps = result.military.capabilities.items;
  assert.ok(caps.length > 0, 'Must have capability items');

  for (const cap of caps) {
    assert.strictEqual(cap.isFirstInClass, true);
    assert.strictEqual(cap.verdict, 'first-in-class');
    assert.strictEqual(cap.verdictLabel, 'First capability of its kind — no baseline to compare against');
    assert.strictEqual(cap.improvementMultiple, null);
  }
});

test('research-advisor frontend renders chain steps and capability tags', async () => {
  const payload = {
    resource: 'research-ranking',
    military: {
      rankedCount: 2, candidatesConsidered: 2, unrankable: { counts: {} },
      groups: [{
        state: 'prereq-blocked', label: 'Prerequisites not met', aspirational: true, count: 2,
        items: [
          {
            id: 'chain-item', displayName: 'Battlestations',
            gateProjectId: 'Project_Battlestations', gateProjectName: 'Battlestations',
            axisLabel: 'defense output', improvementMultiple: 4.5, valuePerResearchPoint: 0.00045,
            remainingResearchCost: 5000, monthsAtCurrentIncome: 5,
            availabilityState: 'prereq-blocked', context: null,
            chain: {
              stepsCount: 2,
              totalRemainingCost: 7844,
              monthsAtFullConcentration: 2.5,
              immediateNextStep: { id: 'Project_ColonyCore', displayName: 'Colony Core', cost: 2844, status: 'researching' }
            }
          },
          {
            id: 'cap-item', displayName: 'Installation Laser',
            gateProjectId: 'Project_InstLaser', gateProjectName: 'Installation Laser',
            axisLabel: null, improvementMultiple: null, valuePerResearchPoint: null,
            remainingResearchCost: 3000, monthsAtCurrentIncome: 3,
            isFirstInClass: true, verdict: 'first-in-class',
            availabilityState: 'prereq-blocked', context: { fieldedInClass: 0 }
          }
        ]
      }]
    },
    economic: { rankedCount: 0, candidatesConsidered: 0, unrankable: { counts: {} }, units: [] }
  };

  const html = await renderToString(payload);
  assertNoPlaceholderText(html, 'chain payload');
  const text = visibleText(html);

  assert.ok(text.includes('2 steps'), 'Renders "2 steps" badge for multi-step chain');
  assert.ok(text.includes('new'), 'Renders "new" tag for first-in-class capability');
  assert.ok(text.includes('First of kind'), 'Renders "First of kind" for capability metric');
  assert.match(html, /Prerequisite chain: 2 steps, 7,844 pts total \(2\.5 mo at full concentration\) \(Immediate next: Colony Core — 2,844 pts\)/, 'tooltip contains chain details');
  // The cost and the duration on the row have to be about the same plan. The
  // 7,844 is the whole chain, so the months beside it must be the chain's 2.5 --
  // never the destination project's own 5, which is the last step alone.
  assert.ok(text.includes('7,844 pts · 2.5 mo'),
    'the chain total and the chain duration are printed together, not the chain cost beside the gate months');
  assert.ok(!text.includes('7,844 pts · 5.0 mo'),
    'the gate project\'s own duration must not be printed beside the whole-chain cost');
});

// ---------------------------------------------------------------------------
// CHAIN VISIBILITY -- docs/chain-visibility-spec.md
//
// The chain feature was correct and invisible. Every row the card painted had
// `stepsCount: 1`, the chain badge is gated on `stepsCount > 1`, and the only
// group holding multi-step chains ("Prerequisites not met") is never among the
// two the card renders. These tests pin the promotion that fixes that, and --
// the part that carries the risk -- the reachability gate that stops it
// recommending a chain nobody can finish.
// ---------------------------------------------------------------------------

const { REACHABILITY_STATES } = require('../shared/researchReachability.mjs');
const {
  FIRST_IN_CLASS_LABEL,
  chainAwareValuePerResearchPoint,
  isFirstInClassCandidate
} = require('../shared/researchRanking.mjs');

/** The live save, projected for one mode. */
function liveResult(mode, options = {}) {
  const { loadFixtureFilteredSnapshot } = require('./fixtures/frozenSnapshots');
  const snapshot = loadFixtureFilteredSnapshot({ mode, observer: OBSERVER });
  return project(snapshot, { mode, observerId: OBSERVER, ...options });
}

/** Every military row in the payload, whatever group it landed in. */
const allMilitaryRows = (result) => (result.military.groups || []).flatMap(group => group.items || []);

test('a chain is priced over the whole chain, and a single-step row keeps exactly the number it had', () => {
  const single = {
    valuePerResearchPoint: 0.002,
    improvementMultiple: 42,
    chain: { stepsCount: 1, totalRemainingCost: 20000, researchCostComplete: true }
  };
  assert.equal(chainAwareValuePerResearchPoint(single), 0.002,
    'one step means the gate IS the chain, so the figure must not move for any row that had one before');

  // The live save's Pion Torch shape: a very large multiple behind a gate that
  // is a fraction of the chain which actually reaches it.
  const chained = {
    valuePerResearchPoint: 0.0011524075,
    improvementMultiple: 231.4815,
    chain: { stepsCount: 12, totalRemainingCost: 1300325, researchCostComplete: true }
  };
  const priced = chainAwareValuePerResearchPoint(chained);
  assert.ok(priced < chained.valuePerResearchPoint,
    'pricing over eleven further steps must cost the row value rather than flatter it');
  assert.equal(priced, Number(((231.4815 - 1) / 1300325).toFixed(10)));

  assert.equal(chainAwareValuePerResearchPoint({
    improvementMultiple: 5, chain: { stepsCount: 3, totalRemainingCost: 100, researchCostComplete: false }
  }), null, 'a chain with an uncosted step has no whole-chain ratio at all');
  assert.equal(chainAwareValuePerResearchPoint({
    improvementMultiple: null, chain: { stepsCount: 3, totalRemainingCost: 100, researchCostComplete: true }
  }), null);
});

test('first-in-class and the capabilities block count the same rows, in both modes', () => {
  for (const mode of ['player', 'omniscient']) {
    const result = liveResult(mode, { detail: 'full' });
    const counts = result.military.unrankable.counts;
    assert.ok(result.military.capabilitiesCount > 0, `${mode}: the live save has uncomparable capabilities`);
    // The defect: `capabilities` reported 40 while the census reported
    // `first-in-class: 0` beside `not-comparable: 40` -- two accountings of the
    // same rows, contradicting each other in one payload.
    assert.equal(counts[RANK_STATES.firstInClass], result.military.capabilitiesCount,
      `${mode}: the census and the capabilities block describe the same rows and must agree`);
    assert.equal(counts[RANK_STATES.firstInClass], result.military.capabilities.count);
    assert.equal(result.military.capabilities.censusState, RANK_STATES.firstInClass);
    for (const cap of result.military.capabilities.items) {
      assert.equal(isFirstInClassCandidate(cap.improvementMultiple, cap.context), true);
      assert.equal(cap.rankState, RANK_STATES.firstInClass);
      assert.equal(cap.verdictLabel, FIRST_IN_CLASS_LABEL);
    }
    // `not-comparable` is not retired: it stays the honest state for a class
    // that HAS a fielded baseline the item cannot be measured against.
    assert.ok(Object.prototype.hasOwnProperty.call(counts, RANK_STATES.notComparable));
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
    assert.equal(total, result.military.candidatesConsidered,
      `${mode}: every candidate still lands in exactly one state`);
  }
});

test('the highest-scoring chain is refused when it cannot be finished, and the refusal is recorded', () => {
  for (const mode of ['player', 'omniscient']) {
    const result = liveResult(mode, { detail: 'full' });
    const promotion = result.military.chainPromotion;
    assert.equal(promotion.horizon.available, true, `${mode}: the live save can measure a horizon`);

    const chains = allMilitaryRows(result).filter(row => row.chain && row.chain.stepsCount > 1);
    assert.ok(chains.length > 1, `${mode}: the live save carries several multi-step chains`);

    // Derived from the snapshot under test rather than named: the unreachable
    // chain with the best whole-chain payoff per point. On the save this was
    // written against that is `Pion Torch x6` -- 12 steps, 1,300,325 pts, 413.5
    // months at the measured income against a 156-month horizon -- but the save
    // moves, so the test finds it rather than pinning it.
    const beyond = chains
      .filter(row => row.chain.reachability.state === REACHABILITY_STATES.beyondHorizon)
      .sort((a, b) => (chainAwareValuePerResearchPoint(b) ?? -Infinity)
        - (chainAwareValuePerResearchPoint(a) ?? -Infinity));
    assert.ok(beyond.length > 0, `${mode}: the live save has at least one unreachable chain`);

    const worst = beyond[0];
    assert.equal(worst.chainPromoted, false, `${mode}: ${worst.displayName} must not be promoted`);
    assert.ok(worst.chain.reachability.months > promotion.horizon.months,
      `${mode}: and the recorded reason must be that it measurably does not fit`);
    assert.match(worst.chainPromotion.reason, /planning horizon/,
      `${mode}: the refusal names the horizon rather than vanishing silently`);
    assert.ok(promotion.declined.some(entry => entry.id === worst.id),
      `${mode}: a refused chain is listed -- a gate that silently removes the top row is a truncation`);

    // It is refused DESPITE outscoring rows that were promoted. Without this the
    // gate would be untested: a rule that only ever rejects things nothing else
    // beats proves nothing about the ordering.
    const promotedValues = promotion.promoted
      .map(entry => entry.chainValuePerResearchPoint)
      .filter(value => value !== null && Number.isFinite(value));
    assert.ok(promotedValues.length > 0, `${mode}: something was promoted`);
    const worstValue = chainAwareValuePerResearchPoint(worst);
    assert.ok(promotedValues.some(value => value < worstValue),
      `${mode}: the refused chain outranks a promoted one on payoff per point, which is exactly why `
      + 'reachability has to be evaluated before the ratio');

    for (const group of result.military.groups) {
      if (!ACTIONABLE_GROUPS.includes(group.state)) continue;
      assert.ok(!group.items.some(row => row.id === worst.id),
        `${mode}: an unreachable chain must never reach an actionable group`);
    }
  }
});

test('a promoted chain lands in its next step group, priced over the whole chain, never startable', () => {
  for (const mode of ['player', 'omniscient']) {
    const result = liveResult(mode, { detail: 'full' });
    const promoted = allMilitaryRows(result).filter(row => row.chainPromoted === true);
    assert.ok(promoted.length > 0, `${mode}: at least one chain is promoted on the live save`);

    for (const row of promoted) {
      assert.equal(row.startableNow, false, `${mode}: ${row.displayName} is not startable as it stands`);
      assert.ok(ASPIRATIONAL_GROUPS.includes(row.destinationAvailabilityState),
        `${mode}: the destination keeps its own blocked state`);
      assert.equal(row.availabilityState, row.chain.immediateNextStep.availabilityState,
        `${mode}: the row is filed under the step the player would actually start`);
      assert.ok(AVAILABILITY_GROUP_ORDER.indexOf(row.availabilityState)
        < AVAILABILITY_GROUP_ORDER.indexOf(row.destinationAvailabilityState),
        `${mode}: promotion moves a row forward or not at all`);
      assert.equal(row.chain.reachability.state, REACHABILITY_STATES.withinHorizon);
      assert.ok(row.chain.stepsCount > 1);
      assert.ok(row.chain.totalRemainingCost > 0);
      // Renamed together with its meaning on 2026-08-22: the chain is priced at
      // FULL CONCENTRATION now, not at the whole faction's income. Keeping the
      // old field name would have carried a new number under the old reading.
      assert.ok(row.chain.monthsAtFullConcentration > 0,
        `${mode}: a promoted row carries the WHOLE chain's duration, not the gate's`);
      assert.equal(row.chain.monthsAtCurrentIncome, undefined,
        `${mode}: the superseded field name is gone, so no consumer can read the new figure as the old one`);
      assert.equal(row.chainValuePerResearchPoint, chainAwareValuePerResearchPoint(row));
      assert.ok(row.chainValuePerResearchPoint < row.valuePerResearchPoint,
        `${mode}: the whole-chain price is the honest one and is always the smaller of the two`);
      assert.ok(typeof row.chain.immediateNextStep.displayName === 'string'
        && row.chain.immediateNextStep.displayName.length > 0,
        `${mode}: the actionable instruction has a name`);
      if (row.slotAction === 'free-slot' || row.slotAction === 'occupied-slot') {
        assert.ok(row.slotNote.includes(row.chain.immediateNextStep.displayName),
          `${mode}: slot advice for a promoted row is about the step it can start`);
        assert.ok(!/start now with nothing lost/.test(row.slotNote),
          `${mode}: "start now" must never be said of a candidate two projects away`);
      }
    }
  }
});

test('a multi-step chain is visible in COMMAND without opening the drill-down, in both modes', async () => {
  for (const mode of ['player', 'omniscient']) {
    // The panel's own request: `limit=6`, summary detail.
    const payload = liveResult(mode, { limit: 6 });
    const html = await renderToString(payload);
    assertNoPlaceholderText(html, `${mode} live payload`);
    const text = visibleText(html);

    // Which rows the card actually paints: the first two populated groups, two
    // rows each. Read from the payload rather than assumed, so a change to the
    // panel's budget surfaces here as a failure rather than a silent pass.
    const populated = payload.military.groups.filter(group => group.items.length > 0);
    const rendered = populated.slice(0, 2).flatMap(group => group.items.slice(0, 2));
    const renderedChains = rendered.filter(row => row.chainPromoted === true);
    assert.ok(renderedChains.length > 0,
      `${mode}: a multi-step chain must reach the card itself, not only the full-ranking panel`);

    for (const row of renderedChains) {
      const next = row.chain.immediateNextStep.displayName;
      const destination = row.chain.destinationDisplayName;
      assert.ok(text.includes(`${next} → ${destination}`),
        `${mode}: a promoted row leads with ${next} and names ${destination}`);
      assert.ok(text.includes(`${row.chain.stepsCount} steps`),
        `${mode}: the step count is on the card`);
      assert.ok(html.includes('ra-tag--chain'), `${mode}: and it is badged, not buried in prose`);
      const cost = Math.round(row.chain.totalRemainingCost).toLocaleString('en-US');
      const duration = row.chain.monthsAtFullConcentration < 1
        ? '<1 mo'
        : `${row.chain.monthsAtFullConcentration.toFixed(1)} mo`;
      assert.ok(text.includes(`${cost} pts · ${duration}`),
        `${mode}: the whole-chain cost and its own duration are shown together`);
      assert.ok(!text.includes(`${destination} → `),
        `${mode}: the destination must never take the lead position, where every other row is startable`);
    }
  }
});

test('promotion changes no group budget: the card still paints two groups of two', async () => {
  for (const mode of ['player', 'omniscient']) {
    const html = await renderToString(liveResult(mode, { limit: 6 }));
    // `ra-group ` with the trailing space, so `ra-group__label` and
    // `ra-group__list` inside each group are not counted as groups themselves.
    const groups = html.match(/class="ra-group /g) || [];
    const rows = html.match(/<li class="ra-row">/g) || [];
    // Two tracks, two groups each, two rows per group. Promotion MOVES a row
    // between groups and never adds one, which is what keeps the COMMAND column
    // inside its measured screen budget.
    assert.equal(groups.length, 4, `${mode}: two groups per track and no more`);
    assert.ok(rows.length <= 8, `${mode}: at most two rows per rendered group`);
  }
});

test('the two chain badges have CSS of their own, resolving to real colours', () => {
  // Not a check that the selectors exist -- that is what shipped broken, with
  // both badges emitted and neither styled. This resolves each declaration
  // through :root the way the browser does, because `--text-muted` was once
  // defined self-referentially and 164 rules silently fell back to `inherit`.
  // The computed-style check against a running page is in the verification run.
  // Every part the shell links, concatenated in cascade order, so :root and the
  // tag rules resolve against each other exactly as the browser resolves them.
  const css = require('./fixtures/missionControlCss').readMissionControlCss();
  const rootBlock = css.match(/:root\s*\{([\s\S]*?)\}/);
  assert.ok(rootBlock, ':root must define the palette');
  const tokens = new Map();
  for (const [, name, value] of rootBlock[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    tokens.set(name, value.trim());
  }

  const resolve = (value, depth = 0) => {
    const reference = /^var\((--[\w-]+)\)$/.exec(value);
    if (!reference) return value;
    assert.ok(depth < 8, `${value} resolves in a cycle, which renders as inherit and not as a colour`);
    const target = tokens.get(reference[1]);
    assert.ok(target !== undefined, `${reference[1]} is referenced and never defined`);
    assert.notEqual(target, value, `${reference[1]} is defined in terms of itself`);
    return resolve(target, depth + 1);
  };

  for (const selector of ['.ra-tag--chain', '.ra-tag--newcap']) {
    const block = css.match(new RegExp(`\\${selector}\\s*\\{([\\s\\S]*?)\\}`));
    assert.ok(block, `${selector} is emitted by research-advisor.js and needs a rule`);
    const declarations = new Map();
    for (const [, prop, value] of block[1].matchAll(/([\w-]+)\s*:\s*([^;]+);/g)) {
      declarations.set(prop.trim(), value.trim());
    }
    for (const property of ['color', 'border-color']) {
      const declared = declarations.get(property);
      assert.ok(declared, `${selector} must set ${property} or it is indistinguishable from a bare .ra-tag`);
      assert.match(resolve(declared), /^#[0-9a-f]{3,8}$|^rgba?\(/i,
        `${selector} ${property} must resolve to a real colour, not to an undefined token`);
    }
    assert.ok(!/font-size\s*:\s*\d/.test(block[1]),
      `${selector} must not hardcode a size; the scale lives in the --fs-* tokens`);
  }

  // ...and they are visibly different from each other and from the base tag.
  const colorOf = (selector) => {
    const block = css.match(new RegExp(`\\${selector}\\s*\\{([\\s\\S]*?)\\}`));
    return resolve((/(?:^|[\s;])color\s*:\s*([^;]+);/.exec(block[1]) || [])[1].trim());
  };
  assert.notEqual(colorOf('.ra-tag--chain'), colorOf('.ra-tag--newcap'));
  assert.notEqual(colorOf('.ra-tag--chain'), resolve(tokens.get('--text-muted')));
});

test('research-advisor distinguishes capped groups list from whole list with explicit omission note', async () => {
  const makeGroup = (state, label, name) => ({
    state,
    label,
    count: 3,
    items: [
      {
        id: `item-${state}`,
        displayName: name,
        improvementMultiple: 2.0,
        axisLabel: 'combat power',
        remainingResearchCost: 1000,
        monthsAtCurrentIncome: 1
      }
    ]
  });

  // 1. Whole list (2 groups <= GROUPS_SHOWN=2): no omission note
  const twoGroupsPayload = {
    resource: 'research-ranking',
    military: {
      rankedCount: 6,
      candidatesConsidered: 6,
      unrankable: { counts: {} },
      groups: [
        makeGroup('researchable-now', 'Researchable now', 'Project Alpha'),
        makeGroup('prereq-clear-but-unrolled', 'Prerequisites met — unrolled', 'Project Beta')
      ]
    },
    economic: { rankedCount: 0, candidatesConsidered: 0, unrankable: { counts: {} }, units: [] }
  };
  const htmlTwo = await renderToString(twoGroupsPayload);
  const textTwo = visibleText(htmlTwo);
  assert.ok(textTwo.includes('Researchable now'), 'Group 1 must render');
  assert.ok(textTwo.includes('Prerequisites met — unrolled'), 'Group 2 must render');
  assert.ok(!textTwo.includes('omitted from this view'), 'No omission note when all populated groups fit within GROUPS_SHOWN');

  // 2. Capped list (4 groups > GROUPS_SHOWN=2): renders first 2 groups and explicit omission note
  const fourGroupsPayload = {
    resource: 'research-ranking',
    military: {
      rankedCount: 12,
      candidatesConsidered: 12,
      unrankable: { counts: {} },
      groups: [
        makeGroup('researchable-now', 'Researchable now', 'Project Alpha'),
        makeGroup('prereq-clear-but-unrolled', 'Prerequisites met — unrolled', 'Project Beta'),
        makeGroup('prereq-blocked', 'Prerequisites not met', 'Project Gamma'),
        makeGroup('unranked-tech', 'Unranked technology', 'Project Delta')
      ]
    },
    economic: { rankedCount: 0, candidatesConsidered: 0, unrankable: { counts: {} }, units: [] }
  };
  const htmlFour = await renderToString(fourGroupsPayload);
  const textFour = visibleText(htmlFour);
  assert.ok(textFour.includes('Researchable now'), 'Group 1 must render');
  assert.ok(textFour.includes('Prerequisites met — unrolled'), 'Group 2 must render');
  assert.ok(!textFour.includes('Project Gamma'), 'Group 3 items must be omitted from main card');
  assert.ok(!textFour.includes('Project Delta'), 'Group 4 items must be omitted from main card');
  assert.ok(
    textFour.includes('Showing 2 of 4 availability groups; 2 further groups are omitted from this view.'),
    `Capped groups list must state total and omitted group counts: ${textFour}`
  );

  // 3. Capped list with 3 groups (omitted count = 1 singular)
  const threeGroupsPayload = {
    resource: 'research-ranking',
    military: {
      rankedCount: 9,
      candidatesConsidered: 9,
      unrankable: { counts: {} },
      groups: [
        makeGroup('researchable-now', 'Researchable now', 'Project Alpha'),
        makeGroup('prereq-clear-but-unrolled', 'Prerequisites met — unrolled', 'Project Beta'),
        makeGroup('prereq-blocked', 'Prerequisites not met', 'Project Gamma')
      ]
    },
    economic: { rankedCount: 0, candidatesConsidered: 0, unrankable: { counts: {} }, units: [] }
  };
  const htmlThree = await renderToString(threeGroupsPayload);
  const textThree = visibleText(htmlThree);
  assert.ok(
    textThree.includes('Showing 2 of 3 availability groups; 1 further group is omitted from this view.'),
    `Singular omitted group must be grammatically correct: ${textThree}`
  );
});


