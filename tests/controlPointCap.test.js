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
  RECORDED_POSITION,
  recordedCapPosition,
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
const { queryIntel } = require('../server/snapshotLoader');
const { loadFixtureFilteredSnapshot, queryFixtureIntel } = require('./fixtures/frozenSnapshots');

const OBSERVER = 4712;
const PROTECTORATE = 4714;
const ALIENS = 4717;
const RESISTANCE = 4710;
// The save uses `ID` (capital) and ids arrive as numbers here, but a filtered
// payload can carry either form, so identity is compared the way the rest of
// the repo does rather than with `===`.
const { sameId: sameFaction } = require('../shared/util.mjs');

function findRecordedOverCapFaction(snapshot, mode = 'omniscient') {
  for (const faction of snapshot.factions) {
    if (sameFaction(faction.ID, OBSERVER) || sameFaction(faction.ID, ALIENS)) continue;
    const report = buildControlPointCapReport(snapshot, { factionId: faction.ID, mode });
    if (report.recorded.available && report.recorded.overage > 0) {
      return {
        factionId: faction.ID,
        factionName: faction.displayName,
        report
      };
    }
  }
  return null;
}

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
  // The stated residual has to stay inside the tolerance the live-save
  // reconciliation test enforces, or the two claims disagree about the same
  // measurement.
  assert.ok(CONTROL_POINT_CAP_ACCURACY.residualPoints.max <= 1.5);
  assert.ok(CONTROL_POINT_CAP_ACCURACY.residualPoints.min > 0, 'the composed cap runs high, not low');
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
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'omniscient', observer: OBSERVER });
  const overCap = findRecordedOverCapFaction(snapshot);
  const factionId = overCap ? overCap.factionId : PROTECTORATE;
  const report = overCap ? overCap.report : buildControlPointCapReport(snapshot, { factionId: PROTECTORATE, mode: 'omniscient' });

  assert.ok(report.recorded.available, 'the save should carry a recorded penalty window');
  if (overCap) {
    assert.ok(report.recorded.overage > 0, 'the chosen faction is recorded over cap');
  } else {
    assert.equal(report.recorded.overage, 0, 'the fixture has no over-cap faction; use within-cap reconciliation');
  }
  assert.equal(report.recorded.semanticsVerified, true);
  assert.equal(
    report.recorded.overage,
    report.recorded.penaltyToday / CONTROL_POINT_OVERAGE_PENALTY_MULTIPLIER,
    'the overage is the stored penalty divided by the multiplier'
  );

  const impliedCap = report.maintenance.cost - report.recorded.overage;
  const residual = report.capacity.cap - impliedCap;
  if (overCap) {
    assert.ok(
      Math.abs(residual) <= 1.5,
      `the composed cap (${report.capacity.cap}) should be within 1.5 of the cap the recording implies `
      + `(${impliedCap}); residual ${residual}`
    );
    assert.equal(report.reconciliation.reconciles, true);
    assert.ok(residual > 0, `the composed cap should run high, not low; residual ${residual}`);
  } else {
    assert.equal(report.reconciliation.reconciles, true);
    assert.ok(report.capacity.cap >= report.maintenance.cost,
      'a within-cap faction should compose at or above its maintenance cost');
  }
});

test('every faction the game records at or under cap is composed at or under cap', () => {
  // A one-sided check, but it is 8 factions wide and it is what the 150-point
  // base double-count would break: with the campaign knob summed in, the caps
  // were 150 too high and this passed vacuously.
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'omniscient', observer: OBSERVER });
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
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'omniscient', observer: OBSERVER });
  const report = buildControlPointCapReport(snapshot, { factionId: PROTECTORATE, mode: 'omniscient' });
  assert.equal(typeof report.recorded.penaltyToday, 'number');
  assert.equal(typeof report.recorded.penaltyAveraged, 'number');
  assert.notEqual(report.recorded.penaltyToday, report.recorded.penaltyAveraged);
  assert.equal(report.penalties.missionExposureApplied, report.recorded.penaltyAveraged);
  assert.equal(report.recorded.windowDays, 32);
  if (report.recorded.overage > 0) {
    assert.ok(
      report.recorded.penaltyToday > report.recorded.penaltyAveraged,
      'when over cap is rising, slot 0 must be above the window mean'
    );
  }
});

test('the observer has real headroom, and one more control point is affordable by two orders of magnitude', () => {
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'omniscient', observer: OBSERVER });
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
    loadFixtureFilteredSnapshot({ mode: 'player', observer: OBSERVER }), { factionId: OBSERVER, mode: 'player' }
  );
  const omniscient = buildControlPointCapReport(
    loadFixtureFilteredSnapshot({ mode: 'omniscient', observer: OBSERVER }), { factionId: OBSERVER, mode: 'omniscient' }
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

// ---------------------------------------------------------------------------
// THE 2026-08-22 INTEL-MODEL DECISION.
//
// The dashboard's owner decided on 2026-08-22 that the faction control-point cap
// does not need to be locked behind omniscient. `7174764` refused a rival's cap
// in player mode on three grounds and redacted the game's own daily recording
// with it; `4f2f5b1` kept that. These tests were RETARGETED, not deleted: what
// they guarded did not go away, it moved. The `recorded` basis composes nothing
// and is now published in both modes; the `composed` basis still refuses for a
// rival, because its terms genuinely are masked.
// ---------------------------------------------------------------------------

test('the recording classifier tells a position from a floor from an exemption', () => {
  // The distinction the whole unlock rests on. A positive penalty LOCATES the
  // faction; a zero is `max(0, cost - cap)` bottoming out, which BOUNDS it; the
  // aliens' zero is an exemption artefact and does neither.
  assert.equal(recordedCapPosition(34.3365589766908), RECORDED_POSITION.position);
  assert.equal(recordedCapPosition(0), RECORDED_POSITION.boundOnly);
  assert.equal(recordedCapPosition(0, { alien: true }), RECORDED_POSITION.nothing);
  assert.equal(recordedCapPosition(34.34, { alien: true }), RECORDED_POSITION.nothing);
  // ABSENT STAYS NULL. `Number(null) === 0` would classify an unread faction as
  // bounded at or under cap, which is the reassuring-unknown defect exactly.
  for (const absent of [null, undefined, '', 'n/a', NaN]) {
    assert.equal(recordedCapPosition(absent), null, `${JSON.stringify(absent)} must classify as null`);
  }
});

test('a rival the game records OVER cap resolves in player mode, on the recorded basis', (t) => {
  const player = loadFixtureFilteredSnapshot({ mode: 'player', observer: OBSERVER });
  const omniscient = loadFixtureFilteredSnapshot({ mode: 'omniscient', observer: OBSERVER });
  const overCap = findRecordedOverCapFaction(omniscient);
  if (!overCap) {
    t.skip('fixture has no faction recorded over cap');
    return;
  }
  const p = buildControlPointCapReport(player, { factionId: overCap.factionId, mode: 'player' });
  const o = overCap.report;

  assert.equal(p.headroom.available, true);
  assert.equal(p.headroom.basis, 'recorded');
  assert.equal(p.headroom.overCap, true);
  assert.equal(p.verdict, 'over-cap');
  assert.equal(p.recorded.establishes, RECORDED_POSITION.position);
  // The SAME figure as omniscient, because it comes from the same raw field and
  // no composition is involved.
  assert.equal(p.headroom.value, o.headroom.value);
  assert.equal(p.recorded.overage, o.recorded.overage);
  assert.equal(p.penalties.influencePerYearFromRecorded, o.penalties.influencePerYearFromRecorded);
  // The exposure the game APPLIES is the window mean, not today's slot, and
  // both survive into player mode.
  assert.equal(p.penalties.missionExposureApplied, o.penalties.missionExposureApplied);
  assert.notEqual(p.penalties.missionExposureApplied, p.penalties.missionExposureToday);

  // AND THE LINE STILL HOLDS: the composed basis refuses, because its terms are
  // masked. Unlocking the verdict must not have unlocked the inputs.
  assert.equal(p.capacity.capAvailable, false, 'a rival must still not COMPOSE a cap in player mode');
  assert.deepEqual(p.capacity.unreadableTerms, ['councilors', 'habModules', 'effects']);
  assert.equal(p.capacity.councilorTotal, null);
  assert.ok(o.capacity.capAvailable, 'omniscient mode should still compose a rival cap');
});

test('a rival recorded at ZERO is unknown in player mode, never within-cap and never overCap:false', () => {
  // THE ONE TO GET RIGHT. Publishing the recording made `recorded.available`
  // true with a FLOORED ZERO. Left alone, the refusal branch's old
  // `overCap: recordedAvailable ? false : null` would have flipped every such
  // rival from an honest null to a confident "not over cap" as a side effect --
  // an unmeasurable state reported as a reassuring one.
  const player = loadFixtureFilteredSnapshot({ mode: 'player', observer: OBSERVER });
  const zeroRivals = player.factions.filter(f =>
    !sameFaction(f.ID, OBSERVER) && !sameFaction(f.ID, ALIENS) && Number(f.recordedControlPointCapOverage) === 0);
  assert.ok(zeroRivals.length > 0, 'the save should carry rivals the game records at zero');

  for (const f of zeroRivals) {
    const r = buildControlPointCapReport(player, { factionId: f.ID, mode: 'player' });
    assert.equal(r.recorded.available, true, `${f.displayName}: the recording itself is published`);
    assert.equal(r.recorded.overage, 0);
    assert.equal(r.recorded.establishes, RECORDED_POSITION.boundOnly, `${f.displayName}: a zero BOUNDS, not locates`);
    assert.equal(r.headroom.available, false, `${f.displayName}: a floored zero is not headroom`);
    assert.equal(r.headroom.value, null);
    assert.equal(r.headroom.basis, null);
    assert.equal(r.headroom.overCap, null, `${f.displayName}: overCap must be null, NOT false`);
    assert.notEqual(r.headroom.overCap, false);
    assert.equal(r.verdict, 'unknown', `${f.displayName}: not "within-cap"`);
    // The refusal must SAY the recording bounded it, rather than reading as
    // though nothing at all were known.
    assert.match(r.headroom.reason, /FLOOR of max\(0, cost - cap\)/);
  }
});

test('the composed basis still corroborates a recorded zero in omniscient', () => {
  // The other half of the same rule: where the composed terms ARE readable the
  // zero stops being the only evidence, and the position is located.
  const omniscient = loadFixtureFilteredSnapshot({ mode: 'omniscient', observer: OBSERVER });
  const r = buildControlPointCapReport(omniscient, { factionId: RESISTANCE, mode: 'omniscient' });
  assert.equal(r.recorded.establishes, RECORDED_POSITION.boundOnly);
  assert.equal(r.headroom.available, true);
  assert.equal(r.headroom.basis, 'composed');
  assert.equal(r.headroom.overCap, false);
  assert.equal(r.verdict, 'within-cap');
});

test('the recorded cap fields are published in player mode, and the composed inputs are not', () => {
  // Scanned across the WHOLE payload, not pinned to one field: four shipped
  // leaks had the derived field nulled while the raw one it came from survived.
  // Retargeted 2026-08-22 -- the point of the change is that SOME things become
  // visible, so this now asserts BOTH directions.
  const player = loadFixtureFilteredSnapshot({ mode: 'player', observer: OBSERVER });
  const omniscient = loadFixtureFilteredSnapshot({ mode: 'omniscient', observer: OBSERVER });

  // (a) DELIBERATELY PUBLISHED. Asserted positively so a future silent
  //     re-redaction fails a test instead of quietly narrowing the intel model.
  let publishedRecordings = 0;
  for (const o of omniscient.factions) {
    if (o.ID === OBSERVER) continue;
    const p = player.factions.find(f => f.ID === o.ID);
    assert.ok(p, `${o.ID} missing from the player payload`);
    for (const key of [
      'recordedControlPointCapOverage', 'controlPointCapPenaltyToday',
      'controlPointCapPenaltyAveraged', 'recordedControlPointCapOverageSamples'
    ]) {
      assert.equal(p[key], o[key], `${o.displayName}.${key} must be published in player mode (owner's call, 2026-08-22)`);
      if (typeof o[key] === 'number' && o[key] !== 0) publishedRecordings++;
    }
  }
  assert.ok(publishedRecordings > 0, 'at least one rival should carry a non-zero recording to have published');

  // (b) STILL WITHHELD -- the composed basis's three inputs, checked across the
  //     WHOLE payload rather than at the one field each is declared on.
  //
  //     STRUCTURALLY, NOT BY SUBSTRING, and that is a measurement not a
  //     preference: hunting the effect NAMES finds 68 hits in a clean player
  //     payload (measured 2026-08-22) -- the observer's own row and its
  //     `capabilities.activeEffects`, plus 64 in the static `techTree` node
  //     catalogue, which lists which projects GRANT each effect and says
  //     nothing about who holds one. The names are a shared vocabulary. What
  //     must not appear is a RIVAL-OWNED list, so that is what is asserted.
  const capEffectLists = [];
  (function walk(node, path) {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach((v, i) => walk(v, `${path}[${i}]`)); return; }
    if (Array.isArray(node.controlPointMaintenanceEffects)) {
      capEffectLists.push({ path, ownerId: node.ID ?? node.factionId ?? null });
    }
    for (const key of Object.keys(node)) walk(node[key], `${path}.${key}`);
  })(player, '$');
  for (const found of capEffectLists) {
    assert.ok(
      sameFaction(found.ownerId, OBSERVER),
      `${found.path} carries a cap-project list owned by ${found.ownerId}, not the observer`
    );
  }
  let rivalEffectHoldings = 0;
  for (const o of omniscient.factions) {
    if (o.ID === OBSERVER) continue;
    assert.equal(
      player.factions.find(f => f.ID === o.ID).controlPointMaintenanceEffects, null,
      `${o.displayName} leaks controlPointMaintenanceEffects`
    );
    rivalEffectHoldings += (o.controlPointMaintenanceEffects || []).length;
  }
  assert.ok(rivalEffectHoldings > 0, 'there should be rival cap projects to have withheld');
  // The observer's own list is NOT collateral damage of the redaction.
  assert.ok(
    Array.isArray(player.factions.find(f => f.ID === OBSERVER).controlPointMaintenanceEffects),
    'the observer\'s own cap projects must survive'
  );

  // A rival's resolved cap attributes are the largest composed term. Attribute
  // values are small integers that legitimately appear all over the payload, so
  // they too are checked structurally rather than by substring.
  for (const c of player.councilors || []) {
    if (sameFaction(c.factionId, OBSERVER) || c.isOwnCouncilor || c.isTurnedMole) continue;
    assert.ok(
      !c.attributes || Object.keys(c.attributes).length === 0,
      `${c.ID} leaks raw councilor attributes, which the composed cap reads`
    );
    for (const attribute of CAP_ATTRIBUTES) {
      assert.notEqual(
        c.resolvedAttributes?.baseMeasured?.[attribute], true,
        `${c.ID}.${attribute} reads as measured in player mode, so the composed cap would silently resolve`
      );
    }
  }
  // And a rival's hab modules, the third composed term.
  for (const m of player.habModules || []) {
    assert.ok(
      sameFaction(m.factionId, OBSERVER),
      `the player payload carries a rival hab module (${m.templateName}), which the composed cap reads`
    );
  }
});

test('the player-mode redaction assertion is retargeted, not merely loosened', () => {
  // Injected individually, because a single combined check would still pass if
  // only one of the fields were dropped from the assertion.
  const intelligenceFilter = require('../server/intelligenceFilter');
  const base = () => structuredClone(loadFixtureFilteredSnapshot({ mode: 'player', observer: OBSERVER }));
  assert.equal(intelligenceFilter.assertPlayerSnapshotSafe(base()), true);

  // STILL GUARDED: the composed basis's project term.
  const withEffects = base();
  withEffects.factions.find(f => f.ID !== OBSERVER).controlPointMaintenanceEffects =
    ['Effect_ControlPointMaintenanceBonus160'];
  assert.throws(() => intelligenceFilter.assertPlayerSnapshotSafe(withEffects), /hidden faction telemetry/);

  // STILL GUARDED: the councilor term, which is the one the game itself masks.
  const withAttributes = base();
  const rivalCouncilor = withAttributes.councilors.find(c => !c.isOwnCouncilor && !c.isTurnedMole);
  assert.ok(rivalCouncilor, 'the player payload should carry an observed rival councilor');
  rivalCouncilor.attributes = { Administration: 9, Persuasion: 8, Command: 7 };
  assert.throws(() => intelligenceFilter.assertPlayerSnapshotSafe(withAttributes), /hidden councilor telemetry/);

  // DELIBERATELY NOT GUARDED as of 2026-08-22: the four recorded fields. The
  // assertion must NOT throw on them -- if it does, the unlock has been undone.
  for (const field of [
    'recordedControlPointCapOverage', 'controlPointCapPenaltyToday',
    'controlPointCapPenaltyAveraged', 'recordedControlPointCapOverageSamples'
  ]) {
    const injected = base();
    injected.factions.find(f => f.ID !== OBSERVER)[field] = 11.44552;
    assert.equal(
      intelligenceFilter.assertPlayerSnapshotSafe(injected), true,
      `${field} is published by owner's decision and must not be asserted against`
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
    const res = queryFixtureIntel({
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
  const player = queryFixtureIntel({ endpoint: 'control-point-cap', mode: 'player', observer: OBSERVER });
  assert.ok(player.refusedCount > 0);
  assert.ok(player.refusedFactions.every(f => typeof f.reason === 'string' && f.reason.length > 0));

  const omniscient = queryFixtureIntel({ endpoint: 'control-point-cap', mode: 'omniscient', observer: OBSERVER });
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'omniscient', observer: OBSERVER });
  const overCap = findRecordedOverCapFaction(snapshot);
  if (overCap) {
    assert.ok(omniscient.overCapCount >= 1, 'omniscient mode should name the over-cap factions');
    const listed = omniscient.overCapFactions.find(f => f.factionId === overCap.factionId);
    assert.ok(listed, `${overCap.factionName} should be listed as over cap`);
    assert.equal(listed.influencePerYear, Number((listed.overage ** 2).toFixed(3)));
    assert.equal(player.overCapCount, omniscient.overCapCount, 'the recorded basis answers in both modes');
    const playerListed = player.overCapFactions.find(f => f.factionId === overCap.factionId);
    assert.ok(playerListed, `${overCap.factionName} should be named over cap in player mode too`);
    assert.equal(playerListed.overage, listed.overage);
    assert.equal(playerListed.influencePerYear, listed.influencePerYear);
  } else {
    assert.equal(player.overCapCount, 0);
    assert.equal(omniscient.overCapCount, 0);
  }

  // And the rivals the record only BOUNDS are counted separately, so a consumer
  // can tell "not recorded over cap, magnitude unknown" from "nothing known".
  assert.ok(player.boundOnlyCount > 0, 'player mode should report the bound-only rivals');
  assert.equal(omniscient.boundOnlyCount, 0, 'omniscient composes them, so none is left merely bounded');
  assert.ok(player.boundOnlyFactions.every(f => /FLOOR of max\(0, cost - cap\)/.test(f.reason)));
  // The semantics an agent needs to read a zero correctly, without this repo.
  assert.match(player.recordingSemantics.establishes[RECORDED_POSITION.boundOnly], /FLOOR/);
  assert.match(player.recordingSemantics.establishes[RECORDED_POSITION.position], /composes nothing/);
});

test('the war-room export carries the cap, in both modes', () => {
  // `4f2f5b1` shipped the whole model and put NONE of it in the AI exports, and
  // said so. A figure that exists only in the browser and the JSON is invisible
  // to every LLM reading /latest-war-room.md, which is half the point of this
  // project. Closed 2026-08-22.
  const { renderWarRoomMarkdown, WAR_ROOM_BYTE_BUDGET } = require('../shared/markdownExports.mjs');

  for (const mode of ['player', 'omniscient']) {
    const snapshot = loadFixtureFilteredSnapshot({ mode, observer: OBSERVER });
    const md = renderWarRoomMarkdown(snapshot, {});
    const report = buildControlPointCapReport(snapshot, { factionId: OBSERVER, mode });

    // The observer's own headroom, to the same 2 decimals the block renders.
    assert.match(md, /\*\*Our control-point cap:\*\*/);
    assert.ok(
      md.includes(`${report.headroom.value.toFixed(2)} points of room`),
      `${mode}: the export should carry the observer's own headroom (${report.headroom.value})`
    );
    // The accuracy caveat travels with a composed figure rather than being
    // dropped on the way to the export.
    assert.match(md, /composed cap was measured running ~1 point HIGH/);

    // The over-cap rival, which is a targeting fact: it is what makes a hostile
    // Purge against them cheaper. It rides on the RECORDED basis, so it must
    // appear in player mode too -- that is the 2026-08-22 unlock.
    const rival = buildControlPointCapReport(snapshot, { factionId: PROTECTORATE, mode });
    const overCap = findRecordedOverCapFaction(snapshot, mode);
    if (overCap) {
      assert.equal(rival.headroom.overCap, true, `${mode}: ${overCap.factionName} should read over cap`);
      assert.ok(
        md.includes(`${overCap.factionName} is ${overCap.report.recorded.overage.toFixed(2)} OVER their control-point cap`),
        `${mode}: the export should name the over-cap rival`
      );
      assert.ok(md.includes(`+${overCap.report.penalties.missionExposureApplied.toFixed(2)}`));
      assert.ok(md.includes(`not today's ${overCap.report.penalties.missionExposureToday.toFixed(2)}`));
    }

    assert.ok(
      Buffer.byteLength(md, 'utf8') <= WAR_ROOM_BYTE_BUDGET,
      `${mode}: the war room must stay inside its byte budget`
    );
  }

  // And the floored zero announces itself where it is the only evidence, rather
  // than the rivals simply going missing from the section.
  const playerMd = renderWarRoomMarkdown(loadFixtureFilteredSnapshot({ mode: 'player', observer: OBSERVER }), {});
  assert.match(playerMd, /record \*\*no\*\* cap penalty/);
  assert.match(playerMd, /bounds them at or under cap WITHOUT locating them/);
  assert.match(playerMd, /\*\*UNKNOWN\*\*, not large/);
});

test('a narrowed payload headlines the faction it is about, and names which one', (t) => {
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'omniscient', observer: OBSERVER });
  const overCap = findRecordedOverCapFaction(snapshot);
  if (!overCap) {
    t.skip('fixture has no faction recorded over cap');
    return;
  }
  const rival = queryFixtureIntel({
    endpoint: 'control-point-cap', mode: 'omniscient', observer: OBSERVER, queryOptions: { factionId: overCap.factionId }
  });
  assert.equal(rival.count, 1);
  assert.equal(rival.verdict, 'over-cap');
  assert.equal(rival.verdictFactionId, overCap.factionId);
  assert.equal(rival.verdictFactionName, overCap.factionName);
  // And it must not pass a rival's number off as the observer's.
  assert.equal(rival.observerHeadroom, null);
  assert.equal(rival.observerHeadroomBasis, null);

  // With everyone in the payload the headline is the observer's, named.
  const all = queryFixtureIntel({ endpoint: 'control-point-cap', mode: 'omniscient', observer: OBSERVER });
  assert.equal(all.verdictFactionId, OBSERVER);
  assert.equal(all.verdict, 'within-cap');
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
