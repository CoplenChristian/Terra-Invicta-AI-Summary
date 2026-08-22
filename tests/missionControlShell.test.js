// tests/missionControlShell.test.js
//
// Purpose: pins that `/` and `/v2` actually serve the v2 shell, and that they
//   keep serving it from a checkout whose path contains a dot segment.
//
// THE DEFECT THIS FILE EXISTS FOR
// ------------------------------
// `send` 1.2.0 defaults `dotfiles` to 'ignore', and with no `root` option it
// tests EVERY segment of the absolute path, not just the request-relative part.
// `res.sendFile(path.join(__dirname, '../public/v2/index.html'))` therefore
// 404'd for any checkout under a dot-directory -- every agent worktree in
// `.claude/worktrees/` -- while the API routes and `express.static` kept
// working, because both of those set `root`. It presented as a blank dashboard,
// several agents reported different baselines because of it, and it was nearly
// diagnosed as a CSS regression (`tests/cssComputedStyle.test.js` fails there
// for this reason alone).
//
// WHY THE FIRST TWO TESTS ARE THE REAL GUARD
// ------------------------------------------
// A test that only requests `/` from the shipped app can only fail on a
// checkout that already reproduces the bug. In the main checkout it would stay
// green with the defect fully restored -- exactly the "guard that outlives its
// target" this repo has been bitten by. So the first two tests register the
// SHIPPED `shell.register` against a temp `publicDir` that does contain a dot
// segment, with a non-dot directory as the control. Those two fail on ANY
// machine if the root-relative path is reverted to an absolute one.
//
// Verified by deliberate mutation: replacing the handler with
// `res.sendFile(path.join(publicDir, 'v2/index.html'))` turns tests 1, 4 and 5
// red and leaves the control (2) green.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');

const shellRoutes = require('../server/http/routes/shell');

const SHELL_MARKUP = '<!DOCTYPE html>';

/**
 * Builds `<tmp>/<segment>/public/v2/index.html` and returns the public dir.
 *
 * `segment` is the whole point: '.dotseg' reproduces an agent worktree, 'plain'
 * is the control that proves the harness itself works.
 */
function makePublicTree(segment, body) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ti-shell-'));
  const publicDir = path.join(base, segment, 'public');
  fs.mkdirSync(path.join(publicDir, 'v2'), { recursive: true });
  fs.writeFileSync(path.join(publicDir, 'v2', 'index.html'), body, 'utf8');
  return publicDir;
}

/** Starts an app on an ephemeral port and returns a `get` plus a `close`. */
async function serve(app) {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const get = (pathname) => new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path: pathname, method: 'GET' },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on('error', reject);
    req.end();
  });
  return { get, close: () => new Promise(resolve => server.close(resolve)) };
}

test('the shell is served from a publicDir whose path contains a dot segment', async () => {
  const publicDir = makePublicTree('.dotseg', '<!DOCTYPE html><title>dot</title>');
  assert.ok(
    publicDir.split(path.sep).some(part => part.length > 1 && part.startsWith('.')),
    'the fixture must actually contain a dot segment or this test proves nothing'
  );

  const app = express();
  shellRoutes.register(app, { publicDir });
  const { get, close } = await serve(app);
  try {
    for (const route of ['/', '/v2']) {
      const res = await get(route);
      assert.equal(res.status, 200,
        `${route} must serve the shell from a dot-directory checkout, not 404`);
      assert.match(res.body, /<title>dot<\/title>/);
    }
  } finally {
    await close();
  }
});

test('the same registration serves from an ordinary directory (control)', async () => {
  const publicDir = makePublicTree('plain', '<!DOCTYPE html><title>plain</title>');
  const app = express();
  shellRoutes.register(app, { publicDir });
  const { get, close } = await serve(app);
  try {
    const res = await get('/');
    assert.equal(res.status, 200);
    assert.match(res.body, /<title>plain<\/title>/);
  } finally {
    await close();
  }
});

test('express.static still refuses a dotfile under the same root', async () => {
  // The security question the fix has to answer: does serving the shell from a
  // dot-directory checkout also make dotfiles reachable? It does not -- the
  // option is on the shell route, and `express.static` sets its own `root`, so
  // send tests the REQUEST-relative path and a leading dot there still 404s.
  // This goes red if anyone "fixes" the shell by loosening the static mount.
  const publicDir = makePublicTree('.dotseg', '<!DOCTYPE html><title>dot</title>');
  fs.writeFileSync(path.join(publicDir, '.hidden'), 'must not be served', 'utf8');
  fs.writeFileSync(path.join(publicDir, 'visible.txt'), 'ordinary asset', 'utf8');

  const app = express();
  shellRoutes.register(app, { publicDir });
  app.use(express.static(publicDir));
  const { get, close } = await serve(app);
  try {
    const hidden = await get('/.hidden');
    assert.equal(hidden.status, 404, 'a dotfile under public/ must not be served');
    const visible = await get('/visible.txt');
    assert.equal(visible.status, 200, 'ordinary static assets must still be served');
  } finally {
    await close();
  }
});

test('the live app serves the v2 shell at / and at /v2', async () => {
  const app = require('../server/index.js');
  const { get, close } = await serve(app);
  try {
    const root = await get('/');
    const v2 = await get('/v2');
    assert.equal(root.status, 200, '/ must serve the v2 shell');
    assert.equal(v2.status, 200, '/v2 must serve the v2 shell');
    assert.equal(root.body, v2.body, 'both routes must serve the same shell');
    assert.ok(root.body.toUpperCase().includes(SHELL_MARKUP.toUpperCase()));
  } finally {
    await close();
  }
});

test('the served shell is byte-identical to public/v2/index.html', async () => {
  // Pins that the route serves one constant file and reads nothing from the
  // request -- which is why `{ root }` cannot widen what it reaches.
  const onDisk = fs.readFileSync(
    path.join(shellRoutes.DEFAULT_PUBLIC_DIR, shellRoutes.SHELL_RELATIVE_PATH), 'utf8');
  const app = require('../server/index.js');
  const { get, close } = await serve(app);
  try {
    const res = await get('/');
    assert.equal(res.body, onDisk, 'the shell route must serve public/v2/index.html verbatim');
  } finally {
    await close();
  }
});
