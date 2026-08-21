// `/api/intel/economic-value` -- phase 3 of the research advisor.
//
// The shape follows `tests/militaryValue.test.js`: a synthetic campaign state
// built over the REAL installed templates, so the turn-1 case exercises the
// same 275-effect index and the same 899-node tech tree the live save does.
//
// Three things here are load-bearing rather than routine:
//
//  1. THE TURN-1 CASE. An observer who mines nothing, flies nothing and has
//     completed nothing must report honest nulls -- never a fabricated zero and
//     never a crash. Section 0 of the spec exists for this and phases 1 and 2
//     both proved it the same way.
//  2. THE ABSENT-QUANTITY CASE. A mining bonus with no mining sites behind it
//     must be `unpriceable` with the reason stated, NOT `inert` and NOT 0.
//     Those three render very differently and mean different things, and the
//     silent zero is the defect this whole endpoint is built around.
//  3. THE PINS, each followed by a perturbation that proves it is not vacuous.
//
// Where a claim rests on the live save rather than on the installed templates
// it is stated as a dated measurement in the comment and the test verifies the
// MECHANISM instead of the campaign -- the live save cannot ship in a test, and
// asserting a number the test itself computes would be decoration.

const { test } = require('node:test');
const assert = require('node:assert');

const snapshotBuilder = require('../server/snapshotBuilder');
const snapshotIdentity = require('../server/snapshotIdentity');
const intelligenceFilter = require('../server/intelligenceFilter');
const templateLoader = require('../server/templateLoader');
const { buildEffectIndex } = require('../server/snapshot/templates');
const { makeSaveData } = require('./fixtures/syntheticSave');
const {
  INTEL_ENDPOINT_EXAMPLES,
  INTEL_ENDPOINT_INDEX,
  DETAIL_AWARE_RESOURCES,
  SUPPORTED_RESOURCES,
  buildResourceProjection
} = require('../shared/intel/registry.mjs');
const { AVAILABILITY_STATES } = require('../shared/researchAvailability.mjs');
const {
  CONTEXT_QUANTITY_MAP,
  ECONOMIC_FORMULAE,
  INERT_CODES,
  MINED_RESOURCES,
  OPERATION_SEMANTICS,
  PRICED_CONTEXTS,
  PRICING_STATES,
  UNPRICEABLE_CODES,
  buildEffectBaseline,
  buildLiveQuantities,
  priceContextEffect,
  priceResourceGrant,
  summarizeValue,
  valuePerResearchPoint
} = require('../shared/economicValue.mjs');
const { MINING_RESOURCES } = require('../shared/intel/common.mjs');

const OBSERVER = 4712;

function filtered(save, mode) {
  const raw = snapshotBuilder.buildRawSnapshot(save);
  const identity = snapshotIdentity.createSnapshotIdentity(
    { fullPath: 'synthetic.gz', lastModified: new Date('2025-01-01T00:00:00Z'), saveHash: 'x' },
    'initiative'
  );
  return intelligenceFilter.applyFilter({ ...raw, ...identity }, mode, OBSERVER);
}

const TURN_ONE_AVAILABLE = ['Project_Solid-FuelSpaceRockets', 'Project_Liquid-FuelRockets'];

/**
 * Turn one: nothing mined, nothing flown, nothing completed, no queue, no
 * council, two chemical rockets offered.
 *
 * Everything the valuation reads is stripped rather than merely emptied, so
 * the difference between "measured and zero" and "not measured" is actually
 * exercised rather than assumed.
 */
function turnOneSnapshot(mode = 'player') {
  const snapshot = filtered(makeSaveData({ ships: 0 }), mode);
  snapshot.fleets = [];
  snapshot.habSites = [];
  snapshot.habModules = [];
  snapshot.shipyardQueues = [];
  snapshot.councilors = [];
  snapshot.nations = snapshot.nations.map(nation => ({ ...nation, controlPoints: [] }));
  for (const faction of snapshot.factions) {
    faction.completedProjects = [];
    faction.currentProjects = [];
    faction.availableProjectNames = faction.ID === OBSERVER ? [...TURN_ONE_AVAILABLE] : [];
    faction.availableProjectsCount = faction.ID === OBSERVER ? TURN_ONE_AVAILABLE.length : 0;
    faction.totalResearch = faction.ID === OBSERVER ? 12 : 0;
    faction.researchBreakdown = null;
    faction.missionControlUsage = null;
    faction.missionControlCapacity = null;
    faction.financials = null;
    faction.monthlyIncome = null;
  }
  if (snapshot.techTree) {
    snapshot.techTree.finishedTechsNames = [];
    snapshot.techTree.globalActive = [];
    snapshot.techTree.factionStatus = Object.fromEntries(
      Object.keys(snapshot.techTree.factionStatus || {}).map(id => [id, {
        completedProjects: [],
        availableProjectNames: Number(id) === OBSERVER ? [...TURN_ONE_AVAILABLE] : [],
        currentProjects: []
      }])
    );
  }
  if (snapshot.globalResearch) snapshot.globalResearch.finishedTechsNames = [];
  return snapshot;
}

/**
 * An observer with a real economy: mining sites, a build queue, a council, a
 * fleet that consumes mission control, and hab cores that cost some.
 *
 * Every hab-module template name here is a real one from the installed
 * templates, so the join to `componentStats.hab_module` is the join production
 * performs rather than a fixture-shaped stand-in.
 */
function economySnapshot(mode = 'player', overrides = {}) {
  const snapshot = turnOneSnapshot(mode);
  snapshot.habSites = [
    { ID: 1, factionId: OBSERVER, resourceRateUnit: 'per day', water: 2, volatiles: 1, metals: 4, nobleMetals: 0.5, fissiles: 0.1 },
    { ID: 2, factionId: OBSERVER, resourceRateUnit: 'per day', water: 1, volatiles: 2, metals: 1, nobleMetals: 0.25, fissiles: 0.05 },
    { ID: 3, factionId: 4713, resourceRateUnit: 'per day', water: 99, volatiles: 99, metals: 99, nobleMetals: 99, fissiles: 99 }
  ];
  snapshot.habModules = [
    { id: 10, factionId: OBSERVER, templateName: 'OutpostCore', researchIncomeMonth: 0 },
    { id: 11, factionId: OBSERVER, templateName: 'OrbitalCore', researchIncomeMonth: 0 },
    { id: 12, factionId: OBSERVER, templateName: 'XenologyLab', researchIncomeMonth: 5 },
    { id: 13, factionId: 4713, templateName: 'ColonyCore', researchIncomeMonth: 99 }
  ];
  snapshot.fleets = [{
    ID: 60, factionId: OBSERVER, ships: [
      { id: 61, missionControlConsumption: 4 },
      { id: 62, missionControlConsumption: 7 }
    ]
  }];
  snapshot.shipyardQueues = [
    { id: 'q1', factionId: OBSERVER, daysToCompletion: 100 },
    { id: 'q2', factionId: OBSERVER, daysToCompletion: 50 },
    { id: 'q3', factionId: 4713, daysToCompletion: 999 }
  ];
  snapshot.councilors = [
    { ID: 200, factionId: OBSERVER }, { ID: 201, factionId: OBSERVER },
    { ID: 202, factionId: OBSERVER }, { ID: 203, factionId: 4713 }
  ];
  snapshot.nations = snapshot.nations.map((nation, index) => (index === 0
    ? { ...nation, GDP: 20e12, controlPoints: [{ id: 1, factionId: OBSERVER }] }
    : { ...nation, GDP: 15e12, controlPoints: [{ id: 2, factionId: 4713 }] }));
  for (const faction of snapshot.factions) {
    if (faction.ID !== OBSERVER) continue;
    // 11 from the ships, 5 from the two cores (OutpostCore -2, OrbitalCore -3).
    faction.missionControlUsage = 16;
    faction.missionControlCapacity = 40;
    faction.researchBreakdown = { earthControlPointShare: 400, habModules: 5 };
    faction.totalResearch = 500;
    faction.financials = { projectedMonthlyIncome: { Influence: 100, Money: 50, Antimatter: 0 } };
    Object.assign(faction, overrides.observerFaction || {});
  }
  return snapshot;
}

const project = (snapshot, options = {}) => buildResourceProjection(snapshot, 'economic-value', {
  mode: 'player',
  ...options
});

// ---------------------------------------------------------------------------
// WIRING
// ---------------------------------------------------------------------------

test('the endpoint is registered in every derived view', () => {
  assert.ok(SUPPORTED_RESOURCES.has('economic-value'));
  assert.equal(INTEL_ENDPOINT_INDEX.economicValue, '/api/intel/economic-value');
  assert.ok(INTEL_ENDPOINT_EXAMPLES.economicValue, 'the discovery index must carry an example query');
  assert.ok(DETAIL_AWARE_RESOURCES.has('economic-value'),
    'the full listing carries a per-effect row for every candidate; it must be opt-in');
});

test('the mined-resource table matches the one the mining endpoints use', () => {
  // Two tables naming the same five resources is how one of them silently
  // stops covering fissiles. They are asserted equal rather than assumed.
  assert.deepEqual(
    MINED_RESOURCES.map(entry => [entry.siteKey, entry.saveKey]),
    MINING_RESOURCES.map(entry => [entry.key, entry.saveKey])
  );
});

// ---------------------------------------------------------------------------
// THE BAKE
// ---------------------------------------------------------------------------

test('the effect index carries only what a tech or project can reach', () => {
  templateLoader.load();
  const index = buildEffectIndex();

  // Independently recomputed from the templates, not read back out of the
  // index it is checking.
  const reachable = new Set();
  const seen = new Set();
  for (const map of [templateLoader.templates.techs, templateLoader.templates.projects]) {
    for (const template of map.values()) {
      if (!template?.dataName || seen.has(template.dataName)) continue;
      seen.add(template.dataName);
      for (const id of (Array.isArray(template.effects) ? template.effects : [])) reachable.add(id);
    }
  }
  assert.equal(Object.keys(index.effects).length, reachable.size);
  assert.ok(reachable.size < templateLoader.templates.effects.size,
    'the whole effect file must NOT be baked; the point is that most of it is unreachable from research');
  assert.equal(index.census.effectTemplatesTotal, templateLoader.templates.effects.size);
  assert.equal(index.census.reachableFromResearch, reachable.size);
  assert.equal(index.unresolved.length, 0,
    'a referenced effect with no template is a hole in the data and must be reported, not dropped');

  // Every indexed effect keeps the four fields the tech tree omits.
  const withContexts = Object.values(index.effects).filter(row => Array.isArray(row.contexts));
  assert.ok(withContexts.length > 100, `expected the context-scoped majority, got ${withContexts.length}`);
  assert.ok(Object.values(index.effects).some(row => row.instantEffect));
  assert.ok(Object.values(index.effects).some(row => row.stackable === true));
  assert.ok(Object.values(index.effects).some(row => row.strValue));

  // Absence stays absence: no zero stands in for a missing value.
  for (const [id, row] of Object.entries(index.effects)) {
    if ('value' in row) assert.equal(typeof row.value, 'number', `${id} value must be a number when present`);
    assert.notEqual(row.stackable, false, `${id}: a false flag must be dropped, not emitted`);
  }
});

test('the baked effect index stays inside its stated size budget', () => {
  templateLoader.load();
  const bytes = Buffer.byteLength(JSON.stringify(buildEffectIndex()), 'utf8');
  // Measured 2026-08-21 at 51.1 KB raw / 6.8 KB gzipped, 2.1% of the 2,480 KB
  // published player row -- under a third of phase 2's componentStats
  // (166.6 KB) and of phase 1's driveStats (135.4 KB), because only the four
  // missing fields are carried and only for the reachable 275 of 719 effects.
  assert.ok(bytes < 80 * 1024, `effectIndex is ${(bytes / 1024).toFixed(1)} KB, over the 80 KB budget`);
  assert.ok(bytes > 20 * 1024, `effectIndex is only ${(bytes / 1024).toFixed(1)} KB; something probably stopped loading`);
});

test('resource and org grants are baked, and nothing else is', () => {
  templateLoader.load();
  const index = buildEffectIndex();
  const projects = new Map();
  for (const template of templateLoader.templates.projects.values()) {
    if (template?.dataName) projects.set(template.dataName, template);
  }
  for (const [id, row] of Object.entries(index.grants)) {
    const template = projects.get(id);
    assert.ok(template, `${id} must be a real project`);
    if (row.org) assert.equal(row.org, template.orgGranted);
    for (const [resource, value] of (row.resources || [])) {
      const match = template.resourcesGranted.find(entry => entry.resource === resource && entry.value === value);
      assert.ok(match, `${id} grant of ${value} ${resource} must come from the template`);
    }
  }
  // A project that grants nothing must have no row at all -- an empty row and
  // an absent one would be indistinguishable downstream.
  const granting = [...projects.values()].filter(template =>
    (Array.isArray(template.resourcesGranted) && template.resourcesGranted.length > 0) || template.orgGranted);
  assert.equal(Object.keys(index.grants).length, granting.length);
});

// ---------------------------------------------------------------------------
// PIN 1 -- MISSION CONTROL USAGE
// ---------------------------------------------------------------------------
//
// MEASURED 2026-08-21 against the live save: summing each ship's
// `missionControlConsumption` and the NEGATIVE `missionControl` of every hab
// core module reproduces the save's own `missionControlUsage` exactly for 7 of
// the 8 factions --
//
//   Resistance 65=65, Humanity First 147=147, Initiative 147=147,
//   Protectorate 143=143, Academy 79=79, Project Exodus 93=93, Aliens 412=412,
//   Servants 296 vs 256 (residual +40, unexplained).
//
// The live save cannot ship in a test, so what is asserted here is the
// mechanism: that the decomposition is computed, that it is COMPARED against
// the save's own figure, and that a disagreement is surfaced with the residual
// visible rather than absorbed. The perturbation below proves the comparison
// can fail.

test('mission control usage is decomposed and checked against the save\'s own figure', () => {
  const snapshot = economySnapshot();
  const quantities = buildLiveQuantities(snapshot, OBSERVER);
  const headroom = quantities.quantities.missionControlHeadroom;

  assert.equal(quantities.quantities.shipMissionControlCost.value, 11, 'ships: 4 + 7');
  assert.equal(quantities.quantities.habMissionControlCost.value, 5,
    'hab cores: OutpostCore -2 and OrbitalCore -3, from the installed templates');
  assert.equal(headroom.modelledUsage, 16);
  assert.equal(headroom.reportedUsage, 16);
  assert.equal(headroom.residual, 0);
  assert.equal(headroom.modelReproducesUsage, true);
  assert.equal(headroom.value, 24, 'capacity 40 minus usage 16');

  // The hab-core costs are read from the real templates, not from the fixture.
  templateLoader.load();
  const stats = snapshot.componentStats.hab_module;
  assert.equal(stats.OutpostCore.missionControl, -2);
  assert.equal(stats.OrbitalCore.missionControl, -3);

  // Only NEGATIVE entries are a cost. A module that GRANTS capacity must not
  // net against one that consumes it, or neither figure means anything.
  const granting = Object.values(stats).filter(entry => (entry.missionControl ?? 0) > 0);
  assert.ok(granting.length > 0, 'the templates must contain capacity-granting modules for this to be a real risk');
});

test('the mission-control pin is not vacuous: a wrong cost shows up as a residual', () => {
  const snapshot = economySnapshot();
  // Perturb one hab core by one point of mission control.
  snapshot.componentStats = {
    ...snapshot.componentStats,
    hab_module: {
      ...snapshot.componentStats.hab_module,
      OutpostCore: { ...snapshot.componentStats.hab_module.OutpostCore, missionControl: -3 }
    }
  };
  const headroom = buildLiveQuantities(snapshot, OBSERVER).quantities.missionControlHeadroom;
  assert.equal(headroom.modelledUsage, 17);
  assert.equal(headroom.residual, -1);
  assert.equal(headroom.modelReproducesUsage, false,
    'a model that no longer reproduces the save figure must say so, not round it away');
});

// ---------------------------------------------------------------------------
// PIN 2 -- THE ACTIVE-EFFECT BASELINE
// ---------------------------------------------------------------------------
//
// MEASURED 2026-08-21 against the live save: the baseline reconstructed here
// from the observer's 149 completed projects and 99 finished global techs
// yields exactly the 72 distinct effects the snapshot's own
// `capabilities.activeEffects` lists -- no additions, no omissions. The
// reconstruction exists in spite of that agreement because the snapshot's list
// is a SET and therefore loses multiplicity, and a stackable effect held three
// times is not the state of holding it once.

test('the reconstructed baseline is cross-checked against the snapshot\'s own list', () => {
  const snapshot = economySnapshot();
  const project = 'Project_NationalResearchOversight';
  for (const faction of snapshot.factions) {
    if (faction.ID === OBSERVER) faction.completedProjects = [project];
  }
  snapshot.techTree.factionStatus[OBSERVER] = { completedProjects: [project], availableProjectNames: [], currentProjects: [] };
  snapshot.capabilities = { activeEffects: ['Effect_CPResearch10'] };

  const baseline = buildEffectBaseline(snapshot, OBSERVER);
  assert.equal(baseline.available, true);
  assert.equal(baseline.crossCheck.agrees, true);
  assert.deepEqual(baseline.crossCheck.missingFromReconstruction, []);
  assert.deepEqual(baseline.crossCheck.absentFromSnapshotList, []);
  assert.equal(baseline.contexts.ControlPointResearch.multiplicativeProduct, 1.1);

  // A disagreement is REPORTED, never quietly resolved in either direction.
  snapshot.capabilities = { activeEffects: ['Effect_CPResearch10', 'Effect_SomethingElse'] };
  const disagreeing = buildEffectBaseline(snapshot, OBSERVER);
  assert.equal(disagreeing.crossCheck.agrees, false);
  assert.deepEqual(disagreeing.crossCheck.missingFromReconstruction, ['Effect_SomethingElse']);
});

test('stackable effects accumulate per occurrence; non-stackable ones do not', () => {
  const snapshot = economySnapshot();
  // MissiontoMars and MissiontotheAsteroids both grant Effect_SpaceMineFreebies6
  // (stackable), so holding both is 12 free mines, not 6.
  snapshot.techTree.finishedTechsNames = ['MissiontoMars', 'MissiontotheAsteroids'];
  const baseline = buildEffectBaseline(snapshot, OBSERVER);
  const mines = baseline.contexts.MCFreeSpaceMineNetwork;
  assert.equal(mines.additiveTotal, 12, 'two stackable +6 grants are +12, not +6');
  assert.equal(mines.occurrences, 2);
  assert.equal(baseline.heldEffectCounts.Effect_SpaceMineFreebies6, 2);
});

// ---------------------------------------------------------------------------
// PRICING
// ---------------------------------------------------------------------------

test('a multiplicative bonus is priced against the observer\'s measured quantity', () => {
  const snapshot = economySnapshot();
  const quantities = buildLiveQuantities(snapshot, OBSERVER);
  const baseline = buildEffectBaseline(snapshot, OBSERVER);

  // Sites 1 and 2 mine 5 metals/day between them, so 150/month.
  assert.equal(quantities.quantities.miningOutput_metals.value, 150);

  const row = priceContextEffect({
    effectId: 'Effect_MiningMetalsBonus',
    effect: { contexts: ['MiningMetalsBonus'], operation: 'Multiplicative', value: 1.15, stackable: true },
    context: 'MiningMetalsBonus',
    baseline,
    quantities
  });
  assert.equal(row.state, PRICING_STATES.priced);
  assert.equal(row.delta, 22.5, '150 x 0.15');
  assert.equal(row.deltaUnit, 'tonnes/month');
  assert.equal(row.formulaKey, 'multiplicativeDelta');
  assert.equal(row.quantity.value, 150);
  assert.equal(row.activeMultiplier, 1, 'nothing is active on this context yet');
});

test('a stackable multiplier already held compounds; the alternative reading is visible', () => {
  const snapshot = economySnapshot();
  snapshot.techTree.finishedTechsNames = [];
  for (const faction of snapshot.factions) {
    if (faction.ID === OBSERVER) faction.completedProjects = ['Project_ThermalMiningTechniques'];
  }
  snapshot.techTree.factionStatus[OBSERVER] = {
    completedProjects: ['Project_ThermalMiningTechniques'], availableProjectNames: [], currentProjects: []
  };
  const quantities = buildLiveQuantities(snapshot, OBSERVER);
  const baseline = buildEffectBaseline(snapshot, OBSERVER);
  assert.equal(baseline.contexts.MiningWaterBonus.multiplicativeProduct, 1.15);

  const row = priceContextEffect({
    effectId: 'Effect_MiningWaterBonus',
    effect: { contexts: ['MiningWaterBonus'], operation: 'Multiplicative', value: 1.15, stackable: true },
    context: 'MiningWaterBonus',
    baseline,
    quantities
  });
  // 3 water/day = 90/month, and a second +15% on the CURRENT figure is 13.5.
  assert.equal(row.state, PRICING_STATES.priced);
  assert.equal(row.delta, 13.5);
  assert.equal(row.activeMultiplier, 1.15,
    'the multiplier already active must travel with the row so the pre-modifier reading is visible');
  assert.equal(row.alreadyHeld, true);
});

test('IncreaseToValue below the current level is inert, not a fabricated gain', () => {
  const snapshot = economySnapshot();
  const quantities = buildLiveQuantities(snapshot, OBSERVER);
  const baseline = buildEffectBaseline(snapshot, OBSERVER);
  baseline.contexts.ControlPointResearch = {
    context: 'ControlPointResearch', additiveTotal: 0, multiplicativeProduct: 1,
    raisedToLevel: 0.3, loweredToLevel: null, fixedValues: [], contributingEffects: [], occurrences: 1
  };
  const row = priceContextEffect({
    effectId: 'Effect_Weaker',
    effect: { contexts: ['ControlPointResearch'], operation: 'IncreaseToValue', value: 0.1 },
    context: 'ControlPointResearch',
    baseline,
    quantities
  });
  assert.equal(row.state, PRICING_STATES.inert);
  assert.equal(row.delta, 0);
  assert.equal(row.inertCode, 'already-at-or-above-value');
  assert.ok(INERT_CODES[row.inertCode], 'every inert code must be expanded in the code table');
});

test('a non-stackable effect already held changes nothing', () => {
  const snapshot = economySnapshot();
  const quantities = buildLiveQuantities(snapshot, OBSERVER);
  const baseline = buildEffectBaseline(snapshot, OBSERVER);
  baseline.heldEffectCounts.Effect_Whatever = 1;
  const row = priceContextEffect({
    effectId: 'Effect_Whatever',
    effect: { contexts: ['MiningMetalsBonus'], operation: 'Multiplicative', value: 1.5, stackable: false },
    context: 'MiningMetalsBonus',
    baseline,
    quantities
  });
  assert.equal(row.state, PRICING_STATES.inert);
  assert.equal(row.inertCode, 'already-held-and-not-stackable');
});

test('a level move on a rate context reports the movement, not an invented number', () => {
  // No shipped effect exercises this combination -- every effect on every
  // priced context is Additive or Multiplicative -- but the branch must refuse
  // to multiply a monthly rate by a level difference rather than produce a
  // plausible-looking figure with no unit behind it.
  const snapshot = economySnapshot();
  const row = priceContextEffect({
    effectId: 'Effect_HypotheticalLevelRaise',
    effect: { contexts: ['ControlPointResearch'], operation: 'IncreaseToValue', value: 0.3 },
    context: 'ControlPointResearch',
    baseline: buildEffectBaseline(snapshot, OBSERVER),
    quantities: buildLiveQuantities(snapshot, OBSERVER)
  });
  assert.equal(row.state, PRICING_STATES.unpriceable);
  assert.equal(row.delta, null, 'a rate times a level difference is not a quantity');
  assert.equal(row.unpriceableCode, 'level-move-on-a-rate-context');
  assert.ok(UNPRICEABLE_CODES[row.unpriceableCode]);
  assert.equal(row.levelChange.to, 0.3, 'the movement itself is still reported');
  assert.equal(row.quantity.value, 400, 'and the quantity it could not be applied to is named');
});

test('a SetToFixedValue below the current level is reported as a downgrade, sign intact', () => {
  const snapshot = economySnapshot();
  const quantities = buildLiveQuantities(snapshot, OBSERVER);
  const baseline = buildEffectBaseline(snapshot, OBSERVER);
  baseline.contexts.SomeSwitch = {
    context: 'SomeSwitch', additiveTotal: 0, multiplicativeProduct: 1, raisedToLevel: null,
    loweredToLevel: null, fixedValues: [5], contributingEffects: [], occurrences: 1
  };
  const row = priceContextEffect({
    effectId: 'Effect_SetsLower',
    effect: { contexts: ['SomeSwitch'], operation: 'SetToFixedValue', value: 2 },
    context: 'SomeSwitch',
    baseline,
    quantities
  });
  assert.equal(row.levelChange.delta, -3, 'a downgrade keeps its sign');
  assert.equal(row.levelChange.isDowngrade, true);
});

test('free mines are worth nothing until the allowance binds, and say why', () => {
  const snapshot = economySnapshot();
  snapshot.techTree.finishedTechsNames = ['MissiontotheMoon']; // +3 free mines
  const quantities = buildLiveQuantities(snapshot, OBSERVER);
  const baseline = buildEffectBaseline(snapshot, OBSERVER);
  assert.equal(quantities.quantities.mineCount.value, 2, 'the fixture gives the observer two mines');

  const notBinding = priceContextEffect({
    effectId: 'Effect_SpaceMineFreebies3',
    effect: { contexts: ['MCFreeSpaceMineNetwork'], operation: 'Additive', value: 3, stackable: true },
    context: 'MCFreeSpaceMineNetwork',
    baseline,
    quantities
  });
  assert.equal(notBinding.state, PRICING_STATES.inert);
  assert.equal(notBinding.delta, 0);
  assert.equal(notBinding.inertCode, 'allowance-not-binding');
  assert.equal(notBinding.freeMineAllowance, 3);
  assert.equal(notBinding.mineCount, 2);

  // Add mines until the allowance binds and the same effect becomes worth
  // real mission control. Same effect, same code, different campaign state --
  // which is the whole point of pricing against live quantities.
  snapshot.habSites = Array.from({ length: 7 }, (_, index) => ({
    ID: index, factionId: OBSERVER, resourceRateUnit: 'per day', water: 1, volatiles: 0, metals: 0, nobleMetals: 0, fissiles: 0
  }));
  const binding = priceContextEffect({
    effectId: 'Effect_SpaceMineFreebies3',
    effect: { contexts: ['MCFreeSpaceMineNetwork'], operation: 'Additive', value: 3, stackable: true },
    context: 'MCFreeSpaceMineNetwork',
    baseline,
    quantities: buildLiveQuantities(snapshot, OBSERVER)
  });
  assert.equal(binding.state, PRICING_STATES.priced);
  assert.equal(binding.delta, 3, '7 mines against a 3-mine allowance is 4 paying; +3 free saves 3');
  assert.equal(binding.deltaUnit, 'mission control saved');
});

test('a construction-time reduction keeps its sign and is flagged as an improvement', () => {
  const snapshot = economySnapshot();
  const quantities = buildLiveQuantities(snapshot, OBSERVER);
  assert.equal(quantities.quantities.queuedShipBuildDays.value, 150, '100 + 50 queued days');
  const row = priceContextEffect({
    effectId: 'Effect_ShipConstructionTimeReduction',
    effect: { contexts: ['ShipConstructionTime'], operation: 'Multiplicative', value: 0.8, stackable: true },
    context: 'ShipConstructionTime',
    baseline: buildEffectBaseline(snapshot, OBSERVER),
    quantities
  });
  assert.equal(row.state, PRICING_STATES.priced);
  assert.equal(row.delta, -30, '150 x -0.2 days');
  assert.equal(row.direction, 'lower');
  assert.equal(row.improvesQuantity, true, 'fewer days is better and the row must say so');
});

test('an empty build queue is a measured zero, not an unmeasured one', () => {
  const snapshot = economySnapshot();
  snapshot.shipyardQueues = [];
  const quantities = buildLiveQuantities(snapshot, OBSERVER);
  const queue = quantities.quantities.queuedShipBuildDays;
  assert.equal(queue.value, 0);
  assert.equal(queue.measured, true, 'nothing queued IS a measurement');
  assert.equal(queue.emptyQueue, true);

  const row = priceContextEffect({
    effectId: 'Effect_ShipConstructionTimeReduction',
    effect: { contexts: ['ShipConstructionTime'], operation: 'Multiplicative', value: 0.8, stackable: true },
    context: 'ShipConstructionTime',
    baseline: buildEffectBaseline(snapshot, OBSERVER),
    quantities
  });
  assert.equal(row.state, PRICING_STATES.inert,
    'measured-and-zero is inert, which is a different answer from unmeasured');
  assert.equal(row.inertCode, 'quantity-is-zero');
  assert.equal(row.unpriceableCode, null);
});

// ---------------------------------------------------------------------------
// THE ABSENT QUANTITY -- the defect this endpoint exists to prevent
// ---------------------------------------------------------------------------

test('an absent quantity yields null and a stated reason, never zero', () => {
  const snapshot = economySnapshot();
  snapshot.habSites = []; // no mining sites at all: the quantity is not measured
  const quantities = buildLiveQuantities(snapshot, OBSERVER);
  const measured = quantities.quantities.miningOutput_metals;
  assert.equal(measured.value, null, 'absent stays null');
  assert.equal(measured.measured, false);
  assert.match(measured.reason, /no mining sites/);

  const row = priceContextEffect({
    effectId: 'Effect_MiningMetalsBonus',
    effect: { contexts: ['MiningMetalsBonus'], operation: 'Multiplicative', value: 1.15, stackable: true },
    context: 'MiningMetalsBonus',
    baseline: buildEffectBaseline(snapshot, OBSERVER),
    quantities
  });
  assert.equal(row.state, PRICING_STATES.unpriceable);
  assert.equal(row.delta, null, 'an unmeasured quantity must NOT price as zero');
  assert.notEqual(row.state, PRICING_STATES.inert, 'unmeasured is not the same as measured-and-worthless');
  assert.equal(row.unpriceableCode, 'quantity-unmeasured');
  assert.ok(UNPRICEABLE_CODES[row.unpriceableCode]);
  assert.equal(row.quantity.measured, false, 'the unmeasured quantity travels with the row so the gap is auditable');
});

test('a context with no mapping is named, not silently dropped or scored', () => {
  const snapshot = economySnapshot();
  const row = priceContextEffect({
    effectId: 'Effect_Apparatchiks',
    effect: { contexts: ['Mission_Purge_Att'], operation: 'Additive', value: 2, stackable: true },
    context: 'Mission_Purge_Att',
    baseline: buildEffectBaseline(snapshot, OBSERVER),
    quantities: buildLiveQuantities(snapshot, OBSERVER)
  });
  assert.equal(row.state, PRICING_STATES.unpriceable);
  assert.equal(row.delta, null);
  assert.equal(row.unpriceableCode, 'no-quantity-mapping');
  assert.equal(row.context, 'Mission_Purge_Att', 'the context must be on the row so a reader can check it');
});

test('a grant against zero income is unpriceable, and says which kind of zero', () => {
  const zeroIncome = priceResourceGrant({ resource: 'Antimatter', amount: 0.005, monthlyIncome: 0 });
  assert.equal(zeroIncome.monthsOfIncome, null, 'dividing by zero income must not produce a number');
  assert.equal(zeroIncome.unpriceableCode, 'grant-income-zero');
  assert.equal(zeroIncome.amount, 0.005, 'the absolute amount survives');

  const absentIncome = priceResourceGrant({ resource: 'Exotics', amount: 40, monthlyIncome: null });
  assert.equal(absentIncome.unpriceableCode, 'grant-income-unmeasured');

  const real = priceResourceGrant({ resource: 'Influence', amount: 200, monthlyIncome: 100 });
  assert.equal(real.state, PRICING_STATES.priced);
  assert.equal(real.monthsOfIncome, 2);
});

test('value per research point is null on an unmeasured cost, never Infinity', () => {
  const summary = summarizeValue([
    { state: PRICING_STATES.priced, delta: 100, deltaUnit: 'research/month' },
    { state: PRICING_STATES.priced, delta: 50, deltaUnit: 'tonnes/month' }
  ]);
  assert.deepEqual(summary.byUnit, [
    { unit: 'research/month', total: 100 },
    { unit: 'tonnes/month', total: 50 }
  ]);

  const priced = valuePerResearchPoint(summary, 1000);
  assert.equal(priced.available, true);
  assert.equal(priced.byUnit.find(row => row.unit === 'research/month').perResearchPoint, 0.1);

  for (const cost of [null, 0, undefined, '']) {
    const ratio = valuePerResearchPoint(summary, cost);
    assert.equal(ratio.available, false, `cost ${JSON.stringify(cost)} must not produce a ratio`);
    assert.ok(ratio.reason);
    assert.deepEqual(ratio.byUnit, []);
  }
});

test('units are never blended into one number', () => {
  const summary = summarizeValue([
    { state: PRICING_STATES.priced, delta: 100, deltaUnit: 'research/month' },
    { state: PRICING_STATES.priced, delta: 5e11, deltaUnit: 'dollars/year' }
  ]);
  assert.equal(summary.byUnit.length, 2,
    'research per month and dollars per year have no exchange rate and must stay apart');
  assert.equal(summary.pricedCount, 2);
});

// ---------------------------------------------------------------------------
// TURN ONE
// ---------------------------------------------------------------------------

for (const mode of ['player', 'omniscient']) {
  test(`turn one produces honest nulls rather than zeros (${mode})`, () => {
    const snapshot = turnOneSnapshot(mode);
    const result = project(snapshot, { mode });

    assert.equal(result.resource, 'economic-value');
    assert.equal(result.effectIndex.available, true, 'the catalogue is template data and exists on turn one');
    assert.equal(result.baseline.available, true, 'having completed nothing is a STATE, not a missing baseline');
    assert.deepEqual(result.baseline.contexts, [], 'nothing is active yet');

    const byKey = Object.fromEntries(result.quantities.items.map(row => [row.key, row]));
    for (const key of ['miningOutputTotal', 'controlledNationGdp', 'controlPointResearchIncome',
      'habResearchIncome', 'shipMissionControlCost', 'missionControlHeadroom', 'councilorCount']) {
      assert.equal(byKey[key].value, null, `${key} must be null on turn one, not 0`);
      assert.equal(byKey[key].measured, false);
      assert.ok(byKey[key].reason, `${key} must say why it is unmeasured`);
    }
    // The one genuine measurement available to a turn-one faction.
    assert.equal(byKey.queuedShipBuildDays.value, 0);
    assert.equal(byKey.queuedShipBuildDays.measured, true);

    // Nothing is priced, and that is reported rather than rendering as a list
    // of zero-valued techs.
    assert.equal(result.valuation.priced, 0);
    assert.ok(result.valuation.unpriceable > 0);
    assert.ok(result.items.length > 0, 'candidates are still listed; they are not dropped for being unpriceable');
    for (const item of result.items) {
      assert.notEqual(item.valuationState, PRICING_STATES.priced);
      for (const unit of item.monthlyValue) {
        assert.notEqual(unit.total, 0, 'a zero must never be emitted in place of an unmeasured value');
      }
    }

    // Availability still comes from the save's own list, exactly as phase 1
    // and phase 2 require.
    assert.equal(result.research.availabilityResolvable, true);
    assert.match(result.research.availabilitySource, /availableProjectNames/);
    const available = result.items.filter(item => item.availability.state === AVAILABILITY_STATES.researchableNow);
    for (const item of available) assert.ok(TURN_ONE_AVAILABLE.includes(item.id));
  });
}

test('turn one still names every context it could not price', () => {
  const result = project(turnOneSnapshot(), { mode: 'player' });
  assert.ok(result.contextCoverage.unpricedContextCount > 100);
  for (const row of result.contextCoverage.unpriced) {
    assert.ok(row.context, 'every unpriced context must be named');
    assert.ok(result.contextCoverage.unpricedGroups[row.group], 'every group must expand to a reason');
    assert.ok(row.effectsUsingIt > 0);
  }
  // Every mapping is listed even when its quantity is unmeasured, so a reader
  // can see the mapping exists and the campaign is what is missing.
  assert.equal(result.contextCoverage.priced.length, PRICED_CONTEXTS.length);
  for (const row of result.contextCoverage.priced) {
    assert.equal(row.quantityMeasured, row.quantityKey === 'queuedShipBuildDays');
  }
});

// ---------------------------------------------------------------------------
// A REAL ECONOMY, END TO END
// ---------------------------------------------------------------------------

for (const mode of ['player', 'omniscient']) {
  test(`the endpoint prices a real economy identically in both modes (${mode})`, () => {
    const snapshot = economySnapshot(mode);
    const result = project(snapshot, { mode, detail: 'full', limit: 1000 });

    assert.equal(result.quantities.available, true);
    assert.ok(result.quantities.measuredCount >= 14, `expected most quantities measured, got ${result.quantities.measuredCount}`);
    assert.equal(result.quantities.missionControlPin.reproducesSaveFigure, true);
    assert.ok(result.valuation.priced > 0, 'a real economy must price something');

    // Ordering is reachability first. A faction-restricted project must never
    // lead a response that also contains something the observer can research.
    const states = result.items.map(item => item.availability.state);
    const firstRestricted = states.indexOf(AVAILABILITY_STATES.factionRestricted);
    const lastAvailable = states.lastIndexOf(AVAILABILITY_STATES.researchableNow);
    if (firstRestricted !== -1 && lastAvailable !== -1) {
      assert.ok(firstRestricted > lastAvailable,
        'faction-restricted candidates must sort after everything the observer can actually research');
    }

    // A completed project is not a candidate for research.
    const completed = result.items.filter(item => item.availability.state === AVAILABILITY_STATES.completed);
    assert.deepEqual(completed, []);

    for (const item of result.items) {
      assert.ok([PRICING_STATES.priced, PRICING_STATES.inert, PRICING_STATES.unpriceable].includes(item.valuationState));
      if (item.valuationState === PRICING_STATES.unpriceable) {
        assert.ok(item.unpriceableCodes.length > 0 || item.counts.total === 0,
          `${item.id} is unpriceable and must say why`);
        assert.deepEqual(item.monthlyValue, [], 'an unpriceable candidate must carry no fabricated value');
      }
      for (const row of item.effects) {
        if (row.state === PRICING_STATES.priced) {
          // A priced row carries a number. For a modifier or an instant effect
          // that is `delta`; for a resource grant it is `monthsOfIncome`,
          // because a one-time windfall is not a monthly rate and is
          // deliberately kept out of `delta` so it cannot be summed into one.
          const number = row.kind === 'grant' ? row.monthsOfIncome : row.delta;
          assert.notEqual(number, null, `${item.id}/${row.effectId ?? row.resource}: a priced row must carry a number`);
        }
        if (row.state === PRICING_STATES.unpriceable) {
          assert.equal(row.delta ?? null, null);
          assert.equal(row.monthsOfIncome ?? null, null);
        }
      }
    }
  });
}

test('both modes produce the identical valuation for the observer', () => {
  // The effect templates and the observer's own manifests survive redaction, so
  // a difference here would mean the endpoint was reading something it should
  // not have had in player mode.
  const player = project(economySnapshot('player'), { mode: 'player', detail: 'full', limit: 1000 });
  const omniscient = project(economySnapshot('omniscient'), { mode: 'omniscient', detail: 'full', limit: 1000 });
  assert.deepEqual(player.quantities.items, omniscient.quantities.items);
  assert.deepEqual(player.valuation, omniscient.valuation);
  assert.deepEqual(player.items.map(item => item.id), omniscient.items.map(item => item.id));
});

test('filters narrow without inventing a 400', () => {
  const snapshot = economySnapshot();
  const byContext = project(snapshot, { family: 'MiningMetalsBonus', detail: 'full', limit: 1000 });
  assert.ok(byContext.items.length > 0);
  for (const item of byContext.items) assert.ok(item.contexts.includes('MiningMetalsBonus'));

  const byState = project(snapshot, { status: AVAILABILITY_STATES.researchableNow, limit: 1000 });
  for (const item of byState.items) assert.equal(item.availability.state, AVAILABILITY_STATES.researchableNow);

  // An unmatched filter yields an empty list, the same way an unmatched
  // `?faction=` does -- not an error and not the unfiltered set.
  const nothing = project(snapshot, { family: 'NoSuchContextExists' });
  assert.equal(nothing.count, 0);
  assert.equal(nothing.filter.context, 'NoSuchContextExists');
});

test('a snapshot published before the effect index degrades with guidance', () => {
  const snapshot = economySnapshot();
  delete snapshot.effectIndex;
  const result = project(snapshot);
  assert.equal(result.effectIndex.available, false);
  assert.match(result.effectIndex.reason, /re-publish/);
  assert.equal(result.count, 0);
  assert.deepEqual(result.items, []);
  // The formula and operation tables are static and must still be served, so a
  // caller can tell an old snapshot from a broken endpoint.
  assert.ok(result.formulae.multiplicativeDelta.formula);
  assert.ok(result.operations.IncreaseToValue.reading);
});

test('every formula states its basis and whether it is validated', () => {
  for (const [key, entry] of Object.entries(ECONOMIC_FORMULAE)) {
    assert.ok(entry.formula, `${key} must state its formula`);
    assert.ok(entry.basis && entry.basis.length > 40, `${key} must state what substantiates it`);
    assert.equal(typeof entry.validatedAgainstGameOutput, 'boolean',
      `${key} must declare whether it reproduces a figure the game publishes`);
  }
  // Exactly one derivation is pinned to a figure the game states. Claiming
  // more would erase the distinction section 7 requires.
  const validated = Object.entries(ECONOMIC_FORMULAE).filter(([, entry]) => entry.validatedAgainstGameOutput);
  assert.deepEqual(validated.map(([key]) => key), ['missionControlUsage']);
  assert.match(ECONOMIC_FORMULAE.miningOutput.basis, /NOT PINNED/);

  for (const [operation, entry] of Object.entries(OPERATION_SEMANTICS)) {
    assert.ok(entry.reading, `${operation} must state how it is read`);
    assert.ok(entry.combines);
  }
});

test('council attribute totals are reported per attribute, not as one blend', () => {
  const snapshot = economySnapshot();
  snapshot.councilors = [
    { ID: 200, factionId: OBSERVER, attributes: { Command: 4, Espionage: 0 } },
    { ID: 201, factionId: OBSERVER, attributes: { Command: 6, Espionage: 0 } },
    { ID: 202, factionId: 4713, attributes: { Command: 99, Espionage: 99 } }
  ];
  const totals = buildLiveQuantities(snapshot, OBSERVER).quantities.councilAttributeTotals;
  assert.equal(totals.valueShape, 'map', 'the one non-scalar quantity must say so');
  assert.deepEqual(totals.value, { Command: 10, Espionage: 0 }, 'rival councilors must not be counted');
  assert.equal(totals.measured, true);

  // A council whose attributes are unreadable is unmeasured, not zeroed.
  snapshot.councilors = [{ ID: 200, factionId: OBSERVER }];
  const unreadable = buildLiveQuantities(snapshot, OBSERVER).quantities.councilAttributeTotals;
  assert.equal(unreadable.value, null);
  assert.equal(unreadable.measured, false);
  assert.ok(unreadable.reason);
});

test('every quantity declares its value shape, its source, and any formula', () => {
  const quantities = buildLiveQuantities(economySnapshot(), OBSERVER).quantities;
  for (const [key, entry] of Object.entries(quantities)) {
    assert.ok(['scalar', 'map'].includes(entry.valueShape), `${key} must declare a value shape`);
    if (entry.valueShape === 'scalar' && entry.value !== null) {
      assert.equal(typeof entry.value, 'number', `${key} declares scalar but is not a number`);
    }
    assert.ok(entry.source, `${key} must name the snapshot field it was read from`);
    if (entry.formulaKey) {
      assert.ok(ECONOMIC_FORMULAE[entry.formulaKey],
        `${key} points at formula '${entry.formulaKey}', which is not in the table`);
    }
  }
  // The four DERIVED quantities must each be traceable to a stated formula;
  // section 7 does not exempt a quantity from stating how it was computed.
  for (const key of ['miningOutputTotal', 'controlledNationGdp', 'controlPointResearchIncome', 'missionControlHeadroom']) {
    assert.ok(quantities[key].formulaKey, `${key} is derived and must cite its formula`);
  }
});

test('every priced context maps to a quantity the module actually measures', () => {
  const snapshot = economySnapshot();
  const quantities = buildLiveQuantities(snapshot, OBSERVER);
  for (const context of PRICED_CONTEXTS) {
    const mapping = CONTEXT_QUANTITY_MAP[context];
    assert.ok(quantities.quantities[mapping.quantityKey],
      `${context} maps to '${mapping.quantityKey}', which buildLiveQuantities does not produce`);
    assert.ok(mapping.note, `${context} must say what its mapping means`);
    assert.ok(['higher', 'lower'].includes(mapping.direction));
  }
});

test('the rendered payload contains no undefined or NaN', () => {
  for (const snapshot of [turnOneSnapshot(), economySnapshot()]) {
    for (const detail of ['summary', 'full']) {
      const text = JSON.stringify(project(snapshot, { detail, limit: 1000 }));
      assert.ok(!text.includes('undefined'), `${detail}: rendered payload contains "undefined"');`);
      assert.ok(!text.includes('NaN'), `${detail}: rendered payload contains NaN`);
      assert.ok(!text.includes('Infinity'), `${detail}: rendered payload contains Infinity`);
    }
  }
});

test('the default response stays inside its stated size budget', () => {
  const snapshot = economySnapshot();
  const summaryBytes = Buffer.byteLength(JSON.stringify(project(snapshot)), 'utf8');
  // Measured 2026-08-21 against the live save at 75 KB summary / 603 KB full
  // with no limit. The fixed head -- formulae, operations, codes, the full
  // unpriced-context listing -- is most of the summary, which is why the
  // reason prose is stated once and the rows carry group keys.
  assert.ok(summaryBytes < 220 * 1024, `the default response is ${(summaryBytes / 1024).toFixed(1)} KB`);
});
