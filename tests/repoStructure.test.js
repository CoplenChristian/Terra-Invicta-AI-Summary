// tests/repoStructure.test.js
//
// Purpose: pin the boundary between the dashboard and the 2025 report tool in
//   md-generation-reports/, and the one dependency that crosses it.
//
// The move (docs/archive/repo-structure-spec.md) relocated the 2025-11-22
// PowerShell/Python suite out of the repository root. Two things about that are
// load-bearing and neither is enforced by anything else:
//
//   1. The dashboard must not start reading out of md-generation-reports/. The
//      directory is a separate application; a require() or import into it would
//      make the dashboard depend on a tool nobody runs.
//   2. The tool must keep resolving TerraInvicta.Common.psm1 and config/ from
//      its PARENT. Those are shared repository infrastructure -- the module is
//      also imported by the five root parse_*.ps1 parsers and covered by
//      tests/powershell_common.test.js -- so they did not move with the tool.
//      Every moved script therefore anchors on $repoRoot. Pasting back the old
//      `Join-Path $scriptPath "TerraInvicta.Common.psm1"` silently breaks all
//      seven scripts at once, and nothing else in the suite would notice.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TOOL_DIR = 'md-generation-reports';

// The roots the dashboard actually runs out of. docs/code-index.md covers the
// first five; tests/ is included because a test reading the tool's fixtures
// would couple them just as tightly.
const DASHBOARD_ROOTS = ['server', 'shared', 'site', 'public', 'scripts', 'tests'];

// The scripts that import the shared PowerShell module. Listed explicitly rather
// than globbed so that deleting one is a visible test failure, not a silently
// smaller assertion.
const TOOL_SCRIPTS_IMPORTING_COMMON = [
  'ti_data_tools.ps1',
  'export_factions.ps1',
  'Get-UnlockedShipComponents.ps1',
  'generate_hab_module_tables.ps1',
  'generate_ship_components_tables.ps1',
  'summarize_boost_income.ps1',
  'set_resistance_ship_build_times.ps1'
];

// Files created 2025-11-22 that must not reappear at the repository root.
const TOOL_FILES = [
  'ti_data_tools.ps1', 'export_factions.ps1', 'export_factions.py',
  'Get-UnlockedShipComponents.ps1', 'generate_hab_module_tables.ps1',
  'generate_ship_components_tables.ps1', 'summarize_boost_income.ps1',
  'set_resistance_ship_build_times.ps1', 'TI_DATA_DEV.md', 'TI_DATA_TOOLS.md',
  'summary_prompt_examples.md', 'template.config'
];

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, out);
    else if (['.js', '.mjs'].includes(path.extname(name))) out.push(full);
  }
  return out;
}

test('no dashboard module resolves a path into md-generation-reports', () => {
  // Matches the module-resolution forms only. A prose comment naming the
  // directory is fine and there is one: server/templateLoader.js cites
  // md-generation-reports/Ship_Info/raw_json as a directory it deliberately
  // REJECTS as a templates path. Asserting on comments would fail on that
  // correct citation, so this pins what the runtime does instead.
  const resolution = new RegExp(
    String.raw`(?:require|import|from|readFileSync|readdirSync|existsSync|join|resolve)\s*\([^)]*['"\`][^'"\`]*` +
    TOOL_DIR,
    'i'
  );
  const offenders = [];
  for (const root of DASHBOARD_ROOTS) {
    const dir = path.join(ROOT, root);
    if (!fs.existsSync(dir)) continue;
    for (const file of walk(dir)) {
      if (path.resolve(file) === path.resolve(__filename)) continue;
      if (resolution.test(fs.readFileSync(file, 'utf8'))) {
        offenders.push(path.relative(ROOT, file).split(path.sep).join('/'));
      }
    }
  }
  assert.deepEqual(offenders, [], `the dashboard must not read out of ${TOOL_DIR}/`);
});

test('the shared PowerShell module and config stay at the repository root', () => {
  // tests/powershell_common.test.js resolves the module at the root, and the
  // five parse_*.ps1 parsers Join-Path it against their own directory, which IS
  // the root. Moving it into the tool would break both.
  for (const rel of ['TerraInvicta.Common.psm1', 'config/defaults.json', 'config/config.schema.json']) {
    assert.equal(fs.existsSync(path.join(ROOT, rel)), true, `${rel} must stay at the repository root`);
  }
  assert.equal(
    fs.existsSync(path.join(ROOT, TOOL_DIR, 'TerraInvicta.Common.psm1')),
    false,
    'the shared module must not be duplicated into the tool directory'
  );
});

test('every moved tool script anchors the shared module and config on its parent', () => {
  for (const script of TOOL_SCRIPTS_IMPORTING_COMMON) {
    const file = path.join(ROOT, TOOL_DIR, script);
    assert.equal(fs.existsSync(file), true, `${TOOL_DIR}/${script} is missing`);
    const src = fs.readFileSync(file, 'utf8');

    assert.match(
      src,
      /\$repoRoot\s*=\s*Split-Path\s+-Parent\s+\$scriptPath/,
      `${script} must derive $repoRoot from its own directory`
    );
    assert.match(
      src,
      /Join-Path\s+\$repoRoot\s+['"]TerraInvicta\.Common\.psm1['"]/,
      `${script} must import the shared module from $repoRoot`
    );
    assert.match(
      src,
      /Get-TIConfig\s+-BasePath\s+\$repoRoot/,
      `${script} must resolve config/ from $repoRoot`
    );
    // The regression this file exists to catch: the pre-move spelling.
    assert.doesNotMatch(
      src,
      /Join-Path\s+\$scriptPath\s+['"]TerraInvicta\.Common\.psm1['"]/,
      `${script} still resolves the shared module against its own directory`
    );
    assert.doesNotMatch(
      src,
      /Get-TIConfig\s+-BasePath\s+\$scriptPath/,
      `${script} still resolves config/ against its own directory`
    );
  }
});

test('the Python exporter reads config.json from the repository root', () => {
  const src = fs.readFileSync(path.join(ROOT, TOOL_DIR, 'export_factions.py'), 'utf8');
  assert.match(src, /REPO_ROOT\s*=\s*ROOT\.parent/);
  assert.match(src, /CONFIG_PATH\s*=\s*REPO_ROOT\s*\/\s*"config\.json"/);
});

test('no 2025 tool file remains at the repository root', () => {
  const stragglers = TOOL_FILES.filter(name => fs.existsSync(path.join(ROOT, name)));
  assert.deepEqual(stragglers, [], 'these belong in md-generation-reports/');
});

test('the tool keeps its output directories beside its scripts', () => {
  // config/defaults.json leaves paths.csvSubDir / shipInfoSubDir /
  // againSaveSubDir relative, and the scripts resolve them against their own
  // directory. If the directories were left at the root those defaults would
  // point at nothing.
  const defaults = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'defaults.json'), 'utf8'));
  for (const key of ['csvSubDir', 'shipInfoSubDir', 'againSaveSubDir']) {
    const sub = defaults.paths[key];
    assert.equal(typeof sub, 'string', `paths.${key} must be a relative sub-directory`);
    assert.equal(
      fs.existsSync(path.join(ROOT, TOOL_DIR, sub)),
      true,
      `paths.${key} = '${sub}' does not resolve under ${TOOL_DIR}/`
    );
    assert.equal(
      fs.existsSync(path.join(ROOT, sub)),
      false,
      `paths.${key} = '${sub}' still exists at the repository root`
    );
  }
});
