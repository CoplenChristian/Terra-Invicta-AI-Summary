# Docs

**This folder holds specs with open work, and is the single tracker for what is built,
what is in flight, and what is left.** Anything shipped and closed moves to `archive/`.

There is deliberately no second status file. This repo carries a scar from three
hand-maintained parallel lists in `shared/intel/registry.mjs` that disagreed until all
three were derived from one table — the same failure applies to progress tracking. Update
this table in the same commit as the work.

Last updated 2026-08-21 (item 1, the total-war gate, shipped).

---

## Open work

| # | doc | state |
| :-- | :-- | :-- |
| 1b | **this session's work is missing from the AI exports** | **partly closed.** Measured: of the additions since `b0ec6dc`, only `difficultyLabel` and `capabilities` reach `shared/markdownExports.mjs`. `riskFloor`, `chain`, `reachability` and `benchedOmittedCount` still do not. The per-category research bonuses now do — a `research-category-bonuses` block in §8 of the war room, plus `categoryBonuses` on `/api/intel/research`. See the CLAUDE.md section: a figure that exists only in the browser is invisible to half this project's consumers |
| 3 | `research-category-rate-spec.md` | **bonuses shipped; the duration correction is now the open half.** All five wiki-named bonus sources are baked (`shared/researchCategoryBonus.mjs`), including the two no `techBonuses` sweep can see: alien-activity investigations (a plain `alienInvestigations` integer, +1% Xenology each, which took the observer from a reported +20% to a measured **+44%**) and the ship Mobile Space Science Lab, which is *declared unhandled* because the snapshot carries no per-ship utility-module names. The diminishing-returns curve is implemented per source type above 50%, investigations exempt. **The delivery mechanism now pins**: with `ProjectBonus` read from `cachedYearlyRevenue.Projects` (21 → +95%) the wiki allocation formula reproduces all four measured slots to within 0.15% with zero free parameters. Durations are deliberately still flat and labelled, because the pin shows the flat rate's dominant error is the whole allocation multiplier (**2.11×**), not the category term |
| 3b | **price durations through the pinned allocation model** | **not started, and it moves every duration in three endpoints.** `monthsAtIncome` is `cost / monthlyIncome`, but `cachedYearlyRevenue.Research` is the *pre-multiplier* base: over the measured interval the observer's slots received 2.11× it. Every stated duration is therefore an upper bound by roughly that factor. **This contradicts the "research needs no adjustment" verdict in `campaign-settings-spec.md`, which rested on delivered/predicted ratios of 1.147× / 0.993×; the two measurements must be reconciled before either is acted on.** Needs a before/after capture across both modes, since it changes every figure the advisor prints |
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
- **A worktree has no `config.json`.** It is gitignored, so every save-backed test errors in
  a fresh agent worktree until it is copied across from the main checkout. Harmless once
  known, but it presents as a wall of failures unrelated to the change under test.

## Shipped

| doc | commit | note |
| :-- | :-- | :-- |
| **the total-war gate (tracker item 1)** | this commit | **The framing was right about the verdict and wrong about the evidence, in the useful direction.** Both defects were real and both are fixed, but the start year did not need deriving from dated records: the save carries `campaignStartYear` outright, in **`TIGlobalResearchState`** rather than `TIMetadataState` — present in **14 of 14** saves, 2026 on this `2026Start` campaign and 2022 on the older `ModernDayStart` ones (so the 2022 constant was right for those and wrong by four years for this one). `TITimeState.daysInCampaign` is better still, also 14 of 14: it is the game's own campaign-duration counter, so it needs no subtraction. 3256 days puts the campaign start at **2026-02-01**, the same date the earliest-record walk found, and the scenario is literally named `2026Scenario` / `2026Start` — four independent readings, one answer, and no walker built. Year subtraction is kept only as the second fallback because it systematically over-reports: a campaign begun 2026-12-31 and now reading 2036-01-01 scores 10 elapsed years and opens a 10-year gate nine years early. `campaignStartYearMeasured` therefore becomes **`true`**, not false — the flag's target existed all along in a state nobody looked in, and reporting it false would understate provenance. **Measured before → after, both modes:** year gate `20 → 10`, elapsed `13 → 8.91`, remaining `7 → 1.09`, `progressionSpeedAssumed true → false`, `maximumAlienHate 2300 → 2782`. A **third** defect surfaced only once a real speed was passed in: the wiki (Aliens, "Alien Progression Rate", raw wikitext read 2026-08-21 at the wiki's new home `wiki.hoodedhorse.com` — the fandom mirror is now 410) states *"Increase in Alien Maximum Hate per Year is multiplied by X%"* alongside *"Every 'Years Before Aliens Can Do Something' timer has its duration divided by X%"*. Only the threshold half was implemented, so max hate would have shipped at 1891 instead of 2782. **Research reachability moved, deliberately**: the horizon is defined as the campaign already played, so `156 → 106.9` months, `490,558 → 336,158` points, and `horizonAssumed true → false`. No chain changed side of it (`promotedCount` 10, beyond-horizon 11, both modes). No directive verdict flipped. Elapsed time is now resolved once in `shared/campaignElapsed.mjs` instead of twice in parallel |
| `drive-explorer-spec.md` | `5f4cd64` | DRIVES view + `/api/intel/drive-explorer` + war-room §9. All 541 drives against one design, none hidden: 37 fittable / 486 researchable / 18 never / 0 unresolved on the live save, and 306 of 541 marked reactor-incompatible with the class they would need. The measured half (ΔV, acceleration) and the estimated half (destination reach) render in two different registers, asserted by computed style in `scripts/verify_drive_explorer.js`. `?limit=` needed a scoped 1,000-row ceiling — `CATALOGUE_LIMIT_BOUNDS`, shared so both runtimes decide alike |
| `mobile-and-tech-search-spec.md` | `dda9b25` | **Part A's premise was wrong and the measurement says so.** `mc-board-table` was never broken: its wrapper measured `canScroll=true, maxScrollLeft=467, fullyRevealed=true`, so expansion's 164 / threat's 147 / records' 45 were reachable by scrolling, not clipped. The only genuinely unreachable content was DRIVES — 64 elements with no scrollable ancestor, worst edge 937px in a 375px viewport. One line caused it: the `max-width: 900px` block turns `.init-view__grid` into a column flex container and the base rule's `align-items: start` carried over, so `.init-view__span` shrink-wrapped to the table's 937px max-content and `.de-table-wrap` measured `clientWidth 890 / scrollWidth 890` — its `overflow-x: auto` had nothing to scroll. Stretching the items fixed it (`313/890`). Generalising FLEET's `min-width: 100%; table-layout: fixed` to narrow widths then took command/expansion/threat to **zero** overflow rather than merely scrollable. Now 0 unreachable at 375/414/768 in both modes; COMMAND 2.74 / 2.80 screens at 1920. Part B is a RECORDS panel over the existing `tech-search` + `tech-tree` rows: 165 unlocked of 750, `Copperhead` → *Hydrolox High Explosive Missiles*. `scripts/verify_mobile_overflow.js` measures it off a live DOM |
| three review findings on `dda9b25` | `1b1b7ec` | An independent review flagged the third scroll hint as revealed by width alone. **The measurement inverted the finding**: below 900px those tables genuinely overflow (`min-width: 840px` vs a 632px wrapper), so the un-gated reveal was accidentally truthful — true by construction, false the moment either number moves. The real defect was above the breakpoint, hint hidden while the table still overflowed (905px: 637 vs 840; 1040px: 772 vs 840). A guard now derives the styled-hint set from the stylesheet and fails on any unregistered one; there is no fourth today. Also `unlocked-tech` printing "0 unlocked of 0 projects" when the graph is unreadable — the body carried the same false claim independently of the footer, so both are gated on the census |
| `.gitattributes` for generated files | `795c5fe` | `docs/code-index.md` and `tests/fixtures/frozen-snapshot-*.md` pinned to LF, so a fresh clone or agent worktree no longer fails two byte-comparison tests for an environment reason |
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
