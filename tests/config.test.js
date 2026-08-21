const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const config = require('../server/config');
const SaveParser = require('../server/saveParser').constructor;

function tempJson(value) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ti-config-'));
  const file = path.join(folder, 'config.json');
  fs.writeFileSync(file, JSON.stringify(value), 'utf8');
  return { folder, file };
}

test('central defaults validate and expose only safe runtime settings', () => {
  const resolved = config.resolveConfig({ configPath: path.join(os.tmpdir(), 'ti-config-does-not-exist.json'), env: {} });
  assert.equal(resolved.schemaVersion, 1);
  assert.equal(resolved.analysis.powerScore.normalizers.gdp, 40000000000000);
  assert.equal(resolved.analysis.directiveWeights.defense.gdpDensityPoints, 0.2);
  const runtime = config.safeRuntimeConfig(resolved);
  assert.equal(runtime.defaultObserverFactionId, 4712);
  assert.equal(Object.hasOwn(runtime, 'savePath'), false);
  assert.equal(Object.hasOwn(runtime, 'serviceRoleKey'), false);
});

test('legacy flat config is migrated in memory and keeps defaults', () => {
  const { file } = tempJson({ SavePath: 'C:/saves', WorkDir: '.', CsvSubDir: 'exports' });
  const resolved = config.resolveConfig({ configPath: file, env: {} });
  assert.equal(resolved.paths.savePath, 'C:/saves');
  assert.equal(resolved.paths.csvSubDir, 'exports');
  assert.equal(resolved.analysis.directiveWeights.topNCouncilTargets, 3);
});

test('unknown configuration keys fail with an actionable error', () => {
  const { file } = tempJson({ paths: { savePath: null }, typoedSection: {} });
  assert.throws(() => config.resolveConfig({ configPath: file, env: {} }), /Unknown configuration key/);
});

test('invalid environment overrides fail schema validation', () => {
  assert.throws(() => config.resolveConfig({ configPath: path.join(os.tmpdir(), 'ti-config-does-not-exist.json'), env: { PORT: 'not-a-port' } }), /Configuration validation failed/);
});

test('the retired intelligence-capabilities shape migrates without importing its metadata', () => {
  const { file } = tempJson({
    version: '1.0.0',
    description: 'retired capability map',
    templatesPath: 'C:/TerraInvicta/Templates',
    defaultObserverFaction: 'the Initiative',
    effects: {
      Effect_CustomProbe: {
        capability: 'customProbe',
        category: 'test',
        description: 'custom test capability',
        defaultProject: 'Project_CustomProbe'
      }
    },
    strategicProjects: [{ id: 'Project_CustomProbe', name: 'Custom Probe' }]
  });
  const resolved = config.resolveConfig({ configPath: file, env: {} });
  assert.equal(resolved.paths.templatesPath, 'C:/TerraInvicta/Templates');
  assert.equal(resolved.analysis.effects.Effect_CustomProbe.capability, 'customProbe');
  assert.equal(resolved.analysis.strategicProjects[0].id, 'Project_CustomProbe');
});

test('configurable sections reject misspelled tuning keys', () => {
  const { file } = tempJson({
    analysis: { directiveWeights: { toppNCouncilTargets: 3 } }
  });
  assert.throws(() => config.resolveConfig({ configPath: file, env: {} }), /Configuration validation failed/);
});

test('strategic history retention uses one canonical value across compatibility aliases', () => {
  const { file } = tempJson({
    publishing: { historyRetention: 7 },
    analysis: { strategicHistory: { retention: 31 } }
  });
  const resolved = config.resolveConfig({ configPath: file, env: {} });
  assert.equal(resolved.analysis.strategicHistory.retention, 31);
  assert.equal(resolved.publishing.historyRetention, 31);

  const aliasOnly = tempJson({ publishing: { historyRetention: 9 } });
  const aliasResolved = config.resolveConfig({ configPath: aliasOnly.file, env: {} });
  assert.equal(aliasResolved.analysis.strategicHistory.retention, 9);
  assert.equal(aliasResolved.publishing.historyRetention, 9);

  const envResolved = config.resolveConfig({
    configPath: file,
    env: { SUPABASE_HISTORY_RETENTION: '12' }
  });
  assert.equal(envResolved.analysis.strategicHistory.retention, 12);
  assert.equal(envResolved.publishing.historyRetention, 12);

  const cliResolved = config.resolveConfig({
    configPath: file,
    env: {},
    cliOverrides: { publishing: { historyRetention: 14 } }
  });
  assert.equal(cliResolved.analysis.strategicHistory.retention, 14);
  assert.equal(cliResolved.publishing.historyRetention, 14);
});

test('save parser reports missing configured paths instead of probing developer folders', () => {
  const parser = new SaveParser({
    schemaVersion: 1,
    paths: { savePath: null },
    campaign: { key: 'initiative', name: 'Initiative', defaultObserverFactionId: 4712, defaultObserverFactionName: 'the Initiative' },
    server: { host: '127.0.0.1', port: 3000, publishTimeoutMs: 120000, defaultMode: 'player' },
    publishing: { historyRetention: 20, fullSnapshotRetention: 3, observerModes: ['player'], otherFactionModes: [], shareTechGraph: true },
    analysis: { effects: {}, strategicProjects: [], rules: {}, powerScore: { weights: {}, normalizers: {} }, opportunityScoring: {}, miningScarcityWeights: {}, directiveWeights: {}, strategicHistory: {} }
  });
  assert.throws(() => parser.resolveSaveFolder(), /No save path configured/);
});
