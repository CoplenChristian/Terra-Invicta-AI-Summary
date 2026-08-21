# Strategic Commentary Engine + v2 Layout Restructure

Two pieces of work in one plan because they meet: the commentary is new content, and it needs somewhere to live in a layout that currently has no room for it.

Written 2026-08-20 against commit `f269f8a`. Every number below is measured, not estimated.

---

# Part 1 — Strategic commentary without an LLM

## 1.1 What we are reproducing

Prose of this shape, generated from save data:

> *"The important thing is not that you lost the fleeing Monitors. It's that the aliens finally burned enough hostility that you are back out of active war at roughly 30 hate, while your surviving military is now concentrated in the exact generation you actually want… Do not voluntarily fight aliens again until you have something on the order of 8–10 Heavy Rail Mk3 Battlecruisers."*

Decomposed, almost none of that needs a language model:

| element | source |
| :-- | :-- |
| "roughly 30 hate", "lost the Monitors" | **measured** — already in `strategicDelta` / `campaignPosture` |
| "back out of active war" | **measured** — threshold crossing, already detected |
| "your surviving military is the generation you want" | **pattern match** over lost vs surviving hull generations |
| "8–10 Battlecruisers" | **simulated** — the interesting part |
| tone, ordering, connectives | **templated**, seeded |

Four layers. Only the last is random, and the genuinely interesting non-determinism is in layer 3.

## 1.2 Layer 1 — Facts (exists, do not rebuild)

`shared/strategicDelta.mjs`, `server/directiveAdvisor.js` (`assessCampaignPosture`, `summarizeFleetCapability`, `buildHoldGround`), and `briefing.changesSincePrevious` already produce measured, null-honest facts. Consume them. Do not re-derive, and do not read raw save fields directly — `assessedAlienHateOfMe` is redacted in player mode and reading it would reopen a closed leak.

## 1.3 Layer 2 — Beats (deterministic predicates)

A **beat** is a named narrative unit that fires only when its facts hold. No beat may be emitted on partial evidence, and a beat whose inputs are unmeasured must not fire at all — silence is correct, invention is not.

Sketch:

```js
{
  id: 'forced-fleet-transition',
  requires: ['shipsLost', 'hateDelta', 'warStateChange', 'survivingHullTiers', 'lostHullTiers'],
  when: f =>
    f.shipsLost > 0 &&
    f.hateDelta < 0 &&
    f.warStateChange === 'exited' &&
    medianTier(f.survivingHullTiers) > medianTier(f.lostHullTiers),
  severity: 'pivotal'
}
```

Starting set (four is enough to prove the shape):

- `forced-fleet-transition` — losses concentrated in an older generation while a newer one survived
- `recovery-window` — hate fell below the war threshold **and** is still falling
- `hate-budget-banked` — large headroom to 50 with no forced spend
- `capability-gap-closing` / `capability-gap-widening` — the dominant deficit axis from `summarizeFleetCapability` moved between saves

`medianTier` needs a real hull-generation ordering. `shipHullStats[hull].constructionTier` is present in the snapshot (verified) and is the honest source — do **not** infer generation from hull display names.

## 1.4 Layer 3 — Monte Carlo (the non-deterministic crunching)

**Data, verified present:** `shipDesigns[]._unnormalizedCombatValue` is a per-design combat rating from the game itself. Measured spread on the current save:

```
alien design CV:  p10 3,251 · p50 20,330 · p90 70,100 · max 156,737
own best hull CV: 19,783   -- level with the alien MEDIAN design
```

`shipHullStats[hull]` additionally carries `structuralIntegrity`, `missionControl`, `baseConstructionTimeDays`. **`combatPower` on fleets is unusable** — every fleet in both modes reports `combatPowerSource: "not present in save"`. Do not build on it.

### Scope the opponent, do not assume the worst one

The first prototype asked "how many hulls beat their top six" and returned `P(win) = 0.000` at every count up to 24. Technically true, useless as advice. **The threshold question is only meaningful against a realistic opponent**, so the simulation sweeps opponent composition and reports which tier is actually winnable. Prototype output:

```
opponent                     hulls for P(win) >= 0.8
  1x median alien escort      1
  1x typical alien            2
  2x typical alien            3
  1x heavy alien (p90)        4-5      <- p20-p80 across 120 seeds
  3x typical alien            4
```

### The range is the output

`4-5` is not a hedge. It is the 20th-to-80th percentile of where the threshold landed across seeds. **When p20 === p80 the text says "4 hulls"; when they differ it says "4–5", and a wide band is itself information** — it means the outcome depends materially on how the engagement opens, and the prose should say so rather than quietly reporting the midpoint.

Every simulated figure is labelled as simulated. Per `CLAUDE.md`, a judgement call must say so rather than being presented as measured. A simulated threshold rendered in the same typographic weight as a measured hate value is a lie of presentation.

### Seeding

**Seed from `snapshotId`, never the clock.** Same save must always produce the same reading; a dashboard that rewrites its strategic advice on every refresh teaches the reader to distrust it. Variation across saves is the goal; variation across refreshes is a bug. Use a small explicit PRNG (mulberry32) committed in-repo — do not use `Math.random()`, which is unseedable and would also break the workflow runner's determinism rules.

### Other simulations worth having

- **Hate vent projection** — time to fall under 50, with variance taken from the observed decay rate across recent saves, reported as a band.
- **Rebuild clock** — hulls completable before a projected re-engagement, from `baseConstructionTimeDays` and live shipyard queues.

## 1.5 Layer 4 — Grammar

Each beat carries N phrasings; selection is by the seeded PRNG. Start with two per beat and grow — the value is in layers 2 and 3, and an elaborate grammar over weak beats just produces fluent nonsense.

Connectives are chosen by beat severity and sign, not at random: a `pivotal` beat following a loss takes a concessive construction ("the price was brutal, but…"), a `recovery-window` beat takes an imperative ("bank it"). Numbers are always rendered by the shared formatters so an unmeasured value cannot reach the page as `null`.

## 1.6 Acceptance

- Fires on the current save in **both** player and omniscient mode, with different content — player mode cannot see true hate and must not imply it does.
- Same `snapshotId` → byte-identical output across runs. Different save → different output.
- No beat fires on unmeasured inputs. Strip a required field and the beat disappears rather than degrading to a default.
- Every simulated number is visually distinguishable from every measured one.
- `P(win) = 0` against an unwinnable opponent produces "this tier is not winnable at any count we simulated", never a number.
- Zero `null` / `undefined` / `NaN` in rendered text.

---

# Part 2 — v2 layout restructure

## 2.1 Measured problems (1920×1080, all four views)

```
view        page height   screens of scroll   cards
command         5,711            5.3            8
threat          2,552            2.4            3
expansion       2,412            2.2            4
records         1,080            1.0            2
```

### Problem A — the dead space is caused by grid stretch

The view grids compute `align-items: normal`, which for CSS grid resolves to **stretch**. A short card in the same row as a tall one is inflated to match it. Measured waste:

| card | card height | actual content | wasted | empty |
| :-- | --: | --: | --: | --: |
| `CAPABILITY MATRIX` | 1,641 | 419 | **1,222px** | **75%** |
| `WARTIME LOGISTICS` | 620 | 267 | 353px | 57% |
| `TECHNOLOGY WATCH` | 524 | 250 | 274px | 52% |

This is the "awkward spaces that need filling". They are not missing content — they are a layout artefact. `CAPABILITY MATRIX` is three-quarters empty purely because `ALIEN FORCE POSTURE` sits beside it at 1,595px of real content.

### Problem B — the scrolling is a column-width problem

`COMMAND` runs 5.3 screens because its three largest cards span the full 1,608px and stack vertically:

```
DIRECTIVE ENGINE              1,857px tall
EXECUTIVE BRIEF & DIRECTIVES  1,007px tall
OPERATIONS BOARD                515px tall
```

On a 1920-wide screen these are single tall columns. The horizontal space is there and unused — which is exactly why the user reports this as a desktop problem and *not* a mobile one. On mobile a tall single column is correct; on desktop it is wasted width converted into scroll distance.

### Problem C — the grids disagree

`COMMAND` computes `620.594px 965.406px`; every other view computes `793px 793px`. Two different column systems, neither derived from a shared token.

### Problem D — the views are unbalanced

`COMMAND` carries 8 cards and 5.3 screens; `RECORDS` carries 2 and exactly 1.0. The grouping was chosen for meaning, which was right, but nothing rebalanced afterwards.

## 2.2 Fixes

1. **`align-items: start` on the view grids.** Single highest-value change — it eliminates all three dead spaces above at once. Cards that genuinely want equal height opt in explicitly rather than every card being stretched by default.
2. **Let wide cards use their width.** `DIRECTIVE ENGINE`, `EXECUTIVE BRIEF` and `OPERATIONS BOARD` should lay their contents out in 2–3 internal columns at ≥1400px rather than one 1,608px-wide column. This is where most of `COMMAND`'s 5.3 screens goes.
3. **One column system.** A single grid token set, with a third column unlocked above ~1600px so short cards tile instead of stretching. Keep the existing single-column collapse for mobile untouched — mobile is not the problem.
4. **Cap runaway cards.** `DIRECTIVE ENGINE` at 1,857px should scroll internally or paginate. A card taller than the viewport defeats the point of having views.
5. **Rebalance after the above.** Re-measure first — fixes 1–4 change the numbers, and moving cards between views before re-measuring would be guesswork. `RECORDS` at 1.0 screens has room; `COMMAND` will still be the heaviest view and that is fine, but 5.3 screens is not.

## 2.3 Where the commentary goes

Head of `COMMAND`, directly beneath the Hold Ground directive — it is the same kind of content (a stated strategic read) at a lower altitude, and the two must not contradict each other. If Hold Ground says "do not fight" the commentary cannot open with "press the advantage".

Add it as a registered panel in the `VIEWS` registry so `assertViewRegistryIntegrity()` covers it. That guard exists because a panel was once mounted with no container and silently rendered nowhere for weeks — do not add a panel outside it.

## 2.4 Acceptance

- No card is more than ~25% empty by content height at 1920 wide.
- `COMMAND` under 3 screens of scroll at 1920×1080.
- All four views use one column system; column count derives from width, not from the view.
- Mobile (375px) layout unchanged — verify explicitly, do not assume.
- No horizontal page scroll at 375 / 900 / 1366 / 1920.
- `assertViewRegistryIntegrity()` passes with the commentary panel registered.
- The four-view navigation, hash routing, and zero-refetch switching all still hold — re-run `tests/v2Navigation.test.js` and `scripts/verify_v2_navigation.js`.

---

## Sequencing

Part 2 fixes 1–3 first: they are cheap, mechanical, and they change the measurements everything else depends on. Then Part 1 layers 1–3 (facts → beats → simulation) which is where the value is. Grammar and rebalancing last, since both are tuning against whatever the earlier steps produce.
