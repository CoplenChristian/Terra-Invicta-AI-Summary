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

## The measured answer today: hulls are not the constraint

Worth stating up front, because it decides what the panel is actually for. The existing
tier output, measured on the live save:

```
tier                       player    omniscient
median-alien-escort        1 hull    1
typical-alien-combatant    2         2
two-typical-aliens         3–4       3
heavy-alien-capital        7         4–5
three-typical-aliens       5         4
```

Player mode is *more pessimistic* than omniscient — 7 hulls against 4–5 for a heavy capital
— which is correct: it uses the uncalibrated `×1.5` opponent assumption where omniscient
uses true design CVs. Do not "fix" that gap; it is the cost of not knowing the enemy.

**The observer has 38 ships. The hardest tier needs 7.** Hull count is not the binding
constraint and a panel that leads with hull counts answers a question the player does not
have. What binds is that 35 of those 38 sit in one Mercury fleet at 9.5 km/s against an
alien median of 211 km/s, reaching only Earth, Luna and Venus.

So the honest headline for this campaign is closer to *"you have the hulls for any single
alien fleet; you can reach three destinations"* than to any per-fleet number. Build the
panel so that reads naturally when it is true, rather than burying it under 57 rows of
hull counts.

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
