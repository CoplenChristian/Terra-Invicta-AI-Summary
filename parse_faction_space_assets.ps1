<#
.SYNOPSIS
    Parses space assets belonging to a selected faction from a Terra Invicta save.

.DESCRIPTION
    Infers the save folder from config.json, presents a numbered save picker,
    presents a numbered faction picker, and reports the selected faction's
    habs, fleets, and ships in one asset list.

.EXAMPLE
    .\parse_faction_space_assets.ps1

.EXAMPLE
    .\parse_faction_space_assets.ps1 -Latest -FactionNumber 5 `
        -Format Json -OutputPath ".\faction_space_assets.json"

.EXAMPLE
    .\parse_faction_space_assets.ps1 -SaveNumber 1 -FactionNumber 7 `
        -Format Json -OutputPath ".\faction_space_assets.json"
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

function Resolve-TIOrbitBodyName {
    param(
        $Asset,

        [Parameter(Mandatory)]
        [hashtable]$BodiesById,

        [Parameter(Mandatory)]
        [hashtable]$OrbitsById
    )

    $bodyId = Get-TIReferenceId -Reference (Get-TIPropertyValue -Object $Asset -Names @("barycenter"))
    if ($null -eq $bodyId) {
        $orbitId = Get-TIReferenceId -Reference (Get-TIPropertyValue -Object $Asset -Names @("orbitState"))
        if ($null -ne $orbitId -and $OrbitsById.ContainsKey($orbitId)) {
            $orbit = $OrbitsById[$orbitId]
            $bodyId = Get-TIReferenceId -Reference (Get-TIPropertyValue -Object $orbit -Names @("barycenter"))
        }
    }

    if ($null -eq $bodyId) {
        return "Unknown orbit"
    }

    if ($BodiesById.ContainsKey($bodyId)) {
        return $BodiesById[$bodyId].displayName
    }

    return "Unknown body"
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

$habStates = Get-TIStateCollection -GameStates $gameStates -StateName "PavonisInteractive.TerraInvicta.TIHabState"
$fleetStates = Get-TIStateCollection -GameStates $gameStates -StateName "PavonisInteractive.TerraInvicta.TISpaceFleetState"
$shipStates = Get-TIStateCollection -GameStates $gameStates -StateName "PavonisInteractive.TerraInvicta.TISpaceShipState"
$habSiteStates = Get-TIStateCollection -GameStates $gameStates -StateName "PavonisInteractive.TerraInvicta.TIHabSiteState"
$spaceBodies = Get-TIStateCollection -GameStates $gameStates -StateName "PavonisInteractive.TerraInvicta.TISpaceBodyState"
$orbitStates = Get-TIStateCollection -GameStates $gameStates -StateName "PavonisInteractive.TerraInvicta.TIOrbitState"

$bodiesById = @{}
foreach ($body in $spaceBodies) {
    $bodyId = Get-TIReferenceId -Reference $body.ID
    if ($null -ne $bodyId) {
        $bodiesById[$bodyId] = $body
    }
}

$orbitsById = @{}
foreach ($orbit in $orbitStates) {
    $orbitId = Get-TIReferenceId -Reference $orbit.ID
    if ($null -ne $orbitId) {
        $orbitsById[$orbitId] = $orbit
    }
}

$shipsById = @{}
foreach ($ship in $shipStates) {
    $shipId = Get-TIReferenceId -Reference $ship.ID
    if ($null -ne $shipId) {
        $shipsById[$shipId] = $ship
    }
}

$habSiteCountByHabId = @{}
foreach ($habSite in $habSiteStates) {
    $habId = Get-TIReferenceId -Reference (Get-TIPropertyValue -Object $habSite -Names @("hab"))
    if ($null -eq $habId) {
        continue
    }

    if (-not $habSiteCountByHabId.ContainsKey($habId)) {
        $habSiteCountByHabId[$habId] = 0
    }

    $habSiteCountByHabId[$habId] += 1
}

$factionHabs = @(
    $habStates | Where-Object {
        (Get-TIReferenceId -Reference $_.faction) -eq $selectedFactionId
    } | Sort-Object displayName
)

$factionFleets = @(
    $fleetStates | Where-Object {
        (Get-TIReferenceId -Reference $_.faction) -eq $selectedFactionId
    } | Sort-Object displayName
)

$rows = @()

foreach ($hab in $factionHabs) {
    $habId = Get-TIReferenceId -Reference $hab.ID
    $statusParts = @()
    if ((Get-TIPropertyValue -Object $hab -Names @("underBombardment", "underAssault")) -eq $true) {
        $statusParts += "Under attack"
    }
    if ((Get-TIPropertyValue -Object $hab -Names @("inCombat")) -eq $true) {
        $statusParts += "In combat"
    }

    $rows += [PSCustomObject][ordered]@{
        FactionName  = $selectedFaction.displayName
        AssetType    = "Hab"
        AssetID      = $habId
        AssetName    = $hab.displayName
        AssetSubtype = $hab.habType
        TemplateName = $hab.habSchematicTemplateName
        OrbitBody    = Resolve-TIOrbitBodyName -Asset $hab -BodiesById $bodiesById -OrbitsById $orbitsById
        ParentFleet  = $null
        ShipCount    = $null
        HabSiteCount = if ($habSiteCountByHabId.ContainsKey($habId)) { $habSiteCountByHabId[$habId] } else { 0 }
        InEarthLEO   = $hab.inEarthLEO
        Tier         = $hab.tier
        Status       = ($statusParts -join ";")
    }
}

foreach ($fleet in $factionFleets) {
    $fleetId = Get-TIReferenceId -Reference $fleet.ID
    $shipReferences = @(Get-TIPropertyValue -Object $fleet -Names @("ships"))
    $shipIds = @($shipReferences | ForEach-Object { Get-TIReferenceId -Reference $_ })
    $shipNames = @()
    foreach ($shipId in $shipIds) {
        if ($null -ne $shipId -and $shipsById.ContainsKey($shipId)) {
            $shipNames += $shipsById[$shipId].displayName
        }
    }

    $statusParts = @()
    if ((Get-TIPropertyValue -Object $fleet -Names @("inCombat")) -eq $true) {
        $statusParts += "In combat"
    }
    if ((Get-TIPropertyValue -Object $fleet -Names @("unavailableForOperations")) -eq $true) {
        $statusParts += "Unavailable"
    }

    $rows += [PSCustomObject][ordered]@{
        FactionName  = $selectedFaction.displayName
        AssetType    = "Fleet"
        AssetID      = $fleetId
        AssetName    = $fleet.displayName
        AssetSubtype = $fleet.templateName
        TemplateName = $fleet.templateName
        OrbitBody    = Resolve-TIOrbitBodyName -Asset $fleet -BodiesById $bodiesById -OrbitsById $orbitsById
        ParentFleet  = $null
        ShipCount    = $shipIds.Count
        HabSiteCount = $null
        InEarthLEO   = $null
        Tier         = $null
        Status       = ($statusParts -join ";")
    }

    foreach ($shipId in $shipIds) {
        if ($null -eq $shipId -or -not $shipsById.ContainsKey($shipId)) {
            continue
        }

        $ship = $shipsById[$shipId]
        $rows += [PSCustomObject][ordered]@{
            FactionName  = $selectedFaction.displayName
            AssetType    = "Ship"
            AssetID      = $shipId
            AssetName    = $ship.displayName
            AssetSubtype = $ship.templateName
            TemplateName = $ship.templateName
            OrbitBody    = Resolve-TIOrbitBodyName -Asset $fleet -BodiesById $bodiesById -OrbitsById $orbitsById
            ParentFleet  = $fleet.displayName
            ShipCount    = $null
            HabSiteCount = $null
            InEarthLEO   = $null
            Tier         = $null
            Status       = if ($ship.isDummy -eq $true) { "Dummy" } else { "" }
        }
    }
}

$rows = @($rows | Sort-Object AssetType, AssetName)
if ($rows.Count -eq 0) {
    Write-Warning "No space assets found for $($selectedFaction.displayName) in $savePath"
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
    Write-Output "Wrote $($rows.Count) space assets to $OutputPath"
}
