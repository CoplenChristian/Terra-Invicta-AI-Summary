/**
 * tests/reactThemeParity.test.js
 *
 * Purpose: parity-lock src/v2/theme.js to the live :root custom properties by
 * comparing theme values against getComputedStyle(document.documentElement) —
 * not by parsing the CSS file (see tests/fixtures/missionControlCss.js).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const TEST_PORT = Number(process.env.REACT_THEME_PARITY_PORT || 3997);
const SHELL_PATH = '/v2/index.html';

// Sixteen pure var() aliases (--bg-deep, --init-cyan, …) are intentionally omitted.

function normalizeCSSValue(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';

  const rgbaMatch = trimmed.match(
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i
  );
  if (rgbaMatch) {
    const [, r, g, b, a] = rgbaMatch;
    if (a !== undefined) {
      return `rgba(${r}, ${g}, ${b}, ${a})`;
    }
    return `rgb(${r}, ${g}, ${b})`;
  }

  if (/^#[0-9a-f]{3,8}$/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  return trimmed
    .toLowerCase()
    .replace(/"/g, "'")
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ');
}

function normalizeFontStack(value) {
  return normalizeCSSValue(value)
    .split(',')
    .map(part => part.trim().replace(/^['"]|['"]$/g, '').toLowerCase())
    .join(', ');
}

function valuesMatch(cssVar, expected, actual) {
  if (cssVar === '--display' || cssVar === '--sans' || cssVar === '--mono') {
    return normalizeFontStack(expected) === normalizeFontStack(actual);
  }
  return normalizeCSSValue(expected) === normalizeCSSValue(actual);
}

async function loadThemeModule() {
  const themePath = path.resolve(__dirname, '../src/v2/theme.js');
  return import(pathToFileURL(themePath).href);
}

test('initiative theme values match computed :root custom properties', async () => {
  const { cssParityExpectations, initiativeSpace } = await loadThemeModule();

  assert.equal(
    Object.keys(cssParityExpectations).length,
    47,
    'parity map must cover exactly 47 independent token values'
  );

  const app = require('../server/index.js');
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://localhost:${port}${SHELL_PATH}#/command`, {
      waitUntil: 'domcontentloaded',
    });

    const cssVarNames = Object.keys(cssParityExpectations);
    const computed = await page.evaluate((varNames) => {
      const rootStyle = getComputedStyle(document.documentElement);
      const out = {};
      for (const name of varNames) {
        out[name] = rootStyle.getPropertyValue(name).trim();
      }
      return out;
    }, cssVarNames);

    const mismatches = [];
    for (const [cssVar, expected] of Object.entries(cssParityExpectations)) {
      const actual = computed[cssVar];
      assert.ok(actual && actual.length > 0, `${cssVar} must resolve to a non-empty computed value`);
      assert.notStrictEqual(actual, cssVar, `${cssVar} must not be self-referential`);
      if (!valuesMatch(cssVar, expected, actual)) {
        mismatches.push({ cssVar, expected, actual });
      }
    }

    assert.deepEqual(
      mismatches,
      [],
      mismatches.map(m => `${m.cssVar}: theme=${m.expected} computed=${m.actual}`).join('\n')
    );

  // Spacing parity via named initiative.space entries (all nine steps).
    const spacePairs = [
      ['2xs', '--space-2xs'],
      ['xs', '--space-xs'],
      ['sm', '--space-sm'],
      ['md', '--space-md'],
      ['lg', '--space-lg'],
      ['xl', '--space-xl'],
      ['2xl', '--space-2xl'],
      ['3xl', '--space-3xl'],
      ['4xl', '--space-4xl'],
    ];
    for (const [key, cssVar] of spacePairs) {
      assert.equal(
        initiativeSpace[key],
        cssParityExpectations[cssVar],
        `initiative.space.${key} must mirror ${cssVar}`
      );
      assert.equal(
        normalizeCSSValue(initiativeSpace[key]),
        normalizeCSSValue(computed[cssVar]),
        `initiative.space.${key} must equal computed ${cssVar}`
      );
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
