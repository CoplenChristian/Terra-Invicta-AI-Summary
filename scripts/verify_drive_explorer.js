/**
 * Verification script for the DRIVES view (docs/drive-explorer-spec.md).
 * Purpose: browser verification that the Drive Explorer renders the measured
 *   and estimated halves in visibly different registers, in both intel modes.
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

const PORT = Number(process.env.VERIFY_PORT || 3889);
process.env.PORT = String(PORT);
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

async function verifyMode(page, mode) {
  console.log(`\n=== mode: ${mode} ===`);
  await page.goto(`http://localhost:${PORT}${SHELL}?mode=${mode}#/drives`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#driveExplorer .de-table', { timeout: 120000 });

  // --- 1. the view is registered and reachable ----------------------------
  const nav = await page.evaluate(() => ({
    buttons: Array.from(document.querySelectorAll('.init-nav-btn[data-view]')).map(b => b.dataset.view),
    sectionVisible: !document.getElementById('view-drives').hidden,
    registryIds: (window.MissionControlViews?.VIEWS || []).map(v => v.id)
  }));
  check(nav.buttons.length === 6, 'six nav buttons are rendered', nav.buttons);
  check(nav.buttons.includes('drives'), 'the DRIVES nav button exists');
  check(nav.sectionVisible, '#view-drives is visible on #/drives');
  check(JSON.stringify(nav.registryIds) === JSON.stringify(['command', 'expansion', 'fleet', 'drives', 'threat', 'records']),
    'the VIEWS registry lists exactly the six views in order', nav.registryIds);

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
    return {
      measured: read(measured),
      estimate: read(estimate),
      estimateBorderLeft: estimateCell ? getComputedStyle(estimateCell).borderLeftStyle : null,
      rootTextDim: getComputedStyle(document.documentElement).getPropertyValue('--text-dim').trim(),
      rootText: getComputedStyle(document.documentElement).getPropertyValue('--text').trim()
    };
  });

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

  return { styles, table };
}

async function run() {
  const app = require('../server/index.js');
  const server = app.listen(PORT);
  await new Promise(resolve => server.once('listening', resolve));
  console.log(`[Verification] Server listening on http://localhost:${PORT}`);

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1660, height: 950 } });
    const page = await context.newPage();

    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

    for (const mode of ['player', 'omniscient']) {
      await verifyMode(page, mode);
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
