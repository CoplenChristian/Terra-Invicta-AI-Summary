param(
    [string]$SavePath = $null,
    [string]$WorkDir = $null
)

# Load configuration
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $scriptPath "config.json"
if (-not (Test-Path $configPath)) {
    throw "Config file not found at $configPath"
}
$config = Get-Content $configPath -Raw | ConvertFrom-Json

if ([string]::IsNullOrEmpty($WorkDir)) {
    $WorkDir = $config.WorkDir
    if ($WorkDir -eq ".") { $WorkDir = $scriptPath }
}

if ([string]::IsNullOrEmpty($SavePath)) {
    $SavePath = $config.SavePath
}

$csvSubDir = $config.CsvSubDir

Set-Location -Path $WorkDir

# All CSV exports are written under the dedicated csv/ folder
$outputDir = Join-Path $WorkDir $csvSubDir
if (-not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir | Out-Null
}

$factions = @(
    @{ Template = "ResistCouncil";  Short = "Resistance"     },
    @{ Template = "DestroyCouncil"; Short = "HumanityFirst"  },
    @{ Template = "ExploitCouncil"; Short = "Initiative"     },
    @{ Template = "SubmitCouncil";  Short = "Servants"       },
    @{ Template = "AppeaseCouncil"; Short = "Protectorate"   },
    @{ Template = "CooperateCouncil"; Short = "Academy"      },
    @{ Template = "EscapeCouncil";  Short = "Exodus"         },
    @{ Template = "AlienCouncil";   Short = "Aliens"         }
)

# Create a temporary JSON file for this run only
$tempJson = [IO.Path]::Combine(
    $WorkDir,
    ("Again_{0}.json" -f ([System.Guid]::NewGuid().ToString("N")))
)

$gameTimeString = $null
$gameTimeDateIso = $null
$gameTimeDateYmd = $null
$gameDifficulty = $null
$humanFactionOrder = @(
    "Humanity First",
    "the Resistance",
    "Project Exodus",
    "the Initiative",
    "the Academy",
    "the Protectorate",
    "the Servants"
)

try {
    Set-Alias pwsh powershell
    # Decompress Again.gz -> temp JSON
    $fs = [IO.File]::OpenRead($SavePath)
    try {
        $gz = New-Object IO.Compression.GzipStream(
            $fs,
            [IO.Compression.CompressionMode]::Decompress
        )
        try {
            $out = [IO.File]::Create($tempJson)
            try {
                $gz.CopyTo($out)
            }
            finally {
                $out.Close()
            }
        }
        finally {
            $gz.Close()
        }
    }
    finally {
        $fs.Close()
    }

    # Load JSON once
    $json = Get-Content $tempJson -Raw | ConvertFrom-Json

    # Capture in-game time string for downstream prompts
    $metaState = $json.gamestates.'PavonisInteractive.TerraInvicta.TIMetadataState' |
        ForEach-Object { $_.Value } | Select-Object -First 1
    if ($metaState -and $metaState.PSObject.Properties.Name -contains 'gameTimeString') {
        $gameTimeString = $metaState.gameTimeString
        $gameDifficulty = $metaState.difficulty
        try {
            $dt = [DateTime]::Parse($gameTimeString, [System.Globalization.CultureInfo]::InvariantCulture)
            $gameTimeDateIso = $dt.ToString("yyyy-MM-dd")
            $gameTimeDateYmd = $dt.ToString("yyyyMMdd")
        } catch {
            # ignore parse failures; leave iso/ymd null
        }
    }

    $factionStates = $json.gamestates.'PavonisInteractive.TerraInvicta.TIFactionState' |
        ForEach-Object { $_.Value }
    $factionNameById = @{}
    foreach ($f in $factionStates) {
        $factionNameById[$f.ID.value] = $f.displayName
    }
    $humanFactions = $factionStates | Where-Object { $humanFactionOrder -contains $_.displayName }

    # --- Core faction resources for all factions (Earth + space stockpiles) ---
    $coreOut = Join-Path $outputDir "Again_Factions_Core.csv"
    $factionStates |
        Select-Object `
            templateName,
            displayName,
            @{Name = 'FactionID'; Expression = { $_.ID.value }},
            @{Name = 'Money'; Expression = { $_.resources.Money }},
            @{Name = 'Influence'; Expression = { $_.resources.Influence }},
            @{Name = 'Operations'; Expression = { $_.resources.Operations }},
            @{Name = 'Boost'; Expression = { $_.resources.Boost }},
            @{Name = 'Water'; Expression = { $_.resources.Water }},
            @{Name = 'Volatiles'; Expression = { $_.resources.Volatiles }},
            @{Name = 'Metals'; Expression = { $_.resources.Metals }},
            @{Name = 'NobleMetals'; Expression = { $_.resources.NobleMetals }},
            @{Name = 'Fissiles'; Expression = { $_.resources.Fissiles }},
            @{Name = 'Exotics'; Expression = { $_.resources.Exotics }} |
        Export-Csv -Path $coreOut -NoTypeInformation -Encoding UTF8

    # --- Per-faction alien hate snapshot ---
    $alienHateOut = Join-Path $outputDir "Again_Faction_AlienHate.csv"

    $factionStates |
        Select-Object `
            @{Name = 'FactionName'; Expression = { $_.displayName }},
            @{Name = 'TemplateName'; Expression = { $_.templateName }},
            @{Name = 'AssessedAlienHateOfMe'; Expression = { $_.assessedAlienHateOfMe }} |
        Export-Csv -Path $alienHateOut -NoTypeInformation -Encoding UTF8

    # --- Shared nation / councilor / org collections ---
    $nationStates = $json.gamestates.'PavonisInteractive.TerraInvicta.TINationState' |
        ForEach-Object { $_.Value }

    $controlPointStates = $json.gamestates.'PavonisInteractive.TerraInvicta.TIControlPoint' |
        ForEach-Object { $_.Value }

    $councilorStates = $json.gamestates.'PavonisInteractive.TerraInvicta.TICouncilorState' |
        ForEach-Object { $_.Value }

    # All orgs (used to compute org-based effective attributes per councilor)
    $orgStates = $json.gamestates.'PavonisInteractive.TerraInvicta.TIOrgState' |
        ForEach-Object { $_.Value }

    $orgById = @{}
    foreach ($org in $orgStates) {
        if ($org -and $org.ID) {
            $orgById[$org.ID.value] = $org
        }
    }

    $habStates = $json.gamestates.'PavonisInteractive.TerraInvicta.TIHabState' |
        ForEach-Object { $_.Value }

    # Individual hab sites on each space body (resource nodes)
    $habSiteStates = $json.gamestates.'PavonisInteractive.TerraInvicta.TIHabSiteState' |
        ForEach-Object { $_.Value }

    # Modules installed on each hab (used to detect mining complexes)
    $habModuleStates = $json.gamestates.'PavonisInteractive.TerraInvicta.TIHabModuleState' |
        ForEach-Object { $_.Value }

    $spaceBodies = $json.gamestates.'PavonisInteractive.TerraInvicta.TISpaceBodyState' |
        ForEach-Object { $_.Value }

    $fleetStates = $json.gamestates.'PavonisInteractive.TerraInvicta.TISpaceFleetState' |
        ForEach-Object { $_.Value }

    $shipStates = $json.gamestates.'PavonisInteractive.TerraInvicta.TISpaceShipState' |
        ForEach-Object { $_.Value }
    
    $shipById = @{}
    if ($shipStates) {
        foreach ($s in $shipStates) {
            $shipById[$s.ID.value] = $s
        }
    }

    # --- Ship Component Scoring Helper ---
    function Get-ShipComponentScores {
        param($JsonDir)
        $scores = @{}
        if (-not (Test-Path $JsonDir)) { return $scores }

        $files = Get-ChildItem -Path $JsonDir -Filter "*.json"
        foreach ($file in $files) {
            try {
                $jsonContent = Get-Content $file.FullName -Raw | ConvertFrom-Json
                
                # Determine multiplier based on component type
                $multiplier = 1
                if ($file.Name -match "Weapon" -or $file.Name -match "Gun" -or $file.Name -match "Missile" -or $file.Name -match "Laser" -or $file.Name -match "Plasma" -or $file.Name -match "Magnetic") { 
                    $multiplier = 10 
                } elseif ($file.Name -match "Drive") { 
                    $multiplier = 5 
                } elseif ($file.Name -match "PowerPlant") { 
                    $multiplier = 2 
                } elseif ($file.Name -match "Hull") { 
                    $multiplier = 20 
                }

                foreach ($item in $jsonContent) {
                    if ($item.dataName) {
                        $val = 1
                        if ($item.sortOrder) { $val = [int]$item.sortOrder }
                        elseif ($item.sort) { $val = [int]$item.sort }
                        
                        $scores[$item.dataName] = $val * $multiplier
                    }
                }
            } catch {
                Write-Warning "Failed to load scoring from $($file.Name)"
            }
        }
        return $scores
    }

    $shipInfoDir = Join-Path $WorkDir "Ship_Info/raw_json"
    $componentScores = Get-ShipComponentScores -JsonDir $shipInfoDir

    $globalResearch = $json.gamestates.'PavonisInteractive.TerraInvicta.TIGlobalResearchState' |
        ForEach-Object { $_.Value }

    # --- Global councilor recruit pool (unassigned, active councilors actually in the pool) ---
    $recruitsOut = Join-Path $outputDir "Again_Councilor_Recruits.csv"

    $councilorStates |
        # Recruit pool = unassigned, active councilors (including newly generated ones
        # where everBeenAvailable may still be false, e.g. Manesh Gelgai).
        Where-Object { -not $_.faction -and $_.status -eq "Active" } |
        Select-Object `
            @{Name = 'ID'; Expression = { $_.ID.value }},
            displayName,
            personalName,
            familyName,
            typeTemplateName,
            @{Name = 'HomeRegionID'; Expression = { $_.homeRegion.value }},
            @{Name = 'Persuasion'; Expression = { $_.attributes.Persuasion }},
            @{Name = 'Investigation'; Expression = { $_.attributes.Investigation }},
            @{Name = 'Espionage'; Expression = { $_.attributes.Espionage }},
            @{Name = 'Command'; Expression = { $_.attributes.Command }},
            @{Name = 'Administration'; Expression = { $_.attributes.Administration }},
            @{Name = 'Science'; Expression = { $_.attributes.Science }},
            @{Name = 'Security'; Expression = { $_.attributes.Security }},
            @{Name = 'Loyalty'; Expression = { $_.attributes.Loyalty }},
            status |
        Export-Csv -Path $recruitsOut -NoTypeInformation -Encoding UTF8

    # --- Global tech tree exports (finished and in-progress) ---
    $techsOut = Join-Path $outputDir "Again_Techs_Global.csv"

    $gr = $globalResearch | Select-Object -First 1

    $rowsTech = @()
    if ($gr.finishedTechsNames) {
        foreach ($t in $gr.finishedTechsNames) {
            $rowsTech += [PSCustomObject]@{
                TechTemplateName   = $t
                Status             = "Finished"
                AccumulatedResearch = $null
                SelectorFactionID  = $null
            }
        }
    }
    if ($gr.techProgress) {
        foreach ($tp in $gr.techProgress) {
            $rowsTech += [PSCustomObject]@{
                TechTemplateName   = $tp.techTemplateName
                Status             = "InProgress"
                AccumulatedResearch = $tp.accumulatedResearch
                SelectorFactionID  = $tp.selector.value
            }
        }
    }

    $rowsTech | Export-Csv -Path $techsOut -NoTypeInformation -Encoding UTF8

    # --- Per-faction research status (finished + in-progress) ---
    # For each faction, emit Again_<Short>_Projects.csv mirroring the old Resistance_Projects format.
    foreach ($f in $factions) {
        $tpl   = $f.Template
        $short = $f.Short

        $facState = $factionStates | Where-Object templateName -eq $tpl
        if (-not $facState) { continue }

        $facId = $facState.ID.value
        $projectsOut = Join-Path $outputDir ("Again_{0}_Projects.csv" -f $short)

        $rowsFac = @()

        # Global finished techs
        if ($gr.finishedTechsNames) {
            foreach ($t in $gr.finishedTechsNames) {
                $rowsFac += [PSCustomObject]@{
                    TechTemplateName    = $t
                    Status              = "GlobalFinished"
                    AccumulatedResearch = $null
                    IsSelector          = $false
                    Source              = "Global"
                }
            }
        }

        # Global tech progress (mark selector faction)
        if ($gr.techProgress) {
            foreach ($tp in $gr.techProgress) {
                $rowsFac += [PSCustomObject]@{
                    TechTemplateName    = $tp.techTemplateName
                    Status              = "GlobalInProgress"
                    AccumulatedResearch = $tp.accumulatedResearch
                    IsSelector          = ($tp.selector.value -eq $facId)
                    Source              = "Global"
                }
            }
        }

        # Faction-specific finished projects (Project_* names)
        if ($facState.finishedProjectNames) {
            foreach ($p in $facState.finishedProjectNames) {
                $rowsFac += [PSCustomObject]@{
                    TechTemplateName    = $p
                    Status              = "FactionFinished"
                    AccumulatedResearch = $null
                    IsSelector          = $false
                    Source              = "FactionProject"
                }
            }
        }

        $rowsFac |
            Sort-Object TechTemplateName, Status |
            Export-Csv -Path $projectsOut -NoTypeInformation -Encoding UTF8
    }

    # --- Alien councilors ---
    $alienFaction = $factionStates | Where-Object templateName -eq "AlienCouncil"
    if ($alienFaction) {
        $alienId = $alienFaction.ID.value
        $alienCouncilorsOut = Join-Path $outputDir "Again_Aliens_Councilors.csv"

        $councilorStates |
            Where-Object { $_.faction -and $_.faction.value -eq $alienId } |
            Select-Object `
                @{Name = 'ID'; Expression = { $_.ID.value }},
                displayName,
                templateName,
                typeTemplateName,
                @{Name = 'Persuasion'; Expression = { $_.attributes.Persuasion }},
                @{Name = 'Investigation'; Expression = { $_.attributes.Investigation }},
                @{Name = 'Espionage'; Expression = { $_.attributes.Espionage }},
                @{Name = 'Command'; Expression = { $_.attributes.Command }},
                @{Name = 'Administration'; Expression = { $_.attributes.Administration }},
                @{Name = 'Science'; Expression = { $_.attributes.Science }},
                @{Name = 'Security'; Expression = { $_.attributes.Security }},
                @{Name = 'Loyalty'; Expression = { $_.attributes.Loyalty }},
                status,
                homeRegion,
                locationRegionName |
            Export-Csv -Path $alienCouncilorsOut -NoTypeInformation -Encoding UTF8

        # --- Alien habs ---
        $alienHabsOut = Join-Path $outputDir "Again_Aliens_Habs.csv"

        $habStates |
            Where-Object { $_.faction -and $_.faction.value -eq $alienId } |
            Select-Object `
                @{Name = 'HabID'; Expression = { $_.ID.value }},
                displayName,
                templateName,
                habType,
                tier,
                inEarthLEO,
                staticHab,
                underBombardment,
                inCombat,
                @{Name = 'OrbitStateID'; Expression = { if ($_.orbitState) { $_.orbitState.value } else { $null } }},
                @{Name = 'BarycenterID'; Expression = { if ($_.barycenter) { $_.barycenter.value } else { $null } }} |
            Export-Csv -Path $alienHabsOut -NoTypeInformation -Encoding UTF8

        # --- Alien fleets ---
        $alienFleetsOut = Join-Path $outputDir "Again_Aliens_Fleets.csv"

        $fleetStates |
            Where-Object { $_.faction -and $_.faction.value -eq $alienId } |
            Select-Object `
                @{Name = 'FleetID'; Expression = { $_.ID.value }},
                displayName,
                templateName,
                @{Name = 'ShipIDs'; Expression = {
                    if ($_.ships) {
                        ($_.ships | ForEach-Object { $_.value }) -join ';'
                    } else { "" }
                }},
                @{Name = 'OrbitStateID'; Expression = { if ($_.orbitState) { $_.orbitState.value } else { $null } }},
                @{Name = 'BarycenterID'; Expression = { if ($_.barycenter) { $_.barycenter.value } else { $null } }} |
            Export-Csv -Path $alienFleetsOut -NoTypeInformation -Encoding UTF8
    }

    # --- All Ships Export (with Power Score) ---
    $shipsOut = Join-Path $outputDir "Again_Faction_Ships.csv"
    $rowsShips = @()

    # Cache for template scores
    $templateScores = @{}

    # Pass 1: Calculate scores for ships with defined components and populate cache
    foreach ($fleet in $fleetStates) {
        if (-not $fleet.ships) { continue }
        foreach ($shipRef in $fleet.ships) {
            $sid = $shipRef.value
            if (-not $shipById.ContainsKey($sid)) { continue }
            $ship = $shipById[$sid]

            # Helper to check if list has valid components (not just refs)
            $HasValidComponents = {
                param($list)
                if (-not $list) { return $false }
                foreach ($c in $list) {
                    # If it has a template name or data name directly, it's valid.
                    # If it's just a ref (PSCustomObject with only $ref), it's not.
                    if ($c.moduleTemplateName -or $c.dataName) { return $true }
                }
                return $false
            }

            $hasValid = (& $HasValidComponents -list $ship.noseWeapons) -or 
                        (& $HasValidComponents -list $ship.hullWeapons) -or 
                        (& $HasValidComponents -list $ship.utilityModules)

            if ($hasValid) {
                # Calculate Score
                $score = 0
                
                # Helper to add score for a component list
                $AddScore = {
                    param($list)
                    $s = 0
                    if ($list) {
                        foreach ($comp in $list) {
                            $name = $null
                            if ($comp.moduleTemplateName) { $name = $comp.moduleTemplateName }
                            elseif ($comp.dataName) { $name = $comp.dataName }
                            
                            if ($name -and $componentScores.ContainsKey($name)) {
                                $s += $componentScores[$name]
                            }
                        }
                    }
                    return $s
                }

                $score += & $AddScore -list $ship.noseWeapons
                $score += & $AddScore -list $ship.hullWeapons
                $score += & $AddScore -list $ship.utilityModules
                
                # Cache score for this template
                if ($ship.templateName -and -not $templateScores.ContainsKey($ship.templateName)) {
                    $templateScores[$ship.templateName] = $score
                }
                
                # Store score on ship object temporarily for Pass 2
                $ship | Add-Member -MemberType NoteProperty -Name "CalculatedScore" -Value $score -Force
            }
        }
    }

    # Pass 2: Export all ships, using cache for those missing scores
    foreach ($fleet in $fleetStates) {
        if (-not $fleet.ships) { continue }
        
        $fid = if ($fleet.faction) { $fleet.faction.value } else { $null }
        $fState = if ($fid) { $factionStates | Where-Object { $_.ID.value -eq $fid } } else { $null }
        $fName = if ($fState) { $fState.displayName } else { $null }

        foreach ($shipRef in $fleet.ships) {
            $sid = $shipRef.value
            if (-not $shipById.ContainsKey($sid)) { continue }
            $ship = $shipById[$sid]

            $finalScore = 0
            if ($ship.PSObject.Properties.Match("CalculatedScore").Count -gt 0) {
                $finalScore = $ship.CalculatedScore
            } elseif ($ship.templateName -and $templateScores.ContainsKey($ship.templateName)) {
                $finalScore = $templateScores[$ship.templateName]
            }
            
            $rowsShips += [PSCustomObject]@{
                FactionID     = $fid
                FactionName   = $fName
                FleetID       = $fleet.ID.value
                FleetName     = $fleet.displayName
                ShipID        = $ship.ID.value
                ShipName      = $ship.displayName
                TemplateName  = $ship.templateName
                CombatPower   = $finalScore
            }
        }
    }

    $rowsShips | 
        Sort-Object FactionName, CombatPower -Descending |
        Export-Csv -Path $shipsOut -NoTypeInformation -Encoding UTF8

    # --- All space bodies ---
    $spaceBodiesOut = Join-Path $outputDir "Again_SpaceBodies.csv"

    $spaceBodies |
        Select-Object `
            @{Name = 'BodyID'; Expression = { $_.ID.value }},
            templateName,
            displayName,
            maxHabTier,
            @{Name = 'HabSiteIDs'; Expression = {
                if ($_.habSites) {
                    ($_.habSites | ForEach-Object { $_.value }) -join ';'
                } else { "" }
            }},
            @{Name = 'OrbitIDs'; Expression = {
                if ($_.orbits) {
                    ($_.orbits | ForEach-Object { $_.value }) -join ';'
                } else { "" }
            }},
            @{Name = 'BarycenterID'; Expression = {
                if ($_.barycenter) { $_.barycenter.value } else { $null }
            }} |
        Export-Csv -Path $spaceBodiesOut -NoTypeInformation -Encoding UTF8

    # --- Mining level detection per hab (for mining-only income views) ---
    # Build sectorID -> habID lookup so we can associate modules back to habs
    $sectorHabById = @{}
    foreach ($h in $habStates) {
        if ($h.sectors) {
            foreach ($sec in $h.sectors) {
                $sectorHabById[$sec.value] = $h.ID.value
            }
        }
    }

    # Map habID -> highest mining level present (0 = none)
    $habMiningLevelById = @{}
    foreach ($m in $habModuleStates) {
        $tpl = $m.templateName
        if (-not $tpl) { continue }

        $level = switch -Regex ($tpl) {
            'OutpostMiningComplex'    { 1; break }
            'SettlementMiningComplex' { 2; break }
            'ColonyMiningComplex'     { 3; break }
            'AutomatedMiningComplex'  { 1; break } # automated mine is tier-1 but higher multiplier
            default { 0 }
        }

        if ($level -le 0) { continue }

        $sectorId = if ($m.sector) { $m.sector.value } else { $null }
        if (-not $sectorId) { continue }
        if (-not $sectorHabById.ContainsKey($sectorId)) { continue }

        $habId = $sectorHabById[$sectorId]

        if (-not $habMiningLevelById.ContainsKey($habId) -or $habMiningLevelById[$habId] -lt $level) {
            $habMiningLevelById[$habId] = $level
        }
    }

    # --- Per-site resource details for all hab sites ---
    # This CSV complements Again_SpaceBodies.csv by listing every hab site,
    # its parent body, coordinates, and daily resource yields.
    $habSitesOut = Join-Path $outputDir "Again_HabSites.csv"

    # Build a lookup from body ID to body state so we can attach names
    function Get-VectorMagnitude {
        param($vec)

        if (-not $vec) { return $null }
        $x = [double]$vec.x
        $y = [double]$vec.y
        $z = [double]$vec.z
        $mag = [Math]::Sqrt($x * $x + $y * $y + $z * $z)
        if ($mag -gt 0) { return $mag }
        return $null
    }

    $bodyById = @{}
    foreach ($b in $spaceBodies) {
        $bodyById[$b.ID.value] = $b
    }

    # Precompute solar multiplier per body so hab sites can inherit their parent body's value
    $earthBody = $spaceBodies | Where-Object { $_.templateName -eq 'Earth' -or $_.displayName -eq 'Earth' } | Select-Object -First 1
    $earthSunDistance = if ($earthBody) { Get-VectorMagnitude -vec $earthBody.globalPosition } else { $null }

    $solarMultiplierByBodyId = @{}
    foreach ($b in $spaceBodies) {
        $dist = Get-VectorMagnitude -vec $b.globalPosition
        if ($earthSunDistance -and $dist) {
            $solarMultiplierByBodyId[$b.ID.value] = [Math]::Round([Math]::Pow($earthSunDistance / $dist, 2), 6)
        } else {
            $solarMultiplierByBodyId[$b.ID.value] = $null
        }
    }

    $habSiteStates |
        Select-Object `
            @{Name = 'SiteID'; Expression = { $_.ID.value }},
            templateName,
            displayName,
            @{Name = 'ParentBodyID'; Expression = { if ($_.parentBody) { $_.parentBody.value } else { $null } }},
            @{Name = 'ParentBodyName'; Expression = {
                if ($_.parentBody) {
                    $pbId = $_.parentBody.value
                    if ($bodyById.ContainsKey($pbId)) {
                        $bodyById[$pbId].displayName
                    } else {
                        $null
                    }
                } else {
                    $null
                }
            }},
            @{Name = 'SolarMultiplier'; Expression = {
                if ($_.parentBody) {
                    $pbId = $_.parentBody.value
                    if ($solarMultiplierByBodyId.ContainsKey($pbId)) {
                        $solarMultiplierByBodyId[$pbId]
                    } else {
                        $null
                    }
                } else {
                    $null
                }
            }},
            @{Name = 'Latitude'; Expression = { $_.latitude }},
            @{Name = 'Longitude'; Expression = { $_.longitude }},
            @{Name = 'WaterPerDay'; Expression = { $_.water_day }},
            @{Name = 'VolatilesPerDay'; Expression = { $_.volatiles_day }},
            @{Name = 'MetalsPerDay'; Expression = { $_.metals_day }},
            @{Name = 'NoblesPerDay'; Expression = { $_.nobles_day }},
            @{Name = 'FissilesPerDay'; Expression = { $_.fissiles_day }},
            @{Name = 'HasHab'; Expression = { if ($_.hab) { $true } else { $false } }},
            @{Name = 'HabID'; Expression = { if ($_.hab) { $_.hab.value } else { $null } }},
            @{Name = 'HabType'; Expression = {
                if ($_.hab) {
                    $hId = $_.hab.value
                    $h = $habStates | Where-Object { $_.ID.value -eq $hId }
                    if ($h) { $h.habType } else { $null }
                } else {
                    $null
                }
            }},
            @{Name = 'HabSchematicTemplateName'; Expression = {
                if ($_.hab) {
                    $hId = $_.hab.value
                    $h = $habStates | Where-Object { $_.ID.value -eq $hId }
                    if ($h) { $h.habSchematicTemplateName } else { $null }
                } else {
                    $null
                }
            }},
            @{Name = 'IsShipyard'; Expression = {
                if ($_.hab) {
                    $hId = $_.hab.value
                    $h = $habStates | Where-Object { $_.ID.value -eq $hId }
                    if ($h -and $h.habSchematicTemplateName -eq 'ShipbuildingHabSchematic') {
                        $true
                    } else {
                        $false
                    }
                } else {
                    $false
                }
            }},
            @{Name = 'HabLevel'; Expression = {
                if ($_.hab) {
                    $hId = $_.hab.value
                    $h = $habStates | Where-Object { $_.ID.value -eq $hId }
                    if ($h -and $h.PSObject.Properties.Name -contains 'tier' -and $h.tier -ne $null -and $h.tier -gt 0) {
                        [int]$h.tier
                    } else {
                        $null
                    }
                } else {
                    $null
                }
            }},
            @{Name = 'MCCost'; Expression = {
                if ($_.hab) {
                    $hId = $_.hab.value
                    $h = $habStates | Where-Object { $_.ID.value -eq $hId }
                    if ($h) {
                        $tier = if ($h.PSObject.Properties.Name -contains 'tier' -and $h.tier -ne $null) { [int]$h.tier } else { 0 }
                        $isAutomated = $false
                        if ($h.habSchematicTemplateName -match 'Automated') { $isAutomated = $true }

                        if ($tier -le 0) {
                            $null
                        } elseif ($isAutomated -and $tier -eq 1) {
                            1
                        } elseif ($tier -eq 1) {
                            2
                        } elseif ($tier -eq 2) {
                            3
                        } elseif ($tier -eq 3) {
                            4
                        } else {
                            $null
                        }
                    } else {
                        $null
                    }
                } else {
                    $null
                }
            }},
            @{Name = 'FactionID'; Expression = {
                if ($_.hab) {
                    $hId = $_.hab.value
                    $h = $habStates | Where-Object { $_.ID.value -eq $hId }
                    if ($h -and $h.faction) { $h.faction.value } else { $null }
                } else {
                    $null
                }
            }},
            @{Name = 'FactionName'; Expression = {
                if ($_.hab) {
                    $hId = $_.hab.value
                    $h = $habStates | Where-Object { $_.ID.value -eq $hId }
                    if ($h -and $h.faction) {
                        $fid = $h.faction.value
                        ($factionStates | Where-Object { $_.ID.value -eq $fid }).displayName
                    } else {
                        $null
                    }
                } else {
                    $null
                }
            }},
            @{Name = 'MiningLevel'; Expression = {
                if ($_.hab) {
                    $hId = $_.hab.value
                    if ($habMiningLevelById.ContainsKey($hId)) {
                        $habMiningLevelById[$hId]
                    } else {
                        0
                    }
                } else {
                    0
                }
            }},
            pendingHab |
        Export-Csv -Path $habSitesOut -NoTypeInformation -Encoding UTF8

    # --- Aggregated hab-site resource income per faction (space mining economy only) ---
    # One row per faction that owns at least one *mining* hab, summing daily yields
    # from all occupied sites whose hab has a mining complex (MiningLevel > 0).
    $habIncomeOut = Join-Path $outputDir "Again_Faction_HabIncome.csv"

    # Build a quick lookup of habID -> factionID for owned habs
    $habFactionById = @{}
    foreach ($h in $habStates) {
        $hid = $h.ID.value
        $fid = if ($h.faction) { $h.faction.value } else { $null }
        $habFactionById[$hid] = $fid
    }

    # Accumulate mining-only resource totals per factionID
    $miningIncomeByFaction = @{}
    foreach ($site in $habSiteStates) {
        if (-not $site.hab) { continue }
        $hid = $site.hab.value
        if (-not $habFactionById.ContainsKey($hid)) { continue }
        $fid = $habFactionById[$hid]
        if (-not $fid) { continue }

        # Only count sites where the owning hab has a mining complex
        $miningLevel = if ($habMiningLevelById.ContainsKey($hid)) { $habMiningLevelById[$hid] } else { 0 }
        if ($miningLevel -le 0) { continue }

        if (-not $miningIncomeByFaction.ContainsKey($fid)) {
            $miningIncomeByFaction[$fid] = @{
                WaterPerDay      = 0.0
                VolatilesPerDay  = 0.0
                MetalsPerDay     = 0.0
                NoblesPerDay     = 0.0
                FissilesPerDay   = 0.0
                SiteCount        = 0
            }
        }

        $macc = $miningIncomeByFaction[$fid]
        $macc.WaterPerDay     += [double]$site.water_day
        $macc.VolatilesPerDay += [double]$site.volatiles_day
        $macc.MetalsPerDay    += [double]$site.metals_day
        $macc.NoblesPerDay    += [double]$site.nobles_day
        $macc.FissilesPerDay  += [double]$site.fissiles_day
        $macc.SiteCount       += 1
    }

    # Emit one row per faction with any mining hab income
    $rowsHabIncome = @()
    foreach ($kvp in $miningIncomeByFaction.GetEnumerator()) {
        $fid = [int]$kvp.Key
        $vals = $kvp.Value
        $fState = $factionStates | Where-Object { $_.ID.value -eq $fid }

        $rowsHabIncome += [PSCustomObject]@{
            FactionID        = $fid
            FactionTemplate  = if ($fState) { $fState.templateName } else { $null }
            FactionName      = if ($fState) { $fState.displayName } else { $null }
            SiteCount        = $vals.SiteCount
            WaterPerDay      = [Math]::Round($vals.WaterPerDay, 6)
            VolatilesPerDay  = [Math]::Round($vals.VolatilesPerDay, 6)
            MetalsPerDay     = [Math]::Round($vals.MetalsPerDay, 6)
            NoblesPerDay     = [Math]::Round($vals.NoblesPerDay, 6)
            FissilesPerDay   = [Math]::Round($vals.FissilesPerDay, 6)
        }
    }

    $rowsHabIncome |
        Sort-Object FactionID |
        Export-Csv -Path $habIncomeOut -NoTypeInformation -Encoding UTF8

    # --- Per-hab (station/base) summary CSV ---
    # This CSV lists each existing hab (station/base), its faction, type, orbit flags,
    # and associated hab site if any, for easier orbit/station analysis.
    $habsOut = Join-Path $outputDir "Again_Habs_All.csv"

    # Build lookups for orbit states and space bodies to label orbits
    $orbitStateStates = $json.gamestates.'PavonisInteractive.TerraInvicta.TIOrbitState' |
        ForEach-Object { $_.Value }

    $orbitById = @{}
    foreach ($o in $orbitStateStates) {
        $orbitById[$o.ID.value] = $o
    }

    $bodyByIdForOrbits = @{}
    foreach ($b in $spaceBodies) {
        $bodyByIdForOrbits[$b.ID.value] = $b
    }

    $rowsHabs = foreach ($h in $habStates) {
        $fid = if ($h.faction) { $h.faction.value } else { $null }
        $fState = if ($fid) { $factionStates | Where-Object { $_.ID.value -eq $fid } } else { $null }

        # Try to find a matching hab site (many station/base habs map 1:1 to a site)
        $site = $habSiteStates | Where-Object { $_.hab -and $_.hab.value -eq $h.ID.value } | Select-Object -First 1

        # Resolve orbit body name if possible
        $orbitBodyName = $null
        if ($h.orbitState -and $orbitById.ContainsKey($h.orbitState.value)) {
            $o = $orbitById[$h.orbitState.value]
            if ($o.barycenter -and $bodyByIdForOrbits.ContainsKey($o.barycenter.value)) {
                $orbitBodyName = $bodyByIdForOrbits[$o.barycenter.value].displayName
            }
        }

        # Determine hab level and MC cost by hab type/tier
        $tier = if ($h.PSObject.Properties.Name -contains 'tier' -and $h.tier -ne $null) { [int]$h.tier } else { 0 }
        $isAutomated = $false
        if ($h.habSchematicTemplateName -match 'Automated') {
            $isAutomated = $true
        }

        $habLevel = $tier
        if ($habLevel -le 0) { $habLevel = $null }

        $mcCost = $null
        if ($isAutomated -and $habLevel -eq 1) {
            $mcCost = 1
        } elseif ($habLevel -eq 1) {
            $mcCost = 2
        } elseif ($habLevel -eq 2) {
            $mcCost = 3
        } elseif ($habLevel -eq 3) {
            $mcCost = 4
        }

        [PSCustomObject]@{
            HabID                   = $h.ID.value
            HabName                 = $h.displayName
            HabType                 = $h.habType
            HabSchematicTemplateName = $h.habSchematicTemplateName
            FactionID               = $fid
            FactionName             = if ($fState) { $fState.displayName } else { $null }
            InEarthLEO              = $h.inEarthLEO
            StaticHab               = $h.staticHab
            HasHabSite              = if ($site) { $true } else { $false }
            HabSiteID               = if ($site) { $site.ID.value } else { $null }
            OrbitBodyName           = $orbitBodyName
            HabLevel                = $habLevel
            MCCost                  = $mcCost
        }
    }

    $rowsHabs |
        Sort-Object FactionID, HabName |
        Export-Csv -Path $habsOut -NoTypeInformation -Encoding UTF8

    # Convenience: per-faction hab CSVs (stations + bases)
    foreach ($f in $factions) {
        $templateName = $f.Template
        $shortName    = $f.Short

        $fState = $factionStates | Where-Object templateName -eq $templateName
        if (-not $fState) { continue }

        $display = $fState.displayName
        $perFaction = $rowsHabs | Where-Object { $_.FactionName -eq $display }
        if (-not $perFaction -or $perFaction.Count -eq 0) { continue }

        $outPath = Join-Path $outputDir ("Again_{0}_Habs.csv" -f $shortName)
        $perFaction |
            Sort-Object HabName |
            Export-Csv -Path $outPath -NoTypeInformation -Encoding UTF8
    }

    # --- Aggregated Earth nation metrics per faction (based on controlled CPs) ---
    # This CSV summarizes, for each non-alien faction, how much Earth they control
    # in terms of CPs, GDP, and population.
    $earthAggOut = Join-Path $outputDir "Again_Faction_EarthSummary.csv"

    $rowsEarth = @()
    foreach ($f in $factions) {
        if ($f.Template -eq "AlienCouncil") { continue }

        $faction = $factionStates | Where-Object templateName -eq $f.Template
        if (-not $faction) { continue }
        $fid = $faction.ID.value

        # Collect this faction's control points
        $factionCPIds = @()
        if ($faction.controlPoints) {
            $factionCPIds = $faction.controlPoints | ForEach-Object { $_.value }
        }

        if (-not $factionCPIds -or $factionCPIds.Count -eq 0) { continue }

        # Build a quick CP lookup by ID
        $cpById = @{}
        foreach ($cp in $controlPointStates) {
            $cpById[$cp.ID.value] = $cp
        }

        $totalCPs = 0
        [double]$totalGDP = 0.0
        [double]$totalPop = 0.0

        foreach ($cpId in $factionCPIds) {
            $cp = $cpById[$cpId]
            if (-not $cp) { continue }
            $nation = $nationStates | Where-Object { $_.ID.value -eq $cp.nation.value }
            if (-not $nation) { continue }

            $totalCPs += 1
            if ($nation.PSObject.Properties.Name -contains 'gdp' -and $nation.gdp -ne $null) {
                $totalGDP += [double]$nation.gdp
            }
            if ($nation.PSObject.Properties.Name -contains 'population' -and $nation.population -ne $null) {
                $totalPop += [double]$nation.population
            }
        }

        $rowsEarth += [PSCustomObject]@{
            FactionID        = $fid
            FactionTemplate  = $faction.templateName
            FactionName      = $faction.displayName
            TotalCPs         = $totalCPs
            TotalGDP         = [Math]::Round($totalGDP, 2)
            TotalPopulation  = [Math]::Round($totalPop, 0)
        }
    }

    $rowsEarth |
        Sort-Object FactionID |
        Export-Csv -Path $earthAggOut -NoTypeInformation -Encoding UTF8

    foreach ($f in $factions) {
        $templateName = $f.Template
        $shortName    = $f.Short

        $faction = $factionStates | Where-Object templateName -eq $templateName
        if (-not $faction) {
            continue
        }
        $fid = $faction.ID.value

        if ($templateName -ne "AlienCouncil") {
            # Nations for this faction
            $nationsOut = Join-Path $outputDir ("Again_{0}_Nations.csv" -f $shortName)

            # Nations/CPs for this faction based on its controlPoints list
            $factionCPIds = @()
            if ($faction.controlPoints) {
                $factionCPIds = $faction.controlPoints | ForEach-Object { $_.value }
            }

            $cpById = @{}
            foreach ($cp in $controlPointStates) {
                $cpById[$cp.ID.value] = $cp
            }

            $rows = foreach ($cpId in $factionCPIds) {
                $cp = $cpById[$cpId]
                if (-not $cp) { continue }
                $nation = $nationStates | Where-Object { $_.ID.value -eq $cp.nation.value }
                if (-not $nation) { continue }

                # Latest historical Boost value for this nation (proxy for current Boost income)
                $latestBoost = $null
                if ($nation.historyBoost) {
                    if ($nation.historyBoost.Length -gt 0) {
                        $latestBoost = $nation.historyBoost[$nation.historyBoost.Length - 1]
                    }
                }
                # Per-CP Boost share: divide nation boost by its total CPs
                $boostPerCP = $null
                if ($latestBoost -ne $null -and $nation.numControlPoints_unclamped -gt 0) {
                    $boostPerCP = $latestBoost / $nation.numControlPoints_unclamped
                }

                [PSCustomObject]@{
                    NationID    = $nation.ID.value
                    NationName  = $nation.displayName
                    RegionCount = if ($nation.PSObject.Properties.Name -contains 'regionCount') { $nation.regionCount } else { $null }
                    GDP         = if ($nation.PSObject.Properties.Name -contains 'gdp') { $nation.gdp } else { $null }
                    Population  = if ($nation.PSObject.Properties.Name -contains 'population') { $nation.population } else { $null }
                    MilTech     = if ($nation.PSObject.Properties.Name -contains 'milTech') { $nation.milTech } else { $null }
                    Democracy   = if ($nation.PSObject.Properties.Name -contains 'democracy') { $nation.democracy } else { $null }
                    Cohesion    = if ($nation.PSObject.Properties.Name -contains 'cohesion') { $nation.cohesion } else { $null }
                    Unrest      = if ($nation.PSObject.Properties.Name -contains 'unrest') { $nation.unrest } else { $null }
                    Knowledge   = if ($nation.PSObject.Properties.Name -contains 'knowledge') { $nation.knowledge } else { $null }
                    Inequality  = if ($nation.PSObject.Properties.Name -contains 'inequality') { $nation.inequality } else { $null }
                    ClimatePolicy = if ($nation.PSObject.Properties.Name -contains 'climatePolicy') { $nation.climatePolicy } else { $null }
                    BoostHistoryLatest = $latestBoost
                    BoostPerCP         = $boostPerCP
                    CP_ID       = $cp.ID.value
                }
            }

            $rows | Export-Csv -Path $nationsOut -NoTypeInformation -Encoding UTF8

            # Councilors for this faction
            $councilorsOut = Join-Path $outputDir ("Again_{0}_Councilors.csv" -f $shortName)

            $councilorStates |
                Where-Object { $_.faction -and $_.faction.value -eq $fid } |
                Select-Object `
                    @{Name = 'ID'; Expression = { $_.ID.value }},
                    displayName,
                    templateName,
                    typeTemplateName,
                    @{Name = 'Persuasion'; Expression = { $_.attributes.Persuasion }},
                    @{Name = 'Investigation'; Expression = { $_.attributes.Investigation }},
                    @{Name = 'Espionage'; Expression = { $_.attributes.Espionage }},
                    @{Name = 'Command'; Expression = { $_.attributes.Command }},
                    @{Name = 'Administration'; Expression = { $_.attributes.Administration }},
                    @{Name = 'Science'; Expression = { $_.attributes.Science }},
                    @{Name = 'Security'; Expression = { $_.attributes.Security }},
                    @{Name = 'Loyalty'; Expression = { $_.attributes.Loyalty }},
                    @{Name = 'EffectivePersuasion'; Expression = {
                        $base  = [int]$_.attributes.Persuasion
                        $bonus = 0
                        if ($_.orgs) {
                            foreach ($orgRef in $_.orgs) {
                                $orgId = $orgRef.value
                                if ($orgId -and $orgById.ContainsKey($orgId)) {
                                    $o = $orgById[$orgId]
                                    if ($o.PSObject.Properties.Name -contains 'persuasion' -and $o.persuasion) {
                                        $bonus += [int]$o.persuasion
                                    }
                                }
                            }
                        }
                        $base + $bonus
                    }},
                    @{Name = 'EffectiveInvestigation'; Expression = {
                        $base  = [int]$_.attributes.Investigation
                        $bonus = 0
                        if ($_.orgs) {
                            foreach ($orgRef in $_.orgs) {
                                $orgId = $orgRef.value
                                if ($orgId -and $orgById.ContainsKey($orgId)) {
                                    $o = $orgById[$orgId]
                                    if ($o.PSObject.Properties.Name -contains 'investigation' -and $o.investigation) {
                                        $bonus += [int]$o.investigation
                                    }
                                }
                            }
                        }
                        $base + $bonus
                    }},
                    @{Name = 'EffectiveEspionage'; Expression = {
                        $base  = [int]$_.attributes.Espionage
                        $bonus = 0
                        if ($_.orgs) {
                            foreach ($orgRef in $_.orgs) {
                                $orgId = $orgRef.value
                                if ($orgId -and $orgById.ContainsKey($orgId)) {
                                    $o = $orgById[$orgId]
                                    if ($o.PSObject.Properties.Name -contains 'espionage' -and $o.espionage) {
                                        $bonus += [int]$o.espionage
                                    }
                                }
                            }
                        }
                        $base + $bonus
                    }},
                    @{Name = 'EffectiveCommand'; Expression = {
                        $base  = [int]$_.attributes.Command
                        $bonus = 0
                        if ($_.orgs) {
                            foreach ($orgRef in $_.orgs) {
                                $orgId = $orgRef.value
                                if ($orgId -and $orgById.ContainsKey($orgId)) {
                                    $o = $orgById[$orgId]
                                    if ($o.PSObject.Properties.Name -contains 'command' -and $o.command) {
                                        $bonus += [int]$o.command
                                    }
                                }
                            }
                        }
                        $base + $bonus
                    }},
                    @{Name = 'EffectiveAdministration'; Expression = {
                        $base  = [int]$_.attributes.Administration
                        $bonus = 0
                        if ($_.orgs) {
                            foreach ($orgRef in $_.orgs) {
                                $orgId = $orgRef.value
                                if ($orgId -and $orgById.ContainsKey($orgId)) {
                                    $o = $orgById[$orgId]
                                    if ($o.PSObject.Properties.Name -contains 'administration' -and $o.administration) {
                                        $bonus += [int]$o.administration
                                    }
                                }
                            }
                        }
                        $base + $bonus
                    }},
                    @{Name = 'EffectiveScience'; Expression = {
                        $base  = [int]$_.attributes.Science
                        $bonus = 0
                        if ($_.orgs) {
                            foreach ($orgRef in $_.orgs) {
                                $orgId = $orgRef.value
                                if ($orgId -and $orgById.ContainsKey($orgId)) {
                                    $o = $orgById[$orgId]
                                    if ($o.PSObject.Properties.Name -contains 'science' -and $o.science) {
                                        $bonus += [int]$o.science
                                    }
                                }
                            }
                        }
                        $base + $bonus
                    }},
                    @{Name = 'EffectiveSecurity'; Expression = {
                        $base  = [int]$_.attributes.Security
                        $bonus = 0
                        if ($_.orgs) {
                            foreach ($orgRef in $_.orgs) {
                                $orgId = $orgRef.value
                                if ($orgId -and $orgById.ContainsKey($orgId)) {
                                    $o = $orgById[$orgId]
                                    if ($o.PSObject.Properties.Name -contains 'security' -and $o.security) {
                                        $bonus += [int]$o.security
                                    }
                                }
                            }
                        }
                        $base + $bonus
                    }},
                    @{Name = 'EffectiveLoyalty'; Expression = {
                        $base  = [int]$_.attributes.Loyalty
                        $bonus = 0
                        if ($_.orgs) {
                            foreach ($orgRef in $_.orgs) {
                                $orgId = $orgRef.value
                                if ($orgId -and $orgById.ContainsKey($orgId)) {
                                    $o = $orgById[$orgId]
                                    if ($o.PSObject.Properties.Name -contains 'loyalty' -and $o.loyalty) {
                                        $bonus += [int]$o.loyalty
                                    }
                                }
                            }
                        }
                        $base + $bonus
                    }},
                    @{Name = 'OrgNames'; Expression = {
                        if (-not $_.orgs) { return "" }
                        $names = @()
                        foreach ($orgRef in $_.orgs) {
                            $orgId = $orgRef.value
                            if ($orgId -and $orgById.ContainsKey($orgId)) {
                                $o = $orgById[$orgId]
                                if ($o.displayName) { $names += $o.displayName }
                            }
                        }
                        $names -join ';'
                    }},
                    status,
                    homeRegion,
                    locationRegionName |
                Export-Csv -Path $councilorsOut -NoTypeInformation -Encoding UTF8
        }
    }

    # Emit metadata helper for prompts (game time + difficulty + export time)
    $metaOut = Join-Path $outputDir "Again_Metadata.csv"
    $exportedAtUtc = (Get-Date).ToUniversalTime().ToString("s") + "Z"
    [PSCustomObject]@{
        GameTimeString = $gameTimeString
        GameDateISO    = $gameTimeDateIso
        GameDateYYYYMMDD = $gameTimeDateYmd
        Difficulty     = $gameDifficulty
        ExportedAtUtc  = $exportedAtUtc
        SourceSave     = $SavePath
    } | Export-Csv -Path $metaOut -NoTypeInformation -Encoding UTF8

    if ($gameTimeString) {
        Write-Host ("gameTimeString: {0}" -f $gameTimeString)
    } else {
        Write-Host "gameTimeString: (not found)"
    }

    # --- Faction hate matrix (human factions only) ---
    $hateMatrixOut = Join-Path $outputDir "Again_Faction_HateMatrix.csv"
    $rowsMatrix = @()
    $headerObj = [ordered]@{ Faction = $null }
    foreach ($h in $humanFactionOrder) { $headerObj[$h] = $null }

    foreach ($srcName in $humanFactionOrder) {
        $row = [ordered]@{ Faction = $srcName }
        foreach ($tgtName in $humanFactionOrder) {
            $row[$tgtName] = ""
        }

        $src = $humanFactions | Where-Object { $_.displayName -eq $srcName }
        if ($src -and $src.factionHate) {
            foreach ($fh in $src.factionHate) {
                $tgtId = $fh.Key.value
                $val = [double]$fh.Value
                if ($factionNameById.ContainsKey($tgtId)) {
                    $tgtName = $factionNameById[$tgtId]
                    if ($row.Contains($tgtName)) {
                        $row[$tgtName] = [Math]::Round($val, 3)
                    }
                }
            }
        }

        $rowsMatrix += [PSCustomObject]$row
    }

    $rowsMatrix | Export-Csv -Path $hateMatrixOut -NoTypeInformation -Encoding UTF8
}
finally {
    if (Test-Path $tempJson) {
        Remove-Item $tempJson -ErrorAction SilentlyContinue
    }
}
