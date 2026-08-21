const test = require('node:test');
const assert = require('node:assert');
const { loadSnapshot, loadFilteredSnapshot, queryIntel, resolveObserverId, clearCache } = require('../server/snapshotLoader');
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

test('snapshotLoader loads snapshot and filters correctly across modes', (t) => {
  clearCache();
  try {
    const raw = loadSnapshot();
    if (!raw) {
      t.skip('Skipping live save test: No raw snapshot available');
      return;
    }
    assert(raw.factions && raw.factions.length > 0, 'Snapshot should contain factions');
    assert(raw.snapshotId, 'Snapshot should have an attached snapshot identity');

    // Test player mode
    const playerSnapshot = loadFilteredSnapshot({ mode: 'player', observer: 4712 });
    assert.strictEqual(playerSnapshot.observerFactionId, 4712);
    assert.strictEqual(playerSnapshot.mode, 'player');

    // Test omniscient mode
    const omniSnapshot = loadFilteredSnapshot({ mode: 'omniscient', observer: 4712 });
    assert.strictEqual(omniSnapshot.mode, 'omniscient');

    // Test queryIntel on summary and mining
    const summary = queryIntel({ snapshot: playerSnapshot, endpoint: 'summary', mode: 'player' });
    assert(summary && summary.success, 'Summary query should succeed');

    const mining = queryIntel({ snapshot: playerSnapshot, endpoint: 'mining', mode: 'player' });
    assert(mining && mining.success, 'Mining query should succeed');
  } catch (err) {
    if (
      err.code === 'EBUSY' ||
      err.code === 'ENOENT' ||
      err.code === 'EPERM' ||
      err.message.includes('EBUSY') ||
      err.message.includes('locked') ||
      err.message.includes('busy') ||
      err.message.includes('No save path configured') ||
      err.message.includes('Save folder not found') ||
      err.message.includes('Save file not found') ||
      err.message.includes('No .gz or .json save files found') ||
      err.message.includes('No save files found')
    ) {
      t.skip('Skipping live save test: Live save unavailable or busy: ' + err.message);
    } else {
      throw err;
    }
  }
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
