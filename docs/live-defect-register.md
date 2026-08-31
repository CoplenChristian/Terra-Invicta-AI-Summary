# Live defect register — found by the contract analysis, 2026-08-24

Written against `main` @ `6368c88`. These are **shipped defects in the current
dashboard**, found while writing the React component contracts. None is caused by
the migration and none is currently anyone's lane.

They are here rather than in the contracts doc because they need a priority
decision, and because **a faithful React port would carry every one of them
across.** That is the migration-relevant part: a rewrite that reproduces the
current output exactly reproduces these too.

Confidence is stated per defect. "Confirmed" means read in source by Claude at
the cited lines. "Demonstrated" means executed. "Confirmed reachable" means the
producer's own contract permits the input, but it does not occur on the current
save.

> **Read entry headings as historical, and this header as current.** Each entry
> records the state *when it was found*, including its confidence word and its
> file path. The React migration deleted every `public/v2/js/components/*.js`
> file, so **every path cited below now points at a deleted file** — the code
> lives in `src/v2/panels/` — and several entries still say "confirmed" for
> defects since fixed. The per-entry text was left as written rather than
> rewritten in place, because an entry that quietly changes its own history is
> worth less than one that is out of date in a stated way.
>
> **The tally and the live list immediately below are the authoritative status.**
> Use `git log` on the named commit to see what a fix actually changed.

**Tally as of 2026-08-30: 26 entries — 25 fixed, 1 live, 0 conditional.**

**Fixed:** #1 and #9 shipped earlier. #3 was fixed in the `mc-budget` React
migration (`2c1427f`) rather than ported, having first been **demoted** to
latent when its supporting claim turned out to be false — see the correction
there. **#7, #11 and #12** (`7a48add`) were verified by reverting each component
with the new tests in place and confirming exactly one test failed per file.
**#13 and #14** were fixed in the `strategic-commentary` migration (`5d29c5f`),
again as part of the port rather than carried across. **#16** is closed: two
captures of the same pinned save now diff to **0**, down from 2,485.

**#6 was fixed** in the `drive-explorer` React port (2026-08-26). Its root cause
was finally named: `paint()` rebuilt the panel with `innerHTML` and replaced
`.de-scroll-hint` with a fresh element, while `syncScrollHints` — the thing that
measures overflow — lives in `mission-control.js` and was never called by the
component at all.

**#4 was fixed** in the `fleet-procurement` port, in **both** directions. The
register had recorded only the red "15.2× behind" half; the port found that an
unrecognised **recommended** armour produced `0.066`, failed the `> 1.0` test,
and rendered **no badge at all** — silence from a fabricated number, the same
defect wearing the opposite sign.

**#10 was fixed 2026-08-26** (`da8581e`). 462 renames applied from the game's own
localisation files, 107 fallen back, 70 refused as ambiguous. The user's
"Neutron Flux Lantern" now reads **"Poseidon Lantern"**, and a search for
"Poseidon" — which previously returned *nothing* — returns 12 of 12.

**#19 and #20 were fixed the same day** (`a0eabef`, `d71613e`), and **#18** and
the `emptyOutDir` build race in `95eee95`.

**#26 was fixed 2026-08-27** — the live-save guard is now behavioural, and the
fix named five live-save readers the source scan had missed (see the #26 entry
below). Three were the same shape as the defect itself: tests that read the save
through a server or helper, invisible to any source-text scan. The guard that
found them is now the enforcement: it runs the suite against a folder that is
not there, so the next reader of any shape fails loudly and names itself.

**Live right now: nothing. #21 closed 2026-08-31.**

> Every entry in this register is fixed. That is a first, and it is worth being
> suspicious of rather than pleased about — the audit below found seven entries that
> had been fixed for weeks without anyone noticing, so "no live defects" has been
> true before while the register said otherwise.
>
> **What is genuinely open lives elsewhere**, deliberately, because it is not defect
> work: two ship-designer unknowns that need one look at the running game (`Calc`
> cooling on 186 of 541 drives, and confirming the 0.1 units/ton cost rate), and two
> **latent** items measured as not-currently-reachable — `power()` in
> `driveExplorerUtils.mjs` using `toFixed(3)` below 1 (zero of 487 drives would render
> `0.000`), and `executiveFactionName || 'None'` in `IntelligenceLibrary.jsx` (the
> snapshot already emits the literal `"None"` for all 167 unclaimed nations).

> **AUDIT, 2026-08-30. Seven entries said "live" and none of them were.**
> #11, #12, #13, #15, #17, #24 and #26 were all verified fixed against the current
> source on the same day, each with its evidence recorded in its own entry.
>
> **The cause is knowable rather than mysterious**: `docs/README.md` records that the
> React migration "fixed nine defects at the port rather than separately." Nine were
> fixed; the register was not told. A defect fixed as a side effect of other work is
> exactly the kind that never gets its entry closed.
>
> **This mattered.** A register that overstates what is broken sends future work at
> problems that no longer exist — three of these were queued as candidates before the
> audit. One that understates it is worse, so the fix is not to trust it less but to
> re-verify entries against the source before acting on them, the way a recalled
> memory naming a file is checked before it is recommended.
>
> Method, if this needs repeating: read the entry's named file path first. On five of
> seven it **no longer existed** — the logic had moved into `src/v2/` at the port —
> which is itself the strongest signal that the entry predates a rewrite of the code
> it describes.

- **#17** — **FIXED 2026-08-30.** All four fabricated fallbacks and the three
  latent `?? 0` were fixed earlier; the upper-bound half followed the same day.
  `jointlyAffordableIsUpperBound` now renders beside the joint-affordability
  count on the directive board when `true`, and in war-room §10 via
  `shared/markdownExports.mjs` gated on the same flag — never when `null`.
  See the entry for the audit trail.
- **#21** — the em-dash affordance hand-written in eleven panels. Not urgent:
  the rendered output is correct today, and the cost is that the rule holds by
  convention rather than by structure. **Three of the eleven are done** —
  Intelligence Library (`c52b9de`), Executive Boards, and **Fleet Engagement
  (2026-08-28, the first slice to fold the MUI move in with the `<Value>`
  conversion)**. A first attempt at Intelligence Library was reverted earlier that
  day, having made per-metric measurement state cascade across rows — the exact
  property those tests defend. What fixed it on the retry was a sharper brief, not
  a better tool: one panel instead of eleven, the failure named, and the catching
  tests pointed at.

  **The Fleet Engagement slice found the same coverage hole the Executive Boards
  slice hit.** Neither `tests/fleet-engagement.test.js` nor
  `tests/fleetEngagement.test.js` contained a single `data-value-state`
  assertion, so the cascade defect could have shipped there unseen for the second
  time. Four tests were added and each was proven to fail against a deliberate
  mutation before it was trusted: hoisting presence to the row (per-metric),
  hand-writing one dash back (stamping), rendering `p80` instead of `bandLabel`
  (#13), and captioning `beyond-modelled-range` as `UNWINNABLE` (#14).

  **Two things the conversion could not make structural, and why.**
  `24-fleet-engagement.css` sets `.fe-cell span { display: block }`, so a figure
  composed *into* a sentence inside a table cell cannot simply be wrapped in a
  `<span>` — it would stack onto its own line. MUI takes the display property
  back for exactly those nodes (`sx={{ '&&': { display: 'inline' } }}`, which
  outranks `.fe-cell span` at (0,2,0) vs (0,1,1) without `!important`), so those
  figures ARE stamped; but the two `title` attributes remain string-only, through
  `resolveValue().text`, because an attribute cannot host an element. That is the
  documented second form of the primitive, not a gap left open.
- **#26** — **FIXED 2026-08-27.** The guard that promised the unit suite never
  reads the live save was a **scan of test-file source text**, so it could not see
  a read reached through a server or a helper. `missionControlLayout.test.js`
  required `server/index.js` and passed the scan. CLAUDE.md's "must pass
  identically with the game running" was therefore unenforced — which mattered,
  because that is how the suite is almost always run.
  Replaced with a **behavioural guard** (`tests/noLiveSaveInUnitSuite.test.js`):
  it re-runs the whole suite with `TI_SAVE_PATH` pointed at a folder that does
  not exist (anything reaching for the newest save 500s and names itself), plus a
  fs watch on the real configured folder for code that bypasses the override. On
  the tree as it stood, the guard named **six** failing files the source scan had
  missed. Five were live-save readers and are fixed: `missionControlLayout`,
  `commandLayout` and `markdownExports` now serve a committed synthetic save
  (`tests/fixtures/syntheticSave.js`); `controlPointCap` reads the committed
  fixture via `queryFixtureIntel`; `driveExplorer` is **pinned** with a two-way
  ratchet until a save carrying ship designs with rated drive figures exists
  (its route test needs the server to answer with real drive measurements). The
  sixth (`codeIndex.test.js`) was a stale `docs/code-index.md`, unrelated to the
  save folder, regenerated.
  **Correction to this entry's earlier reasoning:** the register's note that the
  `controlPointCap` (EBUSY on `Autosave.gz`) and `markdownExports` (500) failures
  "use committed fixtures and do not require `server/index.js`" was wrong on
  both. `controlPointCap.test.js:974` called `queryIntel` **without a snapshot**,
  which falls through to `loadSnapshot()` → the newest save in the configured
  folder (the EBUSY, mid-write); `markdownExports`' HTTP smoke test drove the
  real server's save-backed routes (the 500, mid-write). The behavioural guard
  found both; it cannot see a read the suite tolerates, which is exactly why the
  fs watch is part of it.

*(#24 is closed — both halves. The CSS was 12 undefined names across four panels,
not 8 in one, and cost missing geometry rather than only wrong colour; six
references in three other panels remain **pinned** in
`tests/cssCustomProperties.test.js`, each needing a visual decision rather than a
guess. `hostileMovement` is now registered and the guard was proved to fire.)*

*(#25 was found and fixed the same day. Six scripts carried the ingredient, four
were armed; fixed at the chokepoint so the other two — and the next one written —
cannot arm themselves.)*

*(#23 was found and fixed the same day — `e76c212`. It is left in the list below
because the two wrong diagnoses it produced are the useful part.)*

**Conditional: none.** #4, #6, #8 and #10 were the whole conditional set and all
four are fixed.

**Note on #2.** It produces no visible change on the current save, because every
theater count there is measured. That is not the same as inert — the four tests
that fail when the component is reverted are what establish the fix works; the
save simply does not exercise it today.

One further candidate was investigated and **cleared** — see the end of #8.

**The pattern across the fixed set is worth keeping.** Ten of the twenty —
#3, #7, #11, #12, #13, #14, #6, #4, #8 and, in effect, #2 and #5 — were corrected **as
part of a migration or a characterisation pass**, not as standalone defect work.
That is the argument for fixing at the port rather than queuing defects
separately: the person already reading the component closely enough to rewrite it
is the person best placed to notice.

And three of them (#13, #14, #15) were cases where `shared/markdownExports.mjs`
was already **right** and only the browser had lost the caveat, inverting this
repo's usual direction.

**#17 is the counter-case, and it is deliberate.** A port whose bar is "no figure
may change" *cannot* fix a fabricated fallback without violating its own bar. The
right move is what that agent did — flag it, carry it, and file it — rather than
either silently fixing it or silently laundering it through a new component.

*Correction: the commit that added #15 stated in its message that this header
had been re-derived to 15 entries. It had not — that edit was never made, and
the header still read 14 until #16 was added. The counts above are derived from
the entries below rather than incremented.*

**#9 was the one to fix first, and it was.** It was the only defect that also
reached the AI markdown exports and the hosted worker, it dropped 91% of its
records, and unlike the others it was not confined to a component the migration
would rewrite anyway — `shared/markdownExports.mjs` is out of scope for the
migration, so nothing else was going to touch it. **That fix is committed but
has not been published**, so the hosted site is still serving the truncated
version until someone runs the publisher.

**#16 was the one that mattered most**, for the same structural reason turned
inward: it was the only defect in the **verification tooling**, so it invalidated
evidence rather than a panel. It is fixed, which is what unblocks computed-style
diffing for the remaining component migrations.

---

## 1. `directive-board` invents four budget ceilings — **confirmed**

`public/v2/js/components/directive-board.js:222-237`

```js
const hateCeil  = num(hate.cap ?? hate.ceiling) ?? 5.0;
const infStock  = num(inf.cap  ?? inf.stock)    ?? 100;
const opsStock  = num(ops.cap  ?? ops.stock)    ?? 50;
const mcCap     = num(mc.cap   ?? mc.capacity)  ?? 100;
```

`num()` correctly returns null for an unmeasured value; `?? <literal>` then
replaces it with an invented one. With no budget data the panel renders four
filled meters reading **`0.0 / 5.0`, `0 / 100`, `0 / 50`, `0 / 100`** — numbers
that appear measured and are not.

This is worse than a coerced zero, because the **denominator** is fabricated: the
percentage bar is computed against an invented ceiling, so the bar length is
fiction too.

**There is a guard, and the caller defeats it.** Line 216 is `if (!budgets)
return ''`, but line 660 calls it with `cyclePlan.budgets || {}` — always truthy.
The guard cannot fire.

Two hundred lines away, `renderBenchBudget` refuses to claim anything unmeasured.
The correct treatment already exists in the same file.

No test catches it. The bench-budget test deletes `plan.budgets` but only asserts
the *other* block is absent.

---

## 2. `world-map` prints a confident total beside its own em dash — **confirmed**

`public/v2/js/components/world-map.js:496-500`

```js
totalHostile += view.record ? (readCount(view.record, [...]) || 0) : 0;
```

The per-theater line at `:429` uses `countLabel()`, which correctly renders `—`
for an unmeasured count. The summary line four hundred lines later sums the same
values through `|| 0`.

So the panel shows a theater as `H — / OWN —` and, one row below, a total of
`CURRENT / HOSTILE 3 · OWN 1` derived from those same unread values. The right
answer and the wrong answer are on screen together.

`:395` and `:399` coerce the same way into `statusLabel` / `statusKey`.

---

## 3. `mc-budget` coerces an unmeasured multiplier to zero — **latent, NOT live** (corrected)

> **Corrected 2026-08-24, same day.** This entry originally claimed the panel
> renders `PROJECTED FLOOR 0.0` today, on the grounds that "both committed
> fixtures omit `difficultyMultiplier` entirely". **That is false.** Measured
> directly:
>
> ```
> difficultyMultiplier  = 0.3
> concealmentMultiplier = 0.6400000000000001
> usedMissionControl    = 162
> ```
>
> Both fixtures carry the field. The lane's `0.0` came from a **crafted**
> payload, which proves the coercion is reachable — not that it occurs.
> Antigravity's characterisation test independently asserts
> `PROJECTED FLOOR 31.1` from the real fixture, and is right.
>
> **The code defect is still real** — `|| 0` on a `num()` that deliberately
> returns null is the wrong idiom and will produce a confident zero the moment
> the field is absent. But it is latent, not shipping, and it does **not** belong
> in the "visible on the live dashboard now" group. Demoted accordingly.
>
> Recording this because I published the fixture claim as fact without opening
> the fixture, which is the same failure as building the pin column from
> filenames.

### Original entry, retained

`public/v2/js/components/mc-budget.js:61-62`

```js
(num(difficultyMultiplier) || 0) * (num(concealmentMultiplier) || 1)
```

Executed through the repo's own `tests/fixtures/renderHarness.js` with
`usedMissionControl: 152` measured and `difficultyMultiplier` absent: the panel
renders **`PROJECTED FLOOR 0.0`**.

Two things make this one hard to catch and worth fixing carefully:

- **The existing test misses it by construction.** It nulls *every* metric at
  once, so `used === null` short-circuits to UNAVAILABLE for an unrelated reason.
  The single-null case is untested.
- **Both committed fixtures omit `difficultyMultiplier` entirely**, so no
  fixture-based test can currently exercise the measured path either.

---

## 4. `fleet-procurement` fabricates an armour score — **confirmed**

`public/v2/js/components/fleet-procurement.js:47-49`

```js
const entry = ARMOR_DATA[armorId];
if (!entry) return 1.0;
```

Any armour type absent from the hardcoded table scores a made-up `1.0`, which
then drives a **visible "N× behind" ratio**. An unknown input produces a
confident comparative claim.

`ARMOR_DATA` is a hardcoded table in a component, so it goes stale whenever the
game adds an armour type — which makes the fallback path reachable by ordinary
game updates, not just by bad data.

---

## 5. `research-advisor` drops half its groups silently — **confirmed**

`public/v2/js/components/research-advisor.js:43` and `:460`

```js
const GROUPS_SHOWN = 2;
return populated.slice(0, GROUPS_SHOWN).map(...)
```

Two of four availability groups are cut with **no omission note anywhere**.
`populated.length` is used only for the zero-check at `:459`; it is never
compared against `GROUPS_SHOWN` to produce a count. Group 3 measured **7 ranked
rows missing on the live save**.

This breaks a standing rule of this repo: a capped list must carry its total and
omitted counts to the consumer. The component already knows both numbers.

---

## 6. `drive-explorer`'s scroll hint dies after the first interaction — **confirmed in browser**

`public/v2/js/components/drive-explorer.js` `paint()` replaces the whole panel
with `container.innerHTML = …` and then calls only `bindControls(container)`.
`syncScrollHints` is **never called from this file**; it lives in
`mission-control.js` and fires on load, two fetch paths, resize, and overlay open.

Reproduced 2026-08-24 by loading DRIVES and changing the sort `<select>`, which
is a client-side re-render with no fetch:

| viewport | on load | after client-side sort | still overflowing by |
| --- | --- | --- | ---: |
| 900px | `de-scroll-hint is-scrollable` | `de-scroll-hint` | **153px** |
| 700px | `de-scroll-hint is-scrollable` | `de-scroll-hint` | **353px** |

The hint element survives; only the measured `is-scrollable` class is lost. The
table demonstrably still scrolls — `scrollWidth` 989 against `clientWidth` 836
and 636 — and the only affordance telling the reader so is gone until a resize.

At 1280px the check is inconclusive and correctly so: the table does not overflow
there, so the hint is absent either way. **A verification run at desktop width
alone would have reported this as fine.**

This is the exact property `tests/missionControlLayout.test.js` protects — that
scroll hints are driven by measured overflow, never by viewport width. The rule
holds; nothing re-runs the measurement after this component repaints.

---

## 7. `alien-hate-economics` may show an unknown hate as a green estimate — **reported, unverified**

`renderHud` is reported to render an unmeasured hate as a green `GAME ESTIMATE`
because `visibleEstimate: 'UNKNOWN'` is truthy and is compared only against
`'UNAVAILABLE'`. A sibling function at `:227` **does** handle both
(`if (!text || text === 'UNAVAILABLE' || text === 'UNKNOWN') return null`), which
makes the inconsistency plausible — but the specific path was not confirmed.

Related and separately worth fixing: `renderHud` mounts `#hudHateMeter`, which is
**not in the `VIEWS` registry**, so `assertViewRegistryIntegrity()` does not cover
it. That assertion exists precisely to catch a panel rendering nowhere.

---

## 8. `mining-expansion` prints the literal string `null` — **confirmed reachable**

`public/v2/js/components/mining-expansion.js:509` interpolates `${s.name}` for
each bonus source. The surrounding guard checks `sources.length`, which catches an
empty array but not a null `name` inside a present entry.

Traced to the producer, `shared/spaceMiningBonus.mjs:248`:

```js
name: org?.displayName ?? null,
```

The field is **explicitly nullable**. So an org that carries a mining bonus, is
active (`applyingBonuses === true`), and has no `displayName` reaches the
consumer as `{ name: null, value: 0.05 }` and renders as **`null +5%`**.

The producer demonstrates that it knows names can be absent — its own error path
at `:243` writes `'(unnamed)'` as a fallback. Only the success path ships the raw
null. This is the recorded rule that an unresolvable identity must never become a
string, broken across a module boundary: careful on one side, unguarded on the
other.

Reachable by type, not observed on the current save — no org on it is both
bonus-carrying and unnamed. Fix the consumer regardless; the producer's contract
permits it.

**Not a defect, checked and cleared:** the neighbouring
`Math.round(num(s.value) * 100)` cannot coerce a null to `+0%`. Line 240 does
`if (value === null || value === 0) continue;` and the effect branch requires
`typeof value === 'number'`, so `s.value` is always a non-zero number by the time
the consumer sees it.

---

## 9. Priority targets truncate 79 of 87 silently — in the panel **and** the AI export — **confirmed**

Found by the intelligence-library characterisation lane, which correctly left it
alone. It is worse than that lane reported: the same truncation exists in **two**
surfaces, and the second is the one that matters more.

```js
public/v2/js/components/intelligence-library.js:261
  (snapshot.servantTargets || []).slice(0, 8)

shared/markdownExports.mjs:3006
  (filteredData.servantTargets || []).slice(0, 8)
```

Measured on both frozen fixtures: **87 servant targets exist, 8 render, 79 are
dropped** — 91% of the data, with no count, no note, and no `*TotalCount` /
`*OmittedCount` pair anywhere in the payload or either consumer. Grepping the
component for any omission language returns nothing.

Two things make the second instance the serious one:

- **`shared/markdownExports.mjs` is the AI-facing surface.** `CLAUDE.md` states
  the rule directly for this file: *"Mind the byte budget; if the new figure does
  not fit, say what was dropped rather than silently truncating."* An agent
  reading `/latest-snapshot.md` sees eight holdings and has no way to learn there
  are eighty-seven.
- **It is in `shared/`, so it ships to the Cloudflare worker too.** The hosted
  site truncates identically.

This is the same defect class as #5 (`research-advisor` dropping two of four
groups) but an order of magnitude larger, and #5 is browser-only.

Fixing it needs a produced count, not just a consumer change: nothing upstream
currently emits the total, so both consumers would have to derive it from the
array length they are slicing — which is available at both call sites.

---

## 10. 85 drives are shown under a name the game never displays — **confirmed**

Found by the user, 2026-08-25: *"I don't see H-Orion drive in the drive screen."*
It is there. It is called something else.

`server/templateLoader.js:339`

```js
displayName: item.friendlyName || item.displayName || (item.dataName || …)
```

The dashboard takes the template's `friendlyName` and **never reads
`StreamingAssets/Localization/en/TIDriveTemplate.en`**, which is where the game
gets the name it puts in front of the player:

```
TIDriveTemplate.displayName.AdvancedOrionDrivex1=H-Orion Drive
```

Measured across the catalogue: **85 of 541 drives (15.7%) have a localised name
that differs from the `friendlyName` the dashboard renders.** Whole families are
affected, not stragglers:

| dashboard shows | the game shows |
| --- | --- |
| Ponderomotive VASIMR ×1–×6 | **Advanced VASIMR** ×1–×6 |
| Advanced Pebble Drive ×1–×6 | **Particle Drive** ×1–×6 |
| Advanced Orion Drive ×1 | **H-Orion Drive** |

The failure mode is the worst kind for a reference tool: **the data is present and
correct, and the reader concludes it is absent.** Searching the dashboard for what
you can see on your own ship returns nothing, and there is no signal that a
rename happened — an honest "not found" is indistinguishable from a real absence.

### Scoped 2026-08-25: **519 renames across 18 families, 6.1× the drives figure**

Measured against the installed game, whitespace-insensitive. The 85-of-541 drives
figure reproduces exactly.

| family | divergent | | family | divergent |
| --- | ---: | --- | --- | ---: |
| projects | **139** | | traits | 26 |
| weapons: laser | **86** | | utilityModules | 22 |
| drives | **85** | | shipHulls | 16 |
| orgs | 40 | | weapons: magnetic | 15 |
| habModules | 26 | | radiators | **13 of 13** |
| techs, missions, reactors, shipArmor, weapons: gun/particle/plasma/missile | 51 combined | | | |

**Save-sourced families are NOT affected and must not be "fixed".** Nations, hab
sites and orgs-on-councilors render the **save's** `displayName`, which the game
already writes localised — verified live: `ATZ` → `Aztlán`, `Mare Imbrium`,
`ISIS`. Their template names diverge (36 and 490) but never reach the screen.
Localising those would be a regression.

**`effects` are a separate defect.** They have no `friendlyName`; the tech graph
renders their `dataName` (`Effect_DetectAbductions`), and their localisation is
keyed by `Context.displayName.<context>`, not by effect `dataName`. Different
mechanism, do not fold it in.

### Two couplings that make a naive fix destructive

Neither is on the drive screen, and both were found by tracing consumers rather
than by reading the render path.

1. **The weapon loadout ↔ catalogue match is two-sided.**
   `server/snapshot/space.js:88` writes the loader's weapon `displayName` into
   `weaponLoadout[].systems`; `shared/intel/militaryValue.mjs:146-166,246` builds
   `byDisplayName` from the baked `componentStats` name and matches redacted
   ships' loadout strings against it. Both sides equal `friendlyName` today.
   **Localise one side only and every redacted-ship weapon inventory silently
   drops to zero.** They must move together, from the same source.
2. **Mission `friendlyName` is an engine identity key.**
   `server/engine/missionCatalogue.js:18-19` keys specs by it,
   `server/engine/odds.js:169-170` matches `'Control Nation'`, and
   `clocks.js:97` matches `'Defend Interests'`. The fix must add a **separate**
   display field and leave `friendlyName` untouched.

**Cleared:** the unlock index, tech-graph nodes, `componentStats` and
`driveStats` are all keyed by `dataName`, so `displayName` is payload and
changing it changes no keys. `driveExplorer.mjs:347,541` sorts by display name,
which is presentation not identity. `refitAdvisor` and `production` match
ship/design names from the **save**, not from template components.

### It is not one line

The name reaches the screen through roughly twenty expressions across **five
files**: `server/templateLoader.js:307,339`, `server/snapshot/templates.js`
(~12 sites), `server/snapshot/factions.js:346,656`, `server/snapshot/research.js:61`,
and `shared/techGraph.mjs:238,306` — plus the two-sided weapon coupling.

**Recommendation: fix the whole template-sourced set in one coordinated pass, not
drives-first.** A drives-only fix leaves 434 renames live, and the coupling
constraints mean any single-family fix still needs the full localisation layer
anyway.

Related, and separate: the DRIVES view showed **61 of 541 rows with 480 omitted**
on the measured save. That truncation is honest — `itemsTotalCount` /
`itemsOmittedCount` are carried — but it means most of the catalogue is off screen
by default, which compounds the naming problem when someone is hunting for a
specific drive.

---

## 11. An explicit UNAVAILABLE visibility renders as VISIBLE — **FIXED, verified 2026-08-30**

> The named file `public/v2/js/components/faction-intel.js` no longer exists; the
> logic is `src/v2/panels/factionIntelUtils.js:392`. The explicit-declaration branch
> is now guarded by **`isExplicitlyEmpty`** rather than `hasMetricValue`, so a
> declared `'UNAVAILABLE'` is treated as a statement rather than an absence and no
> longer falls through to the data-inference branch. The file carries a header
> comment naming this defect and explaining why the two predicates must stay
> separate. Fixed at the React port.

`public/v2/js/components/faction-intel.js`, found 2026-08-25 while correcting
characterisation assertions.

```js
var MISSING_VALUES = { '': true, 'UNKNOWN': true, 'UNAVAILABLE': true, … };   // :17-24

function visibilityForMetric(context, faction, metricName, hasData) {          // :1126
  var explicit = readField(faction, keys);
  if (explicit.found && hasMetricValue(explicit.value)) return normalizeVisibility(explicit.value);
  if (!hasData) return 'UNAVAILABLE';
  …
  return 'VISIBLE';
}
```

`'UNAVAILABLE'` is itself in `MISSING_VALUES`, so `hasMetricValue('UNAVAILABLE')`
is **false**. An explicit `earthVisibility: 'UNAVAILABLE'` therefore fails the
guard, skips the explicit branch, and — on a faction that has data — falls
through to **`VISIBLE`**.

**The signal that says "we cannot see this" is discarded and rendered as its
opposite.** That is worse than this repo's usual `Number(null) === 0`: it is not
an absent value coerced to zero, it is an explicit negative assertion inverted
into a positive one. A reader is told intelligence is visible precisely when the
snapshot said it is not.

The guard's intent is clearly to ignore *empty* values and fall back. The bug is
that the sentinel meaning "explicitly unavailable" is in the same set as the
sentinels meaning "nothing here", so it cannot be distinguished from absence.

Two related findings from the same pass, both **behaviour, not defects**, but
worth knowing before `faction-intel` is rewritten:

- **The relationship display reads the `relationship` string label, never the
  `hate` number.** `unwrapRelationshipValue` takes the first of
  `['relationship','relation','status','attitude','stance','label','name','value']`,
  so nulling `factionRelationships[i].hate` changes nothing on screen — the
  dossier renders `Hate of us 4.50` from the `relationship: 'HATE 4.50'` string.
  Any rewrite that starts reading `hate` changes what is displayed.
- The visibility tag comes from `candidate.visibility`, not from the metric, so
  it reads `RELATION OBSERVER FACTION TELEMETRY` rather than a relation state.

---

## 12. An unknown nuclear arsenal renders as zero — **FIXED, verified 2026-08-30**

> The truthiness ternary is gone with the file that held it.
> `src/v2/panels/IntelligenceLibrary.jsx:533` is now `NationNukesCell`, which tests
> `numberValue(nukes) === null` explicitly: an **absent** arsenal renders
> `<Value present={false} />` and a **measured zero** keeps its `0` chip. That is
> exactly the fix this entry prescribed. Fixed at the React port.

`public/v2/js/components/intelligence-library.js`, nation row.

```js
nation.nukes ? statusChip(number(nation.nukes, 0), 'danger') : '0'
```

The ternary tests **truthiness**, so `null`, `undefined` and a measured `0` all
take the same branch and render the literal token `'0'`. A reader cannot tell
"this nation has no nuclear weapons" from "we have not measured this nation's
nuclear weapons".

This is the register's most common shape — absent rendered as zero — on one of
the highest-stakes fields in the product. Everywhere else the nation row uses an
em dash or `UNAVAILABLE` for an unmeasured value; nukes is the exception, and it
is the one where the two states have the most different meaning.

Found 2026-08-25 while writing per-metric characterisation coverage. It is
**pinned rather than fixed**, deliberately: `tests/intelligenceLibraryRendering.test.js`
carries a test asserting the current `'0'` output with a comment saying the fix
will require breaking it. That is the right order — the characterisation lands
first so the eventual correction shows up as a deliberate, reviewed change rather
than a silent one.

Fixing it means distinguishing the branches: a measured `0` keeps its `'0'`, and
an absent value takes whatever affordance the neighbouring cells already use.

---

## 13. `strategic-commentary` renders a Monte Carlo band as the whole uncertainty — **FIXED, verified 2026-08-30**

> `src/v2/panels/StrategicCommentary.jsx:30` now renders the band **with what it
> covers**: `bandLabel` is followed by `(p20–p80 over {seedsSimulated} seeds)` and
> both carry `bandCovers` as a title. The server's authored warning — that a
> consumer rendering `bandLabel` alone would present Monte Carlo spread as the whole
> uncertainty — is satisfied. Fixed at the React port.

`public/v2/js/components/strategic-commentary.js:83-86` renders each engagement
tier's threshold as `bandLabel` and nothing else:

```js
${tier.winnable
  ? `<em>${escapeHtml(tier.bandLabel)}</em>`
  : '<span style="color: var(--danger); …">UNWINNABLE</span>'}
```

The server emits an `uncertainty` object alongside it, and the emission carries
an authored warning — `server/commentary/simulation.js:576-578`:

> The band never travels without what it covers. A consumer that renders
> `bandLabel` alone would otherwise present Monte Carlo spread as though it were
> the total uncertainty.

This component is that consumer. `uncertainty` is **never rendered by any v2
component** — grepped 2026-08-25, zero hits across `public/v2/js/components/`
and `src/v2/`. Meanwhile `shared/engagementModel.mjs:104` records that the band
"understates the spread whenever a meaningful share of seeds is unwinnable."

Live against the current save, all five tiers carry `uncertainty: PRESENT` and
the panel shows five bare hull counts — `1 hull`, `2 hulls`, `3–4 hulls`,
`5 hulls`, `6–7 hulls` — read by a human as a requirement, not a p20–p80 band
over 120 seeds. This is not an absent value rendered as present; it is a
**partial** value rendered as a total one, which is harder to notice.

## 14. `UNWINNABLE` means "above the ceiling I swept", not "cannot be won" — **latent, live path**

Same three lines. When `tier.winnable` is falsy the component prints a red
`UNWINNABLE`. `shared/engagementModel.mjs:58-62` says exactly what that flag
does and does not mean:

> a sweep returning `winnable: false` means "the answer is above the ceiling I
> swept", **NEVER** "this cannot be won". `guaranteedWinHullCount` computes that
> bound in closed form so a caller can size its own ceiling from the model
> rather than from a number somebody picked, and `shared/fleetEngagement.mjs`
> uses it to keep "beyond the modelled range" distinct from "not winnable".

The ceiling is `MAX_SIMULATED_HULLS = 24`. So `UNWINNABLE` should read as
"more than 24 hulls" — a procurement figure — and instead reads as a wall.
`shared/fleetEngagement.mjs` already preserves the distinction; this component
discards it at the last line before the DOM.

**Latent today:** all five tiers are `winnable: true` against the current fleet
(checked 2026-08-25 via `/api/v2/briefing`). It is a live path, not dead code —
a weaker fleet or a heavier opponent tier reaches it, and the model exists
precisely to be asked about opponents you cannot yet beat.

Both #13 and #14 sit in the same ternary, and both are cases of a **shared
module authoring a careful distinction that the render boundary throws away.**
The engine comments were written by someone who anticipated this exact consumer.

### The correct rendering already exists — in the AI export, not the browser

`shared/markdownExports.mjs:2602-2631` handles **both** defects, thoroughly:

```js
const count = tier.winnable === true
  ? (tier.bandLabel || 'UNAVAILABLE')
  : `NOT REACHED at any count up to ${localeOr(tier.uncertainty?.maxHullsSwept)} hulls`;
```

— that is #14 done right, and the comment above it says why: *"`winnable: false`
is a CEILING report, not an impossibility verdict."* It then carries the partial
band caveat only when it bites (`ratio < 1` → *"band taken over only X% of
seeds, so it UNDERSTATES the spread"*), emits a **"What those counts are NOT"**
block naming the opponent rating basis and stating that the band covers
run-to-run variance *"and NOTHING else — not error in the opponent ratings, and
not model misspecification"*, and when no uncertainty record was carried at all
it says so and adds *"Treat them as unverified."*

**This inverts the usual direction of this project's defects.** The standing
rule in `CLAUDE.md` is that a new figure reaches the browser and never reaches
the AI exports — measured 2026-08-21, four of six additions missed. Here the
exports are correct and the browser is the surface that lost the caveat. The
rule is not "push things toward the exports", it is **every surface or none**,
and the check has to run in both directions.

It also means the fix needs no new wording invented. Two surfaces spelling the
same caveat differently would be its own defect; the migration should reuse
these sentences. That is the standard to review the port against.

---

## 15. The bench is scored, ordered, and is not a ranking — **FIXED, verified 2026-08-30**

> `src/v2/panels/DirectiveBoard.jsx:634` carries a block comment naming this defect,
> and `:772` renders the qualifier outright: the list is **"NOT a ranking and the row
> count counts groups rather than options."** The engine's own statement at
> `server/engine/assignment.js:1287-1289` now reaches the reader instead of stopping
> at the panel boundary. Fixed at the React port.

`public/v2/js/components/directive-board.js`, `renderBenched` at `:514`.

Each benched row renders its score prominently — `<span class="directive-benched-score">Score ${score.toFixed(2)}</span>`
at `:552` — and the rows are listed top to bottom. Nothing in the panel says
what `server/engine/assignment.js:1287-1289` states outright:

> the emitted list is therefore **NOT in descending score order, and must not be
> read as a ranking**. It is the best few, in the order the engine produced them.

Grepped 2026-08-25: the words "ranking", "not a rank" and "ordered by" appear
nowhere in `directive-board.js`.

**Demonstrated against the live save**, `/api/v2/briefing?mode=player&observer=4712`:

| row | score | action |
| --: | --: | :-- |
| 0 | 6.03 | Take the Executive control point in Madagascar |
| 1 | 6 | Investigate Bonnie Molloy |
| 2 | **9** | Convert alien-detection capability into… |
| 3 | 5.61 | Advise Government: European Union |
| 4 | 4.38 | Advise Government: Mexico |
| 5 | 4.06 | Advise Government: Myanmar |
| 6 | 4.14 | Advise Government: Switzerland |
| 7 | **7** | Advise Government: United States of North America |

Descending would be `9, 7, 6.03, 6, 5.61, 4.38, 4.14, 4.06`. The best available
alternative sits **third**; the second-best sits **last**. Rows 5 and 6 are
inverted against each other by 0.08. A reader scanning top-down for the
strongest option reads 6.03 as the winner when it is the third-best of eight.

This is not a fabricated value and not an absent one — every score shown is
correct. The defect is the **arrangement**, which carries an implication the
data does not support, and which the producing module explicitly warned about.

`shared/markdownExports.mjs:2410-2411` gets it right: *"the carried array is
then ordered by generation rather than by score, so the sequence is NOT a
ranking and the row count counts GROUPS rather than options."* Same inversion as
#13 and #14 — **the AI export is correct and the browser is the surface that
lost it.**

Fixing it does not mean re-sorting. Generation order is deliberate and
`assignment.js:1279-1286` records two measured alternatives that were both
worse. It means **saying** the order is not a ranking, in the panel, in the
words the export already uses.

### One thing this sweep got wrong, worth recording

`shared/benchSelection.mjs:346` warns that a mixed group "must say so", and a
grep for `budgetDisplacedCount` returned **zero** hits in every v2 component —
which looked like a sixth defect. It is not. `directive-board.js:503-512`
renders exactly that caveat (*"Mixed group: N of M option(s) here were refused
by a budget, so the reason above does not describe all of them"*) off a
differently-named field, `groupBudgetDisplacedCount`, and only when it actually
disagrees with the row's own verdict — which is better than always rendering it.

**A field-name grep cannot answer "is this caveat surfaced".** It answers "is
this identifier present", and the two differ whenever the render boundary
renames. Every candidate this sweep produced had to be read at the call site
before it counted, and one of six did not survive that.

---

## 16. `--save` made the style harness stamp a save it never rendered — **FIXED 2026-08-25**

`scripts/verify_computed_style_baseline.js`. This is the tool `CLAUDE.md`
mandates for proving a refactor changed nothing, so a defect here invalidates
evidence rather than a panel.

`savePath` is read in `getActiveSaveFingerprint()` at `:130-145` and used at
`:161` to stamp the capture's metadata. **It is never passed to the harness
server**, which resolves the latest save independently. So `--save <path>`
changes only the *label* on the capture, never what is rendered. The run log
says both halves out loud and they disagree:

```
[Capture] Starting against save: frozen.gz (MD5: 4461068f...)
[Server] Parsing save Autosave.gz...
```

**Demonstrated 2026-08-25.** Two captures were taken twenty minutes apart with
`--save frozen.gz`, around a stashed change, while the game was running:

| capture | stamped savePath | rendered campaign date |
| :-- | :-- | :-- |
| `before_composer.json` | `frozen.gz` | **1 Feb 2039** |
| `after_composer.json` | `frozen.gz` | **16–17 Feb 2039** |

Identical fingerprints, two game states a fortnight apart, and the guard
**passed** — it compared the stamps, which matched by construction. The diff
then reported 13,563 differences, overwhelmingly the campaign advancing, in
which any real style regression would be undetectable.

### The part that makes it worse than a no-op

`:203-211` detects a save moving *during* a capture by comparing
`getActiveSaveFingerprint()` at the start and the end. With `--save` both calls
stat the same static file, so the comparison is frozen.gz against itself and
**can never fire** — while the live save the server is actually reading drifts
freely underneath it.

So passing `--save` **disables** the drift detector, and the error message it
disables reads *"CLAUDE.md requires capture against a frozen save."* The flag
that exists to satisfy the rule is the flag that switches off its enforcement.
Without `--save`, the detector works.

This is the same family as everything above it — a check that cannot be
evaluated reporting "fine" instead of "unknown" — except that here the
unevaluated check is the one the other verifications rest on. Every
"computed-style diff verified" claim made with `--save` while the game was
running is worth nothing, and cannot be distinguished after the fact from one
that is sound.

### FIXED 2026-08-25 — proven with two captures that diff to zero

**Closed.** Two captures of the same pinned save, taken with no code change
between them while the game was running, produce **0 computed style or geometry
differences** — down from 2,485. Every `Parsing save` line in both captures
names the pinned file; neither mentions `Autosave.gz`. `npm test` exits 0 and
`verify_v2_navigation.js` reports 0 console and 0 network errors. The proof was
re-run *after* the guard change below rather than inherited from the earlier
attempt.

The probe save must be **backdated so it is not the newest file in the folder**,
or the test proves nothing — the server would render it anyway. It sat at rank
21 of 22 for these runs.

**The fix is a `fetch` wrapper, not threaded call sites.** `shared.js` installs
`withSavePin()` and overrides `global.fetch` before any component loads, so every
`/api/` request is pinned **by default** and forgetting the pin at a new call
site is structurally impossible. Only two files changed. It also caught a
**twelfth** save-reading fetch that the enumeration below missed —
`unlocked-tech.js`'s generic `fetchJson(url)` — which a call-site fix would have
left unpinned. That is the argument for the design in one line.

Exclusions are explicit and reasoned rather than forgotten: `/api/runtime` and
`/api/saves` read no save; **`/api/save-state` must keep reporting the newest
file** or the "new save available" banner cannot fire; and **`/api/publish` is
deliberately never pinned**, because a verification pin silently redirecting a
real publish is a much worse failure than an unpinned capture. `/api/export`
*is* pinned — a decision, not an oversight: you export what you are looking at.

**Two defects were introduced fixing it, and both were caught by running things
rather than reading the report:**

- A **load-time `throw`** in `mission-control.js` requiring `withSavePin` broke
  four unit tests that load that file in isolation without `shared.js`.
  `npm test` went red. The correction is not to delete the guard and not to fall
  back silently — a silent identity fallback reintroduces this very defect in a
  new costume, with a capture setting `?save=`, quietly failing to pin, and
  reporting success. It is now gated on `__savePinRequested`: **no pin requested
  → degrade quietly; pin requested but helper missing → throw.** Fail loudly
  when the check cannot be honoured, stay quiet when there is nothing to honour.
- The **`Request`-object branch could never fire.** `input.url` on a `Request` is
  always absolute, so `pathname.indexOf('/api/') === 0` was false for every one.
  Latent rather than live — no call site passes a `Request` today — but dead code
  that looks live is worse than absent. `__pathnameOf()` now strips query and
  hash, detects `://`, and parses with `new URL().pathname`.

### The earlier partial fix, retained for the record

Two things landed and both are genuine improvements:

- **`--save` outside the configured save folder is now refused**, loudly, with
  exit code 1, naming the resolved path and the folder it must be in. Both sides
  are `realpathSync`'d, so the `C:\Users\cople\Documents` → `F:\Documents`
  junction on this machine resolves correctly. The old behaviour — stamp a
  fingerprint for a file the server cannot reach — is now impossible.
- **The pin reaches the server** via `?save=<basename>`, which
  `server/http/requestContext.js:49` already accepted and validated through
  `requestValidation.resolveSavePath`. No new door was opened; the front end was
  wired to an existing gated one.

**The headline problem is not solved.** `public/v2/js/mission-control.js:1074`
threads the pin onto `/api/v2/briefing` — and that is **one of eleven**
save-reading fetches in the v2 front end. The others carry no pin:

`/api/refresh` (**the mode switch**), `/api/save-state`,
`/api/intel/drive-explorer`, `/api/intel/fleet-engagement`,
`/api/intel/mining-expansion`, `/api/intel/refit-advisor`,
`/api/intel/research-ranking`, `/api/intel/tech-path`, `/api/export`,
`/api/publish`.

So a capture renders the pinned save for the initial player-mode briefing and
the **live** save for the mode switch and every per-view intel panel. The run
log says it plainly, alternating within a single capture:

```
[Server] Parsing save zz_verify_frozen.gz...
[Server] Parsing save Autosave.gz...
```

**Measured 2026-08-25:** two captures of the **same pinned save with no code
change between them** produced **2,485 differences**. Every one of the thirty
the script prints is `omniscient command` — the pass reached through the
unpinned `/api/refresh`.

The harness therefore still cannot produce a reproducible capture while the game
is running, which is the whole reason `--save` exists. The remaining work is to
thread the pin through the other ten fetches, or to route them all through one
helper that cannot forget it — the second being the fix that stays fixed, and
the same argument `shared/intel/registry.mjs` settled for route definitions.

---

## 17. Four fabricated fallbacks in the directive board, carried across knowingly — **FIXED**

Found 2026-08-26 by the agent porting `directive-board` to React, which flagged
them rather than silently fixing or silently carrying them. They were documented
in `react-component-contracts-detail.md` §3 but had never reached this register.

They survive in `src/v2/panels/DirectiveBoard.jsx` **deliberately**, because "no
figure may change" was the bar for that port. Fixing them is a separate,
reviewable change — which is the point of writing them down.

```js
:67    if (!cost) return 'Free';
:804   {reasoning.confidence || 'HIGH'}
:904   assignment.opportunityCost || 'None'
:905   whyList.join(' · ') || 'Optimal expected value under cycle budget constraints.'
```

> **AUDITED 2026-08-29 — all four fabricated fallbacks are fixed, and the three
> latent `?? 0` are gone.** Measured against `src/v2/panels/DirectiveBoard.jsx`
> as it stood then: `'Free'` gated on `cost === 0`; `confidence` presence-gated;
> `opportunityCost` conditional; the fabricated tactical-rationale string removed;
> risk-floor omitted counts no longer coerced with `?? 0`.
>
> **FIXED 2026-08-30 — the upper-bound half.** `benchBudget.jointlyAffordableIsUpperBound`
> (`null` or `true`) is emitted by `server/engine/assignment.js` and had reached
> **no** consumer. The directive board now prints `(an UPPER BOUND — cheapest-first
> is the most that fit, not a measured total)` beside the joint-affordability count
> when the flag is `true`; war-room §10 appends the matching clause in
> `shared/markdownExports.mjs`, gated on the same field. `null` means not stated
> on both surfaces — no false reassurance that the figure is exact.
> `tests/directiveBoardBench.test.js` and `tests/markdownExports.test.js` each
> carry a bidirectional test (present when `true`, absent when `null`).
>
> A **latent sibling** turned up during the 2026-08-29 audit, in a different panel:
> `IntelligenceLibrary.jsx:546` reads `nation.executiveFactionName || 'None'`.
> It is the same reassuring-default shape — an absent name would assert that a
> nation has no executive faction — but it is **harmless on today's payloads**,
> because the snapshot layer already emits the literal string `"None"` for all
> **167 of 295** nations with a null `executiveFactionId`, so the fallback never
> fires. Same standing as the three `?? 0` were: worth a line, not urgent.

Each is the register's signature shape — an unmeasured value given a confident
default at the render boundary — and each picks the *reassuring* end:

- **`'Free'`** reports an **absent** cost as a measured zero cost. A directive
  whose cost could not be read is presented as costing nothing, which is the
  most action-encouraging reading available.
- **`'HIGH'`** renders an absent confidence as the highest confidence the field
  can take. A recommendation the engine could not rate is shown as one it rated
  best.
- **`'None'`** and the tactical-rationale string both **fabricate a claim**:
  the first asserts nothing was given up, the second asserts a rationale the
  engine never produced.

### Three `?? 0` on nullable counts, currently harmless

`:231`, `:233`, `:935` coerce `riskFloorVetoedOmittedCount`,
`riskFloorUnverifiedOmittedCount` and `riskFloorVetoedTotalCount`. All three sit
behind a truthiness gate that renders nothing at zero, so no fabricated figure
reaches a reader on today's payloads.

**The reachable failure is a partial one:** if one omitted count were absent
while its sibling was present, the "N further entries are omitted" line would
**understate** rather than vanish — a truncation notice that under-reports its
own truncation, which is worse than no notice.

### An upper bound rendered as a plain count — **FIXED 2026-08-30**

`server/engine/assignment.js:411` and `:471` emit
`benchBudget.jointlyAffordableIsUpperBound` — `null` or `true` — and until
2026-08-30 **no surface rendered it**. Confirmed present on the live briefing at
`.briefing.engineDirectives.cyclePlan.benchBudget.jointlyAffordableIsUpperBound`.

So when the engine said "this joint affordability figure is an upper bound, not a
measurement", the board showed the number and dropped the qualifier. That was the
same shape as **#13** (a Monte Carlo band rendered as the whole uncertainty) and
**#15** (a non-ranking rendered as a ranking): not an absent value shown as
present, but a **qualified** value shown as an unqualified one.

**Fixed** in `src/v2/panels/DirectiveBoard.jsx` (`renderBenchBudget`) and
`shared/markdownExports.mjs` (`benchBudgetLines`), both gated on
`jointlyAffordableIsUpperBound === true`.

---

## 18. The type-scale guard stopped covering components when they became React — **confirmed, and now total**

`tests/typeScale.test.js:176`, the test named *"no component script writes a
font-size literal into an inline style"*. It walks `COMPONENT_DIR`, which is
`public/v2/js`, and matches only `.js` files.

That guard earned its keep the day it was written: it found **five** inline
`font-size: 9px` in `strategic-commentary.js` and **three** in
`mission-control.js`, including a `size < 48 ? '8.5px' : '9.5px'` conditional on
the GDP bubbles — declarations the stylesheet could not see at all.

**As of 2026-08-26 it covers no component.** `public/v2/js/components/` is empty;
all sixteen are now `.jsx` under `src/v2/panels/`, which the walk never reaches.
What remains in its path is `mission-control.js` and `shared.js` — the shell, not
the components the test is named for.

Checked today: **no React panel currently violates it.** The hole is that nothing
would notice if one did.

This is the shape `CLAUDE.md` already warns about, in its own words:

> the `SERVICE_ROLE` test scanned one file, and a later split moved the
> key-resolving code into a sibling it no longer covered. When code moves,
> re-check what its tests still actually cover.

A migration is exactly that kind of move, and this is the second instance in the
same codebase. Worth a sweep rather than a single fix: **any guard that walks a
directory rather than a manifest silently narrows as code relocates**, and it
reports green the whole way down.

Fixing it means walking `src/v2/` too, and matching `.jsx`. The SVG exemption in
the existing comment still applies — `world-map` sets font sizes as SVG
presentation attributes in user units, which are deliberately not on the page
scale.

---

## 19. `<Value>` cannot be used inside SVG, so world-map restates the contract — **confirmed, by design**

Found 2026-08-26 during the `world-map` port. `<Value>` — the primitive that
exists to make "absent stays null" structural rather than conventional — emits a
`<span>`. Inside `<svg>`, React creates children in the SVG namespace, so that
span is a non-rendering element. **Every figure in `world-map` lives in an SVG
`<text>`.**

`docs/react-component-contracts-detail.md:2790` reached the same conclusion
independently and says the choice must be stated rather than decided by whoever
happens to write the JSX.

The panel therefore restates the presence contract locally: `countLabel` and
`valueState` in `worldMapUtils.js`, plus `data-hostile-state` /
`data-own-state` / `data-summary-state` attributes so presence is still
structural and still assertable — but it is **a second implementation of this
repo's most defect-prone rule**, and the two can drift.

The agent declined to add an `as` / render-prop escape hatch to `<Value>` because
two other lanes were writing concurrently, which was the right call at the time.
It remains the fix: one primitive, one contract, an escape hatch for hosts that
cannot take a `<span>`.

---

## 20. The refit half vanishes on a dead endpoint, beside a procurement half that says so — **confirmed, live-reachable**

`src/v2/panels/fleetProcurementUtils.mjs:500`, carried across verbatim from the
vanilla during the 2026-08-26 port:

```js
const refitsRenderable = Boolean(refits) && refits.success !== false && refitItems.length > 0;
```

Three unrelated causes collapse into one falsy value, and `FleetProcurement.jsx:402`
renders **nothing at all** for every one of them:

1. the endpoint failed — `:705` does `refitRes.ok ? await refitRes.json() : null`
2. the endpoint answered with `success: false`
3. the faction genuinely has **no refit candidates**

So a dead endpoint is indistinguishable from good news. And the asymmetry makes
it worse: the **procurement half of the same panel** renders an explicit "the
ranking endpoint did not answer" card in the equivalent situation, so a reader
who has learned that this panel reports its own failures is actively misled by
the half that does not.

**Live-reachable, not latent.** `fetchProcurement` requests
`/api/intel/research-ranking` and `/api/intel/refit-advisor` in one
`Promise.all`, and each is independently `.ok`-gated. One endpoint 503-ing while
the other succeeds — a save being written, a slow query, a worker restart — is an
ordinary condition, and it produces a panel that looks complete.

This is the register's "unknown is not the same as safe" rule in its purest form:
**the check could not be evaluated, and the surface reported the reassuring
answer.**

### Two latent siblings in the same file, carried across and named in comments

- **`procurementView`: `count = num(procurement.count) ?? items.length`.** An
  unread total is replaced by the page length, which makes
  `omittedCount = max(0, count − itemsShown)` exactly zero and suppresses the
  truncation note — **a capped list reporting itself complete.** Latent:
  `shared/intel/researchRanking.mjs:1249` always emits `count` beside `items`.
- **`weaponModel`: `(rec.weapons || []).length`.** An absent weapons array reads
  as zero upgrades and prints the confident claim **"Current armament optimal"**.
  An unevaluated hardpoint is not an optimal one. Latent: `buildRefitAdvisor`
  always emits the array.

### #4's second half, which had never been recorded

The register described #4 as an unrecognised armour scoring a fabricated `1.0`
and driving a red **"15.2× behind"** badge. Measured during the port, that is
only one direction. When the **recommended** armour is the unrecognised one, the
fabricated `1.0` divides into a real fitted score of `15.1952` to give `0.066`,
which fails the `> 1.0` test — so the vanilla rendered **no badge at all**,
visually identical to "your armour is fine".

**Silence produced by a fabricated number is the same defect wearing the opposite
sign**, and it is the harder half to notice: there is nothing on screen to
question. Both directions now render a neutral `protection ratio unmeasured`
affordance naming the material.

---

## 21. The em-dash affordance is hand-written in eleven panels, six of which never import `<Value>` — **FIXED 2026-08-31**

> **Closed across eleven slices.** Every hand-written absence affordance now routes
> through the shared contract: `<Value>` in JSX, `resolveValue()` in string builders.
> The last six bare `'—'` returns were in `shipDesignerUtils.mjs` (4, including the
> `Calc` cooling range formatter) and `battleSuggestionUtils.mjs` (2).
>
> **The primitive had to split to finish this**, and that is the entry's most reusable
> outcome. A `.mjs` of pure functions cannot import JSX, so slice 8 extracted
> `src/v2/components/valueResolution.mjs` — DOM-free — with `Value.jsx` re-exporting
> from it. One contract, two consumers. That also gives #19's world-map problem
> (`<span>` cannot live inside `<svg>`) a proper home instead of a special case.
>
> **HOW STRONGLY IT IS NOW HELD, measured:** mutating the shared core so an absent
> value reports as `measured` fails **22 tests** across every converted panel. The
> rule holds by enforcement, not convention — which was the entire point of the entry.
>
> ### The counting lesson, which cost real work before it was learned
>
> `grep -c '—'` is the wrong query. It counts comment prose, and this codebase
> comments heavily. Ranking by it sent a slice at **DetailPanel, which was never an
> offender** — all eleven of its dashes were JSDoc.
>
> Counting only dashes *outside* comments is better but still an upper bound. Across
> the last five slices, **most survivors were prose inside strings**: named refusals
> and captions that carry facts, not affordances —
> *"a measured absence of build capacity, not an unmeasured build time"*,
> *"Treat the unresolved rows as the unresolved ones — the war could end up there"*,
> *"ESTIMATE — heuristic, not a measurement"*.
>
> The final audit collapsed **six candidate files to two** by reading every line.
> **The only reliable test is whether the dash stands in for a value**, and answering
> that requires reading the sentence. A refusal that already has words keeps them;
> `resolveValue()` takes an `absentLabel` for exactly that.

Found 2026-08-26 by the agent fixing #19, which was scoped to `world-map` and
reported this on its way past.

`<Value>` exists so that "absent stays null" is **structural** — one place that
decides what an absent value looks like, and stamps `data-value-state` so a test
can assert presence rather than guess from a glyph. #19 was one panel that
*couldn't* use it. This is eleven panels that *don't*.

Six never import it at all:

```
IntelligenceLibrary.jsx + intelligenceLibraryUtils.js
ExecutiveBoards.jsx     + executiveBoardsUtils.js
FleetEngagement.jsx
driveExplorerUtils.mjs
researchAdvisorUtils.mjs
fleetProcurementUtils.mjs
```

`intelligenceLibraryUtils.js` is the clearest case: its own `EM_DASH`, its own
`display`, `number` and `money`, and a `countLabel(value, noun)` returning the
literal string `'UNAVAILABLE'` — **with no `data-value-state` anywhere**. So a
reader sees the right word and a test cannot distinguish "we measured nothing"
from "we rendered nothing", which is the whole property the primitive exists to
provide.

**None of these has world-map's excuse.** #19 was a genuine technical constraint
— a `<span>` does not render inside `<svg>` — and it has since been solved with
an `as` prop and an exported `resolveValue()`. These eleven are convention
instead of structure, and convention drifts: the migration proved it, because
each of the sixteen ports independently re-derived what an absent value should
look like.

This is not urgent — the rendered output is correct today. It is the difference
between a rule that holds because it is enforced and one that holds because
everyone remembered.

---

## 22. World-map's tests could not see whether its figures rendered at all — **demonstrated, now fixed**

Found and fixed 2026-08-26 during #19, and reproduced independently before this
entry was written.

Strip `as="tspan"` from `WorldMap.jsx` and its figures become plain `<span>`s
inside the `<svg>`. React creates them in the SVG namespace, where they **do not
render** — the numbers vanish from the map. Every one of **21 tests
(`world-map` 16 + `worldMap` 5) stayed green.**

The mechanism is worth keeping: a `<span>` in the SVG namespace still holds its
text in `innerHTML`. So `visibleText()` reads it, `text.includes('H 0 / OWN 1')`
passes, and the suite cheerfully confirms figures that a reader cannot see.
**Reading the DOM is not the same as seeing the page**, and for SVG the two
diverge completely.

The new guard measures `getBBox()` / `getComputedTextLength()` instead of reading
text — geometry, not markup. Verified: with `as="tspan"` stripped,
`reactPrimitivesValue.unit` goes 3 pass / 1 fail while all 21 world-map tests
stay green; restored, everything is green.

**A second lesson from the same fix.** The first version of that guard demanded
only *one* `as="tspan"` in the file. With two call sites, dropping one still
passed — a guard that would have shipped a silently blank figure. It now requires
it on every `<Value>` in the file. **"Does this test fail for the right reason"
is not the same question as "does this test fail."**

---

## 23. A flaky mount test means a green browser pass is not evidence — **demonstrated, now fixed**

Found 2026-08-27 while verifying the theater-defence block, and it is the first
entry here about **the suite itself** rather than about the product.

`tests/worldMap.test.js:76` — "window.WorldTheaterMap.render mounts the React
panel, by element and by selector" — passes or fails **on the same tree, from the
same command**. Two back-to-back `npm test` runs: 492/492, then 491/492, failing
on `selectorMounted`. It passes reliably in isolation (5/5, twice) and at
concurrency 2 alongside one other file (38/38). It only fails inside the full
40-file browser pass.

The cause is a fixed-time wait. Inside `page.evaluate` the test mounts **two**
React roots and then waits exactly two animation frames:

```js
window.WorldTheaterMap.render(byElement, [...], {});
window.WorldTheaterMap.render('#probe-by-selector', [], {});
await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
```

Two frames is a guess about how long React needs to commit two roots. Under CPU
contention from 40 concurrent browser files it is sometimes not enough, and the
**second** mount is the one that loses — which is exactly the assertion that
fails. Waiting for a condition would not have this property; waiting for a
duration always will.

**Why this outranks its apparent severity.** Every verification claim made
against the browser pass on 2026-08-26 rests on a suite that reports green
intermittently. That includes claims made in commit messages. A flake does not
just cost a re-run — it silently converts "verified" into "observed once".

**It also produced two wrong diagnoses before it was measured**, both mine. I
first attributed the failure to a lane deleting the shared build directory —
plausible, since `docs/react-migration-progress.md` records exactly that hazard —
and rebuilt the harness, whereupon it passed. The rebuild had nothing to do with
it; I had landed on the passing side of a coin flip and called it a cure. The two
vite configs already write to **separate** directories, so that hazard is fixed
and was never in play. The second wrong call was reading a single clean run as
confirmation.

**The rule this earns:** an intermittent failure is not diagnosed until it has
been *reproduced and then made to stop* — a single passing run after a change is
consistent with the change having done nothing. This is the same shape as
"a test that only passes proves nothing", applied to the fix rather than the test.

**Fixed same day, `e76c212`**, and the rule above is what makes that fix
trustworthy where the earlier attempt was not. Baseline on the unmodified tree
reproduced the failure on run 1, at the exact reported assertion. After the change
— `page.waitForFunction` on the condition, bounded at 20s, a timeout throwing a
named failure rather than passing — **ten consecutive clean full runs**, five from
each of two measurements that overlapped, so most ran while a second full suite
competed for CPU. Contention is the cause, so surviving doubled load is stronger
evidence than a quiet machine. The target test settles in ~280–320 ms against the
20-second bound, so the bound is not doing the work.

Proven still able to fail: forcing `renderWorldMap`'s container resolution to null
(`src/v2/main.jsx:317`) kills only the selector form and produces the new named
diagnostic instead of a hang. Restored md5-identical; no application source
changed.

**Not a product race.** `renderWorldMap` resolves the container and removes the
fallback synchronously. Only `createRoot().render()` is async, and React 18 commits
a concurrent root through its own scheduler rather than on a frame boundary. The
app was never racing; the test was under-waiting.

**The same fixed double-`requestAnimationFrame` survives in four other files** —
`tests/driveExplorerReactPanel.test.js`, `tests/faction-intel.test.js`,
`tests/fixtures/factionIntelBrowser.js`, `tests/fixtures/worldMapBrowser.js`. Each
waits on a *single* root after an interaction rather than a two-root mount race, so
exposure is lower, but it is the same class and is recorded here rather than
silently left as four copies of a pattern now known to be fragile.

---

## 24. The hostile-movement panel shipped unregistered, and styled against eight tokens that do not exist — **FIXED, verified 2026-08-30**

> **Registered**: `hostileMovement` is in the `VIEWS` registry at
> `public/v2/js/mission-control.js:277`, so `assertViewRegistryIntegrity()` now
> covers it — the whole point of the entry.
> **Tokens**: `tests/cssCustomProperties.test.js` pins the remaining unresolved
> references to `07-hate-economics.css`, `17-directive-board.css` and
> `18-mining-expansion.css`. No hostile-movement stylesheet appears in
> `REGISTERED_GAPS`, and the assertion demands an EXACT match — so if its eight
> tokens were still unresolved, that test would fail. It passes.

Found 2026-08-27 by the agent building the *sibling* panel, which is the useful
part: both faults are in `fb2a6ab`, they are mine, and they survived that commit's
own verification because nothing looks at either property.

### It is not in the VIEWS registry

`public/v2/js/mission-control.js` lists the THREAT view's panels as
`dualAssetRings`, `alienHateEconomics`, `powerTrajectoryChart`, `fleetEngagement`,
`theaterDefence`. **`hostileMovement` is absent.** The string appears exactly once
in the whole file — a `getElementById` in the render path.

So `assertViewRegistryIntegrity()` does not cover it, and that assertion exists for
precisely this: the mining board once had a `<script>` tag and no mount element,
rendered nowhere, and nobody noticed. The panel currently renders, so nothing is
visibly wrong — which is the point. **The guard that would catch it moving is the
thing that is missing**, and an unguarded panel fails silently by construction.

### Eight of its thirteen custom properties are undefined

Measured across all 26 stylesheets, which define 63 tokens between them:

| file | `var()` names used | undefined |
| :-- | --: | --: |
| `25-hostile-movement.css` | 13 | **8** |
| `26-theater-defence.css` | 22 | **0** |

The eight: `--text-meta` ×6, `--rule-dim` ×6, `--surface-1`, `--surface-2`,
`--rule-strong`, `--text-body` — none with a fallback, so each resolves to nothing —
plus `--accent-warn` and `--accent-alert`, which do carry fallbacks and therefore
render.

The real vocabulary in `01-tokens-and-base.css` is `--text` / `--text-soft` /
`--text-muted` / `--text-dim`, `--line` / `--line-strong`, `--surface` /
`--surface-raised` / `--surface-inset`, `--warning`, `--danger`. Every invented name
is a plausible-sounding neighbour of a real one.

**The visible consequence is the dangerous kind: it is not blank, it is wrong.**
An unresolved `color: var(--text-meta)` does not fail — it falls through to the
inherited value, so `.hm-summary__item small` computes to `rgb(230, 238, 234)`,
full body brightness, where the design called for dimmed secondary text. A reader
sees confident, primary-weight text where the panel meant to whisper. Nothing
errors, nothing logs, and no test asserts computed colour on that panel.

**Why the sibling got it right and this did not:** the later brief named the
primitives and pointed at the token file; the earlier one did not. The lane invented
names that read correctly and never resolved. **A stylesheet is the one place where
a typo neither throws nor blanks** — CSS is specified to skip declarations it cannot
resolve, so the failure mode is inheritance, which always looks deliberate.

Worth a guard rather than only a fix: a test asserting every `var(--x)` in
`public/v2/css/` resolves to a defined token would have caught this at authoring
time, and would cover all 26 files rather than the two examined here.

### The guard was built, and this entry was wrong twice

`tests/cssCustomProperties.test.js` (2026-08-27). It measures **26 stylesheets, 63
tokens, 1,980 `var()` references** — the 63 reproduces the count above
independently. Written before the fix and seen to fail, which is the only reason
it is worth anything.

**Wrong the first time: 12 names, not 8.** The measurement above scanned *usage* in
only the two files it was comparing. The guard scans all 26 and found **four more
undefined names across three other panels**, live today:

| file | name | visible effect |
| :-- | :-- | :-- |
| `07-hate-economics.css:89` | `--panel` | `.mc-budget-hulls` uses the grid-gap hairline pattern — container `background: var(--line)`, `gap: 1px`, opaque cells. With the cells transparent the block renders as **one solid `#263837` slab** instead of separated rows. |
| `17-directive-board.css:44,103` | `--border` | chip has no border; row has no top rule |
| `18-mining-expansion.css:31,375` | `--surface-subtle` | bordered boxes with no fill |
| `18-mining-expansion.css:176` | `--surface-hover` | `:hover` does nothing, and the `transition: background` animates nothing |

These are **pinned, not fixed** — `REGISTERED_GAPS`, keyed by file, property and
exact count. The pin is a ratchet in both directions: a new unlisted reference
fails, a count that moves fails, and a pin whose reference has been fixed fails
until its entry is deleted. Each needs a visual design decision in a panel this
work was not scoped to, so guessing a token would have been the fabrication this
repo forbids.

**Wrong the second time, and this is the more useful correction: the damage was
missing GEOMETRY, not just wrong colour.** This entry described dimmed text
rendering bright. Measured in a real browser, the before-state was far worse:

`border: 1px solid var(--rule-dim)` is a **shorthand**, so an unresolvable value
takes the *entire declaration* to `unset` — `border-style: none`, `border-width:
0px`. Every summary card therefore had **no border and no background**, the banner
had no bottom rule, and the state chip's severity accent bar — the panel's primary
signal — was **0 px wide, entirely absent**. Only the separate `border-left-color`
longhand survived, which is why it read `rgb(196,61,61)` at zero width. The
`3px → 2px` correction was moot: the border was not rendering at all.

Measured before → after: `.hm-summary__item small` `rgb(230,238,234)` →
`rgb(145,162,155)`; `.hm-summary__item` border-top `none/0px` → `solid/1px
rgb(38,56,55)`; background `rgba(0,0,0,0)` → `rgb(11,21,23)`; `.hm-banner__state`
border-left `0px` → `2px rgb(212,125,118)`.

One of the eight changed nothing visibly, correctly: `--text-body` had been
inheriting `--text`, which is the value it wanted anyway.

**Still open, and needing a decision:** lines 51 and 56 carry
`background: rgba(214,138,58,0.08)` and `rgba(196,61,61,0.08)` — the *old* fallback
hues in rgba form. They are not `var()` references, so the guard cannot see them,
and the border above each now takes `--warning` / `--danger` while the tint behind
stays on the older, more saturated hue. The sibling panel has no tint at all.

**The half of #24 about the VIEWS registry is still open.**

---

## 25. Four verification scripts are armed to poison the bundle they verify — **demonstrated, now fixed**

Found 2026-08-27 by an agent that triggered it accidentally and reported it, then
reproduced deliberately here.

**The verification scripts can silently replace the production bundle with one that
cannot run.** Four of them set `process.env.NODE_ENV = 'test'` at module scope,
*before* calling `ensureBundleBuilt()`:

| script | `NODE_ENV` set | `ensureBundleBuilt()` |
| :-- | --: | --: |
| `verify_v2_navigation.js` | 13 | 16 |
| `verify_research_vs_procurement.js` | 13 | 61 |
| `verify_mining_registers.js` | 25 | 128 |
| `verify_drive_explorer.js` | 26 | 341 |

`ensureBundleBuilt` shells out with `execSync('npm run build', { stdio: 'inherit' })`
and **no `env` override**, so the child inherits the mutated value. Vite copies
`NODE_ENV` into `VITE_USER_NODE_ENV` and treats anything but `production` as a dev
build, so the React plugin emits `jsxDEV()`. Meanwhile `vite.config.mjs` declares
`mode: 'production'` and `define`s `process.env.NODE_ENV` as `"production"`, which
resolves React to the runtime that **does not export `jsxDEV`**. The two settings
disagree, and the bundle loses.

Measured directly, same command and env the scripts produce:

| build | bytes | `jsxDEV` occurrences |
| :-- | --: | --: |
| `npm run build` | 1,352,202 | **0** |
| `NODE_ENV=test npm run build` | 1,687,180 | **1,682** |

The observed symptom when it fired was every React panel dying with
`s.jsxDEV is not a function`.

**Why this is worse than it sounds.** It only triggers when the bundle is *stale*,
so it is invisible on any run where someone happened to build recently — the exact
intermittency that made #23 take three attempts to diagnose. And
`public/v2/app/bundle.js` is **gitignored**, so `git checkout` and `git stash`
cannot restore it: once poisoned, the only recovery is knowing to rebuild with the
variable unset. A contributor who does not know that sees a totally broken
dashboard with a clean `git status`.

**The fix belongs at the chokepoint, not the four call sites.** `ensureBundleBuilt`
should pass an explicit environment to `execSync` rather than inheriting an
ambient one — `vite.config.mjs` is unconditionally `mode: 'production'`, so there
is no case where the caller's `NODE_ENV` should influence that build. Moving four
assignments fixes today's four scripts and leaves the fifth one someone writes next
month broken in the same way.

Worth a guard as well as a fix, and a cheap one: assert the built bundle contains
no `jsxDEV`. That is a single `grep -c` over an artefact the browser suite already
depends on, and it turns a silent poisoning into a named failure.

### Fixed at the chokepoint, and this entry had two wrong numbers

`ensureBundleBuilt` now passes an explicit environment to `execSync`: 93 of 94
variables are forwarded unchanged — `PATH` included — with only `NODE_ENV` forced
to `production` (the value `vite.config.mjs` already hard-codes into `define`) and
`VITE_USER_NODE_ENV` deleted, since that is Vite's own carrier for a caller-supplied
value and outranks the default. `tests/bundleNoDevJsx.test.js` is the guard, and it
treats an **absent** bundle as its own failure rather than a pass.

**Both figures above were wrong**, and the second is the instructive one:

- The poisoned build is **1,687,870** bytes, not 1,687,180. That number was Vite's
  rounded console line `1,687.18 kB` read as bytes.
- **1,682 is a count of matching LINES, because `grep -c` counts lines and not
  occurrences.** The real occurrence count is **1,836**. A line-count reported as a
  call-count is the same shape as every other measurement error in this register:
  the tool answered a narrower question than the one being asked, and the answer
  looked plausible enough not to check.

**And the exposure was larger than the table.** *Six* scripts set
`process.env.NODE_ENV = 'test'`; the four listed are simply the ones that also call
`ensureBundleBuilt` today. `verify_research_actionability.js:13` and
`verify_drive_path_modal.js:31` are unarmed by accident, not by design — one added
line each and they join the set. The "fifth script someone writes next month"
argument for fixing the chokepoint was already half-materialised when it was made.

**Verified independently, not from the diff.** Poisoned the bundle (1,836
occurrences, 1,687,870 bytes), confirmed the guard fails naming all three figures,
touched `src/v2/main.jsx` so `isBundleStale()` returned true, then ran
`NODE_ENV=test node scripts/verify_v2_navigation.js` — the exact condition that
fires the defect. It rebuilt the bundle **byte-identical to the known-good copy**
(md5 `7e5abec4…`, 1,352,202 bytes, 0 occurrences) and passed with 0 console errors.
Before the fix the same run died on `s.jsxDEV is not a function`.

The four scripts were deliberately **not** edited. Their assignments have a real
in-process purpose (`server/http/routes/runtime.js:29` reads `NODE_ENV`), the
chokepoint makes them harmless, and `scripts/` is a `SOURCE_ROOT` in
`docs/code-index.md`, which records line counts — deleting a line from each would
stale the checked-in index.

---

## 26. The "no live save in the unit suite" guard is a text scan, and the suite reaches the save anyway — **fixed 2026-08-28; re-verified 2026-08-29**

> **The text scan is gone.** `tests/noLiveSaveInUnitSuite.test.js` now *runs* the
> suite — `spawnSync` of the whole runner with `TI_SAVE_PATH` pointed at a missing
> folder and an fs-watch hook installed through `NODE_OPTIONS` — so a live-save read
> reached through a helper, a fixture or a server is caught by behaviour rather than
> by grepping the test's own source. It proved itself the same week: when RECORDS'
> conversion left `missionControlLayout.test.js` failing, the guard's pinned
> failure-set caught the new file immediately, which is exactly the case the text
> scan could not see. The description below is kept for the diagnosis.

Found 2026-08-27 by an agent whose intermediate `npm test` runs failed three
different ways while the user was playing, and who noticed that CLAUDE.md promises
this cannot happen.

CLAUDE.md states: *"`npm test` — unit suite only. **Reads committed fixtures, not
the live save folder.** Must pass identically with the game running."*

`tests/noLiveSaveInUnitSuite.test.js` is what enforces that. **It is a scan of test
files' own source text** for three literal patterns — `loadFilteredSnapshot`,
`loadSnapshot()` with no arguments, and `latest: true`. It reads each `.test.js`
under `tests/` and greps it.

**So it can only see a live-save read that is spelled out in the test file itself.**
It cannot see one reached through a helper, a fixture, or — the case here — a
server. Confirmed by inspection: `tests/missionControlLayout.test.js` requires
`server/index.js`, which resolves and reads the **newest save in the configured
folder**. Nothing in that test file matches any forbidden pattern, so the guard
passes it.

This is the same shape CLAUDE.md already records for a different guard: *"the
`SERVICE_ROLE` test scanned one file, and a later split moved the key-resolving code
into a sibling it no longer covered."* A source-text guard measures spelling, not
behaviour, and behaviour is what the rule is about.

**Reported but not reproduced by me**, so recorded as the finder's observation
rather than as measurement: three transient failures during runs against a save the
game was actively writing — `controlPointCap.test.js:972` throwing `EBUSY` on
`Autosave.gz`, `markdownExports.test.js:694` getting a 500 where it expected 200,
and `missionControlLayout.test.js:350` failing once on a missing grid with its log
showing `CombatAutosave.gz` parsed on one run and `Autosave.gz` on the next. All
three passed in isolation and in the final run. I could not trace the first two to
a live-save read by inspection — both use fixtures and neither requires
`server/index.js` — so either there is a second route I have not found, or those two
have an unrelated cause.

**Why it matters more than a flaky test.** Every "npm test green" in this repo's
history is only as trustworthy as that promise, and the promise is what lets the
suite be run while the game is open — which is how it is run almost every time. This
is the second defect this week where the evidence for a claim was weaker than the
claim (see #23), and the first where the weakness is in a guarantee the project
documents about itself.

**The fix is a behavioural check, not a longer pattern list.** Adding
`require('server/index')` to `FORBIDDEN` would catch today's instance and miss the
next route. Something that observes whether the save folder is *read* during a unit
run — an `fs` hook, or a run against a deliberately absent/renamed save folder that
must still pass — measures the actual rule.

---

## What these have in common

Nine of the fourteen are the same defect: **an unmeasured value given a confident
default at the render boundary.** Not in the engine, not in the save parser —
those layers are careful. It happens in the last few lines before the DOM, where
`?? 0`, `|| 0` and `?? 5.0` look like defensive programming.

The two `?? <literal>` cases (#1, #4) are the worst of them, because a fabricated
*ceiling* or *baseline* produces a derived ratio that is wrong in a way no reader
can detect.

`<Value>` in Track E exists to make this class structurally impossible, which is
the argument for fixing these **as part of** the component migrations rather than
before: a port that keeps `?? 5.0` has not migrated the panel, it has laundered
the defect through a new component. #3 is the proof that this works — it was
corrected during the `mc-budget` port rather than carried across, and the test
asserting the correction did not exist before the migration.

### The second shape, added 2026-08-25

#13 and #14 are not absence-rendered-as-presence. They are a **partial or
qualified value rendered as a total one**, and they have a distinguishing
feature: in both cases the producing module **anticipated this consumer in a
comment** and the render boundary ignored it anyway.

- `simulation.js:576` — "The band never travels without what it covers."
  The component renders the band alone.
- `engagementModel.mjs:58` — `winnable: false` means above the swept ceiling,
  "**NEVER** this cannot be won." The component prints `UNWINNABLE`.

This shape is harder to catch than `|| 0`, because nothing is missing and no
value is wrong — the number shown is real, it is simply not the whole claim.
Grep finds `?? 0`; it does not find a dropped `uncertainty`. The check that
works is asking, per field, **what the producer said this value does not mean**,
and it is worth running against the remaining components rather than waiting to
stumble on the next one.
