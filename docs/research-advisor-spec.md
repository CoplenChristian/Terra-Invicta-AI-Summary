# Research Advisor — Spec

Make the dashboard say **what to research next and why**, separated into military and economic value, with the numbers behind each claim.

Written 2026-08-21 against `f5a0731`. Every data claim below is measured against the installed 1.0 templates or the live save.

---

## 0. Everything is snapshot-driven; nothing is campaign-specific

**This advisor must work on a fresh campaign comparing chemical rockets, not just on a late save comparing fusion torches.** Every number in this document is an example measured from one save, included as evidence that the model works — none of them is a constant.

Concretely, the following must all be **read from the snapshot at request time**, never hardcoded:

| never hardcode | always derive from |
| :-- | :-- |
| the observer's current best drive / weapon / hull | their designs actually in service |
| the comparison baseline | the observer's own fielded equipment, whatever it is |
| which projects are candidates | `availableProjectNames` for this faction, this save |
| what "good" ΔV or acceleration is | the observer's current figures and the measured deficit |
| the alien capability benchmark | observed alien fleets, respecting mode redaction |
| observer faction id | the requested observer, not `4712` |
| the tech/effect/unlock tables | the installed templates, baked onto the snapshot at build time |

The templates are static per game version and are already resolved at snapshot-build time — `buildShipHullStats` and `buildMissionSpecs` set the precedent, and it exists because the hosted worker has no template directory. Follow it: the advisor must run identically against a published snapshot with no filesystem.

A useful test of whether this has been done properly: **the module should produce sensible output on a turn-1 save**, where the observer flies nothing, has completed nothing, and the only available drives are chemical. If it needs a late-game save to say anything, it has been written against this campaign rather than against the data.

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

### Four corrections, measured 2026-08-21 while building phase 2

**1. Hardpoint cost is per mount, not per weapon.** A weapon states a `mount`
(`OneNose`, `ThreeNoseAngle`, `FourHull`, …) and that mount is what consumes
hardpoints, so "hardpoints × best weapon" is really `hardpoints ×
best output-per-hardpoint`. The per-mount costs (One 1, Two 2, Three 3, Four 4,
Half 0.5) reproduce the hardpoint fill of **all 515 ship designs** in the
sampled save exactly, nose and hull independently, with the game's `Empty`
padding entries costing nothing. Perturbing one cost drops the match to 397/515,
so the check is not vacuous. `HalfNose` and `HalfHull` are used by no design in
the save and are labelled unverified rather than folded in with the seven that
were checked.

**2. Matter weapons state no damage; kinetic energy is the model, and it is
exact.** `0.5 × warheadMass_kg × muzzleVelocity_kps²` reproduces the game's own
`damage_MJ` for all 7 guns that carry it and `expectedDamage_MJ` for all 16
plasma weapons at **ratio 1.000000**. That pin is what licenses applying the
same formula to the 70 magnetic guns, which carry the same two inputs and no
shipped figure. 31 of 57 missiles (Fragmentation and Penetrator warheads) state
no damage figure and no inputs that yield one — they are reported as
not-comparable, never scored zero.

**3. The armour half-value derivation is wrong and was dropped.** Reading
`baryonicHalfValue_cm` as a half-value layer and pricing it per unit area
(`cm/100 × density_kgm3`) makes Steel (589 kg/m²) and Titanium (506) the most
mass-efficient baryonic armours in the game and Nanotube (2,673) one of the
worst — the exact reverse of the shipped `BaryonicResistance` ratings (Steel
1.00, Titanium 1.11, Nanotube 19.78, Adamantane 31.02). All 12 armour templates
carry `XRayResistance` and `BaryonicResistance` outright, so those are the axes
and nothing is derived from the half-value fields. **Which of the two channels
ranks first is set by the observed threat mix**, weighted by each hostile
weapon's modelled sustained output; with nothing hostile observable the endpoint
declines to rank rather than defaulting to a channel.

**4. A rate needs its magazine beside it.** `AntimatterTorpedoLauncher` carries
a 22.47 TJ warhead on a 7 s cycle, which is 3.2 GW of "sustained" output — held
for 28 seconds, because the magazine is four rounds. Sustained output is
reported with `sustainedOutputDurationS` and `magazineEnergyMJ` beside it. Beam
weapons carry no magazine field at all; that is a fact about them
(power-limited, not ammunition-limited) rather than a missing measurement, and
the two are reported as different codes.

**Comparison baseline is the observer's current best**, not an absolute scale. "3.2× your best" is actionable; "tier 4 weapon" is not.

This connects to the Hold Ground directive, which already computes the dominant capability deficit (ΔV, armour, or hull count). **The research advisor should rank unlocks that close the measured deficit first** — if ΔV is the gap, drive techs outrank weapon techs regardless of raw value.

---

## 3a. Propulsion — build this first

The highest-value slice, and the only one whose physics is **validated against the game's own output**.

### The model, verified exact

```
EV_effective  = drive.EV_kps × Π(EVMultiplier modules the drive's propellant satisfies)
ΔV            = EV_effective × ln(wet_mass / dry_mass)
cruise accel  = thrust_N / wet_mass
combat accel  = thrust_N × drive.thrustCap / wet_mass
```

Checked against `currentMaxDeltaVKps` for every observer ship across multiple designs and drives — **ratio 1.000, exact, no fudge factor**. `cruiseAccelerationMps2` likewise reproduces exactly. The combat/cruise ratio resolves to `drive.thrustCap` (verified: `thrustCap 9` designs show ratio 9.0000, `thrustCap 24` show 24.0000).

Inputs: `fleets[].ships[]` gives `currentMassKg` and `propellantTons`; `shipDesigns[]` gives `driveName` and `hullName`; `TIDriveTemplate.json` gives `EV_kps`, `thrust_N`, `thrustCap`, `propellant`.

Because the model reproduces measured values exactly, **what-if refits onto drives the observer has never built are trustworthy**.

#### Two corrections, measured 2026-08-21 while building phase 1

Both were found by widening the check from the observer to all 698 ships in the
save. The three-line model above is right for the observer on the sampled save
and wrong in general; these are the missing terms.

**1. The `EVMultiplier` term is not optional.** Five utility modules multiply
effective exhaust velocity — `LiquidHydrogenContainment` 1.2,
`SlushHydrogenTankage` 1.35, `HydronTrap` 1.5, `AlienSlushHydrogenTankage` 1.5,
`AlienHydronTrap` 2.0 — carried in `specialModuleRules` / `specialModuleValue`.
All five also carry `RequiresHydrogenPropellant`, so the multiplier applies only
when `drive.propellant === 'Hydrogen'`. Without the term, ΔV reproduces for only
four of the eight factions; with it, **696 of 698 ships** match exactly. The
observer happened to fly no such module on the sampled save, which is why the
original check missed it. It matters directly for refits: swapping a hydrogen
drive for a non-hydrogen one **loses** the multiplier, so a naive refit
overstates the candidate's reach by up to 2×.

**2. ΔV and acceleration are reported against different masses.** Measurable on
the three observer ships not at full tanks:

| save field | mass it is computed against |
| :-- | :-- |
| `currentDeltaVKps` | the ship's **current** mass |
| `currentMaxDeltaVKps` | the ship at **full tanks** |
| `cruise` / `combatAccelerationMps2` | the ship at **full tanks** (rated, not current) |

Using current mass for acceleration overstates a half-empty hull by up to 1.72×
on this save. Full-tank mass is derivable from the save without a tons-per-tank
constant: a ship already at full tanks is its own full-tank mass, and a
partially fuelled one inverts the rocket equation through its measured
`currentMaxDeltaVKps`. A ship supporting neither path reports `null` capacity
and no refit.

**Where the model does not hold.** Alien hulls: ΔV matches 381/410, acceleration
frequently does not — alien hulls carry performance the design record does not
explain. One damaged human hull reports an acceleration corresponding to no mass
in the save. Both are surfaced as **model disagreements with the ratio visible**,
never as a modelled figure presented as fact.

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

Per design in service: current ΔV / cruise / combat, the same three under each candidate refit, the role-appropriate ranking, and the research cost and availability state for each. Per candidate drive: whether it is researchable **now**, prerequisite-blocked, or prerequisite-clear but not yet unlocked (§3b).

Every drive name, threshold and comparison above is an **example from one save, not a constant**. The observer's current best is whatever their designs actually fly; the candidate set is whatever the snapshot says is available. An early-campaign save comparing chemical rockets must work identically — see §0.

---

## 3b. Availability is rolled monthly, not derived from prerequisites

**Prerequisites met does not mean researchable.** Every one of the 750 projects carries unlock-chance fields:

```json
{ "dataName": "Project_AntimatterBeamCoreTorch",
  "initialUnlockChance": 0, "deltaUnlockChance": 5, "maxUnlockChance": 10,
  "factionAvailableChance": 100,
  "prereqs": ["AntimatterPropulsion","MagneticNozzles","Project_AntimatterBeamCoreReactor"] }
```

Once prerequisites are satisfied the project rolls each month — starting at `initialUnlockChance`, rising by `deltaUnlockChance`, capped at `maxUnlockChance`. A project capped at 50% may **never** appear in a given campaign. Distribution across all projects: 351 cap at 100%, 249 at 50%, and 92 lower still.

Measured on one save, computing availability from prerequisites instead of reading it:

```
uncompleted projects with ALL prereqs met:  274
  ...of which NOT actually available:       104   (38% wrongly offered)
  available despite unmet prereqs:            5   (wrongly hidden)
```

`Project_ANewHome`, `Project_AppeaseVictory`, `Project_TheirWeakness` all have every prerequisite satisfied and are not available.

**The authoritative source is the snapshot**: `factions[observer].availableProjectNames` (175 entries on the sampled save) and `availableProjectsCount`. Read it. Do not recompute it, and never present a prerequisite-derived list as "what you can research".

Three distinct states, and the UI must distinguish them:

| state | source | how it reads |
| :-- | :-- | :-- |
| **Researchable now** | in `availableProjectNames` | offer it, with cost and time |
| **Prereq-clear, not yet rolled** | prereqs met, absent from the list | "not yet available — up to N%/month once prerequisites hold, capped at M%" |
| **Prereq-blocked** | unmet prereqs | name the missing prerequisites |

Collapsing the middle state into either neighbour is the failure mode. Reporting it as researchable offers something the player cannot select; reporting it as blocked hides a target they should be steering toward.

Because global tech completion does not imply personal visibility, **never infer availability from `globalResearch.finishedTechsNames`**. That set reflects the world, not this faction.

(Global tech *completion* is a different question. `finishedTechsNames` is the
correct and only source for whether a **global-tech prerequisite** is satisfied,
because global techs genuinely are world state. The prohibition is on deriving
project availability from it.)

### A fourth state, found while building phase 1 — measured 2026-08-21

Two template gates put a project outside all three states above, and folding
them into the middle one is the same error §3b exists to prevent:

- **`factionPrereq`** — 103 projects are restricted to named faction templates
  (`AlienCouncil`, `SubmitCouncil`, …), matched against `faction.templateName`.
- **`researchCost: -1`** — marks a project that is never researched at all.
  Left alone it becomes `max(0, −1 − 0)` = 0 remaining, which renders as free.

### A fifth state, found while building phase 2 — measured 2026-08-21

**`ungated`.** 33 of the 125 laser templates carry no `requiredProjectName` at
all, along with a handful of hulls, armours, reactors and radiators. Nothing
unlocks them because nothing needs to: what makes them usable is whatever mounts
them. Reporting these as `completed` claims the observer finished a project that
does not exist; reporting them as `unknown` hides that they cost nothing. They
get their own state, for the same reason the middle three above have theirs.

`Project_AlienMasterProject` carries both. Its prerequisites are trivially met,
so without this gate it reads as *"prerequisites clear, rolls at 100%/month,
cost 0"* — an unreachable target rendered as imminent. On the sampled save this
misclassified **18 of 541 drives** for the observer. The implementation emits
these as a distinct `faction-restricted` state naming the eligible factions, and
reports a negative cost as `null` rather than zero.

Where a long-term target is prereq-clear but unrolled, the advisor may still recommend the *path* — but must say the final step depends on a monthly roll and state the cap. A plan whose last step is a 50% coin-flip that may never land is a different proposition from a plan that merely costs research, and the player is entitled to know which one they are being handed.

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

## 4a. What phase 3 substantiated, and what it did not — measured 2026-08-21

### The candidate set is far smaller than 719

Only **275 of the 719** effect templates are referenced by any tech or project;
the other 444 belong to narrative events, missions and orgs and the advisor can
never be asked about one. Of the 275, **209 are context-scoped and 66 are
instant grants**, spanning **140 contexts** and **20 instant-effect kinds**.
Three of the four instant families §4 named — `NationGDPPctChange`,
`GainMoneyIncome`, `CouncilorModifyAttribute` — turn out to be **unreachable
from research entirely**; only `MapRegionGDPPctChange_StrValue` (30) and
`FactionAllCouncilorsModifyAttribute` (11) are significant.

### The fourteen substantiated mappings

| context | live quantity | snapshot field |
| :-- | :-- | :-- |
| `SpaceMiningBonus` | total mined output | `habSites[owned]` summed × 30 |
| `Mining{Water,Volatiles,Metals,Nobles,Fissiles}Bonus` | per-resource output | `habSites[owned].<resource>` × 30 |
| `Economy_BasePCGDPIncrease` | controlled-nation GDP | `nations[].GDP` where the observer holds a control point |
| `ControlPointResearch` | control-point research | `researchBreakdown.earthControlPointShare` |
| `HabResearchProduction` | orbital-lab research | `habModules[owned].researchIncomeMonth` |
| `ShipConstructionTime` | queued build days | `shipyardQueues[owned].daysToCompletion` |
| `MCFreeSpaceMineNetwork` | mines beyond the free allowance | mine count vs the additive allowance |
| `HabMissionControlReduction` | hab-core MC cost | negative `componentStats.hab_module[].missionControl` |
| `ShipMissionControlReduction` | ship MC cost | `fleets[owned].ships[].missionControlConsumption` |
| `CouncilSize` | council size | `councilors[owned]` |

`resourcesGranted` is priced separately, in **months of the observer's own
income** in that resource, and kept out of the per-month totals because a
windfall is not a rate.

### The 126 that were not

Named individually in the response with the count of effects using each, grouped
by why: **mission modifiers** (a covert-operations axis with its own odds model),
**nation priorities** (the snapshot carries no priority sliders), **ground and
orbital combat**, **capability unlocks** (booleans, not rates), **space
operations** (phases 1 and 2 own those), and **council/org parameters** (no
recruit pool or org market in the snapshot). `ControlPointMaintenance` was
considered and rejected: the observer's Influence expense is measured but the
ledger is not decomposed into maintenance versus org upkeep versus mission cost,
so no mapping was invented for it.

Priced contexts cover **18 of 211** context effect references (8.5%). That
number is low and is reported rather than hidden — most of what research does is
not an economic flow.

### What is pinned

**`missionControlUsage` is pinned exactly.** Summing each ship's
`missionControlConsumption` and the negative `missionControl` of every hab core
reproduces the save's own figure for **7 of the 8 factions**: Resistance 65=65,
Humanity First 147=147, Initiative 147=147, Protectorate 143=143, Academy 79=79,
Project Exodus 93=93, Aliens 412=412. The Servants carry a **+40 residual the
model does not explain**, surfaced with the residual visible rather than
absorbed — the same treatment phase 1 gives alien hulls whose acceleration it
cannot reproduce. Perturbing one hab core by one point drops the match, so the
check is not vacuous.

**Two cross-checks, which are internal consistency and not game output.**
Summed controlled-nation GDP equals `faction.totalGdp` for all 8 factions in
both modes. The reconstructed active-effect baseline yields exactly the 72
distinct effects `capabilities.activeEffects` lists — the reconstruction exists
anyway because that list is a *set* and loses multiplicity, and a stackable
effect held three times is not the state of holding it once.

**Mining is NOT pinned, and says so.** Faction resource income also carries
transfers, alien resource sharing and in-situ production; the ratio of summed
site output to reported income runs **0.81 to 4.43** across the eight factions,
so no arithmetic isolates the mining term. The quantity is the summed *site*
output, labelled as that.

**The operation semantics are MODELLED.** `Additive` / `Multiplicative` /
`IncreaseToValue` / `DecreaseToValue` / `SetToFixedValue` are read from their
names; the game publishes no statement of what they mean. Every derivation that
depends on the reading carries `validatedAgainstGameOutput: false`, and exactly
one formula in the module carries `true`.

### Three states, never two

`inert` — a **measured** zero — is a separate state from `unpriceable`, because
"worth nothing right now" and "not measurable" are different facts. The live
save exercises both: the observer's build queue is empty, so a 20%
construction-time reduction is `inert / quantity-is-zero`; and their 16 mines sit
inside an 18-mine free allowance, so more free mines are
`inert / allowance-not-binding`. Neither is a silent zero and neither is a null.

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

## 7a. What phase 4 composed, and the two things it had to fix — measured 2026-08-21

### The deficit computation moved rather than being copied

`summarizeFleetCapability` was extracted from `server/directiveAdvisor.js` into
`shared/fleetCapability.mjs`, unchanged. Hold Ground requires it back and
re-exports it, so every existing caller and test is untouched; the ranking
imports the same function. The move was forced rather than cosmetic — the intel
projections run in the hosted Cloudflare worker, which cannot `require`
CommonJS, so the alternative was a second derivation of "which axis is the gap".
Breaking `DECISIVE_CAPABILITY_RATIO` in the shared module fails **19** tests
across both consumers, so the two really are reading one implementation.

### The ordering, and what it refuses to do

Two tracks, never summed. Within a track, rows are grouped by availability state
and ranked **inside** a group, deficit-closing candidates first:

```
militaryValuePerResearchPoint = (rankMetricMultiple - 1) / remainingResearchCost
economicValuePerResearchPoint = phase 3's own byUnit[].perResearchPoint
```

The `- 1` is load-bearing: a 1.0× multiple is not worth a single research point
and must not score as though it were worth 1.0.

Measured on the live save (ExitSave, 1/1/2034, observer 4712): 80 military
candidates considered, **16 ranked**; the other 64 split 38 `no baseline`, 10
`buildable now`, 8 `no gain`, 8 `cost unknown`. 279 economic candidates, **24
ranked** across four units. Both figures are shown on the card — a ranking that
displayed only its 16 rows would imply it had priced everything.

Ranking across classes is a **triage aid, not an exchange rate**: 3.2× armour
and 3.2× laser output are not commensurable, every row names its own axis, and
the caveat is in the payload rather than only in the code.

### Two defects the composition surfaced

**1. A saving sorted as a loss.** The mission-control contexts are
`direction: 'lower'`, so a helpful tech prices as a *negative* delta
(−16.65 mission control is a saving). Ordering the raw value descending put the
**smallest** saving first — the ranking silently inverted for one unit. Rows are
now oriented from phase 3's own direction table before sorting; a row whose
priced contexts disagree about direction is not ordered at all, with the reason
attached, rather than being sorted by a sign nobody checked.

**2. A dice throw that was already over.** The unlock chance was rendered on
every row, so a `researchable-now` candidate read "rolls 25%/mo, cap 100%" — the
roll that had already landed, described as still pending. It is now shown only
in `prereq-clear-but-unrolled`, which is the one state where it is a fact about
what happens next. This is §3b's state-collapsing error, inverted.

### The panel

COMMAND, not RECORDS: *"what do I research next"* is a decision taken this turn,
beside Council Orders and the Directive Engine. RECORDS' Technology Watch
answers *"what happened"*.

Measured at 1920×1080 in both modes: card **345 px**, 0% empty, COMMAND page
**3,234 px (2.99 screens)** against 3,130 px / 2.90 before. No horizontal scroll
at 375 / 900 / 1366 / 1660 / 1920, zero console errors, zero 4xx, and zero
forbidden tokens in a full-page `textContent` scan. The renderer's rule is that
**only strings it authors reach the DOM** — several upstream `reason` fields use
the word "null" as a technical term, so they travel as `title` tooltips instead.

## 8. Acceptance

- Ranks candidates by value-per-research-point, in **both** modes, on the live save AND on an early-campaign save where the only drives are chemical.
- Candidate set comes from `availableProjectNames`; a prerequisite-derived list is a defect. Prereq-clear-but-unrolled renders as its own state with the monthly chance and cap stated.
- Every recommendation shows: remaining cost, prereq chain, time at current income, and the specific unlock or effect driving it.
- Military ranking shifts when the measured capability deficit shifts — a save where armour is the gap must not recommend drives.
- A tech whose benefit cannot be quantified is surfaced as such, not ranked last with a silent 0.
- No claim sourced from an `{{ObsoleteBox}}` wiki section.
- Zero `null` / `undefined` / `NaN` in rendered output.

## 9. Sequencing

1. ~~Unlock index — reverse-map all 16 gated template families to their `requiredProjectName`. Everything else depends on it, and it is pure data with no judgement.~~ **Built 2026-08-21**, together with the propulsion model and `/api/intel/propulsion`. Note one correction: fifteen families carry `requiredProjectName`, but **orgs (83) carry `requiredTechName`** — the gate is a global tech, not a faction project, and the two must not be flattened. All sixteen counts verified against the installed templates: 1,223 gated entries across 436 gates.
2. ~~Military valuation against the observer's current best.~~ **Built
   2026-08-21** as `/api/intel/military-value`, covering the fourteen unlock
   families phase 1 did not: the six weapon families (split by role, because
   point defence is a separate axis), ship hulls, ship armour, power plants,
   radiators, heat sinks, batteries, utility modules and hab modules. 17
   comparison classes over 661 catalogue items, each declaring one ranking axis
   and a stated floor on the axis it trades against — never a blended score.
   Baked payload `componentStats`: **+166.7 KB raw / +17.0 KB gzipped**, 4.9% of
   the published player row. Utility and hab modules are compared *within* a
   shared special rule and never across rules, because there is no exchange rate
   between an exhaust-velocity multiplier and a targeting computer. Hab-module
   income is deliberately not valued here; that is step 3.
3. ~~Economic valuation against live quantities.~~ **Built 2026-08-21** as
   `/api/intel/economic-value`. Prices each candidate's effects, resource grants
   and org grant against the observer's own figures, in three states that never
   share a value: `priced` (a number), `inert` (a **measured** zero with the
   reason it is zero) and `unpriceable` (null, with the context named). Baked
   payload `effectIndex`: **+51.1 KB raw / +6.8 KB gzipped**, 2.1% of the
   2,480 KB published player row — only the four fields the tech tree's own effect
   records omit (`contexts`, `stackable`, `instantEffect`, non-permanent
   duration), and only for the **275 of 719** effects a tech or project can
   actually reference. See §4a for what was and was not substantiated.
4. ~~Ranking, deficit-aware ordering, and the UI panel.~~ **Built 2026-08-21**
   as `/api/intel/research-ranking` and the **RESEARCH ADVISOR** card in the v2
   COMMAND view. See §7a for what it measured.
5. Slot allocation.
