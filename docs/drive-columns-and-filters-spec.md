# DRIVES — show cruise acceleration, and filter on measured numbers

Written 2026-08-22 against `b40e4a5`. Two related changes to the same view.

---

# Part A — you can sort by a number that is not on screen

`public/v2/js/components/drive-explorer.js:66` offers a sort called **CRUISE ACCEL**,
line 192 sorts on `row.measured.cruiseAccelerationMps2`, and the header row at 423-429
renders `DRIVE / ΔV / COMBAT ACCEL / REACTOR / POWER DRAW / AVAILABILITY / DESTINATIONS`.

Cruise acceleration is never displayed. Choosing that sort reorders the table by an
invisible key, so the result reads as scrambled rather than sorted. That is worse than a
merely missing column.

## The two numbers are not near-substitutes

From `shared/propulsion.mjs:16-17`, both pinned and both measured:

```
cruise_m_s2 = drive.thrust_N / wetMassKg
combat_m_s2 = drive.thrust_N * drive.thrustCap / wetMassKg
```

So `combat / cruise` **is** `thrustCap` exactly. Measured across the full 541-drive
catalogue on the live save:

```
thrustCap    1  ->  72 drives      (cruise == combat)
             2  ->  24
             5  ->  14
            10  ->  36
            15  ->  48
            20  ->  36
            50  ->  42
            60  ->  73
            80  ->  25
           160  ->   6
                    ... 21 distinct values in all
```

**Only 72 of 541 drives have cruise equal to combat.** For the other 469 the displayed
combat figure overstates sustained transit acceleration by up to **160×**. VASIMR x1
reads 0.01010778 combat against 0.00016846 cruise; Arcjet Drive x1 reads 0.00336926
against the same 0.00016846. A reader planning a transfer off the combat column alone is
reading a burst figure as if it were a cruise figure.

That is the case for the column. It is not cosmetic.

## Naming

The request called this "cruise speed". It is an **acceleration**, in m/s², not a speed.
The speed-like quantity is ΔV, already the first measured column. Keep the existing
`CRUISE ACCEL` label and the `m/s²` unit; do not relabel it as speed.

## Measured, not estimated

`cruiseAccelerationMps2` is part of the `measured` block and must render in the measured
register — the same treatment as ΔV and combat, and visually distinct from the estimated
`DESTINATIONS` column. `scripts/verify_drive_explorer.js` already asserts that split by
computed style; extend it rather than adding a parallel check.

On the live save all 541 rows are `computable: true` with **zero** null cruise values and
438 distinct values, so the happy path is the only path you will see. Do not conclude the
null path is dead: `shared/propulsion.mjs:549` and `:881` both set
`cruiseAccelerationMps2: null` when a drive is not in the baked stats. Render `—` or
`UNAVAILABLE`, never `0`, and prove it with a synthetic row rather than by finding one.

---

# Part B — filter on the measured numbers

Asked for: "above 10 dV and 20 m/s² combat accel". Today the view filters by design,
availability bucket, reactor class, and a text search over drive/class/propellant
(`drive-explorer.js:211-320`). There is no numeric filter anywhere.

## Minimum thresholds on the three measured columns

- ΔV, in **km/s** (`measured.deltaVKps`)
- combat acceleration, in **m/s²** (`measured.combatAccelerationMps2`)
- cruise acceleration, in **m/s²** (`measured.cruiseAccelerationMps2`)

Combined with AND, which is what the request describes. Minimums only — a maximum has no
obvious use here, and two bounds per field is four inputs on a view that is already
column-tight. If a maximum turns out to be wanted, it is an additive follow-up.

**Label the units in the control itself.** `> 10` is ambiguous between km/s and m/s; the
placeholder or suffix must say which. This is the same class of defect as Part A.

## It must exist on the endpoint, not only in the browser

The bucket, reactor and search filters run client-side inside `paint()`. **Do not add the
numeric filter there.** Per the `CLAUDE.md` section on AI surfaces, a filter that exists
only in the browser is invisible to every agent reading
`/api/intel/drive-explorer`, and being agent-readable is half the point of this project.

Add `minDeltaV`, `minCombatAcceleration` and `minCruiseAcceleration` to
`driveExplorerResource` (`shared/intel/driveExplorer.mjs:544-553`), alongside the existing
`status` / `family`. Both runtimes must decide alike, so the parsing and bounds belong in
one shared constant the way `CATALOGUE_LIMIT_BOUNDS` already does — check
`site/worker/projections.js` reaches the same answer as `server/`.

Whether the browser controls call the endpoint or reuse the shared predicate against
already-fetched rows is your call; say which you chose and why. What is not optional is
that the endpoint honours the parameters.

## Absent stays null — the whole risk of this change

`Number(null) === 0`, so a null measurement tested against `>= 10` silently becomes
`0 >= 10` and the row is dropped as though it had been measured and found wanting.

**A row whose value for a filtered field is null is not a row that failed the filter.**
It is a row that could not be tested. Exclude it from the result, and report how many were
excluded for that reason, separately from how many genuinely failed the threshold. A
filtered view that quietly discards unmeasurable drives is the same defect as rendering a
confident zero.

Reject a non-numeric or negative threshold explicitly rather than coercing it, and echo
the rejection the way `sortRejected` already does at line 563. `minDeltaV=abc` must not
silently behave as no filter.

## Truncation and counts

The view already caps rows. With filters active the reader needs to know what happened to
the rest, so carry, and render:

- how many drives matched
- how many were excluded as unmeasurable, per the rule above
- how many matched but were cut by the row cap

`*TotalCount` / `*OmittedCount` per the existing convention. A filtered list that shows 25
of 300 matches without saying so is the defect this repo keeps re-fixing.

---

## Constraints for both parts

- **Mobile is freshly fixed and easy to regress.** `dda9b25` took DRIVES from 64
  unreachable elements to 0, and this adds an eighth column plus up to three new controls.
  Re-run `scripts/verify_mobile_overflow.js` and report the numbers at 375/414/768 in both
  modes. If eight columns will not fit, collapsing or stacking under a breakpoint is a
  better answer than shrinking the type — the type scale was itself just repaired and
  every step is only 1px apart. Do not re-open that.
- **Both modes**, verified, not assumed.
- Nothing campaign-specific.
- New query parameters must be documented in the `CLAUDE.md` endpoint list, and the
  registry row / discovery index must reflect them. Regenerate `docs/code-index.md` after
  updating any changed module's `Purpose:` line, and update `docs/README.md` in the same
  commit.
- Decide and state whether war-room §9 should carry cruise acceleration. It currently
  reports the design's fitted drive; a second acceleration figure may be worth its bytes
  or may not. Say which and why rather than defaulting either way.

## Acceptance

- `CRUISE ACCEL m/s²` renders in the measured register, and sorting by it visibly orders
  that column. Assert against the live save: top row `Neutron Liquid Rocket x6` at
  `20.5956`, and `VASIMR x1` at `0.00016846` against its `0.01010778` combat.
- A synthetic drive with `cruiseAccelerationMps2: null` renders as unavailable, not `0`,
  and does not sort as though it were zero.
- `?minDeltaV=10&minCombatAcceleration=20` returns only rows meeting both, in both modes,
  and the same thresholds in the UI produce the same set.
- A row with a null value in a filtered field is excluded **and counted as untestable**,
  not counted as a failure. Prove it on a synthetic row; the live catalogue has none.
- `minDeltaV=abc` and `minDeltaV=-5` are rejected and echoed, not coerced.
- Match / untestable / capped counts are on screen and in the payload.
- `verify_mobile_overflow.js` passes with reported numbers; desktop screen count reported.
- No `null` / `undefined` / `NaN` / confident `0` on any surface.
- Full suite green with exact counts and the delta explained. Baseline is
  **998 tests / 997 pass / 0 fail / 1 conditional skip**.
- Every new test broken deliberately first, to prove it can fail.
