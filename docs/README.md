# Docs

**This folder holds specs with open work.** Anything shipped and closed moves to `archive/`.

## Active

| doc | status |
| :-- | :-- |
| `research-advisor-spec.md` | shipped through §9, but still the governing document for the two below — §0 (nothing campaign-specific) and §3b (availability is rolled, not derived) bind any further work |
| `research-row-naming-spec.md` | shipped. Rows lead with `gateProjectName`, item parenthesised, `alsoUnlocks` badged when greater than one |
| `research-tab-layout-spec.md` | shipped, with one follow-up outstanding: the type scale landed at 11/10/9.5/9, and three of the four steps sit within 1px, so the hierarchy still reads flat. Widening the gaps is a small CSS change |
| `save-autodetect-spec.md` | shipped in `b0ec6dc`. `/api/save-state` plus a 5 s visibility-gated poller, opt-in auto-load, 503 retry on the load path |
| `campaign-settings-spec.md` | **not implemented.** The save carries `researchSpeedMultiplier`, `miningProductivityMultiplier`, `nationalIPMultiplier` and `alienProgressionSpeed` all at 200%; only the difficulty label is baked, so every duration and rate projection uses stock numbers |
| `risk-tolerance-spec.md` | **not implemented.** Mission odds are computed and used only to weight expected hate — no rule vetoes on a success floor, so the player cannot say how much risk they will accept |
| `fleet-procurement-spec.md` | shipped (Part A: dedicated FLEET view procurement extraction; Part B: validated refit advisor with non-composability enforcement) |
| `obsolete-marker-spec.md` | shipped (backend bake + candidate pool filtering + frontend obsolete marker and active-first sort order) |
| `research-chain-spec.md` | shipped (alternate prereq pathfinding + routesEvaluated savings + whole-chain drive payoffs + first-in-class capability verdicts) |
| `model-verification-review.md` | independent review; **actioned (pushed in `b0ec6dc`).** The ×1.35 alien thrust factor, two confounded numbers in the allocation-formula rejection, and Claim 7's understated uncertainty band |

## Archive

`archive/` holds finished plans, shipped specs and completed reviews. They are kept because **source comments cite them** — they carry the reasoning behind decisions in the code, and several record a model that was tried and rejected, which is worth as much as the one that shipped.

Notable: `archive/directive-rule-engine-plan.md` is the v1 engine, superseded by `archive/directive-engine-v2*.md`. `archive/strategic-intelligence-suite/` holds earlier reviews.

## Conventions

Specs here record **what was measured**, not what was assumed. Where a model was rejected, the rejection and its evidence stay in the document rather than being deleted — `research-advisor-spec.md` keeps a superseded armour derivation for exactly that reason.

When archiving, update the citing source comments in the same commit; the paths are load-bearing.
