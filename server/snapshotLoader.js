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
const { DEFAULT_OBSERVER_FACTION_ID, INITIATIVE_DISPLAY_NAME } = require('../shared/constants.mjs');

let cachedRawSave = null;
let cachedSavePath = null;
let cachedSaveFingerprintKey = null;
let cachedPreviousRawSave = null;
const filteredSnapshotCache = new Map();

/**
 * Raised when a supplied observer cannot be matched to a faction in the save.
 *
 * Carries statusCode 404 so it reports the same way as
 * requestValidation.assertKnownObserver does over HTTP. The loader path is what
 * the documented `npm run parse` CLI and the programmatic API use, and it used
 * to answer silently about the default faction instead.
 */
class UnknownObserverError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnknownObserverError';
    this.statusCode = 404;
  }
}

/**
 * Ensures templates are loaded.
 */
function ensureTemplatesLoaded() {
  if (!templateLoader.isLoaded) {
    templateLoader.load();
  }
}

/**
 * Picks and parses the immediately older save to compare against.
 *
 * The local server, this loader, and the Supabase publisher all need the same
 * "walk back past saves that capture the same in-game moment" behaviour, and
 * each carried its own copy of it. Callers supply their own campaign key and
 * logging so the extraction changes no observable behaviour.
 *
 * @returns {{ snapshot: Object, selection: Object }|null} null when no usable
 *   comparison save exists; never throws (a failed historical parse must not
 *   block the current snapshot, it only makes the delta explicitly empty).
 */
function selectPreviousRawSnapshot({ saveFile, rawSnapshot, campaignKey, generatedAt, onError = null }) {
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

    if (!selection?.save) return null;

    const previous = readCandidate(selection.save);
    snapshotIdentity.attachSnapshotIdentity(previous, snapshotIdentity.createSnapshotIdentity(
      selection.save,
      campaignKey,
      generatedAt
    ));
    return { snapshot: previous, selection };
  } catch (previousError) {
    if (onError) onError(previousError);
    return null;
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

  // The cache key is the same content fingerprint the mid-write stability check
  // uses (size:mtimeMs:sha256), not size:mtimeMs alone. A save restored from a
  // backup or copied over an old one can reproduce both the size and the mtime,
  // and the weaker key then served parsed data from a different game state.
  // Hashing a 3 MB save costs single-digit milliseconds against seconds to
  // reparse it, and the fingerprint is reused for the stability check below so
  // this adds no extra hashing on a cache miss.
  const beforeFingerprint = snapshotIdentity.createFileFingerprint(saveFile.fullPath);

  if (!bypassCache && cachedRawSave && cachedSavePath === saveFile.fullPath &&
    cachedSaveFingerprintKey === beforeFingerprint.key) {
    return cachedRawSave;
  }

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

  // Attempt to load previous save comparison. Non-fatal if it cannot be
  // resolved: the delta panel simply reports nothing to compare against.
  const previous = selectPreviousRawSnapshot({
    saveFile,
    rawSnapshot,
    campaignKey: effectiveCampaignKey,
    generatedAt: identity.generatedAt
  });
  cachedPreviousRawSave = previous?.snapshot || null;

  rawSnapshot.previousRawSnapshot = cachedPreviousRawSave;
  cachedRawSave = rawSnapshot;
  cachedSavePath = saveFile.fullPath;
  cachedSaveFingerprintKey = beforeFingerprint.key;
  filteredSnapshotCache.clear();

  return rawSnapshot;
}

/**
 * Resolves an observer faction identifier (number or name) to a numeric ID.
 *
 * An unmatched observer is reported, never silently replaced with the default
 * faction. `intelligenceFilter.applyFilter` falls back to the Initiative (and
 * then to factions[0]) for an unknown id, so an unresolved observer here does
 * not produce an empty answer -- it produces a confident answer about the wrong
 * faction. The HTTP path already returns 404 for the same input via
 * requestValidation.assertKnownObserver; this brings the loader, the documented
 * `npm run parse` CLI, and the programmatic API into line with it.
 *
 * @throws {UnknownObserverError} when the observer cannot be matched.
 */
function resolveObserverId(rawSnapshot, observer) {
  if (observer === null || observer === undefined || String(observer).trim() === '') {
    return DEFAULT_OBSERVER_FACTION_ID;
  }
  const factions = Array.isArray(rawSnapshot?.factions) ? rawSnapshot.factions : [];
  const knownIds = factions
    .map(faction => Number(faction?.ID))
    .filter(id => Number.isFinite(id));

  const raw = String(observer).trim();
  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw);
    if (!Number.isSafeInteger(numeric) || numeric <= 0) {
      throw new UnknownObserverError(`Invalid observer faction id '${observer}'. Use a positive numeric faction id.`);
    }
    // Only assert membership when the snapshot actually lists factions; a
    // caller-built fixture with no faction list cannot be checked, and
    // "unknown" must not be reported as a match either way.
    if (knownIds.length > 0 && !knownIds.includes(numeric)) {
      throw new UnknownObserverError(
        `Observer faction '${numeric}' is not present in this save. Known faction ids: ${knownIds.join(', ')}.`
      );
    }
    return numeric;
  }

  const observerStr = raw.toLowerCase();
  const found = factions.find(f =>
    String(f.displayName || '').toLowerCase().includes(observerStr) ||
    String(f.templateName || '').toLowerCase().includes(observerStr)
  );
  if (!found) {
    const known = factions
      .map(f => f.displayName || f.templateName)
      .filter(Boolean);
    throw new UnknownObserverError(
      `Observer faction '${observer}' did not match any faction in this save.` +
      (known.length ? ` Known factions: ${known.join(', ')}.` : '')
    );
  }
  return found.ID;
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
  observer = INITIATIVE_DISPLAY_NAME,
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
  observer = INITIATIVE_DISPLAY_NAME,
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
  cachedSaveFingerprintKey = null;
  cachedPreviousRawSave = null;
  filteredSnapshotCache.clear();
}

module.exports = {
  loadSnapshot,
  loadFilteredSnapshot,
  queryIntel,
  resolveObserverId,
  selectPreviousRawSnapshot,
  UnknownObserverError,
  clearCache,
  ensureTemplatesLoaded
};
