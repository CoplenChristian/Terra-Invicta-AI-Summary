// Phase 0 + phase 1 of docs/engagement-matchup-spec.md: the weapon template
// join and the per-side battle composition. See shared/battleComposition.mjs.
//
// Everything here runs against HAND-BUILT fixtures. The suite must pass with
// TI_SAVE_PATH pointed at a folder that does not exist (the live-save guard),
// and the game templates are an install path away — so the two join faults the
// module exists to fix (the save's inserted `Shaped` qualifier, and torpedo
// bays carrying no `salvo_shots`) are reproduced from records built inline,
// exactly as the live-save measurement took them.
//
// The last test in the file is the one the brief demands be broken
// deliberately: the torpedo-absent-salvo path, the defect that silently
// under-counts weapons. It asserts the absent field reads as
// `SALVO_SHOTS_WHEN_ABSENT` and is reported in `salvoShotsAssumedMounts`.

const { test } = require('node:test');
const assert = require('node:assert');

const {
  MAX_BATTLE_SIDE_SHIPS,
  MAX_BATTLE_SIDE_SHIPS_ATTRIBUTION,
  PD_OVERWHELM_MULTIPLE,
  PD_OVERWHELM_RULE_ATTRIBUTION,
  SALVO_SHOTS_WHEN_ABSENT,
  INTERCEPTION_ASSUMPTION,
  normalizeWeaponName,
  buildWeaponIndex,
  composeBattleSide,
  saturationVerdict
} = require('../shared/battleComposition.mjs');

// ---------------------------------------------------------------------------
// Fixtures — template records in the shape server/templateLoader.js builds.
// ---------------------------------------------------------------------------

const SIDEWINDER = {
  dataName: 'SidewinderNuclearMissileBay',
  friendlyName: 'Sidewinder Nuclear Missile Bay',
  displayName: 'Sidewinder Nuclear Missile Bay',
  templateFamily: 'missile',
  category: 'Missile',
  role: 'Missile',
  salvo_shots: 4,
  isPointDefenseTargetable: true
};

// The torpedo-bay defect, verbatim: NO `salvo_shots` field at all.
const ACHERON_TORPEDO = {
  dataName: 'AcheronNuclearTorpedoBay',
  friendlyName: 'Acheron Nuclear Torpedo Bay',
  displayName: 'Acheron Nuclear Torpedo Bay',
  templateFamily: 'missile',
  category: 'Missile',
  role: 'Missile',
  isPointDefenseTargetable: true
};

// The 40mm Autocannon class: family `gun`, but the game's own field says its
// rounds are NOT interceptable.
const AUTOCANNON = {
  dataName: '40mmAutocannon',
  friendlyName: '40mm Autocannon',
  displayName: '40mm Autocannon',
  templateFamily: 'gun',
  category: 'Kinetic',
  role: 'Kinetic',
  salvo_shots: 6,
  isPointDefenseTargetable: false
};

const COILGUN = {
  dataName: 'CoilgunBatteryMk2',
  friendlyName: 'Coilgun Battery Mk2',
  displayName: 'Coilgun Battery Mk2',
  templateFamily: 'magnetic_gun',
  category: 'Kinetic',
  role: 'Kinetic',
  salvo_shots: 4,
  isPointDefenseTargetable: true
};

const PD_LASER = {
  dataName: 'PointDefenseLaserTurret',
  friendlyName: 'Point Defense Laser Turret',
  displayName: 'Point Defense Laser Turret',
  templateFamily: 'laser_weapon',
  category: 'Laser',
  role: 'Point Defense',
  isPointDefenseTargetable: false
};

const LASER_CANNON = {
  dataName: '256cmVioletLaserCannon',
  friendlyName: '256 cm Violet Laser Cannon',
  displayName: '256 cm Violet Laser Cannon',
  templateFamily: 'laser_weapon',
  category: 'Laser',
  role: 'Laser',
  isPointDefenseTargetable: false
};

const baseIndex = () => buildWeaponIndex([
  SIDEWINDER, ACHERON_TORPEDO, AUTOCANNON, COILGUN, PD_LASER, LASER_CANNON
]);

const group = (role, category, count, systems) => ({ role, category, count, systems });

// ---------------------------------------------------------------------------
// The named constants — user-attributed and dated, never bare numbers.
// ---------------------------------------------------------------------------

test('the 40-ship cap is a named constant attributed to the user and dated', () => {
  assert.strictEqual(MAX_BATTLE_SIDE_SHIPS, 40);
  assert.strictEqual(MAX_BATTLE_SIDE_SHIPS_ATTRIBUTION.stated, '2026-08-27');
  assert.match(MAX_BATTLE_SIDE_SHIPS_ATTRIBUTION.source, /user/i);
  assert.strictEqual(MAX_BATTLE_SIDE_SHIPS_ATTRIBUTION.measured, false);
});

test('the 2x overwhelm rule is a named constant attributed to the user, not a magic number', () => {
  assert.strictEqual(PD_OVERWHELM_MULTIPLE, 2);
  assert.strictEqual(PD_OVERWHELM_RULE_ATTRIBUTION.stated, '2026-08-27');
  assert.match(PD_OVERWHELM_RULE_ATTRIBUTION.source, /user/i);
  assert.strictEqual(PD_OVERWHELM_RULE_ATTRIBUTION.measured, false);
});

test('the interception assumption is stated, unverified, with the direction of its error', () => {
  assert.strictEqual(SALVO_SHOTS_WHEN_ABSENT, 1);
  assert.strictEqual(INTERCEPTION_ASSUMPTION.verified, false);
  assert.match(INTERCEPTION_ASSUMPTION.claim, /one point-defence mount neutralises roughly one incoming shot/i);
  assert.match(INTERCEPTION_ASSUMPTION.consequence, /understated/i);
});

// ---------------------------------------------------------------------------
// The join — the two measured faults.
// ---------------------------------------------------------------------------

test('the save\'s inserted `Shaped` qualifier resolves to the template', () => {
  const index = baseIndex();
  const entry = index.lookup.get(normalizeWeaponName('Sidewinder Shaped Nuclear Missile Bay'));
  assert.ok(entry, 'the save form must resolve');
  assert.strictEqual(entry.id, 'SidewinderNuclearMissileBay');
  assert.strictEqual(entry.salvoShots, 4);
  // Case- and spacing-insensitive both ways.
  assert.strictEqual(index.lookup.get(normalizeWeaponName(' sidewinder   shaped NUCLEAR missile bay ')), entry);
});

test('torpedo bays keep their absent salvo in the index — null, not zero', () => {
  const index = baseIndex();
  const entry = index.lookup.get(normalizeWeaponName('Acheron Nuclear Torpedo Bay'));
  assert.strictEqual(entry.salvoShots, null, 'absence must be preserved in the index');
});

test('a display name shadows another template\'s secondary name — Gen3 vs Advanced', () => {
  const gen3 = {
    dataName: 'Gen3AlienLightMagBattery', friendlyName: 'Gen3 Alien Light Mag Battery',
    displayName: 'Advanced Alien Light Mag Battery',
    templateFamily: 'magnetic_gun', category: 'Kinetic', role: 'Kinetic',
    salvo_shots: 4, isPointDefenseTargetable: true
  };
  const advanced = {
    dataName: 'AdvancedAlienLightMagBattery', friendlyName: 'Advanced Alien Light Mag Battery',
    displayName: 'Enhanced Alien Light Mag Battery',
    templateFamily: 'magnetic_gun', category: 'Kinetic', role: 'Kinetic',
    salvo_shots: 4, isPointDefenseTargetable: true
  };
  const index = buildWeaponIndex([gen3, advanced]);
  const entry = index.lookup.get(normalizeWeaponName('Advanced Alien Light Mag Battery'));
  assert.ok(entry, 'the loadout name must resolve');
  assert.strictEqual(entry.id, 'Gen3AlienLightMagBattery', 'the display name owns the key');
  assert.deepStrictEqual(index.ambiguousNormalizedNames, [], 'a shadowed secondary is not an ambiguity');
});

test('a genuine display-name collision is dropped and reported, never guessed', () => {
  const a = { ...LASER_CANNON, dataName: 'CannonA', friendlyName: 'Cannon A', displayName: 'Shared Name' };
  const b = { ...LASER_CANNON, dataName: 'CannonB', friendlyName: 'Cannon B', displayName: 'Shared Name' };
  const index = buildWeaponIndex([a, b]);
  assert.strictEqual(index.lookup.get(normalizeWeaponName('Shared Name')), undefined, 'ambiguous key must be dropped');
  assert.deepStrictEqual(index.ambiguousNormalizedNames, [normalizeWeaponName('Shared Name')]);
});

test('a record without templateFamily is counted, not silently misclassified', () => {
  const index = buildWeaponIndex([{ ...SIDEWINDER, templateFamily: undefined }]);
  assert.strictEqual(index.templateCount, 0);
  assert.strictEqual(index.unclassifiedTemplates, 1);
});

// ---------------------------------------------------------------------------
// composeBattleSide
// ---------------------------------------------------------------------------

test('point defence is a role, not a category — the brief\'s own example group', () => {
  const index = baseIndex();
  const side = composeBattleSide([{
    armorMedian: 10,
    weaponLoadout: [group('Point Defense', 'Laser', 2, [
      'Point Defense Laser Turret', 'Point Defense Laser Turret'
    ])]
  }], { weaponIndex: index });
  assert.strictEqual(side.pointDefenceMounts, 2, 'the PD group counts as the screen');
  assert.strictEqual(side.pdImmuneWeapons, 0, 'a PD-role laser is never an immune weapon');
  assert.strictEqual(side.byCategory.Laser, 2, 'the PD screen still shows on the category axis');
});

test('exact composition math on a hand-built fleet', () => {
  const index = baseIndex();
  const side = composeBattleSide([
    {
      armorMedian: 8,
      weaponLoadout: [
        group('Missile', 'Missile', 2, ['Sidewinder Shaped Nuclear Missile Bay']), // 2 x salvo 4
        group('Kinetic', 'Kinetic', 1, ['Coilgun Battery Mk2']),                   // 1 targetable mount
        group('Laser', 'Laser', 1, ['256 cm Violet Laser Cannon'])                 // 1 immune beam
      ]
    },
    {
      armorMedian: 12,
      weaponLoadout: [
        group('Point Defense', 'Laser', 1, ['Point Defense Laser Turret']),
        group('Kinetic', 'Kinetic', 2, ['40mm Autocannon'])                        // NOT targetable
      ]
    }
  ], { weaponIndex: index });

  assert.strictEqual(side.ships, 2);
  assert.strictEqual(side.pointDefenceMounts, 1);
  assert.strictEqual(side.missileShots, 8, '2 mounts x salvo 4');
  assert.strictEqual(side.kineticMounts, 3, 'coilgun + 2 autocannons');
  assert.strictEqual(side.pdTargetableShots, 9, '8 missile + 1 targetable kinetic; autocannons excluded');
  assert.strictEqual(side.notPdTargetableMounts, 2, 'the autocannons are reported, never vanished');
  assert.strictEqual(side.pdImmuneWeapons, 1);
  assert.deepStrictEqual(side.byCategory, { Missile: 2, Kinetic: 3, Laser: 2 });
  assert.strictEqual(side.armorMedian, 10, 'median of 8 and 12');
  assert.strictEqual(side.join.resolved, 5);
  assert.strictEqual(side.join.unresolved, 0);
  assert.strictEqual(side.join.rate, 1);
  assert.strictEqual(side.complete, true);
  assert.strictEqual(side.salvoShotsAssumedMounts, 0);
  assert.strictEqual(side.proportionalAttribution, false);
  assert.strictEqual(side.tableFallbackUsed, false);
});

test('the torpedo-absent-salvo path: absent means one shot, reported on the output', () => {
  const index = baseIndex();
  const side = composeBattleSide([{
    armorMedian: null,
    weaponLoadout: [group('Missile', 'Missile', 3, ['Acheron Nuclear Torpedo Bay'])]
  }], { weaponIndex: index });
  // THE PIN for the break-line test: if `salvo_shots ?? SALVO_SHOTS_WHEN_ABSENT`
  // is ever changed to treat the absent field as 0 or as unresolved, this test
  // goes red and the whole fleet under-counts by exactly this many shots.
  assert.strictEqual(side.missileShots, 3 * SALVO_SHOTS_WHEN_ABSENT);
  assert.strictEqual(side.pdTargetableShots, 3 * SALVO_SHOTS_WHEN_ABSENT);
  assert.strictEqual(side.salvoShotsAssumedMounts, 3, 'the assumed-salvo interpretation must be visible');
  assert.strictEqual(side.complete, true, 'absent salvo is a default, never an unresolved join');
});

test('an unresolved system is reported and the side is incomplete, never averaged', () => {
  const index = baseIndex();
  const side = composeBattleSide([{
    weaponLoadout: [
      group('Missile', 'Missile', 1, ['Sidewinder Nuclear Missile Bay']),
      group('Missile', 'Missile', 1, ['Mystery Weapon Bay'])
    ]
  }], { weaponIndex: index });
  assert.strictEqual(side.join.resolved, 1);
  assert.strictEqual(side.join.unresolved, 1);
  assert.strictEqual(side.join.rate, 0.5);
  assert.deepStrictEqual(side.join.unresolvedSystems, ['Mystery Weapon Bay']);
  assert.strictEqual(side.complete, false);
  assert.strictEqual(side.tableFallbackUsed, true, 'the category table classifies the unresolved mount');
  // The table says Missile is interceptable: one shot, salvo unknown.
  assert.strictEqual(side.pdTargetableShots, 5, '4 resolved + 1 table-fallback shot');
});

test('an unresolved beam-category mount is counted immune by the table fallback', () => {
  const index = baseIndex();
  const side = composeBattleSide([{
    weaponLoadout: [group('Laser', 'Laser', 2, ['Mystery Beam'])]
  }], { weaponIndex: index });
  assert.strictEqual(side.join.unresolved, 1);
  assert.strictEqual(side.pdImmuneWeapons, 2);
  assert.strictEqual(side.complete, false);
});

test('an unresolved mount of an unknown category stays unresolved and invisible to the buckets', () => {
  const index = baseIndex();
  const side = composeBattleSide([{
    weaponLoadout: [group('Weird', 'Weird', 1, ['Mystery Thing'])]
  }], { weaponIndex: index });
  assert.strictEqual(side.join.unresolved, 1);
  assert.strictEqual(side.pdTargetableShots, 0);
  assert.strictEqual(side.pdImmuneWeapons, 0);
  assert.strictEqual(side.kineticMounts, 0);
  assert.strictEqual(side.complete, false);
});

test('a multi-system group splits count proportionally and says so', () => {
  const index = baseIndex();
  const side = composeBattleSide([{
    weaponLoadout: [group('Kinetic', 'Kinetic', 2, ['Coilgun Battery Mk2', '40mm Autocannon'])]
  }], { weaponIndex: index });
  assert.strictEqual(side.proportionalAttribution, true, 'the loadout does not state the split');
  assert.strictEqual(side.kineticMounts, 2);
  assert.strictEqual(side.pdTargetableShots, 1, 'one attributed coilgun mount');
  assert.strictEqual(side.notPdTargetableMounts, 1, 'one attributed autocannon mount');
});

test('armorMedian is null when no ship carries one, and the median when some do', () => {
  const index = baseIndex();
  const ships = [
    { weaponLoadout: [] },
    { armorMedian: 4, weaponLoadout: [] },
    { armorMedian: 10, weaponLoadout: [] },
    { armorMedian: 16, weaponLoadout: [] }
  ];
  assert.strictEqual(composeBattleSide(ships, { weaponIndex: index }).armorMedian, 10);
  assert.strictEqual(composeBattleSide([{ weaponLoadout: [] }], { weaponIndex: index }).armorMedian, null);
  // Even count: midpoint average.
  const even = composeBattleSide([
    { armorMedian: 4, weaponLoadout: [] },
    { armorMedian: 10, weaponLoadout: [] }
  ], { weaponIndex: index });
  assert.strictEqual(even.armorMedian, 7);
});

test('a side with no weapon systems is complete with a null join rate', () => {
  const index = baseIndex();
  const side = composeBattleSide([{ weaponLoadout: [] }, { weaponLoadout: [] }], { weaponIndex: index });
  assert.strictEqual(side.ships, 2);
  assert.strictEqual(side.join.resolved, 0);
  assert.strictEqual(side.join.unresolved, 0);
  assert.strictEqual(side.join.rate, null);
  assert.strictEqual(side.complete, true);
});

// ---------------------------------------------------------------------------
// saturationVerdict
// ---------------------------------------------------------------------------

const side = (overrides = {}) => ({
  pointDefenceMounts: 4,
  pdTargetableShots: 10,
  pdImmuneWeapons: 0,
  salvoShotsAssumedMounts: 0,
  join: { resolved: 1, unresolved: 0 },
  ...overrides
});

test('saturated at the user\'s 2x rule: 10 shots vs 4 mounts x 2 = 8', () => {
  const verdict = saturationVerdict({ attacker: side(), defender: side() });
  assert.strictEqual(verdict.refused, false);
  assert.strictEqual(verdict.interceptionCapacity, 8);
  assert.strictEqual(verdict.difference, 2);
  assert.strictEqual(verdict.ratio, 1.25);
  assert.strictEqual(verdict.saturated, true);
});

test('shortfall is signed negative and never dressed up', () => {
  const verdict = saturationVerdict({
    attacker: side({ pdTargetableShots: 5 }),
    defender: side()
  });
  assert.strictEqual(verdict.difference, -3);
  assert.strictEqual(verdict.ratio, 0.625);
  assert.strictEqual(verdict.saturated, false);
});

test('a defender with no point-defence mounts has no ratio, and every shot arrives', () => {
  const verdict = saturationVerdict({
    attacker: side({ pdTargetableShots: 6 }),
    defender: side({ pointDefenceMounts: 0 })
  });
  assert.strictEqual(verdict.interceptionCapacity, 0);
  assert.strictEqual(verdict.ratio, null);
  assert.ok(verdict.ratioUnavailableReason, 'the reason must be stated, not silent');
  assert.strictEqual(verdict.saturated, true);
});

test('a custom pdShotsPerMount is honoured', () => {
  const verdict = saturationVerdict({
    attacker: side({ pdTargetableShots: 10 }),
    defender: side(),
    pdShotsPerMount: 3
  });
  assert.strictEqual(verdict.interceptionCapacity, 12);
  assert.strictEqual(verdict.saturated, false);
  assert.strictEqual(verdict.pdShotsPerMount, 3);
});

test('an incomplete attacker side refuses the verdict', () => {
  const verdict = saturationVerdict({
    attacker: side({ join: { resolved: 1, unresolved: 1 } }),
    defender: side()
  });
  assert.strictEqual(verdict.refused, true);
  assert.match(verdict.refusalReasons[0], /attacker weapon join incomplete/i);
  assert.strictEqual(verdict.attackerPdTargetableShots, null);
  assert.strictEqual(verdict.interceptionCapacity, null);
  assert.strictEqual(verdict.ratio, null);
  assert.strictEqual(verdict.saturated, null);
});

test('an incomplete defender side refuses the verdict too', () => {
  const verdict = saturationVerdict({
    attacker: side(),
    defender: side({ join: { resolved: 1, unresolved: 2 } })
  });
  assert.strictEqual(verdict.refused, true);
  assert.match(verdict.refusalReasons[0], /defender weapon join incomplete/i);
});

test('a nonsense pdShotsPerMount refuses the verdict', () => {
  const verdict = saturationVerdict({ attacker: side(), defender: side(), pdShotsPerMount: 'two' });
  assert.strictEqual(verdict.refused, true);
  assert.match(verdict.refusalReasons[0], /pdShotsPerMount must be a finite number > 0/i);
});

test('PD-immune weapons are reported beside the verdict, never folded into it', () => {
  const attacker = side({ pdTargetableShots: 4, pdImmuneWeapons: 100 });
  const verdict = saturationVerdict({ attacker, defender: side() });
  // The 100 immune weapons change NOTHING in the saturation arithmetic.
  assert.strictEqual(verdict.interceptionCapacity, 8);
  assert.strictEqual(verdict.difference, -4);
  assert.strictEqual(verdict.saturated, false);
  assert.strictEqual(verdict.attackerPdImmuneWeapons, 100);
  assert.strictEqual(verdict.pdImmuneExcludedFromSaturation, true);
});

test('the verdict carries the heuristic attribution and the interception assumption', () => {
  const verdict = saturationVerdict({ attacker: side(), defender: side() });
  assert.strictEqual(verdict.heuristic.stated, '2026-08-27');
  assert.strictEqual(verdict.heuristic.measured, false);
  assert.strictEqual(verdict.assumption.verified, false);
  assert.match(verdict.assumption.consequence, /understated/i);
});

test('the absent-salvo interpretation travels with the verdict', () => {
  const verdict = saturationVerdict({
    attacker: side({ salvoShotsAssumedMounts: 175 }),
    defender: side()
  });
  assert.strictEqual(verdict.attackerSalvoShotsAssumedMounts, 175);
});
