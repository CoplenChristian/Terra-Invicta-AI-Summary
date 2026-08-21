# Research Advisor — Separate Procurement from Research

Written 2026-08-21 against `829fb36`. **Supersedes the zero-cost half of `research-row-naming-spec.md`**, which made this worse.

---

## The problem

A third of the Research Advisor is not about research.

```
buildable-now      4 rows    Copperhead Missile Pod · Dreadnought
                             Tin Droplet · Spinal Railgun Mk3
researchable-now   8 rows

all four buildable rows: remainingResearchCost = 0
```

Those four are **already researched**. `Project_ShipsoftheLine` and `Project_CopperheadMissileBay` are complete. The player asked, reasonably: *"I already have those things researched, so why are they showing in the research advisor tab?"*

They are ranked in the same list, under the same `× your best, per point` header, with `0 pts` where other rows carry a research cost. The `FITTABLE NOW (0 RESEARCH COST)` heading tries to distinguish them, but the surrounding frame overrides it — a ranked row in a research panel reads as a research suggestion.

**`research-row-naming-spec.md` compounded this.** It required all rows to lead with `gateProjectName`, so a completed item now displays as `Ships of the Line (Dreadnought)` — a research-project name at the head of a row that involves no research. That instruction was right for research rows and wrong for these.

## What this actually is

Two different questions are being answered in one list:

| question | decision | cost | resource spent |
| :-- | :-- | :-- | :-- |
| *What should I research?* | pick a project | research points | research income, over months |
| *What should I build or refit?* | pick a design change | build materials and time | shipyard capacity, now |

They compete for nothing and resolve on different timescales. Ranking them together implies a tradeoff that does not exist.

**The information is worth keeping.** "You unlocked Dreadnought and Spinal Railgun Mk3 and are not using them" is genuinely actionable — arguably more so than any research suggestion, because it needs no waiting. It is the framing that is wrong, not the content.

## What to change

**1. Split the block out.** Zero-cost items get their own titled section, visually separated from the ranked research — not a subheading inside it. Suggested framing: *already unlocked, not in service*. It states the fact and implies the action without pretending to be research.

**2. Drop the research framing on those rows.** No `pts`, no `per research point` metric, no `gateProjectName` lead. The project is finished; naming it is noise. Lead with the **item** — that is what gets built.

Keep the project name available as a tooltip only, so the "already unlocked" claim stays checkable.

**3. Say what the action is.** `refit` and `build` are different verbs: a weapon or drive is a refit to existing hulls, a hull is a new build. The data distinguishes them (`family` is `ship_hull` versus `missile`/`drive`/`laser_weapon`), so the row should too.

**4. Do not rank across the two blocks.** Each block ranks internally. A 2.07× throw-weight refit and a 3.00× research candidate are not comparable — one costs shipyard time, the other months of research.

**5. Consider whether this belongs in this panel at all.** A refit recommendation is a *procurement* decision and may sit better with the Directive Engine, which already recommends actions. Deciding that is out of scope here; splitting the block is the minimum, and it makes the move cheap later if wanted.

## Constraints

- COMMAND is at **2.99 of 3.00 screens**. A section header costs vertical space; reclaim it or keep the split to styling and ordering rather than new chrome.
- Both modes; no `null` / `undefined` / `NaN` in rendered text.
- `research-row-naming-spec.md` still governs **research** rows: they lead with `gateProjectName`, item parenthesised, `alsoUnlocks` badge where greater than one. That part was verified correct — at 1920 the 57-character label truncates the *item* name and keeps the project name whole.

## Acceptance

- No row that needs zero research appears inside the ranked research list.
- Zero-cost rows show no research cost, no per-research-point metric, and no leading project name.
- Each states whether it is a refit or a build.
- The two blocks are visually distinct without a shared ranking.
- COMMAND stays under 3.00 screens at 1920×1080; report the measured number.

## Also worth fixing while in this file

`--text-muted` and `--text-dim` are **defined self-referentially** at `public/v2/css/mission-control.css:38-39`:

```css
--text-muted: var(--text-muted);
--text-dim: var(--text-dim);
```

A custom property defined as `var(--itself)` is invalid at computed-value time and falls back to `inherit`, so both resolve to the parent colour. Measured: `.ra-row__sub` styled `color: var(--text-muted)` computes to `rgb(230, 238, 234)` — identical to `--text`, so the de-emphasis does nothing.

`var(--text-muted)` appears in 58 rules and `var(--text-dim)` in 106, so this is not confined to this panel. The real definitions exist at line 15; the aliases at 38-39 destroy them. Verify the fix by computing a style, not by reading the CSS.
