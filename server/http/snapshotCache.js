/**
 * server/http/snapshotCache.js -- the local server's one parsed-save cache.
 * Purpose: the local server's one parsed-save cache and its reset rules.
 *
 * Every route that answers from the live save reaches it through this module.
 * That is the boundary: routing decides *what* to project, this decides *when a
 * save is re-parsed* and holds the only mutable state in the HTTP layer.
 *
 * Keeping it in one file matters because the state is coupled in ways that are
 * invisible from a route handler: `cachedPreviousRawSave` must be cleared with
 * the raw snapshot it was selected for, and `filteredSnapshotCache` must be
 * cleared whenever either changes. Split across route modules, each would grow
 * its own partial reset.
 */

const fs = require('fs');
const path = require('path');

const saveParser = require('../saveParser');
const snapshotBuilder = require('../snapshotBuilder');
const intelligenceFilter = require('../intelligenceFilter');
const snapshotIdentity = require('../snapshotIdentity');
const snapshotDelta = require('../snapshotDelta');
const snapshotLoader = require('../snapshotLoader');
const { resolveConfig } = require('../config');

const runtimeConfig = resolveConfig();

// In-memory snapshot cache
let cachedRawSave = null;
let cachedSavePath = null;
let cachedSaveFingerprintKey = null;
let cachedPreviousRawSave = null;
const filteredSnapshotCache = new Map();

const MAX_FILTERED_ENTRIES = 24;

/** The immediately older raw snapshot, or null. Selected by loadOrGetSnapshot. */
function getPreviousRawSnapshot() {
  return cachedPreviousRawSave;
}

/** Drops everything, forcing the next load to re-parse from disk. */
function resetCache() {
  cachedRawSave = null;
  cachedSavePath = null;
  cachedSaveFingerprintKey = null;
  cachedPreviousRawSave = null;
  filteredSnapshotCache.clear();
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

  // Key the cache on the same content fingerprint (size:mtimeMs:sha256) the
  // mid-write stability check uses. size:mtimeMs alone can repeat for a save
  // restored from a backup or copied over an older one, which served parsed
  // data from a different game state. The hash is a few milliseconds on a 3 MB
  // save and is reused for the stability check below, so a cache miss does no
  // extra work.
  const beforeFingerprint = snapshotIdentity.createFileFingerprint(saveFile.fullPath);
  if (cachedRawSave && cachedSavePath === saveFile.fullPath &&
    cachedSaveFingerprintKey === beforeFingerprint.key) {
    return cachedRawSave;
  }

  // Parse the save and verify it did not change while it was being read.
  console.log(`[Server] Parsing save ${saveFile.name}...`);
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

  // Keep the immediately older save available for a truthful "since last
  // save" comparison, walking back past saves that capture the same in-game
  // moment (an ExitSave written seconds after an Autosave, for instance) so the
  // comparison has something to report. A failed historical parse should not
  // block the current dashboard; it simply makes the delta panel explicitly
  // unavailable. The selection itself lives in snapshotLoader so the server,
  // the loader and the publisher cannot drift apart.
  const previous = snapshotLoader.selectPreviousRawSnapshot({
    saveFile,
    rawSnapshot,
    campaignKey: runtimeConfig.campaign.key,
    generatedAt: identity.generatedAt,
    onError: (previousError) => {
      console.warn(`[Server] Previous save comparison unavailable: ${previousError.message}`);
    }
  });
  cachedPreviousRawSave = previous?.snapshot || null;
  if (previous) {
    const selection = previous.selection;
    if (selection.reason === 'same-game-time-fallback') {
      console.log(`[Server] Every recent save shares in-game date ${rawSnapshot.metadata?.gameTimeString}; comparing against ${selection.save.name} anyway.`);
    } else if (selection.probed > 1) {
      console.log(`[Server] Comparing against ${selection.save.name} (${selection.gameTime}); skipped ${selection.probed - 1} save(s) from the same in-game moment.`);
    }
  }
  rawSnapshot.previousRawSnapshot = cachedPreviousRawSave;

  cachedRawSave = rawSnapshot;
  cachedSavePath = saveFile.fullPath;
  cachedSaveFingerprintKey = beforeFingerprint.key;
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
  if (filteredSnapshotCache.size >= MAX_FILTERED_ENTRIES) {
    filteredSnapshotCache.delete(filteredSnapshotCache.keys().next().value);
  }
  filteredSnapshotCache.set(cacheKey, filtered);
  return filtered;
}

module.exports = {
  loadOrGetSnapshot,
  buildFilteredSnapshot,
  getPreviousRawSnapshot,
  resetCache
};
