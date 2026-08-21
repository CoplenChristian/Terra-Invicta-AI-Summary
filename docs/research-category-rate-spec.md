# Research duration ignores per-category bonuses

Written 2026-08-21 against `b3b77f6`.

Every duration the research advisor prints comes from one flat monthly rate. Orgs and hab
modules grant **per-category** research bonuses, so a project in a boosted category
finishes sooner than stated and one in an unboosted category does not.

---

## Measured

`monthsAtIncome(remainingCost, monthlyIncome)` (`shared/researchAvailability.mjs:338`) is:

```js
return round(cost / income, 1);
```

One rate, no category term. It is called from exactly three places — `economicValue.mjs:265`,
`militaryValue.mjs:568`, `propulsion.mjs:282` — each passing a single `monthlyResearch`.

**Category bonuses are real and in the templates, and none of them is baked:**

```
TIOrgTemplate         114 of 381 orgs carry techBonuses
                      e.g. U.N. Office for Outer Space Affairs
                           [{ category: "SpaceScience", bonus: 0.05 }]
TIHabModuleTemplate   e.g. EnergyLab
                           [{ category: "Energy", bonus: 0.025 }]
                           incomeResearch_month: 5
```

`grep techBonuses` across `shared/` and `server/` returns **nothing** outside a comment.

**Observer's current exposure**, from powered completed hab modules only:

```
Xenology   +20.0%   a project there finishes in x0.833 of the stated estimate
```

That figure matches the **0.20 Xenology** reconstructed independently in
`ALLOCATION_MODEL.reproduction` (`shared/researchSlots.mjs`), which also recorded Energy
0.03 and MilitaryScience 0.03 — those come from orgs and councilor traits, which this hab
module sweep does not capture. So the true spread is wider than the one category above.

A 20% bonus means the advisor states 12 months where the answer is 10.

## Engineers are already handled — do not double-apply

The player also runs a flat **+95% from engineers** (each grants 5%), which applies to all
research rather than a category. That is already present: `monthlyIncome.Research` is a
**measured** figure read from the save, so it necessarily includes engineers, and the
research-multiplier measurement in `docs/campaign-settings-spec.md` confirmed measured
income reproduces observed delivery at 1.147× / 0.993×.

**Applying an engineer term on top would double-count it.** Only the *category* variation
is missing, because a single total cannot encode per-category rates.

## Measure the mechanism before applying a correction

**Do not simply divide duration by `(1 + categoryBonus)`.** The exact mechanism is not
settled, and this repo has a recorded finding that says so: `ALLOCATION_MODEL` reports the
published allocation formula — which includes a CategoryBonus term — **does not reproduce**
measured delivery, and that no single `(base, ProjectBonus)` pair fits all three
pip-carrying slots.

What *is* recorded as stable is the **relative share between slots**, at 2.26216× / 2.26214×
across two intervals, one part in 10⁴.

So the honest sequence is the one that settled the campaign multipliers:

1. **Measure delivery into a boosted-category slot against an unboosted one** across two
   consecutive saves, using a relative comparison so global income drift cancels.
   `ALLOCATION_MODEL.reproduction` documents the technique and its confounds.
2. Only then apply a correction, and state the measured basis next to it.
3. If the mechanism cannot be pinned, report the category-adjusted duration as **unknown**
   rather than printing a flat number that is known to be wrong for boosted categories.

An unadjusted flat duration is wrong by a measured 17% on Xenology today. A confidently
wrong *adjusted* duration would be worse.

## What to build

1. **Bake per-category research bonuses** for the observer: orgs, hab modules and
   councilor traits, summed by category, with the contributing sources listed so the figure
   is checkable. Powered and completed modules only — an unpowered lab contributes nothing.
2. **Give `monthsAtIncome` a category**, once the mechanism is measured. All three callers
   know the project's `category` already; the tech tree node carries it.
3. **Show the category rate next to any duration it changed**, so a reader can tell a
   boosted estimate from a flat one.
4. **Say when a duration is flat-rate** because the project's category carries no bonus, or
   because the bonus could not be resolved.

## Constraints

- **Absent stays null.** A missing bonus is `null`, not `0` and not `1`. An unresolvable
  category makes the duration `unknown`, never silently flat.
- **Do not double-apply engineers.** They are already in the measured income.
- Nothing campaign-specific: read `techBonuses` from templates, never hardcode Xenology or
  a 0.20.
- `shared/**` runs in both runtimes.
- Both modes — player mode redacts enemy state but the observer's own orgs and habs are
  visible; verify.
- Read `docs/code-index.md`; update `Purpose:` lines and run `npm run index` last.

## Acceptance

- Per-category bonuses are baked with their contributing sources. On the live save Xenology
  resolves to **+20.0%** from two powered hab modules — assert the value is derived, not
  that it equals 0.20, since the campaign moves.
- An unpowered or incomplete module contributes nothing. Assert with a synthetic module.
- **The mechanism is measured and the evidence recorded in this spec** before any duration
  changes. State delivery into a boosted slot against an unboosted one.
- No duration changes until that measurement exists; until then boosted-category durations
  report `unknown` rather than a known-wrong flat number.
- Engineers are not applied a second time — assert that a duration computed from measured
  income is unchanged by the engineer total.
- Both modes; full suite green with exact pass/fail/skip counts.
