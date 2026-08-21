# Code Review & Supabase Schema Verification

**Date:** August 19, 2026  
**Auditor:** Antigravity  
**Branch:** `codex/deploy-tech-intelligence`  
**Connected Supabase Project:** `coplenchristian@live.com's Project` (`wckfkfczckgdggefbcok` - `us-west-2`)  
**Scope:** Strategic Intelligence Suite, Local & Hosted Routing, Save Parsers, Live Supabase DB Schema & RLS Policies.

---

## 1. Executive Summary

A comprehensive code and architecture review was conducted following the implementation of the 12-endpoint Strategic Intelligence Suite and the Initiative Command Center (`/v2`). The implementation was audited for runtime safety, schema compliance, RLS policy enforcement, and contract integrity across both local Express and Cloudflare Edge Worker deployment targets.

All issues identified during the initial review pass (including the P0 worker import and P1 delta comparison discrepancy) have been **fully resolved and verified**.

---

## 2. Live Supabase DB Schema & RLS Audit

Using direct Supabase MCP database introspection against project `wckfkfczckgdggefbcok`:

### Tables & Column Verification

1. **`public.campaigns`**
   - **Columns:** `campaign_key` (PK, text), `display_name` (text), `is_public` (bool, default `true`), `current_save_last_modified` (timestamptz), `current_game_time` (text), `current_save_filename` (text), `updated_at` (timestamptz).
   - **RLS:** Enabled.
   - **Row Status:** Active row for campaign `initiative` (`the Initiative Campaign`, pointing to latest `Autosave.gz`).

2. **`public.player_intel_snapshots`**
   - **Columns:** `id` (PK, uuid), `campaign_key` (FK $\rightarrow$ `campaigns.campaign_key`), `save_filename` (text), `save_last_modified` (timestamptz), `game_time` (text), `difficulty` (text), `campaign_start_year` (int4), `observer_faction_id` (int4), `observer_faction_name` (text), `snapshot` (jsonb), `chatgpt_export` (jsonb), `visibility` (text, check constraint `visibility = ANY (ARRAY['player', 'enhanced', 'omniscient'])`), `generated_at` (timestamptz), `created_at` (timestamptz).
   - **RLS:** Enabled.
   - **Row Count:** 296 published snapshots spanning historical turns across Player, Enhanced, and Omniscient tiers.

### Row Level Security (RLS) Policies

Both policies are active, permissive for `{anon, authenticated}` roles, and restricted to `SELECT` operations:
- **Campaigns Policy:** `(is_public = true)`
- **Snapshots Policy:**
  ```sql
  ((visibility = ANY (ARRAY['player'::text, 'enhanced'::text, 'omniscient'::text])) 
   AND (EXISTS (
     SELECT 1 FROM campaigns c 
     WHERE c.campaign_key = player_intel_snapshots.campaign_key AND c.is_public = true
   )))
  ```
- **Write Operations:** Public `INSERT`, `UPDATE`, and `DELETE` are strictly denied by RLS and require the local-only `service_role` key.
- **Security Advisory Linter:** Returned `0` security vulnerabilities (`lints: []`).

### Migrations History
Confirmed that all 6 migrations are applied and in sync:
1. `20260817183308_create_player_intel_tables`
2. `20260817183826_player_intel_upload_chunks`
3. `20260817184902_remove_player_intel_upload_chunks`
4. `20260817204009_allow_public_omniscient_snapshots`
5. `20260817204508_remove_legacy_snapshot_unique`
6. `20260818180457_allow_public_enhanced_snapshots`

---

## 3. Code Review Findings & Fixes Applied

### 3.1 P0: Hosted Worker `arrivals` ReferenceError (FIXED)
- **Finding:** `site/worker/index.js` called `friendlyStrengthAtDestination` inside the `arrivals` route handler, but the import had been accidentally omitted during a refactor.
- **Resolution:** Re-added `friendlyStrengthAtDestination` to `site/worker/index.js` imports from `../shared/intelResources.mjs`.

### 3.2 P1: Delta Calculation Asymmetry (FIXED)
- **Finding:** Local Express was passing the raw previous save (`cachedPreviousRawSave`) to `deltaResource` while the current snapshot was filtered by observer mode, causing an asymmetry in comparison data. Furthermore, when no previous save was present (e.g. initial hosted load), `deltaResource` fabricated a 30-day window.
- **Resolution:**
  1. Updated `server/index.js` to filter the previous save with `buildFilteredSnapshot(cachedPreviousRawSave, mode, observerId)`.
  2. Updated `shared/intelResources.mjs` (`deltaResource`) to return `comparisonAvailable: false`, `gameDaysElapsed: null`, and `previousDate: null` when no previous snapshot is supplied.

### 3.3 P1: `transfers` Endpoint Semantics (DOCUMENTED)
- **Finding:** `/api/intel/transfers` was re-scoped from treaty resource transfers to orbital fleet transit tracking with `destination` filtering.
- **Resolution:** Confirmed that orbital fleet tracking is the primary strategic need. Updated documentation in `AGENTS.md` and `docs/strategic-intelligence-suite/summary.md`.

### 3.4 P2: Dead Import Removal & Fallback Cost Metadata (FIXED)
- **Finding:** `transferResourceRow` was imported in `server/intelResources.js` but unused. Fallback resource costs (used when save templates lack specific cost fields) were not explicitly labeled.
- **Resolution:**
  1. Removed `transferResourceRow` import from `server/intelResources.js`.
  2. Added `isEstimatedCost: true` tagging in `constructionResource` and `shipDesignsResource` when fallback costs are utilized.

---

## 4. Verification Matrix

| Component | Test Executed | Command | Result |
|---|---|---|---|
| **API Endpoints (12/12)** | Automated contract & schema test | `node test_new_intel_endpoints.js` | **12 PASSED, 0 FAILED** |
| **Supabase Publisher** | Save parsing & payload generation | `npm run push:dry-run` | **24 snapshots validated** |
| **Static Worker Bundle** | Build verification & tree shaking | `npm run build:site` | **0 build errors** |
| **Browser Command Center** | Headless UI & canvas verification | `node test_browser_v2.js` | **0 rendering errors** |
| **Supabase Security** | Security & performance advisory linting | `get_advisors (MCP)` | **0 security lints** |

---

## 5. Deployment Guidelines

1. **Local Development:**
   - Run `node server/index.js` or `.\start_dashboard.ps1`.
   - Access dashboard at `http://localhost:3000` and Command Center v2 at `http://localhost:3000/v2`.
2. **Publishing New Saves:**
   - Execute `.\push_latest_to_supabase.ps1` or `npm run push:supabase` (uses local-only service role key).
3. **Cloudflare Worker Deployment:**
   - Ensure environment variables `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_CAMPAIGN_KEY` are configured. Never commit `SUPABASE_SERVICE_ROLE_KEY`.
