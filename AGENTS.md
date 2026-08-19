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
- In local/dev mode, the header's **Publish Latest Save** button invokes the same publisher as `push_latest_to_supabase.ps1`, then reloads the local dashboard from disk. It is shown only after `/api/runtime` confirms a local/dev runtime.
- The hosted worker reports `canPublish: false`, so the publish control stays hidden on the public site; publishing always remains a local action using the local-only service role key.

### 2. Publishing to Hosted Supabase
To publish the newest save to Supabase so that the deployed ChatGPT Site / Worker can read the latest published intelligence data:

The hosted site serves Player Intel by default and also serves the explicitly
published Enhanced and Omniscient modes when requested. The three modes are
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

The publisher keeps the newest three saves as full-fidelity rows by default.
After the compact strategic-history row is stored successfully, it prunes older
full snapshot rows while retaining their reduced history records. Override the
full-save window with `SUPABASE_FULL_SNAPSHOT_RETENTION` or the Node option
`--full-snapshot-retention <count>`. Publishing an explicitly older historical
save never prunes newer saves.

**Publish an explicit historical save:**
```powershell
.\push_latest_to_supabase.ps1 -Save "F:\Documents\My Games\TerraInvicta\Saves\initiative.gz"
```

### 2a. Hosted analysis endpoints

The hosted worker exposes focused, shallow JSON endpoints for external analysis
tools. They default to Player Intel; add `mode=omniscient` for the intentionally
published Omniscient view. `observer=4712` is the Initiative observer.

The machine-readable discovery index is available at `/api/intel` and is linked
from the v2 dashboard. It lists every focused endpoint without filters so an
external analysis client can discover the route surface before adding query
parameters.

```text
/api/intel/summary?observer=4712&mode=omniscient
/api/intel/factions?observer=4712&mode=omniscient
/api/intel/nations?observer=4712&mode=omniscient&faction=4712
/api/intel/councilors?observer=4712&mode=omniscient&faction=4712
/api/intel/habs?observer=4712&mode=omniscient&faction=4717
/api/intel/hab-sites?observer=4712&mode=omniscient&faction=4717
/api/intel/mining?observer=4712&mode=omniscient&body=Ceres&sort=water
/api/intel/fleets?observer=4712&mode=omniscient&faction=4717
/api/intel/ships?observer=4712&mode=omniscient&faction=4717
/api/intel/resources?observer=4712&mode=omniscient&faction=4712
/api/intel/hab-modules?observer=4712&mode=omniscient&faction=4712
/api/intel/shipyards?observer=4712&mode=omniscient&faction=4712
/api/intel/shipyard-queues?observer=4712&mode=omniscient&faction=4712
/api/intel/arrivals?observer=4712&mode=omniscient
/api/intel/transfers?observer=4712&mode=omniscient&destination=Mars
/api/intel/research?observer=4712&mode=omniscient
/api/intel/capabilities?observer=4712&mode=omniscient
/api/intel/alien?observer=4712&mode=omniscient
/api/intel/logistics?observer=4712&mode=omniscient
/api/intel/construction?observer=4712&mode=omniscient
/api/intel/ship-designs?observer=4712&mode=omniscient&faction=4712
/api/intel/theaters?observer=4712&mode=omniscient
/api/intel/infrastructure?observer=4712&mode=omniscient&body=Mars
/api/intel/alien-threat?observer=4712&mode=omniscient
/api/intel/delta?observer=4712&mode=omniscient
/api/intel/mobility?observer=4712&fleet=<fleetId>
/api/intel/production-plan?observer=4712&mode=omniscient&design=playerShipTemplate584&quantity=4 (or POST)
/api/intel/body-status?body=Mars&observer=4712&mode=omniscient
```

**Tech Tree Intelligence endpoints** expose the observer faction's research state
as a normalized dependency graph parsed from the game templates and overlaid
with the current save's completion/progress. They answer path, search, milestone
and queue questions against the live save. Enemy project state respects the
selected mode (`player` = only legitimately known; `omniscient` = full).

```text
/api/intel/tech-tree?observer=4712&mode=omniscient&category=weapons&includeEffects=true
/api/intel/tech-path?observer=4712&mode=omniscient&target=Project_RailCannonMk3
/api/intel/tech-path?observer=4712&mode=omniscient&target=Battlecruiser,Project_RailCannonMk3
/api/intel/tech-search?observer=4712&mode=omniscient&q=battlecruiser
/api/intel/tech-milestones?observer=4712&mode=omniscient&category=ship_hull
/api/intel/tech-matrix?observer=4712&mode=omniscient
/api/intel/tech-opportunities?observer=4712&mode=omniscient
/api/intel/research-queue?observer=4712&mode=omniscient
```

- `tech-tree` `category` accepts `all|weapons|drives|ships|habs|intel|economy|xenology|computing|materials|energy|social|military|space|life|information|general`.
- `tech-path` `target` accepts one or more comma-separated internal IDs or search
  names and deduplicates shared prerequisites; remaining cost accounts for current progress.
- `tech-search` `q` matches display names, internal IDs, unlock names, and effect IDs.
- `tech-milestones` `category` filters unlock classes
  (`ship_hull|weapon|missile|point_defense|drive|reactor|battery|radiator|armor|utility|hab_module|mine|shipyard|intel_capability`).
- These endpoints require a snapshot published with the `techTree` payload
  (re-publish after upgrading); otherwise they return a 503 guidance error.

Each resource response includes save metadata, `intelMode`, `visibility`, a
`count`, and a focused `items` array (or focused top-level summary fields).
Resource endpoints also accept `faction` / `factionId` and `body` filters.
Every data response also includes `snapshotId`, `saveFilename`,
`saveModifiedAt`, `campaignDate`, and `isLatestSnapshot`. Hosted responses are
read against the active campaign pointer with no cache so focused endpoints
cannot silently mix saves; a pointer/row mismatch returns a visible 409 error.

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
> - This campaign intentionally publishes Player Intel, Enhanced, and Omniscient snapshots because the user requested the game-state details to be available on the hosted site.

### 4. Deploying the Hosted Site
After running the publisher:
1. Ensure your hosted deployment (Cloudflare Worker / Vercel) has `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_CAMPAIGN_KEY` configured in its environment settings.
2. If static fallback assets are also desired:
   ```bash
   npm run build:site
   ```
3. Deploy the worker or static bundle. The hosted site reads the latest published Player Intel snapshot by default, or the separately published Omniscient snapshot when `mode=omniscient` is explicitly selected. It never receives raw save files or the service-role key.
