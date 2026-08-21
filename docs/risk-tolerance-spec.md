# Configurable risk tolerance for councilor actions

Written 2026-08-21 against `2b6e3d5`.

The player can tolerate a mission at some success chance and not below. The engine has no
way to hear that: odds are computed, used to weight expected hate, and then never gate a
recommendation.

---

## What exists

`server/engine/odds.js` → `computeMissionOdds(candidate, councilor, world)` returns:

```
chance      0..1
point       integer percent
band        [lo, hi]      -- a RANGE, not a point
automatic   true for uncontested missions
assumed     true when the estimate rests on unmodelled modifiers
available   false when odds cannot be computed at all
basis       human-readable derivation
unmodeledModifiers[]
```

`server/engine/pairing.js:57` is the **only** consumer. It uses `odds.chance` to weight
`expectedHate`, and falls back to `UNKNOWN_ODDS_PLANNING_PRIOR` when odds are unknown.

**No rule in `server/engine/rules/` reads odds.** There is no floor, no veto, no filter.
A 15% mission and a 95% mission compete on expected value alone.

Measured on the live save (observer 4712):

```
player     3 assignments   all point=100, band=[100,100], automatic Advise
omniscient 5 assignments   3x point=100
                           purge:3728:3729  point=93  band=[89,96]  assumed=true
                           defend-interests point=100
```

The current cycle happens to be safe, which is why this has not bitten yet. The defect is
that the player cannot express the preference at all, not that today's plan is reckless.

## What to build

**A configurable success floor, applied as a veto rule.**

`CLAUDE.md` records that the rule registry is *not* grouped by family and that
`cost/affordability` is a veto that runs after every score. A risk floor is the same shape:
score normally, then veto. Follow that precedent — add a rule, do not filter candidates
before scoring, because the explanation the player reads is emitted in registry order and a
pre-filtered candidate produces no explanation at all.

### Test the band, not the point

`band: [89, 96]` means the estimate has a spread. **A floor must test the low end of the
band**, not `point`. Testing `point=93` against a 90% floor passes while the true chance
may be 89%. Where `band` is absent, say so rather than substituting `point` silently.

### Absent odds are not a pass and not a fail

`available: false` means the floor **cannot be evaluated**. That candidate reports
`unknown`, is not silently admitted, and is not silently vetoed — `CLAUDE.md`: *a check
that cannot be evaluated must report unknown, never fall through to safe*. Surface it so
the player can decide.

Note `pairing.js` already substitutes `UNKNOWN_ODDS_PLANNING_PRIOR` for unknown odds when
weighting hate. **Do not reuse that prior for the floor.** A planning prior is a modelling
convenience; using it as evidence that a mission clears a risk threshold would be inventing
a measurement.

### `assumed: true` must travel with the verdict

An estimate resting on unmodelled modifiers that clears the floor by 3 points is not the
same as a measured one that clears by 30. Carry `assumed` and `unmodeledModifiers` into the
verdict so a marginal pass is visibly marginal.

### Automatic missions

`automatic: true` returns `chance: 1.0, band: [100,100]`. These always clear any floor and
should not be labelled as a risk decision at all.

## Where the setting lives

Mirror the existing `mode` / `observer` pattern — both are query parameters resolved per
request in `server/http/requestContext.js`, with defaults in `config/`.

```
config/config.schema.json   riskFloorPercent  default, 0..100, validated
query parameter             ?riskFloor=75
UI control                  a setting in the directive board, persisted to localStorage
                            and passed on the request, as the save-autodetect toggle does
```

**A floor of 0 must mean "no floor", not "veto everything"** — `Number(null) === 0`, and a
missing parameter must resolve to the configured default rather than to zero.

## What the player sees

- A vetoed candidate says **why**, with its measured odds and the floor it missed:
  *"purge — 89% at the low end of its band, below your 90% floor."*
- Candidates that clear the floor **by a small margin on an assumed estimate** say so.
- If the floor vetoes every candidate for a councilor, that councilor's slot reports
  *no action clears your risk floor* rather than falling back to a below-floor suggestion
  or rendering empty.
- The floor in force is visible, so a surprising plan is explicable.

## Constraints

- Both modes. Player mode masks enemy councilor attributes, so odds for missions against
  enemies may be `assumed` or unavailable there and identical in omniscient — verify both
  and do not assume they agree.
- Absent stays null: an absent floor is the default, not `0`; unknown odds are `unknown`,
  not a pass.
- **Registry order is load-bearing.** Add the veto in the position the explanation should
  read, and do not reorder existing rules — `applyRules` and `scoreCandidates` emit in
  registry order and reshuffling silently rewrites every explanation.
- Truncation announces itself if a vetoed set is capped.
- `shared/**` runs in both runtimes; the engine is `server/**` CommonJS.
- Read `docs/code-index.md`; update `Purpose:` lines and run `npm run index`.

## Acceptance

- A floor set above a candidate's band low vetoes it, with the reason naming both numbers.
- A floor of 0 vetoes nothing; an absent parameter uses the configured default, not 0.
- Candidates with `available: false` report **unknown** and are neither auto-passed nor
  auto-vetoed. Assert directly — this is the failure this spec most likely ships with.
- The floor tests `band[0]`, not `point`. Assert with a candidate whose band straddles the
  floor: on the live save `purge:3728:3729` has `point=93, band=[89,96]`, so a 90 floor
  must veto it and a 88 floor must not.
- `automatic: true` missions clear every floor and are not presented as risk decisions.
- A councilor with no candidate clearing the floor reports that, rather than an empty slot
  or a below-floor suggestion.
- `assumed` and `unmodeledModifiers` reach the rendered verdict.
- Both modes; full suite green with exact pass/fail/skip counts.
