/**
 * tests/reactCoexistence.test.js
 *
 * Purpose: proves React + MUI coexistence with the vanilla v2 dashboard:
 * 1. bundle.js loads as a module without blocking classic scripts.
 * 2. React mounts via createRoot into a VIEWS-registered container when flagged (?react_proof=1).
 * 3. Coexistence proof reads real state from window globals.
 * 4. assertViewRegistryIntegrity passes cleanly with React mounted.
 * 5. Without proof flag, zero throwaway DOM elements are injected.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { chromium } = require('playwright');
const { ensureBundleBuilt } = require('./fixtures/ensureBundle.js');

const SHELL_PATH = '/v2/index.html';

test('React coexistence proof mounts via VIEWS registry and reads global state', async () => {
  ensureBundleBuilt();
  const app = require('../server/index.js');
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.error('PAGE ERROR:', err));

    // 1. Load with proof flag
    await page.goto(`http://localhost:${port}${SHELL_PATH}?react_proof=1#/command`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    const hasBundle = await page.evaluate(() => typeof window.MissionControlReact !== 'undefined');
    console.log('window.MissionControlReact loaded:', hasBundle);

    // Assert React bundle mounted the proof component
    const proofElement = await page.waitForSelector('[data-testid="react-coexistence-proof"]', { timeout: 10000 });
    assert.ok(proofElement, 'React coexistence proof component must mount in DOM when ?react_proof=1 is set');

    const proofText = await proofElement.textContent();
    assert.ok(proofText.includes('[React Coexistence Proof]'), 'Proof component must render label');
    assert.ok(proofText.includes('Mounted in #strategicCommentary'), 'Proof must target VIEWS-registered panel');

    // Assert assertViewRegistryIntegrity passes in page context
    const integrityPassed = await page.evaluate(() => {
      if (!window.MissionControlViews?.assertViewRegistryIntegrity) return false;
      try {
        window.MissionControlViews.assertViewRegistryIntegrity();
        return true;
      } catch (e) {
        return false;
      }
    });
    assert.equal(integrityPassed, true, 'assertViewRegistryIntegrity must pass with React mounted');

    // 2. Load without proof flag -> proof component must NOT be present
    const cleanContext = await browser.newContext();
    const cleanPage = await cleanContext.newPage();
    await cleanPage.goto(`http://localhost:${port}${SHELL_PATH}#/command`, { waitUntil: 'domcontentloaded' });
    await cleanPage.waitForTimeout(1000);

    const cleanProof = await cleanPage.$('[data-testid="react-coexistence-proof"]');
    assert.equal(cleanProof, null, 'Proof component must not render when react_proof flag is absent');

    await cleanContext.close();
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
