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
 * deliberately not reimplemented there, and a hand-copied rule is a rule
 * waiting to drift.
 *
 * Each row now stands for a whole (mission, target) sibling group, so the rest
 * of this file is about the other half of that: eight rows must never read as
 * eight options, and an older payload that carries no group fields must render
 * as plain rows rather than as "+0 more" or "+undefined more".
 *
 * The portfolio budget bar is pinned here too. An empty budget payload used to
 * fabricate four ceilings and their percentages; missing ceilings now remain
 * visibly unmeasured, while a measured zero remains a real zero.
 *
 * RED PROOF (2026-08-25): temporarily deleted the literal `NOT MEASURED` from
 * the ALIEN HATE BUDGET meter's unavailable `<strong>` branch. Running only
 * this file went red with 2 failures: the empty-budget `deepStrictEqual`
 * reported an empty alien-hate reading, and the three-state assertion
 * "an absent ceiling is not zero" received `''` instead of `NOT MEASURED`.
 * The component branch was restored immediately.
 *
 * ---------------------------------------------------------------------------
 * PORTED 2026-08-26 to the React panel. HARNESS CHANGED, ASSERTIONS DID NOT.
 * ---------------------------------------------------------------------------
 *
 * `public/v2/js/components/directive-board.js` was deleted in the React
 * migration, so the `runComponent(componentPath, ...)` sandbox this file used
 * would now die with ENOENT on all nineteen tests. Every assertion below is
 * byte-identical to the version that guarded the vanilla component; only the
 * plumbing that produces `html` moved. `node --test` cannot render React out of
 * the Vite bundle (three earlier runs died on `Minified React error #327`), so
 * the panel is driven in a real browser through the primitives harness.
 *
 * TWO plumbing edits were needed and neither weakens a check:
 *
 *   1. `renderToString` is now async and renders through the same
 *      `window.MissionControlDirectiveBoard.render(root, payload)` bridge that
 *      `public/v2/js/mission-control.js` calls. One shared page serves all
 *      nineteen tests; the root `after()` closes it.
 *   2. `budgetMeter` reads the `<strong>` with `([\s\S]*?)` through
 *      `visibleText` instead of `([^<]*)`. Register defect #1 was the four
 *      INVENTED ceilings in this meter, and the fix now routes each reading
 *      through the `<Value>` primitive, whose explicit presence signal is what
 *      makes `Number(null) === 0` structurally unreachable. `<Value>` renders a
 *      `<span data-value-state="…">` inside the `<strong>`, which `[^<]*`
 *      cannot cross. On the old markup the two extractions return the same
 *      strings, so the readings compared below are unchanged.
 *
 * The structural guard ("the board holds no bench cap of its own") now reads
 * `src/v2/panels/DirectiveBoard.jsx`. The React port keeps `renderBenched` and
 * `renderHorizon` as named functions in that order precisely so the guard still
 * has a window to scan.
 *
 * RED PROOF, RE-RUN ON THE PORT (2026-08-26). Two deliberate breaks, each
 * rebuilt into the harness before running:
 *   - `absentLabel="NOT MEASURED"` emptied on the budget meters -> the SAME 2
 *     failures the pre-migration proof recorded (the empty-budget
 *     `deepStrictEqual`, and "an absent ceiling is not zero").
 *   - `BENCH_ORDER_NOTE` replaced with "Ranked best first." -> 1 failure, the
 *     generation-order caveat (register defect #15).
 * Both were restored immediately. Without this the ported suite could have been
 * green by construction against a panel that renders nothing.
 */

const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const componentPath = path.join(repoRoot, 'src', 'v2', 'panels', 'DirectiveBoard.jsx');

// The v2 stylesheet is an ordered set of parts; this reads all of them in
// cascade order, so "the rule exists" keeps meaning "the browser will find it".
const { readMissionControlCss } = require('./fixtures/missionControlCss');

const { visibleText } = require('./fixtures/renderHarness');
const {
  withSharedDirectiveBoardPage,
  closeSharedDirectiveBoardPage,
  renderDirectiveBoardOnPage,
} = require('./fixtures/directiveBoardBrowser');

after(async () => {
  await closeSharedDirectiveBoardPage();
});

/** The rendered board, through the bridge the dashboard itself calls. */
async function renderToString(cyclePlan) {
  return withSharedDirectiveBoardPage(async (page) => {
    const { html } = await renderDirectiveBoardOnPage(page, { engineDirectives: { cyclePlan } });
    return html;
  });
}

const BUDGET_LABELS = [
  'ALIEN HATE BUDGET',
  'INFLUENCE POOL',
  'OPERATIONS POOL',
  'MISSION CONTROL'
];

function budgetMeter(html, label) {
  const match = html.match(new RegExp(
    `<div class="directive-budget-item">\\s*`
      + `<div class="directive-budget-label">\\s*`
      + `<span>${label}</span>\\s*<strong>([\\s\\S]*?)</strong>\\s*</div>\\s*`
      + `<div class="directive-budget-track">([\\s\\S]*?)</div>\\s*</div>`
  ));
  assert.ok(match, `${label} meter must render`);
  // A browser normalises `style="width: 0%"` to `style="width: 0%;"` when it
  // serialises the DOM back to HTML. The old VM sandbox read the component's
  // template STRING before any browser touched it, so it never saw the
  // semicolon. It is an artefact of reading real DOM, not a change in the bar
  // that is drawn, and stripping it here keeps the width assertions below
  // byte-identical to the pre-migration file.
  const track = match[2].replace(/(style="[^"]*?);"/g, '$1"');
  return { value: visibleText(match[1]), track };
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

test('an empty budgets object marks all four ceilings unmeasured and draws no fictional fills', async () => {
  const html = await renderToString(planWithBench([], { budgets: {} }));
  const readings = Object.fromEntries(BUDGET_LABELS.map(label => [label, budgetMeter(html, label).value]));

  assert.deepStrictEqual(readings, {
    'ALIEN HATE BUDGET': 'NOT MEASURED',
    'INFLUENCE POOL': 'NOT MEASURED',
    'OPERATIONS POOL': 'NOT MEASURED',
    'MISSION CONTROL': 'NOT MEASURED'
  });
  assert.strictEqual(
    (html.match(/class="directive-budget-fill(?:\s|")/g) || []).length,
    0,
    'an unmeasured ceiling has no percentage, so it must draw no fill'
  );
  for (const fabricated of ['0.0 / 5.0', '0 / 100', '0 / 50']) {
    assert.ok(!html.includes(fabricated), `must not fabricate ${fabricated}`);
  }
});

test('budget ceilings distinguish measured zero, absent, and measured non-zero', async () => {
  const zero = budgetMeter(await renderToString(planWithBench([], {
    budgets: { alienHate: { used: 0, cap: 0, capMeasured: true } }
  })), 'ALIEN HATE BUDGET');
  const absent = budgetMeter(await renderToString(planWithBench([], {
    budgets: { alienHate: { used: 0, cap: null, capMeasured: false } }
  })), 'ALIEN HATE BUDGET');
  const nonZero = budgetMeter(await renderToString(planWithBench([], {
    budgets: { alienHate: { used: 1.5, cap: 6, capMeasured: true } }
  })), 'ALIEN HATE BUDGET');

  assert.strictEqual(zero.value, '0.0 / 0.0', 'a measured zero is still a measured ceiling');
  assert.match(zero.track, /style="width: 0%"/, 'zero used of a zero ceiling draws an empty measured bar');
  assert.strictEqual(absent.value, 'NOT MEASURED', 'an absent ceiling is not zero');
  assert.strictEqual(absent.track.trim(), '', 'an absent ceiling has no percentage bar');
  assert.strictEqual(nonZero.value, '1.5 / 6.0');
  assert.match(nonZero.track, /style="width: 25%"/);
});

test('the board renders EVERY row the engine sent, not a slice of them', async () => {
  const html = await renderToString(planWithBench(EIGHT_ROWS));
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

test('a collapsed row prints what it stands for', async () => {
  const collapsed = row(0, {
    groupCount: 5,
    groupOmittedCount: 4,
    groupNote: '+4 more Purge options in China, all scoring 68.75',
    groupScoreLow: 68.75,
    groupScoreHigh: 68.75
  });
  const text = benchText(await renderToString(planWithBench([collapsed, row(1)])));

  assert.ok(text.includes('+4 more Purge options in China, all scoring 68.75'),
    `the group note must reach the reader: ${text}`);
});

test('a singleton row prints no group line at all — never "+0 more", never "undefined"', async () => {
  const html = await renderToString(planWithBench(EIGHT_ROWS));
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

test('an older payload with no group fields renders as plain rows', async () => {
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

  const html = await renderToString(plan);
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

test('the footer says how many CANDIDATES the rows stand for, so eight rows are not read as eight options', async () => {
  const rows = [
    row(0, { groupCount: 5, groupOmittedCount: 4, groupNote: '+4 more Purge options in China, all scoring 68.75' }),
    row(1, { groupCount: 4, groupOmittedCount: 3, groupNote: '+3 more Purge options in India, all scoring 50.64' }),
    ...Array.from({ length: 6 }, (_, i) => row(i + 2))
  ];
  const text = benchText(await renderToString(planWithBench(rows)));

  assert.ok(/Showing 8 rows of 427 benched/.test(text), text);
  assert.ok(/standing for 15 candidates/.test(text), text);
  assert.ok(/419 further alternatives are omitted/.test(text), text);
});

test('the group line has a stylesheet rule, so it is not invisible text', () => {
  const css = readMissionControlCss();
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

test('the board prints the reason the engine measured, not a councilor it made up', async () => {
  const rows = Array.from({ length: 8 }, (_, i) => budgetRefusedRow(i));
  const text = benchText(await renderToString(planWithBench(rows, {
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

test('a row with no recorded reason says so rather than borrowing the councilor sentence', async () => {
  const bare = row(0);
  delete bare.displacedBy;
  const text = benchText(await renderToString(planWithBench([bare])));

  assert.ok(/recorded no reason/i.test(text), `an absent reason must be stated: ${text}`);
  assert.ok(!/assigned to direct high-priority mission/.test(text), text);
  assert.ok(!/undefined/.test(text), text);
});

test('the bench header states the budget and how many rows fit it', async () => {
  const rows = Array.from({ length: 8 }, (_, i) => budgetRefusedRow(i));
  const text = benchText(await renderToString(planWithBench(rows, {
    budgets: LIVE_BUDGET,
    benchBudget: LIVE_BENCH_BUDGET
  })));

  assert.ok(/4\.74 \/ 7\.90 used/.test(text), `the pool state must be shown: ${text}`);
  assert.ok(/3\.16.*left/.test(text), text);
  assert.ok(/0 of 8 row\(s\) below fit/.test(text), `the joint answer must be shown: ${text}`);
  assert.ok(/ALTERNATIVES sharing one alienHate pool/.test(text), text);
});

test('a floor-derived hate cap is labelled an upper bound on the board', async () => {
  // Player mode's live shape: the cap comes from the Mission Control hate floor
  // because the true hate is redacted, so it can only overstate the budget.
  const text = benchText(await renderToString(planWithBench([row(0)], {
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

test('an unmeasured hate cap says the check was skipped, never that the budget is zero', async () => {
  const text = benchText(await renderToString(planWithBench([row(0)], {
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

test('an uncomputed joint total says NOT COMPUTED rather than implying every row fits', async () => {
  const text = benchText(await renderToString(planWithBench([row(0)], {
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

test('an older payload with no bench budget renders no affordability claim at all', async () => {
  const plan = planWithBench([row(0)]);
  delete plan.benchBudget;
  delete plan.budgets;
  const html = await renderToString(plan);

  assert.strictEqual((html.match(/class="directive-bench-budget"/g) || []).length, 0,
    'nothing was read, so nothing is claimed');
  assert.strictEqual((html.match(/class="directive-budgets-bar"/g) || []).length, 0,
    'an absent budgets payload must reach renderBudgets\' existing guard');
  assert.ok(!/row\(s\) below fit/.test(visibleText(html)));
});

test('a MIXED group does not present the representative\'s reason as the whole group\'s', async () => {
  const mixed = budgetRefusedRow(0, { groupCount: 5, groupOmittedCount: 4, groupBudgetDisplacedCount: 2 });
  const text = benchText(await renderToString(planWithBench([mixed], {
    budgets: LIVE_BUDGET, benchBudget: LIVE_BENCH_BUDGET
  })));

  assert.ok(/Mixed group: 2 of 5/.test(text),
    `a group whose members differ must say so: ${text}`);

  // And a UNIFORM group must not raise the caveat, or it becomes noise nobody
  // reads on the one row where it matters.

  const uniform = budgetRefusedRow(0, { groupCount: 5, groupOmittedCount: 4, groupBudgetDisplacedCount: 5 });
  const uniformText = benchText(await renderToString(planWithBench([uniform], {
    budgets: LIVE_BUDGET, benchBudget: LIVE_BENCH_BUDGET
  })));
  assert.ok(!/Mixed group/.test(uniformText), uniformText);
});

test('the new bench-budget elements have stylesheet rules, so they are not invisible text', () => {
  const css = readMissionControlCss();
  for (const rule of [
    'directive-bench-budget',
    'directive-bench-budget-unknown',
    'directive-bench-budget-caveat',
    'directive-benched-group-caveat'
  ]) {
    assert.ok(new RegExp(`\\.${rule}\\s*\\{`).test(css), `.${rule} must be styled`);
  }
});

test('the bench explicitly states that the order is generation order and NOT a ranking', async () => {
  // 1. Live save sequence: non-descending scores (6.03, 6.00, 9.00, 5.61, 4.38, 4.06, 4.14, 7.00)
  // Best alternative (9.00) sits third, second-best (7.00) sits last.
  const scores = [6.03, 6.0, 9.0, 5.61, 4.38, 4.06, 4.14, 7.0];
  const liveShapedRows = scores.map((s, i) => row(i, { score: s }));
  const plan = planWithBench(liveShapedRows, {
    benchedTotalCount: 427,
    benchedOmittedCount: 419,
    benchedRepresentedCount: 15
  });

  const textCapped = benchText(await renderToString(plan));
  assert.ok(
    textCapped.includes('Ordered by generation rather than by score, so the sequence is NOT a ranking and the row count counts groups rather than options.'),
    `Capped bench must state generation ordering and NOT a ranking: ${textCapped}`
  );
  assert.ok(textCapped.includes('Showing 8 rows of 427 benched'), 'Capped bench still carries omission count');

  // 2. Uncapped bench (omitted === 0): caveat is still stated because generation order is not a ranking
  const fewRows = [row(0, { score: 6.03 }), row(1, { score: 9.0 })];
  const uncappedPlan = planWithBench(fewRows, {
    benchedTotalCount: 2,
    benchedOmittedCount: 0,
    benchedRepresentedCount: 2
  });

  const textUncapped = benchText(await renderToString(uncappedPlan));
  assert.ok(
    textUncapped.includes('Ordered by generation rather than by score, so the sequence is NOT a ranking and the row count counts groups rather than options.'),
    `Uncapped bench must also state generation ordering and NOT a ranking: ${textUncapped}`
  );
  assert.ok(!textUncapped.includes('omitted from this view'), 'Uncapped bench carries no omission line');
});
