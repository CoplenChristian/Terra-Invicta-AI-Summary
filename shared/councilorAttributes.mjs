// shared/councilorAttributes.mjs
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

const asArray = (value) => (Array.isArray(value) ? value : []);

const num = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

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
  const base = zeroed();
  for (const name of ATTRIBUTE_NAMES) {
    base[name] = num(councilor?.attributes?.[name]) ?? 0;
  }

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

  const usedTiers = orgs.reduce((sum, org) => sum + (num(org?.tier) ?? 0), 0);
  const capacity = effective.Administration;

  return {
    base,
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
    orgsActive: active,
    orgCount: orgs.length,
    orgCapacity: {
      usedTiers,
      // One org tier per point of Administration. With trait modifiers counted
      // this holds across every councilor in a real save; without them it
      // appears violated by 40% of them.
      capacity,
      effectiveAdministration: capacity,
      withinCapacity: usedTiers <= capacity,
      spare: capacity - usedTiers
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
    .filter(c => factionId === null || Number(c?.factionId) === Number(factionId))
    .map(c => {
      const resolved = buildCouncilorAttributes(c, { traitStatMods });
      return {
        councilorId: c?.ID ?? null,
        name: c?.displayName || 'Unknown',
        base: resolved.base[attribute],
        orgBonus: resolved.orgBonuses[attribute],
        effective: resolved.effective[attribute],
        orgsActive: resolved.orgsActive
      };
    })
    .sort((a, b) => b.effective - a.effective || b.base - a.base);

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
