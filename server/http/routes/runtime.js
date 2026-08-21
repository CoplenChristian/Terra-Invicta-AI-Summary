/**
 * server/http/routes/runtime.js -- routes that describe the local install
 * rather than the contents of a save.
 * Purpose: routes that describe the local install — /api/runtime, /api/publish,
 *   /api/saves, /api/save-state — rather than a save's contents.
 *
 * None of these reads a filtered snapshot: /api/runtime reports what this
 * runtime can do, /api/publish is the local-only publish capability, /api/saves
 * lists what is on disk, and /api/save-state fingerprints the newest save
 * without parsing it. That is the boundary -- they need no observer, no mode
 * and no save parse.
 */

const { resolveConfig, safeRuntimeConfig } = require('../../config');
const saveParser = require('../../saveParser');
const snapshotIdentity = require('../../snapshotIdentity');
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

  // 2. Newest save identity without parsing. The dashboard polls this to offer
  // a newly written save; it is deliberately NOT a snapshot route, because a
  // poll that triggered a parse would cost ~885 ms per new save. This route is
  // stat + sha256 only (~5 ms), and reports the newest save's identity computed
  // the same way snapshotCache.loadOrGetSnapshot computes it, so a client can
  // compare snapshotIds byte-for-byte. campaignDate needs a parse, so it stays
  // null here -- absent stays null.
  app.get('/api/save-state', (req, res) => {
    try {
      const saveFile = saveParser.getLatestSaveFile();
      const fingerprint = snapshotIdentity.createFileFingerprint(saveFile.fullPath);
      const identity = snapshotIdentity.createSnapshotIdentity(
        { ...saveFile, saveHash: fingerprint.saveHash },
        runtimeConfig.campaign.key
      );
      res.set('Cache-Control', 'no-store');
      res.json({
        success: true,
        snapshotId: identity.snapshotId,
        saveHash: identity.saveHash,
        saveModifiedAt: identity.saveModifiedAt,
        saveFilename: saveFile.name,
        campaignDate: null
      });
    } catch (err) {
      res.status(err.statusCode || 500).json({ success: false, error: err.message });
    }
  });
}

module.exports = { register };
