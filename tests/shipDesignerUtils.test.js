// Purpose: ship designer panel utils — selection query, reactor filter and affordability.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  affordabilityFor,
  clampThrusters,
  driveVariantId,
  filterReactors,
  selectionQuery,
  stockpileFromResourcesPayload,
} = require('../src/v2/panels/shipDesignerUtils.mjs');

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
