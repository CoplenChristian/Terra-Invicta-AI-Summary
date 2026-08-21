# Codex Review of Antigravity Strategic Intelligence Changes

**Date:** August 19, 2026
**Reviewer:** Codex
**Branch:** `codex/deploy-tech-intelligence`
**Scope:** New/Enhanced intel endpoints, production-plan POST, live Supabase schema & RLS validation, new standalone parsers.

---

## 1. Bottom Line

The 12-endpoint strategic intelligence suite is **well-designed and mostly correct**. The shared projection layer in `shared/intelResources.mjs` is genuinely shared between local Express and the hosted worker, the new endpoints return sensible, deterministic numbers against the live save, and the Supabase schema/RLS on the connected project (`wckfkfczckgdggefbcok`) **matches the checked-in migrations**.

There is **one P0 runtime bug** that will crash the hosted worker's `arrivals` endpoint, plus a handful of P1/P2 correctness, contract, and hygiene issues.

---

## 2. P0 — Hosted worker `arrivals` is broken (ReferenceError)

`site/worker/index.js:457` still calls `friendlyStrengthAtDestination(fleet, snapshot)` inside the `arrivals` case, but the antigravity edit **removed `friendlyStrengthAtDestination` from the import block** (lines 3–35) while adding the new resource builders. `transferResourceRow` was also removed from the import but is no longer referenced (clean removal), whereas `friendlyStrengthAtDestination` **is still used**.

Consequence: any `/api/intel/arrivals` or `/api/arrivals` request on the hosted worker throws
`ReferenceError: friendlyStrengthAtDestination is not defined` → 500.

**Fix:** re-add `friendlyStrengthAtDestination` to the worker import list (it is exported from `shared/intelResources.mjs:377`). Local Express is unaffected because `server/intelResources.js` still imports it (line 21).

---

## 3. Live Supabase schema & RLS — VALIDATED OK

Verified against the connected live project via the REST/OpenAPI introspection (service role) plus `npm run verify:supabase`:

- Tables `public.campaigns` and `public.player_intel_snapshots` columns match the migration `20260817000000_create_player_intel_tables.sql`.
- `visibility` now accepts `player|enhanced|omniscient` (matches latest migration `20260818000003_allow_public_enhanced_snapshots.sql`); live rows exist for all three modes.
- RLS live tests all pass:
  - Public SELECT on campaigns / player / omniscient / enhanced snapshots: OK.
  - Public INSERT/UPDATE/DELETE: correctly rejected (`permission denied`).
  - Hosted adapter returns Initiative (4712) Player snapshot with 8 factions / 30 councilors; Servants (4713) resolves; ChatGPT export generates.

The anon-key OpenAPI root returns 401 (expected — only secret key can introspect), which confirms the anon key is not over-privileged.

**Schema/migration drift:** none found. Migrations are consistent with the live DB.

---

## 4. What works well (verified against the live save)

Ran every new builder through the real snapshot (omniscient, observer 4712):

| Endpoint | Result |
| :--- | :--- |
| `logistics` | 5 resource rows; money, boost, MC block present; productionByBody/topSites populated |
| `construction` | merged ship + module + hab queues |
| `transfers` | 22 moving fleets with origin/destination/daysRemaining (e.g. `Victor-83`, `Earth orbit`, 8d) |
| `ship-designs` | 224 designs with component IDs, `numberExisting`, `numberUnderConstruction` |
| `theaters` | body-by-body posture with status enum |
| `infrastructure` | per-hab module manifests + strategicCapabilities |
| `alien-threat` | actualHate 71.6 / minimumHate 18 with difficulty math + retaliation |
| `delta` | event stream + per-resource changes |
| `mining` | sortable site yields + best unclaimed sites |
| `mobility` | per-destination ΔV / travel-time / feasibility |
| `production-plan` | canAffordNow, maxAffordableNow (16), bottleneck, shipyard capacity |
| `body-status` | Mars: 28 habs, 5 fleets, mining sites, queues |

`node --check` passes on all changed JS/MJS. `quantity` is clamped via `Math.max(1, …)`. Local server binds `127.0.0.1` by default. The new `.ps1` parsers (`parse_alien_*`, `parse_faction_*`) are consistent with the AGENTS.md contract (save picker, `-Latest`, `-Format`, `-OutputPath`).

---

## 5. P1 issues

### 5.1 Server `delta` compares filtered-current against RAW previous
`server/index.js:359` passes `previousSnapshot: cachedPreviousRawSave` (the raw build) into `buildResource(…,'delta',…)` → `deltaResource(filteredCurrent, rawPrevious, …)`. The current side is filtered by mode; the previous side is **not**. For the observer's own faction (which the player legitimately owns) this is not a leak, but the two sides are inconsistent. Prefer passing the **filtered** previous snapshot (the same one `buildFilteredSnapshot` uses for `changesSincePrevious`) so the delta is computed over comparable, gated data.

### 5.2 Hosted `delta` fabricates a fallback date
In the worker, `deltaResource(snapshot, null, observerId)` is always called with `null` previous, so `gameDaysElapsed` defaults to a fabricated 30-day window while `previousDate` is `null`. Either label the response as "no previous save / comparison unavailable" and drop the misleading `gameDaysElapsed`, or surface the last-published snapshot identity so hosted deltas are real.

### 5.3 `transfers` endpoint changed semantics (intentional, but breaking)
`/api/intel/transfers` previously returned `resourceTransfers` (resources moving between factions) via `transferResourceRow`. The rewrite makes it **fleet orbital transfers** via `transfersResource`. This matches the documented `destination=Mars` usage and is a deliberate re-scoping, but it is a breaking contract change for any existing consumer of resource-transfer data. The old `transferResourceRow` (and the 10 `resourceTransfers` in the live snapshot) are now unused. Confirm no consumer depended on the old shape before removing the dead code.

---

## 6. P2 issues

- **Dead import:** `server/intelResources.js:22` imports `transferResourceRow` but never calls it (same for the shared export). Remove.
- **`shipDesignsResource` hull-match for `numberExisting`:** it compares `s.hullName === d.hullName` (plus display/design), which can over-count when multiple designs share a hull. Acceptable for an estimate, but note it is an approximation.
- **Hard-coded fallback costs:** `productionPlanResource`/`shipDesignsResource`/`constructionResource` fall back to hard-coded costs (e.g. `{water:120, …}`, hab `{water:50, …}`) when save data is absent. These are visibly "estimated" but unlabeled. Tag fallback-derived numbers with a `source: 'fallback-estimate'` so consumers can distinguish real save data from assumptions.
- **`constructionResource` invents MC/cost fields:** it hard-codes `mcCost: 1`, `shipyardTier: 2`, and a fixed hab cost instead of reading save values. Fine as a scaffold, but should either read real fields or be labeled approximate.
- **Hosted `body-status`/`mobility`/`production-plan` use `snapshot.observerFactionId || 4712`:** correct, but note the observer is derived from the stored snapshot rather than the request `observer` param — intentional for mode-gated hosted reads, but worth a comment so it isn't "fixed" later into an observer-confusion bug.

---

## 7. Recommendations (priority order)

1. **Fix the worker import** (`friendlyStrengthAtDestination`) — this is the only blocking defect.
2. Pass the **filtered** previous snapshot to server `delta`, and make hosted `delta` clearly report "no comparison available" instead of a fabricated 30-day window.
3. Decide & document the `transfers` re-scoping; remove dead `transferResourceRow` code.
4. Re-run `npm run verify:supabase` and `npm run push:dry-run` after any publish-path change, since the live schema already matches migrations.

No changes were made to application source code during this review; this document is analysis only.
