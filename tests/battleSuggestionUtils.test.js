/**
 * tests/battleSuggestionUtils.test.js
 *
 * Purpose: battle matchup helpers — componentStats → weapon index, mount advice,
 *   and saturation copy behind BattleSuggestion.jsx.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const {
  weaponTemplatesFromComponentStats,
  mountEquivalentAdvice,
  mountUnitLabel,
  saturationHeadline,
  changeAdvice,
  buildBattleMatchup,
  selectionPhase,
} = require('../src/v2/panels/battleSuggestionUtils.mjs');
const { composeBattleSide, saturationVerdict } = require('../shared/battleComposition.mjs');
const { buildWeaponIndex } = require('../shared/battleComposition.mjs');

const MINIMAL_COMPONENT_STATS = {
  missile: {
    SidewinderNuclearMissileBay: {
      displayName: 'Sidewinder Nuclear Missile Bay',
      salvoShots: 4,
      attackMode: true,
      defenseMode: true,
      pointDefenseTargetable: true,
    },
  },
  laser_weapon: {
    PointDefenseLaserTurret: {
      displayName: 'Point Defense Laser Turret',
      defenseMode: true,
      pointDefenseTargetable: false,
    },
    SixtyCmLaser: {
      displayName: '60 cm IR Laser Battery',
      attackMode: true,
      defenseMode: true,
      pointDefenseTargetable: false,
    },
  },
};

const SHIP_WITH_MISSILE = {
  id: 'ship-1',
  displayName: 'Test Monitor',
  weaponLoadout: [{
    role: 'Missile',
    category: 'Missile',
    count: 1,
    systems: ['Sidewinder Nuclear Missile Bay'],
  }],
  armorMedian: 12,
};

const SHIP_WITH_PD_HEAVY = {
  id: 'ship-3',
  displayName: 'PD Heavy Escort',
  weaponLoadout: [{
    role: 'Point Defense',
    category: 'Laser',
    count: 3,
    systems: ['Point Defense Laser Turret'],
  }],
  armorMedian: 8,
};

test('weaponTemplatesFromComponentStats maps baked fields to buildWeaponIndex shape', () => {
  const templates = weaponTemplatesFromComponentStats(MINIMAL_COMPONENT_STATS);
  const missile = templates.find((t) => t.dataName === 'SidewinderNuclearMissileBay');
  assert.ok(missile);
  assert.strictEqual(missile.templateFamily, 'missile');
  assert.strictEqual(missile.salvo_shots, 4);
  assert.strictEqual(missile.isPointDefenseTargetable, true);

  const pd = templates.find((t) => t.dataName === 'PointDefenseLaserTurret');
  assert.ok(pd);
  assert.strictEqual(pd.role, 'Point Defense');
});

test('selectionPhase distinguishes none, one, and both', () => {
  assert.strictEqual(selectionPhase(0, 0), 'none');
  assert.strictEqual(selectionPhase(3, 0), 'one');
  assert.strictEqual(selectionPhase(0, 2), 'one');
  assert.strictEqual(selectionPhase(5, 4), 'both');
});

test('mountUnitLabel picks salvo bays for a missile-only attacker', () => {
  const index = buildWeaponIndex(weaponTemplatesFromComponentStats(MINIMAL_COMPONENT_STATS));
  const side = composeBattleSide([SHIP_WITH_MISSILE], { weaponIndex: index });
  assert.strictEqual(mountUnitLabel(side), 'salvo bays');
});

test('mountEquivalentAdvice never denominates in hulls', () => {
  const index = buildWeaponIndex(weaponTemplatesFromComponentStats(MINIMAL_COMPONENT_STATS));
  const attacker = composeBattleSide([SHIP_WITH_MISSILE], { weaponIndex: index });
  const defender = composeBattleSide([SHIP_WITH_PD_HEAVY], { weaponIndex: index });
  const verdict = saturationVerdict({ attacker, defender });
  assert.strictEqual(verdict.saturated, false);
  const shortfall = Math.abs(verdict.difference);
  const advice = mountEquivalentAdvice(shortfall, attacker);
  assert.ok(advice);
  assert.ok(advice.estimatedMounts >= 1);
  assert.strictEqual(advice.unit, 'salvo bays');
});

test('saturationHeadline reports shortfall when screen holds', () => {
  const index = buildWeaponIndex(weaponTemplatesFromComponentStats(MINIMAL_COMPONENT_STATS));
  const attacker = composeBattleSide([SHIP_WITH_MISSILE], { weaponIndex: index });
  const defender = composeBattleSide([SHIP_WITH_PD_HEAVY], { weaponIndex: index });
  const verdict = saturationVerdict({ attacker, defender });
  const headline = saturationHeadline(verdict, { attackerLabel: 'You', defenderLabel: 'Them' });
  assert.strictEqual(headline.saturated, false);
  assert.match(headline.headline, /holds/);
  assert.match(headline.detail, /Shortfall/);
});

test('changeAdvice names launcher shortfall in mounts not hulls', () => {
  const index = buildWeaponIndex(weaponTemplatesFromComponentStats(MINIMAL_COMPONENT_STATS));
  const attacker = composeBattleSide([SHIP_WITH_MISSILE], { weaponIndex: index });
  const defender = composeBattleSide([SHIP_WITH_PD_HEAVY], { weaponIndex: index });
  const verdict = saturationVerdict({ attacker, defender });
  const advice = changeAdvice(verdict, attacker, { attackerLabel: 'You', defenderLabel: 'Them' });
  assert.strictEqual(advice.kind, 'shortfall');
  assert.match(advice.text, /salvo bays/);
  assert.doesNotMatch(advice.text, /hull/i);
});

test('buildBattleMatchup returns null verdicts when only one side is selected', () => {
  const fleets = [{
    ID: 'f1',
    factionId: 4712,
    ships: [SHIP_WITH_MISSILE],
  }];
  const result = buildBattleMatchup({
    fleets,
    leftFleetId: 'f1',
    leftSelectedShipIds: ['ship-1'],
    rightFleetId: null,
    rightSelectedShipIds: [],
    componentStats: MINIMAL_COMPONENT_STATS,
  });
  assert.strictEqual(result.leftShips.length, 1);
  assert.strictEqual(result.rightShips.length, 0);
  assert.strictEqual(result.yourSalvoVsTheirScreen, null);
});
