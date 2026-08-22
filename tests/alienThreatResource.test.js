const { test } = require('node:test');
const assert = require('node:assert');

const { buildResource } = require('../server/intelResources');

// Exercise the same public path the HTTP route uses.
const alienThreatResource = (snap, mode = 'omniscient') => buildResource(snap, 'alien-threat', { mode });

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

// --- Total War gate ---------------------------------------------------------
//
// The 200-hate / N-year gate now reaches this endpoint. It used not to: the
// resource built its hate economics WITHOUT elapsed campaign time, and
// buildTotalWarState answers 'unavailable' rather than a false 'safe' when
// elapsed years are missing -- so the endpoint published no verdict at all
// while /api/snapshot, /api/v2/briefing and /latest-war-room.md each carried
// one. Measured 2026-08-22 before the change: `economics.totalWar.state` was
// 'unavailable' here in all three modes, with a 20-year Normal gate from an
// assumed 1x progression speed.
//
// The expected figures below were read off `alienHateEconomics.totalWar` on
// the SNAPSHOT -- the surface that already had them -- before this endpoint
// emitted anything, against ExitSave.gz (1/1/2035, md5
// 5c0d9ef98213c91d8187ae11bf885d57): daysInCampaign 3256, difficulty Normal,
// Alien Progression Speed 200%, raw hate 42.86253.
const { buildCampaignSettings } = require('../shared/campaignSettings.mjs');
const snapshotBuilder = require('../server/snapshotBuilder');
const intelligenceFilter = require('../server/intelligenceFilter');
const { makeSaveData } = require('./fixtures/syntheticSave');

const LIVE_SAVE_HATE = 42.86253;

/** The live campaign's gate inputs, on the fixture shape this file already uses. */
function gatedSnapshot({
  daysInCampaign = 3256,
  alienProgressionSpeed = '200%',
  difficulty = 'Normal',
  hate = LIVE_SAVE_HATE,
  mode = null
} = {}) {
  const base = snapshot({ difficulty, hate, usedMC: 100 });
  base.metadata = {
    ...base.metadata,
    gameTimeString: '1/1/2035 12:00:00 AM',
    ...(daysInCampaign === null ? {} : { daysInCampaign }),
    ...(alienProgressionSpeed === null
      ? {}
      : {
        campaignSettings: buildCampaignSettings({
          difficulty,
          customDifficulty: true,
          alienProgressionSpeed
        })
      })
  };
  if (mode) base.mode = mode;
  return base;
}

test('the total-war gate reaches /api/intel/alien-threat with the save\'s own figures', () => {
  const result = alienThreatResource(gatedSnapshot());

  // Pre-change values, taken from the snapshot's own block. Not rounded here:
  // `hateRemaining` is published unrounded on every other surface and this one
  // must not quietly disagree in the third decimal.
  assert.deepStrictEqual(result.totalWar, {
    state: 'safe',
    hateThreshold: 200,
    yearsThreshold: 10,
    yearsElapsed: 8.91,
    hateRemaining: 200 - LIVE_SAVE_HATE,
    yearsRemaining: 1.09,
    maximumAlienHate: 2782,
    progressionSpeedAssumed: false,
    alienProgressionSpeed: 2
  });

  assert.strictEqual(result.totalWarStatus, 'available');
  assert.match(result.totalWarSource, /daysInCampaign = 3256/);
  assert.strictEqual(result.campaignAgeBasis, 'days-in-campaign');
  assert.strictEqual(result.daysInCampaign, 3256);
});

test('the year gate is divided by the save\'s Alien Progression Speed', () => {
  // Normal is a 20-year gate at stock speed; this campaign runs 200%, which is
  // what takes the live save from "7 years away" to 1.09.
  const stock = alienThreatResource(gatedSnapshot({ alienProgressionSpeed: null }));
  assert.strictEqual(stock.totalWar.yearsThreshold, 20);
  assert.strictEqual(stock.totalWar.progressionSpeedAssumed, true);
  assert.strictEqual(stock.totalWar.yearsRemaining, 11.09);

  const accelerated = alienThreatResource(gatedSnapshot());
  assert.strictEqual(accelerated.totalWar.yearsThreshold, 10);
  assert.strictEqual(accelerated.totalWar.progressionSpeedAssumed, false);
});

test('player mode keeps the year gate and drops the hate half, without leaking hate', () => {
  // The year gate is knowable even when hate is redacted -- that asymmetry is
  // the whole reason 'safe_hate_unknown' exists. `hateRemaining` must be null
  // and never `200 - 0`, which is the shape of every Number(null) defect in
  // this repo's history.
  const result = alienThreatResource(gatedSnapshot({ mode: 'player' }), 'player');

  assert.strictEqual(result.totalWar.state, 'safe_hate_unknown');
  assert.strictEqual(result.totalWar.hateRemaining, null);
  assert.strictEqual(result.totalWar.yearsRemaining, 1.09);
  assert.strictEqual(result.totalWar.yearsThreshold, 10);
  assert.strictEqual(result.totalWar.maximumAlienHate, 2782);
  assert.strictEqual(result.totalWarStatus, 'available');

  // Scan the WHOLE payload, not one field: four shipped player-mode leaks all
  // had the derived figure nulled while a raw one survived.
  const payload = JSON.stringify(result);
  for (const form of [
    String(LIVE_SAVE_HATE),
    LIVE_SAVE_HATE.toFixed(2),
    LIVE_SAVE_HATE.toFixed(1),
    String(200 - LIVE_SAVE_HATE)
  ]) {
    assert.ok(!payload.includes(form), `player payload leaked the raw hate as ${form}`);
  }
});

test('a gate that cannot be evaluated reports unavailable, never safe', () => {
  // `snapshot()` carries a difficulty and nothing about campaign duration --
  // the shape of a hand-built fixture, or a save parsed before daysInCampaign
  // was read. Unknown is not safe: this is a threat endpoint, and falling
  // through to "you're fine" is the worst direction to be wrong in.
  const result = alienThreatResource(snapshot());

  assert.strictEqual(result.totalWar.state, 'unavailable');
  assert.notStrictEqual(result.totalWar.state, 'safe');
  assert.strictEqual(result.totalWarStatus, 'unavailable');
  assert.match(result.totalWarSource, /^unavailable: /);
  assert.match(result.totalWarSource, /elapsed campaign time/);

  // Absent stays null. A 0 here reads as "the gate opens today" for the years
  // and "the aliens cannot hate you at all" for the ceiling.
  assert.strictEqual(result.totalWar.yearsElapsed, null);
  assert.strictEqual(result.totalWar.yearsRemaining, null);
  assert.strictEqual(result.totalWar.maximumAlienHate, null);
  // Hate IS known on this fixture (71.6), and `hateRemaining` is still null:
  // buildTotalWarState withholds the whole block rather than publishing the
  // half it can compute beside a verdict it cannot. Pinned because emitting
  // 128.4 here would read as a partially-evaluated gate.
  assert.strictEqual(result.actualHate, 71.6);
  assert.strictEqual(result.totalWar.hateRemaining, null);
  assert.strictEqual(result.daysInCampaign, null);
  assert.strictEqual(result.campaignAgeBasis, 'unavailable');
});

test('an unreadable difficulty leaves the gate unavailable and says which input is missing', () => {
  const result = alienThreatResource(gatedSnapshot({ difficulty: null }));

  assert.strictEqual(result.totalWar.state, 'unavailable');
  assert.strictEqual(result.totalWarStatus, 'unavailable');
  assert.strictEqual(result.totalWar.yearsThreshold, null);
  // The years ARE readable here, so the reason must name the difficulty and
  // not blame the campaign age.
  assert.match(result.totalWarSource, /difficulty/);
  assert.ok(!/elapsed campaign time/.test(result.totalWarSource), result.totalWarSource);
});

test('the endpoint publishes the same gate object the snapshot does, in every mode', () => {
  // The point of routing through shared/campaignElapsed.mjs rather than
  // re-deriving: two surfaces reading one save cannot report two verdicts.
  // Exercised through the real filter, so this fails if either path drifts.
  // The observer's hate is fractional on purpose: `hateRemaining` is published
  // unrounded, and a whole-number fixture would let a `toFixed(1)` on either
  // surface slip past this comparison.
  const save = makeSaveData({ factionOptions: { 4712: { hate: LIVE_SAVE_HATE } } });
  save.daysInCampaign = 3256;
  save.campaignSettings = buildCampaignSettings({
    difficulty: 'Veteran',
    customDifficulty: true,
    alienProgressionSpeed: '200%'
  });
  const raw = snapshotBuilder.buildRawSnapshot(save);

  for (const mode of ['player', 'enhanced', 'omniscient']) {
    const filtered = intelligenceFilter.applyFilter(raw, mode, 4712);
    const endpoint = buildResource(filtered, 'alien-threat', { mode });

    assert.deepStrictEqual(
      endpoint.totalWar,
      filtered.alienHateEconomics.totalWar,
      `${mode} mode: the endpoint's total-war gate differs from the snapshot's`
    );
    assert.strictEqual(
      endpoint.totalWarSource,
      filtered.alienHateEconomics.yearsElapsedSource,
      `${mode} mode: campaign-age provenance differs from the snapshot's`
    );
    assert.strictEqual(endpoint.campaignAgeBasis, filtered.alienHateEconomics.campaignAgeBasis);
    assert.strictEqual(endpoint.daysInCampaign, filtered.alienHateEconomics.daysInCampaign);
    // Veteran is a 10-year gate, halved to 5 by the 200% speed, against 8.91
    // elapsed -- so the year half has PASSED and only hate stands in the way.
    assert.strictEqual(
      endpoint.totalWar.state,
      mode === 'player' ? 'armed_hate_unknown' : 'armed',
      `${mode} mode state`
    );
  }
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
