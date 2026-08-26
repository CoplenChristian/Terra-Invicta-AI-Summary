# React migration — progress and handoff

**State as of 2026-08-26. Last green commit: see git log.**

`npm test` exits 0, both builds succeed, `verify_v2_navigation.js` reports 0
console and 0 network errors, `verify_mobile_overflow.js` passes with 0
unreachable content and COMMAND at 3.05 screens against a 3.25 budget.

**11 of 16 components migrated.**

---

## Done

| component | lines | view | tests | fixed en route |
| :-- | --: | :-- | --: | :-- |
| `mc-budget` | 187 | COMMAND | 12 | **#3** unmeasured multiplier → zero |
| `strategic-commentary` | 202 | COMMAND | 10 | **#13**, **#14** band-as-total, UNWINNABLE |
| `fleet-engagement` | 260 | THREAT | 42 + 14 | — |
| `alien-hate-economics` | 329 | THREAT | 14 + 21 | — (#7 guard preserved) |
| `executive-boards` | 415 | COMMAND | 25 + 6 | — |
| `council-orders` | 348 | COMMAND | 14 + 6 | — |
| `intelligence-library` | 594 | RECORDS | 29 | — (#12 guard preserved) |
| `mining-expansion` | 618 | EXPANSION | 6 + 6 | **#8** literal `null` on 109 rows |

## Left, in suggested order

| component | lines | tests | blocker / note |
| :-- | --: | --: | :-- |
| `world-map` | 542 | 16 | **partial work exists** — see patch below |
| `research-advisor` | 1,067 | 63 | **partial work exists** — see patch below |
| `directive-board` | 780 | — | no dedicated test file |
| `drive-explorer` | 1,186 | 46 | carries unfixed **defect #6** |
| `faction-intel` | 1,273 | 36 | largest component in the app |
| `unlocked-tech` | 371 | **none** | needs characterisation FIRST |
| `fleet-procurement` | 607 | **none** | needs characterisation FIRST; unfixed **defect #4** |
| `detail-panel` | 219 | none | **do last** — 7 external DOM reaches |

`detail-panel` is smallest by line count and hardest by coupling: it is the
shared dialog every clickable module opens, so a mistake there breaks all of them
at once rather than one panel.

`unlocked-tech` and `fleet-procurement` have **no tests at all**. Characterisation
must be written against the *vanilla* component and confirmed passing **before**
the port — a fixture captured from post-change output passes by construction and
proves nothing. This is the one place test work genuinely gates the migration
rather than trailing it.

## Uncommitted work from the interrupted wave 5

`tmp/wave5-incomplete.patch` (155 KB, gitignored) holds a `world-map` port and a
partial `research-advisor` port. **Both were reverted deliberately**, not lost:

- `world-map` was fully wired — vanilla deleted, script tag removed, mounted at
  `main.jsx:269` — but had **1 of 16 tests failing** when its lane was stopped.
- `research-advisor` was **half-migrated and live**. `main.jsx` assigns
  `window.MissionControlResearchAdvisor`, and the React bundle loads at
  `index.html:641` *after* the vanilla script at `:632`, so the React panel
  overrides the vanilla global. A partial port in that position is not dormant —
  it is what renders.

Re-applying the patch is optional. Redoing either from scratch is likely cheaper
than debugging an interrupted run.

---

## The procedure that works

`tmp/migration-protocol.md` is the shared brief. Its two most expensive lessons:

**1. `node --test` cannot render a React component out of the Vite bundle.**
Three runs died on `Minified React error #327` and
`Identifier 'Sv' has already been declared` before anyone wrote this down. Tests
drive a real browser through `public/v2/primitives-harness.html`. Copy an
existing pair, e.g. `src/v2/panels/FleetEngagement.jsx` +
`tests/fixtures/fleetEngagementBrowser.js`.

**2. Deleting the component takes its tests with it.** Most existing test files
load the vanilla file *by path*, so deleting it kills them with `ENOENT`. This
broke three lanes across two waves. **Port the assertions, never delete them** —
`tests/intelligenceLibraryRendering.test.js` kept all 29 green with its component
deleted, and `src/v2/panels/intelligenceLibraryUtils.js` shows the companion
move: extract pure formatters so logic assertions need no DOM.

### Definition of done — six items, each of which a lane has missed

1. Vanilla component file deleted.
2. Its `<script>` tag removed from `public/v2/index.html`.
3. `mission-control.js` no longer calls the old global.
4. The harness scene **renders the panel** — one lane shipped
   `<div data-testid="x"><div id="x-root"/></div>` with nothing mounted into it;
   an empty wrapper has zero height, so Playwright reports it hidden and every
   test times out.
5. Every existing test still passes, ported rather than deleted.
6. Both builds succeed **and tests were run after building** — a stale harness
   bundle produces exactly the same timeout as a broken scene.

### Verification, run centrally rather than per-lane

With several lanes writing concurrently, any shared check measures a mixed tree.
Run these yourself after a wave lands:

```bash
npm run build && npx vite build --config vite.primitives.config.mjs
npm test
node scripts/verify_v2_navigation.js
node scripts/verify_mobile_overflow.js
```

**Computed-style diff** — capture BEFORE from a `git stash` against HEAD so the
comparison is the change alone:

```bash
# copy a save into the save folder and BACKDATE it so it is NOT the newest file,
# or the server renders it regardless and the test proves nothing. Confirm: ls -lt
node scripts/verify_computed_style_baseline.js --save <name>.gz --capture before.json
node scripts/verify_computed_style_baseline.js --save <name>.gz --capture after.json
node scripts/verify_computed_style_baseline.js --diff-files ...before.json ...after.json
```

**A count mismatch suppresses per-element style comparison.** When element counts
differ the differ cannot certify those views, so check the register by hand —
`mining-meas` vs `mining-est`, `fe-meas` vs `fe-est` — comparing computed colour
and `font-style` between captures. Delete the probe save afterwards; it appears
in the in-game load list.

---

## Lane findings, measured today

Recorded because each cost at least one wasted run.

- **Codex** — the only lane to complete a port unaided, and **slow**: 1,664s for
  618 lines, with an earlier 900s attempt writing nothing. Budget 30+ minutes.
  Two migrations plus a repair exhausted its 5-hour window entirely. **Set to
  `reject` at the user's request on 2026-08-25.**
- **Antigravity** — hard **~5-minute response ceiling**; errored at 292s having
  consumed 423k tokens and written nothing. **Cannot do component migrations.**
  Good for defect fixes and short scoped edits.
- **Composer** — good structure, **cannot execute shell**, so it cannot verify
  anything it writes. It shipped an empty harness scene (31 tests timing out) and
  a failing assertion whose message contradicted its own code. Always budget a
  verification pass elsewhere.
- **MiniMax** — capable, but has twice left work structurally incomplete: once
  swallowing `const UNAVAILABLE = '—'` from five files while leaving `shared.js`
  unparseable, once building a panel without performing the swap. Demand a
  deleted-line audit and a compact report.
- **DeepSeek** — best evidence discipline of the group; produced a better design
  than the brief asked for on defect #16 and found a fetch site the brief missed.
  Metered.

**Next session uses Claude Opus agents** rather than external lanes, giving the
provider quotas time to reset.

---

## Also outstanding, unrelated to the migration

**The defect #9 fix is committed but never published.** It drops 91% of priority
target records and is the only defect that reached the AI markdown exports and
the hosted worker. The live site still serves the truncated version until the
publisher is run — a local action requiring the service-role key.

The defect register (`docs/live-defect-register.md`) stands at **16 entries: 12
fixed, 0 live, 4 conditional** (#4, #6, #8 partially, #10). Two of the four are
inside components still awaiting migration and should be fixed at the port rather
than before it — seven of the twelve already fixed were closed that way.
