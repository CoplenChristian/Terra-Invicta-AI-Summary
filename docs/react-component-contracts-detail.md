# Component data contracts — full detail

Written 2026-08-24 against `main` @ `6368c88`. The per-component depth behind
`docs/react-component-contracts.md`, which carries the summary, the corrected pin
table and the cross-cutting findings.

Produced by five parallel read-only passes over every component. Each answers the
same six questions — payload shape, player-mode difference, unavailable and empty
states, measured/estimated registers, truncation fields, and required shared
primitive — with `file:line` evidence.

**Read the summary doc first.** It records which of these findings contradicted
the original contracts, and it is where the corrections live. This file is the
working detail, kept because a component phase should not have to re-derive it.

**A contract is only true on the day it is written.** Re-check before migrating.
Five of these components had a test file created underneath them while this
analysis was running.

Groups, in the order they appear below:

1. `unlocked-tech` · `mc-budget` · `strategic-commentary` · `council-orders` · `detail-panel`
2. `fleet-engagement` · `mining-expansion` · `alien-hate-economics` · `executive-boards`
3. `fleet-procurement` · `research-advisor` · `world-map`
4. `intelligence-library` · `faction-intel` · `directive-board`
5. `drive-explorer`

---

# Component data contracts — Group 1

`unlocked-tech` · `mc-budget` · `strategic-commentary` · `council-orders` · `detail-panel`

Written 2026-08-24 against `main` @ `6368c88`. Depth pass over
`docs/react-component-contracts.md`. Every claim below carries a `file:line`;
where the source cannot answer, it says "not determinable from source" rather
than guessing.

**Three findings contradict `docs/react-component-contracts.md` and are marked
`[CONTRADICTS-DOC]` inline.**

**Shared primitives already exist on disk, uncommitted**, at
`src/v2/components/` — barrel `src/v2/components/index.js:7-13` exports `Panel`,
`DataTable`, `TABLE_VARIANTS`, `Measured`, `Estimated`, `Value`,
`TruncationNote`. `git status` reports the whole directory as `??` (untracked),
so this is another track's in-flight work, not `main`. Section 6 of each
component is written against those real signatures rather than against the names
in the plan — **but they may still move.** Re-check the signatures before
building against them, particularly `TruncationNote`'s label props and
`TABLE_VARIANTS`.

**A fact that changes section 6 for all four rendered components:** every mount
point already sits *inside* a hand-written `.tech-card` in
`public/v2/index.html` — `councilOrders` at `:251-261`, `strategicCommentary` at
`:357-367`, `mcBudget` at `:426-436`, `unlockedTech` at `:552-562`. `Panel`
renders the `.tech-card` wrapper itself
(`src/v2/components/Panel.jsx:56-67`). So **none of the four needs `Panel`
unless the migration also deletes the surrounding card from `index.html`** —
and mounting `Panel` without deleting it produces a nested double card.

---

## unlocked-tech

`public/v2/js/components/unlocked-tech.js` (371 lines) · class **F** ·
`window.MissionControlUnlockedTech` · pinned by `tests/unlockedTechPanel.test.js`

### 1. Payload

**Not `render(root, payload)`.** The only export is
`load(observerId, mode, container)` — `unlocked-tech.js:355,370`. Call site is
`public/v2/js/mission-control.js:421`, inside the lazy `records` view branch
(`:416-422`), guarded by a per-view load key (`:419-420`) so it fires once per
`observer+mode`.

Two endpoints, and it consumes only a slice of each.

**`/api/intel/tech-tree?observer=&mode=&category=all&includeEffects=false`**
(`unlocked-tech.js:134-136`) — consumed fields:

| field | read at | use |
| --- | --- | --- |
| `payload.nodes` (array) | `:137` | the only top-level field touched |
| `node.type` | `:138` | filtered to `=== 'faction_project'` |
| `node.status` | `:69`, `:85-88`, `:235` | `'completed'` ⇒ unlocked |
| `node.displayName` | `:118`, `:154`, `:233` | row title, sort key, match test |
| `node.id` | `:154`, `:233`, `:239` | fallback title, mono sub-line |
| `node.researchCost` | `:78` | cost label |
| `node.category` | `:92-95` | camel-split, uppercased |
| `node.unlocks[]` | `:117`, `:221`, `:227` | item chips |
| `unlock.id`, `unlock.displayName` | `:119-120`, `:251-252` | chip text, match set |

Everything else the endpoint returns — `counts`, `categories`, `unlockClasses`
(`shared/techGraph.mjs:1124-1134`) and per-node `subcategory`,
`researchProgress`, `researchPercent`, `completed`, `researching`, `available`,
`locked`, `prerequisites`, `availability`, `contributors`
(`shared/techGraph.mjs:1092-1116`) — is **read but discarded**. The census
(`:147-149`) is recomputed client-side from `projects.length` rather than taken
from `counts.projects`.

**`/api/intel/tech-search?observer=&mode=&q=`** (`unlocked-tech.js:176-178`) —
consumes only `payload.items` (`:179`). Server shape is
`shared/techGraph.mjs:885-892`: `{ id, displayName, category, status, unlocks[],
researchCost }` — a strict subset of the tree node with the same names, so
`renderRow` works over both. `unlocks[].id` is `u.targetId` on **both** paths
(`shared/techGraph.mjs:890` and `:1107`), so the `matchedIds` set at
`unlocked-tech.js:220` keys correctly regardless of which endpoint produced the
row. Verified, not assumed — this was the obvious place for a shape mismatch.

Error contract: `fetchJson` (`:122-130`) throws `payload.error` when present,
else `HTTP <status>`.

### 2. Player-mode difference

**Mode-invariant, and structurally so — stronger than the header's claim.**

The component header (`:36-39`) cites a live-save spot check on 2026-08-21. The
source gives a better answer:

- `observerGraph(snapshot, mode, observerId)` reads
  `(tree.factionStatus || {})[observerId]` — `shared/techGraph.mjs:1075`. Always
  the **observer's own** faction status, in either mode.
- `mode` is placed on the `saveState` object at `shared/techGraph.mjs:1084` and
  then **never read**: `applySaveState` (`shared/techGraph.mjs:360-460`) contains
  no reference to `saveState.mode`. Verified by scanning the whole function body.
- Every status the panel renders is derived from `finishedTechs`,
  `completedProjects`, `availableProjectNames`, `currentProjects`
  (`shared/techGraph.mjs:361-371`) — all observer-own.

So `mode` travels the full request path as a dead parameter. Two consequences
for a rewrite: the panel is genuinely safe to verify in one mode, **and** the
`changed` check at `unlocked-tech.js:357` that busts the cache on a mode switch
is doing unnecessary work (harmless, but do not "fix" it into a correctness
dependency).

Not verifiable from the committed fixtures: `queryFixtureIntel({ endpoint:
'tech-tree' })` returns `nodes: []` in both modes because
`tests/fixtures/snapshot-*-intel.json` carry no `techTree`. Measured 2026-08-24.
Any characterisation test must build a synthetic graph or use a live save.

### 3. Unavailable and empty states

Eight distinct states. Six are honest refusals; note which input produces each.

| # | rendered | condition | line |
| --- | --- | --- | --- |
| 1 | `The unlocked technology index is unavailable: <reason>` | `status === 'error'` — either fetch threw | `:263-265` |
| 2 | `Reading the research graph…` | `status === 'loading'` **and** no prior results | `:266-268` |
| 3 | `Nothing [unlocked ]matches "<q>". [Switch to ALL…]` | 0 rows **with** a query | `:273-278` |
| 4 | **`The project census is unavailable, so this panel cannot say what this faction has unlocked.`** | 0 rows, no query, **`totalProjects === null`** | `:283-285` |
| 5 | `This faction has not completed any research projects yet.` | 0 rows, no query, census **read** | `:286` |
| 6 | `Project census unavailable.` (footer) | `unlockedCount === null \|\| totalProjects === null` | `:301-303` |
| 7 | `RESEARCH COST UNAVAILABLE` (per row) | `costLabel()` returns null | `:241-243` |
| 8 | `UNKNOWN` (status chip, `scope === 'all'` only) | `status` absent or non-string | `:85-88`, `:235` |

**The load-bearing null discipline, and where a rewrite will break it:**

- `costLabel` (`:77-83`) returns **`null`**, never `0`, for `null`/`undefined`/
  `''`/non-finite. Pinned by `tests/unlockedTechPanel.test.js:302-311`, which
  asserts the literal `return null;` is present in the function source.
- `ensureGraph` (`:137-149`) treats **`nodes` missing and `nodes` empty as the
  same unreadable state** — `censusRead = projects.length > 0` (`:147`), so both
  yield `totalProjects = null`. The comment at `:140-146` records that this used
  to print "0 unlocked of 0 projects". States 4 and 6 exist only because of this.
  Pinned by `tests/unlockedTechPanel.test.js:392-424`.
- `Number(null) === 0` risk in a rewrite: state 4 and state 5 are **opposite
  claims** off the same empty row list. A rewrite that collapses them to one
  "nothing found" branch re-introduces the exact defect the comment describes.

### 4. Measured vs estimated registers

**None.** Zero occurrences of `de-measured` / `fe-meas` / `mining-meas` /
`*-est` / `estimated` anywhere in the file (grepped 2026-08-24). No verify
script asserts computed style against it. Nothing to preserve.

### 5. Truncation

**Two caps, both announced. Neither uses `*TotalCount` / `*OmittedCount` field
names — the counts are computed locally.**

1. **Row cap `RENDER_CAP = 60`** (`:49`). Applied `:289-290`:
   `shown = rows.slice(0, RENDER_CAP)`, `omitted = rows.length - shown.length`.
   Announced by `renderFooter(rows.length, shown.length, omitted)` (`:294`,
   `:298-313`) as *"N shown of M matching — K omitted by the 60-row display cap;
   narrow the search to see them"*.

   **Pinned by exact string match** —
   `tests/unlockedTechPanel.test.js:297-299` regex-matches the component's own
   source for `RENDER_CAP\s*=\s*\d+`, the literal
   `omitted by the ${RENDER_CAP}-row display cap`, and `shown of ${totalCount`.
   **These are source-text assertions, not render assertions.** A React rewrite
   changes the source text and fails all three even if the rendered output is
   byte-identical. Update the test in the same commit or it blocks the migration.

2. **Per-row unlock cap of 6** (`:227-228`): `unlocks.slice(0, 6)`, remainder
   announced as `+N more of M` (`:255-257`). The count beside the row
   (`:244-246`) is deliberately the **true** `unlocks.length`, not the shown
   length — comment at `:226`.

Must survive: the `60`, the `6`, the true totals beside both, and the fact that
the census line and the cap line are **two separate spans** (`:307-312`) — the
census can be unavailable while the cap line is fine.

### 6. Primitive

`TruncationNote` (both caps) — with one fidelity caveat. `Value` is optional.

**Fidelity caveat, not a new primitive.** `TruncationNote`'s truncated branch
emits a fixed sentence: `"<shown> shown · <omitted> omitted (<total> total)"`
(`src/v2/components/TruncationNote.jsx:73-76`). It exposes `unknownLabel` and
`allShownLabel` overrides but **no override for the truncated wording**
(`:22-31`). unlocked-tech's footer wording differs and names the cap and the
remedy, and it is pinned by string match (§5). Either accept a wording change and
update the test, or pass the counts through and render the sentence locally.
Adding a `truncatedLabel` prop is a primitive change — **flag it before doing it**.

`Panel` is **not** needed: the card is already in `index.html:552-562`.
`DataTable` is not needed — the panel is a `<ul>`/`<li>` list (`:231`, `:249`),
not a table. No `Measured`/`Estimated`.

**Nothing outside the five is required.**

---

## mc-budget

`public/v2/js/components/mc-budget.js` (187 lines) · class **R** ·
`window.MissionControlMcBudget`

### 1. Payload

`render(root, payload)` — `mc-budget.js:48`, `:186`.

Call site `public/v2/js/mission-control.js:1221-1227`:

```js
window.MissionControlMcBudget.render(
  document.getElementById('mcBudget'),
  { economics: state.rawSnapshot.alienHateEconomics,
    shipHullStats: state.rawSnapshot.shipHullStats }
);
```

Note the source: **`state.rawSnapshot`, not `state.briefing`.** Both keys are
top-level snapshot fields — `alienHateEconomics` at
`server/intelligenceFilter.js:182` (omniscient) and `:631` (player);
`shipHullStats` at `:187` and `:636`.

**Exactly six fields of `economics` are consumed**, out of the ~30
`buildAlienHateEconomics` returns (`shared/alienHateEconomics.mjs:309-`):

| field | read at | producer |
| --- | --- | --- |
| `applicable` | `:53` | `shared/alienHateEconomics.mjs:229` |
| `usedMissionControl` | `:58` | `:254` |
| `missionControlCapacity` | `:59` | `:255` |
| `mcWarFloor` | `:60` | `:271-273` |
| `difficultyMultiplier` | `:61` | `:231` |
| `concealmentMultiplier` | `:62` | `:253` |

`shipHullStats` is `{ [hullName]: { missionControl, baseConstructionTimeDays,
… } }` — only those two keys are read (`:67`, `:138`, `:144`). Real records also
carry `constructionTier`, `noseHardpoints`, `hullHardpoints`,
`structuralIntegrity`, `requiredProjectName` (measured against
`tests/fixtures/snapshot-player-intel.json`, 2026-08-24); all discarded.

**Component-owned mutable state:** `state.staged` (`:22`), a hull→count map that
survives across renders and is *not* in the payload. `render` re-enters itself
on every stepper click (`:174`, `:181`) with the **captured** `payload` from the
closure. A React rewrite must hold `staged` as component state and must not
reset it when the controller re-renders with a fresh snapshot — today it
persists across a save refresh, which is behaviour, not an accident.

### 2. Player-mode difference

**Mode-invariant — and this is a genuine finding, because its sibling panel is
not.**

`buildAlienHateEconomics` has exactly one mode gate:
`shared/alienHateEconomics.mjs:257` —

```js
const actualAlienHate = mode === 'player' ? null : actualRaw;
```

That null then propagates to `hateAboveFloor` (`:262-264`), `currentWarStatus`
(`:296-303`), `totalWar.state` / `hateRemaining` (`:275-280`, `:184-202`) and
`actualHateVisibility` (`:322-326`). **None of those six is read by mc-budget.**
Every field it *does* read is computed upstream of the gate:

- `applicable` — faction-name only (`:227-229`).
- `usedMissionControl` / `missionControlCapacity` — the **observer's own**
  faction record (`:254-255`).
- `difficultyMultiplier` — `rawSnapshot.metadata?.difficulty`
  (`server/intelligenceFilter.js:117`), read inside a closure defined at `:114`
  **before** the mode branch at `:140`, so both branches see raw metadata.
- `concealmentMultiplier` — observer's own completed projects (`:232-253`).
- `mcWarFloor` — `WAR_THRESHOLD / (difficulty × concealment)` (`:271-273`); no
  hate term.

Empirically confirmed against the frozen fixtures (2026-08-24):
`applicable` `true`/`true`, `usedMissionControl` `152`/`152`,
`missionControlCapacity` `170`/`170`, `mcWarFloor`
`208.333…`/`208.333…` — while `actualAlienHate` is `undefined`(player) vs
`50.30424`(omniscient) in the same pair. The redaction is present and it does not
reach this panel. `shipHullStats` passes unfiltered in both branches
(`server/intelligenceFilter.js:187`, `:636`).

Contrast worth carrying: `alien-hate-economics`, which mounts on the same
snapshot field, **is** mode-varying. Mode-invariance is a property of the
six-field projection, not of `alienHateEconomics`.

### 3. Unavailable and empty states

`num()` (`:24-28`) is the correct guard — presence checked before coercion,
non-finite → `null`. `fmt()` (`:30-33`) renders `'UNAVAILABLE'` for null.

| rendered | condition | line |
| --- | --- | --- |
| `MC BUDGET UNAVAILABLE` (whole panel) | `!economics \|\| !economics.applicable` | `:53-56` |
| `PROJECTED FLOOR UNAVAILABLE` | `projectedUsed === null` ⇐ `used === null` | `:72-73`, `:105` |
| `Used now UNAVAILABLE` | `usedMissionControl` absent | `:111` |
| `of UNAVAILABLE capacity` | `missionControlCapacity` absent | `:112` |
| `Headroom to cap UNAVAILABLE` | either `cap` or `used` absent | `:93`, `:115` |
| `Headroom to war floor UNAVAILABLE` | either `warFloor` or `used` absent | `:94`, `:119` |
| `? MC` (per hull) | `stats.missionControl` absent | `:143` |
| construction-time suffix omitted | `baseConstructionTimeDays` falsy | `:144` |

`tests/mc-budget.test.js` pins the whole set (`:151-183`, `:185-203`) and
forbids the literal strings `null` / `undefined` / `NaN` / `[object Object]`
anywhere in rendered text (`:36-48`). **That file is untracked** (`git status`
`??`, 2026-08-24) — in-flight work from another track, not coverage on `main`.

#### DEFECT — a live `Number(null) === 0` at `mc-budget.js:61-62`

```js
const multiplier = (num(economics.difficultyMultiplier) || 0)
  * (num(economics.concealmentMultiplier) || 1);
```

`num()` correctly returns `null`, and `|| 0` then destroys it. `projectedFloor =
projectedUsed * multiplier` (`:73`) becomes a hard `0`, and `fmt(0)` prints
`"0.0"` — a confident zero for a value that was never measured.

**Measured 2026-08-24** by running the component through the repo's own
`tests/fixtures/renderHarness`, with `usedMissionControl: 152`,
`missionControlCapacity: 170`, `mcWarFloor: 208.33`:

| `difficultyMultiplier` | `concealmentMultiplier` | rendered |
| --- | --- | --- |
| `null` | `1` | **`PROJECTED FLOOR 0.0`** |
| *absent* | `1` | **`PROJECTED FLOOR 0.0`** |
| `0.3` | `null` | `PROJECTED FLOOR 45.6` |
| `0.3` | `0.64` | `PROJECTED FLOOR 29.2` |

The same `0.0` also reaches the `WITHIN BUDGET` note at `:90`
(`floor ${fmt(projectedFloor)}`).

`difficultyMultiplier` goes null whenever `DIFFICULTY_MULTIPLIERS[difficultyKey]`
misses (`shared/alienHateEconomics.mjs:231`) — an absent or unrecognised
`metadata.difficulty`. Not hypothetical: `tests/fixtures/snapshot-player.json`
and `snapshot-omniscient.json` both omit the field entirely.

**Why no test caught it:** `tests/mc-budget.test.js:151-183` nulls *every*
metric at once, so `used === null` short-circuits at `:72` and the panel reaches
`UNAVAILABLE` for a different reason. The case "used measured, multiplier
absent" is untested. `:185-203` is the near miss — it nulls `capacity` only and
keeps both multipliers real.

`|| 1` for concealment (row 3) is defensible — no completed concealment project
genuinely means a factor of 1. `|| 0` for difficulty is not. **A rewrite must
not copy line 61 forward.** The correct behaviour is `projectedFloor = null`
when either multiplier is unreadable.

### 4. Measured vs estimated registers

**None.** No register classes in the file, no verify script asserts computed
style on it.

### 5. Truncation

**One cap, and it is silent.** `orderedHulls` (`:42-46`):

```js
const lead = HULL_ORDER.filter(name => known.includes(name));
return lead.length ? lead : known.slice(0, 8);
```

`HULL_ORDER` (`:37-40`) is 8 names. Measured against
`tests/fixtures/snapshot-player-intel.json` (2026-08-24): `shipHullStats` has
**28 keys; 8 render; 20 are dropped with no count anywhere on the page.** Five of
the twenty are human-buildable — `Gunship`, `Corvette`, `Dreadnought`, `Titan`,
`STOFighter` — the rest are `Alien*` and `SalamanderGunship`.

`[CONTRADICTS-DOC]` — and contradicts the file's own docstring at `:35-36`:
*"Anything the save exposes is offered, but these lead…"*. Nothing but the eight
is offered. The comment describes a lead-then-rest ordering the code does not
implement.

The `known.slice(0, 8)` fallback is a **second** silent cap, reached only when no
canonical name is present. Pinned as behaviour by
`tests/mc-budget.test.js:364` — so it must survive, but it announces nothing.

**No `*TotalCount` / `*OmittedCount` field exists to preserve, because none was
ever emitted.** A rewrite should add `TruncationNote` with `totalCount:
Object.keys(hullStats).length` and `omittedCount: total - shown`; that is new
honesty, not a regression, and should be called out rather than slipped in.

### 6. Primitive

`Value` — every `fmt()` call site (`:105`, `:111-119`) is a
number-or-`UNAVAILABLE`. `Value` matches: `defaultFormat` returns the literal
`'UNAVAILABLE'` for null/non-finite (`src/v2/components/Value.jsx:16-23`) and
tags the span `data-value-state="unavailable"` (`:61-72`). Pass `present={true}`
and let `format` decide — `present={false}` yields the em-dash `absentLabel`
(`:45-55`), which is **not** what this panel renders and would break the
`UNAVAILABLE` assertions in `tests/mc-budget.test.js`.

`TruncationNote` — for the hull cap (§5), if the silent truncation is fixed.

`Panel` **not** needed (card at `index.html:426-436`). `DataTable` not needed —
the metric grid and hull list are `<div>` grids (`:109-126`, `:135-154`), not
tables. No `Measured`/`Estimated`.

**Nothing outside the five is required.** The stepper buttons (`:147-149`) are
plain `<button>`s, not a primitive.

---

## strategic-commentary

`public/v2/js/components/strategic-commentary.js` (202 lines) · class **R** ·
`window.MissionControlStrategicCommentary` · pinned by
`tests/strategicCommentary.test.js`

### 1. Payload

`renderStrategicCommentary(commentaryData, containerId = 'strategicCommentary')`
— `:16`, `:198-200`.

`[CONTRADICTS-DOC]` — **this is not `render(root, payload)`.** It takes a
*container id string*, not a root element, and resolves it itself via
`document.getElementById(containerId)` (`:17`). The doc's claim at
`docs/react-component-contracts.md:20-27` that the R class already has a
`render(root, payload)` props contract does not hold for this component.

Call site `public/v2/js/mission-control.js:1178-1181`:

```js
window.MissionControlStrategicCommentary.renderStrategicCommentary(
  state.briefing?.strategicCommentary, 'strategicCommentary'
);
```

Producer: `server/briefingGenerator.js:313`, `:353`; shape at
`server/commentary/index.js:54-76`.

Consumed fields:

| field | read at | notes |
| --- | --- | --- |
| `available` | `:20` | `=== false` ⇒ empty branch |
| `reason` | `:23` | shown in the empty branch |
| `mode` | `:30` | drives the badge string |
| `headline` | `:189` | |
| `prose` | `:190` | |
| `beats[]` `{ id, name, severity, summary }` | `:35-43` | |
| `simulation.available` | `:52`, `:62` | |
| `simulation.reason` | `:59` | |
| `simulation.ownBestDesign` / `.ownBestHull` | `:66` | first non-empty wins |
| `simulation.tiers[]` `{ label, description, winnable, bandLabel }` | `:78-88` | |
| `simulation.projections.hateVent` | `:99-119` | |
| `simulation.projections.rebuildClock` | `:122-180` | |

`hateVent` consumed: `available`, `bandLabel`, `reason`.
`rebuildClock` consumed: `available`, `reason`, `monthlyThroughputEst`,
`daysPerHullEst`, `nextCompletionDays`, `concurrentBuilds`, `shipyardCount`,
`waitingBehindCount`, `throughputBound`, `throughputUnavailableReason`,
`targetHull` (`:141-168`).

**Discarded:** `advice` (`server/commentary/index.js:60`), `snapshotId` (`:57`),
`simulation.source` (`:69`), `simulation.ownRating` (`:72`), and per-tier `id`,
`p20`, `p80`, `simulated`, **`uncertainty`** (`server/commentary/simulation.js:566-579`).
`uncertainty` is notable: the server comment at `:575-578` says *"The band never
travels without what it covers"* — and the component renders `bandLabel` alone
(`:84`), which is exactly what that comment warns against. Pre-existing, out of
scope for a rewrite, worth not entrenching.

**Out-of-tree DOM write.** `:28-33` reaches `document.getElementById('commentaryModeBadge')`
and sets its `textContent`. That element is at `public/v2/index.html:360` — in the
card **header**, *outside* `#strategicCommentary` (`:363`). See §6.

### 2. Player-mode difference

**Genuinely a different answer — the most mode-sensitive of these five. Two
independent axes.**

**(a) Opponent tiers are built from different data.**
`server/commentary/simulation.js:518-539`:

- omniscient — `buildOmniscientOpponentTiers(alienDesigns)` over designs filtered
  to `factionName === 'the Aliens' || factionId 4717` (`:519-523`), source
  `true_design_blueprints`, basis `OPPONENT_RATING_BASIS.omniscient`.
- player — `buildPlayerOpponentTiers(alienFleets, ownRating)` (`:531-533`), source
  `observable_fleet_telemetry`, basis `OPPONENT_RATING_BASIS.player`. Player tiers
  are built by **scaling the observer's own rating** against observed alien fleet
  armour medians.

Both feed `findRequiredHullsForTier(ownRating, tier.opponentRating, …,
{ opponentRatingBasis })` (`:560-565`), so **the `bandLabel` in the "Threshold
Required" column is a different number in each mode.** The component itself
signals this: `'OMNISCIENT BLUEPRINTS'` vs `'OBSERVED TELEMETRY'` (`:30-32`).

The *unavailable reasons* also differ and are mutually exclusive: player names
*"N alien fleet(s) … none carries a readable, positive armour median"*
(`:535-537`); omniscient names *"N alien design(s) … none carries a readable
combat value"* (`:526-528`).

**(b) `hateVent` can never be available in player mode.**
`server/commentary/simulation.js:613-619` — the first branch tests
`actualAlienHate === null`, and player mode nulls it by redaction
(`shared/alienHateEconomics.mjs:257`). The comment at `:593-599` states it
outright: *"the first clause can NEVER pass there"*, measured 42.86 omniscient vs
null player on 2026-08-22.

**The component's player-mode output is therefore always the UNAVAILABLE card at
`:113-119`, never the available card at `:100-106`.** A rewrite verified only in
omniscient exercises a branch player mode cannot reach, and vice versa.

### 3. Unavailable and empty states

Ten states.

| # | rendered | condition | line |
| --- | --- | --- | --- |
| 1 | `<reason>` in `.commentary-empty` | `!commentaryData \|\| available === false` | `:20-26` |
| 2 | `Strategic commentary telemetry unavailable for this save.` | as #1 **and** no `reason` | `:23` |
| 3 | badge `OBSERVED TELEMETRY` | `mode !== 'omniscient'` | `:30-32` |
| 4 | beats block omitted entirely | `beats` absent or empty | `:35-45` |
| 5 | `NOT SIMULATED` + `<sim.reason>` | `sim.available === false` | `:52-61` |
| 6 | `The combat-threshold simulation did not run and gave no reason; no hull count is reported.` | `available === false` **and** no `reason` | `:59-60` |
| 7 | sim block omitted entirely | `available` neither `false` nor (true + non-empty `tiers`) — e.g. `undefined` | `:48`, `:52`, `:62` |
| 8 | `UNWINNABLE` (per tier) | `tier.winnable` falsy | `:85` |
| 9 | `HATE VENT HORIZON / UNAVAILABLE / <reason>` | `hateVent` present, not available, has `reason` | `:107-119` |
| 10 | `PRODUCTION THROUGHPUT / UNAVAILABLE / <reason>` | `rebuildClock` present, not available, has `reason` | `:171-180` |

Plus, inside the *available* throughput card (`:141-168`), five further
sub-states that are honest refusals rather than zeros:

- `headline = 'UNAVAILABLE'` when `monthlyThroughputEst` is non-finite (`:150-152`)
- `rateDetail` falls to `throughputUnavailableReason` or
  `'no build time was readable'` (`:153-154`)
- `'nothing is building'` when `days` is non-finite (`:157`)
- `'… — yard count unread'` when `shipyardCount` is non-finite (`:160-162`)
- `'no horizon read'` when `nextCompletionDays` is non-finite (`:163`)
- `≥` prefix when `throughputBound === 'lower'` (`:149`) — the printed rate is a
  **floor**, not a point estimate
- sub-1 rates print as `1 per N days` rather than a rounded `~1 hulls/mo`
  (`:148`, `:152`) — comment at `:123-133` records the defect that motivated it

**`Number.isFinite` is used throughout (`:148-163`) rather than `|| 0`.** A
measured `0` is preserved as a reading (comment `:131-132`). Do not replace with
truthiness checks.

**Gap worth naming:** when the simulation is unavailable, both unavailable
branches return `projections: {}`
(`server/commentary/simulation.js:503`, `:553`). The component then reads
`sim.projections || {}` (`:96`) and finds no `hateVent` / `rebuildClock`, so
states 9 and 10 **silently vanish** — the reader gets the NOT SIMULATED notice
and no explanation for the two missing cards. Pre-existing; a rewrite should not
be blamed for it, and should not paper over it either.

### 4. Measured vs estimated registers

**None in this component.** No register classes present; no verify script
asserts computed style on it.

The *honesty* device it does carry is the `MONTE CARLO SIMULATED` badge (`:67`)
against `NOT SIMULATED` (`:57`), and the `simulated: true` flags the server sets
(`server/commentary/simulation.js:574`, `:611`, `:653`). That is a
simulated-vs-not distinction, not the measured/estimated register the verify
scripts assert on `mining-expansion` / `fleet-engagement` / `drive-explorer`. Do
not map it onto `Measured`/`Estimated` — different claim.

### 5. Truncation

**No caps anywhere.** `beats.map` (`:38`), `tiers.map` (`:78`) — both unbounded.
`projCards` is at most 2 by construction (`:97`, `:99-181`). No `*TotalCount` /
`*OmittedCount` field is produced or consumed. Nothing to preserve.

### 6. Primitive — FLAG

`Panel` **not** needed for the card body (`index.html:357-367`) — **but see the
badge problem below.**

#### The sim table needs a sixth `DataTable` variant

`:69-91` renders `<table class="commentary-sim-table">`. `TABLE_VARIANTS`
(`src/v2/components/tableVariants.js:8-63`) defines exactly five: `de`,
`mc-board`, `fe`, `mining`, `intel-library`. **`commentary-sim-table` is not
among them**, and `DataTable` **throws** on an unknown variant —
`src/v2/components/DataTable.jsx:12-16`:

```js
if (!config) throw new Error(`DataTable: unknown variant "${variantKey}"`);
```

So this component cannot use `DataTable` as it stands. Three options, in
increasing cost:

1. Render a raw `<table>` and skip the primitive. Cheapest; loses the shared
   scroll-hint machinery, which this table does not currently have anyway (no
   `.commentary-sim-*-wrap` or scroll hint exists in the markup).
2. Add a `commentary` variant to `tableVariants.js`. **This edits a shared
   primitive and therefore serialises against every other in-flight component.**
   Must be raised before it is done.
3. Restyle the table onto an existing variant. Changes rendered appearance;
   `tests/strategicCommentary.test.js` and the CSS both need re-checking.

Recommendation: **option 1** unless the migration owner wants the variant. Option
2 is the one that must not be taken unilaterally.

#### The badge is written outside the component's own root

`:28-33` sets `#commentaryModeBadge` (`index.html:360`), which lives in the
`.tech-card-header` — outside `#strategicCommentary`. React cannot render into
it from inside the mount. Three options:

1. Keep an imperative effect that writes the badge — works, but a React component
   mutating out-of-tree DOM is exactly the pattern the migration exists to remove.
2. Absorb the whole card with `Panel` and pass the badge as `headerAside`
   (`src/v2/components/Panel.jsx:33`, `:63`) — clean, and `Panel` already
   supports the `commentary` modifier (`:16`, matching
   `index.html:357`'s `tech-card--commentary`). **Requires deleting the
   hand-written card from `index.html:357-367`** and moving the mount up.
3. `createPortal` into `#commentaryModeBadge`.

Option 2 is the only one that uses `Panel` as designed, and it is the only place
among these five where `Panel` earns its keep.

Other primitives: `Value` is a poor fit here — the throughput card's states are
sentences with units and conditional prefixes (`:149-163`), not
number-or-UNAVAILABLE. Render those locally. No `TruncationNote` (§5), no
`Measured`/`Estimated` (§4).

---

## council-orders

`public/v2/js/components/council-orders.js` (348 lines) · class **R** ·
`window.MissionControlCouncilOrders` · **no named unit test**

### 1. Payload

`render(root, payload)` — `:285`, `:347`.

Call site `public/v2/js/mission-control.js:1193-1196`:

```js
window.MissionControlCouncilOrders.render(
  document.getElementById('councilOrders'),
  { engineDirectives: state.briefing?.engineDirectives }
);
```

The payload is a **one-key wrapper**; the component immediately narrows to
`payload.engineDirectives.cyclePlan` (`:287`). Nothing else on `engineDirectives`
is read — not `primary`, not `benched`, not `riskFloor`.

Producer: `server/briefingGenerator.js:373` ← `server/directiveEngine.js:228`,
`:291` ← `allocateCyclePlan` returning at `server/engine/assignment.js:1310-`.

**Three arrays consumed, and they carry three different shapes.** This is the
single most rewrite-hostile fact about the component.

**`cyclePlan.assignments[]`** — pairing objects,
`server/engine/pairing.js:202-222`:

| read | source |
| --- | --- |
| `.councilor` `{ name, profession, location }` | `buildCouncilorSummary`, `server/engine/pairing.js:41-48` |
| `.candidate` `{ friendlyName, missionType, missionSpec.friendlyName, title, family, target }` | `:204` |
| `.odds` | `:210`, shape `server/engine/odds.js:106-116` / `:60-72` |
| `.riskFloor` | attached later, `server/engine/assignment.js:762` |
| `.expectedHate` | `server/engine/pairing.js:212` — `null` when odds or hate weights are unknown (`:80`) |

**`cyclePlan.unassigned[]`** — `server/engine/assignment.js:1220-1230`:
`{ councilorId, name, profession, location, reason, reasonDetail, riskFloorHeld,
suggestedFreeAction, freeActionOptions }`. **Flat — `name` at top level, no
`.councilor` sub-object.**

**`cyclePlan.unavailable[]`** — `server/engine/assignment.js:647-655`:
`{ councilorId, name, status, reason, reasonDetail, suggestedFreeAction,
freeActionOptions }`. **Flat, and carries neither `profession` nor `location`.**

The component absorbs the shape difference with `entry.councilor || entry`
(`:216`, `:240`). **That fallback is load-bearing** — a rewrite that types the
three arrays as one `{ councilor: … }` shape renders the literal `'Councilor'`
(`:180`) for every idle and unavailable row. `personMeta` (`:185-188`) then
returns `''` for every `unavailable` entry, so the meta span is correctly omitted
(`:181`) — that is an empty state, not a bug.

**Cross-component index coupling.** `renderAssignmentRow(assignment, index)`
receives `index` from `assignments.map` (`:326`) and writes
`data-council-order-index` (`:200`). `focusDirectiveBoard` (`:265-283`) then
queries `.directive-assignment-card[data-assignment-index="${index}"]` inside
`#directiveBoard` (`:271-273`). `directive-board.js:695` maps the **same
uncapped** `cyclePlan.assignments` (`:656`) to the same indices (`:319`), and
reads back with `assignments[idx]` (`:722-723`). **Any re-sort, filter or
virtualisation of `assignments` in a council-orders rewrite silently scrolls to
the wrong card** — no error, wrong answer. There is no test on this.

### 2. Player-mode difference

**Genuinely two different plans — not a redaction of one. This is the strongest
mode difference of the five.**

`docs/README.md:108` records the measurement on frozen `ExitSave.gz`:

- omniscient primary — *"Purge the Protectorate hold on ExtractiveSector in
  China — score 68.75, EV 45.93 | 66.13"*
- player primary — *"Advise Government: United States of North America — score
  7.00, EV 10.03 | 19.30"*

and states explicitly: **"genuinely two plans, not a redaction of one."**
Corroborated at `docs/README.md:141` and `docs/control-point-cap-spec.md:421`.

The 19.30 / 66.13 pair cited in `docs/react-component-contracts.md:114` is
`cyclePlan.totalExpectedValue` (`server/engine/assignment.js:1249-1250`), which
**this component does not render** — so do not use it as the verification
target here. What differs *on screen* is the row set itself: different missions,
different targets, different councilor↔mission pairings, and different
`assignments`/`unassigned` bucket membership.

Root cause chain worth knowing: player mode masks enemy councilor attributes
(`server/intelligenceFilter.js:161-168` for the omniscient side; player masks
enemies), so a different candidate population reaches
`generateAllPairings` — which is the defect class CLAUDE.md records for
`server/engine/candidates/missions.js`.

Two knock-ons inside the component:

- `renderOddsCell` (`:141-158`) — the odds themselves differ per row because the
  rows differ; and rows whose `missionSpec` is absent take the
  `ODDS UNAVAILABLE` branch (`:147-149`), at a different rate per mode.
- `targetLabel` (`:65-89`) — `councilor` / `alienCouncilor` targets resolve
  through `t.councilorName || t.name || t.councilor?.displayName ||
  t.councilor?.name` (`:68`). Player mode's observed-enemy records are the risky
  input here; **not determinable from source** whether every observed enemy
  councilor carries a resolvable display name in player mode — it needs a live
  two-mode check, and if it fails the row reads `No fixed target` (`:208`)
  rather than erroring.

**Verify this component in both modes with different fixtures, not the same one
filtered.**

### 3. Unavailable and empty states

Fourteen. The component is unusually careful and every branch is deliberate.

| # | rendered | condition | line |
| --- | --- | --- | --- |
| 1 | `Cycle plan unavailable for this snapshot — no per-councilor orders can be stated…` | `cyclePlan` falsy | `:289-295` |
| 2 | `No councilors are reported in this cycle plan.` | all three arrays empty | `:302-304` |
| 3 | `GUARANTEED` (+ basis tooltip) | `odds.automatic === true \|\| odds.isAutomatic === true` | `:97-99`, `:144-146` |
| 4 | `ODDS UNAVAILABLE` | `point === null` after `odds.point ?? chance` | `:101-107`, `:147-149` |
| 5 | `mission rules unavailable for this snapshot` (tooltip) | as #4 **and** no `odds.basis` | `:105` |
| 6 | `>99%` | `point >= 100` off a **contested** roll | `:154` |
| 7 | band omitted | `odds.band` not a 2-element array, or either end non-finite | `:108-114`, `:155` |
| 8 | `FLOOR UNVERIFIED` | `riskFloor.outcome === 'unknown'` | `:128-131` |
| 9 | `MARGINAL` | `outcome === 'pass' && marginal === true` | `:133-137` |
| 10 | `unknown` (hate cell) | `expectedHate` null/absent/non-finite | `:166-169` |
| 11 | `0 hate` | `expectedHate` **measured** as 0 | `:170-172` |
| 12 | `Mission unnamed in this snapshot` | all four name fields absent | `:50-54`, `:205` |
| 13 | `No fixed target` | `targetLabel` returns null | `:65-89`, `:208` |
| 14 | family chip omitted | `candidate.family` falsy | `:196`, `:206` |

Plus per-bucket defaults: idle reason falls back to *"No positive expected-value
action matched this operative this cycle."* (`:217-218`); unavailable reason to
*"Holds no mission slot this cycle."* (`:241`); the ` — <status>` suffix is
omitted when `status` is absent (`:242`, `:249`); the free-action line is omitted
when `suggestedFreeAction` is absent (`:219`, `:230-234`); alternates are omitted
when `freeActionOptions` is not an array (`:220-222`).

**The three that a rewrite will most likely break:**

- **#3 vs #6.** `GUARANTEED` and `>99%` are opposite claims. `automatic` means
  `contested: false` on the template — a *rule*, `server/engine/odds.js:103-116`.
  `point === 100` off a contested roll is a **rounding artefact of 99.75%**
  (comment `:92-95`). The `automatic` test must stay **first** (`:97`), before
  the `point` read. Collapsing them to `point >= 100 ? 'GUARANTEED'` is wrong.
- **#10 vs #11.** `unknown` and `0 hate` are opposite claims off `num()`
  (`:33-37`). `Number(null) === 0` turns #10 into #11 — comment at `:161-164`
  names this explicitly. Guard on `hate === null` **before** `hate === 0`.
- **#4 with `??`.** `num(odds?.point ?? chance)` (`:101`) uses nullish
  coalescing, so a measured `point` of `0` survives. `||` would turn a real 0%
  into `ODDS UNAVAILABLE`.

`oddsUnavailable` (`server/engine/odds.js:60-72`) really does emit
`chance: null, point: null, band: null, automatic: null` — so branch #4 is
reachable in production, not defensive.

### 4. Measured vs estimated registers

**None.** No register classes; no verify script covers it.

The honesty devices it does carry are the four tags — `GUARANTEED`,
`ODDS UNAVAILABLE`, `FLOOR UNVERIFIED`, `MARGINAL` (`:129-137`, `:145`, `:148`)
— which are a *confidence* vocabulary, not the measured/estimated register.
Preserve the tags; do not map them onto `Measured`/`Estimated`.

### 5. Truncation

**None, in the component or upstream, for the three arrays it renders.**

`server/engine/assignment.js:1317-1320` states it directly: *"`committed` and
`unassigned` above are deliberately uncapped — they are bounded by the councilor
roster, not by candidate breadth — so they carry no such counts."*
`assignments` and `unavailable` are likewise emitted whole (`:1311`, `:1313`).

The `benchedTotalCount` / `benchedOmittedCount` / `benchedRepresentedCount`
fields (`:1338-1340`) belong to `benched`, which **this component does not
render** — they are `directive-board`'s contract, not this one.

Consequence: the header count *"N COUNCILORS ACCOUNTED FOR"* (`:300`, `:316`) is
a **complete** census, and its truthfulness depends on all three arrays staying
uncapped. **If a rewrite adds a cap or virtualises the list, that sentence
becomes a lie and needs `TruncationNote` beside it.**

### 6. Primitive

`Value` — optional, for the odds percentage (`:150-157`) and hate figure
(`:173-174`). Marginal benefit: both already have correct local guards, and both
need bespoke tone classes (`--good` / `--mid` / `--low`, `--warn`) plus a
`title` attribute. `Value` forwards `className` and `...rest`
(`src/v2/components/Value.jsx:42-43`, `:74-80`), so it can carry them, but the
three-way tone logic stays local either way.

`Panel` **not** needed (`index.html:251-261`). `DataTable` **not** needed and
would be wrong: the rows are `<button>` and `<div>` elements in a CSS grid
(`:199`, `:225`, `:245`) with a separate `aria-hidden` header row (`:319-324`),
deliberately not a `<table>` — three different row shapes share one grid.
Forcing `DataTable` here loses the button semantics that drive
`focusDirectiveBoard`. `TruncationNote` not needed today (§5).
No `Measured`/`Estimated`.

**Nothing outside the five is required.**

---

## detail-panel

`public/v2/js/components/detail-panel.js` (219 lines) ·
`window.MissionControlDetailPanel` · pinned by `scripts/verify_drive_path_modal.js`

### 1. Payload

`[CONTRADICTS-DOC]` — **this is not a class R render-only component, and it is
not fed by the controller.**

`docs/react-component-contracts.md:35-37` lists `detail-panel` under "Class R —
render-only (9) · Fed from the snapshot or briefing by `mission-control.js` ·
Pure functions of their payload." Every clause is wrong for this file:

- The exports are `{ open, close, syncPageInert }` (`:218`) — **no `render`**.
- It is **not fed a payload by the controller**. It is an imperative
  **singleton modal** that lazily creates its own DOM (`ensurePanel`, `:60-115`)
  and appends it to `document.body` (`:89`).
- It is **not a pure function**: module-level `lastTrigger` (`:25`), focus
  management (`:207`, `:214`), body class toggling (`:56`), `inert` attribute
  sweeps across `.init-topbar`, `.init-view` and `main` (`:32-50`), a global
  `keydown` listener with a tab-trap (`:94-113`), and scroll reset (`:204-205`).
- It has **eight call sites across five files**, only two of which are the
  controller.

Call sites (all verified 2026-08-24):

| caller | line | uses |
| --- | --- | --- |
| `mission-control.js` — primary directive | `:860-868` | `eyebrow, title, summary, facts, actions` |
| `mission-control.js` — theater detail | `:1553-1564` | `eyebrow, title, summary, facts` |
| `directive-board.js` — assignment card | `:732-761` | `eyebrow, title, summary, facts, actions` |
| `drive-explorer.js` — ungated drive | `:971-981` | `eyebrow, title, facts, summary, notes` |
| `drive-explorer.js` — research path | `:988` ← `:950-955` | `title, summary, facts, sections, notes` |
| `fleet-procurement.js` — procurement | `:180-188` | `eyebrow, title, summary, facts, actions` |
| `fleet-procurement.js` — refit | `:191-` | `facts` (built `:195-`) |
| `research-advisor.js` — full ranking | `:749-` | `facts` (built `:753-`) |

Plus two lifecycle calls: `mission-control.js:369` and `:610` invoke
`syncPageInert()` on view changes.

**The `options` contract** (`open(options = {})`, `:185`):

| key | type | line | absent ⇒ |
| --- | --- | --- | --- |
| `eyebrow` | string | `:188` | `'DETAIL'` |
| `title` | string | `:189` | `'Operational detail'` |
| `summary` | string | `:190` | `''` |
| `facts[]` | `{ label, value }` | `:192-198` | empty `<dl>` |
| `sections[]` | `{ title, caption, rows[], empty }` | `:199`, `:136-157` | container `hidden` |
| `sections[].rows[]` | `{ label, sublabel, status, statusTone, meta }` | `:120-134` | see §3 |
| `notes[]` | string[] | `:200`, `:159-165` | container `hidden` |
| `actions[]` | `{ label, primary, close, onClick }` | `:201`, `:167-183` | no buttons |

`statusTone` is validated against `STATUS_TONES = ['ok','warn','block','unknown','neutral']`
(`:117`) and falls back to `'neutral'` on an unrecognised value (`:122`).

**A React migration of this file is a different job from the other four.** It is
infrastructure with eight consumers, not a panel. Migrating it before its callers
means the React version must keep the `window.MissionControlDetailPanel.open`
global working for the five un-migrated callers.

### 2. Player-mode difference

**Mode-invariant, and structurally so — it never reads the snapshot.**

The component contains no `fetch`, no reference to `mode`, `observer`,
`snapshot` or `briefing`, and no numeric formatting whatsoever. Every value it
renders arrives pre-formatted as a **string** from its caller and is escaped
(`:126-131`, `:193-197`) or set via `textContent` (`:188-190`, `:176`).

The mode-sensitivity therefore lives entirely in the **callers**, and it is real
there — e.g. `directive-board.js:750-751` formats `expectedValue` and
`expectedHate` from a cycle plan that is a different plan per mode (see
`council-orders` §2), and `drive-explorer.js:951` embeds
`satisfiedPrerequisiteTotalCount`.

**Implication for a rewrite:** the honesty guarantees are the callers'. This file's
only obligation is *"an absent value renders as the caller's own text or not at
all — never as 0"* (docstring `:14-15`), and it currently keeps it. Do not add
formatting, defaulting or `Number()` coercion when migrating — that would move a
null-discipline boundary that five other components rely on.

### 3. Unavailable and empty states

The panel's own states are **structural omissions**, not text.

| # | behaviour | condition | line |
| --- | --- | --- | --- |
| 1 | row dropped entirely | `!row \|\| !row.label` | `:121` |
| 2 | sublabel span omitted | `row.sublabel` falsy | `:127` |
| 3 | status chip omitted | `row.status` falsy | `:130` |
| 4 | meta span omitted | `row.meta` falsy | `:131` |
| 5 | tone → `'neutral'` | `statusTone` not in `STATUS_TONES` | `:122` |
| 6 | **`<div class="detail-panel__empty">` with `section.empty` or `'None.'`** | section present, `rows` empty | `:144-146` |
| 7 | section caption omitted | `section.caption` falsy | `:151` |
| 8 | section title → `''` | `section.title` absent | `:150` |
| 9 | sections container `hidden` | no sections | `:156` |
| 10 | notes container `hidden` | no notes after filtering | `:164` |
| 11 | note dropped | not a string, or whitespace-only | `:162` |
| 12 | action button skipped | `!action?.label` | `:172` |
| 13 | eyebrow / title / summary defaults | absent | `:188-190` |

**#6 is the one with a written rationale and must survive verbatim.** Comment
`:142-143`: *"An empty section still renders, saying so in the caller's own
words: a section that vanishes reads as 'not applicable' when it means 'none'."*
A rewrite that filters empty sections out — the natural React instinct — deletes
a deliberate honesty affordance. `scripts/verify_drive_path_modal.js:168-179`
enumerates section titles and would catch a missing section, but only for the
drive-path modal's specific titles.

**#1 is a silent drop.** A row with a truthy `status` but no `label` disappears
with no count. No caller currently produces one, but nothing prevents it.

Callers rely on this file **not** defaulting: `mission-control.js:844-848` passes
the literal string `'UNAVAILABLE'`; `drive-explorer.js:976` passes
`'none — this drive names no gating project'`;
`fleet-procurement.js:215-219` passes
`'Obsolete status unknown (not recorded in save)'`. All are caller strings that
must pass through unmodified.

### 4. Measured vs estimated registers

**None.** No register classes. `scripts/verify_drive_path_modal.js` does call
`getComputedStyle`, but at `:91` (`overflowX`) and `:144-145` (`cursor`,
`borderBottomStyle`) — layout and affordance checks on the *drive-explorer* rows,
**not** a measured/estimated register assertion on the panel.

`STATUS_TONES` (`:117`) includes `'unknown'`, which is a confidence vocabulary —
five tones, not two registers. Preserve the five; do not collapse to
`Measured`/`Estimated`.

### 5. Truncation

**None in this file.** `facts`, `sections`, `sections[].rows`, `notes` and
`actions` are all rendered whole (`:140`, `:145`, `:163`, `:171`, `:193`).

Truncation is the **callers'** responsibility, and at least one caller carries a
count through the `summary` string: `drive-explorer.js:951` interpolates
`payload.satisfiedPrerequisiteTotalCount ?? satisfied.length`. That count is
**inside a caller-built sentence**, not a structured field — so a `TruncationNote`
primitive cannot see it, and a rewrite must not try to extract it.

Nothing to preserve here beyond "keep rendering every element you are given".

### 6. Primitive — FLAG

**This component does not fit the five-primitive set, and it should not be forced
into it.**

- `Panel` is `.tech-card` (`src/v2/components/Panel.jsx:56-67`) — a page card.
  This is a `role="dialog" aria-modal="true"` overlay with a backdrop
  (`:71-72`). Different element, different semantics.
- `DataTable` — no table; `facts` is a `<dl>` (`:82`, `:193-198`), sections are
  `<ul>`/`<li>` (`:145`, `:124`).
- `Value` — nothing to format; every value is a caller string (§2).
- `TruncationNote` — nothing capped (§5).
- `Measured`/`Estimated` — no registers (§4).

**What it actually needs, and none of it exists:**

1. **A `Modal` / `Dialog` primitive** — backdrop, `role="dialog"`,
   `aria-modal`, `aria-labelledby` (`:72`), close-on-backdrop (`:91-93`),
   Escape (`:96-99`), and a focus trap that filters on `disabled`, `hidden` and
   `offsetParent !== null` (`:27-30`, `:100-112`).
2. **Page-`inert` coordination.** `syncPageInert` (`:32-50`) is **global,
   cross-overlay state**: it queries
   `#factionIntelScreen:not([hidden]), #intelligenceLibraryScreen:not([hidden]),
   #mcDetailPanel:not([hidden])` (`:33-35`) and toggles `inert` on
   `.init-topbar`, every `.init-view`, and `main`. It is called by
   `mission-control.js:369` and `:610` on view changes — **two callers outside
   this component**. Three overlays share one accessibility invariant. This is
   an app-level concern that a per-component primitive cannot own.
3. **Focus restoration** — `lastTrigger` (`:25`, `:187`, `:214`), with a
   `document.contains` liveness check before restoring.

**Raise this before the phase starts.** Adding `Modal` to the primitive set
serialises against every other in-flight component, and the `inert` coordination
is arguably not a primitive at all but an app-level provider. Deferring
`detail-panel` until its five callers are migrated is the cheaper path —
nothing else in the migration depends on it moving, and every one of its callers
currently reaches it through the `window` global, which a React version would
have to keep exporting anyway.

---

## Cross-cutting notes

**Two of five are misclassified in `docs/react-component-contracts.md`.**
`strategic-commentary` takes a container **id string**, not a root element
(`:16`); `detail-panel` has no `render` at all and is an imperative
eight-caller singleton (`:218`). The doc's headline claim — *"`render(root,
payload)` **is** `<Component {...payload} />` with `root` replaced by a mount
point"* (`docs/react-component-contracts.md:26-27`) — holds for `mc-budget` and
`council-orders` only.

**`unlocked-tech` is class F but takes no payload object at all** —
`load(observerId, mode, container)` (`:355`). The doc's F-class table lists its
endpoints correctly.

**Mode summary:**

| component | mode-varying? | evidence |
| --- | :-: | --- |
| `unlocked-tech` | **no** | `mode` dead in `applySaveState` (`shared/techGraph.mjs:360-460`) |
| `mc-budget` | **no** | none of its six fields crosses the gate at `shared/alienHateEconomics.mjs:257`; fixtures confirm |
| `strategic-commentary` | **yes, strongly** | different tier construction (`server/commentary/simulation.js:518-539`); `hateVent` unreachable in player (`:613-619`) |
| `council-orders` | **yes, strongly** | genuinely two plans (`docs/README.md:108`) |
| `detail-panel` | **no** | never reads the snapshot |

**Named-test status vs the doc:** `docs/react-component-contracts.md:74,87` lists
`mc-budget` and `council-orders` as having no named unit test. That was true at
the time of writing and **`tests/mc-budget.test.js` now exists** (17,085 bytes,
11 tests, modified 2026-08-24) — but `git status` reports it `??` (untracked), so
it is another track's uncommitted characterisation pass, not coverage on `main`.
Treat it as coverage that is arriving, and re-check it is committed before
relying on it as the migration's safety net. `council-orders` genuinely has none;
so does `detail-panel`, whose only coverage is
`scripts/verify_drive_path_modal.js`, a Playwright script exercising one caller's
modal.

**Two of the five are therefore unprotected for a rewrite:** `council-orders`
(348 lines, the strongest mode difference, and the `data-assignment-index`
coupling to `directive-board` that nothing tests) and `detail-panel`
(219 lines, eight callers, one Playwright script covering one of them).
Characterisation coverage before migrating, not after.
# Component data contracts — Group 2

`fleet-engagement` · `mining-expansion` · `alien-hate-economics` · `executive-boards`

Written 2026-08-24 against `main` @ `669e16e`, working tree clean. Depth pass over
`docs/react-component-contracts.md`. Nothing was modified.

Read this alongside the primitives that already exist in `src/v2/components/`:
`Panel.jsx`, `DataTable.jsx`, `Measured.jsx`, `Estimated.jsx`, `Value.jsx`,
`TruncationNote.jsx`, `tableVariants.js`. Several findings below are gaps between
those primitives and what these four components actually emit.

---

## Contradictions with `docs/react-component-contracts.md`

Establish these before trusting the structural map.

| doc claim | source says |
| --- | --- |
| `executive-boards` — *"no single global"* (line 75, 99–104) | It **does** have one global: `window.MissionControlBoards` (`public/v2/js/components/executive-boards.js:406`). What it lacks is a single *render function* — it exposes **seven**, each mounting a different element. |
| `alien-hate-economics` — global `MissionControlHateEconomics`, class R, one `render(root, payload)` | Correct global, but it exposes **two** entry points: `{ render, renderHud }` (`alien-hate-economics.js:217`). `renderHud` mounts a **different** element (`#hudHateMeter`, `mission-control.js:1335-1339`), takes a **third** argument, and mutates existing DOM in place rather than writing `innerHTML`. The doc's "one entry point per panel" assumption fails here too, not only on `executive-boards`. |
| `alien-hate-economics` — *pinned by* `alienHateEconomics.test.js` | That test imports `require('../server/alienHateEconomics')` (`tests/alienHateEconomics.test.js:4`) and never loads the component. **No test loads `public/v2/js/components/alien-hate-economics.js`** — grep for `alien-hate-economics` across `tests/` and `scripts/` returns only `public/v2/index.html`. The component, and `renderHud` in particular, is **unpinned**. |
| `mining-expansion` — *pinned by* `miningExpansion.test.js`, `miningExpansionNullDiscipline.test.js`, `verify_mining_registers.js` | Two more exercise the component's `render` and are missing from the list: `tests/mineModuleOutput.test.js:537` and `tests/miningBoardRendering.test.js:36`. |
| `executive-boards` — *"none by name"* | True for a named unit test, but `tests/commandLayout.test.js:105-115` measures `#opLeaderboardList .mc-board-table-wrap` and `tests/missionControlLayout.test.js:187,214` measure `.mc-board-table-wrap` overflow. That is **layout** coverage of `renderOperationsBoard` and `renderResearchWatchlist` output — it would fail on a structural change but not on a wrong number. |
| `fleet-engagement` — measured/estimated *"asserted by computed style in the verify scripts"* (line 120–124) | `scripts/verify_drive_explorer.js` asserts `.de-measured__value` / `.de-estimate__value` **only** (lines 63–64, 81, 214, 245, 257). It never queries `.fe-meas` / `.fe-est`. The fleet board's own register split is asserted **nowhere in a browser** — only by class-name/computed-style assertions on the *React primitives harness* (`tests/reactPrimitivesRegisters.test.js:41-51`), which renders synthetic markup, not this component. |
| Class F / class R split | Holds, with one nuance: `mining-expansion` is class F but is **not** lazily loaded — it fetches inside `renderDashboard()` on every render (`mission-control.js:1236-1244`). `fleet-engagement` is the lazily-loaded one (`mission-control.js:400-410`, keyed on `observer|mode`). |

---

## fleet-engagement

`public/v2/js/components/fleet-engagement.js` · 260 lines · class **F** ·
global `window.MissionControlFleetEngagement = { render, fetchFleetEngagement }`
(`fleet-engagement.js:256-259`) · mount `#fleetEngagement` (`public/v2/index.html:519`),
registered on the THREAT view (`mission-control.js:230-239`).

### 1. Payload

Self-fetches `GET /api/intel/fleet-engagement?observer={id}&mode={mode}&limit=12`
(`fleet-engagement.js:86`). The `limit=12` is hardcoded and happens to equal
`DEFAULT_ENGAGEMENT_ROWS` (`shared/fleetEngagement.mjs:119`). A non-OK response returns
`null`; a thrown fetch returns `null` after `console.warn` (`fleet-engagement.js:87-92`).

Controller wiring: `mission-control.js:400-410` — `fetchFleetEngagement(state.observer,
state.mode).then(data => render(container, data))`. **`render` is called
unconditionally, including with `null`**, so a failed fetch reaches the unavailable
state. (Contrast `mining-expansion`, below, which does not.) `lazyViewLoadKeys` guards
re-fetch per `observer|mode` (`mission-control.js:383, 403-404`).

Fields actually **consumed** — the response carries considerably more
(`shared/fleetEngagement.mjs:766-983`); everything not listed here is ignored:

**Top level**
- `available` (bool) — gate (`:186`)
- `reason` (string) — only when `available === false` (`:187`)
- `items[]` — the rows (`:192`)
- `ownForce` → `.totalHulls`, `.fleetCount`, `.ratingSource`, `.bestDesignName`, `.rating` (`:210-211`)
- `fleetsTotalCount`, `shipsTotalCount`, `fleetsOmittedCount` (`:215, 220-222`)
- `reachabilityTotals` — object keyed by state, values are counts (`:193-196`)
- `orderedBy` — tooltip only (`:227`)
- `reachabilityModel.note` (`:250`)
- `sweep.notWinnableIsNotAConclusion` (`:251`)

**Ignored top-level fields** (present in the payload, never rendered):
`mode`, `observerFactionId`, `isEstimate`, `compositionModel` (incl.
`playerAnchorEvidence`, which is the *only* published statement of the player-mode
model's provenance), `verdictTotals`, `fieldableTotals`,
`reachabilityModel.states/source/destinationsModelled/gatesRequirement`,
`sweep.maxEngagementHulls/commentaryTierCeiling/ceilingBasis`, `ownForce.bestHullName`,
`ownForce.ratedDesignCount`, `ownForce.referenceWeaponSystems`, `ownForce.fleets`.

**Per row (`items[i]`)**
- `fleetName`, `orbitBody`, `destination`, `daysToArrival` (`:161, 167-168`)
- `shipsCount`, `distinctHullTypes` (`:171-172`)
- `threatensObserverAsset` → row modifier class `fe-row--threat` (`:165`)
- `composition.ratedShips`, `composition.unratedShips` — tooltip only (`:155-159`)
- `engagementPoint.body` (`:129`)
- `reachability.state`, `.isEstimate`, `.reason` (`:124-132`)
- `requirement.verdict`, `.bandLabel`, `.reason` (`:107-119`)
- `fieldable.verdict`, `.hullsNeeded`, `.hullsAtEngagementPoint`, `.reason` (`:138-149`)

Ignored per-row: `fleetId`, `spaceTheaterKey/Name`, `dominantWeaponType`,
`weaponSummary`, `mission`, `destinationType`, `arrivalDate`,
`composition.opponentRating`, `.isLowerBound`, `.basis`, `.reason`, `mobility`.

### 2. Player-mode difference — **YES, a different answer**

This is not filtering. The opponent rating is computed by a **different model** per mode
(`shared/fleetEngagement.mjs:314-360`):

- **Omniscient**: each alien ship is joined to its own design and rated at
  `design._unnormalizedCombatValue` (`:322-329`). Read, not invented.
- **Player**: `snapshot.shipDesigns` is filtered to the observer's own designs
  (`server/intelligenceFilter.js:624`), so `designByTemplate` is **empty**. Each alien
  ship is instead rated at `ownForce.rating × 1.5 × (observed weapon systems / observer's
  median weapon systems)` (`shared/fleetEngagement.mjs:340-341`). The `1.5` is an invented
  constant with no game source (`:302`, `COMPOSITION_BASIS.player`).

Because the requirement band is a Monte Carlo sweep over that rating, **every
`requirement.bandLabel` on screen is a different number in player mode**, as is
`fieldable.verdict` derived from it. The two modes also differ in how many alien fleets
exist at all: `fleets` is filtered by observation (`server/intelligenceFilter.js:618`,
`filterSpaceAssets`), so `fleetsTotalCount`, `shipsTotalCount` and `reachabilityTotals`
all shrink.

**A rewrite verified only in omniscient has verified the wrong arithmetic.**

The panel never says which model produced the band. `compositionModel.basis` and
`compositionModel.playerAnchorEvidence` carry that statement and are **not rendered**
today. That is a pre-existing honesty gap, not a rewrite risk — but a rewrite is the
cheap moment to close it.

### 3. Unavailable / empty states

Sentinel is `UNAVAILABLE = '—'` (`:29`). `num()` (`:31-35`) returns `null` for
`null | undefined | '' | non-finite`; `int`, `count`, `txt`, `plural` all route through it.

| # | rendered output | input that produces it | line |
| --: | --- | --- | --: |
| 1 | `ENGAGEMENT ESTIMATES UNAVAILABLE — the endpoint could not be read.` | `data == null` (fetch failed / non-OK / threw) | `:182-184` |
| 2 | `NO ENGAGEMENT ESTIMATE — {reason}`, or `— reason unavailable` | `data.available === false` | `:186-189` |
| 3 | `No hostile fleet could be estimated in this intelligence picture.` (colspan 5) | `items` empty or not an array | `:241-243` |
| 4 | `reachability not evaluated` | `reachabilityTotals` is `{}` | `:194-195` |
| 5 | `every tracked fleet shown` | `fleetsOmittedCount` not `> 0` — **includes `null`**, see §5 | `:221-223` |
| 6 | `—` for a numeric | `int()` / `count()` on a null-ish or non-finite value | `:39, 44` |
| 7 | `—` for a string | `txt()` on `null | undefined | ''` | `:48-51` |
| 8 | `— types` | `plural(distinctHullTypes, …)` when null | `:58` |
| 9 | `—` + verdict word + `title` | `requirement.bandLabel` absent → `fe-need--none` branch | `:116-120` |
| 10 | `CANNOT BE ESTIMATED` / `BEYOND MODELLED RANGE` / `NOT WINNABLE AS SWEPT` / `WITHHELD — UNREACHABLE` | `requirement.verdict` (`VERDICT_LABEL`, `:70-76`) | `:108` |
| 11 | `UNKNOWN` (verdict fell off the map) | `requirement.verdict` not a key of `VERDICT_LABEL` | `:108` |
| 12 | `REACH UNKNOWN` | `reachability.state` absent or unmapped | `:125` |
| 13 | `no engagement point` | `engagementPoint.body` falsy | `:133` |
| 14 | `UNKNOWN` (fieldable) | `fieldable.verdict` absent or unmapped | `:139` |
| 15 | `—` instead of `X reachable / Y needed` | **either** `hullsNeeded` **or** `hullsAtEngagementPoint` is null/undefined | `:144-146` |
| 16 | empty `<p>` | `reachabilityModel.note` or `sweep.notWinnableIsNotAConclusion` absent | `:250-251` |
| 17 | empty `title=""` | `orderedBy`, `ownForce.ratingSource`, any `.reason` absent — `attr()` maps null → `''` | `:53` |

**Null-discipline defect, live today.** `fleet-engagement.js:156-158` is the one place a
payload value reaches a template literal without going through `int`/`txt`/`plural`:

```js
const composed = (composition.ratedShips || 0) + (composition.unratedShips || 0);
const compositionTitle = composition.unratedShips > 0
  ? `${composition.ratedShips} of ${composed} ships could be rated, …`
```

`|| 0` on both terms, and `${composition.ratedShips}` raw. The payload guarantees integers
here (`shared/fleetEngagement.mjs:353-356`), so it is latent rather than firing — but it is
exactly the pattern this file's own header (`:17-21`) forbids, and it is in a `title`
attribute, which no verify script reads.

**`unknown` is deliberately not `safe`** and a rewrite must keep it: a fleet whose
reachability is `unknown` still receives a hull count, because withholding it would make an
unevaluated threat read as no threat (`shared/fleetEngagement.mjs:64-71`,
`reachabilityModel.gatesRequirement`). Only `beyond-delta-v` withholds.

### 4. Measured vs estimated registers

Defined in `public/v2/css/24-fleet-engagement.css:43-76`.

| class | role | computed |
| --- | --- | --- |
| `.fe-meas` | measured, secondary line | `var(--mono)`, `normal`, `--fs-tag`, `--text-dim` (`:43-48`) |
| `.fe-meas__value` | measured, primary | `var(--mono)`, `normal`, **weight 600**, `--text` (`:50-55`) |
| `small.fe-meas__value` | same register at tag size | `--fs-tag` (`:62-64`) — register is family/weight/style/colour, **never size** |
| `.fe-est__value` | modelled, primary | `var(--sans)`, **italic**, weight 400, `--text-soft` (`:66-71`) |
| `.fe-est__text` | modelled, secondary | `var(--sans)`, **italic**, `--fs-tag`, `--text-dim` (`:73-78`) |
| `.fe-th--measured` / `.fe-th--estimate` | column headers | `:233-237` in the component |
| `.fe-cell--estimate` | dashed left rule separating the two halves | `border-left: 1px dashed var(--line-strong)` (`css:200-203`) |

**There is no `.fe-est` root rule in the stylesheet** — grep of
`public/v2/css/24-fleet-engagement.css` finds it only in a comment (`:18`).

Which side each cell sits on (`fleet-engagement.js`):
- measured: fleet name (`:167`), orbit/movement (`:168`), ship count (`:171`), hull-type
  count (`:172`), own-force hulls/fleets (`:210-211`), hostile totals (`:215`), showing
  count (`:220`), and the `X reachable / Y needed` detail (`:150`).
- estimated: hull band (`:112-113`), verdict caption (`:119`), fieldable verdict (`:149`),
  reachability summary (`:216`), omitted note (`:221`), footnotes (`:249-252`).
- **conditional**: `reachabilityCell` picks the class at runtime —
  `reach.isEstimate ? 'fe-est__text' : 'fe-meas__value'` (`:128`). Co-location is read
  from the save; every other state is modelled. **This branch is the honesty device on
  this panel** and a rewrite that hardcodes either class destroys it.

**What the verify scripts assert about them: nothing.** `scripts/verify_drive_explorer.js`
asserts the split on `.de-*` only (`:63-64, 122-137`). `scripts/verify_mining_registers.js`
asserts `.mining-*` only. The `.fe-*` split is asserted only against synthetic markup in
`tests/reactPrimitivesRegisters.test.js:41-48` (`feMeas.fontStyle === 'normal'`,
`feEst.fontStyle === 'italic'`, `feMeas.className` matches `/fe-meas__value/`). **A rewrite
of this panel can silently collapse the two registers and no check will fail.** Add a
browser assertion before migrating, not after.

### 5. Truncation

One capped list: `items`, capped server-side at `limit=12`.

Must survive:
- **`fleetsTotalCount`** — denominator in `{n} of {total}` (`:220`) and the hostile-fleet
  headline (`:215`).
- **`fleetsOmittedCount`** — drives the omitted note (`:221-223`).
- **`shipsTotalCount`** — total across **all** rows, not the emitted slice
  (`shared/fleetEngagement.mjs:978`).

**Defect in the truncation announcement.** `:221` tests `data.fleetsOmittedCount > 0`.
`null > 0` is `false`, so an **unread** omitted count renders `every tracked fleet shown` —
a capped list presented as complete. The `TruncationNote` primitive already handles this
correctly (`src/v2/components/TruncationNote.jsx:32-46`: absent omitted → `unknown`, never
"all shown"). **Use it; do not port the `> 0` test.**

Not truncated but also not announced: `verdictTotals` and `fieldableTotals` are computed
over all rows and never rendered.

### 6. Primitive

| need | primitive | fit |
| --- | --- | --- |
| the table | `DataTable` variant `fe` | fits — `tableVariants.js:32-41` maps `fe-table-wrap` / `fe-table` / `fe-th` / `fe-row` / `fe-cell` / `fe-scroll-hint`, placement `after`, which is what `syncScrollHints` (`mission-control.js:279-293`) and `tests/missionControlLayout.test.js:187` expect. **Pass `hintText` explicitly** — the legacy string is `Swipe horizontally to inspect all columns` (`:247`), the primitive default is `SWIPE HORIZONTALLY TO SEE MORE COLUMNS`. Legacy also carries `role="note"`; the primitive does not. |
| the two registers | `Measured` / `Estimated`, `register="fe"` | **partial — see the loud flag below** |
| unavailable numbers | `Value` | fits; `absentLabel="—"` matches `UNAVAILABLE = '—'` |
| omitted-count note | `TruncationNote` | fits and is **better** than the current code |
| the card | `Panel` — **not needed** | the `.tech-card` wrapper is in `public/v2/index.html:513-521`; the component renders **inside** `.tech-card-body`. Using `<Panel>` double-wraps unless the strangler mounts at the card, not at `#fleetEngagement`. |

**FLAG — `Estimated` register `fe` is structurally incompatible with this panel's CSS.**
`src/v2/components/Estimated.jsx:46-53` wraps the value in a root
`<span className="fe-est">`. Three consequences:

1. `.fe-est` **is not a defined rule**, so the wrapper contributes nothing.
2. `public/v2/css/24-fleet-engagement.css:231` and `:235-236` are
   `.fe-reach--beyond-delta-v .fe-est__text:first-child` and
   `.fe-reach--unknown .fe-est__text:first-child`. Today the label span **is** the first
   child of `.fe-reach` (`fleet-engagement.js:130-134`). Behind an `.fe-est` wrapper it
   still is first child *of the wrapper*, so the rule still matches — but any variant that
   emits the `note` slot alongside it (`Estimated.jsx:42-44`) puts a second child in and the
   `:first-child` colouring silently drops the **danger** and **warning** verdict colours.
3. `.fe-cell strong, .fe-cell small, .fe-cell span { display: block; }`
   (`css:213-217`) — an extra `<span>` becomes a block, changing the row layout.

Also: the reachability cell needs the **runtime** register switch (`:128`). `Measured` and
`Estimated` are separate components, so a rewrite needs
`const R = reach.isEstimate ? Estimated : Measured` and to pass `register="fe"` — nothing
in the primitive set expresses "this value's register is data-dependent". Not a new
primitive, but call it out in the phase or it will be hardcoded.

---

## mining-expansion

`public/v2/js/components/mining-expansion.js` · 618 lines · class **F** ·
global `window.MissionControlMiningExpansion = { render, fetchMiningExpansion }`
(`:614-617`) · mount `#miningExpansion` (`public/v2/index.html:420`), EXPANSION view
(`mission-control.js:195-204`).

### 1. Payload

Self-fetches `GET /api/intel/mining-expansion?observer={id}&mode={mode}`
(`:96`) — **no `limit` parameter**, so the endpoint's own `limit` is `null` and
`rankedAvailable === available`, the full list
(`shared/intel/miningExpansion.mjs:664`). All capping is client-side.

Controller: `mission-control.js:1236-1244`. **Not** lazy — refetched inside
`renderDashboard()` on every render. Critically:

```js
window.MissionControlMiningExpansion.fetchMiningExpansion(state.observer, state.mode)
  .then(data => { if (data) { …render(miningEl, data); } });
```

**`if (data)` means a failed fetch never calls `render`.** The board keeps whatever was
there before — the initial `LOADING MINING EXPANSION…` placeholder
(`public/v2/index.html:421`) on first load, or **stale data from the previous
observer/mode** on a switch. The component's own `MINING EXPANSION DATA UNAVAILABLE`
state (`:411`) is unreachable through this call site. There is also no
`requestSequence` guard, unlike `researchAdvisor` (`mission-control.js:1252-1258`) and
`fleetProcurement` (`:1264-1270`), so an out-of-order response from a mode switch can
land after a newer one. **Both are rewrite-relevant: the React version must render an
explicit unavailable state and must guard against a stale in-flight response.**

`render` accepts either wrapper shape: `payload?.miningExpansion || payload` (`:399`).

Consumed fields (endpoint returns `{ count, items, ...expansion }`,
`shared/intel/registry.mjs:441-446`):

**`capacity`** (`:400`; absent → unavailable state) — `minesBuilt`, `mineLimit`,
`headroom`, `penaltyMC`, `penaltyHate`, `hateCostAvailable`, `baseHateMultiplier`,
`overLimit`, `marginalNextMinePenaltyMC`, `marginalNextMinePenaltyHate`
(`:106-148`), `mcWarFloorDistance` (`:416`).

**`available[]`** (`:401`) per candidate: `siteId`, `displayName`, `parentBodyName`,
`spaceTheaterKey`, `destinationTechSource`, `yields.{water,volatiles,metals,nobleMetals,fissiles}.{monthly,measured}`,
`moduleMultiplier.projectedRangeAvailable`, `siteDensity`, `siteDensityAssumed`,
`siteDensityMeasured`, `siteDensitySource`, `siteValue`, `scoreInputsComplete`,
`unmeasuredResources[]`, `hateCost`, `mcCost`, `buildTimeDays` (`:219-289`).

**`availableTotalCount`** (`:424`). **`techGated[]`** → `missingTechName`, `missingTech`,
`siteCount`, `bestSiteValue`, `unmeasuredSiteCount` (`:430-452`).
**`unreachable.totalSites`** (`:454`). **`resourceRunways`** → per entry `key`, `status`,
`runwayMonths` (`:151-181`). **`mineModuleCapability`** → `available`,
`unavailableReason`, `projectedMultiplierRange.{low,high,lowLabel,highLabel,lowModule,highModule}`
(`:193-217, 520-539`). **`miningTechBonus`** → `available`, `boostedResources[]`,
`byResource[key].{multiplier,grants[]}` (`:461-486`). **`spaceMiningBonus`** →
`available`, `additiveTotal`, `sources[].{name,value}` (`:494-514`).
**`mineUpgrades`** → `totalMonthlyGainMeasured`, `totalMonthlyGain{…}`, `counts.{available,noUpgradePath,notResearched,notOperational,unknownModule}`, `opportunities[].{state,displayName,parentBodyName,currentMultiplier,nextMultiplier,monthlyGain{…}}` (`:304-393`).

**Ignored**: `count`, `items` (duplicate of `available`), **`availableOmittedCount`**,
**`availableUnmeasuredCount`**, `bonusUnresolvedSiteCount`, `assumptions[]` (11 entries,
including every statement of what the score excludes), `unreachable.byBody`,
`unreachable.missingTech`, `techGated[].sites[]`, `spaceMiningBonus.inactiveSources`,
`spaceMiningBonus.state`, `miningTechBonus.unavailableReason`.

### 2. Player-mode difference — **NONE, and the reason is specific**

`miningExpansionResource` takes **no `mode` argument at all**
(`shared/intel/miningExpansion.mjs:497-502`); the registry row does not pass one
(`shared/intel/registry.mjs:440-445`). The `mode` in the URL selects only which filtered
snapshot is read.

Every term on this board is the **observer's own**, and each survives player filtering
intact:

- **Unowned candidate sites** — `server/intelligenceFilter.js:929` keeps a site when
  `!site.factionId`, tagged `unclaimed prospecting data`. Unclaimed sites are never
  redacted.
- **The observer's own sites** (the upgrades block, and `minesBuilt`) — same line,
  `sameId(site.factionId, observerFactionId)`.
- **Completed projects** — `server/intelligenceFilter.js:265` keeps the observer's list
  whole and truncates only rivals' to five.
- **The observer's councillors' org bonuses** — read only when `isRequestedObserver`
  (`shared/intel/miningExpansion.mjs:527-547`); a rival's roster is `null`, so
  `spaceMiningBonus` refuses with `available: false` rather than under-reporting.

`scripts/verify_mining_registers.js:154-156` asserts this directly:
`seen.player.boardText === seen.omniscient.boardText`, with the comment that a difference
means a rival's data reached the board. **That equality is a contract, and it is the
cheapest single regression test for the rewrite.**

Caveat worth carrying forward: mode-invariance holds *because* the resource refuses on the
fallback path. If `resolveObserverFaction` falls back to the first faction
(`:509-518`), `isRequestedObserver` is false and the bonus blocks resolve to `unknown`
(`:520-547`). A rewrite must not "improve" that into a best-effort read.

### 3. Unavailable / empty states

Sentinel `UNAVAILABLE = '—'` (`:25`); `num`/`fmt`/`int`/`unit` (`:27-51`) are the same
discipline as the fleet board. `unit()` is notable: an absent value drops the **suffix
too**, because `—d` is as meaningless as `nulld` (`:45-51`).

| # | rendered output | input | line |
| --: | --- | --- | --: |
| 1 | `MINING EXPANSION DATA UNAVAILABLE` | `capacity` falsy — **unreachable via the live call site**, see §1 | `:410-413` |
| 2 | `{n} / {n} MINES (CAPACITY UNMEASURED)` + note | `headroom`, `minesBuilt` or `mineLimit` null | `:128-134` |
| 3 | `OVER LIMIT (+n MC / HATE UNAVAILABLE)` + `(hate cost unavailable: the save carries no readable difficulty.)` | `overLimit === true` and `hateCostAvailable === false` or `baseHateMultiplier` null | `:115-126` |
| 4 | `ALIEN-HATE COSTS UNAVAILABLE` banner | same `hateAvailable` test | `:417, 551-555` |
| 5 | `HATE UNKNOWN` chip on a row | `hateCost` null | `:222-225` |
| 6 | `FREE` chip | `hateCost === 0` — a **measured** zero, distinct from #5 | `:226-227` |
| 7 | `YIELDS UNAVAILABLE` | `yields` not an object | `:71-73` |
| 8 | `YIELDS UNMEASURED` | all five resources unmeasured | `:88-90` |
| 9 | `No measured yield` | some measured, none positive | `:91` |
| 10 | `is-partial` class + `Unmeasured in this snapshot: …` title | `unmeasured.length > 0` but not all | `:272-274` |
| 11 | `Mine module multiplier: UNKNOWN — not in the score` (band, `is-unavailable`) | `projectedRangeAvailable === false`, or range low/high null | `:201-208` |
| 12 | `MINE MODULE MULTIPLIER NOT REPORTED by this snapshot` (board note) | `mineModuleCapability` absent | `:524-526` |
| 13 | `Mine module multiplier: UNKNOWN — …` (board note) | range unresolvable; two distinct reasons | `:527-532` |
| 14 | `Density: —x (assumed)` / `Density: 1.00x (assumed)` | `siteDensityAssumed === true` or `siteDensityMeasured === false` | `:233-237` |
| 15 | `not scoreable` + `—` score | `siteValue` null | `:239, 279-282` |
| 16 | `partial utility` + `*` suffix | `siteValue` present, `scoreInputsComplete === false` | `:240-244, 279` |
| 17 | `n MC · build n/a` | `buildTimeDays` null — the fix for the shipped `nulld` bug | `:249-255` |
| 18 | `Unmeasured` runway pill + reason title | `status` in `{unmeasured, consumption_unknown, unknown}` | `:165-170` |
| 19 | `—` runway pill | any other status with null months and no `surplus` | `:171-173` |
| 20 | `No runway data` | `resourceRunways` empty | `:559` |
| 21 | `War Floor: unavailable` pill (`is-unknown`) | `mcWarFloorDistance` null | `:560-562` |
| 22 | `MINE TECH BONUSES NOT REPORTED` | `miningTechBonus` absent | `:464-466` |
| 23 | `MINE TECH BONUSES UNRESOLVED — … a lower bound, not a measured "no bonus"` | `miningTechBonus.available !== true` | `:466-468` |
| 24 | `No completed project raises mine output…` | `available === true`, `boostedResources` empty — **measured** none | `:469-470` |
| 25 | `{key} ×— (…)` | `boostedResources` names a key absent from `byResource` (payload contradiction) | `:479-482` |
| 26 | `FACTION-WIDE SPACE-MINING BONUS NOT REPORTED` / `UNRESOLVED` / `UNREADABLE` | `spaceMiningBonus` absent / `available !== true` / `additiveTotal` null | `:495-505` |
| 27 | `No active org or effect raises mine output faction-wide (measured, not assumed)` | `additiveTotal === 0` | `:505-506` |
| 28 | `source not named` | `sources` empty | `:508-510` |
| 29 | `UPGRADE HEADROOM UNRESOLVED — … unknown, not "none"` | `mineUpgrades.totalMonthlyGainMeasured !== true` | `:310-318` |
| 30 | `{label}: —` in the gain summary | a resource key missing from `totalMonthlyGain`, or null | `:321-328` |
| 31 | `none` for the total gain | no resource had a positive measured gain | `:379` |
| 32 | `No measured gain` on an upgrade row | same, per row | `:335-347` |
| 33 | `No mine has a researched upgrade available.` | no opportunity in state `available` | `:390` |
| 34 | `TECH-GATED OPPORTUNITIES (site count unavailable)` | **any** group's `siteCount` is null — the whole total refuses rather than under-reporting | `:430-433, 597` |
| 35 | `No unowned reachable sites available in current theater.` | `available` empty | `:590` |
| 36 | `Unnamed site` / `Unknown body` / `UNASSIGNED` | missing name/body/theater key | `:264-265, 343-344, 257` |

**Live null-discipline defect.** `:509`:

```js
sources.map((s) => `${s.name} +${Math.round(num(s.value) * 100)}%`)
```

`s.name` is `org?.displayName ?? null` (`shared/spaceMiningBonus.mjs:248`), so an org with
no display name renders the literal text **`null +25%`** — the exact failure this file's
header (`:11-17`) exists to prevent. Second-order: `num(s.value)` is *not* guarded, and
`Math.round(null * 100)` is `0`, so an unreadable value would print `+0%`. That cannot fire
today only because the producer guarantees a finite non-zero value
(`shared/spaceMiningBonus.mjs:239-240`) — the guard is at the producer, not the renderer.
Fix in the rewrite; do not port.

### 4. Measured vs estimated registers

Defined in `public/v2/css/18-mining-expansion.css:238-292`, deliberately the same shapes as
`.de-*` and `.fe-*` (`:239-241`).

| class | role | computed |
| --- | --- | --- |
| `.mining-meas__value` | **measured** | `var(--mono)`, `font-style: normal`, **weight 600**, `color: var(--text)` (`css:254-259`) |
| `.mining-est` | **estimate** container | `var(--sans)`, **italic**, `--fs-tag`, `--text-dim` (`css:267-272`) |
| `.mining-est__value` | estimate value | `var(--sans)`, **italic**, weight 400, `--text-dim` (`css:274-279`) |
| `.mining-est__tag` | the literal `EST` caption | mono, upright, `--fs-tag`, **dashed 1px border**, `--text-dim` (`css:281-289`) |
| `.mining-module-band` | the projected band block | `display: block` (`css:291-294`) |

Where each is applied in `mining-expansion.js`:
- **measured** — candidate yields text (`:272`), upgrade multiplier step (`:346`), upgrade
  monthly gain (`:347`), total measured gain (`:379`).
- **estimate** — the module band on an unowned row, `mining-est mining-module-band` with
  `mining-est__tag` + `mining-est__value` inside (`:213-216`); the unavailable band variant
  `mining-est mining-module-band is-unavailable` (`:206-207`, note: **no `__tag`, no
  `__value`**); and the board-level module note `mining-yield-basis mining-est` (`:566`).

The split is load-bearing **on this board specifically** because the mine module multiplier
is a *measurement* on a site the observer holds (upgrades block) and a *decision* on one it
does not (candidate band), and the two sit a few rows apart
(`scripts/verify_mining_registers.js:9-19`).

**What `scripts/verify_mining_registers.js` asserts** — run per mode, both `player` and
`omniscient` (`:147-149`):

| line | assertion |
| --: | --- |
| `:61-62` | measured probe = `#miningExpansion .mining-upgrades .mining-meas__value`, falling back to `#miningExpansion .mining-meas__value` |
| `:64-65` | estimate probe = `#miningExpansion .mining-module-band .mining-est__value`, falling back to `.mining-module-band` |
| `:79-80` | `--text` and `--text-dim` resolve to non-empty values at `:root` (the self-referential-token guard) |
| `:81` | `.mining-candidate-row` count `> 0` |
| `:82-84` | **`.mining-module-band` count === `.mining-candidate-row` count** — no row silently omits its projection |
| `:85-86` | a measured value and a projected band are both present |
| `:89-91` | measured vs estimate differ in computed **font-family** |
| `:92-94` | differ in computed **font-style** |
| `:95-97` | differ in computed **colour** |
| `:98-100` | `Number(measured.fontWeight) > Number(estimate.fontWeight)` — measured is the heavier |
| `:105` | **`.mining-est__tag` count `> 0`** — the `EST` caption is on screen |
| `:106-107` | the board text contains `ESTIMATE` |
| `:108-109` | the board text contains `NOT in the utility score` (case-insensitive) |
| `:110-111` | the board text contains `MINE UPGRADES` |
| `:112-115` | the board says what an upgrade costs against the mine limit |
| `:117-121` | no `null`, `undefined`, `NaN` or `[object Object]` in the rendered board text |
| `:155-156` | **both modes render byte-identical board text** |
| `:160` | zero console errors |

Two consequences the rewrite must honour:
- assertion `:82-84` requires **`renderModuleBand` never to return `''` for a candidate
  row**. It does return `''` when `moduleMultiplier` is not an object (`:194`), so the
  payload contract "every candidate carries `moduleMultiplier`" is load-bearing
  (`shared/intel/miningExpansion.mjs:431`).
- assertion `:105` requires at least one band in the **resolvable** state, since the
  `is-unavailable` variant emits no `__tag` (`:206-207`).

### 5. Truncation

Three capped lists. Only one is announced.

| list | cap | announced? |
| --- | --- | --- |
| `available` candidate rows | `ROW_LIMIT = 8` (`:421`), sliced `:425` | **yes** — `Top {8} of {total}` (`:571-576`) using `availableTotalCount` |
| `techGated` cards | `.slice(0, 4)` (`:434`) | **no** — the header states total *sites* across all groups, never that only four **groups** render |
| `mineUpgrades.opportunities` rows | `UPGRADE_ROW_LIMIT = 5` (`:292`), sliced `:332` | **partially** — the title says `MINE UPGRADES — {n} AVAILABLE` (`:372`) so a reader can subtract, but no omitted count is stated |

Fields that must survive:
- **`availableTotalCount`** — `:424`, `const totalAvailable = num(expansion?.availableTotalCount) ?? available.length`. The `?? available.length` fallback is honest **only because the component fetches with no `limit`**; if a rewrite adds one, the fallback silently reports the truncated length as the total.
- **`availableOmittedCount`** and **`availableUnmeasuredCount`** exist on the endpoint
  (`shared/intel/miningExpansion.mjs:726-728`) and are **never read**. `availableUnmeasuredCount` is the count of sites whose `siteValue` is null — i.e. how much of the ranking is unscored. Surfacing it is the honest fix, and `TruncationNote` covers the first.
- **`techGated[].siteCount`** — the null-refusal at `:430-433` must be preserved verbatim: one unreadable group makes the whole total `null`, rendered as `site count unavailable`, never summed as zero.
- **`mineUpgrades.counts.*`** — the `Excluded: …` line (`:353-365, 391`) is the announcement of *why* an upgrade is not listed. Each of the four counts must survive.
- **`unreachable.totalSites`** — gated `!== null && > 0` (`:605`), so a null total simply omits the line rather than claiming zero.

### 6. Primitive

| need | primitive | fit |
| --- | --- | --- |
| candidate + upgrade tables | `DataTable` variant `mining` | **broken as configured — see flag** |
| registers | `Measured` register `mining` | fits (`Measured.jsx:14` → `mining-meas__value`, `root: null`, so no extra wrapper) |
| the `EST` band | `Estimated` register `mining` | **insufficient — see flag** |
| unavailable numbers | `Value` | fits, but `unit()`'s suffix-dropping (`:45-51`) is not expressible — pass a custom `format` |
| `Top 8 of N` | `TruncationNote` | fits for the candidate table; the `techGated` card cap needs one too |
| the card | `Panel` — **not needed** | wrapper is in `public/v2/index.html:414-424` |

**FLAG 1 — `DataTable` variant `mining` puts the wrong class on upgrade rows and will
break `verify_mining_registers.js`.** `src/v2/components/tableVariants.js:48` sets
`row: 'mining-candidate-row'` for the whole variant, including sub-variant `upgrades`
(`:50-52`). The legacy component emits **two different row classes**:
`mining-candidate-row` (`:262`) and `mining-upgrade-row` (`:341`). The verify script counts
both separately (`:70-71`) and asserts `bandCount === candidateRows` (`:82-84`). Rendering
up to five upgrade rows as `mining-candidate-row` inflates `candidateRows` by five while
`bandCount` stays at eight — **the assertion fails, and it fails for the right reason: the
board would be claiming five measured upgrades are unowned candidates.**
`tableVariants.js` needs `row` moved into the sub-variant map, or the upgrades table must
use `children` rather than the `rows` API.

**FLAG 2 — `Estimated` register `mining` cannot produce the `EST` tag or a note.**
`src/v2/components/Estimated.jsx:13` is `{ root: 'mining-est', value: 'mining-est__value',
text: null }`. Two failures:
- there is **no slot for `mining-est__tag`**, which `verify_mining_registers.js:105`
  asserts is present. The primitive cannot satisfy that assertion.
- `text: null` means the `note` prop is **silently dropped** (`Estimated.jsx:42-44`
  requires `classes.text`). A caption that vanishes without error is precisely the honesty
  failure this register exists to prevent.

Either extend `Estimated` with a `tag` slot and a `mining` text class, or render the band
by hand. **Extending the primitive serialises against every other in-flight component** —
say so before the phase starts rather than discovering it mid-migration.

---

## alien-hate-economics

`public/v2/js/components/alien-hate-economics.js` · 323 lines · class **R** ·
global `window.MissionControlHateEconomics = { render, renderHud }` (`:217`).
**Two mounts**: `#alienHateEconomics` on the THREAT view (`public/v2/index.html:487`,
registered `mission-control.js:227-240`) and `#hudHateMeter` in the page header
(`public/v2/index.html:95`), which is **not** in the `VIEWS` registry and therefore not
covered by `assertViewRegistryIntegrity` (`mission-control.js:296+`).

### 1. Payload

Two separate contracts.

**`render(root, economics)`** — `mission-control.js:1230-1234` passes
`state.rawSnapshot.alienHateEconomics` **whole**, no wrapping object. Produced by
`shared/alienHateEconomics.mjs:220-351` via `server/intelligenceFilter.js:124` (which also
attaches `yearsElapsedSource`, `:106`).

Consumed:
- `applicable` (`:109`), `factionName` (`:113`)
- `actualAlienHate` (`:119`), `visibleHateEstimate` (`:122`)
- `hateAboveFloor` (`:134`), `ventingBlockedByTotalWar` (`:131`)
- `minimumAlienHate` (`:158`), `warThreshold` (`:160`)
- `minimumFloorStatus`, `currentWarStatus` (`:140-141`)
- `usedMissionControl`, `missionControlCapacity`, `mcWarFloor` (`:184-186`)
- `completedReductionProjectCount` (`:193`), `reductionProjects[]` → `.applicable`, `.label`, `.completed` (`:139, 196-200`)
- `formula.text` (`:208`), `minimumHateHeadroom`, `concealmentMultiplier` (`:210`)
- `yearsElapsedSource` (`:176`, passed explicitly to `renderTotalWar` — the header comment
  at `:49-51` records that it lives on `economics`, **not** on `totalWar`, and reading it
  off the wrong object silently renders nothing)
- `totalWar` → `.state`, `.progressionSpeedAssumed`, `.alienProgressionSpeed`,
  `.hateThreshold`, `.hateRemaining`, `.yearsThreshold`, `.yearsRemaining`,
  `.maximumAlienHate` (`:52-89`)

Ignored: `status`, `difficulty`, `difficultyKey`, `difficultyMultiplier`,
`capacityAffectsHate`, `actualHateVisibility`, `minimumHateDelta`, `source`,
`formula.{usedMissionControl,difficultyMultiplier,concealmentMultiplier,completedReductionProjectCount,result}`,
`totalWar.yearsElapsed`.

**`renderHud(root, economics, observerHate)`** — `mission-control.js:1334-1339` passes
`document.getElementById('hudHateMeter')`, the same `economics`, and
`observerFactionRecord()?.alienHate` (`mission-control.js:418-420`). The third argument is
the faction's own hate object produced by `server/intelligenceFilter.js:151-156`
(omniscient) or `:226-262` (player/enhanced): `{ actual, playerVisible, visibleEstimate,
pips, maxPips, visibility, status, requiredProject? }`.

`renderHud` consumes `observerHate.pips`, `.visibleEstimate`, `.requiredProject`, and from
`economics`: `warThreshold`, `actualAlienHate`, `visibleHateEstimate`, `minimumAlienHate`,
`applicable`. **It does not write `innerHTML`** — it queries four child nodes
(`#hudHateFill`, `#hudHateFloor`, `#hudHateValue`, `#hudHateStatus`, `:234-237`), sets
`textContent`, inline `style.width` / `style.left`, `hidden`, `title`, and four ARIA
attributes (`:292-320`). **This is an imperative DOM mutation contract, not a props
contract**, and it is the one shape in this group that `render(root, payload)` →
`<Component {...payload} />` does not describe.

### 2. Player-mode difference — **YES, a different answer**

`shared/alienHateEconomics.mjs:257`:

```js
const actualAlienHate = mode === 'player' ? null : actualRaw;
```

One null cascades through six rendered figures:

| figure | omniscient | player |
| --- | --- | --- |
| `Actual hate` metric | numeric, note `raw save value` (`:120-123`) | the **pip string** `■■■□□` (or `UNKNOWN`), note `game-visible estimate` |
| `Hate vent capacity` | `hateAboveFloor` numeric, `conditional · ±20%` | **`RAW-ONLY`**, note `requires raw hate` (`:132-137`) |
| `Current hate` status | `WAR THRESHOLD EXCEEDED` / `BELOW WAR THRESHOLD` | `GAME-VISIBLE ESTIMATE` or `UNAVAILABLE` (`mjs:296-303`) |
| `totalWar.state` | `active` / `armed` / `pending` / `safe` | **`armed_hate_unknown` / `safe_hate_unknown` only** (`mjs:188-192`) |
| `Hate gate` remaining | `{n} to go` | `current hate unknown` (`:78`) |
| `ventingBlockedByTotalWar` | can be `true` | **structurally always `false`** — `totalWar.state === 'active'` requires a non-null hate ≥ 200 (`mjs:192-193, 333`), so the `VOIDED` vent-capacity state is unreachable in player mode |

That last row is the same defect class `CLAUDE.md` records for the Total War veto: a check
that cannot be evaluated must not fall through to "fine". Here the component does the right
thing — `RAW-ONLY` rather than a number — but the **`VOIDED` branch (`:132-138`) can never
be exercised in player mode**, so a rewrite tested only in player mode will never render it.

Also mode-dependent, in the ledger's favour: `visibleHateEstimate` is a **pip string** in
player mode (`server/intelligenceFilter.js:227, 231`) but a **numeric string** in
omniscient (`:154`) and enhanced (`:246-248`). Anything downstream that coerces it to a
number gets `UNAVAILABLE` in player mode — see `executive-boards` §2.

**`renderHud` is where this is riskiest.** `:245` reconstructs a numeric hate from the pip
count — `pips * 10` — and feeds it to the bar fill (`:297`) and `aria-valuenow` (`:319`).
So in player mode the bar position is a **derived estimate rendered in exactly the same
visual register as an omniscient measurement**. `renderHud` uses **no** `.fe-*`/`.de-*`/
`.mining-*` register classes at all; the only signal is the `status` word.

### 3. Unavailable / empty states

`value()` (`:20-22`) returns `'UNAVAILABLE'` for `null | undefined`, else delegates to
`shared.formatNumber`, which itself returns `'UNAVAILABLE'` for a non-finite parse
(`public/v2/js/shared.js:36-43`).

**`render`:**

| # | rendered output | input | line |
| --: | --- | --- | --: |
| 1 | `ALIEN HATE ECONOMICS UNAVAILABLE` | `economics` falsy | `:104-107` |
| 2 | `MINIMUM HATE FLOOR NOT APPLICABLE` + faction name (or `this faction`) | `applicable` falsy | `:109-117` |
| 3 | `UNAVAILABLE` for `Actual hate` | `actualAlienHate` null **and** `visibleHateEstimate` falsy; note `requires available alien threat intel` | `:120-127` |
| 4 | `RAW-ONLY` / `VOIDED` for vent capacity | no raw hate / total war active | `:132-138` |
| 5 | `UNAVAILABLE` for any of Minimum hate, War threshold, Used, Capacity, MC war floor, headroom, concealment multiplier | that field null | `:158-160, 184-186, 210` |
| 6 | `UNAVAILABLE` for `currentWarStatus` / `minimumFloorStatus` | field absent — component-side `||` fallback | `:140-141` |
| 7 | `UNAVAILABLE` for the formula | `formula.text` absent (the module itself emits `UNAVAILABLE — missing used Mission Control or difficulty data`, `mjs:305-306`) | `:208` |
| 8 | `NO APPLICABLE PROJECT MODIFIERS` | no `reductionProjects` entry with `applicable` | `:201` |
| 9 | Total War block **entirely absent** | `totalWar` falsy — `renderTotalWar` returns `''` | `:53` |
| 10 | `UNAVAILABLE` / `Campaign duration or difficulty missing from this snapshot.` | `totalWar.state` unmapped or `unavailable` | `:45-46, 54` |
| 11 | `ARMED — HATE UNKNOWN` / `YEAR GATE CLOSED` | `totalWar.state` is the two hate-unknown states | `:41-44` |
| 12 | `current hate unknown` | `totalWar.hateRemaining === null` | `:78` |
| 13 | `duration unknown` | `totalWar.yearsRemaining === null` | `:80` |
| 14 | `PASSED` | `yearsRemaining === 0` — a **measured** zero, plus `is-emphasis` | `:81-82` |
| 15 | `Assumes default Alien Progression Speed; this snapshot carries no campaign-settings block…` | `progressionSpeedAssumed !== false` | `:60-62` |
| 16 | campaign-age line **omitted entirely** | `yearsElapsedSource` not a non-empty string — *absent stays absent* | `:66-68` |

**`renderHud`:**

| # | tone / status / value | input | line |
| --: | --- | --- | --: |
| 17 | `is-unknown` / `NOT APPLICABLE` / `—` | `economics.applicable === false` | `:255-258` |
| 18 | `is-unknown` / `INTEL GATED` / `UNAVAILABLE` | unavailable **and** `observerHate.requiredProject` set | `:259-262` |
| 19 | `is-unknown` / `UNAVAILABLE` / `UNAVAILABLE` | numeric null and estimate falsy or `'UNAVAILABLE'` | `:248-249, 259-262` |
| 20 | floor marker `hidden` | `minimumAlienHate` null, or unavailable | `:299-302` |
| 21 | `aria-valuenow` removed | `numeric === null` | `:320` |

**Live defect — unknown renders as safe.** `:248-249`:

```js
const unavailable = !applicable || (numeric === null && (!estimate || estimate === 'UNAVAILABLE'));
```

The player-mode filter emits `visibleEstimate: 'UNKNOWN'` when the save carries no hate
(`server/intelligenceFilter.js:227`). `'UNKNOWN'` is truthy and is not `'UNAVAILABLE'`, so
`unavailable` is `false`. `pipCount('UNKNOWN')` returns `null` (`:227`), `observerHate.pips`
is `null`, so `numeric` is `null` and control reaches the final `else` (`:278-289`):
`pips >= 5` is `false` for null, `pips >= 4` is `false`, so it falls through to
**`tone = 'is-safe'; status = 'GAME ESTIMATE'`** with `valueText = 'UNKNOWN'`.

An **unmeasured** alien hate therefore renders as a green meter labelled `GAME ESTIMATE`.
That is the repo's stated rule — *unknown is not the same as safe* — inverted, in the one
function with no test coverage at all.

**Second fabricated default:** `:238` — `const warThreshold = Number(economics?.warThreshold)
> 0 ? … : 50;`. An absent threshold silently becomes the magic number `50`, and it is then
used as the bar denominator and as `aria-valuemax` (`:318`). `render` (`:160`) correctly
prints `UNAVAILABLE` for the same field. The two halves of one component disagree.

### 4. Measured vs estimated registers

**None.** This component carries no `.de-*` / `.fe-*` / `.mining-*` register classes, and
no verify script inspects its computed style. The measured/estimated distinction is carried
**in words only** — the metric `note` strings `raw save value` vs `game-visible estimate`
(`:123-127`), and `RAW-ONLY` (`:134`).

Given §2, that is a real gap rather than a component that legitimately has one register:
`Actual hate` is a measurement in omniscient and a five-pip estimate in player, rendered at
identical weight in the same `<strong>` (`metric()`, `:92-100`). **Applying
`Measured`/`Estimated` here is a behaviour change, not a port** — worth doing, but it must
be flagged as a change rather than smuggled in.

### 5. Truncation

**None.** No list is capped; `reductionProjects` is filtered by `applicable` (`:139`) but
never sliced, and the filtered-out count is not shown — `completedReductionProjectCount`
(`:193`) counts *completed*, which is a different quantity. No `*TotalCount` /
`*OmittedCount` field exists on this payload.

### 6. Primitive

| need | primitive | fit |
| --- | --- | --- |
| `UNAVAILABLE` numerics | `Value` | good fit; `unavailableLabel="UNAVAILABLE"` is already the default (`Value.jsx:41`) |
| the metric tiles | **none of the five** | `metric(label, value, note, className)` (`:92-100`) is a three-line stat tile with a tone modifier. It is used 7× here and has no counterpart in the primitive set. |
| the `<details>` disclosures | **none of the five** | two of them (`:163-174`, `:205-212`) |
| `Panel` | not needed | `.tech-card` wrapper is in `public/v2/index.html:481-490` |
| `DataTable` | not needed | no table |
| `Measured` / `Estimated` | **should** be added (see §4) — currently absent |
| `TruncationNote` | not needed |

**FLAG — two things this component needs are not in the primitive set.**

1. **A stat-tile primitive.** `metric()` renders `.alien-hate-econ-metric` with an optional
   tone class. `mc-budget` is documented as taking the same `render(root, payload)` shape
   and the tone vocabulary (`is-safe` / `is-warning` / `is-danger` / `is-emphasis` /
   `is-unknown`) recurs across the product. Either add a `StatTile`, or accept per-component
   markup and say so.
2. **`renderHud` is not a render-props component at all.** It mutates five pre-existing DOM
   nodes owned by `public/v2/index.html:95+`, sets inline styles, and writes four ARIA
   attributes onto the mount itself. A React rewrite must either take ownership of the whole
   `#hudHateMeter` subtree (changing the header markup and any CSS or test that targets
   `#hudHateFill` / `#hudHateFloor` / `#hudHateValue` / `#hudHateStatus`), or stay imperative.
   **The strangler cannot mount this as a sibling.** Note also `mission-control.js:877-882`
   attaches a click handler to `#hudHateMeter` that navigates to the THREAT view and scrolls
   `#alienHateEconomics` into view — a rewrite that replaces the node loses that listener.

---

## executive-boards

`public/v2/js/components/executive-boards.js` · 415 lines · class **R** ·
`window.MissionControlBoards` (`:406-414`). No mount of its own — **seven** render
functions, seven different containers.

### What it exposes, precisely

```js
window.MissionControlBoards = {
  renderFactionLedger,      // (container, snapshot)
  renderLogisticsBoard,     // (container, snapshot, strategic)
  renderCapabilityMatrix,   // (container, snapshot, briefing)   ← briefing UNUSED
  renderTheaterBoard,       // (container, snapshot, strategic)
  renderOperationsBoard,    // (container, snapshot, strategic)
  renderNationQueue,        // (container, snapshot, briefing)
  renderResearchWatchlist   // (container, snapshot)
};                                              // executive-boards.js:406-414
```

| export | signature | mount id | controller fn | call site | legacy fallback if global absent? |
| --- | --- | --- | --- | --: | --- |
| `renderFactionLedger` | `(container, snapshot)` | `#factionDonutContainer` | `renderFactionDonut` | `mission-control.js:1569-1571` | **yes** — SVG donut chart, `:1573-1636` |
| `renderLogisticsBoard` | `(container, snapshot, strategic)` | `#resourceFlowChart` | `renderResourceFlowChart` | `:1640-1642` | **yes** — `:1643-1663` |
| `renderCapabilityMatrix` | `(container, snapshot, briefing)` | `#powerTrajectoryChart` | `renderPowerTrajectoryChart` | `:1667-1669` | **yes** — power-profile bars, `:1670-1690` |
| `renderTheaterBoard` | `(container, snapshot, strategic)` | `#dualAssetRings` | `renderDualAssetRings` | `:1694-1696` | **yes** — asset rings, `:1697-1734` |
| `renderOperationsBoard` | `(container, snapshot, strategic)` | `#opLeaderboardList` | `renderOperativeLeaderboard` | `:1738-1740` | **yes** — skill bars, `:1741-1771` |
| `renderResearchWatchlist` | `(container, snapshot)` | `#researchWatchlist` | `renderResearchWatchlist` | `:1775-1777` | **no** — renders nothing |
| `renderNationQueue` | `(container, snapshot, briefing)` | `#holdingsBubbleMatrix` | `renderHoldingsBubbleMatrix` | `:1839-1841` | **yes** — GDP bubbles, `:1842-1870` |

Two structural facts a strangler mount must account for:

1. **Every mount id is a legacy chart name.** `#factionDonutContainer` renders a faction
   *ledger table*; `#powerTrajectoryChart` renders a *capability matrix*;
   `#holdingsBubbleMatrix` renders a *nation queue*; `#dualAssetRings` renders a *theater
   board*. Matching component to element by name is wrong in all seven cases.
2. **Six of the seven controller functions still contain a complete pre-component
   implementation that runs when the global is absent.** They are dead today only because
   `public/v2/index.html:633` loads the script. This is the single riskiest thing in this
   group — see the closing note.

The seven mounts also span **three** views: `command` (`opLeaderboardList`), `expansion`
(`resourceFlowChart`, `holdingsBubbleMatrix`), `threat` (`dualAssetRings`,
`powerTrajectoryChart`), `records` (`factionDonutContainer`, `researchWatchlist`) —
`mission-control.js:168-255`.

### 1. Payload

`state.rawSnapshot` is the mode-filtered snapshot (`/api/snapshot`); `state.briefing` and
`state.briefing.strategic` come from `/api/v2/briefing`. Fields consumed, per board:

**`renderFactionLedger(container, snapshot)`** — `snapshot.factions[]` →
`ID`, `displayName`, `templateName` (via `factionLogoImgHtml`), `totalGdp`, `totalResearch`,
`controlPointsCount`, `habsCount`, `shipsCount`, `alienHate.visibleEstimate`,
`assessedAlienHateOfMe`; `snapshot.observerFactionId`;
`snapshot.changesSincePrevious.factions[].{factionId,changes[].{metric,delta}}` (`:21-25, 57-69`).

**`renderLogisticsBoard(container, snapshot, strategic)`** — `snapshot` is **unused**;
reads `strategic.resourcePosition.resources` → per resource `label`, `stock`,
`grossPerMonth`, `spendPerMonth`, `runwayDays`, `underConstruction[].{body,site,daysRemaining}`,
`topProducers[0].{site,monthly}` (`:72-87`).

**`renderCapabilityMatrix(container, snapshot, briefing)`** — **`briefing` is accepted and
never referenced** (`:113-157`). Reads `snapshot.factions[]`, `snapshot.observerFactionId`,
`snapshot.fleets[].{factionId,weaponBreakdown[].{role,category,count}}`,
`snapshot.capabilities.{canDetectAlienOperations,details}`, and the observer's
`completedProjects[]` (`:95-143`).

**`renderTheaterBoard(container, snapshot, strategic)`** —
`strategic.spaceTheaters[].{key,name,fleets,habs,miningSites,ownShips,ownFleets,alienShips,alienFleets,ownHabs,ownMiningSites}`,
`strategic.spacePosture.{scope.{totalLabel,solLabel,note},total.{fleets,ships},sol.{fleets,ships}}`,
`snapshot.fleets[].{factionId,factionName,displayName,shipsCount,orbitBody,spaceTheaterKey,destination,arrivalDate,mission,dominantWeaponType,weaponSummary,weaponBreakdown[],ships[].{displayName,weaponLoadout[].{count,systems,role,category}}}`
(`:159-250`).

**`renderOperationsBoard(container, snapshot, strategic)`** —
`snapshot.councilors[]` filtered to `factionId === observerFactionId`,
`isActiveCouncilor !== false`, `isIndependent !== true`, `status` ≈ `active` (`:327`);
per councilor `displayName`, `locationName`, `activeMissionName`, and the attribute triple
`resolvedAttributes.{effective,base,orgBonuses,traitBonuses,appliedBonus,capped,uncapped,orgsActive}`
/ `maskedAttributes[skill].visible` / `attributes[skill]`, plus
`isOwnCouncilor`, `isTurnedMole`, `visibility` (`:260-296`);
`strategic.councilCapabilities.missionRoles[].{mission,skill,best.{name,value}}` (`:330-331`).

**`renderNationQueue(container, snapshot, briefing)`** —
`snapshot.nations[].{ID,displayName,executiveFactionId,executiveFactionName,controlPoints[].{factionId,factionName},GDP,research,cohesion,unrest,armies,nukes}`,
`snapshot.observerFactionId`, `briefing.priorityTargetFaction.id` (`:344-364`). *(Verified:
the briefing does carry `{ id, name }` — `server/briefingGenerator.js:330-332`.)*

**`renderResearchWatchlist(container, snapshot)`** —
`snapshot.globalResearch.activeSlots[].{displayName,techId,percent,leadFactionName,leadContribution}`,
observer `currentProjects[].{displayName,projectId,percent,accumulatedResearch,totalCost}`,
`snapshot.techTree.nodes[].{id,availability.{known,schedulable,maxPercent,expectedMonths}}`,
`snapshot.capabilities.details[].{name,active,requiredDisplayName,requiredProject}` (`:385-404`).

All seven depend on `window.MissionControlShared` destructured at module load
(`:8-10`): `escapeHtml`, `numberValue`, `formatNumber`, `formatGdp`, `formatDelta`,
`bodyKey`, `bodyLabel`, `factionLogoImgHtml`. **The destructure is unguarded** — if
`shared.js` has not loaded, every board throws on first call rather than degrading.

### 2. Player-mode difference — **YES for four of seven; two are near-invariant; one is invariant**

| board | different answer in player mode? |
| --- | --- |
| `renderFactionLedger` | **YES.** The `HATE` column reads `faction.alienHate?.visibleEstimate ?? faction.assessedAlienHateOfMe` (`:60`). In **omniscient** `visibleEstimate` is a numeric string (`server/intelligenceFilter.js:154`) and `formatNumber` renders a number. In **player** it is the pip string `■■■□□` (`:231`); `numberValue('■■■□□')` is `null` (`shared.js:26-30`) so `formatNumber` returns **`UNAVAILABLE`** (`shared.js:38`). Every faction's hate cell reads `UNAVAILABLE` in player mode even though a five-pip estimate exists and is what the game shows. And `assessedAlienHateOfMe` — the `??` fallback — is stripped in player mode (`server/intelligenceFilter.js:277-280`), so the fallback is dead there by design. |
| `renderTheaterBoard` | **YES.** `snapshot.fleets` is observation-filtered (`server/intelligenceFilter.js:618`, `filterSpaceAssets`), so alien fleet count, ship totals, `largest hostile fleet`, `inbound` and the whole `SOL FRAGMENTATION` verdict (`:201-229`) are computed over a **smaller set**. Own-fleet `ships[].weaponLoadout` survives (own faction), but rival ship detail does not. |
| `renderCapabilityMatrix` | **YES, partially.** `rankLabel` (`:89-93`) sorts every faction by `totalGdp` / `totalResearch` / `shipsCount` / `habsCount`; whichever of those the filter redacts for rivals changes the observer's **rank**, i.e. `#3 / 8` becomes a different number. The `completedProjectSignal` rows (`:120-137`) read the observer's own `completedProjects`, which player mode keeps whole (`server/intelligenceFilter.js:265`), so those four rows are invariant. |
| `renderResearchWatchlist` | **YES, partially.** `globalResearch` is unfiltered (`server/intelligenceFilter.js:628`) so global slots match, but `observer.currentProjects` and `capabilities.details` are observer-scoped and identical — the difference is only that a rival's project state never appears in either mode here. Effectively near-invariant; verify rather than assume. |
| `renderOperationsBoard` | **near-invariant by construction.** It filters to `factionId === observerFactionId` (`:327`), and own councilors keep `resolvedAttributes` in both modes (`server/intelligenceFilter.js:477` routes own records around `sanitizeObservedCouncilor`). The `skillDetail` masked-fallback branch (`:265-274`) — which exists precisely because observed enemies carry `maskedAttributes` and not `attributes` — is therefore **unreachable from this board**. It is still live code and must be ported; it is exercised by nothing here. |
| `renderNationQueue` | **verify.** `nations` are filtered (`visibleNations`, `server/intelligenceFilter.js:617`); whether rival `controlPoints` survive determines whether the `CP composition` column and the `CRACKDOWN` posture differ. Not determinable from the component alone. |
| `renderLogisticsBoard` | **invariant.** Reads only `strategic.resourcePosition`, which is the observer's own stockpiles and production. |

### 3. Unavailable / empty states

Note first: the two shared formatters used throughout return **different** sentinels —
`formatNumber` → `'UNAVAILABLE'` (`shared.js:38`), `formatDelta` → `'—'` (`shared.js:60-62`),
`formatGdp` → `'UNAVAILABLE'` (`shared.js:56`). Both appear in the same table row.

| # | rendered output | input | line |
| --: | --- | --- | --: |
| 1 | `No records are available in this view.` (div) | `rows` argument falsy | `:44` |
| 2 | per-board empty row (`colspan`) — `No faction records are available.` / `Resource production is unavailable in this snapshot.` / `No capability records are available.` / `No theater posture is available.` / `No hostile contacts are visible.` / `No active councilors are available.` / `No nation holdings are available.` / `No global research slots are available.` / `No active faction projects are available.` / `No locked capability records are available.` | `rows` is `''` | `:46, 69, 86, 156, 249, 332, 363, 403` |
| 3 | `UNAVAILABLE` for the hate cell | hate `undefined`/`null`, **or** any non-numeric string (see §2) | `:62` |
| 4 | `UNAVAILABLE` for any `formatNumber` / `formatGdp` field | that field null-ish or non-finite | throughout |
| 5 | `—` for a delta | `factionDelta` found nothing, or `delta` non-finite | `shared.js:60-62`, used `:67` |
| 6 | `No visible queue` | `resource.underConstruction` empty | `:78-80` |
| 7 | `No active producer` | `topProducers[0]` absent | `:81-83` |
| 8 | `UNAVAILABLE` for spend / runway | explicit `=== null` test, correct | `:84` |
| 9 | `+UNAVAILABLE` | `grossPerMonth` or `topProducers[0].monthly` null — the `+` is prepended **outside** the formatter | `:82, 84` |
| 10 | `UNAVAILABLE` for a rank | faction not found in the ranked list | `:92` |
| 11 | `UNAVAILABLE` for a completed-project signal | no completed project matches the regex | `:108` |
| 12 | `UNAVAILABLE` for `Dominant loadout` | `ownWeaponMix` empty | `:149` |
| 13 | `No fleet loadout visible` | same, third column | `:149` |
| 14 | `UNAVAILABLE` for `Alien intelligence` detail | none of the four intel keys present | `:139-143` |
| 15 | `Loadout unavailable` | `ship.weaponLoadout` empty, or `fleet.weaponSummary` absent | `:167, 196-197` |
| 16 | `Ship-level loadouts are unavailable for this fleet.` | `fleet.ships` empty | `:184` |
| 17 | `No fleet composition is visible for the selected faction.` | observer has no fleets | `:194` |
| 18 | `UNAVAILABLE` for `SOL FRAGMENTATION` and `AVERAGE SOL FLEET` | no Sol fleets → `averageSolFleet === null` | `:205-208, 247` |
| 19 | `Alien force posture is unavailable in this intelligence mode.` | no alien fleet grouped by body | `:247` |
| 20 | `—` for `Largest hostile fleet` | no hostile fleet in that theater | `:243` |
| 21 | `—` for `Inbound` | `inbound` is **`0`** — a measured zero rendered as the absent marker | `:243` |
| 22 | `—` for `ETA` | `fleet.arrivalDate` falsy | `:245` |
| 23 | `UNAVAILABLE` for a fleet `Mission` | `fleet.mission` falsy | `:245` |
| 24 | `Unknown body` | `bodyLabel('')` (`shared.js:91-94`) | throughout |
| 25 | `—` in a skill cell | `skillDetail(...).value === null` | `:304` |
| 26 | `UNAVAILABLE` for `Role` | no skill resolved to a non-null value | `:322` |
| 27 | `UNAVAILABLE` / `—` in mission coverage | `role.best.name` absent / `role.best.value` null-or-undefined | `:331` |
| 28 | `Unknown` location, `No active mission` | councilor fields absent | `:329` |
| 29 | `Independent` executive, `No CP detail` | `executiveFactionName` absent / no control points | `:359, 361` |
| 30 | `UNKNOWN` availability chip | `node.availability` absent or `known !== true` | `:370-374` |
| 31 | `RNG {n}% CAP` chip | `schedulable === false` — **not** a queue position | `:381-382` |
| 32 | availability wait suffix omitted | `expectedMonths` null/undefined | `:375-377` |
| 33 | `Requirement unavailable` | neither `requiredDisplayName` nor `requiredProject` | `:402` |
| 34 | `Unnamed fleet` / `Unnamed ship` / `Unknown faction` | missing names | `:196-197, 185, 18` |

**`Number(null) === 0` sites — this board is the densest concentration in the group.**
Every one of these turns an unknown into a confident zero, silently:

| line | expression | consequence |
| --: | --- | --- |
| `:31` | `(numberValue(b[key]) || 0) - (numberValue(a[key]) || 0)` | a faction with an unreadable metric sorts **last as if it were zero**; `maxFactionId` then names the wrong leader |
| `:38` | `(numberValue(faction.controlPointsCount) || 0) >= 50` | unknown CP count → not `POLITICAL NETWORK` → falls through to `SCATTERED` |
| `:39` | `(numberValue(faction.habsCount) || 0) >= 15` | same, for `ORBITAL BUILDUP` |
| `:90` | `(numberValue(b[key]) || 0) - …` in `rankLabel` | the observer's published **rank** is computed against fabricated zeros |
| `:100` | `totals[role] += (numberValue(entry.count) || 0)` | an unreadable weapon count contributes 0 to the dominant-loadout mix |
| `:162` | `.reduce((t, e) => t + (numberValue(e.count) || 0), 0)` | `weaponCount` — the PD/missile/laser/kinetic columns on the contact board |
| `:203-204` | `sum + (numberValue(fleet.shipsCount) || 0)` | `totalShips` / `solShips` under-report with **no announcement**, and `averageSolFleet` (`:205`) then drives the `HIGH / MODERATE / LOW` fragmentation verdict |
| `:214` | `group.ships += numberValue(fleet.shipsCount) || 0` | per-body force concentration |
| `:240` | `(numberValue(b.shipsCount) || 0) - …` | `largest hostile fleet` selection |
| `:277-278` | `numberValue(resolved.orgBonuses?.[skill]) || 0` | an unreadable org bonus reads as "no bonus" |
| `:337` | `numberValue(nation.unrest) || 0` | unknown unrest → `>= 2` false → `CONSOLIDATE` instead of `DEFEND` |
| `:351` | `(numberValue(b.GDP) || 0) - …` | nation sort order |
| `:360` | `(numberValue(nation.unrest) || 0) >= 2` | the `· unrest watch` flag never fires on unknown unrest |
| `:401` | `(numberValue(b.percent) || 0) - …` | project sort order |

**Raw value into a template literal**: `:306` — `const parts = [`${detail.base} base`]`. On
the resolved-attribute path `base` is `numberValue(resolved.base?.[skill])` (`:284`) and can
be `null` while `detail.value` is not, producing the tooltip text `null base`. Escaped
(`:311`) but still the literal word.

### 4. Measured vs estimated registers

**None, and it is arguably needed.** No `.de-*` / `.fe-*` / `.mining-*` classes appear
anywhere in this file, and no verify script inspects its computed style.

Several boards mix registers in one table without marking them, and the `mc-board-note`
prose is the only signal:
- `factionStatus` (`:34-41`) — a **derived label** (`EARTH ECONOMIC POWER`, `SCATTERED`)
  beside measured GDP and ship counts.
- `alienForceSummary.fragmentation` (`:206-208`) — a **derived verdict** rendered in the
  same `<strong>` as the measured ship totals beside it (`:247`).
- `nationPosture` (`:335-342`) — the board note calls these *"triage labels … not completed
  operations"* (`:363`), which is the honest statement, but the chip itself is styled like
  the measured columns.
- `availabilityChip` (`:370-383`) — `GUARANTEED` / `RNG n% CAP` is a **probability model**,
  correctly toned `is-safe` / `is-warning` but not registered.

Introducing registers here is a **behaviour change**, not a port. Decide deliberately.

### 5. Truncation

Five caps. **Three are silent.**

| list | cap | announced? | line |
| --- | --- | --- | --: |
| `nations` | `.slice(0, 12)` | **no** | `:352` |
| hostile contacts | `.slice(0, 8)` | **no** — the subheading says *"Largest visible contacts by ship count"*, which implies but does not state a cap | `:245` |
| alien force by body | `.slice(0, 6)` | **no** — subheading *"Largest concentrations first"* | `:219` |
| intelligence gaps | `.slice(0, 6)` | **no** | `:402` |
| queued construction preview | `.slice(0, 2)` | **yes** — prefixed `{queue.length} queued · …` (`:78-80`) |

**No `*TotalCount` or `*OmittedCount` field exists anywhere in this component.** The
underlying arrays (`snapshot.nations`, `snapshot.fleets`, `capabilities.details`) carry the
true totals, so a rewrite can compute them — but nothing survives today because nothing is
emitted. Per `CLAUDE.md`, *"a 25-entry slice presented as the whole set is the same defect
class as fabricating data"*: **four such slices ship today.** `TruncationNote` closes all
four for free.

### 6. Primitive

| need | primitive | fit |
| --- | --- | --- |
| all nine tables | `DataTable` variant `mc-board`, sub-variants `ledger` / `fleet` | mostly — see flags |
| `UNAVAILABLE` numerics | `Value` | good fit; would also fix the fifteen `|| 0` sites |
| the four silent caps | `TruncationNote` | good fit and a genuine improvement |
| `Panel` | not needed | `.tech-card` wrappers live in `public/v2/index.html` |
| `Measured` / `Estimated` | see §4 — a deliberate decision, not a port |

This is the highest-leverage `DataTable` exercise in the product: **nine** `tableShell`
calls across seven boards, and `.mc-board-table` is the most-shared table class.
`tableVariants.js:19-31` already maps `mc-board-table-wrap` / `mc-board-table` /
`mc-board-scroll-hint` with `hintPlacement: 'after'`, which is what
`syncScrollHints` (`mission-control.js:280`), `tests/commandLayout.test.js:108-115` and
`tests/missionControlLayout.test.js:186` all expect.

**FLAG 1 — `DataTable`'s `rows` API cannot express these tables.** Every row here uses
`<th scope="row">` for its first cell (`:67, 84, 156, 196, 329, 361, 399, 401, 402`) and
`<th scope="col">` in the header (`:46`). `DataTable` emits `<th>` only in `<thead>` and
never sets `scope` (`DataTable.jsx:104-139`). All nine tables must use the `children`
escape hatch, or `DataTable` needs a row-header option. Using `children` means the
`columns`-derived `<thead>` and the `rowClass`/`cellClass` mapping go unused — worth
knowing before this is chosen as the primitive's proving ground.

**FLAG 2 — hint text differs.** Legacy emits `SWIPE HORIZONTALLY TO VIEW ALL COLUMNS`
(`:46`); the primitive default is `SWIPE HORIZONTALLY TO SEE MORE COLUMNS`
(`tableVariants.js:66`). Pass `hintText` explicitly.

**FLAG 3 — an extra wrapper `<div>`.** For `hintPlacement: 'after'`, `DataTable` wraps both
the wrap and the hint in a `<div data-primitive="data-table">` (`DataTable.jsx:159-166`).
`wrap.nextElementSibling` still resolves to the hint, so `syncScrollHints` and both layout
tests keep working — but any CSS using a child combinator from the mount, and
`tests/missionControlLayout.test.js:214` (`grid.querySelectorAll('.mc-board-table-wrap')`,
descendant, safe), should be re-checked. Verify `.mc-watch-grid > section` layout
(`:403`) after the change.

**FLAG 4 — `mc-board` sub-variants are incomplete.** `tableVariants.js:27-30` defines
`ledger` and `fleet`. The component passes exactly those two (`:69, 198`) and `undefined`
for the other seven, so the map is currently correct — but `mining`'s `upgrades`
sub-variant is defined in the same file and, unlike `mc-board`, its variant-level `row`
class is wrong (see mining §6 FLAG 1). Do not assume the variant table has been validated
against the components.

---

## The single riskiest thing for a rewrite

**Six of `executive-boards`' seven mounts have a live legacy implementation behind them in
`mission-control.js` that runs whenever the global is absent** — `renderFactionDonut`
(`:1573-1636`), `renderResourceFlowChart` (`:1643-1663`), `renderPowerTrajectoryChart`
(`:1670-1690`), `renderDualAssetRings` (`:1697-1734`), `renderOperativeLeaderboard`
(`:1741-1771`), `renderHoldingsBubbleMatrix` (`:1842-1870`). Each is shaped as

```js
if (window.MissionControlBoards?.renderX) { …; return; }
/* …the pre-component chart… */
```

so a React strangler that mounts at `#opLeaderboardList` and drops the global does not
fail — it **silently reverts the panel to a 2024-era donut/bar chart**, and then
`renderDashboard()` overwrites the React root's `innerHTML` on every refresh, mode switch
and save reload. With no named unit test on any of the seven, and only two layout probes
(`tests/commandLayout.test.js:105`, `tests/missionControlLayout.test.js:214`) that assert
structure rather than content, the regression is invisible to CI and looks like "the
component just re-rendered".

Delete the fallbacks — or assert on `window.MissionControlBoards` in
`assertViewRegistryIntegrity` — **before** migrating, not after.
# Component data contracts — group 3

`fleet-procurement.js` · `research-advisor.js` · `world-map.js`

Written 2026-08-24 against working tree at `6368c88` (dirty — see *Contradictions*).
Every figure below was read from the source, or captured live from the running
Express server against `Autosave.gz` (campaign save in `config.json`), observer
`4712`, in **both** `player` and `omniscient` mode. Captures are in this
scratchpad as `ra-player.json`, `ra-omni.json`, `fp-player.json`, `fp-omni.json`,
`refit-player.json`, `refit-omni.json`, `both-player.json`, `brief-player.json`,
`brief-omni.json`.

---

## Contradictions with `docs/react-component-contracts.md`

Recorded up front because they change the risk assessment for all three phases.

| doc claim | line | what the source says |
| --- | --- | --- |
| `research-advisor` — "4 verify scripts, **no unit test**" | `docs/react-component-contracts.md:77` | `tests/refitAdvisor.test.js:1006` loads `public/v2/js/components/research-advisor.js` into a `vm` context and asserts against `slotFacts()` (`:1030`, `:1049`) and `openFullRanking()` (`:1042`). It is committed and it runs in `npm test`. The doc's *spirit* holds — nothing covers `render()` — but the flat claim is false. |
| `fleet-procurement` — pinned by `verify_research_vs_procurement.js` only | `docs/react-component-contracts.md:76` | `tests/refitAdvisor.test.js:31-43` loads `fleet-procurement.js` into a `vm` and exercises `renderRefitDesignCard` at `:321`, `:755`, `:820`, `:944` and `render` at `:755`. Committed unit coverage exists. |
| `world-map` — "**none by name**" | `docs/react-component-contracts.md:83` | `tests/world-map.test.js` (409 lines, 15 tests) exists in the working tree and covers `render()`, the em-dash discipline, the 6-record slice, the type ladder and the GeoJSON failure path. **It is untracked** (`git ls-files --error-unmatch` fails). The doc was true at its own commit `8862a55`; a sibling in-flight session added the file. Do not count it as coverage until it is committed. |
| class R / class F is a clean split | `docs/react-component-contracts.md:31-53` | `world-map` is listed class R, and it *is* fed its data by the controller — but it **also self-fetches** `/v2/data/world.geojson` (`world-map.js:272-281`, called at `:506`) through a module-level cache `geographyCache` (`:9`). It is a hybrid, and it owns a loading state (`:351`), an error state (`:375-380`) and a cross-instance cache that a React rewrite has to place somewhere. |
| the four verify scripts for `research-advisor` | `:77` | Three genuinely exercise it: `scripts/verify_research_actionability.js` (`:80-90` reads `.research-advisor`, `.ra-queue`, `.ra-group.is-actionable`, `.ra-row__*`), `scripts/verify_research_tab_layout.js` (`:71-138`, ≤4 distinct font sizes, no leaf overflow, census lines), `scripts/verify_research_vs_procurement.js` (`:182-216`, asserts procurement must **not** be inside the advisor). The fourth, `scripts/verify_drive_path_modal.js`, only *cites* `docs/research-advisor-spec.md` in a comment at `:18` — it asserts nothing against the component. Treat the pin count as three. |

---

## fleet-procurement

`public/v2/js/components/fleet-procurement.js` · 607 lines · class **F** ·
global `MissionControlFleetProcurement` (`:602-606`).

### 1. Payload

Two endpoints, fetched in parallel and returned as one object
(`fetchProcurement`, `:585-600`):

```
GET /api/intel/research-ranking?observer={id}&mode={mode}&detail=full   (:590)
GET /api/intel/refit-advisor?observer={id}&mode={mode}&detail=full      (:591)
→ { procurement: <ranking response|null>, refit: <refit response|null>, military: … }
```

Call site: `public/v2/js/mission-control.js:1263-1273`. `render(fleetEl, data)`
is called **unconditionally** on resolve (`:1270`), so `data === null` is a
supported input and reaches the unavailable branch. A `requestSequence` guard
(`:1266`, `:1269`) drops a stale in-flight response.

`render(container, payload, refitPayload = null)` (`:467`) normalises:
`procurementPayload = payload?.procurement ?? payload` (`:471`), so it accepts
either the wrapper or a bare ranking response. `refits = refitPayload ?? payload?.refit` (`:472`).

**`military` on the wrapper (`:595`) is dead.** `render` never reads
`payload.military`; it reads `procurementPayload.military`. A rewrite may drop it.

#### Fields consumed from `/api/intel/research-ranking`

Only three container fields and one array. Everything else in the 906 KB
response is unread.

| path | read at | use |
| --- | --- | --- |
| `success` | `:475` | `=== false` → unavailable |
| `military` | `:475`, `:487` | absent → unavailable |
| `military.procurement.count` | `:489`, `:515`, `:521` | header "N unfielded"; truncation denominator |
| `military.procurement.label` | `:490`, `:520` | group heading, default `'Already unlocked, not in service'` |
| `military.procurement.items[]` | `:488`, `:154` | the rows |

Per item in `military.procurement.items[]`:

| field | read at | note |
| --- | --- | --- |
| `displayName` | `:105`, `:163` | falls back to `'unnamed candidate'` |
| `gateProjectName` | `:106`, `:161` | tooltip only — never body text |
| `improvementMultiple` | `:140`, `:164` | through `mult()` |
| `axisLabel` | `:140`, `:164` | default `'unnamed axis'` |
| `axisBasis` | `:133` | tooltip only |
| `axisKind` | `:124` | `=== 'rule-scalar'` → "no unit" badge |
| `closesDeficit` | `:117`, `:166` | `=== true` only |
| `clearsFloor` | `:118`, `:167` | `=== false` only |
| `clearsDeliveryFloor` | `:119`, `:121`, `:168-169` | tri-state: `false` / `null`+delivery / else |
| `action` | `:130`, `:160` | else `'build'` if hull, else `'refit'` |
| `classKey` | `:130`, `:160` | `=== 'ship_hull'` fallback for `action` |
| `context.family` | `:130`, `:160` | `=== 'ship_hull'` fallback for `action` |
| `context.sustainedOutputDurationS` | `:127-128` | "Ns of fire" badge |
| `context.delivery.shotsPerArrivingRound` | `:156` | detail panel |
| `context.delivery.flightTimeS` | `:157` | detail panel |
| `context.delivery.terminalSpeedKps` | `:158` | detail panel |

#### Fields consumed from `/api/intel/refit-advisor`

| path | read at |
| --- | --- |
| `success` | `:541` (`!== false`) |
| `items[]` | `:540-544`, `:576` |
| `items[].designId` | `:446`, `:461`, `:577` |
| `items[].displayName` | `:302-303`, `:449` |
| `items[].hull` | `:303`, `:450` |
| `items[].role` | `:202`, `:313-315` |
| `items[].roleBasis` | `:202` |
| `items[].isObsolete` | `:209-219`, `:311`, `:316`, `:542-543` |
| `items[].baseline.deltaVKps` | `:224`, `:233`, `:330` |
| `items[].baseline.combatAccelerationMps2` | `:224`, `:233`, `:330` |
| `items[].baseline.drive.driveId` | `:227`, `:322`, `:338` |
| `items[].baseline.drive.displayName` | `:224`, `:239`, `:338`, `:364` |
| `items[].recommendations.drive.{candidateDriveId,driveId,displayName,clearsFloor,deltaVKps,combatAccelerationMps2,dryMassCaveat,floorReason}` | `:228-256`, `:320-367` |
| `items[].recommendations.weapons[].{slot,rationale}` | `:258-264`, `:369` |
| `items[].recommendations.armor.{currentArmor,recommendedMaterial,recommendedMaterialId,threatBasis,weighted}` | `:272-286`, `:381-435` |
| `items[].budgets.power.{summary,thrustScalingFactor}` | `:288-293`, `:438-443` |

**Never read, though present in the live response:** `count`, `itemsShown`,
`itemsOmittedCount`, `isObsoleteStateKnown`, `obsoleteShipDesignsCount`,
`obsoletedShipPartsCount`, `disclaimer`, `nonComposabilityNotice`,
`roleTagFromSave`, `baseline.mass`, `baseline.cruiseAccelerationMps2`,
`baseline.drive.flatMassTons`, `budgets.{hardpoints,reactorClass,composedMass,heat}`,
and every weapon field except `slot` and `rationale`. See §5 — two of those are
truncation counts.

### 2. Player-mode difference

**Not mode-invariant.** The refit half is; the procurement half is not.

**Procurement — genuinely different numbers.** Measured on `Autosave.gz`:

| rendered string (`:156`, detail panel) | player | omniscient |
| --- | --- | --- |
| Copperhead Missile Pod — PD shots per arriving round | **29.0** | **32.6** |
| Spinal Railgun Mk3 — PD shots per arriving round | **13.8** | **15.5** |

Cause: `sources.militaryValue.deliveryEnvironment.pointDefenseInstallations` is
**958** in player and **1,180** in omniscient over the same 738 hulls
(`meanMountsPerHull` 1.298 vs 1.599). Player mode cannot see 222 enemy
point-defence mounts, so the fire each arriving round must survive is measured
against a smaller observed sky. `deliveryFloorReason` differs the same way:
`"…moves from 3.624955 to 28.999639"` (player) vs `"…from 4.075958 to 32.607667"`
(omniscient).

`clearsDeliveryFloor` did **not** flip on this save — Copperhead is `false` in
both — but the flip is possible in principle, and it drives the visible
`fails delivery` badge at `:120`. **Verify the badge in both modes, not the
number.**

The other three procurement rows (reactor, battery, hull) carry
`context.delivery === null` and are byte-identical across modes.

**Refit — mode-invariant on this save, and one field is a live risk.**
All 24 refit items are byte-identical player vs omniscient. But
`recommendations.armor.threatBasis` reads *"Weighted against observed alien fleet
weapon mix (61% energy/X-ray, 39% kinetic/baryonic)"* and `weighted` is `true`
on all 24 — both derived from **observed** alien fleets, which in player mode
exist only behind a detection capability. On a save where the observer is blind,
`weighted` would go `false` and `:419-423` suppresses the red badge entirely.
That degrade path is **unexercised on this save**; not determinable from source
alone whether `weighted:false` also nulls `threatBasis`.

### 3. Unavailable and empty states

`UNAVAILABLE = '—'` (`:18`). `num()` (`:72-76`) is the correct presence guard —
`null`/`undefined`/`''` → `null`, non-finite → `null`. `int` (`:78`), `dec`
(`:84`), `mult` (`:89`) all return the em dash on `null`.

| # | affordance | input that produces it | line |
| --- | --- | --- | --- |
| 1 | `PROCUREMENT DATA UNAVAILABLE` + *"The ranking endpoint did not answer for this snapshot."* | `payload === null` (fetch threw, `:596`) **or** `res.ok === false` (`:593`) **or** `success === false` **or** `military` absent | `:475-485` |
| 2 | `0 UNFIELDED` + *"All researched components and ship hulls are currently in service across your fleet."* | `military.procurement === null` (endpoint emits `null`, not `{count:0}` — `shared/intel/researchRanking.mjs:1247`) or `items.length === 0` | `:492-503` |
| 3 | `N shown · M omitted` census line | `count - items.length > 0` | `:506-509` |
| 4 | em dash inside a row metric | `improvementMultiple` unparseable → `mult()` → `—` | `:140` |
| 5 | `unnamed candidate` / `unnamed axis` | `displayName` / `axisLabel` falsy | `:105`, `:140` |
| 6 | `delivery unchecked` badge (grey, distinct from the amber `fails delivery`) | `clearsDeliveryFloor === null` **and** `context.delivery` present | `:121-123` |
| 7 | *"delivery floor could not be evaluated"* in the detail panel | same as 6 | `:169` |
| 8 | *"Obsolete status unknown (not recorded in save)"* | `isObsolete === null` | `:215-219` |
| 9 | `UNKNOWN ROLE` badge | `role` neither `warship` nor `transport` | `:315` |
| 10 | baseline drive `—` | `baseline.drive.displayName` and `.driveId` both absent | `:224` |
| 11 | ΔV / accel `—` | `baseline.deltaVKps` / `combatAccelerationMps2` absent | `:224`, `:233`, `:330` |
| 12 | *"Drive refit reach floor unknown; baseline ship metrics are unmeasured in this snapshot."* | `recommendations.drive.clearsFloor === null` | `:246-250` (panel), `:353-359` (card) |
| 13 | *"No available drive improves this design without unacceptable ΔV loss"* + `fails floor` badge + `floorReason` | `clearsFloor === false` | `:241-245`, `:341-352` |
| 14 | *"Fitted {drive} optimal under current role"* | `recommendations.drive` falsy | `:360-367` |
| 15 | *"Current armament optimal"* | `recommendations.weapons` empty | `:376-379` |
| 16 | `upgrade fittable` instead of an `N× behind` badge | `ratio === null`, i.e. either armour score is `0` | `:406-407` |
| 17 | *"Performance impact unknown due to unpinned mass model"* / *"…due to mass changes"* / `perf impact unknown` | always, on any weapon or armour recommendation | `:262`, `:280`, `:374` |
| 18 | **Nothing at all** for the whole refit section | `refits === null` (refit fetch failed or `!res.ok`) **or** `refits.success === false` **or** `items.length === 0` | `:541` |
| 19 | **Nothing at all** for the power line | `budgets.power` absent, or `thrustScalingFactor` absent/`null`/`>= 1` | `:438-443` |

**Rewrite hazards in this list:**

- **#18 is a silent failure.** A failed `/api/intel/refit-advisor` fetch renders
  *no refit section and no message*. The procurement half has a proper unavailable
  card (#1); the refit half has none. If a rewrite consolidates the two into one
  loading state this asymmetry will disappear — which is an improvement, but it
  is a behaviour change and must be deliberate, not incidental.
- **#19 conflates "power is fine" with "power was not measured."** The guard at
  `:439` reads `powerInfo?.thrustScalingFactor !== null && … < 1.0`. An *absent*
  `thrustScalingFactor` is `undefined`, which passes `!== null` and fails `< 1.0`,
  so it renders nothing — the same output as a healthy 1.0 plant. It happens not
  to crash, but the check cannot distinguish measured-fine from unmeasured.
  Live: 22 of 24 at `1`, 2 at `0.0594` → `Power scaled to 6% thrust`.
- **`computeArmorScore` fabricates a value.** `:46-56`: `if (!entry) return 1.0;`
  — an armour material absent from the hardcoded 12-entry `ARMOR_DATA` table
  (`:26-39`) is scored **1.0** and that invented number then drives the visible
  `N× behind` ratio at `:404-407`. This is exactly the "never fabricate data for a
  UI fallback" rule. All four armour ids on the live save
  (`CompositeArmor`, `FoamedMetalArmor`, `NanotubeArmor`, `AdamantaneArmor`) are in
  the table, so the path is latent — but a mod, a 1.0-era material or a template
  rename silently produces a confident wrong ratio. `if (!armorId) return 0`
  (`:47`) is fine because `:406` guards `> 0`; `return 1.0` is not.

### 4. Measured vs estimated registers

**No `.de-measured` / `.fe-meas` / `.mining-meas` register markup.** This
component carries the same honesty distinction in *prose* and *badge class*
instead:

- Constant-dry-mass caveat, twice: the section notice at `:553-555`
  (*"Drive figures hold dry mass constant…"*) and the per-card
  `constant-dry-mass caveat` chip at `:331`, plus the panel's
  `NON-COMPOSABILITY NOTICE` at `:295-298`.
- `perf impact unknown` (`:374`), *"Performance impact unknown due to unpinned
  mass model"* (`:262`), *"(Performance impact unknown due to mass changes)"* (`:280`).
- `POWER BUDGET (INFORMATIONAL)` (`:290`) — the endpoint's own
  `budgets.power.informational: true` is never read; the word is hardcoded.
- The `threat-weighted` / `unweighted` chip (`:391`) with `threatBasis` as its
  tooltip (`:390`, `:399`, `:432`).

**A rewrite must not promote any of these into `<Measured>`.** The armour ratio
in particular is *client-computed from a static table*, not measured by the
endpoint — labelling it `<Measured>` would upgrade its epistemic status. If
anything it belongs in `<Estimated>`, and that is a judgement call the phase
should surface rather than make silently.

The two register-asserting scripts (`verify_drive_explorer.js`,
`verify_mining_registers.js`) do not touch this component.

### 5. Truncation

| what caps | where | count fields that must survive |
| --- | --- | --- |
| Procurement list | server-side. `detail=full` → uncapped (`shared/intel/researchRanking.mjs:1251`); any other request → `slice(0, groupLimit)` | **`military.procurement.count`** (`:489`) is the only field carried. The component derives `omittedCount = count - items.length` itself (`:506`) and renders `N shown · M omitted` (`:508`). It does **not** read the endpoint's own `procurement.itemsShown`. |
| Refit list | `count` / `itemsShown` / `itemsOmittedCount` exist at the top of the refit response — **all three are unread**. Live values `24 / 24 / 0`. | If the endpoint ever caps, the component reports the cap as the whole set. **A rewrite should start reading `itemsOmittedCount`.** |
| Refit ordering | `:542-544` partitions active before obsolete and concatenates — no rows dropped. |

Live: procurement `count = 5`, `items.length = 5` at `detail=full`, so
`omittedCount = 0` and the note is absent. **Do not conclude the path is dead** —
it fires the moment procurement exceeds the group limit under a
non-`detail=full` request, which is exactly what a shared fetch could cause (§
shared-fetch note below).

### 6. Primitive

- **`<Panel>`** — `.tech-card` + `.tech-card-header` + `.tech-card-title` for
  the refit section (`:547-551`); the procurement card uses `.fleet-procurement`
  with a `.tech-card-header` inside it (`:477-480`, `:512-516`) rather than a full
  `.tech-card`, so `<Panel>` needs the header-without-card shape or the phase
  must accept a visual change.
- **`<Value>`** — every `int` / `dec` / `mult` call site (`:140`, `:224`,
  `:233`, `:330`, `:373`, `:441`). This is the primitive that matters most here:
  the component already distinguishes absent from zero correctly and `<Value>`
  must not regress it.
- **`<TruncationNote>`** — `:507-509`, `className="ra-census"`. Takes
  `total = procurement.count`, `shown = items.length`.
- **Not `<DataTable>`.** Both halves are `<ul>/<li>` (`:137`, `:523`) and a CSS
  grid of cards (`:556-558`), not tables.
- **Not `<Measured>` / `<Estimated>`** — see §4.

**Flag — needed and not in the set:**

1. **A badge / tag primitive.** `ra-tag` with six modifiers is load-bearing, not
   decoration: `ra-tag--deficit` (`:117`, `:314`, `:415`), `ra-tag--warn`
   (`:118`, `:120`, `:317`, `:347`, `:417`, `:422`, `:441`), `ra-tag--unitless`
   (`:125`), `ra-tag--free` (`:315`), bare `ra-tag` (`:122`, `:128`, `:315`).
   The amber-vs-red split at `:409-424` encodes a stated *presentation judgement*
   (the 2.0 threshold) and the `weighted === false` suppression. Sixteen
   components share `ra-tag`; without a primitive each rewrite re-implements it.
2. **A tooltip contract.** Rule 2 of this file's header (`:9`) — upstream prose
   goes into `title=`, never into the DOM text — is enforced by hand via `attr()`
   (`:100-102`) at eleven call sites. `verify_research_vs_procurement.js:234`
   asserts the tooltip content. In React this must be an explicit prop, not an
   incidental attribute, or the rule is silently unenforceable.
3. **A detail-panel handoff.** `openProcurementDetails` (`:147`) and
   `openRefitDetails` (`:191`) call `global.MissionControlDetailPanel.open()` with
   a `{eyebrow, title, summary, facts[], actions[]}` payload. That is a
   cross-component imperative call with a real shape; it is not one of the five
   primitives and it appears in `detail-panel`, `research-advisor` and here.

---

## research-advisor

`public/v2/js/components/research-advisor.js` · 1,055 lines · class **F** ·
global `MissionControlResearchAdvisor` (`:1049-1054`).

### 1. Payload

```
GET /api/intel/research-ranking?observer={id}&mode={mode}&limit=6   (:1040)
```

Note: **`limit=6`, and no `detail` parameter** — so `detail` defaults to
`'summary'` server-side (`shared/intel/researchRanking.mjs:763`). Returns `null`
on `!res.ok` (`:1041`) or on throw (`:1043-1046`).

Call site `public/v2/js/mission-control.js:1246-1262`, same `requestSequence`
staleness guard (`:1253`, `:1258`), `render(advisorEl, data)` called
unconditionally so `null` is a supported input.

`render(container, payload)` (`:931`). `openFullRanking(payload)` (`:749`) is
also exported and called from the `Full ranking` button (`:1032-1033`) — it reads
a **much wider** slice of the payload than `render` does, and
`tests/refitAdvisor.test.js:1042` calls it directly.

#### Consumed by `render()` — the card

| path | read at |
| --- | --- |
| `success` | `:934` |
| `military`, `economic` | `:934` (presence) |
| `sources.propulsion.available`, `sources.militaryValue.available`, `sources.economicValue.available` | `:948-949`, `:962` |
| `deficit.applied` | `:605` |
| `deficit.{ratio,own,alien,unit,axisLabel,reason,remedyKind}` | `:606-644` |
| `deficit.capability.canContest` | `:625` |
| `deficit.capability.verdictReason` | `:627`, `:639` |
| `slots.available` | `:475`, `:666` |
| `slots.{projectSlotCapacity,freeProjectSlots}` | `:476-490` |
| `slots.slots[]` (length only, `:479`) | `:479` |
| `slots.activeProjects[].{displayName,projectId,percent}` | `:491-495` |
| `slots.{slotsWithPips,slotCount,occupiedWithoutPips,pipsWithoutOccupant,unweightedOccupantCount}` | `:667-677` |
| `military.groups[].{state,label,count,items}` | `:458-467` |
| `military.rankedCount`, `military.candidatesConsidered` | `:1005` |
| `military.unrankable.counts.*` | `:578-581` |
| `military.deliveryDemoted.{count,items[0]}` | `:560-575`, `:1006` |
| `economic.units[].{unit,groups}` | `:968-982`, `:1012` |
| `economic.rankedCount`, `economic.candidatesConsidered` | `:1018` |
| `economic.unrankable` | `:1017` |
| `research.monthlyResearchIncome` | `:984-986` |

Per military row (`militaryRow`, `:343-422`): `slotAction`, `closesDeficit`,
`clearsFloor`, `clearsDeliveryFloor`, `context.delivery`, `axisKind`,
`context.sustainedOutputDurationS`, `alsoUnlocks{totalItems,families}`,
`chain.{stepsCount,totalRemainingCost,monthsAtFullConcentration,immediateNextStep{displayName,cost},destinationDisplayName}`,
`isFirstInClass`, `remainingResearchCost`, `monthsAtCurrentIncome`,
`monthsAtCurrentIncomeState`, `monthsAreUpperBound`, `monthsFastestAllocation`,
`unlockChance.{maxPercent,deltaPercentPerMonth}`, `availabilityState`,
`improvementMultiple`, `axisLabel`, `axisBasis`, `displayName`,
`gateProjectName`, `chainPromoted`, `isZeroCost`.

Per economic row (`economicRow`, `:424-451`): `slotAction`,
`remainingResearchCost`, plus the `researchDuration` set, `unlockChance`,
`availabilityState`, `largestPricedEffect.quantityLabel`, `id`, `displayName`,
`monthlyValue`, `unit`.

#### Additionally consumed by `openFullRanking()` — the modal only

`military.capabilities.items[]` (`:793`), `military.chainPromotion.{horizon,declined[],declinedOmittedCount}` (`:811-841`),
`military.driveChains.items[]` incl. `chain.reachability.{state,months,horizonMonths}` (`:843-861`),
`military.deliveryDemoted.items[]` (`:862-870`),
`sources.militaryValue.deliveryEnvironment.{available,selected,hullsRead,pointDefenseInstallations,meanMountsPerHull}` (`:871-883`),
`slots.{slots[],unweightedOccupants[],recommendation.reason,model.recommendationRefused}` (`:708-745`),
`row.slotNote` (`:768`), `row.destinationAvailabilityLabel` (`:779`).

**Never read:** `formulae`, `method`, `states`, `ordering`, `filter`, `count`,
`items` (the flat top-level list), `military.procurement` **(nothing at all)**,
`military.procurementCount`, `military.actionableGroups`,
`military.aspirationalGroups`, `military.deliveryFloor`, `military.unrankableItems`,
`economic.unrankableItems`, `economic.contextCoverage`, `economic.actionableGroups`.

### 2. Player-mode difference

**Not mode-invariant, but the difference is narrower than the doc's headline
examples and it does not reach the card — only the modal and one tooltip.**

Measured across the two live captures, every headline figure the card renders is
**identical**: `rankedCount 14 / candidatesConsidered 80`, `econ 25 / 270`,
unrankable census `{first-in-class:38, no-improvement:9, no-research-required:11,
cost-unmeasured:8, not-comparable:0}`, `monthlyResearchIncome 3331.46`, slots
`4/6 weighted · 4 idle`, `deficit.applied false`, `canContest false`,
`deliveryDemoted.count 65`, all four group counts.

What **does** differ:

1. **The delivery environment fact in the modal** (`:871-883`) reads
   `958 point-defence mounts · 1.30 per hull` in player against
   `1,180 point-defence mounts · 1.60 per hull` in omniscient. Same 738 hulls.
2. **Three of fourteen military rows** carry a different `context.delivery`:
   `SpinalCoilerMk3` `shotsPerArrivingRound` 2.159 → 2.427 and `floorValue`
   14.938 → 16.795; `SpinalSiegeCoilerMk2` 8.672 → 9.747; `AntimatterTorpedoLauncher`
   13.094 → 14.828 with `multipleOfFloor` 3.612 → 3.638. These reach the modal at
   `:762-764` and the `DELIVERY` facts at `:865-867`; on the card they only move
   which rows get the `fails delivery` / `delivery unchecked` badge, and on this
   save no verdict flipped.

**So: the card is mode-invariant on this save and the modal is not.** That is a
different claim from "mode-invariant", and the reason matters — the invariance is
*contingent on the observer having detection*, not structural. `deficit.applied`
is `false` here because the widest gap is `hull count` with
`remedyKind: 'production'` (`:642`); a save where the observer *is* blind would
put `capability.canContest === 'unknown'` and swap the whole deficit banner to
the second branch (`:625-633`), which is a materially different sentence. Neither
the `'unknown'` branch nor the `deficit.applied === true` branch is exercised on
`Autosave.gz`. **Both must be fixture-covered before the rewrite.**

### 3. Unavailable and empty states

`UNAVAILABLE = '—'` (`:37`). Formatters `num` (`:60-64`), `int` (`:66-70`),
`dec` (`:72-75`), `mult` (`:78-87`), `months` (`:90-95`), `compact` (`:182-190`),
`quantity` (`:200-210`) — all return the em dash on absent. The file's own
header (`:9-29`) states the three rules a rewrite must preserve.

| # | affordance | input | line |
| --- | --- | --- | --- |
| 1 | `RESEARCH RANKING UNAVAILABLE` + *"The ranking endpoint did not answer…"* | `payload === null` / `success === false` / `military` or `economic` absent | `:934-942` |
| 2 | `RESEARCH RANKING UNAVAILABLE` + *"None of the valuation inputs are present…"* — a **different** detail sentence for a different cause | all three of `sources.{propulsion,militaryValue,economicValue}.available === false` | `:948-958` |
| 3 | *"The component catalogue is missing from this snapshot, so nothing could be compared."* | military groups empty **and** `sources.militaryValue.available === false` | `:962-963` |
| 4 | *"Nothing can be ranked yet — with no hulls or habs in service there is no baseline…"* | military groups empty, catalogue present | `:964-965` |
| 5 | *"Nothing could be priced against this save's own figures yet."* | no economic unit has a populated group | `:973-975` |
| 6 | `NO MEASURED GAP` / *"Alien capability could not be compared… this is not the same as no threat."* | `deficit.capability.canContest === 'unknown'` | `:625-633` |
| 7 | `NO RESEARCH REMEDY` — two sub-sentences, production vs no-gap | `deficit.applied !== true` and `canContest !== 'unknown'`; `remedyKind === 'production'` picks the first | `:637-646` |
| 8 | em dash inside the deficit banner for `gap` / `ours` / `theirs` | `deficit.ratio` / `.own` / `.alien` `null`-or-`undefined` — note these use an **explicit `=== null \|\| === undefined`** check, not `num()` | `:606-614` |
| 9 | queue block renders **nothing** | `slots` absent or `slots.available !== true`, or `projectSlotCapacity === null` | `:475-478` |
| 10 | `0 project slots` + `Turn 1 · no active research` | `cap === 0` and no slots | `:479-486` |
| 11 | `no active projects` | `activeProjects` empty | `:501` |
| 12 | `backlogs active` badge | `free === 0` and there are active projects | `:496-498` |
| 13 | `no pips` instead of a duration | `monthsAtCurrentIncomeState === 'slot-receives-nothing'` | `:115` |
| 14 | `≤` prefix on a duration | `monthsAreUpperBound === true` | `:118` |
| 15 | `(flat, unpriced)` suffix | state `'flat-rate-unpriced'` | `:126` |
| 16 | *"No measured research income, so there is no honest number of months at any rate."* (tooltip) | state `'unmeasured-income'` | `:169-171` |
| 17 | `research income not measurable — no completion times shown` in the foot | `research.monthlyResearchIncome` `null`/`undefined` — again an explicit `=== null \|\| === undefined` | `:984-986` |
| 18 | foot shows income alone, no `"0 of 0 slots"` | `slotSummary()` returns `null` because `slotsWithPips` or `slotCount` is absent | `:664-668`, `:987-988` |
| 19 | idle count **omitted entirely** rather than under-reported | any one of the three idle counts is `null` — `!idleParts.includes(null)` | `:672-677` |
| 20 | `delivery unchecked` badge | `clearsDeliveryFloor === null` **and** `context.delivery` present | `:356-360` |
| 21 | `First of kind` instead of a multiple | `isFirstInClass` truthy | `:409-411` |
| 22 | *"Slot allocation not available on this snapshot…"* | `slots.available !== true` in `slotFacts` | `:690-696` |
| 23 | `—` in a slot fact for pips / progress / percent | `slot.pips` / `.accumulatedResearch` / `.totalCost` / `.percent` absent | `:709-713` |
| 24 | `nothing assigned` | `slot.displayName` falsy | `:714` |
| 25 | *"No planning horizon could be formed… An unmeasured duration is not a duration that fits."* | `chainPromotion.horizon.available !== true` | `:822-823` |
| 26 | *"time to complete could not be measured for this chain"* | `chain.reachability.state === 'unknown'` — kept distinct from `'beyond-horizon'` by design (`:53-58`) | `:850-851` |
| 27 | *"No point-defence battery is observable in this snapshot… not the same as an undefended target"* | `deliveryEnvironment.available !== true` | `:880-881` |
| 28 | *"Nothing ranked / No candidate in this snapshot could be scored."* | `facts.length === 0` in the modal | `:895-899` |

**Exercised on `Autosave.gz`:** #7 (production variant), #12, #14, #21-absent,
#20. **Unexercised and therefore unpinned:** #1-#6, #8, #9, #10, #13, #15, #16,
#17, #18, #19, #22, #25, #26, #27, #28. Live `monthsAtCurrentIncomeState` is only
`allocation-assumed` (13 rows) and `allocation-measured` (1), so three of the five
duration states never render. `slots.recommendation.reason` is present, so the
long hardcoded fallback at `:735-740` is dead on this save.

**The one construct a rewrite is most likely to break** is `:672-677`. The
comment says it outright: `num(x) || 0` on three idle counts would turn an
unmeasured count into a confident zero and *understate* the total. The current
code sums only if all three are measured, and otherwise omits the clause.

### 4. Measured vs estimated registers

**No `.de-measured` / `.fe-meas` markup.** The honesty split is carried by the
*duration state machine* and by explicit "our inference" prose:

- `researchDuration()` (`:112-128`) appends a register label to every number:
  `(1 pip)` and `· N all-in` for **assumed** allocation, `(its slot)` for
  **measured** allocation, `(flat, unpriced)` for the unpriced fallback,
  `no pips` for zero allocation, `≤` for an upper bound.
  `researchDurationTitle()` (`:138-173`) supplies the matching explanation and
  states the model's own accuracy — *"good to about 1.5%, not to the digit"* (`:157`).
- `<em class="ra-deficit__judgement">Our inference from a measurement, not
  shipped data.</em>` (`:620`).
- *"Our inference, not a figure the game publishes."* (`:821`) and
  *"Modelled, not a figure the game publishes"* (`:878`).
- Chain months are labelled *at FULL CONCENTRATION … therefore a lower bound*
  (`:269-272`), and a chain row is given **no category label or tooltip** at all
  (`:394-397`, `:419`) because a chain crosses categories.

**This is the register split for this component, and `<Measured>` / `<Estimated>`
as specced (a CSS class pair) will not carry it.** Mapping
`allocation-measured` → `<Measured>` and `allocation-assumed` → `<Estimated>` is
defensible and would be a genuine improvement, but it is a **five-state** axis,
not two, and `flat-rate-unpriced` / `unmeasured-income` / `slot-receives-nothing`
have no home in a two-register vocabulary. Flag before migrating.

`scripts/verify_research_tab_layout.js:170` asserts **at most 4 distinct computed
font sizes** inside `.research-advisor` and `:208` asserts no leaf overflows —
so any new register markup that introduces a fifth size fails the build.

### 5. Truncation

Four caps. **Two announce themselves; two do not.**

| cap | value | announced? | line |
| --- | --- | --- | --- |
| Availability groups shown per track | `GROUPS_SHOWN = 2` | **NO.** Live: 4 military groups (`researchable-now` 5, `researching` 2, `prereq-clear-but-unrolled` 6, `prereq-blocked` 1). Two groups holding **7 ranked rows** are dropped with nothing on screen saying so. | `:43`, `:460` |
| Rows shown per group | `ROWS_PER_GROUP = 2` | **Partially.** `<small>{group.count} ranked</small>` (`:464`) gives the group total beside 2 rendered rows, so the reader can infer it. There is no explicit omitted count. | `:44`, `:466` |
| Economic units shown | 1 (`leadUnit`) | **YES.** `+{n} more units` suffix on the census with a tooltip naming them (`:1019-1020`). Live: `tonnes/month` shown, `+4 more units`. | `:970`, `:977`, `:1019` |
| Delivery-demoted lead | 1 item of `count` | **YES.** `{count} ranked below their damage: {name} — {detail}` (`:565-574`). Live `count = 65`, one named. | `:560-575` |

Count fields that must survive a rewrite:

- `military.groups[].count` (`:464`) — the **full** group size, computed before
  the server-side slice (`shared/researchRanking.mjs:708`). Not `itemsShown`.
- `military.rankedCount` / `military.candidatesConsidered` (`:1005`) →
  `"14 of 80 ranked"`.
- `economic.rankedCount` / `economic.candidatesConsidered` (`:1018`) →
  `"25 of 270 ranked"`.
- `military.unrankable.counts[*]` — five keys, rendered in the fixed order of
  `UNRANKABLE_LABELS` (`:518-527`, iterated at `:580`). **Order is load-bearing**;
  `first-in-class` was split out of `not-comparable` precisely so the census and
  the capabilities block agree (`:521-524`).
- `military.deliveryDemoted.count` (`:562`) — note `itemsTotalCount` and
  `itemsOmittedCount` also exist on the payload (live 65 / 59) and are **not read**.
- `military.chainPromotion.declinedOmittedCount` (`:834-841`) — modal only,
  renders *"N further chains were refused and are not listed here."* Live `0`.

**The `GROUPS_SHOWN = 2` silent drop is the one real truncation defect here.**
Everything else in the file is scrupulous about it; this one is not, and it hides
seven rows on the live save.

### 6. Primitive

- **`<Panel>`** — the card sits inside `.tech-card` supplied by
  `public/v2/index.html`, not by the component; the component owns
  `.research-advisor` and `.ra-track` sections (`:998`, `:1009`).
- **`<Value>`** — the highest-count consumer in the codebase. `int`/`dec`/`mult`/
  `months`/`compact`/`quantity` at roughly forty call sites. `quantity()`
  (`:200-210`) is the shape `<Value>` must support: **the unit string comes from
  the payload and an unrecognised unit still renders** (`${sign}${compact} ${label}`
  at `:209`) rather than being dropped or relabelled. A `<Value unit>` prop with a
  fixed enum would break that.
- **`<TruncationNote>`** — `className="ra-census"` at `:567`, `:574`, `:585`,
  `:926`. Takes `(ranked, considered)` pairs, not `(total, omitted)` — the note
  reads *"14 of 80 ranked · 38 first of kind · 9 no gain · …"*, a census with a
  variable tail. `<TruncationNote>` as specced takes one total/omitted pair;
  this needs a list.
- **Not `<DataTable>`** — `<ul class="ra-group__list">` / `<li class="ra-row">`
  throughout (`:414`, `:466`).
- **`<Measured>` / `<Estimated>`** — see §4; five states, not two.

**Flag — needed and not in the set:**

1. **The `ra-tag` badge primitive** (shared with `fleet-procurement`) — six
   modifiers, each with a rule attached: `--free` (`:346`, `:427`), `--deficit`
   (`:349`), `--warn` (`:353`, `:355`), `--unitless` (`:362`), `--chain` (`:383`),
   `--newcap` (`:387`), bare (`:359`, `:365`, `:375`, `:497`).
2. **A tooltip primitive with a text/DOM boundary.** Rule 2 (`:18-24`) is the
   single most fragile invariant in this file: upstream `reason` prose contains
   the literal word "null" as a technical term and must reach `title=` but never
   `textContent`. It is currently enforced by discipline plus `attr()`
   (`:231-233`). In React this needs to be a typed prop that cannot be
   accidentally rendered as a child.
3. **The detail-panel handoff** (see fleet-procurement §6 flag 3) —
   `openFullRanking` builds 100+ `{label, value}` facts (`:749-916`) and hands
   them to `MissionControlDetailPanel.open()`. `slotFacts` (`:688`) is separately
   exported and unit-tested; it must stay a pure function returning that array.
4. **The census-with-tail shape**, per `<TruncationNote>` above.

---

## world-map

`public/v2/js/components/world-map.js` · 511 lines · class **R (hybrid — it
self-fetches its geometry)** · global `WorldTheaterMap` (`:510`).

### 1. Payload

Call site `public/v2/js/mission-control.js:1511-1521`:

```js
window.WorldTheaterMap.render(mapContainer, state.briefing.theaters, {
  observerName: state.briefing.observerName,
  onSelect: (theater) => showTheaterDetail(theater)
});
```

Mount: `document.querySelector('.init-map-container')` — a **class selector, not
an id** (`mission-control.js:1515`), declared at `public/v2/index.html:244` with a
`.world-map-fallback` child reading `REAL WORLD MAP INITIALIZING…` (`:245`) which
`clearContainer` (`world-map.js:283-285`, called at `:324`) removes on the first
successful render. If `state.briefing.theaters` is falsy the whole function
returns early (`mission-control.js:1513`) and the fallback string is what the
user sees — that is the component's real absent-data affordance, and it lives in
the **controller**, not the component.

`render(container, theaters, options)` (`:308`).

**`theaters` accepts three shapes** (`:313`): an array; an object with `.items`;
anything else → `[]`. Sliced to `THEATERS.length === 6` at `:314`.

**Fields read from each record** — all through `readFirst()` (`:147-154`), which
takes the first key that is not `undefined`/`null`/`''`:

| purpose | keys tried, in order | line |
| --- | --- | --- |
| id | `id`, `ID`, `key`, `slug` | `:171`, `:176` |
| name | `name`, `displayName`, `label`, `title` | `:167`, `:177` |
| hostile count | `hostileCount`, `hostile`, `hostiles`, `hostileNations` | `:392`, `:499` |
| own count | `ownCount`, `own`, `ownedCount`, `securedCount`, `friendlyCount` | `:393`, `:500` |
| status | `statusTone`, `status`, `currentStatus`, `state` | `:394` |

That is the **entire** record contract. The live briefing row
(`server/earthTheater.js:82-101`) carries twelve fields; world-map reads five of
them. **Unread:** `gdpTrillion`, `statusColor`, `nationsCount`,
`xenoformingActive`, `xenoCount`, `targetFactionName`, `keyNations` — those are
consumed by `mission-control.js:1523-1540` (the sector list) and
`showTheaterDetail` (`:1550-1560`), not by the map.

**`options` surface actually read** (`:320-322`, `:329`, `:338`, `:345`, `:506`):
`selectedId`, `selectedTheater`, `onSelect`, `ariaLabel`, `title`, `geoJsonUrl`.
**`observerName` — passed by the only call site and never read.** Grep confirms
zero occurrences in the component. A rewrite that types the props will surface
this; it is dead and can go.

**Second data source, self-fetched:** `/v2/data/world.geojson` (`:506`, default
at `:273`), 252 KB, `FeatureCollection` with **177 features**, all named. Cached
module-globally in `geographyCache` keyed by URL (`:9`, `:274-280`) — the promise
is cached, so N instances issue one request. Only `features[].properties.name`
and `features[].geometry` (`Polygon` / `MultiPolygon`, `:261-270`) are read.

### 2. Player-mode difference

**Mode-invariant, and structurally so — not merely on this save.**

Empirically: all six theater records are identical field-for-field between
`/api/v2/briefing?mode=player` and `?mode=omniscient` on `Autosave.gz`
(`nam` own 1 · `eap`/`sam`/`afr` hostile 1 · `eur`/`mea` stable), even though the
two briefing responses differ hugely in size (3.9 MB vs 7.8 MB).

The structural argument, which is what matters:

- `hostileCount` and `ownCount` are computed from `nation.executiveFactionId`
  (`server/earthTheater.js:59-64`). The intelligence filter maps nations at
  `server/intelligenceFilter.js:59-69` and strips **only** `defended` and
  `defendExpiration` from non-observer *control points*. `executiveFactionId`
  is never touched. National executive control is public in every mode.
- `statusTone` (`server/earthTheater.js:66-77`) is a function of those two counts
  plus `targetFactionName` and `observerName`. `targetFactionName` comes from
  `getPriorityTargetFaction` (`server/intelligenceFilter.js:661-666`), whose
  signature takes **no mode argument**.
- The only mode-gated fields on the theater row are `xenoformingActive` and
  `xenoCount` (`server/earthTheater.js:91-92`, `xenoformingAvailable === false ?
  null : …`) — and **world-map reads neither**.

So the map is mode-invariant *because it reads the public half of the row*. If a
rewrite ever adds a xenoforming overlay it inherits a real mode difference, and
the `null`-vs-`false` distinction those two fields already encode.

### 3. Unavailable and empty states

| # | affordance | input | line |
| --- | --- | --- | --- |
| 1 | `REAL WORLD MAP INITIALIZING…` persists | `state.briefing.theaters` falsy — controller returns before calling render | `mission-control.js:1513`; `index.html:245` |
| 2 | `LOADING BUNDLED WORLD GEOMETRY` centred, `data-map-state="loading"` | always, until the GeoJSON promise settles | `:327`, `:351` |
| 3 | `WORLD GEOMETRY UNAVAILABLE` + the error's own `message`, `data-map-state="error"` | GeoJSON fetch rejects or `!response.ok` (`:276`) | `:375-380` |
| 4 | `NO DATA` as the theater status line | no record paired to that theater slot (`hasRecord === false`) | `:208`, `:426` |
| 5 | status colour `neutral` (`--line-strong`, grey) | same | `:219`, `:231` |
| 6 | `tabindex="-1"`, `cursor: default`, click is a no-op | no record — `selectView` returns early | `:412-413`, `:476` |
| 7 | `H — / OWN —` on the theater's count line | `readCount` returns `null` (key absent, or value non-finite) | `:162-164`, `:429` |
| 8 | `Hostile count —; own count —` in the `aria-label` and the SVG `<title>` | same | `:411`, `:415` |
| 9 | `.world-map-country--unassigned`, `aria-hidden="true"`, dark, unclickable | a GeoJSON feature whose name is in no `COUNTRY_THEATERS` set | `:449-450`, `:93-96` in CSS |
| 10 | country dropped entirely | `geometryPath()` returns `''` — geometry absent or a type other than Polygon/MultiPolygon | `:261-270`, `:446` |
| 11 | theater `shortLabel` substituted for the record name | `name.length > 19` | `:423` |
| 12 | `statusValue` truncated at the first `(` | e.g. `CONTESTED (1 Hostile the Servants Executives)` → `CONTESTED` | `:210` |

**`readCount` (`:156-160`) is correct** — `Number(undefined)` is `NaN`, not
finite, so absent stays `null`, and `countLabel` (`:162-164`) renders `'—'`. This
is the discipline the repo asks for, and it is honoured at the per-theater level.

**Two places break it, and a rewrite will inherit both:**

1. **`:395` and `:399` coerce with `|| 0`:**
   `statusLabel(statusValue, hostileCount || 0, ownCount || 0, !!record)` and the
   same for `statusKey`. An **unmeasured** hostile count becomes a measured zero,
   and `statusLabel` (`:213-215`) then returns `SECURED` or `STABLE` — a positive
   claim built on an absent reading. Today it is masked because `statusValue` is
   always present and the function returns at `:212` before reaching the counts;
   remove or null that field and the coercion becomes visible.
2. **`:496-502` — the summary line has no unavailable state at all.**
   `totalHostile += … (readCount(...) || 0)` sums nulls as zeros and renders
   `CURRENT / HOSTILE {n} · OWN {n}` as a bare interpolated number. There is no
   `—`, no "partial", no count of theaters that could not be read. This is the
   `Number(null) === 0` defect in its canonical form and it is the one place in
   this file that would print a confident wrong total.

**Also dead / mismatched, worth knowing before a faithful rewrite:**

- `:344` creates a `<rect class="world-map-ocean">`, sets its attributes, and
  **never appends it**. The CSS rule `14-world-map.css:27-31` therefore never
  matches; the ocean colour comes from `root.style.cssText` at `:330`.
- `.world-map-instance` (`14-world-map.css:15-19`) and `.world-map-region-shape`
  (`:79-83`) match nothing — the component sets `class="world-map"` plus a
  `data-world-map-instance` attribute (`:325-326`) and never emits a region shape.
- `.world-map-country-label` (`14-world-map.css:107-115`) — the one rule keyed to
  `--fs-map-note` besides `.world-map-data-note` — matches nothing either.
- **`Togo` is missing from the `afr` country set** (`:100-110`). 175 of 177
  GeoJSON features resolve to a theater; the two that do not are `Antarctica`
  (intentional) and `Togo` (a gap). Togo renders as unassigned, dark and
  unclickable, mid-West-Africa.

### 4. Measured vs estimated registers

**None, and none needed.** Every number the map shows is a direct count from the
save. There is no modelled or inferred figure on this surface.

The nearest thing to a register is the honesty note
`COUNTRY GEOMETRY: BUNDLED GEOJSON` (`:503`) and the heading meta
`ACTUAL COUNTRY GEOMETRY / SELECT THEATER` (`:346`), which say the *geometry* is
bundled while the metrics are save-derived — the same distinction the file header
makes at `:45-47` (*"country membership only tints/selects a theater and never
replaces save-derived metrics"*).

**The two-step type ladder** (`:26-43`) is the honesty-adjacent construct that
must survive verbatim:

```js
var TYPE = { name: 10.5, note: 8 };            // :40-43
```

These are **SVG user units, not page pixels** — the `<svg>` is
`viewBox="0 0 720 360"` at `width: 100%` (`:333-334`), so 8 units renders near
7 px in a 640 px card and near 10 px in a 900 px one. The comment (`:26-31`)
exists to stop exactly the mapping a React rewrite is tempted to make.

The named CSS tokens are **matched, not shared**: `--fs-map-name: 10.5px` and
`--fs-map-note: 8px` at `public/v2/css/01-tokens-and-base.css:101-102`. The
component names `--fs-map-note` in prose at `world-map.js:38`. Only three
elements take their size from the token rather than the inline attribute:
`.world-map-data-note` (`14-world-map.css:120`, emitted at `world-map.js:503`),
and `.world-map-loading` / `.world-map-error`, which use `--fs-tag`
(`14-world-map.css:102`) — **not** `--fs-map-note`. Everything else carries
`'font-size': TYPE.name|TYPE.note` inline (`:345`, `:346`, `:369`, `:422`,
`:425`, `:428`, `:502`).

Two small source defects in that comment block: line `:38` duplicates the phrase
from `:37` (*"Two steps, matched by --fs-map-name and"* appears twice), and the
prose says the sizes are *"matched by --fs-map-name and --fs-map-note"* while one
of the two CSS-driven elements actually uses `--fs-tag`.

### 5. Truncation

| cap | announced? | line |
| --- | --- | --- |
| `records = source.slice(0, 6)` | **NO.** A seventh theater is discarded with no count, no note, no console warning. | `:314` |
| Per-theater country lists | not a cap — every feature is drawn, assigned or not (`:443-456`) | — |

There are **no `*TotalCount` / `*OmittedCount` fields** in this payload and none
in the briefing theater row. The 6-record cap is a hardcoded constant matched to
the six geometry slots (`:48-55`). Since `server/earthTheater.js:22-29` defines
exactly six theaters, it cannot fire today — but it is an unannounced truncation
and a rewrite should carry it forward with a count, not silently.

**The other silent-loss hazard is not a cap but an ordering bug.**
`pairTheaters` (`:184-205`) matches by alias with a **substring** test
(`name.indexOf(normalizedAlias) !== -1`, `:180`), and `eur`'s alias list includes
the bare string `'eur'` (`:51`). `normalize('Eurasia & Middle East')` is
`'eurasia and middle east'`, whose `indexOf('eur')` is `0` — so the EUR theater
*matches the MEA record*. Verified by replaying the real matcher against the live
briefing rows:

```
live order  (nam,eur,eap,sam,mea,afr): eur<-eur  mea<-mea      ✓
reversed order:                        eur<-mea  mea<-eur      ✗ labels swap
```

It is correct today **only because the briefing happens to emit `eur` before
`mea`**. A reorder of `EARTH_THEATERS` — or any consumer that sorts theaters —
draws "EUROPE / MED" over Eurasia. Then the second pass (`:195-203`) assigns any
still-unpaired theater the *next unused record whatever it is*, so a single
rename cascades into arbitrary mislabelling with no error.

### 6. Primitive

**None of the five apply cleanly, and this is the loud flag.**

The component builds **SVG** through `document.createElementNS`
(`:125-129`) — 40+ imperative node creations, `setAttribute` calls, six
`addEventListener` bindings per region (`:484-494`), and mutable per-view state
objects (`view.selected`, `.hovered`, `.focused`, `:462-473`) reapplied by
`applyViewState`. `<Panel>`, `<DataTable>`, `<Value>`, `<Measured>` and
`<TruncationNote>` all emit HTML elements; **an HTML `<span>` inside an `<svg>`
does not render** without a `<foreignObject>` wrapper. None of the five can be
placed on this surface as-is.

What it actually needs:

1. **An SVG-native value renderer.** `countLabel()` (`:162-164`) is `<Value>`'s
   job — absent → `'—'`, never `0` — but it has to emit into an SVG `<text>`
   node. Either `<Value>` gains an `as="tspan"` / render-prop escape hatch, or
   this component keeps a private copy and the repo has two implementations of
   its most defect-prone rule. **Say which before migrating; do not let it be
   decided by whoever writes the JSX.**
2. **A place for `geographyCache`** (`:9`). A module-level promise cache shared
   across every instance is not React state. It wants the data layer the class-F
   decision is meant to settle — which puts world-map inside a decision the doc
   scopes to class F only.
3. **A place for `instanceCount`** (`:8`, `:317`). It generates the
   `aria-labelledby` id pair (`:318-319`, `:333`, `:337`, `:341`). In React this
   is `useId()`, and the existing ids will change format — anything asserting on
   `world-map-1-title` breaks.
4. **A keyboard/ARIA contract.** `role="button"` + `tabindex` + `aria-pressed`
   per region (`:412`), Enter/Space handling (`:486-488`), and a duplicated
   `<title>` carrying the same string as the `aria-label` (`:414-416`). This is
   the only component of the three with real a11y semantics and there is no
   primitive for it.

Of the five, **`<Value>` is the only one with a genuine claim**, and only if it
can render into SVG. `<TruncationNote>` would apply to the 6-record cap if that
cap were ever announced.

---

## The shared `/api/intel/research-ranking` fetch

**Yes — one fetch can serve both, and the two components read disjoint field
sets.** Grep confirms it in both directions:

- `research-advisor.js` contains **zero** occurrences of `procurement`.
- `fleet-procurement.js` contains **zero** occurrences of `groups`, `deficit`
  (as a payload path — only the per-item `closesDeficit` and the `ra-tag--deficit`
  class), `slots`, `economic`, `unrankable`, `capabilities`, `chainPromotion`,
  `driveChains`, `deliveryDemoted` or `research`.

fleet-procurement reads `military.procurement.{count,label,items[]}` and nothing
else from this endpoint. research-advisor reads everything *except*
`military.procurement`.

**But the two requests are not the same request today**, and that is the part a
naive dedupe would get wrong:

| | research-advisor `:1040` | fleet-procurement `:590` |
| --- | --- | --- |
| query | `limit=6` (no `detail`) | `detail=full` (no `limit`) |
| server `groupLimit` | 6 | **5** (`DEFAULT_GROUP_LIMIT`, `shared/intel/researchRanking.mjs:77`) |
| server `wantsFull` | false | true |
| response size (live) | 345 KB | 906 KB |

Measured consequences of picking the wrong one:

| field | `limit=6` | `detail=full` | `detail=full&limit=6` |
| --- | --- | --- | --- |
| `procurement.items` | capped at `groupLimit` | **uncapped** | uncapped |
| `deliveryDemoted.items` / `itemsOmittedCount` | 6 / **59** | 5 / **60** | 6 / 59 |
| `capabilities.items` | 6 | 38 | 38 |
| `driveChains.items` | 6 | 7 | 7 |
| `military.groups[].items` | 5/2/6/1 | 5/2/6/1 | 5/2/6/1 |

`deliveryDemoted.items` is sliced by `groupLimit` **regardless of `detail`**
(`shared/intel/researchRanking.mjs:1302`), which is why `detail=full` alone
*loses* a row relative to today's advisor request.

**Recommended shared request: `detail=full&limit=6`.** Verified live
(`both-player.json`, 908 KB): it is a strict superset of both current responses on
every field either component reads. Two behaviour changes to accept deliberately:

1. `openFullRanking` would list **38** capability facts and **7** drive-chain
   facts instead of 6 and 6 — a longer modal, not a wrong one.
2. Network goes from 345 + 906 = 1,251 KB to 908 KB, a 27% saving, but the
   *advisor* now waits on a 908 KB parse instead of 345 KB.

**The trap to avoid:** if the shared fetch adopts the advisor's `limit=6`
without `detail=full`, `procurement.items` is capped at 6 while
`procurement.count` stays true — fleet-procurement then renders its
`N shown · M omitted` note (`:506-509`). That degrades *honestly* rather than
silently, which is to this file's credit, but it is a visible regression the
moment a save has more than six unfielded items. Live it has exactly 5, so the
bug would not appear in testing on `Autosave.gz`.

`/api/intel/refit-advisor` is fleet-procurement's alone and is not part of this
decision.
# Component data contracts — Group 4

`intelligence-library.js` · `faction-intel.js` · `directive-board.js`

Written 2026-08-24 against the **working tree** at `6368c88` (+30 uncommitted paths).
Read from source only. No component modified.

---

## Corrections to `docs/react-component-contracts.md` before anything else

Four claims in that doc do not hold against this tree.

1. **`faction-intel` is class R, not class F.** The doc lists it under "Class F — self-fetching"
   (`docs/react-component-contracts.md:52`), where class F is defined as "Own an endpoint call
   and its loading/error states" (line 41–42). `public/v2/js/components/faction-intel.js` contains
   **no `fetch(`, no `XMLHttpRequest`, no network call of any kind**. It is fed by the controller
   at `public/v2/js/mission-control.js:759`, `:1066` and `:1076`, from `state.rawSnapshot` /
   `state.briefing` — the same two objects every class R component gets. All three components in
   this group are class R.

2. **The `render(root, payload)` props contract only holds for one of the three.**
   `docs/react-component-contracts.md:20-23` presents `render(root, payload)` /
   `render(container, snapshot)` as the class R shape. Actual signatures:
   - `directive-board.js:632` — `render(root, payload)` ✔ matches
   - `faction-intel.js:26` — `render(container, snapshot, briefing, observerId)` — **4 positional args**
   - `intelligence-library.js:564` — `render(container, snapshot, briefing, observerId, options)` — **5 positional args**

   `<Component {...payload} />` is therefore not a drop-in for two of the three.

3. **`faction-intel` returns an imperative controller; the doc does not mention it.**
   `faction-intel.js:115-135` returns `{ select, getSelectedFaction, getSelectedId, destroy }`,
   and `mission-control.js:41` holds it in module-level `factionController`, calling
   `factionController?.select?.(factionId)` at `:761` and `:1077`. A React rewrite must expose
   this via `useImperativeHandle` or convert both call sites to a controlled `selectedFactionId`
   prop. It is a live API, not an internal.

4. **"none by name" is stale for both overlays.** The doc's risk section
   (`docs/react-component-contracts.md:85-97`) names `intelligence-library` and `faction-intel`
   among six components with no unit test. As of this tree both exist as **untracked** files:
   `tests/factionIntelRendering.test.js` (276 lines, 8 tests) and
   `tests/intelligenceLibraryRendering.test.js` (376 lines, 11 tests), plus
   `tests/mc-budget.test.js` and `tests/world-map.test.js`. `git log` returns nothing for any of
   them; `git status` shows `??`. The characterisation coverage the doc asks for has been written
   but not committed. **Commit it before migrating**, or the migration proceeds against coverage
   that could vanish with a `git clean`.

Also worth stating: `state.rawSnapshot` (`mission-control.js:1185`) is **not** the raw snapshot.
`/api/v2/briefing` returns `{ briefing, data: filtered }` (`server/http/routes/snapshot.js:92-98`)
and `data` is the *mode-filtered* snapshot. Every "raw" read in these three components is a read
of filtered data.

---

## intelligence-library

`public/v2/js/components/intelligence-library.js` (582 lines) · global `IntelligenceLibrary`
· mount `#intelligenceLibraryRoot` (`public/v2/index.html:607`) · CSS `public/v2/css/10-intel-library.css` (684 lines)

### 1. Payload

Class R. Called from two places, identically:

- `mission-control.js:800` (in `renderLibrary`)
- `mission-control.js:1084` (post-refresh re-render while the overlay is open)

```js
window.IntelligenceLibrary.render(
  libraryRoot,          // HTMLElement
  state.rawSnapshot,    // the MODE-FILTERED snapshot (see note above)
  state.briefing,       // /api/v2/briefing .briefing
  state.observer,       // 4712 (number)
  state.libraryView     // MUTABLE view state + callbacks
);
```

`state.libraryView` is defined at `mission-control.js:27-33` and augmented at `:793-799`:

```js
{ section, spaceTab, spaceTheater, councilorFaction, councilorSearch,
  onOpenFaction(factionId), onCopyExport(kind, statusEl) }
```

**Snapshot fields actually consumed** (file:line = first read):

| field | line |
| --- | --- |
| `mode` | 94–96 (`visibility()`), 462 |
| `observerFactionId` | 415 |
| `observerFactionName` | 142, 474 |
| `metadata.gameTimeString`, `.activeSaveFileName`, `.fileName`, `.lastModified` | 151–153, 570 |
| `factions[]` — `ID`, `displayName`, `color`, `templateName`, `powerScore(.overall)`, `controlPointsCount`, `totalGdp`, `habsCount`, `shipsCount`, `spaceVisibility` | 19–21, 173–188 |
| `factionRelationships[]` — `sourceFactionId`, `targetFactionId`, `hate` | 104–113 |
| `councilors[]` — `isActiveCouncilor`, `isIndependent`, `factionId`, `status`, `maskedAttributes`, `displayName`, `factionName`, `typeTemplateName`, `locationName`, `activeMissionName`, `activeMissionTarget`, `totalSkills`, `isAlien`, `isTurnedMole`, `visibility`, `orgs[].displayName`, `traits[]` | 48–52, 56–59, 196–200, 213–230, 451–458 |
| `nations[]` — `displayName`, `executiveFactionName`, `executiveFactionId`, `controlPoints[]`, `GDP`, `milTech`, `armies`, `nukes`, `unrest`, `cohesion`, `boost`, `missionControl` | 244–259 |
| `servantTargets[]` — `nationName`, `targetFactionName`, `score`, `reasons[]` | 261–262 |
| `habSites[]` — `displayName`, `parentBodyName`, `spaceTheaterKey`, `factionName`, `water`, `volatiles`, `metals`, `nobleMetals`, `fissiles`, `mineTier`, `pendingHab`, `constructionStatus`, `mineModuleName`, `daysRemaining`, `habName` | 274–290 |
| `habs[]` — `displayName`, `factionName`, `habType`, `tier`, `orbitBody`, `spaceTheaterKey`, `inEarthLEO`, `underAssault`, `underBombardment`, `inCombat`, `templateName` | 298–310 |
| `fleets[]` — `displayName`, `factionName`, `shipsCount`, `combatPower`, `combatPowerAvailable`, `weaponSummary`, `dominantWeaponType`, `orbitBody`, `spaceTheaterKey`, `mission`, `destination`, `arrivalDate`, `ships[]` | 318–331, 343 |
| `fleets[].ships[]` — `displayName`, `hullName`, `dominantWeaponType`, `weaponLoadout[].role/.count`, `combatPower` | 344–354 |
| `globalResearch.activeSlots[]` (`slotNumber`,`displayName`,`category`,`accumulatedResearch`,`totalCost`,`percent`,`leadFactionName`,`leadContribution`), `.finishedTechsNames[]` | 400–411 |
| `techMatrix[]` — `displayName`, `projectId`, `category`, `effects[]`, `factions[observerId].status` | 414–422 |
| `capabilities.details{}` — `name`, `active`, `requiredDisplayName`/`requiredProject`/`requiredTech`, `requiredEffect`, `description` | 431–441 |
| `activeXenoforming[]` — `regionName`, `level`, `regionId` | 444–445 |
| `builtAlienFacilities[]` — `displayName`/`name`, `regionName`/`locationName`, `factionName`, `type`/`templateName` | 447–448 |

**Briefing fields consumed** — only two:
- `briefing.directives.{geopolitical,council,space,research}` → lengths only (line 131–134)
- `briefing.strategic.spaceTheaters[]` — `key`, `name`, `ownShips`, `ownFleets`, `alienShips`,
  `alienFleets`, `ownHabs`/`habs`, `ownMiningSites`/`miningSites`, `status`, `weaponMix[].role/.count`
  (lines 363–378)

Also reads `global.MissionControlShared.{escapeHtml,numberValue,number,money,matchesSpaceTheater,factionLogoImgHtml}`
(line 8–10) and `global.MissionControlViews.syncScrollHints` (line 560–561, defined
`mission-control.js:273`).

**State ownership is inverted vs React.** `renderSection` (line 477–562) *mutates the caller's
options object* (`options.section = …` line 479–480, 509–511, 519–520, 527, 533) and then
re-invokes itself, rewriting `[data-library-content]`'s `innerHTML` in place (line 497) without
returning to the controller. All handlers are `.onclick =` / `.oninput =` assignments (504–554),
not `addEventListener`, so re-render silently replaces them. The search input restores its own
caret (line 535–539) because the whole subtree is destroyed on each keystroke. **This is the
single hardest part of the migration** and the doc's "rendering change and nothing else" (line 26)
does not describe it.

### 2. Player-mode difference — YES, and one column changes answer entirely

**a) "Hate of us" is UNAVAILABLE for every faction in player mode — always.**
`filterFactionRelationships` (`server/intelligenceFilter.js:685-687`) keeps a relationship only
when `mode === 'omniscient' || mode === 'enhanced' || sourceFactionId === observerFactionId`.
`relationFor` (line 104–107) looks up `sourceFactionId === factionId && targetFactionId === observerId`
— the *inbound* direction, which player mode has already dropped. So `hateOfUs` resolves to
`'UNAVAILABLE'` on line 111 for all rows, while `ourHate` (line 107–108) resolves normally.
In omniscient both resolve. Same code, two different answers. `tests/intelligenceLibraryRendering.test.js`
does not currently pin this.

**b) Councilor rows lose three fields for observed enemies.** `sanitizeObservedCouncilor`
(`server/intelligenceFilter.js:698-716`) destructures away `attributes`, `resolvedAttributes`,
`orgs`, `traits` and `totalSkills` for any councilor that is not own/turned/enhanced. Consequence
in this component:
  - line 226 `number(councilor.totalSkills, 0)` → `numberValue(undefined) === null` → **`'—'`**, not `0`. Correct.
  - line 227 `topSkill(...)` → all `maskedAttributes[k].visible === null` → **`'UNAVAILABLE'`**.
  - line 228 `councilorProfile(...)` → `orgs`/`traits` gone → empty profile → `visibility === 'detected'` → **`'UNAVAILABLE'`** (line 200).

**c) `maskedAttributes` is present in BOTH modes — this component is safe from the council-axis bug.**
`visibleAttribute` (line 56–59) reads *only* `councilor.maskedAttributes`, never `attributes`.
Omniscient synthesises `maskedAttributes` at `server/intelligenceFilter.js:165-167` with
`visibility: 'raw_save_only'`, which is neither `'unknown'` nor `'unavailable'`, so it passes the
line-58 gate. **A rewrite must not "simplify" this to `attributes ?? maskedAttributes`** — that
would be the mirror of the shipped bug.

**d) The alien-councilor empty message is explicitly mode-branched.** Line 462:
```js
snapshot.mode === 'omniscient'
  ? 'No active alien councilors are present in the current save.'
  : 'Alien councilor records are unavailable at the current detection level.'
```
This is the one place the component distinguishes "measured empty" from "not permitted to see".
It must survive verbatim.

**e) Not mode-branched but should be:** xenoforming (`filterXenoforming` returns `[]` when
`!capabilities.canDetectXenoforming`, `server/intelligenceFilter.js:1027-1029`) and alien
facilities both render the *same* empty text in both modes (lines 463–464), and their
count chips read `countLabel(0, 'visible site')` → **"0 visible sites"**. A redacted list is
being counted as zero. Only the word "visible" hedges it.

**f) Ship/fleet/hab/mining tables are *lists* filtered by mode, not different answers per row** —
`filterSpaceAssets` removes rows; surviving rows carry identical fields. The `spaceVisibility`
chip (line 187) is the mode signal: `'LIMITED'`/muted when `spaceVisibility === 'unavailable'`,
`'AVAILABLE'`/good otherwise.

**g) `techMatrix` observer status is mode-invariant.** `filteredTechMatrix`
(`server/intelligenceFilter.js:530-546`) only downgrades *non-observer* statuses, and line 415
reads `project.factions[String(snapshot.observerFactionId)].status`. Same answer in both modes.

### 3. Unavailable and empty states — full enumeration

`display(v, fallback)` (line 12–15) returns `fallback || '—'` for `null | undefined | ''`.
`number(v, d)` (`shared.js:45-51`) returns `'—'` for absent. `money(v)` (`shared.js:68`) returns `'—'`.
`numberValue` returns `null` for absent. **No `?? 0` / `|| 0` appears anywhere in this file.**

| # | render | trigger | line |
| --: | --- | --- | --: |
| 1 | `'—'` | any `display()` on `null`/`undefined`/`''` — ~40 call sites | 12–15 |
| 2 | `'—'` | `factionNameById` with `null`/`undefined`/`''` id | 26 |
| 3 | `'Unknown faction'` | id present but not in `snapshot.factions` | 28 |
| 4 | `'var(--accent)'` swatch | faction has no `color` | 33 |
| 5 | `'—'` | `visibleAttribute`: no `maskedAttributes[key]`, or `visibility` is `'unknown'`/`'unavailable'`, or `visible` is null | 58–59 |
| 6 | `'UNAVAILABLE'` | `topSkill`: every one of the 8 attributes unreadable | 69 |
| 7 | `'UNAVAILABLE'` | `countLabel`: `numberValue(value) === null` | 88 |
| 8 | `'PLAYER INTEL / FILTERED'` | `mode` neither `omniscient` nor `enhanced` (**incl. `mode` absent entirely**) | 96 |
| 9 | `'UNAVAILABLE'` ×2 | `relationFor`: no matching relationship record in either direction | 111–112 |
| 10 | table empty div + per-table message | `rows.length === 0` | 73–75 |
| 11 | `'No faction records are available.'` | empty `factions` | 192 |
| 12 | `'UNAVAILABLE'` | faction `spaceVisibility === 'unavailable'` → Ships column | 174 |
| 13 | `'UNAVAILABLE'` | `powerScore.overall` (or scalar `powerScore`) null/undefined | 181 |
| 14 | `'LIMITED'` chip (muted) | `spaceVisibility === 'unavailable'` | 187 |
| 15 | `'No attached profile'` | no orgs/traits **and** `visibility` is `raw_save_only`/`confirmed` | 200 |
| 16 | `'UNAVAILABLE'` | no orgs/traits and any other visibility (`detected`, absent) | 200 |
| 17 | two different empty messages | councilors: filtered-to-empty vs genuinely empty | 240 |
| 18 | `'None'` | nation has no `executiveFactionName` | 245 |
| 19 | `'0'` (literal string) | `nation.nukes` falsy — **including `null`/`undefined`** | 254 |
| 20 | `'not installed'` | hab site with no `pendingHab`, no `mineModuleName`, no `constructionStatus` | 277 |
| 21 | `'—'` | non-LEO hab (`inEarthLEO` falsy) | 308 |
| 22 | `'OPERATIONAL'` | hab not under assault/bombardment/combat | 301 |
| 23 | `'UNAVAILABLE'` | fleet `combatPowerAvailable` falsy | 321 |
| 24 | `'UNAVAILABLE'` | ship: empty `weaponLoadout` **and** no `dominantWeaponType` | 346 |
| 25 | `'UNAVAILABLE'` | `ship.combatPower === null \|\| undefined` | 354 |
| 26 | `''` (section vanishes) | no `briefing.strategic.spaceTheaters`, or theater filter empties it | 368 |
| 27 | `'—'` | theater with empty `weaponMix` | 370 |
| 28 | **`'0 / 0'` literal** | `theater.alienShips` falsy — **null and 0 collapse to the same cell** | 374 |
| 29 | `'UNAVAILABLE'` | techMatrix row missing observer entry | 415 |
| 30 | `'No completed technologies are available.'` | empty `finishedTechsNames` | 427 |
| 31 | `'LOCKED / UNAVAILABLE'` chip | `capabilities.details[k].active` falsy | 438 |
| 32 | mode-branched alien-councilor message | see 2(d) | 462 |
| 33 | `'No xenoforming sites are visible…'` | empty (or redacted-to-empty) `activeXenoforming` | 463 |
| 34 | `'No alien facilities are visible…'` | empty (or redacted-to-empty) `builtAlienFacilities` | 464 |
| 35 | `'Ready to generate a current handoff.'` | export status before any click | 472 |

**The two that would break in a naive rewrite:**
- **#28, line 374** — `theater.alienShips ? statusChip(…) : '0 / 0'`. Renders a hard-coded
  measured-looking zero for an absent value. In player mode `alienShips` counts only *visible*
  alien fleets (`server/strategicIntelligence.js:111-113`, computed against the filtered snapshot),
  so "0 / 0" means "none seen", not "none there". Existing defect; do not carry it forward.
- **#19, line 254** — `nation.nukes ? … : '0'`. Same shape, smaller blast radius.

Everything else in this file is disciplined. `display`/`number`/`money` never coerce.

### 4. Measured vs estimated registers

**No CSS register.** The `de-`/`fe-`/`mining-` measured/estimated class families
(`src/v2/components/tableVariants.js`, `Measured.jsx`, `Estimated.jsx`) belong to `drive-explorer`,
`fleet-engagement` and `mining-expansion` only — verified: no `de-measured`/`fe-meas`/`mining-meas`
token appears in this file or in `10-intel-library.css`.

The honesty device here is **lexical**, in three forms, and it is load-bearing:
- the column header `'Strategic score (est.)'` (line 192) — the only "estimated" label in the file;
- the word "visible" folded into count labels and empty text
  (`'0 visible sites'`, `'No … are visible in this intelligence view.'`, lines 462–464);
- the standing note at line 165: *"Unknown values remain unknown; this library does not infer
  hidden assets from empty records."*

A `<Measured>`/`<Estimated>` pass would have nothing to attach to. Keep the labels as text.

### 5. Truncation

**No `*TotalCount` or `*OmittedCount` field exists anywhere in this component's payload, and the
component reads none.** It performs **three client-side truncations, none announced**:

| line | cap | source list | server cap? | announced? |
| --: | --- | --- | --- | --- |
| 198 | `.slice(0, 4)` | `orgs ++ traits` per councilor | no | **no** |
| 261 | `.slice(0, 8)` | `snapshot.servantTargets` | **no** — `evaluateCampaignTargets` (`server/opportunityScorer.js:177-188`) returns every nation over `minimumScore`, sorted, uncapped | **no** |
| 370 | `.slice(0, 3)` | `theater.weaponMix` | no | **no** |

Line 261 is the material one: on a live save `servantTargets` regularly exceeds 8, and the
"PRIORITY TARGETS" block presents its 8 as the whole set.

A fourth truncation reaches this component from the server without a count:
`completedProjects` is `.slice(0, 5)` for rival factions in player mode
(`server/intelligenceFilter.js:264`). This component does not render it, but `faction-intel` does
— see below.

**What must survive a rewrite:** nothing named, because nothing named exists. Add
`servantTargetsTotalCount` / `servantTargetsOmittedCount` server-side and render a
`<TruncationNote>`; do not silently re-slice.

### 6. Primitive

| primitive | fits? | notes |
| --- | --- | --- |
| `DataTable` | **yes**, variant `'intel-library'` already registered (`src/v2/components/tableVariants.js:53-61`, wrap/table/hint/`hintPlacement:'inside'` all correct) — but see gaps below | 10 tables |
| `Panel` | **no** — `Panel` emits `.tech-card` (`src/v2/components/Panel.jsx:49`); this component uses `.intel-library-block` + `.intel-library-block-heading` (lines 149, 425–427). Wrong class family. |
| `Value` | **partial, and it changes output.** `Value`'s `defaultFormat` returns `'UNAVAILABLE'` for absent (`Value.jsx:19`); this component's `number()` returns `'—'`. Swapping them changes ~25 cells from em dash to UNAVAILABLE. Use `absentLabel='—'` + explicit `present`. |
| `Measured`/`Estimated` | **not needed** — see §4 |
| `TruncationNote` | **needed but currently unused** — three unannounced caps (§5) |

**Four concrete `DataTable` gaps — flag these:**
1. **No `scope`.** `DataTable` emits bare `<th>` in `<thead>` (`DataTable.jsx:127-135`); this
   component emits `<th scope="col">` (line 77) and `<th scope="row">` on the first body cell
   (line 83). Row headers are not expressible via `columns`/`rows` at all.
2. **No caption class.** `DataTable.jsx:123` renders `<caption>{caption}</caption>`; this
   component needs `<caption class="intel-library-table-caption">` (line 76).
3. **No per-row className.** Turned moles get `.intel-library-row-highlight` (line 230);
   `DataTable`'s `rows` path applies one fixed `rowClass` (`DataTable.jsx:106`).
4. **Hint text and role differ.** `DEFAULT_SCROLL_HINT_TEXT` is
   `'SWIPE HORIZONTALLY TO SEE MORE COLUMNS'` (`tableVariants.js:65`); this component emits
   `'Swipe horizontally to inspect all columns'` **with `role="note"`** (line 76). `DataTable`
   emits no `role`.

Gaps 1–3 are all workable today by passing `children` instead of `columns`/`rows`, at the cost of
losing the primitive's value. Gap 4 needs a prop.

**Primitives that DO NOT EXIST and that this component needs — stop and raise these:**
- **`Overlay`/`Modal`.** The `.intelligence-library-screen` dialog (`public/v2/index.html:611-623`)
  with `hidden`/`inert`/`aria-hidden`, backdrop, focus capture and focus return is owned by
  `mission-control.js` (`setOverlayOpen`, `libraryModalTrigger`, `:777-812`). Nothing in the
  primitive set covers it, and `intelligence-library` and `faction-intel` share the exact same
  chrome (`public/v2/css/09-detail-panel.css:42-110` styles all three overlays as one rule set).
- **`Tabs`.** Two nested `role="tablist"` groups — the section nav (line 571–574) and the
  space sub-nav (line 391–394) — with `aria-controls`/`aria-selected`/`aria-labelledby` wiring
  done by hand at lines 500–506.
- **`Chip`/`StatusTag`.** `statusChip` (line 99–101), four tones.
- **`FilterBar`** (select + search + result count, lines 232–239) including the caret-restore
  behaviour at 535–539.
- **`DefinitionList`** — `<dl class="intel-library-definition-list">` (line 150).
- **`EmptyState`** — line 73–75, used by all ten tables with per-table copy.

---

## faction-intel

`public/v2/js/components/faction-intel.js` (1,261 lines) · global `FactionIntelScreen`
· mount `#factionIntelRoot` (`public/v2/index.html:607`) · CSS `public/v2/css/13-faction-intel.css` (436 lines)

### The `.faction-intel-*` prefix names TWO different surfaces

This is the naming debt. Establishing which is which:

| surface | selectors | owner | stylesheet |
| --- | --- | --- | --- |
| **A — the overlay chrome** | `.faction-intel-screen`, `…__backdrop`, `…__dialog`, `…__header`, `…__eyebrow`, `…__body`, and the body class `body.faction-intel-open` | **`public/v2/index.html:597-609`** (static markup) + **`mission-control.js:751,765,1079`** (`setOverlayOpen`, body class). **NOT `faction-intel.js`.** | `public/v2/css/09-detail-panel.css:42-110`, `:311`, `:321-333` — where it is a **shared** rule set with `.detail-panel` and `.intelligence-library-screen` |
| **B — the dossier content** | `.faction-intel-shell`, `-header`, `-layout`, `-roster`, `-detail`, `-identity`, `-visibility`, `-metrics`, `-metric-group`, `-council`, `-councilor`, `-notes`, `-plan`, `-empty` (~80 selectors) | **`public/v2/js/components/faction-intel.js`** exclusively, all DOM-built via `createElement` | `public/v2/css/13-faction-intel.css` (all 436 lines) + a responsive pass at `public/v2/css/14-world-map.css:135-157` |

Two tells that separate them: surface A uses **BEM double-underscore** (`__dialog`), surface B
uses single hyphens throughout; and surface A appears in `index.html`, surface B never does.

**Dead selector:** `.faction-intel-eyebrow` (`public/v2/css/09-detail-panel.css:87`, no `__`) is
declared but emitted by nothing in `public/`. It is a third, orphaned member of the prefix.

**Consequence for the migration:** migrating `faction-intel.js` migrates surface **B only**.
Surface A must move with `intelligence-library` and `detail-panel` as one `Overlay` primitive,
or all three break together. The doc's per-component table does not capture this shared boundary.

### 1. Payload

Class R (see corrections above). Three call sites, all identical:
`mission-control.js:759`, `:1066`, `:1076`.

```js
factionController = window.FactionIntelScreen.render(
  factionRoot,        // HTMLElement (or a selector string — resolveContainer:138-144)
  state.rawSnapshot,  // mode-filtered snapshot
  state.briefing,
  state.observer      // 4712
);
```

Returns `{ select(key), getSelectedFaction(), getSelectedId(), destroy() }` (lines 115–135).

`unwrapSnapshot` (146–152) accepts either the snapshot itself or `{ data: {...} }`.

**Snapshot fields consumed:**
- `data.mode` / `data.intelMode` / `data.visibility` / `data.isOmniscient` → `getMode` (1082–1088)
- `data.observerFactionId` (1058)
- `data.metadata.gameTimeString` / `.lastModified` (204)
- `data.priorityTargetFaction` → `{id|ID|factionId}` or `{name|displayName|factionName}` or a scalar (1064–1080)
- `data.factions[]` — `ID|id|factionId` (1092), `displayName|name|factionName|templateName` (1098),
  `color` (249, 312), `visibilityNote` (357), `alienHate{visibility, playerVisible, actual|value,
  visibleEstimate|estimate|display, requiredProject}` (839–859), `assessedAlienHateOfMe|alienHateValue`
  (863), `powerScore{overall,earthEconomy,earthPolitics,research,spaceEconomy,fleet,military,isEstimate}`
  (775–796, 1215), `controlPointsCount|controlPointCount|controlPoints` (678),
  `nationsCount|nationCount|nations` (679), `totalGdp|gdp|GDP` (680),
  `totalPopulation|population` (681), `habsCount|habCount` (703), `fleetsCount|fleetCount` (704),
  `shipsCount|shipCount` (705), `combatPower|fleetCombatPower` + `combatPowerAvailable` (798–804),
  `totalResearch|monthlyResearch|researchOutput` (739), `completedProjectsCount|completedProjects` (740),
  `currentProjectsCount|currentProjects` (741), `availableProjectsCount` (742),
  `powerVisibility|visibility` (770), `earthVisibility|terrestrialVisibility|politicalVisibility` (1128),
  `spaceVisibility` (1129), `researchVisibility|technologyVisibility` (1130)
- `data.councilors[]` — `isActiveCouncilor`, `isIndependent`, `status`, `factionId` (483–485),
  `totalSkills` (489), `displayName|name|personalName` (446), `typeTemplateName|profession|type` (447),
  `locationName|location|regionName` (448), `activeMissionName|missionName|assignment` (449),
  `activeMissionTarget|missionTarget` (450), `maskedAttributes` **then** `attributes` (504–506),
  `visibility|investigationConfidence` (469), `isTurnedMole` (499)
- `data.habs[]` / `data.fleets[]` — only for the count fallbacks at 708–710, matched on faction ID;
  `fleets[].shipsCount|shipCount` (832)
- `data.relationships` | `data.factionRelationships` | `data.diplomacy` (956) — records matched on
  `observerFactionId|observerId|fromFactionId|fromId|sourceFactionId` × `targetFactionId|targetId|toFactionId|toId|factionId`
  (1002–1003), value unwrapped from `relationship|relation|status|attitude|stance|label|name|value` (1009)
- `faction.currentProjects[]` → `{displayName|name|projectId|id, percent|progress}` (1111–1123)

**Briefing fields consumed — two, both fallbacks only:**
`briefing.campaignDate` (205) and `briefing.observerFactionId` / `briefing.observerId` (1059–1060).

Optional shared helper: `MissionControlShared.appendFactionLogo` (250, 313), guarded.

**Alternate-key reading is pervasive.** `readField(source, keys)` (1226–1235) tries an ordered key
list and returns `{found, value}` on the first `hasOwnProperty` hit *whose value is not `undefined`*.
This is why the component tolerates half a dozen field-name variants that the current save shape
never emits. A rewrite that pins to the one real name per field will look cleaner and will change
behaviour only if the payload shape moves — but the fallback chains are also **why redacted-to-`null`
fields still read `found: true`** (see §3).

### 2. Player-mode difference — YES, five of them

**a) "Hate of us" resolves in omniscient and never in player.** Same root cause as the library:
`filterFactionRelationships` (`server/intelligenceFilter.js:685-687`) drops every relationship not
sourced from the observer. `getRelationship` (872–929) reads:
- `relation` = observer → faction (`findExplicitRelationship`, 886) — **survives player mode**
- `inverse` = faction → observer (`findDirectionalRelationship`, 887) — **filtered out in player mode**

Result, `relationshipMetrics` (538–557):

| cell | player | omniscient |
| --- | --- | --- |
| Hate of us | `UNAVAILABLE` | `42.86` |
| Our hate | `<n>` | `<n>` |
| Summary | `ONE DIRECTION RECORDED` | `BOTH DIRECTIONS RECORDED` |
| `HATE OF US` visibility tag | `UNAVAILABLE` | `RAW SAVE ONLY` |
| `RELATION` visibility tag | `OBSERVER FACTION TELEMETRY` | `RAW SAVE ONLY` |

(the RELATION label difference comes from `server/intelligenceFilter.js:690-694` feeding
`normalizeVisibility` (1141–1159), where `'observer faction telemetry'` is not in the label map
and falls to `raw.toUpperCase()`.)

**b) `powerScore.overall` is `null` for rivals in player mode.** `server/intelligenceFilter.js:1000`
and `:1016` null it whenever the faction lacks full space visibility. So:
- roster `POWER <n>/100` (line 268) → **`UNAVAILABLE`** in player, a number in omniscient;
- "Composite score estimate" (762) → `UNAVAILABLE`;
- **"Estimated" (764) reads `YES` while the value beside it reads `UNAVAILABLE`** — `isPowerEstimate`
  (1214–1216) tests `powerScore.isEstimate === true`, which survives the redaction. A row that
  says "Estimated: YES" for a value that does not exist. Minor, but it is a false measurement claim.

**c) Space visibility tag says something different in each mode.** `visibilityForMetric`
(1126–1139) prefers the explicit `spaceVisibility`. Player mode sets it to
`'confirmed'`/`'partial'`/`'unavailable'` (`server/intelligenceFilter.js:985,999,1013`); the
omniscient branch (`:146-157`) adds no such field, so the explicit lookup misses and line 1136
returns `'RAW SAVE ONLY'`. Same faction, different tag, by design — but a rewrite that "normalises"
`spaceVisibility` onto omniscient would silently change the omniscient reading.

Also mode-driven: the `' visible'` suffix on hab/fleet/ship counts (line 719) appears **only** when
visibility is `PARTIAL`, i.e. essentially only in player mode.

**d) Council visibility label flips for the observer's OWN councilors.**
`councilorVisibility` (495–501) tests `context.mode === 'OMNISCIENT'` **first**, before the
observer check on line 497. So the observer's own council reads `CONFIRMED` in player mode and
`RAW SAVE ONLY` in omniscient. Deliberate-looking, undocumented, easy to lose.

**e) `visibilityNote` only exists in player mode.** `server/intelligenceFilter.js:1020` sets
`'Visible assets only; total faction strength is unknown.'` on the partial branch only.
`buildDetail` (356–369) renders it when present, else falls back to the generic
`'Data discipline'` note. So the notes block reads differently in each mode.

**f) `councilorTopSkill` handles the masked/unmasked split CORRECTLY** (504–506): reads
`maskedAttributes` when it is an object, else `attributes`. This is the pattern the council
candidate axis got wrong. **Do not invert it.** Note the skill list here (513) has **seven** keys
and omits `Loyalty`; `intelligence-library.js:63` uses **eight** and includes it. Two components,
two different definitions of "top skill". Both are as-written; neither is obviously right.

### 3. Unavailable and empty states — full enumeration

Two sentinels: `UNKNOWN_VALUE = 'UNAVAILABLE'` (line 15) and `UNKNOWN_RELATIONSHIP = 'UNKNOWN'`
(line 16). `MISSING_VALUES` (17–24) treats the literal strings `''`, `'UNKNOWN'`, `'UNAVAILABLE'`,
`'N/A'`, `'NA'`, `'NULL'` (case-insensitive, trimmed) as absent — `hasMetricValue` (1242–1247).

| # | render | trigger | line |
| --: | --- | --- | --: |
| 1 | `'UNAVAILABLE'` | `metricValue`: `!hasMetricValue(value)` — every metric cell | 1162 |
| 2 | `'UNAVAILABLE'` | `buildMetricGroup`: metric value `undefined`/`null` after formatting | 399 |
| 3 | `'UNAVAILABLE'` | `metricScore`: absent power component | 1173 |
| 4 | `'UNAVAILABLE'` | `metricText`: absent | 1169 |
| 5 | `'UNAVAILABLE'` | `formatCount`/`formatGdp`/`formatPopulation`/`formatResearch` on absent | 1182, 1189, 1196, 1203 |
| 6 | `'UNAVAILABLE'` | `formatPower` when `getPowerValue()` is null | 1178 |
| 7 | `'UNAVAILABLE'` | `normalizeVisibility(absent)` — every visibility tag | 1142 |
| 8 | `'UNKNOWN'` | `getFactionName` on a faction with no readable name field | 1099 |
| 9 | `'UNKNOWN'` | `displayRelationship(null/undefined)` | 1013 |
| 10 | `'UNKNOWN'` | `getRelationship` final fallback: no relation, no inverse, not priority | 921 |
| 11 | `'UNKNOWN'` | `summarizeRelationship` with both directions absent | 572 |
| 12 | `'UNKNOWN VIEW'` | `getMode` with no `mode`/`intelMode`/`visibility` at all | 1087 |
| 13 | `'UNAVAILABLE'` | `getAlienHate`: hate object present, but actual not permitted and estimate is a missing-label | 855 |
| 14 | `'UNAVAILABLE'` | `getAlienHate`: no `alienHate` object and no raw fallback readable | 869 |
| 15 | `'Required project: <x>.'` note | hate absent **and** `hate.requiredProject` present | 858, 361 |
| 16 | `'SKILL / UNAVAILABLE'` | `councilorTopSkill` with every one of 7 attributes unreadable | 524 |
| 17 | `'Councilor'` | councilor with no profession field | 447 |
| 18 | `'No active mission'` | councilor with no mission field | 449 |
| 19 | `'UNAVAILABLE'` | councilor with no name field, or no location field | 446, 448 |
| 20 | `'UNAVAILABLE'` council label | `councilorVisibility` with zero councilors | 500 |
| 21 | empty-state block | `!councilors.length` — "No councilors are visible for this faction in the current intelligence mode." | 429–433 |
| 22 | empty-state block | `!context.factions.length` — "No selectable factions were supplied." | 291 |
| 23 | empty-state block | `selectedKey === null` — "No faction data is present in the current snapshot." | 112 |
| 24 | empty-state block | `buildDetail(faction = null)` — "No faction is selected." | 299 |
| 25 | no-op controller | container unresolvable — `createEmptyController` | 154–161 |
| 26 | `'Data discipline'` note | no `visibilityNote` and no hate note | 363–368 |
| 27 | `'progress unknown'` | `firstActiveProject` with no percent/progress | 1122 |
| 28 | `'the listed project'` | active project with no name field | 1121 |
| 29 | `'UNAVAILABLE'` | `getCombatPower` when `combatPowerAvailable === false` | 801 |
| 30 | 4 "Reacquire…/Develop…/Treat as unknown" plan lines | `deriveActions` on absent metrics | 624, 631, 634, 636, 642, 652, 656, 658, 666, 668 |

**The `Number(null) === 0` hazards in this file — three, one of which is live:**

1. **`readField` returns `found: true` for an explicit `null`.** Lines 1230–1232 gate on
   `hasOwnProperty && value !== undefined`. Player mode redacts `habsCount`/`fleetsCount`/
   `shipsCount`/`combatPower` to **`null`, not `undefined`** (`server/intelligenceFilter.js:993-996`).
   So `habs.found === true` with `habs.value === null` — which **suppresses the fallback counter**
   at line 708 (`!habs.found ? countVisibleAssets(...) : {found:false}`) and leaves the cell
   `UNAVAILABLE` via `metricValue`. Correct outcome by luck, wrong reason. Any rewrite that swaps
   `found` for truthiness inverts it.

2. **`getFactionCouncilors` sort — latent.** Lines 488–490 use `Number(a.totalSkills)`. For an
   observed enemy in player mode `totalSkills` is *stripped* (`server/intelligenceFilter.js:698-712`),
   so `Number(undefined)` is `NaN` and the finite guard rejects it. Had it been redacted to `null`
   instead of deleted, `Number(null) === 0` and every masked councilor would sort as skill-0.
   Guard on presence, not on `Number.isFinite` after coercion.

3. **`readProjectCount` reports redacted-to-empty as a measured count — LIVE.**
   Lines 806–814 fall back to `Array.isArray(value) ? value.length : value`, and
   **`completedProjectsCount` / `currentProjectsCount` do not exist** — verified against
   `server/snapshot/factions.js:385-430`. So:
   - **"Active projects listed: 0"** for every rival in player mode, because
     `server/intelligenceFilter.js:308` sets `currentProjects: isObserver ? f.currentProjects : []`.
     A redacted array rendering as a confident zero. The word "listed" (line 750) is the only hedge.
   - **"Projects listed: 5"** for every rival in player mode, because
     `server/intelligenceFilter.js:264` does `f.completedProjects.slice(0, 5)` with **no count
     field carried**. A truncation presented as a measurement. See §5.

   In omniscient both read the true totals. **This is the sharpest player-vs-omniscient answer
   difference in the component and nothing pins it.**

### 4. Measured vs estimated registers

No CSS register (no `de-`/`fe-`/`mining-` classes). The estimate signal is **explicit data**:

- `powerMetrics` (758–766) renders a literal **`Estimated: YES / NO / UNAVAILABLE`** row, driven
  by `powerScore.isEstimate` (`isPowerEstimate`, 1214–1216). This is the closest thing to a
  register in the component and it is a *metric*, not styling.
- The label "Composite score **estimate**" (762).
- `normalizeVisibility` maps `estimated → 'ESTIMATED'` (1150) — one of eleven visibility labels
  that also include `RAW SAVE ONLY`, `PARTIAL`, `CONFIRMED`, `VISIBLE`, `ENHANCED`, `SNAPSHOT FLAG`,
  `AVAILABLE`, `UNKNOWN`, `UNAVAILABLE`. **Seven visibility tags render per faction**
  (`buildDetail:329-338`), plus one per metric group (392). That vocabulary *is* the honesty
  device here, and it is far richer than a two-register split.
- Note the `visibilityForMetric` fallback (1135–1138): `UNAVAILABLE` when no data, else
  `RAW SAVE ONLY` / `ENHANCED` / `VISIBLE` by mode — i.e. **visibility is inferred from mode when
  the payload does not say**. A rewrite must keep the explicit-field-first ordering (1133–1134)
  or every tag becomes a mode label.

### 5. Truncation

**No `*TotalCount`/`*OmittedCount` field is read, and none exists in the payload.** Three caps:

| line | cap | list | announced? |
| --: | --- | --- | --- |
| 674 | `actions.slice(0, 4)` | `deriveActions` output | no — but currently a **no-op**: both branches push exactly 3 + 1 = 4 (617–662, 664–672). It is a silent guard; a fifth action added later would vanish. |
| 419 | `councilors.length + ' visible'` | council roster | count of a filtered list, no total. Honest only because of the word "visible". |
| — | **server-side, unannounced** | `completedProjects.slice(0, 5)` (`server/intelligenceFilter.js:264`) for rivals in player mode | **no** — no count field exists, and line 740→749 renders `5 listed` as if measured |

**What must survive a rewrite:** nothing named exists to survive. To fix, the server must add
`completedProjectsTotalCount` / `completedProjectsOmittedCount` and the component render a
`<TruncationNote>`; and the `slice(0, 4)` at 674 must either become a `<TruncationNote>` or be
deleted deliberately, not silently dropped.

### 6. Primitive

| primitive | fits? | notes |
| --- | --- | --- |
| `Value` | **yes, and it is the right tool** — `present` is exactly `hasMetricValue`, and `unavailableLabel` defaults to `'UNAVAILABLE'`, matching. Pass `absentLabel='UNAVAILABLE'` too, since this component has no em-dash state. |
| `Panel` | **no** — `.tech-card` family; this component uses `.faction-intel-metric-group` / `.faction-intel-council` / `.faction-intel-plan` sections built by `createElement`. |
| `DataTable` | **not applicable** — there is **no `<table>` anywhere in this file**. The metric grid is `<div class="faction-intel-metric-grid">` of `<div>`s (395–408); the council roster is `<article>` rows (444). Forcing `DataTable` here would rewrite the CSS. |
| `Measured`/`Estimated` | **no** — see §4; the register here is the visibility vocabulary, not two type styles. |
| `TruncationNote` | **needed, currently absent** — §5 |

**Primitives that DO NOT EXIST and that this component needs — raise these:**
- **`Overlay`/`Modal`** — surface A above; shared with `intelligence-library` and `detail-panel`.
- **`VisibilityTag`.** `buildVisibilityTag` (575–580) + `normalizeVisibility` (1141–1159) is an
  eleven-state label vocabulary rendered 7–11 times per dossier. It is the component's central
  honesty device and there is no primitive for it. **This is the most important missing primitive
  in the group** — `Value` covers three states (measured/absent/unavailable); this needs eleven.
- **`Listbox`** with roving focus. The roster is `role="listbox"` / `role="option"` with a
  hand-written ArrowDown/ArrowUp/Home/End handler (278–288) that reads `document.activeElement`
  directly (line 282 — note: `document`, not `documentRef`, so it is not test-container-safe).
- **`MetricGrid`** — `buildMetricGroup` (388–411), including the
  `metricValue.length > 10 → --text` modifier at 400–402 (a *string-length-driven* class, which
  no primitive models).
- **`EmptyState`** — `buildEmptyState` (605–610), four call sites, title + text.
- **`Note`** — `buildNote` (582–587), label + text.

**Dead code to drop, not port:** `deriveActionsForTesting` (1018–1020) returns `null` and is
referenced nowhere in the repo.

---

## directive-board

`public/v2/js/components/directive-board.js` (768 lines) · global `MissionControlDirectiveBoard`
· mount `#directiveBoard` (registered `mission-control.js:188`, COMMAND view)
· CSS `public/v2/css/17-directive-board.css` (**1,398 lines — the largest single stylesheet in the product**)
· pinned by `tests/directiveBoardBench.test.js` (382 lines, 14 tests)

**Prefix note, same class of debt as faction-intel:** `.directive-*` also names two surfaces.
`public/v2/css/08-directive-cards.css` (397 lines) styles `.directive-pill-card`,
`.directive-badge`, `.directive-left`, `.directive-title-row`, `.directive-order-box` — all
rendered by **`mission-control.js:1964`** for the `directivesStreamList` panel, **not** by this
component. `17-directive-board.css` is this component's, rooted at `.directive-engine-v2`.
Smaller than the faction-intel case (no selector collides), but the same trap for a "move all
`.directive-*` rules" refactor.

### 1. Payload

Class R. **One** call site: `mission-control.js:1198-1216`.

```js
window.MissionControlDirectiveBoard.render(
  document.getElementById('directiveBoard'),
  {
    engineDirectives: state.briefing?.engineDirectives,
    briefing: state.briefing,               // passed but NEVER READ by the component
    riskFloorPreference: state.riskFloorPercent,  // null = "no stored choice"
    onRiskFloorChange: setRiskFloorPercent
  }
);
```

**Consumed from `payload`:** `engineDirectives.cyclePlan` (635), `engineDirectives.decisionReasoning`
(661, fallback), `riskFloorPreference` (685), `onRiskFloorChange` (666).
**`payload.briefing` is dead** — grep the file: no `payload.briefing` read. Drop it or use it.

**`cyclePlan` fields consumed** (from `server/engine/assignment.js` and `server/engine/budgets.js`):

| field | line |
| --- | --: |
| `assignments[]` | 656 |
| `assignments[].councilor{name,profession,location,stat}` | 324–326 |
| `assignments[].candidate{title,friendlyName,missionType,family,target{name,nation},cost{amount,resource,kind},score}` | 315–338, 522 |
| `assignments[].odds{automatic,isAutomatic,point,chance,basis,band[0..1],success{low,high}}` | 57–85 |
| `assignments[].expectedValue`, `.expectedHate`, `.why[]`, `.opportunityCost` | 311–314, 365 |
| `assignments[].riskFloor{outcome,marginal,reason}` | 157–171, 748 |
| `unassigned[]` — `{councilor{name,profession,location}, reason, reasonDetail, suggestedFreeAction, freeActionOptions[]}` | 373–390 |
| `clocks[]` — `{title, detail, urgency, daysRemaining, rate}` | 288–301 |
| `horizon[]` — `{cycle, title, enabler, notes, expectedPayoff}` | 577–585 |
| `budgets.alienHate\|hate{used\|spent, cap\|ceiling, capMeasured, capIsUpperBound}` | 217–224, 437–459 |
| `budgets.influence{used\|spent, cap\|stock}` | 218, 227–228 |
| `budgets.operations\|ops{used\|spent, cap\|stock}` | 219, 230–231 |
| `budgets.missionControl{used\|current, cap\|capacity}` | 220, 234–235 |
| `riskFloor{percent, inForce, configured}` | 115–117 |
| `riskFloorVetoed[]`, `riskFloorUnverified[]` — `{title, councilorName, reason}` | 180–194 |
| `benched[]` — `{candidate{title,missionType,score}, groupCount, groupNote, groupBudgetDisplacedCount, displacementCause, displacedBy}` | 503–556 |
| `benchBudget{jointlyAffordableCount, rowCount, unpricedRowCount, pool, reason}` | 463–476 |
| `decisionReasoning{heading, summary, selectionMethod, confidence, sources[], counts.generated}` | 594–626 |
| **all six count fields** | see §5 |

**Side effect:** clicking a card calls `window.MissionControlDetailPanel.open({…})` (732–762) with
an 11-fact array. That is a second component's API and a hard coupling.

### 2. Player-mode difference — YES, and it is the one the doc already knows

**a) The cycle plan is a different plan.** `docs/react-component-contracts.md:114` cites 19.30
player vs 66.13 omniscient. Root cause is in `server/engine/budgets.js:81-122`: player mode
redacts `actualAlienHate`, so `measuredHate` is null and `effectiveHate` falls back to the Mission
Control hate **floor** — a *lower* bound. The cycle cap comes out **8.5 in player against 7.9 in
omniscient** on the frozen save (comment at `budgets.js:104`), which changes which candidates are
affordable, which changes the assignments, the bench and every count below.

**b) The board renders that difference explicitly, and correctly.** `renderBenchBudget` (433–480):

```js
const caveat = hate.capIsUpperBound === true
  ? ' (from the MC hate floor — an UPPER BOUND, the real budget can only be smaller)'
  : '';
```
`capIsUpperBound` is `currentHateBasis === 'floor'` (`server/engine/budgets.js:152`), i.e.
**true in player mode, false in omniscient**. Pinned by
`tests/directiveBoardBench.test.js` → *"a floor-derived hate cap is labelled an upper bound on the
board"*. **This is the best-executed player-mode handling in the group. It must survive verbatim.**

**c) Risk-floor readout is a three-way, not a boolean.** `renderRiskFloor` (114–147):
`inForce` (a floor is holding things back) / `configured` with no floor (`'No floor: every action
is offered…'`) / not configured (`'No floor is configured for this snapshot…'`). The header comment
(lines 17–22) states the rule: `null` percent is "not configured", `0` is "the player chose no
floor", and neither is "a floor of zero that rejects everything". `state.riskFloorPercent` is
`null` by default (`mission-control.js:8-11`) and the `''` option deliberately clears the
preference (comment 102–104). **`Number(null) === 0` collapses all three.**

**d) Not otherwise mode-branched.** No `mode` / `intelMode` read appears in the file. Everything
mode-dependent arrives pre-computed on `cyclePlan`.

### 3. Unavailable and empty states — and four fabricated fallbacks

`num(value)` (32–36) returns `null` for `null | undefined | '' | non-finite`. Where it is used,
discipline is excellent. Where it is not, it is not.

**Honest states:**

| # | render | trigger | line |
| --: | --- | --- | --: |
| 1 | `CYCLE PLAN UNAVAILABLE` badge + empty banner | `!cyclePlan` (missing `engineDirectives` or `cyclePlan`) | 637–654 |
| 2 | `ODDS UNAVAILABLE` tag (+ basis in `title`) | no `odds.point`, no `odds.chance` | 78–81 |
| 3 | `'Unavailable — <basis \| mission rules not in this snapshot>'` | detail-panel odds fact | 63 |
| 4 | `'—'` | `expectedValue` absent (card **and** detail panel) | 349, 750 |
| 5 | `'hate unknown'` | `expectedHate` absent | 351 |
| 6 | `'Not computable without mission odds'` | `expectedHate` absent, detail panel | 751 |
| 7 | `FLOOR NOT VERIFIED` note | `riskFloor.outcome === 'unknown'` | 159–163 |
| 8 | `MARGINAL` note | `outcome === 'pass' && marginal === true` | 165–169 |
| 9 | `'Success odds could not be computed for this action.'` | outcome unknown, no reason | 162 |
| 10 | `'<resource> (Amount unavailable)'` | cost present, `amount` unparseable | 54 |
| 11 | `'<resource> (Bonus)'` | `cost.kind === 'bonus'` | 53 |
| 12 | `'Cycle hate budget NOT MEASURED — hate charges this cycle went unchecked, not cleared.'` | `capMeasured !== true` or cap/used unreadable | 445–447 |
| 13 | `'Joint affordability NOT COMPUTED — <reason>'` | `jointlyAffordableCount` null | 466–467 |
| 14 | `''` (no affordability claim at all) | no `benchBudget` **and** no `budgets` | 478 |
| 15 | `'This plan recorded no reason for holding it back. That is an unrecorded reason, not an absent one.'` | `displacedBy` absent/blank | 551–553 |
| 16 | `'standing for an unrecorded number of candidates'` | `benchedRepresentedCount` absent | 563–564 |
| 17 | no group line at all | `groupCount` absent or ≤ 1 — never `+0 more`, never `+undefined` | 524, 530 |
| 18 | `'+N more sibling option(s)'` | collapsed row with no `groupNote` | 533–535 |
| 19 | `Mixed group: N of M …` caveat | `groupBudgetDisplacedCount` disagrees with the row's own cause | 491–499 |
| 20 | segment **dropped entirely** | `counts.generated` / assignments / bench total unreadable — never `0` | 602–611 |
| 21 | `'No active councilor assignments feasible this cycle.'` | `assignments.length === 0` | 696 |
| 22 | `''` (section omitted) | empty `unassigned` / `clocks` / `horizon` / `benched`, or both risk-held totals 0 | 374, 283, 572, 504, 186 |

Items 12–20 are the strongest null discipline in the v2 frontend. `renderDecisionReasoning`'s
comment (595–601) records the exact bug it fixes: reading `assigned`/`benched` off `counts`
(which never carried them) and defaulting to `0`, printing a confident "0 allocated · 0 benched"
on every plan.

**Fabricated fallbacks — four, all live, and one is untested:**

1. **`renderBudgets` invents all four caps.** Lines 222–236:
   ```js
   const hateSpent = num(hate.used ?? hate.spent) ?? 0;
   const hateCeil  = num(hate.cap  ?? hate.ceiling) ?? 5.0;
   const infStock  = num(inf.cap   ?? inf.stock)    ?? 100;
   const opsStock  = num(ops.cap   ?? ops.stock)    ?? 50;
   const mcCap     = num(mc.cap    ?? mc.capacity)  ?? 100;
   ```
   And `render` passes `cyclePlan.budgets || {}` (line 660) — `{}` is truthy, so the `if (!budgets)`
   guard at 216 never fires. **A plan with no budgets renders a four-bar meter reading
   `0.0 / 5.0`, `0 / 100`, `0 / 50`, `0 / 100` — four measurements nobody made**, with filled
   progress tracks. This directly contradicts `renderBenchBudget` 200 lines later, which refuses
   to claim anything unmeasured, and it contradicts the repo rule "never fabricate data for a UI
   fallback". `tests/directiveBoardBench.test.js`'s *"an older payload with no bench budget renders
   no affordability claim at all"* deletes `plan.budgets` and asserts only that
   `.directive-bench-budget` is absent — **it does not assert the budget bar is absent.** Untested.
2. **`formatCost(undefined)` → `'Free'`** (line 49). An absent cost is reported as a measured
   zero-cost. Reaches both the card tag (332) and the detail panel (752).
3. **`reasoning.confidence || 'HIGH'`** (line 610). An absent confidence renders as
   `Confidence: HIGH` — the most reassuring value the field can take, from no evidence.
4. **Identity/label defaults**, less severe but all measured-looking:
   `'Councilor'` (324), `'Operative'` (325, 385, 192), `'Earth'` (326, 385, 737),
   `'Directive Assignment'` (337), `'Designated Target'` (338), `'Identified Target'` (740),
   `'expansion'` family + its colour (315), `'ACTIVE'` clock badge (297), `'Action'` (191),
   `'Assessed in-theater'` (738), `'UNAVAILABLE'` for a missing missionType (739 — this one is fine),
   **`opportunityCost || 'None'` (753)** — absent renders as the claim "None",
   and **`whyList.join(' · ') || 'Optimal expected value under cycle budget constraints.'` (754)**
   — a fabricated rationale for an assignment that recorded none.

### 4. Measured vs estimated registers

**No CSS register** (no `de-`/`fe-`/`mining-` classes). But this component carries the richest
**semantic** measured/estimated vocabulary in the group, and all of it is data-driven:

| signal | payload field | render |
| --- | --- | --- |
| cap measured vs not | `budgets.alienHate.capMeasured` | `NOT MEASURED` sentence, line 445–447 |
| cap measured vs **upper bound** | `budgets.alienHate.capIsUpperBound` | `(from the MC hate floor — an UPPER BOUND…)`, 454–457 |
| joint answer computed vs not | `benchBudget.jointlyAffordableCount === null` | `NOT COMPUTED`, 465–467 |
| rows with no measured charge | `benchBudget.unpricedRowCount` | `"; N carry no measured charge and are counted neither way"`, 474 |
| odds calculated vs automatic vs unavailable | `odds.automatic` / `odds.point` | three distinct tags, 71–99 |
| floor pass / marginal / **not verified** | `riskFloor.outcome` + `.marginal` | 157–171 |
| band vs point estimate | `odds.band[]` / `odds.success{low,high}` | `[low–high%]`, 83–85 |

Note also `benchBudget.jointlyAffordableIsUpperBound` (present in the test fixture at
`tests/directiveBoardBench.test.js:238`) is **carried by the engine and never rendered**. An
upper-bound joint count is displayed as a plain count. Worth fixing on the way through, not
silently preserving.

`<Measured>`/`<Estimated>` do not model any of this — they are two type styles. This is a
per-field provenance vocabulary. **Do not attempt to compress it into the two-register primitive.**

### 5. Truncation — the full field list

**Six count fields are read by the component**, plus three group-level fields and one it ignores:

| field | read at | used for |
| --- | --: | --- |
| `benchedTotalCount` | **508**, 604 | bench section heading `(N)`; `omitted = total − benched.length`; the "N benched" reasoning segment |
| `benchedRepresentedCount` | **511** | `standing for N candidates` — **absent stays null**, prints `standing for an unrecorded number of candidates` (563–564), never `0` |
| `riskFloorVetoedTotalCount` | **182**, 665 | held-back heading `(N)`; the `· N HELD` status badge |
| `riskFloorVetoedOmittedCount` | **183** | triggers the omitted footer |
| `riskFloorUnverifiedTotalCount` | **184** | `+ N UNVERIFIED` in the heading |
| `riskFloorUnverifiedOmittedCount` | **185** | triggers the omitted footer |
| `benched[].groupCount` | **492, 523** | collapse detection; mixed-group caveat |
| `benched[].groupBudgetDisplacedCount` | **493** | mixed-group caveat |
| `benchBudget.rowCount` / `.unpricedRowCount` | **470, 471** | `N of M row(s) below fit`; unpriced disclaimer |

**Emitted by the engine and NOT read by the board — two:**
- **`benchedOmittedCount`** (`server/engine/assignment.js:1339`). The board recomputes it as
  `Math.max(0, total − benched.length)` at line 512 instead of reading it. Equivalent today
  (`assignment.js:1328` states the invariant `benched.length + benchedOmittedCount === benchedTotalCount`),
  but it is a second statement of the same rule. Prefer reading the field.
- **`benched[].groupOmittedCount`** (`shared/benchSelection.mjs:362`) — never read; the board
  derives `+${groupCount - 1} more` (line 535).

**Not this component's, despite the brief:** `declinedOmittedCount` / `promotion.declined` belong
to **`public/v2/js/components/research-advisor.js:825,834`**. Zero occurrences in
`directive-board.js` or in `server/`.

**Also on the cycle plan, one level up (`server/directiveEngine.js:278-285`), not read here:**
`rejectedTotalCount`, `rejectedOmittedCount`, `uncertainTotalCount`, `uncertainOmittedCount`,
`futureOpportunitiesTotalCount`, `futureOpportunitiesOmittedCount`. They live on `engineDirectives`,
not `engineDirectives.cyclePlan`, and this board renders none of them.

**Hard constraint pinned by test:** `tests/directiveBoardBench.test.js` → *"the board holds no
bench cap of its own"* reads the source and asserts (a) no `BENCHED_RENDER_LIMIT` declaration and
(b) **no `.slice(` anywhere between `function renderBenched` and `function renderHorizon`**. A
React rewrite must keep `renderBenched` recognisable to that regex or replace the guard with an
equivalent. Do not add `.slice()`, `.take()`, or a `maxRows` prop to the bench list.

Second hard constraint: five CSS class names are asserted to exist —
`.directive-benched-group`, `.directive-bench-budget`, `.directive-bench-budget-unknown`,
`.directive-bench-budget-caveat`, `.directive-benched-group-caveat` (test lines 190–194, 377–381,
via `readMissionControlCss`). Renaming any of them fails the suite.

### 6. Primitive

| primitive | fits? | notes |
| --- | --- | --- |
| `TruncationNote` | **the clearest fit in the group** — but its output differs. `TruncationNote` renders `"N shown · M omitted (T total)"` (`TruncationNote.jsx:79-81`); this board renders bespoke sentences: `"Showing 8 rows of 427 benched, standing for 15 candidates; 419 further alternatives are omitted from this view."` (561–566) and the risk-held variant (207–211). Both are **asserted verbatim** by `directiveBoardBench.test.js`. Using the primitive as-is **breaks the tests**. |
| `Value` | **partial** — `Value.jsx` has three states (measured / absent / unavailable). The board needs `expectedValue → '—'`, `expectedHate → 'hate unknown'`, `odds → 'ODDS UNAVAILABLE' + basis`, `riskFloor → 3-way`. Pass `absentLabel` per site; the odds and risk-floor cases will not fit at all. |
| `Panel` | **no** — `.tech-card`; the board is rooted at `.directive-engine-v2` with its own header strip (670–683). |
| `DataTable` | **not applicable** — no `<table>` in the file. Everything is card/grid divs. |
| `Measured`/`Estimated` | **no** — see §4. |

**Primitives that DO NOT EXIST and that this component needs — raise these:**
- **`Meter`/`Gauge`.** Two distinct bar systems: `renderOddsGauge`'s
  `.directive-odds-meter/-bar` with a good/mid/low colour rule at pt<50 / pt<75 (86–99), and
  `renderBudgets`' four `.directive-budget-track/-fill` bars with a `--danger`/`--warn`/`--accent`
  rule (245–277). Neither is expressible with the five primitives. **This is the biggest primitive
  gap in the group.**
- **`Provenance`/`Caveat`** — a three-or-more-state provenance annotation (measured / upper bound /
  not measured / not computed / not verified). §4 shows seven fields needing it. `Measured`/`Estimated`
  is a two-state type-style toggle and is the wrong shape.
- **`Badge`/`StatusTag`** — `.directive-status-badge--{assigned,idle,risk}` (676–681),
  `.directive-family-tag--{7 families}` (331), `.directive-cost-tag` (332),
  `.directive-clock-badge--{urgent,active}` (289–298), `.directive-odds-tag--{auto,unknown}` (72, 80).
- **`Select`** — the risk-floor control (139–145) with its `''`-means-server-default semantics
  (102–104) and the `value === '' ? null : Number(value)` conversion at 714. `Number('')` is `0`;
  this line is the guard against exactly that.
- **`Card`** — `.directive-assignment-card` with a click-to-open-detail-panel affordance
  (719–764), including the imperative `card.style.cursor = 'pointer'` at 720.

---

## Cross-cutting risks for the rewrite

1. **`renderBudgets` fabricates four measurements and no test catches it**
   (`directive-board.js:216-236`, `:660`). Fix on the way through; a faithful port ships the defect.
2. **The `Overlay` primitive is missing and two of the three components depend on it**, styled as
   one shared rule set with `detail-panel` (`public/v2/css/09-detail-panel.css:42-110`). Migrating
   either overlay alone means either duplicating the chrome or breaking the third.
3. **`intelligence-library`'s self-mutating options + in-place `innerHTML` re-render**
   (`intelligence-library.js:477-562`) is the only genuine state-ownership problem in the group.
   The doc's "rendering change and nothing else" does not apply to it.
4. **Two components define "top skill" differently** — 8 keys with `Loyalty`
   (`intelligence-library.js:63`) vs 7 without (`faction-intel.js:513`). Unifying them in a shared
   helper changes at least one component's output.
5. **`readField` treats explicit `null` as found** (`faction-intel.js:1230`), which is what makes
   the player-mode space redaction land correctly by accident. Any "simplification" here inverts
   five metrics.
6. **`Value`'s default absent label is `'UNAVAILABLE'`; the live `number()` helper's is `'—'`.**
   A mechanical swap changes ~25 intelligence-library cells and every `'—'` in directive-board.
7. **Two unannounced client truncations survive into the product**:
   `servantTargets.slice(0, 8)` (`intelligence-library.js:261`, server list uncapped) and
   `completedProjects.slice(0, 5)` (`server/intelligenceFilter.js:264`, rendered as "5 listed" by
   `faction-intel.js:749`). Neither carries a count field. Both are the defect class this repo has
   fixed six times elsewhere.
# Component data contract — Group 5

Written 2026-08-24 against `main` @ `669e16e`. Read from source only; nothing here is
inferred from a name. Companion to `docs/react-component-contracts.md`, which this
corrects in three places (see §7).

---

## drive-explorer

`public/v2/js/components/drive-explorer.js` — 1186 source lines, class F (self-fetching),
global `MissionControlDriveExplorer` (`drive-explorer.js:1164`), mounted at
`#driveExplorer` (`public/v2/index.html:473`), registered as the sole panel of the
`drives` view (`public/v2/js/mission-control.js:219-224`), lazily loaded on first
activation (`mission-control.js:385-392`).

Public surface (`drive-explorer.js:1164-1185`):
`load`, `render`, `fetchDriveExplorer`, `openDrivePath`, and `_internals`
(`state`, `visibleRows`, `sortRows`, `pathPanelOptions`, `inDependencyOrder`, `rp`,
`accel`, `parseThreshold`, `BUCKETS`, `THRESHOLDS`, `ESTIMATE_CAPTION`).

---

### 1. Payload

Two endpoints, both fetched by the component itself.

#### 1a. `/api/intel/drive-explorer` — request

`drive-explorer.js:1109-1118`. Four params always, one conditional:

| param | value | line |
| --- | --- | --- |
| `observer` | `state.observer` | 1110 |
| `mode` | `state.mode` | 1111 |
| `detail` | **hardcoded `'summary'`** | 1115 |
| `limit` | **hardcoded `'1000'`** | 1116 |
| `design` | only when a design id is in hand | 1118 |

`limit=1000` is `MAX_ROW_LIMIT` (`shared/intel/driveExplorer.mjs:189`) and equals
`CATALOGUE_LIMIT_BOUNDS.max` (`shared/requestValidation.mjs:113`). This is the one
endpoint whose `?limit=` may exceed 100 — see §5.

`detail: 'summary'` matters: it removes `availability.reason`, `availability.chain`,
`availability.researchCost`, `availability.missingPrerequisites`, `reactor.reason`,
`power.informational`, `power.plantOutputGW`, `measured.thrustCap`, and
`estimatedDestinations.reachable` / `.closes` from every row
(`shared/intel/driveExplorer.mjs:880-896`, `906`, `913-914`, `1058-1065`, `478-481`).
**The component consumes none of those**, so the compact shape is sufficient — but a
rewrite that starts reading `measured.thrustCap` (to show the combat/cruise ratio, an
obvious temptation) gets `undefined`, not a number, until `detail` is changed.

`measured.reason` and `measured.dryMassCaveat` ARE on the compact row
(`shared/intel/driveExplorer.mjs:862`, `868`) — both are consumed.

#### 1b. `/api/intel/drive-explorer` — response fields actually consumed

**Envelope.** Everything else on the envelope is ignored (see the "not read" list below).

| field | consumed at |
| --- | --- |
| `driveCatalogue.available` | 1012 |
| `driveCatalogue.reason` | 1014 |
| `driveCatalogue.total` | 518, 724 |
| `driveCatalogue.rated` | 456, 465, 667, 724 |
| `driveCatalogue.disabledInTemplates` | 730 |
| `reason` (top level) | 1013 |
| `designs[].designId` / `.displayName` / `.shipsInService` | 370-373 |
| `selectedDesign.designId` | 370, 1153 |
| `selectedDesign.displayName` | 1032 |
| `selectedDesign.hullName` | 393 |
| `selectedDesign.shipsInService` | 397 |
| `selectedDesign.reactor.powerPlantClass` | 384, 562 |
| `selectedDesign.reactor.maxOutputGW` | 402 |
| `selectedDesign.reactor.resolvedReason` | 401 (title only) |
| `selectedDesign.fittedDrive.displayName` / `.classification` | 406-407 |
| `selectedDesign.baselineMeasured` | 385 |
| `selectedDesign.baselineUnmeasuredReason` | 423 (title only) |
| `availabilityCensus.{fittable,researchable,never,unresolved}` | 453, 458 |
| `reactorCompatibilityCensus.{compatible,incompatible}` | 454, 466 |
| `unresolvedDrives[].{driveId,displayName,reason}` | 692, 714-715 |
| `unresolvedCount` | 724 |
| `items[]` | 962, 1019 |

**The `measured` block** — the propulsion model held against this hull's own measured dry
mass and tank capacity (`shared/intel/driveExplorer.mjs:857-897`). Rendered in the
MEASURED register.

| `row.measured.*` | consumed at |
| --- | --- |
| `computable` | 595 (drives the row's `de-row--uncomputable` class and both UNAVAILABLE sub-lines) |
| `reason` | 605, 633, 637 (title attributes only) |
| `deltaVKps` | 356, 360, 634 |
| `combatAccelerationMps2` | 358, 638 |
| `cruiseAccelerationMps2` | 359, 603, 642 |
| `deltaVMultipleVsFitted` | 635 |
| `combatAccelerationMultipleVsFitted` | 639 |
| `cruiseAccelerationMultipleVsFitted` | 645 |
| `dryMassCaveat` | 609 (MASS CAVEAT badge + title) |

Also read indirectly by the threshold predicate as `row.measured[entry.measure]`
(`drive-explorer.js:286`), where `entry.measure` ∈ `{deltaVKps,
combatAccelerationMps2, cruiseAccelerationMps2}` (`THRESHOLDS`, 109-125). Those three
names are a hard contract with `DRIVE_THRESHOLD_FILTERS` in
`shared/requestValidation.mjs` — the panel deliberately reads the same number by the
same name as the endpoint, and `tests/driveExplorer.test.js:550-558` pins the units and
measures on the response.

`combat = cruise × thrustCap` exactly, and only 72 of 541 drives have the two equal
(`drive-explorer.js:15-23`; pinned by `tests/driveExplorer.test.js:361-381`, which
asserts `|combat/cruise − thrustCap| ≤ 1e-3·max(1,thrustCap)` on every computable row
AND asserts both that some drives have them equal and that most do not). Both columns
are therefore on screen; the panel once offered a CRUISE ACCEL sort with no cruise
column, which reordered the table by an invisible key.

**The `estimatedDestinations` block** — a labelled heuristic from a fixed ΔV table, with
only nine destinations modelled (`shared/intel/driveExplorer.mjs:426-484`;
`tests/driveExplorer.test.js:651-656` pins `destinationsModelled === 9`). Rendered in the
ESTIMATE register. **An absent body is not an unreachable one**, and the panel states
that in words at 436 and 446.

| `row.estimatedDestinations.*` | consumed at |
| --- | --- |
| `evaluated` | 654, 657 |
| `reachableCount` | 654 |
| `opensUp[]` | 596, 655-656 |
| `reason` | 657 |

Plus the design-level `destinationModel`, which is *also* estimate-register:

| `payload.destinationModel.*` | consumed at |
| --- | --- |
| `available` | 435, 698 |
| `destinationsModelled` | 433 |
| `destinations[].destination` / `.deltaVRequired` | 696, 705 |
| `origin` | 702 |
| `travelDaysBasis` | 707 |
| `reason` | 709 |

Note `blockedCount` and `unknownCount` exist on the row
(`shared/intel/driveExplorer.mjs:475-476`) and are **not** rendered. The panel shows
`reachableCount` against the model-level denominator only.

**The other row groups** (neither measured nor estimated — categorical facts):

| field | consumed at |
| --- | --- |
| `row.driveId` | 317, 624, 626, 963 |
| `row.displayName` | 317, 336, 627, 629, 967 |
| `row.classification` | 317, 631 |
| `row.propellant` | 317, 631 |
| `row.disabledInTemplates` | 612 |
| `row.isFittedDrive` | 615, 624, 1025 |
| `row.reactor.compatible` (tri-state `true`/`false`/`null`) | 314-315, 563, 567 |
| `row.reactor.requiredPowerPlant` | 565, 568-569 |
| `row.power.driveDrawGW` | 649 |
| `row.power.thrustScalingFactor` | 650 |
| `row.availability.bucket` | 313, 352-353, 576, 587, 868, 977 |
| `row.availability.chainRemainingResearchCost` | 580 |
| `row.availability.chainCostComplete` | 582 |
| `row.availability.chainSteps` | 584 |
| `row.availability.gateProjectId` | 862, 970 |
| `row.availability.gateProjectName` | 863 |

**Envelope fields the component does NOT read**, all recomputed client-side:
`filters.*` (including `filters.matched`, `filters.reconciles` and the whole
`filters.thresholdExclusions` block), `thresholds.*`, `sorts.*`, `basisLegend`,
`availabilityBuckets`, `research.*`, `refitBasis`, `powerBasis`, `reactorBasis`,
`formulae`, `itemsTotalCount`, `itemsShownCount`, `itemsOmittedCount`, `count`,
`designCount`, `detail`, `resource`, `intelMode`, `observerFactionId`.
Row-level: `measured.basis`, `estimatedDestinations.basis`/`isEstimate`/`blockedCount`/
`unknownCount`, `availability.state`, `availability.remainingResearchCost` and the
duration fields, `availability.missingPrerequisiteCount`, `reactor.verdict`,
`destinationModel.isEstimate`/`basis`/`note`/`fleetId`/`fleetName`.

That is the single largest fact about this component: **it re-implements the endpoint's
filtering, sorting, counting and reconciliation in the browser** rather than reading the
answers off the response. The reason is stated at `drive-explorer.js:218-240` — it holds
all 541 rows, so a fetch per keystroke would re-transfer the catalogue. The cost is a
second implementation of the rule, and `tests/driveExplorer.test.js:1050-1145` exists
solely to stop the two drifting.

#### 1c. `/api/intel/tech-path` — request and consumed response

Fetched only when a drive row is clicked and the drive names a gate project
(`drive-explorer.js:959-989`). Params: `observer`, `mode`, `target = row.availability.gateProjectId`
(837-841). Memoised in a **module-level** `Map` keyed `` `${observer}|${mode}|${target}` ``
(`751`, `835`) that is never invalidated by a new drive-explorer payload.

Consumed:

| field | consumed at | source of truth |
| --- | --- | --- |
| `target.displayName` | 863 | `shared/techGraph.mjs:857-860` (single-target branch only) |
| `remainingPath[]` | 881, 884-887 | `techGraph.mjs:798-809` |
| `satisfiedPrerequisites[]` | 882, 888-889, 930-934 | `techGraph.mjs:785-796`, capped at 60 |
| `remainingPathDependencyOrder` | 883, 803-814 | `techGraph.mjs:848` (ids only) |
| `satisfiedPrerequisiteTotalCount` | 900, 951 | `techGraph.mjs:845` |
| `satisfiedPrerequisiteOmittedCount` | 940 | `techGraph.mjs:846` |
| `researchCostComplete` | 891 | `techGraph.mjs:853` |
| `totalRemainingResearchCost` | 892 | `techGraph.mjs:852` |
| `remainingFactionResearchCost` | 897, 906 | `techGraph.mjs:851` |
| `remainingGlobalResearchCost` | 898, 912 | `techGraph.mjs:850` |
| `availabilityCaveat` | 939 | `techGraph.mjs:849`, constant at `techGraph.mjs:740` |
| `uncostedNodes[]` | 944-945 | `techGraph.mjs:854` |
| `routesEvaluated[]` | 936, 823-828 | `techGraph.mjs:677-694` |

Node shape consumed by `pathRow` (784-792): `id`, `displayName`, `category`, `status`,
`progressPercent`, `cost`, `type` — all present on both `remainingPath` and
`satisfiedPrerequisites` (`techGraph.mjs:788-795`, `801-808`).

`routesEvaluated[]` shape consumed (823-828): `nodeId`, `nodeDisplayName`,
`chosenRoute.{id,displayName,cost}`, `alternativeRoute.{id,displayName,cost}`, `savings`.

`payload.unavailable` and `payload.reason` (871, 877) are **not server fields** — they are
synthesised locally on a non-2xx response (846) or a thrown fetch (855).

**Two gaps worth recording.** `alreadyCompleted` (`techGraph.mjs:842`) is never read, so a
drive whose gate project is already complete opens a modal reading "0 step(s) remain"
with four empty sections rather than "this is already researched". And the multi-target
error branch `targets: [{ target, error }]` (`techGraph.mjs:865-867`, produced when
`resolveNode` fails at `techGraph.mjs:746`) is never checked, so an unresolvable gate id
also renders as a silent "0 step(s) remain". Neither is a null-coercion, but both are the
same shape of defect: an unknown rendering as a confident answer.

---

### 2. Player mode

**Genuinely mode-invariant for the observer's own designs — and that invariance is itself
the assertion, not an absence of one.** Evidence:

- `tests/driveExplorer.test.js:733-744` asserts equality across modes on `designCount`,
  `selectedDesign.designId`, `availabilityCensus` (deep), `reactorCompatibilityCensus`
  (deep), `items.length`, and `items[0].measured.deltaVKps`. Its name says it: *"player
  mode is a full answer, not a degraded one."*
- The threshold matrix at `tests/driveExplorer.test.js:1068` runs the whole 10-case ×
  3-population matrix **in both modes**, comparing the panel's client-side filter against
  the endpoint's.
- `scripts/verify_drive_explorer.js:357` and `scripts/verify_drive_path_modal.js:274` both
  iterate `['player', 'omniscient']` over the real browser.
- The panel passes `mode` through to both endpoints (1111, 839) and includes it in the
  tech-path cache key (835), so a mode change cannot serve a stale path.

Why it is invariant: everything on this surface is the **observer's own** — its ship
designs, its reactors, its research state. Player mode redacts *other* factions.

**One structural mode-sensitivity exists and does not fire on the current fixture.**
`shared/researchAvailability.mjs:167-173` derives `availabilityKnown` from the observer's
own `availableProjectNames`, and the comment there says explicitly *"Player mode redacts
other factions' project lists."* When `availabilityKnown` is false, every gated project
resolves to `AVAILABILITY_STATES.unknown` (`researchAvailability.mjs:264-270`), which maps
to the `unresolved` bucket and moves drives out of `items` into `unresolvedDrives`
(`shared/intel/driveExplorer.mjs:812-821`). The census equality assertion at test:738
proves this does not happen for observer 4712 on the current save. It is not structurally
guaranteed for every observer, and a rewrite must not treat mode-invariance as a licence
to verify one mode.

---

### 3. Unavailable and empty states

Formatters first, because they define what "absent" looks like everywhere below.
`UNAVAILABLE = '—'` (54). `num()` (145-149) returns `null` for `null`/`undefined`/`''`
and for anything non-finite — it never coerces.

| formatter | absent → | zero → | line |
| --- | --- | --- | --- |
| `dec(v, places)` | `—` | `0.00` | 152-155 |
| `int(v)` | `—` | `0` | 157-160 |
| `mult(v)` | `—` | `0.00×` | 162-169 |
| `accel(v)` | `—` | `'0'` | 182-191 |
| `power(v)` | `—` | `'0'` | 193-202 |
| `rp(v)` | `—` | `0 RP`; **negative → `NEVER RESEARCHED`** | 770-775 |
| `words(v)` | `—` | — | 209-212 |

**Three significant figures, not three decimal places.** `accel` (182-191) returns
`String(Number(parsed.toPrecision(3)))`. Measured cruise acceleration on the live
catalogue runs 0.00016846 → 20.59560406, five orders of magnitude; `toFixed(3)` printed
the bottom of that as `0.000`, indistinguishable from a measured zero. The `Number(...)`
wrapper strips the trailing zeros `toPrecision` pads with, so 20.6 does not read as
`20.600` beside `0.000168`. Pinned exactly, value by value, at
`tests/driveExplorer.test.js:984-998`:
`accel(0.00016846) === '0.000168'`, `accel(0.01010778) === '0.0101'`,
`accel(20.59560406) === '20.6'`, `accel(606.46655067) === '606'`,
`accel(0) === '0'`, and `accel(null|undefined|''|'not a number') === '—'`.
Also pinned end-to-end at test:963-981 (no rendered acceleration cell may be `'0.000'`,
and every one must parse `> 0`) and in the browser at
`scripts/verify_drive_explorer.js:273-274` (no cell may read `'0.000'` or `'0.00'`).

**A drive with NO measured value for a filtered field is UNTESTABLE, never failed.**
This is the contract; the panel implements it at 283-291 and 300-333:

```
thresholdOutcome(row, active)          // 283-291
  for each active minimum:
    value = num(row.measured[entry.measure])
    if value === null      → unmeasured += 1        (do NOT compare)
    else if value < applied → return OUTCOME.below  (definite failure wins)
  return unmeasured > 0 ? OUTCOME.untestable : OUTCOME.pass
```

A definite failure on any *testable* minimum is a failure whatever else is unmeasured —
the AND is then definitely false (comment at 276-282). Only when every testable minimum
passes and something is missing is the answer unknown. `visibleRows` (300-333) returns
`rows`, `belowThresholdCount` and `untestableCount`/`untestableDrives` **as three separate
facts**, because "408 filtered out" cannot be read.

This is pinned four ways:
- `tests/driveExplorer.test.js:466-515` — endpoint side, on a synthetic stripped drive
  (`unmeasuredFields` deep-equals `['cruiseAccelerationMps2']`) and on the live save's own
  unflown design where **all** rated drives are untestable and `belowThresholdCount === 0`.
- `tests/driveExplorer.test.js:1000-1048` — panel side, a synthetic row that is
  `computable: true` with only `cruiseAccelerationMps2: null`: renders `'—'`, shows
  `UNAVAILABLE` in the sub-line, sorts **last** under the cruise sort, and under
  `minCruiseAcceleration = '1'` yields `untestableCount === 1` with that driveId named and
  absent from `rows`.
- `tests/driveExplorer.test.js:1050-1145` — the panel's counts must equal
  `endpoint.filters.thresholdExclusions.belowThresholdCount` and `.untestableCount` across
  a 10-threshold × 3-population × 2-mode matrix, and the test *asserts the untestable
  branch is actually reached* on both sides rather than assuming it.
- `scripts/verify_drive_explorer.js:281-313` — the live browser and a live
  `/api/intel/drive-explorer?...&minDeltaV=10&minCombatAcceleration=20` must return the
  same `matched`, `below` and `untestable`.

Full enumeration of every unavailable / empty state the component renders:

| # | state | render | line |
| --- | --- | --- | --- |
| 1 | no payload at all (fetch failed / non-ok) | `renderUnavailable`, tech-card headed UNAVAILABLE, no table | 991-1002, 1008-1011 |
| 2 | payload present, `driveCatalogue.available === false` | UNAVAILABLE + `driveCatalogue.reason` ("re-publish after upgrading") | 1012-1017 |
| 3 | payload present, no `selectedDesign` | UNAVAILABLE + top-level `reason` ("this observer owns no ship designs…") | 1012-1017 |
| 4 | `selectedDesign.baselineMeasured === false` | `.de-notice--warn`: "NO MEASURED BASELINE FOR THIS DESIGN — every ΔV and acceleration below is reported as unavailable rather than guessed. Reactor fit, power draw and research state are still real." | 385, 423-425 |
| 5 | `destinationModel.available !== true` | legend reads "No destination table could be read … which is not the same as none being reachable" — explicitly **not** "0 destinations" | 433-437 |
| 6 | same, in the footer | `.de-notice`: "Destination estimates unavailable: {reason}" instead of the destination table | 698-709 |
| 7 | `measured.computable !== true` | row gets `de-row--uncomputable`; ΔV and combat cells render `—` with sub-line `UNAVAILABLE` and `measured.reason` as a title | 595, 624, 633-640 |
| 8 | `cruiseAccelerationMps2 === null` on an otherwise-computable row | cruise cell alone renders `—` + `UNAVAILABLE`, checked on its **own value**, never borrowing the row verdict | 598-607, 641-646 |
| 9 | `reactor.compatible === null` | `UNKNOWN` chip, title: *"Unknown is not the same as compatible."* | 571-572 |
| 10 | `power.thrustScalingFactor === null` | sub-line "scaling unavailable" | 650 |
| 11 | `reactor.maxOutputGW === null` | sub-line "output unavailable" | 402 |
| 12 | researchable + `chainCostComplete === false` | "chain cost incomplete — a step in it is never researched" | 581-584 |
| 13 | researchable + `chainRemainingResearchCost === null` | "chain cost unavailable" | 583 |
| 14 | `availability.bucket === 'unresolved'` | UNRESOLVED chip + footer list of every dropped drive with its reason | 575-589, 711-718 |
| 15 | census bucket count absent | option label reads `(—)`, not `(0)` | 458-459, 466-467 |
| 16 | a typed minimum is malformed or negative | `.de-notice--warn`: *"…not a non-negative number, so it was IGNORED rather than treated as zero. Nothing was filtered on it."* | 251-259, 537-542 |
| 17 | a minimum is active | `.de-notice--filters`: matched / measured-and-fell-short / could-NOT-be-tested, stated as three separate counts | 545-555 |
| 18 | zero rows match | `.de-notice`, **no table element at all**, plus the untestable count if any | 663-668 |
| 19 | tech-path HTTP failure | modal opens anyway with `summary` "could not be read from this snapshot" and the HTTP status as a note | 844-857, 871-879 |
| 20 | drive names no gate project | modal opens with "none — this drive names no gating project"; *ungated is a fact, not a missing value* | 969-984 |
| 21 | `researchCostComplete !== true` | TOTAL REMAINING reads "UNKNOWN — a step on this path is never researched" | 891-894 |
| 22 | `remainingFactionResearchCost`/`GlobalResearchCost === null` | fact and section caption read "UNKNOWN" / "cost unknown" | 897-898, 906, 912 |
| 23 | a path node's `cost < 0` (the `-1` sentinel) | `NEVER RESEARCHED`, never a number | 770-775 |
| 24 | path nodes typed neither `faction_project` nor `global_tech` | an **OTHER NODES** section, "shown rather than dropped: a node silently absent from both sections would make the counts lie" | 886-887, 918-927 |
| 25 | loading | tech-card headed LOADING, "Rating every drive in the catalogue against this design…" | 1146-1150 |
| 26 | in-flight path fetch | `aria-busy="true"` on the trigger button, CSS dims the name and dashes its rule | 985-987; CSS `22-drive-explorer.css:434-437` |

Cross-cutting: **nothing may render the literal text `null`, `undefined` or `NaN`.**
Asserted on the panel's own HTML at `tests/driveExplorer.test.js:933-937`, walked over
every text node of `#driveExplorer` at `scripts/verify_drive_explorer.js:173-183`, over the
modal body at `scripts/verify_drive_path_modal.js:199-203` (which also bans
`[object Object]`), and over the whole `#view-drives` section in both modes at
`scripts/verify_v2_navigation.js:207-238`.

Escaping: `escapeHtml` comes from `MissionControlShared` (52). **Its fallback
`value => String(value ?? '')` does not escape** — if the shared bundle is absent the
panel interpolates raw. The unit-test harness deliberately executes the shipped
`public/v2/js/shared.js` rather than a hand copy, for this reason
(`tests/driveExplorer.test.js:899-903`). A React rewrite removes the hazard by
construction.

---

### 4. Measured vs estimated registers

Exact classes and what each is for:

| class | role | CSS |
| --- | --- | --- |
| `.de-measured` | container register: `--mono`, `font-style: normal`, `color: var(--text)` | `22-drive-explorer.css:149-153` |
| `.de-measured__value` | the figure: `--mono`, normal, **weight 600**, `var(--text)` | `:155-160` |
| `.de-estimate` | container register: `--sans`, **italic**, `var(--text-dim)` | `:162-166` |
| `.de-estimate__value` | the figure: `--sans`, italic, **weight 400**, `var(--text-dim)` | `:168-173` |
| `.de-estimate__text` | prose in the estimate register | `:175-180` |
| `.de-tag--measured` | solid `--accent` badge, upright | `:192-196` |
| `.de-tag--estimate` | transparent, **dashed** `--warning` border, italic | `:198-203` |
| `.de-th--measured` | measured column header | applied 675-677 |
| `.de-th--estimate` | estimate column header, `border-left: 1px dashed` | `:281-283` |
| `.de-th__caption--estimate` | the literal caption above the column, `--sans` italic `--warning` | `:285-290` |
| `.de-cell--estimate` | estimate cell, `border-left: 1px dashed`, `min-width: 170px` | `:387-390` |
| `.de-row--uncomputable` | overrides `.de-measured__value` to weight 400 / `--text-dim` | `:380-383` |

`ESTIMATE_CAPTION = 'ESTIMATE — heuristic, not a measurement'` (97), rendered into the
DESTINATIONS header at 681 and exported on `_internals` so the test asserts the same
string the panel renders (`tests/driveExplorer.test.js:925-926`).

Which cells are which: three MEASURED cells per row (ΔV 633-636, combat 637-640, cruise
641-646) and exactly one ESTIMATE cell (destinations 653-658). The summary strip carries
three more `.de-measured` cells (409-421). Reactor, power and availability cells are in
neither register — they are categorical facts, not figures.

#### What `scripts/verify_drive_explorer.js` asserts by computed style

It reads the rendered document with `getComputedStyle`, in **both modes**, because
`--text-muted` was once defined self-referentially and 164 rules silently fell back to
`inherit` — source inspection is not evidence (script header, lines 7-13).

It samples `.de-table .de-measured__value`, `.de-table .de-estimate__value` and
`.de-table .de-cell--estimate`, reading `fontFamily`, `fontStyle`, `fontWeight`, `color`
(62-95), and then checks:

| # | assertion | line |
| --- | --- | --- |
| 1 | a measured value cell exists in the table | 119 |
| 2 | an estimate value cell exists in the table | 120 |
| 3 | `--text` and `--text-dim` both resolve to non-empty values | 121-122 |
| 4 | measured and estimate differ in computed **font-style** | 124-126 |
| 5 | measured and estimate differ in computed **colour** | 127-129 |
| 6 | measured and estimate differ in computed **font-family** | 130-132 |
| 7 | `Number(measured.fontWeight) > Number(estimate.fontWeight)` — the measured figure is the heavier of the two | 133-135 |
| 8 | `.de-cell--estimate` computes `borderLeftStyle === 'dashed'` | 137-138 |
| 9 | a CRUISE ACCEL header exists | 98-99 |
| 10 | that header names its unit (`m/s²`) | 100-101 |
| 11 | that header carries `de-th--measured` | 102-103 |
| 12 | **exactly three** `.de-measured__value` cells render per row | 104-105 |
| 13 | the cruise cell computes **identically** to the ΔV cell on all four properties — same register, not merely "a measured-looking one" | 106-113 |
| 14 | and its `fontStyle` differs from the estimate cell's | 114-116 |
| 15 | the words `ESTIMATE` and `MEASURED` both appear in `#driveExplorer` innerText | 141-143 |
| 16 | the text "not a measurement" appears | 144 |
| 17 | the text "absent from that list is not an unreachable one" appears | 145-146 |
| 18 | the text "destinations are modelled" appears | 147 |
| 19 | `.de-th__caption--estimate` contains `ESTIMATE` | 161, 170 |

The cheap in-suite mirror is `tests/driveExplorer.test.js:1221-1250`: it concatenates every
stylesheet the shell links **in cascade order** (`readMissionControlCss()`), then requires
that `.de-measured__value` and `.de-estimate__value` each *set* `font-family`,
`font-style`, `font-weight` and `color` rather than inheriting them, and that they
**differ** on all four; plus `.de-cell--estimate` `border-left` matches `/dashed/`.

`tests/driveExplorer.test.js:913-938` additionally pins that `de-measured__value`,
`de-estimate__value`, `de-tag--measured`, `de-tag--estimate` and the caption string all
reach the HTML, that `NEEDS ` and `RESEARCHABLE` render, and that the reconciliation line
renders. `:940-961` pins that the header order is exactly
`['DRIVE', 'ΔV km/s', 'COMBAT ACCEL m/s²', 'CRUISE ACCEL m/s²']` and that
`de-th--measured` appears exactly 3 times.

**Table styling that is part of the reference implementation** (`.de-table` is the table
reference for the migration):

- Sticky header: `.de-th { position: sticky; top: 0; z-index: 1 }` inside
  `.de-table-wrap { overflow-x: auto; overflow-y: auto; max-height: 620px }`
  (`22-drive-explorer.css:226-231`, `334-347`).
- Sticky **first column**, both axes: `.de-table-wrap .de-th:first-child,
  .de-table-wrap .de-cell--name { position: sticky; left: 0; background: var(--surface);
  z-index: 2 }`, corner cell raised to `z-index: 3`, plus a 1px `::after` edge rule so the
  numbers visibly pass behind it (`:244-272`). Header row and first column are two
  different sticky mechanisms, not one.
- Right-aligned numerics: `.de-cell--number { text-align: right; font-family: var(--mono);
  white-space: nowrap }` (`:373-377`). **It does not use `font-variant-numeric:
  tabular-nums`** — alignment comes from `--mono` and `text-align: right`. (Two other v2
  files do use `tabular-nums`: `07-hate-economics.css:139`, `16-board-skill-cells.css:20`.
  This one does not, and a rewrite that "helpfully" adds it changes the rendering.)
- Scroll hint: `.de-scroll-hint { display: none }` (`:278-286`), revealed only by
  `.de-scroll-hint.is-scrollable { display: block }` (`12-executive-boards.css:99-101`).
  **The class is toggled by `syncScrollHints()` in `mission-control.js:273-293`, not by
  this component** — it measures `wrap.scrollWidth > wrap.clientWidth + 1` where `wrap` is
  the hint's `previousElementSibling` and must match `.de-table-wrap`. See §6 for why this
  matters.

---

### 5. Truncation

**This is the one endpoint whose `?limit=` may exceed 100.** `CATALOGUE_LIMIT_BOUNDS =
{min: 1, max: 1000}` (`shared/requestValidation.mjs:113`) rather than the usual
`MINING_LIMIT_BOUNDS`, selected per resource at `requestValidation.mjs:127`, and the
projection clamps to `MAX_ROW_LIMIT = 1000` (`shared/intel/driveExplorer.mjs:189`, `1005`).
The panel exploits this by always requesting `limit=1000` (`drive-explorer.js:1116`) so
the whole 541-row catalogue arrives in one response and every filter and sort runs locally.

Three lists cap, and all three announce it:

| # | list | cap | announcement | line |
| --- | --- | --- | --- | --- |
| 1 | table rows | `state.limit`, user-selectable from `ROW_CAPS = [60, 120, 250, 1000]`, default **120** | `.de-reconcile`: "…{omitted} omitted by the {limit}-row display cap — raise it with ROWS SHOWN" — it names the control that lifts it | 95, 139, 512-515, 725 |
| 2 | unresolved drives | **20**, panel-side `unresolved.slice(0, 20)` | "{n} further unresolved drive(s) not listed here; the full set is on /api/intel/drive-explorer." | 714-716 |
| 3 | satisfied prerequisites (modal) | **60**, endpoint-side (`SATISFIED_PREREQUISITE_LIMIT`, `shared/techGraph.mjs:733`) | note: "{omitted} further satisfied prerequisite(s) are not listed here… The full set is on /api/intel/tech-path?target={gateId}." | 940-943 |

Count fields that must survive a rewrite:

- **Panel-computed** (no server field to fall back on):
  `outcome.rows.length` (matched), `outcome.belowThresholdCount`,
  `outcome.untestableCount`, `shown.length`, `omitted = max(0, matched − shown)`
  (452, 549-553, 690-693, 725-729).
- **From the drive-explorer payload:** `driveCatalogue.total`, `driveCatalogue.rated`,
  `driveCatalogue.disabledInTemplates`, `unresolvedCount`, `unresolvedDrives.length`,
  and the two censuses (456-467, 724-730).
- **From the tech-path payload:** `satisfiedPrerequisiteTotalCount`,
  `satisfiedPrerequisiteOmittedCount`, `uncostedNodes.length` (900, 940, 944).

The reconciliation line the browser verifier reads (`verify_drive_explorer.js:168-169`
requires it to contain a digit and the word "catalogue") is the full statement, at 723-731:

> `{total}` drives in the catalogue = `{rated}` rated + `{unresolvedCount}` unresolved.
> `{matched}` match the current filters, `{shown}` shown[, `{omitted}` omitted by the
> `{limit}`-row display cap — raise it with ROWS SHOWN]. [Of the rest, `{below}` were
> measured and fell below an active minimum and `{untestable}` could not be tested at
> all — an untestable drive is excluded, never counted as a failure.] `{disabled}` of
> them are disabled in the shipped templates and cannot be built.

**One pin-exception inside the cap.** The fitted drive survives the display cap whenever
the current filters still admit it (1021-1026): `capped = sorted.slice(0, limit)`, then
`shown = (fittedRow && capped.indexOf(fittedRow) === -1) ? [fittedRow, ...capped] : capped`.
Every multiple in the table is measured against that row, and a baseline you cannot see is
a baseline you cannot check. The endpoint does the same thing
(`shared/intel/driveExplorer.mjs:1008-1010`). `verify_drive_explorer.js:223-226` asserts
the fitted row appears **exactly once** whatever the sort, and that it is `rows[0]` — note
that second assertion only holds while the fitted drive falls *outside* the cap under the
sort being tested, which is a property of the current campaign, not of the code.

**Two silent-truncation risks a rewrite must not inherit:**

1. The panel never reads `itemsOmittedCount` / `itemsTotalCount` from the response
   (confirmed by exhaustive `payload.*` grep). Today the catalogue is 541 and the request
   asks for 1000, so `itemsOmittedCount` is always 0 — but if the catalogue ever exceeds
   `MAX_ROW_LIMIT`, the panel would present a slice as the whole set with no announcement.
   The rule "truncation must announce itself" is currently satisfied by luck of arithmetic.
2. If a rewrite moves filtering server-side, it inherits
   `filters.thresholdExclusions.untestableDrives`, which is capped at
   `UNTESTABLE_LIST_LIMIT = 20` with `untestableTotalCount` and `untestableOmittedCount`
   beside it (`shared/intel/driveExplorer.mjs:1094-1096`; reconciliation pinned at
   `tests/driveExplorer.test.js:507-514`). Those two counts must then be rendered; today
   the panel recomputes an uncapped list locally and needs neither.

---

### 6. Primitives

#### What DataTable must support for this component to be migratable at all

Ordered by how hard each is to retrofit. Every item is required — none is cosmetic.

1. **Two-axis sticky.** A sticky header row *and* a sticky first column, with an opaque
   background on the pinned cells, a raised z-index on the corner cell (3 over 2 over 1),
   and a pseudo-element edge rule. `22-drive-explorer.css:244-272`, `334-347`.
2. **A vertically scrolling, horizontally panning wrapper** with `max-height: 620px` that
   is a *sibling-addressable* element — `syncScrollHints` finds it as the hint's
   `previousElementSibling` and requires it to match `.de-table-wrap`
   (`mission-control.js:283-287`). A DataTable that nests its wrapper differently, or emits
   the hint inside it, silently breaks the hint for every consumer that uses the "after"
   placement.
3. **An externally toggled scroll hint.** The hint must be emitted after the wrapper and
   must accept an externally applied `.is-scrollable`. **Live defect to preserve or fix
   deliberately:** `paint()` rewrites the whole container on every sort, filter, search
   keystroke, threshold keystroke and ROWS SHOWN change (1028-1045), re-emitting the hint
   without `is-scrollable`; nothing in `drive-explorer.js` calls `syncScrollHints`, and
   `mission-control.js` only calls it on initial load (391), on `resize` (445) and at a few
   other mount points (367, 1285, 2052). So the hint disappears after the first interaction
   until the window is resized. A migration should own this inside the component
   (`ResizeObserver`), not re-create the split.
4. **Per-column header composition:** a label, an optional second line
   (`.de-th__caption`, which itself takes a different register class for the estimate
   column), and an optional per-header `title` (675-681).
5. **Per-cell composition:** a primary value node plus an optional `.de-cell__sub`
   second line, per column (634-635, 638-639, 642-645, 649-650, 588, 631).
6. **Per-cell class *and* conditional `title` derived from row data** — the title text
   differs per cell and per row (633, 637, 641, 648, 605-607).
7. **Per-row class modifiers from row data:** `de-row--fitted`, `de-row--uncomputable`
   (624), and a stable `data-de-drive` identity attribute for the delegated handler.
8. **Arbitrary cell renderers returning full `<td>` content** — chips, a `<button>`, badge
   spans (561-590, 626-630). Not "a formatter for a scalar".
9. **Row click → modal, with the accessible control being an in-row `<button>`, not a
   `tabindex` on the `<tr>`.** The whole row is clickable for the mouse; the name button
   carries the aria-label and native Enter/Space. `verify_drive_path_modal.js:135-153`
   asserts `buttons === rows`, `tagName === 'BUTTON'`, an aria-label matching
   `/research path/i`, `cursor: pointer` computed on the row, and
   `border-bottom-style: dotted` computed on `.de-name`. `:223-228` asserts keyboard
   (`focus` + `Enter`) opens the same modal and Escape closes it.
   The handler must resolve the target as `button ?? row` (1098-1103).
10. **External sort control.** Sorting is a `<select>` outside the table (470-471,
    495-496, 1057-1058), not clickable headers. Comparators must place `null` **last**
    regardless of direction (337-346), tie-break by name, and support a composite key
    (availability rank then ΔV, 351-357).
11. **A display cap with a pinned-row exception** — one designated row survives the cap,
    is prepended, and must appear exactly once (1021-1026).
12. **An empty state that renders no `<table>` element at all**, not an empty tbody —
    `tests/driveExplorer.test.js:1206` asserts `!/de-table/.test(html)`.
13. **Right-aligned mono numeric columns** via `text-align: right` + `--mono` +
    `white-space: nowrap`, *without* `font-variant-numeric` (`:373-377`).
14. **No document-level horizontal scrollbar at any of 1920/1660/1366/900/375px** —
    `verify_v2_navigation.js:240-270` throws on `scrollWidth > clientWidth` for the
    `drives` view at every one of those widths, in both modes.
15. **Focus and caret survival across a full re-render** for the search and threshold
    inputs (1065-1089). In the current code this is a manual `focus()` +
    `setSelectionRange`; in React it becomes a controlled-input/key-stability question,
    and getting it wrong makes the numeric fields untypeable.

#### Mapping to the five named primitives

| primitive | needed? | what for |
| --- | --- | --- |
| `Panel` | yes | `.tech-card` shell + `init-view__span`, header title + right-hand status word, and the three degrade headers (LOADING / UNAVAILABLE / design name) — 991-1002, 1029-1033, 1146-1150 |
| `DataTable` | yes, hardest consumer | all 15 capabilities above |
| `Measured` / `Estimated` | yes | `.de-measured` / `.de-estimate` containers, `__value` figures, `de-tag--measured` / `--estimate` badges, the `de-th--measured` / `--estimate` header variants and the `de-th__caption--estimate` caption. Used in the summary strip, the legend, the table and the footer destination block |
| `Value` | yes, **but the existing spec is insufficient** | must carry six distinct formatters — `dec`, `int`, `mult`, `accel` (**3 significant figures**, `0` ≠ `—`), `power` (M/k suffixes, 9 orders), `rp` (**negative → `NEVER RESEARCHED`**, because `-1` is a sentinel not a cost). A `Value` that only offers fixed-decimal precision reintroduces the `0.000` defect this panel exists to avoid |
| `TruncationNote` | yes, three instances | the display-cap line (which must name the control that lifts it), the 20-item unresolved list, and the modal's satisfied-prerequisite omission note |

#### **Outside the five — flag loudly**

Five things this component needs that the primitive set does not name. Per
`docs/react-component-contracts.md:126-128`, extending the set serialises against every
other in-flight component, so these must be settled before the phase starts:

1. **`Modal` / `DetailPanel`.** `openDrivePath` calls `global.MissionControlDetailPanel.open({eyebrow, title, summary, facts[], sections[], notes[]})`
   (959-989; contract at `public/v2/js/components/detail-panel.js:1-15`). That is a
   separate component (#14 in the contracts doc) with its own focus trap, `inert`
   management and Escape handling (`detail-panel.js:26-113`). **drive-explorer cannot be
   migrated before detail-panel**, or it must call across the strangler boundary into the
   legacy global.
2. **`Notice`.** `.de-notice` with `--warn` and `--filters` variants carries eight distinct
   states (§3 rows 4, 6, 16, 17, 18, plus the two unavailable shells and the loading
   body). `verify_drive_explorer.js:325-331` selects `.de-notice--warn` by class and
   asserts its text contains `IGNORED`; `:301-313` selects `.de-notice--filters` and
   asserts `MINIMUMS ACTIVE` and `/untestable|untested/i`.
3. **`Chip`.** `.de-chip` with `--ok` / `--warn` / `--block` / `--unknown` tones (214-216).
   `verify_drive_explorer.js:152-167` counts chips **by their text content** — `FITS`,
   `NEEDS …`, `FITTABLE NOW`, `RESEARCHABLE`, `NEVER` — and `:188-197` re-reads them after
   a filter change. The tone-to-bucket mapping is at 576-579 and the four hover titles at
   71-76 are load-bearing prose.
4. **`FilterBar` / `ControlBar`.** `.de-controls` is six labelled controls plus a live
   count (492-520): four `<select>`s, a `type="search"` input, and three
   `type="text" inputmode="decimal"` numeric inputs. The comment at 476-481 is a
   constraint, not a preference: `type="number"` returns `''` for anything the browser
   considers invalid, which would silently wipe a half-typed `1e` **and make the rejection
   branch unreachable in a browser while it stays reachable through the endpoint**. Every
   threshold control must name its unit on the label *and* in the placeholder
   (`tests/driveExplorer.test.js:1147-1161` asserts both, per control).
5. **A `useCatalogue`-shaped data hook that is not one fetch.** One endpoint refetches only
   on design change (1050-1055) — because a different design is a different measured
   baseline — while sort, bucket, reactor, search, threshold and row-cap changes must
   **not** refetch. A second endpoint fetches per clicked drive with its own module-level
   cache keyed `observer|mode|target` (751, 835). And a design id must be **cleared**, not
   carried, across an observer or mode change (1140-1142).

---

### 7. Corrections to `docs/react-component-contracts.md`

1. **Line 82 omits `scripts/verify_drive_path_modal.js` from drive-explorer's "pinned by",
   listing it only against `detail-panel` (line 80).** That script navigates to `#/drives`,
   waits on `#driveExplorer .de-table`, selects a row by parsing `"{n} RP over {k} step"`
   out of the rendered `.de-row` text, clicks `[data-de-path]`, and then asserts the
   section titles, facts and notes that `pathPanelOptions` in **drive-explorer.js:860-956**
   builds — `FACTION PROJECTS`, `GLOBAL TECHS`, `ALREADY SATISFIED`, `ROUTE CHOSEN`, the
   `via … rather than …` sublabel, the rolled-availability caveat, and the `RP|UNKNOWN`
   total. It pins both components, and it is the only thing that would fail if a
   drive-explorer rewrite dropped the row-click path.
2. **Lines 26-28 — "`render(root, payload)` **is** `<Component {...payload} />`" — does not
   hold for this component.** `render(container, payload)` (1158-1162) writes into a
   **module-level singleton** `state` (129-143) holding `sort`, `bucket`, `reactor`,
   `search`, `thresholds`, `limit`, `observer`, `mode`, `designId` and `container`. The
   same payload renders differently depending on prior state, and the tests rely on that:
   `tests/driveExplorer.test.js:1023-1024`, `1039`, `1098-1102`, `1132-1136`, `1163`, `1171`
   all mutate `_internals.state` directly, and `verify_drive_explorer.js:235`, `284`,
   `320-324` read `_internals.state.payload` out of the live browser. (drive-explorer is
   class F, so the doc's sentence is about class R — but the doc's general framing of
   `render` as a pure payload function is what a phase would carry into this component.)
3. **Line 42 understates class F.** drive-explorer owns *two* endpoints, and the second
   carries a module-level `Map` cache (751) that survives re-renders and payload changes
   and is invalidated only by a change of observer, mode or target.

Minor: line 82 records 1186 lines; `docs/code-index.md:27` records 1187. Trailing-newline
counting difference, not a discrepancy of substance. `docs/code-index.md:27` also shows an
empty test column for `drive-explorer.js` even though `tests/driveExplorer.test.js:895-911`
executes the file in a `vm` sandbox — the index keys on filename convention, so the
coverage is real but unindexed.

### 8. The single riskiest thing for a rewrite

**The module-level `state` singleton and the `_internals` export are the test surface, and
moving them into React state breaks every pin at once.**

`_internals` (1172-1184) exposes `state`, `visibleRows`, `sortRows`, `pathPanelOptions`,
`inDependencyOrder`, `rp`, `accel`, `parseThreshold`, `BUCKETS`, `THRESHOLDS` and
`ESTIMATE_CAPTION` specifically so that *"the layout verifier and the unit tests exercise
the same filtering, sorting and path-modal shaping the panel does, rather than a copy of
it"* (1169-1171).

The consequence: `tests/driveExplorer.test.js:1050-1145` — the matrix that compares the
panel's client-side threshold filter against the endpoint's across 10 threshold cases × 3
populations (flown / unflown / partial) × 2 modes, and which *asserts the untestable branch
is genuinely reached on both sides* — runs entirely through `_internals.visibleRows` and
`_internals.state.thresholds`. That test is the only thing standing between this codebase
and a re-introduced `Number(null) === 0` on the client half of a rule that exists twice. A
rewrite that relocates the filter into a hook and the state into `useState` disables it,
and disables `verify_drive_explorer.js:281-331` with it, on the same commit that rewrites
the code the test protects.

The mitigation is to keep the pure functions (`parseThreshold`, `thresholdOutcome`,
`visibleRows`, `sortRows`, `accel`, `rp`, `pathPanelOptions`, `inDependencyOrder`) as
**module-level exports independent of any component**, migrate only the rendering, and
re-point the existing tests at those exports before touching the render path — not after.
