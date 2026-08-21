// tests/refitAdvisor.test.js
//
// Purpose: Unit and non-vacuous integration tests for Validated Refit Advisor (Part B of fleet-procurement-spec.md).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const vm = require('vm');

const {
  isCompletedOrUngated,
  evaluateReactorClass,
  evaluatePowerBudget,
  evaluateWeaponUpgrades,
  evaluateArmorRecommendation,
  buildRefitAdvisor
} = require('../shared/refitAdvisor.mjs');

const { DESIGN_ROLES } = require('../shared/propulsion.mjs');
const templateLoader = require('../server/templateLoader');
const snapshotLoader = require('../server/snapshotLoader');

// Load client-side Fleet Procurement component in VM context
function loadFleetProcurementComponent() {
  const code = fs.readFileSync('./public/v2/js/components/fleet-procurement.js', 'utf8');
  const sandbox = { window: {}, MissionControlDetailPanel: null, console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.window.MissionControlFleetProcurement;
}

test('comma-safe parsing handles comma-formatted numbers in drive templates', () => {
  templateLoader.load();
  const drives = templateLoader.templates.drives;
  assert.ok(drives.size > 0, 'drives template must be loaded');

  // Verify that drives with comma strings parse to valid numbers, not NaN or 0
  let commaCount = 0;
  for (const drive of drives.values()) {
    const rawReqPower = drive['req power'];
    if (typeof rawReqPower === 'string' && rawReqPower.includes(',')) {
      commaCount++;
      const cleaned = Number(rawReqPower.replace(/,/g, '').trim());
      assert.ok(Number.isFinite(cleaned), `Drive ${drive.dataName} req power '${rawReqPower}' must parse to finite number`);
      assert.ok(cleaned > 0, `Drive ${drive.dataName} req power must be > 0`);
    }
  }

  assert.ok(commaCount >= 90, `At least 90 drives must carry comma-formatted numbers (found ${commaCount})`);
});

test('availability rule is strictly completed OR ungated', () => {
  const completedProjects = new Set(['Project_AdvancedRailCannon', 'Project_Solid-FuelSpaceRockets']);
  const projectGating = {
    Project_AlienCouncil: { factionPrereq: 'AlienCouncil' }
  };

  // Ungated component
  const ungated = isCompletedOrUngated('drive', 'ApexSolidRocketx1', null, completedProjects, null, projectGating);
  assert.strictEqual(ungated.available, true);
  assert.strictEqual(ungated.state, 'ungated');

  // Completed component
  const completed = isCompletedOrUngated('drive', 'AdvRail', 'Project_AdvancedRailCannon', completedProjects, null, projectGating);
  assert.strictEqual(completed.available, true);
  assert.strictEqual(completed.state, 'completed');

  // Incomplete / unresearched component
  const unresearched = isCompletedOrUngated('drive', 'TeraGas', 'Project_TerawattGasCoreFission', completedProjects, null, projectGating);
  assert.strictEqual(unresearched.available, false);
  assert.strictEqual(unresearched.state, 'unresearched');
  assert.match(unresearched.reason, /Requires project/);

  // Faction-restricted component
  const restricted = isCompletedOrUngated('drive', 'AlienDrive', 'Project_AlienCouncil', completedProjects, null, projectGating);
  assert.strictEqual(restricted.available, false);
  assert.strictEqual(restricted.state, 'faction-restricted');
});

test('reactor class evaluates pass, fail and unknown, and fails illegal pairings', () => {
  const solidCoreReactor = { powerPlantClass: 'Solid_Core_Fission', maxOutputGW: 10 };
  const fusionReactor = { powerPlantClass: 'Inertial_Confinement_Fusion', maxOutputGW: 50 };

  // 1. Any_General drive passes with any reactor
  const anyGeneralDrive = { requiredPowerPlant: 'Any_General' };
  const anyRes = evaluateReactorClass(anyGeneralDrive, solidCoreReactor);
  assert.strictEqual(anyRes.verdict, 'pass');
  assert.strictEqual(anyRes.matchedClass, 'Any_General');

  // 2. Matching reactor class passes
  const solidCoreDrive = { requiredPowerPlant: 'Solid_Core_Fission' };
  const matchRes = evaluateReactorClass(solidCoreDrive, solidCoreReactor);
  assert.strictEqual(matchRes.verdict, 'pass');
  assert.strictEqual(matchRes.matchedClass, 'Solid_Core_Fission');

  // 3. Mismatched reactor class FAILS (inverse test)
  const mismatchRes = evaluateReactorClass(solidCoreDrive, fusionReactor);
  assert.strictEqual(mismatchRes.verdict, 'fail');
  assert.match(mismatchRes.reason, /requires reactor class 'Solid_Core_Fission' but fitted reactor is 'Inertial_Confinement_Fusion'/);

  // 4. Missing / unrecorded reactor class reports unknown
  const unknownRes = evaluateReactorClass(solidCoreDrive, null);
  assert.strictEqual(unknownRes.verdict, 'unknown');
});

test('power budget is informational and provides thrust scaling for underpowered fittings', () => {
  const smallPlant = { maxOutputGW: 50 };
  const largePlant = { maxOutputGW: 500 };
  const heavyDrive = { reqPowerGW: 100 };
  const zeroPowerDrive = { reqPowerGW: 0 };
  const laserWeapon = [{ shotPowerMJ: 120, cooldownS: 4, efficiency: 0.6 }]; // 0.05 GW

  // Fully powered
  const fullRes = evaluatePowerBudget(heavyDrive, largePlant, laserWeapon);
  assert.strictEqual(fullRes.informational, true);
  assert.strictEqual(fullRes.thrustScalingFactor, 1.0);
  assert.match(fullRes.summary, /fully covers/);

  // Underpowered (scaling applied, not rejected)
  const underRes = evaluatePowerBudget(heavyDrive, smallPlant, laserWeapon);
  assert.strictEqual(underRes.informational, true);
  assert.strictEqual(underRes.thrustScalingFactor, 0.5);
  assert.match(underRes.summary, /Thrust is scaled to 0.5×/);

  // Zero-draw drive (e.g. chemical/nuclear pulse)
  const zeroRes = evaluatePowerBudget(zeroPowerDrive, smallPlant, []);
  assert.strictEqual(zeroRes.thrustScalingFactor, 1.0);
  assert.match(zeroRes.summary, /draws zero reactor power/);
});

test('armour recommendation weights by observed threat or falls back to unweighted', () => {
  const componentStats = {
    ship_armor: {
      CompositeArmor: {
        displayName: 'Composite Armor',
        densityKgM3: 2000,
        specialties: [['XRayResistance', 1.11], ['BaryonicResistance', 5.25]]
      },
      AdamantaneArmor: {
        displayName: 'Adamantane Armor',
        densityKgM3: 3500,
        specialties: [['XRayResistance', 4.82], ['BaryonicResistance', 31.02]]
      }
    }
  };

  const design = { armorTemplateName: 'CompositeArmor' };
  const completedProjects = new Set(); // Ungated armours available

  // 1. Observed alien beam fleet
  const alienBeamShips = [
    {
      factionId: 4717,
      isAlien: true,
      weaponLoadout: [{ role: 'Offense Laser', count: 4, name: 'Alien Heavy Laser Turret' }]
    }
  ];
  const weightedRes = evaluateArmorRecommendation(design, componentStats, alienBeamShips, completedProjects);
  assert.strictEqual(weightedRes.weighted, true);
  assert.match(weightedRes.threatBasis, /Weighted against observed alien fleet/);
  assert.strictEqual(weightedRes.recommendedMaterial, 'Adamantane Armor');
  assert.strictEqual(weightedRes.performanceImpact, 'unknown');

  // 2. No observed alien ships (player mode unweighted fallback)
  const unweightedRes = evaluateArmorRecommendation(design, componentStats, [], completedProjects);
  assert.strictEqual(unweightedRes.weighted, false);
  assert.match(unweightedRes.threatBasis, /unweighted/);
});

test('buildRefitAdvisor evaluates observer designs and enforces non-composability', () => {
  const snapshot = {
    observerFactionId: 4712,
    designs: [
      {
        ID: 'design-escort-1',
        displayName: 'Corvette Mk1',
        factionId: 4712,
        hullTemplateName: 'Corvette',
        driveTemplateName: 'NervaDrivex1',
        powerPlantTemplateName: 'SolidCoreFissionReactor',
        armorTemplateName: 'CompositeArmor',
        noseWeaponTemplateEntries: [{ moduleName: 'LightRailgunMk1' }],
        hullWeaponTemplateEntries: []
      }
    ],
    ships: [
      {
        designId: 'design-escort-1',
        factionId: 4712,
        currentDeltaVKps: 15.2,
        currentMaxDeltaVKps: 15.2,
        combatAccelerationMps2: 0.12,
        cruiseAccelerationMps2: 0.12,
        dryMassKg: 500000,
        fullWetMassKg: 750000
      }
    ],
    driveStats: {
      NervaDrivex1: {
        displayName: 'Nerva Drive x1',
        EV_kps: 8.5,
        thrust_N: 120000,
        thrustCap: 1,
        propellant: 'LiquidHydrogen',
        requiredPowerPlant: 'Solid_Core_Fission',
        reqPowerGW: 0.5,
        flatMass_tons: 15,
        requiredProjectName: null
      },
      AdvNervaDrivex1: {
        displayName: 'Advanced Nerva Drive x1',
        EV_kps: 12.0,
        thrust_N: 180000,
        thrustCap: 1,
        propellant: 'LiquidHydrogen',
        requiredPowerPlant: 'Solid_Core_Fission',
        reqPowerGW: 0.8,
        flatMass_tons: 15,
        requiredProjectName: 'Project_AdvNerva'
      }
    },
    componentStats: {
      power_plant: {
        SolidCoreFissionReactor: {
          displayName: 'Solid Core Fission Reactor',
          powerPlantClass: 'Solid_Core_Fission',
          maxOutputGW: 2.0
        }
      },
      laser_weapon: {},
      magnetic_gun: {},
      gun: {},
      particle_weapon: {},
      plasma_weapon: {},
      missile: {},
      ship_armor: {}
    },
    completedProjects: ['Project_AdvNerva']
  };

  const advisor = buildRefitAdvisor(snapshot, { observerId: 4712 });
  assert.strictEqual(advisor.count, 1);
  const item = advisor.items[0];

  assert.strictEqual(item.designId, 'design-escort-1');
  assert.strictEqual(item.role, DESIGN_ROLES.warship);

  // Drive recommendation carries non-composability basis note
  assert.ok(item.recommendations.drive, 'Must recommend a drive swap');
  assert.strictEqual(item.recommendations.drive.assumesCurrentFitting, true);
  assert.match(item.recommendations.drive.basisNote, /assume current weapon and armour fitting/);

  // Budgets report mass and heat as unknown
  assert.strictEqual(item.budgets.composedMass.verdict, 'unknown');
  assert.strictEqual(item.budgets.heat.verdict, 'unknown');

  // Overall non-composability notice
  assert.match(item.nonComposabilityNotice, /Combining drive swap with weapon or armour changes yields an unknown mass/);
});

test('non-vacuous live snapshot evaluation produces drive, weapon, armour and reactor passes', () => {
  const snapshot = snapshotLoader.loadFilteredSnapshot({ observer: 4712, mode: 'omniscient' });
  const advisor = buildRefitAdvisor(snapshot, { observerId: 4712, mode: 'omniscient' });

  // 1. Correct number of observer designs evaluated (17-18 designs)
  assert.ok(advisor.count >= 17, `Expected >= 17 observer designs, found ${advisor.count}`);

  // 2. Non-vacuous drive refits: at least one design yields a computable drive refit
  const withDrive = advisor.items.filter(it => it.recommendations.drive != null);
  assert.ok(withDrive.length > 0, `Expected at least 1 design with drive refit, found ${withDrive.length}`);
  const sampleDrive = withDrive[0].recommendations.drive;
  assert.ok(sampleDrive.displayName, 'Drive refit must carry display name');
  assert.ok(Number.isFinite(sampleDrive.deltaVKps), 'Drive refit must carry finite deltaV');
  assert.ok(Number.isFinite(sampleDrive.combatAccelerationMps2), 'Drive refit must carry finite combat accel');
  assert.strictEqual(sampleDrive.assumesCurrentFitting, true);

  // 3. Non-vacuous weapon upgrades: at least one design yields weapon upgrade recommendations
  const withWeapons = advisor.items.filter(it => it.recommendations.weapons?.length > 0);
  assert.ok(withWeapons.length > 0, `Expected at least 1 design with weapon upgrades, found ${withWeapons.length}`);
  const sampleWeapon = withWeapons[0].recommendations.weapons[0];
  assert.ok(sampleWeapon.recommendedWeapon, 'Weapon upgrade must carry recommended weapon name');
  assert.strictEqual(sampleWeapon.hardpointVerdict, 'pass', 'Weapon upgrade must pass hardpoint constraints');
  assert.strictEqual(sampleWeapon.performanceImpact, 'unknown', 'Weapon upgrade performance impact must be unknown');

  // 4. Non-vacuous reactor class matching: passes for evaluated designs, 0 unknown, 0 fail
  const reactorPasses = advisor.items.filter(it => it.budgets.reactorClass?.verdict === 'pass');
  const reactorUnknowns = advisor.items.filter(it => it.budgets.reactorClass?.verdict === 'unknown');
  const reactorFails = advisor.items.filter(it => it.budgets.reactorClass?.verdict === 'fail');

  assert.ok(reactorPasses.length >= 17, `Expected all designs to pass reactor compatibility, found ${reactorPasses.length}`);
  assert.strictEqual(reactorUnknowns.length, 0, `Expected 0 unknown reactor verdicts, found ${reactorUnknowns.length}`);
  assert.strictEqual(reactorFails.length, 0, `Expected 0 failing reactor verdicts on fitted designs, found ${reactorFails.length}`);

  // 5. Threat-weighted armour in omniscient mode with 421 alien ships
  const withArmor = advisor.items.filter(it => it.recommendations.armor?.recommendedMaterial != null);
  assert.strictEqual(withArmor.length, advisor.count, 'All designs must carry an armour recommendation');

  const weightedArmor = advisor.items.filter(it => it.recommendations.armor?.weighted === true);
  assert.strictEqual(weightedArmor.length, advisor.count, 'All designs must be threat-weighted in omniscient mode');

  const sampleArmor = advisor.items[0].recommendations.armor;
  assert.strictEqual(sampleArmor.weighted, true);
  assert.match(sampleArmor.threatBasis, /Weighted against observed alien fleet weapon mix \(\d+% energy\/X-ray, \d+% kinetic\/baryonic\)/);
  assert.strictEqual(sampleArmor.performanceImpact, 'unknown');
});

test('fleet procurement frontend renders four distinct drive recommendation states non-vacuously', () => {
  const { renderRefitDesignCard } = loadFleetProcurementComponent();

  // State 1: Genuine improvement (clearsFloor === true && driveId !== fittedDriveId)
  const state1Design = {
    designId: 'warship-1',
    displayName: 'Strike Corvette',
    role: DESIGN_ROLES.warship,
    baseline: {
      drive: { driveId: 'NervaDrivex1', displayName: 'Nerva Drive x1' },
      deltaVKps: 15.0,
      combatAccelerationMps2: 0.10
    },
    recommendations: {
      drive: {
        driveId: 'AdvNervaDrivex1',
        displayName: 'Advanced Nerva Drive x1',
        clearsFloor: true,
        floorReason: null,
        deltaVKps: 22.5,
        combatAccelerationMps2: 0.35,
        dryMassCaveat: 'holding dry mass constant'
      }
    }
  };
  const html1 = renderRefitDesignCard(state1Design);
  assert.match(html1, /Drive Refit:/, 'State 1 must render "Drive Refit:" label');
  assert.match(html1, /Advanced Nerva Drive x1/, 'State 1 must render candidate drive name');
  assert.match(html1, /ΔV:\s*15\.0\s*→\s*22\.5\s*km\/s/, 'State 1 must render improvement arrow for deltaV');
  assert.match(html1, /constant-dry-mass caveat/, 'State 1 must render dry mass caveat');

  // State 2: Best available drive already fitted (clearsFloor === true && driveId === fittedDriveId)
  const state2Design = {
    designId: 'warship-2',
    displayName: 'Huang He',
    role: DESIGN_ROLES.warship,
    baseline: {
      drive: { driveId: 'BurnerDrivex6', displayName: 'Burner Drive x6' },
      deltaVKps: 14.06756,
      combatAccelerationMps2: 1.91225
    },
    recommendations: {
      drive: {
        driveId: 'BurnerDrivex6',
        displayName: 'Burner Drive x6',
        clearsFloor: true,
        floorReason: null,
        deltaVKps: 14.0676,
        combatAccelerationMps2: 1.91225
      }
    }
  };
  const html2 = renderRefitDesignCard(state2Design);
  assert.match(html2, /Best available drive already fitted \(Burner Drive x6\)\./, 'State 2 must explicitly state best drive already fitted');
  assert.ok(!html2.includes('14.06756 → 14.0676'), 'State 2 must NOT render misleading rounding arrows');
  assert.ok(!html2.includes('Drive Refit:'), 'State 2 must not label fitted drive as a refit');

  // State 3: Fails reach floor (clearsFloor === false) -> rejected alternative with badge & verbatim reason
  const state3Design = {
    designId: 'warship-3',
    displayName: 'Sturgeon',
    role: DESIGN_ROLES.warship,
    baseline: {
      drive: { driveId: 'BurnerDrivex6', displayName: 'Burner Drive x6' },
      deltaVKps: 77.045,
      combatAccelerationMps2: 2.3773
    },
    recommendations: {
      drive: {
        driveId: 'NeutronLiquidRocketx6',
        displayName: 'Neutron Liquid Rocket x6',
        clearsFloor: false,
        floorReason: 'deltaVKps falls from 77.045 to 1.0377',
        deltaVKps: 1.0377,
        combatAccelerationMps2: 40.84
      }
    }
  };
  const html3 = renderRefitDesignCard(state3Design);
  assert.match(html3, /No available drive improves this design without unacceptable ΔV loss\./, 'State 3 must state no available drive improves without loss');
  assert.match(html3, /<span class="ra-tag ra-tag--warn">fails floor<\/span>/, 'State 3 must carry fails floor badge');
  assert.match(html3, /Neutron Liquid Rocket x6/, 'State 3 must name the rejected alternative candidate');
  assert.match(html3, /deltaVKps falls from 77\.045 to 1\.0377/, 'State 3 must carry verbatim floorReason');

  // State 4: Reach floor unevaluable (clearsFloor === null)
  const state4Design = {
    designId: 'warship-4',
    displayName: 'Unmeasured Cruiser',
    role: DESIGN_ROLES.warship,
    baseline: {
      drive: { driveId: 'UnknownDrive', displayName: 'Unknown Drive' },
      deltaVKps: null,
      combatAccelerationMps2: null
    },
    recommendations: {
      drive: {
        driveId: 'SomeCandidate',
        displayName: 'Some Candidate',
        clearsFloor: null,
        floorReason: 'baseline deltaVKps is not measured',
        deltaVKps: null,
        combatAccelerationMps2: null
      }
    }
  };
  const html4 = renderRefitDesignCard(state4Design);
  assert.match(html4, /Drive refit reach floor unknown \(baseline metrics unmeasured\)/, 'State 4 must report unknown floor');
  assert.ok(!html4.includes('recommended'), 'State 4 must never claim recommended');
  assert.ok(!html4.includes('fits'), 'State 4 must never claim fits');

  // Assert against live save: yields at least 3 of State 2 and at least 5 of State 3
  const snapshot = snapshotLoader.loadFilteredSnapshot({ observer: 4712, mode: 'omniscient' });
  const advisor = buildRefitAdvisor(snapshot, { observerId: 4712, mode: 'omniscient' });

  let state2Count = 0;
  let state3Count = 0;

  for (const item of advisor.items) {
    const cardHtml = renderRefitDesignCard(item);
    if (cardHtml.includes('Best available drive already fitted')) {
      state2Count++;
      assert.ok(!cardHtml.includes('→'), `Design ${item.displayName} in State 2 must not render an arrow`);
    }
    if (cardHtml.includes('No available drive improves this design without unacceptable ΔV loss')) {
      state3Count++;
      assert.match(cardHtml, /fails floor/, `Design ${item.displayName} in State 3 must render fails floor badge`);
      assert.match(cardHtml, /deltaVKps falls from/, `Design ${item.displayName} in State 3 must render verbatim floor reason`);
    }
  }

  assert.ok(state2Count >= 3, `Expected >= 3 designs in State 2 on live save, found ${state2Count}`);
  assert.ok(state3Count >= 5, `Expected >= 5 designs in State 3 on live save, found ${state3Count}`);
});
