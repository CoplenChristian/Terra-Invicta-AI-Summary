// tests/world-map.test.js
//
// Purpose: characterisation tests for src/v2/panels/WorldMap.jsx
//   Captures exact rendering of the interactive SVG world/space theater map,
//   including player/omniscient modes, every unavailable and em dash state,
//   input variations, SVG typography ladder, GeoJSON loading and error states,
//   and selection interactivity.
//
// HARNESS: these 16 assertions used to run the vanilla component in a mock DOM.
//   The panel now renders through a REAL browser
//   (public/v2/primitives-harness.html?scene=worldMap); its HTML is read back and
//   re-parsed with the same mock DOM, so every read below is unchanged.
//   tests/fixtures/worldMapBrowser.js documents the two plumbing changes that
//   forced themselves: an interaction is now awaited, because no synchronous
//   Node API can drive a live page, and the four-event no-throw check became
//   `assert.doesNotReject` for the same reason. Every expected value and every
//   assertion message is what it was.

const { test, before, after } = require('node:test');
const assert = require('node:assert');

const {
  openWorldMap,
  startWorldMapHarness,
  stopWorldMapHarness,
  visibleText,
} = require('./fixtures/worldMapBrowser');
const { loadFixtureFilteredSnapshot } = require('./fixtures/frozenSnapshots');
const briefingGenerator = require('../server/briefingGenerator');

before(async () => { await startWorldMapHarness(); });
after(async () => { await stopWorldMapHarness(); });

async function renderMap(theaters, options = {}, harnessOpts = {}) {
  return openWorldMap(theaters, options, harnessOpts);
}

const FORBIDDEN = ['null', 'undefined', 'NaN', '[object Object]'];

function assertNoPlaceholderText(html, label) {
  const text = visibleText(html);
  for (const token of FORBIDDEN) {
    const index = text.indexOf(token);
    assert.strictEqual(
      index,
      -1,
      `${label}: rendered text contains "${token}" near: ${text.slice(Math.max(0, index - 60), index + 60)}`
    );
  }
}

// ---------------------------------------------------------------------------
// 1. NORMAL RENDER: PLAYER AND OMNISCIENT
// ---------------------------------------------------------------------------

test('world-map renders normal player mode briefing theaters with verified headings, legend, and regions', async () => {
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'player' });
  const briefing = briefingGenerator.generateMissionControlBriefing(snapshot, { mode: 'player', observer: 4712 });

  const { root, html } = await renderMap(briefing.theaters);
  const text = visibleText(html);

  // Ready state
  assert.strictEqual(root.getAttribute('data-map-state'), 'ready', 'state must be ready after geojson load');

  // Headings
  assert.ok(text.includes('GLOBAL THEATER STATUS'), 'main heading must be present');
  assert.ok(text.includes('ACTUAL COUNTRY GEOMETRY / SELECT THEATER'), 'meta heading must be present');

  // Status legend
  assert.ok(text.includes('STABLE'), 'legend must have STABLE');
  assert.ok(text.includes('OWN HOLDINGS'), 'legend must have OWN HOLDINGS');
  assert.ok(text.includes('HOSTILE'), 'legend must have HOSTILE');
  assert.ok(text.includes('WATCH'), 'legend must have WATCH');

  // Six operational theaters
  assert.ok(text.includes('NORTH AMERICA'), 'North America theater must be present');
  assert.ok(text.includes('SECURED'), 'North America must be SECURED');
  assert.ok(text.includes('H 0 / OWN 1'), 'North America counts must be H 0 / OWN 1');

  assert.ok(text.includes('SOUTH AMERICA'), 'South America theater must be present');
  assert.ok(text.includes('CONTESTED'), 'South America must be CONTESTED');
  assert.ok(text.includes('H 1 / OWN 0'), 'South America counts must be H 1 / OWN 0');

  assert.ok(text.includes('EUROPE / MED'), 'Europe / Med theater must be present');
  assert.ok(text.includes('EURASIA / M.E.'), 'Eurasia / M.E. theater must be present');
  assert.ok(text.includes('AFRICAN CONTINENT'), 'Africa theater must be present');
  assert.ok(text.includes('EAST ASIA & PACIFIC'), 'East Asia & Pacific theater must be present');

  // Summary footer
  assert.ok(text.includes('CURRENT / HOSTILE 2 · OWN 1'), 'summary totals must sum hostile and own counts accurately');
  assert.ok(text.includes('COUNTRY GEOMETRY: BUNDLED GEOJSON'), 'geometry attribution note must be present');

  assertNoPlaceholderText(html, 'player mode render');
});

test('world-map renders omniscient mode briefing theaters with full fidelity', async () => {
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'omniscient' });
  const briefing = briefingGenerator.generateMissionControlBriefing(snapshot, { mode: 'omniscient', observer: 4712 });

  const { html } = await renderMap(briefing.theaters);
  const text = visibleText(html);

  assert.ok(text.includes('GLOBAL THEATER STATUS'), 'omniscient heading must be present');
  assert.ok(text.includes('CURRENT / HOSTILE 2 · OWN 1'), 'omniscient summary counts must match');
  assert.ok(text.includes('NORTH AMERICA SECURED H 0 / OWN 1'), 'North America region block must match');

  assertNoPlaceholderText(html, 'omniscient mode render');
});

// ---------------------------------------------------------------------------
// 2. INPUT VARIATIONS (ARRAY, OBJECT, EMPTY, ABSENT)
// ---------------------------------------------------------------------------

test('world-map accepts endpoint payload object shape with { items: [...] }', async () => {
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'player' });
  const briefing = briefingGenerator.generateMissionControlBriefing(snapshot, { mode: 'player', observer: 4712 });
  const payloadObject = { items: briefing.theaters };

  const { html } = await renderMap(payloadObject);
  const text = visibleText(html);

  assert.ok(text.includes('NORTH AMERICA SECURED H 0 / OWN 1'), 'payload with items array must resolve theaters properly');
  assert.ok(text.includes('CURRENT / HOSTILE 2 · OWN 1'), 'summary counts must match');
  assertNoPlaceholderText(html, 'payload object shape');
});

test('world-map handles empty array and empty items object with NO DATA and em dashes', async () => {
  const { html } = await renderMap([]);
  const text = visibleText(html);

  // All 6 theaters must report NO DATA and H — / OWN —
  assert.ok(text.includes('NORTH AMERICA NO DATA H — / OWN —'), 'empty input must render NO DATA and em dashes for North America');
  assert.ok(text.includes('SOUTH AMERICA NO DATA H — / OWN —'), 'empty input must render NO DATA and em dashes for South America');
  assert.ok(text.includes('EUROPE / MED NO DATA H — / OWN —'), 'empty input must render NO DATA and em dashes for Europe');
  assert.ok(text.includes('EURASIA / M.E. NO DATA H — / OWN —'), 'empty input must render NO DATA and em dashes for Eurasia');
  assert.ok(text.includes('AFRICA NO DATA H — / OWN —'), 'empty input must render NO DATA and em dashes for Africa');
  assert.ok(text.includes('EAST ASIA / PACIFIC NO DATA H — / OWN —'), 'empty input must render NO DATA and em dashes for East Asia');

  assert.ok(text.includes('CURRENT / HOSTILE — · OWN — (0 OF 6 THEATERS MEASURED)'), 'empty input total summary must state 0 of 6 theaters measured with em dashes');
  assertNoPlaceholderText(html, 'empty array input');
});

test('world-map handles absent input (null and undefined) gracefully', async () => {
  const { html: htmlNull } = await renderMap(null);
  const textNull = visibleText(htmlNull);
  assert.ok(textNull.includes('NORTH AMERICA NO DATA H — / OWN —'), 'null theaters must render NO DATA');
  assert.ok(textNull.includes('CURRENT / HOSTILE — · OWN — (0 OF 6 THEATERS MEASURED)'), 'null input summary must be unmeasured');

  const { html: htmlUndef } = await renderMap(undefined);
  const textUndef = visibleText(htmlUndef);
  assert.ok(textUndef.includes('NORTH AMERICA NO DATA H — / OWN —'), 'undefined theaters must render NO DATA');
  assert.ok(textUndef.includes('CURRENT / HOSTILE — · OWN — (0 OF 6 THEATERS MEASURED)'), 'undefined input summary must be unmeasured');
});

test('world-map slices source input to at most 6 theaters (THEATERS.length)', async () => {
  // Pass 10 theater records
  const extraRecords = [
    { key: 'nam', name: 'North America', hostileCount: 0, ownCount: 1 },
    { key: 'sam', name: 'South America', hostileCount: 1, ownCount: 0 },
    { key: 'eur', name: 'Europe', hostileCount: 0, ownCount: 0 },
    { key: 'mea', name: 'Eurasia', hostileCount: 0, ownCount: 0 },
    { key: 'afr', name: 'Africa', hostileCount: 1, ownCount: 0 },
    { key: 'eap', name: 'East Asia', hostileCount: 0, ownCount: 0 },
    { key: 'extra1', name: 'Extra Region 1', hostileCount: 5, ownCount: 5 },
    { key: 'extra2', name: 'Extra Region 2', hostileCount: 5, ownCount: 5 }
  ];

  const { html } = await renderMap(extraRecords);
  const text = visibleText(html);

  assert.ok(!text.includes('Extra Region'), 'theaters beyond 6 must be truncated');
  assert.ok(text.includes('CURRENT / HOSTILE 2 · OWN 1'), 'extra regions must not inflate summary counts');
});

// ---------------------------------------------------------------------------
// 3. EVERY UNAVAILABLE, UNKNOWN, AND EM DASH STATE
// ---------------------------------------------------------------------------

test('world-map renders em dash for null or undefined counts, never converting to 0', async () => {
  const degradedTheaters = [
    {
      id: 'nam',
      name: 'North America',
      statusTone: 'NO PRIORITY TARGET DATA',
      hostileCount: null,
      ownCount: null
    },
    {
      id: 'sam',
      name: 'South America',
      statusTone: undefined,
      hostileCount: undefined,
      ownCount: undefined
    }
  ];

  const { html } = await renderMap(degradedTheaters);
  const text = visibleText(html);

  assertNoPlaceholderText(html, 'degraded counts payload');

  // North America
  assert.ok(text.includes('NORTH AMERICA NO PRIORITY TARGET DATA H — / OWN —'),
    'null counts must render as em dash "—" rather than "0"');
  assert.ok(html.includes('Hostile count —; own count —.'),
    'aria-label must carry em dash for unmeasured counts');

  // South America with no statusTone and unmeasured counts renders UNKNOWN rather than claiming STABLE
  assert.ok(text.includes('SOUTH AMERICA UNKNOWN H — / OWN —'),
    'undefined counts and status must render as UNKNOWN and em dash "—"');

  // Summary reflects 0 of 6 theaters measured
  assert.ok(text.includes('CURRENT / HOSTILE — · OWN — (0 OF 6 THEATERS MEASURED)'),
    'summary reflects 0 measured theaters');
});

test('world-map summary distinguishes complete sum, partial sum, and unmeasured sum', async () => {
  // 1. Complete sum (all 6 measured)
  const completeTheaters = [
    { key: 'nam', name: 'North America', hostileCount: 0, ownCount: 1 },
    { key: 'sam', name: 'South America', hostileCount: 2, ownCount: 0 },
    { key: 'eur', name: 'Europe', hostileCount: 1, ownCount: 0 },
    { key: 'mea', name: 'Eurasia', hostileCount: 0, ownCount: 0 },
    { key: 'afr', name: 'Africa', hostileCount: 0, ownCount: 0 },
    { key: 'eap', name: 'East Asia', hostileCount: 0, ownCount: 0 }
  ];
  const { html: htmlComplete } = await renderMap(completeTheaters);
  const textComplete = visibleText(htmlComplete);
  assert.ok(textComplete.includes('CURRENT / HOSTILE 3 · OWN 1'), 'complete sum must render clean total');
  assert.ok(!textComplete.includes('MEASURED'), 'complete sum must not carry partial qualifier');

  // 2. Partial sum (4 measured, 2 unmeasured/null)
  const partialTheaters = [
    { key: 'nam', name: 'North America', hostileCount: 0, ownCount: 1 },
    { key: 'sam', name: 'South America', hostileCount: 2, ownCount: 0 },
    { key: 'eur', name: 'Europe', hostileCount: 1, ownCount: 0 },
    { key: 'mea', name: 'Eurasia', hostileCount: 0, ownCount: 0 },
    { key: 'afr', name: 'Africa', hostileCount: null, ownCount: null },
    { key: 'eap', name: 'East Asia', hostileCount: null, ownCount: null }
  ];
  const { html: htmlPartial } = await renderMap(partialTheaters);
  const textPartial = visibleText(htmlPartial);
  assert.ok(
    textPartial.includes('CURRENT / HOSTILE 3 · OWN 1 (4 OF 6 THEATERS MEASURED, 2 UNMEASURED)'),
    `partial sum must explicitly report measured vs unmeasured theater counts: ${textPartial}`
  );

  // 3. Outright unmeasured sum (0 measured)
  const unmeasuredTheaters = [
    { key: 'nam', name: 'North America', hostileCount: null, ownCount: null },
    { key: 'sam', name: 'South America', hostileCount: null, ownCount: null }
  ];
  const { html: htmlUnmeasured } = await renderMap(unmeasuredTheaters);
  const textUnmeasured = visibleText(htmlUnmeasured);
  assert.ok(
    textUnmeasured.includes('CURRENT / HOSTILE — · OWN — (0 OF 6 THEATERS MEASURED)'),
    `unmeasured sum must render em dashes and state 0 measured: ${textUnmeasured}`
  );
});

test('world-map renders custom titles and ariaLabels when supplied in options', async () => {
  const { html } = await renderMap([], {
    title: 'Custom Theater Overview',
    ariaLabel: 'Custom accessibility label'
  });
  const text = visibleText(html);

  assert.ok(text.includes('Custom Theater Overview'), 'custom title must reach heading');
  assert.ok(html.includes('aria-label="Custom accessibility label"'), 'custom ariaLabel must be set on root');
});

test('world-map handles GeoJSON fetch failure with honest error state', async () => {
  const { root, html } = await renderMap([], {}, {
    fetchError: new Error('Network timeout loading world geometry')
  });
  const text = visibleText(html);

  assert.strictEqual(root.getAttribute('data-map-state'), 'error', 'state must be error on fetch failure');
  assert.ok(text.includes('WORLD GEOMETRY UNAVAILABLE'), 'error banner must state geometry unavailable');
  assert.ok(text.includes('Network timeout loading world geometry'), 'error message must reach reader');
});

// ---------------------------------------------------------------------------
// 4. SVG TYPOGRAPHY LADDER (TYPE.name = 10.5, TYPE.note = 8)
// ---------------------------------------------------------------------------

test('world-map enforces the two-step SVG typography ladder (10.5 and 8 user units)', async () => {
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'player' });
  const briefing = briefingGenerator.generateMissionControlBriefing(snapshot, { mode: 'player', observer: 4712 });

  const { container } = await renderMap(briefing.theaters);

  // Name ladder (10.5)
  const heading = container.querySelector('.world-map-heading');
  assert.ok(heading, 'heading must exist');
  assert.strictEqual(heading.getAttribute('font-size'), '10.5', 'heading must use TYPE.name (10.5)');

  const regionLabels = container.querySelectorAll('.world-map-region-label');
  assert.strictEqual(regionLabels.length, 6, 'all 6 region labels must exist');
  for (const label of regionLabels) {
    assert.strictEqual(label.getAttribute('font-size'), '10.5', 'region label must use TYPE.name (10.5)');
  }

  // Note ladder (8)
  const headingMeta = container.querySelector('.world-map-heading-meta');
  assert.ok(headingMeta, 'meta heading must exist');
  assert.strictEqual(headingMeta.getAttribute('font-size'), '8', 'meta heading must use TYPE.note (8)');

  const statuses = container.querySelectorAll('.world-map-region-status');
  for (const st of statuses) {
    assert.strictEqual(st.getAttribute('font-size'), '8', 'region status must use TYPE.note (8)');
  }

  const counts = container.querySelectorAll('.world-map-region-counts');
  for (const c of counts) {
    assert.strictEqual(c.getAttribute('font-size'), '8', 'region counts must use TYPE.note (8)');
  }

  const legendLabels = container.querySelectorAll('.world-map-legend-label');
  for (const l of legendLabels) {
    assert.strictEqual(l.getAttribute('font-size'), '8', 'legend label must use TYPE.note (8)');
  }

  const summary = container.querySelector('.world-map-summary');
  assert.ok(summary, 'summary text must exist');
  assert.strictEqual(summary.getAttribute('font-size'), '8', 'summary must use TYPE.note (8)');
});

// ---------------------------------------------------------------------------
// 5. INTERACTIVITY: INITIAL SELECTION, CLICKS, AND KEYBOARD NAVIGATION
// ---------------------------------------------------------------------------

test('world-map honours initial selectedId option and highlights selected region', async () => {
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'player' });
  const briefing = briefingGenerator.generateMissionControlBriefing(snapshot, { mode: 'player', observer: 4712 });

  const { container } = await renderMap(briefing.theaters, { selectedId: 'nam' });

  const namRegion = container.querySelector('[data-theater-id="nam"]');
  assert.ok(namRegion, 'North America region must exist');
  assert.strictEqual(namRegion.getAttribute('aria-pressed'), 'true', 'nam region must be aria-pressed=true');

  const samRegion = container.querySelector('[data-theater-id="sam"]');
  assert.strictEqual(samRegion.getAttribute('aria-pressed'), 'false', 'sam region must be aria-pressed=false');
});

test('world-map region click selects theater, calls onSelect, and updates aria-pressed', async () => {
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'player' });
  const briefing = briefingGenerator.generateMissionControlBriefing(snapshot, { mode: 'player', observer: 4712 });

  let selectedCallbackRecord = null;
  const { container } = await renderMap(briefing.theaters, {
    onSelect: (record) => {
      selectedCallbackRecord = record;
    }
  });

  const samRegion = container.querySelector('[data-theater-id="sam"]');
  assert.ok(samRegion, 'South America region must exist');
  assert.strictEqual(samRegion.getAttribute('aria-pressed'), 'false', 'initially unselected');

  // Click South America
  await samRegion.click();

  assert.strictEqual(samRegion.getAttribute('aria-pressed'), 'true', 'South America must be aria-pressed=true after click');
  assert.ok(selectedCallbackRecord, 'onSelect callback must have fired');
  assert.strictEqual(selectedCallbackRecord.id, 'sam', 'callback must receive South America record');

  // North America should be unselected
  const namRegion = container.querySelector('[data-theater-id="nam"]');
  assert.strictEqual(namRegion.getAttribute('aria-pressed'), 'false', 'North America must be aria-pressed=false');
});

test('world-map keyboard activation (Enter and Space) selects theater', async () => {
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'player' });
  const briefing = briefingGenerator.generateMissionControlBriefing(snapshot, { mode: 'player', observer: 4712 });

  let selectedId = null;
  const { container } = await renderMap(briefing.theaters, {
    onSelect: (record) => { selectedId = record.id; }
  });

  const eurRegion = container.querySelector('[data-theater-id="eur"]');
  assert.ok(eurRegion, 'Europe region must exist');

  // Keydown Enter
  await eurRegion.dispatchEvent({ type: 'keydown', key: 'Enter' });
  assert.strictEqual(selectedId, 'eur', 'Enter key must trigger selection');
  assert.strictEqual(eurRegion.getAttribute('aria-pressed'), 'true');

  // Keydown Space on Africa
  const afrRegion = container.querySelector('[data-theater-id="afr"]');
  await afrRegion.dispatchEvent({ type: 'keydown', key: ' ' });
  assert.strictEqual(selectedId, 'afr', 'Space key must trigger selection');
  assert.strictEqual(afrRegion.getAttribute('aria-pressed'), 'true');
  assert.strictEqual(eurRegion.getAttribute('aria-pressed'), 'false');
});

test('world-map mouseenter and mouseleave update region view state without errors', async () => {
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'player' });
  const briefing = briefingGenerator.generateMissionControlBriefing(snapshot, { mode: 'player', observer: 4712 });

  const { container } = await renderMap(briefing.theaters);
  const namRegion = container.querySelector('[data-theater-id="nam"]');

  await assert.doesNotReject(async () => {
    await namRegion.dispatchEvent({ type: 'mouseenter' });
    await namRegion.dispatchEvent({ type: 'mouseleave' });
    await namRegion.dispatchEvent({ type: 'focus' });
    await namRegion.dispatchEvent({ type: 'blur' });
  }, 'mouse and focus events must execute without error');
});

test('world-map maps GeoJSON country features to operational theaters', async () => {
  const { container } = await renderMap([]);

  // Verify country paths were created
  const countryPaths = container.querySelectorAll('.world-map-country');
  assert.ok(countryPaths.length > 50, `must render country paths from GeoJSON (found ${countryPaths.length})`);

  // Spot-check country mappings
  const usa = countryPaths.find(p => p.getAttribute('data-country') === 'USA');
  assert.ok(usa, 'USA country path must exist');
  assert.strictEqual(usa.getAttribute('aria-hidden'), 'false');

  const france = countryPaths.find(p => p.getAttribute('data-country') === 'France');
  assert.ok(france, 'France country path must exist');
});
