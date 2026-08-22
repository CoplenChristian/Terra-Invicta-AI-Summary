// The control-point cap: what the game's own record actually measures, the cap
// composed from the game's own formula, and how far the two are apart.
//
// THE GATING FACT THESE TESTS DEFEND. `history_CPCapOverageByDay` is a 32-day
// window, ONE SLOT PER DAY, NEWEST FIRST, and each slot holds
// `max(0, cost - cap) * 0.3333333432674408` -- the mission-defence penalty, not
// the overage. Two earlier readings were wrong in ways these tests now catch:
//
//   * reading the LAST slot ("the most recent") reads a month-stale sample. On
//     the measured save that moves the implied cap from 841.17 to 845.44 -- a
//     residual of 3.44 against a composed 842, which
//     `the composed cap reconciles against the game's own record` rejects.
//   * reading the stored number AS the overage understates the position 3x. On
//     the same save that implies a cap of 864.06, a residual of 22.
//
// Every expected value here is derived from the game's own methods (IL read
// from the shipped `Assembly-CSharp.dll` 1.0.51 on 2026-08-22), the shipped
// templates, or the save's own fields -- never pinned to a figure captured from
// this change's output.

const { test } = require('node:test');
const assert = require('node:assert');

const {
  ADMINISTRATION_HAB_MODULES,
  ALIEN_FACTION_CONTROL_POINT_CAP,
  CAP_ATTRIBUTES,
  CONTROL_POINT_CAP_ACCURACY,
  CONTROL_POINT_MAINTENANCE_EFFECTS,
  CONTROL_POINT_OVERAGE_PENALTY_MULTIPLIER,
  COST_FORMULA,
  buildControlPointCap,
  buildControlPointCapReport,
  buildControlPointMaintenance,
  marginalControlPointCost,
  nationControlPointCost,
  overCapInfluencePenalty,
  overCapMissionExposure,
  readBaseControlPointCap,
  readControlPointCostNormalizer
} = require('../shared/controlPointCap.mjs');
const { SUPPORTED_RESOURCES, INTEL_ENDPOINT_INDEX } = require('../shared/intel/registry.mjs');
const { buildControlNationCandidate } = require('../server/engine/candidates/controlPoints');
const { loadFilteredSnapshot, queryIntel } = require('../server/snapshotLoader');

const OBSERVER = 4712;
const PROTECTORATE = 4714;
const ALIENS = 4717;

// ---------------------------------------------------------------------------
// The mechanic, from the shipped assembly and templates.
// ---------------------------------------------------------------------------

test('a negative ControlPointMaintenance value RAISES the cap by its magnitude', () => {
  // `GetControlPointMaintenanceFreebieCap` SUBTRACTS the effect total, and
  // `TIEffectTemplate.json` stores these negative on a quantity displayed as
  // "Control Point Cap" with `showTotal: "Invert"`.
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
  // `TICouncilorState::get_controlPointCapacity` is exactly three GetAttribute
  // calls summed.
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
  // `GetAnnualControlPointMaintenanceCost` returns `over * over`.
  assert.equal(overCapInfluencePenalty(3), 9);
  assert.equal(overCapInfluencePenalty(10), 100);
  assert.equal(overCapInfluencePenalty(0), 0);
  // A linear model would give 3 and 10 here; the whole point is that being ten
  // over costs a hundred, not ten.
  assert.notEqual(overCapInfluencePenalty(10), 10);
});

test('the mission modifier is the overage times the shipped multiplier, which is a third', () => {
  // `TIGlobalConfig::.ctor` sets TIMissionModifier_ControlPointOverage_Multiplier
  // to 0.3333333432674408f, and GetOneDayControlPointCapMissionPenalty
  // multiplies the overage by it.
  assert.equal(CONTROL_POINT_OVERAGE_PENALTY_MULTIPLIER, 0.3333333432674408);
  assert.equal(overCapMissionExposure(9), 3);
  assert.equal(overCapMissionExposure(30), 10);
  // The float32 literal, not 1/3: the recorded values are that number times the
  // overage, so a nominal third recovers a slightly different overage.
  assert.notEqual(CONTROL_POINT_OVERAGE_PENALTY_MULTIPLIER, 1 / 3);
});

test('an unmeasured overage yields a null penalty, never a comfortable zero', () => {
  assert.equal(overCapInfluencePenalty(null), null);
  assert.equal(overCapInfluencePenalty(undefined), null);
  assert.equal(overCapInfluencePenalty(''), null);
  assert.equal(overCapMissionExposure(null), null);
});

// ---------------------------------------------------------------------------
// The base cap: located, and the double-count removed.
// ---------------------------------------------------------------------------

test('the base cap is the freebies field ALONE, and the campaign knob is excluded by name', () => {
  // CORRECTION 2026-08-22. `GetControlPointMaintenanceFreebieCap` reads
  // `GlobalValues.controlPointMaintenanceFreebies` and adds only the AI-only
  // bonus. The `controlPointMaintenanceFreebieBonus` campaign setting is the
  // knob that PRODUCED the stored value; adding it double-counted 150 points.
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
  assert.equal(base.total, 400);
  assert.notEqual(base.total, 550, 'the campaign knob must not be summed in again');
  assert.deepEqual(base.parts.map(p => p.field), ['TIGlobalValuesState.controlPointMaintenanceFreebies']);
  // Dropped on purpose, and said so, so a reader who remembers the old model
  // can see it was a decision rather than an omission.
  assert.equal(base.excludedSetting.field, 'TIMetadataState.controlPointMaintenanceFreebieBonus');
  assert.equal(base.excludedSetting.value, 150);
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
  assert.equal(readBaseControlPointCap({ metadata }, { isObserverPlayerFaction: true }).total, 400);
  assert.equal(readBaseControlPointCap({ metadata }, { isObserverPlayerFaction: false }).total, 460);
  // Not knowing which faction the human plays leaves the AI term unapplied and
  // the base unreadable, rather than applying it to everyone or to no one.
  assert.equal(readBaseControlPointCap({ metadata }, {}).available, false);
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
  freebies = 400,
  normalizer = 1e9
} = {}) => ({
  metadata: {
    controlPointMaintenanceFreebies: freebies,
    controlPointCostGdpNormalizer: normalizer,
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
  assert.equal(cap.capBasis, 'composed');

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
  const snapshot = syntheticSnapshot({ councilorsCount: 0, habsCount: 15, habModules: [] });
  assert.equal(buildControlPointCap(snapshot, { factionId: 1 }).habModuleTotal, null);
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

const nation = (id, name, gdpBillions, cps, extra = {}) => ({
  ID: id,
  displayName: name,
  GDP: gdpBillions * 1e9,
  controlPointCount: cps.length,
  controlPoints: cps,
  ...extra
});

test('a nation\'s cost is divided evenly among its control points', () => {
  // `Pow(GDP/PCGDP, 0.6) / (2 * numControlPoints)` per control point. Omitting
  // the division is what put an earlier attempt an order of magnitude out.
  const gdpBn = 1000;
  const expectedTotal = Math.pow(gdpBn, COST_FORMULA.exponent) / COST_FORMULA.divisor;
  const snapshot = {
    metadata: { controlPointCostGdpNormalizer: 1e9 },
    nations: [nation(1, 'Aland', gdpBn, [
      { id: 'a', factionId: 1 }, { id: 'b', factionId: 1 },
      { id: 'c', factionId: 2 }, { id: 'd', factionId: null }
    ])]
  };
  const cost = buildControlPointMaintenance(snapshot, { factionId: 1 });
  assert.equal(cost.held, 2);
  assert.equal(cost.nations[0].nationTotalCost, Number(expectedTotal.toFixed(5)));
  assert.equal(cost.nations[0].perControlPoint, Number((expectedTotal / 4).toFixed(5)));
  assert.equal(cost.cost, Number(((expectedTotal / 4) * 2).toFixed(5)));
  // The undivided total would be twice as big for a two-of-four holding.
  assert.notEqual(cost.cost, Number((expectedTotal * 2).toFixed(5)));
});

test('the cost divides by the save\'s own control-point count, not the projected list', () => {
  // Player mode can publish a SHORT control-point list, and dividing by a short
  // list inflates every holding's cost. `TINationState.numControlPoints`
  // survives redaction, so it is the divisor.
  const gdpBn = 1000;
  const total = Math.pow(gdpBn, 0.6) / 2;
  const short = {
    metadata: { controlPointCostGdpNormalizer: 1e9 },
    nations: [{
      ID: 1,
      displayName: 'Aland',
      GDP: gdpBn * 1e9,
      controlPointCount: 6,
      controlPoints: [{ id: 'a', factionId: 1 }]
    }]
  };
  const cost = buildControlPointMaintenance(short, { factionId: 1 });
  assert.equal(cost.nations[0].nationControlPoints, 6);
  assert.equal(cost.nations[0].nationControlPointsSource, 'TINationState.numControlPoints');
  assert.equal(cost.cost, Number((total / 6).toFixed(5)));
  // Dividing by the one visible row would be six times as expensive.
  assert.notEqual(cost.cost, Number(total.toFixed(5)));

  // With no saved count the list length is used, and the fallback is named.
  const noCount = {
    metadata: { controlPointCostGdpNormalizer: 1e9 },
    nations: [{
      ID: 1, displayName: 'Aland', GDP: gdpBn * 1e9, controlPoints: [{ id: 'a', factionId: 1 }]
    }]
  };
  const fallback = buildControlPointMaintenance(noCount, { factionId: 1 });
  assert.match(fallback.nations[0].nationControlPointsSource, /projected control-point list/);
});

test('the GDP normalizer comes from the save, and its absence is labelled not assumed', () => {
  // `get_pcgdpToRaiseBaseCPMaintenanceCostBy1` freezes
  // `globalGDP_CampaignStart * 6.26e-6` when the start time scales CP
  // maintenance, and returns a flat 1e9 when it does not.
  const measured = readControlPointCostNormalizer({ metadata: { controlPointCostGdpNormalizer: 994239000 } });
  assert.equal(measured.value, 994239000);
  assert.equal(measured.measured, true);
  assert.equal(measured.reason, null);

  const absent = readControlPointCostNormalizer({ metadata: {} });
  assert.equal(absent.value, COST_FORMULA.gdpNormalizerFallback);
  assert.equal(absent.measured, false);
  assert.match(absent.reason, /no campaign GDP normalizer/);

  // And it moves the number: dividing by 994,239,000 rather than 1e9 raises the
  // cost by 0.35%, which is 3 points on the Protectorate's 875.
  const snapshot = {
    metadata: { controlPointCostGdpNormalizer: 994239000 },
    nations: [nation(1, 'Aland', 1000, [{ id: 'a', factionId: 1 }])]
  };
  const normalized = buildControlPointMaintenance(snapshot, { factionId: 1 }).cost;
  const unnormalized = Math.pow(1000, 0.6) / 2;
  assert.ok(normalized > unnormalized, 'a normalizer below 1e9 must raise the cost');
  assert.ok(normalized / unnormalized > 1.003 && normalized / unnormalized < 1.004);
});

test('an abandoned control point is free, and a crackdown-only one is charged and counted', () => {
  // `TIControlPoint::get_CurrentMaintenanceCost` tests `benefitsDisabled` and
  // NOTHING else, and `SetCrackdownExpiry` writes no such flag. The wiki says a
  // crackdown makes a control point free; the 1.0.51 code path does not, so the
  // disagreement is counted rather than resolved by preference.
  const snapshot = {
    metadata: { controlPointCostGdpNormalizer: 1e9 },
    nations: [nation(1, 'Aland', 1000, [
      { id: 'a', factionId: 1 },
      { id: 'b', factionId: 1, crackdown: true },
      { id: 'c', factionId: 1, benefitsDisabled: true },
      { id: 'd', factionId: 1 }
    ])]
  };
  const cost = buildControlPointMaintenance(snapshot, { factionId: 1 });
  assert.equal(cost.held, 4);
  assert.equal(cost.costFreeHeld, 1, 'only the abandoned holding is free');
  assert.equal(cost.nations[0].paying, 3);
  assert.equal(cost.crackdownChargedCount, 1);
  assert.deepEqual(cost.nations[0].costFreeReasons.map(r => r.reason), ['benefitsDisabled -- abandoned']);
});

test('an alien nation\'s control points cost nothing', () => {
  // `get_ControlPointMaintenanceCost` returns 0 outright for an alien nation.
  const snapshot = {
    metadata: { controlPointCostGdpNormalizer: 1e9 },
    nations: [nation(1, 'Alienland', 1000, [{ id: 'a', factionId: 1 }], { alienNation: true })]
  };
  const cost = buildControlPointMaintenance(snapshot, { factionId: 1 });
  assert.equal(cost.cost, 0);
  assert.equal(cost.costFreeHeld, 1);
  assert.match(cost.nations[0].costFreeReasons[0].reason, /alien nation/);
});

test('a nation with no readable GDP is unpriced and named, never priced at zero', () => {
  const snapshot = {
    metadata: { controlPointCostGdpNormalizer: 1e9 },
    nations: [
      nation(1, 'Aland', 1000, [{ id: 'a', factionId: 1 }]),
      { ID: 2, displayName: 'Bland', GDP: null, controlPointCount: 1, controlPoints: [{ id: 'b', factionId: 1 }] }
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
  assert.equal(priced.cost, Number(((Math.pow(1000, 0.6) / 2) / 2).toFixed(5)));

  const unpriced = marginalControlPointCost({ ID: 2, displayName: 'Bland', GDP: null, controlPoints: [{ id: 'b' }] });
  assert.equal(unpriced.available, false);
  assert.equal(unpriced.cost, null);
  assert.match(unpriced.reason, /GDP/);
});

// ---------------------------------------------------------------------------
// The headroom, and the two bases it can come from.
// ---------------------------------------------------------------------------

const withRecording = (snapshot, { penaltyToday, penaltyAveraged = penaltyToday, samples = 32 }) => {
  const faction = snapshot.factions[0];
  faction.controlPointCapPenaltyToday = penaltyToday;
  faction.controlPointCapPenaltyAveraged = penaltyAveraged;
  faction.recordedControlPointCapOverage = penaltyToday === null
    ? null
    : penaltyToday / CONTROL_POINT_OVERAGE_PENALTY_MULTIPLIER;
  faction.recordedControlPointCapOverageSamples = samples;
  return snapshot;
};

test('a recorded positive penalty gives an EXACT over-cap position with no composed cap', () => {
  // The save stores the float32 product, so the penalty is built the way the
  // game builds it and the overage is recovered by the same division.
  const storedPenalty = 12 * CONTROL_POINT_OVERAGE_PENALTY_MULTIPLIER;
  const snapshot = withRecording(syntheticSnapshot({
    councilorsCount: 1, effects: [], councilors: [councilor('Ada', 10, 4, 2)]
  }), { penaltyToday: storedPenalty });
  snapshot.nations = [nation(1, 'Aland', 10, [{ id: 'a', factionId: 1 }])];

  const report = buildControlPointCapReport(snapshot, { factionId: 1 });
  assert.equal(report.headroom.available, true);
  assert.equal(report.headroom.basis, 'recorded');
  assert.equal(report.headroom.overCap, true);
  // Twelve over, from a stored penalty of four.
  assert.equal(report.headroom.value, -12);
  assert.equal(report.recorded.overage, 12);
  assert.equal(report.recorded.penaltyToday, storedPenalty);
  assert.equal(report.verdict, 'over-cap');
  // Reading the stored number as the overage would say four.
  assert.ok(Math.abs(report.headroom.value + 4) > 1, 'the stored penalty is not the overage');
});

test('a recorded zero plus a complete composition gives a composed headroom with its accuracy', () => {
  const snapshot = withRecording(syntheticSnapshot({
    councilorsCount: 1, effects: [], councilors: [councilor('Ada', 10, 4, 2)]
  }), { penaltyToday: 0 });
  snapshot.nations = [nation(1, 'Aland', 10, [{ id: 'a', factionId: 1 }])];

  const report = buildControlPointCapReport(snapshot, { factionId: 1 });
  assert.equal(report.capacity.cap, 416);
  assert.equal(report.headroom.available, true);
  assert.equal(report.headroom.basis, 'composed');
  assert.equal(report.headroom.overCap, false);
  assert.equal(report.headroom.value, Number((416 - report.maintenance.cost).toFixed(5)));
  assert.equal(report.verdict, 'within-cap');
  // The measured residual travels with the figure rather than being corrected
  // out of it -- subtracting a measured bias would be a fit.
  assert.equal(report.headroom.accuracy, CONTROL_POINT_CAP_ACCURACY);
  assert.ok(CONTROL_POINT_CAP_ACCURACY.residualPoints.max <= 1);
});

test('a composed headroom that contradicts a recorded zero is refused, not reported', () => {
  // The recording is floored at zero, so a zero means at or under cap. A
  // composition that puts the faction over cap anyway cannot both be true.
  const snapshot = withRecording(syntheticSnapshot({
    councilorsCount: 1, effects: [], councilors: [councilor('Ada', 1, 1, 1)]
  }), { penaltyToday: 0 });
  snapshot.nations = [nation(1, 'Aland', 900000, [{ id: 'a', factionId: 1 }])];

  const report = buildControlPointCapReport(snapshot, { factionId: 1 });
  assert.ok(report.maintenance.cost > report.capacity.cap, 'the composition must put this faction over cap');
  assert.equal(report.headroom.available, false);
  assert.equal(report.headroom.value, null);
  assert.match(report.headroom.reason, /contradicts the game's own record/);
  assert.equal(report.verdict, 'unknown');
});

test('an unmeasured GDP normalizer blocks the composed verdict but not the recorded one', () => {
  const composed = withRecording(syntheticSnapshot({
    councilorsCount: 1, effects: [], councilors: [councilor('Ada', 10, 4, 2), councilor('Ada', 10, 4, 2)]
  }), { penaltyToday: 0 });
  composed.factions[0].councilorsCount = 2;
  composed.metadata.controlPointCostGdpNormalizer = null;
  composed.nations = [nation(1, 'Aland', 10, [{ id: 'a', factionId: 1 }])];
  const blocked = buildControlPointCapReport(composed, { factionId: 1 });
  assert.equal(blocked.headroom.available, false);
  assert.match(blocked.headroom.reason, /no campaign GDP normalizer/);

  // The recorded basis does not use the cost at all, so it still answers.
  const recorded = withRecording(syntheticSnapshot({
    councilorsCount: 1, effects: [], councilors: [councilor('Ada', 10, 4, 2)]
  }), { penaltyToday: 4 });
  recorded.metadata.controlPointCostGdpNormalizer = null;
  recorded.nations = [nation(1, 'Aland', 10, [{ id: 'a', factionId: 1 }])];
  const still = buildControlPointCapReport(recorded, { factionId: 1 });
  assert.equal(still.headroom.available, true);
  assert.equal(still.headroom.basis, 'recorded');
});

test('an unreadable cap term refuses the headroom rather than reporting the visible part', () => {
  const snapshot = withRecording(syntheticSnapshot({
    councilorsCount: 6, councilors: [councilor('Ada', 10, 4, 2)]
  }), { penaltyToday: 0 });
  snapshot.nations = [nation(1, 'Aland', 10, [{ id: 'a', factionId: 1 }])];
  const report = buildControlPointCapReport(snapshot, { factionId: 1 });
  assert.equal(report.headroom.available, false);
  assert.equal(report.headroom.value, null);
  assert.equal(report.verdict, 'unknown');
});

test('the alien faction is exempt, with a hard-coded cap and no Influence penalty', () => {
  // `GetControlPointMaintenanceFreebieCap` returns 20000f and
  // `GetAnnualControlPointMaintenanceCost` returns 0 for the alien faction, so
  // its recorded 0 is an exemption rather than a position. The Mission Control
  // sibling shows the same thing empirically: the Aliens read 0 while 10 over.
  const snapshot = withRecording(syntheticSnapshot({ councilorsCount: 0, effects: [] }), { penaltyToday: 0 });
  snapshot.factions[0].ID = ALIENS;
  snapshot.nations = [nation(1, 'Aland', 1000, [{ id: 'a', factionId: ALIENS }])];
  const report = buildControlPointCapReport(snapshot, { factionId: ALIENS });
  assert.equal(report.isAlienFaction, true);
  assert.equal(report.capacity.cap, ALIEN_FACTION_CONTROL_POINT_CAP);
  assert.equal(report.capacity.capBasis, 'hard-coded alien exemption');
  assert.equal(report.maintenance.cost, 0);
  assert.equal(report.penalties.influencePerYearFromRecorded, 0);
  assert.equal(report.headroom.basis, 'alien exemption');
});

// ---------------------------------------------------------------------------
// The live save: does the composition match the game's own record?
// ---------------------------------------------------------------------------

test('the composed cap reconciles against the game\'s own record', () => {
  // The Protectorate is the only faction over cap on any measured save, so it
  // is the only one whose cap the recording pins.
  //
  // THIS IS THE TEST THAT CATCHES BOTH EARLIER MISREADINGS. On ExitSave.gz the
  // composed cap is 842 and:
  //   slot 0, times three   -> implied cap 841.17, residual 0.83   (correct)
  //   slot 31, times three  -> implied cap 845.44, residual 3.44   (stale slot)
  //   slot 0, times one     -> implied cap 864.06, residual 22.1   (raw penalty)
  const snapshot = loadFilteredSnapshot({ mode: 'omniscient', observer: OBSERVER });
  const report = buildControlPointCapReport(snapshot, { factionId: PROTECTORATE, mode: 'omniscient' });

  assert.ok(report.recorded.available, 'the save should carry a recorded penalty for the Protectorate');
  assert.ok(report.recorded.overage > 0, 'the Protectorate is recorded over cap');
  assert.equal(report.recorded.semanticsVerified, true);
  assert.equal(
    report.recorded.overage,
    report.recorded.penaltyToday / CONTROL_POINT_OVERAGE_PENALTY_MULTIPLIER,
    'the overage is the stored penalty divided by the multiplier'
  );

  const impliedCap = report.maintenance.cost - report.recorded.overage;
  const residual = report.capacity.cap - impliedCap;
  assert.ok(
    Math.abs(residual) <= 1.5,
    `the composed cap (${report.capacity.cap}) should be within 1.5 of the cap the recording implies `
    + `(${impliedCap}); residual ${residual}`
  );
  assert.equal(report.reconciliation.reconciles, true);
  // And the composed cap runs HIGH, which is the direction the accuracy block
  // states. A residual that flipped sign would mean a different defect.
  assert.ok(residual > 0, `the composed cap should run high, not low; residual ${residual}`);
});

test('every faction the game records at or under cap is composed at or under cap', () => {
  // A one-sided check, but it is 8 factions wide and it is what the 150-point
  // base double-count would break: with the campaign knob summed in, the caps
  // were 150 too high and this passed vacuously.
  const snapshot = loadFilteredSnapshot({ mode: 'omniscient', observer: OBSERVER });
  let checked = 0;
  for (const faction of snapshot.factions) {
    const report = buildControlPointCapReport(snapshot, { factionId: faction.ID, mode: 'omniscient' });
    if (!report.recorded.available || report.recorded.overage !== 0) continue;
    if (!report.capacity.capAvailable || !report.maintenance.costComplete) continue;
    checked += 1;
    assert.ok(
      report.maintenance.cost <= report.capacity.cap,
      `${faction.displayName} is recorded within cap but modelled ${report.maintenance.cost} against ${report.capacity.cap}`
    );
  }
  assert.ok(checked >= 5, `expected several factions recorded within cap, checked ${checked}`);
});

test('the window mean is a different quantity from today\'s slot, and both are published', () => {
  // `GetAveragedControlPointCapPenaltyToMissions` averages the WHOLE array, and
  // that mean is what hostile missions actually receive -- the game's own
  // tooltip says the penalty "is averaged from how much we have been over the
  // cap during the last month".
  const snapshot = loadFilteredSnapshot({ mode: 'omniscient', observer: OBSERVER });
  const report = buildControlPointCapReport(snapshot, { factionId: PROTECTORATE, mode: 'omniscient' });
  assert.equal(typeof report.recorded.penaltyToday, 'number');
  assert.equal(typeof report.recorded.penaltyAveraged, 'number');
  assert.notEqual(report.recorded.penaltyToday, report.recorded.penaltyAveraged);
  assert.equal(report.penalties.missionExposureApplied, report.recorded.penaltyAveraged);
  assert.equal(report.recorded.windowDays, 32);
  // The Protectorate's overage has been rising all window, so today's slot is
  // above the mean. Reading the oldest slot as "today" would put it below.
  assert.ok(
    report.recorded.penaltyToday > report.recorded.penaltyAveraged,
    'slot 0 must be the newest sample'
  );
});

test('the observer has real headroom, and one more control point is affordable by two orders of magnitude', () => {
  const snapshot = loadFilteredSnapshot({ mode: 'omniscient', observer: OBSERVER });
  const report = buildControlPointCapReport(snapshot, { factionId: OBSERVER, mode: 'omniscient' });
  assert.equal(report.headroom.available, true);
  assert.equal(report.headroom.basis, 'composed');
  assert.ok(report.headroom.value > 100, `expected substantial headroom, got ${report.headroom.value}`);

  // The most expensive single control point on the board still fits many times
  // over, which is why no cost rule was added to the registry.
  const marginals = snapshot.nations
    .map(n => marginalControlPointCost(n).cost)
    .filter(c => typeof c === 'number');
  assert.ok(marginals.length > 0);
  assert.ok(
    report.headroom.value > Math.max(...marginals) * 2,
    'the observer\'s headroom should exceed the dearest control point several times over'
  );
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
  assert.equal(player.headroom.value, omniscient.headroom.value);
  assert.deepEqual(
    player.capacity.councilors.map(c => c.capContribution),
    omniscient.capacity.councilors.map(c => c.capContribution)
  );
});

test('a rival\'s cap is omniscient-only and refuses in player mode', () => {
  const player = loadFilteredSnapshot({ mode: 'player', observer: OBSERVER });
  for (const factionId of [PROTECTORATE, ALIENS]) {
    const report = buildControlPointCapReport(player, { factionId, mode: 'player' });
    assert.equal(report.recorded.overage, null, `faction ${factionId} must not leak its recorded overage`);
    assert.equal(report.recorded.penaltyToday, null, `faction ${factionId} must not leak its stored penalty`);
    if (factionId !== ALIENS) {
      assert.equal(report.capacity.capAvailable, false, `faction ${factionId} must not compose in player mode`);
      assert.equal(report.headroom.available, false, `faction ${factionId} must not publish headroom in player mode`);
    }
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
  // The stored penalty is exactly the overage over three, so BOTH have to go.
  const player = loadFilteredSnapshot({ mode: 'player', observer: OBSERVER });
  const omniscient = loadFilteredSnapshot({ mode: 'omniscient', observer: OBSERVER });

  const rivalValues = [];
  for (const f of omniscient.factions) {
    if (f.ID === OBSERVER) continue;
    for (const key of [
      'recordedControlPointCapOverage', 'controlPointCapPenaltyToday', 'controlPointCapPenaltyAveraged'
    ]) {
      const value = f[key];
      if (typeof value === 'number' && value !== 0) rivalValues.push(value);
    }
  }
  assert.ok(rivalValues.length > 0, 'at least one rival should have a non-zero recorded figure to hunt for');

  const serialised = JSON.stringify(player);
  for (const value of rivalValues) {
    assert.ok(
      !serialised.includes(String(value)),
      `the player payload leaks a rival's control-point cap telemetry (${value})`
    );
  }

  for (const faction of player.factions) {
    if (faction.ID === OBSERVER) continue;
    assert.equal(faction.recordedControlPointCapOverage, null, `${faction.ID} leaks recordedControlPointCapOverage`);
    assert.equal(faction.controlPointCapPenaltyToday, null, `${faction.ID} leaks controlPointCapPenaltyToday`);
    assert.equal(faction.controlPointCapPenaltyAveraged, null, `${faction.ID} leaks controlPointCapPenaltyAveraged`);
    assert.equal(faction.controlPointMaintenanceEffects, null, `${faction.ID} leaks controlPointMaintenanceEffects`);
  }
});

test('the player-mode redaction assertion covers every cap-input field', () => {
  // Injected individually, because a single combined check would still pass if
  // only one of the fields were dropped from the assertion.
  const intelligenceFilter = require('../server/intelligenceFilter');
  const base = () => loadFilteredSnapshot({ mode: 'player', observer: OBSERVER, bypassCache: true });
  assert.equal(intelligenceFilter.assertPlayerSnapshotSafe(base()), true);

  const withEffects = base();
  withEffects.factions.find(f => f.ID !== OBSERVER).controlPointMaintenanceEffects =
    ['Effect_ControlPointMaintenanceBonus160'];
  assert.throws(() => intelligenceFilter.assertPlayerSnapshotSafe(withEffects), /hidden faction telemetry/);

  for (const field of [
    'recordedControlPointCapOverage', 'controlPointCapPenaltyToday', 'controlPointCapPenaltyAveraged'
  ]) {
    const injected = base();
    injected.factions.find(f => f.ID !== OBSERVER)[field] = 11.44552;
    assert.throws(
      () => intelligenceFilter.assertPlayerSnapshotSafe(injected),
      /hidden faction telemetry/,
      `the assertion must cover ${field}`
    );
  }
});

// ---------------------------------------------------------------------------
// It reaches the AI surfaces.
// ---------------------------------------------------------------------------

test('the endpoint is a registry row, with a route and a discovery entry', () => {
  assert.ok(SUPPORTED_RESOURCES.has('control-point-cap'));
  assert.equal(INTEL_ENDPOINT_INDEX.controlPointCap, '/api/intel/control-point-cap');
});

test('the endpoint answers in both modes and states the recording semantics at the top', () => {
  for (const mode of ['player', 'omniscient']) {
    const res = queryIntel({
      endpoint: 'control-point-cap', mode, observer: OBSERVER, queryOptions: { factionId: OBSERVER }
    });
    assert.equal(res.count, 1);
    assert.equal(res.verdict, 'within-cap');
    assert.ok(res.items[0].capacity.capAvailable, `the observer's own cap should compose in ${mode} mode`);
    assert.equal(res.items[0].headroom.available, true);
    assert.ok(res.observerHeadroom > 0);
    assert.equal(res.observerHeadroomBasis, 'composed');
    // The semantics an agent reading this endpoint needs in order to interpret
    // the raw field for itself.
    assert.equal(res.recordingSemantics.windowDays, 32);
    assert.equal(res.recordingSemantics.overageMultiplier, CONTROL_POINT_OVERAGE_PENALTY_MULTIPLIER);
    assert.match(res.recordingSemantics.ordering, /newest first/);
  }
  const player = queryIntel({ endpoint: 'control-point-cap', mode: 'player', observer: OBSERVER });
  assert.ok(player.refusedCount > 0);
  assert.ok(player.refusedFactions.every(f => typeof f.reason === 'string' && f.reason.length > 0));

  const omniscient = queryIntel({ endpoint: 'control-point-cap', mode: 'omniscient', observer: OBSERVER });
  assert.ok(omniscient.overCapCount >= 1, 'omniscient mode should name the over-cap factions');
  const protectorate = omniscient.overCapFactions.find(f => f.factionId === PROTECTORATE);
  assert.ok(protectorate, 'the Protectorate should be listed as over cap');
  assert.equal(protectorate.influencePerYear, Number((protectorate.overage ** 2).toFixed(3)));
  // Player mode must not name a rival as over cap -- that is the same fact the
  // masked councilor attributes exist to withhold.
  assert.equal(player.overCapCount, 0);
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
    Number(((Math.pow(1000, 0.6) / 2) / 2).toFixed(5))
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

// ---------------------------------------------------------------------------
// The cost expression itself, shared with the directive engine.
// ---------------------------------------------------------------------------

test('nationControlPointCost is the one expression both callers use', () => {
  assert.equal(nationControlPointCost(1000), Math.pow(1000, COST_FORMULA.exponent) / COST_FORMULA.divisor);
  const target = nation(1, 'Aland', 1000, [{ id: 'a', factionId: null }, { id: 'b', factionId: 2 }]);
  const marginal = marginalControlPointCost(target);
  assert.equal(marginal.nationTotalCost, Number(nationControlPointCost(1000).toFixed(5)));
  assert.equal(marginal.cost, Number((nationControlPointCost(1000) / 2).toFixed(5)));
});

test('the normalizer argument defaults to the unscaled form the value rule relies on', () => {
  // `value/gdp-per-cp-cost` ranks nations against each other, so a common factor
  // cannot reorder it and it deliberately keeps the default. The cap model
  // passes the campaign's own normalizer, and the two differ.
  assert.equal(nationControlPointCost(1000), nationControlPointCost(1000, {}));
  assert.notEqual(
    nationControlPointCost(1000, { gdpNormalizerBillions: 0.994239 }),
    nationControlPointCost(1000)
  );
  // A normalizer that cannot be read is null, not a silent 1.
  assert.equal(nationControlPointCost(1000, { gdpNormalizerBillions: null }), null);
  assert.equal(nationControlPointCost(1000, { gdpNormalizerBillions: 0 }), null);
});

test('an unmeasured GDP prices a control point at null, never at 0', () => {
  // `Number(null) === 0` and `Number('') === 0`, and a nation costing 0 cp
  // reads as a free control point with an infinite value density.
  for (const absent of [null, undefined, '', 'n/a', NaN]) {
    assert.equal(nationControlPointCost(absent), null, `${JSON.stringify(absent)} should price as null`);
  }
  // Non-positive GDP is not a cheap nation either -- `0 ** 0.6` is 0, which
  // would divide by zero downstream.
  assert.equal(nationControlPointCost(0), null);
  assert.equal(nationControlPointCost(-5), null);
  // Strings that DO parse are still read, because the templates ship numerics
  // as strings.
  assert.equal(nationControlPointCost('1000'), nationControlPointCost(1000));
});
