/**
 * Mission Control layout regression tests — rendered geometry, not CSS text.
 *
 * Both defects these pin were invisible to source review and to a browser check
 * at 1440 and 375, because both are width-specific and both are about boxes
 * rather than declarations.
 *
 * 1. HEADER COLLISION. `.init-topbar` used to switch to a three-column grid at
 *    1501px whose own minimum width was 1625px (220 + 320 + the controls' 989px
 *    max-content + 44 gap + 52 padding). Between those numbers both fr tracks
 *    clamped to their floors and the brand block's 291px of content overflowed
 *    its 220px track, putting "CAMPAIGN INTELLIGENCE / EXECUTIVE BRIEFING" on
 *    top of the ALIEN HATE meter. Measured: a collision at every width from
 *    1501 to ~1690px, worst 27.8 x 6px. 1440 and 1920 were both clean, which is
 *    why three source reviews and a browser pass missed it.
 *    The sweep below is the point of the test: a single width proves nothing.
 *
 * 2. DEAD GRID TRACK. `.init-view__grid` used to take a third column at
 *    >=1600px. No view has three cards that are not full-width spans, so the
 *    third track was always empty and the two real cards paid for it -- 764px
 *    down to 501px. Inside RECORDS that cascaded: TECHNOLOGY WATCH's three-up
 *    `.mc-watch-grid` resolved to 144px per section against tables needing 439
 *    and 425px, so both truthfully reported "SWIPE HORIZONTALLY TO VIEW ALL
 *    COLUMNS" while clipping 316px each.
 *
 * The scroll-hint assertion is deliberately two-sided. The hints are measured by
 * syncScrollHints() against real overflow, and the fix must keep them measured:
 * a hint shown over a table that fits is the same defect as a hint withheld from
 * one that does not.
 */

const { test, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { useSyntheticSaveDir } = require('./fixtures/syntheticSave');

// The shell fetches save-backed routes, so the server must serve a committed
// synthetic save rather than the live save folder (enforced behaviourally by
// tests/noLiveSaveInUnitSuite.test.js). Point TI_SAVE_PATH at a throwaway dir
// BEFORE the server is required: server/index.js's module-level config
// resolution reads it, and its dotenv load only fills unset variables.
const SYNTHETIC_SAVE_DIR = useSyntheticSaveDir('ti-mc-layout-save-');
after(() => fs.rmSync(SYNTHETIC_SAVE_DIR, { recursive: true, force: true }));

// `/v2/index.html`, never `/v2/`. `res.sendFile` defaults to
// `dotfiles: 'ignore'`, so the `/v2` route 404s whenever the repo is checked out
// beneath a dotted directory (a git worktree under `.claude/`).
const SHELL_PATH = '/v2/index.html';

// 940 to 2040 -- everything above the 901px point where the header stops being a
// column. The old three-column rule fired at 1501 and only actually fitted at
// ~1700, so the band the bug lived in is inside this range, and 1501 and 1690
// are named explicitly because they are its edges. The lower half matters too:
// removing the 1500/1320/1200px blocks changed the layout there as well, and a
// sweep that starts above them would not have noticed.
const SWEEP_WIDTHS = [];
for (let w = 940; w <= 2040; w += 40) SWEEP_WIDTHS.push(w);
for (const edge of [1501, 1520, 1600, 1690]) {
  if (!SWEEP_WIDTHS.includes(edge)) SWEEP_WIDTHS.push(edge);
}
SWEEP_WIDTHS.sort((a, b) => a - b);

/**
 * Runs in the page. Every pair of visibly-overlapping text boxes where one sits
 * in the brand block and the other in the status HUD. Rectangles, not
 * declarations -- this is what the reader actually sees.
 */
function measureHeaderCollisions() {
  function textBoxes(root) {
    if (!root) return [];
    const out = [];
    for (const el of root.querySelectorAll('*')) {
      if (el.getClientRects().length === 0) continue;
      const box = el.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) continue;
      const text = (el.textContent || '').trim();
      if (!text) continue;
      // Leaf-ish text carriers only, so a wrapper does not report its child's
      // text twice.
      if (el.children.length > 0 && el.tagName !== 'STRONG') continue;
      out.push({ box, text: text.slice(0, 40) });
    }
    return out;
  }

  const collisions = [];
  const brand = textBoxes(document.querySelector('.init-brand'));
  const hud = textBoxes(document.querySelector('.init-topbar-hud'));
  for (const a of brand) {
    for (const b of hud) {
      const x = Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left);
      const y = Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top);
      if (x > 0.5 && y > 0.5) {
        collisions.push({
          brandText: a.text,
          hudText: b.text,
          overlapX: Math.round(x * 10) / 10,
          overlapY: Math.round(y * 10) / 10
        });
      }
    }
  }

  // The containment half of the same bug, measured on the descendants rather
  // than on `.init-brand` itself: where the topbar is a column (below 901px)
  // `.init-brand` is stretched to the container width, so it is the text inside
  // it that escapes. `.init-brand-sub` carries `text-overflow: ellipsis` that can
  // only ever fire if the min-width chain reaches it.
  const topbar = document.querySelector('.init-topbar');
  const brandRoot = document.querySelector('.init-brand');
  let brandEscapesBy = 0;
  if (topbar && brandRoot) {
    const topbarStyle = getComputedStyle(topbar);
    const contentRight = topbar.getBoundingClientRect().right
      - (parseFloat(topbarStyle.paddingRight) || 0);
    for (const el of brandRoot.querySelectorAll('*')) {
      if (el.getClientRects().length === 0) continue;
      const over = el.getBoundingClientRect().right - contentRight;
      if (over > brandEscapesBy) brandEscapesBy = over;
    }
  }

  // Truncated HUD readings. Squeezing the HUD does not overlap anything -- it
  // ellipsizes, silently, and the reader loses the label rather than seeing a
  // collision. `.init-hud-pill-alert strong` is the one standing exception: it
  // carries an explicit `max-width: 150px` and the full DEFCON string is longer
  // than that at every width.
  const truncated = [];
  for (const el of document.querySelectorAll('.init-topbar-hud .init-hud-pill span, .init-topbar-hud .init-hud-pill strong')) {
    if (el.closest('.init-hud-pill-alert')) continue;
    if (el.scrollWidth > el.clientWidth + 1) {
      truncated.push(`${(el.textContent || '').trim().slice(0, 26)} [${el.clientWidth}/${el.scrollWidth}]`);
    }
  }

  return {
    innerWidth: window.innerWidth,
    collisions,
    truncated,
    brandEscapesBy: Math.round(brandEscapesBy * 10) / 10
  };
}

/**
 * Runs in the page. How many column tracks a `.init-view__grid` declares, and
 * how many cards it has that are not full-width spans. A track the view's own
 * cards can never fill is the defect; comparing the two counts is the direct
 * statement of it, and it does not misfire on a span that happens to be
 * narrower than the row (the API access panel is 1348px of 1392px by design).
 */
function measureGridTracks(viewId) {
  const section = document.getElementById('view-' + viewId);
  if (!section) return null;
  const grid = section.querySelector('.init-view__grid');
  if (!grid) return null;

  const style = getComputedStyle(grid);
  if (style.display !== 'grid') return { display: style.display };

  const trackWidths = style.gridTemplateColumns
    .split(/\s+/)
    .map((t) => parseFloat(t))
    .filter((n) => Number.isFinite(n));

  let spanCount = 0;
  let cardCount = 0;
  const cardWidths = [];
  for (const child of grid.children) {
    if (child.getClientRects().length === 0) continue;
    const box = child.getBoundingClientRect();
    if (box.width <= 0) continue;
    if (child.classList.contains('init-view__span') || child.classList.contains('init-view__full-card')) {
      spanCount += 1;
    } else {
      cardCount += 1;
      cardWidths.push(Math.round(box.width));
    }
  }

  return {
    display: style.display,
    columns: style.gridTemplateColumns,
    trackCount: trackWidths.length,
    spanCount,
    cardCount,
    cardWidths
  };
}

/** Runs in the page. Every scroll hint, and whether its wrapper really scrolls. */
function measureScrollHints(viewId) {
  const section = document.getElementById('view-' + viewId);
  if (!section) return [];
  const pairs = [
    ['.mc-board-scroll-hint', '.mc-board-table-wrap', 'after'],
    ['.de-scroll-hint', '.de-table-wrap', 'after'],
    ['.fe-scroll-hint', '.fe-table-wrap', 'after'],
    ['.intel-library-table-scroll-hint', '.intel-library-table-wrap', 'inside']
  ];
  const out = [];
  for (const [hintSelector, wrapSelector, placement] of pairs) {
    for (const hint of section.querySelectorAll(hintSelector)) {
      const wrap = placement === 'inside' ? hint.parentElement : hint.previousElementSibling;
      if (!wrap || !wrap.matches(wrapSelector)) continue;
      out.push({
        selector: hintSelector,
        shown: hint.classList.contains('is-scrollable'),
        scrolls: wrap.scrollWidth > wrap.clientWidth + 1,
        client: wrap.clientWidth,
        scroll: wrap.scrollWidth
      });
    }
  }
  return out;
}

/** Runs in the page. The TECHNOLOGY WATCH board wrappers and their overflow. */
function measureWatchGrid() {
  const grid = document.querySelector('#view-records .mc-watch-grid');
  if (!grid) return null;
  const wraps = [];
  for (const wrap of grid.querySelectorAll('.mc-board-table-wrap')) {
    wraps.push({
      client: wrap.clientWidth,
      scroll: wrap.scrollWidth,
      shortfall: Math.max(0, wrap.scrollWidth - wrap.clientWidth)
    });
  }
  return {
    columns: getComputedStyle(grid).gridTemplateColumns,
    gridWidth: Math.round(grid.getBoundingClientRect().width),
    wraps
  };
}

async function selectMode(page, mode) {
  await page.evaluate((target) => {
    const btn = document.querySelector(`.init-mode-btn[data-mode="${target}"]`);
    if (btn) btn.click();
  }, mode);
  await page.waitForTimeout(800);
}

async function gotoView(page, view) {
  await page.evaluate((v) => { window.location.hash = `#/${v}`; }, view);
  await page.waitForTimeout(view === 'drives' ? 2000 : 650);
}

async function withPage(fn) {
  const app = require('../server/index.js');
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.goto(`http://localhost:${port}${SHELL_PATH}#/command`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await fn(page);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('the command header never overlaps its own brand and status blocks, at any width', async () => {
  await withPage(async (page) => {
    const colliding = [];
    const escaping = [];
    const truncating = [];

    for (const width of SWEEP_WIDTHS) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForTimeout(120);
      const measured = await page.evaluate(measureHeaderCollisions);
      if (measured.truncated.length > 0) {
        truncating.push(`${width}px: ${measured.truncated.join(' | ')}`);
      }
      if (measured.collisions.length > 0) {
        const worst = measured.collisions
          .slice()
          .sort((a, b) => b.overlapX * b.overlapY - a.overlapX * a.overlapY)[0];
        colliding.push(
          `${width}px: "${worst.brandText}" over "${worst.hudText}" ` +
          `(${worst.overlapX} x ${worst.overlapY}px, ${measured.collisions.length} pair(s))`
        );
      }
      if (measured.brandEscapesBy > 1) escaping.push(`${width}px by ${measured.brandEscapesBy}px`);
    }

    assert.deepStrictEqual(
      colliding, [],
      `brand text overlaps HUD text at ${colliding.length} of ${SWEEP_WIDTHS.length} sampled widths:\n  ` +
      colliding.join('\n  ')
    );
    assert.deepStrictEqual(
      escaping, [],
      `the brand block overflows the header at: ${escaping.join(', ')}`
    );
    // Starving the HUD is the quiet version of the same bug: nothing overlaps,
    // the labels just disappear into ellipses. Squeezing the HUD onto the brand's
    // row below 1200px cost four readings at 1024px -- OBSERVER, the faction
    // name, the strategic score label and its value -- which is why the header
    // keeps one breakpoint there.
    assert.deepStrictEqual(
      truncating, [],
      `HUD labels or values ellipsize at ${truncating.length} of ${SWEEP_WIDTHS.length} sampled widths:\n  ` +
      truncating.join('\n  ')
    );
  });
});

test('a faction name far longer than the save\'s own is contained, not spilled', async () => {
  // The brand's identity text is loaded from the save, and THE INITIATIVE only
  // just fits: measured 2026-08-23, its 340px of logo + copy sits in a 343px
  // brand box at 375px. A longer executive name has to ellipsize inside that box.
  //
  // Narrow widths are the ones that matter here and wide ones are not, which is
  // the opposite of the collision test above. Above 901px the header is a wrap
  // row, so a wide brand pushes the HUD onto its own line and nothing overlaps.
  // Below 901px it is a stretched column: the brand box is the full container
  // width, so an over-wide copy block escapes the viewport instead -- which is
  // the reachability failure `scripts/verify_mobile_overflow.js` exists to catch.
  // 320 and 360 are below the 375px floor `verify_mobile_overflow.js` checks,
  // and they are where the static subtitle stops fitting: "CAMPAIGN
  // INTELLIGENCE / EXECUTIVE BRIEFING" measures 291px against a 294px copy box
  // at 375px with a faction logo, so it is 3px from escaping on the narrowest
  // viewport that script covers.
  const NARROW = [320, 360, 375, 414, 768, 880];
  await withPage(async (page) => {
    const spilling = [];

    for (const width of [...NARROW, ...SWEEP_WIDTHS]) {
      await page.setViewportSize({ width, height: width < 900 ? 812 : 1000 });
      await page.waitForTimeout(120);
      // Re-applied per width: a mode or save refresh would rewrite this node.
      await page.evaluate(() => {
        const el = document.getElementById('initBrandFactionName');
        if (el) el.textContent = 'THE SERVANTS OF THE HIDDEN ONES INTERPLANETARY EXECUTIVE DIRECTORATE';
      });
      await page.waitForTimeout(60);
      const measured = await page.evaluate(measureHeaderCollisions);
      if (measured.collisions.length > 0 || measured.brandEscapesBy > 1) {
        spilling.push(
          `${width}px: ${measured.collisions.length} overlap(s), escapes header by ${measured.brandEscapesBy}px`
        );
      }
    }

    assert.deepStrictEqual(
      spilling, [],
      `a long faction name spills out of the brand block at:\n  ${spilling.join('\n  ')}`
    );
  });
});

test('no view grid claims more tracks than its own cards can fill, and no table is starved inside one', async () => {
  // One walk, three assertions, because each page load costs ~0.7s and DRIVES
  // costs 2s. The scroll-hint check is two-sided on purpose: `syncScrollHints`
  // measures rather than guesses, and this fix changes table widths, so the
  // hints have to be re-measured -- not re-gated on a viewport number.
  await withPage(async (page) => {
    const deadTracks = [];
    const starved = [];
    const lyingHints = [];

    function collectHints(mode, width, view, hints) {
      for (const hint of hints) {
        if (hint.shown !== hint.scrolls) {
          lyingHints.push(
            `[${mode} ${width}px ${view}] ${hint.selector} shown=${hint.shown} ` +
            `but wrapper ${hint.scrolls ? 'does' : 'does not'} overflow ` +
            `(client ${hint.client} / scroll ${hint.scroll})`
          );
        }
      }
    }

    for (const mode of ['player', 'omniscient']) {
      await selectMode(page, mode);

      for (const width of [1440, 1600, 1920]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.waitForTimeout(200);

        for (const view of ['expansion', 'records']) {
          await gotoView(page, view);

          const grid = await page.evaluate(measureGridTracks, view);
          assert.ok(grid && grid.display === 'grid', `[${mode} ${width}px ${view}] .init-view__grid is not a grid`);
          if (grid.trackCount > Math.max(1, grid.cardCount)) {
            deadTracks.push(
              `[${mode} ${width}px ${view}] ${grid.trackCount} tracks for ${grid.cardCount} non-span card(s) ` +
              `(+${grid.spanCount} span(s)); at least one track can never be filled. ` +
              `columns=${grid.columns} cardWidths=${JSON.stringify(grid.cardWidths)}`
            );
          }

          collectHints(mode, width, view, await page.evaluate(measureScrollHints, view));

          if (view === 'records') {
            const watch = await page.evaluate(measureWatchGrid);
            assert.ok(watch, `[${mode} ${width}px] #view-records .mc-watch-grid did not render`);
            assert.ok(watch.wraps.length > 0, `[${mode} ${width}px] the watch grid rendered no board tables`);
            for (const wrap of watch.wraps) {
              if (wrap.shortfall > 1) {
                starved.push(
                  `[${mode} ${width}px] a watch table needs ${wrap.scroll}px in a ${wrap.client}px column ` +
                  `(short ${wrap.shortfall}px). grid=${watch.gridWidth}px columns=${watch.columns}`
                );
              }
            }
          }
        }
      }

      // DRIVES and COMMAND carry the other two hint families; visit them once
      // per mode rather than at every width, because DRIVES lazily builds a
      // 541-row catalogue on activation.
      await page.setViewportSize({ width: 1600, height: 1000 });
      await page.waitForTimeout(200);
      for (const view of ['command', 'drives']) {
        await gotoView(page, view);
        collectHints(mode, 1600, view, await page.evaluate(measureScrollHints, view));
      }

      // THREAT lays out through TwoColumnGrid (`.init-view__grid` via React).
      // Visit it for scroll-hint measurement only.
      await page.setViewportSize({ width: 1600, height: 1000 });
      await page.waitForTimeout(200);
      await gotoView(page, 'threat');
      collectHints(mode, 1600, 'threat', await page.evaluate(measureScrollHints, 'threat'));

      // And once narrow, where the hints used to be revealed by width alone.
      await page.setViewportSize({ width: 375, height: 812 });
      await page.waitForTimeout(200);
      for (const view of ['expansion', 'records']) {
        await gotoView(page, view);
        collectHints(mode, 375, view, await page.evaluate(measureScrollHints, view));
      }
    }

    assert.deepStrictEqual(deadTracks, [], deadTracks.join('\n'));
    assert.deepStrictEqual(starved, [], starved.join('\n'));
    assert.deepStrictEqual(lyingHints, [], lyingHints.join('\n'));
  });
});
