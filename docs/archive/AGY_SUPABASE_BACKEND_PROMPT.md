# Antigravity prompt: Supabase backend

You are implementing the Supabase backend for `F:\Windsurf\Terra-Invicta-AI-Summary`.

Goal:
Keep the existing local dashboard behavior unchanged, but add a hosted backend so the deployed ChatGPT Site can read the latest sanitized Player Intel snapshot. A local publisher script should parse the newest Terra Invicta save and upload only safe Player Intel data to Supabase.

Architecture:

1. Local mode remains Express/file-backed:
   - Keep `server/index.js` and the existing local `/api` routes working.
   - Local save selection/default behavior must continue to use the newest save in the Terra Invicta Saves folder.
   - Do not make the local dashboard depend on Supabase.
2. Hosted mode uses Supabase:
   - The hosted worker/API reads sanitized Player Intel rows from Supabase.
   - It must never read or expose raw save files.
   - It must never expose raw, enhanced, or omniscient snapshot modes.
3. Publisher:
   - Add `scripts/push_latest_to_supabase.js`, or an equivalent PowerShell wrapper.
   - Default to the latest save; do not require a path.
   - Support `--dry-run` and an optional explicit `--save` only for testing.
   - Reuse the existing `saveParser`, `snapshotBuilder`, `intelligenceFilter`, and template/capability logic. Do not duplicate parser logic.
   - Build one sanitized Player Intel payload per observer faction, preferably discovering observer faction IDs from the snapshot rather than hard-coding them. Keep the current faction IDs only as a fallback.
   - Upload only filtered Player Intel snapshots and the ChatGPT-readable Player Intel export. Never upload `.gz` saves, `rawSnapshot`, omniscient data, enhanced data, or unfiltered alien assets.
   - Make the upload idempotent by campaign key + save last-modified timestamp + observer faction ID.
   - Print filename, save modified time, in-game date, observers uploaded, and row counts. Never print keys.

Supabase schema:

Use the checked-in migration under `supabase/migrations`.

Tables:

- `public.campaigns`
  - `campaign_key text primary key`
  - `display_name text not null`
  - `is_public boolean not null default true`
  - `current_save_last_modified timestamptz`
  - `current_game_time text`
  - `current_save_filename text`
  - `updated_at timestamptz not null default now()`
- `public.player_intel_snapshots`
  - `id uuid primary key default gen_random_uuid()`
  - `campaign_key text not null references public.campaigns(campaign_key) on delete cascade`
  - save metadata fields
  - `observer_faction_id integer not null`
  - `observer_faction_name text`
  - `snapshot jsonb not null`
  - `chatgpt_export jsonb`
  - `visibility text not null default 'player' check (visibility = 'player')`
  - generated/created timestamps
  - unique `(campaign_key, save_last_modified, observer_faction_id)`

RLS/security:

- Enable RLS on both tables.
- Public/anon may `SELECT` campaigns only when `is_public = true`.
- Public/anon may `SELECT` snapshots only when `visibility = 'player'` and the referenced campaign is public.
- Do not grant anon `INSERT`, `UPDATE`, or `DELETE`.
- The local publisher uses `SUPABASE_SERVICE_ROLE_KEY` from the local environment only.
- Never put the service-role key in `public/`, `dist/`, browser code, worker source, or any public variable.
- Use explicit `TO anon, authenticated` policies. Do not use `auth.role()`.
- Do not create `SECURITY DEFINER` functions in an exposed schema.
- Read the campaign's current save timestamp first, then read the matching observer row so observers cannot be mixed across saves.

Publisher behavior:

- campaign key defaults to `initiative`, configurable by `SUPABASE_CAMPAIGN_KEY`.
- Read `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from the environment.
- Use a pinned `@supabase/supabase-js` version and commit the lockfile.
- Generate the same Player Intel snapshot that local mode shows, including correct daily resource fields, capability/discovery gating, Deep System Skywatch/Skywatch visibility, dynamic observer targets, unavailable combat power when no real scalar exists, and weapon loadout labels.
- Upsert campaign metadata and each observer snapshot.
- Do not let an older save overwrite a newer `current_save_last_modified`.
- Add clear errors for missing variables or failed API calls.

Hosted API:

- Add a Supabase-backed adapter for the hosted worker/API.
- Preserve the local adapter separately; select the backend by runtime/environment.
- Preserve these response shapes:
  - `GET /api/snapshot?mode=player&observer=<id>`
  - `GET /api/export?mode=player&observer=<id>&format=chatgpt|full`
  - `GET /api/templates/effects` if needed
- Hosted mode must force `mode=player` even if a caller requests another mode.
- Use only `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`/anon key, and `SUPABASE_CAMPAIGN_KEY` in the hosted runtime.
- If a requested observer row does not exist, return a clear 404 JSON error.
- Keep the static snapshot fallback if useful, but Supabase is the primary hosted source once configured.

Tests/documentation:

- Run syntax checks and existing local smoke tests.
- Test local mode with no Supabase variables.
- Test publisher `--dry-run` against the newest save.
- Test Supabase public reads and rejected public writes.
- Test hosted snapshot/export response shapes for Initiative and Servants observers.
- Test hosted mode cannot return raw/enhanced/omniscient data.
- Test idempotent republishing and stale-save protection.
- Update `AGENTS.md` and `.env.example`; never commit real credentials, generated `.env` files, save files, or raw exports.
- Report changed files, commands run, and remaining limitations.
