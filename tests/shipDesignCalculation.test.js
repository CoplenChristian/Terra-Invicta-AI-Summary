// Purpose: the ship-designer design calculation — armour, power, heat,
//   propulsion readout, mass, resource vector and build-time refusals.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  ARMOUR_SCALE_MULTIPLIERS,
  RESOURCE_COST_RATE,
  RESOURCE_COST_RATE_UNITS_PER_TON,
  SHIP_DESIGN_MATERIALS,
  calculateArmourMass,
  calculateShipDesign,
  resolveArmourScaling
} = require('../shared/shipDesignCalculation.mjs');

const MATERIALS = Object.freeze([
  'water',
  'volatiles',
  'metals',
  'nobleMetals',
  'fissiles',
  'exotics',
  'antimatter'
]);

const mix = (values = {}) => Object.fromEntries(
  MATERIALS.map(material => [material, values[material] ?? 0])
);

const HULL = Object.freeze({
  id: 'Escort',
  displayName: 'Escort',
  length_m: '50',
  width_m: '10',
  mass_tons: '350',
  crew: '4',
  consTier: '1',
  baseConstructionTime_days: '90',
  weightedBuildMaterials: mix({ volatiles: 0.1, metals: 0.7, nobleMetals: 0.2 })
});

const DRIVE = Object.freeze({
  id: 'TestDrive',
  displayName: 'Test Drive',
  EV_kps: '1000',
  thrust_N: '100000',
  efficiency: '0.5',
  'req power': '10',
  thrustRating_GW: '10',
  flatMass_tons: '20',
  thrustCap: '0.5',
  cooling: 'Closed',
  requiredPowerPlant: 'Any_General',
  propellant: 'Hydrogen',
  perTankPropellantMaterials: mix({ volatiles: 1 }),
  weightedBuildMaterials: mix({ metals: 1 })
});

const REACTOR = Object.freeze({
  id: 'TestReactor',
  displayName: 'Test Reactor',
  maxOutput_GW: '2',
  specificPower_tGW: '0.5',
  efficiency: '0.8',
  powerPlantClass: 'Any_General',
  crew: '1',
  weightedBuildMaterials: mix({ metals: 0.8, nobleMetals: 0.2 })
});

const RADIATOR = Object.freeze({
  id: 'TestRadiator',
  displayName: 'Test Radiator',
  specificPower_2s_KWkg: '8',
  crew: '1',
  weightedBuildMaterials: mix({ metals: 1 })
});

const COMPOSITE = Object.freeze({
  id: 'CompositeArmor',
  displayName: 'Composite',
  density_kgm3: '1930',
  heatofVaporization_MJkg: '15',
  weightedBuildMaterials: mix({ volatiles: 0.5, metals: 0.25, nobleMetals: 0.25 })
});

const UTILITY = Object.freeze({
  id: 'TestUtility',
  displayName: 'Test Utility',
  mass_tons: '5',
  crew: '1',
  powerRequirement_MW: '10',
  weightedBuildMaterials: mix({ metals: 1 })
});

const LASER = Object.freeze({
  id: 'TestLaser',
  displayName: 'Test Laser',
  family: 'laser_weapon',
  mass_tons: '10',
  crew: '1',
  selfPowered: false,
  powerPerShot_GJ: '1',
  cooldown_s: '10',
  weightedBuildMaterials: mix({ metals: 0.5, nobleMetals: 0.5 })
});

const inputFor = (overrides = {}) => ({
  hull: HULL,
  drive: DRIVE,
  thrusterCount: 1,
  reactor: REACTOR,
  radiator: RADIATOR,
  armour: {
    material: COMPOSITE,
    points: { nose: 4, lateral: 0, tail: 1 }
  },
  propellantTanks: {
    count: 2,
    weightedBuildMaterials: mix({ volatiles: 1 })
  },
  utilityModules: [UTILITY],
  weapons: [{ component: LASER, count: 1, family: 'laser_weapon' }],
  campaignSettings: { cinematicCombatRealismScale: true },
  shipyard: { templateName: 'SpaceDock' },
  factionModifier: { available: true, value: 1, basis: 'test' },
  ...overrides
});

const assertApprox = (actual, expected, tolerance = 1e-9) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`
  );
};

const assertFiniteNumbers = value => {
  if (typeof value === 'number') {
    assert.equal(Number.isFinite(value), true, `non-finite number: ${value}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(assertFiniteNumbers);
    return;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach(assertFiniteNumbers);
  }
};

test('pins the nonlinear cinematic Escort Composite armour curve', () => {
  const expectedTons = new Map([
    [0, 104.71975511965978],
    [1, 429.08732315435805],
    [2, 762.296255905504],
    [4, 1455.2382155571397]
  ]);

  for (const [sidePoints, expected] of expectedTons) {
    const result = calculateArmourMass({
      hull: HULL,
      material: COMPOSITE,
      nosePoints: 4,
      lateralPoints: sidePoints,
      tailPoints: 1,
      scaling: 'cinematic'
    });
    assert.equal(result.available, true);
    assertApprox(result.massTons, expected);
  }

  assert.ok(expectedTons.get(1) > expectedTons.get(0) * 4);
  assert.deepEqual(ARMOUR_SCALE_MULTIPLIERS.cinematic, {
    mode: 'cinematic',
    cinematicCombatRealismScale: true,
    nose: 1,
    tail: 1,
    side: 0.75
  });
});

test('reads the campaign armour scale from a raw global save block', () => {
  const rawSave = {
    gamestates: {
      'PavonisInteractive.TerraInvicta.TIGlobalValuesState': [{
        Value: {
          scenarioCustomizations: { cinematicCombatRealismScale: true }
        }
      }]
    }
  };

  const scale = resolveArmourScaling({ rawSave });
  assert.equal(scale.available, true);
  assert.equal(scale.mode, 'cinematic');
  assert.equal(scale.source, 'save:TIGlobalValuesState.scenarioCustomizations');

  const realistic = resolveArmourScaling({
    campaignSettings: { cinematicCombatRealismScale: false }
  });
  assert.equal(realistic.mode, 'realistic');
  assert.equal(realistic.noseMultiplier, 3);
  assert.equal(realistic.sideMultiplier, 0.5);
});

test('composes the four headline outputs and supporting readout', () => {
  const result = calculateShipDesign(inputFor());

  assert.equal(result.available, true);
  assert.equal(result.buildable, true);
  assert.equal(result.compatibility.status, 'compatible');
  assert.equal(result.power.systemsPowerMW, 10);
  assertApprox(result.power.systemsGW, 1.1 * (8 * 0.000005 + 1 * 0.005 + 10 * 0.001));
  assertApprox(result.power.weaponsGW, 0.1);
  assertApprox(result.power.totalGW, result.power.systemsGW + 0.1 + 10);
  assert.equal(result.power.plantOutputGW, 2);
  assertApprox(result.power.thrustScalingFactor, 0.2);
  assert.equal(result.power.underpowered, true);
  assert.equal(result.performance.thrustN, 100000);
  assertApprox(result.performance.scaledThrustN, 20000);

  assert.equal(result.mass.propellantTons, 200);
  assertApprox(result.mass.wetTons, result.mass.dryTons + 200);
  assert.equal(result.crew.total, 8);
  assert.equal(result.buildTime.available, true);
  assert.equal(result.buildTimeDays, 90);
  assert.notEqual(result.cruiseAccelerationMps2, null);
  assert.notEqual(result.combatAccelerationMps2, null);
  assert.notEqual(result.deltaVKps, null);

  assert.deepEqual(Object.keys(result.totalResourceCost), SHIP_DESIGN_MATERIALS);
  assert.deepEqual(result.totalResourceCost, result.cost.total);
  assert.equal(result.cost.available, true);
  assert.equal(result.cost.components.find(row => row.key === 'hull').cost.metals, 24.5);
  assert.equal(result.cost.components.find(row => row.key === 'crew').cost.water, 1.6);
  assert.equal(result.mass.componentBreakdown.some(row => row.key === 'armour'), true);
  assertFiniteNumbers(result);
});

test('comma-separated req power and thrust rating remain measurable and scale thrust', () => {
  const result = calculateShipDesign(inputFor({
    drive: {
      ...DRIVE,
      'req power': '2,130.928',
      thrustRating_GW: '2,130.928'
    },
    reactor: { ...REACTOR, maxOutput_GW: '1' }
  }));

  assert.equal(result.power.propulsion.storedReqPowerGW, 2130.928);
  assert.equal(result.power.propulsion.thrustRatingGW, 2130.928);
  assert.equal(result.power.plantOutputGW, 1);
  assertApprox(result.power.thrustScalingFactor, 1 / 2130.928);
  assert.ok(result.power.thrustScalingFactor > 0);

  const malformed = calculateShipDesign(inputFor({
    drive: { ...DRIVE, 'req power': 'not-a-number', thrustRating_GW: 'not-a-number', selfPowered: false }
  }));
  assert.equal(malformed.power.propulsion.storedReqPowerGW, null);
  assert.equal(malformed.power.propulsion.thrustRatingGW, null);
  assert.notEqual(malformed.power.propulsion.modelledGW, null);
  assert.ok(malformed.power.thrustScalingFactor > 0);
});

test('underpowered plants scale thrust but never veto a compatible design', () => {
  const result = calculateShipDesign(inputFor());

  assert.equal(result.compatibility.compatible, true);
  assert.equal(result.buildable, true);
  assert.equal(result.power.underpowered, true);
  assertApprox(result.thrustScalingFactor, 0.2);
  assertApprox(result.performance.combatAccelerationMps2, result.performance.cruiseAccelerationMps2 * 0.5);
});

test('naval guns contribute mass but no weapon power or waste heat', () => {
  const gun = {
    id: 'TestGun',
    displayName: 'Test Naval Gun',
    mass_tons: '10',
    crew: '1',
    weightedBuildMaterials: mix({ metals: 1 })
  };
  const result = calculateShipDesign(inputFor({
    weapons: [{ component: gun, count: 1, family: 'gun' }]
  }));

  assert.equal(result.power.weaponItems[0].selfPowered, true);
  assert.equal(result.power.weaponsGW, 0);
  assert.equal(result.heat.scenarios.Closed.heatPowerGW, result.power.systemsGW + result.power.propulsionGW);
  assert.equal(result.heat.scenarios.Open.heatPowerGW, result.power.systemsGW);
});

test('a supplied x1 drive scales only when the requested thruster count needs it', () => {
  const result = calculateShipDesign(inputFor({
    thrusterCount: 3,
    drive: { ...DRIVE, thrust_N: '1000', 'req power': '2', thrustRating_GW: '2', flatMass_tons: '7' }
  }));

  assert.equal(result.inputs.drive.basis, 'linear-thruster-mechanic');
  assert.equal(result.power.propulsion.storedReqPowerGW, 6);
  assert.equal(result.power.propulsion.thrustRatingGW, 6);
  assert.equal(result.performance.thrustN, 3000);
  assert.equal(result.mass.componentBreakdown.find(row => row.key === 'drive').massTons, 21);
});

test('accepts catalogue rows with nested stats and refuses an absent partial variant', () => {
  const catalogueDrive = {
    id: 'CatalogueDrive',
    displayName: 'Catalogue Drive',
    variants: [
      {
        id: 'CatalogueDrivex1',
        thrusters: 1,
        stats: {
          displayName: 'Catalogue Drive x1',
          EV_kps: 100,
          thrust_N: 1000,
          reqPowerGW: 2,
          thrustRatingGW: 2,
          flatMass_tons: 7,
          thrustCap: 1,
          cooling: 'Open',
          propellant: 'Hydrogen',
          efficiency: 0.5,
          requiredPowerPlant: 'Any_General',
          weightedBuildMaterials: mix({ metals: 1 }),
          perTankPropellantMaterials: mix({ volatiles: 1 })
        }
      },
      {
        id: 'CatalogueDrivex2',
        thrusters: 2,
        stats: {
          displayName: 'Catalogue Drive x2',
          EV_kps: 100,
          thrust_N: 2000,
          reqPowerGW: 4,
          thrustRatingGW: 4,
          flatMass_tons: 14,
          thrustCap: 1,
          cooling: 'Open',
          propellant: 'Hydrogen',
          efficiency: 0.5,
          requiredPowerPlant: 'Any_General',
          weightedBuildMaterials: mix({ metals: 1 }),
          perTankPropellantMaterials: mix({ volatiles: 1 })
        }
      }
    ]
  };
  const source = { families: { drives: [catalogueDrive] } };
  const selected = calculateShipDesign(inputFor({
    catalogue: source,
    drive: 'CatalogueDrive',
    thrusterCount: 2
  }));
  assert.equal(selected.inputs.drive.basis, 'catalogue-variant');
  assert.equal(selected.performance.thrustN, 2000);
  assert.equal(selected.power.propulsion.storedReqPowerGW, 4);

  const partial = calculateShipDesign(inputFor({
    catalogue: { families: { drives: [{ ...catalogueDrive, variants: [catalogueDrive.variants[0]] }] } },
    drive: 'CatalogueDrive',
    thrusterCount: 2
  }));
  assert.equal(partial.performance.thrustN, null);
  assert.match(partial.reasons.components, /partial ladder/i);
});

test('Calc cooling reports both radiator and cost ranges, with no selected total', () => {
  const result = calculateShipDesign(inputFor({ drive: { ...DRIVE, cooling: 'Calc' } }));

  assert.equal(result.heat.coolingResolution, 'unknown: both Open and Closed are reported');
  assert.equal(result.radiator.massTons, null);
  assert.ok(result.radiator.massRangeTons.Open < result.radiator.massRangeTons.Closed);
  assert.deepEqual(Object.keys(result.radiator.massRangeTons).sort(), ['Closed', 'Open']);
  assert.equal(result.totalResourceCost, null);
  assert.equal(result.cost.available, false);
  assert.equal(result.mass.dryTons, null);
  assert.deepEqual(Object.keys(result.mass.range).sort(), ['Closed', 'Open']);
  assert.equal(result.cruiseAccelerationMps2, null);
  assert.equal(result.combatAccelerationMps2, null);
  assert.equal(result.deltaVKps, null);
  assert.match(result.cost.reason, /Calc-cooling range/);
});

test('an unreadable material mix refuses the total bill, not the measurable armour', () => {
  const { weightedBuildMaterials, ...withoutMix } = COMPOSITE;
  const result = calculateShipDesign(inputFor({
    armour: {
      material: withoutMix,
      points: { nose: 4, lateral: 0, tail: 1 }
    }
  }));

  assert.notEqual(result.armour.massTons, null);
  assert.equal(result.totalResourceCost, null);
  assert.equal(result.cost.available, false);
  assert.match(result.cost.reason, /armour.*material mix|weighted build-material mix/i);
  assert.match(result.reasons.totalResourceCost, /armour.*material mix|weighted build-material mix/i);
});

test('absent inputs stay null with named reasons', () => {
  const result = calculateShipDesign();

  assert.equal(result.cruiseAccelerationMps2, null);
  assert.equal(result.combatAccelerationMps2, null);
  assert.equal(result.deltaVKps, null);
  assert.equal(result.totalResourceCost, null);
  assert.equal(result.mass.dryTons, null);
  assert.equal(result.mass.wetTons, null);
  assert.equal(result.power.thrustScalingFactor, null);
  assert.equal(result.heat.radiatorMassTons, null);
  assert.equal(result.crew.total, null);
  assert.match(result.reasons.cruiseAccelerationMps2, /mass|thrust/i);
  assert.match(result.reasons.totalResourceCost, /radiator|cooling|mass/i);
});

test('the named cost rate carries its corroborating, unmeasured provenance', () => {
  assert.equal(RESOURCE_COST_RATE_UNITS_PER_TON, 0.1);
  assert.equal(RESOURCE_COST_RATE.value, 0.1);
  assert.match(RESOURCE_COST_RATE.status, /not directly measured/i);
  assert.equal(RESOURCE_COST_RATE.sources.length, 2);
  assert.deepEqual(SHIP_DESIGN_MATERIALS, MATERIALS);
});
