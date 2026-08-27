// tests/theaters.test.js
//
// The theater board's destination resolution, and the bucket for hostile
// movement that reaches none of the twelve tracked bodies.
//
// WHY THESE EXIST
// ---------------
// `shared/intel/theaters.mjs` decided "is a hostile fleet inbound to this
// body?" with `normalizeBody(transfer.destination) === body` -- a literal name
// test. Measured against the live save on 2026-08-26, all 18 fleets in transit
// carried a destination that is NOT a body name (7 fleet rendezvous, 6
// "<Body> orbit" strings, 5 hab names), so every theater reported
// `incoming.hostileShips: 0`. Honest zeros, and the only zeros that filter
// could ever produce.
//
// THE DELIBERATE BREAK (run 2026-08-26). `resolveTransferDestination` in
// `shared/intel/destinations.mjs` was reverted to the shallow behaviour --
//
//     return resolvedTo(transfer?.destination, DESTINATION_RESOLUTION.body, []);
//
// -- and the suite was re-run. 15 of the 21 tests below went red. The four
// resolution cases failed by seeing nothing inbound at all:
//
//   * a hostile fleet bound for a hab ...       expected 1, actual 0 (Ceres)
//   * a "<Body> orbit" destination ...          expected 1, actual 0 (Titan)
//   * a rendezvous with another fleet ...       expected 1, actual 0 (Vesta)
//   * a rendezvous with a fleet in transit ...  expected 2, actual 0 (Mars)
//
// The three unresolvable cases failed the other way, by fabricating a body:
//   * an unobservable hab            -> `resolved: true`, body "Iron Fortress Station"
//   * an ambiguous shared hab name   -> resolved to whichever was indexed first
//   * a looping rendezvous chain     -> `resolved: true` instead of false
//
// The off-board bucket listed the raw strings it had failed to resolve
// (`['Triton orbit', 'Iron Fortress Station']` for `['Triton', '16 Psyche']`),
// and the absent-stays-null cases collapsed to the old confident answers --
// status `UNCONTESTED` where `THREAT_INBOUND_ARRIVAL_UNKNOWN` is correct, and
// `shipsCompletingBeforeThreatArrival: 2` where the comparison is unevaluable.
//
// Six tests stayed green, correctly: the three that exercise the resolver or
// the index directly rather than through the board, the 999-placeholder scan,
// and the two endpoint-surface tests -- a shallow resolver still files
// everything under the off-board bucket, so the bucket's own shape does not
// depend on the resolution being deep. The resolver was then restored.
//
// The fixtures below are hand-built, so their expected values were written
// before the code that produces them rather than captured from its output.

const { test } = require('node:test');
const assert = require('node:assert');

const {
  theatersResource,
  theaterBoardResource,
  bodyStatusResource,
  HOSTILE_MOVEMENT_STATE,
  DESTINATION_RESOLUTION,
  buildDestinationIndex,
  resolveDestinationBody,
  buildResourceProjection
} = require('../shared/intelResources.mjs');

const OBSERVER = 4712;
const ALIEN = 4717;

// Both dates are written in the save's own local-time format so the day count
// is exactly the difference between them in every timezone. A mixed
// local/UTC pair would drift by an hour and round to a different day.
const GAME_DATE = '5/1/2033 12:00:00 AM';
const IN_30_DAYS = '5/31/2033 12:00:00 AM';
const IN_200_DAYS = '11/17/2033 12:00:00 AM';

function snapshot({ fleets = [], habs = [], habSites = [], shipyardQueues = [], shipyardStations = [] } = {}) {
  return {
    observerFactionId: OBSERVER,
    metadata: { gameTimeString: GAME_DATE },
    factions: [
      { ID: OBSERVER, displayName: 'the Initiative' },
      { ID: ALIEN, displayName: 'the Aliens' }
    ],
    fleets,
    habs,
    habSites,
    shipyardQueues,
    shipyardStations
  };
}

const alienFleet = (overrides) => ({
  ID: 900,
  displayName: 'Victor-84',
  factionId: ALIEN,
  factionName: 'the Aliens',
  orbitBody: 'Jupiter',
  shipsCount: 5,
  arrivalDate: IN_30_DAYS,
  ...overrides
});

const theaterFor = (snap, body) => theatersResource(snap, OBSERVER).find(row => row.body === body);

// ---------------------------------------------------------------------------
// 1. Deeper resolution: hab, orbit, fleet.
// ---------------------------------------------------------------------------

test('a hostile fleet bound for a hab resolves to the body that hab orbits', () => {
  // The live-save case: Iron Fortress Station is a name, not a place. It orbits
  // 16 Psyche there; here it is put in Ceres orbit so the assertion has a
  // tracked theater to land in.
  const snap = snapshot({
    fleets: [alienFleet({ destination: 'Iron Fortress Station', destinationType: 'hab', destinationId: 23484 })],
    habs: [{ ID: 23484, displayName: 'Iron Fortress Station', factionId: ALIEN, orbitBody: 'Ceres' }]
  });

  const ceres = theaterFor(snap, 'Ceres');
  assert.strictEqual(ceres.incoming.hostileFleets, 1, 'a hab destination must resolve to the hab\'s own orbit body');
  assert.strictEqual(ceres.incoming.hostileShips, 5);
  assert.strictEqual(ceres.incoming.nearestArrivalDays, 30);
  assert.strictEqual(ceres.status, 'THREAT_IMMINENT');

  const [row] = ceres.incoming.destinations;
  assert.strictEqual(row.statedDestination, 'Iron Fortress Station');
  assert.strictEqual(row.resolvedBody, 'Ceres');
  assert.strictEqual(row.resolutionMethod, DESTINATION_RESOLUTION.hab);
  assert.strictEqual(row.trackedTheater, true);
  assert.match(row.via.join(' '), /orbits Ceres/, 'the derivation is auditable, not asserted');
});

test('a "<Body> orbit" destination resolves to the body', () => {
  const snap = snapshot({
    fleets: [alienFleet({ destination: 'Titan orbit', destinationType: 'orbit', destinationId: 5042 })]
  });

  const titan = theaterFor(snap, 'Titan');
  assert.strictEqual(titan.incoming.hostileFleets, 1);
  assert.strictEqual(titan.incoming.destinations[0].resolutionMethod, DESTINATION_RESOLUTION.orbit);
  assert.strictEqual(titan.incoming.destinations[0].resolvedBody, 'Titan');
});

test('a numeric body prefix survives the orbit strip', () => {
  // "30 Urania orbit" is a real live-save destination. `normalizeBody` drops the
  // numeric prefix, so the reported body keeps it and only the match key loses
  // it -- the reader sees the save's own name for the rock.
  const index = buildDestinationIndex(snapshot());
  const resolved = resolveDestinationBody(
    { destination: '30 Urania orbit', destinationType: 'orbit' }, index);
  assert.strictEqual(resolved.body, '30 Urania');
  assert.strictEqual(resolved.normalizedBody, 'urania');
});

test('a rendezvous with another fleet resolves to where that fleet is', () => {
  const snap = snapshot({
    fleets: [
      alienFleet({ destination: 'Victor-771', destinationType: 'fleet', destinationId: 192745 }),
      { ID: 192745, displayName: 'Victor-771', factionId: ALIEN, factionName: 'the Aliens', orbitBody: 'Vesta', destinationType: 'stationary', shipsCount: 3 }
    ]
  });

  const vesta = theaterFor(snap, 'Vesta');
  assert.strictEqual(vesta.incoming.hostileFleets, 1);
  assert.strictEqual(vesta.incoming.destinations[0].resolutionMethod, DESTINATION_RESOLUTION.fleet);
  // Only the fleet that is moving counts as inbound; the stationary target is
  // already there and is counted as present hostile strength instead.
  assert.strictEqual(vesta.incoming.hostileShips, 5);
  assert.strictEqual(vesta.hostile.ships, 3);
});

test('a rendezvous with a fleet that is itself in transit follows the chain', () => {
  const snap = snapshot({
    fleets: [
      alienFleet({ destination: 'Victor-771', destinationType: 'fleet', destinationId: 192745 }),
      {
        ID: 192745, displayName: 'Victor-771', factionId: ALIEN, factionName: 'the Aliens',
        orbitBody: 'Jupiter', shipsCount: 3,
        destination: 'Bastion Station', destinationType: 'hab', destinationId: 77, arrivalDate: IN_200_DAYS
      }
    ],
    habs: [{ ID: 77, displayName: 'Bastion Station', factionId: ALIEN, orbitBody: 'Mars' }]
  });

  const mars = theaterFor(snap, 'Mars');
  assert.strictEqual(mars.incoming.hostileFleets, 2, 'both the chaser and the fleet it is chasing end up at Mars');
  const chaser = mars.incoming.destinations.find(row => row.fleet === 'Victor-84');
  assert.strictEqual(chaser.resolvedBody, 'Mars');
  assert.strictEqual(chaser.via.length, 2, 'two hops: the moving target, then the hab it is aimed at');
});

test('a rendezvous chain that loops back is unresolved, not guessed', () => {
  const snap = snapshot({
    fleets: [
      alienFleet({ ID: 900, displayName: 'Victor-A', destination: 'Victor-B', destinationType: 'fleet', destinationId: 901 }),
      {
        ID: 901, displayName: 'Victor-B', factionId: ALIEN, factionName: 'the Aliens',
        orbitBody: 'Ceres', shipsCount: 2,
        destination: 'Victor-A', destinationType: 'fleet', destinationId: 900, arrivalDate: IN_30_DAYS
      }
    ]
  });

  const board = theaterBoardResource(snap, OBSERVER);
  const looped = board.hostileMovement.offBoardDestinations.find(row => row.fleet === 'Victor-A');
  assert.strictEqual(looped.resolved, false);
  assert.strictEqual(looped.resolvedBody, null, 'a loop must not report the last body the chain touched');
  assert.match(looped.unresolvedReason, /loops back/);
});

// ---------------------------------------------------------------------------
// 2. What refuses to resolve. Player mode is where this matters: the
//    destination hab or fleet may simply not be in the observer's view.
// ---------------------------------------------------------------------------

test('a destination hab the observer cannot see is unresolved, never a body named after the station', () => {
  const snap = snapshot({
    fleets: [alienFleet({ destination: 'Iron Fortress Station', destinationType: 'hab', destinationId: 23484 })],
    habs: []
  });

  const board = theaterBoardResource(snap, OBSERVER);
  assert.strictEqual(board.hostileMovement.unresolvedDestinations.transfers, 1);
  const [row] = board.hostileMovement.offBoardDestinations;
  assert.strictEqual(row.resolved, false);
  assert.strictEqual(row.resolvedBody, null);
  assert.strictEqual(row.resolutionMethod, DESTINATION_RESOLUTION.unresolved);
  assert.match(row.unresolvedReason, /not in the observed hab list/);
  // And it reaches no theater at all -- an unresolved destination must not
  // match a body just because its name normalises to something.
  assert.strictEqual(
    theatersResource(snap, OBSERVER).reduce((sum, t) => sum + t.incoming.hostileFleets, 0), 0);
});

test('a name shared by two habs is ambiguous, not whichever was indexed first', () => {
  const snap = snapshot({
    fleets: [alienFleet({ destination: 'Relay Station', destinationType: 'hab' })],
    habs: [
      { ID: 1, displayName: 'Relay Station', factionId: ALIEN, orbitBody: 'Ceres' },
      { ID: 2, displayName: 'Relay Station', factionId: ALIEN, orbitBody: 'Titan' }
    ]
  });

  const board = theaterBoardResource(snap, OBSERVER);
  assert.strictEqual(board.hostileMovement.unresolvedDestinations.transfers, 1);
  assert.match(board.hostileMovement.offBoardDestinations[0].unresolvedReason, /shared by 2 records/);
  assert.strictEqual(theaterFor(snap, 'Ceres').incoming.hostileFleets, 0);
  assert.strictEqual(theaterFor(snap, 'Titan').incoming.hostileFleets, 0);
});

test('an empty display name is never an index key', () => {
  // Three fleets in the live save carry an empty `displayName`. Keying on it
  // is the collision that collapsed 303 candidates to 1 once already.
  const index = buildDestinationIndex(snapshot({
    fleets: [
      { ID: 1, displayName: '', orbitBody: 'Ceres', destinationType: 'stationary' },
      { ID: 2, displayName: '', orbitBody: 'Titan', destinationType: 'stationary' }
    ]
  }));
  const resolved = resolveDestinationBody({ destination: '', destinationType: 'fleet' }, index);
  assert.strictEqual(resolved.resolved, false);
  assert.strictEqual(resolved.reason, 'no destination on record');
});

// ---------------------------------------------------------------------------
// 3. The off-board bucket. Today it carries the whole feature: every hostile
//    movement in the live save is bound for a body the board does not track.
// ---------------------------------------------------------------------------

const offBoardFixture = () => snapshot({
  fleets: [
    alienFleet({ ID: 900, displayName: 'Victor-84', destination: 'Iron Fortress Station', destinationType: 'hab', destinationId: 23484, shipsCount: 5, arrivalDate: IN_200_DAYS }),
    alienFleet({ ID: 901, displayName: 'Victor-886', destination: 'Triton orbit', destinationType: 'orbit', shipsCount: 1, arrivalDate: IN_30_DAYS })
  ],
  habs: [{ ID: 23484, displayName: 'Iron Fortress Station', factionId: ALIEN, orbitBody: '16 Psyche' }]
});

test('hostile movement that reaches no tracked theater is reported, not silently dropped', () => {
  const board = theaterBoardResource(offBoardFixture(), OBSERVER);
  const movement = board.hostileMovement;

  assert.strictEqual(movement.state, HOSTILE_MOVEMENT_STATE.elsewhere);
  assert.deepStrictEqual(movement.observed, { transfers: 2, ships: 6 });
  assert.deepStrictEqual(movement.towardTrackedTheaters, { transfers: 0, ships: 0 });
  assert.deepStrictEqual(movement.towardUntrackedBodies, { transfers: 2, ships: 6 });
  assert.deepStrictEqual(movement.unresolvedDestinations, { transfers: 0, ships: 0 });
  assert.strictEqual(movement.reconciles, true);
  assert.strictEqual(movement.offBoardDestinationsTotalCount, 2);
  assert.strictEqual(movement.offBoardDestinationsOmittedCount, 0);

  // Soonest measured arrival first.
  assert.deepStrictEqual(movement.offBoardDestinations.map(row => row.resolvedBody), ['Triton', '16 Psyche']);
  assert.strictEqual(movement.nearestArrivalDays, 30);

  // And the twelve-row table is genuinely empty, which is the whole point: a
  // consumer reading only the table sees nothing while six hostile ships move.
  assert.strictEqual(board.theaters.reduce((sum, t) => sum + t.incoming.hostileFleets, 0), 0);
});

test('no hostile movement at all is a different answer from hostile movement aimed elsewhere', () => {
  const quiet = theaterBoardResource(snapshot(), OBSERVER).hostileMovement;
  const busy = theaterBoardResource(offBoardFixture(), OBSERVER).hostileMovement;

  assert.strictEqual(quiet.state, HOSTILE_MOVEMENT_STATE.none);
  assert.strictEqual(busy.state, HOSTILE_MOVEMENT_STATE.elsewhere);
  assert.notStrictEqual(quiet.state, busy.state,
    'an empty theater table renders these two identically; the bucket is what separates them');
  assert.strictEqual(quiet.observed.transfers, 0);
  assert.strictEqual(busy.observed.transfers, 2);
});

test('an unresolved hostile destination blocks the "none of it is coming here" claim', () => {
  const snap = offBoardFixture();
  snap.fleets.push(alienFleet({ ID: 902, displayName: 'Victor-999', destination: 'Ghost Station', destinationType: 'hab', destinationId: 5, shipsCount: 4 }));

  const movement = theaterBoardResource(snap, OBSERVER).hostileMovement;
  assert.strictEqual(movement.state, HOSTILE_MOVEMENT_STATE.partlyUnresolved,
    'with a destination we cannot resolve, "none of it is aimed at a tracked theater" is not a claim the data supports');
  assert.strictEqual(movement.unresolvedDestinations.transfers, 1);
  assert.strictEqual(movement.unresolvedDestinations.ships, 4);
  assert.strictEqual(movement.reconciles, true);
  assert.strictEqual(
    movement.towardTrackedTheaters.transfers + movement.towardUntrackedBodies.transfers + movement.unresolvedDestinations.transfers,
    movement.observed.transfers);
});

test('a hostile fleet that does reach a tracked theater is reported as inbound, not off-board', () => {
  const snap = offBoardFixture();
  snap.habs.push({ ID: 55, displayName: 'Perimeter Station', factionId: ALIEN, orbitBody: 'Mercury' });
  snap.fleets.push(alienFleet({ ID: 903, displayName: 'Victor-77', destination: 'Perimeter Station', destinationType: 'hab', destinationId: 55, shipsCount: 9 }));

  const board = theaterBoardResource(snap, OBSERVER);
  assert.strictEqual(board.hostileMovement.state, HOSTILE_MOVEMENT_STATE.inbound);
  assert.deepStrictEqual(board.hostileMovement.towardTrackedTheaters, { transfers: 1, ships: 9 });
  assert.strictEqual(board.hostileMovement.offBoardDestinationsTotalCount, 2,
    'the inbound one is on the board and must not be listed as off it too');
  assert.strictEqual(board.theaters.find(t => t.body === 'Mercury').incoming.hostileShips, 9);
});

// ---------------------------------------------------------------------------
// 4. Absent stays null. `UNKNOWN_ARRIVAL_SORT_DAYS = 999` was documented as a
//    sort-only placeholder and then read by `Math.min` into a REPORTED
//    `nearestArrivalDays` and by a `<=` that produced a rendered ship count.
// ---------------------------------------------------------------------------

const noArrivalDateFixture = () => snapshot({
  fleets: [alienFleet({ destination: 'Titan orbit', destinationType: 'orbit', arrivalDate: null, currentOrders: 'Transfer' })],
  shipyardQueues: [
    { id: 1, factionId: OBSERVER, orbitBody: 'Titan', daysToCompletion: 12 },
    { id: 2, factionId: OBSERVER, orbitBody: 'Titan', daysToCompletion: null }
  ]
});

test('an inbound hostile fleet with no arrival date reports null days, never the 999 placeholder', () => {
  const titan = theaterFor(noArrivalDateFixture(), 'Titan');

  assert.strictEqual(titan.incoming.hostileFleets, 1, 'it is still inbound');
  assert.strictEqual(titan.incoming.nearestArrivalDays, null, 'an unknown arrival time is not a distant one');
  assert.strictEqual(titan.incoming.nearestArrivalDate, null);
  assert.strictEqual(titan.incoming.arrivalTimingUnknownFleets, 1);
  assert.strictEqual(titan.incoming.arrivalTimingKnown, false);
});

test('an imminence test that cannot be run says so instead of falling through to a calmer label', () => {
  const titan = theaterFor(noArrivalDateFixture(), 'Titan');
  assert.strictEqual(titan.status, 'THREAT_INBOUND_ARRIVAL_UNKNOWN');
  assert.notStrictEqual(titan.status, 'UNCONTESTED');
  assert.notStrictEqual(titan.status, 'SECURE');
});

test('shipsCompletingBeforeThreatArrival refuses to answer when the threat has no arrival date', () => {
  const titan = theaterFor(noArrivalDateFixture(), 'Titan');
  assert.strictEqual(titan.production.shipsCompletingBeforeThreatArrival, null,
    'with 999 standing in for the arrival, both queued hulls read as finishing in time');
  assert.match(titan.production.shipsCompletingBeforeThreatArrivalBasis, /unevaluable/);
  assert.strictEqual(titan.production.totalQueuedShips, 2);
});

test('a queued hull with no completion date is excluded and counted, not treated as 999 days', () => {
  const snap = noArrivalDateFixture();
  snap.fleets[0].arrivalDate = IN_30_DAYS;

  const titan = theaterFor(snap, 'Titan');
  assert.strictEqual(titan.incoming.nearestArrivalDays, 30);
  assert.strictEqual(titan.production.shipsCompletingBeforeThreatArrival, 1, 'only the hull with a measured date');
  assert.strictEqual(titan.production.queuedShipsWithUnknownCompletion, 1);
  assert.match(titan.production.shipsCompletingBeforeThreatArrivalBasis, /excluded for want of a completion date/);
});

test('the 999 sort placeholder appears nowhere in the rendered board', () => {
  const board = theaterBoardResource(noArrivalDateFixture(), OBSERVER);
  const found = [];
  (function walk(node, path) {
    if (node === 999) found.push(path);
    else if (Array.isArray(node)) node.forEach((child, i) => walk(child, `${path}[${i}]`));
    else if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) walk(value, `${path}.${key}`);
    }
  })(board, 'board');
  assert.deepStrictEqual(found, [], 'a sort placeholder that reaches the payload is a fabricated measurement');
});

// ---------------------------------------------------------------------------
// 5. The endpoint surface, both modes.
// ---------------------------------------------------------------------------

for (const mode of ['player', 'omniscient']) {
  test(`the theaters endpoint carries the off-board bucket beside the twelve rows (${mode} mode)`, () => {
    const projected = buildResourceProjection(offBoardFixture(), 'theaters', { mode, observer: OBSERVER });
    assert.strictEqual(projected.count, 12, 'items stays the twelve theater rows');
    assert.strictEqual(projected.items.length, 12);
    assert.ok(projected.hostileMovement, 'a consumer reading only items sees an empty threat picture');
    assert.strictEqual(projected.hostileMovement.state, HOSTILE_MOVEMENT_STATE.elsewhere);
    assert.strictEqual(projected.hostileMovement.observed.transfers, 2);
    assert.deepStrictEqual(projected.hostileMovement.trackedBodies.length, 12,
      'the bucket names what "tracked" means rather than leaving it to be inferred');
  });
}

test('body-status resolves a hab destination to its parent body too', () => {
  // The sibling function seventy lines below the board had the same literal
  // name test. A guard fixed on one side of a file and not the other is how
  // this repo has shipped the same defect twice.
  const snap = snapshot({
    fleets: [{
      ID: 300, displayName: 'Papa-291', factionId: 4714, factionName: 'the Protectorate',
      orbitBody: 'Sol', shipsCount: 1, arrivalDate: IN_30_DAYS,
      destination: 'Antiochus Station', destinationType: 'hab', destinationId: 17949
    }],
    habs: [{ ID: 17949, displayName: 'Antiochus Station', factionId: 4714, orbitBody: 'Earth' }]
  });

  const earth = bodyStatusResource(snap, 'Earth', OBSERVER);
  assert.strictEqual(earth.incomingTransfers.length, 1);
  assert.strictEqual(earth.incomingTransfers[0].destination, 'Antiochus Station', 'the stated destination is preserved');
  assert.strictEqual(earth.incomingTransfers[0].resolvedDestinationBody, 'Earth');
  assert.strictEqual(earth.incomingTransfers[0].destinationResolutionMethod, DESTINATION_RESOLUTION.hab);
});
