param(
    # Path to the save gzip file (Again.gz)
    [string]$SavePath = $null,
    # New daysToCompletion value to apply to every Resistance ship build queue entry
    [double]$TargetDays = 0.05
)

# Load configuration
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
# See ti_data_tools.ps1: the shared module and config/ stayed at the repository
# root when this tool moved into md-generation-reports/, so they anchor on
# $repoRoot. This script writes beside the save file, not under the tool root.
$repoRoot = Split-Path -Parent $scriptPath
$commonModulePath = Join-Path $repoRoot "TerraInvicta.Common.psm1"
Import-Module -Name $commonModulePath -Force
$config = Get-TIConfig -BasePath $repoRoot

if ([string]::IsNullOrEmpty($SavePath)) {
    $SavePath = $config.SavePath
}

if (-not (Test-Path $SavePath)) {
    throw "Save file not found at $SavePath"
}

$workDir = Split-Path -Parent $SavePath
$backupPath = Join-Path $workDir ("{0}.bak" -f (Split-Path $SavePath -Leaf))

Write-Host "Backing up save to $backupPath..."
Copy-Item -Path $SavePath -Destination $backupPath -Force

# Create temp files for the expanded JSON and the recompressed output
$tempJson = [IO.Path]::GetTempFileName()
$tempOut  = [IO.Path]::GetTempFileName()

try {
    # Decompress Again.gz -> temp JSON
    $fsIn = [IO.File]::OpenRead($SavePath)
    try {
        $gz = New-Object IO.Compression.GzipStream($fsIn, [IO.Compression.CompressionMode]::Decompress)
        try {
            $fsOut = [IO.File]::Create($tempJson)
            try { $gz.CopyTo($fsOut) } finally { $fsOut.Close() }
        } finally { $gz.Close() }
    } finally { $fsIn.Close() }

    Write-Host "Loading save JSON..."
    $json = Get-Content $tempJson -Raw | ConvertFrom-Json

    $factions = $json.gamestates.'PavonisInteractive.TerraInvicta.TIFactionState' | ForEach-Object { $_.Value }
    $resist = $factions | Where-Object templateName -eq 'ResistCouncil'
    if (-not $resist) { throw "Could not find ResistCouncil faction in save." }

    $queues = $resist.nShipyardQueues
    if (-not $queues) { throw "ResistCouncil has no shipyard queues in this save." }

    # Grab current campaign datetime so we can stamp queued builds that have a zero start date
    $timeState = $json.gamestates.'PavonisInteractive.TerraInvicta.TITimeState' |
        ForEach-Object { $_.Value } | Select-Object -First 1
    $now = if ($timeState) { $timeState.currentDateTime } else { $null }

    $editCount = 0
    foreach ($kvp in $queues.GetEnumerator()) {
        $entries = $kvp.Value
        if (-not $entries) { continue }
        foreach ($entry in $entries) {
            if ($entry.PSObject.Properties.Name -contains 'daysToCompletion') {
                $entry.daysToCompletion = $TargetDays
                $editCount++
            }

            # Also clamp the per-entry completionTime_days if present
            if ($entry.resourcesCost -and $entry.resourcesCost.completionTime_days) {
                $entry.resourcesCost.completionTime_days = $TargetDays
            }

            # If the queued build has an uninitialized startDate, set it to "now" to avoid UI recomputing long durations
            if ($now -and $entry.startDate -and $entry.startDate.year -eq 0) {
                $entry.startDate.year        = $now.year
                $entry.startDate.month       = $now.month
                $entry.startDate.day         = $now.day
                $entry.startDate.hour        = $now.hour
                $entry.startDate.minute      = $now.minute
                $entry.startDate.second      = $now.second
                $entry.startDate.millisecond = $now.millisecond
            }
        }
    }

    if ($editCount -le 0) {
        throw "No queue entries were updated (no daysToCompletion fields found)."
    }

    Write-Host "Updated $editCount queue entries to daysToCompletion=$TargetDays. Writing save..."

    # Convert back to JSON (compressed) and recompress to gzip in-place
    $jsonString = $json | ConvertTo-Json -Depth 100 -Compress
    [IO.File]::WriteAllText($tempJson, $jsonString)

    $fsJson = [IO.File]::OpenRead($tempJson)
    try {
        $fsOutGz = [IO.File]::Create($tempOut)
        try {
            $gzOut = New-Object IO.Compression.GzipStream($fsOutGz, [IO.Compression.CompressionMode]::Compress)
            try { $fsJson.CopyTo($gzOut) } finally { $gzOut.Close() }
        } finally { $fsOutGz.Close() }
    } finally { $fsJson.Close() }

    Move-Item -Path $tempOut -Destination $SavePath -Force
    Write-Host "Save updated. Original backup at $backupPath"
}
finally {
    if (Test-Path $tempJson) { Remove-Item $tempJson -Force }
    if (Test-Path $tempOut)  { Remove-Item $tempOut -Force }
}

Write-Host "Done."
