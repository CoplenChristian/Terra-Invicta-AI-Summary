// tests/fixtures/executiveBoardsBrowser.js
//
// Purpose: Playwright + Express setup for executive-boards React browser tests.

const http = require('node:http');
const { chromium } = require('playwright');
const { ensurePrimitivesHarnessBuilt } = require('./ensurePrimitivesHarness.js');
const { visibleText } = require('./renderHarness');

const HARNESS_PATH = '/v2/primitives-harness.html';

async function withHarnessPage(run) {
  ensurePrimitivesHarnessBuilt();
  const app = require('../../server/index.js');
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}${HARNESS_PATH}?scene=executiveBoards`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForSelector('[data-testid="executive-boards-harness"]', { timeout: 15000 });
    return await run(page);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function renderBoardOnPage(page, boardName, snapshot, third) {
  const html = await page.evaluate(async (args) => {
    const root = document.getElementById('executive-board-test-root');
    if (!root) return '';
    const boards = window.MissionControlBoards;
    if (!boards || !boards[args.boardName]) {
      throw new Error(`MissionControlBoards.${args.boardName} is not available`);
    }
    boards[args.boardName](root, args.snapshot, args.third);
    await new Promise((resolve) => setTimeout(resolve, 30));
    return root.innerHTML;
  }, { boardName, snapshot, third });

  return {
    html,
    text: visibleText(html),
  };
}

async function invokeBoardOnPage(page, boardName, snapshot, third) {
  return page.evaluate(async (args) => {
    const root = document.getElementById('executive-board-test-root');
    if (!root) throw new Error('executive-board-test-root missing');
    const boards = window.MissionControlBoards;
    boards[args.boardName](root, args.snapshot, args.third);
    await new Promise((resolve) => setTimeout(resolve, 30));
    return root.innerHTML;
  }, { boardName, snapshot, third });
}

async function tryBoardOnPage(page, boardName, snapshot, third) {
  return page.evaluate((args) => {
    try {
      const root = document.getElementById('executive-board-test-root');
      window.MissionControlBoards[args.boardName](root, args.snapshot, args.third);
      return null;
    } catch (error) {
      return error.message || String(error);
    }
  }, { boardName, snapshot, third });
}

module.exports = {
  withHarnessPage,
  renderBoardOnPage,
  invokeBoardOnPage,
  tryBoardOnPage,
  visibleText,
  HARNESS_PATH,
};
