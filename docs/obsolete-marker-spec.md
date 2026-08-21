# Respect the player's obsolete markers

Written 2026-08-21 against `36fa5ba`. Backend bake + advisor filter + a frontend marker.

The player can mark both **ship designs** and **ship parts** obsolete in game. The save
records both. The refit advisor reads neither, so it currently gives advice that
contradicts decisions the player has already made.

---

## Measured on the live save

Both lists sit on the observer faction in the raw save and are **not baked into the
snapshot**:

```
obsoleteShipDesigns (12)
  playerShipTemplate70, 58, 26, 584, 69, 85, 401, 0, 1, 196, 472, 473

obsoletedShipParts (12)
  RailCannonMk2, RailCannonMk1, HeavyRailCannonMk1, HeavyRailCannonMk2,
  SpinalRailgunMk2, SpinalRailgunMk1, 240cmIRLaserCannon, 480cmIRLaserCannon,
  720cmIRLaserCannon, 960cmIRLaserCannon, 12-inchCannon, 10-inchCannon
```

Cross-referenced against what the advisor currently emits:

```
advisor cards for designs the player marked obsolete : 12 / 24
weapon recommendations naming an obsoleted part      :  3
    Angara         -> 480cmIRLaserCannon
    Angara Block 2 -> 480cmIRLaserCannon
    Patapsco       -> 480cmIRLaserCannon
```

**Half the panel is advice about retired ships**, and three rows recommend fitting a
weapon the player deliberately retired. The second is a correctness defect: an obsolete
marker is an explicit instruction, and recommending against it is worse than saying
nothing.

Note both lists are **per faction** — every faction carries its own (`ResistCouncil…`,
`DestroyCouncil…` and so on). Read the observer's, not the first one found.

## What to bake

`server/snapshot/templates.js` / the faction reducer must carry, for the observer faction:

```
obsoleteShipDesigns   string[]  design dataNames the player retired
obsoletedShipParts    string[]  component ids the player retired
```

**Absent is not empty.** A faction that has never opened the screen may have no key at
all, which means *unknown*, not *nothing is obsolete*. An empty array legitimately means
"none marked". Carry the distinction — `null` for absent, `[]` for none — and never
coerce absent to empty. Player mode should expose the observer's own lists; they are the
observer's own decisions, not enemy intel.

Design ids in `obsoleteShipDesigns` include refit suffixes on other factions
(`…Template218 Refit 1089`). Match on the exact `dataName` string; do not normalise or
strip suffixes.

## Advisor rules

**1. Never recommend an obsoleted part.** Filter `obsoletedShipParts` out of the weapon,
drive and armour candidate pools in `shared/refitAdvisor.mjs`, alongside the existing
`completed OR ungated` availability rule. This is the correctness fix.

Record the exclusion rather than silently dropping it — a candidate removed because the
player retired it is different from one removed because it is unresearched, and the
distinction is worth keeping in the payload.

**2. Mark obsolete designs, do not silently drop them.** A card for a retired design is
not wrong, it is lower priority. Carry `isObsolete: true` on the item so the frontend can
decide.

**3. If the lists are absent (`null`), change nothing** and say the obsolete state is
unknown. Do not treat unknown as "none retired" — that would silently restore the current
behaviour while looking correct.

## Frontend

Mark obsolete designs on the card, and **demote them below active designs** in the FLEET
view. Do not hide them outright by default: the player may want to see that a retired
design still has a fittable upgrade before deciding to un-retire it.

A collapsed "12 obsolete designs" group that expands is the cleanest fit for a view that
would otherwise open with half its cards showing retired ships — but a marker plus sort
order is acceptable if it keeps the layout budget. Report the measured screen count.

Use the existing tag vocabulary (`ra-tag`, and the `--warn` / `--deficit` variants) rather
than introducing new chrome.

## Interaction with the armour-mismatch indicator

These two land together and must not fight. **An obsolete design should not raise a red
armour-deficit badge** — the player already retired it, so telling them its armour is 5.6×
behind is noise dressed as an alert. Mark it obsolete and let the armour comparison render
in its quiet form.

## Constraints

- Both modes. The observer's own obsolete lists are visible in player mode.
- Absent stays null throughout: `null` (unknown) and `[]` (none) are different.
- The save uses `ID`, not `id`, on save-derived faction objects.
- Read `docs/code-index.md`; update changed `Purpose:` lines and run `npm run index`.
- `shared/**` must run in both Node and the worker.

## Acceptance

- `obsoleteShipDesigns` and `obsoletedShipParts` are baked for the observer, with `null`
  distinguished from `[]`. Assert both cases.
- **Zero recommendations name a part in `obsoletedShipParts`.** Assert directly against the
  live save, which currently produces 3 (`480cmIRLaserCannon` on Angara, Angara Block 2,
  Patapsco). This is the non-vacuous test — it fails today.
- Every excluded candidate records *why* it was excluded, distinguishing "player retired
  it" from "not researched".
- Items carry `isObsolete`; 12 of 24 are true on the live save.
- Obsolete designs sort below active ones and carry a visible marker.
- An obsolete design does not raise a red armour badge.
- With the lists absent, behaviour is unchanged and the state reports unknown.
- Both modes; full suite green with exact pass/fail/skip counts.

## Routing

The bake and the advisor filter are backend. The marker, sort and grouping are frontend.
The correctness half is the filter — ship that first if the two are split.
