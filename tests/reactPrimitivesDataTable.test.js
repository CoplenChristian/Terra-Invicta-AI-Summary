/**
 * tests/reactPrimitivesDataTable.test.js
 *
 * Purpose: DataTable scroll hint driven by scrollWidth vs clientWidth, not viewport.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { withPrimitivesHarnessPage } = require('./fixtures/reactPrimitivesBrowser.js');

test('DataTable variant map covers all six table systems', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../src/v2/components/tableVariants.js'),
    'utf8'
  );
  const variants = ['de', 'mc-board', 'fe', 'mining', 'intel-library', 'commentary-sim'];
  for (const v of variants) {
    assert.match(src, new RegExp(`['"]?${v}['"]?:`), `variant ${v} must be defined`);
  }
  assert.match(src, /commentary-sim-table/);
  assert.match(src, /mc-board-table--ledger/);
  assert.match(src, /mining-table--upgrades/);
});

test('DataTable toggles is-scrollable when wrapper overflows', async () => {
  await withPrimitivesHarnessPage('dataTableOverflow', async (page) => {
    const metrics = await page.evaluate(() => {
      const wrap = document.querySelector('.de-table-wrap');
      const hint = document.querySelector('[data-testid="data-table-scroll-hint"]');
      return {
        clientWidth: wrap.clientWidth,
        scrollWidth: wrap.scrollWidth,
        overflows: wrap.scrollWidth > wrap.clientWidth + 1,
        hintShown: hint.classList.contains('is-scrollable'),
      };
    });

    assert.ok(metrics.overflows, 'narrow host must force table overflow');
    assert.equal(metrics.hintShown, true, 'hint must show when scrollWidth > clientWidth');
  });
});

test('DataTable hides is-scrollable when wrapper fits', async () => {
  await withPrimitivesHarnessPage('dataTableFits', async (page) => {
    const metrics = await page.evaluate(() => {
      const wrap = document.querySelector('.de-table-wrap');
      const hint = document.querySelector('[data-testid="data-table-scroll-hint"]');
      return {
        overflows: wrap.scrollWidth > wrap.clientWidth + 1,
        hintShown: hint.classList.contains('is-scrollable'),
      };
    });

    assert.equal(metrics.overflows, false);
    assert.equal(metrics.hintShown, false, 'hint must not show when table fits');
  });
});
