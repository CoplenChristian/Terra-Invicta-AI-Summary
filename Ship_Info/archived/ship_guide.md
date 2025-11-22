```markdown
# Terra Invicta Shipbuilding Reference

*A practical, mechanics-heavy overview of ship design, with emphasis on drives, power plants, hull types, hard-points, and core systems.*

---

## 0. How Ship Design Works (High Level)

You can design ships as soon as you have:

- **Orbital Shipbuilding** tech and a **Space Dock / Shipyard / Spaceworks** on a hab. :contentReference[oaicite:0]{index=0}  
- A design that includes, at minimum:  
  - 1× **Drive**  
  - 1× **Power Plant**  
  - 1× **Radiator**  
  - 1× **Battery**  
  - **Armor material** (thickness can be zero, but the material must be chosen)  
  - ≥1 **Propellant tank**  
  - A **Role** (e.g. Interceptor, Space Superiority, Transport, etc.) :contentReference[oaicite:1]{index=1}  

Everything else (weapons, utility modules, armor thickness, extra batteries, drive enhancers) is optional but usually crucial.

---

## 1. Ship Performance Stats (What Actually Matters)

From the Spaceships page: :contentReference[oaicite:2]{index=2}  

- **Wet Mass**  
  - Total mass when fully fueled.  
  - Higher mass = **worse acceleration, turn rate, and Delta-V**.  

- **Cruise Acceleration** (strategy map)  
  - How fast your fleet changes velocity.  
  - Capped at **2.0 g**. High cruise accel = faster transfers, easier gravity wells.  

- **Combat Acceleration** (tactical battles)  
  - Capped at **4.0 g**. Higher combat accel = better dodging, repositioning, closing/exiting range.  

- **Turn Rate**  
  - Shorter hulls and lower mass turn faster. Long hulls with lots of armor and radiators will feel sluggish.  

- **Heat Sink Capacity**  
  - How long you can fight with **radiators retracted** before overheating.  

- **Battery Capacity**  
  - How long you can fire energy-hungry weapons or keep systems up if the main reactor is damaged/offline.  

- **Construction Cost & Time**  
  - Resources + time to build the ship at a given shipyard. Larger shipyards reduce build time.  

- **Support (MC & Money)**  
  - Mission Control & monthly upkeep. If you can’t pay support, the ship becomes more vulnerable to control changes and rebellion events.  

- **Cruise Delta-V**  
  - The key number for *where you can go*:  
    - ~**4 kps** – intercept + return in the same orbit.  
    - < **8 kps** – unreliable to reach the Moon from Earth orbit.  
    - < **30 kps** – unreliable for interplanetary transfers from Earth.  
    - ~**60 kps** – can do extreme transfers (e.g. Mercury ↔ Saturn) reliably. :contentReference[oaicite:3]{index=3}  

Delta-V rises with **more propellant tanks** and falls with **more mass** (armor, big radiators, heavy reactors, oversized hulls).

---

## 2. Hull Types & Hard-Points

### 2.1 What the Hull Controls

Choosing a hull sets: :contentReference[oaicite:4]{index=4}  

- Number of **Nose hard points** (forward-fixed weapons)  
- Number of **Hull hard points** (turrets)  
- Number of **Utility hard points** (batteries, drive enhancers, ECM, labs, etc.)  
- Hull **length & width** (impacts turn rate and armor volume)  
- **Structural integrity**  
- **Base construction time** & **construction tier (T1/T2/T3)**  
- Maximum **officers**  
- **Mission Control upkeep**  

### 2.2 Hull Table (Human Hulls)

From the Hull table on the wiki: :contentReference[oaicite:5]{index=5}  

| Hull Type     | Nose | Hull | Utility | Max Officers | T1 Time | T2 Time | T3 Time | Armor (T) / point, Nose/Tail | Armor (T) / point, Side | MC | Money Upkeep |
|---------------|------|------|---------|-------------:|--------:|--------:|--------:|------------------------------:|------------------------:|---:|-------------:|
| **Gunship**   | 1    | 1    | 1       | 1            | 60      | 51      | 29      | 79                           | 1571                   | 1  | 1            |
| **Escort**    | 2    | 2    | 1       | 1            | 90      | 77      | 44      | 79                           | 1571                   | 1  | 2            |
| **Corvette**  | 1    | 1    | 2       | 2            | 90      | 77      | 44      | 177                          | 3063                   | 1  | 3            |
| **Frigate**   | 1    | 2    | 4       | 3            | 120     | 102     | 59      | 314                          | 6283                   | 2  | 4            |
| **Monitor**   | 4    | 3    | 3       | 3            | 180     | 120     | 84      | 314                          | 7854                   | 2  | 4            |
| **Destroyer** | 2    | 2    | 3       | 3            | 203     | 135     | 95      | 314                          | 7854                   | 2  | 5            |
| **Cruiser**   | 2    | 3    | 6       | 4            | 270     | 180     | 126     | 314                          | 10996                  | 3  | 10           |
| **Battlecr.** | 3    | 2    | 4       | 4            | 270     | 180     | 126     | 314                          | 10996                  | 3  | 12           |
| **Battleship**| 2    | 6    | 5       | 5            | 450     | 300     | 200     | 491                          | 15708                  | 3  | 15           |
| **Lancer**    | 4    | 3    | 6       | 5            | 540     | 360     | 240     | 804                          | 25133                  | 4  | 20           |
| **Dreadnought**| 3   | 8    | 6       | 5            | 540     | 360     | 240     | 962                          | 30238                  | 4  | 25           |
| **Titan**     | 4    | 6    | 8       | 6            | 608     | 405     | 270     | 962                          | 32987                  | 5  | 30           |

> *Armor (T) / point* is the base tonnage per point; side armor is much heavier than nose/tail on all hulls.

### 2.3 Hull Roles (Practical Use Cases)

- **Gunship** – Tiny, cheap, 1/1/1 slots. Early PD or missile boat, or a disposable patrol craft.  
- **Escort** – 2 nose, 2 hull, 1 utility. Good for early **interceptors** and short-range defenders.  
- **Corvette** – 1 nose, 1 hull, 2 utility. Great starter combat hull: enough utility to carry ECM + extra battery or drive enhancer.  
- **Frigate** – 1 nose, 2 hull, 4 utility. Typical mid-game workhorse: good utility budget and 2 turret slots.  
- **Monitor** – 4 nose, 3 hull, 3 util. Designed to be a **fixed gun platform**; excels as a heavily armored standoff/citadel ship.  
- **Destroyer** – 2 nose, 2 hull, 3 util. Classic **interceptor**/space superiority hull: decent gun count, manageable size.  
- **Cruiser** – 2 nose, 3 hull, 6 util. Flexible line ship; can carry serious defenses plus drive enhancers and extra batteries.  
- **Battlecruiser** – 3 nose, 2 hull, 4 util. More forward firepower, a bit less general-purpose than cruiser.  
- **Battleship** – 2 nose, 6 hull, 5 util. High turret count; ideal for **brawlers** and heavy PD screens.  
- **Lancer** – 4 nose, 3 hull, 6 util. Designed as a **forward-alpha burst** hull. Great candidate for beam/coil nose spam.  
- **Dreadnought** – 3 nose, 8 hull, 6 util. Massive, MC-heavy backbone ships. Great when you’re rich and want monsters.  
- **Titan** – 4 nose, 6 hull, 8 util. The absolute endgame capital; can mount everything but demands huge support.

---

## 3. Ship Roles (AI Behavior + Autodesigner Hints)

Roles mostly influence:

- **Strategic range bias** (how much propellant it wants)  
- **Preferred combat range**  
- Some special module requirements :contentReference[oaicite:6]{index=6}  

| Role                      | Strategic Range | Combat Range | Notes |
|---------------------------|-----------------|-------------|-------|
| **Troop Carrier**         | Long            | Non-combat   | Must carry Marine module |
| **Explorer**              | Long            | Non-combat   | Must carry Prospector module |
| **Inner System Colony**   | Long            | Non-combat   | Must carry Hab Kit |
| **Outer System Colony**   | Long            | Non-combat   | Nuclear Hab Kit |
| **Transport**             | Long            | Non-combat   | Freight / supply ship |
| **Penetrator**            | Long            | Short        | Fast strike, low range engagement |
| **Protector**             | Long            | Short        | Emphasizes point defense |
| **Interdictor**           | Long            | Medium       | Fleet control / interception |
| **Intruder**              | Long            | Long         | Long-range strike platform |
| **Bomber**                | Long            | Long         | Emphasizes bombardment weapons |
| **Strike**                | Medium          | Short        | Mid-range assault ship |
| **Space Superiority**     | Medium          | Medium       | Dogfighter role |
| **Standoff**              | Medium          | Long         | Kiting/artillery behavior |
| **Interceptor**           | Short           | Short        | Max accel, minimal propellant |
| **Patrol**                | Short           | Medium       | Local security ship |
| **Defender**              | Short           | Long         | Hangs back, PD and long guns |

**Design tip:**  
- “Long” range roles will happily accept **lots of tanks and mass** for Delta-V.  
- “Short” range roles want **high acceleration**, fewer tanks, more guns/armor.

---

## 4. Drives & Propellant

### 4.1 Drive Core Mechanics

From the wiki: :contentReference[oaicite:7]{index=7}  

- Drives are defined by:  
  - **Thrust** – determines acceleration and tactical mobility.  
  - **Exhaust Velocity (EV)** – determines Delta-V per unit of propellant (“fuel efficiency”).  
- **Delta-V** comes from adding 100-ton **propellant tanks**.  
- **Thrust and EV together determine required power** from the plant.  
- **Many drives require a particular power-plant class**, and low-tech plants may fail to supply enough power even if they’re “compatible”.  

Propellant rules: :contentReference[oaicite:8]{index=8}  

- Each tank is **100 tons**.  
- No hard cap on tanks, but each tank adds mass → accelerating the ship gets harder, and Delta-V gains have **diminishing returns** (rocket equation).  
- Propellant **resource mix** is drive-specific (e.g. water, hydrogen, fissiles mixtures).  
- If the drive uses **He-3** and you own a **Helium-3 Mine**, fissile cost for propellant is replaced by water.

### 4.2 Drive Categories & Typical Uses (from community analysis)

From community drive charts/guides: :contentReference[oaicite:9]{index=9}  

**Early-game / non-combat oriented:**

- **Chemical / Electrothermal / Electrostatic / Electromagnetic**  
  - Low thrust, low–mid EV.  
  - Not great for combat (can’t hit 1–2 g easily once you armor up).  
  - Fine for **early colony ships or explorers** that don’t need combat accel.

**Fission thermal drives:**

- Powered by **fission reactors** (solid core, molten core).  
- Mid thrust, mid EV.  
- Excellent for **early-to-mid defensive fleets** near Earth or Luna.  
- Example commentary from drive chart thread:  
  - **Advanced Pulsar** – good early/late-early drive with respectable thrust + EV, unlocked via solid-core fission techs.  
  - **Pegasus** – strong mid-game fission thermal, good thrust and EV for defensive fleets.  
  - **Flare/Firestar** – very high thrust, decent EV; ideal for heavily armored defensive ships hitting max 4 g combat accel with ~20–30 kps Delta-V. :contentReference[oaicite:10]{index=10}  

**Fission pulse (Orion-style):**

- **Orion Drive** etc – absurd thrust, solid EV.  
- Great early-mid game **combat** drives; monstrous acceleration.  
- Major drawback: propellant tanks are extremely expensive (metals + fissiles + noble metals). :contentReference[oaicite:11]{index=11}  

**Fusion drives:**

- Require **fusion reactors**; many of the good ones require **Terawatt Fusion Reactors**. :contentReference[oaicite:12]{index=12}  
- Early fusion drives are often mediocre; late ones (e.g. Icarus Torch, Daedalus Torch) have extremely high EV and good thrust.  
- These are your **long-range offensive** drives once tech is high enough.

**Antimatter drives:**

- Insane EV, high thrust on paper.  
- Hard practical limit: **antimatter is extremely rare**, so supporting a whole combat fleet is difficult; works best for a **few special ships** (e.g. single exploration or strike ship), not full line fleets. :contentReference[oaicite:13]{index=13}  

### 4.3 Power Requirement & Waste Heat

From community formula suggestions and wiki: :contentReference[oaicite:14]{index=14}  

- A rough physical relationship: **Required Power ~ Thrust × Exhaust Velocity / 2** (simplified rocket power formula).  
- This power flows through the **power plant**, which has an **efficiency**.  
- Waste heat ≈ `Power × (1 – Efficiency)` (power not converted to kinetic energy becomes heat).  
- Heat must be radiated away:  
  - Drives with **high power use and low efficiency** require **massive radiators** (heavy, fragile, and kill your accel).  
  - Drives with moderate power and high efficiency are easier to cool.

Certain drives are notorious for waste-heat issues (e.g. community comments about Firefly Torch requiring ridiculous radiator mass, making it nearly unusable as a combat drive). :contentReference[oaicite:15]{index=15}  

### 4.4 Open- vs Closed-Cycle Cooling

From the radiator section: :contentReference[oaicite:16]{index=16}  

- **Open-cycle drive**  
  - Radiators only need to dump **crew heat**.  
  - Radiators can be much smaller → less mass, easier to protect.  

- **Closed-cycle drive**  
  - Radiators must dump **crew + power plant** heat.  
  - Radiators become large, heavy, and more vulnerable.  

This is a huge design lever: some “good-looking” drives are quietly awful because they generate so much heat you drown in radiator mass.

### 4.5 Practical Drive Pairing Guidelines

- **Orbit defense / Interceptors**  
  - Target **≥30 mg** cruise accel (0.03 g) on the campaign map and **1–2 g combat accel**.  
  - Use **high-thrust fission thermal/pulse** drives; moderate EV is acceptable.  
  - Aim for **20–30 kps** Delta-V for inner system defense; more is nice but not mandatory. :contentReference[oaicite:17]{index=17}  

- **Interplanetary offensive fleets**  
  - Aim for **≥30 kps**, ideally **40–60 kps** Delta-V.  
  - Fusion drives or very good fission drives (Pegasus, Neutron Flux Torch, etc.).  
  - Accel can be lower (~0.3–0.8 g combat) if you’re fighting in deep space and rely on long-range beams/missiles.

- **Explorers / Colony ships**  
  - Delta-V > **60 kps** is ideal.  
  - Thrust can be very low; they’re not expected to fight.  
  - Cheap, high-EV low-thrust drives (electrostatic, some fusion) are fine.

---

## 5. Power Plants (Reactors)

From the Power Plant section: :contentReference[oaicite:18]{index=18}  

- A power plant must supply:  
  - The **drive’s power requirement**  
  - The power needs of **all other systems** (weapons, life support, etc.)  
- Its **mass scales with the larger** of:
  - Drive power requirement  
  - Systems power requirement  

- The plant generates **waste heat** according to its efficiency; this must be removed by radiators (if closed-cycle) or partially by exhaust (open-cycle).

**Practical implications:**

- Overspec’d drives → massive reactors → huge heat → big radiators → heavy, sluggish ships.  
- Efficient power plants combined with efficient drives allow you to run **lighter cooling** and keep acceleration high.  
- Many drives require a specific **power plant class** (e.g., gas-core fission, fusion, antimatter). If your tech only provides low-tier versions of that class, they may technically “work” but be too heavy or hot to be practical.

---

## 6. Radiators & Heat Sinks

### 6.1 Radiators

From Spaceships > Radiators: :contentReference[oaicite:19]{index=19}  

- Radiators remove waste heat from:  
  - **Power plant / drive** (closed-cycle)  
  - **Crew** (always; 3.75 MW of waste heat per crew member)  
- They are **highly vulnerable**:  
  - If a shot hits while extended, there’s a chance the radiator is **directly destroyed**, regardless of armor.  
- You can **retract radiators** in combat to protect them, but then heat must go somewhere else (heat sinks).

### 6.2 Heat Sinks

From the Heat Sink section: :contentReference[oaicite:20]{index=20}  

- Heat sinks store heat while radiators are retracted.  
- When radiators are: destroyed, retracting, or retracted, **all generated heat is added to sinks**.  
- When radiators are extended and functional, heat sinks lose heat at **0.1 GJ/s × Radiator health %**.  
- If **Heat exceeds Heat Sink Capacity**, you take **Excess Heat Damage**:  
  - `Excess Heat (GJ) × 50` explosion damage straight to the **core** – essentially a self-destruct.

**Design rules of thumb:**

- Combat ships should have **at least one heat sink** if you expect them to close to within enemy weapon range.  
- High-waste-heat drives + high-power beams ⇒ you need either:  
  - Big radiators (then you must manage them carefully in combat), and/or  
  - Massive heat sinks to survive with radiators retracted during peak phases.

---

## 7. Armor & Survivability

From the Armor section: :contentReference[oaicite:21]{index=21}  

### 7.1 Damage Types

Incoming damage is split into:

- **Direct Damage**  
  - Damages internal components.  
- **Chip Damage**  
  - Damages **armor volume** (m³) – effectively “chews away” the armor layer.  
- **Shred Damage**  
  - Damages **armor value** (points) directly; reduces how much direct damage is blocked.

Specials:

- **Particle beams** – only direct damage (no chip/shred).  
- **Nuclear missiles** – also apply shred damage.

### 7.2 Armor Interaction

When armor on a facing is intact:

- **Direct** damage is reduced by armor value:  
  - 1 armor point blocks 1 damage unit (20 MJ).  
- **Chip** damage reduces armor volume; once volume is partially gone, attacks can get **through-armor crits**, where they bypass armor entirely.  
- **Shred** damage permanently reduces armor value; those points no longer block direct damage.

When armor is gone on a facing:

- All **Direct + Chip + Shred** acts as direct damage to internals.

Armor is often the **heaviest** part of the ship. Side armor is far heavier than nose/tail because it covers a much larger area (10–35× heavier per point depending on the hull). :contentReference[oaicite:22]{index=22}  

### 7.3 Armor Formulas (0.4.90)

Key formulas (simplified): :contentReference[oaicite:23]{index=23}  

- Plate Thickness = `20 MJ / Heat of Vaporization / Density / 0.005 m²`  
- Nose/Tail/Side armor thickness = Plate Thickness × armor points for that facing.  
- Volumes computed from hull length/width and thickness;  
- **Armor mass** = Volume × density.

You don’t need to memorize the math; what matters:

- **High-tech armor materials** give more protection for less mass (better heat of vaporization, better density).  
- **Side armor is brutal** – adding even a couple of points can add thousands of tons.

### 7.4 Practical Armor Guidelines

- **Front-line brawlers** (Destroyers, Cruisers, Battleships):  
  - Heavy **nose & side armor**, light tail.  
  - Consider **Component Armor** utility for -25% internal damage. :contentReference[oaicite:24]{index=24}  

- **Kiting / beam ships** (Lancers, Standoff roles):  
  - More nose armor (they face the enemy).  
  - Moderate side armor; rely on range and PD.

- **Non-combatants** (Transports, Colonies):  
  - Minimal armor; maybe a few nose/tail points to avoid one-shot kills by stray missiles.  
  - Save mass for propellant and mission modules.

---

## 8. Utility Modules

From the Utility Modules table: :contentReference[oaicite:25]{index=25}  

### 8.1 General Utility Modules

Some key modules (tons/mass omitted for brevity):

- **Mobile Space Science Lab** – +5% space science research; can prospect bodies from interface orbits.  
- **Repair Bay** – improves mid- and post-combat repairs.  
- **Salvage Bay** – increases salvage yield after winning battles.  
- **Vector Thrusters** – greatly increases turning speed; also a special invulnerable utility module in ship system layout.  
- **Flag Bridge** – reduces fleet Mission Control upkeep (doesn’t stack).  
- **Component Armor** – -25% internal damage taken (invulnerable module).  
- **Armor Strut** – doubles maximum armor capacity per facing.  
- **Marine Assault Units** (Standard / Advanced / Elite / faction variants) – allow Assault Hab operations.  
- **Laser Engine / Advanced Laser Engine** – +laser weapon power.  
- **Cyclotron** – +particle beam power.  
- **Magazine** – +50% projectile ammo.  
- **ECM / ECM Mk II / ECM Mk III** – 20/40/60% chance to force an enemy weapon into cooldown when this ship is targeted.  
- **Targeting Computers I–III** – improve rolls vs ECM and mitigate sensor damage (10/30/50%).

### 8.2 Drive Enhancement Modules

These couple **specific drive types / propellant** with bonuses: :contentReference[oaicite:26]{index=26}  

- **Muon Spiker** – requires **Fusion Drive**, +10% thrust.  
- **Neutronium Spiker** – requires **Fission Drive**, +20% thrust.  
- **Antimatter Spiker** – requires **Nuclear Drive**, +30% thrust (fusion or antimatter).  
- **Liquid Hydrogen Containment** – drive using **Hydrogen**; +20% Exhaust Velocity.  
- **Slush Hydrogen Tankage** – Hydrogen drive; +35% EV.  
- **Hydron Trap** – Hydrogen drive; +50% EV.  
- **ISRU Module** – allows refueling at unimproved habs producing relevant propellant materials.  
- **Remass Scoop** – allows refueling in Jovian interface orbits for hydrogen-based propellant; also prevents aerobraking damage (currently unused).

So in terms of “what drives go with what sources / enhancers”:

- **Fusion drives** → Muon Spiker.  
- **Fission drives** → Neutronium Spiker.  
- **Antimatter / late fusion** → Antimatter Spiker.  
- Any **Hydrogen propellant drive** (fusion, advanced fission, some ion) → Hydrogen containment / slush / hydron trap.

### 8.3 Heat Sink Modules

Covered earlier, but they’re technically utilities as well. You choose different **heat sink sizes** based on how long you need to fight with radiators retracted. :contentReference[oaicite:27]{index=27}  

---

## 9. Batteries & Power Budget

From the Battery section: :contentReference[oaicite:28]{index=28}  

- The **primary battery** stores energy from the power plant.  
- It powers weapons, life support, and key systems when:  
  - The power plant is damaged/offline, or  
  - The drive is using all available power and weapons need extra.  
- High-power weapons / big beams drain the battery quickly.  
- Advanced batteries have larger capacity and faster recharge.  
- You can add **extra batteries in utility slots**.

**Design tips:**

- Beam-heavy ships (lasers/particle beams) should almost always pack **extra batteries**.  
- Missiles/kinetics can get away with smaller battery, more magazines/ECM instead.  
- Remember that battery capacity is also tied to survivability: a ship with a crippled power plant fights off its battery until it’s empty.

---

## 10. Ship Systems & Hit Weights (Why Internals Matter)

From Ship Systems and Hit Weights table: :contentReference[oaicite:29]{index=29}  

A ship is divided into **areas** (Nose, Left, Right, Tail, Core). When a hit lands on one area, a system in that area is chosen to take damage based on **hit weight**.

Key internal systems:

- **Nose/Central/Tail Structure** – structural integrity; if **all three are destroyed**, the ship explodes.  
- **Bridge** – allows setting waypoints; if destroyed, you lose navigation.  
- **Fire Control** – enables weapons; damaged fire control reduces targeting effectiveness.  
- **Power Coupling** – affects **battery charge rate**.  
- **Drive Coupling** – affects **drive thrust**.  
- **Vector Thrusters** – affect **angular acceleration** (turning).  
- **Life Support (main/backup)** – doesn’t matter in combat, but obviously vital strategically.  
- **Damage Control** – controls mid-combat repair speed.  
- **Propellant tanks** – if destroyed, reduce remaining fuel.  
- **Sensors** – influence targeting bonus.  
- **Radiators** – allow heat vent; health modifies sink cooling rate.  
- **Power Plant** – central to rotation, thrust, recharge; takes heavy hit-weights in side/core.  
- **Drive** – thrusters; damage directly lowers thrust.  
- **Battery** – damage reduces energy capacity.

Utility modules, nose/hull weapons, etc., are also separate systems that can be hit and destroyed.

**Implication:**  
- **Component Armor** (-25% internal damage) is extremely strong because many hits land on vital internal systems.  
- Vector Thrusters + intact thrusters + damage control give you a much better chance to stay maneuverable and functional after being shot up.

---

## 11. Hard-points & Weapon Philosophy

From an additional reddit guide: nose weapons can only fire **forward**, hull weapons can aim in **any direction**. :contentReference[oaicite:30]{index=30}  

- **Nose hard-points**  
  - Best for **forward-alpha** weapons: spinal lasers, plasma cannons, heavy coils.  
  - Ships that rely on nose weapons need good **turn rate** to keep target in arc.

- **Hull hard-points**  
  - Turrets; excellent for **PD**, flak, and general broadside weapons.  
  - More forgiving of maneuver mistakes; they can track targets across arcs.

- **Utility slots**  
  - Don’t ignore these. ECM, targeting, magazines, component armor, vector thrusters, batteries, and drive enhancers often decide fights more than one extra gun.

---

## 12. Example Design Patterns

Not strict blueprints, but patterns you can apply.

### 12.1 Early-Game Earth Orbit Defender (Corvette / Escort)

- **Hull:** Corvette (1/1/2) or Escort (2/2/1).  
- **Role:** Interceptor / Defender (short strategic range).  
- **Drive:** Solid-core fission thermal or strong chemical/electrothermal drive.  
- **Targets:** ~8–15 kps Delta-V, ≥1 g combat accel after armor.  
- **Power Plant:** Matching early fission reactor; keep waste heat manageable.  
- **Weapons:**  
  - Nose: missile or light coil/rail.  
  - Hull: PD turret + additional kinetic/laser.  
- **Utility:**  
  - 1× Heat Sink  
  - 1× ECM or Vector Thrusters (for Corvettes), or extra battery if beam-based.  

Goal: Cheap, quick-build defenders with enough accel to intercept threats in Earth orbit and shoot down early Alien/AI ships.

### 12.2 Mid-Game Interceptor Destroyer (Advanced Fission Thermal)

Based on community praise for Advanced Pulsar / Pegasus / Flare drives. :contentReference[oaicite:31]{index=31}  

- **Hull:** Destroyer (2/2/3) or Frigate (1/2/4).  
- **Role:** Space Superiority / Interceptor.  
- **Drive:** Advanced Pulsar or similar fission-thermal drive.  
  - Aim for **~20–30 kps** Delta-V with **1–1.5 g** combat acceleration.  
- **Power Plant:** Molten-core or better reactor that can supply drive + weapons.  
- **Weapons:**  
  - Mix of **rail/coil guns** and missiles.  
  - PD in at least one hull slot.  
- **Armor:**  
  - Moderate nose/side armor for surviving beam hits.  
- **Utility:**  
  - Heat Sink  
  - Magazine (for rails/missiles)  
  - ECM or Targeting Computer  

Goal: Fleet backbone in the inner system; can sprint from Earth to Luna, intercept, and still fight hard.

### 12.3 Long-Range Fusion Cruiser (Offensive Fleet)

- **Hull:** Cruiser or Lancer.  
- **Role:** Standoff / Intruder / Bomber.  
- **Drive:** Good fusion drive (later tech if possible); aim for **40–60 kps** Delta-V.  
- **Power Plant:** Mid/late fusion plant; watch efficiency to keep radiator mass manageable.  
- **Weapons:**  
  - Nose: mid- to long-range beams or plasma.  
  - Hull: PD and supporting guns.  
- **Armor:**  
  - Lighter than local defenders; rely on range, heat sinks, and ECM.  
- **Utility:**  
  - 2× Batteries  
  - Heat Sinks  
  - Laser Engine / Cyclotron (if heavy beam ship)  
  - ECM + Targeting  

Goal: Strike fleets that can operate from Earth/Luna to the asteroid belt or further, maintaining strong combat capability.

### 12.4 Non-Combat Colony/Transport

- **Hull:** Gunship/Corvette/Frigate depending on cargo modules.  
- **Role:** Explorer / Transport / Colony ship.  
- **Drive:** High-EV, low-thrust drive (electrostatic, weak fusion, etc.).  
- **Power Plant:** Just enough to run drive + life support.  
- **Armor:** Minimal.  
- **Utility:**  
  - Prospector / Hab Kit / Nuclear Hab Kit  
  - ISRU / Remass Scoop if propellant chain supports it.  

Goal: Cheap, long-range logistics and colonization platforms without tying up your best drives.

---

## 13. Checklist for Designing Any Ship

1. **Pick a mission and role**  
   - Inner defense? Long-range strike? Colony?  

2. **Choose hull**  
   - Enough nose/hull/utility slots for the mission.  
   - MC budget and build time within your limits.

3. **Select drive category**  
   - Defense: fission thermal/pulse.  
   - Long-range offense: fusion (eventually antimatter).  

4. **Match a power plant**  
   - Must satisfy drive + system power.  
   - Watch efficiency and waste heat.  

5. **Size propellant tanks**  
   - Hit Delta-V thresholds for your mission (8, 30, 60 kps benchmarks).  

6. **Add radiators and heat sinks**  
   - Ensure you can fight for long enough with radiators retracted, and cool down between engagements.  

7. **Armor**  
   - Nose/side armor based on likely engagement ranges.  
   - Keep an eye on mass – side armor is expensive.  

8. **Weapons & utility modules**  
   - Balance nose turrets vs hull turrets based on desired engagement style.  
   - Always budget some utility for **ECM, batteries, and heat sinks** on serious combat hulls.  

9. **Check performance**  
   - Acceleration (cruise + combat), turn rate, Delta-V, heat sink capacity.  
   - If accel is low and radiators are huge, consider a more efficient drive or lighter armor.

---

This should be everything you need to treat the ship designer like a proper “engineering sandbox” instead of a black box. If you want, I can next build a **drive-by-drive tier list** in Markdown (organized by tech era and mission type) or a **hull-specific cookbook** (e.g. “5 best loadouts for Destroyers and why”).  
```
