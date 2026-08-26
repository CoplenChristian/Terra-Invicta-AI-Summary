// tests/fixtures/driveExplorerBrowser.js
//
// Purpose: Playwright + Express setup for the drive-explorer React browser
//   tests, driving the panel through its shared store the way
//   scripts/verify_drive_explorer.js does.
//
// ONE SESSION, NOT ONE PER TEST. The drive-explorer payload is ~750KB of rated
// catalogue and the panel is store-driven, so a single page can be re-pointed at
// a new payload without re-mounting. `closeDriveExplorerHarness()` is called
// from an `after()` hook in the test file.

const http = require('node:http');
const { chromium } = require('playwright');
const { ensurePrimitivesHarnessBuilt } = require('./ensurePrimitivesHarness.js');
const { visibleText } = require('./renderHarness');

const HARNESS_PATH = '/v2/primitives-harness.html';

let session = null;

async function getDriveExplorerHarnessPage() {
  if (session) return session.page;

  ensurePrimitivesHarnessBuilt();
  const app = require('../../server/index.js');
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1660, height: 950 } });
  await page.goto(`http://127.0.0.1:${port}${HARNESS_PATH}?scene=driveExplorer`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForSelector('[data-testid="drive-explorer-harness"]', { timeout: 30000 });

  session = { server, browser, page, port };
  return page;
}

async function closeDriveExplorerHarness() {
  if (!session) return;
  const { server, browser } = session;
  session = null;
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

/**
 * Points the panel at `payload` with `viewState` applied, and returns the
 * rendered markup of the mount the VIEWS registry uses on the real shell.
 *
 * The view state is reset first, so one test cannot leave a sort or a threshold
 * behind for the next — the vanilla panel's module singleton had exactly that
 * hazard and its tests had to unwind it in `finally` blocks.
 */
async function renderDriveExplorerOnPage(page, payload, viewState = {}) {
  return page.evaluate(async (args) => {
    const internals = window.MissionControlDriveExplorer._internals;
    internals.resetViewState();
    if (args.viewState && Object.keys(args.viewState).length > 0) {
      internals.patchState(args.viewState);
    }
    internals.setPayload(args.payload);
    await new Promise((resolve) => setTimeout(resolve, 60));
    const el = document.getElementById('driveExplorer');
    return el ? el.innerHTML : '';
  }, { payload, viewState });
}

/**
 * Runs `openDrivePath` with the shared detail panel and `fetch` stubbed, and
 * returns whatever the panel asked the modal to open.
 *
 * `fetchStatus` replaces the tech-path fetch with a failing response, which is
 * how the "unavailable is not empty" branch is reached without a network.
 */
async function openDrivePathOnPage(page, { driveId, statePatch = {}, fetchStatus = null }) {
  return page.evaluate(async (args) => {
    const panel = window.MissionControlDriveExplorer;
    const opened = [];
    const realPanel = window.MissionControlDetailPanel;
    const realFetch = window.fetch;
    window.MissionControlDetailPanel = { open: (options) => opened.push(options) };
    if (args.fetchStatus !== null) {
      window.fetch = () => Promise.resolve({ ok: false, status: args.fetchStatus });
    }
    try {
      panel._internals.patchState(args.statePatch);
      await panel.openDrivePath(args.driveId, null);
    } finally {
      window.MissionControlDetailPanel = realPanel;
      window.fetch = realFetch;
    }
    return opened;
  }, { driveId, statePatch, fetchStatus });
}

/** The current markup, without changing anything. */
async function getDriveExplorerHtml(page) {
  return page.evaluate(() => {
    const el = document.getElementById('driveExplorer');
    return el ? el.innerHTML : '';
  });
}

module.exports = {
  getDriveExplorerHarnessPage,
  closeDriveExplorerHarness,
  renderDriveExplorerOnPage,
  openDrivePathOnPage,
  getDriveExplorerHtml,
  visibleText,
  HARNESS_PATH,
};
