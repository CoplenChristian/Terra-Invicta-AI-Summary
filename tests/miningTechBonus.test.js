// Mine-output multipliers from completed projects, and the three derived
// surfaces that were computing raw deposit rates as though they were output.
//
// THE GATING FACT THESE TESTS DEFEND. `TIHabSiteState.<resource>_day` is the
// DEPOSIT's rate: 280 of the save's 409 sites have no mine and no owner and
// still carry it, and 405 of 409 are byte-identical between two saves 5.3
// in-game years apart across 90 ownership changes, 102 mine-tier changes and
// fourteen newly completed mining-bonus projects. So the derived monthly
// figures were PRE-bonus and understated a bonused resource by 1.15 per grant.
// If a future save ever bakes the bonus in, `the observer's own income
// reconciles at exactly 1.15^n` below is the test that breaks.
//
// STACKING IS MEASURED, NOT ASSUMED. Humanity First holds both noble-metal
// projects and its noble-metal income reads 1.15^2 = 1.3225 against its own
// unbonused resources, not 1.30 and not a 1.15 cap.
//
// The values asserted here are derived from the rule table and from the save's
// own `cachedYearlyRevenue`, never pinned to a figure captured from this
// change's output -- a fixture taken from post-change output passes by
// construction.

const { test } = require('node:test');
const assert = require('node:assert');

const {
  ADDITIVE_MINING_BONUS_PROJECTS,
  MINING_BONUS_RULES,
  MINING_BONUS_STACKING,
  MINING_BONUS_STATES,
  UNMODELLED_FACTORS,
  applyMiningTechBonus,
  buildMiningTechBonuses,
  miningTechBonusCaveat
} = require('../shared/miningTechBonus.mjs');
const readers = require('../server/briefing/readers');
const { scoreMiningSiteCandidate } = require('../shared/intelResources.mjs');
const { renderWarRoomMarkdown, WAR_ROOM_BYTE_BUDGET } = require('../shared/markdownExports.mjs');
const { makeMarkdownSnapshot } = require('./fixtures/syntheticMarkdownSnapshot');
const { queryIntel } = require('../server/snapshotLoader');
const { loadFixtureFilteredSnapshot, queryFixtureIntel } = require('./fixtures/frozenSnapshots');

const OBSERVER = 4712;
const WATER_RULE = MINING_BONUS_RULES.find(rule => rule.key === 'water');
const NOBLES_RULE = MINING_BONUS_RULES.find(rule => rule.key === 'nobleMetals');

// ---------------------------------------------------------------------------
// The multiplier itself
// ---------------------------------------------------------------------------

test('one completed grant is 1.15 and names the project it came from', () => {
  const bonuses = buildMiningTechBonuses(
    { ID: OBSERVER, completedProjects: [WATER_RULE.projects[1], 'Project_Unrelated'] },
    { projectListComplete: true }
  );
  const water = bonuses.byResource.water;
  assert.strictEqual(bonuses.available, true);
  assert.strictEqual(water.state, MINING_BONUS_STATES.boosted);
  assert.strictEqual(water.multiplier, MINING_BONUS_STACKING.perGrant);
  assert.strictEqual(water.grantCount, 1);
  assert.deepStrictEqual(water.grants, [WATER_RULE.projects[1]]);
  assert.match(water.source, new RegExp(WATER_RULE.projects[1]));
  assert.match(water.source, new RegExp(WATER_RULE.effect));
  assert.deepStrictEqual(bonuses.boostedResources, ['water']);
});

test('two grants for one resource stack MULTIPLICATIVELY at 1.15^2, not 1.30 and not a 1.15 cap', () => {
  const bonuses = buildMiningTechBonuses(
    { ID: 4711, completedProjects: [...NOBLES_RULE.projects] },
    { projectListComplete: true }
  );
  const nobles = bonuses.byResource.nobleMetals;
  const squared = Number(Math.pow(MINING_BONUS_STACKING.perGrant, 2).toFixed(6));
  assert.strictEqual(nobles.grantCount, 2);
  assert.strictEqual(nobles.multiplier, squared);
  assert.strictEqual(squared, 1.3225, 'the derived square is the 1.3225 measured on Humanity First');
  assert.notStrictEqual(nobles.multiplier, 1.30, 'additive stacking would read 1.30');
  assert.notStrictEqual(nobles.multiplier, MINING_BONUS_STACKING.perGrant, 'a cap would read 1.15');
  assert.strictEqual(MINING_BONUS_STACKING.mode, 'multiplicative');
});

test('a readable list with no grant is measured-none at exactly 1, which is NOT the same state as unknown', () => {
  const bonuses = buildMiningTechBonuses({ ID: OBSERVER, completedProjects: [] }, { projectListComplete: true });
  for (const rule of MINING_BONUS_RULES) {
    const entry = bonuses.byResource[rule.key];
    assert.strictEqual(entry.state, MINING_BONUS_STATES.measuredNone, `${rule.key} was measured, and grants nothing`);
    assert.strictEqual(entry.multiplier, 1);
    assert.strictEqual(entry.grantCount, 0);
    assert.strictEqual(entry.source, null);
  }
  assert.strictEqual(bonuses.available, true);
  assert.notStrictEqual(MINING_BONUS_STATES.measuredNone, MINING_BONUS_STATES.unknown);
});

test('the three SpaceMiningBonus projects are an ADDITIVE fraction and never become a multiplier', () => {
  const additive = ADDITIVE_MINING_BONUS_PROJECTS.map(entry => entry.project);
  assert.ok(additive.includes('Project_GoldRush'));
  const bonuses = buildMiningTechBonuses({ ID: 4716, completedProjects: additive }, { projectListComplete: true });
  for (const rule of MINING_BONUS_RULES) {
    assert.strictEqual(bonuses.byResource[rule.key].multiplier, 1,
      `${rule.key} must not pick up a x1.15 from an additive +0.05/+0.1 grant`);
  }
  assert.deepStrictEqual(bonuses.boostedResources, []);
  // And the shape difference is stated, not just implied by the value.
  for (const entry of ADDITIVE_MINING_BONUS_PROJECTS) {
    assert.ok(entry.value === 0.05 || entry.value === 0.1, 'the additive grants are fractions, not multipliers');
  }
  assert.ok(UNMODELLED_FACTORS.some(f => /SpaceMiningBonus/.test(f.factor)),
    'the unmodelled additive interaction is declared, not silently omitted');
});

// ---------------------------------------------------------------------------
// Absent stays null
// ---------------------------------------------------------------------------

test('an unreadable or truncated project list is UNKNOWN with a null multiplier, never 1.0', () => {
  const cases = [
    ['no faction at all', buildMiningTechBonuses(null, { projectListComplete: true })],
    ['faction with no project array', buildMiningTechBonuses({ ID: OBSERVER }, { projectListComplete: true })],
    ['list not known to be complete', buildMiningTechBonuses(
      { ID: 4713, completedProjects: [...WATER_RULE.projects] },
      { projectListComplete: false }
    )],
    ['completeness never stated', buildMiningTechBonuses({ ID: 4713, completedProjects: [...WATER_RULE.projects] })]
  ];
  for (const [label, bonuses] of cases) {
    assert.strictEqual(bonuses.available, false, `${label}: not available`);
    assert.ok(bonuses.unavailableReason, `${label}: says why`);
    for (const rule of MINING_BONUS_RULES) {
      const entry = bonuses.byResource[rule.key];
      assert.strictEqual(entry.state, MINING_BONUS_STATES.unknown, `${label}: ${rule.key} is unknown`);
      assert.strictEqual(entry.multiplier, null, `${label}: ${rule.key} multiplier is null, never 1.0`);
      assert.strictEqual(entry.grantCount, null, `${label}: ${rule.key} grant count is null, never 0`);
      assert.ok(entry.unknownReason, `${label}: ${rule.key} says why`);
    }
  }
});

test('a truncated rival list must not produce a rival multiplier, which is the player-mode leak shape', () => {
  // server/intelligenceFilter.js keeps `isObserver ? completedProjects
  // : completedProjects.slice(0, 5)`, so a rival's list in player mode is
  // known-incomplete. A multiplier read from it would be WRONG, not absent.
  const truncated = buildMiningTechBonuses(
    { ID: 4713, completedProjects: [...WATER_RULE.projects, ...NOBLES_RULE.projects, 'Project_X'] },
    { projectListComplete: false }
  );
  assert.strictEqual(truncated.byResource.water.multiplier, null);
  assert.strictEqual(truncated.byResource.nobleMetals.multiplier, null);
  assert.deepStrictEqual(truncated.boostedResources, []);
});

test('applyMiningTechBonus keeps an absent figure null and never invents a zero', () => {
  const bonuses = buildMiningTechBonuses({ ID: OBSERVER, completedProjects: [WATER_RULE.projects[1]] }, { projectListComplete: true });
  for (const absent of [null, undefined, '', NaN]) {
    const out = applyMiningTechBonus(absent, bonuses, 'water');
    assert.strictEqual(out.value, null, `${String(absent)} stays null`);
    assert.strictEqual(out.applied, false);
  }
  // A measured zero is a measured zero, not an absence.
  assert.strictEqual(applyMiningTechBonus(0, bonuses, 'water').value, 0);
});

test('an unresolved multiplier leaves the RAW figure in place, flagged and explained', () => {
  const unknown = buildMiningTechBonuses({ ID: OBSERVER });
  const out = applyMiningTechBonus(100, unknown, 'water');
  assert.strictEqual(out.value, 100, 'the raw figure survives; it is not nulled away');
  assert.strictEqual(out.raw, 100);
  assert.strictEqual(out.applied, false, 'and it is NOT presented as bonus-adjusted');
  assert.strictEqual(out.multiplier, null, 'the multiplier is unknown, not 1.0');
  assert.strictEqual(out.state, MINING_BONUS_STATES.unknown);
  assert.ok(out.reason, 'and the reason is carried to the consumer');
  assert.match(miningTechBonusCaveat(unknown), /UNRESOLVED/);
});

test('a resource with no mining bonus rule is passed through untouched and says so', () => {
  const bonuses = buildMiningTechBonuses({ ID: OBSERVER, completedProjects: [WATER_RULE.projects[1]] }, { projectListComplete: true });
  const out = applyMiningTechBonus(42, bonuses, 'money');
  assert.strictEqual(out.value, 42);
  assert.strictEqual(out.applied, false);
  assert.match(out.reason, /not one of the five mined resources/);
});

// ---------------------------------------------------------------------------
// The three derived surfaces
// ---------------------------------------------------------------------------

const bonusedObserver = () => buildMiningTechBonuses(
  { ID: OBSERVER, completedProjects: [WATER_RULE.projects[1]] },
  { projectListComplete: true }
);

test('getMiningRateSummary adjusts only the bonused resource and names the source', () => {
  const habSites = [{ ID: 1, factionId: OBSERVER, water: 10, volatiles: 20, metals: 30, nobleMetals: 4, fissiles: 1 }];
  const raw = readers.getMiningRateSummary(habSites, [], OBSERVER, null);
  const adjusted = readers.getMiningRateSummary(habSites, [], OBSERVER, bonusedObserver());
  assert.match(raw, /Water 10\.0\/day/);
  assert.match(adjusted, /Water 11\.5\/day/, '10 x 1.15');
  for (const unchanged of ['Volatiles 20.0/day', 'Metals 30.0/day', 'NobleMetals 4.0/day', 'Fissiles 1.0/day']) {
    assert.ok(raw.includes(unchanged) && adjusted.includes(unchanged), `${unchanged} is unmoved`);
  }
  assert.match(adjusted, new RegExp(WATER_RULE.projects[1]), 'the source is nameable from the sentence itself');
});

test('getMiningRateSummary says the rates are raw when the bonus cannot be resolved', () => {
  const habSites = [{ ID: 1, factionId: OBSERVER, water: 10, volatiles: 20 }];
  const summary = readers.getMiningRateSummary(habSites, [], OBSERVER, buildMiningTechBonuses({ ID: OBSERVER }));
  assert.match(summary, /Water 10\.0\/day/);
  assert.match(summary, /UNRESOLVED/, 'an unresolved bonus is announced, not silently treated as none');
});

test('buildAdvisableHabs adjusts the Advise-economics monthly output and records what it did', () => {
  const habs = [{ ID: 7197, displayName: 'Base', factionId: OBSERVER }];
  const habSites = [{ ID: 1, habId: 7197, water: 1, volatiles: 2, metals: 3, nobleMetals: null, fissiles: 0 }];

  const rawBuilt = readers.buildAdvisableHabs(habs, habSites, OBSERVER)[0];
  assert.strictEqual(rawBuilt.water, 30, 'unchanged when no bonus is supplied');
  assert.strictEqual(rawBuilt.resourceOutputBonus.water.applied, false);

  const built = readers.buildAdvisableHabs(habs, habSites, OBSERVER, bonusedObserver())[0];
  assert.strictEqual(built.water, 34.5, '1/day x 30 x 1.15');
  assert.strictEqual(built.volatiles, 60, 'unbonused resources are byte-identical');
  assert.strictEqual(built.metals, 90);
  assert.strictEqual(built.fissiles, 0, 'a measured zero stays a measured zero');
  assert.strictEqual(built.nobleMetals, null, 'an unmeasured resource stays null, never 0');
  assert.strictEqual(built.resourceOutputBonus.water.applied, true);
  assert.strictEqual(built.resourceOutputBonus.water.multiplier, 1.15);
  assert.strictEqual(built.resourceOutputBonus.water.raw, 30, 'the raw figure is still readable beside the adjusted one');
  assert.strictEqual(built.resourceOutputBonus.metals.applied, false);
  assert.match(built.resourceOutputSource, new RegExp(WATER_RULE.projects[1]));
});

test('scoreMiningSiteCandidate reports the adjusted yield, keeps the raw one, and labels both', () => {
  const site = { ID: 5, displayName: 'Rock', siteDensity: 2, water: 1, volatiles: 1, metals: 1, nobleMetals: 1, fissiles: 1 };
  const runways = {};
  const capacity = { headroom: 5, baseHateMultiplier: 0.3, marginalNextMinePenaltyMC: 0 };

  const bare = scoreMiningSiteCandidate(site, runways, capacity);
  assert.strictEqual(bare.yields.water.monthly, 30, 'no bonus supplied leaves the figure unmoved');
  assert.strictEqual(bare.yields.water.bonusApplied, false);
  assert.strictEqual(bare.yields.water.bonusMultiplier, null, 'and unknown is null, not 1.0');
  assert.deepStrictEqual(bare.bonusUnresolvedResources.sort(), ['fissiles', 'metals', 'nobleMetals', 'volatiles', 'water']);
  assert.strictEqual(bare.yieldsBonusAdjusted, false);

  const scored = scoreMiningSiteCandidate(site, runways, capacity, { miningTechBonus: bonusedObserver() });
  assert.strictEqual(scored.yields.water.monthly, 34.5, '1/day x 30 x 1.15');
  assert.strictEqual(scored.yields.water.monthlyRaw, 30, 'the raw deposit figure is still published');
  assert.strictEqual(scored.yields.water.bonusApplied, true);
  assert.strictEqual(scored.yields.water.bonusMultiplier, 1.15);
  assert.match(scored.yields.water.bonusSource, new RegExp(WATER_RULE.projects[1]));
  for (const key of ['volatiles', 'metals', 'nobleMetals', 'fissiles']) {
    assert.strictEqual(scored.yields[key].monthly, 30, `${key} is unmoved`);
    assert.strictEqual(scored.yields[key].bonusApplied, false);
    assert.strictEqual(scored.yields[key].bonusMultiplier, 1, `${key} is a MEASURED 1, not an unknown`);
  }
  assert.deepStrictEqual(scored.bonusUnresolvedResources, []);
  assert.strictEqual(scored.yieldsBonusAdjusted, true);
});

test('an unmeasured site rate stays null after adjustment, in both directions', () => {
  const site = { ID: 6, displayName: 'Unsurveyed', siteDensity: 1, water: null };
  const scored = scoreMiningSiteCandidate(site, {}, { headroom: 1, baseHateMultiplier: 0.3 }, { miningTechBonus: bonusedObserver() });
  assert.strictEqual(scored.yields.water.monthly, null);
  assert.strictEqual(scored.yields.water.monthlyRaw, null);
  assert.ok(scored.unmeasuredResources.includes('water'));
});

// ---------------------------------------------------------------------------
// Against the live save, in BOTH modes
// ---------------------------------------------------------------------------

test('the observer resolves a real mine bonus in player mode as well as omniscient', () => {
  for (const mode of ['player', 'omniscient']) {
    const snapshot = loadFixtureFilteredSnapshot({ mode, observer: OBSERVER });
    const observerFaction = snapshot.factions.find(f => Number(f.ID) === OBSERVER);
    const expected = buildMiningTechBonuses(observerFaction, { projectListComplete: true });
    const payload = queryIntel({ snapshot, endpoint: 'mining-expansion', mode, observer: OBSERVER });
    const bonus = payload.miningTechBonus;
    assert.ok(bonus, `${mode}: the board publishes the bonus block`);
    assert.strictEqual(bonus.available, true,
      `${mode}: the observer's OWN completed-project list is not redacted, so this must resolve`);
    // Provenance, not just plausibility: the published block must be the
    // OBSERVER's, so substituting any other faction's holdings fails here.
    assert.deepStrictEqual(bonus.byResource, expected.byResource,
      `${mode}: the published bonus is built from the observer's own completed projects`);
    assert.ok(bonus.boostedResources.length > 0,
      `${mode}: this save's observer holds at least one mine-output project, so the x1.15 path is exercised `
      + 'end to end. If this ever fails because the campaign moved, the feature has stopped being covered.');
    for (const rule of MINING_BONUS_RULES) {
      const entry = bonus.byResource[rule.key];
      assert.notStrictEqual(entry.state, MINING_BONUS_STATES.unknown, `${mode}: ${rule.key} resolved`);
      assert.ok(typeof entry.multiplier === 'number' && entry.multiplier >= 1);
      // Two granting projects per resource, so the only legal values are
      // 1, 1.15 and 1.15^2. Derived, not pinned to today's campaign.
      const legal = [0, 1, 2].map(n => Number(Math.pow(MINING_BONUS_STACKING.perGrant, n).toFixed(6)));
      assert.ok(legal.includes(entry.multiplier), `${mode}: ${rule.key} multiplier ${entry.multiplier} is 1.15^n`);
      assert.strictEqual(entry.multiplier, Number(Math.pow(MINING_BONUS_STACKING.perGrant, entry.grantCount).toFixed(6)));
    }
    assert.strictEqual(payload.bonusUnresolvedSiteCount, 0, `${mode}: every scored site resolved its multiplier`);
  }
});

test('player mode and omniscient mode agree, because the bonus is the observer\'s own knowledge', () => {
  const player = queryFixtureIntel({ endpoint: 'mining-expansion', mode: 'player', observer: OBSERVER }).miningTechBonus;
  const omni = queryFixtureIntel({ endpoint: 'mining-expansion', mode: 'omniscient', observer: OBSERVER }).miningTechBonus;
  assert.deepStrictEqual(player.byResource, omni.byResource);
});

test('no OTHER faction\'s mining projects leak into the player-mode payload', () => {
  const omniSnapshot = loadFixtureFilteredSnapshot({ mode: 'omniscient', observer: OBSERVER });
  const observerProjects = new Set(
    (omniSnapshot.factions.find(f => Number(f.ID) === OBSERVER)?.completedProjects) || []
  );
  const everyGrant = MINING_BONUS_RULES.flatMap(rule => rule.projects);
  // Grants at least one rival holds and the observer does not. If the observer
  // somehow held all thirteen this test would have nothing to prove, so say so.
  const rivalOnly = everyGrant.filter(project =>
    !observerProjects.has(project)
    && omniSnapshot.factions.some(f => Number(f.ID) !== OBSERVER && (f.completedProjects || []).includes(project))
  );
  assert.ok(rivalOnly.length > 0, 'this save has at least one grant only a rival holds');

  const playerPayload = JSON.stringify(queryFixtureIntel({ endpoint: 'mining-expansion', mode: 'player', observer: OBSERVER }));
  for (const project of rivalOnly) {
    assert.ok(!playerPayload.includes(project),
      `player mode must not name ${project}, which only a rival holds`);
  }
});

test('the observer\'s own income reconciles at exactly 1.15^n, which is what proves the stored rate is pre-bonus', () => {
  // `cachedYearlyRevenue` is the game's own annualised income. If the save's
  // site rates were already bonus-adjusted, the bonused resource would
  // reconcile at the SAME factor as the unbonused ones, and this fails.
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'omniscient', observer: OBSERVER });
  const observer = snapshot.factions.find(f => Number(f.ID) === OBSERVER);
  const bonuses = buildMiningTechBonuses(observer, { projectListComplete: true });
  assert.strictEqual(bonuses.available, true);

  // The mine-module multiplier is not modelled by this change, so reconcile on
  // the RATIO between resources rather than on an absolute figure: within one
  // faction the mine mix is common to all five.
  const MINE_MODIFIER = { OutpostMiningComplex: 1, AutomatedMiningComplex: 1.25, SettlementMiningComplex: 1.5, ColonyMiningComplex: 2, AlienOutpostMiningComplex: 1, AlienSettlementMiningComplex: 2, AlienColonyMiningComplex: 4 };
  const owned = snapshot.habSites.filter(s =>
    Number(s.factionId) === OBSERVER && s.constructionStatus === 'operational' && s.mineModuleTemplate);
  assert.ok(owned.length > 0, 'the observer runs at least one operational mine');

  const REVENUE_KEY = { water: 'Water', volatiles: 'Volatiles', metals: 'Metals', nobleMetals: 'NobleMetals', fissiles: 'Fissiles' };
  const implied = {};
  for (const rule of MINING_BONUS_RULES) {
    const modelled = owned.reduce((sum, s) =>
      sum + (Number(s[rule.key]) || 0) * (MINE_MODIFIER[s.mineModuleTemplate] ?? 1), 0) * (365.25 / 12);
    const reported = Number(observer.financials?.projectedMonthlyIncome?.[REVENUE_KEY[rule.key]]);
    if (!(modelled > 0) || !Number.isFinite(reported)) continue;
    implied[rule.key] = reported / modelled;
  }
  const unbonused = MINING_BONUS_RULES
    .filter(rule => bonuses.byResource[rule.key].grantCount === 0 && implied[rule.key] !== undefined)
    .map(rule => implied[rule.key]);
  assert.ok(unbonused.length >= 2, 'at least two unbonused resources to form a baseline');
  const baseline = unbonused.reduce((a, b) => a + b, 0) / unbonused.length;

  for (const rule of MINING_BONUS_RULES) {
    if (implied[rule.key] === undefined) continue;
    const normalised = implied[rule.key] / baseline;
    const expected = bonuses.byResource[rule.key].multiplier;
    assert.ok(Math.abs(normalised / expected - 1) < 0.005,
      `${rule.key}: income implies x${normalised.toFixed(6)} against the rule table's x${expected}`);
  }
  // And the whole point: at least one resource is genuinely bonused, or the
  // reconciliation above proves nothing about the bonus at all.
  assert.ok(bonuses.boostedResources.length > 0,
    'the observer holds at least one mine-output project, so 1.15 is actually exercised');
});

// ---------------------------------------------------------------------------
// THE AI MARKDOWN EXPORTS
//
// `a615018` applied the multipliers to three derived surfaces and reached none
// of the .md exports, so every agent-facing consumer saw an adjusted figure it
// could not distinguish from a raw one and could not tell which project earned
// it. Per CLAUDE.md that is half this project's readership.
//
// The VALUE assertions below run against the synthetic markdown snapshot, whose
// faction list this file controls outright, so they pin exact strings without
// pinning this campaign's save. The live save is used only for the property
// that both modes agree -- the observer's own completed-project list is the one
// list player mode does not truncate, and that is worth checking rather than
// assuming.
// ---------------------------------------------------------------------------

const WATER_GRANT = WATER_RULE.projects[1];
const NOBLES_GRANTS = NOBLES_RULE.projects;

/** The synthetic war room, with the observer's project list set explicitly. */
function warRoomWith(completedProjects, { mode = 'player', rivalProjects = null } = {}) {
  const snapshot = makeMarkdownSnapshot(mode);
  for (const faction of snapshot.factions) {
    if (Number(faction.ID) === OBSERVER) {
      if (completedProjects !== undefined) faction.completedProjects = completedProjects;
    } else if (rivalProjects !== null) {
      faction.completedProjects = rivalProjects.slice();
    }
  }
  return renderWarRoomMarkdown(snapshot);
}

test('the war room names each multiplier in force AND the project that grants it', () => {
  const markdown = warRoomWith([WATER_GRANT]);

  assert.match(markdown, /\*\*Mine output multipliers:\*\*/,
    'the war room carries a mine-output multiplier line at all');
  assert.ok(markdown.includes(`Water ×1.15 from ${WATER_GRANT}`),
    `the grant is NAMED, not reduced to a bare number: expected "Water ×1.15 from ${WATER_GRANT}"`);
  // A bare multiplier with no project beside it is the failure this pins.
  const bonusLine = markdown.split('\n').find(line => line.includes('Mine output multipliers'));
  assert.ok(/×1\.15 from Project_/.test(bonusLine),
    'every stated multiplier must be attributed to a project');
});

test('the war room states the mine-module multiplier is still excluded, so the figures are a lower bound', () => {
  const markdown = warRoomWith([WATER_GRANT]);
  const moduleFactor = UNMODELLED_FACTORS.find(f => f.factor === 'mine-module miningModifier');

  assert.match(markdown, /LOWER BOUND/, 'an adjusted figure has to be labelled a lower bound');
  assert.match(markdown, /miningModifier/, 'the excluded factor is named');
  assert.ok(markdown.includes(moduleFactor.range),
    'the 1.0-4.0 range is read from UNMODELLED_FACTORS rather than retyped, so the two cannot disagree');
});

test('the war room does not invite the reader to re-apply the bonus to the measured ledger', () => {
  // `monthlyNet` is `summarizeRecentTransactions(...).net` -- the save's own
  // 30-day transaction ledger, which is realised income with every bonus
  // already inside it. Multiplying it again would be the 1.15x error in the
  // opposite direction from the one this change fixed.
  const markdown = warRoomWith([WATER_GRANT]);
  assert.match(markdown, /must NOT be adjusted again/);
  assert.match(markdown, /30-day transaction ledger/);
});

test('a faction whose project list cannot be read is UNKNOWN in the war room, never "no bonus"', () => {
  // The synthetic factions carry no `completedProjects` at all.
  const markdown = warRoomWith(undefined);

  assert.match(markdown, /\*\*Mine output multipliers:\*\* UNKNOWN/,
    'an unreadable list is unknown, not measured');
  assert.match(markdown, /RAW deposit rates/);
  assert.match(markdown, /NOT a measured "no bonus"/);
  assert.doesNotMatch(markdown, /×1 \(list read/,
    'an unread list must not render as a measured absence of bonuses');
  assert.doesNotMatch(markdown, /Mine output multipliers:\*\* none in force/);
});

test('a read list holding no granting project is a measured x1, distinct from unknown', () => {
  const markdown = warRoomWith([]);

  assert.match(markdown, /\*\*Mine output multipliers:\*\* none in force/);
  assert.match(markdown, /×1 \(list read, no completed grant\)/);
  assert.doesNotMatch(markdown, /Mine output multipliers:\*\* UNKNOWN/,
    'a list that WAS read and grants nothing is a different fact from one that could not be read');
});

test('multiplicative stacking reaches the war room as 1.15^2, not 1.30 and not a cap', () => {
  const markdown = warRoomWith(NOBLES_GRANTS.slice());
  const expected = Number(Math.pow(MINING_BONUS_STACKING.perGrant, 2).toFixed(6));

  assert.strictEqual(expected, 1.3225);
  assert.ok(markdown.includes(`Noble metals ×${expected} from ${NOBLES_GRANTS[0]} + ${NOBLES_GRANTS[1]}`),
    'both granting projects are named beside the stacked multiplier');
  assert.match(markdown, /Stacking is multiplicative at ×1\.15 per grant/);
});

test('no rival faction\'s mine bonus reaches a player-mode war room', () => {
  // Every granting project in the table, held by every faction EXCEPT the
  // observer, whose own list is empty. Player mode truncates a rival's list to
  // five entries, so a multiplier read from one would be wrong rather than
  // absent -- and nothing here may read one at all.
  const everyGrant = MINING_BONUS_RULES.flatMap(rule => rule.projects.slice());
  const markdown = warRoomWith([], { mode: 'player', rivalProjects: everyGrant });

  assert.match(markdown, /\*\*Mine output multipliers:\*\* none in force/,
    'the observer holds nothing, so nothing is in force');
  for (const project of everyGrant) {
    assert.ok(!markdown.includes(project),
      `${project} is a rival's completed research and must not appear in a player-mode export`);
  }
});

test('the observer-fallback faction is UNKNOWN, not a rival\'s truncated five entries', () => {
  // `renderWarRoomMarkdown` resolves the observer with `fallbackToFirst: true`,
  // so a payload that does not carry the requested observer answers with
  // whatever faction happens to be first. That faction's completed-project list
  // is NOT the observer's, and in player mode it is truncated to five entries,
  // so a multiplier read from it would be WRONG rather than merely absent.
  const snapshot = makeMarkdownSnapshot('player');
  snapshot.factions = snapshot.factions.filter(f => Number(f.ID) !== OBSERVER);
  // The fallback faction holds a granting project, truncated exactly as
  // server/intelligenceFilter.js truncates a rival's list.
  snapshot.factions[0].completedProjects = [WATER_GRANT, 'Project_A', 'Project_B', 'Project_C', 'Project_D'];

  const markdown = renderWarRoomMarkdown(snapshot);
  assert.match(markdown, /\*\*Mine output multipliers:\*\* UNKNOWN/,
    'a faction that is not the requested observer resolves to unknown');
  assert.ok(!markdown.includes(WATER_GRANT),
    'the fallback faction\'s completed research must not be published as the observer\'s bonus');
  assert.doesNotMatch(markdown, /Water ×1\.15/,
    'no multiplier may be claimed from a list that is not known to be complete');
});

test('the war-room mine-output block is identical in both modes on the live save', () => {
  // `server/intelligenceFilter.js` keeps `isObserver ? f.completedProjects :
  // f.completedProjects.slice(0, 5)`, so the observer's own list survives
  // player mode intact and this block must not degrade there. A feature
  // verified only in omniscient mode is not verified.
  const blockOf = (mode) => {
    const snapshot = loadFixtureFilteredSnapshot({ mode, observer: OBSERVER });
    const lines = renderWarRoomMarkdown(snapshot).split('\n');
    const start = lines.findIndex(line => line.includes('Mine output multipliers'));
    assert.ok(start >= 0, `${mode}: the war room carries the mine-output block`);
    return lines.slice(start, start + 4).join('\n');
  };

  const player = blockOf('player');
  const omniscient = blockOf('omniscient');
  assert.strictEqual(player, omniscient,
    'the observer\'s own project list is not redacted, so the block must read the same in both modes');
  assert.doesNotMatch(player, /UNKNOWN/,
    'the observer\'s own list IS readable in player mode, so this must not fall through to unknown');

  // And whatever multiplier is in force is attributed, on the live save too.
  const observer = loadFixtureFilteredSnapshot({ mode: 'player', observer: OBSERVER })
    .factions.find(f => Number(f.ID) === OBSERVER);
  const bonuses = buildMiningTechBonuses(observer, { projectListComplete: true });
  for (const key of bonuses.boostedResources) {
    const entry = bonuses.byResource[key];
    assert.ok(player.includes(`${entry.label} ×${entry.multiplier} from ${entry.grants.join(' + ')}`),
      `${key}: the live multiplier and its grant are both named`);
  }
});

test('the mine-output block leaves the war room inside its byte budget in both modes', () => {
  for (const mode of ['player', 'omniscient']) {
    const markdown = renderWarRoomMarkdown(loadFixtureFilteredSnapshot({ mode, observer: OBSERVER }));
    const bytes = Buffer.byteLength(markdown, 'utf8');
    assert.ok(bytes < WAR_ROOM_BYTE_BUDGET,
      `${mode}: ${bytes} bytes against the ${WAR_ROOM_BYTE_BUDGET} ceiling`);
  }
});
