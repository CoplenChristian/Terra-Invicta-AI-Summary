# React migration — Track E: the five shared primitives

Written 2026-08-24 against `main` @ `aa1be04`. Track E of
`docs/react-migration-parallel-plan.md`. Assigned to **Composer 2.5**.

Track D landed the theme (`src/v2/theme.js`, parity-tested through the browser).
This phase builds the vocabulary every one of the sixteen component phases
consumes, so it gets its own check-in and its own scrutiny.

**No panel is migrated here.** The deliverable is five components, their tests,
and one measurement that has to be taken before any of them is trusted.

---

## Correcting the spec before you start

`docs/react-migration-spec.md` describes the primitives from memory. Measured on
`aa1be04`, three of its claims are wrong or incomplete.

**`.tech-card` has six modifiers, not two.** The spec names `--priority` and
`--alert`. The stylesheet also carries `--featured`, `--dense`, `--quiet` and
`--commentary`, plus three structural parts (`-header`, `-title`, `-body`).
`<Panel>` must cover all six or the phases that need the other four will invent
local variants, which is the drift this component exists to prevent.

**The six tables are all real `<table>` elements.** `.mc-board-table`,
`.de-table`, `.fe-table`, `.mining-table`, `.intel-library-table` and
`.commentary-sim-table` every one render `<table><thead><tr><th>` /
`<tbody><tr><td>`. `.de-table` puts custom class names on the rows and cells
(`.de-row`, `.de-cell`, `.de-th`) but is still `border-collapse: collapse` on a
real table. **One component can serve all six** — this is a naming difference,
not six architectures. `.commentary-sim-table` has no scroll wrap (it sits
inside `.commentary-sim-section`).

**The scroll container is already unified, and you should not redesign it.**
`22-drive-explorer.css:291-311` groups `.de-table-wrap` with
`.mc-board-table-wrap` for overflow and the whole webkit scrollbar treatment;
`15-responsive.css:123` groups `.mc-board-table-wrap` with
`.intel-library-table-wrap`. The **wrap is already a shared concept in CSS while
the table interiors are not**. Formalise the wrap as it stands and spend the
design effort on the interiors, which is where the five genuinely diverge.

`.mc-board-table` also has `--ledger` and `--fleet` variants and `.mining-table`
has `--upgrades`, so `<DataTable>` needs a variant concept from day one.

---

## The measurement to take first: cascade order under Emotion

This is the one thing that can silently break every migrated panel, and it must
be measured before any primitive is written.

Phase 0 settled a **hybrid**: the 24 stylesheets stay as the global foundation
and MUI styles components on top. That means two styling systems compete for the
same elements, and **the cascade order between them is not the source order you
can read.** Emotion injects `<style>` elements at runtime; the 24 sheets are
`<link>` tags in `<head>`. Which wins at equal specificity depends on injection
position, not on anything visible in the repo.

That matters here specifically because **all three measured/estimated register
pairs win by source order, not by specificity**:

| pair | file |
| --- | --- |
| `.mining-meas__value` beats `.mining-yields-text` | `18-mining-expansion.css` |
| `.de-measured` | `22-drive-explorer.css` |
| `.fe-meas` / `.fe-est` | `24-fleet-engagement.css` |

`CLAUDE.md` records that all three "sit after the rules they beat", and
`tests/mineModuleOutput.test.js` asserts that outcome directly. The stylesheet
split was kept as a pure slice specifically so those orderings could not move.

**So: before writing any primitive, mount a throwaway Emotion-styled element next
to an existing global-styled one and measure which rule wins** at equal
specificity, in the real page. Write the answer down. If Emotion wins, every
primitive can style freely; if it loses, primitives must keep the existing class
names on their elements and add styling through them rather than replacing them.
Either answer is workable. Guessing is not.

Note also that `.de-measured` has **no `.de-estimated` counterpart** — the three
pairs use three different naming schemes and one of them is half-named. Pick one
vocabulary for the component and map the three onto it.

---

## The five primitives

**`<Panel>`** — replaces `.tech-card`. Header, title, body, and all six
modifiers. **Must carry a visible border on all four sides.** The vanilla one
shipped for months with three edges drawn only by a 1.095:1 background contrast;
that is the defect this component exists to make unrepeatable, and a test should
assert four non-zero border widths rather than trusting the CSS.

**`<DataTable>`** — one real `<table>`, a variant concept, and the already-shared
wrap. `.de-table` on DRIVES is the interior reference: sticky header
(`.de-th { position: sticky; top: 0 }`), right-aligned tabular numerics, header
never smaller than its data, and the measured `is-scrollable` hint. That hint is
driven by `scrollWidth > clientWidth`, **never by viewport width** —
`tests/missionControlLayout.test.js` asserts exactly that, and every scroll hint
the page renders must stay registered for measurement or
`assertViewRegistryIntegrity`'s sibling check fails.

**`<Measured>` / `<Estimated>`** — the two-register split is an honesty device,
not styling. It is asserted by computed style in
`scripts/verify_drive_explorer.js` and `scripts/verify_mining_registers.js`, so
the components must satisfy those scripts unchanged.

**`<Value>`** — renders a number, or an explicit unavailable state. **Never a
coerced zero.** `Number(null) === 0` is this repo's most repeated defect. The
component must distinguish *measured zero* from *absent* — they render
differently and conflating them is the bug. Take a value plus an explicit
presence signal; do not infer absence from falsiness.

**`<TruncationNote>`** — a capped list states its total and omitted counts.
There are **13 distinct count fields** already in the components
(`availableTotalCount`, `benchedTotalCount`, `declinedOmittedCount`,
`fleetsOmittedCount`, `fleetsTotalCount`, `itemsOmittedCount`,
`riskFloorUnverifiedOmittedCount`, `riskFloorUnverifiedTotalCount`,
`riskFloorVetoedOmittedCount`, `riskFloorVetoedTotalCount`,
`satisfiedPrerequisiteOmittedCount`, `satisfiedPrerequisiteTotalCount`,
`shipsTotalCount`). The component takes the pair, not a naming convention — but
**an omitted count that is absent is not zero**, and rendering "showing all" when
the count was never read is the same defect class as fabricating data.

---

## What must not break

- **`npm test` green**, exact counts, delta explained. Baseline is
  **1399 tests / 1397 pass / 0 fail / 2 skip** (verified independently 2026-08-24).
- **Zero computed-style change.** No panel consumes these yet, so nothing may
  move. If `main.jsx` does not import them, `public/v2/app/bundle.js` should stay
  byte-identical at `daecedcfcba6a9f13baa95134ad700bc` — which proves it more
  cheaply than a capture does. If you do wire them in, capture and diff against
  `tmp/computed-style-captures/post_phase0.json` (md5
  `6783cc9b4ebfe8ab9eaabc75e452b336`).
- **`verify_mobile_overflow.js`** — 0 unreachable at 375/414/768 both modes;
  COMMAND under 3.25 screens at 1920 (currently 2.98).
- `verify_drive_explorer.js`, `verify_mining_registers.js`,
  `verify_v2_navigation.js` pass with **0 console and 0 network errors**.
- **Bind test servers to port 0**, not a fixed port. Every browser test currently
  hard-codes one (3989, 3995, 3996, 3997) and two concurrent runs collide —
  this already produced a false `EADDRINUSE` failure on 2026-08-24. Read the port
  back from `server.address().port`.
- **Nothing under `server/` or `shared/`.** This is a rendering change.
- **Break every new test deliberately first** and show it red.

---

## Deliverable

One commit on a branch off `main`:

- The five primitives under `src/v2/`.
- Their tests, each broken deliberately first.
- **The cascade measurement written down** — which system wins at equal
  specificity, measured in the real page, and what that implies for the other
  fifteen phases.
- A short note on any primitive whose shape the sixteen components will not fit,
  because extending this set later serialises against every in-flight component.

Report anything where this brief is wrong. Every brief in this migration so far
has carried at least one factual error.

---

## Decisions

Recorded 2026-08-24 as part of Track E implementation.

### 1. Cascade order — Emotion wins at higher specificity; global wins on `!important` and on a later duplicate at matching specificity

Measured in the real page (`public/v2/primitives-harness.html`): the linked/inline
`.cascade-order-probe` rule sets `color: rgb(1, 2, 3)` at **(0,1,0)**, while the
Emotion `styled()` rule is written `&.cascade-order-probe`, which compiles to
`.css-*.cascade-order-probe` at **(0,2,0)**. **`getComputedStyle` on the
Emotion-mounted element returns `rgb(40, 50, 60)`** — a specificity win, **not**
the equal-specificity result the first record claimed. Two genuinely threatening
cases are pinned alongside it: a global `.cascade-order-important`
`!important` rule beats Emotion at (0,2,0), and a global `.cascade-order-late`
rule duplicated at (0,2,0) in a stylesheet injected **after** Emotion's runtime
`<style>` tags wins by source order. Emotion wins only when it is both
heavier-specificity and injected later. All three are pinned by
`tests/reactCascadeOrder.test.js`.

**Implication for the fifteen component phases:** primitives and migrated panels
may use MUI `sx` / `styled()` for new styling, but they stay ahead of the 24
linked sheets only by the specificity of their compiled selectors and by
Emotion's injection position (it appends to `<head>` at render). A global rule
that must win needs `!important` or a later, equal-or-higher-specificity
position. Existing global class names are still kept on migrated surfaces where
the vanilla CSS already defines the look (`.tech-card`, table wraps, register
classes) so load-bearing cascade pairs in the 24 sheets
(`mining-meas__value` beating `mining-yields-text`, etc.) stay attached to real
elements without relying on injection order.

### 2. Primitives keep global class names on the DOM

Even though Emotion wins the base probe, `<Panel>`, `<DataTable>`,
`<Measured>`, `<Estimated>` emit the same class names the vanilla components use
today. MUI is present in the harness for the cascade probe only; production
`bundle.js` does not import the primitives yet (`daecedcfcba6a9f13baa95134ad700bc`
unchanged).

### 3. Register vocabulary — `register` prop maps legacy schemes

One component pair (`Measured` / `Estimated`) with `register="de"|"fe"|"mining"`
mapping to `.de-measured__value`, `.fe-meas__value`, `.mining-meas__value` and
their estimate counterparts. There is no `.de-estimated` half-name in CSS.

### 4. Shapes the sixteen components may still need

Nothing blocks migration, but these gaps are explicit:

- **`<DataTable>` custom interiors:** `.de-table` rows use `.de-row` / `.de-cell`
  with per-column classes (`de-cell--name`, sticky first column). The primitive
  exposes `columns`/`rows` for simple tables and `children` for full interior
  control — drive-explorer will use `children`.
- **`<TruncationNote>` styling:** takes `className` because each panel uses a
  different note class (`directive-benched-omitted`, `ra-census`, etc.).
- **`mining-table--upgrades`:** class is used in JS but has no dedicated rules in
  `18-mining-expansion.css` (brief claim checked — variant is supported, rules
  are not separate).
- **Per-panel scroll hint text:** `DataTable` accepts `hintText`; defaults to
  the DRIVES string.
- **`commentary-sim`:** sixth table system — `variant="commentary-sim"` maps to
  `.commentary-sim-table` with no scroll wrap (table sits inside
  `.commentary-sim-section` today).

### 5. Nine contract primitives — included vs deferred

Track E ships **only the five** named in this brief (`Panel`, `DataTable`,
`Measured`/`Estimated`, `Value`, `TruncationNote`). All nine surfaces flagged
independently across the contract lanes are **deferred to a follow-on primitive
batch** (Track E₂ or per-component unblock). Deferring one later serialises
against every in-flight component phase — the table below is the decision now.

| Primitive | Track E | Needed by (contract lanes) | Notes |
| --- | --- | --- | --- |
| **`Overlay`** | **Deferred** | `detail-panel`, `faction-intel`, `intelligence-library` (3) | Shared `.detail-panel` / `.faction-intel-screen` / `.intelligence-library-screen` chrome + `setOverlayOpen` in `mission-control.js`. Highest serialisation risk with Modal. |
| **`Modal`** | **Deferred** | `detail-panel`, `drive-explorer`, `faction-intel` (3) | `MissionControlDetailPanel.open` and drive path modal; overlaps Overlay styling in `09-detail-panel.css`. |
| **`Meter` / `Gauge`** | **Deferred** | `directive-board` (2 bar systems), `alien-hate-economics` (`#hudHateMeter`) | Two distinct bar vocabularies; not one component. |
| **`Chip`** | **Deferred** | `drive-explorer`, `directive-board`, `executive-boards`, `faction-intel` | `.de-chip`, `statusChip`, faction status tones — shared tone map, not one class. |
| **`Badge`** | **Deferred** | `directive-board`, `council-orders`, `strategic-commentary` | `.directive-status-badge--*`, commentary mode badge, council chips. |
| **`Notice`** | **Deferred** | `drive-explorer`, `mining-expansion`, `research-advisor` | `.de-notice--warn` / `--filters` and panel-specific notice blocks. |
| **`FilterBar`** | **Deferred** | `drive-explorer`, `unlocked-tech`, `intelligence-library` | `.de-controls` and search/filter rows with live counts. |
| **`Tabs`** | **Deferred** | `intelligence-library`, `faction-intel`, shell nav | Nested `role="tablist"` groups — section nav is controller-owned, not one panel. |
| **`VisibilityTag`** | **Deferred** | `faction-intel` | Eleven-state `buildVisibilityTag` / `normalizeVisibility` vocabulary. |

**Recommended E₂ order:** `Overlay` + `Modal` first (three consumers each, shared
CSS in `09-detail-panel.css`), then `Chip`/`Badge`, then panel-specific
`FilterBar` / `Notice` / `Tabs` / `VisibilityTag` / `Meter`.
