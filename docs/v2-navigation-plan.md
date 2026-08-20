# v2 Dashboard — Grouped View Navigation

Replace the single scrolling page with four named views reachable from the topbar.

Written 2026-08-20 against commit `1268db4`. Measurements are from the live dashboard, not inferred.

---

## 1. The problem

`public/v2/index.html:258` opens `<details class="init-records">` with the summary *"Supporting records — Logistics, ledgers, research, ful…"*. It has **no `open` attribute**, so it is collapsed on every page load. Eleven panels live inside it.

Measured in the browser on the live page:

| | `document.body.scrollHeight` | `#miningExpansion` y | reachable? |
| :-- | --: | --: | :-- |
| collapsed (default) | 2,871 | 8,963 | **no** |
| expanded | 11,857 | 8,963 | yes |

While collapsed the panel is at **312% of page height**. It renders correctly — 11,593 characters of HTML, 9 table rows, `display: block`, `offsetParent` non-null — and `scrollIntoView()` still cannot reach it.

**This is a recurring class, not a one-off.** Panels keep getting mounted inside the accordion and ship invisible:

- The per-councilor suggested actions — *"i thought we added a per councilor suggested action? I don't see that… that should be on the main dashboard screen."*
- The mining board — *"the mining panel went away?"* The mount element was added inside the accordion in `1268db4`.

An 11,857px page with a disclosure widget at the bottom is the wrong shape for this data. A bottom-anchored expander is not discoverable, and promoting individual panels into the main flow only postpones the next occurrence.

**Rejected approach:** promoting panels into the main scroll flow and rewriting the accordion summary. That work was started and abandoned; it is preserved in `git stash` (`abandoned: promote-panels-to-main-flow approach`) and should not be resumed.

---

## 2. The information architecture

Four views. The HUD stays pinned across all of them; it is campaign state, not view content.

```
[ HUD: date · faction · hate meter · power ]        <- always visible, never scrolls away

COMMAND | EXPANSION | THREAT | RECORDS | Faction intel | Intelligence library | System
```

| View | Panels | Mount ids |
| :-- | :-- | :-- |
| **COMMAND** (default) | Hold Ground directive, Council Orders, Directive Engine, Executive Brief & Directives | `councilOrders`, `directiveBoard`, `sitrepSummary`, `directivesStreamList`, `btnCopySitrep` |
| **EXPANSION** | Mining Expansion Board, MC Budget Planner, Wartime Logistics, Nation Action Queue | `miningExpansion`, `mcBudget`, `resourceFlowChart`, `holdingsBubbleMatrix` |
| **THREAT** | Alien Force Posture, Alien Hate Economics, Capability Matrix | `dualAssetRings`, `alienHateEconomics`, `powerTrajectoryChart` |
| **RECORDS** | Strategic Faction Ledger, Technology Watch | `factionDonutContainer`, `researchWatchlist` |

`Faction intel` and `Intelligence library` stay exactly as they are — separate full-screen overlays with their own buttons. Do not fold them into the view set.

The grouping principle: **COMMAND answers "what do I do this turn", EXPANSION "where do I grow", THREAT "what is coming", RECORDS "what happened".** When a new panel is added later, that question decides its view. Write this rule into a comment above the view registry so the next panel does not default to a hiding place.

---

## 3. Implementation

### Reuse what exists — do not invent a router

`mission-control.js:221` already has the view-toggle primitive:

```js
function setOverlayOpen(screen, open) {
  screen.hidden = !open;
  screen.toggleAttribute('inert', !open);
  screen.setAttribute('aria-hidden', open ? 'false' : 'true');
  window.MissionControlDetailPanel?.syncPageInert?.();
}
```

`#factionIntelScreen` and `#intelligenceLibraryScreen` (`index.html:406`, `:420`) already use it. The four views are the same pattern with a shared nav. Generalise `setOverlayOpen` into a view switcher rather than writing a second mechanism beside it.

`inert` on inactive views is **required**, not optional — without it, keyboard focus and screen readers walk through hidden panels. The existing code already gets this right in three places; match it.

### Steps

1. **Delete the `<details class="init-records">` wrapper.** Keep `.init-records__grid`'s layout CSS if the views reuse the grid; drop the summary, the disclosure, and the `mission-control.js:514` open/close `inert` toggle that serves it.
2. **Add the nav** to `.init-topbar-controls`, beside the existing Faction intel / Intelligence library buttons. Use `<button>` with `aria-pressed`, matching `.init-mode-btn`'s existing pattern — not links.
3. **Wrap each group** in `<section class="init-view" id="view-command">` etc., `hidden inert` on all but the default.
4. **Register views in one place** — an array of `{ id, label, panels[] }`. The nav, the sections, and the render dispatch all read from it. Three hand-maintained lists that can drift is the defect this repo already has in `shared/intelResources.mjs`; do not add a fourth.
5. **Hash routing.** `#/command`, `#/expansion`, `#/threat`, `#/records`. A refresh must return to the view you were on — this dashboard is refreshed constantly against a live save, and losing your place every time is worse than the accordion. Unknown or absent hash falls back to COMMAND. Handle `hashchange` so browser back/forward work.
6. **Render lifecycle.** Panels currently render on load. Decide deliberately between rendering all upfront and rendering on first activation, and say which in a comment. If lazy: a panel must render on activation *and* re-render on mode/observer change while active, or a stale panel will show another faction's data. That is a correctness bug, not a performance one.

### State that must survive a view switch

- Selected mode (`player` / `enhanced` / `omniscient`) and the mode caption
- Selected observer faction
- Loaded briefing payload — **switching views must not refetch.** One `loadData()` feeds all views.

---

## 4. Do not regress

- **The sticky header.** It was added specifically so *"i can scroll down to this component and refresh without having to scroll back up"*. Refresh must stay reachable from every view.
- **The `inert` overlay handling** in `detail-panel.js` — `syncPageInert()` queries `#factionIntelScreen`, `#intelligenceLibraryScreen`, `#mcDetailPanel`. Adding view sections changes what "the page" means for that query; update it so opening a modal still inerts the active view.
- **`scripts/build_static_snapshot.js`** derives the hosted asset manifest from the HTML shells' own `<script>`/`<link>` tags. It throws on a referenced file that does not exist. `npm run build:site` must still pass.
- **Both dashboards.** `public/index.html` is the legacy v1 view and is still served; this plan touches `/v2/` only.
- **A duplicate-menu report was never reproduced** (1 of everything in source, rendered DOM, both local servers, and hosted). This work rewrites the topbar — if duplicate nav elements appear, that older report is worth revisiting rather than treating as new.

---

## 5. Acceptance

Verify at `http://localhost:<port>/v2/` — **not** the root — in **both** player and omniscient mode, on a fresh load with nothing expanded:

- `document.getElementById('miningExpansion')` has a y offset **less than** `document.body.scrollHeight`, and `scrollIntoView()` moves it into the viewport. Report the measured numbers the way §1 does.
- The Hold Ground directive is reachable without expanding anything. It renders at the head of `directives.geopolitical` (`policyRank: 105`) with a detail block from `briefing.holdGround`.
- Every one of the eleven panels is reachable in at most **one** click from a fresh load.
- Switching views preserves mode and observer, and does **not** refetch.
- Reloading on `#/expansion` returns to EXPANSION.
- No `null` / `undefined` / `NaN` / `nulld` text anywhere in full-page `textContent`.
- Console clean; all network requests 200/304.
- No horizontal page scroll at desktop / tablet / mobile. Four nav items plus three existing buttons must not overflow the topbar on mobile — collapse to a menu there if needed, but the HUD stays visible.

A screenshot is preferred. If the environment cannot composite frames, a full-page `textContent` scan plus the measured geometry above is the substitute — say which was done.
