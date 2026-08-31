// Purpose: ship designer panel utils — selection query, reactor filter and affordability.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  affordabilityFor,
  clampThrusters,
  driveVariantId,
  filterReactors,
  filterWeaponsForPicker,
  hardpointUsageLabel,
  massEntryLabel,
  mergeWeaponSelection,
  reactorFilterCaption,
  rangeLabel,
  selectionQuery,
  stockpileFromResourcesPayload,
  weaponsQueryEntries,
} = require('../src/v2/panels/shipDesignerUtils.mjs');
const { ABSENT_LABEL } = require('../src/v2/components/valueResolution.mjs');

test('selectionQuery maps a base drive and thruster count to a variant id', () => {
  const catalogue = {
    families: {
      drives: {
        items: [{
          id: 'VASIMR',
          variants: [
            { id: 'VASIMRx1', thrusters: 1 },
            { id: 'VASIMRx4', thrusters: 4 },
          ],
        }],
      },
    },
  };
  const query = selectionQuery({
    hull: 'Escort',
    drive: 'VASIMR',
    thrusters: 4,
    reactor: 'SolidCoreFissionReactorVII',
    radiator: 'TitaniumArray',
    armour: 'CompositeArmor',
    nose: 4,
    lateral: 0,
    tail: 1,
    tanks: 3,
  }, catalogue);

  assert.equal(query.drive, 'VASIMRx4');
  assert.equal(query.thrusters, 4);
  assert.equal(query.hull, 'Escort');
  assert.equal(query.nose, 4);
  assert.equal(query.lateral, 0);
});

test('filterReactors narrows to compatible ids for a selected drive', () => {
  const reactors = [
    { id: 'A', displayName: 'A' },
    { id: 'B', displayName: 'B' },
    { id: 'C', displayName: 'C' },
  ];
  const drive = { compatibleReactorIds: ['A', 'C'] };
  const filtered = filterReactors(reactors, drive);
  assert.deepEqual(filtered.map((row) => row.id), ['A', 'C']);
});

test('affordabilityFor reports the limiting material against stockpile', () => {
  const cost = {
    water: 10,
    volatiles: 5,
    metals: 100,
    nobleMetals: 1,
    fissiles: 0,
    exotics: 0,
    antimatter: 0,
  };
  const stockpile = {
    water: 25,
    volatiles: 100,
    metals: 250,
    nobleMetals: 3,
    fissiles: 10,
    exotics: 0,
    antimatter: 0,
  };
  const result = affordabilityFor(cost, stockpile);
  assert.equal(result.affordableCount, 2);
  assert.equal(result.limitingMaterial, 'water');
  assert.equal(result.shortfalls.water, 0);
});

test('stockpileFromResourcesPayload maps save keys to designer material keys', () => {
  const { stockpile, reason } = stockpileFromResourcesPayload({
    items: [{
      resources: {
        Water: 100,
        Volatiles: 50,
        Metals: 1000,
        NobleMetals: 12,
        Fissiles: 3,
        Exotics: 0,
        Antimatter: 0,
      },
    }],
  });
  assert.equal(reason, null);
  assert.equal(stockpile.water, 100);
  assert.equal(stockpile.nobleMetals, 12);
});

test('clampThrusters respects the drive ladder bounds', () => {
  const drive = { thrusterRange: { min: 1, max: 4 } };
  assert.equal(clampThrusters(6, drive), 4);
  assert.equal(clampThrusters(0, drive), 1);
  assert.equal(driveVariantId(drive, 2), drive.id);
});

test('reactorFilterCaption names the drive class and narrowed count', () => {
  const reactors = [
    { id: 'A', stats: { powerPlantClass: 'Solid_Core_Fission' } },
    { id: 'B', stats: { powerPlantClass: 'Gas_Core_Fission' } },
    { id: 'C', stats: { powerPlantClass: 'Solid_Core_Fission' } },
  ];
  const drive = {
    displayName: 'Nerva Drive',
    requiredPowerPlantClass: 'Solid_Core_Fission',
    compatibleReactorIds: ['A', 'C'],
  };
  const filtered = filterReactors(reactors, drive);
  assert.equal(
    reactorFilterCaption(reactors, filtered, drive),
    '2 of 3 reactors accept Nerva Drive (Solid_Core_Fission)',
  );
});

test('selectionQuery repeats weapons as id:count query entries', () => {
  const query = selectionQuery({
    hull: 'Escort',
    drive: 'VASIMR',
    thrusters: 1,
    weapons: [{ id: 'PointDefenseLaserTurret', count: 2 }, { id: 'RailCannon', count: 1 }],
  }, {
    families: {
      drives: {
        items: [{ id: 'VASIMR', variants: [{ id: 'VASIMRx1', thrusters: 1 }] }],
      },
    },
  });
  assert.deepEqual(query.weapons, ['PointDefenseLaserTurret:2', 'RailCannon']);
});

test('filterWeaponsForPicker excludes installation mounts and can filter by side', () => {
  const weapons = [
    { id: 'pd', mount: 'OneHull' },
    { id: 'nose', mount: 'OneNose' },
    { id: 'base', mount: 'T1BaseDefense' },
  ];
  const shipMounts = filterWeaponsForPicker(weapons);
  assert.deepEqual(shipMounts.map((row) => row.id), ['pd', 'nose']);
  assert.deepEqual(filterWeaponsForPicker(weapons, { mountSide: 'hull' }).map((row) => row.id), ['pd']);
});

test('hardpointUsageLabel reads weaponCapacity required and hull limits', () => {
  assert.equal(
    hardpointUsageLabel({
      limits: { nose: 4, hull: 2, internal: 8 },
      required: { nose: 0, hull: 2 },
    }, null),
    'nose 0 / 4 · hull 2 / 2 · internal 0 / 8',
  );
  assert.equal(
    hardpointUsageLabel(null, { stats: { noseHardpoints: 4, hullHardpoints: 2, internalModules: 8 } }),
    'nose 0 / 4 · hull 0 / 2 · internal 0 / 8',
  );
});

test('mergeWeaponSelection accumulates counts for duplicate ids', () => {
  const first = mergeWeaponSelection([], 'PointDefenseLaserTurret', 1);
  const second = mergeWeaponSelection(first, 'PointDefenseLaserTurret', 1);
  assert.deepEqual(second, [{ id: 'PointDefenseLaserTurret', count: 2 }]);
  assert.deepEqual(weaponsQueryEntries(second), ['PointDefenseLaserTurret:2']);
});

test('designer absence affordances use the shared resolver without changing text', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../src/v2/panels/shipDesignerUtils.mjs'),
    'utf8',
  );
  assert.match(source, /import \{ ABSENT_LABEL, resolveValue \} from ['"]\.\.\/components\/valueResolution\.mjs['"]/);
  assert.doesNotMatch(source, /return '—';/, 'designer affordances must not own a bare dash');

  const calls = [];
  const formatter = (value, decimals) => {
    calls.push({ value, decimals });
    return Number(value).toFixed(decimals);
  };
  assert.equal(
    rangeLabel({ Open: null, Closed: 2.5 }, formatter),
    `Open ${ABSENT_LABEL} · Closed 2.50`,
  );
  assert.equal(
    rangeLabel({ Open: 1.25, Closed: null }, formatter),
    `Open 1.25 · Closed ${ABSENT_LABEL}`,
  );
  assert.deepEqual(calls, [
    { value: 2.5, decimals: 2 },
    { value: 1.25, decimals: 2 },
  ], 'the resolver must keep missing bounds out of the formatter');
  assert.equal(massEntryLabel(null), ABSENT_LABEL);
  assert.equal(massEntryLabel({}), ABSENT_LABEL);
});
