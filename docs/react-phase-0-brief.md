# React migration — Phase 0: scaffold and prove coexistence

Written 2026-08-24 against `main` @ `f248bda`. Implements Phase 0 of
`docs/react-migration-spec.md`. Read that spec first; it carries the reasoning this brief
assumes.

**Nothing is migrated in this phase.** The deliverable is a build system, a coexistence
proof, and three decisions written down. If a real panel gets rewritten here, the phase has
failed.

Baseline: **1397 tests / 1395 pass / 0 fail / 2 conditional skips**.

---

## Correcting the spec before you start

The spec says the frontend is "browser-native ESM". **It is not.** Measured on `f248bda`:

- `public/v2/index.html` contains **zero** `type="module"` attributes. Every script is a
  classic `<script src>` tag, loaded in order, lines 628–645.
- Components are IIFEs that hang themselves on `window`:
  `global.MissionControlUnlockedTech = { load };`
- `shared.js` is the same shape — `window.MissionControlShared`.
- `docs/code-index.md` labels them "Browser (ESM)" because the generator's `isEsm` heuristic
  matches `import`/`export` keywords in source; that classification is wrong for these files
  and worth correcting while you are here.

**This makes coexistence easier, not harder.** There is no module graph to interoperate
with — just ordered scripts writing globals. A Vite bundle can be one more `<script>` tag
that mounts into an existing DOM node, and the vanilla components neither know nor care.

---

## What to build

### 1. Vite + React + MUI

Pin the versions and record why in the commit. MUI v6 or v7 and the styling engine choice
are open questions in the spec — **answer them here**, do not defer.

The build must produce assets that `express.static` already serves. `server/index.js:70`
serves `public/`, and `server/http/routes/shell.js` serves the shell with an injectable
`publicDir`. Decide where the bundle lands and make sure both the local server and
`scripts/build_static_snapshot.js` (which flattens for hosted static serving) can find it.

### 2. Scripts

- `npm run dev` — Vite dev server with HMR, proxying API calls to the Express server so the
  dashboard has real data while developing.
- `npm start` — unchanged for the user: serves the built app on the Express server.
- `npm test` — must still be `scripts/run_unit_tests.js` and must still pass.
- `npm run build` — produces the bundle. Decide its relationship to `build:site`.

### 3. The coexistence proof

Mount **one throwaway React component** into the live page — not a real panel. A box that
renders "React is here" and reads one value from the existing global state is enough.

Mount it via the pattern the whole migration will use:
`createRoot(document.getElementById('<some panel id>'))`, using the `VIEWS` registry at
`public/v2/js/mission-control.js:169` as the mount table.

**Then remove it before committing, or keep it behind a flag.** The proof is that it worked
and the rest of the page did not notice; the artefact is the build plumbing, not the box.

---

## The acceptance test that matters

**The fifteen unmigrated panels must render identically.**

Capture computed style for every element across all six views at **375 / 1440 / 1600 /
1920** in both player and omniscient, before and after Phase 0, and diff. The harness from
the stylesheet split does exactly this — reuse it rather than writing a new one; it is on
`main` and it already handles the two traps it found (Chromium does not enumerate custom
properties in a stable order, and `#hudSnapshot` renders a wall clock).

**Two identical baseline runs first**, to prove the harness is deterministic before you
trust a single diff.

A pixel diff is a good second check. Computed style is the exact one.

---

## Three questions to answer, not defer

These are cheap now and expensive at phase 12.

1. **Does `scripts/build_static_snapshot.js` coexist with a Vite build, or get replaced?**
   It flattens the worker entry point for static hosting and already derives its asset list
   from the shell's `<link>` tags — verified to pick up all 24 stylesheets. A bundler
   changes what "the asset list" means.
2. **Do the 24 stylesheets stay, or move into the theme?** Hybrid — MUI components over the
   existing CSS — is lower-risk and lets phases 2..N proceed without a styling rewrite, but
   it means two styling systems for the duration. Either answer is defensible; an
   unstated one is not.
3. **What is the bundle-size budget?** Set a number and add a check, the way COMMAND's
   screen height is checked. React + React-DOM + MUI + Emotion is ~150KB gzipped before any
   of your own code. Unbudgeted, it only gets noticed once it is already large.

---

## What must not break

- **`npm test` green**, exact counts reported, with the delta explained.
- **`scripts/verify_mobile_overflow.js`** — 0 unreachable at 375/414/768 both modes; report
  the numbers. COMMAND under **3.25** screens at 1920.
- `verify_drive_explorer.js`, `verify_mining_registers.js`, `verify_v2_navigation.js` pass.
  These drive the real page and read the DOM, so they should be unaffected — if one breaks,
  the bundle is changing rendering and that is a Phase 0 failure, not a Phase 2 problem.
- **`assertViewRegistryIntegrity()` still passes.** It is the mount table the migration
  depends on.
- The six CSS-reading tests via `tests/fixtures/missionControlCss.js` still pass — Phase 0
  does not move stylesheets, so this is a regression check, not new work.
- **Nothing under `server/` or `shared/` is touched.** This is a rendering change. If you
  find yourself editing the backend, stop and report why.

---

## Deliverable

One commit on a branch off `main`, plus:

- The before/after computed-style diff result, and the two baseline runs proving determinism.
- The three answers above, written into `docs/react-migration-spec.md` under Phase 0.
- Bundle size, measured, against the budget you set.
- A short note on what `npm run dev` does differently from `npm start`, for the next reader.

Report anything where this brief or the spec is wrong. The spec already got the module
system wrong; assume there is more.
