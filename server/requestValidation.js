const path = require('path');
const fs = require('fs');
const { SUPPORTED_MODES } = require('../shared/constants.mjs');

const LOCAL_MODES = SUPPORTED_MODES;
const HOSTED_MODES = SUPPORTED_MODES;

class RequestValidationError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'RequestValidationError';
    this.statusCode = statusCode;
  }
}

function parseMode(value, supportedModes = LOCAL_MODES) {
  const mode = value === undefined || value === null || value === '' ? 'player' : String(value);
  if (!supportedModes.has(mode)) {
    throw new RequestValidationError(
      `Invalid intelligence mode '${mode}'. Supported modes: ${Array.from(supportedModes).join(', ')}.`
    );
  }
  return mode;
}

function parseObserverId(value, defaultId = 4712) {
  const raw = value === undefined || value === null || value === '' ? String(defaultId) : String(value);
  if (!/^\d+$/.test(raw)) {
    throw new RequestValidationError(`Invalid observer faction id '${raw}'. Use a numeric faction id.`);
  }
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new RequestValidationError(`Invalid observer faction id '${raw}'.`);
  }
  return id;
}

function assertKnownObserver(snapshot, observerId) {
  const known = (snapshot?.factions || []).some(faction => Number(faction.ID) === observerId);
  if (!known) {
    throw new RequestValidationError(`Observer faction '${observerId}' is not present in this save.`, 404);
  }
  return observerId;
}

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

function parseOptionalNumericQuery(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const raw = String(value);
  if (!/^\d+$/.test(raw)) {
    throw new RequestValidationError(`Invalid ${label} '${raw}'. Use a numeric id.`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new RequestValidationError(`Invalid ${label} '${raw}'.`);
  }
  return parsed;
}

function parseBodyQuery(value) {
  if (value === undefined || value === null || value === '') return null;
  const body = String(value).trim();
  if (body.length > 80 || /[\u0000-\u001f\u007f]/.test(body)) {
    throw new RequestValidationError('Invalid body filter. Use a short body name such as Ceres.');
  }
  return body;
}

function parseBoundedIntegerQuery(value, label, { min = 1, max = 100, defaultValue = null } = {}) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const raw = String(value);
  if (!/^\d+$/.test(raw)) {
    throw new RequestValidationError(`Invalid ${label} '${raw}'. Use an integer from ${min} to ${max}.`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new RequestValidationError(`Invalid ${label} '${raw}'. Use an integer from ${min} to ${max}.`);
  }
  return parsed;
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
  parseBoundedIntegerQuery
};
