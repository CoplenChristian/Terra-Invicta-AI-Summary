# Drive Explorer — click a drive, see the path to it

Written 2026-08-21 against `89d3d60`. Frontend panel plus one backend gap.

Click any drive row in DRIVES and a modal shows what it takes to unlock: global techs and
faction projects, each with its status.

---

## Most of this already exists

`buildTechPathProjection` (`shared/techGraph.mjs`) already returns everything the modal
needs, and already makes the exact split the feature is about. Measured against
`Project_AntimatterBeamCoreTorch`, the gate for Pion Torch x6:

```
remainingPath                    12 nodes  ->  7 faction_project, 5 global_tech
remainingGlobalResearchCost      305,325
remainingFactionResearchCost     995,000
totalRemainingResearchCost     1,300,325

per node: id, displayName, type, category, cost, status, progressPercent
status values seen: locked, available, researching
```

`type` is `faction_project` or `global_tech`, which is precisely the two sections asked
for. Do not invent a second classifier.

It also already picks the **cheapest satisfying route** through `alternatePrerequisites`
and reports `routesEvaluated` with the road not taken — 85 of 899 nodes have an alternate,
and ignoring them overstates the path. Surface that: "via Colony Core (3,000), rather than
Ring Core (5,000)" is exactly the kind of thing this modal exists to say.

## The one gap: the unlocked half is missing

`alreadyCompleted` returns **0 entries even on the 12-step path above**. The walker
collects the *remaining* path by design, so prerequisites the player has already satisfied
are simply absent.

The request is for global techs and faction projects "and their status aka locked or
unlocked", so the satisfied ones must appear too — that is what makes the modal a *path*
rather than a to-do list. Seeing that eleven of thirteen prerequisites are already done is
the useful part.

**Add the satisfied prerequisites to the projection**, tagged as completed, without
changing `remainingPath` or any cost figure. Those are consumed elsewhere — the chain
promotion in COMMAND and the drive-chain rows both read them — and this must not move
them. Add a field; do not repurpose one.

## What the modal shows

Two sections, in the order the player thinks about them:

- **Faction projects** — what you research directly
- **Global techs** — the shared tree beneath them

In each: display name, status, cost, and progress where a node is part-researched
(`progressPercent` is already carried; `Magnetic Plasma Confinement Techniques` reads
`researching` on the live save).

Also show, once at the top:

- the drive's own gate project
- remaining cost split global vs faction, since those are different currencies
- **the availability caveat**: prerequisites being met does not make a project offered.
  It rolls monthly, and `research-advisor-spec.md` §3b is explicit that availability is
  rolled, not derived. A path that says "0 remaining" still may not be startable this
  month.
- the alternate route where one was chosen

## Ordering

Order the list so it reads as a path, not a set — a node before the nodes that depend on
it. `status` distinguishes what is startable now (`available`) from what is blocked behind
something else (`locked`), so the reader can see where the front line is.

## Constraints

- **Absent stays null.** A node with no readable cost shows `unknown`, never `0`. Note
  `researchCost: -1` is a sentinel for never-researchable, not a cost — a path containing
  one reports its total as **unknown**, not as a smaller number.
- **Truncation announces itself.** A 12-node path is fine inline; if any path is capped,
  carry `*TotalCount` / `*OmittedCount`.
- Both modes. The observer's own research state is visible in player mode, so this should
  work fully there — verify it is not gated on omniscient-only data.
- **Do not change `remainingPath`, the cost fields, or the route selection.** They are
  pinned: `tech-path` reproduces the Battlestations route through Colony Core, and
  `Project_ResidentialModule` resolving to `prereq-blocked` pins the alternate-prerequisite
  semantics. Add alongside.
- Reuse the existing modal (`MissionControlDetailPanel`); do not build a second one.
- Nothing campaign-specific.
- **Reaching the AI surfaces**: `tech-path` is already a registry row, so a new field rides
  it. Decide and state whether the war-room export should carry anything here — it likely
  should not, being a per-drive drill-down rather than a briefing fact.

## Acceptance

- Clicking a drive opens a modal naming its gate project and both sections.
- A drive with a deep path renders every node. Assert against the Pion Torch gate: 12
  remaining, 7 faction projects and 5 global techs, split 995,000 / 305,325.
- **Satisfied prerequisites appear, marked unlocked.** This is the gap — it returns 0
  today, so the test fails before the change.
- A part-researched node shows its progress; `Magnetic Plasma Confinement Techniques` is
  `researching` on the live save.
- Where an alternate route was chosen, the modal names the route not taken.
- The rolled-availability caveat is visible.
- `remainingPath` and every cost field are byte-identical to before the change. Capture and
  diff.
- Both modes; no `null` / `undefined` / `NaN`; full suite green with exact counts.

## Sequencing

DRIVES is currently being changed by the mobile-overflow work. Land that first; this
touches the same component.
