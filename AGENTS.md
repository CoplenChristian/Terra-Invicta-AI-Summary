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
