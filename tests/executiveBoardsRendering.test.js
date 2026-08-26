// tests/executiveBoardsRendering.test.js
//
// Purpose: thin browser proof that the executive-boards React panel mounts through
//   MissionControlBoards and preserves key unavailable / observer affordances.
//   Full characterisation lives in tests/executiveBoards.test.js.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { chromium } = require('playwright');

const { ensurePrimitivesHarnessBuilt } = require('./fixtures/ensurePrimitivesHarness.js');
const { renderBoardOnPage, tryBoardOnPage, HARNESS_PATH } = require('./fixtures/executiveBoardsBrowser');
const { loadFixtureFilteredSnapshot } = require('./fixtures/frozenSnapshots');
const briefingGenerator = require('../server/briefingGenerator');

const OBSERVER = 4712;

let server;
let browser;
let page;

before(async () => {
  ensurePrimitivesHarnessBuilt();
  const app = require('../server/index.js');
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}${HARNESS_PATH}?scene=executiveBoards`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForSelector('[data-testid="executive-boards-harness"]', { timeout: 15000 });
});

after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

function briefingFor(mode) {
  const snapshot = loadFixtureFilteredSnapshot({ mode });
  const briefing = briefingGenerator.generateMissionControlBriefing(snapshot, null, { mode, observer: OBSERVER });
  return { snapshot, briefing };
}

test('MissionControlBoards exposes all seven render entry points', async () => {
  const keys = await page.evaluate(() => Object.keys(window.MissionControlBoards || {}).sort());
  assert.deepEqual(keys, [
    'renderCapabilityMatrix',
    'renderFactionLedger',
    'renderLogisticsBoard',
    'renderNationQueue',
    'renderOperationsBoard',
    'renderResearchWatchlist',
    'renderTheaterBoard',
  ]);
});

test('faction ledger mounts with board note and observer row highlight', async () => {
  const { snapshot } = briefingFor('player');
  const { text, html } = await renderBoardOnPage(page, 'renderFactionLedger', snapshot);

  assert.ok(text.includes('LEDGER / CURRENT STATE'));
  assert.ok(html.includes('data-board-faction-id="4712"'));
  assert.ok(html.match(/<tr class="is-observer"[^>]*data-board-faction-id="4712"/));
});

test('player mode hate stays UNAVAILABLE rather than leaking a measured figure', async () => {
  const { snapshot } = briefingFor('player');
  const { text } = await renderBoardOnPage(page, 'renderFactionLedger', snapshot);

  assert.ok(text.includes('HATE UNAVAILABLE'));
  assert.ok(!text.includes('HATE 42.7'));
});

test('null hate estimate renders UNAVAILABLE, not a confident zero', async () => {
  const { text } = await renderBoardOnPage(page, 'renderFactionLedger', {
    observerFactionId: '1',
    factions: [{
      ID: '1', displayName: 'Initiative', totalGdp: 10,
      alienHate: { visibleEstimate: null }, assessedAlienHateOfMe: null,
    }],
  });

  assert.ok(text.includes('HATE UNAVAILABLE'));
  assert.ok(!text.includes('HATE 0'));
});

test('logistics board renders honest UNAVAILABLE for unmeasured spend and runway', async () => {
  const { text } = await renderBoardOnPage(page, 'renderLogisticsBoard', {}, {
    resourcePosition: {
      resources: {
        wat: {
          label: 'Water', stock: 5, grossPerMonth: 1,
          spendPerMonth: null, underConstruction: [], topProducers: [], runwayDays: null,
        },
      },
    },
  });

  assert.ok(text.includes('UNAVAILABLE'));
  assert.ok(text.includes('Spent / committed'));
});

test('absent snapshot still throws on unguarded observerFactionId dereference', async () => {
  const capabilityMessage = await tryBoardOnPage(page, 'renderCapabilityMatrix', undefined, undefined);
  assert.match(capabilityMessage, /observerFactionId/);

  const nationMessage = await tryBoardOnPage(page, 'renderNationQueue', undefined, undefined);
  assert.match(nationMessage, /observerFactionId/);

  const researchMessage = await tryBoardOnPage(page, 'renderResearchWatchlist', undefined);
  assert.match(researchMessage, /observerFactionId/);
});
