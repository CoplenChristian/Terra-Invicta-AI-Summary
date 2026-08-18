const express = require('express');
const path = require('path');
const { spawn } = require('child_process');
const saveParser = require('./saveParser');
const snapshotBuilder = require('./snapshotBuilder');
const intelligenceFilter = require('./intelligenceFilter');
const exportGenerator = require('./exportGenerator');
const templateLoader = require('./templateLoader');
const briefingGenerator = require('./briefingGenerator');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Server] Unhandled Rejection:', reason);
});

// In-memory snapshot cache
let cachedRawSave = null;
let cachedSavePath = null;
let cachedSaveMtime = null;
let activePublisherProcess = null;

function loadOrGetSnapshot(targetSavePath = null) {
  let saveFile = null;
  if (targetSavePath) {
    saveFile = { fullPath: targetSavePath, name: path.basename(targetSavePath) };
  } else {
    saveFile = saveParser.getLatestSaveFile();
  }

  const stats = require('fs').statSync(saveFile.fullPath);
  if (cachedRawSave && cachedSavePath === saveFile.fullPath && cachedSaveMtime === stats.mtimeMs) {
    return cachedRawSave;
  }

  console.log(`[Server] Parsing save ${saveFile.name}...`);
  const parsedSave = saveParser.readSaveJson(saveFile.fullPath);
  const rawSnapshot = snapshotBuilder.buildRawSnapshot(parsedSave);

  cachedRawSave = rawSnapshot;
  cachedSavePath = saveFile.fullPath;
  cachedSaveMtime = stats.mtimeMs;

  return rawSnapshot;
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

  const publisher = spawn(process.execPath, [publisherPath], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env },
    windowsHide: true
  });
  activePublisherProcess = publisher;

  publisher.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    if (stdout.length < 100000) stdout += text;
    process.stdout.write(`[Publisher] ${text}`);
  });

  publisher.stderr.on('data', (chunk) => {
    process.stderr.write(`[Publisher] ${chunk.toString()}`);
  });

  publisher.once('error', (err) => {
    activePublisherProcess = null;
    if (responded) return;
    responded = true;
    res.status(500).json({
      success: false,
      error: `Could not start the save publisher: ${err.message}`
    });
  });

  publisher.once('close', (code) => {
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
    const mode = req.query.mode || 'player';
    const observerId = parseInt(req.query.observer || '4712', 10);
    const saveName = req.query.save || null;

    let targetPath = null;
    if (saveName) {
      const folder = saveParser.resolveSaveFolder();
      targetPath = path.join(folder, saveName);
    }

    const rawSnapshot = loadOrGetSnapshot(targetPath);
    const filtered = intelligenceFilter.applyFilter(rawSnapshot, mode, observerId);

    res.json({ success: true, data: filtered });
  } catch (err) {
    console.error('[Server] Error generating snapshot:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Refresh latest save
app.post('/api/refresh', (req, res) => {
  try {
    cachedRawSave = null;
    cachedSavePath = null;
    cachedSaveMtime = null;

    const rawSnapshot = loadOrGetSnapshot();
    const mode = req.query.mode || 'player';
    const observerId = parseInt(req.query.observer || '4712', 10);
    const filtered = intelligenceFilter.applyFilter(rawSnapshot, mode, observerId);

    res.json({ success: true, message: 'Latest save refreshed successfully.', data: filtered });
  } catch (err) {
    console.error('[Server] Refresh failed:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Export Markdown for ChatGPT
app.get('/api/export', (req, res) => {
  try {
    const mode = req.query.mode || 'player';
    const observerId = parseInt(req.query.observer || '4712', 10);
    const format = req.query.format || 'chatgpt';

    const rawSnapshot = loadOrGetSnapshot();
    const filtered = intelligenceFilter.applyFilter(rawSnapshot, mode, observerId);

    const markdown = format === 'full'
      ? exportGenerator.generateFullMarkdownReport(filtered)
      : exportGenerator.generateCompactSnapshot(filtered);

    res.json({ success: true, markdown });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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
    const mode = req.query.mode || 'player';
    const observerId = parseInt(req.query.observer || '4712', 10);
    const saveName = req.query.save || null;

    let targetPath = null;
    if (saveName) {
      const folder = saveParser.resolveSaveFolder();
      targetPath = path.join(folder, saveName);
    }

    const rawSnapshot = loadOrGetSnapshot(targetPath);
    const filtered = intelligenceFilter.applyFilter(rawSnapshot, mode, observerId);
    const briefing = briefingGenerator.generateMissionControlBriefing(filtered, rawSnapshot);

    res.json({ success: true, briefing, data: filtered });
  } catch (err) {
    console.error('[Server] Error generating v2 briefing:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Route /v2 to Mission Control interface
app.get('/v2', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/v2/index.html'));
});

// Start Server
if (require.main === module) {
  templateLoader.load();
  app.listen(PORT, () => {
    console.log(`========================================================`);
    console.log(`  TERRA INVICTA STRATEGIC INTELLIGENCE DASHBOARD SERVER  `);
    console.log(`  Running at http://localhost:${PORT}                   `);
    console.log(`========================================================`);
  });
}

module.exports = app;
