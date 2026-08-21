# Research Advisor — value the chain, not just the next step

Written 2026-08-21 against `2b6e3d5`.

The advisor scores each project by what **it** unlocks, compared against what the observer
already fields. Two whole classes of good research are invisible to that model: a cheap
gateway project whose payoff is one step further on, and a first-of-its-kind capability
the observer has no equivalent of to compare against.

---

## The motivating example — and the trap that makes it hard

The player's instinct: *"Colony Core is a prereq for Battlestations, which makes my
stations capable of defending themselves."* **This is correct**, and a naive chain walker
gets it wrong.

`Project_Battlestations` has two independent routes:

```
prerequisites            Ring Core (5000) + Layered Defense Array [done] + Visible Combat Lasers [done]
alternatePrerequisites   Colony Core (3000)          <- altPrereq0, a complete alternative
```

Colony Core is **2,000 points cheaper**, is `known: true` and `schedulable: true` right
now, and additionally unlocks Colony Mining Complex, Fission Reactor Farm, Fusion Reactor
Farm, Marine Battalion Barracks, Solar Farm and Spaceworks. It is strictly the better
route, and it is the one the player identified unaided.

**A walker that reads only `prerequisites` returns Ring Core and is wrong.** That was the
first analysis behind this spec, and it produced worse advice than the player's own
intuition — recommending the more expensive route while asserting Colony Core was
irrelevant.

The data is complete and correctly baked: **85 of 899 nodes carry a populated
`alternatePrerequisites`**, matching the 85 of 750 templates with `altPrereq0`.
`shared/techGraph.mjs:290` builds it and `shared/researchAvailability.mjs:248` already
treats a satisfied alternate as clearing the requirement. Nothing needs baking; the chain
walker simply has to use it.

## `altPrereq0` semantics — settled empirically 2026-08-21

Two readings were possible and they disagree. **Measured verdict: `altPrereq0` substitutes
for `prerequisites[0]` only. The remaining prerequisites still bind.**

Evidence, across the live save at campaign date 1/1/2035:

```
discriminating cases (alternate satisfied, a NON-FIRST prereq missing, project not done)
  across all 8 factions ........................................ 102
  of those, maxUnlockChance = 100 (offer is certain once prereq-clear) .. 78
  ever offered (present in that faction's availableProjectNames) ......... 0
```

The unlock roll is monotonic — `initialPercent` rising by `deltaPercent` each month to
`maxPercent`. So a prereq-clear project with a 100% cap is offered with certainty given
enough months, and this campaign has run for years. If a satisfied alternate cleared the
whole prerequisite set, all 78 would have been offered. **None were.**

A weaker earlier test was inconclusive and is recorded here so it is not repeated: scanning
*completed* projects for natural experiments found only two (`Pherocytes`, `Exotics`), and
both have a single prerequisite, where the two readings are identical. `prereqs.slice(1)`
is empty and `[].every()` is trivially true, so they appear to support A by accident.

### This makes `researchAvailability.mjs` a live bug

```js
// shared/researchAvailability.mjs:251-254  -- WRONG
const alternateSatisfied = alternates.some(p => isSatisfied(p?.id) === true);
if (missing.length === 0 || alternateSatisfied) { /* prereq-clear-but-unrolled */ }
```

A satisfied alternate short-circuits the entire prerequisite check. On the observer's own
data this mis-states **5 projects** as `prereq-clear-but-unrolled` when they are
`prereq-blocked` — telling the player they are waiting on a dice roll when they are
actually waiting on research they have not done.

`Project_ResidentialModule` is the clearest: its alternate `SettlementCore` is complete,
but `Project_Quarters` is not, and the game has never offered it.

**Fix both modules from one shared helper.** `researchAvailability.mjs` and
`techGraph.mjs` would otherwise encode these semantics independently and drift — this repo
already carries that scar, where three hand-maintained lists in `shared/intel/registry.mjs`
disagreed until all three were derived from one table.

**Discriminating test, mandatory:** `Project_ResidentialModule` must resolve to
`prereq-blocked`, naming `Project_Quarters` as the missing requirement. It resolves to
`prereq-clear-but-unrolled` today, so the test fails until the semantics are fixed.
Do **not** use `Battlestations` as the discriminating case — its other prerequisites are
already complete, so both readings give the same answer and it would pass either way.

## Gap 0 — `/api/intel/tech-path` is already wrong, and says it is complete

This is a **live defect in a shipped endpoint**, not a missing feature, and it should be
fixed first. Measured against the live save:

```
GET /api/intel/tech-path?observer=4712&mode=player&target=Project_Battlestations

  remainingPath               [ Battlestations, Ring Core ]
  totalRemainingResearchCost  10000
  researchCostComplete        true
  uncostedNodes               []
```

Colony Core (3,000) satisfies Battlestations through `alternatePrerequisites`, so the
cheapest remaining route is **8,000** — Colony Core 3,000 plus Battlestations 5,000. The
endpoint overstates by 2,000 points, never mentions the cheaper route, and asserts
`researchCostComplete: true` with an empty `uncostedNodes`.

A confidently wrong number is worse than an absent one. This endpoint is documented in
`CLAUDE.md` and exposed to external analysis clients, so the wrong figure travels.

**Fix `tech-path` to consider `alternatePrerequisites` before building anything on top of
it.** Every chain feature below inherits its path-finding, so a fix here is load-bearing
for the rest.

## Gap 1 — chains are invisible

`Ring Core` costs 5,000 and unlocks little of direct combat value. Scored alone it is
worthless. It is the only thing standing between the observer and Battlestations, which
unlocks a tier-3 hab module (`crew 75, power -240, 4000 t, 180 days`).

**Measured: `Ring Core`, `Battlestations` and `Colony Core` appear NOWHERE in the
research-ranking payload** — not ranked, not in the unrankable census, not present at all.

The same blindness affects drives, where the payoff is fully computable today.
`refitOntoDrive` can rate a drive the observer has never built against a ship they actually
fly. Measured against `Sankuru` (Battlecruiser, `BurnerDrivex1`, ΔV 16.46 km/s, combat
accel 0.275 m/s²):

```
drive                        steps  chain cost   ΔV km/s   combat accel
Antimatter Microfission        2      15,000       31.59      1.751
Neutronium Microfission        3      32,000       37.44      1.528
Advanced Orion Drive x1        2      75,000       28.62     12.733
Triton Fusor Drive x3          3      90,000       86.82      0.368
Dusty Plasma Drive x3          4      91,000      894.46      0.280

34 researchable locked drives improve BOTH axes. The advisor surfaces none as a chain.
```

The first row is the shape of the whole feature: **two steps and 15,000 points doubles
reach and multiplies combat acceleration by 6.4×.** Neither step is individually rankable
today.

## Gap 2 — a capability you have none of cannot be a multiple

The advisor ranks by an improvement multiple against what the observer fields. Measured
census on the military track:

```
candidates considered  83
ranked                 15
not-comparable         40   <- "no comparison multiple: the observer fields nothing in this class"
no-improvement          9
no-research-required   11
cost-unmeasured         8
```

**40 of 83 are dropped for having nothing to compare against.** That is not a defect in
the ratio model — a ratio genuinely cannot be formed — but it means the single most
valuable kind of research, *a capability you presently lack entirely*, is structurally
unrankable.

Battlestations is exactly this: the observer has no station defence, so there is no
baseline, so it never enters the pool.

**These need a different verdict, not a forced number.** "First capability of its kind —
no baseline to compare against" is honest and actionable. Inventing a multiple against a
zero baseline would be fabrication.

## What exists already

Nothing here needs new game data.

```
techTree.nodes          899 nodes: id, displayName, category, researchCost,
                        researchProgress, prerequisites[], effects[], unlocks[]
techTree.finishedTechsNames + faction.completedProjects   what is done
/api/intel/tech-path    already computes paths, dedupes shared prerequisites,
                        and accounts for current progress in remaining cost
shared/propulsion.mjs   refitOntoDrive rates an unbuilt drive against a fitted ship
shared/unlockIndex.mjs  gateForItem / unlocksForGate map projects to what they unlock
```

The advisor already imports most of this. What is missing is walking the prerequisite
closure and attributing a downstream payoff to the gateway step.

## What to build

**1. Chain-aware candidates.** For each rankable payoff (a drive, weapon, module the
observer could value), walk back through `prerequisites` to the nearest unresearched
ancestors. Emit the **chain** as the candidate: what to research next, how many steps
remain, the summed remaining cost, and the payoff at the end.

Rank on **payoff per point of the whole chain**, not per project. A 15,000-point chain
returning 6.4× acceleration should outrank a 5,000-point project returning 1.2×.

**2. Name the immediate next step.** The actionable instruction is *"research Ring Core"*,
not *"research Battlestations"* — the latter is not startable. Show the next step, the
destination, and the steps between. `docs/research-row-naming-spec.md` applies: use the
real project name, never the item name.

**3. A capability verdict for unrankable-but-new items.** Where `improvementMultiple`
cannot be formed because the observer fields nothing in the class, say **"first capability
of its kind"** and rank those separately. Do not fabricate a multiple, and do not silently
drop 40 candidates.

**4. Drives get their measured payoff.** For a locked drive, run `refitOntoDrive` against
the observer's own fitted ships and report the ΔV and acceleration it would deliver, with
the existing `dryMassCaveat` and the `assumesCurrentFitting` semantics from the refit
advisor. This is the strongest row type available and it is computable today.

## Traps found while measuring

- **`researchCost: -1` is a sentinel**, not a cost. Two nodes carry it and they are alien
  tech the player can never research. Summing it makes a chain *cheaper*. A chain
  containing any unresearchable step has **unknown** cost — never a number.
- **Alien projects are not researchable.** Filter them, or every ranking is topped by
  alien drives the player can never obtain. My first probe returned exactly that.
- **`alternatePrerequisites` is a complete alternative route, not an extra requirement.**
  85 nodes have one. A walker that reads only `prerequisites` overstates cost and can miss
  the cheapest path entirely — for Battlestations it returns Ring Core (5,000) instead of
  Colony Core (3,000). **Where both routes exist, cost the cheaper satisfying route** and
  say which one was chosen, so the player can pick the other if it suits them.
- **Prerequisite closures share ancestors.** Battlestations' closure re-enters the same
  nodes by multiple routes; a naive sum double-counts. `tech-path` already dedupes —
  reuse it rather than writing a second walker.
- **`researchProgress` exists per node.** A partially-researched step costs less than its
  face value; remaining cost must account for it, as `tech-path` already does.
- **Depth must be bounded and reported.** A closure walk needs a depth cap, and if the cap
  truncates a chain that must be visible — truncation announces itself.

## Constraints

- Both modes. Player mode redacts enemy state; the observer's own tech tree is visible.
- **Absent stays null.** An unknown chain cost is `null`, never `0` and never a partial
  sum presented as complete.
- **Do not fabricate a multiple** for a capability with no baseline. An honest "first of
  its kind" beats an invented ratio.
- Nothing campaign-specific — no hardcoded project ids. `docs/research-advisor-spec.md` §0.
- Availability is **rolled, not derived** (§3b): a project whose prerequisites are met may
  still not be offered this month. A chain must not imply the next step is startable now
  unless `availableProjectNames` says so.
- `shared/**` runs in both runtimes.
- Read `docs/code-index.md`; update `Purpose:` lines and run `npm run index`.

## Acceptance

- **`Project_ResidentialModule` resolves to `prereq-blocked`**, naming `Project_Quarters`.
  It is `prereq-clear-but-unrolled` today. This is the semantics pin and it must be
  asserted separately from any Battlestations test, which cannot discriminate.
- Both `researchAvailability.mjs` and `techGraph.mjs` derive alternate-prerequisite
  handling from **one shared helper**; assert they agree on the same node.
- **`/api/intel/tech-path?target=Project_Battlestations` routes through Colony Core, not
  Ring Core.** Assert this **structurally**, never as a hardcoded total:

  ```
  remainingPath names Project_ColonyCore and not Project_RingCore
  routesEvaluated[0].chosenRoute.id === 'Project_ColonyCore'
  routesEvaluated[0].savings > 0
  totalRemainingResearchCost === colonyCoreRemaining + battlestationsRemaining
      where each is (cost * (1 - progressPercent/100)) read from the SAME snapshot
  ```

  An earlier draft of this spec pinned the literal **8,000**, which was correct only while
  Colony Core sat at zero progress. It is `researching` at 5.2% today, so the true figure is
  **7,844** — and a hardcoded 8,000 would fail against a correct implementation. See
  `docs/archive/live-save-test-dependency-spec.md`: derive the expected value from the
  snapshot under test rather than freezing a number that drifts as the campaign advances.
- Where a cheaper alternate exists, the response says **which route it costed** and names
  the other, so the player can choose the more expensive one deliberately.
- The Battlestations chain appears and names **Colony Core (3,000 pts)** as the next step,
  not Ring Core (5,000) — i.e. it follows `alternatePrerequisites` and picks the cheaper
  satisfying route. Battlestations is absent from the payload today, so this cannot pass by
  construction; and a walker that ignores alternates fails it by naming Ring Core, which is
  the specific regression this criterion exists to catch.
- At least one drive chain appears with a measured payoff against a named fitted ship —
  the live save offers 34, of which `Antimatter Microfission` (2 steps, 15,000 pts,
  ΔV 16.46 → 31.59, accel 0.275 → 1.751) is the cheapest.
- Chains rank by payoff per point of the **whole remaining chain**.
- A chain containing an unresearchable step reports cost `unknown`, not a number. Assert
  against an alien-gated drive.
- Items with no comparable baseline get a **capability verdict** rather than being dropped;
  the 40 currently-uncounted military candidates are accounted for.
- Shared prerequisites are counted once.
- Both modes; no `null` / `undefined` / `NaN` rendered; full suite green with exact counts.

## Routing

The closure walk, chain costing and payoff attribution are backend. Rendering is frontend.
The backend half is where the correctness risk sits — particularly the `-1` sentinel and
shared-ancestor deduplication.
