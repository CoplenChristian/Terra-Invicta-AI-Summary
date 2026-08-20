#!/usr/bin/env node
/**
 * Backfill `strategic_snapshots` from the full snapshots already stored in
 * `player_intel_snapshots`.
 *
 * Reduces each historical save to a strategic_snapshot_v1 document so the
 * campaign trend survives pruning the large table. Processes oldest -> newest
 * so the derived `events` chain correctly.
 *
 * Usage:
 *   node scripts/backfill_strategic_history.js --dry-run
 *   node scripts/backfill_strategic_history.js --retention 25
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { buildStrategicSnapshot } = require('../shared/strategicSnapshot.mjs');
const { resolveConfig } = require('../server/config');

// Prefer the richest available view: omniscient carries full alien detail,
// player mode redacts it. Recorded per row so the provenance stays honest.
const MODE_PREFERENCE = ['omniscient', 'enhanced', 'player'];

function loadEnv() {
  const envPath = path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

// The save's game_time ("8/16/2032 12:00:00 PM") is the in-game date, which is
// what campaign chronology means. Falls back to the file mtime only when it
// cannot be parsed, so a row never lacks an ordering key.
function campaignDateIso(gameTimeString, fallbackIso) {
  const parsed = Date.parse(gameTimeString);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallbackIso;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const config = resolveConfig();
  const options = {
    config,
    dryRun: false,
    campaignKey: process.env.SUPABASE_CAMPAIGN_KEY || config.campaign.key,
    observerFactionId: Number(process.env.SUPABASE_OBSERVER_FACTION_ID) || config.campaign.defaultObserverFactionId,
    retention: null
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') options.dryRun = true;
    else if (args[i] === '--campaign' && i + 1 < args.length) options.campaignKey = args[++i];
    else if (args[i] === '--observer' && i + 1 < args.length) options.observerFactionId = Number(args[++i]);
    else if (args[i] === '--retention' && i + 1 < args.length) options.retention = Number(args[++i]);
  }
  return options;
}

async function main() {
  loadEnv();
  const options = parseArgs();

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('[Error] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (checked env and .env).');
    process.exit(1);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  console.log('========================================================');
  console.log('  STRATEGIC HISTORY BACKFILL');
  console.log(`  Campaign:  ${options.campaignKey}`);
  console.log(`  Observer:  ${options.observerFactionId}`);
  console.log(`  Mode:      ${options.dryRun ? 'DRY RUN (no writes)' : 'LIVE'}`);
  console.log('========================================================\n');

  // Enumerate distinct saves oldest-first so events chain correctly.
  const { data: rows, error: listErr } = await supabase
    .from('player_intel_snapshots')
    .select('save_last_modified, save_filename, game_time, visibility, observer_faction_id')
    .eq('campaign_key', options.campaignKey)
    .eq('observer_faction_id', options.observerFactionId)
    .order('save_last_modified', { ascending: true });

  if (listErr) {
    console.error(`[Error] Failed to list snapshots: ${listErr.message}`);
    process.exit(1);
  }

  const bySave = new Map();
  for (const row of rows) {
    const key = row.save_last_modified;
    if (!bySave.has(key)) bySave.set(key, { meta: row, modes: new Set() });
    bySave.get(key).modes.add(row.visibility);
  }

  const saves = [...bySave.entries()].sort((a, b) => new Date(a[0]) - new Date(b[0]));
  const retention = options.retention || Math.max(saves.length, 20);
  console.log(`Found ${saves.length} save(s). Retention for this run: ${retention}.\n`);

  let previous = null;
  let written = 0;
  let totalBytes = 0;

  for (const [saveLastModified, entry] of saves) {
    const mode = MODE_PREFERENCE.find(m => entry.modes.has(m));
    if (!mode) {
      console.warn(`  ! ${saveLastModified}  no usable mode, skipped`);
      continue;
    }

    const { data: snapRow, error: fetchErr } = await supabase
      .from('player_intel_snapshots')
      .select('snapshot')
      .eq('campaign_key', options.campaignKey)
      .eq('save_last_modified', saveLastModified)
      .eq('observer_faction_id', options.observerFactionId)
      .eq('visibility', mode)
      .limit(1)
      .maybeSingle();

    if (fetchErr || !snapRow?.snapshot) {
      console.warn(`  ! ${saveLastModified}  fetch failed (${fetchErr?.message || 'no payload'}), skipped`);
      continue;
    }

    const doc = buildStrategicSnapshot(snapRow.snapshot, {
      observerFactionId: options.observerFactionId,
      campaignKey: options.campaignKey,
      previous,
      policy: options.config.analysis.strategicHistory
    });
    // Record provenance: backfilled documents were reduced from an already
    // mode-filtered snapshot, not from the raw save.
    doc.meta.backfilledFrom = mode;

    const bytes = Buffer.byteLength(JSON.stringify(doc), 'utf8');
    totalBytes += bytes;

    const gameTime = entry.meta.game_time || doc.meta.campaignDate;
    const eventNote = doc.events.length ? `  events: ${doc.events.map(e => e.type).join(', ')}` : '';
    console.log(`  ${saveLastModified}  ${String(gameTime).padEnd(24)} ${mode.padEnd(10)} ${(bytes / 1024).toFixed(1).padStart(6)} KB${eventNote}`);

    if (!options.dryRun) {
      const { error: rpcErr } = await supabase.rpc('store_strategic_snapshot', {
        p_campaign_key: options.campaignKey,
        p_save_last_modified: saveLastModified,
        p_save_filename: entry.meta.save_filename,
        p_game_time: entry.meta.game_time,
        // In-game date, not the file mtime: retention orders rows by
        // campaign_date, so wall-clock time here puts restored or copied saves
        // in the wrong chronology.
        p_campaign_date: campaignDateIso(entry.meta.game_time, saveLastModified),
        p_payload: doc,
        p_retention: retention
      });
      if (rpcErr) {
        console.error(`[Error] Store failed for ${saveLastModified}: ${rpcErr.message}`);
        process.exit(1);
      }
      written++;
    }

    previous = doc;
  }

  console.log(`\nTotal compact size: ${(totalBytes / 1024).toFixed(1)} KB across ${saves.length} save(s).`);
  console.log(options.dryRun
    ? '[Dry Run] No rows written.'
    : `✓ Backfilled ${written} strategic snapshot(s).`);
}

if (require.main === module) {
  main().catch(err => {
    console.error(`[Fatal] ${err.message}`);
    process.exit(1);
  });
}

module.exports = { main };
