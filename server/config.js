const fs = require('fs');
const path = require('path');
// config.schema.json declares $schema draft 2020-12. Ajv's default export is
// the draft-07 build and does not carry that meta-schema, so compiling the
// schema throws "no schema with key or ref .../2020-12/schema" at require
// time -- which took down the server and three test files. The 2020 build
// is the one that knows it.
const Ajv = require('ajv/dist/2020');
const { resolveSupabaseReadKey } = require('../shared/apiSurface.mjs');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULTS_PATH = path.join(PROJECT_ROOT, 'config', 'defaults.json');
const SCHEMA_PATH = path.join(PROJECT_ROOT, 'config', 'config.schema.json');
const DEFAULT_CONFIG_PATH = path.join(PROJECT_ROOT, 'config.json');

const LEGACY_KEYS = new Set([
  'SavePath', 'WorkDir', 'TemplatesPath', 'CsvSubDir', 'ShipInfoSubDir',
  'AgainSaveSubDir', 'SummarySubDir', 'SnippetPackSubDir',
  // Metadata from the removed intelligence-capabilities file is intentionally
  // accepted and ignored during migration. It described the file rather than
  // configuring runtime behavior.
  'version', 'description',
  // The old file used camelCase path names while config.json used PascalCase.
  'templatesPath',
  'defaultObserverFaction', 'powerScoreWeights', 'intelligenceRules',
  'effects', 'strategicProjects'
]);
const warnedLegacyKeys = new Set();

function readJson(filePath, label) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid ${label} at ${filePath}: ${error.message}`);
  }
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function merge(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return base;
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) {
      merge(base[key], value);
    } else {
      base[key] = clone(value);
    }
  }
  return base;
}

function warnLegacy(key) {
  if (warnedLegacyKeys.has(key)) return;
  warnedLegacyKeys.add(key);
  process.emitWarning(`config.json key '${key}' is deprecated; use the nested schema in config/defaults.json instead.`, {
    code: 'TI_CONFIG_DEPRECATED'
  });
}

/**
 * True only when an environment variable was actually supplied. `Number(null)`
 * and `Number('')` are both 0, so presence has to be established before any
 * coercion: an unset variable must leave the configured default alone rather
 * than becoming a confident zero.
 *
 * An empty string counts as absent, matching how the other `set()` overrides in
 * this file treat it and how `.env` files spell "not configured". Whitespace is
 * deliberately NOT trimmed away here: `FOO="  "` is a value that cannot be
 * evaluated, and the parser below reports it rather than treating it as unset.
 */
function envPresent(value) {
  return value !== undefined && value !== null && value !== '';
}

/**
 * Strict integer parsing for environment overrides.
 *
 * `Number('4712x')` is NaN and `Number(x) || fallback` silently swallows it.
 * A NaN faction id used to flow all the way into publishing, and a malformed
 * retention value would silently prune a different number of snapshot rows than
 * the operator intended -- that one is data loss, so a typo has to be rejected
 * at load time instead of being papered over with a default.
 *
 * The message keeps the "Configuration validation failed" prefix used by schema
 * errors: this is the same class of failure, just caught earlier and named more
 * precisely than the schema can name it.
 */
function parseIntegerEnv(rawValue, variableName, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = String(rawValue).trim();
  const parsed = /^[+-]?\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(
      `Configuration validation failed: environment variable ${variableName}='${rawValue}' is not a valid integer ` +
      `(expected a whole number from ${min} to ${max === Number.MAX_SAFE_INTEGER ? 'the safe-integer limit' : max}).`
    );
  }
  return parsed;
}

function migrateLegacyConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  if (input.schemaVersion === 1 && input.paths && input.campaign && input.analysis) return input;

  const nestedSections = new Set(['paths', 'campaign', 'server', 'publishing', 'analysis']);
  if (Object.keys(input).some(key => nestedSections.has(key))) {
    const unknown = Object.keys(input).filter(key => !nestedSections.has(key) && key !== 'schemaVersion');
    if (unknown.length) throw new Error(`Unknown configuration key(s): ${unknown.join(', ')}`);
    return input;
  }

  const migrated = {};
  const paths = {};
  const campaign = {};
  const analysis = {};
  const pathMap = {
    SavePath: 'savePath', WorkDir: 'workDir', TemplatesPath: 'templatesPath',
    templatesPath: 'templatesPath',
    CsvSubDir: 'csvSubDir', ShipInfoSubDir: 'shipInfoSubDir',
    AgainSaveSubDir: 'againSaveSubDir', SummarySubDir: 'summarySubDir',
    SnippetPackSubDir: 'snippetPackSubDir'
  };

  for (const [legacyKey, nestedKey] of Object.entries(pathMap)) {
    if (Object.prototype.hasOwnProperty.call(input, legacyKey)) {
      warnLegacy(legacyKey);
      const value = input[legacyKey];
      paths[nestedKey] = value === '' && ['savePath', 'templatesPath'].includes(nestedKey)
        ? null
        : value;
    }
  }
  // The retired capability map used `version`/`description` metadata and a
  // lowercase `templatesPath`; those are migration inputs, not unknown keys.
  if (Object.keys(paths).length) migrated.paths = paths;

  if (Object.prototype.hasOwnProperty.call(input, 'defaultObserverFaction')) {
    warnLegacy('defaultObserverFaction');
    campaign.defaultObserverFactionName = input.defaultObserverFaction;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'powerScoreWeights')) {
    warnLegacy('powerScoreWeights');
    analysis.powerScore = { weights: input.powerScoreWeights };
  }
  if (Object.prototype.hasOwnProperty.call(input, 'intelligenceRules')) {
    warnLegacy('intelligenceRules');
    analysis.rules = input.intelligenceRules;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'effects')) {
    warnLegacy('effects');
    analysis.effects = input.effects;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'strategicProjects')) {
    warnLegacy('strategicProjects');
    analysis.strategicProjects = input.strategicProjects;
  }
  if (Object.keys(analysis).length) migrated.analysis = analysis;

  const unknown = Object.keys(input).filter(key => !LEGACY_KEYS.has(key));
  if (unknown.length) {
    throw new Error(`Unknown configuration key(s): ${unknown.join(', ')}`);
  }
  return migrated;
}

function applyEnvironment(config, env = process.env) {
  const set = (target, key, value) => {
    if (value !== undefined && value !== '') target[key] = value;
  };
  set(config.paths, 'savePath', env.TI_SAVE_PATH);
  set(config.paths, 'workDir', env.TI_WORK_DIR);
  set(config.paths, 'templatesPath', env.TI_TEMPLATES_DIR);
  set(config.campaign, 'key', env.SUPABASE_CAMPAIGN_KEY);
  set(config.campaign, 'name', env.SUPABASE_CAMPAIGN_NAME);
  if (envPresent(env.SUPABASE_OBSERVER_FACTION_ID)) {
    config.campaign.defaultObserverFactionId = parseIntegerEnv(
      env.SUPABASE_OBSERVER_FACTION_ID,
      'SUPABASE_OBSERVER_FACTION_ID',
      { min: 1 }
    );
  }
  set(config.server, 'host', env.HOST);
  if (envPresent(env.PORT)) {
    config.server.port = parseIntegerEnv(env.PORT, 'PORT', { min: 1, max: 65535 });
  }
  if (envPresent(env.PUBLISH_TIMEOUT_MS)) {
    config.server.publishTimeoutMs = parseIntegerEnv(env.PUBLISH_TIMEOUT_MS, 'PUBLISH_TIMEOUT_MS', { min: 1000 });
  }
  if (env.TI_DEFAULT_MODE) config.server.defaultMode = env.TI_DEFAULT_MODE;
  // SUPABASE_HISTORY_RETENTION is deliberately NOT applied here. It used to be
  // mapped twice -- once here with a truthiness gate and again in
  // synchronizeHistoryRetention with a presence gate -- and the two spellings
  // disagreed on 0 and on a numeric-zero env value. synchronizeHistoryRetention
  // runs after CLI overrides are merged and is now the only path.
  if (envPresent(env.SUPABASE_FULL_SNAPSHOT_RETENTION)) {
    config.publishing.fullSnapshotRetention = parseIntegerEnv(
      env.SUPABASE_FULL_SNAPSHOT_RETENTION,
      'SUPABASE_FULL_SNAPSHOT_RETENTION',
      { min: 1, max: 100 }
    );
  }
  return config;
}

function configuredHistoryRetention(source) {
  if (!source || typeof source !== 'object') return undefined;
  // The strategic-history setting is canonical. publishing.historyRetention
  // remains a compatibility alias for older config files and scripts.
  return source.analysis?.strategicHistory?.retention
    ?? source.publishing?.historyRetention;
}

function synchronizeHistoryRetention(config, { userConfig, cliOverrides, env } = {}) {
  // The single mapping for SUPABASE_HISTORY_RETENTION. Precedence is
  // environment > CLI override > user config; the two aliases below are then
  // written from one resolved value so they can never disagree.
  const environmentRetention = envPresent(env?.SUPABASE_HISTORY_RETENTION)
    ? parseIntegerEnv(env.SUPABASE_HISTORY_RETENTION, 'SUPABASE_HISTORY_RETENTION', { min: 1, max: 1000 })
    : undefined;
  const retention = environmentRetention
    ?? configuredHistoryRetention(cliOverrides)
    ?? configuredHistoryRetention(userConfig);
  if (retention !== undefined) {
    config.publishing.historyRetention = retention;
    config.analysis.strategicHistory.retention = retention;
  }
  return config;
}

function validate(config) {
  const schema = readJson(SCHEMA_PATH, 'configuration schema');
  // strictRequired is disabled specifically, not strict mode as a whole.
  // The schema uses `oneOf: [{required:['defaultProject']}, {required:
  // ['defaultTech']}]` to mean "exactly one of these", which is valid and
  // is what the effect map actually needs. strictRequired rejects it only
  // because the branch subschemas do not redeclare `properties`, which they
  // have no reason to -- the parent already does.
  const ajv = new Ajv({ allErrors: true, strict: true, strictRequired: false });
  const check = ajv.compile(schema);
  if (!check(config)) {
    const details = (check.errors || []).map(error => {
      const location = error.instancePath || '$';
      return `${location}: ${error.message}`;
    }).join('; ');
    throw new Error(`Configuration validation failed: ${details}`);
  }
  return config;
}

function resolveConfig({ configPath = DEFAULT_CONFIG_PATH, env = process.env, cliOverrides = {}, validateConfig = true } = {}) {
  const defaults = readJson(DEFAULTS_PATH, 'configuration defaults');
  const userConfig = readJson(configPath, 'user configuration');
  const migrated = migrateLegacyConfig(userConfig);
  const resolved = merge(clone(defaults), migrated);

  // A fully nested config file is accepted too. It is merged after migration;
  // this also lets callers pass the old intelligence-capabilities file while
  // migrating it into the new central shape.
  if (userConfig?.schemaVersion === 1) merge(resolved, userConfig);
  applyEnvironment(resolved, env);
  merge(resolved, cliOverrides);
  synchronizeHistoryRetention(resolved, { userConfig, cliOverrides, env });
  if (validateConfig) validate(resolved);
  return resolved;
}

/**
 * Resolves the public Supabase read key with explicit precedence.
 *
 * CLAUDE.md documents SUPABASE_PUBLISHABLE_KEY as the supported name.
 * SUPABASE_ANON_KEY names the same public anon key and is still honoured, but
 * it is deprecated and now reported once per process through the same
 * TI_CONFIG_DEPRECATED channel the legacy config.json keys use.
 *
 * This deliberately never touches SUPABASE_SERVICE_ROLE_KEY: that key is local
 * only, is read directly by the publisher, and must never reach a resolution
 * path shared with browser or worker code. Only the variable name is ever
 * emitted -- the key value is never logged.
 */
function resolvePublishableKey(env = process.env) {
  const resolved = resolveSupabaseReadKey(env);
  if (resolved.deprecated && !warnedLegacyKeys.has('SUPABASE_ANON_KEY')) {
    warnedLegacyKeys.add('SUPABASE_ANON_KEY');
    process.emitWarning(
      'Environment variable SUPABASE_ANON_KEY is deprecated; rename it to SUPABASE_PUBLISHABLE_KEY. ' +
      'Both name the same public anon key, and SUPABASE_PUBLISHABLE_KEY wins when both are set.',
      { code: 'TI_CONFIG_DEPRECATED' }
    );
  }
  return resolved;
}

function safeRuntimeConfig(config = resolveConfig()) {
  return {
    campaignKey: config.campaign.key,
    campaignName: config.campaign.name,
    defaultObserverFactionId: config.campaign.defaultObserverFactionId,
    defaultObserverFactionName: config.campaign.defaultObserverFactionName,
    defaultMode: config.server.defaultMode,
    supportedModes: [...config.publishing.observerModes]
  };
}

module.exports = {
  PROJECT_ROOT,
  DEFAULTS_PATH,
  SCHEMA_PATH,
  DEFAULT_CONFIG_PATH,
  LEGACY_KEYS,
  readJson,
  migrateLegacyConfig,
  resolveConfig,
  synchronizeHistoryRetention,
  safeRuntimeConfig,
  parseIntegerEnv,
  envPresent,
  resolvePublishableKey,
  validate
};
