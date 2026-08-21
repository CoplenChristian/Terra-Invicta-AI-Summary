# Campaign settings — measured, and the numbers are already right

Written 2026-08-21 against `2b6e3d5`. **Conclusion reached by measurement, 2026-08-21:
no rate model needs changing.** What remains is a display and transparency fix.

This campaign runs custom difficulty with four rates at 200%. The premise of this spec was
that the dashboard, which bakes only the difficulty *label*, must therefore be projecting
durations and rates from stock numbers. **That premise is wrong**, and implementing the
"fix" would have introduced 2× errors into figures that are currently correct.

The reason is structural: the dashboard **reads measured values from the save** almost
everywhere rather than computing from base rates, so the multipliers are already baked into
what it reads.

---

## The settings

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

## Findings, one per multiplier

| multiplier | verdict |
| :-- | :-- |
| `researchSpeedMultiplier` | **checked — unaffected.** Acts on output, not cost |
| `miningProductivityMultiplier` | **checked — unaffected.** Site rates are realised extraction |
| `nationalIPMultiplier` | **checked — unaffected.** `computeBaseIP` reproduces the save's own figure |
| `alienProgressionSpeed` | **checked — unaffected.** Hate is `save-derived`; venting rate is measured or refused |
| `controlPointMaintenanceFreebieBonus` | **not applicable.** No model computes control-point upkeep |
| `averageMonthlyEvents` | **not applicable.** Nothing consumes an event rate |

### Research — acts on output, not on cost

Scanning all 14 saves for the highest accumulated-versus-template-cost ratio on an item
still in progress:

```
Fleet Logistics   accumulatedResearch 44,780 / template researchCost 45,000 = 99.5%
                  still in progress (First.gz)
```

A halved effective cost of 22,500 would have completed that project long before it reached
44,780. **Effective cost equals template cost**, so every remaining-cost figure the advisor
prints is right.

Income is already post-multiplier too. `monthsAtCurrentIncome` derives from
`cachedYearlyRevenue.Research`, and the reproduction recorded in `ALLOCATION_MODEL`
(`shared/researchSlots.mjs`) compared predicted against observed delivery over two
intervals at **1.147× and 0.993×**. Pre-multiplier revenue against real 200% delivery would
have shown ~2.0.

The player's report that "techs are half what they normally are" describes the experience
accurately — research completes twice as fast — but that comes from doubled output, and the
dashboard already reflects it.

### Mining — site rates are realised extraction

Observer-owned sites with a **completed** mine, per-day rates × 30, against the faction's
own `monthlyIncome`:

```
resource      rate/day   x30 = /month   actual income   ratio
water            22.71          681.2          703.56   1.033
volatiles        31.80          954.1          895.69   0.939
metals           35.39         1061.8         1161.26   1.094
nobleMetals       8.93          268.0          291.56   1.088
fissiles          0.19            5.6            6.78   1.219
```

Five independent resources near 1.0; an omitted 200% would read ~2.0 throughout. The
residual spread is consistent with small non-mining contributions and rounding.

Two wrong turns, recorded so they are not repeated:

1. The first comparison summed all **409 prospected sites** instead of the observer's 17
   completed mines, and compared per-day rates against per-month income. It produced
   ratios of 0.57–3.20 and meant nothing. Both faults must be fixed together.
2. "All 280 unmined sites report rates, so these values are richness rather than
   extraction" is **wrong**. Unmined sites report *projected* yield — exactly what a
   prospecting board should show. The same field on a built mine carries the realised rate.

For the next reader: `siteMonthlyOutput` (`shared/intel/common.mjs:122`) applies only
`rateMultiplier`, which is a daily→monthly unit conversion (×30), not a difficulty term.
That is correct, because the rates it reads are already actuals.

### National IP — the formula reproduces the game's own figure

This was the one genuine candidate, because `computeBaseIP`
(`server/engine/adviseEconomics.js:34`) **derives** IP rather than reading it:

```
baseIP = max(0, GDP_bn^0.35 × unrestFactor − armyNavyDrag)
```

A derived value cannot inherit a multiplier the save applies. But the save carries
`baseInvestmentPoints_month` per nation, so the formula can be tested directly. Across
**295 nations, median actual/computed = 1.000**, with exact matches on nations carrying no
army drag:

```
United Malay Nation   25.58 actual / 25.58 computed   1.000
Brazil                19.08 / 19.08                   1.000
Mexico                17.24 / 17.24                   1.000
Colombia              15.71 / 15.72                   1.000
```

The 0.55–0.94 outliers come from a crude replication of the army-drag term (all armies
assumed idle at 0.5); the shipped code distinguishes `atHome && !deployed` and should match
at least as closely. **The formula already produces the game's real IP.**

### Alien progression, control points, events

`alienHateEconomics.mjs` reports `source: 'save-derived'`, and the venting rate is measured
from a previous-save comparison and **explicitly refused when unmeasurable** — including in
player mode, where the true hate figure is redacted. Nothing projects from a stock rate.

No model computes control-point upkeep, so the 150-point player freebie has nothing to be
misapplied to. Nothing consumes an event rate.

---

## What to build

Correctness needs nothing. **The remaining defect is presentational and real:**

`metadata.difficulty` reads **"Normal"** while `customDifficulty` is true and four rates
run at 200%. A reader sees a stock campaign. Anyone comparing this dashboard's figures
against a stock-difficulty reference will draw wrong conclusions, and any future model that
*computes* rather than reads will need these values.

1. **Bake the settings.** Carry the `TIMetadataState` custom-difficulty block into the
   snapshot alongside `difficulty`, parsed numerically, `null` where unparseable.
2. **Never render a customised campaign as plain "Normal."** Show the label plus the
   non-stock multipliers, or mark it customised.
3. **Record the verdicts above in code**, next to the models they clear, so a future reader
   does not re-derive them — or worse, "fix" a correct figure.

### The parse trap

These are strings carrying a percent sign or a bare numeral. `Number("200%")` is `NaN`, so
`Number(x) ?? 0` yields a confident **zero** — worse than no multiplier, because a zero
annihilates whatever it touches.

Third instance of this class here: comma-formatted `req power` on 92 drives produced a fake
580/580 power pin, and `researchCost: -1` sentinels made tech chains look cheaper. Strip
the `%`, parse, and treat unparseable as **`null` — never `0`, never a silent `1`.**

## Constraints

- Both modes. These are campaign settings, not faction intel, but verify player mode
  carries them.
- Absent stays null.
- Nothing campaign-specific: read the values, never hardcode 200%.
- Read `docs/code-index.md`; update `Purpose:` lines and run `npm run index`.

## Acceptance

- All ten settings baked and parsed; `"200%"` → a number, never `0`.
- A `customDifficulty: true` campaign never renders as plain "Normal".
- **Every existing figure is unchanged.** Research costs, `monthsAtCurrentIncome`, mining
  tonnes/month and advise IP must produce byte-identical output before and after. This is
  the most important criterion: the measurements above say they are already correct, and a
  regression here would be a 2× error introduced by the change.
- Both modes; full suite green with exact pass/fail/skip counts.
