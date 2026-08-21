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
    const driveSection = cardHtml.match(/<div class="fp-refit__drive[\s\S]*?<\/div>/)?.[0] || '';
    if (driveSection.includes('Best available drive already fitted')) {
      state2Count++;
      assert.ok(!driveSection.includes('→'), `Design ${item.displayName} drive in State 2 must not render an arrow`);
    }
    if (driveSection.includes('No available drive improves this design without unacceptable ΔV loss')) {
      state3Count++;
      assert.match(driveSection, /fails floor/, `Design ${item.displayName} drive in State 3 must render fails floor badge`);
      assert.match(driveSection, /deltaVKps falls from/, `Design ${item.displayName} drive in State 3 must render verbatim floor reason`);
    }
  }

  assert.ok(state2Count >= 3, `Expected >= 3 designs in State 2 on live save, found ${state2Count}`);
  assert.ok(state3Count >= 5, `Expected >= 5 designs in State 3 on live save, found ${state3Count}`);
});

test('obsolete markers: null is distinguished from [] and unknown state is preserved', () => {
  const baseDesign = {
    ID: 'design-1',
    dataName: 'design-1',
    displayName: 'Test Corvette',
    factionId: 4712,
    hullTemplateName: 'Corvette',
    driveTemplateName: 'NervaDrivex1',
    powerPlantTemplateName: 'SolidCoreFissionReactor',
    armorTemplateName: 'CompositeArmor',
    noseWeaponTemplateEntries: [],
    hullWeaponTemplateEntries: []
  };

  const baseSnapshot = {
    observerFactionId: 4712,
    designs: [baseDesign],
    ships: [],
    driveStats: {
      NervaDrivex1: { displayName: 'Nerva Drive x1', requiredPowerPlant: 'Solid_Core_Fission' }
    },
    componentStats: {
      power_plant: {
        SolidCoreFissionReactor: { displayName: 'Solid Core Reactor', powerPlantClass: 'Solid_Core_Fission' }
      },
      ship_armor: {}
    },
    completedProjects: []
  };

  // 1. Absent obsolete markers (null) -> isObsoleteStateKnown: false, isObsolete: null
  const absentSnapshot = {
    ...baseSnapshot,
    obsoleteShipDesigns: null,
    obsoletedShipParts: null
  };
  const absentAdvisor = buildRefitAdvisor(absentSnapshot, { observerId: 4712 });
  assert.strictEqual(absentAdvisor.isObsoleteStateKnown, false);
  assert.strictEqual(absentAdvisor.obsoleteShipDesignsCount, null);
  assert.strictEqual(absentAdvisor.obsoletedShipPartsCount, null);
  assert.strictEqual(absentAdvisor.items[0].isObsolete, null);

  // 2. Empty obsolete markers ([]) -> isObsoleteStateKnown: true, isObsolete: false, count: 0
  const emptySnapshot = {
    ...baseSnapshot,
    obsoleteShipDesigns: [],
    obsoletedShipParts: []
  };
  const emptyAdvisor = buildRefitAdvisor(emptySnapshot, { observerId: 4712 });
  assert.strictEqual(emptyAdvisor.isObsoleteStateKnown, true);
  assert.strictEqual(emptyAdvisor.obsoleteShipDesignsCount, 0);
  assert.strictEqual(emptyAdvisor.obsoletedShipPartsCount, 0);
  assert.strictEqual(emptyAdvisor.items[0].isObsolete, false);

  // 3. Marked obsolete design
  const markedSnapshot = {
    ...baseSnapshot,
    obsoleteShipDesigns: ['design-1'],
    obsoletedShipParts: []
  };
  const markedAdvisor = buildRefitAdvisor(markedSnapshot, { observerId: 4712 });
  assert.strictEqual(markedAdvisor.isObsoleteStateKnown, true);
  assert.strictEqual(markedAdvisor.obsoleteShipDesignsCount, 1);
  assert.strictEqual(markedAdvisor.items[0].isObsolete, true);
});

test('non-vacuous obsolete filtering on live save: zero recommendations name an obsoleted part', () => {
  const snapshot = snapshotLoader.loadFilteredSnapshot({ observer: 4712, mode: 'player' });
  const advisor = buildRefitAdvisor(snapshot, { observerId: 4712, mode: 'player' });

  // 1. Observer's obsolete design count on live save is exactly 12 of 24
  assert.strictEqual(advisor.count, 24, `Expected 24 designs evaluated, found ${advisor.count}`);
  assert.strictEqual(advisor.isObsoleteStateKnown, true);
  assert.strictEqual(advisor.obsoleteShipDesignsCount, 12, `Expected 12 obsolete designs, found ${advisor.obsoleteShipDesignsCount}`);
  assert.strictEqual(advisor.obsoletedShipPartsCount, 12, `Expected 12 obsoleted parts, found ${advisor.obsoletedShipPartsCount}`);

  const obsoleteItems = advisor.items.filter(it => it.isObsolete === true);
  const activeItems = advisor.items.filter(it => it.isObsolete === false);
  assert.strictEqual(obsoleteItems.length, 12);
  assert.strictEqual(activeItems.length, 12);

  // 2. Zero recommendations name any part in obsoletedShipParts
  const obsoletedPartsSet = new Set(snapshot.obsoletedShipParts || []);
  assert.ok(obsoletedPartsSet.has('480cmIRLaserCannon'), '480cmIRLaserCannon must be in observer obsoleted parts');
  assert.ok(obsoletedPartsSet.has('RailCannonMk2'), 'RailCannonMk2 must be in observer obsoleted parts');

  for (const item of advisor.items) {
    // Check drive recommendation
    const recDrive = item.recommendations.drive;
    if (recDrive?.candidateDriveId) {
      assert.ok(
        !obsoletedPartsSet.has(recDrive.candidateDriveId),
        `Design ${item.displayName} recommended obsoleted drive ${recDrive.candidateDriveId}`
      );
    }

    // Check weapon upgrades (previously 3 designs recommended 480cmIRLaserCannon)
    for (const w of item.recommendations.weapons || []) {
      const recPartId = w.recommendedId;
      assert.ok(
        !obsoletedPartsSet.has(recPartId),
        `Design ${item.displayName} recommended obsoleted weapon ${recPartId} (${w.recommendedWeapon})`
      );
    }

    // Check armour recommendation
    const recArmor = item.recommendations.armor;
    if (recArmor?.recommendedMaterialId) {
      assert.ok(
        !obsoletedPartsSet.has(recArmor.recommendedMaterialId),
        `Design ${item.displayName} recommended obsoleted armour ${recArmor.recommendedMaterialId}`
      );
    }
  }

  // 3. Explicit check on the 3 designs that previously received 480cmIRLaserCannon
  const angara = advisor.items.find(it => it.displayName === 'Angara');
  const angaraBlock2 = advisor.items.find(it => it.displayName === 'Angara Block 2');
  const patapsco = advisor.items.find(it => it.displayName === 'Patapsco');

  assert.ok(angara, 'Angara design must exist');
  assert.ok(angaraBlock2, 'Angara Block 2 design must exist');
  assert.ok(patapsco, 'Patapsco design must exist');

  const angaraWeapons = (angara.recommendations.weapons || []).map(w => w.recommendedId);
  const angara2Weapons = (angaraBlock2.recommendations.weapons || []).map(w => w.recommendedId);
  const patapscoWeapons = (patapsco.recommendations.weapons || []).map(w => w.recommendedId);

  assert.ok(!angaraWeapons.includes('480cmIRLaserCannon'), 'Angara must not recommend obsoleted 480cmIRLaserCannon');
  assert.ok(!angara2Weapons.includes('480cmIRLaserCannon'), 'Angara Block 2 must not recommend obsoleted 480cmIRLaserCannon');
  assert.ok(!patapscoWeapons.includes('480cmIRLaserCannon'), 'Patapsco must not recommend obsoleted 480cmIRLaserCannon');

  // Patapsco should recommend the un-obsoleted 480cmGreenLaserCannon instead
  assert.ok(patapscoWeapons.includes('480cmGreenLaserCannon'), 'Patapsco should recommend 480cmGreenLaserCannon');
});

test('synthetic fixture verifies drive and armour obsoletion filtering', () => {
  const snapshot = {
    observerFactionId: 4712,
    obsoleteShipDesigns: [],
    obsoletedShipParts: ['AdvNervaDrivex1', 'AdamantaneArmor'],
    designs: [
      {
        ID: 'design-synthetic-1',
        dataName: 'design-synthetic-1',
        displayName: 'Corvette Alpha',
        factionId: 4712,
        hullTemplateName: 'Corvette',
        driveTemplateName: 'NervaDrivex1',
        powerPlantTemplateName: 'SolidCoreFissionReactor',
        armorTemplateName: 'CompositeArmor',
        noseWeaponTemplateEntries: [],
        hullWeaponTemplateEntries: []
      }
    ],
    ships: [
      {
        designId: 'design-synthetic-1',
        factionId: 4712,
        currentDeltaVKps: 15.2,
        currentMaxDeltaVKps: 15.2,
        combatAccelerationMps2: 0.12,
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
    },
    completedProjects: ['Project_AdvNerva']
  };

  const advisor = buildRefitAdvisor(snapshot, { observerId: 4712 });
  const item = advisor.items[0];

  // 1. Drive check: AdvNervaDrivex1 is completed, but obsoleted by player -> must NOT be recommended
  const recDrive = item.recommendations.drive;
  assert.ok(
    !recDrive || recDrive.candidateDriveId !== 'AdvNervaDrivex1',
    'Obsoleted AdvNervaDrivex1 must not be recommended'
  );

  // 2. Armour check: AdamantaneArmor has higher resistance, but obsoleted -> falls back to CompositeArmor
  const recArmor = item.recommendations.armor;
  assert.strictEqual(
    recArmor.recommendedMaterialId,
    'CompositeArmor',
    'Armour recommendation must exclude obsoleted AdamantaneArmor'
  );
});

test('redaction: whole-payload scan verifies enemy obsolete lists are not leaked in player mode', () => {
  const playerSnapshot = snapshotLoader.loadFilteredSnapshot({ observer: 4712, mode: 'player' });
  const omniscientSnapshot = snapshotLoader.loadFilteredSnapshot({ observer: 4712, mode: 'omniscient' });

  // Known enemy design IDs that only exist in other factions' obsoleteShipDesigns lists (no active ships in space)
  const unfieldedEnemyObsoleteDesigns = [
    'SubmitCouncilShipTemplate102 Refit 1545',
    'SubmitCouncilShipTemplate222 Refit 1547',
    'AppeaseCouncilShipTemplate130 Refit 1368',
    'Ship13',
    'Ship16'
  ];

  const playerJson = JSON.stringify(playerSnapshot);
  const omniscientJson = JSON.stringify(omniscientSnapshot);

  // 1. Player mode: stringified JSON scan confirms NO enemy obsolete design lists leak anywhere
  for (const enemyDesign of unfieldedEnemyObsoleteDesigns) {
    assert.strictEqual(
      playerJson.includes(enemyDesign),
      false,
      `Enemy obsolete design '${enemyDesign}' leaked into player mode snapshot JSON`
    );
  }

  // 2. All enemy factions in player mode have null obsolete lists
  const enemyFactions = playerSnapshot.factions.filter(f => f.ID !== 4712);
  assert.ok(enemyFactions.length >= 7, 'Expected at least 7 enemy factions');
  for (const f of enemyFactions) {
    assert.strictEqual(f.obsoleteShipDesigns, null, `Enemy faction ${f.displayName} obsoleteShipDesigns must be null in player mode`);
    assert.strictEqual(f.obsoletedShipParts, null, `Enemy faction ${f.displayName} obsoletedShipParts must be null in player mode`);
  }

  // 3. Observer's own obsolete design IS present in player mode
  assert.ok(
    playerJson.includes('playerShipTemplate70'),
    'Observer obsolete design playerShipTemplate70 must be present in player snapshot'
  );

  // 4. Omniscient mode DOES carry the enemy obsolete design IDs
  for (const enemyDesign of unfieldedEnemyObsoleteDesigns) {
    assert.strictEqual(
      omniscientJson.includes(enemyDesign),
      true,
      `Omniscient mode must carry enemy obsolete design '${enemyDesign}'`
    );
  }
});

test('fleet procurement frontend renders obsolete markers, demotes retired cards, and quiets armour alert', () => {
  const { renderRefitDesignCard, render } = loadFleetProcurementComponent();

  // 1. Active design card: no OBSOLETE badge
  const activeDesign = {
    designId: 'active-1',
    displayName: 'Patapsco',
    isObsolete: false,
    role: DESIGN_ROLES.warship,
    baseline: {
      drive: { driveId: 'BurnerDrivex6', displayName: 'Burner Drive x6' },
      deltaVKps: 14.0,
      combatAccelerationMps2: 1.9
    },
    recommendations: {
      drive: null,
      weapons: [],
      armor: { recommendedMaterial: 'Nanotube Armor', threatBasis: 'threat-weighted', weighted: true }
    }
  };
  const activeHtml = renderRefitDesignCard(activeDesign);
  assert.ok(!activeHtml.includes('OBSOLETE'), 'Active design must not render OBSOLETE badge');
  assert.ok(!activeHtml.includes('fp-refit-card--obsolete'), 'Active design must not have obsolete class');

  // 2. Obsolete design card: renders OBSOLETE tag, adds obsolete class, quiet armour form
  const obsoleteDesign = {
    designId: 'obsolete-1',
    displayName: 'Angara',
    isObsolete: true,
    role: DESIGN_ROLES.warship,
    baseline: {
      drive: { driveId: 'NervaDrivex5', displayName: 'Nerva Drive x5' },
      deltaVKps: 12.0,
      combatAccelerationMps2: 0.8
    },
    recommendations: {
      drive: null,
      weapons: [],
      armor: { recommendedMaterial: 'Adamantane Armor', threatBasis: 'threat-weighted', weighted: true }
    }
  };
  const obsoleteHtml = renderRefitDesignCard(obsoleteDesign);
  assert.match(obsoleteHtml, /<span class="ra-tag ra-tag--warn">OBSOLETE<\/span>/, 'Obsolete design must render OBSOLETE tag');
  assert.ok(obsoleteHtml.includes('fp-refit-card--obsolete'), 'Obsolete design must carry fp-refit-card--obsolete class');
  const armorSection = obsoleteHtml.match(/<div class="fp-refit__armor">[\s\S]*?<\/div>/)?.[0];
  assert.ok(armorSection, 'Armour section must be present');
  assert.ok(!armorSection.includes('ra-tag--deficit'), 'Obsolete design armour must not raise red deficit tag');

  // 3. Sorting & demotion: render() places active items before obsolete items
  const mockContainer = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
  const mockRefits = {
    success: true,
    items: [
      { ...obsoleteDesign, designId: 'obs-first' },
      { ...activeDesign, designId: 'act-second' }
    ]
  };
  render(mockContainer, { military: { procurement: { items: [], count: 0 } } }, mockRefits);

  const actIndex = mockContainer.innerHTML.indexOf('act-second');
  const obsIndex = mockContainer.innerHTML.indexOf('obs-first');
  assert.ok(actIndex !== -1 && obsIndex !== -1, 'Both cards must render');
  assert.ok(actIndex < obsIndex, 'Active design must sort before obsolete design in FLEET view grid');
});

test('armour mismatch indicator: renders fitted -> rec with graded severity badge and respects all constraints', () => {
  const { renderRefitDesignCard } = loadFleetProcurementComponent();

  // 1. State 1: Fitted matches recommendation -> quiet confirmation, no alarm/badge
  const matchedDesign = {
    designId: 'matched-1',
    displayName: 'Sturgeon',
    isObsolete: false,
    role: DESIGN_ROLES.warship,
    baseline: { drive: { driveId: 'BurnerDrivex6' }, deltaVKps: 77.0, combatAccelerationMps2: 2.3 },
    recommendations: {
      armor: {
        currentArmor: 'AdamantaneArmor',
        recommendedMaterial: 'Adamantane Armor',
        recommendedMaterialId: 'AdamantaneArmor',
        weighted: true,
        threatBasis: 'Weighted against observed alien fleet weapon mix (60% energy/X-ray, 40% kinetic/baryonic)'
      }
    }
  };
  const matchedHtml = renderRefitDesignCard(matchedDesign);
  const matchedArmor = matchedHtml.match(/<div class="fp-refit__armor[\s\S]*?<\/div>/)?.[0] || '';
  assert.match(matchedArmor, /Best armour fitted \(Adamantane Armor\)/, 'State 1 must render best armour fitted text');
  assert.ok(!matchedArmor.includes('ra-tag--deficit'), 'State 1 must not render red deficit tag');
  assert.ok(!matchedArmor.includes('ra-tag--warn'), 'State 1 must not render amber warning tag');

  // 2. State 2: Mismatch under 2x (Nanotube 9.36 -> Adamantane 15.20 = 1.6x behind) -> ra-tag--warn (amber)
  const warnDesign = {
    designId: 'warn-1',
    displayName: 'Tongala',
    isObsolete: false,
    role: DESIGN_ROLES.warship,
    baseline: { drive: { driveId: 'BurnerDrivex6' }, deltaVKps: 15.0, combatAccelerationMps2: 1.0 },
    recommendations: {
      armor: {
        currentArmor: 'NanotubeArmor',
        recommendedMaterial: 'Adamantane Armor',
        recommendedMaterialId: 'AdamantaneArmor',
        weighted: true,
        threatBasis: 'Weighted against observed alien fleet weapon mix (60% energy/X-ray, 40% kinetic/baryonic)'
      }
    }
  };
  const warnHtml = renderRefitDesignCard(warnDesign);
  const warnArmor = warnHtml.match(/<div class="fp-refit__armor[\s\S]*?<\/div>/)?.[0] || '';
  assert.match(warnArmor, /Nanotube Armor\s*→\s*Adamantane Armor/, 'State 2 must render fitted -> recommended transition');
  assert.match(warnArmor, /<span class="ra-tag ra-tag--warn">1\.6× behind<\/span>/, 'State 2 must render amber 1.6× behind tag');
  assert.ok(!warnArmor.includes('ra-tag--deficit'), 'State 2 must not render red deficit tag');

  // 3. State 3: Mismatch at 2x or worse (FoamedMetal 3.93 -> Adamantane 15.20 = 3.9x behind) -> ra-tag--deficit (red)
  const deficitDesign1 = {
    designId: 'deficit-1',
    displayName: 'Patapsco',
    isObsolete: false,
    role: DESIGN_ROLES.warship,
    baseline: { drive: { driveId: 'BurnerDrivex6' }, deltaVKps: 14.0, combatAccelerationMps2: 1.9 },
    recommendations: {
      armor: {
        currentArmor: 'FoamedMetalArmor',
        recommendedMaterial: 'Adamantane Armor',
        recommendedMaterialId: 'AdamantaneArmor',
        weighted: true,
        threatBasis: 'Weighted against observed alien fleet weapon mix (60% energy/X-ray, 40% kinetic/baryonic)'
      }
    }
  };
  const deficitHtml1 = renderRefitDesignCard(deficitDesign1);
  const deficitArmor1 = deficitHtml1.match(/<div class="fp-refit__armor[\s\S]*?<\/div>/)?.[0] || '';
  assert.match(deficitArmor1, /Foamed Metal Armor\s*→\s*Adamantane Armor/, 'State 3 must render fitted -> recommended transition');
  assert.match(deficitArmor1, /<span class="ra-tag ra-tag--deficit">3\.9× behind<\/span>/, 'State 3 must render red 3.9× behind tag');

  // State 3b: CompositeArmor (2.73 -> Adamantane 15.20 = 5.6x behind) -> ra-tag--deficit (red)
  const deficitDesign2 = {
    designId: 'deficit-2',
    displayName: 'Devilfish',
    isObsolete: false,
    role: DESIGN_ROLES.warship,
    baseline: { drive: { driveId: 'NervaDrivex5' } },
    recommendations: {
      armor: {
        currentArmor: 'CompositeArmor',
        recommendedMaterial: 'Adamantane Armor',
        recommendedMaterialId: 'AdamantaneArmor',
        weighted: true,
        threatBasis: 'Weighted against observed alien fleet weapon mix (60% energy/X-ray, 40% kinetic/baryonic)'
      }
    }
  };
  const deficitHtml2 = renderRefitDesignCard(deficitDesign2);
  const deficitArmor2 = deficitHtml2.match(/<div class="fp-refit__armor[\s\S]*?<\/div>/)?.[0] || '';
  assert.match(deficitArmor2, /<span class="ra-tag ra-tag--deficit">5\.6× behind<\/span>/, 'State 3b must render red 5.6× behind tag');

  // 4. Constraint 1: Obsolete designs must not raise a red badge (quiet form)
  const obsoleteDeficit = {
    ...deficitDesign1,
    isObsolete: true
  };
  const obsHtml = renderRefitDesignCard(obsoleteDeficit);
  const obsArmor = obsHtml.match(/<div class="fp-refit__armor[\s\S]*?<\/div>/)?.[0] || '';
  assert.match(obsArmor, /Foamed Metal Armor\s*→\s*Adamantane Armor/, 'Obsolete design must still render transition');
  assert.ok(!obsArmor.includes('ra-tag--deficit'), 'Obsolete design must not raise red deficit badge');
  assert.ok(!obsArmor.includes('ra-tag--warn'), 'Obsolete design must not raise amber warning badge');

  // 5. Constraint 2: When weighted === false (no observable alien loadout), do NOT show red badge
  const unweightedDeficit = {
    ...deficitDesign1,
    isObsolete: false,
    recommendations: {
      armor: {
        currentArmor: 'FoamedMetalArmor',
        recommendedMaterial: 'Adamantane Armor',
        recommendedMaterialId: 'AdamantaneArmor',
        weighted: false,
        threatBasis: 'unweighted (no alien weapon loadout observable in this snapshot)'
      }
    }
  };
  const unwHtml = renderRefitDesignCard(unweightedDeficit);
  const unwArmor = unwHtml.match(/<div class="fp-refit__armor[\s\S]*?<\/div>/)?.[0] || '';
  assert.match(unwArmor, /Foamed Metal Armor\s*→\s*Adamantane Armor/);
  assert.match(unwArmor, /unweighted/);
  assert.ok(!unwArmor.includes('ra-tag--deficit'), 'Unweighted comparison must never raise red deficit badge');
});

test('non-vacuous live save verification of armour indicator in player and omniscient modes', () => {
  const { renderRefitDesignCard } = loadFleetProcurementComponent();

  for (const mode of ['player', 'omniscient']) {
    const snapshot = snapshotLoader.loadFilteredSnapshot({ observer: 4712, mode });
    const advisor = buildRefitAdvisor(snapshot, { observerId: 4712, mode });

    assert.strictEqual(advisor.count, 24, `Expected 24 designs in ${mode} mode`);

    const activeItems = advisor.items.filter(it => it.isObsolete !== true);
    const obsoleteItems = advisor.items.filter(it => it.isObsolete === true);

    assert.strictEqual(activeItems.length, 12, `Expected 12 active designs in ${mode} mode`);
    assert.strictEqual(obsoleteItems.length, 12, `Expected 12 obsolete designs in ${mode} mode`);

    let activeOptimalCount = 0;
    let activeRedCount = 0;
    let activeAmberCount = 0;

    for (const item of activeItems) {
      const html = renderRefitDesignCard(item);
      const armorSection = html.match(/<div class="fp-refit__armor[\s\S]*?<\/div>/)?.[0] || '';
      if (armorSection.includes('Best armour fitted')) {
        activeOptimalCount++;
        assert.ok(!armorSection.includes('ra-tag--deficit'), `Active optimal design ${item.displayName} must have no red badge`);
        assert.ok(!armorSection.includes('ra-tag--warn'), `Active optimal design ${item.displayName} must have no amber badge`);
      } else if (armorSection.includes('ra-tag--deficit')) {
        activeRedCount++;
        assert.match(armorSection, /3\.9× behind|5\.6× behind/, `Active red design ${item.displayName} must state ratio`);
      } else if (armorSection.includes('ra-tag--warn')) {
        activeAmberCount++;
        assert.match(armorSection, /1\.6× behind/, `Active amber design ${item.displayName} must state ratio`);
      }
    }

    assert.strictEqual(activeOptimalCount, 6, `Expected exactly 6 active designs on optimal armour in ${mode} mode`);
    assert.strictEqual(activeRedCount, 5, `Expected exactly 5 active designs with red armour deficit in ${mode} mode`);
    assert.strictEqual(activeAmberCount, 1, `Expected exactly 1 active design with amber armour warning (Tongala) in ${mode} mode`);

    // Obsolete designs: all 12 mismatched, all 12 render quiet (0 red, 0 amber)
    let obsoleteRedCount = 0;
    let obsoleteAmberCount = 0;
    let obsoleteQuietTransitionCount = 0;

    for (const item of obsoleteItems) {
      const html = renderRefitDesignCard(item);
      const armorSection = html.match(/<div class="fp-refit__armor[\s\S]*?<\/div>/)?.[0] || '';
      if (armorSection.includes('ra-tag--deficit')) obsoleteRedCount++;
      if (armorSection.includes('ra-tag--warn')) obsoleteAmberCount++;
      if (armorSection.includes('→')) obsoleteQuietTransitionCount++;
    }

    assert.strictEqual(obsoleteRedCount, 0, `Obsolete designs must have 0 red deficit badges in ${mode} mode`);
    assert.strictEqual(obsoleteAmberCount, 0, `Obsolete designs must have 0 amber warning badges in ${mode} mode`);
    assert.strictEqual(obsoleteQuietTransitionCount, 12, `All 12 obsolete designs must render transition quietly in ${mode} mode`);
  }
});

test('research advisor: openSlotDetails displays un-confounded REALLOCATION reasoning matching ALLOCATION_MODEL', () => {
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');

  const code = fs.readFileSync(path.join(__dirname, '../public/v2/js/components/research-advisor.js'), 'utf8');
  const panelMock = {
    open: payload => { panelPayload = payload; }
  };
  const context = {
    window: {
      MissionControlDetailPanel: panelMock,
      MissionControlShared: { escapeHtml: s => s }
    },
    MissionControlShared: { escapeHtml: s => s },
    MissionControlDetailPanel: panelMock,
    console: { log: () => {}, warn: () => {} }
  };
  context.global = context.window;
  vm.createContext(context);
  vm.runInContext(code, context);

  // 1. With slots.model / slots.recommendation from live queryIntel
  const { queryIntel } = require('../server/snapshotLoader');
  const intel = queryIntel({ endpoint: 'research-ranking', mode: 'player', observer: 4712 });
  assert.ok(intel.slots, 'Intel payload must carry slots');

  const factsFromIntel = context.window.MissionControlResearchAdvisor.slotFacts(intel.slots);
  const reallocFact = factsFromIntel.find(f => f.label === 'REALLOCATION');
  assert.ok(reallocFact, 'REALLOCATION fact must be present');
  assert.match(reallocFact.value, /no reallocation is recommended/i);
  assert.match(reallocFact.value, /no single \(base, ProjectBonus\) pair fits all three/);
  assert.match(reallocFact.value, /relative share between slots/);
  assert.match(reallocFact.value, /cancels income drift/);

  // Also test openFullRanking integrates slotFacts
  context.window.MissionControlResearchAdvisor.openFullRanking(intel);
  assert.ok(panelPayload, 'Panel must have received open call');
  const panelRealloc = panelPayload.facts.find(f => f.label === 'REALLOCATION');
  assert.ok(panelRealloc, 'Panel must carry REALLOCATION fact');
  assert.strictEqual(panelRealloc.value, reallocFact.value);

  // 2. Fallback text when model and recommendation are absent
  const fallbackFacts = context.window.MissionControlResearchAdvisor.slotFacts({
    available: true,
    slots: [{ index: 0, pips: 3, accumulatedResearch: 100, totalCost: 500, percent: 20, displayName: 'Test', kindLabel: 'Slot' }],
    freeProjectSlots: 0,
    projectSlotCapacity: 3
  });
  const fallbackRealloc = fallbackFacts.find(f => f.label === 'REALLOCATION');
  assert.ok(fallbackRealloc, 'Fallback REALLOCATION fact must be present');
  assert.match(fallbackRealloc.value, /2\.26216× \/ 2\.26214×/);
  assert.match(fallbackRealloc.value, /confounded by research-income drift/);
  assert.match(fallbackRealloc.value, /confounded by the unvalidated Xenology CategoryBonus/);
});


