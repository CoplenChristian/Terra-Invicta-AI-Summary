# Research Advisor — Actionability

Ground the research recommendation in what the player can actually do this turn.

Written 2026-08-21 against `669e16e`. Every figure below is measured from the live save.

---

## 1. What was reported, and what is actually wrong

Reported: *"the suggested research is based more on what can be researched vs what is available for me in the game right now."*

**The availability state is correct** — this was checked and is not the bug. Every row the panel labels `researchable-now` is present in `factions[observer].availableProjectNames`, and none is a project already under way. Phase 1's §3b work holds.

**What is missing is capacity.** Research slots are finite and the advisor does not know they exist.

Measured on the live save:

```
project slots occupied      4 of 4
  Project_AudienceResearch          43 / 100
  Project_OperationsResearch        23 / 100
  Project_PherocyteResistance   12,412 / 30,000
  Project_240cmUVLaserCannon         in progress

global tech slot occupied
  ColonyHabs (LifeScience)       8,589 / 35,000

payload keys: slotCapacity ABSENT · freeSlots ABSENT · wouldDisplace ABSENT
              currentProjects ABSENT · alreadyResearching ABSENT
```

So the panel says *"research this, 2,500 points, under a month"* when every slot is full and taking it means **abandoning something 41% complete**. The recommendation is arithmetically right and operationally unusable — which is exactly the reported experience, arrived at by a different route than assumed.

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
| **occupied slot** | start it by displacing something | what is displaced, its accumulated progress, and whether that progress is lost or retained |
| **no slot of the right kind** | cannot be started at all | which kind is exhausted |

**Whether displaced progress survives is the load-bearing unknown, and it could not be established.** Eight saves spanning 2029-09-10 to 2034-02-01 were checked: six projects left a slot in that window and **all six were completed, none displaced**. There is no natural experiment in this campaign, so **report it unknown — that work is done, do not repeat it.**

A recommendation that silently assumes 13,790 points are safe, or silently assumes they are lost, is wrong in a way the player cannot see. If a future save ever does displace an in-progress project, the comparison becomes available and the state can be tightened then.

`displaceCandidate` needs the same care. Under unknown retention, proposing the occupant with the **least accumulated progress** minimises what is at risk, which makes it a defensible default — but it is a heuristic chosen under uncertainty, not the correct answer, and must be labelled as one. The player may well prefer to drop a 46%-complete project they no longer want over a 12% one they do.

Project slots and global tech slots are **different pools** and must not be conflated: a global tech cannot displace a faction project.

### 2b-bis. Stalled slots — measured, and the highest-value thing this panel can say

A slot can hold a project and receive **nothing**. Measured across eight saves spanning 2029-09-10 to 2034-02-01:

```
researchWeights: [0,0,3,3,3,0]

slot 3   3 pips   PherocyteResistance     13,790 / 30,000  (46%)  advancing
slot 4   3 pips   240cmUVLaserCannon         912 /  7,500  (12%)  advancing
slot 5   0 pips   AudienceResearch            43 /    100  (43%)  FROZEN since 2029
slot 7   no entry OperationsResearch          23 /    100  (23%)  FROZEN since 2029
```

`AudienceResearch: 43` and `OperationsResearch: 23` are byte-identical in every save across **four and a half years**. Slot 5 carries zero pips; slot 7 is beyond the length-6 weight array and receives nothing at all.

So two of four project slots are consumed by work that cannot finish, while the advisor recommends starting more. **Detecting this is worth more than any ranking improvement in this document** — it is capacity the player already owns and is not using.

Emit a `stalled` state for any slotted project receiving zero delivery, distinguishing the two causes (zero pips assigned, versus slot index outside the weight array — they have different fixes), and surface it above the recommendations. Detect it from the data, not from a hardcoded slot count: read the weight array's own length.

Do **not** state what the player should do about it beyond naming the cause. Whether to assign pips or clear the slot depends on whether that project is still wanted, which the snapshot does not know.

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
- **Stalled slots are detected and surfaced above the recommendations**, with the cause named (zero pips versus slot index outside the weight array). On the sampled save this must find Audience Research and Operations Research; on a save with none it must say none, not omit the section.
- Every recommendation states free-slot / displaces-X / no-slot, and names what would be displaced.
- Whether displaced progress is retained is either established from saves and stated, or reported as unknown — never assumed.
- Zero-research options (already unlocked, merely unbuilt) lead the ranking, with the refit named.
- Actionable and aspirational are visually distinct blocks, not interleaved ranks.
- Turn-1: no slots, no queue, nothing recommended as startable — rendered honestly, not as an empty panel.
- COMMAND stays under 3.00 screens; no `null`/`undefined`/`NaN` in rendered text; both modes.
