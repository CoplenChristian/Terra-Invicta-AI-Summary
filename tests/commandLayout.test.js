/**
 * tests/commandLayout.test.js
 *
 * Purpose: pins the measured COMMAND layout invariants -- that widening the
 *   viewport never narrows a table, that scroll hints stay measured, that no
 *   figure renders twice or clipped, and that every card leads with its header.
 *
 * THE DEFECTS THIS FILE EXISTS FOR
 * --------------------------------
 * 1. THE 1400px INVERSION. `@media (min-width: 1400px)` gave
 *    `.operative-leaderboard` `grid-template-columns: repeat(auto-fill,
 *    minmax(280px, 1fr))`. `auto-fill` does not know the panel is already
 *    inside COMMAND's half-width column, so at 655px it fitted TWO 280px
 *    tracks and split the panel again. The OPERATIONS BOARD's 780px 12-column
 *    table then got a 322.5px window. Measured in the live DOM before the fix:
 *
 *      1399px viewport -> table window 639px, 81.9% visible, 141px hidden
 *      1440px viewport -> table window 323px, 41.4% visible, 457px hidden
 *
 *    Widening the browser by 41px cost the table 316px. Test 1 is the general
 *    form of that: a wider viewport must never give a table a narrower window.
 *    Pinning "no grid at 1400" would only catch this exact CSS; monotonicity
 *    catches the next container that does the same thing by a different route.
 *
 * 2. FIGURES RENDERED TWICE. "STRATEGIC SCORE (EST.): 66/100" was in the top
 *    HUD and again in the executive strip one screen below; the primary
 *    directive title was printed as a 38px serif heading and again verbatim in
 *    body type beneath it, because `primaryDirective()` builds the statement as
 *    `recommendation || title` and the engine emits no `recommendation`.
 *
 * 3. FIGURES RENDERED CLIPPED. `.init-kpi-label` / `.init-kpi-sub` are nowrap
 *    with `text-overflow: ellipsis`. In the half-width column they rendered
 *    "STRATEGIC SCORE (EST..." and "Composite estimate · Ra...", and
 *    `.holo-node-status` rendered "the Servants / 83..." -- a measured value
 *    with its decimals cut, which reads as a smaller number rather than as a
 *    truncated one.
 *
 * 4. BODY BEFORE HEADER. The executive strip sat inside the PRIORITY BRIEF
 *    card ABOVE that card's own `.tech-card-header`, so one card on the page
 *    read body -> header -> body.
 *
 * DELIBERATE-BREAK RECORD (2026-08-23)
 * ------------------------------------
 * Every assertion here was confirmed to fail against a deliberately broken
 * tree before being trusted, and the tree restored byte-identical after each:
 *
 *   B1 restore the `.operative-leaderboard` auto-fill grid    -> test 1 red
 *   B2 re-add the `#hudPower` HUD pill                        -> test 3 red
 *   B3 always write `statement` into `#holoPrimaryStatement`  -> test 4 red
 *   B4 put `.init-kpi-banner` back above the card header      -> test 5 red
 *   B5 re-add a `.holo-node-num` element                      -> test 6 red
 *   B6 restore the bordered stage, its ::before and pointer   -> test 6 red
 *   B7 restore `nowrap` + `ellipsis` on `.holo-node-status`   -> test 7 red
 *   B8 restore the hardcoded "01" in `.holo-core-badge`       -> test 6 red
 *   B9 drop the <=900px wrap override on the strip labels     -> test 7 red
 *
 * B7 is the one that changed the test. It went GREEN the first time, because
 * test 7 was measuring only 375px and 1440px and the node status clips at
 * neither. A 14-width sweep found it clipping at 1200/1320/1399 only, so those
 * widths were added; without them test 7 could not have failed for half of what
 * it claims to cover, which is the "a test that only passes proves nothing"
 * failure this repo has been bitten by before.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { chromium } = require('playwright');

const TEST_PORT = Number(process.env.COMMAND_LAYOUT_PORT || 3989);

// `/v2/` goes through `res.sendFile`, which 404s from a checkout under a dot
// directory (every agent worktree). `/v2/index.html` is served by
// express.static, which sets a root and does not. Same reason
// tests/missionControlShell.test.js exists.
const SHELL = '/v2/index.html';

const MODES = ['player', 'omniscient'];

async function settle(page) {
  await page.waitForFunction(() => {
    const el = document.getElementById('hudDate');
    return el && el.textContent && !/loading/i.test(el.textContent);
  }, { timeout: 90000 });
  await page.waitForFunction(() => {
    const el = document.getElementById('opLeaderboardList');
    return el && el.textContent && el.textContent.trim().length > 40;
  }, { timeout: 90000 });
  await page.waitForTimeout(400);
}

async function selectMode(page, mode) {
  const changed = await page.evaluate((m) => {
    const btn = document.querySelector(`.init-mode-btn[data-mode="${m}"]`);
    if (!btn || btn.getAttribute('aria-pressed') === 'true') return false;
    btn.click();
    return true;
  }, mode);
  if (changed) {
    await page.waitForTimeout(2500);
    await settle(page);
  }
}

/** The OPERATIONS BOARD table, its wrapper window and its measured hint. */
function measureOpsTable() {
  const wrap = document.querySelector('#opLeaderboardList .mc-board-table-wrap');
  if (!wrap) return null;
  const table = wrap.querySelector('table.mc-board-table');
  const hint = wrap.nextElementSibling;
  return {
    windowWidth: wrap.clientWidth,
    contentWidth: wrap.scrollWidth,
    tableWidth: table ? table.getBoundingClientRect().width : null,
    overflows: wrap.scrollWidth > wrap.clientWidth + 1,
    hintIsScrollable: Boolean(hint && hint.classList.contains('mc-board-scroll-hint')
      && hint.classList.contains('is-scrollable'))
  };
}

/** Elements whose own box clips their text. Truncation is a wrong figure. */
function findClippedText(selectors) {
  const clipped = [];
  for (const selector of selectors) {
    for (const el of document.querySelectorAll(selector)) {
      if (el.getClientRects().length === 0) continue;
      // 1px of slack: subpixel layout rounds scrollWidth up on some glyphs.
      if (el.scrollWidth > el.clientWidth + 1) {
        clipped.push({
          selector,
          text: (el.textContent || '').trim().slice(0, 60),
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth
        });
      }
    }
  }
  return clipped;
}

async function withPage(fn) {
  const app = require('../server/index.js');
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(TEST_PORT, resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(String(err)));
    await page.goto(`http://localhost:${TEST_PORT}${SHELL}#/command`, { waitUntil: 'domcontentloaded' });
    await settle(page);
    await fn(page, pageErrors);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('widening the viewport never narrows the operations table window', async () => {
  await withPage(async (page) => {
    for (const mode of MODES) {
      await page.setViewportSize({ width: 1399, height: 1100 });
      await selectMode(page, mode);
      await page.waitForTimeout(300);
      const narrow = await page.evaluate(measureOpsTable);
      assert.ok(narrow, `[${mode}] the operations table must render at 1399px`);

      await page.setViewportSize({ width: 1440, height: 1100 });
      await page.waitForTimeout(500);
      const wide = await page.evaluate(measureOpsTable);
      assert.ok(wide, `[${mode}] the operations table must render at 1440px`);

      assert.ok(
        wide.windowWidth >= narrow.windowWidth,
        `[${mode}] widening 1399 -> 1440 narrowed the operations table window from `
        + `${narrow.windowWidth}px to ${wide.windowWidth}px. A container inside COMMAND's `
        + `half-width column is splitting itself again -- check for auto-fill/auto-fit tracks.`
      );

      // The 41px of extra viewport reaches the panel: half of it, less the grid
      // gap. Without this the assertion above would also pass if the panel
      // simply stopped responding to width at all.
      assert.ok(
        wide.windowWidth > narrow.windowWidth,
        `[${mode}] the operations table window did not grow at all between 1399px `
        + `(${narrow.windowWidth}px) and 1440px (${wide.windowWidth}px)`
      );
    }
  });
});

test('the operations table scroll hint is measured, not gated on viewport width', async () => {
  await withPage(async (page) => {
    for (const mode of MODES) {
      await selectMode(page, mode);
      for (const width of [375, 1399, 1440]) {
        await page.setViewportSize({ width, height: 1100 });
        await page.waitForTimeout(500);
        const m = await page.evaluate(measureOpsTable);
        assert.ok(m, `[${mode} ${width}px] the operations table must render`);
        assert.equal(
          m.hintIsScrollable,
          m.overflows,
          `[${mode} ${width}px] the scroll hint says scrollable=${m.hintIsScrollable} but the `
          + `wrapper measures ${m.contentWidth}px of content in a ${m.windowWidth}px window. `
          + `syncScrollHints must follow the measurement, never the viewport.`
        );
      }
    }
  });
});

test('the strategic score renders once, and keeps its qualifier and rank', async () => {
  await withPage(async (page) => {
    for (const mode of MODES) {
      await selectMode(page, mode);
      const state = await page.evaluate(() => ({
        hudPowerExists: Boolean(document.getElementById('hudPower')),
        scorePillExists: Boolean(document.querySelector('.init-hud-pill-score')),
        kpiPower: (document.getElementById('kpiPower') || {}).textContent || null,
        kpiPowerSub: (document.getElementById('kpiPowerSub') || {}).textContent || null,
        // How many elements render the score string as their whole text.
        scoreLeafCount: [...document.querySelectorAll('body *')].filter((el) => {
          if (el.children.length > 0) return false;
          if (el.getClientRects().length === 0) return false;
          return /^\d+\/100$/.test((el.textContent || '').trim());
        }).length
      }));

      assert.equal(state.hudPowerExists, false,
        `[${mode}] #hudPower still exists: the strategic score is rendered twice on one screen`);
      assert.equal(state.scorePillExists, false,
        `[${mode}] .init-hud-pill-score still exists`);
      assert.equal(state.scoreLeafCount, 1,
        `[${mode}] the "n/100" score renders in ${state.scoreLeafCount} elements; expected exactly 1`);

      assert.match(state.kpiPower, /^\d+\/100$|^UNAVAILABLE$/,
        `[${mode}] the surviving score reads "${state.kpiPower}"`);
      // The rank is the figure the deleted HUD pill never carried, so deleting
      // the strip instance instead would have lost it.
      assert.match(state.kpiPowerSub, /Composite estimate · (Rank #\d+|rank unavailable)/,
        `[${mode}] the score sublabel lost its qualifier or rank: "${state.kpiPowerSub}"`);
    }
  });
});

test('the primary directive title is not printed a second time beneath itself', async () => {
  await withPage(async (page) => {
    for (const mode of MODES) {
      await selectMode(page, mode);
      const brief = await page.evaluate(() => {
        const title = document.getElementById('holoPrimaryTitle');
        const statement = document.getElementById('holoPrimaryStatement');
        const titleText = (title.textContent || '').trim();
        return {
          titleText,
          statementText: (statement.textContent || '').trim(),
          statementHidden: statement.hidden,
          // Any element inside the card whose whole visible text is the title.
          repeats: [...document.querySelectorAll('#priorityBriefCard *')].filter((el) => (
            el !== title
            && el.getClientRects().length > 0
            && (el.textContent || '').trim() === titleText
          )).length
        };
      });

      assert.ok(brief.titleText.length > 0, `[${mode}] the primary directive title must render`);
      assert.equal(brief.repeats, 0,
        `[${mode}] the title "${brief.titleText}" is repeated in ${brief.repeats} other element(s) `
        + `inside #priorityBriefCard`);
      if (!brief.statementHidden) {
        assert.notEqual(brief.statementText, brief.titleText,
          `[${mode}] the statement is visible and identical to the title`);
      }
    }
  });
});

test('every COMMAND card leads with its header', async () => {
  await withPage(async (page) => {
    for (const mode of MODES) {
      await selectMode(page, mode);
      const offenders = await page.evaluate(() => {
        const bad = [];
        for (const card of document.querySelectorAll('#view-command .tech-card')) {
          const header = card.querySelector(':scope > .tech-card-header');
          if (!header) continue;
          const first = card.firstElementChild;
          if (first !== header) {
            bad.push({
              title: (header.querySelector('.tech-card-title') || {}).textContent || '(untitled)',
              precededBy: first ? (first.className || first.tagName) : '(nothing)'
            });
          }
          if (header.getAttribute('style')) {
            bad.push({
              title: (header.querySelector('.tech-card-title') || {}).textContent || '(untitled)',
              precededBy: `inline style="${header.getAttribute('style')}"`
            });
          }
        }
        return bad;
      });
      assert.deepEqual(offenders, [],
        `[${mode}] card header(s) not first, or carrying inline layout style: `
        + JSON.stringify(offenders));
    }
  });
});

test('the priority card carries no vestigial decoration', async () => {
  await withPage(async (page) => {
    const dom = await page.evaluate(() => {
      const stage = document.getElementById('priorityBriefCard');
      const stageStyle = getComputedStyle(stage);
      const before = getComputedStyle(stage, '::before');
      return {
        orbitRings: document.querySelectorAll('.holo-orbit-ring-outer, .holo-orbit-ring-inner').length,
        nodeNumerals: document.querySelectorAll('.holo-node-num').length,
        // A nested bordered, raised box inside .tech-card-body is a card in a card.
        stageBorderTop: stageStyle.borderTopWidth,
        stageBorderLeft: stageStyle.borderLeftWidth,
        // cursor:pointer on a div with no handler, no tabindex and no role
        // advertises an interaction that does not exist.
        stageCursor: stageStyle.cursor,
        stageTabIndex: stage.getAttribute('tabindex'),
        stageRole: stage.getAttribute('role'),
        // The 42%-wide accent rule that terminated in the middle of the panel.
        stageBeforeContent: before.content,
        // The hardcoded "01" after "PRIMARY DIRECTIVE /".
        badgeText: (document.querySelector('.holo-core-badge') || {}).textContent || ''
      };
    });

    assert.equal(dom.orbitRings, 0, 'display:none orbit-ring elements are still in the markup');
    assert.equal(dom.nodeNumerals, 0, 'decorative .holo-node-num numerals are still in the markup');
    assert.equal(dom.stageBorderTop, '0px', '.init-hologram-stage is still a bordered card inside a card');
    assert.equal(dom.stageBorderLeft, '0px', '.init-hologram-stage is still a bordered card inside a card');
    assert.notEqual(dom.stageCursor, 'pointer',
      '.init-hologram-stage claims cursor:pointer but has no click handler, tabindex or role '
      + `(tabindex=${dom.stageTabIndex}, role=${dom.stageRole})`);
    assert.ok(['none', 'normal', ''].includes(dom.stageBeforeContent),
      `.init-hologram-stage::before is back: content=${dom.stageBeforeContent}`);
    assert.equal(dom.badgeText.trim(), '',
      `the hardcoded directive numeral is back in .holo-core-badge: "${dom.badgeText.trim()}"`);
  });
});

test('no executive-strip or node figure renders clipped', async () => {
  await withPage(async (page, pageErrors) => {
    const selectors = ['.init-kpi-label', '.init-kpi-val', '.init-kpi-sub', '.holo-node-label', '.holo-node-status'];
    // These four widths are not decoration. Scanning 14 widths from 375 to 1920
    // with the old `nowrap` + `ellipsis` reinstated (2026-08-23), clipping
    // reproduced at exactly two places: 375 clipped "STRATEGIC SCORE (EST.)"
    // and "Composite estimate · Rank #n", and 1200/1320/1399 clipped
    // "the Servants / 83.9%" down to "the Servants / 83...". 1440 clipped
    // nothing even with the defect restored, so a 375+1440 pair would have been
    // a test that could not fail for half of what it claims to cover.
    for (const mode of MODES) {
      await selectMode(page, mode);
      for (const width of [375, 1200, 1399, 1440]) {
        await page.setViewportSize({ width, height: 1100 });
        await page.waitForTimeout(500);
        const clipped = await page.evaluate(findClippedText, selectors);
        assert.deepEqual(clipped, [],
          `[${mode} ${width}px] figure(s) clipped by their own box: ${JSON.stringify(clipped)}`);
      }
    }
    assert.deepEqual(pageErrors, [], `page errors during the COMMAND layout run: ${pageErrors.join(' | ')}`);
  });
});
