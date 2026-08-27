/**
 * tests/reactPrimitivesDataTable.test.js
 *
 * Purpose: DataTable scroll hint driven by scrollWidth vs clientWidth, not viewport,
 * and the variant contract — commentary-sim is bare (no wrap, no hint) while the
 * variants that define one keep theirs.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { withPrimitivesHarnessPage } = require('./fixtures/reactPrimitivesBrowser.js');

const VARIANT_CONTRACT = {
  de: { wrap: 'de-table-wrap', hint: true },
  'mc-board': { wrap: 'mc-board-table-wrap', hint: true },
  fe: { wrap: 'fe-table-wrap', hint: true },
  mining: { wrap: 'mining-table-wrap', hint: false },
  'intel-library': { wrap: 'intel-library-table-wrap', hint: true },
  'hostile-movement': { wrap: 'hm-table-wrap', hint: true },
  'theater-defence': { wrap: 'td-table-wrap', hint: true },
  'commentary-sim': { wrap: null, hint: false },
};

test('DataTable variant map covers all eight table systems', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../src/v2/components/tableVariants.js'),
    'utf8'
  );
  const variants = ['de', 'mc-board', 'fe', 'mining', 'intel-library', 'hostile-movement', 'theater-defence', 'commentary-sim'];
  for (const v of variants) {
    assert.match(src, new RegExp(`['"]?${v}['"]?:`), `variant ${v} must be defined`);
  }
  assert.match(src, /commentary-sim-table/);
  assert.match(src, /mc-board-table--ledger/);
  assert.match(src, /mining-table--upgrades/);
});

test('DataTable commentary-sim is bare; the other variants keep their wrap and hint', async () => {
  await withPrimitivesHarnessPage('dataTableVariants', async (page) => {
    const report = await page.evaluate((contract) => {
      const out = {};
      for (const variant of Object.keys(contract)) {
        const host = document.querySelector(
          `[data-primitive="data-table"][data-variant="${variant}"]`
        );
        if (!host) {
          out[variant] = { mounted: false, wrap: false, hint: false };
          continue;
        }
        const wrap =
          host.matches('[class*="table-wrap"]') ||
          Boolean(host.querySelector('[class*="table-wrap"]'));
        const hint = Boolean(host.querySelector('[data-testid="data-table-scroll-hint"]'));
        out[variant] = { mounted: true, wrap, hint };
      }
      return out;
    }, VARIANT_CONTRACT);

    for (const [variant, expected] of Object.entries(VARIANT_CONTRACT)) {
      const actual = report[variant];
      assert.ok(actual && actual.mounted, `variant ${variant} must mount without throwing`);
      assert.equal(actual.hint, expected.hint, `variant ${variant} hint presence`);
      if (expected.wrap) {
        assert.ok(actual.wrap, `variant ${variant} must keep its wrap`);
      } else {
        assert.ok(!actual.wrap, `variant ${variant} must render no wrap element`);
      }
    }
  });
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
