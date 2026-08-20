const { test } = require('node:test');
const assert = require('node:assert');

const {
  ATTRIBUTE_NAMES,
  buildCouncilorAttributes,
  effectiveAttributes,
  sumOrgBonuses,
  rankByAttribute,
  orgsAreActive
} = require('../shared/councilorAttributes.mjs');

const OBSERVER = 4712;

// Mirrors what snapshotBuilder derives from TITraitTemplate.json.
// ManagementAI / CognitiveEnhancer are the augmentation line that actually
// moves attributes; Indulgent and Transparent are the kinds that cannot be
// resolved from a councilor record alone.
const TRAIT_MODS = {
  ManagementAI: [{ stat: 'Administration', value: 2, operation: 'Additive', conditional: false }],
  CognitiveEnhancer: [{ stat: 'Science', value: 3, operation: 'Additive', conditional: false }],
  AwkwardGenius: [
    { stat: 'Persuasion', value: -3, operation: 'Additive', conditional: false },
    { stat: 'Science', value: 3, operation: 'Additive', conditional: false }
  ],
  Indulgent: [{ stat: 'Loyalty', value: -4, operation: 'Additive', conditional: true }],
  Transparent: [{ stat: 'ApparentLoyalty', value: 0, operation: 'SetToAnotherAttribute', conditional: false }]
};

// The save stores BASE attributes; the game applies org and trait bonuses at
// resolution time. Reading councilor.attributes directly understates every
// councilor who holds orgs or augmentation traits.
function councilor(overrides = {}) {
  return {
    ID: 1,
    displayName: 'Beth Hofmann',
    factionId: 4712,
    status: 'Active',
    attributes: {
      Persuasion: 11, Investigation: 1, Espionage: 0, Command: 1,
      Administration: 16, Science: 2, Security: 6, Loyalty: 14,
      ApparentLoyalty: 14
    },
    traits: ['ManagementAI', 'Indulgent', 'Transparent'],
    orgs: [
      { id: 100, displayName: 'Jade Applications', tier: 3, bonusesText: '+1 SCI',
        statBonuses: { adm: 0, per: 0, inv: 0, esp: 0, cmd: 0, sci: 1, sec: 0 } },
      { id: 101, displayName: 'Special Activities Section', tier: 3,
        bonusesText: '+3 ADM, +5 INV',
        statBonuses: { adm: 3, per: 0, inv: 5, esp: 0, cmd: 0, sci: 0, sec: 0 } }
    ],
    ...overrides
  };
}

test('exposes the eight 1.0 councilor attributes', () => {
  // 1.0 has eight, not seven -- Loyalty is a real defender attribute.
  assert.strictEqual(ATTRIBUTE_NAMES.length, 8);
  assert.ok(ATTRIBUTE_NAMES.includes('Loyalty'));
});

test('effective attributes are base plus org bonuses', () => {
  const { base, orgBonuses, effective } = buildCouncilorAttributes(councilor());
  assert.strictEqual(base.Science, 2);
  assert.strictEqual(orgBonuses.Science, 1);
  assert.strictEqual(effective.Science, 3);

  assert.strictEqual(base.Administration, 16);
  assert.strictEqual(orgBonuses.Administration, 3);
  assert.strictEqual(effective.Administration, 19);

  assert.strictEqual(effective.Investigation, 6, '1 base + 5 from the org');
});

test('orgs never modify Loyalty', () => {
  // No org carries a loyalty stat; a bonus there would be fabricated.
  const withLoyaltyAttempt = councilor({
    orgs: [{ id: 1, displayName: 'X', tier: 1, statBonuses: { loy: 9, sci: 1 } }]
  });
  const { orgBonuses, effective } = buildCouncilorAttributes(withLoyaltyAttempt);
  assert.strictEqual(orgBonuses.Loyalty, 0);
  assert.strictEqual(effective.Loyalty, 14, 'unchanged from base');
});

test('a detained councilor loses all org bonuses', () => {
  // Wiki: "If a councilor is Detained, then all of their equipped orgs are made
  // inactive and will only be reactivated on the mission phase after release."
  const detained = buildCouncilorAttributes(councilor({ status: 'Detained' }));
  assert.strictEqual(detained.orgsActive, false);
  assert.strictEqual(detained.orgBonuses.Investigation, 0);
  assert.deepStrictEqual(detained.effective, detained.base, 'effective collapses to base');
  // The orgs are still held, just inactive.
  assert.strictEqual(detained.orgCount, 2);
});

test('orgsAreActive is case-insensitive on status', () => {
  assert.strictEqual(orgsAreActive({ status: 'Active' }), true);
  assert.strictEqual(orgsAreActive({ status: 'detained' }), false);
  assert.strictEqual(orgsAreActive({ status: 'DETAINED' }), false);
  assert.strictEqual(orgsAreActive({}), true, 'absent status is not detention');
});

test('a councilor with no orgs is unchanged', () => {
  const bare = buildCouncilorAttributes(councilor({ orgs: [] }));
  assert.deepStrictEqual(bare.effective, bare.base);
  assert.strictEqual(bare.orgCount, 0);
  assert.strictEqual(bare.orgCapacity.usedTiers, 0);
});

test('missing attributes default to zero rather than undefined', () => {
  const sparse = buildCouncilorAttributes({ attributes: { Science: 3 }, orgs: [] });
  assert.strictEqual(sparse.effective.Science, 3);
  assert.strictEqual(sparse.effective.Espionage, 0);
  for (const name of ATTRIBUTE_NAMES) {
    assert.strictEqual(typeof sparse.effective[name], 'number');
  }
});

test('per-org breakdown records which orgs grant attributes', () => {
  const { contributions } = sumOrgBonuses(councilor().orgs);
  assert.strictEqual(contributions.length, 2);

  const sas = contributions.find(c => c.orgId === 101);
  assert.deepStrictEqual(sas.stats, { Investigation: 5, Administration: 3 });
  assert.strictEqual(sas.grantsAttributes, true);

  // An income-only org still appears, flagged as granting nothing.
  const incomeOnly = sumOrgBonuses([
    { id: 5, displayName: 'Bank', tier: 2, statBonuses: {}, income: { money: 50 } }
  ]);
  assert.strictEqual(incomeOnly.contributions[0].grantsAttributes, false);
});

test('org capacity is one tier per point of effective Administration', () => {
  // Counting trait modifiers is what makes this coherent: on base+org alone,
  // 19 of 48 councilors in a real save appear to exceed capacity. With the
  // augmentation traits counted, none do.
  const { orgCapacity } = buildCouncilorAttributes(councilor(), { traitStatMods: TRAIT_MODS });
  assert.strictEqual(orgCapacity.usedTiers, 6);
  assert.strictEqual(orgCapacity.capacity, 21, '16 base + 3 org + 2 ManagementAI');
  assert.strictEqual(orgCapacity.withinCapacity, true);
  assert.strictEqual(orgCapacity.spare, 15);
});

test('states what it does not model', () => {
  const { unmodelled } = buildCouncilorAttributes(councilor());
  assert.ok(unmodelled.some(n => /trait/i.test(n)), 'trait modifiers');
  assert.ok(unmodelled.some(n => /mission phase/i.test(n)), 'newly acquired org delay');
});

test('ranking uses effective, not base, attributes', () => {
  // The case this exists for: a councilor with low base but strong orgs
  // outranks one with higher base and none.
  const roster = [
    councilor({ ID: 1, displayName: 'Low base, strong orgs',
      attributes: { Science: 4 },
      orgs: [{ id: 1, tier: 3, statBonuses: { sci: 7 } }] }),
    councilor({ ID: 2, displayName: 'High base, no orgs',
      attributes: { Science: 9 }, orgs: [] })
  ];

  const [first, second] = rankByAttribute(roster, 'Science', { factionId: 4712 });
  assert.strictEqual(first.name, 'Low base, strong orgs');
  assert.strictEqual(first.effective, 11);
  assert.strictEqual(first.base, 4, 'base alone would have ranked this second');
  assert.strictEqual(second.effective, 9);
});

test('ranking filters by faction and rejects unknown attributes', () => {
  const roster = [
    councilor({ ID: 1, factionId: 4712, attributes: { Science: 5 }, orgs: [] }),
    councilor({ ID: 2, factionId: 4717, attributes: { Science: 99 }, orgs: [] })
  ];
  const ours = rankByAttribute(roster, 'Science', { factionId: 4712 });
  assert.strictEqual(ours.length, 1);

  assert.throws(() => rankByAttribute(roster, 'Charisma'), /Unknown attribute/);
});

test('effectiveAttributes is a shorthand for the resolved block', () => {
  assert.deepStrictEqual(
    effectiveAttributes(councilor()),
    buildCouncilorAttributes(councilor()).effective
  );
});

// --- Trait modifiers ---------------------------------------------------------
// The augmentation/implant traits (ExecutiveAI, CognitiveEnhancer, StealthField
// and friends) are unconditional additive modifiers on real attributes, so they
// are computable and belong in `effective`.

test('unconditional trait modifiers are included in effective', () => {
  const { base, traitBonuses, effective } = buildCouncilorAttributes(
    councilor({ traits: ['ManagementAI', 'CognitiveEnhancer'] }),
    { traitStatMods: TRAIT_MODS }
  );
  assert.strictEqual(base.Administration, 16);
  assert.strictEqual(traitBonuses.Administration, 2, 'ManagementAI');
  assert.strictEqual(traitBonuses.Science, 3, 'CognitiveEnhancer');
  // 16 base + 3 org + 2 trait
  assert.strictEqual(effective.Administration, 21);
});

test('negative trait modifiers reduce the effective value', () => {
  const { traitBonuses, effective } = buildCouncilorAttributes(
    councilor({ traits: ['AwkwardGenius'] }),
    { traitStatMods: TRAIT_MODS }
  );
  assert.strictEqual(traitBonuses.Persuasion, -3);
  assert.strictEqual(effective.Persuasion, 8, '11 base - 3');
});

test('conditional and overriding trait modifiers are named, not applied', () => {
  const resolved = buildCouncilorAttributes(
    councilor({ traits: ['Indulgent', 'Transparent'] }),
    { traitStatMods: TRAIT_MODS }
  );
  // Indulgent is -4 Loyalty but only under a nation condition we cannot see.
  assert.strictEqual(resolved.traitBonuses.Loyalty, 0);
  assert.strictEqual(resolved.effective.Loyalty, 14, 'unchanged from base');

  const reasons = resolved.unresolvedTraitMods;
  assert.ok(reasons.some(r => r.trait === 'Indulgent' && /conditional/.test(r.reason)));
  assert.ok(reasons.some(r => r.trait === 'Transparent' && /overrides/.test(r.reason)));
});

test('trait bonuses survive detention, org bonuses do not', () => {
  // An implant does not stop working because its holder is detained; the wiki
  // only deactivates equipped orgs.
  const resolved = buildCouncilorAttributes(
    councilor({ status: 'Detained', traits: ['ManagementAI'] }),
    { traitStatMods: TRAIT_MODS }
  );
  assert.strictEqual(resolved.orgsActive, false);
  assert.strictEqual(resolved.orgBonuses.Administration, 0, 'orgs deactivated');
  assert.strictEqual(resolved.traitBonuses.Administration, 2, 'implant still applies');
  assert.strictEqual(resolved.effective.Administration, 18, '16 base + 2 trait');
});

test('a councilor with no trait table falls back to orgs only', () => {
  // Callers without template access must still get org-inclusive values.
  const resolved = buildCouncilorAttributes(councilor({ traits: ['ManagementAI'] }));
  assert.strictEqual(resolved.traitBonuses.Administration, 0);
  assert.strictEqual(resolved.effective.Administration, 19, '16 base + 3 org');
});

test('per-trait breakdown records which traits granted what', () => {
  const { traitContributions } = buildCouncilorAttributes(
    councilor({ traits: ['ManagementAI', 'CognitiveEnhancer', 'Indulgent'] }),
    { traitStatMods: TRAIT_MODS }
  );
  const byTrait = Object.fromEntries(traitContributions.map(t => [t.trait, t.stats]));
  assert.deepStrictEqual(byTrait.ManagementAI, { Administration: 2 });
  assert.deepStrictEqual(byTrait.CognitiveEnhancer, { Science: 3 });
  assert.ok(!byTrait.Indulgent, 'a conditional-only trait contributes nothing');
});
