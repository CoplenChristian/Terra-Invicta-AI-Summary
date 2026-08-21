/**
 * server/http/publishControl.js -- the local-only publish capability.
 *
 * This is the one route in the local server that runs a process holding
 * SUPABASE_SERVICE_ROLE_KEY, so it is kept as a single file that can be read end
 * to end: the token, the same-origin rule, the authorization decision, the
 * single-flight guard and the spawn are all here and nothing else in the HTTP
 * layer touches them.
 *
 * The service role key itself is never read here. It reaches the publisher only
 * by being inherited through `process.env` into the spawned child, exactly as it
 * did before this split. The hosted worker has no equivalent of this file and
 * answers /api/publish with a 404.
 */

const crypto = require('crypto');
const path = require('path');
const { spawn } = require('child_process');

const { resolveConfig } = require('../config');

const runtimeConfig = resolveConfig();
const PUBLISH_TIMEOUT_MS = runtimeConfig.server.publishTimeoutMs;

// A per-process token turns the local publish route into an explicit local
// capability. The browser obtains it through the same-origin runtime probe;
// a cross-origin form cannot set the custom header, so it cannot trigger the
// service-role-backed publisher.
const publishToken = crypto.randomBytes(32).toString('hex');

let activePublisherProcess = null;

function sameOrigin(req) {
  const origin = req.get('origin');
  if (origin) {
    const expected = `${req.protocol}://${req.get('host')}`;
    if (origin !== expected) return false;
  }
  const fetchSite = req.get('sec-fetch-site');
  return !fetchSite || fetchSite === 'same-origin' || fetchSite === 'same-site' || fetchSite === 'none';
}

function hasValidPublishToken(req) {
  const supplied = req.get('x-ti-publish-token') || '';
  const expected = Buffer.from(publishToken, 'utf8');
  const actual = Buffer.from(supplied, 'utf8');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function isPublishAuthorized(req) {
  return sameOrigin(req) && hasValidPublishToken(req);
}

// Publish the newest save through the same Node publisher used by
// push_latest_to_supabase.ps1. This endpoint exists only in the local
// Express server; the hosted worker explicitly rejects it.
function handlePublish(req, res) {
  if (!isPublishAuthorized(req)) {
    return res.status(403).json({
      success: false,
      error: 'Publishing requires a same-origin request with the current local publish token.'
    });
  }
  if (activePublisherProcess) {
    return res.status(409).json({
      success: false,
      error: 'A save publish is already in progress.'
    });
  }

  const publisherPath = path.join(__dirname, '../../scripts/push_latest_to_supabase.js');
  let stdout = '';
  let responded = false;
  let timeoutHandle = null;

  const publisher = spawn(process.execPath, [publisherPath], {
    cwd: path.join(__dirname, '../..'),
    env: { ...process.env },
    windowsHide: true
  });
  activePublisherProcess = publisher;

  timeoutHandle = setTimeout(() => {
    if (responded) return;
    responded = true;
    activePublisherProcess = null;
    publisher.kill();
    res.status(504).json({
      success: false,
      error: 'The latest save publisher timed out. Check the local server console before retrying.'
    });
  }, PUBLISH_TIMEOUT_MS);

  publisher.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    if (stdout.length < 100000) stdout += text;
    process.stdout.write(`[Publisher] ${text}`);
  });

  publisher.stderr.on('data', (chunk) => {
    process.stderr.write(`[Publisher] ${chunk.toString()}`);
  });

  publisher.once('error', (err) => {
    clearTimeout(timeoutHandle);
    activePublisherProcess = null;
    if (responded) return;
    responded = true;
    res.status(500).json({
      success: false,
      error: `Could not start the save publisher: ${err.message}`
    });
  });

  publisher.once('close', (code) => {
    clearTimeout(timeoutHandle);
    activePublisherProcess = null;
    if (responded) return;
    responded = true;

    if (code !== 0) {
      return res.status(500).json({
        success: false,
        error: 'The latest save could not be published. Check the local server console for details.'
      });
    }

    const saveMatch = stdout.match(/^Target Save:\s+(.+)$/m);
    const dateMatch = stdout.match(/^In-Game Date:\s+(.+)$/m);
    res.json({
      success: true,
      message: 'Latest save published to hosted Supabase.',
      saveFilename: saveMatch ? saveMatch[1].trim() : null,
      gameTime: dateMatch ? dateMatch[1].trim() : null
    });
  });
}

function register(app) {
  app.post('/api/publish', handlePublish);
}

module.exports = {
  publishToken,
  isPublishAuthorized,
  handlePublish,
  register
};
