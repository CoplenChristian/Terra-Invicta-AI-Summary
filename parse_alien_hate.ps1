<#
.SYNOPSIS
    Parses alien hate toward each faction from a Terra Invicta save.

.DESCRIPTION
    Infers the save folder from config.json, presents a numbered save picker,
    and reads assessedAlienHateOfMe from each TIFactionState. The default
    output is a console table. The value is the game's assessed alien hate
    toward that faction; higher values indicate more alien hate.

.EXAMPLE
    .\parse_alien_hate.ps1

.EXAMPLE
    .\parse_alien_hate.ps1 -Latest -Format Csv `
        -OutputPath ".\alien_hate.csv"

.EXAMPLE
    .\parse_alien_hate.ps1 -SaveNumber 10 -Format Csv `
        -OutputPath ".\alien_hate.csv"
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
$savePath = $selectedSave.FullName

$saveJson = Read-TISaveJson -Path $savePath
$gameStates = $saveJson.gamestates

if ($null -eq $gameStates) {
    throw "Save does not contain a gamestates object: $savePath"
}

$factionStateName = "PavonisInteractive.TerraInvicta.TIFactionState"
$factionStateProperty = $gameStates.PSObject.Properties[$factionStateName]
if ($null -eq $factionStateProperty) {
    throw "Save does not contain faction state data: $savePath"
}

$factions = @(Get-TIStateValues -StateContainer $factionStateProperty.Value)

$rows = @(
    foreach ($faction in ($factions | Sort-Object displayName)) {
        [PSCustomObject][ordered]@{
            FactionID                 = Get-TIReferenceId -Reference $faction.ID
            FactionName               = $faction.displayName
            TemplateName              = $faction.templateName
            AssessedAlienHateOfMe     = $faction.assessedAlienHateOfMe
        }
    }
)

if ($rows.Count -eq 0) {
    Write-Warning "No faction data found in $savePath"
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
    Write-Output "Wrote $($rows.Count) faction alien-hate values to $OutputPath"
}
