# A ship designer in the dashboard

**Status: design, not built. Written 2026-08-29.**

The ask: build *new* ship designs in the dashboard and see their cost and
performance, with **omniscient mode offering every part and player mode offering
only what this faction has researched**.

Everything below that is stated as a number was measured on 2026-08-29 against the
installed 1.0 templates and the live save. Everything that is a guess says so.

---

## The short version

**This is more buildable than it looks.** Four of the five hard parts are already
solved in this repo or fall straight out of the templates:

| part | status |
| :-- | :-- |
| drive ↔ reactor compatibility | **solved by the data** — a direct join, below |
| mass, delta-V, acceleration | **already built** — `shared/propulsion.mjs`, agrees with the save to 1e-6 |
| under-powered drives | **already modelled** — thrust scales, it is not a veto |
| research gating | **already in the snapshot** — `unlockIndex`, 436 gates, **0 unresolved** |
| build time | **already built** — `shared/shipBuildTime.mjs`, calibrated |
| **heat and radiator sizing** | **NOT built, and the formula is not verified.** This is the real work. |

So the honest scope is: a lot of composition and UI over existing engines, plus one
genuinely new physical model that has to be pinned down before it can be trusted.

---

## What the parts are

Seven component families, from the installed templates:

| family | count | template |
| :-- | --: | :-- |
| drives | 541 | `TIDriveTemplate.json` |
| reactors | 61 | `TIPowerPlantTemplate.json` |
| radiators | 13 | `TIRadiatorTemplate.json` |
| hulls | 28 | `TIShipHullTemplate.json` |
| utility modules | 58 | `TIUtilityModuleTemplate.json` |
| armour | 12 | `TIShipArmorTemplate.json` |
| batteries | 10 | `TIBatteryTemplate.json` |

Plus weapons, which the engagement work already reads: 125 laser, 70 magnetic,
57 missile, 33 particle, 16 plasma, 8 gun.

---

## 1. Drive ↔ reactor compatibility — a solved join

`drive.requiredPowerPlant` names `powerPlant.powerPlantClass` directly. Measured:

- **12 of the 13 plant classes** are named by at least one drive.
- **`Any_General`** is a wildcard on **163 of 541** drives — any reactor will do.
- **`Molten_Salt_Core_Fission` is required by no drive at all.** Whether it is dead
  content, hab-only, or reachable another way is unknown; the UI must not silently
  drop it, and must not imply it powers something it does not.

The remaining 378 drives name exactly one class, from `Solid_Core_Fission` (84
drives) up to `Antimatter_Beam_Core` (6).

**This is a hard filter and the one place the designer may legitimately refuse a
combination.**

## 2. Power is NOT a veto — the game scales thrust

Already established in this repo and enforced in `shared/intel/driveExplorer.mjs`
and `shared/refitAdvisor.mjs`:

```
thrustScalingFactor = min(1, plantOutput_GW / drive.reqPower_GW)
```

An underpowered ship is **not rejected** — it flies with proportionally less thrust.
A fielded alien design in this save runs **2.13× over its plant**. The designer must
show the scaling factor and the reduced acceleration, and must never render an
underpowered design as invalid.

> **The parsing trap, already paid for once.** `req power` is a **string**, and on
> **92 of 541** drives it carries thousands separators — `"2,130.928"`.
> `Number("2,130.928")` is `NaN`, and a `?? 0` fallback then scores the highest-power
> drives as drawing **zero**, which is the reassuring direction. Strip separators,
> and treat unparseable as `null`, never `0`. `thrustRating_GW` has the same shape.

## 3. Performance — already built, do not rewrite

`shared/propulsion.mjs` carries the formulae and agrees with the save's own figures
to **1e-6** on human ships:

```
EV_effective = drive.EV_kps × ∏(evMultiplier of each EVMultiplier utility the drive's propellant satisfies)
deltaV_kps   = EV_effective × ln(wetMass / dryMass)
cruise_m_s²  = drive.thrust_N / wetMass
combat_m_s²  = drive.thrust_N × drive.thrustCap / wetMass
```

`thrustCap` runs **1 to 160**, and only **72 of 541** drives have cruise and combat
equal — so both must be shown. Rendering one as "acceleration" overstates sustained
transit on the other 469.

## 4. Research gating — already in the snapshot, and it resolves completely

This is the mechanism for the player/omniscient split, and it is in better shape
than expected. `snapshot.unlockIndex` carries:

- **16 component families**, gated on `requiredProjectName` (orgs use
  `requiredTechName`)
- **436 gates**, **1,223 gated entries**
- **`unresolved: []`** — every gate resolves. No join loss to report or apologise for.

Coverage per family is near-total: drives 541/541, magnetic guns 70/70, particle
weapons 33/33, power plants 60/61, radiators 12/13, hulls 27/28. The ungated
remainder are the starting components, available from turn one.

**So the two modes are one predicate, not two code paths:**

- **omniscient** — offer every component, and label each with the project that
  unlocks it.
- **player** — offer only components whose gate project this faction has completed,
  and show the rest as locked *with the project named*, because "you cannot build
  this yet" is far less useful than "this needs Project X".

**Both modes must be tested.** Player mode is a genuinely different path in this
repo, and two shipped defects came from checking only omniscient.

## 5. Cost — sum the materials, and say when you could not

Every component carries `weightedBuildMaterials`. Hulls also carry
`baseConstructionTime_days`, `consTier` and `shipyardyOffset`, which
`shared/shipBuildTime.mjs` already turns into a calibrated build time at a specific
shipyard.

**Unverified:** whether total cost is a plain sum of component materials or is
scaled by hull, tier or faction modifiers. Do not present a summed figure as the
game's own number until one design has been checked against the in-game designer.

---

## 6. HEAT — the actual work, and what is and is not known

This is the part the request specifically named, and the only part with no existing
model.

### What the game's own code calls it

Read directly out of `Assembly-CSharp.dll` (identifier scan — the decompiler itself
is currently unusable here, see below):

```
get_wasteHeat_GW          get_radiatorMass_tons      get_radiatorsBuildCost
get_openCycleCooling      get_allowedRadiators       get_allowedHeatSinks
HeatGeneration_GJ         RadiatorCooling_GJ         get_overheated
HeatCapacity_GJ           currentHeatSinkCapacity_GJ get_heatFraction
DoesDriveHeatExceedRadiatorAndOverheatInOneSecond
```

Three things follow from those names, and they shape the whole feature:

1. **Radiator mass is DERIVED, not chosen.** `get_radiatorMass_tons` is a computed
   property. You pick a radiator *type*; its mass — and therefore
   `radiatorsBuildCost` — follows from the heat it must reject. That is exactly the
   coupling in the request: a hot engine forces heavy, expensive radiators.
2. **The constraint is per-second, not per-design.**
   `DoesDriveHeatExceedRadiatorAndOverheatInOneSecond` names it. Radiators reject a
   rate; heat sinks (`HeatCapacity_GJ`) are a *buffer* that combat firing can
   exceed (`WeaponFireExceedsHeatCapacity`).
3. **`allowedRadiators` is a per-drive list.** So there is a compatibility rule
   beyond mass — almost certainly involving `operatingTemp_K` — and the designer
   must not assume any radiator pairs with any drive.

### The three cooling modes

`drive.cooling` is one of three values, measured across the catalogue:

| mode | drives | reading |
| :-- | --: | :-- |
| `Open` | 109 | open-cycle — propellant carries the heat away. `get_openCycleCooling` is the flag. Expect little or no radiator. |
| `Closed` | 246 | closed-cycle — the radiator must reject the full waste heat. |
| `Calc` | 186 | **meaning unknown.** Not guessable from the templates. |

**`Calc` covers 186 of 541 drives — over a third of the catalogue — and shipping a
heat model that silently treats it as `Closed` would be a fabrication.** Until it is
resolved, those drives must report their radiator requirement as **unknown**, not as
a number.

### The radiator formula — VERIFIED, and it is the REACTOR's efficiency, not the drive's

**Corrected 2026-08-29 against the game's own codex text**, in
`StreamingAssets/Localization/en/UICodex.en`. An earlier draft of this spec had the
drive's efficiency here. That was wrong, and it is the kind of wrong that produces
confident numbers: nearly every drive has an `efficiency` field, so the mistake
computes cleanly and silently.

The codex, verbatim on the two entries that decide it:

> **Power Plant Efficiency**: This is how much waste heat is generated by the power
> plant. Higher values are significantly better. More waste heat means more and
> heavier radiators. **For ships with open-cycle drives, the efficiency value only
> applies to power generated for the ship's systems.**

> **Radiator Tons Per Gigawatt Waste Heat**: This, along with the ship's waste heat
> production **from the ship's power plant**, determines how massive your ship's
> radiators are.

So:

```
wasteHeat_GW    = power_GW × (1 − powerPlant.efficiency)
radiatorMass_kg = wasteHeat_GW × 1e6 / radiator.specificPower_2s_KWkg
```

…and for an **open-cycle** drive the drive's own heat leaves with the propellant, so
only ship-systems power feeds the radiator — *"minimal radiators"*, per the drive
tooltip, **not zero**.

**The second line is confirmed to the digit by an independent source.** Two
community references quote the tin droplet radiator at **125 tons/GW**. Its
`specificPower_2s_KWkg` is **8**, and `1e6 / 8 = 125,000 kg = 125 t/GW`. Exact.

`operatingTemp_K` and `emissivity` therefore do **not** enter the mass calculation —
they are flavour and, presumably, inputs to whatever produced `specificPower_2s_KWkg`
in the first place. My earlier worry that ignoring them was suspicious was misplaced.

### `Calc` — it is not a third player-facing mode

**There are exactly two localization strings**, `TIDriveTemplate.OpenCycle` and
`TIDriveTemplate.ClosedCycle`, and the codex says plainly: *"Drives are classified as
either open-cycle or closed-cycle."* So the player never sees a third mode, and the
DLL's accessor is the boolean `get_openCycleCooling`.

`Calc` therefore means **"resolve it at runtime"**, not "a third kind of cooling".
It is also not a drive-family marker — measured across the catalogue it spans six
classifications, and three of them appear under `Calc` *and* another mode:

| classification | Calc | Closed | Open |
| :-- | --: | --: | --: |
| Fission_Thermal | 84 | 54 | 42 |
| Electrothermal | 30 | — | — |
| Electromagnetic | 24 | 24 | — |
| Electrostatic | 24 | — | — |
| Antimatter | 18 | — | 6 |
| Fusion_Thermal | 6 | 168 | — |

**What remains unknown is only which way it resolves, and on what input.** That is a
much smaller gap than "186 drives are unmodelled", and it has a one-look answer:
open a `Calc` drive in the in-game designer — any Electrothermal, e.g. the Tungsten
Resistojet — and the tooltip must say either open-cycle or closed-cycle, because
those are the only two strings that exist.

Until then, a `Calc` drive's radiator mass is reported as a **range** between the two
resolutions, labelled as such. A range is honest; picking one silently is not.

### Routes to close the remainder

1. **The in-game designer.** One `Calc` drive's cooling tooltip settles the last
   question, and per this project's standing rule the player's reading outranks any
   derivation of mine.
2. **Decompile properly**, for `DoesDriveHeatExceedRadiatorAndOverheatInOneSecond`
   and the `Calc` resolution. **Currently blocked**: `ilspycmd` is installed at
   `~/.dotnet/tools/ilspycmd` but targets `Microsoft.NETCore.App 10.0.0`, and this
   machine has 3.1.8 / 6.0.15 / 8.0.14 / 9.0.18. `DOTNET_ROLL_FORWARD=LatestMajor`
   did not clear it. Installing a .NET 10 runtime needs the owner's say-so.
3. **The official wiki is not reachable from here** — `wiki.hoodedhorse.com` returns
   a Cloudflare block on both the article and API paths, and bot-detection is not
   something to work around. The Steam guides and the game's own localization files
   were the productive sources instead.

---

## 7. What else the codex settled — several of these change the UI, not just the math

`UICodex.en` documents the designer far better than the game's own UI does, and four
of these were not assumptions I had flagged, but things I had not thought to ask.

**Thrusters are a number input, 1–6 — not six separate drives.**
**CONFIRMED by the owner, who plays the game, 2026-08-29.**

> *"drives can be built with up to 6 thrusters. The number of thrusters is set by a
> number input field in the ship designer. Each additional thruster adds the drive's
> thrust value to the systems overall output. This increases the power requirements
> of the drive proportionally."*

This reframes the catalogue. The 541 drive rows are roughly 90 base drives × a
thruster count, which is why they are named `x1`…`x6` and why `VASIMR x2` has exactly
twice `VASIMR x1`'s thrust and power. **The designer must expose a 1–6 thruster
spinner against ~90 drives**, not a 541-row list — and the existing DRIVES view's
541-row catalogue is answering a different question, so neither replaces the other.

**What the confirmation covers, and what it does not.** The owner confirmed the
*mechanic*: a 1–6 count, each thruster adding thrust and power proportionally. It
does **not** establish that every family in the template data carries a clean, full
`x1`…`x6` ladder — partial ladders and exceptions are a property of the JSON, not of
the mechanic. Part 1a is checking that arithmetically, and the output that matters is
**any drive whose `xN` is not `x1 × N`**. Folding such a drive into a ladder would
corrupt every design built on it, so the exception list is the deliverable there, not
the confirmation.

**Power plants auto-scale.**

> *"Power plants automatically scale to the ship's requirements, so an undamaged
> power plant will always fully supply your ship."*

Consistent with the thrust-scaling rule rather than contrary to it: the plant scales
up to its `maxOutput_GW`, and only past that does thrust scale by
`min(1, plantOutput / reqPower)`.

**Radiator crew mass is a real design tension**, and it is why a lighter radiator can
produce a heavier ship. Radiators carry a `crew` count; the community reference notes
it "can be significant enough to make a ship with a lighter radiator heavier
overall." Crew must be counted in dry mass, not treated as a footnote.

**Radiators cannot be armoured, and heat sinks are the combat trade.** Heat sinks
buffer while radiators are retracted; when they fill, the ship extends radiators or
takes internal damage. `vulnerability` (1–30) sets the risk when extended. This is
what makes `HeatCapacity_GJ` a design figure and not just a combat one.

**Refit rules are fully specified** in `codex_shipRefits0` — hull cannot change;
power plant may change within its class; drives may change thruster count or swap for
a drive of the same classification, required plant and propellant; armour, batteries,
heat sinks and radiators change freely. Worth encoding, because `shared/refitAdvisor.mjs`
already exists and these are its constraints stated by the game.

---

## What must not ship

- **A radiator mass presented as measured when it came from the hypothesis above.**
- **`Calc`-cooled drives given a radiator figure** before `Calc` is understood. That
  is 186 of 541 drives; an unknown must read `unknown`, never a plausible number.
- **An underpowered design rejected.** The game scales thrust. Refusing the design
  would invent a rule the game does not have.
- **A `?? 0` anywhere near `req power` or `thrustRating_GW`.** 92 drives carry
  thousands separators and parse to `NaN`; zero is the reassuring direction and the
  most repeated defect in this repo.
- **Player mode verified by inference from omniscient.** Different path, test both.
- **`Molten_Salt_Core_Fission` silently dropped** because no drive names it.
- **A single "score" for a design.** The engagement work already established that a
  scalar cannot express a matchup; the designer should report mass, delta-V, both
  accelerations, power ratio, heat, cost and build time as separate readings.

---

## Phasing — split by LAYER, one agent per part

**Owner's instruction, 2026-08-29: this is built in parts — server side first, then
the page, then the rendering components — and each part gets its own agent.** The
same rule is now in the dispatch skill. Three sequential dispatches, not one vertical
slice: an agent handed the whole stack in this repo once produced a 34-file commit
that had to be unwound, and a layer boundary is also the boundary at which each part
becomes independently testable.

### Part 1 — server side

Everything computable without a pixel, verifiable with `npm test` and a curl before
any UI exists.

- **1a. Component catalogue + research gate.** All seven families as one normalised
  read, each row carrying its unlock project and whether this faction has it, driven
  off `snapshot.unlockIndex`. Both modes. Answers "what can I build?" on its own.
  **Drives collapse to ~90 base entries with a 1–6 thruster count**, not 541 rows.
- **1b. The design calculation.** Compose hull + drive×thrusters + reactor + radiator
  + armour + weapons + utilities into mass, delta-V, both accelerations, power ratio
  and thrust scaling, crew, waste heat, derived radiator mass, cost and build time.
  Reuses `shared/propulsion.mjs` and `shared/shipBuildTime.mjs` — **do not
  reimplement either.** `Calc`-cooled drives report a **range** across both
  resolutions until that question is closed.
- **1c. The endpoint and its registry row** — a registry entry in
  `shared/intel/registry.mjs`, never a one-off branch, plus the markdown-export
  surface. A figure that exists only in the browser is invisible to every agent
  reading the exports, which is half the point of this project.

Constraints (hardpoints, `internalModules`, `shipModuleSlots`, crew vs
`maxOfficers`, `minConsTier`) belong here too — and each needs the *"is this actually
enforced?"* check the power budget failed. The refit rules in `codex_shipRefits0` are
the game's own statement of what may vary.

### Part 2 — the page

The DESIGNER view itself: route, mount, nav entry, `assertViewRegistryIntegrity()`,
`TwoColumnGrid` layout. Verifiable by navigation and registry integrity with the
panels still stubs.

### Part 3 — the rendering components

The panels: component pickers, the live readout, the heat and power breakdown.
`<Value>` on every figure so an unmeasured one is distinguishable from an unrendered
one, MUI for layout and spacing per `docs/frontend-architecture.md`, and captures at
375 / 414 / 768 / **1000 / 1100** / desktop.

### Then

`docs/code-index.md` regenerated and `docs/README.md` updated **in the same commit as
each part**, not at the end.

---

## Open questions for the owner

**Answered 2026-08-29**, and both answers came from the owner rather than from my
derivation, which is the order this project's rules put them in:

- ✅ **The radiator formula.** Settled from the game's own codex, and the tin droplet
  radiator's published 125 t/GW matches `1e6 / specificPower` exactly. No .NET 10
  runtime needed after all, and no screenshot needed for this part.
- ✅ **Closed-cycle is the expensive mode** — it must radiate its waste heat, where
  open-cycle sends it out with the propellant and needs only minimal radiators.
- ✅ **The 1–6 thruster count**, confirmed as a mechanic.

**Still open:**

1. **Which way does `Calc` resolve?** One look at any `Calc` drive in the in-game
   designer — a Tungsten Resistojet, say — settles it, because the tooltip can only
   read open-cycle or closed-cycle; those are the only two strings that exist. Until
   then those 186 drives report a **range** across both resolutions rather than a
   silently chosen number.
2. **Does the designer need to SAVE designs**, or is it a calculator you point at a
   combination? Saving implies persistence this dashboard does not currently have,
   and it is the one open question that changes the architecture rather than a
   number. Worth answering before Part 2 starts.
