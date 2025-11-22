# **Terra Invicta – The Current Meta (0.478+)**

### *Ship Design, Weapons, Drives & Tech Strategy for AI-Assisted Build Recommendations*

This guide consolidates the **actual community meta** from top posts, Graveless’ drive analysis, the “Lasers Demystified (0.478)” thread, the “ship_loadouts” discussion, and multiple expert doctrine writeups.

It is a **single, opinionated file** meant for guiding:

* automated ship design
* validating user ship builds
* AI-assisted fleet composition
* strategic tech recommendations

It avoids “mechanics explanation” and instead captures what **strong players actually do**.

---

# **1. Fundamental Design Heuristics (Meta “Laws”)**

These rules appear in nearly every top-tier design.

## **1.1 Fuel Fraction (Critical Rule)**

This is the first and harshest pass/fail filter.

* **Ideal:** Fuel mass ≤ **30%** of wet mass
* **Acceptable:** ≤ **50%**
* **Bad:** >50% → warn: *“Over-fueled: performance degraded.”*

**AI rule:**
If fuel fraction >0.5, suggest:

* stronger drive
* lighter armor
* fewer utilities
* smaller hull

---

## **1.2 Minimum Acceleration & Delta-V Targets**

These numbers are from Graveless’ meta analyses and community consensus.

### **Orbital / Inner-System Defense Ships**

* **Ideal:**

  * Cruise thrust: **>30 mg**
  * Δv: **>8 kps**
  * Fuel fraction ≤30%

* **Functional minimum:**

  * Cruise thrust: **>12 mg**
  * Δv: **>4 kps**
  * Fuel fraction ≤50%

### **Deep Offensive Fleets (Asteroids, Jupiter, Beyond)**

* Δv ≥ **50 kps** (minimum for proper transfer control)
* Diminishing returns around **150 kps**
* Prioritize **efficiency** over thrust as long as thrust stays “usable.”

---

## **1.3 Armor Allocation (The Most Common Newbie Trap)**

* Early game:

  * **Frontal armor modest**, sides = **1–2**, rear = 1
* Mid-to-late beam brawlers:

  * **60–80 nose armor**
  * Side armor = **1–2**
  * Rear = 1–2

**Reason:**
High-end beams and Arc Lasers reward nose-on dueling.
Side armor >3 is nearly always wasted mass.

---

## **1.4 Hull Size Meta**

* **Destroyers / Monitors** = best early hulls
  Cheap, excellent stat-density, missile/kinetic friendly.

* **Cruisers / Battlecruisers** = mid/late-game hulls
  Only good once you have:

  * Nanotube → Adamantine armor
  * Nanotube radiators
  * Burner → Orion drives

* **Early capitals** = trap
  They become immobile bricks until advanced fission.

---

## **1.5 PD Baseline (Mandatory Meta Rule)**

Every serious combat ship must have:

* **1× 40mm PD** minimum
* **+ 1× Ion PD** when possible
* Late game:

  * **Phaser PD + Laser Engine** = best PD in entire game

The combination of **40mm (kinetic)** + **Ion (missile)** covers nearly every threat before exotic tech.

---

# **2. The Drive Meta (By Era & Role)**

## **2.1 Early–Mid (Solid Core Era)**

### **Key Tech Goals**

* Missiles + Targeting Computer Mk1
* Compact Solid Core Reactor II
* Nanotube Radiator (skip early radiators)

### **Early Meta Drives**

* **Fission Frag Drive**

  * Best long-range early offensive drive
  * Jupiter rush option
* **Grid Drive / Bad Ion family**

  * Good Δv for early raids
* **Molten Core / Fission Spinner**

  * Good thrust, inefficient
  * Only for very early wars or rush plays

---

## **2.2 Mid-Game War Era (2028–2031)**

### **Standard Aggressive Tech Route**

1. **Nanotube Radiator**
2. **Nanotube Armor**
3. **Burner Drive**
4. **Orion Drive**
5. **Adamantine Armor**

This enables the classic **missile destroyer + BC beam line** doctrine.

Burner is thirsty but powerful.
**Orion** becomes the first truly “all-role” drive.

---

## **2.3 Late Game (Fusion / Antimatter)**

### **Meta Favorite:**

## **Advanced Antimatter Plasma Core Drive**

Why everyone uses it:

* Excellent combined thrust + ISP
* Low waste heat
* Uses mostly **water**
* Works perfectly with:

  * Hydron Trap
  * AM Spiker

This is the default BIS drive for:

* Endgame carriers
* Beam battlecruisers
* Long-range hunter-killer fleets

---

## **2.4 Drives by Ship Role**

### **Missile Escort / DD**

* **Ideal:**

  * Advanced Pulsar
  * Advanced Cavity
  * Burner
  * Orion
* **Functional:**

  * Pulsar
  * NERVA line
  * Pebble
  * Molten Core
  * Gas Core → always inefficient

### **Missile Monitor (heavy DD/monitor)**

* **Ideal:** Orion, Advanced Cavity
* **Functional-slow:** Advanced Pulsar, Burner
* **Long-range:** Helicon (best)
* **Functional LR:** Fission Frag, Lorentz

### **Beam Battlecruiser**

* **Ideal:** Orion
* **Functional:** Advanced Cavity
* **Offensive LR:** Helicon
* Only Orion hits true inner-orbit “ideal” acceleration thresholds.

---

# **3. Weapon Meta (Lasers, Kinetics, Missiles)**

# **3.1 Missiles (Earliest Anti-Alien Doctrine)**

At literal game start vs alien ships, missiles / torpedoes (especially Artemis) are effectively the only practical way to kill alien fleets without huge tech rushing. They are your **bootstrap doctrine**, not a forever plan.

Missiles perform well in the first 1–3 serious alien fights or early LEO defense when supported by:

* Targeting Computer Mk1
* Enough PD to survive
* Good drives to maintain standoff range

Used this way, you can win many of the first engagements without taking armor damage, but their relative power declines quickly once:

* Alien PD and ship stats improve
* You unlock solid PD (40mm + Ion)
* You field Green / UV Arc lasers and Railgun Mk3+ fleets

Plan to transition into mixed **kinetic + laser** doctrines as soon as tech and industry allow.

---

# **3.2 Kinetics (Railguns / Coilguns)**

### **The “More Lead, Fewer Lasers” Doctrine**

Railguns & coilguns remain extremely competitive because:

* No radiator tax
* Excellent armor penetration
* Broadside firing arcs
* Effective vs large beam ships

Meta usage:

* Put kinetics on **side mounts**
* Build “broadside slugger” cruisers
* Pair with PD escorts

They scale *into late game* when beams struggle vs 70+ armor.

---

# **3.3 Laser Meta (From “Lasers Demystified 0.478”)**

### **3.3.1 What Makes Lasers Good**

* Perfect accuracy
* Ideal for killing alien destroyers/frigates
* High sustained DPS with proper cooling
* Amazing nose weapons

### **3.3.2 What Makes Lasers Bad**

* Require massive radiator investment
* Weak vs thick armor
* Short burst durations without heat sinks
* Short-range arcs are angle-dependent

---

## **3.3.3 Meta Laser Progression**

1. IR → skip
2. Green Laser → skip when possible
3. **Green Arc Laser** (first strong beam)
4. **UV Laser**
5. **UV Arc Laser (mid-game meta standard)**
6. Particle Beams (late-game brawlers)
7. Exotic Lasers (AM era)

UV Arcs are the universal mid/late-game nose weapon until exotic beams.

---

## **3.3.4 Beam Nose-Brawlers**

Characteristics:

* UV Arc or Particle Beam
* Turn rate prioritized
* 60–80 nose armor
* Orion/Helicon/AM drives
* Large radiator footprint

This is the mid/late-game answer to alien beam platforms.

---

## **3.3.5 PD Meta (Updated)**

* Early: 40mm + Ion PD
* Mid: 40mm + Ion PD (still dominant)
* Late: **Phaser PD + Laser Engine**

  * Best tracking
  * High accuracy
  * Beats alien missile spam and late-game kinetics

---

# **4. Meta Ship Archetypes & Doctrines**

## **4.1 Early & Mid-Game Archetypes**

### **(A) Missile Kiter Destroyer**

* 2–3 missile bays
* High Δv (10+kps)
* Some PD
* Nanotube radiator
* Uses Burner or Pulsar
* Great attrition ship

**Role:**
Pick off alien DDs and pull them apart.

---

### **(B) Broadside Rail/Coil Cruiser**

* 2–4 side-mount kinetics
* Thick frontal armor
* Dedicated PD escorts required
* Minimal radiator dependency

**Role:**
Kill alien beam BCs and stations.

---

### **(C) Heavy PD Escort (Sloop)**

* 2–3 PD modules
* Ion PD or late-game Phaser PD
* High acceleration
* Cheap and disposable

**Role:**
Protect line ships from alien missile swarms.

---

## **4.2 Mid-Late Game Archetypes**

### **(D) Beam Battlecruiser (“Nose-Brawler”)**

* 1 × UV Arc or Particle Beam on nose
* 40mm + Ion PD or Phaser PD
* Orion or Helicon drive
* 60–80 nose armor
* Laser engines (PD synergy)
* Nanotube → Adamantine armor

**Role:**
Delete alien destroyers/frigates instantly.
Win beam duels nose-on.

---

### **(E) Missile Monitor (Long-Range Fire Support)**

* 3 missile bays
* 1 × 40mm PD
* 2 mags
* 30/1/1 armor
* Orion or Advanced Cavity

**Role:**
High-alpha strike ships. Best naval weight-to-firepower ratio.

---

### **(F) Endgame Fusion/AM Lance Cruiser**

* Advanced AM Plasma Core drive
* Exotic beams / particle lances
* Phaser PD
* Water propellant economy

**Role:**
Go anywhere, kill anything.

---

# **5. Tech Strategy Meta**

## **5.1 Universal Early Priorities**

* Missiles
* Targeting Computer Mk1
* Solid Core → Compact Solid Core II
* Nanotube Radiator (skip early radiators)
* Composite Armor → Nanotube Armor

---

## **5.2 Offensive Rush Path (Fast War)**

For wars started before 2027:

* Molten Core
* Fission Spinner
* Composite Armor
* Early missiles
* Orion ASAP

---

## **5.3 Standard Aggressive War Path (2028–2031)**

1. Nanotube Radiator
2. Nanotube Armor
3. Burner Drive
4. Orion Drive
5. Adamantine Armor
6. UV Laser → UV Arc

This unlocks the classic **beam + missile mixed doctrine**.

---

## **5.4 Late Game Tech Path**

* Advanced Fusion
* Antimatter
* Advanced AM Plasma Core drive
* Particle Lances
* Phaser PD + Laser Engine
* Hydron Trap + Spiker

This is the “best-in-slot” endgame fleet.

---

# **6. AI-Usable Rules Summary**

### **Fuel**

* Ideal ≤30%, max 50%.

### **Defense Ship Thresholds**

* Ideal: thrust >30 mg, Δv >8 kps
* Minimum: thrust >12 mg, Δv >4 kps

### **Offensive Fleet Thresholds**

* Δv ≥50 kps (usable)
* Prefer Orion / Helicon / AM Plasma Core

### **Hull Selection**

* Early = destroyer/monitor
* Avoid early capitals
* Mid/Late = cruiser/BC

### **Armor**

* Sides = 1–2
* Late beams = 60–80 nose

### **PD**

* Minimum 40mm
* Add Ion PD
* Late: Phaser PD + Laser Engine

### **Drive Progression**

* Early: Fission Frag / Grid
* Mid: Burner → Orion
* Late: AM Plasma Core

### **Weapon Heuristics**

* Early: missiles
* Mid: missiles + kinetics
* Mid/Late: UV Arc nose + kinetics broadsides
* Late: particle beams + phaser PD

### **Design Workflow**

1. Weapons
2. Utilities
3. Armor
4. Choose drive to hit accel/Δv targets
5. Add fuel last, maintain ≤50%

---

# **7. Meta Summary (One Screen)**

* **Missiles/torpedoes are the default earliest anti-alien doctrine; treat them as a bootstrap strategy, not a forever plan.**
* **UV Arc Lasers rule mid/late until exotic beams.**
* **Railgun/coilgun broadsides are always relevant.**
* **PD requirement: 40mm + Ion early, Phaser PD late.**
* **Orion drives anchor mid-game fleets.**
* **Advanced AM Plasma Core anchors endgame fleets.**
* **Nose-brawlers with 60–80 armor dominate beam duels.**
* **Destroyers/Monitors are the early meta standard.**
* **Broadside cruisers kill beam platforms.**
* **Fuel fraction >50% = rebuild the ship.**

---

# **8. Mid-Game Hybrid Doctrine (2028 Resistance – Rails + Lasers)**

This section encodes a concrete mid-game doctrine for a **2028–2031 Resistance campaign** that has already pivoted off pure missiles into **railgun + laser hybrid fleets**.

## **8.1 No More Mono-Fleet (Role Specialization)**

Once you leave the earliest missile era, do **not** run a single "jack-of-all-trades" fleet.

* **AI rule – fleet design:**
  * Enforce **specialized ship roles**, not generalists.
  * For each combat fleet, classify ships as:
    * **Big-Ship Killers (Kinetics / Siege)** – optimized to kill cruisers, battleships, dreadnoughts, stations.
    * **Small-Ship Killers (Lasers)** – optimized to kill corvettes, monitors, destroyers, PD.
* **AI anti-pattern:**
  * Flag fleets where every ship is running the same mixed loadout as *"mono-fleet – under-specialized"*.

## **8.2 Roles: Rails Kill Big Ships, Lasers Clean the Trash**

Treat kinetics and lasers as a **combo**, not competitors.

* **Rails (Big-Ship Killers):**
  * Primary guns on **cruisers / battlecruisers**.
  * Focus on **Heavy Siege Coilers** (see 8.3).
  * Goal: **delete capitals and stations** once enemy PD/weapons are suppressed.
* **Lasers (Small-Ship Killers / Systems Killers):**
  * Nose or spine mounts on **fast beam ships**.
  * Goal: **strip PD, pop light hulls, snipe weapons, peel armor**, create openings for rails.
* **AI doctrine rule:**
  * Prefer fleets where **laser ships join first volley** to kill PD and weapons, then **rail ships broadside**.
  * Penalize designs where fleets rely **only** on rails or **only** on lasers in the 2028–2035 window.

## **8.3 Mid-Game Power Spike: Tin Droplets + Terawatt Gas Core Fission**

This is the practical "you are now in real mid-game" breakpoint.

* **Key tech pair:**
  * **Tin Droplet Radiators**
  * **Terawatt Gas Core Fission** (or equivalent gas-core tier)
* **Why it matters:**
  * Fixes **heat** constraints → longer laser uptime, fewer radiator compromises.
  * Fixes **power** constraints → supports heavy rails + strong PD + utilities.
  * Makes **large-hull builds actually viable** without crippling accel/Δv.
* **AI tech rule:**
  * If this pair is **not** researched by ~2030 and wars are active, **increase its research priority**.
  * Once available, **unlock heavier beam/rail battlecruisers** in the design space and allow more radiator budget.

## **8.4 Heavy Siege Coiler Mk2 = Mid-Game Big-Ship Gun of Choice**

In the mid-game, treat **Heavy Siege Coiler Mk2** as the default heavy kinetic for killing capitals and stations.

* **AI weapon preference:**
  * When designing **battleship/cruiser killers**, prefer **Heavy Siege Coiler Mk2** over:
    * Earlier railguns/coilguns.
    * Exotic/alien kinetics (not required at this stage).
  * Mk3 is **nice-to-have**, not required.
* **Design notes:**
  * Accept **burst damage** with good magazines and cooling.
  * Stack enough **broadside mounts** that, once PD is gone, targets evaporate in 1–2 salvos.

## **8.5 Mid-Game Fleet Template: 10-Ship Hybrid Group**

Use a compact, specialized fleet composition instead of oversized blobs. For a standard mid-game offensive fleet (around **10 ships total**):

* **2–4 Kinetic Siege Ships**
  * Cruisers/BCs with **Heavy Siege Coilers** and strong nose armor.
  * Minimal lasers aside from PD.
* **2–3 Laser Ships**
  * Fast beam ships with **UV / UV Arc** or equivalent mid-game lasers.
  * Built to **disarm, de-PD, and kill light hulls**.
* **1–2 PD Battleships / Escorts**
  * Heavy PD suites (40mm + Ion; later Phaser PD).
  * Objective: keep siege and laser hulls alive against missiles and kinetics.
* **1–2 Missile / Torpedo Boats**
  * Provide **alpha strike** and finishing tools for fleeing or crippled targets.

**AI fleet checklist (2028–2035):**

* Reject fleets where **>70% of ships share the same primary weapon type** as *"mono-fleet"*.
* Prefer compositions matching the above **2–4 / 2–3 / 1–2 / 1–2** role ratios.
* Ensure fleets always have **both:**
  * At least **2 true big-ship killers** (siege kinetics).
  * At least **2 true small-ship / PD killers** (lasers).
