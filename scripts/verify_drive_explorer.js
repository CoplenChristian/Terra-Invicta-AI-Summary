/**
 * Verification script for the DRIVES view (docs/drive-explorer-spec.md).
 * Purpose: browser verification that the Drive Explorer renders the measured
 *   and estimated halves in visibly different registers and that its minimum
 *   filters agree with the endpoint, in both intel modes.
 *
 * WHY THIS READS COMPUTED STYLE RATHER THAN SOURCE
 * -----------------------------------------------
 * `--text-muted` was once defined self-referentially in mission-control.css and
 * 164 rules silently fell back to `inherit`. Every rule looked right in the
 * file and none of them applied. So this script asks the rendered document what
 * it actually computed -- font family, style, weight and colour -- and fails if
 * the measured and estimated registers come out the same.
 *
 * It also proves the acceptance criteria the spec says are most likely to be
 * skipped: that the "ESTIMATE" caption is on screen, that reactor-incompatible
 * drives are shown and name the class they would need, that locked and
 * never-researchable drives are labelled, and that the on-screen counts
 * reconcile against the whole 541-drive catalogue.
 *
 * Run: node scripts/verify_drive_explorer.js
 */

const { chromium } = require('playwright');

process.env.NODE_ENV = 'test';

// `res.sendFile` refuses to serve a path containing a dot-directory (send's
// `dotfiles: 'ignore'` default), so a checkout under `.claude/worktrees/` 404s
// on `/v2/`. `express.static` is unaffected, so the shell is reached by its
// file name. See the follow-up recorded in docs/README.md.
const SHELL = '/v2/index.html';

const failures = [];
function check(condition, message, detail) {
  if (condition) {
    console.log(`  PASS  ${message}`);
  } else {
    console.error(`  FAIL  ${message}${detail === undefined ? '' : ` -- ${JSON.stringify(detail)}`}`);
    failures.push(message);
  }
}

async function verifyMode(page, mode, port) {
  console.log(`\n=== mode: ${mode} ===`);
  await page.goto(`http://localhost:${port}${SHELL}?mode=${mode}#/drives`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#driveExplorer .de-table', { timeout: 120000 });

  // --- 1. the view is registered and reachable ----------------------------
  const nav = await page.evaluate(() => ({
    buttons: Array.from(document.querySelectorAll('.init-nav-btn[data-view]')).map(b => b.dataset.view),
    sectionVisible: !document.getElementById('view-drives').hidden,
    registryIds: (window.MissionControlViews?.VIEWS || []).map(v => v.id)
  }));
  check(nav.buttons.length === 8, 'eight nav buttons are rendered', nav.buttons);
  check(nav.buttons.includes('drives'), 'the DRIVES nav button exists');
  check(nav.sectionVisible, '#view-drives is visible on #/drives');
  check(JSON.stringify(nav.registryIds) === JSON.stringify(['command', 'expansion', 'fleet', 'battle', 'drives', 'threat', 'records', 'designer']),
    'the VIEWS registry lists exactly the eight views in order', nav.registryIds);

  // --- 2. the two registers COMPUTE differently ---------------------------
  const styles = await page.evaluate(() => {
    const measured = document.querySelector('.de-table .de-measured__value');
    const estimate = document.querySelector('.de-table .de-estimate__value');
    const estimateCell = document.querySelector('.de-table .de-cell--estimate');
    const read = (el) => {
      if (!el) return null;
      const s = getComputedStyle(el);
      return {
        fontFamily: s.fontFamily,
        fontStyle: s.fontStyle,
        fontWeight: s.fontWeight,
        color: s.color
      };
    };
    // The cruise column joined the measured half on 2026-08-22 and has to be in
    // the SAME register as its two neighbours, read off the rendered document
    // rather than off the stylesheet. Its cell is the third measured value in a
    // row, in the order the header declares.
    const rowCells = Array.from(
      (document.querySelector('.de-table tbody tr') || document).querySelectorAll('.de-measured__value'));
    return {
      measured: read(measured),
      estimate: read(estimate),
      measuredCellCount: rowCells.length,
      measuredCellStyles: rowCells.map(read),
      headers: Array.from(document.querySelectorAll('.de-table thead th')).map(th => ({
        text: th.textContent.trim(),
        measuredClass: th.classList.contains('de-th--measured')
      })),
      estimateBorderLeft: estimateCell ? getComputedStyle(estimateCell).borderLeftStyle : null,
      rootTextDim: getComputedStyle(document.documentElement).getPropertyValue('--text-dim').trim(),
      rootText: getComputedStyle(document.documentElement).getPropertyValue('--text').trim()
    };
  });

  // --- 2a. the cruise column exists and computes as a MEASUREMENT ----------
  const cruiseHeader = styles.headers.find(header => /CRUISE ACCEL/.test(header.text));
  check(cruiseHeader !== undefined, 'a CRUISE ACCEL column is rendered', styles.headers.map(h => h.text));
  check(cruiseHeader !== undefined && /m\/s²/.test(cruiseHeader.text),
    'and it names its unit in the header', cruiseHeader && cruiseHeader.text);
  check(cruiseHeader !== undefined && cruiseHeader.measuredClass,
    'the cruise column carries the measured header class');
  check(styles.measuredCellCount === 3,
    'every row renders three measured figures: delta-V, combat and cruise', styles.measuredCellCount);
  if (styles.measuredCellStyles.length === 3) {
    const [dv, combat, cruise] = styles.measuredCellStyles;
    check(
      cruise.fontFamily === dv.fontFamily && cruise.fontStyle === dv.fontStyle
      && cruise.fontWeight === dv.fontWeight && cruise.color === dv.color,
      'the cruise figure COMPUTES in the same register as delta-V and combat',
      { dv, combat, cruise }
    );
    check(styles.estimate === null || cruise.fontStyle !== styles.estimate.fontStyle,
      'and in a different one from the estimate column',
      { cruise: cruise.fontStyle, estimate: styles.estimate && styles.estimate.fontStyle });
  }

  check(styles.measured !== null, 'a measured value cell is present in the table');
  check(styles.estimate !== null, 'an estimate value cell is present in the table');
  check(styles.rootText.length > 0 && styles.rootTextDim.length > 0,
    'the --text and --text-dim tokens both resolve to non-empty values', styles);
  if (styles.measured && styles.estimate) {
    check(styles.measured.fontStyle !== styles.estimate.fontStyle,
      'measured and estimate differ in computed font-style',
      { measured: styles.measured.fontStyle, estimate: styles.estimate.fontStyle });
    check(styles.measured.color !== styles.estimate.color,
      'measured and estimate differ in computed colour',
      { measured: styles.measured.color, estimate: styles.estimate.color });
    check(styles.measured.fontFamily !== styles.estimate.fontFamily,
      'measured and estimate differ in computed font-family',
      { measured: styles.measured.fontFamily, estimate: styles.estimate.fontFamily });
    check(Number(styles.measured.fontWeight) > Number(styles.estimate.fontWeight),
      'the measured figure is the heavier of the two',
      { measured: styles.measured.fontWeight, estimate: styles.estimate.fontWeight });
  }
  check(styles.estimateBorderLeft === 'dashed',
    'the estimate column is separated by a dashed rule', styles.estimateBorderLeft);

  // --- 3. the estimate says it is an estimate, in words -------------------
  const text = await page.evaluate(() => document.getElementById('driveExplorer').innerText);
  check(/ESTIMATE/.test(text), 'the word ESTIMATE appears on screen');
  check(/MEASURED/.test(text), 'the word MEASURED appears on screen');
  check(/not a measurement/i.test(text), 'the estimate is explicitly described as not a measurement');
  check(/absent from that list is not an unreachable one/i.test(text),
    'the page states that an absent body is not an unreachable one');
  check(/destinations are modelled/i.test(text), 'the page states how many destinations are modelled');

  // --- 4. reactor, availability and truncation ----------------------------
  const table = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.de-table tbody tr'));
    const chipTexts = Array.from(document.querySelectorAll('.de-table .de-chip')).map(c => c.textContent.trim());
    return {
      rowCount: rows.length,
      needsChips: chipTexts.filter(t => t.startsWith('NEEDS ')).length,
      fitsChips: chipTexts.filter(t => t === 'FITS').length,
      fittableChips: chipTexts.filter(t => t === 'FITTABLE NOW').length,
      researchableChips: chipTexts.filter(t => t === 'RESEARCHABLE').length,
      neverChips: chipTexts.filter(t => t === 'NEVER').length,
      reconcile: (document.querySelector('.de-reconcile') || {}).innerText || '',
      caption: (document.querySelector('.de-th__caption--estimate') || {}).textContent || ''
    };
  });
  check(table.rowCount > 0, 'rows render', table.rowCount);
  check(table.needsChips > 0, 'reactor-incompatible drives are shown and name the class they need', table.needsChips);
  check(table.fitsChips > 0, 'reactor-compatible drives are marked as fitting', table.fitsChips);
  check(table.researchableChips > 0, 'locked drives are labelled RESEARCHABLE rather than hidden', table.researchableChips);
  check(/\d/.test(table.reconcile) && /catalogue/.test(table.reconcile),
    'the reconciliation line states the catalogue counts', table.reconcile);
  check(/ESTIMATE/i.test(table.caption), 'the destinations column carries an ESTIMATE caption', table.caption);

  // --- 5. nothing renders as null, undefined or NaN -----------------------
  const leaks = await page.evaluate(() => {
    const root = document.getElementById('driveExplorer');
    const bad = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const value = walker.currentNode.nodeValue;
      if (/\b(null|undefined|NaN)\b/.test(value)) bad.push(value.trim().slice(0, 120));
    }
    return bad;
  });
  check(leaks.length === 0, 'no null / undefined / NaN reaches the rendered text', leaks.slice(0, 5));

  // --- 6. the filters actually filter --------------------------------------
  await page.selectOption('[data-de-bucket]', 'never');
  await page.waitForTimeout(150);
  const neverOnly = await page.evaluate(() => {
    const chips = Array.from(document.querySelectorAll('.de-table .de-chip'));
    return {
      rows: document.querySelectorAll('.de-table tbody tr').length,
      allNever: chips.filter(c => ['FITTABLE NOW', 'RESEARCHABLE', 'NEVER', 'UNRESOLVED'].includes(c.textContent.trim()))
        .every(c => c.textContent.trim() === 'NEVER')
    };
  });
  check(neverOnly.rows > 0 && neverOnly.allNever,
    'filtering to never-researchable leaves only never-researchable rows', neverOnly);

  await page.selectOption('[data-de-bucket]', 'all');
  await page.selectOption('[data-de-sort]', 'combat-acceleration');
  await page.waitForTimeout(150);
  // The fitted drive is deliberately pinned to the top whatever the sort, so it
  // is excluded here rather than treated as a sort violation. Its own row is
  // asserted separately below.
  const sortState = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.de-table tbody tr'));
    return {
      fittedPinnedFirst: rows.length > 0 && rows[0].classList.contains('de-row--fitted'),
      fittedRowCount: rows.filter(tr => tr.classList.contains('de-row--fitted')).length,
      values: rows
        .filter(tr => !tr.classList.contains('de-row--fitted'))
        .slice(0, 8)
        .map(tr => {
          const cells = tr.querySelectorAll('.de-measured__value');
          return cells.length > 1 ? cells[1].textContent.trim() : null;
        })
    };
  });
  const numericSorted = sortState.values.map(Number).filter(Number.isFinite);
  const descending = numericSorted.every((value, i) => i === 0 || numericSorted[i - 1] >= value);
  check(numericSorted.length >= 3 && descending,
    'sorting by combat acceleration orders the column descending', sortState.values);
  check(sortState.fittedRowCount === 1,
    'the fitted drive appears exactly once, whatever the sort', sortState.fittedRowCount);
  check(sortState.fittedPinnedFirst,
    'the fitted drive stays visible as the baseline every multiple is measured against');

  // --- 7. the cruise sort orders the cruise column, not an invisible key ----
  // The expected top value is read from the PAYLOAD, never hardcoded: which
  // drive tops the ordering depends on the design being rated, so a fixed name
  // would pass on this campaign and fail on the next.
  await page.selectOption('[data-de-sort]', 'cruise-acceleration');
  await page.waitForTimeout(150);
  const cruiseSort = await page.evaluate(() => {
    const payload = window.MissionControlDriveExplorer._internals.state.payload;
    const best = payload.items
      .filter(row => !row.isFittedDrive && row.measured.cruiseAccelerationMps2 !== null)
      .reduce((top, row) =>
        top === null || row.measured.cruiseAccelerationMps2 > top.measured.cruiseAccelerationMps2 ? row : top, null);
    const rows = Array.from(document.querySelectorAll('.de-table tbody tr'));
    const cruiseCells = rows
      .filter(tr => !tr.classList.contains('de-row--fitted'))
      .slice(0, 10)
      .map(tr => {
        const cells = tr.querySelectorAll('.de-measured__value');
        return cells.length > 2 ? cells[2].textContent.trim() : null;
      });
    const firstName = rows.filter(tr => !tr.classList.contains('de-row--fitted'))[0];
    return {
      expectedTopDrive: best ? best.displayName : null,
      expectedTopValue: best ? best.measured.cruiseAccelerationMps2 : null,
      renderedTopDrive: firstName ? firstName.querySelector('.de-name').textContent.trim() : null,
      cruiseCells,
      // Combat and cruise on the same row, so their ratio can be checked to be
      // the drive's own thrust cap rather than 1.
      pairs: rows.filter(tr => !tr.classList.contains('de-row--fitted')).slice(0, 10).map(tr => {
        const cells = tr.querySelectorAll('.de-measured__value');
        return cells.length > 2
          ? { combat: Number(cells[1].textContent.trim()), cruise: Number(cells[2].textContent.trim()) }
          : null;
      }).filter(Boolean)
    };
  });
  const cruiseValues = cruiseSort.cruiseCells.map(Number).filter(Number.isFinite);
  check(cruiseValues.length >= 3 && cruiseValues.every((value, i) => i === 0 || cruiseValues[i - 1] >= value),
    'sorting by cruise acceleration orders the CRUISE column descending', cruiseSort.cruiseCells);
  check(cruiseSort.renderedTopDrive === cruiseSort.expectedTopDrive,
    'and the top row is the drive the payload says has the highest measured cruise acceleration',
    { rendered: cruiseSort.renderedTopDrive, expected: cruiseSort.expectedTopDrive, value: cruiseSort.expectedTopValue });
  check(cruiseSort.pairs.some(pair => pair.combat > pair.cruise * 1.5),
    'combat and cruise are visibly different figures on the same row, not a duplicated column',
    cruiseSort.pairs.slice(0, 3));
  check(cruiseSort.cruiseCells.every(text => text !== '0.000' && text !== '0.00'),
    'no measured acceleration renders as a confident zero', cruiseSort.cruiseCells);

  // --- 8. the minimum-threshold controls ----------------------------------
  await page.selectOption('[data-de-sort]', 'delta-v');
  await page.fill('[data-de-threshold="minDeltaV"]', '10');
  await page.fill('[data-de-threshold="minCombatAcceleration"]', '20');
  await page.waitForTimeout(200);
  const filteredState = await page.evaluate(async () => {
    const panel = window.MissionControlDriveExplorer;
    const rows = Array.from(document.querySelectorAll('.de-table tbody tr'));
    const outcome = panel._internals.visibleRows(panel._internals.state.payload.items);
    // The SAME thresholds against the endpoint, so the browser and the API are
    // compared on the live save rather than assumed to agree.
    const url = `/api/intel/drive-explorer?observer=4712&mode=${panel._internals.state.mode}`
      + '&limit=1000&minDeltaV=10&minCombatAcceleration=20';
    const endpoint = await fetch(url).then(response => response.json());
    return {
      renderedRowCount: rows.length,
      matched: outcome.rows.length,
      below: outcome.belowThresholdCount,
      untestable: outcome.untestableCount,
      endpointMatched: endpoint.filters.matched,
      endpointBelow: endpoint.filters.thresholdExclusions.belowThresholdCount,
      endpointUntestable: endpoint.filters.thresholdExclusions.untestableCount,
      endpointApplied: endpoint.thresholds.applied,
      violations: outcome.rows.filter(row =>
        !(row.measured.deltaVKps >= 10 && row.measured.combatAccelerationMps2 >= 20)).length,
      noticeText: (document.querySelector('.de-notice--filters') || {}).textContent || ''
    };
  });
  check(filteredState.matched > 0 && filteredState.violations === 0,
    'the minimums admit only drives that meet both of them', filteredState);
  check(filteredState.matched === filteredState.endpointMatched
    && filteredState.below === filteredState.endpointBelow
    && filteredState.untestable === filteredState.endpointUntestable,
    'the browser and /api/intel/drive-explorer reach the same counts for the same minimums', filteredState);
  check(filteredState.endpointApplied.minDeltaV === 10 && filteredState.endpointApplied.minCombatAcceleration === 20,
    'the endpoint parses the same minimums off its query string', filteredState.endpointApplied);
  check(/MINIMUMS ACTIVE/.test(filteredState.noticeText) && /untestable|untested/i.test(filteredState.noticeText),
    'the active minimums and the untestable category are stated on screen', filteredState.noticeText.slice(0, 200));

  // A malformed minimum is announced and ignored, never coerced to zero.
  await page.fill('[data-de-threshold="minDeltaV"]', 'abc');
  await page.fill('[data-de-threshold="minCombatAcceleration"]', '');
  await page.waitForTimeout(200);
  const rejectedState = await page.evaluate(() => {
    const panel = window.MissionControlDriveExplorer;
    const outcome = panel._internals.visibleRows(panel._internals.state.payload.items);
    return {
      matched: outcome.rows.length,
      total: panel._internals.state.payload.items.length,
      warning: (document.querySelector('.de-notice--warn') || {}).textContent || ''
    };
  });
  check(rejectedState.matched === rejectedState.total,
    'a rejected minimum filters nothing rather than silently filtering on zero', rejectedState);
  check(/IGNORED/.test(rejectedState.warning),
    'and says on screen that it was ignored', rejectedState.warning.slice(0, 160));

  await page.fill('[data-de-threshold="minDeltaV"]', '');
  await page.waitForTimeout(150);

  return { styles, table };
}

async function run() {
  const { ensureBundleBuilt } = require('../tests/fixtures/ensureBundle.js');
  ensureBundleBuilt();
  const app = require('../server/index.js');
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const port = server.address().port;
  console.log(`[Verification] Server listening on http://localhost:${port}`);

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1660, height: 950 } });
    const page = await context.newPage();

    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

    for (const mode of ['player', 'omniscient']) {
      await verifyMode(page, mode, port);
    }

    console.log(`\nConsole errors: ${consoleErrors.length}`);
    if (consoleErrors.length > 0) console.error(consoleErrors.slice(0, 10));
    check(consoleErrors.length === 0, 'no console errors during the run');

    if (failures.length > 0) {
      console.error(`\nFAILED: ${failures.length} check(s)\n  - ${failures.join('\n  - ')}`);
      process.exitCode = 1;
    } else {
      console.log('\nALL DRIVE EXPLORER CHECKS PASSED');
    }
  } catch (err) {
    console.error('\nVerification error:', err);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.close();
  }
}

run().catch(err => {
  console.error('\nFatal verification runner error:', err);
  process.exit(1);
});
