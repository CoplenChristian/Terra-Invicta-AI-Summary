// tests/worldMap.test.js
//
// Purpose: thin browser suite for the WorldMap React panel — only the five
//   things tests/world-map.test.js cannot reach.
//
//   That file is the characterisation net: 16 tests, every rendered figure, both
//   modes, every em-dash state, the SVG type ladder and the whole interaction
//   contract, all through this same browser harness. Nothing here re-states any
//   of it. What is left over is the migration itself:
//
//   1. the vanilla component is actually gone and the shell no longer loads it,
//   2. `window.WorldTheaterMap.render` now resolves to the React panel and still
//      takes an element OR a selector string, and still clears the
//      `.world-map-fallback` the shell parks in the mount,
//   3. defect #2's distinction is STRUCTURAL, not just a glyph — a partial sum
//      is labelled as one on the element, so a consumer that is not reading
//      pixels can still tell a complete total from an incomplete one,
//   4. the 6-slot cap announces itself instead of dropping the seventh record
//      silently,
//   5. a theater with no record is not announced to a screen reader as selected
//      — the vanilla `record === selectedRecord` test compared null to null and
//      pressed all six.

'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  openWorldMap,
  startWorldMapHarness,
  stopWorldMapHarness,
  HARNESS_SELECTOR,
} = require('./fixtures/worldMapBrowser');

const repoRoot = path.resolve(__dirname, '..');

before(async () => { await startWorldMapHarness(); });
after(async () => { await stopWorldMapHarness(); });

/**
 * How long the two React roots get to commit before this test calls it a failure.
 *
 * Deliberately a bound on a CONDITION, not a fixed number of animation frames.
 * `mountReactPanel` calls `createRoot(container).render(...)`, and React 18
 * commits a concurrent root through its own scheduler rather than on the next
 * frame, so "await two rAFs" was a guess about how long two roots need. Under
 * the full 40-file browser pass at --test-concurrency=2 the guess was sometimes
 * wrong and the SECOND mount — the selector form — was the one that lost:
 * measured 491/492 on 2026-08-26 with `selectorMounted` false, while the same
 * file passed 5/5 in isolation. Raising the frame count would only move the
 * flake; waiting on the condition removes it, and the bound keeps a genuinely
 * broken mount path failing loudly instead of hanging.
 */
const MOUNT_TIMEOUT_MS = 20000;

const SIX_MEASURED = [
  { key: 'nam', name: 'North America', hostileCount: 0, ownCount: 1 },
  { key: 'sam', name: 'South America', hostileCount: 2, ownCount: 0 },
  { key: 'eur', name: 'Europe', hostileCount: 1, ownCount: 0 },
  { key: 'mea', name: 'Eurasia', hostileCount: 0, ownCount: 0 },
  { key: 'afr', name: 'Africa', hostileCount: 0, ownCount: 0 },
  { key: 'eap', name: 'East Asia', hostileCount: 0, ownCount: 0 },
];

test('the vanilla world-map component is deleted and the shell no longer loads it', () => {
  const vanillaPath = path.join(repoRoot, 'public', 'v2', 'js', 'components', 'world-map.js');
  assert.equal(
    fs.existsSync(vanillaPath),
    false,
    'public/v2/js/components/world-map.js must be gone — while it exists it is what renders',
  );

  const shell = fs.readFileSync(path.join(repoRoot, 'public', 'v2', 'index.html'), 'utf8');
  const commandPanel = fs.readFileSync(
    path.join(repoRoot, 'src', 'v2', 'panels', 'CommandPanel.jsx'),
    'utf8',
  );
  assert.equal(
    shell.includes('components/world-map.js'),
    false,
    'the shell must not carry a <script> tag for the deleted component',
  );
  assert.ok(
    shell.includes('id="commandPlanner"'),
    'the COMMAND shell mount must exist in index.html',
  );
  assert.ok(
    commandPanel.includes('className="init-map-container"'),
    'the mount the controller resolves must still exist in the COMMAND React shell',
  );
  assert.ok(
    commandPanel.includes('world-map-fallback'),
    'the controller-owned absent-data fallback must still be in the COMMAND shell',
  );
});

test('window.WorldTheaterMap.render mounts the React panel, by element and by selector, clearing the fallback', async () => {
  const view = await openWorldMap([], {});

  const requested = await view.page.evaluate(() => {
    const makeMount = (id) => {
      const host = document.createElement('div');
      host.id = id;
      host.className = 'init-map-container';
      const fallback = document.createElement('div');
      fallback.className = 'world-map-fallback';
      fallback.textContent = 'REAL WORLD MAP INITIALIZING…';
      host.appendChild(fallback);
      document.body.appendChild(host);
      return host;
    };

    const globalIsFunction = typeof window.WorldTheaterMap?.render === 'function';

    const byElement = makeMount('probe-by-element');
    window.WorldTheaterMap.render(byElement, [{ id: 'nam', name: 'North America', hostileCount: 0, ownCount: 1 }], {});

    makeMount('probe-by-selector');
    window.WorldTheaterMap.render('#probe-by-selector', [], {});

    return { globalIsFunction };
  });

  // Wait for BOTH roots to have committed, not for a fixed number of frames.
  // A timeout here is a failure with a named cause — never a fall-through to a
  // pass, and never a quietly-slow mount reported as a fast one.
  try {
    await view.page.waitForFunction(
      () => !!document.querySelector('#probe-by-element .world-map')
        && !!document.querySelector('#probe-by-selector .world-map'),
      undefined,
      { timeout: MOUNT_TIMEOUT_MS },
    );
  } catch (cause) {
    const seen = await view.page.evaluate(() => ({
      element: !!document.querySelector('#probe-by-element .world-map'),
      selector: !!document.querySelector('#probe-by-selector .world-map'),
    }));
    throw new Error(
      `window.WorldTheaterMap.render did not commit both React roots within ${MOUNT_TIMEOUT_MS}ms — `
      + `render(element, ...) mounted: ${seen.element}, render(selectorString, ...) mounted: ${seen.selector}. `
      + 'This is a mount failure, not a slow machine: the wait is on the condition, not on a frame count.',
      { cause },
    );
  }

  const result = {
    ...requested,
    ...await view.page.evaluate(() => {
      const byElement = document.getElementById('probe-by-element');
      const bySelector = document.getElementById('probe-by-selector');
      return {
        elementMounted: !!byElement.querySelector('.world-map'),
        selectorMounted: !!bySelector.querySelector('.world-map'),
        elementFallbackGone: !byElement.querySelector('.world-map-fallback'),
        selectorFallbackGone: !bySelector.querySelector('.world-map-fallback'),
        elementHeading: byElement.querySelector('.world-map-heading')?.textContent ?? null,
      };
    }),
  };

  assert.equal(result.globalIsFunction, true, 'window.WorldTheaterMap.render must come from the React bundle');
  assert.equal(result.elementMounted, true, 'render(element, ...) must mount the panel');
  assert.equal(result.selectorMounted, true, 'render(selectorString, ...) must still resolve the container');
  assert.equal(result.elementFallbackGone, true, 'the REAL WORLD MAP INITIALIZING… fallback must be cleared on mount');
  assert.equal(result.selectorFallbackGone, true, 'the fallback must be cleared for the selector form too');
  assert.equal(result.elementHeading, 'GLOBAL THEATER STATUS', 'the mounted panel must be the real one, not an empty shell');
});

test('the summary carries its completeness as data, not only as a glyph (defect #2)', async () => {
  const complete = await openWorldMap(SIX_MEASURED, {});
  const completeState = await complete.page.evaluate((sel) => {
    const node = document.querySelector(`${sel} .world-map-summary`);
    return node && {
      summary: node.getAttribute('data-summary-state'),
      hostileMeasured: node.getAttribute('data-hostile-measured-count'),
      ownMeasured: node.getAttribute('data-own-measured-count'),
      theaters: node.getAttribute('data-theater-count'),
    };
  }, HARNESS_SELECTOR);

  assert.deepEqual(
    completeState,
    { summary: 'complete', hostileMeasured: '6', ownMeasured: '6', theaters: '6' },
    'a total covering all six theaters must say so on the element',
  );

  const partial = await openWorldMap(
    SIX_MEASURED.map((row, index) => (index >= 4 ? { ...row, hostileCount: null, ownCount: null } : row)),
    {},
  );
  const partialState = await partial.page.evaluate((sel) => {
    const node = document.querySelector(`${sel} .world-map-summary`);
    const counts = [...document.querySelectorAll(`${sel} .world-map-region-counts`)]
      .map((n) => `${n.getAttribute('data-hostile-state')}/${n.getAttribute('data-own-state')}`);
    return { summary: node.getAttribute('data-summary-state'), hostileMeasured: node.getAttribute('data-hostile-measured-count'), counts };
  }, HARNESS_SELECTOR);

  assert.equal(partialState.summary, 'partial', 'a sum that skipped two theaters must not present as complete');
  assert.equal(partialState.hostileMeasured, '4', 'the element must carry how many theaters the sum covers');
  assert.deepEqual(
    partialState.counts,
    ['measured/measured', 'measured/measured', 'measured/measured', 'measured/measured', 'absent/absent', 'absent/absent'],
    'each per-theater count line must declare presence per axis, so the dash cannot be mistaken for a zero',
  );

  const unmeasured = await openWorldMap([{ key: 'nam', name: 'North America', hostileCount: null, ownCount: null }], {});
  const unmeasuredState = await unmeasured.page.evaluate((sel) => (
    document.querySelector(`${sel} .world-map-summary`).getAttribute('data-summary-state')
  ), HARNESS_SELECTOR);
  assert.equal(unmeasuredState, 'unmeasured', 'a wholly unread axis must be marked unmeasured, never summed to zero');
});

test('the six-slot cap announces itself rather than dropping the seventh record silently', async () => {
  const eight = [...SIX_MEASURED,
    { key: 'extra1', name: 'Extra Region 1', hostileCount: 5, ownCount: 5 },
    { key: 'extra2', name: 'Extra Region 2', hostileCount: 5, ownCount: 5 },
  ];
  const view = await openWorldMap(eight, {});
  const counts = await view.page.evaluate((sel) => {
    const root = document.querySelector(`${sel} .world-map`);
    return {
      total: root.getAttribute('data-theater-total-count'),
      omitted: root.getAttribute('data-theater-omitted-count'),
    };
  }, HARNESS_SELECTOR);

  assert.deepEqual(counts, { total: '8', omitted: '2' }, 'eight records into six slots must report two omitted');

  const fitting = await openWorldMap(SIX_MEASURED, {});
  const fittingCounts = await fitting.page.evaluate((sel) => {
    const root = document.querySelector(`${sel} .world-map`);
    return {
      total: root.getAttribute('data-theater-total-count'),
      omitted: root.getAttribute('data-theater-omitted-count'),
    };
  }, HARNESS_SELECTOR);
  assert.deepEqual(fittingCounts, { total: '6', omitted: '0' }, 'a payload that fits must report nothing omitted');
});

test('a theater with no record is never announced as selected', async () => {
  const view = await openWorldMap([], {});
  const pressed = await view.page.evaluate((sel) => (
    [...document.querySelectorAll(`${sel} [data-theater-id]`)]
      .map((node) => `${node.getAttribute('data-theater-id')}=${node.getAttribute('aria-pressed')}`)
  ), HARNESS_SELECTOR);

  assert.deepEqual(
    pressed,
    ['nam=false', 'sam=false', 'eur=false', 'mea=false', 'afr=false', 'eap=false'],
    'the vanilla panel compared null to null and pressed all six with no data at all',
  );

  const tabIndexes = await view.page.evaluate((sel) => (
    [...document.querySelectorAll(`${sel} [data-theater-id]`)].map((node) => node.getAttribute('tabindex'))
  ), HARNESS_SELECTOR);
  assert.deepEqual(
    tabIndexes,
    ['-1', '-1', '-1', '-1', '-1', '-1'],
    'a slot with no record must stay out of the tab order, as it did before',
  );
});
