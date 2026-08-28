/**
 * scripts/capture_command_screenshots.js
 *
 * Purpose: full-page COMMAND view screenshots for grid2 migration review.
 */

const { chromium } = require('playwright');
const path = require('path');
const { ensureBundleBuilt } = require('../tests/fixtures/ensureBundle.js');

process.env.NODE_ENV = 'test';

const OUT_DIR = 'F:/dotnet/temp/claude/F--Windsurf-Terra-Invicta-AI-Summary/6f3db097-2f06-446c-a354-21b810b528b5/scratchpad';

const SHOTS = [
  { width: 1660, height: 900, file: 'command-grid2-desktop.png' },
  { width: 768, height: 1024, file: 'command-grid2-768.png' },
  { width: 375, height: 812, file: 'command-grid2-375.png' },
];

async function run() {
  ensureBundleBuilt();
  const app = require('../server/index.js');
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });

  try {
    for (const shot of SHOTS) {
      const page = await browser.newPage({ viewport: { width: shot.width, height: shot.height } });
      await page.goto(`http://127.0.0.1:${port}/v2/index.html#/command`, { waitUntil: 'networkidle' });
      await page.evaluate(() => {
        document.querySelector('.init-mode-btn[data-mode="player"]')?.click();
      });
      await page.waitForTimeout(2500);
      const outPath = path.join(OUT_DIR, shot.file);
      await page.screenshot({ path: outPath, fullPage: true });
      console.log(outPath);
      await page.close();
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
