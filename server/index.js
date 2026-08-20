const express = require('express');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
// Supabase-backed routes (strategic history) need SUPABASE_URL and a key.
// The publish script already loads .env; the server did not, so those routes
// reported "not configured" locally even when credentials were present.
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { resolveConfig, safeRuntimeConfig } = require('./config');
const runtimeConfig = resolveConfig();
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
const saveComparison = require('./saveComparison');
const SupabaseAdapter = require('./supabaseAdapter');
const { buildStrategicSnapshot } = require('../shared/strategicSnapshot.mjs');
const { buildStrategicDelta } = require('../shared/strategicDelta.mjs');

// Compact strategic history lives in Supabase, not on disk, so these routes
// degrade cleanly to a clear message when Supabase is not configured locally.
const strategicHistory = new SupabaseAdapter({ campaignKey: runtimeConfig.campaign.key });

const app = express();
const PORT = runtimeConfig.server.port;
const HOST = runtimeConfig.server.host;
const PUBLISH_TIMEOUT_MS = runtimeConfig.server.publishTimeoutMs;

app.use(express.json({ limit: '5mb' }));

// Mission Control (v2) is the dashboard. Serve its shell at both the site root
// and /v2/ so either path renders the same live UI and existing /v2/ links keep
// working without a redirect. This is registered ahead of express.static so the
// root is answered by an explicit route rather than by directory-index
// behaviour over public/, which is what used to surface the legacy v1 shell.
const missionControlShell = path.join(__dirname, '../public/v2/index.html');
app.get(['/', '/v2'], (req, res) => {
  res.sendFile(missionControlShell);
});

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
// A per-process token turns the local publish route into an explicit local
// capability. The browser obtains it through the same-origin runtime probe;
// a cross-origin form cannot set the custom header, so it cannot trigger the
// service-role-backed publisher.
const publishToken = crypto.randomBytes(32).toString('hex');

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
    runtimeConfig.campaign.key
  );
  snapshotIdentity.attachSnapshotIdentity(rawSnapshot, identity);

  // Keep the immediately older save available for a truthful “since last
  // save” comparison. A failed historical parse should not block the current
  // dashboard; it simply makes the delta panel explicitly unavailable.
  cachedPreviousRawSave = null;
  try {
    // Walk back past saves that capture the same in-game moment (an ExitSave
    // written seconds after an Autosave, for instance) so the comparison has
    // something to report. Parsed candidates are reused, not re-read.
    const parsedCandidates = new Map();
    const readCandidate = (candidate) => {
      const key = path.resolve(candidate.fullPath).toLowerCase();
      if (!parsedCandidates.has(key)) {
        parsedCandidates.set(key, snapshotBuilder.buildRawSnapshot(saveParser.readSaveJson(candidate.fullPath)));
      }
      return parsedCandidates.get(key);
    };

    const selection = saveComparison.selectComparisonSave(
      saveParser.getAvailableSaves(),
      saveFile,
      rawSnapshot.metadata?.gameTimeString || null,
      (candidate) => readCandidate(candidate)?.metadata?.gameTimeString || null
    );

    if (selection?.save) {
      cachedPreviousRawSave = readCandidate(selection.save);
      snapshotIdentity.attachSnapshotIdentity(cachedPreviousRawSave, snapshotIdentity.createSnapshotIdentity(
        selection.save,
        runtimeConfig.campaign.key,
        identity.generatedAt
      ));
      if (selection.reason === 'same-game-time-fallback') {
        console.log(`[Server] Every recent save shares in-game date ${rawSnapshot.metadata?.gameTimeString}; comparing against ${selection.save.name} anyway.`);
      } else if (selection.probed > 1) {
        console.log(`[Server] Comparing against ${selection.save.name} (${selection.gameTime}); skipped ${selection.probed - 1} save(s) from the same in-game moment.`);
      }
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
    supportedModes: runtimeConfig.publishing.observerModes,
    // Local runs parse the save directly, so every faction is selectable.
    // null means "no restriction"; the hosted worker returns a real list.
    availableObservers: null,
    defaultMode: runtimeConfig.server.defaultMode,
    defaults: safeRuntimeConfig(runtimeConfig),
    publishToken,
    source: 'express'
  });
});

// Publish the newest save through the same Node publisher used by
// push_latest_to_supabase.ps1. This endpoint exists only in the local
// Express server; the hosted worker explicitly rejects it.
app.post('/api/publish', (req, res) => {
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
  const payload = {
    success: true,
    source: 'local',
    name: 'Terra Invicta Strategic Intelligence API',
    endpoints: intelResources.INTEL_ENDPOINT_INDEX,
    examples: intelResources.INTEL_ENDPOINT_EXAMPLES,
    query: {
      observer: `Observer faction ID, e.g. ${runtimeConfig.campaign.defaultObserverFactionId}`,
      mode: 'player | enhanced | omniscient',
      faction: 'Optional faction ID filter',
      body: 'Optional body filter',
      theater: 'Mining-prospects theater filter (body is accepted as a legacy alias)',
      limit: 'Mining-prospects result limit from 1 to 100'
    }
  };
  if (req.query.format === 'json' || String(req.get('accept') || '').includes('application/json')) {
    res.set('Cache-Control', 'no-store').json(payload);
    return;
  }

  const links = Object.entries(payload.endpoints).map(([name, endpoint]) => {
    const query = payload.examples[name] || `?observer=${runtimeConfig.campaign.defaultObserverFactionId}&mode=omniscient`;
    const href = `${endpoint}${query}`.replace(/&/g, '&amp;');
    return `<li><span>${name}</span><a href="${href}">${endpoint}${query}</a></li>`;
  }).join('');
  res.set('Cache-Control', 'no-store').type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="robots" content="index,follow">
<title>Terra Invicta Strategic Intelligence API</title></head><body>
<main><h1>Terra Invicta Strategic Intelligence API</h1>
<p>Machine-readable endpoint directory. Add or change observer, mode, faction, body, and other filters as needed.</p>
<p><a href="/api/intel?format=json">JSON index</a> · <a href="/v2/">Command Center</a></p>
<ul>${links}</ul></main></body></html>`);
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
    const theater = requestValidation.parseBodyQuery(req.query.theater ?? req.query.body);
    const limit = requestValidation.parseBoundedIntegerQuery(
      req.query.limit ?? ((req.params.resource === 'mining-prospects' || req.params.resource === 'mining-expansion') ? req.query.quantity : undefined),
      'mining prospects limit'
    );
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
      theater,
      limit,
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

// --- Strategic history -------------------------------------------------------
// Compact strategic_snapshot_v1 documents for trend analysis. Deltas are
// computed on demand; storing them would defeat the point of a compact format.

app.get('/api/intel/history', async (req, res) => {
  if (!strategicHistory.isConfigured()) {
    return res.status(503).json({ error: 'Strategic history requires Supabase configuration (SUPABASE_URL + key).' });
  }
  try {
    const result = await strategicHistory.listStrategicSnapshots(req.query.campaign || null, req.query.limit || 25);
    if (!result.found) return res.status(404).json({ error: result.error || 'Strategic history unavailable for this campaign.' });
    res.json({
      schema: 'strategic_snapshot_v1',
      campaignKey: result.campaignKey,
      count: result.history.length,
      history: result.history
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Addressed by save_last_modified: this schema has no separate snapshot hash.
app.get('/api/intel/history/:saveLastModified', async (req, res) => {
  if (!strategicHistory.isConfigured()) {
    return res.status(503).json({ error: 'Strategic history requires Supabase configuration (SUPABASE_URL + key).' });
  }
  try {
    const result = await strategicHistory.getStrategicSnapshot(
      decodeURIComponent(req.params.saveLastModified),
      req.query.campaign || null
    );
    if (!result.found) return res.status(404).json({ error: result.error || 'Strategic history unavailable for this campaign.' });
    res.json(result.snapshot);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/intel/strategic-delta', async (req, res) => {
  if (!strategicHistory.isConfigured()) {
    return res.status(503).json({ error: 'Strategic history requires Supabase configuration (SUPABASE_URL + key).' });
  }
  try {
    const campaign = req.query.campaign || null;
    let fromDoc = null;
    let toDoc = null;

    if (req.query.from && req.query.to) {
      const [a, b] = await Promise.all([
        strategicHistory.getStrategicSnapshot(decodeURIComponent(req.query.from), campaign),
        strategicHistory.getStrategicSnapshot(decodeURIComponent(req.query.to), campaign)
      ]);
      if (!a.found) return res.status(404).json({ error: a.error || 'from snapshot not found.' });
      if (!b.found) return res.status(404).json({ error: b.error || 'to snapshot not found.' });
      fromDoc = a.snapshot.payload;
      toDoc = b.snapshot.payload;
    } else {
      // Default: current live save versus the most recent stored history entry
      // that predates it, so "I just uploaded a save, what changed?" works with
      // no parameters.
      const recent = await strategicHistory.getRecentStrategicSnapshots(campaign, 2);
      if (!recent.found) return res.status(404).json({ error: recent.error || 'No strategic history available.' });
      if (recent.snapshots.length === 0) return res.status(404).json({ error: 'No strategic history stored yet.' });

      try {
        const { targetPath } = requestContext(req);
        const rawSnapshot = loadOrGetSnapshot(targetPath);
        toDoc = buildStrategicSnapshot(rawSnapshot, {
          observerFactionId: Number(req.query.observer) || runtimeConfig.campaign.defaultObserverFactionId,
          campaignKey: campaign,
          policy: runtimeConfig.analysis.strategicHistory
        });
        fromDoc = recent.snapshots[0]?.payload || null;
      } catch (localErr) {
        // No local save available (hosted context): fall back to the two most
        // recent stored snapshots.
        toDoc = recent.snapshots[0]?.payload || null;
        fromDoc = recent.snapshots[1]?.payload || null;
      }
    }

    res.json(buildStrategicDelta(fromDoc, toDoc));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
