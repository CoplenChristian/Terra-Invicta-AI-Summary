# Campaign settings — four of five verdicts hold, and the research one was WRONG

Written 2026-08-21 against `2b6e3d5`. **Revised 2026-08-22 against `431be86`** (tracker 3b),
which replaced the research evidence but kept its conclusion.

**Revised again 2026-08-22 against `866b8a8`, and this revision OVERTURNS a verdict.**
`researchSpeedMultiplier` does **not** act on output. It acts on the effective research
**cost**, and on this 200% campaign the game charges exactly **half** the template figure.
Every research cost, completion percentage and duration the dashboard printed was therefore
2× too high from 2026-08-21 until the correction. The user reported that campaign settings
were not reflected in the durations, and the user was right.

The measurement, the three independent lines behind it, and why the earlier proof could not
see it are in `shared/researchCostScaling.mjs` and in the corrected section below. The
superseded reasoning is kept in place, marked.

**The other four verdicts stand and were not re-opened.** Mining, national IP, alien
progression and control points are unaffected for the reason the original spec gave: the
dashboard reads measured values from the save almost everywhere rather than computing from
base rates, so those multipliers are already inside what it reads. Research was the one
place where a figure came from a **template** rather than from the save, and that is exactly
where the multiplier had somewhere to hide.

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
| `researchSpeedMultiplier` | **WRONG, corrected 2026-08-22. Acts on COST.** Effective cost = template ÷ (multiplier/100). Applied in `shared/researchCostScaling.mjs` |
| `miningProductivityMultiplier` | **checked — unaffected.** Site rates are realised extraction |
| `nationalIPMultiplier` | **checked — unaffected.** `computeBaseIP` reproduces the save's own figure |
| `alienProgressionSpeed` | **checked — unaffected.** Hate is `save-derived`; venting rate is measured or refused |
| `controlPointMaintenanceFreebieBonus` | **not applicable.** No model computes control-point upkeep |
| `averageMonthlyEvents` | **not applicable.** Nothing consumes an event rate |

### Research — acts on COST, and the 2026-08-21 verdict was wrong

> **OVERTURNED 2026-08-22.** This section's heading used to read "acts on output, not on
> cost", and the whole dashboard priced research against the raw template cost on the
> strength of it. The evidence below is real and reproduces; it is about a **different
> campaign**. The superseded text is kept in full, marked, because how it went wrong is the
> useful part.

**Superseded, kept — the 2026-08-21 cost argument:**

> Scanning all 14 saves for the highest accumulated-versus-template-cost ratio on an item
> still in progress:
>
> ```
> Fleet Logistics   accumulatedResearch 44,780 / template researchCost 45,000 = 99.5%
>                   still in progress (First.gz)
> ```
>
> A halved effective cost of 22,500 would have completed that project long before it reached
> 44,780. **Effective cost equals template cost**, so every remaining-cost figure the advisor
> prints is right.

**`First.gz` carries no `TIMetadataState` custom-difficulty block at all.** Its
`campaignSettings.available` is `false` and it has no `researchSpeedMultiplier`. The
observation is therefore evidence that a campaign *with no multiplier* charges template
cost — which is true, and silent about a campaign that has one. The sweep was described as
covering "all 14 saves" but reported only its maximum, and the maximum came from the one
family of saves that could not answer the question.

#### What the corrected measurement shows

Three independent lines, 2026-08-22, on the same four MD5-verified frozen saves plus three
further campaign saves and four controls:

**1. Tracked to completion, on the observer's own project.**
`Project_GasCoreFissionReactorVI` carries a template `researchCost` of 10,000. At
12/16/2034 12:00 it stood at **4,708.568** accumulated. It was **complete** by 1/1/2035,
15.5 days later, and its slot's delivery rate over the preceding interval was measured — not
modelled — at **30.2467 points/day**.

```
days from 4,708.568 to the TEMPLATE cost of 10,000    174.94     impossible
days from 4,708.568 to template/2 = 5,000               9.64     fits
interval available                                     15.50
```

The successor project's own accrual in the tail of the same interval (`Project_ColonyCore`,
155.5453 points) places the handover at ~10.4 days, putting the effective cost at **~5,022** —
template/2 to within 0.44%, inside the allocation model's own 1.4% band.

**2. A hard ceiling at exactly 50%.** Across the five saves carrying
`researchSpeedMultiplier: 200%` — the four frozen ones plus `initiative.gz`, `Again.gz`,
`Quicksave.gz` — **278 in-progress project rows** with any accumulated research:

```
[0.0,0.1) 83   [0.1,0.2) 33   [0.2,0.3) 36   [0.3,0.4) 15   [0.4,0.5) 12
[0.5,0.6)  0   [0.6,0.7)  0   [0.7,0.8)  0   [0.8,0.9)  0   [0.9,1.0)  0
```

Maximum 0.49716. A quantity caught mid-flight at random does not stop dead at one half.

**3. A two-sided control.** The corpus is not incapable of showing rows past 50%. Saves with
no readable multiplier do it routinely: `First.gz` 13 of 49 rows above 0.5 with a maximum of
0.9756, `servant.gz` 1 of 37. CLAUDE.md's warning about one-sided pins is answered — illegal
states are observed to be reachable elsewhere and unreachable here.

`TIGlobalResearchState.useHarshTree` is `false` in all eight saves examined, so it is not the
confound.

#### The income half stands, for a better reason than was given

`cachedYearlyRevenue.Research` is the game's own realised annualised rate, and the observer's
measured per-slot delivery matches it times the allocation terms to a uniform 1.4%. It must
**not** be multiplied again. Applying the campaign multiplier to both cost and income would
produce the 4× error the original verdict was guarding against.

But note what the 2.1115× measurement below can and cannot do. **Both sides of it are
research POINTS; cost never enters.** "Income already doubled, cost unscaled" and "income
never doubled, cost halved" predict the identical 2.11×. The 4.2840× alternative it ruled out
— income doubled *and* everything else unchanged — was the one hypothesis nobody held. It is
a correct measurement of the income path and it **cannot discriminate** on the cost path.

> **The argument for that was replaced on 2026-08-22 (tracker 3b). The conclusion stands;
> the reasoning that reached it did not.** The superseded wording is kept immediately below.

**Superseded, kept:**

> …and the reproduction recorded in `ALLOCATION_MODEL` (`shared/researchSlots.mjs`) compared
> predicted against observed delivery over two intervals at **1.147× and 0.993×**.
> Pre-multiplier revenue against real 200% delivery would have shown ~2.0.

Two things are wrong with it, and neither is the conclusion.

1. **It is circular.** `delivered / predicted ≈ 1.0` says only that the model's multipliers
   explain the delivery. It cannot locate a constant factor of 2 unless every multiplier in
   the model is independently known — and that prediction carried a **fitted** `ProjectBonus`
   of `−0.209`, which the same document called a project *penalty* and flagged as
   contradictory. A free parameter of unknown sign and magnitude is exactly where a missing
   ×2 hides. A model that admits it does not reproduce cannot then be used as a null.
2. **The figures are not reproducible as recorded.** `ALLOCATION_MODEL.reproduction` states a
   pip layout of `[0,0,3,3,3,0]` and dates of 12/1/2033 – 1/1/2034. All four MD5-verified
   saves it names carry `researchWeights` `[0,0,3,1,3,1]` and run 12/1/2034 – 1/1/2035. No
   faction in those saves carries `[0,0,3,3,3,0]`.

**The replacement, measured 2026-08-22 on the same four frozen saves** (`Autosave3.gz`
`61cc7c11…`, `Autosave2.gz` `5294cddf…`, `Autosave.gz` `2ef96430…`, `ExitSave.gz`
`5c0d9ef9…`), observer 4712, 12/1/2034 → 12/16/2034 12:00, 15.5 days:

```
delivered to all four pip-carrying slots               3,381.21
cachedYearlyRevenue.Research x 15.5 / 365.25           1,601.36
                                          measured gain  2.1115x

predicted from the allocation terms ALONE, every term read from the save:
  (1 + 5% x 4 pipped slots)                                1.2000
  x SUM over slots of pipShare x (1 + Category + Project)  1.78475
                                                         = 2.1420x

predicted if cachedYearlyRevenue.Research ALSO still needed the 200%
                                                         = 4.2840x
```

The measurement sits on the first, 1.4% low, and that residual is **uniform across all four
slots** (0.98461 / 0.98612 / 0.98591 / 0.98612) — one common scale factor with no room for a
spare ×2. Nothing here is fitted: `ProjectBonus = min(100%, (21 − 2) × 5%) = 0.95` is read
from `cachedYearlyRevenue.Projects`, and the Xenology `CategoryBonus` of 0.44 is two Xenology
Labs plus 24 `alienInvestigations`.

The structure rules it out a second way. A project pip delivers **1.885714×** a global-tech
pip, against `(1 + 0.03 + 0.95) / (1 + 0.05) = 1.885714` predicted — agreement to six figures.
A campaign-wide research multiplier cannot produce a ratio *between two slot kinds*; only a
`ProjectBonus` can, and that one is read from the save.

**And the same measurement does not license the opposite error.** The 2.1115× gain is a
whole-faction sum over four slots; a duration is about one slot, whose measured factors are
0.4658×, 0.2928×, 1.0602× and 0.2928× of the nominal income. `docs/research-category-rate-spec.md`
carries the arithmetic.

> **"No duration moves" — WITHDRAWN 2026-08-22.** That sentence ended this section until the
> cost side was measured, and it was wrong twice over. Every duration moved, for two
> independent reasons: the remaining cost halved (this section), and the rate a project
> actually receives is its slot's share rather than the whole faction's income
> (`shared/researchAllocationPricing.mjs`). On the observer's 1-pip project slot the two
> corrections push the same way and the stated duration went from 0.7 months to 2.3 — against
> 2.35 measured from the slot's own accumulated deltas.

The player's report that "techs are half what they normally are" describes the experience
accurately — and the mechanism is now measured rather than assumed. It is **not** doubled
output: it is halved cost. The distinction was invisible from the income side, which is why
it took a cost-side measurement to find.

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
- ~~**Every existing figure is unchanged.** Research costs, `monthsAtCurrentIncome`, mining
  tonnes/month and advise IP must produce byte-identical output before and after.~~
  **AMENDED 2026-08-22.** Mining tonnes/month and advise IP are unchanged and must stay so.
  Research costs and durations are **not**: they were wrong, and the correction moves them
  (see the overturned verdict above). What survives is the reason the criterion existed —
  that a 2× error must not be *introduced* — and it now cuts the other way: applying the
  multiplier to the research **income** as well as to the cost would be the 4× version of
  the same mistake. `shared/researchCostScaling.mjs` refuses it explicitly.
- Both modes; full suite green with exact pass/fail/skip counts.
