# React migration — complete

**Finished 2026-08-26. All 16 components migrated.** `public/v2/js/components/`
is empty; every panel is a React component under `src/v2/panels/`. Roughly
**8,700 lines** of vanilla component code deleted.

`npm test` exits 0, both builds succeed, and `verify_v2_navigation`,
`verify_mobile_overflow`, `verify_drive_path_modal` and `verify_drive_explorer`
all pass. One known pre-existing script failure is documented at the bottom.

---

## What was migrated

| component | lines | view | tests | defect fixed at the port |
| :-- | --: | :-- | --: | :-- |
| `mc-budget` | 187 | COMMAND | 12 | **#3** unmeasured multiplier → zero |
| `strategic-commentary` | 202 | COMMAND | 10 | **#13**, **#14** band-as-total, UNWINNABLE |
| `detail-panel` | 219 | shared | 27 | — |
| `fleet-engagement` | 260 | THREAT | 56 | — |
| `alien-hate-economics` | 329 | THREAT | 35 | — (#7 guard preserved) |
| `council-orders` | 348 | COMMAND | 20 | — |
| `unlocked-tech` | 371 | RECORDS | 31 | — |
| `executive-boards` | 415 | COMMAND | 31 | — |
| `world-map` | 542 | COMMAND | 21 | **#2** partial sum, **+ an a11y defect** |
| `intelligence-library` | 594 | RECORDS | 29 | — (#12 guard preserved) |
| `fleet-procurement` | 607 | FLEET | 85 | **#4** fabricated armour score, both directions |
| `mining-expansion` | 618 | EXPANSION | 12 | **#8** literal `null` on 109 rows |
| `directive-board` | 780 | COMMAND | 45 | — (#1, #15 guards preserved) |
| `research-advisor` | 1,067 | COMMAND | 109 | **#5** silent group cap |
| `drive-explorer` | 1,186 | DRIVES | 69 | **#6** scroll hint died after first interaction |
| `faction-intel` | 1,273 | RECORDS | 41 | — (#11 guard preserved) |

**Nine defects were fixed at the port rather than before or after it.** That is
the most useful process finding here: the person reading a component closely
enough to rewrite it is best placed to notice what is wrong with it. Queuing
defects as separate work would have found fewer of them.

---

## What it cost, honestly

Two components were **reverted and redone** after their lanes were interrupted
mid-port. One commit went out **broken** — a docs-only commit swept in two staged
deletions without their replacements, because `git commit` takes everything
staged and the `git status` output showing it was on screen, unread.

**Briefs undercounted test coverage four times running.** Every time, an agent
grepped instead of trusting the number and found more files — twice files that
would have died with `ENOENT` on deletion, once a component described as having
no tests at all when it had twelve. **"Grep before you delete" ended up worth
more than anything else in the briefs.**

---

## The procedure that worked

`tmp/migration-protocol.md` is the shared brief. Its most expensive lessons:

**1. `node --test` cannot render a React component out of the Vite bundle.**
Three runs died on `Minified React error #327` and
`Identifier 'Sv' has already been declared` before this was written down. Tests
drive a real browser through `public/v2/primitives-harness.html`.

**2. Deleting a component takes its tests with it.** Most test files load the
vanilla file *by path*. Port the assertions; never delete a test to make a suite
green. `tests/intelligenceLibraryRendering.test.js` kept all 29 green with its
component deleted, and `src/v2/panels/intelligenceLibraryUtils.js` shows the
companion move — extract pure formatters so logic assertions need no DOM.

**3. Prove parity, do not assert it.** The strongest verification restored the
deleted vanilla from `git HEAD` and diffed rendered text against the React panel
over many payloads. `faction-intel` matched byte-identically across **69
snapshots**, `research-advisor` across 34 including 88,666 characters of
tooltips, `detail-panel` across 56 captures including focus round trips and the
`inert` state of the whole page.

**4. A text diff cannot see everything.** Three defects were found only by
looking past it: `world-map` marked **all six theaters `aria-pressed="true"`**
with no data, so an absent reading announced itself to a screen reader as a
positive selection; `detail-panel`'s JSX collapsed whitespace so
`<dt>MEASURED</dt><dd>0</dd>` read as `MEASURED0`, which removes the word
boundary `verify_drive_path_modal.js` relies on and would have handed that guard
a **false pass**; and a `div`→`span` change in `drive-explorer` altered a box
model without moving a pixel.

### Definition of done

1. Vanilla component file deleted.
2. Its `<script>` tag removed from `public/v2/index.html`.
3. **The vanilla file no longer *supplies* the old global.** It is fine — and is
   the pattern — for `mission-control.js` to keep calling
   `window.MissionControlFoo.render(...)` while the React bridge takes over that
   same global name. What must not happen is file, script tag *and* call site all
   still live, so vanilla renders and React is never reached.
4. The harness scene **renders the panel**, not an empty wrapper.
5. Every existing test still passes, ported rather than deleted.
6. Both builds succeed, **and tests were run after building**.

### Verification, run centrally

Several agents writing concurrently makes any shared check measure a mixed tree.

```bash
npm run build && npx vite build --config vite.primitives.config.mjs
npm test
node scripts/verify_v2_navigation.js
node scripts/verify_mobile_overflow.js
node scripts/verify_drive_path_modal.js
node scripts/verify_drive_explorer.js
```

**Computed-style diff** — take BEFORE from a `git stash` against HEAD so the
comparison is the change alone. The probe save must be **backdated so it is not
the newest file**, or the server renders it regardless and the test proves
nothing. Delete it afterwards; it appears in the in-game load list.

**A count mismatch suppresses per-element style comparison.** When element counts
differ the differ cannot certify those views, so check the register by hand —
`mining-meas`/`mining-est`, `fe-meas`/`fe-est`, `de-measured`/`de-estimate` —
comparing computed colour and `font-style` between captures.

---

## Known issues left behind

| # | issue |
| :-- | :-- |
| **#17** | Four fabricated fallbacks in `DirectiveBoard.jsx`, carried across **deliberately** — a port whose bar is "no figure may change" cannot fix one without violating that bar |
| **#18** | `typeScale.test.js`'s inline-font-size guard walks `public/v2/js` and matches `.js`, so it now covers **no component** |
| **#19** | `<Value>` emits a `<span>` and cannot be used inside `<svg>`, so `world-map` restates the presence contract locally — two implementations of one rule |
| **#20** | `fleet-procurement`'s refit half renders **nothing** for three unrelated causes including a dead endpoint, beside a procurement half that says so — live-reachable |
| — | `vite.config.mjs` sets `emptyOutDir: true` on a directory the primitives harness also writes to, so any `npm run build` deletes the harness bundle |

`scripts/verify_research_vs_procurement.js` **fails, and did before the
migration** — measured at the pre-wave commit it produces the byte-identical
3,329px / 3.082 screens. It enforces a 3.00-screen COMMAND ceiling where
`verify_mobile_overflow.js` uses 3.25 and passes. Two scripts, two ceilings, one
view; `docs/README.md` records the same disagreement for a sibling script.

**Also outstanding and unrelated:** the defect #9 fix is committed but **never
published**, so the hosted site still serves priority targets with 91% of records
dropped. Running the publisher is a local action requiring the service-role key.

---

## Lane findings, measured

The first five waves ran on external CLI lanes; the last three on Claude Opus
agents, which was markedly cleaner — every agent could run its own tests.

- **Codex** — the only external lane to complete a port unaided. Its apparent
  slowness was **configuration, not the lane**: it inherited `gpt-5.6-sol` at
  `model_reasoning_effort = "max"` from `~/.codex/config.toml`, because the
  wrapper passed no `-m` flag at all. Now pinned to `gpt-5.6-luna` in
  `check_lanes.js`, and the old timings need re-measuring before they are trusted.
- **Antigravity** — hard **~5-minute response ceiling**; errored at 292s having
  consumed 423k tokens and written nothing. Cannot do component migrations.
- **Composer** — good structure, **cannot execute shell**, so it cannot verify
  what it writes. Shipped an empty harness scene (31 tests timing out) and a
  failing assertion whose message contradicted its own code.
- **MiniMax** — twice left work structurally incomplete: once swallowing
  `const UNAVAILABLE = '—'` from five files while leaving `shared.js`
  unparseable, once building a panel without performing the swap.
- **DeepSeek** — best evidence discipline; produced a better design than the
  brief asked for and found a call site the brief missed. Metered.
