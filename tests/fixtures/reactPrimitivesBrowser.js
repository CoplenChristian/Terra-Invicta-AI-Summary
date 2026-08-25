// tests/fixtures/reactPrimitivesBrowser.js
//
// Purpose: shared Playwright + Express setup for React primitive browser tests.

const http = require('node:http');
const { chromium } = require('playwright');
const { ensurePrimitivesHarnessBuilt } = require('./ensurePrimitivesHarness.js');

const HARNESS_PATH = '/v2/primitives-harness.html';

async function withPrimitivesHarnessPage(scene, run) {
  ensurePrimitivesHarnessBuilt();
  const app = require('../../server/index.js');
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const query = scene ? `?scene=${encodeURIComponent(scene)}` : '';
    await page.goto(`http://127.0.0.1:${port}${HARNESS_PATH}${query}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForSelector('#primitives-harness-root', { timeout: 15000 });
    return await run(page);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

module.exports = {
  withPrimitivesHarnessPage,
  HARNESS_PATH,
};
