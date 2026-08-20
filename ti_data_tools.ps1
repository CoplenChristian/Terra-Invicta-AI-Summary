<# 
.SYNOPSIS
Utility toolbox for analyzing Terra Invicta exports for the "Again" campaign.

.DESCRIPTION
This script provides reusable functions for:
  - Loading the `Again_*.csv` exports and related helper CSVs.
  - Producing faction overviews (Earth + space + Boost).
  - Summarizing Resistance-controlled nations for the "Current Nation Control" section.
  - (Future) councilor, space sitrep, change-delta, and summary-scaffold helpers.

It is designed to be dot-sourced once per session from the configured RootPath
in config.json (loaded via TIConfig):
  PS> Set-Location <RootPath from config.json>
  PS> . .\ti_data_tools.ps1
  PS> Get-TIFactionOverview -Format Markdown

Use `Invoke-TIDataMenu` for a simple interactive entry point.
#>

Set-StrictMode -Version Latest

#region Configuration

# Load configuration
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$commonModulePath = Join-Path $scriptPath "TerraInvicta.Common.psm1"
Import-Module -Name $commonModulePath -Force
$config = Get-TIConfig -BasePath $scriptPath

$WorkDir = $config.WorkDir
if ($WorkDir -eq ".") { $WorkDir = $scriptPath }

$script:TIConfig = [ordered]@{
    # Root folder for this campaign
    RootPath        = $WorkDir

    # Default export folder for latest CSVs
    ExportFolder    = $config.CsvSubDir

    # Path to summary Boost helper (already created)
    BoostHelperPath = "summarize_boost_income.ps1"
}

function Set-TIDataConfig {
    <#
    .SYNOPSIS
    Override default paths/config for this toolbox.

    .EXAMPLE
    Set-TIDataConfig -RootPath "d:/TI/AnotherCampaign" -ExportFolder "Save_Feb"
    #>
    param(
        [string]$RootPath,
        [string]$ExportFolder
    )

    if ($PSBoundParameters.ContainsKey('RootPath')) {
        $script:TIConfig.RootPath = $RootPath
    }
    if ($PSBoundParameters.ContainsKey('ExportFolder')) {
        $script:TIConfig.ExportFolder = $ExportFolder
    }
}

function Get-TIDataPath {
    param(
        [string]$RelativePath
    )
    return (Join-Path $script:TIConfig.RootPath $RelativePath)
}

function Get-TIExportPath {
    param(
        [string]$FileName
    )
    $exportRoot = Get-TIDataPath -RelativePath $script:TIConfig.ExportFolder
    return (Join-Path $exportRoot $FileName)
}

#endregion Configuration

#region Data loading and cache (memoization)

if (-not (Get-Variable -Name TIData -Scope Script -ErrorAction SilentlyContinue)) {
    $script:TIData = @{}
}

function Reset-TIDataCache {
    <#
    .SYNOPSIS
    Clears cached CSV data so subsequent calls reload from disk.
    #>
    $script:TIData = @{}
    Reset-TIComponentTechWeights
}

function Get-TICsv {
    param(
        [Parameter(Mandatory)]
        [string]$Name,          # logical name, used as cache key
        [Parameter(Mandatory)]
        [string]$FileName       # actual CSV file name in export folder
    )

    $path = Get-TIExportPath -FileName $FileName
    if (-not (Test-Path $path)) {
        throw "CSV not found: $path (Name=$Name)"
    }

    $data = Import-Csv -Path $path
    $script:TIData[$Name] = $data
    return $data
}

# Convenience getters for frequently used CSVs

function Get-TIFactionsCore {
    return Get-TICsv -Name "FactionsCore" -FileName "Again_Factions_Core.csv"
}

function Get-TIFactionEarthSummary {
    return Get-TICsv -Name "EarthSummary" -FileName "Again_Faction_EarthSummary.csv"
}

function Get-TIFactionHabIncome {
    return Get-TICsv -Name "HabIncome" -FileName "Again_Faction_HabIncome.csv"
}

function Get-TIFactionHabMiningIncome {
    return Get-TICsv -Name "HabMiningIncome" -FileName "Again_Faction_HabMiningIncome.csv"
}

function Get-TIResistanceNations {
    return Get-TICsv -Name "ResistanceNations" -FileName "Again_Resistance_Nations.csv"
}

function Get-TIResistanceCouncilors {
    return Get-TICsv -Name "ResistanceCouncilors" -FileName "Again_Resistance_Councilors.csv"
}

function Get-TICouncilorRecruits {
    return Get-TICsv -Name "CouncilorRecruits" -FileName "Again_Councilor_Recruits.csv"
}

function Get-TIFactionHateMatrix {
    return Get-TICsv -Name "FactionHateMatrix" -FileName "Again_Faction_HateMatrix.csv"
}

function Get-TIHabSites {
    return Get-TICsv -Name "HabSites" -FileName "Again_HabSites.csv"
}

function Get-TIAliensHabs {
    return Get-TICsv -Name "AliensHabs" -FileName "Again_Aliens_Habs.csv"
}

function Get-TISpaceBodies {
    return Get-TICsv -Name "SpaceBodies" -FileName "Again_SpaceBodies.csv"
}

function Get-TIAsteroidBeltBodyIds {
    <#
    .SYNOPSIS
    Returns BodyIDs for main-belt asteroids based on displayName heuristics.

    .DESCRIPTION
    Uses Again_SpaceBodies.csv and assumes anything whose displayName is NOT a
    major planet or large moon and whose Parent/Barycenter is Sol/Jupiter is an
    asteroid or small body. This is an approximation sufficient for ranking
    unclaimed high-yield sites in the belt.
    #>
    $bodies = Get-TISpaceBodies

    $majorNames = @(
        "Sol","Mercury","Venus","Earth","Luna","Mars",
        "Jupiter","Saturn","Uranus","Neptune","Pluto"
    )

    $beltIds = @()
    foreach ($b in $bodies) {
        $name = $b.displayName
        $id   = [int]$b.BodyID

        if ($majorNames -contains $name) { continue }

        # Treat non-major bodies orbiting Sol or Jupiter as "belt-ish" asteroids.
        $parentId = if ($b.BarycenterID) { [int]$b.BarycenterID } else { 0 }
        if ($parentId -in 2,10) {
            $beltIds += $id
        }
    }

    return $beltIds
}

function Get-TITopUnclaimedBeltSites {
    <#
    .SYNOPSIS
    Returns top unclaimed asteroid-belt hab sites by total resource output.

    .PARAMETER Top
    Number of sites to return (default 10).
    #>
    param(
        [int]$Top = 10
    )

    $sites   = Get-TIHabSites
    $beltIds = Get-TIAsteroidBeltBodyIds
    if (-not $sites -or -not $beltIds) { return @() }

    $beltSet = [System.Collections.Generic.HashSet[int]]::new()
    foreach ($id in $beltIds) { [void]$beltSet.Add([int]$id) }

    $rows = @()
    foreach ($s in $sites) {
        $bodyId = [int]$s.ParentBodyID

        if (-not $beltSet.Contains($bodyId)) { continue }

        # Unclaimed: no Hab and no FactionID
        if ($s.HasHab -eq "True" -or $s.FactionID) { continue }

        $water     = [double]$s.WaterPerDay
        $volatiles = [double]$s.VolatilesPerDay
        $metals    = [double]$s.MetalsPerDay
        $nobles    = [double]$s.NoblesPerDay
        $fissiles  = [double]$s.FissilesPerDay

        $score = $water + $volatiles + $metals + $nobles + $fissiles

        $rows += [PSCustomObject]@{
            SiteID          = [int]$s.SiteID
            SiteName        = $s.displayName
            BodyName        = $s.ParentBodyName
            WaterPerDay     = $water
            VolatilesPerDay = $volatiles
            MetalsPerDay    = $metals
            NoblesPerDay    = $nobles
            FissilesPerDay  = $fissiles
            TotalOutput     = [math]::Round($score,3)
        }
    }

    $rows = $rows | Sort-Object -Property TotalOutput -Descending | Select-Object -First $Top
    return $rows
}

function Get-TIHabsAll {
    return Get-TICsv -Name "HabsAll" -FileName "Again_Habs_All.csv"
}

function Get-TIFactionHabs {
    param(
        [Parameter(Mandatory)]
        [string]$FactionShortName
    )

    $fileName = "Again_{0}_Habs.csv" -f $FactionShortName
    $nameKey  = "{0}Habs" -f $FactionShortName
    return Get-TICsv -Name $nameKey -FileName $fileName
}

function Get-TIFactionProjects {
    param(
        [Parameter(Mandatory)]
        [string]$FactionShortName
    )

    $fileName = "Again_{0}_Projects.csv" -f $FactionShortName
    $nameKey  = "{0}Projects" -f $FactionShortName
    return Get-TICsv -Name $nameKey -FileName $fileName
}

function Get-TIResistanceProjects {
    return Get-TICsv -Name "ResistanceProjects" -FileName "Again_Resistance_Projects.csv"
}

function Get-TIFactionAlienHate {
    return Get-TICsv -Name "FactionAlienHate" -FileName "Again_Faction_AlienHate.csv"
}

#endregion Data loading and cache

#region Component tech weights and scoring

$script:TIComponentTechWeights = $null

$script:TIComponentWeightHintRules = @(
    @{ Pattern = "AlienAdvanced"; Weight = 12 },
    @{ Pattern = "AlienMaster"; Weight = 11 },
    @{ Pattern = "Alien"; Weight = 10 },
    @{ Pattern = "Antimatter"; Weight = 9 },
    @{ Pattern = "Zeta|Nova|Reflex|Torch|Polywell|Pulsar|Plasmajet|Lantern|Triton|Helion|Protium|Deuteron|Borane"; Weight = 8 },
    @{ Pattern = "Fusion|Plasma"; Weight = 7 },
    @{ Pattern = "Pulsed|BeamCore|Pion"; Weight = 7 },
    @{ Pattern = "Molten|Gas|Cermet|Nerva|Kiwi|Dumbo|Snare|Rover|Pulsar"; Weight = 5 },
    @{ Pattern = "MassDriver|Lorentz|Helicon|VASIMR|Amplitron|Arcjet|Resistojet|Grid|Colloid|Ion|Hall"; Weight = 4 },
    @{ Pattern = "Rail|Coil|Mag"; Weight = 3 },
    @{ Pattern = "Laser|Phaser|ArcLaser|Beam"; Weight = 3 }
)

function Reset-TIComponentTechWeights {
    $script:TIComponentTechWeights = $null
}

function Get-TIShipComponentJson {
    param(
        [Parameter(Mandatory)]
        [string]$FileName
    )

    $relative = Join-Path "Ship_Info/raw_json" $FileName
    $path = Get-TIDataPath -RelativePath $relative
    if (-not (Test-Path $path)) {
        Write-Verbose ("[Get-TIShipComponentJson] Missing file {0}" -f $path)
        return @()
    }

    try {
        return (Get-Content $path -Raw | ConvertFrom-Json)
    } catch {
        Write-Warning ("Failed to parse {0}: {1}" -f $path, $_.Exception.Message)
        return @()
    }
}

function Get-TIComponentWeightValue {
    param(
        [string]$ProjectName,
        [hashtable]$Source,
        [object]$Entry,
        [string]$TierName
    )

    if (-not $ProjectName) { return 0 }

    if ($TierName -and $Source.ContainsKey('TierWeights') -and $Source.TierWeights.ContainsKey($TierName)) {
        return [double]$Source.TierWeights[$TierName]
    }

    if ($ProjectName -match "Mk(\d+)") {
        return [double][int]$matches[1]
    }

    if ($ProjectName -match "Tier(\d+)") {
        return [double][int]$matches[1]
    }

    $hintWeight = 0.0
    foreach ($rule in $script:TIComponentWeightHintRules) {
        if ($ProjectName -match $rule.Pattern) {
            if ([double]$rule.Weight -gt $hintWeight) {
                $hintWeight = [double]$rule.Weight
            }
        }
    }

    if ($hintWeight -gt 0) { return $hintWeight }

    if ($Source.ContainsKey('DefaultWeight') -and $Source.DefaultWeight) { return [double]$Source.DefaultWeight }

    return 1.0
}

function Initialize-TIComponentTechWeights {
    $sources = @(
        @{
            File        = "TIDriveTemplate.json"
            Component   = "Drive"
            TierProperty = "driveClassification"
            TierWeights = @{
                Chemical           = 1
                Electrothermal     = 2
                Electrostatic      = 3
                Electromagnetic    = 4
                Fission_Thermal    = 5
                NuclearSaltWater   = 6
                Fission_Pulse      = 7
                Fusion_Thermal     = 8
                Antimatter         = 9
            }
        },
        @{
            File        = "TIPowerPlantTemplate.json"
            Component   = "Reactor"
            TierProperty = "powerPlantClass"
            TierWeights = @{
                Fuel_Cell                              = 1
                Solid_Core_Fission                     = 2
                Molten_Salt_Core_Fission               = 3
                Liquid_Core_Fission                    = 4
                Gas_Core_Fission                       = 5
                Electrostatic_Confinement_Fusion       = 6
                Mirrored_Magnetic_Confinement_Fusion   = 7
                Toroid_Magnetic_Confinement_Fusion     = 8
                Hybrid_Confinement_Fusion              = 9
                Z_Pinch_Fusion                         = 10
                Inertial_Confinement_Fusion            = 11
                Antimatter_Plasma_Core                 = 12
                Antimatter_Beam_Core                   = 13
            }
        },
        @{ File = "TIMagneticGunTemplate.json"; Component = "MagneticWeapon" },
        @{ File = "TILaserWeaponTemplate.json"; Component = "LaserWeapon" },
        @{ File = "TIParticleWeaponTemplate.json"; Component = "ParticleWeapon" },
        @{ File = "TIPlasmaWeaponTemplate.json"; Component = "PlasmaWeapon" },
        @{ File = "TIMissileTemplate.json"; Component = "Missile" },
        @{ File = "TIGunTemplate.json"; Component = "KineticGun" },
        @{ File = "TIHeatSinkTemplate.json"; Component = "HeatSink" },
        @{ File = "TIBatteryTemplate.json"; Component = "Battery" },
        @{ File = "TIRadiatorTemplate.json"; Component = "Radiator" },
        @{
            File        = "TIShipHullTemplate.json"
            Component   = "Hull"
            TierProperty = "consTier"
            TierWeights = @{
                1 = 1
                2 = 2
                3 = 3
                4 = 4
                5 = 5
            }
        },
        @{ File = "TIShipArmorTemplate.json"; Component = "Armor"; DefaultWeight = 2 },
        @{ File = "TIUtilityModuleTemplate.json"; Component = "UtilityModule"; DefaultWeight = 2 }
    )

    $weights = @()

    foreach ($source in $sources) {
        $entries = Get-TIShipComponentJson -FileName $source.File
        if (-not $entries) { continue }

        foreach ($entry in $entries) {
            if ($entry.PSObject.Properties.Name -notcontains 'requiredProjectName') {
                continue
            }
            $project = $entry.requiredProjectName
            if (-not $project) { continue }

            $tier = $null
            if ($source.ContainsKey('TierProperty') -and $source.TierProperty -and $entry.PSObject.Properties.Name -contains $source.TierProperty) {
                $tier = $entry.$($source.TierProperty)
            }

            $weightValue = Get-TIComponentWeightValue -ProjectName $project -Source $source -Entry $entry -TierName $tier
            if ($weightValue -le 0) { continue }

            $weights += [PSCustomObject]@{
                Tech      = $project
                Component = $source.Component
                Tier      = if ($tier) { $tier } else { $project }
                Weight    = [double]$weightValue
            }
        }
    }

    if (-not $weights) { $weights = @() }

    $weights = $weights |
        Group-Object Tech |
        ForEach-Object {
            $best = $_.Group | Sort-Object Weight -Descending | Select-Object -First 1
            [PSCustomObject]@{
                Tech      = $_.Name
                Component = $best.Component
                Tier      = $best.Tier
                Weight    = [double]$best.Weight
            }
        }

    $manual = @(
        [PSCustomObject]@{ Tech = "Project_OutpostMiningComplex";    Component = "Mining";  Tier = "Outpost";    Weight = 1 },
        [PSCustomObject]@{ Tech = "Project_SettlementMiningComplex"; Component = "Mining";  Tier = "Settlement"; Weight = 2 },
        [PSCustomObject]@{ Tech = "Project_ColonyMiningComplex";     Component = "Mining";  Tier = "Colony";     Weight = 3 },
        [PSCustomObject]@{ Tech = "Project_AutomatedMining";         Component = "Mining";  Tier = "Automated";  Weight = 4 }
    )

    foreach ($item in $manual) {
        $existing = $weights | Where-Object { $_.Tech -eq $item.Tech } | Select-Object -First 1
        if ($existing) {
            if ($item.Weight -gt $existing.Weight) {
                $existing.Component = $item.Component
                $existing.Tier      = $item.Tier
                $existing.Weight    = $item.Weight
            }
        } else {
            $weights += $item
        }
    }

    return $weights
}

function Get-TIComponentTechWeights {
    if (-not $script:TIComponentTechWeights) {
        $script:TIComponentTechWeights = Initialize-TIComponentTechWeights
    }
    return $script:TIComponentTechWeights
}

function Get-TIFactionComponentScore {
    <#
    .SYNOPSIS
    Returns the weighted component tech score for a faction.
    .DESCRIPTION
    Sums weights from Get-TIComponentTechWeights for every finished tech in
    Again_<Faction>_Projects.csv. Aliens are treated as having every component.
    #>
    param(
        [Parameter(Mandatory)]
        [string]$FactionShortName
    )

    $weights = Get-TIComponentTechWeights
    if (-not $weights) { return 0.0 }

    if ($FactionShortName -eq "Aliens") {
        return ($weights | Measure-Object -Property Weight -Sum).Sum
    }

    $projects = @()
    try {
        $projects = Get-TIFactionProjects -FactionShortName $FactionShortName
    } catch {
        Write-Verbose ("[Get-TIFactionComponentScore] Missing projects CSV for {0}: {1}" -f $FactionShortName, $_.Exception.Message)
        $projects = @()
    }

    $finishedStatuses = @("GlobalFinished","FactionFinished")
    $finishedTechs = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

    foreach ($proj in $projects) {
        if ($proj -and $finishedStatuses -contains $proj.Status -and $proj.TechTemplateName) {
            [void]$finishedTechs.Add($proj.TechTemplateName)
        }
    }

    $score = 0.0
    foreach ($mapping in $weights) {
        if ($finishedTechs.Contains($mapping.Tech)) {
            $score += [double]$mapping.Weight
        }
    }

    return $score
}

#endregion Component tech weights and scoring

#region Helper: output formatting

enum TIOutputFormat {
    Table
    Markdown
    Json
}

function Convert-TIToMarkdownTable {
    param(
        [Parameter(Mandatory)]
        [object[]]$Rows,
        [string[]]$PropertyOrder
    )

    if (-not $Rows -or $Rows.Count -eq 0) {
        return "# (no data)`n"
    }

    if (-not $PropertyOrder) {
        $PropertyOrder = $Rows[0].PSObject.Properties.Name
    }

    $header = "| " + ($PropertyOrder -join " | ") + " |"

    $dashCells = @()
    foreach ($ignored in $PropertyOrder) {
        $dashCells += "---"
    }
    $divider = "| " + ($dashCells -join " | ") + " |"

    $lines = @($header, $divider)

    foreach ($row in $Rows) {
        $cells = foreach ($p in $PropertyOrder) {
            $val = $row.$p
            if ($null -eq $val) { "" } else { $val.ToString() }
        }
        $lines += ("| " + ($cells -join " | ") + " |")
    }

    return ($lines -join [Environment]::NewLine)
}

#endregion Helper: output formatting

#region Function: Get-TIFactionOverview

function Get-TIFactionOverview {
    <#
    .SYNOPSIS
    Returns a combined view of Earth control, space income, and core resources per faction.

    .PARAMETER Format
    Output format: Table (default), Markdown, or Json.
    #>
    param(
        [TIOutputFormat]$Format = [TIOutputFormat]::Table
    )

    $core      = Get-TIFactionsCore
    $earthSum  = Get-TIFactionEarthSummary
    $habIncome = Get-TIFactionHabIncome

    # Index helper by FactionID
    $earthById = @{}
    foreach ($e in $earthSum) {
        $earthById[[int]$e.FactionID] = $e
    }

    $habById = @{}
    foreach ($h in $habIncome) {
        $habById[[int]$h.FactionID] = $h
    }

    $rows = @()

    foreach ($c in $core) {
        $fid = [int]$c.FactionID

        $e = $earthById[$fid]
        $h = $habById[$fid]

        $rows += [PSCustomObject]@{
            FactionName      = $c.displayName
            TemplateName     = $c.templateName
            FactionID        = $fid

            # Earth control
            TotalCPs         = if ($e) { [int]$e.TotalCPs } else { 0 }
            TotalGDP         = if ($e) { [double]$e.TotalGDP } else { 0 }
            TotalPopulation  = if ($e) { [double]$e.TotalPopulation } else { 0 }

            # Core resources (stockpiles)
            Money            = [double]$c.Money
            Influence        = [double]$c.Influence
            Operations       = [double]$c.Operations
            BoostStockpile   = [double]$c.Boost
            WaterStockpile   = if ($c.PSObject.Properties.Name -contains 'Water')       { [double]$c.Water }       else { 0 }
            VolatilesStockpile = if ($c.PSObject.Properties.Name -contains 'Volatiles') { [double]$c.Volatiles }   else { 0 }
            MetalsStockpile  = if ($c.PSObject.Properties.Name -contains 'Metals')      { [double]$c.Metals }      else { 0 }
            NobleMetalsStockpile = if ($c.PSObject.Properties.Name -contains 'NobleMetals') { [double]$c.NobleMetals } else { 0 }
            FissilesStockpile = if ($c.PSObject.Properties.Name -contains 'Fissiles')   { [double]$c.Fissiles }    else { 0 }
            ExoticsStockpile  = if ($c.PSObject.Properties.Name -contains 'Exotics')    { [double]$c.Exotics }     else { 0 }

            # Space hab income (per-day resources)
            HabSiteCount     = if ($h) { [int]$h.SiteCount } else { 0 }
            WaterPerDay      = if ($h) { [double]$h.WaterPerDay } else { 0 }
            VolatilesPerDay  = if ($h) { [double]$h.VolatilesPerDay } else { 0 }
            MetalsPerDay     = if ($h) { [double]$h.MetalsPerDay } else { 0 }
            NoblesPerDay     = if ($h) { [double]$h.NoblesPerDay } else { 0 }
            FissilesPerDay   = if ($h) { [double]$h.FissilesPerDay } else { 0 }
        }
    }

    switch ($Format) {
        "Table"    { $rows | Sort-Object FactionID | Format-Table -AutoSize }
        "Markdown" { Convert-TIToMarkdownTable -Rows ($rows | Sort-Object FactionID) -PropertyOrder @(
                        "FactionName","FactionID","TotalCPs","TotalGDP",
                        "Money","Influence","BoostStockpile",
                        "WaterStockpile","VolatilesStockpile","MetalsStockpile","NobleMetalsStockpile","FissilesStockpile","ExoticsStockpile",
                        "HabSiteCount","WaterPerDay","MetalsPerDay","FissilesPerDay"
                     ) }
        "Json"     { $rows | Sort-Object FactionID | ConvertTo-Json -Depth 4 }
    }
}

#endregion Function: Get-TIFactionOverview

#region Function: Get-TIFactionShips & Summary

function Get-TIFactionShips {
    return Get-TICsv -Name "FactionShips" -FileName "Again_Faction_Ships.csv"
}

function Get-TIFactionShipSummary {
    <#
    .SYNOPSIS
    Aggregates ship counts and combat power per faction.
    #>
    param(
        [TIOutputFormat]$Format = [TIOutputFormat]::Table
    )
    
    $ships = Get-TIFactionShips
    if (-not $ships) { return @() }
    
    $groups = $ships | Group-Object FactionName
    $rows = @()
    
    foreach ($g in $groups) {
        $factionName = $g.Name
        $shipCount = $g.Count
        $totalPower = ($g.Group | Measure-Object -Property CombatPower -Sum).Sum
        $avgPower = if ($shipCount -gt 0) { $totalPower / $shipCount } else { 0 }
        
        $rows += [PSCustomObject]@{
            FactionName = $factionName
            ShipCount   = $shipCount
            TotalPower  = [math]::Round($totalPower, 1)
            AvgPower    = [math]::Round($avgPower, 1)
        }
    }
    
    switch ($Format) {
        "Table"    { $rows | Sort-Object TotalPower -Descending | Format-Table -AutoSize }
        "Markdown" { Convert-TIToMarkdownTable -Rows ($rows | Sort-Object TotalPower -Descending) -PropertyOrder "FactionName","ShipCount","TotalPower","AvgPower" }
        "Json"     { $rows | Sort-Object TotalPower -Descending | ConvertTo-Json }
    }
}

#endregion Function: Get-TIFactionShips & Summary

function Get-TIFactionTechMatrix {
    <#
    .SYNOPSIS
    Builds a tech completion matrix: one row per tech, one column per faction (True/False if finished).
    #>
    param(
        [TIOutputFormat]$Format = [TIOutputFormat]::Markdown
    )

    $factions = @(
        @{ Template = "ResistCouncil";    Short = "Resistance"     },
        @{ Template = "DestroyCouncil";   Short = "HumanityFirst"  },
        @{ Template = "ExploitCouncil";   Short = "Initiative"     },
        @{ Template = "SubmitCouncil";    Short = "Servants"       },
        @{ Template = "AppeaseCouncil";   Short = "Protectorate"   },
        @{ Template = "CooperateCouncil"; Short = "Academy"        },
        @{ Template = "EscapeCouncil";    Short = "Exodus"         },
        @{ Template = "AlienCouncil";     Short = "Aliens"         }
    )

    # Load per-faction projects
    $projectsByFaction = @{}
    $allTechs = [System.Collections.Generic.HashSet[string]]::new()
    foreach ($f in $factions) {
        $short = $f.Short
        try {
            $csv = Get-TIFactionProjects -FactionShortName $short
        } catch {
            $csv = @()
        }
        $projectsByFaction[$short] = $csv

        foreach ($row in $csv) {
            $null = $allTechs.Add($row.TechTemplateName)
        }
    }

    # Decide which statuses count as "finished"
    $finishedStatuses = @("GlobalFinished","FactionFinished")

    $rows = @()
    foreach ($tech in $allTechs) {
        $row = [ordered]@{
            TechTemplateName = $tech
        }
        foreach ($f in $factions) {
            $short = $f.Short

            # Aliens are treated as having effectively completed all listed techs/projects
            if ($short -eq "Aliens") {
                $row[$short] = $true
                continue
            }

            $csv = $projectsByFaction[$short]
            $hasFinished = $false
            if ($csv) {
                $hasFinished = $csv | Where-Object {
                    $_.TechTemplateName -eq $tech -and $finishedStatuses -contains $_.Status
                } | Select-Object -First 1
            }
            $row[$short] = [bool]$hasFinished
        }
        $rows += [PSCustomObject]$row
    }

    switch ($Format) {
        "Table"    { $rows | Sort-Object TechTemplateName | Format-Table -AutoSize }
        "Json"     { $rows | Sort-Object TechTemplateName | ConvertTo-Json -Depth 4 }
        "Markdown" {
            $props = @("TechTemplateName") + ($factions.Short)
            Convert-TIToMarkdownTable -Rows ($rows | Sort-Object TechTemplateName) -PropertyOrder $props
        }
    }
}

function Get-TIFactionTechCompletionRatio {
    <#
    .SYNOPSIS
    Computes a simple tech completion ratio per faction from the tech matrix.
    .DESCRIPTION
    Uses Get-TIFactionTechMatrix -Format Json and counts, for each faction,
    how many techs have a True flag divided by the total number of tech rows.
    #>

    $matrix = Get-TIFactionTechMatrix -Format Json | ConvertFrom-Json
    if (-not $matrix) {
        return @{}
    }

    $factions = @("Resistance","HumanityFirst","Initiative","Servants","Protectorate","Academy","Exodus","Aliens")
    $totalTechs = $matrix.Count

    $ratios = @{}
    foreach ($f in $factions) { $ratios[$f] = 0 }

    foreach ($row in $matrix) {
        foreach ($f in $factions) {
            if ($row.$f) { $ratios[$f]++ }
        }
    }

    foreach ($f in $factions) {
        if ($totalTechs -gt 0) {
            $ratios[$f] = [double]$ratios[$f] / [double]$totalTechs
        } else {
            $ratios[$f] = 0
        }
    }

    return $ratios
}

function Normalize {
    param(
        [Parameter(Mandatory)]
        [double]$value,
        [Parameter(Mandatory)]
        [double]$max
    )

    if ($max -le 0) { return 0 }
    $val = $value / $max
    if ($val -lt 0) { $val = 0 }
    if ($val -gt 1) { $val = 1 }
    return $val
}

function Get-TIFactionPowerScores {
    <#
    .SYNOPSIS
    Computes weighted Earth/Space/Tech power scores per faction.
    .DESCRIPTION
    Uses Get-TIFactionOverview and component-weighted tech scores to build
    a composite PowerScore = EarthScore (40%) + SpaceScore (40%) + TechScore (20%).
    #>

    $overview   = Get-TIFactionOverview -Format Json | ConvertFrom-Json
    $shipSummary = Get-TIFactionShipSummary -Format Json | ConvertFrom-Json

    if (-not $overview) { return @() }

    $componentFactions = @("Resistance","HumanityFirst","Initiative","Servants","Protectorate","Academy","Exodus","Aliens")
    $componentScores = @{}
    $maxComponentScore = 0.0

    foreach ($short in $componentFactions) {
        $score = Get-TIFactionComponentScore -FactionShortName $short
        $componentScores[$short] = $score
        if ($score -gt $maxComponentScore) {
            $maxComponentScore = $score
        }
    }

    # Fleet Power Map
    $fleetScores = @{}
    $maxFleetPower = 0.0
    if ($shipSummary) {
        foreach ($s in $shipSummary) {
            $fleetScores[$s.FactionName] = [double]$s.TotalPower
            if ([double]$s.TotalPower -gt $maxFleetPower) {
                $maxFleetPower = [double]$s.TotalPower
            }
        }
    }

    $maxCPs          = ($overview | Measure-Object TotalCPs        -Maximum).Maximum
    $maxGDP          = ($overview | Measure-Object TotalGDP        -Maximum).Maximum
    $maxPop          = ($overview | Measure-Object TotalPopulation -Maximum).Maximum
    $maxHabCount     = ($overview | Measure-Object HabSiteCount    -Maximum).Maximum
    $maxWaterPerDay  = ($overview | Measure-Object WaterPerDay     -Maximum).Maximum
    $maxMetalsPerDay = ($overview | Measure-Object MetalsPerDay    -Maximum).Maximum
    $maxFissPerDay   = ($overview | Measure-Object FissilesPerDay  -Maximum).Maximum

    $maxWaterStock   = ($overview | Measure-Object WaterStockpile     -Maximum).Maximum
    $maxVolStock     = ($overview | Measure-Object VolatilesStockpile -Maximum).Maximum
    $maxMetalStock   = ($overview | Measure-Object MetalsStockpile    -Maximum).Maximum
    $maxNobleStock   = ($overview | Measure-Object NobleMetalsStockpile -Maximum).Maximum
    $maxFissStock    = ($overview | Measure-Object FissilesStockpile  -Maximum).Maximum
    $maxExoticsStock = ($overview | Measure-Object ExoticsStockpile   -Maximum).Maximum

    $rows = @()

    foreach ($o in $overview) {
        $fid   = [int]$o.FactionID
        $short = switch ($fid) {
            4089 { "Resistance" }
            4090 { "HumanityFirst" }
            4091 { "Initiative" }
            4092 { "Servants" }
            4093 { "Protectorate" }
            4094 { "Academy" }
            4095 { "Exodus" }
            4096 { "Aliens" }
            default { "Unknown" }
        }

        # Weights: Earth 30%, Space 30%, Tech 20%, Fleet 20%
        
        $earthScore =
            ((Normalize -value ([double]$o.TotalCPs)        -max ([double]$maxCPs)) * 0.20 +
             (Normalize -value ([double]$o.TotalGDP)        -max ([double]$maxGDP)) * 0.05 +
             (Normalize -value ([double]$o.TotalPopulation) -max ([double]$maxPop)) * 0.05)

        $spaceScore =
            ((Normalize -value ([double]$o.HabSiteCount)    -max ([double]$maxHabCount))    * 0.10 +
             (Normalize -value ([double]$o.WaterPerDay)     -max ([double]$maxWaterPerDay)) * 0.05 +
             (Normalize -value ([double]$o.MetalsPerDay)    -max ([double]$maxMetalsPerDay)) * 0.05 +
             (Normalize -value ([double]$o.FissilesPerDay)  -max ([double]$maxFissPerDay))  * 0.05 +
             (Normalize -value ([double]($o.WaterStockpile + $o.VolatilesStockpile)) -max ([double]($maxWaterStock + $maxVolStock))) * 0.025 +
             (Normalize -value ([double]($o.MetalsStockpile + $o.NobleMetalsStockpile)) -max ([double]($maxMetalStock + $maxNobleStock))) * 0.025)

        $componentScore = if ($componentScores.ContainsKey($short)) { [double]$componentScores[$short] } else { 0.0 }
        $techScore = if ($maxComponentScore -gt 0) {
            (Normalize -value $componentScore -max $maxComponentScore) * 0.20
        } else {
            0
        }

        $rawFleet = if ($fleetScores.ContainsKey($o.FactionName)) { $fleetScores[$o.FactionName] } else { 0.0 }
        $fleetScore = if ($maxFleetPower -gt 0) {
            (Normalize -value $rawFleet -max $maxFleetPower) * 0.20
        } else {
            0
        }

        $powerScore = $earthScore + $spaceScore + $techScore + $fleetScore

        $rows += [PSCustomObject]@{
            FactionName = $o.FactionName
            FactionID   = $fid
            EarthScore  = [Math]::Round($earthScore * 100, 1)
            SpaceScore  = [Math]::Round($spaceScore * 100, 1)
            TechScore   = [Math]::Round($techScore  * 100, 1)
            FleetScore  = [Math]::Round($fleetScore * 100, 1)
            PowerScore  = [Math]::Round($powerScore * 100, 1)
        }
    }

    return $rows | Sort-Object PowerScore -Descending
}

#region Function: Get-TIFactionNationsSnapshot

function Get-TIFactionNationsSnapshot {
    <#
    .SYNOPSIS
    Summarizes nations controlled by a specific faction, including CPs, GDP, and BoostPerCP.

    .PARAMETER FactionShortName
    Short faction label corresponding to the CSV naming pattern:
      Resistance, HumanityFirst, Initiative, Servants, Protectorate, Academy, Exodus.

    .PARAMETER Format
    Output format: Table (default), Markdown, or Json.
    #>
    param(
        [Parameter(Mandatory)]
        [ValidateSet("Resistance","HumanityFirst","Initiative","Servants","Protectorate","Academy","Exodus")]
        [string]$FactionShortName,
        [TIOutputFormat]$Format = [TIOutputFormat]::Table
    )

    $fileName = "Again_{0}_Nations.csv" -f $FactionShortName
    $nations  = Get-TICsv -Name ("{0}Nations" -f $FactionShortName) -FileName $fileName

    $rows = $nations |
        Group-Object NationName |
        ForEach-Object {
            $name = $_.Name
            $any  = $_.Group | Select-Object -First 1
            $cps  = $_.Count

            [PSCustomObject]@{
                NationName    = $name
                CPs           = $cps
                GDP           = [double]$any.GDP
                MilTech       = $any.MilTech
                Democracy     = $any.Democracy
                Cohesion      = $any.Cohesion
                Unrest        = $any.Unrest
                BoostPerCP    = if ($any.BoostPerCP) { [double]$any.BoostPerCP } else { 0 }
                BoostTotalEst = if ($any.BoostPerCP) { [double]$any.BoostPerCP * $cps } else { 0 }
            }
        } |
        Sort-Object CPs, NationName -Descending

    switch ($Format) {
        "Table"    { $rows | Format-Table -AutoSize }
        "Markdown" { Convert-TIToMarkdownTable -Rows $rows -PropertyOrder @(
                        "NationName","CPs","GDP","MilTech","Democracy","Cohesion","Unrest","BoostPerCP","BoostTotalEst"
                     ) }
        "Json"     { $rows | ConvertTo-Json -Depth 4 }
    }
}

#endregion Function: Get-TIFactionNationsSnapshot

function Get-TIResistanceNationsSnapshot {
    param(
        [TIOutputFormat]$Format = [TIOutputFormat]::Table
    )
    Get-TIFactionNationsSnapshot -FactionShortName Resistance -Format $Format
}

#region Function: Get-TIResistanceCouncilorSummary

function Get-TIResistanceCouncilorSummary {
    <#
    .SYNOPSIS
    Summarizes current Resistance councilors and highlights top recruits.

    .PARAMETER Format
    Output format: Table (default), Markdown, or Json.
    #>
    param(
        [TIOutputFormat]$Format = [TIOutputFormat]::Table,
        [int]$TopRecruitsByAdmin = 3,
        [int]$TopRecruitsByPersuasion = 3,
        [int]$TopRecruitsByEspionage = 3
    )

    $councilors = Get-TIResistanceCouncilors
    $recruits   = Get-TICouncilorRecruits

    # Roster now surfaces both base and effective stats from Again_Resistance_Councilors.csv
    $roster = $councilors | Sort-Object displayName | Select-Object `
        displayName,
        typeTemplateName,
        Persuasion,
        EffectivePersuasion,
        Investigation,
        EffectiveInvestigation,
        Espionage,
        EffectiveEspionage,
        Command,
        EffectiveCommand,
        Administration,
        EffectiveAdministration,
        Science,
        EffectiveScience,
        Security,
        EffectiveSecurity,
        Loyalty,
        EffectiveLoyalty,
        OrgNames

    $activeRecruits = $recruits | Where-Object { $_.status -eq "Active" -or -not $_.status }

    $topByAdmin = $activeRecruits |
        Sort-Object -Property @{ Expression = { [int]$_.Administration }; Descending = $true }, displayName |
        Select-Object -First $TopRecruitsByAdmin

    $topByPers = $activeRecruits |
        Sort-Object -Property @{ Expression = { [int]$_.Persuasion }; Descending = $true }, displayName |
        Select-Object -First $TopRecruitsByPersuasion

    $topByEsp = $activeRecruits |
        Sort-Object -Property @{ Expression = { [int]$_.Espionage }; Descending = $true }, displayName |
        Select-Object -First $TopRecruitsByEspionage

    switch ($Format) {
        "Table" {
            $roster | Format-Table -AutoSize
        }
        "Json" {
            [PSCustomObject]@{
                Roster        = $roster
                TopByAdmin    = $topByAdmin
                TopByPers     = $topByPers
                TopByEspionage = $topByEsp
            } | ConvertTo-Json -Depth 4
        }
        "Markdown" {
            $sb = New-Object System.Text.StringBuilder

            [void]$sb.AppendLine("### Current Resistance Councilors")
            [void]$sb.AppendLine()
            [void]$sb.AppendLine(
                (Convert-TIToMarkdownTable -Rows $roster -PropertyOrder @(
                    "displayName","typeTemplateName",
                    "Persuasion","EffectivePersuasion",
                    "Investigation","EffectiveInvestigation",
                    "Espionage","EffectiveEspionage",
                    "Command","EffectiveCommand",
                    "Administration","EffectiveAdministration",
                    "Science","EffectiveScience",
                    "Security","EffectiveSecurity",
                    "Loyalty","EffectiveLoyalty",
                    "OrgNames"
                ))
            )
            [void]$sb.AppendLine()
            if ($topByAdmin -and $topByAdmin.Count -gt 0) {
                [void]$sb.AppendLine("### Top Recruit Candidates by Administration")
                [void]$sb.AppendLine()
                [void]$sb.AppendLine(
                    (Convert-TIToMarkdownTable -Rows $topByAdmin -PropertyOrder @(
                        "displayName","typeTemplateName","Administration","Persuasion","Investigation","Espionage","Command","Science"
                    ))
                )
                [void]$sb.AppendLine()
            }

            if ($topByPers -and $topByPers.Count -gt 0) {
                [void]$sb.AppendLine("### Top Recruit Candidates by Persuasion")
                [void]$sb.AppendLine()
                [void]$sb.AppendLine(
                    (Convert-TIToMarkdownTable -Rows $topByPers -PropertyOrder @(
                        "displayName","typeTemplateName","Persuasion","Investigation","Espionage","Command","Administration","Science"
                    ))
                )
                [void]$sb.AppendLine()
            }

            if ($topByEsp -and $topByEsp.Count -gt 0) {
                [void]$sb.AppendLine("### Top Recruit Candidates by Espionage")
                [void]$sb.AppendLine()
                [void]$sb.AppendLine(
                    (Convert-TIToMarkdownTable -Rows $topByEsp -PropertyOrder @(
                        "displayName","typeTemplateName","Espionage","Investigation","Persuasion","Command","Administration","Science"
                    ))
                )
                [void]$sb.AppendLine()
            }

            return $sb.ToString()
        }
    }
}

#endregion Function: Get-TIResistanceCouncilorSummary

#region Function: Get-TISpaceSitrep

function Get-TISpaceSitrep {
    <#
    .SYNOPSIS
    Summarizes space hab income per faction and lists top unclaimed Luna/Mars sites.

    .PARAMETER Format
    Output format: Table (default), Markdown, or Json.
    #>
    param(
        [TIOutputFormat]$Format = [TIOutputFormat]::Table,
        [int]$TopLunaSites = 5,
        [int]$TopMarsSites = 5,
        [int]$TopBeltSites = 5
    )

    $habIncome = Get-TIFactionHabIncome
    $habSites  = Get-TIHabSites
    $alienHabs = Get-TIAliensHabs

    # Space income per faction is mostly already in Again_Faction_HabIncome.csv
    $incomeRows = $habIncome |
        Select-Object FactionID,FactionName,SiteCount,WaterPerDay,VolatilesPerDay,MetalsPerDay,NoblesPerDay,FissilesPerDay |
        Sort-Object FactionID

    # Helper to filter unclaimed sites by body name and sort by resource
    function Get-TopSitesForBody {
        param(
            [string]$BodyName,
            [int]$Count
        )
        $habSites |
            Where-Object { $_.ParentBodyName -eq $BodyName -and $_.HasHab -eq "False" } |
            Select-Object SiteID,displayName,ParentBodyName,WaterPerDay,VolatilesPerDay,MetalsPerDay,NoblesPerDay,FissilesPerDay |
            Sort-Object @{ Expression = { [double]$_.FissilesPerDay }; Descending = $true },
                        @{ Expression = { [double]$_.MetalsPerDay }; Descending = $true } |
            Select-Object -First $Count
    }

    $topLuna = Get-TopSitesForBody -BodyName "Luna" -Count $TopLunaSites
    $topMars = Get-TopSitesForBody -BodyName "Mars" -Count $TopMarsSites

    switch ($Format) {
        "Table" {
            [PSCustomObject]@{
                FactionHabIncome = $incomeRows
                TopLunaSites     = $topLuna
                TopMarsSites     = $topMars
            }
        }
        "Markdown" {
            $sb = New-Object System.Text.StringBuilder
            [void]$sb.AppendLine("### Space Hab Income by Faction")
            [void]$sb.AppendLine()
            [void]$sb.AppendLine(
                (Convert-TIToMarkdownTable -Rows $incomeRows -PropertyOrder @(
                    "FactionName","SiteCount","WaterPerDay","MetalsPerDay","FissilesPerDay"
                ))
            )
            [void]$sb.AppendLine()
            [void]$sb.AppendLine("### Top Unclaimed Luna Sites (by fissiles/metals)")
            [void]$sb.AppendLine()
            $rowsLuna = @( @($topLuna) | Where-Object { $_ } )
            if ($rowsLuna.Count -gt 0) {
                [void]$sb.AppendLine(
                    (Convert-TIToMarkdownTable -Rows $rowsLuna -PropertyOrder @(
                        "displayName","WaterPerDay","VolatilesPerDay","MetalsPerDay","NoblesPerDay","FissilesPerDay"
                    ))
                )
            } else {
                [void]$sb.AppendLine("# (no data)")
            }
            [void]$sb.AppendLine()
            [void]$sb.AppendLine("### Top Unclaimed Mars Sites (by fissiles/metals)")
            [void]$sb.AppendLine()
            $rowsMars = @( @($topMars) | Where-Object { $_ } )
            if ($rowsMars.Count -gt 0) {
                [void]$sb.AppendLine(
                    (Convert-TIToMarkdownTable -Rows $rowsMars -PropertyOrder @(
                        "displayName","WaterPerDay","VolatilesPerDay","MetalsPerDay","NoblesPerDay","FissilesPerDay"
                    ))
                )
            } else {
                [void]$sb.AppendLine("# (no data)")
            }
            [void]$sb.AppendLine()
            [void]$sb.AppendLine("### Top Unclaimed Asteroid Belt Sites (by total output)")
            [void]$sb.AppendLine()
            $belt = Get-TITopUnclaimedBeltSites -Top $TopBeltSites
            $rowsBelt = @( @($belt) | Where-Object { $_ } )
            if ($rowsBelt.Count -gt 0) {
                [void]$sb.AppendLine(
                    (Convert-TIToMarkdownTable -Rows $rowsBelt -PropertyOrder @(
                        "SiteName","BodyName","WaterPerDay","VolatilesPerDay","MetalsPerDay","NoblesPerDay","FissilesPerDay","TotalOutput"
                    ))
                )
            } else {
                [void]$sb.AppendLine("# (no data)")
            }
            $sb.ToString()
        }
        "Json" {
            [PSCustomObject]@{
                FactionHabIncome = $incomeRows
                TopLunaSites     = $topLuna
                TopMarsSites     = $topMars
                TopBeltSites     = (Get-TITopUnclaimedBeltSites -Top $TopBeltSites)
            } | ConvertTo-Json -Depth 5
        }
    }
}

#endregion Function: Get-TISpaceSitrep

#region Function: Get-TISpaceAtlas

function Get-TISpaceAtlas {
    <#
    .SYNOPSIS
    Returns a complete joined view of space bodies and all their hab sites.

    .DESCRIPTION
    Loads:
      - Again_SpaceBodies.csv via Get-TISpaceBodies.
      - Again_HabSites.csv via Get-TIHabSites.

    Produces one row per hab site (including sites without a hab)
    with the key body attributes flattened onto each row.

    .PARAMETER Format
    Output format: Table (default), Markdown, or Json.
    #>
    param(
        [TIOutputFormat]$Format = [TIOutputFormat]::Table
    )

    $bodies   = Get-TISpaceBodies
    $habSites = Get-TIHabSites

    # Index bodies by BodyID for quick lookup
    $bodiesById = @{}
    foreach ($b in $bodies) {
        $bodiesById[[int]$b.BodyID] = $b
    }

    $rows = @()

    foreach ($site in $habSites) {
        $parentId = 0
        if ($site.ParentBodyID -ne $null -and $site.ParentBodyID -ne "") {
            $parentId = [int]$site.ParentBodyID
        }

        $body = $null
        if ($bodiesById.ContainsKey($parentId)) {
            $body = $bodiesById[$parentId]
        }

        $rows += [PSCustomObject]@{
            BodyID          = if ($body) { [int]$body.BodyID } else { $parentId }
            BodyName        = if ($body) { $body.displayName } else { $site.ParentBodyName }
            BodyType        = if ($body -and $body.PSObject.Properties.Name -contains 'bodyType') { $body.bodyType } else { $null }
            MaxHabTier      = if ($body -and $body.PSObject.Properties.Name -contains 'maxHabTier') { [int]$body.maxHabTier } else { $null }
            SiteID          = $site.SiteID
            SiteName        = $site.displayName
            TemplateName    = $site.templateName
            HasHab          = $site.HasHab
            HabID           = $site.HabID
            FactionName     = $site.FactionName
            WaterPerDay     = [double]$site.WaterPerDay
            VolatilesPerDay = [double]$site.VolatilesPerDay
            MetalsPerDay    = [double]$site.MetalsPerDay
            NoblesPerDay    = [double]$site.NoblesPerDay
            FissilesPerDay  = [double]$site.FissilesPerDay
        }
    }

    $rows = $rows | Sort-Object BodyName, SiteName

    switch ($Format) {
        "Table" {
            $rows | Format-Table -AutoSize
        }
        "Markdown" {
            Convert-TIToMarkdownTable -Rows $rows -PropertyOrder @(
                "BodyName","BodyType","MaxHabTier",
                "SiteName","HasHab","FactionName",
                "WaterPerDay","MetalsPerDay","FissilesPerDay"
            )
        }
        "Json" {
            $rows | ConvertTo-Json -Depth 4
        }
    }
}

#endregion Function: Get-TISpaceAtlas

#region Function: Get-TIFactionHabSites

function Get-TIFactionHabSites {
    <#
    .SYNOPSIS
    Returns all occupied hab sites for a given faction with yields and shipyard info.

    .PARAMETER FactionName
    Display name of the faction (e.g., "the Resistance").

    .PARAMETER Format
    Output format: Table (default), Markdown, or Json.
    #>
    param(
        [string]$FactionName = "the Resistance",
        [TIOutputFormat]$Format = [TIOutputFormat]::Table
    )

    $sites = Get-TIHabSites |
        Where-Object { $_.HasHab -eq "True" -and $_.FactionName -eq $FactionName }

    $habsAll = Get-TIHabsAll |
        Where-Object { $_.FactionName -eq $FactionName }

    # Habs that do not have a mapped resource site (e.g., pure LEO stations)
    $habsNoSite = $habsAll |
        Where-Object { -not $_.HasHabSite -or -not $_.HabSiteID }

    $rows = @()

    foreach ($s in $sites) {
        $rows += [PSCustomObject]@{
            FactionName             = $s.FactionName
            ParentBodyName          = $s.ParentBodyName
            HabName                 = $s.displayName
            HabType                 = $s.HabType
            HabSchematicTemplateName = $s.HabSchematicTemplateName
            IsShipyard              = $s.IsShipyard
            WaterPerDay             = $s.WaterPerDay
            VolatilesPerDay         = $s.VolatilesPerDay
            MetalsPerDay            = $s.MetalsPerDay
            NoblesPerDay            = $s.NoblesPerDay
            FissilesPerDay          = $s.FissilesPerDay
        }
    }

    foreach ($h in $habsNoSite) {
        $orbitLabel = if ($h.InEarthLEO -eq "True") {
            "Earth (LEO)"
        } elseif ($h.OrbitBodyName) {
            ("{0} (orbit)" -f $h.OrbitBodyName)
        } else {
            "(orbit)"
        }
        $rows += [PSCustomObject]@{
            FactionName             = $h.FactionName
            ParentBodyName          = $orbitLabel
            HabName                 = $h.HabName
            HabType                 = $h.HabType
            HabSchematicTemplateName = $h.HabSchematicTemplateName
            IsShipyard              = $false
            WaterPerDay             = $null
            VolatilesPerDay         = $null
            MetalsPerDay            = $null
            NoblesPerDay            = $null
            FissilesPerDay          = $null
        }
    }

    $rows = $rows | Sort-Object ParentBodyName, HabName

    switch ($Format) {
        "Table" {
            $rows | Format-Table -AutoSize
        }
        "Markdown" {
            Convert-TIToMarkdownTable -Rows $rows -PropertyOrder @(
                "FactionName",
                "ParentBodyName",
                "HabName",
                "HabType",
                "IsShipyard",
                "WaterPerDay",
                "MetalsPerDay",
                "FissilesPerDay"
            )
        }
        "Json" {
            $rows | ConvertTo-Json -Depth 4
        }
    }
}

#endregion Function: Get-TIFactionHabSites

#region Function: Get-TIOrbitHabs

function Get-TIOrbitHabs {
    <#
    .SYNOPSIS
    Returns an overview of all habs (stations and bases), with options to focus on orbit.

    .PARAMETER OnlyStations
    When set, returns only Station-type habs.

    .PARAMETER OnlyEarthLEO
    When set, returns only habs in Earth LEO.

    .PARAMETER Format
    Output format: Table (default), Markdown, or Json.
    #>
    param(
        [switch]$OnlyStations,
        [switch]$OnlyEarthLEO,
        [TIOutputFormat]$Format = [TIOutputFormat]::Table
    )

    $habs = Get-TIHabsAll

    if ($OnlyStations) {
        $habs = $habs | Where-Object { $_.HabType -eq "Station" }
    }

    if ($OnlyEarthLEO) {
        $habs = $habs | Where-Object { $_.InEarthLEO -eq "True" }
    }

    $habs = $habs | Sort-Object FactionName, HabType, HabName

    switch ($Format) {
        "Table" {
            $habs | Select-Object `
                FactionName,
                HabName,
                HabType,
                HabSchematicTemplateName,
                InEarthLEO,
                StaticHab,
                HasHabSite,
                HabSiteID |
                Format-Table -AutoSize
        }
        "Markdown" {
            Convert-TIToMarkdownTable -Rows $habs -PropertyOrder @(
                "FactionName",
                "HabName",
                "HabType",
                "HabSchematicTemplateName",
                "InEarthLEO",
                "HasHabSite",
                "HabSiteID"
            )
        }
        "Json" {
            $habs | ConvertTo-Json -Depth 4
        }
    }
}

#endregion Function: Get-TIOrbitHabs

#region Function: Get-TIFactionHabsOverview

function Get-TIFactionHabsOverview {
    <#
    .SYNOPSIS
    Returns a combined overview of all habs (bases + stations) for all factions.

    .PARAMETER Format
    Output format: Table (default), Markdown, or Json.
    #>
    param(
        [TIOutputFormat]$Format = [TIOutputFormat]::Table
    )

    $habs  = Get-TIHabsAll
    $sites = Get-TIHabSites

    # Map HabID -> site row for body info
    $siteByHabId = @{}
    foreach ($s in $sites) {
        if ($s.HabID) {
            $siteByHabId[$s.HabID] = $s
        }
    }

    $rows = foreach ($h in $habs) {
        $bodyName = $null

        if ($h.HasHabSite -and $h.HabSiteID) {
            # Prefer site body name when backing site exists
            if ($siteByHabId.ContainsKey($h.HabID)) {
                $bodyName = $siteByHabId[$h.HabID].ParentBodyName
            }
        }

        if (-not $bodyName) {
            if ($h.InEarthLEO -eq "True") {
                $bodyName = "Earth (LEO)"
            } elseif ($h.OrbitBodyName) {
                $bodyName = ("{0} (orbit)" -f $h.OrbitBodyName)
            } else {
                $bodyName = "(orbit)"
            }
        }

        $isShipyard = $false
        if ($h.HasHabSite -and $siteByHabId.ContainsKey($h.HabID)) {
            $isShipyard = $siteByHabId[$h.HabID].IsShipyard -eq "True"
        } elseif ($h.HabSchematicTemplateName -eq "ShipbuildingHabSchematic") {
            $isShipyard = $true
        }

        [PSCustomObject]@{
            FactionName   = $h.FactionName
            Body          = $bodyName
            HabName       = $h.HabName
            HabType       = $h.HabType
            HabLevel      = $h.HabLevel
            MCCost        = $h.MCCost
            IsShipyard    = $isShipyard
            InEarthLEO    = $h.InEarthLEO
            HasHabSite    = $h.HasHabSite
            HabSiteID     = $h.HabSiteID
        }
    }

    $rows = $rows | Sort-Object FactionName, Body, HabName

    switch ($Format) {
        "Table" {
            $rows | Format-Table -AutoSize
        }
        "Markdown" {
            Convert-TIToMarkdownTable -Rows $rows -PropertyOrder @(
                "FactionName","Body","HabName","HabType","HabLevel","MCCost","IsShipyard"
            )
        }
        "Json" {
            $rows | ConvertTo-Json -Depth 4
        }
    }
}

#endregion Function: Get-TIFactionHabsOverview

#region Function: Get-TIResistanceResearchSummary

function Get-TIResistanceResearchSummary {
    <#
    .SYNOPSIS
    Summarizes completed and in-progress research for the Resistance.

    .DESCRIPTION
    Uses Again_Resistance_Projects.csv (exported from the global tech tree)
    to list finished techs and current in-progress projects, with a flag
    for globals where the Resistance is selector.

    .PARAMETER Format
    Output format: Table (default), Markdown, or Json.
    #>
    param(
        [TIOutputFormat]$Format = [TIOutputFormat]::Table
    )

    $projects = Get-TIResistanceProjects

    $finishedGlobal   = $projects | Where-Object { $_.Status -eq "GlobalFinished" }
    $finishedFaction  = $projects | Where-Object { $_.Status -eq "FactionFinished" }
    $inProgressGlobal = $projects | Where-Object { $_.Status -eq "GlobalInProgress" }

    switch ($Format) {
        "Table" {
            [PSCustomObject]@{
                GlobalFinished    = $finishedGlobal | Sort-Object TechTemplateName
                FactionFinished   = $finishedFaction | Sort-Object TechTemplateName
                GlobalInProgress  = $inProgressGlobal | Sort-Object TechTemplateName
            }
        }
        "Markdown" {
            $sb = New-Object System.Text.StringBuilder

            [void]$sb.AppendLine("### Resistance Global Tech Tree – Finished Techs")
            [void]$sb.AppendLine()
            if ($finishedGlobal -and $finishedGlobal.Count -gt 0) {
                $finishedRows = $finishedGlobal | Sort-Object TechTemplateName
                [void]$sb.AppendLine(
                    (Convert-TIToMarkdownTable -Rows $finishedRows -PropertyOrder @(
                        "TechTemplateName"
                    ))
                )
            } else {
                [void]$sb.AppendLine("_No finished techs recorded in Again_Resistance_Projects.csv._")
            }

            [void]$sb.AppendLine()
            [void]$sb.AppendLine("### Resistance Faction Projects – Completed")
            [void]$sb.AppendLine()
            if ($finishedFaction -and $finishedFaction.Count -gt 0) {
                $fRows = $finishedFaction | Sort-Object TechTemplateName
                [void]$sb.AppendLine(
                    (Convert-TIToMarkdownTable -Rows $fRows -PropertyOrder @(
                        "TechTemplateName"
                    ))
                )
            } else {
                [void]$sb.AppendLine("_No completed Resistance faction projects recorded in Again_Resistance_Projects.csv._")
            }

            [void]$sb.AppendLine()
            [void]$sb.AppendLine("### Resistance Global Tech Tree – In-Progress Techs")
            [void]$sb.AppendLine()
            if ($inProgressGlobal -and $inProgressGlobal.Count -gt 0) {
                $inRows = $inProgressGlobal |
                    Sort-Object @{ Expression = { [double]$_.AccumulatedResearch }; Descending = $true }, TechTemplateName
                [void]$sb.AppendLine(
                    (Convert-TIToMarkdownTable -Rows $inRows -PropertyOrder @(
                        "TechTemplateName","AccumulatedResearch","IsSelector"
                    ))
                )
            } else {
                [void]$sb.AppendLine("_No in-progress global techs recorded in Again_Resistance_Projects.csv._")
            }

            return $sb.ToString()
        }
        "Json" {
            $projects | ConvertTo-Json -Depth 4
        }
    }
}

#endregion Function: Get-TIResistanceResearchSummary

#region Function: Get-TIFactionAlienHateTable

function Get-TIFactionAlienHateTable {
    param(
        [TIOutputFormat]$Format = [TIOutputFormat]::Markdown
    )

    $rows = Get-TIFactionAlienHate |
        Select-Object FactionName,TemplateName,AssessedAlienHateOfMe

    switch ($Format) {
        'Table' {
            $rows | Format-Table -AutoSize
        }
        'Json' {
            $rows | ConvertTo-Json -Depth 3
        }
        'Markdown' {
            Convert-TIToMarkdownTable -Rows $rows -PropertyOrder @(
                'FactionName','TemplateName','AssessedAlienHateOfMe'
            )
        }
    }
}

#endregion Function: Get-TIFactionAlienHateTable

#region Function: Get-TIFactionHateMatrixTable

function Get-TIFactionHateMatrixTable {
    <#
    .SYNOPSIS
    Human-vs-human faction hate matrix (rows = source faction, columns = target faction).
    #>
    param(
        [TIOutputFormat]$Format = [TIOutputFormat]::Markdown
    )

    $matrix = Get-TIFactionHateMatrix
    if (-not $matrix) { return $null }

    switch ($Format) {
        'Table' {
            $matrix | Format-Table -AutoSize
        }
        'Json' {
            $matrix | ConvertTo-Json -Depth 5
        }
        'Markdown' {
            Convert-TIToMarkdownTable -Rows $matrix
        }
    }
}

#endregion Function: Get-TIFactionHateMatrixTable

#region Function: Test-TIExportContext

function Test-TIExportContext {
    <#
    .SYNOPSIS
    Validates that required CSVs and helper scripts exist and prints key high-level metrics.

    .DESCRIPTION
    Checks for:
      - Core export CSVs (factions, nations, habs, techs).
      - Helper aggregates (Earth summary, hab income).
      - Optional summarize_boost_income.ps1 helper.

    Prints:
      - Presence/absence of each file.
      - A small faction overview table (Earth CPs + hab site counts).
    #>

    $exportRoot = Get-TIDataPath -RelativePath $script:TIConfig.ExportFolder

    $requiredFiles = @(
        "Again_Factions_Core.csv",
        "Again_Faction_EarthSummary.csv",
        "Again_Faction_HabIncome.csv",
        "Again_Resistance_Nations.csv",
        "Again_Resistance_Councilors.csv",
        "Again_Councilor_Recruits.csv",
        "Again_HabSites.csv",
        "Again_Aliens_Habs.csv",
        "Again_Techs_Global.csv",
        "Again_Faction_Ships.csv"
    )

    $optionalScripts = @(
        $script:TIConfig.BoostHelperPath
    )

    Write-Host "Terra Invicta Export Context Check" -ForegroundColor Cyan
    Write-Host ("RootPath     : {0}" -f $script:TIConfig.RootPath)
    Write-Host ("ExportFolder : {0}" -f $script:TIConfig.ExportFolder)
    Write-Host ""

    Write-Host "Required CSVs:" -ForegroundColor Yellow
    foreach ($f in $requiredFiles) {
        $path = Join-Path $exportRoot $f
        if (Test-Path $path) {
            Write-Host ("[OK]   {0}" -f $f) -ForegroundColor Green
        } else {
            Write-Host ("[MISS] {0}" -f $f) -ForegroundColor Red
        }
    }

    Write-Host ""
    Write-Host "Optional helper scripts:" -ForegroundColor Yellow
    foreach ($s in $optionalScripts) {
        $full = Get-TIDataPath -RelativePath $s
        if (Test-Path $full) {
            Write-Host ("[OK]   {0}" -f $s) -ForegroundColor Green
        } else {
            Write-Host ("[MISS] {0}" -f $s) -ForegroundColor DarkYellow
        }
    }

    Write-Host ""
    Write-Host "High-level faction overview (Earth CPs + hab sites):" -ForegroundColor Yellow
    try {
        Get-TIFactionOverview -Format Table
    } catch {
        Write-Warning "Unable to compute faction overview: $($_.Exception.Message)"
    }
}

#endregion Function: Test-TIExportContext

#region Function: Get-TIFactionBoostAndSpaceSummary

function Get-TIFactionBoostAndSpaceSummary {
    <#
    .SYNOPSIS
    Combines faction Earth control, space hab income, and approximate Boost income into one view.

    .DESCRIPTION
    Uses:
      - Again_Faction_EarthSummary.csv for CPs/GDP.
      - Again_Faction_HabIncome.csv for hab site counts and per-day resources.
      - Again_*_Nations.csv (via BoostPerCP) for rough Boost income per faction.
    #>
    param(
        [TIOutputFormat]$Format = [TIOutputFormat]::Table
    )

    $overview = Get-TIFactionOverview -Format Json | ConvertFrom-Json

    # Approximate Boost income per faction for human factions only
    $boostByFaction = @{}

    $nationFiles = @(
        "Again_Resistance_Nations.csv",
        "Again_HumanityFirst_Nations.csv",
        "Again_Initiative_Nations.csv",
        "Again_Servants_Nations.csv",
        "Again_Protectorate_Nations.csv",
        "Again_Academy_Nations.csv",
        "Again_Exodus_Nations.csv"
    )

    foreach ($file in $nationFiles) {
        $path = Get-TIExportPath -FileName $file
        if (-not (Test-Path $path)) { continue }

        $sum = Import-Csv $path |
            Where-Object { $_.BoostPerCP -ne $null -and $_.BoostPerCP -ne "" } |
            ForEach-Object { [double]$_.BoostPerCP } |
            Measure-Object -Sum |
            Select-Object -ExpandProperty Sum

        if ($null -eq $sum) { $sum = 0 }

        # Infer faction display name from filename for convenience
        $label = $file -replace "^Again_","" -replace "_Nations\.csv",""
        $boostByFaction[$label] = [Math]::Round($sum, 3)
    }

    $rows = foreach ($o in $overview) {
        # Map overview faction name to boost dictionary key (strip leading 'the ' etc. if needed)
        $nameKey = $o.FactionName -replace "^the ",""
        $boostIncome = if ($boostByFaction.ContainsKey($nameKey)) { $boostByFaction[$nameKey] } else { 0 }

        [PSCustomObject]@{
            FactionName        = $o.FactionName
            FactionID          = $o.FactionID
            TotalCPs           = $o.TotalCPs
            TotalGDP           = $o.TotalGDP
            Money              = $o.Money
            Influence          = $o.Influence
            BoostStockpile     = $o.BoostStockpile
            BoostIncomeEstimate = $boostIncome
            HabSiteCount       = $o.HabSiteCount
            MetalsPerDay       = $o.MetalsPerDay
            FissilesPerDay     = $o.FissilesPerDay
        }
    }

    switch ($Format) {
        "Table" {
            $rows | Sort-Object FactionID | Format-Table -AutoSize
        }
        "Markdown" {
            Convert-TIToMarkdownTable -Rows ($rows | Sort-Object FactionID) -PropertyOrder @(
                "FactionName","TotalCPs","TotalGDP","BoostStockpile","BoostIncomeEstimate","HabSiteCount","MetalsPerDay","FissilesPerDay"
            )
        }
        "Json" {
            $rows | Sort-Object FactionID | ConvertTo-Json -Depth 4
        }
    }
}

#endregion Function: Get-TIFactionBoostAndSpaceSummary

#region Function: Get-TISnippetPackMarkdown

function Get-TISnippetPackMarkdown {
    <#
    .SYNOPSIS
    Emits a Markdown "snippet pack" with the main tables needed for a new summary.

    .DESCRIPTION
    Generates, in order:
      - Faction overview (Earth + space + resources).
      - Faction Boost + space summary (adds BoostIncomeEstimate).
      - Resistance nation snapshot (Current Nation Control).
      - Resistance councilors + recruit highlights.
      - Space sitrep (hab income + top Luna/Mars sites).

    Each section is headed and separated by blank lines so it can be
    pasted directly into a dated summary file for editing.
    #>

    $sb = New-Object System.Text.StringBuilder

    # Faction overview
    [void]$sb.AppendLine("## Snippet: Faction Overview (Earth + Space + Resources)")
    [void]$sb.AppendLine()
    [void]$sb.AppendLine(
        (Get-TIFactionOverview -Format Markdown)
    )
    [void]$sb.AppendLine()
    [void]$sb.AppendLine("---")
    [void]$sb.AppendLine()

    # Boost + space summary
    [void]$sb.AppendLine("## Snippet: Boost + Space Summary (Earth CPs, Boost Income, Habs)")
    [void]$sb.AppendLine()
    [void]$sb.AppendLine(
        (Get-TIFactionBoostAndSpaceSummary -Format Markdown)
    )
    [void]$sb.AppendLine()
    [void]$sb.AppendLine("---")
    [void]$sb.AppendLine()

    # Nation control per human faction
    $factionsForNations = @(
        "Resistance",
        "HumanityFirst",
        "Initiative",
        "Servants",
        "Protectorate",
        "Academy",
        "Exodus"
    )

    foreach ($short in $factionsForNations) {
        [void]$sb.AppendLine(("## Snippet: {0} Nation Control" -f $short))
        [void]$sb.AppendLine()
        [void]$sb.AppendLine(
            (Get-TIFactionNationsSnapshot -FactionShortName $short -Format Markdown)
        )
        [void]$sb.AppendLine()
        [void]$sb.AppendLine("---")
        [void]$sb.AppendLine()
    }

    # Councilors + recruits
    [void]$sb.AppendLine("## Snippet: Resistance Councilors & Recruit Highlights")
    [void]$sb.AppendLine()
    [void]$sb.AppendLine(
        (Get-TIResistanceCouncilorSummary -Format Markdown)
    )
    [void]$sb.AppendLine()
    [void]$sb.AppendLine("---")
    [void]$sb.AppendLine()

    # Space sitrep
    [void]$sb.AppendLine("## Snippet: Space Sitrep (Hab Income + Top Luna/Mars Sites)")
    [void]$sb.AppendLine()
    [void]$sb.AppendLine(
        (Get-TISpaceSitrep -Format Markdown)
    )
    [void]$sb.AppendLine()
    [void]$sb.AppendLine("---")
    [void]$sb.AppendLine()

    # Global habs overview (all factions, bases + stations)
    [void]$sb.AppendLine("## Snippet: Habs by Faction (Bases + Stations, Levels, MC)")
    [void]$sb.AppendLine()
    [void]$sb.AppendLine(
        (Get-TIFactionHabsOverview -Format Markdown)
    )
    [void]$sb.AppendLine()
    [void]$sb.AppendLine("---")
    [void]$sb.AppendLine()

    # Resistance research summary (finished + in-progress techs)
    [void]$sb.AppendLine("## Snippet: Resistance Research Summary (Finished + In-Progress Techs)")
    [void]$sb.AppendLine()
    [void]$sb.AppendLine(
        (Get-TIResistanceResearchSummary -Format Markdown)
    )
    [void]$sb.AppendLine()
    [void]$sb.AppendLine("---")
    [void]$sb.AppendLine()

    # Tech completion matrix by faction
    [void]$sb.AppendLine("## Snippet: Tech Completion Matrix (By Faction)")
    [void]$sb.AppendLine()
    [void]$sb.AppendLine(
        (Get-TIFactionTechMatrix -Format Markdown)
    )
    [void]$sb.AppendLine()

    # Weighted power ranking based on Earth/Space/Tech/Fleet pillars
    [void]$sb.AppendLine("---")
    [void]$sb.AppendLine()
    [void]$sb.AppendLine("## Snippet: Power Ranking (Weighted Earth/Space/Tech/Fleet)")
    [void]$sb.AppendLine()
    [void]$sb.AppendLine(
        (Convert-TIToMarkdownTable -Rows (Get-TIFactionPowerScores) -PropertyOrder @(
            "FactionName","EarthScore","SpaceScore","TechScore","FleetScore","PowerScore"
        ))
    )
    [void]$sb.AppendLine()

    # Human faction hate matrix (mutual hatreds, excluding aliens)
    [void]$sb.AppendLine("---")
    [void]$sb.AppendLine()
    [void]$sb.AppendLine("## Snippet: Human Faction Hate Matrix")
    [void]$sb.AppendLine()
    [void]$sb.AppendLine(
        (Get-TIFactionHateMatrixTable -Format Markdown)
    )
    [void]$sb.AppendLine()

    # Alien hate snapshot from CSV export
    [void]$sb.AppendLine("## Snippet: Alien Hate by Faction")
    [void]$sb.AppendLine()
    [void]$sb.AppendLine(
        (Get-TIFactionAlienHateTable -Format Markdown)
    )
    [void]$sb.AppendLine()

    # Ship Power Summary
    [void]$sb.AppendLine("## Snippet: Faction Ship Power (Count & Combat Score)")
    [void]$sb.AppendLine()
    [void]$sb.AppendLine(
        (Get-TIFactionShipSummary -Format Markdown)
    )
    [void]$sb.AppendLine()

    return $sb.ToString()
}

#endregion Function: Get-TISnippetPackMarkdown
#region Interactive menu

function Invoke-TIDataMenu {
    <#
    .SYNOPSIS
    Simple interactive menu to run common data summaries.
    #>

    $options = @(
        [PSCustomObject]@{ Id = 1; Label = "Faction overview (Earth + space + resources)"; Action = { Get-TIFactionOverview -Format Table } },
        [PSCustomObject]@{ Id = 2; Label = "Resistance nations snapshot";                  Action = { Get-TIResistanceNationsSnapshot -Format Table } },
        [PSCustomObject]@{ Id = 3; Label = "Resistance councilors + recruit highlights";   Action = { Get-TIResistanceCouncilorSummary -Format Markdown } },
        [PSCustomObject]@{ Id = 4; Label = "Space sitrep (hab income + top Luna/Mars sites)"; Action = { Get-TISpaceSitrep -Format Markdown } },
        [PSCustomObject]@{ Id = 5; Label = "Boost + space summary (Earth CPs, Boost income, habs)"; Action = { Get-TIFactionBoostAndSpaceSummary -Format Table } },
        [PSCustomObject]@{ Id = 6; Label = "Validate export context (files + quick overview)"; Action = { Test-TIExportContext } },
        [PSCustomObject]@{ Id = 7; Label = "Snippet pack (all main Markdown tables)"; Action = { Get-TISnippetPackMarkdown } },
        [PSCustomObject]@{ Id = 8; Label = "Faction ship power summary"; Action = { Get-TIFactionShipSummary -Format Table } }
    )

    Write-Host "Terra Invicta Data Tools" -ForegroundColor Cyan
    foreach ($opt in $options) {
        Write-Host ("{0}. {1}" -f $opt.Id, $opt.Label)
    }

    $choice = Read-Host "Select an option (or press Enter to cancel)"
    if ([string]::IsNullOrWhiteSpace($choice)) {
        return
    }

    $selected = $options | Where-Object { $_.Id -eq [int]$choice }
    if (-not $selected) {
        Write-Warning "Invalid selection."
        return
    }

    & $selected.Action
}

#endregion Interactive menu

# EOF
