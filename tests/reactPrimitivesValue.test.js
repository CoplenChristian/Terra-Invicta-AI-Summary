/**
 * tests/reactPrimitivesValue.test.js
 *
 * Purpose: Value distinguishes measured zero from absent and unavailable states.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withPrimitivesHarnessPage } = require('./fixtures/reactPrimitivesBrowser.js');

test('Value renders measured zero, absent, and unavailable differently', async () => {
  await withPrimitivesHarnessPage('value', async (page) => {
    const states = await page.evaluate(() => {
      const read = (id) => {
        const el = document.querySelector(`[data-testid="${id}"]`);
        return {
          text: (el.textContent || '').trim(),
          state: el.getAttribute('data-value-state'),
        };
      };
      return {
        zero: read('value-zero'),
        absent: read('value-absent'),
        unavailable: read('value-unavailable'),
      };
    });

    assert.equal(states.zero.state, 'measured');
    assert.equal(states.zero.text, '0');
    assert.equal(states.absent.state, 'absent');
    assert.equal(states.absent.text, '—');
    assert.equal(states.unavailable.state, 'unavailable');
    assert.equal(states.unavailable.text, 'UNAVAILABLE');
    assert.notEqual(states.zero.text, states.absent.text);
  });
});
