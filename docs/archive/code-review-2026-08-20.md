# Code Review — 2026-08-20

Comprehensive review of the Terra Invicta AI Summary repo (~16,300 lines across `server/`, `shared/`, `site/worker/`, `scripts/`). All 266 tests pass.

Review only — no code was changed. Findings are ordered by severity; line numbers cite the files at review time.

---

## A. Correctness / bugs (highest priority)

### A1. `server/exportGenerator.js:21` — crash on `undefined` actual hate
```js
hateInfo.actual !== null ? hateInfo.actual.toFixed(2) : hateInfo.visibleEstimate
```
If `actual` is `undefined` (not `null`), `.toFixed` throws. Guard with `!= null` / `Number.isFinite`. Same class at `server/intelligenceFilter.js:147` (`(f.assessedAlienHateOfMe || 0).toFixed(2)`).

### A2. `shared/strategicDelta.mjs:214,202` — delta reads fields the snapshot never emits (dead / always-empty features)
- `:214` `asArray(to.research?.completedSincePrior)` — `buildResearch` (`shared/strategicSnapshot.mjs:205-211`) never produces `completedSincePrior`, so the "projects completed this period" list is **always `[]`**.
- `:202` `to.alienThreat?.totalWar === true` — `buildAlienThreat` emits no `totalWar` field, so `totalWarDeclared` is **always false** and the `'ALIEN TOTAL WAR DECLARED'` narration is unreachable dead code.

### A3. `shared/techGraph.mjs:363,390` — NaN research percentage
`progress / cost` where `cost` can be `0` (`template.researchCost || 0` at `:214/:274`), giving `0/0 → NaN` (not caught by `Math.min(100, NaN)`).

### A4. `server/snapshotBuilder.js:622-626` — mining rates coerced to confident `0` (violates "absent stays null")
`firstNumeric(...)` (defined `:1560-1565`) returns `0` on absence and is used for the 5 mining rates at `:622-626`. The sibling `firstNumericOrNull` (used for ship DV at `:425-431`) correctly returns `null`. Same class elsewhere:
- `server/snapshotBuilder.js:1110` `af.currentHP || 100` — fabricates `100` HP for alien facilities.
- `server/snapshotBuilder.js:949-960` zero/undefined power-score normalizers → `Math.min(100, x/0)` → fabricated `100`.
- `server/snapshotBuilder.js:807,980` `|| 10000` / `|| 5000` fabricated research costs.
- `shared/intelResources.mjs:318` `(site.water || 0)`; `:1658-1663` `?? 0` hate/ships; `:1407` density fallback `1.0`.
- `server/intelligenceFilter.js:131,147` `|| 0` hate → pips / `0.00`.
- `server/miningExpansion.js:280` fabricated baseline consumption `50`; `:284-285` `r.net ?? 0` / `r.stock ?? 0`.
- `shared/strategicSnapshot.mjs:109-111` `habs/fleets/ships ?? 0`; `:147-149` mine penalty suppressed when no grants resolved.
- `shared/councilorAttributes.mjs:181` base attrs `?? 0`.
- `server/saveParser.js:106` `campaignStartYear || 2022`, `difficulty || 'Normal'`.
- `server/exportGenerator.js:63` `(f.totalGdp || 0)/1e12` → `$0.0T` (while research on the next line correctly says `UNAVAILABLE`).
- `server/opportunityScorer.js:24` `(nation.GDP || 0)`.

### A5. `server/directiveEngine.js` — generic mission candidates bypass critical safety rules
- `:716,:754` alien-hate veto / `appliesTo` require `candidate.hate.toAliens`, which only hand-written candidates carry — generic candidates (`server/engine/candidates/missions.js`) are never checked against the Total War budget (**High**).
- `:1025` affordability veto checks `candidate.cost.kind === 'flat'` (lowercase) but generic candidates emit `'Flat'`/`'Bonus'` → veto never fires (**High**).
- `:852-854` `legality/no-territory` reads `candidate.value?.regionsCount`, which generic candidates never set → every generic candidate lands in `uncertain` (**Medium**).
- `server/engine/candidates/missions.js:116-117` `successHate || 5` fabricates hate when spec is `0`.
- Root cause (**D4 below**): same missions generated twice (`directiveEngine.js:288-668` vs `missions.js`) with divergent schemas (`value.*` vs `baseValue`, `hate` vs `successHate`, different `family`). This is the biggest single architectural defect in the engine.

### A6. `server/directiveEngine.js:81-86` — absent campaign date treated as "defense is active"
`defenseIsActive` returns `!expiry || !now || expiry > now` — with `campaignDate` null, every owned defended CP is judged active and the whole Defend Interests axis vanishes (`:446`). Absent-measurement-as-confirmed-safe, exactly what the file header forbids.

### A7. Strict `===` vs numeric comparisons — faction ID matching inconsistent across files
- `shared/intelResources.mjs:1896-1897,1925,1965-1968` alien filters use strict `===` while everywhere else uses `Number(x)===Number(y)` — mixed-type snapshots silently return empty.
- `server/directiveEngine.js:243` uses `c.id !== cp.id` (strict) while `:246` uses `sameId` — the exact type-collision class documented in `server/engine/pairing.js:25-32`.
- `server/intelligenceFilter.js` mixes three idioms (`String()===`, `parseInt===`, bare `===`) across `:29-30,:325,:376,:382,:385`.

### A8. `shared/intelResources.mjs:1731-1733` — mobility silently returns the *wrong fleet*
When the requested `fleetId` isn't found it falls back to the observer fleet or `fleets[0]`, mislabeled as the requested fleet. Should return an error. Related `:1796-1801` fabricates a "Battlecruiser Standard" design with costs when no design matches (and no `isEstimatedCost` flag).

### A9. `server/directiveEngine.js:770-801` — 5-diamond hate meter scored as 3x, not unknown
At `pips === 5` the advisor reports `totalWarProximity: 'unknown'` (hate could be 51 or 199), but the rule checks `'active'/'near'` then `pips>=4` → crossing50, so the 10x branch is unreachable and "unobservable distance" is scored as "merely elevated".

### A10. `shared/strategicSnapshot.mjs:347-350` — shipyards double-counted
Increments `entry.yards` when `module.isShipyard`, then the `/Construction|Shipyard|.../` regex matches the same module again, incrementing `entry.construction` too.

### A11. Duplicated diff logic that can desync
`shared/strategicSnapshot.mjs:429-492` `deriveEvents` re-implements most of `buildStrategicDelta` (`shared/strategicDelta.mjs:135-217`) — ship-loss, hab change, project started/resolved, hash compare, threshold crossing all duplicated. A fix to one copy silently won't apply to the other (the A2 mismatch may be a symptom).

### A12. Env/config validation gaps
- `server/config.js:137` `Number(env.SUPABASE_OBSERVER_FACTION_ID)` → `NaN` accepted with no `Number.isFinite` guard; flows into publishing.
- `scripts/push_latest_to_supabase.js:190-196` `Number(x) || default` silently falls back on typos.
- `server/config.js:143-148` vs `synchronizeHistoryRetention:160-172` map the same `SUPABASE_HISTORY_RETENTION` env twice with divergent `??`/`||` logic.

---

## B. Duplicated logic (biggest maintenance cost)

- **`asArray` defined 5×**: `shared/councilorAttributes.mjs:72`, `shared/strategicDelta.mjs:11`, `shared/intelResources.mjs:106`, `shared/techGraph.mjs:59`, `shared/strategicSnapshot.mjs:62`. **`num`/`toFiniteNumber` ~4×**, **`round` 2×**, **`sameId`/`toFiniteNumber` verbatim** in `server/directiveEngine.js:47-60` and `server/directiveAdvisor.js:83-92`.
- **Observer-faction fallback chain** (`find by id → 'the Initiative' → [0]`) duplicated in `server/intelligenceFilter.js:18-20`, `server/miningExpansion.js:341-343`, `server/briefingGenerator.js`, `shared/intelResources.mjs` (4 near-identical variants with different matching).
- **API index HTML generation** duplicated between `site/worker/index.js:641-661` and `server/index.js:430-441` (**High** — must be edited in two places).
- **Export markdown fallback** `site/worker/index.js:349-351` vs `:977-979`.
- **Parse/comparison/delta pipeline** in `scripts/push_latest_to_supabase.js:321-478` duplicates `server/snapshotLoader.js`.
- **Mining-resource key tables** (`[['water','Water'],...]`) in 3 places (`shared/intelResources.mjs:1085,:1325-1331,:1413-1419`) with **inconsistent casing** (`nobleMetals` vs `NobleMetals`).
- **construction-status / daysRemaining** computed twice in `server/snapshotBuilder.js:573-585` vs `:655-664`.
- **faction-name resolution** idiom repeated ~9× in `server/snapshotBuilder.js`.
- **`server/capabilityResolver.js:40,72`** — `outputKey` derivation duplicated in two loops; `getDefaultCapabilities:144-180` duplicates the `resolveCapabilities` field list.

---

## C. Hardcoded values / magic numbers

- **`4712`** repeated as a literal in `server/miningExpansion.js:337`, `shared/strategicSnapshot.mjs:505`, and 8 resource signatures in `shared/intelResources.mjs` — despite `shared/constants.mjs:2` exporting `DEFAULT_OBSERVER_FACTION_ID = 4712`.
- **`4717`** alien id hardcoded in `shared/strategicSnapshot.mjs:505` / `shared/strategicDelta.mjs:131` (file doesn't even import `constants.mjs`), plus a `fallbackFactions` array in `scripts/push_latest_to_supabase.js:381-390`.
- **War threshold `50`** hardcoded in `shared/strategicSnapshot.mjs:482`, `shared/strategicDelta.mjs:173,:87-88` instead of `shared/alienHateEconomics.mjs:12` `ALIEN_HATE_WAR_THRESHOLD`.
- `'the Servants'` string in `server/opportunityScorer.js:107,:94-96,:142` instead of `SERVANTS_DISPLAY_NAME`.
- **Faction colors** hardcoded `server/snapshotBuilder.js:1703-1715`.
- Magic numbers scattered: `AU 149597870700`, `86400000` ms/day (4×), Saturn `+0.25`, `slice(0,8)`, `slice(0,5)`, `12` skill threshold, `1e12`, `10000`/`5000` costs, hate array indices `hate[4]/hate[5]/hate[1]/hate[2]`, `mcCost=1`, `buildTimeDays||60`, theater accessibility multipliers, `0.8` hate reduction (2× in `shared/alienHateEconomics.mjs:171,176`), batch limits `3MB`/`8`/`12MB`.
- `scripts/push_latest_to_supabase.js:196` — `fullSnapshotRetention || 3` duplicates the default already in `config/defaults.json`.

---

## D. Multi-functional files → should be split

- **`server/snapshotBuilder.js` (1726 lines)** — 8–10 responsibilities (ID maps, nations, councilors, fleets, habs/sites/modules, shipyard queues, global research, power scores, faction relationships, xenoforming, tech matrix, plus template-derived static builders). Should be e.g. `nationsBuilder`, `councilorBuilder`, `spaceBuilder`, `factionBuilder`, `techBuilder`.
- **`shared/intelResources.mjs` (2066 lines)** — 15 domain projections + dispatcher + registry. Split per domain (mining/logistics/theaters/mobility/production) reusing shared predicates. Also `SUPPORTED_RESOURCES` (`:10-18`), `INTEL_ENDPOINT_INDEX` (`:23-63`), and the dispatcher (`:1952-2063`) are **three hand-maintained lists** that drift.
- **`server/directiveEngine.js` (1363)** — generators + rules + budget + assignment. The hand-written vs spec-driven duplication (A5) is the core reason to unify.
- **`server/briefingGenerator.js` (1121)** — orchestration + prose + 4 directive builders + theater mapping + formatting. Directive builders belong beside `directiveEngine`; theater mapping belongs in `server/spaceTheater.js`.
- **`server/index.js` (747)** and **`site/worker/index.js` (1036)** — monoliths mixing routing, validation, caching, projection, HTML rendering. The two runtimes duplicate validation (`requestValidation.js` can't be imported into the worker — needs a shared ESM validation module).
- **`server/miningExpansion.js:105-187`** — `buildMiningCapacity` mixes capacity/penalty with alien-hate economics.
- **`scripts/push_latest_to_supabase.js` (736)** — parsing + fingerprinting + filtering + export + validation + batching + upsert + history compaction.

---

## E. Architecture / consistency concerns

- **Three different return shapes** from `shared/strategicDelta.mjs:116-123` (`{error}` / `{baseline,note}` / full) with no discriminator.
- **`strategicSnapshot` vs `strategicDelta` field-name mismatches**: camelCase `f.id` vs PascalCase `f.ID` (`shared/techGraph.mjs:643` vs `shared/strategicDelta.mjs:42`); `events` is structured objects in the snapshot (`:546`) but narration strings in the delta (`:219`); construction `constructionStatus` vs `constructionCompleted` (`:345` vs `:377`).
- **`shared/strategicSnapshot.mjs:40-50`** comment says grants total 42 but actual sum is 43; `:22-35` dead policy flags (`preserveCouncilors` etc.) never implemented.
- **`server/snapshotLoader.js:139-154`** silently falls back to the default observer on an unmatched name, inconsistent with `server/requestValidation.assertKnownObserver` (404). Its cache keys on `size:mtimeMs` while stability uses a content hash (`:71-77`) — stale-cache edge for restored saves.
- **`server/templateLoader.js:93-97`** probes 26 drive letters on every load.
- **`scripts/push_latest_to_supabase.js:505-518`** uses the service-role key with no campaign-key authorization check (RLS is the real boundary; worth explicit docs).
- **`site/worker/index.js:85,:72`** wildcard CORS + forwards inbound headers to `env.ASSETS.fetch` (hygiene).
- **`server/supabaseAdapter.js:16`** conflates `SUPABASE_ANON_KEY` with the publishable key; `:71` uses lenient `parseInt(...) || default`.
- **`server/saveParser.js:74-77`** loads the full save into memory multiple times (buffer, string, parsed object).
- **`site/worker/index.js`** hardcodes `4712` and `'initiative'` defaults despite `shared/constants.mjs` existing.

---

## F. Positive notes

- Defensive null-handling (`??`, `typeof === 'boolean'` guards) is generally good and mostly *follows* the absent-stays-null rule — the violations in A4 are localized exceptions, not the norm.
- Strong test discipline: 26 test files, 266 passing, including security tests (`tests/serverSecurity.test.js`), config validation, and dedicated suites per module.
- The deprecated-key migration in `server/config.js` and the save fingerprint / concurrent-write guard in `server/index.js:121-132` are well-implemented.
- Both runtime query paths use the parameterized Supabase client (`.eq()`/`.upsert()`), so no SQL injection was found — RLS is the actual security boundary.

---

## Suggested remediation order

1. **A1, A2** — crash and dead-code bugs first.
2. **A5/A9** — unify the two mission generators in the directive engine; this fixes the hate-veto, affordability, and territory bugs at once.
3. **A4** — sweep the absent→0 / `||` coercions against the shared convention.
4. **A7** — add one shared `sameId`/`factionMatches` and use it everywhere.
5. **B/C** — extract `shared/util.mjs` (`asArray`, `num`, `round`, `sameId`, `resolveObserver`), the API-index generator, and centralize constants; import `constants.mjs` in the files that hardcode `4712`/`4717`.
6. **D** — split the four monoliths (snapshotBuilder, intelResources, directiveEngine, briefingGenerator) into single-responsibility modules.
