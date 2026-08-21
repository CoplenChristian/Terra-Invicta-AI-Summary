/**
 * server/http/routes/intel.js -- the focused-projection surface.
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

function register(app) {
  // Focused resource routes keep local Express and the hosted worker on the
  // same shallow contract for external analysis clients and lazy library views.
  // The payload and the directory page are built by shared/apiSurface.mjs so the
  // hosted worker and this server cannot drift; a route added to
  // INTEL_ENDPOINT_INDEX now surfaces in both runtimes from one edit.
  app.get(['/api/intel', '/api/intel/'], (req, res) => {
    const defaultObserverFactionId = runtimeConfig.campaign.defaultObserverFactionId;
    const payload = buildIntelApiIndex({
      source: 'local',
      endpoints: intelResources.INTEL_ENDPOINT_INDEX,
      examples: intelResources.INTEL_ENDPOINT_EXAMPLES,
      defaultObserverFactionId
    });
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
      const fleetId = req.query.fleet || req.query.fleetId || null;
      const designId = req.query.design || req.query.designId || req.query.target || null;
      const quantity = parseInt(req.query.quantity, 10) || 1;
      const status = req.query.status ? String(req.query.status).trim() : null;
      const sort = req.query.sort ? String(req.query.sort).trim() : null;

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
        fleetId,
        designId,
        quantity,
        status,
        sort,
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
