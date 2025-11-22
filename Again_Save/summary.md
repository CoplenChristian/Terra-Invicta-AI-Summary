# 📋 **MANDATORY SECTIONS PRESERVATION NOTICE**

**⚠️ CRITICAL:** When this file is regenerated or updated, the following sections **MUST** be preserved and rebuilt with current data:

## **Required Strategic Sections (Interactive ToC)**

> ⚠️ **Update Requirement:** Whenever this file is regenerated, refresh both this ToC and the linked sections with current data.

1. [🤝 Faction Power Table (Current Save)](#section-1) — Complete faction rankings with GDP, space power, resources
2. [⛏️ Space & Mining Tech Comparison](#section-2) — Space race readiness analysis
3. [🧩 Current Open Decisions](#section-3) — Immediate tactical choices and priorities
4. [🎯 Current Terra Invicta Action Plan](#section-4) — Comprehensive strategic roadmap
5. [🌍 Earth-Side Plan](#section-5) — Nation control and expansion strategy
6. [🧑‍⚖️ Council Operations](#section-6) — Team synergy and recruitment plans
7. [🎯 Councilor 2-3 Turn Plans](#section-7) — Individual councilor tactical assignments
8. [🚀 Space Program Strategy](#section-8) — LEO, Luna, Mars phases
9. [📈 Research & Technology Priorities](#section-9) — Tech development focus
10. [🔭 Mid-Term Strategic Goals](#section-10) — 2024-2026 objectives
11. [🛖 Hab Sites Situation](#section-11) — State of Luna/Mars/outer hab claims and priorities
12. [📢 Biggest Changes Since Last Snapshot](#section-12) — Key developments for the Resistance and notable faction moves

## Template Usage Instructions

1. **Export latest data:** Run `export_factions.ps1` (or equivalent) so every `Again_*.csv` reflects the newest save.
2. **Populate sections:** For the new dated file, rebuild every section below using current CSV data—do not leave placeholders. Cite source files inline when possible. All CSVs referenced in this template (`Again_*.csv`) live under the campaign `csv/` folder (e.g., `f:/Windsurf/TerraInvicta_again/csv`).
3. **Update the template last:** When the dated file is complete, only update `summary.md` if the section list changes. Otherwise leave it as the blank scaffold.
4. **Repeat per request:** Each time the campaign is refreshed, generate a new dated summary and archive it alongside prior snapshots for reference.
5. **Use the data toolbox:** Refer to `TI_DATA_TOOLS.md` and `ti_data_tools.ps1` at the campaign root (`TerraInvicta_again`) for scripted helpers that generate Markdown tables and summaries for most sections below. Always prefer these tools over manual aggregation when possible. In particular:  
   - Use `Get-TISnippetPackMarkdown` (which includes **Space Sitrep**, **Top Unclaimed Asteroid Belt Sites**, and **Habs by Faction** via `Get-TIFactionHabsOverview`) as the **primary source** for hab counts, locations, levels, and MC.  
   - Use the **Human Faction Hate Matrix** snippet (from `Get-TIFactionHateMatrixTable`) when describing inter-faction tensions, rivalries, and war/ops risk in Sections 1, 3, and 12.  
   - Use the CSVs under `csv/` (especially `Again_Resistance_Habs.csv`, `Again_HabSites.csv`, and `Again_Faction_HabIncome.csv`) for any extra hab detail you need.  
   - **Do not create additional per-snapshot hab markdown files** (e.g., no `resistance_habsites_CURRENT.md`); always read from the snippet pack and CSVs instead.

### Specificity & Call-Out Requirements

When generating a dated `summary/summary_YYYYMMDD.md`, the AI **must not** stay at a generic level. For every required section, the report must:

- **Name concrete game entities:**
  - Nations (e.g., "United States", "Kazakhstan").
  - Factions (e.g., "the Initiative", "the Servants").
  - Habs, stations, fleets, and space bodies across the **entire Solar System** (e.g., "Tycho", "Shackleton", "Arcadia Planitia", "Ceres", "Jovian moons", specific stations or ship classes) depending on current campaign progress.
  - Techs and global projects (e.g., "Industrialization of Space", "Molten Core Fission Systems").

- **Reference toolbox outputs and plots explicitly:**
  - Tie commentary back to specific toolbox outputs and CSV-derived tables:
    - `Resistance Nation Control` for Earth-side plans.
    - `Faction Overview` and `Boost + Space Summary` for faction rankings.
    - `Space Sitrep` for current hab income and high-value sites on **any body** (Luna, Mars, asteroids, outer system locations, etc.).
  - Use clear phrases like:
    - "In the Resistance Nation Control table we see…"
    - "From the Space Sitrep, the top unclaimed sites on [body] are…".

- **Include multiple specific call-outs per section:**
  - Each of the 12 required sections must include at least **three** concrete references to:
    - A named nation, faction, hab, site, fleet, or tech, and
    - A specific metric (CPs, GDP, BoostIncomeEstimate, MetalsPerDay, FissilesPerDay, research progress, fleet count, hab count, etc.).

- **Turn data into "plots":**
  - For space-focused sections (2, 8, 11), always describe a **map-like story** of the Solar System that is appropriate to the current game state:
    - Which exact bodies and sites (Luna, Mars, main belt, Jovian/Saturnian systems, other regions) are owned by whom and what they produce.
    - Which 2–3 specific sites or regions are priority targets and why (e.g., fissiles vs. metals vs. water vs. positional advantage), including **Top Unclaimed Asteroid Belt Sites** when available.
  - For Earth-focused sections (1, 3, 5, 6, 7, 10, 12), always describe a **control and influence story**:
    - Which nations are anchors, which are unstable, which are future targets or liabilities.

Sections that only paraphrase tables without **named entities plus numeric references** from current data should be considered incomplete and must be expanded.

> 🛈 **Agent instruction (pre-flight):** Before generating any dated summary from this template, always refresh the exports so the snippet pack, hab CSVs, and research snapshot reflect the current save:
> ```powershell
> Set-Location f:/Windsurf/TerraInvicta_again
> .\export_factions.ps1
> . .\ti_data_tools.ps1
> # Optional sanity check
> Test-TIExportContext
> # Snippet pack (includes Space Sitrep + Habs by Faction + Resistance Research Summary + Tech Completion Matrix (By Faction) + Alien Hate by Faction)
> Get-TISnippetPackMarkdown | Set-Content -Encoding UTF8 .\Again_Save\snippet_pack\snippet_pack_YYYYMMDD.md
> ```
> - Use the **Space Sitrep** and **Habs by Faction** sections in the snippet pack as the authoritative sources for **where** habs are, who owns them, and their high-level yields in Sections 2, 8, and 11.  
> - Use `Again_Resistance_Habs.csv` as the authoritative source for **how many Resistance habs you have, their types (base/station), tier levels, and MCCost** when describing MC posture and upgrade priorities in Sections 8, 9, and 10.  
> - Use `Again_HabSites.csv` and `Again_Faction_HabIncome.csv` when you need per-site yields or per-faction resource income beyond what the snippet pack already shows.  
> - Use the **Resistance Research Summary** section of the snippet pack (driven by `Get-TIResistanceResearchSummary` and `Again_Resistance_Projects.csv`) as the authoritative source for **what the Resistance has finished vs. what is still in progress** when writing Sections 2, 9, 10, and 12.
> - Use the **Tech Completion Matrix (By Faction)** section of the snippet pack (driven by `Get-TIFactionTechMatrix` and per-faction `Again_<Short>_Projects.csv` files) as the authoritative source for **which factions have finished which techs/projects** when writing Sections 2, 9, and 12. Treat each `True`/`False` entry as a simple indicator of whether that faction has completed the corresponding tech/project.
> - Use the **Alien Hate by Faction** section of the snippet pack (driven by `Get-TIFactionAlienHateTable` and `Again_Faction_AlienHate.csv`) as the authoritative source for **how hostile the aliens are to each faction** when writing Sections 1, 3, 8, and 12.
> - **Do not** generate any extra markdown files (e.g., `resistance_habsites_CURRENT.md`) from the hab helpers; rely on the snippet pack and CSVs instead.

### Resource & Economy Helper CSVs

In addition to the original exports, the template now assumes the presence of these helper CSVs generated by `export_factions.ps1`:

- `Again_Faction_HabIncome.csv` — one row per faction with habs, summarizing **space mining income only** (habs with a non-zero `MiningLevel`):
  - `FactionName`, `SiteCount`
  - `WaterPerDay`, `VolatilesPerDay`, `MetalsPerDay`, `NoblesPerDay`, `FissilesPerDay`
  - Use this file when describing **Luna/Mars/belt mining strength per faction** and overall **space mining economy** (e.g., in *Space & Mining Tech Comparison*, *Space Program Strategy*, and *Hab Sites Situation*). For non-mining habs (pure stations, research hubs, shipyards), rely on `Again_Habs_All.csv` and the **Habs by Faction** / **Habs Overview** snippets instead.
- `Again_Faction_EarthSummary.csv` — one row per non-alien faction, summarizing **Earth-side control**:
  - `FactionName`, `TotalCPs`, `TotalGDP`, `TotalPopulation`
  - Use this file when comparing **Earth power**, especially in *Faction Power Table* and *Earth-Side Plan* sections.
- `Again_Resistance_Habs.csv` — one row per Resistance hab (bases + stations), summarizing **hab type, tier, and MC cost**:
  - `HabName`, `HabType` (Base/Station), `OrbitBodyName`, `HabLevel`, `MCCost`, plus faction and site linkage.
  - Use this when writing the **Resistance MC posture and tier mix** in *Space Program Strategy* and when setting MC-related targets in *Research & Technology Priorities* and *Mid-Term Goals*.

- `Again_Faction_AlienHate.csv` — one row per faction with its current **assessed alien hate** value:
  - `FactionName`, `TemplateName`, `AssessedAlienHateOfMe`.
  - Use this when discussing **which factions the aliens currently prioritize as enemies or proxies**, especially in *Faction Power Table*, *Current Open Decisions*, *Space Program Strategy*, and *Biggest Changes Since Last Snapshot*.

- `Again_<ShortName>_Habs.csv` — one row per hab for **each human faction** (e.g., `Again_Initiative_Habs.csv`, `Again_Servants_Habs.csv`), emitted alongside the Resistance file:
  - Loaded via `Get-TIFactionHabs(<ShortName>)` in the toolbox.
  - Use these when you need to **name a few important rival habs or bodies** for comparison (e.g., where Initiative has its main metals hubs), but keep the **deep site-by-site breakdown primarily for the Resistance**.

Per-nation **Boost potential and income** is embedded directly in each faction’s nation CSV:

- `Again_<Faction>_Nations.csv` now has, in addition to the original columns:
  - `BoostHistoryLatest` — the nation’s latest `historyBoost` value (proxy for the nation’s total Boost output).
  - `BoostPerCP` — `BoostHistoryLatest` divided by that nation’s total control points; this is the **Boost share for a single CP** in that nation.
- Because each CP is listed as a separate row for a faction, you can compute that faction’s **approximate Boost income from Earth nations** by summing `BoostPerCP` over its rows. For example, in PowerShell for the Resistance:
  - `Import-Csv Again_Resistance_Nations.csv | Measure-Object BoostPerCP -Sum`
  - The resulting `Sum` is the Resistance’s estimated Boost income from all controlled nations combined.

Use this Boost estimate when you want to:

- Compare **Earth-derived Boost income** between factions (using each faction’s `Again_<Faction>_Nations.csv`).
- Tie together Earth-side Boost potential with space-side mining income from `Again_Faction_HabIncome.csv` when writing the *Faction Power Table*, *Space & Mining Tech Comparison*, or the *Earth-Side Plan*.

#### 📌 Boost Priority Guidance (Context-Dependent)

Boost is a central constraint **early**, especially before any faction can mine or refine resources in space. Use the Boost helpers and `BoostIncomeEstimate` when you need to:

- Explain why you *can* or *cannot* afford new early habs, shipyards, or rush builds.
- Compare which factions can most rapidly convert Earth-side gains into first-wave LEO/Luna/Mars outposts.

Once **all major human factions have at least one source of space resources** (Water, Volatiles, Metals, Nobles, or Fissiles) **and** the Resistance has active in-space construction capability, treat Boost as **secondary** in strategic analysis. At that stage, summaries should emphasize, in roughly this order:

- **Metals/day, Fissiles/day, and other refined space outputs** (per faction and for key sites).
- **MC usage and hab tiering** (how much MC is tied up where, and which sites should be upgraded or kept at tier‑1).
- **Shipyard throughput and fleet production** (where ships can be built, at what scale, and how quickly fleets can be replaced).
- **Belt/Mars/Luna industrial depth** (how many high-yield nodes you and rivals control across these regions).
- **Alien hate and space vulnerability** (which factions and hab clusters are likely targets).

Boost still matters for **outpost placement, rush builds, and logistics**, but in mature space economies it should not dominate decision-making; analyses should frame Boost as a supporting resource to the broader space industrial picture rather than the primary objective.

### Suggested Source CSVs by Section

| Section | Primary CSVs | Notes |
|---------|---------------|-------|
| Campaign Overview | `Again_Factions_Core.csv`, `Again_Techs_Global.csv` | Pull high-level faction status, **space resource stockpiles**, and research stage |
| Current Nation Control | `Again_Resistance_Nations.csv` | Group by `NationName`, summarize CP counts and stats |
| Councilors | `Again_Resistance_Councilors.csv`, `Again_Councilor_Recruits.csv` | Include active roster plus recruit pool highlights |
| Global Faction Landscape | `Again_Factions_Core.csv` | Compare resource pools and **space stockpiles** across factions |
| Other Factions’ Earth Control | `Again_*_Nations.csv` per faction | Highlight top CP holdings for each rival |
| Space Program & Solar System Status | `Again_Aliens_Habs.csv`, `Again_Aliens_Fleets.csv`, `Again_HabSites.csv`, `Again_SpaceBodies.csv` | Cover habs, fleets, and key sites |
| Faction Power Table | `Again_Factions_Core.csv`, `Again_*_Nations.csv` | Combine GDP control with resource stats; use the **Faction Overview** snippet to bring in space resource **stockpiles** (`WaterStockpile`, `VolatilesStockpile`, `MetalsStockpile`, `NobleMetalsStockpile`, `FissilesStockpile`, `ExoticsStockpile`) alongside per-day income when judging immediate fleet/upgrade capacity |
| Space & Mining Tech Comparison | `Again_Factions_Core.csv`, `Again_Techs_Global.csv`, `Again_HabSites.csv`, `Again_Faction_HabIncome.csv`, `Again_<Short>_Projects.csv` via `Get-TIFactionTechMatrix` | Contrast tech progress and hab opportunities, including per-faction **mining income**, **stockpiles vs per-day flow**, and **which factions have actually finished which key techs/projects** (e.g., fusion, antimatter, advanced drives) |
| Current Open Decisions | Synthesized from all above | Translate data into actionable priorities |
| Terra Invicta Action Plan & Earth-Side Plan | `Again_Resistance_Nations.csv`, `Again_Factions_Core.csv`, `Again_Faction_EarthSummary.csv` | Align strategic steps with nation stats and overall Earth control |
| Council Operations & Turn Plans | `Again_Resistance_Councilors.csv`, `Again_Councilor_Recruits.csv` | Map stats to mission plans |
| Space Program Strategy | `Again_Factions_Core.csv`, `Again_HabSites.csv`, `Again_Aliens_Habs.csv` | Plan LEO/Luna/Mars phases |
| Research & Technology Priorities | `Again_Techs_Global.csv`, `Again_Resistance_Projects.csv`, `Get-TIResistanceResearchSummary`, `Get-TIFactionTechMatrix` | List completed and in-progress techs, with a dedicated Resistance-focused summary (finished vs in-progress, selector status) and a **cross-faction True/False matrix** showing which factions have finished which high-impact techs/projects |
| Mid-Term Goals | All CSVs + prior dated summaries | Tie medium-term objectives to metrics |
| Hab Sites Situation | `Again_HabSites.csv`, `Again_Aliens_Habs.csv`, `Again_Faction_HabIncome.csv` | Detail available claims, alien holdings, and current space resource income |
| Biggest Changes Since Last Snapshot | Compare current CSVs vs prior dated summary | Note deltas per faction, hab, or tech |

**🔄 REGENERATION REQUIREMENT:** All above sections must be rebuilt using latest CSV data with strategic analysis and AI opinion included.

---

# Terra Invicta Campaign Context

---

## 📌 Campaign Overview

> **AI instruction:** In each dated `summary_YYYYMMDD.md`, use the snippet pack to build a late-game overview that combines **Power Ranking (Weighted Earth/Space/Tech)**, **Alien Hate by Faction**, and the **Human Faction Hate Matrix**. Under the Campaign Context heading, you should:
> - Show the Power Ranking table for all human factions plus the Aliens.
> - Show the Alien Hate by Faction table.
> - Show the full Human Faction Hate Matrix table, using the exact numbers from the snippet pack for the current date.
> - Add 1–3 short paragraphs interpreting these tables together (who the aliens hate most, which humans hate each other, and what that implies for likely proxy wars and safe buffers).

---

## 🌍 Current Nation Control (Resistance)

---

## 🧑‍🤝‍🧑 Councilors

---

## 🛰️ Global Faction Landscape

---

## 🧭 Other Factions’ Earth Control Patterns

---

## 🚀 Space Program & Solar System Status

---

## 1. 🤝 Faction Power Table (Current Save) {#section-1}

> **AI instruction:** Use toolbox outputs (`Get-TIFactionOverview`, `Get-TIFactionBoostAndSpaceSummary`, research snippets, and summary tables from `Get-TISnippetPackMarkdown`, including the **Tech Completion Matrix (By Faction)** and **Alien Hate by Faction**) to build a **Markdown Faction Power table and narrative**. The section **must** include:
> - A **Markdown table** that ranks **every human faction plus the Aliens** (no omissions) with, at minimum: CPs, `TotalGDP`, hab count, key resource income (metals/fissiles per day), and a short resources/alien-hate summary for each row.
> - A **detailed narrative** explaining why each faction is placed where it is, combining **Earth power** (CPs, GDP), **space economy** (site count, mining income, stockpiles), **research/tech position** (who actually has key drives/reactors/weapons per the matrix), and **alien hate**.
> - Explicit identification of which factions are the main threats vs. opportunities, including cases where a faction is technologically ahead/behind despite weaker GDP or habs.
> - Clear statements on how this ranking should change the Resistance’s short- and mid-term priorities.

---

## 2. ⛏️ Space & Mining Tech Comparison {#section-2}

> **AI instruction:** Combine toolbox space data (`Get-TISpaceSitrep`, Boost/space summary), `Again_Faction_HabIncome.csv`, the **Habs by Faction** table from the snippet pack, and per-faction hab tables. Do **not** just restate tables. Instead:
> - Compare factions’ current hab counts and **resource incomes**.
> - Use the **Habs by Faction** snippet and `Again_Resistance_Habs.csv`/`Again_HabSites.csv` to call out **specific Resistance sites** (e.g., Luna metals pits vs. Mars water/fissiles clusters) and how they stack up vs. rival holdings.
> - When naming rival habs or bodies, you may sample from `Get-TIFactionHabsOverview` or `Get-TIFactionHabs(<ShortName>)` to mention **1–3 important non-Resistance hab locations** each, but **do not** go into the same depth of per-site breakdown as for the Resistance.
> - Use the **Top Unclaimed Asteroid Belt Sites (by total output)** table (emitted by `Get-TISpaceSitrep`) when highlighting high-value belt opportunities, alongside Luna and Mars sites.
> - Where helpful, reference the **Faction Overview** snippet’s space resource **stockpiles** (metals, fissiles, nobles, exotics) to distinguish factions that can **surge fleets or absorb losses from existing reserves** from those that rely purely on current income.
> - Explain who is winning or losing the space race and why.
> - Connect current and upcoming techs to specific space goals (hab expansion, fleet tech, defenses).
> - Recommend **concrete tech and influence actions** (what to research, which global projects to contest).

---

## 3. 🧩 Current Open Decisions {#section-3}

> **AI instruction:** Turn all the current data (nations, councilors, habs, techs, Boost) into a **ranked list of 5–10 immediate decisions**. For each decision:
> - State the action (e.g., “Stabilize Mexico”, “Claim Arcadia Planitia”, “Contest Industrialization selector”).
> - Justify it with 1–3 specific metrics from the toolbox/CSVs.
> - Briefly outline risks and what happens if we delay or ignore it.

---

## 4. 🎯 Current Terra Invicta Action Plan {#section-4}

> **AI instruction:** Based on the Faction Power Table and Open Decisions, propose a **time-structured plan** (e.g., next 2–4 turns / next 3–6 months in-game). The plan should:
> - Group actions into short-term vs. medium-term.
> - Tie each cluster of actions to measured goals (e.g., target Boost income, hab count, GDP, tech milestones).
> - Include at least one **contingency path** if rivals or aliens move faster than expected.

---

## 5. 🌍 Earth-Side Plan {#section-5}

> **AI instruction:** Use `Get-TIResistanceNationsSnapshot` and other factions’ nation CSVs to write a **detailed Earth plan**. For key nations/regions:
> - Explain their current stats (Democracy, Cohesion, Unrest, GDP, BoostTotalEst) in plain language.
> - Recommend specific mission patterns (Public Campaign, Stabilize, Crackdown, Purge, Advise, Spoils).
> - Identify expansion targets, nations to defend, and nations to abandon or ignore for now.

---

## 6. 🧑‍⚖️ Council Operations {#section-6}

> **AI instruction:** Use `Get-TIResistanceCouncilorSummary` (roster + recruits) to write a **role-based plan** for the council. For each current councilor:
> - Summarize their strengths/weaknesses (stats + loyalty/security).
> - Propose primary and secondary mission roles.
> - Call out critical org/stat gaps the roster needs (e.g., more Admin, Security, Espionage).
> Also propose **recruitment priorities** and which recruits should be taken or skipped and why.

---

## 7. 🎯 Councilor 2-3 Turn Plans {#section-7}

> **AI instruction:** Turn the council operations into a **turn-by-turn assignment sketch**. For each councilor:
> - Suggest 2–3 concrete upcoming missions (e.g., “Turn 1: Stabilize Mexico; Turn 2: Crackdown Servant CP in UK”).
> - Tie those missions back to the data (nation unrest, Boost needs, tech race, hab threats).
> - Include at least one contingency action if something major changes (e.g., coup, alien terror mission).

---

## 8. 🚀 Space Program Strategy {#section-8}

> **AI instruction:** Use `Get-TISpaceSitrep`, Boost summary, the **Habs by Faction** snippet, `Again_Resistance_Habs.csv`, and (optionally) `Get-TIFactionHabsOverview` to design a **phased space plan** (LEO → Luna → Mars → beyond). The narrative should:
> - Identify which specific **Resistance sites on Luna and Mars** are highest priority and why (water, fissiles, metals, positional advantage), using concrete numbers from `Again_Resistance_Habs.csv` and `Again_HabSites.csv`.
> - Summarize the **Resistance MC & tier posture** from `Again_Resistance_Habs.csv` (total MC tied up in habs, number of bases vs. stations, tier mix) and explain how that constrains upgrades and new builds.
> - Optionally reference `Get-TIFactionHabsOverview` or `Get-TIFactionHabs(<ShortName>)` to name **a few key rival habs** that matter for planning (e.g., Servant fissiles stations, Initiative metals hubs), while keeping the **detailed, per-site breakdown focused on the Resistance**.
> - Explain how Boost income and stockpile constrain timing.
> - Recommend the order of habs, stations, and fleet investments, plus any “must-have” defensive techs.
> - Explicitly state **which 2–3 habs should be upgraded to higher tiers first** and which low-yield sites can stay at tier‑1 for now, based on their resources-per-MC.

---

## 9. 📈 Research & Technology Priorities {#section-9}

> **AI instruction:** Read `Again_Techs_Global.csv`, `Again_Resistance_Projects.csv`, and the **Resistance Research Summary** snippet (from `Get-TIResistanceResearchSummary`) and turn the tech situation into:
> - A ranked list of **global projects to influence** (with reasons and faction implications).
> - A prioritized list of **Resistance faction projects and techs** that align with the space and Earth plans.
> When setting priorities, explicitly tie at least **one or two tech choices** to improving **MC efficiency and hab upgrades** (e.g., techs that raise MC cap or reduce hab MC costs), using the current MC/tier posture from `Again_Resistance_Habs.csv` as justification.
> For each priority, explicitly state:
> - What metric or capability it improves (e.g., Boost, hab construction speed, ship tech, defenses, MC cap, hab MC cost).
> - Why it matters *now* in this specific save.

---

## 10. 🔭 Mid-Term Strategic Goals (2024-2026) {#section-10}

> **AI instruction:** Synthesize everything into **2–5 medium-term goals** (multi-year in-game). Each goal should:
> - Be measurable (e.g., “X habs by Y date”, “Control Z GDP”, “at least N fleets of type T”, “no more than Y MC tied up in tier‑1 habs”).
> - Be justified by current metrics and rival trajectories.
> - Include at least **one explicit MC/tier goal** for the Resistance (e.g., target MC cap, desired mix of tier‑2+ habs on key Mars sites) using `Again_Resistance_Habs.csv` as the baseline.
> - Include a short rationale of how it contributes to winning the campaign or avoiding failure states.

---

## 11. 🛖 Hab Sites Situation {#section-11}

> **AI instruction:** Use `Get-TISpaceSitrep`, `Again_HabSites.csv`, `Again_Faction_HabIncome.csv`, the **Habs by Faction** snippet, and (optionally) `Get-TIFactionHabsOverview` to write a **map-like overview** of current and potential habs. The section should:
> - Describe current human and alien holdings (who owns what and what it produces), with a **separate, concrete paragraph for Resistance habs** that lists their key Luna, Mars, and asteroid-belt sites (e.g., Ceres, Vesta, inner-belt asteroids), roles (metals hub, water+fissiles cluster, backup node), and yields.
> - Use `Get-TIFactionHabsOverview` or `Get-TIFactionHabs(<ShortName>)` if you need to name **a few important rival habs or bodies** for context, but keep the **detailed per-site listing primarily for the Resistance**.
> - Highlight the top unclaimed sites (Luna, Mars, key asteroids, and bodies returned by `Get-TITopUnclaimedBeltSites`) and why each is attractive.
> - Incorporate the **Top Unclaimed Asteroid Belt Sites (by total output)** table from `Get-TISpaceSitrep -TopBeltSites` when describing belt opportunities.
> - Recommend a **priority list of 3–5 sites** the Resistance should target next, with justification tied to resources and strategic position.
> - Ensure at least **3–4 specific Resistance sites** are named with numbers (WaterPerDay, MetalsPerDay, FissilesPerDay) taken directly from the snippet pack and/or `Again_HabSites.csv`.

---

## 12. 📢 Biggest Changes Since Last Snapshot {#section-12}

> **AI instruction:** If there is a prior dated summary, explicitly compare current data vs. the previous snapshot. List **5–10 specific changes**, such as:
> - New or lost nations, habs, and fleets.
> - Major shifts in **space resource income and stockpiles** (especially metals/fissiles) drawn from `Again_Faction_HabIncome.csv` and the **Faction Overview** snippet (e.g., who can now better absorb fleet losses or surge production).
> - Major shifts in BoostIncomeEstimate, CPs, GDP, or tech position.
> - Notable rival or alien moves.
> For each change, add 1–2 sentences on **why it matters** and how it should alter the plan going forward.
