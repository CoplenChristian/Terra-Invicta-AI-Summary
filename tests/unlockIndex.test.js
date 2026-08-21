// The unlock index and the research-availability states.
//
// The index is pure data with no judgement in it, so the test that matters is a
// census: sixteen families, each with the count the installed templates
// actually contain. A family that silently stops being read looks exactly like
// a family with nothing gated in it, and every later phase of the advisor
// depends on this being complete.
//
// The counts below were measured against the installed 1.0 templates on
// 2026-08-21 and are asserted exactly. If a game update changes them, this test
// is supposed to fail -- that is the point. It should be updated deliberately,
// with the new count verified, rather than loosened to a range.

const { test } = require('node:test');
const assert = require('node:assert');

const templateLoader = require('../server/templateLoader');
const {
  UNLOCK_FAMILIES,
  buildDriveStats,
  buildProjectGating,
  buildPropellantModules,
  buildUnlockIndex
} = require('../server/snapshot/templates');
const {
  buildItemGateMap,
  gateForItem,
  gatesForFamily,
  unlockIndexCensus,
  unlockIndexUnavailableReason,
  unlocksForGate
} = require('../shared/unlockIndex.mjs');
const {
  AVAILABILITY_STATES,
  buildAvailabilityResolver,
  monthsAtIncome,
  tallyAvailabilityStates
} = require('../shared/researchAvailability.mjs');

/** Verified against the installed 1.0 templates, 2026-08-21. */
const EXPECTED_GATED = Object.freeze({
  drive: 541,
  hab_module: 138,
  laser_weapon: 92,
  org: 83,
  magnetic_gun: 70,
  power_plant: 60,
  utility_module: 57,
  missile: 56,
  particle_weapon: 33,
  ship_hull: 27,
  plasma_weapon: 16,
  heat_sink: 14,
  radiator: 12,
  battery: 9,
  ship_armor: 8,
  gun: 7
});

const EXPECTED_TOTAL = Object.values(EXPECTED_GATED).reduce((sum, count) => sum + count, 0);

templateLoader.load();
const index = buildUnlockIndex();
const snapshotLike = { unlockIndex: index };

test('all sixteen gated template families are indexed, at their measured counts', () => {
  assert.equal(Object.keys(index.families).length, 16);
  for (const [family, expected] of Object.entries(EXPECTED_GATED)) {
    assert.equal(
      index.families[family]?.gated,
      expected,
      `${family}: expected ${expected} gated entries from the installed templates`
    );
  }
  assert.equal(index.totals.gatedEntries, EXPECTED_TOTAL);
  assert.equal(EXPECTED_TOTAL, 1223);
});

test('every gated entry resolved to a gate; none were dropped', () => {
  assert.deepEqual(index.unresolved, [], 'an entry with no resolvable identity must be reported, and there should be none');
  const flattened = Object.values(index.gates)
    .flatMap(gate => Object.values(gate.unlocks))
    .reduce((sum, items) => sum + items.length, 0);
  assert.equal(flattened, index.totals.gatedEntries, 'the gate map must hold exactly the counted entries');
});

test('orgs are gated by a tech, not a project, and the index says so', () => {
  // Fifteen families carry `requiredProjectName`; orgs carry `requiredTechName`.
  // Flattening the two would mis-describe 83 of the 1,223 entries.
  assert.equal(index.families.org.gateField, 'requiredTechName');
  assert.equal(index.families.org.gateKind, 'tech');
  for (const family of Object.keys(EXPECTED_GATED)) {
    if (family === 'org') continue;
    assert.equal(index.families[family].gateField, 'requiredProjectName', family);
    assert.equal(index.families[family].gateKind, 'project', family);
  }
  const orgGates = gatesForFamily(snapshotLike, 'org');
  assert.ok(orgGates.length > 0);
  assert.ok(orgGates.every(gate => gate.gateKind === 'tech'));
});

test('the six weapon families are counted separately, not merged by category', () => {
  // Magnetic guns and guns are both `Kinetic`, so a category-based split would
  // report 77 kinetic entries and lose the distinction between 70 and 7.
  assert.equal(index.families.magnetic_gun.gated + index.families.gun.gated, 77);
  assert.notEqual(index.families.magnetic_gun.gated, index.families.gun.gated);
  const weaponFamilies = ['laser_weapon', 'magnetic_gun', 'gun', 'particle_weapon', 'plasma_weapon', 'missile'];
  const weaponTotal = weaponFamilies.reduce((sum, family) => sum + index.families[family].gated, 0);
  assert.equal(weaponTotal, 274);
});

test('the index inverts: every item resolves back to the gate that unlocks it', () => {
  const map = buildItemGateMap(snapshotLike);
  assert.equal(map.size, index.totals.gatedEntries, 'the inversion must not collide keys');

  // Spot-check one entry per family, taken from the index itself so the test
  // carries no hardcoded item names beyond the two below.
  for (const family of Object.keys(EXPECTED_GATED)) {
    const gates = gatesForFamily(snapshotLike, family);
    assert.ok(gates.length > 0, `${family} should have at least one gate`);
    const sample = gates[0].items[0];
    const resolved = gateForItem(snapshotLike, family, sample.id);
    assert.equal(resolved.gateId, gates[0].gateId, `${family}: ${sample.id}`);
    assert.equal(resolved.family, family);
  }
});

test('a known drive maps to its known project, in both directions', () => {
  const gate = gateForItem(snapshotLike, 'drive', 'BurnerDrivex6');
  assert.equal(gate.gateId, 'Project_BurnerDrive');
  assert.equal(gate.gateKind, 'project');
  const unlocks = unlocksForGate(snapshotLike, 'Project_BurnerDrive');
  assert.ok(unlocks.unlocks.drive.some(item => item.id === 'BurnerDrivex6'));
});

test('a snapshot without an index reports why, rather than an empty census', () => {
  assert.ok(unlockIndexUnavailableReason({}));
  const census = unlockIndexCensus({});
  assert.equal(census.available, false);
  assert.ok(census.reason);
  // Not zeroed counts -- an absent index and a genuinely empty one must not
  // render identically.
  assert.equal(census.families, null);
  assert.equal(census.totals, null);
  assert.equal(gateForItem({}, 'drive', 'BurnerDrivex6'), null);
  assert.deepEqual(gatesForFamily({}, 'drive'), []);
});

test('the family table names a real template map for every family', () => {
  for (const spec of UNLOCK_FAMILIES) {
    assert.ok(
      templateLoader.templates[spec.templateKey],
      `${spec.family} points at templates.${spec.templateKey}, which does not exist`
    );
  }
});

// ---------------------------------------------------------------------------
// DRIVE STATS
// ---------------------------------------------------------------------------

test('drive stats carry thrustCap, which the tech tree payload does not', () => {
  const drives = buildDriveStats();
  assert.equal(Object.keys(drives).length, 541);
  const burner = drives.BurnerDrivex6;
  assert.equal(burner.EV_kps, 69);
  assert.equal(burner.thrust_N, 648000);
  assert.equal(burner.thrustCap, 24);
  assert.equal(burner.propellant, 'Hydrogen');
  assert.equal(burner.requiredProjectName, 'Project_BurnerDrive');
  // Every drive must carry the four fields the model needs, or report null.
  for (const [id, drive] of Object.entries(drives)) {
    for (const field of ['EV_kps', 'thrust_N', 'thrustCap']) {
      assert.ok(
        drive[field] === null || typeof drive[field] === 'number',
        `${id}.${field} must be a number or null, never undefined`
      );
    }
  }
});

test('the EV-multiplier module table is complete and carries its propellant gate', () => {
  const modules = buildPropellantModules();
  assert.equal(Object.keys(modules).length, 5);
  assert.equal(modules.LiquidHydrogenContainment.evMultiplier, 1.2);
  assert.equal(modules.SlushHydrogenTankage.evMultiplier, 1.35);
  assert.equal(modules.HydronTrap.evMultiplier, 1.5);
  for (const [id, module] of Object.entries(modules)) {
    assert.equal(module.requiresHydrogenPropellant, true, `${id} should carry its propellant requirement`);
    assert.ok(typeof module.evMultiplier === 'number');
  }
});

test('project gating captures faction restriction and non-researchable cost', () => {
  const gating = buildProjectGating();
  assert.ok(Object.keys(gating).length > 0);
  // The alien master projects are restricted to the alien faction template AND
  // carry researchCost -1. Both are reasons a human faction can never get them.
  const alien = gating.Project_AlienMasterProject;
  assert.ok(alien, 'the alien master project must be gated');
  assert.deepEqual(alien.factionPrereq, ['AlienCouncil']);
  assert.equal(alien.researchable, false);
  // An ordinary project carries no row at all.
  assert.equal(gating.Project_BurnerDrive, undefined);
});

// ---------------------------------------------------------------------------
// AVAILABILITY -- §3b
// ---------------------------------------------------------------------------

/**
 * A minimal snapshot exercising all five reachable states.
 *
 * Hand-built rather than taken from a save so each state is present exactly
 * once and the assertions are unambiguous.
 */
const availabilitySnapshot = () => ({
  factions: [{
    ID: 7,
    displayName: 'Test Faction',
    templateName: 'ExploitCouncil',
    completedProjects: ['Project_Done'],
    availableProjectNames: ['Project_Offered'],
    availableProjectsCount: 1,
    totalResearch: 100
  }],
  projectGating: {
    Project_TheirsOnly: { factionPrereq: ['AlienCouncil'], factionAvailableChance: 100, researchCost: 500, researchable: true },
    Project_NeverResearched: { factionPrereq: null, factionAvailableChance: 100, researchCost: -1, researchable: false }
  },
  techTree: {
    finishedTechsNames: ['Tech_Done'],
    globalActive: [],
    factionStatus: { 7: { completedProjects: ['Project_Done'], availableProjectNames: ['Project_Offered'], currentProjects: [] } },
    nodes: [
      { id: 'Tech_Done', displayName: 'Done Tech', type: 'global_tech', researchCost: 100, prerequisites: [], alternatePrerequisites: [], effects: [], unlocks: [] },
      { id: 'Tech_Missing', displayName: 'Missing Tech', type: 'global_tech', researchCost: 100, prerequisites: [], alternatePrerequisites: [], effects: [], unlocks: [] },
      { id: 'Project_Done', displayName: 'Done', type: 'faction_project', researchCost: 100, researchProgress: 0, prerequisites: [], alternatePrerequisites: [], effects: [], unlocks: [], availability: { known: true, initialPercent: 0, deltaPercent: 5, maxPercent: 100, expectedMonths: 4 } },
      { id: 'Project_Offered', displayName: 'Offered', type: 'faction_project', researchCost: 1000, researchProgress: 250, prerequisites: [{ id: 'Tech_Done', type: 'global_tech' }], alternatePrerequisites: [], effects: [], unlocks: [], availability: { known: true, initialPercent: 0, deltaPercent: 5, maxPercent: 100, expectedMonths: 4 } },
      { id: 'Project_Unrolled', displayName: 'Unrolled', type: 'faction_project', researchCost: 2000, researchProgress: 0, prerequisites: [{ id: 'Tech_Done', type: 'global_tech' }], alternatePrerequisites: [], effects: [], unlocks: [], availability: { known: true, initialPercent: 0, deltaPercent: 5, maxPercent: 50, expectedMonths: 12 } },
      { id: 'Project_Blocked', displayName: 'Blocked', type: 'faction_project', researchCost: 3000, researchProgress: 0, prerequisites: [{ id: 'Tech_Missing', type: 'global_tech' }], alternatePrerequisites: [], effects: [], unlocks: [], availability: { known: true, initialPercent: 0, deltaPercent: 5, maxPercent: 100, expectedMonths: 4 } },
      { id: 'Project_TheirsOnly', displayName: 'Theirs Only', type: 'faction_project', researchCost: 500, researchProgress: 0, prerequisites: [{ id: 'Tech_Done', type: 'global_tech' }], alternatePrerequisites: [], effects: [], unlocks: [], availability: { known: true, initialPercent: 100, deltaPercent: 100, maxPercent: 100, expectedMonths: 1 } },
      { id: 'Project_NeverResearched', displayName: 'Never Researched', type: 'faction_project', researchCost: -1, researchProgress: 0, prerequisites: [], alternatePrerequisites: [], effects: [], unlocks: [], availability: { known: true, initialPercent: 100, deltaPercent: 100, maxPercent: 100, expectedMonths: 1 } }
    ]
  }
});

test('the three §3b states are distinct, and the middle one carries its odds', () => {
  const resolver = buildAvailabilityResolver(availabilitySnapshot(), 'player', 7);
  assert.equal(resolver.available, true);
  assert.equal(resolver.availabilitySource, 'factions[observer].availableProjectNames');

  assert.equal(resolver.resolve('Project_Done').state, AVAILABILITY_STATES.completed);
  assert.equal(resolver.resolve('Project_Offered').state, AVAILABILITY_STATES.researchableNow);

  // The state the spec exists to protect: prerequisites met, not yet offered.
  const unrolled = resolver.resolve('Project_Unrolled');
  assert.equal(unrolled.state, AVAILABILITY_STATES.prereqClearUnrolled);
  assert.deepEqual(unrolled.missingPrerequisites, []);
  assert.equal(unrolled.unlockChance.maxPercent, 50);
  assert.equal(unrolled.unlockChance.deltaPercentPerMonth, 5);
  assert.equal(unrolled.unlockChance.certain, false);
  assert.match(unrolled.reason, /rolls monthly/);
  assert.match(unrolled.reason, /may never land/, 'a cap below 100% must say so');

  const blocked = resolver.resolve('Project_Blocked');
  assert.equal(blocked.state, AVAILABILITY_STATES.prereqBlocked);
  assert.equal(blocked.missingPrerequisites.length, 1);
  assert.equal(blocked.missingPrerequisites[0].id, 'Tech_Missing');
  assert.match(blocked.reason, /Missing Tech/);

  // All three are different values. Collapsing any pair is the failure mode.
  const states = new Set([unrolled.state, blocked.state, resolver.resolve('Project_Offered').state]);
  assert.equal(states.size, 3);
});

test('availability comes from the list, never from prerequisites', () => {
  const snapshot = availabilitySnapshot();
  // A project with every prerequisite met but absent from the list must NOT be
  // offered. On the live save this is 104 of 274 such projects.
  assert.equal(resolveState(snapshot, 'Project_Unrolled'), AVAILABILITY_STATES.prereqClearUnrolled);

  // And a project on the list is researchable even with unmet prerequisites --
  // 5 such on the live save. The list wins in both directions.
  snapshot.factions[0].availableProjectNames = ['Project_Blocked'];
  snapshot.factions[0].availableProjectsCount = 1;
  assert.equal(resolveState(snapshot, 'Project_Blocked'), AVAILABILITY_STATES.researchableNow);
});

test('a faction-restricted project is never reported as prerequisite-clear', () => {
  const snapshot = availabilitySnapshot();
  const restricted = buildAvailabilityResolver(snapshot, 'player', 7).resolve('Project_TheirsOnly');
  assert.equal(restricted.state, AVAILABILITY_STATES.factionRestricted);
  assert.match(restricted.reason, /AlienCouncil/);
  assert.match(restricted.reason, /ExploitCouncil/);

  // Its prerequisites ARE met, so without the gating it would have read as
  // "prerequisites clear, rolls at 100%/month" -- imminent, and unreachable.
  assert.notEqual(restricted.state, AVAILABILITY_STATES.prereqClearUnrolled);
});

test('a project with researchCost -1 reports a null cost, not a free one', () => {
  const never = buildAvailabilityResolver(availabilitySnapshot(), 'player', 7).resolve('Project_NeverResearched');
  assert.equal(never.researchCost, null, 'a negative cost is a marker, not a cost');
  assert.equal(never.remainingResearchCost, null);
  assert.notEqual(never.remainingResearchCost, 0);
  assert.equal(never.state, AVAILABILITY_STATES.factionRestricted);
});

test('remaining cost subtracts progress, and months need a measured income', () => {
  const offered = buildAvailabilityResolver(availabilitySnapshot(), 'player', 7).resolve('Project_Offered');
  assert.equal(offered.researchCost, 1000);
  assert.equal(offered.researchProgress, 250);
  assert.equal(offered.remainingResearchCost, 750);
  assert.equal(monthsAtIncome(750, 100), 7.5);
  // Absent stays null: without an income there is no honest number of months,
  // and 0 would read as "immediate".
  assert.equal(monthsAtIncome(750, null), null);
  assert.equal(monthsAtIncome(750, 0), null);
  assert.equal(monthsAtIncome(null, 100), null);
});

test('an observer whose project list is redacted reports unknown, not empty', () => {
  const snapshot = availabilitySnapshot();
  snapshot.factions[0].availableProjectNames = [];
  snapshot.factions[0].availableProjectsCount = null;
  snapshot.techTree.factionStatus[7].availableProjectNames = [];
  const resolver = buildAvailabilityResolver(snapshot, 'player', 7);
  assert.equal(resolver.availabilityKnown, false);
  const result = resolver.resolve('Project_Unrolled');
  assert.equal(result.state, AVAILABILITY_STATES.unknown);
  assert.match(result.reason, /unresolvable/);
  // A faction that genuinely has none is different, and is known.
  snapshot.factions[0].availableProjectsCount = 0;
  assert.equal(buildAvailabilityResolver(snapshot, 'player', 7).availabilityKnown, true);
});

test('a snapshot with no tech tree says so instead of blocking everything', () => {
  const resolver = buildAvailabilityResolver({ factions: [] }, 'player', 7);
  assert.equal(resolver.available, false);
  assert.match(resolver.reason, /no tech tree/);
  const result = resolver.resolve('Project_Anything');
  assert.equal(result.state, AVAILABILITY_STATES.unknown);
  assert.notEqual(result.state, AVAILABILITY_STATES.prereqBlocked);
});

test('state tallies count every state, including the ones with no members', () => {
  const counts = tallyAvailabilityStates([
    { state: AVAILABILITY_STATES.researchableNow },
    { state: AVAILABILITY_STATES.researchableNow },
    { state: AVAILABILITY_STATES.prereqBlocked }
  ]);
  assert.equal(counts[AVAILABILITY_STATES.researchableNow], 2);
  assert.equal(counts[AVAILABILITY_STATES.prereqBlocked], 1);
  assert.equal(counts[AVAILABILITY_STATES.prereqClearUnrolled], 0);
  assert.equal(Object.keys(counts).length, Object.keys(AVAILABILITY_STATES).length);
});

function resolveState(snapshot, projectId) {
  return buildAvailabilityResolver(snapshot, 'player', 7).resolve(projectId).state;
}
