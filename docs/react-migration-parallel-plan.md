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
