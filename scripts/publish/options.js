/**
 * scripts/publish/options.js -- stage 1: what this publish run was asked to do.
 * Purpose: publish stage 1 — decide what this run was asked to do from CLI
 *   flags and environment, before any save is opened.
 *
 * Everything here is decided before a save is opened, and nothing here touches
 * the network. That is the boundary: CLI flags, environment overrides and the
 * fan-out policy, resolved once into a plain options object the later stages
 * only read.
 */

const {
  INTELLIGENCE_MODES,
  DEFAULT_OBSERVER_FACTION_ID
} = require('../../shared/constants.mjs');
const { DEFAULT_HISTORY_POLICY } = require('../../shared/strategicSnapshot.mjs');
const { resolveConfig, parseIntegerEnv, envPresent } = require('../../server/config');

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

module.exports = {
  PUBLISH_POLICY,
  usage,
  parseArgs,
  parsePositiveInteger,
  retentionFromEnv
};
