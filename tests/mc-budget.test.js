// tests/mc-budget.test.js
//
// Purpose: characterisation tests for public/v2/js/components/mc-budget.js
//   Captures exact rendering of the Mission Control budget planner,
//   including player/omniscient modes, every unavailable state, interactive
//   stepper and reset behavior, and ceiling crossing verdicts.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { runComponent, visibleText } = require('./fixtures/renderHarness');
const { loadFixtureFilteredSnapshot } = require('./fixtures/frozenSnapshots');

const repoRoot = path.resolve(__dirname, '..');
const componentPath = path.join(repoRoot, 'public', 'v2', 'js', 'components', 'mc-budget.js');

function loadComponent() {
  return runComponent(componentPath).window.MissionControlMcBudget;
}

const { DOMNode } = require('./fixtures/mockDom');

function createRoot() {
  const root = new DOMNode('div');
  return root;
}

function renderToString(payload) {
  const component = loadComponent();
  const root = createRoot();
  component.render(root, payload);
  return root.innerHTML;
}

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

test('mc-budget renders normal player mode payload with verified metric grid and hull list', () => {
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'player' });
  const payload = {
    economics: snapshot.alienHateEconomics,
    shipHullStats: snapshot.shipHullStats
  };

  const html = renderToString(payload);
  const text = visibleText(html);

  // Status bar
  assert.ok(text.includes('MISSION CONTROL BUDGET'), 'header must be present');
  assert.ok(text.includes('WITHIN BUDGET'), 'initial verdict must be WITHIN BUDGET');
  assert.ok(text.includes('PROJECTED FLOOR 31.1'), 'projected floor must render formatted calculation');

  // Metrics grid
  assert.ok(text.includes('Used now 162 of 184 capacity'), 'used vs capacity metric must be accurate');
  assert.ok(text.includes('Headroom to cap 22 hard build limit'), 'headroom to capacity must be 22');
  assert.ok(text.includes('Headroom to war floor 98 used MC at 50 hate'), 'headroom to war floor must be 98');
  assert.ok(text.includes('Staged build +0 0 ship(s)'), 'initial staged build must be zero');

  // Ordered hull roster with template stats
  assert.ok(text.includes('STAGE A BUILD PER-HULL MC FROM GAME TEMPLATES'), 'stage section header must be present');
  assert.ok(text.includes('Escort 1 MC · 90d − 0 +'), 'Escort must render 1 MC and 90d construction time');
  assert.ok(text.includes('Frigate 2 MC · 120d − 0 +'), 'Frigate must render 2 MC and 120d construction time');
  assert.ok(text.includes('Monitor 2 MC · 120d − 0 +'), 'Monitor must render 2 MC and 120d construction time');
  assert.ok(text.includes('Destroyer 2 MC · 135d − 0 +'), 'Destroyer must render 2 MC and 135d construction time');
  assert.ok(text.includes('Cruiser 3 MC · 180d − 0 +'), 'Cruiser must render 3 MC and 180d construction time');
  assert.ok(text.includes('Battlecruiser 3 MC · 180d − 0 +'), 'Battlecruiser must render 3 MC and 180d construction time');
  assert.ok(text.includes('Battleship 3 MC · 200d − 0 +'), 'Battleship must render 3 MC and 200d construction time');
  assert.ok(text.includes('Lancer 4 MC · 240d − 0 +'), 'Lancer must render 4 MC and 240d construction time');

  // Formula explanation
  assert.ok(text.includes('WHY DOES BUILDING RAISE ALIEN HATE?'), 'formula summary must be present');
  assert.ok(text.includes('used MC × difficulty × 0.8 per concealment project'), 'formula text must be present');
  assert.ok(text.includes('Max(1, Floor(excess² / 2)) MC'), 'mine penalty formula must be present');

  assertNoPlaceholderText(html, 'player normal render');
});

test('mc-budget renders omniscient mode payload with full fidelity', () => {
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'omniscient' });
  const payload = {
    economics: snapshot.alienHateEconomics,
    shipHullStats: snapshot.shipHullStats
  };

  const html = renderToString(payload);
  const text = visibleText(html);

  assert.ok(text.includes('MISSION CONTROL BUDGET'), 'omniscient header must be present');
  assert.ok(text.includes('WITHIN BUDGET'), 'verdict must be within budget');
  assert.ok(text.includes('PROJECTED FLOOR 31.1'), 'omniscient floor projection must match calculation');
  assert.ok(text.includes('Used now 162 of 184 capacity'), 'omniscient metrics must render correctly');

  assertNoPlaceholderText(html, 'omniscient normal render');
});

// ---------------------------------------------------------------------------
// 2. EMPTY AND ABSENT INPUT (THEY ARE DIFFERENT)
// ---------------------------------------------------------------------------

test('mc-budget handles absent input (null and undefined) with honest unavailable state', () => {
  const component = loadComponent();

  // null root
  assert.doesNotThrow(() => component.render(null, {}), 'null root must not throw');

  // null payload
  const rootNull = createRoot();
  component.render(rootNull, null);
  assert.strictEqual(visibleText(rootNull.innerHTML), 'MC BUDGET UNAVAILABLE');
  assert.ok(rootNull.innerHTML.includes('alien-hate-econ-empty'));

  // undefined payload
  const rootUndef = createRoot();
  component.render(rootUndef, undefined);
  assert.strictEqual(visibleText(rootUndef.innerHTML), 'MC BUDGET UNAVAILABLE');
});

test('mc-budget handles empty input ({}) and non-applicable economics with honest unavailable state', () => {
  // empty object payload
  const emptyHtml = renderToString({});
  assert.strictEqual(visibleText(emptyHtml), 'MC BUDGET UNAVAILABLE');

  // payload with non-applicable economics
  const notAppHtml = renderToString({
    economics: { applicable: false },
    shipHullStats: {}
  });
  assert.strictEqual(visibleText(notAppHtml), 'MC BUDGET UNAVAILABLE');
});

// ---------------------------------------------------------------------------
// 3. EVERY UNAVAILABLE AND UNKNOWN STATE
// ---------------------------------------------------------------------------

test('mc-budget renders UNAVAILABLE for each missing economic metric, never defaulting to zero', () => {
  const degradedPayload = {
    economics: {
      applicable: true,
      usedMissionControl: null,
      missionControlCapacity: null,
      mcWarFloor: null,
      difficultyMultiplier: null,
      concealmentMultiplier: null
    },
    shipHullStats: {
      Escort: { missionControl: null, baseConstructionTimeDays: null }
    }
  };

  const html = renderToString(degradedPayload);
  const text = visibleText(html);

  assertNoPlaceholderText(html, 'degraded payload');

  // Projected floor unavailable
  assert.ok(text.includes('PROJECTED FLOOR UNAVAILABLE'), 'unmeasured floor must render UNAVAILABLE');

  // Metric grid unmeasured states
  assert.ok(text.includes('Used now UNAVAILABLE of UNAVAILABLE capacity'), 'unmeasured used and capacity must render UNAVAILABLE');
  assert.ok(text.includes('Headroom to cap UNAVAILABLE hard build limit'), 'unmeasured cap headroom must render UNAVAILABLE');
  assert.ok(text.includes('Headroom to war floor UNAVAILABLE used MC at 50 hate'), 'unmeasured war headroom must render UNAVAILABLE');

  // Hull stats with null MC renders '?' rather than '0 MC'
  assert.ok(text.includes('Escort ? MC'), 'unknown hull MC cost must render "?" rather than 0 MC');
  assert.ok(!html.includes('nulld'), 'missing construction time must not render nulld');
  assert.ok(!html.includes('undefinedd'), 'missing construction time must not render undefinedd');
});

test('mc-budget renders individual null fields as UNAVAILABLE while keeping measured fields intact', () => {
  // usedMC is known, cap is unknown
  const htmlNoCap = renderToString({
    economics: {
      applicable: true,
      usedMissionControl: 100,
      missionControlCapacity: null,
      mcWarFloor: 200,
      difficultyMultiplier: 0.3,
      concealmentMultiplier: 1.0
    },
    shipHullStats: {}
  });
  const textNoCap = visibleText(htmlNoCap);
  assert.ok(textNoCap.includes('Used now 100 of UNAVAILABLE capacity'), 'measured used must render alongside UNAVAILABLE capacity');
  assert.ok(textNoCap.includes('Headroom to cap UNAVAILABLE'), 'headroom to null cap must be UNAVAILABLE');
  assert.ok(textNoCap.includes('Headroom to war floor 100'), 'headroom to known war floor must compute accurately (200 - 100 = 100)');
  assert.ok(textNoCap.includes('PROJECTED FLOOR 30.0'), 'projected floor must compute with known used (100 * 0.3 = 30.0)');
});

// ---------------------------------------------------------------------------
// 4. VERDICT VARIATIONS AND CEILING CROSSINGS
// ---------------------------------------------------------------------------

test('mc-budget asserts EXCEEDS MC CAPACITY verdict when staged build crosses capacity ceiling only', () => {
  const html = renderToString({
    economics: {
      applicable: true,
      usedMissionControl: 180,
      missionControlCapacity: 184,
      mcWarFloor: 300,
      difficultyMultiplier: 0.3,
      concealmentMultiplier: 1.0
    },
    shipHullStats: {
      Battleship: { missionControl: 3, baseConstructionTimeDays: 200 }
    }
  });

  // Now simulate staging 2 Battleships (6 MC total -> 186 used > 184 cap, but < 300 war floor)
  const component = loadComponent();
  const root = createRoot();
  component.render(root, {
    economics: {
      applicable: true,
      usedMissionControl: 185, // Already exceeds 184 cap
      missionControlCapacity: 184,
      mcWarFloor: 300,
      difficultyMultiplier: 0.3,
      concealmentMultiplier: 1.0
    },
    shipHullStats: {}
  });

  const text = visibleText(root.innerHTML);
  assert.ok(text.includes('EXCEEDS MC CAPACITY'), 'verdict must state EXCEEDS MC CAPACITY');
  assert.ok(text.includes('Capacity binds before the hate floor does. Raise MC capacity or cut the build.'), 'verdict note must match capacity binding note');
  assert.ok(root.innerHTML.includes('is-danger'), 'tone must be is-danger');
});

test('mc-budget asserts CROSSES PERMANENT-WAR FLOOR verdict when war floor binds before capacity', () => {
  const component = loadComponent();
  const root = createRoot();
  component.render(root, {
    economics: {
      applicable: true,
      usedMissionControl: 150,
      missionControlCapacity: 200,
      mcWarFloor: 140, // Already below used MC
      difficultyMultiplier: 0.3,
      concealmentMultiplier: 1.0
    },
    shipHullStats: {}
  });

  const text = visibleText(root.innerHTML);
  assert.ok(text.includes('CROSSES PERMANENT-WAR FLOOR'), 'verdict must state CROSSES PERMANENT-WAR FLOOR');
  assert.ok(text.includes('Used MC would push the minimum hate floor past 50 — peace becomes impossible.'), 'verdict note must match permanent war warning');
  assert.ok(root.innerHTML.includes('is-danger'), 'tone must be is-danger');
});

test('mc-budget asserts EXCEEDS BOTH CEILINGS verdict when build crosses both thresholds', () => {
  const component = loadComponent();
  const root = createRoot();
  component.render(root, {
    economics: {
      applicable: true,
      usedMissionControl: 250,
      missionControlCapacity: 200,
      mcWarFloor: 150,
      difficultyMultiplier: 0.3,
      concealmentMultiplier: 1.0
    },
    shipHullStats: {}
  });

  const text = visibleText(root.innerHTML);
  assert.ok(text.includes('EXCEEDS BOTH CEILINGS'), 'verdict must state EXCEEDS BOTH CEILINGS');
  assert.ok(text.includes('This fleet cannot be built and would guarantee permanent alien war.'), 'verdict note must state double ceiling failure');
  assert.ok(root.innerHTML.includes('is-danger'), 'tone must be is-danger');
});

// ---------------------------------------------------------------------------
// 5. INTERACTIVITY: STEPPER BUTTONS, OUTPUT, AND CLEAR RESET
// ---------------------------------------------------------------------------

test('mc-budget stepper buttons increment, decrement, update outputs, and clear staged build', () => {
  const component = loadComponent();
  const root = createRoot();
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'player' });
  const payload = {
    economics: snapshot.alienHateEconomics,
    shipHullStats: snapshot.shipHullStats
  };

  // Initial render: 0 staged ships
  component.render(root, payload);
  assert.ok(visibleText(root.innerHTML).includes('Staged build +0 0 ship(s)'));
  assert.strictEqual(root.querySelector('[data-mc-reset]'), null, 'reset button must not exist when no ships are staged');

  // Find '+' buttons for Escort (step = 1)
  const buttons = root.querySelectorAll('[data-mc-hull]');
  const escortPlus = buttons.find(b => b.getAttribute('data-mc-hull') === 'Escort' && b.getAttribute('data-mc-step') === '1');
  assert.ok(escortPlus, 'Escort + button must exist');

  // Click '+' on Escort
  escortPlus.click();

  let textAfter1 = visibleText(root.innerHTML);
  assert.ok(textAfter1.includes('Staged build +1 1 ship(s)'), 'staging one Escort must add 1 MC and 1 ship');
  assert.ok(textAfter1.includes('1 ship(s) · +1 MC · floor 31.3'), 'verdict note must update with staged ships, MC and floor');
  assert.ok(root.innerHTML.includes('is-emphasis'), 'staged build metric must receive emphasis styling');

  // Reset button should now be present
  const resetButton = root.querySelector('[data-mc-reset]');
  assert.ok(resetButton, 'reset button must appear once ships are staged');

  // Click '-' on Escort (step = -1)
  const buttonsAfter1 = root.querySelectorAll('[data-mc-hull]');
  const escortMinus = buttonsAfter1.find(b => b.getAttribute('data-mc-hull') === 'Escort' && b.getAttribute('data-mc-step') === '-1');
  assert.ok(escortMinus, 'Escort - button must exist');
  escortMinus.click();

  let textAfterMinus = visibleText(root.innerHTML);
  assert.ok(textAfterMinus.includes('Staged build +0 0 ship(s)'), 'decrementing Escort must return staged count to 0');

  // Decrementing again when 0 must stay at 0
  const buttonsAfter0 = root.querySelectorAll('[data-mc-hull]');
  const escortMinus0 = buttonsAfter0.find(b => b.getAttribute('data-mc-hull') === 'Escort' && b.getAttribute('data-mc-step') === '-1');
  escortMinus0.click();
  assert.ok(visibleText(root.innerHTML).includes('Staged build +0 0 ship(s)'), 'count must not become negative');

  // Stage a Battleship (3 MC) and Frigate (2 MC)
  const buttonsNew = root.querySelectorAll('[data-mc-hull]');
  const bbPlus = buttonsNew.find(b => b.getAttribute('data-mc-hull') === 'Battleship' && b.getAttribute('data-mc-step') === '1');
  const ffPlus = buttonsNew.find(b => b.getAttribute('data-mc-hull') === 'Frigate' && b.getAttribute('data-mc-step') === '1');
  bbPlus.click();

  const buttonsAfterBB = root.querySelectorAll('[data-mc-hull]');
  const ffPlus2 = buttonsAfterBB.find(b => b.getAttribute('data-mc-hull') === 'Frigate' && b.getAttribute('data-mc-step') === '1');
  ffPlus2.click();

  let textMulti = visibleText(root.innerHTML);
  assert.ok(textMulti.includes('Staged build +5 2 ship(s)'), 'staging BB (3) and FF (2) must total +5 MC and 2 ships');

  // Click reset
  const resetBtnMulti = root.querySelector('[data-mc-reset]');
  assert.ok(resetBtnMulti, 'reset button must be present');
  resetBtnMulti.click();

  let textReset = visibleText(root.innerHTML);
  assert.ok(textReset.includes('Staged build +0 0 ship(s)'), 'clicking reset must clear staged build');
  assert.strictEqual(root.querySelector('[data-mc-reset]'), null, 'reset button must be removed after reset');
});

// ---------------------------------------------------------------------------
// 6. HULL ORDER FALLBACK
// ---------------------------------------------------------------------------

test('mc-budget falls back to object keys slice when none of canonical HULL_ORDER are present', () => {
  const customPayload = {
    economics: {
      applicable: true,
      usedMissionControl: 10,
      missionControlCapacity: 20,
      mcWarFloor: 50,
      difficultyMultiplier: 0.3,
      concealmentMultiplier: 1.0
    },
    shipHullStats: {
      CustomHullAlpha: { missionControl: 1, baseConstructionTimeDays: 30 },
      CustomHullBeta: { missionControl: 4, baseConstructionTimeDays: 100 }
    }
  };

  const html = renderToString(customPayload);
  const text = visibleText(html);

  assert.ok(text.includes('CustomHullAlpha 1 MC · 30d'), 'CustomHullAlpha must be rendered');
  assert.ok(text.includes('CustomHullBeta 4 MC · 100d'), 'CustomHullBeta must be rendered');
  assertNoPlaceholderText(html, 'custom hull stats payload');
});
