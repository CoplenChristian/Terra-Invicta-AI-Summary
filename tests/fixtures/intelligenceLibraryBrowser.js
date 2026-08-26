// tests/fixtures/intelligenceLibraryBrowser.js
//
// Purpose: Playwright + Express setup for intelligence-library React browser tests.

const http = require('node:http');
const { chromium } = require('playwright');
const { ensurePrimitivesHarnessBuilt } = require('./ensurePrimitivesHarness.js');
const { visibleText } = require('./renderHarness');

const HARNESS_PATH = '/v2/primitives-harness.html';

async function withIntelligenceLibraryHarnessPage(payload, run, callbacks = {}) {
  ensurePrimitivesHarnessBuilt();
  const app = require('../../server/index.js');
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    if (typeof callbacks.onOpenFaction === 'function') {
      await page.exposeFunction('__testOnOpenFaction', callbacks.onOpenFaction);
    }
    await page.addInitScript((p) => {
      window.__INTELLIGENCE_LIBRARY_PAYLOAD__ = p;
    }, payload);
    await page.goto(`http://127.0.0.1:${port}${HARNESS_PATH}?scene=intelligenceLibrary`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForSelector('[data-testid="intelligence-library-harness"]', { timeout: 15000 });
    return await run(page);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function getHarnessHtml(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="intelligence-library-harness"]');
    return el ? el.innerHTML : '';
  });
}

async function getHarnessText(page) {
  const html = await getHarnessHtml(page);
  return visibleText(html);
}

module.exports = {
  withIntelligenceLibraryHarnessPage,
  getHarnessHtml,
  getHarnessText,
  visibleText,
  HARNESS_PATH,
};
