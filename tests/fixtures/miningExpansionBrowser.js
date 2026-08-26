// tests/fixtures/miningExpansionBrowser.js
//
// Purpose: Playwright + Express setup for mining-expansion React browser tests.

const http = require('node:http');
const { chromium } = require('playwright');
const { ensurePrimitivesHarnessBuilt } = require('./ensurePrimitivesHarness.js');
const { visibleText } = require('./renderHarness.js');

const HARNESS_PATH = '/v2/primitives-harness.html';

async function withMiningExpansionHarnessPage(payload, run) {
  ensurePrimitivesHarnessBuilt();
  const app = require('../../server/index.js');
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.addInitScript((data) => {
      window.__MINING_EXPANSION_PAYLOAD__ = data;
    }, payload);
    await page.goto(`http://127.0.0.1:${port}${HARNESS_PATH}?scene=miningExpansion`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForSelector('[data-testid="mining-expansion-harness"]', { timeout: 15000 });
    return await run(page);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function getHarnessHtml(page) {
  return page.evaluate(() => {
    const element = document.querySelector('[data-testid="mining-expansion-harness"]');
    return element ? element.innerHTML : '';
  });
}

async function getHarnessText(page) {
  return visibleText(await getHarnessHtml(page));
}

module.exports = {
  HARNESS_PATH,
  getHarnessHtml,
  getHarnessText,
  visibleText,
  withMiningExpansionHarnessPage,
};

