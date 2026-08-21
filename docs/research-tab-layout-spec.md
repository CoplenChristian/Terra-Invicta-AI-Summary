# Research Advisor — Layout and Legibility

Written 2026-08-21 against `bbef9f0`. Presentational only: **no model, ranking, or copy-semantics changes.**

The panel's content is right. It is unreadable because the type has no scale, the two
columns are wildly unbalanced, and a global state badge is repeated on every row.

---

## Measured

Two viewport widths are reported separately because the in-app browser pane would not
hold 1920 — `resize_window` reported success, the first reading landed at 1920×1080, and
every later reading reverted to 747. **The 1920 figures below come from that single
successful sample; the 747 figures are the responsive fallback.** Anything width-independent
(type sizes, tag inventory, token availability) is stated once and holds at both.

### Eight font sizes in one panel

Width-independent. Measured over `.research-advisor *`:

```
6.25px   4 elements   (unclassed spans)
7.00px   9            .ra-tag
7.50px  36            .ra-deficit__label, .ra-deficit__judgement, .ra-queue, .ra-queue__capacity
8.00px   9            .ra-row__metric, .init-btn
8.50px   3            .ra-deficit__detail
9.50px   2            .ra-row__sub
10.00px  9            .ra-row__name
13.00px 33            .ra-deficit, .ra-tracks, .ra-track (inherited)
```

Five of the eight sit **at or below 8.5px**. `6.25px` and `8.5px` are effectively
accidents — three elements and four elements respectively. The gaps between steps are
0.5px in places, which is below the threshold at which a reader perceives hierarchy at
all: it reads as noise, not as ranking.

This is not confined to the panel. Across `public/v2/css/mission-control.css`:

```
310 font-size declarations
 20 distinct px values, including 7.5 / 8.5 / 9.5 / 10.5 / 11.5
```

**Root cause: there are no size tokens.** `:root` defines colour tokens (`--text`,
`--accent`, `--danger`, …) and three font families, and **nothing for size or spacing**.
Every rule therefore hardcodes its own px value, and nothing keeps them consistent.

### The right column is 41% dead space

At **1920×1080**:

```
.research-advisor      798 × 336
.ra-tracks             778 wide, grid-template-columns: repeat(2, minmax(0,1fr))
  MILITARY RESEARCH    383 × 234   5 rows, 2 groups
  ECONOMIC             383 × 137   3 rows, 2 groups
```

`align-items: start` (line 6742) leaves **97px — 41% of the taller column — empty** under
ECONOMIC. That hole is the single most visible defect in the screenshot, and it is
structural: the two tracks will essentially never have equal row counts, because military
and economic candidates are ranked independently.

### A global badge rendered per-row

Eight `.ra-tag` elements render; **four are the identical string `BACKLOGS ACTIVE`**:

```
FAILS DELIVERY · 4S OF FIRE · BACKLOGS ACTIVE · BACKLOGS ACTIVE
CLOSES GAP · FAILS FLOOR · BACKLOGS ACTIVE · BACKLOGS ACTIVE
```

`BACKLOGS ACTIVE` is a property of the **campaign**, not of the row it sits on — it is
true for every row simultaneously. Half the badge weight in the panel therefore carries
zero discriminating information, while the badges that *do* discriminate
(`FAILS DELIVERY`, `FAILS FLOOR`, `CLOSES GAP`) are rendered at identical 7px weight and
get lost among them.

### Truncation

One row truncates at 747px (`.ra-row__metric`, needs 180px, has 176px):
`3.00× sustained output per hardpoint (MW)`. At 1920 a different row truncates
(`.ra-row__name` — `Superconducting Batteries (Superconducting Coil Batt…`). Both are
marginal overflows of a few px, which is what a fixed two-column grid at an arbitrary
width produces.

---

## What to change

### 1. Introduce size tokens, and use them here

Add a type scale to `:root` and express every `.ra-*` size through it. Four steps are
enough for this panel:

| token | role | rows it replaces |
| :-- | :-- | :-- |
| `--fs-row` | the item name — the thing being decided | 10px |
| `--fs-metric` | the number that justifies it | 8px, 9.5px |
| `--fs-meta` | cost, timing, provenance | 7.5px, 8.5px |
| `--fs-tag` | badges | 7px, 6.25px |

Pick the actual values to open the gaps — adjacent steps that differ by 0.5px do not
read as hierarchy. **Raise the floor**: nothing in this panel should render below ~9px.
The panel is dense because there is a lot to say, and the current answer to that was to
shrink type until it fit; the answer in §3 is to cut what does not need saying instead.

Scope the token rollout to `.ra-*` in this change. The other 250-odd declarations are a
separate job — but define the tokens globally so that job is a find-and-replace later.

### 2. Balance the two tracks

The columns will not have equal content, so stop pretending they might. Any of these is
acceptable; pick one and report which:

- **Let the shorter column stop, and reclaim the space** — move the census/footnote block
  (§3) under ECONOMIC so the dead 97px carries something.
- **Equal-height tracks** with the shorter one's remaining space given to its own census.
- **Single ranked column** with military and economic interleaved but visibly labelled —
  only if the two axes stay non-comparable and unranked against each other, which
  `research-vs-procurement-spec.md` requires.

**Do not** simply set `align-items: stretch`; that stretches the container and leaves the
hole inside it.

### 3. Demote what does not discriminate

- **`BACKLOGS ACTIVE` moves out of the rows.** It is campaign state and belongs once, in
  the header line that already carries `ALL 3 PROJECT SLOTS ACTIVE`.
- **The remaining badges get real weight.** `FAILS DELIVERY` / `FAILS FLOOR` are verdicts
  that change the recommendation; `CLOSES GAP` is the reason a row is ranked first. They
  should be distinguishable from each other at a glance — the existing
  `--danger` / `--warning` / `--accent` tokens already differentiate them, but 7px erases
  the distinction.
- **The census line is a footnote and should look like one.**
  `15 of 82 ranked · 10 no gain · 10 buildable now · 7 cost unknown · 40 no baseline`
  currently sits mid-flow at 7.5px. It is provenance, not a recommendation. Keep it —
  truncation must announce itself, per `CLAUDE.md` — but set it apart from the ranked rows.
- **The orphan comparison sentence** (`66 ranked below their damage: Antimatter Torpedo
  Launcher — 3.62× the point-defence fire per round of Copperhead Missile Bay`) wraps to
  two lines and reads as a stray paragraph. Give it the same footnote treatment.

### 4. Let long labels wrap rather than truncate

Both observed truncations are overflows of under 30px. A two-line row name is better than
a clipped one, and `research-row-naming-spec.md` requires the **project** name to survive
— which is precisely what a right-edge clip removes.

---

## Constraints

- **Presentational only.** No change to ranking, to which rows appear, or to the wording
  of a verdict. If a fix seems to require a model change, stop and flag it.
- **Both modes.** Player and omniscient — `CLAUDE.md` is explicit that a feature verified
  in one is not verified. Player mode redacts enemy designs, so the deficit banner
  (`13.0 km/s ours vs 213.1 km/s alien`) may be absent; the layout must not collapse.
- No `null` / `undefined` / `NaN` in rendered text.
- `--text-muted` and `--text-dim` were fixed at `mission-control.css:15-18` after being
  defined self-referentially; **verify by computing a style, not by reading the CSS.**
- The WCAG note at line 16-17 constrains `--text-dim` against `--surface`. Raising the
  type floor does not license lowering contrast.
- Do not touch `public/index.html` (legacy v1).

## Acceptance

- **At most four distinct font sizes** render inside `.research-advisor`; none below 9px.
  Verify by the same DOM sweep used above, not by reading the stylesheet.
- Size tokens exist in `:root` and every `.ra-*` `font-size` references one.
- No column ends with more than ~15% of the panel's height empty, at 1920 and at 747.
- `BACKLOGS ACTIVE` appears **at most once** in the panel.
- No `.ra-*` leaf element has `scrollWidth > clientWidth` at 1920, 1280, or 747.
- The census and comparison footnotes are still present and still state their totals.
- Both modes render; report the measured screen count for COMMAND at 1920.
- 798 tests still pass.

## Note on measuring this

The in-app browser pane would not hold 1920 in this session — it accepted the resize once,
then reverted to 747 on every subsequent call. Whoever implements this should confirm the
viewport with `innerWidth` **in the same call** that takes the measurement, rather than
trusting a prior `resize_window`. Two of the numbers in my first pass were width-mismatched
and had to be discarded.
