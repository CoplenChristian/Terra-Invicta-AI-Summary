// Guard: unit tests must not read the live save folder.
//
// CLAUDE.md promises `npm test` "reads committed fixtures, not the live save
// folder. Must pass identically with the game running." This file enforces
// that promise as BEHAVIOUR, not spelling.
//
// Two mechanisms, both running the unit suite itself under a save folder that
// is not there:
//
//   1. The missing-folder run. The configured save path (TI_SAVE_PATH) is
//      pointed at a directory that does not exist and the whole suite is
//      re-run. Anything that truly reads only committed fixtures is
//      unaffected; anything that reaches for the newest save fails loudly --
//      the server 500s with "Configured save folder not found", the test
//      fails, and this file names the failing test file. The old guard scanned
//      test-file source for three literal patterns and so could not see a read
//      reached through a server or a helper (the registered defect #26:
//      `tests/missionControlLayout.test.js` requires `server/index.js` and
//      passed the scan).
//
//   2. The fs watch. While the missing-folder run is executing,
//      tests/fixtures/liveSaveWatchHook.js (installed via NODE_OPTIONS) fails
//      any process that touches the REAL configured save folder -- code that
//      does not respect the TI_SAVE_PATH override and resolves the real
//      folder itself. This catches reads the missing-folder run cannot see:
//      a test that reads the live folder and tolerates the absence of data.
//      If the real folder cannot be resolved (no config), the watch is not
//      armed and this file says so rather than claiming coverage it does not
//      have.
//
// The guarded run is spawned as `node scripts/run_unit_tests.js` with
// TI_GUARDED_UNIT_RUN=1. The runner skips its own guard pass under that
// marker, so the guarded run runs the suite exactly once. The guard file
// itself lives in the runner's `guard` bucket (tests/fixtures/unitTestPasses.js),
// never inside a pass: a file that spawns the whole suite cannot sit inside
// the suite without doubling the Chromium count mid-run.

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const RUNNER = path.join(REPO_ROOT, 'scripts', 'run_unit_tests.js');
const HOOK = path.join(REPO_ROOT, 'tests', 'fixtures', 'liveSaveWatchHook.js');
const GUARDED_RUN_MARKER = 'TI_GUARDED_UNIT_RUN';

// A folder that must never exist during the guarded run. Namespaced under the
// OS temp dir so the guard can guarantee absence by deleting its own
// namespace; the real configured folder is never touched.
const GUARD_NAMESPACE = path.join(os.tmpdir(), 'ti-unit-suite-no-live-save');
const MISSING_SAVE_DIR = path.join(GUARD_NAMESPACE, 'missing-save-folder');

// Files KNOWN to fail the guarded run, pinned with a two-way ratchet the way
// tests/cssCustomProperties.test.js pins its unresolved references: the
// guarded run's failing set must equal this list EXACTLY. A new live-save
// reader grows the set and fails the guard; a pinned file that is fixed to
// fixtures shrinks the set and fails the guard until the pin is removed. An
// exclusion nobody revisits is how the original guard lost its teeth; this is
// the opposite of an exclusion -- the failing file is reported out loud every
// run, and the pin dies the moment it is no longer needed.
//
// tests/driveExplorer.test.js: its route test (line 571) drives the real
// server, which must answer /api/intel/drive-explorer with real per-design
// drive measurements. The committed fixtures are filtered snapshots the
// raw-save pipeline cannot serve, and the sparse synthetic save yields no
// designs (measured 2026-08-27). Fix = serve a save carrying ship designs
// with rated drive figures, then delete this entry.
const PINNED_GUARD_FAILURES = ['tests/driveExplorer.test.js'];

const FORBIDDEN = [
  { name: 'loadFilteredSnapshot', pattern: /\bloadFilteredSnapshot\b/ },
  { name: 'loadSnapshot() with no args', pattern: /\bloadSnapshot\s*\(\s*\)/ },
  { name: 'latest: true', pattern: /latest\s*:\s*true/ }
];

const EXCLUDED_REL = new Set([
  path.join('live'),
  'noLiveSaveInUnitSuite.test.js'
]);

function listUnitTestFiles(dir = __dirname, rel = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryRel = rel ? path.join(rel, entry.name) : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'live') continue;
      out.push(...listUnitTestFiles(full, entryRel));
      continue;
    }
    if (!entry.name.endsWith('.test.js')) continue;
    if (EXCLUDED_REL.has(entryRel) || EXCLUDED_REL.has(entry.name)) continue;
    out.push({ full, rel: entryRel.replace(/\\/g, '/') });
  }
  return out;
}

/**
 * The real configured save FOLDER (resolveSaveFolder semantics: a configured
 * filename resolves to its parent), read-only, or null when it cannot be
 * determined. Null means the fs watch cannot be armed and the guard says so.
 */
function resolveRealSaveFolder() {
  try {
    const { resolveConfig } = require(path.join(REPO_ROOT, 'server', 'config'));
    const configured = resolveConfig().paths?.savePath;
    if (!configured) return null;
    const resolved = path.resolve(configured);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) return resolved;
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return path.dirname(resolved);
    const folder = path.extname(resolved) ? path.dirname(resolved) : resolved;
    return fs.existsSync(folder) ? folder : null;
  } catch {
    return null;
  }
}

/** The failing test files named by one guarded run's output, deduplicated. */
function failingFilesFromOutput(output) {
  const files = [];
  for (const match of output.matchAll(/^test at (.*?\.test\.js):\d+:\d+/gm)) {
    // The child prints paths relative to its cwd (the repo root).
    files.push(path.resolve(REPO_ROOT, match[1]));
  }
  return [...new Set(files)].sort();
}

/**
 * The environment the guarded run's processes must see: the real environment
 * with TI_SAVE_PATH overridden, the fs-watch hook installed via NODE_OPTIONS,
 * and the recursion marker set. Crucially, the test runner's NODE_TEST_CONTEXT
 * marker is stripped: when this guard file runs under `node --test`, the
 * runner has marked the process with NODE_TEST_CONTEXT=child-v8, and a nested
 * `node --test` inheriting it thinks it is a test-file child and exits without
 * running anything (measured 2026-08-27). Any NODE_TEST_* marker is runner
 * bookkeeping, never a legitimate input to the suite itself.
 */
function guardedEnv(extra = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('NODE_TEST_')) continue;
    env[key] = value;
  }
  Object.assign(env, {
    TI_SAVE_PATH: MISSING_SAVE_DIR,
    [GUARDED_RUN_MARKER]: '1'
  }, extra);
  env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ''} --require=${HOOK.replace(/\\/g, '/')}`;
  return env;
}

/**
 * Spawn the whole unit suite with TI_SAVE_PATH pointed at a folder that does
 * not exist, plus the fs watch on the real folder. Returns the output.
 */
function runGuardedSuite() {
  // Guarantee the sentinel folder cannot exist: the whole namespace is ours.
  fs.rmSync(GUARD_NAMESPACE, { recursive: true, force: true });

  const realFolder = resolveRealSaveFolder();
  const env = guardedEnv(realFolder ? { TI_REAL_SAVE_FOLDER: realFolder } : {});

  const result = spawnSync(process.execPath, [RUNNER], {
    cwd: REPO_ROOT,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 15 * 60 * 1000
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  return { result, output, realFolder };
}

test('unit suite files do not call live save loaders', () => {
  const violations = [];
  for (const file of listUnitTestFiles()) {
    const text = fs.readFileSync(file.full, 'utf8');
    for (const rule of FORBIDDEN) {
      if (rule.pattern.test(text)) {
        violations.push(`${file.rel}: forbidden ${rule.name}`);
      }
    }
  }
  assert.deepStrictEqual(
    violations,
    [],
    `Unit tests must use loadFixtureFilteredSnapshot / queryFixtureIntel instead of live loaders:\n${violations.join('\n')}`
  );
});

test('the guard would fail on a probe file containing forbidden patterns', () => {
  const probe = `
    const { loadFilteredSnapshot, loadSnapshot } = require('../server/snapshotLoader');
    loadSnapshot();
    loadFilteredSnapshot({ latest: true, mode: 'player', observer: 4712 });
  `;
  const hits = FORBIDDEN.filter((rule) => rule.pattern.test(probe));
  assert.strictEqual(hits.length, FORBIDDEN.length,
    'probe must trip every forbidden pattern so the guard stays honest');
});

test('the unit suite passes with the configured save folder absent', () => {
  if (process.env[GUARDED_RUN_MARKER] === '1') {
    // Defensive: the guard file must never run inside the guarded run it
    // spawned (the runner's `guard` bucket keeps it out of the passes). If it
    // ever does, the outer guard instance is the one asserting.
    console.log('[noLiveSave] skipping: running inside the guarded run');
    return;
  }

  const { result, output, realFolder } = runGuardedSuite();

  const markers = (output.match(/^\[TI-LIVE-SAVE-READ\][^\n]*/gm) || []).slice(0, 10);
  const folderErrors = (output.match(/Configured save folder not found[^\n]*/g) || []).slice(0, 5);
  const failing = failingFilesFromOutput(output);

  const pinned = PINNED_GUARD_FAILURES.map((f) => path.resolve(REPO_ROOT, f)).sort();
  const unpinnedFailures = failing.filter((f) => !pinned.includes(f));

  const failureDetail = [];
  if (result.error) failureDetail.push(`spawn failed: ${result.error.message}`);
  else if (result.status === null) failureDetail.push(`guarded run terminated by signal (${result.signal}) or timeout`);
  else if (result.status !== 0 && PINNED_GUARD_FAILURES.length === 0) {
    failureDetail.push(`guarded run exited ${result.status}`);
  }
  if (markers.length > 0) {
    failureDetail.push(`live-save folder reads detected by the fs watch:\n  ${markers.join('\n  ')}`);
  }
  if (unpinnedFailures.length > 0) {
    failureDetail.push(`failing test files beyond the pinned readers -- either a live-save read\n` +
      `the pin does not cover, or a failure unrelated to the save folder: the guarded\n` +
      `run differs from a normal run only by the absent folder and the fs watch, so the\n` +
      `guard cannot attribute a failure to one or the other without the server's own\n` +
      `"Configured save folder not found" lines (below). Investigate the file before\n` +
      `deciding which it is.\n  ${unpinnedFailures.join('\n  ')}`);
  }
  if (pinned.length > 0 && failing.length === 0) {
    failureDetail.push(`the guarded run failed nothing, but ${PINNED_GUARD_FAILURES.length} file(s) are pinned as known live-save readers -- the pin is stale and must be removed`);
  }
  const missingPinned = pinned.filter((f) => !failing.includes(f));
  if (missingPinned.length > 0 && failing.length > 0) {
    failureDetail.push(`pinned reader(s) no longer failing the guarded run (fixed? remove from the pin):\n  ${missingPinned.join('\n  ')}`);
  }

  const watchNote = realFolder
    ? `The real configured folder was watched for reads: ${realFolder}`
    : 'The real configured folder could not be resolved, so the fs watch was NOT armed; only the missing-folder override enforced the guard.';

  const pinNote = pinned.length > 0
    ? `Pinned known live-save readers (reported out loud every run, ratcheted both ways):\n  ${pinned.join('\n  ')}`
    : 'No pinned live-save readers.';

  console.log(
    `\n[noLiveSave] guarded run (TI_SAVE_PATH=${MISSING_SAVE_DIR}): ` +
    `${markers.length === 0 && unpinnedFailures.length === 0 ? (pinned.length ? 'PASSED (within pin)' : 'PASSED') : 'FAILED'}\n` +
    `[noLiveSave] ${watchNote}\n` +
    `[noLiveSave] ${pinNote.replace(/\n/g, '\n[noLiveSave] ')}\n`
  );

  // The ratchet: the guarded run's failing set must equal the pinned set
  // exactly, in both directions. A new live-save reader grows the set and
  // fails; a pinned file fixed to fixtures shrinks it and fails until the pin
  // is removed.
  assert.deepStrictEqual(
    failing,
    pinned,
    `The unit suite must fail the guarded run in exactly the pinned readers -- the promise\n` +
    `"reads committed fixtures, not the live save folder" measured as behaviour.\n` +
    `Override used: TI_SAVE_PATH=${MISSING_SAVE_DIR}\n` +
    watchNote + '\n' +
    pinNote + '\n' +
    (failureDetail.length ? `\n${failureDetail.join('\n\n')}\n` : '') +
    (folderErrors.length ? `\nThe absent folder 500s on these routes:\n  ${folderErrors.join('\n  ')}\n` : '')
  );

  // The fs watch must have seen no access under the real configured folder,
  // even when the pin tolerates a failing test file.
  assert.deepStrictEqual(
    markers,
    [],
    `No fs access under the real configured save folder may occur during the unit suite:\n${markers.join('\n')}`
  );
});

test('the guard fails a probe test that reaches for the newest save', () => {
  // The permanent, self-proving version of the "seen to fail" evidence: a tiny
  // suite containing one test that reads the configured folder must fail the
  // guarded run, with the probe file named. Guards the guard's mechanism.
  const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ti-live-save-probe-'));
  const probeFile = path.join(probeDir, 'probeReadsSave.test.js');
  const loaderPath = path.join(REPO_ROOT, 'server', 'snapshotLoader');
  try {
    fs.writeFileSync(probeFile, `
      const { test } = require('node:test');
      const assert = require('node:assert');
      test('reads the newest save in the configured folder', () => {
        const { loadSnapshot } = require(${JSON.stringify(loaderPath)});
        assert.ok(loadSnapshot({ bypassCache: true }));
      });
    `);

    const { result, output } = runGuardedSuiteWith(probeFile);
    const failing = failingFilesFromOutput(output);
    assert.ok(
      result.status !== 0,
      `the probe suite must fail the guarded run (save folder absent, loadSnapshot throws)`
    );
    assert.ok(
      failing.includes(path.resolve(probeFile)),
      `the probe test file must be named in the failure output; got: ${failing.join(', ') || '(none)'}`
    );
  } finally {
    fs.rmSync(probeDir, { recursive: true, force: true });
  }
});

/**
 * The same override machinery as runGuardedSuite, but for an explicit list of
 * test files instead of the whole suite -- used by the probe test.
 */
function runGuardedSuiteWith(...files) {
  fs.rmSync(GUARD_NAMESPACE, { recursive: true, force: true });
  const realFolder = resolveRealSaveFolder();
  const env = guardedEnv(realFolder ? { TI_REAL_SAVE_FOLDER: realFolder } : {});

  const result = spawnSync(process.execPath, ['--test', ...files], {
    cwd: REPO_ROOT,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 5 * 60 * 1000
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  return { result, output, realFolder };
}
