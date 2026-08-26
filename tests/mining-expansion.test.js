// tests/mining-expansion.test.js
//
// Purpose: six thin real-browser checks proving the React mining expansion
// panel mounts, preserves both modes, and renders every important unavailable
// state explicitly — including registered defect #8.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { queryFixtureIntel } = require('./fixtures/frozenSnapshots.js');
const {
  getHarnessHtml,
  getHarnessText,
  visibleText,
  withMiningExpansionHarnessPage,
} = require('./fixtures/miningExpansionBrowser.js');

const OBSERVER = 4712;
const FORBIDDEN = ['null', 'undefined', 'NaN', '[object Object]'];

function fixture(mode = 'player') {
  return queryFixtureIntel({ endpoint: 'mining-expansion', mode, observer: OBSERVER });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertNoPlaceholderText(html, label) {
  const text = visibleText(html);
  for (const token of FORBIDDEN) {
    const index = text.indexOf(token);
    assert.equal(
      index,
      -1,
      `${label}: rendered text contains "${token}" near: ${text.slice(Math.max(0, index - 60), index + 60)}`,
    );
  }
}

test('React mining expansion mounts and renders headline figures in player and omniscient modes', async () => {
  for (const mode of ['player', 'omniscient']) {
    await withMiningExpansionHarnessPage(fixture(mode), async (page) => {
      const html = await getHarnessHtml(page);
      const text = await getHarnessText(page);

      assert.ok(text.includes('MINING CAPACITY 17 / 18 MINES (CAPACITY TIGHT)'));
      assert.ok(text.includes('AVAILABLE EXPANSION SITES (85)'));
      assert.ok(text.includes('Creag Màthair'));
      assert.ok(text.includes('TECH-GATED OPPORTUNITIES (187 sites)'));
      assert.ok(html.includes('data-testid="mining-expansion-board"'));
      assertNoPlaceholderText(html, `${mode} fixture`);
    });
  }
});

test('absent payload, capacity, and structural blocks render honest unavailable states', async () => {
  await withMiningExpansionHarnessPage(null, async (page) => {
    assert.equal(await getHarnessText(page), 'MINING EXPANSION DATA UNAVAILABLE');

    await page.evaluate(() => {
      window.MissionControlMiningExpansion.render(
        document.getElementById('miningExpansion'),
        { capacity: null },
      );
    });
    await page.waitForFunction(() => (
      document.getElementById('miningExpansion')?.textContent.includes('MINING EXPANSION DATA UNAVAILABLE')
    ));
    assert.equal(await getHarnessText(page), 'MINING EXPANSION DATA UNAVAILABLE');

    await page.evaluate(() => {
      window.MissionControlMiningExpansion.render(
        document.getElementById('miningExpansion'),
        {
          capacity: {
            minesBuilt: 0,
            mineLimit: 18,
            headroom: 18,
            overLimit: false,
            mcWarFloorDistance: null,
            baseHateMultiplier: 0.3,
            hateCostAvailable: true,
          },
          miningTechBonus: { available: true },
        },
      );
    });
    await page.waitForFunction(() => (
      document.getElementById('miningExpansion')?.textContent.includes('Runway data unavailable')
    ));
    const sparseText = await getHarnessText(page);
    assert.ok(sparseText.includes('Runway data unavailable'));
    assert.ok(sparseText.includes('MINE TECH BONUS RESOURCE LIST UNAVAILABLE'));
    assert.ok(sparseText.includes('Expansion site rows unavailable in this snapshot.'));
    assert.ok(sparseText.includes('Opportunity groups unavailable'));
  });
});

test('nullable capacity, runway, candidate, gated, and unreachable reads stay visibly unavailable', async () => {
  const payload = clone(fixture('player'));
  const candidate = payload.available[0];
  payload.capacity = {
    ...payload.capacity,
    minesBuilt: null,
    mineLimit: null,
    headroom: null,
    penaltyHate: null,
    marginalNextMinePenaltyHate: null,
    mcWarFloorDistance: null,
    baseHateMultiplier: null,
    hateCostAvailable: false,
  };
  payload.resourceRunways = {
    water: { key: 'water', runwayMonths: null, status: 'unmeasured' },
    volatiles: { key: 'volatiles', runwayMonths: null, status: 'consumption_unknown' },
  };
  candidate.displayName = null;
  candidate.parentBodyName = null;
  candidate.siteDensity = null;
  candidate.siteDensityMeasured = false;
  candidate.siteDensityAssumed = true;
  candidate.yields = Object.fromEntries(
    ['water', 'volatiles', 'metals', 'nobleMetals', 'fissiles']
      .map((key) => [key, { monthly: null, measured: false }]),
  );
  candidate.siteValue = null;
  candidate.scoreInputsComplete = false;
  candidate.hateCost = null;
  candidate.mcCost = null;
  candidate.buildTimeDays = null;
  candidate.moduleMultiplier = { projectedRangeAvailable: false };
  payload.available = [candidate];
  payload.availableTotalCount = null;
  payload.techGated = [{
    missingTech: null,
    missingTechName: null,
    siteCount: null,
    unmeasuredSiteCount: null,
    bestSiteValue: null,
  }];
  payload.unreachable = { totalSites: null };
  payload.miningTechBonus = null;
  payload.spaceMiningBonus = null;
  payload.mineModuleCapability = null;
  payload.mineUpgrades = null;

  await withMiningExpansionHarnessPage(payload, async (page) => {
    const html = await getHarnessHtml(page);
    const text = await getHarnessText(page);

    assert.ok(text.includes('CAPACITY UNMEASURED'));
    assert.ok(text.includes('ALIEN-HATE COSTS UNAVAILABLE'));
    assert.ok(text.includes('Water: Unmeasured'));
    assert.ok(text.includes('YIELDS UNMEASURED'));
    assert.ok(text.includes('Density: — (assumed)'));
    assert.ok(text.includes('HATE UNKNOWN'));
    assert.ok(text.includes('— · build n/a'));
    assert.ok(text.includes('AVAILABLE EXPANSION SITES (site count unavailable)'));
    assert.ok(text.includes('site count unavailable'));
    assert.ok(text.includes('Unreachable site count unavailable.'));
    assert.ok(text.includes('MINE UPGRADES NOT REPORTED'));
    assert.ok(!text.includes('FREE'));
    assertNoPlaceholderText(html, 'fully degraded payload');
  });
});

test('defect #8: nullable bonus-source name and build duration render explicit fallbacks', async () => {
  const payload = clone(fixture('player'));
  payload.spaceMiningBonus = {
    available: true,
    additiveTotal: 0.05,
    sources: [
      { name: null, value: 0.05 },
      { name: 'Known Org', value: null },
    ],
  };
  payload.available = [payload.available[0]];
  payload.availableTotalCount = 1;

  await withMiningExpansionHarnessPage(payload, async (page) => {
    const html = await getHarnessHtml(page);
    const text = await getHarnessText(page);
    const states = await page.evaluate(() => ({
      source: document.querySelector('[data-nullable-input="spaceMiningBonus.sources[].name"]')
        ?.getAttribute('data-value-state'),
      buildTime: document.querySelector('[data-nullable-input="buildTimeDays"]')
        ?.getAttribute('data-value-state'),
    }));

    assert.ok(text.includes('(unnamed source) +5%'));
    assert.ok(text.includes('Known Org bonus unavailable'));
    assert.ok(text.includes('1 MC · build n/a'));
    assert.ok(!text.includes('null +5%'));
    assert.equal(states.source, 'absent');
    assert.equal(states.buildTime, 'absent');
    assertNoPlaceholderText(html, 'nullable bonus source');
  });
});

test('the board uses shared measured, estimated, table, Value, and truncation primitives', async () => {
  await withMiningExpansionHarnessPage(fixture('player'), async (page) => {
    const primitives = await page.evaluate(() => ({
      measured: document.querySelectorAll('[data-primitive="measured"][data-register="mining"]').length,
      estimated: document.querySelectorAll('[data-primitive="estimated"][data-register="mining"]').length,
      tables: document.querySelectorAll('[data-primitive="data-table"][data-variant="mining"]').length,
      values: document.querySelectorAll('[data-primitive="value"]').length,
      truncations: [...document.querySelectorAll('[data-primitive="truncation-note"]')]
        .map((element) => ({ state: element.dataset.truncationState, text: element.textContent.trim() })),
    }));

    assert.ok(primitives.measured > 0);
    assert.ok(primitives.estimated > 0);
    assert.equal(primitives.tables, 2);
    assert.ok(primitives.values > 0);
    assert.deepEqual(primitives.truncations, [
      { state: 'truncated', text: 'Top 5 of 9 available upgrades shown.' },
      { state: 'truncated', text: 'Top 8 of 85, ranked by saturating utility per unit of alien hate' },
    ]);
  });
});

test('over-limit and unresolved projections never collapse unknown hate or upgrade costs to zero', async () => {
  const payload = clone(fixture('player'));
  payload.capacity = {
    ...payload.capacity,
    minesBuilt: 25,
    mineLimit: 21,
    headroom: 0,
    overLimit: true,
    penaltyMC: 8,
    penaltyHate: null,
    marginalNextMinePenaltyMC: 4,
    marginalNextMinePenaltyHate: null,
    baseHateMultiplier: null,
    hateCostAvailable: false,
  };
  payload.mineModuleCapability = {
    available: false,
    unavailableReason: 'the completed-project list could not be read',
    projectedMultiplierRange: null,
  };
  payload.mineUpgrades = {
    ...payload.mineUpgrades,
    totalMonthlyGainMeasured: false,
  };
  payload.available = payload.available.slice(0, 1).map((candidate) => ({
    ...candidate,
    hateCost: null,
    moduleMultiplier: { ...candidate.moduleMultiplier, projectedRangeAvailable: false },
  }));
  payload.availableTotalCount = 1;

  await withMiningExpansionHarnessPage(payload, async (page) => {
    const html = await getHarnessHtml(page);
    const text = await getHarnessText(page);

    assert.ok(text.includes('OVER LIMIT (+8 MC / HATE UNAVAILABLE)'));
    assert.ok(text.includes('HATE UNKNOWN'));
    assert.ok(text.includes('Mine module multiplier: UNKNOWN'));
    assert.ok(text.includes('UPGRADE HEADROOM UNRESOLVED'));
    assert.ok(!text.includes('+0 HATE'));
    assert.ok(!text.includes('×1 to ×1'));
    assertNoPlaceholderText(html, 'over-limit unresolved payload');
  });
});
