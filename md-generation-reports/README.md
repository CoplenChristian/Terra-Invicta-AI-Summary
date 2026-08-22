# Terra Invicta AI Summary Tools

A PowerShell toolkit for analyzing *Terra Invicta* save files and generating detailed strategic summaries. This project helps track faction power, resource income, and tech progress over time.

## 📍 Where this sits

This is the **original 2025-11 report generator**, moved out of the repository
root into `md-generation-reports/` so it is no longer mixed in with the live
dashboard (`server/`, `shared/`, `public/`, `site/`). The two are independent:
nothing in the dashboard reads anything here.

Two things did **not** move with it, because they are shared with the rest of the
repository and are not part of this tool:

- **`TerraInvicta.Common.psm1`** at the repository root. It provides `Get-TIConfig`
  and the save-selection helpers, and it is also imported by the five root
  `parse_*.ps1` parsers and covered by `tests/powershell_common.test.js`.
- **`config/defaults.json`** and **`config/config.schema.json`**, plus the ignored
  root **`config.json`**. These are the repository's one configuration source; the
  five `paths.*SubDir` keys in them belong to this tool and are read by nothing else.

Every script here therefore resolves the module and the config against its
*parent* directory, while its own output root (`paths.workDir`, default `.`)
resolves against this directory — so `csv/`, `Ship_Info/` and `Again_Save/` stay
beside the scripts that write them. If your `config.json` sets an absolute
`WorkDir`/`paths.workDir` pointing at the old repository root, update it to point
here.

## 📋 Prerequisites

- **PowerShell 5.1** or later (PowerShell Core 7+ recommended).
- A **Terra Invicta save file** (uncompressed `.json` or compressed `.gz`).
- (Optional) An AI assistant (like Claude, GPT-4, or Gemini) to process the generated Markdown snippets into a narrative summary.

## ⚙️ Setup & Configuration

1.  **Clone or Download** this repository.
2.  **Configure Paths**:
    - Copy `template.config` from this directory to a new, ignored file named `config.json` **in the repository root** (one level up).
    - Set `paths.savePath` to your Terra Invicta save folder or a specific `.gz`/`.json` save file.
    - Optional values such as `paths.templatesPath`, campaign defaults, scoring weights, and directive weights live in `config/defaults.json` at the repository root; override only the values you need in the ignored root `config.json`.
    - Existing flat keys (`SavePath`, `WorkDir`, and output directory keys) remain supported temporarily and emit deprecation warnings.

    ```json
    {
      "paths": {
        "savePath": "C:/Users/YourUser/Documents/My Games/TerraInvicta/Saves",
        "templatesPath": "C:/Program Files (x86)/Steam/steamapps/common/Terra Invicta/TerraInvicta_Data/StreamingAssets/Templates"
      }
    }
    ```

## 🚀 Usage Workflow

### 1. Export Data
Run the exporter to parse your save file and generate CSVs.
```powershell
.\export_factions.ps1
```
The exporter selects the newest `.gz` or `.json` save by default and writes to
the configured CSV folder. Use `.\export_factions.ps1 -Latest` explicitly in
automation, or `.\export_factions.ps1 -SaveNumber 2` for a numbered historical
lookup. This will create/update files in the `csv/` directory.

The standalone parsers (`parse_*.ps1`, at the repository root) use the same
central configuration and
selection rules. Values that are likely to change—paths, scoring weights,
directive weights, capability mappings, and retention—belong in the nested
JSON config; the defaults file documents the complete shape.
Both the Node loader and the PowerShell common module validate the resolved
configuration against `config/config.schema.json`, so type and range errors are
reported before analysis starts.

### 2. Load the Toolbox
Load the analysis functions into your PowerShell session.
```powershell
. .\ti_data_tools.ps1
```

### 3. Generate Snippet Pack
Create a comprehensive Markdown report containing all key data tables (Faction Power, Tech Matrix, Space Sitrep, etc.).
```powershell
Get-TISnippetPackMarkdown | Set-Content -Encoding UTF8 .\Again_Save\snippet_pack\snippet_pack_YYYYMMDD.md
```
*Replace `YYYYMMDD` with the in-game date.*

### 4. Create Strategic Summary
Use the generated snippet pack to populate a new summary file in `Again_Save/`.
- Copy the structure from `Again_Save/summary.md` (the template).
- Paste relevant sections from your snippet pack.
- Add your own strategic analysis or use an AI to generate the narrative.

## 📂 Key Files

- **`export_factions.ps1`**: The main script that reads the save file and exports raw data to CSV.
- **`ti_data_tools.ps1`**: A library of helper functions for analyzing the CSV data and generating Markdown tables.
- **`config.json`**: Configuration file for file paths (ignored by git).
- **`TI_DATA_TOOLS.md`**: Detailed documentation for the toolbox functions.
- **`Again_Save/summary.md`**: The master template for strategic summaries.

## 📁 Directory Structure

- **`csv/`**: Contains all exported CSV data files.
- **`Again_Save/`**: Stores your dated summary files (e.g., `summary_20250101.md`).
- **`Again_Save/snippet_pack/`**: Stores the raw Markdown data dumps generated by the toolbox.
- **`Ship_Info/`**: Contains raw JSON data for ship components (used for tech scoring).
