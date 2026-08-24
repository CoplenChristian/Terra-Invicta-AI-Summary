// Live-save integration: snapshotLoader round-trip against the current campaign.
// Run via `npm run test:live` — not part of the unit suite.

const test = require('node:test');
const assert = require('node:assert');
const { loadSnapshot, loadFilteredSnapshot, queryIntel, clearCache } = require('../../server/snapshotLoader');

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

    const playerSnapshot = loadFilteredSnapshot({ mode: 'player', observer: 4712 });
    assert.strictEqual(playerSnapshot.observerFactionId, 4712);
    assert.strictEqual(playerSnapshot.mode, 'player');

    const omniSnapshot = loadFilteredSnapshot({ mode: 'omniscient', observer: 4712 });
    assert.strictEqual(omniSnapshot.mode, 'omniscient');

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
