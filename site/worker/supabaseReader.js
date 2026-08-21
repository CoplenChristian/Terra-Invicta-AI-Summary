/**
 * site/worker/supabaseReader.js -- every read the hosted runtime makes against
 * Supabase, and every consistency check on what comes back.
 * Purpose: every Supabase read the hosted runtime makes, plus the consistency
 *   checks on what comes back.
 *
 * The boundary is "what can this response honestly claim to be". A published
 * snapshot is only servable if its identity is complete AND the campaign
 * pointer, the row and the payload all name the same save -- checked before the
 * read and again after it, because publishing can move the pointer mid-request.
 * Those checks are the reason this is one module rather than a thin fetch
 * helper: splitting the query from its consistency rule is how a stale row ends
 * up served as current.
 *
 * The hosted worker only ever holds the public anon key. SUPABASE_PUBLISHABLE_KEY
 * is the documented name and wins; SUPABASE_ANON_KEY is the deprecated spelling
 * of the same key and is still accepted. The local-only publisher key is
 * deliberately never read here.
 */

import { DEFAULT_CAMPAIGN_KEY, resolveSupabaseReadKey } from '../shared/apiSurface.mjs';

const supabaseReadKey = (env) => resolveSupabaseReadKey(env).key;

export const isSupabaseReady = (env) => Boolean(env?.SUPABASE_URL && supabaseReadKey(env));

export async function querySupabase(env, pathWithParams) {
  const supabaseUrl = env.SUPABASE_URL;
  const anonKey = supabaseReadKey(env);

  const url = `${supabaseUrl}/rest/v1/${pathWithParams}`;
  const response = await fetch(url, {
    cache: 'no-store',
    headers: {
      'apikey': anonKey,
      'Authorization': `Bearer ${anonKey}`,
      'Accept': 'application/json',
      'Cache-Control': 'no-cache'
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Supabase API error (${response.status}): ${errorText}`);
  }

  return await response.json();
}

export async function readPublicCampaign(env, campaignKey) {
  const campaigns = await querySupabase(
    env,
    `campaigns?campaign_key=eq.${encodeURIComponent(campaignKey)}&is_public=eq.true&select=campaign_key,current_save_last_modified,current_game_time,current_save_filename,published_observers,tech_graph,tech_graph_fingerprint&limit=1`
  );
  return campaigns?.[0] || null;
}

export const strategicHistoryMeta = (row) => ({
  saveLastModified: row?.save_last_modified || null,
  saveFilename: row?.save_filename || null,
  gameTime: row?.game_time || null,
  campaignDate: row?.campaign_date || null,
  schemaVersion: row?.schema_version ?? null,
  createdAt: row?.created_at || null
});

/**
 * Hosted history page size.
 *
 * NOTE a deliberate divergence from the local server, preserved rather than
 * harmonised by the 2026-08-20 split: the local `/api/intel/history` rejects a
 * malformed `?limit` with a 400, while this one coerces it to the default. The
 * two runtimes now share the validation RULES via `shared/requestValidation.mjs`,
 * but changing what an existing hosted client gets back for `?limit=abc` is a
 * behaviour change, not a refactor. `shared/requestValidation.mjs` documents the
 * gap; closing it is a separate, deliberate decision.
 */
export const boundedHistoryLimit = (value, fallback = 25) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, 100);
};

export async function readStrategicHistory(env, campaignKey, options = {}) {
  const campaign = await readPublicCampaign(env, campaignKey);
  if (!campaign) {
    return {
      found: false,
      status: 404,
      error: `Public campaign '${campaignKey}' not found.`
    };
  }

  const select = options.includePayload
    ? 'save_last_modified,save_filename,game_time,campaign_date,schema_version,created_at,payload'
    : 'save_last_modified,save_filename,game_time,campaign_date,schema_version,created_at';
  let query = `strategic_snapshots?campaign_key=eq.${encodeURIComponent(campaign.campaign_key)}&select=${select}&order=save_last_modified.desc&limit=${boundedHistoryLimit(options.limit)}`;
  if (options.saveLastModified) {
    query += `&save_last_modified=eq.${encodeURIComponent(options.saveLastModified)}`;
  }

  const rows = await querySupabase(env, query);
  return { found: true, campaign, rows: Array.isArray(rows) ? rows : [] };
}

const timestampMs = (value) => {
  const result = new Date(value || '').getTime();
  return Number.isFinite(result) ? result : null;
};

const sameTimestamp = (left, right) => {
  const leftMs = timestampMs(left);
  const rightMs = timestampMs(right);
  return leftMs !== null && rightMs !== null && leftMs === rightMs;
};

const consistencyError = (message) => ({
  found: false,
  status: 409,
  error: `MIXED / STALE INTELLIGENCE: ${message}`
});

export async function fetchFromSupabase(env, observerId, requestedMode = 'player') {
  const campaignKey = env.SUPABASE_CAMPAIGN_KEY || DEFAULT_CAMPAIGN_KEY;
  const safeObserverId = String(observerId);
  const mode = requestedMode;

  // Step 1: Query active public campaign pointer
  const campaign = await readPublicCampaign(env, campaignKey);
  if (!campaign) {
    return { found: false, status: 404, error: `Public campaign '${campaignKey}' not found.` };
  }

  if (!campaign.current_save_last_modified) {
    return { found: false, status: 404, error: `No active save recorded for campaign '${campaignKey}'.` };
  }

  // Step 2: Query the matching published snapshot row for the requested observer and mode.
  const snapshots = await querySupabase(
    env,
    `player_intel_snapshots?campaign_key=eq.${encodeURIComponent(campaignKey)}&save_last_modified=eq.${encodeURIComponent(campaign.current_save_last_modified)}&observer_faction_id=eq.${safeObserverId}&visibility=eq.${encodeURIComponent(mode)}&select=snapshot,chatgpt_export,observer_faction_id,observer_faction_name,save_filename,save_last_modified,game_time,difficulty,campaign_start_year,visibility,generated_at&limit=2`
  );

  if (!snapshots || snapshots.length === 0) {
    return {
      found: false,
      status: 404,
      error: `No ${mode} snapshot found for observer ${safeObserverId} at timestamp ${campaign.current_save_last_modified}.`
    };
  }

  if (snapshots.length > 1) {
    return consistencyError(
      `multiple ${mode} rows exist for observer ${safeObserverId} at active timestamp ${campaign.current_save_last_modified}; republish or repair the duplicate rows.`
    );
  }

  const row = snapshots[0];
  const payload = row.snapshot;

  // Published rows carry only the per-save half of the tech tree; the static
  // ~959 KB of nodes is stored once on the campaign. Splice it back before any
  // consumer reads the graph, so tech endpoints behave identically to a row
  // that embedded its own copy.
  if (payload?.techTree?.graphRef && !Array.isArray(payload.techTree.nodes)) {
    const shared = campaign.tech_graph;
    if (shared && shared.fingerprint === payload.techTree.graphRef.fingerprint) {
      payload.techTree = {
        ...payload.techTree,
        nodes: shared.nodes || [],
        categories: shared.categories || {},
        unlockClasses: shared.unlockClasses || {},
        graphSource: 'campaign-shared'
      };
    } else {
      // Do not silently serve an empty graph: leave the reference in place so
      // graphFromTree reports the tree as unavailable rather than as empty.
      payload.techTree = {
        ...payload.techTree,
        graphUnavailable: shared
          ? 'stored tech graph fingerprint does not match this snapshot; republish the campaign'
          : 'no shared tech graph stored for this campaign; republish to upload it'
      };
    }
  }

  const identity = {
    snapshotId: payload?.snapshotId || null,
    saveHash: payload?.saveHash || null,
    saveModifiedAt: payload?.saveModifiedAt || row.save_last_modified || null,
    generatedAt: payload?.generatedAt || row.generated_at || null
  };
  if (!identity.snapshotId || !identity.saveHash || !identity.saveModifiedAt || !identity.generatedAt) {
    return {
      found: false,
      status: 409,
      error: 'Published snapshot is missing its consistency identity. Republish the latest save before reading it.'
    };
  }
  if (!sameTimestamp(row.save_last_modified, campaign.current_save_last_modified) ||
      !sameTimestamp(identity.saveModifiedAt, campaign.current_save_last_modified) ||
      !sameTimestamp(identity.saveModifiedAt, row.save_last_modified)) {
    return consistencyError(
      `campaign pointer is ${campaign.current_save_last_modified}, row is ${row.save_last_modified}, dataset is ${identity.saveModifiedAt}.`
    );
  }
  if (row.visibility !== mode) {
    return consistencyError(`requested mode is ${mode}, but the selected row is ${row.visibility}.`);
  }

  // Publishing uploads all rows first and advances the campaign pointer last,
  // but it can still move while this request is in flight. Re-read the pointer
  // before returning so a single response can never claim to be current after
  // a newer publish committed.
  const confirmedCampaign = await readPublicCampaign(env, campaignKey);
  if (!confirmedCampaign ||
      !sameTimestamp(confirmedCampaign.current_save_last_modified, campaign.current_save_last_modified) ||
      confirmedCampaign.current_save_filename !== campaign.current_save_filename) {
    return consistencyError(
      `the active save changed while reading this request (started at ${campaign.current_save_last_modified}, now ${confirmedCampaign?.current_save_last_modified || 'unknown'}); retry.`
    );
  }
  if (payload) {
    payload.mode = mode;
    payload.isOmniscient = mode === 'omniscient';
  }

  return {
    found: true,
    campaign,
    row,
    snapshot: payload,
    chatgptExport: row.chatgpt_export,
    mode,
    isLatestSnapshot: true,
    activeSnapshot: {
      snapshotId: identity.snapshotId,
      saveHash: identity.saveHash,
      saveModifiedAt: campaign.current_save_last_modified,
      saveFilename: campaign.current_save_filename || row.save_filename || null,
      campaignDate: campaign.current_game_time || row.game_time || null,
      generatedAt: identity.generatedAt,
      isLatestSnapshot: true
    }
  };
}

export { consistencyError, sameTimestamp, supabaseReadKey, timestampMs };
