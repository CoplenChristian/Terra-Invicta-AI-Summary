# Wiring force strength into theater defence — what it would take, and what it would cost

**Status: design, not built. Written 2026-08-27 from measurement against the live
save and against `shared/engagementModel.mjs` / `shared/fleetEngagement.mjs`.**

The gap this closes, in the user's words: *"you have a 50-ship alien fleet incoming
to Mercury and only 30 ships, so build **X** — factoring days-to-build from shipyard
tier and research — or retreat."*

What `server/engine/theaterDefence.js` says today for Mercury is:

> **BUILD** — Gunship, 9 days, 48 days of margin.

That is honest and it is thin. A Gunship against 105 inbound ships is not a plan.
The race picks the **fastest** hull because that is the only question answerable
without a force-strength model, so the block currently answers *"can production here
change the board at all?"* rather than *"what should I build?"*

---

## The blocker is not the model — it is the rating, and it is mode-dependent

`shared/engagementModel.mjs` is already well built for this. It exposes
`findRequiredHullsForTier`, `describeBandUncertainty`, `hullBandLabel`, and
`guaranteedWinHullCount`, and it is plain ESM so the hosted worker can load it.

**It needs two ratings: `ownRating` and `opponentRating`.** Everything below is
about where those come from and how far they can be trusted.

### `combatPower` is not the answer — it is not in the save

Every theater row on the live board reports, on **both** sides:

```
combatPower: null, combatPowerAvailable: false, combatPowerSource: "not present in save"
```

So the field that looks like it should feed this does not exist as a reading. Any
design that leans on it is leaning on a null.

### Ratings come from ship designs' combat values

`composeFleetRating` in `shared/fleetEngagement.mjs` sums each ship's design combat
value (`cv`). That module already refuses correctly: **there is no default rating.**
Its own comment records that `runMonteCarloSimulation` would otherwise fall back to
`ownRating = 5000`, and that the resource reports unavailable instead. Keep that
property; do not reintroduce a default under a new name.

### And here is the part that decides the shape of this feature

`OPPONENT_RATING_BASIS`, quoted from the source:

- **omniscient** — *"Alien ratings are the p10 / p50 / p90 of the alien designs' own
  combat values as carried in the snapshot. The values are read rather than
  invented, but treating a combat value as the exchange currency of this
  Lanchester-style model is still an assumption."*
- **player** — *"**UNCALIBRATED ASSUMPTION.** Alien ratings are scaled off the
  observer's own best hull by invented constants — ×0.7 escort, ×1.5 typical, ×4.0
  heavy — each scaled again by (observed armor / 10). **No game source states that a
  typical alien is 1.5× your best hull.** Only the armor medians and fleet counts
  underneath are observed."*

And measured, in the same file: the armour-anchored player rating **under-rated one
fleet by 5.5×** against its omniscient rating, with the note that *"under-rating the
enemy is the dangerous direction for a threat display."*

**Player mode is the mode the dashboard defaults to.** So the "build X" answer is
materially less trustworthy exactly where most readers will see it, and its error
runs in the direction that tells you you are safer than you are.

---

## What this means for the design

Not "wire it in and label it". Three distinct behaviours:

**Omniscient — compute it.** Ratings are read. Emit a required-hull band, carry the
p20–p80 through, and carry the model-assumption caveat verbatim rather than
paraphrased.

**Player — do NOT emit a bare hull count.** A number like "you need 40 hulls" reads
as measured whatever label sits beside it, and this one is built from invented
constants with a measured 5.5× error in the reassuring direction. Options, in order
of preference:

1. **Refuse, with the reason named** — "force-strength comparison unavailable in
   player mode: alien ratings here are an uncalibrated assumption, measured to
   under-rate by up to 5.5×." This matches how the rest of the engine treats an
   unevaluable check, and it is the safest.
2. Emit it only as a **floor** — "at least N", never "N" — since the known error
   direction is under-rating the enemy, so the true requirement is higher.

Option 1 unless the user asks otherwise. **A check that cannot be evaluated must say
so rather than falling through to the reassuring answer**, and this is the exact
shape of the Total War veto defect: a redacted value read as null, and the check
fell through to `false`.

**Both modes — `winnable: false` is not "cannot be won".** `MAX_SIMULATED_HULLS` is
24 and the sweep ceiling is a search bound, not a verdict. The model is monotonic in
hull count, and `guaranteedWinHullCount` gives the closed-form count above which
every trial wins, so a caller can size its own ceiling from the model rather than
from a number somebody picked. Register **#13** exists because a consumer rendered
that band as though it were the whole uncertainty.

---

## The architectural constraint

`world` is **frozen and data-only**; the engine never sees the raw snapshot. So
`theaterDefence.js` cannot compose ratings itself — it has no designs to read.

Ratings must therefore be computed by the **builder** (`server/engine/military.js`,
which does hold the snapshot) and handed in on `world.military`, the same way
`buildOptions` already is. That keeps the read-model the single place the board is
assembled, and keeps `theaterDefence` a pure function of it.

Sketch, matching the existing style:

```js
world.military.theaterForce = [ {
  body,
  own:      { rating: number|null, ratedShips, unratedShips, source },
  opponent: { rating: number|null, ratedShips, unratedShips, source, basis },
  available: boolean,
  unavailableReason: string|null
} ]
```

`unratedShips` is not decoration. A rating composed from 3 of 25 ships is not a
rating for 25 ships, and the count is what lets a reader tell the difference.

---

## Phasing

1. **`theaterForce` on the read-model**, omniscient only at first, with player mode
   reporting unavailable and its reason. Testable on its own.
2. **The required-hull band in `theaterDefence`**, carrying p20–p80 and the
   `winnable: false` distinction.
3. **The hull recommendation** — intersect the band with `buildOptions` so "build X"
   names a hull that both *lands in time* and *moves the engagement*. This is the
   sentence the user actually asked for, and it is only honest once 1 and 2 hold.

---

## What would make this wrong

- **A bare hull count in player mode.** Invented constants, 5.5× measured error,
  reassuring direction.
- **Dropping the band.** Register #13, again.
- **Reading `winnable: false` as "hopeless".** It means "above the ceiling I swept".
- **A default rating.** `fleetEngagement` already refuses; do not reintroduce 5000
  under another name.
- **Rating a fleet from a fraction of its ships without saying so.** Carry
  `unratedShips`.
- **Recommending the fastest hull because it is fastest.** That is the current
  behaviour and the reason this document exists.
