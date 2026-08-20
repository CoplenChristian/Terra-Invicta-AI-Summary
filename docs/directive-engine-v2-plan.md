# Directive Engine v2 — Implementation Plan

How to build what `docs/directive-engine-v2.md` designs. That document is the *what and why*; this is the *how and in what order*.

Written 2026-08-20 against commit `16050e2`.

---

## 0. Baseline

- `server/directiveEngine.js` — v1, ~1,100 lines, exports `WEIGHTS, RULES, buildWorld, generate*Candidates, applyRules, scoreCandidates, runEngine, buildDecisionReasoning`.
- **216 tests, 2 failing.** Both are `directiveEngine.test.js` asserting Turn's hate is `{low:0, high:0}` while the engine now returns `{low:0, high:3}`. The engine is arguably right — `high` is the failure bound — but the framing "zero-hate on success" and the value `high: 3` are answering different questions. **V2-6 resolves this properly** (`expectedHate = P(fail) × 3`); until then the test should assert the band, not zero. Fix before starting, so v2 begins from green.
- **A concurrent session is editing these files.** Agree ownership before V2-1, or this plan collides.

---

## 0a. Scope: estimate, don't abstain

**The engine does not need to be deterministic. It needs to suggest the best course of action it can calculate.** That is a deliberate relaxation and it changes several decisions below.

The distinction that matters is **facts versus recommendations**:

| | Rule |
| --- | --- |
| **Displayed facts** | Never fabricated. Unmeasured hate is `null`, not `0`. This discipline stays absolute — it is what the `c3d21bc` and `countShips` defects were both about |
| **Recommendations** | May be built on estimates and stated assumptions. A labelled estimate beats an honest refusal to answer |

Consequences:

- **`unknown` no longer benches a candidate.** In v1 an unevaluable veto moved a candidate to `uncertain`, which could never be recommended. v2 keeps `unknown` as a *confidence* signal but still lets the candidate be recommended, with the unmeasured term named. Reserve hard vetoes for **irreversible** consequences — crossing Total War, illegal actions — where being wrong cannot be undone.
- **Unmodelled modifiers get assumed values, not infinite bands.** §4a.5's uncertainty allowance should be a stated typical value, not a band so wide it says nothing.
- **Masked enemy attributes get an estimate.** Player mode hides a defender's Loyalty; assume a campaign-typical value, label it as assumed, and recommend anyway. "Roughly 30%, assuming average Loyalty" is more useful than "unknown".
- **Weights do not need derivation.** They are judgement, they live in config, they are marked heuristic, and that is sufficient. Stop treating their unprovenness as a blocker.

What this does **not** license: presenting an estimate as a measurement, or hiding that an assumption was made. Every estimated term names itself in the reasoning.

---

## 1. Module structure

v1 is one file doing generation, rules, scoring and selection. v2 needs that split, because the assignment layer has to see all candidates at once.

```
server/directiveEngine.js          orchestration only; public API unchanged
server/engine/
  missionCatalogue.js              MissionSpec[] from template data
  feasibility.js                   condition evaluators -> pass|fail|unknown
  clocks.js                        deadlines, decay, accrual, ramps
  budgets.js                       portfolio pools + consumption
  pairing.js                       candidate x councilor, odds, expected value
  assignment.js                    the allocator
  candidates/
    missions.js                    generic: MissionSpec x targets
    build.js                       ship/hab/module orders (MC-costing)
    research.js                    project selection + schedulability
    fleet.js                       intercept/transfer/defend
  rules/
    index.js                       registry
    hate.js  legality.js  value.js  readiness.js  portfolio.js
```

`runEngine` keeps its signature and result shape, with `cyclePlan` added. Nothing downstream breaks.

---

## 2. Contracts

**MissionSpec** — one per mission, derived from `TIMissionTemplate`, never hand-written:

```js
{ dataName: 'GainInfluence', friendlyName: 'Control Nation',
  hate: [0,0,0,0,0,0], successHate: 0, criticalHate: 0,
  attackAttribute: 'Persuasion', defendAttribute: null,
  cost: { resource: 'Influence', kind: 'bonus', amount: null },
  context: 'EarthOnly', targetKind: 'Nation',
  conditions: ['TargetInRange','Human','CouncilorOnEarth','AvailableControlPoint'],
  utilityScore: 4 }
```

**Candidate** — a mission bound to a target, actor-free:

```js
{ id, missionSpec, target, value, hate, denial, clocks, requires, enables, provenance }
```

**Pairing** — candidate bound to an actor. This is the unit the allocator ranks, and it is also Notion 14's `/api/intel/mission-planner` payload:

```js
{ candidate, councilor, feasibility: 'pass'|'unknown',
  odds: { success: {low,high}|null, basis },
  expectedValue, expectedHate, cost, opportunityCost, why: [] }
```

**CyclePlan** — the new output:

```js
{ assignments: [Pairing], unassigned: [{councilor, reason}],
  benched: [{candidate, displacedBy}], budgets: {...}, horizon: [...] }
```

---

## 3. Feasibility — the shape of the problem

53 distinct `TIMissionCondition_*` types across 50 missions, but the distribution is lopsided and that is what makes this tractable:

| Condition | Missions gated |
| --- | --- |
| `TargetInRange` | **42** |
| `CouncilorOnEarth` | **23** |
| `Human` | **21** |
| `FreeCouncilor` | 5 |
| `MinimumGlobalAbductions_*` | 7 |
| ~45 others | 1–4 each |

**Implement four evaluators and ~80% of the catalogue gates correctly.** The long tail returns `unknown`, which the existing three-outcome discipline already handles — the candidate surfaces confidence-downgraded with the condition named, rather than being dropped or wrongly offered.

Explicitly do **not** attempt all 53. `SentinelModulesActive`, `CanConstructFacility`, `AllowedDeorbitTarget` and friends are one-mission gates whose data is not in the snapshot; naming them as unknown is the honest and cheap outcome.

Cost data resolves cleanly and should stop being `UNAVAILABLE`:

| Kind | Count | Handling |
| --- | --- | --- |
| `Bonus` | 29 | amount is player-chosen and buys odds → null until V2-6 |
| `Flat` / `FlatOnEarth` | 9 | **exact, state it** (Defend Interests = 20 Influence) |
| none | 12 | **free** — Surveil Location, Protect Councilor, Go To Ground |

---

## 4. Getting mission data to the engine

**This is the single unlock.** Every generator downstream becomes data-driven once it lands, instead of one hand-written function per family. It is also the first commit, so it is specified here in full.

### 4.1 Why not read templates directly

`templateLoader` does not load `TIMissionTemplate.json`, and the **hosted worker has no template directory at all** — `site/worker/` runs on the published snapshot alone. An engine that reads templates at request time works locally and breaks the deployed site.

The codebase already solved this twice. `buildShipHullStats()` and `buildTraitStatMods()` resolve template data at snapshot-build time and bake the result onto the snapshot, precisely so `shared/` modules stay free of `fs`-backed imports. `missionSpecs` follows that path exactly.

### 4.2 Loader change

`server/templateLoader.js`, alongside the existing `loadJsonFile` calls:

```js
this.loadJsonFile('TIMissionTemplate.json', (item) => {
  const id = item.dataName || item.friendlyName;
  if (id) this.templates.missions.set(id, item);
});
```

Add `missions: new Map()` to the templates object. **Do not add it to `REQUIRED_TEMPLATES`** — that list is the "is this a usable templates directory" probe, and widening it would make previously-working install paths fail the check.

### 4.3 `buildMissionSpecs()`

In `snapshotBuilder`, emitted as `missionSpecs` next to `shipHullStats`. Field mapping, all directly from the template:

| Spec field | Template source |
| --- | --- |
| `friendlyName` | `friendlyName` — the name the game shows; `dataName` is the key. They diverge (`Propaganda` → "Public Campaign", `GainInfluence` → "Control Nation") |
| `successHate` / `criticalHate` | `hate[4]` / `hate[5]` |
| `failureHate` | `hate[1]`, `hate[2]` — the branch that makes Turn cost anything |
| `attack` | `resolutionMethod.attackingModifiers[].attackerAttribute` |
| `defend` | `resolutionMethod.defendingModifiers[].defenderAttribute` |
| `costResource` / `costKind` / `costAmount` | `cost.resourceType`, `cost.$type`, `cost.value` |
| `context` | `missionContext` — `EarthOnly` / `Unlimited` / `SpaceOnly` |
| `targetKind` | `target.$type` minus the `TIMissionTarget_` prefix |
| `conditions[]` | `conditions[].$type` minus the `TIMissionCondition_` prefix |
| `utilityScore` | `utilityScore` — the game's own priority hint |

**Store explicit zeros, never `null`, for hate.** A zero-hate mission must serialise as `successHate: 0`, not `hate: null`. Everywhere else in this codebase `null` means *unmeasured*, and the entire hate model depends on that distinction — a compression that saves ~2 KB by conflating "costs nothing" with "unknown" would reintroduce the exact bug class §0 keeps fixing.

Skip `disable: true` rows, and skip the 7 victory missions (`VictoryCondition` in `conditions`). They are endgame triggers, not cycle decisions.

### 4.4 Measured payload

Prototyped against the installed templates:

| | |
| --- | --- |
| Missions kept (victory excluded) | **43** |
| Raw JSON | **12.8 KB** |
| Gzipped | **1.8 KB** |

Negligible. No dedupe or splitting needed — unlike the tech graph, which needed the static/dynamic split at 959 KB.

**Exclude from `strategicSnapshot.mjs`.** Mission specs are static per game version, so storing them on every history row would be pure repetition. Same reasoning that keeps the tech graph out of strategic history.

### 4.5 Flow-through

- `intelligenceFilter` passes `missionSpecs` through **unfiltered in both modes**, at the same two call sites that carry `shipHullStats` (lines ~105 and ~410). Mission templates are public game rules, not intelligence — nothing about them is observer-dependent.
- `directiveEngine.buildWorld({ missionSpecs })`, defaulting to `null`.
- **The engine must degrade, not crash, when `missionSpecs` is absent.** Snapshots published before this change will not have it, and the hosted site serves those. With no specs, mission generators emit nothing and the board reports that the catalogue is unavailable — the existing v1 generators keep working meanwhile.

### 4.6 What this immediately fixes

Nine missions carry exact flat costs, so the blanket `missionCost: 'UNAVAILABLE'` can go on day one:

| Mission | Cost |
| --- | --- |
| Defend Interests | 20 Influence |
| Advise | 10 Influence |
| Contact Councilor | 10 Influence |
| Pass Technology | 10 Influence |
| Set National Policy | 10 Influence |
| Investigate Alien Activity | 5 Operations |
| Orbit | 0.1 Boost (`FlatOnEarth`) |
| Grant Alien Control | 100 Influence *(alien-only)* |
| Build Facility | 500 Money *(alien-only)* |

### 4.7 Tests

- Every emitted spec traces to a real `dataName`; count matches the template minus disabled and victory rows.
- Hate values match template rows — extend the existing `missionHateTable.test.js` guard from 6 hand-listed missions to the whole catalogue, so a game patch fails loudly.
- A zero-hate mission serialises `successHate: 0`, not null.
- `buildWorld({})` with no `missionSpecs` produces no mission candidates and no throw.
- Payload stays under a stated ceiling (say 32 KB raw), so a future template change cannot silently bloat the snapshot.

---

## 4a. Mission odds — the resolution model

Found, verified, and it changes one of v2's design assumptions.

### 4a.1 The formula

Wiki `Roll`:

```
diff = offense − defense
diff >= 0 :  chance = 1 − 0.5 × 0.775^|diff|
diff <  0 :  chance =     0.5 × 0.775^|diff|
```

Critical success = `chance / 10`. Critical failure = `(1 − chance) / 10`.

**Verified 13/13 against the wiki's own table** (diff 0→50.0%, 3→76.7%, 5→86.0%, 10→96.1%, 20→99.7%). Reproduce that check in the test suite — it is a two-line guard on the one formula everything else rests on.

**Citation caveat, stated because this project's standard demands it:** `Roll` is rev **2026-01-03**, two days *before* the 1.0 release on 2026-01-05, so it is not strictly a post-1.0 source. It is corroborated by the post-1.0 `Missions` page (rev **2026-02-12**), which independently describes the same curve in prose — *"if the bonuses and maluses add up to zero, the success chance is 50 percent; otherwise, each point in one direction has a decreasingly powerful impact"* — and by the outcome rule *"results that are less than 10% of the success chance mark a critical success"*. Shape and constants agree. Treat as `estimateClass: 'calculated'`, not `'exact'`, until a fully post-1.0 statement of the constants exists.

### 4a.2 Half the catalogue needs no odds at all

| Resolution | Missions |
| --- | --- |
| `Automatic` | **21** |
| `Contested` | **29** |

An Automatic mission always succeeds. Its expected value is just its value, and its hate is the success-slot value with no distribution. **V2-6 is therefore not a prerequisite for over half the action space** — Control Nation, Defend Interests, Surveil Location, Set National Policy and the rest can be scored exactly from V2-1 onward.

### 4a.3 Base difficulty is in the templates

The wiki's "Base Difficulty" column is the defence-side `TIMissionModifier_FlatModifier`. Extracted:

| Mission | Base | Attack | Defence |
| --- | --- | --- | --- |
| **Turn Councilor** | **15** | Persuasion | Loyalty |
| Assassinate | 12 | Espionage | Security |
| Control Space Asset | 12 | Persuasion | Loyalty |
| Sabotage Facilities | 12 | Espionage | Security |
| Enthrall Org | 10 | Persuasion | Science |
| Hostile Takeover | 10 | Administration | Administration |
| Coup d'Etat | 8 | Command | Command |
| Detain Councilor | 8 | Investigation | Security |
| Extract Councilor | 8 | Command | Security |
| Sabotage/Steal Project | 6 | Espionage | Security |
| Dominate Nation | 6 | Persuasion | — |
| Sabotage Hab Module | 4 | Espionage | Security |
| Assault Alien Asset | 4 | Command | Command |
| **Purge** | **3** | Espionage | Administration |
| Enthrall Elites | 2 | Persuasion | Science |
| **Crackdown** | **0** | Investigation | Administration |

### 4a.4 This corrects a v2 design assumption

`docs/directive-engine-v2.md` frames Investigate → Turn as the cheap zero-hate offensive. **Turn is hate-cheap, not cheap.** Base difficulty 15 stacks on top of the target's Loyalty, so:

| Our Persuasion | Target Loyalty | diff | Success |
| --- | --- | --- | --- |
| 25 | 5 | 25 − 20 = 5 | 86% |
| 25 | 12 | 25 − 27 = −2 | 30% |
| 25 | 17 | 25 − 32 = −7 | **8.4%** |
| 15 | 10 | 15 − 25 = −10 | **3.9%** |

### Measured against the live campaign

Enemy attribute medians across all **36** enemy councilors (omniscient mode, so these are real values, not assumptions):

| Attribute | Median | Mean | Range |
| --- | --- | --- | --- |
| Loyalty | **11** | 9.3 | 0–20 |
| Administration | **14** | 16.0 | 6–25 |
| Security | 8 | 8.1 | 0–22 |
| Espionage | 7 | 8.5 | 1–19 |
| Science | 4 | 5.1 | 0–17 |
| Command | 5 | 5.1 | 1–14 |

Turn against a median target: defence is `11 Loyalty + 15 base = 26`.

| Our Persuasion | diff | Turn success |
| --- | --- | --- |
| 15 | −11 | **3.0%** |
| 20 | −6 | **10.8%** |
| 25 *(our best)* | −1 | **38.8%** |

Crackdown against a median target: defence is `14 Administration + 0 base = 14`.

| Our Investigation | diff | Crackdown success |
| --- | --- | --- |
| 15 | +1 | 61.3% |
| 20 | +6 | **89.2%** |
| 25 | +11 | **97.0%** |

### The conclusion inverts the design

Expected faction hate, which then proxy-shares to the aliens at the same 1/8–1/4 either way:

| | Success | Expected hate | Outcome on success |
| --- | --- | --- | --- |
| **Turn** (Pers 25) | 38.8% | `0.612 × 3` = **1.84** | councilor turned |
| **Crackdown** (Inv 20) | 89.2% | `0.892 × 2` = **1.78** | control point taken |

**Crackdown costs the same hate and lands 2.3× as often.** The v2 design frames Investigate → Turn as the escalate-late answer; against campaign-typical targets it is strictly worse than the Crackdown it was meant to replace. Turn only earns its place against a genuinely low-Loyalty target — the tail of that 0–20 range, not the median.

So the engine must rank on **expected** value. A 3% Turn is not a recommendation; it is a way to spend a councilor-turn and generate hate for nothing. This is the strongest argument for pulling V2-6 into the spine, and it is also why V2-3's pairing matters: *which* councilor runs Turn changes it from 3% to 38.8%.

### 4a.5 What we can and cannot compute

`ResourceSpent` appears on **all 29** contested missions — the bonus spend converts resources into offence points, which is the mechanism the plan already flagged as making `cost.amount` unfillable without odds. It is also the lever the recommendation should expose: *"this reaches 70% at N Influence."*

But the modifier catalogue is large: ~33 distinct attack modifiers and ~48 defence modifiers. Most are situational and not in the snapshot (`UnhappyElites`, `Warlords`, `RegionPopulationDensity`, `PherocyteResistance`…).

The templates carry only bare `$type` markers with **no coefficients**, which initially looked like a hard wall.

**It isn't — the formulas are documented.** `Module:MissionLister/Modifier/data` (rev **2026-02-17**, post-1.0) holds a description of every modifier with exact exponents. The module says why they are hand-maintained: *"There is no convenient JSON or EN file to refer to."*

Computable **today** from fields the snapshot already carries:

| Modifier | Formula | Source field |
| --- | --- | --- |
| `TargetNationGDP` | `(GDP in Billions) ^ 0.33333334` | `nation.GDP` |
| `NationPopulation` | `(population in Millions) ^ 0.4` | `nation.population` |
| `NationCohesion` | raw cohesion | `nation.cohesion` |
| `NationUnrest` | raw unrest | `nation.unrest` |
| `FlatModifier` | flat base difficulty | template |
| `CouncilorAttack/DefendStat` | attribute value | `resolvedAttributes` |
| `NationalRivalries` | `0.33333334 × our CPs in rival nations` | `controlPoints` + relations |

Needs data not currently surfaced, but plausibly in the save:

| Modifier | Formula | Missing |
| --- | --- | --- |
| `Defender/AttackerPopulationIdeology` | `(10 + democracy) × public-opinion fraction` | per-nation public opinion by faction |
| `AttackerAllyControlPoints` | `6 × fraction of allies' CPs we own` | alliance graph |
| `AttackerAdjacentControlPoints` | `6 × fraction of neighbours' CPs we own` | nation adjacency |
| `ResourceSpent` | "scales logarithmically with amount spent" | the curve's constants |

### Do not ship the bare core

A naive `attack − defence − base` is **systematically biased optimistic for missions with no defender attribute** — and those are exactly the expansion actions the engine most wants to recommend. Control Nation, Public Campaign, Stabilize Nation and Dominate Nation have no defending councilor; their entire difficulty lives in these modifiers.

Measured on the live save, Control Nation's defence is `(GDP_Bn)^(1/3)`:

| Target | GDP | Defence | Persuasion 4 | Persuasion 5 |
| --- | --- | --- | --- | --- |
| Malawi | $72.0Bn | 4.16 | **48.0%** *(bare core: 82.0%)* | **59.6%** *(86.0%)* |
| Honduras | $70.8Bn | 4.14 | 48.3% *(82.0%)* | 59.9% *(86.0%)* |
| Namibia | $39.8Bn | 3.41 | 56.9% *(82.0%)* | 66.6% *(86.0%)* |

The bare core calls a Persuasion-4 councilor an 82% bet on Malawi. It is a coin flip. Implement the documented per-modifier formulas for at least the GDP, population, cohesion and unrest terms — together they cover the no-defender missions.

Residual uncertainty from still-unmodelled terms is reported as a band with the excluded modifiers named — the same discipline the hate model uses for its ±20% roll.

In player mode the defender's attribute is masked. Per §0a, **estimate rather than abstain**: assume a campaign-typical value for that attribute, compute the odds, and label the assumption. *"~30%, assuming average Loyalty for an unscouted councilor"* is a usable recommendation; `unknown` is not.

Investigate Councilor remains valuable for exactly this reason — it converts an assumed defence into a measured one, which narrows the estimate rather than creating it.

**Calibration source for the assumed values:** omniscient mode on the live save exposes every enemy attribute, so campaign-typical distributions can be measured directly rather than guessed. Do that once and bake the medians in as the assumption, with a note that they are campaign-derived.

---

## 5. Phases

Each phase is independently shippable and leaves the engine working.

### V2-0 — Green baseline `S`
Fix the two failing Turn tests to assert the hate *band*. Agree file ownership with the concurrent session.

### V2-1 — Mission catalogue `M`
Template load → `buildMissionSpecs()` → `missionCatalogue.js`. Generic `candidates/missions.js` replaces the per-family generators by iterating MissionSpec × targets.
**Ships:** board goes ~11 → ~60 candidates on the live save.
**Test:** every generated candidate traces to a real `dataName`; hate values match the template rows (extend the existing `missionHateTable.test.js` guard to the whole catalogue).

### V2-2 — Feasibility `M`
The four high-frequency evaluators plus `unknown` for the tail. Needs councilor `locationType`/`locationRegionId` for range, which the snapshot already carries.
**Ships:** the ~60 drop to the genuinely available subset, each rejection naming its condition.
**Test:** a councilor in orbit cannot be offered an `EarthOnly` mission; an unimplemented condition yields `unknown`, never `pass`.

### V2-3 — Pairing `M`
`candidate × councilor`, attribute matching only, no probabilities. Uses `resolvedAttributes.effective` for ours, `maskedAttributes` for theirs.
**Ships:** every recommendation names *who runs it* — the single biggest legibility gain before the allocator exists.
**Test:** the highest-Persuasion councilor is paired to Persuasion missions; masked enemy stats degrade the pairing to `unknown`, not to zero.

### V2-4 — Portfolio budgets `S`
Move hate/Influence/Ops/Money from per-candidate to set-level consumption.
**Ships:** fixes the real v1 flaw — five candidates each individually "within budget" can no longer be recommended together.
**Test:** three affordable candidates whose sum exceeds the pool produce a plan containing at most what fits, and say what was displaced.

### V2-5 — Assignment `L`
Greedy by expected value with local swaps, one mission per councilor, subject to V2-4's pools. `cyclePlan` in the output; board renders assignments.
**Ships:** the reframe. Output stops being a list and becomes a plan.
**Test:** two candidates needing the same councilor cannot both appear; the displaced one is `benched` with `displacedBy` set; unfilled slots are reported.

### V2-6 — Odds `M` — **promote to run alongside V2-3**
The formula is known and verified (§4a.1), and base difficulty is in the templates, so this is smaller than originally sized and more urgent than originally placed.

`chance(diff)` with the **documented per-modifier formulas** (§4a.5), not the bare attribute difference — the bare version is badly wrong for every no-defender mission. Rendered as a band with unmodelled modifiers named.

**Ships:** expected value becomes real; `cost.amount` becomes answerable as *"reaches 70% at N Influence"*; Turn's true hate cost `P(fail) × 3` resolves V2-0's test tension.
**Why it moved:** §4a.4 — without odds the engine will confidently recommend a 5%-success Turn that costs ~2.8 expected hate, i.e. worse than the Crackdown it was meant to replace. Ranking on hate alone is actively wrong once base difficulty is in view.
**Degrades:** player mode masks the defender's attribute → `unknown`, not a number. 21 Automatic missions need no odds at all (§4a.2).

### V2-7 — Clocks `M`
`clocks.js`: deadlines, decay, accrual, ramps. Urgency as a multiplier on value, never a standalone score.
**Ships:** advice changes between saves, not only between board states.
**Test:** a candidate near its deadline outranks an identical one that is not; a stale sighting decays rather than persisting.

### V2-8 — Denial value `M`
Opponent trajectories: Build Facility totality + abduction accrual, surveillance countdown, human war thresholds.
**Ships:** scoring what an action *prevents*, not only what it gains.
**Blocked on:** per-region abduction counts, currently unsurfaced (`TIRegionState` is collected but not exposed).

### V2-9 — Chains `S`
`requires`/`enables`; an enabler inherits a discounted share of what it unlocks; multi-cycle horizon in the plan.
**Ships:** replaces v1's hardcoded `investigate: 3 / turn: 6` with derived valuation.

### V2-10 — Non-mission families `L`
`build.js`, `research.js`, `fleet.js`. MC-costing builds finally give the permanent-war MC veto something to bind against.
**Ships:** the twelve `policyRank` constants can be deleted — this is the precondition P5 of the v1 plan named and never had.

---

## 6. Sequencing

```
V2-0 → V2-1 → V2-2 → V2-3 ─┬─ V2-6 (odds) ─┬→ V2-5 (assignment)
                           └─ V2-4 (budgets)┘
              V2-7, V2-8, V2-9 (independent, any order after V2-5)
                        V2-10 → delete policyRanks
```

**V2-6 moved into the spine.** Originally an optional deepening; §4a.4 shows the engine is actively wrong without it, because ranking on hate cost alone prefers a 5%-success Turn over a Crackdown that is both easier and cheaper in expectation.

V2-0 through V2-6 is the minimum coherent v2. Everything after deepens it.

---

## 7. Not regressing

- **v1 output shape is preserved.** `primary`, `alternatives`, `rejected`, `uncertain`, `futureOpportunities`, `decisionReasoning` all stay; `cyclePlan` is added. The board renders the new key when present.
- **Legacy directives stay until V2-10.** Deleting the ranks before build/research/fleet generators exist drops `sp-1`, `sp-2` and `res-1..3` with no successor.
- **Snapshot size is measured at V2-1**, before anything depends on it.
- **The hosted worker must keep working.** Nothing may read templates at request time; `missionSpecs` rides the snapshot or the feature does not ship.
- Existing tests stay green at every phase. They are the contract.

---

## 8. Risks

| Risk | Mitigation |
| --- | --- |
| **Concurrent session** editing the same files | Agree ownership before V2-1. Highest-probability failure here, and it is organisational, not technical |
| ~~Odds formula unavailable~~ | **Resolved** — found and verified 13/13 against the wiki table (§4a.1). Residual risk is the ~48 unmodelled defence modifiers, handled by reporting a band and naming what was excluded |
| `Roll` page predates 1.0 by two days | Corroborated in prose by the post-1.0 `Missions` page; marked `estimateClass: 'calculated'`, never `'exact'` (§4a.1) |
| ~~Snapshot bloat from `missionSpecs`~~ | **Resolved** — measured at 12.8 KB raw / 1.8 KB gzipped (§4.4). Excluded from strategic history as static data |
| Older published snapshots lack `missionSpecs` | Engine degrades to v1 generators and says the catalogue is unavailable (§4.5) — never throws |
| 60 candidates becomes noise | The allocator is the answer — 6 assignments, the rest benched with reasons. Do not ship V2-1 breadth without V2-2 feasibility |
| Assignment feels arbitrary | Every assignment carries `why` and `opportunityCost`; benched candidates name what displaced them |
| Scope drift into an autoplayer | Non-goal is unchanged: recommend and explain, never sequence a turn automatically |

---

## 9. First commit

V2-0 plus §4 in full:

1. Fix the two Turn tests to assert the hate band (V2-0).
2. `templateLoader` loads `TIMissionTemplate.json` into `templates.missions` — **not** into `REQUIRED_TEMPLATES` (§4.2).
3. `buildMissionSpecs()` in `snapshotBuilder`, explicit zeros for hate (§4.3).
4. `intelligenceFilter` passes it through at both `shipHullStats` call sites (§4.5).
5. `buildWorld({ missionSpecs })`, degrading cleanly when absent.
6. Exclude from `strategicSnapshot.mjs`.
7. Tests per §4.7, including the payload ceiling.

No behaviour change — the board renders identically. It only makes the catalogue available, which every later phase needs. That makes it safe to land even while ownership of the engine files is still being sorted out.
