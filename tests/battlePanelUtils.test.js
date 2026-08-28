/**
 * tests/battlePanelUtils.test.js
 *
 * Purpose: cap enforcement and over-cap deployment copy for the battle planner.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const {
  BATTLE_SHIP_CAP_PER_SIDE,
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
