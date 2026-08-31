// tests/hostileMovementRendering.test.js
//
// Purpose: mounts the whole-board hostile-movement panel through the SAME path
//   the real shell uses and proves a render throw fails the suite. The phase-3
//   unit file (tests/hostileMovementPhase3.test.js) exercises the utils and the
//   markdown exports under plain Node but NEVER mounts the React panel -- so it
//   was green while HostileMovementPanel threw on an unknown DataTable variant
//   (`variant="default"` reached `tableClassNames` and exploded). This file
//   closes that gap: the harness scene renders `<HostileMovementPanel>` into
//   #hostileMovement (the shell's mount id) and the tests also drive the exact
//   bridge call mission-control.js makes:
//
//     window.MissionControlHostileMovement.render(container, movement)
//
//   A throw from either path surfaces as a pageerror (collected by the fixture)
//   and as a harness that never fills, so the test below goes red. Verified
//   2026-08-26: temporarily restoring `variant="default"` turned the suite red
//   on the page-error and empty-harness assertions; the guard was restored.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { HOSTILE_MOVEMENT_STATE, theaterBoardResource } = require('../shared/intelResources.mjs');
const { loadFixtureFilteredSnapshot } = require('./fixtures/frozenSnapshots');
const { visibleText } = require('./fixtures/renderHarness');
const {
  withHostileMovementHarnessPage,
  getHarnessHtml,
} = require('./fixtures/hostileMovementBrowser.js');

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

function hostileMovement(snapshot) {
  return theaterBoardResource(snapshot, OBSERVER).hostileMovement;
}

function frozenInbound() {
  return hostileMovement(loadFixtureFilteredSnapshot({ mode: 'player', observer: OBSERVER }));
}

/**
 * Render a payload through the exact bridge call mission-control.js makes and
 * return the mounted html.
 */
async function renderThroughBridge(page, payload) {
  return page.evaluate(async (movement) => {
    let root = document.getElementById('test-render-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'test-render-root';
      document.body.appendChild(root);
    }
    window.MissionControlHostileMovement.render(root, movement);
    // Allow React 18 concurrent commit to finish.
    await new Promise((resolve) => setTimeout(resolve, 30));
    return root.innerHTML;
  }, payload);
}

/**
 * Extract the four summary cells as { label, text } from rendered html. The
 * counts are inside `.hm-summary__item`; a whole-page substring match could
 * pass for the wrong reason (a fleet id or day count containing the same
 * digits), so the test pins each figure to its own cell.
 */
function summaryItems(html) {
  const items = [];
  for (const match of html.matchAll(/<div class="[^"]*hm-summary__item[^"]*">([\s\S]*?)<\/div>/g)) {
    const block = match[1];
    const label = (block.match(/<small>([^<]*)<\/small>/) || [])[1] || '';
    const text = visibleText(block);
    items.push({ label, text });
  }
  return items;
}

async function summaryFigureStates(page) {
  return page.evaluate(() => [...document.querySelectorAll(
    '#test-render-root .hm-summary__item'
  )].map((item) => ({
    label: item.querySelector('small')?.textContent.trim() || '',
    figures: [...item.querySelectorAll('[data-value-state]')].map((figure) => ({
      state: figure.dataset.valueState,
      text: figure.textContent.trim(),
    })),
  })));
}

async function rowFigureStates(page) {
  return page.evaluate(() => {
    const row = document.querySelector('#test-render-root .hm-row');
    return ['fleet', 'ships', 'via', 'arrival'].map((name) => {
      const host = row.querySelector(`.hm-cell--${name}`);
      const figure = host.matches('[data-value-state]')
        ? host
        : host.querySelector('[data-value-state]');
      return {
        name,
        state: figure?.dataset.valueState,
        text: figure?.textContent.trim(),
      };
    });
  });
}

function assertSummaryCell(html, label, value) {
  const item = summaryItems(html).find((c) => c.label === label);
  assert.ok(item, `summary cell ${label} must render`);
  assert.ok(item.text.includes(String(value)),
    `summary cell ${label} must show ${value}, got: ${item.text}`);
}

function assertSummaryCellAbsent(html, label) {
  const item = summaryItems(html).find((c) => c.label === label);
  assert.ok(item, `summary cell ${label} must render`);
  assert.ok(!/\d/.test(item.text),
    `summary cell ${label} must show an absent affordance, got: ${item.text}`);
}

// ---------------------------------------------------------------------------
// The panel mounts through the real path and does not throw.
// ---------------------------------------------------------------------------

test('the harness mounts the panel with zero page errors and real content', async () => {
  // The live save reads INBOUND_TO_TRACKED_THEATER; the committed frozen player
  // snapshot carries that same state, so the panel must put it on screen.
  const payload = frozenInbound();
  assert.strictEqual(payload.state, HOSTILE_MOVEMENT_STATE.inbound,
    'the frozen player snapshot must carry the inbound state');

  await withHostileMovementHarnessPage(payload, async (page, { pageErrors }) => {
    assert.deepStrictEqual(pageErrors.map(String), [],
      'mounting the panel must not throw — an unknown DataTable variant throws here');

    const html = await getHarnessHtml(page);
    assert.ok(html.length > 0, 'the #hostileMovement mount must contain rendered characters');

    const text = visibleText(html);
    assert.ok(text.includes('INBOUND TO TRACKED THEATER'), 'the inbound state label must render');
    assert.ok(text.includes('HOSTILE MOVEMENT BEYOND THE TWELVE THEATERS'),
      'the panel headline must render');

    // The live figures must sit in their own summary cells — a whole-page match
    // could pass on a fleet id or day count carrying the same digits.
    assertSummaryCell(html, 'OBSERVED', payload.observed.transfers);
    assertSummaryCell(html, 'OBSERVED', payload.observed.ships);
    assertSummaryCell(html, 'TOWARD TRACKED THEATERS', payload.towardTrackedTheaters.transfers);
    assertSummaryCell(html, 'TOWARD TRACKED THEATERS', payload.towardTrackedTheaters.ships);
    assertSummaryCell(html, 'TOWARD UNTRACKED BODIES', payload.towardUntrackedBodies.transfers);
    assertSummaryCell(html, 'UNRESOLVED DESTINATIONS', payload.unresolvedDestinations.transfers);

    const hmNodeCount = await page.evaluate(() =>
      document.querySelectorAll('#hostileMovement [class*="hm-"]').length);
    assert.ok(hmNodeCount > 0, `the panel must emit hm-* nodes, found ${hmNodeCount}`);
    assert.ok(html.includes('hm-banner'), 'the state banner must carry the hm-banner class');
    assert.ok(html.includes('hm-row'), 'off-board rows must carry the hm-row class');
  });
});

// ---------------------------------------------------------------------------
// The shell's bridge call (render) drives the panel and cannot throw.
// ---------------------------------------------------------------------------

test('the exact bridge call mission-control.js makes renders all four states without throwing', async () => {
  const states = [
    ['none', hostileMovement(fixtureNoMovement())],
    ['elsewhere', hostileMovement(fixtureHostileOffBoard())],
    ['partlyUnresolved', hostileMovement(fixtureHostileUnresolved())],
    ['inbound', hostileMovement(fixtureHostileInbound())],
  ];

  await withHostileMovementHarnessPage(states[0][1], async (page, { pageErrors }) => {
    const renderings = {};
    for (const [name, movement] of states) {
      const html = await renderThroughBridge(page, movement);
      renderings[name] = {
        text: visibleText(html),
        hmNodes: (html.match(/class="[^"]*hm-/g) || []).length,
      };
    }

    assert.deepStrictEqual(pageErrors.map(String), [],
      'the bridge render must not throw for any of the four states');

    for (const [name, rendering] of Object.entries(renderings)) {
      assert.ok(rendering.text.length > 0, `state ${name} must render text`);
      assert.ok(rendering.hmNodes > 0, `state ${name} must render hm-* nodes`);
    }
  });
});

// ---------------------------------------------------------------------------
// NONE_TOWARD_TRACKED_THEATERS and NO_HOSTILE_MOVEMENT_OBSERVED differ on the
// real DOM, and absent input stays honest.
// ---------------------------------------------------------------------------

test('the four states render four distinct DOM surfaces', async () => {
  const states = [
    hostileMovement(fixtureNoMovement()),
    hostileMovement(fixtureHostileOffBoard()),
    hostileMovement(fixtureHostileUnresolved()),
    hostileMovement(fixtureHostileInbound()),
  ];
  const texts = new Set();

  await withHostileMovementHarnessPage(states[0], async (page, { pageErrors }) => {
    for (const movement of states) {
      const html = await renderThroughBridge(page, movement);
      texts.add(visibleText(html));
    }

    assert.deepStrictEqual(pageErrors.map(String), [],
      're-rendering the four states must not throw');
    assert.strictEqual(texts.size, 4,
      'the four states must produce four distinct renderings');
  });
});

test('NONE_TOWARD_TRACKED_THEATERS and NO_HOSTILE_MOVEMENT_OBSERVED do not render alike', async () => {
  const noMovement = hostileMovement(fixtureNoMovement());
  const elsewhere = hostileMovement(fixtureHostileOffBoard());

  await withHostileMovementHarnessPage(noMovement, async (page, { pageErrors }) => {
    const noMovementHtml = await renderThroughBridge(page, noMovement);
    const elsewhereHtml = await renderThroughBridge(page, elsewhere);

    const noMovementText = visibleText(noMovementHtml);
    const elsewhereText = visibleText(elsewhereHtml);

    assert.ok(noMovementText.includes('NO HOSTILE MOVEMENT OBSERVED'));
    assert.ok(elsewhereText.includes('HOSTILE MOVEMENT — NONE TOWARD TRACKED THEATERS'));
    assert.notStrictEqual(noMovementText, elsewhereText,
      'the two states that a twelve-row table would collapse together must render differently');
    assert.deepStrictEqual(pageErrors.map(String), []);
  });
});

test('an absent payload renders the honest unavailable affordance, not a confident no-movement', async () => {
  await withHostileMovementHarnessPage(null, async (page, { pageErrors }) => {
    assert.deepStrictEqual(pageErrors.map(String), []);
    const html = await getHarnessHtml(page);
    const text = visibleText(html);
    assert.ok(text.includes('HOSTILE MOVEMENT UNAVAILABLE'),
      'an absent read must say the measurement was not read');
    assert.ok(!text.includes('NO HOSTILE MOVEMENT OBSERVED'),
      'an absent read must not claim no movement observed');
  });
});

test('a measured count renders as a number while an unread bucket stays an em dash', async () => {
  // Regression guard for the presence signal: every summary figure goes through
  // <Value>, which renders its absent affordance whenever `present` is not true.
  // Dropping `present` made the whole panel show "—" for measured counts — the
  // same defect class as rendering a null as a confident zero, in the other
  // direction.
  const measured = hostileMovement(fixtureHostileInbound());
  assert.strictEqual(measured.observed.transfers, 3, 'the fixture must carry measured counts');

  const partial = { ...measured, towardUntrackedBodies: null, unresolvedDestinations: null };

  await withHostileMovementHarnessPage(measured, async (page, { pageErrors }) => {
    const measuredHtml = await renderThroughBridge(page, measured);
    const partialHtml = await renderThroughBridge(page, partial);

    assert.deepStrictEqual(pageErrors.map(String), [],
      'neither render may throw');

    assertSummaryCell(measuredHtml, 'OBSERVED', 3);
    assertSummaryCell(measuredHtml, 'OBSERVED', measured.observed.ships);

    // The nulled buckets must read as absent, never as 0/0 measured.
    assertSummaryCellAbsent(partialHtml, 'TOWARD UNTRACKED BODIES');
    assertSummaryCellAbsent(partialHtml, 'UNRESOLVED DESTINATIONS');
  });
});

test('summary figures keep each metric presence independent', async () => {
  const baseline = hostileMovement(fixtureHostileInbound());
  const metrics = [
    ['OBSERVED', 'observed', 'transfers'],
    ['OBSERVED', 'observed', 'ships'],
    ['TOWARD TRACKED THEATERS', 'towardTrackedTheaters', 'transfers'],
    ['TOWARD TRACKED THEATERS', 'towardTrackedTheaters', 'ships'],
    ['TOWARD UNTRACKED BODIES', 'towardUntrackedBodies', 'transfers'],
    ['TOWARD UNTRACKED BODIES', 'towardUntrackedBodies', 'ships'],
    ['UNRESOLVED DESTINATIONS', 'unresolvedDestinations', 'transfers'],
    ['UNRESOLVED DESTINATIONS', 'unresolvedDestinations', 'ships'],
  ];

  await withHostileMovementHarnessPage(baseline, async (page, { pageErrors }) => {
    await renderThroughBridge(page, baseline);
    const baselineStates = await summaryFigureStates(page);
    for (const cell of baselineStates) {
      assert.deepStrictEqual(cell.figures.map((figure) => figure.state), ['measured', 'measured'],
        `${cell.label} baseline figures must both be measured`);
    }

    for (const [label, bucket, field] of metrics) {
      const variant = {
        ...baseline,
        [bucket]: { ...baseline[bucket], [field]: null },
      };
      await renderThroughBridge(page, variant);
      const states = await summaryFigureStates(page);
      const cell = states.find((entry) => entry.label === label);
      assert.ok(cell, `${label} must render for ${bucket}.${field}`);
      const index = field === 'transfers' ? 0 : 1;
      assert.strictEqual(cell.figures[index].state, 'absent',
        `${bucket}.${field} must be absent when that metric is null`);
      assert.strictEqual(cell.figures[1 - index].state, 'measured',
        `${bucket}.${field} must not change its sibling metric`);

      for (const other of states) {
        if (other === cell) continue;
        assert.deepStrictEqual(other.figures.map((figure) => figure.state), ['measured', 'measured'],
          `${bucket}.${field} must not change ${other.label}`);
      }

      const baselineCell = baselineStates.find((entry) => entry.label === label);
      assert.strictEqual(baselineCell.figures[index].text,
        String(baseline[bucket][field].toLocaleString('en-US')),
        `${bucket}.${field} baseline text must come from its own value`);
      assert.strictEqual(cell.figures[index].text, '—',
        `${bucket}.${field} must use the Value absent affordance`);
      assert.strictEqual(cell.figures[1 - index].text,
        String(baseline[bucket][field === 'transfers' ? 'ships' : 'transfers']
          .toLocaleString('en-US')),
        `${bucket}.${field} must not render its sibling's value`);
    }

    assert.deepStrictEqual(pageErrors.map(String), [],
      'per-metric probes must not throw while the panel re-renders');
  });
});

test('destination row figures keep fleet, ships, path, and ETA presence independent', async () => {
  const movement = hostileMovement(fixtureHostileInbound());
  const baseline = {
    ...movement,
    offBoardDestinations: movement.offBoardDestinations.map((entry, index) => index === 0
      ? { ...entry, daysRemaining: 4, arrival: '2033-05-05' }
      : entry),
  };
  const row = baseline.offBoardDestinations[0];
  const probes = [
    ['fleet', { fleet: null }],
    ['ships', { shipCount: null }],
    ['via', { via: [], statedDestination: null }],
    ['arrival', { daysRemaining: null }],
  ];

  await withHostileMovementHarnessPage(baseline, async (page, { pageErrors }) => {
    await renderThroughBridge(page, baseline);
    const baselineFigures = await rowFigureStates(page);
    assert.deepStrictEqual(baselineFigures.map((figure) => figure.state),
      ['measured', 'measured', 'measured', 'measured'],
      'the row probe must begin with four measured figures');

    for (const [name, change] of probes) {
      const variant = {
        ...baseline,
        offBoardDestinations: [{ ...row, ...change }],
      };
      await renderThroughBridge(page, variant);
      const figures = await rowFigureStates(page);
      for (const figure of figures) {
        if (figure.name === name) {
          assert.strictEqual(figure.state, 'absent', `${name} must be absent when its input is null`);
          assert.strictEqual(figure.text, name === 'arrival' ? 'ETA unknown' : '—',
            `${name} must use the Value absent affordance`);
        } else {
          const expected = baselineFigures.find((base) => base.name === figure.name);
          assert.strictEqual(figure.state, 'measured',
            `${name} must not change ${figure.name} presence`);
          assert.strictEqual(figure.text, expected.text,
            `${name} must not render a neighbouring figure's value in ${figure.name}`);
        }
      }
    }

    assert.deepStrictEqual(pageErrors.map(String), [],
      'per-row metric probes must not throw while the panel re-renders');
  });
});

test('every figure absence affordance is stamped through Value, including table hosts', async () => {
  const measured = hostileMovement(fixtureHostileInbound());
  const partial = {
    ...measured,
    observed: { transfers: null, ships: null },
    towardTrackedTheaters: { transfers: null, ships: null },
    towardUntrackedBodies: { transfers: null, ships: null },
    unresolvedDestinations: { transfers: null, ships: null },
    nearestArrivalDays: null,
    offBoardDestinations: [{
      ...measured.offBoardDestinations[0],
      fleet: null,
      shipCount: null,
      via: [],
      statedDestination: null,
      daysRemaining: null,
      arrival: null,
    }],
    offBoardDestinationsTotalCount: 1,
    offBoardDestinationsOmittedCount: 0,
  };

  await withHostileMovementHarnessPage(partial, async (page, { pageErrors }) => {
    await renderThroughBridge(page, partial);
    const result = await page.evaluate(() => {
      const root = document.querySelector('#test-render-root');
      return {
        absentCount: root.querySelectorAll('[data-value-state="absent"]').length,
        unstampedDashLeaves: [...root.querySelectorAll('*')]
          .filter((node) => node.children.length === 0
            && node.textContent.trim() === '—'
            && !node.hasAttribute('data-value-state'))
          .map((node) => node.outerHTML),
      };
    });

    // 8 summary metrics + nearest ETA + fleet/ships/path/arrival in one row.
    assert.strictEqual(result.absentCount, 13,
      'all eight summary metrics and four row figures plus the header ETA must be stamped');
    assert.deepStrictEqual(result.unstampedDashLeaves, [],
      'no em-dash absence affordance may be emitted outside Value');
    assert.deepStrictEqual(pageErrors.map(String), [],
      'the all-absent probe must not throw');
  });
});
