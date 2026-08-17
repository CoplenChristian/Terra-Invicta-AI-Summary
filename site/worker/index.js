/**
 * Hosted Cloudflare / Edge Worker API
 *
 * Exposes sanitized Player Intel data from Supabase (when configured)
 * or falls back to bundled static snapshot files.
 *
 * Note: Raw, enhanced, or omniscient modes are strictly excluded.
 */

const asset = (env, request, pathname) => {
  const url = new URL(request.url);
  url.pathname = pathname;
  return env.ASSETS.fetch(new Request(url.toString(), {
    method: 'GET',
    headers: request.headers
  }));
};

const observerFile = (observerId, suffix) => {
  const safeObserverId = /^\d+$/.test(observerId || '') ? observerId : '4712';
  return `/data/${suffix}-player-${safeObserverId}.json`;
};

const jsonResponse = (body, status = 200) => {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=60, s-maxage=60'
    }
  });
};

async function querySupabase(env, pathWithParams) {
  const supabaseUrl = env.SUPABASE_URL;
  const anonKey = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY;

  const url = `${supabaseUrl}/rest/v1/${pathWithParams}`;
  const response = await fetch(url, {
    headers: {
      'apikey': anonKey,
      'Authorization': `Bearer ${anonKey}`,
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Supabase API error (${response.status}): ${errorText}`);
  }

  return await response.json();
}

async function fetchFromSupabase(env, observerId) {
  const campaignKey = env.SUPABASE_CAMPAIGN_KEY || 'initiative';
  const safeObserverId = /^\d+$/.test(observerId || '') ? observerId : '4712';

  // Step 1: Query active public campaign pointer
  const campaigns = await querySupabase(
    env,
    `campaigns?campaign_key=eq.${encodeURIComponent(campaignKey)}&is_public=eq.true&select=campaign_key,current_save_last_modified,current_game_time,current_save_filename`
  );

  if (!campaigns || campaigns.length === 0) {
    return { found: false, status: 404, error: `Public campaign '${campaignKey}' not found.` };
  }

  const campaign = campaigns[0];
  if (!campaign.current_save_last_modified) {
    return { found: false, status: 404, error: `No active save recorded for campaign '${campaignKey}'.` };
  }

  // Step 2: Query matching Player Intel snapshot row for requested observer
  const snapshots = await querySupabase(
    env,
    `player_intel_snapshots?campaign_key=eq.${encodeURIComponent(campaignKey)}&save_last_modified=eq.${encodeURIComponent(campaign.current_save_last_modified)}&observer_faction_id=eq.${safeObserverId}&visibility=eq.player&select=snapshot,chatgpt_export,observer_faction_id,observer_faction_name,save_filename,save_last_modified,game_time`
  );

  if (!snapshots || snapshots.length === 0) {
    return {
      found: false,
      status: 404,
      error: `No Player Intel snapshot found for observer ${safeObserverId} at timestamp ${campaign.current_save_last_modified}.`
    };
  }

  const row = snapshots[0];
  const payload = row.snapshot;
  if (payload) {
    payload.mode = 'player';
    payload.isOmniscient = false;
  }

  return {
    found: true,
    campaign,
    row,
    snapshot: payload,
    chatgptExport: row.chatgpt_export
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const observerId = url.searchParams.get('observer') || '4712';
    const isSupabaseConfigured = !!(env.SUPABASE_URL && (env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY));

    // Handle snapshot & refresh routes
    if (url.pathname === '/api/snapshot' || url.pathname === '/api/refresh') {
      if (isSupabaseConfigured) {
        try {
          const result = await fetchFromSupabase(env, observerId);
          if (!result.found) {
            return jsonResponse({ success: false, error: result.error }, result.status);
          }
          return jsonResponse({ success: true, data: result.snapshot, source: 'supabase' });
        } catch (err) {
          return jsonResponse({ success: false, error: err.message }, 500);
        }
      }
      // Fallback to static asset if Supabase not configured in this deployment
      return asset(env, request, observerFile(observerId, 'snapshot'));
    }

    // Handle export route
    if (url.pathname === '/api/export') {
      const format = url.searchParams.get('format') === 'full' ? 'full' : 'chatgpt';
      if (isSupabaseConfigured) {
        try {
          const result = await fetchFromSupabase(env, observerId);
          if (!result.found) {
            return jsonResponse({ success: false, error: result.error }, result.status);
          }
          const exp = result.chatgptExport || {};
          const markdown = format === 'full'
            ? (exp.full || exp.compact || '')
            : (exp.compact || exp.full || '');
          return jsonResponse({ success: true, markdown, source: 'supabase' });
        } catch (err) {
          return jsonResponse({ success: false, error: err.message }, 500);
        }
      }
      const fileSuffix = format === 'full' ? 'export-full' : 'export-chatgpt';
      return asset(env, request, observerFile(observerId, fileSuffix));
    }

    // Handle templates/effects info
    if (url.pathname === '/api/templates/effects') {
      return asset(env, request, '/data/effects.json');
    }

    // Handle saves list
    if (url.pathname === '/api/saves') {
      if (isSupabaseConfigured) {
        try {
          const campaignKey = env.SUPABASE_CAMPAIGN_KEY || 'initiative';
          const campaigns = await querySupabase(
            env,
            `campaigns?campaign_key=eq.${encodeURIComponent(campaignKey)}&is_public=eq.true&select=campaign_key,current_save_last_modified,current_game_time,current_save_filename`
          );
          const camp = campaigns?.[0];
          const saves = camp ? [{
            name: camp.current_save_filename || 'Active Save',
            lastModified: camp.current_save_last_modified,
            active: true
          }] : [];
          return jsonResponse({ success: true, saves, source: 'supabase' });
        } catch (err) {
          return jsonResponse({ success: false, error: err.message }, 500);
        }
      }
      return jsonResponse({ success: true, saves: [], staticOnly: true });
    }

    // Default: Static web assets
    return env.ASSETS.fetch(request);
  }
};
