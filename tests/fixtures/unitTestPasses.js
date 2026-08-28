// tests/fixtures/unitTestPasses.js
//
// Purpose: the single source of truth for how scripts/run_unit_tests.js splits
//   the suite into a parallel pure-JS pass and a capped-concurrency browser pass.
//
// The suite drives headless Chromium from a growing set of test files. Run all
// of them at default `node --test` concurrency (one file per logical CPU) and a
// dozen Chromiums compete for the machine, producing intermittent red runs that
// are pure contention. The runner therefore routes browser-driving files into a
// separate pass capped at BROWSER_PASS_CONCURRENCY Chromiums.
//
// This module owns the classifier so the runner and the honesty test
// (tests/runUnitSuitePasses.test.js) can never drift: the test asserts that a
// NEW browser-driving file is detected, and the runner uses the same function.
//
// The guard file (tests/noLiveSaveInUnitSuite.test.js) is split OUT of both
// passes into its own `guard` bucket. It cannot live in a pass: it spawns the
// whole suite again (under a save-folder override), so running it inside the
// suite would double the Chromium count mid-run and recreate the contention
// this split exists to prevent. The runner runs it alone, after both passes,
// and runUnitSuitePasses.test.js asserts it never migrates back into one.
//
// The guard file is also why the browser/pure classification must stay
// source-based: a file that only requires the server (and reads the save
// through a route) is not "browser-driving" and would land in the pure pass,
// where the behavioural guard catches it by running the suite with the save
// folder absent.

const fs = require('node:fs');
const path = require('node:path');

const testsRoot = path.resolve(__dirname, '..');

// Measured sweet spot for the 12-file browser set. concurrency=1 (fully serial)
// is bulletproof but 112s; concurrency=3 is fastest (44s) but still flaked once
// in five full-suite runs. concurrency=2 holds clean across repeated runs at
// 59s -- nearly as fast as 3, but only two concurrent Chromiums, so the
// inherent settle-waits still overlap without the oversubscription that trips
// the most time-sensitive layout sweep (missionControlLayout.test.js:350).
const BROWSER_PASS_CONCURRENCY = 2;

// The one file that may never run inside a pass. Keyed by basename so a rename
// fails loudly in the honesty test rather than silently landing in a pass.
const GUARD_FILENAME = 'noLiveSaveInUnitSuite.test.js';

/** Every tests/**&#47;*.test.js file except tests/live/, sorted. */
function listUnitTestFiles(dir = testsRoot, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'live') continue;
      listUnitTestFiles(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.test.js')) {
      out.push(full);
    }
  }
  return out.sort();
}

/**
 * True when a test file drives a headless browser. Detected from the file's own
 * source: it either calls chromium.launch or requires the reactPrimitivesBrowser
 * fixture (which launches chromium). A new browser test is caught here with no
 * runner edit.
 */
function isBrowserDriving(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  return /chromium\.launch/.test(src)
    || /require\([^)]*reactPrimitivesBrowser/.test(src)
    || /require\([^)]*fixtures\/\w+Browser/.test(src);
}

/** True for the behavioural live-save guard, which must never run inside a pass. */
function isGuardFile(filePath) {
  return path.basename(filePath) === GUARD_FILENAME;
}

/** The browser-driving files, the rest, and the guard file, all sorted. */
function splitPasses() {
  const all = listUnitTestFiles();
  const guard = all.filter(isGuardFile);
  const rest = all.filter(file => !isGuardFile(file));
  const browser = rest.filter(isBrowserDriving);
  const pure = rest.filter(file => !isBrowserDriving(file));
  return { all, browser, pure, guard };
}

module.exports = {
  BROWSER_PASS_CONCURRENCY,
  GUARD_FILENAME,
  listUnitTestFiles,
  isBrowserDriving,
  isGuardFile,
  splitPasses
};
