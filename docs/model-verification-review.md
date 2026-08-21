# Model Verification Review — independent findings

Independent re-verification of `docs/archive/model-verification-brief.md` (committed `0d8f66d`),
written with no prior context beyond that brief. Every claim below was re-run against
the live save on 2026-08-21 (latest = `Autosave.gz`, campaign date 2/16/2034, observer
4712) and against the frozen fixtures in `tests/fixtures/`.

**Headline:** all seven claims hold up structurally. Two of them — the propulsion pin and
the mission-control pin — reproduced *exactly* on the live save, and the Servants +40
residual reproduced as a stable, systematic number. The single most valuable new finding
is that **alien combat acceleration carries a consistent ×1.35 thrust factor the model
does not apply** — that is the mechanism behind Claim 1's alien discrepancy. The other
important finding is analytical: the strongest evidence in Claim 3 (the 1.147-vs-0.993
swing) is confounded by the income-change the brief itself flags, and the
`ProjectBonus = −0.209` conclusion is not as independent of the reconstructed
CategoryBonus as the brief believes.

---

## Test suite status

`npm test` at the time of writing: **785 pass, 0 fail** (was 779 at session start; the
delta is in-progress tests being added).

Two failures were observed early in the session and both resolved, each for a
different reason:

- **`compact snapshot output is byte-identical to frozen baseline`** (markdownExports).
  This was a **stale fixture**, not a code regression: the frozen snapshot captured the
  save at 1/1/2034 while the live save had advanced to 2/16/2034. The fixture was
  regenerated during the session and the test now passes. This is precisely the
  "capture against frozen saves copied to disk, MD5-verified" hazard CLAUDE.md warns
  about — the frozen baseline drifts whenever the live save moves. Worth keeping an eye
  on: a save advance silently makes this test fail until the fixture is refreshed.
- **`a mean over zero hulls is null, never 0`** (two tests, militaryValue + munitionDelivery).
  This one was a **real 0-where-null bug** and is covered below. It was fixed in the
  working tree during the session (concurrent work), and the fix is confirmed correct.

The early flakiness (fail counts varying 1–3 across runs) was entirely these two tests
changing state under concurrent edits, not a genuinely nondeterministic suite.

---

## Claim 1 — Propulsion. PINNED. **New finding: the alien discrepancy is a ×1.35 thrust factor.**

The pin is real and the non-vacuity is genuine. `tests/propulsionModel.test.js` checks
the model against a **frozen real-game fixture** (`propulsionSample.json`, 44 ships from
the actual save), and the non-vacuity tests deliberately perturb `EV_kps`, `thrust_N`,
`thrustCap`, and drop the `EVMultiplier` table — each must break agreement, and each
does. The EVMultiplier trap the brief warns about is real: the fixture contains a design
carrying a multiplier module, and emptying the multiplier table breaks the model (the
brief's earlier biased-sample mistake would not be caught by this test).

On the live save (714 ships, omniscient):

| faction | ships | delta-V agree | accel agree |
| :-- | --: | --: | --: |
| 4710 | 15 | 15 | 15 |
| 4711 | 51 | 51 | 51 |
| 4712 (obs) | 42 | 42 | 42 |
| 4713 | 73 | 72 | 71 |
| 4714 | 69 | 69 | 69 |
| 4715 | 16 | 16 | 16 |
| 4716 | 32 | 32 | 32 |
| 4717 (aliens) | 416 | 414 | 153 |

Human factions are essentially perfect. The aliens are the discrepancy, and the pattern
is precise: **delta-V agrees (414/416) while combat acceleration does not (263 disagree)**
on the same ships. That split is the clue — delta-V depends on exhaust velocity and mass,
acceleration on thrust. A mass error would break both; a thrust error breaks only
acceleration.

**The mechanism.** The disagreement ratio is a tight cluster at **0.7407 = 20/27** across
226+ alien ships of every design (AlienFusionTorchx1–x6, AlienFusionLantern). That is a
constant **1/1.35** — the save's alien combat acceleration is the model's value **×1.35**.
Applying a ×1.35 factor to the model's combat acceleration makes **239 of the 263
disagreeing alien ships agree exactly**. The residual disagreements are the partial-fuel
rounding cases (ratios 1.022, 1.113) and the two absurd damaged-hull outliers (ratios
~468, ~632) that are the already-known "reported acceleration corresponds to no mass"
anomaly.

This is not noise and not a save fluke — it is a clean multiplicative term on thrust
(affects acceleration only, not delta-V), and it is absent from every template field the
model reads: the alien drives carry `thrust_N`/`thrustCap` with no combat multiplier, and
the alien hulls carry `thrusterMultiplier: 1`. **The brief asked "is there a term we are
missing, or are alien ships modelled differently?" — the answer is yes, a term is being
missed: a faction-wide ×1.35 on alien combat acceleration.** Whether that's a drive-family
combat bonus, a faction trait, or a game constant is not visible in the shipped templates;
it appears only in the save's reported figures. This is a genuine model gap, not an alien
special-case to paper over, and it is exactly the "260 ships disagreeing suggests a
missing term" hypothesis the brief ranked #2.

Two brief-specifics to correct:

- The brief's "**29 alien ships disagree on ΔV**" does **not** reproduce on the current
  save — it is **0** (414/416 agree, the 2 being the damaged hulls). The brief's own model
  header said "381/410" for an older save. The delta-V claim appears to have been
  save/version-specific; the **acceleration** disagreement is the robust, reproducible one.
- The brief's headline "**696 of 698**" ships reproduce does not match the current save's
  714 ships. Numbers shifted because the live save advanced. The *structure* (aliens are
  the only broken faction, on acceleration) is stable.

---

## Claim 2 — Kinetic damage. PINNED, extrapolation sound.

Verified against the templates directly: **7 guns** ship `damage_MJ`, **16 plasma**
ship `expectedDamage_MJ`, and **70 magnetic guns** ship no figure — exactly as the brief
states. The formula `0.5 × warheadMass_kg × muzzleVelocity_kps²` reproduces all 23 shipped
figures at ratio 1.000000. The test is non-vacuous: changing the exponent to 2.1 breaks
>half the agreements (asserted). The magnetic-gun extrapolation is sound — they carry the
same two inputs and the extension is honestly labelled (`agreement: null`, never "agrees").

No issue found.

---

## Claim 3 — Research allocation formula. REJECTION IS PROBABLY CORRECT, BUT THE REASONING GIVEN HAS TWO HOLES. **This is the finding to act on.**

I checked the arithmetic that licenses the refusal, and the *refusal itself* is the right
call — but two of the three cited pieces of evidence do not stand as strongly as the brief
claims, and the reviewer should understand why before trusting the "unblocks a real
feature" framing.

**1. The `ProjectBonus = −0.209` contradiction is NOT independent of the CategoryBonus
reconstruction.** I re-derived it. The two project slots (Xenology CB 0.20, Energy CB 0.03)
are each the only occupant of their category, so the category term reduces to `1 + CB + PB`
for each, and the ratio is `(1.20 + PB)/(1.03 + PB) = 1.2073`, which solves to PB ≈ −0.2099.
But this conclusion is **sensitive to the magnitude of the Xenology bonus**. For PB = 0 to
reproduce the ratio you'd need `CB_Xenology = 1.2073 × (1 + 0.03) − 1 = 0.2435`. The brief's
reconstructed 0.20 sits **below that threshold**, so it yields a penalty — but if the true
Xenology bonus were ≥ 0.2435 (and the brief itself calls the 0.20 reconstruction
"unvalidated"), PB would be 0 or positive and the "penalty" contradiction collapses. The
−0.209 figure is a *consequence* of assuming the reconstructed bonus, not an independent
refutation.

**2. The `1.147-vs-0.993` swing is NOT robust to the income-change confound the brief
itself raises in Q3.** This is an *absolute* measure: delivered / predicted, where
predicted is derived from the annual research rate. If the observer's research income
changed between the two 15.5-day intervals (new org, trait, hab module, nation stat),
`delivered/predicted` moves even with a perfect formula. The brief correctly notes that a
single slot compared against itself "stands independently of CategoryBonus" — true — but
that only makes it independent of *category bonus*, not of *income drift*. The very
confound the brief flags in Q3 is what this measurement is vulnerable to.

**3. The strongest evidence is actually the piece the brief demotes to "the one thing
that did reproduce":** the project slot delivered a **stable 2.26216× / 2.26214×** the
tech slot across both intervals. That is a *relative* measure, which cancels any global
income change — and it is stable to one part in 10⁴. A stable relative share with an
unstable absolute share is **exactly the signature of a changing total income with a
constant per-slot allocation ratio**, not of a broken per-slot formula.

**Bottom line for Claim 3:** the refusal to recommend a reallocation is still the right
call — the formula has no shipped source for two of its four terms, and no
`(base, ProjectBonus)` fits all three slots, which is a genuine mis-fit. But the *specific
numbers* the brief leans on (the −0.209 penalty and the 1.147/0.993 swing) are each
confounded, and the review should not treat them as independent pins. The honest
statement is: "the formula does not reproduce; the residual is partly income drift and
partly a real mis-fit, and the relative-share stability suggests the allocation has a
structure the wiki formula doesn't capture." Q3's caution is warranted, not just
procedural.

---

## Claim 4 — Armour. The rejection's CONCLUSION is right; its REASONING is a non-sequitur.

The shipped `BaryonicResistance` ratings are correctly read (verified: Steel 1.00,
Titanium 1.11, Nanotube 19.78, Adamantane 31.02), and using them over the half-value
derivation is the right call for combat valuation. But the brief's justification —
"two readings of the same fields cannot both be right" — is **false**. The half-value
layer is a *radiation-shielding* physics quantity; `BaryonicResistance` is a *combat
damage* rating. They are different channels and are *expected* to rank differently — a
dense thin material (Steel, half-value 7.5 cm) can be a poor radiation shield relative to
its mass yet still resist kinetic penetration well, and vice versa. The two figures are
not contradictory; they measure different things. Dropping the derivation was correct, but
for the reason that the half-value figure is a different physical quantity than the combat
rating — not because the two rankings "cannot both be right." The half-value figure may
still be meaningful elsewhere (crew radiation, thickness budgets) and was discarded on a
flawed justification.

---

## Claim 5 — Mission control. PINNED, and the Servants +40 residual reproduces exactly.

Re-ran the model across all 8 factions on the live save:

| faction | modelled | reported | residual |
| :-- | --: | --: | --: |
| 4710 | 65 | 65 | 0 |
| 4711 | 160 | 160 | 0 |
| 4712 (obs) | 152 | 152 | 0 |
| 4713 (Servants) | 264 | 304 | **+40** |
| 4714 | 155 | 155 | 0 |
| 4715 | 76 | 76 | 0 |
| 4716 | 93 | 93 | 0 |
| 4717 (aliens) | 416 | 416 | 0 |

**Exactly 7 of 8 reproduce, and the Servants carry a residual of exactly +40** — the same
+40 the brief reported on an older save. That a round +40 reproduces across two different
saves is strong evidence it is a real, systematic missing category, not a rounding
artifact. (Absolute values differ from the brief's 147/143/79/93/412 because the live save
advanced; the *structure* — lone Servants residual of +40 — is identical.)

The +40 is not explained by: unresolved hab modules (all 555 Servants modules resolve),
under-construction modules (1 PlatformCore at −2, not 40), or defense arrays (they carry no
`missionControl` field at all). The model's negative-only rule for hab cores is correct.
I could not find the mechanism; the strongest remaining candidates are ships-in-queue
consuming MC or a per-hab cost the flat `habModules` array doesn't carry. This is a
genuine open question and the brief's "category we have missed entirely" framing is right.

---

## Claim 6 — Coverage honesty. Characterisation is fair; the residual is save-conditional.

Live save: **14 priced contexts, 127 unpriced = 141 total**, `coverageOfEffectReferences`
= **0.0853** (18/211 effect references). The brief's "14 of 141 contexts, 8.5% of effect
references" reproduces exactly. Every unpriced context is named with its effect count and
a reason group, and the grouped counts are reported — the denominator is honestly laid out,
so 8.5% is a fair characterisation, not a misleadingly small one.

`unexplainedResearchIncome` was **null** on the current save (it was 869.7 in the brief).
This is correct absent-stays-null behaviour: the residual is `totalResearch −
controlPointShare − habModules`, and returns `null` when any of the three streams is
unmeasured in the current parser. The 869.7 was real on the sampled save but is
save-dependent. No issue; the residual is honestly surfaced when it exists.

---

## Claim 7 — Monte Carlo engagement thresholds. The mechanism is honest; the band understates total uncertainty.

Verified in `server/commentary/simulation.js` + `prng.js`: mulberry32 seeded
deterministically (FNV-1a hash of `snapshotId`), 120 seeds, 30 battle trials per hull
count, Lanchester-style, p20–p80 band, `P(win) ≥ 0.80` threshold, hull sweep 1–24, with a
`winnableRatio < 0.5` "not winnable" guard. Determinism confirmed (same snapshot →
identical output; different snapshotId → different output). The brief describes it
accurately.

Three analytical caveats, in the brief's own "is it defensible?" spirit:

1. **The Lanchester model is linear in count, not square.** `ownRoll = (0.8+0.4u) ×
   (ownCount × ownRating)` uses `ownCount`, not `ownCount²`. Real Lanchester's square law
   says combat power scales with the square of numbers. This choice *understates* the value
   of numerical superiority and is not standard Lanchester — defensible as a conservative
   simplification, but worth stating.
2. **The band reflects only Monte Carlo variance, not model-misspecification.** The p20–p80
   spread across seeds captures *stochastic* uncertainty in where the threshold lands. It
   does **not** capture the (much larger) uncertainty from the invented opponent-rating
   calibration constants — `ownRating × 0.7 / 1.5 / 4.0 × (armor/10)` in player mode. There
   is no game source for "a typical alien is 1.5× your best hull." The observed bands are
   narrow (e.g. "3–4", "6–7"), which reads as precision the underlying model does not
   support. The brief's own instinct here is correct.
3. **The band is conditional on the seed being winnable.** `p20/p80` are computed over
   `winnableSeeds` only; seeds where no count ≤ 24 reaches 0.80 are dropped (and if >50%,
   the tier is declared "not winnable"). A p20–p80 over the winnable subset understates the
   spread when many seeds are unwinnable.

30 trials × 120 seeds = 3600 trials per tier is adequate for a *stable band*; the issue is
not sample size but that the band's meaning (stochastic variance only) is narrower than the
label "4–5 hulls" implies.

---

## The house rule (0 vs null) — status

Scanned every model for the `?? 0` / `|| 0` defect class. The overwhelming majority are
legitimate accumulator/sort defaults with a genuine zero, and the repo has extensive
explicit comments guarding absent-stays-null (e.g. `factions.mjs:28`, `techGraph.mjs:232`,
`habs.mjs:40`, `intel/common.mjs:115`).

**One confirmed violation was found and has since been fixed:** `shared/munitionDelivery.mjs`
line 327 computed `meanMountsPerHull` as `round(installationTotal / (hulls ?? 0), 6) || 0`,
which coerced a null/zero hull count to a confident `0` (while the sibling
`pointDefenseInstallations` on the same object correctly returned `null` — an internal
inconsistency that made it unmistakably a bug). Two tests (`militaryValue` and
`munitionDelivery`) assert `a mean over zero hulls is null, never 0` and both failed on it.
The line has been corrected to `(hulls === null || !(hulls > 0)) ? null : …`, and both tests
now pass. This was the highest-value catch of the review, and it is worth a regression test
if the fixture doesn't already force the null path (the two tests do).

---

## Priority-ranked, against the brief's own list

1. **Claim 3** — the rejection is correct, but the two headline numbers (−0.209, 1.147/0.993)
   are each confounded. The stable 2.262 relative share is the real signal, and it points at
   income drift rather than a broken per-slot formula. Reframe the refusal around the
   mis-fit and the missing shipped source, not the swing numbers.
2. **Claim 1's alien discrepancy — SOLVED (partially).** It is a constant ×1.35 on alien
   combat acceleration (thrust-only, delta-V unaffected), reproducing 239/263 of the
   disagreements. Missing term confirmed.
3. **Claim 5's Servants residual — CONFIRMED real.** +40 reproduces exactly across two
   saves. Mechanism still unknown; ships-in-queue is the lead hypothesis.
4. **0-where-null** — one violation found and fixed during the review; the absent-stays-null
   discipline is otherwise sound.
5. **Pins** — propulsion, kinetic damage, and mission control are all real, non-vacuous, and
   reproduce. Claim 4's rejection is right but on a flawed justification; Claim 7's band is
   honest but narrower than its label implies.
