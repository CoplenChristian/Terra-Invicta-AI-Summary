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

// ---------------------------------------------------------------------------
// THE LIVE CAMPAIGN, IN BOTH MODES
//
// Skipped rather than silently passed when the save is locked or absent -- the
// game rewrites it while it runs. The deterministic synthetic tests above cover
// the same discriminator, so a skip here never leaves the rule unproven.
// ---------------------------------------------------------------------------

function liveBriefing(mode, riskFloorPercent) {
  const { loadFilteredSnapshot } = require('../server/snapshotLoader');
  return briefingGenerator.generateMissionControlBriefing(
    loadFilteredSnapshot({ latest: true, mode, observer: 4712 }),
    null,
    { riskFloorPercent }
  );
}

function skipIfSaveUnavailable(t, err) {
  if (
    err.code === 'EBUSY' || err.code === 'ENOENT' || err.code === 'EPERM'
    || /EBUSY|locked|busy|No save path configured|Save folder not found|Save file not found|No \.gz or \.json save files found|No save files found/.test(err.message || '')
  ) {
    t.skip(`Skipping live save test: ${err.message}`);
    return true;
  }
  return false;
}

test('Live save, omniscient: a 90% floor vetoes the straddling Purge and an 88% floor does not', (t) => {
  try {
    const ids = (briefing) => briefing.engineDirectives.cyclePlan.assignments.map((a) => a.candidateId);

    const baseline = liveBriefing('omniscient', 0);
    const straddler = baseline.engineDirectives.cyclePlan.assignments.find(
      (a) => a.odds?.automatic !== true && Array.isArray(a.odds?.band) && a.odds.band[0] < a.odds.point
    );
    if (!straddler) {
      t.skip('The current live save has no assigned contested action whose band straddles its midpoint.');
      return;
    }

    const bandLow = straddler.odds.band[0];
    const point = straddler.odds.point;
    assert.ok(bandLow < point, 'the discriminator needs band low below the midpoint');

    const kept = liveBriefing('omniscient', bandLow);
    const dropped = liveBriefing('omniscient', bandLow + 1);

    assert.ok(ids(kept).includes(straddler.candidateId),
      `a floor at the band low (${bandLow}) must keep ${straddler.candidateId}`);
    assert.ok(!ids(dropped).includes(straddler.candidateId),
      `a floor one point above the band low (${bandLow + 1}) must drop ${straddler.candidateId}, `
      + `even though its midpoint is ${point}`);
    assert.ok(bandLow + 1 <= point, 'the midpoint would still have cleared the vetoing floor — that is the whole test');

    const held = dropped.engineDirectives.cyclePlan.riskFloorVetoed
      .find((entry) => entry.candidateId === straddler.candidateId);
    assert.ok(held, 'the vetoed action is recorded, not silently missing');
    assert.strictEqual(held.floorPercent, bandLow + 1);
    assert.match(held.reason, new RegExp(`${bandLow + 1}% floor`));

    // The spec's measured case, asserted by name when the save still has it.
    if (ids(baseline).includes('purge:3728:3729')) {
      assert.strictEqual(straddler.candidateId, 'purge:3728:3729');
      assert.strictEqual(point, 93);
      assert.deepStrictEqual(straddler.odds.band, [89, 96]);
      assert.strictEqual(straddler.odds.assumed, true);
      assert.ok(!ids(liveBriefing('omniscient', 90)).includes('purge:3728:3729'));
      assert.ok(ids(liveBriefing('omniscient', 88)).includes('purge:3728:3729'));
    }
  } catch (err) {
    if (!skipIfSaveUnavailable(t, err)) throw err;
  }
});

test('Live save, both modes: a floor of 0 changes nothing and automatic assignments survive a 100% floor', (t) => {
  try {
    for (const mode of ['player', 'omniscient']) {
      const ids = (briefing) => briefing.engineDirectives.cyclePlan.assignments.map((a) => a.candidateId);

      const baseline = liveBriefing(mode, 0);
      assert.strictEqual(baseline.engineDirectives.cyclePlan.riskFloorVetoedTotalCount, 0,
        `${mode}: a floor of 0 must veto nothing`);
      assert.deepStrictEqual(baseline.engineDirectives.cyclePlan.riskFloor,
        { percent: 0, inForce: false, configured: true }, `${mode}: floor readout`);

      const maxFloor = liveBriefing(mode, 100);
      assert.strictEqual(maxFloor.engineDirectives.cyclePlan.riskFloor.inForce, true, `${mode}: 100% floor is in force`);

      // Every uncontested assignment in the baseline must survive a 100% floor,
      // and every contested one must be gone: the band of a contested roll is
      // capped at 99 by the odds model, so 100 can only be met by a mission
      // that cannot fail.
      const automaticIds = baseline.engineDirectives.cyclePlan.assignments
        .filter((a) => a.odds?.automatic === true).map((a) => a.candidateId);
      const contestedIds = baseline.engineDirectives.cyclePlan.assignments
        .filter((a) => a.odds?.automatic !== true).map((a) => a.candidateId);

      assert.ok(automaticIds.length > 0, `${mode}: expected at least one uncontested assignment in the baseline`);
      for (const id of automaticIds) {
        assert.ok(ids(maxFloor).includes(id), `${mode}: uncontested ${id} must clear a 100% floor`);
      }
      for (const id of contestedIds) {
        assert.ok(!ids(maxFloor).includes(id), `${mode}: contested ${id} cannot clear a 100% floor`);
      }

      // And nothing the floor held back is presented without its reason.
      for (const entry of maxFloor.engineDirectives.cyclePlan.riskFloorVetoed) {
        assert.match(entry.reason, /floor/i);
        assert.strictEqual(entry.floorPercent, 100);
      }
    }
  } catch (err) {
    if (!skipIfSaveUnavailable(t, err)) throw err;
  }
});

test('Live save: player mode and omniscient mode are genuinely different boards under the same floor', (t) => {
  try {
    const player = liveBriefing('player', 90).engineDirectives.cyclePlan;
    const omniscient = liveBriefing('omniscient', 90).engineDirectives.cyclePlan;

    assert.strictEqual(player.riskFloor.percent, 90);
    assert.strictEqual(omniscient.riskFloor.percent, 90);

    // The two modes see different candidate boards, so their held-back counts
    // must not be assumed equal -- the defect this repo has shipped twice is
    // verifying one mode and inferring the other.
    assert.notStrictEqual(
      player.riskFloorVetoedTotalCount + omniscient.riskFloorVetoedTotalCount,
      0,
      'a 90% floor should hold back something in at least one mode'
    );

    for (const plan of [player, omniscient]) {
      for (const entry of plan.riskFloorVetoed) {
        assert.strictEqual(typeof entry.reason, 'string');
        assert.ok(!/\b(null|undefined|NaN)\b/.test(entry.reason), `absent value rendered verbatim: ${entry.reason}`);
        assert.ok(entry.bandLow === null || entry.bandLow < 90, 'a vetoed entry must be below the floor at its band low');
      }
      for (const assignment of plan.assignments) {
        if (!assignment.riskFloor) continue;
        assert.ok(['pass', 'unknown'].includes(assignment.riskFloor.outcome),
          'no assignment may carry a veto verdict');
      }
    }
  } catch (err) {
    if (!skipIfSaveUnavailable(t, err)) throw err;
  }
});
