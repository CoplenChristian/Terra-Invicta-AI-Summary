const { test } = require('node:test');
const assert = require('node:assert/strict');

const app = require('../server');

test('local publish endpoint requires the runtime token and same-origin request', async () => {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;
    const runtime = await fetch(`${base}/api/runtime`).then(response => response.json());
    assert.equal(typeof runtime.publishToken, 'string');
    assert.ok(runtime.publishToken.length >= 32);

    const missingToken = await fetch(`${base}/api/publish`, {
      method: 'POST',
      headers: { Origin: base }
    });
    assert.equal(missingToken.status, 403);

    const crossOrigin = await fetch(`${base}/api/publish`, {
      method: 'POST',
      headers: {
        Origin: 'http://malicious.example',
        'X-TI-Publish-Token': runtime.publishToken
      }
    });
    assert.equal(crossOrigin.status, 403);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
