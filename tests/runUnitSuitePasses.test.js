// tests/runUnitSuitePasses.test.js
//
// Purpose: keep scripts/run_unit_tests.js's two-pass split honest. The runner
//   routes browser-driving test files into a capped-concurrency pass so a dozen
//   headless Chromiums never compete with each other or with the CPU-bound
//   pure-JS files (the cause of intermittent contention-red runs, measured
//   2026-08-24). This test asserts that:
//
//   1. Every file the classifier routes to the browser pass really does drive a
//      browser (calls chromium.launch or pulls in the reactPrimitivesBrowser
//      fixture), and every file left in the pure pass does not.
//   2. The browser pass is non-empty and not the whole suite -- the split must
//      actually separate work.
//   3. The classifier catches a NEW browser test file, so someone adding one
//      cannot silently land it in the parallel pass and reintroduce the
//      contention this split exists to prevent.
//
// The classifier lives in tests/fixtures/unitTestPasses.js, the single source of
// truth shared with the runner, so the two cannot drift.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { isBrowserDriving, splitPasses, BROWSER_PASS_CONCURRENCY } = require('./fixtures/unitTestPasses');

test('browser/pure split: every browser-pass file drives a browser, every pure-pass file does not', () => {
  const { browser, pure, all } = splitPasses();

  assert.ok(all.length > 0, 'the suite must contain test files');
  assert.ok(browser.length > 0, 'the browser pass must be non-empty');
  assert.ok(browser.length < all.length, 'the browser pass must not swallow the whole suite');

  const misclassified = [];
  for (const file of browser) {
    if (!isBrowserDriving(file)) misclassified.push(`${file}: in browser pass but not detected`);
  }
  for (const file of pure) {
    if (isBrowserDriving(file)) misclassified.push(`${file}: in pure pass but browser-driving`);
  }
  assert.deepStrictEqual(
    misclassified,
    [],
    `pass split is wrong:\n${misclassified.join('\n')}`
  );

  // Every browser file must actually launch chromium (directly or via fixture).
  for (const file of browser) {
    const src = fs.readFileSync(file, 'utf8');
    assert.ok(
      /chromium\.launch/.test(src)
        || /require\([^)]*reactPrimitivesBrowser/.test(src)
        || /require\([^)]*fixtures\/\w+Browser/.test(src),
      `${file}: routed to the browser pass but has no chromium.launch and no browser fixture require`
    );
  }
});

test('browser/pure split catches a NEW browser test file', () => {
  // Simulate a future browser test that calls chromium.launch directly.
  const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runUnitPasses-'));
  const direct = path.join(probeDir, 'browserDirect.test.js');
  const fixture = path.join(probeDir, 'browserFixture.test.js');
  const panelFixture = path.join(probeDir, 'browserPanelFixture.test.js');
  const pureProbe = path.join(probeDir, 'pureProbe.test.js');

  fs.writeFileSync(direct,
    "const { chromium } = require('playwright');\nchromium.launch({ headless: true });\n");
  fs.writeFileSync(fixture,
    "const { withPrimitivesHarnessPage } = require('../../tests/fixtures/reactPrimitivesBrowser.js');\n");
  fs.writeFileSync(panelFixture,
    "const { withMcBudgetHarnessPage } = require('../../tests/fixtures/mcBudgetBrowser.js');\n");
  fs.writeFileSync(pureProbe, "const n = 1 + 1;\n");

  assert.strictEqual(isBrowserDriving(direct), true, 'a direct chromium.launch must be browser-driving');
  assert.strictEqual(isBrowserDriving(fixture), true, 'a browser-fixture require must be browser-driving');
  assert.strictEqual(isBrowserDriving(panelFixture), true, 'a panel browser-fixture require must be browser-driving');
  assert.strictEqual(isBrowserDriving(pureProbe), false, 'a pure-JS file must not be browser-driving');

  fs.rmSync(probeDir, { recursive: true, force: true });
});

test('browser pass concurrency is a sane cap', () => {
  assert.ok(
    Number.isInteger(BROWSER_PASS_CONCURRENCY) && BROWSER_PASS_CONCURRENCY >= 1,
    `BROWSER_PASS_CONCURRENCY must be a positive integer, got ${BROWSER_PASS_CONCURRENCY}`
  );
  // The point of the cap is to keep Chromium count well under the core count
  // that default `node --test` concurrency would use.
  assert.ok(
    BROWSER_PASS_CONCURRENCY <= Math.max(1, os.cpus().length / 2),
    `BROWSER_PASS_CONCURRENCY (${BROWSER_PASS_CONCURRENCY}) must be at most half the core count `
    + `(${os.cpus().length}) or it is not capping anything`
  );
});
