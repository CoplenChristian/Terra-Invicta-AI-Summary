// tests/riskTolerance.test.js
//
// The configurable success-odds floor (docs/risk-tolerance-spec.md).
//
// Odds were computed and used to weight expected hate, and then never gated a
// recommendation: a 15% mission and a 95% mission competed on expected value
// alone. This file pins the five things that make the floor correct rather
// than merely present, in the order the spec ranks them:
//
//   1. THE FLOOR TESTS band[0], NOT point. `band` is a spread. On the live save
//      `purge:3728:3729` reads point 93, band [89, 96], so a 90% floor that
//      tested the midpoint would admit a mission whose true chance may be 89%.
//      Every band-related test below asserts the point WOULD have passed, so
//      the test fails if the implementation ever reverts to the midpoint.
//   2. A floor of 0 vetoes NOTHING. `Number(null) === 0`, and "the player chose
//      no floor" must never become "reject every action on the board".
//   3. An ABSENT parameter resolves to the CONFIGURED default, not to 0. The
//      shipped default happens to be 0, so this is asserted against an injected
//      non-zero configuration -- otherwise the test would pass by construction
//      and prove nothing.
//   4. `available: false` reports 'unknown'. Not 'pass' (pairing.js's 0.5
//      planning prior ranks an unknown mission, it does not measure one) and
//      not 'veto'.
//   5. `automatic: true` clears every floor and is not framed as a risk bet.
//
// Both modes are exercised against the live save, because player mode masks
// enemy councilor attributes and therefore produces a DIFFERENT board: the
// contested Purge that the floor decides on in omniscient mode is not even in
// the player-mode plan.

const { test } = require('node:test');
const assert = require('node:assert');

const { RULES, ruleScope } = require('../server/engine/rules');
const {
  MARGINAL_CLEARANCE_POINTS,
  assessRiskFloor,
  readBandLow,
  resolveRiskFloorPercent,
  riskFloorInForce,
  successFloor
} = require('../server/engine/rules/risk');
const { computeMissionOdds } = require('../server/engine/odds');
const { evaluateVetoes, evaluatePairingVetoes, applyPairingRules } = require('../server/engine/selection');
const { allocateCyclePlan } = require('../server/engine/assignment');
const { buildWorld } = require('../server/directiveEngine');
const briefingGenerator = require('../server/briefingGenerator');
const { resolveConfig } = require('../server/config');
const { requestContext } = require('../server/http/requestContext');

// ---------------------------------------------------------------------------
// The straddling estimate, derived rather than hand-written.
//
// Espionage 11 against a flat difficulty of 3 is diff 8, which the wiki roll
// curve turns into exactly the live save's Purge reading. Deriving it from
// `computeMissionOdds` rather than pasting `{ point: 93, band: [89, 96] }`
// means the fixture cannot drift away from the model it is supposed to
// represent.
// ---------------------------------------------------------------------------

function straddlingCandidate(overrides = {}) {
  return {
    id: 'synthetic-purge',
    title: 'Purge a rival cell',
    missionType: 'Purge',
    family: 'council',
    cost: null,
    target: { kind: 'councilor', councilorName: 'Target' },
    missionSpec: {
      dataName: 'Purge',
      friendlyName: 'Purge',
      attack: 'Espionage',
      baseDifficulty: 3,
      contested: true,
      conditions: []
    },
    ...overrides
  };
}

function operative(overrides = {}) {
  return {
    ID: 9001,
    displayName: 'Test Operative',
    factionId: 4712,
    locationType: 'earth',
    location: 'Earth',
    status: 'Active',
    attributes: { Espionage: 11, Persuasion: 10 },
    ...overrides
  };
}

const STRADDLING_ODDS = computeMissionOdds(straddlingCandidate(), operative(), {});

test('the synthetic straddling estimate really does straddle: band low < point', () => {
  assert.strictEqual(STRADDLING_ODDS.available, true);
  assert.strictEqual(STRADDLING_ODDS.automatic, false);
  assert.strictEqual(STRADDLING_ODDS.point, 93);
  assert.deepStrictEqual(STRADDLING_ODDS.band, [89, 96]);
  assert.ok(
    STRADDLING_ODDS.band[0] < STRADDLING_ODDS.point,
    'the fixture is worthless unless the band low sits below the midpoint'
  );
});

function pairingWithOdds(odds, candidate = straddlingCandidate()) {
  return { candidateId: candidate.id, candidate, councilorId: 9001, odds, why: [] };
}

// ---------------------------------------------------------------------------
// 1. THE BAND, NOT THE POINT
// ---------------------------------------------------------------------------

test('a floor above the band low vetoes, even though the midpoint would have cleared it', () => {
  const floor = STRADDLING_ODDS.band[0] + 1; // 90
  assert.ok(floor <= STRADDLING_ODDS.point, 'the midpoint must still clear this floor, or the test proves nothing');

  const world = buildWorld({ riskFloorPercent: floor });
  const subject = pairingWithOdds(STRADDLING_ODDS);

  assert.strictEqual(successFloor.appliesTo(subject), true);
  assert.strictEqual(successFloor.evaluate(world, subject), 'veto');

  const verdict = assessRiskFloor(world, subject);
  assert.strictEqual(verdict.bandLow, 89);
  assert.strictEqual(verdict.floorPercent, 90);
  // The reason names BOTH numbers, per the spec's acceptance criterion.
  assert.match(verdict.reason, /89%/);
  assert.match(verdict.reason, /90% floor/);
});

test('a floor at the band low passes, and a floor below it passes', () => {
  for (const floor of [STRADDLING_ODDS.band[0], STRADDLING_ODDS.band[0] - 1]) {
    const world = buildWorld({ riskFloorPercent: floor });
    assert.strictEqual(
      successFloor.evaluate(world, pairingWithOdds(STRADDLING_ODDS)),
      'pass',
      `floor ${floor} must not veto a band low of ${STRADDLING_ODDS.band[0]}`
    );
  }
});

test('the band low is read from band[0] and is never substituted by the point', () => {
  // A deliberately inconsistent estimate: a midpoint far above a band that
  // does not contain it. If the implementation ever falls back to `point` the
  // veto disappears.
  const odds = { ...STRADDLING_ODDS, point: 99, band: [40, 60] };
  const world = buildWorld({ riskFloorPercent: 90 });
  assert.strictEqual(readBandLow(odds), 40);
  assert.strictEqual(successFloor.evaluate(world, pairingWithOdds(odds)), 'veto');
  assert.match(assessRiskFloor(world, pairingWithOdds(odds)).reason, /40%/);
});

test('an estimate with no band reports unknown and says the midpoint was not substituted', () => {
  const odds = { ...STRADDLING_ODDS, band: null };
  const world = buildWorld({ riskFloorPercent: 90 });
  const verdict = assessRiskFloor(world, pairingWithOdds(odds));
  assert.strictEqual(verdict.outcome, 'unknown');
  assert.strictEqual(verdict.bandLow, null);
  assert.match(verdict.reason, /no band/i);
  assert.match(verdict.reason, /not substituted/i);
});

// ---------------------------------------------------------------------------
// 2. A FLOOR OF 0 IS NO FLOOR
// ---------------------------------------------------------------------------

test('a floor of 0 vetoes nothing, not even a 10% mission', () => {
  const hopeless = { ...STRADDLING_ODDS, point: 10, band: [6, 15] };
  const world = buildWorld({ riskFloorPercent: 0 });
  assert.strictEqual(resolveRiskFloorPercent(world), 0);
  assert.strictEqual(riskFloorInForce(world), false);
  assert.strictEqual(successFloor.evaluate(world, pairingWithOdds(hopeless)), 'pass');
  assert.match(assessRiskFloor(world, pairingWithOdds(hopeless)).reason, /risk floor is 0%/i);
});

test('an absent floor on the world is null, not 0, and vetoes nothing', () => {
  const world = buildWorld({});
  assert.strictEqual(world.riskFloorPercent, null, 'absent stays null on the world object');
  assert.strictEqual(resolveRiskFloorPercent(world), null);
  assert.strictEqual(riskFloorInForce(world), false);
  const hopeless = { ...STRADDLING_ODDS, point: 10, band: [6, 15] };
  assert.strictEqual(successFloor.evaluate(world, pairingWithOdds(hopeless)), 'pass');
  assert.match(assessRiskFloor(world, pairingWithOdds(hopeless)).reason, /no success-odds floor is configured/i);
});

// ---------------------------------------------------------------------------
// 3. UNKNOWN IS NOT A PASS AND NOT A VETO
// ---------------------------------------------------------------------------

test('available:false reports unknown — neither auto-passed nor auto-vetoed', () => {
  const world = buildWorld({ riskFloorPercent: 90 });
  const unavailable = computeMissionOdds(
    { missionType: 'Purge', friendlyName: 'Purge' }, // no missionSpec: no attack attribute, no difficulty
    operative(),
    {}
  );
  assert.strictEqual(unavailable.available, false);
  assert.strictEqual(unavailable.chance, null);

  const verdict = assessRiskFloor(world, pairingWithOdds(unavailable));
  assert.strictEqual(verdict.outcome, 'unknown');
  assert.notStrictEqual(verdict.outcome, 'pass');
  assert.notStrictEqual(verdict.outcome, 'veto');
  assert.strictEqual(successFloor.evaluate(world, pairingWithOdds(unavailable)), 'unknown');
  assert.match(verdict.reason, /could not be computed/i);
  assert.match(verdict.reason, /Unknown odds, not acceptable odds/i);
});

test("the 0.5 planning prior never becomes evidence that a mission cleared the floor", () => {
  const world = buildWorld({ riskFloorPercent: 90 });
  const unavailable = computeMissionOdds({ missionType: 'Purge' }, operative(), {});
  const verdict = assessRiskFloor(world, pairingWithOdds(unavailable));

  // pairing.js ranks an unknown pairing at UNKNOWN_ODDS_PLANNING_PRIOR = 0.5.
  // If that number ever leaks into the floor check it shows up here as a 50.
  assert.strictEqual(verdict.point, null);
  assert.strictEqual(verdict.bandLow, null);
  assert.ok(!/\b50\b/.test(verdict.reason), `the planning prior leaked into the verdict: ${verdict.reason}`);
});

// ---------------------------------------------------------------------------
// 4. AUTOMATIC MISSIONS CLEAR EVERY FLOOR
// ---------------------------------------------------------------------------

test('an automatic mission clears every floor and is not presented as a risk decision', () => {
  const auto = computeMissionOdds(
    { missionType: 'Advise', missionSpec: { friendlyName: 'Advise', contested: false, attack: 'Administration', baseDifficulty: 0 } },
    operative(),
    {}
  );
  assert.strictEqual(auto.automatic, true);
  assert.deepStrictEqual(auto.band, [100, 100]);

  for (const floor of [1, 50, 90, 99, 100]) {
    const world = buildWorld({ riskFloorPercent: floor });
    const verdict = assessRiskFloor(world, pairingWithOdds(auto));
    assert.strictEqual(verdict.outcome, 'pass', `automatic must clear a ${floor}% floor`);
    assert.strictEqual(verdict.automatic, true);
    assert.match(verdict.reason, /uncontested/i);
    assert.ok(
      !/clearing your/.test(verdict.reason),
      'an uncontested mission must not be described as clearing a floor by a margin'
    );
  }
});

// ---------------------------------------------------------------------------
// 5. assumed / unmodeledModifiers TRAVEL WITH THE VERDICT
// ---------------------------------------------------------------------------

test('assumed and unmodeledModifiers reach the verdict on both the pass and the veto path', () => {
  const assumedOdds = { ...STRADDLING_ODDS, assumed: true, unmodeledModifiers: ['PublicOpinion', 'Democracy'] };

  const vetoed = assessRiskFloor(buildWorld({ riskFloorPercent: 95 }), pairingWithOdds(assumedOdds));
  assert.strictEqual(vetoed.outcome, 'veto');
  assert.strictEqual(vetoed.assumed, true);
  assert.deepStrictEqual(vetoed.unmodeledModifiers, ['PublicOpinion', 'Democracy']);
  assert.match(vetoed.reason, /assumed rather than measured/i);
  assert.match(vetoed.reason, /PublicOpinion/);

  const passed = assessRiskFloor(buildWorld({ riskFloorPercent: 85 }), pairingWithOdds(assumedOdds));
  assert.strictEqual(passed.outcome, 'pass');
  assert.strictEqual(passed.assumed, true);
  assert.deepStrictEqual(passed.unmodeledModifiers, ['PublicOpinion', 'Democracy']);
});

test('a small margin on an assumed estimate is flagged marginal; a wide one and a measured one are not', () => {
  const assumedOdds = { ...STRADDLING_ODDS, assumed: true, unmodeledModifiers: ['PublicOpinion'] };
  const bandLow = STRADDLING_ODDS.band[0]; // 89

  const tight = assessRiskFloor(buildWorld({ riskFloorPercent: bandLow - MARGINAL_CLEARANCE_POINTS }), pairingWithOdds(assumedOdds));
  assert.strictEqual(tight.outcome, 'pass');
  assert.strictEqual(tight.marginal, true);
  assert.match(tight.reason, /marginal clearance on an assumed estimate/i);

  const wide = assessRiskFloor(buildWorld({ riskFloorPercent: bandLow - MARGINAL_CLEARANCE_POINTS - 1 }), pairingWithOdds(assumedOdds));
  assert.strictEqual(wide.outcome, 'pass');
  assert.strictEqual(wide.marginal, false);

  const measured = assessRiskFloor(buildWorld({ riskFloorPercent: bandLow }), pairingWithOdds(STRADDLING_ODDS));
  assert.strictEqual(measured.outcome, 'pass');
  assert.strictEqual(measured.assumed, false);
  assert.strictEqual(measured.marginal, false, 'a measured estimate is never flagged marginal');
});

// ---------------------------------------------------------------------------
// SCOPE: the rule is a registry rule, and it never runs at the candidate stage
// ---------------------------------------------------------------------------

test('the risk floor is a registry veto scoped to pairings, appended after cost/affordability', () => {
  const ids = RULES.map((rule) => rule.id);
  assert.strictEqual(ids[ids.length - 1], 'risk/success-floor');
  assert.strictEqual(ids[ids.length - 2], 'cost/affordability', 'the twelve existing positions must be untouched');
  assert.strictEqual(successFloor.kind, 'veto');
  assert.strictEqual(ruleScope(successFloor), 'pairing');
  for (const rule of RULES) {
    if (rule.id === 'risk/success-floor') continue;
    assert.strictEqual(ruleScope(rule), 'candidate', `${rule.id} must stay candidate-scoped`);
  }
});

test('the candidate stage never evaluates the pairing rule, so no candidate is swept into uncertain by it', () => {
  const world = buildWorld({ riskFloorPercent: 90 });
  const bareCandidate = straddlingCandidate();
  assert.strictEqual(bareCandidate.odds, undefined, 'a candidate carries no odds — that is the whole point');
  assert.strictEqual(successFloor.appliesTo(bareCandidate), false);

  const candidateOutcomes = evaluateVetoes(world, bareCandidate).map((entry) => entry.rule.id);
  assert.ok(!candidateOutcomes.includes('risk/success-floor'));

  const pairingOutcomes = evaluatePairingVetoes(world, pairingWithOdds(STRADDLING_ODDS)).map((entry) => entry.rule.id);
  assert.deepStrictEqual(pairingOutcomes, ['risk/success-floor']);
});

test('applyPairingRules reports the three outcomes and carries the structured detail', () => {
  const world = buildWorld({ riskFloorPercent: 90 });

  const vetoed = applyPairingRules(world, pairingWithOdds(STRADDLING_ODDS));
  assert.strictEqual(vetoed.outcome, 'veto');
  assert.strictEqual(vetoed.entries[0].ruleId, 'risk/success-floor');
  assert.strictEqual(vetoed.entries[0].detail.bandLow, 89);
  assert.strictEqual(typeof vetoed.entries[0].source, 'string');

  const unknown = applyPairingRules(world, pairingWithOdds({ ...STRADDLING_ODDS, available: false }));
  assert.strictEqual(unknown.outcome, 'unknown');

  const passed = applyPairingRules(world, pairingWithOdds({ ...STRADDLING_ODDS, band: [95, 99], point: 97 }));
  assert.strictEqual(passed.outcome, 'pass');

  // A subject with no odds is not a pairing this rule can judge, and "nothing
  // was checked" is a fourth honest answer rather than a pass.
  const nothingChecked = applyPairingRules(world, { candidate: straddlingCandidate() });
  assert.strictEqual(nothingChecked.outcome, null);
  assert.deepStrictEqual(nothingChecked.entries, []);
});

// ---------------------------------------------------------------------------
// THE CYCLE PLAN
// ---------------------------------------------------------------------------

function planWith(floor, candidates, councilors) {
  return allocateCyclePlan(candidates, councilors, buildWorld({ observerId: 4712, riskFloorPercent: floor }));
}

test('the cycle plan drops a below-floor pairing, keeps it one point lower, and names both numbers', () => {
  const candidates = [straddlingCandidate()];
  const councilors = [operative()];

  const kept = planWith(89, candidates, councilors);
  assert.strictEqual(kept.assignments.length, 1, 'a floor at the band low keeps the action');
  assert.strictEqual(kept.assignments[0].candidateId, 'synthetic-purge');
  assert.strictEqual(kept.riskFloorVetoedTotalCount, 0);

  const dropped = planWith(90, candidates, councilors);
  assert.strictEqual(dropped.assignments.length, 0, 'a floor one point above the band low drops it');
  assert.strictEqual(dropped.riskFloorVetoedTotalCount, 1);
  assert.strictEqual(dropped.riskFloorVetoed[0].bandLow, 89);
  assert.strictEqual(dropped.riskFloorVetoed[0].point, 93);
  assert.strictEqual(dropped.riskFloorVetoed[0].floorPercent, 90);
  assert.match(dropped.riskFloorVetoed[0].reason, /89%.*90% floor/);
});

test('a councilor whose every option is below the floor reports that, not an empty slot', () => {
  const plan = planWith(90, [straddlingCandidate()], [operative()]);
  assert.strictEqual(plan.unassigned.length, 1);
  const idle = plan.unassigned[0];
  assert.strictEqual(idle.reason, 'risk-floor');
  assert.match(idle.reasonDetail, /no action clears your 90% risk floor/i);
  assert.strictEqual(idle.riskFloorHeld.floorPercent, 90);
  assert.strictEqual(idle.riskFloorHeld.heldCount, 1);
  assert.strictEqual(idle.riskFloorHeld.closestBandLow, 89);

  // And the below-floor action is NOT offered as a fallback anywhere in the
  // slot's own advice: the suggested action is a free action, not the mission
  // the floor just rejected.
  assert.ok(!/purge/i.test(String(idle.suggestedFreeAction)));
  assert.ok(!/purge/i.test(idle.reasonDetail));
});

test('a benched candidate held by the floor says so instead of blaming a higher-value rival', () => {
  const plan = planWith(90, [straddlingCandidate()], [operative()]);
  const benched = plan.benched.find((entry) => entry.candidateId === 'synthetic-purge');
  assert.ok(benched, 'the held candidate still appears as benched');
  assert.strictEqual(benched.riskFloorHeld, true);
  assert.match(benched.displacedBy, /risk floor/i);
  assert.ok(!/Displaced by higher expected value/i.test(benched.displacedBy));
});

test('a pairing whose odds are unavailable stays eligible, is recorded, and says the floor was unchecked', () => {
  // No missionSpec attack attribute -> computeMissionOdds returns available:false.
  const unpriceable = straddlingCandidate({
    id: 'synthetic-unknown-odds',
    missionSpec: { dataName: 'Purge', friendlyName: 'Purge', contested: true, conditions: [] }
  });
  const plan = planWith(90, [unpriceable], [operative()]);

  assert.strictEqual(plan.assignments.length, 1, 'unknown is not a veto');
  assert.strictEqual(plan.assignments[0].riskFloor.outcome, 'unknown');
  assert.strictEqual(plan.riskFloorVetoedTotalCount, 0);
  assert.strictEqual(plan.riskFloorUnverifiedTotalCount, 1);
  assert.match(plan.riskFloorUnverified[0].reason, /could not be checked/i);
  // Not silently admitted: the card's own reasoning carries the caveat.
  assert.ok(
    plan.assignments[0].why.some((line) => /floor could not be checked/i.test(line)),
    `the assignment must state that the floor was unchecked: ${JSON.stringify(plan.assignments[0].why)}`
  );
});

test('a floor of 0 leaves the plan byte-identical to a plan with no floor at all', () => {
  const candidates = [straddlingCandidate()];
  const councilors = [operative()];
  const strip = (plan) => JSON.stringify({
    assignments: plan.assignments.map((a) => a.candidateId),
    unassigned: plan.unassigned.map((u) => [u.reason, u.reasonDetail]),
    benched: plan.benched.map((b) => [b.candidateId, b.displacedBy])
  });

  const zero = planWith(0, candidates, councilors);
  const absent = allocateCyclePlan(candidates, councilors, buildWorld({ observerId: 4712 }));

  assert.strictEqual(strip(zero), strip(absent));
  assert.strictEqual(zero.assignments.length, 1, 'a floor of 0 vetoes nothing');
  assert.strictEqual(zero.riskFloorVetoedTotalCount, 0);
  assert.deepStrictEqual(zero.riskFloor, { percent: 0, inForce: false, configured: true });
  assert.deepStrictEqual(absent.riskFloor, { percent: null, inForce: false, configured: false });
});

test('the held-back list announces its truncation rather than presenting a slice as the whole set', () => {
  // 40 councilors x 1 below-floor candidate = 40 vetoed pairings against a
  // 25-entry transport cap.
  const councilors = Array.from({ length: 40 }, (_, i) => operative({ ID: 9100 + i, displayName: `Operative ${i}` }));
  const plan = planWith(90, [straddlingCandidate()], councilors);

  assert.strictEqual(plan.riskFloorVetoedTotalCount, 40);
  assert.strictEqual(plan.riskFloorVetoed.length, 25);
  assert.strictEqual(plan.riskFloorVetoedOmittedCount, 15);
  assert.strictEqual(
    plan.riskFloorVetoed.length + plan.riskFloorVetoedOmittedCount,
    plan.riskFloorVetoedTotalCount
  );
});

test('the benched list announces its truncation rather than presenting a slice as the whole set', () => {
  // 20 distinct candidates against a single operative: one is assigned and the
  // other 19 land on the bench, well past the 8-entry transport cap. On the
  // live save this cap bites at 46 (player) and 427 (omniscient), so a bench
  // presented without its total is 8 rows standing in for hundreds.
  const candidates = Array.from({ length: 20 }, (_, i) => straddlingCandidate({
    id: `synthetic-purge-${i}`,
    title: `Purge rival cell ${i}`,
    target: { kind: 'councilor', councilorName: `Target ${i}` }
  }));
  const plan = planWith(0, candidates, [operative()]);

  assert.strictEqual(plan.benched.length, 8, 'the bench is capped at 8 for transport');
  assert.strictEqual(plan.benchedTotalCount, 19, 'the true bench total travels with the capped list');
  assert.strictEqual(plan.benchedOmittedCount, 11);
  assert.strictEqual(
    plan.benched.length + plan.benchedOmittedCount,
    plan.benchedTotalCount,
    'shown + omitted must reconstruct the total'
  );

  // `committed` and `unassigned` are bounded by the councilor roster rather
  // than by candidate breadth, so they are emitted whole and must NOT sprout
  // counts that would imply a cap they do not have.
  assert.strictEqual(plan.committedTotalCount, undefined);
  assert.strictEqual(plan.unassignedTotalCount, undefined);
});

test('an uncapped bench reports zero omitted rather than omitting the field', () => {
  const plan = planWith(0, [straddlingCandidate(), straddlingCandidate({ id: 'synthetic-purge-b' })], [operative()]);
  assert.ok(plan.benched.length < 8, 'this fixture must sit under the cap or it proves nothing');
  assert.strictEqual(plan.benchedTotalCount, plan.benched.length);
  assert.strictEqual(plan.benchedOmittedCount, 0);
});

// ---------------------------------------------------------------------------
// WHICH EIGHT SURVIVE THE CAP, AND IN WHAT ORDER THEY ARE EMITTED
//
// Two separable questions, and until 2026-08-22 the code answered both with
// "the first eight generated". Measured on the frozen `ExitSave.gz`, that put
// six score-3 Investigate/Turn rows on the omniscient bench while five 68.75
// purges sat among the 419 hidden.
//
// SELECTION is now by score; PRESENTATION stays generation order, because
// registry emission order is load-bearing for how explanations are built. The
// fixture below is a PERMUTATION of scores against generation index precisely
// so that the two properties fail separately: a slice of generation order picks
// a different SET, and a ranked emission produces a different SEQUENCE from the
// same set.
// ---------------------------------------------------------------------------

// score[i] = (i * 7) % 20 -- a full-cycle permutation of 0..19, so no prefix of
// generation order is a prefix of score order and vice versa.
const PERMUTED_SCORES = Array.from({ length: 20 }, (_, i) => (i * 7) % 20);

function permutedBenchPlan() {
  const candidates = PERMUTED_SCORES.map((score, i) => straddlingCandidate({
    id: `perm-${i}`,
    title: `Permuted candidate ${i}`,
    score,
    target: { kind: 'councilor', councilorName: `Target ${i}` }
  }));
  return planWith(0, candidates, [operative()]);
}

test('the bench cap SELECTS the highest-scoring eight, not the first eight generated', () => {
  const plan = permutedBenchPlan();
  assert.strictEqual(plan.benched.length, 8);

  // The claimed candidate is whichever one the allocator assigned; the bench is
  // everything else. Deriving the expectation from the FIXTURE's own declared
  // scores rather than from the plan's bench is what keeps this from passing by
  // construction.
  const claimed = new Set(plan.assignments.map((a) => a.candidateId));
  const benchable = PERMUTED_SCORES
    .map((score, index) => ({ id: `perm-${index}`, score, index }))
    .filter((row) => !claimed.has(row.id));
  assert.strictEqual(benchable.length, 19, 'exactly one candidate must be assigned or the fixture is wrong');

  const bySelection = [...benchable].sort((a, b) => (b.score - a.score) || (a.index - b.index));
  const expectedIds = new Set(bySelection.slice(0, 8).map((row) => row.id));
  assert.deepStrictEqual(
    new Set(plan.benched.map((b) => b.candidateId)),
    expectedIds,
    'the eight carried must be the eight highest-scoring'
  );

  // Stated as a fact rather than as a re-run of the algorithm: every carried
  // entry outscores every dropped one.
  const carried = plan.benched.map((b) => b.score);
  const dropped = bySelection.slice(8).map((row) => row.score);
  assert.ok(
    Math.min(...carried) > Math.max(...dropped),
    `the worst carried score (${Math.min(...carried)}) must beat the best dropped one (${Math.max(...dropped)})`
  );

  // The old behaviour, pinned negatively: a slice of generation order would
  // have carried perm-0 (score 0) and perm-3 (score 1).
  const carriedIds = plan.benched.map((b) => b.candidateId);
  assert.ok(!carriedIds.includes('perm-0'), 'a generation-order slice would have carried the score-0 candidate');
  assert.ok(!carriedIds.includes('perm-3'), 'a generation-order slice would have carried the score-1 candidate');
});

test('the selected eight are EMITTED in generation order, so the bench is not a ranking', () => {
  const plan = permutedBenchPlan();
  const carriedIndices = plan.benched.map((b) => Number(b.candidateId.replace('perm-', '')));

  assert.deepStrictEqual(
    carriedIndices,
    [...carriedIndices].sort((a, b) => a - b),
    'the carried entries must appear in candidate-generation order'
  );

  // And the scores must NOT be monotonic, or "generation order" and "ranked
  // order" would be indistinguishable and this test would prove nothing. The
  // permutation guarantees it; asserting it makes the guarantee load-bearing.
  const scores = plan.benched.map((b) => b.score);
  const descending = [...scores].sort((a, b) => b - a);
  const ascending = [...scores].sort((a, b) => a - b);
  assert.notDeepStrictEqual(scores, descending, 'the emitted bench must not be ranked highest-first');
  assert.notDeepStrictEqual(scores, ascending, 'the emitted bench must not be ranked lowest-first');
});

test('tied scores break on generation index, so two runs of one save agree', () => {
  // Ties are the COMMON case, not an edge one: 39 of the 427 omniscient bench
  // entries on the frozen save score exactly 3.
  const candidates = Array.from({ length: 12 }, (_, i) => straddlingCandidate({
    id: `tie-${i}`,
    title: `Tied candidate ${i}`,
    score: 3,
    target: { kind: 'councilor', councilorName: `Target ${i}` }
  }));
  const first = planWith(0, candidates, [operative()]);
  const second = planWith(0, candidates, [operative()]);

  const ids = first.benched.map((b) => b.candidateId);
  assert.strictEqual(ids.length, 8);
  assert.deepStrictEqual(ids, second.benched.map((b) => b.candidateId),
    'an all-tied bench must select the same eight on every run');
  // The stated tiebreak: earliest generated wins. One candidate is assigned, so
  // the bench starts at tie-1.
  assert.deepStrictEqual(ids, ['tie-1', 'tie-2', 'tie-3', 'tie-4', 'tie-5', 'tie-6', 'tie-7', 'tie-8']);
});

test('a candidate whose score cannot be read sorts LAST, never as a zero that outranks negatives', () => {
  // Eight genuinely negative scores against one unreadable one, into an
  // 8-entry cap. `Number('not-a-number')` is NaN and `Number(null)` is 0 --
  // either coercion would rank the unreadable candidate above all eight
  // measured ones and drop a real entry to make room for it.
  const candidates = [
    straddlingCandidate({ id: 'winner', title: 'Winner', score: 100, target: { kind: 'councilor', councilorName: 'W' } }),
    ...Array.from({ length: 8 }, (_, i) => straddlingCandidate({
      id: `neg-${i}`,
      title: `Negative ${i}`,
      score: -(i + 1),
      target: { kind: 'councilor', councilorName: `N${i}` }
    })),
    straddlingCandidate({
      id: 'unreadable',
      title: 'Unreadable score',
      score: 'not-a-number',
      target: { kind: 'councilor', councilorName: 'U' }
    })
  ];
  const plan = planWith(0, candidates, [operative()]);

  assert.deepStrictEqual(plan.assignments.map((a) => a.candidateId), ['winner'],
    'the fixture needs the high scorer assigned so exactly nine reach the bench');
  assert.strictEqual(plan.benched.length, 8);
  assert.strictEqual(plan.benchedTotalCount, 9);
  assert.strictEqual(plan.benchedOmittedCount, 1);

  const ids = plan.benched.map((b) => b.candidateId);
  assert.ok(!ids.includes('unreadable'),
    'an unreadable score must not take a bench place from a measured one');
  assert.deepStrictEqual(ids, ['neg-0', 'neg-1', 'neg-2', 'neg-3', 'neg-4', 'neg-5', 'neg-6', 'neg-7'],
    'every measured candidate survives, including the -8');
});

test('the bench counts are taken over the WHOLE bench, not over the selected slice', () => {
  const plan = permutedBenchPlan();
  assert.strictEqual(plan.benched.length, 8);
  assert.strictEqual(plan.benchedTotalCount, 19,
    'the total must count every benched candidate, not the eight that survived the cap');
  assert.strictEqual(plan.benchedOmittedCount, 11);
  assert.strictEqual(plan.benched.length + plan.benchedOmittedCount, plan.benchedTotalCount);
});

// ---------------------------------------------------------------------------
// WHETHER THE SURVIVORS ARE DIFFERENT FROM EACH OTHER
//
// A third question the cap has to answer, and score-selection alone answers it
// badly. Measured on frozen `ExitSave.gz` (md5 5c0d9ef98213c91d8187ae11bf885d57)
// the best eight INDIVIDUALS were 2 distinct mission shapes across 8 omniscient
// rows -- five "Purge the Protectorate hold on … in China" siblings of the
// primary recommendation itself, then three India purges -- so the bench read
// "five more of the thing you were already told to do" while 419 rows stayed
// hidden.
//
// The cap now selects the best eight GROUPS, keyed on mission + the COARSE
// target entity. Measured: 8 distinct shapes over the same 8 rows, accounting
// for 33 of 427 candidates rather than 8, with the best candidate no row stands
// for falling from 50.64 to 23.74. Player mode is untouched -- 46 groups from 46
// candidates, nothing collapses, and the emitted rows are identical.
//
// The existing bench fixtures above target `{ kind: 'councilor', councilorName }`
// with NO `councilorId`, which is deliberately UNGROUPABLE, so every assertion
// above still describes singleton rows and none of them needed editing.
// ---------------------------------------------------------------------------

const {
  BENCH_SELECTION_LIMIT,
  benchGroupIdentity,
  describeBenchGroup,
  selectBenchRows
} = require('../shared/benchSelection.mjs');
const { looksUnresolved } = require('../shared/util.mjs');
const { looksUnresolved: normalizeLooksUnresolved } = require('../server/engine/candidates/normalize');

/** A Purge against one control point inside a named nation. */
function purgeIn(nation, index, score) {
  return straddlingCandidate({
    id: `purge-${nation}-${index}`,
    title: `Purge rival hold ${index} in ${nation}`,
    score,
    target: { kind: 'controlPoint', nation }
  });
}

/** The high scorer the allocator will assign, kept out of every group. */
function assignedWinner() {
  return straddlingCandidate({
    id: 'winner',
    title: 'Winner',
    score: 1000,
    target: { kind: 'councilor', councilorName: 'W' }
  });
}

// Four groups: 5 China purges (identical scores), 3 India purges (a SPREAD, so
// the spread note form is exercised on live output rather than assumed away),
// 2 Defend Interests in China -- same nation, DIFFERENT mission, so a different
// group -- and one lone Brazil purge. Eleven benched candidates, four rows.
function groupedBenchPlan() {
  const candidates = [
    assignedWinner(),
    ...[0, 1, 2, 3, 4].map((i) => purgeIn('China', i, 68.75)),
    ...[0, 1, 2].map((i) => purgeIn('India', i, 50.64 - i * 1.77)),
    ...[0, 1].map((i) => straddlingCandidate({
      id: `defend-China-${i}`,
      title: `Defend Interests ${i} in China`,
      missionType: 'Defend Interests',
      score: 30,
      target: { kind: 'controlPoint', nation: 'China' }
    })),
    purgeIn('Brazil', 0, 10)
  ];
  return planWith(0, candidates, [operative()]);
}

test('the bench carries one row per (mission, target) group, not one per sibling', () => {
  const plan = groupedBenchPlan();
  assert.deepStrictEqual(plan.assignments.map((a) => a.candidateId), ['winner'],
    'the fixture needs exactly the winner assigned or the group sizes below are wrong');

  // Eleven benched candidates. Ungrouped they would fill the cap with eight
  // rows, five of them China siblings; grouped they are four distinct options.
  assert.strictEqual(plan.benchedTotalCount, 11);
  assert.strictEqual(plan.benched.length, 4,
    'four groups exist, so four rows are carried -- not eight sibling rows');
  assert.ok(plan.benched.length < BENCH_SELECTION_LIMIT,
    'the fixture must sit UNDER the cap, or "4 rows" could be a cap artefact rather than grouping');

  // Stated as identities rather than as a re-run of the algorithm.
  const rows = new Map(plan.benched.map((b) => [b.candidateId, b]));
  assert.deepStrictEqual(
    [...rows.keys()].sort(),
    ['defend-China-0', 'purge-Brazil-0', 'purge-China-0', 'purge-India-0'].sort()
  );

  // Same nation, different mission: NOT merged. Family-based grouping was
  // measured and rejected partly because it folds distinct actions together.
  assert.ok(rows.has('purge-China-0') && rows.has('defend-China-0'),
    'Purge and Defend Interests in one nation are two options, not one');
});

test('a collapsed row says how many candidates it stands for, and its note names them', () => {
  const plan = groupedBenchPlan();
  const rows = new Map(plan.benched.map((b) => [b.candidateId, b]));

  const china = rows.get('purge-China-0');
  assert.strictEqual(china.groupCount, 5);
  assert.strictEqual(china.groupOmittedCount, 4);
  assert.strictEqual(china.groupNote, '+4 more Purge options in China, all scoring 68.75');

  const india = rows.get('purge-India-0');
  assert.strictEqual(india.groupCount, 3);
  assert.strictEqual(india.groupOmittedCount, 2);
  // The SPREAD form. All seven collapsed groups on the live save happen to have
  // a spread of exactly 0.00, so this form only exists if a fixture creates it.
  assert.strictEqual(india.groupNote, '+2 more Purge options in India, scoring 50.64 down to 47.10');
  assert.strictEqual(india.groupScoreHigh, 50.64);
  assert.strictEqual(india.groupScoreLow, 47.10);

  const brazil = rows.get('purge-Brazil-0');
  assert.strictEqual(brazil.groupCount, 1, 'a group of one is still a group');
  assert.strictEqual(brazil.groupOmittedCount, 0);
  assert.strictEqual(brazil.groupNote, null, 'a singleton must not claim siblings it does not have');

  // Every row carries the fields, always -- an absent count is what a consumer
  // would render as "+undefined more".
  for (const row of plan.benched) {
    assert.ok(Number.isInteger(row.groupCount) && row.groupCount >= 1, `groupCount on ${row.candidateId}`);
    assert.strictEqual(row.groupOmittedCount, row.groupCount - 1);
    assert.ok(Object.hasOwn(row, 'groupScoreLow') && Object.hasOwn(row, 'groupScoreHigh'));
    assert.ok(Number.isInteger(row.groupRiskFloorHeldCount));
  }
});

test('the three bench counts reconcile, and the represented count is the sum of the group counts', () => {
  const plan = groupedBenchPlan();

  // The NEW figure: how many candidates the carried rows actually account for.
  // Every benched candidate belongs to one of the four groups, so all eleven.
  assert.strictEqual(plan.benchedRepresentedCount, 11);
  assert.strictEqual(
    plan.benched.reduce((sum, row) => sum + row.groupCount, 0),
    plan.benchedRepresentedCount,
    'benchedRepresentedCount must be the sum of the emitted groupCounts'
  );

  // The EXISTING invariant, unchanged: `benchedOmittedCount` still counts rows
  // not carried, so these two still reconstruct the total.
  assert.strictEqual(plan.benchedOmittedCount, 7);
  assert.strictEqual(
    plan.benched.length + plan.benchedOmittedCount,
    plan.benchedTotalCount,
    'shown + omitted must still reconstruct the total'
  );

  assert.ok(plan.benched.length <= plan.benchedRepresentedCount);
  assert.ok(plan.benchedRepresentedCount <= plan.benchedTotalCount);
});

test('an unreadable group key makes a record its own group of one — never a shared unknown bucket', () => {
  // Five candidates that would be one group if `councilorName` were allowed to
  // stand in for a missing `councilorId`. Two councilors can share a display
  // name, so merging them would FABRICATE an identity.
  const nameless = Array.from({ length: 5 }, (_, i) => straddlingCandidate({
    id: `nameless-${i}`,
    title: `Investigate the mole ${i}`,
    missionType: 'Investigate Councilor',
    score: 40 - i,
    target: { kind: 'councilor', councilorName: 'Alexandra Bureau' }
  }));
  const plan = planWith(0, [assignedWinner(), ...nameless], [operative()]);

  assert.strictEqual(plan.benchedTotalCount, 5);
  assert.strictEqual(plan.benched.length, 5, 'five unidentifiable records are five rows, never one');
  for (const row of plan.benched) {
    assert.strictEqual(row.groupCount, 1, `${row.candidateId} must stand alone`);
    assert.strictEqual(row.groupNote, null);
  }
  assert.strictEqual(plan.benchedRepresentedCount, 5);

  // The rule stated directly on the identity function: a name is not an id.
  assert.strictEqual(
    benchGroupIdentity({ missionType: 'Investigate Councilor', target: { kind: 'councilor', councilorName: 'Alexandra Bureau' } }),
    null
  );
  assert.strictEqual(
    benchGroupIdentity({ missionType: 'Investigate Councilor', target: { kind: 'councilor', councilorId: 7, councilorName: 'Alexandra Bureau' } }).key,
    'Investigate Councilor|councilor:7'
  );

  // An unrecognised target kind is ungroupable too -- the safe direction.
  assert.strictEqual(
    benchGroupIdentity({ missionType: 'Detain', target: { kind: 'alienCouncilor', councilorId: 12 } }),
    null
  );
});

test('a literal "undefined" in the key is unreadable, not a valid group everything collapses onto', () => {
  // `${nation.id || nation.name}` on a record carrying neither stringifies to
  // "undefined", which is a perfectly valid Map key. That exact string has
  // collapsed records twice in this repo's history.
  for (const poison of ['undefined', 'null', 'NaN', '', '   ', null, undefined]) {
    assert.strictEqual(
      benchGroupIdentity({ missionType: 'Purge', target: { kind: 'controlPoint', nation: poison } }),
      null,
      `nation=${JSON.stringify(poison)} must not produce a group key`
    );
  }
  // And a legitimate name that merely CONTAINS the token is not rejected.
  assert.strictEqual(
    benchGroupIdentity({ missionType: 'Purge', target: { kind: 'controlPoint', nation: 'Nullarbor Republic' } }).key,
    'Purge|nation:Nullarbor Republic'
  );

  // The scope ID and the scope LABEL are checked independently. On a
  // `controlPoint` the two read the same field, so a test using only that kind
  // proves whichever check runs first and nothing about the other -- and
  // `nation`/`hab` are exactly the kinds where they diverge (`id ?? name`
  // against `displayName ?? name`).
  assert.strictEqual(
    benchGroupIdentity({ missionType: 'Advise', target: { kind: 'nation', id: 'nation-undefined', displayName: 'Chad' } }),
    null,
    'an unresolved id must not group, however readable its display name'
  );
  assert.strictEqual(
    benchGroupIdentity({ missionType: 'Advise', target: { kind: 'nation', id: 77, displayName: 'undefined' } }),
    null,
    'an unresolved label must not group, however readable its id'
  );
  assert.strictEqual(
    benchGroupIdentity({ missionType: 'Advise', target: { kind: 'nation', id: 77, displayName: 'Chad' } }).key,
    'Advise|nation:77'
  );
  // The mission name is a component too.
  for (const badMission of ['', '   ', 'undefined', null, undefined, 7]) {
    assert.strictEqual(
      benchGroupIdentity({ missionType: badMission, target: { kind: 'nation', id: 77, displayName: 'Chad' } }),
      null,
      `missionType=${JSON.stringify(badMission)} must not produce a group key`
    );
  }
  // As is the target kind, and an absent target altogether.
  assert.strictEqual(benchGroupIdentity({ missionType: 'Advise', target: { id: 77, displayName: 'Chad' } }), null);
  assert.strictEqual(benchGroupIdentity({ missionType: 'Advise' }), null);
  assert.strictEqual(benchGroupIdentity(null), null);
  // `type` is accepted where `kind` is absent, which is the pair
  // `normalizeCandidate` mirrors.
  assert.strictEqual(
    benchGroupIdentity({ missionType: 'Advise', target: { type: 'nation', id: 77, displayName: 'Chad' } }).key,
    'Advise|nation:77'
  );

  const poisoned = Array.from({ length: 4 }, (_, i) => straddlingCandidate({
    id: `poison-${i}`,
    title: `Purge somewhere ${i}`,
    score: 40 - i,
    target: { kind: 'controlPoint', nation: 'undefined' }
  }));
  const plan = planWith(0, [assignedWinner(), ...poisoned], [operative()]);
  assert.strictEqual(plan.benched.length, 4, 'four "undefined" nations are four rows, not one');
  assert.strictEqual(plan.benchedRepresentedCount, 4);
  for (const row of plan.benched) assert.strictEqual(row.groupCount, 1);

  // `looksUnresolved` is the SAME FUNCTION OBJECT the candidate normalizer uses.
  // It moved to shared/util.mjs so the worker-safe module could read it; a copy
  // is how `sameId` once split into two rules that disagreed.
  assert.strictEqual(looksUnresolved, normalizeLooksUnresolved);
});

test('a group is represented by its highest scorer, ties broken by earliest generation', () => {
  // Generation order 0..2 against scores 10, 40, 25: neither the first nor the
  // last generated is the best, so a representative rule that took either would
  // be caught here.
  const spread = [
    purgeIn('Chile', 0, 10),
    purgeIn('Chile', 1, 40),
    purgeIn('Chile', 2, 25)
  ];
  const spreadPlan = planWith(0, [assignedWinner(), ...spread], [operative()]);
  assert.strictEqual(spreadPlan.benched.length, 1);
  assert.strictEqual(spreadPlan.benched[0].candidateId, 'purge-Chile-1',
    'the representative must be the group\'s best scorer, not its first or last member');
  assert.strictEqual(spreadPlan.benched[0].score, 40);
  assert.strictEqual(spreadPlan.benched[0].groupScoreHigh, 40);
  assert.strictEqual(spreadPlan.benched[0].groupScoreLow, 10);

  // Ties are the common case -- 39 of the 427 omniscient bench entries score
  // exactly 3 -- so the tiebreak is stated rather than left to sort stability.
  const tied = [0, 1, 2, 3].map((i) => purgeIn('Peru', i, 12));
  const tiedPlan = planWith(0, [assignedWinner(), ...tied], [operative()]);
  assert.strictEqual(tiedPlan.benched.length, 1);
  assert.strictEqual(tiedPlan.benched[0].candidateId, 'purge-Peru-0',
    'an all-tied group is represented by its earliest-generated member');
  assert.strictEqual(tiedPlan.benched[0].groupCount, 4);
});

// A permutation of scores against generation index, one group per candidate, so
// that "grouping is on" cannot hide a reordering. score[i] = (i * 7) % 20.
function permutedGroupedBenchPlan() {
  const candidates = PERMUTED_SCORES.map((score, i) => straddlingCandidate({
    id: `pg-${i}`,
    title: `Permuted grouped candidate ${i}`,
    score,
    target: { kind: 'controlPoint', nation: `Nation ${i}` }
  }));
  return planWith(0, candidates, [operative()]);
}

test('grouping does not reorder the bench — emission stays candidate-generation order', () => {
  const plan = permutedGroupedBenchPlan();
  assert.strictEqual(plan.benched.length, 8);

  const carriedIndices = plan.benched.map((b) => Number(b.candidateId.replace('pg-', '')));
  assert.deepStrictEqual(
    carriedIndices,
    [...carriedIndices].sort((a, b) => a - b),
    'the carried rows must appear in candidate-generation order'
  );

  // And the scores must NOT be monotonic, or "generation order" and "ranked
  // order" would be indistinguishable and this test would prove nothing.
  const scores = plan.benched.map((b) => b.score);
  assert.notDeepStrictEqual(scores, [...scores].sort((a, b) => b - a));
  assert.notDeepStrictEqual(scores, [...scores].sort((a, b) => a - b));

  // Every row is its own group here, so the represented count must equal the
  // row count -- grouping that merged unrelated nations would show up as more.
  assert.strictEqual(plan.benchedRepresentedCount, 8);
});

test('two runs of one fixture agree, rows and counts alike', () => {
  const first = groupedBenchPlan();
  const second = groupedBenchPlan();
  assert.deepStrictEqual(first.benched, second.benched);
  assert.strictEqual(first.benchedRepresentedCount, second.benchedRepresentedCount);
  assert.strictEqual(first.benchedTotalCount, second.benchedTotalCount);
  assert.strictEqual(first.benchedOmittedCount, second.benchedOmittedCount);
});

test('a group whose members could not be scored reports a null range, never a range of zero', () => {
  // `Number(null) === 0`, so an unscored group is the exact shape that renders
  // as a confident "all scoring 0.00" if presence is not checked first.
  const { rows } = selectBenchRows([
    { selectionScore: null, identity: benchGroupIdentity({ missionType: 'Purge', target: { kind: 'controlPoint', nation: 'Chad' } }), entry: { candidateId: 'a' } },
    { selectionScore: null, identity: benchGroupIdentity({ missionType: 'Purge', target: { kind: 'controlPoint', nation: 'Chad' } }), entry: { candidateId: 'b' } }
  ], { limit: 8 });

  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].groupCount, 2);
  assert.strictEqual(rows[0].groupScoreLow, null);
  assert.strictEqual(rows[0].groupScoreHigh, null);
  assert.notStrictEqual(rows[0].groupScoreLow, 0);
  assert.strictEqual(rows[0].groupNote, '+1 more Purge option in Chad; their scores could not be read');
});

test('a partly-scored group reports the range it read and says how many it did not', () => {
  const identity = benchGroupIdentity({ missionType: 'Purge', target: { kind: 'controlPoint', nation: 'Chad' } });
  const { rows } = selectBenchRows([
    { selectionScore: 9, identity, entry: { candidateId: 'a' } },
    { selectionScore: null, identity, entry: { candidateId: 'b' } },
    { selectionScore: 9, identity, entry: { candidateId: 'c' } }
  ], { limit: 8 });

  assert.strictEqual(rows[0].groupCount, 3);
  assert.strictEqual(rows[0].groupScoreLow, 9);
  assert.strictEqual(rows[0].groupScoreHigh, 9);
  // "all scoring 9.00" would be a claim about a member nobody read.
  assert.strictEqual(
    rows[0].groupNote,
    '+2 more Purge options in Chad, scoring 9.00; 1 of the group carried no readable score'
  );
});

test('a mixed group does not read as uniformly risk-held', () => {
  const identity = benchGroupIdentity({ missionType: 'Purge', target: { kind: 'controlPoint', nation: 'Chad' } });
  const { rows, representedCount } = selectBenchRows([
    { selectionScore: 9, identity, entry: { candidateId: 'a', riskFloorHeld: false } },
    { selectionScore: 8, identity, entry: { candidateId: 'b', riskFloorHeld: true } },
    { selectionScore: 7, identity, entry: { candidateId: 'c', riskFloorHeld: true } }
  ], { limit: 8 });

  assert.strictEqual(representedCount, 3);
  // `riskFloorHeld` describes the REPRESENTATIVE; the count is what stops the
  // row reading as if the whole group cleared the floor.
  assert.strictEqual(rows[0].riskFloorHeld, false);
  assert.strictEqual(rows[0].groupRiskFloorHeldCount, 2);
});

test('the note describes the GROUP and takes its preposition from the target kind', () => {
  const forKind = (kind, label) => describeBenchGroup({
    identity: { kind, label, missionType: 'Advise' },
    count: 2,
    scoreLow: 4,
    scoreHigh: 4,
    unreadableScoreCount: 0
  });
  assert.match(forKind('nation', 'Chad'), /options? in Chad/);
  assert.match(forKind('controlPoint', 'Chad'), /options? in Chad/);
  assert.match(forKind('hab', 'Coronado Base'), /options? at Coronado Base/);
  assert.match(forKind('councilor', 'A. Bureau'), /options? against A\. Bureau/);
  assert.match(forKind('capability', 'the Aliens'), /options? against the Aliens/);

  // Nothing to describe: a singleton, and a group nobody could identify.
  assert.strictEqual(describeBenchGroup({ identity: { kind: 'nation', label: 'Chad', missionType: 'Advise' }, count: 1, scoreLow: 4, scoreHigh: 4 }), null);
  assert.strictEqual(describeBenchGroup({ identity: null, count: 3, scoreLow: 4, scoreHigh: 4 }), null);
});

// ---------------------------------------------------------------------------
// CONFIGURATION: absent means the configured default, and 0 is a real choice
// ---------------------------------------------------------------------------

// The shipped default is 0, so asserting "absent resolves to the default"
// against the shipped config would pass whether the code read the config or
// hard-coded a zero. These call the resolver with an INJECTED non-zero config
// so the two answers differ and the assertion means something.
const CONFIG_WITH_FLOOR = { config: { analysis: { riskTolerance: { riskFloorPercent: 90 } } } };
const resolve = (self, value) => briefingGenerator.resolveRiskFloorPercent.call(self, value);

test('an absent request parameter resolves to the configured default, not to 0', () => {
  for (const absent of [undefined, null, '']) {
    assert.strictEqual(resolve(CONFIG_WITH_FLOOR, absent), 90, `${JSON.stringify(absent)} must fall back to the configured 90`);
    assert.notStrictEqual(resolve(CONFIG_WITH_FLOOR, absent), 0);
  }
});

test('a supplied 0 stays 0 — it is the player choosing no floor, not an absent value', () => {
  assert.strictEqual(resolve(CONFIG_WITH_FLOOR, 0), 0);
  assert.strictEqual(resolve(CONFIG_WITH_FLOOR, '0'), 0);
});

test('a supplied floor overrides the configured default, and an unusable one falls back to it', () => {
  assert.strictEqual(resolve(CONFIG_WITH_FLOOR, 75), 75);
  for (const unusable of ['abc', NaN, -1, 101, {}]) {
    assert.strictEqual(resolve(CONFIG_WITH_FLOOR, unusable), 90, `${String(unusable)} must fall back, not clamp`);
  }
  // With no configuration at all the answer is null -- absent, not zero.
  assert.strictEqual(resolve({ config: {} }, undefined), null);
});

test('the shipped configuration carries a validated riskFloorPercent that defaults to no floor', () => {
  const config = resolveConfig();
  assert.strictEqual(config.analysis.riskTolerance.riskFloorPercent, 0);
  assert.strictEqual(briefingGenerator.resolveRiskFloorPercent(undefined), 0);
});

test('the schema rejects a floor outside 0..100 and a non-integer floor', () => {
  for (const bad of [101, -1, 90.5]) {
    assert.throws(
      () => resolveConfig({ cliOverrides: { analysis: { riskTolerance: { riskFloorPercent: bad } } } }),
      /Configuration validation failed/,
      `riskFloorPercent=${bad} must be rejected at load time`
    );
  }
  assert.doesNotThrow(() => resolveConfig({ cliOverrides: { analysis: { riskTolerance: { riskFloorPercent: 100 } } } }));
  assert.doesNotThrow(() => resolveConfig({ cliOverrides: { analysis: { riskTolerance: { riskFloorPercent: 0 } } } }));
});

test('the request parser accepts 0..100, rejects the rest, and treats an absent parameter as the default', () => {
  const configuredDefault = resolveConfig().analysis.riskTolerance.riskFloorPercent;

  assert.strictEqual(requestContext({ query: {} }).riskFloorPercent, configuredDefault);
  assert.strictEqual(requestContext({ query: { riskFloor: '' } }).riskFloorPercent, configuredDefault);
  assert.strictEqual(requestContext({ query: { riskFloor: '0' } }).riskFloorPercent, 0);
  assert.strictEqual(requestContext({ query: { riskFloor: '90' } }).riskFloorPercent, 90);
  assert.strictEqual(requestContext({ query: { riskFloor: '100' } }).riskFloorPercent, 100);

  for (const bad of ['abc', '101', '-1', '90.5', ' 90']) {
    assert.throws(
      () => requestContext({ query: { riskFloor: bad } }),
      /Invalid risk floor/,
      `riskFloor=${bad} must be a 400, not a silent clamp`
    );
  }
});

test('the briefing threads the request floor through to the cycle plan', () => {
  const snapshot = { metadata: {}, factions: [{ ID: 4712, displayName: 'the Initiative' }], observerFactionId: 4712 };
  const briefing = briefingGenerator.generateMissionControlBriefing(snapshot, null, { riskFloorPercent: 75 });
  assert.deepStrictEqual(
    briefing.engineDirectives.cyclePlan.riskFloor,
    { percent: 75, inForce: true, configured: true }
  );

  const defaulted = briefingGenerator.generateMissionControlBriefing(snapshot);
  assert.strictEqual(defaulted.engineDirectives.cyclePlan.riskFloor.percent, 0);
  assert.strictEqual(defaulted.engineDirectives.cyclePlan.riskFloor.inForce, false);
});
