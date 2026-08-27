// tests/theaterDefence.test.js
//
// The theater-defence block: build, reinforce or withdraw at each threatened
// body -- and, more importantly, the refusals.
//
// WHY THESE EXIST
// ---------------
// `server/engine/theaterDefence.js` is the first thing in the engine that can
// say "a 105-ship alien fleet reaches Mercury in 57 days, you have 30 ships
// there, and the fastest hull your Mercury yards can lay down lands 48 days
// before it arrives". Every sentence of that is a reading that can be absent,
// and the whole point of the block is that an absent reading produces
// `CANNOT_ADVISE` with a named refusal rather than a confident posture. These
// tests own that behaviour.
//
// THE FIXTURE / LIVE SPLIT, AND WHY IT IS LUCKY HERE
// -------------------------------------------------
// The committed fixtures (`tests/fixtures/snapshot-{player,omniscient}-intel
// .json`, observer 4712) carry a full threat picture -- six theaters with
// inbound hostiles, Mercury at `THREAT_IMMINENT` -- but NO measured build
// times, because the observer faction they carry has neither
// `shipConstructionSpeed` nor `shipConstructionTimeEffects` (both were added to
// server/snapshot/factions.js after the fixtures were derived). So on the
// fixture the observer holds five yards at Mercury and none of them produces a
// measured build time. That is exactly the case the block must refuse: yards
// present, build time absent, race unevaluable, `CANNOT_ADVISE`. The BUILD path
// is covered here by hand-built military worlds, and against the current
// campaign by the live verification in the task report.
//
// WHERE THE EXPECTED VALUES COME FROM
// -----------------------------------
// Pass-through figures (`threat.*`, `friendly.*`) are re-derived in the test
// from `world.military.theaters` rather than pasted from the block's own
// output, so they assert the transformation and not the number. The postures,
// the refusals and the ordering are asserted as behaviour. Nothing here was
// captured from the code under test.
//
// See the DELIBERATE-BREAK note at the bottom.

const { test } = require('node:test');
const assert = require('node:assert');

const {
  buildTheaterDefence,
  THEATER_POSTURE,
  DEFENCE_CHECKS,
  THEATER_DEFENCE_FINDING_LIMIT
} = require('../server/engine/theaterDefence');
const { buildMilitaryWorld } = require('../server/engine/military');
const { buildWorld, runEngine } = require('../server/directiveEngine');
const { loadFixtureFilteredSnapshot } = require('./fixtures/frozenSnapshots');
const { HOSTILE_MOVEMENT_STATE } = require('../shared/intel/theaters.mjs');

const OBSERVER = 4712;
const MODES = ['player', 'omniscient'];

// ---------------------------------------------------------------------------
// Hand-built military worlds. The block reads `world.military` and nothing
// else, so a synthetic one is the whole input surface.
// ---------------------------------------------------------------------------

function theaterRow(overrides = {}) {
  const {
    friendly = {}, hostile = {}, incoming = {}, production = {}, ...rest
  } = overrides;
  return {
    body: 'Mercury',
    status: 'THREAT_IMMINENT',
    friendly: { ships: 30, fleets: 2, habs: 3, shipyards: 12, mines: 2, ...friendly },
    hostile: { ships: 0, fleets: 0, factions: [], ...hostile },
    incoming: {
      hostileShips: 105,
      hostileFleets: 1,
      nearestArrivalDays: 57,
      nearestArrivalDate: '2042-11-13T11:24:57.703Z',
      arrivalTimingUnknownFleets: 0,
      arrivalTimingKnown: true,
      destinations: [],
      ...incoming
    },
    production: {
      shipsCompletingBeforeThreatArrival: 0,
      shipsCompletingBeforeThreatArrivalBasis: 'measured against the nearest inbound arrival',
      queuedShipsWithUnknownCompletion: 0,
      totalQueuedShips: 0,
      ...production
    },
    ...rest
  };
}

function militaryWorld(overrides = {}) {
  const { hostileMovement = {}, ...rest } = overrides;
  return {
    available: true,
    unavailableReason: null,
    hostileMovement: {
      state: HOSTILE_MOVEMENT_STATE.inbound,
      observed: { transfers: 1, ships: 105 },
      towardTrackedTheaters: { transfers: 1, ships: 105 },
      towardUntrackedBodies: { transfers: 0, ships: 0 },
      unresolvedDestinations: { transfers: 0, ships: 0 },
      reconciles: true,
      nearestArrivalDays: 57,
      nearestArrivalDate: '2042-11-13T11:24:57.703Z',
      arrivalTimingUnknownTransfers: 0,
      trackedBodies: ['Mercury'],
      offBoardDestinations: [],
      offBoardDestinationsTotalCount: 0,
      offBoardDestinationsOmittedCount: 0,
      ...hostileMovement
    },
    theaters: [theaterRow()],
    shipyards: [{
      id: 315317,
      factionId: OBSERVER,
      habName: 'Mercury Yard',
      orbitBody: 'Mercury',
      spaceTheaterKey: 'inner',
      spaceTheaterName: 'INNER / MERCURY',
      templateName: 'Spaceworks',
      moduleTier: 3,
      moduleTierSource: 'module-table'
    }],
    buildOptions: [{
      body: 'Mercury',
      spaceTheaterKey: 'inner',
      hullName: 'Frigate',
      fastestDays: 18,
      shipyardId: 315317,
      shipyardModuleTier: 3,
      yardsConsidered: 12
    }],
    buildRefusals: [],
    hate: { actual: 100, redacted: false, threshold: 50, floor: 47 },
    ...rest
  };
}

const only = (block) => {
  assert.equal(block.findings.length, 1, 'expected exactly one finding');
  return block.findings[0];
};

const fixtureMilitary = (mode) => buildMilitaryWorld(loadFixtureFilteredSnapshot({ mode }), OBSERVER);

// ---------------------------------------------------------------------------
// Contract shape, both modes
// ---------------------------------------------------------------------------

test('the block reports the contract shape against the committed fixture in BOTH modes', () => {
  for (const mode of MODES) {
    const block = buildTheaterDefence({ military: fixtureMilitary(mode) });

    assert.equal(block.available, true, mode);
    assert.equal(block.unavailableReason, null, mode);
    assert.equal(block.state, HOSTILE_MOVEMENT_STATE.inbound, mode);
    assert.ok(Array.isArray(block.findings), mode);
    assert.ok(block.findings.length > 0, `${mode}: the fixture carries inbound hostiles`);
    assert.equal(typeof block.findingsTotalCount, 'number', mode);
    assert.equal(typeof block.findingsOmittedCount, 'number', mode);
    assert.equal(
      block.findingsTotalCount - block.findings.length,
      block.findingsOmittedCount,
      `${mode}: a capped list must announce exactly what it dropped`
    );
    assert.ok(Array.isArray(block.notes), mode);

    for (const finding of block.findings) {
      for (const key of ['id', 'body', 'spaceTheaterKey', 'posture', 'threat',
        'friendly', 'buildRace', 'refusals', 'citations']) {
        assert.ok(key in finding, `${mode}: ${finding.body} missing ${key}`);
      }
      assert.ok(Object.values(THEATER_POSTURE).includes(finding.posture),
        `${mode}: ${finding.body} posture ${finding.posture} is not one of the five`);
      assert.ok(finding.id.startsWith('theater-defence:'), `${mode}: ${finding.id}`);
      assert.equal(finding.id.includes('undefined'), false,
        `${mode}: an unresolvable identity must never become the string "undefined"`);
      for (const key of ['hostileShips', 'hostileFleets', 'nearestArrivalDays',
        'nearestArrivalDate', 'arrivalTimingKnown']) {
        assert.ok(key in finding.threat, `${mode}: ${finding.body} threat.${key}`);
      }
      for (const key of ['ships', 'shipyards', 'shipsCompletingBeforeThreatArrival',
        'completionBasis']) {
        assert.ok(key in finding.friendly, `${mode}: ${finding.body} friendly.${key}`);
      }
    }
  }
});

test('player mode does not make the block go inert', () => {
  // Two shipped defects came from checking only omniscient: a veto fell through
  // to `false` on a redacted null, and a whole axis vanished because observed
  // enemies carry `maskedAttributes`. The postures here must be identical in
  // both modes -- the theater board is not redacted, and a block that quietly
  // emptied in player mode would be the same defect a third time.
  const byMode = MODES.map(mode => buildTheaterDefence({ military: fixtureMilitary(mode) }));
  const [player, omniscient] = byMode;

  assert.ok(player.findings.length > 0, 'player mode must still produce findings');
  assert.equal(player.findings.length, omniscient.findings.length);
  assert.deepEqual(
    player.findings.map(f => `${f.body}:${f.posture}`),
    omniscient.findings.map(f => `${f.body}:${f.posture}`)
  );
});

test('every finding cites the readings it rests on', () => {
  for (const mode of MODES) {
    const block = buildTheaterDefence({ military: fixtureMilitary(mode) });
    for (const finding of block.findings) {
      assert.ok(Array.isArray(finding.citations), `${mode}: ${finding.body} citations array`);
      assert.ok(finding.citations.length > 0,
        `${mode}: ${finding.body} has a posture and no citations -- that is a bug`);
      for (const citation of finding.citations) {
        assert.equal(typeof citation.source, 'string');
        assert.ok(citation.source.length > 0);
        assert.equal(typeof citation.field, 'string');
        assert.ok(citation.field.length > 0);
      }
    }
  }
});

test('pass-through readings are the board\'s own, not re-derived', () => {
  const military = fixtureMilitary('omniscient');
  const block = buildTheaterDefence({ military });
  for (const finding of block.findings) {
    const theater = military.theaters.find(t => t.body === finding.body);
    assert.ok(theater, `${finding.body} must come from a board row`);
    assert.equal(finding.threat.hostileShips, theater.incoming.hostileShips);
    assert.equal(finding.threat.hostileFleets, theater.incoming.hostileFleets);
    assert.equal(finding.threat.nearestArrivalDays, theater.incoming.nearestArrivalDays);
    assert.equal(finding.threat.nearestArrivalDate, theater.incoming.nearestArrivalDate);
    assert.equal(finding.friendly.ships, theater.friendly.ships);
    assert.equal(finding.friendly.shipyards, theater.friendly.shipyards);
    assert.equal(
      finding.friendly.shipsCompletingBeforeThreatArrival,
      theater.production.shipsCompletingBeforeThreatArrival
    );
  }
});

// ---------------------------------------------------------------------------
// THE REFUSAL PATHS. These are the point of the block, not its edge cases.
// ---------------------------------------------------------------------------

// The world below deliberately holds NO yard at the threatened body. That is
// what makes the imminence refusal observable: with a yard present, the
// "yards here but no measured build time" refusal fires first and the test
// would pass even with the imminence check deleted. Measured, not assumed --
// the first cut of this file did carry a yard, and deleting the imminence line
// left all 32 tests green. See the DELIBERATE-BREAK note at the bottom.
const inboundWithNoArrivalDate = () => militaryWorld({
  shipyards: [],
  buildOptions: [],
  buildRefusals: [],
  theaters: [theaterRow({
    status: 'THREAT_INBOUND_ARRIVAL_UNKNOWN',
    // Ships present, so without the imminence refusal this would fall straight
    // through to a confident WITHDRAW.
    friendly: { ships: 30, habs: 3, shipyards: 0, mines: 2 },
    incoming: {
      nearestArrivalDays: null,
      nearestArrivalDate: null,
      arrivalTimingUnknownFleets: 1,
      arrivalTimingKnown: false
    }
  })]
});

test('REFUSAL: an inbound force with no arrival date is CANNOT_ADVISE, never a posture', () => {
  const block = buildTheaterDefence({ military: inboundWithNoArrivalDate() });

  const finding = only(block);
  assert.equal(finding.posture, THEATER_POSTURE.cannotAdvise,
    'an unknown arrival is not a distant one -- the imminence test cannot be run');
  assert.notEqual(finding.posture, THEATER_POSTURE.build);
  assert.notEqual(finding.posture, THEATER_POSTURE.hold);
  assert.ok(finding.refusals.length > 0, 'CANNOT_ADVISE must say what was missing');
  assert.ok(finding.refusals.some(r => r.check === DEFENCE_CHECKS.imminence),
    `expected an imminence refusal; got ${JSON.stringify(finding.refusals)}`);
  // The missing day count stays missing. No stand-in under any name -- this
  // file's ancestor carried UNKNOWN_ARRIVAL_SORT_DAYS = 999 and it leaked into
  // a reported figure.
  assert.strictEqual(finding.threat.nearestArrivalDays, null);
  assert.notStrictEqual(finding.threat.nearestArrivalDays, 0);
  assert.strictEqual(finding.buildRace, null,
    'a race against an unmeasured arrival must not be run at all');
  assert.notEqual(finding.posture, THEATER_POSTURE.withdraw,
    'WITHDRAW is what this collapses to if the imminence refusal is removed');
});

test('REFUSAL: an unknown arrival refuses even where a build time IS measured', () => {
  // The other half of the pair above: yards present with a measured option, so
  // the race would be runnable the moment an arrival date existed. It does not,
  // and a margin computed against a fabricated arrival is exactly the figure
  // this block refuses to produce.
  const block = buildTheaterDefence({
    military: militaryWorld({
      theaters: [theaterRow({
        status: 'THREAT_INBOUND_ARRIVAL_UNKNOWN',
        incoming: {
          nearestArrivalDays: null,
          nearestArrivalDate: null,
          arrivalTimingUnknownFleets: 1,
          arrivalTimingKnown: false
        }
      })]
    })
  });
  const finding = only(block);
  assert.equal(finding.posture, THEATER_POSTURE.cannotAdvise);
  assert.strictEqual(finding.buildRace, null);
  assert.ok(finding.refusals.some(r => r.check === DEFENCE_CHECKS.imminence));
});

test('REFUSAL: yards at the body but no measured build time is CANNOT_ADVISE with buildRace null', () => {
  const block = buildTheaterDefence({
    military: militaryWorld({
      buildOptions: [],
      buildRefusals: [{ body: 'Mercury', hullName: 'Frigate', reason: 'faction-build-modifier-unmeasured' }]
    })
  });

  const finding = only(block);
  assert.equal(finding.posture, THEATER_POSTURE.cannotAdvise,
    'an unknown build time makes the comparison unevaluable -- never a confident "build it"');
  assert.strictEqual(finding.buildRace, null);
  const refusal = finding.refusals.find(r => r.check === DEFENCE_CHECKS.buildRace);
  assert.ok(refusal, `expected a build-race refusal; got ${JSON.stringify(finding.refusals)}`);
  assert.ok(refusal.reason.includes('faction-build-modifier-unmeasured'),
    'the refusal must name the measurement that was missing');
});

test('the committed fixture takes exactly that path at Mercury', () => {
  for (const mode of MODES) {
    const military = fixtureMilitary(mode);
    // Pre-condition, asserted rather than assumed: the fixture carries yards at
    // Mercury and no measured build option anywhere.
    assert.equal(military.buildOptions.length, 0, mode);
    assert.ok(military.shipyards.some(y => y.orbitBody === 'Mercury'), mode);

    const finding = buildTheaterDefence({ military }).findings.find(f => f.body === 'Mercury');
    assert.ok(finding, `${mode}: the Mercury finding must appear -- the fixture has 1 fleet inbound`);
    assert.equal(finding.posture, THEATER_POSTURE.cannotAdvise, mode);
    assert.strictEqual(finding.buildRace, null, mode);
    assert.ok(finding.refusals.some(r => r.check === DEFENCE_CHECKS.buildRace), mode);
    assert.equal(finding.spaceTheaterKey, 'inner', mode);
  }
});

test('REFUSAL: buckets that do not partition the observed set refuse every finding', () => {
  const block = buildTheaterDefence({
    military: militaryWorld({ hostileMovement: { reconciles: false } })
  });

  assert.ok(block.notes.some(note => note.includes('reconciles')),
    `expected a reconciliation note; got ${JSON.stringify(block.notes)}`);
  for (const finding of block.findings) {
    assert.equal(finding.posture, THEATER_POSTURE.cannotAdvise,
      'no count from unreconciled buckets is trustworthy, so no posture rests on one');
    assert.ok(finding.refusals.some(r => r.check === DEFENCE_CHECKS.hostileCounts),
      `${finding.body}: expected a hostile-count refusal`);
  }
});

test('REFUSAL: an unreadable inbound fleet count is not a zero', () => {
  const block = buildTheaterDefence({
    military: militaryWorld({
      theaters: [theaterRow({ incoming: { hostileFleets: null, hostileShips: null } })]
    })
  });
  const finding = only(block);
  assert.equal(finding.posture, THEATER_POSTURE.cannotAdvise);
  assert.strictEqual(finding.threat.hostileFleets, null);
  assert.notStrictEqual(finding.threat.hostileFleets, 0);
  assert.ok(finding.refusals.some(r => r.check === DEFENCE_CHECKS.hostileCounts));
});

test('no yard at the body is a MEASURED absence, not an absent measurement', () => {
  // The two must not collapse. "You hold no yard here" is a fact and the
  // presence question is still answerable; "you hold twelve yards and none of
  // them produced a build time" is an absent reading and nothing can be said.
  const block = buildTheaterDefence({
    military: militaryWorld({
      shipyards: [],
      buildOptions: [],
      buildRefusals: [],
      theaters: [theaterRow({ friendly: { ships: 30, habs: 0, shipyards: 0, mines: 0 } })]
    })
  });

  const finding = only(block);
  assert.notEqual(finding.posture, THEATER_POSTURE.cannotAdvise,
    'a measured absence of build capacity still leaves reinforce/withdraw answerable');
  assert.equal(finding.posture, THEATER_POSTURE.withdraw);
  assert.strictEqual(finding.buildRace, null);
  const refusal = finding.refusals.find(r => r.check === DEFENCE_CHECKS.buildRace);
  assert.ok(refusal, 'the absent race is still reported');
  assert.ok(refusal.reason.includes('no shipyard'),
    `expected the refusal to name the measured absence; got ${refusal.reason}`);
});

// ---------------------------------------------------------------------------
// The postures
// ---------------------------------------------------------------------------

test('BUILD when the fastest hull the body can lay down lands before the fleet arrives', () => {
  const finding = only(buildTheaterDefence({ military: militaryWorld() }));

  assert.equal(finding.posture, THEATER_POSTURE.build);
  assert.equal(finding.buildRace.verdict, 'build-lands-first');
  assert.equal(finding.buildRace.available, true);
  assert.equal(finding.buildRace.buildDays, 18);
  assert.equal(finding.buildRace.daysUntilArrival, 57);
  assert.equal(finding.buildRace.marginDays, 39);
  assert.equal(finding.buildRace.hullName, 'Frigate');
  assert.equal(finding.buildRace.shipyardId, 315317);
  assert.equal(finding.refusals.length, 0);
});

test('the race takes the FASTEST measured option at that body, breaking ties on hull name', () => {
  const block = buildTheaterDefence({
    military: militaryWorld({
      buildOptions: [
        { body: 'Mercury', hullName: 'Cruiser', fastestDays: 44, shipyardId: 1, shipyardModuleTier: 3 },
        { body: 'Mercury', hullName: 'Gunship', fastestDays: 9, shipyardId: 2, shipyardModuleTier: 3 },
        { body: 'Mercury', hullName: 'Frigate', fastestDays: 18, shipyardId: 3, shipyardModuleTier: 3 },
        // A different body must never be borrowed to win this body's race.
        { body: 'Earth', hullName: 'Gunship', fastestDays: 1, shipyardId: 4, shipyardModuleTier: 3 }
      ]
    })
  });
  const finding = only(block);
  assert.equal(finding.buildRace.hullName, 'Gunship');
  assert.equal(finding.buildRace.buildDays, 9);
  assert.equal(finding.buildRace.shipyardId, 2);
  assert.equal(finding.buildRace.marginDays, 48);
});

test('an option with no measured day count is not the fastest anything', () => {
  const block = buildTheaterDefence({
    military: militaryWorld({
      buildOptions: [
        { body: 'Mercury', hullName: 'Ghost', fastestDays: null, shipyardId: 9, shipyardModuleTier: 3 },
        { body: 'Mercury', hullName: 'Frigate', fastestDays: 18, shipyardId: 315317, shipyardModuleTier: 3 }
      ]
    })
  });
  const finding = only(block);
  assert.equal(finding.buildRace.hullName, 'Frigate',
    'a null day count must never sort ahead of a measured one');
  assert.equal(finding.buildRace.buildDays, 18);
});

test('WITHDRAW when nothing this body can build lands in time and there are ships to move', () => {
  const block = buildTheaterDefence({
    military: militaryWorld({
      buildOptions: [{
        body: 'Mercury', hullName: 'Cruiser', fastestDays: 90, shipyardId: 315317, shipyardModuleTier: 1
      }],
      theaters: [theaterRow({ friendly: { ships: 30, habs: 3, shipyards: 12, mines: 2 } })]
    })
  });
  const finding = only(block);
  assert.equal(finding.buildRace.verdict, 'arrival-first');
  assert.equal(finding.buildRace.marginDays, -33);
  assert.equal(finding.posture, THEATER_POSTURE.withdraw);
});

test('REINFORCE when nothing lands in time, nothing is there to move, but holdings are', () => {
  const block = buildTheaterDefence({
    military: militaryWorld({
      buildOptions: [{
        body: 'Mercury', hullName: 'Cruiser', fastestDays: 90, shipyardId: 315317, shipyardModuleTier: 1
      }],
      theaters: [theaterRow({ friendly: { ships: 0, habs: 3, shipyards: 12, mines: 2 } })]
    })
  });
  assert.equal(only(block).posture, THEATER_POSTURE.reinforce);
});

test('a simultaneous race is not a win', () => {
  const block = buildTheaterDefence({
    military: militaryWorld({
      buildOptions: [{
        body: 'Mercury', hullName: 'Frigate', fastestDays: 57, shipyardId: 315317, shipyardModuleTier: 3
      }]
    })
  });
  const finding = only(block);
  assert.equal(finding.buildRace.verdict, 'simultaneous');
  assert.notEqual(finding.posture, THEATER_POSTURE.build);
  assert.equal(finding.posture, THEATER_POSTURE.withdraw);
});

test('HOLD when a hostile force is present, nothing is inbound and nothing of ours is there', () => {
  const block = buildTheaterDefence({
    military: militaryWorld({
      theaters: [theaterRow({
        body: 'Callisto',
        status: 'CONTESTED',
        friendly: { ships: 0, fleets: 0, habs: 0, shipyards: 0, mines: 0 },
        hostile: { ships: 28, fleets: 3, factions: ['Servants'] },
        incoming: {
          hostileShips: 0,
          hostileFleets: 0,
          nearestArrivalDays: null,
          nearestArrivalDate: null,
          arrivalTimingKnown: null
        }
      })]
    })
  });
  const finding = only(block);
  assert.equal(finding.posture, THEATER_POSTURE.hold);
  assert.strictEqual(finding.buildRace, null, 'no arrival clock means no race');
  assert.equal(finding.refusals.length, 0,
    'nothing was unevaluable here -- there is simply no race to run');
  assert.equal(finding.threat.presentHostileShips, 28);
  // The board reports null -- not false -- when nothing is inbound, and that
  // is carried verbatim: there is no timing to know.
  assert.strictEqual(finding.threat.arrivalTimingKnown, null);
});

test('REINFORCE when a hostile force sits over holdings we have no ships at', () => {
  const block = buildTheaterDefence({
    military: militaryWorld({
      theaters: [theaterRow({
        body: 'Ganymede',
        status: 'CONTESTED',
        friendly: { ships: 0, fleets: 0, habs: 2, shipyards: 0, mines: 1 },
        hostile: { ships: 5, fleets: 1, factions: ['Servants'] },
        incoming: {
          hostileShips: 0,
          hostileFleets: 0,
          nearestArrivalDays: null,
          nearestArrivalDate: null,
          arrivalTimingKnown: null
        }
      })]
    })
  });
  assert.equal(only(block).posture, THEATER_POSTURE.reinforce);
});

test('a quiet theater earns no finding at all', () => {
  const block = buildTheaterDefence({
    military: militaryWorld({
      theaters: [theaterRow({
        body: 'Vesta',
        status: 'UNCONTESTED',
        friendly: { ships: 0, fleets: 0, habs: 0, shipyards: 0, mines: 0 },
        hostile: { ships: 0, fleets: 0, factions: [] },
        incoming: {
          hostileShips: 0,
          hostileFleets: 0,
          nearestArrivalDays: null,
          nearestArrivalDate: null,
          arrivalTimingKnown: null
        }
      })]
    })
  });
  assert.equal(block.findings.length, 0);
  assert.equal(block.findingsTotalCount, 0);
  assert.equal(block.findingsOmittedCount, 0);
});

// ---------------------------------------------------------------------------
// Order, truncation, off-board movement and the notes
// ---------------------------------------------------------------------------

test('findings are emitted worst-true-thing first, unknown arrivals not sorted as distant', () => {
  const block = buildTheaterDefence({
    military: militaryWorld({
      theaters: [
        theaterRow({ body: 'Luna', status: 'CONTESTED', hostile: { ships: 4, fleets: 3 }, incoming: { hostileShips: 0, hostileFleets: 0, nearestArrivalDays: null, nearestArrivalDate: null, arrivalTimingKnown: null } }),
        theaterRow({ body: 'Mercury', status: 'THREAT_IMMINENT', incoming: { nearestArrivalDays: 57 } }),
        theaterRow({ body: 'Earth', status: 'THREAT_IMMINENT', incoming: { nearestArrivalDays: 21 } }),
        theaterRow({ body: 'Titan', status: 'THREAT_INBOUND_ARRIVAL_UNKNOWN', incoming: { nearestArrivalDays: null, nearestArrivalDate: null, arrivalTimingKnown: false } })
      ]
    })
  });
  assert.deepEqual(block.findings.map(f => f.body), ['Earth', 'Mercury', 'Titan', 'Luna']);
});

test('the finding cap announces itself', () => {
  assert.equal(typeof THEATER_DEFENCE_FINDING_LIMIT, 'number');
  const theaters = [];
  for (let i = 0; i < THEATER_DEFENCE_FINDING_LIMIT + 3; i += 1) {
    theaters.push(theaterRow({ body: `Body${String(i).padStart(2, '0')}`, incoming: { nearestArrivalDays: i + 1 } }));
  }
  const block = buildTheaterDefence({ military: militaryWorld({ theaters }) });
  assert.equal(block.findings.length, THEATER_DEFENCE_FINDING_LIMIT);
  assert.equal(block.findingsTotalCount, THEATER_DEFENCE_FINDING_LIMIT + 3);
  assert.equal(block.findingsOmittedCount, 3);
});

test('an unresolved destination is reported as unresolved, never as "none coming here"', () => {
  const block = buildTheaterDefence({
    military: militaryWorld({
      hostileMovement: {
        state: HOSTILE_MOVEMENT_STATE.partlyUnresolved,
        unresolvedDestinations: { transfers: 3, ships: 21 },
        towardTrackedTheaters: { transfers: 0, ships: 0 }
      }
    })
  });
  assert.equal(block.state, HOSTILE_MOVEMENT_STATE.partlyUnresolved);
  assert.ok(block.offBoardNote, 'the note is mandatory when destinations did not resolve');
  assert.ok(/could not be resolved/.test(block.offBoardNote), block.offBoardNote);
  assert.ok(block.offBoardNote.includes('3'), block.offBoardNote);
  assert.ok(block.findings.length > 0,
    'the resolved theaters are still advisable -- partly unresolved is not "advise nothing"');
});

test('hostile movement aimed off the twelve-body board is reported', () => {
  const block = buildTheaterDefence({
    military: militaryWorld({
      hostileMovement: {
        state: HOSTILE_MOVEMENT_STATE.inbound,
        towardUntrackedBodies: { transfers: 10, ships: 42 }
      }
    })
  });
  assert.ok(block.offBoardNote.includes('10'), block.offBoardNote);
  assert.ok(block.offBoardNote.includes('42'), block.offBoardNote);
  assert.ok(/does not track/.test(block.offBoardNote), block.offBoardNote);
});

test('a board with nothing off it has no off-board note to make', () => {
  assert.strictEqual(buildTheaterDefence({ military: militaryWorld() }).offBoardNote, null);
});

test('the notes say what this block deliberately does NOT do', () => {
  const block = buildTheaterDefence({ military: militaryWorld() });
  assert.ok(block.notes.some(note => /engagementModel/.test(note)),
    'the omitted force conversion must be stated, not silently absent');
  assert.ok(block.notes.some(note => /hate/i.test(note)),
    'the deliberately unimplemented hate inference must be stated');
});

test('the block reads no hate at all', () => {
  // "Hate is 25, so this fleet is probably not aimed at you" is the one
  // inference that can tell a player they are safe. It is a separate task, and
  // the output must not move when the hate reading does.
  const base = buildTheaterDefence({ military: militaryWorld() });
  const hot = buildTheaterDefence({
    military: militaryWorld({ hate: { actual: 500, redacted: false, threshold: 50, floor: 47 } })
  });
  const redacted = buildTheaterDefence({
    military: militaryWorld({ hate: { actual: null, redacted: true, threshold: 50, floor: null } })
  });
  assert.deepEqual(hot, base);
  assert.deepEqual(redacted, base);
});

test('yards at bodies the board does not track are reported, never folded into a theater', () => {
  const block = buildTheaterDefence({
    military: militaryWorld({
      shipyards: [
        { id: 1, factionId: OBSERVER, orbitBody: 'Mercury', spaceTheaterKey: 'inner', moduleTier: 3 },
        { id: 2, factionId: OBSERVER, orbitBody: 'Earth Orbit', spaceTheaterKey: 'unassigned', moduleTier: 2 },
        { id: 3, factionId: OBSERVER, orbitBody: 'Earth Orbit', spaceTheaterKey: 'unassigned', moduleTier: 2 }
      ],
      buildOptions: [
        { body: 'Mercury', hullName: 'Frigate', fastestDays: 18, shipyardId: 1, shipyardModuleTier: 3 },
        // Off-board yards must not win an on-board race.
        { body: 'Earth Orbit', hullName: 'Gunship', fastestDays: 2, shipyardId: 2, shipyardModuleTier: 2 }
      ]
    })
  });
  const finding = only(block);
  assert.equal(finding.buildRace.hullName, 'Frigate');
  assert.equal(finding.buildRace.buildDays, 18);
  assert.ok(block.notes.some(note => note.includes('Earth Orbit') && note.includes('2 ')),
    `expected the untracked yards to be reported; got ${JSON.stringify(block.notes)}`);
});

// ---------------------------------------------------------------------------
// Unavailable: an honest empty block, never mock findings
// ---------------------------------------------------------------------------

test('no military read-model means an unavailable block, not an empty-looking safe one', () => {
  for (const world of [{}, { military: null }, undefined]) {
    const block = buildTheaterDefence(world);
    assert.equal(block.available, false);
    assert.equal(block.unavailableReason, 'world.military was not supplied');
    assert.equal(block.state, null);
    assert.deepEqual(block.findings, []);
    assert.equal(block.findingsTotalCount, 0);
    assert.equal(block.findingsOmittedCount, 0);
    assert.equal(block.offBoardNote, null);
    assert.ok(block.notes.length > 0, 'even an unavailable block says what it does not do');
  }
});

test('an unavailable military read-model is carried through with its own reason', () => {
  const block = buildTheaterDefence({
    military: { available: false, unavailableReason: 'military-board-unavailable: boom' }
  });
  assert.equal(block.available, false);
  assert.ok(block.unavailableReason.includes('military-board-unavailable: boom'));
  assert.deepEqual(block.findings, []);
});

test('a military read-model with no theater board is unavailable, not silently empty', () => {
  const block = buildTheaterDefence({ military: militaryWorld({ theaters: [] }) });
  assert.equal(block.available, false);
  assert.ok(/theater board/.test(block.unavailableReason), block.unavailableReason);
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

test('runEngine carries theaterDefence, computed from the same frozen world', () => {
  for (const mode of MODES) {
    const military = fixtureMilitary(mode);
    const world = buildWorld({ observerId: OBSERVER, military });
    const result = runEngine(world);

    assert.ok(result.theaterDefence, `${mode}: the engine result must carry the block`);
    assert.equal(result.theaterDefence.available, true, mode);
    assert.deepEqual(result.theaterDefence, buildTheaterDefence(world), mode);
    // A sibling block, NOT a sixth candidate family: nothing about it may reach
    // the councilor-facing pipeline.
    assert.equal(
      result.cyclePlan.assignments.some(a => String(a.candidate?.id || '').startsWith('theater-defence:')),
      false,
      `${mode}: a build order has no councilor and must never enter the cycle plan`
    );
  }
});

test('runEngine on a world with no military reports the block unavailable', () => {
  const result = runEngine(buildWorld({ observerId: OBSERVER }));
  assert.equal(result.theaterDefence.available, false);
  assert.equal(result.theaterDefence.unavailableReason, 'world.military was not supplied');
});

// -----------------------------------------------------------------------------
// DELIBERATE-BREAK CHECK, run 2026-08-27.
//
// In `server/engine/theaterDefence.js`, `decidePosture` was edited so an inbound
// force with no arrival date fell through to the presence tests instead of
// refusing:
//
//     -  if (inbound && arrivalDays === null) return THEATER_POSTURE.cannotAdvise;
//     +  // if (inbound && arrivalDays === null) return THEATER_POSTURE.cannotAdvise;
//
// Result: "REFUSAL: an inbound force with no arrival date is CANNOT_ADVISE,
// never a posture" went red on its own -- the posture came back `WITHDRAW`,
// which is precisely the failure this block exists to prevent: an unevaluable
// imminence test answered with a confident recommendation. The edit was
// reverted and the suite is green again.
//
// THE FIRST RUN OF THIS CHECK PASSED, AND THAT WAS THE USEFUL RESULT.
// The original scenario gave the threatened body a shipyard. With a yard
// present and no measured build option, the NEXT check in `decidePosture`
// ("yards here, no measured build time") returned CANNOT_ADVISE anyway, and the
// imminence refusal itself is added in `buildFinding` rather than in
// `decidePosture` -- so all 32 tests stayed green with the imminence line
// commented out. The test was asserting the right outcome for the wrong reason.
// The scenario now holds NO yard at that body, which is the only arrangement in
// which the imminence line is load-bearing; the yards-present variant is kept
// as a separate test so both orderings stay covered.
//
// Note which tests did NOT move: every fixture-based one, because the committed
// fixture's inbound fleets all carry arrival dates. The hand-built military
// world with a null `nearestArrivalDays` and no yard is the only place the
// refusal is observable.
// -----------------------------------------------------------------------------
