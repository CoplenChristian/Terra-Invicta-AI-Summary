// tests/driveExplorerReactPanel.test.js
//
// Purpose: the thin browser proof that src/v2/panels/DriveExplorer.jsx is the
//   panel that actually renders — it mounts, its honest-absence affordances are
//   real, its controls are wired, and defect #6 stays fixed.
//
// tests/driveExplorer.test.js is the safety net: 46 tests covering the endpoint,
// the two registers, the minimum filters and the panel's markup. Nothing here
// re-characterises any of that. Each test below covers something that file
// cannot:
//
//   1. the panel mounts into #driveExplorer — the id the VIEWS registry uses.
//   2. an UNKNOWN reactor fit is rendered as unknown rather than borrowing a
//      verdict, and the pre-fetch state says LOADING rather than "unavailable".
//   3/4. DEFECT #6 (docs/live-defect-register.md): the vanilla panel rebuilt
//      itself with `container.innerHTML = …` on every client-side re-render and
//      never re-measured, so `is-scrollable` was lost on the first sort while
//      the table still overflowed by 153px at 900px and 353px at 700px. These
//      two pin the fix AND the property tests/missionControlLayout.test.js
//      protects: the hint follows MEASURED overflow, never viewport width.
//   5. the controls are wired — the ported tests drive the store directly, so
//      nothing else proves a real change event reaches React.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const { loadFixtureFilteredSnapshot } = require('./fixtures/frozenSnapshots');
const { buildResourceProjection } = require('../shared/intel/registry.mjs');
const {
  getDriveExplorerHarnessPage,
  closeDriveExplorerHarness,
  renderDriveExplorerOnPage
} = require('./fixtures/driveExplorerBrowser');

const OBSERVER = 4712;

let snapshotCache = null;
function playerSnapshot() {
  if (!snapshotCache) snapshotCache = loadFixtureFilteredSnapshot({ mode: 'player', observer: OBSERVER });
  return snapshotCache;
}

let payloadCache = null;
function payload() {
  if (!payloadCache) {
    payloadCache = buildResourceProjection(playerSnapshot(), 'drive-explorer', { mode: 'player', limit: 1000 });
  }
  return payloadCache;
}

after(async () => { await closeDriveExplorerHarness(); });

/** The wrap/hint measurement, read off the rendered document. */
async function measureScrollHint(page) {
  return page.evaluate(() => {
    const wrap = document.querySelector('#driveExplorer .de-table-wrap');
    const hint = document.querySelector('#driveExplorer .de-scroll-hint');
    return {
      present: Boolean(wrap && hint),
      scrollWidth: wrap ? wrap.scrollWidth : null,
      clientWidth: wrap ? wrap.clientWidth : null,
      overflows: wrap ? wrap.scrollWidth > wrap.clientWidth + 1 : null,
      hinted: hint ? hint.classList.contains('is-scrollable') : null,
      display: hint ? getComputedStyle(hint).display : null
    };
  });
}

async function settle(page) {
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 80)));
  }));
}

test('the React panel mounts into #driveExplorer and renders its headline content', async () => {
  const page = await getDriveExplorerHarnessPage();
  const data = payload();
  await renderDriveExplorerOnPage(page, data);

  const view = await page.evaluate(() => {
    const root = document.getElementById('driveExplorer');
    return {
      mounted: Boolean(root && root.querySelector('.tech-card')),
      title: (root.querySelector('.tech-card-title') || {}).textContent || '',
      header: (root.querySelector('.tech-card-header span') || {}).textContent || '',
      tables: root.querySelectorAll('.de-table').length,
      rows: root.querySelectorAll('.de-table tbody tr').length,
      reconcile: (root.querySelector('.de-reconcile') || {}).textContent || ''
    };
  });

  assert.equal(view.mounted, true, 'the panel must render a card into the registry mount, not an empty wrapper');
  assert.equal(view.title, 'DRIVE EXPLORER');
  assert.equal(view.header, data.selectedDesign.displayName,
    'the header names the design every measurement below is taken against');
  assert.equal(view.tables, 1, 'exactly one catalogue table');
  assert.ok(view.rows > 0, 'and it has rows');
  assert.match(view.reconcile, /drives in the catalogue/,
    'the reconciliation line must be on screen, not only in the payload');
});

test('an unknown reactor fit stays unknown, and the pre-fetch state says LOADING rather than unavailable', async () => {
  const page = await getDriveExplorerHarnessPage();
  const data = payload();

  // `reactor.compatible === null` is the endpoint's third state: neither side of
  // the rule could be read. It must NOT fall through to the compatible branch.
  const rows = data.items.slice(0, 3).map((row) => JSON.parse(JSON.stringify(row)));
  rows[0].reactor = { verdict: 'unknown', compatible: null, requiredPowerPlant: null };
  await renderDriveExplorerOnPage(page, { ...data, items: rows });

  const chips = await page.evaluate(() => Array.from(
    document.querySelectorAll('#driveExplorer .de-table tbody tr:first-child .de-cell--reactor .de-chip'),
    (chip) => ({ text: chip.textContent.trim(), cls: chip.className, title: chip.getAttribute('title') })
  ));
  assert.equal(chips.length, 1);
  assert.equal(chips[0].text, 'UNKNOWN', 'an unevaluable reactor rule renders UNKNOWN, never FITS');
  assert.match(chips[0].cls, /de-chip--unknown/);
  assert.match(chips[0].title, /Unknown is not the same as compatible/);

  // The state before the catalogue lands is LOADING, which is a different claim
  // from "the data could not be loaded".
  const loading = await page.evaluate(async () => {
    const internals = window.MissionControlDriveExplorer._internals;
    internals.patchState({ loading: true });
    await new Promise((resolve) => setTimeout(resolve, 40));
    const root = document.getElementById('driveExplorer');
    const text = root.innerText;
    internals.patchState({ loading: false });
    return text;
  });
  assert.match(loading, /LOADING/);
  assert.match(loading, /Rating every drive in the catalogue against this design/);
  assert.ok(!/could not be loaded/.test(loading),
    'a fetch in flight must not be reported as a failed one');
});

test('defect #6: the scroll hint survives a client-side re-render', async () => {
  const page = await getDriveExplorerHarnessPage();
  await renderDriveExplorerOnPage(page, payload());

  await page.setViewportSize({ width: 900, height: 900 });
  await settle(page);
  const onLoad = await measureScrollHint(page);
  assert.equal(onLoad.present, true, 'the table and its hint must both be rendered');
  assert.equal(onLoad.overflows, true,
    `the catalogue must actually overflow at 900px for this to test anything (${onLoad.scrollWidth}/${onLoad.clientWidth})`);
  assert.equal(onLoad.hinted, true, 'and the hint must be shown on load');

  // The reproduction from the register: a client-side sort. No fetch, so
  // nothing in mission-control.js re-measures — the vanilla panel lost the
  // class here and the table went on overflowing with no affordance.
  await page.selectOption('#driveExplorer [data-de-sort]', 'combat-acceleration');
  await settle(page);
  const afterSort = await measureScrollHint(page);
  assert.equal(afterSort.overflows, true,
    `the table still overflows after the sort (${afterSort.scrollWidth}/${afterSort.clientWidth})`);
  assert.equal(afterSort.hinted, true,
    'and the hint must still be shown — this is defect #6');
  assert.notEqual(afterSort.display, 'none', 'the hint must be visible, not merely classed');

  // The defect's exact shape, forced: clear the measured class by hand, then do
  // a client-side re-render. The vanilla panel replaced the hint element with a
  // fresh one carrying only its base class and never re-measured, so this is the
  // state the reader was left in. The fix is that the re-render re-measures.
  await page.evaluate(() => {
    document.querySelector('#driveExplorer .de-scroll-hint').classList.remove('is-scrollable');
  });
  const cleared = await measureScrollHint(page);
  assert.equal(cleared.hinted, false, 'the probe must actually have cleared the class');
  await page.selectOption('#driveExplorer [data-de-sort]', 'cruise-acceleration');
  await settle(page);
  const remeasured = await measureScrollHint(page);
  assert.equal(remeasured.overflows, true);
  assert.equal(remeasured.hinted, true,
    'a client-side re-render must re-measure the overflow, not inherit whatever the class was');

  // Same at the narrower width the register measured, and after a second kind
  // of client-side re-render (a threshold keystroke, which repaints per input).
  await page.setViewportSize({ width: 700, height: 900 });
  await page.fill('#driveExplorer [data-de-threshold="minDeltaV"]', '1');
  await settle(page);
  const afterThreshold = await measureScrollHint(page);
  assert.equal(afterThreshold.overflows, true,
    `the table still overflows at 700px (${afterThreshold.scrollWidth}/${afterThreshold.clientWidth})`);
  assert.equal(afterThreshold.hinted, true, 'and the hint survives a threshold repaint too');

  await page.fill('#driveExplorer [data-de-threshold="minDeltaV"]', '');
  await page.setViewportSize({ width: 1660, height: 950 });
  await settle(page);
});

test('the scroll hint is driven by measured overflow, not by viewport width', async () => {
  const page = await getDriveExplorerHarnessPage();
  // Two rows and a wide viewport: narrow content that genuinely fits. A
  // width-driven rule would still hide the hint here, so the case that
  // distinguishes the two is the NARROW viewport whose content also fits.
  const data = payload();
  const rows = data.items.slice(0, 2).map((row) => JSON.parse(JSON.stringify(row)));
  await renderDriveExplorerOnPage(page, { ...data, items: rows });

  await page.setViewportSize({ width: 2200, height: 900 });
  await settle(page);
  const wide = await measureScrollHint(page);
  assert.equal(wide.overflows, false,
    `the fixture must actually fit at 2200px for this to test anything (${wide.scrollWidth}/${wide.clientWidth})`);
  assert.equal(wide.hinted, false, 'a table that fits must carry no hint');
  assert.equal(wide.display, 'none', 'and must not be visible');

  // Narrow it until the same content overflows: the hint appears because the
  // measurement changed, and it is the measurement that is asserted.
  await page.setViewportSize({ width: 600, height: 900 });
  await settle(page);
  const narrow = await measureScrollHint(page);
  assert.equal(narrow.overflows, true,
    `the same rows must overflow at 600px (${narrow.scrollWidth}/${narrow.clientWidth})`);
  assert.equal(narrow.hinted, true, 'and the hint follows the measurement, in both directions');

  await page.setViewportSize({ width: 1660, height: 950 });
  await settle(page);
});

test('the sort control re-orders the table without a fetch', async () => {
  const page = await getDriveExplorerHarnessPage();
  await renderDriveExplorerOnPage(page, payload());

  const readTop = () => page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#driveExplorer .de-table tbody tr'))
      .filter((tr) => !tr.classList.contains('de-row--fitted'))
      .slice(0, 6);
    return rows.map((tr) => {
      const cells = tr.querySelectorAll('.de-measured__value');
      return {
        name: (tr.querySelector('.de-name') || {}).textContent || '',
        deltaV: cells.length > 0 ? cells[0].textContent.trim() : null,
        combat: cells.length > 1 ? cells[1].textContent.trim() : null
      };
    });
  });

  const requests = [];
  const listener = (request) => { if (request.url().includes('/api/')) requests.push(request.url()); };
  page.on('request', listener);
  try {
    const byDeltaV = await readTop();
    await page.selectOption('#driveExplorer [data-de-sort]', 'combat-acceleration');
    await settle(page);
    const byCombat = await readTop();

    assert.notDeepEqual(byCombat.map((r) => r.name), byDeltaV.map((r) => r.name),
      'a different sort key must produce a different ordering');
    const combatValues = byCombat.map((row) => Number(row.combat)).filter(Number.isFinite);
    assert.ok(combatValues.length >= 3, 'the combat column must be readable as numbers');
    assert.ok(combatValues.every((value, i) => i === 0 || combatValues[i - 1] >= value),
      `the combat sort must order the combat column descending: ${JSON.stringify(byCombat.map(r => r.combat))}`);
    assert.deepEqual(requests, [],
      'the whole catalogue is already in hand, so a sort must cost no request');
  } finally {
    page.off('request', listener);
    await page.selectOption('#driveExplorer [data-de-sort]', 'delta-v');
    await settle(page);
  }
});
