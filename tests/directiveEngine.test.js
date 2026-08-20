const { test } = require('node:test');
const assert = require('node:assert');

const engine = require('../server/directiveEngine');
const {
  WEIGHTS,
  RULES,
  buildWorld,
  generateOpenControlPointCandidates,
  generateCouncilCandidates,
  generateIntelligenceCandidates,
  generateCandidates,
  applyRules,
  scoreCandidates,
  runEngine
} = engine;

const noTerritoryRule = RULES.find((r) => r.id === 'legality/no-territory');
const executiveLastRule = RULES.find((r) => r.id === 'legality/executive-last');
const totalWarBudgetRule = RULES.find((r) => r.id === 'hate/total-war-budget');
const warThresholdCrossingRule = RULES.find((r) => r.id === 'hate/war-threshold-crossing');
const affordabilityRule = RULES.find((r) => r.id === 'cost/affordability');

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
  assert.ok(!result.rejected.some((r) => r.candidate.target.nation === 'Aceh'));
});

test('absorbed nations end up in rejected, not futureOpportunities', () => {
  const cp = { id: 1, factionId: null, isExecutive: false, controlPointType: 'MassMedia' };
  const world = buildWorld({
    observerId: 4712,
    nations: [nation({ displayName: 'Italy', GDP: 1.4e9, population: 58.9, regionsCount: 0, controlPoints: [cp] })]
  });
  const result = runEngine(world);
  assert.strictEqual(result.rejected.length, 1);
  assert.strictEqual(result.rejected[0].candidate.target.nation, 'Italy');
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

test("Turn's expected hate is 0 on success and is not penalised by the hate rules", () => {
  const world = buildWorld({
    observerId: 4712,
    councilors: [enemyCouncilor()],
    posture: { totalWarProximity: 'unknown', actualAlienHate: null, totalWarHeadroom: null }
  });
  const turn = generateCouncilCandidates(world).find((c) => c.missionType === 'Turn Councilor');
  assert.deepStrictEqual(turn.hate.toAliens, { low: 0, high: 0 });

  // Even with Total War proximity unmeasurable, zero exposure must never be
  // downgraded to 'unknown' -- there is nothing to be uncertain about.
  assert.strictEqual(totalWarBudgetRule.evaluate(world, turn), 'pass');
  assert.strictEqual(warThresholdCrossingRule.evaluate(world, turn), 0);

  const { surviving, uncertain, rejected } = applyRules(world, [turn]);
  assert.strictEqual(surviving.length, 1);
  assert.strictEqual(uncertain.length, 0);
  assert.strictEqual(rejected.length, 0);
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

test('primary is the explicit no-safe-action candidate when everything generated is vetoed', () => {
  const cp = { id: 1, factionId: null, isExecutive: false, controlPointType: 'MassMedia' };
  const world = buildWorld({
    observerId: 4712,
    // Absorbed nation only -- the one candidate this world can generate is
    // guaranteed to be vetoed by legality/no-territory.
    nations: [nation({ displayName: 'Italy', GDP: 1.4e9, population: 58.9, regionsCount: 0, controlPoints: [cp] })]
  });
  const result = runEngine(world);
  assert.strictEqual(result.primary.id, 'no-safe-action');
  assert.strictEqual(result.primary.isFallback, true);
  assert.notStrictEqual(result.primary, null);
  assert.ok(!/^do not/i.test(result.primary.title));
});

test('primary is drawn from surviving, never from uncertain', () => {
  // One candidate the total-war-budget rule cannot measure (uncertain), and
  // no other candidates at all -- the engine must not promote the uncertain
  // one to primary; it must fall back to no-safe-action.
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
