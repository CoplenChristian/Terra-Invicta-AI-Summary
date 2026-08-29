// server/saveParser.js
//
// Purpose: locate, decompress and parse a Terra Invicta save file into raw game state.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { resolveConfig } = require('./config');
const {
  buildCampaignSettings,
  buildScenarioCustomizations,
  CAMPAIGN_SETTINGS_UNAVAILABLE,
  SCENARIO_CUSTOMIZATIONS_UNAVAILABLE
} = require('../shared/campaignSettings.mjs');

/**
 * Reads the single Value object out of a `gamestates` collection.
 *
 * The save stores each state class as an array of `{ Key, Value }` wrappers,
 * but a few are written unwrapped. Both shapes appear across the 14 saves in
 * the user's folder, so both are handled here rather than at each call site.
 */
function firstStateValue(gamestates, stateClassName) {
  const rows = gamestates?.[`PavonisInteractive.TerraInvicta.${stateClassName}`];
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const first = rows[0];
  if (!first || typeof first !== 'object') return null;
  return (first.Value !== undefined && first.Value !== null) ? first.Value : first;
}

/**
 * Strict numeric read. `Number(null)`, `Number('')`, `Number('   ')` and
 * `Number([])` are ALL 0, so an absent or malformed field would otherwise
 * become a confident zero -- a campaign that has run for no time at all, which
 * reads as "the total-war gate is the full ten years away".
 *
 * Only an actual number or a non-blank numeric string counts as a reading;
 * everything else is null. This is the same rule as `strictFiniteNumber` in
 * shared/util.mjs, restated here because saveParser is the CommonJS boundary
 * and reads raw, arbitrarily-shaped save fields.
 */
function finiteOrNull(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * `TIGlobalResearchState.campaignStartYear` -- the save's own campaign start
 * year. Present in 14 of 14 saves measured 2026-08-21: 2026 on this campaign's
 * `2026Start` scenario, 2022 on the older `ModernDayStart` ones (which is why
 * the 2022 assumption was right for those and wrong for this one).
 */
function readCampaignStartYear(gamestates) {
  return finiteOrNull(firstStateValue(gamestates, 'TIGlobalResearchState')?.campaignStartYear);
}
/**
 * `TITimeState.daysInCampaign` -- the game's own campaign-duration counter, and
 * the most direct measurement of the quantity the total-war year gate needs.
 */
function readDaysInCampaign(gamestates) {
  return finiteOrNull(firstStateValue(gamestates, 'TITimeState')?.daysInCampaign);
}

/**
 * `TIGlobalValuesState.scenarioCustomizations` -- the second campaign-settings
 * block, carrying the nineteen speed-multiplier and mode-flag knobs the
 * dashboard's ship designer and ship-builder both need. Read the same way
 * the other state-class reads work: the first wrapper's Value, or the wrapper
 * itself if the save is one of the unwrapped ones.
 *
 * Returned raw: NOT built into the campaign-settings block. The caller
 * decides whether to build it (the two readers may want to compose
 * differently depending on whether they have a meta block at all).
 */
function readScenarioCustomizations(gamestates) {
  return firstStateValue(gamestates, 'TIGlobalValuesState')?.scenarioCustomizations || null;
}

/**
 * Merges the two baked campaign-settings blocks into one composite.
 *
 * The two readers are independent because they read from two different
 * `TI*State` collections and a save can carry either without the other --
 * a save with no `customDifficulty` field on the metadata block still
 * carries `scenarioCustomizations`, and vice versa. The composite exists so
 * downstream consumers (the snapshot builder, the raw snapshot, the dashboard
 * surface) can read everything off one path. The metadata block is the
 * source of truth for the existing nine; the scenario block is the source
 * of truth for the new nineteen. They are not interchangeable.
 *
 * Settings keys are unique to their block, so the merge is a flat concat.
 * `customDifficulty` stays on the metadata block; `armourMultipliers` is
 * added at the top level by the scenario block.
 */
function combineCampaignSettings(metaBlock, scenarioBlock) {
  const meta = metaBlock || CAMPAIGN_SETTINGS_UNAVAILABLE;
  const scenario = scenarioBlock || SCENARIO_CUSTOMIZATIONS_UNAVAILABLE;
  return Object.freeze({
    ...meta,
    settings: Object.freeze({ ...meta.settings, ...scenario.settings }),
    scenarioCustomizations: scenario,
    armourMultipliers: scenario.armourMultipliers
  });
}

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
    // The second campaign-settings block: nineteen speed-multiplier and
    // mode-flag knobs that live on `TIGlobalValuesState.scenarioCustomizations`,
    // not on the metadata block. Read raw here; build after the merge below.
    const rawScenarioCustomizations = readScenarioCustomizations(json.gamestates);

    // Build the two baked blocks independently and merge them. The metadata
    // block keeps its existing byte-identical output for the nine custom-
    // difficulty values; the scenario block carries the nineteen new ones;
    // the composite exposes both under `settings` and surfaces
    // `armourMultipliers` at the top level for the ship designer.
    const metadataBlock = buildCampaignSettings(metaObj);
    const scenarioBlock = buildScenarioCustomizations(rawScenarioCustomizations);

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
      // The custom-difficulty block sitting beside `difficulty` in the same
      // state. Baking only the label let a campaign running four rates at 200%
      // present itself as plain 'Normal'. The values arrive as strings with a
      // percent sign ("200%") or as bare numerals ("150"), so the parsing lives
      // in shared/campaignSettings.mjs where the `Number("200%") === NaN` trap
      // is handled once -- an unreadable setting is null, never a confident 0.
      //
      // The block here is the COMPOSITE: the metadata-derived nine fields plus
      // the nineteen `scenarioCustomizations` fields and the derived
      // `armourMultipliers`. The metadata read stays byte-identical; the
      // scenario block adds the rest without changing what the existing
      // consumers observe.
      campaignSettings: combineCampaignSettings(metadataBlock, scenarioBlock),
      // Campaign start year drives elapsed-years gating. An invented 2022
      // silently shifts every elapsed-time calculation.
      //
      // `TIMetadataState` does not carry it -- absent in 14 of 14 saves
      // measured 2026-08-21 -- so this reading is null on every real save and
      // the two below are what actually answer. It is kept because a save that
      // did carry it should still be believed, and because the synthetic test
      // fixtures set it here.
      campaignStartYear: Number.isFinite(Number(metaObj.campaignStartYear)) && metaObj.campaignStartYear !== null && metaObj.campaignStartYear !== ''
        ? Number(metaObj.campaignStartYear)
        : null,
      // The two states that DO carry elapsed campaign time, in 14 of 14 saves.
      // See shared/campaignElapsed.mjs for which is preferred and why.
      campaignStartYearFromResearchState: readCampaignStartYear(json.gamestates),
      daysInCampaign: readDaysInCampaign(json.gamestates),
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
