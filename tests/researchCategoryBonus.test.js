// Per-category research bonuses, from FIVE sources, and the flat duration that
// names them without applying them.
//
// TWO OF THE FIVE SOURCES ARE NOT IN ANY `techBonuses` ARRAY. Alien-activity
// investigations are a plain integer on the faction and grant Xenology; a
// fielded ship's Mobile Space Science Lab grants SpaceScience and cannot be
// read from this snapshot shape at all. The tests below pin that the first is
// counted and that the second is DECLARED unhandled rather than silently
// omitted, because a lower bound presented as a total is the same defect as a
// fabricated figure.
//
// THE DIMINISHING-RETURNS RULE IS QUANTIFIED (wiki, `Technology` rev
// 2026-05-06) and applies per source type above 50%, investigations exempt.
// It is exercised against a synthetic 60% source, because no source type on
// any real campaign here reaches the threshold and a rule tested only where it
// is the identity is not tested.
//
// Every assertion about a bonus VALUE is derived (a sum equals the sum of its
// own listed sources; a synthetic module contributes its own template's figure;
// the investigation contribution is count x the stated rate) rather than pinned
// to 0.20 or 0.44, because the campaign moves and a fixture captured from
// today's output would pass by construction.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const snapshotBuilder = require('../server/snapshotBuilder');
const snapshotIdentity = require('../server/snapshotIdentity');
const intelligenceFilter = require('../server/intelligenceFilter');
const { makeSaveData } = require('./fixtures/syntheticSave');
const { buildTechBonusCatalogue } = require('../server/snapshot/templates');
const { monthsAtIncome } = require('../shared/researchAvailability.mjs');
const {
  CATEGORY_BONUS_RULES,
  CATEGORY_BONUS_SOURCE_TYPES,
  CATEGORY_BONUS_STATES,
  CATEGORY_DURATION_STATES,
  CATEGORY_RATE_MODEL,
  MEASURED_INCOME_BASIS,
  UNHANDLED_SOURCE_TYPES,
  applyDiminishingReturns,
  buildResearchCategoryBonuses,
  categoryBonusCaveat,
  categoryBonusSummary,
  monthsAtIncomeForCategory
} = require('../shared/researchCategoryBonus.mjs');

const OBSERVER = 4712;
const MODES = ['omniscient', 'player'];

// A module template that grants a bonus, chosen from the installed templates at
// run time rather than named here, so this file does not hardcode a campaign's
// or a patch's choice of lab.
const CATALOGUE = buildTechBonusCatalogue();
const GRANTING_MODULE = Object.entries(CATALOGUE.habModules)
  .filter(([, entry]) => entry.bonuses.length === 1)
  .sort((a, b) => a[0].localeCompare(b[0]))[0];

function filtered(save, mode) {
  const raw = snapshotBuilder.buildRawSnapshot(save);
  const identity = snapshotIdentity.createSnapshotIdentity(
    { fullPath: 'synthetic.gz', lastModified: new Date('2025-01-01T00:00:00Z'), saveHash: 'x' },
    'initiative'
  );
  return intelligenceFilter.applyFilter({ ...raw, ...identity }, mode, OBSERVER);
}

/** A synthetic save carrying the given modules on the observer's own station. */
const saveWithModules = (habModules) => makeSaveData({ habModules });

/** A hand-built snapshot, for the org and trait paths the synthetic save has no fixture for. */
function snapshotWith({
  catalogue = CATALOGUE, habModules = [], orgs = [], traits = [], alienInvestigations
} = {}) {
  const observer = { ID: OBSERVER, displayName: 'the Initiative', totalResearch: 1000 };
  // Only set when the caller asks: the default snapshot must exercise the
  // "field absent" path, which must NOT read as zero investigations.
  if (alienInvestigations !== undefined) observer.alienInvestigations = alienInvestigations;
  return {
    techBonusCatalogue: catalogue,
    factions: [observer],
    habModules,
    councilors: [{ ID: 100, displayName: 'Ada Lovelace', factionId: OBSERVER, orgs, traits }]
  };
}

const poweredModule = (templateName, habName = 'Nightingale Station') => ({
  factionId: OBSERVER,
  templateName,
  habName,
  powered: true,
  destroyed: false,
  decommissioning: false,
  constructionCompleted: true,
  constructionStatus: 'operational'
});

// ---------------------------------------------------------------------------
// 1. THE CATALOGUE IS READ FROM THE TEMPLATES, AND CARRIES THE STACKING RULE
// ---------------------------------------------------------------------------

test('the catalogue is distilled from the installed templates, not hardcoded', () => {
  assert.ok(CATALOGUE.categories.length > 0, 'the research-category vocabulary must be populated');
  // Derived, not pinned: the vocabulary comes from the templates' own
  // techCategory field, so every category a bonus can name must be in it.
  for (const category of CATALOGUE.categories) {
    assert.equal(typeof category, 'string');
    assert.notEqual(category, '');
  }
  assert.ok(CATALOGUE.scanned.habModules >= CATALOGUE.scanned.habModulesGranting);
  assert.ok(CATALOGUE.scanned.orgs >= CATALOGUE.scanned.orgsGranting);
  assert.ok(CATALOGUE.scanned.traits >= CATALOGUE.scanned.traitsGranting);
  assert.ok(CATALOGUE.scanned.habModulesGranting > 0, 'some hab module must grant a research bonus');
  assert.ok(CATALOGUE.scanned.orgsGranting > 0, 'some org must grant a research bonus');
});

test('every bonus-granting hab module carries the diminishing-returns rule', () => {
  // Asserted over whatever the install carries rather than against a count, so
  // a patch that exempts one module fails here.
  const entries = Object.entries(CATALOGUE.habModules);
  assert.ok(entries.length > 0, 'the fixture needs bonus-granting modules to check');
  for (const [name, entry] of entries) {
    assert.equal(entry.diminishingReturns, true,
      `${name}: a hab-module bonus without the stacking rule would change how the sum must be reported`);
  }
  // The SHIPPED DATA still does not carry the constant -- the wiki does. If a
  // patch ever ships it, the wiki claim can be replaced by a measurement.
  assert.equal(CATALOGUE.diminishingReturnsConstantAvailable, false,
    'the templates name TechBonusDiminishingReturns without quantifying it; only the wiki states the curve');
});

// ---------------------------------------------------------------------------
// 1b. THE WIKI RULES ARE CITED, DATED, AND LABELLED AS CLAIMS
// ---------------------------------------------------------------------------

test('both wiki-sourced constants carry a dated citation and say they are claims, not measurements', () => {
  // CLAUDE.md: a domain claim needs a dated citation, and a judgement must say
  // it is one. Neither constant is in the shipped data, so neither may be
  // presented in the same voice as the reconstruction that was verified
  // against ALLOCATION_MODEL.
  assert.match(CATEGORY_BONUS_RULES.claimStatus, /WIKI CLAIM/);
  assert.match(CATEGORY_BONUS_RULES.claimStatus, /not measured/i);
  assert.equal(CATEGORY_BONUS_RULES.sources.length, 2, 'one page per constant');
  for (const source of CATEGORY_BONUS_RULES.sources) {
    assert.match(source, /Terra Invicta wiki/, 'the source must be named');
    assert.match(source, /20\d\d-\d\d-\d\d/, `a claim with no date is not a citation: ${source}`);
  }
  // 1.0 shipped 2026-01-05; a pre-1.0 revision would not be valid verification.
  for (const source of CATEGORY_BONUS_RULES.sources) {
    const revision = source.match(/revision timestamp (20\d\d-\d\d-\d\d)/);
    assert.ok(revision, `the revision date must be stated: ${source}`);
    assert.ok(revision[1] >= '2026-01-05', `${revision[1]} predates the 1.0 release and cannot verify 1.0 behaviour`);
  }
  assert.match(CATEGORY_BONUS_RULES.investigationBasis, /Aliens/);
  assert.match(CATEGORY_BONUS_RULES.diminishingReturnsBasis, /Technology/);
  // The grouping is a reading of an ambiguous sentence and must admit it.
  assert.match(CATEGORY_BONUS_RULES.diminishingReturnsGroupingBasis, /JUDGEMENT/);
});

// ---------------------------------------------------------------------------
// 1c. THE DIMINISHING-RETURNS CURVE
// ---------------------------------------------------------------------------

test('the diminishing-returns curve is the identity below the threshold and bends above it', () => {
  const threshold = CATEGORY_BONUS_RULES.diminishingReturnsThreshold;
  assert.equal(threshold, 0.5);

  // Below and AT the threshold: untouched. "exceeds 50%" is a strict
  // inequality, so exactly 50% must pass through.
  for (const base of [0, 0.03, 0.2, 0.44, 0.5]) {
    assert.equal(applyDiminishingReturns(base), base, `${base} is at or below the threshold`);
  }

  // Above it: the wiki curve, computed here independently of the source.
  for (const base of [0.6, 1.0, 2.0]) {
    const expected = 0.5 + 0.5 * (base - 0.5) / (base + 1.5);
    const actual = applyDiminishingReturns(base);
    assert.ok(Math.abs(actual - expected) < 1e-6, `${base}: expected ${expected}, got ${actual}`);
    assert.ok(actual < base, `${base}: diminishing returns must reduce, never raise`);
    assert.ok(actual > threshold, `${base}: and never below the threshold it starts from`);
  }
  // The curve is bounded: it approaches but never reaches 100%.
  assert.ok(applyDiminishingReturns(1e6) < 1.0);

  // Exempt sources skip it entirely, however large.
  assert.equal(applyDiminishingReturns(2.0, { exempt: true }), 2.0);

  // Absent stays null. `Number(null) === 0` would make an unreadable base read
  // as a measured zero bonus.
  for (const base of [null, undefined, '', 'x']) {
    assert.equal(applyDiminishingReturns(base), null, `${JSON.stringify(base)} must not become 0`);
  }
});

// ---------------------------------------------------------------------------
// 2. A SUM IS THE SUM OF ITS OWN NAMED SOURCES -- DERIVED, NEVER PINNED
// ---------------------------------------------------------------------------

test('a category sum equals the sum of the sources it lists, and names each one', () => {
  const [templateName, entry] = GRANTING_MODULE;
  const category = entry.bonuses[0].category;
  const model = buildResearchCategoryBonuses(snapshotWith({
    habModules: [poweredModule(templateName, 'Alpha'), poweredModule(templateName, 'Beta')]
  }), { observerId: OBSERVER });

  assert.equal(model.available, true, model.reason);
  const row = model.categories[category];
  assert.equal(row.state, CATEGORY_BONUS_STATES.boosted);
  assert.equal(row.sourceCount, 2, 'both modules must appear as sources');
  // DERIVED: the total is whatever the two listed sources add up to, and each
  // source's figure is whatever the shipped template says. Nothing here knows
  // that the template's own bonus happens to be 0.1 today.
  const fromSources = row.sources.reduce((sum, source) => sum + source.bonus, 0);
  assert.ok(Math.abs(row.summedBonus - fromSources) < 1e-9,
    'the reported total must be reproducible from the listed sources');
  assert.ok(Math.abs(row.summedBonus - entry.bonuses[0].bonus * 2) < 1e-9,
    'and each source must contribute exactly what its own template grants');
  for (const source of row.sources) {
    assert.equal(source.kind, 'hab-module');
    assert.equal(source.templateName, templateName);
    assert.ok(source.location, 'a source must say where it is, or the figure is not checkable');
  }
});

test('a hab-module bonus below the threshold IS the effective bonus -- the rule is now quantified', () => {
  const [templateName, entry] = GRANTING_MODULE;
  const category = entry.bonuses[0].category;
  const model = buildResearchCategoryBonuses(snapshotWith({
    habModules: [poweredModule(templateName)]
  }), { observerId: OBSERVER });
  const row = model.categories[category];
  assert.ok(row.summedBonus > 0, 'the sum is stated');
  assert.ok(row.summedBonus <= CATEGORY_BONUS_RULES.diminishingReturnsThreshold,
    'this test needs a source type below the threshold to be meaningful');
  assert.equal(row.effectiveBonus, row.summedBonus,
    'below 50% the curve is the identity, so a null here would be a withheld number that IS known');
  assert.equal(row.effectiveBonusUnavailableReason, null);
  assert.equal(row.anySourceTypeDiminished, false);
});

test('a source type ABOVE the threshold is diminished, and only that type', () => {
  // No real campaign here reaches 50% on one source type, so the curve has to
  // be driven with a synthetic catalogue or it is never exercised at all.
  const category = CATALOGUE.categories[0];
  const catalogue = {
    ...CATALOGUE,
    habModules: { BigLab: { displayName: 'Big Lab', bonuses: [{ category, bonus: 0.30 }], diminishingReturns: true } },
    orgs: { SmallOrg: { displayName: 'Small Org', bonuses: [{ category, bonus: 0.07 }], diminishingReturns: false } }
  };
  const model = buildResearchCategoryBonuses(snapshotWith({
    catalogue,
    habModules: [poweredModule('BigLab', 'A'), poweredModule('BigLab', 'B')],
    orgs: [{ templateName: 'SmallOrg', displayName: 'Small Org' }]
  }), { observerId: OBSERVER });

  const row = model.categories[category];
  // Two 0.30 hab modules subtotal 0.60, which exceeds 50%; the 0.07 org does not.
  assert.ok(Math.abs(row.summedBonus - 0.67) < 1e-9, `raw sum should be 0.67, got ${row.summedBonus}`);
  const habActual = 0.5 + 0.5 * (0.60 - 0.5) / (0.60 + 1.5);
  const expected = habActual + 0.07;
  assert.ok(Math.abs(row.effectiveBonus - expected) < 1e-6,
    `expected ${expected} (hab ${habActual} + org 0.07), got ${row.effectiveBonus}`);
  assert.ok(row.effectiveBonus < row.summedBonus, 'the curve must have bitten');
  assert.deepEqual(row.diminishedSourceTypes, [CATEGORY_BONUS_SOURCE_TYPES.habModule],
    'the org subtotal is below the threshold and must be untouched');
  assert.equal(row.anySourceTypeDiminished, true);

  // The per-type breakdown must be checkable, not just the total.
  const hab = row.bySourceType.find(g => g.sourceType === CATEGORY_BONUS_SOURCE_TYPES.habModule);
  const org = row.bySourceType.find(g => g.sourceType === CATEGORY_BONUS_SOURCE_TYPES.org);
  assert.ok(Math.abs(hab.summedBonus - 0.60) < 1e-9);
  assert.ok(Math.abs(hab.effectiveBonus - habActual) < 1e-6);
  assert.equal(hab.diminished, true);
  assert.equal(org.effectiveBonus, org.summedBonus);
  assert.equal(org.diminished, false);
});

test('an org or trait source stacks additively', () => {
  const orgEntry = Object.entries(CATALOGUE.orgs)
    .filter(([, e]) => e.bonuses.length === 1).sort((a, b) => a[0].localeCompare(b[0]))[0];
  assert.ok(orgEntry, 'the installed templates must carry at least one bonus-granting org');
  const [orgTemplate, entry] = orgEntry;
  const category = entry.bonuses[0].category;
  const model = buildResearchCategoryBonuses(snapshotWith({
    orgs: [{ templateName: orgTemplate, displayName: 'Test Org' }]
  }), { observerId: OBSERVER });
  const row = model.categories[category];
  assert.equal(row.state, CATEGORY_BONUS_STATES.boosted);
  assert.equal(row.anySourceTypeDiminished, false);
  assert.equal(row.effectiveBonus, row.summedBonus);
  assert.equal(row.sources[0].kind, CATEGORY_BONUS_SOURCE_TYPES.org);
});

// ---------------------------------------------------------------------------
// 2b. ALIEN-ACTIVITY INVESTIGATIONS -- THE SOURCE NO TEMPLATE CARRIES
// ---------------------------------------------------------------------------

test('investigations contribute count x the stated rate to Xenology, and nothing to anything else', () => {
  const category = CATEGORY_BONUS_RULES.investigationCategory;
  const count = 7;
  const model = buildResearchCategoryBonuses(snapshotWith({ alienInvestigations: count }),
    { observerId: OBSERVER });

  assert.equal(model.alienInvestigations, count);
  assert.equal(model.alienInvestigationsState, 'measured');
  const row = model.categories[category];
  assert.equal(row.state, CATEGORY_BONUS_STATES.boosted);
  // DERIVED from the count and the module's own stated rate, not pinned to 0.07.
  const expected = count * CATEGORY_BONUS_RULES.investigationBonusEach;
  assert.ok(Math.abs(row.summedBonus - expected) < 1e-9, `expected ${expected}, got ${row.summedBonus}`);
  assert.equal(row.sourceCount, 1, 'the whole investigation total is one source, not one per investigation');
  assert.equal(row.sources[0].kind, CATEGORY_BONUS_SOURCE_TYPES.alienInvestigation);
  assert.equal(row.sources[0].count, count);
  assert.equal(row.sources[0].templateName, null, 'there is no template to name -- the effect is code-side');

  // Xenology only. Every other category must be a measured zero.
  for (const other of CATALOGUE.categories.filter(c => c !== category)) {
    assert.equal(model.categories[other].state, CATEGORY_BONUS_STATES.measuredZero,
      `${other}: investigations grant Xenology alone`);
  }
});

test('investigations stack with hab modules on the same category, additively', () => {
  const category = CATEGORY_BONUS_RULES.investigationCategory;
  // A synthetic Xenology-granting module, so this does not depend on which lab
  // the install happens to ship.
  const catalogue = {
    ...CATALOGUE,
    habModules: { XenoLab: { displayName: 'Xeno Lab', bonuses: [{ category, bonus: 0.1 }], diminishingReturns: true } }
  };
  const count = 24;
  const model = buildResearchCategoryBonuses(snapshotWith({
    catalogue, alienInvestigations: count,
    habModules: [poweredModule('XenoLab', 'A'), poweredModule('XenoLab', 'B')]
  }), { observerId: OBSERVER });

  const row = model.categories[category];
  const expected = 0.2 + count * CATEGORY_BONUS_RULES.investigationBonusEach;
  assert.ok(Math.abs(row.summedBonus - expected) < 1e-9, `expected ${expected}, got ${row.summedBonus}`);
  assert.equal(row.effectiveBonus, row.summedBonus, 'neither source type reaches the threshold');
  assert.equal(row.sourceCount, 3, 'two modules and the investigation total');
  assert.equal(row.bySourceType.length, 2, 'grouped by source type, not by individual source');
});

test('investigations are EXEMPT from diminishing returns even far above the threshold', () => {
  // The one behaviour that distinguishes this source type from every other.
  const category = CATEGORY_BONUS_RULES.investigationCategory;
  const count = 120; // 120% -- well past the 50% threshold
  const model = buildResearchCategoryBonuses(snapshotWith({ alienInvestigations: count }),
    { observerId: OBSERVER });
  const row = model.categories[category];
  const raw = count * CATEGORY_BONUS_RULES.investigationBonusEach;
  assert.ok(Math.abs(row.summedBonus - raw) < 1e-9);
  assert.equal(row.effectiveBonus, row.summedBonus,
    'a diminished investigation total would contradict the exemption the wiki states');
  assert.ok(row.effectiveBonus > CATEGORY_BONUS_RULES.diminishingReturnsThreshold);
  assert.deepEqual(row.diminishedSourceTypes, []);
  assert.equal(row.bySourceType[0].exemptFromDiminishingReturns, true);
  assert.ok(CATEGORY_BONUS_RULES.diminishingReturnsExempt
    .includes(CATEGORY_BONUS_SOURCE_TYPES.alienInvestigation));
});

test('an unreadable investigation count is null and makes Xenology a lower bound, never zero', () => {
  const category = CATEGORY_BONUS_RULES.investigationCategory;
  // No `alienInvestigations` on the faction at all.
  const absent = buildResearchCategoryBonuses(snapshotWith({}), { observerId: OBSERVER });
  assert.equal(absent.alienInvestigations, null, 'Number(undefined) is NaN and Number(null) is 0; neither is a count');
  assert.equal(absent.alienInvestigationsState, 'unresolved');
  assert.equal(absent.alienInvestigationsBonus, null);
  assert.equal(absent.categories[category].isLowerBound, true);
  assert.match(absent.categories[category].lowerBoundReason, /alienInvestigations/);

  // A MEASURED zero is a different fact and must not be reported as a floor
  // for that reason.
  const zero = buildResearchCategoryBonuses(snapshotWith({ alienInvestigations: 0 }), { observerId: OBSERVER });
  assert.equal(zero.alienInvestigations, 0);
  assert.equal(zero.alienInvestigationsState, 'measured');
  assert.equal(zero.alienInvestigationsBonus, 0);
  assert.equal(zero.categories[category].state, CATEGORY_BONUS_STATES.measuredZero);
  assert.equal(zero.categories[category].isLowerBound, false,
    'zero investigations, measured, is a complete answer for this source');
});

// ---------------------------------------------------------------------------
// 2c. THE SOURCE THIS SNAPSHOT CANNOT READ IS DECLARED, NOT OMITTED
// ---------------------------------------------------------------------------

test('the ship Mobile Space Science Lab source is named as unhandled, with its reason', () => {
  // The wiki names five sources. Three are template sweeps, one is the faction
  // integer above, and this one cannot be read from the snapshot at all. An
  // unreadable source that nothing mentions turns a floor into a stated total.
  assert.ok(UNHANDLED_SOURCE_TYPES.length > 0, 'the fifth source must be declared somewhere');
  const ship = UNHANDLED_SOURCE_TYPES
    .find(e => e.sourceType === CATEGORY_BONUS_SOURCE_TYPES.shipUtilityModule);
  assert.ok(ship, 'the ship utility-module source must be declared');
  assert.match(ship.grantedBy, /Mobile Space Science Lab/);
  assert.ok(ship.reason.length > 0, 'an unhandled source with no reason is just an omission');
  assert.ok(ship.wouldNeed.length > 0, 'and it must say what would fix it');

  const model = buildResearchCategoryBonuses(snapshotWith({}), { observerId: OBSERVER });
  for (const category of ship.categories) {
    assert.equal(model.categories[category].isLowerBound, true,
      `${category}: a category with an unreadable source is a floor, even at zero`);
  }
  // And a category NOT touched by an unhandled source is not falsely flagged.
  const untouched = CATALOGUE.categories
    .filter(c => !ship.categories.includes(c) && c !== CATEGORY_BONUS_RULES.investigationCategory);
  assert.ok(untouched.length > 0);
  assert.equal(model.categories[untouched[0]].isLowerBound, false);
});

test('a category with no source is a MEASURED zero, and an unreadable model is null', () => {
  const model = buildResearchCategoryBonuses(snapshotWith({}), { observerId: OBSERVER });
  const empty = model.categories[CATALOGUE.categories[0]];
  assert.equal(empty.state, CATEGORY_BONUS_STATES.measuredZero);
  assert.equal(empty.summedBonus, 0, 'the sources were enumerated and none grants this category anything');
  assert.equal(empty.sourceCount, 0);

  // Absent stays null: no catalogue means the question was never asked, which
  // is a different fact from an answer of zero.
  const unread = buildResearchCategoryBonuses({ factions: [{ ID: OBSERVER }] }, { observerId: OBSERVER });
  assert.equal(unread.available, false);
  assert.match(unread.reason, /techBonuses catalogue/);
  assert.equal(unread.bonusFor('Xenology').summedBonus, null,
    'an unread model must not report zero, which reads as "measured, and there is none"');
});

// ---------------------------------------------------------------------------
// 3. AN UNPOWERED OR INCOMPLETE MODULE CONTRIBUTES NOTHING
// ---------------------------------------------------------------------------

test('a synthetic powered, complete module DOES contribute -- the control for the exclusions', () => {
  const [templateName, entry] = GRANTING_MODULE;
  const category = entry.bonuses[0].category;
  for (const mode of MODES) {
    const snapshot = filtered(saveWithModules([{ id: 900, templateName }]), mode);
    const model = buildResearchCategoryBonuses(snapshot, { observerId: OBSERVER });
    const row = model.categories[category];
    assert.equal(row.state, CATEGORY_BONUS_STATES.boosted,
      `${mode}: without this the exclusion tests below would pass vacuously`);
    assert.ok(Math.abs(row.summedBonus - entry.bonuses[0].bonus) < 1e-9, `${mode}: derived from the template`);
  }
});

for (const [label, moduleFlags, excludedKey] of [
  ['unpowered', { powered: false }, 'unpowered'],
  ['still under construction', { constructionCompleted: false }, 'incomplete'],
  ['destroyed', { destroyed: true }, 'destroyed'],
  ['decommissioning', { decommissioning: true }, 'decommissioning']
]) {
  test(`a ${label} module contributes nothing, and the exclusion is counted`, () => {
    const [templateName, entry] = GRANTING_MODULE;
    const category = entry.bonuses[0].category;
    for (const mode of MODES) {
      const snapshot = filtered(saveWithModules([{ id: 900, templateName, ...moduleFlags }]), mode);
      const model = buildResearchCategoryBonuses(snapshot, { observerId: OBSERVER });
      const row = model.categories[category];
      assert.equal(row.state, CATEGORY_BONUS_STATES.measuredZero,
        `${mode}: a ${label} lab must grant nothing`);
      assert.equal(row.summedBonus, 0, `${mode}: and contribute nothing to the sum`);
      assert.ok(model.excludedModules[excludedKey] >= 1,
        `${mode}: the exclusion must be visible, not silent (${JSON.stringify(model.excludedModules)})`);
    }
  });
}

test('an unknown power state is not a powered lab', () => {
  // `powered` is tri-state on the snapshot. Null means the save did not carry
  // it, which is not the same as "on".
  const [templateName, entry] = GRANTING_MODULE;
  const category = entry.bonuses[0].category;
  const model = buildResearchCategoryBonuses(snapshotWith({
    habModules: [{ ...poweredModule(templateName), powered: null }]
  }), { observerId: OBSERVER });
  assert.equal(model.categories[category].state, CATEGORY_BONUS_STATES.measuredZero);
  assert.equal(model.excludedModules.unpowered, 1);
});

// ---------------------------------------------------------------------------
// 4. A CATEGORY THE TEMPLATES DO NOT KNOW IS NEVER GUESSED ONTO A NEIGHBOUR
// ---------------------------------------------------------------------------

test('a grant naming a category outside the vocabulary is reported, not mapped', () => {
  // Two shipped orgs really do name "Information", which is not a category any
  // project or tech carries. Mapping it onto "InformationScience" would move a
  // duration on a guess, so it is surfaced instead.
  const bogus = 'NotARealResearchCategory';
  assert.ok(!CATALOGUE.categories.includes(bogus));
  const catalogue = {
    ...CATALOGUE,
    orgs: { ...CATALOGUE.orgs, TestOrg: { displayName: 'Test Org', bonuses: [{ category: bogus, bonus: 0.5 }], diminishingReturns: false } }
  };
  const model = buildResearchCategoryBonuses(snapshotWith({
    catalogue, orgs: [{ templateName: 'TestOrg', displayName: 'Test Org' }]
  }), { observerId: OBSERVER });

  assert.equal(model.unknownCategoryGrantCount, 1);
  assert.equal(model.unknownCategoryGrants[0].category, bogus);
  assert.match(model.unknownCategoryNote, new RegExp(bogus));
  for (const row of Object.values(model.categories)) {
    assert.ok(!row.sources.some(source => source.templateName === 'TestOrg'),
      'an unattributable grant must not land in any real category');
  }
  assert.equal(model.bonusFor(bogus).state, CATEGORY_BONUS_STATES.unknownCategory);
});

// ---------------------------------------------------------------------------
// 5. THE MECHANISM PINS -- AND THE DURATION STAYS FLAT ANYWAY
// ---------------------------------------------------------------------------

test('the rate model records a pin with zero free parameters, and says what it does NOT license', () => {
  assert.equal(CATEGORY_RATE_MODEL.pinned, true);
  assert.equal(CATEGORY_RATE_MODEL.freeParameters, 0,
    'a model with a fitted parameter fits rather than tests, and must not be called pinned');
  assert.ok(CATEGORY_RATE_MODEL.measuredOn.length > 0, 'a measurement with no stated basis is an opinion');
  assert.match(CATEGORY_RATE_MODEL.measuredOn, /MD5/, 'the game writes saves mid-run; a live-save comparison is not evidence');
  assert.ok(CATEGORY_RATE_MODEL.method.includes('RATIO'),
    'the comparison must be relative, or income drift confounds it');
  // Every term must be READ, or "zero free parameters" is not true.
  for (const term of ['base', 'categoryBonus', 'projectBonus']) {
    assert.ok(CATEGORY_RATE_MODEL.termsRead[term], `${term} must state where it was read from`);
  }
  assert.match(CATEGORY_RATE_MODEL.termsRead.projectBonus, /cachedYearlyRevenue\.Projects/);
  assert.match(CATEGORY_RATE_MODEL.termsRead.categoryBonus, /investigations/);

  // The naive model is still refuted, and the record must say WHY it failed
  // rather than leaving the previous run's diagnosis standing.
  assert.equal(CATEGORY_RATE_MODEL.naiveModelReproduces, false);
  assert.equal(CATEGORY_RATE_MODEL.naiveModelObservedRatio.length, 2, 'two independent intervals');
  assert.match(CATEGORY_RATE_MODEL.whyThePreviousRunCouldNotFit, /ProjectBonus/);

  // A pin that overstates its reach is worse than no pin. The terms the data
  // could not exercise must be listed.
  assert.ok(CATEGORY_RATE_MODEL.untested.length >= 2,
    'the decay term and the diminishing-returns curve were both inert in this data');
  assert.equal(CATEGORY_RATE_MODEL.durationsStillFlat, true);
  assert.match(CATEGORY_RATE_MODEL.durationsStillFlatReason, /2\.11/,
    'the reason durations stay flat is the size of the allocation multiplier, and it must be stated');
});

test('the measurement is recorded in the spec, with its numbers', () => {
  const spec = fs.readFileSync(
    path.join(__dirname, '..', 'docs', 'research-category-rate-spec.md'), 'utf8'
  );
  assert.match(spec, /1\.206823/, 'the first interval\'s measured per-pip ratio');
  assert.match(spec, /1\.208696/, 'the second interval\'s measured per-pip ratio');
  assert.match(spec, /1\.207071/, 'what the pinned model predicts for it');
  assert.match(spec, /1\.885714/, 'the independent project-vs-global-tech ratio the pin also has to hit');
  assert.match(spec, /0\.95/, 'the ProjectBonus read from cachedYearlyRevenue.Projects');
  assert.match(spec, /2\.11/, 'the allocation multiplier that keeps durations flat');
  assert.match(spec, /alienInvestigations/, 'the source the template sweep could not see');
  assert.match(spec, /2026-05-06/, 'the Technology page revision date');
  assert.match(spec, /2026-04-05/, 'the Aliens page revision date');
});

test('a boosted category KEEPS its flat duration and names the bonus it does not apply', () => {
  const [templateName, entry] = GRANTING_MODULE;
  const category = entry.bonuses[0].category;
  const model = buildResearchCategoryBonuses(snapshotWith({
    habModules: [poweredModule(templateName)]
  }), { observerId: OBSERVER });

  const duration = monthsAtIncomeForCategory(10000, 1000, model.bonusFor(category));
  // The decision that changed: withdrawing thirteen usable durations to correct
  // three to five per cent was the wrong trade.
  assert.equal(duration.months, 10, 'the flat figure stands');
  assert.equal(duration.state, CATEGORY_DURATION_STATES.flatRateBoosted);
  assert.equal(duration.flatRateMonths, 10);
  // The EFFECTIVE bonus, which is what a reader should act on.
  assert.equal(duration.categoryBonus, model.categories[category].effectiveBonus);
  assert.equal(duration.categoryBonusSummed, model.categories[category].summedBonus);
  assert.equal(duration.categoryRateModel, CATEGORY_RATE_MODEL);

  // And the label a consumer prints says the bonus is NOT applied, without
  // claiming a direction or size for the true figure -- the pinned model says
  // the dominant error is elsewhere.
  const caveat = categoryBonusCaveat(duration.categoryBonus === null
    ? { state: duration.state }
    : { state: duration.state, categoryResearchBonus: duration.categoryBonus });
  assert.match(caveat, /flat rate/);
  assert.match(caveat, /not applied/);
  assert.doesNotMatch(caveat, /shorter|faster|sooner/i,
    'claiming the true figure is "slightly shorter" would be a claim the measurement contradicts');
});

test('no duration is ever the flat figure divided by (1 + bonus)', () => {
  // The specific wrong answer this model still refuses. The flat figure stands
  // UNADJUSTED; a naive correction would land within rounding of `naive`.
  const [templateName, entry] = GRANTING_MODULE;
  const category = entry.bonuses[0].category;
  const model = buildResearchCategoryBonuses(snapshotWith({
    habModules: [poweredModule(templateName)]
  }), { observerId: OBSERVER });
  const bonus = model.categories[category].effectiveBonus;
  assert.ok(bonus > 0, 'the test needs a real bonus, or it passes vacuously');
  const naive = Math.round((10000 / 1000) / (1 + bonus) * 10) / 10;
  const duration = monthsAtIncomeForCategory(10000, 1000, model.bonusFor(category));
  assert.notEqual(duration.months, naive);
  assert.equal(duration.months, monthsAtIncome(10000, 1000),
    'the boosted duration must be exactly the flat one, digit for digit');
});

test('an unboosted category keeps its flat duration, because the flat rate is right there', () => {
  const model = buildResearchCategoryBonuses(snapshotWith({}), { observerId: OBSERVER });
  const duration = monthsAtIncomeForCategory(7500, 1000, model.bonusFor(CATALOGUE.categories[0]));
  assert.equal(duration.months, 7.5);
  assert.equal(duration.state, CATEGORY_DURATION_STATES.flatRate);
  assert.equal(duration.categoryBonus, 0);
});

test('an unresolvable category and an UNCHECKED one both keep the flat duration, labelled', () => {
  const model = buildResearchCategoryBonuses(snapshotWith({}), { observerId: OBSERVER });

  // The model IS available and cannot place this category. What is unknown is
  // whether a bonus applies -- not the arithmetic underneath, which is the same
  // cost over the same income.
  for (const category of [null, '', 'NotARealResearchCategory']) {
    const duration = monthsAtIncomeForCategory(7500, 1000, model.bonusFor(category));
    assert.equal(duration.months, 7.5, `${JSON.stringify(category)}: the flat figure is still the flat figure`);
    assert.equal(duration.state, CATEGORY_DURATION_STATES.unresolvedCategory);
    assert.equal(duration.categoryBonus, null, 'and no bonus may be invented for it');
  }

  // The model is NOT available (a snapshot published before the catalogue
  // existed). Nothing was measured either way, so the pre-existing flat figure
  // is passed through unchanged and LABELLED. This state was a good call and
  // must survive.
  const unread = buildResearchCategoryBonuses({ factions: [{ ID: OBSERVER }] }, { observerId: OBSERVER });
  const legacy = monthsAtIncomeForCategory(7500, 1000, unread.bonusFor('Xenology'));
  assert.equal(legacy.months, 7.5);
  assert.equal(legacy.state, CATEGORY_DURATION_STATES.unchecked);
  assert.match(legacy.basis, /could not be resolved|has not been checked/);

  // The three labelled states must be distinguishable to a consumer, or the
  // label is decoration.
  const caveats = new Set([
    CATEGORY_DURATION_STATES.flatRateBoosted,
    CATEGORY_DURATION_STATES.unresolvedCategory,
    CATEGORY_DURATION_STATES.unchecked
  ].map(state => categoryBonusCaveat({ state, categoryResearchBonus: 0.03 })));
  assert.equal(caveats.size, 3, 'each labelled state must read differently');
  // An unlabelled state adds nothing, so a caller can concatenate blindly.
  assert.equal(categoryBonusCaveat({ state: CATEGORY_DURATION_STATES.flatRate }), '');
  assert.equal(categoryBonusCaveat({}), '');
  assert.equal(categoryBonusCaveat(), '');
});

test('an unmeasured income is its own state, and never zero months', () => {
  const model = buildResearchCategoryBonuses(snapshotWith({}), { observerId: OBSERVER });
  for (const income of [null, 0, undefined, '']) {
    const duration = monthsAtIncomeForCategory(7500, income, model.bonusFor(CATALOGUE.categories[0]));
    assert.equal(duration.months, null, `income ${JSON.stringify(income)}: "0 months" would read as immediate`);
    assert.equal(duration.state, CATEGORY_DURATION_STATES.unmeasuredIncome);
  }
});

// ---------------------------------------------------------------------------
// 6. ENGINEERS ARE NOT APPLIED TWICE
// ---------------------------------------------------------------------------

test('a duration computed from measured income is unchanged by the engineer total', () => {
  // The player runs +95% from engineers. It is ALREADY inside the measured
  // research income, so nothing here may multiply by it again. The proof is
  // that the flat path is exactly cost / income and moves only when income
  // moves -- not when an engineer figure appears beside it.
  const model = buildResearchCategoryBonuses(snapshotWith({}), { observerId: OBSERVER });
  const unboosted = model.bonusFor(CATALOGUE.categories[0]);
  const income = 2937;
  const baseline = monthsAtIncomeForCategory(10000, income, unboosted);

  for (const engineerTotal of [0, 0.95, 1.95, 19]) {
    // The engineer figure exists in the world; the duration must not see it.
    const withEngineers = buildResearchCategoryBonuses({
      ...snapshotWith({}),
      factions: [{
        ID: OBSERVER, displayName: 'the Initiative', totalResearch: income,
        engineerResearchMultiplier: engineerTotal, researchBreakdown: { engineers: engineerTotal }
      }]
    }, { observerId: OBSERVER });
    const duration = monthsAtIncomeForCategory(10000, income, withEngineers.bonusFor(CATALOGUE.categories[0]));
    assert.equal(duration.months, baseline.months,
      `engineer total ${engineerTotal} must not move a duration priced from measured income`);
  }

  // And the flat path agrees to the digit with the un-category-aware function
  // it replaced, so no multiplier crept in on the way.
  assert.equal(baseline.months, monthsAtIncome(10000, income));
  assert.equal(baseline.months, Math.round((10000 / income) * 10) / 10);
});

test('wherever the measured income is reported, it says what is already inside it', () => {
  assert.match(MEASURED_INCOME_BASIS, /engineer/i);
  assert.match(MEASURED_INCOME_BASIS, /double-count/i);
});

// ---------------------------------------------------------------------------
// 7. BOTH MODES, THROUGH THE WHOLE PIPELINE
// ---------------------------------------------------------------------------

test('the catalogue survives both filter branches', () => {
  for (const mode of MODES) {
    const snapshot = filtered(saveWithModules([]), mode);
    assert.ok(snapshot.techBonusCatalogue, `${mode}: the catalogue must reach the projection`);
    assert.ok(snapshot.techBonusCatalogue.categories.length > 0, `${mode}: with its vocabulary intact`);
  }
});

test('the observer resolves identically in player and omniscient mode', () => {
  const [templateName] = GRANTING_MODULE;
  const save = saveWithModules([{ id: 900, templateName }, { id: 901, templateName, powered: false }]);
  const serialise = (mode) => {
    const model = buildResearchCategoryBonuses(filtered(save, mode), { observerId: OBSERVER });
    return JSON.stringify(categoryBonusSummary(model));
  };
  assert.equal(serialise('player'), serialise('omniscient'),
    'the observer\'s own orgs, habs and traits are visible in player mode; a difference means a leak or a loss');
});

test('the serialisable summary carries the figures and drops the accessor', () => {
  const model = buildResearchCategoryBonuses(snapshotWith({
    habModules: [poweredModule(GRANTING_MODULE[0])]
  }), { observerId: OBSERVER });
  const summary = categoryBonusSummary(model);
  assert.equal(typeof summary.bonusFor, 'undefined', 'a function does not survive a JSON response');
  assert.equal(summary.available, true);
  assert.deepEqual(summary.categories, model.categories);
  assert.equal(summary.model, CATEGORY_RATE_MODEL);

  const unread = categoryBonusSummary(buildResearchCategoryBonuses({}, { observerId: OBSERVER }));
  assert.equal(unread.available, false);
  assert.ok(unread.reason, 'an unavailable summary must say why');
  assert.equal(unread.model, CATEGORY_RATE_MODEL, 'and still carry the model that explains the refusal');
});

// ---------------------------------------------------------------------------
// 8. THE LIVE SAVE
// ---------------------------------------------------------------------------

test('on the live save every boosted category is reproducible from its own sources', (t) => {
  let snapshot;
  try {
    const { loadFilteredSnapshot } = require('../server/snapshotLoader');
    snapshot = loadFilteredSnapshot({ mode: 'omniscient', observer: OBSERVER });
  } catch (err) {
    t.skip(`Skipping live save test: ${err.message}`);
    return;
  }
  const model = buildResearchCategoryBonuses(snapshot, { observerId: OBSERVER });
  assert.equal(model.available, true, model.reason);
  assert.ok(model.boostedCategories.length > 0, 'the observer holds bonus-granting orgs or habs');

  for (const category of model.boostedCategories) {
    const row = model.categories[category];
    const fromSources = row.sources.reduce((sum, source) => sum + source.bonus, 0);
    assert.ok(Math.abs(row.summedBonus - fromSources) < 1e-9,
      `${category}: the stated total must be reproducible from the sources it lists`);
    // And the effective figure must be reproducible from the per-type grouping,
    // so the diminishing-returns arithmetic is checkable too.
    const fromTypes = row.bySourceType.reduce((sum, group) => sum + group.effectiveBonus, 0);
    assert.ok(Math.abs(row.effectiveBonus - fromTypes) < 1e-6,
      `${category}: the effective total must be the sum of its per-type actual bonuses`);

    for (const source of row.sources) {
      if (source.kind === CATEGORY_BONUS_SOURCE_TYPES.alienInvestigation) {
        // No template to trace to -- the effect is code-side. What must hold is
        // that the figure is the count times the stated rate and nothing else.
        assert.equal(source.templateName, null);
        assert.ok(Math.abs(source.bonus - source.count * CATEGORY_BONUS_RULES.investigationBonusEach) < 1e-9,
          `${category}: the investigation contribution must be count x the stated rate`);
        assert.equal(source.count, model.alienInvestigations);
        continue;
      }
      // Every other source must trace back to a shipped template, with the SAME
      // figure. This is the check that would catch an invented bonus.
      const map = source.kind === CATEGORY_BONUS_SOURCE_TYPES.habModule ? CATALOGUE.habModules
        : (source.kind === CATEGORY_BONUS_SOURCE_TYPES.org ? CATALOGUE.orgs : CATALOGUE.traits);
      const entry = map[source.templateName];
      assert.ok(entry, `${category}: source ${source.templateName} must exist in the templates`);
      const grant = entry.bonuses.find(b => b.category === category);
      assert.ok(grant, `${category}: the template must actually grant this category`);
      assert.equal(source.bonus, grant.bonus, `${category}: the figure must be the template's own`);
      assert.equal(source.diminishingReturns, entry.diminishingReturns);
    }
  }

  // The investigation count must reach the model from the live save, or the
  // whole Xenology figure silently reverts to the template-only sweep.
  assert.equal(model.alienInvestigationsState, 'measured',
    'the live save carries alienInvestigations; an unresolved state here means it is not reaching the snapshot');
  assert.equal(typeof model.alienInvestigations, 'number');
});

test('on the live save the investigation source is inside the Xenology figure, not beside it', (t) => {
  let snapshot;
  try {
    const { loadFilteredSnapshot } = require('../server/snapshotLoader');
    snapshot = loadFilteredSnapshot({ mode: 'omniscient', observer: OBSERVER });
  } catch (err) {
    t.skip(`Skipping live save test: ${err.message}`);
    return;
  }
  const model = buildResearchCategoryBonuses(snapshot, { observerId: OBSERVER });
  const category = CATEGORY_BONUS_RULES.investigationCategory;
  const row = model.categories[category];
  if (model.alienInvestigations === 0) {
    t.skip('the observer has run no investigations on this save, so there is nothing to fold in');
    return;
  }
  const investigationSource = row.sources
    .find(s => s.kind === CATEGORY_BONUS_SOURCE_TYPES.alienInvestigation);
  assert.ok(investigationSource, `${category} must carry the investigation source`);
  // DERIVED: the total must exceed the template-only sweep by exactly the
  // investigation contribution. This is the regression the previous round hit.
  const templateOnly = row.sources
    .filter(s => s.kind !== CATEGORY_BONUS_SOURCE_TYPES.alienInvestigation)
    .reduce((sum, s) => sum + s.bonus, 0);
  assert.ok(Math.abs(row.summedBonus - (templateOnly + investigationSource.bonus)) < 1e-9);
  assert.ok(row.summedBonus > templateOnly,
    'a Xenology figure equal to the template sweep means investigations were dropped');
});

test('the snapshot builder carries the investigation count as a tri-state, through both modes', () => {
  // This covers `server/snapshot/factions.js`, which the hand-built snapshots
  // above bypass entirely. It exists because `Number(undefined) || 0` passed
  // every other test in this file: the model-level tests never see the builder.
  for (const mode of MODES) {
    // Absent from the save: null, never 0.
    const absent = filtered(makeSaveData({}), mode);
    const absentObserver = (absent.factions || []).find(f => String(f.ID) === String(OBSERVER));
    assert.equal(absentObserver.alienInvestigations, null,
      `${mode}: a save with no alienInvestigations must not report a measured zero`);
    assert.equal(
      buildResearchCategoryBonuses(absent, { observerId: OBSERVER }).alienInvestigationsState,
      'unresolved', `${mode}: and the model must say the count is unresolved`);

    // A real zero survives as a zero.
    const zero = filtered(makeSaveData({ factionOptions: { 4712: { alienInvestigations: 0 } } }), mode);
    const zeroObserver = (zero.factions || []).find(f => String(f.ID) === String(OBSERVER));
    assert.equal(zeroObserver.alienInvestigations, 0, `${mode}: a measured zero must survive as zero`);
    assert.equal(
      buildResearchCategoryBonuses(zero, { observerId: OBSERVER }).alienInvestigationsState,
      'measured', `${mode}: and be reported as measured`);

    // A real count survives intact and reaches the bonus.
    const some = filtered(makeSaveData({ factionOptions: { 4712: { alienInvestigations: 13 } } }), mode);
    const someObserver = (some.factions || []).find(f => String(f.ID) === String(OBSERVER));
    assert.equal(someObserver.alienInvestigations, 13, `${mode}: the count must reach the snapshot`);
    const model = buildResearchCategoryBonuses(some, { observerId: OBSERVER });
    const xeno = model.categories[CATEGORY_BONUS_RULES.investigationCategory];
    assert.ok(Math.abs(xeno.summedBonus - 13 * CATEGORY_BONUS_RULES.investigationBonusEach) < 1e-9,
      `${mode}: and be priced at the stated rate (got ${xeno.summedBonus})`);
  }
});

test('a rival faction\'s investigation count is redacted in player mode, to null and not to zero', () => {
  // A rival's count converts directly into their Xenology research rate, so it
  // belongs with `currentProjects` and `availableProjectNames`. Reporting a
  // rival at 0 would be a confident claim from no evidence.
  const RIVAL = 4713;
  const ALIEN = 4717;
  // DISTINCT counts, and none of them absent. A fixture where the rivals carry
  // nothing would pass whether or not the redaction exists -- which is exactly
  // how a first draft of this test passed against a deliberately broken filter.
  const save = makeSaveData({
    factionOptions: {
      4712: { alienInvestigations: 13 },
      4713: { alienInvestigations: 41 },
      4717: { alienInvestigations: 57 }
    }
  });
  const player = filtered(save, 'player');
  const omniscient = filtered(save, 'omniscient');

  const find = (snapshot, id) => (snapshot.factions || []).find(f => String(f.ID) === String(id));
  const observerPlayer = find(player, OBSERVER);
  assert.ok(observerPlayer, 'the observer must be present in player mode');
  // The observer's own count is legitimately known and must survive both modes
  // identically -- redacting it would break the observer's own Xenology figure.
  assert.equal(observerPlayer.alienInvestigations, 13);
  assert.equal(observerPlayer.alienInvestigations, find(omniscient, OBSERVER).alienInvestigations);
  // Control: the rivals' counts really are there to be leaked.
  assert.equal(find(omniscient, RIVAL).alienInvestigations, 41);
  assert.equal(find(omniscient, ALIEN).alienInvestigations, 57);

  for (const id of [RIVAL, ALIEN]) {
    assert.equal(find(player, id).alienInvestigations, null,
      `${id}: a rival investigation count in player mode is a research-state leak`);
  }
  // And the whole player payload must not contain a rival's count ANYWHERE --
  // scanned, not pinned to one field. Four past leaks had exactly the shape of
  // a derived field nulled while its raw twin survived somewhere else.
  const scan = JSON.stringify(player);
  for (const count of [41, 57]) {
    assert.ok(!scan.includes(`"alienInvestigations":${count}`),
      `a rival's count ${count} appears somewhere in the player payload`);
  }
});

// ---------------------------------------------------------------------------
// 9. THE FIGURES REACH THE AI SURFACES
// ---------------------------------------------------------------------------
//
// CLAUDE.md: a figure that exists only in the browser is invisible to every
// LLM consumer, which is half the point of this project. These two tests are
// the guard against that, and they are why this file knows about the war-room
// export and the intel registry at all.

test('the per-category bonuses reach the war-room markdown export, in both modes', () => {
  const { renderWarRoomMarkdown } = require('../shared/markdownExports.mjs');
  const save = makeSaveData({
    habModules: [{ id: 900, templateName: GRANTING_MODULE[0] }],
    factionOptions: { 4712: { alienInvestigations: 9 } }
  });
  for (const mode of MODES) {
    const snapshot = filtered(save, mode);
    const markdown = renderWarRoomMarkdown(snapshot);
    assert.match(markdown, /Research Category Bonuses/,
      `${mode}: the block must be in the export, not only in the browser`);
    // The investigation count is the whole point -- it is in no template, so an
    // agent that only reads this file cannot derive it from anything else.
    assert.match(markdown, /9 alien-activity investigation\(s\)/, `${mode}: with the count stated`);
    assert.match(markdown, /2026-04-05/, `${mode}: and its wiki citation dated`);
    // And the export must say the durations beside it are unadjusted, or a
    // reader will assume the bonus was applied.
    assert.match(markdown, /FLAT-RATE and do NOT apply these bonuses/, `${mode}: with the caveat`);
    // The byte ceiling is enforced elsewhere; this only checks the block did
    // not push the document over it.
    assert.ok(Buffer.byteLength(markdown, 'utf8') <= 30720,
      `${mode}: the war room must stay inside its 30 KB budget`);
  }
});

test('the per-category bonuses reach /api/intel/research, in both modes', () => {
  const { buildResourceProjection } = require('../shared/intel/registry.mjs');
  const save = makeSaveData({
    habModules: [{ id: 900, templateName: GRANTING_MODULE[0] }],
    factionOptions: { 4712: { alienInvestigations: 9 } }
  });
  for (const mode of MODES) {
    const snapshot = filtered(save, mode);
    const projection = buildResourceProjection(snapshot, 'research', { mode });
    const bonuses = projection.categoryBonuses;
    assert.ok(bonuses, `${mode}: /api/intel/research must carry categoryBonuses`);
    assert.equal(bonuses.available, true, `${mode}: ${bonuses.reason}`);
    assert.equal(bonuses.alienInvestigations, 9, `${mode}: with the count read from the save`);
    assert.equal(typeof bonuses.bonusFor, 'undefined', 'a function does not survive a JSON response');
    // The rules and their dated citations must travel with the figures, or an
    // agent reading this endpoint cannot tell a wiki claim from a measurement.
    assert.ok(bonuses.rules, `${mode}: the rules must travel with the numbers`);
    assert.match(bonuses.rules.claimStatus, /WIKI CLAIM/);
    assert.ok(bonuses.unhandledSourceTypes.length > 0,
      `${mode}: the source that could not be read must be named on the wire too`);
    assert.ok(bonuses.model.pinned, `${mode}: and the rate model that explains the flat durations`);
  }
});
