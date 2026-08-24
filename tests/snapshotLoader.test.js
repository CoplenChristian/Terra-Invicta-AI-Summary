const test = require('node:test');
const assert = require('node:assert');
const { resolveObserverId } = require('../server/snapshotLoader');
const { formatOutput, resolveNestedField } = require('../scripts/parse_save');

test('snapshotLoader resolves observer faction ID correctly', () => {
  const fakeSnapshot = {
    factions: [
      { ID: 4712, displayName: 'the Initiative', templateName: 'Faction_Initiative' },
      { ID: 4710, displayName: 'the Resistance', templateName: 'Faction_Resistance' }
    ]
  };

  assert.strictEqual(resolveObserverId(fakeSnapshot, 4712), 4712);
  assert.strictEqual(resolveObserverId(fakeSnapshot, '4712'), 4712);
  assert.strictEqual(resolveObserverId(fakeSnapshot, 'the Initiative'), 4712);
  assert.strictEqual(resolveObserverId(fakeSnapshot, 'Resistance'), 4710);
  assert.strictEqual(resolveObserverId(fakeSnapshot, null), 4712);
});

test('parse_save field resolution and formatting helpers', () => {
  const sample = {
    metadata: { gameTimeString: '8/20/2032 12:00:00 PM' },
    capacity: { minesBuilt: 18, mineLimit: 36, headroom: 18 },
    items: [{ name: 'Ceres' }, { name: 'Vesta' }]
  };

  assert.strictEqual(resolveNestedField(sample, 'metadata.gameTimeString'), '8/20/2032 12:00:00 PM');
  assert.strictEqual(resolveNestedField(sample, 'capacity.headroom'), 18);
  assert.strictEqual(resolveNestedField(sample, 'items[0].name'), 'Ceres');
  assert.strictEqual(resolveNestedField(sample, 'nonexistent.field'), null);

  const jsonStr = formatOutput(sample, 'json');
  assert.strictEqual(JSON.parse(jsonStr).capacity.minesBuilt, 18);

  const summaryStr = formatOutput({
    campaignDate: '8/20/2032',
    observerFaction: { name: 'the Initiative', id: 4712 },
    resource: 'mining',
    items: [1, 2, 3]
  }, 'summary');
  assert(summaryStr.includes('the Initiative'));
  assert(summaryStr.includes('Resource:      mining'));
});
