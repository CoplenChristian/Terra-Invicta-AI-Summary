/**
 * WHY A BENCHED CANDIDATE IS BENCHED — the reason a reader is given, against
 * the reason the engine measured.
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT THIS FILE PINS
 * ---------------------------------------------------------------------------
 *
 * Every bench row that was not risk-floor held used to read
 * `Displaced by ${assignments[0].councilor.name} assigned to direct
 * high-priority mission.` -- the FIRST assignment's councilor, named on every
 * row regardless of whether that operative had anything to do with the
 * candidate. Measured 2026-08-23 against frozen `ExitSave.gz`
 * (md5 5c0d9ef98213c91d8187ae11bf885d57):
 *
 *   OMNISCIENT: all 8 rows said "Displaced by Hemaraj Pavanaja". All 8 had in
 *   fact been refused by the alienHate budget -- 4.57 hate charged against 3.16
 *   left of a 7.90 cycle cap, 1.41 short -- and the operative the refusal names
 *   is Mahangeet Pakimor. The engine computed the pool, the charge and the
 *   shortfall and discarded all three.
 *
 *   PLAYER: all 8 rows said "Displaced by Beth Hofmann", who was the
 *   WORST-scoring operative on every one of those eight candidate lists. Seven
 *   of the eight had every way of running them refused as a value-destroying
 *   switch; the eighth was genuine contention, by two other councilors.
 *
 * A wrong reason is worse than a missing one because a reader acts on it: "free
 * up a councilor and I can do this" is exactly backwards when a budget refused
 * an operative who was already free.
 *
 * ---------------------------------------------------------------------------
 * HOW THESE TESTS WERE VALIDATED
 * ---------------------------------------------------------------------------
 *
 * Every assertion here was run against the pre-change code first and observed
 * to FAIL, then against a deliberately broken post-change build and observed to
 * fail again -- a fixture captured from post-change output passes by
 * construction and proves nothing. The specific mutations checked are recorded
 * beside the tests they guard.
 */

const { test } = require('node:test');
const assert = require('node:assert');

const { allocateCyclePlan } = require('../server/engine/assignment');
const { BudgetPoolManager } = require('../server/engine/budgets');
const { selectBenchRows } = require('../shared/benchSelection.mjs');

const SPEC = Object.freeze({
  friendlyName: 'Control Nation',
  contested: true,
  attack: 'Persuasion',
  baseDifficulty: 5
});

/** A hate-bearing mission spec: the pool that gates the live save's bench. */
const HATE_SPEC = Object.freeze({ ...SPEC, successHate: 4, failureHate: 4 });

const attrs = (persuasion) => ({ effective: { Persuasion: persuasion } });

const councilor = (id, name, persuasion) => ({
  ID: id,
  displayName: name,
  status: 'Active',
  locationType: 'earth',
  resolvedAttributes: attrs(persuasion)
});

// ---------------------------------------------------------------------------
// 1. THE REFUSAL CARRIES ITS NUMBERS
// ---------------------------------------------------------------------------

test('a budget refusal reports the charge and what was left, not just the shortfall', () => {
  // Broken first by reverting `canAfford` to returning only { pool, shortfall }:
  // every assertion below except the shortfall one failed.
  const budgets = new BudgetPoolManager({ resources: { influence: 40 }, alienHate: { assessedHate: 10 } });
  budgets.consume({ resource: 'Influence', amount: 30 }, 0);

  const verdict = budgets.canAfford({ resource: 'Influence', amount: 25 }, 0);
  assert.strictEqual(verdict.affordable, false);
  assert.strictEqual(verdict.pool, 'influence');
  assert.strictEqual(verdict.charge, 25, 'what the action costs');
  assert.strictEqual(verdict.cap, 40, 'what the pool holds');
  assert.strictEqual(verdict.used, 30, 'what the plan already spent');
  assert.strictEqual(verdict.remaining, 10, 'what was left to pay it with');
  assert.strictEqual(verdict.shortfall, 15);
  // The identity that makes the three numbers a consistent story rather than
  // three separately computed figures that can drift apart.
  assert.strictEqual(
    Number((verdict.charge - verdict.remaining).toFixed(2)),
    verdict.shortfall,
    'charge - remaining must equal shortfall'
  );
});

test('an over-consumed pool has nothing left, never a negative amount of it', () => {
  const budgets = new BudgetPoolManager({ resources: { influence: 40 }, alienHate: { assessedHate: 10 } });
  budgets.consume({ resource: 'Influence', amount: 50 }, 0);
  const verdict = budgets.canAfford({ resource: 'Influence', amount: 5 }, 0);
  assert.strictEqual(verdict.remaining, 0, 'remaining is clamped at zero');
});

// ---------------------------------------------------------------------------
// 2. THE BENCH ROW NAMES THE BUDGET, NOT A COUNCILOR
// ---------------------------------------------------------------------------

/**
 * Two councilors, three actions, and an Influence pool that pays for one.
 *
 * The second action is refused by the budget with the second councilor free and
 * willing, which is precisely the shape the live save has: the refusal proves a
 * free operative existed, so "a councilor was busy" cannot be the reason.
 */
function budgetSqueezedPlan() {
  const councilors = [councilor(1, 'Alice', 25), councilor(2, 'Bob', 24)];
  const candidates = [
    { id: 'op-a', title: 'Op A', missionSpec: SPEC, baseValue: 6.0, cost: { resource: 'Influence', amount: 30 } },
    { id: 'op-b', title: 'Op B', missionSpec: SPEC, baseValue: 5.5, cost: { resource: 'Influence', amount: 30 } },
    { id: 'op-c', title: 'Op C', missionSpec: SPEC, baseValue: 5.0, cost: { resource: 'Influence', amount: 30 } }
  ];
  const world = { resources: { influence: 40 }, alienHate: { assessedHate: 10 } };
  return { plan: allocateCyclePlan(candidates, councilors, world), councilors, candidates };
}

test('a budget-displaced bench row states the pool, the charge and the shortfall', () => {
  const { plan } = budgetSqueezedPlan();

  const refused = plan.benched.find((b) => b.candidateId === 'op-b');
  assert.ok(refused, 'the refused candidate must reach the bench');
  assert.strictEqual(refused.displacementCause, 'budget');
  assert.ok(refused.budgetRefusal, 'the refusal itself must ride on the row');
  assert.strictEqual(refused.budgetRefusal.pool, 'influence');
  assert.strictEqual(refused.budgetRefusal.charge, 30);
  assert.strictEqual(refused.budgetRefusal.remaining, 10);
  assert.strictEqual(refused.budgetRefusal.shortfall, 20);

  // The prose has to carry the same three numbers: a consumer reading only the
  // sentence must not be worse informed than one reading the object.
  assert.match(refused.displacedBy, /influence budget/i);
  assert.match(refused.displacedBy, /30/);
  assert.match(refused.displacedBy, /10/);
  assert.match(refused.displacedBy, /20/);
});

test('THE REGRESSION PIN: a budget-displaced row never blames a busy councilor', () => {
  // Broken by restoring the `else if (assignments.length > 0)` branch ahead of
  // the budget branch: this test failed and the one above it did too.
  const { plan } = budgetSqueezedPlan();
  assert.ok(plan.assignments.length > 0, 'the pin is meaningless unless someone was assigned');

  const budgetRows = plan.benched.filter((b) => b.displacementCause === 'budget');
  assert.ok(budgetRows.length > 0, 'this fixture must produce at least one budget refusal');

  const assignedNames = plan.assignments.map((a) => a.councilor.name);
  for (const row of budgetRows) {
    assert.ok(
      !/assigned to direct high-priority mission/i.test(row.displacedBy),
      `the councilor sentence must not return: ${row.displacedBy}`
    );
    // Naming the FIRST assignment's councilor is the specific fabrication; the
    // refusal's own councilor may legitimately appear, so only the plan's
    // assignees are barred from being blamed.
    for (const name of assignedNames) {
      assert.ok(
        !new RegExp(`Displaced by ${name}`).test(row.displacedBy),
        `"${name}" is assigned elsewhere and had nothing to do with this refusal: ${row.displacedBy}`
      );
    }
    // The positive half: the sentence must actively refute the councilor
    // reading rather than merely omitting it.
    assert.match(row.displacedBy, /not by a busy councilor/i);
    assert.match(row.displacedBy, /freeing another operative does not/i);
  }
});

test('every way of running a benched candidate is accounted for in the obstacle tally', () => {
  const { plan } = budgetSqueezedPlan();
  let sawBudget = 0;
  let sawContention = 0;
  for (const row of plan.benched) {
    const o = row.displacementObstacles;
    assert.ok(o, 'every row carries a tally');
    const summed = o.budgetRefusedCount + o.contendedCount + o.switchRejectedCount
      + o.riskFloorVetoedCount + o.unclassifiedCount;
    assert.strictEqual(summed, o.pairingCount,
      `the tally must cover every pairing, not most of them: ${JSON.stringify(o)}`);
    assert.strictEqual(o.unclassifiedCount, 0,
      `an unclassified pairing is a gap in the classifier: ${JSON.stringify(o)}`);
    assert.notStrictEqual(row.displacementCause, 'undetermined',
      `no candidate in this fixture should be undetermined: ${row.candidateId}`);

    // The tally must AGREE with the cause, or one of the two is being derived
    // from something the other does not see. A budget cause with no counted
    // refusal is the specific way a misclassified pairing hides: the sum still
    // reconciles while the bucket it landed in is wrong.
    if (row.displacementCause === 'budget') {
      sawBudget += 1;
      assert.ok(o.budgetRefusedCount >= 1,
        `a budget cause requires at least one counted refusal: ${JSON.stringify(o)}`);
      assert.ok(row.budgetRefusal !== null, 'and the refusal itself');
    }
    if (row.displacementCause === 'councilor-contention') {
      sawContention += 1;
      assert.ok(o.contendedCount >= 1,
        `a contention cause requires at least one contended pairing: ${JSON.stringify(o)}`);
      assert.strictEqual(o.budgetRefusedCount, 0,
        'a budget refusal outranks contention, so contention implies none was recorded');
    }
  }
  assert.ok(sawBudget > 0, 'this fixture must exercise the budget branch');
  assert.ok(sawContention + sawBudget === plan.benched.length,
    'and every benched row here is one of the two');
});

// ---------------------------------------------------------------------------
// 3. CONTENTION IS NAMED CORRECTLY WHEN IT IS THE REASON
// ---------------------------------------------------------------------------

test('contention names the operative who could have run it and what took them', () => {
  // One councilor, two affordable actions: the loser is displaced by the WINNER,
  // which is the only councilor who could have run it.
  const councilors = [councilor(1, 'Alice', 25)];
  const candidates = [
    { id: 'op-a', title: 'Op A', missionSpec: SPEC, baseValue: 9.0, cost: { resource: 'Influence', amount: 5 } },
    { id: 'op-b', title: 'Op B', missionSpec: SPEC, baseValue: 5.0, cost: { resource: 'Influence', amount: 5 } }
  ];
  const world = { resources: { influence: 500 }, alienHate: { assessedHate: 10 } };
  const plan = allocateCyclePlan(candidates, councilors, world);

  const loser = plan.benched.find((b) => b.candidateId === 'op-b');
  assert.ok(loser, 'the losing candidate must be benched');
  assert.strictEqual(loser.displacementCause, 'councilor-contention');
  assert.match(loser.displacedBy, /Alice/, 'the operative who could have run it is named');
  assert.match(loser.displacedBy, /Op A/, 'the work that took them is named');
  assert.strictEqual(loser.budgetRefusal, null, 'no budget refused this one');
});

test('a candidate no operative could be priced for says so rather than blaming anyone', () => {
  // Earth-only candidate, space-bound councilor: no pairing exists at all.
  const councilors = [
    councilor(1, 'Alice', 25),
    { ID: 2, displayName: 'Carol', status: 'Active', locationType: 'space', resolvedAttributes: attrs(25) }
  ];
  const candidates = [
    { id: 'op-a', title: 'Op A', missionSpec: SPEC, baseValue: 9.0, cost: { resource: 'Influence', amount: 5 } },
    {
      id: 'op-space',
      title: 'Op Space',
      missionSpec: { ...SPEC, requiresLocation: 'nowhere' },
      baseValue: 8.0,
      cost: { resource: 'Influence', amount: 5 },
      feasibleFor: []
    }
  ];
  const world = { resources: { influence: 500 }, alienHate: { assessedHate: 10 } };
  const plan = allocateCyclePlan(candidates, councilors, world);

  for (const row of plan.benched) {
    if (row.displacementObstacles.pairingCount !== 0) continue;
    assert.strictEqual(row.displacementCause, 'no-priceable-operative');
    assert.match(row.displacedBy, /No operative could be priced/i);
    assert.ok(!/Displaced by [A-Z]/.test(row.displacedBy),
      `a candidate nobody could be paired with cannot have been displaced by a person: ${row.displacedBy}`);
  }
});

// ---------------------------------------------------------------------------
// 4. HOW MANY OF THE SHOWN ROWS FIT
// ---------------------------------------------------------------------------

test('the bench reports how many of its rows are jointly affordable', () => {
  // Broken by deleting `benchBudget` from the returned plan, and again by
  // making `summariseBenchBudget` count every priced row as fitting.
  const { plan } = budgetSqueezedPlan();
  const summary = plan.benchBudget;
  assert.ok(summary, 'the plan must carry a bench-budget summary');
  assert.strictEqual(summary.pool, 'influence');
  assert.strictEqual(summary.remaining, 10);
  assert.strictEqual(summary.jointlyAffordableCount, 0,
    'two 30-influence options against 10 remaining is none, not two');
  assert.strictEqual(summary.jointlyAffordableIsUpperBound, true);
  assert.strictEqual(summary.pricedRowCount + summary.unpricedRowCount, summary.rowCount);
});

test('a bench nothing refused reports the joint total as NOT COMPUTED, never as "all of them"', () => {
  const councilors = [councilor(1, 'Alice', 25)];
  const candidates = [
    { id: 'op-a', title: 'Op A', missionSpec: SPEC, baseValue: 9.0, cost: { resource: 'Influence', amount: 5 } },
    { id: 'op-b', title: 'Op B', missionSpec: SPEC, baseValue: 5.0, cost: { resource: 'Influence', amount: 5 } }
  ];
  const world = { resources: { influence: 500 }, alienHate: { assessedHate: 10 } };
  const plan = allocateCyclePlan(candidates, councilors, world);

  const summary = plan.benchBudget;
  assert.strictEqual(summary.jointlyAffordableCount, null,
    'absent stays null -- an untested budget is not a passed one');
  assert.strictEqual(summary.pool, null);
  assert.strictEqual(summary.pricedRowCount, 0);
  assert.match(summary.reason, /never tested/i);
});

test('a bench row no budget refused is counted neither as fitting nor as refused', () => {
  // A bench that MIXES refused rows with rows the budget never evaluated. The
  // unpriced ones must not be quietly folded into the count either way: they
  // are not known to fit and they were not refused.
  const councilors = [councilor(1, 'Alice', 25), councilor(2, 'Bob', 24)];
  const candidates = [
    // Hate-bearing, and the cap is too small for either: both are refused.
    // They must OUTSCORE the calm options or the greedy pass reaches them only
    // after both councilors are taken, and they would be held by contention
    // before any budget was consulted.
    { id: 'hate-a', title: 'Hate A', missionSpec: HATE_SPEC, baseValue: 40, cost: { resource: 'Influence', amount: 1 } },
    { id: 'hate-b', title: 'Hate B', missionSpec: HATE_SPEC, baseValue: 39, cost: { resource: 'Influence', amount: 1 } },
    // Zero-hate and affordable: two get taken, the third loses on contention
    // and so carries no budget verdict at all.
    { id: 'calm-a', title: 'Calm A', missionSpec: SPEC, baseValue: 7.0, cost: { resource: 'Influence', amount: 1 } },
    { id: 'calm-b', title: 'Calm B', missionSpec: SPEC, baseValue: 6.5, cost: { resource: 'Influence', amount: 1 } },
    { id: 'calm-c', title: 'Calm C', missionSpec: SPEC, baseValue: 6.0, cost: { resource: 'Influence', amount: 1 } }
  ];
  const world = {
    resources: { influence: 500 },
    alienHateEconomics: { actualAlienHate: 180, minimumAlienHate: 0 }
  };
  const plan = allocateCyclePlan(candidates, councilors, world);
  const summary = plan.benchBudget;

  assert.ok(summary.pricedRowCount > 0, 'the fixture must refuse something');
  assert.ok(summary.unpricedRowCount > 0, 'and must bench something the budget never saw');
  assert.strictEqual(summary.pricedRowCount + summary.unpricedRowCount, summary.rowCount);
  assert.strictEqual(summary.jointlyAffordableCount, 0,
    'only priced rows can be counted, and none of them fits');
  assert.match(summary.reason, /neither/i,
    'the unpriced rows must be named as such rather than silently dropped');

  // And the unpriced rows themselves carry no budget verdict, rather than a
  // fabricated one: absent stays null.
  for (const row of plan.benched) {
    if (row.displacementCause === 'budget') continue;
    assert.strictEqual(row.budgetRefusal, null,
      `${row.candidateId} was never refused by a budget and must not carry a refusal`);
  }
});

// ---------------------------------------------------------------------------
// 5. A GROUP MUST NOT PRESENT ONE MEMBER'S REASON AS EVERYONE'S
// ---------------------------------------------------------------------------

test('a collapsed row counts how many of its members a budget actually refused', () => {
  // Broken by removing `groupBudgetDisplacedCount` from selectBenchRows.
  const record = (id, score, refused) => ({
    selectionScore: score,
    identity: { key: 'Purge|nation:China', kind: 'nation', label: 'China', missionType: 'Purge' },
    entry: {
      candidateId: id,
      title: `Purge ${id}`,
      score,
      riskFloorHeld: false,
      displacedBy: 'x',
      displacementCause: refused ? 'budget' : 'councilor-contention',
      budgetRefusal: refused ? { pool: 'alienHate', charge: 4.57, chargeMeasured: true } : null
    }
  });

  const { rows } = selectBenchRows(
    [record('a', 10, true), record('b', 9, false), record('c', 8, true)],
    { limit: 8 }
  );
  assert.strictEqual(rows.length, 1, 'three siblings collapse to one row');
  assert.strictEqual(rows[0].groupCount, 3);
  assert.strictEqual(rows[0].groupBudgetDisplacedCount, 2,
    'two of the three were refused by a budget, and the row must say so');
  // The existing risk-floor count is untouched by the addition beside it.
  assert.strictEqual(rows[0].groupRiskFloorHeldCount, 0);
});

test('a group nobody was refused in reports zero, not the representative\'s verdict', () => {
  const record = (id, score) => ({
    selectionScore: score,
    identity: { key: 'Advise|nation:4007', kind: 'nation', label: 'Madagascar', missionType: 'Advise' },
    entry: { candidateId: id, title: id, score, riskFloorHeld: false, displacedBy: 'x', budgetRefusal: null }
  });
  const { rows } = selectBenchRows([record('a', 4), record('b', 3)], { limit: 8 });
  assert.strictEqual(rows[0].groupBudgetDisplacedCount, 0);
});

// ---------------------------------------------------------------------------
// 6. THE HATE CAP SAYS WHAT IT RESTS ON
// ---------------------------------------------------------------------------

test('a hate cap derived from the MC floor is labelled an upper bound, not a measurement', () => {
  // This is player mode's live shape: `actualAlienHate` is redacted and only
  // `minimumAlienHate` survives, so the cap comes out of a LOWER BOUND on hate
  // and can only overstate the real budget. Measured on the frozen save, player
  // mode reads cap 8.5 against omniscient's 7.9 for exactly this reason.
  const floored = new BudgetPoolManager({
    resources: { influence: 100 },
    alienHateEconomics: { actualAlienHate: null, minimumAlienHate: 30.912 }
  }).getSummary().alienHate;

  assert.strictEqual(floored.capMeasured, true, 'a number did come out');
  assert.strictEqual(floored.currentHateBasis, 'floor');
  assert.strictEqual(floored.capIsUpperBound, true,
    'true hate can only be at or above the floor, so the budget can only be smaller');

  const measured = new BudgetPoolManager({
    resources: { influence: 100 },
    alienHateEconomics: { actualAlienHate: 42.86253, minimumAlienHate: 30.912 }
  }).getSummary().alienHate;
  assert.strictEqual(measured.currentHateBasis, 'measured');
  assert.strictEqual(measured.capIsUpperBound, false);
  assert.ok(measured.cap < floored.cap,
    'the floored cap is the optimistic one, which is why it must be labelled');

  // Neither readable: no cap at all, and the basis says so rather than
  // defaulting to either label.
  const unread = new BudgetPoolManager({ resources: { influence: 100 } }).getSummary().alienHate;
  assert.strictEqual(unread.cap, null);
  assert.strictEqual(unread.capMeasured, false);
  assert.strictEqual(unread.currentHateBasis, null);
  assert.strictEqual(unread.capIsUpperBound, false);
});

test('a hate-bearing bench refusal names the hate pool and its own charge', () => {
  const councilors = [councilor(1, 'Alice', 25), councilor(2, 'Bob', 24)];
  const candidates = [
    { id: 'hate-a', title: 'Hate A', missionSpec: HATE_SPEC, baseValue: 9.0, cost: { resource: 'Influence', amount: 1 } },
    { id: 'hate-b', title: 'Hate B', missionSpec: HATE_SPEC, baseValue: 8.0, cost: { resource: 'Influence', amount: 1 } }
  ];
  // Hate 180 of a 200 total-war threshold leaves a 1.0 cycle cap: the first
  // 4-hate action does not fit, so both are refused.
  const world = {
    resources: { influence: 500 },
    alienHateEconomics: { actualAlienHate: 180, minimumAlienHate: 0 }
  };
  const plan = allocateCyclePlan(candidates, councilors, world);

  const refused = plan.benched.filter((b) => b.displacementCause === 'budget');
  assert.ok(refused.length > 0, 'the hate cap must refuse something in this fixture');
  for (const row of refused) {
    assert.strictEqual(row.budgetRefusal.pool, 'alienHate');
    assert.strictEqual(row.budgetRefusal.chargeMeasured, true);
    assert.ok(row.budgetRefusal.charge > 0, 'a refused hate charge is a positive measured number');
    assert.match(row.displacedBy, /alienHate budget/);
  }
  assert.strictEqual(plan.benchBudget.pool, 'alienHate');
  assert.strictEqual(plan.benchBudget.jointlyAffordableCount, 0);
});
