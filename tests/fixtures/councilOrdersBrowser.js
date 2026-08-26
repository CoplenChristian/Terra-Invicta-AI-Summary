// tests/fixtures/councilOrdersBrowser.js
//
// Purpose: Playwright + Express setup for council-orders React browser tests.
//   Mirrors the strategicCommentaryBrowser / mcBudgetBrowser pattern: serve the
//   primitives harness, inject the payload via addInitScript, assert against
//   the rendered DOM.

const http = require('node:http');
const { chromium } = require('playwright');
const { ensurePrimitivesHarnessBuilt } = require('./ensurePrimitivesHarness.js');
const { visibleText } = require('./renderHarness');

const HARNESS_PATH = '/v2/primitives-harness.html';

async function withCouncilOrdersHarnessPage(payload, run) {
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
      window.__COUNCIL_ORDERS_PAYLOAD__ = p;
    }, payload);
    await page.goto(`http://127.0.0.1:${port}${HARNESS_PATH}?scene=councilOrders`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForSelector('[data-testid="council-orders-harness"]', { timeout: 15000 });
    return await run(page);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function getHarnessHtml(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="council-orders-harness"]');
    return el ? el.innerHTML : '';
  });
}

async function getHarnessText(page) {
  const html = await getHarnessHtml(page);
  return visibleText(html);
}

async function renderCouncilOrdersOnPage(page, payload) {
  const html = await page.evaluate(async (value) => {
    const root = document.getElementById('council-orders-test-root');
    if (!root) throw new Error('council-orders-test-root missing');
    const orders = window.MissionControlCouncilOrders;
    if (!orders?.render) throw new Error('MissionControlCouncilOrders.render is not available');
    orders.render(root, value);
    await new Promise((resolve) => setTimeout(resolve, 30));
    return root.innerHTML;
  }, payload);

  return {
    html,
    text: visibleText(html),
  };
}

async function clickOrderRow(page, index) {
  await page.evaluate((idx) => {
    const row = document.querySelector(`[data-council-order-index="${idx}"]`);
    if (!row) throw new Error(`order row ${idx} not found`);
    row.click();
  }, index);
}

async function getDirectiveBoardCardClass(page, index) {
  return page.evaluate((idx) => {
    const card = document.querySelector(`.directive-assignment-card[data-assignment-index="${idx}"]`);
    return card ? card.className : null;
  }, index);
}

module.exports = {
  withCouncilOrdersHarnessPage,
  getHarnessHtml,
  getHarnessText,
  renderCouncilOrdersOnPage,
  clickOrderRow,
  getDirectiveBoardCardClass,
  visibleText,
  HARNESS_PATH,
};
