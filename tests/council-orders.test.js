// tests/council-orders.test.js
//
// Purpose: thin browser test suite for the Council Orders React panel. The
//   14 tests in tests/councilOrders.test.js drive the React panel through the
//   same browser harness and cover every text-rendering branch. This companion
//   file pins the scene mount, the cross-component click into #directiveBoard,
//   and the absent-data contract.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const {
  withCouncilOrdersHarnessPage,
  getHarnessHtml,
  getHarnessText,
  clickOrderRow,
  getDirectiveBoardCardClass,
  visibleText,
} = require('./fixtures/councilOrdersBrowser');

const FORBIDDEN = ['null', 'undefined', 'NaN', '[object Object]'];

function assertNoPlaceholderText(html, label) {
  const text = visibleText(html);
  for (const token of FORBIDDEN) {
    const index = text.indexOf(token);
    assert.strictEqual(
      index,
      -1,
      `${label}: rendered text contains "${token}" near: ${text.slice(Math.max(0, index - 60), index + 60)}`,
    );
  }
}

const BASE_COUNCILOR = { id: 1, name: 'Jane Doe', profession: 'Investigator', location: 'Paris' };

function cyclePlan(overrides = {}) {
  return {
    engineDirectives: {
      cyclePlan: {
        assignments: [],
        unassigned: [],
        unavailable: [],
        ...overrides,
      },
    },
  };
}

test('council-orders React panel mounts, renders the headline, and surfaces the assignment row DOM contract', async () => {
  const payload = cyclePlan({
    assignments: [{
      councilor: BASE_COUNCILOR,
      candidate: { friendlyName: 'Advise', family: 'council', target: { kind: 'nation', nation: 'United States of North America' } },
      odds: { automatic: true, basis: 'Mission is uncontested — it cannot fail.' },
      expectedHate: 0,
      riskFloor: null,
    }],
  });

  await withCouncilOrdersHarnessPage(payload, async (page) => {
    const html = await getHarnessHtml(page);
    const text = await getHarnessText(page);

    assert.ok(text.includes('1 COUNCILOR ACCOUNTED FOR'), 'singular head count must use COUNCILOR not COUNCILORS');
    assert.ok(text.includes('1 on mission · 0 idle · 0 without a slot'), 'the tally must reflect one on mission');
    assert.ok(text.includes('Jane Doe Investigator · Paris'), 'councilor name + profession + location must render');
    assert.ok(text.includes('Advise COUNCIL'), 'mission name and family label must render');
    assert.ok(text.includes('United States of North America'), 'nation target must render');
    assert.ok(text.includes('GUARANTEED'), 'automatic odds must read GUARANTEED, not 100%');
    assert.ok(html.includes('data-council-order-index="0"'), 'each order row must carry its index for the deep link');
    assert.ok(html.includes('data-council-orders-open-board'), 'the footnote must carry the open-board control');

    assertNoPlaceholderText(html, 'council-orders normal render');
  });
});

test('council-orders renders ODDS UNAVAILABLE and unknown hate when inputs are null, never coerced to 0', async () => {
  const payload = cyclePlan({
    assignments: [{
      councilor: BASE_COUNCILOR,
      candidate: { friendlyName: 'Advise', family: 'council', target: { kind: 'nation', nation: 'United States' } },
      odds: null,
      expectedHate: null,
      riskFloor: null,
    }],
  });

  await withCouncilOrdersHarnessPage(payload, async (page) => {
    const html = await getHarnessHtml(page);
    const text = await getHarnessText(page);

    assert.ok(text.includes('ODDS UNAVAILABLE'), 'null odds must render ODDS UNAVAILABLE, never a number');
    assert.ok(text.includes('unknown'), 'null expectedHate must render unknown, never 0 hate');
    assert.ok(!text.includes('0 hate'), 'a null hate must not be coerced to 0 hate');
    assert.ok(!text.includes('100%'), 'null odds must never render 100%');
  });
});

test('council-orders renders a 100-point roll as >99%, never 100%', async () => {
  const payload = cyclePlan({
    assignments: [{
      councilor: BASE_COUNCILOR,
      candidate: { friendlyName: 'Purge', family: 'expansion', target: { kind: 'none' } },
      odds: { point: 100, band: null, basis: null },
      expectedHate: null,
      riskFloor: null,
    }],
  });

  await withCouncilOrdersHarnessPage(payload, async (page) => {
    const text = await getHarnessText(page);

    assert.ok(text.includes('>99%'), 'a 100 point must render >99% (a 100 is the top of a roll, not a guarantee)');
    assert.ok(!text.includes('100%'), 'the panel must never claim a literal 100%');
  });
});

test('council-orders renders FLOOR UNVERIFIED and MARGINAL tags for the two risk-floor states', async () => {
  const payload = cyclePlan({
    assignments: [
      {
        councilor: BASE_COUNCILOR,
        candidate: { friendlyName: 'Advise', family: 'council', target: { kind: 'nation', nation: 'Mexico' } },
        odds: { point: 93, band: null },
        expectedHate: 2,
        riskFloor: { outcome: 'unknown', reason: 'floor could not be checked' },
      },
      {
        councilor: { ...BASE_COUNCILOR, id: 2, name: 'Bob' },
        candidate: { friendlyName: 'Advise', family: 'council', target: { kind: 'nation', nation: 'Mexico' } },
        odds: { point: 93, band: null },
        expectedHate: 2,
        riskFloor: { outcome: 'pass', marginal: true, reason: 'marginal pass' },
      },
    ],
  });

  await withCouncilOrdersHarnessPage(payload, async (page) => {
    const html = await getHarnessHtml(page);
    const text = await getHarnessText(page);

    assert.ok(text.includes('FLOOR UNVERIFIED'), 'an unchecked risk floor must render FLOOR UNVERIFIED');
    assert.ok(text.includes('MARGINAL'), 'a marginal risk-floor pass must render MARGINAL');
    assert.ok(html.includes('council-orders__tag--unknown'), 'FLOOR UNVERIFIED tag class must be present');
    assert.ok(html.includes('council-orders__tag--marginal'), 'MARGINAL tag class must be present');
  });
});

test('council-orders clicking an assignment row resolves the directiveBoard selector and adds the focused class', async () => {
  const payload = cyclePlan({
    assignments: [{
      councilor: BASE_COUNCILOR,
      candidate: { friendlyName: 'Advise', family: 'council', target: { kind: 'nation', nation: 'United States' } },
      odds: null,
      expectedHate: null,
      riskFloor: null,
    }],
  });

  await withCouncilOrdersHarnessPage(payload, async (page) => {
    await clickOrderRow(page, 0);
    // The click handler uses requestAnimationFrame to defer the DOM read, so
    // give it a tick to apply the focused class before asserting.
    await page.waitForTimeout(50);

    const className = await getDirectiveBoardCardClass(page, 0);
    assert.ok(className, 'the directive-board card at index 0 must exist after the cross-nav click');
    assert.ok(
      className.includes('directive-assignment-card--focused'),
      `clicking the order row must add directive-assignment-card--focused to the matching card; got: ${className}`,
    );
  });
});

test('council-orders renders the cycle-plan unavailable message for absent payloads', async () => {
  for (const [label, payload] of [
    ['empty object', {}],
    ['engineDirectives present but empty', { engineDirectives: {} }],
    ['null payload', null],
    ['undefined payload', undefined],
  ]) {
    await withCouncilOrdersHarnessPage(payload, async (page) => {
      const text = await getHarnessText(page);
      assert.ok(
        text.includes('Cycle plan unavailable for this snapshot'),
        `${label}: a missing cyclePlan must render the unavailable message`,
      );
    });
  }
});
