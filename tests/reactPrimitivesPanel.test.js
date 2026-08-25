/**
 * tests/reactPrimitivesPanel.test.js
 *
 * Purpose: Panel primitive — all six modifiers and four non-zero border widths.
 */

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withPrimitivesHarnessPage } = require('./fixtures/reactPrimitivesBrowser.js');

test('Panel modifier map covers all six tech-card modifiers', () => {
  const panelSrc = fs.readFileSync(
    path.resolve(__dirname, '../src/v2/components/Panel.jsx'),
    'utf8'
  );
  const expected = ['priority', 'alert', 'featured', 'quiet', 'dense', 'commentary'];
  for (const mod of expected) {
    assert.match(panelSrc, new RegExp(`tech-card--${mod}`), `must map modifier ${mod}`);
  }
});

test('Panel renders four non-zero computed border widths', async () => {
  await withPrimitivesHarnessPage('panel', async (page) => {
    const borders = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="harness-panel"]');
      const s = getComputedStyle(el);
      return {
        top: parseFloat(s.borderTopWidth),
        right: parseFloat(s.borderRightWidth),
        bottom: parseFloat(s.borderBottomWidth),
        left: parseFloat(s.borderLeftWidth),
      };
    });

    for (const [edge, width] of Object.entries(borders)) {
      assert.ok(width > 0, `${edge} border width must be > 0, got ${width}`);
    }
  });
});
