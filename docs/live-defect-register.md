# Live defect register — found by the contract analysis, 2026-08-24

Written against `main` @ `6368c88`. These are **shipped defects in the current
dashboard**, found while writing the React component contracts. None is caused by
the migration and none is currently anyone's lane.

They are here rather than in the contracts doc because they need a priority
decision, and because **a faithful React port would carry every one of them
across.** That is the migration-relevant part: a rewrite that reproduces the
current output exactly reproduces these too.

Confidence is stated per defect. "Confirmed" means read in source by Claude at
the cited lines. "Demonstrated" means executed. "Confirmed reachable" means the
producer's own contract permits the input, but it does not occur on the current
save.

**Tally: six confirmed, one demoted to latent, one lead.** #7
(`alien-hate-economics` `renderHud`) remains unchecked. #3 was **demoted** after
its supporting claim turned out to be false — see the correction there. One
further candidate was investigated and **cleared** — see the end of #8.

**Live on the dashboard right now: #1, #2 and #5.** Those three are the ones
worth fixing ahead of their migration phase. #4, #6 and #8 are real but need a
specific input or width; #3 is latent.

---

## 1. `directive-board` invents four budget ceilings — **confirmed**

`public/v2/js/components/directive-board.js:222-237`

```js
const hateCeil  = num(hate.cap ?? hate.ceiling) ?? 5.0;
const infStock  = num(inf.cap  ?? inf.stock)    ?? 100;
const opsStock  = num(ops.cap  ?? ops.stock)    ?? 50;
const mcCap     = num(mc.cap   ?? mc.capacity)  ?? 100;
```

`num()` correctly returns null for an unmeasured value; `?? <literal>` then
replaces it with an invented one. With no budget data the panel renders four
filled meters reading **`0.0 / 5.0`, `0 / 100`, `0 / 50`, `0 / 100`** — numbers
that appear measured and are not.

This is worse than a coerced zero, because the **denominator** is fabricated: the
percentage bar is computed against an invented ceiling, so the bar length is
fiction too.

**There is a guard, and the caller defeats it.** Line 216 is `if (!budgets)
return ''`, but line 660 calls it with `cyclePlan.budgets || {}` — always truthy.
The guard cannot fire.

Two hundred lines away, `renderBenchBudget` refuses to claim anything unmeasured.
The correct treatment already exists in the same file.

No test catches it. The bench-budget test deletes `plan.budgets` but only asserts
the *other* block is absent.

---

## 2. `world-map` prints a confident total beside its own em dash — **confirmed**

`public/v2/js/components/world-map.js:496-500`

```js
totalHostile += view.record ? (readCount(view.record, [...]) || 0) : 0;
```

The per-theater line at `:429` uses `countLabel()`, which correctly renders `—`
for an unmeasured count. The summary line four hundred lines later sums the same
values through `|| 0`.

So the panel shows a theater as `H — / OWN —` and, one row below, a total of
`CURRENT / HOSTILE 3 · OWN 1` derived from those same unread values. The right
answer and the wrong answer are on screen together.

`:395` and `:399` coerce the same way into `statusLabel` / `statusKey`.

---

## 3. `mc-budget` coerces an unmeasured multiplier to zero — **latent, NOT live** (corrected)

> **Corrected 2026-08-24, same day.** This entry originally claimed the panel
> renders `PROJECTED FLOOR 0.0` today, on the grounds that "both committed
> fixtures omit `difficultyMultiplier` entirely". **That is false.** Measured
> directly:
>
> ```
> difficultyMultiplier  = 0.3
> concealmentMultiplier = 0.6400000000000001
> usedMissionControl    = 162
> ```
>
> Both fixtures carry the field. The lane's `0.0` came from a **crafted**
> payload, which proves the coercion is reachable — not that it occurs.
> Antigravity's characterisation test independently asserts
> `PROJECTED FLOOR 31.1` from the real fixture, and is right.
>
> **The code defect is still real** — `|| 0` on a `num()` that deliberately
> returns null is the wrong idiom and will produce a confident zero the moment
> the field is absent. But it is latent, not shipping, and it does **not** belong
> in the "visible on the live dashboard now" group. Demoted accordingly.
>
> Recording this because I published the fixture claim as fact without opening
> the fixture, which is the same failure as building the pin column from
> filenames.

### Original entry, retained

`public/v2/js/components/mc-budget.js:61-62`

```js
(num(difficultyMultiplier) || 0) * (num(concealmentMultiplier) || 1)
```

Executed through the repo's own `tests/fixtures/renderHarness.js` with
`usedMissionControl: 152` measured and `difficultyMultiplier` absent: the panel
renders **`PROJECTED FLOOR 0.0`**.

Two things make this one hard to catch and worth fixing carefully:

- **The existing test misses it by construction.** It nulls *every* metric at
  once, so `used === null` short-circuits to UNAVAILABLE for an unrelated reason.
  The single-null case is untested.
- **Both committed fixtures omit `difficultyMultiplier` entirely**, so no
  fixture-based test can currently exercise the measured path either.

---

## 4. `fleet-procurement` fabricates an armour score — **confirmed**

`public/v2/js/components/fleet-procurement.js:47-49`

```js
const entry = ARMOR_DATA[armorId];
if (!entry) return 1.0;
```

Any armour type absent from the hardcoded table scores a made-up `1.0`, which
then drives a **visible "N× behind" ratio**. An unknown input produces a
confident comparative claim.

`ARMOR_DATA` is a hardcoded table in a component, so it goes stale whenever the
game adds an armour type — which makes the fallback path reachable by ordinary
game updates, not just by bad data.

---

## 5. `research-advisor` drops half its groups silently — **confirmed**

`public/v2/js/components/research-advisor.js:43` and `:460`

```js
const GROUPS_SHOWN = 2;
return populated.slice(0, GROUPS_SHOWN).map(...)
```

Two of four availability groups are cut with **no omission note anywhere**.
`populated.length` is used only for the zero-check at `:459`; it is never
compared against `GROUPS_SHOWN` to produce a count. Group 3 measured **7 ranked
rows missing on the live save**.

This breaks a standing rule of this repo: a capped list must carry its total and
omitted counts to the consumer. The component already knows both numbers.

---

## 6. `drive-explorer`'s scroll hint dies after the first interaction — **confirmed in browser**

`public/v2/js/components/drive-explorer.js` `paint()` replaces the whole panel
with `container.innerHTML = …` and then calls only `bindControls(container)`.
`syncScrollHints` is **never called from this file**; it lives in
`mission-control.js` and fires on load, two fetch paths, resize, and overlay open.

Reproduced 2026-08-24 by loading DRIVES and changing the sort `<select>`, which
is a client-side re-render with no fetch:

| viewport | on load | after client-side sort | still overflowing by |
| --- | --- | --- | ---: |
| 900px | `de-scroll-hint is-scrollable` | `de-scroll-hint` | **153px** |
| 700px | `de-scroll-hint is-scrollable` | `de-scroll-hint` | **353px** |

The hint element survives; only the measured `is-scrollable` class is lost. The
table demonstrably still scrolls — `scrollWidth` 989 against `clientWidth` 836
and 636 — and the only affordance telling the reader so is gone until a resize.

At 1280px the check is inconclusive and correctly so: the table does not overflow
there, so the hint is absent either way. **A verification run at desktop width
alone would have reported this as fine.**

This is the exact property `tests/missionControlLayout.test.js` protects — that
scroll hints are driven by measured overflow, never by viewport width. The rule
holds; nothing re-runs the measurement after this component repaints.

---

## 7. `alien-hate-economics` may show an unknown hate as a green estimate — **reported, unverified**

`renderHud` is reported to render an unmeasured hate as a green `GAME ESTIMATE`
because `visibleEstimate: 'UNKNOWN'` is truthy and is compared only against
`'UNAVAILABLE'`. A sibling function at `:227` **does** handle both
(`if (!text || text === 'UNAVAILABLE' || text === 'UNKNOWN') return null`), which
makes the inconsistency plausible — but the specific path was not confirmed.

Related and separately worth fixing: `renderHud` mounts `#hudHateMeter`, which is
**not in the `VIEWS` registry**, so `assertViewRegistryIntegrity()` does not cover
it. That assertion exists precisely to catch a panel rendering nowhere.

---

## 8. `mining-expansion` prints the literal string `null` — **confirmed reachable**

`public/v2/js/components/mining-expansion.js:509` interpolates `${s.name}` for
each bonus source. The surrounding guard checks `sources.length`, which catches an
empty array but not a null `name` inside a present entry.

Traced to the producer, `shared/spaceMiningBonus.mjs:248`:

```js
name: org?.displayName ?? null,
```

The field is **explicitly nullable**. So an org that carries a mining bonus, is
active (`applyingBonuses === true`), and has no `displayName` reaches the
consumer as `{ name: null, value: 0.05 }` and renders as **`null +5%`**.

The producer demonstrates that it knows names can be absent — its own error path
at `:243` writes `'(unnamed)'` as a fallback. Only the success path ships the raw
null. This is the recorded rule that an unresolvable identity must never become a
string, broken across a module boundary: careful on one side, unguarded on the
other.

Reachable by type, not observed on the current save — no org on it is both
bonus-carrying and unnamed. Fix the consumer regardless; the producer's contract
permits it.

**Not a defect, checked and cleared:** the neighbouring
`Math.round(num(s.value) * 100)` cannot coerce a null to `+0%`. Line 240 does
`if (value === null || value === 0) continue;` and the effect branch requires
`typeof value === 'number'`, so `s.value` is always a non-zero number by the time
the consumer sees it.

---

## What these have in common

Six of the eight are the same defect: **an unmeasured value given a confident
default at the render boundary.** Not in the engine, not in the save parser —
those layers are careful. It happens in the last few lines before the DOM, where
`?? 0`, `|| 0` and `?? 5.0` look like defensive programming.

The two `?? <literal>` cases (#1, #4) are the worst of them, because a fabricated
*ceiling* or *baseline* produces a derived ratio that is wrong in a way no reader
can detect.

`<Value>` in Track E exists to make this class structurally impossible, which is
the argument for fixing these **as part of** the component migrations rather than
before: a port that keeps `?? 5.0` has not migrated the panel, it has laundered
the defect through a new component. But #1, #3 and #5 are visible on the live
dashboard now and do not need to wait for their phase.
