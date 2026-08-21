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
 *
 * The 2026-08-20 review (section D) called this one file "parsing +
 * fingerprinting + filtering + export + validation + batching + upsert +
 * history compaction". Those are now stages under `scripts/publish/`, in the
 * order this file runs them:
 *
 *   publish/options.js         CLI flags, env overrides, the fan-out policy
 *   publish/parseStage.js      choose a save, parse it, pick the baseline
 *   publish/techGraph.js       fingerprint and the three tech-tree modes
 *   publish/rows.js            build the rows, then refuse to publish bad ones
 *   publish/supabaseWriter.js  every network write, in the order that keeps
 *                              a reader consistent
 *
 * What is left here is the sequence itself, and the dry-run exit that must
 * happen after validation and before the first network call.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { resolveConfig } = require('../server/config');

const templateLoader = require('../server/templateLoader');
const {
  INTELLIGENCE_MODES,
  ALIEN_FACTION_ID,
  ALIEN_FACTION_DISPLAY_NAME,
  SERVANTS_DISPLAY_NAME
} = require('../shared/constants.mjs');

const { PUBLISH_POLICY, usage, parseArgs } = require('./publish/options');
const { resolveTargetSave, parseTargetSave } = require('./publish/parseStage');
const { applyTechTreeMode, techGraphFingerprint, buildSharedTechGraph } = require('./publish/techGraph');
const {
  discoverObserverFactions,
  modesForObserver,
  buildSnapshotRows,
  validateSnapshotRows
} = require('./publish/rows');
const {
  createServiceClient,
  readExistingCampaign,
  shouldAdvancePointer,
  buildCampaignPayload,
  upsertSnapshotRows,
  commitCampaignPointer,
  storeStrategicHistoryAndPrune
} = require('./publish/supabaseWriter');

const runtimeConfig = resolveConfig();

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
  let targetSave = resolveTargetSave(options);

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
  const parsed = parseTargetSave(targetSave, options);
  targetSave = parsed.targetSave;
  const { rawSnapshot, identity, previousRawSnapshot } = parsed;

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

  const observerFactions = discoverObserverFactions(rawSnapshot, fallbackFactions);

  console.log(`Discovered ${observerFactions.length} observer factions.`);

  // 4. Generate published snapshots for each supported hosted mode.
  // Enhanced and Omniscient are intentionally enabled for this campaign at the
  // user's request; each remains clearly labeled in storage and every hosted response.
  const configuredModes = Array.from(new Set(PUBLISH_POLICY.observerModes));
  const publishedModes = configuredModes.length > 0 ? configuredModes : INTELLIGENCE_MODES;

  // Apply the fan-out policy: publish every mode for the observer faction, and
  // only PUBLISH_POLICY.otherFactionModes for everyone else (empty by default).
  const plannedRows = observerFactions
    .reduce((total, f) => total + modesForObserver(f.ID, options).length, 0);
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
  const sharedTechGraph = buildSharedTechGraph(rawSnapshot, options, techGraphId);

  const snapshotRows = buildSnapshotRows({
    observerFactions,
    options,
    rawSnapshot,
    previousRawSnapshot,
    identity,
    targetSave,
    saveMtimeIso,
    gameTimeString,
    techGraphId
  });

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
  const supabase = createServiceClient();

  // 6. Check Existing Campaign & Stale-Save Protection
  console.log('\nConnecting to Supabase and checking campaign state...');
  const existingCampaign = await readExistingCampaign(supabase, options.campaignKey);
  const shouldUpdateCampaignPointer = shouldAdvancePointer(
    existingCampaign,
    saveMtimeDate,
    saveMtimeIso,
    options.campaignKey
  );

  // Build campaign metadata now, but do not move the public pointer until every
  // snapshot row has been uploaded successfully. This prevents a partial
  // publish from advertising a save whose mode/observer rows are incomplete.
  const campaignPayload = buildCampaignPayload({
    options,
    existingCampaign,
    shouldUpdateCampaignPointer,
    saveMtimeIso,
    gameTimeString,
    targetSave,
    snapshotRows,
    sharedTechGraph,
    techGraphId
  });

  const uploadedSnapshotCount = await upsertSnapshotRows(supabase, snapshotRows);

  await commitCampaignPointer(supabase, campaignPayload, shouldUpdateCampaignPointer, options.campaignKey);

  console.log(`✓ Successfully uploaded ${uploadedSnapshotCount} published snapshots to Supabase.`);

  await storeStrategicHistoryAndPrune(supabase, {
    options,
    rawSnapshot,
    targetSave,
    saveMtimeIso,
    gameTimeString,
    shouldUpdateCampaignPointer
  });

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
