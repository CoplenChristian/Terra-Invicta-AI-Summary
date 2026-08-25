/**
 * tests/reactCascadeOrder.test.js
 *
 * Purpose: measure which styling system wins at equal specificity when global
 * CSS and Emotion both target one class — recorded in docs/react-primitives-brief.md.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withPrimitivesHarnessPage } = require('./fixtures/reactPrimitivesBrowser.js');

const GLOBAL_RGB = 'rgb(1, 2, 3)';
const EMOTION_RGB = 'rgb(40, 50, 60)';

test('cascade probe: records whether Emotion or global CSS wins at equal specificity', async () => {
  await withPrimitivesHarnessPage('cascade', async (page) => {
    const result = await page.evaluate(() => {
      const globalEl = document.querySelector('[data-testid="cascade-global"]');
      const emotionEl = document.querySelector('[data-testid="cascade-emotion"]');
      const read = (el) => {
        const s = getComputedStyle(el);
        return {
          color: s.color,
          fontWeight: s.fontWeight,
        };
      };
      return {
        global: read(globalEl),
        emotion: read(emotionEl),
      };
    });

    assert.ok(result.global.color, 'global probe must resolve a color');
    assert.ok(result.emotion.color, 'emotion probe must resolve a color');

    const emotionWins = result.emotion.color === EMOTION_RGB;
    const globalWins = result.emotion.color === GLOBAL_RGB;

    assert.ok(emotionWins || globalWins, `unexpected emotion probe color: ${result.emotion.color}`);

    // Pin the measured winner so a cascade flip fails CI.
    assert.equal(
      result.emotion.color,
      EMOTION_RGB,
      'Emotion must win at equal specificity (.cascade-order-probe) — primitives may use sx/styled freely'
    );
    assert.equal(result.global.color, GLOBAL_RGB, 'global probe keeps linked-sheet color');
  });
});
