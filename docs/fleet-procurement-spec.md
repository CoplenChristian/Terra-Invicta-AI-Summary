# Fleet Procurement — its own view, and a validated refit advisor

Written 2026-08-21 against `bbef9f0`. **Revised 2026-08-21 against `b0ec6dc`** after an
independent review found four reuse claims in the first draft that the code does not
support. The superseded design is recorded at the end rather than deleted, per
`docs/README.md`.

**Part A ships now.** **Part B is narrowed to a refit advisor**; the general design
composer the first draft described cannot be built honestly against the current snapshot,
and the missing pieces are named below.

**Routing:** Part A is frontend (Antigravity). Part B slice 1 is backend composition and
validation (DeepSeek), with rendering back to Antigravity.

---

# Part A — move "ALREADY UNLOCKED, NOT IN SERVICE" out

`docs/research-vs-procurement-spec.md` split the zero-cost rows out of the ranked research
list and deliberately left open whether they belong in that panel at all. They do not.
This resolves it.

The backend already emits `military.procurement` as its own object with `label`, `count`
and `items`, and the Research Advisor fetches `/api/intel/research-ranking` directly at
[`mission-control.js:1044`](../public/v2/js/mission-control.js). **Part A needs no backend
change** — a new FLEET panel reads the same `procurement` object, and
`research-advisor.js` stops rendering `.ra-procurement`.

## Where it goes

The registry comment at [`mission-control.js:131`](../public/v2/js/mission-control.js)
states the grouping principle: COMMAND *"what do I do this turn"*, EXPANSION *"where do I
grow"*, THREAT *"what is coming"*, RECORDS *"what happened"*. "What do I build" is a fifth
question, and COMMAND is at the 3.00-screen ceiling.

Add a fifth view: `id: 'fleet'`, `sectionId: 'view-fleet'`, plus a nav button.

## The pins a fifth view breaks

The first draft missed these entirely. **Four separate places hardcode exactly four
views**, and adding a fifth turns the suite red immediately:

```
tests/v2Navigation.test.js:102   assert.strictEqual(VIEWS.length, 4)
tests/v2Navigation.test.js:105   deepStrictEqual(viewIds, ['command','expansion','threat','records'])
tests/v2Navigation.test.js:52    sectionIds = ['view-command','view-expansion','view-threat','view-records']
scripts/verify_v2_navigation.js:48, :84   the same four ids, twice
scripts/verify_research_vs_procurement.js  assumes procurement renders inside the advisor
tests/researchRanking.test.js    pins the procurement heading inside research-advisor HTML
public/v2/index.html             four nav buttons and four view sections
```

Update all of them **deliberately**, as part of the change — not by loosening the
assertion to `>= 4`. The exactly-four pin exists so a view cannot be added without someone
noticing; keep it exact at five.

Per `CLAUDE.md`, a rendered panel needs a registry entry and a startup assertion —
`assertViewRegistryIntegrity()` must pass, which checks the section exists, each panel
exists and is inside its section, and no panel is registered twice.

## Lift the two-row cap, or announce it

[`research-advisor.js:44`](../public/v2/js/components/research-advisor.js) sets
`ROWS_PER_GROUP = 2`, and line 786 applies `procurementItems.slice(0, ROWS_PER_GROUP)`.
**Of four unfielded items, two never render.** The header says `4 unfielded` while the list
shows two.

That is the "truncation must announce itself" rule already being violated, and moving the
block to a view with room makes it indefensible. The backend already carries `itemsShown`
— carry `itemsShown` / `itemsOmittedCount` to the consumer, and either lift the cap in the
new view (which has vertical room COMMAND did not) or state what is hidden.

## Copy

The spec's first draft quoted `4 UNFILLED`. The renderer prints `${count} unfielded` from
`payload.military.procurement.count`. Match the code, not the screenshot.

## Acceptance — Part A

- The procurement block renders in FLEET and nowhere else.
- `assertViewRegistryIntegrity()` passes; the nav button, section, and registry entry exist.
- All four hardcoded four-view locations updated to five, still exact.
- No zero-research-cost row remains in the Research Advisor.
- Every unfielded item renders, or `itemsOmittedCount` is visible.
- COMMAND's measured screen count reported, and lower than before.
- Both modes. Full suite green; report exact pass/fail/skip.

---

# Part B — a validated refit advisor, not a design composer

## Measured 2026-08-21, corrected after review: one blocker solved, the composer stays closed

An earlier revision of this section claimed power, hardpoints and reactor class all pinned
at 580/580 and that "three of four blockers are solved". **Two of those three claims were
wrong**, and the mass pin was then run and failed. Corrected below; the superseded claim is
left visible because the error is instructive.

### Mass does not pin — the composer stays deferred

The question posed was whether a component-sum dry mass reproduces `resolveShipMass` on
fitted ships. It was run against 277 human hulls with measurable dry mass:

```
within 0.5% (the propulsion standard)      4 / 277
within 1%                                  8 / 277
median                                     1.15x  (15% HEAVY)
worst                                      2.08x  (Protectorate Venator)
Initiative hulls in service                0 of 30 within 1%
alien hulls                                2 of 420 within 15%
```

The gap is **not** a missing bake. Hull, weapon and utility masses resolve exactly; they
are simply not most of the ship. Three specific failures:

1. **Thermal drive mass is legitimately `0`.** `NervaDrivex5` and Burner ×6 carry
   `specificPower_kgMW: 0` and `flatMass_tons: 0`. Summing "the fields that exist" makes
   the drive massless.
2. **Armour geometry does not pin.** Without armour and radiator the sum is ~0.50× measured;
   adding the geometry formula overshoots.
3. **Radiator mass is an output of the heat model, not a template field.** There are three
   cooling modes — `Open` (109 drives), `Calc` (186), `Closed` (246). `Calc` is Nerva's mode.
   A naive attempt put 4,979 t of radiator on `Venator`.

A 15% miss is exactly the silent ΔV and acceleration inflation this spec warned about, now
measured rather than feared. **Do not reopen the composer on the basis that "all the inputs
exist".** That is true of the geometry and false of the kilograms.

### Reactor class — real, load-bearing, and worth baking

A drive's `requiredPowerPlant` must equal the reactor's `powerPlantClass`, or be the
sentinel `Any_General`. There are 13 classes. This **pins 580/580** independently and is a
genuine legality rule that draft 1 did not know about; a composer without it emits illegal
designs. **Bake `requiredPowerPlant` and `powerPlantClass`.**

### Power is information, not a veto

Two corrections, both material:

**The 580/580 figure was an artifact of a parsing bug.** Template power figures are
**strings with thousands separators** — `AlienFusionTorchx2` carries
`req power: "2,130.928"`. `Number()` of that is `NaN`; a `?? 0` fallback then scored the
drive as drawing **zero**. **92 of 541 drives** are comma-formatted, and they are
disproportionately the high-power ones. Re-measured with a comma-safe parser: **577 pass /
3 fail**.

This is the `Number(null) === 0` failure for the third time in this feature's history, and
the second time in this document. Any parser touching template numerics must strip
separators and treat an unparseable value as **null, never zero**.

**More importantly, the game does not veto an underpowered ship — it scales thrust.**
`Breaking Wave` (alien, `AlienFusionTorchx2`) is a fielded, legal design drawing 2,131 GW
against a 1,000 GW plant — 2.13× over. A pass/fail power budget would reject designs the
game's own designer accepts.

So **power reports plant output against required draw as information**, plus the
thrust-scaling consequence. It is not a veto and must not be rendered as one.

**And the pin was one-sided.** 580 designs the game accepted all passing shows only that
legal designs pass. It never demonstrated that an illegal design fails, which is what a
veto would need. Treat one-sided pins as weaker evidence than the count suggests.

### What is genuinely settled

```
REACTOR CLASS   580 / 580   pass-fail, load-bearing, bake it
HARDPOINTS      578 / 580   (both failures alien; all 498 human designs pass)
POWER           577 / 3     informational only -- over-power designs are legal
COMPOSED MASS   4 / 277 within 0.5%  -- does NOT pin; composer stays closed
HEAT            no model, no pin
```

## Why the composer is still deferred

The first revision said power, heat, composed mass and utility slots were "unknown until
baked". That was true of the *snapshot* and false of the *templates*. Every field is in
`StreamingAssets/Templates`; the snapshot simply does not bake them.

```
TIShipHullTemplate      internalModules, shipModuleSlots, consTier, maxOfficers,
                        length_m, width_m, volume, mass_tons, crew,
                        alien, noShipyardBuild, thrusterMultiplier
TIDriveTemplate         thrustRating_GW, "req power", requiredPowerPlant,
                        specificPower_kgMW, efficiency, cooling, powerGen
TIPowerPlantTemplate    maxOutput_GW, specificPower_tGW, powerPlantClass, efficiency
TIRadiatorTemplate      specificPower_2s_KWkg, specificMass_2s_kgm2, operatingTemp_K
TIShipArmorTemplate     density_kgm3, baryonicHalfValue_cm, xRayHalfValue_cm, specialties
```

**The power budget is solved, and pinned.** The drive's `req power` — not weapon draw — is
the dominant reactor load; a `480cmGreenLaserCannon` draws 0.05 GW against a 20 GW plant.
Two corrections were needed and both are now understood:

- `requiredPowerPlant: "Any_General"` is a **sentinel meaning any reactor**, not a class name.
- **Nuclear-pulse drives do not load the reactor.** `OrionDrivex1` carries
  `req power: 336.800` and detonates charges; treating that as a reactor draw fails a
  design the game shipped.

**A reactor-class compatibility rule exists that draft 1 did not know about:** a drive's
`requiredPowerPlant` must equal the reactor's `powerPlantClass`, or be `Any_General`.
There are 13 classes. A composer without this rule emits illegal designs.

Pinned against every design in the save — **580 designs across all 8 factions**, which the
game itself accepted and are therefore legal by construction:

```
POWER budget       580 pass / 0 fail
REACTOR CLASS      580 pass / 0 fail
HARDPOINTS         578 pass / 2 fail   (both alien; all 498 human designs pass)
```

That is the standard the propulsion model met, so these three budgets are **no longer
unknown** — they may emit pass/fail. The two alien hardpoint failures are undiagnosed and
may be the same "alien records disagree with their templates" class as the ×1.35 combat
acceleration finding; alien hulls stay out of scope regardless.

**Still genuinely unbuilt: composed mass and heat.** Hull `mass_tons` and weapon
`baseWeaponMass_tons` resolve exactly, but armour (needs surface area from `length_m` /
`width_m`), radiator (area-scaled), reactor (`maxOutput_GW × specificPower_tGW`) and
tankage are not yet summed, and nothing is pinned. Heat has all its inputs and no model.

**The pin these need:** a component-sum mass model must reproduce **measured dry mass on
fitted ships** — `resolveShipMass` supplies the target for 717 ships — before any composed
hull may report ΔV or acceleration. A mass model 15% light silently inflates both on every
recommendation, and that error is invisible in the output. Until that pin exists, composed
mass and heat report **unknown**.

## Why the composer is still deferred

The first draft claimed a from-scratch design could be assembled and validated "without
fabricating anything, because `componentStats` exists". That is wrong. Valuation exists;
**a designer that can accept or reject a whole ship does not**, and three of the seven
budgets it proposed cannot be evaluated from the baked snapshot at all.

Measured on the live save:

| claim in draft 1 | measured reality |
| :-- | :-- |
| power draw = Σ `shotPowerMJ / cooldownS / efficiency` | `shotPowerMJ` exists on **158 of 309** weapons — 125/125 lasers and 33/33 particle beams, but **0/70** magnetic guns, **0/57** missiles, **0/16** plasma, **0/8** guns. The formula returns a confident **0 GW** for a missile boat. |
| reactor sized against weapon draw | **0 of 541** drives carry any power field. `driveStats` is `EV_kps, thrust_N, thrustCap, propellant, driveClassification, flatMass_tons, requiredProjectName, disabled`. Drive load is the dominant reactor draw and is absent. |
| mass → ΔV via the propulsion model | `shipPropulsion` and `refitOntoDrive` read **measured** dry/wet mass from a fitted ship. There is no component-sum mass model, and hull length/surface (needed for armour and radiator mass) is not baked. |
| utility slots, cons tier, buildability | `shipHullStats` carries exactly seven fields — `missionControl, constructionTier, baseConstructionTimeDays, noseHardpoints, hullHardpoints, structuralIntegrity, requiredProjectName`. No `internalModules`, no `alien`, no `noShipyardBuild`, no length. |

`shotPowerMJ` is **beam damage, not electrical draw**. Building a power budget on it is the
`Number(null) === 0` failure this repo has fixed four times — and draft 1 listed that rule
as a constraint two sections below the formula that broke it.

**A composer therefore requires baking work first** in `server/snapshot/templates.js`:
drive power draw, hull length or surface area, `internalModules`, and the buildability
flags. Until those exist and a mass-from-parts model is **pinned against fitted ships the
way the propulsion model is**, a composed hull is fabricated data.

## Slice 1 — refit a design the save already flies

Start from an observer design in the save (17 on the live save). Hold the hull. This is
the one reuse that is real: `refitOntoDrive` already does exactly this comparison and
already carries `dryMassCaveat` when the candidate's fixed drive mass differs.

**Scope:**
- Swap the **drive** via `refitOntoDrive` / `rankRefits`.
- Swap **weapons** only within the hull's existing hardpoints, costed by `mountCost` —
  pinned at 515/515 shipped designs.
- Recommend **armour material** from `specialties[]`.
- Report ΔV and combat acceleration against the current fitting, with caveats visible.

**Do not** search 28 hulls × 541 drives × weapon combinations. **Do not** emit a
from-scratch hull.

## What slice 1 may claim

| budget | verdict it may emit | why |
| :-- | :-- | :-- |
| hardpoints | pass / fail / **unknown** | `mountCost` pinned 515/515; the hull-field route pins 498/498 human designs |
| **power** | **information, never a veto** | plant `maxOutput_GW` vs drive `req power` + beam draw, and the thrust-scaling consequence. Over-power designs are legal and fielded |
| **reactor class** | **pass / fail** | drive `requiredPowerPlant` equals reactor `powerPlantClass`, or is `Any_General`; pins 580/580 |
| **utility slots** | **pass / fail** | hull `internalModules` once baked — a template field, not a missing one |
| drive ΔV and acceleration vs current fitting | pass / fail / **unknown**, with `dryMassCaveat` | `refitOntoDrive` holds dry mass constant — the same comparison the game's rated figures make |
| armour material vs observed threat | weighted / **unweighted** | `specialties[]` via `armorMetrics` |
| mission control | **headroom, not a veto** | a campaign constraint, not a designer-illegal one |
| composed mass, heat | **unknown until pinned** | inputs all exist; no model yet, and no pin against measured dry mass |
| crew | **omit** | a cost axis, not a capacity; there is no designer veto to check against |

A budget that cannot be evaluated reports **unknown**. It must never fall through to
"fits" — `CLAUDE.md`: *unknown is not the same as safe*.

## Availability: completed **or ungated**

Draft 1 said every component must resolve to a completed project. That drops legal parts.
`gateForItem` returns `null` for ungated items, and `AVAILABILITY_STATES.ungated`
([`researchAvailability.mjs:76`](../shared/researchAvailability.mjs)) exists precisely so
those are not misreported as completed — a documented set of laser templates, hulls,
armours and reactors carry no `requiredProjectName` and are fittable from turn one.

**The rule is: completed OR ungated.** Never "has a finished project, or discard". An item
that resolves to neither is dropped **with a recorded reason** — and its identity must
never become the string `"undefined"`, which has collapsed a dedupe key in this repo twice.

Exclude alien and non-shipyard-buildable hulls. Those flags are not currently baked, so
until they are, **restrict slice 1 to hulls the observer already flies** — which is
sufficient for a refit advisor and sidesteps the gap entirely.

## Roles: use the inferred role, not the save's tag

Draft 1 conflated two taxonomies that `shared/propulsion.mjs` deliberately keeps apart:

- `DESIGN_ROLES` is **only** `warship` / `transport` / `unknown`. `inferDesignRole` counts
  offensive mounts against point-defence mounts.
- The save's `role` string (`LS_Penetrator`, `InnerSystemColonyShip`) is passed through as
  `roleTagFromSave` and is explicitly **"untouched and uninterpreted"** — because designs
  tagged as colony and troop ships on this save carry laser cannon and missile bays.

So "do not hardcode a role list; use the roles the observer already fields" was wrong twice
over: it would key off an untrustworthy tag, and it would rank more of whatever they
already fly. **Use `inferDesignRole`.** Where doctrine says the current fleet composition
is itself the problem, a per-hull refit recommendation cannot express that — say so rather
than implying the recommendation optimises fleet mix.

## Armour: material *and* value, weighted by observed threat

Armour has no single quality rating. Each material carries per-damage-type ratings:

```
SteelArmor        XRayResistance 0.27   BaryonicResistance 1.00
CompositeArmor    XRayResistance 1.11   BaryonicResistance 5.xx
AdamantaneArmor   XRayResistance 4.82   BaryonicResistance 31.02
```

Boron Carbide and Nanotube rank in opposite orders against the two types, so "best armour"
is meaningless without knowing the threat.

- **Use `specialties[]` via `armorMetrics`.** Never derive from `baryonicHalfValueCm ×
  densityKgM3` — that derivation ranked Adamantane 10th of 12 and is on record as rejected
  in `docs/research-advisor-spec.md`.
- **Weight by the observed alien weapon mix.** Alien ships carry `weaponLoadout` and
  `dominantWeaponType`; sighted ships retain it in player mode. Say which threat the
  recommendation is weighted against. If nothing is visible, say **unweighted** — do not
  fall back to a default ranking.
- **Report material and `armorValue` separately.** A material choice alone is half a
  recommendation: an armour value target is unreachable on a material whose maximum is
  below it, and claiming the target without the material's cap is a fabricated number.

## Where it lives

Part B is a new row in `shared/intel/registry.mjs`, not a briefing-only field.
`/api/intel/production-plan` exists but answers "what will this existing design cost",
takes a design id, and returns `constructionCost: null` on real saves — it does not answer
"what should I design" and must not be presented as if it does.

## Constraints

- Both modes. Player mode redacts enemy designs; armour weighting degrades to
  **unweighted**, never to a fabricated default.
- Absent stays null. A missing `shotPowerMJ`, `armorValue` or mass must not become zero.
- Truncation announces itself: `*TotalCount` / `*OmittedCount` to the consumer.
- Save-derived objects use `ID`, not `id`.
- Name the project, not just the unlock, for anything gated
  (`docs/research-row-naming-spec.md`) — `Project_CopperheadMissileBay` displays as
  *"Hydrolox High Explosive Missiles"*.
- `shared/**` must run in both Node and the worker — no `fs`, `require`, or `Buffer`.
- Read `docs/code-index.md`; update changed `Purpose:` lines and run `npm run index`.

## Acceptance — Part B slice 1

- Every recommendation starts from a design the observer already flies, and names it.
- Every component is **completed or ungated**; assert this. Anything else is dropped with a
  recorded reason and no `"undefined"` identity.
- Hardpoint, reactor-class, drive-performance and armour verdicts emit pass / fail / **unknown**.
- **Power is rendered as information, never as a verdict.** No pass/fail, no "fits". Show
  plant output against required draw, and the thrust-scaling consequence. A design drawing
  more than its plant is legal — `Breaking Wave` does it at 2.13× — so any UI that reads as
  a rejection is wrong.
- **Composed mass and heat report `unknown`.** The mass pin was run and failed (4 of 277
  within 0.5%, median 1.15×); no composed-mass figure may be emitted, and nothing derived
  from one — ΔV, acceleration, radiator sizing — may be presented as computed.
- Utility slots report **unknown until `internalModules` is baked**, then pass / fail.
- **Every template numeric is parsed comma-safe**, and an unparseable value becomes `null`,
  never `0`. Assert this directly: 92 of 541 drives carry values like `"2,130.928"`.
- Armour reports material and value, and names the threat it is weighted against or says
  unweighted.
- Roles come from `inferDesignRole`, never from `roleTagFromSave`.
- A new `shared/intel/registry.mjs` row, reachable and documented.
- Both modes; full suite green with exact counts.

---

# Superseded: draft 1's design composer

Kept on record because the rejection is worth as much as the design that ships.

Draft 1 proposed composing a design from scratch across all 28 hulls and validating it
against seven budgets: hardpoints, power, heat, mass→ΔV, mass→acceleration, mission
control, and crew. Four of those seven cannot be computed from the baked snapshot —
power (no drive draw, `shotPowerMJ` absent on 151 of 309 weapons), heat (no drive waste
heat, no radiator area), composed mass (no component-sum model, no hull surface), and
utility slots (`internalModules` not baked). Mission control is a campaign constraint
rather than a designer veto, and crew has no capacity to check against.

The composer becomes viable once `server/snapshot/templates.js` bakes drive power draw,
hull length or surface area, `internalModules`, and the `alien` / `noShipyardBuild` flags,
**and** a mass-from-parts model is pinned against fitted ships to the standard the
propulsion model met. That is a prerequisite piece of work, not a detail of this one.
