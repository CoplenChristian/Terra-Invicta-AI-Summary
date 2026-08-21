const fs = require('fs');
const path = require('path');
// config.schema.json declares $schema draft 2020-12. Ajv's default export is
// the draft-07 build and does not carry that meta-schema, so compiling the
// schema throws "no schema with key or ref .../2020-12/schema" at require
// time -- which took down the server and three test files. The 2020 build
// is the one that knows it.
const Ajv = require('ajv/dist/2020');

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
  if (env.SUPABASE_OBSERVER_FACTION_ID !== undefined && env.SUPABASE_OBSERVER_FACTION_ID !== '') {
    config.campaign.defaultObserverFactionId = Number(env.SUPABASE_OBSERVER_FACTION_ID);
  }
  set(config.server, 'host', env.HOST);
  if (env.PORT) config.server.port = Number(env.PORT);
  if (env.PUBLISH_TIMEOUT_MS) config.server.publishTimeoutMs = Number(env.PUBLISH_TIMEOUT_MS);
  if (env.TI_DEFAULT_MODE) config.server.defaultMode = env.TI_DEFAULT_MODE;
  if (env.SUPABASE_HISTORY_RETENTION) {
    const retention = Number(env.SUPABASE_HISTORY_RETENTION);
    config.publishing.historyRetention = retention;
    config.analysis.strategicHistory.retention = retention;
  }
  if (env.SUPABASE_FULL_SNAPSHOT_RETENTION) config.publishing.fullSnapshotRetention = Number(env.SUPABASE_FULL_SNAPSHOT_RETENTION);
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
  const environmentRetention = env?.SUPABASE_HISTORY_RETENTION !== undefined && env.SUPABASE_HISTORY_RETENTION !== ''
    ? Number(env.SUPABASE_HISTORY_RETENTION)
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
  validate
};
