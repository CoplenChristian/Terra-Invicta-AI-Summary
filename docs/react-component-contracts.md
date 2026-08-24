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

### Class R — render-only (9)

Fed from the snapshot or briefing by `mission-control.js`. Pure functions of their payload.

`council-orders` · `strategic-commentary` · `mc-budget` · `directive-board` ·
`alien-hate-economics` · `executive-boards` · `world-map` · `detail-panel` ·
`intelligence-library`

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

| # | component | lines | class | global | pinned by |
| ---: | --- | ---: | :-: | --- | --- |
| 2 | `unlocked-tech` | 371 | F | `MissionControlUnlockedTech` | `unlockedTechPanel.test.js` |
| 3 | `mc-budget` | 187 | R | `MissionControlMcBudget` | **none by name** |
| 4 | `strategic-commentary` | 202 | R | `MissionControlStrategicCommentary` | `strategicCommentary.test.js` |
| 5 | `fleet-engagement` | 260 | F | `MissionControlFleetEngagement` | `fleetEngagement.test.js` |
| 6 | `mining-expansion` | 618 | F | `MissionControlMiningExpansion` | `miningExpansion.test.js`, `miningExpansionNullDiscipline.test.js`, `verify_mining_registers.js` |
| 7 | `alien-hate-economics` | 323 | R | `MissionControlHateEconomics` | `alienHateEconomics.test.js` |
| 8 | `council-orders` | 348 | R | `MissionControlCouncilOrders` | **none by name** |
| 9 | `executive-boards` | 415 | R | *(no single global)* | **none by name** |
| 10 | `fleet-procurement` | 607 | F | `MissionControlFleetProcurement` | `verify_research_vs_procurement.js` |
| 11 | `research-advisor` | 1055 | F | `MissionControlResearchAdvisor` | 4 verify scripts, **no unit test** |
| 12 | `intelligence-library` | 582 | R | `IntelligenceLibrary` | **none by name** |
| 13 | `faction-intel` | 1261 | F | `FactionIntelScreen` | **none by name** |
| 14 | `detail-panel` | 219 | R | `MissionControlDetailPanel` | `verify_drive_path_modal.js` |
| 15 | `directive-board` | 768 | R | `MissionControlDirectiveBoard` | `directiveBoardBench.test.js` |
| 16 | `drive-explorer` | 1186 | F | `MissionControlDriveExplorer` | `driveExplorer.test.js`, `verify_drive_explorer.js`, `verify_v2_navigation.js` |
| 17 | `world-map` | 511 | R | `WorldTheaterMap` | **none by name** |

### Six components have no unit test naming them

`mc-budget`, `council-orders`, `executive-boards`, `intelligence-library`, `faction-intel`,
`world-map` — **3,004 source lines with no named unit coverage.** Two are the largest
overlays in the product.

This is the single biggest risk in the migration and it is not a React problem. A rewrite
of `faction-intel` (1,261 lines) currently has nothing that would fail if it silently
dropped a field.

**Each of those phases must add characterisation coverage BEFORE migrating** — capture what
the component renders today from a fixture, assert it, then migrate and assert the same.
Otherwise the phase cannot tell a successful migration from a lossy one.

### `executive-boards` has no single global

Every other component exposes one `window.*` object. This one does not — it registers
several render functions. Whatever it does instead should be established before migrating,
since the strangler mount assumes one entry point per panel.

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
