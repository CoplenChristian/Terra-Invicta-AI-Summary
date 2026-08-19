const { test } = require('node:test');
const assert = require('node:assert');

const snapshotBuilder = require('../server/snapshotBuilder');
const intelligenceFilter = require('../server/intelligenceFilter');
const { makeSaveData } = require('./fixtures/syntheticSave');

const OBSERVER = 4712;

function rawFor(options) {
  return snapshotBuilder.buildRawSnapshot(makeSaveData(options));
}

test('player mode masks enemy councilor telemetry and hides aliens', () => {
  const filtered = intelligenceFilter.applyFilter(rawFor(), 'player', OBSERVER);

  assert.strictEqual(filtered.mode, 'player');
  assert.strictEqual(filtered.isOmniscient, false);

  const own = filtered.councilors.find(c => c.ID === 100);
  assert.ok(own, 'own councilor is visible');
  assert.strictEqual(own.visibility, 'confirmed');
  assert.ok(own.attributes, 'own attributes are exposed');
  assert.ok(own.maskedAttributes.Persuasion.actual !== undefined);

  const enemy = filtered.councilors.find(c => c.ID === 101);
  assert.ok(enemy, 'seen enemy councilor is listed');
  assert.strictEqual(enemy.attributes, undefined, 'enemy attributes stripped in player mode');
  assert.strictEqual(enemy.maskedAttributes.Persuasion.actual, undefined, 'enemy actual values masked');
  assert.strictEqual(enemy.maskedAttributes.Persuasion.visibility, 'estimated');

  const alien = filtered.councilors.find(c => c.ID === 102);
  assert.strictEqual(alien, undefined, 'aliens are not directly detectable without the research');
});

test('player snapshot passes the leak safety assertion', () => {
  const filtered = intelligenceFilter.applyFilter(rawFor(), 'player', OBSERVER);
  assert.strictEqual(intelligenceFilter.assertPlayerSnapshotSafe(filtered), true);
});

test('assertPlayerSnapshotSafe rejects injected leaks', () => {
  const filtered = intelligenceFilter.applyFilter(rawFor(), 'player', OBSERVER);
  const enemy = filtered.councilors.find(c => c.ID === 101);
  enemy.maskedAttributes.Persuasion.actual = 12;
  assert.throws(() => intelligenceFilter.assertPlayerSnapshotSafe(filtered), /hidden councilor telemetry/);
});

test('enhanced mode exposes raw telemetry with explicit labeling', () => {
  const filtered = intelligenceFilter.applyFilter(rawFor(), 'enhanced', OBSERVER);
  assert.strictEqual(filtered.mode, 'enhanced');

  const enemy = filtered.councilors.find(c => c.ID === 101);
  assert.ok(enemy, 'enemy councilor visible in enhanced mode');
  assert.strictEqual(enemy.attributes.Persuasion, 10, 'raw attributes exposed');
  assert.strictEqual(enemy.maskedAttributes.Persuasion.actual, 10, 'raw values labeled as enhanced telemetry');
  assert.strictEqual(enemy.maskedAttributes.Persuasion.visibility, 'raw_save_only');

  const alienHate = filtered.factions.find(f => f.ID === 4713).alienHate;
  assert.strictEqual(alienHate.actual, 90);
  assert.strictEqual(filtered.alienHateEconomics.actualAlienHate, 5);
});

test('omniscient mode returns the full raw picture', () => {
  const filtered = intelligenceFilter.applyFilter(rawFor(), 'omniscient', OBSERVER);
  assert.strictEqual(filtered.mode, 'omniscient');
  assert.strictEqual(filtered.isOmniscient, true);

  const alien = filtered.councilors.find(c => c.ID === 102);
  assert.ok(alien, 'alien councilor visible in omniscient mode');
  assert.strictEqual(alien.visibility, 'raw_save_only');

  const servantsHate = filtered.factions.find(f => f.ID === 4713).alienHate;
  assert.strictEqual(servantsHate.actual, 90);
  assert.strictEqual(servantsHate.visibility, 'raw_save_only');
  assert.strictEqual(filtered.alienHateEconomics.actualAlienHate, 5);
});

test('capabilities resolve from finished projects', () => {
  const filtered = intelligenceFilter.applyFilter(rawFor(), 'player', OBSERVER);
  assert.strictEqual(filtered.capabilities.canEstimateAlienThreat, true);
  assert.strictEqual(filtered.capabilities.canDirectlyDetectAlienCouncilors, false);
  assert.strictEqual(filtered.alienIntelligenceStage.operatives.status, 'LOCKED');
});

test('player faction rows hide assessed alien hate while enhanced exposes it', () => {
  const player = intelligenceFilter.applyFilter(rawFor(), 'player', OBSERVER);
  const playerServants = player.factions.find(f => f.ID === 4713);
  assert.strictEqual(playerServants.assessedAlienHateOfMe, undefined, 'raw hate stripped');
  assert.strictEqual(playerServants.alienHate.actual, null);
  assert.ok(playerServants.alienHate.visibleEstimate.length > 0, 'pips estimate present');
  assert.strictEqual(player.alienHateEconomics.actualAlienHate, null);
  assert.strictEqual(player.alienHateEconomics.visibleHateEstimate, '■□□□□');

  const enhanced = intelligenceFilter.applyFilter(rawFor(), 'enhanced', OBSERVER);
  const enhancedServants = enhanced.factions.find(f => f.ID === 4713);
  assert.strictEqual(enhancedServants.alienHate.actual, 90);
});

test('player mode keeps new logistics projections private to the observer faction', () => {
  const player = intelligenceFilter.applyFilter(rawFor(), 'player', OBSERVER);
  const enemy = player.factions.find(f => f.ID === 4713);
  const own = player.factions.find(f => f.ID === OBSERVER);

  assert.ok(own.resources, 'own resource balances remain available');
  assert.strictEqual(enemy.resources, null, 'enemy resource balances are not exposed');
  assert.strictEqual(enemy.financials, null, 'enemy financial telemetry is not exposed');
  assert.strictEqual(enemy.shipyardCount, null, 'enemy shipyard counts are not exposed');

  const enhanced = intelligenceFilter.applyFilter(rawFor(), 'enhanced', OBSERVER);
  assert.ok(enhanced.factions.find(f => f.ID === 4713).resources, 'enhanced mode exposes the explicit telemetry view');
});
