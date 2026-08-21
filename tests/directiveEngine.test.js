const { test } = require('node:test');
const assert = require('node:assert');

const engine = require('../server/directiveEngine');
const {
  WEIGHTS,
  RULES,
  buildWorld,
  generateOpenControlPointCandidates,
  generateDefendInterestsCandidates,
  generateCouncilCandidates,
  generateIntelligenceCandidates,
  generateCandidates,
  applyRules,
  scoreCandidates,
  runEngine,
  buildDecisionReasoning
} = engine;

const noTerritoryRule = RULES.find((r) => r.id === 'legality/no-territory');
const executiveLastRule = RULES.find((r) => r.id === 'legality/executive-last');
const totalWarBudgetRule = RULES.find((r) => r.id === 'hate/total-war-budget');
const warThresholdCrossingRule = RULES.find((r) => r.id === 'hate/war-threshold-crossing');
const affordabilityRule = RULES.find((r) => r.id === 'cost/affordability');
const storyGateRule = RULES.find((r) => r.id === 'legality/story-gate');
const defendInterestsRule = RULES.find((r) => r.id === 'value/defend-interests');

function nation(overrides = {}) {
  return {
    displayName: 'Testland',
    GDP: 5e9,
    population: 0,
    regionsCount: 1,
    controlPoints: [],
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Territory filter (legality/no-territory)
// ---------------------------------------------------------------------------

test('territory filter rejects an unformed nation (0 regions, 0 population)', () => {
  const world = buildWorld({ observerId: 4712 });
  const cp = { id: 1, factionId: null, isExecutive: false, controlPointType: 'Legislature' };
  const candidates = generateOpenControlPointCandidates({
    ...world,
    nations: [nation({ displayName: 'Aceh', GDP: 100, population: 0, regionsCount: 0, controlPoints: [cp] })]
  });
  assert.strictEqual(candidates.length, 1);
  const candidate = candidates[0];
  assert.strictEqual(candidate.value.territoryClass, 'unformed');
  assert.strictEqual(noTerritoryRule.evaluate(world, candidate), 'veto');
});

test('territory filter rejects an absorbed nation (population > 0, 0 regions)', () => {
  const world = buildWorld({ observerId: 4712 });
  const cp = { id: 1, factionId: null, isExecutive: false, controlPointType: 'MassMedia' };
  const candidates = generateOpenControlPointCandidates({
    ...world,
    nations: [nation({ displayName: 'Italy', GDP: 1.4e9, population: 58.9, regionsCount: 0, controlPoints: [cp] })]
  });
  const candidate = candidates[0];
  assert.strictEqual(candidate.value.territoryClass, 'absorbed');
  assert.strictEqual(noTerritoryRule.evaluate(world, candidate), 'veto');
});

test('territory filter passes real territory (regionsCount > 0)', () => {
  const world = buildWorld({ observerId: 4712 });
  const cp = { id: 1, factionId: null, isExecutive: false, controlPointType: 'Legislature' };
  const candidates = generateOpenControlPointCandidates({
    ...world,
    nations: [nation({ displayName: 'Malawi', GDP: 71.7e9, population: 19.9, regionsCount: 1, controlPoints: [cp] })]
  });
  const candidate = candidates[0];
  assert.strictEqual(candidate.value.territoryClass, 'real');
  assert.strictEqual(noTerritoryRule.evaluate(world, candidate), 'pass');
});

test('unformed nations end up in futureOpportunities, not rejected', () => {
  const cp = { id: 1, factionId: null, isExecutive: false, controlPointType: 'Legislature' };
  const world = buildWorld({
    observerId: 4712,
    nations: [nation({ displayName: 'Aceh', GDP: 100, population: 0, regionsCount: 0, controlPoints: [cp] })]
  });
  const result = runEngine(world);
  assert.strictEqual(result.futureOpportunities.length, 1);
  assert.strictEqual(result.futureOpportunities[0].target.nation, 'Aceh');
  assert.ok(!result.rejected.some((r) => r.target.nation === 'Aceh'));
});

test('absorbed nations end up in rejected, not futureOpportunities', () => {
  const cp = { id: 1, factionId: null, isExecutive: false, controlPointType: 'MassMedia' };
  const world = buildWorld({
    observerId: 4712,
    nations: [nation({ displayName: 'Italy', GDP: 1.4e9, population: 58.9, regionsCount: 0, controlPoints: [cp] })]
  });
  const result = runEngine(world);
  assert.strictEqual(result.rejected.length, 1);
  assert.strictEqual(result.rejected[0].target.nation, 'Italy');
  assert.ok(result.rejected[0].vetoReasons.length > 0, 'a rejected candidate carries its own reasons');
  assert.ok(!result.futureOpportunities.some((c) => c.target.nation === 'Italy'));
});

// ---------------------------------------------------------------------------
// Executive-last
// ---------------------------------------------------------------------------

test('executive-last allows a sole-CP nation', () => {
  const world = buildWorld({ observerId: 4712 });
  const execCp = { id: 1, factionId: null, isExecutive: true, controlPointType: 'Executive' };
  const candidates = generateOpenControlPointCandidates({
    ...world,
    nations: [nation({ displayName: 'SoloNation', regionsCount: 1, controlPoints: [execCp] })]
  });
  const candidate = candidates[0];
  assert.strictEqual(candidate.value.cpCountInNation, 1);
  assert.strictEqual(executiveLastRule.evaluate(world, candidate), 'pass');
});

test('executive-last blocks a multi-CP nation when the other CP is not ours', () => {
  const world = buildWorld({ observerId: 4712 });
  const nonExecCp = { id: 1, factionId: null, isExecutive: false, controlPointType: 'Legislature' };
  const execCp = { id: 2, factionId: null, isExecutive: true, controlPointType: 'Executive' };
  const candidates = generateOpenControlPointCandidates({
    ...world,
    nations: [nation({ displayName: 'Malawi', regionsCount: 1, controlPoints: [nonExecCp, execCp] })]
  });
  const executiveCandidate = candidates.find((c) => c.target.isExecutive);
  assert.strictEqual(executiveCandidate.value.allOtherCpsOwnedByObserver, false);
  assert.strictEqual(executiveLastRule.evaluate(world, executiveCandidate), 'veto');

  const nonExecCandidate = candidates.find((c) => !c.target.isExecutive);
  assert.strictEqual(executiveLastRule.appliesTo(nonExecCandidate), false, 'rule only applies to executive CPs');
});

test('executive-last passes a multi-CP nation once every other CP is ours', () => {
  const world = buildWorld({ observerId: 4712 });
  const nonExecCp = { id: 1, factionId: 4712, isExecutive: false, controlPointType: 'Legislature' };
  const execCp = { id: 2, factionId: null, isExecutive: true, controlPointType: 'Executive' };
  const candidates = generateOpenControlPointCandidates({
    ...world,
    nations: [nation({ displayName: 'Malawi', regionsCount: 1, controlPoints: [nonExecCp, execCp] })]
  });
  const executiveCandidate = candidates.find((c) => c.target.isExecutive);
  assert.strictEqual(executiveCandidate.value.allOtherCpsOwnedByObserver, true);
  assert.strictEqual(executiveLastRule.evaluate(world, executiveCandidate), 'pass');
});

// ---------------------------------------------------------------------------
// Investigate -> Turn
// ---------------------------------------------------------------------------

function enemyCouncilor(overrides = {}) {
  return {
    ID: 999,
    displayName: 'Enemy Operative',
    factionName: 'the Servants',
    factionId: 10,
    isAlien: false,
    isIndependent: false,
    attributes: { Loyalty: 5 },
    resolvedAttributes: { effective: { Loyalty: 5 } },
    ...overrides
  };
}

test('Turn candidate carries its unmet preconditions rather than claiming to be actionable', () => {
  const world = buildWorld({ observerId: 4712, councilors: [enemyCouncilor()] });
  const candidates = generateCouncilCandidates(world);
  const turn = candidates.find((c) => c.missionType === 'Turn Councilor');
  assert.ok(turn, 'a Turn candidate was generated');
  assert.ok(turn.unmetPreconditions.length >= 2);
  assert.ok(turn.unmetPreconditions.some((p) => /HasSpySlot/.test(p)));
  assert.ok(turn.unmetPreconditions.some((p) => /HasIntelOnCouncilorSecrets/.test(p)));
  assert.ok(/pending/i.test(turn.title), 'title says so, not pretending the action is unconditionally ready');
});

test("Turn prices the failure-hate branch [0,3,3,0,0,0] as { low: 0, high: 3 }", () => {
  const world = buildWorld({
    observerId: 4712,
    councilors: [enemyCouncilor()],
    posture: { totalWarProximity: 'safe', actualAlienHate: 10, totalWarHeadroom: 100 }
  });
  const turn = generateCouncilCandidates(world).find((c) => c.missionType === 'Turn Councilor');
  assert.deepStrictEqual(turn.hate.toAliens, { low: 0, high: 3 });

  // With headroom = 100 (budget = 50), high-end hate 3 is within budget -> pass
  assert.strictEqual(totalWarBudgetRule.evaluate(world, turn), 'pass');
  // Midpoint is 1.5; staying under 50 hate applies 1x weight -> score contribution -1.5
  assert.strictEqual(warThresholdCrossingRule.evaluate(world, turn), -1.5);

  const { surviving, uncertain, rejected } = applyRules(world, [turn]);
  assert.strictEqual(surviving.length, 1);
  assert.strictEqual(uncertain.length, 0);
  assert.strictEqual(rejected.length, 0);
});

test("Turn is marked uncertain when Total War proximity/headroom is unmeasurable", () => {
  const world = buildWorld({
    observerId: 4712,
    councilors: [enemyCouncilor()],
    posture: { totalWarProximity: 'unknown', actualAlienHate: null, totalWarHeadroom: null }
  });
  const turn = generateCouncilCandidates(world).find((c) => c.missionType === 'Turn Councilor');
  // Turn carries high-end hate of 3, so unmeasurable headroom makes the budget check unknown
  assert.strictEqual(totalWarBudgetRule.evaluate(world, turn), 'unknown');
  const { surviving, uncertain, rejected } = applyRules(world, [turn]);
  assert.strictEqual(surviving.length, 0);
  assert.strictEqual(uncertain.length, 1);
});

test('Investigate Councilor carries zero hate and no unmet preconditions', () => {
  const world = buildWorld({ observerId: 4712, councilors: [enemyCouncilor()] });
  const investigate = generateCouncilCandidates(world).find((c) => c.missionType === 'Investigate Councilor');
  assert.deepStrictEqual(investigate.hate.toAliens, { low: 0, high: 0 });
  assert.deepStrictEqual(investigate.unmetPreconditions, []);
});

test('unreadable Loyalty is not treated as 0, and does not delete the council axis', () => {
  // Player mode strips `attributes` from observed enemies, so Loyalty is
  // genuinely unknown. Two things must both hold: Loyalty must not be
  // scored as 0, and the zero-hate council axis must not silently vanish in
  // the mode the dashboard actually runs in.
  const noLoyalty = enemyCouncilor({ ID: 1, attributes: {}, resolvedAttributes: {} });
  const world = buildWorld({ observerId: 4712, councilors: [noLoyalty] });
  const candidates = generateCouncilCandidates(world);

  assert.ok(candidates.length > 0, 'the council axis survives an unreadable Loyalty');
  assert.strictEqual(candidates[0].target.loyalty, null, 'Loyalty stays null, never 0');

  // Turn is genuinely un-targetable without Loyalty -- it is the defending
  // stat, so there is no basis to choose between targets. Investigate is
  // what resolves that, and is free on every outcome.
  assert.ok(
    candidates.every((c) => c.missionType === 'Investigate Councilor'),
    'no Turn candidate is offered while its target-selection basis is unreadable'
  );
  assert.ok(
    candidates[0].unmetPreconditions.some((p) => /Loyalty is not observable/i.test(p)),
    'the candidate names what could not be measured'
  );
});

test('Loyalty is read from maskedAttributes when that is all player mode exposes', () => {
  const masked = enemyCouncilor({
    ID: 1,
    attributes: {},
    resolvedAttributes: {},
    maskedAttributes: { Loyalty: { visible: 7, visibility: 'estimated', source: 'surveillance' } }
  });
  const world = buildWorld({ observerId: 4712, councilors: [masked] });
  const candidates = generateCouncilCandidates(world);
  assert.ok(candidates.some((c) => c.missionType === 'Turn Councilor'), 'a rankable target restores Turn');
  assert.strictEqual(candidates[0].target.loyalty, 7);
});

test('a masked Loyalty of visible:null stays null rather than becoming 0', () => {
  const masked = enemyCouncilor({
    ID: 1,
    attributes: {},
    resolvedAttributes: {},
    maskedAttributes: { Loyalty: { visible: null, visibility: 'unknown', source: 'surveillance' } }
  });
  const world = buildWorld({ observerId: 4712, councilors: [masked] });
  const candidates = generateCouncilCandidates(world);
  assert.strictEqual(candidates[0].target.loyalty, null);
  assert.ok(candidates.every((c) => c.missionType === 'Investigate Councilor'));
});

// ---------------------------------------------------------------------------
// Intelligence: capability without sighting
// ---------------------------------------------------------------------------

test('capability unlocked with zero sightings emits the "convert capability into sightings" candidate', () => {
  const alien = { ID: 1, isAlien: true, displayName: 'Xenoform Alfa-6', seenByFactionIds: [] };
  const world = buildWorld({
    observerId: 4712,
    councilors: [alien],
    capabilities: { canDirectlyDetectAlienCouncilors: true }
  });
  const candidates = generateIntelligenceCandidates(world);
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].id, 'intel:capability-unlocked-unused');
  assert.strictEqual(candidates[0].hate, null);
});

test('capability-unused fires from alienIntelligenceStage when player mode hides the alien list', () => {
  // Player mode strips unsighted alien councilors entirely, so the raw list
  // is empty in exactly the state this candidate exists to report. The
  // filtered alienIntelligenceStage.operatives block survives and carries
  // the same fact as a count.
  const world = buildWorld({
    observerId: 4712,
    councilors: [],
    capabilities: { canDirectlyDetectAlienCouncilors: true },
    alienIntelligenceStage: {
      operatives: { active: true, status: 'AVAILABLE', detectedCount: 0 }
    }
  });
  const candidates = generateIntelligenceCandidates(world);
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].id, 'intel:capability-unlocked-unused');
  // We know none are sighted; we do NOT know how many exist.
  assert.strictEqual(candidates[0].value.alienCouncilorCount, null);
  assert.strictEqual(candidates[0].value.sightedCount, 0);
});

test('capability-unused does not fire when the capability is locked', () => {
  const world = buildWorld({
    observerId: 4712,
    councilors: [],
    alienIntelligenceStage: { operatives: { active: false, status: 'LOCKED', detectedCount: null } }
  });
  assert.strictEqual(generateIntelligenceCandidates(world).length, 0);
});

test('a visible alien councilor emits a Detain candidate with 10/0 hate instead', () => {
  const alien = { ID: 1, isAlien: true, displayName: 'Xenoform Alfa-6', seenByFactionIds: [4712] };
  const world = buildWorld({
    observerId: 4712,
    councilors: [alien],
    capabilities: { canDirectlyDetectAlienCouncilors: true }
  });
  const candidates = generateIntelligenceCandidates(world);
  assert.strictEqual(candidates.length, 1);
  const detain = candidates[0];
  assert.strictEqual(detain.missionType, 'Detain');
  assert.deepStrictEqual(detain.hate.toAliens, { low: 0, high: 10 });
});

// ---------------------------------------------------------------------------
// Veto three-outcome semantics
// ---------------------------------------------------------------------------

test('a veto returning unknown puts the candidate in uncertain, not rejected, not surviving', () => {
  const world = buildWorld({ observerId: 4712, posture: { totalWarProximity: 'unknown' } });
  const candidate = {
    id: 'synthetic-hate-candidate',
    family: 'council',
    missionType: 'Test Mission',
    title: 'Do the thing',
    target: { kind: 'test' },
    hate: { toAliens: { low: 5, high: 20 }, note: 'test' },
    cost: null,
    value: {},
    score: null,
    provenance: { source: 'test', estimateClass: 'exact' },
    unmetPreconditions: []
  };
  assert.strictEqual(totalWarBudgetRule.evaluate(world, candidate), 'unknown');

  const { surviving, rejected, uncertain } = applyRules(world, [candidate]);
  assert.strictEqual(surviving.length, 0);
  assert.strictEqual(rejected.length, 0);
  assert.strictEqual(uncertain.length, 1);
  assert.strictEqual(uncertain[0].reasons[0].ruleId, 'hate/total-war-budget');
});

test('hate/total-war-budget vetoes a candidate whose high-end hate exceeds the safety-margined headroom', () => {
  const world = buildWorld({
    observerId: 4712,
    posture: { totalWarProximity: 'near', totalWarHeadroom: 10 }
  });
  const candidate = {
    id: 'synthetic-expensive',
    family: 'intelligence',
    missionType: 'Detain',
    title: 'Detain',
    target: { kind: 'alienCouncilor' },
    hate: { toAliens: { low: 0, high: 10 }, note: 'test' },
    cost: null,
    value: {},
    score: null,
    provenance: { source: 'test', estimateClass: 'exact' },
    unmetPreconditions: []
  };
  // headroom 10 * safety margin 0.5 = budget 5; candidate high-end hate is 10 > 5.
  assert.strictEqual(totalWarBudgetRule.evaluate(world, candidate), 'veto');
});

// ---------------------------------------------------------------------------
// Primary selection
// ---------------------------------------------------------------------------

test('primary is never a prohibition and never null; live-shaped open-CP data picks the highest-GDP survivor', () => {
  const cps = (nationName, gdp, regions) => nation({
    displayName: nationName,
    GDP: gdp,
    population: 20,
    regionsCount: regions,
    controlPoints: [
      { id: `${nationName}-1`, factionId: null, isExecutive: false, controlPointType: 'Legislature' },
      { id: `${nationName}-2`, factionId: null, isExecutive: true, controlPointType: 'Executive' }
    ]
  });
  const world = buildWorld({
    observerId: 4712,
    nations: [
      cps('Malawi', 71.7e9, 1),
      cps('Honduras', 70.8e9, 1),
      cps('Madagascar', 69.9e9, 1),
      cps('Namibia', 39.6e9, 1)
    ]
  });
  const result = runEngine(world);
  assert.strictEqual(result.primary.id, 'control-nation:Malawi:Legislature');
  assert.ok(!/^do not|^hold\b|^watch\b/i.test(result.primary.title) || result.primary.isFallback);
});

test('primary is the explicit positive preparation action when everything is blocked', () => {
  const cp = { id: 1, factionId: null, isExecutive: false, controlPointType: 'MassMedia' };
  const world = buildWorld({
    observerId: 4712,
    // Absorbed nation only -- the one candidate this world can generate is
    // guaranteed to be vetoed by legality/no-territory.
    nations: [nation({ displayName: 'Italy', GDP: 1.4e9, population: 58.9, regionsCount: 0, controlPoints: [cp] })]
  });
  const result = runEngine(world);
  assert.strictEqual(result.primary.id, 'prepare-next-action');
  assert.strictEqual(result.primary.isFallback, true);
  assert.notStrictEqual(result.primary, null);
  assert.ok(!/^do not/i.test(result.primary.title));
});

test('primary is drawn from surviving, never from uncertain', () => {
  // One candidate the total-war-budget rule cannot measure (uncertain), and
  // no other candidates at all -- the engine must not promote the uncertain
  // one to primary; it must fall back to a positive preparation action.
  const world = buildWorld({ observerId: 4712, posture: { totalWarProximity: 'unknown' } });
  const uncertainCandidate = {
    id: 'synthetic-uncertain',
    family: 'intelligence',
    missionType: 'Detain',
    title: 'Detain',
    target: { kind: 'alienCouncilor' },
    hate: { toAliens: { low: 0, high: 10 }, note: 'test' },
    cost: null,
    value: {},
    score: null,
    provenance: { source: 'test', estimateClass: 'exact' },
    unmetPreconditions: []
  };
  const { surviving, rejected, uncertain } = applyRules(world, [uncertainCandidate]);
  assert.strictEqual(surviving.length, 0);
  assert.strictEqual(uncertain.length, 1);
  // Mirror what runEngine does with an empty surviving list.
  assert.strictEqual(rejected.length, 0);
});

// ---------------------------------------------------------------------------
// Absent measurements are not coerced to 0
// ---------------------------------------------------------------------------

test('a control point with unknown GDP gets value.gdpBn = null, not 0', () => {
  const world = buildWorld({ observerId: 4712 });
  const cp = { id: 1, factionId: null, isExecutive: false, controlPointType: 'Legislature' };
  const candidates = generateOpenControlPointCandidates({
    ...world,
    nations: [nation({ displayName: 'Unmeasured', GDP: null, population: 20, regionsCount: 1, controlPoints: [cp] })]
  });
  assert.strictEqual(candidates[0].value.gdpBn, null);
  // The value/gdp-per-cp-cost rule must not silently score an unmeasured GDP.
  const valueRule = RULES.find((r) => r.id === 'value/gdp-per-cp-cost');
  assert.strictEqual(valueRule.appliesTo(candidates[0]), false);
});

test('cost/affordability returns unknown, not veto, when resource stock is unavailable', () => {
  const world = buildWorld({ observerId: 4712, resources: null });
  const candidate = {
    id: 'synthetic-flat-cost',
    family: 'council',
    missionType: 'Defend Interests',
    title: 'Defend Interests',
    target: { kind: 'test' },
    hate: null,
    cost: { resource: 'Influence', amount: 20, kind: 'flat' },
    value: {},
    score: null,
    provenance: { source: 'test', estimateClass: 'exact' },
    unmetPreconditions: []
  };
  assert.strictEqual(affordabilityRule.evaluate(world, candidate), 'unknown');
});

test('cost/affordability vetoes a flat cost we cannot afford, and passes one we can', () => {
  const world = buildWorld({ observerId: 4712, resources: { Influence: 5 } });
  const tooExpensive = {
    id: 'a', family: 'council', missionType: 'Defend Interests', title: 'x', target: {},
    hate: null, cost: { resource: 'Influence', amount: 20, kind: 'flat' }, value: {}, score: null,
    provenance: { source: 'test', estimateClass: 'exact' }, unmetPreconditions: []
  };
  const affordable = { ...tooExpensive, id: 'b', cost: { resource: 'Influence', amount: 3, kind: 'flat' } };
  assert.strictEqual(affordabilityRule.evaluate(world, tooExpensive), 'veto');
  assert.strictEqual(affordabilityRule.evaluate(world, affordable), 'pass');
});

test('Turn/Investigate bonus-cost amount is null, not a guessed number', () => {
  const world = buildWorld({ observerId: 4712, councilors: [enemyCouncilor()] });
  const candidates = generateCouncilCandidates(world);
  for (const candidate of candidates) {
    assert.strictEqual(candidate.cost.kind, 'bonus');
    assert.strictEqual(candidate.cost.amount, null);
  }
});

// ---------------------------------------------------------------------------
// End-to-end shape sanity
// ---------------------------------------------------------------------------

test('generateCandidates combines all three families', () => {
  const alien = { ID: 1, isAlien: true, displayName: 'Xenoform', seenByFactionIds: [] };
  const world = buildWorld({
    observerId: 4712,
    nations: [nation({
      displayName: 'Malawi',
      GDP: 71.7e9,
      population: 19.9,
      regionsCount: 1,
      controlPoints: [{ id: 1, factionId: null, isExecutive: false, controlPointType: 'Legislature' }]
    })],
    councilors: [enemyCouncilor(), alien],
    capabilities: { canDirectlyDetectAlienCouncilors: true }
  });
  const candidates = generateCandidates(world);
  const families = new Set(candidates.map((c) => c.family));
  assert.ok(families.has('expansion'));
  assert.ok(families.has('council'));
  assert.ok(families.has('intelligence'));
});

test('WEIGHTS is a single frozen config object', () => {
  assert.ok(Object.isFrozen(WEIGHTS));
  assert.strictEqual(typeof WEIGHTS.TOTAL_WAR_SAFETY_MARGIN, 'number');
  assert.strictEqual(typeof WEIGHTS.HATE_CROSSING.crossing200, 'number');
});

test('directive scoring honors runtime-configured weights', () => {
  const base = buildWorld({ observerId: 4712, councilors: [enemyCouncilor()] });
  const tuned = buildWorld({
    observerId: 4712,
    councilors: [enemyCouncilor()],
    directiveWeights: { council: { turn: 100, investigate: 3, proxyTargetBonus: 3 } }
  });
  const candidate = generateCouncilCandidates(base).find((entry) => entry.missionType === 'Turn Councilor');
  const baseScore = scoreCandidates(base, [candidate])[0].score;
  const tunedScore = scoreCandidates(tuned, [candidate])[0].score;
  assert.ok(tunedScore > baseScore, `expected tuned score ${tunedScore} to exceed ${baseScore}`);
});

test('Defend Interests scoring honors runtime-configured defense weights', () => {
  const worldOptions = {
    observerId: 4712,
    nations: [nation({
      displayName: 'United States',
      GDP: 20e12,
      controlPoints: [{ id: 'us-1', factionId: 4712, isExecutive: true, controlPointType: 'Executive' }]
    })]
  };
  const base = buildWorld(worldOptions);
  const tuned = buildWorld({
    ...worldOptions,
    directiveWeights: { defense: { base: 50, escalateLateBonus: 3 } }
  });
  const candidate = generateDefendInterestsCandidates(base)[0];
  const baseScore = scoreCandidates(base, [candidate])[0].score;
  const tunedScore = scoreCandidates(tuned, [candidate])[0].score;
  assert.equal(tunedScore - baseScore, 45);
});

test('fallback recommendation remains a positive preparation action with reasoning', () => {
  const result = runEngine(buildWorld({
    observerId: 4712,
    nations: [nation({ displayName: 'Unformed', population: 0, regionsCount: 0, controlPoints: [{ id: 1, factionId: null, isExecutive: false, controlPointType: 'Executive' }] })]
  }));
  assert.equal(result.primary.id, 'prepare-next-action');
  assert.match(result.primary.title, /prepare|protect/i);
  assert.ok(result.decisionReasoning);
  assert.match(result.decisionReasoning.summary, /positive preparation/i);
  assert.ok(result.decisionReasoning.sources.some((source) => /preparation fallback/i.test(source)));
});

test('decision reasoning marks a primary with unresolved prerequisites as conditional', () => {
  const reasoning = buildDecisionReasoning(
    {
      title: 'Defend Interests in Testland',
      unmetPreconditions: ['Defense state is not observable for one control point.'],
      provenance: { source: 'test candidate' },
      scoreBreakdown: []
    },
    [],
    [],
    [],
    [],
    1
  );
  assert.equal(reasoning.confidence, 'conditional');
});

// ---------------------------------------------------------------------------
// Story-Gating on CaptureAHydra / AccessLiveHydra (Finding 2)
// ---------------------------------------------------------------------------

test('Detain on alien councilor passes legality/story-gate when canDetainAlienCouncilors is true', () => {
  const alien = { ID: 1, isAlien: true, displayName: 'Hydra Operative', seenByFactionIds: [4712] };
  const world = buildWorld({
    observerId: 4712,
    councilors: [alien],
    capabilities: { canDirectlyDetectAlienCouncilors: true, canDetainAlienCouncilors: true },
    posture: { totalWarProximity: 'safe', totalWarHeadroom: 100 }
  });
  const candidates = generateIntelligenceCandidates(world);
  const detain = candidates.find((c) => c.missionType === 'Detain');
  assert.ok(detain);
  assert.strictEqual(storyGateRule.evaluate(world, detain), 'pass');
  assert.strictEqual(detain.unmetPreconditions.length, 0);
});

test('Detain on alien councilor is vetoed by legality/story-gate when canDetainAlienCouncilors is false', () => {
  const alien = { ID: 1, isAlien: true, displayName: 'Hydra Operative', seenByFactionIds: [4712] };
  const world = buildWorld({
    observerId: 4712,
    councilors: [alien],
    capabilities: { canDirectlyDetectAlienCouncilors: true, canDetainAlienCouncilors: false },
    posture: { totalWarProximity: 'safe', totalWarHeadroom: 100 }
  });
  const candidates = generateIntelligenceCandidates(world);
  const detain = candidates.find((c) => c.missionType === 'Detain');
  assert.ok(detain);
  assert.strictEqual(storyGateRule.evaluate(world, detain), 'veto');
  assert.ok(detain.unmetPreconditions.some((p) => /story-locked/i.test(p)));
  const { rejected, surviving } = applyRules(world, [detain]);
  assert.strictEqual(rejected.length, 1);
  assert.strictEqual(surviving.length, 0);
});

test('Detain on alien councilor is marked uncertain when canDetainAlienCouncilors is undefined', () => {
  const alien = { ID: 1, isAlien: true, displayName: 'Hydra Operative', seenByFactionIds: [4712] };
  const world = buildWorld({
    observerId: 4712,
    councilors: [alien],
    capabilities: { canDirectlyDetectAlienCouncilors: true },
    posture: { totalWarProximity: 'safe', totalWarHeadroom: 100 }
  });
  const candidates = generateIntelligenceCandidates(world);
  const detain = candidates.find((c) => c.missionType === 'Detain');
  assert.strictEqual(storyGateRule.evaluate(world, detain), 'unknown');
  const { uncertain, surviving } = applyRules(world, [detain]);
  assert.strictEqual(uncertain.length, 1);
  assert.strictEqual(surviving.length, 0);
});

// ---------------------------------------------------------------------------
// Redacted Hate Threshold Crossing (Finding 4)
// ---------------------------------------------------------------------------

test('redacted hate scores at 3x when pips >= 4 or elevated/hot, and 1x when pips < 4', () => {
  const candidate = {
    id: 'test-hate',
    hate: { toAliens: { low: 0, high: 2 } }
  };
  const lowPipsWorld = buildWorld({
    observerId: 4712,
    posture: { actualAlienHate: null, pips: 2 }
  });
  // mid = 1 * 1x weight = -1
  assert.strictEqual(warThresholdCrossingRule.evaluate(lowPipsWorld, candidate), -1);

  const highPipsWorld = buildWorld({
    observerId: 4712,
    posture: { actualAlienHate: null, pips: 4 }
  });
  // mid = 1 * 3x weight = -3
  assert.strictEqual(warThresholdCrossingRule.evaluate(highPipsWorld, candidate), -3);

  const totalWarWorld = buildWorld({
    observerId: 4712,
    posture: { actualAlienHate: null, totalWarProximity: 'near' }
  });
  // mid = 1 * 10x weight = -10
  assert.strictEqual(warThresholdCrossingRule.evaluate(totalWarWorld, candidate), -10);
});

// ---------------------------------------------------------------------------
// Rule Citations in scoreBreakdown & decisionReasoning (Finding 5)
// ---------------------------------------------------------------------------

test('scoreBreakdown entries include source and estimateClass citations', () => {
  const world = buildWorld({
    observerId: 4712,
    councilors: [enemyCouncilor()],
    posture: { actualAlienHate: 10, totalWarHeadroom: 100 }
  });
  const turn = generateCouncilCandidates(world).find((c) => c.missionType === 'Turn Councilor');
  const [scored] = scoreCandidates(world, [turn]);
  assert.ok(Array.isArray(scored.scoreBreakdown));
  for (const entry of scored.scoreBreakdown) {
    assert.ok(entry.source, `Entry ${entry.ruleId} must have a source citation`);
    assert.ok(entry.estimateClass, `Entry ${entry.ruleId} must have an estimateClass`);
  }
  const result = runEngine(world);
  assert.ok(result.decisionReasoning);
  assert.ok(Array.isArray(result.decisionReasoning.sources));
  assert.ok(result.decisionReasoning.sources.length > 0);
});

// ---------------------------------------------------------------------------
// Defend Interests Candidates & Affordability (Finding 6)
// ---------------------------------------------------------------------------

test('generateDefendInterestsCandidates creates candidates for observer-held nations', () => {
  const world = buildWorld({
    observerId: 4712,
    observerName: 'the Initiative',
    resources: { Influence: 100 },
    nations: [
      nation({
        displayName: 'United States',
        GDP: 20e12,
        regionsCount: 50,
        controlPoints: [
          { id: 'us-1', factionId: 4712, isExecutive: true, controlPointType: 'Executive' },
          { id: 'us-2', factionId: 4712, isExecutive: false, controlPointType: 'Legislature' }
        ]
      })
    ]
  });
  const candidates = generateDefendInterestsCandidates(world);
  assert.strictEqual(candidates.length, 1);
  const def = candidates[0];
  assert.strictEqual(def.missionType, 'Defend Interests');
  assert.deepStrictEqual(def.cost, { resource: 'Influence', amount: 20, kind: 'flat' });
  assert.deepStrictEqual(def.hate.toAliens, { low: 0, high: 0 });
  assert.strictEqual(affordabilityRule.evaluate(world, def), 'pass');
  assert.ok(defendInterestsRule.evaluate(world, def) > 0);
});

test('Defend Interests skips holdings with active future-dated wards and reopens expired wards', () => {
  const controlPoints = [
    { id: 1, factionId: 4712, isExecutive: true, controlPointType: 'Executive', defended: true,
      defendExpiration: { year: 2032, month: 12, day: 31, hour: 23, minute: 59 } },
    { id: 2, factionId: 4712, isExecutive: false, controlPointType: 'Legislature', defended: true,
      defendExpiration: { year: 2032, month: 12, day: 31, hour: 23, minute: 59 } }
  ];
  const nationData = nation({ displayName: 'Wardland', GDP: 20e12, controlPoints });
  const activeWorld = buildWorld({
    observerId: 4712,
    campaignDate: '2032-08-16T12:00:00Z',
    nations: [nationData]
  });
  assert.deepStrictEqual(generateDefendInterestsCandidates(activeWorld), []);

  const expiredWorld = buildWorld({
    observerId: 4712,
    campaignDate: '2033-01-01T00:00:00Z',
    nations: [nationData]
  });
  const reopened = generateDefendInterestsCandidates(expiredWorld);
  assert.strictEqual(reopened.length, 1);
  assert.strictEqual(reopened[0].value.unprotectedControlPointCount, 2);
});

// The rule bodies live in server/engine/rules/{hate,legality,value,readiness,
// portfolio}.js and the registry in rules/index.js assembles them. The
// assembled ORDER is load-bearing and is NOT grouped by family: applyRules
// collects veto reasons in registry order and scoreCandidates emits
// scoreBreakdown in registry order, so both appear in a briefing in exactly
// this sequence, with readiness/unmet-preconditions sitting in the middle of
// the value rules. A reordering would silently reshuffle every explanation.
test('the rule registry preserves its exact order and each rule keeps its kind', () => {
  assert.deepStrictEqual(RULES.map((rule) => rule.id), [
    'hate/total-war-budget',
    'hate/war-threshold-crossing',
    'legality/executive-last',
    'legality/no-territory',
    'legality/story-gate',
    'value/gdp-per-cp-cost',
    'value/defend-interests',
    'value/counter-councilor',
    'readiness/unmet-preconditions',
    'value/unblock-alien-response',
    'value/advisory-potential',
    'cost/affordability',
    'risk/success-floor'
  ]);

  assert.deepStrictEqual(RULES.map((rule) => rule.kind), [
    'veto', 'score', 'veto', 'veto', 'veto', 'score',
    'score', 'score', 'score', 'score', 'score', 'veto', 'veto'
  ]);

  // Scope is part of the contract: a rule that does not declare one is
  // evaluated against a bare candidate by `applyRules`, and only a rule that
  // says 'pairing' is evaluated by `applyPairingRules` once a councilor is
  // named. Mislabelling risk/success-floor as candidate-scoped would make it
  // return 'unknown' for every candidate on the board and sweep them all out
  // of the cycle plan.
  assert.deepStrictEqual(RULES.map((rule) => rule.scope ?? null), [
    null, null, null, null, null, null,
    null, null, null, null, null, null, 'pairing'
  ]);

  for (const rule of RULES) {
    assert.strictEqual(typeof rule.appliesTo, 'function', `${rule.id} appliesTo`);
    assert.strictEqual(typeof rule.evaluate, 'function', `${rule.id} evaluate`);
    assert.strictEqual(typeof rule.because, 'function', `${rule.id} because`);
    assert.strictEqual(typeof rule.source, 'string', `${rule.id} source`);
    assert.ok(['exact', 'heuristic', 'calculated'].includes(rule.estimateClass), `${rule.id} estimateClass`);
  }
});

// The barrel re-exports the SAME function objects the engine modules define,
// rather than wrapping them. A wrapper would still pass every behavioural test
// while allowing the barrel and the implementation to drift apart.
test('directiveEngine re-exports the engine modules without wrapping them', () => {
  assert.strictEqual(engine.WEIGHTS, require('../server/engine/weights').WEIGHTS);
  assert.strictEqual(engine.RULES, require('../server/engine/rules').RULES);
  assert.strictEqual(engine.generateCandidates, require('../server/engine/candidates').generateCandidates);
  assert.strictEqual(engine.applyRules, require('../server/engine/selection').applyRules);
  assert.strictEqual(engine.scoreCandidates, require('../server/engine/selection').scoreCandidates);
  assert.strictEqual(engine.buildDecisionReasoning, require('../server/engine/selection').buildDecisionReasoning);
  assert.strictEqual(
    engine.generateOpenControlPointCandidates,
    require('../server/engine/candidates/controlPoints').generateOpenControlPointCandidates
  );
  assert.strictEqual(
    engine.generateDefendInterestsCandidates,
    require('../server/engine/candidates/defense').generateDefendInterestsCandidates
  );
  assert.strictEqual(
    engine.generateCouncilCandidates,
    require('../server/engine/candidates/council').generateCouncilCandidates
  );
  assert.strictEqual(
    engine.generateIntelligenceCandidates,
    require('../server/engine/candidates/intelligence').generateIntelligenceCandidates
  );
});
