// shared/councilorAttributes.mjs
//
// Purpose: resolve a councilor's effective attributes from base stats plus org
//   bonuses.
//
// Resolves a councilor's effective attributes from their base stats plus the
// bonuses granted by equipped orgs.
//
// The save stores only BASE attributes on TICouncilorState; org bonuses are
// applied by the game at resolution time. Reading `councilor.attributes`
// directly therefore understates every councilor who holds orgs -- which is
// all of them in a developed campaign.
//
// Two mechanics make a naive sum wrong, and both are handled here:
//   * A detained councilor has all equipped orgs made inactive, so their
//     bonuses do not apply until the mission phase after release.
//   * Loyalty is never modified by orgs -- no org carries a loyalty stat.
//
// Trait modifiers are included too, but only the ones that can be resolved
// from a councilor record alone: unconditional, Additive, targeting a real
// attribute. That covers the augmentation/implant lines (ExecutiveAI +3
// Administration, CognitiveEnhancer +3 Science, StealthField +3 Espionage) and
// intrinsic traits like Veteran or AwkwardGenius.
//
// Excluded, and reported under `unresolvedTraitMods` rather than guessed at:
//   * Conditional mods, which depend on nation state (cohesion, inequality,
//     democracy) that a councilor record cannot resolve.
//   * SetToFixedValue / SetToAnotherAttribute operations, which override
//     rather than add and mostly target ApparentLoyalty.
//
// Including trait mods is what makes org capacity coherent: without them 19 of
// 48 councilors in a real save appear to exceed their capacity; with them, none
// do.
//
// Keep this file free of runtime-specific imports so the hosted worker can use
// it alongside the local server.

import { asArray, toFiniteNumber as num, sameId } from './util.mjs';

export const ATTRIBUTE_NAMES = Object.freeze([
  'Persuasion',
  'Investigation',
  'Espionage',
  'Command',
  'Administration',
  'Science',
  'Security',
  'Loyalty'
]);

// Orgs report bonuses under short keys. Loyalty is absent by design.
export const ORG_STAT_TO_ATTRIBUTE = Object.freeze({
  per: 'Persuasion',
  inv: 'Investigation',
  esp: 'Espionage',
  cmd: 'Command',
  adm: 'Administration',
  sci: 'Science',
  sec: 'Security'
});

// Councilor attributes run on a 0-25 scale. The wiki states the limit
// explicitly ("the usual stat limitation of being between 0 and 25"), and the
// save bears it out: no base attribute exceeds 25, and although raw
// base+org+trait sums reach 31, no councilor anywhere holds more than 25 org
// tiers -- which is what capacity would allow if Administration ran past 25.
export const ATTRIBUTE_MIN = 0;
export const ATTRIBUTE_MAX = 25;

const clampAttribute = (value) => Math.min(ATTRIBUTE_MAX, Math.max(ATTRIBUTE_MIN, value));

const zeroed = () => ATTRIBUTE_NAMES.reduce((acc, name) => {
  acc[name] = 0;
  return acc;
}, {});

/** Detained councilors have their equipped orgs deactivated. */
export const orgsAreActive = (councilor) =>
  String(councilor?.status || '').toLowerCase() !== 'detained';

/**
 * Sum the attribute bonuses granted by a councilor's equipped orgs.
 * Returns per-attribute totals plus a per-org breakdown for display.
 */
export function sumOrgBonuses(orgs) {
  const totals = zeroed();
  const contributions = [];

  for (const org of asArray(orgs)) {
    const stats = org?.statBonuses || {};
    const applied = {};
    let any = false;

    for (const [shortKey, attribute] of Object.entries(ORG_STAT_TO_ATTRIBUTE)) {
      const value = num(stats[shortKey]) || 0;
      if (value === 0) continue;
      totals[attribute] += value;
      applied[attribute] = value;
      any = true;
    }

    contributions.push({
      orgId: org?.id ?? null,
      name: org?.displayName || org?.templateName || 'Unknown org',
      tier: num(org?.tier) ?? null,
      stats: applied,
      grantsAttributes: any,
      bonusesText: org?.bonusesText || null
    });
  }

  return { totals, contributions };
}

/**
 * Sum the attribute modifiers granted by a councilor's traits.
 *
 * Only unconditional Additive mods on real attributes are applied; anything
 * conditional or overriding is returned in `unresolved` so the caller can say
 * which traits were skipped rather than silently dropping them.
 *
 * @param {string[]} traitNames  Trait dataNames from the councilor
 * @param {object} traitStatMods Map of traitName -> [{ stat, value, conditional, operation }]
 */
export function sumTraitBonuses(traitNames, traitStatMods) {
  const totals = zeroed();
  const contributions = [];
  const unresolved = [];

  for (const name of asArray(traitNames)) {
    const mods = asArray(traitStatMods?.[name]);
    if (mods.length === 0) continue;

    const applied = {};
    let any = false;

    for (const mod of mods) {
      const attribute = mod?.stat;
      const value = num(mod?.value) || 0;
      const additive = (mod?.operation || 'Additive') === 'Additive';

      if (!ATTRIBUTE_NAMES.includes(attribute) || mod?.conditional || !additive) {
        unresolved.push({
          trait: name,
          stat: attribute || null,
          operation: mod?.operation || null,
          reason: mod?.conditional
            ? 'conditional on nation state'
            : !additive
              ? 'overrides rather than adds'
              : 'targets a non-attribute stat'
        });
        continue;
      }

      totals[attribute] += value;
      applied[attribute] = (applied[attribute] || 0) + value;
      any = true;
    }

    if (any) contributions.push({ trait: name, stats: applied });
  }

  return { totals, contributions, unresolved };
}

/**
 * Effective attributes for one councilor.
 *
 * @param {object} councilor Snapshot councilor (base `attributes`, `orgs`, `traits`, `status`)
 * @param {object} [options]
 * @param {object} [options.traitStatMods] traitName -> modifier list, from game templates
 * @returns {object} base / orgBonuses / traitBonuses / effective, plus provenance
 */
export function buildCouncilorAttributes(councilor, { traitStatMods = null } = {}) {
  // In player mode an observed enemy carries `maskedAttributes`, not
  // `attributes`, so their base stats are legitimately unknown. `?? 0` read
  // that as "genuinely zero skill", which is materially wrong for any pairing
  // or ranking decision: an unknown operative looked like the worst possible
  // one. Unknown bases are kept as 0 for arithmetic (so nothing downstream
  // becomes NaN) but are named in `unmeasuredAttributes`, and `baseMeasured`
  // says per attribute whether the number came from the save.
  const base = zeroed();
  const baseMeasured = {};
  const unmeasuredAttributes = [];
  for (const name of ATTRIBUTE_NAMES) {
    const measured = num(councilor?.attributes?.[name]);
    baseMeasured[name] = measured !== null;
    if (measured === null) unmeasuredAttributes.push(name);
    base[name] = measured ?? 0;
  }
  const baseAttributesAvailable = unmeasuredAttributes.length < ATTRIBUTE_NAMES.length;

  const orgs = asArray(councilor?.orgs);
  const active = orgsAreActive(councilor);
  const { totals, contributions } = sumOrgBonuses(orgs);

  // A detained councilor keeps their orgs but gets none of their bonuses.
  // Traits are intrinsic -- an implant does not stop working in detention --
  // so trait modifiers still apply.
  const orgBonuses = active ? totals : zeroed();

  const traitResult = sumTraitBonuses(councilor?.traits, traitStatMods);
  const traitBonuses = traitResult.totals;

  // Sum, then clamp to the 0-25 scale. Both are kept: `effective` is what the
  // game acts on and what anything ranking or ordering councilors must use,
  // while `uncapped` preserves how much bonus was nominally available so a
  // clamped councilor is distinguishable from one sitting exactly at the cap.
  const uncapped = zeroed();
  const effective = zeroed();
  const appliedBonus = zeroed();
  const capped = {};
  for (const name of ATTRIBUTE_NAMES) {
    uncapped[name] = base[name] + orgBonuses[name] + traitBonuses[name];
    effective[name] = clampAttribute(uncapped[name]);
    // The realized increase, which is what a display should show: a councilor
    // at 20 base with +8 of orgs gains 5, not 8.
    appliedBonus[name] = effective[name] - base[name];
    capped[name] = uncapped[name] !== effective[name];
  }

  // An org whose tier the save omits contributes an unknown number of tiers,
  // not zero -- counting it as zero makes an over-capacity councilor look
  // compliant. The measured tiers are still summed, and the unmeasured ones
  // are counted so `withinCapacity` can report unknown instead of true.
  let usedTiers = 0;
  let untieredOrgs = 0;
  for (const org of orgs) {
    const tier = num(org?.tier);
    if (tier === null) untieredOrgs += 1;
    else usedTiers += tier;
  }
  const capacity = effective.Administration;
  // Capacity is only knowable if Administration was measured. `withinCapacity`
  // must not fall through to "fine" when it cannot be evaluated.
  const capacityEvaluable = baseMeasured.Administration && untieredOrgs === 0;

  return {
    base,
    // Per-attribute provenance for `base`, so a consumer can render
    // "unknown" instead of a confident 0 for a masked enemy councilor.
    baseMeasured,
    unmeasuredAttributes,
    baseAttributesAvailable,
    // False when the save carried none of the eight base attributes: every
    // number below is then a floor derived from org and trait bonuses alone,
    // not a measurement.
    attributesComplete: unmeasuredAttributes.length === 0,
    orgBonuses,
    traitBonuses,
    effective,
    uncapped,
    appliedBonus,
    capped,
    attributeMax: ATTRIBUTE_MAX,
    // Sum of the seven mission attributes (Loyalty is a defence stat, not a
    // mission one) using effective values, so any "total skills" ranking
    // matches the per-attribute figures shown beside it.
    totalEffectiveSkills: ATTRIBUTE_NAMES
      .filter(name => name !== 'Loyalty')
      .reduce((sum, name) => sum + effective[name], 0),
    // A total built partly from unknown bases is a lower bound, not a total.
    totalEffectiveSkillsComplete: ATTRIBUTE_NAMES
      .filter(name => name !== 'Loyalty')
      .every(name => baseMeasured[name]),
    orgsActive: active,
    orgCount: orgs.length,
    orgCapacity: {
      usedTiers,
      untieredOrgs,
      // One org tier per point of Administration. With trait modifiers counted
      // this holds across every councilor in a real save; without them it
      // appears violated by 40% of them.
      capacity,
      effectiveAdministration: capacity,
      capacityEvaluable,
      // Unknown is not the same as compliant: null when Administration or any
      // org tier is unmeasured.
      withinCapacity: capacityEvaluable ? usedTiers <= capacity : null,
      spare: capacityEvaluable ? capacity - usedTiers : null
    },
    contributions,
    traitContributions: traitResult.contributions,
    // Trait modifiers that cannot be resolved from a councilor record alone.
    // Named rather than dropped, so a gap against the in-game display has a
    // stated cause.
    unresolvedTraitMods: traitResult.unresolved,
    unmodelled: [
      'Conditional trait modifiers (they depend on nation cohesion, inequality or democracy).',
      'Trait modifiers that set rather than add (SetToFixedValue / SetToAnotherAttribute).',
      'Newly acquired orgs do not grant bonuses until the next mission phase.'
    ]
  };
}

/** Convenience: effective attributes only, for callers that want the numbers. */
export function effectiveAttributes(councilor) {
  return buildCouncilorAttributes(councilor).effective;
}

/**
 * Rank a faction's councilors by one effective attribute. Useful for
 * "who should run this mission" questions, where base stats mislead.
 */
export function rankByAttribute(councilors, attribute, { factionId = null, limit = null, traitStatMods = null } = {}) {
  if (!ATTRIBUTE_NAMES.includes(attribute)) {
    throw new Error(`Unknown attribute "${attribute}". Expected one of: ${ATTRIBUTE_NAMES.join(', ')}`);
  }

  const ranked = asArray(councilors)
    .filter(c => factionId === null || sameId(c?.factionId, factionId))
    .map(c => {
      const resolved = buildCouncilorAttributes(c, { traitStatMods });
      return {
        councilorId: c?.ID ?? null,
        name: c?.displayName || 'Unknown',
        // `base` is null, not 0, when the save did not carry this attribute
        // -- a masked enemy councilor in player mode. `effective` stays a
        // number so the ranking still orders, but `baseMeasured` marks it as
        // a floor derived from bonuses rather than a measured skill.
        base: resolved.baseMeasured[attribute] ? resolved.base[attribute] : null,
        baseMeasured: resolved.baseMeasured[attribute],
        orgBonus: resolved.orgBonuses[attribute],
        effective: resolved.effective[attribute],
        effectiveIsLowerBound: !resolved.baseMeasured[attribute],
        orgsActive: resolved.orgsActive
      };
    })
    // Tiebreak on base only when both bases were measured; `number - null`
    // coerces to the number and would order an unknown base as a zero.
    .sort((a, b) => (b.effective - a.effective)
      || ((a.baseMeasured && b.baseMeasured) ? b.base - a.base : 0));

  return limit ? ranked.slice(0, Number(limit)) : ranked;
}

export default {
  ATTRIBUTE_NAMES,
  ORG_STAT_TO_ATTRIBUTE,
  buildCouncilorAttributes,
  effectiveAttributes,
  sumOrgBonuses,
  rankByAttribute,
  orgsAreActive
};
