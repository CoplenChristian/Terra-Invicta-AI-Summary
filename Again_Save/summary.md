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

1. **Export latest data:** Run `export_factions.ps1`.
2. **Populate sections:** Rebuild sections using current CSVs in `csv/` and `snippet_pack_YYYYMMDD.md`.
3. **Data Sources:**
   - **Snippet Pack:** Space Sitrep, Habs by Faction, Tech Matrix, Human Faction Hate Matrix, Alien Hate.
   - **CSVs:** `Again_Factions_Core.csv` (Global), `Again_Resistance_Nations.csv` (Earth), `Again_Resistance_Habs.csv` (MC/Tiers), `Again_Faction_HabIncome.csv` (Mining).

### 🧠 Game Stage Determination (CRITICAL)

**Before writing, determine the Game Stage:**
*   **EARLY:** Pre-Mars mining economy. **Focus:** Boost, Earth CPs, Probes.
*   **MID:** Mars/Ceres mines active and producing. Space economy established. **Focus:** MC, Mining Income (Metals/Fissiles), Defense, Tier 2/3 Habs. **Boost is secondary.**
*   **LATE:** Interplanetary war (Jupiter/Outer System presence) and advanced drives (Fusion/Antimatter). **Focus:** Exotics, Fleet Cap, Victory Conditions. **Boost is negligible.**

---

# Terra Invicta Campaign Context

## 📌 Campaign Overview
> **AI:** Combine Power Ranking, Alien Hate, and Human Hate Matrix. Interpret tensions and proxy war risks.

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
> **AI:** Rank all factions (Human+Alien).
> *   **Columns:** CPs, GDP, Habs, Mining Income, Alien Hate.
> *   **Tables (MANDATORY):** Embed the **Power Ranking (Weighted Earth/Space/Tech)**, **Faction Ship Power (Count & Combat Score)**, **Human Faction Hate Matrix**, and **Alien Hate by Faction** tables (from the snippet pack) **directly into this section** so the rankings and tensions are visible at a glance. **Do not rely on narrative alone; the raw tables must appear here.**
> *   **Narrative:** Explain rankings based on **Stage**.
>     *   *Early:* Weigh Earth Power/Boost high.
>     *   *Mid/Late:* Weigh Space Economy/Tech/Fleets high and make it explicit that the **Aliens remain the top overall power on Tech/Fleet potential even with zero Earth CPs**.

## 2. ⛏️ Space & Mining Tech Comparison {#section-2}
> **AI:** Compare habs and mining income.
> *   **Sources:** Space Sitrep, `Again_Faction_HabIncome.csv`.
> *   **Focus:**
>     *   *Early:* Who has the first mines?
>     *   *Mid/Late:* Who controls the Belt/Jovian system? Compare Stockpiles (War Chest) vs Income.
> *   **Action:** Recommend tech/claims to close gaps.

## 3. 🧩 Current Open Decisions {#section-3}
> **AI:** List 5-10 immediate priorities.
> *   **Format:** Action -> Justification (Metrics) -> Risk of Delay.
> *   **Context:** Prioritize based on Stage (e.g., "Save Boost" is only valid in Early game; "Build Fleet" is Mid/Late).

## 4. 🎯 Current Terra Invicta Action Plan {#section-4}
> **AI:** Time-structured plan (Short vs Medium term).
> *   **Goals:** Tie to specific metrics (GDP, MC, Resources).
> *   **Contingency:** One path if Aliens/Rivals surge.

## 5. 🌍 Earth-Side Plan {#section-5}
> **AI:** Detailed nation strategy using `Again_Resistance_Nations.csv`.
> *   **Analysis:** Stats (Unrest, Cohesion, GDP).
> *   **Actions:** Campaign, Stabilize, Purge, etc.

## 6. 🧑‍⚖️ Council Operations {#section-6}
> **AI:** Role-based plan from `Again_Resistance_Councilors.csv`.
> *   **Assess:** Strengths, weaknesses, missing orgs.
> *   **Recruit:** Identify top candidates from pool.

## 7. 🎯 Councilor 2-3 Turn Plans {#section-7}
> **AI:** Specific turn-by-turn missions.
> *   **Logic:** Tie missions to Earth Plan and urgent threats.

## 8. 🚀 Space Program Strategy {#section-8}
> **AI:** Phased space plan (LEO -> Mars -> Outer).
> *   **Sources:** `Again_Resistance_Habs.csv` (MC/Tiers), Space Sitrep.
> *   **Stage Logic:**
>     *   *Early:* Maximize Boost efficiency for first mines.
>     *   *Mid/Late:* **Ignore Boost.** Maximize Mining/MC efficiency. Upgrade key sites to Tier 2/3.
> *   **Specifics:** Name priority sites for expansion/upgrade.

## 9. 📈 Research & Technology Priorities {#section-9}
> **AI:** Ranked Global and Faction projects.
> *   **Sources:** Tech Matrix, `Again_Resistance_Projects.csv`.
> *   **Focus:**
>     *   *All Stages:* MC Efficiency (Command Centers, etc).
>     *   *Early:* Mining tech, Drives.
>     *   *Mid:* Weapons, Defenses, Tier 3 Habs.
>     *   *Late:* Victory Tech, Exotics.

## 10. 🔭 Mid-Term Strategic Goals (2024-2026) {#section-10}
> **AI:** 2-5 measurable goals (Multi-year).
> *   **Must Include:** One MC/Tier goal (e.g., "Upgrade Mars cluster to Tier 2").
> *   **Rationale:** How it advances the win condition.

## 11. 🛖 Hab Sites Situation {#section-11}
> **AI:** Map-like overview of solar system holdings.
> *   **Resistance:** Detailed list of key sites (Luna/Mars/Belt) + Yields.
> *   **Rivals:** High-level summary of strongholds.
> *   **Unclaimed:** Highlight top targets (use `Top Unclaimed Belt Sites`).

## 12. 📢 Biggest Changes Since Last Snapshot {#section-12}
> **AI:** If a previous dated summary exists (e.g., `summary_YYYYMMDD.md` in `Again_Save/summary/`), compare current vs previous data. If this is the **first** dated summary, instead highlight the most important current-state callouts and risks.
> *   **With previous summary:** Emphasize shifts in Income, Fleets, Territory, Research, and Alien/Human hate.
> *   **Without previous summary:** Emphasize the 5–10 most critical features of the present situation (major hab clusters, key Earth blocs, tech edge/gaps, alien posture) and why they define the campaign going forward.
