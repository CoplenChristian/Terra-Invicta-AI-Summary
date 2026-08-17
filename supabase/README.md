# Supabase backend

This directory contains the database migrations for the hosted intelligence backend.

The migration creates:

- `public.campaigns` for public campaign metadata and the current-save pointer.
- `public.player_intel_snapshots` for published Player Intel and explicitly enabled Omniscient snapshots per observer faction.

The public roles receive `SELECT` only. The local publisher is the only intended writer and must use
`SUPABASE_SERVICE_ROLE_KEY` from a local environment variable. Raw save files and credentials must never be
uploaded. For this campaign, the publisher intentionally stores separate `player` and `omniscient` snapshot
rows; the hosted worker defaults to `player` and accepts `mode=omniscient` when explicitly requested.

## Apply to a hosted project

The workspace has not been linked to a Supabase project yet. After authenticating the Supabase CLI or MCP and
choosing the intended project, run from the repository root:

```powershell
npx --yes supabase@latest link --project-ref <project-ref>
npx --yes supabase@latest db push --linked
```

Review the migration with `npx --yes supabase@latest db push --linked --dry-run` first if desired. The Supabase
Data API must expose the two public tables; the migration grants only the read operations required by the
public site.

## Verify the security boundary

After applying the migration, run:

```powershell
npm run verify:supabase
```

That should show public reads succeeding and public writes rejected. With Docker running, also run:

```powershell
npx --yes supabase@latest db lint --local --schema public
```

The hosted reader should select the campaign's `current_save_last_modified` first, then request the matching
observer row from `player_intel_snapshots`. This prevents the site from mixing observers from different saves.
