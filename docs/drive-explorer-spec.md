# Drive Explorer — every drive against one of your designs

Written 2026-08-21 against `b3b77f6`.

Pick one of your designs, see what every drive in the game would do to it: delta-V, combat
acceleration, and which destinations open up. Nearly all of it is assembly of parts that
already exist and are already pinned.

---

## The two halves, and why the distinction is the whole spec

**The performance half is measured.** `refitOntoDrive` (`shared/propulsion.mjs`) rates an
unbuilt drive against a fitted ship by holding the ship's **measured** dry mass and tank
capacity constant and swapping only the drive — the same comparison the game's own rated
figures make. The propulsion model behind it reproduces shipped figures on 696 of 698
ships. This is the trustworthy half.

**The distance half is a heuristic.** `shared/intel/mobility.mjs` says so in its own header:
*"its destination table is a heuristic estimate rather than a measurement"*, and it sets
`isEstimate: true` on every response specifically so it is not mistaken for the measured
fleet projections. It yields, per destination:

```
destination  deltaVRequired  travelDays  propellantCostTons  arrivalDate  feasible  warning
Luna                    2.1          10                  25  2035-01-11      true
Earth                   6.5         150                  78  2035-05-31      true
Venus                   8.4         190                 101  2035-07-10      true
Mars                    9.8         320                 118  2035-11-17     false   insufficient delta-V (9.5 available vs 9.8)
Vesta                  13.5         840                 162  2037-04-20     false
Ceres                  14.2         900                 170  2037-06-19     false
Callisto               21           1460                252  2038-12-31     false
Ganymede               22           1500                264  2039-02-09     false
Titan                  28           2200                336  2041-01-09     false
```

**The page must label which half is which.** A ΔV figure is a measurement; "this drive gets
you to Ceres" is an estimate from a heuristic table. Rendering them in the same visual
register would launder the estimate into a measurement — the failure this repo keeps
correcting.

Nine destinations only. State that too: an absent body is not an unreachable one.

## What to build

A **DRIVE EXPLORER** page. A design picker, then one row per drive.

**Rows** — for each of the 541 entries in `driveStats`:

- drive name, classification, propellant
- **ΔV (km/s)** and **combat acceleration (m/s²)** from `refitOntoDrive`
- **delta against the currently fitted drive**, since that is the decision
- **destinations that open up** at that ΔV, from the mobility table, marked as estimates
- **availability** — see below
- `dryMassCaveat` where the candidate's fixed drive mass differs from the fitted one;
  `refitOntoDrive` already emits the sentence

**Availability, four states**, not two. The player explicitly wants to see drives they
cannot build, so show them all and label honestly:

```
completed or ungated   fittable today
locked                 researchable, with the chain cost from tech-path
never researchable     researchCost -1 sentinel (alien tech)
unresolved             dropped with a recorded reason, never a blank row
```

Do not silently exclude the locked ones. Do not present them as options either.

## Reactor compatibility is a real gate

A drive requires a compatible reactor: `requiredPowerPlant` must equal the design's
reactor `powerPlantClass`, or be the sentinel `Any_General`. There are 13 classes, and the
rule **pins 580/580** across every design in the save. A drive the design's reactor cannot
power is not an option, however good its numbers.

Show the incompatibility and name the reactor class it would need. Do not hide the row —
"this needs a Gas Core Fission reactor" is exactly the kind of thing this page exists to
tell you.

**Power is information, never a veto.** The game scales thrust rather than rejecting an
underpowered ship — a fielded alien design runs 2.13× over its plant. Report plant output
against required draw and the thrust-scaling consequence, and do not reject on it.

## Parsing traps that will bite

- **`req power` is a string with thousands separators** on 92 of 541 drives —
  `"2,130.928"`. `Number()` of that is `NaN`, and a `?? 0` fallback turns the highest-power
  drives into zero draw. That mistake produced a fake "580/580 power pin" once already.
  Strip separators; unparseable is **null**, never 0.
- **`researchCost: -1` is a sentinel**, not a cost. Summing it makes chains look cheaper.
- **Some drives carry `flatMass_tons: 0` and `specificPower_kgMW: 0` legitimately** — Nerva
  and Burner among them. Zero mass is a real value there, not a missing one.

## Placement

The player asked for a dedicated page. Add it to the view registry rather than nesting it
inside FLEET, which is already dense.

Per `CLAUDE.md`: **a rendered panel needs a registry entry and a startup assertion.** Add
the view and its panel ids to `VIEWS`, confirm `assertViewRegistryIntegrity()` passes, and
update every place that pins the view list — `tests/v2Navigation.test.js` asserts an exact
count, and `scripts/verify_v2_navigation.js` hardcodes the id list in two places. Keep the
count assertion **exact**; it exists so a view cannot be added unnoticed.

## Constraints

- **Both modes.** The observer's own designs and drives are visible in player mode; verify
  it renders there and does not depend on omniscient-only data.
- **Absent stays null.** An uncomputable ΔV is `unknown`, not 0. `refitOntoDrive` already
  returns `computable: false` with a reason — surface it rather than blanking the row.
- **541 rows needs sorting and filtering**, not pagination alone: by ΔV, by acceleration,
  by availability, by reactor compatibility. Any cap announces itself with
  `*TotalCount` / `*OmittedCount`.
- Do not change `refitOntoDrive`, `mobility.mjs`, or the propulsion model. They are pinned;
  this page consumes them.
- Nothing campaign-specific — no hardcoded drive, design or destination names.
- `shared/**` runs in both runtimes.
- Read `docs/code-index.md`; update `Purpose:` lines and run `npm run index` last.

## Acceptance

- A design picker lists the observer's designs; selecting one renders drive rows.
- Every drive in `driveStats` is represented or explicitly accounted for; the count on
  screen plus any omitted count equals the total.
- ΔV and acceleration come from `refitOntoDrive`, with `dryMassCaveat` visible where it
  applies.
- **Destination reachability is visibly marked as an estimate**, distinct from the measured
  ΔV. Assert the label renders — this is the criterion most likely to be skipped.
- Reactor-incompatible drives are shown, marked, and name the required class. Assert with a
  design whose reactor class excludes a known drive.
- Locked and never-researchable drives are labelled, not hidden and not offered.
- `req power` parses comma-safe; assert `"2,130.928"` does not become 0.
- The new view is registered, `assertViewRegistryIntegrity()` passes, and the exact-count
  navigation assertions are updated deliberately rather than loosened.
- Both modes; no `null` / `undefined` / `NaN` rendered; full suite green with exact counts.

## Note on scope

The player called this "a little cheaty". That is a game-design judgement, not a modelling
one: every figure here is derived from the same save and templates the rest of the
dashboard already reads, and the calculation is the one the game itself performs. Nothing
in this page requires information the player does not have. The honesty obligations are
unchanged — label the estimate as an estimate.
