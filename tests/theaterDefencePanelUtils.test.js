// tests/theaterDefencePanelUtils.test.js
//
// Purpose: the render decisions behind src/v2/panels/TheaterDefencePanel.jsx,
//   exercised under plain Node. This file NEVER mounts React -- that gap is what
//   tests/theaterDefenceRendering.test.js closes, and the two are deliberately
//   separate because a green utils file beside a mount that renders zero
//   characters is exactly what shipped when HostileMovementPanel carried an
//   unregistered DataTable variant.
//
// Named for the module it covers (theaterDefencePanelUtils.mjs) rather than for
// the panel: scripts/generate_code_index.js resolves a module's test file by
// EXACT basename, and `fs.existsSync` is case-insensitive on Windows but not on
// Linux -- so a file named after `TheaterDefencePanel` with a lowercase initial
// would index one way on this machine and another way in CI, failing the
// staleness guard somewhere nobody ran it.
//
// The assertions here are the three collapses the panel must not make:
//
//   1. `arrivalTimingKnown: null` (nothing inbound) and `arrivalTimingKnown:
//      false` (inbound, no date) are DIFFERENT claims and get different states.
//      A null flag beside an inbound or unreadable fleet count is a third case:
//      the flag was not read, which is not "nothing inbound".
//   2. `buildRace: null` on a quiet body is "no race applies"; on a threatened
//      body it is "the race could not be run", and the refusals say why.
//   3. An empty findings list with a positive `findingsTotalCount` means the cap
//      dropped everything -- never "no theater is at issue".
//
// Expected values were written from the block's documented contract in
// server/engine/theaterDefence.js BEFORE the panel existed, not captured from
// its output; a fixture taken from post-change output passes by construction.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  POSTURE_LABEL,
  POSTURE_ORDER,
  count,
  present,
  formatCount,
  formatDays,
  formatMargin,
  formatDate,
  contactReading,
  buildRaceReading,
  citationKey,
  sharedCitations,
  extraCitations,
  findingRows,
  postureCounts,
  truncationInfo,
  emptyReason,
  stateTokenFor,
  notesOf,
  describePanel
} = require('../src/v2/panels/theaterDefencePanelUtils.mjs');

// ---------------------------------------------------------------------------
// Builders. Deliberately explicit rather than deep-merged: a test fixture that
// silently inherits a field is how an assertion ends up proving the default.
// ---------------------------------------------------------------------------

const SHARED_CITATIONS = [
  { source: 'intel/theaters', field: 'incoming.hostileShips' },
  { source: 'intel/theaters', field: 'incoming.hostileFleets' },
  { source: 'intel/theaters', field: 'incoming.nearestArrivalDays' },
  { source: 'intel/theaters', field: 'incoming.arrivalTimingKnown' },
  { source: 'intel/theaters', field: 'hostile.ships' },
  { source: 'intel/theaters', field: 'friendly.ships' },
  { source: 'intel/theaters', field: 'friendly.shipyards' },
  { source: 'intel/theaters', field: 'production.shipsCompletingBeforeThreatArrival' },
  { source: 'intel/theaters', field: 'hostileMovement.reconciles' }
];

const RACE_CITATIONS = [
  { source: 'engine/military', field: 'buildOptions[].fastestDays' },
  { source: 'engine/military', field: 'buildOptions[].shipyardId' },
  { source: 'shared/shipBuildTime', field: 'buildBeatsArrival.verdict' }
];

function finding(overrides = {}) {
  return {
    id: 'theater-defence:mercury',
    body: 'Mercury',
    spaceTheaterKey: null,
    theaterStatus: 'THREAT_IMMINENT',
    posture: 'BUILD',
    threat: {
      hostileShips: 105,
      hostileFleets: 1,
      presentHostileShips: 24,
      presentHostileFleets: 17,
      nearestArrivalDays: 24,
      nearestArrivalDate: '2042-11-13T00:00:00.000Z',
      arrivalTimingKnown: true
    },
    friendly: {
      ships: 30,
      shipyards: 12,
      habs: 3,
      mines: 2,
      shipsCompletingBeforeThreatArrival: 0,
      completionBasis: 'measured against the nearest inbound arrival'
    },
    buildRace: {
      hullName: 'Gunship',
      shipyardId: 315317,
      available: true,
      verdict: 'build-lands-first',
      marginDays: 15,
      buildDays: 9,
      daysUntilArrival: 24,
      reason: null
    },
    refusals: [],
    citations: [...SHARED_CITATIONS, ...RACE_CITATIONS],
    ...overrides
  };
}

function quietFinding(overrides = {}) {
  return finding({
    id: 'theater-defence:earth',
    body: 'Earth',
    theaterStatus: 'CONTESTED',
    posture: 'HOLD',
    threat: {
      hostileShips: 0,
      hostileFleets: 0,
      presentHostileShips: 4,
      presentHostileFleets: 3,
      nearestArrivalDays: null,
      nearestArrivalDate: null,
      // null, NOT false: there is no timing to know because nothing is inbound.
      arrivalTimingKnown: null
    },
    friendly: {
      ships: 30,
      shipyards: 5,
      habs: 1,
      mines: 0,
      shipsCompletingBeforeThreatArrival: 0,
      completionBasis: 'measured against the nearest inbound arrival'
    },
    buildRace: null,
    refusals: [],
    citations: [...SHARED_CITATIONS],
    ...overrides
  });
}

function board(overrides = {}) {
  const findings = overrides.findings ?? [finding(), quietFinding()];
  return {
    available: true,
    unavailableReason: null,
    state: 'INBOUND_TO_TRACKED_THEATER',
    findingsTotalCount: findings.length,
    findingsOmittedCount: 0,
    offBoardNote: null,
    notes: ['No force-strength comparison is made here.'],
    ...overrides,
    findings
  };
}

// ---------------------------------------------------------------------------
// Absent stays null
// ---------------------------------------------------------------------------

test('count() refuses every non-finite reading rather than coercing it to zero', () => {
  for (const value of [null, undefined, '', '0', 'abc', NaN, Infinity, -Infinity, {}, []]) {
    assert.equal(count(value), null, `${JSON.stringify(value)} must not read as a number`);
    assert.equal(present(value), false, `${JSON.stringify(value)} must not read as present`);
  }
  assert.equal(count(0), 0, 'a measured zero is a reading, not an absence');
  assert.equal(present(0), true, 'a measured zero is present');
  assert.equal(count(-3.5), -3.5);
});

test('formatters say UNAVAILABLE for an unread number, never 0', () => {
  assert.equal(formatCount(null), 'UNAVAILABLE');
  assert.equal(formatDays(null), 'UNAVAILABLE');
  assert.equal(formatMargin(null), 'UNAVAILABLE');
  assert.equal(formatCount(0), '0');
  assert.equal(formatDays(1), '1 day');
  assert.equal(formatDays(24), '24 days');
  assert.equal(formatMargin(15), '+15 days');
  assert.equal(formatMargin(-4), '-4 days');
  assert.equal(formatMargin(1), '+1 day');
});

test('formatDate returns null for anything it cannot parse', () => {
  assert.equal(formatDate('2042-11-13T00:00:00.000Z'), '2042-11-13');
  for (const value of [null, undefined, '', '   ', 'not a date', 42]) {
    assert.equal(formatDate(value), null);
  }
});

// ---------------------------------------------------------------------------
// 1. Nothing inbound / arrival unknown / timing unread are three claims
// ---------------------------------------------------------------------------

test('nothing inbound reads as "nothing inbound", never as an unknown arrival time', () => {
  const reading = contactReading(quietFinding().threat);
  assert.equal(reading.state, 'nothing-inbound');
  assert.equal(reading.label, 'nothing inbound');
  assert.equal(reading.days, null);
  assert.notEqual(reading.label, 'arrival time unknown');
});

test('an inbound force with no date reads as an UNKNOWN arrival, not a distant one', () => {
  const reading = contactReading({
    hostileFleets: 2,
    hostileShips: 40,
    nearestArrivalDays: null,
    nearestArrivalDate: null,
    arrivalTimingKnown: false
  });
  assert.equal(reading.state, 'unknown');
  assert.equal(reading.label, 'arrival time unknown');
  assert.equal(reading.days, null, 'no stand-in day count may be invented for an unknown arrival');
});

test('a null timing flag beside an inbound or unreadable fleet count is UNREAD, not quiet', () => {
  const inbound = contactReading({ hostileFleets: 3, arrivalTimingKnown: null });
  assert.equal(inbound.state, 'unread');
  assert.equal(inbound.label, 'arrival timing not read');

  const unreadable = contactReading({ hostileFleets: null, arrivalTimingKnown: null });
  assert.equal(unreadable.state, 'unread', 'an unreadable fleet count is not a measured zero');

  const missingThreat = contactReading(undefined);
  assert.equal(missingThreat.state, 'unread');
});

test('a known arrival with no day count is UNREAD rather than rendered as zero days', () => {
  const reading = contactReading({
    hostileFleets: 1,
    arrivalTimingKnown: true,
    nearestArrivalDays: null
  });
  assert.equal(reading.state, 'unread');
  assert.equal(reading.days, null);
});

test('a measured arrival carries its day count and its date', () => {
  const reading = contactReading(finding().threat);
  assert.equal(reading.state, 'measured');
  assert.equal(reading.days, 24);
  assert.equal(reading.date, '2042-11-13');
});

// ---------------------------------------------------------------------------
// 2. "No race applies" and "the race could not be run" are different
// ---------------------------------------------------------------------------

test('a quiet body has no race to run; a threatened body with a null race could not run one', () => {
  const quiet = buildRaceReading(quietFinding());
  assert.equal(quiet.state, 'not-applicable');
  assert.match(quiet.label, /nothing inbound/);

  const threatened = buildRaceReading(finding({
    buildRace: null,
    refusals: [{ check: 'build-race', reason: 'the observer holds no shipyard at Mercury' }]
  }));
  assert.equal(threatened.state, 'not-run');
  assert.notEqual(threatened.state, quiet.state, 'the two null races must not render alike');
});

test('a race that ran carries its verdict AND the hull it was run against', () => {
  const race = buildRaceReading(finding());
  assert.equal(race.state, 'measured');
  assert.equal(race.verdict, 'build-lands-first');
  assert.equal(race.verdictLabel, 'BUILD LANDS FIRST');
  assert.equal(race.hullName, 'Gunship', 'a margin without its hull invites the wrong reading');
  assert.equal(race.shipyardId, 315317);
  assert.equal(race.buildDays, 9);
  assert.equal(race.daysUntilArrival, 24);
  assert.equal(race.marginDays, 15);
});

test('an unavailable race is refused with its reason, never scored as a loss', () => {
  const race = buildRaceReading(finding({
    buildRace: {
      hullName: null,
      shipyardId: null,
      available: false,
      verdict: null,
      marginDays: null,
      buildDays: null,
      daysUntilArrival: 24,
      reason: 'build time was not measured for any hull'
    }
  }));
  assert.equal(race.state, 'refused');
  assert.equal(race.verdict, null);
  assert.equal(race.verdictLabel, null);
  assert.equal(race.marginDays, null);
  assert.equal(race.reason, 'build time was not measured for any hull');
});

test('a verdict this panel does not recognise is named, not silently blanked', () => {
  const race = buildRaceReading(finding({
    buildRace: { ...finding().buildRace, verdict: 'photo-finish' }
  }));
  assert.equal(race.state, 'measured');
  assert.match(race.verdictLabel, /UNRECOGNISED VERDICT \(photo-finish\)/);
});

// ---------------------------------------------------------------------------
// 3. An empty list is not automatically an empty board
// ---------------------------------------------------------------------------

test('an empty findings list with a positive total says the cap dropped them all', () => {
  const message = emptyReason(board({ findings: [], findingsTotalCount: 14, findingsOmittedCount: 14 }));
  assert.match(message, /omitted by the block's own cap/);
  assert.doesNotMatch(message, /NO THEATER IS AT ISSUE/);
});

test('an empty findings list with a measured zero total says no theater is at issue', () => {
  const message = emptyReason(board({ findings: [], findingsTotalCount: 0, findingsOmittedCount: 0 }));
  assert.match(message, /NO THEATER IS AT ISSUE/);
});

test('an empty findings list with NO total says the question could not be answered', () => {
  const message = emptyReason(board({
    findings: [],
    findingsTotalCount: null,
    findingsOmittedCount: null
  }));
  assert.match(message, /could not be read/);
  assert.doesNotMatch(message, /NO THEATER IS AT ISSUE/);
});

test('truncationInfo keeps an unread count null instead of reporting nothing omitted', () => {
  const info = truncationInfo(board({ findingsTotalCount: null, findingsOmittedCount: undefined }));
  assert.equal(info.total, null);
  assert.equal(info.omitted, null);
  assert.equal(info.shown, 2);
});

// ---------------------------------------------------------------------------
// Rows, postures and the citation trail
// ---------------------------------------------------------------------------

test('findingRows carries every reading the row renders, with absences intact', () => {
  const rows = findingRows(board());
  assert.equal(rows.length, 2);

  const [mercury, earth] = rows;
  assert.equal(mercury.key, 'theater-defence:mercury');
  assert.equal(mercury.identityFallback, false);
  assert.equal(mercury.body, 'Mercury');
  assert.equal(mercury.postureLabel, 'BUILD');
  assert.equal(mercury.inboundFleets, 1);
  assert.equal(mercury.inboundShips, 105);
  assert.equal(mercury.presentFleets, 17);
  assert.equal(mercury.ourShipyards, 12);
  assert.equal(mercury.completing, 0, 'a measured zero completing before a real contact is a reading');
  assert.equal(mercury.race.state, 'measured');

  assert.equal(earth.completing, null,
    'a body with nothing inbound has no contact to complete before -- printing 0 would report a race never run');
  assert.equal(earth.race.state, 'not-applicable');
});

test('a finding with no usable id gets an index key and is flagged, never keyed on "undefined"', () => {
  const rows = findingRows(board({ findings: [finding({ id: null }), finding({ id: '   ' })] }));
  assert.equal(rows[0].key, 'theater-defence-row-0');
  assert.equal(rows[1].key, 'theater-defence-row-1');
  assert.notEqual(rows[0].key, rows[1].key, 'unresolvable identities must not collide');
  assert.ok(rows.every((row) => row.identityFallback === true));
});

test('postureCounts tallies in POSTURE_ORDER and counts unread postures separately', () => {
  const { rows, unrecognised } = postureCounts(board({
    findings: [
      finding(),
      quietFinding(),
      quietFinding({ id: 'theater-defence:luna', body: 'Luna' }),
      finding({ id: 'theater-defence:io', body: 'Io', posture: 'CANNOT_ADVISE' }),
      finding({ id: 'theater-defence:ceres', body: 'Ceres', posture: null })
    ]
  }));
  assert.deepEqual(rows.map((r) => [r.posture, r.count]), [
    ['BUILD', 1],
    ['HOLD', 2],
    ['CANNOT_ADVISE', 1]
  ]);
  assert.equal(unrecognised, 1, 'a finding with no posture is counted, not dropped');
  assert.equal(POSTURE_LABEL.CANNOT_ADVISE, 'CANNOT ADVISE');
  assert.equal(POSTURE_ORDER[POSTURE_ORDER.length - 1], 'CANNOT_ADVISE');
});

test('the shared basis is a real intersection and the row extras are the remainder', () => {
  const shared = sharedCitations(board());
  assert.equal(shared.length, 9);
  assert.ok(shared.includes('intel/theaters.hostileMovement.reconciles'));
  assert.ok(!shared.includes('shared/shipBuildTime.buildBeatsArrival.verdict'),
    'a reading only one row cites must never appear in the shared basis');

  const extras = extraCitations(finding(), shared);
  assert.deepEqual(extras, [
    'engine/military.buildOptions[].fastestDays',
    'engine/military.buildOptions[].shipyardId',
    'shared/shipBuildTime.buildBeatsArrival.verdict'
  ]);
  assert.deepEqual(extraCitations(quietFinding(), shared), []);
  assert.deepEqual(sharedCitations(board({ findings: [] })), [],
    'an intersection over no rows is empty, not universal');
});

test('a citation with no readable source or field is dropped and counted, not keyed on "undefined"', () => {
  assert.equal(citationKey({ source: 'a', field: 'b' }), 'a.b');
  for (const bad of [null, undefined, {}, { source: 'a' }, { field: 'b' }, { source: '', field: 'b' }]) {
    assert.equal(citationKey(bad), null);
  }
  const [row] = findingRows(board({
    findings: [finding({ citations: [{ source: 'intel/theaters', field: 'hostile.ships' }, {}, { source: 'x' }] })]
  }));
  assert.equal(row.citationCount, 1);
  assert.equal(row.citationsUnreadable, 2);
});

test('refusals ride on the row rather than being suppressed as an empty state', () => {
  const refusals = [
    { check: 'threat-imminence', reason: '2 inbound hostile fleet(s) carry no arrival date on record' },
    { check: 'build-race', reason: 'the observer holds no shipyard at Io' }
  ];
  const [row] = findingRows(board({
    findings: [finding({ posture: 'CANNOT_ADVISE', refusals })]
  }));
  assert.equal(row.refusals.length, 2);
  assert.equal(row.refusals[0].check, 'threat-imminence');
  assert.equal(row.postureLabel, 'CANNOT ADVISE');
});

// ---------------------------------------------------------------------------
// Top-level states
// ---------------------------------------------------------------------------

test('the four top-level states are distinguishable from one another', () => {
  assert.equal(stateTokenFor(null), 'UNAVAILABLE_READ');
  assert.equal(stateTokenFor(undefined), 'UNAVAILABLE_READ');
  assert.equal(stateTokenFor('not an object'), 'UNAVAILABLE_READ');
  assert.equal(
    stateTokenFor({ available: false, unavailableReason: 'world.military was not supplied' }),
    'UNAVAILABLE_BLOCK'
  );
  assert.equal(stateTokenFor(board({ state: null })), 'AVAILABLE_NO_MOVEMENT_STATE');
  assert.equal(stateTokenFor(board()), 'INBOUND TO TRACKED THEATER');
  assert.equal(stateTokenFor(board({ state: 'SOMETHING_NEW' })), 'UNKNOWN_STATE_SOMETHING_NEW');
});

test('notesOf never fabricates a note and never drops a real one', () => {
  assert.deepEqual(notesOf(null), []);
  assert.deepEqual(notesOf({ notes: 'not an array' }), []);
  assert.deepEqual(notesOf({ notes: ['a', '', null, 'b'] }), ['a', 'b']);
});

test('describePanel prints the refusals, the basis and the notes, in that order', () => {
  const lines = describePanel(board({
    findings: [
      finding(),
      quietFinding(),
      finding({
        id: 'theater-defence:io',
        body: 'Io',
        posture: 'CANNOT_ADVISE',
        buildRace: null,
        refusals: [{ check: 'build-race', reason: 'no measured build time at Io' }]
      })
    ],
    offBoardNote: '11 hostile transfer(s) are aimed at bodies this board does not track.'
  }));
  const text = lines.join('\n');

  assert.match(text, /STATE: INBOUND TO TRACKED THEATER/);
  assert.match(text, /ROW: Mercury \| BUILD .* margin \+15 days.*12 citation\(s\)/);
  assert.match(text, /ROW: Earth \| HOLD .* contact nothing inbound .* race no race — nothing inbound/);
  assert.match(text, /REFUSED build-race: no measured build time at Io/);
  assert.match(text, /BASIS: intel\/theaters\.incoming\.hostileShips/);
  assert.match(text, /OFF_BOARD: 11 hostile transfer\(s\)/);
  assert.match(text, /NOTE: No force-strength comparison/);

  assert.ok(
    text.indexOf('REFUSED build-race') < text.indexOf('BASIS:'),
    'the refusals belong to their row and must print above the section-level basis'
  );
});

test('an unavailable block renders its reason and its notes, never an empty board', () => {
  const lines = describePanel({
    available: false,
    unavailableReason: 'world.military was not supplied',
    state: null,
    findings: [],
    findingsTotalCount: 0,
    findingsOmittedCount: 0,
    offBoardNote: null,
    notes: ['No hate-based inference is made here.']
  });
  assert.match(lines[0], /THEATER DEFENCE UNAVAILABLE — world\.military was not supplied/);
  assert.match(lines[1], /NOTE: No hate-based inference/);
  assert.equal(lines.length, 2, 'an unavailable block must not print a findings table');
});

test('a block that could not be read at all differs from a block that reported itself unavailable', () => {
  const missing = describePanel(null).join('\n');
  const unavailable = describePanel({ available: false, unavailableReason: 'no theater board' }).join('\n');
  assert.notEqual(missing, unavailable);
  assert.match(missing, /the briefing did not carry the block/);
  assert.match(unavailable, /no theater board/);
});
