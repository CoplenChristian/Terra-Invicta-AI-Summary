const { test } = require('node:test');
const assert = require('node:assert');

const { buildAlienHateEconomics } = require('../server/alienHateEconomics');

test('calculates the minimum alien hate floor from used MC only', () => {
  const economics = buildAlienHateEconomics({
    observer: {
      displayName: 'the Initiative',
      missionControlUsage: 132,
      missionControlCapacity: 185,
      assessedAlienHateOfMe: 63.42,
      completedProjects: []
    },
    difficulty: 'Normal',
    mode: 'omniscient'
  });

  assert.strictEqual(economics.minimumAlienHate, 39.6);
  assert.strictEqual(economics.missionControlCapacity, 185);
  assert.strictEqual(economics.hateAboveFloor, 23.82);
  assert.strictEqual(economics.mcWarFloor, 166.66666666666669);
  assert.strictEqual(economics.formula.text, '132.00 × 0.30 = 39.60');
  assert.strictEqual(economics.currentWarStatus, 'WAR THRESHOLD EXCEEDED');
  assert.strictEqual(economics.minimumFloorStatus, 'BELOW PERMANENT-WAR FLOOR');
});

test('applies each completed concealment project as a separate reduction', () => {
  const economics = buildAlienHateEconomics({
    observer: {
      displayName: 'the Initiative',
      missionControlUsage: 132,
      completedProjects: [
        'Project_StrategicDeception',
        'Project_Maskirovka',
        'Project_OperationalMisdirection'
      ]
    },
    difficulty: 'Normal',
    mode: 'player',
    visibleHateEstimate: '■■■□□'
  });

  assert.strictEqual(economics.completedReductionProjectCount, 3);
  assert.ok(Math.abs(economics.minimumAlienHate - 20.2752) < 1e-9);
  assert.ok(Math.abs(economics.mcWarFloor - 325.5208333333333) < 1e-9);
  assert.strictEqual(economics.actualAlienHate, null, 'player mode must not expose raw hate');
  assert.strictEqual(economics.visibleHateEstimate, '■■■□□');
  assert.strictEqual(economics.actualHateVisibility, 'game_visible_estimate');
});

test('does not apply the alien MC floor to Servants or Protectorate', () => {
  for (const factionName of ['the Servants', 'the Protectorate']) {
    const economics = buildAlienHateEconomics({
      observer: { displayName: factionName, missionControlUsage: 200, assessedAlienHateOfMe: 70 },
      difficulty: 'Brutal',
      mode: 'omniscient'
    });

    assert.strictEqual(economics.applicable, false);
    assert.strictEqual(economics.minimumAlienHate, null);
    assert.strictEqual(economics.status, 'not_applicable');
  }
});

test('Operational Security only applies to the Resistance', () => {
  const initiative = buildAlienHateEconomics({
    observer: {
      displayName: 'the Initiative',
      missionControlUsage: 100,
      completedProjects: ['Project_OperationalSecurity']
    },
    difficulty: 'Normal'
  });
  const resistance = buildAlienHateEconomics({
    observer: {
      displayName: 'the Resistance',
      missionControlUsage: 100,
      completedProjects: ['Project_OperationalSecurity']
    },
    difficulty: 'Normal'
  });

  assert.strictEqual(initiative.completedReductionProjectCount, 0);
  assert.strictEqual(resistance.completedReductionProjectCount, 1);
});
