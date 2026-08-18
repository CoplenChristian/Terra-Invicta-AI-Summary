const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const saveParser = require('./saveParser');
const snapshotBuilder = require('./snapshotBuilder');
const intelligenceFilter = require('./intelligenceFilter');
const exportGenerator = require('./exportGenerator');
const templateLoader = require('./templateLoader');
const briefingGenerator = require('./briefingGenerator');
const snapshotIdentity = require('./snapshotIdentity');
const snapshotDelta = require('./snapshotDelta');
const intelResources = require('./intelResources');
const requestValidation = require('./requestValidation');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLISH_TIMEOUT_MS = Number(process.env.PUBLISH_TIMEOUT_MS) > 0
  ? Number(process.env.PUBLISH_TIMEOUT_MS)
  : 15 * 60 * 1000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

if (require.main === module) {
  process.on('uncaughtException', (err) => {
    console.error('[Server] Uncaught Exception:', err);
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[Server] Unhandled Rejection:', reason);
    process.exit(1);
  });
}

// In-memory snapshot cache
let cachedRawSave = null;
let cachedSavePath = null;
let cachedPreviousRawSave = null;
let cachedSaveFingerprint = null;
const filteredSnapshotCache = new Map();
let activePublisherProcess = null;

function requestContext(req) {
  const mode = requestValidation.parseMode(req.query.mode);
  const observerId = requestValidation.parseObserverId(req.query.observer);
  return {
    mode,
    observerId,
    targetPath: requestValidation.resolveSavePath(saveParser, req.query.save)
  };
}

function loadOrGetSnapshot(targetSavePath = null) {
  let saveFile = null;
  if (targetSavePath) {
    saveFile = { fullPath: targetSavePath, name: path.basename(targetSavePath) };
  } else {
    saveFile = saveParser.getLatestSaveFile();
  }

  const stats = fs.statSync(saveFile.fullPath);
  if (!saveFile.lastModified) saveFile.lastModified = stats.mtime;
  const fingerprint = snapshotIdentity.createFileFingerprint(saveFile.fullPath);
  if (cachedRawSave && cachedSavePath === saveFile.fullPath && cachedSaveFingerprint === fingerprint.key) {
    return cachedRawSave;
  }

  console.log(`[Server] Parsing save ${saveFile.name}...`);
  const parsedSave = saveParser.readSaveJson(saveFile.fullPath);
  const stableFingerprint = snapshotIdentity.createFileFingerprint(saveFile.fullPath);
  if (stableFingerprint.key !== fingerprint.key) {
    const error = new Error(`Save '${saveFile.name}' changed while it was being parsed. Terra Invicta may still be writing it; retry after the save finishes.`);
    error.statusCode = 503;
    throw error;
  }
  const rawSnapshot = snapshotBuilder.buildRawSnapshot(parsedSave);
  const identity = snapshotIdentity.createSnapshotIdentity(
    { ...saveFile, saveHash: fingerprint.saveHash },
    process.env.SUPABASE_CAMPAIGN_KEY || 'initiative'
  );
  snapshotIdentity.attachSnapshotIdentity(rawSnapshot, identity);

  // Keep the immediately older save available for a truthful “since last
  // save” comparison. A failed historical parse should not block the current
  // dashboard; it simply makes the delta panel explicitly unavailable.
  cachedPreviousRawSave = null;
  try {
    const currentPath = path.resolve(saveFile.fullPath).toLowerCase();
    const previousSave = saveParser.getAvailableSaves().find(candidate => {
      return path.resolve(candidate.fullPath).toLowerCase() !== currentPath &&
        new Date(candidate.lastModified).getTime() < new Date(saveFile.lastModified).getTime();
    });
    if (previousSave) {
      const previousParsedSave = saveParser.readSaveJson(previousSave.fullPath);
      cachedPreviousRawSave = snapshotBuilder.buildRawSnapshot(previousParsedSave);
      snapshotIdentity.attachSnapshotIdentity(cachedPreviousRawSave, snapshotIdentity.createSnapshotIdentity(
        previousSave,
        process.env.SUPABASE_CAMPAIGN_KEY || 'initiative',
        identity.generatedAt
      ));
    }
  } catch (previousError) {
    console.warn(`[Server] Previous save comparison unavailable: ${previousError.message}`);
  }
  rawSnapshot.previousRawSnapshot = cachedPreviousRawSave;

  cachedRawSave = rawSnapshot;
  cachedSavePath = saveFile.fullPath;
  cachedSaveFingerprint = fingerprint.key;
  filteredSnapshotCache.clear();

  return rawSnapshot;
}

function buildFilteredSnapshot(rawSnapshot, mode, observerId) {
  const cacheKey = `${rawSnapshot.snapshotId || 'unidentified'}|${mode}|${observerId}`;
  if (filteredSnapshotCache.has(cacheKey)) return filteredSnapshotCache.get(cacheKey);

  const filtered = intelligenceFilter.applyFilter(rawSnapshot, mode, observerId);
  const previousRawSnapshot = rawSnapshot.previousRawSnapshot;
  if (previousRawSnapshot) {
    const previousFiltered = intelligenceFilter.applyFilter(previousRawSnapshot, mode, observerId);
    filtered.changesSincePrevious = snapshotDelta.build(previousFiltered, filtered, observerId);
  } else {
    filtered.changesSincePrevious = snapshotDelta.build(null, filtered, observerId);
  }
  if (filteredSnapshotCache.size >= 24) {
    filteredSnapshotCache.delete(filteredSnapshotCache.keys().next().value);
  }
  filteredSnapshotCache.set(cacheKey, filtered);
  return filtered;
}

function assertObserver(rawSnapshot, observerId) {
  return requestValidation.assertKnownObserver(rawSnapshot, observerId);
}

function responseIdentity(snapshot) {
  return {
    ...snapshotIdentity.readSnapshotIdentity(snapshot),
    campaignDate: snapshot?.metadata?.gameTimeString || null
  };
}

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
    supportedModes: ['player', 'enhanced', 'omniscient'],
    defaultMode: 'player',
    source: 'express'
  });
});

// Publish the newest save through the same Node publisher used by
// push_latest_to_supabase.ps1. This endpoint exists only in the local
// Express server; the hosted worker explicitly rejects it.
app.post('/api/publish', (req, res) => {
  if (activePublisherProcess) {
    return res.status(409).json({
      success: false,
      error: 'A save publish is already in progress.'
    });
  }

  const publisherPath = path.join(__dirname, '../scripts/push_latest_to_supabase.js');
  let stdout = '';
  let responded = false;
  let timeoutHandle = null;

  const publisher = spawn(process.execPath, [publisherPath], {
    cwd: path.join(__dirname, '..'),
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
});

// 1. Available saves list
app.get('/api/saves', (req, res) => {
  try {
    const saves = saveParser.getAvailableSaves();
    res.json({ success: true, saves });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Snapshot endpoint
app.get('/api/snapshot', (req, res) => {
  try {
    const { mode, observerId, targetPath } = requestContext(req);

    const rawSnapshot = loadOrGetSnapshot(targetPath);
    assertObserver(rawSnapshot, observerId);
    const filtered = buildFilteredSnapshot(rawSnapshot, mode, observerId);

    res.json({ success: true, ...responseIdentity(filtered), data: filtered });
  } catch (err) {
    console.error('[Server] Error generating snapshot:', err);
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  }
});

// 3. Refresh latest save
app.post('/api/refresh', (req, res) => {
  try {
    cachedRawSave = null;
    cachedSavePath = null;
    cachedSaveFingerprint = null;
    cachedPreviousRawSave = null;
    filteredSnapshotCache.clear();

    const { mode, observerId, targetPath } = requestContext(req);
    const rawSnapshot = loadOrGetSnapshot(targetPath);
    assertObserver(rawSnapshot, observerId);
    const filtered = buildFilteredSnapshot(rawSnapshot, mode, observerId);

    res.json({ success: true, ...responseIdentity(filtered), message: 'Latest save refreshed successfully.', data: filtered });
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

    const rawSnapshot = loadOrGetSnapshot(targetPath);
    assertObserver(rawSnapshot, observerId);
    const filtered = buildFilteredSnapshot(rawSnapshot, mode, observerId);

    const markdown = format === 'full'
      ? exportGenerator.generateFullMarkdownReport(filtered)
      : exportGenerator.generateCompactSnapshot(filtered);

    res.json({ success: true, ...responseIdentity(filtered), markdown });
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  }
});

// Focused resource routes keep local Express and the hosted worker on the
// same shallow contract for external analysis clients and lazy library views.
app.get(['/api/intel/:resource', '/api/:resource'], (req, res, next) => {
  if (!intelResources.SUPPORTED_RESOURCES.has(req.params.resource)) return next();

  try {
    const { mode, observerId, targetPath } = requestContext(req);
    const rawSnapshot = loadOrGetSnapshot(targetPath);
    assertObserver(rawSnapshot, observerId);
    const filtered = buildFilteredSnapshot(rawSnapshot, mode, observerId);
    const factionId = requestValidation.parseOptionalNumericQuery(
      req.query.faction ?? req.query.factionId,
      'faction filter'
    );
    const body = requestValidation.parseBodyQuery(req.query.body);
    const projection = intelResources.buildResource(filtered, req.params.resource, { factionId, body, mode });
    const items = Array.isArray(projection.items) ? projection.items : null;

    res.set('Cache-Control', 'no-store');
    res.json({ ...projection, count: items ? items.length : projection.count });
  } catch (err) {
    console.error(`[Server] Focused resource failed (${req.params.resource}):`, err);
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  }
});

// 5. Template effect validation info
app.get('/api/templates/effects', (req, res) => {
  try {
    res.json({
      success: true,
      validation: templateLoader.validationResults,
      templatesPath: templateLoader.templatesPath,
      techCount: templateLoader.templates.techs.size,
      projectCount: templateLoader.templates.projects.size,
      effectCount: templateLoader.templates.effects.size
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Mission Control v2 Briefing endpoint
app.get('/api/v2/briefing', (req, res) => {
  try {
    const { mode, observerId, targetPath } = requestContext(req);

    const rawSnapshot = loadOrGetSnapshot(targetPath);
    assertObserver(rawSnapshot, observerId);
    const filtered = buildFilteredSnapshot(rawSnapshot, mode, observerId);
    const briefing = briefingGenerator.generateMissionControlBriefing(filtered, rawSnapshot);

    res.json({ success: true, ...responseIdentity(filtered), briefing, data: filtered });
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
    const rawSnapshot = loadOrGetSnapshot(targetPath);
    assertObserver(rawSnapshot, observerId);
    const filtered = buildFilteredSnapshot(rawSnapshot, mode, observerId);
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
      ...responseIdentity(filtered),
      saveFilename: filtered.metadata?.fileName || null,
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

// 7. Route /v2 to Mission Control interface
app.get('/v2', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/v2/index.html'));
});

// Start Server
if (require.main === module) {
  templateLoader.load();
  app.listen(PORT, HOST, () => {
    console.log(`========================================================`);
    console.log(`  TERRA INVICTA STRATEGIC INTELLIGENCE DASHBOARD SERVER  `);
    console.log(`  Running at http://${HOST}:${PORT}                   `);
    console.log(`========================================================`);
  });
}

module.exports = app;
