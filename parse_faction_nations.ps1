<#
.SYNOPSIS
    Parses nations controlled by a selected faction from a Terra Invicta save.

.DESCRIPTION
    Infers the save folder from config.json, presents a numbered save picker,
    presents a numbered faction picker, and aggregates the selected faction's
    control points into one row per nation.

.EXAMPLE
    .\parse_faction_nations.ps1

.EXAMPLE
    .\parse_faction_nations.ps1 -Latest -FactionNumber 5 `
        -Format Csv -OutputPath ".\faction_nations.csv"

.EXAMPLE
    .\parse_faction_nations.ps1 -SaveNumber 1 -FactionNumber 6 `
        -Format Csv -OutputPath ".\faction_nations.csv"
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

function Get-TILastHistoryValue {
    param(
        $Object,

        [Parameter(Mandatory)]
        [string[]]$Names
    )

    $history = Get-TIPropertyValue -Object $Object -Names $Names
    if ($null -eq $history) {
        return $null
    }

    $historyValues = @($history)
    if ($historyValues.Count -eq 0) {
        return $null
    }

    return $historyValues[$historyValues.Count - 1]
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

$nationStates = Get-TIStateCollection -GameStates $gameStates -StateName "PavonisInteractive.TerraInvicta.TINationState"
$controlPointStates = Get-TIStateCollection -GameStates $gameStates -StateName "PavonisInteractive.TerraInvicta.TIControlPoint"

$nationById = @{}
foreach ($nation in $nationStates) {
    $nationId = Get-TIReferenceId -Reference $nation.ID
    if ($null -ne $nationId) {
        $nationById[$nationId] = $nation
    }
}

$controlPointById = @{}
foreach ($controlPoint in $controlPointStates) {
    $controlPointId = Get-TIReferenceId -Reference $controlPoint.ID
    if ($null -ne $controlPointId) {
        $controlPointById[$controlPointId] = $controlPoint
    }
}

$controlPointsByNationId = @{}
$factionControlPointReferences = Get-TIPropertyValue -Object $selectedFaction -Names @("controlPoints")
foreach ($controlPointReference in @($factionControlPointReferences)) {
    $controlPointId = Get-TIReferenceId -Reference $controlPointReference
    if ($null -eq $controlPointId -or -not $controlPointById.ContainsKey($controlPointId)) {
        continue
    }

    $controlPoint = $controlPointById[$controlPointId]
    $nationId = Get-TIReferenceId -Reference (Get-TIPropertyValue -Object $controlPoint -Names @("nation"))
    if ($null -eq $nationId -or -not $nationById.ContainsKey($nationId)) {
        continue
    }

    if (-not $controlPointsByNationId.ContainsKey($nationId)) {
        $controlPointsByNationId[$nationId] = @()
    }

    $controlPointsByNationId[$nationId] += $controlPoint
}

$rows = @(
    foreach ($nationId in $controlPointsByNationId.Keys) {
        $nation = $nationById[$nationId]
        $controlPoints = @($controlPointsByNationId[$nationId])
        $latestBoost = $null
        $boostHistory = @(Get-TIPropertyValue -Object $nation -Names @("historyBoost"))
        if ($boostHistory.Count -gt 0) {
            $latestBoost = $boostHistory[$boostHistory.Count - 1]
        }

        $nationControlPointCount = Get-TIPropertyValue -Object $nation -Names @("numControlPoints_unclamped", "numControlPoints")
        $boostPerCP = $null
        if ($null -ne $latestBoost -and $nationControlPointCount -gt 0) {
            $boostPerCP = [double]$latestBoost / [double]$nationControlPointCount
        }

        $regionCount = Get-TIPropertyValue -Object $nation -Names @("regionCount")
        if ($null -eq $regionCount) {
            $regionCount = @($nation.regions).Count
        }

        $population = Get-TIPropertyValue -Object $nation -Names @("population")
        if ($null -eq $population) {
            $population = Get-TILastHistoryValue -Object $nation -Names @("historyPopulation")
        }

        [PSCustomObject][ordered]@{
            FactionName          = $selectedFaction.displayName
            NationID             = $nationId
            NationName           = $nation.displayName
            NationTemplateName   = $nation.templateName
            ControlPoints        = $controlPoints.Count
            RegionCount          = $regionCount
            GDP                  = Get-TIPropertyValue -Object $nation -Names @("GDP", "gdp")
            Population           = $population
            MilTech              = Get-TIPropertyValue -Object $nation -Names @("milTech", "militaryTechLevel")
            Democracy            = Get-TIPropertyValue -Object $nation -Names @("democracy")
            Cohesion             = Get-TIPropertyValue -Object $nation -Names @("cohesion")
            Unrest               = Get-TIPropertyValue -Object $nation -Names @("unrest")
            Knowledge            = Get-TIPropertyValue -Object $nation -Names @("knowledge")
            Inequality           = Get-TIPropertyValue -Object $nation -Names @("inequality")
            ClimatePolicy        = Get-TIPropertyValue -Object $nation -Names @("climatePolicy")
            BoostHistoryLatest   = $latestBoost
            BoostPerCP           = $boostPerCP
            BoostTotalEst        = if ($null -ne $boostPerCP) { $boostPerCP * $controlPoints.Count } else { $null }
            ControlPointIDs      = (($controlPoints | ForEach-Object { Get-TIReferenceId -Reference $_.ID }) -join ";")
        }
    }
)

$rows = @($rows | Sort-Object NationName)
if ($rows.Count -eq 0) {
    Write-Warning "No nations found for $($selectedFaction.displayName) in $savePath"
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
    Write-Output "Wrote $($rows.Count) nations to $OutputPath"
}
