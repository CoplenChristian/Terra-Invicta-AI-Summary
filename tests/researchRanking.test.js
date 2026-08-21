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

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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
  if (observer) observer.shipsCount = ownShips;
  if (aliens) aliens.shipsCount = alienShips;
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
  assert.ok(topScorer.valuePerResearchPoint > blocked.items[0].valuePerResearchPoint * 10,
    'and the candidate it outranks scores far higher, so the ordering cannot be an accident of value');
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
  assert.deepEqual(ACTIONABLE_GROUPS, ['researchable-now', 'prereq-clear-but-unrolled']);
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
    assert.ok(result.military.unrankable.counts[RANK_STATES.notComparable] > 0,
      'those candidates are counted in their own state, not dropped');
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
const componentPath = path.join(repoRoot, 'public', 'v2', 'js', 'components', 'research-advisor.js');
const v2ShellPath = path.join(repoRoot, 'public', 'v2', 'index.html');
const missionControlPath = path.join(repoRoot, 'public', 'v2', 'js', 'mission-control.js');

function loadComponent() {
  const source = fs.readFileSync(componentPath, 'utf8');
  const sandbox = { window: {}, console, fetch: () => Promise.resolve(null) };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: componentPath });
  return sandbox.window.MissionControlResearchAdvisor;
}

function renderToString(payload) {
  const component = loadComponent();
  const root = { innerHTML: '', querySelector: () => null };
  component.render(root, payload);
  return root.innerHTML;
}

// What a reader actually sees. Tags are stripped whole, so a `title` attribute
// can never mask a null that reached the visible copy -- and equally, prose
// deliberately parked in a tooltip is not counted against the panel.
function visibleText(html) {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
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

test('the panel is mounted in the COMMAND view and loaded by the shell', () => {
  const html = fs.readFileSync(v2ShellPath, 'utf8');
  const missionControl = fs.readFileSync(missionControlPath, 'utf8');

  assert.ok(html.includes('id="researchAdvisor"'), 'the mount element must exist');
  assert.ok(html.includes('/v2/js/components/research-advisor.js'),
    'a component with no <script> tag renders nowhere');

  const command = html.match(/<section[^>]*id="view-command"[\s\S]*?<\/section>/);
  assert.ok(command, '#view-command must exist');
  assert.ok(command[0].includes('id="researchAdvisor"'),
    'the panel must live inside the view its registry entry claims');

  assert.ok(/panels: \[[\s\S]*?'researchAdvisor'[\s\S]*?\]/.test(missionControl),
    'the view registry must list the panel, so assertViewRegistryIntegrity covers it');
  assert.ok(missionControl.includes('MissionControlResearchAdvisor'),
    'and the render dispatch must actually call it');
});

test('a payload whose every measurement is absent renders honest dashes, never "null"', () => {
  // Deliberately hostile: this is the shape phases 1-3 produce on a snapshot
  // where nothing could be measured. Every one of these nulls is intentional
  // upstream and would print as the word "null" through a raw interpolation.
  const html = renderToString({
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

test('a turn-1 payload renders the reason it is empty rather than an empty box', () => {
  const payload = project(turnOneSnapshot('player'));
  const html = renderToString(payload);
  assertNoPlaceholderText(html, 'turn-1 payload');
  const text = visibleText(html);
  assert.match(text, /no baseline to|no hulls|Nothing can be ranked/i,
    'an empty military ranking must say why it is empty');
  assert.match(text, /ranked/, 'and the census still reports what was considered');
});

test('the live-shaped payload renders both tracks with no forbidden token', () => {
  for (const mode of ['player', 'omniscient']) {
    const payload = project(fleetScenario(SCENARIOS.deltaV, mode), { mode });
    const html = renderToString(payload);
    assertNoPlaceholderText(html, `${mode} payload`);
    const text = visibleText(html);
    assert.match(text, /MILITARY/);
    assert.match(text, /ECONOMIC/);
  }
});

test('the monthly unlock roll is shown only where a roll is still pending', () => {
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

  const rolling = visibleText(renderToString(shell('prereq-clear-but-unrolled', 'Not yet available')));
  assert.match(rolling, /rolls 5%\/mo, cap 50%/, 'a pending roll and its cap are the whole proposition');
  assert.match(rolling, /may never land/, 'a cap below 100% may never land, and the player is entitled to know');

  const available = visibleText(renderToString(shell('researchable-now', 'Researchable now')));
  assert.ok(!/rolls /.test(available),
    'a researchable-now candidate has already rolled; printing its odds describes a dice throw that is over');
});

test('a payload with no valuation inputs renders unavailable rather than an empty ranking', () => {
  const html = renderToString({
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

test('a unitless row is badged as such on the card, and a measured one is not', () => {
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

  const unitless = renderToString(payload('rule-scalar'));
  assert.match(unitless, /ra-tag--unitless/);
  assert.match(visibleText(unitless), /no unit/);
  assert.match(unitless, /no engineering axis/, 'the badge must carry its explanation as a tooltip');
  assertNoPlaceholderText(unitless, 'rule-scalar row');

  const measured = renderToString(payload('measured'));
  assert.ok(!/ra-tag--unitless/.test(measured), 'a measured axis carries no badge');
});
