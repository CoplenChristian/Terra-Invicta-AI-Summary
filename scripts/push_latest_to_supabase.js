#!/usr/bin/env node

/**
 * Push Latest Terra Invicta intelligence snapshots to Supabase
 *
 * Reuses the local parser/filter pipeline to build separately labeled Player,
 * Enhanced, and explicitly enabled Omniscient payloads for every discovered
 * observer faction.
 *
 * Usage:
 *   node scripts/push_latest_to_supabase.js [--dry-run] [--save <path>] [--campaign <key>]
 *     [--full-snapshot-retention <count>] [--history-retention <count>]
 *     [--inline-tech-tree | --omit-tech-tree]
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { createClient } = require('@supabase/supabase-js');
const { resolveConfig, parseIntegerEnv, envPresent } = require('../server/config');

const saveParser = require('../server/saveParser');
const snapshotBuilder = require('../server/snapshotBuilder');
const intelligenceFilter = require('../server/intelligenceFilter');
const exportGenerator = require('../server/exportGenerator');
const briefingGenerator = require('../server/briefingGenerator');
const templateLoader = require('../server/templateLoader');
const snapshotIdentity = require('../server/snapshotIdentity');
const snapshotDelta = require('../server/snapshotDelta');
const snapshotLoader = require('../server/snapshotLoader');
const {
  INTELLIGENCE_MODES,
  DEFAULT_OBSERVER_FACTION_ID,
  ALIEN_FACTION_ID,
  ALIEN_FACTION_DISPLAY_NAME,
  SERVANTS_DISPLAY_NAME
} = require('../shared/constants.mjs');
const { buildStrategicSnapshot, DEFAULT_HISTORY_POLICY } = require('../shared/strategicSnapshot.mjs');
const runtimeConfig = resolveConfig();

// Publishing fan-out policy.
//
// Every save previously published one row per (observer faction x visibility
// mode) = 24 rows, at roughly 625 kB each on disk. With no retention that put
// the free-plan 500 MB ceiling about 25 saves away. Publishing only the
// observer faction cuts 24 rows to 3 (~87%).
//
// The non-observer rows answer "what does the Servants know?" -- useful, but
// not worth 21/24 of the storage budget. Pass --all-observers to restore the
// old behaviour for a one-off cross-faction analysis.
const PUBLISH_POLICY = {
  observerFactionId: runtimeConfig.campaign.defaultObserverFactionId || DEFAULT_OBSERVER_FACTION_ID,
  observerModes: runtimeConfig.publishing.observerModes || INTELLIGENCE_MODES,
  otherFactionModes: runtimeConfig.publishing.otherFactionModes || []
};

const MEGABYTE = 1024 * 1024;

/**
 * Payload limits, hoisted so they can be found and tuned in one place.
 *
 * MAX_SNAPSHOT_ROW_BYTES is a pre-flight sanity ceiling on a single generated
 * row; the batching limits below keep an upsert request comfortably under the
 * hosted REST payload limit. All three are operational policy, not measured
 * values -- there is no published Supabase figure they are derived from.
 */
const MAX_SNAPSHOT_ROW_BYTES = 12 * MEGABYTE;
const MAX_UPSERT_BATCH_BYTES = 3 * MEGABYTE;
const MAX_UPSERT_BATCH_ROWS = 8;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// The save's gameTimeString ("8/16/2032 12:00:00 PM") is the in-game date and
// is what campaign chronology means. Falls back to the file mtime only when the
// string cannot be parsed, so a row is never left without an ordering key.
function campaignDateIso(gameTimeString, fallbackIso) {
  const parsed = Date.parse(gameTimeString);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallbackIso;
}

// The tech tree is 94% static: `nodes` (~959 KB) is derived from the game
// templates and is byte-identical across every row and every save, while
// finishedTechsNames / globalActive / factionStatus (~60 KB) are per-save.
//
// Split it: the static half is uploaded once per campaign and rehydrated by
// readers, the per-save half stays inline. An earlier blanket strip had to be
// reverted because the hosted worker cannot rebuild template data from a
// reference alone; sharing one stored copy keeps those queries working.
function splitTechTree(modeData, fingerprint) {
  if (!modeData || !modeData.techTree) return modeData;
  const { techTree, ...rest } = modeData;
  const { nodes, categories, unlockClasses, ...perSave } = techTree;
  return {
    ...rest,
    techTree: {
      ...perSave,
      // Readers splice the shared graph back in via this fingerprint.
      graphRef: {
        fingerprint,
        nodeCount: Array.isArray(nodes) ? nodes.length : 0,
        source: 'campaigns.tech_graph'
      }
    }
  };
}

function techGraphFingerprint(techTree) {
  const canonicalize = (value) => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
    }
    return value;
  };
  const graph = {
    nodes: Array.isArray(techTree?.nodes)
      ? [...techTree.nodes].sort((left, right) => String(left?.id || '').localeCompare(String(right?.id || '')))
      : [],
    categories: techTree?.categories || {},
    unlockClasses: techTree?.unlockClasses || {}
  };
  // Include all graph content, not just IDs. Prerequisites, costs, effects,
  // categories, and unlock classes can change in a template patch while the
  // node set remains identical.
  const serialized = JSON.stringify(canonicalize(graph));
  const digest = crypto.createHash('sha256').update(serialized, 'utf8').digest('hex').slice(0, 32);
  return `tg:sha256:${digest}`;
}

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

function validateSnapshotRows(rows, identity, targetSave) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('No snapshot rows were generated; refusing to publish an empty campaign.');
  }

  const maxBytes = MAX_SNAPSHOT_ROW_BYTES;
  for (const row of rows) {
    const snapshot = row.snapshot || {};
    if (snapshot.snapshotId !== identity.snapshotId ||
      snapshot.saveHash !== identity.saveHash ||
      snapshot.saveModifiedAt !== identity.saveModifiedAt ||
      !snapshot.generatedAt ||
      row.save_last_modified !== identity.saveModifiedAt ||
      row.save_filename !== targetSave.name ||
      !['player', 'enhanced', 'omniscient'].includes(row.visibility)) {
      throw new Error(`Snapshot identity validation failed for observer ${row.observer_faction_id} / ${row.visibility}.`);
    }
    const size = Buffer.byteLength(JSON.stringify(row), 'utf8');
    if (size > maxBytes) {
      throw new Error(`Snapshot row for observer ${row.observer_faction_id} is too large to publish (${size} bytes).`);
    }
  }
}

// Parse CLI Arguments
function usage() {
  return [
    'Usage: node scripts/push_latest_to_supabase.js [options]',
    '',
    'Options:',
    '  --dry-run                         Validate without network writes',
    '  --save <path>                     Publish an explicit .gz/.json save',
    '  --campaign <key>                  Campaign key',
    '  --display-name <name>             Campaign display name',
    '  --private                          Mark campaign non-public',
    '  --all-observers                    Publish every observer faction',
    '  --observer <id>                    Observer faction ID',
    '  --history-retention <count>       Strategic history rows to retain',
    '  --full-snapshot-retention <count> Full-fidelity saves to retain',
    '  --inline-tech-tree                Embed the static tech graph in each row',
    '  --omit-tech-tree                  Omit the tech graph and mark it unavailable',
    '  --help                             Show this help'
  ].join('\n');
}

function parsePositiveInteger(raw, flag) {
  if (!/^\d+$/.test(String(raw))) throw new Error(`${flag} requires a positive integer.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${flag} requires a positive integer.`);
  return value;
}

// Environment overrides are parsed strictly, not with `Number(x) || default`.
// A typo used to fall back silently, and 0 was unrepresentable. For the two
// retention values that silence was data loss: a malformed count pruned a
// different number of snapshot rows than the operator asked for.
//
// The defaults come from config/defaults.json via resolveConfig(), which is
// also what already applies and validates these same environment variables --
// so the values below are only a strict re-read for a caller that injects its
// own `env`, never a second copy of the defaults.
function retentionFromEnv(env, name, configured, { min = 1, max = 1000 } = {}) {
  if (envPresent(env[name])) return parseIntegerEnv(env[name], name, { min, max });
  return configured;
}

function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const args = argv;
  const options = {
    help: false,
    dryRun: false,
    savePath: null,
    campaignKey: env.SUPABASE_CAMPAIGN_KEY || runtimeConfig.campaign.key,
    displayName: env.SUPABASE_CAMPAIGN_NAME || runtimeConfig.campaign.name,
    isPublic: true,
    allObservers: false,
    observerFactionId: envPresent(env.SUPABASE_OBSERVER_FACTION_ID)
      ? parseIntegerEnv(env.SUPABASE_OBSERVER_FACTION_ID, 'SUPABASE_OBSERVER_FACTION_ID', { min: 1 })
      : PUBLISH_POLICY.observerFactionId,
    historyRetention: retentionFromEnv(
      env,
      'SUPABASE_HISTORY_RETENTION',
      // analysis.strategicHistory.retention is canonical; config.js keeps
      // publishing.historyRetention synchronized with it.
      runtimeConfig.analysis.strategicHistory.retention
        ?? runtimeConfig.publishing.historyRetention
        ?? DEFAULT_HISTORY_POLICY.retention,
      { min: 1, max: 1000 }
    ),
    fullSnapshotRetention: retentionFromEnv(
      env,
      'SUPABASE_FULL_SNAPSHOT_RETENTION',
      // config/defaults.json owns this default (publishing.fullSnapshotRetention).
      runtimeConfig.publishing.fullSnapshotRetention,
      { min: 1, max: 100 }
    ),
    // The static half of the tech tree is stored once per campaign and spliced
    // back in by readers, so sharing it is lossless. --inline-tech-tree forces
    // the old per-row copy for a consumer that cannot follow the reference.
    shareTechGraph: runtimeConfig.publishing.shareTechGraph !== false,
    omitTechTree: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--save') {
      if (i + 1 >= args.length) throw new Error('--save requires a path.');
      options.savePath = args[++i];
    } else if (arg === '--campaign') {
      if (i + 1 >= args.length) throw new Error('--campaign requires a key.');
      options.campaignKey = args[++i];
    } else if (arg === '--display-name') {
      if (i + 1 >= args.length) throw new Error('--display-name requires a value.');
      options.displayName = args[++i];
    } else if (arg === '--private') {
      options.isPublic = false;
    } else if (arg === '--all-observers') {
      options.allObservers = true;
    } else if (arg === '--observer') {
      if (i + 1 >= args.length) throw new Error('--observer requires a faction ID.');
      options.observerFactionId = parsePositiveInteger(args[++i], '--observer');
    } else if (arg === '--history-retention') {
      if (i + 1 >= args.length) throw new Error('--history-retention requires a count.');
      options.historyRetention = parsePositiveInteger(args[++i], '--history-retention');
    } else if (arg === '--full-snapshot-retention') {
      if (i + 1 >= args.length) throw new Error('--full-snapshot-retention requires a count.');
      options.fullSnapshotRetention = parsePositiveInteger(args[++i], '--full-snapshot-retention');
    } else if (arg === '--inline-tech-tree') {
      options.shareTechGraph = false;
    } else if (arg === '--omit-tech-tree') {
      options.shareTechGraph = false;
      options.omitTechTree = true;
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option '${arg}'. Use --help to list supported options.`);
    } else {
      throw new Error(`Unexpected argument '${arg}'. Use --help to list supported options.`);
    }
  }

  if (options.omitTechTree && args.includes('--inline-tech-tree')) {
    throw new Error('--omit-tech-tree and --inline-tech-tree are mutually exclusive.');
  }
  options.historyRetention = parsePositiveInteger(options.historyRetention, '--history-retention');
  options.fullSnapshotRetention = parsePositiveInteger(options.fullSnapshotRetention, '--full-snapshot-retention');

  return options;
}

function applyTechTreeMode(modeData, options, fingerprint) {
  if (options.omitTechTree) {
    const nodeCount = Array.isArray(modeData?.techTree?.nodes) ? modeData.techTree.nodes.length : 0;
    const { techTree, ...rest } = modeData || {};
    return {
      ...rest,
      techTreeRef: {
        omitted: true,
        nodeCount,
        reason: 'static template data omitted by --omit-tech-tree'
      }
    };
  }
  return options.shareTechGraph ? splitTechTree(modeData, fingerprint) : modeData;
}

async function main() {
  let options;
  try {
    options = parseArgs();
  } catch (error) {
    console.error(`[Error] ${error.message}`);
    console.error(usage());
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    console.log(usage());
    return;
  }

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
    if (!/\.(?:gz|json)$/i.test(options.savePath)) {
      console.error('[Error] Explicit save path must end in .gz or .json.');
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
  console.log(`Full-save retention: ${options.fullSnapshotRetention} save(s)`);
  console.log(`Mode:               ${options.dryRun ? 'DRY RUN (No network writes)' : 'LIVE PUBLISH'}`);

  // 2. Parse Save & Build Raw Snapshot
  console.log('\nParsing save and generating intelligence snapshots...');
  templateLoader.load();

  // Guard against publishing a save that the game is still writing: verify the
  // file fingerprint is stable across the parse, mirroring the server's check.
  const beforeFingerprint = snapshotIdentity.createFileFingerprint(targetSave.fullPath);
  const parsedSave = saveParser.readSaveJson(targetSave.fullPath);
  const afterFingerprint = snapshotIdentity.createFileFingerprint(targetSave.fullPath);
  if (afterFingerprint.key !== beforeFingerprint.key) {
    console.error(`[Error] Save '${targetSave.name}' changed while it was being parsed. Terra Invicta may still be writing it; retry after the save finishes.`);
    process.exit(1);
  }
  targetSave = { ...targetSave, saveHash: beforeFingerprint.saveHash };

  const rawSnapshot = snapshotBuilder.buildRawSnapshot(parsedSave);
  const identity = snapshotIdentity.createSnapshotIdentity(targetSave, options.campaignKey);
  snapshotIdentity.attachSnapshotIdentity(rawSnapshot, identity);
  // Skip past saves that capture the same in-game moment, otherwise the
  // published changesSincePrevious is empty whenever the latest save is an
  // ExitSave written seconds after an Autosave. The selection itself lives in
  // server/snapshotLoader.js so the publisher, the local server and the loader
  // share one implementation instead of three copies that can drift.
  const previousSelection = snapshotLoader.selectPreviousRawSnapshot({
    saveFile: targetSave,
    rawSnapshot,
    campaignKey: options.campaignKey,
    generatedAt: identity.generatedAt,
    onError: (previousError) => {
      console.warn(`[Warning] Previous save comparison unavailable: ${previousError.message}`);
    }
  });
  const previousRawSnapshot = previousSelection?.snapshot || null;
  if (previousSelection) {
    const selection = previousSelection.selection;
    console.log(`Comparison baseline:  ${selection.save.name}${selection.gameTime ? ` (${selection.gameTime})` : ''}${selection.reason === 'same-game-time-fallback' ? ' — every recent save shares this in-game moment' : ''}`);
  }

  const saveMtimeIso = new Date(targetSave.lastModified).toISOString();
  const saveMtimeDate = new Date(targetSave.lastModified);
  const gameTimeString = rawSnapshot.metadata.gameTimeString || 'Unknown';

  console.log(`In-Game Date:       ${gameTimeString}`);
  console.log(`Campaign Difficulty: ${rawSnapshot.metadata.difficulty}`);

  // 3. Discover Observer Factions
  //
  // Last-resort roster, used ONLY when the parsed save lists no factions at
  // all. The ids are the stock campaign's; a modded or renamed campaign would
  // publish under the wrong labels, which is why the discovered list always
  // wins. Only the two ids that shared/constants.mjs actually names are
  // referenced -- inventing six more constants for a fallback nothing reads in
  // a healthy save would be churn.
  const fallbackFactions = [
    { ID: runtimeConfig.campaign.defaultObserverFactionId, displayName: runtimeConfig.campaign.defaultObserverFactionName },
    { ID: 4710, displayName: 'the Resistance' },
    { ID: 4711, displayName: 'Humanity First' },
    { ID: 4715, displayName: 'the Academy' },
    { ID: 4716, displayName: 'Project Exodus' },
    { ID: 4714, displayName: 'the Protectorate' },
    { ID: 4713, displayName: SERVANTS_DISPLAY_NAME },
    { ID: ALIEN_FACTION_ID, displayName: ALIEN_FACTION_DISPLAY_NAME }
  ];

  const discoveredFactions = (rawSnapshot.factions || []).filter(f => f.ID !== undefined);
  const observerFactions = discoveredFactions.length > 0 ? discoveredFactions : fallbackFactions;

  console.log(`Discovered ${observerFactions.length} observer factions.`);

  // 4. Generate published snapshots for each supported hosted mode.
  // Enhanced and Omniscient are intentionally enabled for this campaign at the
  // user's request; each remains clearly labeled in storage and every hosted response.
  const snapshotRows = [];
  const configuredModes = Array.from(new Set(PUBLISH_POLICY.observerModes));
  const publishedModes = configuredModes.length > 0 ? configuredModes : INTELLIGENCE_MODES;
  const allObserverModes = INTELLIGENCE_MODES;

  // Apply the fan-out policy: publish every mode for the observer faction, and
  // only PUBLISH_POLICY.otherFactionModes for everyone else (empty by default).
  const modesForObserver = (factionId) => {
    if (options.allObservers) return allObserverModes;
    return Number(factionId) === Number(options.observerFactionId)
      ? PUBLISH_POLICY.observerModes
      : PUBLISH_POLICY.otherFactionModes;
  };

  const plannedRows = observerFactions
    .reduce((total, f) => total + modesForObserver(f.ID).length, 0);
  if (plannedRows === 0) {
    console.error(`[Error] Fan-out policy produced 0 rows. Observer faction ${options.observerFactionId} was not found among ${observerFactions.length} discovered factions.`);
    process.exit(1);
  }
  console.log(
    `Fan-out policy: ${plannedRows} row(s) this publish `
    + `(${options.allObservers ? 'ALL observers' : `observer ${options.observerFactionId} only`}); `
    + `previous behaviour would have written ${observerFactions.length * publishedModes.length}.`
  );

  // Identity of the static tech graph. Every row this publish writes references
  // it instead of embedding its own ~959 KB copy.
  const techGraphId = techGraphFingerprint(rawSnapshot.techTree);
  const sharedTechGraph = options.shareTechGraph && rawSnapshot.techTree
    ? {
      fingerprint: techGraphId,
      nodes: rawSnapshot.techTree.nodes || [],
      categories: rawSnapshot.techTree.categories || {},
      unlockClasses: rawSnapshot.techTree.unlockClasses || {}
    }
    : null;

  for (const observer of observerFactions) {
    for (const mode of modesForObserver(observer.ID)) {
      const modeData = intelligenceFilter.applyFilter(rawSnapshot, mode, observer.ID);
      if (mode === 'player') intelligenceFilter.assertPlayerSnapshotSafe(modeData);
      if (previousRawSnapshot) {
        const previousModeData = intelligenceFilter.applyFilter(previousRawSnapshot, mode, observer.ID);
        modeData.changesSincePrevious = snapshotDelta.build(previousModeData, modeData, observer.ID);
      } else {
        modeData.changesSincePrevious = snapshotDelta.build(null, modeData, observer.ID);
      }
      const missionControlBriefing = briefingGenerator.generateMissionControlBriefing(modeData, rawSnapshot);
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
        // The retained full-fidelity rows keep the tech tree because the
        // hosted worker's tech endpoints need it to answer queries. Operators
        // can pass --omit-tech-tree when publishing a deliberately reduced row;
        // that row will expose techTreeRef and the hosted tech endpoints will
        // correctly report that the graph is unavailable.
        snapshot: {
          ...applyTechTreeMode(modeData, options, techGraphId),
          missionControlBriefing
        },
        chatgpt_export: {
          compact: compactMarkdown,
          full: fullMarkdown
        },
        visibility: mode,
        generated_at: identity.generatedAt
      });
    }
  }

  console.log(`Generated ${snapshotRows.length} published snapshot payloads (${publishedModes.join(', ')}).`);
  try {
    validateSnapshotRows(snapshotRows, identity, targetSave);
    console.log('✓ Snapshot identity and payload-size validation passed.');
  } catch (validationError) {
    console.error(`[Error] Refusing to publish invalid snapshot set: ${validationError.message}`);
    process.exit(1);
  }

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
  const { data: existingCampaign, error: fetchErr } = await withSupabaseRetry(
    'campaign lookup',
    () => supabase
      .from('campaigns')
      .select('campaign_key, display_name, is_public, current_save_last_modified, current_game_time, current_save_filename, tech_graph_fingerprint')
      .eq('campaign_key', options.campaignKey)
      .maybeSingle()
  );

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

  // Build campaign metadata now, but do not move the public pointer until every
  // snapshot row has been uploaded successfully. This prevents a partial
  // publish from advertising a save whose mode/observer rows are incomplete.
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

  // Upsert published snapshot rows first. Keep each request comfortably below
  // the hosted REST payload limit while retaining bulk upserts. Batch size is
  // driven by actual payload bytes, not a fixed row count, so large rows can
  // never push a single request over the limit.
  console.log(`Upserting ${snapshotRows.length} published snapshot rows...`);
  const maxBatchBytes = MAX_UPSERT_BATCH_BYTES;
  const maxBatchRows = MAX_UPSERT_BATCH_ROWS;
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
    console.log(`✓ Campaign metadata committed (${options.campaignKey}) after snapshot validation.`);
  } else {
    console.log(`✓ Existing newer campaign pointer preserved (${options.campaignKey}).`);
  }

  console.log(`✓ Successfully uploaded ${uploadedSnapshotCount} published snapshots to Supabase.`);

  // Compact strategic history. ~15 KB per save against ~2 MB for the full
  // snapshot set, so this is what lets us retain a long trend line cheaply --
  // and what makes pruning the full snapshots safe later.
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
    if (compactBytes > 250 * 1024) {
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

module.exports = { main, parseArgs, usage, applyTechTreeMode, techGraphFingerprint };
