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
