// scripts/run_unit_tests.js
//
// Purpose: run the deterministic unit test suite — every tests/**/*.test.js file
//   except tests/live/, which contacts the current campaign via npm run test:live.
//
// WHY THIS RUNS IN TWO PASSES
// ----------------------------
// The suite drives headless Chromium from a growing set of test files (12 at
// last count: six that call chromium.launch directly, six that launch through
// tests/fixtures/reactPrimitivesBrowser.js). `node --test` runs one test FILE
// per logical CPU by default, so a 16-core machine fires a dozen Chromiums at
// once and they compete with each other AND with the CPU-bound pure-JS files for
// the machine. The result is intermittent red runs that are pure contention --
// the same test that fails at 30s passes alone at 944ms, and the failure moves
// between runs (measured 2026-08-24 on commandLayout.test.js and
// verify_research_tab_layout.js).
//
// The fix measured on this machine (AMD Ryzen 7 5700X, 16 threads), full suite:
//   baseline (all files, default concurrency = 12 Chromiums)   ~54s   flaky
//   --test-concurrency=1 (whole suite serial)                   173s
//   pure parallel + browser at --test-concurrency=3              65s   still flaked 1/5
//   pure parallel + browser at --test-concurrency=2             ~78s   <- chosen, robust
//
// The browser pass runs at --test-concurrency=2: two concurrent Chromiums. That
// is the measured sweet spot -- the browser tests each carry a long inherent
// settle wait that should overlap across files, but a higher cap (concurrency=3
// measured at 44s for that pass) still oversubscribed the machine and flaked the
// most time-sensitive layout sweep (missionControlLayout.test.js:350) once in
// five runs. concurrency=2 held clean across repeated runs at 59s for the
// browser pass, versus 112s fully serial. The pure-JS pass keeps full
// parallelism, so the CPU-bound work is not serialised.
//
// Classification is automatic and honest: a file is "browser-driving" if it
// calls chromium.launch or requires the reactPrimitivesBrowser fixture (which
// does). A NEW browser test file is routed to the capped pass with no runner
// edit, and tests/runUnitSuitePasses.test.js asserts the split stays accurate
// rather than drifting.
//
// THE THIRD PASS: THE LIVE-SAVE GUARD
// -----------------------------------
// After both passes, the runner runs tests/noLiveSaveInUnitSuite.test.js alone.
// That file spawns THIS runner again with TI_SAVE_PATH pointed at a folder that
// does not exist and a fs watch on the real configured save folder; the suite
// must pass identically. It cannot run inside a pass -- it spawns the whole
// suite, so inside a pass it would double the Chromium count mid-run and
// recreate the contention this file exists to prevent (hence the `guard`
// bucket in tests/fixtures/unitTestPasses.js). The guard pass is skipped when
// TI_GUARDED_UNIT_RUN=1, which is the env the guard file itself sets on the run
// it spawns: that inner run must not spawn the guard again, or nothing would
// terminate. Both the normal run and the guarded run therefore run the suite
// exactly once each.
const { spawnSync } = require('node:child_process');

const {
  BROWSER_PASS_CONCURRENCY,
  splitPasses
} = require('../tests/fixtures/unitTestPasses.js');

function runPass(args, label) {
  const result = spawnSync(process.execPath, ['--test', ...args], {
    stdio: 'inherit',
    env: process.env
  });
  const status = result.status ?? 1;
  if (status !== 0) {
    console.error(`\n[run_unit_tests] ${label} FAILED (exit ${status})`);
  }
  return status;
}

const { browser, pure, guard } = splitPasses();

const pureStatus = runPass(pure, `pure-JS pass (${pure.length} files, parallel)`);
const browserStatus = runPass(
  [`--test-concurrency=${BROWSER_PASS_CONCURRENCY}`, ...browser],
  `browser pass (${browser.length} files, --test-concurrency=${BROWSER_PASS_CONCURRENCY})`
);

// The behavioural live-save guard, alone, after both passes. Skipped inside
// the guarded run this file spawns (see the header).
let guardStatus = 0;
if (process.env.TI_GUARDED_UNIT_RUN === '1') {
  console.log('[run_unit_tests] guarded run: skipping the live-save guard pass');
} else {
  guardStatus = runPass(guard, `live-save guard (${guard.length} file)`);
}

process.exit(pureStatus || browserStatus || guardStatus);
