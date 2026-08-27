# Cross-aware advisor — making the engine see the whole board

**Status: design, not built. Written 2026-08-26 from measurement against the live
save.**

The ask, in the user's words: the suggestions piece should know *"you have a
50-ship alien fleet incoming to Mercury and only 30 ships, so build X — factoring
days-to-build from shipyard tier and research — or retreat."* And the harder
variant: *"same scenario, but hate is only 25, so it is likely not for you unless
it is retaliation, which is exactly what it should call out."*

---

## The gap is architectural, not a missing feature

**The directive engine is entirely councilor-facing.** Its candidate generators
are `controlPoints`, `council`, `defense`, `intelligence`, `missions`, and its
candidate kinds are `Advise`, `Detain`, `Purge`, `nation`, `hab`, `capability`.
Even `defense.js` — "Defend Interests" — protects *control points*, not fleets.

Measured across `server/engine/`:

| signal | files referencing it |
| :-- | --: |
| `arrivals` | **0** |
| `shipyard` | **0** |
| `incoming` | **0** |
| `hostileShips` | **0** |

So the component that answers *"what should I do this cycle"* **cannot see an
incoming alien fleet**. It will keep recommending councilor assignments while a
fleet closes on Mercury, and nothing in its output will hint that it is
answering a narrower question than the reader is asking.

That is the thing to fix. Everything else here follows from it.

---

## What already exists (measured, live save)

Far more than expected. This is mostly a **join and a reasoning layer**, not new
data collection.

| source | carries | theater-keyed? |
| :-- | :-- | :-- |
| `/api/intel/arrivals` | `destination`, `destinationType`, `arrivalDate`, `ships`, `combatPower`, `dominantWeaponType`, **`friendlyStrengthAtDestination`** | **NO** |
| `/api/intel/theaters` | 12 theaters: `body`, `status`, `friendly`, `hostile`, `incoming{hostileShips,hostileFleets,nearestArrivalDays,nearestArrivalDate}` | yes |
| `/api/intel/shipyards` | 244 rows with **`habTier`**, `orbitBody`, **`spaceTheaterKey`** | **yes** |
| `/api/intel/shipyard-queues` | 69 rows, theater-keyed | yes |
| `/api/intel/production-plan` | design + quantity → plan | — |
| `/api/intel/fleet-engagement` | hull counts required per opponent tier, with a p20–p80 band | — |
| `shared/alienHateEconomics.mjs` | `ALIEN_HATE_WAR_THRESHOLD = 50`, `actualAlienHate`, `currentWarStatus` | — |

**The seam is precise: shipyards know their theater, arrivals do not.** Every
other join hangs off that one.

### What the aliens are actually doing right now

Worth stating because it shapes the feature. Eight alien fleets are in transit:

- **five → other alien fleets** (Victor-771, -1027, -1048 ×2, -1062) — rendezvous,
  not an attack on anything the observer owns
- **one → a hab** (Iron Fortress Station)
- **two → orbits**: Triton, 30 Urania

**None is heading to any of the 12 tracked theaters**, which is why every
theater's `incoming` reads `hostileShips: 0`. Those zeros are plausibly honest.

But it means **8 real alien movements are invisible on the dashboard**, because
the theater model covers 12 bodies and the aliens are going elsewhere. A feature
that only lights up theater `incoming` would show nothing today and would still
show nothing on the day it mattered most, if that day's destination is an orbit.

**Open question to settle first:** is `incoming: 0` *computed* from arrivals, or
a default that nothing ever writes? If nothing writes it, it is a confident zero
waiting to be wrong — the exact defect class the register has spent twenty
entries on. This must be answered before anything is built on top of it.

---

## The two claims in the user's scenario are NOT the same kind of claim

This is the crux, and getting it wrong would produce exactly the sort of
confident fiction this codebase exists to avoid.

**"50 incoming vs your 30" is measured.** `arrivals.ships`,
`arrivals.combatPower` and `friendlyStrengthAtDestination` are all readings.
`fleet-engagement` already converts an opponent into a required hull count with
an explicit p20–p80 band. Say it plainly, with the band.

**"Hate is 25, so it is probably not for you" is measured-ish and must be shown
as inference.** `ALIEN_HATE_WAR_THRESHOLD = 50` is a known constant and
`actualAlienHate` is a reading, so *"25 is half the war threshold"* is a fact.
*"Therefore this fleet is not aimed at you"* is an **inference from that fact**,
not an observation of alien intent. The save carries no targeting data.

**"Unless it is retaliation" has no grounding at all today.** There is no
retaliation model in the repo — no targeting intent, no trigger signal, nothing.
So the honest form is not a verdict but a **named unknown**:

> Hate 25 of 50 — below the war threshold, so a fleet arriving here is more
> likely transiting than targeting you. **This cannot be confirmed:** the save
> records no alien targeting intent, and retaliation triggers are not modelled.
> If you have recently acted against them near this body, treat that as the
> likelier reading.

That is the shape the user actually asked for — *"which is exactly what it should
call out"* — and it is also the only shape this repo's rules permit. **A check
that cannot be evaluated must say so rather than falling through to "fine".**

**Player mode makes this sharper.** `actualAlienHate` is *redacted* in player
mode. So in the mode the dashboard defaults to, the hate-based inference often
**cannot be made at all**, and must say that rather than defaulting to
reassurance. This is where the Total War veto defect came from once already.

---

## Build-or-retreat needs one number nobody computes yet

"Build X before they arrive" is a race between two clocks:

- **days until arrival** — `arrivals.arrivalDate` minus campaign date. Measured.
- **days to build** — **not currently computed.** Needs hull cost, the shipyard's
  `habTier`, and any research that reduces build time.

Both must be present or the recommendation is not made. **Do not default a
missing build time to zero, to "fast", or to the arrival date** — an unknown
build time makes the whole comparison unevaluable, and the correct output is
"cannot advise: build time unknown", not a confident "build it".

The retreat branch is the cheaper half and is answerable today from
`friendlyStrengthAtDestination` plus `fleet-engagement`'s required-hull band.

---

## Design: one shared read-model, cited findings

Two mechanisms, both small.

**1. Widen the engine's `world`.** It currently receives councilor-and-nation
state. Add a military read-model — arrivals joined to theaters, shipyards with
tier and theater, current hate and threshold. One place, built once per cycle,
so every generator sees the same board.

**2. Findings carry citations.** A recommendation should be able to say *which
other component's reading it rests on*, so the reasoning is auditable rather than
asserted. The engine already has the right instinct here: `hateUnknown` exists on
a pairing precisely so a score is not read as "this mission costs no hate". Same
idea, applied across components.

Then the new candidate class — call it **theater defence** — generates from the
military read-model: reinforce, build, or withdraw, each with its clocks and its
citations, and each **refusing to generate** when a required reading is absent
rather than guessing.

---

## Phasing

1. **Answer the `incoming` question.** Is it computed or defaulted? One
   afternoon, and everything else rests on it.
2. **Join arrivals to theaters** — including a stated bucket for destinations
   *outside* the 12 theaters, since that is where all 8 alien fleets are today.
3. **Surface it read-only** on THREAT and in the AI exports. Useful immediately,
   and it makes the join reviewable before anything reasons over it.
4. **Compute days-to-build** from hull cost, `habTier` and research modifiers.
   The one genuinely new calculation.
5. **Widen `world`, add citations, add the theater-defence generator.**
6. **The hate inference**, last, because it is the easiest to get subtly wrong and
   the most damaging when it is — it is the one that can tell a player they are
   safe.

Steps 1–3 are worth doing regardless: they close a real visibility gap whatever
happens to the advisor.

---

## What would make this wrong

Recording these now, because they are the failure modes this specific feature
invites:

- **A confident "not for you."** If hate is redacted or absent, the inference
  cannot run. Say so. Never default to reassurance.
- **A build recommendation with an unknown build time.** Refuse instead.
- **Lighting up only the 12 theaters.** Today that shows nothing, and the day it
  matters the destination may be an orbit.
- **Treating "no hostile fleets incoming" as verified** when it is a default
  nobody writes.
- **Quietly dropping the p20–p80 band** when converting an opponent to a hull
  count. `shared/engagementModel.mjs:58` is explicit that `winnable: false` means
  "above the ceiling I swept", never "cannot be won" — and register #13 exists
  because a consumer rendered that band as though it were the whole uncertainty.
