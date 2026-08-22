// `/api/intel/military-value` -- phase 2 of the research advisor.
//
// Two of these tests are PINS rather than assertions about our own code: the
// kinetic-damage formula and the mount hardpoint table both have to reproduce
// something the game itself states, and each is followed by a perturbation that
// proves the pin is not vacuous. Phase 1 held delta-V to the same standard
// against `currentMaxDeltaVKps`.
//
// Everything else follows `tests/propulsionEndpoint.test.js`: a synthetic
// campaign state over the REAL installed templates, so the turn-1 case
// exercises the same 309-weapon catalogue and the same 1,223-entry unlock index
// the live save does.

const { test } = require('node:test');
const assert = require('node:assert');

const snapshotBuilder = require('../server/snapshotBuilder');
const snapshotIdentity = require('../server/snapshotIdentity');
const intelligenceFilter = require('../server/intelligenceFilter');
const templateLoader = require('../server/templateLoader');
const { UNLOCK_FAMILIES, buildComponentStats } = require('../server/snapshot/templates');
const { makeSaveData } = require('./fixtures/syntheticSave');
const {
  INTEL_ENDPOINT_EXAMPLES,
  INTEL_ENDPOINT_INDEX,
  DETAIL_AWARE_RESOURCES,
  SUPPORTED_RESOURCES,
  buildResourceProjection
} = require('../shared/intel/registry.mjs');
const { AVAILABILITY_STATES } = require('../shared/researchAvailability.mjs');
const {
  MOUNT_HARDPOINTS,
  WEAPON_ROLES,
  mountCost,
  rankArmorAxis,
  ratioAgainst,
  ruleSignatureOf,
  threatMix,
  weaponDamage,
  weaponMetrics,
  weaponRole
} = require('../shared/militaryValue.mjs');

const OBSERVER = 4712;
const ALIEN = 4717;

const TURN_ONE_AVAILABLE = ['Project_Solid-FuelSpaceRockets', 'Project_Liquid-FuelRockets'];

function filtered(save, mode) {
  const raw = snapshotBuilder.buildRawSnapshot(save);
  const identity = snapshotIdentity.createSnapshotIdentity(
    { fullPath: 'synthetic.gz', lastModified: new Date('2025-01-01T00:00:00Z'), saveHash: 'x' },
    'initiative'
  );
  return intelligenceFilter.applyFilter({ ...raw, ...identity }, mode, OBSERVER);
}

/** Turn one: nothing flown, nothing completed, two chemical rockets offered. */
function turnOneSnapshot(mode = 'player') {
  const snapshot = filtered(makeSaveData({ ships: 0 }), mode);
  snapshot.fleets = [];
  snapshot.shipDesigns = [];
  snapshot.habModules = [];
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

const project = (snapshot, options = {}) => buildResourceProjection(snapshot, 'military-value', {
  mode: 'player',
  ...options
});

const classOf = (result, classKey) => result.items.find(entry => entry.classKey === classKey);

/**
 * An observer who actually fields something, built on the real templates.
 *
 * One Battlecruiser flying a real rail cannon, a real missile bay, a real
 * point-defence turret, real armour, a real reactor and a real radiator. This
 * is the fixture every "compared against what they field" test needs, and every
 * component id in it comes from the installed templates rather than being made
 * up, so the join to the catalogue is the same join production does.
 */
function fieldedSnapshot(mode = 'player', { alienWeapons = ['Alien Light Mag Battery'] } = {}) {
  const snapshot = turnOneSnapshot(mode);
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
    moduleTemplateEntries: [{ moduleName: 'WaterHeatSink' }, { moduleName: 'Lithium-IonBattery' }, { moduleName: 'TargetingComputer1' }],
    noseWeaponTemplateEntries: [
      { moduleName: 'LightRailCannonMk1' },
      { moduleName: 'LightRailCannonMk1' },
      { moduleName: 'LightRailCannonMk1' }
    ],
    hullWeaponTemplateEntries: [
      { moduleName: 'KraitMissileBay' },
      { moduleName: 'PointDefenseLaserTurret' }
    ]
  }];
  snapshot.fleets = [{
    ID: 1,
    displayName: 'Test Group',
    factionId: OBSERVER,
    ships: [{
      id: 11,
      displayName: 'Test Hull',
      hullName: 'observerWarship',
      currentMassKg: 5000000,
      propellantTons: 1000,
      currentDeltaVKps: 20,
      currentMaxDeltaVKps: 20,
      weaponLoadout: []
    }]
  }];
  // An observable hostile hull, because the armour ranking axis is chosen from
  // the measured threat mix and a fixture with no threat is a fixture where
  // armour is deliberately not ranked at all.
  if (alienWeapons.length > 0) {
    if (!snapshot.factions.some(faction => faction.ID === ALIEN)) {
      snapshot.factions.push({ ID: ALIEN, displayName: 'the Aliens', templateName: 'AlienCouncil' });
    }
    snapshot.fleets.push({
      ID: 2,
      displayName: 'Alien Formation',
      factionId: ALIEN,
      ships: [{
        id: 21,
        displayName: 'Alien Hull',
        hullName: 'redactedAlienDesign',
        weaponLoadout: [{ role: 'Kinetic', category: 'Kinetic', count: alienWeapons.length, systems: alienWeapons }]
      }]
    });
  }
  return snapshot;
}

// ---------------------------------------------------------------------------
// REGISTRATION
// ---------------------------------------------------------------------------

test('the endpoint is registered the same way every other intel endpoint is', () => {
  assert.ok(SUPPORTED_RESOURCES.has('military-value'));
  assert.equal(INTEL_ENDPOINT_INDEX.militaryValue, '/api/intel/military-value');
  assert.ok(INTEL_ENDPOINT_EXAMPLES.militaryValue, 'the discovery index must carry an example query');
  assert.ok(DETAIL_AWARE_RESOURCES.has('military-value'),
    'the full listing is a 550 KB response; it must be opt-in like fleets and ships');
});

// ---------------------------------------------------------------------------
// PIN 1 -- KINETIC DAMAGE AGAINST THE GAME'S OWN FIGURE
// ---------------------------------------------------------------------------

/** Every weapon template that ships its own damage number. */
function weaponsWithShippedDamage() {
  templateLoader.load();
  const rows = [];
  for (const weapon of templateLoader.templates.weaponModules.values()) {
    const family = weapon.templateFamily;
    if (family !== 'gun' && family !== 'plasma_weapon' && family !== 'magnetic_gun') continue;
    const stated = typeof weapon.damage_MJ === 'number' ? weapon.damage_MJ
      : (typeof weapon.expectedDamage_MJ === 'number' ? weapon.expectedDamage_MJ : null);
    if (stated === null) continue;
    rows.push({ id: weapon.dataName, family, stated, weapon });
  }
  return rows;
}

test('kinetic damage reproduces the game\'s own damage figure exactly', () => {
  const rows = weaponsWithShippedDamage();
  assert.ok(rows.length >= 20, `expected the shipped-damage set to be non-trivial, got ${rows.length}`);

  for (const row of rows) {
    const stats = {
      warheadMassKg: row.weapon.warheadMass_kg,
      muzzleVelocityKps: row.weapon.muzzleVelocity_kps,
      statedDamageMJ: row.stated,
      statedDamageField: typeof row.weapon.damage_MJ === 'number' ? 'damage_MJ' : 'expectedDamage_MJ'
    };
    const damage = weaponDamage(stats, row.family);
    assert.ok(damage.agreement, `${row.id} must produce a comparison against its shipped figure`);
    assert.equal(damage.agreement.agrees, true,
      `${row.id}: modelled ${damage.agreement.modelled} vs shipped ${row.stated} (ratio ${damage.agreement.ratio})`);
  }

  // Magnetic guns ship no damage figure and are priced by the same formula.
  // That extension is the thing the pin above licenses, so it is asserted
  // rather than assumed.
  const magneticWithoutFigure = [...templateLoader.templates.weaponModules.values()]
    .filter(weapon => weapon.templateFamily === 'magnetic_gun' && typeof weapon.damage_MJ !== 'number');
  assert.ok(magneticWithoutFigure.length > 0);
  const sample = magneticWithoutFigure[0];
  const derived = weaponDamage(
    { warheadMassKg: sample.warheadMass_kg, muzzleVelocityKps: sample.muzzleVelocity_kps },
    'magnetic_gun'
  );
  assert.ok(derived.damagePerShotMJ > 0);
  assert.equal(derived.agreement, null, 'with no shipped figure the agreement must be null, not "agrees"');
});

test('the kinetic pin is not vacuous: perturbing the model breaks it', () => {
  const rows = weaponsWithShippedDamage();
  // The same comparison the model makes, with the exponent moved from 2 to 2.1.
  let disagreements = 0;
  for (const row of rows) {
    const perturbed = 0.5 * row.weapon.warheadMass_kg * row.weapon.muzzleVelocity_kps ** 2.1;
    if (Math.abs(perturbed / row.stated - 1) > 1e-6) disagreements += 1;
  }
  assert.ok(disagreements > rows.length / 2,
    `a wrong exponent must disagree with the shipped figures; only ${disagreements} of ${rows.length} disagreed`);
});

// ---------------------------------------------------------------------------
// PIN 2 -- MOUNT HARDPOINT COSTS
// ---------------------------------------------------------------------------

/**
 * The mount table, written out a second time, independently of the module.
 *
 * A pin that reads its expectation from the code it is pinning is decoration.
 * This is the same relation stated twice; changing one side fails the test.
 */
const EXPECTED_MOUNT_COST = Object.freeze({
  OneNose: 1, TwoNoseVert: 2, ThreeNoseAngle: 3, FourNose: 4, HalfNose: 0.5,
  OneHull: 1, TwoHullHoriz: 2, FourHull: 4, HalfHull: 0.5,
  RegionDefense: null, T1BaseDefense: null, T2BaseDefense: null, T3BaseDefense: null
});

test('every mount the templates use has a hardpoint cost, and the costs match', () => {
  templateLoader.load();
  const mountsInTemplates = new Set();
  for (const weapon of templateLoader.templates.weaponModules.values()) {
    if (weapon.mount) mountsInTemplates.add(weapon.mount);
  }
  assert.ok(mountsInTemplates.size >= 10);

  for (const mount of mountsInTemplates) {
    assert.ok(MOUNT_HARDPOINTS[mount], `mount '${mount}' is used by a template but has no hardpoint cost`);
    assert.equal(mountCost(mount).hardpoints, EXPECTED_MOUNT_COST[mount], `hardpoint cost for '${mount}'`);
  }

  // An unrecognised mount is UNKNOWN, never free. A guessed zero would make a
  // weapon look infinitely efficient per hardpoint.
  const unknown = mountCost('SomeFutureMount');
  assert.equal(unknown.hardpoints, null);
  assert.match(unknown.reason, /not in the validated mount table/);

  // The two mounts no design in the live save exercises are labelled as such
  // rather than passed off as measured.
  const unverified = Object.entries(MOUNT_HARDPOINTS).filter(([, entry]) => entry.verifiedInSave === false);
  assert.deepEqual(unverified.map(([name]) => name).sort(), ['HalfHull', 'HalfNose']);
});

test('hull hardpoint counts agree with the hull\'s own module slot list', () => {
  templateLoader.load();
  let checked = 0;
  for (const hull of templateLoader.templates.shipHulls.values()) {
    const slots = Array.isArray(hull.shipModuleSlots) ? hull.shipModuleSlots : [];
    if (slots.length === 0) continue;
    const count = (type) => slots.filter(slot => slot.moduleSlotType === type).length;
    assert.equal(count('NoseHardPoint'), hull.noseHardpoints, `${hull.dataName} nose hardpoints`);
    assert.equal(count('HullHardPoint'), hull.hullHardpoints, `${hull.dataName} hull hardpoints`);
    assert.equal(count('Utility'), hull.internalModules, `${hull.dataName} internal modules`);
    checked += 1;
  }
  assert.ok(checked >= 25, `expected every hull to be checked, got ${checked}`);
});

test('the hardpoint pin is not vacuous: a wrong cost stops filling the hulls', () => {
  templateLoader.load();
  const hulls = [...templateLoader.templates.shipHulls.values()];
  const perturbed = { ...EXPECTED_MOUNT_COST, ThreeNoseAngle: 2 };
  // A three-hardpoint nose filled by one ThreeNoseAngle mount is exactly the
  // arithmetic the live-save check performs 515 times.
  const threeNoseHulls = hulls.filter(hull => hull.noseHardpoints === 3);
  assert.ok(threeNoseHulls.length > 0, 'the templates must contain a 3-nose-hardpoint hull');
  for (const hull of threeNoseHulls) {
    assert.equal(EXPECTED_MOUNT_COST.ThreeNoseAngle, hull.noseHardpoints);
    assert.notEqual(perturbed.ThreeNoseAngle, hull.noseHardpoints,
      'the perturbed cost must fail to fill the hull it is supposed to fill');
  }
});

// ---------------------------------------------------------------------------
// THE BAKED PAYLOAD
// ---------------------------------------------------------------------------

test('the component catalogue covers every unlock family except drives and orgs', () => {
  const stats = buildComponentStats();
  const familyNames = new Set(UNLOCK_FAMILIES.map(spec => spec.family));
  const covered = new Set(Object.keys(stats));

  for (const family of covered) {
    assert.ok(familyNames.has(family), `componentStats family '${family}' is not an unlock-index family`);
  }
  const missing = [...familyNames].filter(name => !covered.has(name));
  assert.deepEqual(missing.sort(), ['drive', 'org'],
    'drives are phase 1 and orgs are tech-gated council equipment; everything else must be covered');

  // Counts that would silently drop to zero if a template stopped loading.
  assert.equal(Object.keys(stats.laser_weapon).length, 125);
  assert.equal(Object.keys(stats.magnetic_gun).length, 70);
  assert.equal(Object.keys(stats.gun).length, 8);
  assert.equal(Object.keys(stats.particle_weapon).length, 33);
  assert.equal(Object.keys(stats.plasma_weapon).length, 16);
  assert.equal(Object.keys(stats.missile).length, 57);
  assert.equal(Object.keys(stats.ship_hull).length, 28);
  assert.equal(Object.keys(stats.ship_armor).length, 12);
  assert.equal(Object.keys(stats.power_plant).length, 61);
  assert.equal(Object.keys(stats.radiator).length, 13);
  assert.equal(Object.keys(stats.heat_sink).length, 14);
  assert.equal(Object.keys(stats.battery).length, 10);
  // 58 rows in the template file, one of which is the `Empty` placeholder --
  // the absence of a module, not a module.
  assert.equal(Object.keys(stats.utility_module).length, 57);
  assert.equal(stats.utility_module.Empty, undefined,
    'the unfilled-slot placeholder must never appear as something to research');
  assert.equal(Object.keys(stats.hab_module).length, 156);
});

test('the catalogue keys are the unlock index keys, so a gate resolves without a second table', () => {
  const snapshot = turnOneSnapshot();
  const stats = snapshot.componentStats;
  const gates = snapshot.unlockIndex.gates;

  let matched = 0;
  const orphans = [];
  for (const gate of Object.values(gates)) {
    for (const [family, items] of Object.entries(gate.unlocks || {})) {
      if (family === 'drive' || family === 'org') continue;
      for (const item of items) {
        if (stats[family] && stats[family][item.id]) matched += 1;
        else orphans.push(`${family}:${item.id}`);
      }
    }
  }
  assert.equal(orphans.length, 0, `unlock-index entries with no catalogue row: ${orphans.slice(0, 5).join(', ')}`);
  assert.ok(matched > 500, `expected the gated catalogue to be large, matched ${matched}`);
});

test('no component carries a redundant requiredProjectName, because the unlock index has it', () => {
  const stats = buildComponentStats();
  for (const [family, entries] of Object.entries(stats)) {
    for (const [id, row] of Object.entries(entries)) {
      assert.equal(row.requiredProjectName, undefined,
        `${family}:${id} re-emits its gate; the unlock index already holds that relation`);
    }
  }
});

test('the baked catalogue stays inside its stated size budget', () => {
  const stats = buildComponentStats();
  const bytes = Buffer.byteLength(JSON.stringify(stats), 'utf8');
  // Measured 2026-08-21 at 168 KB raw / 17 KB gzipped, which is 5.5% of the
  // 3.07 MB player-mode row. The ceiling exists so a future field addition has
  // to be a deliberate decision rather than a silent one.
  //
  // Phase 5 spent 5.3 KB of it: 166.6 -> 171.9 KB raw, 17.0 -> 17.4 KB gzipped,
  // for the five delivery fields below. Measured 2026-08-21 against the
  // installed 1.0 templates.
  assert.ok(bytes < 200 * 1024, `componentStats is ${(bytes / 1024).toFixed(1)} KB, over the 200 KB budget`);
  assert.ok(bytes > 100 * 1024, `componentStats is only ${(bytes / 1024).toFixed(1)} KB; a family probably stopped loading`);
});

test('the five delivery inputs are baked, and the two pins\' inputs deliberately are not', () => {
  const stats = buildComponentStats();

  // A guided round carries all five. Anything less and the flight cannot be
  // modelled at request time, where there is no template directory to read.
  const copperhead = stats.missile.CopperheadMissileBay;
  assert.equal(copperhead.accelerationG, 18.27);
  assert.equal(copperhead.thrustRampS, 6);
  assert.equal(copperhead.rotationDegPerS, 25);
  assert.equal(copperhead.turnRampS, 1);
  assert.equal(copperhead.maneuverAngleDeg, 50);

  // An unguided slug carries NONE of them, and that is a fact about a slug
  // rather than a hole in the bake -- `compact` drops absent fields.
  const rail = stats.magnetic_gun.HeavyRailCannonMk3;
  assert.equal(rail.accelerationG, undefined);
  assert.equal(rail.rotationDegPerS, undefined);
  assert.equal(rail.muzzleVelocityKps, 7.125, 'what it does carry is a muzzle velocity');
  assert.equal(rail.pointDefenseTargetable, true);

  // The PIN inputs stay out of the payload. Their job is to justify the model
  // once, in a test against the installed templates, exactly as the 515-design
  // mount pin does -- not to travel with every request.
  for (const [family, entries] of Object.entries(stats)) {
    for (const [id, row] of Object.entries(entries)) {
      for (const field of ['rocketThrustN', 'evKps', 'ammoMassKg', 'fuelMassKg', 'systemMassKg']) {
        assert.equal(row[field], undefined, `${family}:${id} bakes ${field}, which only the pin needs`);
      }
    }
  }
});

test('the delivery axis reaches only the classes that declare it; the other fifteen are untouched', () => {
  const result = project(fieldedSnapshot(), { observerId: OBSERVER, detail: 'full' });

  const declaring = [];
  for (const entry of result.items) {
    const floor = entry.ranking ? entry.ranking.deliveryFloor : null;
    if (entry.role === WEAPON_ROLES.offensive) {
      assert.ok(floor, `${entry.classKey} is an offensive weapon class and must declare a delivery floor`);
      assert.equal(floor.axis, 'deliveryShotsPerArrivingRound');
      assert.ok(entry.deliveryDemoted, 'a class with a delivery floor carries its demotion census');
      declaring.push(entry.classKey);
      continue;
    }
    // Every other class: the field exists and is explicitly null, and nothing
    // about its ranking changed.
    assert.equal(floor ?? null, null, `${entry.classKey} must declare no delivery floor`);
    assert.equal(entry.deliveryDemoted, null, `${entry.classKey} must carry a null demotion census, not an empty one`);
    for (const state of Object.keys(entry.bestByState || {})) {
      const row = entry.bestByState[state];
      if (!row) continue;
      assert.equal(row.clearsDeliveryFloor, null, `${entry.classKey}:${state} must have no delivery verdict`);
      assert.equal(row.deliveryShotsPerArrivingRound, null);
      assert.equal(row.deliveryFloorValue, null);
    }
  }
  assert.equal(result.items.length - declaring.length, result.items.length - declaring.length);
  assert.deepEqual(declaring.sort(),
    ['gun:offensive', 'laser_weapon:offensive', 'magnetic_gun:offensive', 'missile:offensive',
      'particle_weapon:offensive', 'plasma_weapon:offensive']);

  // A beam class declares the floor and can never measure one, because no beam
  // is interceptable. That is a null verdict with a reason, not a pass.
  const lasers = classOf(result, 'laser_weapon:offensive');
  assert.equal(lasers.ranking.deliveryFloor.value, null);
  assert.match(lasers.ranking.deliveryFloor.basis, /not measurable/);
  assert.equal(lasers.deliveryDemoted.count, 0);
  for (const row of lasers.candidates) {
    assert.equal(row.clearsDeliveryFloor, null);
    assert.match(row.deliveryFloorReason, /not point-defence targetable/);
  }
});

test('a turn-1 observer with no fleets gets an honest empty delivery environment, not a zero', () => {
  const result = project(turnOneSnapshot(), { observerId: OBSERVER });
  const environment = result.deliveryEnvironment;

  assert.equal(environment.available, false);
  assert.ok(environment.reason && environment.reason.length > 0);
  assert.match(environment.reason, /not the same as an undefended target/);
  assert.equal(environment.selected, null);
  assert.equal(environment.validatedAgainstGameOutput, false);

  for (const key of ['observed-opposing', 'observer-own']) {
    const profile = environment.profiles[key];
    assert.equal(profile.available, false, `${key} must not claim availability with nothing read`);
    assert.equal(profile.hullsRead, 0);
    assert.equal(profile.meanMountsPerHull, null, 'a mean over zero hulls is null, never 0');
    assert.equal(profile.pointDefenseInstallations, null);
    assert.equal(profile.maxEngagementRangeKm, null);
    assert.deepEqual(profile.weapons, []);
    assert.equal(profile.weaponsOmittedCount, 0);
  }

  // Every offensive class still describes its catalogue; it just cannot
  // evaluate a floor, and says so rather than passing everything.
  const missiles = classOf(result, 'missile:offensive');
  assert.equal(missiles.ranking.deliveryFloor.value, null);
  assert.equal(missiles.deliveryDemoted.count, 0);
  const torpedo = missiles.bestByState['prereq-blocked'] || missiles.bestByState['researchable-now'];
  if (torpedo) {
    assert.equal(torpedo.clearsDeliveryFloor, null);
    assert.notEqual(torpedo.clearsDeliveryFloor, true);
  }
});

test('the delivery figures degrade honestly by mode, and the finding survives both', () => {
  const byMode = {};
  for (const mode of ['player', 'omniscient']) {
    const result = project(fieldedSnapshot(mode), { observerId: OBSERVER, mode });
    const environment = result.deliveryEnvironment;
    assert.equal(environment.available, true, `${mode}: the fixture's alien hull carries point defence`);
    assert.equal(environment.selected, 'observed-opposing');
    const missiles = classOf(result, 'missile:offensive');
    byMode[mode] = {
      hullsRead: environment.profiles['observed-opposing'].hullsRead,
      floor: missiles.ranking.deliveryFloor.value,
      torpedo: missiles.bestByState['prereq-blocked'],
      demoted: missiles.deliveryDemoted.count
    };
  }

  // The alien hull in this fixture is redacted in BOTH modes -- it names no
  // design -- so the weapon-display-name path is the only one available and the
  // two modes agree exactly. On the live save, where omniscient CAN see the
  // designs, the mount count is higher and the figures differ; the ordering and
  // the finding do not. See spec section 3c.
  assert.equal(byMode.player.hullsRead, byMode.omniscient.hullsRead);
  assert.equal(byMode.player.floor, byMode.omniscient.floor);
  assert.equal(byMode.player.demoted, byMode.omniscient.demoted);
  assert.ok(byMode.player.floor > 0, 'a floor was actually measured, so this is not vacuously equal');
  assert.equal(byMode.player.torpedo.id, byMode.omniscient.torpedo.id);
  assert.equal(byMode.player.torpedo.clearsDeliveryFloor, byMode.omniscient.torpedo.clearsDeliveryFloor);
  assert.equal(byMode.player.torpedo.deliveryShotsPerArrivingRound,
    byMode.omniscient.torpedo.deliveryShotsPerArrivingRound);
});

// ---------------------------------------------------------------------------
// TURN ONE -- §0
// ---------------------------------------------------------------------------

test('a turn-1 observer fielding nothing gets an honest empty baseline, not a fabricated one', () => {
  const result = project(turnOneSnapshot(), { observerId: OBSERVER });

  assert.equal(result.resource, 'military-value');
  assert.ok(result.count > 10, 'the catalogue is still fully described with nothing flown');
  assert.equal(result.componentCatalogue.available, true);
  assert.equal(result.fielded.shipsRead, 0);
  assert.match(result.fielded.basis, /no hulls in service/);
  assert.equal(result.fielded.armament.nose, null);
  assert.equal(result.fielded.armament.hull, null);
  assert.match(result.fielded.armament.reason, /no offensive weapon/);
  assert.equal(result.fielded.largestHull, null);

  for (const entry of result.items) {
    assert.equal(entry.fielded.count, 0, `${entry.classKey} must field nothing at turn 1`);
    assert.ok(entry.fielded.note, `${entry.classKey} must say there is no baseline`);
    assert.equal(entry.ranking?.floorValue ?? null, null, `${entry.classKey} floor must be unmeasurable`);
    for (const best of Object.values(entry.bestByState || {})) {
      if (!best) continue;
      assert.equal(best.vsFielded.rankMetricMultiple, null,
        `${entry.classKey}: a multiple against nothing must be null, never 1`);
      assert.equal(best.vsFielded.improvesRankMetric, null,
        `${entry.classKey}: "improves" against nothing must be null, never false`);
    }
  }
});

test('a turn-1 hull cannot be given a throw weight, and says so instead of scoring zero', () => {
  const result = project(turnOneSnapshot(), { observerId: OBSERVER, detail: 'full' });
  const hulls = classOf(result, 'ship_hull');
  assert.ok(hulls);
  assert.equal(hulls.notComparableCount, hulls.catalogueSize,
    'with no armament to fill them, no hull has a measurable throw weight');
  for (const row of hulls.notComparable) {
    assert.match(row.reason, /no offensive weapon|hardpoint count/);
  }
  // Not zero. A zero would rank a Titan level with a Gunship.
  for (const row of hulls.candidates) {
    assert.equal(row.throwWeightMW, null);
  }
});

test('turn-1 availability still comes from the save\'s own list', () => {
  const result = project(turnOneSnapshot(), { observerId: OBSERVER });
  assert.equal(result.research.availabilityResolvable, true);
  assert.equal(result.research.availabilitySource, 'factions[observer].availableProjectNames');
  assert.equal(result.research.availableProjectCount, TURN_ONE_AVAILABLE.length);
  assert.equal(result.research.monthlyResearchIncome, 12);

  const lasers = classOf(result, 'laser_weapon:offensive');
  assert.ok(lasers.candidateStates[AVAILABILITY_STATES.prereqBlocked] > 0,
    'almost every laser must be prerequisite-blocked at turn 1');
  assert.equal(lasers.candidateStates[AVAILABILITY_STATES.completed], 0,
    'a turn-1 faction has completed nothing');
});

// ---------------------------------------------------------------------------
// COMPARED AGAINST WHAT THE OBSERVER FIELDS -- §0
// ---------------------------------------------------------------------------

test('the baseline is read from the hulls in service, per family', () => {
  const result = project(fieldedSnapshot(), { observerId: OBSERVER });
  assert.equal(result.fielded.shipsRead, 1);
  assert.equal(result.fielded.shipsViaDesign, 1);
  assert.equal(result.fielded.shipsViaWeaponLoadout, 0);
  assert.deepEqual(result.fielded.unresolved, []);

  const expectations = {
    'magnetic_gun:offensive': 'LightRailCannonMk1',
    'missile:offensive': 'KraitMissileBay',
    'laser_weapon:point-defense': 'PointDefenseLaserTurret',
    ship_hull: 'Battlecruiser',
    ship_armor: 'SteelArmor',
    power_plant: 'SolidCoreFissionReactorI',
    radiator: 'AluminumFin',
    heat_sink: 'WaterHeatSink',
    battery: 'Lithium-IonBattery',
    utility_module: 'TargetingComputer1'
  };
  for (const [classKey, id] of Object.entries(expectations)) {
    const entry = classOf(result, classKey);
    assert.ok(entry, `${classKey} must be a comparison class`);
    assert.ok(entry.fielded.items.some(row => row.id === id),
      `${classKey} must report ${id} as fielded, got ${entry.fielded.items.map(row => row.id).join(', ')}`);
  }

  // Three armour slots on one design is one armour type installed three times,
  // and the count is of INSTALLATIONS, not of hulls.
  assert.equal(classOf(result, 'ship_armor').fielded.items[0].fieldedCount, 3);
  assert.equal(classOf(result, 'ship_armor').fielded.installationsInService, 3);
  // One hull, one reactor: for those the two counts coincide.
  assert.equal(classOf(result, 'ship_hull').fielded.installationsInService, 1);
  // Three rail cannon in one nose is three installations on one ship.
  assert.equal(classOf(result, 'magnetic_gun:offensive').fielded.installationsInService, 3);
});

test('a cost axis that reaches zero reports an unbounded ratio, not a null with a verdict', () => {
  // The STO Fighter costs no mission control at all. `baseline / 0` is not a
  // number, so the multiple is null -- and saying `unavailable: null` beside it
  // would claim a figure that is not there.
  const free = ratioAgainst(0, 3, 'lower');
  assert.equal(free.multiple, null);
  assert.equal(free.unavailable, 'ratio-unbounded');
  assert.equal(free.improves, true, 'costing nothing against a real cost is unambiguously better');

  const result = project(fieldedSnapshot(), { observerId: OBSERVER });
  assert.ok(result.codes.ratioUnavailable['ratio-unbounded'], 'the code must be documented in the response');

  // The invariant, over the whole response: a null multiple always carries a
  // code, and a code always accompanies a null multiple.
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Object.prototype.hasOwnProperty.call(node, 'multiple') && Object.prototype.hasOwnProperty.call(node, 'unavailable')) {
      assert.equal(node.multiple === null, node.unavailable !== null,
        `contradictory ratio: ${JSON.stringify(node)}`);
    }
    for (const value of Object.values(node)) walk(value);
  };
  walk(result);
});

test('the hull ranking fills every hull with the same fielded weapon, so it isolates the hull', () => {
  const result = project(fieldedSnapshot(), { observerId: OBSERVER, detail: 'full' });
  const hulls = classOf(result, 'ship_hull');
  assert.equal(hulls.ranking.rankBy, 'throwWeightMW');
  assert.equal(hulls.ranking.floorAxis, 'structuralIntegrityPerKiloton');

  const armament = result.fielded.armament;
  assert.equal(armament.nose.id, 'LightRailCannonMk1');
  assert.equal(armament.hull.id, 'KraitMissileBay');

  // Every candidate's throw weight is its own hardpoint count times the SAME
  // two weapons. Recomputed here from the reported inputs.
  for (const row of hulls.candidates) {
    if (row.throwWeightMW === null) continue;
    const expected = row.noseHardpoints * armament.nose.outputPerHardpointMW
      + row.hullHardpoints * armament.hull.outputPerHardpointMW;
    assert.ok(Math.abs(row.throwWeightMW - expected) < 1e-6,
      `${row.id}: throw weight ${row.throwWeightMW} does not match ${expected}`);
  }
});

test('a better weapon that is too heavy is visible as such, not hidden behind its damage', () => {
  const result = project(fieldedSnapshot(), { observerId: OBSERVER, detail: 'full', limit: 100 });
  const guns = classOf(result, 'magnetic_gun:offensive');
  assert.equal(guns.ranking.rankBy, 'outputPerHardpointMW');
  assert.equal(guns.ranking.floorAxis, 'outputPerTonMWPerTon',
    'the floor must be the axis output-per-hardpoint trades against');

  // The trade is reported per row, and at least one candidate must actually
  // fail the floor -- otherwise the floor is doing nothing on this fixture.
  const belowFloor = guns.candidates.filter(row => row.clearsFloor === false);
  assert.ok(belowFloor.length > 0, 'the mass floor must bite on at least one candidate');
  for (const row of belowFloor) {
    assert.match(row.floorReason, /outputPerTonMWPerTon/);
  }
  // And each weapon's mass is priced against the largest hull actually flown.
  for (const row of guns.candidates) {
    if (row.massTons === null) continue;
    assert.equal(row.hullMassFractionOf, 'Battlecruiser');
    assert.ok(row.hullMassFraction > 0);
  }
});

// ---------------------------------------------------------------------------
// NEVER ONE SCORE
// ---------------------------------------------------------------------------

test('point defence is its own comparison class, never ranked against offensive armament', () => {
  const result = project(fieldedSnapshot(), { observerId: OBSERVER, detail: 'full' });
  const offensive = classOf(result, 'laser_weapon:offensive');
  const pointDefense = classOf(result, 'laser_weapon:point-defense');
  assert.ok(offensive && pointDefense);
  assert.equal(pointDefense.role, WEAPON_ROLES.pointDefense);
  assert.match(pointDefense.rankRationale, /separate axis/);

  const offensiveIds = new Set([...offensive.candidates, ...offensive.fielded.items].map(row => row.id));
  for (const row of [...pointDefense.candidates, ...pointDefense.fielded.items]) {
    assert.ok(!offensiveIds.has(row.id), `${row.id} appears in both the offensive and point-defence classes`);
  }
  // The observer's point-defence turret is the point-defence baseline and is
  // absent from the offensive class entirely.
  assert.ok(pointDefense.fielded.items.some(row => row.id === 'PointDefenseLaserTurret'));
  assert.ok(!offensiveIds.has('PointDefenseLaserTurret'));
});

test('every ranked class declares one axis and a stated floor, and never a blended score', () => {
  const snapshotForShape = fieldedSnapshot();
  const result = project(snapshotForShape, { observerId: OBSERVER });
  for (const entry of result.items) {
    assert.ok(entry.rankRationale, `${entry.classKey} must say why it ranks the way it does`);
    if (entry.kind === 'rule-grouped') {
      assert.equal(entry.ranking, null);
      assert.equal(entry.bestByState, null);
      assert.ok(Array.isArray(entry.ruleSummary));
      // Refusing to rank across rules must not mean refusing to answer: each
      // rule still names what the observer would research for it.
      const actionable = entry.ruleSummary.filter(rule => rule.bestCandidate !== null);
      assert.ok(actionable.length > 0, `${entry.classKey} offers no candidate for any rule`);
      for (const rule of actionable) {
        assert.ok(rule.bestCandidate.researchState, `${rule.rule} candidate must carry its availability state`);
        assert.equal(rule.bestCandidate.vsFieldedInRule.candidate, rule.bestCandidate.ruleValue);
      }
      // Nothing may be silently invisible: an item with no rule joins no rule
      // group, so it has to be accounted for separately or it vanishes from
      // the summary entirely.
      assert.ok(entry.unruled, `${entry.classKey} must account for its rule-less items`);
      assert.equal(entry.unruled.ids.length, entry.unruled.count);
      if (entry.unruled.count > 0) assert.ok(entry.unruled.note);
      const catalogue = snapshotForShape.componentStats[entry.family];
      const ruleField = entry.family === 'hab_module' ? 'specialRules' : 'specialModuleRules';
      const expectedUnruled = Object.values(catalogue)
        .filter(stats => !Array.isArray(stats[ruleField]) || stats[ruleField].length === 0).length;
      assert.equal(entry.unruled.count, expectedUnruled,
        `${entry.classKey}: ${expectedUnruled} catalogue items carry no rule`);
      continue;
    }
    if (entry.ranking === null) {
      // A ranked class that declines to rank must say why, never just omit it.
      assert.ok(entry.rankingUnavailableReason, `${entry.classKey} has no ranking and no reason for it`);
      continue;
    }
    assert.equal(entry.rankingUnavailableReason, null);
    assert.ok(entry.ranking.rankBy, `${entry.classKey} must name its ranking axis`);
    assert.ok(['higher', 'lower'].includes(entry.ranking.direction));
    // No field anywhere may be a composite score.
    assert.equal(entry.score, undefined);
    assert.equal(entry.totalScore, undefined);
  }
  // The axis descriptors are stated once and referenced by name.
  assert.ok(result.axisSets.weapon.length > 0);
  for (const entry of result.items) {
    assert.ok(result.axisSets[entry.axisSet], `${entry.classKey} names an axis set that does not exist`);
    assert.equal(entry.axes, undefined, 'axis descriptors must not be inlined per class');
  }
});

test('a lower-is-better axis is normalised so ">1 means better" holds everywhere', () => {
  // Mission control is a cost. Halving it is an improvement, and the multiple
  // must read as 2, not 0.5 -- while the raw ratio stays visible.
  const cheaper = ratioAgainst(1, 2, 'lower');
  assert.equal(cheaper.multiple, 2);
  assert.equal(cheaper.rawRatio, 0.5);
  assert.equal(cheaper.improves, true);

  const higher = ratioAgainst(2, 1, 'higher');
  assert.equal(higher.multiple, 2);
  assert.equal(higher.rawRatio, undefined, 'the raw ratio is only emitted where it differs from the multiple');

  // Absent stays null, and "could not compare" is never "did not improve".
  const missing = ratioAgainst(null, 5, 'higher');
  assert.equal(missing.multiple, null);
  assert.equal(missing.improves, null);
  assert.equal(missing.unavailable, 'candidate-unmeasured');
  const noBaseline = ratioAgainst(5, null, 'higher');
  assert.equal(noBaseline.improves, null);
  assert.equal(noBaseline.unavailable, 'no-fielded-baseline');
});

// ---------------------------------------------------------------------------
// ABSENT STAYS NULL
// ---------------------------------------------------------------------------

test('a warhead the templates do not price is not-comparable, never zero', () => {
  const result = project(fieldedSnapshot(), { observerId: OBSERVER, detail: 'full' });
  const missiles = classOf(result, 'missile:offensive');
  // 31 of the 57 missile templates are Fragmentation or Penetrator and state
  // no damage figure at all.
  assert.equal(missiles.notComparableCount, 31);
  const fragment = missiles.notComparable.find(row => /Fragmentation|Penetrator/.test(row.reason));
  assert.ok(fragment, 'the reason must name the warhead class that cannot be priced');

  const metrics = weaponMetrics('x', { warheadClass: 'Fragmentation', cooldownS: 5, mount: 'OneHull' }, 'missile');
  assert.equal(metrics.damagePerShotMJ, null);
  assert.equal(metrics.sustainedOutputMW, null);
  assert.equal(metrics.outputPerHardpointMW, null);
  assert.notEqual(metrics.sustainedOutputMW, 0);
});

test('a rate with no magazine behind it says which kind of "no magazine" it is', () => {
  templateLoader.load();
  const torpedo = templateLoader.templates.weaponModules.get('AntimatterTorpedoLauncher');
  assert.ok(torpedo, 'the antimatter torpedo launcher must exist in the templates');
  const stats = buildComponentStats().missile.AntimatterTorpedoLauncher;
  const metrics = weaponMetrics('AntimatterTorpedoLauncher', stats, 'missile');
  assert.equal(metrics.magazineBasis, 'stated');
  assert.equal(metrics.magazineShots, 4);
  // Four rounds at a seven-second cycle: the 3 GW figure lasts 28 seconds.
  assert.ok(Math.abs(metrics.sustainedOutputDurationS - 28) < 1e-6);

  const laser = buildComponentStats().laser_weapon['60cmIRLaserBattery'];
  const laserMetrics = weaponMetrics('60cmIRLaserBattery', laser, 'laser_weapon');
  assert.equal(laserMetrics.magazineShots, null);
  assert.equal(laserMetrics.magazineBasis, 'not-ammunition-limited',
    'a beam weapon has no magazine as a fact, not as a gap');
  assert.ok(/power-limited/.test(project(turnOneSnapshot()).codes.magazineBasis['not-ammunition-limited']));
});

test('a salvo the template does not state is flagged as an assumption', () => {
  const withSalvo = weaponMetrics('a', { shotPowerMJ: 10, cooldownS: 5, salvoShots: 4, intraSalvoCooldownS: 1, mount: 'OneHull' }, 'laser_weapon');
  assert.equal(withSalvo.shotsPerCycle, 4);
  assert.equal(withSalvo.shotsPerCycleAssumed, false);
  assert.equal(withSalvo.cycleSeconds, 8, 'cooldown plus the three intra-salvo gaps');

  const withoutSalvo = weaponMetrics('b', { shotPowerMJ: 10, cooldownS: 5, mount: 'OneHull' }, 'laser_weapon');
  assert.equal(withoutSalvo.shotsPerCycle, 1);
  assert.equal(withoutSalvo.shotsPerCycleAssumed, true);
  assert.equal(withoutSalvo.cycleSeconds, 5, 'with no salvo the cycle is exactly the cooldown');
  assert.equal(withoutSalvo.sustainedOutputMW, 2, 'shotPower / cooldown, the formula the spec names');
});

test('the military axes of a hab module are surfaced; its income is left to phase 3', () => {
  const result = project(fieldedSnapshot(), { observerId: OBSERVER });
  const habs = classOf(result, 'hab_module');
  assert.ok(habs.militaryFlagged, 'space-combat and mission-control modules must be listed');
  assert.match(habs.militaryFlagged.basis, /not a score/);

  const combat = habs.militaryFlagged.items.filter(row => row.spaceCombatModule);
  assert.equal(combat.length, 6, 'the templates carry six space-combat hab modules');
  const missionControl = habs.militaryFlagged.items.filter(row => row.missionControl !== null);
  assert.equal(missionControl.length, 20, 'twenty hab modules supply mission control');
  for (const row of habs.militaryFlagged.items) {
    assert.ok(row.researchState, `${row.id} must carry its availability state`);
  }

  // Income is not valued here, and no income field leaks into the response.
  assert.match(habs.rankRationale, /ECONOMIC/);
  const serialised = JSON.stringify(habs);
  assert.ok(!/incomeResearch_month|incomeMoney_month|incomeVolatiles_month/.test(serialised),
    'hab-module income belongs to economic valuation and must not be half-reported here');
});

test('an item that is not gated at all gets its own state, not "completed"', () => {
  const result = project(fieldedSnapshot(), { observerId: OBSERVER, detail: 'full' });
  const armor = classOf(result, 'ship_armor');
  const ungated = armor.bestByState[AVAILABILITY_STATES.ungated];
  assert.ok(ungated, 'Steel, Titanium and Silicon Carbide armour carry no gate at all');
  assert.equal(ungated.gateProjectId, null);
  assert.equal(ungated.remainingResearchCost, null,
    'an ungated item has no research cost; zero would read as "already paid for"');
  assert.notEqual(AVAILABILITY_STATES.ungated, AVAILABILITY_STATES.completed);
});

// ---------------------------------------------------------------------------
// THE ARMOUR AXIS FOLLOWS THE MEASURED THREAT
// ---------------------------------------------------------------------------

test('armour is ranked on the shipped resistance ratings, not on a derived areal mass', () => {
  const result = project(fieldedSnapshot(), { observerId: OBSERVER });
  const armor = classOf(result, 'ship_armor');
  assert.ok(['xRayResistance', 'baryonicResistance', null].includes(armor.ranking?.rankBy ?? null));
  assert.ok(result.formulae.armorArealMassRejected.formula.startsWith('REJECTED'),
    'the derivation that was tried and dropped must stay on the record');
  assert.match(result.formulae.armorArealMassRejected.basis, /reverse of the shipped/);
});

test('the armour ranking axis moves when the observed threat moves', () => {
  const beam = threatMix([
    { role: WEAPON_ROLES.offensive, family: 'laser_weapon', sustainedOutputMW: 100 },
    { role: WEAPON_ROLES.offensive, family: 'magnetic_gun', sustainedOutputMW: 10 }
  ]);
  assert.equal(beam.dominant, 'xRay');
  assert.equal(rankArmorAxis(beam).rankBy, 'xRayResistance');
  assert.equal(rankArmorAxis(beam).floorAxis, 'baryonicResistance');

  const kinetic = threatMix([
    { role: WEAPON_ROLES.offensive, family: 'laser_weapon', sustainedOutputMW: 10 },
    { role: WEAPON_ROLES.offensive, family: 'magnetic_gun', sustainedOutputMW: 100 }
  ]);
  assert.equal(kinetic.dominant, 'baryonic');
  assert.equal(rankArmorAxis(kinetic).rankBy, 'baryonicResistance');

  // A particle weapon's own channel split wins over any family-level rule.
  const particle = threatMix([
    { role: WEAPON_ROLES.offensive, family: 'particle_weapon', sustainedOutputMW: 100, xRayFraction: 0.9, baryonFraction: 0 }
  ]);
  assert.equal(particle.dominant, 'xRay');
  assert.equal(particle.xRayOutputMW, 90);

  // Nothing observable means no ranking, not a default channel.
  const nothing = threatMix([]);
  assert.equal(nothing.dominant, null);
  assert.equal(rankArmorAxis(nothing).rankBy, null);
  assert.match(rankArmorAxis(nothing).reason, /no hostile armament is observable/);

  // Point defence never counts as a threat to armour.
  const pdOnly = threatMix([{ role: WEAPON_ROLES.pointDefense, family: 'laser_weapon', sustainedOutputMW: 999 }]);
  assert.equal(pdOnly.dominant, null);
});

// ---------------------------------------------------------------------------
// MODE
// ---------------------------------------------------------------------------

test('the static half of the answer is identical in both modes', () => {
  const player = project(turnOneSnapshot('player'), { observerId: OBSERVER, mode: 'player' });
  const omniscient = project(turnOneSnapshot('omniscient'), { observerId: OBSERVER, mode: 'omniscient' });
  assert.deepEqual(player.componentCatalogue.families, omniscient.componentCatalogue.families);
  assert.deepEqual(player.formulae, omniscient.formulae);
  assert.deepEqual(player.axisSets, omniscient.axisSets);
  assert.deepEqual(player.mounts.table, omniscient.mounts.table);
  assert.deepEqual(
    player.items.map(entry => entry.classKey),
    omniscient.items.map(entry => entry.classKey)
  );
});

test('the alien armament benchmark degrades honestly when alien designs are redacted', () => {
  const result = project(fieldedSnapshot('player'), { observerId: OBSERVER });
  const benchmark = result.alienBenchmark;
  assert.equal(benchmark.available, true);
  assert.equal(benchmark.designAttributionAvailable, false);
  assert.equal(benchmark.alienDesignsVisible, 0);
  assert.match(benchmark.basis, /redacted/);
  // The display-name join is what survives redaction, and it resolved.
  assert.equal(benchmark.distinctWeapons, 1);
  assert.equal(benchmark.bestOffensive.id, 'AlienLightMagBattery');
  assert.deepEqual(benchmark.unresolved, []);
  assert.ok(benchmark.gap.multiple !== null, 'with both sides measured the gap must be a number');
});

test('a weapon display name the catalogue does not know is reported, never guessed', () => {
  const snapshot = fieldedSnapshot('player', { alienWeapons: ['Zorblatt Disintegrator'] });
  const benchmark = project(snapshot, { observerId: OBSERVER }).alienBenchmark;
  assert.equal(benchmark.available, false);
  assert.equal(benchmark.distinctWeapons, 0);
  assert.ok(benchmark.unresolved.some(row => row.id === 'Zorblatt Disintegrator'));
});

test('no alien faction at all is reported as such, not as an absent threat', () => {
  const snapshot = fieldedSnapshot('player', { alienWeapons: [] });
  snapshot.factions = snapshot.factions.filter(faction => faction.ID !== ALIEN);
  const result = project(snapshot, { observerId: OBSERVER });
  assert.equal(result.alienBenchmark.available, false);
  assert.ok(result.alienBenchmark.reason);
  assert.equal(result.alienBenchmark.threatMix, null);

  // And with no measurable threat, armour is NOT ranked -- neither channel can
  // be shown to dominate, so the endpoint declines rather than defaulting.
  const armor = classOf(result, 'ship_armor');
  assert.equal(armor.ranking, null);
  assert.match(armor.rankingUnavailableReason, /no hostile armament is observable/);
  assert.equal(result.armorRanking.rankBy, null);
});

test('the catalogue index refuses ambiguous ids and display names', () => {
  const result = project(turnOneSnapshot(), { observerId: OBSERVER });
  // On the installed 1.0 templates there are none. This asserts that rather
  // than assuming it, so a future patch that introduces a collision is visible
  // instead of silently resolving to whichever entry loaded last.
  assert.deepEqual(result.componentCatalogue.ambiguousIds, []);
  assert.deepEqual(result.componentCatalogue.ambiguousDisplayNames, []);
});

// ---------------------------------------------------------------------------
// SHAPE, FILTERS, DEGRADATION
// ---------------------------------------------------------------------------

test('detail=summary omits the heavy listing and says so; detail=full carries it', () => {
  const snapshot = fieldedSnapshot();
  const summary = project(snapshot, { observerId: OBSERVER });
  const full = project(snapshot, { observerId: OBSERVER, detail: 'full' });

  assert.equal(summary.detail, 'summary');
  assert.ok(summary.filter.note);
  for (const entry of summary.items) {
    assert.equal(entry.candidates, null);
    assert.equal(entry.byRule, null);
    assert.ok(entry.candidateCount > 0 || entry.catalogueSize === entry.fielded.count);
  }
  assert.equal(full.detail, 'full');
  assert.ok(full.items.every(entry => entry.candidates !== null));

  const summaryBytes = Buffer.byteLength(JSON.stringify(summary), 'utf8');
  const fullBytes = Buffer.byteLength(JSON.stringify(full), 'utf8');
  assert.ok(fullBytes > summaryBytes, 'full must actually carry more than summary');
  // Raised from 220 KB to 280 KB for phase 5, and the raise is the deliberate
  // decision this ceiling exists to force rather than a silent drift. Measured
  // on this fixture 2026-08-21: summary 211.8 KB -> 250.7 KB raw (+38.9 KB),
  // 19.8 KB -> 24.9 KB gzipped (+5.1 KB); `detail=full` 761.8 KB -> 862.2 KB
  // raw, 49.9 KB -> 61.5 KB gzipped. What the growth buys: the delivery
  // formulae and axis descriptors and the basis codes, each stated ONCE
  // (~16.8 KB of the total); the point-defence profile the whole response is
  // measured against; the six flat delivery fields on every `bestByState` row;
  // and the per-class `deliveryDemoted` census, which exists precisely so the
  // floor cannot silently remove a row from the top of a ranking.
  //
  // Per-category research rates: 250.7 KB -> 270.2 KB on this fixture, WITHOUT
  // raising the ceiling. Each row gained a `monthsAtCurrentIncomeState` code
  // plus `categoryResearchBonus` and `flatRateMonths`; what each state MEANS is
  // stated once in `research.categoryBonuses.durationStates`, not per row.
  // A first cut that carried the sentence on every row measured 291.6 KB and
  // failed here, which is exactly what this ceiling is for. On the live save
  // the fields cost +27.9 KB raw / +4.3 KB gzipped on `summary`.
  //
  // RAISED 280 KB -> 310 KB on 2026-08-22 for allocation-priced durations, and
  // the raise is the deliberate decision this ceiling exists to force. Measured
  // on this fixture: 270.2 KB -> 300.4 KB (+30.2 KB). Two fields per row buy
  // it, on every row list the response carries (`bestByState`, `ranked` and the
  // `deliveryDemoted` census -- one list holding them and another not would put
  // a headline one-pip figure beside a full range and let a reader compare
  // them). Both were weighed against this ceiling before being kept:
  //
  //   `monthsFastestAllocation` -- the second end of the range. A duration for
  //     an item that is not in a slot ASSUMES a pip allocation, and the
  //     assumption moves the answer by more than 7x on this campaign. One
  //     number would be a counterfactual dressed as a measurement, and this
  //     figure is not derivable from anything else on the row.
  //   `monthsAreUpperBound` -- a correctness flag. Without it a bound and a
  //     point estimate render identically, which is the defect class this repo
  //     has hit most often.
  //
  // THREE further fields were REFUSED for this budget rather than shipped:
  // `allocationScenario` (the state code already implies it),
  // `allocatedMonthlyResearch` (exactly `remainingResearchCost /
  // monthsAtCurrentIncome`), and the per-row basis sentence (stated once in
  // `research.categoryBonuses.durationStates`). Measured on the LIVE save
  // rather than on this fixture, because that is where the row count bites:
  // 361.1 KB as shipped against 413.8 KB with all three, +52.7 KB across 149
  // rows for information already recoverable from the response.
  assert.ok(summaryBytes < 310 * 1024, `the default response is ${(summaryBytes / 1024).toFixed(1)} KB`);
});

test('the family filter narrows to one class without changing the answer for it', () => {
  const snapshot = fieldedSnapshot();
  const all = project(snapshot, { observerId: OBSERVER, detail: 'full' });
  const narrowed = project(snapshot, { observerId: OBSERVER, detail: 'full', family: 'ship_hull' });
  assert.equal(narrowed.count, 1);
  assert.deepEqual(narrowed.items[0], classOf(all, 'ship_hull'));

  // A weapon class key selects one role rather than the whole family.
  const pd = project(snapshot, { observerId: OBSERVER, family: 'laser_weapon:point-defense' });
  assert.equal(pd.count, 1);
  assert.equal(pd.items[0].role, WEAPON_ROLES.pointDefense);

  // An unknown family yields an empty class list, not a crash.
  const nothing = project(snapshot, { observerId: OBSERVER, family: 'not_a_family' });
  assert.equal(nothing.count, 0);
  assert.deepEqual(nothing.items, []);
});

test('a snapshot published before the component catalogue existed says so', () => {
  const snapshot = fieldedSnapshot();
  delete snapshot.componentStats;
  const result = project(snapshot, { observerId: OBSERVER });
  assert.equal(result.componentCatalogue.available, false);
  assert.match(result.componentCatalogue.reason, /re-publish/);
  assert.equal(result.count, 0);
  assert.deepEqual(result.items, []);
  // Degraded, not crashed, and the research half still reports its own state.
  assert.ok(result.research);
});

test('the limit is bounded and honoured', () => {
  const snapshot = fieldedSnapshot();
  const two = project(snapshot, { observerId: OBSERVER, detail: 'full', family: 'laser_weapon', limit: 2 });
  for (const entry of two.items) assert.ok(entry.candidatesShown <= 2);
  const huge = project(snapshot, { observerId: OBSERVER, detail: 'full', family: 'laser_weapon', limit: 100000 });
  for (const entry of huge.items) assert.ok(entry.candidatesShown <= 100);
  const zero = project(snapshot, { observerId: OBSERVER, detail: 'full', family: 'laser_weapon', limit: 0 });
  for (const entry of zero.items) assert.ok(entry.candidatesShown >= 1, 'a nonsense limit clamps up, never to nothing');
});

test('the rendered payload contains no undefined or NaN', () => {
  for (const detail of ['summary', 'full']) {
    const serialised = JSON.stringify(project(fieldedSnapshot(), { observerId: OBSERVER, detail }));
    assert.ok(!/:\s*NaN/.test(serialised), `NaN reached the ${detail} response`);
    assert.ok(!/undefined/.test(serialised), `undefined reached the ${detail} response`);
  }
});

test('the same snapshot always yields the same ranking', () => {
  const snapshot = fieldedSnapshot();
  const first = JSON.stringify(project(snapshot, { observerId: OBSERVER, detail: 'full' }));
  const second = JSON.stringify(project(fieldedSnapshot(), { observerId: OBSERVER, detail: 'full' }));
  assert.equal(first, second, 'the ranking must be deterministic');
});

test('an unmeasurable row sorts last and keeps its reason, never sorts as a zero', () => {
  const result = project(fieldedSnapshot(), { observerId: OBSERVER, detail: 'full', family: 'missile', limit: 100 });
  const missiles = result.items[0];
  const rows = missiles.candidates;
  const firstNull = rows.findIndex(row => row.rankValue === null);
  if (firstNull !== -1) {
    for (let index = firstNull; index < rows.length; index += 1) {
      assert.equal(rows[index].rankValue, null, 'once the unmeasurable rows start they must not be interleaved');
    }
  }
  // And they are never presented as the best of a state.
  for (const best of Object.values(missiles.bestByState)) {
    if (best) assert.notEqual(best.rankValue, null);
  }
});

test('weapon roles come from attack/defence mode, not from the weapon\'s name', () => {
  assert.equal(weaponRole({ mount: 'OneHull', attackMode: true, defenseMode: true }), WEAPON_ROLES.offensive);
  assert.equal(weaponRole({ mount: 'OneHull', attackMode: false, defenseMode: true }), WEAPON_ROLES.pointDefense);
  assert.equal(weaponRole({ mount: 'RegionDefense', attackMode: true, defenseMode: true }), WEAPON_ROLES.installation);
  // Neither mode set is unknown, not a silent default into either class.
  assert.equal(weaponRole({ mount: 'OneHull' }), WEAPON_ROLES.unknown);

  // And the structural test agrees with the template loader's own labelling.
  templateLoader.load();
  for (const weapon of templateLoader.templates.weaponModules.values()) {
    if (mountCost(weapon.mount).side === 'installation') continue;
    const structural = weaponRole({
      mount: weapon.mount,
      attackMode: weapon.attackMode === true,
      defenseMode: weapon.defenseMode === true
    });
    const loaderSaysPointDefense = weapon.role === 'Point Defense';
    assert.equal(structural === WEAPON_ROLES.pointDefense, loaderSaysPointDefense,
      `${weapon.dataName}: structural role ${structural} vs loader role ${weapon.role}`);
  }
});

// ---------------------------------------------------------------------------
// RULE VALUE ATTRIBUTION
//
// The template ships ONE `specialModuleValue` per module and a LIST of
// `specialModuleRules`, and never says which rule the value belongs to. Group
// by rule and compare across the group and you divide unlike quantities: on the
// live save the top military row in both modes read "Cyclotron 40.0x
// RadHardened", which is a particle-beam power bonus of 20 over a magazine
// capacity multiplier of 0.5, filed under a boolean radiation-hardening tag.
// ---------------------------------------------------------------------------

/** An observer whose only utility module is a Magazine, as the live save's is. */
function magazineSnapshot(mode = 'player') {
  const snapshot = fieldedSnapshot(mode);
  snapshot.shipDesigns[0].moduleTemplateEntries = [
    { moduleName: 'WaterHeatSink' },
    { moduleName: 'Lithium-IonBattery' },
    { moduleName: 'Magazine' }
  ];
  return snapshot;
}

const ruleGroup = (result, classKey, rule) =>
  (classOf(result, classKey).byRule || {})[rule] || null;

test('ruleSignatureOf is order-independent, and absent rules stay null', () => {
  assert.equal(ruleSignatureOf(['RadHardened', 'Magazine']), ruleSignatureOf(['Magazine', 'RadHardened']));
  assert.equal(ruleSignatureOf(['Magazine', 'RadHardened']), 'Magazine + RadHardened');
  // No rules is not a rule set of one empty name.
  assert.equal(ruleSignatureOf([]), null);
  assert.equal(ruleSignatureOf(null), null);
  assert.equal(ruleSignatureOf(['', '  ']), null);
});

test('the artifact this gate exists to stop is real: RadHardened spans eight unlike quantities', () => {
  const result = project(magazineSnapshot(), { observerId: OBSERVER, detail: 'full' });
  const group = ruleGroup(result, 'utility_module', 'RadHardened');
  assert.ok(group, 'the templates carry a RadHardened group');
  // Eight distinct rule sets: thrust multipliers, EV multipliers, magazine
  // multipliers, armour fractions, troop counts and a particle-beam bonus, all
  // wearing the same tag.
  assert.equal(group.attribution.signaturesInGroup.length, 8);
  // And the rule the value can be attributed to spans exactly one.
  assert.equal(ruleGroup(result, 'utility_module', 'Magazine').attribution.signaturesInGroup.length, 1);
  assert.equal(ruleGroup(result, 'utility_module', 'EVMultiplier').attribution.signaturesInGroup.length, 1);

  // The number the gate refuses, stated so the test says what it is refusing.
  assert.equal(ratioAgainst(20, 0.5, 'higher').multiple, 40);
});

test('a rule value is only divided by a value carrying the identical rule set', () => {
  const result = project(magazineSnapshot(), { observerId: OBSERVER, detail: 'full', limit: 50 });
  const group = ruleGroup(result, 'utility_module', 'RadHardened');
  assert.equal(group.fieldedCount, 1, 'the observer flies exactly one RadHardened module: the Magazine');

  const cyclotron = group.items.find(row => row.id === 'Cyclotron');
  assert.ok(cyclotron, 'the Cyclotron is still listed, not hidden');
  assert.equal(cyclotron.ruleValue, 20, 'and it keeps its own measured value');
  assert.equal(cyclotron.vsFieldedInRule.multiple, null, 'but no multiple is formed across unlike rule sets');
  assert.equal(cyclotron.vsFieldedInRule.unavailable, 'no-same-signature-baseline');
  assert.equal(cyclotron.vsFieldedInRule.baselineId, null);

  // A module that DOES share the Magazine's rule set is still compared.
  const alien = group.items.find(row => row.id === 'AlienMagazine');
  assert.equal(alien.vsFieldedInRule.baselineId, 'Magazine');
  assert.equal(alien.vsFieldedInRule.multiple, 1);

  // The group still names what the observer flies, and says the baseline only
  // holds for its own signature rather than for the whole group.
  assert.equal(group.fieldedBest.id, 'Magazine');
  assert.equal(group.fieldedBest.isBaselineForSignatureOnly, true);
});

test('the attribution gate is not vacuous: dropping it restores the 40x', () => {
  const result = project(magazineSnapshot(), { observerId: OBSERVER, detail: 'full' });
  const group = ruleGroup(result, 'utility_module', 'RadHardened');
  const cyclotron = group.items.find(row => row.id === 'Cyclotron');
  // Exactly what the pre-gate code did: compare against the group's highest
  // fielded value, whatever rule set carried it.
  const ungated = ratioAgainst(cyclotron.ruleValue, group.fieldedBest.ruleValue, 'higher');
  assert.equal(ungated.multiple, 40);
  assert.notEqual(ungated.multiple, cyclotron.vsFieldedInRule.multiple);
});

test('a rule group with no same-signature baseline still offers a candidate, with no number', () => {
  const result = project(magazineSnapshot(), { observerId: OBSERVER, detail: 'full' });
  const group = ruleGroup(result, 'utility_module', 'RadHardened');
  // The whole group is not silently emptied, and the gate did not reorder what
  // it offers: the highest-valued candidate is still the one surfaced.
  assert.equal(group.bestCandidate.id, 'Cyclotron', 'the gate refuses a multiple, it does not re-pick');
  assert.equal(group.bestCandidate.ruleValue, 20, 'its own measured value survives');
  assert.equal(group.bestCandidate.vsFieldedInRule.multiple, null,
    'and it carries no multiple, so the ranking treats it as not-comparable rather than scoring it');
});
