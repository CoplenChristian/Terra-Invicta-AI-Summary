# Live defect register — found by the contract analysis, 2026-08-24

Written against `main` @ `6368c88`. These are **shipped defects in the current
dashboard**, found while writing the React component contracts. None is caused by
the migration and none is currently anyone's lane.

They are here rather than in the contracts doc because they need a priority
decision, and because **a faithful React port would carry every one of them
across.** That is the migration-relevant part: a rewrite that reproduces the
current output exactly reproduces these too.

Confidence is stated per defect. "Confirmed" means read in source by Claude at
the cited lines. "Demonstrated" means executed. "Reported" means a lane found it
and it has not been independently checked — treat those two as leads, not facts.

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

## 3. `mc-budget` renders `PROJECTED FLOOR 0.0` for an unmeasured multiplier — **demonstrated**

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

## 6. `drive-explorer`'s scroll hint dies after the first interaction — **structurally confirmed, browser-unverified**

`public/v2/js/components/drive-explorer.js` `paint()` replaces the whole panel
with `container.innerHTML = …` and then calls only `bindControls(container)`.
`syncScrollHints` is **never called from this file**; it lives in
`mission-control.js` and fires on load, two fetch paths, resize, and overlay open.

So a client-side-only interaction rebuilds the table and leaves the hint
unmeasured until something else triggers a resync. Needs a browser to confirm,
and it should be confirmed before it is fixed.

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

## 8. `mining-expansion` may print the literal string `null` — **reported, unverified**

`public/v2/js/components/mining-expansion.js:509` interpolates `${s.name}` for
each bonus source. The surrounding guard checks `sources.length`, which catches an
empty array but not a null `name` inside a present entry. Consistent with this
repo's recorded rule that an unresolvable identity must never become a string,
but not demonstrated.

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
