const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

class SaveParser {
  constructor(configPath = null) {
    this.configPath = configPath || path.join(__dirname, '../config.json');
    this.config = this.loadConfig();
  }

  loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        return JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      }
    } catch (err) {
      console.warn('[SaveParser] Failed loading config.json:', err.message);
    }
    return {
      SavePath: 'C:/Users/cople/Documents/My Games/TerraInvicta/Saves/initiative 2.gz',
      WorkDir: '.'
    };
  }

  resolveSaveFolder() {
    let configured = this.config.SavePath;
    if (!configured) {
      configured = 'C:/Users/cople/Documents/My Games/TerraInvicta/Saves';
    }
    let folder = path.dirname(configured);
    if (!fs.existsSync(folder)) {
      // Check alternative drive paths if Documents was moved to F:
      const altPaths = [
        'F:/Documents/My Games/TerraInvicta/Saves',
        'C:/Users/cople/Documents/My Games/TerraInvicta/Saves',
        path.join(__dirname, '..')
      ];
      for (const alt of altPaths) {
        if (fs.existsSync(alt)) {
          folder = alt;
          break;
        }
      }
    }
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
      difficulty: metaObj.difficulty || 'Normal',
      campaignStartYear: metaObj.campaignStartYear || 2022,
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
