// tests/fixtures/fleetProcurementBrowser.js
//
// Purpose: Playwright + Express setup for the fleet-procurement React browser
//   tests, driving the panel through the same `window.MissionControlFleetProcurement`
//   bridge `public/v2/js/mission-control.js` calls.
//
// `node --test` CANNOT render a React component out of the Vite bundle — three
// earlier migration runs died on `Minified React error #327`. The panel is
// therefore driven in a real browser, exactly like every other migrated panel.
//
// ONE SESSION, NOT ONE PER PAYLOAD. `tests/refitAdvisor.test.js` renders roughly
// a hundred refit cards across four tests and `tests/researchRanking.test.js`
// one whole panel; a browser per render would cost a hundred launches. node:test
// runs top-level tests in a file sequentially, so one lazily-booted page is
// safe. Each owning test file must call `closeFleetProcurementHarness()` from a
// root `after()` hook or the process will not exit.
//
// THREE MOUNTS, DELIBERATELY — see `FleetProcurementScene` in
// `src/v2/primitivesHarness.jsx`:
//
//   #fleetProcurement            — the PRODUCTION mount id, owned by
//                                  public/v2/index.html and driven by the VIEWS
//                                  registry. Fed by
//                                  `window.__FLEET_PROCUREMENT_PAYLOAD__`.
//   #fleet-procurement-test-root — the bench the ported suite re-renders whole
//                                  panels into through the bridge.
//   #fleet-procurement-card-root — one refit card in isolation. The vanilla's
//                                  `renderRefitDesignCard(design)` returned an
//                                  HTML string; React mounts instead, so the
//                                  bridge takes `(root, design)` and this
//                                  fixture reads the markup back out.

const http = require('node:http');
const { chromium } = require('playwright');
const { ensurePrimitivesHarnessBuilt } = require('./ensurePrimitivesHarness.js');
const { visibleText } = require('./renderHarness');

const HARNESS_PATH = '/v2/primitives-harness.html';
const SCENE = 'fleetProcurement';
const HARNESS_TESTID = '[data-testid="fleet-procurement-harness"]';
const TEST_ROOT_ID = 'fleet-procurement-test-root';
const CARD_ROOT_ID = 'fleet-procurement-card-root';

let session = null;

async function startHarness(payload, refitPayload) {
  ensurePrimitivesHarnessBuilt();
  const app = require('../../server/index.js');
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1660, height: 950 } });
  if (payload !== undefined || refitPayload !== undefined) {
    await page.addInitScript((seed) => {
      window.__FLEET_PROCUREMENT_PAYLOAD__ = seed.payload;
      window.__FLEET_PROCUREMENT_REFIT_PAYLOAD__ = seed.refitPayload;
    }, { payload: payload ?? null, refitPayload: refitPayload ?? null });
  }
  await page.goto(`http://127.0.0.1:${port}${HARNESS_PATH}?scene=${SCENE}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForSelector(HARNESS_TESTID, { timeout: 30000 });

  return { server, browser, page, port };
}

/** The shared page. Booted on first use, closed from the file's `after()` hook. */
async function getFleetProcurementHarnessPage() {
  if (!session) session = await startHarness(undefined, undefined);
  return session.page;
}

async function closeFleetProcurementHarness() {
  if (!session) return;
  const { server, browser } = session;
  session = null;
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

/** One page, one seeded payload, torn down afterwards. */
async function withFleetProcurementHarnessPage(payload, refitPayload, run) {
  const own = await startHarness(payload, refitPayload);
  try {
    return await run(own.page);
  } finally {
    await own.browser.close();
    await new Promise((resolve) => own.server.close(resolve));
  }
}

/**
 * Renders one payload into the bench mount through the production bridge and
 * returns the markup a reader's browser actually holds.
 */
async function renderFleetProcurementOnPage(page, payload, refitPayload = null) {
  return page.evaluate(async (args) => {
    const root = document.getElementById(args.rootId);
    if (!root) throw new Error(`${args.rootId} missing`);
    const panel = window.MissionControlFleetProcurement;
    if (!panel || typeof panel.render !== 'function') {
      throw new Error('MissionControlFleetProcurement.render is not available');
    }
    panel.render(root, args.payload, args.refitPayload);
    await new Promise((resolve) => setTimeout(resolve, 40));
    return root.innerHTML;
  }, { payload, refitPayload, rootId: TEST_ROOT_ID });
}

/** The same render, read as `textContent` — no tag-to-space substitution. */
async function renderFleetProcurementTextOnPage(page, payload, refitPayload = null) {
  return page.evaluate(async (args) => {
    const root = document.getElementById(args.rootId);
    const panel = window.MissionControlFleetProcurement;
    panel.render(root, args.payload, args.refitPayload);
    await new Promise((resolve) => setTimeout(resolve, 40));
    return root.textContent;
  }, { payload, refitPayload, rootId: TEST_ROOT_ID });
}

/**
 * One refit card, mounted alone.
 *
 * Stands in for the vanilla `renderRefitDesignCard(design)` string return: the
 * bridge mounts into `root`, and the card's own markup is read back out.
 */
async function renderRefitCardOnPage(page, design) {
  return page.evaluate(async (args) => {
    const root = document.getElementById(args.rootId);
    if (!root) throw new Error(`${args.rootId} missing`);
    const panel = window.MissionControlFleetProcurement;
    if (!panel || typeof panel.renderRefitDesignCard !== 'function') {
      throw new Error('MissionControlFleetProcurement.renderRefitDesignCard is not available');
    }
    panel.renderRefitDesignCard(root, args.design);
    await new Promise((resolve) => setTimeout(resolve, 20));
    return root.innerHTML;
  }, { design, rootId: CARD_ROOT_ID });
}

/** The production mount's own markup, without re-rendering anything. */
async function getProductionMountHtml(page) {
  return page.evaluate(() => {
    const el = document.getElementById('fleetProcurement');
    return el ? el.innerHTML : '';
  });
}

/**
 * Clicks the card's own `Full breakdown` button with the shared detail panel
 * stubbed, and returns whatever the panel was asked to open.
 *
 * The click path is used rather than calling `openProcurementDetails` directly,
 * so the button's handler is covered too — the vanilla wired it with
 * addEventListener after setting innerHTML and a rewrite could drop it silently.
 */
async function openProcurementDetailsByClick(page, payload, refitPayload = null) {
  return page.evaluate(async (args) => {
    const root = document.getElementById(args.rootId);
    const opened = [];
    const realPanel = window.MissionControlDetailPanel;
    window.MissionControlDetailPanel = { open: (options) => opened.push(options) };
    try {
      window.MissionControlFleetProcurement.render(root, args.payload, args.refitPayload);
      await new Promise((resolve) => setTimeout(resolve, 40));
      const button = root.querySelector('[data-fleet-procurement-full]');
      if (!button) throw new Error('the Full breakdown button did not render');
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
      window.MissionControlDetailPanel = realPanel;
    }
    return opened;
  }, { payload, refitPayload, rootId: TEST_ROOT_ID });
}

/**
 * Clicks one refit card's `Refit details` button with the detail panel stubbed.
 *
 * `designId` selects the card inside the whole-panel render, so this exercises
 * the grid's per-card wiring rather than a card mounted alone.
 */
async function openRefitDetailsByClick(page, payload, refitPayload, designId) {
  return page.evaluate(async (args) => {
    const root = document.getElementById(args.rootId);
    const opened = [];
    const realPanel = window.MissionControlDetailPanel;
    window.MissionControlDetailPanel = { open: (options) => opened.push(options) };
    try {
      window.MissionControlFleetProcurement.render(root, args.payload, args.refitPayload);
      await new Promise((resolve) => setTimeout(resolve, 40));
      const selector = `[data-refit-details="${args.designId}"]`;
      const button = root.querySelector(selector);
      if (!button) throw new Error(`no refit details button for ${args.designId}`);
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
      window.MissionControlDetailPanel = realPanel;
    }
    return opened;
  }, { payload, refitPayload, designId, rootId: TEST_ROOT_ID });
}

module.exports = {
  getFleetProcurementHarnessPage,
  closeFleetProcurementHarness,
  withFleetProcurementHarnessPage,
  renderFleetProcurementOnPage,
  renderFleetProcurementTextOnPage,
  renderRefitCardOnPage,
  getProductionMountHtml,
  openProcurementDetailsByClick,
  openRefitDetailsByClick,
  visibleText,
  HARNESS_PATH,
  TEST_ROOT_ID,
  CARD_ROOT_ID,
};
