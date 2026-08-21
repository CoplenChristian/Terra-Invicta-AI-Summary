// server/saveParser.js
//
// Purpose: locate, decompress and parse a Terra Invicta save file into raw game state.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { resolveConfig } = require('./config');

class SaveParser {
  constructor(configOrPath = null) {
    this.configPath = typeof configOrPath === 'string' ? configOrPath : null;
    this.configOverride = configOrPath && typeof configOrPath === 'object' ? configOrPath : null;
    this.config = this.loadConfig();
  }

  loadConfig() {
    return this.configOverride || resolveConfig({ configPath: this.configPath || undefined });
  }

  resolveSaveFolder() {
    const configured = this.config.paths?.savePath;
    if (!configured) {
      throw new Error('No save path configured. Set paths.savePath in config.json or TI_SAVE_PATH.');
    }

    const resolved = path.resolve(configured);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) return resolved;
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return path.dirname(resolved);
    // A configured future save filename is useful, but only its existing
    // parent may be searched. Never substitute a different directory.
    const folder = path.extname(resolved) ? path.dirname(resolved) : resolved;
    if (!fs.existsSync(folder)) throw new Error(`Configured save folder not found: ${folder}`);
    return folder;
  }

  getAvailableSaves() {
    const folder = this.resolveSaveFolder();
    if (!fs.existsSync(folder)) {
      throw new Error(`Save folder not found: ${folder}`);
    }

    const files = fs.readdirSync(folder)
      .filter(f => f.endsWith('.gz') || f.endsWith('.json'))
      .map(name => {
        const fullPath = path.join(folder, name);
        const stats = fs.statSync(fullPath);
        return {
          name,
          fullPath,
          sizeBytes: stats.size,
          lastModified: stats.mtime
        };
      })
      .sort((a, b) => b.lastModified - a.lastModified);

    return files;
  }

  getLatestSaveFile() {
    const saves = this.getAvailableSaves();
    if (saves.length === 0) {
      throw new Error('No .gz or .json save files found.');
    }
    return saves[0];
  }

  readSaveJson(filePath) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Save file not found at ${filePath}`);
    }

    const startTime = Date.now();
    let rawStr = '';

    if (filePath.endsWith('.gz')) {
      const buffer = fs.readFileSync(filePath);
      rawStr = zlib.gunzipSync(buffer).toString('utf8');
    } else {
      rawStr = fs.readFileSync(filePath, 'utf8');
    }

    // Strip UTF-8 BOM if present
    if (rawStr.charCodeAt(0) === 0xFEFF) {
      rawStr = rawStr.slice(1);
    }

    // Replace non-standard JSON literals (Infinity, -Infinity, NaN)
    rawStr = rawStr.replace(/:\s*Infinity\b/g, ': null')
                   .replace(/:\s*-Infinity\b/g, ': null')
                   .replace(/:\s*NaN\b/g, ': null');

    const json = JSON.parse(rawStr);
    const parseTimeMs = Date.now() - startTime;

    // Extract metadata
    const metaList = json.gamestates?.['PavonisInteractive.TerraInvicta.TIMetadataState'] || [];
    const metaObj = metaList.length > 0 ? (metaList[0].Value || metaList[0]) : {};

    const saveStats = fs.statSync(filePath);

    return {
      filePath,
      fileName: path.basename(filePath),
      fileSizeBytes: saveStats.size,
      lastModified: saveStats.mtime,
      parseTimeMs,
      gameTimeString: metaObj.gameTimeString || null,
      // Difficulty is not cosmetic: it selects the alien minimum-hate floor
      // multiplier (Cinematic 0.05 / Normal 0.30 / Veteran 0.60 / Brutal
      // 1.00). Silently defaulting an unreadable save to 'Normal' produces a
      // hate floor that is wrong by up to 20x with nothing to indicate it, so
      // an absent difficulty stays null and the consumer reports unknown.
      difficulty: typeof metaObj.difficulty === 'string' && metaObj.difficulty.trim() !== ''
        ? metaObj.difficulty
        : null,
      difficultyAvailable: typeof metaObj.difficulty === 'string' && metaObj.difficulty.trim() !== '',
      // Campaign start year drives elapsed-years gating. An invented 2022
      // silently shifts every elapsed-time calculation.
      campaignStartYear: Number.isFinite(Number(metaObj.campaignStartYear)) && metaObj.campaignStartYear !== null && metaObj.campaignStartYear !== ''
        ? Number(metaObj.campaignStartYear)
        : null,
      gamestates: json.gamestates || {}
    };
  }

  getStateCollection(gamestates, stateClassName) {
    if (!gamestates || !gamestates[stateClassName]) return [];
    const raw = gamestates[stateClassName];
    if (Array.isArray(raw)) {
      return raw.map(item => (item && item.Value !== undefined ? item.Value : item));
    }
    if (typeof raw === 'object') {
      return Object.values(raw).map(item => (item && item.Value !== undefined ? item.Value : item));
    }
    return [];
  }
}

module.exports = new SaveParser();
