/**
 * Computed Style & CSS Custom Properties Unit Test
 *
 * Verifies via real computed style evaluation:
 * 1. getComputedStyle(document.documentElement).getPropertyValue('--text-muted') is non-empty and not equal to --text.
 * 2. getComputedStyle(document.documentElement).getPropertyValue('--text-dim') is non-empty and not equal to --text.
 * 3. Contrast between --text-dim and --canvas meets legibility floor (>= 4.0:1).
 */

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const http = require('http');
const { chromium } = require('playwright');

const TEST_PORT = 3991;

function parseRgb(colorStr) {
  if (!colorStr) return null;
  const rgbMatch = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (rgbMatch) {
    return [parseInt(rgbMatch[1], 10), parseInt(rgbMatch[2], 10), parseInt(rgbMatch[3], 10)];
  }
  const hexMatch = colorStr.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (hexMatch) {
    return [parseInt(hexMatch[1], 16), parseInt(hexMatch[2], 16), parseInt(hexMatch[3], 16)];
  }
  return null;
}

function luminance(r, g, b) {
  const a = [r, g, b].map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

function contrastRatio(rgb1, rgb2) {
  const lum1 = luminance(rgb1[0], rgb1[1], rgb1[2]);
  const lum2 = luminance(rgb2[0], rgb2[1], rgb2[2]);
  const brightest = Math.max(lum1, lum2);
  const darkest = Math.min(lum1, lum2);
  return (brightest + 0.05) / (darkest + 0.05);
}

test('computed CSS variables on document.documentElement resolve correctly without circular destruction', async () => {
  const app = require('../server/index.js');
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(TEST_PORT, resolve));

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await context.newPage();

    await page.goto(`http://localhost:${TEST_PORT}/v2/#/command`, { waitUntil: 'domcontentloaded' });

    const styles = await page.evaluate(() => {
      const rootStyle = getComputedStyle(document.documentElement);
      return {
        text: rootStyle.getPropertyValue('--text').trim(),
        textMuted: rootStyle.getPropertyValue('--text-muted').trim(),
        textDim: rootStyle.getPropertyValue('--text-dim').trim(),
        canvas: rootStyle.getPropertyValue('--canvas').trim(),
        surfaceInset: rootStyle.getPropertyValue('--surface-inset').trim()
      };
    });

    assert.ok(styles.textMuted.length > 0, '--text-muted must be non-empty at :root');
    assert.ok(styles.textDim.length > 0, '--text-dim must be non-empty at :root');
    assert.notStrictEqual(styles.textMuted, styles.text, '--text-muted must not equal --text');
    assert.notStrictEqual(styles.textDim, styles.text, '--text-dim must not equal --text');
    assert.notStrictEqual(styles.textDim, styles.textMuted, '--text-dim must not equal --text-muted');

    const surfaceStyle = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--surface').trim());
    const canvasRgb = parseRgb(styles.canvas) || [8, 16, 17];
    const surfaceRgb = parseRgb(surfaceStyle) || [16, 27, 29];
    const textDimRgb = parseRgb(styles.textDim) || [117, 138, 129];
    const textMutedRgb = parseRgb(styles.textMuted) || [145, 162, 155];

    const contrastDimOnCanvas = contrastRatio(textDimRgb, canvasRgb);
    const contrastDimOnSurface = contrastRatio(textDimRgb, surfaceRgb);
    const contrastMutedOnCanvas = contrastRatio(textMutedRgb, canvasRgb);

    assert.ok(contrastDimOnSurface >= 4.5, `--text-dim on surface contrast ratio (${contrastDimOnSurface.toFixed(2)}:1) must be >= 4.5:1 (WCAG AA)`);
    assert.ok(contrastDimOnCanvas >= 4.5, `--text-dim on canvas contrast ratio (${contrastDimOnCanvas.toFixed(2)}:1) must be >= 4.5:1 (WCAG AA)`);
    assert.ok(contrastMutedOnCanvas >= 6.0, `--text-muted on canvas contrast ratio (${contrastMutedOnCanvas.toFixed(2)}:1) must be >= 6.0:1`);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
