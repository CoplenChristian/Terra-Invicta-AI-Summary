const { test } = require('node:test');
const assert = require('node:assert');

const { buildStrategicDelta } = require('../shared/strategicDelta.mjs');

const OBSERVER = 4712;

function doc(overrides = {}) {
  return {
    schema: 'strategic_snapshot_v1',
    meta: { campaignDate: '7/16/2031 12:00:00 PM', saveLastModified: '2026-08-19T16:19:34.305Z' },
    summary: {
      observerFactionId: OBSERVER,
      factions: [
        { id: OBSERVER, ships: 23, fleets: 2, habs: 13 },
        { id: 4717, ships: 161, habs: 24 }
      ]
    },
    economy: {
      mc: { used: 60, cap: 137, minePenalty: 0 },
      mines: { count: 7, limit: 15 },
      resources: { nobles: [3995, 103], water: [4112, 189] }
    },
    alienThreat: { hate: 71.61, minimumHate: 18, warThreshold: 50, totalWar: false },
    research: {
      monthly: 2022,
      projects: [['Project_FleetCombatants', 2567, 6000]],
      completedProjectHash: 'fnv:aaaa:10',
      completedSincePrior: []
    },
    infrastructure: [{ id: 700, body: 'Mars' }, { id: 701, body: 'Luna' }],
    ships: [[1, 'Patapsco', 900], [2, 'Patapsco', 900], [3, 'Cimarron', 900]],
    ...overrides
  };
}

test('reports a baseline when there is no earlier snapshot', () => {
  const delta = buildStrategicDelta(null, doc());
  assert.strictEqual(delta.baseline, true);
  assert.ok(delta.note.includes('first'));
});

test('diffs force levels for both sides', () => {
  const to = doc({
    summary: {
      observerFactionId: OBSERVER,
      factions: [{ id: OBSERVER, ships: 19, fleets: 2, habs: 13 }, { id: 4717, ships: 168, habs: 24 }]
    }
  });
  const delta = buildStrategicDelta(doc(), to);
  assert.deepStrictEqual(delta.military.observerShips, { from: 23, to: 19, delta: -4 });
  assert.deepStrictEqual(delta.military.alienShips, { from: 161, to: 168, delta: 7 });
});

test('names what died rather than just counting it', () => {
  const to = doc({ ships: [[1, 'Patapsco', 900]] });
  const delta = buildStrategicDelta(doc(), to);
  const byDesign = Object.fromEntries(delta.shipLosses.map(l => [l.design, l.count]));
  assert.deepStrictEqual(byDesign, { Patapsco: 1, Cimarron: 1 });
  assert.ok(delta.events.some(e => e.includes('Patapsco')));
});

test('tracks habs lost and gained', () => {
  const to = doc({ infrastructure: [{ id: 700, body: 'Mars' }, { id: 900, body: 'Ceres' }] });
  const delta = buildStrategicDelta(doc(), to);
  assert.deepStrictEqual(delta.infrastructure.lost, [{ id: 701, body: 'Luna' }]);
  assert.deepStrictEqual(delta.infrastructure.gained, [{ id: 900, body: 'Ceres' }]);
});

test('flags crossing the alien war threshold', () => {
  const below = doc({ alienThreat: { hate: 42, minimumHate: 18, warThreshold: 50, totalWar: false } });
  const above = doc({ alienThreat: { hate: 58, minimumHate: 18, warThreshold: 50, totalWar: false } });

  assert.strictEqual(buildStrategicDelta(below, above).hate.crossedWarThreshold, 'up');
  assert.strictEqual(buildStrategicDelta(above, below).hate.crossedWarThreshold, 'down');
  assert.strictEqual(buildStrategicDelta(below, below).hate.crossedWarThreshold, null);
});

test('flags a total war declaration exactly once', () => {
  const peace = doc();
  const war = doc({ alienThreat: { hate: 240, minimumHate: 18, warThreshold: 50, totalWar: true } });
  assert.strictEqual(buildStrategicDelta(peace, war).hate.totalWarDeclared, true);
  assert.strictEqual(buildStrategicDelta(war, war).hate.totalWarDeclared, false,
    'already at total war is not a new declaration');
});

test('diffs economy stockpiles and mission control', () => {
  const to = doc({
    economy: {
      mc: { used: 96, cap: 137, minePenalty: 0 },
      mines: { count: 9, limit: 15 },
      resources: { nobles: [3677, 117], water: [4112, 189] }
    }
  });
  const delta = buildStrategicDelta(doc(), to);
  assert.deepStrictEqual(delta.economy.nobles.stockpile, { from: 3995, to: 3677, delta: -318 });
  assert.deepStrictEqual(delta.economy.missionControlUsed, { from: 60, to: 96, delta: 36 });
  assert.deepStrictEqual(delta.economy.mines, { from: 7, to: 9, delta: 2 });
});

test('unknown values never produce a fabricated delta', () => {
  // Older snapshots predate missionControlUsage; a delta against a missing
  // value would invent a trend that never happened.
  const from = doc({ economy: { mc: { used: null, cap: null }, mines: {}, resources: {} } });
  const to = doc({ economy: { mc: { used: 67, cap: 151 }, mines: {}, resources: {} } });
  assert.deepStrictEqual(buildStrategicDelta(from, to).economy.missionControlUsed,
    { from: null, to: 67, delta: null });
});

test('tracks project starts and resolutions', () => {
  const to = doc({
    research: {
      monthly: 2609,
      projects: [['Project_NanotubeArmor', 100, 5000]],
      completedProjectHash: 'fnv:bbbb:11',
      completedSincePrior: ['Project_FleetCombatants']
    }
  });
  const delta = buildStrategicDelta(doc(), to);
  assert.deepStrictEqual(delta.research.resolved, ['Project_FleetCombatants']);
  assert.deepStrictEqual(delta.research.started, ['Project_NanotubeArmor']);
  assert.deepStrictEqual(delta.research.completed, ['Project_FleetCombatants']);
});

test('narrates the diff in plain language', () => {
  // Start below the war threshold so the crossing is genuinely upward; 71.61
  // to 58 is a fall between two values that are both already above 50.
  const from = doc({ alienThreat: { hate: 42, minimumHate: 18, warThreshold: 50, totalWar: false } });
  const to = doc({
    summary: { observerFactionId: OBSERVER, factions: [{ id: OBSERVER, ships: 19 }, { id: 4717, ships: 168 }] },
    ships: [[1, 'Patapsco', 900]],
    alienThreat: { hate: 58, minimumHate: 18, warThreshold: 50, totalWar: false }
  });
  const events = buildStrategicDelta(from, to).events;
  assert.ok(events.some(e => /Lost 4 ship/.test(e)), 'summary loss line');
  assert.ok(events.some(e => /Lost 1x Patapsco/.test(e)), 'names the design that died');
  assert.ok(events.some(e => /Alien fleet grew by 7/.test(e)));
  assert.ok(events.some(e => /Alien hate rose 16 to 58/.test(e)));
  assert.ok(events.some(e => /Crossed the alien war threshold/.test(e)));
});

test('elapsed days are measured in campaign time, not wall clock', () => {
  // Two saves played back to back are minutes apart in real time but months
  // apart in game. Every trend question is about the in-game interval.
  const from = doc({
    meta: { campaignDate: '6/1/2032 12:00:00 AM', saveLastModified: '2026-08-19T21:34:42.607Z' }
  });
  const to = doc({
    meta: { campaignDate: '8/16/2032 12:00:00 PM', saveLastModified: '2026-08-19T22:18:11.465Z' }
  });
  const delta = buildStrategicDelta(from, to);
  assert.strictEqual(delta.period.days, 77, 'June 1 to August 16 is 76.5 in-game days');
  assert.notStrictEqual(delta.period.days, 0, 'wall clock would have reported 0');
});

test('falls back to wall clock when campaign dates are unusable', () => {
  const from = doc({ meta: { campaignDate: null, saveLastModified: '2026-08-01T00:00:00Z' } });
  const to = doc({ meta: { campaignDate: null, saveLastModified: '2026-08-11T00:00:00Z' } });
  assert.strictEqual(buildStrategicDelta(from, to).period.days, 10);
});

// --- Alien total war ---------------------------------------------------------
// buildAlienThreat now emits `totalWar` as the state object buildTotalWarState
// produces. Nothing in the codebase ever emitted the bare boolean this module
// used to read, so `totalWarDeclared` was permanently false and the
// 'ALIEN TOTAL WAR DECLARED' narration was unreachable.

const threat = (overrides = {}) => ({
  hate: 71.61, minimumHate: 18, warThreshold: 50, ...overrides
});

test('a total war declaration in the state object fires the narration', () => {
  const peace = doc({ alienThreat: threat({ totalWar: { state: 'armed' } }) });
  const war = doc({ hate: 240, alienThreat: threat({ hate: 240, totalWar: { state: 'active' } }) });

  const delta = buildStrategicDelta(peace, war);
  assert.strictEqual(delta.hate.totalWarDeclared, true);
  assert.strictEqual(delta.hate.totalWarActive, true);
  assert.deepStrictEqual(delta.hate.totalWarState, { from: 'armed', to: 'active' });
  assert.ok(delta.events.includes('ALIEN TOTAL WAR DECLARED'),
    'the single most consequential event in a campaign must announce itself');
});

test('an already-declared total war is not re-announced as a declaration', () => {
  const war = doc({ alienThreat: threat({ totalWar: { state: 'active' } }) });
  const delta = buildStrategicDelta(war, war);
  assert.strictEqual(delta.hate.totalWarDeclared, false);
  assert.ok(!delta.events.includes('ALIEN TOTAL WAR DECLARED'));
  assert.ok(delta.events.includes('Alien total war remains in effect'));
});

test('total war before the year gate is provably inactive even with hate redacted', () => {
  // safe_hate_unknown means the campaign-year gate is CLOSED, so total war is
  // impossible regardless of hate. That is knowable, not unknown.
  const early = doc({ alienThreat: threat({ hate: null, totalWar: { state: 'safe_hate_unknown' } }) });
  const delta = buildStrategicDelta(early, early);
  assert.strictEqual(delta.hate.totalWarActive, false);
  assert.ok(!delta.events.some(e => /UNAVAILABLE/.test(e)));
});

test('total war after the year gate with hate redacted reports unknown, never safe', () => {
  const armed = doc({ alienThreat: threat({ hate: null, totalWar: { state: 'armed_hate_unknown' } }) });
  const delta = buildStrategicDelta(doc({ alienThreat: threat({ totalWar: { state: 'armed' } }) }), armed);
  assert.strictEqual(delta.hate.totalWarActive, null, 'unknown is not the same as safe');
  assert.strictEqual(delta.hate.totalWarDeclared, false, 'we cannot claim a declaration we cannot see');
  assert.ok(delta.events.some(e => /total war status UNAVAILABLE/.test(e)));
});

test('a snapshot with no total war field at all reports unknown', () => {
  const silent = doc({ alienThreat: threat() });
  const delta = buildStrategicDelta(silent, silent);
  assert.strictEqual(delta.hate.totalWarActive, null);
  assert.strictEqual(delta.hate.totalWarState.to, null);
});

test('the first-generation boolean total war field is still understood', () => {
  const peace = doc({ alienThreat: threat({ totalWar: false }) });
  const war = doc({ alienThreat: threat({ totalWar: true }) });
  assert.strictEqual(buildStrategicDelta(peace, war).hate.totalWarDeclared, true);
  assert.strictEqual(buildStrategicDelta(war, war).hate.totalWarDeclared, false);
});

// --- Completed projects ------------------------------------------------------

const research = (overrides = {}) => ({
  monthly: 2022,
  projects: [['Project_FleetCombatants', 2567, 6000]],
  completedProjects: ['Project_A', 'Project_B'],
  completedProjectHash: 'fnv:aaaa:2',
  ...overrides
});

test('completed projects are named from the ledger, for any pair of snapshots', () => {
  const from = doc({ research: research() });
  const to = doc({
    research: research({
      projects: [['Project_NanotubeArmor', 100, 5000]],
      completedProjects: ['Project_A', 'Project_B', 'Project_FleetCombatants'],
      completedProjectHash: 'fnv:bbbb:3'
    })
  });

  const delta = buildStrategicDelta(from, to);
  assert.deepStrictEqual(delta.research.completed, ['Project_FleetCombatants']);
  assert.strictEqual(delta.research.completedSource, 'completed-project-ledger');
  assert.deepStrictEqual(delta.research.resolved, ['Project_FleetCombatants']);
  assert.deepStrictEqual(delta.research.started, ['Project_NanotubeArmor']);
  assert.ok(delta.events.includes('Completed Project_FleetCombatants'));
});

test('a project abandoned rather than finished is resolved but not completed', () => {
  const from = doc({ research: research() });
  const to = doc({
    research: research({ projects: [], completedProjectHash: 'fnv:aaaa:2' })
  });
  const delta = buildStrategicDelta(from, to);
  assert.deepStrictEqual(delta.research.resolved, ['Project_FleetCombatants']);
  assert.deepStrictEqual(delta.research.completed, [], 'the ledger did not grow, so nothing finished');
});

test('an unrecorded completed set reports unknown, not an empty list', () => {
  // Rows published before the ledger existed can only say THAT the set moved.
  const from = doc({ research: { monthly: 1, projects: [], completedProjectHash: 'fnv:aaaa:2' } });
  const to = doc({ research: { monthly: 1, projects: [], completedProjectHash: 'fnv:cccc:4' } });
  const delta = buildStrategicDelta(from, to);
  assert.strictEqual(delta.research.completed, null, 'unknown is not an empty list');
  assert.strictEqual(delta.research.completedSource, 'unavailable');
  assert.strictEqual(delta.research.completedSetChanged, true);
  assert.ok(delta.events.some(e => /do not record which/.test(e)));
});

test('identical completed-set hashes prove nothing was completed', () => {
  const from = doc({ research: { monthly: 1, projects: [], completedProjectHash: 'fnv:aaaa:2' } });
  const delta = buildStrategicDelta(from, from);
  assert.deepStrictEqual(delta.research.completed, []);
  assert.strictEqual(delta.research.completedSource, 'hash-unchanged');
});
