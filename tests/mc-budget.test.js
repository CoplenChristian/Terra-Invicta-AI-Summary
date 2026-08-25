// tests/mc-budget.test.js
//
// Purpose: characterisation tests for the Mission Control budget planner React
//   panel. Captures exact rendering of the Mission Control budget planner,
//   including player/omniscient modes, every unavailable state, interactive
//   stepper and reset behavior, and ceiling crossing verdicts.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  withMcBudgetHarnessPage,
  getHarnessHtml,
  getHarnessText,
  visibleText,
} = require('./fixtures/mcBudgetBrowser');
const { loadFixtureFilteredSnapshot } = require('./fixtures/frozenSnapshots');

const FORBIDDEN = ['null', 'undefined', 'NaN', '[object Object]'];

function assertNoPlaceholderText(html, label) {
  const text = visibleText(html);
  for (const token of FORBIDDEN) {
    const index = text.indexOf(token);
    assert.strictEqual(
      index,
      -1,
      `${label}: rendered text contains "${token}" near: ${text.slice(Math.max(0, index - 60), index + 60)}`
    );
  }
}

// ---------------------------------------------------------------------------
// 1. NORMAL RENDER: PLAYER AND OMNISCIENT
// ---------------------------------------------------------------------------

test('mc-budget renders normal player mode payload with verified metric grid and hull list', async () => {
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'player' });
  const payload = {
    economics: snapshot.alienHateEconomics,
    shipHullStats: snapshot.shipHullStats,
  };

  await withMcBudgetHarnessPage(payload, async (page) => {
    const html = await getHarnessHtml(page);
    const text = await getHarnessText(page);

    assert.ok(text.includes('MISSION CONTROL BUDGET'), 'header must be present');
    assert.ok(text.includes('WITHIN BUDGET'), 'initial verdict must be WITHIN BUDGET');
    assert.ok(text.includes('PROJECTED FLOOR 31.1'), 'projected floor must render formatted calculation');

    assert.ok(text.includes('Used now 162 of 184 capacity'), 'used vs capacity metric must be accurate');
    assert.ok(text.includes('Headroom to cap 22 hard build limit'), 'headroom to capacity must be 22');
    assert.ok(text.includes('Headroom to war floor 98 used MC at 50 hate'), 'headroom to war floor must be 98');
    assert.ok(text.includes('Staged build +0 0 ship(s)'), 'initial staged build must be zero');

    assert.ok(text.includes('STAGE A BUILD PER-HULL MC FROM GAME TEMPLATES'), 'stage section header must be present');
    assert.ok(text.includes('Escort 1 MC · 90d − 0 +'), 'Escort must render 1 MC and 90d construction time');
    assert.ok(text.includes('Frigate 2 MC · 120d − 0 +'), 'Frigate must render 2 MC and 120d construction time');
    assert.ok(text.includes('Monitor 2 MC · 120d − 0 +'), 'Monitor must render 2 MC and 120d construction time');
    assert.ok(text.includes('Destroyer 2 MC · 135d − 0 +'), 'Destroyer must render 2 MC and 135d construction time');
    assert.ok(text.includes('Cruiser 3 MC · 180d − 0 +'), 'Cruiser must render 3 MC and 180d construction time');
    assert.ok(text.includes('Battlecruiser 3 MC · 180d − 0 +'), 'Battlecruiser must render 3 MC and 180d construction time');
    assert.ok(text.includes('Battleship 3 MC · 200d − 0 +'), 'Battleship must render 3 MC and 200d construction time');
    assert.ok(text.includes('Lancer 4 MC · 240d − 0 +'), 'Lancer must render 4 MC and 240d construction time');

    assert.ok(text.includes('WHY DOES BUILDING RAISE ALIEN HATE?'), 'formula summary must be present');
    assert.ok(text.includes('used MC × difficulty × 0.8 per concealment project'), 'formula text must be present');
    assert.ok(text.includes('Max(1, Floor(excess² / 2)) MC'), 'mine penalty formula must be present');

    assertNoPlaceholderText(html, 'player normal render');
  });
});

test('mc-budget renders omniscient mode payload with full fidelity', async () => {
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'omniscient' });
  const payload = {
    economics: snapshot.alienHateEconomics,
    shipHullStats: snapshot.shipHullStats,
  };

  await withMcBudgetHarnessPage(payload, async (page) => {
    const html = await getHarnessHtml(page);
    const text = await getHarnessText(page);

    assert.ok(text.includes('MISSION CONTROL BUDGET'), 'omniscient header must be present');
    assert.ok(text.includes('WITHIN BUDGET'), 'verdict must be within budget');
    assert.ok(text.includes('PROJECTED FLOOR 31.1'), 'omniscient floor projection must match calculation');
    assert.ok(text.includes('Used now 162 of 184 capacity'), 'omniscient metrics must render correctly');

    assertNoPlaceholderText(html, 'omniscient normal render');
  });
});

// ---------------------------------------------------------------------------
// 2. EMPTY AND ABSENT INPUT (THEY ARE DIFFERENT)
// ---------------------------------------------------------------------------

test('mc-budget handles absent input (null and undefined) with honest unavailable state', async () => {
  await withMcBudgetHarnessPage(null, async (page) => {
    await page.evaluate(() => {
      window.MissionControlMcBudget.render(null, {});
    });

    const nullHtml = await getHarnessHtml(page);
    assert.strictEqual(visibleText(nullHtml), 'MC BUDGET UNAVAILABLE');
    assert.ok(nullHtml.includes('alien-hate-econ-empty'));
  });

  await withMcBudgetHarnessPage(undefined, async (page) => {
    const undefHtml = await getHarnessHtml(page);
    assert.strictEqual(visibleText(undefHtml), 'MC BUDGET UNAVAILABLE');
  });
});

test('mc-budget handles empty input ({}) and non-applicable economics with honest unavailable state', async () => {
  await withMcBudgetHarnessPage({}, async (page) => {
    const emptyHtml = await getHarnessHtml(page);
    assert.strictEqual(visibleText(emptyHtml), 'MC BUDGET UNAVAILABLE');
  });

  await withMcBudgetHarnessPage({
    economics: { applicable: false },
    shipHullStats: {},
  }, async (page) => {
    const notAppHtml = await getHarnessHtml(page);
    assert.strictEqual(visibleText(notAppHtml), 'MC BUDGET UNAVAILABLE');
  });
});

// ---------------------------------------------------------------------------
// 3. EVERY UNAVAILABLE AND UNKNOWN STATE
// ---------------------------------------------------------------------------

test('mc-budget renders UNAVAILABLE for each missing economic metric, never defaulting to zero', async () => {
  const degradedPayload = {
    economics: {
      applicable: true,
      usedMissionControl: null,
      missionControlCapacity: null,
      mcWarFloor: null,
      difficultyMultiplier: null,
      concealmentMultiplier: null,
    },
    shipHullStats: {
      Escort: { missionControl: null, baseConstructionTimeDays: null },
    },
  };

  await withMcBudgetHarnessPage(degradedPayload, async (page) => {
    const html = await getHarnessHtml(page);
    const text = await getHarnessText(page);

    assertNoPlaceholderText(html, 'degraded payload');

    assert.ok(text.includes('PROJECTED FLOOR UNAVAILABLE'), 'unmeasured floor must render UNAVAILABLE');
    assert.ok(text.includes('Used now UNAVAILABLE of UNAVAILABLE capacity'), 'unmeasured used and capacity must render UNAVAILABLE');
    assert.ok(text.includes('Headroom to cap UNAVAILABLE hard build limit'), 'unmeasured cap headroom must render UNAVAILABLE');
    assert.ok(text.includes('Headroom to war floor UNAVAILABLE used MC at 50 hate'), 'unmeasured war headroom must render UNAVAILABLE');
    assert.ok(text.includes('Escort ? MC'), 'unknown hull MC cost must render "?" rather than 0 MC');
    assert.ok(!html.includes('nulld'), 'missing construction time must not render nulld');
    assert.ok(!html.includes('undefinedd'), 'missing construction time must not render undefinedd');
  });
});

test('mc-budget renders individual null fields as UNAVAILABLE while keeping measured fields intact', async () => {
  await withMcBudgetHarnessPage({
    economics: {
      applicable: true,
      usedMissionControl: 100,
      missionControlCapacity: null,
      mcWarFloor: 200,
      difficultyMultiplier: 0.3,
      concealmentMultiplier: 1.0,
    },
    shipHullStats: {},
  }, async (page) => {
    const text = await getHarnessText(page);
    assert.ok(text.includes('Used now 100 of UNAVAILABLE capacity'), 'measured used must render alongside UNAVAILABLE capacity');
    assert.ok(text.includes('Headroom to cap UNAVAILABLE'), 'headroom to null cap must be UNAVAILABLE');
    assert.ok(text.includes('Headroom to war floor 100'), 'headroom to known war floor must compute accurately (200 - 100 = 100)');
    assert.ok(text.includes('PROJECTED FLOOR 30.0'), 'projected floor must compute with known used (100 * 0.3 = 30.0)');
  });
});

test('mc-budget renders PROJECTED FLOOR UNAVAILABLE when difficultyMultiplier is null but used is measured', async () => {
  await withMcBudgetHarnessPage({
    economics: {
      applicable: true,
      usedMissionControl: 152,
      missionControlCapacity: 170,
      mcWarFloor: 208.33,
      difficultyMultiplier: null,
      concealmentMultiplier: 1.0,
    },
    shipHullStats: {},
  }, async (page) => {
    const text = await getHarnessText(page);
    assert.ok(text.includes('PROJECTED FLOOR UNAVAILABLE'), 'null difficulty must not coerce to a confident 0.0 floor');
    assert.ok(!text.includes('PROJECTED FLOOR 0.0'), 'null difficulty must not render PROJECTED FLOOR 0.0');
    assert.ok(text.includes('Used now 152 of 170 capacity'), 'measured used and capacity must still render');
  });
});

// ---------------------------------------------------------------------------
// 4. VERDICT VARIATIONS AND CEILING CROSSINGS
// ---------------------------------------------------------------------------

test('mc-budget asserts EXCEEDS MC CAPACITY verdict when staged build crosses capacity ceiling only', async () => {
  await withMcBudgetHarnessPage({
    economics: {
      applicable: true,
      usedMissionControl: 185,
      missionControlCapacity: 184,
      mcWarFloor: 300,
      difficultyMultiplier: 0.3,
      concealmentMultiplier: 1.0,
    },
    shipHullStats: {},
  }, async (page) => {
    const html = await getHarnessHtml(page);
    const text = await getHarnessText(page);
    assert.ok(text.includes('EXCEEDS MC CAPACITY'), 'verdict must state EXCEEDS MC CAPACITY');
    assert.ok(text.includes('Capacity binds before the hate floor does. Raise MC capacity or cut the build.'), 'verdict note must match capacity binding note');
    assert.ok(html.includes('is-danger'), 'tone must be is-danger');
  });
});

test('mc-budget asserts CROSSES PERMANENT-WAR FLOOR verdict when war floor binds before capacity', async () => {
  await withMcBudgetHarnessPage({
    economics: {
      applicable: true,
      usedMissionControl: 150,
      missionControlCapacity: 200,
      mcWarFloor: 140,
      difficultyMultiplier: 0.3,
      concealmentMultiplier: 1.0,
    },
    shipHullStats: {},
  }, async (page) => {
    const html = await getHarnessHtml(page);
    const text = await getHarnessText(page);
    assert.ok(text.includes('CROSSES PERMANENT-WAR FLOOR'), 'verdict must state CROSSES PERMANENT-WAR FLOOR');
    assert.ok(text.includes('Used MC would push the minimum hate floor past 50 — peace becomes impossible.'), 'verdict note must match permanent war warning');
    assert.ok(html.includes('is-danger'), 'tone must be is-danger');
  });
});

test('mc-budget asserts EXCEEDS BOTH CEILINGS verdict when build crosses both thresholds', async () => {
  await withMcBudgetHarnessPage({
    economics: {
      applicable: true,
      usedMissionControl: 250,
      missionControlCapacity: 200,
      mcWarFloor: 150,
      difficultyMultiplier: 0.3,
      concealmentMultiplier: 1.0,
    },
    shipHullStats: {},
  }, async (page) => {
    const html = await getHarnessHtml(page);
    const text = await getHarnessText(page);
    assert.ok(text.includes('EXCEEDS BOTH CEILINGS'), 'verdict must state EXCEEDS BOTH CEILINGS');
    assert.ok(text.includes('This fleet cannot be built and would guarantee permanent alien war.'), 'verdict note must state double ceiling failure');
    assert.ok(html.includes('is-danger'), 'tone must be is-danger');
  });
});

// ---------------------------------------------------------------------------
// 5. INTERACTIVITY: STEPPER BUTTONS, OUTPUT, AND CLEAR RESET
// ---------------------------------------------------------------------------

test('mc-budget stepper buttons increment, decrement, update outputs, and clear staged build', async () => {
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'player' });
  const payload = {
    economics: snapshot.alienHateEconomics,
    shipHullStats: snapshot.shipHullStats,
  };

  await withMcBudgetHarnessPage(payload, async (page) => {
    let text = await getHarnessText(page);
    assert.ok(text.includes('Staged build +0 0 ship(s)'));
    assert.strictEqual(await page.$('[data-mc-reset]'), null, 'reset button must not exist when no ships are staged');

    await page.click('[data-mc-hull="Escort"][data-mc-step="1"]');

    let textAfter1 = await getHarnessText(page);
    assert.ok(textAfter1.includes('Staged build +1 1 ship(s)'), 'staging one Escort must add 1 MC and 1 ship');
    assert.ok(textAfter1.includes('1 ship(s) · +1 MC · floor 31.3'), 'verdict note must update with staged ships, MC and floor');
    const htmlAfter1 = await getHarnessHtml(page);
    assert.ok(htmlAfter1.includes('is-emphasis'), 'staged build metric must receive emphasis styling');

    const resetButton = await page.$('[data-mc-reset]');
    assert.ok(resetButton, 'reset button must appear once ships are staged');

    await page.click('[data-mc-hull="Escort"][data-mc-step="-1"]');

    let textAfterMinus = await getHarnessText(page);
    assert.ok(textAfterMinus.includes('Staged build +0 0 ship(s)'), 'decrementing Escort must return staged count to 0');

    await page.click('[data-mc-hull="Escort"][data-mc-step="-1"]');
    assert.ok((await getHarnessText(page)).includes('Staged build +0 0 ship(s)'), 'count must not become negative');

    await page.click('[data-mc-hull="Battleship"][data-mc-step="1"]');
    await page.click('[data-mc-hull="Frigate"][data-mc-step="1"]');

    let textMulti = await getHarnessText(page);
    assert.ok(textMulti.includes('Staged build +5 2 ship(s)'), 'staging BB (3) and FF (2) must total +5 MC and 2 ships');

    await page.click('[data-mc-reset]');

    let textReset = await getHarnessText(page);
    assert.ok(textReset.includes('Staged build +0 0 ship(s)'), 'clicking reset must clear staged build');
    assert.strictEqual(await page.$('[data-mc-reset]'), null, 'reset button must be removed after reset');
  });
});

// ---------------------------------------------------------------------------
// 6. HULL ORDER FALLBACK
// ---------------------------------------------------------------------------

test('mc-budget falls back to object keys slice when none of canonical HULL_ORDER are present', async () => {
  const customPayload = {
    economics: {
      applicable: true,
      usedMissionControl: 10,
      missionControlCapacity: 20,
      mcWarFloor: 50,
      difficultyMultiplier: 0.3,
      concealmentMultiplier: 1.0,
    },
    shipHullStats: {
      CustomHullAlpha: { missionControl: 1, baseConstructionTimeDays: 30 },
      CustomHullBeta: { missionControl: 4, baseConstructionTimeDays: 100 },
    },
  };

  await withMcBudgetHarnessPage(customPayload, async (page) => {
    const html = await getHarnessHtml(page);
    const text = await getHarnessText(page);

    assert.ok(text.includes('CustomHullAlpha 1 MC · 30d'), 'CustomHullAlpha must be rendered');
    assert.ok(text.includes('CustomHullBeta 4 MC · 100d'), 'CustomHullBeta must be rendered');
    assertNoPlaceholderText(html, 'custom hull stats payload');
  });
});
