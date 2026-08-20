/**
 * Two directive-engine loose ends.
 *
 * 1. `server/engine/budgets.js` carried placeholder resource caps (`?? 100`
 *    influence, `?? 50` operations, `?? 500` money, `?? 100` MC capacity,
 *    `?? 0` alien hate). On a real snapshot every lookup missed -- the save's
 *    faction block is capitalised -- so every pool silently fell back to its
 *    placeholder: 100 influence against a measured 2946. One caller bridged
 *    the capitalisation at its own call site, which left every other caller on
 *    the placeholders.
 *
 * 2. `world.habs` was never populated: briefingGenerator did not pass it and
 *    directiveEngine.buildWorld did not accept it, so `advise-hab:*`
 *    candidates could not be generated on a live save and a councilor already
 *    advising a hab could not have their commitment priced. Both paths were
 *    unit-tested only.
 */

const { test } = require('node:test');
const assert = require('node:assert');

const { BudgetPoolManager } = require('../server/engine/budgets');
const { allocateCyclePlan, computeOngoingMissionBenefit, getActiveMissionInfo } = require('../server/engine/assignment');
const { buildWorld, runEngine, generateCandidates } = require('../server/directiveEngine');
const { computeAdviseHabBonuses, evaluateAdviseValue } = require('../server/engine/adviseEconomics');
const { buildCandidatePairing } = require('../server/engine/pairing');
const briefingGenerator = require('../server/briefingGenerator');

// ---------------------------------------------------------------------------
// 1. Budget pools
// ---------------------------------------------------------------------------

test('the pool manager reads the capitalised resource keys the save actually uses', () => {
  const manager = new BudgetPoolManager({
    resources: { Influence: 2946, Operations: 1149, Money: 52398 },
    alienHate: { assessedHate: 10, mcFloor: 0 }
  });
  const summary = manager.getSummary();
  assert.strictEqual(summary.influence.cap, 2946, 'must not fall back to the 100 placeholder');
  assert.strictEqual(summary.operations.cap, 1149, 'must not fall back to the 50 placeholder');
  assert.strictEqual(summary.money.cap, 52398, 'must not fall back to the 500 placeholder');
  assert.ok(!summary.unmeasured.includes('influence'), 'the measured pools are not listed as unmeasured');
  assert.ok(!summary.unmeasured.includes('operations'));
  assert.ok(!summary.unmeasured.includes('money'));
});

test('the lowercase and stockpile-object shapes still work', () => {
  const lower = new BudgetPoolManager({ resources: { influence: 30, operations: 10, money: 5 } });
  assert.strictEqual(lower.getSummary().influence.cap, 30);

  const nested = new BudgetPoolManager({ resources: { influence: { stockpile: 77 } } });
  assert.strictEqual(nested.getSummary().influence.cap, 77);
});

test('an absent resource pool is unknown, not a fabricated cap', () => {
  const manager = new BudgetPoolManager({ resources: {} });
  const summary = manager.getSummary();

  assert.strictEqual(summary.influence.cap, null, '100 was a fabricated measurement');
  assert.strictEqual(summary.influence.capMeasured, false);
  assert.strictEqual(summary.operations.cap, null);
  assert.strictEqual(summary.money.cap, null);
  assert.strictEqual(summary.missionControl.cap, null);
  assert.strictEqual(summary.missionControl.used, null, '0 used MC would read as a measured zero');
  assert.deepStrictEqual(
    summary.unmeasured.sort(),
    ['alienHate', 'influence', 'missionControl', 'money', 'operations']
  );
});

test('an affordability check against an unmeasured pool reports unevaluated, not a silent pass', () => {
  const manager = new BudgetPoolManager({ resources: {} });
  const verdict = manager.canAfford({ resource: 'Influence', amount: 20 }, 0);
  assert.strictEqual(verdict.evaluated, false, 'a check that cannot be run must say so');
  assert.deepStrictEqual(verdict.unmeasuredPools, ['influence']);

  const measured = new BudgetPoolManager({ resources: { Influence: 100 } });
  const ran = measured.canAfford({ resource: 'Influence', amount: 20 }, 0);
  assert.strictEqual(ran.evaluated, true);
  assert.strictEqual(ran.affordable, true);
  assert.deepStrictEqual(ran.unmeasuredPools, []);
});

test('an unknown alien hate does not hand the cycle the maximum hate budget', () => {
  const unknown = new BudgetPoolManager({ resources: { Influence: 100 } }).getSummary();
  assert.strictEqual(unknown.alienHate.cap, null, 'hate 0 would grant the full headroom');
  assert.strictEqual(unknown.alienHate.currentHate, null);
  assert.strictEqual(unknown.alienHate.headroom, null);

  // Player mode redacts the assessed hate but the minimum-hate FLOOR is still
  // computed, so the pool has a measured input there.
  const playerMode = new BudgetPoolManager({
    resources: { Influence: 100 },
    alienHate: { actual: null },
    alienHateEconomics: { actualAlienHate: null, minimumAlienHate: 36.6 }
  }).getSummary();
  assert.strictEqual(playerMode.alienHate.currentHate, 36.6);
  assert.strictEqual(playerMode.alienHate.capMeasured, true);
  assert.ok(playerMode.alienHate.cap > 0 && playerMode.alienHate.cap <= 15);

  // Omniscient: the raw hate is higher than the floor and wins.
  const omniscient = new BudgetPoolManager({
    resources: { Influence: 100 },
    alienHate: { actual: 49.56 },
    alienHateEconomics: { actualAlienHate: 49.56, minimumAlienHate: 36.6 }
  }).getSummary();
  assert.strictEqual(omniscient.alienHate.currentHate, 49.56);
  assert.ok(omniscient.alienHate.cap < playerMode.alienHate.cap, 'higher hate leaves less headroom');
});

test('mission control used and capacity come from the hate economics when the world does not carry them', () => {
  const summary = new BudgetPoolManager({
    resources: { Influence: 100 },
    alienHateEconomics: { usedMissionControl: 122, missionControlCapacity: 163, minimumAlienHate: 36.6 }
  }).getSummary();
  assert.strictEqual(summary.missionControl.used, 122);
  assert.strictEqual(summary.missionControl.cap, 163);
  assert.strictEqual(summary.missionControl.capMeasured, true);
});

test('the allocator surfaces every pool whose cap the snapshot does not measure', () => {
  const plan = allocateCyclePlan([], [], { resources: { Influence: 2946, Operations: 1149, Money: 52398 } });
  assert.strictEqual(plan.budgets.influence.cap, 2946);
  assert.ok(Array.isArray(plan.budgetChecksUnevaluated), 'the plan reports unevaluated budget checks');
  assert.ok(plan.budgets.unmeasured.includes('alienHate'), 'the unmeasured hate pool is named, not hidden');
});

// ---------------------------------------------------------------------------
// 2. Hab Advise
// ---------------------------------------------------------------------------

const HAB_COUNCILOR = {
  ID: 5796,
  displayName: 'Beth Hofmann',
  factionId: '4712',
  attributes: { Administration: 24, Science: 8, Command: 1 },
  resolvedAttributes: { effective: { Administration: 24, Science: 8, Command: 1 } },
  locationType: 'space'
};

/** The Advise spec exactly as the snapshot ships it (verified 2026-08-20). */
const ADVISE_SPECS = Object.freeze({
  Advise: {
    friendlyName: 'Advise',
    successHate: 0, criticalHate: 0, failureHate: 0,
    costResource: 'Influence', costKind: 'Flat', costAmount: 10,
    contested: false, attack: null, defend: null, baseDifficulty: 0,
    targetKind: 'NationHab', conditions: ['TargetInRange', 'ScannableObjectWithMyControlPoints']
  }
});

test('buildWorld accepts habs so advise-hab candidates can be generated at all', () => {
  const world = buildWorld({ observerId: 4712, habs: [{ ID: 1, displayName: 'Base', factionId: 4712 }] });
  assert.ok(Array.isArray(world.habs), 'world.habs must exist');
  assert.strictEqual(world.habs.length, 1);

  const empty = buildWorld({ observerId: 4712 });
  assert.deepStrictEqual(empty.habs, [], 'an omitted hab list is empty, never undefined');
});

test('buildAdvisableHabs joins mining sites to owned habs and keeps unjoinable outputs null', () => {
  const habs = [
    { ID: 7197, displayName: 'Diogo Cao Base', factionId: 4712 },
    { ID: 36575, displayName: 'Erik the Red Station', factionId: 4712 },
    { ID: 999, displayName: 'Rival Base', factionId: 4713 }
  ];
  const habSites = [
    { ID: 1, habId: 7197, water: 1, volatiles: 2, metals: 3, nobleMetals: null, fissiles: 0 }
  ];

  const built = briefingGenerator.buildAdvisableHabs(habs, habSites, 4712);
  assert.strictEqual(built.length, 2, 'only owned habs are advisable');

  const joined = built.find(h => h.ID === 7197);
  assert.strictEqual(joined.water, 30, 'a daily rate becomes a monthly output');
  assert.strictEqual(joined.metals, 90);
  assert.strictEqual(joined.fissiles, 0, 'a measured zero rate stays zero');
  assert.strictEqual(joined.nobleMetals, null, 'an absent rate is not summed in as 0');
  assert.strictEqual(joined.research, null, 'per-hab research is not in the snapshot and is not invented');

  const station = built.find(h => h.ID === 36575);
  assert.strictEqual(station.water, null, 'a hab with no joined site has no measured output');
  assert.match(station.resourceOutputSource, /no hab site/);
});

test('advise-hab candidates are generated for habs with measured outputs, and unpriceable habs are dropped loudly', () => {
  const world = buildWorld({
    observerId: 4712,
    nations: [],
    councilors: [HAB_COUNCILOR],
    missionSpecs: ADVISE_SPECS,
    habs: [
      { ID: 7197, displayName: 'Diogo Cao Base', factionId: '4712', water: 30, volatiles: 60, metals: 90, nobleMetals: null, fissiles: 0, research: null },
      { ID: 36575, displayName: 'Erik the Red Station', factionId: '4712', water: null, volatiles: null, metals: null, nobleMetals: null, fissiles: null, research: null }
    ]
  });

  const dropped = [];
  const candidates = generateCandidates(world, dropped);
  const habCandidates = candidates.filter(c => String(c.id).startsWith('advise-hab:'));

  assert.strictEqual(habCandidates.length, 1, 'the measurable hab produces a candidate');
  assert.strictEqual(habCandidates[0].id, 'advise-hab:7197');
  assert.deepStrictEqual(habCandidates[0].value.measuredHabInputs, ['water', 'volatiles', 'metals', 'fissiles']);

  const unpriceable = dropped.filter(entry => entry.reason === 'unpriceable-advise-target');
  assert.strictEqual(unpriceable.length, 1, 'the unmeasurable hab is recorded, not silently absent');
  assert.match(unpriceable[0].detail, /Erik the Red Station/);
});

test('a hab Advise pairing quotes measured numbers and names what it could not read', () => {
  const world = buildWorld({
    observerId: 4712,
    councilors: [HAB_COUNCILOR],
    missionSpecs: ADVISE_SPECS,
    habs: [{ ID: 7197, displayName: 'Diogo Cao Base', factionId: '4712', water: 30, volatiles: 60, metals: 90, nobleMetals: null, fissiles: 0, research: null }]
  });
  const candidate = generateCandidates(world, []).find(c => c.id === 'advise-hab:7197');
  assert.ok(candidate, 'the hab candidate exists');
  const pairing = buildCandidatePairing(candidate, HAB_COUNCILOR, world, []);

  assert.ok(pairing, 'a measurable hab is priceable');
  assert.ok(Number.isFinite(pairing.perTurnValue) && pairing.perTurnValue > 0, 'the per-turn value is a real number');
  const why = pairing.why.join(' ');
  assert.ok(!/\bnull\b/.test(why), 'no raw null reaches the explanation text');
  assert.match(why, /no research reading in this snapshot/);
  assert.match(why, /Unmeasured for this hab: research, money, nobleMetals, marineCombat/);
  assert.match(why, /4 measured resource output\(s\)/, 'the count reflects only what was read');
});

test('an all-null hab is never scored off the 1.0 floor', () => {
  const bonuses = computeAdviseHabBonuses(HAB_COUNCILOR, { displayName: 'Erik the Red Station' });
  assert.strictEqual(bonuses.inputsMeasured, false);
  assert.strictEqual(bonuses.gainResearch, null);
  assert.strictEqual(bonuses.outputs.water, null);
  assert.strictEqual(bonuses.gainCombat, null);

  const evaluated = evaluateAdviseValue(bonuses, 'hab');
  assert.strictEqual(evaluated.score, null, 'Math.max(1.0, ...) produced a confident 1.0 from nothing');
  assert.strictEqual(evaluated.perTurnValue, null);
  assert.strictEqual(evaluated.measured, false);
  assert.match(evaluated.unmeasuredReason, /cannot be priced/);
});

test('a partially measured hab still scores on the part that was measured', () => {
  const bonuses = computeAdviseHabBonuses(HAB_COUNCILOR, {
    displayName: 'Diogo Cao Base', water: 30, volatiles: 60, metals: 90
  });
  assert.strictEqual(bonuses.inputsMeasured, true);
  assert.strictEqual(bonuses.outputs.water, 7.2);           // 30 * 24%
  assert.strictEqual(bonuses.outputs.money, null);
  assert.deepStrictEqual(bonuses.unmeasuredInputs.sort(), ['fissiles', 'marineCombat', 'money', 'nobleMetals', 'research']);

  const evaluated = evaluateAdviseValue(bonuses, 'hab');
  assert.strictEqual(evaluated.measured, true);
  assert.ok(evaluated.perTurnValue > 0);
});

test('a councilor advising a hab present in the world now has a priced commitment', () => {
  const advisor = {
    ...HAB_COUNCILOR,
    currentMission: { name: 'Advise', targetName: 'Diogo Cao Base', persistent: true }
  };
  const world = buildWorld({
    observerId: 4712,
    habs: [{ ID: 7197, displayName: 'Diogo Cao Base', factionId: '4712', water: 30, volatiles: 60, metals: 90 }]
  });
  const activeInfo = getActiveMissionInfo(advisor);
  if (!activeInfo.isPersistent) return;                     // fixture shape guard

  const benefit = computeOngoingMissionBenefit(advisor, activeInfo, world);
  assert.strictEqual(benefit.measured, true, 'the hab is in the world, so the commitment is priceable');
  assert.strictEqual(benefit.targetName, 'Diogo Cao Base');
  assert.ok(Number.isFinite(benefit.perTurnValue));
});

// ---------------------------------------------------------------------------
// 3. Capped explanatory lists carry their true totals
// ---------------------------------------------------------------------------

test('the briefing forwards the true totals beside the capped explanatory lists', () => {
  const snapshot = {
    metadata: { gameTimeString: '2026-08-20' },
    factions: [{ ID: '4712', displayName: 'The Initiative', isObserver: true, resources: { Influence: 2946 } }],
    nations: Array.from({ length: 60 }, (_, i) => ({
      ID: 1000 + i,
      displayName: `Nation ${i}`,
      GDP: 5.4e11,
      regionsCount: 0,
      population: 0,
      controlPoints: [{ id: i, factionId: null, isExecutive: false, controlPointType: 'Legislature' }]
    })),
    councilors: [{ ID: 101, displayName: 'Samantha Ryan', factionId: '4712', resolvedAttributes: { effective: { Persuasion: 22 } }, locationType: 'earth' }]
  };

  const engineDirectives = briefingGenerator.generateMissionControlBriefing(snapshot).engineDirectives;

  for (const [list, total, omitted] of [
    ['rejected', 'rejectedTotalCount', 'rejectedOmittedCount'],
    ['uncertain', 'uncertainTotalCount', 'uncertainOmittedCount'],
    ['futureOpportunities', 'futureOpportunitiesTotalCount', 'futureOpportunitiesOmittedCount']
  ]) {
    assert.ok(Array.isArray(engineDirectives[list]), `${list} is forwarded`);
    assert.strictEqual(typeof engineDirectives[total], 'number', `${total} must travel with ${list}`);
    assert.strictEqual(typeof engineDirectives[omitted], 'number', `${omitted} must travel with ${list}`);
    assert.strictEqual(
      engineDirectives[total] - engineDirectives[omitted],
      engineDirectives[list].length,
      `${list}: total minus omitted must equal the number of entries actually sent`
    );
    assert.ok(engineDirectives[total] >= engineDirectives[list].length, `${total} is the true total`);
  }

  // The counts block is built from the FULL lists, so it must agree.
  const counts = engineDirectives.decisionReasoning.counts;
  assert.strictEqual(counts.rejected, engineDirectives.rejectedTotalCount);
  assert.strictEqual(counts.uncertain, engineDirectives.uncertainTotalCount);
  assert.strictEqual(counts.future, engineDirectives.futureOpportunitiesTotalCount);
});

test('runEngine caps the explanatory lists but never misreports the total', () => {
  const world = buildWorld({
    observerId: 4712,
    nations: Array.from({ length: 60 }, (_, i) => ({
      ID: 2000 + i,
      displayName: `Unformed ${i}`,
      GDP: 0,
      regionsCount: 0,
      population: 0,
      controlPoints: [{ id: i, factionId: null, isExecutive: false, controlPointType: 'Legislature' }]
    })),
    councilors: [{ ID: 1, displayName: 'A', factionId: 4712, resolvedAttributes: { effective: { Persuasion: 20 } } }]
  });

  const result = runEngine(world);
  assert.ok(result.futureOpportunitiesTotalCount >= result.futureOpportunities.length);
  assert.strictEqual(
    result.futureOpportunitiesTotalCount - result.futureOpportunitiesOmittedCount,
    result.futureOpportunities.length
  );
  assert.ok(result.futureOpportunities.length <= 25, 'the transported list stays bounded');
});
