/**
 * tests/reactPrimitivesPanel.test.js
 *
 * Purpose: Panel primitive — all six modifiers rendered on real elements and
 * four non-zero border widths. The modifier check is runtime, not a source
 * regex: the `MODIFIER_CLASS[key] || `tech-card--${key}`` fallback means the
 * literal string can survive in source while the map stops driving the DOM.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withPrimitivesHarnessPage } = require('./fixtures/reactPrimitivesBrowser.js');

const PANEL_MODIFIERS = ['priority', 'alert', 'featured', 'quiet', 'dense', 'commentary'];

test('Panel renders the tech-card--* class for each of the six modifiers', async () => {
  await withPrimitivesHarnessPage('panelModifiers', async (page) => {
    const classLists = await page.evaluate((modifiers) => {
      const out = {};
      for (const mod of modifiers) {
        const el = document.querySelector(`[data-testid="harness-panel-${mod}"]`);
        out[mod] = el ? (el.className || '').split(/\s+/).filter(Boolean) : null;
      }
      return out;
    }, PANEL_MODIFIERS);

    for (const mod of PANEL_MODIFIERS) {
      assert.ok(classLists[mod], `panel element for modifier ${mod} must mount`);
      assert.ok(
        classLists[mod].includes(`tech-card--${mod}`),
        `modifier ${mod} must render tech-card--${mod}; got classList ${JSON.stringify(classLists[mod])}`
      );
    }
  });
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
