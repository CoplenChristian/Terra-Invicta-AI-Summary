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

const app = require('../server');

const EXPECTED_STACK = [
  ['MIDDLEWARE', 'jsonParser'],
  ['GET', ['/', '/v2']],
  ['MIDDLEWARE', 'serveStatic'],
  ['GET', '/api/runtime'],
  ['POST', '/api/publish'],
  ['GET', '/api/saves'],
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
  ['GET', ['/api/snapshot/compact', '/api/snapshot/full', '/latest-snapshot.json', '/latest-snapshot.md']]
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
