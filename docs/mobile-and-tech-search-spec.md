# Mobile overflow, and a searchable unlocked-technology list

Written 2026-08-21 against `83a4178`. Two independent frontend items.

---

# Part A — mobile clips content instead of scrolling it

Measured in a live browser at **375×812**, all six views:

```
view         overflowing elements   worst right edge
drives                      1620              945px
expansion                    164              811
threat                       147              815
command                      107              820
records                       45              631
fleet                          0                 —
```

**`document.documentElement.scrollWidth` is exactly 375**, so the page does not scroll
horizontally. Those elements are not merely off-screen, they are **unreachable** — clipped
with no way to reach them. That is the defect: a table the reader can pan is inconvenient,
a table they cannot is missing data.

The dominant cause is **`mc-board-table`**, shared across command, expansion, threat and
records. DRIVES adds its own on top and is the worst offender, being the newest and widest.

**FLEET is clean at 0.** Whatever it does is the pattern to copy — do that rather than
inventing a new approach.

## What to do

- **Wide content scrolls inside its own container.** A table, diagram or code block wider
  than the viewport belongs in an `overflow-x: auto` wrapper. The page body must never
  scroll horizontally, and content must never be silently clipped.
- **Fix `mc-board-table` once**, since four views share it. Do not patch each view.
- **DRIVES needs its own pass** — 1620 elements and a 945px worst edge. It is a wide
  catalogue by nature; consider which columns collapse or stack under ~500px rather than
  shrinking everything.
- Check the nav itself fits six buttons at 375 without wrapping into the content.

## Acceptance

- At **375, 414 and 768**: `document.documentElement.scrollWidth <= innerWidth + 1` on
  every view, and **zero elements extend past the viewport** except inside an element whose
  computed `overflow-x` is `auto` or `scroll`.
- Verify by **computed style and `getBoundingClientRect` on a live DOM**, not by reading
  CSS — `--text-muted` was once defined self-referentially and 164 rules silently fell back
  to `inherit`.
- Desktop is unchanged: COMMAND stays under 3.00 screens at 1920, measured and reported.
- Both modes.

---

# Part B — searchable list of unlocked technologies

**The backend already exists.** `/api/intel/tech-search?observer=4712&mode=player&q=laser`
returns 200 and is registered as `techSearch` in `shared/intel/registry.mjs`. Per
`CLAUDE.md` it matches display names, internal ids, unlock names and effect ids. The
observer's completed set is on the faction as `completedProjects` (155 entries at the time
of writing) plus `techTree.finishedTechsNames`.

So this is a panel, not a new model. Do not build a second search.

## What it should answer

The player asked for "a searchable list of technologies my faction has unlocked" — so
**default to what is already unlocked**, not the whole tree. Searching the unresearched
tree is a different question the research advisor already answers.

- Search by name, and by what a project unlocks — `Copperhead` should find
  `Project_CopperheadMissileBay` even though the project is named *Hydrolox High Explosive
  Missiles*. That mismatch is exactly why this is useful.
- **Name the project, not just the item**, per `docs/research-row-naming-spec.md`. The
  project name is the string the player searches for in game.
- Show what each unlocked project gave — `alsoUnlocks` is already carried and already
  rendered in the research advisor.
- A filter to widen from "unlocked" to "all" is welcome, but unlocked is the default.

## Placement

**RECORDS.** Its registry question is "what happened", and a list of what you have already
researched is exactly that. Do not add a seventh view — `docs/README.md` shows the
six-view budget is already contentious, and a panel is enough.

Per `CLAUDE.md`, a rendered panel needs a registry entry and a startup assertion: add the
panel id to the `records` entry in `VIEWS` and confirm `assertViewRegistryIntegrity()`
passes.

## Acceptance

- Typing a partial name filters live; searching `Copperhead` finds the project whose
  display name does not contain that word.
- Defaults to unlocked-only, and says how many of how many.
- Truncation announces itself with `*TotalCount` / `*OmittedCount`.
- Both modes. In player mode this is the observer's own research, so it should be fully
  available — verify it is not accidentally gated on omniscient-only data.
- No `null` / `undefined` / `NaN` rendered.
- Mobile: obeys Part A. A search panel that clips is the same defect twice.

---

## Constraints for both parts

- Absent stays null.
- Nothing campaign-specific.
- **Anything new must reach the AI surfaces** — see the `CLAUDE.md` section. Part B is a
  panel over an existing endpoint, so the registry row already exists; check whether the
  war-room export should carry an unlocked-technology summary, and say what you decided.
- Read `docs/code-index.md`; new modules need a hand-written `Purpose:` line before
  `npm run index`, which runs last.
- Baseline is 966 tests / 965 pass / 1 conditional skip.
