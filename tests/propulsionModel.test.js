// The propulsion model's guarantee.
//
// `shared/propulsion.mjs` claims to reproduce the game's own delta-V and
// acceleration figures. This file is where that claim is checked, against real
// measured game output frozen into `tests/fixtures/propulsionSample.json`:
// 42 observer ships, one damaged hull, and one alien hull, each carrying the
// four performance columns exactly as the save reported them.
//
// The fixture is deliberately real rather than synthetic. A synthetic ship
// would be built from the same formula the model uses, so agreement would be
// tautological -- the test would pass and prove nothing. These numbers came out
// of the game, so the model has something independent to be wrong about.
//
// A test that only passes proves nothing, so the non-vacuity checks below
// perturb each term of the formula and assert the comparison FAILS. If the
// game's formula ever changes, these tests break loudly rather than quietly
// agreeing with themselves.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const {
  DESIGN_ROLES,
  MODEL_AGREEMENT_TOLERANCE,
  accelerationMps2,
  deltaVKps,
  effectiveExhaustVelocity,
  inferDesignRole,
  rankRefits,
  refitOntoDrive,
  resolveShipMass,
  shipPropulsion
} = require('../shared/propulsion.mjs');

const SAMPLE = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'propulsionSample.json'), 'utf8')
);

const OBSERVER = SAMPLE.provenance.observerFactionId;
const observerRows = SAMPLE.ships.filter(row => row.faction === OBSERVER);

const propulsionFor = (row, overrides = {}) => shipPropulsion({
  ship: row.ship,
  design: SAMPLE.designs[row.ship.hullName] || null,
  driveStats: overrides.driveStats || SAMPLE.driveStats,
  propellantModules: overrides.propellantModules || SAMPLE.propellantModules
});

// ---------------------------------------------------------------------------
// THE GUARANTEE
// ---------------------------------------------------------------------------

test('the computed delta-V matches the save\'s own figure for every observer ship', () => {
  assert.ok(observerRows.length >= 40, `expected the observer's fleet in the fixture, got ${observerRows.length} ships`);

  const failures = [];
  for (const row of observerRows) {
    const result = propulsionFor(row);
    assert.equal(result.resolved, true, `${row.ship.displayName} should resolve to a design and drive`);

    for (const column of ['deltaV', 'maxDeltaV']) {
      const comparison = result.agreement[column];
      assert.equal(
        comparison.agrees,
        true,
        `${row.ship.displayName} ${column}: modelled ${comparison.modelled} vs save ${comparison.measured} (ratio ${comparison.ratio})`
      );
      if (comparison.agrees !== true) failures.push(row.ship.displayName);
    }
  }
  assert.equal(failures.length, 0);
});

test('cruise and combat acceleration match the save for every observer ship', () => {
  for (const row of observerRows) {
    const result = propulsionFor(row);
    for (const column of ['cruiseAcceleration', 'combatAcceleration']) {
      const comparison = result.agreement[column];
      assert.equal(
        comparison.agrees,
        true,
        `${row.ship.displayName} ${column}: modelled ${comparison.modelled} vs save ${comparison.measured} (ratio ${comparison.ratio})`
      );
    }
  }
});

test('the combat/cruise ratio the save reports resolves to the drive thrustCap', () => {
  for (const row of observerRows) {
    const design = SAMPLE.designs[row.ship.hullName];
    const drive = SAMPLE.driveStats[design.driveName];
    const measuredRatio = row.ship.combatAccelerationMps2 / row.ship.cruiseAccelerationMps2;
    assert.ok(
      Math.abs(measuredRatio - drive.thrustCap) < 0.01,
      `${row.ship.displayName}: save ratio ${measuredRatio} against thrustCap ${drive.thrustCap}`
    );
  }
});

// ---------------------------------------------------------------------------
// NON-VACUITY -- each of these must FAIL when the formula is perturbed
// ---------------------------------------------------------------------------

test('dropping the EV multiplier term breaks the model on a design that carries one', () => {
  // Without this term the model reproduced delta-V for only four of the eight
  // factions in the save. It is not decoration, and this asserts it.
  const rowWithMultiplier = SAMPLE.ships.find(row => {
    const design = SAMPLE.designs[row.ship.hullName];
    if (!design) return false;
    const drive = SAMPLE.driveStats[design.driveName];
    const ev = effectiveExhaustVelocity(drive, design, SAMPLE.propellantModules);
    return ev.multiplier !== 1 && row.ship.currentDeltaVKps;
  });
  assert.ok(rowWithMultiplier, 'the fixture must contain at least one design carrying an EV-multiplier module');

  const withTerm = propulsionFor(rowWithMultiplier);
  assert.equal(withTerm.agreement.deltaV.agrees, true);

  // Same ship, with the multiplier table emptied.
  const withoutTerm = propulsionFor(rowWithMultiplier, { propellantModules: {} });
  assert.equal(
    withoutTerm.agreement.deltaV.agrees,
    false,
    'removing the EV-multiplier table must break agreement, or the term is not being applied'
  );
});

test('perturbing exhaust velocity, thrust or thrustCap each breaks the model', () => {
  const row = observerRows[0];
  const design = SAMPLE.designs[row.ship.hullName];
  const drive = SAMPLE.driveStats[design.driveName];

  const baseline = propulsionFor(row);
  assert.equal(baseline.agreement.allAgree, true, 'the unperturbed model must agree first');

  const perturbations = [
    { field: 'EV_kps', column: 'deltaV' },
    { field: 'thrust_N', column: 'cruiseAcceleration' },
    { field: 'thrustCap', column: 'combatAcceleration' }
  ];

  for (const { field, column } of perturbations) {
    // 2% -- comfortably outside the 0.5% agreement tolerance, small enough that
    // it could plausibly be a real formula change rather than an obvious typo.
    const mutated = {
      ...SAMPLE.driveStats,
      [design.driveName]: { ...drive, [field]: drive[field] * 1.02 }
    };
    const result = propulsionFor(row, { driveStats: mutated });
    assert.equal(
      result.agreement[column].agrees,
      false,
      `a 2% change to ${field} must break ${column} agreement; tolerance is ${MODEL_AGREEMENT_TOLERANCE}`
    );
  }
});

test('using current mass instead of full-tank mass breaks acceleration on a partly fuelled hull', () => {
  // The save reports acceleration at FULL tanks, not current mass. On this
  // fixture the difference is up to 1.7x, so a model that used current mass
  // would look right on full ships and be wrong on every partly fuelled one.
  const partial = observerRows.find(row => {
    const result = propulsionFor(row);
    return result.mass.fullWetMassKg !== null &&
      Math.abs(result.mass.fullWetMassKg - result.mass.currentWetMassKg) > result.mass.fullWetMassKg * 0.05;
  });
  assert.ok(partial, 'the fixture must contain at least one partly fuelled observer ship');

  const result = propulsionFor(partial);
  assert.equal(result.agreement.cruiseAcceleration.agrees, true);

  const drive = SAMPLE.driveStats[SAMPLE.designs[partial.ship.hullName].driveName];
  const atCurrentMass = accelerationMps2(drive.thrust_N, result.mass.currentWetMassKg, 1);
  const wrongRatio = atCurrentMass / partial.ship.cruiseAccelerationMps2;
  assert.ok(
    Math.abs(wrongRatio - 1) > MODEL_AGREEMENT_TOLERANCE,
    `computing at current mass must NOT agree; got ratio ${wrongRatio}`
  );
});

// ---------------------------------------------------------------------------
// DISAGREEMENT IS REPORTED, NOT HIDDEN
// ---------------------------------------------------------------------------

test('a hull the model cannot explain is reported as disagreeing, not silently accepted', () => {
  const anomalous = SAMPLE.ships.filter(row => row.note !== null);
  assert.ok(anomalous.length >= 2, 'the fixture must carry the damaged and alien hulls');

  const disagreements = anomalous
    .map(row => ({ row, result: propulsionFor(row) }))
    .filter(({ result }) => result.resolved && result.agreement.allAgree === false);

  assert.ok(
    disagreements.length >= 2,
    'both anomalous hulls must surface as model disagreements rather than passing silently'
  );

  for (const { result } of disagreements) {
    // The disagreement has to be legible: a ratio, both sides, and never a
    // silent substitution of the modelled figure for the measured one.
    const offending = Object.values(result.agreement).find(entry => entry && entry.agrees === false);
    assert.ok(Number.isFinite(offending.ratio), 'a disagreement must report its ratio');
    assert.notEqual(offending.modelled, offending.measured);
  }
});

test('an unresolvable design is reported with a reason, never dropped', () => {
  const row = observerRows[0];
  const result = shipPropulsion({
    ship: row.ship,
    design: null,
    driveStats: SAMPLE.driveStats,
    propellantModules: SAMPLE.propellantModules
  });
  assert.equal(result.resolved, false);
  assert.match(result.unresolvedReason, /redacted in player mode|not present/);
  // The save's own measurements survive: only the drive attribution is lost.
  assert.equal(result.measured.maxDeltaVKps, row.ship.currentMaxDeltaVKps);
  assert.equal(result.modelled, null);
  assert.equal(result.agreement, null);
});

test('a design naming a drive the catalogue does not carry is unresolvable, not skipped', () => {
  const row = observerRows[0];
  const design = { ...SAMPLE.designs[row.ship.hullName], driveName: 'NoSuchDrivex9' };
  const result = shipPropulsion({ ship: row.ship, design, driveStats: SAMPLE.driveStats });
  assert.equal(result.resolved, false);
  assert.match(result.unresolvedReason, /NoSuchDrivex9/);
});

// ---------------------------------------------------------------------------
// ABSENT STAYS NULL
// ---------------------------------------------------------------------------

test('a ship with no measurable mass yields null, never zero', () => {
  const row = observerRows[0];
  for (const field of ['currentMassKg', 'propellantTons']) {
    const ship = { ...row.ship, [field]: null };
    const result = shipPropulsion({
      ship,
      design: SAMPLE.designs[row.ship.hullName],
      driveStats: SAMPLE.driveStats,
      propellantModules: SAMPLE.propellantModules
    });
    assert.equal(result.mass.dryMassKg, null, `${field} absent must leave dry mass null`);
    assert.equal(result.modelled.deltaVKps, null);
    assert.equal(result.modelled.cruiseAccelerationMps2, null);
    assert.ok(result.mass.unmeasuredReason, 'an unmeasured mass must carry its reason');
    // The comparison could not be made. That is not a disagreement.
    assert.equal(result.agreement.deltaV.agrees, null);
    assert.ok(result.agreement.deltaV.reason);
  }
});

test('a drive with no EV_kps yields a null delta-V, never zero', () => {
  const row = observerRows[0];
  const design = SAMPLE.designs[row.ship.hullName];
  const mutated = {
    ...SAMPLE.driveStats,
    [design.driveName]: { ...SAMPLE.driveStats[design.driveName], EV_kps: null }
  };
  const result = propulsionFor(row, { driveStats: mutated });
  assert.equal(result.drive.effectiveEvKps, null);
  assert.equal(result.modelled.deltaVKps, null);
  assert.notEqual(result.modelled.deltaVKps, 0);
  // Thrust is unaffected, so acceleration is still measurable. Partial data
  // must not zero the columns it does cover.
  assert.ok(result.modelled.cruiseAccelerationMps2 > 0);
});

test('the primitive helpers refuse to coerce absent inputs to zero', () => {
  assert.equal(deltaVKps(null, 100, 50), null);
  assert.equal(deltaVKps(69, null, 50), null);
  assert.equal(deltaVKps(69, 100, null), null);
  assert.equal(deltaVKps(69, 100, 0), null, 'a zero dry mass has no mass ratio');
  assert.equal(accelerationMps2(null, 100), null);
  assert.equal(accelerationMps2(100, null), null);
  assert.equal(accelerationMps2(100, 0), null);
  // '' and null both coerce to 0 through Number(); neither may become a figure.
  assert.equal(deltaVKps('', 100, 50), null);
  assert.equal(accelerationMps2('', 100), null);
});

// ---------------------------------------------------------------------------
// MASS RESOLUTION
// ---------------------------------------------------------------------------

test('full-tank mass is derived from the save, by whichever path the ship supports', () => {
  const bases = new Set();
  for (const row of observerRows) {
    const result = propulsionFor(row);
    assert.ok(result.mass.fullWetMassKg > 0, `${row.ship.displayName} should have a full-tank mass`);
    bases.add(result.mass.fullTankBasis);
  }
  // Both paths must actually be exercised by the fixture, or one of them is
  // untested and could rot unnoticed.
  assert.ok(
    [...bases].some(basis => /at full tanks/.test(basis)),
    'the full-tank shortcut must be exercised'
  );
  assert.ok(
    [...bases].some(basis => /exp\(/.test(basis)),
    'the rocket-equation inversion must be exercised'
  );
});

test('full-tank mass is null when neither path is possible', () => {
  const row = observerRows.find(entry => {
    const result = propulsionFor(entry);
    return /exp\(/.test(result.mass.fullTankBasis || '');
  }) || observerRows[0];
  const ship = { ...row.ship, currentMaxDeltaVKps: null, currentDeltaVKps: row.ship.currentDeltaVKps };
  const mass = resolveShipMass(ship, { evKps: null });
  assert.equal(mass.fullWetMassKg, null);
  assert.ok(mass.unmeasuredReason);
  // Dry mass is still measured; only the rated figures are lost.
  assert.ok(mass.dryMassKg > 0);
});

// ---------------------------------------------------------------------------
// REFITS
// ---------------------------------------------------------------------------

test('a refit onto the fitted drive reproduces the ship\'s own rated figures', () => {
  // The strongest available check that the what-if is trustworthy: refitting a
  // ship onto the drive it already has must return what the save says it does.
  for (const row of observerRows.slice(0, 12)) {
    const design = SAMPLE.designs[row.ship.hullName];
    const baseline = propulsionFor(row);
    const refit = refitOntoDrive({
      baseline,
      design,
      candidateDriveId: design.driveName,
      candidateDrive: SAMPLE.driveStats[design.driveName],
      propellantModules: SAMPLE.propellantModules
    });
    assert.equal(refit.computable, true);
    const dvRatio = refit.deltaVKps / row.ship.currentMaxDeltaVKps;
    const accelRatio = refit.combatAccelerationMps2 / row.ship.combatAccelerationMps2;
    assert.ok(Math.abs(dvRatio - 1) < MODEL_AGREEMENT_TOLERANCE, `${row.ship.displayName} refit delta-V ratio ${dvRatio}`);
    assert.ok(Math.abs(accelRatio - 1) < MODEL_AGREEMENT_TOLERANCE, `${row.ship.displayName} refit accel ratio ${accelRatio}`);
  }
});

test('a refit that loses the hydrogen EV multiplier reports the module as inapplicable', () => {
  const row = observerRows.find(entry => {
    const design = SAMPLE.designs[entry.ship.hullName];
    const drive = SAMPLE.driveStats[design.driveName];
    return effectiveExhaustVelocity(drive, design, SAMPLE.propellantModules).multiplier !== 1;
  });
  if (!row) return; // fixture carries no multiplier design; the term is covered above

  const design = SAMPLE.designs[row.ship.hullName];
  const baseline = propulsionFor(row);
  // ApexSolidRocket burns ReactionProducts, so hydrogen tankage does nothing.
  const refit = refitOntoDrive({
    baseline,
    design,
    candidateDriveId: 'ApexSolidRocketx1',
    candidateDrive: SAMPLE.driveStats.ApexSolidRocketx1,
    propellantModules: SAMPLE.propellantModules
  });
  assert.equal(refit.computable, true);
  assert.equal(refit.evMultiplier, 1, 'a non-hydrogen drive must not inherit the hydrogen multiplier');
  assert.ok(refit.inapplicableEvModules.length > 0);
  assert.match(refit.inapplicableEvModules[0].reason, /hydrogen/i);
});

test('a refit against an unmeasurable baseline is reported as uncomputable, not as zero', () => {
  const row = observerRows[0];
  const design = SAMPLE.designs[row.ship.hullName];
  const refit = refitOntoDrive({
    baseline: { mass: { dryMassKg: null, fullWetMassKg: null, unmeasuredReason: 'no mass in snapshot' }, drive: null },
    design,
    candidateDriveId: 'HeliconDrivex6',
    candidateDrive: SAMPLE.driveStats.HeliconDrivex6,
    propellantModules: SAMPLE.propellantModules
  });
  assert.equal(refit.computable, false);
  assert.equal(refit.deltaVKps, null);
  assert.equal(refit.combatAccelerationMps2, null);
  assert.ok(refit.reason);
});

// ---------------------------------------------------------------------------
// ROLE AND RANKING
// ---------------------------------------------------------------------------

test('role is inferred from offensive armament, with point defence excluded', () => {
  const armed = { noseWeaponTemplateEntries: [{ moduleName: 'RailCannon' }], hullWeaponTemplateEntries: [] };
  assert.equal(inferDesignRole(armed).role, DESIGN_ROLES.warship);

  const unarmed = { noseWeaponTemplateEntries: [], hullWeaponTemplateEntries: [] };
  assert.equal(inferDesignRole(unarmed).role, DESIGN_ROLES.transport);

  // Point-defence-only: a transport that can shoot down a missile is still a
  // transport, and must not be ranked by combat acceleration.
  const pdOnly = inferDesignRole(unarmed, {
    weaponLoadout: [{ role: 'Point Defense', category: 'Laser', count: 2, systems: ['PD Turret'] }]
  });
  assert.equal(pdOnly.role, DESIGN_ROLES.transport);
  assert.equal(pdOnly.offensiveMounts, 0);
  assert.equal(pdOnly.pointDefenseMounts, 2);

  const mixed = inferDesignRole(unarmed, {
    weaponLoadout: [
      { role: 'Point Defense', count: 1, systems: ['PD Turret'] },
      { role: 'Kinetic', count: 2, systems: ['Rail Cannon'] }
    ]
  });
  assert.equal(mixed.role, DESIGN_ROLES.warship);
  assert.equal(mixed.offensiveMounts, 2);

  assert.equal(inferDesignRole(null).role, DESIGN_ROLES.unknown);
});

test('the design\'s own role tag is reported verbatim and never drives the inference', () => {
  const design = { role: 'InnerSystemColonyShip', noseWeaponTemplateEntries: [{ moduleName: 'Laser' }], hullWeaponTemplateEntries: [] };
  const inferred = inferDesignRole(design);
  assert.equal(inferred.roleTagFromSave, 'InnerSystemColonyShip');
  assert.equal(inferred.inferred, true);
  // The tag says colony ship; the fitting says otherwise, and the fitting wins.
  assert.equal(inferred.role, DESIGN_ROLES.warship);
});

test('warships and transports rank on different axes, never a blended score', () => {
  // The finding that dictates the design: a drive offering many times the reach
  // and a fraction of the acceleration must not lead a warship's list.
  const refits = [
    { driveId: 'HighEvLowThrust', deltaVKps: 124, combatAccelerationMps2: 0.002 },
    { driveId: 'FittedDrive', deltaVKps: 20.1, combatAccelerationMps2: 2.62 },
    { driveId: 'Balanced', deltaVKps: 40, combatAccelerationMps2: 1.5 }
  ];

  // A warship's floor is its own reach; every candidate here clears it, so the
  // ordering is decided purely by the role's metric.
  const warship = rankRefits(refits, {
    role: DESIGN_ROLES.warship,
    deltaVFloorKps: 20.1,
    accelerationFloorMps2: 2.62
  });
  assert.equal(warship.ranking.rankBy, 'combatAccelerationMps2');
  assert.ok(warship.ranked.every(row => row.clearsFloor === true), 'every candidate should clear the delta-V floor here');
  assert.equal(warship.ranked[0].driveId, 'FittedDrive');
  assert.equal(warship.ranked[warship.ranked.length - 1].driveId, 'HighEvLowThrust');

  // The same three drives against a barge whose own acceleration is already
  // 0.002, so the acceleration floor excludes nothing and reach decides.
  const transport = rankRefits(refits, {
    role: DESIGN_ROLES.transport,
    deltaVFloorKps: 20.1,
    accelerationFloorMps2: 0.002
  });
  assert.equal(transport.ranking.rankBy, 'deltaVKps');
  assert.ok(transport.ranked.every(row => row.clearsFloor === true));
  assert.equal(transport.ranked[0].driveId, 'HighEvLowThrust');

  // The two orderings must genuinely differ, or the role is not being honoured.
  assert.notEqual(warship.ranked[0].driveId, transport.ranked[0].driveId);
  assert.deepEqual(
    warship.ranked.map(row => row.driveId).reverse(),
    transport.ranked.map(row => row.driveId),
    'on these three drives the two roles order the field in exactly opposite directions'
  );
});

test('the floor is stated, and a candidate below it is flagged rather than hidden', () => {
  const refits = [
    { driveId: 'FastButShort', deltaVKps: 5, combatAccelerationMps2: 9 },
    { driveId: 'Adequate', deltaVKps: 30, combatAccelerationMps2: 3 }
  ];
  const { ranked, ranking } = rankRefits(refits, {
    role: DESIGN_ROLES.warship,
    deltaVFloorKps: 20,
    accelerationFloorMps2: 2
  });
  assert.equal(ranking.floorAxis, 'deltaVKps');
  assert.equal(ranking.floorValue, 20);
  const short = ranked.find(row => row.driveId === 'FastButShort');
  assert.equal(short.clearsFloor, false);
  assert.match(short.floorReason, /deltaVKps falls from 20 to 5/);
  // Still present, and ranked below the one that clears the floor.
  assert.equal(ranked[0].driveId, 'Adequate');
});

test('an uncomputable candidate ranks last and is never treated as zero', () => {
  const refits = [
    { driveId: 'Unknown', deltaVKps: null, combatAccelerationMps2: null, computable: false },
    { driveId: 'Weak', deltaVKps: 10, combatAccelerationMps2: 0.01 }
  ];
  const { ranked } = rankRefits(refits, { role: DESIGN_ROLES.warship, deltaVFloorKps: 5, accelerationFloorMps2: 1 });
  assert.equal(ranked[0].driveId, 'Weak');
  assert.equal(ranked[1].driveId, 'Unknown');
  assert.equal(ranked[1].rankValue, null);
});

test('an unknown role produces no ranking rather than a defaulted one', () => {
  const { ranked, ranking } = rankRefits([{ driveId: 'A', deltaVKps: 1, combatAccelerationMps2: 1 }], {
    role: DESIGN_ROLES.unknown
  });
  assert.equal(ranking, null);
  assert.equal(ranked[0].clearsFloor, null);
  assert.match(ranked[0].floorReason, /role is unknown/);
});
