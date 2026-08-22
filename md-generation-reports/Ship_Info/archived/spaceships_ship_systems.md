# Terra Invicta – Spaceships & Ship Systems Cheat Sheet

**Source:** https://wiki.hoodedhorse.com/Terra_Invicta/Spaceships (revision 7188)

This is a condensed reference for **ship performance, hulls, roles, components, resupply, repairs, and refits** – focused on what matters when designing and operating combat ships.

At a high level:

- Ships are built once you have **Orbital Shipbuilding** and a **Space Dock/Shipyard** module at a hab.
- With the right modules, ships can:
  - Prospect **celestial bodies**, found **habs**, generate **space science**, and **bombard** planets.
  - But most ships exist to fight as part of **fleets** defending or attacking habs and stations.

---

## 1. Ship Performance Stats

Key values shown in the designer and fleet view:

- **Wet Mass**
  - Total mass including full fuel.
  - **Higher mass = lower accel, Δv, and turn rate.**
  - Hovering shows breakdown by component.

- **Crew**
  - 4 tons of mass per crew.
  - Affects support costs and scuttling/evacuation cost.

- **Cruise Acceleration** (strategy layer)
  - How fast a ship changes velocity on the campaign map.
  - Higher accel = more direct, faster transfers.
  - **Hard cap: 2.0 g.**

- **Combat Acceleration** (tactical layer)
  - How fast a ship changes velocity in battles.
  - Some drives offer a higher combat accel burst.
  - **Hard cap: 4.0 g.**

- **Turn Rate**
  - How quickly the ship rotates in combat.
  - Depends mainly on **length + mass** – shorter and lighter turns faster.

- **Heat Sink Capacity**
  - Temporary heat storage while radiators are **retracted**.
  - Lets you fight or boost briefly with radiators in without melting.

- **Battery Capacity**
  - Stores power for weapons when the plant is unavailable (e.g., damaged or insufficient at peak draw).
  - Better batteries can **recharge in combat.**

- **Construction Cost**
  - Space resources + optional Boost/Money substitutions.
  - Using Boost/Money instead of resources can **increase build time** (materials shipped from Earth).

- **Construction Time**
  - Days to build once all materials are present.
  - Larger/tier-3 shipyards reduce build time.

- **Support**
  - **Mission Control + monthly money** upkeep.
  - Unpaid support makes ships more vulnerable to seizure and rebellion events.

- **Cruise Delta‑V (Δv)**
  - Determines where the ship can go and how fast.
  - **More propellant = more Δv. More mass = less Δv.**
  - Thresholds (approx):
    - **4 kps** – intercept + return in **same orbit**.
    - **< 8 kps** – struggles to reach **Moon from Earth orbit**.
    - **< 30 kps** – unreliable for full interplanetary transfers from Earth.
    - **~60 kps** – can handle extreme transfers (e.g., **Mercury ⇄ Saturn**).

- **Space Combat Value**
  - Abstract combat rating based on equipment.
  - Mostly irrelevant except for some **victory conditions**.

---

## 1.1 Drives, Reactors, and Good Pairings

Any drive that meets tech and mass limits can be combined with any power plant that meets **power + heat** requirements, but some combinations are much more effective than others:

- **Chemical / Early Drives**
  - Tech tier: pre‑nuclear (Mission to Space/Moon/Mars‑era).
  - Typical pairing: **no reactor or small early fission**, minimal radiators.
  - Use on: early corvettes/frigates doing LEO defense, scouting, or one‑off transfers.
  - Limitations: weak Δv and accel; quickly outclassed once fission drives unlock.

- **Solid‑Core Fission Drives**
  - Examples: early **Solid Core Fission Drive** series, NERVA‑like engines.
  - Pair with: **Solid Core Fission Reactors** plus modest radiators; enough power to run a few guns and PD.
  - Use on: early–mid‑game corvettes, frigates, and destroyers doing Luna/Mars routes.
  - Notes: good “baseline” for first serious combat fleets and Mars operations.

- **Molten‑Salt / Molten‑Core / Gas‑Core Fission Drives**
  - Examples: **Molten Salt**, **Molten Core**, and **Gas Core** fission drives.
  - Pair with: matching **Molten Salt / Molten Core / Gas Core reactors** and stronger radiators/heat sinks.
  - Use on: destroyers, cruisers, and early capital ships.
  - Notes: big step up in Δv and accel; supports heavy armor and large batteries without crippling performance.

- **Fusion Drives (Pebble, Lightbulb, Pharos, etc.)**
  - Tech tier: late mid‑game to late‑game.
  - Pair with: **fusion reactors** (or high‑end fission for first generation) and high‑capacity radiator arrays.
  - Use on: cruisers, battleships, dreadnoughts, and long‑range patrol/strike fleets.
  - Notes: excellent strategic mobility and combat accel; expensive and power/heat hungry.

- **Exotic / Beamed / Pulsed Drives**
  - Examples: **E‑Beam / Amplitron / Snare / Vortex / Pulsar**‑class drives.
  - Pair with: top‑tier fission/fusion reactors plus maximum radiator coverage.
  - Use on: elite interceptors, “ace” fleets, and very high‑value flagships.
  - Notes: extreme performance but very high research and resource cost.

**Quick design rules:**

- Pick a **target combat accel** (e.g., ≥1.0 g for line ships, ≥1.5 g for interceptors) and work backwards:
  - If you can’t hit your accel target with a given hull+drive+reactor combo, drop hull size or mass.
- Ensure you have **power margin**:
  - After drive + radiators, you should still have enough power for your main guns and PD.
- Avoid pairing:
  - **Late drives + tiny reactors** → can’t fire weapons without stalling the ship.
  - **Huge reactors + tiny drives** → wasted mass and terrible accel/Δv.

---

## 2. Hulls & Hardpoints

Each **hull** defines:

- Number of **nose weapon** hardpoints.
- Number of **hull weapon** hardpoints.
- Number of **utility** hardpoints.
- Hull dimensions (length/width).
- Structural integrity.
- Base construction time.
- Construction **tier** (affects repairs/refits and costs).
- Maximum officers.
- Base **MC upkeep**.

In practice, hulls follow a **simple progression** from small escorts up to capital ships. Exact hardpoint counts can change between patches, but the qualitative pattern is stable:

- **Corvette**
  - Role: cheapest true combat hull; early‑game screen and missile boat.
  - Pattern: 1 nose mount, a small number of hull mounts, and a handful of utility slots.
  - Notes: best used in numbers as PD/missile screens or cheap interceptors.

- **Frigate**
  - Role: early–mid‑game workhorse; escorts and light gunships.
  - Pattern: 1 nose mount, more hull mounts and utilities than a corvette.
  - Notes: good balance of firepower and cost; ideal for PD plus one serious main gun or missile battery.

- **Destroyer**
  - Role: standard line ship once better drives/armor are unlocked.
  - Pattern: 1 nose, a clearly larger hull‑mount budget, plus room for ECM, scoops/ISRU, and heat sinks.
  - Notes: good “default” combat hull for most of the mid‑game.

- **Cruiser**
  - Role: heavy line ship / flagship hull.
  - Pattern: 1 nose, many hull mounts, and multiple utility slots.
  - Notes: can carry big spinal weapons + broadside guns + full defenses; expensive and drive‑hungry.

- **Battleship / Dreadnought**
  - Role: capital ship and late‑game fleet anchor.
  - Pattern: 1 nose, the most hull mounts, and the largest utility budget.
  - Notes: excellent for the heaviest beams/rails and thick armor, but demanding on drives, reactors, and MC.

- **Monitor / Heavy Gun Platforms (if available)**
  - Role: heavily armored, low‑accel “towers” for station/planet defense.
  - Pattern: more armor and/or utilities at the cost of strategic mobility.

Use this progression as a **design heuristic**:

- Small hulls → cheap, high‑accel, limited mounts (good escorts and PD).
- Mid hulls → general‑purpose line ships (destroyers/cruisers).
- Capital hulls → late‑game MC‑efficient firepower, provided you can afford **drives + reactors + radiators** strong enough to keep them mobile.

For **up‑to‑date, per‑hull hardpoint counts and utility slots**, rely on the in‑game designer or the main Spaceships wiki page. This sheet focuses on how hull size interacts with **drive, power, and role choices** rather than reproducing every numeric row.

---

## 2.1 Roles

Every ship must be assigned a **Role** (e.g., Escort, Assault, Colony, etc.). The role:

- Is required to **save** the design.
- Acts as a **doctrine tag** that influences how the AI will try to use the ship in fleets.
- Can gate some **special functions**, such as:
  - Colony ships requiring a **colony kit** utility.
  - Science/mission roles requiring appropriate lab/kit modules.

For combat-focused designs, the main impact is doctrinal and organizational: escorts vs line ships vs carriers.

---

## 2.2 Officers

Ships can have **officers** (see also the officers UI):

- Officers provide bonuses such as:
  - Improved **repairs and refits** (Engineering-type).
  - Better **combat performance** (tactics, accuracy, survivability).
- Some mechanics explicitly scale with officer presence:
  - Repair duration is reduced by an **Engineering Officer** on board.
  - Command-type officers can improve fleet handling and engagement outcomes.

Officer capacity per ship is set by the **hull** (max officers stat).

---

## 3. Minimum Requirements to Save a Design

To save a ship, it must have **all** of:

- A **Drive**.
- A **Power Plant**.
- **Radiators**.
- At least one **Battery**.
- An **Armor material** selected (even if thickness is zero).
- At least **one propellant tank**.
- An assigned **Role**.

Specialty roles (colony ships, etc.) also need **appropriate utility modules** (e.g. colony kits, labs, ISRU).

---

## 4. Ship Components & Systems

### 4.1 Drives & Propellant

Drives are defined by:

- **Classification Type:**
  - e.g. **Chemical, Electrothermal, Electrostatic, Electromagnetic, Fission_Thermal, NuclearSaltWater, Fission_Pulse, Fusion_Thermal, Antimatter**.
- **Required Power Plant Type:**
  - Must match a compatible plant (Solid Core Fission, Gas Core Fission, Fusion types, etc.), or "Any Power Plant".
- **Propellant Type:**
  - **ReactionProducts, Hydrogen, Anything, Water, NobleGases, Volatiles, Metals**.

**Propellant rules:**

- More propellant → **higher Δv** but **higher wet mass**, which lowers accel.
- You cannot save a design without **at least one tank**.

**Practical Δv guidelines (from wiki):**

- 4 kps: local intercept + return in same orbit.
- 8+ kps: comfortable cislunar operations.
- 30+ kps: general interplanetary capability from Earth.
- 60+ kps: aggressive, flexible deep transfers.

### 4.2 Power Plants

- Must match the drive’s **required type**.
- Types include:
  - Fuel Cells, various Fission cores (Solid, Molten Salt, Liquid, Gas), multiple Fusion families, Antimatter Plasma/Beam.
- Refits can only swap to a plant of the **same plant type** (see refit section).

### 4.3 Radiators

- Radiate heat from the power plant and weapons.
- Can be **retracted** in combat (reduces vulnerability, but shifts heat to sinks).
- Refits can change radiators **freely** (at a small % of hull construction time).

### 4.4 Batteries

- Provide temporary power when plant output is insufficient or unavailable.
- Must all share the **same battery name** to save the design.
- Number of batteries **cannot be reduced in a refit** (only changed/upgraded or increased).

### 4.5 Armor

- Defined per **facing**: Nose, Left, Right, Tail.
- Each facing has **Armor material** and **thickness (points)**.
- More armor → more mass, more resource cost, more survivability.

Refit rules for armor (see §8):

- Armor material can be changed freely.
- Each facing changed adds **5% of hull construction time** to refit duration.

### 4.6 Utility Modules

Utility hardpoints can mount:

- **General utilities** (can be changed/swapped, count for refit time):
  - Labs, Repair Bays, Marines, Laser Engines, Magazines, Colony Kits, Cyclotrons, etc.

- **Unchangeable/one-way utilities** (can **only be added**, not removed; types can’t be swapped once installed):
  - ISRU
  - Remass Scoop
  - Component Armor
  - Salvage Bay
  - Armor Struts
  - Vector Thrusters
  - Flag Bridge

For many classes (especially combat), you’ll devote utility slots to: **ECM, Heat Sinks, Magazines, ISRU/Scoops, extra power/radiators**, etc.

### 4.7 Weapons

Weapons sit on **nose/hull hardpoints** and are divided by type & mount:

- **Mounts:** 1‑Hull, 2‑Hull, 4‑Hull, 1‑Nose, 2‑Nose, 3‑Nose, 4‑Nose.
- **Types:**
  - **Naval Guns** – ballistic.
  - **Lasers** – line-of-sight, instant hit, constrained by heat & power.
  - **Particle Beams** – special armor interactions.
  - **Magnetic Guns** – railguns/coilguns.
  - **Plasma**.
  - **Missiles**.

Specific mechanics (from subsections):

- **Lasers**
  - Affected by **Armor Penetration** and **Range**.
  - Range & damage fall off with distance, depending on aperture and tech.
- **Particle Weapons**
  - Unique interactions with armor (e.g., can bypass/thin certain types more effectively).

Weapons are **fixed in count** per hull: refits can **change the weapon model and relocate mounts** as long as **mount type and weapon type** stay the same (see refits).

---

## 5. Ship Areas & Hit Weights

Ships are divided into broad areas (nose structure, central, tail, systems, armor facings). In combat/repairs:

- Hits land in different areas with different probabilities (hit weights).
- Each area has its own health and **repair rules/cost**.

You don’t manipulate hit weights directly, but they explain why certain facings or systems get damaged more often and why repair costs vary by location.

---

## 6. Construction

- Ships are built at **habs with construction modules**:
  - Space Dock
  - Shipyard
  - Spaceworks
- Resources can be:
  - **Mined in space** (water, volatiles, metals, noble metals, fissiles, exotics, antimatter).
  - **Substituted** by Boost and Money when space resources are lacking.
- After construction, ships appear **docked at the building hab.**

---

## 7. Resupply & Refueling

There are two main approaches: **ISRU** and **Remass Scoops**.

### 7.1 ISRU (In‑Situ Resource Utilization)

- ISRU modules allow ships to refuel from **hab mining output**.
- Refuel Duration (days):

  - `RefuelDuration = FuelNeeded(tons) / DailyOutput(tons)`

- Daily Output is the **base hab site output** (no mining bonuses).
- Requires:
  - Hab with mining output of the needed propellant resources.
  - Refueling ship must have ISRU (or a qualifying drive – see below).

**Drives with built‑in ISRU:**

- Mass Driver
- E‑Beam Drive
- Pulsed Plasmoid Drive
- Superconducting Mass Driver

These can refuel via ISRU behavior **without a separate ISRU module**.

**Parallel refueling:**

- Each ship refuels **independently**.
- Total fleet time is the **max** of individual ship refuel times.

### 7.2 Remass Scoops (Gas Giants)

- Remass Scoop modules can refuel from **gas giant atmospheres** when in **interface orbit** around that planet.
- Works only if:
  - Propellant type is **Anything**, or
  - Propellant type is **Hydrogen** and consists only of **Water and/or Volatiles**.

- Refuel Duration (days):

  - `RefuelDuration = FuelNeeded(tons) / 1000`

- Duration is clamped to a **minimum of 10 days.**
- Refueling is **free** in resources and **parallel** per ship (like ISRU).

---

## 8. Repairs

Repairs happen at habs with **ship construction modules** (Space Dock / Shipyard / Spaceworks).

General formulas (for an individual part or facing):

- Duration and cost scale with **missing health %**, **hull construction time/cost**, **hull tier**, and **module/armor cost.**

Examples:

- **Structures (nose/central/tail):**
  - Duration: `Missing% × HullConstructionTime / 10`
  - Cost: `Missing% × HullConstructionCost / 10`

- **Armor (per facing):**
  - Duration: `Shred% + Chip%`
  - Cost: `(Shred% + Chip% / 4) × ArmorCost`

- **Weapons / Utilities / Radiators / Power / Drive / Battery:**
  - Duration: `Missing% × 2`
  - Cost: `Missing% × ModuleCost / 4`

- **Life support, bridge, couplings, sensors:**
  - Use variants of `Missing% × HullConstructionTier` and fractions of hull cost or resource-specific multipliers.

- **Propellant:**
  - Not “repaired” – destroyed fuel tanks are effectively just **empty** and handled by refueling, not repairs.

**Repair speed modifiers:**

- Divided by **sum of ship construction module tiers** on the hab.
- Reduced further by an **Engineering Officer** assigned to the ship.

---

## 9. Refits

Refits swap or add parts, with durations expressed as a **% of hull construction time**. Rules by category:

- **Hull type:**
  - **Cannot be changed.**

- **Ship Armor (material/thickness):**
  - Can be changed freely.
  - +**5%** construction time per facing (nose, left, right, tail) changed.

- **Power Plant:**
  - Can only swap to another plant of the **same type** (e.g., Solid Core Fission → other Solid Core Fission).
  - Duration: **25%** of hull construction time.

- **Drive:**
  - Can only change to a drive of the **same classification**, **required power plant type**, and **propellant type**.
  - Duration: **25%** if model changes.
  - **0%** if you only change **Thruster Count**.

- **Radiators:**
  - Can be changed freely.
  - Duration: **5%**.

- **Heat Sinks:**
  - Cannot **reduce** number, but can change models or add more.
  - Duration: **5% per changed or added.**

- **Batteries:**
  - Cannot **reduce** number, but can change or add more.
  - Must all be the **same model name** in final design.
  - Duration: **5% per changed or added.**

- **General Utility Modules:**
  - (Mobile Labs, Repair Bays, Marines, Laser Engines, Magazines, Colony Kits, Cyclotrons, etc.)
  - Cannot **reduce** number, but can swap or add more.
  - Duration: **5% per changed or added.**

- **Unchangeable Utility Modules:**
  - ISRU, Remass Scoop, Component Armor, Salvage Bay, Armor Struts, Vector Thrusters, Flag Bridge.
  - Cannot **reduce or interchange**; can only **add** them if they weren’t present.
  - Duration: **5% per added.**

- **Spikers (Muon, Neutronium, Antimatter):**
  - Cannot reduce number; may change or add one.
  - Duration: **5%** if changed/added.

- **Hydrogen Storage:**
  - Liquid Hydrogen Containment, Slush Hydrogen Tankage, Hydron Trap.
  - Cannot reduce number; may change or add one.
  - Duration: **5%** if changed/added.

- **Electronic Countermeasures (ECM):**
  - Cannot reduce number; may change or add one.
  - Duration: **5%** if changed/added.

- **Targeting Computer:**
  - Cannot reduce number; may change or add one.
  - Duration: **5%** if changed/added.

- **Weapons:**
  - Cannot **add or remove weapon mounts**, but can:
    - Move them between valid hardpoints.
    - Change the weapon **model**, as long as **mount type** and **weapon type** stay the same.
  - Duration: **5% per weapon changed.** Moving without changing model is free.

**Total refit duration cap:**

- If summed refit duration exceeds **75%** of hull construction time, it is **capped at 75%**.

---

## 10. Scuttling Ships

- Ships cost MC and money to upkeep. Unwanted ships can be **scuttled**.
- If scuttled at a **ship construction module**:
  - Faction regains **25% of the space resource costs** of the ship (excluding fuel).
  - Refund is always in **space resources**, even if built with Boost/Money.

- If scuttled elsewhere:
  - No resource refund.
  - May need to pay **Boost** to evacuate crew unless the ship is in an **Earth Interface Orbit** (Tiangong, ISS, LEO 1, LEO 2), where evac is free.

- Boost cost to evacuate elsewhere:
  - Equivalent to moving **0.1 tons per crew** from Earth to that location.
  - Cost reduced if crew can move onto other ships in the same fleet (up to 25% more crew per ship than original).

---

This summary is meant to be **TI-agnostic mechanics only**, so you can pair it with your own faction- and tech-specific notes (e.g., which drives/weapons you actually have unlocked in the Again campaign).
