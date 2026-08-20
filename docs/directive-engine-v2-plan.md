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

## 4b. The cycle plan — assignment contract

The payoff phase, and everything else is scaffolding for it. Specified here to the same depth as §4 because it was previously three sentences.

### 4b.1 The unit is a pairing, not a candidate

```js
{
  candidateId, councilorId,
  missionType, target,
  feasibility: 'pass' | 'unknown',      // 'fail' pairings are never built
  odds: { chance, band: [low, high], basis, assumed, automatic },
  expectedValue,                         // see 4b.3
  expectedHate,
  cost: { resource, amount, kind },
  opportunityCost,                       // see 4b.4
  why: [ { ruleId, reason } ]
}
```

A pairing is generated for every (surviving candidate × own councilor) combination the feasibility layer does not reject. With ~6 councilors and ~60 candidates that is ~360 pairings — trivial to score exhaustively, so no pruning heuristic is needed and none should be added.

**Who counts as an assignable councilor:** own faction, not detained. A detained councilor has no mission slot at all — this is the same `status === 'detained'` check `councilorAttributes.mjs` already uses to zero org bonuses, and it should share that helper rather than re-implement it.

### 4b.2 Expected value

```
expectedValue = P(success) × candidateValue
              − P(failure) × failureCost
              − expectedHate × hateWeight
              − resourceCost
```

`expectedHate` is an outcome-weighted sum, not the success-slot figure:

```
expectedHate = P(success) × successHate + P(failure) × failureHate
```

This is the term that makes Turn behave correctly. Turn costs 0 on success and 3 on failure, so **its expected cost rises as its odds fall** — a success-slot reading would rank a 3% Turn as free, which is exactly backwards.

For an `Automatic` mission, `P(success) = 1` and the whole expression collapses to `value − successHate × hateWeight − resourceCost`. Half the catalogue takes that path (§4a.2).

### 4b.3 Selection

Greedy over expected value with a fixed tie-break, then a local-swap pass:

```
1. Build all feasible pairings, score each.
2. Sort by expectedValue desc; tie-break on councilorId asc for determinism.
3. Walk the sorted list, taking a pairing when BOTH its councilor and its
   candidate are still unclaimed, and the shared budgets still admit it (§4b.5).
4. Local swap: for each pair of assignments, test whether exchanging their
   councilors raises the total. Repeat until no swap improves. Bounded at
   N² per pass and N is ~6.
```

Greedy plus swaps is not guaranteed optimal. That is accepted deliberately — with six actors the gap is small, and an explainable assignment is worth more here than an optimal one nobody can interrogate. **The tie-break must be deterministic** so the same save produces the same plan twice; a plan that reshuffles on reload reads as broken regardless of quality.

### 4b.4 Opportunity cost

For each assignment, `opportunityCost` = the expected value that councilor would have contributed on their *next-best unclaimed* candidate. It is what makes the plan legible: *"Beth on Investigate Alien Activity, giving up Control Nation in Malawi worth 5.5."*

A **negative** opportunity cost is a signal, not an error — it means this councilor had nothing else worth doing, which is itself worth surfacing.

### 4b.5 Budgets bind the set, not the member

The flaw §5 of the design names. Before accepting a pairing in step 3:

```
runningHate      + expectedHate(pairing)  <= totalWarHeadroom × safetyMargin
runningInfluence + influenceCost(pairing) <= influence stock
runningOps       + opsCost(pairing)       <= operations stock
runningMoney     + moneyCost(pairing)     <= money stock
```

A pairing that breaches a pool is **skipped, not vetoed** — the councilor stays available for a cheaper candidate later in the walk. Record it in `budgetDisplaced` with which pool it exceeded and by how much, because *"the fourth action needs 12 more Influence"* is a genuinely useful sentence.

Bonus-cost missions have no fixed amount, so until V2-6 gives a spend→odds curve, treat them as consuming a configurable nominal amount rather than zero. Consuming zero would let the plan recommend six bonus-cost missions on an empty treasury.

### 4b.6 Unassigned councilors

A councilor with no assignment is an **unfilled slot** — a fact, not a scored penalty. v1 treated idleness as a heuristic value adjustment; that conflates "we chose to hold this councilor back" with "we ran out of ideas".

Each unassigned councilor reports one of:

| Reason | Meaning |
| --- | --- |
| `no-feasible-candidate` | every candidate failed feasibility for this councilor |
| `all-candidates-claimed` | better fits took everything |
| `budget-exhausted` | feasible and unclaimed candidates existed, but no pool could pay |

And in every case the plan should offer the **free actions** — Surveil Location, Protect Councilor, Go To Ground cost no resource and no hate (§4a). An idle slot with a free action available is a planning failure, not a legitimate output.

### 4b.7 Output

```js
cyclePlan: {
  assignments: [Pairing],            // ordered by expectedValue desc
  unassigned:  [{ councilorId, name, reason, suggestedFreeAction }],
  benched:     [{ candidateId, title, displacedBy, margin }],
  budgetDisplaced: [{ candidateId, pool, shortfall }],
  budgets:     { hate: {...}, influence: {...}, ops: {...}, money: {...} },
  totalExpectedValue
}
```

`primary` stays what it is today — the single headline action — and should simply be `assignments[0]`, so the board's headline and the council orders cannot disagree with each other.

### 4b.8 Tests

- Two candidates needing the same councilor: only one is assigned; the other is `benched` with `displacedBy` and a positive `margin`.
- A detained councilor is never assigned.
- Three affordable candidates whose costs sum past a pool: the plan contains what fits, and `budgetDisplaced` names the pool and shortfall.
- Turn's expected hate **rises** as odds fall — the outcome-weighted sum, not the success slot.
- An `Automatic` mission scores without invoking the roll formula at all.
- The same world produces byte-identical plans across two runs (determinism).
- A councilor with no feasible candidate appears in `unassigned` with a `suggestedFreeAction`, never silently dropped.
- `assignments[0]` and `primary` are the same action.

---

## 4b-bis. Persistent assignments — a wrong assumption in §4b

§4b assumes one mission per councilor **per cycle**, with every councilor free again next cycle. That is false for 10 of the 43 missions, and the engine currently acts on the false version.

### The engine is blind to what councilors are already doing

`councilor.activeMissionName` is in the snapshot. **Nothing in `server/engine/` or `directiveEngine.js` reads it.**

Measured on the live save:

| Councilor | Currently doing |
| --- | --- |
| Hemaraj Pavanaja | **Advise** |
| Mahangeet Pakimor | **Advise** |
| Ngoc Thy Nguyen | **Advise** |
| Brad Lester | **Advise** |
| Beth Hofmann | Inspire |
| Balgovind Manandhar | (prior: Investigate Alien Activity) |

The cycle plan reports "6 ASSIGNED" and hands all six new missions. **Four of those six are being told to abandon an active, ongoing Advise** — and the plan never says so. This is not a gap in coverage; it is confidently bad advice, and it is the most consequential defect found in the engine so far.

### `permanentAssignment` missions

| Mission | Persistent effect |
| --- | --- |
| **Advise** | yes |
| **Surveil Location** | yes |
| **Protect Councilor** | yes |
| Control Nation | no |
| Investigate Councilor | no |
| Public Campaign | no |
| Stabilize Nation | no |
| Increase Unrest | no |
| Go To Ground | no |
| Assault Alien Asset | no |

Note **Control Nation and Investigate Councilor are on this list** — the engine's top-ranked expansion action and the Investigate→Turn enabler. So this is not an edge case confined to Advise.

The three with `persistentEffect: true` are the sharpest: their benefit exists *only while the councilor remains assigned*. Reassigning ends the benefit.

### What the assignment model must change

1. **Read `activeMissionName`.** A councilor on a permanent assignment is not free capacity.
2. **Model reassignment as a cost, not a neutral move.** For a persistent-effect mission the cost is the benefit destroyed — for Advise, the IP the nation loses (§4d).
3. **Recommending the mission a councilor is already running is a no-op**, and should render as "continue", not as a new order.
4. **`unavailable[]` needs a third category** beyond detained: *committed to a persistent assignment*. Different from `unassigned` — these councilors are working, not idle.

---

## 4d. Advise — the calculation

Verified. Wiki `Nations` (rev **2026-05-17**, post-1.0), plus the mission template.

**Advise applies three attributes at once**, and it works on habs as well as nations. From the rendered `Advise` page, which the `MissionList` template generates from game data:

> *Applies the Acting Councilor's Administration, Science, and Command Attributes to the Target in the form of bonuses **for the rest of the turn**.*

| Target | Administration | Science | Command |
| --- | --- | --- | --- |
| **Nation** | +(Adm)% to **IP production** | +(Sci)% to **Research output** | +(Cmd / 100) to **Miltech** |
| **Hab** | +(Adm)% to Money, Water, Volatiles, Metals, Noble Metals and Fissiles | +(Sci)% to **Research output** | +(Cmd)% to Marine Assault Combat Value |

> *Multiple Advisors on the same target give diminishing returns, with the **x-th advisor giving only 1/x** of their bonus.*

The Administration→IP half is corroborated on the `Nations` page (rev 2026-05-17), which also gives the IP base it multiplies:

```
base IP = (GDP in billions)^0.35
        × (1 − max(unrest − 2, 0) / 10)
        − 0.5 × navies − 0.5 × idle armies at home − 1.0 × other armies
```

Because the bonuses are re-applied per turn while the councilor stays assigned, and all three land at once, a single Advise assignment is simultaneously an economic, research and military decision.

Mission properties: `Automatic` resolution (never fails, no odds needed), **10 Influence flat**, zero hate on every outcome, `permanentAssignment: true`, `persistentEffect: true`, and it requires a control point in the target nation (`ScannableObjectWithMyControlPoints`).

Measured on the live save — we hold a CP in 6 nations, and our Administration values are 25, 25, 25, 24, 24, 11:

| Nation | Base IP | With one Admin-25 advisor |
| --- | --- | --- |
| United States | 34.38 | **42.97** (+8.59) |
| European Union | 26.95 | 33.69 (+6.74) |
| Mexico | 16.63 | 20.79 (+4.16) |
| Canada | 16.22 | 20.27 (+4.05) |
| Poland | 13.82 | 17.28 (+3.46) |

Stacking three Admin-25 advisors on the United States: +25%, then +12.5%, then +8.3% → IP 34.38 → 42.97 → 47.27 → 50.14. The second advisor is worth half the first; judge each against what that councilor could do elsewhere.

### The research term is the larger one

Our council's attributes pull in different directions, which makes *who advises where* a real optimisation rather than a formality:

| Councilor | Adm | Sci | Cmd | Currently |
| --- | --- | --- | --- | --- |
| Brad Lester | 25 | **13** | 5 | Advise |
| Beth Hofmann | 24 | 7 | 1 | Inspire |
| Mahangeet Pakimor | 25 | 6 | 0 | Advise |
| Ngoc Thy Nguyen | 25 | 4 | **18** | Advise |
| Hemaraj Pavanaja | 24 | 2 | 4 | Advise |
| Balgovind Manandhar | 11 | 1 | 5 | — |

Research across the six nations we can advise totals **2,318.9**, of which the United States alone is **1,317.6**.

**Brad Lester (Science 13) advising the United States yields +171.3 research** — set against a faction output of roughly 2,000, that single placement is worth more than most research decisions the dashboard currently surfaces.

Note the misallocation risk this creates. Ngoc Thy Nguyen has Command 18 and Science 4; Brad Lester has Science 13 and Command 5. Swapping which nation each advises changes the research yield by a wide margin while the Administration term barely moves, since all three of our top advisors sit at 24–25 Administration. **The Administration term is nearly flat across our council; the Science and Command terms are not.** That is where the optimisation lives.

**Every input is already in the snapshot** — `nation.GDP`, `nation.unrest`, `nation.research`, `nation.armies`, and our councilors' effective Administration, Science and Command. No new parsing needed.

### Why this belongs in the engine

Advise is the clearest case of an action the current model cannot value: hate-free, cannot fail, fixed 10 Influence, and it pays out across three separate axes at once, every turn, for as long as the councilor stays on it.

Ranking it by the generic value rules would badly understate it. And the engine's first job is narrower than valuing it well — four councilors are already running Advise, and it must stop telling them to stop.

The plan states `score = value − hateCost − resourceCost` and puts the weights in config, but never says how you know the weights are sane. v1 demonstrated the failure: council candidates scored 0 until value rules were added, and afterwards Turn at 9.00 against a control point at 5.52 was an unexamined guess.

**Calibration is a review step with a stated procedure, not a feeling.**

1. **Cross-family comparability.** Dump the top 10 candidates per family against a real save. If one family sweeps the top 10, either that family really is dominant right now — which the posture should explain — or its weights are miscalibrated. Say which.
2. **Anchor pairs.** Pick two actions whose relative worth is not in dispute and assert the ordering in a test. For example: taking a $70Bn control point should outrank investigating a councilor; converting an unused alien-tracking capability into sightings should outrank a marginal expansion while the fleet cannot absorb retaliation. These are judgement, but they are *reviewable* judgement, and a regression flips them visibly.
3. **Sensitivity.** Halve and double each weight; if the top recommendation never changes, the weight is inert and should be removed rather than kept as decoration. If it changes constantly, it is doing too much work alone.
4. **Posture response.** The same save at low hate and near Total War must produce materially different plans. If it does not, the hate ladder is not reaching the objective function.

Record the calibration run's output in the repo alongside the weights, so a later change can be diffed against what the numbers used to look like.

---

## 4e. Implementing Advise and persistent assignments

How to build §4b-bis and §4d. Specified at §4b's depth because it changes the assignment model rather than adding a generator to it.

### 4e.1 The data, and its two states

`snapshotBuilder` already resolves current missions — `missionsById` maps a mission's `targetId` through regions, nations and habs to a `targetName`. So `activeMissionName` and `activeMissionTarget` populate correctly **while a mission is in flight**.

Between mission phases they degrade:

| State | `activeMissionName` | `activeMissionTarget` |
| --- | --- | --- |
| Mission in flight | `"Advise"` | `"United States of America"` |
| Between phases | `"Prior: GainInfluence"` | `null` |
| Never assigned | `"Idle / Standby"` | `null` |

**`"Prior: X"` means the councilor finished X, not that they are doing X.** Reading it as a current assignment would be worse than reading nothing. Parse the prefix explicitly rather than substring-matching the mission name.

Consequence: current-assignment awareness is **best-effort, not guaranteed**. Design for the null case from the start — when the target is unknown the engine knows *that* a councilor is committed but not *to what*, and must say so rather than assuming a target.

### 4e.2 The hard part: comparing a stream to a one-shot

Advise pays **every turn, for as long as the councilor stays on it**. Control Nation pays **once**. The objective function has no horizon term, so these are not commensurable today — and naively summing them favours whichever the weights happen to flatter.

Options, in preference order:

1. **A stated horizon.** Value a persistent assignment as `perTurnBenefit × HORIZON_TURNS`, with `HORIZON_TURNS` in the weights config and marked `heuristic`. Crude, explicit, reviewable.
2. **Payback framing.** Report "this Control Nation is worth N turns of Brad's Advise" and let the operator judge. Avoids inventing a horizon, at the cost of not producing a single ranking.
3. Discounted stream. More defensible in theory; adds a discount rate that is just as invented as the horizon and harder to explain.

**Recommend option 1 with option 2 rendered alongside** — the horizon drives the ranking, the payback sentence makes the trade legible. Do not ship the comparison without one of them; an unstated horizon is a hidden weight.

### 4e.3 Value model

Three axes land at once (§4d). They need a common currency, and research is the most legible:

```
advisorBonus(councilor, target, n) =
  research :  target.research   × (Sci / n) / 100
  ip       :  baseIP(target)    × (Adm / n) / 100     // nations
  miltech  :                      (Cmd / n) / 100     // nations, flat
  outputs  :  each hab output   × (Adm / n) / 100     // habs
```

`n` is this councilor's ordinal among advisors **on that target**, so it needs a count of who else is advising it — which comes from §4e.1 and is unavailable when targets are null. With `n` unknown, assume `n = 1` and **label the assumption**: that is the optimistic bound and must not read as measured.

`baseIP` is in §4d; nation `research` is already on the snapshot.

**Do not sum the three axes into one number without stating the exchange rate.** IP, research and miltech are different units. Either convert explicitly through named weights, or rank on research and report the other two as context.

### 4e.4 Candidate generation

- One candidate per (advisable target × our councilor), where advisable means we hold a control point in the nation (`ScannableObjectWithMyControlPoints`) or it is our hab.
- Targets are **nations and habs** — `TIMissionTarget_NationHab`. Habs are ungenerated by any v2 family today; this is the first.
- Automatic resolution, so no odds. Fixed 10 Influence. Zero hate on every outcome.
- Skip targets already saturated with advisors when the marginal `1/n` falls below a configurable floor — the fourth advisor on one nation is rarely the best use of a councilor.

### 4e.5 Continue, reassign, or start

Three distinct outcomes, and the UI must distinguish them:

| Case | Render as | Cost |
| --- | --- | --- |
| Best pick equals current assignment | **Continue** — not a new order | none |
| Best pick differs, current is persistent-effect | **Reassign**, stating what is destroyed | the ongoing benefit lost |
| Councilor is free | **New order** | none |

A "continue" must not consume a cycle slot as though it were a fresh decision, and must not inflate an "N assigned" headline as if the operator needs to act on it.

For the reassign case, say it out loud: *"Moving Brad Lester off Advise (United States) costs −171.3 research/turn."* That sentence is the entire point of the feature.

### 4e.6 Roster categories

§4b.6's `unavailable[]` currently means detained. Split it:

- `detained` — no mission slot at all
- `committed` — on a persistent assignment; working, not idle, not free capacity
- `assignable` — genuinely available this cycle

`committed` councilors still appear in the plan, showing what they are doing and what moving them would cost. Hiding them would recreate the bug where five of six councilors vanished.

### 4e.7 Phasing

| Step | Deliverable | Risk |
| --- | --- | --- |
| **A** | Read `activeMissionName` / `activeMissionTarget`; parse the `"Prior: "` prefix; add the `committed` category | Low — pure read, no scoring change |
| **B** | Stop recommending a councilor off a persistent assignment without pricing it; render `continue` | **Medium — the defect fix; ship this first if only one step ships** |
| **C** | Advise candidates for nations | Low |
| **D** | Advise value model, research axis first | Medium — needs §4e.2 resolved |
| **E** | Hab targets | Low |
| **F** | Diminishing-returns `n` from live advisor counts | Low, gated on §4e.1 data being present |

**Step B is the priority.** C–F make Advise a first-class recommendation; B stops the engine recommending a councilor abandon one. Fixing bad advice outranks adding good advice.

### 4e.8 Tests

- `"Prior: GainInfluence"` is not read as currently running Control Nation.
- A councilor on a persistent assignment appears as `committed`, never as idle capacity.
- Best-pick-equals-current renders `continue` and does not consume a cycle slot.
- Reassigning off a persistent-effect mission carries a non-zero, non-null cost naming what is lost.
- With `activeMissionTarget` null, `n` defaults to 1 **and the candidate is labelled assumed**.
- Advise value scales with the *councilor's* Science, not a constant — Science 13 and Science 2 on the same target must differ materially.
- The three axes are never summed without a stated exchange rate.

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

### V2-3 — Pairing + odds `L` — **merged with the former V2-6**

Originally two phases: pairing with attribute matching only, then probabilities later. That seam does not survive promoting odds into the spine — building pairings without odds means building `expectedValue` twice, and the intermediate version would rank a 3% Turn alongside an 89% Crackdown.

Build the pairing contract from §4b.1 with odds included from the start:

- `candidate × councilor` for every feasible combination (~360 on a live save — score them all, no pruning).
- `chance(diff)` using the **documented per-modifier formulas** of §4a.5, not the bare attribute difference. GDP, population, cohesion and unrest at minimum, since those carry the no-defender missions.
- `expectedHate` as the outcome-weighted sum (§4b.2), which is what makes Turn's cost rise as its odds fall.
- Masked enemy attributes get a campaign-calibrated assumption and a label, per §0a — never an abstention.

**Ships:** every recommendation names *who runs it and how likely it is*. Biggest single legibility gain in the plan.
**Test:** the highest-Persuasion councilor pairs to Persuasion missions; a Persuasion-4 councilor on Malawi reads ~48%, not 82%; an Automatic mission never invokes the roll; masked stats produce a labelled assumption rather than a zero.

### V2-4 — Portfolio budgets `S`
Move hate/Influence/Ops/Money from per-candidate to set-level consumption.
**Ships:** fixes the real v1 flaw — five candidates each individually "within budget" can no longer be recommended together.
**Test:** three affordable candidates whose sum exceeds the pool produce a plan containing at most what fits, and say what was displaced.

### V2-5 — Assignment `L` — **the payoff phase**
Implement §4b in full: greedy selection with local swaps, one mission per councilor, budgets binding the set, opportunity cost on every assignment, and unassigned councilors reporting a reason plus a free action.

**Ships:** the reframe. Output stops being a list and becomes a plan, and `assignments[0]` becomes `primary` so the headline cannot disagree with the council orders.
**Test:** §4b.8 in full — determinism included, since a plan that reshuffles on reload reads as broken regardless of quality.

### V2-6 — Calibration `S`
Run §4c's four checks against a real save, fix whatever they expose, and commit the calibration output next to the weights so later changes can be diffed against it.

**Ships:** confidence that the scores mean something. Cheap, and it is the only phase that tells you whether the previous five produced good advice or merely consistent advice.
**Why it is a phase and not a chore:** v1 shipped with council candidates scoring 0 against expansion candidates scoring 5.5, and nothing caught it because nothing was looking.

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
V2-0 → V2-1 → V2-2 → V2-3 (pairing + odds) ─┐
                              V2-4 (budgets)─┴→ V2-5 (assignment) → V2-6 (calibration)
                     V2-7, V2-8, V2-9 (independent, any order after V2-5)
                                      V2-10 → delete policyRanks
```

**V2-0 through V2-6 is the minimum coherent v2.** Everything after deepens it.

Two reorderings from the first draft, both driven by findings rather than preference:

- **Odds merged into V2-3 rather than deferred.** Building pairings without odds means building `expectedValue` twice, and the intermediate version ranks a 3% Turn beside an 89% Crackdown. §4a.4 shows that is not a rough edge — it is the wrong recommendation, made confidently.
- **Calibration became a phase.** It was implicit, which is how v1 shipped with one family scoring zero against another scoring 5.5 and nothing noticing.

### Data gaps, mapped to the phase they bind

Listed in §9 but never sequenced. Each either blocks a phase or degrades one, and the difference matters:

| Gap | Phase | Effect |
| --- | --- | --- |
| Spy slots, per-councilor intel depth | V2-3 | **Degrades** — Turn stays a conditional recommendation naming its own unverified preconditions |
| Public opinion by faction | V2-3 | **Degrades** — the two `PopulationIdeology` modifiers drop out of the odds; band widens, estimate survives |
| Alliance graph, nation adjacency | V2-3 | **Degrades** — the two `ControlPoints` attack modifiers drop out |
| `ResourceSpent` curve constants | V2-3 | **Degrades** — bonus-cost `amount` stays null; §4b.5 charges a nominal figure so an empty treasury cannot fund six missions |
| Abduction counts per region | V2-8 | **Blocks** — Build Facility denial value cannot be computed at all |
| CP capacity vs maintenance economy | V2-10 | **Blocks** — "can we hold it" gating on expansion |
| Alien Progression Speed | V2-7 | **Degrades** — year-gated clocks assume the default slider and say so |

Only two gaps genuinely block, and both sit in later phases. **Nothing blocks V2-1 through V2-6.** That is the case for starting.

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

**Partly landed already, and not deliberately.** A concurrent session's commit `09cb74e` absorbed in-progress edits to `templateLoader`, `snapshotBuilder` and `intelligenceFilter` that implement most of §4. That is the §8 concurrency risk happening rather than being anticipated.

So step one is an audit, not a build:

1. **Verify what actually landed.** Does `missionSpecs` reach the snapshot in both modes? Is the count right (43 after disabled and victory rows)? Is `successHate` an explicit `0` rather than `null` (§4.3)? Does it pass through `intelligenceFilter` at **both** call sites — the two differ in indentation and an earlier pass caught only one?
2. Add the §4.7 tests, which were never written.
3. Exclude from `strategicSnapshot.mjs` — almost certainly not done.
4. Confirm it degrades cleanly when absent, since the hosted site serves snapshots published before the field existed.
5. Fix the two Turn tests to assert the hate band (V2-0).

Then V2-2 onward as specified.

**Before any of that, settle ownership.** V2-3 restructures `directiveEngine.js` into `server/engine/*`, and the other session has been actively editing that file. §8 lists this as the highest-probability failure and it has already occurred once. It is the only genuine blocker in the plan, and it is organisational rather than technical.
