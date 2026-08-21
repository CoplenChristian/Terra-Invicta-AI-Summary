#!/usr/bin/env node
/**
 * Export full snapshots from `player_intel_snapshots` to local gzipped JSON.
 * Purpose: export full snapshots from Supabase to local gzipped JSON as the
 *   safety net before pruning.
 *
 * Intended as the safety net before pruning: by default it exports exactly the
 * rows that `prune_intel_snapshots(campaign, keep)` would delete, so nothing is
 * dropped from Supabase without a local copy first.
 *
 * Output lands in backups/<campaign>/<timestamp>/ as one .json.gz per row.
 * *.gz is gitignored, so exports never end up in version control.
 *
 * Usage:
 *   node scripts/export_intel_snapshots.js --keep 3            # export what pruning would delete
 *   node scripts/export_intel_snapshots.js --all               # export everything
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { createClient } = require('@supabase/supabase-js');
const { resolveConfig } = require('../server/config');
const runtimeConfig = resolveConfig();

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

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    campaignKey: process.env.SUPABASE_CAMPAIGN_KEY || runtimeConfig.campaign.key,
    keep: 3,
    all: false,
    outDir: null
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--all') options.all = true;
    else if (args[i] === '--keep' && i + 1 < args.length) options.keep = Number(args[++i]);
    else if (args[i] === '--campaign' && i + 1 < args.length) options.campaignKey = args[++i];
    else if (args[i] === '--out' && i + 1 < args.length) options.outDir = args[++i];
  }
  return options;
}

const safe = (value) => String(value).replace(/[^0-9A-Za-z._-]/g, '_');

async function main() {
  loadEnv();
  const options = parseArgs();

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('[Error] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
    process.exit(1);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const { data: saveRows, error: listErr } = await supabase
    .from('player_intel_snapshots')
    .select('save_last_modified')
    .eq('campaign_key', options.campaignKey)
    .order('save_last_modified', { ascending: false });
  if (listErr) {
    console.error(`[Error] ${listErr.message}`);
    process.exit(1);
  }

  const distinct = [...new Set(saveRows.map(r => r.save_last_modified))];
  const targets = options.all ? distinct : distinct.slice(options.keep);

  if (targets.length === 0) {
    console.log(`Nothing to export (${distinct.length} save(s) present, keeping ${options.keep}).`);
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = options.outDir
    || path.resolve(__dirname, '..', 'backups', safe(options.campaignKey), stamp);
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`Exporting ${targets.length} of ${distinct.length} save(s) to:\n  ${outDir}\n`);

  let files = 0;
  let bytes = 0;
  for (const saveLastModified of targets) {
    // Fetch ids first, then one row at a time. A single save can span 24 rows
    // of several hundred KB each; selecting them together hits the statement
    // timeout on the hosted plan.
    const { data: ids, error: idErr } = await supabase
      .from('player_intel_snapshots')
      .select('id, observer_faction_id, visibility')
      .eq('campaign_key', options.campaignKey)
      .eq('save_last_modified', saveLastModified);
    if (idErr) {
      console.error(`[Error] listing ${saveLastModified}: ${idErr.message}`);
      process.exit(1);
    }

    const rows = [];
    for (const ref of ids) {
      const { data: full, error } = await supabase
        .from('player_intel_snapshots')
        .select('*')
        .eq('id', ref.id)
        .single();
      if (error) {
        console.error(`[Error] fetching row ${ref.id}: ${error.message}`);
        process.exit(1);
      }
      rows.push(full);
    }

    for (const row of rows) {
      const name = `${safe(saveLastModified)}__${row.observer_faction_id}__${row.visibility}.json.gz`;
      const gz = zlib.gzipSync(Buffer.from(JSON.stringify(row), 'utf8'));
      fs.writeFileSync(path.join(outDir, name), gz);
      files++;
      bytes += gz.length;
    }
    console.log(`  ${saveLastModified}  ${rows.length} row(s)`);
  }

  const manifest = {
    campaignKey: options.campaignKey,
    exportedAt: new Date().toISOString(),
    savesExported: targets,
    fileCount: files,
    note: 'Full player_intel_snapshots rows. Restore by re-inserting these JSON objects.'
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log(`\n✓ Exported ${files} row(s), ${(bytes / 1024 / 1024).toFixed(1)} MB gzipped.`);
  console.log(`  Manifest: ${path.join(outDir, 'manifest.json')}`);
}

if (require.main === module) {
  main().catch(err => {
    console.error(`[Fatal] ${err.message}`);
    process.exit(1);
  });
}

module.exports = { main };
