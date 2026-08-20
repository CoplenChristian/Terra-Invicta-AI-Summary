/**
 * Regression tests for four verified correctness defects in the directive
 * engine, plus a pin on the player-mode Total War scoring branch a prior
 * review wrongly called unreachable.
 *
 * Each block names the defect it locks down and the shape of the real save
 * data that triggered it. Snapshot nation records carry `ID` / `displayName` /
 * `templateName` and have NO `id` and NO `name`; councilors and habs carry
 * `ID`; control points carry `id`. Fixtures here mirror that exactly -- a
 * fixture that invents `nation.id` would pass while the live save fails.
 */

const { test } = require('node:test');
const assert = require('node:assert');

const {
  RULES,
  buildWorld,
  runEngine,
  generateCandidates,
  generateDefendInterestsCandidates,
  applyRules
} = require('../server/directiveEngine');
const { generateMissionCandidatesFromSpecs } = require('../server/engine/candidates/missions');
const { MissionCatalogue } = require('../server/engine/missionCatalogue');
const { allocateCyclePlan, computeOngoingMissionBenefit, getActiveMissionInfo } = require('../server/engine/assignment');
const { buildCandidatePairing } = require('../server/engine/pairing');
const directiveAdvisor = require('../server/directiveAdvisor');

const OBSERVER = 4712;

const rule = (id) => {
  const found = RULES.find((r) => r.id === id);
  assert.ok(found, `rule ${id} must exist`);
  return found;
};

/** Mission specs in the exact shape the snapshot ships (verified 2026-08-20). */
const SPECS = Object.freeze({
  DefendInterests: {
    friendlyName: 'Defend Interests',
    successHate: 0, criticalHate: 0, failureHate: 0,
    costResource: 'Influence', costKind: 'Flat', costAmount: 20,
    contested: false, attack: null, defend: null, baseDifficulty: 0,
    targetKind: 'NationFleetHab', conditions: ['TargetInRange', 'DefendableAsset']
  },
  GainInfluence: {
    friendlyName: 'Control Nation',
    successHate: 0, criticalHate: 0, failureHate: 0,
    costResource: 'Influence', costKind: 'Bonus', costAmount: null,
    contested: true, attack: 'Persuasion', defend: null, baseDifficulty: 5,
    targetKind: 'Nation', conditions: ['TargetInRange', 'Human']
  },
  Purge: {
    friendlyName: 'Purge',
    successHate: 5, criticalHate: 5, failureHate: 1,
    costResource: 'Influence', costKind: 'Bonus', costAmount: null,
    contested: true, attack: 'Espionage', defend: 'Administration', baseDifficulty: 3,
    targetKind: 'OwnedControlPoint', conditions: ['TargetInRange', 'Human', 'CouncilorOnEarth']
  },
  InvestigateCouncilor: {
    friendlyName: 'Investigate Councilor',
    successHate: 0, criticalHate: 0, failureHate: 0,
    costResource: 'Operations', costKind: 'Bonus', costAmount: null,
    contested: true, attack: 'Investigation', defend: 'Espionage', baseDifficulty: 4,
    targetKind: 'Councilor', conditions: ['TargetInRange']
  },
  Advise: {
    friendlyName: 'Advise',
    successHate: 0, criticalHate: 0, failureHate: 0,
    costResource: 'Influence', costKind: 'Flat', costAmount: 10,
    contested: false, attack: null, defend: null, baseDifficulty: 0,
    targetKind: 'NationHab', conditions: ['TargetInRange', 'CouncilorOnEarth']
  }
});

/**
 * A nation exactly as the snapshot reducer emits it: `ID` and `displayName`,
 * never `id` and never `name`.
 */
function nation({ ID, displayName, GDP = 1e12, regionsCount = 4, population = 50, research = 100, controlPoints = [] }) {
  return { ID, displayName, templateName: `2026_${displayName}`, GDP, population, regionsCount, research, unrest: 1, armies: 0, controlPoints };
}

function cp({ id, factionId = null, factionName = null, isExecutive = false, controlPointType = 'Legislature', defended, defendExpiration }) {
  const record = { id, factionId, factionName, isExecutive, controlPointType };
  if (defended !== undefined) record.defended = defended;
  if (defendExpiration !== undefined) record.defendExpiration = defendExpiration;
  return record;
}

// ---------------------------------------------------------------------------
// BUG 1 -- candidate identity collapse
// ---------------------------------------------------------------------------

test('catalogue candidates get one id per real target when nations carry ID but no id/name', () => {
  const nations = [
    nation({ ID: 4359, displayName: 'Alpha', controlPoints: [cp({ id: 1, factionId: OBSERVER, defended: false })] }),
    nation({ ID: 4400, displayName: 'Bravo', controlPoints: [cp({ id: 2, factionId: OBSERVER, defended: false })] }),
    nation({ ID: 4500, displayName: 'Charlie', controlPoints: [cp({ id: 3, factionId: OBSERVER, defended: false })] })
  ];
  const world = { observerId: OBSERVER, nations, councilors: [] };
  const produced = generateMissionCandidatesFromSpecs(world, new MissionCatalogue(SPECS));

  const advise = produced.filter((c) => c.missionType === 'Advise');
  assert.strictEqual(advise.length, 3, 'one Advise candidate per nation we hold, not one in total');
  assert.strictEqual(new Set(advise.map((c) => c.id)).size, 3, 'Advise ids must be distinct');

  const defend = produced.filter((c) => c.missionType === 'Defend Interests');
  assert.strictEqual(defend.length, 3);
  assert.strictEqual(new Set(defend.map((c) => c.id)).size, 3);

  for (const candidate of produced) {
    assert.doesNotMatch(String(candidate.id), /undefined|null|NaN/,
      `candidate id ${candidate.id} must resolve to a real target identity`);
  }
});

test('a target whose identity cannot be resolved is dropped with a reason, not merged into the dedupe set', () => {
  const nations = [
    // No ID, no id, no templateName -- identity is genuinely unresolvable.
    { displayName: 'Ghost One', GDP: 1e12, regionsCount: 3, controlPoints: [cp({ id: 9, factionId: OBSERVER, defended: false })] },
    { displayName: 'Ghost Two', GDP: 1e12, regionsCount: 3, controlPoints: [cp({ id: 10, factionId: OBSERVER, defended: false })] }
  ];
  const diagnostics = [];
  const produced = generateMissionCandidatesFromSpecs(
    { observerId: OBSERVER, nations, councilors: [] },
    new MissionCatalogue(SPECS),
    diagnostics
  );

  assert.strictEqual(produced.length, 0, 'unidentifiable targets produce no candidates');
  assert.ok(diagnostics.length > 0, 'every drop is recorded');
  for (const entry of diagnostics) {
    assert.strictEqual(entry.reason, 'unresolvable-target-identity');
    assert.match(entry.detail, /no ID/);
  }
});

test('generateCandidates drops an unresolvable id rather than colliding, and records it', () => {
  const world = buildWorld({
    observerId: OBSERVER,
    nations: [nation({ ID: 1, displayName: 'Alpha', controlPoints: [cp({ id: 1, factionId: OBSERVER, defended: false })] })],
    missionSpecs: SPECS
  });
  const diagnostics = [];
  const produced = generateCandidates(world, diagnostics);
  const ids = produced.map((c) => c.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'ids are unique after dedupe');
  for (const id of ids) assert.doesNotMatch(String(id), /undefined|null|NaN/);
});

test('runEngine surfaces dropped candidates instead of leaving the gap invisible', () => {
  const world = buildWorld({
    observerId: OBSERVER,
    nations: [{ displayName: 'Ghost', GDP: 1e12, regionsCount: 3, controlPoints: [cp({ id: 4, factionId: OBSERVER, defended: false })] }],
    missionSpecs: SPECS
  });
  const result = runEngine(world);
  assert.ok(Array.isArray(result.droppedCandidates));
  assert.ok(result.droppedCandidates.length > 0, 'the dropped target is reported, not silently absent');
});

test('the Advise candidate for a nation we already advise exists, so "keep advising" is representable', () => {
  // The churn defect: only ONE Advise candidate existed campaign-wide, so the
  // engine could only ever recommend moving an advisor to that one nation.
  const nations = [
    nation({ ID: 10, displayName: 'United States of America', research: 1300, controlPoints: [cp({ id: 1, factionId: OBSERVER, defended: false })] }),
    nation({ ID: 20, displayName: 'Canada', research: 120, controlPoints: [cp({ id: 2, factionId: OBSERVER, defended: false })] })
  ];
  const world = buildWorld({ observerId: OBSERVER, nations, missionSpecs: SPECS });
  const advise = generateCandidates(world).filter((c) => c.missionType === 'Advise');
  const targets = advise.map((c) => c.target.name).sort();
  assert.deepStrictEqual(targets, ['Canada', 'United States of America']);
});

// ---------------------------------------------------------------------------
// BUG 2 -- catalogue candidates bypassed the safety vetoes
// ---------------------------------------------------------------------------

test('every catalogue candidate is subject to the Total War budget veto', () => {
  const nations = [
    nation({ ID: 1, displayName: 'Alpha', controlPoints: [cp({ id: 1, factionId: OBSERVER, defended: false }), cp({ id: 2, factionId: 9999, factionName: 'the Protectorate' })] })
  ];
  const world = buildWorld({ observerId: OBSERVER, nations, missionSpecs: SPECS });
  const produced = generateCandidates(world);
  const catalogue = produced.filter((c) => c.provenance?.generator === 'missions-catalogue');
  assert.ok(catalogue.length > 0, 'fixture must produce catalogue candidates');

  const hateVeto = rule('hate/total-war-budget');
  const skipped = catalogue.filter((c) => !hateVeto.appliesTo(c));
  assert.strictEqual(skipped.length, 0,
    `no catalogue candidate may skip the Total War budget veto (skipped: ${skipped.map((c) => c.id).join(', ')})`);

  const crossing = rule('hate/war-threshold-crossing');
  const unscored = catalogue.filter((c) => !crossing.appliesTo(c));
  assert.strictEqual(unscored.length, 0, 'catalogue candidates carry a measured hate envelope the crossing rule can read');
});

test('a capitalised Flat cost is normalised so the affordability veto actually fires', () => {
  const nations = [nation({ ID: 1, displayName: 'Alpha', controlPoints: [cp({ id: 1, factionId: OBSERVER, defended: false })] })];
  // Advise costs a verified flat 10 Influence; stock deliberately below it.
  const world = buildWorld({ observerId: OBSERVER, nations, missionSpecs: SPECS, resources: { Influence: 3 } });
  const advise = generateCandidates(world).find((c) => c.missionType === 'Advise');

  assert.strictEqual(advise.cost.kind, 'flat', 'template spelling "Flat" is normalised to "flat"');
  assert.strictEqual(advise.cost.amount, 10, 'the amount comes from the template, not a literal');
  const affordability = rule('cost/affordability');
  assert.ok(affordability.appliesTo(advise), 'the affordability veto must apply');
  assert.strictEqual(affordability.evaluate(world, advise), 'veto');

  const rich = buildWorld({ observerId: OBSERVER, nations, missionSpecs: SPECS, resources: { Influence: 500 } });
  const affordable = generateCandidates(rich).find((c) => c.missionType === 'Advise');
  assert.strictEqual(affordability.evaluate(rich, affordable), 'pass');
});

test('Purge hate comes from the template row, and a zero-hate template is not fabricated up to 5', () => {
  const nations = [nation({ ID: 1, displayName: 'Alpha', controlPoints: [cp({ id: 2, factionId: 9999, factionName: 'the Protectorate' })] })];

  const world = buildWorld({ observerId: OBSERVER, nations, missionSpecs: SPECS });
  const purge = generateCandidates(world).find((c) => c.missionType === 'Purge');
  assert.deepStrictEqual(
    { low: purge.hate.toAliens.low, high: purge.hate.toAliens.high },
    { low: 1, high: 5 },
    'envelope spans the template failure (1) and success/critical (5) slots'
  );

  // The old generator wrote `purgeSpec.successHate || 5`, which turns a
  // legitimate 0 into 5. A pacified Purge row must stay at zero.
  const pacified = { ...SPECS, Purge: { ...SPECS.Purge, successHate: 0, criticalHate: 0, failureHate: 0 } };
  const zeroWorld = buildWorld({ observerId: OBSERVER, nations, missionSpecs: pacified });
  const zeroPurge = generateCandidates(zeroWorld).find((c) => c.missionType === 'Purge');
  assert.strictEqual(zeroPurge.successHate, 0, 'a template that says 0 hate must not be rewritten to 5');
  assert.strictEqual(zeroPurge.hate.toAliens.high, 0);
});

test('a candidate whose hate row is absent reports unknown, never pass', () => {
  const noHate = { ...SPECS, Purge: { ...SPECS.Purge, successHate: undefined, criticalHate: undefined, failureHate: undefined } };
  const nations = [nation({ ID: 1, displayName: 'Alpha', controlPoints: [cp({ id: 2, factionId: 9999, factionName: 'Rival' })] })];
  const world = buildWorld({ observerId: OBSERVER, nations, missionSpecs: noHate });
  const purge = generateCandidates(world).find((c) => c.missionType === 'Purge');

  assert.strictEqual(purge.hate.toAliens, null, 'no measurable slot means no envelope');
  const hateVeto = rule('hate/total-war-budget');
  assert.ok(hateVeto.appliesTo(purge));
  assert.strictEqual(hateVeto.evaluate(world, purge), 'unknown');
  assert.match(hateVeto.because(world, purge), /unknown, not zero/i);

  const { surviving, uncertain } = applyRules(world, [purge]);
  assert.strictEqual(surviving.length, 0, 'an unmeasured hate exposure must not survive as if it were safe');
  assert.strictEqual(uncertain.length, 1);
});

test('a partially recorded hate row cannot bound the exposure and reports unknown', () => {
  const partial = { ...SPECS, Purge: { ...SPECS.Purge, successHate: 0, criticalHate: undefined, failureHate: undefined } };
  const nations = [nation({ ID: 1, displayName: 'Alpha', controlPoints: [cp({ id: 2, factionId: 9999, factionName: 'Rival' })] })];
  const world = buildWorld({ observerId: OBSERVER, nations, missionSpecs: partial });
  const purge = generateCandidates(world).find((c) => c.missionType === 'Purge');
  assert.strictEqual(rule('hate/total-war-budget').evaluate(world, purge), 'unknown',
    'knowing the success slot is 0 says nothing about the failure slot we never read');
});

test('catalogue expansion candidates carry regionsCount so no-territory evaluates instead of guessing', () => {
  const real = nation({ ID: 1, displayName: 'Alpha', regionsCount: 4, controlPoints: [cp({ id: 2, factionId: 9999, factionName: 'Rival' })] });
  const ghost = nation({ ID: 2, displayName: 'Ghostland', regionsCount: 0, population: 0, controlPoints: [cp({ id: 3, factionId: 9999, factionName: 'Rival' })] });
  const world = buildWorld({ observerId: OBSERVER, nations: [real, ghost], missionSpecs: SPECS });
  const produced = generateCandidates(world).filter((c) => c.missionType === 'Purge');

  const territory = rule('legality/no-territory');
  const alpha = produced.find((c) => c.target.nation === 'Alpha');
  const ghostCandidate = produced.find((c) => c.target.nation === 'Ghostland');
  assert.strictEqual(territory.evaluate(world, alpha), 'pass');
  assert.strictEqual(territory.evaluate(world, ghostCandidate), 'veto');
  assert.strictEqual(ghostCandidate.value.territoryClass, 'unformed');
});

test('executive-last is scoped to Control Nation and does not park every executive Purge in uncertain', () => {
  const nations = [nation({
    ID: 1,
    displayName: 'Alpha',
    controlPoints: [
      cp({ id: 2, factionId: 9999, factionName: 'Rival', isExecutive: true, controlPointType: 'Executive' }),
      cp({ id: 3, factionId: 8888, factionName: 'Other' })
    ]
  })];
  const world = buildWorld({ observerId: OBSERVER, nations, missionSpecs: SPECS });
  const execPurge = generateCandidates(world)
    .find((c) => c.missionType === 'Purge' && c.target.isExecutive === true);
  assert.ok(execPurge, 'fixture must produce an executive-seat Purge');
  assert.strictEqual(rule('legality/executive-last').appliesTo(execPurge), false,
    'executive-last constrains taking the seat, not purging a rival off it');
});

test('the hand-written alien-sighting candidate no longer skips the hate veto', () => {
  // It shipped with `hate: null`, which made appliesTo false and bought it a
  // silent pass. Its template row (0/0/0) is now attached and read.
  const specs = {
    ...SPECS,
    InvestigateAlienActivity: {
      friendlyName: 'Investigate Alien Activity',
      successHate: 0, criticalHate: 0, failureHate: 0,
      costResource: 'Operations', costKind: 'Flat', costAmount: 5,
      contested: false, attack: null, defend: null, baseDifficulty: 0,
      conditions: ['TargetInRange']
    }
  };
  const world = buildWorld({
    observerId: OBSERVER,
    capabilities: { canDirectlyDetectAlienCouncilors: true },
    councilors: [{ ID: 1, isAlien: true, displayName: 'Xenoform', seenByFactionIds: [] }],
    missionSpecs: specs
  });
  const intel = generateCandidates(world).find((c) => c.id === 'intel:capability-unlocked-unused');
  assert.ok(intel, 'fixture must produce the capability-unused candidate');
  assert.ok(rule('hate/total-war-budget').appliesTo(intel));
  assert.strictEqual(rule('hate/total-war-budget').evaluate(world, intel), 'pass');
  assert.strictEqual(intel.cost.kind, 'flat');
  assert.strictEqual(intel.cost.amount, 5, 'flat cost comes from the template');
});

// ---------------------------------------------------------------------------
// BUG 3 -- an unevaluable ward read as "defence is active"
// ---------------------------------------------------------------------------

const WARDED = { year: 2033, month: 12, day: 31, hour: 23, minute: 59, second: 0, millisecond: 0 };

function defendedWorld(campaignDate) {
  return buildWorld({
    observerId: OBSERVER,
    campaignDate,
    nations: [nation({
      ID: 1,
      displayName: 'Alpha',
      controlPoints: [
        cp({ id: 1, factionId: OBSERVER, defended: true, defendExpiration: WARDED }),
        cp({ id: 2, factionId: OBSERVER, defended: true, defendExpiration: WARDED })
      ]
    })]
  });
}

test('a readable campaign date with a future ward correctly suppresses the Defend Interests candidate', () => {
  const candidates = generateDefendInterestsCandidates(defendedWorld('6/1/2033 12:00:00 PM'));
  assert.strictEqual(candidates.length, 0, 'a measured, unexpired ward is a maintenance state, not an action');
});

test('an expired ward reopens the Defend Interests candidate', () => {
  const candidates = generateDefendInterestsCandidates(defendedWorld('6/1/2034 12:00:00 PM'));
  assert.strictEqual(candidates.length, 1);
});

test('an unreadable campaign date reports unknown coverage instead of claiming the holding is defended', () => {
  for (const campaignDate of [null, undefined, '', 'not-a-date']) {
    const candidates = generateDefendInterestsCandidates(defendedWorld(campaignDate));
    assert.strictEqual(candidates.length, 1,
      `campaignDate ${JSON.stringify(campaignDate)}: the axis must not vanish when the ward cannot be evaluated`);
    const text = candidates[0].unmetPreconditions.join(' ');
    assert.match(text, /could not be evaluated/i);
    assert.match(text, /unknown, not absent/i);
    assert.strictEqual(candidates[0].value.defenseUnknownCount, 2, 'both wards are counted as unevaluated');
  }
});

test('an absent `defended` flag is unknown, not undefended and not defended', () => {
  const world = buildWorld({
    observerId: OBSERVER,
    campaignDate: '6/1/2033 12:00:00 PM',
    nations: [nation({ ID: 1, displayName: 'Alpha', controlPoints: [cp({ id: 1, factionId: OBSERVER })] })]
  });
  const candidates = generateDefendInterestsCandidates(world);
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].value.defenseUnknownCount, 1);
});

// ---------------------------------------------------------------------------
// BUG 4 -- "committed" and "reassign" asserted at once
// ---------------------------------------------------------------------------

const ADVISOR = Object.freeze({
  ID: 20,
  displayName: 'Brad Lester',
  status: 'Active',
  locationType: 'earth',
  activeMissionName: 'Advise',
  activeMissionTarget: 'United States',
  resolvedAttributes: { effective: { Administration: 25, Science: 13, Command: 5, Persuasion: 25 } }
});

const ADVISE_WORLD = Object.freeze({
  resources: { influence: 100 },
  nations: [{ displayName: 'United States', GDP: 30000, research: 1300, unrest: 1, armies: 0 }]
});

test('a councilor the plan reassigns off Advise is NOT also listed as committed', () => {
  // Advising this fixture's United States is worth ~300 value/turn, so the
  // switching penalty is ~30; the replacement must genuinely clear that.
  const highValue = {
    id: 'critical-op',
    title: 'Take Executive Superpower',
    missionType: 'GainInfluence',
    target: { type: 'nation', name: 'Superpower' },
    missionSpec: { friendlyName: 'Control Nation', contested: false },
    baseValue: 60.0,
    cost: { resource: 'Influence', amount: 10 }
  };
  const plan = allocateCyclePlan([highValue], [ADVISOR], ADVISE_WORLD);

  assert.strictEqual(plan.assignments.length, 1);
  assert.strictEqual(plan.assignments[0].assignmentType, 'reassign');

  const committedIds = new Set(plan.committed.map((c) => String(c.councilorId)));
  const contradictions = plan.assignments.filter(
    (a) => committedIds.has(String(a.councilorId)) && a.assignmentType === 'reassign'
  );
  assert.strictEqual(contradictions.length, 0,
    'the plan must not say "committed to Advise" and "move them off Advise" about the same councilor');
  assert.strictEqual(plan.committed.length, 0);

  // The broken commitment stays visible, priced.
  assert.strictEqual(plan.reassignedFromCommitment.length, 1);
  const broken = plan.reassignedFromCommitment[0];
  assert.strictEqual(broken.name, 'Brad Lester');
  assert.strictEqual(broken.droppedMissionName, 'Advise');
  assert.strictEqual(broken.droppedMissionTarget, 'United States');
  assert.ok(broken.ongoingBenefit.perTurnValue > 0, 'the opportunity-cost pricing is preserved');
  assert.ok(broken.ongoingBenefit.gainResearch > 0);
  assert.match(broken.opportunityCost, /Moving Brad Lester off Advise/);
  assert.match(broken.opportunityCost, /research\/turn/);
});

test('a councilor the plan keeps is committed with planDecision continue, and the two statements agree', () => {
  const adviseCandidate = {
    id: 'advise-usa',
    title: 'Advise Government: United States',
    missionType: 'Advise',
    friendlyName: 'Advise',
    target: { type: 'nation', name: 'United States', displayName: 'United States', GDP: 30000, research: 1300, unrest: 1, armies: 0 },
    missionSpec: { friendlyName: 'Advise', contested: false },
    baseValue: 6.0,
    cost: { resource: 'Influence', amount: 10 }
  };
  const plan = allocateCyclePlan([adviseCandidate], [ADVISOR], ADVISE_WORLD);

  assert.strictEqual(plan.assignments.length, 1);
  assert.strictEqual(plan.assignments[0].assignmentType, 'continue');
  assert.strictEqual(plan.committed.length, 1);
  assert.strictEqual(plan.committed[0].planDecision, 'continue');
  assert.strictEqual(plan.committed[0].activeMissionTarget, 'United States');
  assert.strictEqual(plan.reassignedFromCommitment.length, 0);
  assert.match(plan.committed[0].reasonDetail, /keeps Brad Lester on Advise/);
});

test('a persistent councilor with no candidate at all is committed on hold, not reported as churn', () => {
  const plan = allocateCyclePlan([], [ADVISOR], ADVISE_WORLD);
  assert.strictEqual(plan.assignments.length, 0);
  assert.strictEqual(plan.committed.length, 1);
  assert.strictEqual(plan.committed[0].planDecision, 'hold');
  assert.strictEqual(plan.reassignedFromCommitment.length, 0);
});

test('an Advise commitment whose target is absent is priced as unknown, not as a fabricated 50', () => {
  const activeInfo = getActiveMissionInfo({ activeMissionName: 'Advise', activeMissionTarget: 'Atlantis' });
  const benefit = computeOngoingMissionBenefit(ADVISOR, activeInfo, { nations: [], habs: [] });

  assert.strictEqual(benefit.measured, false);
  assert.strictEqual(benefit.perTurnValue, null, 'an unpriceable commitment must not report a number');
  assert.strictEqual(benefit.gainResearch, null);
  assert.match(benefit.unmeasuredReason, /could not be priced/);
});

test('an unpriceable commitment is held, not broken on an unmeasured cost', () => {
  const world = { resources: { influence: 100 }, nations: [], habs: [] };
  const councilor = { ...ADVISOR, activeMissionTarget: 'Atlantis' };
  const op = {
    id: 'op', title: 'Somewhere Else', missionType: 'GainInfluence',
    target: { type: 'nation', name: 'Elsewhere' },
    missionSpec: { friendlyName: 'Control Nation', contested: false },
    baseValue: 9.0, cost: { resource: 'Influence', amount: 10 }
  };
  const plan = allocateCyclePlan([op], [councilor], world);

  assert.strictEqual(plan.assignments.length, 0,
    'a switch whose cost cannot be measured must not be recommended as though it were cheap');
  assert.strictEqual(plan.committed.length, 1);
  assert.strictEqual(plan.committed[0].planDecision, 'hold');
  assert.strictEqual(plan.unassigned.length, 0, 'a held commitment is not idle');

  const held = plan.heldCommitments;
  assert.strictEqual(held.length, 1);
  assert.strictEqual(held[0].switchingPenalty, null, 'no fabricated penalty');
  assert.match(held[0].reason, /could not be priced/);
  assert.match(held[0].reason, /An unmeasured cost is not a low one/);
  assert.match(plan.committed[0].reasonDetail, /could not be priced/);
});

test('a value-destroying reassignment is held instead of recommended at a floored zero', () => {
  // The switching penalty used to be clamped with Math.max(0, ...), so a move
  // that burned ~30 value/turn for a 5-value mission still surfaced as an
  // order with expectedValue 0 -- indistinguishable from a break-even trade.
  const weakOp = {
    id: 'weak-op', title: 'Minor Errand', missionType: 'GainInfluence',
    target: { type: 'nation', name: 'Elsewhere' },
    missionSpec: { friendlyName: 'Control Nation', contested: false },
    baseValue: 5.0, cost: { resource: 'Influence', amount: 10 }
  };
  const plan = allocateCyclePlan([weakOp], [ADVISOR], ADVISE_WORLD);

  assert.strictEqual(plan.assignments.length, 0, 'the churn order is not issued');
  assert.strictEqual(plan.committed.length, 1);
  assert.strictEqual(plan.committed[0].planDecision, 'hold');
  assert.strictEqual(plan.reassignedFromCommitment.length, 0);

  const held = plan.heldCommitments;
  assert.strictEqual(held.length, 1);
  assert.ok(held[0].netExpectedValue < 0, 'the net value is reported as negative, not floored to zero');
  assert.ok(held[0].switchingPenalty > 0);
  assert.match(held[0].reason, /costs more than this mission returns/);
  // The rejected trade stays visible on the committed entry.
  assert.strictEqual(plan.committed[0].rejectedSwitch.rejectedTitle, 'Minor Errand');
});

test('measured Advise ongoing benefit still carries real numbers', () => {
  const activeInfo = getActiveMissionInfo(ADVISOR);
  const benefit = computeOngoingMissionBenefit(ADVISOR, activeInfo, ADVISE_WORLD);
  assert.strictEqual(benefit.measured, true);
  assert.ok(Number.isFinite(benefit.perTurnValue) && benefit.perTurnValue > 0);
  assert.ok(Number.isFinite(benefit.gainResearch) && benefit.gainResearch > 0);
  assert.strictEqual(benefit.targetName, 'United States');
});

test('the budget pools read the capitalised resource keys the save actually uses', () => {
  const plan = allocateCyclePlan([], [], { resources: { Influence: 2810, Operations: 1036, Money: 48281 } });
  assert.strictEqual(plan.budgets.influence.cap, 2810, 'must not fall back to the 100 placeholder');
  assert.strictEqual(plan.budgets.operations.cap, 1036);
  assert.strictEqual(plan.budgets.money.cap, 48281);
});

// ---------------------------------------------------------------------------
// A9 -- pin the player-mode Total War scoring branch
// ---------------------------------------------------------------------------

/**
 * A prior review claimed the 10x crossing200 branch is unreachable in player
 * mode because `actualAlienHate` is redacted there. It is not:
 * directiveAdvisor derives `totalWarActive` from `totalWarState === 'active'`,
 * which is independent of hate visibility. Once Total War is declared the
 * branch fires with hate still null. This test exists to stop that branch
 * being "simplified" away.
 */
test('player mode with Total War active and redacted hate still reaches the 10x crossing200 weight', () => {
  const posture = directiveAdvisor.assessCampaignPosture({
    alienHateEconomics: { actualAlienHate: null, totalWar: { state: 'active' } },
    observer: { ID: OBSERVER },
    observerHate: { pips: null },
    factions: [],
    fleets: []
  });

  assert.strictEqual(posture.actualAlienHate, null, 'player mode redacts the true hate figure');
  assert.strictEqual(posture.totalWarProximity, 'active', 'proximity is derived from state, not from hate visibility');

  const world = buildWorld({ observerId: OBSERVER, posture });
  const candidate = {
    id: 'x', family: 'expansion', missionType: 'Purge', target: {},
    hate: { toAliens: { low: 1, high: 5 } }, cost: null, value: {}, score: null,
    provenance: { source: 'test', estimateClass: 'exact' }, unmetPreconditions: []
  };

  const crossing = rule('hate/war-threshold-crossing');
  assert.ok(crossing.appliesTo(candidate));
  const contribution = crossing.evaluate(world, candidate);
  // mid = (1 + 5) / 2 = 3; crossing200 weight = 10; HATE_POINTS = 1.
  assert.strictEqual(contribution, -30, 'the crossing200 (10x) weight must apply, not the 3x fallback');
  assert.match(crossing.because(world, candidate), /10x crossing200/);
});

test('a forecast Total War proximity always carries a measured hate, so the measured branch handles it', () => {
  // 'forecast' is only reachable through `hateInApproachBand`, which requires
  // actualAlienHate !== null. That is why the player-mode branch has no
  // 'forecast' arm -- it would be dead code.
  const posture = directiveAdvisor.assessCampaignPosture({
    alienHateEconomics: {
      actualAlienHate: 160,
      totalWar: { state: 'blocked_by_year', yearsRemaining: 20 }
    },
    observer: { ID: OBSERVER },
    observerHate: { pips: 5 },
    factions: [],
    fleets: []
  });

  if (posture.totalWarProximity === 'forecast') {
    assert.notStrictEqual(posture.actualAlienHate, null,
      'forecast proximity is only reachable with a measured hate figure');
  }

  // Whatever the proximity label, a measured hate takes the measured branch.
  const world = buildWorld({ observerId: OBSERVER, posture });
  const candidate = {
    id: 'x', family: 'expansion', missionType: 'Purge', target: {},
    hate: { toAliens: { low: 1, high: 5 } }, cost: null, value: {}, score: null,
    provenance: { source: 'test', estimateClass: 'exact' }, unmetPreconditions: []
  };
  assert.match(rule('hate/war-threshold-crossing').because(world, candidate), /Current hate 160\.0/);
});

// ---------------------------------------------------------------------------
// pairing -- an absent hate row must not price as free
// ---------------------------------------------------------------------------

test('a pairing whose hate row is absent reports hateUnknown instead of charging zero', () => {
  const councilor = { ID: 1, displayName: 'Agent', status: 'Active', locationType: 'earth', resolvedAttributes: { effective: { Persuasion: 20 } } };
  const candidate = {
    id: 'c1', title: 'Unknown-hate op', missionType: 'Mystery',
    target: { type: 'nation', name: 'Alpha' },
    missionSpec: { friendlyName: 'Mystery', contested: true, attack: 'Persuasion', baseDifficulty: 5, conditions: [] },
    baseValue: 5, cost: { resource: 'Influence', amount: 10, kind: 'flat' }
  };
  const pairing = buildCandidatePairing(candidate, councilor, { resources: { influence: 100 } }, []);
  assert.strictEqual(pairing.hateUnknown, true);
  assert.strictEqual(pairing.expectedHate, null);
  assert.strictEqual(pairing.hateForBudget, null, 'no number exists to charge the pool');
  assert.ok(pairing.why.some((w) => /Unknown exposure, not zero exposure/.test(w)));
});

test('a measured zero-hate row still prices as a measured zero', () => {
  const councilor = { ID: 1, displayName: 'Agent', status: 'Active', locationType: 'earth', resolvedAttributes: { effective: { Persuasion: 20 } } };
  const candidate = {
    id: 'c1', title: 'Clean op', missionType: 'Control Nation',
    target: { type: 'nation', name: 'Alpha' },
    missionSpec: { friendlyName: 'Control Nation', contested: true, attack: 'Persuasion', baseDifficulty: 5, successHate: 0, failureHate: 0, conditions: [] },
    baseValue: 5, cost: { resource: 'Influence', amount: 10, kind: 'flat' }
  };
  const pairing = buildCandidatePairing(candidate, councilor, { resources: { influence: 100 } }, []);
  assert.strictEqual(pairing.hateUnknown, false);
  assert.strictEqual(pairing.expectedHate, 0);
  assert.ok(pairing.why.some((w) => /zero alien hate/.test(w)));
});

test('the cycle plan accounts for every councilor exactly once', () => {
  const roster = [
    ADVISOR,
    { ID: 21, displayName: 'Idle Agent', status: 'Active', locationType: 'earth', resolvedAttributes: { effective: { Persuasion: 20 } } },
    { ID: 22, displayName: 'Detained Agent', status: 'Detained', locationType: 'earth' }
  ];
  const adviseCandidate = {
    id: 'advise-usa', title: 'Advise Government: United States', missionType: 'Advise', friendlyName: 'Advise',
    target: { type: 'nation', name: 'United States', displayName: 'United States', GDP: 30000, research: 1300, unrest: 1, armies: 0 },
    missionSpec: { friendlyName: 'Advise', contested: false }, baseValue: 6.0, cost: { resource: 'Influence', amount: 10 }
  };
  const plan = allocateCyclePlan([adviseCandidate], roster, ADVISE_WORLD);

  const seen = new Set([
    ...plan.assignments.map((a) => String(a.councilorId)),
    ...plan.unassigned.map((u) => String(u.councilorId)),
    ...plan.committed.map((c) => String(c.councilorId)),
    ...plan.unavailable.map((u) => String(u.councilorId))
  ]);
  assert.strictEqual(seen.size, roster.length, 'every councilor appears somewhere in the plan');

  // A held or continued commitment is never ALSO reported as idle.
  const committedIds = new Set(plan.committed.map((c) => String(c.councilorId)));
  for (const idle of plan.unassigned) {
    assert.ok(!committedIds.has(String(idle.councilorId)),
      'a committed councilor must not also be listed as having no work');
  }
});

// ---------------------------------------------------------------------------
// Explanatory lists are bounded for transport, never quietly truncated
// ---------------------------------------------------------------------------

test('capped explanatory lists still report their true totals', () => {
  // Enough rival-held control points to overflow the cap.
  const controlPoints = [];
  for (let i = 0; i < 60; i++) {
    controlPoints.push(cp({ id: 1000 + i, factionId: 9999, factionName: 'Rival', controlPointType: `Sector${i}` }));
  }
  const world = buildWorld({
    observerId: OBSERVER,
    // No posture, so Total War proximity is unobservable and every hate-bearing
    // Purge lands in `uncertain` -- the exact player-mode shape.
    nations: [nation({ ID: 1, displayName: 'Alpha', controlPoints })],
    missionSpecs: SPECS
  });
  const result = runEngine(world);

  assert.strictEqual(result.uncertain.length, 25, 'the emitted list is bounded');
  assert.strictEqual(result.uncertainTotalCount, 60, 'the true total is reported');
  assert.strictEqual(result.uncertainOmittedCount, 35, 'the omitted count is explicit');
  assert.strictEqual(result.decisionReasoning.counts.uncertain, 60,
    'decisionReasoning counts the full set, not the capped view');

  // The retained entries are the highest scoring ones, not an arbitrary slice.
  const scores = result.uncertain.map((c) => c.score).filter(Number.isFinite);
  for (let i = 1; i < scores.length; i++) {
    assert.ok(scores[i - 1] >= scores[i], 'capped list is ordered by score');
  }
});
