/**
 * server/http/routes/snapshot.js -- routes that return the whole filtered
 * snapshot, or a rendering of it.
 * Purpose: routes returning the whole filtered snapshot or a rendering of it,
 *   plus the read-only export routes.
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
      const { mode, observerId, targetPath, riskFloorPercent } = requestContext(req);

      const rawSnapshot = snapshotCache.loadOrGetSnapshot(targetPath);
      assertObserver(rawSnapshot, observerId);
      const filtered = snapshotCache.buildFilteredSnapshot(rawSnapshot, mode, observerId);
      // The briefing is regenerated per request, so the floor is a request
      // parameter rather than server state -- two browsers can hold different
      // risk tolerances against the same cached save.
      const briefing = briefingGenerator.generateMissionControlBriefing(filtered, rawSnapshot, { riskFloorPercent });

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
        res.type('text/markdown; charset=utf-8').set('Cache-Control', 'no-store').send(markdown);
        return;
      }

      res.json({
        success: true,
        source: 'local',
        ...responseIdentity(filtered, targetPath === null),
        difficulty: filtered.metadata?.difficulty || null,
        // See server/intelResources.js: the raw word stays, the reader-facing
        // label names any customisation rather than a stock difficulty name.
        difficultyLabel: filtered.metadata?.difficultyLabel || filtered.metadata?.difficulty || null,
        campaignSettings: filtered.metadata?.campaignSettings || null,
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

  app.get('/latest-threats.md', (req, res) => {
    try {
      const { mode, observerId, targetPath } = requestContext(req);
      const rawSnapshot = snapshotCache.loadOrGetSnapshot(targetPath);
      assertObserver(rawSnapshot, observerId);
      const filtered = snapshotCache.buildFilteredSnapshot(rawSnapshot, mode, observerId);
      const markdown = exportGenerator.generateThreatsMarkdown(filtered);
      res.type('text/markdown; charset=utf-8').set('Cache-Control', 'no-store').send(markdown);
    } catch (err) {
      res.status(err.statusCode || 500).type('text/plain').send(`Error generating threats markdown: ${err.message}`);
    }
  });

  app.get('/latest-war-room.md', (req, res) => {
    try {
      const { mode, observerId, targetPath, riskFloorPercent } = requestContext(req);
      const rawSnapshot = snapshotCache.loadOrGetSnapshot(targetPath);
      assertObserver(rawSnapshot, observerId);
      const filtered = snapshotCache.buildFilteredSnapshot(rawSnapshot, mode, observerId);
      // Section 10 reports the risk floor, the bench truncation and the primary
      // recommendation, and all three are engine output rather than snapshot
      // data. The shared renderer cannot build them -- it also runs in the
      // Cloudflare Worker, which has neither Node CommonJS nor config -- so this
      // runtime hands them over. The hosted worker needs no equivalent: its
      // published rows already carry `snapshot.missionControlBriefing`, and
      // `primary` is a sibling of `cyclePlan` on the same `engineDirectives`
      // object, so the renderer's fallback finds both.
      //
      // The briefing is generated ONCE and both are read off it: two calls would
      // be two engine runs against one save, and nothing guarantees the second
      // agrees with the first.
      //
      // The floor is a request parameter here for the same reason it is on
      // /api/v2/briefing: two clients may hold different risk tolerances against
      // one cached save, and resolving an absent parameter to the CONFIGURED
      // default is the briefing generator's job, never a coercion to 0.
      const engineDirectives = briefingGenerator
        .generateMissionControlBriefing(filtered, rawSnapshot, { riskFloorPercent })
        ?.engineDirectives ?? null;
      const cyclePlan = engineDirectives?.cyclePlan ?? null;
      const primary = engineDirectives?.primary ?? null;
      const markdown = exportGenerator.generateWarRoomMarkdown(filtered, { cyclePlan, primary });
      res.type('text/markdown; charset=utf-8').set('Cache-Control', 'no-store').send(markdown);
    } catch (err) {
      res.status(err.statusCode || 500).type('text/plain').send(`Error generating war room markdown: ${err.message}`);
    }
  });
}

module.exports = { register, registerReadOnlyExports };
