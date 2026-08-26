// tests/fleetProcurementRendering.test.js
//
// Purpose: the thin browser proof that the React FLEET panel is real — it mounts
//   at the production id, its honest unavailable states survive the port, and
//   register defect #4's fabricated armour score stays fixed.
//
// DELIBERATELY THIN. `tests/refitAdvisor.test.js` (16) and
// `tests/researchRanking.test.js` (63) are the safety net and both survived the
// migration with every assertion unchanged; between them they already
// characterise the four drive states, the three armour states, the obsolete
// demotion, the severity thresholds and the procurement row's null discipline
// against the live fixture in both modes. Re-characterising that here would
// double the test code for nothing. These six cover only what neither file can:
// the mount is live, the bridge is the React one, the click handlers survived
// `innerHTML` becoming a React tree, and the defect #4 fix holds.

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

test('DEFECT #4: an armour with no resistance figures yields no ratio, and the recognised pair beside it still does', async () => {
  const page = await getFleetProcurementHarnessPage();
  const html = await renderFleetProcurementOnPage(page, PROCUREMENT_PAYLOAD, REFIT_PAYLOAD);
  const text = visibleText(html);

  // Non-vacuity first: a recognised pair must still produce its real ratio, so
  // this test cannot be passed by a panel that simply stopped showing ratios.
  assert.match(text, /Foamed Metal Armor → Adamantane Armor/, 'the known pair renders its transition');
  assert.match(html, /<span class="ra-tag ra-tag--deficit">3\.9× behind<\/span>/,
    'and its measured 3.9× deficit badge');

  // The unrecognised material. The vanilla scored it a fabricated 1.0, which
  // divided into Adamantane's 15.20 and rendered a confident red "15.2× behind".
  assert.match(text, /Neutronium Armor → Adamantane Armor/, 'the transition is still shown');
  assert.ok(!text.includes('15.2× behind'), 'the fabricated ratio is gone');
  assert.match(text, /protection ratio unmeasured/, 'and is replaced by an explicit unmeasured affordance');

  // Scoped to the armour row, not the whole card: a WARSHIP role badge is itself
  // an `ra-tag--deficit`, so a card-wide scan would pass vacuously.
  const unknownCard = html.match(/<div class="fp-refit-card" data-design-id="unknown-armour"[\s\S]*?Refit details/);
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
