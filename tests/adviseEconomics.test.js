const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computeBaseIP,
  computeAdviseNationBonuses,
  computeAdviseHabBonuses,
  evaluateAdviseValue,
  getCouncilorAttribute
} = require('../server/engine/adviseEconomics');

test('computeBaseIP calculates base investment points accurately from wiki formula', () => {
  // Test Case: USA GDP $34,380B (34.38T), Unrest 0, Navies 0, Armies 0
  // base IP = 34380^0.35 * 1 = 38.64 (approx)
  // Let's test with exact GDP 25000, unrest 2, navies 1, armies 2
  const nation = {
    displayName: 'United States',
    gdp: 25000,
    unrest: 2.0, // unrest <= 2 has 0 drag
    navies: 2,   // -1.0 IP
    armies: 4    // -2.0 IP
  };

  const baseIP = computeBaseIP(nation);
  assert.ok(baseIP > 0, 'Base IP should be strictly positive');
  // (25000)^0.35 is ~35.03, minus 1 (navies) - 2 (armies) = ~32.03
  assert.ok(Math.abs(baseIP - 32.03) < 0.5, `Expected ~32.03, got ${baseIP}`);

  // Test zero GDP returns 0
  assert.equal(computeBaseIP({ gdp: 0 }), 0);
  assert.equal(computeBaseIP({ gdp: null }), 0);
});

test('computeAdviseNationBonuses scales with councilor attributes and stacks with 1/n', () => {
  const councilor = {
    displayName: 'Brad Lester',
    attributes: {
      Administration: 25,
      Science: 13,
      Command: 5
    }
  };

  const nation = {
    displayName: 'United States of America',
    gdp: 30000,
    research: 1317.6,
    unrest: 1.5,
    navies: 0,
    armies: 0
  };

  // 1st Advisor (n = 1)
  const bonuses1 = computeAdviseNationBonuses(councilor, nation, 1);
  assert.equal(bonuses1.effectiveAdm, 25);
  assert.equal(bonuses1.effectiveSci, 13);
  assert.equal(bonuses1.effectiveCmd, 5);

  // Research bonus: 1317.6 * 13% = +171.288 -> +171.3
  assert.equal(bonuses1.gainResearch, 171.3);
  assert.ok(bonuses1.gainIP > 0);
  assert.equal(bonuses1.gainMiltech, 0.05);

  // 2nd Advisor (n = 2): bonuses should be halved (1/2)
  const bonuses2 = computeAdviseNationBonuses(councilor, nation, 2);
  assert.equal(bonuses2.gainResearch, 85.6);
  assert.equal(bonuses2.gainMiltech, 0.025);
});

test('computeAdviseHabBonuses computes hab resource output and research boosts', () => {
  const councilor = {
    displayName: 'Ngoc Thy Nguyen',
    attributes: {
      Administration: 20,
      Science: 10,
      Command: 15
    }
  };

  const hab = {
    displayName: 'Lunar Mining Base Alpha',
    research: 100,
    water: 50,
    volatiles: 30,
    metals: 80,
    nobleMetals: 15,
    fissiles: 5,
    marineCombatValue: 40
  };

  const bonuses = computeAdviseHabBonuses(councilor, hab, 1);
  assert.equal(bonuses.gainResearch, 10.0); // 100 * 10%
  assert.equal(bonuses.outputs.water, 10.0); // 50 * 20%
  assert.equal(bonuses.outputs.metals, 16.0); // 80 * 20%
  assert.equal(bonuses.gainCombat, 6.0); // 40 * 15%
});

test('evaluateAdviseValue returns structured composite per-turn and scaled scores', () => {
  const bonuses = {
    targetType: 'nation',
    gainResearch: 171.3,
    gainIP: 8.5,
    gainMiltech: 0.05
  };

  const evalResult = evaluateAdviseValue(bonuses, 'nation');
  assert.ok(evalResult.perTurnValue > 250, 'Per-turn value combines research, IP and miltech');
  assert.ok(evalResult.score >= 5.0 && evalResult.score <= 9.5, 'Score scaled for directive ranking');
});
