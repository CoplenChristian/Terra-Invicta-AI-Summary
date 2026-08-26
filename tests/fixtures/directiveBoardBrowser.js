// tests/fixtures/directiveBoardBrowser.js
//
// Purpose: Playwright + Express setup for directive-board React browser tests.
//   Mirrors councilOrdersBrowser / executiveBoardsBrowser: serve the primitives
//   harness, render the panel through the same `window.MissionControlDirectiveBoard`
//   bridge the dashboard uses, and assert against the rendered DOM.
//
// `node --test` CANNOT render a React component out of the Vite bundle -- three
// earlier migration runs died on `Minified React error #327`. The panel is
// therefore driven in a real browser, exactly like every other migrated panel.
//
// TWO MOUNTS, DELIBERATELY:
//
//   #directiveBoard          -- the PRODUCTION mount id. public/v2/index.html owns
//                               it and src/v2/panels/CouncilOrders.jsx resolves
//                               assignment cards through it, so the cross-panel
//                               selector is verified against the real panel output
//                               rather than against a hand-written mirror. Fed by
//                               `window.__DIRECTIVE_BOARD_PAYLOAD__`.
//   #directive-board-test-root -- a second mount the bench suite re-renders into.
//                               Nineteen cycle plans then cost ONE browser instead
//                               of nineteen, which is why `withSharedPage` exists.

const http = require('node:http');
const { chromium } = require('playwright');
const { ensurePrimitivesHarnessBuilt } = require('./ensurePrimitivesHarness.js');
const { visibleText } = require('./renderHarness');

const HARNESS_PATH = '/v2/primitives-harness.html';
const SCENE = 'directiveBoard';
const HARNESS_TESTID = '[data-testid="directive-board-harness"]';

async function startHarness(payload) {
  ensurePrimitivesHarnessBuilt();
  const app = require('../../server/index.js');
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  if (payload !== undefined) {
    await page.addInitScript((p) => {
      window.__DIRECTIVE_BOARD_PAYLOAD__ = p;
    }, payload);
  }
  await page.goto(`http://127.0.0.1:${port}${HARNESS_PATH}?scene=${SCENE}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForSelector(HARNESS_TESTID, { timeout: 15000 });

  return {
    page,
    async close() {
      await browser.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/** One page, one payload, torn down afterwards. Used by the thin suite. */
async function withDirectiveBoardHarnessPage(payload, run) {
  const harness = await startHarness(payload);
  try {
    return await run(harness.page);
  } finally {
    await harness.close();
  }
}

// ---------------------------------------------------------------------------
// The shared page. node:test runs top-level tests in a file sequentially, so a
// single lazily-booted page is safe here and turns a ~19-browser suite into one.
// The owning test file must call `closeSharedDirectiveBoardPage()` from a root
// `after()` hook, or the process will not exit.
// ---------------------------------------------------------------------------

let sharedHarness = null;
let sharedBoot = null;

async function withSharedDirectiveBoardPage(run) {
  if (sharedHarness === null) {
    if (sharedBoot === null) sharedBoot = startHarness(undefined);
    sharedHarness = await sharedBoot;
  }
  return run(sharedHarness.page);
}

async function closeSharedDirectiveBoardPage() {
  if (sharedBoot !== null && sharedHarness === null) {
    sharedHarness = await sharedBoot;
  }
  if (sharedHarness !== null) {
    const harness = sharedHarness;
    sharedHarness = null;
    sharedBoot = null;
    await harness.close();
  }
}

/**
 * Renders one payload into #directive-board-test-root through the same bridge
 * `public/v2/js/mission-control.js` calls, and returns what a reader would see.
 */
async function renderDirectiveBoardOnPage(page, payload) {
  const html = await page.evaluate(async (value) => {
    const root = document.getElementById('directive-board-test-root');
    if (!root) throw new Error('directive-board-test-root missing');
    const board = window.MissionControlDirectiveBoard;
    if (!board?.render) throw new Error('MissionControlDirectiveBoard.render is not available');
    board.render(root, value);
    await new Promise((resolve) => setTimeout(resolve, 30));
    return root.innerHTML;
  }, payload);

  return { html, text: visibleText(html) };
}

/** The production mount's own HTML — what CouncilOrders.jsx reaches into. */
async function getBoardMountHtml(page) {
  return page.evaluate(() => {
    const el = document.getElementById('directiveBoard');
    return el ? el.innerHTML : '';
  });
}

async function getBoardMountText(page) {
  return visibleText(await getBoardMountHtml(page));
}

/**
 * The cross-panel contract, run as CouncilOrders.jsx runs it.
 *
 * src/v2/panels/CouncilOrders.jsx:255-257 does exactly this:
 *   document.getElementById('directiveBoard')
 *     .querySelector('.directive-assignment-card[data-assignment-index="N"]')
 * so this helper must keep quoting that selector literally rather than
 * paraphrasing it — a paraphrase would pass while the real one broke.
 */
async function resolveAssignmentCardAsCouncilOrdersDoes(page, index) {
  return page.evaluate((idx) => {
    const DIRECTIVE_BOARD_ID = 'directiveBoard';
    const ASSIGNMENT_CARD_SELECTOR_PREFIX = '.directive-assignment-card[data-assignment-index="';
    const ASSIGNMENT_CARD_SELECTOR_SUFFIX = '"]';
    const board = document.getElementById(DIRECTIVE_BOARD_ID);
    if (!board) return { boardFound: false, cardFound: false, text: null, index: null };
    const card = board.querySelector(
      `${ASSIGNMENT_CARD_SELECTOR_PREFIX}${idx}${ASSIGNMENT_CARD_SELECTOR_SUFFIX}`,
    );
    return {
      boardFound: true,
      cardFound: card !== null,
      text: card ? card.textContent : null,
      index: card ? card.getAttribute('data-assignment-index') : null,
    };
  }, index);
}

/**
 * Drives the risk-floor <select> and reports what the control handed back.
 *
 * `Number('') === 0`, and `''` is the option that CLEARS the stored preference
 * so the server's configured default applies again — a different statement from
 * choosing a floor of 0. Both must be observable from the callback.
 */
async function exerciseRiskFloorSelect(page, cyclePlan, choices) {
  return page.evaluate(async (args) => {
    const root = document.getElementById('directive-board-test-root');
    const calls = [];
    window.MissionControlDirectiveBoard.render(root, {
      engineDirectives: { cyclePlan: args.cyclePlan },
      riskFloorPreference: args.preference,
      onRiskFloorChange: (value) => calls.push({ value, isNull: value === null }),
    });
    await new Promise((resolve) => setTimeout(resolve, 40));

    const select = root.querySelector('[data-risk-floor-select]');
    if (!select) throw new Error('risk-floor select did not render');
    const seeded = select.value;
    const options = Array.from(select.options).map((o) => ({ value: o.value, label: o.textContent }));

    for (const choice of args.choices) {
      select.value = choice;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return { seeded, options, calls };
  }, { cyclePlan, preference: choices.preference, choices: choices.pick });
}

module.exports = {
  withDirectiveBoardHarnessPage,
  exerciseRiskFloorSelect,
  withSharedDirectiveBoardPage,
  closeSharedDirectiveBoardPage,
  renderDirectiveBoardOnPage,
  getBoardMountHtml,
  getBoardMountText,
  resolveAssignmentCardAsCouncilOrdersDoes,
  visibleText,
  HARNESS_PATH,
};
