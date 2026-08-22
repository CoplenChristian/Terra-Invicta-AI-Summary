/**
 * Shared request-validation rules for both runtimes.
 * Purpose: the accept/reject request-validation rules shared by the local
 *   Express server and the hosted Cloudflare worker.
 *
 * The 2026-08-20 review (section D) named this as the reason the local Express
 * server and the hosted Cloudflare worker duplicate validation:
 * `server/requestValidation.js` is CommonJS, the worker cannot `require` it, so
 * the worker grew a second hand-written copy of every rule. Two copies of
 * "what counts as a valid observer id" is exactly the shape that drifts
 * silently -- a tightened bound on one side leaves the other accepting input
 * the rest of the system assumes was rejected.
 *
 * This module is plain ESM with no Node built-ins and no configuration lookup,
 * so the worker can import it directly and `scripts/build_static_snapshot.js`
 * copies it beside the worker entry point unchanged. Node's `require(esm)`
 * support lets `server/requestValidation.js` re-export these same function
 * objects to the CommonJS server.
 *
 * WHAT IS SHARED AND WHAT IS NOT
 *
 * What is shared is the *decision*: which inputs are accepted and which are
 * rejected. That is the half that must never drift.
 *
 * What is deliberately NOT shared is the wire text of each rejection. The two
 * runtimes have always worded these differently and both wordings are published
 * contract:
 *
 *   observer      local  "Invalid observer faction id 'abc'. Use a numeric faction id."
 *                 hosted "Invalid observer faction 'abc'."
 *   faction filter local  "Invalid faction filter 'abc'. Use a numeric id."
 *                 hosted "Invalid faction filter 'abc'. Use a positive numeric id."
 *   mining limit  local  "Invalid mining prospects limit 'abc'. Use an integer from 1 to 100."
 *                 hosted "Invalid mining prospects limit. Use an integer from 1 to 100."
 *
 * Unifying those strings would change what an existing hosted client reads back,
 * which is a behaviour change, not a refactor. Each runtime therefore keeps its
 * own message and calls the predicates below for the decision. The body-filter
 * message is the one that already matched in both runtimes, so it is shared
 * verbatim as `BODY_FILTER_MESSAGE`.
 *
 * Two further input-handling differences are also preserved rather than
 * quietly harmonised, and are named here so they are visible instead of buried:
 *
 *   - The local server trims a body filter before measuring it; the hosted
 *     worker measures the raw value. `exceedsBodyFilterLimits` therefore takes
 *     an already-prepared string and each runtime keeps its own preparation.
 *   - The hosted worker reads `?faction=` through `get('faction') || get('factionId')`,
 *     so a present-but-empty value falls through to "absent". The local server
 *     treats present-but-empty as absent explicitly. Same outcome, different
 *     route to it; neither is changed here.
 */

import { SUPPORTED_MODES, DEFAULT_OBSERVER_FACTION_ID } from './constants.mjs';

/**
 * The C0 control range plus DEL, spelled out by code point rather than as a
 * regex character class so no literal control byte ever sits in this source
 * file. Equivalent to the character class both runtimes carried inline.
 */
const FIRST_PRINTABLE_CODE_POINT = 0x20;
const DELETE_CODE_POINT = 0x7f;

export function hasControlCharacters(text) {
  const value = String(text);
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < FIRST_PRINTABLE_CODE_POINT || code === DELETE_CODE_POINT) return true;
  }
  return false;
}

/**
 * Replaces control characters so caller-supplied text can safely reach a log
 * line. Same character class as `hasControlCharacters`, kept beside it so a
 * change to what counts as a control character reaches both.
 */
export function stripControlCharacters(text, replacement = '?') {
  const value = String(text);
  let out = '';
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    out += (code < FIRST_PRINTABLE_CODE_POINT || code === DELETE_CODE_POINT)
      ? replacement
      : value[index];
  }
  return out;
}

/** Longest accepted body/theater filter. "Ceres" and friends are far shorter. */
export const BODY_FILTER_MAX_LENGTH = 80;

/** The one wording both runtimes already shared. */
export const BODY_FILTER_MESSAGE = 'Invalid body filter. Use a short body name such as Ceres.';

/** Bounds for the mining prospect/expansion result limit. */
export const MINING_LIMIT_BOUNDS = Object.freeze({ min: 1, max: 100 });

/**
 * Bounds for endpoints where the WHOLE catalogue is the request.
 *
 * `drive-explorer` rates all 541 drives in the game against one design and the
 * browser panel sorts and filters that catalogue client-side, so a 100-row
 * ceiling would force it to either paginate -- which cannot answer "which of
 * all 541 is best" -- or to fetch six times. The compact row shape is what
 * makes one response affordable; this is the ceiling that lets it be asked for.
 *
 * The default remains small: an omitted `?limit=` still returns the endpoint's
 * own default page, so raising the ceiling does not enlarge any existing
 * response.
 */
export const CATALOGUE_LIMIT_BOUNDS = Object.freeze({ min: 1, max: 1000 });

/** Resources that take CATALOGUE_LIMIT_BOUNDS instead of MINING_LIMIT_BOUNDS. */
export const CATALOGUE_LIMIT_RESOURCES = new Set(['drive-explorer']);

/**
 * The limit bounds for one resource, so both runtimes take the same decision.
 *
 * The two adapters previously hardcoded `MINING_LIMIT_BOUNDS` independently.
 * Deriving both from this function is the same discipline `usesQuantityAsLimit`
 * exists for: a resource added to one runtime's list and not the other's
 * validates its limit in one runtime only.
 */
export function limitBoundsFor(resource) {
  return CATALOGUE_LIMIT_RESOURCES.has(resource) ? CATALOGUE_LIMIT_BOUNDS : MINING_LIMIT_BOUNDS;
}

/** The wording of the limit error for one resource, shared for the same reason. */
export function limitLabelFor(resource) {
  return CATALOGUE_LIMIT_RESOURCES.has(resource) ? 'drive catalogue limit' : 'mining prospects limit';
}

/** Bounds for the strategic-history page size. */
export const HISTORY_LIMIT_BOUNDS = Object.freeze({ min: 1, max: 100 });

/** Default strategic-history page size when no limit is supplied. */
export const HISTORY_LIMIT_DEFAULT = 25;

/**
 * Resources whose `?quantity=` doubles as `?limit=`.
 *
 * Both runtimes carried this pair inline -- the server as an inline `||`, the
 * worker additionally as a path regex. A resource added to one and not the
 * other would validate its limit in one runtime only.
 */
export const MINING_LIMIT_RESOURCES = new Set(['mining-prospects', 'mining-expansion']);

export function usesQuantityAsLimit(resource) {
  return MINING_LIMIT_RESOURCES.has(resource);
}

/** True when a query parameter carries no value at all. */
export function isAbsent(value) {
  return value === undefined || value === null || value === '';
}

export class RequestValidationError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'RequestValidationError';
    this.statusCode = statusCode;
  }
}

/**
 * The positive-integer-id rule. Digits only (so no sign, no decimal point, no
 * exponent, no whitespace), inside the safe integer range, strictly above zero.
 *
 * `Number.isSafeInteger` is not redundant with the regex: `99999999999999999999`
 * is all digits and parses to 1e20, which would compare as a perfectly ordinary
 * faction id everywhere downstream.
 */
export function isPositiveIntegerId(value) {
  const raw = String(value);
  if (!/^\d+$/.test(raw)) return false;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0;
}

/**
 * Same rule, returning the value or null.
 *
 * The `value || ''` coercion is the hosted worker's long-standing behaviour and
 * is preserved deliberately: it maps `0`, `false`, `NaN` and `''` alike onto the
 * empty string, which fails the digit test. Passing the numeric `0` through
 * `String(value)` instead would reach the `> 0` check and reject there anyway,
 * so the two spellings agree on every input -- but the coercion is kept as-is
 * rather than reasoned away.
 */
export function parsePositiveIntegerOrNull(value) {
  if (!/^\d+$/.test(String(value || ''))) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * The body/theater filter rule, applied to an already-prepared string.
 *
 * Takes a string rather than a raw query value because the two runtimes prepare
 * it differently (see the module header) and that difference is not this
 * function's to decide.
 */
export function exceedsBodyFilterLimits(text) {
  return text.length > BODY_FILTER_MAX_LENGTH || hasControlCharacters(text);
}

/**
 * The bounded-integer rule.
 *
 * The local server has always also required `Number.isSafeInteger`; the hosted
 * worker checked only the digits and the bounds. For every bounds pair in use
 * (max 100) the two are provably equivalent -- an all-digit string inside
 * [1, 100] is necessarily a safe integer, and a value too large to be a safe
 * integer necessarily exceeds the maximum -- so unifying on the stricter rule
 * changes no decision. `tests/requestValidation.test.js` pins that equivalence
 * rather than leaving it as an argument in a comment.
 */
export function isBoundedInteger(value, { min = 1, max = 100 } = {}) {
  const raw = String(value);
  if (!/^\d+$/.test(raw)) return false;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max;
}

export function parseMode(value, supportedModes = SUPPORTED_MODES) {
  const mode = isAbsent(value) ? 'player' : String(value);
  if (!supportedModes.has(mode)) {
    throw new RequestValidationError(
      `Invalid intelligence mode '${mode}'. Supported modes: ${Array.from(supportedModes).join(', ')}.`
    );
  }
  return mode;
}

/**
 * Parses the observer faction id from a query value.
 *
 * `defaultId` is a parameter rather than a module constant because the local
 * server's default is configurable (`campaign.defaultObserverFactionId`, which
 * `SUPABASE_OBSERVER_FACTION_ID` can override) while the hosted worker resolves
 * its own. The constant here is only the fallback for a caller that supplies
 * neither.
 */
export function parseObserverId(value, defaultId = DEFAULT_OBSERVER_FACTION_ID) {
  const raw = isAbsent(value) ? String(defaultId) : String(value);
  if (!/^\d+$/.test(raw)) {
    throw new RequestValidationError(`Invalid observer faction id '${raw}'. Use a numeric faction id.`);
  }
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new RequestValidationError(`Invalid observer faction id '${raw}'.`);
  }
  return id;
}

/**
 * 404, not 400: the id is well-formed, the save simply has no such faction.
 * An unknown observer must never fall through to the default one -- that would
 * answer a different question than the caller asked.
 */
export function assertKnownObserver(snapshot, observerId) {
  const known = (snapshot?.factions || []).some(faction => Number(faction.ID) === observerId);
  if (!known) {
    throw new RequestValidationError(`Observer faction '${observerId}' is not present in this save.`, 404);
  }
  return observerId;
}

export function parseOptionalNumericQuery(value, label) {
  if (isAbsent(value)) return null;
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

export function parseBodyQuery(value) {
  if (isAbsent(value)) return null;
  const body = String(value).trim();
  if (exceedsBodyFilterLimits(body)) {
    throw new RequestValidationError(BODY_FILTER_MESSAGE);
  }
  return body;
}

/**
 * A malformed `?limit` is a 400, never a silent fall-through to the default.
 * Quietly answering a different question than the caller asked is the failure
 * mode this replaced.
 */
export function parseBoundedIntegerQuery(value, label, { min = 1, max = 100, defaultValue = null } = {}) {
  if (isAbsent(value)) return defaultValue;
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
