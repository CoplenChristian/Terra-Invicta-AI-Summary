# Campaign settings — the dashboard is ignoring the multipliers

Written 2026-08-21 against `2b6e3d5`.

This campaign runs custom difficulty with several rates at 200%. The snapshot bakes the
difficulty *label* and drops every multiplier, so any model that projects a duration, a
rate, or a remaining cost is working from stock numbers.

---

## Measured

`TIMetadataState` in the raw save:

```
customDifficulty                       true
difficulty                             "Normal"        <- the only field currently baked
researchSpeedMultiplier                "200%"
miningProductivityMultiplier           "200%"
nationalIPMultiplier                   "200%"
alienProgressionSpeed                  "200%"
controlPointMaintenanceFreebieBonus    "150"
controlPointMaintenanceFreebieBonusAI  "0"
missionControlBonus                    "0"
missionControlBonusAI                  "0"
averageMonthlyEvents                   "5"
```

Only `metadata.difficulty` reaches the snapshot, and it reads **"Normal"** — which is
actively misleading while `customDifficulty` is true. A reader sees a stock campaign.

## The parse trap

**These are strings carrying a percent sign or a bare numeral.** `Number("200%")` is
`NaN`, so the usual `Number(x) ?? 0` / `|| 0` idiom yields a confident **zero** — and a
zero multiplier is worse than no multiplier, because it silently annihilates whatever it
touches.

This is the third instance of this class in this repo: comma-formatted `req power` on 92
drives produced a fake power pin, and `researchCost: -1` sentinels made chains look
cheaper. Strip the `%`, parse, and treat unparseable as **`null` — never `0`, and never a
silent fallback to `1`.** A multiplier that cannot be read must make the affected figure
report `unknown`, not quietly proceed at stock rate.

## Settle the direction before implementing

**Do not assume which side of the equation the multiplier applies to.** For research there
are two possibilities and they lead to opposite fixes:

- **Cost side** — a 200% rate halves project cost. Then every remaining-cost figure the
  advisor prints (3,000 for Colony Core, 15,000 for the Antimatter Microfission chain) is
  **2× too high**, while `monthsAtCurrentIncome` may already be right.
- **Income side** — a 200% rate doubles research output. Then costs are right and durations
  are wrong.

`monthsAtCurrentIncome` is derived from `cachedYearlyRevenue.Research`, which is **measured
from the save**. If that figure is already post-multiplier, month estimates are correct
today and only displayed costs are wrong. If it is pre-multiplier, every duration shown is
2× too long.

**Measure it.** Take two consecutive saves, compute research actually delivered over the
elapsed interval, and compare against `cachedYearlyRevenue.Research` scaled to that
interval. If delivery matches revenue, revenue is post-multiplier. The technique and its
confounds are already documented — see `ALLOCATION_MODEL.reproduction` in
`shared/researchSlots.mjs`, and note the income-drift confound recorded there: use a
**relative** comparison where possible, since a stable relative share cancels global drift
while an absolute ratio does not.

The user reports "techs are half what they normally are", which points to the cost side.
That is a starting hypothesis, not evidence — confirm against the save.

## Surfaces to check

Each of these plausibly consumes a rate. **Check each; do not assume a uniform fix.**

| multiplier | plausibly affects |
| :-- | :-- |
| `researchSpeedMultiplier` | research advisor costs and `monthsAtCurrentIncome`; every chain projection in `research-chain-spec.md` |
| `miningProductivityMultiplier` | mining and economic value, tonnes/month, mining expansion board |
| `nationalIPMultiplier` | nation investment-point projections, Advise valuations |
| `alienProgressionSpeed` | alien threat timelines, hate trajectory, any "months until" estimate |
| `controlPointMaintenanceFreebieBonus` | control-point and mission-control budgets (note the AI variant is 0 — this is a player-only bonus of 150) |
| `averageMonthlyEvents` | event-rate assumptions, if any model carries one |

A surface that turns out **not** to consume the rate should be recorded as checked and
unaffected, so the next reader does not re-derive it.

## What to build

**1. Bake the settings.** Carry the full `TIMetadataState` custom-difficulty block into the
snapshot alongside `difficulty`, parsed to numbers with `null` for unparseable. Both
runtimes.

**2. Say when difficulty is customised.** Anywhere the difficulty label renders, a
`customDifficulty: true` campaign must not read as plain "Normal". Show the label plus the
non-stock multipliers, or mark it customised.

**3. Apply the rate where it belongs**, once the direction is settled, and **state the
applied multiplier next to any figure it changed** so a surprising number is explicable.
A duration that silently halves is indistinguishable from a bug.

**4. Where a multiplier is absent or unparseable, report `unknown`** for the derived
figure rather than falling back to stock. Absent is not 100%.

## Constraints

- Both modes. These are campaign settings, not faction intel — they are not redacted, but
  verify player mode carries them.
- Absent stays null; `Number("200%")` is `NaN` and must never become `0` or `1`.
- Nothing campaign-specific: read the values, never hardcode 200%. A new campaign at stock
  rates must behave identically to today's output.
- Templates are baked at snapshot-build time; the worker has no filesystem.
- Read `docs/code-index.md`; update `Purpose:` lines and run `npm run index`.

## Acceptance

- All ten `TIMetadataState` settings are baked, parsed numerically, with `null` for
  unparseable. Assert `"200%"` → `200` (or `2.0`, stated explicitly) and never `0`.
- A campaign with `customDifficulty: true` never renders as plain "Normal".
- The research direction question is **answered with a measurement recorded in the spec**,
  not assumed. State which side the multiplier applies to and show the evidence.
- Every affected figure states the multiplier applied to it.
- Each surface in the table above is recorded as either adjusted or checked-and-unaffected.
- With the settings absent, behaviour is unchanged and the affected figures report unknown.
- A stock-rate campaign produces output identical to today's.
- Both modes; full suite green with exact pass/fail/skip counts.
