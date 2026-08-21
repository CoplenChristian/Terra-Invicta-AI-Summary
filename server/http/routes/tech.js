/**
 * server/http/routes/tech.js -- everything answered from the game templates.
 *
 * Two things live here, and they belong together for the same reason:
 *
 *   - /api/templates/effects reports what `server/templateLoader.js` managed to
 *     load and validate at startup.
 *   - The seven tech routes project the normalized dependency graph
 *     (see shared/techGraph.mjs) that `snapshotBuilder` derives from those same
 *     templates.
 *
 * They are also adjacent in the Express registration order that
 * `tests/serverRoutes.test.js` pins, so grouping them keeps that order
 * byte-identical to what it was before the split.
 */

const templateLoader = require('../../templateLoader');
const techIntel = require('../../techIntel');
const requestValidation = require('../../requestValidation');
const snapshotCache = require('../snapshotCache');
const { requestContext, assertObserver } = require('../requestContext');

const TECH_ROUTES = [
  '/api/intel/tech-tree',
  '/api/intel/tech-path',
  '/api/intel/tech-search',
  '/api/intel/tech-milestones',
  '/api/intel/tech-matrix',
  '/api/intel/tech-opportunities',
  '/api/intel/research-queue'
];

function register(app) {
  // 5. Template effect validation info
  app.get('/api/templates/effects', (req, res) => {
    try {
      res.json({
        success: true,
        validation: templateLoader.validationResults,
        templatesPath: templateLoader.templatesPath,
        techCount: templateLoader.templates.techs.size,
        projectCount: templateLoader.templates.projects.size,
        effectCount: templateLoader.templates.effects.size
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Tech Tree Intelligence endpoints. These expose the observer's technology
  // state as a normalized dependency graph (see shared/techGraph.mjs) and answer
  // research-path, search, milestone and queue questions against the live save.
  app.get(TECH_ROUTES, (req, res) => {
    try {
      const { mode, observerId, targetPath } = requestContext(req);
      const rawSnapshot = snapshotCache.loadOrGetSnapshot(targetPath);
      assertObserver(rawSnapshot, observerId);
      const filtered = snapshotCache.buildFilteredSnapshot(rawSnapshot, mode, observerId);

      let projection;
      if (req.path.endsWith('/tech-tree')) {
        const category = String(req.query.category || 'all').toLowerCase();
        if (!techIntel.CATEGORIES.has(category)) {
          throw new requestValidation.RequestValidationError(
            `Invalid category '${category}'. Supported: ${Array.from(techIntel.CATEGORIES).join(', ')}.`
          );
        }
        const includeEffects = String(req.query.includeEffects ?? 'true') !== 'false';
        projection = techIntel.buildTechTree(filtered, mode, observerId, { category, includeEffects });
      } else if (req.path.endsWith('/tech-path')) {
        const rawTarget = req.query.target;
        if (!rawTarget) {
          throw new requestValidation.RequestValidationError('Missing required query parameter: target.');
        }
        const targets = String(rawTarget).split(',').map(t => t.trim()).filter(Boolean);
        projection = techIntel.buildPath(filtered, mode, observerId, targets);
      } else if (req.path.endsWith('/tech-search')) {
        const query = String(req.query.q || '');
        if (!query) {
          throw new requestValidation.RequestValidationError('Missing required query parameter: q.');
        }
        projection = techIntel.buildSearch(filtered, mode, observerId, query);
      } else if (req.path.endsWith('/tech-milestones')) {
        const category = req.query.category ? String(req.query.category).toLowerCase() : null;
        projection = techIntel.buildMilestones(filtered, mode, observerId, category);
      } else if (req.path.endsWith('/tech-matrix')) {
        projection = techIntel.buildMatrix(filtered, mode, observerId);
      } else if (req.path.endsWith('/tech-opportunities')) {
        projection = techIntel.buildOpportunities(filtered, mode, observerId);
      } else {
        projection = techIntel.buildQueue(filtered, mode, observerId);
      }

      res.set('Cache-Control', 'no-store');
      res.json(projection);
    } catch (err) {
      console.error(`[Server] Tech endpoint failed (${req.path}):`, err);
      res.status(err.statusCode || 500).json({ success: false, error: err.message });
    }
  });
}

module.exports = { register, TECH_ROUTES };
