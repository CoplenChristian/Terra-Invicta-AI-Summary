// `/api/intel/propulsion` -- the endpoint, in both modes and on a turn-1 save.
//
// The §0 requirement this file exists for: nothing may be campaign-specific.
// The turn-1 tests below run against a faction that flies nothing, has
// completed nothing, and can research only chemical rockets. If the module
// needs a late save to say anything, it has been written against one campaign
// rather than against the data, and these fail.
//
// The templates baked into the snapshot are the real installed ones. Only the
// campaign state is synthetic, so the turn-1 case exercises the same 541-drive
// catalogue and the same 1,223-entry unlock index the live save does.

const { test } = require('node:test');
const assert = require('node:assert');

const snapshotBuilder = require('../server/snapshotBuilder');
const snapshotIdentity = require('../server/snapshotIdentity');
const intelligenceFilter = require('../server/intelligenceFilter');
const { makeSaveData } = require('./fixtures/syntheticSave');
const {
  INTEL_ENDPOINT_EXAMPLES,
  INTEL_ENDPOINT_INDEX,
  SUPPORTED_RESOURCES,
  buildResourceProjection
} = require('../shared/intel/registry.mjs');
const { AVAILABILITY_STATES } = require('../shared/researchAvailability.mjs');

const OBSERVER = 4712;

/** The chemical rockets a turn-1 faction actually starts with. */
const TURN_ONE_AVAILABLE = [
  'Project_Solid-FuelSpaceRockets',
  'Project_Liquid-FuelRockets'
];

function filtered(save, mode) {
  const raw = snapshotBuilder.buildRawSnapshot(save);
  const identity = snapshotIdentity.createSnapshotIdentity(
    { fullPath: 'synthetic.gz', lastModified: new Date('2025-01-01T00:00:00Z'), saveHash: 'x' },
    'initiative'
  );
  return intelligenceFilter.applyFilter({ ...raw, ...identity }, mode, OBSERVER);
}

/**
 * Turn one: no hulls, no completed projects, two chemical rockets offered.
 *
 * Built by stripping a real snapshot rather than by hand, so every static
 * payload -- unlock index, drive catalogue, tech tree, project gating -- is the
 * genuine article.
 */
function turnOneSnapshot(mode = 'player') {
  const snapshot = filtered(makeSaveData({ ships: 0 }), mode);
  snapshot.fleets = [];
  snapshot.shipDesigns = [];
  for (const faction of snapshot.factions) {
    faction.completedProjects = [];
    faction.currentProjects = [];
    faction.availableProjectNames = faction.ID === OBSERVER ? [...TURN_ONE_AVAILABLE] : [];
    faction.availableProjectsCount = faction.ID === OBSERVER ? TURN_ONE_AVAILABLE.length : 0;
    faction.totalResearch = faction.ID === OBSERVER ? 12 : 0;
  }
  if (snapshot.techTree) {
    snapshot.techTree.finishedTechsNames = [];
    snapshot.techTree.globalActive = [];
    snapshot.techTree.factionStatus = Object.fromEntries(
      Object.keys(snapshot.techTree.factionStatus || {}).map(id => [id, {
        completedProjects: [],
        availableProjectNames: Number(id) === OBSERVER ? [...TURN_ONE_AVAILABLE] : [],
        currentProjects: []
      }])
    );
  }
  return snapshot;
}

const project = (snapshot, options = {}) => buildResourceProjection(snapshot, 'propulsion', {
  mode: 'player',
  ...options
});

// ---------------------------------------------------------------------------
// REGISTRATION
// ---------------------------------------------------------------------------

test('the endpoint is registered the same way every other intel endpoint is', () => {
  assert.ok(SUPPORTED_RESOURCES.has('propulsion'));
  assert.equal(INTEL_ENDPOINT_INDEX.propulsion, '/api/intel/propulsion');
  assert.ok(INTEL_ENDPOINT_EXAMPLES.propulsion, 'the discovery index must carry an example query');
});

// ---------------------------------------------------------------------------
// TURN ONE -- §0
// ---------------------------------------------------------------------------

test('a turn-1 observer flying nothing gets a truthful answer, not a crash or a fabricated best', () => {
  const snapshot = turnOneSnapshot();
  const result = project(snapshot, { observerId: OBSERVER });

  assert.equal(result.resource, 'propulsion');
  assert.equal(result.count, 0);
  assert.deepEqual(result.items, []);
  assert.equal(result.fleet.designsInService, 0);
  assert.equal(result.fleet.shipsResolved, 0);
  assert.match(result.fleet.note, /no hulls in service/);

  // The static half is fully available even with nothing flown.
  assert.equal(result.unlockIndex.available, true);
  assert.equal(result.unlockIndex.totals.gatedEntries, 1223);
  assert.equal(result.driveCatalogue.available, true);
  assert.equal(result.driveCatalogue.drives, 541);

  // Nothing was compared, and the report says so rather than claiming success.
  assert.equal(result.modelVerification.shipsCompared, 0);
  assert.equal(result.modelVerification.shipsAgreeing, 0);
});

test('a turn-1 observer sees the chemical rockets as researchable and the rest as blocked', () => {
  const snapshot = turnOneSnapshot();
  const result = project(snapshot, { observerId: OBSERVER });

  assert.equal(result.research.availabilityResolvable, true);
  assert.equal(result.research.availableProjectCount, TURN_ONE_AVAILABLE.length);
  assert.equal(result.research.availabilitySource, 'factions[observer].availableProjectNames');
  assert.equal(result.research.monthlyResearchIncome, 12);
});

test('turn-1 availability is read from the list, so a fusion torch is not offered', () => {
  const snapshot = turnOneSnapshot();
  const { buildAvailabilityResolver } = require('../shared/researchAvailability.mjs');
  const resolver = buildAvailabilityResolver(snapshot, 'player', OBSERVER);

  // Offered, because the save's list says so.
  assert.equal(resolver.resolve('Project_Solid-FuelSpaceRockets').state, AVAILABILITY_STATES.researchableNow);

  // Not offered, and blocked on real prerequisites rather than quietly ranked
  // last with a zero.
  const burner = resolver.resolve('Project_BurnerDrive');
  assert.equal(burner.state, AVAILABILITY_STATES.prereqBlocked);
  assert.ok(burner.missingPrerequisites.length > 0);
  assert.equal(burner.researchCost, 5000);
});

test('a turn-1 chemical-only design ranks sensibly with no late-game drives involved', () => {
  // A single unarmed hull on the cheapest rocket in the game: the transport
  // case, at the earliest point a campaign can be in.
  const snapshot = turnOneSnapshot();
  const drive = snapshot.driveStats.ApexSolidRocketx1;
  assert.ok(drive, 'the chemical rocket must be in the real drive catalogue');

  snapshot.shipDesigns = [{
    dataName: 'turnOneDesign',
    _displayName: 'First Shuttle',
    role: 'InnerSystemColonyShip',
    hullName: 'Gunship',
    driveName: 'ApexSolidRocketx1',
    propellantTanks: 4,
    factionId: OBSERVER,
    moduleTemplateEntries: [],
    noseWeaponTemplateEntries: [],
    hullWeaponTemplateEntries: []
  }];
  const dryMassKg = 600000;
  const propellantKg = 400000;
  const wetMassKg = dryMassKg + propellantKg;
  const deltaV = drive.EV_kps * Math.log(wetMassKg / dryMassKg);
  snapshot.fleets = [{
    ID: 1,
    displayName: 'Launch Group',
    factionId: OBSERVER,
    orbitBody: 'Earth',
    ships: [{
      id: 11,
      displayName: 'Shuttle One',
      hullName: 'turnOneDesign',
      currentMassKg: wetMassKg,
      propellantTons: propellantKg / 1000,
      currentDeltaVKps: deltaV,
      currentMaxDeltaVKps: deltaV,
      cruiseAccelerationMps2: drive.thrust_N / wetMassKg,
      combatAccelerationMps2: (drive.thrust_N * drive.thrustCap) / wetMassKg,
      weaponLoadout: []
    }]
  }];

  const result = project(snapshot, { observerId: OBSERVER, limit: 5 });
  assert.equal(result.count, 1);
  const design = result.items[0];

  assert.equal(design.role.role, 'transport', 'an unarmed hull is a transport');
  assert.equal(design.ranking.rankBy, 'deltaVKps');
  assert.equal(design.modelAgreement.allAgree, true, 'the model must reproduce the chemical case exactly too');

  // The floor is the design's own measured acceleration, not a constant.
  assert.ok(Math.abs(design.ranking.floorValue - design.rated.combatAccelerationMps2) < 1e-6);

  // The fitted drive is always present, so the comparison baseline is visible.
  const fitted = design.refits.find(row => row.isFittedDrive);
  assert.ok(fitted, 'the fitted drive must survive the limit');
  assert.equal(fitted.driveId, 'ApexSolidRocketx1');
  assert.ok(Math.abs(fitted.deltaVKps - deltaV) < deltaV * 0.005);

  // Everything a turn-1 faction cannot reach is labelled, not hidden.
  assert.ok(design.candidateStates[AVAILABILITY_STATES.prereqBlocked] > 0);
  assert.equal(design.candidateStates[AVAILABILITY_STATES.researchableNow] >= 0, true);

  // No fabricated recommendation: a state with no member is explicitly null.
  for (const [state, best] of Object.entries(design.bestByState)) {
    if (best === null) continue;
    assert.ok(best.driveId, `${state} best row must name a drive`);
    assert.notEqual(best.driveId, fitted.driveId, 'bestByState excludes the fitted drive');
  }
});

// ---------------------------------------------------------------------------
// MODE
// ---------------------------------------------------------------------------

test('the static half of the answer is identical in both modes', () => {
  // Templates are public game data. Nothing about the unlock index or the drive
  // catalogue is observer-dependent, so a mode difference here would be a bug.
  const player = project(turnOneSnapshot('player'), { observerId: OBSERVER, mode: 'player' });
  const omniscient = project(turnOneSnapshot('omniscient'), { observerId: OBSERVER, mode: 'omniscient' });

  assert.deepEqual(player.unlockIndex.families, omniscient.unlockIndex.families);
  assert.deepEqual(player.unlockIndex.totals, omniscient.unlockIndex.totals);
  assert.equal(player.driveCatalogue.drives, omniscient.driveCatalogue.drives);
  assert.deepEqual(player.formulae, omniscient.formulae);
});

test('a ship whose design is redacted is reported as unresolvable, never dropped', () => {
  const snapshot = turnOneSnapshot('player');
  snapshot.shipDesigns = [];
  snapshot.fleets = [{
    ID: 1,
    displayName: 'Observed Group',
    factionId: OBSERVER,
    ships: [{
      id: 11,
      displayName: 'Unattributed Hull',
      hullName: 'someRedactedDesign',
      currentMassKg: 1000000,
      propellantTons: 200,
      currentDeltaVKps: 12.5,
      currentMaxDeltaVKps: 12.5,
      cruiseAccelerationMps2: 0.02,
      combatAccelerationMps2: 0.48
    }]
  }];

  const result = project(snapshot, { observerId: OBSERVER });
  assert.equal(result.fleet.designsInService, 0);
  assert.equal(result.fleet.shipsUnresolved, 1);
  assert.equal(result.unresolvedShips.length, 1);
  assert.match(result.unresolvedShips[0].reason, /redacted in player mode|not present/);
  // The save's own measurements survive redaction and are still reported.
  assert.equal(result.unresolvedShips[0].measured.maxDeltaVKps, 12.5);
});

test('the alien benchmark degrades honestly when alien designs are redacted', () => {
  const snapshot = turnOneSnapshot('player');
  snapshot.factions.push({ ID: 4717, displayName: 'the Aliens', templateName: 'AlienCouncil' });
  snapshot.shipDesigns = [];
  snapshot.fleets = [{
    ID: 2,
    displayName: 'Alien Formation',
    factionId: 4717,
    ships: [{
      id: 21,
      displayName: 'Alien Hull',
      hullName: 'redacted',
      currentMaxDeltaVKps: 691,
      combatAccelerationMps2: 25,
      cruiseAccelerationMps2: 0.5
    }]
  }];

  const result = project(snapshot, { observerId: OBSERVER });
  const benchmark = result.alienBenchmark;
  assert.equal(benchmark.available, true);
  assert.equal(benchmark.designAttributionAvailable, false);
  assert.equal(benchmark.alienDesignsVisible, 0);
  assert.match(benchmark.basis, /redacted/);
  // Observed fleet metrics survive and are used.
  assert.equal(benchmark.observed.medianMaxDeltaVKps, 691);
  // The observer has no hulls, so the gap is UNMEASURED -- not parity, not zero.
  assert.equal(benchmark.observer.medianMaxDeltaVKps, null);
  assert.equal(benchmark.gap.maxDeltaVMultiple, null);
});

test('no alien faction at all is reported as such, not as an absent threat', () => {
  const snapshot = turnOneSnapshot();
  snapshot.factions = snapshot.factions.filter(faction => faction.ID !== 4717);
  const result = project(snapshot, { observerId: OBSERVER });
  assert.equal(result.alienBenchmark.available, false);
  assert.ok(result.alienBenchmark.reason);
});

// ---------------------------------------------------------------------------
// DEGRADED SNAPSHOTS
// ---------------------------------------------------------------------------

test('a snapshot published before the drive catalogue existed says so', () => {
  const snapshot = turnOneSnapshot();
  delete snapshot.driveStats;
  delete snapshot.unlockIndex;
  const result = project(snapshot, { observerId: OBSERVER });

  assert.equal(result.driveCatalogue.available, false);
  assert.match(result.driveCatalogue.reason, /re-publish/);
  assert.equal(result.driveCatalogue.drives, 0);
  assert.equal(result.unlockIndex.available, false);
  assert.ok(result.unlockIndex.reason);
  assert.equal(result.unlockIndex.driveGates, null);
  // Degraded, not crashed.
  assert.equal(Array.isArray(result.items), true);
});

test('the rendered payload contains no undefined or NaN', () => {
  const snapshot = turnOneSnapshot();
  const serialised = JSON.stringify(project(snapshot, { observerId: OBSERVER }));
  assert.ok(!/:\s*NaN/.test(serialised), 'NaN must never reach the response');
  assert.ok(!/undefined/.test(serialised), 'undefined must never reach the response');
  assert.ok(!serialised.includes('"rawShip"'), 'the raw save ship record must not be re-emitted');
  assert.ok(!serialised.includes('"designRecord"'), 'the raw design record must not be re-emitted');
});

test('the limit is bounded and the fitted drive is never squeezed out by it', () => {
  const snapshot = turnOneSnapshot();
  snapshot.shipDesigns = [{
    dataName: 'd1',
    hullName: 'Gunship',
    driveName: 'ApexSolidRocketx1',
    propellantTanks: 4,
    factionId: OBSERVER,
    moduleTemplateEntries: [],
    noseWeaponTemplateEntries: [{ moduleName: 'Gun' }],
    hullWeaponTemplateEntries: []
  }];
  snapshot.fleets = [{
    ID: 1,
    factionId: OBSERVER,
    displayName: 'G',
    ships: [{
      id: 1,
      displayName: 'S',
      hullName: 'd1',
      currentMassKg: 1000000,
      propellantTons: 400,
      currentDeltaVKps: 1.33,
      currentMaxDeltaVKps: 1.33,
      cruiseAccelerationMps2: 14.82,
      combatAccelerationMps2: 14.82,
      weaponLoadout: [{ role: 'Kinetic', count: 1, systems: ['Gun'] }]
    }]
  }];

  for (const limit of [1, 3, 500, null]) {
    const result = project(snapshot, { observerId: OBSERVER, limit });
    const design = result.items[0];
    assert.ok(design.refits.some(row => row.isFittedDrive), `limit ${limit} dropped the fitted drive`);
    assert.ok(design.refits.length <= 101, `limit ${limit} exceeded the hard cap`);
  }
});
