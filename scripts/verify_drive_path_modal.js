/**
 * Verification script for the drive-path modal (docs/drive-path-modal-spec.md).
 * Purpose: browser verification that clicking a drive row actually opens the
 *   research-path modal, by dispatching a real mouse click and a real keypress
 *   against the rendered document.
 *
 * WHY THIS EXISTS
 * ---------------
 * The reported defect was that clicking a drive row did NOTHING. Reading the
 * source cannot prove that fixed: the handler could be bound to a node the
 * re-paint replaces, the modal could open behind the table, or the fetch could
 * fail silently. So this script clicks the row the way a person does --
 * `page.click`, then `Enter` on the focused control -- and reads back what
 * appeared.
 *
 * It also verifies the two things the modal must never imply:
 *   * that a cleared path is a startable one (availability is rolled monthly,
 *     docs/research-advisor-spec.md 3b), and
 *   * that `researchCost: -1` is a cost rather than a never-researchable
 *     sentinel.
 *
 * And it re-measures the modal at 375px, because a dialog is the easiest thing
 * to push off a narrow screen and the repo has just taken every view to zero
 * unreachable content there.
 *
 * Run: node scripts/verify_drive_path_modal.js
 */

const { chromium } = require('playwright');

const PORT = Number(process.env.VERIFY_PORT || 3892);
process.env.PORT = String(PORT);
process.env.NODE_ENV = 'test';

// `res.sendFile` refuses to serve a path containing a dot-directory (send's
// `dotfiles: 'ignore'` default), so a checkout under `.claude/worktrees/` 404s
// on `/v2/`. `express.static` is unaffected, so the shell is reached by name.
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

/** Everything the modal is currently showing, read off the live DOM. */
function readModal() {
  const panel = document.getElementById('mcDetailPanel');
  if (!panel) return { present: false };
  const text = (selector) => panel.querySelector(selector)?.textContent.replace(/\s+/g, ' ').trim() || null;
  return {
    present: true,
    hidden: panel.hidden,
    eyebrow: text('#detailPanelEyebrow'),
    title: text('#detailPanelTitle'),
    summary: text('#detailPanelSummary'),
    facts: Array.from(panel.querySelectorAll('.detail-panel__fact')).map(node => ({
      label: node.querySelector('dt')?.textContent.trim(),
      value: node.querySelector('dd')?.textContent.trim()
    })),
    sections: Array.from(panel.querySelectorAll('.detail-panel__section')).map(node => ({
      title: node.querySelector('.detail-panel__section-title')?.textContent.trim(),
      caption: node.querySelector('.detail-panel__section-caption')?.textContent.replace(/\s+/g, ' ').trim(),
      rows: Array.from(node.querySelectorAll('.detail-panel__row')).map(row => ({
        label: row.querySelector('.detail-panel__row-label')?.textContent.trim(),
        sublabel: row.querySelector('.detail-panel__row-sub')?.textContent.replace(/\s+/g, ' ').trim() || null,
        status: row.querySelector('.detail-panel__status')?.textContent.trim(),
        meta: row.querySelector('.detail-panel__row-meta')?.textContent.trim()
      }))
    })),
    notes: Array.from(panel.querySelectorAll('.detail-panel__note')).map(node => node.textContent.replace(/\s+/g, ' ').trim()),
    bodyText: panel.querySelector('.detail-panel__body')?.textContent.replace(/\s+/g, ' ').trim() || ''
  };
}

/** Elements past the viewport edge with no scrollable ancestor to reach them. */
function unreachableInside(selector) {
  const root = document.querySelector(selector);
  if (!root) return { rootPresent: false };
  const innerW = window.innerWidth;
  const offenders = [];
  for (const el of root.querySelectorAll('*')) {
    if (el.getClientRects().length === 0) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    if (rect.right <= innerW + 1 && rect.left >= -1) continue;
    let reachable = false;
    for (let node = el.parentElement; node; node = node.parentElement) {
      const overflowX = getComputedStyle(node).overflowX;
      if (overflowX === 'auto' || overflowX === 'scroll') { reachable = true; break; }
    }
    if (!reachable) {
      offenders.push({ tag: el.tagName, cls: el.className, right: Math.round(rect.right), left: Math.round(rect.left) });
    }
  }
  return { rootPresent: true, innerW, offenders, documentScrollWidth: document.documentElement.scrollWidth };
}

async function openPathModal(page, { viaKeyboard = false } = {}) {
  // The row a person clicks: the deepest researchable path on screen, chosen by
  // step count rather than by name, so this does not pin one campaign's drive.
  const driveId = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.de-row'));
    const scored = rows
      .map(row => {
        const steps = /(\d[\d,]*) RP over (\d+) step/.exec(row.textContent.replace(/\s+/g, ' '));
        return { id: row.getAttribute('data-de-drive'), steps: steps ? Number(steps[2]) : -1 };
      })
      .filter(entry => entry.id && entry.steps > 0)
      .sort((a, b) => b.steps - a.steps);
    return scored[0]?.id || null;
  });
  if (!driveId) return null;

  const selector = `[data-de-path="${driveId}"]`;
  await page.locator(selector).scrollIntoViewIfNeeded();
  if (viaKeyboard) {
    await page.locator(selector).focus();
    await page.keyboard.press('Enter');
  } else {
    await page.click(selector);
  }
  await page.waitForSelector('#mcDetailPanel:not([hidden])', { timeout: 30000 });
  return driveId;
}

async function verifyMode(page, mode) {
  console.log(`\n=== mode: ${mode} ===`);
  await page.goto(`http://localhost:${PORT}${SHELL}?mode=${mode}#/drives`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#driveExplorer .de-table', { timeout: 120000 });

  // --- 1. the affordance exists on every row ------------------------------
  const affordance = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.de-row'));
    const buttons = Array.from(document.querySelectorAll('.de-row [data-de-path]'));
    const first = buttons[0];
    return {
      rows: rows.length,
      buttons: buttons.length,
      tag: first?.tagName || null,
      ariaLabel: first?.getAttribute('aria-label') || null,
      rowCursor: rows[0] ? getComputedStyle(rows[0]).cursor : null,
      nameBorder: first ? getComputedStyle(first.querySelector('.de-name')).borderBottomStyle : null
    };
  });
  check(affordance.rows > 0, 'the drive table renders rows', affordance.rows);
  check(affordance.buttons === affordance.rows, 'every row carries a path control', affordance);
  check(affordance.tag === 'BUTTON', 'the control is a real button, so Enter and Space work natively', affordance.tag);
  check(/research path/i.test(affordance.ariaLabel || ''), 'the control names what it does', affordance.ariaLabel);
  check(affordance.rowCursor === 'pointer', 'the row shows a pointer cursor -- a clickable row must look clickable', affordance.rowCursor);
  check(affordance.nameBorder === 'dotted', 'the drive name carries a visible affordance rule', affordance.nameBorder);

  // --- 2. THE COMPLAINT: a real click opens the modal ----------------------
  const before = await page.evaluate(readModal);
  check(before.present === false || before.hidden === true, 'no modal is open before the click');

  const driveId = await openPathModal(page);
  check(Boolean(driveId), 'a researchable drive row was found to click', driveId);

  const modal = await page.evaluate(readModal);
  check(modal.hidden === false, 'clicking a drive row opens the modal');
  check(modal.eyebrow === 'RESEARCH PATH', 'the modal says what it is', modal.eyebrow);
  check((modal.title || '').length > 0, 'and which drive it is about', modal.title);

  // --- 3. the two sections the feature is about ---------------------------
  const titles = modal.sections.map(section => section.title);
  check(titles.includes('FACTION PROJECTS'), 'the modal has a faction-projects section', titles);
  check(titles.includes('GLOBAL TECHS'), 'the modal has a global-techs section', titles);
  check(titles.includes('ALREADY SATISFIED'), 'and the satisfied half, which is the gap this closed', titles);

  const satisfied = modal.sections.find(section => section.title === 'ALREADY SATISFIED');
  check(satisfied.rows.length > 0,
    'satisfied prerequisites actually render -- this returned 0 before the change', satisfied.rows.length);
  check(satisfied.rows.every(row => row.status === 'DONE'),
    'every satisfied row reads as done rather than as another thing to research');

  const remainingRows = modal.sections
    .filter(section => section.title === 'FACTION PROJECTS' || section.title === 'GLOBAL TECHS')
    .flatMap(section => section.rows);
  check(remainingRows.length > 0, 'the remaining path renders too', remainingRows.length);
  check(remainingRows.every(row => /^(LOCKED|AVAILABLE|RESEARCHING( \d+\.\d%)?|DONE|UNKNOWN)$/.test(row.status || '')),
    'every remaining row carries a status', remainingRows.map(row => row.status));

  // --- 4. the costs, split, and never summed through a sentinel ------------
  const facts = new Map(modal.facts.map(fact => [fact.label, fact.value]));
  check(facts.has('FACTION RESEARCH') && facts.has('GLOBAL RESEARCH'),
    'the two research currencies are reported separately', [...facts.keys()]);
  check(/RP|UNKNOWN/.test(facts.get('TOTAL REMAINING') || ''),
    'the total is either points or an explicit unknown, never a bare number', facts.get('TOTAL REMAINING'));
  check(/^\d+ prerequisite/.test(facts.get('ALREADY SATISFIED') || ''),
    'the satisfied count is on screen', facts.get('ALREADY SATISFIED'));

  // --- 5. the caveat, which no figure can say about itself -----------------
  check(modal.notes.some(note => /rolled monthly/i.test(note)),
    'the rolled-availability caveat is visible', modal.notes);

  // --- 6. nothing null reaches the reader ---------------------------------
  for (const token of ['null', 'undefined', 'NaN', '[object Object]']) {
    check(!new RegExp(`\\b${token.replace(/[[\]]/g, '\\$&')}\\b`).test(modal.bodyText),
      `no "${token}" reaches the modal text`);
  }

  // --- 7. the route not taken ---------------------------------------------
  const route = modal.sections.find(section => section.title === 'ROUTE CHOSEN');
  if (route) {
    check(route.rows.length > 0, 'the route section renders the node whose route was chosen');
    check(route.rows.every(row => /via .+ rather than .+/.test(row.sublabel || '')),
      'and each names the route taken AND the road not taken', route.rows.map(row => row.sublabel));
  } else {
    console.log('  INFO  no alternate route on this path, so no ROUTE CHOSEN section');
  }

  // --- 8. keyboard reaches the same modal ---------------------------------
  // The backdrop also carries [data-detail-close]; the Close BUTTON is what a
  // keyboard user reaches, so that is the one this clicks.
  await page.click('#mcDetailPanel button[data-detail-close]');
  await page.waitForSelector('#mcDetailPanel[hidden]', { state: 'attached', timeout: 10000 });
  const closed = await page.evaluate(readModal);
  check(closed.hidden === true, 'Close actually closes it');

  await openPathModal(page, { viaKeyboard: true });
  const viaKey = await page.evaluate(readModal);
  check(viaKey.hidden === false, 'Enter on the focused control opens the same modal -- keyboard, not mouse only');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#mcDetailPanel[hidden]', { state: 'attached', timeout: 10000 });
  check((await page.evaluate(readModal)).hidden === true, 'Escape closes it');
}

/** The modal at 375px: the easiest place to push a dialog off the screen. */
async function verifyNarrow(page, width) {
  console.log(`\n=== ${width}px ===`);
  await page.setViewportSize({ width, height: 812 });
  await page.goto(`http://localhost:${PORT}${SHELL}?mode=player#/drives`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#driveExplorer .de-table', { timeout: 120000 });

  const driveId = await openPathModal(page);
  check(Boolean(driveId), `[${width}] the modal opens at this width`, driveId);

  const measured = await page.evaluate(unreachableInside, '#mcDetailPanel');
  check(measured.offenders.length === 0,
    `[${width}] nothing in the modal is unreachable`, measured.offenders.slice(0, 6));
  check(measured.documentScrollWidth <= width + 1,
    `[${width}] the open modal does not widen the document`, measured.documentScrollWidth);

  const dialog = await page.evaluate(() => {
    const node = document.querySelector('#mcDetailPanel .detail-panel__dialog');
    const rect = node.getBoundingClientRect();
    return { left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) };
  });
  check(dialog.left >= -1 && dialog.right <= width + 1,
    `[${width}] the dialog sits inside the viewport`, dialog);

  await page.keyboard.press('Escape');
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
    for (const width of [375, 414, 768]) {
      await verifyNarrow(page, width);
    }

    console.log(`\nConsole errors: ${consoleErrors.length}`);
    if (consoleErrors.length > 0) console.error(consoleErrors.slice(0, 10));
    check(consoleErrors.length === 0, 'no console errors during the run');

    if (failures.length > 0) {
      console.error(`\nFAILED: ${failures.length} check(s)\n  - ${failures.join('\n  - ')}`);
      process.exitCode = 1;
    } else {
      console.log('\nALL DRIVE PATH MODAL CHECKS PASSED');
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
