/**
 * scripts/verify_expansion_grid2.js
 *
 * Purpose: six post-conversion checks for EXPANSION TwoColumnGrid migration.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { ensureBundleBuilt } = require('../tests/fixtures/ensureBundle.js');

process.env.NODE_ENV = 'test';

const PANEL_IDS = [
  'miningExpansion',
  'mcBudget',
  'resourceFlowChart',
  'holdingsBubbleMatrix',
];
const SPAN_PANEL_IDS = ['miningExpansion', 'holdingsBubbleMatrix'];
const MODES = ['player', 'omniscient'];
const VIEWPORTS = [
  { width: 375, height: 812, label: '375' },
  { width: 414, height: 896, label: '414' },
  { width: 768, height: 1024, label: '768' },
  { width: 1660, height: 900, label: 'desktop' },
];

async function run() {
  ensureBundleBuilt();
  const beforePath = path.resolve('tests/fixtures/expansion-view-proof/baseline-before.json');
  const afterPath = path.resolve('tests/fixtures/expansion-view-proof/baseline-after.json');
  if (!fs.existsSync(beforePath) || !fs.existsSync(afterPath)) {
    throw new Error('Missing before/after proof captures');
  }
  const before = JSON.parse(fs.readFileSync(beforePath, 'utf8'));
  const after = JSON.parse(fs.readFileSync(afterPath, 'utf8'));

  const failures = [];

  // Check 1: rendered text character-identical
  for (const mode of MODES) {
    for (const vp of VIEWPORTS) {
      const b = before.modes[mode].viewports[vp.label].text;
      const a = after.modes[mode].viewports[vp.label].text;
      if (b !== a) {
        failures.push(`[1 text] ${mode}/${vp.label}: text differs (before ${b.length}, after ${a.length})`);
      }
    }
  }
  console.log('[1] Rendered text character-identical:', failures.filter((f) => f.startsWith('[1')).length === 0 ? 'PASS' : 'FAIL');

  const app = require('../server/index.js');
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });

  try {
    for (const mode of MODES) {
      for (const vp of VIEWPORTS) {
        const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
        await page.goto(`http://127.0.0.1:${port}/v2/index.html#/expansion`, { waitUntil: 'networkidle' });
        await page.evaluate((targetMode) => {
          document.querySelector(`.init-mode-btn[data-mode="${targetMode}"]`)?.click();
        }, mode);
        await page.waitForTimeout(1200);
        await page.evaluate(() => {
          document.querySelector('.init-nav-btn[data-view="expansion"]')?.click();
        });
        await page.waitForTimeout(2500);

        const result = await page.evaluate(({ panelIds, spanPanelIds }) => {
          function rectsOverlap(a, b) {
            return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
          }

          const section = document.getElementById('view-expansion');
          const grid = section?.querySelector('[data-primitive="two-column-grid"]');
          const mounts = {};
          const cardRects = [];
          const seenCards = new Set();
          const spanCardWidths = {};

          for (const id of panelIds) {
            const el = document.getElementById(id);
            if (!el) {
              mounts[id] = { error: 'missing' };
              continue;
            }
            const card = el.closest('.tech-card') || el.closest('[data-primitive="panel"]');
            const rect = el.getBoundingClientRect();
            const cardRect = card?.getBoundingClientRect();
            mounts[id] = {
              width: rect.width,
              height: rect.height,
              cardWidth: cardRect?.width ?? 0,
              cardHeight: cardRect?.height ?? 0,
              cardRect: cardRect ? {
                x: cardRect.x, y: cardRect.y, width: cardRect.width, height: cardRect.height,
              } : null,
            };
            if (spanPanelIds.includes(id) && cardRect) {
              spanCardWidths[id] = cardRect.width;
            }
            if (card && cardRect && cardRect.height > 0 && cardRect.width > 0 && !seenCards.has(card)) {
              seenCards.add(card);
              cardRects.push({
                id,
                x: cardRect.x,
                y: cardRect.y,
                width: cardRect.width,
                height: cardRect.height,
              });
            }
          }

          const sectionRect = section?.getBoundingClientRect();
          const overlaps = [];
          for (let i = 0; i < cardRects.length; i++) {
            for (let j = i + 1; j < cardRects.length; j++) {
              if (rectsOverlap(cardRects[i], cardRects[j])) {
                overlaps.push(`${cardRects[i].id} vs ${cardRects[j].id}`);
              }
            }
          }

          let integrityOk = false;
          try {
            window.MissionControlViews?.assertViewRegistryIntegrity?.();
            integrityOk = true;
          } catch (e) {
            integrityOk = false;
          }

          return {
            mounts,
            scrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
            hasGrid: Boolean(grid),
            sectionWidth: sectionRect?.width ?? 0,
            spanCardWidths,
            overlaps,
            integrityOk,
          };
        }, { panelIds: PANEL_IDS, spanPanelIds: SPAN_PANEL_IDS });

        // Check 2: mounts present and non-zero
        for (const id of PANEL_IDS) {
          const m = result.mounts[id];
          if (!m || m.error || m.width <= 0 || m.height <= 0) {
            failures.push(`[2 mounts] ${mode}/${vp.label} #${id}: missing or zero (${JSON.stringify(m)})`);
          }
        }

        // Check 4: no horizontal overflow
        if (result.scrollWidth > result.innerWidth + 1) {
          failures.push(`[4 overflow] ${mode}/${vp.label}: scrollWidth ${result.scrollWidth} > innerWidth ${result.innerWidth}`);
        }

        // Check 3: no overlaps
        for (const pair of result.overlaps) {
          failures.push(`[3 overlap] ${mode}/${vp.label}: ${pair}`);
        }

        // Check 5: registry (once per mode is enough)
        if (vp.label === 'desktop' && !result.integrityOk) {
          failures.push(`[5 registry] ${mode}: assertViewRegistryIntegrity failed`);
        }

        // Check 6: previously full-width panels stay full-width at desktop
        if (vp.label === 'desktop' && mode === 'player') {
          const contentWidth = Math.min(1660, result.innerWidth);
          for (const id of SPAN_PANEL_IDS) {
            const w = result.spanCardWidths[id] ?? 0;
            if (w < contentWidth * 0.95) {
              failures.push(`[6 full-width] #${id} card width ${w} < 95% of content ${contentWidth}`);
            }
          }
        }

        if (!result.hasGrid) {
          failures.push(`[grid] ${mode}/${vp.label}: TwoColumnGrid missing`);
        }

        await page.close();
      }
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('[2] Registered mounts present, non-zero:', failures.filter((f) => f.startsWith('[2')).length === 0 ? 'PASS' : 'FAIL');
  console.log('[3] No panel overlaps:', failures.filter((f) => f.startsWith('[3')).length === 0 ? 'PASS' : 'FAIL');
  console.log('[4] No horizontal overflow:', failures.filter((f) => f.startsWith('[4')).length === 0 ? 'PASS' : 'FAIL');
  console.log('[5] assertViewRegistryIntegrity:', failures.filter((f) => f.startsWith('[5')).length === 0 ? 'PASS' : 'FAIL');
  console.log('[6] Span panels full-width at desktop:', failures.filter((f) => f.startsWith('[6')).length === 0 ? 'PASS' : 'FAIL');

  if (failures.length) {
    console.error('\nFailures:');
    for (const f of failures) console.error(f);
    process.exit(1);
  }
  console.log('\nAll six EXPANSION grid2 checks passed.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
