/**
 * Verification Script: Mobile Overflow Containment
 *
 * Purpose: browser verification that no view clips content off-screen on narrow
 *   viewports, by measuring live element rects and computed overflow rather than
 *   reading CSS.
 *
 * Acceptance criteria from docs/mobile-and-tech-search-spec.md (Part A):
 * 1. At 375, 414 and 768: document.documentElement.scrollWidth <= innerWidth + 1.
 * 2. Zero elements extend past the viewport, EXCEPT where some ancestor has a
 *    computed overflow-x of `auto` or `scroll` -- i.e. the reader can reach it by
 *    scrolling that container. `hidden` does not count: it clips, so the content
 *    is unreachable, which is the defect this script exists to catch.
 * 3. The six-button view nav fits without wrapping into content.
 * 4. Desktop guard: COMMAND stays under 3.25 screens at 1920x1080 (raised from
 *    3.00 on 2026-08-24 -- see the note at the assertion).
 * 5. Both player and omniscient modes.
 *
 * Run: node scripts/verify_mobile_overflow.js
 */

const { chromium } = require('playwright');
const http = require('http');

const TEST_PORT = Number(process.env.MOBILE_VERIFY_PORT || 3993);

// The shell is requested as `/v2/index.html`, never `/v2/`. `res.sendFile`
// defaults to `dotfiles: 'ignore'`, so the `/v2` route 404s whenever the repo is
// checked out beneath a dotted directory (a git worktree under `.claude/`).
// Going through express.static keeps this script runnable from either location.
const SHELL_PATH = '/v2/index.html';

const VIEWS = ['command', 'expansion', 'fleet', 'drives', 'threat', 'records'];
const MODES = ['player', 'omniscient'];
const NARROW_VIEWPORTS = [
  { width: 375, height: 812 },
  { width: 414, height: 896 },
  { width: 768, height: 1024 }
];

/**
 * Runs inside the page. Returns every element that extends past the viewport
 * without a scrollable ancestor, plus the document scroll width.
 */
function measureOverflow() {
  const innerW = window.innerWidth;
  const offenders = [];
  let offenderTotalCount = 0;
  // Every element past the edge, reachable or not. This is the diagnostic the
  // spec's baseline table counted; it is NOT the acceptance criterion, because
  // content inside a horizontally scrollable container is legitimately reachable.
  let rawOverflowCount = 0;
  let worstRight = null;
  let rawWorstRight = null;

  for (const el of document.querySelectorAll('*')) {
    // display:none (which includes every inactive view section) produces no
    // client rects. Zero-area elements cannot be visually clipped.
    if (el.getClientRects().length === 0) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;

    const overhangsRight = rect.right > innerW + 1;
    const overhangsLeft = rect.left < -1;
    if (!overhangsRight && !overhangsLeft) continue;

    rawOverflowCount += 1;
    if (rawWorstRight === null || rect.right > rawWorstRight) rawWorstRight = rect.right;

    // Reachable if any ancestor scrolls horizontally. `hidden`/`clip` are
    // deliberately NOT accepted -- they are what makes content unreachable.
    let reachable = false;
    for (let p = el.parentElement; p; p = p.parentElement) {
      const overflowX = getComputedStyle(p).overflowX;
      if (overflowX === 'auto' || overflowX === 'scroll') {
        reachable = true;
        break;
      }
    }
    if (reachable) continue;

    offenderTotalCount += 1;
    if (worstRight === null || rect.right > worstRight) worstRight = rect.right;

    // Cap the reported detail, but always report the true total. A truncated
    // list presented as the whole set is the defect class this repo calls out.
    if (offenders.length < 12) {
      offenders.push({
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        cls: (typeof el.className === 'string' ? el.className : '').slice(0, 80) || null,
        right: Math.round(rect.right),
        left: Math.round(rect.left),
        width: Math.round(rect.width)
      });
    }
  }

  return {
    innerWidth: innerW,
    docScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    offenderTotalCount,
    offenderOmittedCount: offenderTotalCount - offenders.length,
    rawOverflowCount,
    rawWorstRight,
    worstRight,
    samples: offenders
  };
}

/** Runs inside the page: does the six-button nav sit on one row? */
function measureNav() {
  const buttons = Array.from(document.querySelectorAll('.init-nav-btn[data-view]'));
  if (buttons.length === 0) return { found: false };
  const tops = new Set(buttons.map(b => Math.round(b.getBoundingClientRect().top)));
  const rights = buttons.map(b => b.getBoundingClientRect().right);
  return {
    found: true,
    count: buttons.length,
    rows: tops.size,
    maxRight: Math.round(Math.max(...rights)),
    innerWidth: window.innerWidth
  };
}

async function selectMode(page, mode) {
  await page.evaluate((targetMode) => {
    const btn = document.querySelector(`.init-mode-btn[data-mode="${targetMode}"]`);
    if (btn) btn.click();
  }, mode);
  await page.waitForTimeout(700);
}

async function runVerification() {
  const { ensureBundleBuilt } = require('../tests/fixtures/ensureBundle.js');
  ensureBundleBuilt();
  const app = require('../server/index.js');
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(TEST_PORT, resolve));
  console.log(`[verify] server on http://localhost:${TEST_PORT}${SHELL_PATH}`);

  const failures = [];
  let browser;

  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(String(err)));

    for (const mode of MODES) {
      console.log(`\n================ MODE: ${mode.toUpperCase()} ================`);

      for (const vp of NARROW_VIEWPORTS) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(`http://localhost:${TEST_PORT}${SHELL_PATH}#/command`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1200);
        await selectMode(page, mode);

        console.log(`\n--- ${vp.width}x${vp.height} ---`);
        console.log('view        unreachable   worstRight   rawOverflow   rawWorst   docScrollW   innerW');

        for (const view of VIEWS) {
          await page.evaluate(v => { window.location.hash = `#/${v}`; }, view);
          // DRIVES lazy-loads the 541-row catalogue on first activation.
          await page.waitForTimeout(view === 'drives' ? 2500 : 900);

          const m = await page.evaluate(measureOverflow);
          const worst = m.worstRight === null ? '-' : String(Math.round(m.worstRight));
          const rawWorst = m.rawWorstRight === null ? '-' : String(Math.round(m.rawWorstRight));
          console.log(
            `${view.padEnd(11)} ${String(m.offenderTotalCount).padStart(11)}   ${worst.padStart(10)}   ` +
            `${String(m.rawOverflowCount).padStart(11)}   ${rawWorst.padStart(8)}   ` +
            `${String(m.docScrollWidth).padStart(10)}   ${String(m.innerWidth).padStart(6)}`
          );

          if (m.docScrollWidth > m.innerWidth + 1) {
            failures.push(`[${mode} ${vp.width}px ${view}] page scrolls horizontally: scrollWidth ${m.docScrollWidth} > innerWidth ${m.innerWidth}`);
          }
          if (m.offenderTotalCount > 0) {
            const detail = m.samples
              .map(s => `${s.tag}${s.id ? '#' + s.id : ''}${s.cls ? '.' + s.cls.trim().split(/\s+/).join('.') : ''} right=${s.right}`)
              .join('\n      ');
            failures.push(
              `[${mode} ${vp.width}px ${view}] ${m.offenderTotalCount} element(s) clipped past viewport ` +
              `(worst right edge ${Math.round(m.worstRight)}px):\n      ${detail}` +
              (m.offenderOmittedCount > 0
                ? `\n      ... and ${m.offenderOmittedCount} more (offenderTotalCount=${m.offenderTotalCount}, offenderOmittedCount=${m.offenderOmittedCount})`
                : '')
            );
          }

          const nav = await page.evaluate(measureNav);
          if (nav.found && nav.rows > 1) {
            failures.push(`[${mode} ${vp.width}px ${view}] view nav wrapped onto ${nav.rows} rows`);
          }
          if (nav.found && nav.maxRight > nav.innerWidth + 1) {
            failures.push(`[${mode} ${vp.width}px ${view}] view nav overruns viewport: right ${nav.maxRight} > ${nav.innerWidth}`);
          }
        }
      }

      // Desktop regression guard: COMMAND must stay under 3.25 screens at 1920.
      //
      // RAISED FROM 3.00 ON 2026-08-24, deliberately and by the owner's call, after
      // the card-border and theater-row spacing work. The cards had no left, right
      // or bottom border at all -- three of four edges were carried by a 1.095:1
      // background contrast, which is effectively invisible -- and giving them a
      // real boundary costs vertical space. That was judged worth it on the render.
      //
      // NOTE THIS SCRIPT AND verify_research_tab_layout.js MEASURE DIFFERENT THINGS
      // and will not agree. This one measures `#view-command` alone; that one
      // measures the whole page body, which includes ~130px of header and HUD
      // chrome -- about 0.12 screens at 1080. Measured the day the budget was
      // raised: 2.98 here, 3.104 there, from the same page. Neither is wrong;
      // compare each against its own history, never against the other.
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.goto(`http://localhost:${TEST_PORT}${SHELL_PATH}#/command`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1400);
      await selectMode(page, mode);
      const screens = await page.evaluate(() => {
        const section = document.getElementById('view-command');
        if (!section) return null;
        return section.getBoundingClientRect().height / window.innerHeight;
      });
      if (screens === null) {
        failures.push(`[${mode}] #view-command not found at 1920x1080`);
      } else {
        console.log(`\n[${mode}] COMMAND at 1920x1080: ${screens.toFixed(2)} screens (budget < 3.25)`);
        if (screens >= 3.25) {
          failures.push(`[${mode}] COMMAND is ${screens.toFixed(2)} screens at 1920, budget is < 3.00`);
        }
      }
    }

    if (pageErrors.length > 0) {
      failures.push(`page errors: ${pageErrors.slice(0, 5).join(' | ')}`);
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }

  console.log('\n==================================================');
  if (failures.length > 0) {
    console.error(`FAIL: ${failures.length} problem(s)\n`);
    failures.forEach(f => console.error('  - ' + f));
    process.exitCode = 1;
  } else {
    console.log('PASS: no clipped content at 375/414/768 in either mode; desktop within budget.');
  }
}

runVerification().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
