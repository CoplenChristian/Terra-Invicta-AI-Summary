# A ship designer in the dashboard

**Status: design, not built. Written 2026-08-29.**

The ask: build *new* ship designs in the dashboard and see their cost and
performance, with **omniscient mode offering every part and player mode offering
only what this faction has researched**.

**Scoped by the owner, 2026-08-29 — this is a calculator, not a design manager:**

> *"I don't care about saving. I just want to experiment with designs and calculate
> cruise accel, combat accel, and dV based on the drive and weight of the ship."*

Two consequences, and both make the feature smaller:

1. **No persistence.** No saved designs, no library, no naming, no reconciling
   against the faction's real design list. A combination lives as long as you are
   looking at it. That removes storage, migration and identity from the whole build —
   and it means the state can live in the page, since nothing outlives the session.
2. **Three headline numbers plus the bill**: **cruise acceleration, combat
   acceleration and delta-V**, as a function of the drive and the ship's weight —
   and, added 2026-08-29, the **total resource cost**. Build time, heat and power
   ratio are supporting detail that earn their place by feeding those or explaining
   them.

**This is why the heat model still matters even though it is not one of the three.**
Radiator mass *is* ship weight: it is derived from waste heat, it can exceed a
thousand tons, and the community's own summary of the trap is a patrol ship that
"weighs 26,000 tons and is 98% radiators". Heat is not a side panel here — it is one
of the largest terms in the denominator of all three headline numbers.

`shared/propulsion.mjs` already computes exactly those three against a measured mass,
and `refitOntoDrive` already answers "what if this drive went on this design". The
designer is largely a new *input* surface onto arithmetic that exists and is verified
to 1e-6.

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
| heat and radiator sizing | **formula VERIFIED** from the codex, confirmed to the digit against a published 125 t/GW figure |
| power draw (systems / weapons / propulsion) | **VERIFIED** — the wiki states all three, and the propulsion line reproduces stored `req power` on **476 of 487** drives |
| total resource cost | **shape verified, rate corroborated twice** — see §5 |

**Nothing in the physics is now guesswork.** The remaining work is composition and
UI over engines that already exist, plus implementing two models — heat and the
resource bill — whose formulas are written down and checked rather than inferred.

The one number that could still silently poison everything is the **0.1 units/ton
rate**. It is no longer a guess: the codex and the wiki state it independently for
two unrelated subsystems. But two agreeing documents are not a measurement, so it is
still the first thing to confirm against the in-game designer.

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

## 5. Total resource cost — asked for explicitly, and it is a VECTOR, not a number

**Requested by the owner, 2026-08-29: "Also total cost of resources!"**

The first thing to get right is that a ship does not cost *an* amount. It costs a
bill across **seven materials**, measured across every ship component in the
templates:

```
water   volatiles   metals   nobleMetals   fissiles   exotics   antimatter
```

A single "cost" figure would hide the thing that actually decides whether you can
build a design — you can be metal-rich and fissile-poor, and the game's stockpiles in
this save differ by orders of magnitude (Metals 73,663 against Fissiles 2,060). **Show
the vector, and show it against the faction's stockpile**, so the answer is "you can
afford three of these" rather than a number with no scale.

### `weightedBuildMaterials` is a MIX RATIO, not a cost

Measured: it sums to exactly 1.0 on **714 of 723** ship components. It is a
composition, not an amount — the localization label for it is literally
**"Materials Per Ton"**.

**Three components break the sum, and they are all alien**, so they must not be
quietly normalised:

| component | sums to |
| :-- | --: |
| Alien Mothership | **0.9000** |
| Alien Advanced Hybrid Confinement Fusion Reactor | 0.9968 |
| Alien Super Advanced Hybrid Confinement Fusion Reactor | 1.0020 |

The two reactors are rounding. **The Mothership's 0.90 is a 10% shortfall**, which is
either deliberate or a data bug, and either way the designer must report the shortfall
rather than scaling it to 1 and inventing the missing tenth.

### The amount comes from MASS, and the codex gives one hard anchor

There is **no cost field on any ship component** — only mass fields. The assembly
confirms the shape: `GetLocalizeCostPerTon`, and per-subsystem accessors
`get_powerPlantBuildCost`, `get_radiatorsBuildCost`, `get_noseArmorBuildCost`,
`get_lateralArmorBuildCost`, `get_tailArmorBuildCost`, `propellantTanksBuildCost`.
**Those accessors are also the breakdown the designer should render** — the game
itself costs a ship by subsystem, so the panel can attribute the bill rather than
presenting one opaque total.

The codex gives an exact ratio for one subsystem:

> *"Each 100-ton propellant tank added to the ship will require **10 units** of this
> mix from your resource stockpiles to construct and resupply."*

**100 tons → 10 units. A ratio of 0.1 units per ton**, distributed by the mix.

```
resourceCost[material] = componentMass_tons × RATE × weightedBuildMaterials[material]
```

**`RATE = 0.1 units per ton, now confirmed on TWO independent subsystems.**

| source | mass | resource units | ⇒ rate |
| :-- | --: | --: | --: |
| codex, propellant tanks | 100 t | 10 units of the mix | **0.1 / t** |
| wiki, `Radiator List` — crew | 4 t | 0.2 water + 0.2 volatiles = 0.4 | **0.1 / t** |

Two unrelated subsystems, documented in two unrelated places, landing on the same
constant is much stronger evidence than either alone. It was the number flagged as
"would silently poison everything"; it is now the best-supported constant in the
model. **Still worth one check against the in-game designer before shipping a bill**,
because two agreeing sources is not the same as a measurement.

The wiki also states the radiator rule directly: *"The displayed resource costs are
shown as % of the radiator's required mass, based on its tons per GW and the ship's
heat output"* — confirming that radiator cost follows derived mass, and noting that
**crew cost is FLAT and separate**, not folded into that percentage.

### Boost and Money SUBSTITUTE for missing space resources — a per-shipyard toggle

**Corrected 2026-08-29.** An earlier draft of this section read the wiki's scuttling
note as "Earth-built ships are bought with boost and money, space-built ones with
space resources." **That is wrong.** The owner challenged it — *"you can't build ships
with boost and money as far as I know"* — and the game's own UI strings settle it in a
third way that neither of us had:

> `UI.Objectives.FleetScreenCanvas.ConstructBoostToggle.Desc` — *"Toggle this
> checkbox to enable this **Shipyard's construction queue** to use **Boost and
> Money** to transport any missing space resources it requires from Earth."*

> `UI.Fleets.ConstructionCostTab.Description` — *"Resources required to build the
> ship. **Boost and Money can be substituted for any resource that is lacking. This
> may increase build time** as materials are delivered from Earth."*

So it is **not** a location-based currency and **not** an alternative price list. It
is a **per-shipyard toggle** that tops up whatever space resources you are **short
of**, paying in boost and money, at the cost of **longer build time**. The ship's
cost is still denominated in the seven space resources — which is exactly why the
scuttling refund is *"always calculated in terms of space resources… even if the ship
was originally constructed using boost and money"*. That sentence is about the refund
basis, not about an Earth currency.

**This matters to the designer's output, not just its prose.** The bill should show:

1. the seven-resource cost,
2. **the shortfall against the faction's current stockpile**, and
3. **what that shortfall would cost in boost and money** if the toggle is on.

A faction with a wrecked mining network and a healthy treasury is exactly the case
where "you cannot afford this" is the wrong answer and "you are short 40 volatiles,
which boost can cover, at some build-time cost" is the right one.

**Unquantified:** how much boost and money a unit of each resource costs, and how much
build time the substitution adds. `earthResourceConstructionCost` and
`_spaceResourceConstructionCost` in the assembly are presumably the two sides of this,
but the exchange rate is not in the templates I have read. **Report the shortfall and
say the conversion is unmeasured** rather than inventing a rate.

Scuttling at a construction module refunds **25% of the space cost**, excluding fuel.

One further wrinkle worth carrying: **if the drive uses He3 and the faction has an
active Helium-3 Mine, every fissile cost for propellant becomes water instead.** A
propellant bill that ignores that will overstate fissile draw for exactly the
factions that solved it.

### Two further wrinkles, both named in the assembly

- **`earthResourceConstructionCost` and `_spaceResourceConstructionCost` are separate.**
  Where you build changes what it costs. A designer that quotes one bill regardless of
  shipyard is answering a question the game does not ask.
- **`GetTypicalShipBuildCostSansRareMaterials`** exists, so the game itself
  distinguishes the bill with and without rare materials. Worth mirroring: exotics and
  antimatter are the constraints that actually bite, and burying them in a seven-row
  table hides that.

Build *time* is separate and already solved — hulls carry `baseConstructionTime_days`,
`consTier` and `shipyardyOffset`, and `shared/shipBuildTime.mjs` turns them into a
calibrated figure at a specific shipyard. **Do not reimplement it.**

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

## 6b. The power and heat model, in full — from the official wiki, 2026-08-29

The wiki became reachable (it had been blocking the owner's VPN, not me specifically)
and `Fleets#Power_and_Heat` states the model in formulas. Read as **raw wikitext via
`https://wiki.hoodedhorse.com/Terra_Invicta/api.php`**, which is where this project's
notes already said the real content lives.

```
Required Systems Power (GW)
  = 1.1 × ( Crew × 0.000005 GW
          + Hull Construction Tier × 0.005 GW
          + Σ Utility Module Power Requirements (MW) × 0.001 GW/MW )

Required Weapons Power (GW)
  = Σ over each NOT-self-powered weapon:
      Power Used Per Shot (GJ) / min(Cooldown_s, IntraSalvoCooldown_s)

Required Propulsion Power (GW)
  = 0 if the drive is self-powered, otherwise
    Thrust (N) × EV (km/s) × 0.5 × 1e-6 / Drive Efficiency
```

**I verified the propulsion line against all 541 drives: 476 of 487 match the stored
`req power` within 0.5%.** The other 11 are all sub-0.01 GW drives — Resistojet
stored as `0.002` against a predicted `0.0018` — where three-decimal storage
quantisation is larger than the value being compared. **54 drives store `req power`
as 0**, exactly matching *"0 if the Drive is Self-Powered"*.

So the drive's own `efficiency` **does** matter — it sets how much power the drive
*demands*. The **power plant's** efficiency separately sets how much of that arrives
as heat. Both are real; conflating them was the earlier error.

### Heat, stated as a rate

> *"the ship's heat increases by: `Required Systems Power (GW) × 1s × (1 − Power
> Plant efficiency)`"*

Confirms §6 exactly, and explains `DoesDriveHeatExceedRadiatorAndOverheatInOneSecond`
— the game accumulates heat per second and per 0.25 s tick against radiator capacity.

**Two facts that change which designs are hot:**

- **Naval guns and missiles produce NO waste heat.** The wiki says so twice, and adds
  that they keep firing "even when the radiators are destroyed and the heat sinks are
  filled." So a kinetic/missile ship is thermally cheap and a beam ship is not —
  which is a design axis the readout should make visible.
- **Power plant mass scales with `max(drive power need, systems power need)`**, not
  with the drive alone. A low-thrust ship with heavy utility draw is sized by its
  systems.

## 6c. Armour — the heaviest part of most ships, and it is NON-LINEAR

The wiki gives the armour formulas outright (stated as of 0.4.90), and they matter
more than anything else in the mass budget: *"Armor is typically the heaviest (and
most expensive) part of a ship."*

```
Plate Thickness (m) = 20 MJ / heatofVaporization_MJkg / density_kgm3 / 0.005 m²

Nose Thickness = Plate × nose points        Side Thickness = Plate × side points
Tail Thickness = Plate × tail points

Nose Volume (m³) = NoseThickness × π × (HullWidth/2 + SideThickness)²
Tail Volume (m³) = TailThickness × π × (HullWidth/2 + SideThickness)²
Side Volume (m³) = π × HullLength × ((HullWidth/2 + SideThickness)² − (HullWidth/2)²)

Armour Mass (kg) = Volume (m³) × density_kgm3
```

Every input exists in the data already: `heatofVaporization_MJkg` and `density_kgm3`
on `TIShipArmorTemplate`, `length_m` and `width_m` on `TIShipHullTemplate`.
Computed plate thicknesses come out physically sensible — 7.5 cm for Steel, 13.8 cm
for Composite, 22.2 cm for Boron Carbide.

**THE NON-LINEARITY IS THE WHOLE POINT, and it is severe.** Side thickness appears
inside the nose and tail volume terms, so buying side armour enlarges the nose and
tail caps as well; and the side term is quadratic in it. Computed for the observer's
own *Devilfish Block 2* — Escort hull, 50 m × 10 m, Composite armour, nose 4 / tail 1:

| side armour | total armour mass |
| --: | --: |
| 0 points | **104.7 t** |
| 1 point | **429.1 t** |
| 2 points | 762.3 t |
| 4 points | 1,455.2 t |

**The first point of side armour costs 324 tons on a 350-ton hull** — it roughly
doubles the ship. That is why the wiki says side armour runs "10–35× heavier per
point than nose/tail armor", and it is the single most useful thing this designer can
show a player. A linear armour model would understate it catastrophically.

### It also depends on a campaign setting, which this repo does not currently track

Volumes are multiplied by ship-scaling modifiers chosen at campaign creation:

| facing | Cinematic | Realistic |
| :-- | --: | --: |
| Nose / Tail | 1 | **3** |
| Side | 0.75 | **0.5** |

The same Devilfish armour is **104.7 t under Cinematic and 314.2 t under Realistic** —
a 3× swing on an input the player picked once and may not remember. `shared/campaignSettings.mjs`
exists but does **not** record this choice. **The designer must read it or say it is
unknown**; silently assuming one is a 3× error on the largest mass term in the ship.

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

**No persistence layer** — the owner does not want saved designs, so the current
combination is page state and nothing outlives the session. Do not add storage,
a design library, or reconciliation against the faction's real design list.

### Part 3 — the rendering components

The panels: component pickers, the live readout, the heat and power breakdown.

**The readout leads with cruise acceleration, combat acceleration and delta-V** —
those are the three the owner named, and the layout should say so rather than burying
them in a grid of equals. Both accelerations always, never one labelled
"acceleration": `thrustCap` runs 1 to 160 and only **72 of 541** drives have the two
equal, so a single figure overstates sustained transit on the other 469.

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

1. **Which way does `Calc` resolve?** **Not blocking, and deliberately not worth much
   of the owner's attention** — those 186 drives report a **range** across both
   resolutions, labelled, which is honest and still useful. If it is ever convenient:
   open the ship designer, pick a **Tungsten Resistojet** (or any Electrothermal,
   Electrostatic or Ion drive), and its cooling line will read either *open-cycle* or
   *closed-cycle* — those are the only two strings in the game. That single word
   collapses the range to a number for a third of the catalogue.

   The range is not a large penalty in practice: the same base drive at `x1`…`x6`
   shares one cooling value, so the ambiguity affects whole families uniformly rather
   than scattering through the list.
2. ✅ **Answered: no saving.** It is a calculator you point at a combination. See the
   scoping quote at the top — no persistence, no design library, and the three
   headline outputs are cruise acceleration, combat acceleration and delta-V.
