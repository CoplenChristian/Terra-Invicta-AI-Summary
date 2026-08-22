/**
 * Verification script for v2 Navigation Acceptance Checks (§5 of v2-navigation-plan.md).
 * Purpose: browser verification of the v2 navigation acceptance checks against a
 *   fresh local server using Playwright.
 * Runs against a fresh local server on port 3888 using Playwright.
 */

const { chromium } = require('playwright');
const http = require('http');
const path = require('path');

process.env.PORT = '3888';
process.env.NODE_ENV = 'test';

async function runVerification() {
  console.log('[Verification] Starting local server on port 3888...');
  // Require fresh server
  const app = require('../server/index.js');

  const server = app.listen(3888, async () => {
    console.log('[Verification] Server listening on http://localhost:3888');
    let browser;
    try {
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        viewport: { width: 1660, height: 900 }
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
      // Exact, and updated deliberately when a view is added: 'drives' joined
      // on 2026-08-21 (docs/drive-explorer-spec.md). The same list is repeated
      // inside the page.evaluate below, which runs in the browser and cannot
      // close over this one.
      const viewIds = ['command', 'expansion', 'fleet', 'drives', 'threat', 'records'];

      // `/v2/` is the real entry point and is what this verifies. It 404s in a
      // checkout living under a dot-directory, because `res.sendFile` defaults
      // to `dotfiles: 'ignore'` -- an agent worktree in `.claude/worktrees/`,
      // for instance (docs/README.md records the follow-up). Falling back to
      // the static path keeps the run possible there, and says loudly that the
      // route itself went unverified rather than quietly passing.
      let shellPath = '/v2/';
      const gotoShell = async (suffix) => {
        const consoleBefore = consoleErrors.length;
        const networkBefore = networkErrors.length;
        await page.goto(`http://localhost:3888${shellPath}${suffix}`, { waitUntil: 'networkidle' });
        if (await page.$('.init-nav-btn[data-view="command"]')) return;
        if (shellPath === '/v2/') {
          console.warn('[Verification] WARNING: /v2/ did not serve the dashboard shell (dot-directory checkout?). '
            + 'Falling back to /v2/index.html -- the /v2/ route is NOT verified in this run.');
          shellPath = '/v2/index.html';
          // The failed probe's own 404 and its console noise are the fallback's
          // doing, not the dashboard's, so they are discarded here rather than
          // reported as defects. Everything after this point still counts.
          consoleErrors.length = consoleBefore;
          networkErrors.length = networkBefore;
          await page.goto(`http://localhost:3888${shellPath}${suffix}`, { waitUntil: 'networkidle' });
        }
      };

      for (const mode of modes) {
        console.log(`\n========================================`);
        console.log(`Testing Mode: ${mode.toUpperCase()}`);
        console.log(`========================================`);

        await gotoShell(`?mode=${mode}#/command`);
        await page.waitForTimeout(1000);

        // 1. Check direct load & hash routing
        console.log('\n--- 1. View Navigation & Reachability ---');
        
        for (const viewId of viewIds) {
          // Click nav button
          await page.click(`.init-nav-btn[data-view="${viewId}"]`);
          await page.waitForTimeout(200);

          const hash = await page.evaluate(() => window.location.hash);
          console.log(`Navigated to view '${viewId}', current hash: '${hash}'`);
          if (hash !== `#/${viewId}`) {
            throw new Error(`Expected hash '#/${viewId}', got '${hash}'`);
          }

          // Check section visibility & inert
          const isSectionVisible = await page.evaluate((vId) => {
            const section = document.getElementById(`view-${vId}`);
            return section && !section.hidden && !section.hasAttribute('inert') && section.getAttribute('aria-hidden') === 'false';
          }, viewId);

          if (!isSectionVisible) {
            throw new Error(`Section #view-${viewId} is not visible/active`);
          }

          // Check other sections are hidden & inert
          const otherInactive = await page.evaluate((vId) => {
            const others = ['command', 'expansion', 'fleet', 'drives', 'threat', 'records'].filter(o => o !== vId);
            return others.every(o => {
              const sec = document.getElementById(`view-${o}`);
              return sec && sec.hidden && sec.hasAttribute('inert') && sec.getAttribute('aria-hidden') === 'true';
            });
          }, viewId);

          if (!otherInactive) {
            throw new Error(`Inactive sections for view '${viewId}' are not properly hidden/inert`);
          }
        }

        // 2. Measure Expansion Reachability (Mining Board)
        console.log('\n--- 2. Mining Board & Panel Reachability ---');
        await page.click('.init-nav-btn[data-view="expansion"]');
        await page.waitForTimeout(300);

        const miningMetrics = await page.evaluate(() => {
          const el = document.getElementById('miningExpansion');
          if (!el) return null;
          const rect = el.getBoundingClientRect();
          const bodyHeight = document.body.scrollHeight;
          const yOffset = rect.top + window.scrollY;
          el.scrollIntoView({ behavior: 'instant', block: 'center' });
          const inViewAfterScroll = (rect.top >= 0 && rect.bottom <= window.innerHeight);
          return {
            exists: true,
            yOffset,
            bodyHeight,
            inViewAfterScroll
          };
        });

        console.log(`Mining board y-offset: ${miningMetrics.yOffset}px (Total body height: ${miningMetrics.bodyHeight}px)`);
        if (!miningMetrics || !miningMetrics.exists) {
          throw new Error('Mining board #miningExpansion not found in DOM');
        }

        // 3. Test Reload Persistence on #/expansion
        console.log('\n--- 3. Reload Persistence on #/expansion ---');
        await gotoShell(`#/expansion`);
        await page.waitForTimeout(500);

        const reloadedView = await page.evaluate(() => {
          const expSection = document.getElementById('view-expansion');
          const activeBtn = document.querySelector('.init-nav-btn[data-view="expansion"]');
          return {
            sectionVisible: !expSection.hidden && !expSection.hasAttribute('inert'),
            btnActive: activeBtn.classList.contains('init-btn-cyan') && activeBtn.getAttribute('aria-pressed') === 'true'
          };
        });

        console.log(`Reloaded on #/expansion: section visible = ${reloadedView.sectionVisible}, button active = ${reloadedView.btnActive}`);
        if (!reloadedView.sectionVisible || !reloadedView.btnActive) {
          throw new Error('Reloading on #/expansion failed to restore active view');
        }

        // 4. Test Zero-Refetch View Switching
        console.log('\n--- 4. Zero-Refetch View Switching ---');
        let briefingFetchCount = 0;
        const requestListener = (req) => {
          if (req.url().includes('/api/v2/briefing')) briefingFetchCount++;
        };
        page.on('request', requestListener);

        await page.click('.init-nav-btn[data-view="command"]');
        await page.waitForTimeout(200);
        await page.click('.init-nav-btn[data-view="threat"]');
        await page.waitForTimeout(200);
        await page.click('.init-nav-btn[data-view="records"]');
        await page.waitForTimeout(200);
        await page.click('.init-nav-btn[data-view="expansion"]');
        await page.waitForTimeout(200);

        page.off('request', requestListener);
        console.log(`Briefing requests fired during 4 view switches: ${briefingFetchCount}`);
        if (briefingFetchCount !== 0) {
          throw new Error(`Expected 0 network fetches during view switching, got ${briefingFetchCount}`);
        }

        // 5. Test Council Orders & Hate Meter Navigation Link
        console.log('\n--- 5. Inter-View Deeplinking ---');
        // Click Hate meter in HUD from Expansion view
        await page.click('#hudHateMeter');
        await page.waitForTimeout(500);

        const currentHashAfterHate = await page.evaluate(() => window.location.hash);
        console.log(`Clicked #hudHateMeter -> hash: '${currentHashAfterHate}'`);
        if (currentHashAfterHate !== '#/threat') {
          throw new Error(`Expected #/threat after clicking hate meter, got '${currentHashAfterHate}'`);
        }

        // 6. Full-Page Text Content Scan for forbidden tokens
        console.log('\n--- 6. Full-Page Text Content Scan for Nulls/NaN ---');
        for (const viewId of viewIds) {
          await page.click(`.init-nav-btn[data-view="${viewId}"]`);
          await page.waitForTimeout(200);

          const pageText = await page.evaluate((vId) => {
            const section = document.getElementById(`view-${vId}`);
            return section ? section.innerText || section.textContent : '';
          }, viewId);

          const forbidden = ['null', 'undefined', 'NaN', 'nulld', '[object Object]'];
          for (const token of forbidden) {
            const re = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
            const hasMatch = token === 'nulld' || token === '[object Object]' ? pageText.includes(token) : re.test(pageText);
            if (hasMatch) {
              const debugHtml = await page.evaluate((tok) => {
                const all = document.querySelectorAll('*');
                for (const el of all) {
                  if (el.children.length === 0 && (el.textContent || '').includes(tok)) {
                    return el.outerHTML;
                  }
                }
                return 'not found in leaf';
              }, token);
              const idx = pageText.indexOf(token);
              const snippet = pageText.slice(Math.max(0, idx - 40), idx + 40).replace(/\n/g, ' ');
              throw new Error(`Forbidden token '${token}' found in view '${viewId}' (${mode} mode) near: "${snippet}" | Element HTML: ${debugHtml}`);
            }
          }
          console.log(`View '${viewId}' clean: 0 forbidden tokens found.`);
        }

        // 7. Responsive Viewport & No Horizontal Scroll Checks
        console.log('\n--- 7. Viewport & Responsive Overflow Checks ---');
        const viewports = [
          { name: 'Desktop Full HD', width: 1920, height: 1080 },
          { name: 'Desktop Large', width: 1660, height: 900 },
          { name: 'Desktop Medium', width: 1366, height: 768 },
          { name: 'Tablet', width: 900, height: 700 },
          { name: 'Mobile', width: 375, height: 667 }
        ];

        for (const vp of viewports) {
          await page.setViewportSize({ width: vp.width, height: vp.height });
          await page.waitForTimeout(300);

          for (const viewId of viewIds) {
            await page.click(`.init-nav-btn[data-view="${viewId}"]`);
            await page.waitForTimeout(100);

            const scrollMetrics = await page.evaluate(() => {
              return {
                scrollWidth: document.documentElement.scrollWidth,
                clientWidth: document.documentElement.clientWidth,
                innerWidth: window.innerWidth
              };
            });

            const hasHScroll = scrollMetrics.scrollWidth > scrollMetrics.clientWidth;
            console.log(`[${vp.name} - ${vp.width}px] View '${viewId}': scrollWidth=${scrollMetrics.scrollWidth}px, clientWidth=${scrollMetrics.clientWidth}px (H-Scroll: ${hasHScroll})`);

            if (hasHScroll) {
              throw new Error(`Horizontal scroll detected at ${vp.name} (${vp.width}px) on view '${viewId}': scrollWidth ${scrollMetrics.scrollWidth} > clientWidth ${scrollMetrics.clientWidth}`);
            }

            if (vp.width === 1920 && viewId === 'command') {
              const bodyHeight = await page.evaluate(() => document.body.scrollHeight);
              const screensOfScroll = bodyHeight / 1080;
              console.log(`[1920x1080] COMMAND view page height: ${bodyHeight}px (${screensOfScroll.toFixed(2)} screens)`);
              if (screensOfScroll > 3.5) {
                throw new Error(`COMMAND view page height exceeded budget: ${bodyHeight}px (${screensOfScroll.toFixed(2)} screens > 3.5 max)`);
              }
            }
          }
        }

        // Reset viewport
        await page.setViewportSize({ width: 1660, height: 900 });
      }

      console.log('\n--- 8. Console & Network Errors Summary ---');
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

      console.log('\n🎉 ALL ACCEPTANCE CHECKS PASSED SUCCESSFULLY!\n');
    } catch (err) {
      console.error('\n❌ Verification failed:', err);
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
