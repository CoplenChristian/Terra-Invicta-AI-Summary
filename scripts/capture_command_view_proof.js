/**
 * scripts/capture_command_view_proof.js
 *
 * Purpose: capture COMMAND view rendered text and panel-mount geometry for
 *   before/after refactor proof. Adapted from capture_threat_view_proof.js.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { ensureBundleBuilt } = require('../tests/fixtures/ensureBundle.js');

process.env.NODE_ENV = 'test';

const SHELL_PATH = '/v2/index.html';
const PANEL_IDS = [
  'strategicCommentary',
  'councilOrders',
  'researchAdvisor',
  'priorityBriefCard',
  'opLeaderboardList',
  'directiveBoard',
  'sitrepSummary',
  'directivesStreamList',
  'btnCopySitrep',
];
const MODES = ['player', 'omniscient'];
const VIEWPORTS = [
  { width: 375, height: 812, label: '375' },
  { width: 414, height: 896, label: '414' },
  { width: 768, height: 1024, label: '768' },
  { width: 1660, height: 900, label: 'desktop' },
];

async function runCapture() {
  ensureBundleBuilt();
  const app = require('../server/index.js');
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = server.address().port;

  const browser = await chromium.launch({ headless: true });
  const result = { capturedAt: new Date().toISOString(), modes: {} };

  try {
    for (const mode of MODES) {
      result.modes[mode] = { viewports: {} };
      for (const vp of VIEWPORTS) {
        const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
        await page.goto(`http://127.0.0.1:${port}${SHELL_PATH}#/command`, {
          waitUntil: 'networkidle',
        });
        await page.evaluate((targetMode) => {
          const btn = document.querySelector(`.init-mode-btn[data-mode="${targetMode}"]`);
          if (btn) btn.click();
        }, mode);
        await page.waitForTimeout(1200);
        await page.evaluate(() => {
          const btn = document.querySelector('.init-nav-btn[data-view="command"]');
          if (btn) btn.click();
        });
        await page.waitForTimeout(2500);
        result.modes[mode].viewports[vp.label] = await page.evaluate((panelIds) => {
          const section = document.getElementById('view-command');
          if (!section) return { error: 'view-command missing' };

          const mounts = {};
          for (const id of panelIds) {
            const el = document.getElementById(id);
            if (!el) {
              mounts[id] = { error: 'mount missing' };
              continue;
            }
            const card = el.closest('.tech-card') || el.closest('[data-primitive="panel"]');
            const style = window.getComputedStyle(el);
            const cardStyle = card ? window.getComputedStyle(card) : null;
            const rect = el.getBoundingClientRect();
            const cardRect = card ? card.getBoundingClientRect() : null;
            mounts[id] = {
              rect: {
                x: Math.round(rect.x * 10) / 10,
                y: Math.round(rect.y * 10) / 10,
                width: Math.round(rect.width * 10) / 10,
                height: Math.round(rect.height * 10) / 10,
              },
              cardRect: cardRect ? {
                x: Math.round(cardRect.x * 10) / 10,
                y: Math.round(cardRect.y * 10) / 10,
                width: Math.round(cardRect.width * 10) / 10,
                height: Math.round(cardRect.height * 10) / 10,
              } : null,
              display: style.display,
              gridColumn: style.gridColumn,
              border: [
                style.borderTopWidth, style.borderTopStyle, style.borderTopColor,
                style.borderRightWidth, style.borderRightStyle, style.borderRightColor,
                style.borderBottomWidth, style.borderBottomStyle, style.borderBottomColor,
                style.borderLeftWidth, style.borderLeftStyle, style.borderLeftColor,
              ].join(' | '),
              background: style.backgroundColor,
              cardBorder: cardStyle ? [
                cardStyle.borderTopWidth, cardStyle.borderTopStyle, cardStyle.borderTopColor,
              ].join(' ') : null,
              cardBackground: cardStyle ? cardStyle.backgroundColor : null,
              cardGridColumn: cardStyle ? cardStyle.gridColumn : null,
            };
          }

          return {
            text: (section.innerText || '').replace(/\s+/g, ' ').trim(),
            mounts,
            scrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
          };
        }, PANEL_IDS);
        await page.close();
      }
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  return result;
}

if (require.main === module) {
  const outArg = process.argv.indexOf('--out');
  const outPath = outArg >= 0 ? process.argv[outArg + 1] : null;
  runCapture()
    .then((result) => {
      const json = JSON.stringify(result, null, 2);
      if (outPath) {
        fs.writeFileSync(path.resolve(outPath), json, 'utf8');
        console.log(`Wrote ${outPath}`);
      } else {
        console.log(json);
      }
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { runCapture, PANEL_IDS, VIEWPORTS, MODES };
