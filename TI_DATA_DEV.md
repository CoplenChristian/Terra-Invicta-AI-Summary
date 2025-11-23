# Terra Invicta Data Tools – Developer Notes

This file documents how the Terra Invicta data toolbox is structured, which files each function depends on, and how the pieces are intended to fit together. It’s meant for **developers modifying `ti_data_tools.ps1` or related scripts**, not for day‑to‑day use when writing summaries.

If this conversation context is gone, this file plus `TI_DATA_TOOLS.md` and `ti_data_tools.ps1` should give you enough to reason about and extend the tooling safely.

---

## 0. High-Level Design

### Goals

- Provide a set of **pure data helpers** that read pre‑exported CSVs (`Again_*.csv`) and emit:
  - PowerShell objects (for further processing).
  - Tables (for human inspection).
  - Markdown snippets (for inclusion in `summary_YYYYMMDD.md`).
- Avoid side effects: no editing CSVs, no writing new files (except dedicated scripts like `summarize_boost_income.ps1`).
- Hide paths / filenames behind a small **configuration & caching layer** so individual functions are simple.

### Main entry points

- `Terra-Invicta-AI-Summary/ti_data_tools.ps1` — toolbox functions.
- `Terra-Invicta-AI-Summary/TI_DATA_TOOLS.md` — user‑facing usage guide.
- `Terra-Invicta-AI-Summary/TI_DATA_DEV.md` — this file (developer internals).
- `Terra-Invicta-AI-Summary/summarize_boost_income.ps1` — standalone Boost income helper.
- `Terra-Invicta-AI-Summary/Again_Save/summary.md` — template summary pointing at the toolbox and docs.

---

## 1. Configuration & Path Resolution

Located near the top of `ti_data_tools.ps1` (now config-driven):

```powershell
# Load configuration
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $scriptPath "config.json"
if (-not (Test-Path $configPath)) {
    throw "Config file not found at $configPath"
}
$config = Get-Content $configPath -Raw | ConvertFrom-Json

$WorkDir = $config.WorkDir
if ($WorkDir -eq ".") { $WorkDir = $scriptPath }

$script:TIConfig = [ordered]@{
    RootPath        = $WorkDir

    # Default export folder for latest CSVs
    ExportFolder    = $config.CsvSubDir
    BoostHelperPath = "summarize_boost_income.ps1"
}
```

`config.json` in the repo root is therefore the single source of truth for:

- The campaign **root path** (`WorkDir` → `TIConfig.RootPath`).
- The **CSV export subfolder** (`CsvSubDir` → `TIConfig.ExportFolder`).

**Functions:**

- `Set-TIDataConfig`
  - Parameters: `-RootPath`, `-ExportFolder`.
  - Updates `$script:TIConfig.RootPath` and/or `.ExportFolder`.
  - Use this if you move the campaign folder or want to analyze a different save set.

- `Get-TIDataPath`
  - Input: `-RelativePath`.
  - Returns: `<RootPath>\<RelativePath>`.
  - Used to resolve things like `Again_Save`, `summarize_boost_income.ps1`, and `TI_DATA_TOOLS.md` if needed.

- `Get-TIExportPath`
  - Input: `-FileName`.
  - Returns: `<RootPath>\<ExportFolder>\<FileName>`.
  - Used by CSV loaders to avoid hardcoding the `Again_Save` path.

**Developer notes:**

- If you ever rename the CSV export folder (default from `config.json`’s `CsvSubDir`), update only `config.json`; `TIConfig` will pick it up automatically.
- Don’t embed absolute paths in individual functions; always go through `Get-TIExportPath` for CSVs and `Get-TIDataPath` for other files so the config stays authoritative.

---

## 2. CSV Cache (`$script:TIData`) and Loaders

### Cache initialization

In `ti_data_tools.ps1` (simplified):

```powershell
if (-not (Get-Variable -Name TIData -Scope Script -ErrorAction SilentlyContinue)) {
    $script:TIData = @{}
}
```

- Ensures the cache exists once under StrictMode.

### Resetting the cache

```powershell
function Reset-TIDataCache {
    $script:TIData = @{}
}
```

- Used after re‑running `export_factions.ps1` or between snapshots.
- Developers should call this in any test scripts if they suspect stale data.

### Generic CSV loader

```powershell
function Get-TICsv {
    param(
        [Parameter(Mandatory)] [string]$Name,
        [Parameter(Mandatory)] [string]$FileName
    )

    if ($script:TIData.ContainsKey($Name)) {
        return $script:TIData[$Name]
    }

    $path = Get-TIExportPath -FileName $FileName
    if (-not (Test-Path $path)) {
        throw "CSV not found: $path (Name=$Name)"
    }

    $data = Import-Csv -Path $path
    $script:TIData[$Name] = $data
    return $data
}
```

**Behavior:**

- First call for a logical `$Name` imports and caches CSV.
- Subsequent calls return cached data.

### Convenience loaders and their CSVs

These wrap `Get-TICsv` and define the mapping to specific files:

- `Get-TIFactionsCore()` → `Again_Factions_Core.csv`
  - Fields: faction template, displayName, `FactionID`, `Money`, `Influence`, `Operations`, `Boost`.

- `Get-TIFactionEarthSummary()` → `Again_Faction_EarthSummary.csv`
  - Fields: `FactionID`, `FactionTemplate`, `FactionName`, `TotalCPs`, `TotalGDP`, `TotalPopulation`.
  - Created by the exporter to aggregate nation control per faction.

- `Get-TIFactionHabIncome()` → `Again_Faction_HabIncome.csv`
  - Fields: `FactionID`, `FactionTemplate`, `FactionName`, `SiteCount`, `WaterPerDay`, `VolatilesPerDay`, `MetalsPerDay`, `NoblesPerDay`, `FissilesPerDay`.
  - Created by the exporter to aggregate hab‑site resources per faction.

- `Get-TIFactionHabMiningIncome()` → `Again_Faction_HabMiningIncome.csv` (if present)
  - Same idea as `Get-TIFactionHabIncome`, but restricted to mining‑only hab income.

- `Get-TIResistanceNations()` → `Again_Resistance_Nations.csv`
  - Per Control Point row:
    - Nation info: `NationID`, `NationName`, `GDP`, `MilTech`, `Democracy`, `Cohesion`, `Unrest`, `Knowledge`, `Inequality`, `ClimatePolicy`, `CP_ID`.
    - Boost fields added by exporter:
      - `BoostHistoryLatest` (last entry from the nation’s `historyBoost` array).
      - `BoostPerCP` (`BoostHistoryLatest / numControlPoints_unclamped`).

- `Get-TIResistanceCouncilors()` → `Again_Resistance_Councilors.csv`
  - Fields: `ID`, `displayName`, `templateName`, `typeTemplateName`, base stats (`Persuasion`, `Investigation`, `Espionage`, `Command`, `Administration`, `Science`, `Security`, `Loyalty`), **org-enhanced stats** (`EffectivePersuasion`, `EffectiveInvestigation`, `EffectiveEspionage`, `EffectiveCommand`, `EffectiveAdministration`, `EffectiveScience`, `EffectiveSecurity`, `EffectiveLoyalty`), `OrgNames`, `status`, `homeRegion`, `locationRegionName`.

- `Get-TICouncilorRecruits()` → `Again_Councilor_Recruits.csv`
  - Fields: `ID`, `displayName`, `personalName`, `familyName`, `typeTemplateName`, `HomeRegionID`, stats, `status`.
  - Filtered by the exporter to capture unassigned active councilors.

- `Get-TIHabSites()` → `Again_HabSites.csv`
  - Fields: `SiteID`, `templateName`, `displayName`, `ParentBodyID`, `ParentBodyName`, coordinate fields, per‑day resources, `HasHab`, `HabID`, `HabType`, `HabSchematicTemplateName`, `IsShipyard`, `HabLevel`, `MCCost`, `FactionID`, `FactionName`, `pendingHab`.

- `Get-TIAliensHabs()` → `Again_Aliens_Habs.csv`
  - Fields: `HabID`, `displayName`, `templateName`, `habType`, `tier`, `inEarthLEO`, `staticHab`, `underBombardment`, `inCombat`, `OrbitStateID`, `BarycenterID`.

- `Get-TIHabsAll()` → `Again_Habs_All.csv`
  - Fields: `HabID`, `HabName`, `HabType`, `HabSchematicTemplateName`, `FactionID`, `FactionName`, `InEarthLEO`, `StaticHab`, `HasHabSite`, `HabSiteID`, `OrbitBodyName`, `HabLevel`, `MCCost`.

- `Get-TIFactionHabs(<ShortName>)` → `Again_<ShortName>_Habs.csv`
  - One row per hab for that faction (Base/Station), same columns as `Again_Habs_All.csv`.

- `Get-TISpaceBodies()` → `Again_SpaceBodies.csv`
  - Fields: `BodyID`, `templateName`, `displayName`, `maxHabTier`, `HabSiteIDs`, `OrbitIDs`, `BarycenterID`.

- `Get-TIFactionProjects(<ShortName>)` → `Again_<ShortName>_Projects.csv`
  - One row per tech or faction project relevant to that faction.
  - Fields: `TechTemplateName`, `Status`, `AccumulatedResearch`, `IsSelector`, `Source`.

- `Get-TIResistanceProjects()` → `Again_Resistance_Projects.csv`
  - Backwards‑compatible loader for the Resistance‑only projects CSV (same schema as above).

**Developer notes:**

- When adding new exports, prefer to create a **new loader function** like `Get-TI<Something>()` that wraps `Get-TICsv` rather than calling `Get-TICsv` directly throughout the code.
- If you change exporter CSV schemas, update these convenience loaders and the downstream functions that assume particular columns.

---

## 4. Markdown Table Helper

`Convert-TIToMarkdownTable` is the central formatter for Markdown outputs:

```powershell
function Convert-TIToMarkdownTable {
    param(
        [Parameter(Mandatory)] [object[]]$Rows,
        [string[]]$PropertyOrder
    )

    if (-not $Rows -or $Rows.Count -eq 0) {
        return "# (no data)`n"
    }

    if (-not $PropertyOrder) {
        $PropertyOrder = $Rows[0].PSObject.Properties.Name
    }

    $header = "| " + ($PropertyOrder -join " | ") + " |"

    $dashCells = @()
    foreach ($ignored in $PropertyOrder) {
        $dashCells += "---"
    }
    $divider = "| " + ($dashCells -join " | ") + " |"

    $lines = @($header, $divider)

    foreach ($row in $Rows) {
        $cells = foreach ($p in $PropertyOrder) {
            $val = $row.$p
            if ($null -eq $val) { "" } else { $val.ToString() }
        }
        $lines += ("| " + ($cells -join " | ") + " |")
    }

    return ($lines -join [Environment]::NewLine)
}
```

**Developer notes:**

- `PropertyOrder` should be explicitly passed in most call sites to control column order.
- This function assumes **flat objects** (no nested arrays); if you need nested data, pre‑flatten into strings before passing rows here.

---

## 5. Function Reference (Developer View)

This section mirrors function names with their inputs, outputs, and how we use them in the summaries.

### 5.1 `Get-TIFactionOverview`

**References:**

- `Get-TIFactionsCore()` → `Again_Factions_Core.csv`
- `Get-TIFactionEarthSummary()` → `Again_Faction_EarthSummary.csv`
- `Get-TIFactionHabIncome()` → `Again_Faction_HabIncome.csv`

**Core logic:**

- For each row in `Again_Factions_Core.csv`:
  - Extract `FactionID` and core resources.
  - Lookup matching row in Earth summary (`TotalCPs`, `TotalGDP`, `TotalPopulation`).
  - Lookup matching row in hab income (`SiteCount`, resource per day fields).
  - Build a `[PSCustomObject]` combining all of the above.

**Output schema:**

```text
FactionName, TemplateName, FactionID,
TotalCPs, TotalGDP, TotalPopulation,
Money, Influence, Operations, BoostStockpile,
HabSiteCount, WaterPerDay, VolatilesPerDay, MetalsPerDay, NoblesPerDay, FissilesPerDay
```

**Usage:**

- Data backbone for:
  - Faction Power Table (Current Save).
  - Global Faction Landscape.

### 5.2 `Get-TIFactionBoostAndSpaceSummary`

**References:**

- Calls `Get-TIFactionOverview -Format Json | ConvertFrom-Json` → reuses `Get-TIFactionOverview` output.
- Reads each `Again_<Faction>_Nations.csv` directly via `Import-Csv` for Boost:
  - `Again_Resistance_Nations.csv`
  - `Again_HumanityFirst_Nations.csv`
  - `Again_Initiative_Nations.csv`
  - `Again_Servants_Nations.csv`
  - `Again_Protectorate_Nations.csv`
  - `Again_Academy_Nations.csv`
  - `Again_Exodus_Nations.csv`

**Core logic:**

- Build a dictionary `$boostByFaction` where:
  - Key is an inferred label from filename (`Resistance`, `HumanityFirst`, etc.).
  - Value is sum of numeric `BoostPerCP` for that faction’s nations.
- For each overview row:
  - Derive a key from `FactionName` (stripping leading `"the "`).
  - Attach `BoostIncomeEstimate` from `$boostByFaction` if present.

**Usage:**

- Extended resource table to talk about **stockpiled** vs **approximate income** for Boost.

**Developer notes:**

- If you change how you infer the label (e.g., displayName vs file name), update the mapping logic consistently.
- This function intentionally does not cache the nation Boost sums; if performance becomes a concern, you can introduce caching keyed by export timestamp.

### 5.3 `Get-TIResistanceNationsSnapshot`

**References:**

- `Get-TIResistanceNations()` → `Again_Resistance_Nations.csv`

**Core logic:**

- `Group-Object NationName` aggregates all CP rows per nation.
- For each group:
  - `CPs` = group count.
  - `GDP/MilTech/Democracy/...` = from first row (identical across CPs).
  - `BoostPerCP` = cast from `BoostPerCP` in that representative row, or 0 if missing.
  - `BoostTotalEst` = `BoostPerCP * CPs`.

**Usage:**

- Feeds “Current Nation Control (Resistance)” table and informs Earth-side planning.

**Developer notes:**

- Assumes per‑nation stats are identical per CP row; if exporter changes to per‑CP variation, this grouping may need adjustment.

### 5.4 `Get-TIResistanceCouncilorSummary`

**References:**

- `Get-TIResistanceCouncilors()` → `Again_Resistance_Councilors.csv`
- `Get-TICouncilorRecruits()` → `Again_Councilor_Recruits.csv`

**Core logic:**

- `Roster`:
  - Loads `Again_Resistance_Councilors.csv` via `Get-TIResistanceCouncilors()` and projects:
    - `displayName`, `typeTemplateName`.
    - Base stats: `Persuasion`, `Investigation`, `Espionage`, `Command`, `Administration`, `Science`, `Security`, `Loyalty`.
    - Effective stats: `EffectivePersuasion`, `EffectiveInvestigation`, `EffectiveEspionage`, `EffectiveCommand`, `EffectiveAdministration`, `EffectiveScience`, `EffectiveSecurity`, `EffectiveLoyalty`.
    - `OrgNames` (semicolon-separated list of org display names from the exporter).
- `Recruits`:
  - Filters `status` to `Active` or `$null`.
  - Produces three rank‑ordered lists:
    - `TopByAdmin`
    - `TopByPers`
    - `TopByEspionage`
  - Sorting uses `Sort-Object -Property @{ Expression = { [int]$_.<Stat> }; Descending = $true }, displayName`.

**Usage:**

- Provides both the roster table and curated recruit lists for council sections.

**Developer notes:**

- If stats move or naming changes in the CSV, adjust the property names here (including the `Effective*` columns and `OrgNames`).
- If you want to add more “top N” categories (e.g., by Command or Science), copy the pattern used for Admin/Pers/Esp.

### 5.5 `Get-TISpaceSitrep`

**References:**

- `Get-TIFactionHabIncome()` → `Again_Faction_HabIncome.csv`
- `Get-TIHabSites()` → `Again_HabSites.csv`

**Core logic:**

- `incomeRows`:
  - Projection of hab income CSV to `FactionName`, `SiteCount`, and resource per day.
- `Get-TopSitesForBody` (inner function):
  - Filters `Again_HabSites.csv` by `ParentBodyName` and `HasHab -eq "False"`.
  - Sorts by `FissilesPerDay` then `MetalsPerDay`.
  - Selects top N sites.
- `topLuna` and `topMars` use that helper for `"Luna"` and `"Mars"`.

**Usage:**

- Space hab income snapshot and recommended high‑value sites for Luna/Mars.

**Developer notes:**

- If `HasHab` becomes a boolean instead of `"True"/"False"` string, adjust the filter to test `$_.HasHab -eq $false`.
- The ranking heuristic (fissiles then metals) is arbitrary; you can change to something like `MetalsPerDay + FissilesPerDay` if needed.

### 5.6 `Get-TISpaceAtlas`

**References:**

- `Get-TISpaceBodies()` → `Again_SpaceBodies.csv`
- `Get-TIHabSites()` → `Again_HabSites.csv`

**Core logic:**

- Builds a `BodyID` → body row dictionary from `Again_SpaceBodies.csv`.
- Iterates all rows in `Again_HabSites.csv` and for each site:
  - Looks up the parent body by `ParentBodyID` (falls back to `ParentBodyName` if missing).
  - Emits a flattened object with body fields (`BodyName`, `BodyType`, `MaxHabTier`) plus site fields:
    - `SiteName`, `TemplateName`, `HasHab`, `HabID`, `FactionName`.
    - Per‑site yields (`WaterPerDay`, `VolatilesPerDay`, `MetalsPerDay`, `NoblesPerDay`, `FissilesPerDay`).
- Sorts by `BodyName` then `SiteName` for stable Markdown/Table output.

**Usage:**

- Full “space atlas” view for strategic planning and AI context.
- Use this when you need **all sites on all bodies**, not just top N Luna/Mars picks.

**Developer notes:**

- If `Again_SpaceBodies.csv` schema evolves (e.g., different body type field names), update the property mapping:
  - `bodyType`, `maxHabTier`, etc.
- If you add more useful per‑site columns to `Again_HabSites.csv`, consider exposing them in `Get-TISpaceAtlas`.

### 5.7 `Get-TIFactionHabSites`

**References:**

- `Get-TIHabSites()` → `Again_HabSites.csv`
- `Get-TIHabsAll()` → `Again_Habs_All.csv`

**Core logic:**

- For the requested `-FactionName` (default `"the Resistance"`):
  - Filters `Again_HabSites.csv` to rows with `HasHab=True` and matching `FactionName`.
  - Reads `Again_Habs_All.csv` and picks habs with that `FactionName` where `HasHabSite` is false or `HabSiteID` is null (orbit-only stations).
- Projects both into a unified hab view with:
  - `ParentBodyName` (or `"(orbit)"` for non-site habs), `HabName`, `HabType`, `HabSchematicTemplateName`, `IsShipyard`.
  - Per-site yields for habs backed by resource sites.
- Sorts by `ParentBodyName` then `HabName`.

**Usage:**

- Per‑faction hab overview (mines + stations) for summaries and planning.
- Use this when you want a **single faction’s** complete hab and station footprint.

**Developer notes:**

- Relies on extra columns added by `export_factions.ps1`:
  - `Again_HabSites.csv`: `HabType`, `HabSchematicTemplateName`, `IsShipyard`.
  - `Again_Habs_All.csv`: `HasHabSite`, `HabSiteID` for detecting orbit-only habs.

### 5.8 `Get-TIOrbitHabs`

**References:**

- `Get-TIHabsAll()` → `Again_Habs_All.csv`

**Core logic:**

- Starts from `Again_Habs_All.csv` (one row per `TIHabState`).
- Optional filters:
  - `-OnlyStations` → `HabType -eq "Station"`.
  - `-OnlyEarthLEO` → `InEarthLEO -eq "True"`.
- Sorts by `FactionName`, `HabType`, `HabName`.
- Emits hab type, schematic template, orbit flags, and linkage to any associated hab site.

**Usage:**

- Orbit/station overview, especially LEO stations per faction.
- Use together with `Get-TIFactionHabSites` or `Get-TISpaceAtlas` for deeper analysis.

**Developer notes:**

- If `Again_Habs_All.csv` schema expands, keep columns here in sync.

### 5.9 `Get-TIFactionHabsOverview`

**References:**

- `Get-TIHabsAll()` → `Again_Habs_All.csv`
- `Get-TIHabSites()` → `Again_HabSites.csv`

**Core logic:**

- Loads all habs from `Again_Habs_All.csv` and builds a `HabID` → site lookup from `Again_HabSites.csv`.
- For each hab:
  - If it has a backing site, takes `ParentBodyName` from the site as `Body`.
  - Otherwise:
    - `Body = "Earth (LEO)"` if `InEarthLEO` is true.
    - `Body = "<OrbitBodyName> (orbit)"` if `OrbitBodyName` is available.
    - `Body = "(orbit)"` as a fallback.
- Computes `IsShipyard` as:
  - Site-backed: `IsShipyard` from the site row.
  - Orbit-only: `HabSchematicTemplateName -eq "ShipbuildingHabSchematic"`.
- Emits a flattened object with:
  - `FactionName`, `Body`, `HabName`, `HabType`, `HabLevel`, `MCCost`, `IsShipyard`, `InEarthLEO`, `HasHabSite`, `HabSiteID`.
- Sorts by `FactionName`, then `Body`, then `HabName`.

**Usage:**

- Global hab overview for planning and summaries:
  - Who has which habs where, and at what MC cost.
  - Quick way to compare shipyards and core levels across factions.

**Developer notes:**

- Keep this in sync with any schema changes to `Again_Habs_All.csv` or `Again_HabSites.csv`.

### 5.10 `Get-TIResistanceResearchSummary`

**References:**

- `Get-TIResistanceProjects()` → `Again_Resistance_Projects.csv`

**Core logic:**

- Loads `Again_Resistance_Projects.csv` and splits into:
  - `GlobalFinished` where `Status = "GlobalFinished"` (global techs completed by any faction).
  - `FactionFinished` where `Status = "FactionFinished"` (Resistance‑specific faction projects, `Project_*`).
  - `GlobalInProgress` where `Status = "GlobalInProgress"`.
- Markdown mode:
  - Renders finished global tech names in a simple table.
  - Renders finished faction projects in a separate table.
  - Renders in‑progress global techs ordered by `AccumulatedResearch` (descending) with columns:
    - `TechTemplateName`, `AccumulatedResearch`, `IsSelector`.

**Usage:**

- Quick research snapshot for the Resistance, especially for:
  - Tech/priorities sections in summaries (Sections 2, 9, 10).
  - “Biggest changes” where new finished techs since last snapshot matter.

**Developer notes:**

- Currently derived from the global tech tree (`Again_Techs_Global.csv` + selector info) via `export_factions.ps1`.
  - If the tech export schema changes, keep `Again_Resistance_Projects.csv` and this function in sync.

### 5.11 `Test-TIExportContext`

**References:**

- Uses `Get-TIDataPath` and `Get-TIExportPath` to check existence of CSVs and scripts.
- Calls `Get-TIFactionOverview -Format Table`.

**Core logic:**

- Defines a list of required CSV filenames and optional script paths.
- Uses `Test-Path` to print `[OK]` or `[MISS]` status.

**Usage:**

- Sanity check prior to heavy analysis.

**Developer notes:**

- If you add new critical exports (e.g., new global export CSVs), append them to `$requiredFiles` here.

  ### 5.12 `Invoke-TIDataMenu`

**References:**

- Calls:
  - `Get-TIFactionOverview`
  - `Get-TIResistanceNationsSnapshot`
  - `Get-TIResistanceCouncilorSummary`
  - `Get-TISpaceSitrep`
  - `Get-TIFactionBoostAndSpaceSummary`
  - `Test-TIExportContext`
  - `Get-TISnippetPackMarkdown`

**Core logic:**

- Builds an array of `{ Id, Label, Action }` objects.
- Reads a choice with `Read-Host` and invokes the corresponding script block.

**Usage:**

- Simple interactive layer; no data logic of its own.

**Developer notes:**

- Keep actions **read‑only** (no writes to disk) to avoid surprises from the menu.

### 5.13 `Get-TIFactionTechMatrix`

**References:**

- `Get-TIFactionProjects(<ShortName>)` → `Again_<ShortName>_Projects.csv` for:
  - Resistance, HumanityFirst, Initiative, Servants, Protectorate, Academy, Exodus, Aliens.

**Core logic:**

- Builds a canonical `$factions` array (Template + Short name) matching `export_factions.ps1`.
- For each faction short name:
  - Loads `Again_<ShortName>_Projects.csv` (or treats as empty if missing).
  - Adds every `TechTemplateName` into a `HashSet[string]` of all techs seen.
- Defines `"finished"` statuses as:
  - `GlobalFinished` (global tech completed).
  - `FactionFinished` (faction‑specific completed project).
- For each tech in the set of all techs:
  - Builds a row with `TechTemplateName` and one boolean column per faction short name.
  - A column is `True` if any row in that faction’s CSV has the same `TechTemplateName` and a finished status.

**Usage:**

- Produces a **True/False tech completion matrix** per faction.
- Used by the snippet pack’s “Tech Completion Matrix (By Faction)” section for high‑level research comparison.

### 5.14 `Get-TIFactionTechCompletionRatio`

**References:**

- Calls `Get-TIFactionTechMatrix -Format Json | ConvertFrom-Json`.

**Core logic:**

- Defines the canonical faction short-name list: `Resistance, HumanityFirst, Initiative, Servants, Protectorate, Academy, Exodus, Aliens`.
- For each tech row in the matrix:
  - Increments a per‑faction counter when that cell is `True`.
- Divides each faction’s `True` count by the total number of tech rows to produce a `TechCompletionRatio` in `[0,1]`.

**Usage:**

- Handy diagnostic for “percent of techs completed” but no longer drives the power ranking (the Tech pillar now uses component-weighted scoring).

### 5.15 `TIComponentTechWeights` / `Get-TIComponentTechWeights`

**References:**

- Helper `Get-TIShipComponentJson` (loads JSON out of `Ship_Info/raw_json`).
- `$script:TIComponentWeightHintRules` (regex-based heuristics for weight hints).
- Manual extras for hab-only techs (Outpost/Settlement/Colony mining, Automated Mining).

**Core logic:**

- `Initialize-TIComponentTechWeights` builds the list on demand:
  - Iterates predefined sources (drives, power plants, kinetic/laser/plasma weapons, missiles, hulls, armor, radiators, batteries, heat sinks, utility modules).
  - Reads each JSON template, skipping entries with no `requiredProjectName`.
  - Determines a tier label via `TierProperty` when present (e.g., `driveClassification`, `powerPlantClass`, `consTier`).
  - Looks up weights from explicit tier maps (drives, reactors, hull construction tiers) or infers them via heuristics (Mk numbers, regex hints for “Alien/Antimatter/Fusion/Advanced”).
  - Keeps the highest weight when multiple components share the same `requiredProjectName`.
  - Appends manual rows for hab mining techs.
- `Get-TIComponentTechWeights` caches the result; `Reset-TIComponentTechWeights` clears it (called automatically by `Reset-TIDataCache`).

**Usage:**

- `Get-TIComponentTechWeights` is the canonical dictionary used by the component-scoring logic.
- Extend `Initialize-TIComponentTechWeights` (add another source entry or tweak regex hints) whenever new ship JSON shows up.
- Run `Get-TIComponentTechWeights | Sort-Object Component,Weight` to sanity-check the weights.

### 5.16 `Get-TIFactionComponentScore`

**References:**

- `Get-TIFactionProjects -FactionShortName <Short>` for Resistance, HumanityFirst, Initiative, Servants, Protectorate, Academy, Exodus, Aliens.
- `Get-TIComponentTechWeights` (auto-generated list described above).

**Core logic:**

- Aliens short-circuit: sum **all** weights and return (they always count as “fully unlocked”).
- For other factions:
  - Attempts to load `Again_<ShortName>_Projects.csv` via `Get-TIFactionProjects`. Missing CSVs are handled gracefully (score `0` with a verbose message).
  - Builds a `HashSet[string]` of `TechTemplateName` where `Status` is `GlobalFinished` or `FactionFinished`.
  - Iterates the weight dictionary and adds each `Weight` when the tech exists in the hash set.
- Returns the raw (unnormalized) component score.

**Usage:**

- Foundation for the Tech pillar inside `Get-TIFactionPowerScores`.
- Quick check to compare component unlock parity (`Get-TIFactionComponentScore -FactionShortName Servants`).

### 5.17 `Normalize`

**What it does**

- Small helper to normalize a numeric value to `[0,1]` given a column maximum:

  ```powershell
  function Normalize {
      param([double]$value,[double]$max)
      if ($max -le 0) { return 0 }
      $val = $value / $max
      if ($val -lt 0) { $val = 0 }
      if ($val -gt 1) { $val = 1 }
      return $val
  }
  ```

**Usage:**

- Used by `Get-TIFactionPowerScores` (Earth, Space, and Tech pillars) to normalize per-column values before weighting.

### 5.18 `Get-TIFactionPowerScores`

**What it does**

- Computes a composite **PowerScore** per faction from three weighted pillars:
  - **Earth (40%)** — CPs, GDP, population.
  - **Space (40%)** — hab count, per‑day Water/Metals/Fissiles, and combined stockpiles.
  - **Tech (20%)** — component-weighted tech unlock score (`Get-TIFactionComponentScore`, normalized).

**Core logic:**

- Loads `Get-TIFactionOverview -Format Json | ConvertFrom-Json`.
- Builds `$componentScores` for `Resistance, HumanityFirst, Initiative, Servants, Protectorate, Academy, Exodus, Aliens` using `Get-TIFactionComponentScore`, tracks `$maxComponentScore`.
- Derives column maxima for:
  - `TotalCPs`, `TotalGDP`, `TotalPopulation`.
  - `HabSiteCount`, `WaterPerDay`, `MetalsPerDay`, `FissilesPerDay`.
  - `WaterStockpile`, `VolatilesStockpile`, `MetalsStockpile`, `NobleMetalsStockpile`, `FissilesStockpile`, `ExoticsStockpile`.
- For each faction row, computes:
  - `EarthScore` = `Normalize(TotalCPs) * 0.25 + Normalize(TotalGDP) * 0.10 + Normalize(TotalPopulation) * 0.05`.
  - `SpaceScore` = `Normalize(HabSiteCount) * 0.10 + Normalize(WaterPerDay) * 0.05 + Normalize(MetalsPerDay) * 0.05 + Normalize(FissilesPerDay) * 0.05 + Normalize(WaterStockpile+VolatilesStockpile) * 0.05 + Normalize(MetalsStockpile+NobleMetalsStockpile) * 0.05 + Normalize(FissilesStockpile+ExoticsStockpile) * 0.05`.
  - `TechScore` = `Normalize(componentScore, maxComponentScore) * 0.20` (0 if the max is 0).
  - `PowerScore` = `EarthScore + SpaceScore + TechScore`.
- Returns a table (sorted by `PowerScore` descending) with:
  - `FactionName`, `FactionID`, `EarthScore`, `SpaceScore`, `TechScore`, `PowerScore` (all scaled to 0–100 and rounded to 1 decimal place).

**Usage:**

- Used by the snippet pack to emit a **Power Ranking (Weighted Earth/Space/Tech)** table with component-weighted Tech pillars, consumed directly in the `Faction Power Table (Current Save)` section of `summary.md`.

### 5.20 `Get-TIFactionShipSummary`

**References:**

- `Get-TIFactionShips()` → `Again_Faction_Ships.csv`

**Core logic:**

- Loads `Again_Faction_Ships.csv`.
- Groups by `FactionName`.
- Sums `CombatPower` (which is calculated in `export_factions.ps1` based on component weights).
- Computes `AvgPower`.
- Returns `FactionName`, `ShipCount`, `TotalPower`, `AvgPower`.

**Usage:**

- Provides the "Faction Ship Power" table in the snippet pack.

**Developer notes:**

- The scoring logic resides in `export_factions.ps1` (`Get-ShipComponentScores`). If you want to change how ships are scored (e.g. change weights for lasers vs drives), edit `export_factions.ps1`.

### 5.19 `Get-TISnippetPackMarkdown`

  **References:**

  - `Get-TIFactionOverview -Format Markdown`
  - `Get-TIFactionBoostAndSpaceSummary -Format Markdown`
  - `Get-TIResistanceNationsSnapshot -Format Markdown`
  - `Get-TIResistanceCouncilorSummary -Format Markdown`
  - `Get-TISpaceSitrep -Format Markdown`
  - `Get-TIFactionHabsOverview -Format Markdown` (global habs overview for all factions)
- `Get-TIResistanceResearchSummary -Format Markdown` (Resistance finished + in‑progress techs)
- `Get-TIFactionTechMatrix -Format Markdown` (True/False matrix of finished techs by faction)
- `Get-TIFactionPowerScores` (converted to Markdown table)
- `Get-TIFactionHateMatrixTable -Format Markdown` (human vs. human faction hate matrix)
- `Get-TIFactionAlienHateTable -Format Markdown` (alien hate snapshot by faction)

**Core logic:**

- Appends each Markdown block to a `StringBuilder`, with headings and `---` separators, in this order:
  1. Faction overview.
  2. Boost + space summary.
  3. Nation control per human faction.
  4. Resistance councilors + recruit highlights.
  5. Space sitrep (hab income + top Luna/Mars sites).
  6. Global habs overview (bases + stations, levels, MC).
  7. Resistance research summary (finished + in‑progress techs).
  8. Tech completion matrix by faction (True/False for finished techs).
  9. Power ranking table (Earth/Space/Tech weighted scores per faction).
  10. Human faction hate matrix (rows = source, columns = target).
  11. Alien hate by faction.

**Usage:**

- Single call to generate all main tables for a new summary.

**Developer notes:**

- If you add more high‑value functions, consider including them here or adding an option to `Invoke-TIDataMenu` to output extended snippet packs.

---

## 6. Boost Helper Script (`summarize_boost_income.ps1`)

**Location:** `Terra-Invicta-AI-Summary/summarize_boost_income.ps1`

**Purpose:**

- Standalone helper used in the docs to sum `BoostPerCP` across multiple `Again_<Faction>_Nations.csv` files and print a compact summary.
- Functionally overlaps with `Get-TIFactionBoostAndSpaceSummary` but exists as a simple, single‑purpose script.

**Developer notes:**

- If Boost estimation changes (e.g., more precise modeling), update both:
  - This script.
  - The Boost income logic in `Get-TIFactionBoostAndSpaceSummary`.

---

## 7. Recommended Developer Workflow

When modifying or extending `ti_data_tools.ps1`:

1. **Refresh exports**  

   ```powershell
   Set-Location F:\Windsurf\Terra-Invicta-AI-Summary
   .\export_factions.ps1
   ```

2. **Reset cache** (ensure you aren’t reading old CSVs)

   ```powershell
   . .\ti_data_tools.ps1
   Reset-TIDataCache
   ```

3. **Run `Test-TIExportContext`**

   - Confirm all expected CSVs are present.
   - Check the quick overview.

4. **Dot‑source after each change**

   ```powershell
   . .\ti_data_tools.ps1
   ```

   - Fix any parse errors immediately.

5. **Exercise all key functions**

   - `Get-TIFactionOverview -Format Table`
   - `Get-TIFactionBoostAndSpaceSummary -Format Table`
   - `Get-TIResistanceNationsSnapshot -Format Table`
   - `Get-TIResistanceCouncilorSummary -Format Table`
   - `Get-TISpaceSitrep -Format Table`
   - `Get-TISnippetPackMarkdown | Out-String` (to confirm Markdown generation)

6. **Only then compare numbers with existing summaries**

   - Once you know the tooling is correct and stable, use it to validate or update `summary_YYYYMMDD.md` files.

---

This file is meant to remain in sync with `ti_data_tools.ps1` and `TI_DATA_TOOLS.md`. If you change the toolbox, **update all three**:

- `ti_data_tools.ps1` — actual behavior.
- `TI_DATA_TOOLS.md` — user‑level documentation.
- `TI_DATA_DEV.md` — developer‑level internals and wiring.
