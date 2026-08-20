Set-StrictMode -Version Latest

function Test-TIConfigObject {
    param([AllowNull()] $Value)

    if ($null -eq $Value -or $Value -is [Array] -or
        ($Value -isnot [pscustomobject] -and $Value -isnot [hashtable])) { return $false }
    # Empty JSON objects are still mergeable objects. Treating them as scalar
    # values would replace an entire default section with {}, unlike the JS
    # loader's deep merge behavior.
    return $true
}

function Assert-TIConfigKeys {
    param(
        [AllowNull()] $Value,
        [AllowNull()] $Default,
        [Parameter(Mandatory)] [string]$Path,
        [string[]]$AllowedKeys = @()
    )

    if ($null -eq $Value) { return }
    if ($Value -is [Array]) {
        # Only strategicProjects is an array of configurable objects. Other
        # arrays in the schema contain scalar enum values and need no key walk.
        if ($Path -eq 'config.analysis.strategicProjects') {
            foreach ($item in $Value) {
                Assert-TIConfigKeys -Value $item -Default $null -Path "$Path[]" -AllowedKeys @('id', 'name', 'benefit', 'risk')
            }
        }
        return
    }
    if (-not (Test-TIConfigObject $Value)) { return }

    # Effects are a map keyed by game effect ID, so the map keys themselves are
    # intentionally open while each descriptor has a closed set of properties.
    if ($Path -eq 'config.analysis.effects') {
        foreach ($effect in $Value.PSObject.Properties) {
            Assert-TIConfigKeys -Value $effect.Value -Default $null -Path "$Path.$($effect.Name)" -AllowedKeys @('capability', 'outputKey', 'name', 'category', 'description', 'defaultProject', 'defaultTech')
        }
        return
    }

    foreach ($property in $Value.PSObject.Properties) {
        if ($AllowedKeys.Count -gt 0) {
            if ($property.Name -notin $AllowedKeys) {
                throw "Unknown configuration key '$Path.$($property.Name)'."
            }
            # Descriptor/project-item objects have an intentionally explicit
            # key list but no single default object to compare against. Their
            # Scalar values are validated by the schema-driven pass after the
            # partial configuration has been merged with defaults.
            continue
        }
        $defaultProperty = if (Test-TIConfigObject $Default) {
            $Default.PSObject.Properties[$property.Name]
        } else { $null }
        if ($null -eq $defaultProperty) {
            throw "Unknown configuration key '$Path.$($property.Name)'."
        }
        Assert-TIConfigKeys -Value $property.Value -Default $defaultProperty.Value -Path "$Path.$($property.Name)"
    }
}

function Get-TIJsonType {
    param([AllowNull()] $Value)

    if ($null -eq $Value) { return 'null' }
    if ($Value -is [Array]) { return 'array' }
    if ($Value -is [bool]) { return 'boolean' }
    if ($Value -is [string]) { return 'string' }
    if ($Value -is [byte] -or $Value -is [sbyte] -or
        $Value -is [int16] -or $Value -is [uint16] -or
        $Value -is [int32] -or $Value -is [uint32] -or
        $Value -is [int64] -or $Value -is [uint64] -or
        $Value -is [single] -or $Value -is [double] -or $Value -is [decimal]) { return 'number' }
    if (Test-TIConfigObject $Value) { return 'object' }
    return 'unknown'
}

function Test-TIJsonValueEqual {
    param($Left, $Right)

    $leftJson = ConvertTo-Json -InputObject $Left -Compress -Depth 20
    $rightJson = ConvertTo-Json -InputObject $Right -Compress -Depth 20
    return $leftJson -eq $rightJson
}

function Resolve-TIConfigSchemaRef {
    param(
        [Parameter(Mandatory)] $Root,
        [Parameter(Mandatory)] [string]$Reference
    )

    if ($Reference -notmatch '^#\/\$defs\/(?<name>.+)$') {
        throw "Unsupported configuration schema reference '$Reference'."
    }
    $definition = $Root.'$defs'.PSObject.Properties[$Matches.name]
    if ($null -eq $definition) { throw "Configuration schema definition '$($Matches.name)' was not found." }
    return $definition.Value
}

function Get-TIConfigSchemaProperty {
    param(
        [Parameter(Mandatory)] $Schema,
        [Parameter(Mandatory)] [string]$Name
    )

    $property = $Schema.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function Assert-TIConfigSchema {
    <#
      Validate the resolved configuration against the checked-in JSON Schema.
      This is deliberately schema-driven so PowerShell does not maintain a
      second list of numeric ranges and required fields that could drift from
      the Node loader. Key validation above runs before merge to give partial
      config files useful typo errors; this pass validates the complete result.
    #>
    param(
        [AllowNull()] $Value,
        [Parameter(Mandatory)] $Schema,
        [Parameter(Mandatory)] $Root,
        [Parameter(Mandatory)] [string]$Path
    )

    $reference = Get-TIConfigSchemaProperty -Schema $Schema -Name '$ref'
    if ($null -ne $reference) {
        $Schema = Resolve-TIConfigSchemaRef -Root $Root -Reference $reference
    }

    $oneOf = Get-TIConfigSchemaProperty -Schema $Schema -Name 'oneOf'
    if ($null -ne $oneOf) {
        $alternativeMatches = 0
        foreach ($branch in @($oneOf)) {
            try {
                Assert-TIConfigSchema -Value $Value -Schema $branch -Root $Root -Path $Path
                $alternativeMatches++
            } catch { }
        }
        if ($alternativeMatches -ne 1) { throw "Configuration at '$Path' must match exactly one schema alternative." }
    }

    $constant = Get-TIConfigSchemaProperty -Schema $Schema -Name 'const'
    if ($null -ne $constant -and -not (Test-TIJsonValueEqual $Value $constant)) {
        throw "Configuration value at '$Path' must equal '$constant'."
    }

    $actualType = Get-TIJsonType $Value
    $typeSchema = Get-TIConfigSchemaProperty -Schema $Schema -Name 'type'
    $allowedTypes = @()
    if ($null -ne $typeSchema) {
        $allowedTypes = @($typeSchema)
        $typeMatches = $actualType -in $allowedTypes
        if ($actualType -eq 'integer' -and 'number' -in $allowedTypes) { $typeMatches = $true }
        if ($actualType -eq 'number' -and 'integer' -in $allowedTypes -and [math]::Truncate([double]$Value) -eq [double]$Value) { $typeMatches = $true }
        if (-not $typeMatches) {
            throw "Configuration value at '$Path' must be type $($allowedTypes -join ' or '), got $actualType."
        }
    }

    $enum = Get-TIConfigSchemaProperty -Schema $Schema -Name 'enum'
    if ($null -ne $enum) {
        $allowed = @(@($enum) | Where-Object { Test-TIJsonValueEqual $Value $_ })
        if ($allowed.Count -eq 0) { throw "Configuration value at '$Path' is not an allowed value." }
    }

    $minLength = Get-TIConfigSchemaProperty -Schema $Schema -Name 'minLength'
    if ($null -ne $minLength -and ([string]$Value).Length -lt [int]$minLength) {
        throw "Configuration value at '$Path' is shorter than the minimum length."
    }
    $pattern = Get-TIConfigSchemaProperty -Schema $Schema -Name 'pattern'
    if ($null -ne $pattern -and -not [regex]::IsMatch([string]$Value, [string]$pattern)) {
        throw "Configuration value at '$Path' does not match the required pattern."
    }

    $minimum = Get-TIConfigSchemaProperty -Schema $Schema -Name 'minimum'
    $maximum = Get-TIConfigSchemaProperty -Schema $Schema -Name 'maximum'
    $exclusiveMinimum = Get-TIConfigSchemaProperty -Schema $Schema -Name 'exclusiveMinimum'
    $exclusiveMaximum = Get-TIConfigSchemaProperty -Schema $Schema -Name 'exclusiveMaximum'
    if ($actualType -in @('number', 'integer')) {
        $number = [double]$Value
        if ($null -ne $minimum -and $number -lt [double]$minimum) { throw "Configuration value at '$Path' is below the minimum." }
        if ($null -ne $maximum -and $number -gt [double]$maximum) { throw "Configuration value at '$Path' is above the maximum." }
        if ($null -ne $exclusiveMinimum -and $number -le [double]$exclusiveMinimum) { throw "Configuration value at '$Path' must be greater than the exclusive minimum." }
        if ($null -ne $exclusiveMaximum -and $number -ge [double]$exclusiveMaximum) { throw "Configuration value at '$Path' must be less than the exclusive maximum." }
        if ('integer' -in $allowedTypes -and [math]::Truncate($number) -ne $number) { throw "Configuration value at '$Path' must be an integer." }
    }

    $minItems = Get-TIConfigSchemaProperty -Schema $Schema -Name 'minItems'
    $uniqueItems = Get-TIConfigSchemaProperty -Schema $Schema -Name 'uniqueItems'
    $items = Get-TIConfigSchemaProperty -Schema $Schema -Name 'items'
    if ($actualType -eq 'array') {
        if ($null -ne $minItems -and $Value.Count -lt [int]$minItems) { throw "Configuration array at '$Path' has too few items." }
        if ($uniqueItems -eq $true) {
            $serialized = @($Value | ForEach-Object { ConvertTo-Json -InputObject $_ -Compress -Depth 20 })
            $uniqueSerialized = @($serialized | Select-Object -Unique)
            if ($uniqueSerialized.Count -ne $serialized.Count) { throw "Configuration array at '$Path' must contain unique items." }
        }
        if ($null -ne $items) {
            foreach ($item in $Value) { Assert-TIConfigSchema -Value $item -Schema $items -Root $Root -Path "$Path[]" }
        }
    }

    if ($actualType -eq 'object') {
        $requiredKeys = Get-TIConfigSchemaProperty -Schema $Schema -Name 'required'
        if ($null -ne $requiredKeys) {
            foreach ($required in @($requiredKeys)) {
                if ($null -eq $Value.PSObject.Properties[$required]) { throw "Configuration key '$Path.$required' is required." }
            }
        }
        $properties = Get-TIConfigSchemaProperty -Schema $Schema -Name 'properties'
        $additionalProperties = Get-TIConfigSchemaProperty -Schema $Schema -Name 'additionalProperties'
        foreach ($property in $Value.PSObject.Properties) {
            $propertySchema = if ($null -ne $properties) { $properties.PSObject.Properties[$property.Name] } else { $null }
            if ($null -ne $propertySchema) {
                Assert-TIConfigSchema -Value $property.Value -Schema $propertySchema.Value -Root $Root -Path "$Path.$($property.Name)"
            } elseif ($additionalProperties -eq $false) {
                throw "Unknown configuration key '$Path.$($property.Name)'."
            } elseif ($null -ne $additionalProperties -and $additionalProperties -ne $true) {
                Assert-TIConfigSchema -Value $property.Value -Schema $additionalProperties -Root $Root -Path "$Path.$($property.Name)"
            }
        }
    }
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
        $legacyNames = @($legacyMap.Keys + 'version', 'description',
            'defaultObserverFaction', 'powerScoreWeights', 'intelligenceRules',
            'effects', 'strategicProjects')
        $nestedNames = @('paths', 'campaign', 'server', 'publishing', 'analysis')
        $hasNested = @($user.PSObject.Properties.Name | Where-Object { $_ -in $nestedNames }).Count -gt 0
        if ($hasNested) {
            Assert-TIConfigKeys -Value $user -Default $defaults -Path 'config'
        } else {
            $unknownLegacy = @($user.PSObject.Properties.Name | Where-Object { $_ -notin $legacyNames })
            if ($unknownLegacy.Count -gt 0) {
                throw "Unknown configuration key(s): $($unknownLegacy -join ', ')"
            }
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

    # strategicHistory.retention is canonical. Keep the publishing alias in
    # sync for older scripts, with environment > canonical nested > alias
    # precedence matching the Node configuration loader.
    $retention = $null
    if ($env:SUPABASE_HISTORY_RETENTION) {
        $retention = [int]$env:SUPABASE_HISTORY_RETENTION
    } elseif ($null -ne $user) {
        $userAnalysis = $user.PSObject.Properties['analysis']
        $userHistory = if ($null -ne $userAnalysis) { $userAnalysis.Value.PSObject.Properties['strategicHistory'] } else { $null }
        $canonicalRetention = if ($null -ne $userHistory) { $userHistory.Value.PSObject.Properties['retention'] } else { $null }
        if ($null -ne $canonicalRetention -and $null -ne $canonicalRetention.Value) {
            $retention = $canonicalRetention.Value
        } else {
            $userPublishing = $user.PSObject.Properties['publishing']
            $aliasRetention = if ($null -ne $userPublishing) { $userPublishing.Value.PSObject.Properties['historyRetention'] } else { $null }
            if ($null -ne $aliasRetention) { $retention = $aliasRetention.Value }
        }
    }
    if ($null -ne $retention) {
        $defaults.publishing.historyRetention = $retention
        $defaults.analysis.strategicHistory.retention = $retention
    }

    $schemaPath = Join-Path $BasePath "config/config.schema.json"
    if (-not (Test-Path -LiteralPath $schemaPath -PathType Leaf)) {
        throw "Configuration schema not found at $schemaPath"
    }
    $schema = Get-Content -LiteralPath $schemaPath -Raw | ConvertFrom-Json
    Assert-TIConfigSchema -Value $defaults -Schema $schema -Root $schema -Path 'config'

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
