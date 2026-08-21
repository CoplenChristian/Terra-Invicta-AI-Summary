# Code Index

A required-reading map of what lives where, so an agent stops guessing.

Written 2026-08-21 against `e3bb85e`.

---

## Why

The repo is **201 source files across 16 directories**. An agent asked to "fix the mining scoring" currently has to choose between `shared/intel/mining.mjs`, `shared/intel/miningExpansion.mjs` and `server/miningExpansion.js` by reading all three. Observed agent transcripts routinely open a dozen files before editing one.

Worse, several entry points are **barrels** and look like implementations from their names:

```
server/snapshotBuilder.js     113 lines   barrel over server/snapshot/*
shared/intelResources.mjs     147 lines   barrel over shared/intel/*
server/index.js                95 lines   composition root over server/http/*
server/requestValidation.js   112 lines   barrel over shared/requestValidation.mjs
```

An agent told to "edit `snapshotBuilder`" opens it, finds no reducer, and either edits the barrel or goes hunting. This has already caused a real failure: an implementer built 987 lines against `server/index.js` as a 737-line monolith when it had been split hours earlier, and the work was unusable.

Modularity was supposed to make the code navigable. It only does if something says where things are.

## The trap to avoid

**A hand-maintained index will drift and then be worse than nothing**, because agents will trust it. This repo has already been bitten by exactly that: `shared/intel/registry.mjs` carried three hand-maintained parallel lists that disagreed, and the fix was to derive all three from one table.

So: **derive everything derivable; hand-write only what cannot be derived; fail a test when the two disagree.**

| derived | hand-written |
| :-- | :-- |
| path, line count, module system (ESM/CJS) | **one-line purpose** |
| exported names | do-not-edit markers |
| barrel vs implementation | which directory owns a domain |
| which runtime may use it | |
| the file's test file, if one exists | |

A module with no hand-written purpose line **fails the test**. That is what stops the index rotting: adding a file forces a one-line description or the suite goes red.

## Detection notes

Barrel detection must handle both module systems. ESM barrels are `export … from`, which is easy. **CommonJS barrels are not** — `server/snapshotBuilder.js` re-exports by assigning imported function objects onto a prototype and scores zero on a naive `export…from` scan:

```js
Object.assign(SnapshotBuilder.prototype, { readShipCombatPower: space.readShipCombatPower, … });
module.exports = new SnapshotBuilder();
```

A more reliable signal for both: **a file that imports several local modules and defines few or no functions of its own**. Verify the classifier against the four known barrels above before trusting it.

## What the index must carry

For each module: **path · purpose · barrel? · runtime · exports · test file**.

Runtime matters and is not obvious from the path:

- `shared/**` is ESM and must work in **both** Node and the Cloudflare worker — no `fs`, no `require`, no `Buffer` (`shared/markdownExports.mjs` hand-rolls a UTF-8 counter for exactly this reason).
- `server/**` is CommonJS, Node-only, may read the filesystem and templates.
- `site/worker/**` is ESM, worker-only, **cannot import CommonJS** — the reason `shared/requestValidation.mjs` exists at all.
- `public/v2/**` is browser; `public/index.html` is **legacy v1 and must not be edited**.

Also record, because these are the traps that have actually cost time:

- **Templates are baked at snapshot-build time**, not read at request time — the worker has no template directory. `server/snapshot/templates.js` is the precedent.
- **Which panel mounts where**, and that `assertViewRegistryIntegrity()` will fail loudly on a mismatch.

## Where it lives, and how it becomes required reading

`CLAUDE.md` is what agents read, and it is already long. So: generate `docs/code-index.md`, and add a short pointer in `CLAUDE.md` making it required before editing — one paragraph, not the index itself.

Every spec handed to an agent should cite it the way specs currently cite `CLAUDE.md`.

## Acceptance

- `npm run index` (or equivalent) regenerates `docs/code-index.md` deterministically — same tree, byte-identical output.
- A test fails when the checked-in index differs from a fresh generation. This is the staleness guard and it is the point of the whole exercise.
- A test fails when a source module has no hand-written purpose line.
- All four known barrels are classified as barrels; a spot-check of implementations is not.
- Each module's runtime is stated and correct — verify `shared/**` entries claim both runtimes and `server/**` do not.
- `public/index.html` is marked do-not-edit.
- The index is under 400 lines. If it is longer than that nobody reads it, and an unread index is a hand-maintained index with extra steps.

## Note

The best existing example is the header comment of `server/snapshotBuilder.js`, which already maps each `server/snapshot/*.js` to its responsibility in nine lines, and explains *why* the split happened. Those comments are the hand-written half — the generator should read them where they exist rather than asking for the same sentence twice.
