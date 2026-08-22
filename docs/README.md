# Docs

**This folder holds specs with open work, and is the single tracker for what is built,
what is in flight, and what is left.** Anything shipped and closed moves to `archive/`.

There is deliberately no second status file. This repo carries a scar from three
hand-maintained parallel lists in `shared/intel/registry.mjs` that disagreed until all
three were derived from one table — the same failure applies to progress tracking. Update
this table in the same commit as the work.

Last updated 2026-08-21.

---

## Open work

| # | doc | state |
| :-- | :-- | :-- |
| 1 | **the total-war gate is wrong twice over** | **not started, and it changes a verdict.** Two stacked assumptions compound. (a) `buildTotalWarState` divides its year gate by `alienProgressionSpeed`; no caller passes one, so it assumes 1 while the save says 200% — a 20-year gate where the game's is 10. (b) `campaignStartYear` is `null` in the save, so `assumedCampaignStartYear: 2022` is used; the player's campaign began **2026**, making `yearsElapsed: 13` actually 9. Shipped reads `state: safe, 20-year gate, 7 years remaining`. Truth is a 10-year gate with 9 elapsed — **1 year remaining**. Neither is silent (`progressionSpeedAssumed`, `yearsElapsedSource` both announce), but the composite on screen is materially wrong. **The start year is measurable**: the earliest real dated record in the save is `2026-02-01` on twelve `TIHabModuleState.completionDate` entries — the starting habs. Treat that as a measured lower bound and stop assuming 2022. Beware `0001-01-01`, which appears 113 times as a "never" sentinel and must not be read as a date. Moves a published figure, so it needs before/after capture |
| 1b | **this session's work is missing from the AI exports** | **not started.** Measured: of the additions since `b0ec6dc`, only `difficultyLabel` and `capabilities` reach `shared/markdownExports.mjs`. `riskFloor`, `chain`, `reachability` and `benchedOmittedCount` do not, so every agent reading `/latest-*.md` is blind to them. See the new CLAUDE.md section — a figure that exists only in the browser is invisible to half this project's consumers |
| 3 | `research-category-rate-spec.md` | **in flight.** Durations use one flat rate and ignore per-category bonuses. Xenology is +20% today, so those estimates are 17% long. Engineers are already in the measured income — do not double-apply |
| 4 | `fleet-engagement-spec.md` | **not started.** Per-fleet hull-count estimates in THREAT, reachability-gated. Note the existing tiers top out at three ships while 26 of 57 fleets are larger and 3 exceed the whole 24-hull sweep |
| 5 | `repo-structure-spec.md` | **not started.** Separate the 2025 report tool from the dashboard. Approved, never assigned |
| 6 | bench ordering | **open question, not a defect.** `benched` is sliced without sorting, so the eight shown are registry order rather than the highest-value eight. Sorting would change which appear, and emission order is load-bearing for explanations — a deliberate call, not a fold-in |

### Small follow-ups, unassigned

- **`res.sendFile` refuses to serve the shell from a dot-directory.** `server/index.js`
  passes an absolute path to `res.sendFile`, and `send` defaults to `dotfiles: 'ignore'`,
  so `/` and `/v2/` return 404 for any checkout living under a path segment that starts
  with a dot — an agent worktree in `.claude/worktrees/`, for instance. The API routes and
  `express.static` are unaffected, so it presents as a blank dashboard rather than an
  error. `tests/cssComputedStyle.test.js` fails there for the same reason.
- **A fresh checkout fails two byte-comparison tests.** `core.autocrlf=true` with no
  `.gitattributes` gives a new clone or worktree CRLF copies of `docs/code-index.md` and
  `tests/fixtures/frozen-snapshot-*.md`, while the generators emit LF. The checked-in
  index test and the frozen-snapshot test both compare bytes and both fail until the files
  are normalised by hand. A `.gitattributes` pinning those paths to LF would close it.

## Shipped

| doc | commit | note |
| :-- | :-- | :-- |
| `drive-explorer-spec.md` | uncommitted | DRIVES view + `/api/intel/drive-explorer` + war-room §9. All 541 drives against one design, none hidden: 37 fittable / 486 researchable / 18 never / 0 unresolved on the live save, and 306 of 541 marked reactor-incompatible with the class they would need. The measured half (ΔV, acceleration) and the estimated half (destination reach) render in two different registers, asserted by computed style in `scripts/verify_drive_explorer.js`. `?limit=` needed a scoped 1,000-row ceiling — `CATALOGUE_LIMIT_BOUNDS`, shared so both runtimes decide alike |
| `code-index-spec.md` | `bbef9f0` | generated index, required agent reading |
| `research-vs-procurement-spec.md` | `baaa38a` | also repaired the self-referential `--text-dim` token that silently broke 164 rules |
| `save-autodetect-spec.md` | `b0ec6dc` | `/api/save-state`, 5 s visibility-gated poller, opt-in auto-load, 503 retry |
| `research-tab-layout-spec.md` | `b0ec6dc` | eight font sizes → four; 41% empty column fixed; per-row global badge removed |
| `fleet-procurement-spec.md` | `36fa5ba` `2b6e3d5` | FLEET view; refit advisor with non-composability enforced; armour gap indicator |
| `obsolete-marker-spec.md` | `cdceae7` | the parts filter was a real correctness fix — it was recommending a retired weapon |
| `research-chain-spec.md` | `e98413f` | alternate-prereq semantics, `routesEvaluated`, whole-chain drive payoffs, first-in-class verdicts |
| `risk-tolerance-spec.md` | `b3b77f6` | success floor as a pairing-scoped registry veto, testing the band low not the midpoint |
| `research-row-naming-spec.md` | — | was already implemented; this table previously said otherwise |
| `model-verification-review.md` | `b0ec6dc` `e98413f` | all findings actioned |
| `research-advisor-spec.md` | through §9 | still the governing document: §0 (nothing campaign-specific) and §3b (availability is rolled, not derived) bind any further work |
| `chain-visibility-spec.md` | `bdcff55` | reachable chains promoted into COMMAND; `Colony Core → Battlestations` now on screen. Pion Torch refused at 413 months against a 156-month horizon |
| `campaign-settings-spec.md` | `39770d0` | ten settings baked; a custom campaign no longer reads "Normal". Proven not to move any figure across 152 surfaces × 3 modes |
| type scale follow-up | — | 11/10/9.5/9 → 12.5/11/10/9; every step now ≥1px apart. COMMAND at 1920 measured 2.858 (player) / 2.915 (omniscient) screens, 0 leaf overflows |
| `benched` truncation follow-up | — | `benchedTotalCount` / `benchedOmittedCount` on the cycle plan and through the board. Live save: 8 of 46 shown (player), 8 of 427 (omniscient). Also fixed `counts.assigned` / `counts.benched`, which were read off a `counts` object that never carried them and rendered a confident "0 allocated · 0 benched" on every plan |

## Closed as needing no work

Recorded because the measurement is the deliverable, and because acting on the assumption
would have introduced errors.

- **Campaign rate multipliers.** Research, mining, national IP and alien progression all
  run at 200% and are **already reflected**, because the dashboard reads measured values
  rather than computing from base rates. Applying a 2× correction would have broken correct
  figures. Evidence in `campaign-settings-spec.md`.
- **Engineers (+95%).** Already inside measured research income. Applying separately would
  double-count.

## Archive

`archive/` holds finished plans, shipped specs and completed reviews. They are kept because
**source comments cite them** — they carry the reasoning behind decisions in the code, and
several record a model that was tried and rejected, which is worth as much as the one that
shipped.

Notable: `archive/directive-rule-engine-plan.md` is the v1 engine, superseded by
`archive/directive-engine-v2*.md`. `archive/strategic-intelligence-suite/` holds earlier
reviews.

## Conventions

Specs here record **what was measured**, not what was assumed. Where a model was rejected,
the rejection and its evidence stay in the document rather than being deleted —
`research-advisor-spec.md` keeps a superseded armour derivation for exactly that reason,
and `campaign-settings-spec.md` keeps two discarded measurement attempts so they are not
repeated.

When archiving, update the citing source comments in the same commit; the paths are
load-bearing.
