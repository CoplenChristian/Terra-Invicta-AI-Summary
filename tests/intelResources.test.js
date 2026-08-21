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
  assert.ok(summary.alienHateEconomics, 'summary includes alien hate economics');
  assert.strictEqual(summary.alienHateEconomics.usedMissionControl, 10);
});

test('unknown resources are rejected', () => {
  const snapshot = omniscientSnapshot();
  assert.strictEqual(localResources.buildResource(snapshot, 'unknown', {}), null);
});

test('API discovery index lists focused routes', () => {
  assert.strictEqual(localResources.INTEL_ENDPOINT_INDEX.logistics, '/api/intel/logistics');
  assert.strictEqual(localResources.INTEL_ENDPOINT_INDEX.techTree, '/api/intel/tech-tree');
  assert.ok(Object.keys(localResources.INTEL_ENDPOINT_INDEX).length >= 30);
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

// --- Mining prospects --------------------------------------------------------
// Ranks UNOWNED sites as expansion targets. Two percentiles per resource,
// because "best of its type" and "good in absolute terms" are different
// questions -- conflating them is what led to treating generic Common
// Carbonaceous sites as notable producers.
const { miningProspectsResource } = require('../shared/intelResources.mjs');

function siteFixture() {
  return {
    habSites: [
      // Genuinely rich metallic site, unowned.
      { ID: 1, displayName: 'Hertha', parentBodyName: 'Hertha', spaceTheaterKey: 'belt',
        miningProfileName: 'MetallicMine', factionId: null, factionName: 'Unclaimed',
        water: 0, volatiles: 0, metals: 5.0, nobleMetals: 2.5, fissiles: 0 },
      // Generic carbonaceous, unowned -- shares its profile with many peers.
      { ID: 2, displayName: 'Fortuna', parentBodyName: 'Fortuna', spaceTheaterKey: 'belt',
        miningProfileName: 'CarbonaceousMine', factionId: null, factionName: 'Unclaimed',
        water: 3.5, volatiles: 5.0, metals: 0, nobleMetals: 0, fissiles: 0 },
      { ID: 3, displayName: 'Zelinda', parentBodyName: 'Zelinda', spaceTheaterKey: 'belt',
        miningProfileName: 'CarbonaceousMine', factionId: null, factionName: 'Unclaimed',
        water: 3.5, volatiles: 5.0, metals: 0, nobleMetals: 0, fissiles: 0 },
      // Already ours -- must never be offered as an expansion target.
      { ID: 4, displayName: 'Aspasia', parentBodyName: 'Aspasia', spaceTheaterKey: 'belt',
        miningProfileName: 'MixedCMMine', factionId: 4712, factionName: 'the Initiative',
        water: 2, volatiles: 3, metals: 3, nobleMetals: 1, fissiles: 0 },
      // Different theater.
      { ID: 5, displayName: 'Tolkien Crater', parentBodyName: 'Mercury', spaceTheaterKey: 'inner',
        miningProfileName: 'MercuryPolarMine', factionId: null, factionName: 'Unclaimed',
        water: 1, volatiles: 0, metals: 2, nobleMetals: 0.9, fissiles: 0 }
    ]
  };
}

test('mining prospects exclude owned sites', () => {
  const result = miningProspectsResource(siteFixture());
  const names = result.ranked.map(r => r.name);
  assert.ok(!names.includes('Aspasia'), 'an owned site is not an expansion target');
  assert.strictEqual(result.unownedSites, 4);
  assert.strictEqual(result.totalSites, 5);
});

test('scarcity weighting ranks nobles above raw bulk', () => {
  const [top] = miningProspectsResource(siteFixture()).ranked;
  // Hertha: 5 metals x1 + 2.5 nobles x3 = 12.5
  // Fortuna: 3.5 water x1 + 5 volatiles x1.5 = 11.0
  assert.strictEqual(top.name, 'Hertha');
  assert.strictEqual(top.scarcityScore, 12.5);
});

test('identical generic sites land mid-band in their profile, not top', () => {
  const result = miningProspectsResource(siteFixture());
  const fortuna = result.ranked.find(r => r.name === 'Fortuna');
  assert.strictEqual(fortuna.profilePeerCount, 2, 'Fortuna and Zelinda share a profile');
  // Tied with its only peer, so a midpoint rank puts it at 50, not 100.
  assert.strictEqual(fortuna.resources.water.profilePercentile, 50);

  // Water across all five fixtures: 0, 3.5, 3.5, 2, 1 -> midpoint rank for 3.5
  // is (3 below + 2 equal / 2) / 5 = 80.
  assert.strictEqual(fortuna.resources.water.globalPercentile, 80);
});

test('theater filter keeps unreachable prospects out', () => {
  const belt = miningProspectsResource(siteFixture(), { theater: 'belt' });
  assert.strictEqual(belt.unownedSites, 3);
  assert.ok(belt.ranked.every(r => r.name !== 'Tolkien Crater'));

  const inner = miningProspectsResource(siteFixture(), { theater: 'inner' });
  assert.strictEqual(inner.unownedSites, 1);
  assert.strictEqual(inner.ranked[0].name, 'Tolkien Crater');
});

test('local mining-prospects uses canonical theater and limit parameters', () => {
  const result = localResources.buildResource(siteFixture(), 'mining-prospects', {
    theater: 'belt',
    limit: 1,
    mode: 'omniscient'
  });
  assert.equal(result.query.theater, 'belt');
  assert.equal(result.query.limit, 1);
  assert.equal(result.count, 1);
  assert.equal(result.items[0].name, 'Hertha');
});

test('shared dispatcher and local adapter agree on mining projections', async () => {
  const shared = await import('../shared/intelResources.mjs');
  const snapshot = siteFixture();
  const local = localResources.buildResource(snapshot, 'mining-prospects', { theater: 'belt', limit: 2 }).items;
  const pure = shared.buildResourceProjection(snapshot, 'mining-prospects', { theater: 'belt', limit: 2 }).items;
  assert.deepStrictEqual(local, pure);
});
