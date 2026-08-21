/**
 * server/requestValidation.js -- CommonJS barrel over shared/requestValidation.mjs.
 * Purpose: CommonJS barrel over shared/requestValidation.mjs, adding only the
 *   two pieces that need Node (save-path resolution and the configured observer).
 *
 * The rules themselves moved to `shared/requestValidation.mjs` so the hosted
 * Cloudflare worker can import the same ones; this file re-exports the SAME
 * function objects (not wrappers) and adds only the two pieces that need Node:
 * `resolveSavePath`, which touches the filesystem, and the configured default
 * observer faction id.
 *
 * `tests/serverBarrels.test.js` pins the reference identity, because a wrapper
 * passes every behavioural test while letting the barrel and the shared module
 * drift apart.
 */

const path = require('path');
const fs = require('fs');
const { SUPPORTED_MODES } = require('../shared/constants.mjs');
const shared = require('../shared/requestValidation.mjs');
const { resolveConfig } = require('./config');

const DEFAULT_OBSERVER_FACTION_ID = resolveConfig().campaign.defaultObserverFactionId;

const LOCAL_MODES = SUPPORTED_MODES;
const HOSTED_MODES = SUPPORTED_MODES;

const {
  RequestValidationError,
  parseMode,
  assertKnownObserver,
  parseOptionalNumericQuery,
  parseBodyQuery,
  parseBoundedIntegerQuery
} = shared;

/**
 * The ONE deliberate wrapper.
 *
 * The shared parser takes the default observer id as a parameter because the
 * hosted worker resolves its own from the deployment environment. The local
 * default is configuration (`campaign.defaultObserverFactionId`, overridable
 * via `SUPABASE_OBSERVER_FACTION_ID`), so binding it here is what keeps that
 * seam intact -- hard-coding `shared`'s 4712 fallback would silently ignore a
 * configured observer. `tests/serverBarrels.test.js` asserts this is the only
 * export that is not the shared module's own function object, and that it
 * agrees with the shared function called with the same default.
 */
function parseObserverId(value, defaultId = DEFAULT_OBSERVER_FACTION_ID) {
  return shared.parseObserverId(value, defaultId);
}

/**
 * Resolves a caller-supplied save name to an absolute path inside the
 * configured save folder, or throws.
 *
 * Node-only, and deliberately not shared: the hosted worker has no filesystem
 * and never selects a save by name -- it reads whichever snapshot the campaign
 * pointer names. Sharing this would put `fs` into a module the worker imports.
 */
function resolveSavePath(saveParser, saveName) {
  if (saveName === undefined || saveName === null || saveName === '') return null;

  const name = String(saveName);
  const folder = path.resolve(saveParser.resolveSaveFolder());
  const isSimpleName = name === path.basename(name) &&
    !name.includes('/') &&
    !name.includes('\\') &&
    !name.includes('\0') &&
    !name.includes('..');
  if (!isSimpleName || !/\.(?:gz|json)$/i.test(name)) {
    throw new RequestValidationError('Invalid save name. Select a .gz or .json save from /api/saves.');
  }

  const selected = saveParser.getAvailableSaves().find(save => save.name === name);
  if (!selected) {
    throw new RequestValidationError(`Save '${name}' was not found in the configured save folder.`, 404);
  }

  const resolved = path.resolve(selected.fullPath);
  const realFolder = fs.realpathSync(folder);
  const realSelected = fs.realpathSync(resolved);
  if (path.dirname(resolved).toLowerCase() !== folder.toLowerCase() ||
    path.dirname(realSelected).toLowerCase() !== realFolder.toLowerCase()) {
    throw new RequestValidationError('The selected save is outside the configured save folder.');
  }
  return resolved;
}

module.exports = {
  LOCAL_MODES,
  HOSTED_MODES,
  RequestValidationError,
  parseMode,
  parseObserverId,
  assertKnownObserver,
  resolveSavePath,
  parseOptionalNumericQuery,
  parseBodyQuery,
  parseBoundedIntegerQuery,
  // Shared rule primitives, re-exported so a local route needing the raw
  // decision (rather than the throw) does not grow a third copy of it.
  isPositiveIntegerId: shared.isPositiveIntegerId,
  parsePositiveIntegerOrNull: shared.parsePositiveIntegerOrNull,
  exceedsBodyFilterLimits: shared.exceedsBodyFilterLimits,
  hasControlCharacters: shared.hasControlCharacters,
  isBoundedInteger: shared.isBoundedInteger,
  usesQuantityAsLimit: shared.usesQuantityAsLimit,
  MINING_LIMIT_RESOURCES: shared.MINING_LIMIT_RESOURCES,
  MINING_LIMIT_BOUNDS: shared.MINING_LIMIT_BOUNDS,
  HISTORY_LIMIT_BOUNDS: shared.HISTORY_LIMIT_BOUNDS,
  HISTORY_LIMIT_DEFAULT: shared.HISTORY_LIMIT_DEFAULT,
  BODY_FILTER_MESSAGE: shared.BODY_FILTER_MESSAGE
};
