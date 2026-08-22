param(
    [string]$RootPath = $null
)

# Load configuration
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
# See ti_data_tools.ps1: the shared module and config/ stayed at the repository
# root when this tool moved into md-generation-reports/, so they anchor on
# $repoRoot. $RootPath (the tool's own output root) follows the scripts.
$repoRoot = Split-Path -Parent $scriptPath
$commonModulePath = Join-Path $repoRoot "TerraInvicta.Common.psm1"
Import-Module -Name $commonModulePath -Force
$config = Get-TIConfig -BasePath $repoRoot

if ([string]::IsNullOrEmpty($RootPath)) {
    $RootPath = $config.WorkDir
    if ($RootPath -eq ".") { $RootPath = $scriptPath }
}

$shipInfoDir = $config.ShipInfoSubDir

$rawPath = Join-Path $RootPath "$shipInfoDir/raw_json"
$outPath = Join-Path $RootPath "$shipInfoDir/hab_module_tables.md"

function Get-FieldValue {
    param(
        [object]$Obj,
        [string]$Name
    )

    if ($null -eq $Obj) { return $null }

    if ($Obj -is [hashtable]) {
        if ($Obj.ContainsKey($Name)) { return $Obj[$Name] }
        return $null
    }

    $p = $Obj.PSObject.Properties.Match($Name)
    if ($p -and $p.Count -gt 0) { return $p[0].Value }
    return $null
}

function Get-TIJson {
    param(
        [string]$Name
    )
    $path = Join-Path $rawPath $Name
    if (-not (Test-Path $path)) {
        Write-Error "Missing JSON file: $path"
        return @()
    }
    (Get-Content $path -Raw | ConvertFrom-Json)
}

function New-MarkdownTable {
    param(
        [string]$Title,
        [object[]]$Rows,
        [string[]]$Columns,
        [hashtable]$HeaderMap
    )

    if (-not $Rows -or $Rows.Count -eq 0) { return @() }

    $lines = @()
    $lines += "## $Title"
    $lines += ""

    $headers = @("Module","Template ID")
    foreach ($c in $Columns) {
        if ($c -in @("friendlyName","dataName","displayName")) { continue }
        $headers += ($HeaderMap[$c] | ForEach-Object { if ($_){$_} else {$c} })
    }
    $lines += "| " + ($headers -join " | ") + " |"
    $lines += "|" + ("---|" * $headers.Count)

    foreach ($row in $Rows) {
        $vals = @()
        $name = $row.friendlyName
        if (-not $name) { $name = $row.displayName }
        if (-not $name) { $name = $row.dataName }
        $vals += [string]$name
        $vals += [string]$row.dataName

        foreach ($c in $Columns) {
            if ($c -in @("friendlyName","dataName","displayName")) { continue }
            $p = $row.PSObject.Properties.Match($c)
            if (-not $p -or $p.Count -eq 0) { $vals += "" ; continue }
            $v = $p[0].Value
            if ($null -eq $v) { $vals += "" ; continue }
            if ($v -is [double] -or $v -is [float]) {
                $vals += ("{0:g}" -f $v)
            } else {
                $vals += [string]$v
            }
        }

        $lines += "| " + ($vals -join " | ") + " |"
    }

    $lines += ""
    return $lines
}

$modules = Get-TIJson "TIHabModuleTemplate.json"

# Flatten nested bits the tables need.
foreach ($m in $modules) {
    # Safely handle missing nested objects; some templates omit upkeep/build mixes.
    $sup = $m.supportMaterials_month
    if (-not $sup) { $sup = @{} }
    $m | Add-Member -NotePropertyName 'upkeepMoney'       -NotePropertyValue (Get-FieldValue $sup 'money')       -Force
    $m | Add-Member -NotePropertyName 'upkeepBoost'       -NotePropertyValue (Get-FieldValue $sup 'boost')       -Force
    $m | Add-Member -NotePropertyName 'upkeepWater'       -NotePropertyValue (Get-FieldValue $sup 'water')       -Force
    $m | Add-Member -NotePropertyName 'upkeepVolatiles'   -NotePropertyValue (Get-FieldValue $sup 'volatiles')   -Force
    $m | Add-Member -NotePropertyName 'upkeepMetals'      -NotePropertyValue (Get-FieldValue $sup 'metals')      -Force
    $m | Add-Member -NotePropertyName 'upkeepNobleMetals' -NotePropertyValue (Get-FieldValue $sup 'nobleMetals') -Force
    $m | Add-Member -NotePropertyName 'upkeepFissiles'    -NotePropertyValue (Get-FieldValue $sup 'fissiles')    -Force

    $build = Get-FieldValue $m 'weightedBuildMaterials'
    if (-not $build) { $build = @{} }
    $m | Add-Member -NotePropertyName 'buildWater'       -NotePropertyValue (Get-FieldValue $build 'water')       -Force
    $m | Add-Member -NotePropertyName 'buildVolatiles'   -NotePropertyValue (Get-FieldValue $build 'volatiles')   -Force
    $m | Add-Member -NotePropertyName 'buildMetals'      -NotePropertyValue (Get-FieldValue $build 'metals')      -Force
    $m | Add-Member -NotePropertyName 'buildNobleMetals' -NotePropertyValue (Get-FieldValue $build 'nobleMetals') -Force
    $m | Add-Member -NotePropertyName 'buildFissiles'    -NotePropertyValue (Get-FieldValue $build 'fissiles')    -Force
    $m | Add-Member -NotePropertyName 'buildExotics'     -NotePropertyValue (Get-FieldValue $build 'exotics')     -Force

    $tech = Get-FieldValue $m 'techBonuses'
    $m | Add-Member -NotePropertyName 'techBonusesCsv' -NotePropertyValue ((($tech | Where-Object { $_ }) -join ", ")) -Force
    $rules = Get-FieldValue $m 'specialRules'
    $m | Add-Member -NotePropertyName 'specialRulesCsv' -NotePropertyValue ((($rules | Where-Object { $_ }) -join ", ")) -Force
}

$out = @()
$out += "# Terra Invicta Hab Modules"
$out += ""
$out += "Source: `Ship_Info/raw_json/TIHabModuleTemplate.json` from the Again campaign export."
$out += "Fields focus on constraints, economy, and strategic role rather than art/UI metadata."
$out += ""
$out += "---"
$out += ""

$coreColumns = @(
    "friendlyName","dataName","requiredProjectName",
    "tier","habType","coreModule","onePerHab","mine","automated",
    "allowsShipConstruction","allowsResupply","noBuild","disable","destroyed",
    "crew","power","baseMass_tons","buildTime_Days",
    "missionControl","controlPointCapacity","spaceCombatValue",
    "incomeMoney_month","incomeInfluence_month","incomeOps_month",
    "incomeResearch_month","incomeProjects","incomeVolatiles_month",
    "incomeMetals_month","incomeNobles_month","incomeFissiles_month",
    "incomeAntimatter_month","incomeExotics_month",
    "miningModifier","constructionTimeModifier",
    "techBonusesCsv","specialRulesCsv","specialRulesValue"
)
$coreHeaders = @{
    friendlyName              = "Module"
    dataName                  = "Template ID"
    requiredProjectName       = "Required Project"
    tier                      = "Tier"
    habType                   = "Hab Type"
    coreModule                = "Core?"
    onePerHab                 = "One/Hub?"
    mine                      = "Mine?"
    automated                 = "Auto?"
    allowsShipConstruction    = "Shipyard"
    allowsResupply            = "Resupply"
    noBuild                   = "No Build"
    disable                   = "Disabled"
    destroyed                 = "Destroyed"
    crew                      = "Crew"
    power                     = "Power"
    baseMass_tons             = "Mass (t)"
    buildTime_Days            = "Build (days)"
    missionControl            = "MC"
    controlPointCapacity      = "CP Cap."
    spaceCombatValue          = "SCV"
    incomeMoney_month         = "Money/mo"
    incomeInfluence_month     = "Influence/mo"
    incomeOps_month           = "Ops/mo"
    incomeResearch_month      = "Research/mo"
    incomeProjects            = "Projects"
    incomeVolatiles_month     = "Vols/mo"
    incomeMetals_month        = "Metals/mo"
    incomeNobles_month        = "Nobles/mo"
    incomeFissiles_month      = "Fissiles/mo"
    incomeAntimatter_month    = "Antimatter/mo"
    incomeExotics_month       = "Exotics/mo"
    miningModifier            = "Mining mod"
    constructionTimeModifier  = "Build time mod"
    techBonusesCsv            = "Tech Bonuses"
    specialRulesCsv           = "Special Rules"
    specialRulesValue         = "Special Value"
}
$out += New-MarkdownTable -Title "Core Stats & Outputs" -Rows $modules -Columns $coreColumns -HeaderMap $coreHeaders

$upkeepColumns = @(
    "friendlyName","dataName",
    "upkeepMoney","upkeepBoost","upkeepWater","upkeepVolatiles",
    "upkeepMetals","upkeepNobleMetals","upkeepFissiles"
)
$upkeepHeaders = @{
    friendlyName      = "Module"
    dataName          = "Template ID"
    upkeepMoney       = "Money/mo"
    upkeepBoost       = "Boost/mo"
    upkeepWater       = "Water/mo"
    upkeepVolatiles   = "Vols/mo"
    upkeepMetals      = "Metals/mo"
    upkeepNobleMetals = "Nobles/mo"
    upkeepFissiles    = "Fissiles/mo"
}
$out += New-MarkdownTable -Title "Monthly Upkeep" -Rows $modules -Columns $upkeepColumns -HeaderMap $upkeepHeaders

$buildColumns = @(
    "friendlyName","dataName",
    "buildWater","buildVolatiles","buildMetals",
    "buildNobleMetals","buildFissiles","buildExotics"
)
$buildHeaders = @{
    friendlyName      = "Module"
    dataName          = "Template ID"
    buildWater        = "Water"
    buildVolatiles    = "Volatiles"
    buildMetals       = "Metals"
    buildNobleMetals  = "Nobles"
    buildFissiles     = "Fissiles"
    buildExotics      = "Exotics"
}
$out += New-MarkdownTable -Title "Build Material Mix (weights)" -Rows $modules -Columns $buildColumns -HeaderMap $buildHeaders

$out | Set-Content -Path $outPath -Encoding UTF8
Write-Host "Wrote $outPath"
