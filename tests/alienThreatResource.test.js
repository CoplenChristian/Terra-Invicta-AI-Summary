const { test } = require('node:test');
const assert = require('node:assert');

const { buildResource } = require('../server/intelResources');

// Exercise the same public path the HTTP route uses.
const alienThreatResource = (snap) => buildResource(snap, 'alien-threat', { mode: 'omniscient' });

// Reference values from the official wiki's Diplomacy page ("Alien Hate for
// Mission Control Usage" table), last edited 2026-08-11. The minimum alien
// hate floor is (used Mission Control) x (difficulty multiplier) x 0.8^n,
// where n is the number of completed concealment projects. Only USED mission
// control counts -- never the cap.
const CONCEALMENT = [
  'Project_StrategicDeception',
  'Project_Maskirovka',
  'Project_OperationalMisdirection'
];

function snapshot({
  projects = [],
  difficulty = 'Normal',
  usedMC = 100,
  displayName = 'the Initiative',
  hate = 71.6,
  extra = {}
} = {}) {
  return {
    metadata: { difficulty },
    observerFactionId: 4712,
    factions: [{
      ID: 4712,
      displayName,
      missionControlUsage: usedMC,
      missionControlCapacity: 200,
      assessedAlienHateOfMe: hate,
      completedProjects: projects,
      ...extra
    }]
  };
}

test('safe mission-control ceiling matches the wiki table on Normal', () => {
  // Regression guard: a previous implementation applied concealment projects
  // as an additive -25% each, which reported 667 MC safe at three projects
  // against a real ceiling of 325 -- enough to walk into permanent alien war.
  const expected = [166, 208, 260, 325];
  expected.forEach((mcCeiling, projectCount) => {
    const result = alienThreatResource(snapshot({ projects: CONCEALMENT.slice(0, projectCount) }));
    assert.strictEqual(
      result.minimumHateMCThreshold,
      mcCeiling,
      `${projectCount} concealment project(s) should allow ${mcCeiling} used MC`
    );
  });
});

test('difficulty multipliers match the wiki', () => {
  const expected = { Cinematic: 0.05, Normal: 0.30, Veteran: 0.60, Brutal: 1.00 };
  for (const [difficulty, multiplier] of Object.entries(expected)) {
    assert.strictEqual(
      alienThreatResource(snapshot({ difficulty })).difficultyMultiplier,
      multiplier,
      `${difficulty} multiplier`
    );
  }
});

test('concealment projects compound multiplicatively, not additively', () => {
  const result = alienThreatResource(snapshot({ projects: CONCEALMENT.slice(0, 2) }));
  // 100 MC x 0.30 x 0.8^2 = 19.2, NOT 100 x 0.30 x (1 - 0.5) = 15.
  assert.strictEqual(result.minimumHate, 19.2);
  assert.strictEqual(result.projects.totalReductionPercent, 36);
  assert.strictEqual(result.projects.concealmentMultiplier, 0.8 ** 2);
});

test('Operational Security applies to the Resistance only', () => {
  const initiative = alienThreatResource(snapshot());
  assert.ok(!initiative.projects.applicable.includes('Project_OperationalSecurity'));

  const resistance = alienThreatResource(snapshot({
    displayName: 'The Resistance',
    projects: [...CONCEALMENT, 'Project_OperationalSecurity']
  }));
  assert.ok(resistance.projects.applicable.includes('Project_OperationalSecurity'));
  // Wiki table, Normal difficulty, all four projects.
  assert.strictEqual(resistance.minimumHateMCThreshold, 406);
});

test('the hate floor tracks used mission control, never the cap', () => {
  const low = alienThreatResource(snapshot({ usedMC: 60 }));
  assert.strictEqual(low.minimumHate, 18);
  assert.strictEqual(low.usedMC, 60);

  // Same faction, same cap, double the usage -> double the floor.
  const high = alienThreatResource(snapshot({ usedMC: 120 }));
  assert.strictEqual(high.minimumHate, 36);
});

test('ventable hate is reported as conditional, not guaranteed', () => {
  const result = alienThreatResource(snapshot());
  assert.strictEqual(result.venting.guaranteed, false);
  assert.strictEqual(result.venting.conditions.length, 3);
  assert.match(result.venting.conditions.join(' '), /Total War/);
  assert.match(result.venting.conditions.join(' '), /Trespassing/);
  // Every hate modifier is scaled by a random 0.8-1.2 in game.
  assert.deepStrictEqual(result.hateModifierVariance, { min: 0.8, max: 1.2 });
});

test('absent retaliation fields report unknown rather than zero', () => {
  const result = alienThreatResource(snapshot());
  assert.strictEqual(result.retaliation.aliensRemoved, null);
  assert.strictEqual(result.retaliation.factionAssassinations, null);
  assert.strictEqual(result.retaliation.lastDateOfFixedAlienHate, null);
  assert.deepStrictEqual(result.retaliation.unavailableFields, [
    'aliensRemoved', 'factionAssassinations', 'lastDateOfFixedAlienHate'
  ]);
});

test('alien investigations are counted, not leaked as a raw array', () => {
  // snapshotBuilder produces an array here; [] is truthy in JS, so the old
  // `observer.alienInvestigations || 0` emitted the array itself every time.
  const withArray = alienThreatResource(snapshot({ extra: { alienInvestigations: ['a', 'b', 'c'] } }));
  assert.strictEqual(withArray.retaliation.alienInvestigationCount, 3);

  const empty = alienThreatResource(snapshot({ extra: { alienInvestigations: [] } }));
  assert.strictEqual(empty.retaliation.alienInvestigationCount, 0);

  const missing = alienThreatResource(snapshot());
  assert.strictEqual(missing.retaliation.alienInvestigationCount, null);
});

test('war status reflects the fixed alien threshold of 50', () => {
  const atWar = alienThreatResource(snapshot({ hate: 71.6 }));
  assert.strictEqual(atWar.warThreshold, 50);
  assert.strictEqual(atWar.retaliation.retaliationActive, true);

  const atPeace = alienThreatResource(snapshot({ hate: 12 }));
  assert.strictEqual(atPeace.retaliation.retaliationActive, false);
  assert.strictEqual(atPeace.retaliation.retaliationReason, 'None');
});

// --- Ship design hull stats -------------------------------------------------
// Mission Control is the only input to the alien hate floor, so a flat
// per-design guess (the old `missionControl: 1`) silently understates what a
// fleet does to alien hate. Real values come from the game templates.
const { shipDesignsResource } = require('../shared/intelResources.mjs');

test('ship designs report real per-hull mission control, not a flat 1', () => {
  const snap = {
    shipHullStats: {
      Escort: { missionControl: 1, constructionTier: 1, baseConstructionTimeDays: 90 },
      Battlecruiser: { missionControl: 3, constructionTier: 2, baseConstructionTimeDays: 180 }
    },
    shipDesigns: [
      { dataName: 'cheap', displayName: 'Cheap Escort', hullName: 'Escort' },
      { dataName: 'line', displayName: 'Rail BC', hullName: 'Battlecruiser' }
    ]
  };
  const [escort, bc] = shipDesignsResource(snap);

  assert.strictEqual(escort.missionControl, 1);
  assert.strictEqual(escort.buildTimeDays, 90, 'Escort base build time is 90 days, not 45');
  assert.strictEqual(bc.missionControl, 3, 'Battlecruiser costs 3 MC, not 1');
  assert.strictEqual(bc.buildTimeDays, 180);
  assert.strictEqual(bc.constructionTier, 2);
  assert.strictEqual(bc.hullStatsSource, 'game-template');
});

test('unknown hulls report mission control as unknown rather than 1', () => {
  const [design] = shipDesignsResource({
    shipHullStats: {},
    shipDesigns: [{ dataName: 'x', displayName: 'Mystery', hullName: 'NotAHull' }]
  });
  assert.strictEqual(design.missionControl, null);
  assert.strictEqual(design.hullStatsSource, 'unavailable');
});
