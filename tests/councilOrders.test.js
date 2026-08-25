// tests/councilOrders.test.js
//
// Purpose: characterisation tests for public/v2/js/components/council-orders.js.
//   Captures exactly what the council-orders panel renders RIGHT NOW so a later
//   React rewrite that silently drops a field fails loudly. These assertions are
//   a record of current output, not a review of it.
//
// WHAT council-orders.js EXPOSES:
//   window.MissionControlCouncilOrders = { render }
//   render(root, payload) where payload = { engineDirectives: { cyclePlan } }.
//   mission-control.js:1193 calls it as
//     render(document.getElementById('councilOrders'), { engineDirectives: state.briefing?.engineDirectives })
//   This IS a single entry point, unlike executive-boards.js. The payload is a
//   slice of the briefing, not the raw snapshot.
//
// CYCLE PLAN SHAPE READ: cyclePlan.assignments / cyclePlan.unassigned /
//   cyclePlan.unavailable together cover every own councilor; each assignment
//   carries `councilor`, `candidate`, `odds`, `expectedHate`, `riskFloor`. The
//   engine also emits *TotalCount / *OmittedCount truncation counts on cyclePlan
//   and on its sibling lists, but THIS panel renders none of them -- there is no
//   truncation surface to assert.
//
// ABSENT STAYS ABSENT (documented in the component header): odds.chance null and
//   expectedHate null render as "ODDS UNAVAILABLE" and "unknown", never coerced
//   to 0.
//
// HARNESS NOTE: like executiveBoards.test.js this file recovers mixed
//   text+children cells by walking the mockDom tree (boardText), because the
//   mockDom serializer drops a node's own text once it gains element children.
//   council-orders keeps every cell self-contained, but the walk keeps the two
//   files' semantics identical and is what correctly decodes the "&gt;99%" chip.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { runComponent, visibleText } = require('./fixtures/renderHarness');
const { loadFixtureFilteredSnapshot } = require('./fixtures/frozenSnapshots');
const { DOMNode } = require('./fixtures/mockDom');
const briefingGenerator = require('../server/briefingGenerator');

const repoRoot = path.resolve(__dirname, '..');
const componentPath = path.join(repoRoot, 'public', 'v2', 'js', 'components', 'council-orders.js');

const OBSERVER = 4712;

function loadOrders() {
  return runComponent(componentPath).window.MissionControlCouncilOrders;
}

function createRoot() {
  return new DOMNode('div');
}

/** See the executiveBoards.test.js header for why the tree is walked. */
function treeText(node) {
  if (!node) return '';
  let out = node._textContent || '';
  for (const child of node.children) {
    const childText = treeText(child);
    if (childText && out && !out.endsWith(' ')) out += ' ';
    out += childText;
  }
  return out;
}

function boardText(root) {
  return visibleText(treeText(root));
}

function renderTo(root, payload) {
  const orders = loadOrders();
  assert.doesNotThrow(() => orders.render(root, payload), 'render must not throw');
  return { text: boardText(root), html: root.innerHTML };
}

function cyclePlanPayload(cyclePlan) {
  return { engineDirectives: { cyclePlan } };
}

const BASE_COUNCILOR = { id: 1, name: 'Jane Doe', profession: 'Investigator', location: 'Paris' };

const FORBIDDEN = ['null', 'undefined', 'NaN', '[object Object]'];

function assertNoPlaceholderText(text, label) {
  for (const token of FORBIDDEN) {
    const index = text.indexOf(token);
    assert.strictEqual(
      index,
      -1,
      `${label}: rendered text contains "${token}" near: ${text.slice(Math.max(0, index - 60), index + 60)}`
    );
  }
}

// ---------------------------------------------------------------------------
// 1. NORMAL RENDER: PLAYER AND OMNISCIENT (a different answer, not a filtered one)
// ---------------------------------------------------------------------------

test('council orders normal render, player mode: three councilors, guaranteed orders, zero hate', () => {
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'player' });
  const briefing = briefingGenerator.generateMissionControlBriefing(snapshot, null, { mode: 'player', observer: OBSERVER });

  const root = createRoot();
  const { text, html } = renderTo(root, { engineDirectives: briefing.engineDirectives });

  assert.ok(text.includes('3 COUNCILORS ACCOUNTED FOR'), 'the account status must count 3');
  assert.ok(text.includes('3 on mission · 0 idle · 0 without a slot'), 'the tally must read 3/0/0');
  assert.ok(text.includes('Beth Hofmann Celebrity · Washington'), 'a councilor must render name with profession and location');
  assert.ok(text.includes('Advise ADVISORY'), 'the order must render the mission and its family label');
  assert.ok(text.includes('United States of North America'), 'the nation target must render');
  assert.ok(text.includes('GUARANTEED'), 'an uncontested mission must read GUARANTEED, not 100%');
  assert.ok(text.includes('0 hate'), 'a measured zero hate must render 0 hate');
  assert.ok(text.includes('Directive Engine'), 'the footnote must link back to the Directive Engine card');
  assert.ok(html.includes('data-council-order-index="0"'), 'each order row must carry its index for the deep link');
  assert.ok(html.includes('data-council-orders-open-board'), 'the footnote must carry the open-board control');

  assertNoPlaceholderText(text, 'council orders player normal');
});

test('council orders normal render, omniscient mode: a rolled order with odds band and measured hate', () => {
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'omniscient' });
  const briefing = briefingGenerator.generateMissionControlBriefing(snapshot, null, { mode: 'omniscient', observer: OBSERVER });

  const root = createRoot();
  const { text } = renderTo(root, { engineDirectives: briefing.engineDirectives });

  assert.ok(text.includes('5 COUNCILORS ACCOUNTED FOR'), 'the account status must count 5');
  assert.ok(text.includes('5 on mission · 0 idle · 0 without a slot'), 'the tally must read 5/0/0');
  assert.ok(text.includes('Hemaraj Pavanaja Spy · Washington'), 'the omniscient-only order must render');
  assert.ok(text.includes('Purge EXPANSION'), 'the purge order must render with the EXPANSION family label');
  assert.ok(text.includes('ExtractiveSector · China'), 'a control-point target must render as type · nation');
  assert.ok(text.includes('93% [89–96%]'), 'a contested roll must render the point and the band');
  assert.ok(text.includes('+4.74 hate'), 'the outcome-weighted hate must render to two decimals');
  assert.ok(text.includes('Defend Interests DEFENSE'), 'the defense order must render with the DEFENSE family label');
  assert.ok(text.includes('Aristocracy · Madagascar'), 'a second control-point target must render');

  assertNoPlaceholderText(text, 'council orders omniscient normal');
});

// ---------------------------------------------------------------------------
// 2. ODDS, HATE AND RISK-FLOOR STATES (each its own assertion)
// ---------------------------------------------------------------------------

test('council orders renders ODDS UNAVAILABLE when odds are null and unknown hate when hate is null', () => {
  const root = createRoot();
  const { text } = renderTo(root, cyclePlanPayload({
    assignments: [{
      councilor: BASE_COUNCILOR,
      candidate: { friendlyName: 'Advise', family: 'council', target: { kind: 'nation', nation: 'United States' } },
      odds: null,
      expectedHate: null,
      riskFloor: null
    }],
    unassigned: [],
    unavailable: []
  }));

  assert.ok(text.includes('ODDS UNAVAILABLE'), 'null odds must render ODDS UNAVAILABLE, never a number');
  assert.ok(text.includes('unknown'), 'null expectedHate must render unknown, never 0 hate');
  assert.ok(text.includes('1 on mission · 0 idle · 0 without a slot'), 'the tally must still count the order');
  assertNoPlaceholderText(text, 'council orders null odds');
});

test('council orders renders GUARANTEED for automatic odds and 0 hate for a measured zero', () => {
  const root = createRoot();
  const { text } = renderTo(root, cyclePlanPayload({
    assignments: [{
      councilor: BASE_COUNCILOR,
      candidate: { missionType: 'Advise', family: 'advisory', target: { kind: 'nation', name: 'Mexico' } },
      odds: { automatic: true, basis: 'Mission is uncontested — it cannot fail.' },
      expectedHate: 0,
      riskFloor: null
    }],
    unassigned: [],
    unavailable: []
  }));

  assert.ok(text.includes('GUARANTEED'), 'automatic odds must render GUARANTEED');
  assert.ok(text.includes('0 hate'), 'a measured zero hate must render 0 hate');
  assert.ok(!text.includes('ODDS UNAVAILABLE'), 'automatic odds must not fall back to unavailable');
});

test('council orders renders the roll band and positive hate to two decimals', () => {
  const root = createRoot();
  const { text } = renderTo(root, cyclePlanPayload({
    assignments: [{
      councilor: BASE_COUNCILOR,
      candidate: { friendlyName: 'Purge', family: 'expansion', target: { kind: 'controlPoint', controlPointType: 'ExtractiveSector', nation: 'China' } },
      odds: { point: 93, band: [89, 96], basis: 'Espionage 25 vs diff +8.0' },
      expectedHate: 4.74,
      riskFloor: null
    }],
    unassigned: [],
    unavailable: []
  }));

  assert.ok(text.includes('93% [89–96%]'), 'the roll must render point with the en-dash band');
  assert.ok(text.includes('+4.74 hate'), 'a positive expected hate must render with its sign to two decimals');
  assert.ok(text.includes('ExtractiveSector · China'), 'the control-point target must render');
});

test('council orders renders a >=100 roll as >99%, never 100%', () => {
  const root = createRoot();
  const { text } = renderTo(root, cyclePlanPayload({
    assignments: [{
      councilor: BASE_COUNCILOR,
      candidate: { friendlyName: 'Purge', family: 'expansion', target: { kind: 'none' } },
      odds: { point: 100, band: null, basis: null },
      expectedHate: null,
      riskFloor: null
    }],
    unassigned: [],
    unavailable: []
  }));

  assert.ok(text.includes('>99%'), 'a 100 point must render >99% (a 100 is the top of a roll, not a guarantee)');
  assert.ok(!text.includes('100%'), 'the panel must never claim a literal 100%');
});

test('council orders renders FLOOR UNVERIFIED for an unknown risk floor and MARGINAL for a marginal pass', () => {
  const unknownRoot = createRoot();
  const unknown = renderTo(unknownRoot, cyclePlanPayload({
    assignments: [{
      councilor: BASE_COUNCILOR,
      candidate: { friendlyName: 'Advise', family: 'council', target: { kind: 'nation', nation: 'Mexico' } },
      odds: { point: 93, band: null },
      expectedHate: 2,
      riskFloor: { outcome: 'unknown', reason: 'floor could not be checked' }
    }],
    unassigned: [],
    unavailable: []
  }));
  assert.ok(unknown.text.includes('FLOOR UNVERIFIED'), 'an unchecked risk floor must render FLOOR UNVERIFIED');

  const marginalRoot = createRoot();
  const marginal = renderTo(marginalRoot, cyclePlanPayload({
    assignments: [{
      councilor: BASE_COUNCILOR,
      candidate: { friendlyName: 'Advise', family: 'council', target: { kind: 'nation', nation: 'Mexico' } },
      odds: { point: 93, band: null },
      expectedHate: 2,
      riskFloor: { outcome: 'pass', marginal: true, reason: 'marginal pass' }
    }],
    unassigned: [],
    unavailable: []
  }));
  assert.ok(marginal.text.includes('MARGINAL'), 'a marginal risk-floor pass must render MARGINAL');
});

// ---------------------------------------------------------------------------
// 3. IDLE AND UNAVAILABLE ROWS
// ---------------------------------------------------------------------------

test('council orders renders an idle councilor with reason and free action', () => {
  const root = createRoot();
  const { text } = renderTo(root, cyclePlanPayload({
    assignments: [],
    unassigned: [{
      councilor: BASE_COUNCILOR,
      reason: 'No positive expected-value action matched.',
      suggestedFreeAction: 'Advise Councilor',
      freeActionOptions: ['Advise Councilor', 'Boost Nation']
    }],
    unavailable: []
  }));

  assert.ok(text.includes('0 on mission · 1 idle · 0 without a slot'), 'the tally must count the idle councilor');
  assert.ok(text.includes('No mission assigned'), 'the idle row must read No mission assigned');
  assert.ok(text.includes('No positive expected-value action matched.'), 'the idle reason must render');
  assert.ok(text.includes('Free action: Advise Councilor (or Boost Nation)'), 'the free action and its alternates must render');
});

test('council orders renders an unavailable councilor with its status and reason', () => {
  const root = createRoot();
  const { text } = renderTo(root, cyclePlanPayload({
    assignments: [],
    unassigned: [],
    unavailable: [{ councilor: BASE_COUNCILOR, status: 'Injured', reasonDetail: 'Holds no mission slot this cycle.' }]
  }));

  assert.ok(text.includes('0 on mission · 0 idle · 1 without a slot'), 'the tally must count the unavailable councilor');
  assert.ok(text.includes('No mission slot — Injured'), 'the row must name the missing slot and the status');
  assert.ok(text.includes('Holds no mission slot this cycle.'), 'the reason must render');
});

test('council orders renders Mission unnamed and No fixed target for a bare candidate, and Councilor for a missing one', () => {
  const bareRoot = createRoot();
  const bare = renderTo(bareRoot, cyclePlanPayload({
    assignments: [{
      councilor: { id: 2, name: 'Bob' },
      candidate: { target: {} },
      odds: null,
      expectedHate: null,
      riskFloor: null
    }],
    unassigned: [],
    unavailable: []
  }));
  assert.ok(bare.text.includes('Mission unnamed in this snapshot'), 'a candidate with no mission label must say so');
  assert.ok(bare.text.includes('No fixed target'), 'a candidate with no resolvable target must say so');

  const noCouncilorRoot = createRoot();
  const noCouncilor = renderTo(noCouncilorRoot, cyclePlanPayload({
    assignments: [{
      candidate: { friendlyName: 'Advise' },
      odds: null,
      expectedHate: null,
      riskFloor: null
    }],
    unassigned: [],
    unavailable: []
  }));
  assert.ok(noCouncilor.text.includes('Councilor'), 'an assignment with no councilor record must fall back to the Councilor label');
});

test('council orders renders every family label', () => {
  const families = [
    ['expansion', 'EXPANSION'],
    ['council', 'COUNCIL'],
    ['intelligence', 'INTEL'],
    ['intel', 'INTEL'],
    ['security', 'SECURITY'],
    ['space', 'SPACE'],
    ['research', 'RESEARCH'],
    ['defense', 'DEFENSE']
  ];
  for (const [family, label] of families) {
    const root = createRoot();
    const { text } = renderTo(root, cyclePlanPayload({
      assignments: [{
        councilor: BASE_COUNCILOR,
        candidate: { friendlyName: 'M', family, target: { kind: 'none' } },
        odds: null,
        expectedHate: null,
        riskFloor: null
      }],
      unassigned: [],
      unavailable: []
    }));
    assert.ok(text.includes(label), `family "${family}" must render ${label}`);
  }
});

test('council orders renders each target kind through its label', () => {
  const targets = [
    [{ kind: 'controlPoint', controlPointType: 'ExtractiveSector', nation: 'China' }, 'ExtractiveSector · China'],
    [{ kind: 'councilor', councilorName: 'Dr. Voss', faction: 'the Servants' }, 'Dr. Voss · the Servants'],
    [{ kind: 'nation', name: 'France' }, 'France'],
    [{ kind: 'capability', faction: 'the Protectorate' }, 'the Protectorate'],
    [{ kind: 'none' }, 'No fixed target']
  ];
  for (const [target, expected] of targets) {
    const root = createRoot();
    const { text } = renderTo(root, cyclePlanPayload({
      assignments: [{
        councilor: BASE_COUNCILOR,
        candidate: { friendlyName: 'M', family: 'council', target },
        odds: null,
        expectedHate: null,
        riskFloor: null
      }],
      unassigned: [],
      unavailable: []
    }));
    assert.ok(text.includes(expected), `target ${JSON.stringify(target)} must render "${expected}"`);
  }
});

// ---------------------------------------------------------------------------
// 4. EMPTY AND ABSENT INPUT (they are different)
// ---------------------------------------------------------------------------

test('council orders renders the cycle-plan unavailable message for empty and absent payloads', () => {
  const payloads = [
    ['empty object', {}],
    ['engineDirectives present but empty', { engineDirectives: {} }],
    ['null payload', null],
    ['undefined payload', undefined]
  ];
  for (const [label, payload] of payloads) {
    const root = createRoot();
    const { text } = renderTo(root, payload);
    assert.ok(
      text.includes('Cycle plan unavailable for this snapshot'),
      `${label}: a missing cyclePlan must render the unavailable message`
    );
  }
});

test('council orders renders the no-councilors message for a present but empty cycle plan', () => {
  const root = createRoot();
  const { text } = renderTo(root, cyclePlanPayload({ assignments: [], unassigned: [], unavailable: [] }));
  assert.ok(text.includes('No councilors are reported in this cycle plan.'), 'an empty cycle plan is a different state from a missing one');
});