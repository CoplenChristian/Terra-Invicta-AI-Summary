# Fleet Procurement — its own view, and a recommended ship design

Written 2026-08-21 against `bbef9f0`.

Two parts. **Part A** is small and presentational: move the already-unlocked block out of
the Research Advisor into its own view. **Part B** is the substantial one: recommend an
actual buildable design — hull, drive, weapons, armour — validated against the budgets the
game itself enforces.

Part A can ship without Part B. Part B needs Part A's view to render into.

**Routing note:** Part B's engine is a backend module (composition and budget validation
over `componentStats`) and suits DeepSeek. Part A and Part B's rendering are frontend.

---

# Part A — move "ALREADY UNLOCKED, NOT IN SERVICE" out

`docs/research-vs-procurement-spec.md` split this block out of the ranked research list and
deliberately left the question open: *"Consider whether this belongs in this panel at
all. A refit recommendation is a procurement decision."* It does not belong there. This
resolves it.

Currently rendering inside the Research Advisor:

```
ALREADY UNLOCKED, NOT IN SERVICE                    4 UNFILLED
Copperhead Missile Pod   refit  FAILS DELIVERY  4S OF FIRE
Dreadnought              build                  2.07× throw weight
```

Nothing here involves research. It answers "what should I build", which is a different
question on a different resource (shipyard capacity now, not research income over months).

## Where it goes

The registry at [`mission-control.js:131`](../public/v2/js/mission-control.js) states the
grouping principle: COMMAND answers *"what do I do this turn"*, EXPANSION *"where do I
grow"*, THREAT *"what is coming"*, RECORDS *"what happened"*.

"What do I build" is a fifth question, and COMMAND is already at ~3.00 screens with no room.
**Add a fifth view — `FLEET`** — with `id: 'fleet'`, `sectionId: 'view-fleet'`.

Per `CLAUDE.md`: **a rendered panel needs a registry entry and a startup assertion.** The
mining board once had a `<script>` tag and no mount element and rendered nowhere. Register
the new panel ids in `VIEWS` and confirm `assertViewRegistryIntegrity()` passes — it checks
the section exists, each panel exists, each is contained in its section, and no panel is
registered twice.

## What moves

The zero-research-cost rows and their `4 UNFILLED` count, with their existing semantics
intact — `refit` vs `build`, the badges, and the ranking within the block. Do not
re-rank them against anything.

The Research Advisor keeps every row that costs research and loses the unlocked block
entirely, reclaiming vertical space in COMMAND. Report COMMAND's measured screen count
after the move.

---

# Part B — recommend a design

## What the user asked for

> "I am asking you for a suggested ship model blueprint, or at least weapons and drives and armor"

## This is buildable without fabricating anything

The concern with any "suggested design" feature is that it invents a ship the game would
not accept. It does not have to. **The snapshot already carries every field a real design
carries, plus the component physics to validate one.** I verified this against the live
save.

A design in this game is exactly this shape — read from a real Initiative design:

```
hullName             "Escort"
driveName            "NervaDrivex5"
powerPlantName       "SolidCoreFissionReactorVII"
radiatorName         "TitaniumArray"
propellantTanks      25
noseArmor            { materialName: "CompositeArmor", armorValue: 4 }
lateralArmor         { materialName: "CompositeArmor", armorValue: 0 }
tailArmor            { materialName: "CompositeArmor", armorValue: 1 }
hullWeaponTemplateEntries  [{ moduleName: "CobraMissileBay", slot: 7 }, …]
noseWeaponTemplateEntries  []
moduleTemplateEntries      [{ moduleName: "MoltenSaltHeatSink", slot: 9 }, …]
fireModeTemplateEntries    [{ slot: 7, fireMode: "Offense" }, …]
role                 "LS_Penetrator"
```

And the component catalogue, all present in `componentStats` (measured counts):

```
laser_weapon 125   magnetic_gun 70   particle_weapon 33   plasma_weapon 16
missile 57         gun 8             ship_hull 28         ship_armor 12
power_plant 61     radiator 13       heat_sink 14         battery 10
utility_module 57                    driveStats 541 (separate top-level key)
```

**The output of this feature is a filled-in copy of that shape.** Not prose, not a
gesture at a direction — the same fields, with real component ids, that the player can
reproduce in the game's designer.

## The budgets that make it honest

A recommendation is only worth making if it is checked. Every one of these is computable
from the snapshot, and each must be evaluated and reported:

| budget | computed from | binds when |
| :-- | :-- | :-- |
| **hardpoints** | `mountCost(weapon.mount)` summed vs hull `noseHardpoints` / `hullHardpoints` | too many or too large weapons |
| **power** | Σ `shotPowerMJ / cooldownS / efficiency` (GW) vs `power_plant.maxOutputGW` | reactor too small for the guns |
| **heat** | weapon + reactor waste heat vs radiator `specificPowerKWkg` × mass, plus `heat_sink.heatCapacityGJ` | radiators too small |
| **mass → ΔV** | dry mass + tanks through the validated propulsion model | ship cannot reach the theatre |
| **mass → acceleration** | `thrust_N × thrustCap / wet mass` | ship cannot close or disengage |
| **mission control** | hull `missionControl` vs faction `missionControlCapacity − missionControlUsage` | fleet cap reached |
| **crew** | Σ `crew` across hull, weapons, reactor, radiator | — |

`mountCost` is already pinned and reproduces the mount→hardpoint table on **515/515**
shipped designs, so the hardpoint budget is not a guess.

**Report which budget binds.** "Power-limited: this hull could carry a fourth battery with
a larger reactor" is more actionable than the design itself, and it is the thing a player
cannot easily work out by hand.

## Only unlocked components

A blueprint containing an unresearched part is fabricated data, which this repo forbids
outright. The gate is available: `unlockIndex.gates` carries 436 gates mapping projects to
the components they unlock, `gateForItem(snapshot, family, itemId)` resolves the reverse
direction, and the observer's `completedProjects` (155 entries on the live save) says what
has actually landed.

**Every component in a recommended design must resolve to a completed project.** If a part
cannot be resolved to a gate at all, drop it with a recorded reason — never let an
unresolvable item through, and never let its identity become the string `"undefined"`
(`CLAUDE.md` documents two separate incidents of exactly that collapsing a dedupe key).

Optionally show a **second, locked design** — "what you could build after
`Project_X`" — but it must be visibly separated and labelled, never mixed with the
buildable one. That is the same mistake Part A is correcting.

## Armour is threat-dependent, and the data supports saying so

This is the part worth getting right, because the obvious approach is wrong.

Armour does **not** have a single quality rating. Each material carries per-damage-type
ratings in `specialties[]`:

```
SteelArmor        XRayResistance 0.27   BaryonicResistance 1.00
CompositeArmor    XRayResistance 1.11   BaryonicResistance 5.xx
AdamantaneArmor   XRayResistance 4.82   BaryonicResistance 31.02
BoronCarbideArmor XRayResistance 1.00   BaryonicResistance 1.xx
```

Note `BoronCarbideArmor` and `NanotubeArmor` rank differently against the two damage types
— so "best armour" is meaningless without knowing what is shooting.

**Use the ratings in `specialties[]`, never a derivation from `baryonicHalfValueCm` and
`densityKgM3`.** That derivation was tried, ranked Adamantane 10th of 12, and is recorded
as rejected in `docs/research-advisor-spec.md`. The shipped ratings are authoritative.

The snapshot knows the threat: alien ships carry `weaponLoadout` with `role` / `category`
per mount and a `dominantWeaponType`. **Weight the armour recommendation by the observed
alien weapon mix**, and say so in the row — "Adamantane, against a laser-dominant threat"
is a defensible recommendation; "Adamantane is best" is not.

If the alien weapon mix cannot be observed (player mode may redact it), say the armour
choice is **unweighted**, and do not silently fall back to a default ranking.

## Reuse, do not reinvent

Most per-component valuation already exists and is pinned. Building a second scoring path
beside it is how the two drift apart.

```
shared/militaryValue.mjs   mountCost, MOUNT_HARDPOINTS, weaponMetrics, weaponRole,
                           hullMetrics, armorMetrics, powerPlantMetrics,
                           radiatorMetrics, heatSinkMetrics, batteryMetrics, ratioAgainst
shared/propulsion.mjs      shipPropulsion, refitOntoDrive, rankRefits,
                           DESIGN_ROLES, inferDesignRole, RANKING_BY_ROLE
shared/researchAvailability.mjs  buildAvailabilityResolver, AVAILABILITY_STATES
shared/unlockIndex.mjs     gateForItem, gatesForFamily, unlocksForGate
```

`refitOntoDrive` and `rankRefits` already answer the drive half of the question against a
fixed hull. The genuinely new work is **composition** — assembling parts into a whole and
checking the budgets — not valuation.

## A design is best *for a role*

There is no single best ship, and claiming one would be the same error as a single armour
ranking. `DESIGN_ROLES` and `inferDesignRole` already exist, and the observer's own
designs carry roles (`LS_Penetrator`, `LM_Protector`, `ML_Standoff`).

Recommend **per role**, and let the role come from the data — either the roles the
observer already fields, or the role their current fleet is measurably weakest in. Do not
hardcode a role list.

## Compare against what they already fly

The observer has **17 designs** in the live save. The strongest framing is not an abstract
ideal but a delta against a real one:

> `Escort` (NervaDrivex5, 2× CobraMissileBay, Composite 4/0/1)
> → swap drive to *X*: ΔV 3.1 km/s → 8.4 km/s, combat accel unchanged, power-limited

That is checkable by the player in one screen, and it reuses `refitOntoDrive` directly.

---

## Constraints

- **Both modes.** Player mode redacts enemy designs and may redact the alien weapon mix —
  the armour weighting must degrade to "unweighted", not to a fabricated default.
- **Absent stays null.** `Number(null) === 0`. A missing `shotPowerMJ`, `maxOutputGW` or
  `armorValue` must not become a confident zero. A budget that cannot be evaluated reports
  **unknown**, never "fits".
- **Truncation must announce itself.** Any capped list carries `*TotalCount` /
  `*OmittedCount` to the consumer.
- **The save uses `ID`, not `id`,** on save-derived objects. `componentStats` entries are
  keyed by internal id with a `displayName` field; check the real shape before choosing a
  field name.
- **Name the project, not just the unlock,** for anything gated —
  `docs/research-row-naming-spec.md` applies. `Project_CopperheadMissileBay` displays as
  *"Hydrolox High Explosive Missiles"*; the two cannot be derived from each other.
- Templates are baked at snapshot-build time; the worker has no filesystem. Anything new
  under `shared/**` must run in **both** runtimes — no `fs`, no `require`, no `Buffer`.
- Read `docs/code-index.md` before editing; update any changed `Purpose:` line and run
  `npm run index`.
- Do not touch `public/index.html` (legacy v1).

## Acceptance

**Part A**
- The already-unlocked block renders in the new FLEET view and nowhere else.
- `assertViewRegistryIntegrity()` passes; every new panel id is registered and mounted.
- The Research Advisor contains no zero-research-cost rows.
- COMMAND's measured screen count is reported and is lower than before.

**Part B**
- Every recommended design is emitted in the real design shape, with real component ids.
- **Every component resolves to a completed project.** Assert this — a design containing an
  unresearched part is the defect this feature most plausibly ships with.
- All seven budgets are evaluated; each reports pass, fail, or **unknown**; the binding one
  is named.
- Armour is chosen from `specialties[]` ratings, weighted by the observed alien weapon mix,
  and says which threat it is weighted against — or says it is unweighted.
- Recommendations are per role, with roles derived from data rather than hardcoded.
- No `null` / `undefined` / `NaN` / `"undefined"` in any rendered string.
- Both modes verified. A feature verified only in omniscient mode is not verified.
- Full suite passes; report exact pass/fail/skip counts.

## Out of scope

Build time and resource cost sequencing (shipyard queue scheduling), and any change to the
Research Advisor's ranked research rows.
