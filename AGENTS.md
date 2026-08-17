# Terra Invicta Save Parser Instructions

## Save selection

When searching, summarizing, or assessing save data, always use the most recently modified save in the configured save folder.

Use the `-Latest` switch on the parser being run. Do not hard-code `initiative.gz`, `Again.gz`, or another filename unless the user explicitly requests that save.

The scripts infer the save folder from `config.json`'s `SavePath`. They consider `.gz` and `.json` files and sort them by `LastWriteTime` descending, so `-Latest` selects the newest file at runtime.

If the newest save is locked or incomplete because the game is writing it, report that condition and retry when appropriate. Do not silently fall back to an older save.

For a manual historical lookup, omit `-Latest`; the script will display a numbered, newest-first save list. `-Latest` and `-SaveNumber` are mutually exclusive.

## Faction selection

Faction parsers also present a numbered faction list unless `-FactionNumber` is supplied. Factions are sorted by display name at runtime; do not assume a faction number if the save's faction set may differ.

For Initiative analysis, identify the Initiative entry in the faction list and pass its number:

```powershell
.\parse_faction_councilors.ps1 -Latest -FactionNumber <initiative-number> -Format Json
.\parse_faction_nations.ps1 -Latest -FactionNumber <initiative-number> -Format Json
.\parse_faction_space_assets.ps1 -Latest -FactionNumber <initiative-number> -Format Json
```

## Available parsers

- `parse_alien_councilor_locations.ps1` — active alien councilors and resolved regions.
- `parse_alien_hate.ps1` — each faction's `AssessedAlienHateOfMe` value.
- `parse_faction_councilors.ps1` — selected faction's councilors, attributes, organizations, status, and locations.
- `parse_faction_nations.ps1` — selected faction's nations, aggregated control points, GDP, population, regions, stability, military tech, and Boost metrics.
- `parse_faction_space_assets.ps1` — selected faction's habs, fleets, and ships with orbit/body details.

All parsers support:

```powershell
-Format Table   # default, human-readable output
-Format Csv
-Format Json
-OutputPath <file>
```

Example latest-save queries:

```powershell
.\parse_alien_councilor_locations.ps1 -Latest
.\parse_alien_hate.ps1 -Latest
.\parse_faction_councilors.ps1 -Latest -FactionNumber <faction-number>
.\parse_faction_nations.ps1 -Latest -FactionNumber <faction-number>
.\parse_faction_space_assets.ps1 -Latest -FactionNumber <faction-number>
```

These standalone parsers read the selected save directly and do not require regenerating the broader CSV export set. Use `export_factions.ps1` only when a refreshed CSV export is specifically needed.

---

## Local Dashboard vs Hosted Supabase Backend

### 1. Local Mode (Express / File-backed)
- Local dashboard runs with `node server/index.js` or `.\start_dashboard.ps1`.
- **Local mode does NOT depend on Supabase** and requires no Supabase environment variables.
- It dynamically reads the newest save from the user's Terra Invicta saves folder and supports local switching between `Player Intel`, `Enhanced`, and `Omniscient` modes on `http://localhost:3000`.

### 2. Publishing to Hosted Supabase
To publish the newest save to Supabase so that the deployed ChatGPT Site / Worker can read the latest published intelligence data:

The hosted site serves Player Intel by default and also serves the explicitly
enabled Omniscient mode when `mode=omniscient` is requested. The two modes are
stored as separate rows per observer faction, and responses label the mode with
`intelMode` / `visibility`. Raw save files are never uploaded.

**Dry run (test without network writes):**
```powershell
.\push_latest_to_supabase.ps1 -DryRun
# Or with node:
npm run push:dry-run
```

**Live publish (uploads to Supabase):**
```powershell
.\push_latest_to_supabase.ps1
# Or with node:
npm run push:supabase
```

**Publish an explicit historical save:**
```powershell
.\push_latest_to_supabase.ps1 -Save "F:\Documents\My Games\TerraInvicta\Saves\initiative.gz"
```

### 3. Environment Variables & Security Rules

| Variable | Scope | Safe for Hosted / Client? | Purpose |
| :--- | :--- | :--- | :--- |
| `SUPABASE_URL` | Local & Hosted | **YES** | Supabase project endpoint URL. |
| `SUPABASE_PUBLISHABLE_KEY` | Local & Hosted | **YES** | Public anon key for SELECT queries under RLS. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Local ONLY** | ⚠️ **NO (NEVER COMMIT/DEPLOY)** | Admin key used by publisher to write snapshots. |
| `SUPABASE_CAMPAIGN_KEY` | Local & Hosted | **YES** | Target campaign key (default: `initiative`). |

> [!CAUTION]
> **CRITICAL SECURITY RULE:**
> - NEVER put `SUPABASE_SERVICE_ROLE_KEY` into `public/`, `dist/`, browser code, Cloudflare environment variables, worker source, or any git commit.
> - The hosted worker and web dashboard MUST only use `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (anon key).
> - Never commit real credentials, `.env` files, `.gz` save files, or raw unredacted save exports.
> - This campaign intentionally publishes both Player Intel and Omniscient snapshots because the user requested the game-state details to be available on the hosted site.

### 4. Deploying the Hosted Site
After running the publisher:
1. Ensure your hosted deployment (Cloudflare Worker / Vercel) has `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_CAMPAIGN_KEY` configured in its environment settings.
2. If static fallback assets are also desired:
   ```bash
   npm run build:site
   ```
3. Deploy the worker or static bundle. The hosted site reads the latest published Player Intel snapshot by default, or the separately published Omniscient snapshot when `mode=omniscient` is explicitly selected. It never receives raw save files or the service-role key.
