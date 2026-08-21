// tests/markdownBudget.test.js
//
// The size ceilings on the model-facing markdown exports used to be an
// observation about one save rather than a guarantee. Measured before the
// byte-budget engine existed, /latest-war-room.md rendered:
//
//     friendly x1,  hostile x1    14.2 KB   ok
//     friendly x3,  hostile x2    25.3 KB   ok
//     friendly x5,  hostile x3    36.3 KB   ** over the 30 KB ceiling **
//     friendly x20, hostile x20  181.2 KB   ** over the 30 KB ceiling **
//
// and /latest-threats.md crossed its 10 KB ceiling at 5x. Every test here
// pins the cap as a HARD guarantee and, crucially, also renders the same
// snapshot with the budget disabled so the test proves the cap is what keeps
// the document small rather than passing by construction.
//
// Both modes are exercised throughout: player is the default and a genuinely
// different code path.
//
// Live-save independence (docs/live-save-test-dependency-spec.md): every
// assertion here is a PROPERTY assertion ("output satisfies a bound"), which
// is exactly the case where synthetic volume is correct and safe. The base
// snapshot is synthetic (tests/fixtures/syntheticMarkdownSnapshot.js) and the
// growth ladder clones its fleets to breach the caps -- cloned fleets carry
// the relevance characteristics of the fleets they came from, so the omission
// and degradation paths are exercised for real without reading a save.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { makeMarkdownSnapshot, OBSERVER_ID: OBSERVER } = require('./fixtures/syntheticMarkdownSnapshot');
const {
  renderWarRoomMarkdown,
  renderThreatsMarkdown,
  utf8ByteLength,
  WAR_ROOM_BYTE_BUDGET,
  THREATS_BYTE_BUDGET
} = require('../shared/markdownExports.mjs');

const MODES = ['player', 'omniscient'];
const NO_BUDGET = { maxBytes: Number.MAX_SAFE_INTEGER };

const snapshotCache = new Map();
function snapshotFor(mode) {
  if (!snapshotCache.has(mode)) {
    snapshotCache.set(mode, makeMarkdownSnapshot(mode));
  }
  return snapshotCache.get(mode);
}

/**
 * Multiplies the fleet population by cloning existing fleets, so the growth
 * is realistic: every clone keeps the relevance characteristics of the fleet
 * it came from. Clones carry `ID` (capital) because that is what save-derived
 * objects use -- `id` is undefined here and would collapse every clone onto
 * the same identity.
 */
function growFleets(base, friendlyMultiple, hostileMultiple) {
  const grown = JSON.parse(JSON.stringify(base));
  const ours = base.fleets.filter(f => Number(f.factionId) === OBSERVER);
  const theirs = base.fleets.filter(f => Number(f.factionId) !== OBSERVER);
  const fleets = [];

  const clone = (fleet, copy, stride) => (copy === 0 ? fleet : {
    ...JSON.parse(JSON.stringify(fleet)),
    ID: Number(fleet.ID) + (copy * stride),
    displayName: `${fleet.displayName} #${copy + 1}`
  });

  for (let copy = 0; copy < friendlyMultiple; copy += 1) {
    for (const fleet of ours) fleets.push(clone(fleet, copy, 100000));
  }
  for (let copy = 0; copy < hostileMultiple; copy += 1) {
    for (const fleet of theirs) fleets.push(clone(fleet, copy, 200000));
  }

  grown.fleets = fleets;
  return grown;
}

function sectionText(markdown, number) {
  const lines = markdown.split('\n');
  const start = lines.findIndex(line => line.startsWith(`## ${number}.`));
  if (start < 0) return '';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^## \d+\./.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start, end).join('\n');
}

const BUDGET_OMISSION = /(\d+) further entr(?:y|ies) omitted to fit the size budget/;
const BUDGET_EMPTIED = /All (\d+) [^*]*omitted to fit the size budget/;
const RELEVANCE_OMISSION = /(\d+) hostile fleets omitted \(below relevance threshold/;

const lostEntriesToBudget = (text) => BUDGET_OMISSION.test(text) || BUDGET_EMPTIED.test(text);
const emptiedByBudget = (text) => BUDGET_EMPTIED.test(text);

// The growth ladder. 20x is deliberately far beyond anything the campaign can
// reach: the observer has 6 fleets today and the user's largest recorded alien
// presence was 161 ships, so 20x (2,860 fleets) is roughly an order of
// magnitude past the worst realistic case.
const GROWTH_LEVELS = [
  [1, 1], [2, 1], [3, 2], [5, 3], [5, 5], [10, 10], [20, 20]
];

// ---------------------------------------------------------------------------
// 1. utf8ByteLength must agree with Buffer.byteLength
//
// The renderer runs in the Cloudflare Worker, which has no Buffer, so the
// budget is measured with a hand-rolled UTF-8 counter. If that counter is
// wrong the cap is wrong, so it is pinned against Node's implementation --
// including every non-ASCII glyph the exports actually emit.
// ---------------------------------------------------------------------------
test('utf8ByteLength matches Buffer.byteLength for the glyphs these exports emit', () => {
  const samples = [
    '',
    'plain ascii',
    '⚠️ warning',              // emitted by the threats headers
    '6× Patapsco (Escort)',    // design rollups
    'ΔV: 12.4 kps',            // propulsion lines
    'Combat Accel: 0.003 m/s²',
    'Immediate Inbound Threats (≤ 365 Days)',
    'Mars Orbit → Ceres',
    'Raw-save actual hate — 35.28',
    '■■■■■',                   // redacted player-mode hate meter
    '🛰️🚀 emoji outside the BMP',
    '\ud83d',                  // lone high surrogate
    '\udc00',                  // lone low surrogate
    'mixed 🚀 pair and \ud83d lone'
  ];
  for (const sample of samples) {
    assert.strictEqual(
      utf8ByteLength(sample),
      Buffer.byteLength(sample, 'utf8'),
      `utf8ByteLength disagreed with Buffer.byteLength for ${JSON.stringify(sample)}`
    );
  }

  // Non-vacuous: the counter must not simply be returning string length.
  assert.notStrictEqual(utf8ByteLength('⚠️'), '⚠️'.length);
});

// ---------------------------------------------------------------------------
// 2. THE CAP IS A HARD GUARANTEE AT EVERY GROWTH LEVEL, IN BOTH MODES
// ---------------------------------------------------------------------------
for (const mode of MODES) {
  test(`war room stays under the 30 KB cap at every growth level (${mode} mode)`, () => {
    const base = snapshotFor(mode);
    let sawUnbudgetedBreach = false;

    for (const [friendly, hostile] of GROWTH_LEVELS) {
      const grown = growFleets(base, friendly, hostile);

      // Guard the harness itself: a clone step that silently did nothing would
      // make every assertion below vacuous.
      const expectedFleets = (base.fleets.filter(f => Number(f.factionId) === OBSERVER).length * friendly)
        + (base.fleets.filter(f => Number(f.factionId) !== OBSERVER).length * hostile);
      assert.strictEqual(grown.fleets.length, expectedFleets,
        `growth harness produced ${grown.fleets.length} fleets, expected ${expectedFleets}`);

      const rendered = renderWarRoomMarkdown(grown);
      const size = utf8ByteLength(rendered);
      assert.ok(
        size < WAR_ROOM_BYTE_BUDGET,
        `war room at friendly x${friendly} / hostile x${hostile} (${mode}) rendered ${size} bytes, `
        + `which is not under the ${WAR_ROOM_BYTE_BUDGET}-byte cap`
      );

      // Non-vacuous proof: the same snapshot with the budget disabled must
      // eventually breach the ceiling, otherwise the cap is untested.
      const unbudgeted = utf8ByteLength(renderWarRoomMarkdown(grown, NO_BUDGET));
      if (unbudgeted >= WAR_ROOM_BYTE_BUDGET) {
        sawUnbudgetedBreach = true;
        assert.ok(
          size < unbudgeted,
          `budget did nothing at friendly x${friendly} / hostile x${hostile} (${mode}): `
          + `${size} bytes budgeted vs ${unbudgeted} unbudgeted`
        );
      }
    }

    assert.ok(
      sawUnbudgetedBreach,
      'no growth level breached the ceiling without the budget — the cap assertions would be vacuous'
    );
  });

  test(`threats report stays under the 10 KB cap at every growth level (${mode} mode)`, () => {
    const base = snapshotFor(mode);
    let sawUnbudgetedBreach = false;

    for (const [friendly, hostile] of GROWTH_LEVELS) {
      const grown = growFleets(base, friendly, hostile);
      const size = utf8ByteLength(renderThreatsMarkdown(grown));
      assert.ok(
        size < THREATS_BYTE_BUDGET,
        `threats at friendly x${friendly} / hostile x${hostile} (${mode}) rendered ${size} bytes, `
        + `which is not under the ${THREATS_BYTE_BUDGET}-byte cap`
      );

      const unbudgeted = utf8ByteLength(renderThreatsMarkdown(grown, NO_BUDGET));
      if (unbudgeted >= THREATS_BYTE_BUDGET) sawUnbudgetedBreach = true;
    }

    assert.ok(
      sawUnbudgetedBreach,
      'no growth level breached the threats ceiling without the budget — the cap assertions would be vacuous'
    );
  });
}

// ---------------------------------------------------------------------------
// 3. THE TWO OMISSION REASONS ARE BOTH PRINTED AND ARE NOT THE SAME REASON
//
// "below relevance threshold" means the entry never qualified. "omitted to fit
// the size budget" means it DID qualify and was cut anyway. Conflating them
// would hide the fact that relevant material was dropped.
// ---------------------------------------------------------------------------
for (const mode of MODES) {
  test(`relevance omissions and budget omissions are counted separately (${mode} mode)`, () => {
    // 10x growth puts the hostile section under budget pressure while leaving
    // plenty of fleets below the relevance bar.
    const grown = growFleets(snapshotFor(mode), 10, 10);
    const rendered = renderWarRoomMarkdown(grown);
    const hostileSection = sectionText(rendered, 3);
    assert.ok(hostileSection.length > 0, 'section 3 must exist');

    const relevance = hostileSection.match(RELEVANCE_OMISSION);
    const budget = hostileSection.match(BUDGET_OMISSION);
    assert.ok(relevance, 'section 3 must state how many fleets fell below the relevance threshold');
    assert.ok(budget, 'section 3 must separately state how many relevant fleets did not fit the budget');

    const belowThreshold = Number(relevance[1]);
    const didNotFit = Number(budget[1]);
    assert.ok(belowThreshold > 0, 'relevance-omitted count must be a real count');
    assert.ok(didNotFit > 0, 'budget-omitted count must be a real count');

    // They are different counts on different lines with different reasons.
    const relevanceLine = hostileSection.split('\n').find(l => RELEVANCE_OMISSION.test(l));
    const budgetLine = hostileSection.split('\n').find(l => BUDGET_OMISSION.test(l));
    assert.notStrictEqual(relevanceLine, budgetLine,
      'the two omission reasons must be reported on separate lines, not merged');
    assert.ok(
      !RELEVANCE_OMISSION.test(budgetLine),
      'the budget notice must not restate the relevance reason'
    );
    assert.match(
      budgetLine,
      /met the relevance bar but did not fit/,
      'the budget notice must make clear the dropped entries WERE relevant'
    );

    // The shown/total arithmetic in the notice must reconcile.
    const shownOf = budgetLine.match(/(\d+) of (\d+) relevant hostile fleets shown/);
    assert.ok(shownOf, 'budget notice must state how many of the relevant set is shown');
    assert.strictEqual(
      Number(shownOf[2]) - Number(shownOf[1]),
      didNotFit,
      'shown + omitted must equal the relevant total'
    );
  });
}

// ---------------------------------------------------------------------------
// 4. A SECTION HEADER IS NEVER DROPPED, AND AN EMPTIED SECTION SAYS WHY
//
// A missing section reads as "nothing to report", which is the same failure
// class as fabricating data.
// ---------------------------------------------------------------------------
for (const mode of MODES) {
  test(`every section header survives at any budget, and emptied sections say why (${mode} mode)`, () => {
    const base = snapshotFor(mode);
    const cases = [
      { snapshot: growFleets(base, 20, 20), options: undefined, label: '20x growth' },
      { snapshot: base, options: { maxBytes: 8000 }, label: '8 KB budget' },
      { snapshot: base, options: { maxBytes: 4000 }, label: '4 KB budget' },
      // Far below anything real: forces the last-resort clamp that suppresses
      // whole fixed-section bodies.
      { snapshot: base, options: { maxBytes: 3000 }, label: '3 KB budget' }
    ];

    for (const { snapshot, options, label } of cases) {
      const rendered = renderWarRoomMarkdown(snapshot, options);

      for (let n = 1; n <= 8; n += 1) {
        assert.match(
          rendered,
          new RegExp(`^## ${n}\\. `, 'm'),
          `section ${n} header missing at ${label} (${mode})`
        );
      }

      // Every section that lost its entries must say so in its own body.
      for (const n of [2, 3, 4, 6]) {
        const text = sectionText(rendered, n);
        const hasEntries = text.split('\n').some(l => /^[-#]/.test(l) && !/^#+ \d+\./.test(l));
        if (!hasEntries) {
          assert.ok(
            /omitted to fit the size budget|No |no detection|below relevance threshold/i.test(text),
            `section ${n} rendered no entries and no explanation at ${label} (${mode}):\n${text}`
          );
        }
      }
    }
  });
}

// ---------------------------------------------------------------------------
// 5. DEGRADATION FOLLOWS THE DECLARED PRIORITY ORDER
//
// The threat-bearing sections survive longest. A brief that drops its
// incoming-threats section to preserve a research summary is wrong.
// ---------------------------------------------------------------------------
for (const mode of MODES) {
  test(`threat-bearing sections outlive the reference sections (${mode} mode)`, () => {
    const base = snapshotFor(mode);
    let sawResearchCut = false;
    let sawHostileCut = false;

    for (const maxBytes of [30720, 14000, 12000, 10000, 8000, 6000, 5000, 4000, 3000]) {
      const rendered = renderWarRoomMarkdown(base, { maxBytes });
      const research = lostEntriesToBudget(sectionText(rendered, 8));
      const habs = lostEntriesToBudget(sectionText(rendered, 6));
      const construction = lostEntriesToBudget(sectionText(rendered, 5));
      const hostile = lostEntriesToBudget(sectionText(rendered, 3));
      const incoming = lostEntriesToBudget(sectionText(rendered, 4));

      if (research) sawResearchCut = true;
      if (hostile) sawHostileCut = true;

      if (hostile) {
        assert.ok(research && construction,
          `at maxBytes=${maxBytes} (${mode}) hostile fleets were cut while research or construction survived intact`);
      }
      if (incoming) {
        assert.ok(
          emptiedByBudget(sectionText(rendered, 8))
          && emptiedByBudget(sectionText(rendered, 6))
          && emptiedByBudget(sectionText(rendered, 3)),
          `at maxBytes=${maxBytes} (${mode}) incoming threats were cut while research, habs or hostile fleets still had entries`
        );
      }

      // Section 1 and section 7 are fixed-size and must never lose entries to
      // a per-entry budget cut; only the last-resort clamp may touch them.
      assert.ok(!BUDGET_OMISSION.test(sectionText(rendered, 1)),
        `alien threat posture must not be entry-degraded (maxBytes=${maxBytes}, ${mode})`);
    }

    assert.ok(sawResearchCut, 'the budget sweep never cut research — the ordering assertions would be vacuous');
    assert.ok(sawHostileCut, 'the budget sweep never cut hostile fleets — the ordering assertions would be vacuous');
  });
}

// ---------------------------------------------------------------------------
// 6. DEGRADED OUTPUT IS STILL CLEAN AND STILL DETERMINISTIC
// ---------------------------------------------------------------------------
for (const mode of MODES) {
  test(`degraded output carries no corruption tokens and no raw template ids (${mode} mode)`, () => {
    const grown = growFleets(snapshotFor(mode), 20, 20);
    const documents = [
      ['war room 20x', renderWarRoomMarkdown(grown)],
      ['threats 20x', renderThreatsMarkdown(grown)],
      ['war room 3 KB clamp', renderWarRoomMarkdown(snapshotFor(mode), { maxBytes: 3000 })],
      ['threats 3 KB clamp', renderThreatsMarkdown(snapshotFor(mode), { maxBytes: 3000 })]
    ];

    for (const [label, text] of documents) {
      for (const token of ['null', 'undefined', 'NaN', '[object Object]', 'playerShipTemplate']) {
        assert.ok(!text.includes(token), `${label} (${mode}) contains forbidden token '${token}'`);
      }
      // A degraded document must still be multi-line markdown, not a stub.
      assert.ok(text.split('\n').length > 20, `${label} (${mode}) collapsed to ${text.split('\n').length} lines`);
    }
  });

  test(`degradation is deterministic — same snapshot renders byte-identically (${mode} mode)`, () => {
    const grown = growFleets(snapshotFor(mode), 20, 20);
    assert.strictEqual(renderWarRoomMarkdown(grown), renderWarRoomMarkdown(grown));
    assert.strictEqual(renderThreatsMarkdown(grown), renderThreatsMarkdown(grown));

    // Independently grown copies of the same base must also agree, so the
    // ordering does not depend on object identity or insertion timing.
    const again = growFleets(snapshotFor(mode), 20, 20);
    assert.strictEqual(renderWarRoomMarkdown(grown), renderWarRoomMarkdown(again));
  });
}

// ---------------------------------------------------------------------------
// 7. REGRESSION: a hostile transfer aimed at an observer hab used to throw
//
// Section 4 read `ourHabMap` in renderWarRoomMarkdown, where it was never
// declared. No fleet on the live save targets an observer hab by id, so the
// ReferenceError never fired -- but any save where one did would have failed
// the whole export rather than degrading.
// ---------------------------------------------------------------------------
test('a hostile transfer targeting an observer hab renders instead of throwing', () => {
  const snapshot = {
    metadata: { gameTimeString: '2034-01-01T00:00:00Z', difficulty: 'Normal' },
    observerFactionId: OBSERVER,
    mode: 'player',
    factions: [{ ID: OBSERVER, displayName: 'the Initiative', resources: {}, monthlyNet: {} }],
    habs: [{ ID: 501, factionId: OBSERVER, displayName: 'Tranquillity Base', orbitBody: 'Luna', tier: 3 }],
    fleets: [
      {
        ID: 900,
        displayName: 'Hostile Strike Group',
        factionId: 4717,
        factionName: 'the Servants',
        shipsCount: 8,
        orbitBody: 'Mars',
        destination: 'Luna',
        destinationId: 501,
        arrivalDate: '2034-04-01T00:00:00Z'
      }
    ],
    shipDesigns: [],
    habModules: [],
    shipyardStations: [],
    shipyardQueues: [],
    capabilities: { deepSkywatch: true }
  };

  const rendered = renderWarRoomMarkdown(snapshot);
  const incoming = sectionText(rendered, 4);
  assert.match(incoming, /Target: \*\*Tranquillity Base\*\*/,
    'section 4 must name the targeted observer hab');
  assert.match(sectionText(rendered, 3), /targeting observer hab/,
    'section 3 must record the targeting reason');
  assert.ok(utf8ByteLength(rendered) < WAR_ROOM_BYTE_BUDGET);
});
