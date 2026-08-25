/**
 * tests/reactCascadeOrder.test.js
 *
 * Purpose: measure which styling system wins — recorded in
 * docs/react-primitives-brief.md. Corrected from the original claim: the base
 * probe is a single global class (0,1,0) against Emotion's `.css-*.cascade-*`
 * at (0,2,0), so Emotion wins on specificity, NOT at equal specificity.
 * Also pins the two cases that genuinely threaten the cascade: a global rule
 * marked `!important`, and a global rule duplicated in a stylesheet injected
 * after Emotion's own <style> tags.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withPrimitivesHarnessPage } = require('./fixtures/reactPrimitivesBrowser.js');

// .cascade-order-probe — global, single class (0,1,0).
const GLOBAL_RGB = 'rgb(1, 2, 3)';
// Emotion .css-*.cascade-order-probe — two classes (0,2,0).
const EMOTION_RGB = 'rgb(40, 50, 60)';
// .cascade-order-important — global, (0,1,0), but !important.
const IMPORTANT_GLOBAL_RGB = 'rgb(5, 10, 15)';
// Emotion .css-*.cascade-order-important — (0,2,0), normal declaration.
const EMOTION_IMPORTANT_RGB = 'rgb(60, 70, 80)';
// .cascade-order-late — global base declaration (0,1,0).
const LATE_BASE_RGB = 'rgb(11, 12, 13)';
// Late duplicate .cascade-order-late.cascade-order-late — (0,2,0), injected after Emotion.
const LATE_RGB = 'rgb(21, 22, 23)';
// Emotion .css-*.cascade-order-late — (0,2,0), normal declaration.
const EMOTION_LATE_RGB = 'rgb(70, 80, 90)';

test('cascade probe: Emotion wins at higher specificity; global wins on !important and on a later duplicate at matching specificity', async () => {
  await withPrimitivesHarnessPage('cascade', async (page) => {
    await page.waitForSelector('html[data-cascade-late-applied="1"]');
    const result = await page.evaluate(() => {
      const read = (testId) => {
        const el = document.querySelector(`[data-testid="${testId}"]`);
        const s = getComputedStyle(el);
        return { color: s.color, fontWeight: s.fontWeight };
      };
      return {
        global: read('cascade-global'),
        emotion: read('cascade-emotion'),
        importantGlobal: read('cascade-important-global'),
        importantEmotion: read('cascade-important-emotion'),
        lateGlobal: read('cascade-late-global'),
        lateEmotion: read('cascade-late-emotion'),
      };
    });

    // Base probe: Emotion's selector is .css-*.cascade-order-probe (0,2,0) vs
    // global .cascade-order-probe (0,1,0) — a specificity win, not equal.
    assert.equal(
      result.emotion.color,
      EMOTION_RGB,
      'Emotion wins at higher specificity (0,2,0 beats 0,1,0) — NOT at equal specificity'
    );
    assert.equal(result.global.color, GLOBAL_RGB, 'global probe keeps its linked-sheet color');

    // A global !important declaration beats Emotion's normal rule regardless of
    // specificity — the lever that rescues a global rule from Emotion.
    assert.equal(result.importantGlobal.color, IMPORTANT_GLOBAL_RGB, 'global !important probe resolves to its own color');
    assert.equal(
      result.importantEmotion.color,
      IMPORTANT_GLOBAL_RGB,
      'global !important must beat Emotion at (0,2,0); got '
        + `${result.importantEmotion.color} (expected ${IMPORTANT_GLOBAL_RGB}, not ${EMOTION_IMPORTANT_RGB})`
    );

    // A global rule duplicated in a later stylesheet, injected after Emotion's
    // <style> tags, at matching (0,2,0) specificity, wins by source order.
    assert.equal(
      result.lateGlobal.color,
      LATE_RGB,
      `later (0,2,0) duplicate must beat the earlier (0,1,0) base (${LATE_BASE_RGB})`
    );
    assert.equal(
      result.lateEmotion.color,
      LATE_RGB,
      `later global duplicate at (0,2,0) must beat Emotion at equal specificity by source order; `
        + `got ${result.lateEmotion.color} (expected ${LATE_RGB}, not ${EMOTION_LATE_RGB})`
    );
  });
});
