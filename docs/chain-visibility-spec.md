# Promote chains into the visible ranking

Written 2026-08-21 against `3b60bbe`. Frontend and ranking only — the chain model,
`tech-path` and the capability verdicts are all correct and stay as they are.

The chain feature works and cannot be seen. This makes it visible without adding a row to
a panel that has no room for one.

---

## The problem, browser-verified

The Research Advisor in COMMAND renders four groups:

```
MILITARY   RESEARCHABLE NOW · IN PROGRESS
ECONOMIC   RESEARCHABLE NOW · NOT YET AVAILABLE — ROLLS MONTHLY
```

**"Prerequisites not met" is not rendered** (`prereqGroupRendered: false`), and it is the
only group containing multi-step chains:

```
Pion Torch x6                     12 steps   1,300,325 pts
240 cm Green Phaser Cannon         4 steps     142,000 pts
Antimatter Plasma Core Reactor I   3 steps     160,000 pts
Point Defense Phaser Turret        3 steps     111,500 pts
Exotic Heat Sink                   2 steps      25,000 pts
```

Every row that *does* render has `stepsCount: 1`, and the chain badge is correctly gated on
`stepsCount > 1` (`research-advisor.js:255`), so **no chain badge can appear in the panel
as currently composed**. The content is right in the full-ranking drill-down — `CAPABILITY`
and `DRIVE CHAIN` sections, step counts, immediate-next-step tooltips — but the player has
to go looking.

The original ask was for the advisor to *steer*. The headline case — research Colony Core,
two steps, Battlestations follows — never reaches the surface that answers "what should I
research next".

## The approach

**Promote chain rows into the existing groups, competing for the slots already there.**
No new group, no new chrome, no extra rows: a promoted chain displaces a lower-ranked row
rather than adding to the panel. COMMAND's 3.00-screen budget is untouched.

## Rank on per-point, but gate on reachability first

Measured per-point value, computed as `(improvementMultiple − 1) / totalRemainingCost`:

```
Firestar Fission Lantern x6      41.44 /    20,000  = 2.07e-3   visible
Compact Solid Core Fission        0.50 /     1,200  = 4.17e-4   visible
Pion Torch x6                   230.48 / 1,300,325  = 1.77e-4   hidden, 12 steps
Exotic Heat Sink                  2.88 /    25,000  = 1.15e-4   hidden,  2 steps
240 cm Green Arc Laser Cannon     0.50 /     5,869  = 8.52e-5   visible
```

Two hidden chains beat a visible row, so promotion genuinely changes the panel.

**But per-point alone is not enough, and this is the trap.** `Pion Torch x6` scores well
only because its multiple is 231×. At the observer's measured **2,937 research/month** its
1,300,325-point chain takes **442 months — about 37 years**. That is not advice. Meanwhile
`Exotic Heat Sink` at 25,000 points is **8.5 months** and genuinely actionable.

**Gate on time-to-complete before ranking on per-point.** A chain whose whole-chain
duration exceeds a reachable horizon is not promoted, however good its ratio. Derive the
horizon from measured research income — never a hardcoded month count, and never a
hardcoded point threshold, since both are campaign-specific and `research-advisor-spec.md`
§0 forbids that.

Where income cannot be measured, the duration is **unknown** and the row is not promoted —
unknown is not a pass.

## What a promoted row must say

A promoted row is **not startable now**, and must never read as if it were.

- **Lead with the immediate next step**, not the destination. That is the actionable
  instruction: *"Exotics"*, not *"Exotic Heat Sink"*. `row.chain.immediateNextStep` already
  carries it.
- **Name the destination and the distance**: what the chain ends in, how many steps, the
  whole-chain cost and its duration at current income.
- **Carry the `N steps` badge** so it is visually distinct from a startable row at a glance.
- Keep `research-row-naming-spec.md`: project names, not item names — the project is the
  string the player searches for.

## Two defects to fix in the same pass

**1. `ra-tag--chain` and `ra-tag--newcap` have no CSS.** Both are emitted by
`research-advisor.js:258` and `:262`, and neither appears in
`public/v2/css/mission-control.css` — confirmed zero matches, while `--deficit`,
`--fittable`, `--free`, `--unitless` and `--warn` all have rules. So both badges currently
render as a bare `.ra-tag` with no distinguishing colour. They need rules consistent with
the existing variants, and they must use the size tokens rather than a new hardcoded value.

**2. The census contradicts the capabilities block.** `military.capabilities` reports
`count: 40, itemsShown: 5`, correctly announcing its truncation. But
`military.unrankable.counts` reports `"first-in-class": 0` alongside `"not-comparable": 40`
— a bucket that is never populated beside a block that counts 40. Two parallel accountings
that disagree, which is the drift class `CLAUDE.md` records from the three hand-maintained
registry lists. Either move those 40 out of `not-comparable` into `first-in-class`, or drop
the empty bucket. Derive both from one place.

## Constraints

- **Both modes.** Chain data is present in player and omniscient alike; verify both.
- **COMMAND stays under 3.00 screens at 1920×1080.** Report the measured number. Promotion
  replaces rows rather than adding them, so this should hold — confirm it does.
- Absent stays null: an unmeasurable duration is `unknown`, never `0` and never a pass.
- Nothing campaign-specific — no hardcoded horizons, point thresholds or project ids.
- **Do not change the chain model, `tech-path`, or the capability verdicts.** They are
  measured correct: Battlestations routes through Colony Core, and the alternate-prereq
  semantics are pinned by `Project_ResidentialModule` resolving to `prereq-blocked`.
- Read `docs/code-index.md`; update `Purpose:` lines and run `npm run index` last.

## Acceptance

- At least one multi-step chain is visible in COMMAND without opening the drill-down.
  On the live save `Exotic Heat Sink` (2 steps, 25,000 pts, ~8.5 months) qualifies; assert
  a chain appears, not that specific row, since the save moves.
- **`Pion Torch x6` is NOT promoted**, despite outranking a visible row on per-point. This
  is the reachability test and it fails today — 12 steps and 442 months at measured income.
  Assert the exclusion and the reason.
- A promoted row leads with its immediate next step, names its destination, shows steps,
  whole-chain cost and duration, and carries the `N steps` badge.
- No promoted row reads as startable now.
- `ra-tag--chain` and `ra-tag--newcap` have CSS rules; verify by computing a style, not by
  reading the stylesheet — `--text-muted` was once defined self-referentially and every
  rule using it silently fell back to `inherit`.
- `first-in-class` and `capabilities.count` agree.
- Row count per group is unchanged; COMMAND under 3.00 screens, number reported.
- Both modes; full suite green with exact pass/fail/skip counts.

## Sequencing

`public/v2/css/mission-control.css` is currently held by the risk-tolerance change. This
work must land after it, or take the CSS additions as a separate final step.
