# Tests Must Not Depend on the Live Save

Written 2026-08-21 against `5b55636`.

---

## The defect

`tests/markdownExports.test.js` asserts that `/latest-snapshot.md` is **byte-identical to a frozen baseline**, to prove a refactor changed nothing. It reads the save like this:

```js
const playerSnap = loadFilteredSnapshot({ mode: 'player', observer: 4712 });
```

No `savePath`. **That loads the newest save.** So the test compares live output against a static fixture and fails the moment the player plays — the observed diff was exactly one line:

```
-**Date:** 1/1/2034 12:00:00 AM
+**Date:** 2/16/2034 12:00:00 PM
```

An implementer hit the failure, regenerated the fixture from current output, and the suite went green. That is the correct-looking move and it destroys the only thing the test was for: a fixture captured from post-change output passes by construction. `CLAUDE.md` records this as "a test that only passes proves nothing".

The test cannot do its job as written. Its intent is *prove the renderer did not change*; what it measures is *prove the save did not change*, which is guaranteed to fail during normal play.

**17 call sites across 5 test files** load the live save with no `savePath`:

```
tests/markdownExports.test.js   10
tests/snapshotLoader.test.js     2
tests/miningExpansion.test.js    2
tests/holdGround.test.js         2
tests/markdownBudget.test.js     1
```

Not all are wrong — a smoke test that the endpoint runs against whatever save exists is legitimate. A test asserting an **exact value** is not.

## The constraint

A frozen `.gz` save **cannot be checked in**: `.gitignore` excludes `*.gz`, and `CLAUDE.md` forbids committing save files. So the fix is not "pin to a frozen save file".

Two patterns already exist in the repo for this:

- **`tests/fixtures/propulsionSample.json`** (60 KB) — real data extracted from a save into JSON and committed. The propulsion ΔV guarantee test uses it, so it validates the model without reading a save at all.
- **`tests/fixtures/syntheticSave.js`** (10 KB) — a constructed snapshot with controlled contents.

## What to do

**1. Classify all 17 call sites** as *exact-value* or *smoke*.

**2. Exact-value assertions must not read the live save.** Convert each to one of:
   - a committed JSON fixture, following `propulsionSample.json`;
   - a synthetic snapshot, following `syntheticSave.js`.

   Prefer synthetic where the assertion is about renderer behaviour rather than real data — it is smaller, and it states its own preconditions.

**3. Smoke tests may keep reading the live save**, but must **skip cleanly when it is absent or locked**, never fail. `CLAUDE.md` records three tests that previously read machine-local state and one that failed `EBUSY` mid-write; the skip pattern already exists in the suite.

**4. Regenerate the byte-identical baseline once, correctly.** Capture it from the fixture or synthetic source the test will use from now on, then **prove it non-vacuous**: break the renderer deliberately, confirm the test fails, restore. A baseline that has never been seen to fail is not a baseline.

**5. Leave a comment at the fixture explaining why it is not regenerable on demand** — the next person to hit a red test will otherwise reach for the same regeneration that caused this.

## Acceptance

- `npm test` passes with the live save folder **renamed or unreadable**. Exact-value tests must not depend on it existing.
- The suite passes twice in a row with a game save occurring between runs — the condition that currently breaks it.
- The byte-identical test is proven to fail on a deliberate renderer change.
- No test fails, as opposed to skipping, because of live-save state.
- No `.gz` is added to the repo.

## Note

This is why the current `785/785 passing` is weaker evidence than it looks: some of it is passing against a fixture that was regenerated to match. That is not an accusation of anyone — it is the predictable outcome of a test that asks an impossible question.
