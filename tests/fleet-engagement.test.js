// tests/fleet-engagement.test.js
//
// Purpose: characterisation tests for the per-fleet engagement estimates React
//   panel. Drives a real browser through the primitives harness (see mc-budget).

const { test } = require('node:test');
const assert = require('node:assert');
const {
  withFleetEngagementHarnessPage,
  getHarnessHtml,
  getHarnessText,
  visibleText,
} = require('./fixtures/fleetEngagementBrowser');
const { loadFixtureFilteredSnapshot } = require('./fixtures/frozenSnapshots');
const {
  buildFleetEngagement,
  ENGAGEMENT_VERDICTS,
  FLEET_REACHABILITY_STATES,
} = require('../shared/fleetEngagement.mjs');

const OBSERVER = 4712;
const ALIEN = 4717;
const FORBIDDEN = ['null', 'undefined', 'NaN', '[object Object]'];

function assertNoPlaceholderText(html, label) {
  const text = visibleText(html);
  for (const token of FORBIDDEN) {
    const index = text.indexOf(token);
    assert.strictEqual(
      index,
      -1,
      `${label}: rendered text contains "${token}" near: ${text.slice(Math.max(0, index - 60), index + 60)}`
    );
  }
}

function loadEngagementFixture(mode, options = {}) {
  const snapshot = loadFixtureFilteredSnapshot({ mode, observer: OBSERVER });
  return buildFleetEngagement(snapshot, { observerId: OBSERVER, mode, limit: 12, ...options });
}

const alienShip = (id, weapons, hullName) => ({
  id,
  displayName: `Hostile ${id}`,
  hullName,
  weaponLoadout: weapons === null ? [] : [{ role: 'Laser', category: 'Laser', count: weapons, systems: ['x'] }],
  armorMedian: 5,
});

function syntheticSnapshot({
  observerDeltaV = 50,
  observerShips = 6,
  alienFleets = [],
  alienDesigns = [],
  observerDesignCv = 10000,
  observerBody = 'Mars',
} = {}) {
  return {
    snapshotId: 'synthetic-engagement-browser',
    metadata: { gameTimeString: '1/1/2035 12:00:00 AM' },
    factions: [
      { ID: OBSERVER, displayName: 'the Initiative' },
      { ID: ALIEN, displayName: 'the Aliens' },
    ],
    habs: [{ ID: 900, factionId: OBSERVER, displayName: 'Home', orbitBody: observerBody }],
    shipDesigns: [
      ...(observerDesignCv === null ? [] : [{
        factionId: OBSERVER,
        hullName: 'OwnHull',
        _displayName: 'Own Best',
        dataName: 'ownDesign1',
        _unnormalizedCombatValue: observerDesignCv,
      }]),
      ...alienDesigns,
    ],
    fleets: [
      {
        ID: 1,
        displayName: 'Own Fleet',
        factionId: OBSERVER,
        shipsCount: observerShips,
        orbitBody: observerBody,
        spaceTheaterKey: 'inner',
        lowestDeltaVKps: observerDeltaV,
        lowestCombatAccelerationMps2: 2,
        ships: Array.from({ length: observerShips }, (_, i) => ({
          id: 100 + i,
          hullName: 'OwnHull',
          weaponLoadout: [{ role: 'Laser', category: 'Laser', count: 3, systems: ['x'] }],
          armorMedian: 3,
        })),
      },
      ...alienFleets,
    ],
  };
}

const hostileFleet = ({
  ID = 50,
  shipsCount = 3,
  orbitBody = 'Titan',
  destination = null,
  weapons = [3, 3, 3],
} = {}) => ({
  ID,
  displayName: `Victor-${ID}`,
  factionId: ALIEN,
  shipsCount,
  orbitBody,
  destination,
  spaceTheaterKey: 'saturn',
  lowestDeltaVKps: 100,
  lowestCombatAccelerationMps2: 10,
  ships: weapons.map((w, i) => alienShip(200 + i, w, `AlienHull${i}`)),
});

// ---------------------------------------------------------------------------
// 1. NORMAL RENDER — BOTH MODES
// ---------------------------------------------------------------------------

for (const mode of ['player', 'omniscient']) {
  test(`fleet-engagement renders ${mode} fixture with board structure and summary`, async () => {
    const payload = loadEngagementFixture(mode);
    assert.ok(payload.available, payload.reason || 'fixture must produce engagement estimates');

    await withFleetEngagementHarnessPage(payload, async (page) => {
      const html = await getHarnessHtml(page);
      const text = await getHarnessText(page);

      assert.ok(html.includes('fe-board'), 'board wrapper must be present');
      assert.ok(text.includes('ESTIMATE'), 'banner tag must be present');
      assert.ok(text.includes('Hull bands are a MODEL'), 'model disclaimer must be present');
      assert.ok(text.includes('OWN FORCE'), 'own force summary must be present');
      assert.ok(text.includes('HOSTILE FLEETS'), 'hostile fleet summary must be present');
      assert.ok(text.includes('SHOWING'), 'showing summary must be present');
      assert.ok(text.includes('ORDERED BY THREAT TO OBSERVER ASSETS'), 'ordering line must be present');
      assert.ok(html.includes('fe-table'), 'fleet table must be present');
      assert.ok(text.includes('Swipe horizontally to inspect all columns'), 'scroll hint must match legacy copy');

      assert.ok(text.includes(`${payload.items.length} of ${payload.fleetsTotalCount}`),
        'showing count must reconcile with payload');
      if (payload.fleetsOmittedCount > 0) {
        assert.ok(text.includes(`${payload.fleetsOmittedCount} ranked lower and omitted`),
          'omitted fleets must be announced');
      } else {
        assert.ok(text.includes('every tracked fleet shown'),
          'complete list must say every tracked fleet shown');
      }

      const first = payload.items[0];
      assert.ok(text.includes(first.fleetName), 'first fleet name must render');
      assert.ok(text.includes(String(first.shipsCount)), 'first fleet ship count must render');

      assertNoPlaceholderText(html, `${mode} normal render`);
    });
  });
}

// ---------------------------------------------------------------------------
// 2. EMPTY AND ABSENT INPUT
// ---------------------------------------------------------------------------

test('fleet-engagement handles null fetch result with endpoint-unavailable message', async () => {
  await withFleetEngagementHarnessPage(null, async (page) => {
    const text = await getHarnessText(page);
    assert.ok(text.includes('ENGAGEMENT ESTIMATES UNAVAILABLE'));
    assert.ok(text.includes('endpoint could not be read'));
  });
});

test('fleet-engagement handles unavailable payload with reason', async () => {
  await withFleetEngagementHarnessPage({
    available: false,
    reason: 'no default rating is substituted for the observer best design',
  }, async (page) => {
    const text = await getHarnessText(page);
    assert.ok(text.includes('NO ENGAGEMENT ESTIMATE'));
    assert.ok(text.includes('no default rating is substituted'));
  });
});

test('fleet-engagement handles unavailable payload without reason', async () => {
  await withFleetEngagementHarnessPage({ available: false }, async (page) => {
    const text = await getHarnessText(page);
    assert.ok(text.includes('NO ENGAGEMENT ESTIMATE — reason unavailable'));
  });
});

test('fleet-engagement renders empty items table message', async () => {
  const payload = loadEngagementFixture('omniscient');
  payload.items = [];

  await withFleetEngagementHarnessPage(payload, async (page) => {
    const text = await getHarnessText(page);
    assert.ok(text.includes('No hostile fleet could be estimated in this intelligence picture.'));
  });
});

// ---------------------------------------------------------------------------
// 3. MEASURED VS ESTIMATED REGISTERS (COMPUTED STYLE)
// ---------------------------------------------------------------------------

test('fleet-engagement measured and estimated registers differ by computed style on live rows', async () => {
  const payload = loadEngagementFixture('player');

  await withFleetEngagementHarnessPage(payload, async (page) => {
    const styles = await page.evaluate(() => {
      const meas = document.querySelector('.fe-meas__value');
      const est = document.querySelector('.fe-est__value');
      if (!meas || !est) return null;
      const measStyle = getComputedStyle(meas);
      const estStyle = getComputedStyle(est);
      return {
        measFontStyle: measStyle.fontStyle,
        estFontStyle: estStyle.fontStyle,
        measClass: meas.className,
        estClass: est.className,
      };
    });

    assert.ok(styles, 'panel must render both measured and estimated value cells');
    assert.strictEqual(styles.measFontStyle, 'normal', 'measured register must be upright');
    assert.strictEqual(styles.estFontStyle, 'italic', 'estimated register must be italic');
    assert.match(styles.measClass, /fe-meas__value/);
    assert.match(styles.estClass, /fe-est__value/);
  });
});

test('fleet-engagement co-located reachability uses measured register, not estimated', async () => {
  const snapshot = syntheticSnapshot({
    observerBody: 'Mars',
    alienFleets: [hostileFleet({ orbitBody: 'Mars' })],
  });
  const payload = buildFleetEngagement(snapshot, { observerId: OBSERVER, mode: 'player' });

  await withFleetEngagementHarnessPage(payload, async (page) => {
    const reachCell = await page.evaluate(() => {
      const cell = document.querySelector('.fe-reach');
      const primary = cell?.querySelector('.fe-meas__value, .fe-est__text');
      if (!primary) return null;
      return {
        className: primary.className,
        fontStyle: getComputedStyle(primary).fontStyle,
        text: primary.textContent.trim(),
      };
    });

    assert.ok(reachCell, 'reachability cell must render');
    assert.strictEqual(reachCell.text, 'CO-LOCATED');
    assert.match(reachCell.className, /fe-meas__value/);
    assert.strictEqual(reachCell.fontStyle, 'normal');
  });
});

// ---------------------------------------------------------------------------
// 4. VERDICT AND REACHABILITY BRANCHES
// ---------------------------------------------------------------------------

test('fleet-engagement withholds hull count for beyond-delta-v fleets', async () => {
  const snapshot = syntheticSnapshot({
    observerDeltaV: 1.0,
    observerBody: 'Mars',
    alienFleets: [hostileFleet({ orbitBody: 'Titan' })],
  });
  const payload = buildFleetEngagement(snapshot, { observerId: OBSERVER, mode: 'player' });
  const row = payload.items[0];
  assert.strictEqual(row.requirement.verdict, ENGAGEMENT_VERDICTS.withheldUnreachable);

  await withFleetEngagementHarnessPage(payload, async (page) => {
    const needCell = await page.evaluate(() => {
      const cell = document.querySelector('.fe-cell--estimate .fe-need');
      return cell ? cell.textContent : '';
    });
    assert.ok(needCell.includes('WITHHELD'), `requirement cell must name withheld verdict: ${needCell}`);
    assert.ok(!/\d+\s*hulls?/i.test(needCell),
      `withheld cell must not publish a hull count: ${needCell}`);
    const text = await getHarnessText(page);
    assert.ok(text.includes('BEYOND ΔV'), 'beyond delta-v reachability must render');
  });
});

test('fleet-engagement renders band label when requirement is modelled', async () => {
  const snapshot = syntheticSnapshot({
    observerBody: 'Mars',
    alienFleets: [hostileFleet({ orbitBody: 'Mars', shipsCount: 2, weapons: [4, 4] })],
  });
  const payload = buildFleetEngagement(snapshot, { observerId: OBSERVER, mode: 'player' });
  const row = payload.items[0];
  assert.strictEqual(row.requirement.verdict, ENGAGEMENT_VERDICTS.band);
  assert.ok(row.requirement.bandLabel);

  await withFleetEngagementHarnessPage(payload, async (page) => {
    const text = await getHarnessText(page);
    assert.ok(text.includes(row.requirement.bandLabel), 'band label must render');
    assert.ok(text.includes('MODELLED BAND'), 'band verdict caption must render');
  });
});

test('fleet-engagement announces omitted count unknown when fleetsOmittedCount is unread', async () => {
  const payload = loadEngagementFixture('player');
  payload.fleetsOmittedCount = null;

  await withFleetEngagementHarnessPage(payload, async (page) => {
    const text = await getHarnessText(page);
    assert.ok(text.includes('omitted count not read — list may be incomplete'),
      'unread omitted count must not read as every tracked fleet shown');
    assert.ok(!text.includes('every tracked fleet shown'));
  });
});

// ---------------------------------------------------------------------------
// 5. PLAYER VS OMNISCIENT — BOTH RENDER, NOT MISSING
// ---------------------------------------------------------------------------

test('player and omniscient modes both render engagement estimates from fixtures', async () => {
  const player = loadEngagementFixture('player');
  const omniscient = loadEngagementFixture('omniscient');

  assert.ok(player.available && omniscient.available);
  assert.strictEqual(player.fleetsTotalCount, omniscient.fleetsTotalCount);

  let playerText;
  let omniscientText;

  await withFleetEngagementHarnessPage(player, async (page) => {
    playerText = await getHarnessText(page);
  });
  await withFleetEngagementHarnessPage(omniscient, async (page) => {
    omniscientText = await getHarnessText(page);
  });

  assert.ok(playerText.includes('ESTIMATE'));
  assert.ok(omniscientText.includes('ESTIMATE'));
  assert.notStrictEqual(playerText, omniscientText,
    'player and omniscient must not byte-match — different rating basis');
});

// ---------------------------------------------------------------------------
// 6. THREAT ROW MODIFIER
// ---------------------------------------------------------------------------

test('fleet-engagement marks asset-threatening fleets with fe-row--threat', async () => {
  const snapshot = syntheticSnapshot({
    observerBody: 'Mars',
    alienFleets: [hostileFleet({ orbitBody: 'Sol', destination: 'Mars orbit' })],
  });
  const payload = buildFleetEngagement(snapshot, { observerId: OBSERVER, mode: 'player' });
  assert.strictEqual(payload.items[0].threatensObserverAsset, true);

  await withFleetEngagementHarnessPage(payload, async (page) => {
    const html = await getHarnessHtml(page);
    assert.ok(html.includes('fe-row--threat'), 'threatening fleet row must carry threat modifier');
  });
});

// ---------------------------------------------------------------------------
// 7. REACHABILITY UNKNOWN STILL SHOWS ESTIMATE
// ---------------------------------------------------------------------------

test('fleet-engagement unknown reachability still renders a requirement band', async () => {
  const snapshot = syntheticSnapshot({
    observerDeltaV: null,
    observerBody: 'Mars',
    alienFleets: [hostileFleet({ orbitBody: 'Titan' })],
  });
  const payload = buildFleetEngagement(snapshot, { observerId: OBSERVER, mode: 'player' });
  const row = payload.items[0];
  assert.strictEqual(row.reachability.state, FLEET_REACHABILITY_STATES.unknown);
  assert.strictEqual(row.requirement.verdict, ENGAGEMENT_VERDICTS.band);

  await withFleetEngagementHarnessPage(payload, async (page) => {
    const text = await getHarnessText(page);
    assert.ok(text.includes('REACH UNKNOWN'));
    assert.ok(text.includes(row.requirement.bandLabel));
  });
});
