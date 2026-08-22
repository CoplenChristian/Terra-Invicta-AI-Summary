// shared/controlPointCap.mjs
//
// Purpose: the control-point cap and maintenance cost, composed from named
//   sources and reconciled against the save's own recorded overage — which it
//   does NOT match, so the headroom verdict is refused rather than guessed.
//
// ---------------------------------------------------------------------------
// READ THIS FIRST: THE MODEL DOES NOT RECONCILE, AND THAT IS THE POINT
// ---------------------------------------------------------------------------
//
// Every term below is cited. The composition is right. The ABSOLUTE cap is
// not established, because the composed figure disagrees with the only figure
// the game itself records, and the disagreement is not a rounding error:
//
//   the Protectorate, `ExitSave.gz`, campaign date 1/1/2035
//     modelled maintenance cost   872.47
//     modelled cap                842  (400 base + 292 councilor + 150 projects)
//     modelled overage             30.47
//     the save's own recorded overage  10.02051
//
//   the Protectorate, `CombatAutosave.gz`, campaign date 7/15/2034
//     modelled maintenance cost   853.52
//     modelled cap                840  (400 base + 290 councilor + 150 projects)
//     modelled overage             13.52
//     the save's own recorded overage   5.16081
//
// Between those two saves the modelled cap rises by 2 (one councilor gained a
// point of Command, another a point of Persuasion; the roster, the org loadout
// and the completed-project list are otherwise identical). The cap IMPLIED by
// the recording rises by 14.09. Nothing modelled here moved by fourteen, and
// solving the two equations for a different cost exponent lands on p = 0.5041
// with a base cap of MINUS 88 -- i.e. no exponent rescues it.
//
// So this module reports the composition, reports the recording, reports the
// residual between them, and REFUSES the headroom verdict. `headroom.available`
// is false with a stated reason. Nothing here may be read as "you have room for
// another control point".
//
// ---------------------------------------------------------------------------
// WHAT IS ESTABLISHED, WITH CITATIONS
// ---------------------------------------------------------------------------
//
// THE BASE CAP EXISTS AND IS IN THE SAVE. Two fields, not one:
//
//   `TIGlobalValuesState.controlPointMaintenanceFreebies`  400 on this campaign
//   `TIMetadataState.controlPointMaintenanceFreebieBonus`  150 (every faction)
//   `TIMetadataState.controlPointMaintenanceFreebieBonusAI`  0 (AI factions, on
//                                                             top of the above)
//
// The wiki names both knobs under Customize Campaign (`Game_Options`, raw
// wikitext, read 2026-08-22): "Base Control Point Capacity -- Decides the
// number of cp cap each faction starts with", and "AI bonus Control Point Cap
// -- Decides how much cp cap AI factions will receive, in addition to the base
// cp cap". The same page records that deactivating a faction raises the base by
// 50, and that the Starting Nation Group option adds more; both are already
// inside the save's stored numbers, so nothing is recomputed from them here.
//
// Which of the two save fields is the game's "base" and which is the "bonus" is
// NOT settled -- see BASE_CAP_UNRESOLVED. Both are reported by name and summed,
// because the sum is what a cap would have to be built from either way.
//
// THE SIGN CONVENTION IS PINNED BY THE DATA, TWICE.
//
// `TIEffectTemplate.json` carries five `ControlPointMaintenance` effects whose
// `value` is NEGATIVE (-120, -40, -20, -10, -5) on a quantity the game displays
// as "Control Point Cap". Whether a -120 raises or lowers the cap is settled by
// two independent facts in the shipped templates:
//
//   1. All five carry `"showTotal": "Invert"`, which is the data telling the UI
//      to negate the total before displaying it. A stored -120 shows as +120.
//   2. `AI_projectRole: "ControlPointCap"` is shared by twelve projects. Nine
//      grant these NEGATIVE effects. The other three -- Project_Administration
//      Node / Tower / Complex -- grant no effect at all; they unlock hab modules
//      whose `controlPointCapacity` is POSITIVE (+4 / +12 / +30). The same AI
//      goal is served by a positive capacity and a negative maintenance, which
//      is only consistent if negative maintenance means more cap.
//
// So a `ControlPointMaintenance` value of -120 RAISES the cap by 120, and this
// module stores `capContribution = -value`. The template names lie about
// magnitude -- `Bonus160` is -120 and `Bonus3` is -5 -- so `value` is read and
// the name is never parsed.
//
// THREE ATTRIBUTES CONTRIBUTE, NOT ONE. From the wiki page `Control Point
// Capacity` (raw wikitext, read 2026-08-22): "Every point of administration,
// persuasion, or command on a Councilor that is not Detained adds 1 point of
// cp." The same page states that Orgs and Traits add none directly and only
// help by improving councilor attributes -- which is why this module reads the
// RESOLVED attributes (base + org + trait, clamped 0-25) rather than the base
// ones, and why it does not add an org term of its own.
//
// THE COST SIDE, AND THE ORDER-OF-MAGNITUDE PUZZLE IT EXPLAINS. From the wiki
// page `Nations`, section "Cost of Control Points" (raw wikitext, read
// 2026-08-22):
//
//     Total Cost of Control Points = (GDP in billions) ^ 0.6 / 2
//     "This total cp cost is divided up evenly among all the control points of
//      the nation."
//     "Control points that have sustained a Crackdown or are abandoned do not
//      cost any cp."
//
// The second line is the one an earlier attempt dropped. Costing the observer's
// held control points at the UNDIVIDED national total gives ~2,493 against a
// councilor-derived capacity of ~232, an order of magnitude apart, and that gap
// is what stopped the earlier work. With the division applied and the base cap
// included the two sides are the same size: the observer's modelled cost is
// 456.7 against a modelled cap of 696. The order-of-magnitude problem was an
// arithmetic omission, not a units mismatch.
//
// THE OVER-CAP PENALTIES are quadratic and are NOT a soft nudge. Same wiki
// section: an over-cap faction's "annual influence income decreases by cp
// overcap ^ 2", and Crackdown, Purge, Enthrall Elites and Dominate Nation
// against it gain a bonus attack modifier of "cp overcap / 3". The game carries
// the second as `TIMissionModifier_InsufficientCPMaintenance_Defender`, present
// on four missions in `TIMissionTemplate.json`.
//
// ---------------------------------------------------------------------------
// WHAT THE SAVE RECORDS, AND WHY IT IS NOT TREATED AS GROUND TRUTH
// ---------------------------------------------------------------------------
//
// `TIFactionState.history_CPCapOverageByDay` is a 32-slot array of the game's
// own overage figure. It is reported here verbatim, because it is the game
// speaking. It is NOT used to derive a cap, for two measured reasons:
//
//   1. It disagrees with the composition, as above.
//   2. Its sibling `history_MCCapOverageByDay` does not equal (usage - cap) for
//      Mission Control either -- measured 2026-08-22 on the same save, the
//      Servants read 7 while every reading of their MC usage and capacity puts
//      them hundreds over, and the Aliens read 0 at 420 MC of usage. So the
//      exact semantics of the `*CapOverageByDay` family are UNVERIFIED, and a
//      recorded 0 must not be read as "this faction is within its cap".
//
// Keep this file free of runtime-specific imports so the hosted worker can use
// it alongside the local server.

import { asArray, round, sameId, toFiniteNumber as num } from './util.mjs';

/** Every mechanic claim in this module was read on this date. */
export const CONTROL_POINT_CAP_MEASURED_ON = '2026-08-22';

/** The sources behind each term, so a reader can check the claim not the code. */
export const CONTROL_POINT_CAP_SOURCES = Object.freeze({
  base: Object.freeze({
    claim: 'Each faction starts with a base control-point cap set by two campaign options.',
    source: 'wiki Game_Options, "Base Control Point Capacity" and "AI bonus Control Point Cap"',
    form: 'raw wikitext',
    readOn: '2026-08-22',
    saveFields: Object.freeze([
      'TIGlobalValuesState.controlPointMaintenanceFreebies',
      'TIMetadataState.controlPointMaintenanceFreebieBonus',
      'TIMetadataState.controlPointMaintenanceFreebieBonusAI'
    ])
  }),
  councilors: Object.freeze({
    claim: 'Every point of Administration, Persuasion or Command on a non-detained councilor adds 1 cp cap.',
    source: 'wiki Control_Point_Capacity, section Councilors',
    form: 'raw wikitext',
    readOn: '2026-08-22'
  }),
  orgsAndTraits: Object.freeze({
    claim: 'Orgs and traits add no cp cap directly; they only raise councilor attributes.',
    source: 'wiki Control_Point_Capacity, sections Orgs and Traits',
    form: 'raw wikitext',
    readOn: '2026-08-22'
  }),
  habModules: Object.freeze({
    claim: 'Administration Node / Tower / Complex carry controlPointCapacity 4 / 12 / 30.',
    source: 'TIHabModuleTemplate.json (3 of 156 modules carry a non-zero controlPointCapacity)',
    form: 'shipped template',
    readOn: '2026-08-22'
  }),
  projects: Object.freeze({
    claim: 'A completed ControlPointMaintenance effect raises the cap by the absolute value of its (negative) value.',
    source: 'TIEffectTemplate.json showTotal:"Invert"; TIProjectTemplate.json AI_projectRole:"ControlPointCap"',
    form: 'shipped template',
    readOn: '2026-08-22'
  }),
  cost: Object.freeze({
    claim: 'A nation\'s total cp cost is (GDP in billions)^0.6 / 2, divided evenly among its control points; '
      + 'crackdown-hit and abandoned control points cost nothing.',
    source: 'wiki Nations, section "Cost of Control Points"',
    form: 'raw wikitext',
    readOn: '2026-08-22'
  }),
  penalty: Object.freeze({
    claim: 'Over cap: annual Influence income falls by overage squared, and Crackdown / Purge / Enthrall Elites / '
      + 'Dominate Nation against the faction gain a bonus attack modifier of overage / 3.',
    source: 'wiki Nations, section "Cost of Control Points"; TIMissionModifier_InsufficientCPMaintenance_Defender',
    form: 'raw wikitext and shipped template',
    readOn: '2026-08-22'
  })
});

/**
 * Which of the two save fields the game calls "base" and which "bonus" is not
 * settled, so neither is claimed. They are summed, and the ambiguity is stated.
 */
export const BASE_CAP_UNRESOLVED = Object.freeze({
  resolved: false,
  reason: 'The save carries a global controlPointMaintenanceFreebies (400 here) AND a per-campaign '
    + 'controlPointMaintenanceFreebieBonus (150 here) with an AI-only sibling (0 here). The wiki names two '
    + 'options -- a base every faction gets and an extra for AI factions -- but not which save field is which. '
    + 'Both are reported by name and summed; neither is asserted to be "the" base.',
  measuredOn: '2026-08-22'
});

/**
 * The exponent and divisor of the nation-level cost formula, named rather than
 * inlined so the citation travels with the numbers.
 */
export const COST_FORMULA = Object.freeze({
  expression: '(GDP in billions) ^ 0.6 / 2, divided evenly among the nation\'s control points',
  exponent: 0.6,
  divisor: 2,
  source: CONTROL_POINT_CAP_SOURCES.cost
});

/**
 * The five `ControlPointMaintenance` effects and the cap each contributes.
 *
 * The stored `value` is negative and `capContribution` is its negation, per the
 * `showTotal: "Invert"` reasoning in the header. THE NAME DOES NOT MATCH THE
 * VALUE -- `Bonus160` is -120 and `Bonus3` is -5 -- so nothing here parses the
 * name for a magnitude.
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

/** The missions that gain `overage / 3` bonus attack against an over-cap faction. */
export const OVER_CAP_EXPOSED_MISSIONS = Object.freeze([
  'Crackdown', 'Purge', 'Enthrall Elites', 'Dominate Nation'
]);

const detained = (councilor) => String(councilor?.status || '').toLowerCase() === 'detained';

/**
 * Reads a councilor's cap contribution.
 *
 * Uses `resolvedAttributes.effective` -- base plus org plus trait, clamped to
 * the 0-25 scale -- because the wiki says orgs and traits contribute only
 * through attributes. An enemy councilor in player mode carries
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
    // A detained councilor contributes nothing, per the wiki. Reported at zero
    // WITH the reason rather than dropped, so a reader can see the cap they are
    // losing while the councilor is held.
    capContribution: isDetained ? 0 : (measured ? subtotal : null),
    measured,
    reason: isDetained
      ? 'detained councilors contribute no control-point cap'
      : (measured ? null : 'this councilor\'s attributes are masked in this visibility mode')
  };
}

/**
 * The base cap, from the save's own two fields.
 *
 * Returns `available: false` when neither field could be read. An unread base
 * is NOT zero and NOT "no limit": with no base the whole cap is unknown, which
 * is what `buildControlPointCap` then reports.
 */
export function readBaseControlPointCap(snapshot, { isObserverPlayerFaction = null } = {}) {
  const metadata = snapshot?.metadata || {};
  const settings = metadata.campaignSettings?.settings || {};

  const globalFreebies = num(metadata.controlPointMaintenanceFreebies);
  const settingBonus = num(settings.controlPointMaintenanceFreebieBonus?.value);
  const settingBonusAI = num(settings.controlPointMaintenanceFreebieBonusAI?.value);

  const parts = [];
  if (globalFreebies !== null) {
    parts.push({
      label: 'campaign base control-point capacity',
      field: 'TIGlobalValuesState.controlPointMaintenanceFreebies',
      value: globalFreebies
    });
  }
  if (settingBonus !== null) {
    parts.push({
      label: 'campaign control-point capacity bonus',
      field: 'TIMetadataState.controlPointMaintenanceFreebieBonus',
      value: settingBonus
    });
  }
  // The AI sibling applies only to factions the human is not playing. When we
  // cannot tell which faction the human plays, the term is left OUT and named,
  // rather than applied to everyone or to no one on a guess.
  if (settingBonusAI !== null && isObserverPlayerFaction === false) {
    parts.push({
      label: 'campaign control-point capacity bonus (AI factions)',
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
  if (settingBonus === null) {
    unreadable.push({
      field: 'TIMetadataState.controlPointMaintenanceFreebieBonus',
      reason: 'absent or not a readable numeral'
    });
  }
  if (settingBonusAI !== null && isObserverPlayerFaction === null) {
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
    ambiguity: BASE_CAP_UNRESOLVED
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
  //
  // A faction with habs and no visible module rows has an UNREADABLE module
  // list, not an empty one. A faction with no habs at all genuinely has no
  // Administration modules, and that zero is a measurement.
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
  const cap = missing.length === 0
    ? terms.reduce((sum, t) => sum + t.total, 0)
    : null;

  return {
    factionId: faction?.ID ?? factionId ?? null,
    factionName: faction?.displayName || null,
    isObserverPlayerFaction,
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
    // Zero Administration modules exist anywhere on the measured save, so this
    // term is a measured zero rather than an unread one -- but it is stated as
    // a count, beside the completeness flag, so a reader can tell the two apart.
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
    unreadableTerms: Object.freeze(missing),
    capReason: cap !== null
      ? null
      : `the cap cannot be composed: ${missing.join(', ')} could not be read from this snapshot in this mode`,
    modelled: true,
    sources: CONTROL_POINT_CAP_SOURCES
  };
}

/**
 * The maintenance cost one faction is paying, per nation, from the nation-level
 * formula divided by the nation's own control-point count.
 *
 * A nation whose GDP or control-point list cannot be read is EXCLUDED and named
 * in `unpricedNations`, never priced at zero -- a zero-cost holding would make
 * an unaffordable position look free.
 */
export function buildControlPointMaintenance(snapshot, { factionId } = {}) {
  const nations = [];
  const unpriced = [];
  let held = 0;
  let freeHeld = 0;

  for (const nation of asArray(snapshot?.nations)) {
    const controlPoints = asArray(nation?.controlPoints);
    const mine = controlPoints.filter((cp) => sameId(cp?.factionId, factionId));
    if (mine.length === 0) continue;
    held += mine.length;

    const gdp = num(nation?.GDP);
    const gdpBillions = gdp === null ? null : gdp / 1e9;
    if (gdpBillions === null || gdpBillions <= 0 || controlPoints.length === 0) {
      unpriced.push({
        nationId: nation?.ID ?? null,
        nation: nation?.displayName || 'Unknown nation',
        held: mine.length,
        reason: gdpBillions === null || gdpBillions <= 0
          ? 'the nation carries no readable GDP, so its control-point cost cannot be priced'
          : 'the nation carries no control points to divide its cost among'
      });
      continue;
    }

    const nationTotalCost = Math.pow(gdpBillions, COST_FORMULA.exponent) / COST_FORMULA.divisor;
    const perControlPoint = nationTotalCost / controlPoints.length;

    // "Control points that have sustained a Crackdown or are abandoned do not
    // cost any cp." `benefitsDisabled` is the save's abandoned flag; `crackdown`
    // is carried on the snapshot from `TIControlPoint.crackdownExpiration`.
    const free = mine.filter((cp) => cp?.crackdown === true || cp?.benefitsDisabled === true);
    const paying = mine.length - free.length;
    freeHeld += free.length;

    nations.push({
      nationId: nation?.ID ?? null,
      nation: nation?.displayName || 'Unknown nation',
      gdpBillions: round(gdpBillions, 1),
      nationControlPoints: controlPoints.length,
      nationTotalCost: round(nationTotalCost, 3),
      perControlPoint: round(perControlPoint, 3),
      held: mine.length,
      costFree: free.length,
      costFreeReasons: Object.freeze(free.map((cp) => ({
        controlPointType: cp?.controlPointType || null,
        reason: cp?.crackdown === true ? 'crackdown' : 'abandoned'
      }))),
      paying,
      subtotal: round(perControlPoint * paying, 3)
    });
  }

  nations.sort((a, b) => b.subtotal - a.subtotal);
  const cost = nations.reduce((sum, n) => sum + n.subtotal, 0);

  return {
    factionId: factionId ?? null,
    nations: Object.freeze(nations.map(Object.freeze)),
    unpricedNations: Object.freeze(unpriced.map(Object.freeze)),
    held,
    costFreeHeld: freeHeld,
    // A cost built while some holdings could not be priced is a FLOOR, not a
    // total, and says so rather than presenting a short number as complete.
    cost: round(cost, 3),
    costComplete: unpriced.length === 0,
    costIsFloor: unpriced.length > 0,
    formula: COST_FORMULA,
    modelled: true
  };
}

/**
 * The quadratic Influence penalty for a given overage.
 *
 * Returns null for a null overage. `Number(null) === 0` would render an
 * unmeasured position as a confident "no penalty".
 */
export function overCapInfluencePenalty(overage) {
  const value = num(overage);
  if (value === null) return null;
  if (value <= 0) return 0;
  return round(value * value, 3);
}

/** The bonus attack modifier hostile missions gain against an over-cap faction. */
export function overCapMissionExposure(overage) {
  const value = num(overage);
  if (value === null) return null;
  if (value <= 0) return 0;
  return round(value / 3, 3);
}

/**
 * The full report: composition, cost, the save's own recording, and the
 * reconciliation between them.
 *
 * `headroom.available` is ALWAYS false. The composition and the recording do
 * not agree (see the header), so no number here may be read as "there is room
 * for another control point". Whatever the residual, the honest answer is that
 * this is not yet a constraint the engine can price.
 */
export function buildControlPointCapReport(snapshot, { factionId, mode = 'player' } = {}) {
  const capacity = buildControlPointCap(snapshot, { factionId });
  const maintenance = buildControlPointMaintenance(snapshot, { factionId });
  const faction = asArray(snapshot?.factions).find((f) => sameId(f?.ID, factionId)) || null;

  const recordedOverage = num(faction?.recordedControlPointCapOverage);
  const recordedAvailable = recordedOverage !== null;

  const modelledOverage = capacity.cap !== null && maintenance.costComplete
    ? Math.max(0, round(maintenance.cost - capacity.cap, 3))
    : null;

  const residual = modelledOverage !== null && recordedAvailable
    ? round(modelledOverage - recordedOverage, 3)
    : null;

  return {
    factionId: capacity.factionId,
    factionName: capacity.factionName,
    mode,
    capacity,
    maintenance,
    recorded: {
      available: recordedAvailable,
      overage: recordedOverage,
      field: 'TIFactionState.history_CPCapOverageByDay (most recent slot)',
      // Stated, not assumed. The Mission Control sibling of this field does not
      // equal (usage - cap), so a recorded zero is not evidence of being under
      // cap and a recorded value is not evidence of the exact excess.
      semanticsVerified: false,
      semanticsNote: 'the *CapOverageByDay family does not reconcile against independently computed usage and '
        + 'capacity for Mission Control on the same save, so a recorded 0 is not proof a faction is within cap',
      reason: recordedAvailable
        ? null
        : 'this snapshot carries no recorded control-point cap overage for this faction (older snapshot, or '
          + 'redacted for a rival in player mode)'
    },
    reconciliation: {
      modelledOverage,
      recordedOverage,
      residual,
      reconciles: false,
      reason: residual === null
        ? 'the modelled overage and the recorded overage cannot both be read for this faction, so they cannot be compared'
        : `the modelled overage (${modelledOverage}) and the save's own recorded overage (${recordedOverage}) `
          + `differ by ${residual}; the disagreement also grows over time, so the composition is not yet the game's cap`,
      measuredOn: CONTROL_POINT_CAP_MEASURED_ON
    },
    headroom: {
      available: false,
      value: null,
      reason: 'the composed cap does not reconcile against the save\'s own recorded overage, so no headroom figure '
        + 'is emitted; taking another control point must not be treated as free on the strength of this model'
    },
    penalties: {
      // From the recording, because that is the game's own figure -- but its
      // semantics are unverified, so it is labelled rather than asserted.
      influencePerYearFromRecorded: overCapInfluencePenalty(recordedOverage),
      missionExposureFromRecorded: overCapMissionExposure(recordedOverage),
      influencePerYearFromModelled: overCapInfluencePenalty(modelledOverage),
      missionExposureFromModelled: overCapMissionExposure(modelledOverage),
      exposedMissions: OVER_CAP_EXPOSED_MISSIONS,
      form: 'annual Influence income falls by overage^2; listed missions gain overage/3 bonus attack',
      source: CONTROL_POINT_CAP_SOURCES.penalty
    },
    verdict: 'unresolved',
    verdictReason: 'every contribution is cited and attributed, but the composed cap disagrees with the only figure '
      + 'the game records, so this must not gate advice',
    measuredOn: CONTROL_POINT_CAP_MEASURED_ON
  };
}

/**
 * The marginal maintenance cost of taking one more control point in a nation.
 *
 * This is the one figure here that does NOT depend on the unreconciled base:
 * it is the nation-level formula divided by that nation's own control-point
 * count, and it lets a reader compare two candidate control points against each
 * other without any claim about affordability.
 *
 * Returns null when GDP or the control-point count cannot be read.
 */
export function marginalControlPointCost(nation) {
  const gdp = num(nation?.GDP);
  const controlPoints = asArray(nation?.controlPoints);
  const count = controlPoints.length > 0 ? controlPoints.length : num(nation?.cpCountInNation);
  const gdpBillions = gdp === null ? null : gdp / 1e9;
  if (gdpBillions === null || gdpBillions <= 0 || count === null || count <= 0) {
    return {
      available: false,
      cost: null,
      reason: gdpBillions === null || gdpBillions <= 0
        ? 'the nation carries no readable GDP, so a control point in it cannot be priced'
        : 'the nation carries no readable control-point count, so its cost cannot be divided'
    };
  }
  const nationTotalCost = Math.pow(gdpBillions, COST_FORMULA.exponent) / COST_FORMULA.divisor;
  return {
    available: true,
    cost: round(nationTotalCost / count, 3),
    nationTotalCost: round(nationTotalCost, 3),
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
  BASE_CAP_UNRESOLVED,
  COST_FORMULA,
  CONTROL_POINT_MAINTENANCE_EFFECTS,
  ADMINISTRATION_HAB_MODULES,
  CAP_ATTRIBUTES,
  OVER_CAP_EXPOSED_MISSIONS,
  readBaseControlPointCap,
  buildControlPointCap,
  buildControlPointMaintenance,
  buildControlPointCapReport,
  marginalControlPointCost,
  overCapInfluencePenalty,
  overCapMissionExposure
};
