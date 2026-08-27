// tests/theaterDefenceRendering.test.js
//
// Purpose: mounts the theater-defence panel through the SAME path the real shell
//   uses and proves a render throw fails the suite. tests/theaterDefencePanel.test.js
//   exercises the formatters under plain Node but NEVER mounts React -- and that
//   is exactly the gap that let HostileMovementPanel ship with an unregistered
//   DataTable variant: `tableClassNames` throws on an unknown variant BY DESIGN,
//   the mount rendered zero characters with a console TypeError, and `npm test`
//   was green throughout.
//
//   This file closes the same gap for #theaterDefence: the harness scene renders
//   <TheaterDefencePanel> into the shell's mount id, and the tests also drive the
//   exact bridge call mission-control.js makes:
//
//     window.MissionControlTheaterDefence.render(container, { engineDirectives })
//
//   A throw from either path surfaces as a pageerror (collected by the fixture)
//   and as a mount that never fills, so the assertions below go red.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  withTheaterDefenceHarnessPage,
  getHarnessHtml,
  getHarnessText,
} = require('./fixtures/theaterDefenceBrowser.js');

const SHARED_CITATIONS = [
  { source: 'intel/theaters', field: 'incoming.hostileShips' },
  { source: 'intel/theaters', field: 'incoming.hostileFleets' },
  { source: 'intel/theaters', field: 'incoming.nearestArrivalDays' },
  { source: 'intel/theaters', field: 'incoming.arrivalTimingKnown' },
  { source: 'intel/theaters', field: 'hostile.ships' },
  { source: 'intel/theaters', field: 'friendly.ships' },
  { source: 'intel/theaters', field: 'friendly.shipyards' },
  { source: 'intel/theaters', field: 'production.shipsCompletingBeforeThreatArrival' },
  { source: 'intel/theaters', field: 'hostileMovement.reconciles' },
];

// Shaped after the live board (observer 4712, 20 Oct 2042): one BUILD row whose
// race lands first, one quiet HOLD row with nothing inbound, and one refusal row
// whose arrival could not be timed.
const BOARD = {
  available: true,
  unavailableReason: null,
  state: 'INBOUND_TO_TRACKED_THEATER',
  findings: [
    {
      id: 'theater-defence:mercury',
      body: 'Mercury',
      spaceTheaterKey: null,
      theaterStatus: 'THREAT_IMMINENT',
      posture: 'BUILD',
      threat: {
        hostileShips: 105,
        hostileFleets: 1,
        presentHostileShips: 24,
        presentHostileFleets: 17,
        nearestArrivalDays: 24,
        nearestArrivalDate: '2042-11-13T00:00:00.000Z',
        arrivalTimingKnown: true,
      },
      friendly: {
        ships: 30,
        shipyards: 12,
        habs: 3,
        mines: 2,
        shipsCompletingBeforeThreatArrival: 0,
        completionBasis: 'measured against the nearest inbound arrival',
      },
      buildRace: {
        hullName: 'Gunship',
        shipyardId: 315317,
        available: true,
        verdict: 'build-lands-first',
        marginDays: 15,
        buildDays: 9,
        daysUntilArrival: 24,
        reason: null,
      },
      refusals: [],
      citations: [
        ...SHARED_CITATIONS,
        { source: 'engine/military', field: 'buildOptions[].fastestDays' },
        { source: 'engine/military', field: 'buildOptions[].shipyardId' },
        { source: 'shared/shipBuildTime', field: 'buildBeatsArrival.verdict' },
      ],
    },
    {
      id: 'theater-defence:earth',
      body: 'Earth',
      spaceTheaterKey: null,
      theaterStatus: 'CONTESTED',
      posture: 'HOLD',
      threat: {
        hostileShips: 0,
        hostileFleets: 0,
        presentHostileShips: 4,
        presentHostileFleets: 3,
        nearestArrivalDays: null,
        nearestArrivalDate: null,
        arrivalTimingKnown: null,
      },
      friendly: {
        ships: 30,
        shipyards: 5,
        habs: 1,
        mines: 0,
        shipsCompletingBeforeThreatArrival: 0,
        completionBasis: 'measured against the nearest inbound arrival',
      },
      buildRace: null,
      refusals: [],
      citations: [...SHARED_CITATIONS],
    },
    {
      id: 'theater-defence:io',
      body: 'Io',
      spaceTheaterKey: null,
      theaterStatus: 'THREAT_INBOUND_ARRIVAL_UNKNOWN',
      posture: 'CANNOT_ADVISE',
      threat: {
        hostileShips: 12,
        hostileFleets: 2,
        presentHostileShips: 0,
        presentHostileFleets: 0,
        nearestArrivalDays: null,
        nearestArrivalDate: null,
        arrivalTimingKnown: false,
      },
      friendly: {
        ships: 0,
        shipyards: 0,
        habs: 0,
        mines: 0,
        shipsCompletingBeforeThreatArrival: null,
        completionBasis: null,
      },
      buildRace: null,
      refusals: [
        {
          check: 'threat-imminence',
          reason: '2 inbound hostile fleet(s) carry no arrival date on record, so the imminence '
            + 'test cannot be run -- an unknown arrival is not a distant one',
        },
      ],
      citations: [...SHARED_CITATIONS],
    },
  ],
  findingsTotalCount: 3,
  findingsOmittedCount: 0,
  offBoardNote: '11 hostile transfer(s) carrying 72 ship(s) are aimed at bodies this '
    + 'twelve-body board does not track.',
  notes: [
    'No force-strength comparison is made here.',
    'The build race is run against the FASTEST hull each body\'s own yards can lay down.',
  ],
};

test('the panel mounts without throwing and fills the shell mount', async () => {
  await withTheaterDefenceHarnessPage(BOARD, async (page, { pageErrors }) => {
    const html = await getHarnessHtml(page);
    assert.deepEqual(
      pageErrors.map((e) => e.message),
      [],
      'a render throw (an unregistered DataTable variant is the one that has shipped here) '
        + 'must fail this test rather than leaving a silent empty mount'
    );
    assert.ok(html.length > 0, '#theaterDefence rendered zero characters');
    // `data-primitive` is the panel's own token here rather than Panel's
    // "panel": the props spread lands after Panel writes its default, which is
    // the same shape HostileMovementPanel carries.
    assert.match(html, /data-primitive="theater-defence"/);
    assert.match(html, /class="tech-card/, 'the panel must use the shared <Panel> chrome');
    assert.match(html, /data-variant="theater-defence"/);
  });
});

test('the BUILD row names the hull, the verdict and the margin', async () => {
  await withTheaterDefenceHarnessPage(BOARD, async (page) => {
    const row = await page.evaluate(() => {
      const el = document.querySelector('.td-row[data-body="Mercury"]');
      return el ? el.textContent : null;
    });
    assert.ok(row, 'the Mercury row must render');
    assert.match(row, /BUILD/);
    assert.match(row, /BUILD LANDS FIRST/);
    assert.match(row, /Gunship/, 'the race uses the FASTEST hull, so it must be named beside the margin');
    assert.match(row, /yard 315317/);
    assert.match(row, /9 days/);
    assert.match(row, /\+15 days/);
    assert.match(row, /24 days/);
  });
});

test('nothing inbound and an unknown arrival render as different claims', async () => {
  await withTheaterDefenceHarnessPage(BOARD, async (page) => {
    const states = await page.evaluate(() => {
      const read = (body) => {
        const row = document.querySelector(`.td-row[data-body="${body}"]`);
        const cell = row && row.querySelector('.td-contact');
        return cell ? { state: cell.dataset.contactState, text: cell.textContent.trim() } : null;
      };
      return { earth: read('Earth'), io: read('Io'), mercury: read('Mercury') };
    });

    assert.equal(states.earth.state, 'nothing-inbound');
    assert.equal(states.earth.text, 'nothing inbound');
    assert.doesNotMatch(states.earth.text, /unknown/i,
      'arrivalTimingKnown is null, not false, when nothing is inbound — those are different claims');

    assert.equal(states.io.state, 'unknown');
    assert.match(states.io.text, /arrival time unknown/);

    assert.equal(states.mercury.state, 'measured');
    assert.match(states.mercury.text, /24 days/);
  });
});

test('absent readings carry the Value presence signal rather than a hand-written glyph', async () => {
  await withTheaterDefenceHarnessPage(BOARD, async (page) => {
    const report = await page.evaluate(() => {
      const root = document.querySelector('#theaterDefence');
      const values = [...root.querySelectorAll('[data-primitive="value"]')];
      const earth = document.querySelector('.td-row[data-body="Earth"] .td-contact [data-primitive="value"]');
      // Defect #21 in docs/live-defect-register.md is a hand-written absent
      // AFFORDANCE — an element standing in for a missing reading whose whole
      // content is a dash or an "n/a". Prose that happens to contain an em dash
      // is not that, so the probe looks for the standalone marker, not for the
      // character anywhere in the subtree.
      const ABSENT_MARKERS = ['—', '-', '--', 'n/a', 'N/A', 'null', 'undefined'];
      const strayDash = [...root.querySelectorAll('td, th, span, small, strong, li, p, div')]
        .filter((el) => !el.closest('[data-primitive="value"]'))
        .some((el) => ABSENT_MARKERS.includes(el.textContent.trim()));
      return {
        valueCount: values.length,
        measured: values.filter((v) => v.dataset.valueState === 'measured').length,
        absent: values.filter((v) => v.dataset.valueState === 'absent').length,
        earthState: earth ? earth.dataset.valueState : null,
        strayDash,
      };
    });

    assert.ok(report.valueCount > 0, 'every figure must go through <Value>');
    assert.ok(report.measured > 0);
    assert.ok(report.absent > 0, 'the absent readings on this board must be marked absent, not zero');
    assert.equal(report.earthState, 'absent');
    assert.equal(report.strayDash, false, 'no hand-written em dash outside <Value> (defect #21)');
  });
});

test('a refusal renders as content, with the check named and the reason kept', async () => {
  await withTheaterDefenceHarnessPage(BOARD, async (page) => {
    const refusals = await page.evaluate(() => {
      const detail = document.querySelector('[data-detail-for="theater-defence:io"]');
      const items = detail ? [...detail.querySelectorAll('.td-refusals__item')] : [];
      return items.map((li) => li.textContent.trim());
    });
    assert.equal(refusals.length, 1);
    assert.match(refusals[0], /threat-imminence/);
    assert.match(refusals[0], /an unknown arrival is not a distant one/);
  });
});

test('the citation trail is printed: a shared basis plus the extras each row cites', async () => {
  await withTheaterDefenceHarnessPage(BOARD, async (page) => {
    const report = await page.evaluate(() => {
      const basis = document.querySelector('.td-basis__list');
      const counts = {};
      for (const el of document.querySelectorAll('[data-detail-for]')) {
        counts[el.dataset.detailFor] = {
          count: el.querySelector('.td-citations').dataset.citationCount,
          extra: el.querySelector('.td-citations__extra').textContent.trim(),
        };
      }
      return { basis: basis ? basis.textContent : null, counts };
    });

    assert.ok(report.basis, 'the shared basis line must render');
    assert.match(report.basis, /intel\/theaters\.hostileMovement\.reconciles/);
    assert.doesNotMatch(
      report.basis,
      /shipBuildTime/,
      'a reading only one row cites must never be claimed as shared'
    );
    assert.equal(report.counts['theater-defence:mercury'].count, '12');
    assert.match(report.counts['theater-defence:mercury'].extra, /buildBeatsArrival\.verdict/);
    assert.equal(report.counts['theater-defence:earth'].count, '9');
    assert.match(report.counts['theater-defence:earth'].extra, /shared basis/);
  });
});

test('the posture tally, truncation note, off-board note and engine notes all render', async () => {
  await withTheaterDefenceHarnessPage(BOARD, async (page) => {
    const text = await getHarnessText(page);
    assert.match(text, /INBOUND TO TRACKED THEATER/);
    assert.match(text, /BUILD/);
    assert.match(text, /CANNOT ADVISE/);
    assert.match(text, /Every theater at issue is listed\. \(3 total\)/);
    assert.match(text, /aimed at bodies this twelve-body board does not track/);
    assert.match(text, /No force-strength comparison is made here/);
  });
});

test('a capped list announces its omissions rather than presenting a slice as the whole set', async () => {
  const capped = { ...BOARD, findingsTotalCount: 14, findingsOmittedCount: 11 };
  await withTheaterDefenceHarnessPage(capped, async (page) => {
    const note = await page.evaluate(() => {
      const el = document.querySelector('#theaterDefence [data-primitive="truncation-note"]');
      return el ? { state: el.dataset.truncationState, text: el.textContent } : null;
    });
    assert.equal(note.state, 'truncated');
    assert.match(note.text, /3 shown/);
    assert.match(note.text, /11 omitted/);
    assert.match(note.text, /14 total/);
  });
});

test('an empty list with a positive total says the cap dropped them, not that the board is quiet', async () => {
  const emptied = { ...BOARD, findings: [], findingsTotalCount: 9, findingsOmittedCount: 9 };
  await withTheaterDefenceHarnessPage(emptied, async (page, { pageErrors }) => {
    const text = await getHarnessText(page);
    assert.deepEqual(pageErrors.map((e) => e.message), []);
    assert.match(text, /omitted by the block's own cap/);
    assert.doesNotMatch(text, /NO THEATER IS AT ISSUE/);
  });
});

test('an unavailable block renders its reason, never a fabricated empty board', async () => {
  const unavailable = {
    available: false,
    unavailableReason: 'world.military was not supplied',
    state: null,
    findings: [],
    findingsTotalCount: 0,
    findingsOmittedCount: 0,
    offBoardNote: null,
    notes: ['No hate-based inference is made here.'],
  };
  await withTheaterDefenceHarnessPage(unavailable, async (page, { pageErrors }) => {
    const text = await getHarnessText(page);
    assert.deepEqual(pageErrors.map((e) => e.message), []);
    assert.match(text, /THEATER DEFENCE UNAVAILABLE — world\.military was not supplied/);
    assert.match(text, /No hate-based inference is made here/);
    const hasTable = await page.evaluate(
      () => Boolean(document.querySelector('#theaterDefence [data-variant="theater-defence"]'))
    );
    assert.equal(hasTable, false, 'an unavailable block must not render a findings table');
  });
});

test('a missing block renders the honest "not carried" state, not an empty board', async () => {
  await withTheaterDefenceHarnessPage(null, async (page, { pageErrors }) => {
    const text = await getHarnessText(page);
    assert.deepEqual(pageErrors.map((e) => e.message), []);
    assert.match(text, /THEATER DEFENCE UNAVAILABLE — the briefing did not carry the block/);
  });
});

test('the shell bridge call renders the same panel from an engineDirectives wrapper', async () => {
  await withTheaterDefenceHarnessPage(BOARD, async (page, { pageErrors }) => {
    await page.evaluate((board) => {
      const host = document.createElement('div');
      host.id = 'theaterDefenceBridgeProbe';
      document.body.appendChild(host);
      // Exactly the call renderDashboard() makes in public/v2/js/mission-control.js.
      window.MissionControlTheaterDefence.render(host, { engineDirectives: { theaterDefence: board } });
    }, BOARD);
    // Wait for the MOUNT, not for a fixed number of animation frames. A
    // two-frame wait is a race under load and is what made tests/worldMap.test.js
    // flaky (docs/live-defect-register.md #23).
    await page.waitForSelector('#theaterDefenceBridgeProbe .td-row[data-body]', { timeout: 15000 });
    const result = await page.evaluate(() => {
      const host = document.querySelector('#theaterDefenceBridgeProbe');
      return {
        chars: host.innerHTML.length,
        rows: host.querySelectorAll('.td-row[data-body]').length,
        mercury: Boolean(host.querySelector('.td-row[data-body="Mercury"]')),
      };
    });

    assert.deepEqual(pageErrors.map((e) => e.message), []);
    assert.ok(result.chars > 0, 'the bridge call rendered zero characters');
    assert.equal(result.rows, 3);
    assert.equal(result.mercury, true);
  });
});

test('an engineDirectives wrapper with no theaterDefence key renders unavailable, not empty', async () => {
  await withTheaterDefenceHarnessPage(BOARD, async (page, { pageErrors }) => {
    await page.evaluate(() => {
      const host = document.createElement('div');
      host.id = 'theaterDefenceEmptyProbe';
      document.body.appendChild(host);
      window.MissionControlTheaterDefence.render(host, { engineDirectives: { cyclePlan: {} } });
    });
    await page.waitForSelector('#theaterDefenceEmptyProbe .td-empty', { timeout: 15000 });
    const text = await page.evaluate(
      () => document.querySelector('#theaterDefenceEmptyProbe').textContent
    );
    assert.deepEqual(pageErrors.map((e) => e.message), []);
    assert.match(text, /the briefing did not carry the block/);
  });
});
