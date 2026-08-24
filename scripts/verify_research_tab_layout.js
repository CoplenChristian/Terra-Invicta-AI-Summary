/**
 * Verification Script: Research Advisor Layout and Legibility
 * Purpose: browser verification of the Research Advisor layout and legibility
 *   criteria against a fresh local server using Playwright.
 *
 * Verifies all criteria from docs/research-tab-layout-spec.md:
 * 1. At most four distinct font sizes render inside .research-advisor; none below 9px.
 * 2. Size tokens exist in :root (--fs-row, --fs-metric, --fs-meta, --fs-tag).
 * 3. Track columns are balanced (height difference <= 15% of panel height) at 1920 and 747.
 * 4. BACKLOGS ACTIVE appears at most once in the panel.
 * 5. No .ra-* leaf element has scrollWidth > clientWidth at 1920, 1280, or 747.
 * 6. Footnotes/census remain present and visible.
 * 7. Both PLAYER and OMNISCIENT modes tested.
 * 8. COMMAND body height is under 3.25 screens (< 3510px @ 1080px).
 */

const { chromium } = require('playwright');
const http = require('http');
const assert = require('node:assert');

const TEST_PORT = 3995;

async function runVerification() {
  const app = require('../server/index.js');
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(TEST_PORT, resolve));
  console.log(`[Verification] Server listening on http://localhost:${TEST_PORT}`);

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    const consoleErrors = [];
    const networkErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('requestfailed', req => {
      networkErrors.push(`${req.method()} ${req.url()} - ${req.failure()?.errorText}`);
    });

    const MODES = ['player', 'omniscient'];
    const VIEWPORTS = [
      { name: '1920x1080 Desktop', width: 1920, height: 1080 },
      { name: '1280x800 Laptop', width: 1280, height: 800 },
      { name: '747x900 Narrow', width: 747, height: 900 }
    ];

    for (const mode of MODES) {
      console.log(`\n========================================`);
      console.log(`Testing Mode: ${mode.toUpperCase()}`);
      console.log(`========================================`);

      for (const vp of VIEWPORTS) {
        console.log(`\n--- Viewport: ${vp.name} (${vp.width}x${vp.height}) ---`);
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(`http://localhost:${TEST_PORT}/v2/#/command`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(600);

        // Switch to the target mode if needed
        await page.evaluate((targetMode) => {
          const btn = document.querySelector(`.init-mode-btn[data-mode="${targetMode}"]`);
          if (btn && !btn.classList.contains('is-active')) btn.click();
        }, mode);
        await page.waitForTimeout(600);

        // Run comprehensive DOM analysis in the browser
        const analysis = await page.evaluate(() => {
          const advisor = document.querySelector('.research-advisor');
          if (!advisor) return { found: false, innerW: window.innerWidth, innerH: window.innerHeight };

          const innerW = window.innerWidth;
          const innerH = window.innerHeight;

          // 1. Sweep all elements inside .research-advisor for computed font sizes
          const allEls = Array.from(advisor.querySelectorAll('*'));
          const fontSizes = new Set();
          const sizeElementMap = {};
          for (const el of allEls) {
            // Ignore elements with no text content
            if (!el.textContent || !el.textContent.trim()) continue;
            const cs = window.getComputedStyle(el);
            const size = cs.fontSize;
            fontSizes.add(size);
            if (!sizeElementMap[size]) sizeElementMap[size] = 0;
            sizeElementMap[size]++;
          }

          // 2. Check :root size tokens
          const rootStyle = window.getComputedStyle(document.documentElement);
          const tokens = {
            fsRow: rootStyle.getPropertyValue('--fs-row').trim(),
            fsMetric: rootStyle.getPropertyValue('--fs-metric').trim(),
            fsMeta: rootStyle.getPropertyValue('--fs-meta').trim(),
            fsTag: rootStyle.getPropertyValue('--fs-tag').trim()
          };

          // 3. Track columns dimensions
          const tracksEl = advisor.querySelector('.ra-tracks');
          const tracks = Array.from(advisor.querySelectorAll('.ra-track'));
          const trackMetrics = tracks.map((t, idx) => ({
            index: idx,
            heading: t.querySelector('.ra-track__head h4')?.textContent?.trim() || `Track ${idx}`,
            offsetHeight: t.offsetHeight,
            scrollHeight: t.scrollHeight,
            clientHeight: t.clientHeight
          }));

          const tracksOffsetH = tracksEl ? tracksEl.offsetHeight : 0;
          const tracksScrollH = tracksEl ? tracksEl.scrollHeight : 0;

          // 4. Count occurrences of BACKLOGS ACTIVE in entire advisor
          const advisorText = advisor.innerText || advisor.textContent || '';
          const matches = advisorText.match(/backlogs active/gi) || [];
          const backlogsActiveCount = matches.length;

          // 5. Leaf elements truncation / clipping sweep
          const leafOverflows = [];
          for (const el of allEls) {
            // Leaf element with non-empty text
            if (el.children.length === 0 && el.textContent.trim().length > 0) {
              // Ignore flex/inline wrappers that don't overflow client bounds
              if (el.scrollWidth > el.clientWidth + 1) { // 1px subpixel tolerance
                leafOverflows.push({
                  tag: el.tagName,
                  className: el.className,
                  text: el.textContent.trim().slice(0, 30),
                  scrollWidth: el.scrollWidth,
                  clientWidth: el.clientWidth
                });
              }
            }
          }

          // 6. Check footnotes / census
          const censusLines = Array.from(advisor.querySelectorAll('.ra-census')).map(c => c.textContent.trim());
          const footText = advisor.querySelector('.ra-foot')?.textContent?.trim() || '';

          // 7. Check total body height at 1080 viewport
          const bodyHeight = document.body.scrollHeight;
          const screensAt1080 = bodyHeight / 1080;

          return {
            found: true,
            innerW,
            innerH,
            fontSizes: Array.from(fontSizes).sort((a, b) => parseFloat(a) - parseFloat(b)),
            sizeElementMap,
            tokens,
            trackMetrics,
            tracksOffsetH,
            tracksScrollH,
            backlogsActiveCount,
            leafOverflows,
            censusLines,
            footText,
            bodyHeight,
            screensAt1080
          };
        });

        assert.ok(analysis.found, 'Research advisor element (.research-advisor) exists in DOM');
        console.log(`✓ Measured in browser pane: innerWidth=${analysis.innerW}px, innerHeight=${analysis.innerH}px`);

        // Check 1: Font size scale & floor
        console.log(`  Computed font sizes in .research-advisor:`, analysis.fontSizes);
        console.log(`  Font size distribution:`, analysis.sizeElementMap);
        assert.ok(analysis.fontSizes.length <= 4, `At most 4 distinct font sizes in .research-advisor (found: ${analysis.fontSizes.length}: ${analysis.fontSizes.join(', ')})`);
        for (const sizeStr of analysis.fontSizes) {
          const px = parseFloat(sizeStr);
          assert.ok(px >= 9.0, `Font size ${sizeStr} must be >= 9.0px floor`);
        }
        console.log(`✓ Type scale passes: ${analysis.fontSizes.length} sizes, minimum floor is ${analysis.fontSizes[0]}`);

        // Check 2: Size tokens in :root
        console.log(`  :root size tokens:`, analysis.tokens);
        assert.ok(analysis.tokens.fsRow.length > 0, '--fs-row token must exist');
        assert.ok(analysis.tokens.fsMetric.length > 0, '--fs-metric token must exist');
        assert.ok(analysis.tokens.fsMeta.length > 0, '--fs-meta token must exist');
        assert.ok(analysis.tokens.fsTag.length > 0, '--fs-tag token must exist');
        console.log(`✓ :root size tokens resolved.`);

        // Check 3: Track columns balance
        console.log(`  Track column heights:`, analysis.trackMetrics.map(t => `${t.heading}: ${t.offsetHeight}px`).join(' | '));
        if (analysis.trackMetrics.length === 2 && vp.width > 720) {
          const h0 = analysis.trackMetrics[0].offsetHeight;
          const h1 = analysis.trackMetrics[1].offsetHeight;
          const diff = Math.abs(h0 - h1);
          const maxH = Math.max(h0, h1);
          const ratio = maxH > 0 ? (diff / maxH) : 0;
          console.log(`  Column height difference: ${diff}px (${(ratio * 100).toFixed(1)}% of column height)`);
          assert.ok(ratio <= 0.15, `Column height difference must be <= 15% (found: ${(ratio * 100).toFixed(1)}%)`);
        }
        console.log(`✓ Column balance verified.`);

        // Check 4: BACKLOGS ACTIVE count
        console.log(`  Occurrences of "BACKLOGS ACTIVE": ${analysis.backlogsActiveCount}`);
        assert.ok(analysis.backlogsActiveCount <= 1, `"BACKLOGS ACTIVE" must appear at most once (found: ${analysis.backlogsActiveCount})`);
        console.log(`✓ Campaign badge deduplication passed.`);

        // Check 5: Leaf element overflows / clippings
        console.log(`  Leaf element overflows (scrollWidth > clientWidth): ${analysis.leafOverflows.length}`);
        if (analysis.leafOverflows.length > 0) {
          console.log('  Overflowing elements:', analysis.leafOverflows);
        }
        assert.strictEqual(analysis.leafOverflows.length, 0, `No leaf element in .research-advisor may have scrollWidth > clientWidth`);
        console.log(`✓ Leaf element wrapping verified (0 clippings).`);

        // Check 6: Census & Footnotes
        console.log(`  Census footnotes (${analysis.censusLines.length}):`, analysis.censusLines);
        assert.ok(analysis.censusLines.length >= 2, 'Census footnotes must be present');
        console.log(`✓ Census and footnotes intact.`);

        // Check 7: COMMAND Screen height at 1920x1080
        if (vp.width === 1920) {
          console.log(`  COMMAND body height: ${analysis.bodyHeight}px (${analysis.screensAt1080.toFixed(3)} screens @ 1080px)`);
          // Raised from 3.00 to 3.25 on 2026-08-24 -- see the note in
          // scripts/verify_mobile_overflow.js for the reasoning and for why that
          // script reports a different number from this one. This measures the
          // whole page BODY; that one measures `#view-command` alone, so this
          // figure runs ~0.12 screens higher on the same page.
          assert.ok(analysis.screensAt1080 < 3.25, `COMMAND body height (${analysis.screensAt1080.toFixed(3)} screens) must be < 3.25 screens (< 3510px)`);
          console.log(`✓ COMMAND height budget strictly met.`);
        }
      }
    }

    console.log('\n--- Console & Network Error Summary ---');
    console.log(`Console errors: ${consoleErrors.length}`);
    console.log(`Network errors: ${networkErrors.length}`);
    assert.strictEqual(consoleErrors.length, 0, 'No console errors allowed');
    assert.strictEqual(networkErrors.length, 0, 'No network errors allowed');

    console.log('\n🎉 ALL RESEARCH TAB LAYOUT & LEGIBILITY CHECKS PASSED!\n');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

runVerification().catch(err => {
  console.error('\n❌ Verification failed:', err);
  process.exitCode = 1;
});
