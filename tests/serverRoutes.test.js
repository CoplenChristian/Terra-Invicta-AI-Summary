// tests/serverRoutes.test.js
//
// The 2026-08-20 review (section D) split server/index.js into route modules
// under server/http/. Two things make that safe and neither is caught by any
// behavioural test:
//
//   1. The Express route table is ORDER-SENSITIVE and the split moved every
//      registration into a different file. `app.get(['/', '/v2'])` must stay
//      ahead of `express.static`, or the legacy v1 shell reappears at `/`; and
//      `/api/intel/:resource` deliberately `next()`s for unknown resources so
//      the history, tech and saves routes can answer -- a rule that only holds
//      while those routes are registered after it. The whole table is pinned so
//      a future tidy-up of the module order is a deliberate edit, not a silent
//      reshuffle.
//   2. Nothing must be lost in the move. A route dropped from a register()
//      function would 404 in production and pass every unit test.
//
// The expected table below was captured from the pre-split server/index.js and
// verified identical after the split.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

// The /api/save-state tests need a deterministic newest save. Point the
// save-path config at a throwaway folder BEFORE the server is required, so the
// module-level config resolution in server/saveParser.js, snapshotCache.js and
// requestValidation.js all see it. server/index.js's dotenv load only fills
// unset variables, so it will not override this.
const TEST_SAVE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ti-save-state-'));
process.env.TI_SAVE_PATH = TEST_SAVE_DIR;

const { makeSaveData } = require('./fixtures/syntheticSave');

function writeSyntheticSave(filename, mtime) {
  const saveJson = JSON.stringify({ gamestates: makeSaveData().gamestates });
  const filePath = path.join(TEST_SAVE_DIR, filename);
  fs.writeFileSync(filePath, saveJson);
  fs.utimesSync(filePath, mtime, mtime);
}

// Two saves with controlled mtimes so "newest" is deterministic and the
// selection actually has to decide between them.
writeSyntheticSave('Older.json', new Date('2026-01-01T00:00:00Z'));
writeSyntheticSave('Autosave.json', new Date('2026-01-02T00:00:00Z'));

const app = require('../server');

const EXPECTED_STACK = [
  ['MIDDLEWARE', 'jsonParser'],
  ['GET', ['/', '/v2']],
  ['MIDDLEWARE', 'serveStatic'],
  ['GET', '/api/runtime'],
  ['POST', '/api/publish'],
  ['GET', '/api/saves'],
  ['GET', '/api/save-state'],
  ['GET', '/api/snapshot'],
  ['POST', '/api/refresh'],
  ['GET', '/api/export'],
  ['GET', ['/api/intel', '/api/intel/']],
  ['GET', ['/api/intel/:resource', '/api/:resource']],
  ['POST', ['/api/intel/production-plan', '/api/production-plan']],
  ['GET', '/api/intel/history'],
  ['GET', '/api/intel/history/:saveLastModified'],
  ['GET', '/api/intel/strategic-delta'],
  ['GET', '/api/templates/effects'],
  ['GET', [
    '/api/intel/tech-tree',
    '/api/intel/tech-path',
    '/api/intel/tech-search',
    '/api/intel/tech-milestones',
    '/api/intel/tech-matrix',
    '/api/intel/tech-opportunities',
    '/api/intel/research-queue'
  ]],
  ['GET', '/api/v2/briefing'],
  ['GET', ['/api/snapshot/compact', '/api/snapshot/full', '/latest-snapshot.json', '/latest-snapshot.md']],
  ['GET', '/latest-threats.md'],
  ['GET', '/latest-war-room.md']
];

function actualStack() {
  return app.router.stack.map(layer => (layer.route
    ? [Object.keys(layer.route.methods || {}).sort().join(',').toUpperCase(), layer.route.path]
    : ['MIDDLEWARE', layer.name]));
}

test('the Express route table survives the server/http split unchanged', () => {
  assert.deepEqual(actualStack(), EXPECTED_STACK);
});

test('the dashboard shell is registered ahead of the static middleware', () => {
  // The ONE genuinely order-dependent registration. public/index.html is the
  // legacy v1 dashboard; if express.static wins at `/`, the live v2 UI silently
  // disappears and the old shell is served instead.
  const stack = actualStack();
  const shellIndex = stack.findIndex(([, path]) => Array.isArray(path) && path.includes('/') && path.includes('/v2'));
  const staticIndex = stack.findIndex(([method, name]) => method === 'MIDDLEWARE' && name === 'serveStatic');
  assert.ok(shellIndex >= 0, 'the shell route is registered');
  assert.ok(staticIndex >= 0, 'the static middleware is registered');
  assert.ok(shellIndex < staticIndex, 'the shell route must be registered before express.static');
});

test('the focused-resource handler is registered before the routes that rely on its fall-through', () => {
  // /api/intel/:resource returns next() for anything not in SUPPORTED_RESOURCES.
  // That is what lets /api/intel/history and the seven tech routes be answered
  // by their own handlers. Registering them BEFORE it would still work; moving
  // any of them so they never get reached would not, and would look like a 404
  // only in production.
  const stack = actualStack();
  const paths = stack.map(([, path]) => (Array.isArray(path) ? path.join('|') : path));
  const resourceIndex = paths.findIndex(path => path.startsWith('/api/intel/:resource'));
  assert.ok(resourceIndex >= 0);
  for (const later of ['/api/intel/history', '/api/intel/strategic-delta', '/api/templates/effects']) {
    assert.ok(paths.indexOf(later) > resourceIndex, `${later} is registered after the generic resource handler`);
  }
});

test('every route module registers something and none registers twice', () => {
  const stack = actualStack();
  const routePaths = stack
    .filter(([method]) => method !== 'MIDDLEWARE')
    .flatMap(([, path]) => (Array.isArray(path) ? path : [path]));
  const seen = new Set();
  const duplicates = routePaths.filter(path => {
    if (seen.has(path)) return true;
    seen.add(path);
    return false;
  });
  assert.deepEqual(duplicates, [], 'a path registered twice means a module was mounted twice');

  // Each module contributes at least one entry; a register() that quietly
  // returned early would otherwise be invisible.
  for (const marker of ['/api/runtime', '/api/snapshot', '/api/intel', '/api/intel/history', '/api/templates/effects', '/api/v2/briefing']) {
    assert.ok(seen.has(marker), `${marker} is registered`);
  }
});

async function startServer() {
  return new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
}

async function stopServer(server) {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

test('GET /api/save-state reports the newest save identity without parsing it', async () => {
  const server = await startServer();
  try {
    const base = `http://127.0.0.1:${server.address().port}`;

    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => { logs.push(args.join(' ')); };
    let elapsedMs = Infinity;
    let payload;
    let status;
    try {
      // Warm-up: the first request on a fresh server pays connection and JIT
      // setup costs that have nothing to do with the route's stat-and-hash
      // work. Measure the second request so the timing is the route's.
      await fetch(`${base}/api/save-state`);
      const startedAt = Date.now();
      const response = await fetch(`${base}/api/save-state`);
      elapsedMs = Date.now() - startedAt;
      status = response.status;
      payload = await response.json();
    } finally {
      console.log = originalLog;
    }

    assert.equal(status, 200);
    assert.equal(payload.success, true);
    assert.ok(/^[0-9a-f]{24}$/.test(payload.snapshotId), 'snapshotId is the 24-hex identity');
    assert.ok(/^[0-9a-f]{64}$/.test(payload.saveHash), 'saveHash is the sha256');
    assert.ok(payload.saveModifiedAt, 'saveModifiedAt is present');
    assert.equal(payload.saveFilename, 'Autosave.json', 'the newest save is selected, not the older one');
    assert.equal(payload.campaignDate, null, 'campaignDate stays null without a parse');

    const body = JSON.stringify(payload);
    assert.ok(!('fullPath' in payload), 'no fullPath key is exposed');
    assert.ok(!body.includes(TEST_SAVE_DIR), 'the absolute save-folder path never appears in the response');
    assert.ok(!payload.saveFilename.includes('/') && !payload.saveFilename.includes('\\'), 'saveFilename is a bare basename');
    assert.ok(!body.includes('Older.json'), 'the older save is not the one reported');

    assert.ok(elapsedMs < 50, `save-state completed in ${elapsedMs}ms, expected under 50ms`);
    assert.ok(!logs.some(line => line.includes('[Server] Parsing save')), 'save-state must never parse the save');
  } finally {
    await stopServer(server);
  }
});

test('GET /api/save-state snapshotId is byte-identical to /api/snapshot for the same save', async () => {
  const server = await startServer();
  try {
    const base = `http://127.0.0.1:${server.address().port}`;

    const saveState = await fetch(`${base}/api/save-state`).then(response => response.json());
    const snapshot = await fetch(`${base}/api/snapshot?mode=player&observer=4712`).then(response => response.json());

    assert.equal(snapshot.success, true, 'the synthetic save parses through the snapshot pipeline');
    assert.equal(snapshot.snapshotId, saveState.snapshotId, 'snapshotId matches what the cache derives');
    assert.equal(snapshot.saveHash, saveState.saveHash, 'saveHash matches what the cache derives');
    assert.equal(snapshot.saveModifiedAt, saveState.saveModifiedAt, 'saveModifiedAt matches what the cache derives');
    assert.equal(snapshot.activeSnapshot.saveFilename, saveState.saveFilename);
  } finally {
    await stopServer(server);
  }
});
