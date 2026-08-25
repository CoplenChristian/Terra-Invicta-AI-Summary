# React migration — Track D: extract the MUI theme from the existing tokens

Written 2026-08-24 against `main` @ `a7c621e`. Track D of
`docs/react-migration-parallel-plan.md`. Assigned to **Composer 2.5**.

Phase 0 pinned the engine, so this is unblocked: **MUI v6.5.0 with `@emotion/react`
and `@emotion/styled`**, React 18.3, Vite building `src/v2/` into
`public/v2/app/bundle.js`.

**Nothing is migrated in this phase and no panel changes.** The deliverable is a
theme object, a parity test, and the three mapping decisions below written down.
If a component gets rewritten here, the track has failed.

---

## Correcting the plan before you start

`docs/react-migration-parallel-plan.md` says the theme is "the four `--fs-*`, the
three display tiers, `--space-*`, and the full palette". Measured on `a7c621e`,
that undercounts. The real surface in `public/v2/css/01-tokens-and-base.css`:

- **63 declarations in exactly one `:root` block.** There is no second `:root`
  and **no media-query overrides any token** — verified across all 24 parts. The
  theme is therefore *static*: no responsive token layer to model.
- **16 of the 63 are pure `var()` aliases**, not values — the whole `--bg-*` set,
  `--text-main`, `--font-sans` / `--font-mono`, and six of the seven `--init-*`
  hues. **47 are independent values.** A theme with 63 entries would encode the
  same colour twice under two names and let them drift.
- **There are nine `--fs-*` tokens, not seven.** The plan omits
  `--fs-map-name: 10.5px` and `--fs-map-note: 8px`. Both are off the main scale
  and belong to `world-map` only; `public/v2/js/components/world-map.js:38` names
  `--fs-map-note` directly.

Usage is heavily skewed toward the dense end, which is where the theme has to be
right:

| token | uses | | token | uses |
| --- | ---: | --- | --- | ---: |
| `--fs-tag` 9px | **169** | | `--fs-section` 15px | 11 |
| `--fs-meta` 10px | **94** | | `--fs-kpi` 19px | 8 |
| `--fs-metric` 11px | **58** | | `--fs-title` 26px | 6 |
| `--fs-row` 12.5px | **50** | | `--fs-map-*` | 4 |

`--fs-tag`, `--fs-meta`, `--fs-metric` and `--fs-row` carry **371 of 401** uses.
Getting `--fs-title` slightly wrong costs six declarations; getting `--fs-tag`
wrong costs a hundred and sixty-nine.

Spacing skews the same way: `--space-sm` (6px), `--space-lg` (10px),
`--space-xs` (4px) and `--space-md` (8px) are 56 of 74 uses.

---

## The parity test must read computed values, not parse the file

The spec says only "a test must assert the theme's values equal the CSS custom
properties". The obvious implementation — `fs.readFileSync` the token file, regex
the declarations, compare strings — is the **wrong** one, and this repo has the
incident that proves it.

`tests/fixtures/missionControlCss.js` records it: `--text-muted` was once defined
**self-referentially**, so 164 rules silently fell back to `inherit` while the
source file read perfectly correctly. A text-matching parity test would have been
green throughout.

So the parity test must resolve the tokens **the way the browser does**:

```js
getComputedStyle(document.documentElement).getPropertyValue('--fs-tag')
```

Drive the real shell in Playwright — the pattern in `tests/cssComputedStyle.test.js`
and `tests/missionControlLayout.test.js` — and assert each theme value equals the
*computed* custom property. A token that resolves to empty, to `inherit`, or to
itself must fail the test, not pass it silently. Assert the token is non-empty
before comparing; an unresolvable token is **unknown, not equal**.

Note that `playwright` is currently reachable only as a transitive dependency;
Antigravity is making it explicit in the Phase 0 follow-up. Coordinate rather than
adding it twice.

---

## Three mapping decisions, each with a trap

MUI's defaults do not fit this token set. Decide explicitly and record why.

**1. Spacing is not linear, so `spacing: 8` is wrong.** MUI's `theme.spacing(n)`
defaults to an 8px unit producing 8 / 16 / 24. The real scale is
**2, 4, 6, 8, 10, 12, 16, 20, 24** — a 2px step at the bottom that only opens up
at the top. `spacing: 8` reproduces exactly three of the nine values. Either pass
a function, or carry the nine as named entries and leave `theme.spacing` unused.
Say which, and make the parity test cover all nine either way.

**2. Nine font sizes do not fit MUI's variant names.** `h1`–`h6`, `body1`,
`body2`, `caption`, `overline`, `subtitle1/2` are a different vocabulary with
different semantics. Do **not** force-fit — `--fs-tag` is not `caption`, it is a
9px table header used 169 times. Add custom typography variants named for the
tokens and register them for TypeScript-free use. Force-fitting is how the type
scale drifts back to 310 literals.

**3. The palette names do not match MUI's.** MUI expects
`primary`/`secondary`/`error`/`warning`/`info`/`success`, each with
`main`/`light`/`dark`/`contrastText`. This palette has `accent` /`accent-strong`/
`accent-soft`, `success`/`warning`/`danger` (**`danger`, not `error`**), and a
separate seven-hue categorical set (`--init-cyan` … `--init-purple`) each with a
paired `-glow`. The categorical set is *data* colouring, not intent colouring —
it should be its own theme key, not crammed into `palette.primary`. Map the
intent trio onto MUI's names, keep the categorical set separate, and record the
`danger` → `error` rename in one place so nobody re-derives it.

---

## What must not break

- **`npm test` green**, exact counts reported, delta explained. Baseline after
  Phase 0 is **1398 tests / 1396 pass / 0 fail / 2 skip** (verified independently
  2026-08-24).
- **Zero computed-style change.** `scripts/verify_computed_style_baseline.js`
  `--capture` then `--diff-files` against the pre-existing baseline must come back
  identical. Adding a theme object that nothing renders yet cannot move a pixel,
  and if it does, something is being injected that should not be.
  **Corrected 2026-08-24 after the Phase 0 follow-up (`ae758cd`):** the pre-React
  reference is `tmp/computed-style-captures/post_phase0.json`, md5
  `6783cc9b4ebfe8ab9eaabc75e452b336`. Do **not** use `baseline_run1.json` — it was
  overwritten by the follow-up's re-run and now carries the new
  `{metadata, states}` schema and a different save fingerprint. Legacy captures
  still diff correctly (`rawA?.states || rawA` is backward compatible).
- **`verify_mobile_overflow.js`** — 0 unreachable at 375/414/768 both modes;
  COMMAND under 3.25 screens at 1920 (currently **2.98**).
- `verify_drive_explorer.js`, `verify_mining_registers.js`,
  `verify_v2_navigation.js` pass with **0 console and 0 network errors**.
- **The 24 stylesheets stay.** Phase 0 settled the hybrid: CSS remains the global
  foundation, the theme mirrors it. Do not delete a token because the theme now
  carries it — both must exist for the whole migration, which is exactly why the
  parity test exists.
- **Nothing under `server/` or `shared/`.** This is a rendering change.
- **Break the parity test deliberately first.** Change one theme value, confirm
  red, change it back. A parity test written after the theme passes by
  construction.

---

## Deliverable

One commit on a branch off `main`:

- `src/v2/theme.js` (or `.mjs`) exporting the `createTheme` result.
- The parity test, computed-value based, covering **all 47 independent values**
  plus the nine spacing steps — and explicitly *not* asserting the 16 aliases as
  separate truths.
- The three decisions above written into `docs/react-theme-extraction-brief.md`
  under a "Decisions" heading appended to this file.

**Do not edit `docs/react-migration-spec.md`** — Antigravity is editing it
concurrently for the Phase 0 follow-up.

Report anything where this brief is wrong. It has been measured, but the last two
briefs in this migration each carried a factual error, so assume there is one.

---

## Decisions

Recorded 2026-08-24 as part of Track D implementation in `src/v2/theme.js`.

### 1. Spacing — named entries, `theme.spacing` unused

MUI's default `spacing(n) = n × 8px` reproduces only three of the nine real steps
(8, 16, 24). The theme carries the full scale as **`theme.initiative.space`**
with keys matching the CSS suffixes (`2xs`, `xs`, `sm`, `md`, `lg`, `xl`, `2xl`,
`3xl`, `4xl`). `createTheme` is left on MUI's default `spacing` multiplier;
migrated components must read `theme.initiative.space.sm` (etc.), not
`theme.spacing(1)`. The parity test asserts all nine named entries against the
computed `--space-*` custom properties.

### 2. Typography — token-named custom variants, no h1–h6 force-fit

Nine font-size tokens map to **`theme.typography` variants named for the tokens**:
`tag`, `meta`, `metric`, `row`, `section`, `kpi`, `title`, `mapName`, `mapNote`.
These are not aliased onto MUI's semantic names (`caption`, `body1`, `h6`, …) —
`--fs-tag` (169 uses) is a 9px table-header tier, not a caption. Display tiers
use `fontFamilyDisplay` / the `kpi` and `title` variants' `fontFamily: var(--display)`
stack. `fontFamilyMono` holds the mono stack separately from `fontFamily`.

### 3. Palette — intent on MUI names, categorical set separate, `danger` → `error`

Intent colours map onto MUI's palette: `primary` = accent trio (`main` /
`light` = accent-strong; `accent-soft` lives on `palette.initiative.accentSoft`),
`error.main` = **`--danger`** (the CSS name stays `--danger`; only the MUI key is
`error`), `success` / `warning` / `info` = success / warning / blue. Surfaces and
text tiers sit on `background` / `text` plus `palette.initiative` for
raised/inset/line-strong/text-dim.

The seven-hue categorical set is **`palette.initiative.categorical`** (and mirrored
on `theme.initiative.categorical`): `cyan`, `blue`, `pink`, `gold`, `emerald`,
`crimson`, `purple`, each with `main` and `glow`. Alias-backed hues
(`--init-cyan` = `var(--accent)`, etc.) are not duplicated — they resolve through
the intent entries above.
