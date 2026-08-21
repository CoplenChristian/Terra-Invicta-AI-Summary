/**
 * scripts/publish/parseStage.js -- stage 2: turn a chosen save file into the
 * raw snapshot everything downstream reads.
 * Purpose: publish stage 2 — turn a chosen save file into the raw snapshot
 *   everything downstream reads.
 *
 * Deliberately NOT unified with `server/snapshotLoader.js`, and the reason is
 * worth keeping visible rather than rediscovering:
 *
 *   - `loadSnapshot` attaches `previousRawSnapshot` onto the raw snapshot it
 *     returns. The publisher hands that same raw snapshot to
 *     `buildStrategicSnapshot` and `generateMissionControlBriefing`, which would
 *     then be reading a different input object than they do today.
 *   - The publisher needs `targetSave.name` and `targetSave.lastModified` for
 *     the row's primary key and the campaign pointer; `loadSnapshot` does not
 *     return the save file it chose.
 *
 * What IS shared is the part that actually duplicates logic: the
 * previous-save selection walks through `snapshotLoader.selectPreviousRawSnapshot`,
 * so the server, the loader and the publisher cannot drift on which save counts
 * as "the one before this".
 */

const fs = require('fs');
const path = require('path');

const saveParser = require('../../server/saveParser');
const snapshotBuilder = require('../../server/snapshotBuilder');
const snapshotIdentity = require('../../server/snapshotIdentity');
const snapshotLoader = require('../../server/snapshotLoader');

/**
 * Resolves the save this run publishes: an explicit --save path, or the newest
 * save in the configured folder.
 *
 * Calls `process.exit(1)` on failure rather than throwing, because these are
 * operator errors with actionable messages and the publisher's contract is that
 * a non-zero exit means nothing was written.
 */
function resolveTargetSave(options) {
  if (options.savePath) {
    if (!fs.existsSync(options.savePath)) {
      console.error(`[Error] Explicit save file not found: ${options.savePath}`);
      process.exit(1);
    }
    if (!/\.(?:gz|json)$/i.test(options.savePath)) {
      console.error('[Error] Explicit save path must end in .gz or .json.');
      process.exit(1);
    }
    const stats = fs.statSync(options.savePath);
    return {
      name: path.basename(options.savePath),
      fullPath: path.resolve(options.savePath),
      sizeBytes: stats.size,
      lastModified: stats.mtime
    };
  }

  try {
    return saveParser.getLatestSaveFile();
  } catch (err) {
    console.error(`[Error] Failed to resolve latest save: ${err.message}`);
    process.exit(1);
  }
  return null;
}

/**
 * Parses the save, verifies it did not change while being read, and selects the
 * comparison baseline.
 *
 * The fingerprint check mirrors the server's: publishing a half-written save
 * would put a corrupt snapshot behind the campaign pointer, which is worse than
 * publishing nothing.
 *
 * Returns the raw snapshot, its identity, the previous raw snapshot (or null),
 * and the target save re-stamped with its content hash.
 */
function parseTargetSave(targetSave, options) {
  const beforeFingerprint = snapshotIdentity.createFileFingerprint(targetSave.fullPath);
  const parsedSave = saveParser.readSaveJson(targetSave.fullPath);
  const afterFingerprint = snapshotIdentity.createFileFingerprint(targetSave.fullPath);
  if (afterFingerprint.key !== beforeFingerprint.key) {
    console.error(`[Error] Save '${targetSave.name}' changed while it was being parsed. Terra Invicta may still be writing it; retry after the save finishes.`);
    process.exit(1);
  }
  const stampedSave = { ...targetSave, saveHash: beforeFingerprint.saveHash };

  const rawSnapshot = snapshotBuilder.buildRawSnapshot(parsedSave);
  const identity = snapshotIdentity.createSnapshotIdentity(stampedSave, options.campaignKey);
  snapshotIdentity.attachSnapshotIdentity(rawSnapshot, identity);

  // Skip past saves that capture the same in-game moment, otherwise the
  // published changesSincePrevious is empty whenever the latest save is an
  // ExitSave written seconds after an Autosave. The selection itself lives in
  // server/snapshotLoader.js so the publisher, the local server and the loader
  // share one implementation instead of three copies that can drift.
  const previousSelection = snapshotLoader.selectPreviousRawSnapshot({
    saveFile: stampedSave,
    rawSnapshot,
    campaignKey: options.campaignKey,
    generatedAt: identity.generatedAt,
    onError: (previousError) => {
      console.warn(`[Warning] Previous save comparison unavailable: ${previousError.message}`);
    }
  });
  if (previousSelection) {
    const selection = previousSelection.selection;
    console.log(`Comparison baseline:  ${selection.save.name}${selection.gameTime ? ` (${selection.gameTime})` : ''}${selection.reason === 'same-game-time-fallback' ? ' — every recent save shares this in-game moment' : ''}`);
  }

  return {
    targetSave: stampedSave,
    rawSnapshot,
    identity,
    previousRawSnapshot: previousSelection?.snapshot || null
  };
}

module.exports = {
  resolveTargetSave,
  parseTargetSave
};
