/**
 * tests/reactPrimitivesTruncation.test.js
 *
 * Purpose: TruncationNote treats absent omitted count as unknown, not zero.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withPrimitivesHarnessPage } = require('./fixtures/reactPrimitivesBrowser.js');

test('TruncationNote unknown omitted count does not claim showing all', async () => {
  await withPrimitivesHarnessPage('truncation', async (page) => {
    const notes = await page.evaluate(() => {
      const read = (id) => {
        const el = document.querySelector(`[data-testid="${id}"]`);
        return {
          text: (el.textContent || '').trim(),
          state: el.getAttribute('data-truncation-state'),
        };
      };
      return {
        known: read('trunc-known'),
        unknown: read('trunc-unknown'),
        complete: read('trunc-complete'),
      };
    });

    assert.equal(notes.known.state, 'truncated');
    assert.match(notes.known.text, /omitted/);

    assert.equal(notes.unknown.state, 'unknown');
    assert.match(notes.unknown.text, /not read/i);
    assert.ok(!/showing all/i.test(notes.unknown.text));

    assert.equal(notes.complete.state, 'complete');
    assert.match(notes.complete.text, /All entries shown/i);
  });
});
