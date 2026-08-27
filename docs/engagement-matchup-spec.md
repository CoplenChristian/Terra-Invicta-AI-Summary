# Engagement by composition, not by combat value

**Status: design, not built. Written 2026-08-27, replacing the force-strength half
of `docs/theater-defence-engagement-spec.md`.**

This document exists because the player told me the model was measuring the wrong
thing, and the measurements agree with him.

---

## Why combat value is being abandoned

The dashboard's force comparison rates each ship by a single scalar,
`_unnormalizedCombatValue`, and asks a Lanchester-style question: *how many hulls
of yours beat that fleet?* `shared/engagementModel.mjs` already concedes the
premise — *"treating a combat value as the exchange currency of this
Lanchester-style model is still an assumption."*

**The assumption is wrong, and there are three separate reasons, any one of which
would be disqualifying.**

**1. A scalar cannot express a matchup.** In the player's words: a missile monitor
rates ~1,900 and a laser lancer ~80, and the lancer wins — because what decides it
is 2 point-defence mounts against a 24-missile salvo, and a 960 MW infrared phaser
against whatever armour is in front of it. Combat value has no way to say that.

**2. The own-force rating is not even the player's fleet.** Measured on the live
save: 58 observer designs, combat values spanning **638,067 (Kivu, Battleship) down
to 0 (Xingu, Monitor)**. `readOwnForce` takes the **highest** and applies it to
every hull present. A Conger at 1,537 is rated as a Kivu at 638,067 — a 415×
overstatement, and the Xingu at 0 is rated as infinitely more capable than it is.

**3. The player-mode bridge is invented.** Alien design records are redacted, so
each alien ship is rated at (your best design) × **1.5** × (its weapon systems ÷
your median). No game source states the 1.5. Measured, it over-rates the opponent
**9× to 15×** per body — Callisto 9.01×, Earth 15.65× — a spread that is not even
consistent, so it cannot be divided out.

**The third point is the one usually raised, and it is the least important.**
Calibrating 1.5 would sharpen a number that was never measuring the right quantity.
Points 1 and 2 apply in **omniscient mode too**: Callisto's "5–6 hulls" is
precise-looking and rests on the same broken currency.

---

## What the player can actually see, measured

This is the part that makes a better model possible, and it comes from the player's
own correction: **Deep System Skywatch is researched globally in the first year, and
its effect targets `AllHumanFactions`.** So player mode is not blind.

| reading | player mode | omniscient |
| :-- | --: | --: |
| alien fleets | **62** | 62 |
| alien ships | **497** | 497 |
| ships with `weaponLoadout` | **497** | 497 |
| alien **design records** | 0 | 132 |

Every alien ship in player mode carries `weaponLoadout`, `dominantWeaponType`,
`armor`, `armorMedian`, `currentMassKg`, `cruiseAccelerationMps2`,
`combatAccelerationMps2` and delta-V. A loadout looks like this:

```json
[{"role":"Point Defense","category":"Laser","count":2,
  "systems":["Alien Point Defense Laser Turret","Alien Point Defense Particle Beam"]},
 {"role":"Laser","category":"Laser","count":1,
  "systems":["Alien 256 cm Violet Laser Cannon"]},
 {"role":"Missile","category":"Missile","count":1,
  "systems":["Glittering Jewel Missile Bay"]}]
```

**`combatPower` is absent from the save in BOTH modes** — `combatPowerSource: "not
present in save"` on all 497 ships. Even omniscient derives its ratings from design
records, not from ships.

### The named systems resolve to public templates

51 of 78 distinct systems named in player mode join to the installed templates by
name. The remaining 27 are probably a naming/localisation gap in a crude join rather
than missing data — `Alien Heavy Plasma Cannon` and `Alien Spinal Particle Cannon`
are unresolved while `TIPlasmaWeaponTemplate.json` and
`TIParticleWeaponTemplate.json` exist. **Improving that join is phase 0**, and the
join rate is a number the feature must report rather than quietly average over.

What those templates carry:

- **`TIMissileTemplate.json`** (57): `salvo_shots`, `intraSalvoCooldown_s`,
  `cooldown_s`, `magazine`, `flatDamage_MJ`, `flatChipping`, `efficiency`,
  `targetingRange_km`, `acceleration_g`, `deltaV_kps`, and — decisive for this
  model — **`isPointDefenseTargetable`**.
- **`TILaserWeaponTemplate.json`** (125): `attackMode` / `defenseMode` (point
  defence is `defenseMode: true`), `cooldown_s`, `shotPower_MJ`, `efficiency`,
  `targetingRange_km`, `wavelength_nm`, `mirrorRadius_cm`, `beam_quality`,
  `jitter_Rad`.
- **`TIMagneticGunTemplate.json`**, `TIParticleWeaponTemplate.json`,
  `TIPlasmaWeaponTemplate.json` — the kinetic and beam families.
- **`TIShipArmorTemplate.json`** (12): `xRayHalfValue_cm`, `baryonicHalfValue_cm`,
  `density_kgm3`, `heatofVaporization_MJkg`, and `specialties` such as
  `XRayResistance`.

Armour is modelled as **half-value layers** per damage class. That is a physical
attenuation model, not a hit-point pool, and it is what "punching through" means.

**`TISpaceCombatTemplate.json` is not the combat rules** — it is a single
`RedBlueSpaceCombat` test-scenario entry with `active: false`. Do not mistake it for
a source of resolution constants.

---

## What to build instead

Three questions, in the player's framing, each answered per body from data player
mode legitimately holds.

### 1. Saturation — can their salvo get through your point defence?

Their missile launchers × `salvo_shots` gives shots in the air. Your point-defence
mounts × shots available in the intercept window (from `cooldown_s` and the closing
time implied by `targetingRange_km` and missile `acceleration_g`) gives interceptions
available. Missiles with `isPointDefenseTargetable: false` **cannot be intercepted at
all** and must be counted separately — a fleet whose salvo is untargetable defeats
any amount of point defence, and averaging it into a total would hide exactly the
case that kills you.

### 2. Saturation, reversed — can your salvo get through theirs?

The same computation with the sides swapped. This is what makes the answer
actionable: *"their point defence stops N of your M missiles; you need K more
launchers to overwhelm it."* That is a build recommendation denominated in
**launchers**, which is a thing you can actually build.

### 3. Penetration — do your guns punch through, and how many do you need?

Beam and kinetic damage against armour half-value thickness for the relevant damage
class. The output is *how many of your weapons it takes to get through*, which is
the player's third question verbatim.

**Report all three. Do not collapse them into one score** — collapsing is the
mistake being corrected, and a single number would reintroduce it under a new name.

---

## What is NOT known, and must be labelled

I have the weapon and armour statistics. **I do not have the combat resolution.**
Specifically unknown:

- How interception is rolled — whether it is per-shot probability, deterministic, or
  affected by `jitter_Rad` and range.
- Whether point-defence **quality** matters as much as count, and how a
  `defenseMode` laser performs against a missile with a given `acceleration_g`.
- How `flatChipping` and `efficiency` combine with half-value attenuation.
- Whether range bands mean a laser fleet engages before missiles arrive at all.

**Sources, in order:** the installed templates; the decompiled
`Assembly-CSharp.dll` via `ilspycmd`, which is how `shared/shipBuildTime.mjs`
established the construction formula; the wiki as raw wikitext. **Anything that
cannot be grounded in one of those is an assumption and must say so on the row**,
the way `OPPONENT_RATING_BASIS` does today — that habit is the one good thing to
carry over from the model being replaced.

**The player's own rule of thumb outranks my derivation.** He plays this game; if he
states how much point defence stops a salvo of N, that is better evidence than
anything I reconstruct from constants.

---

## Phasing

0. **Fix the weapon-system join** and report its rate. 51/78 today. A matchup built
   on a 65% join silently under-counts weapons, and under-counting the enemy is the
   dangerous direction.
1. **Composition per body**, both sides: launchers, salvo size, PD mounts,
   untargetable-missile count, armour, dominant weapon type. Pure readings, no
   model. Useful on its own and reviewable before anything reasons over it.
2. **Saturation**, both directions, with the interception assumption stated.
3. **Penetration**, with the attenuation assumption stated.
4. **The build recommendation**, denominated in launchers or mounts — the thing the
   player builds — and only where phases 2 and 3 both resolve.

---

## What would make this wrong

- **Collapsing the three answers into one score.** That is the defect being fixed.
- **Averaging over an incomplete weapon join.** Report the join rate; refuse a body
  whose loadouts largely did not resolve.
- **Counting untargetable missiles as interceptable.** The reassuring direction.
- **Presenting a derived interception rate as measured** when the resolution rules
  were not read from the game.
- **Rating your own fleet by its best design.** The existing defect; every hull is
  rated by its own loadout or the model is lying about your side too.
- **Keeping the hull count alongside** as a "second opinion." Two numbers where one
  is known to be wrong is worse than one number: the reader will believe whichever
  agrees with them.

---

## What happens to the existing work

`theaterForce`, the per-fleet hull requirements, and phase 3's recommendation are
built on combat value. **The readings underneath them stay** — fleet positions,
arrival clocks, build times, shipyard tiers, the refusal machinery, and the
"no shipyard at Callisto" handling are all independent of the rating model and all
still correct.

**What must not ship is the hull count itself**, in either mode. It should be
removed rather than captioned, per the rule above.
