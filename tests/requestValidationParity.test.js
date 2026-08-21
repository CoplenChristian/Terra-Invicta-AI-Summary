// tests/requestValidationParity.test.js
//
// The 2026-08-20 review (section D) named the concrete reason the two runtimes
// duplicated validation: `server/requestValidation.js` is CommonJS and the
// Cloudflare worker cannot `require` it, so the worker grew a second
// hand-written copy of every rule. The fix is `shared/requestValidation.mjs`,
// which both now import.
//
// A shared module only prevents drift if both sides actually route their
// decisions through it, so this file asserts three things:
//
//   1. The local server's parsers ARE the shared module's own function objects,
//      not copies (one deliberate exception, asserted as such).
//   2. The hosted worker's validator imports from the same shared file, and
//      resolves to the same functions once bundled the way the build bundles it.
//   3. Across a matrix of inputs the two runtimes reach the SAME accept/reject
//      decision. Their rejection MESSAGES differ and are left alone -- both
//      wordings are published contract -- so this compares decisions, which is
//      the half that must never diverge.
//
// It also pins the one place where the two runtimes genuinely disagree, so the
// gap is a recorded fact rather than a surprise.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const PROJECT_ROOT = path.resolve(__dirname, '..');

const shared = require('../shared/requestValidation.mjs');
const serverValidation = require('../server/requestValidation');

/** Materialises the worker exactly the way scripts/build_static_snapshot.js does. */
function buildWorkerBundle() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ti-parity-'));
  fs.cpSync(path.join(PROJECT_ROOT, 'shared'), path.join(dir, 'shared'), { recursive: true });
  const workerDir = path.join(PROJECT_ROOT, 'site', 'worker');
  for (const name of fs.readdirSync(workerDir)) {
    if (!name.endsWith('.js') || name === 'static-assets.js') continue;
    fs.writeFileSync(
      path.join(dir, name),
      fs.readFileSync(path.join(workerDir, name), 'utf8').replaceAll("from '../shared/", "from './shared/")
    );
  }
  fs.writeFileSync(path.join(dir, 'static-assets.js'), 'export const staticAssets = {};\n');
  return dir;
}

let cachedProjections = null;
async function loadWorkerProjections() {
  if (!cachedProjections) {
    const dir = buildWorkerBundle();
    cachedProjections = await import(pathToFileURL(path.join(dir, 'projections.js')).href);
  }
  return cachedProjections;
}

const resourceUrl = (query, pathname = '/api/intel/nations') =>
  new URL(`https://hosted.test${pathname}${query}`);

test('the local server re-exports the shared rules rather than copying them', () => {
  for (const name of [
    'RequestValidationError',
    'parseMode',
    'assertKnownObserver',
    'parseOptionalNumericQuery',
    'parseBodyQuery',
    'parseBoundedIntegerQuery',
    'isPositiveIntegerId',
    'parsePositiveIntegerOrNull',
    'exceedsBodyFilterLimits',
    'isBoundedInteger',
    'usesQuantityAsLimit'
  ]) {
    assert.strictEqual(serverValidation[name], shared[name], `${name} must be the shared module's own export`);
  }

  // The ONE deliberate wrapper: the local default observer id is configuration
  // (campaign.defaultObserverFactionId, overridable by SUPABASE_OBSERVER_FACTION_ID)
  // while the hosted worker resolves its own, so the server binds the default
  // rather than re-exporting the shared parser directly. It must still agree
  // with the shared function called with that same default.
  assert.notStrictEqual(serverValidation.parseObserverId, shared.parseObserverId);
  const configuredDefault = require('../server/config').resolveConfig().campaign.defaultObserverFactionId;
  assert.equal(serverValidation.parseObserverId(undefined), shared.parseObserverId(undefined, configuredDefault));
  assert.equal(serverValidation.parseObserverId('4717'), shared.parseObserverId('4717', configuredDefault));

  // resolveSavePath stays local: it touches the filesystem, which the worker
  // does not have. Sharing it would put `fs` into a worker import.
  assert.equal(typeof serverValidation.resolveSavePath, 'function');
  assert.equal(shared.resolveSavePath, undefined);
});

test('the hosted worker takes its decisions from the same shared module', async () => {
  const source = fs.readFileSync(path.join(PROJECT_ROOT, 'site', 'worker', 'projections.js'), 'utf8');
  assert.match(source, /from '\.\.\/shared\/requestValidation\.mjs'/,
    'the worker must import the shared rules, not restate them');
  // No second copy of the id regex anywhere in the worker: that literal is the
  // shape the duplicate copy took last time.
  for (const name of fs.readdirSync(path.join(PROJECT_ROOT, 'site', 'worker'))) {
    if (!name.endsWith('.js')) continue;
    const body = fs.readFileSync(path.join(PROJECT_ROOT, 'site', 'worker', name), 'utf8');
    const idChecks = body.match(/Number\.isSafeInteger/g) || [];
    assert.ok(
      idChecks.length <= 1,
      `${name} restates the safe-integer rule ${idChecks.length} times; it belongs in shared/requestValidation.mjs`
    );
  }

  const projections = await loadWorkerProjections();
  assert.equal(typeof projections.validateResourceQuery, 'function');
});

test('both runtimes accept and reject the same faction filters', async () => {
  const { validateResourceQuery } = await loadWorkerProjections();
  const cases = ['4712', '1', '0', '-4', 'abc', '4712.5', ' 4712', '99999999999999999999', '007'];

  for (const value of cases) {
    let serverRejected = false;
    try {
      serverValidation.parseOptionalNumericQuery(value, 'faction filter');
    } catch {
      serverRejected = true;
    }
    const workerRejected = validateResourceQuery(resourceUrl(`?faction=${encodeURIComponent(value)}`)) !== null;
    assert.equal(serverRejected, workerRejected, `faction='${value}' decided differently by the two runtimes`);
  }
});

test('both runtimes accept and reject the same body filters', async () => {
  const { validateResourceQuery } = await loadWorkerProjections();
  const cases = ['Ceres', 'Mars', 'x'.repeat(80), 'x'.repeat(81), `Ce${String.fromCharCode(1)}res`];

  for (const value of cases) {
    let serverRejected = false;
    try {
      serverValidation.parseBodyQuery(value);
    } catch {
      serverRejected = true;
    }
    const workerRejected = validateResourceQuery(resourceUrl(`?body=${encodeURIComponent(value)}`, '/api/intel/mining')) !== null;
    assert.equal(serverRejected, workerRejected, `body='${JSON.stringify(value)}' decided differently by the two runtimes`);
  }
});

test('both runtimes accept and reject the same mining limits', async () => {
  const { validateResourceQuery } = await loadWorkerProjections();
  const cases = ['1', '50', '100', '101', '0', 'abc', '', '99999999999999999999'];

  for (const value of cases) {
    let serverRejected = false;
    try {
      serverValidation.parseBoundedIntegerQuery(value, 'mining prospects limit');
    } catch {
      serverRejected = true;
    }
    const url = resourceUrl(`?limit=${encodeURIComponent(value)}`, '/api/intel/mining-prospects');
    const workerRejected = validateResourceQuery(url) !== null;
    assert.equal(serverRejected, workerRejected, `limit='${value}' decided differently by the two runtimes`);
  }
});

test('the digits-and-bounds rule and the safe-integer rule agree for every bounds pair in use', () => {
  // The hosted worker used to check digits plus bounds; the local server also
  // checked Number.isSafeInteger. Unifying on the stricter rule is only safe
  // because the two are equivalent inside [1, 100] -- asserted here rather than
  // argued for in a comment.
  const looseRule = (raw, { min, max }) => /^\d+$/.test(String(raw)) && Number(raw) >= min && Number(raw) <= max;
  const inputs = ['0', '1', '25', '100', '101', '', 'abc', '-1', '1e3', '0000000000000000000005', '99999999999999999999',
    String(Number.MAX_SAFE_INTEGER), String(Number.MAX_SAFE_INTEGER + 2)];

  for (const bounds of [shared.MINING_LIMIT_BOUNDS, shared.HISTORY_LIMIT_BOUNDS]) {
    for (const raw of inputs) {
      assert.equal(
        shared.isBoundedInteger(raw, bounds),
        looseRule(raw, bounds),
        `'${raw}' decided differently by the strict and loose bounded-integer rules`
      );
    }
  }
});

test('the mining quantity-as-limit alias covers the same resources in both runtimes', async () => {
  const { validateResourceQuery } = await loadWorkerProjections();
  assert.deepEqual([...shared.MINING_LIMIT_RESOURCES].sort(), ['mining-expansion', 'mining-prospects']);

  // ?quantity= is only read as a limit for those two resources. For any other
  // resource a malformed quantity is not a limit error in either runtime.
  for (const resource of ['mining-prospects', 'mining-expansion']) {
    for (const pathname of [`/api/intel/${resource}`, `/api/${resource}`]) {
      assert.ok(
        validateResourceQuery(resourceUrl('?quantity=999', pathname)) !== null,
        `${pathname} must validate ?quantity as a limit`
      );
    }
  }
  assert.equal(validateResourceQuery(resourceUrl('?quantity=999', '/api/intel/nations')), null);
});

test('the one recorded parity gap: a malformed history limit', async () => {
  // Local /api/intel/history rejects `?limit=abc` with a 400. The hosted route
  // coerces it to the default page size instead. Both runtimes now share the
  // validation RULES, but the hosted wire behaviour is deliberately unchanged:
  // altering what an existing client gets back is a behaviour change, not a
  // refactor. This test exists so the gap stays a known, deliberate fact.
  assert.throws(
    () => serverValidation.parseBoundedIntegerQuery('abc', 'history limit', {
      min: shared.HISTORY_LIMIT_BOUNDS.min,
      max: shared.HISTORY_LIMIT_BOUNDS.max,
      defaultValue: shared.HISTORY_LIMIT_DEFAULT
    }),
    /Invalid history limit/
  );

  const dir = buildWorkerBundle();
  const { boundedHistoryLimit } = await import(pathToFileURL(path.join(dir, 'supabaseReader.js')).href);
  assert.equal(boundedHistoryLimit('abc'), shared.HISTORY_LIMIT_DEFAULT, 'hosted coercion is unchanged');
  assert.equal(boundedHistoryLimit('0'), shared.HISTORY_LIMIT_DEFAULT);
  assert.equal(boundedHistoryLimit('500'), shared.HISTORY_LIMIT_BOUNDS.max, 'clamped, not rejected');
  assert.equal(boundedHistoryLimit('3'), 3);
});

test('control characters are recognised by code point, not by a literal in source', () => {
  // The class used to be written as a regex containing raw control bytes, which
  // is unreviewable in a diff. Behaviour must be identical: C0 range plus DEL.
  for (let code = 0; code < 0x20; code += 1) {
    assert.equal(shared.hasControlCharacters(String.fromCharCode(code)), true, `U+${code.toString(16)} is a control character`);
  }
  assert.equal(shared.hasControlCharacters(String.fromCharCode(0x7f)), true, 'DEL is a control character');
  assert.equal(shared.hasControlCharacters(' '), false);
  assert.equal(shared.hasControlCharacters('Ceres'), false);
  assert.equal(shared.hasControlCharacters(''), false);
  assert.equal(shared.stripControlCharacters(`a${String.fromCharCode(10)}b`), 'a?b');
  assert.equal(shared.stripControlCharacters('plain'), 'plain');
});
