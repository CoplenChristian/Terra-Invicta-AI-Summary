/**
 * Browser verification script for Research Advisor Actionability (§4 of research-actionability-spec.md).
 * Runs against a fresh local server on port 3888 using Playwright.
 */

const { chromium } = require('playwright');
const http = require('http');
const path = require('path');
const assert = require('assert');

process.env.PORT = '3888';
process.env.NODE_ENV = 'test';

async function runVerification() {
  console.log('[Verification] Starting local test server on port 3888...');
  const app = require('../server/index.js');

  const server = app.listen(3888, async () => {
    console.log('[Verification] Server listening on http://localhost:3888');
    let browser;
    try {
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 }
      });
      const page = await context.newPage();

      const consoleErrors = [];
      const networkErrors = [];

      page.on('console', msg => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      });

      page.on('response', res => {
        const status = res.status();
        const url = res.url();
        if (status >= 400) {
          networkErrors.push(`${status} ${res.request().method()} ${url}`);
        }
      });

      const modes = ['player', 'omniscient'];

      for (const mode of modes) {
        console.log(`\n========================================`);
        console.log(`Testing Mode: ${mode.toUpperCase()} at 1920x1080`);
        console.log(`========================================`);

        await page.goto(`http://localhost:3888/v2/?mode=${mode}#/command`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(1000);

        // 1. Measure COMMAND view page height against the strict 3.00-screen ceiling
        console.log('\n--- 1. Screen Height Measurement (< 3.00 screens) ---');
        const scrollMetrics = await page.evaluate(() => {
          const bodyHeight = document.body.scrollHeight;
          const innerHeight = window.innerHeight;
          const screens = bodyHeight / innerHeight;
          return {
            bodyHeight,
            innerHeight,
            screens
          };
        });

        console.log(`[${mode}] Total body height: ${scrollMetrics.bodyHeight}px (${scrollMetrics.screens.toFixed(3)} screens @ ${scrollMetrics.innerHeight}px viewport)`);
        if (scrollMetrics.screens >= 3.00) {
          throw new Error(`COMMAND view exceeded 3.00-screen budget in ${mode} mode: ${scrollMetrics.screens.toFixed(3)} screens (${scrollMetrics.bodyHeight}px) >= 3.00 max`);
        }
        console.log(`✓ COMMAND view height is under 3.00 screens (${scrollMetrics.screens.toFixed(3)} screens).`);

        // 2. Check Research Advisor elements in DOM
        console.log('\n--- 2. Research Advisor Component & Queue Elements ---');
        const advisorMetrics = await page.evaluate(() => {
          const advisor = document.querySelector('.research-advisor');
          if (!advisor) return { found: false };
          const queue = advisor.querySelector('.ra-queue');
          const capacity = advisor.querySelector('.ra-queue__capacity');
          const tracks = advisor.querySelector('.ra-tracks');
          const militaryTrack = tracks ? tracks.querySelector('.ra-track:first-child') : null;
          const actionableGroups = advisor.querySelectorAll('.ra-group.is-actionable');
          const rows = advisor.querySelectorAll('.ra-row');
          return {
            found: true,
            hasQueue: !!queue,
            capacityText: capacity ? capacity.textContent : null,
            hasTracks: !!tracks,
            actionableGroupCount: actionableGroups.length,
            rowCount: rows.length
          };
        });

        console.log(`Advisor metrics:`, advisorMetrics);
        if (!advisorMetrics.found) {
          throw new Error('Research advisor (.research-advisor) not found in DOM');
        }
        if (!advisorMetrics.hasQueue) {
          throw new Error('Research queue (.ra-queue) not found in advisor');
        }
        console.log(`✓ Queue capacity headline: "${advisorMetrics.capacityText}"`);
        console.log(`✓ Actionable groups: ${advisorMetrics.actionableGroupCount}, Rows rendered: ${advisorMetrics.rowCount}`);

        // 3. Scan for forbidden tokens (null, undefined, NaN, nulld, [object Object])
        console.log('\n--- 3. Forbidden Token Text Scan in COMMAND View ---');
        const pageText = await page.evaluate(() => {
          const section = document.getElementById('view-command');
          return section ? section.innerText || section.textContent : '';
        });

        const forbidden = ['null', 'undefined', 'NaN', 'nulld', '[object Object]'];
        for (const token of forbidden) {
          const re = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
          const hasMatch = token === 'nulld' || token === '[object Object]' ? pageText.includes(token) : re.test(pageText);
          if (hasMatch) {
            const idx = pageText.indexOf(token);
            const snippet = pageText.slice(Math.max(0, idx - 40), idx + 40).replace(/\n/g, ' ');
            throw new Error(`Forbidden token '${token}' found in COMMAND view (${mode} mode) near: "${snippet}"`);
          }
        }
        console.log(`✓ COMMAND view clean: 0 forbidden tokens found.`);
      }

      console.log('\n--- 4. Console & Network Errors Summary ---');
      console.log(`Total console errors: ${consoleErrors.length}`);
      if (consoleErrors.length > 0) {
        console.error('Console errors:', consoleErrors);
        throw new Error('Console errors encountered during test run');
      }

      console.log(`Total network errors: ${networkErrors.length}`);
      if (networkErrors.length > 0) {
        console.error('Network errors:', networkErrors);
        throw new Error('Network errors encountered during test run');
      }

      console.log('\n🎉 ALL RESEARCH ACTIONABILITY BROWSER CHECKS PASSED!\n');
    } catch (err) {
      console.error('\n❌ Browser verification failed:', err);
      process.exitCode = 1;
    } finally {
      if (browser) await browser.close();
      server.close();
    }
  });
}

runVerification().catch(err => {
  console.error('\n❌ Fatal verification runner error:', err);
  process.exit(1);
});
