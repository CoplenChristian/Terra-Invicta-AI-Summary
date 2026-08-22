# Terra Invicta Again – Summary Generation Prompts

This file contains reusable prompt templates for generating **heavy, tailored strategic summaries** for the *Again* campaign using `export_factions.ps1` and `ti_data_tools.ps1`.

---

## Prompt 1 – Generate a New Dated Summary

Use this when you want to create a brand new `summary_YYYYMMDD.md` file based on the latest exports.

```text
You are generating a new dated Terra Invicta campaign summary for the Again run.

Context:
- Root: `<RootPath>` from `config.json` (loaded into `TIConfig.RootPath` in `ti_data_tools.ps1`)
- Latest exports: CSVs under `TIConfig.ExportFolder` (from `CsvSubDir` in `config.json`)
- Template: `Again_Save/summary.md` under the root
- Use `ti_data_tools.ps1` and `TI_DATA_TOOLS.md` exactly as documented.

Steps you MUST follow:
1. Run export_factions.ps1 if needed, then dot-source ti_data_tools.ps1.
   - Capture the `gameTimeString` printed by export_factions.ps1 (in-game date/time).
   - **ABSOLUTELY DO NOT use today's real-world date.** Read `csv/Again_Metadata.csv` and take `GameDateYYYYMMDD` as the date for filenames/headers (e.g., summary_YYYYMMDD.md). If `GameDateYYYYMMDD` is missing, stop and ask for a fresh export.
   - Command reminder: `(Import-Csv csv/Again_Metadata.csv)[0].GameDateYYYYMMDD`
2. Generate the snippet pack:
   Get-TISnippetPackMarkdown
   Use those tables as your primary data source.
3. For each of the 12 required sections in Again_Save/summary.md:
   - Pull the relevant data from the snippet pack / toolbox.
   - Then write a DETAILED, tailored strategic analysis under that heading, obeying:
     - The AI instruction block under that section.
     - The "Specificity & Call-Out Requirements" in summary.md
       (named nations/factions/habs/sites/techs + numeric references).
4. You MUST NOT simply paste the snippet pack. Every section must contain:
   - At least 3 concrete call-outs to specific nations, factions, habs, sites, fleets, or techs,
   - AND the associated numbers (CPs, GDP, BoostIncomeEstimate, MetalsPerDay, etc.),
   - PLUS narrative: what it means, why it matters, and what to do.

Target:
- Produce a new file `Again_Save/summary/summary_YYYYMMDD.md` modelled on the most recent dated summary file in `Again_Save/summary/`:
  same 12-section structure, but with current data and heavy, opinionated strategy.
```

---

## Prompt 2 – Update for a New Date (with Deltas)

Use this when you already have a previous dated summary and want a new one that explicitly calls out changes.

```text
Update the Terra Invicta Again campaign summary for a NEW date.

Use:
- Again_Save/summary.md as the template and instructions.
- The latest Again_*.csv in Again_Save and ti_data_tools.ps1 for data.
- Again_Save/summary_jan012024.md as an example of the desired depth and style.

Requirements:
- Generate a new `Again_Save/summary/summary_YYYYMMDD.md`.
- For each of the 12 sections:
  - Use toolbox outputs (snippet pack, space sitrep, boost summary, nations, councilors).
  - Follow the section's AI instruction block and the global "Specificity & Call-Out Requirements".
  - Compare against the previous dated summary where appropriate and call out DELTAS
    (changes in CPs, GDP, BoostIncomeEstimate, habs, techs, fleets).

Do not stop at compiling tables. The final file must be a heavy, tailored strategic report with explicit recommendations and named entities across Earth and the whole Solar System.
```

---

## Prompt 3 – Mandatory Ship-Design Files & Rules

Use this when instructing an AI to design or evaluate Terra Invicta ships so it always loads and obeys the canonical ship-design files.

```text
### 🔧 Updated Terra Invicta Ship Design Prompt

You are designing a **Terra Invicta** ship.

**Data Setup:**
Before starting, ensure the unlocked component list is up to date by running:
`powershell -ExecutionPolicy Bypass -File .\Get-UnlockedShipComponents.ps1`

Use the snippet pack with the **latest date** to detect what research the Resistance has already unlocked and decide which components are available.

The following four files contain rules, data, and formulas you MUST use for every Terra Invicta ship design or evaluation:

* `current_meta.md` 
* `math.md` 
* `ship_components_tables.md` 
* `ship_design_guide.md`
* `utility_modules.md`

These files are not optional. They define REQUIRED behavior.
Treat them exactly like hard system instructions. Follow them completely and literally.

> **Note**: `math.md` is comprehensive. For efficiency, read sections conditionally based on your specific task. See `ship_design_guide.md` §0 "Conditional Reading for math.md" for guidance on which sections are always required vs. task-specific.

---

### 🎯 Mission

The purpose of this ship is:

> **Defend Mars orbit**, to protect surface bases and the Mars LEO station/shipyard.

---

### 🤖 AI Design Rules (STRICT DOCTRINE)

You must follow these rules to avoid common design pitfalls. Violating them is a failure.

1.  **Enforce Archetypes**:
    *   Do **not** design generic "good stats" ships.
    *   You MUST select a specific **Archetype** from `current_meta.md` (e.g., "Missile Monitor", "Beam Battlecruiser") that fits the mission.
    *   State the chosen archetype clearly at the start.

2.  **PD Baseline (The "40mm + Ion" Rule)**:
    *   "Ion PD" means a dedicated **Point Defense** module (e.g., `PointDefenseIonBattery`), NOT a main offensive Ion Cannon.
    *   Every combat ship must have at least 1x 40mm Autocannon AND 1x Ion PD (if slots allow).

3.  **Design Workflow (Order of Operations)**:
    *   **Step 1**: Select Weapons & Role (Archetype).
    *   **Step 2**: Select Utilities (Magazines, ECM, etc.).
    *   **Step 3**: Select Armor (Material & Thickness).
    *   **Step 4**: Select Drive & Fuel to meet Accel/Delta-V targets.
    *   *Do not pick a drive first and then squeeze weapons in.*

4.  **Fuel & Drive Logic**:
    *   **Fuel Fraction**: Must be ≤ 50%. If > 50%, the design is invalid; reduce fuel or change drive.
    *   **Drive Selection**: Use the drive recommended for the Archetype in `current_meta.md` (e.g., Orion for Monitors, Burner for early DDs).

5.  **Calculation Rigor (NO LAZY UNKNOWNS)**:
    *   You **MUST** compute all derived stats (Armor Mass, Delta-V, Accel, Power Margin).
    *   **Never** write `UNKNOWN` just because you didn't finish the math.
    *   `UNKNOWN` is **only** permitted if a specific input value (e.g., a component's base mass) is completely missing from the provided files.

6.  **Tech-Adaptive Hull Selection**:
    *   Check for the **"Mid-Game Power Spike"** (Tin Droplet Radiator + Terawatt Gas Core/Orion Drive).
    *   If these are unlocked, **prefer Cruiser/Battlecruiser archetypes** (e.g., Beam BC) over early-game hulls (Monitor/DD), as heavier hulls become viable and superior.

---

### 📚 Design obligations (MANDATORY)

When producing a ship design, you must use the following files **conditionally based on your specific task**:

1. **Use the rules in `current_meta.md`** (ALWAYS)

   * Meta heuristics
   * Fuel fraction limits
   * Accel / Δv thresholds
   * Armor allocation meta
   * PD / weapon / hull meta

2. **Use the equations in `math.md`** (SELECTIVELY - see conditional reading guide)

   * **ALWAYS**: §1 Mass, §2 Acceleration, §4 Delta-V
   * **IF weapons**: §5A Weapon Damage & Power
   * **IF armor**: §1.2 Armor Mass calculations
   * **IF heat/power optimization**: §3 Power Plant Interaction, §5 Heat & Radiators
   * See `ship_design_guide.md` §0 for complete guidance

3. **Use ONLY components listed in `ship_components_tables.md`** OR the filtered CSV

   * **CRITICAL TECH CHECK**: Verify the specific **Faction Project** (e.g., `Project_SolidCoreFissionReactorI`) is unlocked in the snippet pack. **Do not** assume a component is available just because the parent Global Tech is done.
   * Mass & Power: Read table columns carefully. `Mass (t/GW)` is often present for reactors/radiators.
   * Thrust, Exhaust velocity, Efficiency, Propellant type.

4. **Follow the design procedure and output structure defined in `ship_design_guide.md`**
   Including explicitly listing:

   * Exact **drive model + count**
   * Exact **propellant tank model + count**
   * Armor material + exact **front / sides / rear** thickness
   * Exact **weapons per hardpoint**
   * Exact **utilities per slot**
     * **Batteries**: Select exactly **ONE** battery module (unless hull forces multiple utility slots and you have space). Do not stack multiple battery types.
     * **Radiators**: Select exactly **ONE** radiator type. Do not mix radiator types (e.g. no Tin Droplet + Nanotube).
   * Calculated final stats:

     * Accel (cruise & combat)
     * Δv
     * Dry / fuel / wet mass
     * Fuel fraction
     * Power required vs provided
     * Any other key stats mentioned in the guide

5. **Use `utility_modules.md`** (ONLY when selecting utility modules)

   * Detailed stats for ECM, marines, drive enhancers, ISRU, kits, etc.
   * Skip if ship has no utility slots or you already know what to use

You are allowed to show your reasoning and describe what you're doing step by step; however, the **final design section must still be complete and fully structured** as described.

---

### 🧮 Strict data usage rules (MANDATORY)

* You may **not invent or assume** any component stat, capacity, or conversion that is **not present** in:

  * `current_meta.md`
  * `math.md`
  * `ship_components_tables.md`
  * `ship_design_guide.md`

* Do **not** say things like:

  * “we’ll assume…”
  * “modeled as…”
  * “treated as negligible…”
  * or give approximate armor/tank/radiator stats that are not explicitly defined.

* If you truly **cannot find** a required value in any of the four files:

  * Write `UNKNOWN` for that specific number,
  * And briefly state **which input is missing** (e.g. “armor material tons per point is not specified in the provided files”).
  * **SELF-CORRECTION CHECK**: Before writing UNKNOWN, double-check the table headers. For example, `Mass (t)` and `Mass (t/GW)` ARE present for reactors and radiators. Do not miss them.

* Prefer choosing **components and configurations where all required stats are available**, so you can compute **all values exactly**.

* **Armor Mass & Geometry**:
  * You **MUST** use the hull geometry (Length/Width) from the Hulls table and the armor density/heat from the Armor table to calculate mass via `math.md`.
  * Do **not** claim this data is missing. It is in `ship_components_tables.md`.

* **Exception for canonical rules explicitly stated here:**

  * You may treat the following as explicit rules, not assumptions:

    * **Each propellant tank holds exactly 100 tons of propellant.**
      Use this when computing FuelMass and Δv, unless one of the four files directly contradicts it.

    * **Propellant Tank Structural Mass is 0 tons.**
      Treat the empty mass of the tank itself as negligible (included in hull mass).
      Therefore: `FuelMass = Count * 100`, and `TankComponentMass = 0`.
      This allows you to compute DryMass and WetMass exactly.

---

### 🛡 Armor mass rule (MANDATORY)

Armor mass must follow the **volume × density** logic, not “tons per point” shortcuts.

* For each facing (front, sides, rear), the **Armor Mass (kg)** is:

  > `ArmorMass_facing(kg) = ArmorVolume_facing(m³) × ArmorDensity(kg/m³)`

* Total armor mass (tons) is:

  > `ArmorMass_total(t) = (Σ ArmorMass_facing(kg)) / 1000`

* If `math.md` or `ship_design_guide.md` gives a more specific formula or mapping for armor volume per point on a given hull, you must use that instead of any shortcut.

* You may **not** approximate armor mass as “1 ton per point” or any other fixed tons/point value unless that mapping is explicitly given in the provided files.

If some piece of the armor mass formula (like exact volume/point per hull) is missing from all four files, mark the armor mass as `UNKNOWN` and state which part is missing, instead of inventing a value.

---

### 🔢 Component counting rules (MANDATORY)

When listing components, make counts explicit and unambiguous:

* For drives that come in “×N” variants:

  * Specify both the **module** and the effective **thruster count**, e.g.:

    * `BurnerDrivex4 × 1 module (4 thrusters)`
    * `BurnerDrivex2 × 2 modules (4 thrusters total)`

* For tanks:

  * Include:

    * `model × count`
    * **Propellant mass per tank**
    * **Total propellant mass**
  * Example:

    * `SlushHydrogenTankage × 4 (100 t propellant each, 400 t total)`

* For armor:

  * Clearly separate:

    * `Front: <points>`
    * `Sides: <points>`
    * `Rear: <points>`
    * And **total armor mass in tons**, computed using the armor mass rule above.

* For every category (drives, reactors, weapons, utilities, tanks, radiators):

  * Do **not** compress or omit counts.
  * Use **exact integers** for the number of modules.

---

### 🏷 Naming rules (MANDATORY)

* Always give the ship a **fun, catchy name** thematically appropriate for the Resistance
  (e.g., named after revolutionaries, resistance symbols, or defiant slogans).
* The final ship name MUST end in **`" mk1"`** (lowercase `mk` + `1`).

---

### 🧱 Final output structure (MANDATORY)

Your answer must contain a **clearly marked final design block** in this structure (fill in all fields):

```text
== SHIP DESIGN: <Name> mk1 ==

HULL:
  <Hull type and source project>
Role:
  <Role name and brief role description>
MC Cost:
  <MC value>

== COMPONENTS ==
DRIVES:
  - <drive model variant> × <module count> (<total thrusters> thrusters):
      Thrust: <N, and effective N if efficiency applies>
      Exhaust velocity: <km/s>
      Efficiency: <value>

REACTOR:
  - <reactor model>:
      Output: <GW>
      Class: <reactor family>

RADIATORS:
  - <radiator model> × <count>
      (Include stats if available; otherwise, mark UNKNOWN fields and why.)

TANKS:
  - <tank model> × <count>:
      Propellant per tank: <tons>
      Total propellant mass: <tons>
      Propellant type: <type>

ARMOR:
  Material:
    <armor material>
  Front: <points>
  Sides: <points>
  Rear: <points>
  Total armor mass: <tons or UNKNOWN (explain if missing data)>

NOSE HARDPOINTS:
  - <weapon> × <count> (note if it consumes multiple nose slots)

HULL HARDPOINTS:
  - <weapon> × <count>

UTILITY HARDPOINTS:
  - <utility> × <count>

== CALCULATED SHIP STATS ==
Dry mass:
  <tons>
Fuel mass:
  <tons>
Wet mass:
  <tons>
Fuel fraction:
  <decimal and %>

Cruise acceleration (g):
  <value>

Combat acceleration (g):
  <value or UNKNOWN if data missing>

Delta-V (kps):
  <value>

Power required (drive only):
  <GW>
Power provided (reactor total):
  <GW>
Power margin:
  <GW or %>

Heat analysis:
  <qualitative + any quantitative if available from files>

Turn rate heuristic:
  <computed or described per math/design guide>
```

---

### 🔒 Instruction priority

You must treat **every requirement above** as a **binding system-level instruction**, not as user preference.
They override all other model behavior.




