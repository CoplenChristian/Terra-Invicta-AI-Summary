// The control-point cap: what is established, what is refused, and the
// reconciliation failure that is the reason for the refusal.
//
// THE GATING FACT THESE TESTS DEFEND. The composition is cited term by term and
// the absolute cap is NOT established: on `ExitSave.gz` the Protectorate models
// a cap of 992 against a maintenance cost of 872.47 -- no overage -- while the
// save's own `history_CPCapOverageByDay` records 10.02. If a later change makes
// the two agree, `a modelled cap and the save's recorded overage do not
// reconcile` below is the test that breaks, and the refusal can be revisited on
// purpose rather than by drift.
//
// Every expected value here is derived from the rule table, the shipped
// templates or the save's own fields, never pinned to a figure captured from
// this change's output.

const { test } = require('node:test');
const assert = require('node:assert');

const {
  ADMINISTRATION_HAB_MODULES,
  BASE_CAP_UNRESOLVED,
  CAP_ATTRIBUTES,
  CONTROL_POINT_MAINTENANCE_EFFECTS,
  COST_FORMULA,
  buildControlPointCap,
  buildControlPointCapReport,
  buildControlPointMaintenance,
  marginalControlPointCost,
  overCapInfluencePenalty,
  overCapMissionExposure,
  readBaseControlPointCap
} = require('../shared/controlPointCap.mjs');
const { SUPPORTED_RESOURCES, INTEL_ENDPOINT_INDEX } = require('../shared/intel/registry.mjs');
const { buildControlNationCandidate } = require('../server/engine/candidates/controlPoints');
const { loadFilteredSnapshot, queryIntel } = require('../server/snapshotLoader');

const OBSERVER = 4712;
const PROTECTORATE = 4714;
const ALIENS = 4717;

// ---------------------------------------------------------------------------
// The mechanic, from the templates and the wiki.
// ---------------------------------------------------------------------------

test('a negative ControlPointMaintenance value RAISES the cap by its magnitude', () => {
  // `TIEffectTemplate.json` stores these negative on a quantity displayed as
  // "Control Point Cap", and marks all five `showTotal: "Invert"`. The three
  // Administration projects share `AI_projectRole: "ControlPointCap"` with the
  // nine that grant these effects, and they grant POSITIVE controlPointCapacity
  // -- so negative maintenance must mean more cap.
  for (const [name, spec] of Object.entries(CONTROL_POINT_MAINTENANCE_EFFECTS)) {
    assert.ok(spec.value < 0, `${name} should store a negative value`);
    assert.equal(spec.capContribution, -spec.value, `${name} should contribute the magnitude of its value`);
  }
  assert.equal(CONTROL_POINT_MAINTENANCE_EFFECTS.Effect_ControlPointMaintenanceBonus160.capContribution, 120);
  assert.equal(CONTROL_POINT_MAINTENANCE_EFFECTS.Effect_ControlPointMaintenanceBonus3.capContribution, 5);
});

test('the effect name is never a source of magnitude', () => {
  // `Bonus160` is -120 and `Bonus3` is -5. Any code that parsed the trailing
  // number off the name would be wrong on two of the five.
  const mismatched = Object.entries(CONTROL_POINT_MAINTENANCE_EFFECTS)
    .filter(([name, spec]) => Number(name.replace(/\D+/g, '')) !== spec.capContribution)
    .map(([name]) => name);
  assert.deepEqual(mismatched.sort(), [
    'Effect_ControlPointMaintenanceBonus160',
    'Effect_ControlPointMaintenanceBonus3'
  ]);
});

test('three attributes contribute to the cap, not one', () => {
  // wiki Control_Point_Capacity: "Every point of administration, persuasion, or
  // command on a Councilor that is not Detained adds 1 point of cp."
  assert.deepEqual([...CAP_ATTRIBUTES].sort(), ['Administration', 'Command', 'Persuasion']);
});

test('only three hab modules carry control-point capacity, at 4 / 12 / 30', () => {
  assert.deepEqual(ADMINISTRATION_HAB_MODULES, {
    AdministrationNode: 4,
    AdministrationTower: 12,
    AdministrationComplex: 30
  });
});

test('the over-cap Influence penalty is squared, not linear', () => {
  assert.equal(overCapInfluencePenalty(3), 9);
  assert.equal(overCapInfluencePenalty(10), 100);
  assert.equal(overCapInfluencePenalty(0), 0);
  // A linear model would give 3 and 10 here; the whole point of the wiki
  // citation is that being ten over costs a hundred, not ten.
  assert.notEqual(overCapInfluencePenalty(10), 10);
  // Crackdown / Purge / Enthrall Elites / Dominate Nation gain overage / 3.
  assert.equal(overCapMissionExposure(9), 3);
});

test('an unmeasured overage yields a null penalty, never a comfortable zero', () => {
  assert.equal(overCapInfluencePenalty(null), null);
  assert.equal(overCapInfluencePenalty(undefined), null);
  assert.equal(overCapInfluencePenalty(''), null);
  assert.equal(overCapMissionExposure(null), null);
});

// ---------------------------------------------------------------------------
// The base cap: located, and refused when absent.
// ---------------------------------------------------------------------------

test('the base cap is read from the save\'s own two fields and named', () => {
  const base = readBaseControlPointCap({
    metadata: {
      controlPointMaintenanceFreebies: 400,
      campaignSettings: {
        settings: {
          controlPointMaintenanceFreebieBonus: { value: 150 },
          controlPointMaintenanceFreebieBonusAI: { value: 0 }
        }
      }
    }
  }, { isObserverPlayerFaction: true });

  assert.equal(base.available, true);
  assert.equal(base.total, 550);
  assert.deepEqual(base.parts.map(p => p.field), [
    'TIGlobalValuesState.controlPointMaintenanceFreebies',
    'TIMetadataState.controlPointMaintenanceFreebieBonus'
  ]);
  // Which of the two the game calls "the base" is not settled, and the module
  // says so rather than picking one.
  assert.equal(BASE_CAP_UNRESOLVED.resolved, false);
});

test('an AI faction also receives the AI-only bonus, and the player faction does not', () => {
  const metadata = {
    controlPointMaintenanceFreebies: 400,
    campaignSettings: {
      settings: {
        controlPointMaintenanceFreebieBonus: { value: 150 },
        controlPointMaintenanceFreebieBonusAI: { value: 60 }
      }
    }
  };
  assert.equal(readBaseControlPointCap({ metadata }, { isObserverPlayerFaction: true }).total, 550);
  assert.equal(readBaseControlPointCap({ metadata }, { isObserverPlayerFaction: false }).total, 610);
});

test('an unreadable base cap is unknown, never zero and never no-limit', () => {
  const base = readBaseControlPointCap({ metadata: {} });
  assert.equal(base.available, false);
  assert.equal(base.total, null);
  assert.ok(base.unreadable.length > 0);

  // And it propagates: with no base there is no cap at all.
  const composed = buildControlPointCap({
    metadata: {},
    factions: [{ ID: 1, displayName: 'F', councilorsCount: 0, habsCount: 0, controlPointMaintenanceEffects: [] }],
    councilors: [],
    habModules: []
  }, { factionId: 1 });
  assert.equal(composed.cap, null);
  assert.equal(composed.capAvailable, false);
  assert.ok(composed.unreadableTerms.includes('base'));
});

// ---------------------------------------------------------------------------
// Composition and attribution.
// ---------------------------------------------------------------------------

const syntheticSnapshot = ({
  councilorsCount = 2,
  habsCount = 0,
  effects = [],
  councilors = [],
  habModules = [],
  freebies = 400
} = {}) => ({
  metadata: {
    controlPointMaintenanceFreebies: freebies,
    playerFactionName: 'Test Faction',
    campaignSettings: {
      settings: {
        controlPointMaintenanceFreebieBonus: { value: 0 },
        controlPointMaintenanceFreebieBonusAI: { value: 0 }
      }
    }
  },
  factions: [{
    ID: 1,
    displayName: 'Test Faction',
    councilorsCount,
    habsCount,
    controlPointMaintenanceEffects: effects
  }],
  councilors,
  habModules,
  nations: []
});

const councilor = (name, adm, per, cmd, status = 'Active') => ({
  ID: name,
  displayName: name,
  factionId: 1,
  status,
  resolvedAttributes: {
    effective: { Administration: adm, Persuasion: per, Command: cmd },
    baseMeasured: { Administration: true, Persuasion: true, Command: true }
  }
});

test('every contribution is attributed to a named source', () => {
  const snapshot = syntheticSnapshot({
    councilorsCount: 2,
    habsCount: 1,
    effects: ['Effect_ControlPointMaintenanceBonus40', 'Effect_ControlPointMaintenanceBonus3'],
    councilors: [councilor('Ada', 10, 4, 2), councilor('Bo', 3, 1, 1)],
    habModules: [{
      id: 'm1', factionId: 1, templateName: 'AdministrationTower', name: 'Tower',
      habName: 'Station One', constructionCompleted: true, destroyed: false
    }]
  });
  const cap = buildControlPointCap(snapshot, { factionId: 1 });

  // 400 base + (16 + 5) councilor + 12 hab module + (40 + 5) effects
  assert.equal(cap.cap, 400 + 21 + 12 + 45);
  assert.equal(cap.councilorTotal, 21);
  assert.equal(cap.habModuleTotal, 12);
  assert.equal(cap.effectTotal, 45);

  // The reader can see which councilor contributed what -- because that
  // councilor dying changes the cap.
  const ada = cap.councilors.find(c => c.name === 'Ada');
  assert.equal(ada.capContribution, 16);
  assert.deepEqual(ada.attributes, { Administration: 10, Persuasion: 4, Command: 2 });
  assert.equal(cap.habModules[0].habName, 'Station One');
  assert.equal(cap.effects[0].capContribution, 40);
});

test('a detained councilor contributes nothing, and the reason is stated', () => {
  const snapshot = syntheticSnapshot({
    councilorsCount: 2,
    effects: [],
    councilors: [councilor('Ada', 10, 4, 2), councilor('Bo', 9, 9, 9, 'Detained')]
  });
  const cap = buildControlPointCap(snapshot, { factionId: 1 });
  assert.equal(cap.councilorTotal, 16);
  const bo = cap.councilors.find(c => c.name === 'Bo');
  assert.equal(bo.capContribution, 0);
  assert.match(bo.reason, /detained/i);
});

test('a short roster is unknown, not a roster of zeros', () => {
  // The faction says six councilors; one is visible. Summing the one would
  // delete the largest term in the cap and present the remainder as a total.
  const snapshot = syntheticSnapshot({
    councilorsCount: 6,
    councilors: [councilor('Ada', 10, 4, 2)]
  });
  const cap = buildControlPointCap(snapshot, { factionId: 1 });
  assert.equal(cap.rosterComplete, false);
  assert.equal(cap.councilorTotal, null);
  assert.equal(cap.cap, null);
  assert.match(cap.councilorTotalReason, /1 of this faction's 6 councilors/);
});

test('an unreadable headcount leaves completeness unverifiable, which is not "complete"', () => {
  const snapshot = syntheticSnapshot({ councilorsCount: null, councilors: [councilor('Ada', 10, 4, 2)] });
  const cap = buildControlPointCap(snapshot, { factionId: 1 });
  assert.equal(cap.rosterComplete, null);
  assert.equal(cap.councilorTotal, null);
  assert.equal(cap.cap, null);
});

test('a faction with habs but no visible hab-module rows has an unknown module term', () => {
  // Player mode publishes every faction's habs and only the observer's modules.
  const snapshot = syntheticSnapshot({ councilorsCount: 0, habsCount: 15, habModules: [] });
  assert.equal(buildControlPointCap(snapshot, { factionId: 1 }).habModuleTotal, null);
  // A faction with no habs at all genuinely has no Administration modules.
  const noHabs = syntheticSnapshot({ councilorsCount: 0, habsCount: 0, habModules: [] });
  assert.equal(buildControlPointCap(noHabs, { factionId: 1 }).habModuleTotal, 0);
});

test('an absent effect list is unknown, while an empty one is a measured zero', () => {
  const absent = syntheticSnapshot({ councilorsCount: 0 });
  absent.factions[0].controlPointMaintenanceEffects = null;
  assert.equal(buildControlPointCap(absent, { factionId: 1 }).effectTotal, null);
  assert.equal(buildControlPointCap(absent, { factionId: 1 }).cap, null);

  const empty = syntheticSnapshot({ councilorsCount: 0, effects: [] });
  assert.equal(buildControlPointCap(empty, { factionId: 1 }).effectTotal, 0);
});

// ---------------------------------------------------------------------------
// The cost side.
// ---------------------------------------------------------------------------

const nation = (id, name, gdpBillions, cps) => ({
  ID: id,
  displayName: name,
  GDP: gdpBillions * 1e9,
  controlPoints: cps
});

test('a nation\'s cost is divided evenly among its control points', () => {
  // wiki Nations: total = (GDP in billions)^0.6 / 2, "divided up evenly among
  // all the control points of the nation". Omitting the division is what put an
  // earlier attempt an order of magnitude out.
  const gdpBn = 1000;
  const expectedTotal = Math.pow(gdpBn, COST_FORMULA.exponent) / COST_FORMULA.divisor;
  const snapshot = {
    nations: [nation(1, 'Aland', gdpBn, [
      { id: 'a', factionId: 1 }, { id: 'b', factionId: 1 },
      { id: 'c', factionId: 2 }, { id: 'd', factionId: null }
    ])]
  };
  const cost = buildControlPointMaintenance(snapshot, { factionId: 1 });
  assert.equal(cost.held, 2);
  assert.equal(cost.nations[0].nationTotalCost, Number(expectedTotal.toFixed(3)));
  assert.equal(cost.nations[0].perControlPoint, Number((expectedTotal / 4).toFixed(3)));
  assert.equal(cost.cost, Number(((expectedTotal / 4) * 2).toFixed(3)));
  // The undivided total would be twice as big for a two-of-four holding.
  assert.notEqual(cost.cost, Number((expectedTotal * 2).toFixed(3)));
});

test('crackdown-hit and abandoned control points cost nothing', () => {
  const snapshot = {
    nations: [nation(1, 'Aland', 1000, [
      { id: 'a', factionId: 1 },
      { id: 'b', factionId: 1, crackdown: true },
      { id: 'c', factionId: 1, benefitsDisabled: true },
      { id: 'd', factionId: 1 }
    ])]
  };
  const cost = buildControlPointMaintenance(snapshot, { factionId: 1 });
  assert.equal(cost.held, 4);
  assert.equal(cost.costFreeHeld, 2);
  assert.equal(cost.nations[0].paying, 2);
  assert.deepEqual(cost.nations[0].costFreeReasons.map(r => r.reason).sort(), ['abandoned', 'crackdown']);
});

test('a nation with no readable GDP is unpriced and named, never priced at zero', () => {
  const snapshot = {
    nations: [
      nation(1, 'Aland', 1000, [{ id: 'a', factionId: 1 }]),
      { ID: 2, displayName: 'Bland', GDP: null, controlPoints: [{ id: 'b', factionId: 1 }] }
    ]
  };
  const cost = buildControlPointMaintenance(snapshot, { factionId: 1 });
  assert.equal(cost.held, 2);
  assert.equal(cost.costComplete, false);
  assert.equal(cost.costIsFloor, true);
  assert.equal(cost.unpricedNations.length, 1);
  assert.equal(cost.unpricedNations[0].nation, 'Bland');
});

test('the marginal cost of one more control point refuses an unpriceable nation', () => {
  const priced = marginalControlPointCost(nation(1, 'Aland', 1000, [{ id: 'a' }, { id: 'b' }]));
  assert.equal(priced.available, true);
  assert.equal(priced.cost, Number(((Math.pow(1000, 0.6) / 2) / 2).toFixed(3)));

  const unpriced = marginalControlPointCost({ ID: 2, displayName: 'Bland', GDP: null, controlPoints: [{ id: 'b' }] });
  assert.equal(unpriced.available, false);
  assert.equal(unpriced.cost, null);
  assert.match(unpriced.reason, /GDP/);
});

// ---------------------------------------------------------------------------
// The refusal.
// ---------------------------------------------------------------------------

test('headroom is never emitted, whatever the numbers say', () => {
  const snapshot = syntheticSnapshot({
    councilorsCount: 1,
    effects: [],
    councilors: [councilor('Ada', 10, 4, 2)]
  });
  snapshot.nations = [nation(1, 'Aland', 10, [{ id: 'a', factionId: 1 }])];
  const report = buildControlPointCapReport(snapshot, { factionId: 1 });
  // A comfortable position -- 416 of cap against under 2 of cost -- and still
  // no headroom figure, because the cap is not established.
  assert.equal(report.capacity.cap, 416);
  assert.ok(report.maintenance.cost < 5);
  assert.equal(report.headroom.available, false);
  assert.equal(report.headroom.value, null);
  assert.match(report.headroom.reason, /does not reconcile/);
  assert.equal(report.verdict, 'unresolved');
});

test('a modelled cap and the save\'s recorded overage do not reconcile', () => {
  // The measurement that justifies the refusal. If this ever passes with
  // residual 0 across the board the refusal should be revisited deliberately.
  const snapshot = loadFilteredSnapshot({ mode: 'omniscient', observer: OBSERVER });
  const report = buildControlPointCapReport(snapshot, { factionId: PROTECTORATE, mode: 'omniscient' });
  assert.equal(report.reconciliation.reconciles, false);
  assert.ok(report.recorded.available, 'the save should carry a recorded overage for the Protectorate');
  assert.ok(report.recorded.overage > 0, 'the Protectorate is recorded over cap');
  assert.equal(report.reconciliation.modelledOverage, 0, 'the model puts the Protectorate under cap');
  assert.ok(report.reconciliation.residual !== 0, 'the model and the recording disagree');
  // And the recording's own semantics are not claimed.
  assert.equal(report.recorded.semanticsVerified, false);
});

// ---------------------------------------------------------------------------
// Both modes, and the rival redaction.
// ---------------------------------------------------------------------------

test('the observer composes its own cap identically in both modes', () => {
  const player = buildControlPointCapReport(
    loadFilteredSnapshot({ mode: 'player', observer: OBSERVER }), { factionId: OBSERVER, mode: 'player' }
  );
  const omniscient = buildControlPointCapReport(
    loadFilteredSnapshot({ mode: 'omniscient', observer: OBSERVER }), { factionId: OBSERVER, mode: 'omniscient' }
  );
  assert.ok(player.capacity.capAvailable, 'the observer\'s own cap must compose in player mode');
  assert.equal(player.capacity.cap, omniscient.capacity.cap);
  assert.equal(player.maintenance.cost, omniscient.maintenance.cost);
  assert.deepEqual(
    player.capacity.councilors.map(c => c.capContribution),
    omniscient.capacity.councilors.map(c => c.capContribution)
  );
});

test('a rival\'s cap is omniscient-only and refuses in player mode', () => {
  const player = loadFilteredSnapshot({ mode: 'player', observer: OBSERVER });
  for (const factionId of [PROTECTORATE, ALIENS]) {
    const report = buildControlPointCapReport(player, { factionId, mode: 'player' });
    assert.equal(report.capacity.capAvailable, false, `faction ${factionId} must not compose in player mode`);
    assert.equal(report.capacity.cap, null);
    assert.equal(report.recorded.overage, null, `faction ${factionId} must not leak its recorded overage`);
  }
  const omniscient = loadFilteredSnapshot({ mode: 'omniscient', observer: OBSERVER });
  assert.ok(
    buildControlPointCapReport(omniscient, { factionId: PROTECTORATE, mode: 'omniscient' }).capacity.capAvailable,
    'omniscient mode should compose a rival cap'
  );
});

test('no rival cap input survives anywhere in the player-mode payload', () => {
  // Scanned across the WHOLE payload, not pinned to one field: four shipped
  // leaks had the derived field nulled while the raw one it came from survived.
  const player = loadFilteredSnapshot({ mode: 'player', observer: OBSERVER });
  const omniscient = loadFilteredSnapshot({ mode: 'omniscient', observer: OBSERVER });

  const rivalOverages = omniscient.factions
    .filter(f => f.ID !== OBSERVER)
    .map(f => f.recordedControlPointCapOverage)
    .filter(v => typeof v === 'number' && v !== 0);
  assert.ok(rivalOverages.length > 0, 'at least one rival should have a non-zero recorded overage to hunt for');

  const serialised = JSON.stringify(player);
  for (const value of rivalOverages) {
    assert.ok(
      !serialised.includes(String(value)),
      `the player payload leaks a rival's recorded control-point cap overage (${value})`
    );
  }

  for (const faction of player.factions) {
    if (faction.ID === OBSERVER) continue;
    assert.equal(faction.recordedControlPointCapOverage, null, `${faction.ID} leaks recordedControlPointCapOverage`);
    assert.equal(faction.controlPointMaintenanceEffects, null, `${faction.ID} leaks controlPointMaintenanceEffects`);
  }
});

test('the player-mode redaction assertion covers both new faction fields', () => {
  // The assertion exists so a future field added beside these two fails loudly
  // rather than quietly shipping. Injected individually, because a single
  // combined check would still pass if only one of the two were dropped.
  const intelligenceFilter = require('../server/intelligenceFilter');
  const base = () => loadFilteredSnapshot({ mode: 'player', observer: OBSERVER, bypassCache: true });
  assert.equal(intelligenceFilter.assertPlayerSnapshotSafe(base()), true);

  const withEffects = base();
  withEffects.factions.find(f => f.ID !== OBSERVER).controlPointMaintenanceEffects =
    ['Effect_ControlPointMaintenanceBonus160'];
  assert.throws(() => intelligenceFilter.assertPlayerSnapshotSafe(withEffects), /hidden faction telemetry/);

  const withOverage = base();
  withOverage.factions.find(f => f.ID !== OBSERVER).recordedControlPointCapOverage = 10.02051;
  assert.throws(() => intelligenceFilter.assertPlayerSnapshotSafe(withOverage), /hidden faction telemetry/);
});

// ---------------------------------------------------------------------------
// It reaches the AI surfaces.
// ---------------------------------------------------------------------------

test('the endpoint is a registry row, with a route and a discovery entry', () => {
  assert.ok(SUPPORTED_RESOURCES.has('control-point-cap'));
  assert.equal(INTEL_ENDPOINT_INDEX.controlPointCap, '/api/intel/control-point-cap');
});

test('the endpoint answers in both modes and states the refusal at the top', () => {
  for (const mode of ['player', 'omniscient']) {
    const res = queryIntel({
      endpoint: 'control-point-cap', mode, observer: OBSERVER, queryOptions: { factionId: OBSERVER }
    });
    assert.equal(res.count, 1);
    assert.equal(res.verdict, 'unresolved');
    assert.ok(res.items[0].capacity.capAvailable, `the observer's own cap should compose in ${mode} mode`);
    assert.equal(res.items[0].headroom.available, false);
  }
  const player = queryIntel({ endpoint: 'control-point-cap', mode: 'player', observer: OBSERVER });
  assert.equal(player.composedCount, 1, 'player mode composes only the observer');
  assert.ok(player.refusedCount > 0);
  assert.ok(player.refusedFactions.every(f => typeof f.reason === 'string' && f.reason.length > 0));
});

// ---------------------------------------------------------------------------
// The engine annotation, which must not move a score.
// ---------------------------------------------------------------------------

test('a control-nation candidate carries the marginal maintenance cost of the control point', () => {
  const target = nation(1, 'Aland', 1000, [{ id: 'a', factionId: null }, { id: 'b', factionId: 2 }]);
  target.regionsCount = 4;
  target.population = 10;
  const candidate = buildControlNationCandidate(
    target, target.controlPoints[0], target.controlPoints, { observerId: OBSERVER }
  );
  assert.equal(candidate.value.controlPointMaintenance.available, true);
  assert.equal(
    candidate.value.controlPointMaintenance.cost,
    Number(((Math.pow(1000, 0.6) / 2) / 2).toFixed(3))
  );
  // It is data only: the candidate carries no score of its own, and the rule
  // registry reads `gdpBn` and `cpCountInNation`, not this field.
  assert.equal(candidate.score, null);
});

test('an unpriceable nation annotates the refusal rather than a free control point', () => {
  const target = { ID: 9, displayName: 'Bland', GDP: null, controlPoints: [{ id: 'a', factionId: null }], regionsCount: 1 };
  const candidate = buildControlNationCandidate(
    target, target.controlPoints[0], target.controlPoints, { observerId: OBSERVER }
  );
  assert.equal(candidate.value.controlPointMaintenance.available, false);
  assert.equal(candidate.value.controlPointMaintenance.cost, null);
  assert.notEqual(candidate.value.controlPointMaintenance.cost, 0);
});
