// shared/controlPointCap.mjs
//
// Purpose: the control-point cap, maintenance cost and headroom, composed from
//   the game's own formula and reconciled against the game's own daily record —
//   which it now matches, so the headroom verdict is emitted rather than refused.
//
// ---------------------------------------------------------------------------
// WHAT `history_CPCapOverageByDay` ACTUALLY RECORDS — measured 2026-08-22
// ---------------------------------------------------------------------------
//
// Everything before this date treated that array as "the overage" and read the
// LAST slot as "the most recent". Both were wrong, and together they are why
// the cap refused to reconcile. From the shipped assembly
// (`TerraInvicta_Data/Managed/Assembly-CSharp.dll`, campaign version 1.0.51,
// IL read directly 2026-08-22):
//
//   TIFactionState::GetOneDayControlPointCapMissionPenalty()
//     float over = GetBaselineControlPointMaintenanceCost(false)
//                - GetControlPointMaintenanceFreebieCap();
//     return over > 0 ? over * global.TIMissionModifier_ControlPointOverage_Multiplier : 0f;
//
//   TIFactionState::GetAveragedControlPointCapPenaltyToMissions()
//     return history_CPCapOverageByDay.Average();
//
// and `TIMissionModifier_ControlPointOverage_Multiplier` is initialised to
// `0.3333333432674408f` in `TIGlobalConfig::.ctor`. So:
//
//   * each slot holds the MISSION-DEFENCE PENALTY, which is the overage / 3 —
//     not the overage;
//   * the array is a 32-day window, ONE SLOT PER IN-GAME DAY, NEWEST FIRST.
//     Slot 0 is today and slot 31 is 31 days ago. Proven independently of the
//     assembly by value alignment across four saves of one campaign: the series
//     for 12/1/2034, 12/16/2034 and 1/1/2035 are the same numbers shifted by
//     exactly 16, 15 and 31 slots for gaps of 15.5, 15.5 and 31 days — in this
//     array AND in `history_MCCapOverageByDay`;
//   * the value the game APPLIES to hostile missions is the mean of the whole
//     window, not today's slot. Its own tooltip says so: "This value is
//     averaged from how much we have been over the cap during the last month"
//     (`UI.GeneralControls.CPCapOverageCurrent`, shipped localization, read
//     2026-08-22);
//   * it is floored at 0, so a recorded 0 means "at or under cap" for a human
//     faction — a measurement, not a silence.
//
// THE MISSION CONTROL SIBLING CONFIRMS THE CONVENTION AND THE ALIEN EXEMPTION.
// `history_MCCapOverageByDay[0]` equals `max(0, missionControlUsage -
// cachedYearlyRevenue.MissionControl)` EXACTLY for all seven human factions on
// both `CombatAutosave.gz` and `ExitSave.gz` — the Servants read 3 at 374 usage
// against 371 capacity, everyone else reads 0 while under. The Aliens read 0
// while 10 and 11 over. That is an exemption, and the assembly says why:
// `GetControlPointMaintenanceFreebieCap()` returns a hard-coded `20000f` for
// the alien faction, and `GetAnnualControlPointMaintenanceCost()` returns 0.
//
// ---------------------------------------------------------------------------
// THE FORMULA, FROM THE GAME'S OWN CODE
// ---------------------------------------------------------------------------
//
//   TINationState::get_ControlPointMaintenanceCost      (per control point)
//     if (alienNation) return 0f;
//     return Mathd.Pow(GDP / TIGlobalValuesState.PCGDPToRaiseBaseCPMaintenanceCostBy1,
//                      globalConfig.controlPointCostScaling)
//            / (global.controlPointMaintenanceDivisor * numControlPoints)
//            * GameStateManager.Time.template.CPMaintenanceModifier;
//
//   TIControlPoint::get_CurrentMaintenanceCost
//     return benefitsDisabled ? 0f : BaselineMaintenanceCost;   // = nation.ControlPointMaintenanceCost
//
//   TIFactionState::GetControlPointMaintenanceFreebieCap
//     if (IsAlienFaction) return 20000f;
//     int b = GlobalValues.controlPointMaintenanceFreebies
//           + (isActivePlayer ? 0 : scenarioCustomizations.controlPointMaintenanceFreebieBonusAI)
//           + activeCouncilors.Sum(c => c.controlPointCapacity)
//           + habs.Sum(h => h.controlPointCapacityValue);
//     return b - TIEffectsState.SumEffectsModifiers(ControlPointMaintenance, this,
//                                                   GlobalValues.controlPointMaintenanceFreebies, null);
//
//   TIFactionState::AvailableCPCapSpace
//     return GetControlPointMaintenanceFreebieCap()
//          - controlPoints.Sum(cp => cp.CurrentMaintenanceCost);      // <- the headroom
//
//   TIFactionState::GetAnnualControlPointMaintenanceCost
//     if (IsAlienFaction) return 0f;
//     float over = cost - cap;
//     return over > 0 ? over * over : 0f;                             // <- quadratic, annual
//
// Constants, all read from `TIGlobalConfig::.ctor` (IL, 2026-08-22):
//   controlPointCostScaling                        0.6f
//   controlPointMaintenanceDivisor                 2f
//   TIMissionModifier_ControlPointOverage_Multiplier  0.3333333432674408f
// and `CPMaintenanceModifier` is 1f in `TIStartTimeTemplate::.ctor` and is
// overridden by none of the five shipped start times.
//
// THREE CORRECTIONS THIS FORCES ON THE PREVIOUS MODEL:
//
//  1. THE BASE CAP IS `controlPointMaintenanceFreebies` ALONE. The campaign
//     setting `controlPointMaintenanceFreebieBonus` is the Customize Campaign
//     knob that produced that stored value; the cap method never reads it.
//     Adding it double-counted 150 points on a cap of 841. Only
//     `controlPointMaintenanceFreebieBonusAI` is added, and only for factions
//     the human is not playing.
//
//  2. THE GDP DIVISOR IS NOT 1e9. It is
//     `fixedPCGDPToRaiseBaseCPMaintenanceCostBy1`, which the game freezes at
//     campaign start as `globalGDP_CampaignStart * 6.26e-6` (994,239,000 on
//     this campaign) and returns as a flat 1e9 only when the start-time
//     template's `scaleCPMaintenanceWithStartingGDP` is false.
//
//  3. ONLY `benefitsDisabled` MAKES A CONTROL POINT FREE. `CurrentMaintenanceCost`
//     tests that flag and nothing else; `SetCrackdownExpiry` writes no such
//     flag. The wiki's "control points that have sustained a Crackdown ... do
//     not cost any cp" is therefore NOT reproduced by the 1.0.51 code path, so
//     crackdown-only holdings are charged here and counted separately under
//     `crackdownChargedCount` rather than being silently forgiven.
//
// ---------------------------------------------------------------------------
// HOW WELL IT RECONCILES, AND WHERE THE RESIDUAL IS
// ---------------------------------------------------------------------------
//
// The Protectorate is the only faction over cap on any measured save, so it is
// the only faction whose cap the recording pins. Cap implied by the recording,
// `cost - 3 * history_CPCapOverageByDay[0]`, against the composed cap:
//
//   save                          implied cap   composed cap   residual
//   CombatAutosave.gz 7/15/2034      838.99995         840        +1.00
//   Autosave3.gz      12/1/2034      841.11891         842        +0.88
//   Autosave2.gz      12/16/2034     841.23226         842        +0.77
//   ExitSave.gz       1/1/2035       841.16678         842        +0.83
//
// The implied cap is 839.00000 to five decimals on the first save, so the cost
// formula is exact. The true cap is an INTEGER (every term is), which makes it
// 839 then 841, and the composed cap is +1 in every window. That +1 is the
// councilor term: this repo's `resolvedAttributes.effective` clamps at 25 and
// the game's `GetAttribute(..., clamp)` call for cap purposes handles its
// ceiling differently. The residual does NOT grow — it was 1.00 in July and
// 0.83 six months later — and it is 0.12% of the cap.
//
// So `headroom.available` is now TRUE when every term is measured, and the
// stated accuracy travels with it. Two guards keep that honest:
//
//   * when the game records a POSITIVE penalty the headroom is taken from the
//     recording (`-3 * penalty`), which is exact and needs no composed cap;
//   * when the game records ZERO the faction is at or under cap by
//     construction, so a composed headroom that comes out NEGATIVE is a
//     contradiction — it is reported as one and the verdict is refused.
//
// Keep this file free of runtime-specific imports so the hosted worker can use
// it alongside the local server.

import { asArray, round, sameId, toFiniteNumber as num } from './util.mjs';
import { ALIEN_FACTION_ID } from './constants.mjs';

/** Every mechanic claim in this module was read on this date. */
export const CONTROL_POINT_CAP_MEASURED_ON = '2026-08-22';

/**
 * `TIGlobalConfig.TIMissionModifier_ControlPointOverage_Multiplier`, verbatim.
 *
 * The float32 literal, not `1/3`: the game stores 0.3333333432674408 and the
 * recorded penalty is that number times the overage, so dividing by the exact
 * literal recovers the overage to the last bit the save carries.
 */
export const CONTROL_POINT_OVERAGE_PENALTY_MULTIPLIER = 0.3333333432674408;

/** `GetControlPointMaintenanceFreebieCap()` returns this for the alien faction. */
export const ALIEN_FACTION_CONTROL_POINT_CAP = 20000;

/** The window `history_CPCapOverageByDay` covers, in in-game days. */
export const CONTROL_POINT_CAP_PENALTY_WINDOW_DAYS = 32;

/** The sources behind each term, so a reader can check the claim not the code. */
export const CONTROL_POINT_CAP_SOURCES = Object.freeze({
  recording: Object.freeze({
    claim: 'history_CPCapOverageByDay holds one slot per in-game day, newest first, each holding '
      + 'max(0, cost - cap) * 0.3333333432674408 -- the mission-defence penalty, not the overage. The penalty the '
      + 'game applies is the mean of the whole 32-day window.',
    source: 'Assembly-CSharp.dll 1.0.51: TIFactionState::GetOneDayControlPointCapMissionPenalty, '
      + '::GetAveragedControlPointCapPenaltyToMissions, TIGlobalConfig::.ctor; corroborated by '
      + 'UI.GeneralControls.CPCapOverageCurrent and by slot alignment across four saves',
    form: 'shipped assembly IL, shipped localization, and save-to-save measurement',
    readOn: '2026-08-22'
  }),
  base: Object.freeze({
    claim: 'The base cap is TIGlobalValuesState.controlPointMaintenanceFreebies alone, plus the AI-only campaign '
      + 'bonus for factions the human is not playing. The controlPointMaintenanceFreebieBonus campaign setting is '
      + 'the knob that produced the stored value and is NOT added again.',
    source: 'Assembly-CSharp.dll 1.0.51: TIFactionState::GetControlPointMaintenanceFreebieCap',
    form: 'shipped assembly IL',
    readOn: '2026-08-22',
    saveFields: Object.freeze([
      'TIGlobalValuesState.controlPointMaintenanceFreebies',
      'TIMetadataState.controlPointMaintenanceFreebieBonusAI'
    ])
  }),
  councilors: Object.freeze({
    claim: 'Every point of Administration, Command or Persuasion on an active councilor adds 1 cp cap; '
      + 'TICouncilorState.controlPointCapacity is exactly those three attributes summed, and `active` means '
      + 'status Active and not detained.',
    source: 'Assembly-CSharp.dll 1.0.51: TICouncilorState::get_controlPointCapacity, ::get_active; '
      + 'wiki Control_Point_Capacity; UI.Nations.CPMaint10/11/12',
    form: 'shipped assembly IL, raw wikitext and shipped localization',
    readOn: '2026-08-22'
  }),
  orgsAndTraits: Object.freeze({
    claim: 'Orgs and traits add no cp cap directly; they only raise councilor attributes, and the cap reads the '
      + 'resolved attribute.',
    source: 'wiki Control_Point_Capacity, sections Orgs and Traits; GetAttribute(orgs:true, traits:true)',
    form: 'raw wikitext and shipped assembly IL',
    readOn: '2026-08-22'
  }),
  habModules: Object.freeze({
    claim: 'Administration Node / Tower / Complex carry controlPointCapacity 4 / 12 / 30, summed per hab as '
      + 'TIHabState.controlPointCapacityValue.',
    source: 'TIHabModuleTemplate.json (3 of 156 modules); UI.Nations.CPMaint13 "Bonus from Habs"',
    form: 'shipped template and shipped localization',
    readOn: '2026-08-22'
  }),
  projects: Object.freeze({
    claim: 'A completed ControlPointMaintenance effect raises the cap by the absolute value of its (negative) value; '
      + 'the cap method SUBTRACTS the effect total.',
    source: 'Assembly-CSharp.dll 1.0.51: GetControlPointMaintenanceFreebieCap subtracts '
      + 'TIEffectsState::SumEffectsModifiers; TIEffectTemplate.json showTotal:"Invert"',
    form: 'shipped assembly IL and shipped template',
    readOn: '2026-08-22'
  }),
  cost: Object.freeze({
    claim: 'A control point costs Pow(nation GDP / campaign GDP normalizer, 0.6) / (2 * nation control-point count); '
      + 'alien nations cost nothing and a benefitsDisabled control point costs nothing.',
    source: 'Assembly-CSharp.dll 1.0.51: TINationState::get_ControlPointMaintenanceCost, '
      + 'TIControlPoint::get_CurrentMaintenanceCost, TIGlobalConfig::.ctor; wiki Nations "Cost of Control Points"',
    form: 'shipped assembly IL and raw wikitext',
    readOn: '2026-08-22'
  }),
  penalty: Object.freeze({
    claim: 'Over cap: annual Influence income falls by overage squared, and Crackdown / Purge / Enthrall Elites / '
      + 'Dominate Nation against the faction gain a bonus attack modifier of the 32-day mean of overage / 3.',
    source: 'Assembly-CSharp.dll 1.0.51: TIFactionState::GetAnnualControlPointMaintenanceCost (over * over) and '
      + '::GetAveragedControlPointCapPenaltyToMissions; TIMissionModifier_InsufficientCPMaintenance_Defender',
    form: 'shipped assembly IL and shipped template',
    readOn: '2026-08-22'
  }),
  alienExemption: Object.freeze({
    claim: 'The alien faction has a hard-coded cap of 20000 and pays no over-cap Influence, so its recorded 0 is an '
      + 'exemption rather than a position.',
    source: 'Assembly-CSharp.dll 1.0.51: GetControlPointMaintenanceFreebieCap and '
      + 'GetAnnualControlPointMaintenanceCost both branch on IsAlienFaction',
    form: 'shipped assembly IL',
    readOn: '2026-08-22'
  })
});

/**
 * How far the composed cap sits from the cap the game's own record implies.
 *
 * Reported beside every headroom figure rather than corrected out of it.
 * Subtracting a measured bias would be a fit; naming it is a measurement.
 */
export const CONTROL_POINT_CAP_ACCURACY = Object.freeze({
  reconciles: true,
  residualPoints: Object.freeze({ min: 0.77, max: 1.0 }),
  direction: 'the composed cap runs HIGH, so a composed headroom is slightly optimistic',
  basis: 'the Protectorate is the only faction over cap on any measured save, so it is the only faction whose cap '
    + 'the recording pins. Cap implied by (cost - 3 x penalty) against the composed cap: 838.99995 vs 840 on '
    + 'CombatAutosave.gz 7/15/2034, 841.11891 vs 842 on Autosave3.gz 12/1/2034, 841.23226 vs 842 on Autosave2.gz '
    + '12/16/2034, 841.16678 vs 842 on ExitSave.gz 1/1/2035. The implied cap is an integer to five decimals on the '
    + 'first, so the cost formula is exact and the residual is entirely in the cap.',
  unmodelledTerm: 'the councilor term. This repo resolves attributes with a clamp at 25; the game\'s '
    + 'GetAttribute call for cap purposes raises its own ceiling by each negative bonus instead, which is one '
    + 'point apart on this roster. The residual did not grow across six in-game months.',
  measuredOn: '2026-08-22'
});

/**
 * The cost formula's constants, named rather than inlined so the citation
 * travels with the numbers.
 */
export const COST_FORMULA = Object.freeze({
  expression: 'Pow(nation GDP / campaign GDP normalizer, 0.6) / (2 x nation control-point count)',
  exponent: 0.6,
  divisor: 2,
  // `TIStartTimeTemplate::.ctor` sets this to 1 and none of the five shipped
  // start times overrides it, so it is a constant on every stock campaign. It
  // is named rather than dropped because a mod could change it.
  startTimeModifier: 1,
  gdpNormalizerField: 'TIGlobalValuesState.fixedPCGDPToRaiseBaseCPMaintenanceCostBy1',
  gdpNormalizerFallback: 1e9,
  source: CONTROL_POINT_CAP_SOURCES.cost
});

/**
 * The five `ControlPointMaintenance` effects and the cap each contributes.
 *
 * The stored `value` is negative and the cap method SUBTRACTS the effect total,
 * so `capContribution` is its negation. THE NAME DOES NOT MATCH THE VALUE --
 * `Bonus160` is -120 and `Bonus3` is -5 -- so nothing here parses the name.
 */
export const CONTROL_POINT_MAINTENANCE_EFFECTS = Object.freeze({
  Effect_ControlPointMaintenanceBonus160: Object.freeze({ value: -120, capContribution: 120 }),
  Effect_ControlPointMaintenanceBonus40: Object.freeze({ value: -40, capContribution: 40 }),
  Effect_ControlPointMaintenanceBonus20: Object.freeze({ value: -20, capContribution: 20 }),
  Effect_ControlPointMaintenanceBonus10: Object.freeze({ value: -10, capContribution: 10 }),
  Effect_ControlPointMaintenanceBonus3: Object.freeze({ value: -5, capContribution: 5 })
});

/** The three hab modules that carry a non-zero `controlPointCapacity`. */
export const ADMINISTRATION_HAB_MODULES = Object.freeze({
  AdministrationNode: 4,
  AdministrationTower: 12,
  AdministrationComplex: 30
});

/** The three councilor attributes that each add 1 cp cap per point. */
export const CAP_ATTRIBUTES = Object.freeze(['Administration', 'Persuasion', 'Command']);

/** The missions that gain the averaged overage/3 bonus attack against an over-cap faction. */
export const OVER_CAP_EXPOSED_MISSIONS = Object.freeze([
  'Crackdown', 'Purge', 'Enthrall Elites', 'Dominate Nation'
]);

const detained = (councilor) => String(councilor?.status || '').toLowerCase() === 'detained';

/** Whether a faction row is the alien faction, whose cap is hard-coded. */
export function isAlienFaction(faction, factionId) {
  return sameId(faction?.ID ?? factionId, ALIEN_FACTION_ID);
}

/**
 * Reads a councilor's cap contribution.
 *
 * Uses `resolvedAttributes.effective` -- base plus org plus trait -- because the
 * cap reads the resolved attribute. An enemy councilor in player mode carries
 * `maskedAttributes`, not `attributes`, so `resolvedAttributes.baseMeasured`
 * reads false on every attribute; that councilor's contribution is UNKNOWN and
 * is never scored as the zero `Number(null)` would produce.
 */
function councilorCapContribution(councilor) {
  const resolved = councilor?.resolvedAttributes || null;
  const isDetained = detained(councilor);
  const perAttribute = {};
  let subtotal = 0;
  let measured = true;

  for (const attribute of CAP_ATTRIBUTES) {
    const value = num(resolved?.effective?.[attribute]);
    const wasMeasured = resolved?.baseMeasured?.[attribute] === true;
    if (!wasMeasured || value === null) measured = false;
    perAttribute[attribute] = wasMeasured && value !== null ? value : null;
    if (wasMeasured && value !== null) subtotal += value;
  }

  return {
    councilorId: councilor?.ID ?? null,
    name: councilor?.displayName || 'Unknown councilor',
    status: councilor?.status || null,
    detained: isDetained,
    attributes: perAttribute,
    // `get_active` is `status == Active && !detained`, so a detained councilor
    // contributes nothing. Reported at zero WITH the reason rather than
    // dropped, so a reader can see the cap they are losing while held.
    capContribution: isDetained ? 0 : (measured ? subtotal : null),
    measured,
    reason: isDetained
      ? 'detained councilors contribute no control-point cap'
      : (measured ? null : 'this councilor\'s attributes are masked in this visibility mode')
  };
}

/**
 * The GDP normalizer the cost formula divides by.
 *
 * Present in the save means the campaign scales control-point maintenance with
 * its starting GDP and this is the frozen value. Absent is ambiguous -- an old
 * snapshot and a non-scaling campaign look identical from here -- so the
 * fallback is applied AND labelled, and `measured` gates the headroom verdict
 * rather than being smoothed over.
 */
export function readControlPointCostNormalizer(snapshot) {
  const stored = num(snapshot?.metadata?.controlPointCostGdpNormalizer);
  if (stored !== null && stored > 0) {
    return {
      value: stored,
      measured: true,
      field: COST_FORMULA.gdpNormalizerField,
      reason: null
    };
  }
  return {
    value: COST_FORMULA.gdpNormalizerFallback,
    measured: false,
    field: COST_FORMULA.gdpNormalizerField,
    reason: 'this snapshot carries no campaign GDP normalizer, so the flat 1e9 the game uses when a campaign does '
      + 'NOT scale control-point maintenance with starting GDP was applied. A scaling campaign published before '
      + 'this field existed reads the same way, so the cost is labelled unnormalized rather than trusted'
  };
}

/**
 * The base cap, from the save's own field.
 *
 * Returns `available: false` when the field could not be read. An unread base
 * is NOT zero and NOT "no limit": with no base the whole cap is unknown, which
 * is what `buildControlPointCap` then reports.
 */
export function readBaseControlPointCap(snapshot, { isObserverPlayerFaction = null } = {}) {
  const metadata = snapshot?.metadata || {};
  const settings = metadata.campaignSettings?.settings || {};

  const globalFreebies = num(metadata.controlPointMaintenanceFreebies);
  const settingBonusAI = num(settings.controlPointMaintenanceFreebieBonusAI?.value);

  const parts = [];
  if (globalFreebies !== null) {
    parts.push({
      label: 'base control-point capacity',
      field: 'TIGlobalValuesState.controlPointMaintenanceFreebies',
      value: globalFreebies
    });
  }
  // The AI sibling applies only to factions the human is not playing --
  // `isActivePlayer ? 0 : bonusAI` in the cap method. When we cannot tell which
  // faction the human plays, the term is left OUT and named, rather than
  // applied to everyone or to no one on a guess.
  if (settingBonusAI !== null && settingBonusAI !== 0 && isObserverPlayerFaction === false) {
    parts.push({
      label: 'base control-point capacity bonus (AI factions only)',
      field: 'TIMetadataState.controlPointMaintenanceFreebieBonusAI',
      value: settingBonusAI
    });
  }

  const unreadable = [];
  if (globalFreebies === null) {
    unreadable.push({
      field: 'TIGlobalValuesState.controlPointMaintenanceFreebies',
      reason: 'absent from this snapshot; re-publish after upgrading'
    });
  }
  if (settingBonusAI !== null && settingBonusAI !== 0 && isObserverPlayerFaction === null) {
    unreadable.push({
      field: 'TIMetadataState.controlPointMaintenanceFreebieBonusAI',
      reason: 'which faction the human plays could not be determined, so the AI-only bonus was not applied'
    });
  }

  const available = parts.length > 0 && unreadable.length === 0;
  return {
    available,
    total: available ? parts.reduce((sum, part) => sum + part.value, 0) : null,
    parts: Object.freeze(parts.map(Object.freeze)),
    unreadable: Object.freeze(unreadable.map(Object.freeze)),
    // The campaign setting that is deliberately NOT summed in, stated so a
    // reader who remembers the old model can see it was dropped on purpose.
    excludedSetting: Object.freeze({
      field: 'TIMetadataState.controlPointMaintenanceFreebieBonus',
      value: num(settings.controlPointMaintenanceFreebieBonus?.value),
      reason: 'the Customize Campaign knob that produced controlPointMaintenanceFreebies. '
        + 'GetControlPointMaintenanceFreebieCap never reads it; adding it double-counts the base.'
    })
  };
}

/**
 * Composes one faction's control-point cap from its named sources.
 *
 * @param {object} snapshot filtered or raw snapshot
 * @param {object} options
 * @param {number|string} options.factionId whose cap to compose
 * @returns {object} the composition; `cap` is null whenever any term is unread
 */
export function buildControlPointCap(snapshot, { factionId } = {}) {
  const faction = asArray(snapshot?.factions).find((f) => sameId(f?.ID, factionId)) || null;
  const playerFactionName = snapshot?.metadata?.playerFactionName ?? null;
  const isObserverPlayerFaction = typeof playerFactionName === 'string' && playerFactionName.trim() !== ''
    && faction && typeof faction.displayName === 'string'
    ? playerFactionName.trim().toLowerCase() === faction.displayName.trim().toLowerCase()
    : null;

  const alien = isAlienFaction(faction, factionId);
  const base = readBaseControlPointCap(snapshot, { isObserverPlayerFaction });

  const councilors = asArray(snapshot?.councilors)
    .filter((c) => sameId(c?.factionId, factionId))
    .map(councilorCapContribution);
  const councilorsUnmeasured = councilors.filter((c) => c.capContribution === null);

  // A ROSTER THAT IS SHORT IS NOT A ROSTER OF ZEROS. In player mode the
  // observer sees none of the Aliens' six councilors and only some of each
  // rival's, so summing the visible rows would report the Aliens' councilor
  // contribution as a confident 0 -- the single largest term in their cap,
  // silently deleted. `faction.councilorsCount` is the faction's own headcount
  // and survives redaction, so it is what completeness is checked against.
  //
  // An unreadable headcount makes completeness UNVERIFIABLE, which is treated
  // as incomplete. A check that cannot be evaluated must not fall through to
  // "fine".
  const rosterHeadcount = num(faction?.councilorsCount);
  const rosterComplete = rosterHeadcount === null
    ? null
    : councilors.length >= rosterHeadcount;
  const councilorTotal = (councilorsUnmeasured.length > 0 || rosterComplete !== true)
    ? null
    : councilors.reduce((sum, c) => sum + c.capContribution, 0);

  const factionModules = asArray(snapshot?.habModules).filter((m) => sameId(m?.factionId, factionId));
  const habModules = factionModules
    .filter((m) => ADMINISTRATION_HAB_MODULES[m?.templateName] !== undefined)
    .filter((m) => m?.constructionCompleted === true && m?.destroyed !== true)
    .map((m) => ({
      moduleId: m.id ?? null,
      templateName: m.templateName,
      name: m.name || m.templateName,
      habName: m.habName || null,
      capContribution: ADMINISTRATION_HAB_MODULES[m.templateName]
    }));

  // SAME TRAP AS THE ROSTER. Player mode publishes every faction's habs but
  // only the OBSERVER'S hab modules -- measured 2026-08-22: the Servants show
  // 50 habs and 0 modules in player mode, 50 and 574 in omniscient. Summing the
  // visible modules would report a rival's Administration Complexes as a
  // confident zero cap.
  const habsCount = num(faction?.habsCount);
  const habModulesComplete = habsCount === null
    ? null
    : (habsCount === 0 ? true : factionModules.length > 0);
  const habModuleTotal = habModulesComplete === true
    ? habModules.reduce((sum, m) => sum + m.capContribution, 0)
    : null;

  const effectNames = asArray(faction?.controlPointMaintenanceEffects);
  const effects = effectNames
    .map((name) => {
      const spec = CONTROL_POINT_MAINTENANCE_EFFECTS[name] || null;
      return spec
        ? { effect: name, storedValue: spec.value, capContribution: spec.capContribution, recognised: true }
        : { effect: name, storedValue: null, capContribution: null, recognised: false };
    });
  const unrecognisedEffects = effects.filter((e) => !e.recognised);
  // The list itself may be absent -- an older snapshot, or a rival redacted in
  // player mode. Absent is not an empty list: a faction with no recorded list
  // has an UNKNOWN project contribution, not a zero one.
  const effectsAvailable = Array.isArray(faction?.controlPointMaintenanceEffects);
  const effectTotal = (!effectsAvailable || unrecognisedEffects.length > 0)
    ? null
    : effects.reduce((sum, e) => sum + e.capContribution, 0);

  const terms = [
    { key: 'base', total: base.total, available: base.available },
    { key: 'councilors', total: councilorTotal, available: councilorTotal !== null },
    { key: 'habModules', total: habModuleTotal, available: habModuleTotal !== null },
    { key: 'effects', total: effectTotal, available: effectTotal !== null }
  ];
  const missing = terms.filter((t) => !t.available).map((t) => t.key);
  // The alien faction's cap is a hard-coded 20000 that no term composes, so it
  // is stated outright rather than assembled from four terms that do not apply.
  const cap = alien
    ? ALIEN_FACTION_CONTROL_POINT_CAP
    : (missing.length === 0 ? terms.reduce((sum, t) => sum + t.total, 0) : null);

  return {
    factionId: faction?.ID ?? factionId ?? null,
    factionName: faction?.displayName || null,
    isObserverPlayerFaction,
    isAlienFaction: alien,
    base,
    councilors: Object.freeze(councilors.map(Object.freeze)),
    councilorTotal,
    councilorsUnmeasuredCount: councilorsUnmeasured.length,
    councilorsVisible: councilors.length,
    councilorsHeadcount: rosterHeadcount,
    // true / false / null -- null is "the faction's own headcount could not be
    // read", which is not the same as a complete roster and is not treated as one.
    rosterComplete,
    councilorTotalReason: councilorTotal !== null
      ? null
      : (rosterComplete === false
        ? `only ${councilors.length} of this faction's ${rosterHeadcount} councilors are visible in this mode`
        : rosterComplete === null
          ? 'this faction carries no readable councilor headcount, so roster completeness cannot be verified'
          : `${councilorsUnmeasured.length} of ${councilors.length} councilors have masked attributes in this mode`),
    habModules: Object.freeze(habModules.map(Object.freeze)),
    habModuleTotal,
    habModuleCount: habModules.length,
    habModulesComplete,
    habModulesVisible: factionModules.length,
    habsCount,
    habModuleTotalReason: habModuleTotal !== null
      ? null
      : (habModulesComplete === false
        ? `this faction holds ${habsCount} hab(s) but no hab-module rows are visible in this mode`
        : 'this faction carries no readable hab count, so hab-module completeness cannot be verified'),
    effects: Object.freeze(effects.map(Object.freeze)),
    effectTotal,
    effectsAvailable,
    unrecognisedEffects: Object.freeze(unrecognisedEffects.map(Object.freeze)),
    cap,
    capAvailable: cap !== null,
    capBasis: alien ? 'hard-coded alien exemption' : 'composed',
    unreadableTerms: Object.freeze(alien ? [] : missing),
    capReason: cap !== null
      ? null
      : `the cap cannot be composed: ${missing.join(', ')} could not be read from this snapshot in this mode`,
    accuracy: CONTROL_POINT_CAP_ACCURACY,
    modelled: true,
    sources: CONTROL_POINT_CAP_SOURCES
  };
}

/**
 * The maintenance cost one faction is paying, per nation, from the game's own
 * per-control-point formula.
 *
 * A nation whose GDP or control-point count cannot be read is EXCLUDED and
 * named in `unpricedNations`, never priced at zero -- a zero-cost holding would
 * make an unaffordable position look free.
 */
export function buildControlPointMaintenance(snapshot, { factionId } = {}) {
  const normalizer = readControlPointCostNormalizer(snapshot);
  const nations = [];
  const unpriced = [];
  let held = 0;
  let freeHeld = 0;
  let crackdownCharged = 0;

  const alien = isAlienFaction(
    asArray(snapshot?.factions).find((f) => sameId(f?.ID, factionId)) || null,
    factionId
  );

  for (const nation of asArray(snapshot?.nations)) {
    const controlPoints = asArray(nation?.controlPoints);
    const mine = controlPoints.filter((cp) => sameId(cp?.factionId, factionId));
    if (mine.length === 0) continue;
    held += mine.length;

    // An alien nation's control points cost nothing at all.
    if (nation?.alienNation === true) {
      freeHeld += mine.length;
      nations.push({
        nationId: nation?.ID ?? null,
        nation: nation?.displayName || 'Unknown nation',
        gdpBillions: null,
        nationControlPoints: null,
        nationControlPointsSource: 'not priced',
        perControlPoint: 0,
        held: mine.length,
        costFree: mine.length,
        costFreeReasons: Object.freeze(mine.map(() => Object.freeze({
          controlPointType: null,
          reason: 'alien nation -- get_ControlPointMaintenanceCost returns 0'
        }))),
        paying: 0,
        subtotal: 0
      });
      continue;
    }

    const gdp = num(nation?.GDP);
    // `numControlPoints` is the game's own divisor and survives redaction; the
    // projected `controlPoints` list can be short in a filtered mode, and a
    // short divisor inflates every control point's cost.
    const savedCount = num(nation?.controlPointCount);
    const count = savedCount !== null && savedCount > 0 ? savedCount : (controlPoints.length || null);
    if (gdp === null || gdp <= 0 || count === null || count <= 0) {
      unpriced.push({
        nationId: nation?.ID ?? null,
        nation: nation?.displayName || 'Unknown nation',
        held: mine.length,
        reason: gdp === null || gdp <= 0
          ? 'the nation carries no readable GDP, so its control-point cost cannot be priced'
          : 'the nation carries no readable control-point count to divide its cost among'
      });
      continue;
    }

    const nationTotalCost = nationControlPointCost(gdp / 1e9, {
      gdpNormalizerBillions: normalizer.value / 1e9
    });
    const perControlPoint = nationTotalCost / count * COST_FORMULA.startTimeModifier;

    // `TIControlPoint::get_CurrentMaintenanceCost` tests `benefitsDisabled` and
    // nothing else. A crackdown does not set that flag on the 1.0.51 code path,
    // so a crackdown-only holding IS charged -- counted here so a reader can
    // see how far this departs from the wiki's claim that it is free.
    const free = mine.filter((cp) => cp?.benefitsDisabled === true);
    const crackdownOnly = mine.filter((cp) => cp?.crackdown === true && cp?.benefitsDisabled !== true);
    const paying = mine.length - free.length;
    freeHeld += free.length;
    crackdownCharged += crackdownOnly.length;

    nations.push({
      nationId: nation?.ID ?? null,
      nation: nation?.displayName || 'Unknown nation',
      gdpBillions: round(gdp / 1e9, 1),
      nationControlPoints: count,
      nationControlPointsSource: savedCount !== null && savedCount > 0
        ? 'TINationState.numControlPoints'
        : 'the projected control-point list, which can be short in a filtered mode',
      nationTotalCost: round(nationTotalCost, 5),
      perControlPoint: round(perControlPoint, 5),
      held: mine.length,
      costFree: free.length,
      costFreeReasons: Object.freeze(free.map((cp) => Object.freeze({
        controlPointType: cp?.controlPointType || null,
        reason: 'benefitsDisabled -- abandoned'
      }))),
      crackdownCharged: crackdownOnly.length,
      paying,
      subtotal: round(perControlPoint * paying, 5)
    });
  }

  nations.sort((a, b) => b.subtotal - a.subtotal);
  const cost = alien ? 0 : nations.reduce((sum, n) => sum + n.subtotal, 0);

  return {
    factionId: factionId ?? null,
    isAlienFaction: alien,
    nations: Object.freeze(nations.map(Object.freeze)),
    unpricedNations: Object.freeze(unpriced.map(Object.freeze)),
    held,
    costFreeHeld: freeHeld,
    // The wiki says crackdown-hit control points are free; the 1.0.51 code path
    // does not. This counts the holdings the two readings disagree about.
    crackdownChargedCount: crackdownCharged,
    crackdownChargedNote: 'TIControlPoint::get_CurrentMaintenanceCost tests benefitsDisabled only, so these are '
      + 'charged here even though the wiki says a crackdown makes a control point free',
    // A cost built while some holdings could not be priced is a FLOOR, not a
    // total, and says so rather than presenting a short number as complete.
    cost: round(cost, 5),
    costComplete: unpriced.length === 0,
    costIsFloor: unpriced.length > 0,
    gdpNormalizer: Object.freeze(normalizer),
    formula: COST_FORMULA,
    modelled: true
  };
}

/**
 * The quadratic Influence penalty for a given overage, per year.
 *
 * `GetAnnualControlPointMaintenanceCost` returns `over * over`. Returns null
 * for a null overage -- `Number(null) === 0` would render an unmeasured
 * position as a confident "no penalty".
 */
export function overCapInfluencePenalty(overage) {
  const value = num(overage);
  if (value === null) return null;
  if (value <= 0) return 0;
  return round(value * value, 3);
}

/**
 * The bonus attack modifier hostile missions gain from one day's overage.
 *
 * This is `GetOneDayControlPointCapMissionPenalty` -- the same quantity the
 * save stores. The modifier the game actually applies is the mean of 32 of
 * these, which is why `buildControlPointCapReport` publishes the recorded mean
 * separately rather than presenting today's figure as the exposure.
 */
export function overCapMissionExposure(overage) {
  const value = num(overage);
  if (value === null) return null;
  if (value <= 0) return 0;
  return round(value * CONTROL_POINT_OVERAGE_PENALTY_MULTIPLIER, 5);
}

/**
 * The full report: composition, cost, the game's own record, the reconciliation
 * between them, and the headroom.
 *
 * `headroom.available` is TRUE when the position can be established, which is
 * either of two ways and never a guess:
 *
 *   * `basis: 'recorded'` -- the save records a positive penalty, so the
 *     faction is over cap by exactly three times it. No composed cap involved.
 *   * `basis: 'composed'` -- every cap term and the whole cost were measured.
 *     `accuracy` states the measured residual, which runs about one point high.
 *
 * A composed headroom that comes out negative while the game records zero is a
 * CONTRADICTION -- the recording is floored at zero, so a zero means at or
 * under cap -- and it refuses rather than reporting the composition.
 */
export function buildControlPointCapReport(snapshot, { factionId, mode = 'player' } = {}) {
  const capacity = buildControlPointCap(snapshot, { factionId });
  const maintenance = buildControlPointMaintenance(snapshot, { factionId });
  const faction = asArray(snapshot?.factions).find((f) => sameId(f?.ID, factionId)) || null;
  const alien = capacity.isAlienFaction;

  const penaltyToday = num(faction?.controlPointCapPenaltyToday);
  const penaltyAveraged = num(faction?.controlPointCapPenaltyAveraged);
  const recordedOverage = num(faction?.recordedControlPointCapOverage);
  const recordedAvailable = recordedOverage !== null;

  const modelledOverage = capacity.cap !== null && maintenance.costComplete
    ? Math.max(0, round(maintenance.cost - capacity.cap, 5))
    : null;
  const modelledPenalty = modelledOverage === null
    ? null
    : round(modelledOverage * CONTROL_POINT_OVERAGE_PENALTY_MULTIPLIER, 5);

  const residual = modelledPenalty !== null && penaltyToday !== null
    ? round(modelledPenalty - penaltyToday, 5)
    : null;

  const composedHeadroom = capacity.cap !== null && maintenance.costComplete
    ? round(capacity.cap - maintenance.cost, 5)
    : null;

  let headroom;
  if (alien) {
    headroom = {
      available: true,
      value: composedHeadroom !== null
        ? composedHeadroom
        : round(ALIEN_FACTION_CONTROL_POINT_CAP - maintenance.cost, 5),
      basis: 'alien exemption',
      overCap: false,
      reason: 'the alien faction\'s cap is a hard-coded 20000 and it pays no over-cap Influence, so it is never '
        + 'meaningfully constrained by this mechanic',
      accuracy: null
    };
  } else if (recordedAvailable && recordedOverage > 0) {
    headroom = {
      available: true,
      value: round(-recordedOverage, 5),
      basis: 'recorded',
      overCap: true,
      reason: 'the save records a positive control-point cap penalty, so this faction is over cap by exactly three '
        + 'times it; no composed cap is involved in this figure',
      accuracy: null
    };
  } else if (composedHeadroom === null) {
    headroom = {
      available: false,
      value: null,
      basis: null,
      overCap: recordedAvailable ? false : null,
      reason: capacity.cap === null
        ? capacity.capReason
        : 'some of this faction\'s holdings could not be priced, so the maintenance cost is a floor rather than a '
          + 'total and the headroom would be overstated',
      accuracy: null
    };
  } else if (recordedAvailable && recordedOverage === 0 && composedHeadroom < 0) {
    headroom = {
      available: false,
      value: null,
      basis: null,
      overCap: false,
      reason: `the save records this faction at or under cap, but the composed cap (${capacity.cap}) is below the `
        + `modelled cost (${maintenance.cost}). The composition contradicts the game's own record, so no headroom `
        + 'figure is emitted',
      accuracy: CONTROL_POINT_CAP_ACCURACY
    };
  } else if (!maintenance.gdpNormalizer.measured) {
    headroom = {
      available: false,
      value: null,
      basis: null,
      overCap: recordedAvailable ? false : null,
      reason: maintenance.gdpNormalizer.reason,
      accuracy: CONTROL_POINT_CAP_ACCURACY
    };
  } else {
    headroom = {
      available: true,
      value: composedHeadroom,
      basis: 'composed',
      overCap: false,
      reason: recordedAvailable
        ? 'the save records this faction at or under cap, and every cap term and the whole maintenance cost were '
          + 'measured, so the remaining room is the composed difference'
        : 'every cap term and the whole maintenance cost were measured, but this snapshot carries no recorded '
          + 'penalty to corroborate the sign',
      accuracy: CONTROL_POINT_CAP_ACCURACY
    };
  }

  return {
    factionId: capacity.factionId,
    factionName: capacity.factionName,
    mode,
    isAlienFaction: alien,
    capacity,
    maintenance,
    recorded: {
      available: recordedAvailable,
      // The overage: today's stored penalty times three.
      overage: recordedOverage,
      // The stored numbers themselves, so a reader can check the arithmetic.
      penaltyToday,
      // What the game ACTUALLY applies to hostile missions: the window mean.
      penaltyAveraged,
      windowDays: num(faction?.recordedControlPointCapOverageSamples),
      field: 'TIFactionState.history_CPCapOverageByDay (slot 0 is today; one slot per in-game day, newest first)',
      semanticsVerified: true,
      semanticsNote: 'each slot is max(0, cost - cap) x 0.3333333432674408 -- the mission-defence penalty, not the '
        + 'overage. A recorded 0 means at or under cap for a human faction, and means nothing for the aliens, whose '
        + 'cap is a hard-coded 20000.',
      source: CONTROL_POINT_CAP_SOURCES.recording,
      reason: recordedAvailable
        ? null
        : 'this snapshot carries no recorded control-point cap penalty for this faction (older snapshot, or '
          + 'redacted for a rival in player mode)'
    },
    reconciliation: {
      modelledOverage,
      modelledPenalty,
      recordedPenalty: penaltyToday,
      residual,
      // The residual is in the composed cap, and it is stated rather than
      // corrected out. `reconciles` is about whether the two agree to within the
      // measured residual, not about whether they are bit-identical.
      reconciles: residual === null ? null : Math.abs(residual) <= 1,
      reason: residual === null
        ? 'the modelled penalty and the recorded penalty cannot both be read for this faction, so they cannot be compared'
        : `the modelled penalty (${modelledPenalty}) and the save's own recorded penalty (${penaltyToday}) differ `
          + `by ${residual}; see accuracy for where that residual sits`,
      accuracy: CONTROL_POINT_CAP_ACCURACY,
      measuredOn: CONTROL_POINT_CAP_MEASURED_ON
    },
    headroom,
    penalties: {
      // From the recording, because that is the game's own figure.
      influencePerYearFromRecorded: alien ? 0 : overCapInfluencePenalty(recordedOverage),
      // The modifier the game applies is the WINDOW MEAN, not today's slot.
      missionExposureApplied: alien ? 0 : penaltyAveraged,
      missionExposureToday: alien ? 0 : penaltyToday,
      influencePerYearFromModelled: alien ? 0 : overCapInfluencePenalty(modelledOverage),
      missionExposureFromModelled: alien ? 0 : modelledPenalty,
      exposedMissions: OVER_CAP_EXPOSED_MISSIONS,
      form: 'annual Influence income falls by overage^2; listed missions gain the 32-day mean of overage/3 as a '
        + 'bonus attack modifier',
      alienExemption: alien ? CONTROL_POINT_CAP_SOURCES.alienExemption : null,
      source: CONTROL_POINT_CAP_SOURCES.penalty
    },
    verdict: headroom.available ? (headroom.overCap ? 'over-cap' : 'within-cap') : 'unknown',
    verdictReason: headroom.reason,
    measuredOn: CONTROL_POINT_CAP_MEASURED_ON
  };
}

/**
 * The whole nation's control-point cost before dividing by its control points.
 *
 * Exported as its own primitive because two callers need the SAME expression
 * and neither may re-type it: `buildControlPointMaintenance` and
 * `marginalControlPointCost` divide it by the nation's control-point count, and
 * `value/gdp-per-cp-cost` in `server/engine/rules/value.js` divides the
 * nation's output by it. One expression, one citation, one place to be wrong.
 *
 * `gdpNormalizerBillions` defaults to 1, which is the "GDP in billions" form
 * the wiki states and the form the game uses when a campaign does not scale
 * control-point maintenance with its starting GDP. The cap model passes the
 * campaign's own normalizer; the value rule ranks nations against each other so
 * a common factor cannot reorder it, and it deliberately keeps the default.
 *
 * Returns null -- never 0 -- when GDP is unreadable or non-positive, because a
 * nation whose GDP was not measured is not a free nation.
 *
 * @param {number|string|null} gdpBillions GDP already in billions.
 * @param {object} [options]
 * @param {number} [options.gdpNormalizerBillions=1] campaign GDP normalizer, in billions.
 * @returns {number|null}
 */
export function nationControlPointCost(gdpBillions, { gdpNormalizerBillions = 1 } = {}) {
  const gdp = num(gdpBillions);
  const normalizer = num(gdpNormalizerBillions);
  if (gdp === null || !(gdp > 0)) return null;
  if (normalizer === null || !(normalizer > 0)) return null;
  return Math.pow(gdp / normalizer, COST_FORMULA.exponent) / COST_FORMULA.divisor;
}

/**
 * The marginal maintenance cost of taking one more control point in a nation.
 *
 * Taking a control point in a nation that already has some does NOT add
 * `nationTotalCost / count` to the faction's bill and leave everything else
 * alone -- the nation's total is divided among its control points however many
 * of them the faction holds, so one more costs exactly one more share.
 *
 * Returns null when GDP or the control-point count cannot be read.
 */
export function marginalControlPointCost(nation, { gdpNormalizerBillions = 1 } = {}) {
  const gdp = num(nation?.GDP);
  const controlPoints = asArray(nation?.controlPoints);
  const saved = num(nation?.controlPointCount);
  const count = saved !== null && saved > 0
    ? saved
    : (controlPoints.length > 0 ? controlPoints.length : num(nation?.cpCountInNation));
  const gdpBillions = gdp === null ? null : gdp / 1e9;
  const nationTotalCost = nationControlPointCost(gdpBillions, { gdpNormalizerBillions });
  if (nation?.alienNation === true) {
    return {
      available: true,
      cost: 0,
      nationTotalCost: 0,
      nationControlPoints: count,
      gdpBillions: gdpBillions === null ? null : round(gdpBillions, 3),
      formula: 'alien nation -- get_ControlPointMaintenanceCost returns 0',
      reason: null
    };
  }
  if (nationTotalCost === null || count === null || count <= 0) {
    return {
      available: false,
      cost: null,
      reason: nationTotalCost === null
        ? 'the nation carries no readable GDP, so a control point in it cannot be priced'
        : 'the nation carries no readable control-point count, so its cost cannot be divided'
    };
  }
  return {
    available: true,
    cost: round(nationTotalCost / count, 5),
    nationTotalCost: round(nationTotalCost, 5),
    nationControlPoints: count,
    // Three places, not one: the smallest nations here run under 0.1 Bn, and a
    // one-place round prints them as a confident `0` beside a non-zero cost.
    gdpBillions: round(gdpBillions, 3),
    // The expression only. This rides on every expansion candidate the engine
    // generates -- 44 on the measured save -- so the full citation block stays
    // on /api/intel/control-point-cap rather than being copied 44 times.
    formula: COST_FORMULA.expression,
    reason: null
  };
}

export default {
  CONTROL_POINT_CAP_MEASURED_ON,
  CONTROL_POINT_CAP_SOURCES,
  CONTROL_POINT_CAP_ACCURACY,
  CONTROL_POINT_OVERAGE_PENALTY_MULTIPLIER,
  CONTROL_POINT_CAP_PENALTY_WINDOW_DAYS,
  ALIEN_FACTION_CONTROL_POINT_CAP,
  COST_FORMULA,
  CONTROL_POINT_MAINTENANCE_EFFECTS,
  ADMINISTRATION_HAB_MODULES,
  CAP_ATTRIBUTES,
  OVER_CAP_EXPOSED_MISSIONS,
  isAlienFaction,
  readBaseControlPointCap,
  readControlPointCostNormalizer,
  buildControlPointCap,
  buildControlPointMaintenance,
  buildControlPointCapReport,
  nationControlPointCost,
  marginalControlPointCost,
  overCapInfluencePenalty,
  overCapMissionExposure
};
