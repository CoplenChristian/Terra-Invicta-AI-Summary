const { test } = require('node:test');
const assert = require('node:assert');

const snapshotBuilder = require('../server/snapshotBuilder');
const snapshotIdentity = require('../server/snapshotIdentity');
const intelligenceFilter = require('../server/intelligenceFilter');
const snapshotDelta = require('../server/snapshotDelta');
const { makeSaveData } = require('./fixtures/syntheticSave');

const OBSERVER = 4712;

function filteredSnapshot(options) {
  const saveFile = {
    fullPath: options.filePath,
    lastModified: new Date(options.modifiedAt),
    saveHash: options.saveHash || `fixture-${options.filePath}`
  };
  const raw = snapshotBuilder.buildRawSnapshot(makeSaveData(options));
  const identity = snapshotIdentity.createSnapshotIdentity(saveFile, 'initiative');
  snapshotIdentity.attachSnapshotIdentity(raw, identity);
  return intelligenceFilter.applyFilter(raw, 'player', OBSERVER);
}

test('delta reports available=false without a previous snapshot', () => {
  const current = filteredSnapshot({ filePath: 'b.gz', modifiedAt: '2025-01-03T00:00:00Z', gameTimeString: '2025-01-03T00:00:00Z' });
  const delta = snapshotDelta.build(null, current, OBSERVER);
  assert.strictEqual(delta.available, false);
  assert.ok(delta.message.length > 0);
});

test('delta reports resource, faction and game-time changes', () => {
  const previous = filteredSnapshot({ filePath: 'a.gz', modifiedAt: '2025-01-01T00:00:00Z', money: 100, ships: 1, gameTimeString: '2025-01-01T00:00:00Z' });
  const current = filteredSnapshot({ filePath: 'b.gz', modifiedAt: '2025-01-03T00:00:00Z', money: 150, ships: 2, gameTimeString: '2025-01-03T00:00:00Z' });

  const delta = snapshotDelta.build(previous, current, OBSERVER);
  assert.strictEqual(delta.available, true);
  assert.strictEqual(delta.elapsedGameDays, 2);

  const moneyChange = delta.resources.find(c => c.key === 'Money');
  assert.ok(moneyChange, 'Money delta present');
  assert.strictEqual(moneyChange.from, 100);
  assert.strictEqual(moneyChange.to, 150);
  assert.strictEqual(moneyChange.delta, 50);

  const initiativeFaction = delta.factions.find(f => f.factionId === OBSERVER);
  assert.ok(initiativeFaction, 'Initiative faction changes present');
  const shipsChange = initiativeFaction.changes.find(c => c.metric === 'Ships');
  assert.ok(shipsChange, 'ships delta present');
  assert.strictEqual(shipsChange.from, 1);
  assert.strictEqual(shipsChange.to, 2);
});

test('delta tracks executive control changes', () => {
  const previous = filteredSnapshot({ filePath: 'a.gz', modifiedAt: '2025-01-01T00:00:00Z', gameTimeString: '2025-01-01T00:00:00Z' });
  const current = filteredSnapshot({ filePath: 'b.gz', modifiedAt: '2025-01-02T00:00:00Z', gameTimeString: '2025-01-02T00:00:00Z' });

  // Swap China's executive CP from Servants to Initiative in the current save.
  const china = current.nations.find(n => n.ID === 2);
  china.executiveFactionId = OBSERVER;
  china.executiveFactionName = 'the Initiative';

  const delta = snapshotDelta.build(previous, current, OBSERVER);
  const political = delta.politics.find(p => p.nationId === 2);
  assert.ok(political, 'China executive change reported');
  assert.strictEqual(political.fromFactionId, 4713);
  assert.strictEqual(political.toFactionId, OBSERVER);
});