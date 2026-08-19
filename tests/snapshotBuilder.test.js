const { test } = require('node:test');
const assert = require('node:assert');

const snapshotBuilder = require('../server/snapshotBuilder');
const saveParser = require('../server/saveParser');
const { makeSaveData } = require('./fixtures/syntheticSave');

test('buildRawSnapshot builds factions with derived power metrics', () => {
  const raw = snapshotBuilder.buildRawSnapshot(makeSaveData({ money: 100 }));
  assert.strictEqual(raw.factions.length, 3);

  const initiative = raw.factions.find(f => f.ID === 4712);
  assert.ok(initiative, 'Initiative faction present');
  assert.strictEqual(initiative.resources.Money, 100);
  assert.strictEqual(initiative.assessedAlienHateOfMe, 5);
  assert.strictEqual(initiative.controlPointsCount, 2);
  assert.strictEqual(initiative.nationsCount, 1);
  assert.strictEqual(initiative.totalGdp, 20e12);
  assert.strictEqual(initiative.shipsCount, 1);
  assert.strictEqual(initiative.missionControlUsage, 10);
  assert.strictEqual(initiative.missionControlCapacity, 8);
  assert.ok(Number.isFinite(initiative.powerScore.overall), 'composite power computed from visible fleet power');
  assert.ok(initiative.powerScore.fleet > 0, 'fleet power component derived from combat power');

  const servants = raw.factions.find(f => f.ID === 4713);
  assert.strictEqual(servants.nationsCount, 1);
});

test('buildRawSnapshot captures nations, councilors and control points', () => {
  const raw = snapshotBuilder.buildRawSnapshot(makeSaveData());
  assert.strictEqual(raw.nations.length, 2);

  const usa = raw.nations.find(n => n.ID === 1);
  assert.strictEqual(usa.executiveFactionId, 4712);
  assert.strictEqual(usa.GDP, 20e12);
  assert.strictEqual(usa.missionControl, 8);
  assert.strictEqual(usa.controlPoints.length, 2);
  assert.strictEqual(usa.regionsCount, 2);

  const china = raw.nations.find(n => n.ID === 2);
  assert.strictEqual(china.executiveFactionId, 4713);

  assert.strictEqual(raw.councilors.length, 3);
  const own = raw.councilors.find(c => c.ID === 100);
  assert.strictEqual(own.factionName, 'the Initiative');
  assert.strictEqual(own.totalSkills, 70);
  assert.strictEqual(own.attributes.Persuasion, 10);
});

test('buildRawSnapshot resolves space assets and theater classification', () => {
  const raw = snapshotBuilder.buildRawSnapshot(makeSaveData({ ships: 2 }));
  assert.strictEqual(raw.fleets.length, 1);
  const fleet = raw.fleets[0];
  assert.strictEqual(fleet.shipsCount, 2);
  assert.strictEqual(fleet.orbitBody, 'Ceres');
  assert.strictEqual(fleet.spaceTheaterKey, 'belt');
  assert.strictEqual(fleet.combatPower, 100, '2 ships x 50 combat power');

  assert.strictEqual(raw.habs.length, 1);
  assert.strictEqual(raw.habs[0].orbitBody, 'Ceres');
  assert.strictEqual(raw.habs[0].inEarthLEO, true);

  assert.strictEqual(raw.habSites.length, 1);
  const site = raw.habSites[0];
  assert.strictEqual(site.parentBodyName, 'Ceres');
  assert.strictEqual(site.water, 10);
  assert.strictEqual(site.factionName, 'the Initiative');
});

test('buildRawSnapshot builds faction relationships from factionHate maps', () => {
  const raw = snapshotBuilder.buildRawSnapshot(makeSaveData());
  assert.strictEqual(raw.factionRelationships.length, 2);
  const relation = raw.factionRelationships.find(r => r.sourceFactionId === 4713);
  assert.ok(relation);
  assert.strictEqual(relation.targetFactionId, 4712);
  assert.strictEqual(relation.hate, 90);
});

test('buildRawSnapshot handles empty game state collections', () => {
  const empty = snapshotBuilder.buildRawSnapshot({ gamestates: {} });
  assert.strictEqual(empty.factions.length, 0);
  assert.strictEqual(empty.councilors.length, 0);
  assert.strictEqual(empty.fleets.length, 0);
  assert.ok(empty.techMatrix.length > 0, 'tech matrix still present from template keys');
});

test('saveParser getStateCollection unwraps Value-wrapped entries', () => {
  const save = makeSaveData();
  const states = save.gamestates;
  const factionState = saveParser.getStateCollection(states, 'PavonisInteractive.TerraInvicta.TIFactionState');
  assert.strictEqual(factionState.length, 3);
  assert.ok(factionState[0].ID.value, 'entries are unwrapped');
});
