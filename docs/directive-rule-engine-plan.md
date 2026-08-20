# Directive Rule & Hierarchy Engine — Plan

Replace the hand-ranked directive list in `server/briefingGenerator.js` with a rule engine that always recommends a concrete action, explains what it rejected, and prices everything against a hate budget.

**Status:** proposed. Written 2026-08-19, condensed 2026-08-20 after a critique against all 17 Notion pages.

All mechanics below are verified against `StreamingAssets/Templates` or the official wiki (raw wikitext, post-1.0 revisions). Judgement calls are marked `ASSUMPTION`.

---

## 1. The problem

Twelve hand-picked `policyRank` constants, none with a stated justification, sorted by rank then severity. Three consequences:

1. **The headline can be a negative.** When a proxy offensive is vetoed, `geo-hold` (rank 100) wins and the dashboard reads *"Hold proxy offensive vs the Servants in Japan."* Nothing structurally guarantees the primary is an action — it holds only because someone tuned the ranks so it does.
2. **Ranks are unanchored.** Adding a rule means guessing a number that doesn't collide with eleven others.
3. **Thresholds are binary.** `escalateLate` is a boolean. The real question is *how much hate can I afford, and what does spending it cost.*

---

## 2. The hate ladder

The central abstraction. Four thresholds, distinguished by **reversibility**.

| Threshold | Value | Crossing it | Reversible? |
| --- | --- | --- | --- |
| Minimum floor | `usedMC × difficultyMult × 0.8^n` | Hate cannot fall below | Only by cutting used MC |
| **War** | **50** | Aliens actively hunt habs, ships, councilors until hate < 50 | Yes — vent below 50 |
| **Total War** | **200** AND ≥N years | Venting severely restricted; effectively permanent | **No** |
| Maximum | `1000 + 100/yr` Normal; `70 + 2/yr` Cinematic | Ceiling | n/a |

Difficulty multipliers 0.05 / 0.30 / 0.60 / 1.00. Total War year gate 25 / 20 / 10 / **0**, divided by Alien Progression Speed. Source: wiki `Diplomacy`, rev 2026-08-11.

**A floor ≥ 50 makes war permanent** — venting can't reach peace because the floor pins you above the threshold. `mcWarFloor` already computes where that happens (~166.7 MC on Normal, no concealment; 208 / 260 / 325 with one / two / three projects). This appears nowhere in the directive flow today.

**Hate spending is not fungible.** `ASSUMPTION` — weights encode recoverable / expensive / irreversible, and are tunable config, not derived:

```
costWeight = 1×  stays below 50
             3×  crosses 50      (starts an asset hunt)
            10×  crosses 200     (irreversible)
             ∞   floor reaches 50 (permanent war)
```

The 3× needs a **counterparty credit**: Notion 02 and 07 both treat selective asset sacrifice as a real lever, so a pure penalty means the model never deliberately crosses 50 when it should.

**Three pieces are genuinely missing from `alienHateEconomics`:** ventability models only Total War (Notion 07 needs all three conditions — not at Total War, not Trespassing, actually targeted); the min>max clamp; and the fact that on Cinematic the maximum gates Total War, so the rungs interact.

---

## 3. Architecture

```
World model  ->  Candidates  ->  Rules (veto + score)  ->  Selection
   (facts)      (what we could)    (what we shouldn't,      (what we
                                    what it's worth)         recommend)
```

**World model** — one frozen object: hate (incl. `hateConfidence`), fleet, resources, council, earth, campaign. Absent stays null; no `?? 0`.

**Candidates** — concrete, not prose: `{ missionType, target, actor, cost, hate, value }`. Mission costs come from templates and are currently thrown away — every directive says `UNAVAILABLE`, but Defend Interests is a flat **20 Influence**.

**Rules** — plain data objects carrying a `source` citation *and* an estimate class (exact / calculated / heuristic), per Notion 16. Two kinds: vetoes and scores.

**Selection** — `candidates → vetoes → scored → primary = max(surviving)`. The primary is always drawn from survivors; that's the structural fix for §1.1. If everything is vetoed, an explicit `no-safe-action` directive says so.

**A veto has three outcomes, not two.** `pass` / `veto` / `unknown`. This is the default path, not an edge case: in player mode true hate is redacted, so hate rules are unevaluable unless they work from the 5-diamond meter — which Notion 07 warns is a *different number*. `unknown` means the candidate survives but is confidence-downgraded, with a reason naming what couldn't be measured.

**The objective function, stated:**

```
score = value − hateCost − resourceCost
  value        = Σ additive value rules
  hateCost     = expectedHate × costWeight × HATE_POINTS
  resourceCost = spend ÷ stock × RESOURCE_POINTS
```

Value must scale on Notion 09's `output ÷ (GDP_Bn^0.6 / 2)` — CP cost is sublinear in GDP while output splits evenly, so majors are strictly better value. Plus Notion 02's second axis: replacement time.

---

## 4. Council actions

Hate arrays from `TIMissionTemplate` (slot 4 = success, slot 5 = critical).

| Mission | Hate | Attack | Defence | Cost |
| --- | --- | --- | --- | --- |
| Investigate Councilor | `[0,0,0,0,0,0]` | Investigation | Espionage | Ops |
| **Turn Councilor** | `[0,3,3,0,0,0]` | Persuasion | **Loyalty** | Influence |
| Detain | `[0,1,1,0,2,3]` | Investigation | Security | Ops |
| Assassinate | `[0,5,0,0,10,0]` | Espionage | Security | Ops |
| Crackdown | `[0,0,0,0,2,0]` | Investigation | Administration | Influence |
| Purge | `[0,1,1,0,5,5]` | Espionage | Administration | Influence |

**Investigate → Turn is a zero-hate offensive.** Turn costs *nothing* on success; only failure costs 3. Investigate is zero on every outcome. Under escalate-late the answer isn't to stop attacking — it's to attack along an axis that doesn't spend hate. Turn gets relatively *better* exactly when Crackdown and Purge get worse. Rank targets by low Loyalty.

Expected hate for Turn is `P(fail) × 3` — so Turn's cost is unstateable without odds. (This is why "no success-chance calculator" was withdrawn as a non-goal; Notion 09 and 14 both require odds, and a Bonus-cost mission's `amount` is unfillable without them.)

**Blocker:** `HasSpySlot` and `HasIntelOnCouncilorSecrets` are not in the snapshot. `investigationConfidence` is not a substitute — it reports the snapshot *mode*, not per-councilor intel depth.

**Detain vs Assassinate:** on an alien councilor, Detain gives 10 hate on normal success and **0 on critical**, with no retaliation, plus +3 Alien Activity Investigations vs +2. Prefer it wherever available (`DetainTarget` is story-gated). 10 hate is a fifth of the 50 budget — cheap at 12 hate, self-defeating at 45.

### 4a. Open control points

**Control Nation (`GainInfluence`) is hate-free: `[0,0,0,0,0,0]` on every outcome.** Like Investigate→Turn, taking neutral CPs is expansion that costs nothing against the hate budget — the third pillar of "what to do instead" under escalate-late, and the one that matches Notion 02's "expand aggressively".

The data is already there: each nation carries `controlPoints[]` with `factionId: null` / `factionName: "Neutral"`, plus `isExecutive` and `controlPointType`.

**But a naive "open CPs" board would be 91% noise.** Measured on the live save:

| | Count |
| --- | --- |
| Total CPs | 538 |
| Unclaimed | 136 (25%) |
| — of which **Executive** | **124** |
| Genuinely takeable now | **12** |

Notion 09: *Control Nation takes only neutral control points, and the executive CP can only be taken last.* So 124 of the 136 are gated behind holding the rest of their nation. After filtering, the real candidate set is twelve CPs, and they are small: Malawi ($72Bn), Honduras ($71Bn), Madagascar ($70Bn), Namibia ($40Bn), then a tail under $5Bn.

That makes the legality filter the feature, not a footnote. The board should rank the takeable twelve by value-per-CP-cost and say plainly that the remaining 124 are executive-locked — otherwise it reports 136 opportunities that mostly do not exist.

**The capacity gate is not yet computable, and I will not ship a formula that is wrong.** Per wiki `Control Point Capacity` (rev 2026-01-19), capacity comes from each non-detained councilor's Administration + Persuasion + Command, plus Administration Node / Tower / Complex hab modules (+4 / +12 / +30), plus ~9 projects. Summing the observer's six councilors from `resolvedAttributes` gives **232**. But costing the 23 CPs actually held via Notion 09's `(GDP_Bn)^0.6 / 2` gives **2,493** — an order of magnitude apart, so at least one formula is misapplied or the units differ.

The save suggests the mechanic is a maintenance economy rather than a hard ceiling: it carries `controlPointMaintenance`, `controlPointMaintenanceFreebies`, `numControlPoints_unclamped`, and `history_CPCapOverageByDay`. And Crackdown's attack modifiers include `TIMissionModifier_InsufficientCPMaintenance_Defender` — under-maintained CPs are *easier to crack down on*. So overreach has teeth without being forbidden, which is a materially different rule from "you have N slots".

Ships in two parts: the **analysis and legality filter now** (P3), the **"can we hold it" gate once the maintenance model is resolved** (open question 8).

---

## 5. Two intelligence gaps

**Capability is not sighting.** Six alien councilors exist with known locations, and the Initiative *has* detection unlocked (`Project_TheirMovements`). None are visible, because `seenByFactionIds` is empty for all six — which is accurate, not a bug: 38 of 42 human councilors have it populated. So the directive isn't "detain that alien", it's:

> **Capability unlocked, zero sightings.** We can track alien operatives and are tracking none. Convert capability into sightings — Investigate Alien Activity, Surveil Location.

Nothing says this today; `detectedCount: 0` next to an unlocked capability reads as "nothing out there" rather than "we aren't looking."

**Mole-derived faction intel.** `agentForFactionId` exists, null for all 48. `intelligenceFilter` already treats a mole as confirmed intel on that *councilor* but doesn't widen to their faction. Widening is the ask — but scope needs verifying first, since over-revealing silently turns player mode into omniscient mode. It also feeds `classifyProxy`: a mole inside the Servants is exactly the evidence that collapses the 1/8–1/4 share band to a point.

---

## 6. What this changes — Japan, hate 168, strong fleet

Today: *"Hold proxy offensive vs the Servants in Japan."*

After:

> **Turn a Servant councilor — Investigate, then Turn.** No alien hate on success; only failure costs 3. Target the lowest-Loyalty Servant in range.
>
> *Also:* Defend Interests on our own majors (20 Influence, 0 hate). Purge the Academy in China — 20.1T GDP, no proxy share, but **human war cost unmodelled**.
>
> *Rejected:* Crackdown/Purge the Servants in Japan — 32.0 hate from Total War at 200, which venting cannot undo. Purge would add ~0.5–1.5.

---

## 7. Phases

| Phase | Deliverable | Risk |
| --- | --- | --- |
| **P0** | Rename `geo-hold`'s title to name the action, not the prohibition. One line | Low |
| **P1** | World model incl. `hateConfidence`; derive fields that don't exist yet (`mcToPermanentWar`, `estimateOnly`) | Medium |
| **P2** | Ventability (all three conditions) + min>max clamp; war-at-50 pricing with vent credit; permanent-war MC warning | Medium |
| **P2a** | Parse spy slots and per-councilor intel depth, or Turn stays conditional | Medium |
| **P3** | Candidates + mission costs, **with legality filters** (neutral-CP-only, executive-last, Detain gating, total-control checks). Includes the open-CP board — the filter is what makes it useful (§4a) | Medium — largest surface |
| **P3a** | "Capability unlocked, zero sightings" — needs no parsing, only a comparison nobody makes | Low — ship early |
| **P4** | Rule registry + three-outcome vetoes + estimate-class provenance; existing tests must pass | Medium |
| **P5** | Scoring; delete the twelve `policyRank` constants | Medium |
| **P6** | Positive primary guaranteed; "considered and rejected" in UI | Low |

**P5 cannot delete the ranks until P3 covers space, research, and mining.** Otherwise `sp-2` (the fleet directive that *is* escalate-late doctrine), `sp-1`, and `res-1..3` vanish with no successor — and the permanent-war MC veto has nothing to veto, since nothing generates an MC-spending action.

---

## 8. Open questions

1. **Weights are judgement** (§2). Expose as tunable config — yes.
2. **Human war thresholds unmodelled.** Wiki gives the table (22.2–100). `snapshotBuilder` computes the full hate matrix; `intelligenceFilter` keeps only our outbound hate, and per the wiki human hate *is* visible in-game. Over-redacted. Separate workstream.
3. **Alien Progression Speed unparsed.** Year axis assumes the default slider.
4. **What does a mole actually reveal?** (§5)
5. **Are spy slots / intel depth in the save at all?** (§4)
6. **Does `seenByFactionIds` decay?** Stale sightings would generate candidates for operatives who have moved.
7. **Should vetoes be overridable?** A player may knowingly cross 50 for a decisive CP.
8. **Is CP capacity a ceiling or a maintenance economy?** (§4a) Councilor-derived capacity and CP cost are 10× apart, and the save's `controlPointMaintenanceFreebies` / `history_CPCapOverageByDay` / `InsufficientCPMaintenance_Defender` point at upkeep-with-penalty rather than a hard cap. Resolve before gating suggestions on "if they have cap".

---

## 9. Corrections already applied

Two live defects found during review, both fixed:

- **`c3d21bc`** — the Total War veto was inert in player mode (the default). `actualAlienHate` is redacted there, so `totalWarHeadroom` was null and the check fell through to false: at hate 168 with 240 ships, omniscient held and player mode green-lit the offensive. Proximity is now four-valued and `unknown` holds with a reason. Same commit fixed `countShips` counting unscouted alien fleets as zero ships.
- **`b611f74`** — proxy hate shares were wrong. Servants are 1/4 *with* alien contact and 1/8 without; the Protectorate is 1/10 and only with contact. Contact is rarely observable, so the share is a range.

One critique finding did **not** survive checking: that Purging a third party in China advances the Servants toward the total control that unlocks Build Facility. Purge takes the CP *for us* (Notion 09), so it denies totality. The underlying rule — check whether any action moves a faction toward owning a whole nation — is still missing and still needed.

**Flagged, do not build on:** whether Total War *voids* venting (Notion 02, and the code) or merely *restricts* it (wiki); Notion 07's "all five red = Total War", which can't be reconciled with a 200-hate gate; whether executive-last binds Purge; and whether the marked-for-death asset hunt triggers on crossing 50, on assassinating an alien, or both.

---

## 10. Non-goals

- Not an autoplayer. It recommends and explains.
- Not a replacement for Notion 14's `/api/intel/mission-planner` — Layer 2's candidate object *is* that payload. Decide before building.
