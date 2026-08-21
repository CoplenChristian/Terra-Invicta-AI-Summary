# Directive Engine v2 — Design

v1 turns a snapshot into a ranked list of independent actions. v2 turns it into **an allocated plan for the cycle**, drawn from the whole action space, priced against shared budgets, and re-ranked by what is about to expire.

Written 2026-08-20. Builds on `docs/archive/directive-rule-engine-plan.md`; that document's hate ladder, three-outcome vetoes, and provenance discipline carry forward unchanged.

Four structural changes, in order of how much they change the output:

| # | Change | Why it matters |
| --- | --- | --- |
| 1 | **Cycle allocation** — assign councilors to missions, don't rank actions | Councilor-turns are the real scarce resource, and nothing models them |
| 2 | **Full action catalogue** — 4 missions → ~30 | The dashboard cannot suggest what it cannot generate |
| 3 | **Odds** — `P(success)` from attacker vs defender stat | Expected value is unstateable without it; so is Turn's hate cost |
| 4 | **Clocks** — deadlines, decay, accrual rates | This is what makes advice change between saves rather than between board states |

---

## 1. The action catalogue

`TIMissionTemplate` carries **50 missions**: 21 EarthOnly, 24 Unlimited, 5 SpaceOnly. v1 generates 4. The catalogue below is the generation target, with the gating data each needs.

**Zero-hate actions are far more plentiful than the v1 plan assumed.** This matters because escalate-late doctrine is "attack along an axis that doesn't spend hate", and there are ~20 such axes, not three:

| Mission | Attack | Cost | Target | Generation gate |
| --- | --- | --- | --- | --- |
| Control Nation (`GainInfluence`) | Persuasion | Influence | Nation | ✅ v1 |
| Investigate Councilor | Investigation | Ops | Councilor | ✅ v1 |
| Turn Councilor | Persuasion | Influence | Councilor | ✅ v1, preconditions unparsed |
| **Public Campaign** (`Propaganda`) | Persuasion | Money | Nation | nation ideology alignment |
| **Stabilize Nation** | Command | Ops | Nation | `unrest > 0` |
| **Increase Unrest** | Command | Ops | Region | enemy-held region |
| **Set National Policy** | — | Influence | Nation | executive control + policy list |
| **Enthrall Unaligned Elites** | Persuasion | Influence | Nation | unaligned elite count |
| **Enthrall Public** | Persuasion | Influence | Region | region ideology |
| **Investigate Alien Activity** | — | Ops | AlienActivity | detected activity list |
| **Surveil Location** | — | **free** | Region/Fleet/Hab | always available |
| **Protect Councilor** | — | **free** | Region/Councilor/Hab | own councilor at risk |
| **Go To Ground** | — | **free** | Region | own councilor exposed |
| **Advise** | — | Influence | Nation/Hab | — |
| **Inspire Councilor** | Persuasion | Influence | Councilor | own councilor XP |
| **Contact Councilor** | — | Influence | Councilor | trade/diplomacy |
| **Pass Technology** | — | Influence | Councilor | ally + tech delta |
| **Sabotage Hab Module** | Espionage | Ops | EnemyHabModule | **0/0 hate** — free strike on enemy space |
| **Defend Interests** | — | **20 Influence flat** | Nation/Fleet/Hab | expiry clock (§4) |

Three of these cost **no resource at all** — Surveil Location, Protect Councilor, Go To Ground. An engine that never suggests a free action is leaving councilor-turns on the table.

Hate-bearing missions, priced by the existing ladder (`slot4/slot5`):

| Mission | Hate | Attack | Target |
| --- | --- | --- | --- |
| Crackdown | 2/0 | Investigation | OwnedControlPoint |
| Purge | 5/5 | Espionage | OwnedControlPoint |
| Enthrall Org | 3/3 | Persuasion | Org |
| Enthrall Elites | 5/5 | Persuasion | OwnedControlPoint |
| Coup d'Etat | 5/5 | Command | Nation |
| Dominate Nation | 5/5 | Persuasion | Nation |
| Detain Councilor | 2/3 (**10/0 vs alien**) | Investigation | Councilor |
| Assassinate | 10/0 | Espionage | Councilor |
| Extract Councilor | 1/1 | Command | Councilor |
| Hostile Takeover | 2/2 | Administration | Org |
| Sabotage/Steal Project | 3/0 | Espionage | EnemyProjectLocation |
| Sabotage Facilities | 3/0 | Espionage | SpaceFacility |
| Control Space Asset | 7/7 | Persuasion (vs **Loyalty**) | Ship/Hab |
| Seize Space Asset | 10/10 | Command | Ship/Hab |
| Assault Alien Asset | 10/10 | Command | AlienAsset |

Excluded deliberately: the 7 victory missions (`Close the Gate`, `Trigger the Weapon`, …) — they are endgame triggers, not cycle decisions — plus alien-only actions (`Abductions`, `Xenoform`, `Build Facility`, `Grant Alien Control`).

**Non-mission action families**, which the legacy `policyRank` directives cover and the engine must before P5 can delete them:

- **Build** — ship/hab/module orders. Each carries an MC cost, and MC is the sole input to the hate floor, so a build *is* a diplomacy decision (Notion 03 per-hull MC; Notion 10's quadratic mine-limit penalty `Max(1, Floor(excess²/2))`).
- **Research** — project/tech selection with schedulability. Notion 06 flags Nanotube Armor as the interesting case: high value, availability rises 5%/month to a 35% cap, so "start waiting now" is the advice a rank list cannot express.
- **Economy** — priority sliders, resource transfers, trade.
- **Fleet** — intercept, transfer, split, defend. Notion 02: intercepting cheap surveillance craft prevents the abduction snowball.

---

## 2. The cycle model — allocate, don't rank

**The central change.** You have ~6 councilors and each takes one mission per cycle. A ranked list of 30 candidates does not tell you what to do; an assignment of 6 councilors to 6 missions does.

```
candidates × councilors  ->  feasible (councilor meets the mission's requirements)
                         ->  expectedValue(candidate, councilor)     // §3
                         ->  assignment maximising Σ value
                             subject to: 1 mission per councilor
                                         shared hate budget            // §5
                                         shared resource budgets
```

This is an assignment problem. With ~6 actors and a few hundred pairings, a greedy pass with local swaps is sufficient — no solver needed, and it stays explainable, which matters more here than optimality.

Three things fall out of it that v1 cannot express:

- **Recommendations become interdependent.** Putting the 25-Persuasion councilor on Control Nation changes what to do with the rest of the council. That interdependence *is* the dynamism the current engine lacks.
- **Opportunity cost becomes real.** A candidate's true cost is the best alternative use of that councilor, not its Influence price.
- **Idle councilors stop being a scoring heuristic** and become an unfilled slot in the assignment — which is a fact, not a judgement.

Output shape becomes a **cycle plan**:

```
{ assignments: [{ councilor, mission, target, expectedValue, why }],
  unassigned: [{ councilor, reason }],
  benched:    [{ candidate, displacedBy }],
  budgets:    { hate: {...}, influence: {...}, ops: {...}, money: {...} } }
```

---

## 3. Odds

Every contested mission resolves attacker attribute vs defender attribute. Both sides are already in the snapshot — `resolvedAttributes.effective` for ours, `maskedAttributes` for theirs.

```
expectedValue = P(success) × value
              − P(fail) × failureCost
              − expectedHate × costWeight        // expectedHate = Σ P(outcome) × hate[outcome]
```

This is not optional polish. Three things are unstateable without it:

- **Turn's hate cost is `P(fail) × 3`** — zero on success, 3 on the two failure slots.
- **Bonus-cost missions.** Crackdown, Purge, Turn and most others are `TIMissionCost_Bonus`: the player *chooses* the spend, and the spend buys success chance. `cost.amount` can only ever be `null` without an odds model, which is where v1 leaves it.
- **Failure is sometimes the whole cost.** Notion 09: Control Space Asset failure detains the councilor and grants six months of "defended" status — and against an undocked ship, *kills* the councilor.

The exact roll formula is not in the templates, so P(success) is `estimateClass: 'calculated'` at best and must render as a band. What *is* exact and worth using immediately: the attacker/defender attribute pairing, which tells you which councilor should run which mission even without a probability.

---

## 4. Clocks — the dynamism layer

v1 re-ranks only when the board changes. Real advice changes because **time passes**. Four clock types:

| Type | Instances | Effect on score |
| --- | --- | --- |
| **Deadline** | Defend Interests expiry; alien surveillance completing in 192 days; Total War year gate; project completion; transfer windows | Urgency multiplier rising as the deadline nears |
| **Accrual** | Abductions → 15/region unlocks Build Facility; alien passive hate accelerating ~4.2/yr and rising ~0.4/yr² | Denial value rising as the threshold nears |
| **Decay** | `seenByFactionIds` staleness; "defended" status expiry; Detain release | Confidence falling; candidate expiring |
| **Ramp** | Project availability climbing 5%/month to a cap (Nanotube Armor) | "Start the wait" becomes the action |

The alien passive-hate curve is the sharpest one, because it is *known* and *accelerating*. Wiki `Diplomacy` § Alien Passive Hate gives per-faction rates and both deadlines: for the Initiative on Normal, **Hate Start year 19, War Start year 38**. That converts "hate is at 44.89" into "hate is at 44.89 and gaining ~4/yr with nothing spent" — which is a completely different recommendation.

Urgency is a multiplier on value, not a separate score, so a low-value action never leads purely because it is expiring.

---

## 5. Budgets are shared, not per-candidate

**A real flaw in v1's model, not just a gap.** `hate/total-war-budget` checks each candidate against headroom *independently*. Five candidates each "within budget" can collectively blow it — and the engine will happily recommend all five.

Budgets are consumed by the **set**:

```
Σ expectedHate(assignment) ≤ totalWarHeadroom × safetyMargin
Σ influence(assignment)    ≤ influence stock
Σ ops(assignment)          ≤ ops stock
Σ missionControl(builds)   ≤ min(MC capacity, mcWarFloor − usedMC)
```

That last line is the permanent-war constraint finally having something to constrain — §2.1 of the v1 plan calls it "a first-class, loud constraint" and nothing in v1 generates an MC-spending action for it to bind.

Budget pressure also produces genuinely new advice: *"these three actions fit; the fourth needs 12 more Influence or costs you the Malawi grab."*

---

## 6. Denial value

Every candidate is currently scored on what it gains. Half of Terra Invicta is what it **prevents**, and the opponent's trajectory is partly known:

- **Build Facility** needs the Servants or aliens to hold *every* CP in a nation **and** ≥15 regional abductions. Both are countable. A CP grab that breaks totality, or an Assault Alien Asset that removes 20% of a region's abductions (40% on critical), has denial value proportional to how close that threshold is.
- **Surveillance** completing in 192 days converts to permanent passive abductions once the aliens found surveillance *habs* (earliest year 9/11/13 on Normal, per Notion 08). Intercepting before that is worth more than after.
- **Human rivals** approach their own war thresholds (22.2–100, wiki table). Denying a rival's expansion has value; so does not tipping them over.

`denialValue = P(threshold reached without us) × cost(threshold reached) × P(this action prevents it)`

All three terms are estimable from data already in the snapshot, and this is where the engine stops being a to-do list and starts being strategy.

---

## 7. Chains

Investigate → Turn is one instance of a general pattern. Candidates declare `requires` and `enables`:

```
{ id: 'turn:councilor-7', requires: ['intel:secrets:councilor-7', 'spy-slot'],
  enables: ['assassinate:councilor-7', 'faction-intel:the-Protectorate'] }
```

Two consequences:

- **An enabler inherits a discounted share of what it unlocks.** Investigate is worth more when a high-value Turn sits behind it than when it does not — which is exactly the reasoning v1 hardcodes as `investigate: 3, turn: 6`.
- **The plan spans cycles.** "Investigate this cycle, Turn next" is a two-step recommendation with a stated payoff, not two unconnected suggestions.

Chains also make preconditions productive: rather than discounting Turn for an unparsable spy slot, the engine can surface *the action that resolves it*.

---

## 8. Architecture deltas

| Layer | v1 | v2 |
| --- | --- | --- |
| World | flat snapshot facts | + clocks, opponent trajectories, budget pools |
| Candidates | 3 generators | ~10 generators (mission families + build/research/economy/fleet) |
| Pairing | — | candidate × councilor feasibility + odds |
| Rules | 8 rules, per-candidate | + portfolio rules over the assignment set |
| Selection | `max(score)` | assignment maximising Σ expectedValue under shared budgets |
| Output | primary + lists | cycle plan + primary + lists |

Everything that carries forward: three-outcome vetoes, `absent stays null`, rules-as-data with `source` + `estimateClass`, and a primary that is always a constructive action.

---

## 9. Data gaps, honestly

Not blockers for the whole of v2, but each bounds a specific piece:

| Gap | Bounds |
| --- | --- |
| Spy slots, per-councilor intel depth | Turn generation stays conditional |
| Roll formula / difficulty curve | P(success) is a band, not a number |
| Enemy attributes masked in player mode | Odds vs human targets degrade to `unknown` |
| Human faction hate toward us (over-redacted by `intelligenceFilter`) | Human war-threshold denial value |
| CP capacity vs maintenance economy (10× discrepancy) | "Can we hold it" gating |
| Alien Progression Speed unparsed | Every year-gated clock assumes the default slider |
| Abduction counts per region not surfaced | Build Facility denial value |

The pattern worth keeping: each gap degrades one term to `unknown` and says so, rather than degrading the whole recommendation to silence.

---

## 10. Phases

| Phase | Deliverable | Unblocks |
| --- | --- | --- |
| **V2-1** | Mission catalogue generator — data-driven from `TIMissionTemplate` rather than one function per family | The breadth ask, immediately |
| **V2-2** | Candidate × councilor pairing + attribute matching (no probabilities yet) | "Who should run this" |
| **V2-3** | Portfolio budgets over the assignment set | Fixes the independent-budget flaw |
| **V2-4** | Assignment selection + cycle plan output | The core reframe |
| **V2-5** | Clocks: deadlines, decay, accrual, ramps | The dynamism ask |
| **V2-6** | Odds model, rendered as bands | Bonus costs, Turn's real cost |
| **V2-7** | Denial value + opponent trajectories | Strategy rather than a to-do list |
| **V2-8** | Chains and multi-cycle plans | Enabler valuation |
| **V2-9** | Build/research/economy/fleet generators → retire the twelve `policyRank` constants | P5 of the v1 plan |

V2-1 alone would take the board from 11 candidates to roughly 60 on the live save. V2-4 is the change that makes it feel like a different product.

---

## 11. Non-goals, unchanged

- Not an autoplayer — it recommends and explains.
- Not a combat simulator. Fleet actions are scored on strategic effect, not tactical resolution.
- Not a replacement for Notion 14's `/api/intel/mission-planner` — the candidate × councilor pairing **is** that payload, and should be exposed as it.
