# Directive Rule & Hierarchy Engine — Plan

Replaces the hand-ranked directive list in `server/briefingGenerator.js` with a declarative rule engine that always recommends a concrete action, explains what it rejected and why, and prices every recommendation against a hate budget.

**Status:** proposed, not started. Written 2026-08-19. **Revised 2026-08-19** after a full critique against all 17 Notion knowledge-base pages — see §0.

**Sources.** Every mechanic below is either verified against the installed game templates (`StreamingAssets/Templates`) or against the official wiki read as raw wikitext with a post-1.0 revision date. Wiki citations name the page, section, and revision. Anything unsourced is marked `ASSUMPTION` and is a decision to make, not a fact to rely on.

---

## 0. Revision log — critique findings

The first draft was reviewed against every Notion page. Ten blocking problems and ten significant gaps were raised. Verified outcomes:

### Confirmed and already fixed in code

**The hate ladder was null in the default mode.** `server/index.js` sets `defaultMode: 'player'`, and `alienHateEconomics` redacts true hate in player mode — so `totalWarHeadroom` was null and the Total War veto shipped in PR #5 never fired there. Measured: at hate 168 with a 240-ship fleet, omniscient held and player mode green-lit the offensive. The hold only *appeared* to work on the live save because that fleet is independently fragile.

Fixed in `c3d21bc`. Proximity is now four-valued — `active` / `near` / `clear` / `unknown` — and `unknown` holds with a reason naming what cannot be seen. The 5-diamond meter saturates at ">= 50", so at five diamonds the true figure could be 51 or 199; below five diamonds hate is under 50 and therefore genuinely clear of 150, which still reports `clear`.

**Alien ship counts coerced unknown to zero.** `countShips` used `|| 0` per alien fleet while the own-ship reduce preserved null, so an unscouted alien force read as weak and inverted the fragility check. Fixed in the same commit.

### Confirmed, and this plan is wrong

| Finding | Resolution |
| --- | --- |
| §3.3 has **no value/GDP scoring rule** — `value/majors-over-count` is a flat `+25`, so §4's "20.1T GDP" never enters the arithmetic | §3.3 must score on Notion 09's `output ÷ (GDP_Bn^0.6 / 2)`. See §3.3a |
| §3.3's Total War rule is **`escalateLate` with a new name** — it vetoes any nonzero-hate candidate identically, killing a 0.5-hate Crackdown and a 40-hate assault with the same reason | Must become a budget check, not a predicate on headroom. See §3.3a |
| **Additive scores and multiplicative cost weights are never reconciled.** No stated aggregation function | §2.2's weights and §3.3's `+25` cannot combine as written. See §3.3a |
| §3.1's world model **names fields that do not exist** — `mcToPermanentWar`, `estimateOnly`, `ventable` | P1 is therefore not "no behaviour change"; it is new derivation |
| **"The engine does not need new hate maths" is false.** Ventability models only Total War; Notion 07 requires all three conditions (Total War / Trespassing / actually-targeted). The min>max clamp is also unimplemented | §2 corrected below |
| **No space, research, or mining candidate generators**, so P4's "delete the twelve `policyRank` constants" is a net capability loss — and the `mc-floor` veto has nothing to veto | §5 phases corrected |
| §7's "not a success-chance calculator" **contradicts Notion 09 and 14**, and `cost.amount: null` on a Bonus-cost mission is unfillable without odds | §7 corrected |
| §1.1 **overstates the diagnosis** — `geo-hold`'s `action` field already says "Ward own majors with Defend Interests"; only the `title` is negative. It also omits `geo-3` at rank 75, which is the doctrinally correct directive sitting between the two it compares | §1.1 corrected |

### Raised, but does not survive checking

**"Purge the Academy in China advances the Servants toward total control, unlocking Build Facility."** The Build Facility precondition is real (Notion 08: the Servants or aliens must hold *every* control point). But Notion 09 — and the header of `directiveAdvisor.js` — record that **Purge takes the rival's CP for the purging faction**. The CP transfers to us, so the action *denies* Servant totality rather than enabling it. The finding is inverted.

The rule it points at is still missing and still worth adding: **no candidate should be scored without checking whether it moves any faction toward total control of a nation.** Same rule, opposite sign in this instance.

**"Crackdown → Investigation is unsourced."** Verified against `TIMissionTemplate`: Crackdown's `attackerAttribute` is `Investigation`, Purge's is `Espionage`. The plan was right; it just lacked the citation, now supplied.

### Accepted, not yet actioned

Threat modelling as a faction discriminator (cost is currently monotone in alien-alignment, which steers every offensive at the least alien-aligned target and contradicts Notion 02 on the Protectorate); abduction/surveillance/facility candidates; Detain as sustained suppression with a release cliff rather than a one-shot; defensive-posting counterweight to the idle-councilor rule; Defend Interests expiry; the mine-limit MC budget; alignment with Notion 14's `/api/intel/mission-planner`; and estimate-class provenance in the rule schema. These are folded into §3.3a, §5, and §6.

### Flagged for verification — do not build on

- **Total War: venting *voided* or merely *restricted*?** Notion 02 says "voids venting entirely"; the wiki says "significantly more restrictive"; the code implements a hard block. This is the difference between a ×10 weight and a veto.
- **Notion 07's "all five red = Total War declared"** cannot be reconciled with a 200-hate + years gate. `directiveAdvisor` currently treats 5 pips as war-exceeded, not Total War.
- **Does the executive-last rule bind Purge**, or only Control Nation?
- **Is the marked-for-death asset hunt triggered by crossing 50, by assassinating an alien councilor, or both?** §3.3's ×3 weight currently cites the wrong section for it.

---

## 1. Why change anything

The advisor works, and the Total War hold added in PR #5 does the right thing. But three structural problems are now visible.

### 1.1 The primary recommendation can be a negative

When a proxy offensive is vetoed, `geo-hold` (rank 100) becomes the primary directive, and the dashboard's headline reads *"Hold proxy offensive vs the Servants in Japan."*

**Corrected scope (see §0).** The problem is narrower than the first draft claimed. `geo-hold`'s `action` field already reads *"Ward own majors with Defend Interests (0 template hate) and preserve the fleet"* — the positive action is present, and `geo-3` at rank 75 ("Protect Core Holdings", window "This cycle — first Earth action") is a real, doctrinally correct directive that the first draft skipped when comparing rank 100 against `geo-human` at 70.

So the title is negative while the body is not. Part of this is a one-line title fix, and that should be done immediately rather than waiting on an engine.

The structural argument still stands, though: **nothing guarantees the primary is an action.** Today it holds only because someone hand-tuned twelve ranks so that `geo-hold` outranks everything. Add one rule and that property can silently break. "Don't do the thing you were going to do" is a **constraint on** a recommendation, not a recommendation, and the selection layer should enforce that structurally rather than by arithmetic coincidence.

### 1.2 Priority is twelve unanchored magic numbers

Every `policyRank` in the file, and what justifies it:

| Rank | Directive | Justification in code |
| --- | --- | --- |
| 100 | `geo-hold` | none |
| 95 | `c-mole` | none |
| 90 | `geo-1` Severance | none |
| 85 / 35 | `sp-2` fleet | conditional on `escalateLate` |
| 75 / 40 | `geo-3` | conditional |
| 70 | `geo-human` | none |
| 60 / 45 | `geo-2` | conditional |
| 55 | `res-2` alien ops | none |
| 55 / 50 | `c-idle` | conditional |
| 25 | `geo-1` deferred | none |
| 20 | `sp-1` mining | none |
| 15 | `c-master` | none |

Adding a rule means picking a number that does not collide with eleven others. There is no scale, no unit, and no way to test whether a rank is right.

### 1.3 Thresholds are binary; the real decision is a budget

`escalateLate` is a boolean. But the question a player actually faces is *how much hate can I afford, and what does spending it cost me?* — and the answer differs sharply depending on which threshold the spending eats into.

---

## 2. The hate threshold ladder

This is the central abstraction, and it is what §1.3 is missing. Four thresholds, each with a different cost of crossing.

| Threshold | Value | What crossing does | Reversible? |
| --- | --- | --- | --- |
| **Minimum floor** | `usedMC × difficultyMult × 0.8^n` | Hate cannot fall below it | Only by cutting used MC |
| **War** | **50** | Aliens begin *serious attempts to kill* habs, ships, and councilors, and keep going until hate falls back under 50 | **Yes** — vent below 50 |
| **Total War** | **200** AND ≥N years | Venting becomes "significantly more restrictive"; wiki calls the result "an eternal war" | **No, in practice** |
| **Maximum** | `1000 + 100/yr` (Normal); `70 + 2/yr` (Cinematic) | Ceiling — hate cannot exceed it | n/a |

Sources: wiki `Diplomacy` §§ "Faction Hate", "Alien Hate for Mission Control Usage", "Alien Maximum Hate Amount", "Alien War Threshold", "Alien Total War" — revision 2026-08-11. Difficulty multipliers Cinematic/Normal/Veteran/Brutal = 0.05/0.30/0.60/1.00. Total War year gate = 25/20/10/**0**, divided by Alien Progression Speed.

Most of this table is already computed by `shared/alienHateEconomics.mjs` — `minimumAlienHate`, `warThreshold`, `mcWarFloor`, `totalWar.hateRemaining`, `totalWar.maximumAlienHate`.

**Corrected (see §0): three pieces are genuinely missing, and one of them is load-bearing.**

1. **Ventability is not modelled.** The code has only `ventingBlockedByTotalWar`. Notion 07 requires *all three* conditions: not at Total War, the asset **not Trespassing** (at/beyond Jupiter's orbit, or anywhere the aliens hold a hab, except Earth), and the asset **actually targeted** by the aliens — self-defence kills vent nothing. This is the load-bearing gap: §2.2's ×3 weight for crossing 50 is justified by "you can vent back out", and Notion 11 flags the live case where you cannot — *if the aliens hold a hab at Mars, losing habs at Mars vents nothing at all*, which is exactly the Mars-redoubt scenario.
2. **The min>max clamp is missing.** Notion 07: "Whenever the minimum exceeds the maximum, the maximum is set to the minimum." `buildTotalWarState` implements the 25-year→200 raise but not this.
3. **The thresholds are not independent.** On Cinematic the maximum (70 + 2/yr) sits below 200 for over 25 years, so the maximum itself gates Total War. The ladder above presents four independent rungs; two interact.

Also worth carrying forward rather than recomputing: the MC floor ladder is not one number. Notion 07 gives every rung — zero projects ~**166.7 MC**, one ~**208**, two ~**260**, three ~**325** — and `alienHateEconomics` already tracks `completedReductionProjectCount`, so any warning should quote the applicable rung, not the zero rung.

### 2.1 Two facts the current advisor ignores

**War at 50 is its own cost, not just a waypoint to 200.** Above 50 the aliens actively hunt your assets. PR #5 treats 50 as a status label and only gates hard on Total War proximity. Crossing 50 deliberately — to take a valuable CP — can be correct, but it must be priced as *"this starts an asset-hunting war that costs N ships to vent back out of"*, not waved through.

**A minimum floor at or above 50 makes war permanent.** If `minimumAlienHate ≥ 50`, venting cannot reach peace, because the floor pins hate above the threshold. `mcWarFloor` already gives the used-MC level where this happens. On Normal with no concealment projects that is ~166.7 MC. This deserves to be a first-class, loud constraint — *"you are 12 MC from permanent war"* — and it is currently surfaced nowhere in the directive flow.

### 2.2 Hate spending is not fungible

A point of hate spent at 20 hate and a point spent at 190 are not the same purchase. Proposed weighting:

```
costWeight(hate) =
  1.0                       when the result stays below 50
  3.0                       when the result crosses 50           (starts an asset hunt)
  10.0                      when the result crosses 200          (irreversible)
  +∞ (veto)                 when minimumAlienHate would reach 50 (permanent war)
```

`ASSUMPTION` — the 1.0 / 3.0 / 10.0 weights are judgement, not game data. They encode "recoverable, expensive, irreversible". They must be named as tunable in the output, not presented as derived.

---

## 3. Architecture

Four layers. Each is independently testable, which none of the current logic is.

```
World model  ->  Candidate actions  ->  Rules (veto + score)  ->  Selection
  (facts)          (what we could do)     (what we should not,     (what we
                                           and what it is worth)     recommend)
```

### 3.1 Layer 1 — World model

A single frozen object assembled once per briefing. Mostly existing data, renamed into one place:

```js
{
  hate: {                     // from alienHateEconomics
    actual, minimum, maximum, warThreshold: 50, totalWarThreshold: 200,
    warHeadroom, totalWarHeadroom, mcWarFloor, usedMC, mcToPermanentWar,
    ventable, ventingBlocked, estimateOnly
  },
  fleet:      { ownShips, ownFleets, alienShips, combatPower },
  resources:  { influence, operations, money, boost, income },
  council:    [ { id, name, attributes, status, idle, location } ],
  earth:      { ownCPs, majors, targets: [...], factions: [...] },
  campaign:   { year, yearsElapsed, difficulty, progressionSpeed }
}
```

Provenance rule, already established elsewhere in this codebase: **absent stays null.** No `?? 0`. A rule that cannot evaluate returns `unknown`, never `false`.

### 3.2 Layer 2 — Candidate actions

Concrete, not prose. Enumerated from the world model:

```js
{
  id: 'crackdown:JPN:councilor-7',
  missionType: 'Crackdown',
  target: { kind: 'controlPoint', nation: 'Japan', faction: 'the Servants' },
  actor: { councilorId: 7, attribute: 'Investigation', effective: 18 },
  cost: { resource: 'Influence', amount: null, kind: 'bonus' },
  hate: { toTarget: 2, toAliens: { low: 0.2, high: 0.6 } },
  value: { gdpTrillion: 5.46, cpCount: 3, executive: true }
}
```

Generation is mechanical: every visible proxy CP yields a Crackdown and a Purge candidate; every own major yields a Defend Interests candidate; every idle councilor yields assignment candidates; and so on.

**Mission costs are recoverable and currently thrown away.** `TIMissionTemplate` carries a `cost` object. `Defend Interests` is `TIMissionCost_Flat`, **20 Influence**. `Crackdown`, `Purge` are `TIMissionCost_Bonus` on Influence — the player chooses the spend, which buys success chance. `Sabotage Facilities`, `Assassinate`, `Detain` are Bonus on Operations; `Public Campaign` (dataName `Propaganda`) is Bonus on Money. Today every directive says `missionCost: 'UNAVAILABLE'`, which is wrong for at least the flat-cost missions.

### 3.3 Layer 3 — Rules as data

Two kinds, both plain objects, both carrying provenance.

```js
{
  id: 'hate/total-war-proximity',
  kind: 'veto',
  appliesTo: (c) => c.hate.toAliens.high > 0,
  when: (w) => w.hate.totalWarHeadroom !== null
            && w.hate.totalWarHeadroom < 50,
  because: (w) => `${w.hate.totalWarHeadroom.toFixed(1)} hate from Total War `
                + `at 200, which venting cannot undo`,
  source: 'wiki Diplomacy § Alien Total War, rev 2026-08-11'
}
```

```js
{
  id: 'value/majors-over-count',
  kind: 'score',
  appliesTo: (c) => c.target.kind === 'controlPoint',
  score: (c) => c.value.executive ? +25 : 0,
  because: () => 'majors matter more than nation count',
  source: 'Notion 02 — Strategic Doctrine'
}
```

Starting rule set, all from verified mechanics:

| Rule | Kind | Source |
| --- | --- | --- |
| Total War proximity blocks alien-hate actions | veto | wiki `Diplomacy` § Alien Total War |
| Permanent-war MC floor blocks MC growth | veto | wiki § Alien Hate for MC Usage |
| Fragile fleet + elevated hate blocks proxy offensives | veto | Notion 02 doctrine |
| Crossing 50 costs an asset hunt | score ×3 | wiki § Faction Hate |
| Proxy share prices Servant/Protectorate actions | score | wiki § Pro-Alien Hate Sharing |
| Majors over nation count | score | Notion 02 |
| Detain beats Assassinate on alien councilors | score | wiki § Actions that affect hatred |
| Idle councilor is wasted capacity | score | — `ASSUMPTION` |
| Cannot afford flat mission cost | veto | `TIMissionTemplate.cost` |

`Detain` is worth calling out: on an alien councilor it gives 10 hate on a normal success and **0 on a critical success**, never triggers retaliation, and yields +3 Alien Activity Investigations against +2 for a successful Assassinate. The engine should prefer it wherever it is available. That is a live, sourced preference the current advisor does not express.

### 3.3a Corrections to the rule model

Three things in §3.3 do not survive review.

**The objective function was never stated.** §2.2 defines cost as a multiplier (1.0 / 3.0 / 10.0 / ∞); §3.3 defines value as additive (`+25`); §3.4 says only `primary = max(scored)`. That is not a specification — it replaces twelve magic numbers with an unspecified objective plus four new ones. Proposed, explicitly:

```
score(candidate) = value(candidate) − hateCost(candidate) − resourceCost(candidate)

  value        = Σ additive value rules            (units: "strategic points")
  hateCost     = expectedHate × costWeight(resultingHate) × HATE_POINTS
  resourceCost = spend ÷ stock × RESOURCE_POINTS
```

All three scale constants live in one exported config block, not scattered as literals. §6.1 asked whether weights should be tunable; the answer is yes, and they must also carry an estimate class (below).

**There is no value rule.** The only one is `value/majors-over-count` at a flat `+25`, so a 20.1T-GDP target and a 0.5T one score identically. Notion 09 gives the correct scaling: control-point cost is `(GDP_Bn)^0.6 / 2` while output splits evenly across CPs, so **output per unit of CP cost rises with GDP** — majors are strictly better value, and that is a curve, not a flag. Notion 02 adds a second axis the plan omits entirely: *"Assets should be valued by replacement time, strategic function and future leverage — not sentiment."*

**The Total War rule is still a boolean.** As written it vetoes any candidate with any nonzero alien hate, identically — a 0.5-hate Crackdown and a 40-hate assault die with the same reason string. That is `escalateLate` renamed, and §1.3 was written to kill exactly that. It should be a budget check:

```js
{
  id: 'hate/total-war-budget',
  kind: 'veto',
  when: (w, c) => w.hate.totalWarHeadroom !== null
               && c.hate.toAliens.high > w.hate.totalWarHeadroom * SAFETY_MARGIN,
  unknown: (w) => w.hate.totalWarProximity === 'unknown'   // hold, and say why
}
```

**Missing rules, all sourced.** Threat as a faction discriminator — cost is currently monotone in alien-alignment, so at equal GDP the engine always picks the *least* alien-aligned target, contradicting Notion 02 (*"Protectorate must be treated as a real strategic adversary … capable of suppressing orbital recovery"*). Total-control checks on any CP action (Notion 08: Build Facility needs every CP). A defensive-posting counterweight to the idle-councilor rule (Notion 06: *"Breadth protects; concentration does not"*; Notion 09: Loyalty defends against Control Space Asset and Turn Councilor). Crossing-50 needs a **counterparty credit**, not just a ×3 penalty — Notion 02 and 07 both treat selective asset sacrifice as a real lever, and a pure cost makes the model never deliberately cross 50.

**Rules need an estimate class, not just a citation.** Notion 16 requires every derived value to identify as exact game state, calculation from documented rules, heuristic, or AI inference. `hate/total-war-budget` is a calculation; `value/majors-over-count`'s weight is a heuristic. With only a `source` string both render as equally authoritative. The `ASSUMPTION` markers in this document must exist in the runtime schema.

### 3.4 Layer 4 — Selection

```
candidates
  -> apply vetoes         -> surviving[] + rejected[] + uncertain[]
  -> apply score rules    -> scored[]
  -> primary = max(scored)                       // always an action
  -> alternatives = next 2–3
  -> rejected surfaces as "considered and rejected"
```

**A veto has three outcomes, not two.** The first draft stated the provenance rule — *absent stays null; a rule that cannot evaluate returns `unknown`, never `false`* — and then defined a two-branch pipeline with nowhere for `unknown` to go. An unevaluable veto would either pass the candidate silently (unsafe) or block everything.

This is the default path, not an edge case: in player mode the save's true hate is redacted, so every hate rule is unevaluable unless it can work from the 5-diamond meter. Notion 07 warns the meter is *a different number* — not randomised, drifting from truth, resetting only on specific triggers — so it cannot simply be substituted.

Three outcomes:

| Outcome | Effect |
| --- | --- |
| `pass` | candidate survives, scored normally |
| `veto` | candidate removed, appears under "considered and rejected" with the rule and its citation |
| `unknown` | candidate survives but is **confidence-downgraded**, and the reason names what could not be measured |

The world model carries `hateConfidence: 'exact' | 'estimate' | 'unknown'` alongside the numbers, so a downgrade is a property of the data rather than a special case in each rule. The fix already shipped in `c3d21bc` is the same shape: `totalWarProximity` is four-valued and `unknown` holds with a reason, instead of falling through to safe.

**The primary is always drawn from survivors.** That is the structural fix for §1.1. If every candidate is vetoed, the engine falls back to an explicit `no-safe-action` directive that says so — which is information, not a silent empty state.

Ranking becomes a computed score with a visible breakdown, so §1.2's twelve magic numbers disappear. Categories (`GEOPOLITICAL`, `COUNCIL`, `SPACE`, `RESEARCH`) stay as presentation grouping only.

---

## 4. What this changes for the Japan case

Same save, hate 168, strong fleet.

**Today:** headline *"Hold proxy offensive vs the Servants in Japan."* The `geo-human` alternative is buried at rank 70.

**After:**

> **Ward our own majors — Defend Interests** (20 Influence, flat; 0 template hate).
>
> *Also available:* Purge the Academy in China — 20.1T GDP, executive CP, no proxy alien-hate share. **Human war cost unmodelled** — the Academy's war threshold against us is 24.6 by the wiki table, and we do not currently read their hate toward us.
>
> *Considered and rejected:* Crackdown/Purge the Servants in Japan — 32.0 hate from Total War at 200, which venting cannot undo (wiki `Diplomacy` § Alien Total War, rev 2026-08-11). Purge would add ~0.5–1.5.

**Corrected from the first draft (see §0).** The original headline was "Purge the Academy in China", and that was wrong on two counts the critique caught.

It presented the action's cost as *"Expected alien hate: none"* while §6.2 simultaneously admits human war thresholds are unmodelled. Declaring a total cost of "none" when a known cost component is knowingly missing is precisely what Notion 16 forbids — *"Never serialize lack of intelligence as zero/false."* An unmodelled cost must read as unmodelled.

It also demoted warding our own majors below opening a new human front, which inverts `geo-3` (rank 75) — a directive the current system already gets right, and which Notion 09 backs (*"Strong majors matter more than raw nation count"*) alongside Notion 00's *"Preserve as much military capital as possible."*

One critique finding does **not** stand: that Purging a third party in China advances the Servants toward the total control that unlocks Build Facility. Purge takes the rival's CP *for us* (Notion 09), so it denies totality rather than enabling it. The underlying rule is still missing and still needed — no CP action should be scored without checking whether it moves any faction toward owning a whole nation — but in this instance its sign is favourable.

The structural point is unchanged and is the reason for the whole design: the veto fires, is explained, and is not the recommendation.

---

## 5. Phases

Reordered after review. The first draft put the war-at-50 pricing *last*, which would have shipped a scoring model in P4 whose central cost term did not exist yet.

| Phase | Deliverable | Risk |
| --- | --- | --- |
| **P0** | Rename the `geo-hold` title so it names the action, not the prohibition. One line, no engine | Low |
| **P1** | World model, incl. `hateConfidence` and the fields §3.1 named but that do not exist (`mcToPermanentWar`, `estimateOnly`) | **Medium** — new derivation, not just plumbing |
| **P2** | Ventability (all three Notion 07 conditions) + min>max clamp in `alienHateEconomics`; war-at-50 pricing with its vent counterparty; permanent-war MC warning quoting the applicable rung | Medium |
| **P3** | Candidate generation + mission costs from templates, **with legality filters** — neutral-CP-only, executive-last, Detain story-gating, total-control checks | **Medium** — largest new surface |
| **P4** | Rule registry + three-outcome veto engine + estimate-class provenance; port existing vetoes verbatim; PR #5 and `c3d21bc` tests must still pass | Medium — must not regress |
| **P5** | Scoring with the stated objective function; delete the twelve `policyRank` constants | Medium — ranking shifts; needs before/after review on real saves |
| **P6** | Selection guarantees a positive primary; "considered and rejected" in the UI | Low |

**P5 cannot delete the twelve ranks until the candidate generators exist.** Layer 2 as drafted produces only council and Earth candidates, so `sp-1` (mining), `sp-2` (fleet — whose `escalateLate ? 85 : 35` *is* Notion 02's core doctrine), and `res-1..3` would vanish with no successor. The sharpest version of this: §2.1 calls the permanent-war MC floor "a first-class, loud constraint", and the drafted architecture never generates an action that spends Mission Control, so the veto has nothing to veto. P3 must cover MC-spending actions (Notion 03's per-hull MC; Notion 10's quadratic mine-limit penalty), surveillance interception, `Assault Alien Asset` for abduction reduction, and research scheduling — or the plan's scope must be narrowed to Earth/council and the ranks left alone.

---

## 6. Open questions

1. **Score weights are judgement.** §2.2's 1.0/3.0/10.0 and the value weights are not game-derived. Should they be exposed as a tunable config block rather than constants?
2. **Human war thresholds are unmodelled.** The wiki gives the full table (22.2–100, varying by ideological distance and self-assessment; `Diplomacy` § Human War Threshold, rev 2026-08-11). `snapshotBuilder` already computes the full hate matrix, but `intelligenceFilter` keeps only our outbound hate. Per the wiki, human faction hate *is* visible in the in-game intel page — only alien hate is hidden — so the filter is over-redacting. Fixing it would let the engine warn that a recommended Purge tips a human faction into open war. Separate workstream; large.
3. **Alien Progression Speed is unparsed.** The Total War year axis assumes the default slider and says so. Is it in the save?
4. **Estimate vs truth.** In player mode only the 5-diamond estimate is available, and the wiki notes it is *not* randomised while actual hate is. Should vetoes fire on the estimate, and if so, with what stated margin?
5. **Should vetoes ever be overridable?** A player may knowingly want to cross 50 for a decisive CP. Advisory-with-warning, or hard block?

---

## 7. Non-goals

- Not an autoplayer. It recommends and explains; it does not sequence a turn.
- Not a replacement for Notion 14's `/api/intel/mission-planner`. Layer 2's candidate object is that endpoint's payload; the engine should consume it rather than reimplement it. Decide this before building Layer 2.

**Two non-goals from the first draft are withdrawn (see §0).**

*"Not a mission success-chance calculator"* was wrong. Notion 09 argues for modelling odds *and* payoff — *"calculate the actual payoff of spending Ops/Influence rather than blindly maximizing success chance"* — which is an argument against maximising odds, not against computing them. Notion 14's mission-planner requires them outright. And it is internally inconsistent: §3.2 gives Crackdown/Purge a `TIMissionCost_Bonus` and notes the player's spend *buys success chance*, so `cost.amount: null` can never be filled without an odds model. For some missions failure probability *is* the cost — Notion 09: *"against an undocked ship, failure kills the councilor."*

*"No new hate mathematics"* was also wrong; see the corrected §2. Ventability's three conditions and the min>max clamp are genuinely unimplemented, and ventability is what justifies the war-at-50 weight.
