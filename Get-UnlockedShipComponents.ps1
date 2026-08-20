param(
    [string]$ProjectsCsvPath = $null,
    [string]$JsonDir = $null,
    [string]$OutputPath = $null
)

$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Import-Module (Join-Path $scriptPath 'TerraInvicta.Common.psm1') -Force
$config = Get-TIConfig -BasePath $scriptPath
$workDir = if ([IO.Path]::IsPathRooted($config.paths.workDir)) {
    $config.paths.workDir
} else {
    Join-Path $scriptPath $config.paths.workDir
}
$ProjectsCsvPath = if ($ProjectsCsvPath) { $ProjectsCsvPath } else {
    Join-Path $workDir (Join-Path $config.paths.csvSubDir 'Again_Resistance_Projects.csv')
}
$JsonDir = if ($JsonDir) { $JsonDir } else {
    Join-Path $workDir (Join-Path $config.paths.shipInfoSubDir 'raw_json')
}
$OutputPath = if ($OutputPath) { $OutputPath } else {
    Join-Path $workDir (Join-Path $config.paths.csvSubDir 'Again_Unlocked_Ship_Components.csv')
}

Write-Host "Reading projects from $ProjectsCsvPath..."
$completedProjects = @{}
if (Test-Path $ProjectsCsvPath) {
    Import-Csv $ProjectsCsvPath | ForEach-Object {
        if ($_.Status -eq "FactionFinished" -or $_.Status -eq "GlobalFinished") {
            $completedProjects[$_.TechTemplateName] = $true
        }
    }
} else {
    Write-Warning "Projects CSV not found at $ProjectsCsvPath. Assuming no projects unlocked."
}

$fileMappings = @{
    "TIDriveTemplate.json" = "Drive"
    "TIPowerPlantTemplate.json" = "PowerPlant"
    "TIRadiatorTemplate.json" = "Radiator"
    "TIBatteryTemplate.json" = "Battery"
    "TIHeatSinkTemplate.json" = "HeatSink"
    "TIShipArmorTemplate.json" = "Armor"
    "TIShipHullTemplate.json" = "Hull"
    "TIUtilityModuleTemplate.json" = "Utility"
    "TIGunTemplate.json" = "Weapon_Gun"
    "TIMagneticGunTemplate.json" = "Weapon_Coilgun"
    "TILaserWeaponTemplate.json" = "Weapon_Laser"
    "TIParticleWeaponTemplate.json" = "Weapon_Particle"
    "TIPlasmaWeaponTemplate.json" = "Weapon_Plasma"
    "TIMissileTemplate.json" = "Weapon_Missile"
}

$results = @()

Write-Host "Processing JSON files in $JsonDir..."

foreach ($file in $fileMappings.Keys) {
    $category = $fileMappings[$file]
    $jsonPath = Join-Path $JsonDir $file
    
    if (Test-Path $jsonPath) {
        try {
            $content = Get-Content $jsonPath -Raw
            $data = $content | ConvertFrom-Json
            
            foreach ($item in $data) {
                $reqProject = $item.requiredProjectName
                
                # Check if unlocked: No project required OR project is completed
                $isUnlocked = [string]::IsNullOrWhiteSpace($reqProject) -or $completedProjects.ContainsKey($reqProject)
                
                if ($isUnlocked) {
                    $stats = @{}
                    
                    # Common Stats
                    if ($item.mass_tons) { $stats["Mass_t"] = $item.mass_tons }
                    elseif ($item.mass) { $stats["Mass_t"] = $item.mass }
                    
                    # Category Specific Stats
                    switch ($category) {
                        "Drive" {
                            $stats["Mass_t"] = $item.flatMass_tons
                            $stats["Thrust_N"] = $item.thrust_N
                            $stats["EV_kps"] = $item.EV_kps
                            $stats["Efficiency"] = $item.efficiency
                            $stats["ThrustCap"] = $item.thrustCap
                            $stats["ReqPowerPlant"] = $item.requiredPowerPlant
                            $stats["DriveClass"] = $item.driveClassification
                            $stats["Propellant"] = $item.propellant
                        }
                        "PowerPlant" {
                            $stats["Output_GW"] = $item.maxOutput_GW
                            $stats["PowerPlantClass"] = $item.powerPlantClass
                        }
                        "Radiator" {
                            $stats["WasteHeatCap_MW"] = $item.wasteHeatCapacity_MW
                            $stats["MassPerGW"] = $item.specificPower_2s_KWkg
                        }
                        "Battery" {
                            $stats["Capacity_GJ"] = $item.energyCapacity_GJ
                        }
                        "HeatSink" {
                            $stats["Capacity_GJ"] = $item.heatCapacity_GJ
                        }
                        "Armor" {
                            $stats["Density"] = $item.density
                            $stats["HeatResist"] = $item.heatOfVaporization
                        }
                        "Hull" {
                            $stats["Nose"] = $item.noseHardpoints
                            $stats["Hull"] = $item.hullHardpoints
                            $stats["Utility"] = $item.utilitySlots
                            $stats["MC"] = $item.missionControlCost
                        }
                        "Weapon_Gun" {
                            $stats["Dmg"] = $item.damage_MJ
                            $stats["Range"] = $item.targetingRange_km
                            $stats["Cooldown"] = $item.cooldown_s
                        }
                        "Weapon_Coilgun" {
                            $stats["Dmg"] = $item.damage_MJ
                            $stats["Range"] = $item.targetingRange_km
                            $stats["Cooldown"] = $item.cooldown_s
                            $stats["MuzzleVel"] = $item.muzzleVelocity_kps
                        }
                        "Weapon_Laser" {
                            $stats["Dmg"] = $item.shotPower_MJ
                            $stats["Range"] = $item.targetingRange_km
                            $stats["Wavelength"] = $item.wavelength_nm
                        }
                        "Weapon_Particle" {
                            $stats["Dmg"] = $item.shotPower_MJ
                            $stats["Range"] = $item.targetingRange_km
                        }
                        "Weapon_Plasma" {
                            $stats["Dmg"] = $item.damage_MJ
                            $stats["Range"] = $item.targetingRange_km
                        }
                        "Weapon_Missile" {
                            $stats["Dmg"] = $item.flatDamage_MJ
                            $stats["Range"] = $item.targetingRange_km
                            $stats["Accel"] = $item.acceleration_g
                            $stats["DV"] = $item.deltaV_kps
                        }
                    }
                    
                    # Format Stats as Key:Value string
                    $statsStr = ($stats.Keys | ForEach-Object { "{0}:{1}" -f $_, $stats[$_] }) -join " "
                    
                    # Cost Formatting
                    $costStr = ""
                    if ($item.resources) {
                         $costStr = ($item.resources.PSObject.Properties | ForEach-Object { "$($_.Name):$($_.Value)" }) -join " "
                    }

                    # Friendly Name Fallback
                    $fName = $item.friendlyName
                    if ([string]::IsNullOrWhiteSpace($fName)) { $fName = $item.displayName }

                    $results += [PSCustomObject]@{
                        Category = $category
                        FriendlyName = $fName
                        DataName = $item.dataName
                        RequiredProject = $reqProject
                        Stats = $statsStr
                        Cost = $costStr
                    }
                }
            }
        }
        catch {
            Write-Error "Error processing $file : $_"
        }
    } else {
        Write-Warning "File not found: $jsonPath"
    }
}

Write-Host "Found $($results.Count) unlocked components."
Write-Host "Exporting to $OutputPath..."

$results | Export-Csv -Path $OutputPath -NoTypeInformation
Write-Host "Done."
