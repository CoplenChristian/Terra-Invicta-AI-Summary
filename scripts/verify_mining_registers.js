/**
 * Verification script for the mining expansion board's two registers.
 * Purpose: browser verification that the mining board renders the measured
 *   mine-upgrade figures and the projected module band in visibly different
 *   registers, in both intel modes.
 *
 * WHY THIS READS COMPUTED STYLE RATHER THAN SOURCE
 * -----------------------------------------------
 * `--text-muted` was once defined self-referentially in mission-control.css and
 * 164 rules silently fell back to `inherit`. Every rule looked right in the file
 * and none of them applied. `scripts/verify_drive_explorer.js` was written for
 * that reason and this script is the same discipline applied to the board where
 * the distinction matters most: the mine module's own output multiplier is a
 * MEASUREMENT on a site the observer holds and a DECISION on one it does not,
 * and the two sit a few rows apart on the same screen. If they compute to the
 * same font, weight and colour, the projection has been laundered into a
 * reading -- which is the exact failure the decision to keep it out of the
 * utility score exists to prevent.
 *
 * Run: node scripts/verify_mining_registers.js
 */

const { chromium } = require('playwright');

process.env.NODE_ENV = 'test';

// `res.sendFile` refuses to serve a path containing a dot-directory (send's
// `dotfiles: 'ignore'` default), so a checkout under `.claude/worktrees/` 404s
// on `/v2/`. `express.static` is unaffected, so the shell is reached by its
// file name.
const SHELL = '/v2/index.html';

const failures = [];
function check(condition, message, detail) {
  if (condition) {
    console.log(`  PASS  ${message}`);
  } else {
    console.error(`  FAIL  ${message}${detail === undefined ? '' : ` -- ${JSON.stringify(detail)}`}`);
    failures.push(`[${message}]`);
  }
}

async function verifyMode(page, mode, port) {
  console.log(`\n=== mode: ${mode} ===`);
  await page.goto(`http://localhost:${port}${SHELL}?mode=${mode}#/expansion`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#miningExpansion .mining-expansion-board', { timeout: 120000 });

  const styles = await page.evaluate(() => {
    const read = (el) => {
      if (!el) return null;
      const s = getComputedStyle(el);
      return {
        fontFamily: s.fontFamily,
        fontStyle: s.fontStyle,
        fontWeight: s.fontWeight,
        color: s.color,
        text: (el.textContent || '').trim().slice(0, 80)
      };
    };
    // The measured register: an upgrade row's monthly gain, or the total gain.
    const measured = document.querySelector('#miningExpansion .mining-upgrades .mining-meas__value')
      || document.querySelector('#miningExpansion .mining-meas__value');
    // The estimate register: an unowned candidate's projected module band.
    const estimate = document.querySelector('#miningExpansion .mining-module-band .mining-est__value')
      || document.querySelector('#miningExpansion .mining-module-band');
    return {
      measured: read(measured),
      estimate: read(estimate),
      bandCount: document.querySelectorAll('#miningExpansion .mining-module-band').length,
      candidateRows: document.querySelectorAll('#miningExpansion .mining-candidate-row').length,
      upgradeRows: document.querySelectorAll('#miningExpansion .mining-upgrade-row').length,
      estTagPresent: document.querySelectorAll('#miningExpansion .mining-est__tag').length,
      boardText: (document.getElementById('miningExpansion').textContent || '').replace(/\s+/g, ' ').trim(),
      rootText: getComputedStyle(document.documentElement).getPropertyValue('--text').trim(),
      rootTextDim: getComputedStyle(document.documentElement).getPropertyValue('--text-dim').trim()
    };
  });

  check(styles.rootText !== '', '--text resolves to a non-empty value at :root', styles.rootText);
  check(styles.rootTextDim !== '', '--text-dim resolves to a non-empty value at :root', styles.rootTextDim);
  check(styles.candidateRows > 0, 'the candidate table rendered at least one row', styles.candidateRows);
  check(styles.bandCount === styles.candidateRows,
    'every candidate row carries a module band, so no row silently omits the projection',
    { bands: styles.bandCount, rows: styles.candidateRows });
  check(styles.measured !== null, 'a measured value is present on the board');
  check(styles.estimate !== null, 'a projected module band is present on the board');

  if (styles.measured && styles.estimate) {
    check(styles.measured.fontFamily !== styles.estimate.fontFamily,
      'measured and estimate differ in computed font-family',
      { measured: styles.measured.fontFamily, estimate: styles.estimate.fontFamily });
    check(styles.measured.fontStyle !== styles.estimate.fontStyle,
      'measured and estimate differ in computed font-style',
      { measured: styles.measured.fontStyle, estimate: styles.estimate.fontStyle });
    check(styles.measured.color !== styles.estimate.color,
      'measured and estimate differ in computed colour',
      { measured: styles.measured.color, estimate: styles.estimate.color });
    check(Number(styles.measured.fontWeight) > Number(styles.estimate.fontWeight),
      'the measured figure is the heavier of the two',
      { measured: styles.measured.fontWeight, estimate: styles.estimate.fontWeight });
  }

  // The caption a reader actually sees. A band that computed differently but
  // carried no word saying it is an estimate would still mislead.
  check(styles.estTagPresent > 0, 'the EST caption is rendered beside the projected band', styles.estTagPresent);
  check(/ESTIMATE/.test(styles.boardText),
    'the board states in words that the module multiplier is an estimate');
  check(/NOT in the utility score/i.test(styles.boardText),
    'the board states that the module multiplier is excluded from the score');
  check(/MINE UPGRADES/.test(styles.boardText),
    'the measured mine-upgrade block is on screen');
  check(/costs 0 against the mine limit|costs \d+ against the mine limit/i.test(styles.boardText)
    || /0<\/strong> against the mine limit/.test(styles.boardText)
    || /against the mine limit/.test(styles.boardText),
    'the board says what an upgrade costs against the mine limit');

  for (const token of ['null', 'undefined', 'NaN', '[object Object]']) {
    const index = styles.boardText.indexOf(token);
    check(index === -1, `no "${token}" reaches the rendered board text`,
      index === -1 ? undefined : styles.boardText.slice(Math.max(0, index - 60), index + 60));
  }

  return styles;
}

async function run() {
  const { ensureBundleBuilt } = require('../tests/fixtures/ensureBundle.js');
  ensureBundleBuilt();
  const app = require('../server/index.js');
  const http = require('http');
  const server = http.createServer(app);
  server.listen(0);
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

    const seen = {};
    for (const mode of ['player', 'omniscient']) {
      seen[mode] = await verifyMode(page, mode, port);
    }

    // The mine module multiplier is read from the OBSERVER's own sites and its
    // own completed projects, so the two modes must agree. A difference here is
    // a rival's data reaching the board.
    console.log('\n=== both modes ===');
    check(seen.player.boardText === seen.omniscient.boardText,
      'the board renders identically in both modes, because every term is the observer\'s own');

    console.log(`\nConsole errors: ${consoleErrors.length}`);
    if (consoleErrors.length > 0) console.error(consoleErrors.slice(0, 10));
    check(consoleErrors.length === 0, 'no console errors during the run');

    if (failures.length > 0) {
      console.error(`\nFAILED: ${failures.length} check(s)\n  - ${failures.join('\n  - ')}`);
      process.exitCode = 1;
    } else {
      console.log('\nALL MINING REGISTER CHECKS PASSED');
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
