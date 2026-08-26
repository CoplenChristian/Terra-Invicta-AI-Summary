// tests/faction-intel.test.js
//
// Purpose: the thin React-specific suite for the faction dossier panel. Covers
//   only what tests/factionIntelRendering.test.js structurally cannot — the
//   production strangler bridge, cross-mode redaction, the presence signal the
//   Value primitive adds, and the predicate separation that keeps live-defect
//   #11 closed. Everything else is already characterised there; do not
//   re-characterise it here.
//
// Harness: real browser via tests/fixtures/factionIntelBrowser.js.
//   `node --test` cannot render a React component out of the Vite bundle.
//
// RED PROOF (2026-08-26): two deliberate breaks, applied together.
//   1. `modeAllowsRaw = true` in getAlienHate (factionIntelUtils.js) — i.e. the
//      player-mode gate removed. Test 2 went red on "player mode must not leak
//      the raw alien-hate value 42.65 anywhere in the rendered payload".
//   2. The <Value> wrapper dropped from MetricValue (FactionIntel.jsx), leaving
//      bare text. Test 3 went red on "metric cells must carry a
//      presence-signalling value primitive".
//   Run was 3 pass / 2 fail; restoring both returned all 5 to green.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  withFactionIntelHarnessPage,
  getHarnessText,
  visibleText,
} = require('./fixtures/factionIntelBrowser');

const OBSERVER = 4712;
const ALIEN = 4717;

/** A faction whose alien-hate is recorded but not legitimately known. */
function redactionSnapshot(mode) {
  return {
    mode,
    observerFactionId: OBSERVER,
    metadata: { gameTimeString: 'REDACTION PROBE' },
    factions: [
      { ID: OBSERVER, displayName: 'the Initiative', powerScore: { overall: 70 } },
      {
        ID: ALIEN,
        displayName: 'the Aliens',
        powerScore: { overall: 50 },
        controlPointsCount: 9,
        alienHate: { visibility: 'raw_save_only', actual: 42.65, playerVisible: false },
      },
    ],
    councilors: [],
  };
}

/**
 * Mounts through the real strangler bridge — window.FactionIntelScreen.render —
 * into a container this test creates, exactly as mission-control.js does.
 */
async function mountViaBridge(page, { snapshot, observerId = OBSERVER, container = '#bridgeMount', selectAfter }) {
  return page.evaluate(async (args) => {
    let host = document.getElementById('bridgeMount');
    if (!host) {
      host = document.createElement('div');
      host.id = 'bridgeMount';
      document.body.appendChild(host);
    }
    const controller = window.FactionIntelScreen.render(
      args.container,
      args.snapshot,
      null,
      args.observerId,
    );
    // Read the controller BEFORE React has had a chance to commit — this is
    // the exact sequence mission-control.js uses on the line after render().
    const syncSelectedId = controller.getSelectedId();
    let syncSelectOk = null;
    if (args.selectAfter !== undefined && args.selectAfter !== null) {
      syncSelectOk = controller.select(args.selectAfter);
    }
    const syncSelectedIdAfter = controller.getSelectedId();

    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    window.__BRIDGE_CONTROLLER__ = controller;

    return {
      syncSelectedId,
      syncSelectOk,
      syncSelectedIdAfter,
      html: host.innerHTML,
      childCount: host.children.length,
    };
  }, { snapshot, observerId, container, selectAfter: selectAfter ?? null });
}

// ---------------------------------------------------------------------------
// 1. The production bridge — the surface mission-control.js actually calls
// ---------------------------------------------------------------------------

test('faction-intel bridge mounts from a selector string and answers select() synchronously', async () => {
  const snapshot = redactionSnapshot('omniscient');

  await withFactionIntelHarnessPage({ snapshot, briefing: null, observerId: OBSERVER }, async (page) => {
    const result = await mountViaBridge(page, { snapshot, selectAfter: ALIEN });

    // The container arrived as a selector string, not an element — the vanilla
    // dossier accepted both and mission-control.js relies on the element form.
    assert.ok(result.childCount > 0, 'the bridge must mount into a container given as a selector string');

    // select() runs on the line after render(), before React commits. A
    // ref-based imperative handle would still be empty here.
    assert.strictEqual(result.syncSelectedId, OBSERVER, 'initial selection must be readable before the first commit');
    assert.strictEqual(result.syncSelectOk, true, 'select() must succeed before the first commit');
    assert.strictEqual(result.syncSelectedIdAfter, ALIEN, 'the selected id must update synchronously');

    const text = visibleText(result.html);
    assert.ok(text.includes('the Aliens'), 'the committed render must show the synchronously selected faction');
    assert.ok(text.includes('Faction intelligence'), 'the dossier shell must render through the bridge');
  });
});

// ---------------------------------------------------------------------------
// 2. Player mode is a genuinely different code path, not a cosmetic filter
// ---------------------------------------------------------------------------

test('faction-intel withholds the raw alien-hate figure in player mode and shows it in omniscient', async () => {
  const RAW = '42.65';

  let playerHtml = '';
  await withFactionIntelHarnessPage(
    { snapshot: redactionSnapshot('player'), briefing: null, observerId: OBSERVER },
    async (page) => {
      await page.evaluate((id) => window.__FACTION_INTEL_CONTROLLER__.select(id), ALIEN);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      playerHtml = await page.evaluate(() => document.body.innerHTML);
    },
  );

  // Scan the WHOLE player-mode payload, not one field: four earlier leaks in
  // this repo shared the shape of a nulled derived field beside a surviving raw one.
  assert.ok(!playerHtml.includes(RAW),
    `player mode must not leak the raw alien-hate value ${RAW} anywhere in the rendered payload`);
  const playerText = visibleText(playerHtml);
  assert.ok(playerText.includes('ALIEN HATE UNAVAILABLE'),
    `player mode must say the alien-hate signal is unavailable\n${playerText}`);

  let omniscientText = '';
  await withFactionIntelHarnessPage(
    { snapshot: redactionSnapshot('omniscient'), briefing: null, observerId: OBSERVER },
    async (page) => {
      await page.evaluate((id) => window.__FACTION_INTEL_CONTROLLER__.select(id), ALIEN);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      omniscientText = await getHarnessText(page);
    },
  );

  assert.ok(omniscientText.includes(RAW),
    `omniscient mode must show the raw alien-hate value ${RAW}\n${omniscientText}`);
  assert.ok(!omniscientText.includes('ALIEN HATE UNAVAILABLE'),
    'omniscient mode must not report the same figure as unavailable');
});

// ---------------------------------------------------------------------------
// 3. The unavailable affordance carries an explicit presence signal
// ---------------------------------------------------------------------------

test('faction-intel metric cells tag unavailable and measured states, not just their text', async () => {
  const snapshot = {
    mode: 'player',
    observerFactionId: OBSERVER,
    factions: [{
      ID: OBSERVER,
      displayName: 'the Initiative',
      controlPointsCount: 18,
      totalGdp: null,
      powerScore: { overall: 70, military: 30 },
    }],
    councilors: [],
  };

  await withFactionIntelHarnessPage({ snapshot, briefing: null, observerId: OBSERVER }, async (page) => {
    const cells = await page.evaluate(() => {
      const out = {};
      document.querySelectorAll('.faction-intel-metric').forEach((metric) => {
        const label = metric.querySelector('.faction-intel-metric-label');
        const value = metric.querySelector('[data-primitive="value"]');
        if (!label || !value) return;
        out[label.textContent.trim()] = {
          state: value.getAttribute('data-value-state'),
          text: value.textContent.trim(),
        };
      });
      return out;
    });

    assert.ok(Object.keys(cells).length > 0, 'metric cells must carry a presence-signalling value primitive');
    assert.deepStrictEqual(cells['Control points'], { state: 'measured', text: '18' },
      'a measured metric must be tagged measured');
    assert.deepStrictEqual(cells.GDP, { state: 'unavailable', text: 'UNAVAILABLE' },
      'an unmeasured metric must be tagged unavailable, never rendered as a confident zero');
    assert.deepStrictEqual(cells.Population, { state: 'unavailable', text: 'UNAVAILABLE' },
      'an absent metric must be tagged unavailable');
    assert.strictEqual(cells['Composite score estimate'].state, 'measured');
  });
});

// ---------------------------------------------------------------------------
// 4. Live-defect #11: the two predicates must stay separate
// ---------------------------------------------------------------------------

test('faction-intel keeps a declared visibility distinct from a sentinel metric value', async () => {
  // 'N/A' discriminates the two predicates in a single render:
  //   - as a VISIBILITY DECLARATION it is a statement, so isExplicitlyEmpty is
  //     false and the tag reads EARTH N/A.
  //   - as a METRIC VALUE it is one of MISSING_VALUES, so hasMetricValue is
  //     false and the cell reads UNAVAILABLE.
  // Collapse the predicates in either direction and exactly one of these two
  // assertions flips — which is how defect #11 got in: an explicit negative
  // declaration was discarded as if it were an absence and inverted to VISIBLE.
  const snapshot = {
    mode: 'player',
    observerFactionId: OBSERVER,
    factions: [{
      ID: OBSERVER,
      displayName: 'the Initiative',
      earthVisibility: 'N/A',
      controlPointsCount: 'N/A',
      nationsCount: 12,
      powerScore: { overall: 70 },
    }],
    councilors: [],
  };

  await withFactionIntelHarnessPage({ snapshot, briefing: null, observerId: OBSERVER }, async (page) => {
    const text = await getHarnessText(page);

    assert.ok(text.includes('EARTH N/A'),
      `a declared earthVisibility of 'N/A' is a statement and must be shown verbatim\n${text}`);
    assert.ok(!text.includes('EARTH VISIBLE'),
      `a declared earthVisibility must never be inverted into EARTH VISIBLE\n${text}`);
    assert.ok(text.includes('Control points UNAVAILABLE'),
      `a metric value of 'N/A' is a missing measurement and must read UNAVAILABLE\n${text}`);
    assert.ok(!text.includes('Control points N/A'),
      `a sentinel metric value must not be printed as if it were a measurement\n${text}`);
    assert.ok(text.includes('Nations 12'),
      'the measured neighbour must be unaffected');
  });
});

// ---------------------------------------------------------------------------
// 5. The overlay is opened and closed repeatedly — teardown must be reusable
// ---------------------------------------------------------------------------

test('faction-intel bridge destroy empties the mount and a later render remounts it', async () => {
  const snapshot = redactionSnapshot('omniscient');

  await withFactionIntelHarnessPage({ snapshot, briefing: null, observerId: OBSERVER }, async (page) => {
    const first = await mountViaBridge(page, { snapshot });
    assert.ok(first.childCount > 0, 'the first mount must render');

    const afterDestroy = await page.evaluate(async () => {
      window.__BRIDGE_CONTROLLER__.destroy();
      window.__BRIDGE_CONTROLLER__.destroy();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return document.getElementById('bridgeMount').children.length;
    });
    assert.strictEqual(afterDestroy, 0, 'destroy must empty the overlay mount and be idempotent');

    const second = await mountViaBridge(page, { snapshot, selectAfter: ALIEN });
    assert.ok(second.childCount > 0, 'reopening the overlay must remount the dossier');
    assert.strictEqual(second.syncSelectedIdAfter, ALIEN, 'the remounted controller must select independently');
    assert.ok(visibleText(second.html).includes('the Aliens'), 'the remounted dossier must render the selection');
  });
});
