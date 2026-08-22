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

// --- Alien Progression Speed, wired in 2026-08-21 -----------------------------
//
// Re-read as RAW WIKITEXT on 2026-08-21 at the wiki's new home,
// https://wiki.hoodedhorse.com/Terra_Invicta/ (the fandom mirror now returns
// 410 Gone). Two DIFFERENT scalings, and conflating them is the trap:
//
//   Diplomacy, "Alien Total War":
//     "These values are divided by the Alien Progression Speed."
//   Aliens, "Alien Progression Rate" (page last edited 2026-04-05):
//     "Increase in Alien Maximum Hate per Year is multiplied by X%."
//     "Every 'Years Before Aliens Can Do Something' timer has its duration
//      divided by X%."
//
// So year THRESHOLDS are divided by the speed and the yearly ACCRUAL is
// multiplied by it. Only the threshold half was implemented, and it was inert
// because no caller passed a speed -- these pin both halves now that one does.

test('the maximum-hate yearly increase is multiplied by progression speed', () => {
  // Measured before this change: the live save published 2300 here, from
  // 1000 + 100/yr x an assumed 13 elapsed years at an assumed speed of 1.
  const stock = buildTotalWarState({ difficultyKey: 'normal', actualAlienHate: 0, yearsElapsed: 10 });
  assert.strictEqual(stock.maximumAlienHate, 2000, '1000 + 100/yr at 100% speed');

  const accelerated = buildTotalWarState({
    difficultyKey: 'normal', actualAlienHate: 0, yearsElapsed: 10, alienProgressionSpeed: 2
  });
  assert.strictEqual(accelerated.maximumAlienHate, 3000,
    '1000 + (100 x 2)/yr at 200% speed -- the accrual scales, it is not just the thresholds');

  // The live save's own figures, end to end.
  const live = buildTotalWarState({
    difficultyKey: 'normal', actualAlienHate: 42.86253, yearsElapsed: 8.91, alienProgressionSpeed: 2
  });
  assert.strictEqual(live.maximumAlienHate, 2782);
  assert.strictEqual(live.yearsThreshold, 10);
  assert.strictEqual(live.yearsRemaining, 1.09);
  assert.strictEqual(live.state, 'safe');
});

test('the 25-year maximum-hate floor check is divided by progression speed', () => {
  // Cinematic accrues 2/yr from 70, so it is still under 200 when the floor
  // rule fires -- which is the only difficulty where the rule is observable.
  // At 200% the accrual doubles to 4/yr AND the 25-year check halves to 12.5.
  const justBefore = buildTotalWarState({
    difficultyKey: 'cinematic', actualAlienHate: 0, yearsElapsed: 12, alienProgressionSpeed: 2
  });
  assert.strictEqual(justBefore.maximumAlienHate, 118, '70 + 4/yr x 12, floor not yet reached');

  const justAfter = buildTotalWarState({
    difficultyKey: 'cinematic', actualAlienHate: 0, yearsElapsed: 12.5, alienProgressionSpeed: 2
  });
  assert.strictEqual(justAfter.maximumAlienHate, 200,
    'at 200% the 25-year floor check is reached at 12.5 elapsed years');
});

test('the applied progression speed is reported, not just whether it was assumed', () => {
  const measured = buildTotalWarState({
    difficultyKey: 'normal', actualAlienHate: 0, yearsElapsed: 8.91, alienProgressionSpeed: 2
  });
  assert.strictEqual(measured.alienProgressionSpeed, 2);
  assert.strictEqual(measured.progressionSpeedAssumed, false);

  // No speed supplied: still 1, still announced as an assumption. A fixture or
  // a save predating the custom-difficulty block genuinely has none to read.
  const assumed = buildTotalWarState({ difficultyKey: 'normal', actualAlienHate: 0, yearsElapsed: 8.91 });
  assert.strictEqual(assumed.alienProgressionSpeed, 1);
  assert.strictEqual(assumed.progressionSpeedAssumed, true);
  assert.strictEqual(assumed.yearsThreshold, 20, 'the unscaled gate is what the assumption produces');

  // An unusable speed must not annihilate the gate: 20/0 is Infinity and a
  // negative would invert it. Both fall back to 1 and announce it.
  for (const bad of [0, -2, null, undefined, NaN, 'fast']) {
    const state = buildTotalWarState({
      difficultyKey: 'normal', actualAlienHate: 0, yearsElapsed: 8.91, alienProgressionSpeed: bad
    });
    assert.strictEqual(state.yearsThreshold, 20, `speed ${JSON.stringify(bad)} must fall back to 1`);
    assert.strictEqual(state.progressionSpeedAssumed, true);
  }
});

test('published year figures carry no binary floating-point residue', () => {
  // `10 - 8.91` is 1.0899999999999999 in binary floating point, and that string
  // reached the briefing and the v2 board verbatim.
  const state = buildTotalWarState({
    difficultyKey: 'normal', actualAlienHate: 0, yearsElapsed: 8.91, alienProgressionSpeed: 2
  });
  assert.strictEqual(state.yearsRemaining, 1.09);

  // Rounding is presentational only -- it must never move the gate itself.
  // 9.999 elapsed against a 10-year gate is still shut, however it prints.
  const almost = buildTotalWarState({
    difficultyKey: 'normal', actualAlienHate: 250, yearsElapsed: 9.999, alienProgressionSpeed: 2
  });
  assert.strictEqual(almost.state, 'pending', 'the gate is tested unrounded');
  assert.strictEqual(almost.yearsRemaining, 0);
});
