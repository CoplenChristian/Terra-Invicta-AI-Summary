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
  RECOMMENDATION_CHECKS,
  DELIVERY_VERDICTS,
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
        'friendly', 'buildRace', 'force', 'requiredDesignBuild', 'recommendation',
        'recommendationRefusal', 'refusals', 'citations']) {
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

// ---------------------------------------------------------------------------
// THE BUILD RECOMMENDATION, AND THE REFUSALS THAT DOMINATE IT
//
// "You have a 50-ship alien fleet inbound and 30 ships, so build X or retreat"
// is the sentence the whole feature was asked for. Every test below is about
// one of two things: the arithmetic when all five preconditions hold, or the
// named refusal when one of them does not.
//
// WHY SO MUCH OF THIS IS HAND-BUILT. The committed fixtures produce ZERO
// measured build options in both modes -- the observer faction they carry has
// no `shipConstructionSpeed` -- so no fixture row can ever reach the
// recommendation. That is the phase-2 lesson restated: a branch no real row
// exercises stays green however badly it is broken. The BUILD path, the
// band-comparison asymmetry and the wrong-hull refusal are therefore pinned
// against hand-built worlds, and the fixture tests own the shape and the
// player-mode gate.
// ---------------------------------------------------------------------------

/** A requirement object shaped exactly as `resolveRequirement` returns one. */
function requirementRow(overrides = {}) {
  return {
    verdict: 'band',
    reason: null,
    p20: 5,
    p80: 6,
    bandLabel: '5–6 hulls',
    hullsAtLeast: null,
    maxHullsSwept: 7,
    guaranteedWinAt: 6,
    isLowerBound: false,
    isEstimate: true,
    uncertainty: 'a simulated exchange, not a measurement',
    ...overrides
  };
}

function forceFleet(overrides = {}) {
  const { requirement, ...rest } = overrides;
  return {
    fleetId: 9001,
    fleetName: 'Alien Alpha',
    orbitBody: 'Mercury',
    shipsCount: 3,
    ratedShips: 3,
    unratedShips: 0,
    opponentRating: 90000,
    requirement: requirement === undefined ? requirementRow() : requirement,
    requirementUnavailableReason: null,
    calibrated: true,
    basis: 'omniscient basis string',
    calibrationCaveat: null,
    ...rest
  };
}

function forceRow(overrides = {}) {
  const { own = {}, opponent = {}, ...rest } = overrides;
  return {
    body: 'Mercury',
    own: {
      rating: 23739.7,
      ratedShips: 30,
      unratedShips: 0,
      source: 'the highest combat value among the observer\'s own ship designs',
      bestDesignName: 'Cimarron',
      bestHullName: 'Monitor',
      ...own
    },
    opponent: {
      rating: 148509,
      ratedShips: 3,
      unratedShips: 0,
      source: 'summed per-fleet opponent ratings',
      basis: 'omniscient basis string',
      ...opponent
    },
    opponentFleets: [forceFleet()],
    opponentFleetsCount: 1,
    opponentFleetsUnavailableReason: null,
    composedRequirement: null,
    composedRequirementReason: 'no body-level hull requirement is offered; the model sizes against ONE '
      + 'opposing rating and does not compose several',
    calibrated: true,
    isEstimate: true,
    available: true,
    unavailableReason: null,
    ...rest
  };
}

/**
 * A world where all five preconditions hold: a calibrated force row with a
 * band, a measured arrival, and a yard here that can lay down the required
 * design's OWN hull (`Monitor`). A `Gunship` option sits beside it precisely so
 * the tests can prove the wrong hull is never substituted for the right one.
 */
function recommendableWorld(overrides = {}) {
  return militaryWorld({
    theaters: [theaterRow({
      hostile: { ships: 5, fleets: 2, factions: ['the Aliens', 'the Servants'] }
    })],
    buildOptions: [
      {
        body: 'Mercury', spaceTheaterKey: 'inner', hullName: 'Monitor',
        fastestDays: 18, shipyardId: 315317, shipyardModuleTier: 3, yardsConsidered: 12
      },
      {
        body: 'Mercury', spaceTheaterKey: 'inner', hullName: 'Gunship',
        fastestDays: 9, shipyardId: 315317, shipyardModuleTier: 3, yardsConsidered: 12
      }
    ],
    theaterForce: [forceRow()],
    ...overrides
  });
}

const recommend = (world) => only(buildTheaterDefence({ military: world })).recommendation;
const refusal = (world) => only(buildTheaterDefence({ military: world })).recommendationRefusal;

// ---------------------------------------------------------------------------
// Never silence, and never both
// ---------------------------------------------------------------------------

test('every finding carries a recommendation OR a named refusal, in BOTH modes', () => {
  for (const mode of MODES) {
    const block = buildTheaterDefence({ military: fixtureMilitary(mode) });
    assert.ok(block.findings.length > 0, mode);
    for (const finding of block.findings) {
      const hasOne = finding.recommendation !== null;
      const hasOther = finding.recommendationRefusal !== null;
      assert.notEqual(hasOne, hasOther,
        `${mode}: ${finding.body} must carry exactly one of recommendation / recommendationRefusal, `
        + `got ${JSON.stringify({ hasOne, hasOther })}`);
      if (hasOther) {
        assert.ok(Object.values(RECOMMENDATION_CHECKS).includes(finding.recommendationRefusal.check),
          `${mode}: ${finding.body} refused under an unnamed check `
          + `${finding.recommendationRefusal.check}`);
        assert.ok(finding.recommendationRefusal.reason.length > 40,
          `${mode}: ${finding.body} refused without saying why`);
      }
    }
  }
});

test('a world carrying no theaterForce refuses BY NAME rather than falling silent', () => {
  // Every hand-built world above this section is exactly this case, so the
  // property is load-bearing for the whole file.
  const finding = only(buildTheaterDefence({ military: militaryWorld() }));
  assert.equal(finding.recommendation, null);
  assert.equal(finding.recommendationRefusal.check, RECOMMENDATION_CHECKS.forceReading);
  assert.match(finding.recommendationRefusal.reason, /no force row/);
  // The readings block still exists and says the reading is absent, rather than
  // reporting a rating of zero.
  assert.equal(finding.force.available, false);
  assert.strictEqual(finding.force.own, null);
  assert.strictEqual(finding.force.fleets, null);
  assert.notStrictEqual(finding.force.fleetsCount, 0);
});

// ---------------------------------------------------------------------------
// THE PLAYER-MODE REFUSAL. The mode the dashboard defaults to.
// ---------------------------------------------------------------------------

test('PLAYER MODE: every finding refuses on rating calibration, by name', () => {
  const block = buildTheaterDefence({ military: fixtureMilitary('player') });
  for (const finding of block.findings) {
    assert.equal(finding.recommendation, null, `${finding.body} must emit no recommendation`);
    assert.equal(finding.recommendationRefusal.check, RECOMMENDATION_CHECKS.ratingCalibration,
      `${finding.body}: calibration must be refused BEFORE any later check can produce a number`);
    assert.match(finding.recommendationRefusal.reason, /invented constants/);
    assert.match(finding.recommendationRefusal.reason, /9\.01x to 15\.65x/);
    assert.equal(finding.force.calibrated, false);
  }
});

test('PLAYER MODE: NO hull count survives anywhere in the emitted block', () => {
  // The redaction lesson, applied: scan the ENTIRE payload for the true values
  // rather than pinning one field. A leak through a field nobody thought to
  // check is exactly how the four player-mode leaks shipped.
  const military = fixtureMilitary('player');
  const json = JSON.stringify(buildTheaterDefence({ military }));

  for (const key of ['p20', 'p80', 'hullsAtLeast', 'bandLabel', 'guaranteedWinAt', 'maxHullsSwept',
    'serialDeliverableBeforeContact', 'shortfallAtLeast']) {
    assert.equal(json.includes(`"${key}"`), false,
      `player mode leaked the hull-count field ${key}`);
  }

  // And the VALUES, taken from the read-model the block was built from -- so
  // this cannot pass by the block having been given nothing to leak.
  const values = new Set();
  for (const row of military.theaterForce) {
    for (const fleet of row.opponentFleets ?? []) {
      const req = fleet.requirement;
      if (!req) continue;
      if (req.bandLabel) values.add(req.bandLabel);
    }
  }
  assert.ok(values.size > 0,
    'the player fixture must carry hull bands on its read-model, or this test proves nothing');
  for (const label of values) {
    assert.equal(json.includes(label), false, `player mode leaked the band label ${label}`);
  }
  // Nothing shaped like a hull count in prose either.
  assert.deepEqual(json.match(/[0-9]+[^"]{0,3}hulls?/gi) ?? [], []);
});

test('PLAYER MODE: the refusal still shows every reading it rests on', () => {
  // A refusal that hides its inputs is just an empty panel.
  const block = buildTheaterDefence({ military: fixtureMilitary('player') });
  const withFleets = block.findings.filter(f => (f.force.fleetsCount ?? 0) > 0);
  assert.ok(withFleets.length > 0, 'the player fixture must carry rated hostile fleets somewhere');

  for (const finding of withFleets) {
    for (const fleet of finding.force.fleets) {
      // The fleet is still listed, with its identity, its complement and its
      // provenance -- only the number is withheld.
      assert.ok(fleet.fleetId !== null || fleet.fleetName !== null, finding.body);
      assert.strictEqual(fleet.requirement, null, `${finding.body}: the band must be withheld`);
      assert.ok(fleet.requirementWithheldReason.includes('world.military.theaterForce'),
        `${finding.body}: withholding must say where the reading still lives`);
      assert.equal(fleet.calibrated, false);
      assert.ok(fleet.calibrationCaveat, `${finding.body}: the caveat rides on the row`);
      // Withheld is NOT the same as "the resource emitted none".
      assert.strictEqual(fleet.requirementUnavailableReason, null);
    }
    // The arrival clock and the build capacity are readings, not counts, so
    // they survive the gate.
    assert.ok('nearestArrivalDays' in finding.threat);
    assert.ok('unavailableReason' in finding.requiredDesignBuild);
    assert.ok('fastestDays' in finding.requiredDesignBuild);
  }
});

test('PLAYER MODE: an uncalibrated row refuses even when everything else holds', () => {
  // Mode-independent proof that the gate is the `calibrated` flag itself and
  // not a coincidence of what the player fixture happens to lack.
  const world = recommendableWorld({
    theaterForce: [forceRow({
      calibrated: false,
      opponentFleets: [forceFleet({ calibrated: false, calibrationCaveat: 'UNCALIBRATED. ...' })]
    })]
  });
  assert.equal(recommend(world), null);
  assert.equal(refusal(world).check, RECOMMENDATION_CHECKS.ratingCalibration);
  // And the band is withheld from the readings too, not merely from the advice.
  const finding = only(buildTheaterDefence({ military: world }));
  assert.strictEqual(finding.force.fleets[0].requirement, null);
  assert.ok(finding.force.fleets[0].requirementWithheldReason);
});

// ---------------------------------------------------------------------------
// THE RECOMMENDATION ITSELF
// ---------------------------------------------------------------------------

test('the recommendation names the DESIGN the count is denominated in', () => {
  const rec = recommend(recommendableWorld());
  assert.ok(rec, 'all five preconditions hold, so a recommendation must be emitted');
  assert.equal(rec.design.name, 'Cimarron');
  assert.equal(rec.design.hullName, 'Monitor');
  // The hull priced is the required design's own hull, NOT the faster Gunship
  // sitting beside it in buildOptions.
  assert.equal(rec.production.hullName, 'Monitor');
  assert.equal(rec.production.fastestDays, 18);
  assert.notEqual(rec.production.fastestDays, 9);
});

test('the arithmetic is the deadline over the build time, and 0 is a real answer', () => {
  const rec = recommend(recommendableWorld());
  // 57 days to contact, 18 days a hull, one serial line: 3.
  assert.equal(rec.deadline.nearestArrivalDays, 57);
  assert.equal(rec.production.serialDeliverableBeforeContact, 3);
  assert.equal(rec.production.landsBeforeContact, true);
  assert.equal(rec.production.marginDays, 39);

  // A hull slower than the deadline delivers NONE -- and that is the "or
  // retreat" half of the sentence, so it is a recommendation, not a refusal.
  const slow = recommendableWorld({
    buildOptions: [{
      body: 'Mercury', spaceTheaterKey: 'inner', hullName: 'Monitor',
      fastestDays: 90, shipyardId: 315317, shipyardModuleTier: 3, yardsConsidered: 12
    }]
  });
  const slowRec = recommend(slow);
  assert.ok(slowRec, 'nothing landing in time is an answer, not a missing reading');
  assert.equal(slowRec.production.serialDeliverableBeforeContact, 0);
  assert.equal(slowRec.production.landsBeforeContact, false);
  assert.equal(slowRec.perFleet[0].delivery.verdict, DELIVERY_VERDICTS.fallsShort);
});

test('a non-positive build time refuses rather than dividing by it', () => {
  const world = recommendableWorld({
    buildOptions: [{
      body: 'Mercury', spaceTheaterKey: 'inner', hullName: 'Monitor',
      fastestDays: 0, shipyardId: 315317, shipyardModuleTier: 3, yardsConsidered: 12
    }]
  });
  assert.equal(recommend(world), null);
  assert.equal(refusal(world).check, RECOMMENDATION_CHECKS.buildArithmetic);
});

test('the requirement is carried BY REFERENCE, never copied or recomputed', () => {
  const world = recommendableWorld();
  const source = world.theaterForce[0].opponentFleets[0].requirement;
  const finding = only(buildTheaterDefence({ military: world }));
  assert.strictEqual(finding.force.fleets[0].requirement, source,
    'the readings row must hand back the resource\'s own object');
  assert.strictEqual(finding.recommendation.perFleet[0].requirement, source,
    'the recommendation must hand back the resource\'s own object');
  // Register #13: nothing is flattened out of it on the way through.
  for (const key of ['p20', 'p80', 'bandLabel', 'isLowerBound', 'guaranteedWinAt', 'maxHullsSwept',
    'hullsAtLeast', 'verdict']) {
    assert.ok(key in finding.recommendation.perFleet[0].requirement, `${key} was dropped`);
  }
});

test('no body-level total is composed, and the refusal is carried with it', () => {
  const world = recommendableWorld({
    theaterForce: [forceRow({
      opponentFleets: [
        forceFleet({ fleetId: 1, fleetName: 'Alpha' }),
        forceFleet({ fleetId: 2, fleetName: 'Beta', requirement: requirementRow({ p20: 1, p80: 1 }) })
      ],
      opponentFleetsCount: 2
    })]
  });
  const rec = recommend(world);
  assert.strictEqual(rec.composedRequirement, null);
  assert.match(rec.composedRequirementReason, /does not compose/);
  assert.equal(rec.perFleet.length, 2, 'two fleets means two engagements, each priced on its own row');
});

// ---------------------------------------------------------------------------
// THE BAND ASYMMETRY. Falling short is safe to conclude; meeting is not.
// ---------------------------------------------------------------------------

test('a delivery below the band falls short, with a shortfall named "at least"', () => {
  const rec = recommend(recommendableWorld());          // 3 delivered against 5-6
  const delivery = rec.perFleet[0].delivery;
  assert.equal(delivery.verdict, DELIVERY_VERDICTS.fallsShort);
  assert.equal(delivery.shortfallAtLeast, 2);
  assert.equal(delivery.requirementIsLowerBound, false);
});

test('a FLOOR that the delivery clears is INDETERMINATE, never "meets"', () => {
  // This is register #13 in its most dangerous form: `beyond-modelled-range`
  // and an `isLowerBound` band both report a number the true requirement sits
  // ABOVE. Clearing it proves nothing, and reporting sufficiency would be the
  // exact flattening the split verdicts exist to prevent.
  for (const requirement of [
    requirementRow({
      verdict: 'beyond-modelled-range',
      reason: 'this fleet rates above what 24 of the observer\'s best hull can be modelled against',
      p20: null, p80: null, bandLabel: 'more than 24 hulls', hullsAtLeast: 2,
      maxHullsSwept: null, guaranteedWinAt: 400, isLowerBound: true
    }),
    requirementRow({ p20: 1, p80: 2, hullsAtLeast: 1, isLowerBound: true, bandLabel: 'at least 1-2 hulls' })
  ]) {
    const world = recommendableWorld({
      theaterForce: [forceRow({ opponentFleets: [forceFleet({ requirement })] })]
    });
    const delivery = recommend(world).perFleet[0].delivery;   // 3 delivered
    assert.equal(delivery.verdict, DELIVERY_VERDICTS.indeterminate,
      `a cleared floor must not read as sufficient (verdict ${requirement.verdict})`);
    assert.notEqual(delivery.verdict, DELIVERY_VERDICTS.meetsBand);
    assert.equal(delivery.requirementIsLowerBound, true);
    assert.match(delivery.reason, /floor/);
  }
});

test('a floor the delivery does NOT clear still falls short -- a floor only moves up', () => {
  const world = recommendableWorld({
    theaterForce: [forceRow({
      opponentFleets: [forceFleet({
        requirement: requirementRow({
          verdict: 'beyond-modelled-range', p20: null, p80: null,
          bandLabel: 'more than 24 hulls', hullsAtLeast: 25, isLowerBound: true, guaranteedWinAt: 400
        })
      })]
    })]
  });
  const delivery = recommend(world).perFleet[0].delivery;
  assert.equal(delivery.verdict, DELIVERY_VERDICTS.fallsShort);
  assert.equal(delivery.shortfallAtLeast, 22);
});

test('`winnable: false` is never synthesised and no verdict is re-labelled', () => {
  const world = recommendableWorld({
    theaterForce: [forceRow({
      opponentFleets: [forceFleet({
        requirement: requirementRow({
          verdict: 'beyond-modelled-range', p20: null, p80: null,
          bandLabel: 'more than 24 hulls', hullsAtLeast: 25, isLowerBound: true, guaranteedWinAt: 400
        })
      })]
    })]
  });
  const json = JSON.stringify(buildTheaterDefence({ military: world }));
  assert.equal(json.includes('"winnable"'), false);
  assert.equal(json.includes('not-winnable'), false);
  assert.equal(recommend(world).perFleet[0].requirement.verdict, 'beyond-modelled-range');
});

test('a delivery at or above the band top meets it, and says the band is an estimate', () => {
  const world = recommendableWorld({
    theaterForce: [forceRow({
      opponentFleets: [forceFleet({ requirement: requirementRow({ p20: 1, p80: 2, bandLabel: '1-2 hulls' }) })]
    })]
  });
  const delivery = recommend(world).perFleet[0].delivery;   // 3 delivered against 1-2
  assert.equal(delivery.verdict, DELIVERY_VERDICTS.meetsBand);
  assert.match(delivery.reason, /not a guarantee/);
});

test('a delivery inside the band says the band is exactly what is uncertain', () => {
  const world = recommendableWorld({
    theaterForce: [forceRow({
      opponentFleets: [forceFleet({ requirement: requirementRow({ p20: 2, p80: 5, bandLabel: '2-5 hulls' }) })]
    })]
  });
  const delivery = recommend(world).perFleet[0].delivery;   // 3 delivered against 2-5
  assert.equal(delivery.verdict, DELIVERY_VERDICTS.withinBand);
});

test('fleets whose requirement resolved to no count are OMITTED WITH A COUNT, not dropped', () => {
  const world = recommendableWorld({
    theaterForce: [forceRow({
      opponentFleets: [
        forceFleet({ fleetId: 1, fleetName: 'Alpha' }),
        forceFleet({
          fleetId: 2,
          fleetName: 'Beta',
          requirement: requirementRow({
            verdict: 'withheld-unreachable', reason: 'the observer cannot reach this engagement',
            p20: null, p80: null, bandLabel: null, guaranteedWinAt: null, maxHullsSwept: null
          })
        })
      ],
      opponentFleetsCount: 2
    })]
  });
  const rec = recommend(world);
  assert.equal(rec.perFleet.length, 1);
  assert.equal(rec.perFleetTotalCount, 2);
  assert.equal(rec.perFleetOmittedCount, 1);
  assert.ok(rec.perFleetOmittedReason, 'a capped list must announce exactly what it dropped');
  // The omitted fleet is still visible in the readings with its own verdict.
  const finding = only(buildTheaterDefence({ military: world }));
  assert.equal(finding.force.fleets.length, 2);
  assert.equal(finding.force.fleets[1].requirement.verdict, 'withheld-unreachable');
});

test('a body where NO fleet resolved a count refuses -- an unresolved need is not a small one', () => {
  const world = recommendableWorld({
    theaterForce: [forceRow({
      opponentFleets: [forceFleet({
        requirement: requirementRow({ verdict: 'unknown', reason: 'no opponent rating', p20: null, p80: null })
      })]
    })]
  });
  assert.equal(recommend(world), null);
  assert.equal(refusal(world).check, RECOMMENDATION_CHECKS.hullRequirement);
  assert.match(refusal(world).reason, /not a small one/);
});

test('a body with NO rated hostile fleet refuses, and says that is not "nothing is needed"', () => {
  const world = recommendableWorld({
    theaterForce: [forceRow({ opponentFleets: [], opponentFleetsCount: 0 })]
  });
  assert.equal(recommend(world), null);
  const check = refusal(world);
  assert.equal(check.check, RECOMMENDATION_CHECKS.hullRequirement);
  assert.match(check.reason, /NOT "nothing is needed here"/);
});

test('an unnamed design refuses: a hull count with no unit is not a hull count', () => {
  const world = recommendableWorld({
    theaterForce: [forceRow({ own: { bestDesignName: null, bestHullName: null } })]
  });
  assert.equal(recommend(world), null);
  assert.equal(refusal(world).check, RECOMMENDATION_CHECKS.hullRequirement);
  assert.match(refusal(world).reason, /Gunship as a Battlecruiser/);
});

// ---------------------------------------------------------------------------
// THE DOMINANT REAL CASE: no yard here. Measured on the live save 2026-08-27 --
// buildOptions is EMPTY for Callisto, the body with the largest requirement on
// the board.
// ---------------------------------------------------------------------------

test('NO YARD HERE is a measured absence of capacity, not an unmeasured build time', () => {
  const world = recommendableWorld({ shipyards: [], buildOptions: [], buildRefusals: [] });
  const check = refusal(world);
  assert.equal(check.check, RECOMMENDATION_CHECKS.buildCapacity);
  assert.match(check.reason, /measured absence of build capacity, not an unmeasured build time/);
});

test('NO YARD HERE never points at another body\'s shipyard', () => {
  // Reinforcement from elsewhere is a transit problem and nothing in this
  // system models transit time, so naming a yard at Mars for a threat at
  // Mercury would imply a delivery this model cannot promise.
  const world = recommendableWorld({
    shipyards: [{ id: 88, orbitBody: 'Mars', spaceTheaterKey: 'mars', moduleTier: 4 }],
    buildOptions: [{
      body: 'Mars', spaceTheaterKey: 'mars', hullName: 'Monitor',
      fastestDays: 4, shipyardId: 88, shipyardModuleTier: 4, yardsConsidered: 6
    }]
  });
  const finding = only(buildTheaterDefence({ military: world }));
  assert.equal(finding.recommendation, null, 'a yard at Mars must not answer for a threat at Mercury');
  assert.equal(finding.recommendationRefusal.check, RECOMMENDATION_CHECKS.buildCapacity);
  assert.equal(finding.recommendationRefusal.reason.includes('Mars'), false,
    'the refusal must not name another body\'s yard');
  assert.match(finding.recommendationRefusal.reason, /transit/);
  assert.equal(finding.requiredDesignBuild.available, false);
  assert.strictEqual(finding.requiredDesignBuild.fastestDays, null);
  assert.notStrictEqual(finding.requiredDesignBuild.fastestDays, 0);
});

test('a body that can build SOMETHING but not the required hull refuses, without substituting', () => {
  const world = recommendableWorld({
    buildOptions: [{
      body: 'Mercury', spaceTheaterKey: 'inner', hullName: 'Gunship',
      fastestDays: 9, shipyardId: 315317, shipyardModuleTier: 3, yardsConsidered: 12
    }],
    buildRefusals: [{ body: 'Mercury', hullName: 'Monitor', reason: 'hull-not-shipyard-buildable' }]
  });
  const check = refusal(world);
  assert.equal(check.check, RECOMMENDATION_CHECKS.buildCapacity);
  assert.match(check.reason, /hull-not-shipyard-buildable/);
  assert.match(check.reason, /no exchange rate between hull types/);
  assert.equal(check.reason.includes('Gunship'), false,
    'the hull the body CAN build must never be offered in place of the one it cannot');
});

// ---------------------------------------------------------------------------
// The deadline
// ---------------------------------------------------------------------------

test('the three no-deadline cases are three DIFFERENT refusals', () => {
  const nothingInbound = recommendableWorld({
    theaters: [theaterRow({
      hostile: { ships: 5, fleets: 2, factions: ['the Aliens'] },
      incoming: { hostileFleets: 0, hostileShips: 0, nearestArrivalDays: null,
        nearestArrivalDate: null, arrivalTimingKnown: null }
    })]
  });
  assert.match(refusal(nothingInbound).reason, /nothing is inbound/);
  assert.equal(refusal(nothingInbound).check, RECOMMENDATION_CHECKS.arrivalClock);
  // "contact is now" is a deadline this board does not invent.
  assert.equal(recommend(nothingInbound), null);

  const inboundUnknownDate = recommendableWorld({
    theaters: [theaterRow({
      hostile: { ships: 5, fleets: 2, factions: ['the Aliens'] },
      incoming: { nearestArrivalDays: null, nearestArrivalDate: null, arrivalTimingKnown: false }
    })]
  });
  assert.match(refusal(inboundUnknownDate).reason, /an unknown arrival is not a distant one/);

  const unreadableCount = recommendableWorld({
    theaters: [theaterRow({
      hostile: { ships: 5, fleets: 2, factions: ['the Aliens'] },
      incoming: { hostileFleets: null, nearestArrivalDays: null, nearestArrivalDate: null }
    })]
  });
  assert.match(refusal(unreadableCount).reason, /an unreadable count is not a zero/);
});

test('the deadline says which force it belongs to, and it is not the one being sized', () => {
  // The clock comes from the fleets INBOUND to this body; the requirements come
  // from fleets already HERE. Two different objects, and conflating them would
  // read as "these hulls beat the thing that is coming".
  const rec = recommend(recommendableWorld());
  assert.match(rec.deadline.source, /INBOUND/);
  assert.match(rec.deadline.source, /ALREADY PRESENT/);
});

// ---------------------------------------------------------------------------
// Coverage: two counts that must never be subtracted
// ---------------------------------------------------------------------------

test('the board\'s hostile count and the rated fleet count are carried, never differenced', () => {
  const rec = recommend(recommendableWorld());
  assert.equal(rec.coverage.ratedHostileFleets, 1);
  assert.equal(rec.coverage.boardHostileFleetsPresent, 2);
  assert.equal(rec.coverage.countsAreComparable, false);
  assert.deepEqual(rec.coverage.boardHostileFactions, ['the Aliens', 'the Servants']);
  assert.match(rec.coverage.note, /must not be subtracted/);
  // No field anywhere holds the difference.
  assert.equal(JSON.stringify(rec.coverage).includes('unrated'), false);
});

test('the omniscient fixture measures the coverage gap it warns about', () => {
  // Not a hypothetical: the board counts every hostile faction and the force
  // model rates only the aliens, so Mars carries 10 hostile fleets and 0 rated
  // ones. If these two ever start agreeing everywhere, the warning is stale.
  const block = buildTheaterDefence({ military: fixtureMilitary('omniscient') });
  const gaps = block.findings.filter(
    f => f.force.coverage.boardHostileFleetsPresent !== f.force.coverage.ratedHostileFleets
  );
  assert.ok(gaps.length > 0,
    'the fixture must still exhibit a coverage gap, or the note describes nothing');
  for (const finding of block.findings) {
    assert.equal(finding.force.coverage.countsAreComparable, false, finding.body);
  }
});

// ---------------------------------------------------------------------------
// The postures are untouched by all of the above
// ---------------------------------------------------------------------------

test('the recommendation layer never changes a posture', () => {
  for (const mode of MODES) {
    const military = fixtureMilitary(mode);
    const withForce = buildTheaterDefence({ military });
    const withoutForce = buildTheaterDefence({ military: { ...military, theaterForce: [] } });
    assert.deepEqual(
      withForce.findings.map(f => `${f.body}:${f.posture}`),
      withoutForce.findings.map(f => `${f.body}:${f.posture}`),
      `${mode}: decidePosture must not read the force model`
    );
  }
});

test('the first note tracks whether a band was actually carried', () => {
  // Leaving "no force-strength comparison is made here" standing beside a
  // carried band would be a false statement in the output.
  const player = buildTheaterDefence({ military: fixtureMilitary('player') });
  const omniscient = buildTheaterDefence({ military: fixtureMilitary('omniscient') });
  assert.match(player.notes[0], /^No force-strength comparison is made here/);
  assert.match(omniscient.notes[0], /^The POSTURES rest on the production race/);
  assert.match(omniscient.notes[0], /never "cannot be won"/);
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

// -----------------------------------------------------------------------------
// DELIBERATE-BREAK CHECK #2, run 2026-08-27 — the build recommendation.
//
// Three lines were broken one at a time in `server/engine/theaterDefence.js`,
// each restored before the next. The third is the interesting one.
//
// BREAK 1 — the player-mode WITHHOLDING gate in `projectFleetRow`:
//
//     -  const withheld = calibrated !== true && requirement !== null;
//     +  const withheld = false;
//
// Result: 4 unit tests red and 1 live test red. "PLAYER MODE: NO hull count
// survives anywhere in the emitted block" caught it on both the field names and
// the band-label VALUES; "the refusal still shows every reading it rests on"
// caught the requirement no longer being null; and "the first note tracks
// whether a band was actually carried" caught the note flipping to the
// band-carried wording in player mode. That last one was unplanned and is the
// best evidence the note condition is real rather than decorative.
//
// BREAK 2 — the calibration gate in `buildRecommendation`:
//
//     -  if (force.calibrated !== true) {
//     +  if (false && force.calibrated !== true) {
//
// Result: 2 unit tests red, 1 live test red. Note that the two gates are
// INDEPENDENT — break 2 alone leaks no numbers, because `projectFleetRow` still
// withholds them; break 1 alone emits no recommendation, because the gate still
// refuses. Both had to be pinned separately, and each break proved the other
// test was not covering it.
//
// BREAK 3 — the lower-bound guard in `compareDelivery`, and THE ONE THAT
// MATTERED MOST:
//
//     -  if (isLowerBound) {
//     +  if (false && isLowerBound) {
//
// Result: exactly ONE test red — "a FLOOR that the delivery clears is
// INDETERMINATE, never 'meets'" — and the ENTIRE LIVE SUITE STAYED GREEN. That
// is the phase-2 lesson reproduced on purpose: no row on the committed
// fixtures and no row on the current save reaches a recommendation at all
// (`buildOptions` is empty for every threatened body in both), so every branch
// past check 4 is exercised only by hand-built worlds. Had the band comparison
// been pinned against fixtures alone, flattening a floor into "sufficient" —
// defect #13, in the form that tells a player they have enough hulls when they
// do not — would have shipped green.
//
// All three were reverted; `server/engine/theaterDefence.js` was diffed
// byte-identical against its pre-break copy, and the suite is green again.
// -----------------------------------------------------------------------------
