# Terra Invicta Strategic Intelligence & Mission Control: Full System Review & Visual Analysis

**Date:** August 18, 2026  
**Audience:** Codex, Engineering Team, Product Lead  
**Scope:** Backend Ingestion & Gating Pipeline, Classic Dashboard (`/`), Initiative Big-Screen Command Center (`/v2`), Cloud Architecture, and Visual/UX Analysis with Production Screenshots.

---

## 1. Executive Summary

Over successive iterations, the **Terra Invicta AI Summary** platform has evolved from a standalone Python/PowerShell CLI parser into a production-grade, multi-runtime strategic intelligence suite. 

The system now provides:
1. **A Technology-Gated Backend Pipeline:** Dynamic 2-gate intelligence engine that enforces in-game technology/story progression (`Player Intel` vs `Enhanced` vs `Omniscient`) across saves without leaking unearned telemetry.
2. **A Dual-Runtime Cloud Architecture:** Runs completely offline via local file-backed Express (`server/index.js`) while maintaining an authenticated local publisher (`scripts/push_latest_to_supabase.js`) and public serverless Edge Worker (`site/worker/index.js`) for hosted deployment.
3. **A Comprehensive Classic Dashboard (`/`):** Deep tabular and card-based analytics covering Strategic Balance, Earth Operations, Space Mining, Faction Intel, Tech Trees, AI Exports, and a newly implemented dedicated Councilors intelligence screen with interactive Biographical Dossiers.
4. **The Initiative Big-Screen Command Center (`/v2`):** An immersive, high-tech war room data visualization modeled after corporate syndicate command centers—featuring 3D holographic command dials, interactive geopolitical infiltration maps, space mining resource flow curves, operative leaderboards, and synthesized actionable directives.

---

## 2. Architecture & Pipeline Review

```mermaid
graph TD
    Save[.gz / .json Save Files] --> SP[saveParser.js]
    Templates[Game Templates / StreamingAssets] --> TL[templateLoader.js]
    
    SP --> SB[snapshotBuilder.js]
    TL --> CR[capabilityResolver.js]
    
    SB --> IF[intelligenceFilter.js]
    CR --> IF
    
    IF --> |Player Intel / Enhanced / Omniscient| API[Express Local API /server]
    IF --> |SITREP & Directives Engine| BG[briefingGenerator.js]
    
    API --> UI1[Classic Dashboard / (app.js)]
    BG --> UI2[Initiative Command Center /v2 (mission-control.js)]
    
    API --> Pub[push_latest_to_supabase.js]
    Pub --> Supa[(Supabase Cloud Database)]
    Supa --> Worker[Cloudflare Edge Worker (site/worker)]
    Worker --> ChatGPT[ChatGPT / Public Analysis View]
```

### Backend Pipeline Components

| Module | Core Responsibility | Key Implementation Details |
| :--- | :--- | :--- |
| `saveParser.js` | Save Ingestion & Decompression | Stream decompression of `.gz` saves using native `zlib`; automatic newest-save discovery (`-Latest` convention); fallback JSON parsing. |
| `templateLoader.js` | Game Template Effect Validation | Reads official game templates from Steam `StreamingAssets/Templates` (`TICapabilityTemplate`, `TITechTemplate`, `TIProjectTemplate`, `TIEffectTemplate`) to validate tech effects dynamically. |
| `snapshotBuilder.js` | Relational Entity Extraction | Maps raw save arrays into rich domain models: Factions, Control Points, Councilors (with active missions, targets, org tiers, and traits), Space Habs, Fleets, Mining Sites, and Alien Xenoforming. |
| `capabilityResolver.js` | Tech Tree Capability Gating | Resolves completed observer projects into operational capabilities (`canEstimateAlienThreat`, `canDetectAbductions`, `canDetectAlienMovements`, `canDetectDeepSkywatch`). |
| `intelligenceFilter.js` | Fog-of-War Enforcement | Evaluates the 2-gate verification model; masks/redacts unearned telemetry server-side in `Player Intel` mode before returning JSON to clients. |
| `opportunityScorer.js` | Strategic Target Scoring | Evaluates hostile Servant strongholds based on GDP, unrest, executive control, and nuclear arsenals to generate high-value Crackdown/Purge targets. |
| `briefingGenerator.js` | Narrative SITREP Synthesis | Transforms raw metrics into natural, authoritative military/corporate briefing statements, DEFCON ratings, and department directives for `/v2`. |
| `server/index.js` | Local Express Server | Serves static assets, local `/api` routes, memory caching on file `mtimeMs`, and triggers local save publishing. |
| `site/worker/index.js` | Cloudflare Edge Worker | Edge runtime querying Supabase REST endpoints with public/anon keys; falls back to bundled static assets; rejects administrative write actions. |

---

## 3. Visual & UX Analysis of Production Frontend

### Part I: The Initiative Big-Screen Command Center (`/v2`)

The `/v2` interface was redesigned to provide a visual "Big Screen Data Visualization" war room tailored specifically to **The Initiative's** corporate syndicate identity:

![Initiative Big-Screen Command Center](C:/Users/cople/.gemini/antigravity/brain/3dd89b25-c8a5-4aa7-8aac-edb34ec8ec64/screenshot_v2_initiative_bigscreen.png)

#### Visual & UX Assessment:
1. **Hero KPI Banner (Top Center):**
   - Four high-contrast, glowing neon telemetry counters:
     - **Corporate Treasury:** `$25,535` in neon magenta (`#ff007f`) with Boost and Operations flow.
     - **Terrestrial GDP:** `$39.4T` in neon gold (`#ffd700`) spanning 21 Control Points across 6 nations.
     - **Global Research:** `1,628 pts/mo` in neon cyan (`#00f0ff`) with project completion tallies.
     - **Strategic Power Index:** `46 / 100` in neon emerald (`#00ff88`), ranked `#1` globally.
   - *Analysis:* Immediate high-level situational awareness; distinct color coding allows instant cognitive scanning without visual noise.

2. **Holographic Strategic Command Core (Center Stage):**
   - Replicates the circular holographic projector aesthetic from the reference design.
   - Features 3D rotating orbital rings highlighting the **#1 Priority Directive** (*Authorize Operation 'Severance' in Japan*).
   - Surrounding it are 5 interactive tactical node pills: `01 Geopolitics ($39.4T)`, `02 Operatives (5 Active)`, `03 Space Network (18 Habs)`, `04 Global R&D (Leading)`, and `05 Alien Containment (DEFCON 2)`.

3. **Space Mining Logistics & Resource Flow (Center Bottom):**
   - Multi-resource combo bar and glowing peak curve tracking daily off-world mining yields for **Water (522)**, **Volatiles (4,640)**, **Base Metals (5,034)**, **Noble Metals (2,218)**, and **Fissiles (222)**.
   - *Analysis:* Solves the common Terra Invicta space logistics bottleneck by immediately surfacing daily stockpile generation rates.

4. **Geopolitical Sectors Map & Faction Donut (Left Column):**
   - Interactive SVG tactical world map with glowing sector nodes.
   - Real-time regional status chips showing contested status, Servant executive infiltration, and regional GDP.
   - Multi-color glowing donut visualizing global power distribution across all major factions.

5. **Power Trajectory, Leaderboards & Bubble Matrix (Right Column):**
   - **Power Trajectory:** Glowing area curve showing the Initiative's multi-cycle power score trajectory against the Servants and Resistance.
   - **Dual Asset Rings:** Visualizes Terrestrial vs Space Asset capitalization (82% Earth / 55% Orbital).
   - **Operative Leaderboard:** Horizontal glowing progress bars ranking councilors by Total Skills with their active mission and location.
   - **Holdings Matrix:** GDP-scaled bubble cluster providing an intuitive visual hierarchy of national wealth.

---

### Part II: Executive SITREP & Actionable Directives Stream (`/v2`)

![Executive Directives Stream](C:/Users/cople/.gemini/antigravity/brain/3dd89b25-c8a5-4aa7-8aac-edb34ec8ec64/screenshot_v2_directives_stream.png)

#### Visual & UX Assessment:
- **Actionable Tactical Orders:** Replaces passive metrics with clear, explicit directives:
  - `CRITICAL Authorize Operation 'Severance' in Japan:` Flags Servant control in Tokyo ($5.59T GDP) and specifies the operational requirement (*Deploy high-Espionage operative to execute Crackdown on executive point, followed by Purge*).
  - `HIGH Containment Sweep in Brazil:` Identifies popular support shifting opportunities.
  - `CRITICAL Exploit Embedded Asset 'Roger Sales' (the Servants):` Surfaces active intelligence from turned moles.
- **1-Click Export:** `📋 Copy Briefing` button copies the formatted war room SITREP directly to the clipboard for external analysis.

---

### Part III: Dedicated Councilors Interface (Classic Dashboard)

The councilors interface provides deep tactical and biographical dossiers for all discovered agents:

![Councilors Cards View](C:/Users/cople/.gemini/antigravity/brain/3dd89b25-c8a5-4aa7-8aac-edb34ec8ec64/screenshot_councilors_cards.png)

![Councilors Table View](C:/Users/cople/.gemini/antigravity/brain/3dd89b25-c8a5-4aa7-8aac-edb34ec8ec64/screenshot_councilors_table.png)

#### Visual & UX Assessment:
1. **Cards vs. Table View Toggle:**
   - **Cards View:** Displays councilor cards bordered by faction colors, showing location chips (`📍 Cuiabá`), active missions with targets (`🎯 Sabotage Facilities`), full 8-skill grid (`ADM`, `PER`, `INV`, `ESP`, `CMD`, `SCI`, `SEC`, `LOY`), total skill sums, traits, and assigned organizations with star tiers ($★$, $★★$, $★★★$).
   - **Skills Table View:** High-density sortable table allowing 1-click sorting by any individual attribute, total skills, location, or faction.
2. **Filtering Capabilities:**
   - Instant search across names, locations, missions, traits, and orgs.
   - Dedicated dropdowns for Faction, Profession, and Status (`All`, `Active`, `Turned Moles`, `Own Council`, `Alien Operatives`).

---

### Part IV: Interactive Councilor Dossier Modal

Clicking any councilor card or table row triggers their deep Biographical & Tactical Dossier:

![Councilor Dossier Modal](C:/Users/cople/.gemini/antigravity/brain/3dd89b25-c8a5-4aa7-8aac-edb34ec8ec64/screenshot_councilor_modal.png)

#### Visual & UX Assessment:
- **0–25 Scale Skill Progress Bars:** Accurately visualizes attributes with distinct color coding (Cyan for ADM, Yellow for PER, Blue for INV, Magenta for ESP, Red for CMD, Green for SCI, Orange for SEC, Slate for LOY).
- **Organization Breakdown:** Lists assigned orgs with star tiers, stat bonuses (e.g. `+3 ESP, +1 SEC`), and monthly income contributions (`+2 Ops/mo`).
- **Intel Confidence Tag:** Clearly states whether intel is `CONFIRMED`, `PARTIAL`, or `ESTIMATED`.

---

### Part V: Strategic Balance, Earth Operations, and Tech Trees

![Strategic Balance Overview](C:/Users/cople/.gemini/antigravity/brain/3dd89b25-c8a5-4aa7-8aac-edb34ec8ec64/screenshot_overview.png)

![Earth Operations & Priority Targets](C:/Users/cople/.gemini/antigravity/brain/3dd89b25-c8a5-4aa7-8aac-edb34ec8ec64/screenshot_earth_targets.png)

![Technology Matrix & Gates](C:/Users/cople/.gemini/antigravity/brain/3dd89b25-c8a5-4aa7-8aac-edb34ec8ec64/screenshot_tech_matrix.png)

![AI Snapshot Export](C:/Users/cople/.gemini/antigravity/brain/3dd89b25-c8a5-4aa7-8aac-edb34ec8ec64/screenshot_export.png)

#### Visual & UX Assessment:
- **Strategic Balance:** Global faction rankings, GDP controlled, orbital assets, and fleet combat power.
- **Priority Targets:** Surfaces high-value Servant-controlled nations with vulnerability indexes, nuclear counts, and strategic scoring.
- **Tech Matrix:** Clearly differentiates researched technologies from active projects and maps them to operational intelligence unlocks.
- **AI Snapshot Export:** Generates clean, token-efficient Markdown snapshots formatted specifically for external LLM ingestion.

---

## 4. Key Strengths & Production Verification

1. **Strict Fog-of-War Enforcement:** Backend gating prevents client-side inspection vulnerabilities. In `Player Intel` mode, unearned metrics are completely omitted from API payloads.
2. **Zero-Error Test Suite:** Verified via headless Chromium/Edge browser test runs with 0 console errors, 0 unhandled promise rejections, and verified network requests across all routes.
3. **Decoupled Architecture:** Local mode has zero dependencies on Supabase or external networks; hosted mode runs securely with public/anon keys under RLS.
4. **Authentic In-Universe Crafting:** Both interfaces follow rigorous craft principles—high-contrast typography, semantic color coding, custom scrollbars, and purposeful layout density.

---

## 5. Recommendations for Future Development

1. **Direct Save Ingestion via File Drop in Browser:**
   - Allow users to drag-and-drop a `.gz` save file directly onto the local web interface to parse arbitrary saves without placing them in the saves folder.
2. **Interactive Councilor Order Queueing (Simulation Mode):**
   - Enable interactive assignment simulations on `/v2` to calculate estimated mission success percentages before executing turns in-game.
3. **Automated Turn-to-Turn Delta Visualizer:**
   - Enhance the timeline view to highlight exactly which control points flipped, which councilors were assassinated/detained, and which habs were founded between consecutive saves.

---

## 6. Summary Status

| Interface / Component | Route | Operational Status | Verification |
| :--- | :--- | :--- | :--- |
| **Initiative Command Center** | `/v2` | **Production Ready** | Verified (Headless Edge Test, 0 errors) |
| **Classic Dashboard** | `/` | **Production Ready** | Verified (Headless Edge Test, 0 errors) |
| **Councilors Intelligence** | `/#councilors` | **Production Ready** | Verified (Cards, Table & Modal Tested) |
| **Local Express Backend** | `:3000/api/*` | **Production Ready** | Verified (Local Ingestion & Gating) |
| **Hosted Supabase Publisher** | `scripts/push_*` | **Production Ready** | Verified (Live Upsert & RLS Check) |
| **Cloudflare Edge Worker** | `site/worker/` | **Production Ready** | Verified (Anon Read & Static Fallback) |
