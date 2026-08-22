# Ship Component Data Extraction

## Overview

This directory contains ship component reference data for Terra Invicta. The data is extracted from the game's JSON files and processed to show only components unlocked by the player's research.

## Files

### Generated Data
- **`../csv/Again_Unlocked_Ship_Components.csv`** - Auto-generated CSV containing all unlocked ship components for the current campaign
  - Regenerate by running: `pwsh ../Get-UnlockedShipComponents.ps1`
  - Contains: Category, FriendlyName, DataName, RequiredProject, Stats, Cost

### Source Data
- **`raw_json/`** - Game data templates extracted from Terra Invicta
  - `TIDriveTemplate.json` - Ship drives
  - `TIPowerPlantTemplate.json` - Power plants/reactors
  - `TIRadiatorTemplate.json` - Radiators
  - `TIBatteryTemplate.json` - Batteries
  - `TIHeatSinkTemplate.json` - Heat sinks
  - `TIShipArmorTemplate.json` - Armor materials
  - `TIShipHullTemplate.json` - Ship hulls
  - `TIUtilityModuleTemplate.json` - Utility modules
  - `TIGunTemplate.json` - Kinetic guns
  - `TIMagneticGunTemplate.json` - Coilguns/railguns
  - `TILaserWeaponTemplate.json` - Laser weapons
  - `TIParticleWeaponTemplate.json` - Particle weapons
  - `TIPlasmaWeaponTemplate.json` - Plasma weapons
  - `TIMissileTemplate.json` - Missiles and torpedoes

### Reference Guides
- **`ship_design_guide.md`** - Comprehensive guide to ship design mechanics, formulas, and AI instructions
- **`ship_components_tables.md`** - Human-readable tables of ship components (verbose, may be condensed)
- **`utility_modules.md`** - Detailed reference for all utility modules (ECM, marines, drive enhancers, ISRU, kits, etc.)
- **`math.md`** - Ship performance formulas and calculations
- **`current_meta.md`** - Community meta heuristics and best practices

## Usage

### Regenerate Unlocked Components

Run this command from the repository root:

```powershell
pwsh ./Get-UnlockedShipComponents.ps1
```

The script will:
1. Read your faction's completed research from `csv/Again_Resistance_Projects.csv`
2. Parse all component JSON files in `Ship_Info/raw_json/`
3. Filter components based on research requirements
4. Export to `csv/Again_Unlocked_Ship_Components.csv`

### CSV Format

Each row contains:
- **Category**: Component type (Drive, PowerPlant, Radiator, Battery, HeatSink, Armor, Hull, Weapon_*, Utility)
- **FriendlyName**: Display name
- **DataName**: Internal identifier
- **RequiredProject**: Research project name (empty if no research required)
- **Stats**: Key-value pairs formatted as `Key:Value Key:Value`
- **Cost**: Resource costs formatted as `Resource:Amount Resource:Amount`

### Example Stats by Category

- **Drive**: `Mass_t EV_kps Thrust_N Efficiency ThrustCap **ReqPowerPlant** DriveClass Propellant`
  - NOTE: `ReqPowerPlant` is CRITICAL for drive/reactor compatibility - see ship_design_guide.md §3.2
- **PowerPlant**: `Output_GW PowerPlantClass`
- **Battery**: `Capacity_GJ`
- **HeatSink**: `Capacity_GJ`
- **Weapon_Laser**: `Dmg Range Wavelength`
- **Weapon_Missile**: `Dmg Range Accel DV`

## Notes

- Magnetic weapons (coilguns/railguns) do not have a direct `Dmg` value in the JSON - damage is calculated from `muzzleVelocity_kps` and `warheadMass_kg`
- The CSV is optimized for AI consumption to save context tokens compared to reading verbose markdown tables
- Update this file after completing research to see newly unlocked components
