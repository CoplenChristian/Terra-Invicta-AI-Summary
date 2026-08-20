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

$saveFolderPath = Resolve-TISaveFolder `
    -ConfiguredSavePath $config.SavePath `
    -RequestedSaveFolder $SaveFolder `
    -BasePath $scriptPath
$saveFiles = Get-TISaveFiles -Folder $saveFolderPath
$selectedSave = Select-TISaveFile -Files $saveFiles -RequestedNumber $SaveNumber -UseLatest:$Latest
$SavePath = $selectedSave.FullName

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
