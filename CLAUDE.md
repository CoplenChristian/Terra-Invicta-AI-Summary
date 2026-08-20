# Terra Invicta Intel — working notes

## The frontend is `/v2/`, not the root

`public/index.html` is the **legacy v1 dashboard**. `public/v2/index.html` is the live one and the only place current work renders.

This matters because `preview_start` and a bare `node server/index.js` open the site root, so a browser check that lands on `/` shows the old UI and none of the current features — easy to misread as "the change didn't land".

- Browser: `http://localhost:<port>/v2/`
- Directive board mounts at element id `directiveBoard`
- Briefing API: `/api/v2/briefing?mode=player&observer=4712`
- Snapshot API: `/api/snapshot?mode=omniscient&observer=4712`

Observer faction is `4712` (the Initiative); the aliens are `4717`.

## Always check player mode

`server/index.js` sets `defaultMode: 'player'`. Player mode redacts the save's true alien hate and masks enemy councilor attributes, so it is a genuinely different code path — not a cosmetic filter.

**A feature verified only in omniscient mode is not verified.** Two shipped defects came from exactly this:

- The Total War veto was inert in player mode because `actualAlienHate` is null there, so `totalWarHeadroom` was null and the check fell through to `false`. At hate 168 omniscient held and player mode green-lit the offensive.
- The council candidate axis vanished entirely in player mode because observed enemies carry `maskedAttributes` rather than `attributes`, so every target filtered out.

Check both modes, every time.

## Absent stays null

`Number(null) === 0` and `Number('') === 0`, so guard on presence before coercing. Rendering an unmeasured value as a confident zero is the most repeated bug class in this repo's history — it has been fixed in `toFiniteNumber`, in the snapshot reducer, in `countShips`, and in the odds model.

Related: a check that cannot be evaluated must report `unknown`, never fall through to "safe". And never fabricate data for a UI fallback — an honest "unavailable" state beats mock content that looks real.

## The save uses `ID`, not `id`

Save-derived objects carry **`ID`** (capital) and `displayName`. They do **not** have `id` or `name`. Verified nation keys: `ID, displayName, templateName, GDP, population, boost, research, milTech, democracy, cohesion, unrest, nukes, armies, missionControl, controlPoints, executiveFactionId, executiveFactionName, regionsCount`.

Writing `obj.id || obj.name` therefore yields `undefined`, and inside a template literal it becomes the **string** `"undefined"` — which silently collides instead of throwing. When that string is a dedupe key, every record after the first is dropped.

This has now happened twice:

- `server/engine/assignment.js` — the allocator keyed on `councilor.id`, so the first assignment poisoned the dedupe `Set` and `has(undefined)` dropped five of six councilors.
- `server/engine/candidates/missions.js` — every candidate id collapsed to `advise-nation-undefined` / `purge-undefined-0`. Only **1 of 303** candidates survived. The user-visible result was the engine recommending a councilor abandon a −25.8 research/turn Advise post, because "keep advising the USA" did not exist as a candidate.

Check the real object shape before choosing a field name, and never let an unresolvable identity become a string — drop the record with a recorded reason instead.

## Sources

Game mechanics are verified against the installed templates at
`F:/SteamLibrary/steamapps/common/Terra Invicta/TerraInvicta_Data/StreamingAssets/Templates`
or the official wiki read as **raw wikitext** (spoiler content only exists there — `{{SpoilerBox}}` never expands in the DOM).

1.0 shipped 2026-01-05. Claims need a dated citation, and anything that is a judgement call should say so rather than being presented as measured.

## Line endings

`core.autocrlf=true` with no `.gitignore` normalisation. Multi-line string replacement via `sed` or Node scripts silently fails to match — use the editing tools instead.

## Design docs

- `docs/directive-rule-engine-plan.md` — v1 engine
- `docs/directive-engine-v2.md` — v2 design (what and why)
- `docs/directive-engine-v2-plan.md` — v2 implementation plan (how and in what order)

---

# Operations

_Merged from AGENTS.md on 2026-08-20. AGENTS.md now points here; this file is canonical._

## Save parsing & intelligence queries

Use the universal save parser rather than generating throwaway `node -e` scripts or separate legacy parsers. It is available as a Node CLI, programmatic library, and PowerShell wrapper.

### CLI Usage (`scripts/parse_save.js` or `npm run parse`)
```bash
# Parse latest save (default observer: the Initiative / 4712, default mode: player)
npm run parse -- --latest

# Query any intel endpoint as JSON
npm run parse -- --latest --endpoint summary --format json
npm run parse -- --latest --endpoint mining --format json
npm run parse -- --latest --endpoint alien-threat --mode omniscient --format json
npm run parse -- --latest --endpoint councilors --format table

# Extract specific nested fields
npm run parse -- --latest --field metadata.gameTimeString
npm run parse -- --latest --endpoint mining-expansion --field capacity

# Specific save file
npm run parse -- --save Again.gz --endpoint habs
```

### PowerShell Wrapper (`parse_save.ps1`)
```powershell
.\parse_save.ps1 -Latest -Endpoint summary
.\parse_save.ps1 -Latest -Endpoint mining -Format Json
.\parse_save.ps1 -Save Again.gz -Endpoint alien-threat -Mode omniscient
```

### Programmatic Node API (`server/snapshotLoader.js`)
```javascript
const { loadSnapshot, loadFilteredSnapshot, queryIntel } = require('./server/snapshotLoader');

// Raw snapshot with attached identity and previous-save comparison
const rawSnapshot = loadSnapshot({ latest: true });

// Filtered snapshot for an observer and visibility mode
const playerSnapshot = loadFilteredSnapshot({ mode: 'player', observer: 4712 });

// Execute any intel endpoint projection
const miningIntel = queryIntel({ endpoint: 'mining', mode: 'player' });
```

### Save selection rule

When searching, summarizing, or assessing save data, always use the most recently modified save in the configured save folder (`--latest` / `-Latest`). Do not hard-code `initiative.gz`, `Again.gz`, or another filename unless the user explicitly requests that save.

If the newest save is locked or incomplete because the game is writing it, the loader detects the fingerprint mismatch and reports a 503 error. Retry after the save finishes rather than falling back to stale data.

### Legacy PowerShell parsers
The legacy scripts (`parse_alien_councilor_locations.ps1`, `parse_alien_hate.ps1`, `parse_faction_councilors.ps1`, `parse_faction_nations.ps1`, `parse_faction_space_assets.ps1`) remain functional for backward compatibility, but new agent work and automation should use `scripts/parse_save.js` / `server/snapshotLoader.js`.

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
`--full-snapshot-retention <count>`. Use `--inline-tech-tree` to embed the static
graph in every row, or `--omit-tech-tree` to publish a reduced row with an
explicit unavailable marker; these options are mutually exclusive. Publishing
an explicitly older historical save never prunes newer saves. Full rows share
the tech tree by default so the hosted technology endpoints remain available.

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
