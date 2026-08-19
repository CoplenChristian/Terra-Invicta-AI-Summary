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
const techIntel = require('./techIntel');
const requestValidation = require('./requestValidation');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLISH_TIMEOUT_MS = Number(process.env.PUBLISH_TIMEOUT_MS) > 0
  ? Number(process.env.PUBLISH_TIMEOUT_MS)
  : 15 * 60 * 1000;

app.use(express.json({ limit: '5mb' }));
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
let cachedSaveStatKey = null;
let cachedPreviousRawSave = null;
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
  const statKey = `${stats.size}:${stats.mtimeMs}`;
  if (cachedRawSave && cachedSavePath === saveFile.fullPath && cachedSaveStatKey === statKey) {
    return cachedRawSave;
  }

  // Parse the save and verify it did not change while it was being read.
  // The fingerprint is computed only on a cache miss; a stat comparison is
  // sufficient for cache hits because the game's writes always bump mtime.
  console.log(`[Server] Parsing save ${saveFile.name}...`);
  const beforeFingerprint = snapshotIdentity.createFileFingerprint(saveFile.fullPath);
  const parsedSave = saveParser.readSaveJson(saveFile.fullPath);
  const afterFingerprint = snapshotIdentity.createFileFingerprint(saveFile.fullPath);
  if (afterFingerprint.key !== beforeFingerprint.key) {
    const error = new Error(`Save '${saveFile.name}' changed while it was being parsed. Terra Invicta may still be writing it; retry after the save finishes.`);
    error.statusCode = 503;
    throw error;
  }
  const rawSnapshot = snapshotBuilder.buildRawSnapshot(parsedSave);
  const identity = snapshotIdentity.createSnapshotIdentity(
    { ...saveFile, saveHash: beforeFingerprint.saveHash },
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
  cachedSaveStatKey = statKey;
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

function responseIdentity(snapshot, isLatestSnapshot = true) {
  const identity = snapshotIdentity.readSnapshotIdentity(snapshot);
  const saveFilename = snapshot?.metadata?.fileName || null;
  const campaignDate = snapshot?.metadata?.gameTimeString || null;
  return {
    ...identity,
    saveFilename,
    campaignDate,
    isLatestSnapshot,
    activeSnapshot: {
      ...identity,
      saveFilename,
      campaignDate,
      isLatestSnapshot
    }
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

    res.json({ success: true, ...responseIdentity(filtered, targetPath === null), data: filtered });
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
    cachedSaveStatKey = null;
    cachedPreviousRawSave = null;
    filteredSnapshotCache.clear();

    const { mode, observerId, targetPath } = requestContext(req);
    const rawSnapshot = loadOrGetSnapshot(targetPath);
    assertObserver(rawSnapshot, observerId);
    const filtered = buildFilteredSnapshot(rawSnapshot, mode, observerId);

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

    const rawSnapshot = loadOrGetSnapshot(targetPath);
    assertObserver(rawSnapshot, observerId);
    const filtered = buildFilteredSnapshot(rawSnapshot, mode, observerId);

    const markdown = format === 'full'
      ? exportGenerator.generateFullMarkdownReport(filtered)
      : exportGenerator.generateCompactSnapshot(filtered);

    res.json({ success: true, ...responseIdentity(filtered, targetPath === null), markdown });
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  }
});

// Focused resource routes keep local Express and the hosted worker on the
// same shallow contract for external analysis clients and lazy library views.
app.get(['/api/intel', '/api/intel/'], (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    success: true,
    source: 'local',
    name: 'Terra Invicta Strategic Intelligence API',
    endpoints: intelResources.INTEL_ENDPOINT_INDEX,
    query: {
      observer: 'Observer faction ID, e.g. 4712',
      mode: 'player | enhanced | omniscient',
      faction: 'Optional faction ID filter',
      body: 'Optional body/theater filter'
    }
  });
});

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
    const destination = req.query.destination ? String(req.query.destination).trim() : null;
    const fleetId = req.query.fleet || req.query.fleetId || null;
    const designId = req.query.design || req.query.designId || req.query.target || null;
    const quantity = parseInt(req.query.quantity, 10) || 1;
    const status = req.query.status ? String(req.query.status).trim() : null;
    const sort = req.query.sort ? String(req.query.sort).trim() : null;

    const previousFiltered = cachedPreviousRawSave
      ? buildFilteredSnapshot(cachedPreviousRawSave, mode, observerId)
      : null;

    const projection = intelResources.buildResource(filtered, req.params.resource, {
      factionId,
      body,
      destination,
      fleetId,
      designId,
      quantity,
      status,
      sort,
      previousSnapshot: previousFiltered,
      mode,
      isLatestSnapshot: targetPath === null
    });

    res.set('Cache-Control', 'no-store');
    res.json(projection);
  } catch (err) {
    console.error(`[Server] Focused resource failed (${req.params.resource}):`, err);
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  }
});

// Production plan query endpoint (POST)
app.post(['/api/intel/production-plan', '/api/production-plan'], (req, res) => {
  try {
    const { mode, observerId, targetPath } = requestContext(req);
    const rawSnapshot = loadOrGetSnapshot(targetPath);
    assertObserver(rawSnapshot, observerId);
    const filtered = buildFilteredSnapshot(rawSnapshot, mode, observerId);
    const designId = req.body?.designId || req.body?.design || req.query.designId || req.query.design;
    const quantity = parseInt(req.body?.quantity || req.query.quantity, 10) || 1;

    const projection = intelResources.buildResource(filtered, 'production-plan', {
      designId,
      quantity,
      mode,
      isLatestSnapshot: targetPath === null
    });

    res.set('Cache-Control', 'no-store');
    res.json(projection);
  } catch (err) {
    console.error('[Server] Production plan failed:', err);
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

// Tech Tree Intelligence endpoints. These expose the observer's technology
// state as a normalized dependency graph (see shared/techGraph.mjs) and answer
// research-path, search, milestone and queue questions against the live save.
app.get(['/api/intel/tech-tree', '/api/intel/tech-path', '/api/intel/tech-search',
  '/api/intel/tech-milestones', '/api/intel/tech-matrix', '/api/intel/tech-opportunities',
  '/api/intel/research-queue'], (req, res) => {
  try {
    const { mode, observerId, targetPath } = requestContext(req);
    const rawSnapshot = loadOrGetSnapshot(targetPath);
    assertObserver(rawSnapshot, observerId);
    const filtered = buildFilteredSnapshot(rawSnapshot, mode, observerId);

    let projection;
    if (req.path.endsWith('/tech-tree')) {
      const category = String(req.query.category || 'all').toLowerCase();
      if (!techIntel.CATEGORIES.has(category)) {
        throw new requestValidation.RequestValidationError(
          `Invalid category '${category}'. Supported: ${Array.from(techIntel.CATEGORIES).join(', ')}.`
        );
      }
      const includeEffects = String(req.query.includeEffects ?? 'true') !== 'false';
      projection = techIntel.buildTechTree(filtered, mode, observerId, { category, includeEffects });
    } else if (req.path.endsWith('/tech-path')) {
      const rawTarget = req.query.target;
      if (!rawTarget) {
        throw new requestValidation.RequestValidationError('Missing required query parameter: target.');
      }
      const targets = String(rawTarget).split(',').map(t => t.trim()).filter(Boolean);
      projection = techIntel.buildPath(filtered, mode, observerId, targets);
    } else if (req.path.endsWith('/tech-search')) {
      const query = String(req.query.q || '');
      if (!query) {
        throw new requestValidation.RequestValidationError('Missing required query parameter: q.');
      }
      projection = techIntel.buildSearch(filtered, mode, observerId, query);
    } else if (req.path.endsWith('/tech-milestones')) {
      const category = req.query.category ? String(req.query.category).toLowerCase() : null;
      projection = techIntel.buildMilestones(filtered, mode, observerId, category);
    } else if (req.path.endsWith('/tech-matrix')) {
      projection = techIntel.buildMatrix(filtered, mode, observerId);
    } else if (req.path.endsWith('/tech-opportunities')) {
      projection = techIntel.buildOpportunities(filtered, mode, observerId);
    } else {
      projection = techIntel.buildQueue(filtered, mode, observerId);
    }

    res.set('Cache-Control', 'no-store');
    res.json(projection);
  } catch (err) {
    console.error(`[Server] Tech endpoint failed (${req.path}):`, err);
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
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
