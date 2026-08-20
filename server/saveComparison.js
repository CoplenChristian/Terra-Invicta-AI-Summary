/**
 * Chooses which earlier save the "since last save" comparison should use.
 *
 * Picking the immediately-previous file by modification time produces an empty
 * diff whenever two saves capture the same in-game moment. Terra Invicta does
 * this routinely: quitting writes an ExitSave seconds after the last Autosave,
 * and Autosave/Autosave2 can land in the same in-game moment. The panel then
 * reports "0 game days elapsed, no material change", which is technically true
 * and completely useless.
 *
 * So the comparison walks back until it finds a save from a DIFFERENT in-game
 * date. Filename is not the signal -- in-game time is, which also covers
 * quicksaves and combat autosaves, not just ExitSave.
 *
 * Reading a save is expensive (multi-MB gzip), so the walk is bounded and each
 * candidate is read at most once.
 */

const path = require('path');

const DEFAULT_MAX_PROBE = 4;

const normalizePath = (value) => path.resolve(String(value || '')).toLowerCase();

const modifiedMs = (save) => {
  const time = new Date(save?.lastModified || 0).getTime();
  return Number.isFinite(time) ? time : 0;
};

/**
 * @param {object[]} candidates      Available saves (any order)
 * @param {object}   current         The save being displayed
 * @param {string}   currentGameTime Its in-game date string
 * @param {(save:object)=>string|null} readGameTime Reads a candidate's in-game date
 * @param {object}   [options]
 * @param {number}   [options.maxProbe] How many candidates may be read
 * @returns {{save:object, gameTime:string|null, reason:string, probed:number}|null}
 */
function selectComparisonSave(candidates, current, currentGameTime, readGameTime, options = {}) {
  const maxProbe = Number.isInteger(options.maxProbe) && options.maxProbe > 0
    ? options.maxProbe
    : DEFAULT_MAX_PROBE;

  const currentPath = normalizePath(current?.fullPath);
  const currentMs = modifiedMs(current);

  const older = (Array.isArray(candidates) ? candidates : [])
    .filter(candidate => normalizePath(candidate?.fullPath) !== currentPath)
    .filter(candidate => modifiedMs(candidate) < currentMs)
    .sort((a, b) => modifiedMs(b) - modifiedMs(a));

  if (older.length === 0) return null;

  // Without a current in-game date there is nothing to compare against, so
  // fall back to the immediately previous save rather than reading files to no
  // purpose.
  if (!currentGameTime) {
    return { save: older[0], gameTime: null, reason: 'current-game-time-unknown', probed: 0 };
  }

  let probed = 0;
  let firstReadable = null;

  for (const candidate of older) {
    if (probed >= maxProbe) break;

    let gameTime = null;
    try {
      gameTime = readGameTime(candidate);
    } catch (err) {
      // An unreadable save (mid-write, corrupt) is skipped, not fatal.
      probed += 1;
      continue;
    }
    probed += 1;

    if (!gameTime) continue;
    if (!firstReadable) firstReadable = { save: candidate, gameTime };

    if (gameTime !== currentGameTime) {
      return { save: candidate, gameTime, reason: 'distinct-game-time', probed };
    }
  }

  // Every candidate examined shares the current in-game moment. Compare against
  // the nearest one anyway and say so, rather than showing nothing.
  if (firstReadable) {
    return { ...firstReadable, reason: 'same-game-time-fallback', probed };
  }

  return { save: older[0], gameTime: null, reason: 'unreadable-fallback', probed };
}

module.exports = { selectComparisonSave, DEFAULT_MAX_PROBE };
