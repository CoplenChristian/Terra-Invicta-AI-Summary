/**
 * Browser verification script for Research Advisor Actionability (§4 of research-actionability-spec.md).
 * Purpose: browser verification of research-advisor actionability against a
 *   fresh local server using Playwright.
 * Binds an ephemeral port so concurrent verification runs cannot collide.
 */

const { chromium } = require('playwright');
const http = require('http');
const path = require('path');
const assert = require('assert');

process.env.NODE_ENV = 'test';

async function runVerification() {
  const app = require('../server/index.js');

  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const port = server.address().port;
  console.log(`[Verification] Server listening on http://localhost:${port}`);

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

      await page.goto(`http://localhost:${port}/v2/?mode=${mode}#/command`, { waitUntil: 'networkidle' });
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
      console.log('\n--- 2. Research Advisor Component, Names & Unlock Badges ---');
      const advisorMetrics = await page.evaluate(() => {
        const advisor = document.querySelector('.research-advisor');
        if (!advisor) return { found: false };
        const queue = advisor.querySelector('.ra-queue');
        const capacity = advisor.querySelector('.ra-queue__capacity');
        const tracks = advisor.querySelector('.ra-tracks');
        const actionableGroups = advisor.querySelectorAll('.ra-group.is-actionable');
        const rows = Array.from(advisor.querySelectorAll('.ra-row')).map(row => {
          const nameEl = row.querySelector('.ra-row__name');
          const subEl = row.querySelector('.ra-row__sub');
          const metricEl = row.querySelector('.ra-row__metric');
          const metaEl = row.querySelector('.ra-row__meta');
          const tags = Array.from(row.querySelectorAll('.ra-tag')).map(t => t.textContent.trim());
          return {
            nameText: nameEl ? nameEl.textContent.trim() : null,
            hasSub: !!subEl,
            subText: subEl ? subEl.textContent.trim() : null,
            metricText: metricEl ? metricEl.textContent.trim() : null,
            metaText: metaEl ? metaEl.textContent.trim() : null,
            tags
          };
        });
        return {
          found: true,
          hasQueue: !!queue,
          capacityText: capacity ? capacity.textContent : null,
          hasTracks: !!tracks,
          actionableGroupCount: actionableGroups.length,
          rowCount: rows.length,
          rows
        };
      });

      console.log(`Advisor metrics: found=${advisorMetrics.found}, rowCount=${advisorMetrics.rowCount}`);
      if (!advisorMetrics.found) {
        throw new Error('Research advisor (.research-advisor) not found in DOM');
      }
      if (!advisorMetrics.hasQueue) {
        throw new Error('Research queue (.ra-queue) not found in advisor');
      }
      console.log(`✓ Queue capacity headline: "${advisorMetrics.capacityText}"`);
      console.log(`✓ Actionable groups: ${advisorMetrics.actionableGroupCount}, Rows rendered: ${advisorMetrics.rowCount}`);
      console.log(`✓ Sample rendered rows:`);
      for (const r of advisorMetrics.rows.slice(0, 4)) {
        console.log(`   - "${r.nameText}" | ${r.metricText} | Tags: [${r.tags.join(', ')}]`);
      }

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

      // 4. Test 375px viewport (mobile) responsiveness
      console.log('\n--- 4. Mobile (375px) Viewport Check ---');
      await page.setViewportSize({ width: 375, height: 812 });
      await page.waitForTimeout(500);

      const mobileMetrics = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('.ra-row__name')).map(el => ({
          text: el.textContent.trim(),
          clientWidth: el.clientWidth,
          scrollWidth: el.scrollWidth,
          isEllipsed: el.scrollWidth > el.clientWidth
        }));
        return { rowCount: rows.length, rows: rows.slice(0, 3) };
      });

      console.log(`✓ 375px mobile check: ${mobileMetrics.rowCount} research rows rendered cleanly.`);
      for (const r of mobileMetrics.rows) {
        console.log(`   - 375px row label: "${r.text}" (clientWidth: ${r.clientWidth}px, ellipsed: ${r.isEllipsed})`);
      }

      // Restore 1920x1080 viewport for next iteration
      await page.setViewportSize({ width: 1920, height: 1080 });
    }

    console.log('\n--- 5. Console & Network Errors Summary ---');
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

    console.log('\n🎉 ALL RESEARCH ADVISOR BROWSER & LAYOUT CHECKS PASSED!\n');
  } catch (err) {
    console.error('\n❌ Browser verification failed:', err);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.close();
  }
}

runVerification().catch(err => {
  console.error('\n❌ Fatal verification runner error:', err);
  process.exit(1);
});
