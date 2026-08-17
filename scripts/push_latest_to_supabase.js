#!/usr/bin/env node

/**
 * Push Latest Terra Invicta Player Intel Snapshot to Supabase
 *
 * Reuses existing local parsers to build sanitized Player Intel payloads
 * for all discovered observer factions and uploads them to Supabase.
 *
 * Usage:
 *   node scripts/push_latest_to_supabase.js [--dry-run] [--save <path>] [--campaign <key>]
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { createClient } = require('@supabase/supabase-js');

const saveParser = require('../server/saveParser');
const snapshotBuilder = require('../server/snapshotBuilder');
const intelligenceFilter = require('../server/intelligenceFilter');
const exportGenerator = require('../server/exportGenerator');
const templateLoader = require('../server/templateLoader');

// Parse CLI Arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    dryRun: false,
    savePath: null,
    campaignKey: process.env.SUPABASE_CAMPAIGN_KEY || 'initiative',
    displayName: process.env.SUPABASE_CAMPAIGN_NAME || 'the Initiative Campaign',
    isPublic: true
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--save' && i + 1 < args.length) {
      options.savePath = args[++i];
    } else if (arg === '--campaign' && i + 1 < args.length) {
      options.campaignKey = args[++i];
    } else if (arg === '--display-name' && i + 1 < args.length) {
      options.displayName = args[++i];
    } else if (arg === '--private') {
      options.isPublic = false;
    }
  }

  return options;
}

async function main() {
  const options = parseArgs();

  console.log('========================================================');
  console.log('  TERRA INVICTA // SUPABASE INTELLIGENCE PUBLISHER      ');
  console.log('========================================================');

  // 1. Resolve Save File
  let targetSave = null;
  if (options.savePath) {
    if (!fs.existsSync(options.savePath)) {
      console.error(`[Error] Explicit save file not found: ${options.savePath}`);
      process.exit(1);
    }
    const stats = fs.statSync(options.savePath);
    targetSave = {
      name: path.basename(options.savePath),
      fullPath: path.resolve(options.savePath),
      sizeBytes: stats.size,
      lastModified: stats.mtime
    };
  } else {
    try {
      targetSave = saveParser.getLatestSaveFile();
    } catch (err) {
      console.error(`[Error] Failed to resolve latest save: ${err.message}`);
      process.exit(1);
    }
  }

  console.log(`Target Save:        ${targetSave.name}`);
  console.log(`Last Modified:      ${targetSave.lastModified.toISOString()}`);
  console.log(`Campaign Key:       ${options.campaignKey}`);
  console.log(`Mode:               ${options.dryRun ? 'DRY RUN (No network writes)' : 'LIVE PUBLISH'}`);

  // 2. Parse Save & Build Raw Snapshot
  console.log('\nParsing save and generating Player Intel snapshots...');
  templateLoader.load();
  const parsedSave = saveParser.readSaveJson(targetSave.fullPath);
  const rawSnapshot = snapshotBuilder.buildRawSnapshot(parsedSave);

  const saveMtimeIso = new Date(targetSave.lastModified).toISOString();
  const saveMtimeDate = new Date(targetSave.lastModified);
  const gameTimeString = rawSnapshot.metadata.gameTimeString || 'Unknown';

  console.log(`In-Game Date:       ${gameTimeString}`);
  console.log(`Campaign Difficulty: ${rawSnapshot.metadata.difficulty}`);

  // 3. Discover Observer Factions
  const fallbackFactions = [
    { ID: 4712, displayName: 'the Initiative' },
    { ID: 4710, displayName: 'the Resistance' },
    { ID: 4711, displayName: 'Humanity First' },
    { ID: 4715, displayName: 'the Academy' },
    { ID: 4716, displayName: 'Project Exodus' },
    { ID: 4714, displayName: 'the Protectorate' },
    { ID: 4713, displayName: 'the Servants' },
    { ID: 4717, displayName: 'the Aliens' }
  ];

  const discoveredFactions = (rawSnapshot.factions || []).filter(f => f.ID !== undefined);
  const observerFactions = discoveredFactions.length > 0 ? discoveredFactions : fallbackFactions;

  console.log(`Discovered ${observerFactions.length} observer factions.`);

  // 4. Generate published snapshots for each supported hosted mode.
  // Omniscient is intentionally enabled for this campaign at the user's
  // request; it remains clearly labeled in storage and every hosted response.
  const snapshotRows = [];
  const publishedModes = ['player', 'omniscient'];
  for (const observer of observerFactions) {
    for (const mode of publishedModes) {
      const modeData = intelligenceFilter.applyFilter(rawSnapshot, mode, observer.ID);
      const compactMarkdown = exportGenerator.generateCompactSnapshot(modeData);
      const fullMarkdown = exportGenerator.generateFullMarkdownReport(modeData);

      snapshotRows.push({
        campaign_key: options.campaignKey,
        save_filename: targetSave.name,
        save_last_modified: saveMtimeIso,
        game_time: gameTimeString,
        difficulty: rawSnapshot.metadata.difficulty,
        campaign_start_year: rawSnapshot.metadata.campaignStartYear,
        observer_faction_id: observer.ID,
        observer_faction_name: observer.displayName,
        snapshot: modeData,
        chatgpt_export: {
          compact: compactMarkdown,
          full: fullMarkdown
        },
        visibility: mode,
        generated_at: new Date().toISOString()
      });
    }
  }

  console.log(`Generated ${snapshotRows.length} published snapshot payloads (${publishedModes.join(', ')}).`);

  // If Dry Run, output summary and exit
  if (options.dryRun) {
    console.log('\n--- DRY RUN SUMMARY ---');
    console.log(`Campaign Key:       ${options.campaignKey}`);
    console.log(`Save Filename:      ${targetSave.name}`);
    console.log(`Save Timestamp:     ${saveMtimeIso}`);
    console.log(`In-Game Date:       ${gameTimeString}`);
    console.log(`Snapshots Prepared: ${snapshotRows.length}`);
    for (const r of snapshotRows) {
      console.log(` - ${r.visibility} / Faction ${r.observer_faction_id} (${r.observer_faction_name}): Snapshot Size ~${(JSON.stringify(r.snapshot).length / 1024).toFixed(1)} KB, Export Size ~${r.chatgpt_export.compact.length} chars`);
    }
    console.log('\n[Dry Run] Validation successful. No data written to Supabase.');
    return;
  }

  // 5. Connect to Supabase with Service Role Key
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('\n[Error] Missing required Supabase environment variables:');
    if (!supabaseUrl) console.error(' - SUPABASE_URL is not set.');
    if (!serviceRoleKey) console.error(' - SUPABASE_SERVICE_ROLE_KEY is not set.');
    console.error('\nPlease set these variables in .env or your environment before publishing.');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  // 6. Check Existing Campaign & Stale-Save Protection
  console.log('\nConnecting to Supabase and checking campaign state...');
  const { data: existingCampaign, error: fetchErr } = await supabase
    .from('campaigns')
    .select('campaign_key, display_name, is_public, current_save_last_modified, current_game_time, current_save_filename')
    .eq('campaign_key', options.campaignKey)
    .maybeSingle();

  if (fetchErr) {
    console.error(`[Error] Failed checking campaign: ${fetchErr.message}`);
    process.exit(1);
  }

  let shouldUpdateCampaignPointer = true;
  if (existingCampaign && existingCampaign.current_save_last_modified) {
    const existingMtime = new Date(existingCampaign.current_save_last_modified);
    if (existingMtime > saveMtimeDate) {
      console.warn(`[Warning] Existing campaign pointer (${existingMtime.toISOString()}) is NEWER than this save (${saveMtimeIso}).`);
      console.warn(`[Protection] Active save pointer on campaign '${options.campaignKey}' will NOT be rolled back.`);
      shouldUpdateCampaignPointer = false;
    }
  }

  // 7. Upsert Campaign Metadata
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
  }

  const { error: campaignUpsertErr } = await supabase
    .from('campaigns')
    .upsert(campaignPayload, { onConflict: 'campaign_key' });

  if (campaignUpsertErr) {
    console.error(`[Error] Failed upserting campaign: ${campaignUpsertErr.message}`);
    process.exit(1);
  }
  console.log(`✓ Campaign metadata upserted (${options.campaignKey}).`);

  // 8. Upsert published snapshot rows
  console.log(`Upserting ${snapshotRows.length} published snapshot rows...`);
  // Keep each request comfortably below the hosted REST payload limit while
  // retaining bulk upserts. This is deliberately a handful of requests, not
  // one network call per snapshot row.
  const snapshotBatchSize = 4;
  let uploadedSnapshotCount = 0;
  for (let offset = 0; offset < snapshotRows.length; offset += snapshotBatchSize) {
    const batch = snapshotRows.slice(offset, offset + snapshotBatchSize);
    const batchNumber = Math.floor(offset / snapshotBatchSize) + 1;
    const batchCount = Math.ceil(snapshotRows.length / snapshotBatchSize);
    console.log(`  Batch ${batchNumber}/${batchCount}: ${batch.length} rows...`);

    const { error: snapshotUpsertErr } = await supabase
      .from('player_intel_snapshots')
      .upsert(batch, {
        onConflict: 'campaign_key,save_last_modified,observer_faction_id,visibility'
      });

    if (snapshotUpsertErr) {
      console.error(`[Error] Failed upserting published snapshot batch ${batchNumber}/${batchCount}: ${snapshotUpsertErr.message}`);
      process.exit(1);
    }

    uploadedSnapshotCount += batch.length;
  }

  console.log(`✓ Successfully uploaded ${uploadedSnapshotCount} published snapshots to Supabase.`);
  console.log('========================================================');
  console.log('  PUBLISH COMPLETED SUCCESSFULLY                        ');
  console.log(`  Campaign:        ${options.campaignKey}`);
  console.log(`  Save File:       ${targetSave.name}`);
  console.log(`  Save Timestamp:  ${saveMtimeIso}`);
  console.log(`  In-Game Date:    ${gameTimeString}`);
  console.log(`  Observers:       ${observerFactions.map(o => o.displayName.replace('the ', '')).join(', ')}`);
  console.log('========================================================');
}

if (require.main === module) {
  main().catch(err => {
    console.error(`[Fatal] Unhandled error during publish: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { main, parseArgs };
