# Control point cap — what the game records, and the cap that follows from it

Written 2026-08-22 against `866b8a8`. **Revised 2026-08-22 after implementation against `f451945`.
Revised again 2026-08-22 against `43f170f`, and this revision overturns the previous one's
central conclusion: the cap does reconcile, and the headroom verdict is no longer refused.**
**Revised a fourth time 2026-08-22 against `4f2f5b1` to record the owner's intel-model decision
below — a rival's cap position is no longer locked behind omniscient.**

---

## The 2026-08-22 intel-model decision — this is the owner's call, not a bug fix

**The dashboard's owner decided on 2026-08-22 that the faction control-point cap does not need to
be locked behind omniscient.** `7174764` refused a rival's cap in player mode on three grounds and
redacted the game's own daily recording with it; `4f2f5b1` kept that. The refusal was correct code
implementing a stricter intel model than its owner wants, so what changed is the model, not a
defect. **A future reader should not "restore" the redaction as a leak fix.** It is recorded in
three places for that reason: the header of `shared/controlPointCap.mjs`, the faction projection in
`server/intelligenceFilter.js`, and here.

The unlock is narrow, and it turns entirely on the distinction between the two bases the previous
revision introduced:

| | reads | player mode, for a rival |
| :-- | :-- | :-- |
| **`recorded`** | `history_CPCapOverageByDay` only | **published.** It composes nothing — no councilor attribute, no hab module, no effect list — so unlocking it unmasks no input, only a conclusion the save states outright |
| **`composed`** | base + councilors + hab modules + effects, against the cost | **still refuses.** Those terms genuinely are unreadable, and it refuses as `unknown` — never as a number and never as a measured zero |

**Councilor attributes stay masked.** Nothing reads through `maskedAttributes`;
`councilorCapContribution` still reports an unmeasured councilor as `null`, and
`assertPlayerSnapshotSafe` still throws on a rival's raw `attributes`.

### A floored zero is not headroom

This is the part that had to be got right, and it is the same shape as the Total War veto and the
vent horizon: **an unmeasurable state reported as a reassuring one.**

Each slot is `max(0, cost − cap) × multiplier`, so a recorded **zero is the floor**. It pins that
the faction is not recorded *over* cap and locates nothing — and for the aliens it does not even
bound, since they read 0 while sitting 10 and 11 over their Mission Control capacity on two measured
saves. `recordedCapPosition` therefore classifies the recording as one of three things, and every
row publishes it as `recorded.establishes`:

| `establishes` | when | what follows |
| :-- | :-- | :-- |
| `position` | a **positive** penalty | over cap by exactly 3 × it. Exact, mode-independent |
| `bound-only` | a **zero** on a non-exempt faction | bounded at or under cap, **not located**. Verdict `unknown` unless the composed cap supplies the magnitude |
| `nothing` | the alien faction | an exemption artefact; not even a bound |

Publishing the recording made `recorded.available` true with a floored zero, and the refusal
branch's old `overCap: recordedAvailable ? false : null` would have flipped **six rivals from an
honest `null` to a confident "not over cap"** as a pure side effect of the unlock. `overCap` is now
`null` wherever the headroom refuses, and a deliberately-broken test (`M3`) proves the old
expression turns that test red.

### Measured before and after, live save `ExitSave.gz` (1/1/2035), player mode

| faction | before | after | basis | why |
| :-- | :-- | :-- | :-- | :-- |
| the Initiative (observer) | 237.70, `within-cap` | **237.70, `within-cap`** | `composed` | unchanged — the observer's own terms were always readable |
| **the Protectorate** | `unknown` | **−34.34, `over-cap`** | **`recorded`** | the save records a positive penalty; identical to the omniscient figure |
| the Aliens | 20000, `within-cap` | 20000, `within-cap` | `alien exemption` | unchanged — a hard-coded constant, not intel |
| the Resistance | `unknown` | `unknown` | — | records **0**: `bound-only`. `overCap: null`, not `false` |
| Humanity First | `unknown` | `unknown` | — | as above |
| the Servants | `unknown` | `unknown` | — | as above |
| the Academy | `unknown` | `unknown` | — | as above |
| Project Exodus | `unknown` | `unknown` | — | as above |

Endpoint totals move `answered 2 → 3` and `overCap 0 → 1`; `refusedCount` stays 6, and the five
bound-only rivals are now counted separately under the new `boundOnlyCount` so a consumer can tell
"not recorded over cap, magnitude unknown" from "nothing known at all".

The Protectorate is paying **1,179 Influence a year** and hands our Crackdown / Purge / Enthrall
Elites / Dominate Nation against it **+10.64** — the 32-day window mean the game applies, not
today's 11.45. Both figures now reach player mode.

### Omniscient did not move

The omniscient **snapshot** is byte-identical. The omniscient **endpoint** diff is **purely
additive** — not one line removed and not one reworded — gaining only `recorded.establishes`,
`recorded.establishesNote`, `boundOnlyCount: 0`, `boundOnlyFactions: []` and
`recordingSemantics.establishes`. A field-by-field numeric comparison over all 2,588 pre-existing
numbers shows **none moved**. (The `recorded`-basis `reason` string was left word for word as it
was, deliberately: rewording it would have been the single non-additive omniscient difference, and
the clause it wanted already travels on the new `establishesNote`.) The engine briefing is
byte-identical in **both** modes, as
are `/latest-snapshot.md`, the full markdown report and `/latest-threats.md` — the only differing
files in the whole capture are the two war-room exports, and both diffs are purely additive.
(Captured against an MD5-verified frozen `ExitSave.gz`, with two identical baseline runs proving
the harness deterministic.)

### It reaches the AI surfaces — the gap `4f2f5b1` left open

`4f2f5b1` shipped the whole model and put **none** of it in the exports, and said so. A block now
sits inside war-room **§7 Logistics & War Economy**, carrying the observer's own headroom with its
accuracy caveat, any rival the game records over cap with the Influence bill and the mission bonus,
and an explicit announcement that a recorded zero bounds without locating.

Rival cap positions belong there because an over-cap rival is a **targeting fact**: it is what makes
a hostile Purge against them cheaper, and it is derivable from nothing else in the document.
**Byte cost: 1,077 bytes in player mode and 748 in omniscient**, against a 30,720-byte budget with
6,046 / 6,406 bytes of slack remaining. **Nothing was dropped to fit it**, and the block rides
inside section 7's body so the last-resort clamp can shed it with the rest.

It is not in `/latest-snapshot.md` or `/latest-threats.md`: the compact snapshot is a state
inventory rather than an economic one, and the cap is a war-economy figure that belongs beside the
mine multipliers it now sits under. The whole model lives in `shared/`, so the Cloudflare Worker
renders this exactly as the local server does — unlike the engine-derived sections, which the
serving runtime has to hand in.

---

## Outcome, in one paragraph

The previous revision could not reconcile the composed cap against the game's own record and
refused the headroom verdict — correctly, given what it knew. It knew the wrong thing about the
record. `history_CPCapOverageByDay` is **not** the overage and its last slot is **not** the most
recent sample: it is a 32-day window, newest first, of the **mission-defence penalty**, which is
the overage divided by three. Read correctly, and with three consequent corrections to the model,
the composition now reproduces the game's own figure to within **about one point in eight
hundred**, and the residual does not grow. `shared/controlPointCap.mjs` emits `headroom.available:
true` from one of two named bases, with the measured residual travelling beside it.

---

## What `history_CPCapOverageByDay` actually records

This is the question the previous two attempts assumed the answer to. It was measured on
2026-08-22 by reading the shipped assembly directly —
`TerraInvicta_Data/Managed/Assembly-CSharp.dll`, campaign version 1.0.51 — with a minimal
PE/CLI metadata reader, and then corroborated three independent ways.

```csharp
TIFactionState::GetOneDayControlPointCapMissionPenalty()
    float over = GetBaselineControlPointMaintenanceCost(false)
               - GetControlPointMaintenanceFreebieCap();
    return over > 0f ? over * global.TIMissionModifier_ControlPointOverage_Multiplier : 0f;

TIFactionState::GetAveragedControlPointCapPenaltyToMissions()
    return history_CPCapOverageByDay.Average();
```

`TIGlobalConfig::.ctor` initialises `TIMissionModifier_ControlPointOverage_Multiplier` to
`0.3333333432674408f`. So, answering the questions the brief posed one at a time:

| question | answer |
| :-- | :-- |
| instantaneous, mean, accumulator or decayed? | **Instantaneous daily sample.** One slot written per in-game day; no smoothing inside a slot. |
| is it per-day, and what does the length say? | **Per day, 32 slots, newest first.** Slot 0 is today, slot 31 is 31 days ago. |
| capped or floored? | **Floored at 0, never capped.** `over > 0 ? … : 0f`. The Servants' "7 while hundreds over" was a 31-day-stale slot, not a clamp. |
| does it reset? | No reset found; it shifts one slot a day. |
| the aliens' 0 — exempt, or unmaintained? | **Exempt.** `GetControlPointMaintenanceFreebieCap()` returns a hard-coded `20000f` for the alien faction, and `GetAnnualControlPointMaintenanceCost()` returns 0. |
| what is stored? | **`max(0, cost − cap) × 0.3333…` — the mission-defence penalty, not the overage.** |
| what does the game *apply*? | **The mean of the whole 32-day window**, not slot 0. |

### The three corroborations, none of which needs the assembly

**1. Slot ordering, from save-to-save alignment.** Four saves of one campaign, MD5-verified frozen
copies. Each array is the same series shifted by exactly the number of days between the saves:

| pair | in-game gap | measured slot offset |
| :-- | --: | --: |
| `Autosave3` 12/1/2034 → `Autosave2` 12/16/2034 12:00 | 15.5 d | 16 |
| `Autosave2` 12/16/2034 12:00 → `Autosave` 1/1/2035 | 15.5 d | 15 |
| `Autosave3` 12/1/2034 → `ExitSave` 1/1/2035 | 31 d | 31 |

`Autosave3`'s slot 0 (`10.02051`) is `ExitSave`'s slot **31**. That is precisely the value the
previous revision quoted as `ExitSave`'s "recorded overage". It was a month old. The same offsets
hold in `history_MCCapOverageByDay`, so the two share one convention.

**2. The Mission Control sibling reconciles exactly.** The brief was right that MC is the better
place to crack it — but the repo's `missionControlCapacity` (a sum over the faction's nations) is
not the game's capacity. The save states its own: `TIFactionState.cachedYearlyRevenue.MissionControl`.
Against that, `history_MCCapOverageByDay[0] === max(0, missionControlUsage − capacity)` **exactly**:

| faction | usage | capacity | usage − capacity | recorded slot 0 |
| :-- | --: | --: | --: | --: |
| the Resistance | 116 | 190 | −74 | 0 |
| Humanity First | 152 | 179 | −27 | 0 |
| the Initiative | 161 | 182 | −21 | 0 |
| **the Servants** | **374** | **371** | **+3** | **3** |
| the Protectorate | 186 | 226 | −40 | 0 |
| the Academy | 87 | 93 | −6 | 0 |
| Project Exodus | 71 | 116 | −45 | 0 |
| **the Aliens** | **420** | **410** | **+10** | **0** |

(`ExitSave.gz`, 1/1/2035. `CombatAutosave.gz` 7/15/2034 gives the same shape: everyone under and
recording 0, the Aliens 11 over and recording 0.) Seven human factions on the nose; the aliens
over and recording nothing. The multiplier is 1 for Mission Control and a third for control
points, which is why MC recorded integers and CP did not.

**3. The game says so in its own shipped strings.** `UIGeneralControls.en`:

> `UI.GeneralControls.CPCapOverageCurrent` — "…This value is averaged from how much we have been
> over the cap during the last month."

and `UINations.en` gives the whole Control Point Capacity panel, which is the composition this
model follows term for term: `CPMaint4` Base Cap, `CPMaint5` Bonus from Research, `CPMaint10/11/12`
Bonus from Councilors' Administration / Command / Persuasion, `CPMaint13` Bonus from Habs,
`CPMaint7` Each Cost Against Cap, `CPMaint8` `{nation} {n}x{each} = {total}`.

---

## The formula, from the game's own methods

```csharp
TINationState::get_ControlPointMaintenanceCost           // per control point
    if (alienNation) return 0f;
    return Mathd.Pow(GDP / TIGlobalValuesState.PCGDPToRaiseBaseCPMaintenanceCostBy1,
                     globalConfig.controlPointCostScaling)
           / (global.controlPointMaintenanceDivisor * numControlPoints)
           * GameStateManager.Time.template.CPMaintenanceModifier;

TIControlPoint::get_CurrentMaintenanceCost
    return benefitsDisabled ? 0f : BaselineMaintenanceCost;

TIFactionState::GetControlPointMaintenanceFreebieCap
    if (IsAlienFaction) return 20000f;
    int b = GlobalValues.controlPointMaintenanceFreebies
          + (isActivePlayer ? 0 : scenarioCustomizations.controlPointMaintenanceFreebieBonusAI)
          + activeCouncilors.Sum(c => c.controlPointCapacity)
          + habs.Sum(h => h.controlPointCapacityValue);
    return b - TIEffectsState.SumEffectsModifiers(ControlPointMaintenance, this,
                                                  GlobalValues.controlPointMaintenanceFreebies, null);

TIFactionState::AvailableCPCapSpace                       // the game's own headroom
    return GetControlPointMaintenanceFreebieCap()
         - controlPoints.Sum(cp => cp.CurrentMaintenanceCost);

TIFactionState::GetAnnualControlPointMaintenanceCost
    if (IsAlienFaction) return 0f;
    float over = cost - cap;
    return over > 0f ? over * over : 0f;
```

Constants, from `TIGlobalConfig::.ctor` and `TIStartTimeTemplate::.ctor`:

```
controlPointCostScaling                            0.6f
controlPointMaintenanceDivisor                     2f
TIMissionModifier_ControlPointOverage_Multiplier   0.3333333432674408f
CPMaintenanceModifier                              1f   (overridden by none of the 5 start times)
```

`TICouncilorState::get_controlPointCapacity` is exactly three `GetAttribute` calls summed, and
`get_active` is `status == Active && !detained` — so the wiki's councilor rule is confirmed from
the code as well.

### Three corrections this forces on the previous model

**1. The base cap is `controlPointMaintenanceFreebies` alone — 400, not 550.** The previous
revision summed it with the `controlPointMaintenanceFreebieBonus` campaign setting (150) and
recorded the choice between them as unresolved. The cap method never reads the setting: it is the
Customize Campaign knob that produced the stored value. `UI.StartScreen.CustomizeCampaign.CPFreebiesTooltip`
says so in the game's own words — "Base Control Point capacity for all factions". Only the
AI-only sibling is added, and only for factions the human is not playing. **This was a 150-point
error on a cap of 841.**

**2. The cost divides GDP by `fixedPCGDPToRaiseBaseCPMaintenanceCostBy1`, not by 1e9.**
`TIStartTimeTemplate.scaleCPMaintenanceWithStartingGDP` is `true` on all five shipped start times,
and `get_pcgdpToRaiseBaseCPMaintenanceCostBy1` then freezes `globalGDP_CampaignStart × 6.26e-6`
for the campaign — 994,239,000 here, implying a campaign-start world GDP of $158.8 trillion. It
returns a flat 1e9 only when that flag is false. The previous revision listed this field under
"not established"; it is the divisor.

**3. Only `benefitsDisabled` makes a control point free.** `CurrentMaintenanceCost` tests that flag
and nothing else, and `SetCrackdownExpiry` writes no such flag. The wiki's "control points that
have sustained a Crackdown … do not cost any cp" is **not** reproduced by the 1.0.51 code path.
Crackdown-only holdings are therefore charged, and counted under `crackdownChargedCount` so the
disagreement is visible rather than settled by preference. The observer holds none on the measured
save, so nothing here turns on it.

Two smaller ones: the divisor is `TINationState.numControlPoints` (which survives redaction), not
the projected control-point list, whose length can be short in a filtered mode; and an alien
nation's control points cost zero outright.

---

## How well it reconciles

The Protectorate is the only faction over cap on any measured save, so it is the only faction
whose cap the recording pins. Cap implied by `cost − 3 × penalty` against the composed cap:

| save | campaign date | modelled cost | slot 0 | implied cap | composed cap | residual |
| :-- | :-- | --: | --: | --: | --: | --: |
| `CombatAutosave.gz` | 7/15/2034 | 856.48690 | 5.829041 | **838.99978** | 840 | +1.00022 |
| `Autosave3.gz` | 12/1/2034 | 871.18025 | 10.02051 | 841.11872 | 842 | +0.88128 |
| `Autosave2.gz` | 12/16/2034 | 873.24422 | 10.67072 | 841.23206 | 842 | +0.76794 |
| `ExitSave.gz` | 1/1/2035 | 875.50316 | 11.44552 | 841.16660 | 842 | +0.83340 |

The implied cap on the first save is an integer to four decimal places — **838.99978 against a
true cap that must be an integer, because every term is one**. The cost formula is therefore
exact, and the whole residual lives in the cap. The true cap is 839, then 841 after two councilor
attribute points; the composition reads 840 then 842, i.e. **+1 in every window, and it does not
grow across six in-game months**.

(Reading the raw save fields directly rather than the projected snapshot moves the cost by about
1.7e-4 — the snapshot rounds GDP. It does not move any conclusion.)

The unmodelled point is councilor-attribute resolution: this repo's `resolvedAttributes.effective`
clamps at 25, while the game's `GetAttribute` call for cap purposes raises its own ceiling by each
*negative* bonus instead. One point on a six-councilor roster. It is reported in
`CONTROL_POINT_CAP_ACCURACY` and **not** subtracted out — correcting a measured bias by fitting it
away is exactly what this brief forbade.

A second, one-sided check: every faction the game records at or under cap is composed at or under
cap, on every save measured — 6 saves × 7 human factions, no violation. With the 150-point base
double-count that check passed vacuously; at base 400 the tightest case is the Servants on
`initiative.gz` (9/10/2029), costing 588.01 against a composed 598 — a margin of 9.99 where the
double-count would have shown 159.99.

### Why the previous revision's numbers looked hopeless

It compared a cost at date *T* against a penalty from *T−31 days*, and read that penalty as the
overage. Both errors pull the same way. On `ExitSave.gz`, against a composed cap of 842:

| reading | implied cap | residual |
| :-- | --: | --: |
| slot 0, ×3 (correct) | 841.17 | 0.83 |
| slot 31, ×3 | 845.44 | 3.44 |
| slot 0, ×1 | 864.06 | 22.1 |
| slot 31, ×1 (what was measured before) | 865.48 | 23.5 |

And the "disagreement grows" was the same artefact: the stale slot lags a rising series, so the
lag itself grows with the rate.

---

## What was built

`shared/controlPointCap.mjs` — the composition per faction, every term attributed, plus:

- `CONTROL_POINT_OVERAGE_PENALTY_MULTIPLIER` — the float32 literal, so the overage round-trips
- `readControlPointCostNormalizer` — the campaign GDP divisor, `measured: false` when absent
- `buildControlPointMaintenance` — per nation, with the divisor's source named
- `buildControlPointCapReport` — cap, cost, recording, reconciliation, headroom, penalties
- `CONTROL_POINT_CAP_ACCURACY` — the measured residual, its direction, and the unmodelled term

`server/snapshot/factions.js` publishes three figures where it published one stale third of one:
`controlPointCapPenaltyToday` (slot 0), `controlPointCapPenaltyAveraged` (the window mean, which
is what the game applies), and `recordedControlPointCapOverage` (slot 0 × 3).

`server/snapshot/nations.js` adds `controlPointCount` (the game's own divisor) and `alienNation`.

`shared/intel/controlPointCap.mjs` — `/api/intel/control-point-cap`, now headlining a verdict, the
observer's headroom, the over-cap factions, and a `recordingSemantics` block so an agent reading
the raw field can interpret it without this document.

### The headroom verdict, and the two bases it comes from

`headroom.available` is now **true**, from one of two bases that are named on every row because
they are not equally strong:

- **`recorded`** — the save records a positive penalty, so the faction is over cap by exactly three
  times it. Exact; no composed cap involved.
- **`composed`** — every cap term and the whole cost were measured. Carries `accuracy`.

It still refuses, loudly, in four cases: an unreadable cap term; a cost that is a floor because
some holding could not be priced; an unmeasured GDP normalizer (which blocks the composed basis
but not the recorded one); and a **contradiction** — a composed headroom below zero while the game
records zero cannot both be true, because the recording is floored at zero.

Measured on the live save, omniscient:

| faction | cap | cost | headroom | basis |
| :-- | --: | --: | --: | :-- |
| the Resistance | 773 | 725.58 | 47.42 | composed |
| Humanity First | 769 | 475.10 | 293.90 | composed |
| **the Initiative** | **696** | **458.30** | **237.70** | **composed** |
| the Servants | 900 | 474.39 | 425.61 | composed |
| **the Protectorate** | 842 | 875.50 | **−34.34** | **recorded** |
| the Academy | 788 | 267.05 | 520.95 | composed |
| Project Exodus | 670 | 304.05 | 365.95 | composed |
| the Aliens | 20000 | 0 | 20000 | alien exemption |

The Protectorate is paying **1,179 Influence a year** for being 34.34 over, and hostile Crackdown /
Purge / Enthrall Elites / Dominate Nation against it carry **+10.64** — the window mean, not
today's 11.45.

### Both modes

**Superseded in part on 2026-08-22 — see "The 2026-08-22 intel-model decision" at the top.**

The observer's own cap, cost and headroom compose **identically** in player and omniscient mode
(696 / 458.30 / 237.70 either way). *What follows described the behaviour before the owner's
decision:* every rival refused in player mode, and all three recorded figures — the overage, slot 0
and the window mean — were `null`, each asserted individually in `assertPlayerSnapshotSafe`.

**Since 2026-08-22** those four recorded fields are published in every mode; the `recorded` basis
answers for a rival and the `composed` basis still refuses. `assertPlayerSnapshotSafe` was
**retargeted, not loosened**: it still throws on a rival's `controlPointMaintenanceEffects` and on a
rival councilor's raw `attributes`, and the tests now assert **both directions** — that the four
recorded fields survive (so a silent re-redaction fails a test) and that the composed basis's three
inputs do not.

**One measurement corrected a test instrument while doing it.** The old whole-payload scan hunted
the composed inputs by *value*. That is sound for the recorded numbers and **unsound for the effect
names**: searching a clean player payload for `Effect_ControlPointMaintenance*` finds **68 hits** —
the observer's own row and its `capabilities.activeEffects`, plus 64 in the static `techTree` node
catalogue, which lists which projects *grant* each effect and says nothing about who *holds* one.
The names are a shared vocabulary, so the scan now walks the whole payload structurally, asserting
that every object carrying a `controlPointMaintenanceEffects` array is owned by the observer.
Councilor attributes and hab modules are checked structurally for the same reason — attribute values
are small integers that legitimately appear everywhere.

### The engine: still an annotation, for a different reason

Every control-nation candidate still carries `value.controlPointMaintenance`, and **no rule was
added to the registry**. The reason changed. It used to be that no honest threshold existed. It is
now that the threshold is not close: the observer has ~238 points of room against a dearest single
control point of ~39 and a Madagascar Executive of ~3. A cost rule would move no ranking and a veto
would fire on nothing, and a rule that does nothing today can start vetoing on a future save nobody
re-measured.

**No recommendation changed.** Captured before and after against an MD5-verified frozen
`ExitSave.gz`, both modes, with volatile fields stripped and two identical baseline runs proving
the harness deterministic: the only differing lines in the whole briefing are the annotation's
rounding (3 → 5 decimal places, same values) and its formula label. Primary, score, assignment
count and total expected value are byte-identical — player "Advise Government: United States of
North America" at 6.997422015983501 with 3 assignments and 19.3, omniscient "Purge the Protectorate
hold on ExtractiveSector in China" at 68.74825331372958 with 5 assignments and 66.13.

---

## Still unmodelled, named rather than guessed

- **The last point of the councilor term.** The game's `GetAttribute` ceiling handling differs from
  this repo's clamp-at-25. Worth one point in ~840 on the measured roster.
- `LEOControlPointCapacity` on the three Administration modules. Zero such modules exist anywhere
  on the measured save, so the whole hab term is a measured zero and this is an untested path.
- `repairCPMaintenanceScaling` (false here) — a save-migration flag whose role is not established.
- Whether a crackdown sets `benefitsDisabled` through some path not visible in
  `SetCrackdownExpiry`. The code path read charges crackdown-only holdings; the wiki says they are
  free. The observer holds none, so nothing measured turns on it.
- Only **one faction on four saves** is ever over cap, so the equality that pins the cap has a
  single subject. Every other faction supplies an inequality only.

## Sources

- `TerraInvicta_Data/Managed/Assembly-CSharp.dll`, campaign version 1.0.51 — IL read directly
  2026-08-22 with a purpose-built PE/CLI metadata reader. Methods named inline above.
- `TIHabModuleTemplate.json`, `TIEffectTemplate.json`, `TIProjectTemplate.json`,
  `TIStartTimeTemplate.json`, `TIGlobalConfig.json` — shipped templates, read 2026-08-22.
- `Localization/en/UIGeneralControls.en`, `UINations.en`, `UIStartScreen.en`, `UICouncilor.en`,
  `UINation.en`, `UIObjectives.en` — shipped strings, read 2026-08-22.
- wiki `Control Point Capacity`, `Nations`, `Game_Options`, `Aliens` — raw wikitext, read
  2026-08-22. Where the wiki and the 1.0.51 code disagree (crackdown cost), the code is followed
  and the disagreement is published.
- Saves: `initiative.gz` (9/10/2029), `CombatAutosave.gz` (7/15/2034), `Autosave3.gz` (12/1/2034),
  `Autosave2.gz` (12/16/2034), `Autosave.gz` and `ExitSave.gz` (1/1/2035), plus six saves from
  older campaigns for the base-cap comparison. All copied to disk and MD5-verified against their
  sources before and after use.
