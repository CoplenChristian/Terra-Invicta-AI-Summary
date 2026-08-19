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
// Trait bonuses are deliberately NOT folded into `effective`. Of the 153 trait
// stat modifiers in the 1.0 templates, 36 are conditional on nation state
// (cohesion, inequality, democracy) that a councilor record cannot resolve, and
// some use SetToFixedValue / SetToAnotherAttribute rather than addition. They
// are reported separately so the gap between this and the in-game display is
// explicit rather than silently wrong.
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
 * Effective attributes for one councilor.
 *
 * @param {object} councilor Snapshot councilor (base `attributes`, `orgs`, `status`)
 * @returns {object} base / orgBonuses / effective, plus provenance
 */
export function buildCouncilorAttributes(councilor) {
  const base = zeroed();
  for (const name of ATTRIBUTE_NAMES) {
    base[name] = num(councilor?.attributes?.[name]) ?? 0;
  }

  const orgs = asArray(councilor?.orgs);
  const active = orgsAreActive(councilor);
  const { totals, contributions } = sumOrgBonuses(orgs);

  // A detained councilor keeps their orgs but gets none of their bonuses.
  const orgBonuses = active ? totals : zeroed();
  const effective = zeroed();
  for (const name of ATTRIBUTE_NAMES) {
    effective[name] = base[name] + orgBonuses[name];
  }

  const usedTiers = orgs.reduce((sum, org) => sum + (num(org?.tier) ?? 0), 0);

  return {
    base,
    orgBonuses,
    effective,
    orgsActive: active,
    orgCount: orgs.length,
    orgCapacity: {
      usedTiers,
      // A councilor manages one tier of org per point of Administration, but
      // trait modifiers also feed that stat, so this is reported as context
      // rather than enforced -- 40% of councilors in a real save exceed the
      // base+org figure, which is the traits showing through.
      effectiveAdministration: effective.Administration,
      note: 'Capacity is one org tier per point of Administration; trait modifiers also contribute, so usedTiers may legitimately exceed effectiveAdministration.'
    },
    contributions,
    // Everything this calculation deliberately does not account for, so a
    // mismatch against the in-game display has a stated cause.
    unmodelled: [
      'Trait stat modifiers (many are conditional on nation state, and some override rather than add).',
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
export function rankByAttribute(councilors, attribute, { factionId = null, limit = null } = {}) {
  if (!ATTRIBUTE_NAMES.includes(attribute)) {
    throw new Error(`Unknown attribute "${attribute}". Expected one of: ${ATTRIBUTE_NAMES.join(', ')}`);
  }

  const ranked = asArray(councilors)
    .filter(c => factionId === null || Number(c?.factionId) === Number(factionId))
    .map(c => {
      const resolved = buildCouncilorAttributes(c);
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
