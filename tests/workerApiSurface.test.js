const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const PROJECT_ROOT = path.resolve(__dirname, '..');

/**
 * Materializes the hosted worker exactly the way scripts/build_static_snapshot.js
 * does: copy site/worker/index.js beside a copy of shared/, rewrite
 * `from '../shared/` to `from './shared/`, and generate static-assets.js.
 *
 * The Cloudflare worker cannot `require` CommonJS, so any module the worker and
 * the Express server share has to be ESM under shared/ and has to survive that
 * rewrite. This test is what proves it, rather than assuming it.
 */
function buildWorkerBundle() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ti-worker-'));
  fs.cpSync(path.join(PROJECT_ROOT, 'shared'), path.join(dir, 'shared'), { recursive: true });
  const workerSource = fs.readFileSync(path.join(PROJECT_ROOT, 'site', 'worker', 'index.js'), 'utf8')
    .replaceAll("from '../shared/", "from './shared/");
  fs.writeFileSync(path.join(dir, 'index.js'), workerSource);
  fs.writeFileSync(
    path.join(dir, 'static-assets.js'),
    'export const staticAssets = {"index.html":"<!doctype html>local","v2/index.html":"<!doctype html>v2"};\n'
  );
  return dir;
}

let cachedWorker = null;
async function loadWorker() {
  if (!cachedWorker) {
    const dir = buildWorkerBundle();
    cachedWorker = (await import(pathToFileURL(path.join(dir, 'index.js')).href)).default;
  }
  return cachedWorker;
}

const request = (url, init) => new Request(url, init);

test('the hosted worker still builds and serves after the shared-module extraction', async () => {
  const worker = await loadWorker();
  assert.equal(typeof worker.fetch, 'function');

  const response = await worker.fetch(request('https://example.test/api/intel?format=json'), {});
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.success, true);
  assert.equal(payload.source, 'hosted-worker');
  assert.equal(payload.name, 'Terra Invicta Strategic Intelligence API');
  assert.ok(Object.keys(payload.endpoints).length > 10);
});

test('worker and Express serve a byte-identical API index page', async () => {
  const worker = await loadWorker();
  const shared = await import(pathToFileURL(path.join(PROJECT_ROOT, 'shared', 'apiSurface.mjs')).href);
  const intelResources = require('../server/intelResources');
  const { DEFAULT_OBSERVER_FACTION_ID } = require('../shared/constants.mjs');

  const response = await worker.fetch(request('https://example.test/api/intel'), {});
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  const workerHtml = await response.text();

  const expressPayload = shared.buildIntelApiIndex({
    source: 'local',
    endpoints: intelResources.INTEL_ENDPOINT_INDEX,
    examples: intelResources.INTEL_ENDPOINT_EXAMPLES,
    defaultObserverFactionId: DEFAULT_OBSERVER_FACTION_ID
  });
  const expressHtml = shared.renderIntelApiIndexHtml(expressPayload, {
    defaultObserverFactionId: DEFAULT_OBSERVER_FACTION_ID
  });

  // The whole point of the extraction: one edit to INTEL_ENDPOINT_INDEX now
  // reaches both runtimes, so the two pages cannot drift.
  assert.equal(workerHtml, expressHtml);
  assert.ok(workerHtml.includes('&amp;mode=omniscient'), 'query separators stay escaped');
  // Angle brackets in an example value (mobility's `fleet=<fleetId>`) used to
  // reach the page raw, where a browser swallowed them as an unknown tag.
  assert.ok(workerHtml.includes('&lt;fleetId&gt;'), 'angle brackets are escaped');
  const withoutEntities = workerHtml.replace(/&(?:amp|lt|gt|quot);/g, '');
  assert.ok(!withoutEntities.includes('&'), 'no bare ampersand survives escaping');
});

test('worker CORS advertises no credential header and never allows credentials', async () => {
  const worker = await loadWorker();
  const preflight = await worker.fetch(request('https://example.test/api/intel/summary', { method: 'OPTIONS' }), {});
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-headers'), 'Content-Type');
  assert.equal(preflight.headers.get('access-control-allow-credentials'), null);
  // The site deliberately publishes read-only intel for external analysis
  // clients, so the wildcard origin is the intended policy and is asserted
  // here so a future tightening is a deliberate decision rather than a silent
  // break of the documented /api/intel/* readers.
  assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
});

test('worker forwards only safe headers to the assets binding', async () => {
  const worker = await loadWorker();
  let seenHeaders = null;
  const env = {
    ASSETS: {
      fetch: async (assetRequest) => {
        seenHeaders = [...assetRequest.headers.keys()];
        return new Response('ok', { status: 200 });
      }
    }
  };

  await worker.fetch(request('https://example.test/v2/', {
    headers: {
      accept: 'text/html',
      cookie: 'session=secret',
      authorization: 'Bearer secret',
      'x-forwarded-for': '203.0.113.9'
    }
  }), env);

  assert.ok(seenHeaders, 'the assets binding was called');
  assert.ok(seenHeaders.includes('accept'), 'accept is still forwarded');
  for (const leaked of ['cookie', 'authorization', 'x-forwarded-for']) {
    assert.ok(!seenHeaders.includes(leaked), `${leaked} must not reach the assets binding`);
  }
});

test('worker reports Supabase unconfigured rather than querying with a missing key', async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(request('https://example.test/api/intel/summary'), {});
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.success, false);
  assert.match(payload.error, /not configured/i);

  // No SUPABASE_URL is set anywhere in this file, so nothing here makes an
  // outbound request; the runtime probe still has to answer.
  const runtimeResponse = await worker.fetch(request('https://example.test/api/runtime'), {});
  const runtime = await runtimeResponse.json();
  assert.equal(runtime.success, true);
  assert.equal(runtime.canPublish, false, 'the hosted worker must never advertise publishing');
  assert.equal(runtime.environment, 'hosted');
});

test('the publishable key wins over the deprecated anon key, and the service role key is never read', async () => {
  const { resolveSupabaseReadKey } = await import(
    pathToFileURL(path.join(PROJECT_ROOT, 'shared', 'apiSurface.mjs')).href
  );

  assert.deepEqual(
    resolveSupabaseReadKey({ SUPABASE_PUBLISHABLE_KEY: 'pub', SUPABASE_ANON_KEY: 'anon' }),
    { key: 'pub', source: 'SUPABASE_PUBLISHABLE_KEY', deprecated: false }
  );
  // A deployment that has not renamed the variable keeps working, and says so.
  assert.deepEqual(
    resolveSupabaseReadKey({ SUPABASE_ANON_KEY: 'anon' }),
    { key: 'anon', source: 'SUPABASE_ANON_KEY', deprecated: true }
  );
  assert.deepEqual(
    resolveSupabaseReadKey({}),
    { key: null, source: null, deprecated: false }
  );
  // Empty string is absent, not a key.
  assert.equal(resolveSupabaseReadKey({ SUPABASE_PUBLISHABLE_KEY: '', SUPABASE_ANON_KEY: 'anon' }).key, 'anon');
  // The service role key is local-publisher-only and must never be resolvable
  // through a path the worker shares.
  assert.equal(resolveSupabaseReadKey({ SUPABASE_SERVICE_ROLE_KEY: 'service' }).key, null);

  // Comments may name the service role key to explain why it is absent; code
  // must not. Strip comments before checking so the guard is about behaviour.
  const stripComments = (source) => source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const relative of [['site', 'worker', 'index.js'], ['shared', 'apiSurface.mjs']]) {
    const source = stripComments(fs.readFileSync(path.join(PROJECT_ROOT, ...relative), 'utf8'));
    assert.ok(
      !source.includes('SERVICE_ROLE'),
      `${relative.join('/')} must not read the service role key outside comments`
    );
  }
});

test('worker rejects a malformed observer and falls back loudly for a malformed deployment default', async () => {
  const worker = await loadWorker();
  const bad = await worker.fetch(request('https://example.test/api/intel/summary?observer=abc'), {});
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /Invalid observer faction/);

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const response = await worker.fetch(request('https://example.test/api/runtime'), {
      SUPABASE_OBSERVER_FACTION_ID: '47x12'
    });
    const runtime = await response.json();
    // A malformed deployment variable must not silently masquerade as a
    // deliberate configuration: it falls back to the documented default and
    // says so in the worker log.
    assert.equal(runtime.defaults.defaultObserverFactionId, 4712);
    assert.ok(warnings.some(line => line.includes('SUPABASE_OBSERVER_FACTION_ID')), 'the malformed value is reported');
  } finally {
    console.warn = originalWarn;
  }
});

test('shared export markdown selection matches the behaviour it replaced', async () => {
  const { selectExportMarkdown, hasExportMarkdown } = await import(
    pathToFileURL(path.join(PROJECT_ROOT, 'shared', 'apiSurface.mjs')).href
  );
  assert.equal(selectExportMarkdown({ compact: 'c', full: 'f' }, 'full'), 'f');
  assert.equal(selectExportMarkdown({ compact: 'c', full: 'f' }, 'compact'), 'c');
  assert.equal(selectExportMarkdown({ compact: 'c' }, 'full'), 'c', 'falls back to the other variant');
  assert.equal(selectExportMarkdown({ full: 'f' }, 'chatgpt'), 'f');
  assert.equal(selectExportMarkdown(null, 'full'), '');
  assert.equal(selectExportMarkdown({}, 'compact'), '');
  assert.equal(hasExportMarkdown({}), false);
  assert.equal(hasExportMarkdown({ compact: '' }), false);
  assert.equal(hasExportMarkdown({ compact: 'c' }), true);
});
