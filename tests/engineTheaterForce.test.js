// tests/engineTheaterForce.test.js
//
// `world.military.theaterForce` -- per-body force ratings on the military
// read-model. Phase 1 of docs/theater-defence-engagement-spec.md.
//
// WHY THIS EXISTS
// ---------------
// `server/engine/theaterDefence.js` can answer "can production here change the
// board at all?" -- it races the FASTEST hull against an arrival -- and it
// cannot answer "what should I build", because that needs force strength.
// `world` is frozen and data-only and the engine never sees the raw snapshot,
// so a rating can only be composed in `server/engine/military.js`, where the
// snapshot still is. This file owns that composition's shape and its honesty
// rules. Nothing renders it yet, by design.
//
// THE TRAP, TESTED DELIBERATELY
// -----------------------------
// `buildFleetEngagement` emits `items` CAPPED at `limit` (default
// `DEFAULT_ENGAGEMENT_ROWS` = 12) with the remainder counted in
// `fleetsOmittedCount`. The committed omniscient fixture carries 57 alien
// fleets, 11 of them at one of the twelve tracked bodies. Bucketed off the
// DEFAULT slice, only 5 of those 11 fleets survive -- 35 ships of 79 -- and
// Luna, Ganymede and Titan read as EMPTY while holding 44 alien hulls between
// them. The test `the per-body ratings are not bucketed off the capped slice`
// pins exactly that difference, so a future edit that drops the explicit limit
// goes red instead of quietly halving the enemy.
//
// WHERE THE EXPECTED VALUES COME FROM
// -----------------------------------
// The ship counts and the own-side per-hull rating are read from
// `shared/fleetEngagement.mjs`'s own public return on the committed fixtures,
// before this surface existed; the products asserted below (36 hulls x the
// observer's best design combat value at Mercury) are computed in the test from
// those two, not captured from the code under test. The helper tests run on
// hand-built engagement objects whose numbers are chosen in the test.
//
// THE FIXTURE / LIVE SPLIT
// ------------------------
// Everything here reads the committed fixtures, so it is deterministic and
// passes identically with the game running. The live-save assertions -- that
// the current campaign still produces a rated body at all, in both modes --
// live in `tests/live/militaryWorld.live.test.js` and run via
// `npm run test:live`.

const { test } = require('node:test');
const assert = require('node:assert');

const { buildMilitaryWorld, buildTheaterForce } = require('../server/engine/military');
const { loadFixtureFilteredSnapshot } = require('./fixtures/frozenSnapshots');
const {
  buildFleetEngagement,
  COMPOSITION_BASIS,
  DEFAULT_ENGAGEMENT_ROWS
} = require('../shared/fleetEngagement.mjs');
const { normalizeBody } = require('../shared/intel/common.mjs');

const OBSERVER = 4712;

const fixtureWorld = (mode) => buildMilitaryWorld(loadFixtureFilteredSnapshot({ mode }), OBSERVER);
const rowFor = (world, body) => world.theaterForce.find(row => row.body === body);

// -----------------------------------------------------------------------------
// Hand-built engagement objects.
//
// `buildTheaterForce` is a pure function of the fleet-engagement resource's
// PUBLIC return value, which is what makes the refusal paths testable without
// mangling a fixture: a snapshot cannot easily be coaxed into "an observer
// fleet whose ship complement is absent", but an engagement object can say so
// directly. The numbers here are the test's own, not the fixture's.
// -----------------------------------------------------------------------------

const TWO_BODIES = ['Earth', 'Mars'];

function fakeEngagement(overrides = {}) {
  return {
    available: true,
    reason: null,
    mode: 'omniscient',
    isEstimate: true,
    compositionModel: { basis: COMPOSITION_BASIS.omniscient },
    ownForce: {
      rating: 100,
      ratingSource: 'a hand-built per-hull rating for this test',
      fleets: [{ fleetId: 1, fleetName: 'Own-1', orbitBody: 'Mars', shipsCount: 4 }]
    },
    fleetsTotalCount: 1,
    fleetsOmittedCount: 0,
    items: [{
      fleetId: 9,
      fleetName: 'Hostile-9',
      orbitBody: 'Mars',
      shipsCount: 3,
      composition: {
        opponentRating: 900,
        ratedShips: 3,
        unratedShips: 0,
        basis: COMPOSITION_BASIS.omniscient
      }
    }],
    ...overrides
  };
}

// -- Shape, and the two modes -------------------------------------------------

test('theaterForce is row-for-row aligned with the theater board in both modes', () => {
  for (const mode of ['player', 'omniscient']) {
    const world = fixtureWorld(mode);
    assert.ok(Array.isArray(world.theaterForce), mode);
    assert.deepEqual(
      world.theaterForce.map(row => row.body),
      world.theaters.map(theater => theater.body),
      `${mode}: theaterForce must carry the board's own bodies, in the board's order`
    );
    assert.equal(world.theaterForce.length, 12, mode);

    for (const row of world.theaterForce) {
      assert.equal(row.isEstimate, true, `${mode}/${row.body}: the whole surface is an estimate`);
      assert.equal(typeof row.available, 'boolean', `${mode}/${row.body}`);
      assert.ok('unavailableReason' in row, `${mode}/${row.body}`);
      for (const side of ['own', 'opponent']) {
        assert.ok('rating' in row[side], `${mode}/${row.body}/${side}`);
        assert.equal(typeof row[side].ratedShips, 'number', `${mode}/${row.body}/${side}`);
        assert.equal(typeof row[side].unratedShips, 'number', `${mode}/${row.body}/${side}`);
        assert.ok('source' in row[side], `${mode}/${row.body}/${side}`);
      }
      assert.equal(typeof row.opponent.basis, 'string', `${mode}/${row.body}`);
    }
  }
});

test('calibrated is true only in omniscient, where the alien ratings are read', () => {
  const omniscient = fixtureWorld('omniscient');
  const player = fixtureWorld('player');

  assert.equal(omniscient.theaterForce.every(row => row.calibrated === true), true,
    'omniscient rates aliens from the aliens\' OWN designs, so every row is calibrated');
  assert.equal(player.theaterForce.every(row => row.calibrated === false), true,
    'player mode scales alien ratings off the observer\'s best hull by invented constants, so no row is');
});

test('the opponent basis is carried VERBATIM, never paraphrased', () => {
  // Strict identity against the exported constant: a paraphrase, a truncation
  // or a re-wording all fail here. The player string is the one that carries
  // "UNCALIBRATED ASSUMPTION" and names the x1.5 constant no game source
  // states, so editing it would edit the provenance of the number beside it.
  for (const [mode, expected] of [['omniscient', COMPOSITION_BASIS.omniscient], ['player', COMPOSITION_BASIS.player]]) {
    for (const row of fixtureWorld(mode).theaterForce) {
      assert.strictEqual(row.opponent.basis, expected, `${mode}/${row.body}`);
    }
  }
  assert.ok(COMPOSITION_BASIS.player.includes('UNCALIBRATED ASSUMPTION'),
    'the player basis must still be the one that names itself uncalibrated');
});

test('player mode is a different code path, not the omniscient number relabelled', () => {
  const omniscient = fixtureWorld('omniscient');
  const player = fixtureWorld('player');

  // Same fleets, same ships, different composition rule -- so the ratings must
  // differ. Equal numbers would mean one mode had silently taken the other's
  // path, which is the exact defect the mode split exists to prevent.
  const earthOmniscient = rowFor(omniscient, 'Earth').opponent.rating;
  const earthPlayer = rowFor(player, 'Earth').opponent.rating;
  assert.ok(typeof earthOmniscient === 'number' && earthOmniscient > 0);
  assert.ok(typeof earthPlayer === 'number' && earthPlayer > 0);
  assert.notEqual(earthPlayer, earthOmniscient);

  // The own side is composed from the observer's own designs, which player mode
  // does not redact, so that half is expected to agree across modes.
  assert.equal(rowFor(player, 'Mercury').own.rating, rowFor(omniscient, 'Mercury').own.rating);
});

// -- The readings, against the committed fixture -------------------------------

test('the own rating is the observer per-hull rating times the hulls present', () => {
  for (const mode of ['player', 'omniscient']) {
    const snapshot = loadFixtureFilteredSnapshot({ mode });
    // Read from the resource's own public return, independently of the surface
    // under test.
    const engagement = buildFleetEngagement(snapshot, { observerId: OBSERVER, mode, limit: Number.MAX_SAFE_INTEGER });
    const mercuryHulls = engagement.ownForce.fleets
      .filter(fleet => normalizeBody(fleet.orbitBody) === 'mercury')
      .reduce((sum, fleet) => sum + fleet.shipsCount, 0);
    assert.equal(mercuryHulls, 36, `${mode}: the fixture parks 36 observer hulls at Mercury`);

    const row = rowFor(fixtureWorld(mode), 'Mercury');
    assert.equal(row.own.ratedShips, 36, mode);
    assert.equal(row.own.unratedShips, 0, mode);
    assert.equal(row.own.rating, Math.round(engagement.ownForce.rating * 36 * 10) / 10, mode);
    assert.ok(row.own.source.includes('OPTIMISTIC'),
      `${mode}: the source must name the optimism -- the observer fields a mix, not 36 of its best`);
  }
});

test('a body with no force on a side reports null with a reason, never a confident zero', () => {
  const world = fixtureWorld('omniscient');

  // Mercury: 36 observer hulls, no alien fleet observed.
  const mercury = rowFor(world, 'Mercury');
  assert.equal(mercury.available, true);
  assert.strictEqual(mercury.opponent.rating, null);
  assert.notStrictEqual(mercury.opponent.rating, 0);
  assert.equal(mercury.opponent.ratedShips, 0);
  assert.equal(mercury.opponent.unratedShips, 0);
  assert.ok(mercury.opponent.source.includes('not a statement that none exists'),
    'an unobserved force is not an observed absence, and the source must say so');

  // Earth: 35 alien hulls, no observer fleet present.
  const earth = rowFor(world, 'Earth');
  assert.equal(earth.available, true);
  assert.strictEqual(earth.own.rating, null);
  assert.notStrictEqual(earth.own.rating, 0);
  assert.equal(earth.own.ratedShips, 0);
  assert.ok(earth.opponent.rating > 0);
  assert.equal(earth.opponent.ratedShips, 35);

  // Mars: nothing on either side. Two nulls, and still an available reading.
  const mars = rowFor(world, 'Mars');
  assert.equal(mars.available, true);
  assert.strictEqual(mars.own.rating, null);
  assert.strictEqual(mars.opponent.rating, null);
  assert.equal(mars.unavailableReason, null);
});

test('every rating is backed by rated ships, and every null rating by none', () => {
  // The `ownRating = 5000` default `runMonteCarloSimulation` falls back to must
  // not reappear here under any name: a rating exists only where ships were
  // folded into it.
  for (const mode of ['player', 'omniscient']) {
    for (const row of fixtureWorld(mode).theaterForce) {
      for (const side of ['own', 'opponent']) {
        const { rating, ratedShips } = row[side];
        if (rating === null) {
          assert.equal(ratedShips, 0, `${mode}/${row.body}/${side}: a null rating must rate no ships`);
        } else {
          assert.ok(rating > 0, `${mode}/${row.body}/${side}: a rating must be positive`);
          assert.ok(ratedShips > 0, `${mode}/${row.body}/${side}: a rating must be backed by ships`);
        }
      }
    }
  }
});

// -- THE TRAP: the emitted rows are capped, and this surface must not be --------

test('the per-body ratings are not bucketed off the capped slice', () => {
  const mode = 'omniscient';
  const snapshot = loadFixtureFilteredSnapshot({ mode });
  const trackedBodies = new Set(fixtureWorld(mode).theaters.map(t => normalizeBody(t.body)));
  const trackedShipsIn = (engagement) => engagement.items
    .filter(row => trackedBodies.has(normalizeBody(String(row.orbitBody || '').replace(/\s+orbit$/i, ''))))
    .reduce((sum, row) => sum + (row.shipsCount || 0), 0);

  const capped = buildFleetEngagement(snapshot, { observerId: OBSERVER, mode });
  const whole = buildFleetEngagement(snapshot, { observerId: OBSERVER, mode, limit: Number.MAX_SAFE_INTEGER });

  // The cap is real on this fixture, and it bites hard at the tracked bodies.
  assert.equal(capped.items.length, DEFAULT_ENGAGEMENT_ROWS);
  assert.ok(capped.fleetsOmittedCount > 0, 'the default limit must actually omit fleets on this fixture');
  assert.equal(whole.fleetsOmittedCount, 0);
  assert.equal(trackedShipsIn(capped), 35);
  assert.equal(trackedShipsIn(whole), 79);

  // The surface must report the whole 79, not the capped 35.
  const rows = fixtureWorld(mode).theaterForce;
  const attributed = rows.reduce((sum, row) => sum + row.opponent.ratedShips + row.opponent.unratedShips, 0);
  assert.equal(attributed, 79,
    'theaterForce must attribute every hostile hull at a tracked body, not the slice the default limit emits');

  // And named, so a regression is legible rather than arithmetic: bucketed off
  // the capped slice, these three bodies hold 44 alien hulls and read empty.
  for (const body of ['Luna', 'Ganymede', 'Titan']) {
    const row = rows.find(r => r.body === body);
    assert.ok(row.opponent.rating > 0, `${body} must carry a rating`);
    assert.ok(row.opponent.ratedShips > 0, `${body} must carry rated ships`);
  }
});

test('an omitted fleet count refuses the whole board rather than rating part of it', () => {
  const omitted = buildTheaterForce(fakeEngagement({ fleetsOmittedCount: 3, fleetsTotalCount: 4 }), TWO_BODIES);
  assert.equal(omitted.length, 2);
  for (const row of omitted) {
    assert.equal(row.available, false, row.body);
    assert.ok(row.unavailableReason.includes('3 omitted fleet(s)'), row.unavailableReason);
    assert.strictEqual(row.own.rating, null, row.body);
    assert.strictEqual(row.opponent.rating, null, row.body);
  }

  // Unknown is not the same as safe: an ABSENT omitted-count cannot be read as
  // a zero one. `Number(undefined)` is NaN and `?? 0` would have made it a
  // confident "nothing was omitted".
  const unstated = fakeEngagement();
  delete unstated.fleetsOmittedCount;
  for (const row of buildTheaterForce(unstated, TWO_BODIES)) {
    assert.equal(row.available, false, row.body);
    assert.ok(row.unavailableReason.includes('no omitted-fleet count'), row.unavailableReason);
  }
});

// -- Unavailable paths ---------------------------------------------------------

test('an unavailable engagement resource makes every body unavailable, carrying its reason', () => {
  const rows = buildTheaterForce(
    { available: false, mode: 'player', reason: 'no alien fleet is visible in this intelligence picture' },
    TWO_BODIES
  );
  for (const row of rows) {
    assert.equal(row.available, false, row.body);
    assert.ok(row.unavailableReason.includes('no alien fleet is visible'), row.unavailableReason);
    assert.strictEqual(row.own.rating, null, row.body);
    assert.strictEqual(row.opponent.rating, null, row.body);
    // The basis still travels: which model WOULD have been used is part of
    // reading the refusal.
    assert.strictEqual(row.opponent.basis, COMPOSITION_BASIS.player, row.body);
    assert.equal(row.calibrated, false, row.body);
  }

  // No resource at all is a refusal too, not an empty board.
  const none = buildTheaterForce(null, TWO_BODIES);
  assert.equal(none.length, 2);
  assert.ok(none.every(row => row.available === false && /produced no reading/.test(row.unavailableReason)));
});

test('no own-side rating refuses; no default rating is substituted', () => {
  const engagement = fakeEngagement();
  engagement.ownForce = { ...engagement.ownForce, rating: null };
  for (const row of buildTheaterForce(engagement, TWO_BODIES)) {
    assert.equal(row.available, false, row.body);
    assert.ok(row.unavailableReason.includes('No default rating is substituted'), row.unavailableReason);
    assert.strictEqual(row.own.rating, null, row.body);
    assert.notStrictEqual(row.own.rating, 0, row.body);
  }
});

test('an observer fleet with no ship complement makes that body unavailable, with the reason named', () => {
  const engagement = fakeEngagement();
  engagement.ownForce = {
    ...engagement.ownForce,
    fleets: [
      { fleetId: 1, fleetName: 'Own-1', orbitBody: 'Mars', shipsCount: 4 },
      { fleetId: 2, fleetName: 'Own-2', orbitBody: 'Mars', shipsCount: null }
    ]
  };
  const rows = buildTheaterForce(engagement, TWO_BODIES);
  const mars = rows.find(row => row.body === 'Mars');

  assert.equal(mars.available, false);
  assert.ok(mars.unavailableReason.includes('1 observer fleet(s) at Mars carry no ship complement'),
    mars.unavailableReason);
  assert.ok(mars.unavailableReason.includes('floor of unknown depth'), mars.unavailableReason);
  // The four countable hulls are reported as UNRATED, never credited to a
  // rating that was not formed.
  assert.strictEqual(mars.own.rating, null);
  assert.equal(mars.own.ratedShips, 0);
  assert.equal(mars.own.unratedShips, 4);

  // Earth is untouched: one body's missing complement is not the board's.
  assert.equal(rows.find(row => row.body === 'Earth').available, true);
});

test('a hostile fleet present but unrateable is a named refusal, not a zero', () => {
  const engagement = fakeEngagement({
    items: [{
      fleetId: 9,
      fleetName: 'Hostile-9',
      orbitBody: 'Mars',
      shipsCount: 5,
      composition: {
        opponentRating: null,
        ratedShips: 0,
        unratedShips: 5,
        basis: COMPOSITION_BASIS.omniscient
      }
    }]
  });
  const mars = buildTheaterForce(engagement, TWO_BODIES).find(row => row.body === 'Mars');

  assert.equal(mars.available, false);
  assert.ok(mars.unavailableReason.includes('no ship in the 1 hostile fleet(s) at Mars could be rated'),
    mars.unavailableReason);
  assert.strictEqual(mars.opponent.rating, null);
  assert.notStrictEqual(mars.opponent.rating, 0);
  assert.equal(mars.opponent.ratedShips, 0);
  assert.equal(mars.opponent.unratedShips, 5, 'the five hulls are still reported as present and unrated');
  // The own side of the same body is still composed.
  assert.equal(mars.own.rating, 400);
});

test('a hostile fleet with no countable complement makes that body unavailable', () => {
  const engagement = fakeEngagement({
    items: [{
      fleetId: 9,
      fleetName: 'Hostile-9',
      orbitBody: 'Mars',
      shipsCount: null,
      composition: { opponentRating: null, ratedShips: null, unratedShips: null, basis: COMPOSITION_BASIS.omniscient }
    }]
  });
  const mars = buildTheaterForce(engagement, TWO_BODIES).find(row => row.body === 'Mars');
  assert.equal(mars.available, false);
  assert.ok(mars.unavailableReason.includes('1 hostile fleet(s) at Mars carry no countable ship complement'),
    mars.unavailableReason);
  assert.strictEqual(mars.opponent.rating, null);
});

test('a snapshot with no visible alien fleet reports twelve refusals, not twelve empty theaters', () => {
  // A hand-built snapshot the theater board can build but the engagement
  // resource cannot rate: the observer holds a yard, and no alien fleet exists.
  const snapshot = {
    observerFactionId: OBSERVER,
    metadata: { gameTimeString: '5/1/2033 12:00:00 AM' },
    mode: 'omniscient',
    factions: [
      { ID: OBSERVER, displayName: 'the Initiative', shipConstructionTimeEffects: [] },
      { ID: 4717, displayName: 'the Aliens' }
    ],
    shipHullStats: {},
    shipyardStations: []
  };
  const world = buildMilitaryWorld(snapshot, OBSERVER);
  assert.equal(world.available, true);
  assert.equal(world.theaterForce.length, 12);
  for (const row of world.theaterForce) {
    assert.equal(row.available, false, row.body);
    assert.ok(row.unavailableReason.includes('force ratings unavailable'), row.unavailableReason);
    assert.strictEqual(row.own.rating, null, row.body);
    assert.strictEqual(row.opponent.rating, null, row.body);
  }
});

test('a board that cannot be built carries no force rows at all', () => {
  const throwing = new Proxy({}, { get() { throw new Error('boom'); } });
  const world = buildMilitaryWorld(throwing, OBSERVER);
  assert.equal(world.available, false);
  assert.deepEqual(world.theaterForce, []);
});

// -- Joins ---------------------------------------------------------------------

test('"<Body> Orbit" and "<Body>" are one place', () => {
  // `shared/fleetEngagement.mjs` unifies the two spellings with the same rule,
  // and the live save parks one observer hull and one alien hull at "Earth
  // Orbit". Splitting them would under-report a hostile hull at Earth, which is
  // the dangerous direction for a threat display.
  const engagement = fakeEngagement({
    ownForce: {
      rating: 100,
      ratingSource: 'a hand-built per-hull rating for this test',
      fleets: [{ fleetId: 1, fleetName: 'Own-1', orbitBody: 'Earth Orbit', shipsCount: 2 }]
    },
    items: [{
      fleetId: 9,
      fleetName: 'Hostile-9',
      orbitBody: 'Earth orbit',
      shipsCount: 1,
      composition: { opponentRating: 700, ratedShips: 1, unratedShips: 0, basis: COMPOSITION_BASIS.omniscient }
    }]
  });
  const earth = buildTheaterForce(engagement, TWO_BODIES).find(row => row.body === 'Earth');
  assert.equal(earth.available, true);
  assert.equal(earth.own.rating, 200);
  assert.equal(earth.own.ratedShips, 2);
  assert.equal(earth.opponent.rating, 700);
  assert.equal(earth.opponent.ratedShips, 1);
});

test('ships a fleet declares but carries no detail for are unrated, not ignored', () => {
  // `shipsCount` upstream is the larger of the declared count and the carried
  // ship list, so a fleet can declare 10 hulls and offer 3 to the rating. The
  // seven that were never offered are unrated ships, and a rating over 3 of 10
  // presented as a rating for 10 is the thing `unratedShips` exists to prevent.
  const engagement = fakeEngagement({
    items: [{
      fleetId: 9,
      fleetName: 'Hostile-9',
      orbitBody: 'Mars',
      shipsCount: 10,
      composition: { opponentRating: 900, ratedShips: 3, unratedShips: 0, basis: COMPOSITION_BASIS.omniscient }
    }]
  });
  const mars = buildTheaterForce(engagement, TWO_BODIES).find(row => row.body === 'Mars');
  assert.equal(mars.available, true, 'a partial rating is flagged by its counts, not withheld');
  assert.equal(mars.opponent.rating, 900);
  assert.equal(mars.opponent.ratedShips, 3);
  assert.equal(mars.opponent.unratedShips, 7);
});

// -----------------------------------------------------------------------------
// DELIBERATE-BREAK CHECK, run 2026-08-27.
//
// In `server/engine/military.js`, the explicit row request was replaced by the
// resource's default, which is exactly the trap this surface exists to avoid:
//
//     -  return buildFleetEngagement(snapshot, { observerId, mode, limit: ENGAGEMENT_ROW_REQUEST });
//     +  return buildFleetEngagement(snapshot, { observerId, mode });
//
// Result: four tests went red -- `the per-body ratings are not bucketed off the
// capped slice`, `the own rating is the observer per-hull rating times the hulls
// present`, `a body with no force on a side reports null with a reason` and
// `player mode is a different code path`. The failure is worth reading exactly:
// the resource reported 45 of 57 fleets omitted, the `fleetsOmittedCount !== 0`
// guard fired, and all twelve bodies refused. So the trap does NOT produce a
// half-strength board -- it produces a refusal, which is the intended
// behaviour, and the tests that assert real ratings are what detect it. The
// edit was reverted and the suite is green again.
//
// A second break, on the trap's own guard:
//
//     -  const omitted = toFiniteNumber(engagement.fleetsOmittedCount);
//     -  if (omitted !== 0) {
//     +  const omitted = toFiniteNumber(engagement.fleetsOmittedCount) ?? 0;
//     +  if (omitted !== 0) {
//
// Result: `an omitted fleet count refuses the whole board rather than rating
// part of it` went red on its ABSENT-count half -- a missing omitted-count read
// as a confident "nothing was omitted" and the board rated on regardless. The
// edit was reverted and the suite is green again.
// -----------------------------------------------------------------------------
