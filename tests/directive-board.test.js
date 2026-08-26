// tests/directive-board.test.js
//
// Purpose: thin browser suite for the Directive Board React panel. The 19 tests
//   in tests/directiveBoardBench.test.js already characterise the bench, the
//   portfolio budget meters and every truncation count through the same harness.
//   This companion covers only what that file cannot:
//
//     - the panel mounts into the PRODUCTION #directiveBoard container and
//       renders its headline content
//     - the cross-panel selector src/v2/panels/CouncilOrders.jsx reaches in with
//       still resolves against what this panel actually emits
//     - the honest unavailable states the bench file never touches: an absent
//       cycle plan, an unmeasurable per-assignment reading, and the three-way
//       risk-floor readout in which 0 and "unconfigured" are different
//       statements
//     - the risk-floor control's `Number('') === 0` guard, which nothing in the
//       suite exercised before this port
//
// Deliberately six tests. The bench file is the detailed safety net; a second
// full characterisation pass on top is what made test code outweigh application
// code two to one on earlier waves.
//
// RED PROOF (2026-08-26): renamed the emitted `data-assignment-index` attribute
// to `data-card-index` in src/v2/panels/DirectiveBoard.jsx and rebuilt the
// harness. This file went red with 2 failures — the mount test lost the index
// attribute and the cross-navigation test could no longer resolve any card
// through CouncilOrders' selector — while the others stayed green. The
// attribute was restored immediately. The companion proof is in
// tests/directiveBoardBench.test.js's header.
//
// RED PROOF (2026-08-26, register defect #17): the four fabricated fallbacks
// fixed below were each broken deliberately with the new tests in place, and
// the right test went red before the fix was restored:
//   - `formatCost`'s absent branch back to `if (!cost) return 'Free'` ->
//     "an absent cost takes the affordance while a measured zero keeps saying
//     Free" fails (absent renders 'Free', never 'COST UNAVAILABLE').
//   - confidence back to `{reasoning.confidence || 'HIGH'}` ->
//     "an absent confidence reads unrated while a rated confidence stays
//     unchanged" fails ('Confidence: HIGH' instead of 'Confidence: unrated').
//   - the detail-panel facts back to `opportunityCost || 'None'` and
//     `whyList.join(' · ') || 'Optimal expected value …'` ->
//     "the detail panel states absence for cost, opportunity cost and rationale
//     rather than fabricating" fails on both 'None' and the canned sentence.
// Each was restored immediately; without the deliberate break the absent
// half of every assertion could be green against a panel that still fabricates.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const {
  withDirectiveBoardHarnessPage,
  exerciseRiskFloorSelect,
  renderDirectiveBoardOnPage,
  getBoardMountHtml,
  getBoardMountText,
  resolveAssignmentCardAsCouncilOrdersDoes,
  visibleText,
} = require('./fixtures/directiveBoardBrowser');

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

function payload(cyclePlan) {
  return { engineDirectives: cyclePlan === null ? {} : { cyclePlan } };
}

const ASSIGNMENT = {
  councilor: { name: 'Mahangeet Pakimor', profession: 'Investigator', location: 'India', stat: 'INV 8' },
  candidate: {
    title: 'Purge the Protectorate hold on the Executive seat in India',
    friendlyName: 'Purge',
    missionType: 'PurgeControlPoint',
    family: 'expansion',
    target: { name: 'India' },
    cost: { amount: 12, resource: 'Influence' },
  },
  odds: { point: 82, band: [74, 90], basis: 'Calculated from mission rules' },
  expectedValue: 6.03,
  expectedHate: 4.57,
  why: ['Highest expected value available to this operative this cycle.'],
  opportunityCost: 'Forgoes Advise Government: Switzerland at 4.14.',
  riskFloor: null,
};

function planWith(overrides = {}) {
  return {
    assignments: [],
    unassigned: [],
    clocks: [],
    horizon: [],
    budgets: {},
    riskFloor: { percent: 0, inForce: false, configured: true },
    benched: [],
    ...overrides,
  };
}

test('the React board mounts into #directiveBoard and renders its headline plan', async () => {
  await withDirectiveBoardHarnessPage(
    payload(planWith({ assignments: [ASSIGNMENT], unassigned: [{ councilor: { name: 'Idle Operative' } }] })),
    async (page) => {
      const html = await getBoardMountHtml(page);
      const text = await getBoardMountText(page);

      assert.ok(text.includes('DIRECTIVE ENGINE v2 // CYCLE ALLOCATION'), 'the header eyebrow must render');
      assert.ok(text.includes('COUNCILOR ASSIGNMENT PLAN'), 'the header title must render');
      assert.ok(text.includes('1 ASSIGNED'), 'the assigned badge must count the assignments');
      assert.ok(text.includes('1 IDLE'), 'the idle badge must count the unassigned operatives');
      assert.ok(text.includes('Mahangeet Pakimor'), 'the councilor must reach the reader');
      assert.ok(text.includes('Purge the Protectorate hold on the Executive seat in India'),
        'the mission title must reach the reader');
      assert.ok(text.includes('82%'), 'a computed success chance must render as its own figure');
      assert.ok(text.includes('EV: 6.03'), 'the expected value must render to two decimals');
      assert.ok(text.includes('+4.57 hate'), 'the expected hate must render with its sign');
      assert.ok(html.includes('data-assignment-index="0"'), 'each card must carry its index');

      assertNoPlaceholderText(html, 'directive-board normal render');
    },
  );
});

test('the council-orders cross-navigation selector still resolves against what this panel emits', async () => {
  // src/v2/panels/CouncilOrders.jsx:255-257 resolves a card as
  //   getElementById('directiveBoard')
  //     .querySelector('.directive-assignment-card[data-assignment-index="N"]')
  // The helper below runs that literal selector, so a rename on either side of
  // the contract fails here rather than silently killing the other panel's
  // click-through — which nothing else in the suite would notice.
  const three = [0, 1, 2].map((i) => ({
    ...ASSIGNMENT,
    councilor: { ...ASSIGNMENT.councilor, name: `Operative ${i}` },
  }));

  await withDirectiveBoardHarnessPage(payload(planWith({ assignments: three })), async (page) => {
    for (const index of [0, 1, 2]) {
      const found = await resolveAssignmentCardAsCouncilOrdersDoes(page, index);
      assert.strictEqual(found.boardFound, true, '#directiveBoard must exist as the mount');
      assert.strictEqual(found.cardFound, true,
        `.directive-assignment-card[data-assignment-index="${index}"] must resolve inside #directiveBoard`);
      assert.strictEqual(found.index, String(index), 'the card must carry the index it was resolved by');
      assert.ok(found.text.includes(`Operative ${index}`),
        'the resolved card must be the one for that assignment, not a neighbour');
    }

    const beyond = await resolveAssignmentCardAsCouncilOrdersDoes(page, 3);
    assert.strictEqual(beyond.cardFound, false,
      'an index with no assignment must resolve to nothing rather than to the wrong card');
  });
});

test('an absent cycle plan renders CYCLE PLAN UNAVAILABLE and claims no figures', async () => {
  await withDirectiveBoardHarnessPage(payload(null), async (page) => {
    const html = await getBoardMountHtml(page);
    const text = await getBoardMountText(page);

    assert.ok(text.includes('CYCLE PLAN UNAVAILABLE'), 'the unavailable badge must render');
    assert.ok(text.includes('Cycle allocation plan is unavailable for this snapshot'),
      'the empty banner must say what is missing');
    assert.ok(!/\bASSIGNED\b/.test(text), 'no assignment count may be claimed without a plan');
    assert.strictEqual((html.match(/class="directive-budgets-bar"/g) || []).length, 0,
      'no budget meters may be drawn for a plan that was never read');
    assert.strictEqual((html.match(/class="directive-benched-item"/g) || []).length, 0,
      'no bench rows may be drawn for a plan that was never read');
    assertNoPlaceholderText(html, 'directive-board absent plan');
  });
});

test('unmeasurable odds, expected value and hate render honest affordances, never a confident default', async () => {
  const blind = {
    ...ASSIGNMENT,
    odds: { basis: 'mission rules not in this snapshot' },
    expectedValue: null,
    expectedHate: null,
    riskFloor: { outcome: 'unknown', reason: 'Success odds could not be computed for this action.' },
  };

  await withDirectiveBoardHarnessPage(payload(planWith({ assignments: [blind] })), async (page) => {
    const html = await getBoardMountHtml(page);
    const text = await getBoardMountText(page);

    assert.ok(text.includes('ODDS UNAVAILABLE'), 'absent odds must say so, never render a percentage');
    assert.ok(!/\d+%/.test(text), `no percentage may be invented for an unmeasured chance: ${text}`);
    assert.ok(text.includes('EV: —'), 'an absent expected value must render an em dash, not 0.00');
    assert.ok(!text.includes('EV: 0'), 'an absent expected value must never be coerced to zero');
    assert.ok(text.includes('hate unknown'), 'an absent expected hate must say unknown, not 0 hate');
    assert.ok(!text.includes('0 hate'), 'an absent expected hate must never be coerced to zero');
    assert.ok(text.includes('FLOOR NOT VERIFIED'),
      'a floor that could not be CHECKED must not read as a floor that was cleared');
    assert.strictEqual((html.match(/class="directive-odds-bar/g) || []).length, 0,
      'an unmeasured chance draws no meter, because the bar length would be fiction');
    assertNoPlaceholderText(html, 'directive-board unmeasurable readings');
  });
});

test('the risk-floor readout is three-way: a 0 floor, an unconfigured floor and a floor in force differ', async () => {
  // Number(null) === 0 collapses all three, which is why the panel reads
  // `inForce` and `configured` as explicit booleans rather than testing the
  // percent for truthiness.
  const chosenZero = planWith({ riskFloor: { percent: 0, inForce: false, configured: true } });
  const unconfigured = planWith({ riskFloor: { percent: null, inForce: false, configured: false } });
  const inForce = planWith({
    assignments: [ASSIGNMENT],
    riskFloor: { percent: 75, inForce: true, configured: true },
    riskFloorVetoedTotalCount: 4,
  });

  await withDirectiveBoardHarnessPage(payload(chosenZero), async (page) => {
    const zeroText = await getBoardMountText(page);
    assert.ok(zeroText.includes('No floor: every action is offered regardless of its success odds.'),
      `a deliberately chosen 0 is a real setting: ${zeroText}`);

    const unconfiguredRender = await renderDirectiveBoardOnPage(page, payload(unconfigured));
    assert.ok(unconfiguredRender.text.includes('No floor is configured for this snapshot'),
      `an unconfigured floor must not be reported as a setting nobody made: ${unconfiguredRender.text}`);
    assert.ok(!unconfiguredRender.text.includes('No floor: every action is offered'),
      'the unconfigured reading must not borrow the chosen-zero sentence');

    const inForceRender = await renderDirectiveBoardOnPage(page, payload(inForce));
    assert.ok(inForceRender.text.includes('Actions must clear 75% at the LOW end of their odds band.'),
      `a floor in force must state the threshold it applies: ${inForceRender.text}`);
    assert.ok(inForceRender.text.includes('RISK FLOOR 75% · 4 HELD'),
      `the badge must carry the floor and what it held back: ${inForceRender.text}`);
    assertNoPlaceholderText(inForceRender.html, 'directive-board risk floor in force');
  });
});

test('clearing the risk-floor control hands back null, never Number(\'\') === 0', async () => {
  // The one place in this panel where an empty string reaches a Number(). `''`
  // CLEARS the stored preference so the next request omits the parameter and
  // the server's configured default applies again; `0` is the player choosing
  // no floor. Collapsing the two would silently pin every future snapshot to a
  // setting nobody made. Nothing else in the suite exercises this control.
  const plan = planWith({ riskFloor: { percent: 70, inForce: true, configured: true } });

  await withDirectiveBoardHarnessPage(payload(plan), async (page) => {
    const { seeded, options, calls } = await exerciseRiskFloorSelect(page, plan, {
      preference: null,
      pick: ['', '90', '0'],
    });

    assert.strictEqual(seeded, '',
      'an absent stored preference must seed the server-default option, not a floor');
    assert.strictEqual(options[0].label, 'Server default (70%)',
      'the server-default option must name the floor the server actually resolved');
    assert.strictEqual(options[1].value, '0',
      'the deliberate "off" choice must be offered separately from the server default');

    assert.strictEqual(calls.length, 3, 'each change must reach the controller exactly once');
    assert.strictEqual(calls[0].isNull, true,
      'clearing the control must hand back null — Number(\'\') === 0 would store a floor of 0');
    assert.strictEqual(calls[1].value, 90, 'a chosen floor must arrive as a number');
    assert.strictEqual(calls[2].value, 0,
      'a deliberate 0 must arrive as 0, which is not the same reading as null');
  });
});

test('an absent cost takes the affordance while a measured zero keeps saying Free', async () => {
  // Register defect #17: `if (!cost) return 'Free'` reported an UNMEASURED cost
  // as a measured zero, and `0` is falsy, so `cost: 0` was indistinguishable
  // from no cost at all. The card tag now carries an explicit presence signal.
  const absent = { ...ASSIGNMENT, candidate: { ...ASSIGNMENT.candidate, cost: undefined } };
  const free = { ...ASSIGNMENT, candidate: { ...ASSIGNMENT.candidate, cost: 0 } };
  const zeroAmount = { ...ASSIGNMENT, candidate: { ...ASSIGNMENT.candidate, cost: { amount: 0, resource: 'Influence' } } };

  await withDirectiveBoardHarnessPage(payload(planWith({ assignments: [ASSIGNMENT] })), async (page) => {
    const absentRender = await renderDirectiveBoardOnPage(page, payload(planWith({ assignments: [absent] })));
    const freeRender = await renderDirectiveBoardOnPage(page, payload(planWith({ assignments: [free] })));
    const zeroAmountRender = await renderDirectiveBoardOnPage(page, payload(planWith({ assignments: [zeroAmount] })));

    assert.ok(absentRender.text.includes('COST UNAVAILABLE'),
      `an absent cost must state the affordance: ${absentRender.text}`);
    assert.ok(!absentRender.text.includes('Free'),
      'an absent cost must never be reported as a measured zero');
    assert.ok(freeRender.text.includes('Free'),
      'a measured zero cost must keep saying Free');
    assert.ok(zeroAmountRender.text.includes('0 Influence'),
      'a measured zero amount must keep its own reading');
    assertNoPlaceholderText(absentRender.html, 'directive-board absent cost');
  });
});

test('an absent confidence reads unrated while a rated confidence stays unchanged', async () => {
  // Register defect #17: `reasoning.confidence || 'HIGH'` rendered an unrated
  // recommendation as the highest rating the field can take.
  const unrated = planWith({
    decisionReasoning: { heading: 'Why this action', summary: 'The engine explains its choice.', counts: {}, sources: [] },
  });
  const conditional = planWith({
    decisionReasoning: { heading: 'Why this action', summary: 'The engine explains its choice.', counts: {}, confidence: 'conditional', sources: [] },
  });

  await withDirectiveBoardHarnessPage(payload(planWith({})), async (page) => {
    const unratedRender = await renderDirectiveBoardOnPage(page, payload(unrated));
    const conditionalRender = await renderDirectiveBoardOnPage(page, payload(conditional));

    assert.ok(unratedRender.text.includes('Confidence: unrated'),
      `an absent confidence must not read as the highest rating: ${unratedRender.text}`);
    assert.ok(!/Confidence: HIGH/.test(unratedRender.text),
      'an unrated recommendation must never be shown as HIGH');
    assert.ok(conditionalRender.text.includes('Confidence: conditional'),
      'a rated confidence renders unchanged');
  });
});

test('the detail panel states absence for cost, opportunity cost and rationale rather than fabricating', async () => {
  // Register defect #17: the three facts used `|| 'Free'`-style defaults that
  // FABRICATED a measured claim — 'None' asserted nothing was given up, and
  // the canned rationale asserted a reason the engine never produced. Absent
  // stays null through resolveValue on the string-only facts surface.
  const bare = {
    ...ASSIGNMENT,
    candidate: { ...ASSIGNMENT.candidate, cost: undefined },
    opportunityCost: undefined,
    why: [],
  };
  const measured = {
    ...ASSIGNMENT,
    candidate: { ...ASSIGNMENT.candidate, cost: { amount: 0, resource: 'Influence' } },
    opportunityCost: 'Forgoes Advise Government: Switzerland at 4.14.',
    why: ['Highest expected value available to this operative this cycle.'],
  };

  await withDirectiveBoardHarnessPage(payload(planWith({ assignments: [bare] })), async (page) => {
    const factValues = async (assignments) => page.evaluate(async (list) => {
      const root = document.getElementById('directive-board-test-root');
      const plan = {
        assignments: list,
        unassigned: [],
        clocks: [],
        horizon: [],
        budgets: {},
        riskFloor: { percent: 0, inForce: false, configured: true },
        benched: [],
      };
      const opened = [];
      const realOpen = window.MissionControlDetailPanel.open;
      window.MissionControlDetailPanel.open = (options) => opened.push(options);
      try {
        window.MissionControlDirectiveBoard.render(root, { engineDirectives: { cyclePlan: plan } });
        await new Promise((resolve) => setTimeout(resolve, 30));
        const card = root.querySelector('.directive-assignment-card');
        if (!card) return null;
        card.click();
        await new Promise((resolve) => setTimeout(resolve, 20));
      } finally {
        window.MissionControlDetailPanel.open = realOpen;
      }
      const facts = opened[0] ? opened[0].facts : [];
      return Object.fromEntries(facts.map((f) => [f.label, f.value]));
    }, assignments);

    const bareFacts = await factValues([bare]);
    const measuredFacts = await factValues([measured]);

    assert.ok(bareFacts, 'clicking the card must reach MissionControlDetailPanel.open');
    assert.strictEqual(bareFacts['Resource cost'], 'Cost unavailable',
      'an absent cost must take the affordance in the detail panel too');
    assert.strictEqual(bareFacts['Opportunity cost'], 'Not computed',
      'an uncomputed opportunity cost must not claim "None"');
    assert.strictEqual(bareFacts['Tactical rationale'], 'No rationale recorded',
      'an absent rationale must not be handed a fabricated expected-value sentence');
    assert.strictEqual(measuredFacts['Resource cost'], '0 Influence',
      'a measured zero cost still renders as zero');
    assert.strictEqual(measuredFacts['Opportunity cost'], 'Forgoes Advise Government: Switzerland at 4.14.',
      'a measured opportunity cost renders unchanged');
    assert.strictEqual(measuredFacts['Tactical rationale'],
      'Highest expected value available to this operative this cycle.',
      'a recorded rationale renders unchanged');
  });
});
