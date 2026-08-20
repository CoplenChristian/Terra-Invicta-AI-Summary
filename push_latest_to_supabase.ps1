<#
.SYNOPSIS
    Publishes the latest Terra Invicta Player Intel snapshot to Supabase.

.DESCRIPTION
    Runs the Node.js publisher script which extracts sanitized Player Intel
    snapshots for all observer factions and uploads them to Supabase.

.PARAMETER DryRun
    Runs the parser and validates payloads without uploading to Supabase.

.PARAMETER Save
    Optional path to a specific save file. If omitted, uses the latest save.

.PARAMETER CampaignKey
    Optional campaign key override (defaults to 'initiative' or SUPABASE_CAMPAIGN_KEY).

.PARAMETER InlineTechTree
    Embeds the static tech graph in every published row.

.PARAMETER OmitTechTree
    Omits the tech graph and publishes an explicit unavailable marker.

.EXAMPLE
    .\push_latest_to_supabase.ps1 -DryRun

.EXAMPLE
    .\push_latest_to_supabase.ps1
#>

[CmdletBinding()]
param(
    [switch]$DryRun,
    [string]$Save,
    [string]$CampaignKey,
    [switch]$AllObservers,
    [int]$Observer,
    [int]$HistoryRetention,
    [int]$FullSnapshotRetention,
    [switch]$InlineTechTree,
    [switch]$OmitTechTree
)

$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -Path $scriptPath

$nodeArgs = @("scripts/push_latest_to_supabase.js")

if ($DryRun) {
    $nodeArgs += "--dry-run"
}

if (-not [string]::IsNullOrWhiteSpace($Save)) {
    $nodeArgs += @("--save", $Save)
}

if (-not [string]::IsNullOrWhiteSpace($CampaignKey)) {
    $nodeArgs += @("--campaign", $CampaignKey)
}

if ($AllObservers) { $nodeArgs += "--all-observers" }
if ($Observer -gt 0) { $nodeArgs += @("--observer", $Observer) }
if ($HistoryRetention -gt 0) { $nodeArgs += @("--history-retention", $HistoryRetention) }
if ($FullSnapshotRetention -gt 0) { $nodeArgs += @("--full-snapshot-retention", $FullSnapshotRetention) }
if ($InlineTechTree) { $nodeArgs += "--inline-tech-tree" }
if ($OmitTechTree) { $nodeArgs += "--omit-tech-tree" }

node @nodeArgs
