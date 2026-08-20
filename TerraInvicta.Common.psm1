Set-StrictMode -Version Latest

function Test-TIConfigObject {
    param([AllowNull()] $Value)

    if ($null -eq $Value -or $Value -is [Array] -or
        ($Value -isnot [pscustomobject] -and $Value -isnot [hashtable])) { return $false }
    # ConvertFrom-Json returns PSCustomObject values. Enumerating the property
    # collection is deliberate: under StrictMode the collection itself does not
    # reliably expose a .Count property on every supported PowerShell build.
    return @($Value.PSObject.Properties).Count -gt 0
}

function Merge-TIConfigObject {
    param(
        [Parameter(Mandatory)] $Base,
        [Parameter(Mandatory)] $Override
    )

    foreach ($property in $Override.PSObject.Properties) {
        $existing = $Base.PSObject.Properties[$property.Name]
        if ($null -ne $existing -and
            (Test-TIConfigObject $property.Value) -and
            (Test-TIConfigObject $existing.Value)) {
            Merge-TIConfigObject -Base $existing.Value -Override $property.Value
        } else {
            if ($null -ne $existing) {
                $existing.Value = $property.Value
            } else {
                $Base | Add-Member -NotePropertyName $property.Name -NotePropertyValue $property.Value
            }
        }
    }
    return $Base
}

function Get-TIConfig {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string]$BasePath,
        [string]$ConfigPath
    )

    $defaultsPath = Join-Path $BasePath "config/defaults.json"
    if (-not (Test-Path -LiteralPath $defaultsPath -PathType Leaf)) {
        throw "Configuration defaults not found at $defaultsPath"
    }
    $defaults = Get-Content -LiteralPath $defaultsPath -Raw | ConvertFrom-Json
    $resolvedPath = if ($ConfigPath) { $ConfigPath } else { Join-Path $BasePath "config.json" }
    $user = $null
    if (Test-Path -LiteralPath $resolvedPath -PathType Leaf) {
        try { $user = Get-Content -LiteralPath $resolvedPath -Raw | ConvertFrom-Json }
        catch { throw "Invalid configuration at ${resolvedPath}: $($_.Exception.Message)" }
    }

    if ($null -ne $user) {
        # The retired config/intelligence_capabilities.json shape may be passed
        # explicitly as -ConfigPath. Its version/description metadata is
        # intentionally ignored; its lowercase templatesPath is handled by
        # PowerShell's case-insensitive property lookup below.
        $legacyMap = @{
            SavePath = @('paths', 'savePath'); WorkDir = @('paths', 'workDir');
            TemplatesPath = @('paths', 'templatesPath'); CsvSubDir = @('paths', 'csvSubDir');
            ShipInfoSubDir = @('paths', 'shipInfoSubDir'); AgainSaveSubDir = @('paths', 'againSaveSubDir');
            SummarySubDir = @('paths', 'summarySubDir'); SnippetPackSubDir = @('paths', 'snippetPackSubDir')
        }
        foreach ($legacy in $legacyMap.Keys) {
            $property = $user.PSObject.Properties[$legacy]
            if ($null -ne $property) {
                Write-Warning "config.json key '$legacy' is deprecated; use the nested configuration shape."
                $section = $defaults.PSObject.Properties[$legacyMap[$legacy][0]].Value
                $nestedKey = $legacyMap[$legacy][1]
                $section.$nestedKey = if ([string]::IsNullOrWhiteSpace([string]$property.Value) -and
                    $nestedKey -in @('savePath', 'templatesPath')) { $null } else { $property.Value }
            }
        }
        $nestedNames = @('paths', 'campaign', 'server', 'publishing', 'analysis')
        $hasNested = @($user.PSObject.Properties.Name | Where-Object { $_ -in $nestedNames }).Count -gt 0
        if ($hasNested) {
            Merge-TIConfigObject -Base $defaults -Override $user | Out-Null
        } else {
            if ($null -ne $user.PSObject.Properties['defaultObserverFaction']) {
                $defaults.campaign.defaultObserverFactionName = $user.defaultObserverFaction
            }
            if ($null -ne $user.PSObject.Properties['powerScoreWeights']) {
                Merge-TIConfigObject -Base $defaults.analysis.powerScore -Override ([pscustomobject]@{ weights = $user.powerScoreWeights }) | Out-Null
            }
            if ($null -ne $user.PSObject.Properties['intelligenceRules']) { $defaults.analysis.rules = $user.intelligenceRules }
            if ($null -ne $user.PSObject.Properties['effects']) { $defaults.analysis.effects = $user.effects }
            if ($null -ne $user.PSObject.Properties['strategicProjects']) { $defaults.analysis.strategicProjects = $user.strategicProjects }
        }
    }

    if ($env:TI_SAVE_PATH) { $defaults.paths.savePath = $env:TI_SAVE_PATH }
    if ($env:TI_TEMPLATES_DIR) { $defaults.paths.templatesPath = $env:TI_TEMPLATES_DIR }
    if ($env:SUPABASE_CAMPAIGN_KEY) { $defaults.campaign.key = $env:SUPABASE_CAMPAIGN_KEY }
    if ($env:SUPABASE_OBSERVER_FACTION_ID) { $defaults.campaign.defaultObserverFactionId = [int]$env:SUPABASE_OBSERVER_FACTION_ID }

    # Compatibility projection for the existing standalone scripts. New code
    # should read the nested properties above.
    $defaults | Add-Member -Force -NotePropertyName SavePath -NotePropertyValue $defaults.paths.savePath
    $defaults | Add-Member -Force -NotePropertyName WorkDir -NotePropertyValue $defaults.paths.workDir
    $defaults | Add-Member -Force -NotePropertyName TemplatesPath -NotePropertyValue $defaults.paths.templatesPath
    $defaults | Add-Member -Force -NotePropertyName CsvSubDir -NotePropertyValue $defaults.paths.csvSubDir
    $defaults | Add-Member -Force -NotePropertyName ShipInfoSubDir -NotePropertyValue $defaults.paths.shipInfoSubDir
    $defaults | Add-Member -Force -NotePropertyName AgainSaveSubDir -NotePropertyValue $defaults.paths.againSaveSubDir
    $defaults | Add-Member -Force -NotePropertyName SummarySubDir -NotePropertyValue $defaults.paths.summarySubDir
    return $defaults
}

function Resolve-TISaveFolder {
    param(
        [string]$ConfiguredSavePath,
        [string]$RequestedSaveFolder,
        [Parameter(Mandatory)] [string]$BasePath
    )
    $configured = if (-not [string]::IsNullOrWhiteSpace($RequestedSaveFolder)) { $RequestedSaveFolder } else { $ConfiguredSavePath }
    if ([string]::IsNullOrWhiteSpace($configured)) { throw "No save path configured; set paths.savePath in config.json or supply -SaveFolder." }
    if (-not [IO.Path]::IsPathRooted($configured)) { $configured = Join-Path $BasePath $configured }
    $resolved = [IO.Path]::GetFullPath($configured)
    if (Test-Path -LiteralPath $resolved -PathType Leaf) { return (Split-Path -Parent $resolved) }
    $folder = if ([IO.Path]::GetExtension($resolved)) { Split-Path -Parent $resolved } else { $resolved }
    if (-not (Test-Path -LiteralPath $folder -PathType Container)) { throw "Save folder not found: $folder" }
    return $folder
}

function Get-TISaveFiles {
    param([Parameter(Mandatory)] [string]$Folder)
    $files = @(Get-ChildItem -LiteralPath $Folder -File | Where-Object { $_.Extension.ToLowerInvariant() -in @('.gz', '.json') } | Sort-Object LastWriteTime -Descending)
    if ($files.Count -eq 0) { throw "No .gz or .json save files found in $Folder" }
    return $files
}

function Select-TISaveFile {
    param([Parameter(Mandatory)] [array]$Files, [int]$RequestedNumber = 0, [switch]$UseLatest)
    if ($UseLatest -and $RequestedNumber -gt 0) { throw 'Use either -Latest or -SaveNumber, not both.' }
    if ($UseLatest) { return $Files[0] }
    if ($RequestedNumber -gt 0) {
        if ($RequestedNumber -gt $Files.Count) { throw "Save number $RequestedNumber is out of range. Choose 1-$($Files.Count)." }
        return $Files[$RequestedNumber - 1]
    }
    Write-Host 'Available Terra Invicta saves:'
    for ($index = 0; $index -lt $Files.Count; $index++) { Write-Host ("  {0,2}. {1}  ({2})" -f ($index + 1), $Files[$index].Name, $Files[$index].LastWriteTime.ToString('yyyy-MM-dd HH:mm')) }
    do {
        $selection = 0
        $valid = [int]::TryParse((Read-Host ("Select a save number (1-{0})" -f $Files.Count)), [ref]$selection)
        if (-not $valid -or $selection -lt 1 -or $selection -gt $Files.Count) { Write-Warning ("Enter a number from 1 to {0}." -f $Files.Count); $selection = 0 }
    } while ($selection -eq 0)
    return $Files[$selection - 1]
}

function Get-TIStateValues {
    param([Parameter(Mandatory)] $StateContainer)
    if ($null -eq $StateContainer) { return @() }
    return @($StateContainer | ForEach-Object { if ($_.PSObject.Properties.Name -contains 'Value') { $_.Value } else { $_ } })
}

function Get-TIStateCollection {
    param([Parameter(Mandatory)] $GameStates, [Parameter(Mandatory)] [string]$StateName)
    if ($null -eq $GameStates) { return @() }
    $property = $GameStates.PSObject.Properties[$StateName]
    if ($null -eq $property) { return @() }
    return @(Get-TIStateValues -StateContainer $property.Value)
}

function Read-TISaveJson {
    param([Parameter(Mandatory)] [string]$Path)
    try {
        if ([IO.Path]::GetExtension($Path).ToLowerInvariant() -eq '.gz') {
            $bytes = [IO.File]::ReadAllBytes($Path)
            $stream = New-Object IO.MemoryStream(,$bytes)
            $gzip = New-Object IO.Compression.GzipStream($stream, [IO.Compression.CompressionMode]::Decompress)
            $reader = New-Object IO.StreamReader($gzip)
            $text = $reader.ReadToEnd()
            $reader.Dispose(); $gzip.Dispose(); $stream.Dispose()
        } else { $text = Get-Content -LiteralPath $Path -Raw }
        return ($text.TrimStart([char]0xFEFF) | ConvertFrom-Json)
    } catch { throw "Unable to read save file '$Path'. It may be locked or incomplete. $($_.Exception.Message)" }
}

function Get-TIReferenceId {
    param($Reference)
    if ($null -eq $Reference) { return $null }
    $value = if ($Reference.PSObject.Properties.Name -contains 'value') { $Reference.value } else { $Reference }
    if ($null -eq $value -or [string]::IsNullOrWhiteSpace([string]$value)) { return $null }
    return [int]$value
}

function Select-TIFaction {
    param([Parameter(Mandatory)] [array]$Factions, [int]$RequestedNumber = 0)
    if ($Factions.Count -eq 0) { throw 'No faction data found in save.' }
    if ($RequestedNumber -gt 0) {
        if ($RequestedNumber -gt $Factions.Count) { throw "Faction number $RequestedNumber is out of range. Choose 1-$($Factions.Count)." }
        return $Factions[$RequestedNumber - 1]
    }
    Write-Host 'Available factions:'
    for ($index = 0; $index -lt $Factions.Count; $index++) { Write-Host ("  {0,2}. {1}" -f ($index + 1), $Factions[$index].displayName) }
    do {
        $selection = 0
        $valid = [int]::TryParse((Read-Host ("Select a faction number (1-{0})" -f $Factions.Count)), [ref]$selection)
        if (-not $valid -or $selection -lt 1 -or $selection -gt $Factions.Count) { Write-Warning ("Enter a number from 1 to {0}." -f $Factions.Count); $selection = 0 }
    } while ($selection -eq 0)
    return $Factions[$selection - 1]
}

Export-ModuleMember -Function Get-TIConfig, Resolve-TISaveFolder, Get-TISaveFiles, Select-TISaveFile, Get-TIStateValues, Get-TIStateCollection, Read-TISaveJson, Get-TIReferenceId, Select-TIFaction
