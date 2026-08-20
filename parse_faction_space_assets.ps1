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
$configPath = Join-Path $scriptPath "config.json"

if (-not (Test-Path -LiteralPath $configPath)) {
    throw "Config file not found at $configPath"
}

$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json

function Resolve-TISaveFolder {
    param(
        [string]$ConfiguredSavePath,
        [string]$RequestedSaveFolder,
        [Parameter(Mandatory)]
        [string]$BasePath
    )

    if (-not [string]::IsNullOrWhiteSpace($RequestedSaveFolder)) {
        $folder = $RequestedSaveFolder
        if (-not [IO.Path]::IsPathRooted($folder)) {
            $folder = Join-Path $BasePath $folder
        }
    } else {
        if ([string]::IsNullOrWhiteSpace($ConfiguredSavePath)) {
            throw "config.json does not define SavePath; supply -SaveFolder."
        }

        $configuredPath = $ConfiguredSavePath
        if (-not [IO.Path]::IsPathRooted($configuredPath)) {
            $configuredPath = Join-Path $BasePath $configuredPath
        }

        $folder = Split-Path -Parent $configuredPath
    }

    $folder = [IO.Path]::GetFullPath($folder)
    if (-not (Test-Path -LiteralPath $folder -PathType Container)) {
        throw "Save folder not found: $folder"
    }

    return $folder
}

function Get-TISaveFiles {
    param(
        [Parameter(Mandatory)]
        [string]$Folder
    )

    $files = @(
        Get-ChildItem -LiteralPath $Folder -File |
            Where-Object { $_.Extension.ToLowerInvariant() -in @(".gz", ".json") } |
            Sort-Object LastWriteTime -Descending
    )

    if ($files.Count -eq 0) {
        throw "No .gz or .json save files found in $Folder"
    }

    return $files
}

function Select-TISaveFile {
    param(
        [Parameter(Mandatory)]
        [array]$Files,

        [int]$RequestedNumber = 0,

        [switch]$UseLatest
    )

    if ($UseLatest -and $RequestedNumber -gt 0) {
        throw "Use either -Latest or -SaveNumber, not both."
    }

    if ($UseLatest) {
        return $Files[0]
    }

    if ($RequestedNumber -gt 0) {
        if ($RequestedNumber -gt $Files.Count) {
            throw "Save number $RequestedNumber is out of range. Choose 1-$($Files.Count)."
        }

        return $Files[$RequestedNumber - 1]
    }

    Write-Host "Available Terra Invicta saves:"
    for ($index = 0; $index -lt $Files.Count; $index++) {
        $file = $Files[$index]
        Write-Host ("  {0,2}. {1}  ({2})" -f ($index + 1), $file.Name, $file.LastWriteTime.ToString("yyyy-MM-dd HH:mm"))
    }

    do {
        $selectionText = Read-Host ("Select a save number (1-{0})" -f $Files.Count)
        $selection = 0
        $validNumber = [int]::TryParse($selectionText, [ref]$selection)
        if (-not $validNumber -or $selection -lt 1 -or $selection -gt $Files.Count) {
            Write-Warning ("Enter a number from 1 to {0}." -f $Files.Count)
            $selection = 0
        }
    } while ($selection -eq 0)

    return $Files[$selection - 1]
}

function Get-TIStateValues {
    param(
        [Parameter(Mandatory)]
        $StateContainer
    )

    if ($null -eq $StateContainer) {
        return @()
    }

    return @($StateContainer | ForEach-Object {
        if ($_.PSObject.Properties.Name -contains "Value") {
            $_.Value
        } else {
            $_
        }
    })
}

function Get-TIStateCollection {
    param(
        [Parameter(Mandatory)]
        $GameStates,

        [Parameter(Mandatory)]
        [string]$StateName
    )

    $stateProperty = $GameStates.PSObject.Properties[$StateName]
    if ($null -eq $stateProperty) {
        return @()
    }

    return @(Get-TIStateValues -StateContainer $stateProperty.Value)
}

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

function Get-TIReferenceId {
    param(
        $Reference
    )

    if ($null -eq $Reference) {
        return $null
    }

    $value = $Reference
    if ($Reference.PSObject.Properties.Name -contains "value") {
        $value = $Reference.value
    }

    if ($null -eq $value -or [string]::IsNullOrWhiteSpace([string]$value)) {
        return $null
    }

    return [int]$value
}

function Select-TIFaction {
    param(
        [Parameter(Mandatory)]
        [array]$Factions,

        [int]$RequestedNumber = 0
    )

    if ($RequestedNumber -gt 0) {
        if ($RequestedNumber -gt $Factions.Count) {
            throw "Faction number $RequestedNumber is out of range. Choose 1-$($Factions.Count)."
        }

        return $Factions[$RequestedNumber - 1]
    }

    Write-Host "Available factions:"
    for ($index = 0; $index -lt $Factions.Count; $index++) {
        Write-Host ("  {0,2}. {1}" -f ($index + 1), $Factions[$index].displayName)
    }

    do {
        $selectionText = Read-Host ("Select a faction number (1-{0})" -f $Factions.Count)
        $selection = 0
        $validNumber = [int]::TryParse($selectionText, [ref]$selection)
        if (-not $validNumber -or $selection -lt 1 -or $selection -gt $Factions.Count) {
            Write-Warning ("Enter a number from 1 to {0}." -f $Factions.Count)
            $selection = 0
        }
    } while ($selection -eq 0)

    return $Factions[$selection - 1]
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

function Read-TISaveJson {
    param(
        [Parameter(Mandatory)]
        [string]$Path
    )

    $jsonText = $null

    if ([IO.Path]::GetExtension($Path).ToLowerInvariant() -eq ".gz") {
        $fileStream = $null
        $gzipStream = $null
        $reader = $null
        try {
            $fileStream = [IO.File]::OpenRead($Path)
            $gzipStream = New-Object IO.Compression.GzipStream(
                $fileStream,
                [IO.Compression.CompressionMode]::Decompress
            )
            $reader = New-Object IO.StreamReader($gzipStream)
            $jsonText = $reader.ReadToEnd()
        }
        catch {
            throw "Unable to read save file '$Path'. It may be locked or incomplete. $($_.Exception.Message)"
        }
        finally {
            if ($null -ne $reader) { $reader.Dispose() }
            if ($null -ne $gzipStream) { $gzipStream.Dispose() }
            if ($null -ne $fileStream) { $fileStream.Dispose() }
        }
    } else {
        $jsonText = Get-Content -LiteralPath $Path -Raw
    }

    return ($jsonText | ConvertFrom-Json)
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
