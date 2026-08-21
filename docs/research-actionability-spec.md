# Research Advisor — Actionability

Ground the research recommendation in what the player can actually do this turn.

Written 2026-08-21 against `669e16e`, revised after two corrections from the player. Every figure is measured from saves; the mechanics were confirmed by the player and one earlier reading of them was wrong (§2b-bis).

---

## 1. What was reported, and what is actually wrong

Reported: *"the suggested research is based more on what can be researched vs what is available for me in the game right now."*

**The availability state is correct** — this was checked and is not the bug. Every row the panel labels `researchable-now` is present in `factions[observer].availableProjectNames`, and none is a project already under way. Phase 1's §3b work holds.

**What is missing is capacity.** Research slots are finite and the advisor does not know they exist.

Measured on the live save:

```
three project slots; researchWeights [0,0,3,3,3,0]

  PherocyteResistance     13,790 / 30,000   3 pips   active
  240cmUVLaserCannon         912 /  7,500   3 pips   active
  AudienceResearch            43 /    100   0 pips   backlog, deliberately
  OperationsResearch          23 /    100   no entry backlog, deliberately

global tech slots (separate pool of three)
  ColonyHabs · AdministrationAlgorithms · Coilguns

payload keys: slotCapacity ABSENT · freeSlots ABSENT · wouldDisplace ABSENT
              currentProjects ABSENT · alreadyResearching ABSENT
```

The panel recommends starting work without knowing any of this exists — how many slots there are, which are occupied, what is already under way, or what taking a slot would cost. The recommendation is arithmetically right and operationally ungrounded, which is exactly the reported experience.

A second instance of the same gap, found while comparing drives: `Project_OrionDrive` is **already completed**, so Orion Drive is fittable today at **zero research cost** — a 5.1× combat-acceleration improvement on the observer's main warship, requiring only a refit. The panel ranks research and does not lead with the thing that needs no research at all. Phase 4's census counts these ("10 buildable now") but the count is not the headline.

---

## 2. What to build

### 2a. Show the queue

The panel must show what is currently being researched before recommending anything: each occupied project slot and global tech slot, its occupant, progress as accumulated/total, and category. `currentProjects[]` and `globalResearch.activeSlots[]` both carry this. `researchWeights` gives the pip layout, already surfaced by `shared/researchSlots.mjs`.

### 2b. Capacity, and the cost of taking a slot

Every recommendation resolves to one of three cases, and must say which:

| case | what the row means | what it must state |
| :-- | :-- | :-- |
| **free slot** | start it now, nothing lost | slot index, time at current delivery |
| **occupied slot** | start it by backlogging something | what gets backlogged and its progress, which is retained |
| **no slot of the right kind** | cannot be started at all | which kind is exhausted |

**Displaced progress is retained — settled, do not re-investigate.** Stopping a project moves it to the backlog with its accumulation intact; the player confirmed this directly, and it is consistent with `AudienceResearch` reading 43/100 and `OperationsResearch` 23/100 byte-identically across eight saves spanning four and a half years.

So backlogging costs **time, not research**, and the panel should say so plainly. There is no at-risk calculation to make and `displaceCandidate` needs no minimise-loss heuristic.

What it should not do is rank the occupants for the player. Which project to park depends on whether it is still wanted — a 46%-complete project the player has lost interest in is a better candidate than a 12% one they are actively pursuing, and the snapshot cannot tell the difference. Name the occupants and their progress; let the player choose.

Project slots and global tech slots are **different pools** and must not be conflated: a global tech cannot displace a faction project.

### 2b-bis. The backlog — and a wrong reading to avoid

**An earlier draft of this document claimed two project slots were "stalled" and had been dead since 2029. That was wrong.** It is recorded here because the mistake is easy to repeat from the data alone.

The player can **stop a project**. It leaves the active set, keeps its accumulated progress, and sits in a **backlog** until resumed. So a project with progress and no pips is not a wasted slot — it is parked, deliberately, and this is a normal and useful thing to do.

That also settles §2b: **displaced progress is retained.** Confirmed by the player, and consistent with `AudienceResearch` holding at exactly 43/100 and `OperationsResearch` at 23/100 across eight saves spanning four and a half years. Displacing a project costs *time*, not accumulated research. The advisor may say so plainly, and `displaceCandidate` no longer needs an at-risk heuristic — nothing is at risk.

There are **three project slots**, and the global tech slots are a separate pool of three (`globalResearch.activeSlots`, holding ColonyHabs, AdministrationAlgorithms and Coilguns on the sampled save).

**The index mapping is not yet understood and must not be guessed.** On the sampled save `researchWeights` is `[0,0,3,3,3,0]` — six entries, three carrying pips at indices 2, 3, 4 — while `currentProjects` reports slot indices 3, 4, 5 and **7**, the last of which is outside the array entirely. Two of those four entries carry pips and two do not. Whether index 2 addresses a project slot or a global tech slot, and what slot 7 means, are open questions. Establish the mapping from data across several saves before relying on it; if it cannot be established, report the counts that *are* directly stated rather than inferring occupancy.

What the panel should say, once the mapping is known: **how many project slots are free.** On the sampled save two of three are active and one appears free — the opposite of the "all full, you must displace" framing this document originally carried, and far more useful. A free slot means a recommendation costs nothing but the research itself.

**Zero pips is a choice, not a fault.** The player concentrates research on two slots deliberately. Never describe a backlogged or zero-pip project as wasted, stalled, or a mistake — it is a strategy the advisor has no basis to second-guess.

Whether that concentration is optimal is genuinely open, and the campaign cannot answer it: **every save has exactly three pipped slots** (`[0,0,3,2,1,0]` → `[0,0,3,1,3,0]` → `[0,0,3,3,3,0]`). Only the distribution ever changed, never the count, so the wiki's `+5% per pipped slot` breadth term has no variation to test against. That term is the single blocker on ever recommending an allocation, and settling it needs a deliberate two-save experiment — not more analysis of existing saves.

### 2b-ter. Stalled slots — only if genuinely stalled

A backlogged project is not stalled. A project **holding a pipped slot and still receiving nothing** would be, and that is a different and much rarer condition. Detect it only from measured delivery across saves, never from a zero-pip reading, which is just the backlog.

On the sampled save no such case exists, and the panel must say so rather than manufacturing one.

### 2c. Lead with what needs no research

Anything already unlocked and merely unbuilt outranks anything needing research, because its cost is zero. Phase 2 and phase 4 already classify these; promote them out of the census into the ranking's head, with the refit or build named.

The live example: Orion Drive x1 — completed, fittable now, **5.1× combat acceleration** on the observer's Huang He Block 2 (2.62 → 13.48 m/s²) for no research at all.

### 2d. Separate actionable from aspirational

`researchable-now` and `prereq-clear-but-unrolled` currently interleave in one ranked list. They are labelled, but rank order mixes them. Present them as distinct blocks, actionable first — the aspirational block remains valuable (§3b exists because the best drive is often one that has not rolled yet) but must not compete for position with something the player can start today.

---

## 3. Constraints

- **§0 of `docs/research-advisor-spec.md` still governs.** Slot counts, pool sizes and category names come from the snapshot. `researchWeights` was length 6 on every save sampled, but the module must read the array's own length. Must behave on a turn-1 save.
- **Absent stays null.** An unreadable slot is `null`, never an assumed empty one — assuming a free slot manufactures actionability that does not exist, which is the failure this document is about.
- **Both modes.** `researchWeights` is redacted to `null` for non-observers in player mode and that assertion must keep passing.
- **Layout.** COMMAND sits at **2.99 screens against a 3.00 ceiling**. The queue block adds content; either keep it compact, reclaim space, or move something. Report the measured number.
- Reuse `shared/researchSlots.mjs`, `shared/researchAvailability.mjs` and phase 4's ranking rather than re-deriving any of it.

## 4. Acceptance

- The panel shows the current queue with progress before any recommendation.
- **Free project slots are counted and stated.** A backlogged project is never reported as a stalled or wasted slot.
- Every recommendation states free-slot / displaces-X / no-slot, and names what would be displaced.
- Backlogging is described as costing time, not research, and no occupant is ranked for the player.
- Zero-research options (already unlocked, merely unbuilt) lead the ranking, with the refit named.
- Actionable and aspirational are visually distinct blocks, not interleaved ranks.
- Turn-1: no slots, no queue, nothing recommended as startable — rendered honestly, not as an empty panel.
- COMMAND stays under 3.00 screens; no `null`/`undefined`/`NaN` in rendered text; both modes.
