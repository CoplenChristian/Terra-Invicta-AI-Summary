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

// --- Total war ---------------------------------------------------------------
// Verified against the wiki Diplomacy page ("Alien Total War"), last edited
// 2026-08-11: total war requires BOTH >=200 hate AND >=X years since the
// campaign began, where X is 25/20/10/0 for Cinematic/Normal/Veteran/Brutal,
// divided by the Alien Progression Speed slider.
const { buildTotalWarState, ALIEN_TOTAL_WAR_HATE } = require('../server/alienHateEconomics');

test('total war needs both the hate and the year gate', () => {
  const base = { difficultyKey: 'normal', alienProgressionSpeed: 1 };

  // Neither condition met.
  assert.strictEqual(buildTotalWarState({ ...base, actualAlienHate: 40, yearsElapsed: 9 }).state, 'safe');
  // Hate sufficient, years not: lands as soon as the years elapse.
  assert.strictEqual(buildTotalWarState({ ...base, actualAlienHate: 210, yearsElapsed: 9 }).state, 'pending');
  // Years elapsed, hate not: only hate stands in the way.
  assert.strictEqual(buildTotalWarState({ ...base, actualAlienHate: 40, yearsElapsed: 22 }).state, 'armed');
  // Both.
  assert.strictEqual(buildTotalWarState({ ...base, actualAlienHate: 210, yearsElapsed: 22 }).state, 'active');
});

test('year thresholds match the wiki, including Brutal at zero', () => {
  const at = (difficultyKey) => buildTotalWarState({
    difficultyKey, actualAlienHate: 0, yearsElapsed: 0
  }).yearsThreshold;
  assert.strictEqual(at('cinematic'), 25);
  assert.strictEqual(at('normal'), 20);
  assert.strictEqual(at('veteran'), 10);
  assert.strictEqual(at('brutal'), 0, 'on Brutal the year gate is open from turn one');

  // Brutal therefore reaches total war on hate alone.
  assert.strictEqual(
    buildTotalWarState({ difficultyKey: 'brutal', actualAlienHate: 200, yearsElapsed: 0 }).state,
    'active'
  );
});

test('alien progression speed divides the year threshold', () => {
  const accelerated = buildTotalWarState({
    difficultyKey: 'normal', actualAlienHate: 0, yearsElapsed: 0, alienProgressionSpeed: 2
  });
  assert.strictEqual(accelerated.yearsThreshold, 10, 'Accelerated Campaign halves the 20-year gate');
  assert.strictEqual(accelerated.progressionSpeedAssumed, false);
});

test('maximum alien hate grows yearly and has a late floor', () => {
  const normal = buildTotalWarState({ difficultyKey: 'normal', actualAlienHate: 0, yearsElapsed: 10 });
  assert.strictEqual(normal.maximumAlienHate, 2000, '1000 + 100/yr');

  const cinematicEarly = buildTotalWarState({ difficultyKey: 'cinematic', actualAlienHate: 0, yearsElapsed: 10 });
  assert.strictEqual(cinematicEarly.maximumAlienHate, 90, '70 + 2/yr');

  // After 25 years a sub-200 maximum is raised to 200.
  const cinematicLate = buildTotalWarState({ difficultyKey: 'cinematic', actualAlienHate: 0, yearsElapsed: 25 });
  assert.strictEqual(cinematicLate.maximumAlienHate, 200);
});

test('unknown inputs never report a false safe', () => {
  const noYears = buildTotalWarState({ difficultyKey: 'normal', actualAlienHate: 40, yearsElapsed: null });
  assert.strictEqual(noYears.state, 'unavailable');

  // Hate can be redacted while the year gate is still knowable.
  const noHate = buildTotalWarState({ difficultyKey: 'normal', actualAlienHate: null, yearsElapsed: 22 });
  assert.strictEqual(noHate.state, 'armed_hate_unknown');
  assert.strictEqual(noHate.hateRemaining, null);
});

test('economics reports total war and flags venting as blocked', () => {
  const economics = buildAlienHateEconomics({
    observer: { displayName: 'the Initiative', missionControlUsage: 100,
                assessedAlienHateOfMe: 240, completedProjects: [] },
    difficulty: 'Normal',
    mode: 'omniscient',
    yearsElapsed: 22
  });
  assert.strictEqual(economics.totalWar.state, 'active');
  assert.strictEqual(economics.totalWar.hateThreshold, ALIEN_TOTAL_WAR_HATE);
  assert.strictEqual(economics.ventingBlockedByTotalWar, true,
    'hateAboveFloor is not recoverable once total war is declared');
});
