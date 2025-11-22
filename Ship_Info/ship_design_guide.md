# Terra Invicta Shipbuilding – Combined Guide & Systems Reference

This document merges the mechanics-focused **Shipbuilding Reference** with the more narrative **Spaceships & Ship Systems Cheat Sheet** into one place, without dropping details.  
It is also structured so an AI or script can use it as a source of formulas and constraints for ship calculators.

---

## 0. How an AI Should Use This File

This section is a step-by-step procedure for an agent that wants to propose or evaluate a ship design.

Use this file for **mechanics, constraints, and formulas** and pair it with `current_meta.md` for **current community meta heuristics** (fuel fractions, accel/Δv targets, archetypes, and tech paths) when deciding what “good” looks like.

1. **Collect inputs**
   - Desired **mission/role** (Interceptor, Standoff, Bomber, Transport, etc.) → see roles table in §2.3.
   - Available tech / unlocked components (drives, reactors, armor, weapons, utilities).
   - Operational theater: **Earth-Luna**, **inner system**, **outer system**, or “anywhere”.

2. **Choose candidate hulls**
   - Use the hull table in §2.2 to filter by:
     - Desired size class (Gunship ↔ Dreadnought).
     - Hardpoints (nose / hull / utility) needed for the role.
     - MC and money upkeep budget.
   - For each candidate hull, record: `nose/hull/utility`, `MC`, `build times`, `MaxOfficers`.

3. **Pick drive + reactor + radiator baseline**
   - From `ship_components_tables.md`, pick a drive family (chemical/fission/fusion/exotic) guided by §1.1 and §3.
   - Pick power plants that:
     - Match the drive’s required power class.
     - Provide enough output for **drive + radiators + estimated weapons/utilities**.
   - Pick radiators and heat sinks compatible with the drive/reactor tier.

4. **Size propellant and estimate Δv / acceleration**
   - Use `math.md`:
     - §1: compute **DryMass** and **WetMass** from component masses, armor, and `Crew × 4 t`.
     - §1.3: compute **FuelMass** from tank count.
     - §2: compute **CruiseAccel_g** and **CombatAccel_g** from thrust, mass, and efficiency.
     - §4: compute **Δv_kps** from exhaust velocity and mass ratio.
   - Iterate tank count until you hit the Δv target for the theater (thresholds in §1).

5. **Check power and heat budgets**
   - Using `math.md` §3 and the notes in §4.2:
     - Approximate `PowerRequired_MW` for the drive.
     - Ensure reactor `maxOutput_GW` (→ MW) ≥ `PowerRequired_MW + subsystem/weapon draw`.
     - Estimate `WasteHeat_MW` and verify radiators + heat sinks plausibly handle it.

6. **Allocate armor**
   - Choose an armor material from the armor section of `ship_components_tables.md`.
   - Decide armor points `A_front`, `A_sides`, `A_rear` based on expected threat angles.
   - Use `math.md` §1.2 for `ArmorMass = (A_front + A_sides + A_rear) × MaterialDensity`.
   - Recompute mass, accel, and Δv if armor mass changed significantly.

7. **Add weapons and defenses**
   - Fill slots according to their type (see "Slot Types" below):
     - Nose: main guns/spinals.
     - Hull: turrets, PD, beams.
     - Drive: drives only.
     - Power Plant: reactors only.
     - Radiator: radiators only.
     - Battery: batteries only.
     - Utility: **heat sinks and utility modules only** (e.g., ISRU, scoops, ECM, labs, drive enhancers).
   - From `ship_components_tables.md`:
     - Add weapon masses into DryMass.
     - Track weapon power draw, ammo/magazine volumes, and damage roles.
   - Ensure the loadout matches the role (e.g., Protector has strong PD; Bomber emphasizes bombardment).

8. **Check batteries and burst fire**
   - Sum battery capacities to get total `BatteryEnergy_GJ` (from `ship_components_tables.md`).
   - Compare peak weapon draw vs reactor surplus (per `math.md` §3) to estimate burst duration.
   - Confirm the ship can fire main weapons + PD for a reasonable combat window.

9. **Validate the design**
   - Recompute:
     - `WetMass`, `DryMass`, `Δv_kps`, `CruiseAccel_g`, `CombatAccel_g`.
   - Check against targets:
     - Role-appropriate accel (e.g., ≥1.5 g for Interceptors).
     - Adequate Δv for the theater.
     - MC and upkeep within faction limits.
   - Optionally approximate turn behavior via the heuristic in §1.1 and refit/repair overhead via §6.

10. **Output recommendation**
    - Summarize:
      - Hull, role, drive, reactor, radiators, armor material & facings, weapons, utilities.
      - Final key stats: `WetMass`, `Δv_kps`, `CruiseAccel_g`, `CombatAccel_g`, `MC`, `MoneyUpkeep`.
    - If any target is not met, adjust hull size, armor, drive tier, or tanks and repeat from step 3.

Use this 10-step loop whenever you ask an AI to "design a ship" or "evaluate/improve this ship" using this campaign’s data.

### 0.2 Slot Types and Component Mapping (Canonical)

Use this mapping whenever you place components on a hull. Do **not** treat Utility as a catch-all slot.

- **Drive slot**
  - Accepts drive components from `TIDriveTemplate.json` only.

- **Power Plant slot**
  - Accepts power plant components from `TIPowerPlantTemplate.json` only.

- **Radiator slot**
  - Accepts radiator components from `TIRadiatorTemplate.json` only.

- **Battery slot**
  - Accepts battery components from `TIBatteryTemplate.json` only.

- **Utility slot**
  - Accepts:
    - Heat sinks from `TIHeatSinkTemplate.json`.
    - Utility modules from `TIUtilityModuleTemplate.json` (ISRU, scoops, ECM, labs, drive enhancers, etc.).
  - DOES NOT accept radiators or batteries; those have their own dedicated slots.

- **Weapon hardpoints**
  - Nose hardpoints: fixed weapons (guns, lasers, particles, missiles) from the various weapon templates.
  - Hull hardpoints: turrets and PD from the same weapon templates.

When designing ships, always infer slot availability from `TIShipHullTemplate.json` (`moduleSlotType` entries) and then select components from the matching template file based on the rules above.

### 0.1 Strict Instruction Template for TI Ship Designer (for System Prompts)

The following template is suitable to paste into an AI shipbuilder’s **system prompt**. It assumes access to this file plus the supporting data files.

> You MUST read and use all of the following files every time you design a ship:
> - `current_meta.md`
> - `math.md`
> - `ship_components_tables.md`
> - `ship_design_guide.md`
>
> When producing a ship design, you MUST:
>
> 1. **Use ALL available data files**
>    - Apply meta rules from `current_meta.md`:
>      - Fuel fraction thresholds
>      - Δv targets
>      - Acceleration targets
>      - Armor meta
>      - PD requirements
>      - Drive meta
>    - Use exact component stats from `ship_components_tables.md`:
>      - Mass
>      - Thrust
>      - Exhaust velocity
>      - Efficiency
>      - Power draw
>      - Propellant type
>    - Perform formal calculations using `math.md`:
>      - Dry mass
>      - Wet mass
>      - Acceleration
>      - Delta-V
>      - Fuel mass
>      - Armor mass
>
> 2. **ALWAYS output explicit, numeric component counts**
>
>    For each hardpoint type, you must list:
>
>    - **Drive Section (REQUIRED)**
>      - Drive model
>      - Number of drives
>      - Exact total thrust
>      - Exhaust velocity used
>      - Efficiency
>      - Reactor model
>      - Reactor output vs drive requirements
>      - Radiator model(s) and count
>      - Heat sink model and count (if present)
>
>    - **Propellant Tanks**
>      - Tank model
>      - Number of tanks
>      - Total propellant mass
>      - Exact fuel fraction
>      - Propellant type
>
>    - **Armor**
>      - List the exact armor thickness for each facing:
>        - Front: X  
>          Sides: Y  
>          Rear: Z  
>      - Material: `<material_name>`  
>      - Total armor mass (computed)
>
>      Use material density from component tables.
>
>    - **Weapons**
>      - For every nose/hull hardpoint:
>        - Exact component name
>        - Quantity
>        - Power draw
>        - Mass
>        - Ammo/heat needs if relevant
>
>    - **Utilities**
>      - List every utility slot:
>        - Batteries (model + count)
>        - ECM
>        - PD systems
>        - Labs
>        - ISRU
>        - Drive enhancers
>        - Heat sinks
>
> 3. **ALWAYS output the computed performance numbers**
>
>    Compute using equations from `math.md`:
>
>    - Dry mass
>    - Fuel mass
>    - Wet mass
>    - Acceleration (cruise + combat)
>    - Delta-V (kps) using exact exhaust velocity & mass ratio
>    - Fuel fraction
>    - Power margin
>    - Heat margin
>
>    If any value fails meta thresholds, state it clearly and propose adjustments.
>
> 4. **NEVER invent components**
>
>    Only use items explicitly listed in `ship_components_tables.md`.
>
> 5. **Final Output Format (MANDATORY)**
>
>    Every ship design must end with this structure:
>
>    ```text
>    == SHIP DESIGN: <Name> ==
>
>    HULL:
>    Role:
>    MC Cost:
>
>    == COMPONENTS ==
>    DRIVES:
>    - <drive model> × <n>: <thrust>, <exhaust velocity>, <eff>
>
>    REACTOR:
>    - <reactor model>: <output>
>
>    RADIATORS:
>    - <radiator model> × <n>
>
>    TANKS:
>    - <tank model> × <n> = <propellant mass t>
>
>    ARMOR:
>    Material:
>    Front: X
>    Sides: Y
>    Rear: Z
>    Total armor mass: <value>
>
>    NOSE HARDPOINTS:
>    - <weapon> × <n>
>
>    HULL HARDPOINTS:
>    - <weapon> × <n>
>
>    UTILITY HARDPOINTS:
>    - <utility> × <n>
>
>    == CALCULATED SHIP STATS ==
>    Dry mass:
>    Fuel mass:
>    Wet mass:
>    Fuel fraction:
>    Cruise acceleration (g):
>    Combat acceleration (g):
>    Delta-V (kps):
>    Power required:
>    Power provided:
>    Heat analysis:
>    Turn rate heuristic:
>    ```
>
> You MUST fill out every field, every time.

---

## 0. Ship Design Overview

- You can design ships once you have **Orbital Shipbuilding** and at least one **Space Dock / Shipyard / Spaceworks** on a hab.
- A valid combat design must include at minimum:
  - 1× **Drive**
  - 1× **Power Plant**
  - 1× **Radiator**
  - 1× **Battery**
  - A chosen **armor material** (thickness can be zero)
  - ≥1 **Propellant tank**
  - A **Role** (e.g., Interceptor, Space Superiority, Transport)
- Ships are then built at space docks/shipyards; with the right modules they can:
  - Prospect bodies, found habs, generate space science, bombard planets.
  - Most designs, however, exist to fight as part of **fleets**.

---

## 1. Ship Performance Stats (What Actually Matters)

Key stats shown in the designer and fleet view:

- **Wet Mass**
  - Total mass with full propellant.
  - Higher mass = worse acceleration, turn rate, and Delta‑V.

- **Crew**
  - ~4 tons of mass per crew.
  - Increases support costs and evacuation/scuttling cost if lost.

- **Cruise Acceleration** (strategy map)
  - How fast a fleet changes velocity on the campaign layer.
  - Hard cap: **2.0 g**.
  - High cruise accel = faster, more direct transfers; easier to climb gravity wells.

- **Combat Acceleration** (tactical battles)
  - How fast a ship can change velocity in combat.
  - Hard cap: **4.0 g**.
  - Higher combat accel = better dodging, closing/exiting range, and general agility.

- **Turn Rate**
  - How quickly the ship rotates in battles.
  - Shorter, lighter hulls turn faster; long, heavily armored ships with big radiators feel sluggish.

- **Heat Sink Capacity**
  - How long you can operate with **radiators retracted** before overheating.
  - Crucial for burst combat or boosting while presenting a smaller target.

- **Battery Capacity**
  - Stores power for high‑draw weapons and subsystems if the reactor is insufficient or damaged/offline.
  - Higher tiers can recharge in combat.

- **Construction Cost & Time**
  - Space resources + optional Boost/Money substitutions.
  - Boost/Money replacing resources can increase build time (materials shipped from Earth).
  - Larger/higher‑tier shipyards reduce build time.

- **Support (Mission Control & Money)**
  - Sets MC upkeep and monthly money cost.
  - Underpaying support makes ships more vulnerable to seizure or rebellion events.

- **Cruise Delta‑V (Δv)**
  - Determines where you can go and how fast.
  - More tanks → more Δv; more mass (armor, reactors, radiators, big hulls) → less Δv.
  - Approximate thresholds:
    - ~**4 kps** – intercept and return within the same orbit.
    - **< 8 kps** – unreliable for Earth‑to‑Moon transfers.
    - **< 30 kps** – unreliable for general interplanetary transfers from Earth.
    - ~**60 kps** – can do extreme transfers (e.g., Mercury ↔ Saturn) reliably.

- **Space Combat Value**
  - Abstract rating based on hull, systems, and weapons.
  - Mostly irrelevant except for some victory conditions and flavor.

---

## 1.1 Drives, Reactors, and Good Pairings

Any drive that meets tech and mass constraints can be paired with any power plant that satisfies **power and heat** requirements, but some combinations are far more efficient:

- **Chemical / Early Drives**
  - Pre‑nuclear (Mission to Space/Moon/Mars–era).
  - Often run with minimal reactors or small early fission plants and modest radiators.
  - Good for early utility ships and one‑off transfers; weak in combat once armor and guns are added.

- **Solid‑Core Fission Drives**
  - “NERVA‑like” engines and early solid‑core fission lines.
  - Pair with **Solid‑Core Fission Reactors** and modest radiators.
  - Good for early–mid‑game defensive fleets and first serious Mars/Luna operations.

- **Molten‑Salt / Molten‑Core / Gas‑Core Fission Drives**
  - Higher Δv and thrust than early solid‑core.
  - Want matching **molten‑salt/core/gas‑core reactors** and better radiators/heat sinks.
  - Support heavier armor and batteries without completely killing performance.

- **Fusion Drives (Pebble, Lightbulb, Pharos, etc.)**
  - Late mid‑game to late‑game.
  - Pair with fusion reactors or top‑end fission plants plus strong radiators.
  - Ideal for cruisers, battleships, dreadnoughts, and long‑range strike fleets.

- **Exotic / Beamed / Pulsed Drives**
  - Examples: E‑beam / Amplitron / Snare / Vortex / Pulsar‑class drives and Orion‑style pulse drives.
  - Require top‑tier reactors and maximal radiator coverage.
  - Provide extreme performance (combat accel + Δv) at very high research and resource cost.

**Quick drive‑plant design rules:**

- Start by picking a **target combat acceleration**:
  - Line ships: aim for ≥ **1.0 g**.
  - Interceptors / knife‑fighters: aim for ≥ **1.5 g**, often at the cost of tanks.
- Check **power margin**:
  - After budgeting power for the drive and radiators, you still need enough for your main guns, PD, and utilities.
- Avoid:
  - Late, power‑hungry drives with undersized reactors → ship stalls when weapons fire.
  - Oversized reactors on low‑thrust drives → wasted mass, poor accel and Δv.

Turn rate heuristic (for modeling):

Shorter hulls and lighter ships turn faster. A simple proportional rule is:

```text
TurnRate ∝ 1 / (HullLength × √WetMass)
```

You can use this when comparing designs even though the game doesn’t show a numeric turn stat.

---

## 2. Hull Types, Hardpoints, and Roles

### 2.1 What the Hull Controls

Choosing a hull fixes:

- Number of **nose hardpoints** (forward‑fixed weapons).
- Number of **hull hardpoints** (turrets).
- Number of **utility hardpoints** (batteries, drive enhancers, ECM, labs, ISRU, etc.).
- **Length & width**, affecting turn rate and armor volume.
- **Structural integrity**.
- **Base construction time** & **construction tier (T1/T2/T3)**.
- Max **officers**.
- Base **MC upkeep** and money upkeep.

### 2.2 Human Hull Table

From the wiki hull tables (values copied here so this file is self-contained):

| Hull Type      | Nose | Hull | Utility | Max Officers | T1 Time | T2 Time | T3 Time | Armor (T) / point, Nose/Tail | Armor (T) / point, Side | MC | Money Upkeep |
|----------------|------|------|---------|-------------:|--------:|--------:|--------:|------------------------------:|------------------------:|---:|-------------:|
| **Gunship**    | 1    | 1    | 1       | 1            | 60      | 51      | 29      | 79                           | 1571                   | 1  | 1            |
| **Escort**     | 2    | 2    | 1       | 1            | 90      | 77      | 44      | 79                           | 1571                   | 1  | 2            |
| **Corvette**   | 1    | 1    | 2       | 2            | 90      | 77      | 44      | 177                          | 3063                   | 1  | 3            |
| **Frigate**    | 1    | 2    | 4       | 3            | 120     | 102     | 59      | 314                          | 6283                   | 2  | 4            |
| **Monitor**    | 4    | 3    | 3       | 3            | 180     | 120     | 84      | 314                          | 7854                   | 2  | 4            |
| **Destroyer**  | 2    | 2    | 3       | 3            | 203     | 135     | 95      | 314                          | 7854                   | 2  | 5            |
| **Cruiser**    | 2    | 3    | 6       | 4            | 270     | 180     | 126     | 314                          | 10996                  | 3  | 10           |
| **Battlecr.**  | 3    | 2    | 4       | 4            | 270     | 180     | 126     | 314                          | 10996                  | 3  | 12           |
| **Battleship** | 2    | 6    | 5       | 5            | 450     | 300     | 210     | 471                          | 15708                  | 4  | 20           |
| **Dreadnought**| 3    | 4    | 6       | 6            | 600     | 405     | 284     | 471                          | 15708                  | 5  | 30           |

From the wiki hull tables, human hulls roughly scale as:

- **Gunship / Escort / Corvette**
  - Cheap early-game escorts and missile boats.
  - 1–2 nose mounts, a few hull mounts, and 1–2 utility slots.
  - Best used in numbers as PD screens, interceptors, or early brawlers.

- **Frigate / Monitor / Destroyer**
  - Mid-game workhorses.
  - More hardpoints and utility slots for ECM, scoops/ISRU, heat sinks, etc.
  - Good balance of firepower, survivability, and cost.

- **Cruiser / Battlecruiser / Battleship / Dreadnought**
  - Heavy line ships and flagships.
  - Multiple nose + hull mounts and large utility budgets.
  - Can support spinal weapons, heavy broadsides, robust PD, and full defensive suites – but need strong drives and reactors.

### 2.3 Roles and AI Behavior

Roles affect **preferred engagement range and behavior**:

| Role                    | Range Preference | Combat Style | Notes |
|-------------------------|------------------|--------------|-------|
| Troop Carrier           | Long             | Non‑combat   | Must carry Marine module |
| Explorer                | Long             | Non‑combat   | Must carry Prospector module |
| Inner System Colony     | Long             | Non‑combat   | Must carry Hab Kit |
| Outer System Colony     | Long             | Non‑combat   | Uses Nuclear Hab Kit |
| Transport               | Long             | Non‑combat   | Freight / supply ship |
| Penetrator              | Long             | Short        | Fast strike, low preferred range |
| Protector               | Long             | Short        | Emphasizes point defense |
| Interdictor             | Long             | Medium       | Fleet control / interception |
| Intruder                | Long             | Long         | Long‑range strike platform |
| Bomber                  | Long             | Long         | Emphasizes bombardment weapons |
| Strike                  | Medium           | Short        | Mid‑range assault ship |
| Space Superiority       | Medium           | Medium       | Dogfighter role |
| Standoff                | Medium           | Long         | Kiting / artillery behavior |
| Interceptor             | Short            | Short        | Max accel, minimal propellant |
| Patrol                  | Short            | Medium       | Local security |
| Defender                | Short            | Long         | Hangs back, PD and long guns |

**Design tip:**  
- “Long” range roles tolerate more tanks and mass for Δv.  
- “Short” range roles want higher accel, fewer tanks, and more guns/armor.

---

## 3. Drives, Propellant, and Delta‑V

### 3.1 Drive Core Mechanics

- Drives are defined mainly by:
  - **Thrust** (usually shown as `thrust_N` in data) – acceleration and tactical mobility.
  - **Exhaust Velocity (EV)** (usually `EV_kps`) – Delta‑V per unit of propellant, in km/s.
- Δv comes from **100‑ton propellant tanks**.
  - No strict hard cap on tank count, but each tank adds mass and has diminishing returns (rocket equation).
- Thrust + EV together determine **required power** from the plant.
- Many drives require specific **power‑plant classes**; low‑tech plants may be technically compatible but practically under‑powered.
- Propellant composition is drive‑specific (water, hydrogen, volatiles, metals, fissiles, etc.).
  - Some drives replace fissile cost with water if you own certain resource habs (e.g., He‑3 mines).

### 3.2 Engineering Formulas (Pointer)

For full math definitions of **Dry/Wet Mass**, **acceleration in g**, and **Δv** (Tsiolkovsky with TI’s EV), use `math.md`:

- Mass model: `math.md` §1 (DryMass, WetMass, FuelMass, ArmorMass).
- Acceleration: `math.md` §2 (cruise vs combat, caps, efficiency).
- Delta‑V: `math.md` §4 (rocket equation using exhaust velocity).

### 3.3 Drive Category Use‑Cases (Community Summary)

- **Early‑game chemical/electrothermal/electrostatic/electromagnetic**
  - Low thrust, low–mid EV.
  - Not great for high‑mass combat ships; fine for early colony ships, explorers, and non‑combat roles.

- **Fission thermal (solid‑core, molten‑core)**
  - Powered by solid‑core/moltencore fission reactors.
  - Mid thrust and EV; excellent for early‑mid defensive fleets around Earth/Luna.
  - Community favorites include mid‑game drives that hit **near‑max combat accel with 20–30 kps Δv** on armored line ships.

- **Fission pulse (Orion‑style)**
  - Extremely high thrust and solid EV.
  - Great early‑to‑mid combat drives; brutal acceleration.
  - Propellant tanks are extremely expensive (heavy use of fissiles and noble metals).

- **Fusion drives**
  - Late‑game generalists with strong thrust and EV.
  - Let you build heavy, long‑range fleets with excellent strategic mobility.

- **Exotic / beamed drives**
  - Enable very high accel and Δv on select flagships and “ace” fleets.
  - Very demanding on research, power, and heat control.

For acceleration modeling:

- Cruise acceleration in g is derived from thrust and `WetMass` (see `math.md` §2).
- Combat acceleration can be treated as:

```text
CombatAccel_g = CruiseAccel_g × CombatMultiplier
```

Where `CombatMultiplier` defaults to `1.0` unless you define special rules (e.g., pulse/exotic drives granting a bonus).

---

## 4. Core Ship Systems (Practical Design Notes)

### 4.1 Armor

- You must pick an **armor material**, even if thickness is zero.
- Different materials trade:
  - **Density / mass** vs. **X‑ray / baryonic / kinetic resistance**.
  - **Heat of vaporization** (how well they absorb energy before ablation).
- Thicker armor:
  - Dramatically increases mass and construction cost.
  - Greatly improves survivability against kinetics and some beams.

Practical uses:

- Light escorts and interceptors often use lighter armor or thinner layers to keep accel high.
- Line ships and flagships spend more mass on armor, especially on nose/tail and sides facing expected fire.

Armor layout and mass (for modeling):

- Faces: **nose**, **sides**, **tail** with armor points `NosePoints`, `SidePoints`, `TailPoints`.
- Material: defined by `HeatOfVaporization_MJkg` and `Density_kgm3` in your armor component tables.
- Hull: defined by `HullWidth_m` and `HullLength_m` for the chosen hull.

For armor mass, you **must** use the official geometry‑based formula in `math.md` §1.2:

1. Compute per‑point plate thickness:

   ```text
   PlateThickness_m = 20 / HeatOfVaporization_MJkg / Density_kgm3 / 0.005
   ```

2. Facing thicknesses:

   ```text
   NoseThickness_m = PlateThickness_m * NosePoints
   TailThickness_m = PlateThickness_m * TailPoints
   SideThickness_m = PlateThickness_m * SidePoints
   ```

3. Volumes:

   ```text
   NoseVolume_m3 =
       NoseThickness_m * π * (HullWidth_m/2 + SideThickness_m)^2

   TailVolume_m3 =
       TailThickness_m * π * (HullWidth_m/2 + SideThickness_m)^2

   SideVolume_m3 =
       π * HullLength_m *
       [ (HullWidth_m/2 + SideThickness_m)^2 - (HullWidth_m/2)^2 ]
   ```

4. Mass:

   ```text
   ArmorVolume_m3 = NoseVolume_m3 + TailVolume_m3 + SideVolume_m3
   ArmorMass_kg   = ArmorVolume_m3 * Density_kgm3
   ArmorMass_tons = ArmorMass_kg / 1000
   ```

Do **not** use the `Armor (T)/point` column from the hull table or assume any fixed tons‑per‑point rule; those values are not consistent across hulls and are superseded by this formula.

### 4.2 Radiators and Heat Sinks

- Radiators dump heat while extended; they are fragile and increase target profile.
- Heat sinks store heat while radiators are retracted:
  - Enable limited radiators-in combat, boosting, or stealthy approaches.
- High-performance drives and lasers require both **good radiators** and **adequate heat sink capacity**.

For rough power/heat modeling tied to the drive:

```text
PowerRequired_MW ≈ (Thrust_N × EV_kps) / 2000
WasteHeat_MW     ≈ PowerRequired_MW × (1 − Efficiency)
```

Reactors should at least cover `PowerRequired_MW`. See `math.md` §3 for power-limited thrust.

Radiator mass and performance for modeling:

- Use the **Mass (t/GW)** column from `ship_components_tables.md`, derived as `MassPerGW_tons = 1000 / specificPower_2s_KWkg` from `TIRadiatorTemplate.json`.
- Estimate radiator mass as:

```text
PowerRequired_GW = PowerRequired_MW / 1000
WasteHeat_GW     ≈ PowerRequired_GW × (1 − DriveEfficiency)
RadiatorMass_t   ≈ WasteHeat_GW × MassPerGW_tons
```

- Include `RadiatorMass_t` in DryMass as part of `ComponentMass`.
- Treat the **Emissivity** column in `ship_components_tables.md` as a qualitative radiator performance indicator; do **not** invent a numeric "heatDissipation_GW" if it is not present. If exact GW dissipation is required and missing, mark it as `UNKNOWN` rather than assuming a value.

### 4.3 Power Plants and Batteries

- Power plants:
  - Must cover **drive draw + weapons + radiators + utilities** with some margin.
  - Higher‑tech plants provide more output per ton but can be expensive and hot.
- Batteries:
  - Buffer short power spikes.
  - Let weapons fire at full rate even if the plant can’t keep up moment‑to‑moment.
  - Higher tiers add more energy and faster recharge.
  - See `math.md` §3 for power‑limited thrust and interaction between reactor output and drive thrust.

Design pattern:

- Start from drive and desired Delta‑V, size the power plant and radiators to support it.
- Then add weapons/PD and verify the plant plus batteries can handle peak draw.

### 4.4 Weapons & Defensive Suites

- **Kinetic guns and magnetic guns (coilguns/railguns)**
  - Consume ammo mass; high damage vs. armor and hull.
  - Benefit from high muzzle velocity and warhead mass.
- **Lasers and particle/beam weapons**
  - Use power and heat instead of ammo.
  - Excellent for long‑range precision and point defense.
- **Missile bays**
  - Deliver large burst damage at range; limited magazines.
  - Vulnerable to PD, but excellent when salvoed from multiple ships.
- **Defensive systems**
  - PD guns/lasers, ECM, decoy launchers, and utility modules.
  - Critical on large, expensive ships; escorts can specialize in PD/ECM roles.

---

## 5. Practical Design Heuristics

- Decide the ship’s **role** first (Interceptor, Standoff, Bomber, etc.).
- Pick a **hull** that has enough hardpoints and utility slots for that role.
- Choose a **drive + reactor + radiator** combo that:
  - Hits your target combat accel.
  - Provides enough Δv for the intended theater (Earth‑Luna, inner system, outer system).
- Add **armor, batteries, and heat sinks** to taste, watching mass and Δv.
- Add weapons and PD last, checking:
  - Power budget (plant + batteries).
  - Heat load and radiator/heat sink capacity.
  - Ammunition and propellant logistics for your faction’s economy.

- Finally, evaluate:
  - `a_cruise_g`, `a_combat_g`, `Δv_kps`, `WetMass`, `HeatSinkCapacity_GJ`, `WasteHeat_MW`.
  - MC and money support vs your faction’s economy.

For exact per‑component numbers (drives, batteries, reactors, etc.), use the generated tables in `ship_components_tables.md`.  
For canonical formulas (mass model, acceleration, Δv, power‑limited thrust), use `math.md`.  
This combined guide is meant to tell you **what to care about**, reference where the math lives, and be structured so an AI or script can build ship calculators on top of it.

---

## 6. Logistics, Resupply, Repairs, and Refits (Model Approximation)

These rules are more approximate but help an AI estimate downtime and logistics.

### 6.1 ISRU and Atmospheric Refuel Time

Let:

- `FuelNeeded_tons` = propellant mass missing (tons).
- `SiteDailyOutput_tons` = daily fuel output for an ISRU site (tons/day).

**ISRU‑based refuel:**

```text
RefuelTime_ISRU_days ≈ FuelNeeded_tons / SiteDailyOutput_tons
```

**Remass scoop (atmospheric refuel):**

If you treat scoop efficiency as roughly 1000 tons/day with a 10‑day minimum:

```text
RefuelTime_Scoop_days ≈ max(10, FuelNeeded_tons / 1000)
```

### 6.2 Repairs (High Level)

Repair times scale with:

- Station/shipyard tier.
- Percentage of missing health.
- Part‑specific cost/time multipliers.

You can model it generically as:

```text
RepairTime_days ≈ StationTierModifier * MissingHealthFraction * PartRepairTimeBase
```

Where `PartRepairTimeBase` is an approximate per‑component baseline.

### 6.3 Refits

Refits cost a fraction of the hull’s base construction time:

- Power plant change: ~25%.
- Drive change: ~25%.
- Armor (per face): ~5%.
- Radiators: ~5%.
- Batteries, heat sinks, utilities: ~5% per changed module.
- Weapons: ~5% per swapped weapon.

You can approximate:

```text
RefitTime_days = min(
    0.75 * HullBuildTime_days,
    HullBuildTime_days * (0.25 * PlantChanges
                         + 0.25 * DriveChanges
                         + 0.05 * ArmorFacesChanged
                         + 0.05 * RadiatorChanges
                         + 0.05 * UtilityChanges
                         + 0.05 * WeaponChanges)
)
```

This is not an exact in‑game formula but gives an AI enough structure to estimate whether a refit is “cheap” or “almost a rebuild.”

## 7. Symbol & Unit Glossary (for Agents)

- `Thrust_N` – drive thrust in **newtons** (N).
- `EV_kps` – exhaust velocity in **kilometers per second** (km/s).
- `Δv_kps` – Delta-V in **km/s**.
- `WetMass`, `DryMass` – ship mass in **tons** (t).
- `GJ` – **gigajoules** of energy (10⁹ J), used for batteries and heat sinks.
- `MW`, `GW` – **megawatts** and **gigawatts** of power.
- `a_cruise_g`, `a_combat_g` – accelerations in units of Earth gravity (g).
