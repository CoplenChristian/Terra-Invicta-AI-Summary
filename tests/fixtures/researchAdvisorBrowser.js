// tests/fixtures/researchAdvisorBrowser.js
//
// Purpose: Playwright + Express setup for the research-advisor React browser
//   tests, driving the panel through the same `window.MissionControlResearchAdvisor`
//   bridge `public/v2/js/mission-control.js` calls.
//
// `node --test` CANNOT render a React component out of the Vite bundle — three
// earlier migration runs died on `Minified React error #327`. The panel is
// therefore driven in a real browser, exactly like every other migrated panel.
//
// ONE SESSION, NOT ONE PER PAYLOAD. `tests/researchRanking.test.js` renders
// twenty-nine payloads and `tests/researchSlots.test.js` two more; a browser per
// render would cost thirty-one launches. node:test runs top-level tests in a
// file sequentially, so one lazily-booted page is safe. Each owning test file
// must call `closeResearchAdvisorHarness()` from a root `after()` hook or the
// process will not exit.
//
// TWO MOUNTS, DELIBERATELY:
//
//   #researchAdvisor            — the PRODUCTION mount id, owned by
//                                 public/v2/index.html and driven by the VIEWS
//                                 registry. Fed by `window.__RESEARCH_ADVISOR_PAYLOAD__`.
//   #research-advisor-test-root — the bench mount the ported suite re-renders
//                                 into through the bridge.

const http = require('node:http');
const { chromium } = require('playwright');
const { ensurePrimitivesHarnessBuilt } = require('./ensurePrimitivesHarness.js');
const { visibleText } = require('./renderHarness');

const HARNESS_PATH = '/v2/primitives-harness.html';
const SCENE = 'researchAdvisor';
const HARNESS_TESTID = '[data-testid="research-advisor-harness"]';
const TEST_ROOT_ID = 'research-advisor-test-root';

let session = null;

async function startHarness(payload) {
  ensurePrimitivesHarnessBuilt();
  const app = require('../../server/index.js');
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1660, height: 950 } });
  if (payload !== undefined) {
    await page.addInitScript((p) => {
      window.__RESEARCH_ADVISOR_PAYLOAD__ = p;
    }, payload);
  }
  await page.goto(`http://127.0.0.1:${port}${HARNESS_PATH}?scene=${SCENE}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForSelector(HARNESS_TESTID, { timeout: 30000 });

  return { server, browser, page, port };
}

/** The shared page. Booted on first use, closed from the file's `after()` hook. */
async function getResearchAdvisorHarnessPage() {
  if (!session) session = await startHarness(undefined);
  return session.page;
}

async function closeResearchAdvisorHarness() {
  if (!session) return;
  const { server, browser } = session;
  session = null;
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

/** One page, one seeded payload, torn down afterwards. */
async function withResearchAdvisorHarnessPage(payload, run) {
  const own = await startHarness(payload);
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
async function renderResearchAdvisorOnPage(page, payload) {
  return page.evaluate(async (args) => {
    const root = document.getElementById(args.rootId);
    if (!root) throw new Error(`${args.rootId} missing`);
    const advisor = window.MissionControlResearchAdvisor;
    if (!advisor || typeof advisor.render !== 'function') {
      throw new Error('MissionControlResearchAdvisor.render is not available');
    }
    advisor.render(root, args.payload);
    await new Promise((resolve) => setTimeout(resolve, 40));
    return root.innerHTML;
  }, { payload, rootId: TEST_ROOT_ID });
}

/** The production mount's own markup, without re-rendering anything. */
async function getProductionMountHtml(page) {
  return page.evaluate(() => {
    const el = document.getElementById('researchAdvisor');
    return el ? el.innerHTML : '';
  });
}

/**
 * Clicks the card's own `Full ranking` button with the shared detail panel
 * stubbed, and returns whatever the panel was asked to open.
 *
 * The click path is used rather than calling `openFullRanking` directly, so the
 * button's handler is covered too — the vanilla wired it with addEventListener
 * after setting innerHTML and a rewrite could drop it silently.
 */
async function openFullRankingByClick(page, payload) {
  return page.evaluate(async (args) => {
    const root = document.getElementById(args.rootId);
    const opened = [];
    const realPanel = window.MissionControlDetailPanel;
    window.MissionControlDetailPanel = { open: (options) => opened.push(options) };
    try {
      window.MissionControlResearchAdvisor.render(root, args.payload);
      await new Promise((resolve) => setTimeout(resolve, 40));
      const button = root.querySelector('[data-research-advisor-full]');
      if (!button) throw new Error('the Full ranking button did not render');
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
      window.MissionControlDetailPanel = realPanel;
    }
    return opened;
  }, { payload, rootId: TEST_ROOT_ID });
}

module.exports = {
  getResearchAdvisorHarnessPage,
  closeResearchAdvisorHarness,
  withResearchAdvisorHarnessPage,
  renderResearchAdvisorOnPage,
  getProductionMountHtml,
  openFullRankingByClick,
  visibleText,
  HARNESS_PATH,
  TEST_ROOT_ID,
};
