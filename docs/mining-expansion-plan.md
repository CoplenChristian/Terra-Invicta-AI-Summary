# Mining Expansion Board — Plan

Answer three questions the dashboard cannot currently answer:

1. **How much mining capacity do I have left?** — mine limit, current usage, and what the next mine costs in Mission Control and therefore in alien hate.
2. **Which sites are open?** — unowned hab sites, filtered to ones we can actually reach.
3. **Which of those are worth taking?** — ranked by resource value against scarcity, reachability and cost.

Written 2026-08-20. Companion to `docs/directive-engine-v2-plan.md`; the candidate/veto/scoring vocabulary is shared, and mining candidates should eventually feed the same cycle plan.

---

## 1. The data already exists

Measured on the live save. `snapshot.habSites` carries **409 sites**:

| | Count |
| --- | --- |
| Total sites | 409 |
| **Unowned** | **298** |
| Owned by someone | 111 |
| Carrying a mine module | 109 |

Per-site fields: `miningProfileName`, `siteDensity`, `parentBodyId/Name`, `spaceTheaterKey/Name`, `factionId`, `habId`, `mineModuleId`, `mineTier`, `constructionStatus`, and per-resource daily rates for `water`, `volatiles`, `metals`, `nobleMetals`, `fissiles`.

So resource yields, ownership and location are all present. **Nothing new needs parsing for questions 2 and 3.** Question 1 needs the mine-limit model (§3).

`shared/intelResources.mjs` already has `miningProspectsResource` with `MINING_SCARCITY_WEIGHTS` (nobles 3.0, fissiles 3.0, volatiles 1.5, water 1.0, metals 1.0) and per-resource percentiles. Extend it rather than starting over.

---

## 2. Reachability is the filter that matters

298 unowned sites is not 298 opportunities — most are unreachable. The board is only useful if it filters to what the player can actually build on today, and says clearly what would unlock the rest.

Two gates, and they are different:

**Destination tech.** The `Mission to X` line — Moon, Mars, Venus, Mercury, the Asteroids, Jupiter, Saturn, the Outer Planets — gates whether a body can be reached at all. Map `parentBodyName` → required mission tech, then check the observer's completed projects.

**Module tech.** A site needs a mine module appropriate to its `miningProfileName`, and those are unlocked by projects (`Project_OutpostMiningComplex`, `Project_ColonyMiningComplex`, `Project_AutomatedMiningComplex`, and so on).

Three buckets, all worth showing:

| Bucket | Meaning |
| --- | --- |
| **Available now** | destination reachable, module unlocked, site unowned |
| **Tech-gated** | site is good, but names the specific missing project |
| **Unreachable** | destination tech not researched |

The tech-gated bucket is the interesting one — *"Ganymede has 47 sites and you need Mission to Jupiter"* is a research priority, not a mining suggestion. It connects this board to the tech tree work already in the codebase.

---

## 3. Capacity: the mine limit is a hate decision

**This is the part that makes the board more than a list.** From Notion 10:

- Mine limit starts at **0**, rises to a maximum of **36** before Future Tech (**42** for Project Exodus) through the mission techs, +6 with Gold Rush.
- Past the limit the Mission Control penalty is **quadratic**: `Max(1, Floor(excess² / 2))`.
- Ten excess mines cost **50 MC** in penalty alone — which on Normal is **+15 alien hate** against a war threshold of 50.

So *"speculative mine seeding converts directly into alien hostility"*. The board must report:

```
minesBuilt / mineLimit
headroom = mineLimit − minesBuilt
if over limit:  penaltyMC = Max(1, Floor(excess² / 2))
                penaltyHate = penaltyMC × difficultyMultiplier × concealmentMultiplier
```

`shared/alienHateEconomics.mjs` already computes the difficulty and concealment multipliers, and `mcWarFloor` gives the used-MC level at which peace becomes impossible. **Reuse those; do not recompute.** A mining board that shows sites without showing the hate cost of taking them is the same mistake as ranking Turn on hate alone.

`shared/strategicSnapshot.mjs` already has `MINE_LIMIT_GRANTS` verified against the templates (7 mission techs = 36, +Gold Rush = 42). Reuse it.

---

## 4. Scoring a candidate

```
siteValue = Σ (resourceRate × scarcityWeight)      // existing MINING_SCARCITY_WEIGHTS
          × siteDensity
          × theaterAccessibility                    // ASSUMPTION, see below
```

Then cost:

```
mcCost      = mine module MC + hab core MC          // from templates via shipHullStats pattern
hateCost    = mcCost × difficultyMultiplier × concealmentMultiplier
buildTime   = module buildTime_Days
overLimit   = would this mine exceed the mine limit, and at what quadratic penalty
```

**Rank on value per unit of hate, not raw yield.** A high-yield site that pushes you over the mine limit can be worth less than a modest one that does not.

`theaterAccessibility` is a judgement call and must be marked `heuristic` — transfer time and defensibility matter (Notion 02: *"a ship that can technically reach a destination is not necessarily strategically mobile"*), but neither is cleanly derivable here. Start with a per-theater constant in config and say so.

**Do not rank the outer system alongside Luna as though they were equivalent.** Notion 11's Mars-redoubt case is the counterexample: sites beyond the inner system may be indefensible, and a site the aliens will take is negative value, not positive.

---

## 5. Backend

New module `server/miningExpansion.js`, pure, consuming the snapshot:

```js
buildMiningExpansion({ habSites, observer, completedProjects, alienHateEconomics, difficulty })
  -> {
       capacity:   { minesBuilt, mineLimit, headroom, overLimit, penaltyMC, penaltyHate, mcWarFloorDistance },
       available:  [ Candidate ],      // reachable + module unlocked + unowned
       techGated:  [ { site, missingProject, siteValue } ],
       unreachable:{ byBody: { Ganymede: 47, ... }, missingTech: { 'Mission to Jupiter': 56 } },
       assumptions: [ ... ]
     }
```

Candidate shape mirrors the directive engine's so these can later feed the cycle plan:

```js
{ id, siteId, displayName, parentBodyName, spaceTheaterName,
  resources: { water, volatiles, metals, nobleMetals, fissiles },
  siteValue, mcCost, hateCost, buildTimeDays,
  wouldExceedMineLimit, provenance: { source, estimateClass } }
```

Expose at `/api/intel/mining-expansion`, alongside the existing `/api/intel/mining-prospects`. Consider whether the older endpoint should be folded into this one rather than kept in parallel.

**Null discipline:** an unowned site with no resource data reports `siteValue: null`, never `0`. A body whose destination tech we cannot determine goes to `unreachable` with the reason stated — not silently to `available`.

---

## 6. Frontend

New card `MINING EXPANSION`, placed in the same column as `MC BUDGET PLANNER` — they answer adjacent questions and share the hate-floor framing.

Three sections:

1. **Capacity header** — `minesBuilt / mineLimit`, headroom, and if over: the quadratic penalty in MC *and* in hate, with distance to `mcWarFloor`. This is the number that should stop a speculative build.
2. **Available now** — ranked table: site, body, theater, top resources, value, MC cost, hate cost, build time. Row click opens the existing detail panel.
3. **Tech-gated** — grouped by the missing project, with a count and the best site value behind each. *"Mission to Jupiter → 56 sites, best value 12.4"* is a research argument, not a mining one.

Follow `mc-budget.js` for the component pattern and reuse the existing CSS tokens. Unreachable bodies collapse to a one-line summary rather than a list — 298 rows is noise, and §2's whole point is that most are not opportunities.

---

## 7. Phases

| Phase | Deliverable | Risk |
| --- | --- | --- |
| **M1** | Capacity model — mine limit, usage, quadratic penalty, hate conversion. Reuses `MINE_LIMIT_GRANTS` and `alienHateEconomics` | Low |
| **M2** | Reachability buckets from completed projects; body → mission-tech map | Medium — the map must come from templates, not be hand-written |
| **M3** | Candidate scoring on the existing scarcity weights | Low |
| **M4** | `/api/intel/mining-expansion` | Low |
| **M5** | Frontend card | Low |
| **M6** | Feed mining candidates into the directive engine's cycle plan as a `space` family | Medium — depends on v2 phases landing |

M1 alone is worth shipping: *"you are at 18 of 36 mines; the next 18 are free, after that each one costs quadratic MC and converts to alien hate"* is actionable on its own.

---

## 8. Open questions

1. **Body → mission-tech mapping.** Derive from templates rather than hardcoding. Which template carries it — `TIHabSiteTemplate`, `TISpaceBodyTemplate`, or the tech tree's own unlocks?
2. **Does an unowned site with `pendingHab: true` mean someone is already building there?** The sample site shows `constructionStatus: "pending-hab"` with `factionId: null`. If it means a rival has broken ground, it must not be listed as available.
3. **`theaterAccessibility`** — start as config, but is transfer time derivable from the existing Δv/fleet data well enough to replace the constant?
4. **Should `/api/intel/mining-prospects` be superseded** or kept alongside? Two endpoints answering overlapping questions is how the v1/v2 frontend split happened.
5. **Defensibility.** Notion 11 says outer-system sites may be indefensible. Is there a usable signal — alien hab proximity, our fleet coverage — or does this stay a stated caveat?
