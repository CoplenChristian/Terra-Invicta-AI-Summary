const fs = require('fs');
const path = require('path');
const { resolveConfig } = require('./config');
const saveParser = require('./saveParser');
const snapshotBuilder = require('./snapshotBuilder');
const intelligenceFilter = require('./intelligenceFilter');
const snapshotIdentity = require('./snapshotIdentity');
const snapshotDelta = require('./snapshotDelta');
const saveComparison = require('./saveComparison');
const templateLoader = require('./templateLoader');
const intelResources = require('./intelResources');
const { DEFAULT_OBSERVER_FACTION_ID } = require('../shared/constants.mjs');

let cachedRawSave = null;
let cachedSavePath = null;
let cachedSaveStatKey = null;
let cachedPreviousRawSave = null;
const filteredSnapshotCache = new Map();

/**
 * Ensures templates are loaded.
 */
function ensureTemplatesLoaded() {
  if (!templateLoader.isLoaded) {
    templateLoader.load();
  }
}

/**
 * Loads or returns a cached raw snapshot from a target save file or the latest save.
 *
 * @param {Object} options
 * @param {string|null} [options.savePath=null] - Explicit path or filename. If null, uses the latest save.
 * @param {boolean} [options.bypassCache=false] - Force re-parsing even if cached.
 * @param {string|null} [options.campaignKey=null] - Optional campaign key override.
 * @returns {Object} The raw snapshot with attached snapshot identity and previousRawSnapshot.
 */
function loadSnapshot({
  savePath = null,
  bypassCache = false,
  campaignKey = null
} = {}) {
  ensureTemplatesLoaded();
  const runtimeConfig = resolveConfig();
  const effectiveCampaignKey = campaignKey || runtimeConfig.campaign.key;

  let saveFile = null;
  if (savePath) {
    let resolved = path.resolve(savePath);
    if (!fs.existsSync(resolved)) {
      // Try resolving relative to configured save path directory
      const configuredFolder = saveParser.resolveSaveFolder();
      const candidate = path.join(configuredFolder, savePath);
      if (fs.existsSync(candidate)) {
        resolved = candidate;
      } else {
        throw new Error(`Save file not found at ${savePath}`);
      }
    }
    const stats = fs.statSync(resolved);
    saveFile = {
      name: path.basename(resolved),
      fullPath: resolved,
      sizeBytes: stats.size,
      lastModified: stats.mtime
    };
  } else {
    saveFile = saveParser.getLatestSaveFile();
  }

  const stats = fs.statSync(saveFile.fullPath);
  if (!saveFile.lastModified) saveFile.lastModified = stats.mtime;
  const statKey = `${stats.size}:${stats.mtimeMs}`;

  if (!bypassCache && cachedRawSave && cachedSavePath === saveFile.fullPath && cachedSaveStatKey === statKey) {
    return cachedRawSave;
  }

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
    effectiveCampaignKey
  );
  snapshotIdentity.attachSnapshotIdentity(rawSnapshot, identity);

  // Attempt to load previous save comparison
  cachedPreviousRawSave = null;
  try {
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
        effectiveCampaignKey,
        identity.generatedAt
      ));
    }
  } catch (previousError) {
    // Non-fatal if previous comparison cannot be resolved
  }

  rawSnapshot.previousRawSnapshot = cachedPreviousRawSave;
  cachedRawSave = rawSnapshot;
  cachedSavePath = saveFile.fullPath;
  cachedSaveStatKey = statKey;
  filteredSnapshotCache.clear();

  return rawSnapshot;
}

/**
 * Resolves an observer faction identifier (number or name) to a numeric ID.
 */
function resolveObserverId(rawSnapshot, observer) {
  if (observer === null || observer === undefined) {
    return DEFAULT_OBSERVER_FACTION_ID;
  }
  const numeric = Number(observer);
  if (Number.isInteger(numeric) && numeric > 0) {
    return numeric;
  }
  const observerStr = String(observer).toLowerCase().trim();
  const factions = Array.isArray(rawSnapshot.factions) ? rawSnapshot.factions : [];
  const found = factions.find(f =>
    String(f.displayName || '').toLowerCase().includes(observerStr) ||
    String(f.templateName || '').toLowerCase().includes(observerStr)
  );
  return found ? found.ID : DEFAULT_OBSERVER_FACTION_ID;
}

/**
 * Loads a filtered snapshot given an observer and visibility mode.
 *
 * @param {Object} options
 * @param {string|null} [options.savePath=null] - Explicit save path or null for latest.
 * @param {string} [options.mode='player'] - 'player', 'enhanced', or 'omniscient'.
 * @param {number|string} [options.observer='the Initiative'] - Faction ID or name.
 * @param {boolean} [options.bypassCache=false] - Force re-parse.
 * @returns {Object} Filtered snapshot with delta changes attached.
 */
function loadFilteredSnapshot({
  savePath = null,
  mode = 'player',
  observer = 'the Initiative',
  bypassCache = false
} = {}) {
  const rawSnapshot = loadSnapshot({ savePath, bypassCache });
  const observerId = resolveObserverId(rawSnapshot, observer);
  const cacheKey = `${rawSnapshot.snapshotId || 'unidentified'}|${mode}|${observerId}`;

  if (!bypassCache && filteredSnapshotCache.has(cacheKey)) {
    return filteredSnapshotCache.get(cacheKey);
  }

  const filtered = intelligenceFilter.applyFilter(rawSnapshot, mode, observerId);
  const previousRawSnapshot = rawSnapshot.previousRawSnapshot;
  if (previousRawSnapshot) {
    const previousFiltered = intelligenceFilter.applyFilter(previousRawSnapshot, mode, observerId);
    filtered.changesSincePrevious = snapshotDelta.build(previousFiltered, filtered, observerId);
  } else {
    filtered.changesSincePrevious = snapshotDelta.build(null, filtered, observerId);
  }

  filteredSnapshotCache.set(cacheKey, filtered);
  return filtered;
}

/**
 * Queries an intel resource from a snapshot.
 *
 * @param {Object} options
 * @param {Object} [options.snapshot=null] - Pre-loaded snapshot. If omitted, loads latest filtered snapshot.
 * @param {string} options.endpoint - Name of resource (e.g. 'mining', 'summary', 'alien-threat', etc.).
 * @param {Object} [options.queryOptions={}] - Filtering parameters (theater, body, limit, factionId, etc.).
 * @param {string} [options.mode='player'] - 'player' or 'omniscient' if loading snapshot.
 * @param {number|string} [options.observer='the Initiative'] - Observer if loading snapshot.
 * @param {string|null} [options.savePath=null] - Save path if loading snapshot.
 * @returns {Object} Intel resource projection payload.
 */
function queryIntel({
  snapshot = null,
  endpoint,
  queryOptions = {},
  mode = 'player',
  observer = 'the Initiative',
  savePath = null
} = {}) {
  const effectiveSnapshot = snapshot || loadFilteredSnapshot({ savePath, mode, observer });
  return intelResources.buildResource(effectiveSnapshot, endpoint, {
    mode,
    ...queryOptions
  });
}

/**
 * Clears in-memory caches.
 */
function clearCache() {
  cachedRawSave = null;
  cachedSavePath = null;
  cachedSaveStatKey = null;
  cachedPreviousRawSave = null;
  filteredSnapshotCache.clear();
}

module.exports = {
  loadSnapshot,
  loadFilteredSnapshot,
  queryIntel,
  resolveObserverId,
  clearCache,
  ensureTemplatesLoaded
};
