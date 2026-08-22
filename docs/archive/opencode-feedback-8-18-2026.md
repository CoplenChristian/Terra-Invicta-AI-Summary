# v2 Application Feedback

**Review date:** 2026-08-18

## Scope and screenshots

This review was rerun against the current working tree after the source changed from the initial pass. The current captures are in:

` screenshots/v2-review/current-*.png`

The earlier numbered captures in the same directory show the older schematic-map implementation and should not be treated as the final current-state review.

Playwright was run against:

- desktop viewports at 1680px, 1320px, 1024px, and 900px;
- mobile viewports at 768px and 390px;
- Player Intel, Enhanced, and Omniscient modes;
- faction intelligence, intelligence library, priority detail, and responsive states.

## What is working well

- The visual system is cohesive: a dark command-console palette, strong card hierarchy, clear status colors, and a convincing executive-brief feel.
- The current GeoJSON map is a major improvement over the earlier schematic implementation. Playwright observed six theater groups, 177 country paths, and keyboard activation on map regions.
- Mode labels, visibility language, faction colors, and provenance labels build trust.
- The integrated intelligence library is substantially better than a simple modal. It provides useful faction, nation, space, research, threat, and export sections with a coherent mobile layout.
- Playwright found no console errors, page errors, or failed requests on the current local build.
- Responsive testing found no page-level horizontal overflow from 390px through 1680px. Mobile dialogs scroll internally instead of expanding outside the viewport.
- The new snapshot-identity and “Since Last Save” concepts are the right direction for detecting stale or mixed data.

## Highest-priority frontend issues

### 1. “Since Last Save” is currently a false negative

The current full-page screenshot shows:

> NO COMPARISON — No previous save is available.

That is incorrect: `/api/saves` contains many older files, including `Autosave2.gz`.

A direct delta test confirms the engine itself works:

- `snapshotDelta.build(previous, current, 4712)` returns `available: true`;
- it reports eight faction changes and nine resource changes.

The bug is the server wiring in `server/index.js:87-95`. It tries to read `rawSnapshot.previousRawSnapshot` after `intelligenceFilter.applyFilter()` has already returned a new filtered object. The previous raw snapshot must be filtered first, then both filtered datasets should be passed to the delta builder.

Once fixed, also address:

- `public/v2/js/mission-control.js:696` treats every positive delta as positive. Alien threat, hostile ships, and unrest need warning/danger polarity rather than green.
- `server/snapshotDelta.js:98-111` reports only executive-faction changes under “Political control.” Rename it to “Executive control” or compare all control-point ownership.
- Hide or collapse the “Since Last Save” panel when no comparison is available. In the current build it consumes a large full-width block for a one-line message.

### 2. The hosted static bundle is behind the local source

The current source and `dist` are materially out of sync:

- `public/v2/index.html:377-382` loads `executive-boards.js` and the new temporal panel.
- `dist/v2/index.html:344-348` does not include either.
- `dist/v2/js/components/` has no `executive-boards.js`.
- `dist/data/snapshot-player-4712.json:1` has no snapshot identity fields.
- `dist/v2/data/world.geojson` is missing, so the current map would fail in the hosted static fallback.

The current build script already knows about the new assets and identity (`scripts/build_static_snapshot.js:24-25,57-67,102-117`), but `dist` has not been rebuilt. Run `npm run build:site`, redeploy the generated assets, and add a build check to CI. Otherwise, the hosted site behaves like an older version of the app.

### 3. The HUD still says `Latest` when the save has a filename

`public/v2/js/mission-control.js:346-352` reads `meta.activeSaveFileName` and falls back to `Latest`. The snapshot metadata provides `metadata.fileName` (`server/snapshotBuilder.js:808-815`), and the current save is `Autosave.gz`. Use the actual filename or the snapshot identity. This is a small but important provenance bug.

### 4. Mobile starts with the map instead of the highest-value action

At widths below 900px, the grid becomes a vertical flex layout (`public/v2/css/mission-control.css:2828-2833`), but the DOM order places the entire left column before the KPI/priority columns (`public/v2/index.html:80-230`).

At 390px, the first screen is mostly:

- a large header and toolbar;
- the world map;
- the beginning of the theater list.

The primary brief, power score, and current directive are far below the fold. On mobile and tablet, consider:

- placing the KPI/priority block first;
- collapsing the map or theaters into a secondary section;
- adding a persistent “Jump to brief” action;
- adding a “back to top” control for the long directive stream.

The 390px header is approximately 311px tall, so compacting secondary HUD values would also recover useful screen space.

### 5. The real map is functionally useful but visually too dim

The map is directionally correct, but the current screenshot shows country status colors and labels as very small and dim. The SVG uses a 720-unit viewBox scaled to roughly 400–500px, so 7.5–9 SVG units often become only 4–5 CSS pixels.

The main areas to improve are:

- `public/v2/js/components/world-map.js:399-448`: increase inactive, hover, and selected fill opacity;
- `public/v2/js/components/world-map.js:400-406`: increase label and count font sizes;
- `public/v2/css/mission-control.css:2373-2482`: improve focus and selected-state contrast;
- add a stronger selected/hover state and a zoom/inspect interaction, or intentionally treat the map as supplemental to the theater list.

The theater list is already more legible than the map and should be the reliable interaction surface if the map remains small.

### 6. The library is good on desktop but not on mobile

The current mobile screenshot shows only the first columns of a horizontally scrolling table. The table still has an 840px minimum width (`public/v2/css/mission-control.css:1763-1773`, with the mobile override at `:1951-1953`).

For mobile, use:

- cards or stacked definition lists for factions, nations, and sites;
- a sticky first column with an explicit “Swipe for more columns” cue;
- search, sorting, and filters for 295 nations and 409 sites;
- a “showing X of Y records” indicator.

The desktop tables are well organized, but raw browse-all pages are not enough for a strategic workflow.

### 7. Several labels overpromise or underspecify the data

- `renderPowerTrajectoryChart` is now a current capability/power matrix, not a historical trajectory (`public/v2/js/mission-control.js:605-630`). Rename it to “Faction power dimensions” or add historical data.
- “Strategic holdings” is calculated as the five largest national economies (`public/v2/js/mission-control.js:732-749`). The screenshot includes China, the US, India, Europe, and Russia even though the Initiative does not control all of them. Rename it “Largest economies” or filter it to observer holdings, hostile targets, and contested nations.
- Faction balance needs an explicit “visible estimates only” label and a count of factions with known scores.
- Power score needs a short formula or tooltip; otherwise `46/100` looks like a trusted objective metric while it is partly an estimate.
- Resource values need clearer units, especially stock versus monthly production versus unavailable burn/runway.

### 8. Interaction and state behavior need hardening

- Refresh always reports success even if the response is not OK (`public/v2/js/mission-control.js:95-107`). Check `res.ok` and parse the error.
- Copy SITREP calls `navigator.clipboard.writeText()` without handling rejection or providing a fallback (`public/v2/js/mission-control.js:112-120`).
- Opening the library, navigating to Faction balance, closing it, and reopening resets to Overview (`public/v2/js/mission-control.js:173-178`; `public/v2/js/components/intelligence-library.js:445-459`). Preserve the selected section in component state or a URL hash.
- Mode and observer changes can race if clicked quickly. `state.isLoading` is defined but not used to cancel stale requests (`public/v2/js/mission-control.js:74-93,216-267`). Use an `AbortController` or request sequence check.
- The observer control should be covered by automated tests because selecting the wrong observer silently changes the entire dashboard.

### 9. Accessibility is mostly good, with a few important gaps

Positive findings:

- map theater groups are keyboard focusable;
- the priority brief is keyboard operable;
- detail and dossier modals have dialog semantics;
- native buttons are used throughout.

Remaining gaps:

- Dialogs do not trap focus or restore focus to the trigger (`public/v2/js/components/detail-panel.js:45-68`; modal handlers in `public/v2/js/mission-control.js:123-187`).
- The faction roster uses `role="listbox"` and `role="option"` but does not implement arrow-key navigation (`public/v2/js/components/faction-intel.js:219-244`).
- The donut and resource chart do not have a consistent accessible text alternative (`public/v2/js/mission-control.js:481-603`).
- Holding bubbles only use `title` and are not keyboard or screen-reader controls (`public/v2/js/mission-control.js:732-749`).
- `--text-dim` on `--surface-raised` is approximately 3.74:1, below the 4.5:1 normal-text contrast target in several places.

## Backend recommendations

### P0: Make publishing atomic

The publisher updates the campaign pointer before uploading snapshots:

1. campaign upsert: `scripts/push_latest_to_supabase.js:239-260`;
2. snapshot batch upload: `scripts/push_latest_to_supabase.js:263-288`.

If a later snapshot batch fails, the campaign can point to a save with incomplete or missing data. Prefer:

- uploading all snapshot rows first;
- validating their identities and sizes;
- updating the campaign pointer last;
- using a Supabase RPC or transaction where possible;
- retrying `429` and `5xx` responses with backoff;
- adding a publish timeout so a stuck child process cannot occupy the endpoint indefinitely.

### P0/P1: Fix local API exposure and validation

- `server/index.js:125-184` exposes publish without authentication and does not explicitly bind to `127.0.0.1` at `:305-313`. Bind to loopback for the local dashboard or add an explicit local authentication mechanism.
- `server/index.js:202-207` and `:283-286` directly join an arbitrary `save` query value to the save folder. Validate filenames, extensions, and that the resolved path remains inside the configured folder.
- Reject invalid observer and mode values rather than silently coercing them. Local and hosted mode normalization should share one validator.
- The local server logs `unhandledRejection` but continues running (`server/index.js:19-24`); use a controlled restart or fail-fast policy in production.

### P1: Move expensive parsing and hashing off the request path

The request pipeline still performs synchronous work:

- gzip, file read, and JSON parse: `server/saveParser.js:79-104`;
- full snapshot construction: `server/snapshotBuilder.js:9-840`;
- full-file hash: `server/snapshotIdentity.js:4-12`.

For a large save, this can block every local request. Consider a worker thread, asynchronous zlib, streaming JSON where practical, and caching derived snapshots rather than raw strings.

Also cache by a full fingerprint, not only `mtimeMs`. `server/index.js:33-52` currently uses mtime equality; a same-size rapid overwrite can otherwise leave stale data. Retain previous and derived snapshots by snapshot identity and observer/mode.

### P1: Shrink the API payload and add cache semantics

Current measurements:

- `/api/v2/briefing`: 702,573 bytes;
- nested `data`: 689,491 bytes;
- `/v2/data/world.geojson`: 252,487 bytes.

The browser needs a briefing and compact dashboard data, not necessarily every nation, councilor, hab, and fleet in the initial request.

Recommended API split:

- `GET /api/v2/briefing` returns compact executive data;
- focused `/api/intel/{factions,nations,councilors,space,...}` endpoints return one dataset;
- the library loads detailed datasets lazily;
- gzip or Brotli is enabled;
- ETags and `Cache-Control` are keyed by campaign, save, observer, and mode;
- simultaneous mode/observer requests are coalesced.

The hosted worker already has shallow resource endpoints (`site/worker/index.js:470-560`), but local Express does not expose equivalent routes, so local and hosted contracts are not yet aligned.

### P1: Unify mode behavior

Local runtime advertises `player`, `enhanced`, and `omniscient` (`server/index.js:109-119`). Hosted runtime advertises only `player` and `omniscient` (`site/worker/index.js:599-608`) and maps anything other than exact `omniscient` to player. Either publish and support Enhanced on hosted, or remove and hide Enhanced consistently. Silently returning Player data for an Enhanced request is dangerous.

### P1: Guard arithmetic and fallback logic

- `server/snapshotBuilder.js:623-624` can add `null` combat power into totals.
- `server/exportGenerator.js:105-116` can also produce invalid totals when combat power is unavailable.
- `server/intelligenceFilter.js:9` contains a fallback reference to `rawSnapshot.faction[0]`; it should be `rawSnapshot.factions[0]`.
- Add centralized null-safe numeric helpers and assertions around critical derived values.

### P2: Add operational safeguards

- Add retries with jitter for Supabase `429` and `5xx` responses.
- Add structured logs with request IDs, snapshot IDs, mode, observer, parse/build/publish timings, and payload sizes.
- Add retention or cleanup for historical snapshot rows.
- Add tests for identity/delta wiring, mode contracts, stale-save behavior, and path validation.
- Add `lint`, `typecheck`, and `test` scripts; none are currently declared in `package.json:4-10`.
- Add scoped CORS handling and security headers to the hosted worker. It currently returns `access-control-allow-origin: *` (`site/worker/index.js:60-68`) and does not handle preflight requests.

Public Omniscient access is an intentional product decision in the current migration (`supabase/migrations/20260817000001_allow_public_omniscient_snapshots.sql:18-32`). Keep it explicit. If campaign data is sensitive, use private campaigns or token-gated access rather than relying on UI labels.

## Recommended order of work

1. Fix the “Since Last Save” wiring and polarity/label semantics.
2. Rebuild and deploy `dist`; verify hosted fallback identity, GeoJSON, and executive boards.
3. Fix `SAVE: Latest`, mobile hierarchy, and map readability.
4. Add mobile library cards, search, and filter behavior.
5. Implement compact API responses, compression, ETags, and mode parity.
6. Add dialog focus management, chart alternatives, and automated accessibility/contract tests.
7. Make publishing transactional and validate the local publisher endpoint.

## Validation performed

- Current Playwright run: no console errors, page errors, or failed requests.
- Responsive page audit: no page-level horizontal overflow from 390px through 1680px.
- Map audit: six theater regions and 177 country paths.
- Keyboard map activation successfully opened a theater detail panel.
- Mobile dossier and library dialogs use internal scrolling.
- Current local briefing response: approximately 702 KB.
- Current world GeoJSON asset: approximately 247 KB.
- Current publish dry run: 16 snapshots prepared, 8 factions × Player/Omniscient, with no network writes.
- `node --check` passed for the current server, worker, parser, snapshot, frontend, and publisher files reviewed.
- No lint, typecheck, or test scripts are currently defined.

No application source code was modified while preparing this review.
