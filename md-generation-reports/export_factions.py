import os
import json
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent
# This tool lives in md-generation-reports/; config.json stayed at the
# repository root, alongside config/defaults.json, so it is read from the
# parent. WORK_DIR below still defaults to this tool's own directory.
REPO_ROOT = ROOT.parent
CONFIG_PATH = REPO_ROOT / "config.json"
DEFAULTS_PATH = REPO_ROOT / "config" / "defaults.json"


def _read_json(path):
    """Parsed JSON, or None when the file is simply not there."""
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError:
        return None


def _setting(cfg, nested_key, legacy_key):
    """
    One path setting, nested spelling first, then the legacy flat one.

    Two defects this closes, both of which the PowerShell siblings never had
    because Get-TIConfig does this for them:

      1. config.json is GITIGNORED. Opening it unconditionally raised
         FileNotFoundError on any checkout that had not been configured, while
         every other script in this directory falls back to
         config/defaults.json.
      2. It read ONLY the flat legacy keys (WorkDir / SavePath /
         AgainSaveSubDir). A purely nested config.json -- the documented,
         non-deprecated shape -- left every one of them unset, so the exporter
         silently wrote to the WRONG directory instead of failing. Silent wrong
         output is worse than a crash.

    Absence stays absence: an unset key returns None rather than a coerced
    empty string, so the caller decides what a missing value means.
    """
    paths = cfg.get("paths")
    if not isinstance(paths, dict):
        paths = {}
    for candidate in (paths.get(nested_key), cfg.get(legacy_key)):
        if candidate is not None and candidate != "":
            return candidate
    return None


def _resolve(nested_key, legacy_key):
    """The user's config wins; config/defaults.json is the fallback."""
    return _setting(_cfg, nested_key, legacy_key) or _setting(_defaults, nested_key, legacy_key)


_defaults = _read_json(DEFAULTS_PATH) or {}
_cfg = _read_json(CONFIG_PATH)
if _cfg is None:
    print(f"[export_factions] no {CONFIG_PATH}; falling back to {DEFAULTS_PATH}")
    _cfg = {}

# A RELATIVE workDir belongs to this tool, not to whatever directory the script
# happened to be launched from. The PowerShell siblings resolve it against their
# own folder (see Get-UnlockedShipComponents.ps1) and this has to agree with
# them, or the two halves of the tool write to different trees.
_work_dir = _resolve("workDir", "WorkDir") or "."
_work_path = Path(_work_dir)
WORK_DIR = (_work_path if _work_path.is_absolute() else ROOT / _work_path).resolve()

SAVE_PATH = _resolve("savePath", "SavePath")
OUTPUT_DIR = WORK_DIR / (_resolve("againSaveSubDir", "AgainSaveSubDir") or "Again_Save")

FACTIONS = [
    ("ResistCouncil", "Resistance"),
    ("DestroyCouncil", "HumanityFirst"),
    ("ExploitCouncil", "Initiative"),
    ("SubmitCouncil", "Servants"),
    ("AppeaseCouncil", "Protectorate"),
    ("CooperateCouncil", "Academy"),
    ("EscapeCouncil", "Exodus"),
    ("AlienCouncil", "Aliens"),
]

POWERSHELL_EXE = "powershell.exe"


def run_ps(command: str) -> None:
    """Run a PowerShell command from Python, raising on failure."""
    completed = subprocess.run(
        [POWERSHELL_EXE, "-Command", command],
        cwd=str(WORK_DIR),
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise RuntimeError(
            f"PowerShell failed: {completed.returncode}\nSTDOUT:\n{completed.stdout}\nSTDERR:\n{completed.stderr}"
        )


def decompress_to_temp_json() -> Path:
    """Decompress Again.gz into a temporary JSON file and return its path."""
    WORK_DIR.mkdir(parents=True, exist_ok=True)

    fd, tmp_path_str = tempfile.mkstemp(
        prefix="Again_", suffix=".json", dir=str(WORK_DIR)
    )
    os.close(fd)
    tmp_path = Path(tmp_path_str)

    ps = (
        rf"$src = '{SAVE_PATH}'; "
        rf"$dst = '{tmp_path}'; "
        "$fs = [IO.File]::OpenRead($src); "
        "$gz = New-Object IO.Compression.GzipStream($fs,[IO.Compression.CompressionMode]::Decompress); "
        "$out = [IO.File]::Create($dst); "
        "$gz.CopyTo($out); $gz.Close(); $fs.Close(); $out.Close()"
    )

    run_ps(ps)
    return tmp_path


def export_faction_core(json_path: Path) -> None:
    """Export one CSV with core resources for all factions."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUTPUT_DIR / "Again_Factions_Core.csv"

    ps = (
        rf"$json = Get-Content '{json_path}' -Raw | ConvertFrom-Json; "
        "$f = $json.gamestates.'PavonisInteractive.TerraInvicta.TIFactionState' | ForEach-Object { $_.Value }; "
        "$f | Select-Object templateName, displayName, @{Name='FactionID';Expression={$_.ID.value}}, "
        "@{Name='Money';Expression={$_.resources.Money}}, "
        "@{Name='Influence';Expression={$_.resources.Influence}}, "
        "@{Name='Operations';Expression={$_.resources.Operations}}, "
        "@{Name='Boost';Expression={$_.resources.Boost}} "
        rf"| Export-Csv -Path '{out_path}' -NoTypeInformation -Encoding UTF8"
    )

    run_ps(ps)


def export_nations_per_faction(json_path: Path) -> None:
    """Export one nations CSV per human faction, matching your existing Resistance file layout."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    for template_name, short_name in FACTIONS:
        if template_name == "AlienCouncil":
            # Aliens do not own nations in the same way; skip.
            continue

        out_path = OUTPUT_DIR / f"Again_{short_name}_Nations.csv"

        ps = (
            rf"$json = Get-Content '{json_path}' -Raw | ConvertFrom-Json; "
            "$factions = $json.gamestates.'PavonisInteractive.TerraInvicta.TIFactionState' | ForEach-Object { $_.Value }; "
            rf"$faction = $factions | Where-Object templateName -eq '{template_name}'; "
            "$fid = $faction.ID.value; "
            "$nations = $json.gamestates.'PavonisInteractive.TerraInvicta.TINationState' | ForEach-Object { $_.Value }; "
            "$nations | Where-Object { $_.controllingFaction.value -eq $fid } | "
            "Select-Object "
            "@{Name='NationID';Expression={$_.ID.value}}, "
            "@{Name='NationName';Expression={$_.displayName}}, "
            "regionCount, gdp, population, milTech, democracy, cohesion, unrest, knowledge, inequality, climatePolicy, "
            "@{Name='CP_IDs';Expression={ ($_.controlPoints | ForEach-Object { $_.value }) -join ';' }} "
            rf"| Export-Csv -Path '{out_path}' -NoTypeInformation -Encoding UTF8"
        )

        run_ps(ps)


def export_councilors_per_faction(json_path: Path) -> None:
    """Export councilor summary for each human faction."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    for template_name, short_name in FACTIONS:
        if template_name == "AlienCouncil":
            continue

        out_path = OUTPUT_DIR / f"Again_{short_name}_Councilors.csv"

        ps = (
            rf"$json = Get-Content '{json_path}' -Raw | ConvertFrom-Json; "
            "$factions = $json.gamestates.'PavonisInteractive.TerraInvicta.TIFactionState' | ForEach-Object { $_.Value }; "
            rf"$faction = $factions | Where-Object templateName -eq '{template_name}'; "
            "$fid = $faction.ID.value; "
            "$councilors = $json.gamestates.'PavonisInteractive.TerraInvicta.TICouncilorState' | ForEach-Object { $_.Value }; "
            "$c = $councilors | Where-Object { $_.faction.value -eq $fid }; "
            "$c | Select-Object "
            "@{Name='ID';Expression={$_.ID.value}}, displayName, templateName, admin, command, persuasion, investigation, espionage, science, security, loyalty, government, minimal_trait, organizationSlots, controlPointCap, detected, locationRegionName "
            rf"| Export-Csv -Path '{out_path}' -NoTypeInformation -Encoding UTF8"
        )

        run_ps(ps)


if __name__ == "__main__":
    if not SAVE_PATH:
        # Without this the save path interpolates into the PowerShell command as
        # the literal string 'None' and the failure surfaces as an unreadable
        # IO error several layers down.
        raise SystemExit(
            "No save file is configured. Set paths.savePath in "
            f"{CONFIG_PATH} (or the legacy SavePath key); neither it nor "
            f"{DEFAULTS_PATH} supplies one."
        )
    temp_json = decompress_to_temp_json()
    try:
        export_faction_core(temp_json)
        export_nations_per_faction(temp_json)
        export_councilors_per_faction(temp_json)
    finally:
        try:
            if temp_json.exists():
                temp_json.unlink()
        except OSError:
            # If cleanup fails, just leave the temp file.
            pass

