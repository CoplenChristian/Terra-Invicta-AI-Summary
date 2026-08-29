// tests/fleetProcurementRendering.test.js
//
// Purpose: the thin browser proof that the React FLEET panel is real — it mounts
//   at the production id, its honest unavailable states survive the port, and
//   register defects #4 and #20 stay fixed.
//
// DELIBERATELY THIN. `tests/refitAdvisor.test.js` (16) and
// `tests/researchRanking.test.js` (63) are the safety net for the model and
// survived the migration with their behavioural assertions intact. This file
// covers what neither file can: the mount is live, the bridge is the React one,
// the click handlers survived `innerHTML` becoming a React tree, the defect #4
// fix holds, defect #20's three refit states stay distinguishable, and defect
// #21's rendered presence is independent per metric.
//
// The last three tests are intentionally not vacuous panel scans. They locate
// each figure by row/card and assert its own `data-value-state` and text, so a
// neighbouring value or a row-level presence flag cannot satisfy them.
//
// DEFECT #20 MUTATION CHECK (2026-08-26). Reverting `refitView` to the vanilla
// `refitsRenderable` guard made the new test fail on all three states at once;
// restoring the fix turned it green again.

const { test, after } = require('node:test');
const assert = require('node:assert');

const {
  getFleetProcurementHarnessPage,
  closeFleetProcurementHarness,
  withFleetProcurementHarnessPage,
  renderFleetProcurementOnPage,
  renderRefitCardOnPage,
  getProductionMountHtml,
  openProcurementDetailsByClick,
  openRefitDetailsByClick,
  visibleText,
} = require('./fixtures/fleetProcurementBrowser');

after(async () => { await closeFleetProcurementHarness(); });

const PROCUREMENT_PAYLOAD = {
  success: true,
  military: {
    procurement: {
      label: 'Already unlocked, not in service',
      count: 2,
      items: [
        {
          id: 'dreadnought', displayName: 'Dreadnought', gateProjectName: 'Ships of the Line',
          axisLabel: 'throw weight', improvementMultiple: 2.07, action: 'build',
          context: { family: 'ship_hull' },
        },
        {
          id: 'railgun', displayName: 'Rail Cannon Mk3', axisLabel: 'damage',
          improvementMultiple: 1.42, action: 'refit', clearsDeliveryFloor: false,
          context: { delivery: { shotsPerArrivingRound: 3.2 } },
        },
      ],
    },
  },
};

const REFIT_PAYLOAD = {
  success: true,
  items: [
    {
      designId: 'known-armour', displayName: 'Patapsco', hull: 'Cruiser', role: 'warship', isObsolete: false,
      baseline: { drive: { driveId: 'BurnerDrivex6', displayName: 'Burner Drive x6' }, deltaVKps: 14, combatAccelerationMps2: 1.9 },
      recommendations: {
        drive: null,
        weapons: [],
        armor: {
          currentArmor: 'FoamedMetalArmor',
          recommendedMaterial: 'Adamantane Armor',
          recommendedMaterialId: 'AdamantaneArmor',
          weighted: true,
          threatBasis: 'Weighted against observed alien fleet weapon mix (61% energy/X-ray, 40% kinetic/baryonic)',
        },
      },
    },
    {
      // The armour type the game adds after this table was written. DEFECT #4.
      designId: 'unknown-armour', displayName: 'Future Hull', hull: 'Battlecruiser', role: 'warship', isObsolete: false,
      baseline: { drive: { driveId: 'BurnerDrivex6', displayName: 'Burner Drive x6' }, deltaVKps: 20, combatAccelerationMps2: 2.2 },
      recommendations: {
        drive: null,
        weapons: [],
        armor: {
          currentArmor: 'NeutroniumArmor',
          recommendedMaterial: 'Adamantane Armor',
          recommendedMaterialId: 'AdamantaneArmor',
          weighted: true,
          threatBasis: 'Weighted against observed alien fleet weapon mix (61% energy/X-ray, 40% kinetic/baryonic)',
        },
      },
    },
  ],
};

test('the panel mounts at the production id and renders both halves', async () => {
  await withFleetProcurementHarnessPage(PROCUREMENT_PAYLOAD, REFIT_PAYLOAD, async (page) => {
    // The bridge, not a leftover vanilla global: the classic file is deleted and
    // its <script> tag is gone, so this can only resolve to src/v2/main.jsx.
    const bridge = await page.evaluate(() => {
      const panel = window.MissionControlFleetProcurement;
      return {
        hasRender: typeof panel?.render === 'function',
        hasFetch: typeof panel?.fetchProcurement === 'function',
        hasCard: typeof panel?.renderRefitDesignCard === 'function',
      };
    });
    assert.deepStrictEqual(bridge, { hasRender: true, hasFetch: true, hasCard: true });

    const html = await getProductionMountHtml(page);
    assert.ok(html.length > 0, '#fleetProcurement must not be an empty mount');
    const text = visibleText(html);

    assert.match(text, /FLEET PROCUREMENT/, 'the procurement card renders its title');
    assert.match(text, /2 unfielded/, 'and the measured unfielded count');
    assert.ok(text.includes('Dreadnought'), 'the first procurement row renders');
    assert.match(text, /VALIDATED REFIT ADVISOR/, 'the refit half renders beside it');
    assert.match(text, /2 FLEET DESIGNS EVALUATED/, 'with its evaluated count');
    assert.ok(html.includes('data-fleet-procurement-full'), 'the full-breakdown hook survives the port');
  });
});

test('an endpoint that did not answer renders the honest card, never a placeholder ranking', async () => {
  const page = await getFleetProcurementHarnessPage();

  for (const [label, payload] of [
    ['null payload', null],
    ['explicit failure', { success: false }],
    ['answer with no military block', { success: true }],
  ]) {
    const html = await renderFleetProcurementOnPage(page, payload, null);
    const text = visibleText(html);
    assert.match(text, /PROCUREMENT DATA UNAVAILABLE/, `${label}: states it is unavailable`);
    assert.match(text, /The ranking endpoint did not answer for this snapshot\./, `${label}: says why`);
    assert.ok(!html.includes('ra-procurement'), `${label}: renders no ranking block`);
    assert.ok(!/\b0 unfielded\b/i.test(text), `${label}: an unread count is not rendered as zero`);
    for (const token of ['null', 'undefined', 'NaN', '[object Object]']) {
      assert.ok(!text.includes(token), `${label}: "${token}" must never reach the reader`);
    }
  }

  // And an endpoint that DID answer with nothing unfielded is a different
  // sentence — measured-empty is not the same claim as unavailable.
  const emptyHtml = await renderFleetProcurementOnPage(
    page,
    { success: true, military: { procurement: { items: [], count: 0 } } },
    null,
  );
  const emptyText = visibleText(emptyHtml);
  assert.match(emptyText, /0 UNFIELDED/, 'a measured zero is stated as zero');
  assert.match(emptyText, /All researched components and ship hulls are currently in service/);
  assert.ok(!emptyText.includes('PROCUREMENT DATA UNAVAILABLE'), 'measured-empty is not reported as unavailable');
});

test('DEFECT #20: dead refit endpoint, explicit failure and measured-empty render distinct affordances', async () => {
  const page = await getFleetProcurementHarnessPage();

  const deadHtml = await renderFleetProcurementOnPage(page, PROCUREMENT_PAYLOAD, null);
  const deadText = visibleText(deadHtml);
  assert.match(deadText, /REFIT DATA UNAVAILABLE/, 'dead endpoint: states refit data is unavailable');
  assert.match(deadText, /The refit-advisor endpoint did not answer for this snapshot\./,
    'dead endpoint: names the missing answer');
  assert.ok(!deadHtml.includes('fp-refit-grid'), 'dead endpoint: renders no design grid');
  assert.ok(!/\b0 FLEET DESIGNS EVALUATED\b/.test(deadText),
    'dead endpoint: is not reported as a measured zero');

  const failHtml = await renderFleetProcurementOnPage(page, PROCUREMENT_PAYLOAD, {
    success: false,
    error: 'Snapshot fingerprint mismatch',
  });
  const failText = visibleText(failHtml);
  assert.match(failText, /REFIT DATA UNAVAILABLE/, 'explicit failure: states refit data is unavailable');
  assert.match(failText, /Snapshot fingerprint mismatch/,
    'explicit failure: carries the endpoint reason');
  assert.ok(!failText.includes('The refit-advisor endpoint did not answer'),
    'explicit failure: is not reported as a dead endpoint');
  assert.ok(!failHtml.includes('fp-refit-grid'), 'explicit failure: renders no design grid');
  assert.ok(!/\b0 FLEET DESIGNS EVALUATED\b/.test(failText),
    'explicit failure: is not reported as a measured zero');

  const emptyHtml = await renderFleetProcurementOnPage(page, PROCUREMENT_PAYLOAD, {
    success: true,
    items: [],
    count: 0,
  });
  const emptyText = visibleText(emptyHtml);
  assert.match(emptyText, /0 FLEET DESIGNS EVALUATED/, 'measured-empty: states zero evaluated');
  assert.match(emptyText, /No fielded ship designs were available for refit evaluation in this snapshot\./,
    'measured-empty: names the empty candidate set');
  assert.ok(!emptyText.includes('REFIT DATA UNAVAILABLE'),
    'measured-empty: is not reported as unavailable');
  assert.ok(!emptyText.includes('did not answer'),
    'measured-empty: is not reported as a dead endpoint');
  assert.ok(!emptyHtml.includes('fp-refit-grid'), 'measured-empty: renders no design grid');
});

test('DEFECT #4: an armour with no resistance figures yields no ratio, and the recognised pair beside it still does', async () => {
  const page = await getFleetProcurementHarnessPage();
  const html = await renderFleetProcurementOnPage(page, PROCUREMENT_PAYLOAD, REFIT_PAYLOAD);
  const text = visibleText(html);

  // Non-vacuity first: a recognised pair must still produce its real ratio, so
  // this test cannot be passed by a panel that simply stopped showing ratios.
  assert.match(text, /Foamed Metal Armor → Adamantane Armor/, 'the known pair renders its transition');
  assert.match(html, /<span class="value-measured ra-tag ra-tag--deficit" data-primitive="value" data-value-state="measured">3\.9× behind<\/span>/,
    'and its measured 3.9× deficit badge');

  // The unrecognised material. The vanilla scored it a fabricated 1.0, which
  // divided into Adamantane's 15.20 and rendered a confident red "15.2× behind".
  assert.match(text, /Neutronium Armor → Adamantane Armor/, 'the transition is still shown');
  assert.ok(!text.includes('15.2× behind'), 'the fabricated ratio is gone');
  assert.match(text, /protection ratio unmeasured/, 'and is replaced by an explicit unmeasured affordance');

  // Scoped to the armour row, not the whole card: a WARSHIP role badge is itself
  // an `ra-tag--deficit`, so a card-wide scan would pass vacuously.
  const unknownCard = html.match(/<div class="fp-refit-card MuiBox-root css-[a-z0-9]+" data-design-id="unknown-armour"[\s\S]*?Refit details/);
  assert.ok(unknownCard, 'the unrecognised-armour card must be locatable');
  const unknownArmor = unknownCard[0].match(/<div class="fp-refit__armor[\s\S]*?<\/div>/);
  assert.ok(unknownArmor, 'and its armour row must be present');
  assert.ok(!unknownArmor[0].includes('ra-tag--deficit'),
    'an unpriceable armour must not raise a red severity badge');
  assert.ok(!unknownArmor[0].includes('ra-tag--warn'),
    'nor an amber one — unknown is not a graded severity');
  assert.match(unknownArmor[0], /title="Armour protection could not be compared: [^"]*NeutroniumArmor/,
    'and the tooltip names the material it could not price');
});

test('DEFECT #4 in the other direction: an unpriceable RECOMMENDED armour is not silently passed as adequate', async () => {
  const page = await getFleetProcurementHarnessPage();
  // The vanilla scored the recommendation 1.0 against a fitted Adamantane 15.20,
  // got a ratio of 0.066, failed the `> 1.0` test and rendered NO badge at all —
  // visually identical to "your armour is fine". Silence is the second half of
  // the same defect.
  const html = await renderRefitCardOnPage(page, {
    designId: 'unknown-rec', displayName: 'Future Hull 2', hull: 'Battlecruiser', role: 'warship', isObsolete: false,
    baseline: { drive: { driveId: 'BurnerDrivex6', displayName: 'Burner Drive x6' } },
    recommendations: {
      armor: {
        currentArmor: 'AdamantaneArmor',
        recommendedMaterial: 'Neutronium Armor',
        recommendedMaterialId: 'NeutroniumArmor',
        weighted: true,
        threatBasis: 'Weighted against observed alien fleet weapon mix (61% energy/X-ray, 40% kinetic/baryonic)',
      },
    },
  });
  const text = visibleText(html);

  assert.match(text, /Adamantane Armor → Neutronium Armor/, 'the transition renders');
  assert.match(text, /protection ratio unmeasured/,
    'and the unmeasured comparison is stated rather than left blank');
  assert.ok(!/\d+(\.\d+)?× behind/.test(text), 'no ratio is claimed in either direction');
});

test('the Full breakdown button still opens the detail panel after innerHTML became a React tree', async () => {
  const page = await getFleetProcurementHarnessPage();
  const opened = await openProcurementDetailsByClick(page, PROCUREMENT_PAYLOAD, REFIT_PAYLOAD);

  assert.strictEqual(opened.length, 1, 'exactly one detail panel open call');
  const options = opened[0];
  assert.strictEqual(options.eyebrow, 'FLEET PROCUREMENT');
  assert.strictEqual(options.title, 'Already Unlocked, Not in Service');
  assert.strictEqual(options.facts.length, 2, 'one fact per procurement row');
  assert.match(options.facts[0].label, /^PROCUREMENT · Already unlocked · Dreadnought$/);
  assert.match(options.facts[0].value, /^2\.07× throw weight · build · unlocked by Ships of the Line$/);
  assert.match(options.facts[1].value, /3\.2 PD shots per arriving round/,
    'the delivery figures reach the drill-down');
  assert.match(options.facts[1].value, /fails its delivery floor/);

  // An empty procurement list opens with the reason it is empty, not an empty list.
  const emptyOpened = await openProcurementDetailsByClick(
    page,
    { success: true, military: { procurement: { count: 1, items: [{ id: 'x', displayName: 'One', axisLabel: 'dv', improvementMultiple: 2, action: 'refit' }] } } },
    null,
  );
  assert.strictEqual(emptyOpened.length, 1);
  assert.match(emptyOpened[0].facts[0].label, /^PROCUREMENT · Already unlocked · One$/);
});

test('each refit card opens its own spec, and an unknown obsolete status says so rather than defaulting', async () => {
  const page = await getFleetProcurementHarnessPage();
  const refits = {
    success: true,
    items: [
      { ...REFIT_PAYLOAD.items[0], designId: 'status-unknown', displayName: 'Unrecorded', isObsolete: null },
      REFIT_PAYLOAD.items[1],
    ],
  };

  const opened = await openRefitDetailsByClick(page, PROCUREMENT_PAYLOAD, refits, 'status-unknown');
  assert.strictEqual(opened.length, 1, 'exactly one detail panel open call');
  const options = opened[0];
  assert.strictEqual(options.eyebrow, 'VALIDATED REFIT ADVISOR');
  assert.strictEqual(options.title, 'Unrecorded Refit Specification');

  const status = options.facts.find(f => f.label === 'DESIGN STATUS');
  assert.ok(status, 'the design status fact is present');
  assert.strictEqual(status.value, 'Obsolete status unknown (not recorded in save)',
    'an unread obsolete marker is reported as unknown, never as "active"');

  const notice = options.facts.find(f => f.label === 'NON-COMPOSABILITY NOTICE');
  assert.ok(notice, 'the non-composability notice is carried into the drill-down');
  assert.match(notice.value, /making combined performance uncomputable/);

  // The button is wired per card, so the OTHER card must open the other design.
  const otherOpened = await openRefitDetailsByClick(page, PROCUREMENT_PAYLOAD, refits, 'unknown-armour');
  assert.strictEqual(otherOpened[0].title, 'Future Hull Refit Specification');
});

test('fleet procurement per-metric presence is independent across procurement rows', async () => {
  const payload = {
    success: true,
    military: {
      procurement: {
        count: 3,
        items: [
          { id: 'all', displayName: 'All present', axisLabel: 'damage', improvementMultiple: 2, action: 'refit' },
          { id: 'missing', displayName: 'One missing', axisLabel: 'damage', improvementMultiple: null, action: 'refit' },
          { id: 'other', displayName: 'Other present', axisLabel: 'damage', improvementMultiple: 3, action: 'refit' },
        ],
      },
    },
  };

  await withFleetProcurementHarnessPage(payload, { success: true, items: [], count: 0 }, async (page) => {
    await renderFleetProcurementOnPage(page, payload, { success: true, items: [], count: 0 });
    const rows = await page.evaluate(() => [...document.querySelectorAll('#fleet-procurement-test-root .fp-row')].map((row) => ({
      name: row.querySelector('.fp-row__name')?.textContent.trim(),
      figures: [...row.querySelectorAll('.fp-row__metric [data-value-state]')].map((value) => ({
        state: value.getAttribute('data-value-state'),
        text: value.textContent.trim(),
      })),
    })));

    assert.deepStrictEqual(rows, [
      { name: 'All present', figures: [{ state: 'measured', text: '2.00×' }] },
      { name: 'One missing', figures: [{ state: 'absent', text: '—' }] },
      { name: 'Other present', figures: [{ state: 'measured', text: '3.00×' }] },
    ], 'only the row whose multiple is null may become absent');
  });
});

test('fleet procurement per-metric presence is independent across refit cards', async () => {
  const metricDesign = (designId, { recDeltaV = 20, currentArmor = 'FoamedMetalArmor' } = {}) => ({
    designId,
    displayName: designId,
    hull: 'Cruiser',
    role: 'warship',
    isObsolete: false,
    baseline: {
      drive: { driveId: 'OldDrive', displayName: 'Old Drive' },
      deltaVKps: 14,
      combatAccelerationMps2: 1.9,
    },
    recommendations: {
      drive: {
        driveId: 'CandidateDrive',
        displayName: 'Candidate Drive',
        clearsFloor: true,
        deltaVKps: recDeltaV,
        combatAccelerationMps2: 2.5,
      },
      weapons: [],
      armor: {
        currentArmor,
        recommendedMaterial: 'Adamantane Armor',
        recommendedMaterialId: 'AdamantaneArmor',
        weighted: true,
        threatBasis: 'weighted threat basis',
      },
    },
    budgets: {
      power: { thrustScalingFactor: 0.75, summary: 'Power scaled by reactor budget' },
    },
  });
  const payload = {
    success: true,
    military: { procurement: { items: [], count: 0 } },
  };
  const refitPayload = {
    success: true,
    items: [
      metricDesign('all-present'),
      metricDesign('drive-delta-v-absent', { recDeltaV: null }),
      metricDesign('armor-ratio-absent', { currentArmor: 'UnknownArmor' }),
    ],
  };

  await withFleetProcurementHarnessPage(payload, refitPayload, async (page) => {
    await renderFleetProcurementOnPage(page, payload, refitPayload);
    const cards = await page.evaluate(() => [...document.querySelectorAll('#fleet-procurement-test-root .fp-refit-card[data-design-id]')].map((card) => ({
      id: card.getAttribute('data-design-id'),
      drive: [...card.querySelectorAll('.fp-refit__perf [data-value-state]')].map((value) => ({
        state: value.getAttribute('data-value-state'),
        text: value.textContent.trim(),
      })),
      armor: [...card.querySelectorAll('.fp-refit__armor [data-value-state]')].map((value) => ({
        state: value.getAttribute('data-value-state'),
        text: value.textContent.trim(),
      })),
      power: [...card.querySelectorAll('.fp-refit__power [data-value-state]')].map((value) => ({
        state: value.getAttribute('data-value-state'),
        text: value.textContent.trim(),
      })),
    })));
    const byId = Object.fromEntries(cards.map((card) => [card.id, card]));
    const allDrive = [
      { state: 'measured', text: '14.0' },
      { state: 'measured', text: '20.0' },
      { state: 'measured', text: '1.90' },
      { state: 'measured', text: '2.50' },
    ];

    assert.deepStrictEqual(byId['all-present'].drive, allDrive,
      'the untouched drive card must measure all four performance figures');
    assert.deepStrictEqual(byId['drive-delta-v-absent'].drive, [
      allDrive[0],
      { state: 'absent', text: '—' },
      allDrive[2],
      allDrive[3],
    ], 'a null recommended ΔV must move only its own figure');
    assert.deepStrictEqual(byId['drive-delta-v-absent'].armor, [
      { state: 'measured', text: '3.9× behind' },
    ], 'the neighbouring armour figure must remain measured');
    assert.deepStrictEqual(byId['drive-delta-v-absent'].power, [
      { state: 'measured', text: '75' },
    ], 'the neighbouring power figure must remain measured');

    assert.deepStrictEqual(byId['armor-ratio-absent'].drive, allDrive,
      'an unpriceable armour must not move any drive figure');
    assert.deepStrictEqual(byId['armor-ratio-absent'].armor, [
      { state: 'absent', text: 'protection ratio unmeasured' },
    ], 'only the unpriceable armour comparison must become absent');
    assert.deepStrictEqual(byId['armor-ratio-absent'].power, byId['all-present'].power,
      'an unpriceable armour must not move the power figure');
  });
});

test('fleet procurement stamps every absent affordance through Value', async () => {
  const payload = {
    success: true,
    military: {
      procurement: {
        items: [{
          id: 'missing-multiple',
          displayName: 'Unmeasured component',
          axisLabel: 'damage',
          improvementMultiple: null,
          action: 'refit',
        }],
      },
    },
  };
  const refitPayload = {
    success: true,
    items: [{
      designId: 'missing-drive-figures',
      displayName: 'Unmeasured hull',
      hull: 'Cruiser',
      role: 'warship',
      isObsolete: false,
      baseline: {
        drive: { driveId: 'OldDrive', displayName: 'Old Drive' },
        deltaVKps: null,
        combatAccelerationMps2: null,
      },
      recommendations: {
        drive: {
          driveId: 'CandidateDrive',
          displayName: 'Candidate Drive',
          clearsFloor: true,
          deltaVKps: null,
          combatAccelerationMps2: null,
        },
        weapons: [],
      },
    }],
  };

  await withFleetProcurementHarnessPage(payload, refitPayload, async (page) => {
    await renderFleetProcurementOnPage(page, payload, refitPayload);
    const audit = await page.evaluate(() => {
      const root = document.getElementById('fleet-procurement-test-root');
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const unstamped = [];
      let node = walker.nextNode();
      while (node) {
        if (node.textContent.includes('—')) {
          const host = node.parentElement;
          if (!host.closest('[data-value-state]')) {
            unstamped.push(`${host.className} :: ${node.textContent.trim()}`);
          }
        }
        node = walker.nextNode();
      }
      return {
        unstamped,
        absent: root.querySelectorAll('[data-value-state="absent"]').length,
        measured: root.querySelectorAll('[data-value-state="measured"]').length,
      };
    });

    assert.deepStrictEqual(audit.unstamped, [],
      'every rendered em dash used as a value must sit inside a Value host');
    assert.strictEqual(audit.absent, 5,
      'one procurement multiple and four drive figures must each be stamped absent');
    assert.ok(audit.measured >= 3, 'the surrounding measured figures must remain stamped');
  });
});
