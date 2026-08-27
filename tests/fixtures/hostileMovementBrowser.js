// tests/fixtures/hostileMovementBrowser.js
//
// Purpose: Playwright + Express setup for hostile-movement React browser tests.
//   Mounts the panel through the same path mission-control.js drives on the real
//   THREAT view -- #hostileMovement is the shell's mount id and the scene renders
//   the panel inside it. Page errors are collected so a render throw (e.g. an
//   unknown DataTable variant) fails the test that reads them.

const http = require('node:http');
const { chromium } = require('playwright');
const { ensurePrimitivesHarnessBuilt } = require('./ensurePrimitivesHarness.js');
const { visibleText } = require('./renderHarness');

const HARNESS_PATH = '/v2/primitives-harness.html';

async function withHostileMovementHarnessPage(payload, run) {
  ensurePrimitivesHarnessBuilt();
  const app = require('../../server/index.js');
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error));
    await page.addInitScript((p) => {
      window.__HOSTILE_MOVEMENT_PAYLOAD__ = p;
    }, payload);
    await page.goto(`http://127.0.0.1:${port}${HARNESS_PATH}?scene=hostileMovement`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForSelector('[data-testid="hostile-movement-harness"]', { timeout: 15000 });
    return await run(page, { pageErrors });
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function getHarnessHtml(page) {
  return page.evaluate(() => {
    const el = document.querySelector('#hostileMovement');
    return el ? el.innerHTML : '';
  });
}

async function getHarnessText(page) {
  const html = await getHarnessHtml(page);
  return visibleText(html);
}

module.exports = {
  withHostileMovementHarnessPage,
  getHarnessHtml,
  getHarnessText,
  visibleText,
  HARNESS_PATH,
};