# Component data contracts — Track C

Written 2026-08-24 against `main` @ `32f8366`. Track C of
`docs/react-migration-parallel-plan.md`.

What each of the 16 v2 components reads, renders and is pinned by — the analysis every
component phase would otherwise repeat. Needs no React and no build.

**A contract is only true on the day it is written.** Re-check before migrating a
component; cheap to do, expensive to trust blindly.

---

## The finding that shapes the whole migration

**Only 7 of 16 components fetch their own data. The other 9 are fed by the controller.**

And the fed ones already have a props contract:

```js
function render(root, payload)        // mc-budget, alien-hate-economics
function render(container, snapshot)  // executive-boards
```

`render(root, payload)` **is** `<Component {...payload} />` with `root` replaced by a
mount point. For nine components the React migration is a rendering change and nothing
else — no data-fetching decision, no state ownership question, no cache.

That splits the work into two genuinely different jobs, and the easy one is the majority.

> **Corrected 2026-08-24 after five lanes read every component.** The paragraph
> above was the doc's headline and it is **wrong for four components**. Three do
> not take `render(root, payload)` at all:
>
> - **`strategic-commentary`** is `renderStrategicCommentary(data, containerId =
>   'strategicCommentary')` — it takes a container **id string**, not a root, and
>   writes to `#commentaryModeBadge`, which sits **outside its own mount**
>   (`index.html:360` vs `:363`).
> - **`detail-panel`** exports `{open, close, syncPageInert}` and has **no
>   `render`** — an imperative body-appended singleton modal with 8 call sites
>   across 5 files, plus global `inert` state shared with two other overlays.
> - **`alien-hate-economics`** exposes `{render, renderHud}`, and `renderHud`
>   mutates `#hudHateMeter` — an element **not in the `VIEWS` registry**, so
>   `assertViewRegistryIntegrity()` does not cover it.
> - **`world-map`** self-fetches `/v2/data/world.geojson` through a module-global
>   promise cache (`world-map.js:9,272-281,506`), so it is not cleanly class R.
>
> `faction-intel` moves the other way: **0 `fetch(` calls in the file** — it is
> class R, not F. The class split below is corrected; the original claim that
> "`render(root, payload)` **is** `<Component {...payload} />`" holds for the
> majority but is not the universal it was written as.

### Class R — render-only (8)

Fed from the snapshot or briefing by `mission-control.js`.

`council-orders` · `mc-budget` · `directive-board` · `executive-boards` ·
`intelligence-library` · `faction-intel` · `alien-hate-economics`\* ·
`strategic-commentary`\*

\* both have a second entry point or a non-standard signature — see the
correction above.

### Neither — imperative (1)

`detail-panel`. Opened and closed by callers; owns no payload.

### Class F — self-fetching (7)

Own an endpoint call and its loading/error states. Each needs a decision the R class does
not: does the component keep fetching, does the controller fetch for it, or does a data
layer (React Query or similar) take over? **Answer this once in Phase 1, not seven times.**

| component | endpoint(s) |
| --- | --- |
| `drive-explorer` | `/api/intel/drive-explorer`, `/api/intel/tech-path` |
| `fleet-engagement` | `/api/intel/fleet-engagement` |
| `fleet-procurement` | `/api/intel/refit-advisor`, `/api/intel/research-ranking` |
| `mining-expansion` | `/api/intel/mining-expansion` |
| `research-advisor` | `/api/intel/research-ranking` |
| `unlocked-tech` | `/api/intel/tech-search`, `/api/intel/tech-tree` |
| `faction-intel` | (overlay; fed on open) |

Note `fleet-procurement` and `research-advisor` **share** `/api/intel/research-ranking`.
Two components fetching one endpoint is a caching decision, and today it is two requests.

---

## Per-component

Size is source lines. **Pinned by** is what will fail if the migration changes behaviour —
this is the safety net, and where it says *none by name* the phase must add coverage
before migrating, not after.

**The `pinned by` column below was rewritten on 2026-08-24.** The original was
assembled from test *filenames*, and filenames lied — six of sixteen rows were
wrong, in the one column that is the entire safety net. Each entry now names what
was actually verified to load the component.

| # | component | lines | class | global | pinned by |
| ---: | --- | ---: | :-: | --- | --- |
| 2 | `unlocked-tech` | 371 | F | `MissionControlUnlockedTech` | `unlockedTechPanel.test.js` |
| 3 | `mc-budget` | 187 | R | `MissionControlMcBudget` | **none** |
| 4 | `strategic-commentary` | 202 | R\* | `MissionControlStrategicCommentary` | `strategicCommentary.test.js` |
| 5 | `fleet-engagement` | 260 | F | `MissionControlFleetEngagement` | `fleetEngagement.test.js` — but **its registers are asserted nowhere**, see below |
| 6 | `mining-expansion` | 618 | F | `MissionControlMiningExpansion` | `miningExpansion.test.js`, `miningExpansionNullDiscipline.test.js`, `mineModuleOutput.test.js:537`, `miningBoardRendering.test.js:36`, `verify_mining_registers.js` |
| 7 | `alien-hate-economics` | 323 | R\* | `MissionControlHateEconomics` | **none** — `alienHateEconomics.test.js:4` imports `server/alienHateEconomics`, not the component |
| 8 | `council-orders` | 348 | R | `MissionControlCouncilOrders` | **none** |
| 9 | `executive-boards` | 415 | R | `MissionControlBoards` (7 functions) | **none** |
| 10 | `fleet-procurement` | 607 | F | `MissionControlFleetProcurement` | `refitAdvisor.test.js:321,755,820,944`, `verify_research_vs_procurement.js` |
| 11 | `research-advisor` | 1055 | F | `MissionControlResearchAdvisor` | `refitAdvisor.test.js:1006` (`slotFacts` / `openFullRanking` only — **nothing covers `render`**), 3 verify scripts |
| 12 | `intelligence-library` | 582 | R | `IntelligenceLibrary` | **none** |
| 13 | `faction-intel` | 1261 | **R** | `FactionIntelScreen` | **none** |
| 14 | `detail-panel` | 219 | — | `MissionControlDetailPanel` | `verify_drive_path_modal.js` |
| 15 | `directive-board` | 768 | R | `MissionControlDirectiveBoard` | `directiveBoardBench.test.js` |
| 16 | `drive-explorer` | 1186 | F | `MissionControlDriveExplorer` | `driveExplorer.test.js`, `verify_drive_explorer.js`, `verify_v2_navigation.js`, `verify_drive_path_modal.js` |
| 17 | `world-map` | 511 | R\* | `WorldTheaterMap` | **none** |

### Seven components have no test naming them — not six

`mc-budget`, `alien-hate-economics`, `council-orders`, `executive-boards`,
`intelligence-library`, `faction-intel`, `world-map` — **3,627 source lines**.

`alien-hate-economics` was the correction: it *looks* covered, because
`tests/alienHateEconomics.test.js` exists and shares its name. That file imports
`server/alienHateEconomics` and never loads the component. It is the
"guard that outlives its target" pattern, and it was propagated into the wave
plan before anyone opened the file.

**Each of those phases must add characterisation coverage BEFORE migrating** —
capture what the component renders today from a fixture, assert it, then migrate
and assert the same. Otherwise the phase cannot tell a successful migration from
a lossy one.

### One measured/estimated register pair has no guard at all

`.fe-meas` / `.fe-est` on `fleet-engagement` are asserted in **no test and no
verify script**. `verify_drive_explorer.js` asserts `.de-*` only
(`:63-64, :122-137`); `verify_mining_registers.js` covers mining. The
two-register split is described everywhere as pinned by computed style, and for
one of its three instances that was never true.

### `executive-boards` and the seven legacy charts underneath it

It exposes `window.MissionControlBoards` with **seven** render functions
(`executive-boards.js:406-414`) targeting seven differently-named legacy
containers across four views.

The migration hazard is in the controller, not the component:
`mission-control.js:1569, 1640, 1667, 1694, 1738, 1775, 1839` each read
`if (window.MissionControlBoards?.renderX) { …; return; }`, and the **complete
pre-component chart implementation is the else-path**. A React version that stops
setting that global does not fail — the controller silently renders the 2024
chart and **re-overwrites the React root on every `renderDashboard()`**. CI
cannot see it.

### Primitives the five do not cover

Named by four of the five lanes independently, so this is not one component's
special pleading:

**`Modal`** (`detail-panel`, `drive-explorer`), **`Overlay`** chrome shared by
`detail-panel` / `faction-intel` / `intelligence-library`, **`Meter`/`Gauge`**
(`directive-board` needs two bar systems), **`Chip`**, **`Badge`**, **`Notice`**,
**`FilterBar`** (`drive-explorer`), **`Tabs`**, and a **`VisibilityTag`** for
`faction-intel`'s eleven-state visibility vocabulary.

Also: `strategic-commentary` uses `.commentary-sim-table`, a **sixth** table
system absent from Track E's `TABLE_VARIANTS` — and `DataTable.jsx:15` *throws*
on an unknown variant.

---

## What every contract must carry, and what to check per component

The table above is structure. Before migrating any component, establish and write down:

1. **The payload shape.** For class R, what the controller passes. For class F, the
   endpoint response fields actually consumed — not the whole payload.
2. **Player-mode difference.** Not "is it filtered" but *is it a different answer*. Several
   panels genuinely differ: the cycle plan is 19.30 in player against 66.13 in omniscient;
   rival control-point caps refuse entirely in player. A panel verified in one mode is not
   verified.
3. **Unavailable and empty states.** This repo's most repeated defect is `Number(null) === 0`.
   Every state that currently renders UNAVAILABLE, UNKNOWN or an em dash must be enumerated,
   because a React rewrite is exactly where one silently becomes `0`.
4. **Measured vs estimated registers**, where present. `mining-expansion`,
   `fleet-engagement` and `drive-explorer` all carry the two-register split and it is
   asserted by computed style in the verify scripts. It is an honesty device, not styling.
5. **Truncation.** Which lists cap, and which `*TotalCount` / `*OmittedCount` fields must
   survive.
6. **Which shared primitive it needs** — `Panel`, `DataTable`, `Measured`/`Estimated`,
   `Value`, `TruncationNote`. If it needs one that does not exist, **stop and say so**;
   extending the primitive set serialises against every other in-flight component.

---

## Ordering implications

The spec's order was set on risk before this analysis. It mostly holds, with two
adjustments worth considering:

- **Class R components are strictly easier** than class F and there are nine of them.
  Front-loading more of them would get the primitives exercised faster and defer the
  data-layer decision.
- **`executive-boards` (#9) is the highest-leverage class R panel** — `.mc-board-table` is
  the most-shared table in the product and four views depend on it. Migrating it early
  proves `<DataTable>` against the real workload rather than against `unlocked-tech`'s
  single simple table. It has no unit test, so it needs characterisation coverage first.

`drive-explorer` stays last regardless. It is the reference implementation for tables,
registers and filters, and has the most to lose.
