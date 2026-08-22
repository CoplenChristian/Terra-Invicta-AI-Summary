// shared/spaceMiningBonus.mjs
//
// Purpose: the faction-wide ADDITIVE space-mining output bonus — org
//   `miningBonus` plus `SpaceMiningBonus` effects — measured, attributed to the
//   org or effect that grants it, and refused when the roster is redacted.
//
// ---------------------------------------------------------------------------
// WHAT THIS CLOSES
// ---------------------------------------------------------------------------
//
// `shared/miningTechBonus.mjs` and `shared/mineModuleOutput.mjs` between them
// left ONE unexplained term: a clean per-faction scalar on mined output that
// agreed to six digits across all five resources but that no shipped template
// accounted for. It read 1.000 for the observer and 1.14 / 1.28 / 1.33 for
// three rivals. This module is that term, and it is not a fudge factor: it is
// the sum of two ADDITIVE fractions the game already publishes.
//
//   B(faction) = 1 + SUM(org.miningBonus over ACTIVE assigned orgs)
//                  + SUM(value of each SpaceMiningBonus effect held)
//
// Measured 2026-08-22 against the campaign's saves. On `ExitSave.gz` (campaign
// date 1/1/2035, md5 5C0D9EF98213C91D8187AE11BF885D57) the complete model
//
//   SUM over OPERATIONAL, POWERED mines of (site.<resource> x miningModifier)
//     x 365.25/12 x 1.15^grants x B(faction)
//     + flat module income + incoming daily resource transfers
//
// reproduces every faction's own `cachedYearlyRevenue / 12` at 0.9999 78 to
// 0.9999 81 on ALL FIVE resources for ALL EIGHT factions — 0.0022% error, which
// is every digit `cachedYearlyRevenue` carries. Before this term the same model
// left residuals of 1.000 / 1.000 / 1.000 / 1.10 / 1.14 / 1.19 / 1.28 / 1.33.
//
// Across five saves on build 1.0.51 it closes 38 of 40 faction-reconciliations
// at that precision, and it does so while B MOVES: the Resistance reads 1.06 in
// 2029, 1.33 in 2035 and 1.35 in a mid-2034 autosave, tracking its org
// holdings each time. The observer is 1.000 in THIS campaign and 1.30 in
// `Again.gz`, so this is not a term the observer can be assumed out of.
//
// ---------------------------------------------------------------------------
// WHY BOTH HALVES GO IN THE SAME BUCKET, MEASURED
// ---------------------------------------------------------------------------
//
// `shared/miningTechBonus.mjs` recorded that how the `SpaceMiningBonus`
// additive fraction combines with the x1.15 multipliers was NOT settled by this
// save, because Project Exodus held `Project_GoldRush` (+0.1) and read 1.28
// rather than 1.10. It is settled now, and the answer is that 1.28 was never a
// contradiction: Project Exodus holds +0.18 of org mining bonus BESIDE the +0.1
// effect, and 1 + 0.18 + 0.10 = 1.28 exactly. The Resistance is the second
// witness — +0.28 of orgs beside `Effect_SpaceMiningBonus5`, reading 1.33.
//
// So the two additive fractions SUM, and the sum multiplies the product of the
// per-resource x1.15 grants. `shared/economicValue.mjs:161` already recorded
// that `SpaceMiningBonus` states 0.05 meaning five percentage points; this is
// the same reading, now with a second source in the same units.
//
// ---------------------------------------------------------------------------
// WHERE THE TWO HALVES COME FROM
// ---------------------------------------------------------------------------
//
// * ORGS. `TIOrgTemplate.json` (read 2026-08-22) carries `miningBonus` on seven
//   templates; five of them are `randomized: true`, so the shipped template
//   value is only a mean and the ROLLED per-instance value lives in
//   `TIOrgState.miningBonus`. Reading the template would be wrong: on
//   `ExitSave.gz` `RandomSpaceMining12` instances carry 0.04, 0.05 and 0.06
//   against a template 0.04. Always read the state.
//
//   The wiki `Orgs` (raw wikitext, read 2026-08-22) corroborates the term
//   directly: it lists Project Exodus Engineers — the `EscapeSpecial` org,
//   `miningBonus: 0.1` — as granting "+10% Space Mining output bonus".
//
// * EFFECTS. `Effect_SpaceMiningBonus5` (0.05) and `Effect_SpaceMiningBonus10`
//   (0.1), both `operation: "Additive"`, `effectTarget: "SourceFaction"`,
//   `stackable: true`, context `SpaceMiningBonus` (`TIEffectTemplate.json`,
//   read 2026-08-22).
//
//   These MUST be read from `TIEffectsState.factionEffectsNames` and not by
//   sweeping completed projects. No project grants `Effect_SpaceMiningBonus5`
//   at all — the two grants in the shipped templates are the narrative events
//   `event_Breakthrough_Hab` and `event_ScienceTour` — and the Resistance holds
//   it on `ExitSave.gz`. A project sweep scores that faction 0.05 short and its
//   mined output 5% low. This is the same shape `shared/controlPointCap.mjs`
//   found, where the Aliens held four effects granted by none of the 32
//   projects that grant them.
//
// ---------------------------------------------------------------------------
// WHICH ORGS COUNT: ASSIGNED AND ACTIVE, NEITHER ASSUMED
// ---------------------------------------------------------------------------
//
// Two gates, both from the wiki `Orgs` (raw wikitext, 2026-08-22), both
// enforced here rather than approximated:
//
//   1. "Each faction may own up to 10 orgs that are not assigned to any
//      specific councilor ... These orgs do not confer any benefits to the
//      faction." So an UNASSIGNED org contributes nothing. Reading orgs off
//      councilor records gives that for free — `faction.unassignedOrgs` is
//      never consulted.
//   2. "Newly acquired orgs for a councilor do not provide bonuses until during
//      the next mission phase" and "If a councilor is Detained, then all of
//      their equipped orgs are made inactive". `TIOrgState.applyingBonuses` is
//      the game's own flag for exactly that, and an org with a mining bonus but
//      `applyingBonuses: false` is EXCLUDED — named in `inactiveSources` so a
//      reader can see it was seen and not counted, never silently dropped.
//
// An org that carries a mining bonus and does NOT carry a readable
// `applyingBonuses` flag makes the whole figure `unknown`. It cannot be told
// apart from an active one, and guessing "active" overstates while guessing
// "inactive" understates.
//
// ---------------------------------------------------------------------------
// ABSENT STAYS NULL, AND PLAYER MODE MUST REFUSE
// ---------------------------------------------------------------------------
//
// This is a ROSTER SUM, so a partial roster does not give a partial answer — it
// gives a wrong one. Player mode publishes only some of a rival's councilors
// (0 of the Aliens' 6, 4 of the Protectorate's 6, measured by the
// control-point work) and `server/intelligenceFilter.js` strips `orgs` from
// every observed enemy councilor it does publish. Summing what survives would
// report a rival's bonus as smaller than it is, which is worse than reporting
// it unknown.
//
// So `councilorListComplete` is true ONLY for the observer's own roster, and
// anything else resolves to `unknown` with `multiplier: null`. Nothing in this
// module publishes another faction's bonus, and the `sources` array — which IS
// serialised into player-mode payloads — therefore only ever names the
// observer's own orgs.
//
// Plain ESM, no Node built-ins, no imports outside `shared/`.

import { asArray, strictFiniteNumber } from './util.mjs';

/** Every claim in this module cites templates or saves read on this date. */
export const SPACE_MINING_BONUS_MEASURED_ON = '2026-08-22';

/**
 * How the faction-wide additive bonus resolved.
 *
 * `measured-none` is a real answer — the roster and the effect list were both
 * read and neither grants anything — and is a different fact from `unknown`,
 * where one of them could not be read.
 */
export const SPACE_MINING_BONUS_STATES = Object.freeze({
  measured: 'measured',
  measuredNone: 'measured-none',
  unknown: 'unknown'
});

/**
 * The two `SpaceMiningBonus` effects and their additive values.
 *
 * `TIEffectTemplate.json`, read 2026-08-22. Both are
 * `operation: "Additive", effectTarget: "SourceFaction", stackable: true`.
 * An effect name that is NOT in this table resolves the whole figure to
 * `unknown` rather than contributing zero — a post-1.0 or modded third grant
 * scored at 0 would understate output with no sign that it had.
 */
export const SPACE_MINING_BONUS_EFFECT_VALUES = Object.freeze({
  Effect_SpaceMiningBonus5: 0.05,
  Effect_SpaceMiningBonus10: 0.1
});

/**
 * How this term combines with the rest of the mine-output model.
 *
 * Published in player-mode payloads, so it names no faction and no rival's
 * holdings — only the arithmetic. The faction-by-faction evidence lives in the
 * module header, which nothing serialises.
 */
export const SPACE_MINING_BONUS_COMBINATION = Object.freeze({
  mode: 'additive',
  appliedAs: '1 + sum(org miningBonus) + sum(SpaceMiningBonus effect values)',
  order: 'the additive bucket multiplies the product of the per-resource x1.15 grants, once, after them',
  evidence: 'with this term applied, the mine-output model reproduces every faction\'s own annualised '
    + `resource revenue at 0.0022% on all five resources (${SPACE_MINING_BONUS_MEASURED_ON}); without it the `
    + 'same model leaves a clean but unexplained per-faction scalar.'
});

const EMPTY = Object.freeze([]);

const unknownResult = (reason, extra = {}) => Object.freeze({
  available: false,
  state: SPACE_MINING_BONUS_STATES.unknown,
  multiplier: null,
  additiveTotal: null,
  orgTotal: null,
  effectTotal: null,
  sources: EMPTY,
  inactiveSources: EMPTY,
  measuredOn: SPACE_MINING_BONUS_MEASURED_ON,
  combination: SPACE_MINING_BONUS_COMBINATION,
  unknownReason: reason,
  ...extra
});

/**
 * The faction-wide additive space-mining bonus, and what it is made of.
 *
 * @param {Object|null} faction - the faction to read `spaceMiningBonusEffects`
 *   off. Its `unassignedOrgs` are deliberately NOT read; unassigned orgs confer
 *   no benefit.
 * @param {Object} [options]
 * @param {Array|null} [options.councilors=null] - councilor records for THIS
 *   faction, each carrying an `orgs` array.
 * @param {boolean|null} [options.councilorListComplete=null] - true ONLY when
 *   the caller knows the roster is the full, unredacted one (i.e. it is the
 *   observer's own). Anything else resolves to `unknown`: player mode publishes
 *   a partial rival roster and strips `orgs` from what it does publish, so a
 *   sum over it would be wrong rather than absent.
 * @returns {Object} never throws.
 */
export const buildSpaceMiningBonus = (faction, {
  councilors = null,
  councilorListComplete = null
} = {}) => {
  if (!faction || typeof faction !== 'object') {
    return unknownResult('no faction was supplied, so neither its councillor roster nor its effect list could be read');
  }
  if (!Array.isArray(councilors)) {
    return unknownResult('no councillor roster was supplied, and the org half of this bonus is a sum over one');
  }
  if (councilorListComplete !== true) {
    return unknownResult('the councillor roster is not known to be complete. Only the observer\'s own roster is; '
      + 'player mode publishes a partial rival roster and strips the org list from the councillors it does publish, '
      + 'so a sum over it would understate the bonus rather than report it absent');
  }

  const sources = [];
  const inactiveSources = [];
  let orgTotal = 0;

  for (const councilor of councilors) {
    const orgs = councilor?.orgs;
    if (!Array.isArray(orgs)) {
      return unknownResult(`councillor ${councilor?.displayName || councilor?.ID || '(unnamed)'} carries no org list, `
        + 'so the org half of this bonus cannot be summed');
    }
    for (const org of orgs) {
      // A missing or zero mining bonus is a measured nothing and needs no
      // active flag: the org simply does not touch mine output.
      const value = strictFiniteNumber(org?.miningBonus);
      if (value === null || value === 0) continue;
      const active = org?.applyingBonuses;
      if (typeof active !== 'boolean') {
        return unknownResult(`org "${org?.displayName || org?.templateName || '(unnamed)'}" carries a mining bonus but no `
          + 'readable applyingBonuses flag, so it cannot be told apart from one the game has suspended');
      }
      const record = Object.freeze({
        kind: 'org',
        name: org?.displayName ?? null,
        templateName: org?.templateName ?? null,
        councilor: councilor?.displayName ?? null,
        value
      });
      if (active === true) {
        orgTotal += value;
        sources.push(record);
      } else {
        inactiveSources.push(Object.freeze({ ...record, reason: 'the game reports this org is not applying its bonuses' }));
      }
    }
  }

  const effectNames = faction.spaceMiningBonusEffects;
  if (!Array.isArray(effectNames)) {
    return unknownResult('this snapshot carries no SpaceMiningBonus effect list for the faction, and the effect half '
      + 'cannot be inferred from completed projects: no project grants Effect_SpaceMiningBonus5, which two narrative '
      + 'events do');
  }
  let effectTotal = 0;
  for (const name of asArray(effectNames)) {
    const value = SPACE_MINING_BONUS_EFFECT_VALUES[name];
    if (typeof value !== 'number') {
      return unknownResult(`the faction holds SpaceMiningBonus effect "${name}", which this table does not know, so its `
        + 'value cannot be read. Counting it as zero would understate mined output with no sign that it had');
    }
    effectTotal += value;
    sources.push(Object.freeze({ kind: 'effect', name, effect: name, templateName: null, councilor: null, value }));
  }

  // 6 places: the underlying values are hundredths, and the sum of a handful of
  // them reads 0.28000000000000003 without it. The parts are published beside
  // the total so the rounding can be checked.
  const additiveTotal = Number((orgTotal + effectTotal).toFixed(6));
  return Object.freeze({
    available: true,
    state: additiveTotal === 0 ? SPACE_MINING_BONUS_STATES.measuredNone : SPACE_MINING_BONUS_STATES.measured,
    multiplier: Number((1 + additiveTotal).toFixed(6)),
    additiveTotal,
    orgTotal: Number(orgTotal.toFixed(6)),
    effectTotal: Number(effectTotal.toFixed(6)),
    sources: Object.freeze(sources),
    inactiveSources: Object.freeze(inactiveSources),
    measuredOn: SPACE_MINING_BONUS_MEASURED_ON,
    combination: SPACE_MINING_BONUS_COMBINATION,
    unknownReason: null
  });
};

/**
 * Applies the faction-wide bonus to a figure, and says what it did.
 *
 * Deliberately the same shape as `applyMiningTechBonus` in
 * `shared/miningTechBonus.mjs`, so a caller can chain the two and carry both
 * `applied` flags through to its own output.
 *
 * An UNKNOWN bonus returns the INPUT figure with `applied: false`,
 * `multiplier: null` and a reason — never the input dressed up as adjusted, and
 * never null in place of a figure that was measured.
 *
 * @param {number|null} value - null in, null out.
 * @param {Object|null} bonus - the result of buildSpaceMiningBonus.
 * @param {Object} [options]
 * @param {number|null} [options.places=null] - decimal places for the result.
 */
export const applySpaceMiningBonus = (value, bonus, { places = null } = {}) => {
  const round = (n) => (places === null ? n : Number(n.toFixed(places)));

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return {
      value: null,
      raw: null,
      applied: false,
      multiplier: bonus?.multiplier ?? null,
      state: bonus?.state ?? SPACE_MINING_BONUS_STATES.unknown,
      sources: EMPTY,
      reason: 'no measured figure to adjust'
    };
  }

  if (!bonus || bonus.available !== true || typeof bonus.multiplier !== 'number') {
    return {
      value: round(value),
      raw: round(value),
      applied: false,
      multiplier: null,
      state: SPACE_MINING_BONUS_STATES.unknown,
      sources: EMPTY,
      reason: bonus?.unknownReason
        || 'the faction-wide space-mining bonus could not be resolved, so this figure omits it and is a lower bound'
    };
  }

  return {
    value: round(value * bonus.multiplier),
    raw: round(value),
    applied: bonus.multiplier !== 1,
    multiplier: bonus.multiplier,
    state: bonus.state,
    sources: bonus.sources,
    reason: null
  };
};

/**
 * One sentence naming what was applied, for a prose surface.
 *
 * Returns null when there is nothing worth saying (the roster and effect list
 * were both read and neither grants anything), so a caller can omit the clause
 * rather than print "no bonus".
 */
export const spaceMiningBonusCaveat = (bonus) => {
  if (!bonus || bonus.available !== true) {
    return 'the faction-wide space-mining bonus is UNRESOLVED, so these figures omit it and are a lower bound';
  }
  if (bonus.state === SPACE_MINING_BONUS_STATES.measuredNone) return null;
  const parts = asArray(bonus.sources).map(source => (source.kind === 'effect'
    ? `${source.name} +${Math.round(source.value * 100)}%`
    : `${source.name} +${Math.round(source.value * 100)}%`));
  return `includes a faction-wide space-mining bonus of +${Math.round(bonus.additiveTotal * 100)}% from ${parts.join(' + ')}`;
};
