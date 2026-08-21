<#
.SYNOPSIS
    Parses councilors belonging to a selected faction from a Terra Invicta save.

.DESCRIPTION
    Infers the save folder from config.json, presents a numbered save picker,
    presents a numbered faction picker, and extracts the selected faction's
    councilors with base attributes, organizations, status, and region.

.EXAMPLE
    .\parse_faction_councilors.ps1

.EXAMPLE
    .\parse_faction_councilors.ps1 -Latest -FactionNumber 5 `
        -Format Csv -OutputPath ".\faction_councilors.csv"

.EXAMPLE
    .\parse_faction_councilors.ps1 -SaveNumber 1 -FactionNumber 7 `
        -Format Csv -OutputPath ".\faction_councilors.csv"
#>

[CmdletBinding()]
param(
    [int]$SaveNumber = 0,

    [switch]$Latest,

    [string]$SaveFolder,

    [int]$FactionNumber = 0,

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

function Get-TIPropertyValue {
    param(
        $Object,

        [Parameter(Mandatory)]
        [string[]]$Names
    )

    if ($null -eq $Object) {
        return $null
    }

    foreach ($name in $Names) {
        $property = $Object.PSObject.Properties[$name]
        if ($null -ne $property) {
            return $property.Value
        }
    }

    return $null
}

function Resolve-TIRegionName {
    param(
        $Reference,

        [Parameter(Mandatory)]
        [hashtable]$NamesById
    )

    $regionId = Get-TIReferenceId -Reference $Reference
    if ($null -eq $regionId) {
        return "Not in a region"
    }

    if ($NamesById.ContainsKey($regionId)) {
        return $NamesById[$regionId]
    }

    return "Unknown region"
}

$saveFolderPath = Resolve-TISaveFolder `
    -ConfiguredSavePath $config.SavePath `
    -RequestedSaveFolder $SaveFolder `
    -BasePath $scriptPath
$saveFiles = Get-TISaveFiles -Folder $saveFolderPath
$selectedSave = Select-TISaveFile -Files $saveFiles -RequestedNumber $SaveNumber -UseLatest:$Latest
$savePath = $selectedSave.FullName

$saveJson = Read-TISaveJson -Path $savePath
$gameStates = $saveJson.gamestates

if ($null -eq $gameStates) {
    throw "Save does not contain a gamestates object: $savePath"
}

$factions = Get-TIStateCollection -GameStates $gameStates -StateName "PavonisInteractive.TerraInvicta.TIFactionState"
$factions = @($factions | Sort-Object displayName)
if ($factions.Count -eq 0) {
    throw "No faction data found in $savePath"
}

$selectedFaction = Select-TIFaction -Factions $factions -RequestedNumber $FactionNumber
$selectedFactionId = Get-TIReferenceId -Reference $selectedFaction.ID

$regions = Get-TIStateCollection -GameStates $gameStates -StateName "PavonisInteractive.TerraInvicta.TIRegionState"
$regionNamesById = @{}
foreach ($region in $regions) {
    $regionId = Get-TIReferenceId -Reference $region.ID
    if ($null -ne $regionId) {
        $regionNamesById[$regionId] = $region.displayName
    }
}

$orgs = Get-TIStateCollection -GameStates $gameStates -StateName "PavonisInteractive.TerraInvicta.TIOrgState"
$orgNamesById = @{}
foreach ($org in $orgs) {
    $orgId = Get-TIReferenceId -Reference $org.ID
    if ($null -ne $orgId) {
        $orgNamesById[$orgId] = $org.displayName
    }
}

$councilors = Get-TIStateCollection -GameStates $gameStates -StateName "PavonisInteractive.TerraInvicta.TICouncilorState"
$councilorsForFaction = @(
    $councilors | Where-Object {
        (Get-TIReferenceId -Reference $_.faction) -eq $selectedFactionId
    } | Sort-Object displayName
)

$rows = @(
    foreach ($councilor in $councilorsForFaction) {
        $attributes = Get-TIPropertyValue -Object $councilor -Names @("attributes")
        $orgNames = @()
        $orgReferences = Get-TIPropertyValue -Object $councilor -Names @("orgs")
        foreach ($orgReference in @($orgReferences)) {
            $orgId = Get-TIReferenceId -Reference $orgReference
            if ($null -ne $orgId -and $orgNamesById.ContainsKey($orgId)) {
                $orgNames += $orgNamesById[$orgId]
            }
        }

        [PSCustomObject][ordered]@{
            FactionName       = $selectedFaction.displayName
            CouncilorID       = Get-TIReferenceId -Reference $councilor.ID
            Councilor         = $councilor.displayName
            TemplateName      = $councilor.templateName
            TypeTemplateName  = $councilor.typeTemplateName
            Status            = $councilor.status
            LocationID        = Get-TIReferenceId -Reference $councilor.location
            Location          = Resolve-TIRegionName -Reference $councilor.location -NamesById $regionNamesById
            HomeRegion        = Resolve-TIRegionName -Reference $councilor.homeRegion -NamesById $regionNamesById
            ActiveMissionID   = Get-TIReferenceId -Reference $councilor.activeMission
            Persuasion        = Get-TIPropertyValue -Object $attributes -Names @("Persuasion")
            Investigation     = Get-TIPropertyValue -Object $attributes -Names @("Investigation")
            Espionage         = Get-TIPropertyValue -Object $attributes -Names @("Espionage")
            Command           = Get-TIPropertyValue -Object $attributes -Names @("Command")
            Administration    = Get-TIPropertyValue -Object $attributes -Names @("Administration")
            Science           = Get-TIPropertyValue -Object $attributes -Names @("Science")
            Security          = Get-TIPropertyValue -Object $attributes -Names @("Security")
            Loyalty           = Get-TIPropertyValue -Object $attributes -Names @("Loyalty")
            XP                = Get-TIPropertyValue -Object $councilor -Names @("XP")
            OrgNames          = ($orgNames -join ";")
        }
    }
)

if ($rows.Count -eq 0) {
    Write-Warning "No councilors found for $($selectedFaction.displayName) in $savePath"
}

if ($Format -eq "Table") {
    $rendered = $rows | Format-Table -AutoSize | Out-String
} elseif ($Format -eq "Csv") {
    $rendered = $rows | ConvertTo-Csv -NoTypeInformation | Out-String
} else {
    $rendered = $rows | ConvertTo-Json -Depth 5
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
    Write-Output "Wrote $($rows.Count) councilors to $OutputPath"
}
