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

.EXAMPLE
    .\push_latest_to_supabase.ps1 -DryRun

.EXAMPLE
    .\push_latest_to_supabase.ps1
#>

[CmdletBinding()]
param(
    [switch]$DryRun,
    [string]$Save,
    [string]$CampaignKey
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

node @nodeArgs
