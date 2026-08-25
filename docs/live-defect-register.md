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

**Tally as of 2026-08-25: 16 entries — 6 fixed, 5 live, 1 latent, 4 conditional.**

#1 and #9 are **fixed and shipped**. #3 was fixed as part of the `mc-budget`
React migration (`2c1427f`) rather than ported, and had first been **demoted**
to latent after its supporting claim turned out to be false — see the correction
there. **#7, #11 and #12 were fixed 2026-08-25** (`7a48add`), verified by
reverting each component with the new tests in place and confirming exactly one
test failed per file. One further candidate was investigated and **cleared** —
see the end of #8.

**Live on the dashboard right now: #2, #5, #13, #15 and #16.** #16 is in the
**verification tooling**, so it invalidates evidence rather than a panel and
should be fixed before the next migration leans on it. #4, #6, #8 and #10 are
real but need a specific input or width; #14 is a live path that the current
fleet does not reach.

*Correction: the commit that added #15 stated in its message that this header
had been re-derived to 15 entries. It had not — that edit was never made, and
the header still read 14 until #16 was added. The counts above are derived from
the entries below rather than incremented.*

**#9 is the one to fix first.** It is the only defect that also reaches the AI
markdown exports and the hosted worker, it drops 91% of its records, and unlike
the others it is not confined to a component the migration will rewrite anyway —
`shared/markdownExports.mjs` is explicitly out of scope for this migration, so
nothing else is going to touch it.

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

## 11. An explicit UNAVAILABLE visibility renders as VISIBLE — **confirmed**

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

## 12. An unknown nuclear arsenal renders as zero — **confirmed**

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

## 13. `strategic-commentary` renders a Monte Carlo band as the whole uncertainty — **confirmed live**

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

## 15. The bench is scored, ordered, and is not a ranking — **demonstrated live**

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

## 16. `--save` makes the style harness stamp a save it never rendered — **demonstrated, and it is in the verification tooling**

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
