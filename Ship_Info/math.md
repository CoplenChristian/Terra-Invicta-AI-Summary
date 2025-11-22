# 🚀 **terra_invicta_ship_math.md**

# **Terra Invicta – Shipbuilding Math Specification**

This document defines the **complete mathematical rules** required to calculate:

* **Dry Mass**
* **Wet Mass**
* **Acceleration (Cruise & Combat)**
* **Drive Thrust Budget**
* **Delta-V (Cruise)**
* **Propellant Consumption**
* **Efficiency Effects**
* **Turn Rate (relative scaling)**
* **Thermal & Power considerations (only the relevant math)**

This file excludes construction time and economic cost per your request.

---

## Table of Contents

- [§1 Mass Model](#1-mass-model)
  - [§1.1 Dry Mass Formula](#11-dry-mass-formula)
  - [§1.2 Armor Mass](#12-armor-mass)
  - [§1.3 Fuel Mass](#13-fuel-mass)
- [§2 Acceleration](#2-acceleration)
  - [§2.1 Base Acceleration Formula](#21-base-acceleration-formula)
  - [§2.2 Convert to g-forces](#22-convert-acceleration-to-g-forces)
  - [§2.3 Cruise vs Combat](#23-cruise-vs-combat-acceleration)
  - [§2.4 Efficiency Effects](#24-efficiency-effects)
- [§3 Power Plant Interaction](#3-power-plant-interaction)
- [§4 Delta-V Calculation](#4-delta-v-calculation)
  - [§4.1 Convert Exhaust Velocity → Isp](#41-convert-drive-exhaust-velocity--isp)
  - [§4.2 Delta-V Formula](#42-delta-v-formula)
  - [§4.3 Efficiency Modifiers](#43-efficiency-modifiers)
  - [§4.4 Multi-Drive Delta-V](#44-multi-drive-delta-v)
- [§5 Heat Sinks & Radiators](#5-heat-sinks--radiators-relevant-math-only)
  - [§5.1 Heat Generation](#51-heat-generation)
  - [§5.2 Heat Sink Capacity](#52-heat-sink-capacity)
  - [§5.3 Radiator Sizing](#53-radiator-sizing)
- [§5A Weapon Damage & Power](#5a-weapon-damage--power-formulas)
  - [§5A.1 Naval Guns & Magnetic Weapons](#5a1-naval-guns--magnetic-weapons-kinetic)
  - [§5A.2 Lasers](#5a2-lasers)
  - [§5A.3 Particle Weapons](#5a3-particle-weapons)
  - [§5A.4 Plasma Weapons](#5a4-plasma-weapons)
  - [§5A.5 Missiles](#5a5-missiles)
- [§6 Batteries](#6-batteries-simplified-math)
- [§7 Turn Rate Scaling](#7-turn-rate-scaling)
- [§8 Strategic Implications](#8-strategic-implications)
- [§9 Summary of Required Inputs](#9-summary-of-required-inputs-for-an-agent)

---

# -----------------------------------------

# 🧱 **1. Mass Model**

# -----------------------------------------

A ship has three mass states:

1. **Dry Mass** — total mass without fuel
2. **Fuel Mass** — mass of all propellant (tanks × capacity)
3. **Wet Mass** = Dry Mass + Fuel Mass

---

## **1.1 Dry Mass Formula**

```text
DryMass =
    Sum(ComponentMass)
  + ArmorMass
  + (Crew × 4 tons)
```

Where:

* **ComponentMass** = mass of each installed module (weapons, drives, reactors, radiators, utilities, batteries, fixed hull mass, etc.)
* **ArmorMass** = sum of all armor facings
* **Crew × 4** = TI’s rule: each crew adds 4 tons

The game *always* displays Wet Mass, but internally performs calculations on both.

---

Perfect — thank you for the correction.
Terra Invicta’s actual armor system **only has three facings**:

* **Nose (Front)**
* **Sides (Port + Starboard combined)**
* **Tail (Rear)**

There is **no split left/right** in the gameplay model.
I’ll update the armor section accordingly so the math.md file is *canonically correct to TI*.

Terra Invicta uses **three armor facings**, not four:

- `Nose` (front)
- `Sides`
- `Tail` (rear)

Armor mass is fully determined by **material properties**, **hull geometry**, and **armor points** on each facing. You must use the official formula below and **must not** use the ambiguous `Armor (T)/point` values from the hull table.

Let the material properties be:

- `HeatOfVaporization_MJkg` — heat of vaporization in MJ/kg
- `Density_kgm3` — material density in kg/m³

Let the hull geometry be:

- `HullWidth_m`  — characteristic width of the hull (meters)
- `HullLength_m` — characteristic length of the hull (meters)

Let the armor points be:

- `NosePoints`
- `SidePoints`
- `TailPoints`

### 1.2.1 Plate Thickness (m)

First compute the **per‑point plate thickness** in meters:

```text
PlateThickness_m = 20 / HeatOfVaporization_MJkg / Density_kgm3 / 0.005
```

### 1.2.2 Facing Thicknesses (m)

Then compute thickness for each facing:

```text
NoseThickness_m = PlateThickness_m * NosePoints
TailThickness_m = PlateThickness_m * TailPoints
SideThickness_m = PlateThickness_m * SidePoints
```

### 1.2.3 Armor Volumes (m³)

Using the approximate cylindrical hull geometry:

```text
NoseVolume_m3 =
    NoseThickness_m * π * (HullWidth_m/2 + SideThickness_m)^2

TailVolume_m3 =
    TailThickness_m * π * (HullWidth_m/2 + SideThickness_m)^2

SideVolume_m3 =
    π * HullLength_m *
    [ (HullWidth_m/2 + SideThickness_m)^2 - (HullWidth_m/2)^2 ]
```

### 1.2.4 Armor Mass (kg and tons)

Total armor volume and mass are then:

```text
ArmorVolume_m3 = NoseVolume_m3 + TailVolume_m3 + SideVolume_m3

ArmorMass_kg   = ArmorVolume_m3 * Density_kgm3
ArmorMass_tons = ArmorMass_kg / 1000
```

You must treat this as the **canonical** armor mass calculation. Do **not** use `Armor (T)/point` values from hull tables, and do not assume a fixed tons‑per‑point shortcut.

---

## **1.3 Fuel Mass**

Each propellant tank has:

* **TankMass** (empty tank)
* **PropellantMassCapacity**

Thus:

```
FuelMass = Sum(PropellantMassCapacity for all tanks)
```

Each ship must have one or more 100-ton propellant tanks (there is no variable weight for propellant).

---

# -----------------------------------------

# 🚀 **2. Acceleration**

# -----------------------------------------

Acceleration is determined by:

1. Total **thrust** available from drives
2. Total **Wet Mass**
3. Whether in **Cruise** or **Combat** mode
4. **Drive efficiency** modifiers

---

## **2.1 Base Acceleration Formula**

The universal Newtonian thrust-to-mass calculation:

```
acceleration = totalThrust / WetMass
```

Where:

* `totalThrust` is the sum of all installed drive thrusters
* `WetMass` includes full fuel load

---

## **2.2 Convert Acceleration to g-forces**

1 g = 9.80665 m/s²
TI uses “g” as a convenience unit.

```
accel_g = acceleration / 9.80665
```

### TI caps:

* **Cruise Acceleration cap: 2.0 g**
* **Combat Acceleration cap: 4.0 g**

The cap occurs *after* applying thrust and modifiers.

---

## **2.3 Cruise vs Combat Acceleration**

Drives have two key stats:

* **Thrust (cruise)**
* **CombatThrustMultiplier**

So:

```
CruiseAcceleration  = (Sum(Thrust)) × EfficiencyMultiplier / WetMass
CombatAcceleration = CruiseAcceleration × CombatThrustMultiplier
```

---

## **2.4 Efficiency Effects**

Many drives include an **efficiency** value (0–1 range).
This modifies effective thrust.

```
EffectiveThrust = NominalThrust × Efficiency
```

For most fission/fusion drives, Efficiency is ~0.7–0.99.

---

# -----------------------------------------

# 🔥 **3. Power Plant Interaction**

# -----------------------------------------

Drives consume power. If the drives' total power requirement exceeds reactor output:

```
PowerLimitedThrust = Thrust × (PowerAvailable / PowerRequired)
```

Meaning:

* **Underpowered reactor → lower thrust → lower acceleration**
* **Overpowered reactor → no benefit (thrust is capped by the drive)**

Your component tables give exact “power required” values.

---

# -----------------------------------------

# 🛰️ **4. Delta-V Calculation**

# -----------------------------------------

Delta-V is calculated via the **Tsiolkovsky Rocket Equation**, using:

* mass ratio
* specific impulse (Isp) or exhaust velocity
* efficiency if applicable

---

## **4.1 Convert Drive Exhaust Velocity → Isp**

TI gives **exhaust velocity** directly in m/s.

But the Tsiolkovsky equation:

```
Δv = ve × ln(WetMass / DryMass)
```

Where:

* `ve` = exhaust velocity (from the drive)
* `WetMass` and `DryMass` from Section 1

This is the *exact* computation TI uses internally.

---

## **4.2 Delta-V Formula**

```
deltaV = ExhaustVelocity × ln(WetMass / DryMass)
```

Example:

* Exhaust velocity: 20,000 m/s
* WetMass: 1200 tons
* DryMass: 800 tons

```
ln(1200/800) = ln(1.5) = 0.405465
deltaV = 20000 × 0.405465 = 8109 m/s = 8.1 kps
```

---

## **4.3 Efficiency Modifiers**

If the drive has an intrinsic efficiency (<1), multiply:

```
EffectiveDeltaV = deltaV × Efficiency
```

This is rarely large but matters for early engines.

---

## **4.4 Multi-Drive Delta-V**

Multiple drives **do not** add exhaust velocity.
Exhaust velocity is determined by the **installed drive model**, not thrust.

If multiple drive types exist **TI uses the primary drive model selected** (or highest thrust in case of ties).

---

# -----------------------------------------

# 🧯 **5. Heat Sinks & Radiators (Relevant Math Only)**

# -----------------------------------------

Heat sinks accumulate heat when radiators are retracted.

## **5.1 Heat Generation**

### Crew Heat

Each crew member generates:

```
Crew Heat = 3.75 MW per crew member
```

### Power Plant Waste Heat

When a power plant produces power, it also generates waste heat:

```
Waste Heat (GW) = Power Output (GW) / Power Plant Efficiency
```

Efficiency varies by reactor type (typically 0.4-0.8).

### Drive Heat

Drive heat depends on cooling type:

- **Open-cycle cooling** (exhaust carries heat away): Radiator only needs to remove crew heat
- **Closed-cycle cooling** (all heat goes to radiators): Radiator must remove power plant waste heat + crew heat

Total heat that must be managed:

```
Total Heat (MW) = Drive Heat + Weapon Heat + (Crew × 3.75 MW)
```

For closed-cycle drives:

```
Total Heat (GW) = (Power Output / Efficiency) + (Crew × 3.75 MW / 1000)
```

## **5.2 Heat Sink Capacity**

Let:

*  **HeatSinkCapacity** = total stored energy
* **HeatGenerationRate** = from drives + weapons + crew
* **CombatHeatTime**:

```
TimeBeforeOverheat = HeatSinkCapacity / HeatGenerationRate
```

This determines how long a ship can operate without radiators deployed.

## **5.3 Radiator Sizing**

Radiator mass and performance use component data from `ship_components_tables.md`:

- Each radiator has a `specificPower_2s_KWkg` value in `TIRadiatorTemplate.json`.
- The exporter derives:

```text
MassPerGW_tons = 1000 / specificPower_2s_KWkg
```

because:

- 1 GW = 1,000,000 kW
- Mass_kg_per_GW = 1,000,000 kW / specificPower_2s_KWkg
- Mass_tons_per_GW = Mass_kg_per_GW / 1000 = 1000 / specificPower_2s_KWkg

Given a drive’s required power and efficiency, you can approximate waste heat and radiator mass as:

```text
PowerRequired_GW = PowerRequired_MW / 1000
WasteHeat_GW     ≈ PowerRequired_GW × (1 − DriveEfficiency)
RadiatorMass_t   ≈ WasteHeat_GW × MassPerGW_tons
```

Use `Mass (t/GW)` from `ship_components_tables.md` directly when sizing radiator mass for DryMass. Do **not** assume radiator mass is negligible now that this value is explicitly exposed.

---

# -----------------------------------------

# ⚔️ **5A. Weapon Damage & Power Formulas**

# -----------------------------------------

All weapon damage in Terra Invicta is measured in **damage points**, where:

```
1 damage point = 20 MJ of energy
```

## **5A.1 Naval Guns & Magnetic Weapons (Kinetic)**

Used by: Naval Guns, Railguns, Coilguns

### Damage

```
Damage Points = ½ × Warhead Mass (kg) × (Impact Velocity (km/s))² / 20MJ
```

Where:
- `Warhead Mass` = projectile mass (from component data)
- `Impact Velocity` = muzzle velocity (typically 5-50 km/s for magnetic weapons)

### Power Consumption (Magnetic Weapons Only)

Naval guns use gunpowder and consume no power. Magnetic weapons (railguns/coilguns) consume:

```
Power Consumed (GJ) = ½ × Ammo Mass (kg) × (Muzzle Velocity (m/s))² / Efficiency / 1e9 (J/GJ)
```

Note: Ammo mass ≠ warhead mass for some weapons (sabot rounds, etc.)

---

## **5A.2 Lasers**

### Damage

```
Damage Points = Shot Power (MJ) / 20MJ
```

### Power Consumption

```
Power Consumed (GJ) = Shot Power (MJ) / Efficiency / 1000 (MJ/GJ)
```

### Armor Penetration

Lasers have reduced effectiveness against armor at range due to beam divergence:

```
Effective Armor = Base Armor ^ 1.5 × Armor Effectiveness
Armor Effectiveness = Spot Area (m²) / 0.005 (m²)
Spot Area (m²) = 0.7853982 × (Spot Diameter (m))²
Spot Diameter (m) = Distance to Target (km) × Spot Diameter Precise Factor (m/km)
Spot Diameter Precise Factor (m/km) = (1000 / Mirror Diameter (m)) × ((1.22 × Wavelength (m) × Beam Quality)² + (2 × Jitter × Mirror Diameter (m))²) ^ 0.5
```

Where:
- `Mirror Diameter` = laser lens/mirror size (meters)
- `Wavelength` = laser wavelength (infrared ~810nm, green ~540nm, UV varies)
- `Beam Quality` = focusing quality (varies by tech level)
- `Jitter` = beam stability (lower is better)

This means lasers lose effectiveness at long range, especially against armored targets.

---

## **5A.3 Particle Weapons**

### Base Damage

```
Damage Points = Shot Power (MJ) / 20MJ
```

### Distance Falloff

Particle beams can lose effectiveness at range:

```
Actual Damage Points = Base Damage Points × Min(1, Target Area (m²) / Beam Area (m²))
```

Where:

```
Target Area (m²) = π × Target Ship Length × Target Ship Width / 2
Beam Area (m²) = π × (Beam Radius (m))²
```

For **neutral particle beams**:

```
Beam Radius (m) = Emittance (m) × Distance to Target (m) / 1000000 / Lens Radius (cm) × 100 (cm/m)
```

For **charged particle beams**:

```
Beam Radius (m) = Lens Radius (cm) / 100 (cm/m) × 2 ^ (Distance to Target (km) / Doubling Range (km))
```

As of Version 0.4.90, most particle beams have Beam Area < Target Area even at maximum range, so damage falloff is negligible except for electron beams.

### Power Consumption

```
Power Consumed (GJ) = Shot Power (MJ) / Efficiency / 1000 (MJ/GJ)
```

---

## **5A.4 Plasma Weapons**

### Damage

Plasma weapons use kinetic damage formula but apply thermal damage:

```
Damage Points = ½ × Warhead Mass (kg) × (Impact Velocity (km/s))² / 20MJ
```

### Power Consumption

```
Power Consumed (GJ) = Charging Energy (GJ) / Efficiency + ½ × Warhead Mass (kg) × (Muzzle Velocity (m/s))² / Efficiency / 1e9 (J/GJ)
```

Note: Plasma ammo weighs nothing and costs nothing to resupply.

---

## **5A.5 Missiles**

Missile damage varies by warhead type. See `ship_design_guide.md` weapon section for complete missile damage formulas including fragmentation, penetrator, explosive, nuclear, antimatter, and shaped nuclear warheads.

Basic formula for kinetic warheads:

```
Damage Points = ½ × Warhead Mass (kg) × (Impact Velocity (km/s))² / 20MJ
```

For explosive/nuclear warheads, add payload damage from the warhead's explosive yield.

---

# -----------------------------------------

# 🔋 **6. Batteries (Simplified Math)**

# -----------------------------------------

Batteries store power for weapon usage.

Let:

* **BatteryCapacity** = total stored energy
* **WeaponPowerDraw** = firing requirements
* **ReactorOutput** = steady power supply

If:

```
WeaponPowerDraw > ReactorOutput
```

Then:

```
Deficit = WeaponPowerDraw - ReactorOutput
FireTime = BatteryCapacity / Deficit
```

Better batteries recharge faster when:

```
ReactorOutput > ShipDemand
```

---

# -----------------------------------------

# ➿ **7. Turn Rate Scaling**

# -----------------------------------------

Turn rate depends on:

* Ship **Length**
* Ship **Mass**

Approximate TI rule:

```
TurnRate ∝ 1 / (Length × √WetMass)
```

Meaning:

* Shorter ships turn dramatically faster
* Heavy capital hulls turn slowly
* Adding mass (armor, utilities, fuel) reduces turn rate

This isn’t needed for precise computation but is necessary for ranking ships.

---

# -----------------------------------------

# 🛰️ **8. Strategic Implications**

# -----------------------------------------

Using the formulas above:

### **4 kps Δv**

* In-orbit fights, station hops, small transfers

### **8 kps**

* Earth → Moon reliably

### **30 kps**

* Earth → Mars, most interplanetary missions

### **60 kps**

* Fast transfers, Mercury ↔ Saturn, multi-target strikes

### **Acceleration thresholds**

* **>1.0 g cruise** = good mid-game warship
* **~1.5 g cruise** = strong intercept capability
* **~2.0 g** = cap
* **Combat accel 3–4 g** = high-performance dogfighters

---

# -----------------------------------------

# 🧮 **9. Summary of Required Inputs for an Agent**

# -----------------------------------------

To compute everything:

### **Mass**

* ComponentMass (from tables)
* ArmorMass
* CrewMass
* TankMass + PropellantMass

### **Acceleration**

* DriveThrust
* DriveEfficiency
* ReactorOutput
* DrivePowerDemand
* WetMass

### **Delta-V**

* ExhaustVelocity
* WetMass / DryMass
* DriveEfficiency

### **Heat**

* Drive heat
* Weapon heat
* Heat sink capacity

### **Turn Rate**

* Hull length
* WetMass
