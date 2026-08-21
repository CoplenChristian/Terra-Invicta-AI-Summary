/**
 * server/http/routes/snapshot.js -- routes that return the whole filtered
 * snapshot, or a rendering of it.
 *
 * They all do the same four things: parse the request, load or reuse the raw
 * save, assert the observer exists, filter for (mode, observer). What differs is
 * only the shape they hand back -- JSON, markdown, or a briefing beside the
 * JSON.
 *
 * The module registers in TWO calls because Express route order is pinned by
 * `tests/serverRoutes.test.js`: /api/snapshot, /api/refresh and /api/export sit
 * before the focused-resource routes in the original registration order, while
 * /api/v2/briefing and the read-only export endpoints sit after the tech routes.
 * Splitting the registration keeps that order byte-identical instead of quietly
 * reshuffling the route table during a refactor.
 */

const exportGenerator = require('../../exportGenerator');
const briefingGenerator = require('../../briefingGenerator');
const requestValidation = require('../../requestValidation');
const snapshotCache = require('../snapshotCache');
const { requestContext, assertObserver, responseIdentity } = require('../requestContext');

function register(app) {
  // 2. Snapshot endpoint
  app.get('/api/snapshot', (req, res) => {
    try {
      const { mode, observerId, targetPath } = requestContext(req);

      const rawSnapshot = snapshotCache.loadOrGetSnapshot(targetPath);
      assertObserver(rawSnapshot, observerId);
      const filtered = snapshotCache.buildFilteredSnapshot(rawSnapshot, mode, observerId);

      res.json({ success: true, ...responseIdentity(filtered, targetPath === null), data: filtered });
    } catch (err) {
      console.error('[Server] Error generating snapshot:', err);
      res.status(err.statusCode || 500).json({ success: false, error: err.message });
    }
  });

  // 3. Refresh latest save
  app.post('/api/refresh', (req, res) => {
    try {
      snapshotCache.resetCache();

      const { mode, observerId, targetPath } = requestContext(req);
      const rawSnapshot = snapshotCache.loadOrGetSnapshot(targetPath);
      assertObserver(rawSnapshot, observerId);
      const filtered = snapshotCache.buildFilteredSnapshot(rawSnapshot, mode, observerId);

      res.json({ success: true, ...responseIdentity(filtered, targetPath === null), message: 'Latest save refreshed successfully.', data: filtered });
    } catch (err) {
      console.error('[Server] Refresh failed:', err);
      res.status(err.statusCode || 500).json({ success: false, error: err.message });
    }
  });

  // 4. Export Markdown for ChatGPT
  app.get('/api/export', (req, res) => {
    try {
      const { mode, observerId, targetPath } = requestContext(req);
      const format = req.query.format || 'chatgpt';
      if (!['chatgpt', 'full'].includes(format)) {
        throw new requestValidation.RequestValidationError(`Invalid export format '${format}'.`);
      }

      const rawSnapshot = snapshotCache.loadOrGetSnapshot(targetPath);
      assertObserver(rawSnapshot, observerId);
      const filtered = snapshotCache.buildFilteredSnapshot(rawSnapshot, mode, observerId);

      const markdown = format === 'full'
        ? exportGenerator.generateFullMarkdownReport(filtered)
        : exportGenerator.generateCompactSnapshot(filtered);

      res.json({ success: true, ...responseIdentity(filtered, targetPath === null), markdown });
    } catch (err) {
      res.status(err.statusCode || 500).json({ success: false, error: err.message });
    }
  });
}

function registerReadOnlyExports(app) {
  // 6. Mission Control v2 Briefing endpoint
  app.get('/api/v2/briefing', (req, res) => {
    try {
      const { mode, observerId, targetPath } = requestContext(req);

      const rawSnapshot = snapshotCache.loadOrGetSnapshot(targetPath);
      assertObserver(rawSnapshot, observerId);
      const filtered = snapshotCache.buildFilteredSnapshot(rawSnapshot, mode, observerId);
      const briefing = briefingGenerator.generateMissionControlBriefing(filtered, rawSnapshot);

      res.json({ success: true, ...responseIdentity(filtered, targetPath === null), briefing, data: filtered });
    } catch (err) {
      console.error('[Server] Error generating v2 briefing:', err);
      res.status(err.statusCode || 500).json({ success: false, error: err.message });
    }
  });

  // Read-only compact/full snapshot endpoints use the same identity envelope as
  // the hosted worker, which lets external analysis clients work against either
  // runtime without fetching the full dashboard bootstrap payload.
  app.get(['/api/snapshot/compact', '/api/snapshot/full', '/latest-snapshot.json', '/latest-snapshot.md'], (req, res) => {
    try {
      const { mode, observerId, targetPath } = requestContext(req);
      const rawSnapshot = snapshotCache.loadOrGetSnapshot(targetPath);
      assertObserver(rawSnapshot, observerId);
      const filtered = snapshotCache.buildFilteredSnapshot(rawSnapshot, mode, observerId);
      const format = req.path.endsWith('/full') ? 'full' : 'compact';
      const markdown = format === 'full'
        ? exportGenerator.generateFullMarkdownReport(filtered)
        : exportGenerator.generateCompactSnapshot(filtered);

      if (req.path === '/latest-snapshot.md') {
        res.type('text/markdown').set('Cache-Control', 'no-store').send(markdown);
        return;
      }

      res.json({
        success: true,
        source: 'local',
        ...responseIdentity(filtered, targetPath === null),
        difficulty: filtered.metadata?.difficulty || null,
        observerFaction: {
          id: filtered.observerFactionId,
          name: filtered.observerFactionName
        },
        intelMode: mode,
        visibility: mode,
        snapshot: filtered,
        markdown
      });
    } catch (err) {
      res.status(err.statusCode || 500).json({ success: false, error: err.message });
    }
  });
}

module.exports = { register, registerReadOnlyExports };
