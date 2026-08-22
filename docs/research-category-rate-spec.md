# Research duration and per-category research bonuses

Written 2026-08-21 against `b3b77f6`. **Revised 2026-08-21** after two missed bonus sources
were found and the delivery mechanism pinned. The superseded conclusion is kept at the
bottom under "What the first pass got wrong", because the way it went wrong is the useful
part.

**Revised 2026-08-22 against `431be86`** (tracker 3b). The bonus model and the allocation pin
are unchanged and re-measured identical. What changed is the **conclusion drawn from the
2.11× figure**: it is a whole-faction sum, not a per-slot duration correction, and the
superseded wording is kept under "What the 2.11× conclusion got wrong".

**Revised again 2026-08-22 against `866b8a8`, and this time every duration MOVED.** Two
independent corrections landed together:

1. **The rate.** A duration is now priced through the allocation the item's slot actually
   receives, not against the whole faction's income. The measured per-slot factors of
   0.4658×, 0.2928×, 1.0602× and 0.2928× are applied per slot instead of being recorded as a
   reason to leave the figure flat. `shared/researchAllocationPricing.mjs`.
2. **The cost.** The campaign's `researchSpeedMultiplier` acts on the effective research
   **cost**, measured — so on this 200% campaign every remaining cost was 2× what the game
   charges. `shared/researchCostScaling.mjs`. That overturns
   `docs/campaign-settings-spec.md`'s "acts on output, not cost" verdict.

The section headed "The consequence, and why durations are still flat" is kept, marked, and
its conclusion is withdrawn — see "Why durations did NOT stay flat" beneath it.

**What the 2.11× measurement can and cannot answer.** It stands, re-reproduced identically a
third time. But both sides of it are research POINTS and cost never enters, so it
**cannot discriminate** between "income already doubled, cost unscaled" and "income never
doubled, cost halved" — they predict the identical 2.11×. The 4.2840× alternative it ruled
out was a hypothesis nobody held. It is a correct measurement of the income path and silent
about the cost path, which is where the multiplier turned out to live.

~~Every duration the research advisor prints comes from one flat monthly rate.~~ Orgs, hab
modules, councilor traits, alien-activity investigations and one ship module all grant
**per-category** research bonuses, so the rate a project is actually researched at varies
by category.

---

## The five sources, and which of them a template sweep finds

The official wiki (`Technology`, revision **2026-05-06**, read as raw wikitext 2026-08-21)
names five sources of a Research Category Bonus:

| source | in a template? | handled |
| :--- | :--- | :--- |
| councilor traits | `techBonuses` on `TITraitTemplate.json` | yes |
| equipped orgs | `techBonuses` on `TIOrgTemplate.json` | yes |
| hab modules | `techBonuses` on `TIHabModuleTemplate.json` | yes |
| ships with a Mobile Space Science Lab (SpaceScience only) | `TIUtilityModuleTemplate.json`, but as `specialModuleRules: ["GenerateSpaceScienceBonus"]` / `specialModuleValue: 0.05` — **not** `techBonuses` | **no**, declared |
| alien activity investigations (Xenology only) | **no template at all** | yes |

`grep -l techBonuses` over the installed templates returns exactly three files, which is
why the first pass swept exactly three families and stopped.

### Alien-activity investigations are not in any template

`InvestigateAlienActivity` in `TIMissionTemplate.json` resolves to:

```json
"targetEffects": [{ "$type": "TIMissionEffect_InvestigateAlienActivity" }]
```

A code-side effect class with no data-driven bonus. `TIGlobalConfig.json` carries no
investigation constant either — a grep for `investig` returns nothing, and the only
research key in the whole file is `globalResearchMultiplier: 1`.

The count itself **is** in the save, as a plain integer `alienInvestigations` on
`TIFactionState`. The rate is a **wiki claim**:

> Terra Invicta wiki, `Aliens`, revision **2026-04-05**, read as raw wikitext 2026-08-21:
> xenology, no condition, **+1% per Alien Activity Investigation**.

On the measured saves the observer had **24**, so its true Xenology bonus was
`0.20 (two Xenology Labs) + 0.24 = 0.44`, not the 0.20 the template sweep found. Nothing
is hardcoded: the count is read per save and multiplied by the stated rate.

### The ship module is declared unhandled, not omitted

The snapshot's fielded ships (`fleets[].ships[]`) carry a weapon loadout but not their
utility-module template names, so how many Mobile Space Science Labs the observer flies
cannot be read. `UNHANDLED_SOURCE_TYPES` names it, and every category it touches
(`SpaceScience`) reports `isLowerBound: true` with the reason. A floor presented as a total
is the same defect as a fabricated figure.

## Diminishing returns, quantified

Every one of the 41 bonus-granting hab module templates carries the special rule
`TechBonusDiminishingReturns`, and **no shipped template or config states its constant**.
The first pass concluded from this that `effectiveBonus` had to stay `null`. The wiki
states the rule (`Technology`, rev **2026-05-06**):

> Except for alien activity investigations, each source will have diminishing returns
> applied to it separately when its base bonus exceeds 50%. Specifically, if the base bonus
> is more than 50%, then the actual bonus is set to
> `50% + 50% × (Base Bonus − 50%) / (Base Bonus + 150%)`.
>
> The Research Category Bonus is then simply the sum of these actual bonuses from each
> source type.

Three things follow, and the third is a judgement rather than a reading:

1. The threshold is **strict** — at exactly 50% the curve is the identity.
2. **Alien-activity investigations are exempt** and stack linearly with no cap.
3. "Each source ... separately", then "the sum ... from each source **type**", is read here
   as **per source type**: all orgs together, all hab modules together. On this campaign no
   source type reaches 50%, so the per-source and per-type readings are indistinguishable
   in the data and this choice is recorded as a judgement, not a measurement.

**Both constants are wiki claims, not measurements**, and `CATEGORY_BONUS_RULES.claimStatus`
says so in the payload. They are corroborated only indirectly, by the pin below.

---

# The measurement, 2026-08-21 (second pass)

## Method

The same four saves as the first pass, re-copied and **re-verified byte-for-byte** against
the source before use because the game had been running:

```
Autosave3.gz   61cc7c1103742fe47d2984d384a3147a   12/1/2034
Autosave2.gz   5294cddfb5906d27bfd59bce9f29ccda   12/16/2034 12:00
Autosave.gz    2ef9643051e675026850b23b380f93f3   1/1/2035
ExitSave.gz    5c0d9ef98213c91d8187ae11bf885d57   1/1/2035
```

All four MD5s match the first pass exactly, so this is a genuine re-measurement of the same
data rather than a new campaign state. `alienInvestigations` was **24 in all four**, so it
does not drift inside either interval and cannot confound a relative comparison.

Per-slot `accumulatedResearch` was differenced across two consecutive 15.5-day intervals
with the pip layout `[0,0,3,1,3,1]` unchanged throughout. The first pass's delivered
figures reproduce to the integer.

## Interval 1 — 12/1/2034 → 12/16/2034 12:00

| slot | kind | pips | category | delivered | per pip |
| ---: | :--- | ---: | :--- | ---: | ---: |
| 2 | global tech | 3 | LifeScience | 745 | 248.33 |
| 3 | project | 1 | MilitaryScience | 469 | 469 |
| 4 | project | 3 | Xenology | 1698 | 566 |
| 5 | project | 1 | Energy | 469 | 469 |

Every category holds exactly one pipped slot, so the `0.9^(n−1)` same-category decay is
`0.9^0 = 1` everywhere and the term never engages.

## The model, with every term read rather than fitted

The wiki allocation formula (`Technology`, rev 2026-05-06):

```
delivered to slot X = base
                    × (100% + 5% per research slot with pips)
                    × pips_X / total pips
                    × (100% + CategoryBonus_X × 0.9^(same-category pipped slots − 1)
                             + ProjectBonus if X is a project)
```

The first pass could not fit it because two terms were wrong, and neither was the category
term it was searching in:

**`ProjectBonus` is readable from the save.** The wiki says the first Projects point from an
org unlocks the second project slot, the first from a hab module unlocks the third, and each
remaining one adds 5% up to a 100% cap. The save carries all three:

```
cachedYearlyRevenue.Projects = 21
orgProjectSlotUnlocked       = true
habProjectSlotUnlocked       = true
-> ProjectBonus = min(100%, (21 − 2) × 5%) = 95%
```

**`CategoryBonus` for Xenology is 0.44, not 0.20** — the 24 investigations.

## What reproduced — zero free parameters

Predicted share of delivered research against observed share, all four slots at once:

| slot | category | multiplier | predicted share | observed share | error |
| ---: | :--- | ---: | ---: | ---: | ---: |
| 2 | LifeScience (global tech) | 1.0500 | 0.220588 | 0.220349 | +0.109% |
| 3 | MilitaryScience (project) | 1.9800 | 0.138655 | 0.138716 | −0.044% |
| 4 | Xenology (project) | 2.3900 | 0.502101 | 0.502218 | −0.023% |
| 5 | Energy (project) | 1.9800 | 0.138655 | 0.138716 | −0.044% |

Against a per-slot integer-rounding noise floor of 0.059% to 0.213%. Every residual is
inside noise.

The four independent per-pip ratios, which cancel total income entirely:

```
Xenology / MilitaryScience              observed 1.206823   predicted 1.207071   +0.021%
Energy / MilitaryScience                observed 1.000000   predicted 1.000000    0.000%
MilitaryScience project / global tech   observed 1.888591   predicted 1.885714   −0.152%
Xenology project / global tech          observed 2.279195   predicted 2.276190   −0.132%
```

The third row is the load-bearing one. It contains no Xenology at all, so it fixes
`ProjectBonus` independently — and it agrees with the 0.95 read straight out of
`cachedYearlyRevenue.Projects` to 0.15%. That is what makes this a test rather than a fit.

**Equal bonus, equal delivery, across different source types.** Slots 3 and 5 carry the same
0.03 from *different* source types — MilitaryScience from an org (0.01) plus the `Veteran`
trait (0.02), Energy from two orgs (0.01 + 0.02). Both delivered exactly **469**. That is
what licenses summing across source types.

**The absolute scale is one common factor.** Observed / predicted is 0.98461, 0.98612,
0.98591, 0.98612 — uniformly ~1.4% low, not a structural mis-fit. Consistent with income
drift inside the interval or a slightly different elapsed-day convention.

## Interval 2 — 12/16/2034 12:00 → 1/1/2035

Slots 2 and 5 changed occupant, so only slots 3 and 4 are differenceable.

```
Xenology / MilitaryScience per-pip   observed  1.208696
  predicted, no same-category decay            1.207071   −0.134%
  predicted, 0.9 decay on MilitaryScience      1.208902   +0.017%
```

Slot 2 became a *MilitaryScience* global tech partway through this interval, which would
engage the `0.9^(n−1)` decay for part of it. Both readings sit inside noise, so the decay
term is **corroborated, not pinned**.

## What is pinned, and what is not

**Pinned.** The allocation formula, with `CategoryBonus` including investigations and
`ProjectBonus` read from `cachedYearlyRevenue.Projects`, reproduces four measured slot
deliveries to within 0.15% with no fitted parameter.

**Not pinned, and the record says so:**

- the `0.9^(n−1)` same-category decay — every category held exactly one pipped slot in
  interval 1, so the exponent was 0 and the term never engaged;
- the diminishing-returns curve — no source type on this campaign reaches 50%, so the curve
  is the identity throughout and applying it changes nothing here. It is exercised only
  against a synthetic 60% source in `tests/researchCategoryBonus.test.js`;
- the 100% `ProjectBonus` cap — the observer sits at 95%, below it.

**What would test the rest:** a save in which one source type's subtotal exceeds 50%, and
one in which two pipped slots share a category.

---

# The consequence, and why durations are still flat

**Corrected 2026-08-22 (tracker 3b).** This section previously concluded that every stated
duration was "an upper bound by roughly 2.11×". The measurement behind that number is right;
the inference drawn from it was a **units error**, and the superseded wording is kept below
under "What the 2.11× conclusion got wrong".

The pin says something the first pass could not see: **the category term is the small part of
the flat rate's error.** But it is not the whole allocation multiplier that replaces it.

## What 2.11× is, and what a duration needs

Over interval 1 the observer's **four slots together** received **2.1115×** the nominal
research income the flat rate divides by, because `cachedYearlyRevenue.Research` is the
**pre-allocation base** and the `(1 + 5% per pipped slot)`, pip-share and
`(1 + Category + Project)` terms all sit on top of it. That part stands, re-measured
2026-08-22 against the same MD5-verified saves.

A duration is not about four slots. It is about **one**. Per slot, against the same nominal
income of `37,735.23 / 12 = 3,144.60`/month:

| slot | kind | category | pips | delivered / 15.5 d | per month | ÷ nominal income | the flat figure is |
| ---: | :--- | :--- | ---: | ---: | ---: | ---: | :--- |
| 2 | global tech | LifeScience | 3 | 745.85 | 1,464.6 | **0.4658** | 2.15× too **short** |
| 3 | project | MilitaryScience | 1 | 468.82 | 920.6 | **0.2928** | 3.42× too **short** |
| 4 | project | Xenology | 3 | 1,697.71 | 3,333.8 | **1.0602** | 1.06× too long |
| 5 | project | Energy | 1 | 468.82 | 920.6 | **0.2928** | 3.42× too **short** |
| | | | | **3,381.21** | **6,639.7** | **2.1115** | ← the whole-faction figure |

`0.4658 + 0.2928 + 1.0602 + 0.2928 = 2.1116`. **The whole-faction 2.11× is the sum of exactly
the quantity a duration needs, over the four slots that share it.** Using the sum in place of
one term is the error.

Three consequences:

- **The flat figure is not an upper bound.** On three of the four occupied slots it is
  already **optimistic**, by 2.15× to 3.42×. Dividing every duration by 2.11 would take the
  1-pip slots from 3.4× optimistic to **7.2×**.
- **No single scalar corrects it.** The per-slot factor depends on a pip share a candidate
  project does not have until it is given one, and it spans 0.29× to 1.06× — a factor of 3.6
  — on one faction in one interval.
- **The category term is still the small part.** ~3% against a 3.6× spread.

## The one bound the model does yield

Put **every** pip on one slot and it has `pipShare = 1` with one pipped slot, so it receives
`1.05 × (1 + CategoryBonus + ProjectBonus)` × the nominal income. That is the **fastest
achievable** rate, so `flat months ÷ that multiplier` is a genuine **lower bound on months**:

| category | kind | multiplier | flat months ÷ |
| :--- | :--- | ---: | ---: |
| LifeScience | global tech | 1.1025 | 1.103 |
| MilitaryScience | project | 2.0790 | 2.079 |
| Energy | project | 2.0790 | 2.079 |
| Xenology | project | 2.5095 | 2.510 |

Since `1.05 × (1 + Cat + Proj) ≥ 1.05 > 1` always, the flat figure **is** an upper bound on
the *best case* — and never on the duration at the current allocation. The spread is 2.28×
across four categories on one save, so this is not a scalar either.

~~**Not implemented, deliberately.** Publishing it means choosing a counterfactual allocation
for every ranked candidate, and `buildResearchSlotAllocation` already refuses to recommend a
reallocation for the adjacent reason. Recorded here so the next reader has the arithmetic.~~

**IMPLEMENTED 2026-08-22.** The objection was sound and the answer to it was not "leave the
figure wrong" but "name the assumption". A duration is now priced through
`shared/researchAllocationPricing.mjs` in one of four labelled states:

| state | months | basis |
| :-- | :-- | :-- |
| `allocation-measured` | exact | the item is in a slot; its pip weight is read from the save |
| `allocation-assumed` | `one-pip`, with `all-pips` beside it | it is not in a slot, so a pip allocation is ASSUMED |
| `slot-receives-nothing` | **null** | it holds zero pips, so it receives nothing and has no time to complete |
| `flat-rate-unpriced` | flat | no slot layout could be read; the pre-existing figure, labelled |

The `one-pip` scenario is the conservative end and it is anchored to an observation rather
than to a guess: on this save it is exactly the rate slots 3 and 5 are **measured** to
deliver. The `all-pips` scenario is the lower bound above. A single confident number would
hide a spread of 7.01× between them (932.53 against 6,537.62 points/month for a project on
this save), which is why both are published and the state says which the headline took.

## Is 2.079× a disguised 200%?

It is worth asking, because this campaign runs `researchSpeedMultiplier` at 200% and a
typical project's full-concentration multiplier lands within 4% of 2.0. It is a coincidence
of this campaign carrying a 95% `ProjectBonus`, and the contrast says so:

- `ProjectBonus` is read per faction from `cachedYearlyRevenue.Projects`. Measured on the
  same interval: **0.80** for Project Exodus (18 Projects), **0.95** for the observer (21),
  **1.00** capped for the Resistance (34), Humanity First (37), the Academy (31), the
  Servants (49) and the Protectorate (56). A global multiplier would be identical for all.
- It applies to **project** slots only. Measured per-pip, a project slot delivers
  `(1 + Cat + Proj) / (1 + Cat)` times a global-tech slot — 1.885714 observed against
  1.885714 predicted for the observer. A campaign multiplier applies to both alike.
- And the campaign's own 200% is **already inside** `cachedYearlyRevenue.Research` — see the
  section below.

## `cachedYearlyRevenue.Research` is already post-`researchSpeedMultiplier`

Measured directly rather than inferred, 2026-08-22:

```
measured whole-faction gain over nominal income          2.1115
predicted from the allocation terms alone, all read      2.1420   (1.20 x 1.78475)
predicted if the income ALSO still needed the 200%       4.2840
```

The measurement sits on the first, 1.4% below it — a uniform residual with **no spare factor
of 2 anywhere in it**. Nor can the 200% be hiding in the allocation structure: a project pip
delivers 1.889× a global-tech pip, and a global multiplier cannot produce a ratio between two
slot kinds.

This replaces the argument in `campaign-settings-spec.md`, which reached the same conclusion
by invalid reasoning. See that document's own correction note.

> ~~**Durations therefore stay flat, and the measured category bonus is named beside them.**
> The label states what is *not* applied; it deliberately does not claim a direction or size
> for the true figure, because the per-slot spread runs both ways.~~
>
> ~~`8.0 mo (flat; +3.0% category)` — not "so the true figure is slightly shorter", and no
> longer "treat it as an upper bound" either.~~

### Why durations did NOT stay flat

**Withdrawn 2026-08-22.** The reasoning above is right about everything except what to do
next. It establishes that the per-slot spread is 3.6× and that no single scalar closes it,
and then concludes: keep printing a number that is 2.15×–3.42× wrong on three of the four
occupied slots, and name a 3% category bonus beside it.

That is the wrong trade in both directions. The per-slot factor is not a *scalar* but it is
perfectly *computable* — every term of it is read from the save when the item is in a slot.
And for an item that is not in a slot, the honest answer is not the flat figure (which
describes no allocation anyone would run) but a **labelled scenario with the other end beside
it**. Refusing to publish a counterfactual is right; publishing a wrong number instead of one
is not the only alternative.

What a row prints now:

```
2.3 mo (its slot)              measured: the item is in a 1-pip slot, every term read
8.1 mo (1 pip) · 1.2 mo all-in assumed: both ends given, the state says which is the headline
no pips                        it holds zero pips, so it receives nothing at all
```

Checked against the save that produced it: `Project_240cmGreenArcLaserCannon` in slot 3, 2,119
effective points remaining, priced at **2.3 months**. Its slot's own measured delivery over
the previous interval was 460.09 points per 15.5 days = 902.8/month, which is **2.35 months**.
The flat figure for the same row was 0.7 months.

### What the 2.11× conclusion got wrong

Kept because the failure mode is instructive. The superseded text read:

> Over interval 1 the observer's slots received **2.1113×** the nominal research income the
> flat rate divides by … correcting only the category term … leaves a 2.11× error untouched
> while looking like a fix.
>
> **The next scoped change** is to price a duration through the pinned allocation model rather
> than `cost / income`.

Every number in it is right. What was wrong was reading a **whole-faction sum** as a
**per-slot rate**, and then reading "the flat figure is 2.11× off" as "the flat figure is
2.11× too *long*". Both halves fail on the same table above: the sum is not a term of itself,
and three of the four terms are below 1.

The tell was available at the time: the same document's own interval-1 table shows slot 3
receiving 469 points where an even share of the 2.11× would be 845. A figure that is 2.11×
the *total* while one slot gets 0.29× of it cannot also be a per-slot correction.

## Duration states

**Replaced 2026-08-22.** The five states below now name the ALLOCATION basis, because that
is the axis a reader has to know about: the same category priced against a 3-pip slot rather
than a 1-pip slot moves by 3.6×, against the 3% a category term is worth.

| state | months | meaning |
| :--- | :--- | :--- |
| `allocation-measured` | exact | the item is in a slot; its pip weight is read from the save, so every term is measured |
| `allocation-assumed` | `one-pip`, `all-pips` beside it | not in a slot, so a pip allocation is ASSUMED and the row says which |
| `slot-receives-nothing` | **null** | it holds zero pips: it receives nothing and has no time to complete |
| `flat-rate-unpriced` | flat | no slot layout could be read; the pre-existing flat figure, labelled as unpriced |
| `unmeasured-income` | **null** | no measured research income at all |

The category dimension has not been dropped — it moved onto explicit fields.
`categoryResearchBonus` carries the effective bonus (now applied, inside the multiplier), and
`monthsAreUpperBound` is true when a term had to be priced at its floor: an unresolved
category, a category whose sum is a declared lower bound (SpaceScience, because of the Mobile
Space Science Lab no snapshot field can count), or an unresolved slot kind. That is strictly
more information than the four superseded state codes carried.

### The four superseded states, kept

| state | what it meant | why it is gone |
| :--- | :--- | :--- |
| `flat-rate` | the category carried no bonus, so the flat rate was right for the CATEGORY term | it was still the whole faction's income rather than the slot's share, so it was wrong for the ALLOCATION term — by 2.15× to 3.42× on three of the observer's four slots |
| `flat-rate-boosted` | the category carried a measured bonus, named beside the figure and not applied | now applied, inside the allocation multiplier |
| `unresolved-category` | the category could not be resolved, so whether a bonus applied was undecidable | now priced with the bonus at its floor of zero, which makes the months an explicit UPPER bound rather than an unlabelled point estimate |
| `category-unchecked` | the bonus catalogue was absent from the snapshot | same treatment |

`unknown` was removed on 2026-08-21. Thirteen ranked rows had carried it, none of them
Xenology: MilitaryScience (7), Energy (2), Materials (2), SpaceScience (2), at roughly 3–5%
each.

---

# What the first pass got wrong

Kept because the failure mode is instructive, not because the conclusion stands.

It measured correctly. Every delivered figure it recorded reproduces to the integer. It then
searched for a **one-parameter category model** to explain a residual that was not in the
category term at all, and correctly refused to guess when nothing fitted.

Its three candidate fits, and what each was actually seeing:

| candidate | fitted | what it really was |
| :--- | :--- | :--- |
| `1 + b + P` | `P = −0.208` / `−0.215` | the right *shape*. `P` came out negative only because `b` was 0.20 instead of 0.44. At the true `b`, `P` solves to +0.95 — the value the save states. |
| `1 + k·b` | `k = 1.263` / `1.275` | an artefact of the same missing 0.24 |
| under-reconstructed `b` | `b = 0.243` / `0.245` | **the closest to right.** It was rejected because `TechBonusDiminishingReturns` can only push a bonus *below* its sum, so a `b` above 0.20 looked impossible. The rule is real; it just does not apply below 50%, and investigations are exempt from it anyway. |

`ALLOCATION_MODEL.reproduction` had already recorded that "for ProjectBonus = 0 to produce
the same ratio the Xenology bonus need only be 0.2435" and that the reconstruction was
unvalidated. That note was pointing straight at the missing source.

Two lessons worth keeping:

- **`grep techBonuses` is not "find every bonus source".** It is "find every bonus source
  *that is data-driven in that shape*". Two of five sources were neither.
- **A one-parameter fit to one ratio is not a test — but neither is refusing to look for a
  second ratio.** The project-vs-global-tech comparison was available in the same interval
  and contains no Xenology; it fixes `ProjectBonus` on its own. The first pass excluded
  global-tech slots as "a separate mechanism" on the strength of a ratio it could not
  explain (745 against 1698), and that exclusion removed the one comparison that would have
  broken the collinearity it then reported as the blocker.

---

# Constraints (unchanged)

- **Absent stays null.** A missing bonus is `null`, not `0` and not `1`. An unreadable
  `alienInvestigations` is `null` — `Number(null) === 0`, and zero investigations is a real
  and different fact.
- **Do not double-apply engineers.** They are already in the measured income.
- Nothing campaign-specific: read `techBonuses` from templates and `alienInvestigations`
  from the save. Never hardcode Xenology, 0.20, 0.44 or 24.
- `shared/**` runs in both runtimes.
- Both modes. The observer's own investigation count is legitimately known and survives
  player mode; a **rival's** is redacted to `null` alongside `currentProjects` and
  `availableProjectNames`, because it converts directly into their Xenology research rate.
- Read `docs/code-index.md`; update `Purpose:` lines and run `npm run index` last.
