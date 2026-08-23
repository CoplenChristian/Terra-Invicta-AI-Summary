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

// ---------------------------------------------------------------------------
// THE REASON A ROW GIVES, AND THE BUDGET THAT MAKES THE LIST INTERPRETABLE
//
// Until 2026-08-23 every row that was not risk-floor held rendered
// `Displaced by <first assignment's councilor> assigned to direct
// high-priority mission.` -- a fabricated attribution, measured wrong on all
// sixteen live rows across both modes. The board now renders whatever reason
// the engine measured, and refuses to invent one when the engine recorded none.
//
// The header is the other half: eight rows drawing on one budget are not eight
// independent options, and the number that says so has to arrive before the
// list rather than after it.
// ---------------------------------------------------------------------------

/** A row the engine refused on the alienHate budget, as `assignment.js` emits it. */
function budgetRefusedRow(i, overrides = {}) {
  return row(i, {
    displacementCause: 'budget',
    displacedBy: 'Displaced by the alienHate budget, not by a busy councilor — it charges 4.57 hate '
      + 'against 3.16 left of a 7.90 cycle cap (4.74 already committed), 1.41 short. Mahangeet Pakimor '
      + 'was free to run it, so freeing another operative does not make this affordable.',
    budgetRefusal: {
      pool: 'alienHate',
      charge: 4.57,
      chargeMeasured: true,
      cap: 7.9,
      used: 4.74,
      remaining: 3.16,
      shortfall: 1.41,
      unit: 'hate',
      councilorName: 'Mahangeet Pakimor'
    },
    groupBudgetDisplacedCount: 1,
    ...overrides
  });
}

const LIVE_BUDGET = Object.freeze({
  alienHate: {
    used: 4.74, cap: 7.9, capMeasured: true, unit: 'hate',
    headroom: 157.13747, currentHate: 42.86253,
    currentHateBasis: 'measured', capIsUpperBound: false
  }
});

const LIVE_BENCH_BUDGET = Object.freeze({
  rowCount: 8, pricedRowCount: 8, unpricedRowCount: 0,
  pools: ['alienHate'], pool: 'alienHate',
  jointlyAffordableCount: 0, jointlyAffordableIsUpperBound: true,
  cap: 7.9, used: 4.74, remaining: 3.16, unit: 'hate', capMeasured: true,
  reason: '0 of the 8 row(s) shown fit the 3.16 hate left of a 7.9 cycle cap.'
});

test('the board prints the reason the engine measured, not a councilor it made up', () => {
  const rows = Array.from({ length: 8 }, (_, i) => budgetRefusedRow(i));
  const text = benchText(renderToString(planWithBench(rows, {
    budgets: LIVE_BUDGET,
    benchBudget: LIVE_BENCH_BUDGET,
    assignments: [{ councilorId: 5797, councilor: { name: 'Hemaraj Pavanaja' }, candidate: { title: 'Purge China' } }]
  })));

  assert.ok(/REFUSED BY BUDGET/.test(text), `a budget refusal must be labelled as one: ${text}`);
  assert.ok(/alienHate budget/.test(text), text);
  assert.ok(/1\.41 short/.test(text), 'the shortfall must reach the reader');
  // The specific fabrication: the first assignment's councilor, blamed for a
  // refusal that had nothing to do with them.
  assert.ok(!/Hemaraj Pavanaja/.test(text),
    `an assigned councilor must not be blamed for a budget refusal: ${text}`);
  assert.ok(!/assigned to direct high-priority mission/.test(text), text);
});

test('a row with no recorded reason says so rather than borrowing the councilor sentence', () => {
  const bare = row(0);
  delete bare.displacedBy;
  const text = benchText(renderToString(planWithBench([bare])));

  assert.ok(/recorded no reason/i.test(text), `an absent reason must be stated: ${text}`);
  assert.ok(!/assigned to direct high-priority mission/.test(text), text);
  assert.ok(!/undefined/.test(text), text);
});

test('the bench header states the budget and how many rows fit it', () => {
  const rows = Array.from({ length: 8 }, (_, i) => budgetRefusedRow(i));
  const text = benchText(renderToString(planWithBench(rows, {
    budgets: LIVE_BUDGET,
    benchBudget: LIVE_BENCH_BUDGET
  })));

  assert.ok(/4\.74 \/ 7\.90 used/.test(text), `the pool state must be shown: ${text}`);
  assert.ok(/3\.16.*left/.test(text), text);
  assert.ok(/0 of 8 row\(s\) below fit/.test(text), `the joint answer must be shown: ${text}`);
  assert.ok(/ALTERNATIVES sharing one alienHate pool/.test(text), text);
});

test('a floor-derived hate cap is labelled an upper bound on the board', () => {
  // Player mode's live shape: the cap comes from the Mission Control hate floor
  // because the true hate is redacted, so it can only overstate the budget.
  const text = benchText(renderToString(planWithBench([row(0)], {
    budgets: {
      alienHate: {
        used: 0, cap: 8.5, capMeasured: true, unit: 'hate',
        headroom: 169.088, currentHate: 30.912,
        currentHateBasis: 'floor', capIsUpperBound: true
      }
    }
  })));

  assert.ok(/UPPER BOUND/.test(text), `an optimistic cap must not read as a measured one: ${text}`);
  assert.ok(/MC hate floor/.test(text), text);
});

test('an unmeasured hate cap says the check was skipped, never that the budget is zero', () => {
  const text = benchText(renderToString(planWithBench([row(0)], {
    budgets: {
      alienHate: {
        used: 0, cap: null, capMeasured: false, unit: 'hate',
        currentHate: null, currentHateBasis: null, capIsUpperBound: false
      }
    }
  })));

  assert.ok(/NOT MEASURED/.test(text), text);
  assert.ok(!/0\.00 \/ 0\.00/.test(text), 'an unread cap must never render as a measured zero');
});

test('an uncomputed joint total says NOT COMPUTED rather than implying every row fits', () => {
  const text = benchText(renderToString(planWithBench([row(0)], {
    budgets: LIVE_BUDGET,
    benchBudget: {
      rowCount: 1, pricedRowCount: 0, unpricedRowCount: 1, pools: [], pool: null,
      jointlyAffordableCount: null, jointlyAffordableIsUpperBound: null,
      cap: null, used: null, remaining: null, unit: null, capMeasured: null,
      reason: 'No bench row on this plan was refused by a budget, so their budgets were never tested.'
    }
  })));

  assert.ok(/NOT COMPUTED/.test(text), text);
  assert.ok(/never tested/.test(text), text);
  assert.ok(!/row\(s\) below fit/.test(text), 'no count may be asserted when none was computed');
});

test('an older payload with no bench budget renders no affordability claim at all', () => {
  const plan = planWithBench([row(0)]);
  delete plan.benchBudget;
  delete plan.budgets;
  const html = renderToString(plan);

  assert.strictEqual((html.match(/class="directive-bench-budget"/g) || []).length, 0,
    'nothing was read, so nothing is claimed');
  assert.ok(!/row\(s\) below fit/.test(visibleText(html)));
});

test('a MIXED group does not present the representative\'s reason as the whole group\'s', () => {
  const mixed = budgetRefusedRow(0, { groupCount: 5, groupOmittedCount: 4, groupBudgetDisplacedCount: 2 });
  const text = benchText(renderToString(planWithBench([mixed], {
    budgets: LIVE_BUDGET, benchBudget: LIVE_BENCH_BUDGET
  })));

  assert.ok(/Mixed group: 2 of 5/.test(text),
    `a group whose members differ must say so: ${text}`);

  // And a UNIFORM group must not raise the caveat, or it becomes noise nobody
  // reads on the one row where it matters.
  const uniform = budgetRefusedRow(0, { groupCount: 5, groupOmittedCount: 4, groupBudgetDisplacedCount: 5 });
  const uniformText = benchText(renderToString(planWithBench([uniform], {
    budgets: LIVE_BUDGET, benchBudget: LIVE_BENCH_BUDGET
  })));
  assert.ok(!/Mixed group/.test(uniformText), uniformText);
});

test('the new bench-budget elements have stylesheet rules, so they are not invisible text', () => {
  const css = fs.readFileSync(stylesheetPath, 'utf8');
  for (const rule of [
    'directive-bench-budget',
    'directive-bench-budget-unknown',
    'directive-bench-budget-caveat',
    'directive-benched-group-caveat'
  ]) {
    assert.ok(new RegExp(`\\.${rule}\\s*\\{`).test(css), `.${rule} must be styled`);
  }
});
