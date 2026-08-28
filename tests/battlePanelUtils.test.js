/**
 * tests/battlePanelUtils.test.js
 *
 * Purpose: cap enforcement and over-cap deployment copy for the battle planner.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const {
  BATTLE_SHIP_CAP_PER_SIDE,
  buildShipDesignLookup,
  resolveShipDesignSubtitle,
  toggleShipSelection,
  deploymentSummary,
  overCapNotice,
  selectionBlocked,
} = require('../src/v2/panels/battlePanelUtils.mjs');

test('BATTLE_SHIP_CAP_PER_SIDE is the player-stated 40-ship limit', () => {
  assert.strictEqual(BATTLE_SHIP_CAP_PER_SIDE, 40);
});

test('toggleShipSelection blocks a 41st ship', () => {
  const selected = Array.from({ length: 40 }, (_, i) => String(i));
  const next = toggleShipSelection(selected, '41', BATTLE_SHIP_CAP_PER_SIDE);
  assert.deepStrictEqual(next, selected);
  assert.strictEqual(selectionBlocked(next.length, BATTLE_SHIP_CAP_PER_SIDE), true);
});

test('buildShipDesignLookup joins dataName to display name and hull class', () => {
  const lookup = buildShipDesignLookup([
    {
      dataName: 'playerShipTemplate1121',
      _displayName: 'Outer Siege Coil',
      hullName: 'Lancer',
    },
  ]);
  assert.strictEqual(lookup.get('playerShipTemplate1121').displayName, 'Outer Siege Coil');
  assert.strictEqual(lookup.get('playerShipTemplate1121').hullClass, 'Lancer');
});

test('resolveShipDesignSubtitle returns design and hull for a joined player ship', () => {
  const lookup = buildShipDesignLookup([
    {
      dataName: 'playerShipTemplate1121',
      _displayName: 'Outer Siege Coil',
      hullName: 'Lancer',
    },
  ]);
  const subtitle = resolveShipDesignSubtitle({
    hullName: 'playerShipTemplate1121',
    dominantWeaponType: 'Kinetic',
  }, lookup);
  assert.strictEqual(subtitle.resolved, true);
  assert.strictEqual(subtitle.designName, 'Outer Siege Coil');
  assert.strictEqual(subtitle.hullClass, 'Lancer');
  assert.strictEqual(subtitle.weaponType, 'Kinetic');
});

test('resolveShipDesignSubtitle never falls back to the template id when join fails', () => {
  const lookup = buildShipDesignLookup([]);
  const subtitle = resolveShipDesignSubtitle({
    hullName: 'AlienCouncilShipTemplate506',
    dominantWeaponType: 'Plasma',
  }, lookup);
  assert.strictEqual(subtitle.resolved, false);
  assert.strictEqual(subtitle.designName, null);
  assert.strictEqual(subtitle.hullClass, null);
  assert.strictEqual(subtitle.weaponType, 'Plasma');
});

test('resolveShipDesignSubtitle resolves alien designs when shipDesigns includes them', () => {
  const lookup = buildShipDesignLookup([
    {
      dataName: 'AlienCouncilShipTemplate506',
      _displayName: 'Council Escort',
      hullName: 'Alien Frigate',
    },
  ]);
  const subtitle = resolveShipDesignSubtitle({
    hullName: 'AlienCouncilShipTemplate506',
    dominantWeaponType: 'Plasma',
  }, lookup);
  assert.strictEqual(subtitle.resolved, true);
  assert.strictEqual(subtitle.designName, 'Council Escort');
  assert.strictEqual(subtitle.hullClass, 'Alien Frigate');
});

test('deploymentSummary describes reinforcements for a 55-ship fleet with 40 selected', () => {
  const summary = deploymentSummary({
    fleetShipCount: 55,
    selectedCount: 40,
    cap: BATTLE_SHIP_CAP_PER_SIDE,
  });
  assert.strictEqual(summary.kind, 'over-cap');
  assert.strictEqual(summary.deployCount, 40);
  assert.strictEqual(summary.reinforcementCount, 15);
  const notice = overCapNotice(summary);
  assert.match(notice, /55 ships/);
  assert.match(notice, /40/);
  assert.match(notice, /15/);
  assert.match(notice, /reinforcements/);
});
