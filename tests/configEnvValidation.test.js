const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');

const config = require('../server/config');
const { parseArgs } = require('../scripts/push_latest_to_supabase');
const { DEFAULT_OBSERVER_FACTION_ID } = require('../shared/constants.mjs');
const defaults = config.readJson(config.DEFAULTS_PATH, 'configuration defaults');

// A path that deliberately does not exist, so every case below resolves purely
// from config/defaults.json plus the injected environment.
const NO_USER_CONFIG = path.join(os.tmpdir(), 'ti-config-does-not-exist.json');
const resolve = (env) => config.resolveConfig({ configPath: NO_USER_CONFIG, env });

test('a malformed observer faction id is rejected at load time, not coerced to NaN', () => {
  for (const bad of ['abc', '4712x', '47.12', '0', '-1', ' ']) {
    assert.throws(
      () => resolve({ SUPABASE_OBSERVER_FACTION_ID: bad }),
      /SUPABASE_OBSERVER_FACTION_ID/,
      `expected '${bad}' to be rejected`
    );
  }
  // Absent still means "use the configured default"; present-and-valid wins.
  assert.equal(resolve({}).campaign.defaultObserverFactionId, DEFAULT_OBSERVER_FACTION_ID);
  assert.equal(resolve({ SUPABASE_OBSERVER_FACTION_ID: '' }).campaign.defaultObserverFactionId, DEFAULT_OBSERVER_FACTION_ID);
  assert.equal(resolve({ SUPABASE_OBSERVER_FACTION_ID: '4713' }).campaign.defaultObserverFactionId, 4713);
});

test('the observer default is read from shared constants, not duplicated', () => {
  assert.equal(defaults.campaign.defaultObserverFactionId, DEFAULT_OBSERVER_FACTION_ID);
});

test('malformed retention values are rejected instead of silently pruning a different count', () => {
  for (const bad of ['abc', '0', '-3', '2.5']) {
    assert.throws(() => resolve({ SUPABASE_HISTORY_RETENTION: bad }), /SUPABASE_HISTORY_RETENTION/);
    assert.throws(() => resolve({ SUPABASE_FULL_SNAPSHOT_RETENTION: bad }), /SUPABASE_FULL_SNAPSHOT_RETENTION/);
  }
  assert.throws(() => resolve({ SUPABASE_FULL_SNAPSHOT_RETENTION: '101' }), /SUPABASE_FULL_SNAPSHOT_RETENTION/);
});

test('history retention has exactly one mapping, so 0 cannot mean two things', () => {
  // The env used to be mapped twice: once with a truthiness gate and once with
  // a presence gate. A string '0' and a numeric 0 took different branches.
  assert.throws(() => resolve({ SUPABASE_HISTORY_RETENTION: '0' }), /SUPABASE_HISTORY_RETENTION/);
  assert.throws(() => resolve({ SUPABASE_HISTORY_RETENTION: 0 }), /SUPABASE_HISTORY_RETENTION/);

  const resolved = resolve({ SUPABASE_HISTORY_RETENTION: '12' });
  assert.equal(resolved.publishing.historyRetention, 12);
  assert.equal(resolved.analysis.strategicHistory.retention, 12);

  // Environment still outranks a CLI override, and both aliases still agree.
  const withCli = config.resolveConfig({
    configPath: NO_USER_CONFIG,
    env: { SUPABASE_HISTORY_RETENTION: '12' },
    cliOverrides: { publishing: { historyRetention: 14 } }
  });
  assert.equal(withCli.publishing.historyRetention, 12);
  assert.equal(withCli.analysis.strategicHistory.retention, 12);
});

test('PORT and PUBLISH_TIMEOUT_MS are validated by name', () => {
  assert.throws(() => resolve({ PORT: 'not-a-port' }), /PORT='not-a-port'/);
  assert.throws(() => resolve({ PORT: '70000' }), /PORT='70000'/);
  assert.throws(() => resolve({ PUBLISH_TIMEOUT_MS: '10' }), /PUBLISH_TIMEOUT_MS/);
  assert.equal(resolve({ PORT: '8080' }).server.port, 8080);
});

test('parseIntegerEnv keeps absent and malformed distinguishable', () => {
  assert.equal(config.envPresent(undefined), false);
  assert.equal(config.envPresent(null), false);
  assert.equal(config.envPresent(''), false, 'an empty value spells "not configured"');
  assert.equal(config.envPresent('   '), true, 'whitespace is a value that cannot be evaluated, not an absence');
  assert.equal(config.envPresent('0'), true);
  assert.equal(config.envPresent(0), true);
  assert.equal(config.parseIntegerEnv('7', 'X'), 7);
  assert.throws(() => config.parseIntegerEnv('7x', 'X'), /X='7x'/);
});

test('the publisher reads its retention defaults from config, not from an inline literal', () => {
  const options = parseArgs([], {});
  assert.equal(options.fullSnapshotRetention, defaults.publishing.fullSnapshotRetention);
  assert.equal(options.historyRetention, defaults.analysis.strategicHistory.retention);
  assert.equal(options.observerFactionId, defaults.campaign.defaultObserverFactionId);
});

test('the publisher rejects malformed retention env vars instead of falling back', () => {
  assert.throws(() => parseArgs([], { SUPABASE_FULL_SNAPSHOT_RETENTION: 'three' }), /SUPABASE_FULL_SNAPSHOT_RETENTION/);
  assert.throws(() => parseArgs([], { SUPABASE_HISTORY_RETENTION: '20x' }), /SUPABASE_HISTORY_RETENTION/);
  assert.throws(() => parseArgs([], { SUPABASE_OBSERVER_FACTION_ID: '4712abc' }), /SUPABASE_OBSERVER_FACTION_ID/);

  // Valid overrides still take effect, and explicit flags still win.
  assert.equal(parseArgs([], { SUPABASE_FULL_SNAPSHOT_RETENTION: '9' }).fullSnapshotRetention, 9);
  assert.equal(parseArgs(['--full-snapshot-retention', '5'], { SUPABASE_FULL_SNAPSHOT_RETENTION: '9' }).fullSnapshotRetention, 5);
  assert.equal(parseArgs([], { SUPABASE_OBSERVER_FACTION_ID: '4713' }).observerFactionId, 4713);
});

test('the Supabase adapter validates a supplied observer instead of coercing it', () => {
  const SupabaseAdapter = require('../server/supabaseAdapter');
  const { requireOptionalInteger } = SupabaseAdapter;

  assert.equal(requireOptionalInteger(null, 'observer'), null, 'absent stays null');
  assert.equal(requireOptionalInteger(undefined, 'observer'), null);
  assert.equal(requireOptionalInteger('', 'observer'), null);
  assert.equal(requireOptionalInteger('4713', 'observer'), 4713);
  assert.throws(() => requireOptionalInteger('4713x', 'observer'), /Invalid observer/);
  assert.throws(() => requireOptionalInteger('abc', 'observer'), /Invalid observer/);
  assert.throws(() => requireOptionalInteger('0', 'observer'), /Invalid observer/);

  // An adapter constructed with no override still uses the configured default.
  const adapter = new SupabaseAdapter({ campaignKey: 'initiative' });
  assert.equal(adapter.defaultObserverFactionId, DEFAULT_OBSERVER_FACTION_ID);
  assert.throws(() => new SupabaseAdapter({ observerFactionId: 'nope' }), /Invalid observer faction id/);
});

test('the adapter never resolves the service role key', () => {
  const resolved = config.resolvePublishableKey({
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
    SUPABASE_PUBLISHABLE_KEY: 'publishable'
  });
  assert.equal(resolved.key, 'publishable');
  assert.equal(resolved.source, 'SUPABASE_PUBLISHABLE_KEY');
  assert.equal(config.resolvePublishableKey({ SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret' }).key, null);
});
