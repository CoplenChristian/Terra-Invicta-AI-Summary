# Repository Structure

Separate the original report-generation tool from the dashboard it grew into.

Written 2026-08-21 against `6551da0`.

---

## What is actually in the root

Two applications share a root directory. Creation dates separate them cleanly.

**The original tool — 2025-11-22, fourteen files.** A PowerShell/Python suite that parsed saves and generated markdown and CSV reports:

```
ti_data_tools.ps1              export_factions.ps1 / .py
Get-UnlockedShipComponents.ps1 generate_hab_module_tables.ps1
summarize_boost_income.ps1     generate_ship_components_tables.ps1
set_resistance_ship_build_times.ps1
TI_DATA_DEV.md  TI_DATA_TOOLS.md  summary_prompt_examples.md  template.config
```

**The dashboard — 2026-08-17 onward.** `server/`, `shared/`, `public/`, `site/`, `scripts/`, `tests/`, `package.json`.

**Measured: nothing current references the original tool.** Every one of `ti_data_tools`, `export_factions`, `generate_hab_module_tables`, `Get-UnlockedShipComponents` and `summarize_boost_income` is referenced by **zero** files under `server/`, `shared/`, `scripts/`, `tests/`, `public/`, `site/`, `package.json`, `CLAUDE.md` or `docs/`. The two applications are already independent; only the directory is shared.

## The move that is safe, and the one that is not

**Safe — the legacy tool.** Fourteen files, zero inbound references. Moving it cannot break the dashboard.

**Expensive — the dashboard internals.** Measured path references:

```
server/    167 files
shared/    135 files
site/       22 files
public/     20 files
```

Renaming `server/` touches 167 files for no functional gain, and it is not where the confusion is. The proposed `dashboard` / `server` split also has no clean home for **`shared/`**, which exists precisely because both the Node server and the Cloudflare worker import it — putting it under either one misdescribes it and invites a future agent to add an `fs` call.

**Recommendation: do the legacy separation, leave the dashboard internals alone.** The stated goal — a clean root where the old report generator is not mixed in with the live app — is achieved entirely by the first move. `public/` → `dashboard/` is defensible at 20 references if wanted, but it is cosmetic and can follow later.

## Target

```
docs/                       specs (already organised, archive/ inside)
md-generation-reports/      the 2025-11 tool, its docs, and its outputs
server/  shared/  site/     unchanged
public/                     unchanged, or -> dashboard/ as a separate step
scripts/  tests/  config/   unchanged
```

## What moves into `md-generation-reports/`

The fourteen source files above, plus the output directories that belong to them rather than to the dashboard:

```
Ship_Info/      27 tracked files
screenshots/    31 tracked
csv/             1 tracked, 45 untracked
Again_Save/      3 tracked
```

Confirm ownership before moving each — check whether the dashboard reads any of them. `csv/` in particular is mostly untracked local output and may only need ignoring.

## Untracked clutter, handled separately

```
backups/    273 files, untracked
logs/         2 files, untracked
Again        1 file,   untracked
Again.gz                untracked (a save file; .gitignore excludes *.gz)
```

None is in version control, so none is a *repository* problem — but `backups/` at 273 files is the bulk of the root's apparent mess. Add explicit `.gitignore` entries so they stay out and stop appearing in listings. **Do not delete anything untracked**; it is the user's local data and not ours to remove.

## Also at root, and not legacy

Five PowerShell parsers created 2026-08-19 — `parse_alien_hate.ps1`, `parse_faction_councilors.ps1`, `parse_faction_nations.ps1`, `parse_faction_space_assets.ps1`, `parse_alien_councilor_locations.ps1`. `CLAUDE.md` documents these as **retained for backward compatibility**, superseded by `scripts/parse_save.js`. They are not part of the 2025 tool. Either leave them or give them their own directory — but do not fold them into `md-generation-reports/`, which would misdate them.

Four ad-hoc browser scripts also sit at root — `test_browser.js`, `test_browser_councilors.js`, `test_browser_v2.js`, `test_new_intel_endpoints.js` (2026-08-19). These predate `scripts/verify_v2_navigation.js` and are probably dead; check before moving or removing.

Three feedback documents — `AGY_SUPABASE_BACKEND_PROMPT.md`, `antigravity-feedback-8-18-2026.md`, `opencode-feedback-8-18-2026.md` — belong in `docs/archive/`.

## Constraints

- **Use `git mv`**, so history follows the files.
- `README.md` describes the original tool and must be rewritten for the dashboard, with the tool's own README moving alongside it.
- `CLAUDE.md` documents the legacy parsers and the save-parsing workflow; update the paths it cites.
- `.gitignore` currently excludes `*.gz`; verify nothing moved becomes newly tracked.
- `npm test`, `npm run build:site` and `npm run push:dry-run` must all still pass — the last because the publisher resolves paths at runtime.

## Acceptance

- No file created 2025-11-22 remains at the repository root.
- `md-generation-reports/` is self-contained: nothing inside references the dashboard, nothing in the dashboard references it. Verify by grep, both directions.
- `backups/`, `logs/` and stray save files are gitignored and absent from `git status`.
- 791 tests pass; `build:site` and `push:dry-run` succeed.
- `README.md` describes the dashboard.
- Git history survives the move — `git log --follow` on a moved file reaches its 2025-11-22 creation.
