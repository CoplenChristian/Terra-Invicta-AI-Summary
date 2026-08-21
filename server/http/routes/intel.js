/**
 * server/http/routes/intel.js -- the focused-projection surface.
 * Purpose: the focused-projection route surface — one discovery directory page
 *   plus the generic handler for all intel resources.
 *
 * One directory page plus one generic handler for all 30 resources plus the
 * production-plan POST. The projections themselves are pure and live in
 * `shared/intelResources.mjs`; what this module owns is the query contract --
 * which parameters exist, which are validated and how, and what the caller sees
 * when one of them is malformed.
 */

const intelResources = require('../../intelResources');
const requestValidation = require('../../requestValidation');
const { resolveConfig } = require('../../config');
const { buildIntelApiIndex, renderIntelApiIndexHtml } = require('../../../shared/apiSurface.mjs');
const snapshotCache = require('../snapshotCache');
const { requestContext, assertObserver } = require('../requestContext');

const runtimeConfig = resolveConfig();

/**
 * Measured response sizes for the discovery index.
 *
 * The index is documented as how an external analysis client discovers the
 * route surface, and it pointed at a 909 KB endpoint with no indication. Every
 * number here is measured by running the projection against the snapshot this
 * server already has cached -- never estimated -- and memoised per
 * (snapshot, mode) so a repeat index request does not re-measure thirty
 * projections.
 *
 * If the snapshot cannot be loaded at all, the whole block is omitted rather
 * than replaced with a plausible-looking guess: a missing hint is visible to the
 * caller, an invented one is not.
 */
const sizeMemo = new Map();
function responseSizes(req, defaultObserverFactionId) {
  try {
    const mode = requestValidation.parseMode(req.query.mode);
    const observerId = requestValidation.parseObserverId(req.query.observer, defaultObserverFactionId);
    const rawSnapshot = snapshotCache.loadOrGetSnapshot(null);
    const filtered = snapshotCache.buildFilteredSnapshot(rawSnapshot, mode, observerId);
    const memoKey = `${filtered?.snapshotId || 'unknown'}|${mode}|${observerId}`;
    if (!sizeMemo.has(memoKey)) {
      // One snapshot at a time: this map exists to spare a repeat request, not
      // to accumulate every save the process has ever parsed.
      sizeMemo.clear();
      sizeMemo.set(memoKey, intelResources.measureIntelEndpointSizes(filtered, { mode }));
    }
    const measured = sizeMemo.get(memoKey);
    return {
      responseSizes: measured.sizes,
      responseSizesUnavailable: measured.unavailable,
      responseSizeBasis: measured.basis
    };
  } catch (err) {
    // An unmeasurable index is still a usable index. Say why, do not guess.
    return { responseSizesUnavailable: { all: `sizes could not be measured: ${err.message}` } };
  }
}

function register(app) {
  // Focused resource routes keep local Express and the hosted worker on the
  // same shallow contract for external analysis clients and lazy library views.
  // The payload and the directory page are built by shared/apiSurface.mjs so the
  // hosted worker and this server cannot drift; a route added to
  // INTEL_ENDPOINT_INDEX now surfaces in both runtimes from one edit.
  app.get(['/api/intel', '/api/intel/'], (req, res) => {
    const defaultObserverFactionId = runtimeConfig.campaign.defaultObserverFactionId;
    const payload = {
      ...buildIntelApiIndex({
        source: 'local',
        endpoints: intelResources.INTEL_ENDPOINT_INDEX,
        examples: intelResources.INTEL_ENDPOINT_EXAMPLES,
        defaultObserverFactionId
      }),
      detail: {
        levels: intelResources.DETAIL_LEVELS,
        default: intelResources.DEFAULT_DETAIL_LEVEL,
        appliesTo: Array.from(intelResources.DETAIL_AWARE_RESOURCES),
        description: 'summary returns a manifest; full returns the per-ship payload and is much larger.'
      },
      ...responseSizes(req, defaultObserverFactionId)
    };
    if (req.query.format === 'json' || String(req.get('accept') || '').includes('application/json')) {
      res.set('Cache-Control', 'no-store').json(payload);
      return;
    }

    res.set('Cache-Control', 'no-store').type('html')
      .send(renderIntelApiIndexHtml(payload, { defaultObserverFactionId }));
  });

  app.get(['/api/intel/:resource', '/api/:resource'], (req, res, next) => {
    // Unknown resources fall through rather than 404 here: /api/intel/history,
    // the tech routes and /api/saves all match this pattern and are answered by
    // their own handlers further down the registration order.
    if (!intelResources.SUPPORTED_RESOURCES.has(req.params.resource)) return next();

    try {
      const { mode, observerId, targetPath } = requestContext(req);
      const rawSnapshot = snapshotCache.loadOrGetSnapshot(targetPath);
      assertObserver(rawSnapshot, observerId);
      const filtered = snapshotCache.buildFilteredSnapshot(rawSnapshot, mode, observerId);
      const factionId = requestValidation.parseOptionalNumericQuery(
        req.query.faction ?? req.query.factionId,
        'faction filter'
      );
      const body = requestValidation.parseBodyQuery(req.query.body);
      const theater = requestValidation.parseBodyQuery(req.query.theater ?? req.query.body);
      const limit = requestValidation.parseBoundedIntegerQuery(
        req.query.limit ?? (requestValidation.usesQuantityAsLimit(req.params.resource) ? req.query.quantity : undefined),
        'mining prospects limit'
      );
      const destination = req.query.destination ? String(req.query.destination).trim() : null;
      // `military-value` narrows to one unlock family or weapon class. An
      // unknown value yields an empty class list rather than a 400, the same
      // way an unmatched `?faction=` yields an empty item list.
      const family = req.query.family ? String(req.query.family).trim() : null;
      const fleetId = req.query.fleet || req.query.fleetId || null;
      const designId = req.query.design || req.query.designId || req.query.target || null;
      const quantity = parseInt(req.query.quantity, 10) || 1;
      const status = req.query.status ? String(req.query.status).trim() : null;
      const sort = req.query.sort ? String(req.query.sort).trim() : null;
      // A malformed `?detail=` is a 400, never a silent fall-through to the
      // default -- the same rule the limit and body filters already follow.
      // Quietly answering a smaller question than the caller asked is exactly
      // the failure this endpoint is being fixed for.
      const detail = intelResources.parseDetailLevel(req.query.detail);
      if (detail === null) {
        throw new requestValidation.RequestValidationError(
          `Invalid detail level '${String(req.query.detail)}'. Use ${intelResources.DETAIL_LEVELS.join(' or ')}.`
        );
      }

      const previousRawSnapshot = snapshotCache.getPreviousRawSnapshot();
      const previousFiltered = previousRawSnapshot
        ? snapshotCache.buildFilteredSnapshot(previousRawSnapshot, mode, observerId)
        : null;

      const projection = intelResources.buildResource(filtered, req.params.resource, {
        factionId,
        body,
        theater,
        limit,
        destination,
        family,
        fleetId,
        designId,
        quantity,
        status,
        sort,
        detail,
        previousSnapshot: previousFiltered,
        mode,
        isLatestSnapshot: targetPath === null
      });

      res.set('Cache-Control', 'no-store');
      res.json(projection);
    } catch (err) {
      console.error(`[Server] Focused resource failed (${req.params.resource}):`, err);
      res.status(err.statusCode || 500).json({ success: false, error: err.message });
    }
  });

  // Production plan query endpoint (POST)
  app.post(['/api/intel/production-plan', '/api/production-plan'], (req, res) => {
    try {
      const { mode, observerId, targetPath } = requestContext(req);
      const rawSnapshot = snapshotCache.loadOrGetSnapshot(targetPath);
      assertObserver(rawSnapshot, observerId);
      const filtered = snapshotCache.buildFilteredSnapshot(rawSnapshot, mode, observerId);
      const designId = req.body?.designId || req.body?.design || req.query.designId || req.query.design;
      const quantity = parseInt(req.body?.quantity || req.query.quantity, 10) || 1;

      const projection = intelResources.buildResource(filtered, 'production-plan', {
        designId,
        quantity,
        mode,
        isLatestSnapshot: targetPath === null
      });

      res.set('Cache-Control', 'no-store');
      res.json(projection);
    } catch (err) {
      console.error('[Server] Production plan failed:', err);
      res.status(err.statusCode || 500).json({ success: false, error: err.message });
    }
  });
}

module.exports = { register };
