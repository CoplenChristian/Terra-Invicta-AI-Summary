const express = require('express');
const path = require('path');
const saveParser = require('./saveParser');
const snapshotBuilder = require('./snapshotBuilder');
const intelligenceFilter = require('./intelligenceFilter');
const exportGenerator = require('./exportGenerator');
const templateLoader = require('./templateLoader');

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
