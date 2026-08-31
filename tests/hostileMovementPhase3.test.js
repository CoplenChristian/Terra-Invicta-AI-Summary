// tests/hostileMovementPhase3.test.js
//
// Phase 3 surface area for the whole-board hostile movement summary:
//   * src/v2/panels/HostileMovementPanel.jsx renders four distinct states
//     where NONE_TOWARD_TRACKED_THEATERS and NO_HOSTILE_MOVEMENT_OBSERVED must
//     not collapse into one another -- if those two render alike, the feature
//     has failed regardless of what else passes.
//   * shared/markdownExports.mjs surfaces the same summary on the AI exports
//     (single-line headline on /latest-threats.md; embedded block on
//     /latest-war-room.md section 1b), staying under the war-room 30,720-byte
//     ceiling.
//   * An absent `hostileMovement` field on the payload renders as
//     "measurement was not read", never as "0/0 movement".
//
// THE DELIBERATE BREAK (run 2026-08-26). To prove the collapse guard:
// `hostileMovementPanelUtils.mjs` was temporarily edited to drop the
// PARTLY_UNRESOLVED branch and make STATE_LABEL fall through to a single
// short label. The `the four state renderings produce four distinct
// strings (the collapse guard)` test below turned RED on
// notStrictEqual between the no-movement and the off-board renderings.
// The original code was restored. If a future refactor collapses any two
// states onto one rendering, that test -- and only that test -- catches it.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  HOSTILE_MOVEMENT_STATE,
  theaterBoardResource
} = require('../shared/intelResources.mjs');

const {
  hostileMovementBlock,
  hostileMovementLine,
  renderThreatsMarkdown,
  renderWarRoomMarkdown,
  utf8ByteLength,
  WAR_ROOM_BYTE_BUDGET
} = require('../shared/markdownExports.mjs');

const {
  STATE_LABEL,
  stateTokenFor,
  describePanel,
  destinationRows,
  truncationInfo,
  summaryCells,
  formatCount,
  formatDays
} = require('../src/v2/panels/hostileMovementPanelUtils.mjs');

const OBSERVER = 4712;
const ALIEN = 4717;

function makeSnapshot({ factions = [], fleets = [], habs = [] } = {}) {
  return {
    metadata: { gameTimeString: '5/1/2033 12:00:00 AM' },
    observerFactionId: OBSERVER,
    mode: 'player',
    factions,
    fleets,
    habs,
    habSites: [],
    shipyardStations: [],
    shipyardQueues: [],
    shipDesigns: []
  };
}

function alienFaction() {
  return [{ ID: ALIEN, displayName: 'Aliens', templateName: 'AlienConspiracy' }];
}

function alienFleet(overrides) {
  return {
    ID: 900, displayName: 'Victor-84', factionId: ALIEN, factionName: 'Aliens',
    orbitBody: 'Sol', currentOrders: 'Transfer',
    ...overrides
  };
}

const fixtureNoMovement = () => makeSnapshot({ factions: alienFaction() });

const fixtureHostileOffBoard = () => makeSnapshot({
  factions: alienFaction(),
  fleets: [
    alienFleet({
      ID: 900, displayName: 'Victor-84', shipsCount: 5,
      destination: 'Iron Fortress Station', destinationType: 'hab', destinationId: 23484
    }),
    alienFleet({
      ID: 901, displayName: 'Victor-886', shipsCount: 1,
      destination: 'Triton orbit', destinationType: 'orbit'
    })
  ],
  habs: [{ ID: 23484, displayName: 'Iron Fortress Station', factionId: ALIEN, orbitBody: '16 Psyche' }]
});

const fixtureHostileUnresolved = () => {
  const snap = fixtureHostileOffBoard();
  snap.fleets.push(alienFleet({
    ID: 902, displayName: 'Victor-999', shipsCount: 4,
    destination: 'Ghost Station', destinationType: 'hab', destinationId: 999
  }));
  return snap;
};

const fixtureHostileInbound = () => {
  const snap = fixtureHostileOffBoard();
  snap.habs.push({ ID: 55, displayName: 'Perimeter Station', factionId: ALIEN, orbitBody: 'Mercury' });
  snap.fleets.push(alienFleet({
    ID: 903, displayName: 'Victor-77', shipsCount: 9,
    destination: 'Perimeter Station', destinationType: 'hab', destinationId: 55
  }));
  return snap;
};

function panelSnapshot(data) {
  // What the panel renders, as plain text. Used by the collapse guards so
  // the test does not need to bring the vite bundle into Node.
  return JSON.stringify({
    token: stateTokenFor(data),
    description: describePanel(data)
  });
}

// ---------------------------------------------------------------------------
// 1. Four-state mapping in the panel.
// ---------------------------------------------------------------------------

test('the panel renders NO_HOSTILE_MOVEMENT_OBSERVED distinctly from the off-board state', () => {
  const noMove = theaterBoardResource(fixtureNoMovement(), OBSERVER).hostileMovement;
  const offBoard = theaterBoardResource(fixtureHostileOffBoard(), OBSERVER).hostileMovement;
  assert.strictEqual(noMove.state, HOSTILE_MOVEMENT_STATE.none);
  assert.strictEqual(offBoard.state, HOSTILE_MOVEMENT_STATE.elsewhere);
  assert.notStrictEqual(noMove.state, offBoard.state,
    'an empty theater table would otherwise render these two identically');

  const noMoveRender = panelSnapshot(noMove);
  const offBoardRender = panelSnapshot(offBoard);
  assert.notStrictEqual(noMoveRender, offBoardRender,
    'NO_HOSTILE_MOVEMENT_OBSERVED and HOSTILE_MOVEMENT_NONE_TOWARD_TRACKED_THEATERS render identically');
  assert.strictEqual(stateTokenFor(noMove), STATE_LABEL[HOSTILE_MOVEMENT_STATE.none]);
  assert.strictEqual(stateTokenFor(offBoard), STATE_LABEL[HOSTILE_MOVEMENT_STATE.elsewhere]);
});

test('the panel renders PARTLY_UNRESOLVED distinctly from the off-board state', () => {
  const offBoard = theaterBoardResource(fixtureHostileOffBoard(), OBSERVER).hostileMovement;
  const unresolved = theaterBoardResource(fixtureHostileUnresolved(), OBSERVER).hostileMovement;

  assert.strictEqual(offBoard.state, HOSTILE_MOVEMENT_STATE.elsewhere);
  assert.strictEqual(unresolved.state, HOSTILE_MOVEMENT_STATE.partlyUnresolved);
  assert.notStrictEqual(offBoard.state, unresolved.state,
    'with a destination the resolver could not name, "none of it is aimed at a tracked theater" is not a claim the data supports');

  const offRender = panelSnapshot(offBoard);
  const unresolvedRender = panelSnapshot(unresolved);
  assert.notStrictEqual(offRender, unresolvedRender,
    'PARTLY_UNRESOLVED must render distinctly from the off-board state');

  const unresolvedDesc = describePanel(unresolved).join('\n');
  assert.match(unresolvedDesc, /could not be resolved|UNRESOLVED/);
});

test('the panel renders INBOUND_TO_TRACKED_THEATER distinctly from the off-board state', () => {
  const offBoard = theaterBoardResource(fixtureHostileOffBoard(), OBSERVER).hostileMovement;
  const inbound = theaterBoardResource(fixtureHostileInbound(), OBSERVER).hostileMovement;
  assert.strictEqual(offBoard.state, HOSTILE_MOVEMENT_STATE.elsewhere);
  assert.strictEqual(inbound.state, HOSTILE_MOVEMENT_STATE.inbound);

  const offRender = panelSnapshot(offBoard);
  const inbRender = panelSnapshot(inbound);
  assert.notStrictEqual(offRender, inbRender,
    'INBOUND must render distinctly from the off-board state');
});

test('the four state renderings produce four distinct strings (the collapse guard)', () => {
  // If a future refactor collapses any two states onto one rendering, this
  // test fails on the notStrictEqual pair -- not on the labels, on the
  // *string* the panel emits.
  const states = [
    fixtureNoMovement(),
    fixtureHostileOffBoard(),
    fixtureHostileUnresolved(),
    fixtureHostileInbound()
  ].map(snap => theaterBoardResource(snap, OBSERVER).hostileMovement);

  const renderings = states.map(movement => panelSnapshot(movement));
  for (let i = 0; i < renderings.length; i++) {
    for (let j = i + 1; j < renderings.length; j++) {
      assert.notStrictEqual(
        renderings[i], renderings[j],
        `states ${states[i].state} and ${states[j].state} render identically`
      );
    }
  }
});

test('an absent data payload renders as unavailable, not as no-movement', () => {
  for (const data of [null, undefined, {}, { observed: { transfers: 0, ships: 0 } }]) {
    const token = stateTokenFor(data);
    assert.match(token, /UNAVAILABLE/);
    assert.notStrictEqual(token, STATE_LABEL[HOSTILE_MOVEMENT_STATE.none],
      'an absent read must not claim "no hostile movement observed"');
  }
});

test('nearestArrivalDays: null renders as unknown, never as 0', () => {
  const snap = makeSnapshot({
    factions: alienFaction(),
    fleets: [alienFleet({
      ID: 900, displayName: 'Victor-84', shipsCount: 5, arrivalDate: null,
      destination: 'Triton orbit', destinationType: 'orbit'
    })]
  });
  const movement = theaterBoardResource(snap, OBSERVER).hostileMovement;
  assert.strictEqual(movement.nearestArrivalDays, null,
    'an absent arrival date is not a distant one');

  const desc = describePanel(movement).join('\n');
  assert.match(desc, /ETA unknown/);
  assert.doesNotMatch(desc, /0 day\(s\)/,
    'a null nearest arrival must not render as 0 days remaining');
});

test('destinationRows joins via hops and surfaces unresolved destinations', () => {
  const offBoard = theaterBoardResource(fixtureHostileUnresolved(), OBSERVER).hostileMovement;
  const rows = destinationRows(offBoard);
  // The fixture's three fleets all resolve to bodies outside the 12 tracked
  // theaters, so all rows must carry the "(untracked)" suffix and none must
  // carry "(tracked)". One row, for Ghost Station, must be unresolved.
  assert.ok(rows.length >= 3, 'three off-board rows visible');
  for (const row of rows) {
    if (row.resolvedLabel.includes('unresolved')) continue;
    assert.match(row.resolvedLabel, /\(untracked\)/);
  }
  const ghostRow = rows.find(r => r.resolvedLabel.startsWith('unresolved'));
  assert.ok(ghostRow, 'an unresolved destination surfaces with an "unresolved" label');
  const truncation = truncationInfo(offBoard);
  assert.strictEqual(typeof truncation.total, 'number');
});

test('summaryCells exposes measured counts the panel can render', () => {
  const offBoard = theaterBoardResource(fixtureHostileOffBoard(), OBSERVER).hostileMovement;
  const cells = summaryCells(offBoard);
  assert.deepStrictEqual(cells.observed, offBoard.observed);
  assert.deepStrictEqual(cells.toward, offBoard.towardTrackedTheaters);
  assert.deepStrictEqual(cells.untracked, offBoard.towardUntrackedBodies);
  assert.deepStrictEqual(cells.unresolved, offBoard.unresolvedDestinations);
});

test('string helpers use the shared resolveValue contract for null and zero', () => {
  assert.strictEqual(formatCount(0), '0', 'a measured zero must stay measured');
  assert.strictEqual(formatCount(null), '—', 'an absent count must use the shared affordance');
  assert.strictEqual(formatDays(1), '1 day');
  assert.strictEqual(formatDays(null), '—', 'an absent ETA must use the shared affordance');

  const description = describePanel({
    state: HOSTILE_MOVEMENT_STATE.none,
    observed: { transfers: null, ships: 0 },
  }).join('\n');
  assert.match(description, /OBSERVED: — transfer\(s\), 0 ship\(s\)/,
    'describePanel must not turn a missing transfer count into zero');

  const [row] = destinationRows({
    offBoardDestinations: [{ fleet: null, statedDestination: null, via: [] }],
  });
  assert.strictEqual(row.fleet, '—');
  assert.strictEqual(row.fleetPresent, false);
  assert.strictEqual(row.viaText, '—');
  assert.strictEqual(row.viaPresent, false);
});

// ---------------------------------------------------------------------------
// 2. Markdown exports.
// ---------------------------------------------------------------------------

test('the threat export headline reads each of the four states distinctly', () => {
  const noneLine = hostileMovementLine(fixtureNoMovement());
  const offLine = hostileMovementLine(fixtureHostileOffBoard());
  const unresolvedLine = hostileMovementLine(fixtureHostileUnresolved());
  const inboundLine = hostileMovementLine(fixtureHostileInbound());

  assert.match(noneLine, /NO HOSTILE MOVEMENT OBSERVED/);
  assert.match(offLine, /HOSTILE MOVEMENT — NONE TOWARD TRACKED THEATERS/);
  assert.match(unresolvedLine, /HOSTILE MOVEMENT — DESTINATIONS PARTLY UNRESOLVED/);
  assert.match(inboundLine, /INBOUND TO TRACKED THEATER/);

  const lines = [noneLine, offLine, unresolvedLine, inboundLine];
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      assert.notStrictEqual(lines[i], lines[j],
        `state lines for states ${i} and ${j} are identical`);
    }
  }

  // The off-board case carries 2 transfers and must NOT report no movement.
  assert.match(offLine, /2 hostile transfer/);
  assert.doesNotMatch(offLine, /NO HOSTILE MOVEMENT OBSERVED/);
});

test('the threat export prints the whole-board hostile movement headline under the title', () => {
  const md = renderThreatsMarkdown(fixtureHostileOffBoard());
  assert.match(md, /\*\*Hostile Movement \(Whole-Board\)[^\n]*\*\*/,
    'the threats export must include the whole-board hostile-movement headline in the title block');
  assert.match(md, /HOSTILE MOVEMENT — NONE TOWARD TRACKED THEATERS/);
});

test('the war room embeds a hostile-movement block in section 1b', () => {
  const md = renderWarRoomMarkdown(fixtureHostileOffBoard());
  assert.match(md, /## 1b\. Hostile Movement \(Whole-Board\)/,
    'the war room must include a section 1b that names the whole-board hostile movement');
  assert.match(md, /HOSTILE MOVEMENT — NONE TOWARD TRACKED THEATERS/);
  assert.match(md, /Toward tracked theaters/);
  assert.match(md, /Toward untracked bodies \(off-board\)/);
  assert.match(md, /Off-board destinations/);
});

test('an absent payload reads the snapshot to compute hostileMovement (source: computed)', () => {
  const md = renderWarRoomMarkdown(fixtureHostileOffBoard());
  assert.match(md, /\*\*Source:\*\* computed/,
    'when the payload does not carry hostileMovement, the export computes it from the filtered snapshot');
});

test('a payload with no hostile data never fabricates a movement claim', () => {
  // The export's readHostileMovement() catches any throw from
  // theaterBoardResource() and produces an UNAVAILABLE block. We do not
  // synthesise a throw from inside the projection -- the safer way to
  // prove the absent-from-payload guard is to render an export with no
  // hostile data and assert UNAVAILABLE does not appear when there is
  // genuinely nothing to read.
  const md = renderWarRoomMarkdown({});
  // A bare {} satisfies the title block; the rest of the export is mostly
  // empty. The hostile-movement section is the test surface -- it must
  // either render UNAVAILABLE explicitly, or fall through to the computed
  // no-movement reading for an empty fleet table; never fabricate
  // NO_HOSTILE_MOVEMENT_OBSERVED without grounds. The check is scoped to
  // section 1b because the surrounding sections render their own
  // UNAVAILABLE lines and must not trip it.
  const start = md.indexOf('## 1b. Hostile Movement (Whole-Board)');
  assert.ok(start !== -1, 'the war room must render section 1b');
  const end = md.indexOf('\n## ', start + 1);
  const section = md.slice(start, end === -1 ? md.length : end);
  if (/UNAVAILABLE/.test(section)) {
    assert.doesNotMatch(section, /NO HOSTILE MOVEMENT OBSERVED/,
      'an UNAVAILABLE read must not read as no movement observed');
  } else {
    // An empty fleet table genuinely computes the none state -- the same
    // answer the fixture-based no-movement test asserts below. Pinning it
    // here proves the absent-payload path lands on "computed", not on a
    // fabricated reading.
    assert.match(section, /NO HOSTILE MOVEMENT OBSERVED/,
      'a snapshot with no hostile data computes the no-movement answer');
  }
});

test('when the payload publishes hostileMovement, the export uses it as published', () => {
  // The off-board fixture computes to "elsewhere". Publishing an inbound
  // movement on the payload must render the PUBLISHED state and declare the
  // source, not recompute the snapshot and print the off-board line -- the
  // payload path is the trust-the-filter-pipeline half of the contract, and
  // a test that published the same state the snapshot computes would pass
  // even if the export ignored the payload.
  const snap = fixtureHostileOffBoard();
  const computed = theaterBoardResource(snap, OBSERVER).hostileMovement;
  assert.strictEqual(computed.state, HOSTILE_MOVEMENT_STATE.elsewhere);

  snap.hostileMovement = {
    ...computed,
    state: HOSTILE_MOVEMENT_STATE.inbound,
    towardTrackedTheaters: { transfers: 1, ships: 6 }
  };

  const md = renderWarRoomMarkdown(snap);
  assert.match(md, /\*\*Source:\*\* payload/,
    'a published hostileMovement must be read as published, not recomputed');
  assert.match(md, /INBOUND TO TRACKED THEATER/,
    'the published state must be what renders');
  assert.doesNotMatch(md, /NONE TOWARD TRACKED THEATERS/,
    'recomputing the off-board fixture would render the elsewhere line');
});

test('an unreadable snapshot renders UNAVAILABLE in the export, never no-movement', () => {
  // The export must say "the measurement was not read", never "no movement",
  // when the projection cannot run. renderWarRoomMarkdown(null) throws in the
  // title block before section 1b is reached, so the guard is proven at the
  // surface section 1b actually renders through: readHostileMovement()
  // short-circuits on a null snapshot and the block prints the UNAVAILABLE
  // line, which is exactly what the war-room section would embed.
  const block = hostileMovementBlock(null).join('\n');
  assert.match(block, /UNAVAILABLE/,
    'an unreadable snapshot must render "measurement was not read"');
  assert.doesNotMatch(block, /NO HOSTILE MOVEMENT OBSERVED/,
    'an unreadable projection must not read as no movement observed');
});

test('a structurally-valid snapshot without hostileMovement is computed from the snapshot', () => {
  const snap = fixtureHostileOffBoard();
  delete snap.hostileMovement;
  const md = renderWarRoomMarkdown(snap);
  assert.match(md, /\*\*Source:\*\* computed/);
  assert.match(md, /HOSTILE MOVEMENT — NONE TOWARD TRACKED THEATERS/);
});

test('a genuinely-quiet snapshot says NO HOSTILE MOVEMENT OBSERVED, not 0/0 with confidence', () => {
  // Distinct from the UNAVAILABLE branch: a structurally-valid snapshot
  // with NO fleets reads as no-movement-observed, which is a real answer.
  const md = renderWarRoomMarkdown(fixtureNoMovement());
  assert.match(md, /NO HOSTILE MOVEMENT OBSERVED/);
});

// ---------------------------------------------------------------------------
// 3. Size budget for the war room.
// ---------------------------------------------------------------------------

test('the war room stays under the 30,720-byte ceiling after adding section 1b', () => {
  const growthSizes = [1, 2, 3, 4, 6, 8];
  for (const multiplier of growthSizes) {
    const snap = fixtureHostileOffBoard();
    const base = JSON.parse(JSON.stringify(snap));
    for (let i = 0; i < multiplier - 1; i++) {
      for (const f of base.fleets) {
        snap.fleets.push({ ...f, ID: f.ID + 1000 * (i + 1), displayName: `${f.displayName}-copy${i + 1}` });
      }
    }
    const md = renderWarRoomMarkdown(snap);
    const bytes = utf8ByteLength(md);
    assert.ok(bytes < WAR_ROOM_BYTE_BUDGET,
      `multiplier ${multiplier}x: ${bytes} bytes exceeds ceiling ${WAR_ROOM_BYTE_BUDGET}`);
  }
});

// ---------------------------------------------------------------------------
// 4. hostileMovementBlock renders distinctly across the four states.
// ---------------------------------------------------------------------------

test('hostileMovementBlock delivers state-distinct headers and an absent-read guard', () => {
  const noneBlock = hostileMovementBlock(fixtureNoMovement());
  const offBlock = hostileMovementBlock(fixtureHostileOffBoard());
  const unresolvedBlock = hostileMovementBlock(fixtureHostileUnresolved());
  const inboundBlock = hostileMovementBlock(fixtureHostileInbound());

  for (const [label, block] of [
    ['none', noneBlock],
    ['elsewhere', offBlock],
    ['partlyUnresolved', unresolvedBlock],
    ['inbound', inboundBlock]
  ]) {
    assert.ok(block.length > 0, `block for ${label} must not be empty`);
  }

  // None state MUST NOT include off-board rows (no fleets).
  assert.doesNotMatch(noneBlock.join('\n'), /Off-board destinations/);

  const absentBlock = hostileMovementBlock(null);
  assert.ok(absentBlock.some(line => /UNAVAILABLE/.test(line)));
});
