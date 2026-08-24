# Post-split cleanup — four follow-ups from the UI branch

Written 2026-08-24 against `design/command-layout` @ `2e79fc1`. Lands on that same
branch, not main.

Four of the eight follow-ups recorded during the weekend's UI work. The other four are
environment quirks or judgement calls and are deliberately excluded — see the bottom.

**One of the four is smaller than its follow-up claims and the spec says so.** Do not
take the recorded counts on trust; they are corrected below.

---

## 1. `docs/code-index.md` cannot see the stylesheet

`scripts/generate_code_index.js:19-29` lists six `SOURCE_ROOTS` and
`EXTENSIONS = new Set(['.js', '.mjs'])`. CSS is not a source root and `.css` is not an
extension, so **24 files and ~208 KB — the largest artefact in the frontend — have no
entry, no `Purpose:` line, and nothing for an agent told to read the index first.**

This matters more after the split than before. One file was findable by name; 24 numbered
parts are not, and the ordering is load-bearing (`05-view-grid.css` before
`15-responsive.css` is a measured dependency — moving it reverts `.init-view__grid` at
375px and grows the page 72px).

### What to build

Give the index a CSS section. Per file: path, line count, and a hand-written `Purpose:`
line, exactly as the JS entries carry.

Decisions to make and state:

- **Where the `Purpose:` comes from.** Every part already opens with a header comment
  naming what it styles and its source range. Either parse that or add an explicit
  `Purpose:` line to each header; parsing is less duplication but couples the generator to
  a comment format. Pick one and say why.
- **Whether `tests/codeIndex.test.js` should enforce a purpose line for CSS** the way it
  does for JS. If yes, all 24 need one before the test can pass.
- **Whether load order is recorded.** The numeric prefix carries it today, but the index is
  where an agent looks first, and "these are in cascade order and the order is load-bearing"
  is exactly the kind of thing this file exists to say.

**Constraint:** `npm run index` currently regenerates with **no diff**. After this it must
still be idempotent — run it twice and the second run changes nothing.

---

## 2. Stale references to `mission-control.css` — **the count is wrong**

The follow-up says "nine comments and docs still name `mission-control.css`, which no
longer exists." **Measured: 18 references, and all but one or two are deliberate and must
not be touched.**

**Correct as history — leave alone:**

| Where | Why it stays |
| --- | --- |
| all 24 CSS part headers | `Source: mission-control.css lines N-M before the 2026-08-23 split` — provenance, and the only record of where each slice came from |
| `public/v2/index.html:10` | explains the 24 `<link>` tags to the next reader |
| `tests/fixtures/missionControlCss.js:10` | explains why the helper is named that |
| `scripts/verify_mining_registers.js:9`, `verify_drive_explorer.js:9` | past tense — "was once defined self-referentially in mission-control.css". Historically accurate. |
| `docs/archive/**` | archived records. `CLAUDE.md` treats archive paths as load-bearing. |
| `docs/chain-visibility-spec.md`, `research-tab-layout-spec.md`, `research-vs-procurement-spec.md` | shipped specs recording what was measured **at the time**. `docs/README.md`'s own convention: specs record what was measured, and superseded reasoning stays rather than being deleted. |

**Genuinely stale — fix:**

- `public/v2/js/components/world-map.js:38` — *"`--fs-map-note` in mission-control.css so
  the CSS-driven labels agree"*. The token is in `01-tokens-and-base.css`. This one points
  at a **live path that no longer exists**, so a reader acting on it goes looking in a file
  that is not there.

Sweep for any others of that shape — a reference telling someone where a thing *is*, as
opposed to where it *was*. **Report the count you find; if it is one, say one.** Correcting
the follow-up's number in `docs/README.md` is part of the work.

---

## 3. THREAT's two table cards want more than a half-track

Measured at 1600px, both modes: the two cards want **782px and 784px** and get **732px**.
The scroll hints announce it truthfully, so nothing is lying — but two tables clip by
~50px on a common width.

This is **genuine content demand**, the opposite of the grid-starvation defect fixed in
`3660c98`. There the track was wider than the content; here the content is wider than the
track. **Do not "fix" it by widening tracks — that was the previous bug's shape.**

### The decision

Options, none obviously right:

- **Make them `.init-view__span`** (full width, one above the other). Costs vertical space
  on a view that is already tall, and THREAT at 1920 is not currently near the screen
  budget — check it.
- **Reduce what the tables carry** at that width — fewer columns, or abbreviated headers.
  Changes information, so it needs a reason beyond fit.
- **Leave it.** 50px of truthful, announced horizontal scroll on two tables is not the
  worst outcome, and the hint system exists for exactly this.

**Measure before choosing**, at 1440 / 1600 / 1920 in both modes, and report the screen
count for whichever option you take. If the answer is "leave it", say so with the numbers
— that is a valid outcome and cheaper than a change that trades clipping for scrolling.

---

## 4. Two naming/placement debts from the split

Both were deliberate at split time: a slice needs no argument, a move needs one, and the
split's whole claim was that nothing moved. That claim is now banked, so these can move.

**`.mc-skill-*`** lives in `16-board-skill-cells.css` — 34 lines — while the
`.mc-board-*` rules it belongs with are in `12-executive-boards.css`. The source declared
it ~1,500 lines later, hence the separate slice.

A mutation during the split swapped `15` and `16` and came back **green**, which is
evidence its position is not load-bearing **at the one state measured** — explicitly not
proof. So: prove it properly before merging, across the width and mode matrix, or leave it.

**`.faction-intel-*`** names two unrelated surfaces: the COMMAND teaser card (now in
`09-detail-panel.css`) and the faction dossier overlay (`13-faction-intel.css`). One prefix,
two components, in two files. Renaming touches JS, CSS and tests together.

**Both are cosmetic.** If either turns out to cost more than it returns, say so and leave
it — a rename that risks a live surface to satisfy a naming convention is a bad trade.

---

## Constraints for all four

- **Nothing user-visible may move**, except where item 3 deliberately decides otherwise.
  Capture computed style at 1440 and 375 in both modes across the six views before and
  after, and diff. The split's harness already does this — reuse it rather than rebuilding.
- **Cascade order is load-bearing.** Any file that moves or is renamed must keep its
  position in the shell's `<link>` order, and `assertStylesheetManifest()` must still pass
  in both directions.
- `scripts/verify_mobile_overflow.js`, `verify_drive_explorer.js`,
  `verify_mining_registers.js`, `verify_v2_navigation.js` must pass; report their numbers.
- COMMAND stays under 3.00 screens at 1920 — currently **2.82 player / 2.92 omniscient**,
  and the margin is thin.
- `verify_research_tab_layout.js` **already fails at 3.020 screens** and predates all of
  this. Confirm it is unchanged; do not fix it here.
- Every new test broken deliberately first.
- Full suite green with exact counts. Baseline on the branch is **1398 tests / 1397 pass /
  0 fail / 1 conditional skip** (a worktree reports 2 — the second is the absent `dist/`).
- Update `docs/README.md` in the same commit, removing the follow-ups closed and
  **correcting the count in item 2**.

## Deliberately excluded

- **A worktree has no `config.json` / no `dist/`.** Environment, not defects.
- **24 `<link>` tags is 24 requests.** Multiplexed on HTTP/2; revisit only if waterfalling
  is observed, and `@import` is the wrong fix (it serialises).
- **`verify_research_tab_layout.js` at 3.020.** Pre-existing and a content-length problem —
  the SITREP runs ~105 characters per line against a 45–75 comfortable range, and fixing
  the measure makes it taller. Its own change.
