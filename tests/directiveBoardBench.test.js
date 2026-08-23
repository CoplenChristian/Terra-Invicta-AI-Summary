/**
 * The v2 directive board's BENCH section.
 *
 * One defect is pinned here, and it shipped: the board carried its own
 * `BENCHED_RENDER_LIMIT = 5` and sliced the engine's eight rows a second time,
 * in generation order. It was a truncation stacked on a truncation, announced
 * by neither -- and it was correct by luck: measured 2026-08-22 on the frozen
 * `ExitSave.gz`, the five it happened to show were the best five in both modes.
 *
 * The engine's selection (`shared/benchSelection.mjs`) is now the ONLY
 * selection and the board renders every row it is handed. The comparator is
 * deliberately not reimplemented here: these components are classic `<script>`
 * tags with no `type="module"`, so they cannot import `shared/*.mjs` at all,
 * and a hand-copied rule is a rule waiting to drift.
 *
 * Each row now stands for a whole (mission, target) sibling group, so the rest
 * of this file is about the other half of that: eight rows must never read as
 * eight options, and an older payload that carries no group fields must render
 * as plain rows rather than as "+0 more" or "+undefined more".
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const componentPath = path.join(repoRoot, 'public', 'v2', 'js', 'components', 'directive-board.js');
const stylesheetPath = path.join(repoRoot, 'public', 'v2', 'css', 'mission-control.css');

const { visibleText, runComponent } = require('./fixtures/renderHarness');

function loadBoard() {
  return runComponent(componentPath, {
    document: { getElementById: () => null }
  }).window.MissionControlDirectiveBoard;
}

/** The board attaches listeners after writing innerHTML, so the root needs both. */
function renderToString(cyclePlan) {
  const board = loadBoard();
  const root = {
    innerHTML: '',
    querySelector: () => null,
    querySelectorAll: () => []
  };
  board.render(root, { engineDirectives: { cyclePlan } });
  return root.innerHTML;
}

const BENCH_SECTION = /BENCHED ALTERNATIVES[\s\S]*?(?=ALLOCATION STRATEGY|$)/;
const benchText = (html) => (visibleText(html).match(BENCH_SECTION) || [''])[0];

/** A row as `shared/benchSelection.mjs` emits it. */
function row(i, overrides = {}) {
  return {
    candidateId: `bench-${i}`,
    title: `Purge the Protectorate hold on Sector ${i} in Nation ${i}`,
    score: 68.75 - i,
    riskFloorHeld: false,
    displacedBy: 'Displaced by higher expected value allocation across team.',
    groupCount: 1,
    groupOmittedCount: 0,
    groupNote: null,
    groupScoreLow: 68.75 - i,
    groupScoreHigh: 68.75 - i,
    groupRiskFloorHeldCount: 0,
    ...overrides
  };
}

function planWithBench(benched, overrides = {}) {
  return {
    assignments: [],
    unassigned: [],
    clocks: [],
    horizon: [],
    budgets: {},
    riskFloor: { percent: 0, inForce: false, configured: true },
    benched,
    benchedTotalCount: 427,
    benchedOmittedCount: 427 - benched.length,
    benchedRepresentedCount: benched.reduce((sum, b) => sum + (b.groupCount || 1), 0),
    ...overrides
  };
}

// The engine's own cap is 8, so eight is the live maximum -- and it is above the
// 5 the board used to impose, which is what makes this test the regression pin.
const EIGHT_ROWS = Array.from({ length: 8 }, (_, i) => row(i));

test('the board renders EVERY row the engine sent, not a slice of them', () => {
  const html = renderToString(planWithBench(EIGHT_ROWS));
  const text = benchText(html);

  for (const b of EIGHT_ROWS) {
    assert.ok(text.includes(b.title), `row "${b.title}" must reach the reader`);
  }
  // Counted as well as spotted, so dropping one row cannot hide behind a
  // substring match on the others.
  assert.strictEqual(
    (html.match(/class="directive-benched-item"/g) || []).length,
    8,
    'eight rows in means eight rows out'
  );
});

test('the board holds no bench cap of its own', () => {
  // A "renders all 8" assertion alone would still pass if someone reintroduced
  // a second cap set to 10. This is the structural half of the same guard.
  const source = fs.readFileSync(componentPath, 'utf8');
  // A DECLARATION, not the word: the header still names the removed constant
  // so a later reader knows why the board deliberately does not decide.
  assert.ok(!/(?:const|let|var)\s+BENCHED_RENDER_LIMIT/.test(source),
    'the board must not carry a render-side bench cap');
  const renderBenchedBody = source.slice(
    source.indexOf('function renderBenched'),
    source.indexOf('function renderHorizon')
  );
  assert.ok(renderBenchedBody.length > 0, 'renderBenched must still exist for this guard to mean anything');
  assert.ok(!/\.slice\(/.test(renderBenchedBody),
    'renderBenched must not slice the array the engine handed it');
});

test('a collapsed row prints what it stands for', () => {
  const collapsed = row(0, {
    groupCount: 5,
    groupOmittedCount: 4,
    groupNote: '+4 more Purge options in China, all scoring 68.75',
    groupScoreLow: 68.75,
    groupScoreHigh: 68.75
  });
  const text = benchText(renderToString(planWithBench([collapsed, row(1)])));

  assert.ok(text.includes('+4 more Purge options in China, all scoring 68.75'),
    `the group note must reach the reader: ${text}`);
});

test('a singleton row prints no group line at all — never "+0 more", never "undefined"', () => {
  const html = renderToString(planWithBench(EIGHT_ROWS));
  const text = benchText(html);

  assert.ok(!/\+0 more/.test(text), 'a singleton must not claim siblings it does not have');
  assert.ok(!/undefined/.test(text), text);
  assert.ok(!/NaN/.test(text), text);
  assert.strictEqual(
    (html.match(/class="directive-benched-group"/g) || []).length,
    0,
    'no row here is collapsed, so no group line should be emitted'
  );
});

test('an older payload with no group fields renders as plain rows', () => {
  // Exactly the shape a snapshot published before this change carries: no
  // `groupCount`, no `groupNote`, no `benchedRepresentedCount`.
  const legacy = [0, 1, 2].map((i) => ({
    candidateId: `legacy-${i}`,
    title: `Legacy alternative ${i}`,
    score: 10 - i,
    riskFloorHeld: false,
    displacedBy: 'Displaced by higher expected value allocation across team.'
  }));
  const plan = planWithBench(legacy);
  delete plan.benchedRepresentedCount;

  const html = renderToString(plan);
  const text = benchText(html);

  assert.strictEqual((html.match(/class="directive-benched-item"/g) || []).length, 3);
  assert.ok(!/undefined/.test(text), text);
  assert.ok(!/\+0 more/.test(text), text);
  assert.strictEqual((html.match(/class="directive-benched-group"/g) || []).length, 0);

  // Absent stays null: the represented count was never read, so the footer says
  // so rather than printing a confident zero.
  assert.ok(/unrecorded number of candidates/.test(text), text);
  assert.ok(!/standing for 0 candidates/.test(text), text);
});

test('the footer says how many CANDIDATES the rows stand for, so eight rows are not read as eight options', () => {
  const rows = [
    row(0, { groupCount: 5, groupOmittedCount: 4, groupNote: '+4 more Purge options in China, all scoring 68.75' }),
    row(1, { groupCount: 4, groupOmittedCount: 3, groupNote: '+3 more Purge options in India, all scoring 50.64' }),
    ...Array.from({ length: 6 }, (_, i) => row(i + 2))
  ];
  const text = benchText(renderToString(planWithBench(rows)));

  assert.ok(/Showing 8 rows of 427 benched/.test(text), text);
  assert.ok(/standing for 15 candidates/.test(text), text);
  assert.ok(/419 further alternatives are omitted/.test(text), text);
});

test('the group line has a stylesheet rule, so it is not invisible text', () => {
  const css = fs.readFileSync(stylesheetPath, 'utf8');
  assert.ok(/\.directive-benched-group\s*\{/.test(css),
    '.directive-benched-group must be styled, or the note renders unstyled');
});
