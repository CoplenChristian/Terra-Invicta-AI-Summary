// The mine module's own output multiplier: measured where a mine exists,
// refused as a projection where one does not.
//
// WHAT THESE TESTS DEFEND
// -----------------------
// `TIHabSiteState.<resource>_day` is the DEPOSIT's rate. The mine module built
// on the site multiplies it by 1.0 to 4.0 -- a larger term than the x1.15
// tech bonus and one that applies to all five resources at once. Three facts
// shape every assertion below and each is a measurement, not a convention:
//
//   1. The join is by TEMPLATE NAME, never by tier. `AlienSettlementMiningComplex`
//      is x2.0 at tier 2 where the human `SettlementMiningComplex` is x1.5.
//   2. A NON-OPERATIONAL mine produces nothing. Folding `building` modules into
//      the income model turns Project Exodus's five-resource reconciliation
//      spread from 1.4e-5 into 1.2e+0.
//   3. An UNOWNED site has no module, and the expansion score saturates, so a
//      uniform assumed multiplier REORDERS the board rather than scaling it.
//      That is why the projection is a band published beside the score and is
//      never folded into it.
//
// Values here are derived from the template table and from the save's own
// `financials.projectedMonthlyIncome`, never pinned to a figure captured from
// this change's own output -- a fixture taken from post-change output passes by
// construction.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const {
  MINE_MODULE_MEASURED_ON,
  MINE_MODULE_PROJECTION_POLICY,
  MINE_MODULE_STATES,
  MINE_MODULE_TEMPLATES,
  applyMineModuleMultiplier,
  buildMineModuleCapability,
  buildMineUpgradeOpportunities,
  mineModuleDataAvailable,
  resolveMineModuleMultiplier
} = require('../shared/mineModuleOutput.mjs');
const { applyMiningTechBonus, buildMiningTechBonuses, UNMODELLED_FACTORS } = require('../shared/miningTechBonus.mjs');
const { MINING_RESOURCES } = require('../shared/intelResources.mjs');
const readers = require('../server/briefing/readers');
const { loadFilteredSnapshot, queryIntel } = require('../server/snapshotLoader');

const OBSERVER = 4712;
const OUTPOST = MINE_MODULE_TEMPLATES.find(m => m.template === 'OutpostMiningComplex');
const AUTOMATED = MINE_MODULE_TEMPLATES.find(m => m.template === 'AutomatedMiningComplex');
const SETTLEMENT = MINE_MODULE_TEMPLATES.find(m => m.template === 'SettlementMiningComplex');
const COLONY = MINE_MODULE_TEMPLATES.find(m => m.template === 'ColonyMiningComplex');
const ALIEN_SETTLEMENT = MINE_MODULE_TEMPLATES.find(m => m.template === 'AlienSettlementMiningComplex');

const operationalSite = (template, rates = {}) => ({
  ID: 1,
  displayName: 'Test Site',
  factionId: OBSERVER,
  mineModuleTemplate: template,
  constructionStatus: 'operational',
  ...rates
});

// ---------------------------------------------------------------------------
// 1. The multiplier is read off the template, not the tier
// ---------------------------------------------------------------------------

test('the multiplier comes from the module template, and tier alone would get the alien mine wrong', () => {
  const human = resolveMineModuleMultiplier(operationalSite('SettlementMiningComplex'));
  const alien = resolveMineModuleMultiplier(operationalSite('AlienSettlementMiningComplex'));

  assert.strictEqual(human.state, MINE_MODULE_STATES.measured);
  assert.strictEqual(human.multiplier, 1.5);
  assert.strictEqual(alien.multiplier, 2);
  // Same tier, different multiplier. This is the whole reason the join is by
  // name: a tier-keyed table would understate the alien mine by 25%.
  assert.strictEqual(human.tier, alien.tier);
  assert.notStrictEqual(human.multiplier, alien.multiplier);
});

test('every template row matches the shipped TIHabModuleTemplate.json', () => {
  const templatesDir = 'F:/SteamLibrary/steamapps/common/Terra Invicta/TerraInvicta_Data/StreamingAssets/Templates';
  const file = path.join(templatesDir, 'TIHabModuleTemplate.json');
  if (!fs.existsSync(file)) {
    // The templates are the user's game install, not a repo asset. Skipping is
    // honest; silently passing would let the table drift.
    console.log('    (skipped: game templates not installed at the recorded path)');
    return;
  }
  const shipped = JSON.parse(fs.readFileSync(file, 'utf8')).filter(m => m.mine === true);
  assert.strictEqual(shipped.length, MINE_MODULE_TEMPLATES.length,
    `TIHabModuleTemplate.json carries ${shipped.length} mine modules, the table carries ${MINE_MODULE_TEMPLATES.length}`);
  for (const row of MINE_MODULE_TEMPLATES) {
    const actual = shipped.find(m => m.dataName === row.template);
    assert.ok(actual, `${row.template} is in the shipped templates`);
    assert.strictEqual(Number(actual.miningModifier), row.multiplier, `${row.template} miningModifier`);
    assert.strictEqual(Number(actual.tier), row.tier, `${row.template} tier`);
    assert.strictEqual(actual.requiredProjectName, row.requiredProject, `${row.template} requiredProjectName`);
    assert.strictEqual(actual.upgradesFromName ?? null, row.upgradesFromTemplate, `${row.template} upgradesFromName`);
  }
  // The one that changes the advice: nothing upgrades from the Automated
  // complex, so a faction that built them cannot upgrade them.
  assert.ok(!shipped.some(m => m.upgradesFromName === 'AutomatedMiningComplex'),
    'no shipped mine module upgrades from AutomatedMiningComplex');
});

// ---------------------------------------------------------------------------
// 2. Absent stays null, and "no mine" is not "x1.0"
// ---------------------------------------------------------------------------

test('a site with no mine module is NOT a x1.0 — it has no mined output at all', () => {
  const resolution = resolveMineModuleMultiplier({ ID: 9, water: 5, constructionStatus: 'not-installed' });
  assert.strictEqual(resolution.state, MINE_MODULE_STATES.notBuilt);
  assert.strictEqual(resolution.multiplier, null);

  const applied = applyMineModuleMultiplier(5, resolution);
  assert.strictEqual(applied.value, null, 'no mine means no output, not the deposit rate');
  assert.strictEqual(applied.raw, 5, 'the deposit rate survives beside it');
  assert.strictEqual(applied.applied, false);
  assert.strictEqual(applied.producing, false);
  assert.match(applied.reason, /no mine module/);
});

test('an unrecognised module is UNKNOWN, never 1.0, and the raw rate is kept so the total is honest-low', () => {
  const resolution = resolveMineModuleMultiplier(operationalSite('ModdedGigaMiningComplex'));
  assert.strictEqual(resolution.state, MINE_MODULE_STATES.unknown);
  assert.strictEqual(resolution.multiplier, null);
  assert.match(resolution.reason, /ModdedGigaMiningComplex/);

  const applied = applyMineModuleMultiplier(8, resolution);
  assert.strictEqual(applied.multiplier, null);
  assert.strictEqual(applied.applied, false);
  assert.strictEqual(applied.producing, true, 'it is still mining, we just cannot scale it');
  assert.strictEqual(applied.value, 8, 'the raw rate stands rather than the site being dropped');
});

test('null in, null out — an unmeasured rate never becomes a confident zero', () => {
  const resolution = resolveMineModuleMultiplier(operationalSite('OutpostMiningComplex'));
  for (const absent of [null, undefined, NaN, '']) {
    const applied = applyMineModuleMultiplier(absent, resolution);
    assert.strictEqual(applied.value, null, `${String(absent)} must not become a number`);
    assert.strictEqual(applied.raw, null);
  }
});

test('a mine that is not operational produces nothing, which is measured and not a convention', () => {
  for (const status of ['building', 'pending-hab', 'not-installed', null]) {
    const site = { ...operationalSite('ColonyMiningComplex'), constructionStatus: status };
    const applied = applyMineModuleMultiplier(10, resolveMineModuleMultiplier(site));
    assert.strictEqual(applied.value, null, `a '${status}' mine must contribute nothing`);
    assert.strictEqual(applied.producing, false);
  }
  const running = applyMineModuleMultiplier(10, resolveMineModuleMultiplier(operationalSite('ColonyMiningComplex')));
  assert.strictEqual(running.value, 20, 'an operational Colony complex is x2.0');
});

// ---------------------------------------------------------------------------
// 3. The buildable band is bounded by measurement on both ends
// ---------------------------------------------------------------------------

test('the buildable band contains only tiers the observer has actually researched', () => {
  const capability = buildMineModuleCapability(
    { ID: OBSERVER, completedProjects: [OUTPOST.requiredProject, SETTLEMENT.requiredProject] },
    { projectListComplete: true }
  );
  assert.strictEqual(capability.available, true);
  assert.deepStrictEqual(capability.buildableTiers.map(t => t.template),
    ['OutpostMiningComplex', 'SettlementMiningComplex']);
  assert.strictEqual(capability.bestBuildable.template, 'SettlementMiningComplex');
  assert.strictEqual(capability.projectedMultiplierRange.low, 1);
  assert.strictEqual(capability.projectedMultiplierRange.high, 1.5);
  // The Colony complex is x2.0 and must NOT widen a band the observer cannot reach.
  assert.ok(capability.projectedMultiplierRange.high < COLONY.multiplier);
});

test('an incomplete project list makes the band UNKNOWN, not empty', () => {
  const truncated = buildMineModuleCapability(
    { ID: 4713, completedProjects: [SETTLEMENT.requiredProject] },
    { projectListComplete: false }
  );
  assert.strictEqual(truncated.available, false);
  assert.strictEqual(truncated.projectedMultiplierRange, null);
  assert.match(truncated.unavailableReason, /truncates/);

  // A list that WAS read and grants nothing is a different answer.
  const measuredNone = buildMineModuleCapability(
    { ID: OBSERVER, completedProjects: ['Project_Unrelated'] },
    { projectListComplete: true }
  );
  assert.strictEqual(measuredNone.available, true);
  assert.strictEqual(measuredNone.projectedMultiplierRange, null);
  assert.strictEqual(measuredNone.unavailableReason, null);
});

// ---------------------------------------------------------------------------
// 4. The upgrade board: measured, and it distinguishes three kinds of "no"
// ---------------------------------------------------------------------------

test('an upgrade is priced only when the successor is researched, and the Automated complex has none', () => {
  const capability = buildMineModuleCapability(
    { ID: OBSERVER, completedProjects: [OUTPOST.requiredProject, AUTOMATED.requiredProject, SETTLEMENT.requiredProject] },
    { projectListComplete: true }
  );
  const habSites = [
    { ...operationalSite('OutpostMiningComplex', { water: 1 }), ID: 1, displayName: 'Upgradeable' },
    { ...operationalSite('AutomatedMiningComplex', { water: 1 }), ID: 2, displayName: 'Dead end' },
    { ...operationalSite('SettlementMiningComplex', { water: 1 }), ID: 3, displayName: 'Needs Colony' },
    { ...operationalSite('OutpostMiningComplex', { water: 1 }), ID: 4, displayName: 'Building', constructionStatus: 'building' },
    { ...operationalSite('OutpostMiningComplex', { water: 1 }), ID: 5, displayName: 'Someone else', factionId: 4713 }
  ];
  const result = buildMineUpgradeOpportunities({
    habSites, observerId: OBSERVER, capability, resources: MINING_RESOURCES
  });

  assert.strictEqual(result.counts.available, 1);
  assert.strictEqual(result.counts.noUpgradePath, 1, 'the Automated complex has no successor at all');
  assert.strictEqual(result.counts.notResearched, 1, 'the Settlement complex needs the Colony project');
  assert.strictEqual(result.counts.notOperational, 1);
  assert.strictEqual(result.opportunityTotalCount, 4, 'the rival faction\'s site is not on the observer\'s board');

  const dead = result.opportunities.find(o => o.displayName === 'Dead end');
  assert.strictEqual(dead.state, 'no-upgrade-path');
  assert.strictEqual(dead.multiplierGain, null, 'an unavailable upgrade is not a gain of zero dressed up');
  const blocked = result.opportunities.find(o => o.displayName === 'Needs Colony');
  assert.strictEqual(blocked.state, 'not-researched');
  assert.match(blocked.reason, new RegExp(COLONY.requiredProject));

  const upgrade = result.opportunities.find(o => o.displayName === 'Upgradeable');
  assert.strictEqual(upgrade.state, 'available');
  assert.strictEqual(upgrade.multiplierGain, 0.5);
  // 1 t/day x 30 days x (1.5 - 1.0)
  assert.strictEqual(upgrade.monthlyGain.water, 15);
  // These sites carry a water rate and nothing else, so the other four are
  // UNMEASURED. A confident 0 there would read as "upgrading wins no metals"
  // when the truth is "this snapshot did not say".
  assert.strictEqual(upgrade.monthlyGain.metals, null, 'an unmeasured rate is not a gain of zero');
  assert.strictEqual(result.totalMonthlyGain.water, 15);
  assert.strictEqual(result.totalMonthlyGain.metals, null,
    'a resource with any unreadable contributor totals to null, never to a partial sum');
});

test('the upgrade board says an upgrade costs nothing against the mine limit', () => {
  const result = buildMineUpgradeOpportunities({
    habSites: [], observerId: OBSERVER, resources: MINING_RESOURCES,
    capability: buildMineModuleCapability({ ID: OBSERVER, completedProjects: [] }, { projectListComplete: true })
  });
  assert.strictEqual(result.mineLimitCost, 0);
  assert.match(result.mineLimitNote, /onePerHab/);
  assert.match(result.mineLimitNote, /A NEW claim costs one/);
});

test('with the buildable tiers unresolved the total gain is UNKNOWN, not a measured zero', () => {
  const capability = buildMineModuleCapability({ ID: 4713, completedProjects: [] }, { projectListComplete: false });
  const result = buildMineUpgradeOpportunities({
    habSites: [operationalSite('OutpostMiningComplex', { water: 1 })],
    observerId: OBSERVER, capability, resources: MINING_RESOURCES
  });
  assert.strictEqual(result.totalMonthlyGainMeasured, false);
  assert.strictEqual(result.opportunities[0].state, 'buildable-tiers-unknown');
  assert.strictEqual(result.opportunities[0].multiplierGain, null);
});

// ---------------------------------------------------------------------------
// 5. The refusal to project, and the record of it
// ---------------------------------------------------------------------------

test('the projection policy names its rejected alternatives and its evidence', () => {
  assert.strictEqual(MINE_MODULE_PROJECTION_POLICY.decision, 'not-projected');
  assert.ok(MINE_MODULE_PROJECTION_POLICY.rejectedAlternatives.length >= 3,
    'a refusal is only defensible if it says what it rejected');
  for (const alternative of MINE_MODULE_PROJECTION_POLICY.rejectedAlternatives) {
    assert.ok(alternative.rule && alternative.why, 'every rejected rule carries a reason');
  }
  // The counts ARE the argument. "a projection would be misleading" with no
  // numbers behind it is an opinion, and a reader cannot check it.
  assert.match(MINE_MODULE_PROJECTION_POLICY.evidence, /saturat/i,
    'the evidence names the mechanism that makes a uniform multiplier reorder rather than scale');
  const counts = MINE_MODULE_PROJECTION_POLICY.evidence.match(/\d+ of \d+/g) || [];
  assert.ok(counts.length >= 2,
    `the evidence must carry at least two measured "n of m" comparisons, found ${JSON.stringify(counts)}`);
  assert.match(MINE_MODULE_PROJECTION_POLICY.evidence, /x1\.\d+ and x[12]/,
    'the evidence names which multipliers were compared');
});

test('the projection policy names no faction, because it is published in player mode', () => {
  const serialised = JSON.stringify(MINE_MODULE_PROJECTION_POLICY);
  for (const name of ['Humanity First', 'Servants', 'Academy', 'Protectorate', 'Resistance', 'Exodus', 'Initiative']) {
    assert.ok(!serialised.includes(name), `the policy must not name ${name}`);
  }
});

test('UNMODELLED_FACTORS still names the module multiplier, and now says which half is closed', () => {
  const factor = UNMODELLED_FACTORS.find(entry => entry.factor === 'mine-module miningModifier');
  assert.ok(factor, 'the war-room export reads this entry by name and range, so both must survive');
  assert.match(factor.range, /1\.0 \(Outpost\)/);
  assert.match(factor.reason, /measured per site/);
  assert.match(factor.reason, /UNOWNED/);
});

// ---------------------------------------------------------------------------
// 6. Against the live save: the model closes, and both modes agree
// ---------------------------------------------------------------------------

const RESOURCE_KEYS = ['water', 'volatiles', 'metals', 'nobleMetals', 'fissiles'];
const REVENUE_KEY = { water: 'Water', volatiles: 'Volatiles', metals: 'Metals', nobleMetals: 'NobleMetals', fissiles: 'Fissiles' };

test('the observer\'s advisable-hab output reconciles against the game\'s own monthly income', () => {
  // THE POINT OF THE WHOLE CHANGE. Before the module multiplier was applied
  // this ratio was the fleet-wide module factor -- 1.05 on water, 1.44 on
  // fissiles on the measured save -- and could not be 1.0 on all five at once.
  const snapshot = loadFilteredSnapshot({ mode: 'omniscient', observer: OBSERVER });
  const observer = snapshot.factions.find(f => Number(f.ID) === OBSERVER);
  const bonuses = buildMiningTechBonuses(observer, { projectListComplete: true });
  const habs = readers.buildAdvisableHabs(snapshot.habs, snapshot.habSites, OBSERVER, bonuses);

  let checked = 0;
  for (const key of RESOURCE_KEYS) {
    const monthly = habs.reduce((sum, hab) => sum + (Number(hab[key]) || 0), 0);
    const reported = Number(observer.financials?.projectedMonthlyIncome?.[REVENUE_KEY[key]]);
    if (!(monthly > 0) || !Number.isFinite(reported)) continue;
    // The board's x30 against the game's x365.25/12; the only difference
    // between the two is the month length, so normalise it out.
    const ratio = reported / (monthly / 30 * (365.25 / 12));
    assert.ok(Math.abs(ratio - 1) < 0.005,
      `${key}: the game reports ${reported.toFixed(2)}/month against a modelled ${(monthly / 30 * (365.25 / 12)).toFixed(2)} (ratio ${ratio.toFixed(6)})`);
    checked++;
  }
  assert.ok(checked >= 4, 'at least four of the five resources were actually reconciled');
});

test('every mine-module figure is identical in both modes, because they are the observer\'s own', () => {
  const player = queryIntel({ endpoint: 'mining-expansion', mode: 'player', observer: OBSERVER });
  const omni = queryIntel({ endpoint: 'mining-expansion', mode: 'omniscient', observer: OBSERVER });
  assert.deepStrictEqual(player.mineModuleCapability, omni.mineModuleCapability);
  assert.deepStrictEqual(player.mineUpgrades, omni.mineUpgrades);
});

test('the player-mode payload never presents a mine-complex project the observer does not hold as HELD', () => {
  // A blanket "this string must not appear" is the wrong test here and was
  // written that way first: the board legitimately names
  // `Project_ColonyMiningComplex` as the UNMET requirement blocking an upgrade,
  // which is a template fact plus the observer's own list and tells a reader
  // nothing about any rival. What must never appear is the project presented as
  // something someone HAS.
  const omniSnapshot = loadFilteredSnapshot({ mode: 'omniscient', observer: OBSERVER });
  const observerProjects = new Set(
    (omniSnapshot.factions.find(f => Number(f.ID) === OBSERVER)?.completedProjects) || []
  );
  const rivalOnly = MINE_MODULE_TEMPLATES
    .map(entry => entry.requiredProject)
    .filter(project => !observerProjects.has(project)
      && omniSnapshot.factions.some(f => Number(f.ID) !== OBSERVER && (f.completedProjects || []).includes(project)));
  assert.ok(rivalOnly.length > 0, 'this save has at least one mine-complex project only a rival holds');

  const payload = queryIntel({ endpoint: 'mining-expansion', mode: 'player', observer: OBSERVER });

  // 1. The band never over-claims: every buildable tier is one the observer
  //    genuinely holds in the unredacted save.
  for (const tier of payload.mineModuleCapability.buildableTiers) {
    assert.ok(observerProjects.has(tier.requiredProject),
      `${tier.requiredProject} is presented as buildable but the observer does not hold it`);
  }
  for (const project of rivalOnly) {
    assert.ok(!payload.mineModuleCapability.buildableTiers.some(t => t.requiredProject === project),
      `${project} is held only by a rival and must not appear as a buildable tier`);
  }

  // 2. Every occurrence of a rival-only project anywhere in the payload sits in
  //    a string that says the observer does NOT have it.
  const walk = (node, trail) => {
    if (typeof node === 'string') {
      for (const project of rivalOnly) {
        if (!node.includes(project)) continue;
        assert.match(node, /not in the observer's completed projects|needs /,
          `${project} appears at ${trail} in a string that does not mark it as an unmet requirement: ${node}`);
      }
      return;
    }
    if (Array.isArray(node)) { node.forEach((v, i) => walk(v, `${trail}[${i}]`)); return; }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) walk(v, `${trail}.${k}`);
    }
  };
  walk(payload, 'miningExpansion');

  // 3. No rival is named anywhere near the mine-module blocks.
  const blocks = JSON.stringify({ c: payload.mineModuleCapability, u: payload.mineUpgrades });
  for (const faction of omniSnapshot.factions) {
    if (Number(faction.ID) === OBSERVER) continue;
    assert.ok(!blocks.includes(faction.displayName),
      `the mine-module blocks must not name ${faction.displayName}`);
  }
});

test('the upgrade board only ever lists the OBSERVER\'s own sites', () => {
  // A leak this shape would not be caught by "both modes agree":
  // `habSites[].mineModuleTemplate` is published unredacted for every faction,
  // so an upgrade board pointed at a rival would render identically in both
  // modes and still be a rival's mine inventory and upgrade economics.
  const snapshot = loadFilteredSnapshot({ mode: 'player', observer: OBSERVER });
  const observerSiteIds = new Set(snapshot.habSites
    .filter(site => Number(site.factionId) === OBSERVER)
    .map(site => String(site.ID)));
  const rivalSiteNames = new Set(snapshot.habSites
    .filter(site => site.factionId !== null && site.factionId !== undefined && Number(site.factionId) !== OBSERVER)
    .map(site => site.displayName)
    .filter(Boolean));
  assert.ok(rivalSiteNames.size > 0, 'this save has rival-owned mining sites to leak');

  const payload = queryIntel({ endpoint: 'mining-expansion', mode: 'player', observer: OBSERVER });
  assert.ok(payload.mineUpgrades.opportunityTotalCount > 0, 'the observer has mines to report on');
  for (const opportunity of payload.mineUpgrades.opportunities) {
    assert.ok(observerSiteIds.has(String(opportunity.siteId)),
      `site ${opportunity.siteId} (${opportunity.displayName}) is on the upgrade board but is not the observer's`);
    assert.ok(!rivalSiteNames.has(opportunity.displayName),
      `${opportunity.displayName} is a rival-owned site and must not appear on the observer's upgrade board`);
  }
});

test('the per-site module multiplier on /mining publishes nothing the payload did not already carry', () => {
  // `mineModuleMultiplier` is a pure template lookup on `mineModule`, which
  // player mode has always published for every faction's site. If that ever
  // stops being true the multiplier becomes a new disclosure and this fails.
  const player = queryIntel({ endpoint: 'mining', mode: 'player', observer: OBSERVER });
  const rivalRows = player.items.filter(row => row.owner && row.owner !== 'Unclaimed' && row.owner !== 'the Initiative');
  assert.ok(rivalRows.length > 0, 'player mode carries rival mining rows at all');
  for (const row of rivalRows) {
    if (row.mineModuleMultiplier === null) continue;
    assert.ok(row.mineModule,
      'a multiplier is only ever published where the module name it derives from is already published');
  }
});

test('the expansion score is UNCHANGED by the module multiplier — the ranking is not built on a projection', () => {
  const payload = queryIntel({ endpoint: 'mining-expansion', mode: 'omniscient', observer: OBSERVER });
  assert.ok(payload.available.length > 0);
  for (const candidate of payload.available) {
    assert.strictEqual(candidate.moduleMultiplier.excludedFromScore, true);
    // Never a number for an unowned site.
    assert.strictEqual(candidate.moduleMultiplier.multiplier, null);
    assert.strictEqual(candidate.moduleMultiplier.state, MINE_MODULE_STATES.notBuilt);
    // The band itself is a fact about the observer and is carried once, so the
    // row points at it rather than duplicating it 357 times.
    assert.strictEqual(candidate.moduleMultiplier.see, 'mineModuleCapability');
    assert.strictEqual(candidate.moduleMultiplier.projectedRangeAvailable, true);
    assert.ok(!Object.prototype.hasOwnProperty.call(candidate.moduleMultiplier, 'projectedRange'),
      'the band is not duplicated onto every row');
  }
  const band = payload.mineModuleCapability.projectedMultiplierRange;
  assert.ok(band && band.high > band.low, 'the band is a range, so it cannot be read as a point measurement');

  // The score must be reproducible WITHOUT any module term at all.
  const { scoreMiningSiteCandidate } = require('../shared/intelResources.mjs');
  const snapshot = loadFilteredSnapshot({ mode: 'omniscient', observer: OBSERVER });
  const top = payload.available[0];
  const site = snapshot.habSites.find(s => String(s.ID) === String(top.siteId));
  const rescored = scoreMiningSiteCandidate(site, payload.resourceRunways, payload.capacity, {
    miningTechBonus: payload.miningTechBonus
  });
  assert.strictEqual(rescored.siteValue, top.siteValue,
    'the published score is exactly the score with no mine-module capability supplied');
});

test('the mining rows publish the measured module multiplier without folding it into the rate', () => {
  const mining = queryIntel({ endpoint: 'mining', mode: 'omniscient', observer: OBSERVER });
  const withModule = mining.items.filter(row => row.mineModule);
  assert.ok(withModule.length > 0);
  for (const row of withModule.slice(0, 40)) {
    const expected = MINE_MODULE_TEMPLATES.find(m => m.template === row.mineModule);
    if (!expected) continue;
    assert.strictEqual(row.mineModuleMultiplier, expected.multiplier);
    assert.strictEqual(row.mineModuleMultiplierState, MINE_MODULE_STATES.measured);
  }
  const withoutModule = mining.items.filter(row => !row.mineModule);
  assert.ok(withoutModule.length > 0);
  for (const row of withoutModule.slice(0, 20)) {
    assert.strictEqual(row.mineModuleMultiplier, null, 'a site with no mine is null, never 1.0');
    assert.strictEqual(row.mineModuleMultiplierState, MINE_MODULE_STATES.notBuilt);
  }
});

// ---------------------------------------------------------------------------
// 7. The two registers are actually different rules
//
// A computed-style check lives in scripts/verify_mining_registers.js, which
// reads the rendered document. This is the cheap guard that runs in the suite.
// ---------------------------------------------------------------------------

test('the measured and estimate registers on the mining board differ on font, style and colour', () => {
  // Every part the shell links, concatenated in cascade order. The two indexOf
  // assertions at the end of this test depend on that order being the browser's
  // order across FILE boundaries as well as within one -- reading a single part
  // would make them compare positions inside an arbitrary slice.
  const css = require('./fixtures/missionControlCss').readMissionControlCss();
  const ruleFor = (selector) => {
    const match = css.match(new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`));
    assert.ok(match, `${selector} must exist in the v2 stylesheet`);
    return Object.fromEntries(match[1].split(';')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const index = line.indexOf(':');
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
      }));
  };
  const measured = ruleFor('.mining-meas__value');
  const estimate = ruleFor('.mining-est__value');
  for (const property of ['font-family', 'font-style', 'font-weight', 'color']) {
    assert.ok(measured[property], `.mining-meas__value must set ${property} rather than inheriting it`);
    assert.ok(estimate[property], `.mining-est__value must set ${property} rather than inheriting it`);
    assert.notStrictEqual(measured[property], estimate[property],
      `.mining-meas__value and .mining-est__value must differ on ${property}`);
  }

  // The register rules must come AFTER the cell rules they have to beat, or
  // `.mining-yields-text { color: var(--text-soft) }` silently wins and the two
  // registers compute the same colour with every rule in the file looking right.
  assert.ok(css.indexOf('.mining-meas__value {') > css.indexOf('.mining-yields-text {'),
    '.mining-meas__value must be declared after .mining-yields-text so it wins the cascade');
  assert.ok(css.indexOf('.mining-est {') > css.indexOf('.mining-yield-basis {'),
    '.mining-est must be declared after .mining-yield-basis so it wins the cascade');
});

// ---------------------------------------------------------------------------
// 8. What the board actually renders
// ---------------------------------------------------------------------------

function renderBoard(payload) {
  const componentPath = path.join(__dirname, '..', 'public', 'v2', 'js', 'components', 'mining-expansion.js');
  const source = fs.readFileSync(componentPath, 'utf8');
  const sandbox = { window: {}, console, fetch: () => Promise.resolve(null) };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: componentPath });
  const root = { innerHTML: '' };
  sandbox.window.MissionControlMiningExpansion.render(root, payload);
  return root.innerHTML;
}

test('the board renders the measured upgrade block and the projected band in their own registers', () => {
  const payload = queryIntel({ endpoint: 'mining-expansion', mode: 'player', observer: OBSERVER });
  const html = renderBoard(payload);
  assert.match(html, /mining-meas__value/, 'measured figures carry the measured register class');
  assert.match(html, /mining-est__value/, 'the projected band carries the estimate register class');
  assert.match(html, /mining-est__tag/, 'the band carries a visible EST caption');
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  assert.match(text, /NOT in the utility score/, 'the exclusion is stated in words, not only in the payload');
  for (const token of ['null', 'undefined', 'NaN', '[object Object]']) {
    assert.strictEqual(text.indexOf(token), -1, `the rendered board must not contain "${token}"`);
  }
});

test('an unresolved capability renders as UNKNOWN rather than as "no bonus"', () => {
  const payload = queryIntel({ endpoint: 'mining-expansion', mode: 'player', observer: OBSERVER });
  const blinded = {
    ...payload,
    mineModuleCapability: {
      available: false,
      unavailableReason: 'the completed-project list could not be read',
      buildableTiers: [],
      bestBuildable: null,
      projectedMultiplierRange: null
    },
    mineUpgrades: { ...payload.mineUpgrades, totalMonthlyGainMeasured: false },
    available: payload.available.map(c => ({
      ...c,
      moduleMultiplier: { ...c.moduleMultiplier, projectedRangeAvailable: false }
    }))
  };
  const text = renderBoard(blinded).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  assert.match(text, /UNKNOWN/, 'an unresolved multiplier must say UNKNOWN');
  assert.match(text, /UPGRADE HEADROOM UNRESOLVED/);
  assert.ok(!/×1 to ×1/.test(text), 'no band may be printed when none could be resolved');
  for (const token of ['null', 'undefined', 'NaN']) {
    assert.strictEqual(text.indexOf(token), -1, `the degraded board must not contain "${token}"`);
  }
});

// ---------------------------------------------------------------------------
// 9. The briefing surfaces carry the module term and say so
// ---------------------------------------------------------------------------

test('the briefing mined-rate sentence is module-adjusted, and rises against the raw deposit sum', () => {
  const snapshot = loadFilteredSnapshot({ mode: 'player', observer: OBSERVER });
  const observer = snapshot.factions.find(f => Number(f.ID) === OBSERVER);
  const bonuses = buildMiningTechBonuses(observer, { projectListComplete: true });
  const ownHabs = snapshot.habs.filter(h => Number(h.factionId) === OBSERVER);
  const sentence = readers.getMiningRateSummary(snapshot.habSites, ownHabs, OBSERVER, bonuses);
  assert.ok(sentence, 'the observer mines something');

  // The raw deposit sum, computed here rather than captured, so this test
  // cannot pass by construction against post-change output.
  const sites = snapshot.habSites.filter(s => Number(s.factionId) === OBSERVER);
  const rawWater = sites.reduce((sum, s) => sum + (Number(s.water) || 0), 0);
  const moduleWater = sites.reduce((sum, s) => {
    const resolution = resolveMineModuleMultiplier(s);
    return sum + (resolution.multiplier === null || resolution.operational !== true
      ? 0
      : (Number(s.water) || 0) * resolution.multiplier);
  }, 0);
  assert.ok(moduleWater > rawWater, 'this save has at least one above-Outpost mine, so the term is exercised');

  const printed = Number(sentence.match(/Water ([\d.]+)\/day/)[1]);
  const expected = applyMiningTechBonus(moduleWater, bonuses, 'water').value;
  assert.ok(Math.abs(printed - expected) < 0.05,
    `the sentence prints ${printed}/day against a modelled ${expected.toFixed(1)}/day`);
});

test('each advisable hab names the mine module behind its numbers', () => {
  const snapshot = loadFilteredSnapshot({ mode: 'player', observer: OBSERVER });
  const observer = snapshot.factions.find(f => Number(f.ID) === OBSERVER);
  const bonuses = buildMiningTechBonuses(observer, { projectListComplete: true });
  const habs = readers.buildAdvisableHabs(snapshot.habs, snapshot.habSites, OBSERVER, bonuses);
  const mining = habs.filter(h => h.mineModulesApplied === true);
  assert.ok(mining.length > 0, 'the observer runs at least one mining hab');
  for (const hab of mining) {
    for (const module of hab.mineModules) {
      if (module.state !== MINE_MODULE_STATES.measured) continue;
      assert.ok(MINE_MODULE_TEMPLATES.some(t => t.template === module.module),
        `${module.module} is a known module`);
      assert.strictEqual(typeof module.multiplier, 'number');
    }
    assert.match(hab.resourceOutputSource, /miningModifier/,
      'the provenance string names the module term, so an adjusted figure is not mistaken for a raw one');
  }
});

test('a snapshot that does not model mine modules degrades to RAW rates and says so, never to zero', () => {
  // The dangerous middle case. `resolveMineModuleMultiplier` cannot tell "this
  // site has no mine" from "this snapshot predates the field" one site at a
  // time, and reading the second as the first would zero a faction's entire
  // mined output -- the confident-zero this repo keeps fixing, arriving through
  // a schema change rather than through a `?? 0`.
  const legacySites = [{ ID: 1, factionId: OBSERVER, water: 10, volatiles: 20, metals: 30 }];
  assert.strictEqual(mineModuleDataAvailable(legacySites), false);
  assert.strictEqual(mineModuleDataAvailable([{ ID: 1, mineModuleTemplate: null }]), true,
    'an explicit null IS module data: the snapshot modelled mines and this site has none');

  const sentence = readers.getMiningRateSummary(legacySites, [], OBSERVER, null);
  assert.match(sentence, /Water 10\.0\/day/, 'the raw rate stands rather than collapsing to zero');
  assert.match(sentence, /UNAVAILABLE/, 'and the sentence says the module term could not be read');
  assert.match(sentence, /lower bound/);

  const hab = readers.buildAdvisableHabs(
    [{ ID: 7, displayName: 'Legacy Base', factionId: OBSERVER }],
    [{ ID: 1, habId: 7, water: 1 }],
    OBSERVER
  )[0];
  assert.strictEqual(hab.water, 30, '1/day x 30, unscaled');
  assert.strictEqual(hab.mineModuleDataAvailable, false);
  assert.match(hab.resourceOutputSource, /UNAVAILABLE/);

  // And the contrast: the same site WITH the field present and null contributes
  // nothing, because it genuinely has no mine.
  const noMine = readers.getMiningRateSummary(
    [{ ID: 1, factionId: OBSERVER, water: 10, mineModuleTemplate: null, constructionStatus: 'not-installed' }],
    [], OBSERVER, null
  );
  assert.strictEqual(noMine, null, 'a site the snapshot says has no mine mines nothing');
});

test('the measured-on date is carried so a claim can be dated', () => {
  assert.match(MINE_MODULE_MEASURED_ON, /^\d{4}-\d{2}-\d{2}$/);
  const capability = buildMineModuleCapability({ ID: OBSERVER, completedProjects: [] }, { projectListComplete: true });
  assert.strictEqual(capability.measuredOn, MINE_MODULE_MEASURED_ON);
});

test('the alien Settlement complex would break a tier-keyed model, and this one survives it', () => {
  // A regression guard shaped like the bug it prevents: if someone re-keys the
  // table on `mineTier`, this fails because tier 2 would collapse to one value.
  const bySite = resolveMineModuleMultiplier({
    mineModuleTemplate: ALIEN_SETTLEMENT.template,
    mineTier: 2,
    constructionStatus: 'operational'
  });
  assert.strictEqual(bySite.multiplier, 2);
  const humanTier2 = MINE_MODULE_TEMPLATES.filter(m => m.tier === 2);
  assert.ok(new Set(humanTier2.map(m => m.multiplier)).size > 1,
    'tier 2 carries more than one multiplier, so tier alone cannot identify it');
});
