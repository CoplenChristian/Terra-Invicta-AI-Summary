/**
 * scripts/publish/rows.js -- stage 3: build the rows this publish will write,
 * then refuse to write them if they do not describe the save they claim to.
 *
 * Generation and validation live together on purpose. The validation is not a
 * style check: it is the last point at which a row that mixes two saves, or
 * carries an unlabelled visibility, can be caught before it becomes the thing
 * the hosted site serves. Splitting it away from the loop that produces the
 * rows is how a new field gets added to one and not checked by the other.
 */

const { INTELLIGENCE_MODES } = require('../../shared/constants.mjs');
// The one id-matching idiom. Faction ids reach this script both as numbers
// from the parsed save and as strings from `--observer` on the command line.
const { sameId } = require('../../shared/util.mjs');
const intelligenceFilter = require('../../server/intelligenceFilter');
const exportGenerator = require('../../server/exportGenerator');
const briefingGenerator = require('../../server/briefingGenerator');
const snapshotDelta = require('../../server/snapshotDelta');
const { PUBLISH_POLICY } = require('./options');
const { applyTechTreeMode } = require('./techGraph');

const MEGABYTE = 1024 * 1024;

/**
 * Pre-flight sanity ceiling on a single generated row. Operational policy, not
 * a measured value -- there is no published Supabase figure it derives from.
 */
const MAX_SNAPSHOT_ROW_BYTES = 12 * MEGABYTE;

// The save's gameTimeString ("8/16/2032 12:00:00 PM") is the in-game date and
// is what campaign chronology means. Falls back to the file mtime only when the
// string cannot be parsed, so a row is never left without an ordering key.
function campaignDateIso(gameTimeString, fallbackIso) {
  const parsed = Date.parse(gameTimeString);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallbackIso;
}

/**
 * Which modes get published for a given faction under the fan-out policy.
 *
 * `sameId`, not `===`: the observer id can arrive as a string from `--observer`
 * while the save's faction ID is numeric, and a strict comparison would silently
 * publish the "everyone else" mode list for the observer faction itself.
 */
function modesForObserver(factionId, options) {
  if (options.allObservers) return INTELLIGENCE_MODES;
  return sameId(factionId, options.observerFactionId)
    ? PUBLISH_POLICY.observerModes
    : PUBLISH_POLICY.otherFactionModes;
}

/**
 * The factions this run will publish for.
 *
 * The fallback roster is used ONLY when the parsed save lists no factions at
 * all. The ids are the stock campaign's; a modded or renamed campaign would
 * publish under the wrong labels, which is why the discovered list always wins.
 */
function discoverObserverFactions(rawSnapshot, fallbackFactions) {
  const discovered = (rawSnapshot.factions || []).filter(f => f.ID !== undefined);
  return discovered.length > 0 ? discovered : fallbackFactions;
}

function buildSnapshotRows({
  observerFactions,
  options,
  rawSnapshot,
  previousRawSnapshot,
  identity,
  targetSave,
  saveMtimeIso,
  gameTimeString,
  techGraphId
}) {
  const snapshotRows = [];
  for (const observer of observerFactions) {
    for (const mode of modesForObserver(observer.ID, options)) {
      const modeData = intelligenceFilter.applyFilter(rawSnapshot, mode, observer.ID);
      if (mode === 'player') intelligenceFilter.assertPlayerSnapshotSafe(modeData);
      if (previousRawSnapshot) {
        const previousModeData = intelligenceFilter.applyFilter(previousRawSnapshot, mode, observer.ID);
        modeData.changesSincePrevious = snapshotDelta.build(previousModeData, modeData, observer.ID);
      } else {
        modeData.changesSincePrevious = snapshotDelta.build(null, modeData, observer.ID);
      }
      const missionControlBriefing = briefingGenerator.generateMissionControlBriefing(modeData, rawSnapshot);
      const compactMarkdown = exportGenerator.generateCompactSnapshot(modeData);
      const fullMarkdown = exportGenerator.generateFullMarkdownReport(modeData);

      snapshotRows.push({
        campaign_key: options.campaignKey,
        save_filename: targetSave.name,
        save_last_modified: saveMtimeIso,
        game_time: gameTimeString,
        difficulty: rawSnapshot.metadata.difficulty,
        campaign_start_year: rawSnapshot.metadata.campaignStartYear,
        observer_faction_id: observer.ID,
        observer_faction_name: observer.displayName,
        // The retained full-fidelity rows keep the tech tree because the
        // hosted worker's tech endpoints need it to answer queries. Operators
        // can pass --omit-tech-tree when publishing a deliberately reduced row;
        // that row will expose techTreeRef and the hosted tech endpoints will
        // correctly report that the graph is unavailable.
        snapshot: {
          ...applyTechTreeMode(modeData, options, techGraphId),
          missionControlBriefing
        },
        chatgpt_export: {
          compact: compactMarkdown,
          full: fullMarkdown
        },
        visibility: mode,
        generated_at: identity.generatedAt
      });
    }
  }
  return snapshotRows;
}

function validateSnapshotRows(rows, identity, targetSave) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('No snapshot rows were generated; refusing to publish an empty campaign.');
  }

  const maxBytes = MAX_SNAPSHOT_ROW_BYTES;
  for (const row of rows) {
    const snapshot = row.snapshot || {};
    if (snapshot.snapshotId !== identity.snapshotId ||
      snapshot.saveHash !== identity.saveHash ||
      snapshot.saveModifiedAt !== identity.saveModifiedAt ||
      !snapshot.generatedAt ||
      row.save_last_modified !== identity.saveModifiedAt ||
      row.save_filename !== targetSave.name ||
      !['player', 'enhanced', 'omniscient'].includes(row.visibility)) {
      throw new Error(`Snapshot identity validation failed for observer ${row.observer_faction_id} / ${row.visibility}.`);
    }
    const size = Buffer.byteLength(JSON.stringify(row), 'utf8');
    if (size > maxBytes) {
      throw new Error(`Snapshot row for observer ${row.observer_faction_id} is too large to publish (${size} bytes).`);
    }
  }
}

module.exports = {
  MEGABYTE,
  MAX_SNAPSHOT_ROW_BYTES,
  campaignDateIso,
  modesForObserver,
  discoverObserverFactions,
  buildSnapshotRows,
  validateSnapshotRows
};
