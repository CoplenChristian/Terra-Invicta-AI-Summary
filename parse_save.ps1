<#
.SYNOPSIS
    Universal Terra Invicta Save Parser & Intelligence CLI wrapper.

.DESCRIPTION
    Wraps scripts/parse_save.js to query save game state, intel projections, and metrics.

.PARAMETER Latest
    Use the most recently modified save file in the configured save folder.

.PARAMETER Save
    Explicit path or filename of a save file (e.g. Again.gz).

.PARAMETER Endpoint
    Intel resource endpoint (e.g. summary, councilors, habs, mining, mining-expansion, alien-threat, tech-tree).

.PARAMETER Mode
    Visibility mode: 'player' (default), 'enhanced', or 'omniscient'.

.PARAMETER Observer
    Observer faction name or numeric ID (default: 'the Initiative' / 4712).

.PARAMETER Format
    Output format: 'json', 'pretty' (default), 'summary', or 'table'.

.PARAMETER Field
    Nested field path to extract (e.g. 'capacity', 'resources.water').

.EXAMPLE
    .\parse_save.ps1 -Latest -Endpoint summary
    .\parse_save.ps1 -Latest -Endpoint mining -Format Json
    .\parse_save.ps1 -Save Again.gz -Endpoint alien-threat -Mode Omniscient
#>

[CmdletBinding()]
param(
    [switch]$Latest = $true,
    [string]$Save,
    [string]$Endpoint,
    [ValidateSet('player', 'enhanced', 'omniscient')]
    [string]$Mode = 'player',
    [string]$Observer = 'the Initiative',
    [ValidateSet('json', 'pretty', 'summary', 'table')]
    [string]$Format = 'pretty',
    [string]$Field,
    [string]$OutFile,
    [int]$Limit,
    [string]$Body,
    [string]$Theater
)

$argsList = @()

if ($Save) {
    $argsList += "--save", $Save
} elseif ($Latest) {
    $argsList += "--latest"
}

if ($Endpoint) {
    $argsList += "--endpoint", $Endpoint
}

if ($Mode) {
    $argsList += "--mode", $Mode
}

if ($Observer) {
    $argsList += "--observer", $Observer
}

if ($Format) {
    $argsList += "--format", $Format
}

if ($Field) {
    $argsList += "--field", $Field
}

if ($OutFile) {
    $argsList += "--out", $OutFile
}

if ($Limit -gt 0) {
    $argsList += "--limit", $Limit
}

if ($Body) {
    $argsList += "--body", $Body
}

if ($Theater) {
    $argsList += "--theater", $Theater
}

$scriptPath = Join-Path $PSScriptRoot "scripts\parse_save.js"
node $scriptPath @argsList
