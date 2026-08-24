// The faction-wide additive space-mining bonus — the term that used to show up
// as an unexplained per-faction scalar on mined output.
//
// THE FACT THESE TESTS DEFEND. Reconciling each faction's mined output against
// the game's own annualised revenue left a clean residual that agreed to six
// digits across all five resources within a faction but differed BETWEEN
// factions — 1.000 / 1.000 / 1.000 / 1.10 / 1.14 / 1.19 / 1.28 / 1.33 on
// `ExitSave.gz`. It is `1 + SUM(active org miningBonus) + SUM(SpaceMiningBonus
// effect values)`, and with it applied all eight factions reconcile at 0.0022%,
// which is every digit the save's own revenue carries.
//
// THE RECONCILIATION TEST BELOW IS THE ONE THAT MATTERS, and it is written so
// it cannot pass by construction: it asserts both that the model closes WITH
// the term and that it does NOT close without it, on a faction the live save
// happens to give a non-zero bonus. A fixture captured from this change's own
// output could not do that.
//
// Nothing here pins a figure taken from post-change output. Every expected
// value is derived from the save's own `financials.projectedMonthlyIncome`, the
// shipped templates, or the rule table.

const { test } = require('node:test');
const assert = require('node:assert');

const {
  SPACE_MINING_BONUS_COMBINATION,
  SPACE_MINING_BONUS_EFFECT_VALUES,
  SPACE_MINING_BONUS_MEASURED_ON,
  SPACE_MINING_BONUS_STATES,
  applySpaceMiningBonus,
  buildSpaceMiningBonus,
  spaceMiningBonusCaveat
} = require('../shared/spaceMiningBonus.mjs');
const { UNMODELLED_FACTORS, MINING_BONUS_RULES } = require('../shared/miningTechBonus.mjs');
const { resolveMineModuleMultiplier, MINE_MODULE_STATES } = require('../shared/mineModuleOutput.mjs');
const { MINING_RESOURCES } = require('../shared/intel/common.mjs');
const { queryIntel } = require('../server/snapshotLoader');
const { loadFixtureFilteredSnapshot } = require('./fixtures/frozenSnapshots');

const OBSERVER = 4712;

// A councilor carrying one org with a mining bonus, active unless told otherwise.
const withOrgs = (...orgs) => [{ displayName: 'Test Councilor', ID: 1, orgs }];
const org = (name, value, applyingBonuses = true) => ({
  displayName: name, templateName: `Template_${name}`, miningBonus: value, applyingBonuses
});
const faction = (effects = []) => ({ ID: OBSERVER, displayName: 'the Initiative', spaceMiningBonusEffects: effects });
const complete = { councilorListComplete: true };

// ---------------------------------------------------------------------------
// The arithmetic, and that it is ADDITIVE
// ---------------------------------------------------------------------------

test('two org bonuses SUM rather than compound, and each source is named', () => {
  const bonus = buildSpaceMiningBonus(faction(), {
    councilors: withOrgs(org('Pegasus Resources', 0.06), org('Zircon Extraction', 0.04)),
    ...complete
  });
  assert.strictEqual(bonus.available, true);
  assert.strictEqual(bonus.state, SPACE_MINING_BONUS_STATES.measured);
  // 1.10, not 1.06 x 1.04 = 1.1024. The distinction is the whole point of
  // keeping this term out of shared/miningTechBonus.mjs, whose x1.15 grants ARE
  // multiplicative.
  assert.strictEqual(bonus.multiplier, 1.1);
  assert.strictEqual(bonus.additiveTotal, 0.1);
  assert.strictEqual(bonus.orgTotal, 0.1);
  assert.strictEqual(bonus.effectTotal, 0);
  assert.deepStrictEqual(bonus.sources.map(s => s.name), ['Pegasus Resources', 'Zircon Extraction']);
  assert.deepStrictEqual(bonus.sources.map(s => s.value), [0.06, 0.04]);
  assert.ok(bonus.sources.every(s => s.kind === 'org' && s.councilor === 'Test Councilor'),
    'each org names the councilor holding it, so the figure can be traced');
  assert.strictEqual(SPACE_MINING_BONUS_COMBINATION.mode, 'additive');
});

test('org bonuses and SpaceMiningBonus effects go in the SAME additive bucket', () => {
  // This is the Project Exodus case, and it is what settled the question
  // shared/miningTechBonus.mjs left open. It reads 1.28, not 1.10, because it
  // holds +0.18 of org bonus BESIDE Project_GoldRush's +0.1.
  const bonus = buildSpaceMiningBonus(faction(['Effect_SpaceMiningBonus10']), {
    councilors: withOrgs(org('Orbital Resource Extraction Inc.', 0.08), org('Project Exodus Engineers', 0.1)),
    ...complete
  });
  assert.strictEqual(bonus.orgTotal, 0.18);
  assert.strictEqual(bonus.effectTotal, SPACE_MINING_BONUS_EFFECT_VALUES.Effect_SpaceMiningBonus10);
  assert.strictEqual(bonus.additiveTotal, 0.28);
  assert.strictEqual(bonus.multiplier, 1.28);
  assert.strictEqual(bonus.sources.filter(s => s.kind === 'effect').length, 1);
});

test('the two effect values are the shipped Additive fractions, not percentages', () => {
  // TIEffectTemplate.json states 0.05 and 0.1 meaning five and ten PERCENTAGE
  // POINTS. Reading either as a multiplier would be a 5x or 10x error, which is
  // the confusion shared/economicValue.mjs already records.
  assert.strictEqual(SPACE_MINING_BONUS_EFFECT_VALUES.Effect_SpaceMiningBonus5, 0.05);
  assert.strictEqual(SPACE_MINING_BONUS_EFFECT_VALUES.Effect_SpaceMiningBonus10, 0.1);
  const five = buildSpaceMiningBonus(faction(['Effect_SpaceMiningBonus5']), { councilors: [], ...complete });
  assert.strictEqual(five.multiplier, 1.05);
});

test('a faction with no orgs and no effects is a MEASURED none, not an unknown', () => {
  const bonus = buildSpaceMiningBonus(faction([]), { councilors: [{ displayName: 'A', orgs: [] }], ...complete });
  assert.strictEqual(bonus.available, true);
  assert.strictEqual(bonus.state, SPACE_MINING_BONUS_STATES.measuredNone);
  assert.strictEqual(bonus.multiplier, 1);
  assert.strictEqual(bonus.additiveTotal, 0);
  assert.strictEqual(spaceMiningBonusCaveat(bonus), null,
    'nothing to say, so a prose surface prints no clause rather than "no bonus"');
});

// ---------------------------------------------------------------------------
// Which orgs count
// ---------------------------------------------------------------------------

test('an org the game reports as not applying its bonuses is excluded, and SAID to be', () => {
  // The wiki `Orgs` (raw wikitext, 2026-08-22): a newly bought org gives nothing
  // until the next mission phase, and every org on a Detained councilor is made
  // inactive. `applyingBonuses` is the game's own flag for that.
  const bonus = buildSpaceMiningBonus(faction(), {
    councilors: withOrgs(org('Active Mining', 0.05, true), org('Suspended Mining', 0.06, false)),
    ...complete
  });
  assert.strictEqual(bonus.additiveTotal, 0.05);
  assert.deepStrictEqual(bonus.sources.map(s => s.name), ['Active Mining']);
  assert.deepStrictEqual(bonus.inactiveSources.map(s => s.name), ['Suspended Mining'],
    'the excluded org is named, not silently dropped');
  assert.match(bonus.inactiveSources[0].reason, /not applying/);
});

test('an org with a mining bonus but no readable active flag makes the whole figure unknown', () => {
  for (const flag of [undefined, null, 'true', 1]) {
    const bonus = buildSpaceMiningBonus(faction(), {
      councilors: withOrgs({ displayName: 'Ambiguous', miningBonus: 0.05, applyingBonuses: flag }),
      ...complete
    });
    assert.strictEqual(bonus.available, false, `applyingBonuses ${String(flag)} is not readable`);
    assert.strictEqual(bonus.multiplier, null, 'never a confident 1.0, and never counted as active');
    assert.match(bonus.unknownReason, /applyingBonuses/);
  }
});

test('an org with no mining bonus needs no active flag at all', () => {
  // Most orgs carry no mining bonus. Demanding the flag from all of them would
  // turn every ordinary roster unknown.
  const bonus = buildSpaceMiningBonus(faction(), {
    councilors: withOrgs({ displayName: 'CIA', miningBonus: 0 }, { displayName: 'MI6' }),
    ...complete
  });
  assert.strictEqual(bonus.available, true);
  assert.strictEqual(bonus.state, SPACE_MINING_BONUS_STATES.measuredNone);
});

test('unassigned orgs are never read: only orgs on a councilor count', () => {
  // The wiki `Orgs`: "These orgs do not confer any benefits to the faction."
  const withUnassigned = { ...faction(), unassignedOrgs: [org('Hoarded Mining', 0.5)] };
  const bonus = buildSpaceMiningBonus(withUnassigned, { councilors: [{ displayName: 'A', orgs: [] }], ...complete });
  assert.strictEqual(bonus.additiveTotal, 0, 'a shelved org contributes nothing');
});

// ---------------------------------------------------------------------------
// Absent stays null
// ---------------------------------------------------------------------------

test('every unreadable input resolves to unknown with a null multiplier, never to 1.0', () => {
  const cases = [
    ['no faction', buildSpaceMiningBonus(null, { councilors: [], ...complete })],
    ['no roster', buildSpaceMiningBonus(faction(), { councilorListComplete: true })],
    ['roster not known complete', buildSpaceMiningBonus(faction(), { councilors: [] })],
    ['a councilor with no org list', buildSpaceMiningBonus(faction(), { councilors: [{ displayName: 'A' }], ...complete })],
    ['no effect list carried', buildSpaceMiningBonus({ ID: OBSERVER }, { councilors: [], ...complete })],
    ['an unrecognised effect', buildSpaceMiningBonus(faction(['Effect_SpaceMiningBonus99']), { councilors: [], ...complete })]
  ];
  for (const [label, bonus] of cases) {
    assert.strictEqual(bonus.available, false, label);
    assert.strictEqual(bonus.state, SPACE_MINING_BONUS_STATES.unknown, label);
    assert.strictEqual(bonus.multiplier, null, `${label}: a null multiplier, not a confident 1.0`);
    assert.strictEqual(bonus.additiveTotal, null, label);
    assert.ok(typeof bonus.unknownReason === 'string' && bonus.unknownReason.length > 20,
      `${label}: says WHY, so the caller can report it`);
    assert.match(spaceMiningBonusCaveat(bonus), /UNRESOLVED/, label);
  }
});

test('applySpaceMiningBonus keeps an absent figure null and a measured zero zero', () => {
  const bonus = buildSpaceMiningBonus(faction(), { councilors: withOrgs(org('X', 0.1)), ...complete });
  for (const absent of [null, undefined, NaN, '12', {}]) {
    assert.strictEqual(applySpaceMiningBonus(absent, bonus).value, null,
      `${String(absent)} is not a measured figure and must not become one`);
  }
  assert.strictEqual(applySpaceMiningBonus(0, bonus).value, 0, 'a measured zero survives');
  // Rounded only when the caller asks. Unrounded, 100 x 1.1 is
  // 110.00000000000001 in IEEE 754, and pretending otherwise here would hide
  // that every caller has to choose its own `places`.
  assert.strictEqual(applySpaceMiningBonus(100, bonus, { places: 2 }).value, 110);
  assert.ok(Math.abs(applySpaceMiningBonus(100, bonus).value - 110) < 1e-9);
  assert.strictEqual(applySpaceMiningBonus(100, bonus).raw, 100, 'the pre-bonus figure survives beside it');
});

test('an unknown bonus returns the INPUT figure, flagged, not a scaled one and not null', () => {
  const unknown = buildSpaceMiningBonus(faction(), { councilors: [] });
  const out = applySpaceMiningBonus(250, unknown);
  assert.strictEqual(out.value, 250, 'the measured figure survives');
  assert.strictEqual(out.applied, false);
  assert.strictEqual(out.multiplier, null);
  assert.strictEqual(out.state, SPACE_MINING_BONUS_STATES.unknown);
  assert.ok(typeof out.reason === 'string' && out.reason.length > 0);
});

// ---------------------------------------------------------------------------
// An unpowered mine produces nothing
// ---------------------------------------------------------------------------

test('a completed but UNPOWERED mine is not operational, and construction status alone cannot see that', () => {
  const base = { mineModuleTemplate: 'SettlementMiningComplex', constructionStatus: 'operational' };
  const powered = resolveMineModuleMultiplier({ ...base, mineModulePowered: true });
  const unpowered = resolveMineModuleMultiplier({ ...base, mineModulePowered: false });
  const unread = resolveMineModuleMultiplier(base);

  assert.strictEqual(powered.operational, true);
  assert.strictEqual(powered.poweredRead, true);
  assert.strictEqual(unpowered.operational, false, 'an unpowered mine produces nothing');
  assert.strictEqual(unpowered.state, MINE_MODULE_STATES.measured, 'the module is still identified');
  assert.match(unpowered.reason, /UNPOWERED/);
  // An absent flag is NOT read as unpowered — that would zero a producing mine
  // on any snapshot older than the field — but it is reported as unread.
  assert.strictEqual(unread.operational, true);
  assert.strictEqual(unread.poweredRead, false);
  assert.strictEqual(unread.powered, null);
});

// ---------------------------------------------------------------------------
// The reconciliation. This is the test that cannot pass by construction.
// ---------------------------------------------------------------------------

const DAYS_PER_MONTH = 365.25 / 12;

// The model, with the additive term switchable so the test can show the term is
// load-bearing rather than decorative.
function modelMonthlyMined(snapshot, factionRecord, { applyBonus }) {
  const factionId = Number(factionRecord.ID);
  const bonus = buildSpaceMiningBonus(factionRecord, {
    councilors: snapshot.councilors.filter(c => Number(c.factionId) === factionId),
    councilorListComplete: true
  });
  if (bonus.available !== true) return null;
  const completed = new Set(factionRecord.completedProjects || []);
  const sites = snapshot.habSites.filter(s => Number(s.factionId) === factionId);
  const out = {};
  for (const { key, saveKey } of MINING_RESOURCES) {
    let sum = 0;
    for (const site of sites) {
      const resolution = resolveMineModuleMultiplier(site);
      if (resolution.state !== MINE_MODULE_STATES.measured || resolution.operational !== true) continue;
      const rate = Number(site[key]);
      if (!Number.isFinite(rate)) continue;
      sum += rate * resolution.multiplier;
    }
    const rule = MINING_BONUS_RULES.find(r => r.key === key);
    const grants = rule.projects.filter(p => completed.has(p)).length;
    out[saveKey] = sum * DAYS_PER_MONTH * Math.pow(1.15, grants) * (applyBonus ? bonus.multiplier : 1);
  }
  return { out, bonus };
}

test('with the space-mining bonus applied, every faction\'s mined output reconciles against the game\'s own revenue', () => {
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'omniscient', observer: OBSERVER });

  // Two things the mine model does not cover, excluded by MEASUREMENT rather
  // than by name: a faction that RECEIVES a resource transfer, and one that
  // owns a module with a flat resource income (the alien wormhole). Both add
  // revenue that no mine produced.
  const receivesTransfer = new Set((snapshot.resourceTransfers || [])
    .map(t => Number(t.targetFactionId)).filter(Number.isFinite));
  const FLAT_INCOME_MODULES = new Set(['AlienWormholeFacility']);
  const ownsFlatIncome = new Set((snapshot.habModules || [])
    .filter(m => FLAT_INCOME_MODULES.has(m.templateName))
    .map(m => Number(m.factionId)).filter(Number.isFinite));

  let checked = 0;
  let withBonus = 0;
  const failures = [];
  for (const factionRecord of snapshot.factions) {
    const factionId = Number(factionRecord.ID);
    if (receivesTransfer.has(factionId) || ownsFlatIncome.has(factionId)) continue;
    const reported = factionRecord.financials?.projectedMonthlyIncome;
    if (!reported) continue;
    const modelled = modelMonthlyMined(snapshot, factionRecord, { applyBonus: true });
    if (modelled === null) continue;

    let sawAny = false;
    for (const { saveKey } of MINING_RESOURCES) {
      const expected = Number(reported[saveKey]);
      const got = modelled.out[saveKey];
      if (!(got > 0) || !Number.isFinite(expected) || expected <= 0) continue;
      sawAny = true;
      const error = Math.abs(got / expected - 1);
      // 0.05% is looser than the 0.0022% measured, and still an order of
      // magnitude tighter than the smallest residual this term explains (10%).
      if (error > 5e-4) {
        failures.push(`${factionRecord.displayName}/${saveKey}: model ${got.toFixed(2)} vs reported `
          + `${expected.toFixed(2)} (${(error * 100).toFixed(3)}%)`);
      }
    }
    if (!sawAny) continue;
    checked += 1;
    if (modelled.bonus.additiveTotal > 0) withBonus += 1;
  }

  assert.deepStrictEqual(failures, [], 'every checked faction reconciles');
  assert.ok(checked >= 4, `at least four factions were actually checked (was ${checked})`);
  assert.ok(withBonus >= 1,
    `at least one checked faction holds a non-zero space-mining bonus, or this save no longer exercises `
    + `the term end to end (was ${withBonus})`);
});

test('WITHOUT the space-mining bonus the same model does NOT reconcile, which is what makes the term load-bearing', () => {
  // The mirror of the test above. If this ever passes, the term has stopped
  // mattering on this save and the test above has become decorative.
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'omniscient', observer: OBSERVER });
  const receivesTransfer = new Set((snapshot.resourceTransfers || [])
    .map(t => Number(t.targetFactionId)).filter(Number.isFinite));
  const ownsFlatIncome = new Set((snapshot.habModules || [])
    .filter(m => m.templateName === 'AlienWormholeFacility')
    .map(m => Number(m.factionId)).filter(Number.isFinite));

  const brokenFactions = [];
  for (const factionRecord of snapshot.factions) {
    const factionId = Number(factionRecord.ID);
    if (receivesTransfer.has(factionId) || ownsFlatIncome.has(factionId)) continue;
    const reported = factionRecord.financials?.projectedMonthlyIncome;
    if (!reported) continue;
    const without = modelMonthlyMined(snapshot, factionRecord, { applyBonus: false });
    if (without === null || without.bonus.additiveTotal === 0) continue;
    for (const { saveKey } of MINING_RESOURCES) {
      const expected = Number(reported[saveKey]);
      const got = without.out[saveKey];
      if (!(got > 0) || !Number.isFinite(expected) || expected <= 0) continue;
      if (Math.abs(got / expected - 1) > 5e-4) { brokenFactions.push(factionRecord.displayName); break; }
    }
  }
  assert.ok(brokenFactions.length >= 1,
    'dropping the term must break at least one faction that holds it — otherwise the reconciliation above '
    + `proves nothing (broken: ${brokenFactions.join(', ') || 'none'})`);
});

// ---------------------------------------------------------------------------
// Both modes, and no rival leak
// ---------------------------------------------------------------------------

test('the observer resolves its own bonus in player mode as well as omniscient', () => {
  for (const mode of ['player', 'omniscient']) {
    const snapshot = loadFixtureFilteredSnapshot({ mode, observer: OBSERVER });
    const observerFaction = snapshot.factions.find(f => Number(f.ID) === OBSERVER);
    const expected = buildSpaceMiningBonus(observerFaction, {
      councilors: snapshot.councilors.filter(c => Number(c.factionId) === OBSERVER),
      councilorListComplete: true
    });
    const payload = queryIntel({ snapshot, endpoint: 'mining-expansion', mode, observer: OBSERVER });
    const published = payload.spaceMiningBonus;
    assert.ok(published, `${mode}: the board publishes the bonus block`);
    assert.strictEqual(published.available, true,
      `${mode}: the observer's own roster and effect list are not redacted, so this must resolve`);
    // Provenance, not just plausibility: substituting any other faction's
    // holdings fails here.
    assert.strictEqual(published.multiplier, expected.multiplier, `${mode}: same multiplier`);
    assert.deepStrictEqual(published.sources, expected.sources, `${mode}: same named sources`);
    assert.strictEqual(published.measuredOn, SPACE_MINING_BONUS_MEASURED_ON);
  }
});

test('a rival\'s effect list is redacted in player mode, and the whole payload is scanned for it', () => {
  const omniscient = loadFixtureFilteredSnapshot({ mode: 'omniscient', observer: OBSERVER });
  const rivalEffects = new Set();
  for (const f of omniscient.factions) {
    if (Number(f.ID) === OBSERVER) continue;
    for (const name of (f.spaceMiningBonusEffects || [])) rivalEffects.add(name);
  }
  assert.ok(rivalEffects.size > 0,
    'this save gives at least one rival a SpaceMiningBonus effect, or this test covers nothing');

  const player = loadFixtureFilteredSnapshot({ mode: 'player', observer: OBSERVER });
  for (const f of player.factions) {
    if (Number(f.ID) === OBSERVER) continue;
    assert.strictEqual(f.spaceMiningBonusEffects, null,
      `${f.displayName}: null, never [] — an empty list reads as a measured "holds none"`);
  }
  // Scan the ENTIRE player payload, not one field: four past leaks all had the
  // derived field nulled while the raw one it came from survived.
  //
  // Two blocks are excluded, and only these two: `techTree` and `effectIndex`
  // are the STATIC template graph. They say "Project_GoldRush grants
  // Effect_SpaceMiningBonus10", which is shipped-template knowledge available to
  // anyone with the game installed and is attached to no faction. Everything
  // else — anything that could associate a rival with the effect — is scanned.
  const { techTree, effectIndex, ...factionScoped } = player;
  assert.ok(techTree && effectIndex,
    'both static blocks are present, so excluding them is a deliberate narrowing and not a silent no-op');
  const serialised = JSON.stringify(factionScoped);
  const observerEffects = new Set(player.factions.find(f => Number(f.ID) === OBSERVER)?.spaceMiningBonusEffects || []);
  for (const name of rivalEffects) {
    if (observerEffects.has(name)) continue;
    assert.ok(!serialised.includes(name),
      `player mode must not name ${name} outside the static template graph — only a rival holds it`);
  }
});

test('a rival\'s org mining bonus cannot be composed in player mode, and refuses rather than under-reporting', () => {
  const player = loadFixtureFilteredSnapshot({ mode: 'player', observer: OBSERVER });
  for (const f of player.factions) {
    const factionId = Number(f.ID);
    if (factionId === OBSERVER) continue;
    const bonus = buildSpaceMiningBonus(f, {
      councilors: player.councilors.filter(c => Number(c.factionId) === factionId),
      // The caller can never legitimately claim completeness for a rival: the
      // filter publishes only part of the roster and strips `orgs` from what it
      // does publish. Passing `true` here is the mistake this asserts against.
      councilorListComplete: true
    });
    // UNKNOWN, not merely "not measured". `measured-none` would be the worse
    // failure of the two: it states that a rival holds no mining bonus, which
    // is a confident zero read off a roster player mode deliberately truncated.
    assert.strictEqual(bonus.state, SPACE_MINING_BONUS_STATES.unknown,
      `${f.displayName}: player mode must refuse a rival bonus outright — anything else is a figure `
      + `built from a redacted roster (got ${bonus.state})`);
  }
});

// ---------------------------------------------------------------------------
// The record of what is and is not modelled
// ---------------------------------------------------------------------------

test('UNMODELLED_FACTORS no longer claims the per-faction scalar is unexplained', () => {
  const stale = UNMODELLED_FACTORS.find(entry => /unexplained per-faction mining scalar/i.test(entry.factor));
  assert.strictEqual(stale, undefined,
    'the scalar was explained; leaving it listed as unexplained would send the next reader after a solved problem');
  const closed = UNMODELLED_FACTORS.find(entry => /per-faction mining scalar/i.test(entry.factor));
  assert.ok(closed, 'it is still listed, restated as closed, so the history is not lost');
  assert.match(closed.factor, /CLOSED/);
  assert.match(closed.reason, /spaceMiningBonus/);
  const additive = UNMODELLED_FACTORS.find(entry => /SpaceMiningBonus additive fraction/.test(entry.factor));
  assert.ok(additive && /now MODELLED/.test(additive.reason),
    'the additive fraction is no longer declared unhandled — it is handled, elsewhere, and says where');
});
