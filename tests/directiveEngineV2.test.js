const { test } = require('node:test');
const assert = require('node:assert');

const { MissionCatalogue } = require('../server/engine/missionCatalogue');
const { evaluatePairingFeasibility, isCouncilorFree } = require('../server/engine/feasibility');
const { calculateRollChance, computeMissionOdds, getCouncilorAttribute, CAMPAIGN_ATTRIBUTE_MEDIANS } = require('../server/engine/odds');
const { BudgetPoolManager } = require('../server/engine/budgets');
const { buildCandidatePairing } = require('../server/engine/pairing');
const { allocateCyclePlan } = require('../server/engine/assignment');
const { computeStrategicClocks } = require('../server/engine/clocks');
const { buildWorld, runEngine } = require('../server/directiveEngine');
const briefingGenerator = require('../server/briefingGenerator');

// ---------------------------------------------------------------------------
// 1. MissionCatalogue
// ---------------------------------------------------------------------------

test('MissionCatalogue indexes and queries mission specs correctly', () => {
  const specs = {
    GainInfluence: {
      friendlyName: 'Control Nation',
      contested: false,
      costResource: 'Influence',
      costKind: 'Bonus',
      costAmount: null,
      successHate: 0,
      failureHate: 0,
      conditions: ['TargetInRange', 'Human', 'AvailableControlPoint']
    },
    Turn: {
      friendlyName: 'Turn Councilor',
      contested: true,
      attack: 'Persuasion',
      defend: 'Loyalty',
      baseDifficulty: 15,
      costResource: 'Influence',
      costKind: 'Bonus',
      successHate: 0,
      failureHate: 3,
      conditions: ['TargetInRange', 'HasIntelOnCouncilorSecrets']
    }
  };

  const catalogue = new MissionCatalogue(specs);
  assert.strictEqual(catalogue.size, 2);
  assert.strictEqual(catalogue.isAutomatic('GainInfluence'), true);
  assert.strictEqual(catalogue.isContested('Turn'), true);
  assert.strictEqual(catalogue.getHate('Turn').failure, 3);
  assert.strictEqual(catalogue.getBaseDifficulty('Turn'), 15);
  assert.strictEqual(catalogue.getAttackAttribute('Turn'), 'Persuasion');
});

// ---------------------------------------------------------------------------
// 2. Feasibility
// ---------------------------------------------------------------------------

test('feasibility correctly filters detained councilors and theater constraints', () => {
  const earthCouncilor = { id: 1, name: 'Agent', locationType: 'earth', status: 'Active' };
  const spaceCouncilor = { id: 2, name: 'Cosmonaut', locationType: 'space', status: 'Active' };
  const detainedCouncilor = { id: 3, name: 'Captured', locationType: 'earth', status: 'detained' };

  assert.strictEqual(isCouncilorFree(earthCouncilor), true);
  assert.strictEqual(isCouncilorFree(detainedCouncilor), false);

  const earthMission = {
    missionSpec: {
      context: 'EarthOnly',
      conditions: ['TargetInRange', 'CouncilorOnEarth']
    }
  };

  const earthResult = evaluatePairingFeasibility(earthMission, earthCouncilor);
  assert.strictEqual(earthResult.status, 'pass');

  const spaceResult = evaluatePairingFeasibility(earthMission, spaceCouncilor);
  assert.strictEqual(spaceResult.status, 'fail');
  assert.ok(spaceResult.reasons.some(r => r.includes('Earth theater') || r.includes('Earth')));

  const detainedResult = evaluatePairingFeasibility(earthMission, detainedCouncilor);
  assert.strictEqual(detainedResult.status, 'fail');
});

// ---------------------------------------------------------------------------
// 3. Attribute Extraction (Effective vs Base & Null Safety)
// ---------------------------------------------------------------------------

test('getCouncilorAttribute reads effective traits/orgs and returns null for missing attributes', () => {
  const councilorWithEffective = {
    id: 1,
    attributes: { Persuasion: 15 },
    resolvedAttributes: {
      base: { Persuasion: 15, Espionage: 10 },
      effective: { Persuasion: 25, Espionage: 18 }
    }
  };

  // Must read effective (25), not raw base (15)
  assert.strictEqual(getCouncilorAttribute(councilorWithEffective, 'Persuasion'), 25);
  assert.strictEqual(getCouncilorAttribute(councilorWithEffective, 'Espionage'), 18);

  // Missing attribute must return null, never coerced to 0
  assert.strictEqual(getCouncilorAttribute(councilorWithEffective, 'Science'), null);
  assert.strictEqual(getCouncilorAttribute(null, 'Persuasion'), null);
});

// ---------------------------------------------------------------------------
// 4. Odds, Wiki Roll Curve, Loyalty 0 & GDP Defense
// ---------------------------------------------------------------------------

test('Wiki roll formula matches verified table points', () => {
  // Verified points: diff 0->50.0%, 3->76.7%, 5->86.0%, 10->96.1%, 20->99.7%
  const tolerance = 0.005;

  assert.ok(Math.abs(calculateRollChance(0) - 0.50) < tolerance, 'diff 0 should be 50%');
  assert.ok(Math.abs(calculateRollChance(3) - 0.767) < tolerance, 'diff 3 should be 76.7%');
  assert.ok(Math.abs(calculateRollChance(5) - 0.860) < tolerance, 'diff 5 should be 86.0%');
  assert.ok(Math.abs(calculateRollChance(10) - 0.961) < tolerance, 'diff 10 should be 96.1%');
  assert.ok(Math.abs(calculateRollChance(20) - 0.997) < tolerance, 'diff 20 should be 99.7%');

  // Negative diffs
  assert.ok(Math.abs(calculateRollChance(-3) - (1 - 0.767)) < tolerance, 'diff -3 should be 23.3%');

  // Invalid / non-numeric input returns null (not 0.5)
  assert.strictEqual(calculateRollChance(null), null);
  assert.strictEqual(calculateRollChance(undefined), null);
  assert.strictEqual(calculateRollChance(NaN), null);
  assert.strictEqual(calculateRollChance('invalid'), null);
});

test('genuine Loyalty of 0 is measured directly rather than masked to median', () => {
  const attacker = {
    id: 1,
    resolvedAttributes: { effective: { Persuasion: 20 } }
  };

  const turnSpec = {
    contested: true,
    attack: 'Persuasion',
    defend: 'Loyalty',
    baseDifficulty: 15
  };

  // 1. Target with real Loyalty = 0
  const loyalZeroTarget = {
    councilor: {
      id: 201,
      name: 'Vulnerable Operative',
      resolvedAttributes: { effective: { Loyalty: 0 } }
    }
  };

  const zeroOdds = computeMissionOdds({ missionSpec: turnSpec, target: loyalZeroTarget }, attacker);
  assert.strictEqual(zeroOdds.assumed, false);
  // Diff = 20 - (15 + 0) = +5 -> chance = 86.0%
  assert.strictEqual(zeroOdds.point, 86);

  // 2. Target with masked Loyalty (missing attribute)
  const maskedTarget = {
    councilor: {
      id: 202,
      name: 'Unknown Operative',
      resolvedAttributes: {}
    }
  };

  const maskedOdds = computeMissionOdds({ missionSpec: turnSpec, target: maskedTarget }, attacker);
  assert.strictEqual(maskedOdds.assumed, true);
  // Diff = 20 - (15 + 11) = -6 -> chance ~10.8%
  assert.ok(maskedOdds.point >= 10 && maskedOdds.point <= 12);
});

test('GDP defense term scales accurately for Control Nation (Malawi test case)', () => {
  const controlSpec = {
    dataName: 'GainInfluence',
    friendlyName: 'Control Nation',
    contested: true,
    attack: 'Persuasion',
    baseDifficulty: 0
  };

  // Malawi: $71.7 Bn -> gdpBn = 71.7 -> defense = 71.7^(1/3) = 4.154
  const malawiTarget = {
    nation: 'Malawi',
    GDP: 71.7e9,
    gdpBn: 71.7
  };

  // Persuasion 4 attacker: diff = 4 - 4.154 = -0.154 -> 48.0%
  const councilor4 = { resolvedAttributes: { effective: { Persuasion: 4 } } };
  const odds4 = computeMissionOdds({ missionSpec: controlSpec, target: malawiTarget }, councilor4);
  assert.strictEqual(odds4.point, 48);

  // Persuasion 5 attacker: diff = 5 - 4.154 = +0.846 -> 59.6% (~60%)
  const councilor5 = { resolvedAttributes: { effective: { Persuasion: 5 } } };
  const odds5 = computeMissionOdds({ missionSpec: controlSpec, target: malawiTarget }, councilor5);
  assert.strictEqual(odds5.point, 60);
});

// ---------------------------------------------------------------------------
// 5. Budget Pools
// ---------------------------------------------------------------------------

test('BudgetPoolManager prevents pool over-allocation', () => {
  const world = {
    alienHate: { assessedHate: 10, mcFloor: 0 },
    resources: { influence: 30, operations: 10 }
  };

  const manager = new BudgetPoolManager(world, { safetyMargin: 0.5 });
  assert.strictEqual(manager.canAfford({ resource: 'Influence', amount: 20 }).affordable, true);

  manager.consume({ resource: 'Influence', amount: 20 });
  assert.strictEqual(manager.canAfford({ resource: 'Influence', amount: 15 }).affordable, false);
  const shortfall = manager.canAfford({ resource: 'Influence', amount: 15 }).shortfall;
  assert.strictEqual(shortfall, 5);
});

// ---------------------------------------------------------------------------
// 6. Assignment Allocator & Determinism
// ---------------------------------------------------------------------------

test('allocateCyclePlan produces deterministic plan and reports opportunity costs', () => {
  const councilors = [
    { id: 1, name: 'Alice', resolvedAttributes: { effective: { Persuasion: 25 } }, locationType: 'earth' },
    { id: 2, name: 'Bob', resolvedAttributes: { effective: { Espionage: 20 } }, locationType: 'earth' }
  ];

  const candidates = [
    {
      id: 'control-japan',
      title: 'Control Nation in Japan',
      missionSpec: { contested: true, attack: 'Persuasion', baseDifficulty: 5 },
      baseValue: 6.0,
      cost: { resource: 'Influence', amount: 10 }
    },
    {
      id: 'purge-russia',
      title: 'Purge CP in Russia',
      missionSpec: { contested: true, attack: 'Espionage', baseDifficulty: 3, successHate: 2, failureHate: 1 },
      baseValue: 5.0,
      cost: { resource: 'Influence', amount: 15 }
    }
  ];

  const world = {
    resources: { influence: 100, operations: 50 },
    alienHate: { assessedHate: 10 }
  };

  const plan1 = allocateCyclePlan(candidates, councilors, world);
  const plan2 = allocateCyclePlan(candidates, councilors, world);

  assert.strictEqual(plan1.assignments.length, 2);
  assert.strictEqual(plan1.assignments[0].councilorId, 1);
  assert.strictEqual(plan1.assignments[1].councilorId, 2);
  assert.strictEqual(JSON.stringify(plan1), JSON.stringify(plan2), 'plan generation must be deterministic');
});

// ---------------------------------------------------------------------------
// 7. BriefingGenerator & Directive Engine Integration
// ---------------------------------------------------------------------------

test('briefingGenerator forwards cyclePlan inside engineDirectives', () => {
  const councilor = {
    ID: 101,
    displayName: 'Samantha Ryan',
    factionId: '4712',
    resolvedAttributes: { effective: { Persuasion: 22 } },
    locationType: 'earth'
  };

  const snapshot = {
    metadata: { gameTimeString: '2026-08-20' },
    factions: [{ ID: '4712', displayName: 'The Initiative', isObserver: true, resources: { influence: 100 } }],
    nations: [
      {
        displayName: 'Japan',
        GDP: 5.4e12,
        regionsCount: 1,
        controlPoints: [{ id: 1, factionId: null, isExecutive: false, controlPointType: 'Legislature' }]
      }
    ],
    councilors: [councilor]
  };

  const briefing = briefingGenerator.generateMissionControlBriefing(snapshot);

  assert.ok(briefing.engineDirectives, 'engineDirectives must be present');
  assert.ok(briefing.engineDirectives.cyclePlan, 'cyclePlan must be forwarded inside engineDirectives');
  assert.strictEqual(briefing.engineDirectives.cyclePlan.assignments.length, 1);
});

// ---------------------------------------------------------------------------
// 8. Absent mission rules stay absent (§0a: displayed facts are never fabricated)
// ---------------------------------------------------------------------------

test('odds are unavailable, not invented, when the mission spec is missing', () => {
  const councilor = { id: 1, resolvedAttributes: { effective: { Persuasion: 25 } } };

  // Defend Interests is uncontested: it has no roll at all. The old code
  // defaulted the attack attribute to Persuasion and the base difficulty to 0
  // and reported 99.9% -- a number produced by a roll that does not exist.
  const odds = computeMissionOdds({ missionType: 'Defend Interests', target: {} }, councilor);

  assert.strictEqual(odds.chance, null);
  assert.strictEqual(odds.point, null);
  assert.strictEqual(odds.band, null);
  assert.strictEqual(odds.automatic, null, 'contested-ness is a template fact we do not have here');
  assert.strictEqual(odds.offense, null);
  assert.strictEqual(odds.defense, null);
  assert.strictEqual(odds.available, false);
  assert.match(odds.basis, /mission rules unavailable/i);
  assert.match(odds.basis, /Defend Interests/);
});

test('a spec that is present still resolves: Defend Interests is automatic, not a roll', () => {
  const defendSpec = {
    friendlyName: 'Defend Interests', contested: false, attack: null, defend: null, baseDifficulty: 0
  };
  const odds = computeMissionOdds(
    { missionType: 'Defend Interests', missionSpec: defendSpec, target: {} },
    { id: 1, resolvedAttributes: { effective: { Persuasion: 25 } } }
  );

  assert.strictEqual(odds.automatic, true);
  assert.strictEqual(odds.chance, 1.0);
  assert.strictEqual(odds.basis, '100% (Automatic)');
});

test('the attack attribute is never defaulted to Persuasion', () => {
  const councilor = { id: 1, resolvedAttributes: { effective: { Persuasion: 25, Espionage: 3 } } };

  // Purge attacks on Espionage. With no spec the old code read Persuasion (25)
  // and reported a plausible number off an entirely different attribute.
  const noSpec = computeMissionOdds({ missionType: 'Purge', target: {} }, councilor);
  assert.strictEqual(noSpec.chance, null);
  assert.strictEqual(noSpec.offense, null, 'must not fall back to another attribute');

  // With Purge's real spec the roll runs on Espionage 3, not Persuasion 25.
  const purgeSpec = {
    friendlyName: 'Purge', contested: true, attack: 'Espionage', defend: null, baseDifficulty: 3
  };
  const withSpec = computeMissionOdds({ missionType: 'Purge', missionSpec: purgeSpec, target: {} }, councilor);
  assert.strictEqual(withSpec.offense, 3);
  assert.match(withSpec.basis, /^Espionage 3 /);
  // diff = 3 - 3 = 0, a coin flip. Reading Persuasion 25 gave diff +25 and 99.9%.
  assert.strictEqual(withSpec.chance, 0.5);
});

test('a contested spec naming no attack attribute yields unavailable odds', () => {
  const brokenSpec = {
    friendlyName: 'Mystery Op', contested: true, attack: null, defend: null, baseDifficulty: 0
  };
  const odds = computeMissionOdds(
    { missionType: 'Mystery Op', missionSpec: brokenSpec, target: {} },
    { id: 1, resolvedAttributes: { effective: { Persuasion: 25 } } }
  );

  assert.strictEqual(odds.chance, null);
  assert.match(odds.basis, /names no attack attribute/i);
});

test('a pairing with unavailable odds reports null hate but still charges the budget', () => {
  const councilor = {
    id: 1, name: 'Agent', locationType: 'earth', resolvedAttributes: { effective: { Persuasion: 20 } }
  };
  const candidate = {
    id: 'unknown-op',
    title: 'Unknown Op',
    missionType: 'Turn Councilor',
    successHate: 0,
    failureHate: 3,
    baseValue: 6.0
  };

  const pairing = buildCandidatePairing(candidate, councilor, {}, []);

  assert.strictEqual(pairing.odds.chance, null);
  assert.strictEqual(pairing.expectedHate, null, 'an outcome-weighted sum is not a fact without the odds');
  assert.strictEqual(pairing.hateForBudget, 3, 'pools are charged the worst branch, never Number(null) === 0');
  assert.ok(Number.isFinite(pairing.expectedValue), 'the pairing must still be rankable');
  assert.ok(pairing.why.some((w) => /odds not computable/i.test(w)), 'the assumption must name itself');
});

// ---------------------------------------------------------------------------
// 9. Assignment contract §4b.6 -- no councilor is silently dropped
// ---------------------------------------------------------------------------

test('every assignable councilor lands in assignments or unassigned (snapshot ID casing)', () => {
  // Snapshot councilors key on `ID`. Reading only `id` gave every councilor the
  // key `undefined`, so one assignment marked all six as assigned and the
  // unassigned pass then reported none of them.
  const attrs = (persuasion) => ({ effective: { Persuasion: persuasion } });
  const councilors = [
    { ID: 5796, displayName: 'Beth', status: 'Active', locationType: 'earth', resolvedAttributes: attrs(25) },
    { ID: 5797, displayName: 'Hemaraj', status: 'Active', locationType: 'earth', resolvedAttributes: attrs(19) },
    { ID: 5799, displayName: 'Mahangeet', status: 'Active', locationType: 'earth', resolvedAttributes: attrs(15) },
    { ID: 5801, displayName: 'Ngoc Thy', status: 'Active', locationType: 'earth', resolvedAttributes: attrs(12) },
    { ID: 7305, displayName: 'Brad', status: 'Active', locationType: 'earth', resolvedAttributes: attrs(21) },
    { ID: 43184, displayName: 'Balgovind', status: 'Active', locationType: 'earth', resolvedAttributes: attrs(8) }
  ];

  const candidates = [{
    id: 'control-japan',
    title: 'Control Nation in Japan',
    missionSpec: { friendlyName: 'Control Nation', contested: true, attack: 'Persuasion', baseDifficulty: 5 },
    baseValue: 6.0,
    cost: { resource: 'Influence', amount: 10 }
  }];

  const world = { resources: { influence: 100 }, alienHate: { assessedHate: 10 } };
  const plan = allocateCyclePlan(candidates, councilors, world);

  assert.strictEqual(plan.assignments.length, 1, 'one candidate can only occupy one councilor');
  assert.strictEqual(
    plan.assignments.length + plan.unassigned.length,
    councilors.length,
    'every own, non-detained councilor must appear in exactly one of the two lists'
  );

  const seen = new Set([
    ...plan.assignments.map((a) => String(a.councilorId)),
    ...plan.unassigned.map((u) => String(u.councilorId))
  ]);
  assert.strictEqual(seen.size, councilors.length, 'councilor ids must be distinct, never a shared undefined');
  for (const c of councilors) {
    assert.ok(seen.has(String(c.ID)), `${c.displayName} must be accounted for`);
  }
});

test('unassigned councilors carry a §4b.6 reason token and a free action', () => {
  const attrs = (persuasion) => ({ effective: { Persuasion: persuasion } });
  const councilors = [
    { ID: 1, displayName: 'Alice', status: 'Active', locationType: 'earth', resolvedAttributes: attrs(25) },
    { ID: 2, displayName: 'Bob', status: 'Active', locationType: 'earth', resolvedAttributes: attrs(10) },
    { ID: 3, displayName: 'Carol', status: 'Active', locationType: 'space', resolvedAttributes: attrs(10) }
  ];

  const candidates = [{
    id: 'earth-only-op',
    title: 'Earth Only Op',
    missionSpec: {
      friendlyName: 'Control Nation',
      contested: true,
      attack: 'Persuasion',
      baseDifficulty: 5,
      context: 'EarthOnly',
      conditions: ['CouncilorOnEarth']
    },
    baseValue: 6.0,
    cost: { resource: 'Influence', amount: 10 }
  }];

  const world = { resources: { influence: 100 }, alienHate: { assessedHate: 10 } };
  const plan = allocateCyclePlan(candidates, councilors, world);

  assert.strictEqual(plan.assignments.length + plan.unassigned.length, councilors.length);

  const allowed = new Set(['no-feasible-candidate', 'all-candidates-claimed', 'budget-exhausted']);
  for (const u of plan.unassigned) {
    assert.ok(allowed.has(u.reason), `reason "${u.reason}" is not one of the three §4b.6 tokens`);
    assert.ok(u.reasonDetail, 'a readable detail must accompany the token');
    assert.ok(
      ['Surveil Location', 'Protect Councilor', 'Go To Ground'].includes(u.suggestedFreeAction),
      'a free action costs no resource and no hate, so an idle slot is always fillable'
    );
  }

  // Carol is in space and the only candidate is Earth-only: no pairing exists.
  const carol = plan.unassigned.find((u) => u.name === 'Carol');
  assert.ok(carol, 'the space-bound councilor must be reported');
  assert.strictEqual(carol.reason, 'no-feasible-candidate');

  // Bob loses the single Earth candidate to Alice, who rolls better.
  const bob = plan.unassigned.find((u) => u.name === 'Bob');
  assert.ok(bob, 'the displaced councilor must be reported');
  assert.strictEqual(bob.reason, 'all-candidates-claimed');
});

test('budget exhaustion is reported as its own unassigned reason', () => {
  const attrs = (persuasion) => ({ effective: { Persuasion: persuasion } });
  const councilors = [
    { ID: 1, displayName: 'Alice', status: 'Active', locationType: 'earth', resolvedAttributes: attrs(25) },
    { ID: 2, displayName: 'Bob', status: 'Active', locationType: 'earth', resolvedAttributes: attrs(24) }
  ];

  const spec = { friendlyName: 'Control Nation', contested: true, attack: 'Persuasion', baseDifficulty: 5 };
  const candidates = [
    { id: 'op-a', title: 'Op A', missionSpec: spec, baseValue: 6.0, cost: { resource: 'Influence', amount: 30 } },
    { id: 'op-b', title: 'Op B', missionSpec: spec, baseValue: 5.5, cost: { resource: 'Influence', amount: 30 } }
  ];

  // Only one 30-Influence action fits inside a 40-Influence stockpile.
  const world = { resources: { influence: 40 }, alienHate: { assessedHate: 10 } };
  const plan = allocateCyclePlan(candidates, councilors, world);

  assert.strictEqual(plan.assignments.length, 1);
  assert.strictEqual(plan.assignments.length + plan.unassigned.length, councilors.length);
  assert.strictEqual(plan.unassigned[0].reason, 'budget-exhausted');
  assert.ok(plan.budgetDisplaced.length > 0, 'the pool that refused must be named');
  assert.strictEqual(plan.budgetDisplaced[0].pool, 'influence');
  assert.ok(plan.budgetDisplaced[0].shortfall > 0);
});

test('a detained councilor is reported as unavailable rather than dropped', () => {
  const attrs = { effective: { Persuasion: 25 } };
  const councilors = [
    { ID: 1, displayName: 'Alice', status: 'Active', locationType: 'earth', resolvedAttributes: attrs },
    { ID: 2, displayName: 'Dana', status: 'detained', locationType: 'earth', resolvedAttributes: attrs }
  ];

  const candidates = [{
    id: 'op-a',
    title: 'Op A',
    missionSpec: { friendlyName: 'Control Nation', contested: true, attack: 'Persuasion', baseDifficulty: 5 },
    baseValue: 6.0,
    cost: { resource: 'Influence', amount: 10 }
  }];

  const world = { resources: { influence: 100 }, alienHate: { assessedHate: 10 } };
  const plan = allocateCyclePlan(candidates, councilors, world);

  assert.strictEqual(plan.assignments.length, 1);
  assert.strictEqual(plan.assignments[0].councilorId, 1);
  assert.ok(!plan.unassigned.some((u) => u.name === 'Dana'), 'detained is not an idle mission slot');
  assert.strictEqual(plan.unavailable.length, 1);
  assert.strictEqual(plan.unavailable[0].name, 'Dana');
  assert.strictEqual(
    plan.assignments.length + plan.unassigned.length + plan.unavailable.length,
    councilors.length,
    'nobody vanishes from all three lists'
  );
});

test('councilors with no id at all still occupy distinct mission slots', () => {
  const councilors = [
    { displayName: 'Nameless One', status: 'Active', locationType: 'earth', resolvedAttributes: { effective: { Persuasion: 20 } } },
    { displayName: 'Nameless Two', status: 'Active', locationType: 'earth', resolvedAttributes: { effective: { Persuasion: 18 } } }
  ];

  const candidates = [{
    id: 'op-a',
    title: 'Op A',
    missionSpec: { friendlyName: 'Control Nation', contested: true, attack: 'Persuasion', baseDifficulty: 5 },
    baseValue: 6.0,
    cost: { resource: 'Influence', amount: 10 }
  }];

  const world = { resources: { influence: 100 }, alienHate: { assessedHate: 10 } };
  const plan = allocateCyclePlan(candidates, councilors, world);

  assert.strictEqual(plan.assignments.length + plan.unassigned.length, councilors.length);
});

test('the published player snapshot plans for all six councilors', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const snapshotPath = path.join(__dirname, '..', 'dist', 'data', 'snapshot-player-4712.json');

  // This snapshot predates `missionSpecs`, which makes it the degrade path:
  // odds must be unavailable AND every councilor must still be planned for.
  const data = JSON.parse(fs.readFileSync(snapshotPath, 'utf8')).data;
  const own = data.councilors.filter((c) => Number(c.factionId) === 4712);
  assert.strictEqual(own.length, 6, 'fixture expectation: the save carries six own councilors');
  assert.ok(!data.missionSpecs, 'fixture expectation: this snapshot carries no mission specs');

  const plan = briefingGenerator.generateMissionControlBriefing(data).engineDirectives.cyclePlan;

  assert.strictEqual(
    plan.assignments.length + plan.unassigned.length,
    own.length,
    'assignments + unassigned must equal the own councilor count'
  );

  for (const assignment of plan.assignments) {
    assert.strictEqual(assignment.odds.chance, null, 'no spec means no roll, on every card');
    assert.match(assignment.odds.basis, /unavailable/i);
  }
});
