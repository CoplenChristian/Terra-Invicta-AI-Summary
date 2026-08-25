# Dispatch runbook — wave 2

Written 2026-08-24 against `main` @ `33211a8`. Companion to
`docs/react-migration-parallel-plan.md`, which says *why* these lanes exist.
This file says **when to send each thing and exactly what to paste.**

Baseline everything is measured against: **1399 tests / 1397 pass / 0 fail /
2 skip**, bundle `daecedcfcba6a9f13baa95134ad700bc`, origin level with `main`.

---

## The timing, in one paragraph

**Six of the seven lanes go out now, in any order.** They share no files, so
there is nothing to sequence. Only one thing is genuinely blocked: MiniMax's
review of Track E, which needs Track E to exist — so MiniMax gets an audit job
now and the review job later. The component phases are blocked on **two** things
finishing, not one: the primitives (Track E) *and* the characterisation coverage
for the six untested components. Those two are running in parallel right now,
which is the point.

| round | trigger | who |
| --- | --- | --- |
| **1** | now | Composer, Antigravity, DeepSeek, Codex, MiniMax |
| **2** | Track E merged | MiniMax (review) |
| **3** | Track E reviewed **and** characterisation merged | Antigravity ×2–3, on components |

**Grok's lane is held** to preserve Cursor usage for Composer — see the struck
section below. Claude took the contracts work instead, so Round 1 is **four
prompts to send**, not five.

Between every round I merge sequentially and verify against the live save. Do
not merge your own lane.

---

---

# STATUS — Round 1 closed 2026-08-24

All four dispatched lanes merged and pushed. Suite **1496 / 1494 pass / 0 fail /
2 skip**, tree clean, origin level.

| lane | landed | contribution (measured in isolation) |
| --- | --- | ---: |
| Composer — Track E primitives | `16293a4` | +12 tests |
| Antigravity — characterisation | `87f3f55` | +26 |
| DeepSeek — port 0 + characterisation | `a9a0c53` | +39 |
| Codex — the two overlays | `af76a7e` | +20 |

1399 + 12 + 26 + 39 + 20 = **1496**, which reconciles exactly. **No lane could
compute its own delta**: `run_unit_tests.js` walks the directory rather than a
manifest, so four lanes writing into one tree each counted the others' untracked
files. Reported deltas were +36, +38 and +58 against true figures of 26, 12 and
20. Measure each lane's files alone before believing a delta.

**Six of the seven untested components are now covered.**
`alien-hate-economics` is the holdout — see Round 1b.

**Two things came out of the wave that were not in it:**

- The suite is **intermittently red** from browser-test contention: 5 browser
  test files became 11, and `node --test` runs them concurrently. A failure at
  30,294ms that passes alone in 944ms is a timeout wearing an assertion's
  clothes. Out to DeepSeek. Until fixed, "suite green" from any lane is a coin
  flip and needs a second run.
- Defect **#9** in `docs/live-defect-register.md`: priority targets truncate
  **79 of 87** with no announcement, in the component *and* in
  `shared/markdownExports.mjs`, which is the AI-facing surface and ships to the
  hosted worker.

---

# ROUND 1b — send now

## → Antigravity (or any free lane)

The seventh untested component. Use the Round 1 characterisation prompt below
with `alien-hate-economics` as the only component, plus this:

```
alien-hate-economics is the last of the seven with no test naming it.
tests/alienHateEconomics.test.js exists and shares its name but imports
server/alienHateEconomics -- it never loads the component. Do not be reassured
by it.

Two things specific to this one:

1. It exposes { render, renderHud }, not a single render. renderHud mutates
   #hudHateMeter, an element that is NOT in the VIEWS registry, so
   assertViewRegistryIntegrity() does not cover it. Characterise BOTH entry
   points, and record what renderHud mounts and where.

2. Open lead to confirm or clear while you are in there: renderHud is reported to
   render an unmeasured hate as a green GAME ESTIMATE, because
   visibleEstimate: 'UNKNOWN' is truthy and is compared only against
   'UNAVAILABLE'. A sibling at :227 handles both correctly
   (`if (!text || text === 'UNAVAILABLE' || text === 'UNKNOWN') return null`),
   which is what makes the inconsistency plausible. Assert whichever is true --
   an unknown rendered as a confident estimate is a defect; the same code
   correctly refusing is coverage worth having.
```

---

# ROUND 1 — the original dispatch (complete)

## → Composer 2.5 (Cursor)

Nothing to paste. Its brief is committed:

```
Read docs/react-primitives-brief.md and implement Track E.
```

Everything it needs is in that file, including the measurement it must take
before writing any code.

---

## → Antigravity

```
Write characterisation tests for public/v2/js/components/world-map.js and
public/v2/js/components/mc-budget.js. Neither has a unit test naming it today.
Do not change the components.

The point: capture what they render RIGHT NOW so a later React rewrite that
silently drops a field fails loudly. This is the migration's biggest risk --
3,004 lines across six components currently have nothing that would fail if a
rewrite lost a field.

Use tests/fixtures/frozenSnapshots.js for data and tests/fixtures/renderHarness.js
to render. NEVER the live save -- tests/noLiveSaveInUnitSuite.test.js guards it,
and the standing rule is that unit tests use fixed data. renderHarness executes
the shipped shared.js so the sandbox cannot drift from production; it exists
because two earlier harnesses stubbed escapeHtml with something that did not
escape. Assert with its visibleText, which decodes entities -- a raw tag-strip
reports "&lt;1 mo" as "1 mo".

Cover, per component:
 - the normal render, both player AND omniscient (player redacts, and several of
   these panels are a different answer, not a filtered one)
 - EVERY unavailable state -- each place it renders UNAVAILABLE, UNKNOWN or an
   em dash gets its own assertion, because a rewrite is exactly where one
   silently becomes 0
 - any truncation: the *TotalCount / *OmittedCount pair asserted present
 - empty input, and absent input -- they are different

Both are render-only: render(root, payload). world-map is SVG with its own
two-step type ladder; mc-budget is interactive (a stepper with <output>).

REQUIRED: once the tests pass, delete a field from the payload, show the test go
RED, and restore it. A characterisation test written from current output passes
by construction; that break is the only thing that proves it works. Report it.

Bind any server to port 0, never a fixed port. Nothing under server/ or shared/.
Report exact suite counts against the 1399 / 1397 pass / 0 fail / 2 skip baseline.
```

---

## → DeepSeek (opencode)

Two jobs in one lane. Send as one message; it does them in order.

```
JOB 1 -- finish the port-0 conversion from febcbfc. Two things were missed.

(a) Four verify scripts still bind fixed ports and were not in the converted list:
    scripts/verify_drive_path_modal.js:262       listen(PORT) where PORT=3892
    scripts/verify_research_actionability.js:20  listen(3888)
    scripts/verify_research_tab_layout.js:27     listen(TEST_PORT)
    scripts/verify_research_vs_procurement.js:49 listen(3889)
    These pin fleet-procurement, research-advisor and detail-panel, so they are
    exactly the ones that will collide when two component agents run at once.
    Note verify_drive_path_modal.js:32 also does `process.env.PORT = String(PORT)`,
    which mutates the env the server itself reads -- find out what that was for
    before removing it.

(b) The converted files left dead TEST_PORT constants referenced nowhere:
    verify_computed_style_baseline.js:22, verify_mobile_overflow.js:25,
    tests/commandLayout.test.js:70, tests/reactThemeParity.test.js:16.
    Their env-var overrides are now silently inert -- set MOBILE_VERIFY_PORT to
    dodge a conflict and nothing happens. Delete them, or wire them back as a
    real override. A knob that looks live and does nothing is worse than neither.

Prove it by running two affected scripts concurrently and showing distinct ports.

JOB 2 -- write characterisation tests for
public/v2/js/components/executive-boards.js and council-orders.js. Neither has a
unit test naming it. Do not change the components.

The point: capture what they render RIGHT NOW so a later React rewrite that
silently drops a field fails loudly.

Use tests/fixtures/frozenSnapshots.js for data and tests/fixtures/renderHarness.js
to render. NEVER the live save -- tests/noLiveSaveInUnitSuite.test.js guards it.
renderHarness runs the shipped shared.js so the sandbox cannot drift from
production. Assert with its visibleText, which decodes entities.

Cover, per component:
 - normal render, both player AND omniscient
 - EVERY unavailable state (UNAVAILABLE, UNKNOWN, em dash), each its own assertion
 - any truncation: *TotalCount / *OmittedCount asserted present
 - empty input, and absent input -- they are different

Both are render-only: render(container, snapshot) / render(root, payload).
executive-boards is the one with NO single window global -- it registers several
render functions. Establish what it actually exposes and write that down; the
strangler mount assumes one entry point per panel, so this matters later.

REQUIRED: delete a field from the payload, show the test go RED, restore. That
break is the only thing proving a characterisation test works. Report it.

Port 0 everywhere. Nothing under server/ or shared/. Report exact suite counts
against 1399 / 1397 pass / 0 fail / 2 skip.
```

---

## → Codex 5.6

```
Write characterisation tests for public/v2/js/components/intelligence-library.js
(582 lines) and faction-intel.js (1,261 lines). Neither has a unit test naming
it -- these are the two biggest overlays in the product and a rewrite of
faction-intel currently has nothing that would fail if it silently dropped a
field. Do not change the components.

Use tests/fixtures/frozenSnapshots.js for data and tests/fixtures/renderHarness.js
to render. NEVER the live save -- tests/noLiveSaveInUnitSuite.test.js guards it,
and the standing rule is that unit tests use fixed data. renderHarness executes
the shipped shared.js so the sandbox cannot drift from production; it exists
because two earlier harnesses stubbed escapeHtml with something that did not
escape. Assert with its visibleText, which decodes entities -- a raw tag-strip
reports "&lt;1 mo" as "1 mo".

Cover, per component:
 - normal render, both player AND omniscient. Player redacts: observed enemies
   carry maskedAttributes rather than attributes, and a panel that filters on
   `attributes` drops every target in player mode. That exact bug shipped once.
 - EVERY unavailable state (UNAVAILABLE, UNKNOWN, em dash), each its own assertion
 - any truncation: *TotalCount / *OmittedCount asserted present
 - empty input, and absent input -- they are different
 - the overlay open/close path, including that it renders its own nav sections

intelligence-library is render-only. faction-intel is self-fetching and is fed on
open, so stub its fetch rather than letting it reach the network.

REQUIRED: once the tests pass, delete a field from the payload, show the test go
RED, and restore. A characterisation test written from current output passes by
construction; that break is the only thing that proves it works. Report it.

Bind any server to port 0. Nothing under server/ or shared/. Report exact suite
counts against the 1399 / 1397 pass / 0 fail / 2 skip baseline.
```

---

## ~~→ Grok 4.6 (Cursor)~~ — **held, reassigned to Claude 2026-08-24**

**Do not send this.** Cursor usage is being preserved for Composer, which is the
better call: Composer is also Cursor, Track E is the critical path, and
`CLAUDE.md` rates Composer as the only good fit for a long multi-file agentic run
while Grok's agentic coding measurably regressed.

The lane is not deferred — it feeds the Round 3 briefs and is needed by the time
Track E and characterisation land. **Claude took it**, fanned across five
read-only agents by component group, which keeps the Cursor budget entirely for
Track E. Output lands in `docs/react-component-contracts.md`.

The brief below is retained only as the record of what that lane was asked for.

```
Read docs/react-component-contracts.md. It maps all 16 v2 components but stops at
structure. Fill in the six per-component details it specifies, for each of the 16.

For every component in public/v2/js/components/:
 1. Payload shape. Class R: exactly what mission-control.js passes it. Class F:
    only the endpoint response fields it actually CONSUMES, not the whole payload.
 2. Player-mode difference -- not "is it filtered" but IS IT A DIFFERENT ANSWER.
    Two known: the cycle plan reads 19.30 player vs 66.13 omniscient; rival
    control-point caps refuse entirely in player.
 3. Every unavailable/empty state it can render (UNAVAILABLE, UNKNOWN, em dash).
 4. Measured vs estimated registers where present -- mining-expansion,
    fleet-engagement and drive-explorer carry the two-register split and it is
    asserted by computed style in the verify scripts. Honesty device, not styling.
 5. Which lists truncate, and which *TotalCount / *OmittedCount fields must survive.
 6. Which shared primitive it needs: Panel, DataTable, Measured/Estimated, Value,
    TruncationNote. Flag loudly if it needs one that does not exist -- extending
    that set serialises against every in-flight component.

Read the source; do not infer from names. Write it into
docs/react-component-contracts.md as a section per component. Touch NO other file
-- five other lanes are running concurrently. Report anything already in that doc
that is now wrong.
```

---

## → MiniMax M3 (opencode)

Audit only for now. Its review job is Round 2.

```
scripts/verify_research_tab_layout.js has been failing at 3.020 screens /
3,262px omniscient for several commits and has been deferred every time.
Diagnose it.

It and scripts/verify_mobile_overflow.js measure DIFFERENT elements --
#view-command versus the page body, about 130px of chrome, roughly 0.12 screens
apart. There is a comment recording this in verify_mobile_overflow.js. Read it.

Answer one question: is 3.020 a real layout defect, or a budget set against the
wrong element? Give the measurement that decides it.

Diagnosis only. Do not fix -- another lane owns those scripts this round.
```

---

# ROUND 2 — send when Track E is merged

I will tell you when. Trigger: Composer's primitives are merged to `main` and
green.

## → MiniMax M3

```
Review the five primitives in src/v2/ against docs/react-primitives-brief.md.

Check hardest the measurement the brief demands BEFORE any primitive is written:
whether Emotion or the 24 stylesheets win at equal specificity, measured in the
real page. All three measured/estimated register pairs currently win by SOURCE
ORDER, not specificity -- CLAUDE.md records that they sit after the rules they
beat and tests/mineModuleOutput.test.js asserts that outcome. If that measurement
was skipped, assumed, or reasoned about rather than taken in a browser, say so
plainly: it silently breaks the honesty registers on three panels.

Then check:
 - <Value> distinguishes a MEASURED ZERO from an ABSENT value. They render
   differently and conflating them is this repo's most repeated bug
   (Number(null) === 0). It must take an explicit presence signal, not infer
   absence from falsiness.
 - <Panel> covers all six .tech-card modifiers -- --priority, --alert,
   --featured, --dense, --quiet, --commentary -- not just the two the spec named.
 - <Panel> carries a visible border on all FOUR sides, asserted by a test rather
   than trusted from CSS. The vanilla card shipped for months with three edges
   drawn only by a 1.095:1 background contrast.
 - <DataTable> keeps the scroll hint driven by measured scrollWidth vs
   clientWidth, never by viewport width. tests/missionControlLayout.test.js
   asserts exactly that.
 - <TruncationNote> treats an ABSENT omitted-count as unknown, never as zero.
   Rendering "showing all" when the count was never read is the same defect class
   as fabricating data.

Report findings ranked by severity. Do not fix anything.
```

---

# ROUND 3 — component migration

Trigger: **both** of these true —

1. Track E merged and MiniMax's review findings resolved.
2. Characterisation coverage merged for all six untested components.

Then two to three Antigravity lanes at a time, each in its own worktree, on the
order in `docs/react-migration-spec.md` — adjusted by the one change Track C
recommends: **`executive-boards` moves earlier**, because `.mc-board-table` is
the most-shared table in the product and four views depend on it, so it proves
`<DataTable>` against the real workload rather than against `unlocked-tech`'s
single simple table. `drive-explorer` stays last regardless.

**I have not written those briefs yet, deliberately.** A component brief written
today would be guessing at the primitives' API, and every brief in this migration
that guessed has carried a factual error. They get written when Track E lands and
Grok's contracts are in — at which point they are transcription, not design.

One prerequisite that must be handled in Round 3 and not discovered in a deploy:
**`npm run build:site` does not run `vite build`.** That is correct today because
no React panel ships. The moment the first component migrates, the hosted site
would render that panel locally and be missing it in production.

---

# What applies to every lane, every round

- **Port 0**, never a fixed port. Two concurrent runs on a fixed port already
  produced a false `EADDRINUSE` failure on 2026-08-24.
- **Nothing under `server/` or `shared/`.** This whole migration is a rendering
  change. A lane that finds itself editing the backend should stop and say why.
- **Fixtures, never the live save**, in the unit suite.
- **Break every new test deliberately and show it red** before claiming it works.
- **Report exact suite counts** and explain the delta.
- **Do not merge your own lane.** Merges are sequential, and each one is verified
  against the live save before the next goes in — of nine agent runs one weekend,
  seven found a real error in the brief they were given, and in four cases the
  measurement inverted the conclusion rather than refining it.
- **Report anything in your brief that is wrong.** Every brief in this migration
  so far has carried at least one factual error, and the lanes have caught most
  of them.
