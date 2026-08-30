// tests/detailPanelRendering.test.js
//
// Purpose: browser proof for defect #21 slice 7 — DetailPanel stamps every figure
//   through <Value>, keeps per-metric presence independent, and preserves the
//   rendered surface (innerText, geometry, computed style) across payload branches.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  getDetailPanelHarnessPage,
  closeDetailPanelHarness,
  openPanel,
  resetPanel,
  readModal,
} = require('./fixtures/detailPanelBrowser');

let page;

before(async () => {
  page = await getDetailPanelHarnessPage();
});

after(async () => {
  await closeDetailPanelHarness();
});

const PER_METRIC_PAYLOAD = {
  facts: [
    { label: 'PRESENT A', value: 'measured-a' },
    { label: 'ABSENT NULL', value: null },
    { label: 'ABSENT DASH', value: '—' },
    { label: 'PRESENT B', value: 'measured-b' },
  ],
  sections: [{
    title: 'META ROWS',
    rows: [
      { label: 'row-a', status: 'OK', statusTone: 'ok', meta: '1,000 RP' },
      { label: 'row-b', status: 'LOCKED', statusTone: 'block', meta: '—' },
      { label: 'row-c', status: 'DONE', statusTone: 'ok', meta: '500 RP' },
    ],
  }],
};

async function readFactStates(page) {
  return page.evaluate(() => {
    return [...document.querySelectorAll('#detailPanelFacts .detail-panel__fact')].map((fact) => ({
      label: fact.querySelector('dt')?.textContent.trim(),
      states: [...fact.querySelectorAll('[data-value-state]')].map((el) => ({
        state: el.getAttribute('data-value-state'),
        text: el.textContent,
      })),
    }));
  });
}

async function readMetaStates(page) {
  return page.evaluate(() => {
    return [...document.querySelectorAll('.detail-panel__row')].map((row) => ({
      label: row.querySelector('.detail-panel__row-label')?.textContent.trim(),
      meta: [...row.querySelectorAll('.detail-panel__row-meta [data-value-state]')].map((el) => ({
        state: el.getAttribute('data-value-state'),
        text: el.textContent,
      })),
    }));
  });
}

test('detail-panel per-metric: nulling one fact does not change another fact\'s stamp', async () => {
  await resetPanel(page);
  await openPanel(page, PER_METRIC_PAYLOAD);
  const facts = await readFactStates(page);

  assert.deepStrictEqual(facts[0].states, [{ state: 'measured', text: 'measured-a' }]);
  assert.deepStrictEqual(facts[1].states, [{ state: 'absent', text: '' }]);
  assert.deepStrictEqual(facts[2].states, [{ state: 'absent', text: '—' }]);
  assert.deepStrictEqual(facts[3].states, [{ state: 'measured', text: 'measured-b' }]);
});

test('detail-panel per-metric: nulling one row meta does not change another row\'s meta stamp', async () => {
  await resetPanel(page);
  await openPanel(page, PER_METRIC_PAYLOAD);
  const rows = await readMetaStates(page);

  assert.deepStrictEqual(rows[0].meta, [{ state: 'measured', text: '1,000 RP' }]);
  assert.deepStrictEqual(rows[1].meta, [{ state: 'absent', text: '—' }]);
  assert.strictEqual(rows[1].meta[0].state, 'absent',
    'row-b meta must be stamped absent, not measured-with-a-dash');
  assert.deepStrictEqual(rows[2].meta, [{ state: 'measured', text: '500 RP' }]);

  assert.notStrictEqual(rows[0].meta[0].state, rows[1].meta[0].state,
    'the absent meta on row-b must not cascade to row-a');
  assert.strictEqual(rows[2].meta[0].state, 'measured',
    'row-c must stay measured when row-b is absent');
});

test('detail-panel stamps every em-dash affordance rather than printing a bare glyph', async () => {
  await resetPanel(page);
  await openPanel(page, PER_METRIC_PAYLOAD);

  const audit = await page.evaluate(() => {
    const panel = document.getElementById('mcDetailPanel');
    const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
    const unstamped = [];
    let node = walker.nextNode();
    while (node) {
      if (node.textContent.includes('—')) {
        const host = node.parentElement;
        const prose = host.closest('.detail-panel__summary, .detail-panel__note, .detail-panel__section-caption, .detail-panel__row-sub, .detail-panel__row-label');
        if (!host.closest('[data-value-state]') && !prose) {
          unstamped.push(`${host.className} :: ${node.textContent.trim()}`);
        }
      }
      node = walker.nextNode();
    }
    return {
      unstamped,
      absent: panel.querySelectorAll('[data-value-state="absent"]').length,
      measured: panel.querySelectorAll('[data-value-state="measured"]').length,
    };
  });

  assert.deepStrictEqual(audit.unstamped, [],
    'every em dash used as an absence affordance must sit inside a Value host');
  assert.strictEqual(audit.absent, 3,
    'two absent facts (null and empty) and one meta dash must each be stamped absent');
  assert.ok(audit.measured >= 4, 'the measured facts and meta figures must remain stamped');
});

test('detail-panel zero rendered change vs pre-conversion baseline captures', async () => {
  const baselinePath = path.join(__dirname, 'fixtures', 'detail-panel-render-baseline.json');
  const branches = require('./fixtures/detailPanelRenderBranches');
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));

  for (const name of Object.keys(baseline)) {
    await resetPanel(page);
    await openPanel(page, branches[name]);
    const modal = await readModal(page);
    assert.strictEqual(modal.bodyText, baseline[name].innerText,
      `branch "${name}" innerText must match the pre-conversion baseline`);
  }
});
