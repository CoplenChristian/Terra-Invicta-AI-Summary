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

Let:

* **HeatSinkCapacity** = total MJ stored
* **HeatGenerationRate** = from drives + weapons
* **CombatHeatTime**:

```
TimeBeforeOverheat = HeatSinkCapacity / HeatGenerationRate
```

This determines how long a ship can operate without radiators deployed.

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
