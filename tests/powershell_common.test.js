const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const path = require('path');

test('PowerShell common module loads central config and selects the newest save', () => {
  const probe = spawnSync('pwsh', ['-NoProfile', '-Command', `
    $ErrorActionPreference = 'Stop'
    Import-Module '${path.resolve(__dirname, '..', 'TerraInvicta.Common.psm1')}' -Force
    $root = '${path.resolve(__dirname, '..')}'
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
    }
  `], { encoding: 'utf8' });
  if (probe.error?.code === 'ENOENT') return;
  assert.equal(probe.status, 0, probe.stderr || probe.stdout);
});

test('PowerShell common module merges the documented nested config shape', () => {
  const root = path.resolve(__dirname, '..');
  const probe = spawnSync('pwsh', ['-NoProfile', '-Command', `
    $ErrorActionPreference = 'Stop'
    Import-Module '${path.join(root, 'TerraInvicta.Common.psm1')}' -Force
    $root = '${root}'
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
    }
  `], { encoding: 'utf8' });
  if (probe.error?.code === 'ENOENT') return;
  assert.equal(probe.status, 0, probe.stderr || probe.stdout);
});

test('PowerShell config keeps empty sections mergeable and rejects nested typos', () => {
  const root = path.resolve(__dirname, '..');
  const probe = spawnSync('pwsh', ['-NoProfile', '-Command', `
    $ErrorActionPreference = 'Stop'
    Import-Module '${path.join(root, 'TerraInvicta.Common.psm1')}' -Force
    $root = '${root}'
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
    }
  `], { encoding: 'utf8' });
  if (probe.error?.code === 'ENOENT') return;
  assert.equal(probe.status, 0, probe.stderr || probe.stdout);
});

test('PowerShell config keeps the retired capability-map shape compatible', () => {
  const root = path.resolve(__dirname, '..');
  const probe = spawnSync('pwsh', ['-NoProfile', '-Command', `
    $ErrorActionPreference = 'Stop'
    Import-Module '${path.join(root, 'TerraInvicta.Common.psm1')}' -Force
    $root = '${root}'
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
    }
  `], { encoding: 'utf8' });
  if (probe.error?.code === 'ENOENT') return;
  assert.equal(probe.status, 0, probe.stderr || probe.stdout);
});

test('PowerShell config validates values against the shared JSON schema', () => {
  const root = path.resolve(__dirname, '..');
  const probe = spawnSync('pwsh', ['-NoProfile', '-Command', `
    $ErrorActionPreference = 'Stop'
    Import-Module '${path.join(root, 'TerraInvicta.Common.psm1')}' -Force
    $root = '${root}'
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
    }
  `], { encoding: 'utf8' });
  if (probe.error?.code === 'ENOENT') return;
  assert.equal(probe.status, 0, probe.stderr || probe.stdout);
});

test('PowerShell config keeps the canonical history retention alias synchronized', () => {
  const root = path.resolve(__dirname, '..');
  const probe = spawnSync('pwsh', ['-NoProfile', '-Command', `
    $ErrorActionPreference = 'Stop'
    Import-Module '${path.join(root, 'TerraInvicta.Common.psm1')}' -Force
    $root = '${root}'
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
    }
  `], { encoding: 'utf8' });
  if (probe.error?.code === 'ENOENT') return;
  assert.equal(probe.status, 0, probe.stderr || probe.stdout);
});
