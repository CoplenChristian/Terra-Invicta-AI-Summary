<#
.SYNOPSIS
    Parses the current locations of alien councilors from a Terra Invicta save.

.DESCRIPTION
    Reads the save folder inferred from config.json, presents a numbered save
    picker, extracts AlienCouncil councilors, and resolves each councilor's
    location ID through TIRegionState. The default output is a console table.

.EXAMPLE
    .\parse_alien_councilor_locations.ps1

.EXAMPLE
    .\parse_alien_councilor_locations.ps1 -Latest `
        -Format Csv -OutputPath ".\alien_councilor_locations.csv"

.EXAMPLE
    .\parse_alien_councilor_locations.ps1 -SaveNumber 10 `
        -Format Csv -OutputPath ".\alien_councilor_locations.csv"
#>

[CmdletBinding()]
param(
    [int]$SaveNumber = 0,

    [switch]$Latest,

    [string]$SaveFolder,

    [ValidateSet("Table", "Csv", "Json")]
    [string]$Format = "Table",

    [string]$OutputPath
)

Set-StrictMode -Version Latest

$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$commonModulePath = Join-Path $scriptPath "TerraInvicta.Common.psm1"
if (-not (Test-Path -LiteralPath $commonModulePath -PathType Leaf)) {
    throw "Shared parser module not found at $commonModulePath"
}
Import-Module -Name $commonModulePath -Force
$config = Get-TIConfig -BasePath $scriptPath

$saveFolderPath = Resolve-TISaveFolder `
    -ConfiguredSavePath $config.SavePath `
    -RequestedSaveFolder $SaveFolder `
    -BasePath $scriptPath
$saveFiles = Get-TISaveFiles -Folder $saveFolderPath
$selectedSave = Select-TISaveFile -Files $saveFiles -RequestedNumber $SaveNumber -UseLatest:$Latest
$SavePath = $selectedSave.FullName

$saveJson = Read-TISaveJson -Path $SavePath
$gameStates = $saveJson.gamestates

if ($null -eq $gameStates) {
    throw "Save does not contain a gamestates object: $SavePath"
}

$factionStateName = "PavonisInteractive.TerraInvicta.TIFactionState"
$councilorStateName = "PavonisInteractive.TerraInvicta.TICouncilorState"
$regionStateName = "PavonisInteractive.TerraInvicta.TIRegionState"

$factions = Get-TIStateCollection -GameStates $gameStates -StateName $factionStateName
$councilors = Get-TIStateCollection -GameStates $gameStates -StateName $councilorStateName
$regions = Get-TIStateCollection -GameStates $gameStates -StateName $regionStateName

$alienFaction = $factions |
    Where-Object { $_.templateName -eq "AlienCouncil" } |
    Select-Object -First 1

$alienFactionId = if ($alienFaction) {
    Get-TIReferenceId -Reference $alienFaction.ID
} else {
    $null
}

$regionNamesById = @{}
foreach ($region in $regions) {
    $regionId = Get-TIReferenceId -Reference $region.ID
    if ($null -ne $regionId) {
        $regionNamesById[$regionId] = $region.displayName
    }
}

$alienCouncilors = $councilors | Where-Object {
    $councilorFactionId = Get-TIReferenceId -Reference $_.faction
    if ($null -ne $alienFactionId) {
        $councilorFactionId -eq $alienFactionId
    } else {
        $_.typeTemplateName -eq "Alien" -or $_.ancestry -eq "Alien"
    }
}

$rows = @(
    foreach ($councilor in ($alienCouncilors | Sort-Object displayName)) {
        $locationId = Get-TIReferenceId -Reference $councilor.location

        $locationName = if ($null -eq $locationId) {
            "Not in a region"
        } elseif ($regionNamesById.ContainsKey($locationId)) {
            $regionNamesById[$locationId]
        } else {
            "Unknown region"
        }

        [PSCustomObject][ordered]@{
            CouncilorID = Get-TIReferenceId -Reference $councilor.ID
            Councilor   = $councilor.displayName
            Status      = $councilor.status
            LocationID  = $locationId
            Location    = $locationName
        }
    }
)

if ($rows.Count -eq 0) {
    Write-Warning "No alien councilors found in $SavePath"
}

if ($Format -eq "Table") {
    $rendered = $rows | Format-Table -AutoSize | Out-String
} elseif ($Format -eq "Csv") {
    $rendered = $rows | ConvertTo-Csv -NoTypeInformation | Out-String
} else {
    $rendered = $rows | ConvertTo-Json -Depth 4
}

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    Write-Output $rendered.TrimEnd()
} else {
    $outputParent = Split-Path -Parent $OutputPath
    if (-not [string]::IsNullOrWhiteSpace($outputParent) -and
        -not (Test-Path -LiteralPath $outputParent -PathType Container)) {
        throw "Output directory not found: $outputParent"
    }

    Set-Content -LiteralPath $OutputPath -Value $rendered.TrimEnd() -Encoding UTF8
    Write-Output "Wrote $($rows.Count) alien councilor locations to $OutputPath"
}
