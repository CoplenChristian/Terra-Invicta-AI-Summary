# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Existing Node/Express runtime with static dashboard at `public/v2/`. POC surfaces ship as self-contained HTML in `public/v2/` with inline CSS and mocked data.

## Users

Terra Invicta players running the Initiative (observer faction 4712) who need a campaign intelligence briefing between turns. Secondary consumers are LLM agents reading markdown exports and JSON intel endpoints.

## Product Purpose

Parse the newest save, reduce it to a filtered snapshot for a chosen observer and visibility mode, and surface actionable strategic intelligence: councilor directives, alien threat, mining expansion, fleet posture, research queue, and theater defence.

## Positioning

Dual-audience intelligence: every figure must reach both the browser dashboard and the AI export surfaces. Player mode is a genuinely different code path (redacted hate, masked enemy attributes), not a cosmetic filter.

## Operating Context

Users play Terra Invicta locally, keep saves in a configured folder, and open the dashboard at `http://localhost:3000/v2/` between turns. Sessions are task-focused: scan priorities, verify threats, decide councilor assignments, check mining and fleet status. Information density and scanability matter more than marketing polish.

## Capabilities and Constraints

- Eight dashboard views: Command, Expansion, Fleet, Battle, Drives, Threat, Records, Designer
- Three intel modes: player (default), enhanced, omniscient
- Directive engine with ranked recommendations and rule explanations
- Alien hate meter with total-war threshold semantics
- Absent values stay null — never fabricate or coerce to zero
- Save objects use `ID` and `displayName`, not `id`/`name`
- Faction logos in `public/v2/assets/faction-logos/` (game art, do not redistribute standalone)

## Brand Commitments

- Product name: Terra Invicta Intel
- Faction identity: The Initiative (observer 4712)
- Tone: quiet operations brief — clear hierarchy, measured color, useful density
- Incumbent v2 palette: teal accent on charcoal (`--accent: #69c5b8`, `--canvas: #081011`)

## Evidence on Hand

- Live dashboard: `public/v2/index.html` and 26 CSS modules
- Committed intel fixtures: `tests/fixtures/snapshot-*-intel.json`
- README and CLAUDE.md document API surface and operational rules
- POC uses synthetic mocked data labeled as such; no live save required

## Product Principles

1. Verify in both player and omniscient modes — features that only work omniscient are defects.
2. Honest unavailable states beat confident zeros or mock content that looks real.
3. New calculations must reach markdown exports, intel registry, code index, and docs tracker.
4. Order and completeness in rule explanations are load-bearing — do not silently truncate.
5. The dashboard serves agents as much as humans.

## Accessibility & Inclusion

WCAG AA contrast on metadata text against surfaces. Keyboard focus on interactive controls. Player-mode redaction must be visually distinct (not confused with missing data bugs).
