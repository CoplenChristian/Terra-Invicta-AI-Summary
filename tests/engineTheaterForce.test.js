// tests/engineTheaterForce.test.js
//
// `world.military.theaterForce` -- per-body force ratings on the military
// read-model, and the per-fleet hull requirements carried beside them. Phases 1
// and 2 of docs/theater-defence-engagement-spec.md. Read that document's
// CORRECTION block before this file: its original text had the player-mode
// error direction backwards, and the fix is what the provenance flags here are
// for.
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
  DEFAULT_ENGAGEMENT_ROWS,
  ENGAGEMENT_VERDICTS,
  MAX_ENGAGEMENT_HULLS
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

/**
 * A requirement object shaped exactly as `resolveRequirement` builds one.
 *
 * Hand-built on purpose. The committed fixtures resolve `band` for all 57
 * fleets in both modes, so the beyond-modelled-range, withheld-unreachable and
 * unknown branches cannot be reached from them at all -- and those are the
 * branches a consumer flattens. The `beyondModelledRange` shape below mirrors
 * `shared/fleetEngagement.mjs` field for field, including the floor at
 * `MAX_ENGAGEMENT_HULLS + 1` and the null p20/p80.
 */
const bandRequirement = (overrides = {}) => ({
  verdict: ENGAGEMENT_VERDICTS.band,
  reason: null,
  p20: 6,
  p80: 8,
  bandLabel: '6–8 hulls',
  hullsAtLeast: null,
  maxHullsSwept: 12,
  guaranteedWinAt: 11,
  isLowerBound: false,
  isEstimate: true,
  uncertainty: { isMeasurement: false, seedsSimulated: 120 },
  ...overrides
});

const beyondRangeRequirement = () => ({
  verdict: ENGAGEMENT_VERDICTS.beyondModelledRange,
  reason: `this fleet rates above what ${MAX_ENGAGEMENT_HULLS} of the observer's best hull can be modelled `
    + 'against, so the requirement is reported as a floor rather than swept. This is NOT "not winnable"',
  p20: null,
  p80: null,
  bandLabel: `more than ${MAX_ENGAGEMENT_HULLS} hulls`,
  hullsAtLeast: MAX_ENGAGEMENT_HULLS + 1,
  maxHullsSwept: null,
  guaranteedWinAt: 4096,
  isLowerBound: true,
  isEstimate: true,
  uncertainty: null
});

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
      },
      requirement: bandRequirement()
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

// =============================================================================
// PHASE 2 -- the per-fleet hull requirement, CARRIED and never recomputed.
//
// `buildFleetEngagement` already resolves a requirement for every fleet it
// emits, and `resolveRequirement`'s own comment records that it "never returns
// an empty band; every branch names a verdict". So the job on this surface is
// transport, not arithmetic: not one of `findRequiredHullsForTier`,
// `guaranteedWinHullCount`, `hullBandLabel` or `describeBandUncertainty` is
// called from `server/engine/military.js`, and the tests below pin that by
// REFERENCE IDENTITY rather than by comparing values -- a copy that happens to
// agree today is still a second place the rule can drift.
//
// The two things a consumer of this has historically got wrong, both pinned:
//   * flattening `beyond-modelled-range` into "cannot be won" (register #13);
//   * dropping p20/p80 down to a single number.
// =============================================================================

test('every hostile fleet present carries a requirement, with the full band intact', () => {
  const REQUIREMENT_KEYS = [
    'bandLabel', 'guaranteedWinAt', 'hullsAtLeast', 'isEstimate', 'isLowerBound',
    'maxHullsSwept', 'p20', 'p80', 'reason', 'uncertainty', 'verdict'
  ];

  for (const mode of ['player', 'omniscient']) {
    const rows = fixtureWorld(mode).theaterForce;
    let listed = 0;

    for (const row of rows) {
      assert.ok(Array.isArray(row.opponentFleets), `${mode}/${row.body}: an available row lists its fleets`);
      assert.equal(row.opponentFleetsCount, row.opponentFleets.length, `${mode}/${row.body}`);
      listed += row.opponentFleets.length;

      for (const fleet of row.opponentFleets) {
        assert.ok(fleet.requirement, `${mode}/${row.body}/${fleet.fleetId}: a requirement must be carried`);
        assert.strictEqual(fleet.requirementUnavailableReason, null, `${mode}/${row.body}`);
        assert.deepEqual(Object.keys(fleet.requirement).sort(), REQUIREMENT_KEYS,
          `${mode}/${row.body}/${fleet.fleetId}: the requirement travels whole, not a chosen subset`);
        assert.ok(fleet.requirement.verdict, `${mode}/${row.body}/${fleet.fleetId}: every branch names one`);

        // Never drop p20/p80. On a `band` verdict both are real counts; a
        // consumer that can only take one number is the thing that is wrong.
        if (fleet.requirement.verdict === ENGAGEMENT_VERDICTS.band) {
          assert.ok(Number.isFinite(fleet.requirement.p20), `${mode}/${row.body}/${fleet.fleetId}: p20`);
          assert.ok(Number.isFinite(fleet.requirement.p80), `${mode}/${row.body}/${fleet.fleetId}: p80`);
          assert.ok(fleet.requirement.p80 >= fleet.requirement.p20, `${mode}/${row.body}/${fleet.fleetId}`);
          assert.ok(fleet.requirement.bandLabel, `${mode}/${row.body}/${fleet.fleetId}: bandLabel`);
        }
      }
    }

    // The committed fixtures park 11 alien fleets at the twelve tracked bodies.
    // Bucketed off the DEFAULT emitted slice this would be 5 -- the same trap
    // the ratings guard against, now guarded for the fleet list too.
    assert.equal(listed, 11, `${mode}: every hostile fleet at a tracked body must get a row`);
  }
});

test('the requirement is the resource\'s OWN object, not a second copy of the rule', () => {
  // Reference identity, deliberately. `resolveRequirement` is private and this
  // repo has already paid for a forked rule twice; a value-equal copy is still
  // a second place to drift. Comparing objects by `===` makes any local
  // reconstruction -- even a faithful one -- fail here.
  for (const mode of ['player', 'omniscient']) {
    const snapshot = loadFixtureFilteredSnapshot({ mode });
    const engagement = buildFleetEngagement(snapshot, {
      observerId: OBSERVER, mode, limit: Number.MAX_SAFE_INTEGER
    });
    const bodies = fixtureWorld(mode).theaters.map(theater => theater.body);
    const rows = buildTheaterForce(engagement, bodies);

    const carried = new Map();
    for (const row of rows) {
      for (const fleet of row.opponentFleets ?? []) carried.set(String(fleet.fleetId), fleet.requirement);
    }
    assert.equal(carried.size, 11, mode);

    let checked = 0;
    for (const item of engagement.items) {
      const seen = carried.get(String(item.fleetId));
      if (!seen) continue;
      assert.strictEqual(seen, item.requirement,
        `${mode}/${item.fleetId}: the requirement must be the resource's own object, carried by reference`);
      checked += 1;
    }
    assert.equal(checked, 11, mode);
  }
});

test('beyond-modelled-range is carried as a FLOOR, never as "cannot be won"', () => {
  // The single distinction this task exists to preserve. The exchange model is
  // monotone in hull count, so some count always wins: a requirement past the
  // sweep ceiling means "above the range this panel models", and register #13
  // exists because a consumer rendered that as the whole uncertainty.
  assert.notStrictEqual(ENGAGEMENT_VERDICTS.beyondModelledRange, ENGAGEMENT_VERDICTS.notWinnable,
    'the two verdicts are deliberately distinct in the source and must stay so');

  const engagement = fakeEngagement({
    items: [{
      fleetId: 9,
      fleetName: 'Hostile-9',
      orbitBody: 'Mars',
      shipsCount: 34,
      composition: {
        opponentRating: 9e9, ratedShips: 34, unratedShips: 0, basis: COMPOSITION_BASIS.omniscient
      },
      requirement: beyondRangeRequirement()
    }]
  });
  const mars = buildTheaterForce(engagement, TWO_BODIES).find(row => row.body === 'Mars');

  assert.equal(mars.available, true, 'a fleet past the sweep ceiling is a reading, not a broken body');
  assert.equal(mars.opponentFleetsCount, 1);

  const carried = mars.opponentFleets[0].requirement;
  assert.equal(carried.verdict, ENGAGEMENT_VERDICTS.beyondModelledRange);
  assert.notEqual(carried.verdict, ENGAGEMENT_VERDICTS.notWinnable,
    'past the ceiling is NOT unwinnable, and must never be recorded as it');

  // The floor survives whole: the count, its label and the flag that says it is
  // a floor. Rendering `hullsAtLeast` as a point value would be the same defect
  // one step further on.
  assert.equal(carried.hullsAtLeast, MAX_ENGAGEMENT_HULLS + 1);
  assert.equal(carried.bandLabel, `more than ${MAX_ENGAGEMENT_HULLS} hulls`);
  assert.equal(carried.isLowerBound, true);
  assert.strictEqual(carried.p20, null, 'a floor has no band, and a null band is not a zero one');
  assert.strictEqual(carried.p80, null);
  // The proof that some count wins travels with it.
  assert.equal(carried.guaranteedWinAt, 4096);
  assert.ok(/NOT "not winnable"/.test(carried.reason), carried.reason);

  // And nothing on the surface restates the verdict as a boolean. A
  // `winnable: false` beside this row is exactly how the distinction gets lost.
  const serialized = JSON.stringify(mars);
  assert.equal(/"winnable"|"unwinnable"|"hopeless"|"cannotBeWon"/.test(serialized), false,
    'no boolean restatement of the verdict may appear anywhere on the row');
});

test('a withheld or unknown verdict yields no hull count, and no number is invented for it', () => {
  const withheld = {
    verdict: ENGAGEMENT_VERDICTS.withheldUnreachable,
    reason: 'no hull count is given: this fleet is beyond every observer fleet\'s delta-V',
    p20: null, p80: null, bandLabel: null, hullsAtLeast: null, maxHullsSwept: null,
    guaranteedWinAt: null, isLowerBound: false, isEstimate: true, uncertainty: null
  };
  const engagement = fakeEngagement({
    items: [{
      fleetId: 9, fleetName: 'Hostile-9', orbitBody: 'Mars', shipsCount: 3,
      composition: { opponentRating: 900, ratedShips: 3, unratedShips: 0, basis: COMPOSITION_BASIS.omniscient },
      requirement: withheld
    }]
  });
  const fleet = buildTheaterForce(engagement, TWO_BODIES).find(row => row.body === 'Mars').opponentFleets[0];

  assert.equal(fleet.requirement.verdict, ENGAGEMENT_VERDICTS.withheldUnreachable);
  for (const key of ['p20', 'p80', 'bandLabel', 'hullsAtLeast', 'guaranteedWinAt']) {
    assert.strictEqual(fleet.requirement[key], null, `${key} must stay null, never a substituted 0`);
    assert.notStrictEqual(fleet.requirement[key], 0, key);
  }
  assert.ok(fleet.requirement.reason.includes('no hull count is given'), fleet.requirement.reason);
});

test('a row the resource emits with no requirement is a named refusal, not a zero hull count', () => {
  // `resolveRequirement` names a verdict on every branch, so this can only mean
  // the resource's shape changed. Unknown is not the same as safe, and it is
  // not the same as "no hulls needed".
  const engagement = fakeEngagement();
  delete engagement.items[0].requirement;
  const fleet = buildTheaterForce(engagement, TWO_BODIES).find(row => row.body === 'Mars').opponentFleets[0];

  assert.strictEqual(fleet.requirement, null);
  assert.ok(fleet.requirementUnavailableReason.includes('shape change'), fleet.requirementUnavailableReason);
  assert.ok(fleet.requirementUnavailableReason.includes('no hull count is substituted'),
    fleet.requirementUnavailableReason);
  // The fleet itself is still listed -- it is present at the body either way.
  assert.equal(fleet.fleetId, 9);
  assert.equal(fleet.shipsCount, 3);
});

test('no body-level total is composed, and every row says so by name', () => {
  const ROW_KEYS = [
    'available', 'body', 'calibrated', 'composedRequirement', 'composedRequirementReason', 'isEstimate',
    'opponent', 'opponentFleets', 'opponentFleetsCount', 'opponentFleetsUnavailableReason', 'own',
    'unavailableReason'
  ];

  for (const mode of ['player', 'omniscient']) {
    for (const row of fixtureWorld(mode).theaterForce) {
      // Pinned as a whole set: a future `bodyRequirement`, `totalHullsNeeded`
      // or `requiredHulls` field fails here rather than shipping as a total
      // the exchange model never sanctioned.
      assert.deepEqual(Object.keys(row).sort(), ROW_KEYS, `${mode}/${row.body}`);
      assert.strictEqual(row.composedRequirement, null, `${mode}/${row.body}`);
      assert.ok(row.composedRequirementReason.includes('no body-level hull requirement is offered'),
        `${mode}/${row.body}`);
      assert.ok(row.composedRequirementReason.includes('neither the sum nor the maximum'),
        `${mode}/${row.body}: the reason must name what specifically must not be done`);
    }
  }

  // Earth carries five hostile fleets on the fixture, so a naive total is
  // temptingly available: 86 by sum of p80, 58 by max. Neither appears.
  const earth = rowFor(fixtureWorld('player'), 'Earth');
  assert.equal(earth.opponentFleetsCount, 5);
  const p80s = earth.opponentFleets.map(fleet => fleet.requirement.p80);
  assert.deepEqual(p80s, [58, 9, 8, 7, 4]);
  const forbidden = new Set([p80s.reduce((a, b) => a + b, 0), Math.max(...p80s)]);
  for (const [key, value] of Object.entries(earth)) {
    if (typeof value === 'number') {
      assert.equal(forbidden.has(value), false, `${key} must not hold a composed body-level hull count`);
    }
  }
});

test('every requirement row carries its own provenance, uncorrected', () => {
  for (const mode of ['player', 'omniscient']) {
    const calibrated = mode === 'omniscient';
    let seen = 0;
    for (const row of fixtureWorld(mode).theaterForce) {
      for (const fleet of row.opponentFleets) {
        seen += 1;
        assert.equal(fleet.calibrated, calibrated, `${mode}/${row.body}/${fleet.fleetId}`);
        // Verbatim, on the row that carries the hull number -- not one level up
        // where detaching the row loses it.
        assert.strictEqual(fleet.basis, COMPOSITION_BASIS[mode], `${mode}/${row.body}/${fleet.fleetId}`);
        if (calibrated) {
          assert.strictEqual(fleet.calibrationCaveat, null, `${mode}/${row.body}`);
        } else {
          assert.ok(fleet.calibrationCaveat.startsWith('UNCALIBRATED'), `${mode}/${row.body}`);
          // The measured direction is the ALARMING one. The spec had this
          // backwards once; the caveat must not quietly acquire the old wording.
          assert.ok(fleet.calibrationCaveat.includes('OVER-rating the enemy'), `${mode}/${row.body}`);
          assert.ok(/9\.01x/.test(fleet.calibrationCaveat) && /15\.65x/.test(fleet.calibrationCaveat),
            `${mode}/${row.body}: the caveat must carry the measured spread, not a single factor`);
          assert.ok(fleet.calibrationCaveat.includes('not consistent between bodies'), `${mode}/${row.body}`);
        }
      }
    }
    assert.equal(seen, 11, mode);
  }
});

test('the player requirement is a different reading, and no constant correction is applied to it', () => {
  // Same fleets, different composition rule. If a future edit "corrected" the
  // player rating by dividing out a factor, every per-fleet ratio would collapse
  // to the same number -- so the spread itself is what is pinned, not a value.
  const bandsFor = (mode) => {
    const map = new Map();
    for (const row of fixtureWorld(mode).theaterForce) {
      for (const fleet of row.opponentFleets) map.set(String(fleet.fleetId), fleet.requirement);
    }
    return map;
  };
  const player = bandsFor('player');
  const omniscient = bandsFor('omniscient');
  assert.equal(player.size, 11);

  const ratios = [];
  for (const [fleetId, band] of player) {
    const other = omniscient.get(fleetId);
    assert.ok(other, fleetId);
    assert.ok(Number.isFinite(band.p80) && Number.isFinite(other.p80), fleetId);
    ratios.push(band.p80 / other.p80);
  }

  const min = Math.min(...ratios);
  const max = Math.max(...ratios);
  assert.ok(min < 1, `the spread must still straddle 1 (min ${min})`);
  assert.ok(max >= 2, `the spread must still be wide (max ${max})`);
  assert.ok(max / min > 2,
    `a single correction factor would make every ratio equal; measured spread ${min}-${max}`);
});

test('a whole-board refusal lists NO fleets rather than an empty list of them', () => {
  // `[]` would say "no hostile fleet is at this body". The refusal never
  // determined that, so the honest value is null -- and the count is null with
  // it, so `.length` cannot be read as a confident zero.
  for (const engagement of [
    fakeEngagement({ fleetsOmittedCount: 3, fleetsTotalCount: 4 }),
    { available: false, mode: 'player', reason: 'no alien fleet is visible in this intelligence picture' },
    null
  ]) {
    for (const row of buildTheaterForce(engagement, TWO_BODIES)) {
      assert.equal(row.available, false, row.body);
      assert.strictEqual(row.opponentFleets, null, row.body);
      assert.strictEqual(row.opponentFleetsCount, null, row.body);
      assert.notStrictEqual(row.opponentFleetsCount, 0, row.body);
      assert.ok(row.opponentFleetsUnavailableReason.includes('was never determined'),
        row.opponentFleetsUnavailableReason);
      // The refusal of a composed total is still stated: which model would NOT
      // have been used is part of reading the refusal.
      assert.strictEqual(row.composedRequirement, null, row.body);
      assert.ok(row.composedRequirementReason, row.body);
    }
  }
});

test('a fleet whose complement cannot be counted still appears, with its requirement', () => {
  // The body refuses a rating -- correctly -- but the fleet is still THERE, and
  // the requirement the resource resolved for it is still the best reading of
  // what it would cost. Dropping the row would hide the fleet from the one
  // field that lists what is present.
  const engagement = fakeEngagement({
    items: [{
      fleetId: 9, fleetName: 'Hostile-9', orbitBody: 'Mars', shipsCount: null,
      composition: { opponentRating: null, ratedShips: null, unratedShips: null, basis: COMPOSITION_BASIS.omniscient },
      requirement: bandRequirement({ verdict: ENGAGEMENT_VERDICTS.unknown, reason: 'no rating', p20: null, p80: null, bandLabel: null })
    }]
  });
  const mars = buildTheaterForce(engagement, TWO_BODIES).find(row => row.body === 'Mars');

  assert.equal(mars.available, false, 'the rating is still refused');
  assert.equal(mars.opponentFleetsCount, 1, 'and the fleet is still listed');
  const fleet = mars.opponentFleets[0];
  assert.equal(fleet.fleetId, 9);
  assert.strictEqual(fleet.shipsCount, null, 'an uncountable complement is null, never 0');
  assert.strictEqual(fleet.ratedShips, null);
  assert.strictEqual(fleet.opponentRating, null);
  assert.equal(fleet.requirement.verdict, ENGAGEMENT_VERDICTS.unknown);
});

test('a body with no hostile fleet lists none, and the source still says why that is not an absence', () => {
  const mercury = rowFor(fixtureWorld('omniscient'), 'Mercury');
  assert.deepEqual(mercury.opponentFleets, []);
  assert.equal(mercury.opponentFleetsCount, 0);
  assert.strictEqual(mercury.opponentFleetsUnavailableReason, null);
  assert.ok(mercury.opponent.source.includes('not a statement that none exists'));
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

// -----------------------------------------------------------------------------
// DELIBERATE-BREAK CHECK, PHASE 2, run 2026-08-27. Three edits, three reds,
// each isolated to the one test that exists to catch it. All reverted; 29/29
// green after, and the fixture capture byte-identical to the pre-change one
// with the new fields stripped (MD5-verified, both modes).
//
// 1. FLATTENING THE VERDICT -- the defect register #13 exists for.
//    In `opponentFleetRow`, `server/engine/military.js`:
//
//      -    requirement,
//      +    requirement: requirement && requirement.isLowerBound
//      +      ? { ...requirement, verdict: 'not-winnable', hullsAtLeast: null, bandLabel: null }
//      +      : requirement,
//
//    Red: `beyond-modelled-range is carried as a FLOOR, never as "cannot be
//    won"` -- "'not-winnable' == 'beyond-modelled-range'". Note what this break
//    does NOT do: the fixtures resolve `band` for all 57 fleets in both modes,
//    so the fixture-backed tests stayed green throughout. Only the hand-built
//    beyond-range row caught it, which is why that row is hand-built.
//
// 2. RECOMPUTING INSTEAD OF CARRYING.
//
//      -    requirement,
//      +    requirement: requirement === null ? null : { ...requirement },
//
//    Red: `the requirement is the resource's OWN object, not a second copy of
//    the rule`. Worth reading closely -- a spread copy is VALUE-EQUAL, so every
//    field assertion in the file still passed. Only the `strictEqual` identity
//    check saw it. That is the point: a faithful copy today is still a second
//    place the rule can drift tomorrow.
//
// 3. LOSING THE PROVENANCE.
//
//      -    calibrationCaveat: calibrated ? null : UNCALIBRATED_REQUIREMENT_CAVEAT
//      +    calibrationCaveat: null
//
//    Red: `every requirement row carries its own provenance, uncorrected`. The
//    player-mode hull counts kept rendering exactly as before -- they simply
//    stopped saying they were built from an opponent rating measured at 9-15x
//    the omniscient one.
// -----------------------------------------------------------------------------
