// Phase 5 of the research advisor: the munition delivery axis.
//
// Spec: docs/research-advisor-spec.md section 3c.
//
// Two of these tests are PINS rather than assertions about our own code. The
// launch-mass acceleration identity and the rocket-equation delta-V identity
// both have to reproduce something the game itself states for every missile
// template, and each is followed by a perturbation that proves the pin is not
// vacuous -- the same standard `tests/militaryValue.test.js` holds the kinetic
// damage formula and the mount hardpoint table to.
//
// Everything else runs against a DETERMINISTIC point-defence census frozen from
// the live save, or against a hand-built two-mount profile whose arithmetic can
// be checked by hand. Nothing here reads the live save: the game is usually
// running and the save folder gains autosaves mid-run, so a live-save
// expectation is a flaky one.

const { test } = require('node:test');
const assert = require('node:assert');

const templateLoader = require('../server/templateLoader');
const { buildComponentStats } = require('../server/snapshot/templates');
const {
  DELIVERY_BASIS_CODES,
  DELIVERY_FORMULAE,
  MUNITION_DELIVERY_AXES,
  buildPointDefenseProfile,
  munitionDelivery
} = require('../shared/munitionDelivery.mjs');
const {
  AXIS_SETS,
  WEAPON_CLASS_SPECS,
  WEAPON_ROLES,
  bestOnAxis,
  rankByAxis,
  weaponMetrics
} = require('../shared/militaryValue.mjs');
const {
  AXIS_KINDS,
  DELIVERY_FLOOR_ORDER,
  compareMilitaryRows,
  deliveryFloorRank
} = require('../shared/researchRanking.mjs');

const G0 = 9.80665;

/** Within `tolerance` as a fraction. Null never "agrees" with anything. */
function near(actual, expected, tolerance, label) {
  assert.notEqual(actual, null, `${label}: expected a measurement, got null`);
  const ratio = actual / expected;
  assert.ok(Math.abs(ratio - 1) <= tolerance,
    `${label}: got ${actual}, expected ${expected} (ratio ${ratio.toFixed(6)})`);
}

const missileTemplates = () => {
  templateLoader.load();
  return [...templateLoader.templates.weaponModules.values()]
    .filter(weapon => weapon.templateFamily === 'missile');
};

// ---------------------------------------------------------------------------
// PIN 1 -- ACCELERATION IS THRUST AT LAUNCH MASS
// ---------------------------------------------------------------------------

test('the stated acceleration is thrust divided by the FULL round mass, for every missile', () => {
  const missiles = missileTemplates();
  assert.equal(missiles.length, 57, 'the missile family must be the full 57 templates');

  let agreed = 0;
  const disagreed = [];
  for (const weapon of missiles) {
    const modelled = weapon['Rocket Thrust'] / weapon.ammoMass_kg / G0;
    // 0.5% is the templates' own rounding: `acceleration_g` ships to two
    // decimals, so 18.27 against a modelled 18.2794 is agreement.
    if (Math.abs(modelled / weapon.acceleration_g - 1) <= 0.005) agreed += 1;
    else disagreed.push(`${weapon.dataName}: ${modelled} vs ${weapon.acceleration_g}`);
  }
  assert.equal(agreed, 57, `acceleration pin failed for: ${disagreed.slice(0, 5).join('; ')}`);

  // The mass composition that makes "launch mass" the right divisor -- exact,
  // not within a tolerance.
  let exact = 0;
  for (const weapon of missiles) {
    if (weapon.fuelMass_kg + weapon.systemMass_kg + weapon.warheadMass_kg === weapon.ammoMass_kg) exact += 1;
  }
  assert.equal(exact, 57, 'ammoMass_kg must be fuel + systems + warhead exactly, for all 57');
});

test('the acceleration pin is not vacuous: dividing by burnout mass breaks it', () => {
  const missiles = missileTemplates();
  // The competing reading -- thrust at DRY mass, which is what an
  // "acceleration" figure would mean if it were quoted at burnout.
  let disagreements = 0;
  for (const weapon of missiles) {
    const dry = weapon.ammoMass_kg - weapon.fuelMass_kg;
    const perturbed = weapon['Rocket Thrust'] / dry / G0;
    if (Math.abs(perturbed / weapon.acceleration_g - 1) > 0.005) disagreements += 1;
  }
  assert.ok(disagreements > missiles.length / 2,
    `the burnout-mass reading must disagree with the shipped figures; only ${disagreements} of ${missiles.length} disagreed`);

  // And perturbing the constant itself, which is the other half of the pin.
  let constantDisagreements = 0;
  for (const weapon of missiles) {
    const perturbed = weapon['Rocket Thrust'] / weapon.ammoMass_kg / 9.5;
    if (Math.abs(perturbed / weapon.acceleration_g - 1) > 0.005) constantDisagreements += 1;
  }
  assert.equal(constantDisagreements, missiles.length,
    'a wrong standard gravity must disagree with every shipped figure');
});

// ---------------------------------------------------------------------------
// PIN 2 -- DELTA-V IS THE ROUND'S OWN BUDGET
// ---------------------------------------------------------------------------

test('the stated delta-V is the rocket equation over the round\'s own propellant, for every missile', () => {
  const missiles = missileTemplates();
  let agreed = 0;
  const disagreed = [];
  for (const weapon of missiles) {
    const modelled = weapon.EV_kps * Math.log(weapon.ammoMass_kg / (weapon.ammoMass_kg - weapon.fuelMass_kg));
    if (Math.abs(modelled / weapon.deltaV_kps - 1) <= 0.005) agreed += 1;
    else disagreed.push(`${weapon.dataName}: ${modelled} vs ${weapon.deltaV_kps}`);
  }
  assert.equal(agreed, 57, `delta-V pin failed for: ${disagreed.slice(0, 5).join('; ')}`);
});

test('the delta-V pin is not vacuous: the wrong mass ratio breaks it', () => {
  const missiles = missileTemplates();
  let disagreements = 0;
  for (const weapon of missiles) {
    // Propellant over dry mass rather than wet over dry -- a plausible misread
    // of the same two fields.
    const perturbed = weapon.EV_kps * Math.log(weapon.fuelMass_kg / (weapon.ammoMass_kg - weapon.fuelMass_kg));
    if (!Number.isFinite(perturbed) || Math.abs(perturbed / weapon.deltaV_kps - 1) > 0.005) disagreements += 1;
  }
  assert.ok(disagreements > missiles.length / 2,
    `a wrong mass ratio must disagree with the shipped figures; only ${disagreements} of ${missiles.length} disagreed`);
});

// ---------------------------------------------------------------------------
// WHICH FAMILIES CARRY THE FLAGS
// ---------------------------------------------------------------------------

test('point-defence targetability and defenceMode are read from the game\'s own flags', () => {
  templateLoader.load();
  const targetable = {};
  const defensive = {};
  for (const weapon of templateLoader.templates.weaponModules.values()) {
    const family = weapon.templateFamily;
    if (weapon.isPointDefenseTargetable === true) targetable[family] = (targetable[family] || 0) + 1;
    if (weapon.defenseMode === true) defensive[family] = (defensive[family] || 0) + 1;
  }

  // Interceptable: guided missiles and unguided slugs. A beam is not, which is
  // why it has no delivery axis rather than an unmeasured one.
  assert.deepEqual(targetable, { magnetic_gun: 70, gun: 4, missile: 57 });

  // Defending: the game's own `defenseMode`, NOT the point-defence weapon role.
  // The role additionally requires `attackMode: false` and would cover only the
  // 9 dedicated turrets, missing every dual-purpose battery.
  assert.equal(defensive.laser_weapon, 121);
  assert.equal(defensive.particle_weapon, 23);
  assert.equal(defensive.gun, 5);
  assert.equal(defensive.magnetic_gun, 10);
  const dedicatedTurrets = [...templateLoader.templates.weaponModules.values()]
    .filter(weapon => weapon.defenseMode === true && weapon.attackMode !== true).length;
  assert.equal(dedicatedTurrets, 9);
  assert.ok(defensive.laser_weapon > dedicatedTurrets,
    'reading defence off the role rather than the flag would lose the dual-purpose batteries');
});

// ---------------------------------------------------------------------------
// THE FROZEN POINT-DEFENCE CENSUS
// ---------------------------------------------------------------------------

/**
 * The point-defence battery of every faction other than the observer, measured
 * on ExitSave (1/1/2034, observer 4712) in PLAYER mode on 2026-08-21.
 *
 * This is a frozen INPUT, not an expectation. It is written out here rather
 * than read from the live save because the game is usually running and the save
 * folder gains autosaves mid-run; an expectation resting on the newest save is
 * a flaky one. The figures it produces below are the numbers section 3c of the
 * spec publishes, and perturbing the model changes them.
 */
const FROZEN_PD_HULLS = 656;
const FROZEN_PD_CENSUS = [
  ['AlienPointDefenseLaserTurret', 283],
  ['Alien256cmVioletLaserCannon', 107],
  ['Alien64cmVioletLaserBattery', 87],
  ['PointDefenseLaserTurret', 87],
  ['AlienPointDefenseParticleBeam', 53],
  ['AdvancedAlienLightMagBattery', 48],
  ['Alien128cmVioletLaserBattery', 40],
  ['Alien768cmVioletLaserCannon', 38],
  ['Alien1024cmVioletLaserCannon', 20],
  ['Alien512cmVioletLaserCannon', 19],
  ['Alien64cmOrangeLaserBattery', 18],
  ['LightIonBattery', 16],
  ['Alien256cmOrangeLaserCannon', 12],
  ['AlienLightMagBattery', 10],
  ['Alien512cmOrangeLaserCannon', 9],
  ['Alien384cmVioletLaserBattery', 8],
  ['Alien128cmOrangeLaserBattery', 6],
  ['Alien1024cmOrangeLaserCannon', 4],
  ['LightRailgunBatteryMk3', 4],
  ['PointDefenseIonBattery', 4],
  ['40mmAutocannon', 3],
  ['Alien384cmOrangeLaserBattery', 2],
  ['HeavyE-BeamBattery', 1],
  ['IonBattery', 1]
];

let cachedStats = null;
function catalogue() {
  if (!cachedStats) cachedStats = buildComponentStats();
  return cachedStats;
}

/** The stats and family for one component id, across every weapon family. */
function findWeapon(id) {
  const stats = catalogue();
  for (const family of ['laser_weapon', 'magnetic_gun', 'gun', 'particle_weapon', 'plasma_weapon', 'missile']) {
    if (stats[family] && stats[family][id]) return { family, stats: stats[family][id] };
  }
  return null;
}

function frozenProfile() {
  return buildPointDefenseProfile({
    key: 'observed-opposing',
    hullsRead: FROZEN_PD_HULLS,
    factions: [],
    basis: 'frozen census, ExitSave 1/1/2034, player mode',
    mounts: FROZEN_PD_CENSUS.map(([id, installations]) => {
      const hit = findWeapon(id);
      assert.ok(hit, `the frozen census names ${id}, which is not in the catalogue`);
      // Phase 2's OWN firing cycle, exactly as production passes it in.
      const metrics = weaponMetrics(id, hit.stats, hit.family);
      return {
        id,
        displayName: hit.stats.displayName || id,
        installations,
        engagementRangeKm: hit.stats.targetingRangeKm ?? null,
        cycleSeconds: metrics.cycleSeconds
      };
    })
  });
}

function deliveryOf(id, profile) {
  const hit = findWeapon(id);
  assert.ok(hit, `${id} must exist in the catalogue`);
  return munitionDelivery(hit.stats, profile);
}

// ---------------------------------------------------------------------------
// KINEMATICS
// ---------------------------------------------------------------------------

test('the flight model reproduces the measured flight times and arrival speeds', () => {
  const profile = frozenProfile();

  // A guided round that BURNS OUT and coasts: 23.5 s of thrust, 38 km, then
  // 762 km of coast at its 3.68 km/s budget.
  const copperhead = deliveryOf('CopperheadMissileBay', profile);
  assert.equal(copperhead.applies, true);
  assert.equal(copperhead.basis, 'accelerating');
  assert.equal(copperhead.launchRangeKm, 800);
  near(copperhead.flightTimeS, 230.6, 0.005, 'Copperhead flight time');
  near(copperhead.terminalSpeedKps, 3.68, 0.005, 'Copperhead terminal speed');
  assert.equal(copperhead.deltaVLimited, true, 'the Copperhead runs out of propellant before it arrives');
  near(copperhead.burnoutTimeS, 23.54, 0.01, 'Copperhead burnout time');
  near(copperhead.burnoutRangeKm, 38.07, 0.01, 'Copperhead burnout range');

  // A guided round that is STILL UNDER THRUST on arrival. Note the direction of
  // the surprise: it is FASTER over a LONGER range than the Copperhead.
  const torpedo = deliveryOf('AntimatterTorpedoLauncher', profile);
  assert.equal(torpedo.applies, true);
  assert.equal(torpedo.basis, 'accelerating');
  assert.equal(torpedo.launchRangeKm, 1000);
  near(torpedo.flightTimeS, 206.7, 0.005, 'Antimatter torpedo flight time');
  near(torpedo.terminalSpeedKps, 9.79, 0.005, 'Antimatter torpedo terminal speed');
  assert.equal(torpedo.deltaVLimited, false, 'the torpedo still has budget left when it arrives');
  assert.ok(torpedo.flightTimeS < copperhead.flightTimeS,
    'the torpedo crosses 1,000 km faster than the Copperhead crosses 800 -- the finding is NOT that it is slow');
  assert.ok(torpedo.terminalSpeedKps > copperhead.terminalSpeedKps * 2.5);

  // An unguided slug: constant velocity, no burnout, no agility.
  const rail = deliveryOf('HeavyRailCannonMk3', profile);
  assert.equal(rail.applies, true);
  assert.equal(rail.basis, 'constant-velocity');
  near(rail.flightTimeS, 126.3, 0.005, 'Heavy Rail Cannon Mk3 flight time');
  near(rail.terminalSpeedKps, 7.125, 0.005, 'Heavy Rail Cannon Mk3 terminal speed');
  assert.equal(rail.terminalSpeedKps, rail.meanClosingSpeedKps, 'a slug never changes speed');
  assert.equal(rail.deltaVLimited, null, 'a slug has no delta-V budget to run out of');
  assert.equal(rail.burnoutTimeS, null);
});

test('an unguided slug reports no agility as a FACT, not as a missing measurement', () => {
  const profile = frozenProfile();
  const rail = deliveryOf('HeavyRailCannonMk3', profile);
  assert.equal(rail.agility, null);
  assert.match(rail.agilityReason, /does not manoeuvre/);
  assert.match(rail.agilityReason, /not a missing measurement/);

  // A guided round carries the three stated fields verbatim plus the derived
  // pair, and the derived pair says the interpretation is ours.
  const copperhead = deliveryOf('CopperheadMissileBay', profile);
  assert.equal(copperhead.agilityReason, null);
  assert.equal(copperhead.agility.rotationDegPerS, 25);
  assert.equal(copperhead.agility.turnRampS, 1);
  assert.equal(copperhead.agility.maneuverAngleDeg, 50);
  near(copperhead.agility.maneuverSlewTimeS, 2.5, 0.005, 'Copperhead slew time');
  near(copperhead.agility.maneuversPerFlight, 92.2, 0.005, 'Copperhead manoeuvres per flight');
  assert.equal(copperhead.agility.interpretationUnverified, true);

  const torpedo = deliveryOf('AntimatterTorpedoLauncher', profile);
  assert.equal(torpedo.agility.rotationDegPerS, 20);
  assert.equal(torpedo.agility.maneuverAngleDeg, 40);
  near(torpedo.agility.maneuverSlewTimeS, 2.5, 0.005, 'torpedo slew time');
  near(torpedo.agility.maneuversPerFlight, 82.7, 0.005, 'torpedo manoeuvres per flight');

  // Agility is REPORTED, never ranked: it appears in the axis list but is not
  // the floor axis any class declares.
  assert.notEqual(WEAPON_CLASS_SPECS[WEAPON_ROLES.offensive].deliveryFloorAxis, 'maneuversPerFlight');
  assert.equal(WEAPON_CLASS_SPECS[WEAPON_ROLES.offensive].deliveryFloorAxis, 'deliveryShotsPerArrivingRound');
});

// ---------------------------------------------------------------------------
// ENVELOPE AND SATURATION
// ---------------------------------------------------------------------------

test('the envelope is bounded by the launch range, and by each defender\'s own reach', () => {
  // A hand-built profile whose arithmetic can be checked without the templates.
  // Two mounts: one that reaches further than the round is ever fired from, and
  // one that only engages in the last 100 km.
  const profile = buildPointDefenseProfile({
    key: 'hand-built',
    hullsRead: 10,
    mounts: [
      { id: 'LongReach', displayName: 'Long Reach', installations: 20, engagementRangeKm: 5000, cycleSeconds: 4 },
      { id: 'ShortReach', displayName: 'Short Reach', installations: 10, engagementRangeKm: 100, cycleSeconds: 2 }
    ]
  });
  assert.equal(profile.available, true);
  assert.equal(profile.pointDefenseInstallations, 30);
  assert.equal(profile.meanMountsPerHull, 3);
  assert.equal(profile.maxEngagementRangeKm, 5000);

  // A slug at 1 km/s over 500 km: 500 s of flight, and the last 100 km take
  // exactly 100 s.
  const slug = munitionDelivery({
    pointDefenseTargetable: true,
    targetingRangeKm: 500,
    muzzleVelocityKps: 1,
    cooldownS: 10
  }, profile);
  assert.equal(slug.flightTimeS, 500);
  // Capped at the LAUNCH range: a 5,000 km defender cannot start shooting a
  // round fired from 500 km before it is fired.
  assert.equal(slug.pointDefense.envelopeDepthKm, 500);
  assert.equal(slug.pointDefense.envelopeSeconds, 500);

  const long = slug.pointDefense.byWeapon.find(entry => entry.id === 'LongReach');
  const short = slug.pointDefense.byWeapon.find(entry => entry.id === 'ShortReach');
  assert.equal(long.envelopeDepthKm, 500, 'clamped to the launch range');
  assert.equal(long.envelopeSecondsInRange, 500);
  assert.equal(short.envelopeDepthKm, 100, 'this one really does only reach 100 km');
  assert.equal(short.envelopeSecondsInRange, 100);

  // 2 mounts/hull x 500 s / 4 s = 250, plus 1 mount/hull x 100 s / 2 s = 50.
  assert.equal(long.shotsPerSalvo, 250);
  assert.equal(short.shotsPerSalvo, 50);
  assert.equal(slug.pointDefense.shotsPerSalvo, 300);
  // No stated salvo, so one round per cycle -- flagged as the assumption it is.
  assert.equal(slug.roundsPerSalvo, 1);
  assert.equal(slug.roundsPerSalvoAssumed, true);
  assert.equal(slug.pointDefense.shotsPerArrivingRound, 300);
});

test('a salvo divides the same defensive fire; a single round absorbs all of it', () => {
  const profile = buildPointDefenseProfile({
    key: 'hand-built',
    hullsRead: 10,
    mounts: [{ id: 'Turret', displayName: 'Turret', installations: 20, engagementRangeKm: 5000, cycleSeconds: 4 }]
  });
  const base = { pointDefenseTargetable: true, targetingRangeKm: 500, muzzleVelocityKps: 1, cooldownS: 10 };

  const alone = munitionDelivery(base, profile);
  const inFours = munitionDelivery({ ...base, salvoShots: 4, intraSalvoCooldownS: 1 }, profile);

  assert.equal(alone.pointDefense.shotsPerSalvo, 250);
  assert.equal(inFours.pointDefense.shotsPerSalvo, 250, 'the battery fires the same amount either way');
  assert.equal(alone.pointDefense.shotsPerArrivingRound, 250);
  assert.equal(inFours.roundsPerSalvo, 4);
  assert.equal(inFours.roundsPerSalvoAssumed, false, 'the template stated this one');
  assert.equal(inFours.pointDefense.shotsPerArrivingRound, 62.5, 'four ways, not one');
});

test('the saturation figures reproduce the measured live-save numbers', () => {
  const profile = frozenProfile();
  assert.equal(profile.hullsRead, 656);
  assert.equal(profile.pointDefenseInstallations, 880);
  assert.equal(profile.distinctWeapons, 24);
  assert.equal(profile.maxEngagementRangeKm, 1000);

  const copperhead = deliveryOf('CopperheadMissileBay', profile);
  const torpedo = deliveryOf('AntimatterTorpedoLauncher', profile);
  const rail = deliveryOf('HeavyRailCannonMk3', profile);

  assert.equal(copperhead.roundsPerSalvo, 8);
  assert.equal(torpedo.roundsPerSalvo, 1);
  assert.equal(rail.roundsPerSalvo, 1);

  near(copperhead.pointDefense.shotsPerSalvo, 31.55, 0.005, 'Copperhead shots per salvo');
  near(torpedo.pointDefense.shotsPerSalvo, 14.28, 0.005, 'torpedo shots per salvo');
  near(rail.pointDefense.shotsPerSalvo, 16.25, 0.005, 'rail cannon shots per salvo');

  near(copperhead.pointDefense.shotsPerArrivingRound, 3.943, 0.005, 'Copperhead shots per arriving round');
  near(torpedo.pointDefense.shotsPerArrivingRound, 14.278, 0.005, 'torpedo shots per arriving round');
  near(rail.pointDefense.shotsPerArrivingRound, 16.249, 0.005, 'rail cannon shots per arriving round');

  // THE FINDING. The torpedo absorbs 3.62x the point-defence fire per arriving
  // round, despite winning every kinematic axis, because it arrives alone.
  const ratio = torpedo.pointDefense.shotsPerArrivingRound / copperhead.pointDefense.shotsPerArrivingRound;
  near(ratio, 3.621, 0.005, 'torpedo against Copperhead, per arriving round');

  // And the rest of the published table.
  near(deliveryOf('AnacondaMissileBay', profile).pointDefense.shotsPerArrivingRound, 3.868, 0.005, 'Anaconda');
  near(deliveryOf('ViperMissileBay', profile).pointDefense.shotsPerArrivingRound, 2.599, 0.005, 'Viper');
  near(deliveryOf('SidewinderNuclearMissileBay', profile).pointDefense.shotsPerArrivingRound, 8.591, 0.005, 'Sidewinder');
});

// ---------------------------------------------------------------------------
// ABSENT STAYS NULL
// ---------------------------------------------------------------------------

test('a beam has NO delivery axis, and says so with its own reason', () => {
  const profile = frozenProfile();
  const laser = deliveryOf('60cmIRLaserBattery', profile);
  assert.equal(laser.applies, false);
  assert.match(laser.reason, /not point-defence targetable/);
  assert.match(laser.reason, /nothing can intercept it/);
  assert.equal(laser.basis, null);
  assert.equal(laser.flightTimeS, null);
  assert.equal(laser.pointDefense, null);
  assert.notEqual(laser.flightTimeS, 0);

  // And the flat fields the ranking reads.
  const metrics = weaponMetrics('60cmIRLaserBattery', catalogue().laser_weapon['60cmIRLaserBattery'], 'laser_weapon');
  assert.equal(metrics.deliveryApplies, false);
  assert.equal(metrics.deliveryShotsPerArrivingRound, null);
  assert.notEqual(metrics.deliveryShotsPerArrivingRound, 0);
});

test('an interceptable round with no kinematic inputs reports a DIFFERENT reason, and never a zero', () => {
  const profile = frozenProfile();

  // The game says it can be shot down, and the template describes no flight.
  const noFlight = munitionDelivery({
    pointDefenseTargetable: true,
    targetingRangeKm: 800,
    cooldownS: 5
  }, profile);
  assert.equal(noFlight.applies, false);
  assert.match(noFlight.reason, /neither an acceleration and delta-V nor a muzzle velocity/);
  assert.equal(noFlight.flightTimeS, null);
  assert.equal(noFlight.terminalSpeedKps, null);
  assert.notEqual(noFlight.flightTimeS, 0);

  // A third, different fact: no launch range at all.
  const noRange = munitionDelivery({
    pointDefenseTargetable: true,
    accelerationG: 10,
    missileDeltaVKps: 4
  }, profile);
  assert.equal(noRange.applies, false);
  assert.match(noRange.reason, /no targeting range/);
  assert.notEqual(noRange.reason, noFlight.reason, 'three causes, three reasons -- never one flattened "unknown"');

  const laser = deliveryOf('60cmIRLaserBattery', profile);
  assert.notEqual(laser.reason, noFlight.reason);
  assert.notEqual(laser.reason, noRange.reason);
});

test('no observable defender leaves the delivery figure UNMEASURED, never undefended', () => {
  const empty = buildPointDefenseProfile({ key: 'observed-opposing', hullsRead: 0, mounts: [] });
  assert.equal(empty.available, false);
  assert.match(empty.reason, /no hull was read/);
  assert.match(empty.reason, /NOT the same as an undefended target/);
  assert.equal(empty.meanMountsPerHull, null, 'a mean over zero hulls is null, never 0');
  assert.equal(empty.pointDefenseInstallations, null);

  const torpedo = deliveryOf('AntimatterTorpedoLauncher', empty);
  assert.equal(torpedo.applies, true, 'the round still has a flight; it is the opposition that is unobserved');
  assert.ok(torpedo.flightTimeS > 0);
  assert.equal(torpedo.pointDefense, null);
  assert.ok(torpedo.pointDefenseUnavailableReason && torpedo.pointDefenseUnavailableReason.length > 0);

  // Passing no profile at all is a fourth, distinct case with its own wording.
  const noProfile = deliveryOf('AntimatterTorpedoLauncher', null);
  assert.equal(noProfile.pointDefense, null);
  assert.match(noProfile.pointDefenseUnavailableReason, /no point-defence profile was built/);
  assert.match(noProfile.pointDefenseUnavailableReason, /NOT the same as an undefended target/);

  // ...and the floor built on it is unevaluable, which is NOT "clears".
  const rows = [
    { id: 'a', outputPerHardpointMW: 100, deliveryApplies: true, deliveryShotsPerArrivingRound: null },
    { id: 'b', outputPerHardpointMW: 50, deliveryApplies: true, deliveryShotsPerArrivingRound: null }
  ];
  const { ranked } = rankByAxis(rows, {
    rankBy: 'outputPerHardpointMW',
    deliveryFloorAxis: 'deliveryShotsPerArrivingRound',
    deliveryFloorValue: null,
    deliveryFloorApplies: (row) => row.deliveryApplies === true
  });
  for (const row of ranked) {
    assert.equal(row.clearsDeliveryFloor, null);
    assert.notEqual(row.clearsDeliveryFloor, true, 'unknown must never read as clearing');
    assert.match(row.deliveryFloorReason, /no floor could be measured/);
  }
});

// ---------------------------------------------------------------------------
// THE FLOOR, AND ITS FOUR OUTCOMES
// ---------------------------------------------------------------------------

test('the delivery floor has four outcomes, each with its own reason', () => {
  const rows = [
    { id: 'beam', outputPerHardpointMW: 900, deliveryApplies: false, deliveryShotsPerArrivingRound: null },
    { id: 'clears', outputPerHardpointMW: 100, deliveryApplies: true, deliveryShotsPerArrivingRound: 3 },
    { id: 'fails', outputPerHardpointMW: 800, deliveryApplies: true, deliveryShotsPerArrivingRound: 14 },
    { id: 'unmeasured', outputPerHardpointMW: 200, deliveryApplies: true, deliveryShotsPerArrivingRound: null }
  ];
  const { ranked, ranking } = rankByAxis(rows, {
    rankBy: 'outputPerHardpointMW',
    deliveryFloorAxis: 'deliveryShotsPerArrivingRound',
    deliveryFloorValue: 4,
    deliveryFloorApplies: (row) => row.deliveryApplies === true
  });
  const byId = Object.fromEntries(ranked.map(row => [row.id, row]));

  assert.equal(byId.beam.clearsDeliveryFloor, null);
  assert.match(byId.beam.deliveryFloorReason, /not point-defence targetable/);
  assert.equal(byId.clears.clearsDeliveryFloor, true);
  assert.equal(byId.clears.deliveryFloorReason, null);
  assert.equal(byId.fails.clearsDeliveryFloor, false);
  assert.match(byId.fails.deliveryFloorReason, /moves from 4 to 14, the wrong way/);
  assert.equal(byId.unmeasured.clearsDeliveryFloor, null);
  assert.match(byId.unmeasured.deliveryFloorReason, /not measurable for this item/);

  // Only the MEASURED failure is demoted. The 900 MW beam still leads.
  assert.deepEqual(ranked.map(row => row.id), ['beam', 'unmeasured', 'clears', 'fails']);
  assert.equal(ranking.deliveryFloor.axis, 'deliveryShotsPerArrivingRound');
  assert.equal(ranking.deliveryFloor.direction, 'lower');
  assert.equal(ranking.deliveryFloor.value, 4);
});

test('a class with no delivery floor keeps its ordering exactly, with every new field null', () => {
  const rows = [
    { id: 'a', energyPerTonGJPerTon: 5 },
    { id: 'b', energyPerTonGJPerTon: 9 },
    { id: 'c', energyPerTonGJPerTon: null }
  ];
  const { ranked, ranking } = rankByAxis(rows, { rankBy: 'energyPerTonGJPerTon' });
  assert.deepEqual(ranked.map(row => row.id), ['b', 'a', 'c']);
  for (const row of ranked) {
    assert.equal(row.clearsDeliveryFloor, null);
    assert.match(row.deliveryFloorReason, /declares no delivery floor/);
  }
  assert.equal(ranking.deliveryFloor, null,
    'null, not an empty block: "this class does not use one" must read differently from "this build predates phase 5"');
});

// ---------------------------------------------------------------------------
// ORDERING
// ---------------------------------------------------------------------------

const rankRow = (extra) => ({
  id: 'x',
  closesDeficit: false,
  axisKind: AXIS_KINDS.measured,
  clearsDeliveryFloor: null,
  valuePerResearchPoint: 1,
  ...extra
});

test('a floor-failing row sorts after a floor-clearing one, however much higher it scores', () => {
  const fails = rankRow({ id: 'fails', clearsDeliveryFloor: false, valuePerResearchPoint: 334.375 });
  const clears = rankRow({ id: 'clears', clearsDeliveryFloor: true, valuePerResearchPoint: 0.0005 });
  assert.ok(compareMilitaryRows(fails, clears) > 0, 'the 334 must sort after the 0.0005');
  assert.ok(compareMilitaryRows(clears, fails) < 0);

  // An unevaluable floor does NOT demote.
  const unknown = rankRow({ id: 'unknown', clearsDeliveryFloor: null, valuePerResearchPoint: 334.375 });
  assert.ok(compareMilitaryRows(unknown, clears) < 0, 'unknown keeps its place; it is not a failure');
  assert.equal(deliveryFloorRank(unknown), 0);
  assert.equal(deliveryFloorRank(fails), 1);
  assert.equal(deliveryFloorRank(clears), 0);
  assert.deepEqual(DELIVERY_FLOOR_ORDER, ['clears-or-unevaluable', 'measured-below-floor']);
});

test('closesDeficit still beats the delivery term, and a measured failure still beats a rule scalar', () => {
  const deficitAndFails = rankRow({ id: 'deficit', closesDeficit: true, clearsDeliveryFloor: false, valuePerResearchPoint: 0.001 });
  const cleanNoDeficit = rankRow({ id: 'clean', clearsDeliveryFloor: true, valuePerResearchPoint: 900 });
  assert.ok(compareMilitaryRows(deficitAndFails, cleanNoDeficit) < 0,
    'the measured capability gap outranks everything, exactly as it does for axisKind');

  // ...but a named engineering unit that fails delivery is still more
  // commensurable than a unitless rule scalar, so the delivery term sits AFTER
  // axisKind rather than before it.
  const measuredFails = rankRow({ id: 'measured', clearsDeliveryFloor: false, valuePerResearchPoint: 0.0001 });
  const ruleScalar = rankRow({ id: 'rule', axisKind: AXIS_KINDS.ruleScalar, clearsDeliveryFloor: null, valuePerResearchPoint: 900 });
  assert.ok(compareMilitaryRows(measuredFails, ruleScalar) < 0,
    'a measured axis that fails delivery still outranks a ratio of two unnamed scalars');
});

// ---------------------------------------------------------------------------
// SHAPE
// ---------------------------------------------------------------------------

test('every delivery axis names its formula and says whether it is validated', () => {
  assert.ok(MUNITION_DELIVERY_AXES.length >= 12);
  const keys = MUNITION_DELIVERY_AXES.map(axis => axis.key);
  assert.equal(keys[0], 'shotsPerArrivingRound', 'the floor axis leads the list');
  assert.ok(keys.includes('flightTimeS'));
  assert.ok(keys.includes('terminalSpeedKps'));
  assert.ok(keys.includes('maneuversPerFlight'));

  for (const axis of MUNITION_DELIVERY_AXES) {
    assert.ok(axis.label && axis.label.length > 0, `${axis.key} needs a label`);
    assert.ok(axis.direction === 'higher' || axis.direction === 'lower', `${axis.key} needs a direction`);
    assert.ok(axis.basis && axis.basis.length > 0, `${axis.key} needs a stated basis`);
    assert.equal(typeof axis.validatedAgainstGameOutput, 'boolean');
    if (axis.stated !== true) {
      assert.ok(axis.formula && axis.formula.length > 0, `${axis.key} is derived and must state its formula`);
    }
  }

  // The two pins are the ONLY validated derivations here. Everything built on
  // them is modelled, and the payload must not blur the two.
  const validated = Object.entries(DELIVERY_FORMULAE)
    .filter(([, entry]) => entry.validatedAgainstGameOutput === true)
    .map(([key]) => key)
    .sort();
  assert.deepEqual(validated, ['accelerationPin', 'deltaVPin']);
  for (const key of ['flightProfile', 'flightTime', 'pointDefenseEnvelope', 'pointDefenseSaturation', 'agility']) {
    assert.equal(DELIVERY_FORMULAE[key].validatedAgainstGameOutput, false, `${key} must not claim validation`);
  }

  // The delivery axes are a SEPARATE set, never merged into the damage set.
  assert.ok(AXIS_SETS.munition_delivery);
  assert.deepEqual(AXIS_SETS.munition_delivery, MUNITION_DELIVERY_AXES);
  assert.ok(!AXIS_SETS.weapon.some(axis => axis.key === 'shotsPerArrivingRound'),
    'delivery is reported beside the damage axes, never blended into them');

  assert.deepEqual(Object.keys(DELIVERY_BASIS_CODES).sort(),
    ['accelerating', 'constant-velocity', 'not-point-defence-targetable', 'unmeasured']);
});

test('nothing in this module invents a hit probability', () => {
  const profile = frozenProfile();
  const torpedo = deliveryOf('AntimatterTorpedoLauncher', profile);
  const serialised = JSON.stringify({ torpedo, formulae: DELIVERY_FORMULAE, axes: MUNITION_DELIVERY_AXES });
  for (const forbidden of ['hitProbability', 'hitChance', 'survivalChance', 'survivalOdds',
    'interceptChance', 'effectivenessScore', 'killProbability', 'leakerFraction']) {
    assert.ok(!serialised.includes(`"${forbidden}"`),
      `"${forbidden}" would be a confident percentage resting on an unvalidated flight model`);
  }
});

test('the floor is measured from what the observer fields, never from a constant', () => {
  const profile = frozenProfile();
  const stats = catalogue().missile;
  const rows = Object.entries(stats).map(([id, entry]) => ({
    ...weaponMetrics(id, entry, 'missile', { pointDefenseProfile: profile }),
    isFielded: id === 'CopperheadMissileBay'
  }));
  const fielded = rows.filter(row => row.isFielded && row.deliveryApplies === true);
  const best = bestOnAxis(fielded, 'deliveryShotsPerArrivingRound', 'lower');
  assert.equal(best.id, 'CopperheadMissileBay');
  near(best.deliveryShotsPerArrivingRound, 3.943, 0.005, 'the floor value');

  const { ranked } = rankByAxis(rows, {
    rankBy: 'outputPerHardpointMW',
    deliveryFloorAxis: 'deliveryShotsPerArrivingRound',
    deliveryFloorValue: best.deliveryShotsPerArrivingRound,
    deliveryFloorApplies: (row) => row.deliveryApplies === true
  });
  const torpedo = ranked.find(row => row.id === 'AntimatterTorpedoLauncher');
  assert.equal(torpedo.clearsDeliveryFloor, false);
  // It is still the highest-damage row in the class; it is just no longer first.
  const topDamage = bestOnAxis(ranked, 'outputPerHardpointMW', 'higher');
  assert.equal(topDamage.id, 'AntimatterTorpedoLauncher');
  assert.notEqual(ranked[0].id, 'AntimatterTorpedoLauncher',
    'the delivery floor is what moves it, and the damage figure it wins on is unchanged');
});
