// tests/powershell_common.test.js
//
// `TerraInvicta.Common.psm1` is the one dependency crossing the 2025-tool /
// dashboard boundary, and until 2026-08-22 this file reported six green passes
// having executed no PowerShell at all.
//
// Every test spawned `pwsh` and did `if (probe.error?.code === 'ENOENT') return;`
// -- a bare early return, which node:test scores as a PASS. `pwsh` is PowerShell
// 7, and it is not on this machine's PATH; Windows PowerShell 5.1 is, at
// C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe, and no test ever
// tried it. All six finished in ~2.5 ms each. The suite could not tell "the
// module is correct" from "the module was never loaded", which is the same
// defect class as a confident zero standing in for an unmeasured value.
//
// Three things fix it, and all three matter:
//
//   1. HOST RESOLUTION. `pwsh` first (7.x, the modern host), then
//      `powershell.exe` / `powershell` (5.1, shipped with Windows). Resolution
//      is recorded, not just performed: `POWERSHELL_HOST.attempts` names every
//      candidate tried and why it was rejected.
//   2. A SENTINEL. Exit status 0 alone proves only that a process ended well;
//      it does not prove the script reached its own last line. Each probe now
//      ends by printing TI-POWERSHELL-PROBE-OK and the assertion requires it on
//      stdout, so a probe that died early, or never started, cannot pass.
//   3. AN ANNOUNCED SKIP, NEVER A SILENT PASS. With no PowerShell host at all
//      the tests are declared `{ skip: <reason> }`, which node:test counts under
//      `skipped` and prints with the reason attached, naming each candidate and
//      stating plainly that no PowerShell executed. Nothing here can report
//      green for work it did not do.
//
// `verifyHarnessRejectsAFailingScript` below is the self-test: it runs a script
// that deliberately throws and asserts the harness scores it as a failure with
// no sentinel. That is what stops this file from quietly going vacuous again.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const modulePath = path.join(root, 'TerraInvicta.Common.psm1');

/** Printed by every probe's last line; absent means the probe did not finish. */
const SENTINEL = 'TI-POWERSHELL-PROBE-OK';

// `powershell.exe` and `powershell` are the same 5.1 host; both spellings are
// tried because a PATH entry may carry either. `pwsh` is first so a machine
// with PowerShell 7 exercises the module under the newer host.
const HOST_CANDIDATES = ['pwsh', 'powershell.exe', 'powershell'];

function resolvePowerShellHost() {
  const attempts = [];
  for (const command of HOST_CANDIDATES) {
    const probe = spawnSync(
      command,
      ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'],
      { encoding: 'utf8' }
    );
    if (probe.error) {
      attempts.push(`${command}: ${probe.error.code || probe.error.message}`);
      continue;
    }
    if (probe.status !== 0) {
      attempts.push(`${command}: exited ${probe.status}`);
      continue;
    }
    const version = String(probe.stdout || '').trim();
    if (!version) {
      attempts.push(`${command}: exited 0 but printed no version`);
      continue;
    }
    return { command, version, attempts };
  }
  return { command: null, version: null, attempts };
}

const POWERSHELL_HOST = resolvePowerShellHost();

/**
 * Runs a probe and reports what actually happened, without asserting.
 *
 * The returned `sentinel` is the load-bearing field: `status === 0` says the
 * process ended cleanly, `sentinel` says the script ran all the way through.
 */
/**
 * Every environment variable `Get-TIConfig` lets override the config file.
 *
 * Cleared at the top of every probe, and NOT a tidiness measure: `Get-TIConfig`
 * applies `if ($env:TI_SAVE_PATH) { $defaults.paths.savePath = $env:TI_SAVE_PATH }`
 * AFTER the merge, so a shell with `TI_SAVE_PATH` set makes the nested-merge
 * probe assert on the environment rather than on the merge and fail. That is
 * exactly what a suite which never executed any PowerShell could not discover:
 * it surfaced the moment these tests started running for real, on a suite run
 * that happened to have the variable set. `SUPABASE_HISTORY_RETENTION` is
 * cleared here too and then set deliberately inside the retention probe, which
 * is the only place it belongs.
 */
const CONFIG_ENV_OVERRIDES = [
  'TI_SAVE_PATH', 'TI_TEMPLATES_DIR',
  'SUPABASE_CAMPAIGN_KEY', 'SUPABASE_OBSERVER_FACTION_ID', 'SUPABASE_HISTORY_RETENTION'
];

function runProbe(body) {
  const script = `
    $ErrorActionPreference = 'Stop'
    foreach ($name in @(${CONFIG_ENV_OVERRIDES.map(name => `'${name}'`).join(', ')})) {
      if (Test-Path ('Env:' + $name)) { Remove-Item ('Env:' + $name) }
    }
    Import-Module '${modulePath}' -Force
    $root = '${root}'
${body}
    Write-Output '${SENTINEL}'
  `;
  const probe = spawnSync(
    POWERSHELL_HOST.command,
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { encoding: 'utf8' }
  );
  const stdout = String(probe.stdout || '');
  return {
    spawnError: probe.error || null,
    status: probe.status,
    stdout,
    stderr: String(probe.stderr || ''),
    sentinel: stdout.includes(SENTINEL)
  };
}

/** The reason a skip carries, written so it can never be mistaken for a pass. */
const NO_HOST_REASON =
  'NO POWERSHELL EXECUTED: no PowerShell host is available, so TerraInvicta.Common.psm1 was never loaded. '
  + `Candidates tried, in order — ${POWERSHELL_HOST.attempts.join('; ')}. `
  + 'Install PowerShell 7 (`pwsh`) or run on Windows, where `powershell.exe` 5.1 ships in the box.';

/**
 * Declares a probe test, or an announced skip when there is nothing to run it
 * on. Never a silent pass: node:test counts a `{ skip }` under `skipped` and
 * prints the reason.
 */
function psTest(name, body) {
  if (!POWERSHELL_HOST.command) {
    test(name, { skip: NO_HOST_REASON }, () => {});
    return;
  }
  test(name, () => {
    const result = runProbe(body);
    assert.equal(result.spawnError, null,
      `${POWERSHELL_HOST.command} could not be spawned: ${result.spawnError && result.spawnError.code}`);
    assert.equal(result.status, 0,
      `${POWERSHELL_HOST.command} ${POWERSHELL_HOST.version} exited ${result.status}\n`
      + `${result.stderr || result.stdout}`);
    assert.ok(result.sentinel,
      `${POWERSHELL_HOST.command} ${POWERSHELL_HOST.version} exited 0 but never reached the end of the probe, `
      + `so nothing in it was proven. stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  });
}

// ---------------------------------------------------------------------------
// The harness proves itself before it is trusted to prove anything else.
// ---------------------------------------------------------------------------

test('the probe harness scores a failing PowerShell script as a failure, not a pass', {
  skip: POWERSHELL_HOST.command ? false : NO_HOST_REASON
}, () => {
  // Exactly the shape a broken TerraInvicta.Common.psm1 would produce: the
  // module loads, a call inside the probe throws, and the sentinel is never
  // printed. If this scored green, every test in this file would be vacuous.
  const failing = runProbe("    throw 'deliberate harness self-test failure'");
  assert.notEqual(failing.status, 0, 'a throwing probe must not exit 0');
  assert.equal(failing.sentinel, false, 'a throwing probe must not reach the sentinel');
  assert.match(failing.stderr, /deliberate harness self-test failure/);

  // And the positive control, so "always red" is excluded too.
  const passing = runProbe('    $null = Get-Command Get-TIConfig -ErrorAction Stop');
  assert.equal(passing.status, 0, passing.stderr);
  assert.equal(passing.sentinel, true);
});

test('a PowerShell host was resolved, and the tests say which one ran them', {
  skip: POWERSHELL_HOST.command ? false : NO_HOST_REASON
}, () => {
  assert.ok(POWERSHELL_HOST.command, NO_HOST_REASON);
  assert.match(POWERSHELL_HOST.version, /^\d+\.\d+/,
    `the resolved host reported no usable version: ${POWERSHELL_HOST.version}`);
  // Reported rather than asserted-against: 5.1 and 7.x are both supported, and
  // pinning either would fail the machine that has the other.
  console.log(`[powershell_common] probes ran under ${POWERSHELL_HOST.command} ${POWERSHELL_HOST.version}`
    + (POWERSHELL_HOST.attempts.length ? ` (rejected: ${POWERSHELL_HOST.attempts.join('; ')})` : ''));
});

// ---------------------------------------------------------------------------
// The module's own behaviour. Bodies are unchanged from the versions that were
// never executed, minus the per-probe Import-Module/$root preamble runProbe now
// supplies, and minus the trailing sentinel it appends.
// ---------------------------------------------------------------------------

psTest('PowerShell common module loads central config and selects the newest save', `
    $config = Get-TIConfig -BasePath $root
    if ($config.schemaVersion -ne 1 -or $null -eq $config.paths) { throw 'central config was not loaded' }
    $folder = Join-Path ([IO.Path]::GetTempPath()) ('ti-powershell-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $folder | Out-Null
    try {
      Set-Content -LiteralPath (Join-Path $folder 'older.json') -Value '{}'
      Start-Sleep -Milliseconds 25
      Set-Content -LiteralPath (Join-Path $folder 'newer.json') -Value '{}'
      $files = Get-TISaveFiles -Folder $folder
      if ($files[0].Name -ne 'newer.json') { throw ('latest selection returned ' + $files[0].Name) }
    } finally {
      Remove-Item -LiteralPath $folder -Recurse -Force
    }`);

psTest('PowerShell common module merges the documented nested config shape', `
    $folder = Join-Path ([IO.Path]::GetTempPath()) ('ti-powershell-config-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $folder | Out-Null
    try {
      $configPath = Join-Path $folder 'config.json'
      '{"paths":{"savePath":"C:/configured/saves","shipInfoSubDir":"components"},"analysis":{"directiveWeights":{"topNCouncilTargets":5}}}' | Set-Content -LiteralPath $configPath
      $config = Get-TIConfig -BasePath $root -ConfigPath $configPath
      if ($config.paths.savePath -ne 'C:/configured/saves') { throw 'nested savePath was not merged' }
      if ($config.paths.shipInfoSubDir -ne 'components') { throw 'nested shipInfoSubDir was not merged' }
      if ($config.analysis.directiveWeights.topNCouncilTargets -ne 5) { throw 'nested directive weight was not merged' }
    } finally {
      Remove-Item -LiteralPath $folder -Recurse -Force
    }`);

psTest('PowerShell config keeps empty sections mergeable and rejects nested typos', `
    $folder = Join-Path ([IO.Path]::GetTempPath()) ('ti-powershell-validation-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $folder | Out-Null
    try {
      $emptyPath = Join-Path $folder 'empty.json'
      '{"analysis":{}}' | Set-Content -LiteralPath $emptyPath
      $empty = Get-TIConfig -BasePath $root -ConfigPath $emptyPath
      if ($null -eq $empty.analysis.effects -or $empty.analysis.directiveWeights.defense.base -ne 5) { throw 'empty nested sections replaced defaults' }

      $customPath = Join-Path $folder 'custom.json'
      '{"analysis":{"effects":{"Effect_Custom":{"capability":"customCapability","category":"test","description":"custom descriptor","defaultProject":"Project_Custom"}},"strategicProjects":[{"id":"Project_Custom","name":"Custom project"}]}}' | Set-Content -LiteralPath $customPath
      $custom = Get-TIConfig -BasePath $root -ConfigPath $customPath
      if ($custom.analysis.effects.Effect_Custom.capability -ne 'customCapability') { throw 'nested custom effect was not accepted' }
      if ($custom.analysis.strategicProjects[0].id -ne 'Project_Custom') { throw 'nested custom project was not accepted' }

      $typoPath = Join-Path $folder 'typo.json'
      '{"analysis":{"directiveWeights":{"defense":{"base":5,"escalateLateBonuz":3}}}}' | Set-Content -LiteralPath $typoPath
      try {
        Get-TIConfig -BasePath $root -ConfigPath $typoPath | Out-Null
        throw 'nested typo was accepted'
      } catch {
        if ($_.Exception.Message -notmatch 'Unknown configuration key') { throw }
      }
    } finally {
      Remove-Item -LiteralPath $folder -Recurse -Force
    }`);

psTest('PowerShell config keeps the retired capability-map shape compatible', `
    $folder = Join-Path ([IO.Path]::GetTempPath()) ('ti-powershell-legacy-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $folder | Out-Null
    try {
      $configPath = Join-Path $folder 'legacy.json'
      '{"version":"1.0.0","description":"retired capability map","templatesPath":"C:/templates","defaultObserverFaction":"the Initiative","effects":{"Effect_Custom":{"capability":"customCapability","category":"test","description":"custom descriptor","defaultProject":"Project_Custom"}},"strategicProjects":[{"id":"Project_Custom","name":"Custom project"}]}' | Set-Content -LiteralPath $configPath
      $config = Get-TIConfig -BasePath $root -ConfigPath $configPath
      if ($config.paths.templatesPath -ne 'C:/templates') { throw 'legacy templatesPath was not migrated' }
      if ($config.analysis.effects.Effect_Custom.capability -ne 'customCapability') { throw 'custom effect was not migrated' }
      if ($config.analysis.strategicProjects[0].id -ne 'Project_Custom') { throw 'custom project was not migrated' }
    } finally {
      Remove-Item -LiteralPath $folder -Recurse -Force
    }`);

psTest('PowerShell config validates values against the shared JSON schema', `
    $folder = Join-Path ([IO.Path]::GetTempPath()) ('ti-powershell-schema-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $folder | Out-Null
    try {
      $typePath = Join-Path $folder 'type.json'
      '{"analysis":{"directiveWeights":{"defense":{"base":"five"}}}}' | Set-Content -LiteralPath $typePath
      try {
        Get-TIConfig -BasePath $root -ConfigPath $typePath | Out-Null
        throw 'invalid numeric type was accepted'
      } catch {
        if ($_.Exception.Message -notmatch 'must be type number') { throw }
      }

      $rangePath = Join-Path $folder 'range.json'
      '{"server":{"port":70000}}' | Set-Content -LiteralPath $rangePath
      try {
        Get-TIConfig -BasePath $root -ConfigPath $rangePath | Out-Null
        throw 'out-of-range port was accepted'
      } catch {
        if ($_.Exception.Message -notmatch 'above the maximum') { throw }
      }
    } finally {
      Remove-Item -LiteralPath $folder -Recurse -Force
    }`);

psTest('PowerShell config lets the environment override the config file, which is why the probes clear it', `
    $folder = Join-Path ([IO.Path]::GetTempPath()) ('ti-powershell-env-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $folder | Out-Null
    try {
      $configPath = Join-Path $folder 'config.json'
      '{"paths":{"savePath":"C:/configured/saves","templatesPath":"C:/configured/templates"}}' | Set-Content -LiteralPath $configPath

      # With a clean environment the FILE wins. This is the state every other
      # probe assumes, and the reason runProbe clears these first.
      $fromFile = Get-TIConfig -BasePath $root -ConfigPath $configPath
      if ($fromFile.paths.savePath -ne 'C:/configured/saves') { throw 'the config file did not win with a clean environment' }
      if ($fromFile.paths.templatesPath -ne 'C:/configured/templates') { throw 'the config file templatesPath did not win' }

      # With the variables set, the ENVIRONMENT wins. Documented behaviour, and
      # the thing that made a suite run with TI_SAVE_PATH set fail the
      # nested-merge probe once these tests started actually executing.
      $env:TI_SAVE_PATH = 'C:/from/environment'
      $env:TI_TEMPLATES_DIR = 'C:/templates/from/environment'
      try {
        $fromEnv = Get-TIConfig -BasePath $root -ConfigPath $configPath
        if ($fromEnv.paths.savePath -ne 'C:/from/environment') { throw 'TI_SAVE_PATH did not override the config file' }
        if ($fromEnv.paths.templatesPath -ne 'C:/templates/from/environment') { throw 'TI_TEMPLATES_DIR did not override the config file' }
        # And the compatibility projection follows it rather than the file.
        if ($fromEnv.SavePath -ne 'C:/from/environment') { throw 'the legacy SavePath projection disagreed with paths.savePath' }
      } finally {
        Remove-Item Env:TI_SAVE_PATH
        Remove-Item Env:TI_TEMPLATES_DIR
      }
    } finally {
      Remove-Item -LiteralPath $folder -Recurse -Force
    }`);

psTest('PowerShell config keeps the canonical history retention alias synchronized', `
    $folder = Join-Path ([IO.Path]::GetTempPath()) ('ti-powershell-retention-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $folder | Out-Null
    try {
      $canonicalPath = Join-Path $folder 'canonical.json'
      '{"analysis":{"strategicHistory":{"retention":7}},"publishing":{"historyRetention":99}}' | Set-Content -LiteralPath $canonicalPath
      $canonical = Get-TIConfig -BasePath $root -ConfigPath $canonicalPath
      if ($canonical.analysis.strategicHistory.retention -ne 7 -or $canonical.publishing.historyRetention -ne 7) { throw 'canonical retention did not win' }

      $aliasPath = Join-Path $folder 'alias.json'
      '{"publishing":{"historyRetention":9}}' | Set-Content -LiteralPath $aliasPath
      $alias = Get-TIConfig -BasePath $root -ConfigPath $aliasPath
      if ($alias.analysis.strategicHistory.retention -ne 9 -or $alias.publishing.historyRetention -ne 9) { throw 'retention alias did not synchronize' }

      $env:SUPABASE_HISTORY_RETENTION = '11'
      $environment = Get-TIConfig -BasePath $root -ConfigPath $canonicalPath
      if ($environment.analysis.strategicHistory.retention -ne 11 -or $environment.publishing.historyRetention -ne 11) { throw 'environment retention did not win' }
      Remove-Item Env:SUPABASE_HISTORY_RETENTION
    } finally {
      Remove-Item -LiteralPath $folder -Recurse -Force
    }`);
