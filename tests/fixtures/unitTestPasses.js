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

/** The browser-driving files and the rest, both sorted. */
function splitPasses() {
  const all = listUnitTestFiles();
  const browser = all.filter(isBrowserDriving);
  const pure = all.filter(file => !isBrowserDriving(file));
  return { all, browser, pure };
}

module.exports = {
  BROWSER_PASS_CONCURRENCY,
  listUnitTestFiles,
  isBrowserDriving,
  splitPasses
};
