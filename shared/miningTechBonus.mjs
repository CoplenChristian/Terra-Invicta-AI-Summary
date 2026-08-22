// shared/miningTechBonus.mjs
//
// Purpose: the observer's per-resource mine-output multipliers from completed
//   projects, and the labelled application of them to a raw site rate.
//
// ---------------------------------------------------------------------------
// WHAT THE SAVE STORES, MEASURED
// ---------------------------------------------------------------------------
//
// `TIHabSiteState.<resource>_day` is the DEPOSIT's rate. It is NOT the mine's
// realised output and it carries no faction's tech bonus. Measured 2026-08-22
// against `ExitSave.gz` (campaign date 1/1/2035, md5 5C0D9EF98213C91D8187AE11BF885D57)
// and `initiative.gz` (campaign date 9/10/2029), three independent ways:
//
//   1. 280 of the save's 409 hab sites have NO mine module and NO owner, and
//      all 280 still carry non-zero `_day` rates.
//   2. 405 of 409 sites are BYTE-IDENTICAL between the two saves, across 5.3
//      in-game years in which 90 sites changed owner, 102 changed mine tier,
//      and five factions completed fourteen new mining-bonus projects between
//      them. The four that moved each moved by ONE scalar applied to all five
//      resources at once (x1.2497, x0.5004, x0.4939, x1.2412) -- one of them
//      on a site unowned in both saves -- which is a deposit-richness event,
//      not a per-resource tech grant. None of the four is 1.15.
//   3. The faction's own income reconciles EXACTLY only when the bonus is
//      applied outside the stored rate. See INCOME_MODEL below.
//
// So the derived monthly figures the dashboard computes from `site.<resource>`
// are PRE-bonus and understate a bonused resource.
//
// ---------------------------------------------------------------------------
// THE MODEL THAT RECONCILES, AND HOW STACKING WAS MEASURED
// ---------------------------------------------------------------------------
//
//   monthlyOutput(resource)
//     = SUM over operational mine sites of (site.<resource> x mineModule.miningModifier)
//       x 365.25/12
//       x 1.15^(number of completed projects granting Effect_Mining<Resource>Bonus)
//       x B(faction)
//
// checked against each faction's own `cachedYearlyRevenue / 12` (the game's own
// annualised income, which `server/snapshot/factions.js` already trusts to
// within 0.01%). Five of eight factions reconcile at 0.000% error on all five
// resources, which is every digit `cachedYearlyRevenue` carries:
//
//   the Initiative  1 water grant     water 1.150000, other four 1.000000
//   the Academy     3 single grants   water/metals/nobles 1.150000, other two 1.000000
//   Humanity First  1,1,2 grants      water 1.150000, metals 1.150000, NOBLES 1.322500
//   the Resistance  none              all five 1.000000
//   Project Exodus  none of these     all five 1.000000
//
// Humanity First's noble metals is the stacking measurement: it holds BOTH
// `Project_MolecularBenefication` and `Project_SlagValorization`, and reads
// 1.322500 against its own unbonused resources -- exactly 1.15^2, not 1.30 and
// not a 1.15 cap. STACKING IS MULTIPLICATIVE, measured, not assumed.
//
// ---------------------------------------------------------------------------
// WHAT THIS MODULE DELIBERATELY DOES NOT MODEL
// ---------------------------------------------------------------------------
//
// * `B(faction)` above. It is 1.000 for the observer (0.999978 measured) and
//   for the Academy, and a clean but UNEXPLAINED scalar elsewhere -- 1.14 for
//   Humanity First, 1.28 for Project Exodus, 1.33 for the Resistance, agreeing
//   to six digits across all five resources. No shipped template accounts for
//   it. It is named in `UNMODELLED_FACTORS` rather than silently folded in.
// * `Effect_SpaceMiningBonus5` / `Effect_SpaceMiningBonus10`. These are
//   `Additive` fractions (0.05 / 0.1), a DIFFERENT SHAPE from the x1.15
//   multipliers, and `shared/economicValue.mjs` already records why the two
//   must not be conflated. Project Exodus holds `Project_GoldRush`
//   (`Effect_SpaceMiningBonus10`) and reads 1.28, not 1.10, so how the additive
//   fraction is combined is NOT settled by this save. Declared unhandled.
// * The mine module's own `miningModifier` (1.0 / 1.25 / 1.5 / 2.0 / 4.0).
//   It is genuinely missing from the dashboard's derived figures too, but it is
//   a separate defect with a separate blast radius -- an unowned candidate site
//   has no mine module at all, so projecting its yield needs a decision about
//   which tier would be built. Named in `UNMODELLED_FACTORS`.
// * The campaign's 200% `miningProductivityMultiplier`. It is ALREADY inside
//   the stored `_day` rate: the income model above reconciles with no factor of
//   two anywhere, and the observer's `B` is 1.000. Re-applying it would be a 2x
//   error. `shared/intel/common.mjs` says the same thing.
//
// ---------------------------------------------------------------------------
// ABSENT STAYS NULL
// ---------------------------------------------------------------------------
//
// A faction whose completed-project list cannot be read has an UNKNOWN
// multiplier, never 1.0. `unknown` is a third state beside `boosted` and
// `measured-none`, it carries `multiplier: null`, and `applyMiningTechBonus`
// returns the raw figure with `applied: false` and a reason rather than
// pretending the raw figure is bonus-adjusted.
//
// Player mode matters here: `server/intelligenceFilter.js` truncates a
// NON-observer faction's `completedProjects` to the first five entries, so a
// multiplier computed from a rival's list in player mode would be wrong rather
// than unknown. Callers pass `projectListComplete` and it is only ever true for
// the observer's own list. Nothing in this module publishes another faction's
// bonus.
//
// Plain ESM, no Node built-ins, no imports outside `shared/`.

import { asArray } from './util.mjs';

/** Every claim in this module cites templates read on this date. */
export const MINING_BONUS_MEASURED_ON = '2026-08-22';

/**
 * How a resource's multiplier resolved.
 *
 * `measured-none` is a real answer -- the list was read and it grants nothing --
 * and is a different fact from `unknown`, where the list could not be read.
 */
export const MINING_BONUS_STATES = Object.freeze({
  boosted: 'boosted',
  measuredNone: 'measured-none',
  unknown: 'unknown'
});

/**
 * Multiplicative, measured. See the header for which faction and which pair of
 * projects settled it.
 *
 * `evidence` IS PUBLISHED IN PLAYER-MODE PAYLOADS, so it deliberately names no
 * faction and no project. Saying "Humanity First holds these two projects" here
 * would put a rival's completed research into a player-mode response -- the
 * exact leak shape this repo keeps closing, arriving through a doc string
 * rather than through a data field. The detail lives in the module header,
 * which nothing serialises.
 */
export const MINING_BONUS_STACKING = Object.freeze({
  mode: 'multiplicative',
  perGrant: 1.15,
  evidence: 'measured against a faction holding both granting projects for one resource: its income '
    + `reads 1.15^2 = 1.3225 exactly against its own unbonused resources, not 1.30 and not a 1.15 cap (${MINING_BONUS_MEASURED_ON}).`
});

/**
 * The thirteen projects that touch mine output, split by SHAPE.
 *
 * `TIProjectTemplate.json` / `TIEffectTemplate.json`, read 2026-08-22. The five
 * `Effect_Mining*Bonus` effects are `operation: "Multiplicative", value: 1.15,
 * effectTarget: "SourceFaction", stackable: true`. Two projects grant each.
 */
export const MINING_BONUS_RULES = Object.freeze([
  Object.freeze({
    key: 'water',
    label: 'Water',
    effect: 'Effect_MiningWaterBonus',
    projects: Object.freeze(['Project_WaterPurificationTechniques', 'Project_ThermalMiningTechniques'])
  }),
  Object.freeze({
    key: 'volatiles',
    label: 'Volatiles',
    effect: 'Effect_MiningVolatilesBonus',
    projects: Object.freeze(['Project_RapidDistillationTechniques', 'Project_MicrobialDrills'])
  }),
  Object.freeze({
    key: 'metals',
    label: 'Metals',
    effect: 'Effect_MiningMetalsBonus',
    projects: Object.freeze(['Project_DeepSpaceMetallurgy', 'Project_PlasmaExtractionTechniques'])
  }),
  Object.freeze({
    key: 'nobleMetals',
    label: 'Noble metals',
    effect: 'Effect_MiningNoblesBonus',
    projects: Object.freeze(['Project_MolecularBenefication', 'Project_SlagValorization'])
  }),
  Object.freeze({
    key: 'fissiles',
    label: 'Fissiles',
    effect: 'Effect_MiningFissilesBonus',
    projects: Object.freeze(['Project_RapidFissileEnrichment', 'Project_SubsurfaceRadiatonAnalysis'])
  })
]);

/**
 * The other three projects, which grant an ADDITIVE fraction, not a multiplier.
 *
 * Kept in the same file as the multipliers precisely so the next reader sees
 * that they are a different shape and does not fold 0.1 in beside 1.15.
 */
export const ADDITIVE_MINING_BONUS_PROJECTS = Object.freeze([
  Object.freeze({ project: 'Project_AdvancedProspectingSurveys', effect: 'Effect_SpaceMiningBonus10', value: 0.1 }),
  Object.freeze({ project: 'Project_AlgorithmicExtractionManagement', effect: 'Effect_SpaceMiningBonus10', value: 0.1 }),
  Object.freeze({ project: 'Project_GoldRush', effect: 'Effect_SpaceMiningBonus10', value: 0.1 })
]);

/**
 * Named, quantified, and NOT applied. A figure adjusted by this module is
 * still a lower bound on realised output while these stand.
 */
export const UNMODELLED_FACTORS = Object.freeze([
  Object.freeze({
    factor: 'mine-module miningModifier',
    range: '1.0 (Outpost) / 1.25 (Automated) / 1.5 (Settlement) / 2.0 (Colony) / 4.0 (Alien Colony)',
    reason: 'the stored site rate is the deposit rate, so a built mine multiplies it. Projecting an '
      + 'UNOWNED candidate site would need a decision about which tier gets built, which is a separate '
      + 'change with a separate blast radius.',
    source: 'TIHabModuleTemplate.json, read 2026-08-22'
  }),
  Object.freeze({
    factor: 'SpaceMiningBonus additive fraction',
    range: '+0.05 / +0.1 per grant',
    reason: 'an ADDITIVE fraction, not a multiplier, and how it combines with the x1.15 multipliers is '
      + 'not settled by this save: Project Exodus holds Project_GoldRush (+0.1) and its unbonused '
      + 'resources read 1.28, not 1.10.',
    source: 'TIEffectTemplate.json / TIProjectTemplate.json, read 2026-08-22'
  }),
  Object.freeze({
    factor: 'unexplained per-faction mining scalar',
    range: '1.000 for the observer and the Academy; 1.14 / 1.28 / 1.33 elsewhere',
    reason: 'agrees to six digits across all five resources within a faction, so it is a real scalar, '
      + 'but no shipped template accounts for it. It is 1.000 for the observer, so it does not affect '
      + 'the observer-scoped figures this module adjusts.',
    source: 'measured against cachedYearlyRevenue on ExitSave.gz, 2026-08-22'
  })
]);

const RULE_BY_KEY = new Map(MINING_BONUS_RULES.map(rule => [rule.key, rule]));

const unknownEntry = (rule, reason) => Object.freeze({
  resource: rule.key,
  label: rule.label,
  effect: rule.effect,
  state: MINING_BONUS_STATES.unknown,
  multiplier: null,
  grantCount: null,
  grants: Object.freeze([]),
  source: null,
  unknownReason: reason
});

/**
 * The observer's five per-resource mine-output multipliers.
 *
 * @param {Object|null} faction - the faction whose completed projects to read.
 * @param {Object} [options]
 * @param {boolean|null} [options.projectListComplete=null] - true ONLY when the
 *   caller knows the list is the full, unredacted one (i.e. it is the
 *   observer's own). Anything else resolves to `unknown`, because player mode
 *   truncates a rival's list to five entries and a multiplier computed from a
 *   truncated list is wrong, not unknown.
 * @returns {Object} `{ available, byResource, ... }`; never throws.
 */
export const buildMiningTechBonuses = (faction, { projectListComplete = null } = {}) => {
  const rawList = Array.isArray(faction?.completedProjects)
    ? faction.completedProjects
    : (Array.isArray(faction?.finishedProjectNames) ? faction.finishedProjectNames : null);

  let unknownReason = null;
  if (!faction || typeof faction !== 'object') {
    unknownReason = 'no faction was supplied, so no completed-project list could be read';
  } else if (rawList === null) {
    unknownReason = 'the faction carries no completedProjects / finishedProjectNames array';
  } else if (projectListComplete !== true) {
    unknownReason = 'the completed-project list is not known to be complete. Only the observer\'s own '
      + 'list is; player mode truncates every other faction\'s to five entries, so a multiplier read '
      + 'from it would be wrong rather than absent';
  }

  const byResource = {};
  if (unknownReason !== null) {
    for (const rule of MINING_BONUS_RULES) byResource[rule.key] = unknownEntry(rule, unknownReason);
    return Object.freeze({
      available: false,
      unavailableReason: unknownReason,
      measuredOn: MINING_BONUS_MEASURED_ON,
      stacking: MINING_BONUS_STACKING,
      byResource: Object.freeze(byResource),
      boostedResources: Object.freeze([]),
      unmodelledFactors: UNMODELLED_FACTORS
    });
  }

  const held = new Set(asArray(rawList));
  const boostedResources = [];
  for (const rule of MINING_BONUS_RULES) {
    const grants = rule.projects.filter(project => held.has(project));
    // 1.15^n, and n is 0, 1 or 2 -- there are exactly two granting projects per
    // resource. Rounded to 6 places so 1.15^2 reads 1.3225 rather than
    // 1.3224999999999998; the underlying grant count is published beside it.
    const multiplier = Number(Math.pow(MINING_BONUS_STACKING.perGrant, grants.length).toFixed(6));
    if (grants.length > 0) boostedResources.push(rule.key);
    byResource[rule.key] = Object.freeze({
      resource: rule.key,
      label: rule.label,
      effect: rule.effect,
      state: grants.length > 0 ? MINING_BONUS_STATES.boosted : MINING_BONUS_STATES.measuredNone,
      multiplier,
      grantCount: grants.length,
      grants: Object.freeze(grants.slice()),
      source: grants.length > 0
        ? `${grants.join(' + ')} (${rule.effect} x${MINING_BONUS_STACKING.perGrant}${grants.length > 1 ? `, ${MINING_BONUS_STACKING.mode}` : ''})`
        : null,
      unknownReason: null
    });
  }

  return Object.freeze({
    available: true,
    unavailableReason: null,
    measuredOn: MINING_BONUS_MEASURED_ON,
    stacking: MINING_BONUS_STACKING,
    byResource: Object.freeze(byResource),
    boostedResources: Object.freeze(boostedResources),
    unmodelledFactors: UNMODELLED_FACTORS
  });
};

/**
 * Applies one resource's multiplier to a raw figure, and says what it did.
 *
 * An UNKNOWN multiplier returns the RAW figure with `applied: false`,
 * `multiplier: null` and a reason -- never the raw figure dressed up as
 * bonus-adjusted, and never null in place of a figure that was measured. The
 * caller is expected to carry `applied` through to its own output so a reader
 * can tell an adjusted number from an unadjusted one.
 *
 * @param {number|null} value - the raw figure. null in, null out.
 * @param {Object|null} bonuses - the result of buildMiningTechBonuses.
 * @param {string} resourceKey - one of the MINING_RESOURCES `key` spellings.
 * @param {Object} [options]
 * @param {number|null} [options.places=null] - decimal places for the result.
 */
export const applyMiningTechBonus = (value, bonuses, resourceKey, { places = null } = {}) => {
  const rule = RULE_BY_KEY.get(resourceKey) || null;
  const entry = bonuses?.byResource?.[resourceKey] || null;
  const round = (n) => (places === null ? n : Number(n.toFixed(places)));

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return {
      value: null,
      raw: null,
      applied: false,
      multiplier: entry?.multiplier ?? null,
      state: entry?.state ?? MINING_BONUS_STATES.unknown,
      source: entry?.source ?? null,
      reason: 'no measured figure to adjust'
    };
  }

  if (!rule) {
    return {
      value: round(value),
      raw: round(value),
      applied: false,
      multiplier: null,
      state: MINING_BONUS_STATES.unknown,
      source: null,
      reason: `'${resourceKey}' is not one of the five mined resources, so no mining tech bonus applies to it`
    };
  }

  if (!entry || entry.state === MINING_BONUS_STATES.unknown || typeof entry.multiplier !== 'number') {
    return {
      value: round(value),
      raw: round(value),
      applied: false,
      multiplier: null,
      state: MINING_BONUS_STATES.unknown,
      source: null,
      reason: entry?.unknownReason
        || bonuses?.unavailableReason
        || 'the mining tech bonus could not be resolved, so this figure is the RAW site rate, not an adjusted one'
    };
  }

  return {
    value: round(value * entry.multiplier),
    raw: round(value),
    applied: entry.multiplier !== 1,
    multiplier: entry.multiplier,
    state: entry.state,
    source: entry.source,
    reason: null
  };
};

/**
 * One sentence naming what was adjusted, for a prose surface.
 *
 * Returns null when there is nothing worth saying (every resource measured and
 * unbonused), so a caller can omit the clause rather than print "no bonuses".
 */
export const miningTechBonusCaveat = (bonuses) => {
  if (!bonuses || bonuses.available !== true) {
    return 'mining tech bonuses are UNRESOLVED, so these are raw site rates and are a lower bound';
  }
  const boosted = asArray(bonuses.boostedResources)
    .map(key => bonuses.byResource?.[key])
    .filter(Boolean);
  if (boosted.length === 0) return null;
  const parts = boosted.map(entry => `${String(entry.label).toLowerCase()} x${entry.multiplier} from ${entry.grants.join(' + ')}`);
  return `includes completed-project mine bonuses: ${parts.join('; ')}`;
};
