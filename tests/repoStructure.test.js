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
//
// THE PROPERTY IS "NOT TRACKED", NOT "NOT ON DISK".
//
// The first cut of this file asserted `fs.existsSync(oldPath) === false` and was
// wrong. A move guarantees that no *tracked* file remains at the old path; it
// says nothing about untracked local output. The tool writes 45-odd generated
// CSVs into csv/ and dated summaries into Again_Save/, .gitignore has always
// covered them, and they stay wherever the user last ran the tool from. Measured
// on the main checkout after the move: csv/ held 45 entries, 0 tracked; the
// tracked README had moved correctly. So the existsSync form failed on every
// checkout that had ever run the tool -- with no defect behind it -- and the
// only way to green it was to delete the user's untracked data, which is not
// ours to remove.
//
// `git ls-files` is therefore the instrument throughout: it reads the index, so
// it answers "is this tracked here" and ignores local output entirely. A run
// where git cannot answer FAILS rather than passing vacuously -- an
// unevaluatable check must say so, not fall through to "fine".

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

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

// Files created 2025-11-22 that must no longer be TRACKED at the repository
// root. An untracked stray of the same name is a local artefact, not a
// regression, and is deliberately not asserted on.
const TOOL_FILES = [
  'ti_data_tools.ps1', 'export_factions.ps1', 'export_factions.py',
  'Get-UnlockedShipComponents.ps1', 'generate_hab_module_tables.ps1',
  'generate_ship_components_tables.ps1', 'summarize_boost_income.ps1',
  'set_resistance_ship_build_times.ps1', 'TI_DATA_DEV.md', 'TI_DATA_TOOLS.md',
  'summary_prompt_examples.md', 'template.config'
];

/**
 * Files git tracks under `pathspec`, relative to the repository root.
 *
 * Reads the index, so untracked local output -- the tool's generated CSVs and
 * dated summaries -- is invisible to it, which is the whole point. A git that
 * cannot answer throws: this check must never silently degrade into a pass.
 */
function trackedUnder(pathspec) {
  const probe = spawnSync('git', ['ls-files', '-z', '--', pathspec], {
    cwd: ROOT,
    encoding: 'utf8'
  });
  if (probe.error) throw new Error(`git ls-files could not run: ${probe.error.message}`);
  if (probe.status !== 0) {
    throw new Error(`git ls-files '${pathspec}' exited ${probe.status}: ${probe.stderr.trim()}`);
  }
  return probe.stdout.split('\0').filter(Boolean);
}

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, out);
    else if (['.js', '.mjs'].includes(path.extname(name))) out.push(full);
  }
  return out;
}

test('the tracked-file probe can actually answer', () => {
  // Guards the guard. Every assertion below is "git reports nothing here", and
  // a broken probe reports nothing too. This pins one path that must be
  // non-empty, so a git that cannot run fails loudly instead of greening the
  // whole file.
  assert.ok(
    trackedUnder('server').length > 0,
    'git ls-files reported no tracked files under server/ -- the probe is broken, not the tree'
  );
});

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
    assert.deepEqual(trackedUnder(rel), [rel], `${rel} must stay tracked at the repository root`);
    assert.equal(fs.existsSync(path.join(ROOT, rel)), true, `${rel} must be present on disk to be loadable`);
  }
  assert.deepEqual(
    trackedUnder(`${TOOL_DIR}/TerraInvicta.Common.psm1`),
    [],
    'the shared module must not be duplicated into the tool directory'
  );
});

test('every moved tool script anchors the shared module and config on its parent', () => {
  for (const script of TOOL_SCRIPTS_IMPORTING_COMMON) {
    const rel = `${TOOL_DIR}/${script}`;
    assert.deepEqual(trackedUnder(rel), [rel], `${rel} is not tracked where it should be`);
    const src = fs.readFileSync(path.join(ROOT, TOOL_DIR, script), 'utf8');

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

test('the Python exporter tolerates a missing config.json and reads nested keys', () => {
  // THIS IS A SOURCE SCAN, DELIBERATELY, and it is worth saying why rather than
  // leaving a reader to assume it is laziness. Executing the script needs a
  // Python interpreter, which this repo's toolchain does not require and which
  // is not present on the machine this runs on -- so an executing test would be
  // permanently skipped here and could never be verified by mutation. The
  // scan pins the three properties the fix is about and each one was confirmed
  // red by restoring the old spelling.
  const src = fs.readFileSync(path.join(ROOT, TOOL_DIR, 'export_factions.py'), 'utf8');

  // 1. config.json is gitignored, so its absence is an ordinary state. The
  //    unguarded `with CONFIG_PATH.open("r")` raised FileNotFoundError where
  //    every PowerShell sibling falls back to config/defaults.json.
  assert.match(src, /except\s+FileNotFoundError/,
    'a missing config.json must fall back, not raise');
  assert.match(src, /DEFAULTS_PATH\s*=\s*REPO_ROOT\s*\/\s*"config"\s*\/\s*"defaults\.json"/,
    'the fallback must be config/defaults.json, the same file Get-TIConfig uses');
  assert.doesNotMatch(src, /with\s+CONFIG_PATH\.open\(/,
    'CONFIG_PATH must not be opened unguarded');

  // 2. Reading only the flat legacy keys made a nested config silently produce
  //    the WRONG output directory instead of an error.
  for (const key of ['workDir', 'savePath', 'againSaveSubDir']) {
    assert.ok(src.includes(`"${key}"`), `the nested paths.${key} spelling must be read`);
  }
  assert.match(src, /cfg\.get\("paths"\)/,
    'the nested paths object must be consulted');

  // 3. An unresolved save path used to interpolate into the PowerShell command
  //    as the literal string 'None'.
  assert.match(src, /if\s+not\s+SAVE_PATH:[\s\S]{0,400}?raise\s+SystemExit/,
    'an unconfigured save path must be refused with a named error');
});

test('no 2025 tool file is tracked at the repository root', () => {
  const stragglers = TOOL_FILES.filter(name => trackedUnder(name).length > 0);
  assert.deepEqual(stragglers, [], `these belong in ${TOOL_DIR}/`);
  // ...and each one is tracked at its new home, so this cannot pass by the file
  // simply having been deleted.
  const missing = TOOL_FILES.filter(name => trackedUnder(`${TOOL_DIR}/${name}`).length === 0);
  assert.deepEqual(missing, [], `these should be tracked under ${TOOL_DIR}/`);
});

test('the tool keeps its tracked output directories beside its scripts', () => {
  // config/defaults.json leaves paths.csvSubDir / shipInfoSubDir /
  // againSaveSubDir relative, and the scripts resolve them against their own
  // directory. If the TRACKED content were left at the root those defaults
  // would point at the wrong tree.
  //
  // Untracked generated output at the old root is NOT asserted on: csv/ and
  // Again_Save/ accumulate local CSVs and dated summaries that .gitignore
  // already covers, and they legitimately survive the move on any checkout that
  // has run the tool.
  const defaults = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'defaults.json'), 'utf8'));
  for (const key of ['csvSubDir', 'shipInfoSubDir', 'againSaveSubDir']) {
    const sub = defaults.paths[key];
    assert.equal(typeof sub, 'string', `paths.${key} must be a relative sub-directory`);
    assert.ok(sub.length > 0, `paths.${key} must not be empty`);

    assert.ok(
      trackedUnder(`${TOOL_DIR}/${sub}`).length > 0,
      `paths.${key} = '${sub}' has no tracked content under ${TOOL_DIR}/`
    );
    assert.deepEqual(
      trackedUnder(sub),
      [],
      `paths.${key} = '${sub}' still has tracked content at the repository root`
    );
  }
});
