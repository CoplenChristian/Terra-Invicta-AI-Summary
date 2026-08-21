# Research Advisor — Spec

Make the dashboard say **what to research next and why**, separated into military and economic value, with the numbers behind each claim.

Written 2026-08-21 against `f5a0731`. Every data claim below is measured against the installed 1.0 templates or the live save.

---

## 1. The key finding: this is derivable, not editorial

The instinct is that "what's worth researching" needs meta knowledge scraped from guides. It mostly doesn't. **The game ships its own classification, and every effect is quantified.**

### The game labels each tech's purpose

`TITechTemplate.json` — 149 techs, each carrying:

```json
{ "friendlyName": "Arc Lasers", "dataName": "ArcLasers",
  "techCategory": "Energy", "AI_techRole": "SpaceWar",
  "AI_criticalTech": false, "endGameTech": false,
  "researchCost": 25000, "prereqs": ["InfraredCombatLasers","Supercapacitors"],
  "effects": ["Effect_ArcLaserDefenses"] }
```

Measured distribution:

| `AI_techRole` | count | | `techCategory` | count |
| :-- | --: | --- | :-- | --: |
| SpaceDevelopment | 61 | | Energy | 31 |
| SpaceWar | 31 | | SocialScience | 26 |
| EarthPolitics | 29 | | MilitaryScience | 22 |
| Efficiency | 18 | | Materials | 21 |
| SpaceExpansion | 8 | | SpaceScience | 20 |
| FactionObjective | 2 | | LifeScience | 17 |
| | | | InformationScience | 12 |

33 are flagged `AI_criticalTech`, 7 `endGameTech`. Research cost spans 250 – 150,000. `TIProjectTemplate.json` adds 750 projects with `AI_projectRole`, `resourcesGranted`, `orgGranted`.

**This is the spine of the military/economic split**, and it comes from the developers rather than from us.

### Effects are quantified

`TIEffectTemplate.json` — 719 effects. Two families:

```json
{ "dataName": "Effect_SpaceMiningBonus5", "operation": "Additive", "value": 0.05,
  "effectTarget": "SourceFaction", "contexts": ["SpaceMiningBonus"], "stackable": true }

{ "dataName": "Effect_IncreaseMonthlyResearchIncome15",
  "instantEffect": "GainResearchIncome", "value": 15, "effectDuration": "instant" }
```

- **288 context-scoped modifiers** — `operation` (Additive 161, Multiplicative 79, SetToFixedValue 36, IncreaseToValue 27, DecreaseToValue 2) × numeric `value` × one of **166 distinct contexts** (`SpaceMiningBonus`, `ShipConstructionTime`, `Economy_BasePCGDPIncrease`, `MCFreeSpaceMineNetwork`, `Mission_Purge_Att`, …).
- **~414 one-time grants** — `NationGDPPctChange`, `GainMoneyIncome`, `CouncilerModifyAttribute`, `NationMiltechChange`, …

So "+5% space mining" is not a guess. It can be multiplied against **this save's actual mining output** to produce a real monthly delta.

### The biggest military value is in unlocks, not effects

A tech's `effects` array misses most of its military worth. Unlocks are gated from the other side, via `requiredProjectName`:

| template | gated entries | | template | gated entries |
| :-- | --: | --- | :-- | --: |
| Drives | 541 | | Missiles | 56 |
| Hab modules | 138 | | Particle weapons | 33 |
| Laser weapons | 92 | | Ship hulls | 27 |
| Orgs | 83 | | Plasma weapons | 16 |
| Magnetic guns | 70 | | Heat sinks / radiators | 26 |
| Power plants | 60 | | Batteries / armor / guns | 24 |
| Utility modules | 57 | | | |

And every unlocked item carries **full engineering stats**:

```
LASER  shotPower_MJ · cooldown_s · efficiency · mirrorRadius_cm · wavelength_nm
       beam_quality · targetingRange_km · baseWeaponMass_tons · isPointDefenseTargetable
HULL   noseHardpoints · hullHardpoints · internalModules · structuralIntegrity
       mass_tons · missionControl · baseConstructionTime_days · consTier · monthlyIncome_Money
DRIVE  thrust_N · EV_kps · specificPower_kgMW · efficiency · requiredPowerPlant · propellant
```

This is what makes military value **computable**: DPS per ton, throw weight per hull, ΔV per drive — each comparable against what the observer currently fields.

### What the wiki adds, and what it does not

Useful and current — the **research allocation formula** (`Technology`, rev 2026-05-06):

```
per slot X:  base
             × (100% + 5% per slot with pips assigned)
             × pips_X / total pips
             × (100% + CategoryBonus × 0.9^(same-category slots with pips − 1) + ProjectBonus)
```

Eight categories: energy, life, information, material, military, social, space, xenology.

That formula makes **slot allocation itself optimisable** — the `+5%` per active slot rewards breadth while `0.9^(n−1)` penalises stacking one category. §6.

**Not useful:** the wiki's own meta sections — "AI First Tech Picks" and "Tech Tree Colors" — both carry `{{ObsoleteBox}}` and the first says "This entire section is outdated." Do not build on them. This is the main reason the value model derives from templates rather than from guides.

**Notion was not consulted.** The Notion MCP server requires authorization that is unavailable in a non-interactive session. If Notion holds campaign-specific doctrine worth encoding, it has to be exported or the connector authorized first.

---

## 2. What the advisor outputs

For each candidate tech/project, two independent scores — never summed into one number without a stated exchange rate:

**Military value** — from unlocks, priced against what the observer currently fields:
> *"Project_HeavyRailMk3 unlocks a 3.2× DPS-per-ton improvement over your best current weapon, and fits the Battlecruiser's 3 nose hardpoints."*

**Economic value** — from effects, priced against this save's actual numbers:
> *"+5% space mining is +14.2 water/month at your current 284/month, and lifts your metals runway from 31 to 34 months."*

Plus, for both: **remaining cost** (`researchCost` minus accumulated progress, via the existing `tech-path` endpoint), **prerequisite chain**, and **time to complete** at current research income.

The recommendation ranks by **value per research-point**, not by raw value — a 150,000-cost tech with twice the benefit of a 25,000-cost one is worse.

---

## 3. Derived military metrics

Compute from unlock stats, and state the formula next to the number:

- **Weapon:** `shotPower_MJ / cooldown_s` = MW of sustained output; divide by `baseWeaponMass_tons` for DPS-per-ton. Range from `mirrorRadius_cm` and `wavelength_nm` (diffraction-limited spot growth) rather than `targetingRange_km` alone.
- **Hull:** `noseHardpoints + hullHardpoints` × best available weapon = throw weight; against `structuralIntegrity` and `mass_tons` for survivability-per-ton; `missionControl` is the ongoing cost, `baseConstructionTime_days` the delay.
- **Drive:** `EV_kps` sets ΔV per unit propellant; `thrust_N / mass` sets acceleration. Both matter and they trade off — report both, never a blended "drive score".

**Comparison baseline is the observer's current best**, not an absolute scale. "3.2× your best" is actionable; "tier 4 weapon" is not.

This connects to the Hold Ground directive, which already computes the dominant capability deficit (ΔV, armour, or hull count). **The research advisor should rank unlocks that close the measured deficit first** — if ΔV is the gap, drive techs outrank weapon techs regardless of raw value.

---

## 3a. Propulsion — build this first

The highest-value slice, and the only one whose physics is **validated against the game's own output**.

### The model, verified exact

```
ΔV            = EV_kps × ln(wet_mass / dry_mass)
cruise accel  = thrust_N / wet_mass
combat accel  = thrust_N × drive.thrustCap / wet_mass
```

Checked against `currentMaxDeltaVKps` for every observer ship across multiple designs and drives — **ratio 1.000, exact, no fudge factor**. `cruiseAccelerationMps2` likewise reproduces exactly. The combat/cruise ratio resolves to `drive.thrustCap` (verified: `thrustCap 9` designs show ratio 9.0000, `thrustCap 24` show 24.0000).

Inputs: `fleets[].ships[]` gives `currentMassKg` and `propellantTons`; `shipDesigns[]` gives `driveName` and `hullName`; `TIDriveTemplate.json` gives `EV_kps`, `thrust_N`, `thrustCap`, `propellant`.

Because the model reproduces measured values exactly, **what-if refits onto drives the observer has never built are trustworthy**.

### The finding that dictates the design

Ranking drives by EV alone produces actively harmful advice. Refitting a real ship (Lena, Huang He Block 2, wet 5,936 t / dry 4,436 t):

| drive | ΔV kps | cruise | combat accel |
| :-- | --: | --: | --: |
| **BurnerDrivex6** (in service) | 20.1 | 0.1092 | **2.620** |
| PulsedPlasmoidDrivex6 | 124 (6.2×) | 0.0022 | **0.002** — 1,300× worse |
| HeliconDrivex6 | 91 (4.5×) | 0.0202 | 0.404 — 6.5× worse |
| FissionFragDrivex6 | 91 | 0.0047 | 0.009 |
| VASIMRx6 | 43 | 0.0010 | 0.061 |

`Project_PulsedPlasmoidDrive` costs **500 research with every prerequisite already met** and offers 6.2× the ΔV — and would turn a manoeuvring warship into a barge. A naive "best EV, cheapest, already unlocked" recommender surfaces it first.

**So the advisor must never rank drives on a single scalar.** ΔV and thrust are in direct tension, and which wins depends entirely on the hull's role:

- **Warship** — combat acceleration decides whether you can close or disengage. Rank by `thrust × thrustCap / mass`, with ΔV as a floor constraint (enough to reach the theatre).
- **Transport / prospector / explorer** — ΔV is reach. Rank by ΔV, with acceleration as a floor (enough to make transfer windows).

Role should be inferred from the design's weapon loadout and hull, and **stated**, because it determines the entire ranking.

### The alien benchmark

Alien fleets show `lowestDeltaVKps` 691 against the observer's 14–20. The cause is visible in the templates: **`AdvancedAlienFusionTorch` — EV 1,600 *and* thrust 4.4M–26.3M, `thrustCap` 50.** They are not trading reach for thrust; they have both.

The human Pareto frontier on (EV, thrust) is short:

| drive | EV | thrust_N | cap | gated behind |
| :-- | --: | --: | --: | :-- |
| PionTorchx6 | 14,720 | 60,000,000 | 60 | `Project_AntimatterBeamCoreTorch` |
| NeutronFluxTorchx6 | 1,700 | 78,000,000 | 2 | `Project_NeutronFluxTorch` |
| DianaSuperheavyRocketx6 | 3.73 | 120,960,000 | 1 | `Project_SuperheavyRockets` |

Everything else is dominated. **No reachable drive closes the alien gap** — the answer is the torch line, and the advisor should say that plainly rather than offering a 500-cost project that looks like progress. This is the concrete research answer to the Hold Ground posture, which currently reports ΔV as the dominant capability deficit.

### Output

Per design in service: current ΔV / cruise / combat, the same three under each candidate refit, the role-appropriate ranking, and the research cost and prerequisite gap for each. Per candidate drive: whether it is unlocked, reachable (all prereqs met), or how many steps away.

Verified reachability on the current save — `PulsedPlasmoid`, `Helicon`, `FissionFrag`, `VASIMR`, `Lorentz`, `PlasmaWave` all have zero unmet prerequisites; `GridDrive`, `AdvancedMinimagOrion` and the microfission line are one prerequisite away.

---

## 4. Economic valuation

Each context-scoped effect maps to a live quantity in the snapshot:

| context | applied against |
| :-- | :-- |
| `SpaceMiningBonus` | current per-resource mining output |
| `Economy_BasePCGDPIncrease` | controlled nations' GDP |
| `MCFreeSpaceMineNetwork` | mission control headroom vs the mine-limit penalty |
| `ShipConstructionTime` | queued hull build days |
| `ControlPointResearch` | research income |

Multiply the effect by the observer's actual figure. Where the target quantity is **unmeasured, the value is `null`** and the tech is reported as "benefit not quantifiable from this save" — never scored as zero. That is the repo's most-repeated defect class and this feature is unusually exposed to it, because a tech whose value silently computes to 0 gets ranked last and never surfaces.

**Stacking matters.** `stackable: true` effects (e.g. `SpaceMiningBonus5`) compound with ones already active; `IncreaseToValue` does not stack and is worthless if already at value. Read the observer's completed projects before valuing.

---

## 5. Player mode

`AI_techRole`, effects, unlock stats and the tech graph are all **static template data**, so they are equally available in both modes — the advisor's core is not mode-sensitive.

What *is* mode-sensitive:
- **Enemy project state.** The existing `tech-tree` endpoint already respects this (`player` = only legitimately known).
- **Comparative claims.** "This closes the gap with the aliens" needs alien design values, which are **redacted in player mode** — verified 0 alien `shipDesigns` in player vs 82 in omniscient. Fall back to observable alien *fleet* metrics (`armorMedian`, `lowestDeltaVKps`), as the Hold Ground simulation already does, and label the basis.

---

## 6. Slot allocation (separate, high-value)

The allocation formula above means the current pip distribution is probably not optimal, and the optimum is computable. Report the current effective research per slot, the best reallocation, and the monthly delta.

Worth building **after** the value model — it is a smaller win and depends on knowing which categories matter.

---

## 7. Honesty requirements

- Every derived metric states its formula. A "3.2× DPS/ton" claim that cannot be traced is not usable.
- **Template-derived facts and judgement calls are visually distinct.** `AI_techRole` is shipped data; "drives outrank weapons for you right now" is our inference from the measured deficit.
- Obsolete wiki content is excluded by name, not silently blended in.
- Unquantifiable benefit → `null` and stated, never 0.
- Deterministic: same snapshot → same ranking.

## 8. Acceptance

- Ranks candidates by value-per-research-point, in **both** modes, on the live save.
- Every recommendation shows: remaining cost, prereq chain, time at current income, and the specific unlock or effect driving it.
- Military ranking shifts when the measured capability deficit shifts — a save where armour is the gap must not recommend drives.
- A tech whose benefit cannot be quantified is surfaced as such, not ranked last with a silent 0.
- No claim sourced from an `{{ObsoleteBox}}` wiki section.
- Zero `null` / `undefined` / `NaN` in rendered output.

## 9. Sequencing

1. Unlock index — reverse-map all 16 gated template families to their `requiredProjectName`. Everything else depends on it, and it is pure data with no judgement.
2. Military valuation against the observer's current best.
3. Economic valuation against live quantities.
4. Ranking, deficit-aware ordering, and the UI panel.
5. Slot allocation.
