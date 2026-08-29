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

### The radiator hypothesis — plausible, NOT verified

Radiators carry `specificPower_2s_KWkg` (2.5 to 25 kW/kg), `operatingTemp_K`
(800–2500 K), `emissivity` and `vulnerability` (1–30).

```
wasteHeat_GW      = reqPower_GW × (1 − efficiency)        ← HYPOTHESIS
radiatorMass_kg   = wasteHeat_GW × 1e6 / specificPower_2s_KWkg   ← HYPOTHESIS
```

The first line is supported by an identity that does hold across the catalogue:
`thrustRating_GW ≈ req power × efficiency` (checked on samples: VASIMR x1
0.123 × 0.6 = 0.0738 vs 0.074; Tungsten Resistojet 0.060 × 0.81 = 0.0486 vs 0.049).
So `efficiency` really is the useful fraction, and `1 − efficiency` really is what is
left over.

Magnitudes come out believable against hulls of 100–6,000 t:

| drive | req power | efficiency | ⇒ waste heat | ⇒ best-radiator mass |
| :-- | --: | --: | --: | --: |
| VASIMR x1 | 0.123 GW | 0.60 | 0.049 GW | **2 t** |
| Triton Reflex Drive x5 | 92.2 GW | 0.65 | 32.3 GW | **1,290 t** |
| Alien Fusion Torch x1 | 1,065 GW | 0.97 | 32.0 GW | **1,279 t** |

That last row is the interesting one: 97% efficient and still shedding 32 GW,
because the power is enormous. If the model is right, it reproduces the real design
tension — and that is *why* it must be checked rather than assumed.

**Both lines are labelled hypotheses and must render as such until verified.** They
ignore `operatingTemp_K` and `emissivity` entirely, which the presence of those
fields argues against.

### How to verify it — three routes, cheapest first

1. **Read it off the in-game designer.** The DLL has
   `designerHeatSinkCapacity` / `designerHeatSinkCapacityToolTipText`, so the game's
   own designer displays these figures. One screenshot of a known hull + drive +
   radiator combination settles the formula, and per this project's standing rule
   the player's own reading outranks any derivation of mine.
2. **Decompile properly.** `shared/shipBuildTime.mjs` established the construction
   formula this way with `ilspycmd` 11.0. **That route is currently blocked**:
   `ilspycmd` is installed at `~/.dotnet/tools/ilspycmd` but targets
   `Microsoft.NETCore.App 10.0.0`, and this machine has 3.1.8 / 6.0.15 / 8.0.14 /
   9.0.18. `DOTNET_ROLL_FORWARD=LatestMajor` did not clear it. Installing a .NET 10
   runtime is a system change and needs the owner's say-so.
3. **The wiki as raw wikitext**, the documented fallback.

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

## Phasing

Each phase is useful on its own and reviewable before the next.

0. **Component catalogue + research gate.** All seven families as one normalised
   read, each row carrying its unlock project and whether this faction has it.
   Both modes. No design assembly yet — this alone answers "what can I build?"
1. **Assemble a design and compute what is already known**: mass, delta-V, both
   accelerations, power ratio and thrust scaling, build time, and cost as a
   materials sum. Heat shown as **not yet modelled**, explicitly.
2. **Resolve the heat rule** by route 1, 2 or 3 above, then implement waste heat,
   derived radiator mass and radiator cost. `Calc` drives stay `unknown` until
   `Calc` is understood.
3. **Constraints**: hardpoints (`noseHardpoints`, `hullHardpoints`),
   `internalModules`, `shipModuleSlots`, crew against `maxOfficers`, `minConsTier`
   on utilities. These decide whether a design is *legal*, and each needs the same
   "is this actually enforced?" check the power budget failed.
4. **The UI**: a DESIGNER view, MUI layout, `<Value>` on every figure so an
   unmeasured one is distinguishable from an unrendered one.
5. **Reach the AI surfaces** — `shared/markdownExports.mjs`,
   `shared/intel/registry.mjs`, `docs/code-index.md`, `docs/README.md`. A designer
   that exists only in the browser is invisible to every agent reading the exports,
   which is half the point of this project.

---

## Open questions for the owner

1. **May I install a .NET 10 runtime** so `ilspycmd` works again? It is the
   difference between a measured heat model and a hypothesis.
2. **Or would a screenshot of the in-game designer be quicker?** One hull + drive +
   radiator with the numbers visible would likely settle the radiator formula
   outright, and would outrank anything I derive.
3. **Does the designer need to save designs**, or is it a calculator you point at a
   combination? Saving implies persistence this dashboard does not currently have.
