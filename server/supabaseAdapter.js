/**
 * Supabase Adapter for Hosted Runtime
 *
 * Reads sanitized Player Intel snapshots and exports from Supabase.
 * Uses only the public/anon key and guarantees that all returned data
 * is strictly technology-gated Player Intel.
 */

const { createClient } = require('@supabase/supabase-js');

class SupabaseAdapter {
  constructor(config = {}) {
    this.supabaseUrl = config.supabaseUrl || process.env.SUPABASE_URL;
    this.publishableKey = config.publishableKey || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
    this.defaultCampaignKey = config.campaignKey || process.env.SUPABASE_CAMPAIGN_KEY || 'initiative';
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

  async getLatestPlayerSnapshot(observerFactionId = 4712, campaignKey = null) {
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

    const safeObserverId = parseInt(observerFactionId, 10) || 4712;

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

  async getExportMarkdown(format = 'chatgpt', observerFactionId = 4712, campaignKey = null) {
    const result = await this.getLatestPlayerSnapshot(observerFactionId, campaignKey);
    if (!result.found) {
      return { success: false, error: result.error };
    }

    const exportObj = result.chatgptExport || {};
    const markdown = format === 'full'
      ? (exportObj.full || exportObj.compact || '')
      : (exportObj.compact || exportObj.full || '');

    return {
      success: true,
      markdown,
      observerFactionId: result.snapshotRow.observer_faction_id,
      observerFactionName: result.snapshotRow.observer_faction_name
    };
  }
}

module.exports = SupabaseAdapter;
