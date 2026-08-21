# Docs

**This folder holds specs with open work.** Anything shipped and closed moves to `archive/`.

## Active

| doc | status |
| :-- | :-- |
| `research-advisor-spec.md` | shipped through §9, but still the governing document for the two below — §0 (nothing campaign-specific) and §3b (availability is rolled, not derived) bind any further work |
| `research-row-naming-spec.md` | **not implemented.** Rows are labelled with the item a project unlocks rather than the project — `Dreadnought` for what is actually `Ships of the Line` |
| `research-tab-layout-spec.md` | **not implemented.** Presentational fix for the Research Advisor — eight font sizes, a 41% empty second column, and a global badge rendered per-row |
| `save-autodetect-spec.md` | **not implemented.** Local dashboard polls for a new save and offers to load it; the server already re-detects on every request, so this is one cheap route plus a client poller |
| `fleet-procurement-spec.md` | shipped (Part A: dedicated FLEET view procurement extraction; Part B: validated refit advisor with non-composability enforcement) |
| `obsolete-marker-spec.md` | shipped (backend bake + candidate pool filtering + frontend obsolete marker and active-first sort order) |
| `model-verification-review.md` | independent review; **actioned (pushed in `b0ec6dc`).** The ×1.35 alien thrust factor, two confounded numbers in the allocation-formula rejection, and Claim 7's understated uncertainty band |

## Archive

`archive/` holds finished plans, shipped specs and completed reviews. They are kept because **source comments cite them** — they carry the reasoning behind decisions in the code, and several record a model that was tried and rejected, which is worth as much as the one that shipped.

Notable: `archive/directive-rule-engine-plan.md` is the v1 engine, superseded by `archive/directive-engine-v2*.md`. `archive/strategic-intelligence-suite/` holds earlier reviews.

## Conventions

Specs here record **what was measured**, not what was assumed. Where a model was rejected, the rejection and its evidence stay in the document rather than being deleted — `research-advisor-spec.md` keeps a superseded armour derivation for exactly that reason.

When archiving, update the citing source comments in the same commit; the paths are load-bearing.
