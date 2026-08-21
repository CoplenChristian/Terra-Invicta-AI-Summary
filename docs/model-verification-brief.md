# Model Verification Brief

A request for independent review of the quantitative models in this repo. Written for a reviewer with no prior context.

---

## What this project is

A strategic-intelligence dashboard for **Terra Invicta**, a grand-strategy game. It parses the player's save file and produces analysis: fleet posture, alien threat, mining expansion, and — the subject of this brief — a **research advisor** that recommends what to research next, separated into military and economic value.

The player is one faction (the Initiative) among eight, at war with an alien invasion.

## Why this needs review

The advisor makes quantitative claims. Some are **pinned** — reproduced exactly against figures the game itself publishes. Others are **modelled** — derived arithmetic with no ground truth to check against. A few are **rejected** — models we tried, found wanting, and discarded.

We want an independent read on whether the pins are real, whether the rejections were correct, and whether the residuals we cannot explain point at a mis-specified model.

**The house rule throughout: an unmeasured quantity is `null`, never `0`.** A value that silently computes to zero ranks last and disappears from view, which is worse than an error because it is invisible. If you find somewhere we have violated that, it is the most valuable thing you could tell us.

## Where the data is

**Game templates** (static, per game version) — the authoritative source for game mechanics:
```
F:/SteamLibrary/steamapps/common/Terra Invicta/TerraInvicta_Data/StreamingAssets/Templates/
  TITechTemplate.json       149 techs
  TIProjectTemplate.json    750 projects
  TIEffectTemplate.json     719 effects
  TIDriveTemplate.json      541 drives
  TIShipHullTemplate.json    28 hulls
  TIShipArmorTemplate.json   12 armours
  TIMissileTemplate.json     57 missiles
  TIGunTemplate.json, TIPlasmaWeaponTemplate.json, TILaserWeaponTemplate.json, …
```

**Save data** — parsed snapshots. Programmatic access:
```javascript
const { loadFilteredSnapshot, queryIntel } = require('./server/snapshotLoader');

// a specific save (note: the parameter is savePath, not save)
const s = loadFilteredSnapshot({ savePath: 'Autosave.gz', mode: 'omniscient', observer: 4712 });

// an intel endpoint
queryIntel({ endpoint: 'propulsion', mode: 'player', observer: 4712, latest: true });
```

Saves live in `F:/Documents/My Games/TerraInvicta/Saves/`. Eight span 2029-09-10 to 2034-02-01 in game time.

Two visibility modes matter: **player** (redacts what the faction has not legitimately learned — enemy ship designs are stripped) and **omniscient** (full state). Any model must behave correctly in both.

---

## Claim 1 — Propulsion. PINNED, and we want the pin checked.

```
ΔV_kps        = EV_effective × ln(wet_mass / dry_mass)
EV_effective  = drive.EV_kps × ∏(EVMultiplier utility modules whose propellant requirement the drive satisfies)
cruise_m/s²   = drive.thrust_N / wet_mass
combat_m/s²   = drive.thrust_N × drive.thrustCap / wet_mass
```

Claimed: reproduces the save's own `currentMaxDeltaVKps` and `cruiseAccelerationMps2` for **696 of 698 ships** across all eight factions.

**Watch for this trap** — we fell into it. An earlier version omitted the `EVMultiplier` term and was validated only against the observer's own ships, which fly no such module. It matched 39/42 there and was declared "exact". Across all factions it fails badly (aliens 23/412, Servants 2/70). **The sample was biased and we did not notice.** Please check the current version has not made a subtler version of the same error.

Two specifics worth your attention:
- **`combat = cruise × thrustCap` is inferred**, from ratios landing on clean integers matching `drive.thrustCap` (9, 24, 40, 60). Three ratios do *not* land cleanly: 35.9327, 39.1406, 15.0. Are those explained by something we have missed?
- **260 alien ships disagree on acceleration, 29 on ΔV.** We surfaced the disagreement rather than hiding it, but never found the mechanism. Alien hulls appear to carry performance the design record does not explain. Is there a term we are missing, or are alien ships genuinely modelled differently?

## Claim 2 — Kinetic damage. PINNED.

```
damage_MJ = 0.5 × warheadMass_kg × muzzleVelocity_kps²
```

Reproduces shipped `damage_MJ` on **7 of 7** guns and `expectedDamage_MJ` on **16 of 16** plasma weapons at ratio 1.000000. That pin is what licenses applying it to 70 magnetic guns, which carry the same inputs and publish no damage figure.

Is that extrapolation sound, or do magnetic guns differ in a way that breaks it?

## Claim 3 — The research allocation formula. REJECTED. **This is the one we most want checked.**

The game's community wiki documents how research income splits across slots:

```
per slot X:  base
             × (100% + 5% per slot with pips assigned)
             × pips_X / total pips
             × (100% + CategoryBonus × 0.9^(same-category slots with pips − 1) + ProjectBonus)
```

We tried to reproduce it against measured per-slot delivery and **could not**. Evidence:

| finding | measurement |
| :-- | :-- |
| same slot, same pips, two consecutive 15.5-day intervals | delivered/predicted = **1.147** then **0.993** — a term the formula treats as constant moving 15% |
| the two project slots' ratio to each other | fixed at **1.2073**, which the formula reproduces only with `ProjectBonus = −0.209` — a project *penalty* |
| a single `(base, ProjectBonus)` fitting all three pipped slots | none exists |

Also: `TIGlobalConfig.json` carries only `globalResearchMultiplier: 1`. Neither the `+5%`-per-slot term nor the `0.9^(n−1)` category decay has any shipped source we can find.

**Questions for you:**
1. Did we mis-specify the formula, or is it genuinely wrong for this game version?
2. `CategoryBonus` was **reconstructed** by us (summing `techBonuses` from the observer's orgs, hab modules and councilor traits — Xenology 0.20, Energy 0.03, MilitaryScience 0.03). That reconstruction is itself unvalidated. If it is wrong, does the `ProjectBonus = −0.209` contradiction survive? We believe the 1.147-vs-0.993 inconsistency stands independently of it, since that is a single slot compared against itself — but we would like that checked.
3. Is 15.5 days a safe interval, or could a mid-interval event (income change, org acquisition) confound it?

Because it does not reproduce, the advisor **declines to recommend a reallocation** and says so. If you can make it fit, that unblocks a real feature.

**Constraint worth knowing:** every save in this campaign has exactly **three** pipped slots (`[0,0,3,2,1,0]` → `[0,0,3,1,3,0]` → `[0,0,3,3,3,0]`). Only the distribution ever varied, never the count. So the `+5% per pipped slot` breadth term has no variation to test against in existing data.

## Claim 4 — Armour. One derivation REJECTED in favour of shipped ratings.

We first derived armour value as mass per half-value layer: `baryonicHalfValue_cm / 100 × density_kgm3`. That ranks Steel (589 kg/m²) and Titanium (506) among the best and Nanotube (2,673) and Adamantane (2,084) among the worst.

The templates publish explicit ratings in `specialties[]`:
```
SteelArmor       BaryonicResistance  1.00   XRayResistance 0.27
AdamantaneArmor  BaryonicResistance 31.02   XRayResistance 4.82
```

Roughly the reverse ordering. We dropped our derivation and used the shipped ratings.

**Was that right?** Both readings come from the same file. Is the half-value figure meaningful for something else — a different damage channel, a thickness budget — that we have discarded too readily?

## Claim 5 — Mission control. PINNED for 7 of 8 factions, with an unexplained residual.

`sum(ship.missionControlConsumption) + sum(negative hab-core missionControl)` reproduces the save's own reported usage exactly for seven factions (65=65, 147=147, 143=143, 79=79, 93=93, 412=412).

**The Servants carry a +40 residual we cannot explain.** We surface it with `reproducesSaveFigure: false` rather than smoothing it. What produces 40 mission control that our model does not see?

## Claim 6 — Coverage honesty.

Economic valuation prices research effects against live quantities (e.g. a `+5% SpaceMiningBonus` effect × the observer's actual mining output = a real monthly delta).

We price **14 of 141 contexts — 8.5% of effect references**. Every unpriced context is named with its effect count and a reason. We also report `unexplainedResearchIncome: 869.7` against 3,151 total monthly, because our mapped sources only account for 2,281.

**Is 8.5% a fair characterisation, or is our denominator misleading?** And is the 870 residual a missing income source we should have found?

## Claim 7 — Monte Carlo engagement thresholds.

Seeded (mulberry32, seeded from `snapshotId` so the same save always reads the same) Lanchester-style attrition sim, sweeping own-hull count against opponent tiers until P(win) ≥ 0.8, reported as a **p20–p80 band across 120 seeds**.

The band *is* the answer — "4–5 hulls" is the measured spread, not a hedge.

**Questions:** is the attrition model defensible for this purpose? Is 120 seeds × 30 battles enough for a stable p20/p80? Is reporting a percentile band the right honesty mechanism, or does it imply more precision than the underlying model supports?

---

## What would be most useful

In rough priority:

1. **Claim 3** — can the allocation formula be made to fit, or is the rejection correct? This blocks a real feature.
2. **Claim 1's alien discrepancy** — 260 ships disagreeing suggests a missing term.
3. **Claim 5's Servants residual** — a clean 40 feels like a category we have missed entirely.
4. **Any place we report `0` where we should report `null`.** That is the failure mode this project cares about most.
5. Whether any "pin" is a coincidence rather than a real relationship.

Tests: `npm test` (750 passing). Every model is in `shared/` as ESM — `propulsion.mjs`, `militaryValue.mjs`, `economicValue.mjs`, `researchSlots.mjs`, `researchRanking.mjs`. Each exports a `formulae` block stating its own arithmetic and whether it claims validation against game output.
