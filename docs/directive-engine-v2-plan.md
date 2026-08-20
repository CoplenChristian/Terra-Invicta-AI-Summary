# Directive Engine v2 — Implementation Plan

How to build what `docs/directive-engine-v2.md` designs. That document is the *what and why*; this is the *how and in what order*.

Written 2026-08-20 against commit `16050e2`.

---

## 0. Baseline

- `server/directiveEngine.js` — v1, ~1,100 lines, exports `WEIGHTS, RULES, buildWorld, generate*Candidates, applyRules, scoreCandidates, runEngine, buildDecisionReasoning`.
- **216 tests, 2 failing.** Both are `directiveEngine.test.js` asserting Turn's hate is `{low:0, high:0}` while the engine now returns `{low:0, high:3}`. The engine is arguably right — `high` is the failure bound — but the framing "zero-hate on success" and the value `high: 3` are answering different questions. **V2-6 resolves this properly** (`expectedHate = P(fail) × 3`); until then the test should assert the band, not zero. Fix before starting, so v2 begins from green.
- **A concurrent session is editing these files.** Agree ownership before V2-1, or this plan collides.

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

`templateLoader` does not load `TIMissionTemplate`, and the **hosted worker has no template directory at all** — so the engine cannot read templates directly without breaking the deployed site.

Follow the pattern already used for `shipHullStats` and `traitStatMods`: resolve at snapshot-build time, bake into the snapshot, consume downstream.

1. Add `TIMissionTemplate.json` to `templateLoader`.
2. Add `buildMissionSpecs()` to `snapshotBuilder`, emitting `missionSpecs` on the snapshot.
3. `directiveEngine.buildWorld({ missionSpecs })`.
4. Size check: 50 missions × ~15 fields is a few KB — safe for the strategic-snapshot budget, but measure it, since `strategicSnapshot.mjs` exists precisely because payload size bit before.

**This is the single unlock.** Every generator downstream is data-driven once it lands, instead of one hand-written function per family.

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

### V2-6 — Odds `L`
`P(success)` from attacker vs defender, rendered as a band. Resolves Turn's real hate cost and makes bonus-cost `amount` fillable.
**Ships:** expected value becomes real; V2-0's test tension resolves properly.
**Risk:** the roll formula is not in the templates. Ship as `estimateClass: 'calculated'` with a visible band, and if calibration cannot be established, ship the *attribute delta* as an ordinal signal rather than inventing a probability.

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
V2-0 → V2-1 → V2-2 → V2-3 → V2-5 (core spine)
                V2-4 ─────────┘
        V2-6, V2-7, V2-8, V2-9 (independent, any order after V2-3)
                        V2-10 → delete policyRanks
```

V2-1 through V2-5 is the minimum coherent v2. Everything after deepens it.

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
| Odds formula unavailable (V2-6) | Degrade to attribute-delta ordinal; never invent a probability |
| Snapshot bloat from `missionSpecs` | Measure at V2-1; specs are static per campaign, so dedupe like the tech graph if needed |
| 60 candidates becomes noise | The allocator is the answer — 6 assignments, the rest benched with reasons. Do not ship V2-1 breadth without V2-2 feasibility |
| Assignment feels arbitrary | Every assignment carries `why` and `opportunityCost`; benched candidates name what displaced them |
| Scope drift into an autoplayer | Non-goal is unchanged: recommend and explain, never sequence a turn automatically |

---

## 9. First commit

V2-0 plus V2-1 step 1: fix the two Turn tests, add `TIMissionTemplate` to `templateLoader`, add `buildMissionSpecs()` to `snapshotBuilder`, assert the emitted specs against the template rows, and measure the payload delta. Small, verifiable, and it unlocks every phase that follows.
