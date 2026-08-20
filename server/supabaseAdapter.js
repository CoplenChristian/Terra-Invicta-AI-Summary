/**
 * Supabase Adapter for Hosted Runtime
 *
 * Reads sanitized Player Intel snapshots and exports from Supabase.
 * Uses only the public/anon key and guarantees that all returned data
 * is strictly technology-gated Player Intel.
 */

const { createClient } = require('@supabase/supabase-js');
const { resolveConfig, resolvePublishableKey } = require('./config');
const { selectExportMarkdown } = require('../shared/apiSurface.mjs');

/**
 * Strict optional-integer parsing for caller-supplied ids and limits.
 *
 * `parseInt(x, 10) || fallback` accepted a typo and silently answered about a
 * different faction, or silently changed a row limit. Absent still means "use
 * the default"; present-but-malformed is now an error rather than a default.
 */
function requireOptionalInteger(value, label, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const raw = String(value).trim();
  const parsed = /^[+-]?\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`Invalid ${label} '${value}'. Use a whole number from ${min} to ${max}.`);
  }
  return parsed;
}

class SupabaseAdapter {
  constructor(config = {}) {
    const runtimeConfig = resolveConfig();
    this.supabaseUrl = config.supabaseUrl || process.env.SUPABASE_URL;
    // Explicit precedence: an injected key, then the documented
    // SUPABASE_PUBLISHABLE_KEY, then the deprecated SUPABASE_ANON_KEY spelling
    // (which emits a one-time deprecation warning). This adapter only ever
    // holds the public anon key; the service role key is local-publisher-only.
    const resolvedKey = config.publishableKey
      ? { key: config.publishableKey, source: 'config.publishableKey' }
      : resolvePublishableKey(process.env);
    this.publishableKey = resolvedKey.key || null;
    this.publishableKeySource = this.publishableKey ? resolvedKey.source : null;
    this.defaultCampaignKey = config.campaignKey || process.env.SUPABASE_CAMPAIGN_KEY || runtimeConfig.campaign.key;
    // resolveConfig() has already applied and validated
    // SUPABASE_OBSERVER_FACTION_ID, so the configured value is the resolved
    // default. A caller-supplied override is validated rather than coerced.
    this.defaultObserverFactionId = requireOptionalInteger(
      config.observerFactionId,
      'observer faction id'
    ) ?? runtimeConfig.campaign.defaultObserverFactionId;
    this.client = null;

    if (this.supabaseUrl && this.publishableKey) {
      this.client = createClient(this.supabaseUrl, this.publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
    }
  }

  isConfigured() {
    return !!this.client;
  }

  async getActiveCampaign(campaignKey = null) {
    if (!this.client) {
      throw new Error('Supabase client is not configured (missing SUPABASE_URL or publishable key).');
    }

    const key = campaignKey || this.defaultCampaignKey;
    const { data, error } = await this.client
      .from('campaigns')
      .select('campaign_key, display_name, is_public, current_save_last_modified, current_game_time, current_save_filename, updated_at')
      .eq('campaign_key', key)
      .eq('is_public', true)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to query campaign: ${error.message}`);
    }

    if (!data) {
      return null;
    }

    return data;
  }

  async getLatestPlayerSnapshot(observerFactionId = null, campaignKey = null) {
    if (!this.client) {
      throw new Error('Supabase client is not configured.');
    }

    const campaign = await this.getActiveCampaign(campaignKey);
    if (!campaign) {
      return { found: false, error: `Public campaign '${campaignKey || this.defaultCampaignKey}' not found.` };
    }

    if (!campaign.current_save_last_modified) {
      return { found: false, error: `No active save timestamp recorded for campaign '${campaign.campaign_key}'.` };
    }

    // Absent means "use the configured observer". Present-but-malformed is
    // rejected: silently answering about a different faction is the exact
    // failure the HTTP path already returns a hard error for.
    const safeObserverId = requireOptionalInteger(observerFactionId, 'observer faction id')
      ?? this.defaultObserverFactionId;

    const { data: snapshotRow, error } = await this.client
      .from('player_intel_snapshots')
      .select('observer_faction_id, observer_faction_name, snapshot, chatgpt_export, save_filename, save_last_modified, game_time, difficulty, campaign_start_year, visibility, generated_at')
      .eq('campaign_key', campaign.campaign_key)
      .eq('save_last_modified', campaign.current_save_last_modified)
      .eq('observer_faction_id', safeObserverId)
      .eq('visibility', 'player')
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to query player intel snapshot: ${error.message}`);
    }

    if (!snapshotRow) {
      return {
        found: false,
        error: `No Player Intel snapshot found for observer ${safeObserverId} at timestamp ${campaign.current_save_last_modified}.`
      };
    }

    // Guarantee that mode is strictly player
    const payload = snapshotRow.snapshot;
    if (payload) {
      payload.mode = 'player';
      payload.isOmniscient = false;
    }

    return {
      found: true,
      campaign,
      snapshotRow,
      data: payload,
      chatgptExport: snapshotRow.chatgpt_export
    };
  }

  async getExportMarkdown(format = 'chatgpt', observerFactionId = null, campaignKey = null) {
    const result = await this.getLatestPlayerSnapshot(observerFactionId, campaignKey);
    if (!result.found) {
      return { success: false, error: result.error };
    }

    const markdown = selectExportMarkdown(result.chatgptExport, format);

    return {
      success: true,
      markdown,
      observerFactionId: result.snapshotRow.observer_faction_id,
      observerFactionName: result.snapshotRow.observer_faction_name
    };
  }

  /**
   * Compact strategic history, newest first. Metadata only -- the payloads are
   * fetched individually so listing stays cheap.
   */
  async listStrategicSnapshots(campaignKey = null, limit = 25) {
    if (!this.isConfigured()) return { found: false, error: 'Supabase is not configured.' };
    const campaign = await this.getActiveCampaign(campaignKey);
    if (!campaign) {
      return { found: false, error: `No public campaign found for key "${campaignKey || this.defaultCampaignKey}".` };
    }

    const { data, error } = await this.client
      .from('strategic_snapshots')
      .select('save_last_modified, save_filename, game_time, campaign_date, schema_version, created_at')
      .eq('campaign_key', campaign.campaign_key)
      .order('save_last_modified', { ascending: false })
      .limit(requireOptionalInteger(limit, 'history limit', { min: 1, max: 100 }) ?? 25);

    if (error) return { found: false, error: error.message };
    return { found: true, campaignKey: campaign.campaign_key, history: data || [] };
  }

  /**
   * One compact snapshot, addressed by save_last_modified -- there is no
   * separate snapshot hash column on this schema to address by.
   */
  async getStrategicSnapshot(saveLastModified, campaignKey = null) {
    if (!this.isConfigured()) return { found: false, error: 'Supabase is not configured.' };
    const campaign = await this.getActiveCampaign(campaignKey);
    if (!campaign) {
      return { found: false, error: `No public campaign found for key "${campaignKey || this.defaultCampaignKey}".` };
    }

    const { data, error } = await this.client
      .from('strategic_snapshots')
      .select('save_last_modified, save_filename, game_time, campaign_date, schema_version, payload')
      .eq('campaign_key', campaign.campaign_key)
      .eq('save_last_modified', saveLastModified)
      .limit(1)
      .maybeSingle();

    if (error) return { found: false, error: error.message };
    if (!data) return { found: false, error: `No strategic snapshot for ${saveLastModified}.` };
    return { found: true, snapshot: data };
  }

  /** The two most recent compact snapshots, for a default delta. */
  async getRecentStrategicSnapshots(campaignKey = null, count = 2) {
    if (!this.isConfigured()) return { found: false, error: 'Supabase is not configured.' };
    const campaign = await this.getActiveCampaign(campaignKey);
    if (!campaign) {
      return { found: false, error: `No public campaign found for key "${campaignKey || this.defaultCampaignKey}".` };
    }

    const { data, error } = await this.client
      .from('strategic_snapshots')
      .select('save_last_modified, game_time, campaign_date, payload')
      .eq('campaign_key', campaign.campaign_key)
      .order('save_last_modified', { ascending: false })
      .limit(requireOptionalInteger(count, 'strategic snapshot count', { min: 1, max: 100 }) ?? 2);

    if (error) return { found: false, error: error.message };
    return { found: true, snapshots: data || [] };
  }
}

module.exports = SupabaseAdapter;
module.exports.requireOptionalInteger = requireOptionalInteger;
