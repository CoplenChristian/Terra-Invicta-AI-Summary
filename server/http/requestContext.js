/**
 * server/http/requestContext.js -- request in, parameters out; snapshot in,
 * identity envelope out.
 * Purpose: request->(mode, observer, save) and snapshot->identity envelope
 *   conversions shared by the local routes.
 *
 * These three helpers are what every route in the local server calls before and
 * after doing its actual work. They are deliberately free of Express response
 * handling: each either returns a value or throws a `RequestValidationError`
 * carrying its own status code, so a route's error branch stays one line.
 */

const saveParser = require('../saveParser');
const snapshotIdentity = require('../snapshotIdentity');
const requestValidation = require('../requestValidation');

/**
 * The three parameters every save-backed route needs.
 *
 * `targetPath` is null for "the latest save", which is also what flips
 * `isLatestSnapshot` in the response envelope -- so the null is load-bearing
 * and must not be defaulted to a path.
 */
function requestContext(req) {
  const mode = requestValidation.parseMode(req.query.mode);
  const observerId = requestValidation.parseObserverId(req.query.observer);
  return {
    mode,
    observerId,
    targetPath: requestValidation.resolveSavePath(saveParser, req.query.save)
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
