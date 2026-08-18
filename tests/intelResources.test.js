const { test } = require('node:test');
const assert = require('node:assert');

const snapshotBuilder = require('../server/snapshotBuilder');
const snapshotIdentity = require('../server/snapshotIdentity');
const intelligenceFilter = require('../server/intelligenceFilter');
const localResources = require('../server/intelResources');
const { makeSaveData } = require('./fixtures/syntheticSave');

const OBSERVER = 4712;

function omniscientSnapshot(options) {
  const raw = snapshotBuilder.buildRawSnapshot(makeSaveData(options));
  const identity = snapshotIdentity.createSnapshotIdentity(
    { fullPath: 'synthetic.gz', lastModified: new Date('2025-01-01T00:00:00Z'), saveHash: 'fixture' },
    'initiative'
  );
  snapshotIdentity.attachSnapshotIdentity(raw, identity);
  return intelligenceFilter.applyFilter(raw, 'omniscient', OBSERVER);
}

test('buildResource returns focused faction rows', () => {
  const snapshot = omniscientSnapshot();
  const all = localResources.buildResource(snapshot, 'factions', { mode: 'omniscient' });
  assert.strictEqual(all.success, true);
  assert.strictEqual(all.source, 'local');
  assert.strictEqual(all.count, 3);
  assert.strictEqual(all.items.length, 3);

  const own = localResources.buildResource(snapshot, 'factions', { factionId: OBSERVER, mode: 'omniscient' });
  assert.strictEqual(own.count, 1);
  assert.strictEqual(own.items[0].name, 'the Initiative');
  assert.strictEqual(own.items[0].controlPoints, 2);
});

test('buildResource projects nations and councilors', () => {
  const snapshot = omniscientSnapshot();
  const nations = localResources.buildResource(snapshot, 'nations', { mode: 'omniscient' });
  assert.strictEqual(nations.count, 2);
  const usa = nations.items.find(n => n.id === 1);
  assert.strictEqual(usa.gdp, 20e12);
  assert.strictEqual(usa.executiveFactionId, OBSERVER);

  const councilors = localResources.buildResource(snapshot, 'councilors', { factionId: OBSERVER, mode: 'omniscient' });
  assert.strictEqual(councilors.count, 1);
  assert.strictEqual(councilors.items[0].attributes.Persuasion, 10);
});

test('buildResource reports ships through fleet projection', () => {
  const snapshot = omniscientSnapshot({ ships: 2 });
  const ships = localResources.buildResource(snapshot, 'ships', { mode: 'omniscient' });
  assert.strictEqual(ships.count, 2);
  assert.strictEqual(ships.items[0].fleetName, 'Belt Patrol');
  assert.ok(ships.items[0].spaceTheaterKey, 'shared ship rows include theater fields');
});

test('buildResource summary aggregates alien posture', () => {
  const snapshot = omniscientSnapshot();
  const summary = localResources.buildResource(snapshot, 'summary', { mode: 'omniscient' });
  assert.strictEqual(summary.factions.length, 3);
  assert.strictEqual(summary.alien.factionId, 4717);
  assert.strictEqual(summary.alien.fleets, 0);
  assert.ok(summary.alien.fleetsByBody, 'empty fleet aggregation is present');
});

test('unknown resources are rejected', () => {
  const snapshot = omniscientSnapshot();
  assert.strictEqual(localResources.buildResource(snapshot, 'unknown', {}), null);
});

test('local wrapper and shared ESM module produce identical rows', async () => {
  const shared = await import('../shared/intelResources.mjs');
  const snapshot = omniscientSnapshot({ ships: 2 });
  const localFleetRow = localResources.buildResource(snapshot, 'fleets', { mode: 'omniscient' }).items[0];
  const sharedFleetRow = shared.fleetResourceRow(snapshot.fleets[0]);
  assert.deepStrictEqual(localFleetRow, sharedFleetRow);

  const localShipRows = localResources.buildResource(snapshot, 'ships', { mode: 'omniscient' }).items;
  const sharedShipRows = shared.shipResourceRows(snapshot.fleets, null, null);
  assert.deepStrictEqual(localShipRows, sharedShipRows);
});