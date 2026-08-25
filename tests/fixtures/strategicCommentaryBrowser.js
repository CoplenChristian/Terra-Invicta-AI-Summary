// tests/fixtures/strategicCommentaryBrowser.js
//
// Purpose: Playwright + Express setup for strategic-commentary React browser tests.

const http = require('node:http');
const { chromium } = require('playwright');
const { ensurePrimitivesHarnessBuilt } = require('./ensurePrimitivesHarness.js');
const { visibleText } = require('./renderHarness');

const HARNESS_PATH = '/v2/primitives-harness.html';

async function withStrategicCommentaryHarnessPage(payload, run) {
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
      window.__STRATEGIC_COMMENTARY_PAYLOAD__ = p;
    }, payload);
    await page.goto(`http://127.0.0.1:${port}${HARNESS_PATH}?scene=strategicCommentary`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForSelector('[data-testid="strategic-commentary-harness"]', { timeout: 15000 });
    return await run(page);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function getHarnessHtml(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="strategic-commentary-harness"]');
    return el ? el.innerHTML : '';
  });
}

async function getHarnessText(page) {
  const html = await getHarnessHtml(page);
  return visibleText(html);
}

async function getModeBadgeText(page) {
  return page.evaluate(() => {
    const badge = document.getElementById('commentaryModeBadge');
    return badge ? badge.textContent.trim() : '';
  });
}

module.exports = {
  withStrategicCommentaryHarnessPage,
  getHarnessHtml,
  getHarnessText,
  getModeBadgeText,
  visibleText,
  HARNESS_PATH,
};
