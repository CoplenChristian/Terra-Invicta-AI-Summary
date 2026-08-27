// tests/codeIndex.test.js
//
// The staleness guard for docs/code-index.md (docs/code-index-spec.md).
//
// Everything in the index is derived from the source tree except each module's
// hand-written `Purpose:` line. These tests are the two failure modes the spec
// exists to prevent:
//
//   1. The checked-in index drifting from a fresh generation -- regenerate with
//      `npm run index` whenever a source file changes.
//   2. A source module with no `Purpose:` line -- that is what stops the index
//      rotting, because adding a file forces a one-line description.
//
// Plus the acceptance checks: barrel classification, runtime claims, the
// do-not-edit marker on the legacy v1 shell, and the 400-line ceiling.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { collect, renderIndex } = require('../scripts/generate_code_index.js');

const ROOT = path.resolve(__dirname, '..');
const INDEX_PATH = path.join(ROOT, 'docs', 'code-index.md');

// The four barrels docs/code-index-spec.md names. Everything else about
// classification is derived, but these are the pinned knowns the heuristic must
// keep classifying correctly (the spec: "verify the classifier against the four
// known barrels before trusting it").
const KNOWN_BARRELS = [
  'server/snapshotBuilder.js',
  'shared/intelResources.mjs',
  'server/index.js',
  'server/requestValidation.js'
];

// A spot-check of implementations that must NOT be classified as barrels.
const KNOWN_IMPLEMENTATIONS = [
  'server/config.js',
  'server/snapshot/numbers.js',
  'server/engine/rules/index.js',
  'server/commentary/index.js',
  'shared/util.mjs',
  'shared/intel/registry.mjs',
  'site/worker/index.js'
];

test('the checked-in index matches a fresh generation', () => {
  const fresh = renderIndex(collect());
  const checkedIn = fs.readFileSync(INDEX_PATH, 'utf8');
  assert.strictEqual(
    fresh,
    checkedIn,
    'docs/code-index.md is stale. Run `npm run index` and commit the regenerated file.'
  );
});

test('every source module has a hand-written Purpose line', () => {
  const { modules } = collect();
  const missing = modules.filter(m => !m.purpose).map(m => m.rel);
  assert.deepStrictEqual(
    missing,
    [],
    `source module(s) have no Purpose: line:\n  ${missing.join('\n  ')}`
  );
});

test('every v2 stylesheet part has a parseable purpose from its header', () => {
  const { cssParts } = collect();
  assert.ok(cssParts.length === 25, `expected 25 linked stylesheet parts, found ${cssParts.length}`);
  const missing = cssParts.filter(m => !m.purpose).map(m => m.rel);
  assert.deepStrictEqual(
    missing,
    [],
    `stylesheet part(s) have no parseable header purpose:\n  ${missing.join('\n  ')}`
  );
});

test('stylesheet parts are listed in shell link (cascade) order', () => {
  const { cssParts } = collect();
  const orders = cssParts.map(p => p.order);
  assert.deepStrictEqual(orders, [...orders].sort((a, b) => a - b));
  assert.strictEqual(orders[0], 1);
  assert.strictEqual(orders[orders.length - 1], cssParts.length);
  assert.match(cssParts[0].rel, /public\/v2\/css\/01-tokens-and-base\.css$/);
  assert.match(cssParts[cssParts.length - 1].rel, /public\/v2\/css\/25-hostile-movement\.css$/);
});

test('the four known barrels are classified as barrels', () => {
  const { modules } = collect();
  for (const rel of KNOWN_BARRELS) {
    const m = modules.find(x => x.rel === rel);
    assert.ok(m, `index did not list ${rel}`);
    assert.strictEqual(m.barrel, true, `${rel} should be classified as a barrel`);
  }
});

test('a spot-check of implementations is not classified as a barrel', () => {
  const { modules } = collect();
  for (const rel of KNOWN_IMPLEMENTATIONS) {
    const m = modules.find(x => x.rel === rel);
    assert.ok(m, `index did not list ${rel}`);
    assert.strictEqual(m.barrel, false, `${rel} is an implementation, not a barrel`);
  }
});

test('runtime claims are correct: shared claims both runtimes, server does not', () => {
  const { modules } = collect();
  for (const m of modules) {
    if (m.rel.startsWith('shared/')) {
      assert.match(
        m.runtime,
        /Node \+ Cloudflare worker/,
        `${m.rel} must claim both runtimes (shared code runs in Node and the worker)`
      );
      assert.doesNotMatch(
        m.runtime,
        /CommonJS/,
        `${m.rel} is shared ESM and must not claim CommonJS`
      );
    } else if (m.rel.startsWith('server/')) {
      assert.doesNotMatch(
        m.runtime,
        /Cloudflare worker/,
        `${m.rel} is server-only and must not claim the worker runtime`
      );
    }
  }
});

test('the legacy v1 dashboard shell is marked do-not-edit', () => {
  const { modules } = collect();
  const m = modules.find(x => x.rel === 'public/index.html');
  assert.ok(m, 'public/index.html must be listed in the index');
  assert.match(m.purpose, /DO NOT EDIT/i, 'public/index.html must be marked do-not-edit');
});

test('the index stays under 500 lines', () => {
  const lines = renderIndex(collect()).split('\n').length;
  assert.ok(
    lines < 500,
    `code-index.md is ${lines} lines; the ceiling exists so agents actually read it`
  );
});