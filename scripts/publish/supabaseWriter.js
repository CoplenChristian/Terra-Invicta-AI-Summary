/**
 * scripts/publish/supabaseWriter.js -- stage 4: every network write this
 * publish makes, in the order that keeps a reader consistent.
 *
 * The ordering is the point of the module, and it is not arbitrary:
 *
 *   1. Upsert every snapshot row first.
 *   2. Move the campaign pointer only after they all landed, so a reader can
 *      never be directed at a save whose row set is incomplete.
 *   3. Store the compact history row.
 *   4. Prune older full snapshots only after that row is safely stored, and
 *      only when this publish actually advanced the pointer -- an explicit
 *      historical publish must never delete newer saves.
 *
 * This is the only module that holds the service-role Supabase client. It is
 * created here from `process.env.SUPABASE_SERVICE_ROLE_KEY` and never returned,
 * logged, or passed anywhere that could serialise it.
 */

const { createClient } = require('@supabase/supabase-js');
const { buildStrategicSnapshot } = require('../../shared/strategicSnapshot.mjs');
const { resolveConfig } = require('../../server/config');
const { campaignDateIso, MEGABYTE } = require('./rows');

const runtimeConfig = resolveConfig();

/**
 * Batching limits. These keep an upsert request comfortably under the hosted
 * REST payload limit. Operational policy, not measured values.
 */
const MAX_UPSERT_BATCH_BYTES = 3 * MEGABYTE;
const MAX_UPSERT_BATCH_ROWS = 8;

/** Ceiling on the compact history document. Above this, history is not stored. */
const MAX_COMPACT_HISTORY_BYTES = 250 * 1024;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function withSupabaseRetry(label, operation, attempts = 4) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const result = await operation();
    const error = result?.error;
    if (!error) return result;

    const status = Number(error.status || error.statusCode || 0);
    const retryable = status === 429 || status >= 500 || /timeout|temporar|connection|network/i.test(error.message || '');
    if (!retryable || attempt === attempts) return result;

    const delay = Math.min(8000, 400 * (2 ** (attempt - 1))) + Math.round(Math.random() * 250);
    console.warn(`[Retry] ${label} failed (${error.message}); retrying in ${delay}ms (${attempt}/${attempts})...`);
    await sleep(delay);
  }
  throw new Error(`${label} failed without a result.`);
}

/**
 * Creates the service-role client, or exits with an actionable message.
 *
 * SUPABASE_SERVICE_ROLE_KEY is local-only (see CLAUDE.md). It is read here, in
 * the publisher, and nowhere the hosted worker or any browser code can reach.
 */
function createServiceClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('\n[Error] Missing required Supabase environment variables:');
    if (!supabaseUrl) console.error(' - SUPABASE_URL is not set.');
    if (!serviceRoleKey) console.error(' - SUPABASE_SERVICE_ROLE_KEY is not set.');
    console.error('\nPlease set these variables in .env or your environment before publishing.');
    process.exit(1);
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

/**
 * Groups rows into upsert batches by actual payload bytes, not a fixed row
 * count, so a single large row can never push a request over the limit.
 */
function batchSnapshotRows(snapshotRows, {
  maxBatchBytes = MAX_UPSERT_BATCH_BYTES,
  maxBatchRows = MAX_UPSERT_BATCH_ROWS
} = {}) {
  const snapshotBatches = [];
  let currentBatch = [];
  let currentBatchBytes = 0;
  for (const row of snapshotRows) {
    const rowBytes = Buffer.byteLength(JSON.stringify(row), 'utf8');
    if (currentBatch.length > 0 &&
      (currentBatchBytes + rowBytes > maxBatchBytes || currentBatch.length >= maxBatchRows)) {
      snapshotBatches.push(currentBatch);
      currentBatch = [];
      currentBatchBytes = 0;
    }
    currentBatch.push(row);
    currentBatchBytes += rowBytes;
  }
  if (currentBatch.length > 0) snapshotBatches.push(currentBatch);
  return snapshotBatches;
}

async function readExistingCampaign(supabase, campaignKey) {
  const { data: existingCampaign, error: fetchErr } = await withSupabaseRetry(
    'campaign lookup',
    () => supabase
      .from('campaigns')
      .select('campaign_key, display_name, is_public, current_save_last_modified, current_game_time, current_save_filename, tech_graph_fingerprint')
      .eq('campaign_key', campaignKey)
      .maybeSingle()
  );

  if (fetchErr) {
    console.error(`[Error] Failed checking campaign: ${fetchErr.message}`);
    process.exit(1);
  }
  return existingCampaign;
}

/**
 * Stale-save protection: never roll a campaign pointer backwards. Publishing an
 * older save is legitimate (back-filling history), but it must not make the
 * hosted site serve that older save as current.
 */
function shouldAdvancePointer(existingCampaign, saveMtimeDate, saveMtimeIso, campaignKey) {
  if (existingCampaign && existingCampaign.current_save_last_modified) {
    const existingMtime = new Date(existingCampaign.current_save_last_modified);
    if (existingMtime > saveMtimeDate) {
      console.warn(`[Warning] Existing campaign pointer (${existingMtime.toISOString()}) is NEWER than this save (${saveMtimeIso}).`);
      console.warn(`[Protection] Active save pointer on campaign '${campaignKey}' will NOT be rolled back.`);
      return false;
    }
  }
  return true;
}

function buildCampaignPayload({
  options,
  existingCampaign,
  shouldUpdateCampaignPointer,
  saveMtimeIso,
  gameTimeString,
  targetSave,
  snapshotRows,
  sharedTechGraph,
  techGraphId
}) {
  const campaignPayload = {
    campaign_key: options.campaignKey,
    display_name: options.displayName || existingCampaign?.display_name || 'the Initiative Campaign',
    is_public: options.isPublic,
    updated_at: new Date().toISOString()
  };

  if (shouldUpdateCampaignPointer) {
    campaignPayload.current_save_last_modified = saveMtimeIso;
    campaignPayload.current_game_time = gameTimeString;
    campaignPayload.current_save_filename = targetSave.name;
    // Record which observers actually have rows. The fan-out policy can publish
    // a subset of factions, and a selector offering an unpublished observer
    // returns 404 and clears the hosted dashboard.
    campaignPayload.published_observers = [...new Set(snapshotRows.map(row => row.observer_faction_id))]
      .sort((a, b) => a - b);

    // Upload the shared static tech graph alongside the pointer, but only when
    // it actually changed -- it is stable until the game templates do.
    if (sharedTechGraph && existingCampaign?.tech_graph_fingerprint !== techGraphId) {
      campaignPayload.tech_graph = sharedTechGraph;
      campaignPayload.tech_graph_fingerprint = techGraphId;
      console.log(`Shared tech graph updated (${techGraphId}, ${sharedTechGraph.nodes.length} nodes).`);
    }
  }

  return campaignPayload;
}

async function upsertSnapshotRows(supabase, snapshotRows) {
  // Upsert published snapshot rows first. Keep each request comfortably below
  // the hosted REST payload limit while retaining bulk upserts. Batch size is
  // driven by actual payload bytes, not a fixed row count, so large rows can
  // never push a single request over the limit.
  console.log(`Upserting ${snapshotRows.length} published snapshot rows...`);
  const snapshotBatches = batchSnapshotRows(snapshotRows);

  let uploadedSnapshotCount = 0;
  const batchCount = snapshotBatches.length;
  for (let batchIndex = 0; batchIndex < snapshotBatches.length; batchIndex++) {
    const batch = snapshotBatches[batchIndex];
    const batchNumber = batchIndex + 1;
    const batchBytes = batch.reduce((sum, row) => sum + Buffer.byteLength(JSON.stringify(row), 'utf8'), 0);
    console.log(`  Batch ${batchNumber}/${batchCount}: ${batch.length} rows (~${(batchBytes / 1024).toFixed(0)} KB)...`);

    const { error: snapshotUpsertErr } = await withSupabaseRetry(
      `snapshot batch ${batchNumber}/${batchCount}`,
      () => supabase
        .from('player_intel_snapshots')
        .upsert(batch, {
          onConflict: 'campaign_key,save_last_modified,observer_faction_id,visibility'
        })
    );

    if (snapshotUpsertErr) {
      console.error(`[Error] Failed upserting published snapshot batch ${batchNumber}/${batchCount}: ${snapshotUpsertErr.message}`);
      process.exit(1);
    }

    uploadedSnapshotCount += batch.length;
  }
  return uploadedSnapshotCount;
}

async function commitCampaignPointer(supabase, campaignPayload, shouldUpdateCampaignPointer, campaignKey) {
  // Publish the campaign pointer last so readers can never be directed to a
  // newly named save before its complete snapshot set exists. When a newer
  // campaign pointer already exists, leave that row entirely untouched.
  if (shouldUpdateCampaignPointer) {
    const { error: campaignUpsertErr } = await withSupabaseRetry(
      'campaign pointer update',
      () => supabase
        .from('campaigns')
        .upsert(campaignPayload, { onConflict: 'campaign_key' })
    );

    if (campaignUpsertErr) {
      console.error(`[Error] Snapshot rows uploaded, but campaign pointer update failed: ${campaignUpsertErr.message}`);
      process.exit(1);
    }
    console.log(`✓ Campaign metadata committed (${campaignKey}) after snapshot validation.`);
  } else {
    console.log(`✓ Existing newer campaign pointer preserved (${campaignKey}).`);
  }
}

/**
 * Compact strategic history. ~15 KB per save against ~2 MB for the full
 * snapshot set, so this is what lets us retain a long trend line cheaply --
 * and what makes pruning the full snapshots safe later.
 *
 * History is supplementary: a failure here must not invalidate a publish whose
 * full snapshots already landed, so the whole stage is caught and warned about
 * rather than exiting.
 */
async function storeStrategicHistoryAndPrune(supabase, {
  options,
  rawSnapshot,
  targetSave,
  saveMtimeIso,
  gameTimeString,
  shouldUpdateCampaignPointer
}) {
  try {
    const { data: priorRow, error: priorErr } = await withSupabaseRetry(
      'previous strategic snapshot fetch',
      () => supabase
        .from('strategic_snapshots')
        .select('payload')
        .eq('campaign_key', options.campaignKey)
        .lt('save_last_modified', saveMtimeIso)
        .order('save_last_modified', { ascending: false })
        .limit(1)
        .maybeSingle()
    );
    if (priorErr) throw new Error(priorErr.message);

    const compact = buildStrategicSnapshot(rawSnapshot, {
      observerFactionId: options.observerFactionId,
      campaignKey: options.campaignKey,
      previous: priorRow?.payload || null,
      policy: runtimeConfig.analysis.strategicHistory
    });

    const compactBytes = Buffer.byteLength(JSON.stringify(compact), 'utf8');
    if (compactBytes > MAX_COMPACT_HISTORY_BYTES) {
      throw new Error(`compact snapshot is ${(compactBytes / 1024).toFixed(0)} KB, above the 250 KB ceiling`);
    }

    const { error: historyErr } = await withSupabaseRetry(
      'strategic snapshot store',
      () => supabase.rpc('store_strategic_snapshot', {
        p_campaign_key: options.campaignKey,
        p_save_last_modified: saveMtimeIso,
        p_save_filename: targetSave.name,
        p_game_time: gameTimeString,
        // In-game date, not the file mtime. Retention orders rows by
        // campaign_date, so storing wall-clock time here would retain and
        // present a restored or copied save in the wrong chronology.
        p_campaign_date: campaignDateIso(gameTimeString, saveMtimeIso),
        p_payload: compact,
        p_retention: options.historyRetention
      })
    );
    if (historyErr) throw new Error(historyErr.message);

    const eventSummary = compact.events.length > 0
      ? ` (${compact.events.map(e => e.type).join(', ')})`
      : '';
    console.log(`✓ Strategic history stored: ${(compactBytes / 1024).toFixed(1)} KB, retaining ${options.historyRetention}${eventSummary}.`);

    // Prune only after the compact history row is safely stored. This keeps
    // older saves available for trend analysis while bounding the expensive
    // full-fidelity table. An explicit historical publish must not delete
    // newer full snapshots or move the active campaign window.
    if (shouldUpdateCampaignPointer) {
      const { data: deletedRows, error: pruneErr } = await withSupabaseRetry(
        'full snapshot retention prune',
        () => supabase.rpc('prune_intel_snapshots', {
          p_campaign_key: options.campaignKey,
          p_keep_saves: options.fullSnapshotRetention
        })
      );
      if (pruneErr) throw new Error(pruneErr.message);
      console.log(`✓ Full snapshot retention applied: kept ${options.fullSnapshotRetention} save(s), removed ${Number(deletedRows) || 0} row(s).`);
    } else {
      console.log('✓ Full snapshot retention skipped for an older historical publish.');
    }
  } catch (err) {
    // History is supplementary. A failure here must not invalidate a publish
    // whose full snapshots already landed.
    console.warn(`[Warn] Strategic history not stored: ${err.message}`);
  }
}

module.exports = {
  MAX_UPSERT_BATCH_BYTES,
  MAX_UPSERT_BATCH_ROWS,
  MAX_COMPACT_HISTORY_BYTES,
  sleep,
  withSupabaseRetry,
  createServiceClient,
  batchSnapshotRows,
  readExistingCampaign,
  shouldAdvancePointer,
  buildCampaignPayload,
  upsertSnapshotRows,
  commitCampaignPointer,
  storeStrategicHistoryAndPrune
};
