param(
    # Base folder where the Again_*.csv files live
    [string]$BasePath = $null
)

# Load configuration
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$commonModulePath = Join-Path $scriptPath "TerraInvicta.Common.psm1"
Import-Module -Name $commonModulePath -Force
$config = Get-TIConfig -BasePath $scriptPath

if ([string]::IsNullOrEmpty($BasePath)) {
    $WorkDir = $config.WorkDir
    if ($WorkDir -eq ".") { $WorkDir = $scriptPath }
    $AgainSaveSubDir = $config.AgainSaveSubDir
    $BasePath = Join-Path $WorkDir $AgainSaveSubDir
}

# Faction nation files to include
$factionNationFiles = @(
    "Again_Resistance_Nations.csv",
    "Again_HumanityFirst_Nations.csv",
    "Again_Initiative_Nations.csv",
    "Again_Servants_Nations.csv",
    "Again_Protectorate_Nations.csv",
    "Again_Academy_Nations.csv",
    "Again_Exodus_Nations.csv"
)

$rows = @()

foreach ($file in $factionNationFiles) {
    $path = Join-Path $BasePath $file
    if (-not (Test-Path $path)) {
        continue
    }

    # Import and safely sum numeric BoostPerCP values
    $sum = Import-Csv $path |
        Where-Object { $_.BoostPerCP -ne $null -and $_.BoostPerCP -ne "" } |
        ForEach-Object { [double]$_.BoostPerCP } |
        Measure-Object -Sum |
        Select-Object -ExpandProperty Sum

    if ($null -eq $sum) {
        $sum = 0
    }

    $rows += [PSCustomObject]@{
        FactionFile         = $file
        BoostIncomeEstimate = [Math]::Round($sum, 3)
    }
}

# Print a simple table
$rows | Sort-Object FactionFile | Format-Table -AutoSize

