/**
 * server/http/requestContext.js -- request in, parameters out; snapshot in,
 * identity envelope out.
 * Purpose: request->(mode, observer, save, risk floor) and snapshot->identity
 *   envelope conversions shared by the local routes.
 *
 * These three helpers are what every route in the local server calls before and
 * after doing its actual work. They are deliberately free of Express response
 * handling: each either returns a value or throws a `RequestValidationError`
 * carrying its own status code, so a route's error branch stays one line.
 */

const saveParser = require('../saveParser');
const snapshotIdentity = require('../snapshotIdentity');
const requestValidation = require('../requestValidation');
const { resolveConfig } = require('../config');

/**
 * The configured success-odds floor, used when `?riskFloor=` is absent.
 *
 * Read once, like `requestValidation`'s default observer id. Bound HERE rather
 * than by adding a second wrapper to `server/requestValidation.js`, which
 * documents `parseObserverId` as its ONE deliberate wrapper and is pinned as
 * such by tests/requestValidationParity.test.js -- the shared bounded-integer
 * parser already has exactly the semantics needed, so it is called directly
 * with the configured default rather than re-exported around.
 */
const DEFAULT_RISK_FLOOR_PERCENT = resolveConfig().analysis?.riskTolerance?.riskFloorPercent ?? null;

/**
 * The four parameters every save-backed route needs.
 *
 * `targetPath` is null for "the latest save", which is also what flips
 * `isLatestSnapshot` in the response envelope -- so the null is load-bearing
 * and must not be defaulted to a path.
 *
 * `riskFloorPercent` is 0..100. An ABSENT parameter resolves to the configured
 * default, NOT to 0: `Number(null) === 0` and 0 is a floor the player can
 * legitimately choose ("no floor"), so the two must not collapse. A malformed
 * or out-of-range value is rejected with a 400 rather than being clamped into
 * a floor nobody set.
 */
function requestContext(req) {
  const mode = requestValidation.parseMode(req.query.mode);
  const observerId = requestValidation.parseObserverId(req.query.observer);
  return {
    mode,
    observerId,
    targetPath: requestValidation.resolveSavePath(saveParser, req.query.save),
    riskFloorPercent: requestValidation.parseBoundedIntegerQuery(req.query.riskFloor, 'risk floor', {
      min: 0,
      max: 100,
      defaultValue: DEFAULT_RISK_FLOOR_PERCENT
    })
  };
}

/** 404 when the well-formed observer id names no faction in this save. */
function assertObserver(rawSnapshot, observerId) {
  return requestValidation.assertKnownObserver(rawSnapshot, observerId);
}

/**
 * The consistency envelope every data response carries, so an external client
 * can tell which save it is reading and whether that save is still the latest.
 */
function responseIdentity(snapshot, isLatestSnapshot = true) {
  const identity = snapshotIdentity.readSnapshotIdentity(snapshot);
  const saveFilename = snapshot?.metadata?.fileName || null;
  const campaignDate = snapshot?.metadata?.gameTimeString || null;
  return {
    ...identity,
    saveFilename,
    campaignDate,
    isLatestSnapshot,
    activeSnapshot: {
      ...identity,
      saveFilename,
      campaignDate,
      isLatestSnapshot
    }
  };
}

module.exports = {
  requestContext,
  assertObserver,
  responseIdentity
};
