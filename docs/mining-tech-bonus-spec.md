# Mining tech bonuses are not applied to any derived mining figure

Written 2026-08-22 against `1589907`.

Thirteen projects raise mine output. The dashboard applies none of them to any figure it
derives. **Whether that is a defect depends on one unsettled question, and that question
must be answered before a single line changes.**

---

## What is established

**The effects exist**, in `TIEffectTemplate.json`, in two different shapes:

```
Effect_MiningWaterBonus        1.15     multiplier
Effect_MiningVolatilesBonus    1.15
Effect_MiningMetalsBonus       1.15
Effect_MiningNoblesBonus       1.15
Effect_MiningFissilesBonus     1.15
Effect_SpaceMiningBonus5       0.05     additive fraction
Effect_SpaceMiningBonus10      0.1
```

The two shapes must not be read alike. `shared/economicValue.mjs:161` already records that
`SpaceMiningBonus` states `0.05` meaning five percentage points, not five percent. A `1.15`
read the same way would be 115 percentage points. Whatever else this change does, it must
not conflate them.

**Thirteen projects grant them** (`TIProjectTemplate.json`), none of them techs:

| project | grants |
| :-- | :-- |
| `Project_WaterPurificationTechniques` | water ×1.15 |
| `Project_ThermalMiningTechniques` | water ×1.15 |
| `Project_RapidDistillationTechniques`, `Project_MicrobialDrills` | volatiles ×1.15 |
| `Project_DeepSpaceMetallurgy`, `Project_PlasmaExtractionTechniques` | metals ×1.15 |
| `Project_MolecularBenefication`, `Project_SlagValorization` | nobles ×1.15 |
| `Project_RapidFissileEnrichment`, `Project_SubsurfaceRadiatonAnalysis` | fissiles ×1.15 |
| `Project_AdvancedProspectingSurveys`, `Project_AlgorithmicExtractionManagement`, `Project_GoldRush` | all mining +10% |

Every resource has **two** independent ×1.15 sources. Whether two stack multiplicatively
(1.3225), additively (1.30), or cap at 1.15 is **not known** and must be measured, not
assumed. The same applies to combining a ×1.15 with a `SpaceMiningBonus` fraction.

**The observer holds exactly one**: `Project_ThermalMiningTechniques`, water ×1.15. Of 165
completed projects it is the only mining-bonus grant. That is the +15% the request names.

**Nothing applies any of it.** `scoreMiningSiteCandidate`
(`shared/intel/miningExpansion.mjs:263-274`) computes `monthlyYield = toFinite(site[key]) * 30`
with no modifier. `getMiningRateSummary` (`server/briefing/readers.js:78-94`) sums raw
`site[key]` values. The owned-hab enrichment feeding the directive engine's Advise
economics uses `30 ×` the same raw rates.

## The unsettled question, which gates everything

**Are the per-site rates in the save pre-bonus or post-bonus?**

If the game bakes the ×1.15 into `site.water` before writing the save, then nothing is
understated, and multiplying by 1.15 would **overstate water by 15%** across three
surfaces. If the save stores base rates, three derived figures are understated.

Two attempts failed to settle it, and both are recorded here so they are not repeated.

**Attempt 1 — ledger income against summed site rates.** Over the observer's 17 completed
mines:

```
resource      x30/month   ledger income   ratio
water             681.2          703.56   1.0329   <- the ONLY resource with a bonus
volatiles         954.1          895.69   0.9388
metals           1061.8         1161.26   1.0937
fissiles            5.6            6.78   1.2192
```

Water is the only bonused resource and has nearly the *lowest* ratio; metals and fissiles
score higher with no bonus at all. If the rates were missing a ×1.15, water should stand
out. It does not. **This is evidence for post-bonus, but it is not proof** — the 30-day
ledger captures trade, consumption timing and hab-module production, so it is not a clean
extraction measurement. Do not treat 1.0329 as a measurement of anything.

**Attempt 2 — cross-faction comparison on a shared mining profile**, normalising
`water / siteDensity`. Inconclusive: within `MercuryPolarMine|t2` the value ranges
0.013 to 0.063 across three factions, a 5× spread that swamps any 15% effect. `siteDensity`
does not normalise away within-profile richness variation. Abandoned.

### The measurement that will settle it

Compute the expected rate from the templates — mining-profile richness × `siteDensity` ×
the mine module's output for `mineTier` — and compare against the save's stored rate for
the observer's sites. If `saved / computed` is 1.15 for water and 1.00 for the four
unbonused resources, the save is post-bonus and this whole change collapses to a labelling
task. If it is 1.00 across all five, the save is pre-bonus and the fix is real.

Use a site with a clean join, e.g. `Tolkien Crater` (ID 4730): `MercuryPolarMine`,
`siteDensity 5.43`, `mineTier 2`, `SettlementMiningComplex`, `water 0.07202967`.

**Do the same check against a faction that holds a bonus the observer lacks** — the
Servants and the Academy both operate water mines — so the conclusion rests on a
contrast, not on one faction's numbers. A one-sided pin is weaker than its count looks.

**Report the answer before changing anything.** If post-bonus, stop and say so; the
correct deliverable is then a labelled note that the rates already include tech bonuses,
plus whatever attribution is worth showing, and **not** a multiplier.

---

## If, and only if, the rates prove pre-bonus

Three surfaces understate, and one must not be touched.

**Fix:**
1. `scoreMiningSiteCandidate` projected yields — this drives which sites the expansion
   board recommends, so a 15% error reorders advice.
2. `getMiningRateSummary` — the briefing's per-day figures.
3. The owned-hab monthly output feeding **directive Advise economics**. This one reaches
   councilor recommendations, not just a display.

**Do not touch `monthlyIncome`.** It is `recent30DayFlow.income`, a measured 30-day
transaction ledger (`server/snapshot/factions.js:177`), and the game has already applied
every bonus before writing it. Applying a multiplier there would double-count — the exact
error already recorded for Engineers +95% in `docs/README.md`, where a bonus already inside
measured research income would have been counted twice.

**Resolve the stacking question by measurement** before implementing, using a faction that
holds two same-resource grants if one exists in this save; if none does, say so and
implement the single-source case only, with the multi-source path explicitly declared
unhandled rather than guessed.

---

## Constraints

- **Absent stays null.** A faction whose completed-project list is unreadable has an
  **unknown** bonus, not a 1.0. Do not let an unresolvable multiplier silently become
  "no bonus" — that is the same fall-through-to-safe this repo keeps fixing.
- **Say which figures are bonus-adjusted.** A reader must be able to tell an adjusted
  figure from a raw one, and the source of the adjustment must be nameable — the research
  category bonuses set the pattern in `shared/researchCategoryBonus.mjs`.
- **Player mode.** Completed projects are the observer's own, so this should work fully in
  player mode; verify rather than assume. Other factions' bonuses are omniscient-only
  information and must not leak into player mode.
- Nothing campaign-specific. The 200% mining rate is already reflected via measured values
  (`docs/README.md`, closed as needing no work) — do not re-apply it.
- **Cite the templates with dates** for every claim about game mechanics, per `CLAUDE.md`.
- Anything new must reach the AI surfaces: `shared/markdownExports.mjs`,
  `shared/intel/registry.mjs`, `docs/code-index.md`, `docs/README.md`.

## Acceptance

- **The pre/post-bonus question is answered first, with the template arithmetic shown**,
  and the answer decides whether the rest applies. Report it even if it means no code
  changes.
- If pre-bonus: water yields rise by exactly the measured factor on the observer's sites,
  the four unbonused resources are unchanged, and `monthlyIncome` is byte-identical.
- Stacking behaviour is stated as measured or explicitly declared unhandled.
- Before/after capture across both modes of every mining surface; every moved figure
  explained, every unmoved one confirmed unmoved.
- Whether the expansion board's site ordering changed, and if so which sites moved.
- No `null` / `undefined` / `NaN` / confident `0`.
- Full suite green with exact counts. Baseline **1017 tests / 1016 pass / 0 fail / 1 skip**.
- Every new test broken deliberately first.
