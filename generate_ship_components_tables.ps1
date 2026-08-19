param(
    [string]$RootPath = $null
)

# Load configuration
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $scriptPath "config.json"
if (-not (Test-Path $configPath)) {
    throw "Config file not found at $configPath"
}
$config = Get-Content $configPath -Raw | ConvertFrom-Json

if ([string]::IsNullOrEmpty($RootPath)) {
    $RootPath = $config.WorkDir
    if ($RootPath -eq ".") { $RootPath = $scriptPath }
}

$shipInfoDir = $config.ShipInfoSubDir

$rawPath = Join-Path $RootPath "$shipInfoDir/raw_json"
$outPath = Join-Path $RootPath "$shipInfoDir/ship_components_tables.md"

function Get-TIJson {
    param(
        [string]$Name
    )
    $path = Join-Path $rawPath $Name
    if (-not (Test-Path $path)) {
        Write-Error "Missing JSON file: $path"
        return @()
    }
    (Get-Content $path -Raw | ConvertFrom-Json)
}

function New-MarkdownTable {
    param(
        [string]$Title,
        [object[]]$Rows,
        [string[]]$Columns,
        [hashtable]$HeaderMap
    )

    if (-not $Rows -or $Rows.Count -eq 0) { return @() }

    $lines = @()
    $lines += "## $Title"
    $lines += ""

    $headers = @("Component","Template ID")
    foreach ($c in $Columns) {
        if ($c -in @("friendlyName","dataName")) { continue }
        $headers += ($HeaderMap[$c] | ForEach-Object { if ($_){$_} else {$c} })
    }
    $lines += "| " + ($headers -join " | ") + " |"
    $lines += "|" + ("---|" * $headers.Count)

    foreach ($row in $Rows) {
        $vals = @()
        $comp = $row.friendlyName
        if (-not $comp) { $comp = $row.displayName }
        if (-not $comp) { $comp = $row.dataName }
        $vals += [string]$comp
        $vals += [string]$row.dataName

        foreach ($c in $Columns) {
            if ($c -in @("friendlyName","dataName","displayName")) { continue }
            $v = $row.$c
            if ($null -eq $v) { $vals += "" ; continue }
            if ($v -is [double] -or $v -is [float]) {
                $vals += ("{0:g}" -f $v)
            } else {
                $vals += [string]$v
            }
        }

        $lines += "| " + ($vals -join " | ") + " |"
    }

    $lines += ""
    return $lines
}

$out = @()
$out += "# Terra Invicta Ship Components"
$out += ""
$out += "Source: `Ship_Info/raw_json/*.json` from the Again campaign export."
$out += "Each section summarizes one template file. Mass values are in tons where applicable."
$out += ""
$out += "---"
$out += ""

# Batteries
$bats = Get-TIJson "TIBatteryTemplate.json"
$batColumns = @(
    "friendlyName","dataName","requiredProjectName",
    "mass_tons","crew","hp",
    "energyCapacity_GJ","rechargeRate_GJs"
)
$batHeaders = @{
    friendlyName      = "Component"
    dataName          = "Template ID"
    requiredProjectName = "Required Project"
    mass_tons         = "Mass (t)"
    crew              = "Crew"
    hp                = "HP"
    energyCapacity_GJ = "Energy (GJ)"
    rechargeRate_GJs  = "Recharge (GJ/s)"
}
$out += New-MarkdownTable -Title "Batteries" -Rows $bats -Columns $batColumns -HeaderMap $batHeaders

# Drives
$drives = Get-TIJson "TIDriveTemplate.json"
$driveColumns = @(
    "friendlyName","dataName","requiredProjectName",
    "driveClassification","thrusters","flatMass_tons",
    "thrust_N","EV_kps","specificPower_kgMW","efficiency",
    "thrustRating_GW","req power","propellant"
)
$driveHeaders = @{
    friendlyName        = "Component"
    dataName            = "Template ID"
    requiredProjectName = "Required Project"
    driveClassification = "Class"
    thrusters           = "Thrusters"
    flatMass_tons       = "Mass (t)"
    thrust_N            = "Thrust (N)"
    EV_kps              = "Exhaust Vel. (km/s)"
    specificPower_kgMW  = "kg/MW"
    efficiency          = "Eff."
    thrustRating_GW     = "Thrust Rating (GW)"
    "req power"         = "Req. Power (GW)"
    propellant          = "Propellant"
}
$out += New-MarkdownTable -Title "Drives" -Rows $drives -Columns $driveColumns -HeaderMap $driveHeaders

# Kinetic guns
$guns = Get-TIJson "TIGunTemplate.json"
$gunColumns = @(
    "friendlyName","dataName","requiredProjectName",
    "mount","crew",
    "baseWeaponMass_tons","cooldown_s","salvo_shots","magazine",
    "ammoMass_kg","muzzleVelocity_kps","warheadMass_kg",
    "bombardmentValue","targetingRange_km","pivotRange_deg",
    "isPointDefenseTargetable","damage_MJ"
)
$gunHeaders = @{
    friendlyName           = "Component"
    dataName               = "Template ID"
    requiredProjectName    = "Required Project"
    mount                  = "Mount"
    crew                   = "Crew"
    baseWeaponMass_tons    = "Weapon Mass (t)"
    cooldown_s             = "Cooldown (s)"
    salvo_shots            = "Salvo Shots"
    magazine               = "Magazine"
    ammoMass_kg            = "Ammo Mass (kg)"
    muzzleVelocity_kps     = "Muzzle Vel. (km/s)"
    warheadMass_kg         = "Warhead (kg)"
    bombardmentValue       = "Bombard"
    targetingRange_km      = "Range (km)"
    pivotRange_deg         = "Pivot (deg)"
    isPointDefenseTargetable = "PD Target?"
    damage_MJ              = "Damage (MJ)"
}
$out += New-MarkdownTable -Title "Kinetic Guns" -Rows $guns -Columns $gunColumns -HeaderMap $gunHeaders

# Heat Sinks
$sinks = Get-TIJson "TIHeatSinkTemplate.json"
$sinkColumns = @(
    "friendlyName","displayName","dataName","requiredProjectName",
    "mass_tons","crew","heatCapacity_GJ"
)
$sinkHeaders = @{
    friendlyName      = "Component"
    displayName       = "Display Name"
    dataName          = "Template ID"
    requiredProjectName = "Required Project"
    mass_tons         = "Mass (t)"
    crew              = "Crew"
    heatCapacity_GJ   = "Heat Cap. (GJ)"
}
$out += New-MarkdownTable -Title "Heat Sinks" -Rows $sinks -Columns $sinkColumns -HeaderMap $sinkHeaders

# Lasers
$lasers = Get-TIJson "TILaserWeaponTemplate.json"
$laserColumns = @(
    "friendlyName","dataName","requiredProjectName",
    "mount","crew",
    "baseWeaponMass_tons","cooldown_s","efficiency",
    "shotPower_MJ","wavelength_nm","mirrorRadius_cm",
    "bombardmentValue","targetingRange_km","pivotRange_deg",
    "isPointDefenseTargetable"
)
$laserHeaders = @{
    friendlyName        = "Component"
    dataName            = "Template ID"
    requiredProjectName = "Required Project"
    mount               = "Mount"
    crew                = "Crew"
    baseWeaponMass_tons = "Weapon Mass (t)"
    cooldown_s          = "Cooldown (s)"
    efficiency          = "Eff."
    shotPower_MJ        = "Shot Power (MJ)"
    wavelength_nm       = "λ (nm)"
    mirrorRadius_cm     = "Mirror (cm)"
    bombardmentValue    = "Bombard"
    targetingRange_km   = "Range (km)"
    pivotRange_deg      = "Pivot (deg)"
    isPointDefenseTargetable = "PD Target?"
}
$out += New-MarkdownTable -Title "Laser Weapons" -Rows $lasers -Columns $laserColumns -HeaderMap $laserHeaders

# Magnetic guns (railguns / coilguns)
$magGuns = Get-TIJson "TIMagneticGunTemplate.json"
$magColumns = @(
    "friendlyName","dataName","requiredProjectName",
    "mount","crew",
    "baseWeaponMass_tons","cooldown_s","efficiency",
    "magazine","ammoMass_kg","muzzleVelocity_kps","warheadMass_kg",
    "bombardmentValue","targetingRange_km","pivotRange_deg",
    "isPointDefenseTargetable"
)
$magHeaders = @{
    friendlyName        = "Component"
    dataName            = "Template ID"
    requiredProjectName = "Required Project"
    mount               = "Mount"
    crew                = "Crew"
    baseWeaponMass_tons = "Weapon Mass (t)"
    cooldown_s          = "Cooldown (s)"
    efficiency          = "Eff."
    magazine            = "Magazine"
    ammoMass_kg         = "Ammo Mass (kg)"
    muzzleVelocity_kps  = "Muzzle Vel. (km/s)"
    warheadMass_kg      = "Projectile (kg)"
    bombardmentValue    = "Bombard"
    targetingRange_km   = "Range (km)"
    pivotRange_deg      = "Pivot (deg)"
    isPointDefenseTargetable = "PD Target?"
}
$out += New-MarkdownTable -Title "Magnetic Guns" -Rows $magGuns -Columns $magColumns -HeaderMap $magHeaders

# Missiles
$missiles = Get-TIJson "TIMissileTemplate.json"
$missileColumns = @(
    "friendlyName","dataName","requiredProjectName",
    "mount","crew","warheadClass",
    "baseWeaponMass_tons","salvo_shots","magazine",
    "Rocket Thrust","EV_kps","acceleration_g","deltaV_kps",
    "ammoMass_kg","fuelMass_kg","systemMass_kg","warheadMass_kg",
    "flatDamage_MJ",
    "targetingRange_km","pivotRange_deg","isPointDefenseTargetable"
)
$missileHeaders = @{
    friendlyName        = "Component"
    dataName            = "Template ID"
    requiredProjectName = "Required Project"
    mount               = "Mount"
    crew                = "Crew"
    warheadClass        = "Warhead"
    baseWeaponMass_tons = "Weapon Mass (t)"
    salvo_shots         = "Salvo"
    magazine            = "Magazine"
    "Rocket Thrust"     = "Rocket Thrust"
    EV_kps              = "Exhaust Vel. (km/s)"
    acceleration_g      = "Accel (g)"
    deltaV_kps          = "Δv (km/s)"
    ammoMass_kg         = "Missile Mass (kg)"
    fuelMass_kg         = "Fuel (kg)"
    systemMass_kg       = "System (kg)"
    warheadMass_kg      = "Warhead (kg)"
    flatDamage_MJ       = "Damage (MJ)"
    targetingRange_km   = "Range (km)"
    pivotRange_deg      = "Pivot (deg)"
    isPointDefenseTargetable = "PD Target?"
}
$out += New-MarkdownTable -Title "Missile Bays" -Rows $missiles -Columns $missileColumns -HeaderMap $missileHeaders

# Power plants
$plants = Get-TIJson "TIPowerPlantTemplate.json"
$plantColumns = @(
    "friendlyName","dataName","requiredProjectName",
    "powerPlantClass","maxOutput_GW","specificPower_tGW",
    "efficiency","crew"
)
$plantHeaders = @{
    friendlyName        = "Component"
    dataName            = "Template ID"
    requiredProjectName = "Required Project"
    powerPlantClass     = "Class"
    maxOutput_GW        = "Output (GW)"
    specificPower_tGW   = "t/GW"
    efficiency          = "Eff."
    crew                = "Crew"
}
$out += New-MarkdownTable -Title "Power Plants" -Rows $plants -Columns $plantColumns -HeaderMap $plantHeaders

# Radiators
$rads = Get-TIJson "TIRadiatorTemplate.json"

# Derive tons of radiator required per GW of dissipation.
# specificPower_2s_KWkg = kW radiated per kg at nominal conditions,
# so tons per GW ≈ 1_000_000 kW / (specificPower_2s_KWkg * 1000 kg/t) = 1000 / specificPower_2s_KWkg.
foreach ($r in $rads) {
    if ($r.specificPower_2s_KWkg -and $r.specificPower_2s_KWkg -ne 0) {
        $massPerGw = 1000.0 / [double]$r.specificPower_2s_KWkg
        $r | Add-Member -NotePropertyName 'massPerGW_tons' -NotePropertyValue ([math]::Round($massPerGw, 2)) -Force
    }
}

$radColumns = @(
    "friendlyName","dataName","requiredProjectName",
    "massPerGW_tons","crew","emissivity",
    "specificPower_2s_KWkg","operatingTemp_K",
    "radiatorType","collector"
)
$radHeaders = @{
    friendlyName          = "Component"
    dataName              = "Template ID"
    requiredProjectName   = "Required Project"
    massPerGW_tons        = "Mass (t/GW)"
    crew                  = "Crew"
    emissivity            = "Emissivity"
    specificPower_2s_KWkg = "kW/kg"
    operatingTemp_K       = "Temp (K)"
    radiatorType          = "Type"
    collector             = "Collector"
}
$out += New-MarkdownTable -Title "Radiators" -Rows $rads -Columns $radColumns -HeaderMap $radHeaders

# Armor materials
$armors = Get-TIJson "TIShipArmorTemplate.json"
$armorColumns = @(
    "friendlyName","dataName",
    "xRayHalfValue_cm","baryonicHalfValue_cm",
    "density_kgm3","heatofVaporization_MJkg"
)
$armorHeaders = @{
    friendlyName           = "Armor"
    dataName               = "Template ID"
    xRayHalfValue_cm       = "X-Ray 1/2 (cm)"
    baryonicHalfValue_cm   = "Baryonic 1/2 (cm)"
    density_kgm3           = "Density (kg/m³)"
    heatofVaporization_MJkg = "Heat of Vap. (MJ/kg)"
}
$out += New-MarkdownTable -Title "Armor Materials" -Rows $armors -Columns $armorColumns -HeaderMap $armorHeaders

# Hulls
$hulls = Get-TIJson "TIShipHullTemplate.json"
$hullColumns = @(
    "friendlyName","dataName","requiredProjectName",
    "consTier","maxOfficers","crew",
    "mass_tons","length_m","width_m",
    "noseHardpoints","hullHardpoints","internalModules",
    "missionControl","baseConstructionTime_days"
)
$hullHeaders = @{
    friendlyName            = "Hull"
    dataName                = "Template ID"
    requiredProjectName     = "Required Project"
    consTier                = "Tier"
    maxOfficers             = "Max Officers"
    crew                    = "Crew"
    mass_tons               = "Mass (t)"
    length_m                = "Length (m)"
    width_m                 = "Width (m)"
    noseHardpoints          = "Nose HP"
    hullHardpoints          = "Hull HP"
    internalModules         = "Modules"
    missionControl          = "MC"
    baseConstructionTime_days = "Build Time (days)"
}
$out += New-MarkdownTable -Title "Hulls" -Rows $hulls -Columns $hullColumns -HeaderMap $hullHeaders

# Utility modules
$utils = Get-TIJson "TIUtilityModuleTemplate.json"
$utilColumns = @(
    "friendlyName","dataName","requiredProjectName",
    "mass_tons","crew","grouping","minConsTier","powerRequirement_MW"
)
$utilHeaders = @{
    friendlyName        = "Utility Module"
    dataName            = "Template ID"
    requiredProjectName = "Required Project"
    mass_tons           = "Mass (t)"
    crew                = "Crew"
    grouping            = "Group"
    minConsTier         = "Min Tier"
    powerRequirement_MW = "Power Req. (MW)"
}
$out += New-MarkdownTable -Title "Utility Modules" -Rows $utils -Columns $utilColumns -HeaderMap $utilHeaders

# Particle Weapons
$particles = Get-TIJson "TIParticleWeaponTemplate.json"
$particleColumns = @(
    "friendlyName","dataName","requiredProjectName",
    "mount","crew",
    "baseWeaponMass_tons","cooldown_s","efficiency",
    "shotPower_MJ","targetingRange_km","pivotRange_deg",
    "isPointDefenseTargetable"
)
$particleHeaders = @{
    friendlyName        = "Component"
    dataName            = "Template ID"
    requiredProjectName = "Required Project"
    mount               = "Mount"
    crew                = "Crew"
    baseWeaponMass_tons = "Weapon Mass (t)"
    cooldown_s          = "Cooldown (s)"
    efficiency          = "Eff."
    shotPower_MJ        = "Shot Power (MJ)"
    targetingRange_km   = "Range (km)"
    pivotRange_deg      = "Pivot (deg)"
    isPointDefenseTargetable = "PD Target?"
}
$out += New-MarkdownTable -Title "Particle Weapons" -Rows $particles -Columns $particleColumns -HeaderMap $particleHeaders

# Plasma Weapons
$plasmas = Get-TIJson "TIPlasmaWeaponTemplate.json"
$plasmaColumns = @(
    "friendlyName","dataName","requiredProjectName",
    "mount","crew",
    "baseWeaponMass_tons","cooldown_s","efficiency",
    "damage_MJ","targetingRange_km","pivotRange_deg",
    "muzzleVelocity_kps",
    "isPointDefenseTargetable"
)
$plasmaHeaders = @{
    friendlyName        = "Component"
    dataName            = "Template ID"
    requiredProjectName = "Required Project"
    mount               = "Mount"
    crew                = "Crew"
    baseWeaponMass_tons = "Weapon Mass (t)"
    cooldown_s          = "Cooldown (s)"
    efficiency          = "Eff."
    damage_MJ           = "Damage (MJ)"
    targetingRange_km   = "Range (km)"
    pivotRange_deg      = "Pivot (deg)"
    muzzleVelocity_kps  = "Muzzle Vel. (km/s)"
    isPointDefenseTargetable = "PD Target?"
}
$out += New-MarkdownTable -Title "Plasma Weapons" -Rows $plasmas -Columns $plasmaColumns -HeaderMap $plasmaHeaders

# Propellant Tanks
$out += "## Propellant Tanks"
$out += ""
$out += "Note: Raw JSON template for propellant tanks is not available. The user has confirmed that all tanks are effectively identical in capacity."
$out += ""
$out += "| Component | Propellant Capacity | Tank Mass | Notes |"
$out += "|---|---|---|---|"
$out += "| Standard Propellant Tank | 100 tons | 0 tons | Universal standard size (structural mass negligible/included in hull) |"
$out += ""

$out | Set-Content -Path $outPath -Encoding UTF8
Write-Host "Wrote $outPath"
