# Tests must not read the live save

Written 2026-08-24 against `design/command-layout` @ `ce9f2a1`.

Playing the game breaks the build. On 2026-08-24 three autosaves landed at 18:32–18:56 and
**12 tests went red** on a branch that had been green — none of them because any code
changed. Proven by stashing the working tree and re-running: the clean branch failed
identically.

That is not a flaky test. It is a suite that reads mutable external state.

---

## The scale, measured

| | |
| --- | --: |
| test files | 74 |
| **read the live save** | **17** |
| already use committed fixtures | 31 |

**The infrastructure already exists and most of the suite already uses it**:
`tests/fixtures/snapshot-player.json`, `snapshot-omniscient.json`, `syntheticSave.js`,
`frozen-snapshot-{player,omni}.md`, `propulsionSample.json`, `templates/`.

So this is a **migration, not a construction project**. Seventeen files took a shortcut.

### The seventeen

```
controlPointCap.test.js        (20 live calls)   mineModuleOutput.test.js   (15)
miningTechBonus.test.js        (10)              refitAdvisor.test.js        (7)
spaceMiningBonus.test.js        (7)              snapshotLoader.test.js      (5)
miningExpansion.test.js         (4)              markdownExports.test.js     (3)
researchRanking.test.js         (3)              snapshotLoaderIntegrity     (3)
holdGround.test.js              (2)              researchCategoryBonus       (2)
techGraph.test.js               (2)              driveExplorer.test.js       (1)
drivePathModal.test.js          (1)              fleetEngagement.test.js     (1)
riskTolerance.test.js           (1)
```

Currently failing (all save-dependent, none related to any code change):

```
controlPointCap  x5    techGraph / tech-path  x3    drivePathModal  x1
markdownExports  x1    refitAdvisor           x1    redaction scan  x1
```

---

## The split

**Not every one of the seventeen should become a fixture test.** Some are genuinely
integration tests — *"does this still hold against a real current save"* — and that has real
value: several defects this weekend were caught precisely because a test met live data
(the shipyard `hull` field misnomer, the unpowered-mine reconciliation, the fallback-observer
roster leak). Deleting that coverage to get green would be trading a real signal for a
comfortable one.

**The defect is not that live tests exist. It is that they gate `npm test`.**

So, three buckets. Classify each of the seventeen and state which bucket and why:

### A — migrate to a committed fixture

The default. The test asserts a **behaviour** and merely needed *a* snapshot to exercise
it. These move to `snapshot-player.json` / `snapshot-omniscient.json` or a purpose-built
fixture, and become deterministic.

Most of the seventeen are this. A test asserting that satisfied prerequisites are reported,
or that a redaction scan finds no leak, does not need *today's* save — it needs *a* save.

### B — synthetic fixture, purpose-built

The test needs a shape the real save does not currently contain — an over-cap faction, an
unpowered mine, a null measurement, a design with no hull in service. `syntheticSave.js`
already exists for this. Several tests currently assert "0 of 427 rows are unreadable,
so this guards a shape that does not occur today" — that is a fixture waiting to be
written, and it is stronger than the live assertion it replaces.

### C — stays live, moves out of `npm test`

The test's *purpose* is contact with real current data. Keep it, label it, and run it on
demand: `npm run test:live`.

These must **skip loudly, not fail**, when no save is available, and must say which save
they ran against in their output. A live test that silently passes because it read nothing
is the vacuous-test failure this repo already has scars from.

**Judgement:** if a test in bucket C fails after a new autosave, that is *information* —
the game state moved somewhere the model does not cover. It should be readable as that,
not as a broken build.

---

## The guard

Once migrated, make the mistake unrepeatable. A test that reads the live save must not be
able to land in the unit suite again by accident.

The mechanism is yours to choose, but it must be **structural rather than a convention**:
a lint rule, a directory split (`tests/` vs `tests/live/`), or a unit-suite guard that fails
if any file it loads calls the live loaders. Whatever you pick, **prove it**: add a file
that reads the live save into the unit suite and confirm the guard goes red.

`CLAUDE.md`'s existing instruction — *"capture against frozen saves copied to disk,
MD5-verified"* — is a process rule written to route around this defect. **Once the guard
exists, that instruction should be narrowed to where it genuinely belongs** (before/after
refactor captures) rather than standing as blanket advice for a problem the suite no longer
has.

---

## Constraints

- **No assertion may weaken.** A test that moves to a fixture must assert the same
  behaviour. If a figure was pinned to today's save and the fixture's figure differs, the
  test asserts the *fixture's* value — and if the assertion only held because of a
  coincidence in live data, say so; that is a finding.
- **Prove each migrated test can still fail.** Break the code deliberately, confirm red.
  A fixture test that passes against any input has lost the coverage it was migrated to
  preserve.
- **Fixtures must be committed and stable.** No generating one at test time from the live
  save — that reintroduces the defect with extra steps.
- **Say what each fixture is a snapshot of** — which save, which date, which mode — in a
  header. A fixture whose provenance is unknown cannot be re-derived when the schema moves.
- Both modes wherever the original covered both.
- `npm test` must be **green and deterministic**: run it twice with the game running and
  get identical results.
- `npm run test:live` documented in `docs/README.md` and `CLAUDE.md`, including that it is
  expected to fail sometimes and what that means.

## Acceptance

- **`npm test` passes with the game running**, twice in a row, identically.
- Every one of the seventeen is classified A / B / C with a stated reason.
- The guard rejects a live-save read added to the unit suite — demonstrated, not asserted.
- Bucket C tests skip loudly with no save, and name the save they used when there is one.
- Full suite green with exact counts, and the count delta explained.
- `docs/README.md` and `CLAUDE.md` updated in the same commit.

## Out of scope

- The 12 current failures are **not** to be fixed by adjusting their expected values to
  today's save. That is the same defect wearing a different hat. They are fixed by
  migration, or by moving to bucket C where a failure is legible.
- `verify_*.js` scripts are not tests and are not in scope; they drive a live browser
  deliberately and are invoked by hand.
