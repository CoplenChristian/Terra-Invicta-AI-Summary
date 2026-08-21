# Per-fleet engagement estimates in THREAT

Written 2026-08-21 against `b3b77f6`.

"How many hulls do I need to take this fleet?" is already answered — generically, as prose,
in the wrong view. This makes it per-fleet and puts it where the fleets are.

---

## What exists

`server/commentary/simulation.js` runs a seeded Monte Carlo: 120 seeds × 30 battle trials
per hull count, sweeping 1–24 hulls for `P(win) ≥ 0.80`, reporting a p20–p80 band. Its
output reaches the player only through `strategicCommentary` prose, rendered by
`public/v2/js/components/strategic-commentary.js` in **COMMAND**.

It tiers on *opponent ratings* — built from observable fleet metrics in player mode and
true design CVs in omniscient — not on individual fleets. THREAT currently holds
`dualAssetRings`, `alienHateEconomics`, `powerTrajectoryChart` and nothing about
engagements.

## What the data supports

```
alien fleets  57        observer fleets  4
alien ships  420

size distribution   15 singletons ... one 34-ship fleet
by theatre          EARTH / LUNA 26 · OUTER SYSTEM 11 · BELT / CERES 8
                    SATURN 6 · JUPITER 5 · UNASSIGNED 1
```

Per fleet: `lowestDeltaVKps`, `lowestCombatAccelerationMps2`, `armorMedian`,
`dominantWeaponType`, `weaponSummary`. Per ship: `hullName`, `armorMedian`,
`currentMaxDeltaVKps`, `combatAccelerationMps2`, `weaponLoadout`. That is enough to
characterise a specific fleet rather than a tier.

## Four constraints that decide the design

**1. `combatPower` is null on every fleet, in both modes.** `combatPowerSource` reads
`"not present in save"`. `CLAUDE.md` records this and a test pins it: *combatPower is never
used — it carries no data in any mode*. Build capability from loadout and armour. Never
reintroduce it, and never let a null power become a zero.

**2. Alien combat acceleration is contradicted on 278 of 420 ships.** The ×1.35 finding
(`docs/model-verification-review.md`, "Resolution of Claim 1") is deterministic per hull
template but has no discriminating field in the snapshot, so no correction is applied.
`shipPropulsion` returns `modelled.combatAccelerationConfidence` as
`confirmed` / `contradicted` / `unconfirmed`. **Any estimate leaning on alien mobility must
carry that confidence forward**, and prefer the measured figure where the save states one.

**3. The band understates total uncertainty, and that is already documented.**
`simulation.js` attaches an `uncertainty` block with `isMeasurement: false` and three
exclusions: opponent-rating calibration is an assumption (`ownRating × 0.7 / 1.5 / 4.0` in
player mode, with no game source for "a typical alien is 1.5× your best hull"), unwinnable
seeds are dropped before percentiles, and the model is **linear in hull count, not the
Lanchester square law**. A per-fleet number is more specific-looking than a tier and will
be read as more precise. **Carry the whole `uncertainty` block per fleet** and never render
the band as a measurement.

**4. Fifty-seven rows is not advice.** Rank and truncate, and announce it —
`*TotalCount` / `*OmittedCount` to the consumer, per `CLAUDE.md`.

## The existing model does not reach fleet scale

This is the central problem, and an earlier draft of this spec got it wrong by comparing
the observer's whole navy against a **single-ship** tier. The existing tiers are per-ship,
and the largest stacks only to three:

```
tier                       player    omniscient
median-alien-escort        1 hull    1
typical-alien-combatant    2         2
two-typical-aliens         3–4       3
heavy-alien-capital        7         4–5
three-typical-aliens       5         4
```

`heavy-alien-capital = 7 hulls` is the cost of beating **one** heavy capital, not a fleet
containing several. Real alien fleets are far larger and are not stacks of one ship type:

```
largest alien fleets          ships   distinct hull types
Victor-620   @Sol                34            17
Victor-392   @Sol                26            13
Victor-75    @Sol                25            17
Victor-590   @Sol                24            19
Victor-619   @97 Klotho          23            18

26 of 57 fleets exceed 3 ships   (past the largest tier)
 3 of 57 exceed 24 ships          (past the entire own-hull sweep)
MAX_SIMULATED_HULLS = 24
```

So a fleet with three heavy capitals plus fifteen escorts costs far more than 7 hulls, and
the current model has no tier that represents it. **Per-fleet estimation is not a
re-labelling of the tiers — it needs an opponent rating built from that fleet's actual
composition**, across its real hull mix, not N copies of a representative ship.

**And the sweep ceiling will bind.** Against the larger fleets the answer may exceed 24
own hulls, which the sweep cannot express. Either raise `MAX_SIMULATED_HULLS` — and say
what the new ceiling costs in runtime — or report **"beyond the modelled range"** as a
distinct verdict. What must not happen is a fleet requiring 40 hulls rendering as a band
near 24, or as "not winnable" when the truth is "not modelled".

Player mode being *more pessimistic* than omniscient (7 against 4–5 for a heavy capital) is
correct and must not be "fixed": it uses the uncalibrated `×1.5` opponent assumption where
omniscient has true design CVs. That gap is the cost of not knowing the enemy.

## Reachability gates the whole thing

The observer has **4 fleets against 57**. For most alien fleets the honest answer is not a
hull count — it is that you cannot get there.

**Compute reachability before computing a hull count.** A target the observer's ships lack
the ΔV to reach needs no engagement estimate, and printing one implies an option that does
not exist. Use the observer fleet's measured `lowestDeltaVKps` against the target's
location; `orbitBodyDistanceAU` and `spaceTheaterKey` are on both sides.

Where reachability cannot be evaluated, say **unknown** — not reachable, and not
unreachable.

Rank the reachable set by something defensible — threat to owned assets, or proximity to
the observer's holdings — and state the ordering basis, as the research advisor states
`orderedBy`.

## What a row should say

- **The fleet**, its ship count, theatre and dominant weapon type.
- **Hulls needed**, as the existing band (`p20–p80`), never a single number.
- **Whether the observer can field that many** — the answer is often no, and that is the
  actionable part. The observer's 4 fleets are the constraint, not the estimate.
- **Not winnable at any count ≤ 24** where the sweep says so. `simulation.js` already
  emits that verdict; surface it rather than an empty band.
- **The uncertainty block**, and the alien-acceleration confidence where mobility informed
  the estimate.

## Placement

A new panel in the **THREAT** view — it answers "what is coming", which is that view's
stated question in the registry comment at `mission-control.js:131`.

Per `CLAUDE.md`: **a rendered panel needs a registry entry and a startup assertion.** Add
the panel id to the `threat` entry in `VIEWS` and confirm `assertViewRegistryIntegrity()`
passes — the mining board once had a `<script>` tag and no mount element and rendered
nowhere.

Do not add a fifth view; THREAT is the right home and has room.

## Constraints

- **Both modes.** The simulation already builds opponent tiers differently per mode
  (observable metrics vs true design CVs), and player mode redacts alien designs. Verify
  both give sensible output; do not assume they agree.
- Absent stays null: a null `combatPower`, an unmeasurable ΔV, an unresolvable reachability
  all report **unknown**, never 0 and never "safe".
- Truncation announces itself.
- Do not change `simulation.js`'s model. Its `uncertainty` block and thresholds were
  reviewed and corrected in `e98413f`; reuse them.
- Nothing campaign-specific: no hardcoded fleet names, theatres or counts.
- Read `docs/code-index.md`; update `Purpose:` lines and run `npm run index` last.

## Acceptance

- A THREAT panel lists ranked alien fleets with a hulls-needed band each, and states its
  ordering basis.
- The panel is in `VIEWS` under `threat`; `assertViewRegistryIntegrity()` passes.
- **Unreachable fleets show no hull count** and say why. On the live save the observer has
  4 fleets against 57 alien fleets across 6 theatres, so this path must exercise.
- `combatPower` is not read. Assert it — a test that greps the new module for it is fair.
- Alien-acceleration confidence reaches any row whose estimate used mobility.
- The `uncertainty` block travels per fleet; no band renders as a measurement.
- Truncation carries `*TotalCount` / `*OmittedCount`.
- "Not winnable at any count ≤ 24" renders as that verdict, not an empty band.
- Both modes; no `null` / `undefined` / `NaN` rendered; full suite green with exact counts.
