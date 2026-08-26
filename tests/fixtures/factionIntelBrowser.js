// tests/fixtures/factionIntelBrowser.js
//
// Purpose: Playwright + Express setup for the faction-dossier React browser
//   tests. The dossier is driven by an imperative controller, so this fixture
//   also exposes select / getSelectedId / destroy against the real controller
//   the harness scene published on window.

const http = require('node:http');
const { chromium } = require('playwright');
const { ensurePrimitivesHarnessBuilt } = require('./ensurePrimitivesHarness.js');
const { visibleText } = require('./renderHarness');

const HARNESS_PATH = '/v2/primitives-harness.html';
const TESTID = '[data-testid="faction-intel-harness"]';

/**
 * Mounts the dossier scene with `payload` = { snapshot, briefing, observerId }.
 *
 * A fetch spy is installed before any page script runs: the dossier is a
 * render-only panel and must never reach the network, which the vanilla suite
 * pinned with a stubbed fetch seam.
 */
async function withFactionIntelHarnessPage(payload, run) {
  ensurePrimitivesHarnessBuilt();
  const app = require('../../server/index.js');
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.addInitScript((p) => {
      window.__FACTION_INTEL_PAYLOAD__ = p;
      window.__FACTION_INTEL_FETCH_CALLS__ = [];
      window.__FACTION_INTEL_SELECTIONS__ = [];
      const nativeFetch = window.fetch;
      window.fetch = function spyFetch(...args) {
        window.__FACTION_INTEL_FETCH_CALLS__.push(String(args[0]));
        return nativeFetch.apply(this, args);
      };
    }, payload);
    await page.goto(`http://127.0.0.1:${port}${HARNESS_PATH}?scene=factionIntel`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForSelector(TESTID, { timeout: 15000 });
    return await run(page);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function getHarnessHtml(page) {
  return page.evaluate((selector) => {
    const el = document.querySelector(selector);
    return el ? el.innerHTML : '';
  }, TESTID);
}

async function getHarnessText(page) {
  return visibleText(await getHarnessHtml(page));
}

/** Let React commit the controller-driven re-render before reading the DOM. */
async function settle(page) {
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

/** controller.select(key) — returns the controller's own boolean. */
async function selectFaction(page, key) {
  const ok = await page.evaluate((k) => window.__FACTION_INTEL_CONTROLLER__.select(k), key);
  await settle(page);
  return ok;
}

async function getSelectedId(page) {
  return page.evaluate(() => window.__FACTION_INTEL_CONTROLLER__.getSelectedId());
}

async function destroyController(page) {
  await page.evaluate(() => window.__FACTION_INTEL_CONTROLLER__.destroy());
  await settle(page);
}

/** Element children left inside the harness mount. */
async function harnessChildCount(page) {
  return page.evaluate((selector) => {
    const el = document.querySelector(selector);
    return el ? el.children.length : -1;
  }, TESTID);
}

/**
 * Records every `faction-intel-select` handoff. Installs the same
 * `onFactionIntelSelect` property hook the vanilla dossier called, and listens
 * for the CustomEvent, so both halves of the contract are observed.
 */
async function installSelectionRecorder(page) {
  await page.evaluate((selector) => {
    const el = document.querySelector(selector);
    window.__FACTION_INTEL_SELECTIONS__ = [];
    window.__FACTION_INTEL_EVENTS__ = [];
    el.onFactionIntelSelect = (detail) => {
      window.__FACTION_INTEL_SELECTIONS__.push({
        factionId: detail.factionId,
        observerId: detail.observerId,
        factionName: detail.faction ? detail.faction.displayName : null,
        hasSnapshot: Boolean(detail.snapshot),
      });
    };
    el.addEventListener('faction-intel-select', (event) => {
      window.__FACTION_INTEL_EVENTS__.push({ factionId: event.detail.factionId });
    });
  }, TESTID);
}

async function readSelections(page) {
  return page.evaluate(() => ({
    handoffs: window.__FACTION_INTEL_SELECTIONS__ || [],
    events: window.__FACTION_INTEL_EVENTS__ || [],
  }));
}

async function fetchCalls(page) {
  return page.evaluate(() => window.__FACTION_INTEL_FETCH_CALLS__ || []);
}

module.exports = {
  withFactionIntelHarnessPage,
  getHarnessHtml,
  getHarnessText,
  selectFaction,
  getSelectedId,
  destroyController,
  harnessChildCount,
  installSelectionRecorder,
  readSelections,
  fetchCalls,
  settle,
  visibleText,
  HARNESS_PATH,
  TESTID,
};
