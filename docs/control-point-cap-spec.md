# Control point cap — the constraint the engine ignores

Written 2026-08-22 against `866b8a8`. **Revised 2026-08-22 after implementation against `f451945`;
the revision corrects three claims in the original and records the outcome.**

The dashboard tracks how many control points the observer holds. It has **no concept of a
cap**, and the directive engine actively recommends taking more — "Take the Executive
control point in Madagascar" sits in the live cycle plan. Exceeding the cap is not a soft
penalty.

---

## Outcome, in one paragraph

Every contribution to the cap is now located, cited and attributed, and the maintenance cost
formula is cited too. The **absolute cap is still not established**: the composed figure
disagrees with the only figure the game itself records, and the disagreement grows over time.
`shared/controlPointCap.mjs` therefore reports the composition, reports the recording,
reports the residual, and **refuses the headroom verdict**. No rule was added to the
directive registry and no recommendation changed. See "What did not reconcile" below.

---

## The mechanic

From the wiki (`Aliens`, raw wikitext, read 2026-08-22 at `wiki.hoodedhorse.com`, the
publisher's official wiki; the fandom mirror is 410):

> "Human Factions suffer increased vulnerability to Crackdown and Purge missions from
> exceeding their cp, as well as incur an annual influence upkeep equal to the excess
> amount squared."

Confirmed and made precise by `Nations`, section "Cost of Control Points" (raw wikitext,
read 2026-08-22), which states both penalties in the game's own terms:

- annual Influence income decreases by `overcap ^ 2`
- **Crackdown, Purge, Enthrall Elites and Dominate Nation** against the faction gain a
  bonus attack modifier of `overcap / 3`

The second is carried in the templates as
`TIMissionModifier_InsufficientCPMaintenance_Defender`, present on four missions in
`TIMissionTemplate.json`. The first is **quadratic**: three over cap costs 9 Influence/year,
ten over costs 100. A linear model of this is not an approximation, it is a different
mechanic.

## Councilor contribution — **three attributes, not one**

> **CORRECTION.** The original spec named only Persuasion. It is three.

From `Control Point Capacity` (raw wikitext, read 2026-08-22):

> "Every point of {{TV|administration}}, {{TV|persuasion}}, or {{TV|command}} on a
> [[Councilors|Councilor]] that is not {{MissionIcon|Detain}}[[Detain|Detained]] adds 1
> point of {{TV|cp}}."

The same page settles two things the original spec left open:

- **Orgs add no cp directly.** "They only help by improving Councilor attributes." So the
  right reading is the *resolved* attribute (base + org + trait, clamped 0–25), not the base
  one, and there is no separate org term.
- **Traits add no cp directly** either, for the same reason.
- **Events add none. Techs add none.**

Detention matters: a detained councilor contributes nothing while held.

## Hab modules — **a source the original spec missed entirely**

`TIHabModuleTemplate.json` carries `controlPointCapacity` on exactly three of its 156
modules:

```
AdministrationNode      controlPointCapacity  4
AdministrationTower     controlPointCapacity 12
AdministrationComplex   controlPointCapacity 30
```

All three also carry a `LEOControlPointCapacity` special rule, whose effect is **not
modelled** — no source read so far states what it does. Zero Administration modules exist
anywhere on the measured save, so this term is a measured zero for every faction today and
an untested code path.

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
derive a magnitude from a template's name; read `value`.

### Sign convention — **pinned, twice, by the shipped data**

A negative `ControlPointMaintenance` value **raises** the cap by its magnitude. Two
independent facts in the templates say so:

1. All five effects carry `"showTotal": "Invert"` — the data instructing the UI to negate
   the total before displaying it. A stored −120 displays as +120.
2. `AI_projectRole: "ControlPointCap"` is shared by twelve projects. Nine grant these
   **negative** effects. The other three — `Project_AdministrationNode` / `Tower` /
   `Complex` — grant no effect at all; they unlock the hab modules above, whose
   `controlPointCapacity` is **positive**. The same AI goal served by a positive capacity
   and a negative maintenance is only consistent if negative maintenance means more cap.

`Effect_ControlPointMaintenanceBonus20` is defined but granted by **nothing** in any shipped
template. It is handled anyway.

### Read the effects from the game's own effect state, not from completed projects

`TIEffectsState.factionEffectsNames` carries each faction's active effects keyed by context.
It is authoritative in a way a `finishedProjectNames` sweep is not: **the Aliens hold four
`ControlPointMaintenance` effects granted by none of the 32 projects that grant them**,
because two of the five list `initialFactionsStr: ["AlienCouncil", ...]` and are handed out
at campaign start. A project sweep scores the Aliens at 0 and the effect state at 320.

## The base cap — **located, in the save, in two fields**

> **CORRECTION.** The original spec said "No per-faction cap field was found" and told the
> implementer to check `TIGlobalConfig.json` and `TIFactionTemplate.json`. Neither carries
> one — `TIGlobalConfig.json` is a 4.7 KB list of UI canvas names, and `TIFactionTemplate`
> has no cap field — but the save does.

```
TIGlobalValuesState.controlPointMaintenanceFreebies       400   (this campaign)
TIMetadataState.controlPointMaintenanceFreebieBonus       150   (every faction)
TIMetadataState.controlPointMaintenanceFreebieBonusAI       0   (AI factions, on top)
```

The wiki names both knobs under Customize Campaign (`Game_Options`, raw wikitext, read
2026-08-22):

> "**Base Control Point Capacity** — Decides the number of cp cap each faction starts with,
> which decides how many nations you can control before triggering over the CP cap penalty."
>
> "**AI bonus Control Point Cap** — Decides how much cp cap AI factions will receive, in
> addition to the base cp cap."

The same page adds that deactivating a faction raises the base by 50 and that the Starting
Nation Group option adds more. Both are already inside the save's stored numbers, so nothing
is recomputed from them.

**What is still unresolved:** which of the two save fields the game calls "the base" and
which "the bonus". `shared/controlPointCap.mjs` reports both by name and sums them, and
`BASE_CAP_UNRESOLVED` states the ambiguity rather than picking one. On this campaign the sum
is 550 for the player faction and 550 for the AI factions (the AI bonus is 0 here).

Note `controlPointMaintenanceFreebieBonus` is a **difficulty setting**, so its value is
campaign-specific. It is read from the save, never hard-coded.

## What else the save carries

- `numControlPoints` and `numControlPoints_unclamped` — **295 occurrences each, per nation,
  and identical on this save.** They are a nation's CP count, not a faction cap.
- `StartOfTurnNativeControlPoints` — 295, all zero.
- `TIGlobalValuesState.fixedPCGDPToRaiseBaseCPMaintenanceCostBy1` — 994,239,000. A
  campaign-start normalizer whose role is **not established**; it is not used.
- `TIGlobalValuesState.repairCPMaintenanceScaling` — false. Role not established; not used.
- **`TIFactionState.history_CPCapOverageByDay`** — a 32-slot array of the game's own overage
  figure per faction. This is the field that broke the model. See below.

## The cost side — and the order-of-magnitude puzzle it explains

From `Nations`, section "Cost of Control Points" (raw wikitext, read 2026-08-22):

> ```
> Total Cost of Control Points = (GDP in billions) ^ 0.6 / 2
> ```
> "This total cp cost is divided up evenly among all the control points of the nation."
> "Control points that have sustained a Crackdown or are abandoned do not cost any cp."

**The second line is what an earlier attempt dropped**, and it is the whole of the
232-versus-2,493 puzzle recorded in the knowledge base on 2026-08-20. Costing 23 held control
points at the *undivided* national total gives ~2,493 against a councilor-derived capacity of
~232. With the division applied and the base cap included, the two sides are the same size:
the observer's modelled cost is **456.7** against a modelled cap of **846**. The
order-of-magnitude gap was an arithmetic omission plus a missing base, not a units mismatch.

GDP in the save is in **raw dollars**, so `GDP / 1e9` is the billions the formula wants.
Cross-checked against the wiki's own control-point-count formula
`max(1, min(round(GDP_Bn^0.18 / 1.09), 6))`, which reproduces the save's `numControlPoints`
on every nation checked except India — and India sits at 21,068 Bn against the table's
20,944 Bn boundary, i.e. it has just crossed and the game has not yet added the sixth point.

## What did **not** reconcile

`history_CPCapOverageByDay` is the game's own record, and the composed model disagrees with
it. Measured 2026-08-22 against MD5-verified frozen copies of two saves:

| | `CombatAutosave.gz` 7/15/2034 | `ExitSave.gz` 1/1/2035 |
| :-- | --: | --: |
| Protectorate modelled maintenance cost | 853.52 | 872.47 |
| modelled cap (base 400 + councilors + projects) | 840 | 842 |
| modelled overage | 13.52 | 30.47 |
| **the save's own recorded overage** | **5.16081** | **10.02051** |
| cap implied by the recording | 848.36 | 862.45 |

Between the two saves the Protectorate's roster, org loadout and completed-project list are
identical; two councilors each gained one attribute point, so the modelled cap moves by
**2**. The cap implied by the recordings moves by **14.09**. Nothing modelled moved by
fourteen. Solving the two equations for a different cost exponent gives `p = 0.5041` with a
base cap of **−88**, so no exponent rescues it either.

Two further measurements bound the problem:

- **The recording's semantics are themselves unverified.** Its sibling
  `history_MCCapOverageByDay` does not equal (usage − capacity) for Mission Control on the
  same save: the Servants record **7** while every reading of their usage and capacity puts
  them hundreds over, and the Aliens record **0** at 420 MC of usage. So a recorded 0 is not
  evidence a faction is within cap, and a recorded value is not evidence of the exact excess.
- **The one inequality that does hold** is consistent with a base near 400: on
  `initiative.gz` (9/10/2029) the Servants cost 585.98 at zero recorded overage, which forces
  base ≥ 388.

**Conclusion: do not gate advice on a derived cap.** The knowledge-base note of 2026-08-20
reached the same conclusion for a different (and now-explained) reason; it still stands.

---

## What was built

`shared/controlPointCap.mjs` — the composition, per faction, with every term attributed:

- base cap from the save's own two fields, each named
- every non-detained councilor's Administration + Persuasion + Command, per councilor
- every completed Administration hab module, named with its hab
- every `ControlPointMaintenance` effect, with its stored value and its cap contribution
- the maintenance cost per nation, with the per-control-point division shown and
  crackdown/abandoned holdings excluded with a reason
- the save's own recorded overage, labelled with its unverified semantics
- the residual between the two, and `reconciles: false`
- `headroom.available: false` **always**, with a reason
- the quadratic Influence penalty and the `overage / 3` mission exposure, from both the
  recorded and the modelled overage, each labelled

`shared/intel/controlPointCap.mjs` — `/api/intel/control-point-cap`, one registry row,
appended rather than slotted so no existing example is renumbered.

### Absent stays null, everywhere

Four separate refusals, each with a deliberately-broken test proving it fires:

- **No base** → the whole cap is unknown, never 0 and never "no limit".
- **A short roster** → unknown. Player mode publishes 0 of the Aliens' 6 councilors and 4 of
  the Protectorate's 6, so summing the visible rows would delete the single largest term and
  present the remainder as a total. Checked against the faction's own `councilorsCount`; an
  unreadable headcount makes completeness *unverifiable*, which is treated as incomplete.
- **A faction with habs but no visible hab-module rows** → unknown. Player mode publishes
  every faction's habs and only the observer's modules (the Servants: 50 habs / 0 modules in
  player mode, 50 / 574 in omniscient).
- **An absent effect list** → unknown, while an empty one is a measured zero.

### Both modes

The observer's own cap composes **identically** in player and omniscient mode (846 either
way, same per-councilor breakdown). Every rival's cap **refuses** in player mode on all three
grounds above, and their recorded overage and effect list are redacted to `null` — added to
`assertPlayerSnapshotSafe` so a future field beside them fails loudly. The player-mode payload
is scanned end-to-end for a rival's recorded overage value, not pinned to one field.

### The engine: an annotation, not a rule

Every control-nation candidate now carries `value.controlPointMaintenance` — what that
control point would add to maintenance, from the nation's own control-point count. Madagascar's
Executive costs ~3 cp; one of the USA's six costs ~39.

**No rule was added to the registry, and registry order is untouched.** A veto or cost rule
would have to test against a cap that does not reconcile, and a veto built on a fabricated
ceiling rejects real recommendations. The marginal figure *is* sound — it does not depend on
the base cap at all — so it is published as data a reader can compare across candidates,
with no claim about affordability.

**No recommendation changed.** The cycle plan is byte-identical before and after in both
modes: primary "Advise Government: United States of North America" at 6.997422015983501, the
same five assignments in omniscient and three in player, totalExpectedValue 21.41 / 19.3, and
"Take the Executive control point in Madagascar" still benched at 5.63.

### A defect found and deliberately not fixed here

`value/gdp-per-cp-cost` in `server/engine/rules/value.js` divides a nation's output by its
control-point count but charges one control point the **whole nation's** cost, under-valuing
every multi-CP nation by a factor of 1–6. Correcting it makes the count cancel entirely
(`valueDensity = 2 × gdpBn^0.4`) and re-weights the expansion family by up to 6×: measured,
the omniscient primary flips from "Advise Government: USA" (6.997) to "Purge the Protectorate
hold on ExtractiveSector in China" (20.92 → **140.50**), two councilors are reassigned, and
totalExpectedValue goes 21.41 → 148.89. `WEIGHTS.VALUE_POINTS` was calibrated against the
buggy magnitude, so the fix needs a deliberate recalibration alongside it. Filed separately
rather than landed here.

## Still unmodelled, named rather than guessed

- Which save field is "the base" and which "the bonus".
- `LEOControlPointCapacity` on the three Administration modules.
- `fixedPCGDPToRaiseBaseCPMaintenanceCostBy1` and `repairCPMaintenanceScaling`.
- The exact semantics of the `history_*CapOverageByDay` family.
- Whether the cap uses attributes clamped at 25 or uncapped. Both were tried against the
  Protectorate equations; neither reconciles (implied base 420.45 clamped, 408.45 uncapped,
  against a candidate base of 400).

## Acceptance — as met

- **The base cap is located and cited.** `TIGlobalValuesState.controlPointMaintenanceFreebies`
  plus the two campaign-setting fields, cited to `Game_Options`. The original spec's claim
  that no cap field exists is corrected.
- **The sign convention is pinned by measurement**, twice, from `showTotal: "Invert"` and
  from the shared `AI_projectRole` between negative-effect and positive-capacity projects.
- **The observer's cap is reported with each contribution attributed.** It does **not**
  reconcile against the save's own recorded overage, and that is reported as the headline
  rather than smoothed over.
- **Over-cap upkeep is squared**, with `overCapInfluencePenalty(10) === 100` asserted and the
  linear form broken deliberately to prove the test fires.
- **An unknown cap renders as unknown on every surface** and blocks no recommendation into a
  false "free": `headroom.available` is false unconditionally.
- **Both modes**, with rival caps omniscient-only and the redaction scanned across the whole
  player payload.
- **No directive recommendation changed**, before/after captured in both modes.
- No `null` / `undefined` / `NaN` / confident `0` reaches a surface.
