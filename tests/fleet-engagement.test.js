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

// ---------------------------------------------------------------------------
// 8. PER-METRIC MEASUREMENT STATE — THE PROPERTY <Value> EXISTS TO PROVIDE
//
// Added with the #21 conversion, and it did not exist before it: this file
// carried no `data-value-state` assertion of any kind, which is exactly how a
// sibling panel's conversion shipped with per-metric state CASCADING across
// rows -- nulling one faction's metric turned unrelated metrics on other rows
// unavailable, and nothing failed.
//
// Every figure must resolve its own presence from its own input. These tests
// pin that by CONSTRUCTION: four rows built from one source row, each nulling
// exactly one metric, so any coupling between metrics or between rows shows up
// as a state that moved on a row nothing was done to.
// ---------------------------------------------------------------------------

/** Per-row, per-column `data-value-state` for every stamped figure. */
async function readRowStates(page) {
  return page.evaluate(() => {
    const cellStates = (row, cls) => [...row.querySelectorAll(`.${cls} [data-value-state]`)]
      .map((el) => `${el.getAttribute('data-value-state')}:${el.textContent.trim()}`);
    return [...document.querySelectorAll('.fe-row')].map((row) => ({
      fleet: cellStates(row, 'fe-cell--fleet'),
      ships: cellStates(row, 'fe-cell--mass'),
      reach: cellStates(row, 'fe-cell--reach'),
      estimate: [...row.querySelectorAll('.fe-cell--estimate [data-value-state]')]
        .map((el) => `${el.getAttribute('data-value-state')}:${el.textContent.trim()}`),
    }));
  });
}

test('fleet-engagement per-metric: nulling one metric on one row moves no other metric on any row', async () => {
  const payload = loadEngagementFixture('omniscient');
  const source = JSON.parse(JSON.stringify(payload.items[0]));
  const clone = (name, mutate) => {
    const row = JSON.parse(JSON.stringify(source));
    row.fleetId = name;
    row.fleetName = name;
    mutate(row);
    return row;
  };

  payload.items = [
    clone('ROW-ALL-PRESENT', () => {}),
    clone('ROW-SHIPS-NULL', (row) => { row.shipsCount = null; }),
    clone('ROW-TYPES-NULL', (row) => { row.distinctHullTypes = null; }),
    clone('ROW-FIELD-NULL', (row) => {
      row.fieldable = { ...row.fieldable, hullsAtEngagementPoint: null };
    }),
  ];

  await withFleetEngagementHarnessPage(payload, async (page) => {
    const rows = await readRowStates(page);
    assert.strictEqual(rows.length, 4, 'all four rows must render');

    const [allPresent, shipsNull, typesNull, fieldNull] = rows;

    // The baseline row measures both mass figures.
    assert.deepStrictEqual(
      allPresent.ships.map((s) => s.split(':')[0]),
      ['measured', 'measured'],
      'the untouched row must measure both its ship count and its hull-type count'
    );

    // Ship count absent on ONE row; the hull-type count beside it is untouched.
    assert.strictEqual(shipsNull.ships[0].split(':')[0], 'absent',
      'the nulled ship count must be absent');
    assert.strictEqual(shipsNull.ships[1], allPresent.ships[1],
      'nulling the ship count must NOT change the hull-type count in the same cell');

    // And the mirror case: the hull-type count absent leaves the ship count.
    assert.strictEqual(typesNull.ships[1].split(':')[0], 'absent',
      'the nulled hull-type count must be absent');
    assert.strictEqual(typesNull.ships[0], allPresent.ships[0],
      'nulling the hull-type count must NOT change the ship count in the same cell');

    // Across rows: neither mutation may reach a different row. The ship count
    // nulled on row 1 must still be measured on rows 2 and 3, and the hull-type
    // count nulled on row 2 must still be measured on rows 1 and 3.
    assert.strictEqual(typesNull.ships[0], allPresent.ships[0],
      'row 2 must keep the ship count row 1 nulled');
    assert.strictEqual(fieldNull.ships[0], allPresent.ships[0],
      'row 3 must keep the ship count row 1 nulled');
    assert.strictEqual(shipsNull.ships[1], allPresent.ships[1],
      'row 1 must keep the hull-type count row 2 nulled');
    assert.strictEqual(fieldNull.ships[1], allPresent.ships[1],
      'row 3 must keep the hull-type count row 2 nulled');
    assert.deepStrictEqual(fieldNull.ships, allPresent.ships,
      'a fieldable metric nulled on this row must not touch this row\'s mass figures');

    // Every row's reachability and requirement are identical, because nothing
    // any mutation touched feeds them.
    for (const [label, row] of [['ships', shipsNull], ['types', typesNull], ['field', fieldNull]]) {
      assert.deepStrictEqual(row.reach, allPresent.reach,
        `the ${label} mutation must not move the reachability column`);
    }
    assert.deepStrictEqual(shipsNull.estimate, allPresent.estimate,
      'the ship-count mutation must not move the estimate columns');
    assert.deepStrictEqual(typesNull.estimate, allPresent.estimate,
      'the hull-type mutation must not move the estimate columns');

    // The fieldable mutation moves exactly one figure, and only on its own row.
    const movedOnFieldRow = fieldNull.estimate
      .filter((state, i) => state !== allPresent.estimate[i]);
    assert.strictEqual(movedOnFieldRow.length, 1,
      `nulling hullsAtEngagementPoint must move exactly one figure, moved: ${JSON.stringify(movedOnFieldRow)}`);
    assert.strictEqual(movedOnFieldRow[0].split(':')[0], 'absent');
    assert.deepStrictEqual(shipsNull.estimate, typesNull.estimate,
      'and it must not have reached the rows it was not applied to');
  });
});

test('fleet-engagement stamps every absent affordance rather than printing a bare em dash', async () => {
  // The whole point of #21: a reader sees the right glyph either way, and only
  // `data-value-state` lets a test tell "we measured nothing" from "we rendered
  // nothing". Prose em dashes (the banner, the ordering line, the verdict word
  // "WITHHELD — UNREACHABLE") are punctuation, not affordances, and are exempt.
  const payload = loadEngagementFixture('player');
  payload.ownForce = {
    ...payload.ownForce, totalHulls: null, fleetCount: null, bestDesignName: null, rating: null,
  };
  // Between them the two rows reach every branch that can print the dash: the
  // two mass figures, the fleet's own location, the requirement cell with no
  // band, and the fieldable line with one side unmeasured.
  payload.items = payload.items.slice(0, 2).map((row, index) => {
    const copy = JSON.parse(JSON.stringify(row));
    if (index === 0) {
      copy.shipsCount = null;
      copy.distinctHullTypes = null;
      copy.orbitBody = null;
    } else {
      copy.fieldable = { ...copy.fieldable, hullsAtEngagementPoint: null };
      copy.requirement = { ...copy.requirement, bandLabel: null };
      copy.engagementPoint = null;
    }
    return copy;
  });

  await withFleetEngagementHarnessPage(payload, async (page) => {
    const audit = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="fleet-engagement-harness"]');
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const unstamped = [];
      let stamped = 0;
      let node = walker.nextNode();
      while (node) {
        if (node.textContent.includes('—')) {
          const host = node.parentElement;
          const prose = host.closest('.fe-banner, .fe-ordered, .fe-th, .fe-footnote');
          if (host.closest('[data-value-state]')) stamped += 1;
          else if (!prose) unstamped.push(host.className + ' :: ' + node.textContent.trim());
        }
        node = walker.nextNode();
      }
      return {
        unstamped,
        stamped,
        absent: root.querySelectorAll('[data-value-state="absent"]').length,
        measured: root.querySelectorAll('[data-value-state="measured"]').length,
      };
    });

    assert.deepStrictEqual(audit.unstamped, [],
      'every em dash a reader sees must sit inside a node <Value> stamped');
    assert.ok(audit.absent >= 7,
      `the six nulled own-force/row figures must each report absent, got ${audit.absent}`);
    assert.ok(audit.measured > 20,
      `and the measured figures must still be stamped measured, got ${audit.measured}`);
  });
});

test('fleet-engagement renders a floor band verbatim and never collapses it to a point value', async () => {
  // register #13: a p20-p80 band rendered as though it were the whole
  // uncertainty. `bandLabel` already carries the span, and a partly rateable
  // fleet prefixes it "at least " because the rating behind it covers only part
  // of the opponent. Both must survive the render.
  const snapshot = syntheticSnapshot({
    observerBody: 'Mars',
    alienFleets: [hostileFleet({ orbitBody: 'Mars', weapons: [6, null, 6] })],
  });
  const payload = buildFleetEngagement(snapshot, { observerId: OBSERVER, mode: 'player' });
  const row = payload.items[0];
  assert.strictEqual(row.requirement.isLowerBound, true);
  assert.match(row.requirement.bandLabel, /^at least \d+(–\d+)? hulls?$/,
    `the model must hand the panel a labelled floor, got "${row.requirement.bandLabel}"`);

  await withFleetEngagementHarnessPage(payload, async (page) => {
    const need = await page.evaluate(() => {
      const cell = document.querySelector('.fe-cell--estimate .fe-need');
      const band = cell.querySelector('[data-value-state]');
      return { text: cell.textContent, band: band.textContent.trim(), state: band.getAttribute('data-value-state') };
    });
    assert.strictEqual(need.band, row.requirement.bandLabel,
      'the band must render byte-for-byte as the model emitted it');
    assert.ok(need.band.startsWith('at least '),
      `a floor must still read as a floor, got "${need.band}"`);
    assert.strictEqual(need.state, 'measured');
    assert.ok(need.text.includes('MODELLED BAND'));

    // The composition title says WHY it is a floor, and names both halves.
    const title = await page.evaluate(() => document.querySelector('.fe-cell--mass [title]').getAttribute('title'));
    assert.match(title, /of \d+ ships could be rated, so the requirement is a floor/,
      `the floor must explain itself, got "${title}"`);
  });
});

test('fleet-engagement reports a beyond-ceiling requirement as a floor, not as unwinnable', async () => {
  // register #14: `winnable: false` means "above the ceiling I swept", NEVER
  // "cannot be won". The row must publish the floor the model computed.
  // Omniscient, because that is the mode whose opponent rating is the alien
  // designs' own combat values rather than a multiple of the observer's hull —
  // in player mode the ratio cannot outrun the invented multipliers.
  const snapshot = syntheticSnapshot({
    observerBody: 'Mars',
    observerDesignCv: 10,
    alienDesigns: [{
      factionId: ALIEN,
      hullName: 'AlienHull0',
      dataName: 'AlienHull0',
      _displayName: 'Leviathan',
      _unnormalizedCombatValue: 1000000,
    }],
    alienFleets: [hostileFleet({ orbitBody: 'Mars', shipsCount: 1, weapons: [9] })],
  });
  const payload = buildFleetEngagement(snapshot, { observerId: OBSERVER, mode: 'omniscient' });
  const row = payload.items[0];
  assert.strictEqual(row.requirement.verdict, ENGAGEMENT_VERDICTS.beyondModelledRange,
    `expected the ceiling branch, got ${row.requirement.verdict}`);
  assert.strictEqual(row.requirement.isLowerBound, true);

  await withFleetEngagementHarnessPage(payload, async (page) => {
    const text = await getHarnessText(page);
    assert.ok(text.includes(row.requirement.bandLabel),
      `the floor must render, expected "${row.requirement.bandLabel}"`);
    assert.ok(text.includes('BEYOND MODELLED RANGE'), 'and be captioned as a ceiling report');
    assert.ok(!/\bUNWINNABLE\b/.test(text),
      'a ceiling report must never be rendered as an impossibility verdict');
  });
});
