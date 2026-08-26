// tests/alienHateEconomicsRendering.test.js
//
// Purpose: characterisation coverage for AlienHateEconomics React panel and
//   imperative HUD render. Drives a real browser through the primitives harness.
//   The similarly named tests/alienHateEconomics.test.js covers the server/shared
//   calculation and never loads this browser component; this file records the
//   rendered answer.
//
// ENTRY-POINT CONTRACT (confirmed against mission-control.js call sites):
//   window.MissionControlHateEconomics = { render, renderHud }
//   render(root, economics) mounts AlienHateEconomics React panel into
//     #alienHateEconomics (THREAT view) from state.rawSnapshot.alienHateEconomics.
//   renderHud(root, economics, observerHate) receives #hudHateMeter in the top
//     HUD bar, the same economics object, and observerFaction.alienHate. It
//     mutates public/v2/index.html's shell-owned #hudHateFill, #hudHateFloor,
//     #hudHateValue, and #hudHateStatus in place.
//
// HUD REGISTRY EXCEPTION: #alienHateEconomics is in VIEWS; #hudHateMeter is
//   not. assertViewRegistryIntegrity() therefore protects the full panel mount
//   but cannot protect the HUD meter. The shell/call-site assertion below is
//   the explicit guard for that second mount.
//
// TRUNCATION: this payload has no *TotalCount / *OmittedCount pair and the
//   component does no slicing. Its one collection is reductionProjects; the
//   tests assert that all three applicable fixture records render and that the
//   one faction-inapplicable record is filtered.
//
// RED PROOF (2026-08-25): temporarily deleted the UNKNOWN sentinel handling from
//   renderHudAlienHateEconomics (`estimate === 'UNKNOWN'`), reverting to the
//   pre-fix condition (`!estimate || estimate === 'UNAVAILABLE'`). Running only
//   this file went red with failure on test "HUD treats literal UNKNOWN as
//   unavailable, NOT as a green GAME ESTIMATE": it asserted tone 'is-safe' instead
//   of 'is-unknown' and rendered 'GAME ESTIMATE' instead of 'UNAVAILABLE'. The
//   guard was immediately restored; 21/21 tests pass.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

const { ensurePrimitivesHarnessBuilt } = require('./fixtures/ensurePrimitivesHarness.js');
const { visibleText } = require('./fixtures/renderHarness');
const { loadFixtureFilteredSnapshot } = require('./fixtures/frozenSnapshots');
require('./fixtures/alienHateEconomicsBrowser'); // triggers browser-driving pass classifier

const repoRoot = path.resolve(__dirname, '..');
const controllerPath = path.join(repoRoot, 'public', 'v2', 'js', 'mission-control.js');
const shellPath = path.join(repoRoot, 'public', 'v2', 'index.html');
const OBSERVER = 4712;
const HARNESS_PATH = '/v2/primitives-harness.html';

let server;
let browser;
let page;

before(async () => {
  ensurePrimitivesHarnessBuilt();
  const app = require('../server/index.js');
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}${HARNESS_PATH}?scene=alienHateEconomics`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForSelector('#alienHateEconomics', { timeout: 15000 });
});

after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function snapshotFor(mode) {
  return loadFixtureFilteredSnapshot({ mode, observer: OBSERVER });
}

function economicsFor(mode) {
  return clone(snapshotFor(mode).alienHateEconomics);
}

function observerHateFor(snapshot) {
  const observer = snapshot.factions.find((faction) => String(faction.ID) === String(OBSERVER));
  assert.ok(observer, `the ${snapshot.mode} fixture must contain observer ${OBSERVER}`);
  return clone(observer.alienHate);
}

async function loadComponentKeys() {
  return await page.evaluate(() => {
    return Object.keys(window.MissionControlHateEconomics || {}).sort();
  });
}

async function renderFull(economics) {
  const { html, detailsCount, projectCount } = await page.evaluate(async (econ) => {
    let root = document.getElementById('test-render-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'test-render-root';
      document.body.appendChild(root);
    }
    window.MissionControlHateEconomics.render(root, econ);
    // Allow React 18 concurrent commit to finish
    await new Promise((resolve) => setTimeout(resolve, 30));
    const html = root.innerHTML;
    const detailsCount = root.querySelectorAll('details').length;
    const projectCount = root.querySelectorAll('.alien-hate-econ-project').length;
    return { html, detailsCount, projectCount };
  }, economics);

  const text = visibleText(html);
  return {
    html,
    text,
    root: {
      querySelectorAll(selector) {
        if (selector === 'details') return new Array(detailsCount);
        if (selector === '.alien-hate-econ-project') return new Array(projectCount);
        return [];
      },
    },
  };
}

function assertIncludesAll(text, fragments, label) {
  for (const fragment of fragments) {
    assert.ok(text.includes(fragment), `${label}: missing visible text ${JSON.stringify(fragment)}\n${text}`);
  }
}

const FORBIDDEN_RUNTIME_TEXT = ['null', 'undefined', 'NaN', '[object Object]'];

function assertNoRuntimePlaceholders(text, label) {
  for (const token of FORBIDDEN_RUNTIME_TEXT) {
    const index = text.indexOf(token);
    assert.strictEqual(
      index,
      -1,
      `${label}: rendered ${JSON.stringify(token)} near ${text.slice(Math.max(0, index - 60), index + 60)}`
    );
  }
}

function assertSharedFullPanel(text) {
  assertIncludesAll(text, [
    'Minimum hate 31.10 floor from used MC',
    'War threshold 50.00 alien threshold',
    'WHEN DOES HATE ACTUALLY VENT?',
    'not at Total War',
    'not Trespassing — at or beyond Jupiter',
    'actually targeted it. Kills made in self-defence vent nothing.',
    'a ship vents its hull Construction Tier',
    'divided by 3 on Normal',
    'random 0.8–1.2',
    'Hate gate 200',
    'Year gate 10 yrs 0.8 yrs to go',
    'Maximum hate 2,832 ceiling, grows yearly',
    "Year gate scaled by the save's Alien Progression Speed of 2.00×.",
    'Campaign age: measured: save TITimeState.daysInCampaign = 3346 (365.25 days/year).',
    'MISSION CONTROL USED MC DRIVES HATE · CAPACITY DOES NOT',
    'Used 162 space footprint',
    'Capacity 184 context only',
    'MC war floor 260.4 used MC at 50 hate',
    'CONCEALMENT MODIFIERS 2 ACTIVE',
    'Strategic Deception YES · ×0.80',
    'Maskirovka YES · ×0.80',
    'Operational Misdirection NO',
    'WHY? SHOW CALCULATION 162.00 × 0.30 × 0.64 = 31.10',
    'Only used Mission Control is multiplied by difficulty and the completed concealment projects.',
    'Mission Control capacity is shown for context and is excluded from this calculation.',
    'Minimum-hate headroom: 18.90 · Reduction multiplier: 0.64',
  ], 'shared full-panel contract');
}

async function renderHud(economics, observerHate) {
  const result = await page.evaluate(({ econ, obsHate }) => {
    let root = document.getElementById('testHudMeter');
    if (!root) {
      root = document.createElement('button');
      root.type = 'button';
      root.className = 'init-hud-hate';
      root.id = 'testHudMeter';
      document.body.appendChild(root);
    }
    root.className = 'init-hud-hate';
    root.removeAttribute('title');
    root.removeAttribute('aria-label');
    root.removeAttribute('aria-valuemin');
    root.removeAttribute('aria-valuemax');
    root.removeAttribute('aria-valuenow');
    root.innerHTML = `
      <span class="init-hud-hate__label">ALIEN HATE</span>
      <span class="init-hud-hate__track" aria-hidden="true">
        <span class="init-hud-hate__fill" id="hudHateFill"></span>
        <span class="init-hud-hate__floor" id="hudHateFloor" hidden></span>
        <span class="init-hud-hate__war" title="War threshold"></span>
      </span>
      <span class="init-hud-hate__reading">
        <strong id="hudHateValue">—</strong>
        <em id="hudHateStatus">UNAVAILABLE</em>
      </span>
    `;
    window.MissionControlHateEconomics.renderHud(root, econ, obsHate);

    const fill = root.querySelector('#hudHateFill');
    const floor = root.querySelector('#hudHateFloor');
    const valNode = root.querySelector('#hudHateValue');
    const statNode = root.querySelector('#hudHateStatus');
    const html = root.outerHTML;

    return {
      html,
      className: root.className,
      value: valNode ? valNode.textContent : '',
      status: statNode ? statNode.textContent : '',
      fillWidth: fill ? fill.style.width : '',
      floorHidden: floor ? floor.hidden : false,
      floorLeft: floor ? floor.style.left : '',
      floorTitle: floor ? floor.title : '',
      title: root.title,
      ariaLabel: root.getAttribute('aria-label'),
      ariaMin: root.getAttribute('aria-valuemin'),
      ariaMax: root.getAttribute('aria-valuemax'),
      ariaNow: root.getAttribute('aria-valuenow'),
    };
  }, { econ: economics, obsHate: observerHate });

  return {
    ...result,
    text: visibleText(result.html),
    root: { className: result.className },
  };
}

// ---------------------------------------------------------------------------
// 1. TWO ENTRY POINTS AND TWO DIFFERENT MOUNT CONTRACTS
// ---------------------------------------------------------------------------

test('component exposes exactly render and renderHud', async () => {
  const keys = await loadComponentKeys();
  assert.deepStrictEqual(keys, ['render', 'renderHud']);
});

test('the full panel is registered, while the static shell owns the unregistered HUD meter', () => {
  const controller = fs.readFileSync(controllerPath, 'utf8');
  const shell = fs.readFileSync(shellPath, 'utf8');
  const viewsStart = controller.indexOf('const VIEWS = [');
  const viewsEnd = controller.indexOf('\n];', viewsStart);
  assert.notStrictEqual(viewsStart, -1, 'mission-control.js must still declare VIEWS');
  assert.notStrictEqual(viewsEnd, -1, 'the VIEWS declaration must have a closing bracket');
  const views = controller.slice(viewsStart, viewsEnd);

  assert.ok(views.includes("'alienHateEconomics'"), '#alienHateEconomics must remain in VIEWS');
  assert.ok(!views.includes("'hudHateMeter'"), '#hudHateMeter is intentionally outside VIEWS');
  assert.match(
    controller,
    /MissionControlHateEconomics\.render\(\s*document\.getElementById\('alienHateEconomics'\),\s*state\.rawSnapshot\.alienHateEconomics\s*\);/,
    'the full render call must receive #alienHateEconomics and rawSnapshot.alienHateEconomics'
  );
  assert.match(
    controller,
    /MissionControlHateEconomics\.renderHud\(\s*document\.getElementById\('hudHateMeter'\),\s*state\.rawSnapshot\.alienHateEconomics,\s*observerFaction\?\.alienHate\s*\);/,
    'the HUD call must receive #hudHateMeter, economics, and observerFaction.alienHate'
  );

  const meter = shell.match(/<button[^>]*id="hudHateMeter"[\s\S]*?<\/button>/);
  assert.ok(meter, 'public/v2/index.html must mount #hudHateMeter');
  for (const childId of ['hudHateFill', 'hudHateFloor', 'hudHateValue', 'hudHateStatus']) {
    assert.ok(meter[0].includes(`id="${childId}"`), `the static HUD meter must own #${childId}`);
  }
});

test('renderHud mutates the shell-owned nodes in place instead of replacing or mounting them', async () => {
  const snapshot = snapshotFor('player');
  const result = await page.evaluate(({ econ, obsHate }) => {
    let root = document.getElementById('testHudMeterMutate');
    if (!root) {
      root = document.createElement('button');
      root.type = 'button';
      root.className = 'init-hud-hate';
      root.id = 'testHudMeterMutate';
      document.body.appendChild(root);
    }
    root.className = 'init-hud-hate';
    root.innerHTML = `
      <span class="init-hud-hate__label">ALIEN HATE</span>
      <span class="init-hud-hate__track" aria-hidden="true">
        <span class="init-hud-hate__fill" id="hudHateFill"></span>
        <span class="init-hud-hate__floor" id="hudHateFloor" hidden></span>
        <span class="init-hud-hate__war" title="War threshold"></span>
      </span>
      <span class="init-hud-hate__reading">
        <strong id="hudHateValue">—</strong>
        <em id="hudHateStatus">UNAVAILABLE</em>
      </span>
    `;
    const fillBefore = root.querySelector('#hudHateFill');
    const floorBefore = root.querySelector('#hudHateFloor');
    const valueBefore = root.querySelector('#hudHateValue');
    const statusBefore = root.querySelector('#hudHateStatus');
    const childCountBefore = root.children.length;

    window.MissionControlHateEconomics.renderHud(root, econ, obsHate);

    return {
      childCountPreserved: root.children.length === childCountBefore,
      fillSame: root.querySelector('#hudHateFill') === fillBefore,
      floorSame: root.querySelector('#hudHateFloor') === floorBefore,
      valueSame: root.querySelector('#hudHateValue') === valueBefore,
      statusSame: root.querySelector('#hudHateStatus') === statusBefore,
    };
  }, { econ: snapshot.alienHateEconomics, obsHate: observerHateFor(snapshot) });

  assert.ok(result.childCountPreserved, 'renderHud must preserve the meter subtree');
  assert.ok(result.fillSame, 'renderHud must preserve #hudHateFill');
  assert.ok(result.floorSame, 'renderHud must preserve #hudHateFloor');
  assert.ok(result.valueSame, 'renderHud must preserve #hudHateValue');
  assert.ok(result.statusSame, 'renderHud must preserve #hudHateStatus');
});

// ---------------------------------------------------------------------------
// 2. FULL PANEL: FROZEN PLAYER AND OMNISCIENT ANSWERS
// ---------------------------------------------------------------------------

test('full render, player mode: true hate is redacted and the game-visible estimate remains', async () => {
  const economics = snapshotFor('player').alienHateEconomics;
  const { root, html, text } = await renderFull(economics);

  assertIncludesAll(text, [
    'MINIMUM-HATE FLOOR BELOW PERMANENT-WAR FLOOR',
    'CURRENT HATE GAME-VISIBLE ESTIMATE',
    'Actual hate ■■■■□ game-visible estimate',
    'Hate vent capacity RAW-ONLY requires raw hate',
    'TOTAL WAR PROXIMITY YEAR GATE CLOSED',
    'Hate gate 200 current hate unknown',
    'Current hate is not exposed in this view.',
  ], 'player full render');
  assertSharedFullPanel(text);
  assert.ok(!text.includes('Actual hate 42.65'), 'player mode must not expose the raw save value');
  assert.ok(!text.includes('Hate vent capacity 11.54'), 'player mode cannot derive raw-only vent capacity');
  assert.ok(html.includes('alien-hate-econ-status is-safe">BELOW PERMANENT-WAR FLOOR'));
  assert.strictEqual(root.querySelectorAll('details').length, 2, 'both expandable explanations must render');
  assertNoRuntimePlaceholders(text, 'player full render');
});

test('full render, omniscient mode: raw hate, vent capacity, and both total-war gates render', async () => {
  const economics = snapshotFor('omniscient').alienHateEconomics;
  const { root, text } = await renderFull(economics);

  assertIncludesAll(text, [
    'MINIMUM-HATE FLOOR BELOW PERMANENT-WAR FLOOR',
    'CURRENT HATE BELOW WAR THRESHOLD',
    'Actual hate 42.65 raw save value',
    'Hate vent capacity 11.54 conditional · ±20%',
    'TOTAL WAR PROXIMITY BOTH GATES CLOSED',
    'Hate gate 200 157.4 to go',
  ], 'omniscient full render');
  assertSharedFullPanel(text);
  assert.ok(!text.includes('■■■■□'), 'the omniscient panel must prefer raw hate over the pip estimate');
  assert.ok(!text.includes('Current hate is not exposed in this view.'));
  assert.strictEqual(root.querySelectorAll('.alien-hate-econ-project').length, 3);
  assertNoRuntimePlaceholders(text, 'omniscient full render');
});

test('the project collection is complete, applicable-only, and not silently truncated', async () => {
  const economics = economicsFor('omniscient');
  const applicable = economics.reductionProjects.filter((project) => project.applicable);
  const { root, text } = await renderFull(economics);

  assert.strictEqual(economics.reductionProjects.length, 4, 'fixture must retain the full source collection');
  assert.strictEqual(applicable.length, 3, 'fixture must retain three applicable records');
  assert.strictEqual(
    root.querySelectorAll('.alien-hate-econ-project').length,
    applicable.length,
    'every applicable project must get a row; there is no display cap'
  );
  for (const project of applicable) assert.ok(text.includes(project.label), `${project.label} must render`);
  assert.ok(!text.includes('Operational Security'), 'the faction-inapplicable project must remain filtered');
  assert.deepStrictEqual(
    Object.keys(economics).filter((key) => /(?:Total|Omitted)Count$/.test(key)),
    [],
    'this component payload has no truncation-count pair today'
  );
});

// ---------------------------------------------------------------------------
// 3. FULL PANEL: EMPTY, ABSENT, AND EVERY NO-DATA AFFORDANCE
// ---------------------------------------------------------------------------

test('full render keeps absent input and an empty object observably different', async () => {
  const noOp = await page.evaluate(() => {
    try {
      window.MissionControlHateEconomics.render(null, {});
      return true;
    } catch {
      return false;
    }
  });
  assert.ok(noOp, 'an absent root is a no-op');

  const absent = await renderFull(undefined);
  const explicitNull = await renderFull(null);
  const empty = await renderFull({});
  const notApplicable = await renderFull({ applicable: false, factionName: 'the Academy' });

  assert.strictEqual(absent.text, 'ALIEN HATE ECONOMICS UNAVAILABLE');
  assert.strictEqual(explicitNull.text, 'ALIEN HATE ECONOMICS UNAVAILABLE');
  assert.strictEqual(
    empty.text,
    'MINIMUM HATE FLOOR NOT APPLICABLE The alien Mission Control floor does not apply to this faction.'
  );
  assert.strictEqual(
    notApplicable.text,
    'MINIMUM HATE FLOOR NOT APPLICABLE The alien Mission Control floor does not apply to the Academy.'
  );
});

test('each nullable full-panel metric gets its own contextual assertion among measured neighbors', async () => {
  const cases = [
    {
      path: ['minimumFloorStatus'],
      expected: ['MINIMUM-HATE FLOOR UNAVAILABLE CURRENT HATE BELOW WAR THRESHOLD'],
    },
    {
      path: ['currentWarStatus'],
      expected: ['CURRENT HATE UNAVAILABLE', 'Actual hate 42.65 raw save value'],
    },
    {
      path: ['actualAlienHate'],
      expected: [
        'Actual hate UNAVAILABLE requires available alien threat intel',
        'Hate vent capacity RAW-ONLY requires raw hate',
        'Minimum hate 31.10 floor from used MC',
      ],
    },
    {
      path: ['minimumAlienHate'],
      expected: ['Actual hate 42.65 raw save value', 'Minimum hate UNAVAILABLE floor from used MC'],
    },
    {
      path: ['hateAboveFloor'],
      expected: ['Hate vent capacity UNAVAILABLE conditional · ±20%', 'War threshold 50.00 alien threshold'],
    },
    {
      path: ['warThreshold'],
      expected: ['War threshold UNAVAILABLE alien threshold', 'Minimum hate 31.10 floor from used MC'],
    },
    {
      path: ['usedMissionControl'],
      expected: ['Used UNAVAILABLE space footprint', 'Capacity 184 context only'],
    },
    {
      path: ['missionControlCapacity'],
      expected: ['Used 162 space footprint', 'Capacity UNAVAILABLE context only'],
    },
    {
      path: ['mcWarFloor'],
      expected: ['MC war floor UNAVAILABLE used MC at 50 hate', 'Capacity 184 context only'],
    },
    {
      path: ['formula'],
      expected: ['WHY? SHOW CALCULATION UNAVAILABLE', 'Minimum-hate headroom: 18.90'],
    },
    {
      path: ['minimumHateHeadroom'],
      expected: ['Minimum-hate headroom: UNAVAILABLE · Reduction multiplier: 0.64'],
    },
    {
      path: ['concealmentMultiplier'],
      expected: ['Minimum-hate headroom: 18.90 · Reduction multiplier: UNAVAILABLE'],
    },
    {
      path: ['completedReductionProjectCount'],
      expected: ['CONCEALMENT MODIFIERS 0 ACTIVE', 'Strategic Deception YES · ×0.80'],
    },
    {
      path: ['totalWar', 'hateThreshold'],
      expected: ['Hate gate UNAVAILABLE 157.4 to go', 'Year gate 10 yrs 0.8 yrs to go'],
    },
    {
      path: ['totalWar', 'hateRemaining'],
      expected: ['Hate gate 200 current hate unknown', 'Year gate 10 yrs 0.8 yrs to go'],
    },
    {
      path: ['totalWar', 'yearsThreshold'],
      expected: ['Year gate UNAVAILABLE yrs 0.8 yrs to go', 'Hate gate 200 157.4 to go'],
    },
    {
      path: ['totalWar', 'yearsRemaining'],
      expected: ['Year gate 10 yrs duration unknown', 'Hate gate 200 157.4 to go'],
    },
    {
      path: ['totalWar', 'maximumAlienHate'],
      expected: ['Maximum hate UNAVAILABLE ceiling, grows yearly', 'Year gate 10 yrs 0.8 yrs to go'],
    },
    {
      path: ['totalWar', 'alienProgressionSpeed'],
      expected: ["Year gate scaled by the save's Alien Progression Speed of UNAVAILABLE×."],
    },
  ];

  for (const scenario of cases) {
    const economics = economicsFor('omniscient');
    let target = economics;
    for (const key of scenario.path.slice(0, -1)) target = target[key];
    target[scenario.path.at(-1)] = null;
    const { text } = await renderFull(economics);
    assertIncludesAll(text, scenario.expected, `null ${scenario.path.join('.')}`);
    assertNoRuntimePlaceholders(text, `null ${scenario.path.join('.')}`);
  }
});

test('explicit UNAVAILABLE estimates and absent total-war remainder fields keep their distinct copy', async () => {
  const unavailableEstimateEconomics = economicsFor('player');
  unavailableEstimateEconomics.visibleHateEstimate = 'UNAVAILABLE';
  const unavailableEstimate = await renderFull(unavailableEstimateEconomics);
  assert.ok(
    unavailableEstimate.text.includes('Actual hate UNAVAILABLE game-visible estimate'),
    'a literal UNAVAILABLE estimate is still labelled as a game-visible estimate today'
  );
  assert.ok(unavailableEstimate.text.includes('Hate vent capacity RAW-ONLY requires raw hate'));

  const noHateRemainderEconomics = economicsFor('omniscient');
  delete noHateRemainderEconomics.totalWar.hateRemaining;
  const noHateRemainder = await renderFull(noHateRemainderEconomics);
  assert.ok(
    noHateRemainder.text.includes('Hate gate 200 UNAVAILABLE to go'),
    'an absent hateRemaining differs from an explicit null, which says current hate unknown'
  );
  assert.ok(noHateRemainder.text.includes('Year gate 10 yrs 0.8 yrs to go'));

  const noYearRemainderEconomics = economicsFor('omniscient');
  delete noYearRemainderEconomics.totalWar.yearsRemaining;
  const noYearRemainder = await renderFull(noYearRemainderEconomics);
  assert.ok(
    noYearRemainder.text.includes('Year gate 10 yrs UNAVAILABLE yrs to go'),
    'an absent yearsRemaining differs from an explicit null, which says duration unknown'
  );
  assert.ok(noYearRemainder.text.includes('Hate gate 200 157.4 to go'));
});

test('a partial render keeps measured values beside independently absent values', async () => {
  const economics = economicsFor('omniscient');
  economics.minimumAlienHate = null;
  economics.missionControlCapacity = null;
  economics.totalWar.yearsRemaining = null;
  const { text } = await renderFull(economics);

  assertIncludesAll(text, [
    'Actual hate 42.65 raw save value',
    'Minimum hate UNAVAILABLE floor from used MC',
    'Used 162 space footprint',
    'Capacity UNAVAILABLE context only',
    'Hate gate 200 157.4 to go',
    'Year gate 10 yrs duration unknown',
    'MC war floor 260.4 used MC at 50 hate',
  ], 'mixed measured/unavailable render');
  assert.ok(!text.includes('ALIEN HATE ECONOMICS UNAVAILABLE'), 'partial data must not collapse to the absent-input banner');
  assertNoRuntimePlaceholders(text, 'mixed measured/unavailable render');
});

test('UNKNOWN, RAW-ONLY, an empty project list, and omitted optional sections are each explicit', async () => {
  const unknownEconomics = economicsFor('player');
  unknownEconomics.visibleHateEstimate = 'UNKNOWN';
  const unknown = await renderFull(unknownEconomics);
  assert.ok(unknown.text.includes('Actual hate UNKNOWN game-visible estimate'));
  assert.ok(unknown.text.includes('Hate vent capacity RAW-ONLY requires raw hate'));

  const noProjectsEconomics = economicsFor('omniscient');
  noProjectsEconomics.reductionProjects = null;
  const noProjects = await renderFull(noProjectsEconomics);
  assert.ok(noProjects.text.includes('CONCEALMENT MODIFIERS 2 ACTIVE NO APPLICABLE PROJECT MODIFIERS'));

  const noTotalWarEconomics = economicsFor('omniscient');
  noTotalWarEconomics.totalWar = null;
  const noTotalWar = await renderFull(noTotalWarEconomics);
  assert.ok(!noTotalWar.text.includes('TOTAL WAR PROXIMITY'), 'a null totalWar object omits its section today');
  assert.ok(noTotalWar.text.includes('MISSION CONTROL USED MC DRIVES HATE'));

  const noAgeSourceEconomics = economicsFor('omniscient');
  noAgeSourceEconomics.yearsElapsedSource = null;
  const noAgeSource = await renderFull(noAgeSourceEconomics);
  assert.ok(!noAgeSource.text.includes('Campaign age:'), 'a null age source omits only the age caveat');
  assert.ok(noAgeSource.text.includes("Year gate scaled by the save's Alien Progression Speed"));

  const assumedSpeedEconomics = economicsFor('omniscient');
  assumedSpeedEconomics.totalWar.progressionSpeedAssumed = null;
  const assumedSpeed = await renderFull(assumedSpeedEconomics);
  assert.ok(assumedSpeed.text.includes('Assumes default Alien Progression Speed; this snapshot carries no campaign-settings block to read it from.'));
});

test('every total-war state label and explanatory note remains visible', async () => {
  const states = [
    ['active', 'TOTAL WAR DECLARED', 'Hate venting is severely restricted. This war is effectively permanent.', 'is-danger'],
    ['armed', 'ARMED — HATE GATE ONLY', 'The year gate has passed. Only the hate ceiling now prevents total war.', 'is-warning'],
    ['pending', 'PENDING — YEAR GATE ONLY', 'Hate is already past 200. Total war lands the moment the years elapse.', 'is-warning'],
    ['safe', 'BOTH GATES CLOSED', null, 'is-safe'],
    ['armed_hate_unknown', 'ARMED — HATE UNKNOWN', 'The year gate has passed; current hate is not exposed in this view.', 'is-warning'],
    ['safe_hate_unknown', 'YEAR GATE CLOSED', 'Current hate is not exposed in this view.', null],
    ['future_state', 'UNAVAILABLE', 'Campaign duration or difficulty missing from this snapshot.', null],
  ];

  for (const [state, label, note, tone] of states) {
    const economics = economicsFor('omniscient');
    economics.totalWar.state = state;
    const { html, text } = await renderFull(economics);
    assert.ok(text.includes(`TOTAL WAR PROXIMITY ${label}`), `${state} label must render`);
    if (note) assert.ok(text.includes(note), `${state} note must render`);
    if (tone) {
      assert.ok(
        html.includes(`alien-hate-econ-status ${tone}">${label}`),
        `${state} must retain ${tone}`
      );
    }
  }
});

test('total war blocks the otherwise measured vent capacity with a danger affordance', async () => {
  const economics = economicsFor('omniscient');
  economics.ventingBlockedByTotalWar = true;
  const { html, text } = await renderFull(economics);
  assert.ok(text.includes('Hate vent capacity VOIDED total war — venting restricted'));
  assert.ok(html.includes('alien-hate-econ-metric is-danger'));
});

// ---------------------------------------------------------------------------
// 4. HUD: FROZEN MODES, STATUS LADDERS, AND ALL NO-DATA OUTPUTS
// ---------------------------------------------------------------------------

test('HUD player mode renders the four-pip estimate, floor marker, and warning metadata', async () => {
  const snapshot = snapshotFor('player');
  const hud = await renderHud(snapshot.alienHateEconomics, observerHateFor(snapshot));

  assert.strictEqual(hud.text, 'ALIEN HATE ■■■■□ HIGH ESTIMATE');
  assert.strictEqual(hud.className, 'init-hud-hate is-warning');
  assert.strictEqual(hud.value, '■■■■□');
  assert.strictEqual(hud.status, 'HIGH ESTIMATE');
  assert.strictEqual(hud.fillWidth, '80%');
  assert.strictEqual(hud.floorHidden, false);
  assert.ok(
    hud.floorLeft.startsWith('62.208%') || hud.floorLeft.startsWith('62.208000000000006%'),
    `floorLeft should be 62.208%, got ${hud.floorLeft}`
  );
  assert.strictEqual(hud.floorTitle, 'Minimum hate floor 31.1');
  assert.strictEqual(hud.title, 'Alien hate ■■■■□ · HIGH ESTIMATE · MC floor 31.1 · Open full hate economics');
  assert.strictEqual(hud.ariaLabel, 'Alien hate ■■■■□, HIGH ESTIMATE. Open full economics.');
  assert.strictEqual(hud.ariaMin, '0');
  assert.strictEqual(hud.ariaMax, '50');
  assert.strictEqual(hud.ariaNow, '40');
});

test('HUD omniscient mode renders raw hate, threshold denominator, and rounded ARIA value', async () => {
  const snapshot = snapshotFor('omniscient');
  const hud = await renderHud(snapshot.alienHateEconomics, observerHateFor(snapshot));

  assert.strictEqual(hud.text, 'ALIEN HATE 43 / 50 APPROACHING WAR');
  assert.strictEqual(hud.className, 'init-hud-hate is-warning');
  assert.strictEqual(hud.value, '43 / 50');
  assert.strictEqual(hud.status, 'APPROACHING WAR');
  assert.strictEqual(hud.fillWidth, '85.295%');
  assert.strictEqual(hud.floorHidden, false);
  assert.ok(
    hud.floorLeft.startsWith('62.208%') || hud.floorLeft.startsWith('62.208000000000006%'),
    `floorLeft should be 62.208%, got ${hud.floorLeft}`
  );
  assert.strictEqual(hud.title, 'Alien hate 43 / 50 · APPROACHING WAR · MC floor 31.1 · Open full hate economics');
  assert.strictEqual(hud.ariaLabel, 'Alien hate 43 / 50, APPROACHING WAR. Open full economics.');
  assert.strictEqual(hud.ariaMin, '0');
  assert.strictEqual(hud.ariaMax, '50');
  assert.strictEqual(hud.ariaNow, '43');
});

test('HUD actual-hate ladder distinguishes threshold, permanent floor, warning, and safe states', async () => {
  const cases = [
    [{ actualAlienHate: 50, minimumAlienHate: 10 }, '50 / 50', 'WAR THRESHOLD', 'is-danger', '100%'],
    [{ actualAlienHate: 10, minimumAlienHate: 50 }, '10 / 50', 'PERM. WAR FLOOR', 'is-danger', '20%'],
    [{ actualAlienHate: 35, minimumAlienHate: 10 }, '35 / 50', 'APPROACHING WAR', 'is-warning', '70%'],
    [{ actualAlienHate: 5.25, minimumAlienHate: 1 }, '5.3 / 50', 'BELOW WAR', 'is-safe', '10.5%'],
  ];

  for (const [values, expectedValue, expectedStatus, tone, width] of cases) {
    const hud = await renderHud({ applicable: true, warThreshold: 50, ...values }, null);
    assert.strictEqual(hud.value, expectedValue);
    assert.strictEqual(hud.status, expectedStatus);
    assert.ok(hud.className.split(/\s+/).includes(tone));
    assert.strictEqual(hud.fillWidth, width);
  }
});

test('HUD estimate ladder derives pip counts when the explicit count is absent', async () => {
  const maximum = await renderHud(
    { applicable: true, actualAlienHate: null, minimumAlienHate: 10, warThreshold: 50 },
    { visibleEstimate: '■■■■■' }
  );
  assert.strictEqual(maximum.status, 'MAX ESTIMATE');
  assert.ok(maximum.className.includes('is-danger'));
  assert.strictEqual(maximum.fillWidth, '100%');
  assert.strictEqual(maximum.ariaNow, '50');

  const ordinary = await renderHud(
    { applicable: true, actualAlienHate: null, minimumAlienHate: 10, warThreshold: 50 },
    { visibleEstimate: '■■■□□' }
  );
  assert.strictEqual(ordinary.status, 'GAME ESTIMATE');
  assert.ok(ordinary.className.includes('is-safe'));
  assert.strictEqual(ordinary.fillWidth, '60%');
  assert.strictEqual(ordinary.ariaNow, '30');
});

test('HUD null metrics are isolated: pips fall back, floor hides, and threshold falls back to 50', async () => {
  const player = snapshotFor('player');
  const nullPips = observerHateFor(player);
  nullPips.pips = null;
  const pipsFallback = await renderHud(player.alienHateEconomics, nullPips);
  assert.strictEqual(pipsFallback.value, '■■■■□');
  assert.strictEqual(pipsFallback.status, 'HIGH ESTIMATE');
  assert.strictEqual(pipsFallback.ariaNow, '40');

  const omniEconomics = economicsFor('omniscient');
  omniEconomics.minimumAlienHate = null;
  const noFloor = await renderHud(omniEconomics, observerHateFor(snapshotFor('omniscient')));
  assert.strictEqual(noFloor.value, '43 / 50', 'measured hate must survive a null floor');
  assert.strictEqual(noFloor.floorHidden, true);
  assert.strictEqual(noFloor.floorLeft, '');
  assert.ok(!noFloor.title.includes('MC floor'), 'the title must omit an unmeasured floor');

  const noThresholdEconomics = economicsFor('omniscient');
  noThresholdEconomics.warThreshold = null;
  const fallbackThreshold = await renderHud(noThresholdEconomics, observerHateFor(snapshotFor('omniscient')));
  assert.strictEqual(fallbackThreshold.value, '43 / 50', 'a null HUD threshold currently falls back to 50');
  assert.strictEqual(fallbackThreshold.ariaMax, '50');
  assert.strictEqual(fallbackThreshold.fillWidth, '85.295%');
});

test('HUD enumerates UNAVAILABLE, INTEL GATED, and NOT APPLICABLE including the em dash', async () => {
  const playerEconomics = economicsFor('player');
  const unavailable = await renderHud(playerEconomics, { visibleEstimate: 'UNAVAILABLE' });
  assert.strictEqual(unavailable.text, 'ALIEN HATE UNAVAILABLE UNAVAILABLE');
  assert.strictEqual(unavailable.className, 'init-hud-hate is-unknown');
  assert.strictEqual(unavailable.fillWidth, '0%');
  assert.strictEqual(unavailable.floorHidden, true);
  assert.strictEqual(unavailable.ariaNow, null);

  playerEconomics.visibleHateEstimate = null;
  const gated = await renderHud(playerEconomics, { visibleEstimate: null, requiredProject: 'Project_TheirOperations' });
  assert.strictEqual(gated.text, 'ALIEN HATE UNAVAILABLE INTEL GATED');
  assert.strictEqual(gated.className, 'init-hud-hate is-unknown');
  assert.strictEqual(gated.fillWidth, '0%');
  assert.strictEqual(gated.floorHidden, true);
  assert.strictEqual(gated.ariaNow, null);

  const notApplicable = await renderHud({ applicable: false }, null);
  assert.strictEqual(notApplicable.text, 'ALIEN HATE — NOT APPLICABLE');
  assert.strictEqual(notApplicable.value, '—');
  assert.strictEqual(notApplicable.status, 'NOT APPLICABLE');
  assert.strictEqual(notApplicable.className, 'init-hud-hate is-unknown');
  assert.strictEqual(notApplicable.fillWidth, '0%');
  assert.strictEqual(notApplicable.floorHidden, true);
  assert.strictEqual(notApplicable.ariaNow, null);
});

test('HUD absent and empty economics both use the same unavailable fallback', async () => {
  const absent = await renderHud(undefined, undefined);
  const empty = await renderHud({}, {});
  assert.strictEqual(absent.value, empty.value);
  assert.strictEqual(absent.status, empty.status);
  assert.strictEqual(absent.fillWidth, empty.fillWidth);
  assert.strictEqual(absent.floorHidden, empty.floorHidden);
  assert.strictEqual(absent.text, 'ALIEN HATE UNAVAILABLE UNAVAILABLE');
  assert.strictEqual(absent.className, 'init-hud-hate is-unknown');
  assert.strictEqual(absent.ariaMax, '50');
  assert.strictEqual(absent.ariaNow, null);
});

test('HUD treats literal UNKNOWN as unavailable, NOT as a green GAME ESTIMATE', async () => {
  // renderHud used to derive `unavailable` from `(numeric === null && (!estimate || estimate === 'UNAVAILABLE'))`.
  // That gate treated 'UNAVAILABLE' and any other unmeasured sentinel the same
  // way — except 'UNKNOWN', which is truthy and bypassed the gate. The result
  // was a green `GAME ESTIMATE` HUD for a value the snapshot had explicitly
  // flagged as unknown, with the wrong fill state and a misleading aria-label.
  // The sibling helper pipCount at L227 already treats both sentinels the same
  // way (`if (!text || text === 'UNAVAILABLE' || text === 'UNKNOWN') return null`);
  // the fix brings renderHud's availability gate in line with that.
  const economics = economicsFor('player');

  // UNKNOWN with no project gate: must render the same unavailable surface as
  // a declared UNAVAILABLE — same text, same tone, same fill, same aria.
  // Both probes come from a real renderHud run after the fix; the assertion
  // pins the corrected behaviour and the distinctness from the old green
  // GAME ESTIMATE (regression guard).
  const unknown = await renderHud(economics, { visibleEstimate: 'UNKNOWN' });
  assert.strictEqual(unknown.text, 'ALIEN HATE UNAVAILABLE UNAVAILABLE',
    'an explicit visibleEstimate: "UNKNOWN" must render the same UNAVAILABLE surface as "UNAVAILABLE"');
  assert.strictEqual(unknown.value, 'UNAVAILABLE');
  assert.strictEqual(unknown.status, 'UNAVAILABLE');
  assert.strictEqual(unknown.className, 'init-hud-hate is-unknown',
    'an unknown hate must NOT carry the is-safe tone');
  assert.ok(!unknown.className.split(/\s+/).includes('is-safe'),
    'regression guard: the bug surfaced as `is-safe`; that class must not return');
  assert.strictEqual(unknown.fillWidth, '0%');
  assert.strictEqual(unknown.floorHidden, true,
    'the floor marker must hide when the value is unknown — the bug pinned `false`');
  assert.strictEqual(unknown.ariaNow, null,
    'an unknown value must NOT advertise a numeric aria-valuenow');
  assert.strictEqual(unknown.ariaLabel, 'Alien hate UNAVAILABLE, UNAVAILABLE. Open full economics.',
    'the aria-label must reflect the unavailable state, not a green estimate');

  // Cross-check: declared UNAVAILABLE produces the same surface. The two
  // sentinels are now indistinguishable in the HUD — same path, same output.
  const unavailable = await renderHud(economics, { visibleEstimate: 'UNAVAILABLE' });
  assert.strictEqual(unavailable.text, unknown.text);
  assert.strictEqual(unavailable.className, unknown.className);

  // UNKNOWN with a requiredProject: still unavailable, but the status pill
  // must reflect the gate, not collapse to a generic UNAVAILABLE. This is the
  // same path the explicit UNAVAILABLE+requiredProject test at line 669
  // covers, and UNKNOWN must take the same path — that's the second
  // distinction (unknown vs measured-safe is what #7 is about).
  const gatedUnknown = await renderHud(economics, { visibleEstimate: 'UNKNOWN', requiredProject: 'Project_TheirOperations' });
  assert.strictEqual(gatedUnknown.text, 'ALIEN HATE UNAVAILABLE INTEL GATED');
  assert.strictEqual(gatedUnknown.status, 'INTEL GATED');
  assert.strictEqual(gatedUnknown.className, 'init-hud-hate is-unknown');
  assert.strictEqual(gatedUnknown.fillWidth, '0%');
  assert.strictEqual(gatedUnknown.floorHidden, true);

  // Regression guard on the estimate ladder: a real pip estimate must still
  // take the safe branch and read as GAME ESTIMATE. The fix must not over-
  // correct and start sending measured estimates through the unavailable gate.
  const measured = await renderHud(economics, { visibleEstimate: '■■■□□' });
  assert.strictEqual(measured.status, 'GAME ESTIMATE',
    'a measured pip estimate must still read as GAME ESTIMATE');
  assert.ok(measured.className.split(/\s+/).includes('is-safe'),
    'a measured pip estimate must still carry the is-safe tone');
});
