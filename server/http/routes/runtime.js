/**
 * server/http/routes/runtime.js -- routes that describe the local install
 * rather than the contents of a save.
 *
 * None of these three reads a filtered snapshot: /api/runtime reports what this
 * runtime can do, /api/publish is the local-only publish capability, and
 * /api/saves lists what is on disk. That is the boundary -- they need no
 * observer, no mode and no save parse.
 */

const { resolveConfig, safeRuntimeConfig } = require('../../config');
const saveParser = require('../../saveParser');
const publishControl = require('../publishControl');

const runtimeConfig = resolveConfig();

function register(app) {
  // Runtime capabilities let the browser distinguish the local file-backed
  // dashboard from the hosted read-only worker. The hosted worker exposes the
  // same route with canPublish=false.
  app.get('/api/runtime', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
      success: true,
      environment: process.env.NODE_ENV === 'development' ? 'dev' : 'local',
      canPublish: true,
      canRefresh: true,
      supportedModes: runtimeConfig.publishing.observerModes,
      // Local runs parse the save directly, so every faction is selectable.
      // null means "no restriction"; the hosted worker returns a real list.
      availableObservers: null,
      defaultMode: runtimeConfig.server.defaultMode,
      defaults: safeRuntimeConfig(runtimeConfig),
      publishToken: publishControl.publishToken,
      source: 'express'
    });
  });

  publishControl.register(app);

  // 1. Available saves list
  app.get('/api/saves', (req, res) => {
    try {
      const saves = saveParser.getAvailableSaves();
      res.json({ success: true, saves });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
}

module.exports = { register };
