# React migration — parallel work plan and assignments

Written 2026-08-24 against `main` @ `fe916ff`. Companion to
`docs/react-migration-spec.md`; this file says **what runs at the same time and who owns
it**, not what to build.

Assignment follows the routing in `CLAUDE.md`: Antigravity for fast frontend
implementation, Composer 2.5 for long multi-file runs, Grok for analysis and single-shot,
DeepSeek/MiniMax for review, Claude for planning, review and empirical verification.
**Never route anything visual to DeepSeek** — it has no vision.

---

## The dependency spine, and where it stops

```
Phase 0  scaffold ─┐
                   ├─> Phase 1  theme + primitives ─> Phases 2..17  components
                   │                                   (parallel, 2-3 at a time)
theme extraction ──┘
```

**Serial:** Phase 0 → Phase 1 → first component. React must exist before primitives, and
primitives before anything consumes them.

**Not serial:** everything in Track B and C below, and phases 2–17 among themselves.

---

## Running now

### Track A — Phase 0 scaffold · **Antigravity** · in flight

Vite + React + MUI, coexistence proof through the `VIEWS` mount table, computed-style
harness, empirical bundle floor then budget. Plan reviewed twice; six corrections taken,
two outstanding (`public/v2/app/` not gitignored; `vite.config.mjs` importing
`server/config.js` pulls a validator that reads a gitignored `config.json`).

**Blocks:** Phase 1, and every component phase.

### Track B — publish and deploy · **the owner** · independent

Fully outside the migration. The hosted site is serving pre-weekend snapshots with
materially wrong figures live: total-war reading **7 years remaining against a true
~1.09**, every research cost **double**, the primary recommendation still *Advise USA*
rather than the China purge, water income 15% low.

`npm run push:supabase`, then a worker deploy. `push:dry-run` rehearses it.

**Blocks:** nothing. **Blocked by:** nothing. Highest value per minute of anything here.

### Track C — per-component data contracts · **Claude** · independent

The analysis each component phase would otherwise repeat from scratch. For each of the 16
components: which endpoint and fields it reads, its empty and unavailable states, what
differs in player mode, which shared primitive it will need, and which of its assertions
are pinned by an existing test or verify script.

Needs no React, no build, no Phase 0. Sixteen are independently useful even if the
migration stalls — they are a map of the frontend's data surface, which does not exist
today.

**Blocks:** nothing. **Feeds:** phases 2–17, making each one implementation rather than
discovery.

---

## Queued, in dependency order

### Track D — theme extraction · **Composer 2.5** · after Phase 0 confirms the engine

Derive the MUI theme from the existing tokens rather than inventing one: the four
`--fs-*`, the three display tiers, `--space-*`, and the full palette out of
`01-tokens-and-base.css` into `createTheme`, plus the test asserting theme values equal the
CSS custom properties so the two cannot drift while both exist.

**Held until Phase 0 pins MUI v6 vs v7 and the styling engine.** Building a theme against
the wrong engine is rework, and that decision is a Phase 0 deliverable. It is otherwise
pure data transformation and could have run in parallel.

### Track E — Phase 1 primitives · **Composer 2.5** · after Phase 0

`Panel`, `DataTable`, `Measured`/`Estimated`, `Value`, `TruncationNote`. Long, multi-file,
long-horizon — Composer's stated strength. `.de-table` on DRIVES is the table reference.

**Blocked by:** Phase 0. **Blocks:** all component phases.

### Tracks F1..F3 — component migration · **Antigravity ×2–3 in worktrees** · after Phase 1

Two or three components at a time, each in its own worktree, merged sequentially by Claude
with verification against the live save between merges — the pattern that ran all weekend.

**The two real constraints on parallelism:**

1. `public/v2/index.html` is a merge point — each migration removes a classic `<script>`
   tag. Expect conflicts there and nowhere else; they are trivial to resolve but must be
   resolved by whoever merges, not by each agent.
2. A component needing a **new** shared primitive extends Track E's set, which serialises
   against every other in-flight component. If a phase discovers it needs a new primitive,
   it should stop and say so rather than inventing a local one.

Order from the spec, lowest-risk first: `unlocked-tech`, `mc-budget`,
`strategic-commentary`, then the register-bearing panels, with `drive-explorer` **last**
deliberately.

### Track G — review · **MiniMax M3** or **DeepSeek** · after each component phase

Independent critique of each migrated component against its contract from Track C.
`CLAUDE.md` routes review to MiniMax and DeepSeek rather than implementation.

**Never DeepSeek for anything requiring a screenshot** — no vision. MiniMax for anything
visual; either for logic.

---

# Wave 2 — seven lanes, 2026-08-24

Tracks A, B, C and D are done and pushed (`febcbfc`). Everything in the React
spine is now blocked on Track E — **except the one large body of work that needs
no React at all**, which is what fills the other lanes.

**Six components have no unit test naming them**: `mc-budget`, `council-orders`,
`executive-boards`, `intelligence-library`, `faction-intel`, `world-map` —
**3,004 source lines**, including the two largest overlays in the product.
`docs/react-component-contracts.md` calls this the single biggest risk in the
migration, and it is not a React problem. Each of those phases must add
**characterisation coverage before migrating**, or the phase cannot tell a
successful migration from a lossy one.

That work splits into four lanes and blocks nothing.

## The lanes

| # | lane | tool | why this tool |
| --- | --- | --- | --- |
| 1 | **Track E — the five primitives** | Composer 2.5 | long multi-file agentic run; critical path |
| 2 | characterisation: `world-map`, `mc-budget` | Antigravity | fastest, and these are the two with real DOM behaviour (SVG; an interactive stepper) |
| 3 | port cleanup, then characterisation: `executive-boards`, `council-orders` | DeepSeek | scripts are backend work; no screenshot needed for either |
| 4 | characterisation: `intelligence-library`, `faction-intel` | Codex 5.6 | the two biggest overlays, 1,843 lines — an all-rounder that punches above its size |
| 5 | Track C part 2 — contract depth for all 16 | Grok 4.6 | analysis and single-shot is its peak; **not** a long autonomous run |
| 6 | review + audit | MiniMax M3 | reviews rather than implements; has vision |
| 7 | merge, verify, hold `index.html` | Claude | — |

**Nothing here shares a file.** Composer is in `src/v2/`, three lanes add new
`tests/*.test.js` files, Grok edits one doc, DeepSeek edits `scripts/verify_*.js`.
The one known merge point — `public/v2/index.html` — is untouched until the first
component actually migrates.

## What every characterisation lane must do

The point is to capture what the component renders **today**, so a later rewrite
that silently drops a field fails loudly.

- **Use fixtures, never the live save.** `tests/fixtures/frozenSnapshots.js` for
  snapshot data, `tests/fixtures/renderHarness.js` to render. That harness
  executes the shipped `public/v2/js/shared.js`, so the sandbox cannot drift from
  production — it exists because two earlier harnesses stubbed `escapeHtml` with
  something that did not escape. `tests/noLiveSaveInUnitSuite.test.js` guards this.
- **Both modes.** Player redacts, and several of these panels are a genuinely
  different answer rather than a filtered one. A panel characterised in one mode
  is not characterised.
- **Enumerate the unavailable states.** Every place the component renders
  UNAVAILABLE, UNKNOWN or an em dash needs its own assertion, because a rewrite is
  exactly where one silently becomes `0`.
- **Assert visible text, not innerHTML.** `visibleText` in the harness decodes
  entities; a raw tag-strip reports `&lt;1 mo` as `1 mo`.
- **Break the component deliberately and show the test red.** A characterisation
  test written from current output passes by construction — deleting a field from
  the payload and watching it fail is the only thing that proves it works.
- Five of the six are render-only (`render(root, payload)`); `faction-intel` is
  self-fetching and opens on demand, so it needs its fetch stubbed.

## Standing constraints for every lane

- Bind test servers to **port 0**, never a fixed port.
- **Nothing under `server/` or `shared/`** — this whole migration is a rendering
  change.
- Report exact suite counts and explain the delta. Baseline **1399 / 1397 pass /
  0 fail / 2 skip**.
- Merges are sequential and Claude does them; do not merge your own lane.

---

## What Claude does throughout

Planning, review of every agent plan before it runs, merging, and **empirical verification
against the live save between merges**. The weekend's record for why that is not optional:
of nine agent runs, **seven found a real error in the brief they were given**, and in four
cases the measurement inverted the conclusion rather than refining it.

Verification per merge, minimum: full suite with exact counts, `verify_mobile_overflow.js`
numbers, both modes, and the computed-style diff for anything claiming to change nothing.

---

## Sequencing risks worth naming now

- **`build:site` does not run `vite build`**, correctly, so the hosted deploy contains no
  React bundle. Right for Phase 0. It becomes a **release blocker the moment Track F lands
  its first component** — that panel would render locally and be missing on the hosted
  site. Fix it as a Phase 2 prerequisite, not by discovering it in a deploy.
- **Track C's contracts are only as good as the day they are written.** If a component
  changes between contract and migration, the contract lies. Cheap to re-check; expensive
  to trust blindly.
- **The verification story degrades under a bundler.** Byte-identity proofs stop being
  available once "what the browser runs" is no longer "what is in the repo". Computed-style
  and pixel diffing become primary. This is recorded in the spec and belongs in `CLAUDE.md`
  once Phase 0 confirms the build shape.
