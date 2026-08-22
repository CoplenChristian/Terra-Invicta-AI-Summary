# Control point cap — the constraint the engine ignores

Written 2026-08-22 against `866b8a8`.

The dashboard tracks how many control points the observer holds. It has **no concept of a
cap**, and the directive engine actively recommends taking more — "Take the Executive
control point in Madagascar" sits in the live cycle plan. Exceeding the cap is not a soft
penalty.

---

## The mechanic

From the wiki (`Aliens`, raw wikitext, read 2026-08-22 at `wiki.hoodedhorse.com`, the
publisher's official wiki; the fandom mirror is 410):

> "Human Factions suffer increased vulnerability to Crackdown and Purge missions from
> exceeding their cp, as well as incur an annual influence upkeep equal to the excess
> amount squared."

Two penalties, and the second is **quadratic**:

- annual Influence upkeep = `(controlPointsHeld − cap)²`
- raised vulnerability to Crackdown and Purge missions

Being three over cap costs 9 Influence/year. Being ten over costs 100. A linear model of
this is not an approximation, it is a different mechanic.

## Councilor contribution

From `Persuasion` (raw wikitext, read 2026-08-22):

```
* +1% Influence Income for Councilor per Persuasion point.
* +1 Control point Cap per Persuasion point.
```

**Each councilor adds +1 CP cap per point of Persuasion.** The `Councilors` page confirms
the general shape — the eight attributes "may also provide other bonuses such as increasing
incomes, **increasing cp**, increasing org capacity".

This is the half the request specifically named, and it makes the cap *dynamic*: recruiting,
losing, or re-statting a councilor moves it, as does any org or trait that modifies
Persuasion.

## What the templates carry

`ControlPointMaintenance` is the effect context, and `TIEffectTemplate EN` shows the game
displays it as **"Control Point Cap"** — so maintenance and cap are the same quantity under
two names. Five effects modify it:

```
Effect_ControlPointMaintenanceBonus160   value -120
Effect_ControlPointMaintenanceBonus40    value  -40
Effect_ControlPointMaintenanceBonus20    value  -20
Effect_ControlPointMaintenanceBonus10    value  -10
Effect_ControlPointMaintenanceBonus3     value   -5
```

**The suffix does not match the value.** `Bonus160` is −120 and `Bonus3` is −5. Do not
derive a magnitude from a template's name; read `value`. This is the same class as the
comma-formatted drive numbers that produced a fake power-budget result.

Sign convention needs pinning before use: the values are negative on a quantity named
*maintenance* but displayed as *cap*, so whether a −120 raises the cap by 120 or lowers it
must be established by measurement, not assumed.

## What the save carries

- `controlPointMaintenanceFreebieBonus: 150` — two occurrences, so global rather than
  per-faction.
- `numControlPoints` and `numControlPoints_unclamped` — **295 occurrences each, per nation,
  and identical on this save.** They are a nation's CP count, not a faction cap, and nothing
  is currently clamped. Do not mistake the `_unclamped` suffix for evidence of a faction cap.
- `StartOfTurnNativeControlPoints` — 295, all zero on this save.

**No per-faction cap field was found.** The cap therefore has to be derived, which is the
work. Establish the base before building on it: check `TIGlobalConfig.json`,
`TIFactionTemplate.json` and the faction record itself, and if no base exists in any of
them, say so rather than inventing one.

---

## What to build

A control-point cap figure for the observer, composed and attributed:

- base cap (once located)
- plus the sum of every living councilor's Persuasion
- plus any completed `ControlPointMaintenance` effects, each named with its granting project
- against control points currently held
- and, when over, the **squared** annual Influence upkeep

Follow the pattern `shared/miningTechBonus.mjs` set: name the source of each contribution
rather than printing a bare total. A reader must be able to see that four of their cap comes
from one councilor's Persuasion, because that councilor dying changes it.

### It has to reach the directive engine

This is the point of the feature, not a display nicety. The engine recommends taking control
points with no knowledge of the cap, so a "take the Executive control point" recommendation
made at or over cap is proposing a quadratic Influence cost it has not priced. Decide and
state whether this becomes a **rule** in the registry (a cost or a veto) or an annotation on
the candidate — and if a rule, respect the ordering constraint in `CLAUDE.md`: the registry
is not grouped by family and its order is load-bearing.

**Do not silently reorder or re-weight existing recommendations.** If adding this changes
which councilor does what, that is a real result and must be reported as one, with the
before/after.

## Constraints

- **Absent stays null.** No base cap located, or an unreadable councilor roster, means the
  cap is **unknown** — never 0, never "no limit". A cap that cannot be computed must not
  render as a comfortable headroom figure. `Number(null) === 0` here would read as "you are
  massively over cap" or "you have none", depending on the subtraction's direction, and both
  are worse than saying nothing.
- **Unknown is not safe.** If the cap is unknown, the engine must not conclude that taking
  another control point is free.
- **Both modes.** The observer's own councilors and projects are not redacted, so this
  should work fully in player mode — verify. Other factions' caps depend on their councilor
  Persuasion, which *is* masked in player mode (`maskedAttributes`, not `attributes`), so a
  rival's cap is omniscient-only and must not leak.
- **Cite the source for every mechanic claim, with its date**, per `CLAUDE.md`. The two
  wikitext reads above are dated; anything further needs the same.
- **Nothing campaign-specific.**
- Reach the AI surfaces: registry, `docs/code-index.md` regenerated after updating changed
  modules' `Purpose:` lines, `docs/README.md` in the same commit.
  **`shared/markdownExports.mjs` is off limits this round** — another agent holds it. If a
  figure belongs there, say so and it will land separately.

## Acceptance

- The base cap is located and cited, or its absence is reported explicitly. **Report this
  first** — everything else composes on top of it.
- The sign convention on `ControlPointMaintenance` values is pinned by measurement, with the
  arithmetic shown.
- The observer's cap is reported with each contribution attributed, and reconciles against
  whatever the game itself shows if any save field can corroborate it.
- Over-cap upkeep is squared, not linear, and a synthetic over-cap faction proves it.
- An unknown cap renders as unknown on every surface and blocks no recommendation into a
  false "free".
- Both modes, with the player/omniscient difference for *rival* caps stated.
- Whether any directive recommendation changed, and if so which.
- No `null` / `undefined` / `NaN` / confident `0`.
- Full suite green with exact counts. Baseline **1141 tests / 1140 pass / 0 fail / 1 skip**.
- Every new test broken deliberately first.
