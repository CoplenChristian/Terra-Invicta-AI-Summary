# Research Advisor — Name the Project, Not Just the Unlock

Written 2026-08-21 against `eec2277`. Small, presentational, no model changes.

---

## The problem

The panel's rows are labelled with the **item** a project unlocks, not the project. Observed:

```
FITTABLE NOW    Copperhead Missile Pod    3.00× sustained output per hardpoint
                Dreadnought               2.07× throw weight
```

Neither is a project. Searching a tech tree for "Dreadnought" finds nothing — the project is **"Ships of the Line"**.

The backend already carries the right data:

```
displayName     "Copperhead Missile Pod"           "Dreadnought"
gateProjectId   Project_CopperheadMissileBay       Project_ShipsoftheLine
gateProjectName "Hydrolox High Explosive Missiles" "Ships of the Line"
alsoUnlocks     4 missiles                         2 ship hulls
```

`public/v2/js/components/research-advisor.js:223` uses `gateProjectName` **only as a `title` tooltip**. It is never visible. That is the whole defect — no model change is needed.

Note the project name is often unrecognisable from the item: `Project_CopperheadMissileBay` is named *"Hydrolox High Explosive Missiles"*. Deriving one from the other is not possible; it must be read from the data.

## What to change

**1. The project name must be visible for anything that requires research.** It is the string the player will search for. The item name stays — it says what you get — but the project is what you act on.

**2. Zero-cost rows are a different action and should read that way.** A completed item is *built or refitted*, not researched; there is no project to look up. The `FITTABLE NOW (0 RESEARCH COST)` heading already says this, so those rows may lead with the item name — but should still name the project that unlocked it, because that is what makes the "0 pts" claim checkable.

**3. Surface `alsoUnlocks` where it is greater than one.** `Project_CopperheadMissileBay` yields four missiles and `Project_ShipsoftheLine` two hulls. A project that unlocks four items is worth more than the single row implies, and the panel currently hides that.

**4. Do not blow the layout budget.** COMMAND sits at **2.99 of 3.00 screens**. A second full line per row will not fit. Options that do: the project name as a subdued suffix on the existing line, the item name parenthesised after the project, or a compact `4 items` badge. Report the measured screen count.

## Acceptance

- Every row that requires research shows its project name as **visible text**, not only a tooltip.
- The project name is read from `gateProjectName`, never derived from the item name — they routinely differ.
- Zero-cost rows read as build/refit actions and still name their unlocking project.
- `alsoUnlocks > 1` is visible.
- COMMAND stays under 3.00 screens at 1920×1080; report the number.
- Both modes; no `null` / `undefined` / `NaN` in rendered text.
