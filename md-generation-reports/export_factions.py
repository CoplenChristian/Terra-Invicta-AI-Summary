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

with CONFIG_PATH.open("r", encoding="utf-8") as f:
    _cfg = json.load(f)

WORK_DIR = Path(_cfg.get("WorkDir", str(ROOT))).resolve()
SAVE_PATH = _cfg.get("SavePath")
OUTPUT_DIR = WORK_DIR / _cfg.get("AgainSaveSubDir", "Again_Save")

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

