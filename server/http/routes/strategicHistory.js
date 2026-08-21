/**
 * server/http/routes/strategicHistory.js -- the only local routes backed by
 * Supabase rather than by the save on disk.
 * Purpose: the Supabase-backed strategic-history routes — compact snapshot
 *   documents for trend analysis, with deltas computed on demand.
 *
 * Compact strategic_snapshot_v1 documents for trend analysis. Deltas are
 * computed on demand; storing them would defeat the point of a compact format.
 *
 * These are grouped because they share the one dependency nothing else in the
 * local server has: a configured Supabase connection. When it is absent they all
 * degrade the same way, with an explicit 503 naming what is missing rather than
 * an empty result that reads like "no history exists".
 */

const SupabaseAdapter = require('../../supabaseAdapter');
const requestValidation = require('../../requestValidation');
const { resolveConfig } = require('../../config');
const { buildStrategicSnapshot } = require('../../../shared/strategicSnapshot.mjs');
const { buildStrategicDelta } = require('../../../shared/strategicDelta.mjs');
const snapshotCache = require('../snapshotCache');
const { requestContext } = require('../requestContext');

const runtimeConfig = resolveConfig();

// Compact strategic history lives in Supabase, not on disk, so these routes
// degrade cleanly to a clear message when Supabase is not configured locally.
const strategicHistory = new SupabaseAdapter({ campaignKey: runtimeConfig.campaign.key });

const NOT_CONFIGURED = 'Strategic history requires Supabase configuration (SUPABASE_URL + key).';

function register(app) {
  app.get('/api/intel/history', async (req, res) => {
    if (!strategicHistory.isConfigured()) {
      return res.status(503).json({ error: NOT_CONFIGURED });
    }
    try {
      // A malformed ?limit used to fall through to 25 silently. Reject it with a
      // 400 instead of quietly answering a different question.
      const limit = requestValidation.parseBoundedIntegerQuery(
        req.query.limit,
        'history limit',
        {
          min: requestValidation.HISTORY_LIMIT_BOUNDS.min,
          max: requestValidation.HISTORY_LIMIT_BOUNDS.max,
          defaultValue: requestValidation.HISTORY_LIMIT_DEFAULT
        }
      );
      const result = await strategicHistory.listStrategicSnapshots(req.query.campaign || null, limit);
      if (!result.found) return res.status(404).json({ error: result.error || 'Strategic history unavailable for this campaign.' });
      res.json({
        schema: 'strategic_snapshot_v1',
        campaignKey: result.campaignKey,
        count: result.history.length,
        history: result.history
      });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // Addressed by save_last_modified: this schema has no separate snapshot hash.
  app.get('/api/intel/history/:saveLastModified', async (req, res) => {
    if (!strategicHistory.isConfigured()) {
      return res.status(503).json({ error: NOT_CONFIGURED });
    }
    try {
      const result = await strategicHistory.getStrategicSnapshot(
        decodeURIComponent(req.params.saveLastModified),
        req.query.campaign || null
      );
      if (!result.found) return res.status(404).json({ error: result.error || 'Strategic history unavailable for this campaign.' });
      res.json(result.snapshot);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/intel/strategic-delta', async (req, res) => {
    if (!strategicHistory.isConfigured()) {
      return res.status(503).json({ error: NOT_CONFIGURED });
    }
    try {
      const campaign = req.query.campaign || null;
      let fromDoc = null;
      let toDoc = null;

      if (req.query.from && req.query.to) {
        const [a, b] = await Promise.all([
          strategicHistory.getStrategicSnapshot(decodeURIComponent(req.query.from), campaign),
          strategicHistory.getStrategicSnapshot(decodeURIComponent(req.query.to), campaign)
        ]);
        if (!a.found) return res.status(404).json({ error: a.error || 'from snapshot not found.' });
        if (!b.found) return res.status(404).json({ error: b.error || 'to snapshot not found.' });
        fromDoc = a.snapshot.payload;
        toDoc = b.snapshot.payload;
      } else {
        // Default: current live save versus the most recent stored history entry
        // that predates it, so "I just uploaded a save, what changed?" works with
        // no parameters.
        const recent = await strategicHistory.getRecentStrategicSnapshots(campaign, 2);
        if (!recent.found) return res.status(404).json({ error: recent.error || 'No strategic history available.' });
        if (recent.snapshots.length === 0) return res.status(404).json({ error: 'No strategic history stored yet.' });

        // Validate the request outside the fallback below. parseObserverId
        // rejects a malformed id instead of coercing it to NaN and falling back
        // to the configured observer, which would silently build the delta for a
        // different faction -- and the fallback catch would have hidden the
        // rejection as "no local save available".
        const observerFactionId = requestValidation.parseObserverId(req.query.observer);
        const { targetPath } = requestContext(req);

        try {
          const rawSnapshot = snapshotCache.loadOrGetSnapshot(targetPath);
          toDoc = buildStrategicSnapshot(rawSnapshot, {
            observerFactionId,
            campaignKey: campaign,
            policy: runtimeConfig.analysis.strategicHistory
          });
          fromDoc = recent.snapshots[0]?.payload || null;
        } catch (localErr) {
          // No local save available (hosted context): fall back to the two most
          // recent stored snapshots.
          toDoc = recent.snapshots[0]?.payload || null;
          fromDoc = recent.snapshots[1]?.payload || null;
        }
      }

      res.json(buildStrategicDelta(fromDoc, toDoc));
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });
}

module.exports = { register, strategicHistory };
