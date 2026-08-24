# Migrating the v2 dashboard to React + MUI

Written 2026-08-24 against `main` @ `b84a6b8`.

A phased migration, one component per check-in. The dashboard keeps working at every
step — there is no cutover day.

---

## Why, honestly

**Not because the current architecture caused the layout bugs.** It didn't. The 1400px
inversion was a wrong `auto-fill`, the header collision was a grid declared 124px below its
own minimum, the invisible card edges were a missing declaration. `<Grid container>` would
have reproduced every one.

The real argument is the one the owner made: **stop rebuilding primitives.** The weekend's
work hand-built a type scale, hand-migrated 310 font-size literals, hand-wrote a spacing
token set, and hand-maintained table, register and card patterns across 16 components and
24 stylesheets. A theme system and a component library give that for free, and give it
*consistently* — which is exactly where this codebase keeps drifting.

**What it costs, stated plainly:**

| today | after |
| --- | --- |
| 4 runtime dependencies | + React, React-DOM, MUI, Emotion |
| **no build step** | Vite, required |
| edit → hard-refresh | edit → build → refresh (HMR in dev) |
| browser-native ESM, no transpile | JSX |
| what the browser runs **is** what is in the repo | bundled output, source-mapped |

That last row is load-bearing and is discussed under *Verification* below. It is the single
biggest thing this migration changes about how the project is checked.

---

## Sequence: the open PR lands first

**Do not start this until [PR #6](https://github.com/CoplenChristian/Terra-Invicta-AI-Summary/pull/6) is merged or closed.** It rewrites every stylesheet,
collapses the type scale, and splits the CSS into 24 parts. Starting on `main` now means
migrating components whose styling is about to change underneath, and a merge nobody can
review.

The type-scale work is not wasted by this migration — **it is the input to it.** The four
`--fs-*` tokens and the `--space-*` set become the MUI theme. Doing it in the other order
would mean deriving a theme from 310 literals.

---

## The asset that makes this tractable

`public/v2/js/mission-control.js:169` already carries a **component manifest**:

```js
const VIEWS = [
  { id: 'command', sectionId: 'view-command',
    panels: ['strategicCommentary', 'councilOrders', 'researchAdvisor',
             'directiveBoard', 'sitrepSummary', ...] },
  ...
];
```

Every panel is a DOM id, and `assertViewRegistryIntegrity()` already fails at startup if a
registered panel has no mount element or is registered twice.

**That is a per-component mount table.** React can take one panel at a time —
`createRoot(document.getElementById(panelId))` — while every other panel stays vanilla.
This is the strangler pattern and it is why per-component check-ins are possible rather
than aspirational.

---

## Phase 0 — scaffold, and prove coexistence

Vite + React + MUI added; **nothing migrated**. One throwaway panel rendered by React
inside the existing page to prove the two can share a document.

Deliverables:

- Vite build producing into `public/v2/` (or a new served path — decide and justify)
- `npm run dev` with HMR; `npm start` still serves the built app
- **The existing 15 unmigrated panels render identically.** Capture computed style for all
  six views at 375/1440/1600/1920 in both modes before and after Phase 0, and diff.
- A documented answer to: what does `npm test` run now, and what does `build:site` do?

**Check-in gate:** the dashboard is visually byte-identical, the suite is green, and one
React panel is on screen.

---

## Phase 1 — the theme and the shared primitives

No feature panels yet. This phase decides the vocabulary every later phase consumes, so it
gets its own check-in and its own scrutiny.

### The theme is derived from the existing tokens, not invented

`--fs-row 12.5 / --fs-metric 11 / --fs-meta 10 / --fs-tag 9`, the three display tiers, the
`--space-*` set, and the full colour palette move into `createTheme`. **A test must assert
the theme's values equal the CSS custom properties**, so the two cannot drift while both
exist during migration.

### Shared components — this is what the owner asked for

At minimum:

- **`<Panel>`** — replaces `.tech-card`. Header, body, optional `--priority` / `--alert`
  accent. **Must carry a visible border on all four sides**; the vanilla one shipped for
  months with three edges drawn only by a 1.095:1 background contrast, and that is the
  defect this component exists to make unrepeatable.
- **`<DataTable>`** — the single most duplicated pattern. `.mc-board-table`, `.de-table`,
  `.fe-table`, `.mining-table`, `.intel-library-table` are five implementations of one
  idea. **`.de-table` on DRIVES is the reference**: sticky header, right-aligned tabular
  numerics, header never smaller than its data, measured `is-scrollable` hint. Everything
  else converges on it.
- **`<Measured>` / `<Estimated>`** — the two-register split is a load-bearing honesty
  device in this product, asserted by computed style in `scripts/verify_drive_explorer.js`
  and `verify_mining_registers.js`. It must be a component, not a convention.
- **`<Value>`** — renders a number, or an explicit unavailable state. **Never a coerced
  zero.** This repo's most repeated defect class is `Number(null) === 0`; a shared value
  renderer is the structural fix.
- **`<TruncationNote>`** — a capped list must state its total and omitted counts. Also a
  repeated defect, also fixable once.

**Check-in gate:** primitives exist with tests, theme matches the tokens, still zero panels
migrated.

---

## Phases 2..N — one component per check-in

Sixteen components. Each phase is: migrate one, verify, check in, stop.

**Every phase must satisfy the same bar** (see *Non-negotiables*), and each ends with a
before/after screenshot pair at 1440 and 375 in both modes.

Proposed order — earliest are lowest-risk and teach the most about the primitives:

| # | component | why here |
| --- | --- | --- |
| 2 | `unlocked-tech` | self-contained RECORDS panel, one table + a search box. First real exercise of `<DataTable>` and `<Panel>`. |
| 3 | `mc-budget` | small, interactive (a stepper with `<output>`). Proves controls and state. |
| 4 | `strategic-commentary` | prose + tiers, no table. Proves typography against the theme. |
| 5 | `fleet-engagement` | first measured/estimated registers with real stakes. |
| 6 | `mining-expansion` | registers again, plus the upgrade board. |
| 7 | `alien-hate-economics` | dense metric strips; THREAT's layout language. |
| 8 | `council-orders` | the four-column row whose alignment was a review finding. |
| 9 | `executive-boards` | `.mc-board-table` — the most-shared table, four views depend on it. |
| 10 | `fleet-procurement` | refit advisor, several states. |
| 11 | `research-advisor` | large, and its own layout spec exists. |
| 12 | `intelligence-library` | overlay, sections, its own nav. |
| 13 | `faction-intel` | second overlay; note the `.faction-intel-*` prefix names two surfaces and this is the moment to split them. |
| 14 | `detail-panel` | shared modal — used by the drive path modal. |
| 15 | `directive-board` | largest CSS surface (1,398 lines); grouped bench, budgets, reasons. |
| 16 | `drive-explorer` | 541 rows, filters, sort, modal. **Last, deliberately** — it is the reference implementation and the most to lose. |
| 17 | `world-map` | SVG, its own two-step type ladder. Standalone; can move any time. |

**Re-order on evidence if the early phases teach something.** The order is a proposal, not
a contract.

---

## Non-negotiables, every phase

- **No figure may change.** Capture the panel's rendered text in both modes before and
  after and diff, whitespace-ignored. This migration changes how things are drawn, never
  what they say.
- **Both modes.** Player redacts; several panels are genuinely different, not merely
  filtered. A panel verified only in omniscient is not verified.
- **Absent stays null.** Every migrated panel keeps its unavailable states. `<Value>`
  exists to make this structural, but the assertions must survive per panel.
- **Mobile: 0 unreachable elements** at 375/414/768 in both modes —
  `scripts/verify_mobile_overflow.js`, numbers reported each phase.
- **COMMAND under 3.25 screens at 1920**, both guards. Note they measure different elements
  and disagree by ~0.12; see the note in `verify_mobile_overflow.js`.
- **Every new test broken deliberately first.**
- Full suite green with exact counts, and the delta explained.

---

## Verification — what this migration breaks

This is the part to think hardest about. The current verification story leans on properties
a bundler removes.

1. **Six test files read CSS files by path**, via `tests/fixtures/missionControlCss.js`,
   which enumerates `public/v2/css/` from the shell's `<link>` order. Under CSS-in-JS or
   CSS modules those files stop existing in that form. **Decide early**: keep the 24
   stylesheets as-is and use MUI only for components, or move styling into the theme and
   rewrite those guards. The scroll-hint registration check is the one with teeth — it
   derives styled hint classes from the stylesheet and asserts each is registered.
2. **`tests/fixtures/renderHarness.js` executes the shipped `public/v2/js/shared.js`** so
   the test sandbox cannot drift from production. `shared.js` is an IIFE exposing
   `window.MissionControlShared` — not ESM. That pattern does not survive. React Testing
   Library is the obvious replacement; say so and show a migrated example.
3. **"What the browser runs is what is in the repo."** Byte-identity proofs — the kind used
   to prove the stylesheet split changed nothing — stop being available. Computed-style and
   pixel diffing still work and should become the primary evidence. **State this trade
   explicitly in `CLAUDE.md`**; it changes the refactor discipline the whole project runs on.
4. **The four `verify_*.js` scripts drive the real page** and are unaffected — they read
   the DOM, not the source. They become *more* important, not less.

---

## What does not change

The backend, the API, the markdown exports, the intel registry, the directive engine, the
save parser, the publish path. **This is a rendering change only.** If a phase finds itself
editing `server/` or `shared/`, something has gone wrong — stop and say so.

---

## Open questions to answer in Phase 0

- **Does the hosted worker serve a bundle now?** `scripts/build_static_snapshot.js` flattens
  the worker for static hosting. Its relationship to a Vite build must be settled before
  Phase 2, not discovered at Phase 12.
- **Do the 24 stylesheets stay?** A hybrid — MUI components, existing CSS — is legitimate
  and lower-risk, but it means two styling systems for the duration. Decide deliberately.
- **MUI v6 or v7?** And Emotion or the newer styling engine. Pin it and record why.
- **Bundle size budget.** The project's value includes being cheap to serve. Set a number
  in Phase 0 and check it each phase, the way the screen-height budget is checked.
