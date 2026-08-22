/*
 * Unlocked Technology Panel (RECORDS)
 * -----------------------------------
 * Purpose: renders the searchable list of the observer faction's unlocked
 * research projects in RECORDS, over the existing /api/intel/tech-search and
 * /api/intel/tech-tree endpoints.
 *
 * WHY THE PROJECT NAME LEADS EVERY ROW
 * ------------------------------------
 * Per docs/research-row-naming-spec.md, the project is what the player acts on
 * and searches for in game; the item is only what the project yields. The two
 * routinely differ beyond recognition -- Project_CopperheadMissileBay is named
 * "Hydrolox High Explosive Missiles" -- so the project name cannot be derived
 * from the item and must be read from the data. Searching "Copperhead" finding a
 * project with no "Copperhead" in its name is the whole point of this panel, so
 * when the match came from an unlocked item rather than the project name, the
 * matching item is marked to say why the row is here.
 *
 * WHERE THE TWO ENDPOINTS SPLIT
 * -----------------------------
 * Matching is the server's job and is NOT reimplemented here:
 *
 *   typed query   /api/intel/tech-search?q=  matches display names, internal
 *                 ids, unlock names and effect ids
 *   empty query   /api/intel/tech-tree       the whole graph, filtered by
 *                 `status` only -- a status filter, not a second search
 *
 * tech-search requires `q` (400 without it), which is why the default list
 * cannot come from it. Both read the same server-side graph, so the two agree.
 *
 * The graph response is ~570KB, so it is fetched on first RECORDS activation
 * rather than on page load -- see loadLazyViewPanels in mission-control.js.
 *
 * MODE
 * ----
 * This is the observer's OWN research. Verified 2026-08-21 against the live
 * save: player and omniscient return identical results (19 items for q=laser,
 * 165 completed of 750 projects in both), so the panel is not gated on
 * omniscient-only data and is fully available in player mode.
 */
(function initUnlockedTech(global) {
  'use strict';

  const shared = global.MissionControlShared || {};
  const escapeHtml = shared.escapeHtml || (value => String(value == null ? '' : value));

  // Rendering every match would put hundreds of rows in the DOM; the cap is
  // announced in the footer with both totals, never silently applied.
  const RENDER_CAP = 60;
  const DEBOUNCE_MS = 220;

  const state = {
    container: null,
    observer: null,
    mode: null,
    query: '',
    scope: 'unlocked',
    projects: null,      // full graph, cached per observer+mode
    results: null,       // current rows to render
    totalProjects: null,
    unlockedCount: null,
    status: 'idle',      // idle | loading | ready | error
    message: null,
    debounceTimer: null,
    requestSeq: 0
  };

  function isUnlocked(project) {
    return project && project.status === 'completed';
  }

  /**
   * Absent stays absent. A project whose cost the graph does not carry is
   * reported as unavailable, never as 0 -- `Number(null) === 0` is the most
   * repeated bug class in this repo.
   */
  function costLabel(project) {
    const cost = project ? project.researchCost : null;
    if (cost === null || cost === undefined || cost === '') return null;
    const numeric = Number(cost);
    if (!Number.isFinite(numeric)) return null;
    return `${numeric.toLocaleString('en-US')} pts`;
  }

  function statusLabel(project) {
    const status = project && typeof project.status === 'string' ? project.status : null;
    if (!status) return 'UNKNOWN';
    return status.toUpperCase();
  }

  function categoryLabel(project) {
    const category = project && typeof project.category === 'string' ? project.category.trim() : '';
    if (!category) return null;
    // "MilitaryScience" -> "MILITARY SCIENCE"
    return category.replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase();
  }

  function normalise(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/gi, '');
  }

  /**
   * Did this row surface because of an unlocked item rather than its own name?
   *
   * Only the DISPLAY name counts as self-explanatory. Testing the internal id
   * too was wrong and silently killed the panel's headline case: the id
   * `Project_CopperheadMissileBay` contains "Copperhead", so a search for
   * Copperhead was treated as a name match and the explanatory chip suppressed
   * -- leaving a row titled "Hydrolox High Explosive Missiles" with nothing
   * saying why it was there, which is precisely the confusion this exists to
   * resolve. The id is rendered, but in small mono beneath the title; the item
   * chip is what makes the match legible.
   */
  function matchingUnlocks(project, query) {
    const q = normalise(query);
    if (!q) return [];
    const unlocks = Array.isArray(project.unlocks) ? project.unlocks : [];
    if (normalise(project.displayName).includes(q)) return [];
    return unlocks.filter(u => normalise(u.displayName).includes(q));
  }

  async function fetchJson(url) {
    const response = await fetch(url);
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = payload && payload.error ? String(payload.error) : `HTTP ${response.status}`;
      throw new Error(detail);
    }
    return payload;
  }

  async function ensureGraph(observerId, mode) {
    if (state.projects && state.observer === observerId && state.mode === mode) return state.projects;
    const payload = await fetchJson(
      `/api/intel/tech-tree?observer=${encodeURIComponent(observerId)}&mode=${encodeURIComponent(mode)}&category=all&includeEffects=false`
    );
    const nodes = Array.isArray(payload && payload.nodes) ? payload.nodes : [];
    const projects = nodes.filter(node => node && node.type === 'faction_project');
    state.projects = projects;
    state.totalProjects = projects.length;
    state.unlockedCount = projects.filter(isUnlocked).length;
    return projects;
  }

  function sortByName(rows) {
    return rows.slice().sort((a, b) => String(a.displayName || a.id || '')
      .localeCompare(String(b.displayName || b.id || ''), 'en'));
  }

  function applyScope(rows) {
    return state.scope === 'unlocked' ? rows.filter(isUnlocked) : rows;
  }

  async function refresh() {
    const seq = ++state.requestSeq;
    state.status = 'loading';
    paint();

    try {
      const projects = await ensureGraph(state.observer, state.mode);
      const query = state.query.trim();

      let rows;
      if (!query) {
        rows = applyScope(projects);
      } else {
        // Matching stays on the server -- this panel never reimplements it.
        const payload = await fetchJson(
          `/api/intel/tech-search?observer=${encodeURIComponent(state.observer)}&mode=${encodeURIComponent(state.mode)}&q=${encodeURIComponent(query)}`
        );
        rows = applyScope(Array.isArray(payload && payload.items) ? payload.items : []);
      }

      if (seq !== state.requestSeq) return; // a newer keystroke already won
      state.results = sortByName(rows);
      state.status = 'ready';
      state.message = null;
    } catch (err) {
      if (seq !== state.requestSeq) return;
      state.status = 'error';
      state.results = null;
      state.message = err && err.message ? err.message : 'The technology index could not be read.';
    }
    paint();
  }

  function renderControls() {
    const scopeButton = (value, label, title) => `
      <button type="button" class="ut-scope-btn${state.scope === value ? ' is-active' : ''}"
        data-scope="${value}" aria-pressed="${state.scope === value ? 'true' : 'false'}"
        title="${escapeHtml(title)}">${escapeHtml(label)}</button>`;

    return `
      <div class="ut-controls">
        <label class="ut-search">
          <span class="ut-search__label">SEARCH</span>
          <input type="search" class="ut-input" id="unlockedTechQuery"
            placeholder="project, item or effect — try Copperhead"
            autocomplete="off" spellcheck="false"
            value="${escapeHtml(state.query)}"
            aria-label="Search unlocked technology by project, item or effect name">
        </label>
        <div class="ut-scope" role="group" aria-label="Which projects to list">
          ${scopeButton('unlocked', 'UNLOCKED', 'Only projects this faction has completed')}
          ${scopeButton('all', 'ALL', 'Every project in the tree, whatever its state')}
        </div>
      </div>`;
  }

  function renderRow(project) {
    const matched = matchingUnlocks(project, state.query);
    const matchedIds = new Set(matched.map(u => u.id));
    const unlocks = Array.isArray(project.unlocks) ? project.unlocks : [];
    const cost = costLabel(project);
    const category = categoryLabel(project);
    const unlockedRow = isUnlocked(project);

    // Only the item list is capped per row; the count beside it is the true one.
    const shownUnlocks = unlocks.slice(0, 6);
    const hiddenUnlocks = unlocks.length - shownUnlocks.length;

    return `
      <li class="ut-row${unlockedRow ? ' ut-row--unlocked' : ''}">
        <div class="ut-row__head">
          <span class="ut-row__project">${escapeHtml(project.displayName || project.id || 'Unnamed project')}</span>
          ${state.scope === 'all'
            ? `<span class="ut-status ut-status--${escapeHtml(String(project.status || 'unknown'))}">${escapeHtml(statusLabel(project))}</span>`
            : ''}
        </div>
        <div class="ut-row__meta">
          <code class="ut-id">${escapeHtml(project.id || '')}</code>
          ${category ? `<span class="ut-meta-item">${escapeHtml(category)}</span>` : ''}
          <span class="ut-meta-item">${cost === null
            ? '<span class="ut-unavailable">RESEARCH COST UNAVAILABLE</span>'
            : escapeHtml(cost)}</span>
          ${unlocks.length > 0
            ? `<span class="ut-meta-item">${unlocks.length} item${unlocks.length === 1 ? '' : 's'}</span>`
            : ''}
        </div>
        ${unlocks.length > 0 ? `
          <ul class="ut-unlocks">
            ${shownUnlocks.map(u => `
              <li class="ut-unlock${matchedIds.has(u.id) ? ' ut-unlock--matched' : ''}">
                ${escapeHtml(u.displayName || u.id || 'unnamed')}
                ${matchedIds.has(u.id) ? '<span class="ut-unlock__why">MATCHED</span>' : ''}
              </li>`).join('')}
            ${hiddenUnlocks > 0
              ? `<li class="ut-unlock ut-unlock--more">+${hiddenUnlocks} more of ${unlocks.length}</li>`
              : ''}
          </ul>` : ''}
      </li>`;
  }

  function renderBody() {
    if (state.status === 'error') {
      return `<div class="ut-notice ut-notice--error">The unlocked technology index is unavailable: ${escapeHtml(state.message || 'unknown reason')}</div>`;
    }
    if (state.status === 'loading' && !state.results) {
      return '<div class="ut-notice">Reading the research graph…</div>';
    }

    const rows = Array.isArray(state.results) ? state.results : [];
    const query = state.query.trim();

    if (rows.length === 0) {
      if (query) {
        return `<div class="ut-notice">Nothing ${state.scope === 'unlocked' ? 'unlocked ' : ''}matches “${escapeHtml(query)}”. ${
          state.scope === 'unlocked' ? 'Switch to ALL to search the projects this faction has not completed.' : ''
        }</div>`;
      }
      return '<div class="ut-notice">This faction has not completed any research projects yet.</div>';
    }

    const shown = rows.slice(0, RENDER_CAP);
    const omitted = rows.length - shown.length;

    return `
      <ul class="ut-list">${shown.map(renderRow).join('')}</ul>
      ${renderFooter(rows.length, shown.length, omitted)}`;
  }

  /** A cap announces itself, with both totals and the way to narrow the list. */
  function renderFooter(totalCount, shownCount, omittedCount) {
    const unlocked = state.unlockedCount;
    const total = state.totalProjects;
    const census = (unlocked === null || total === null)
      ? 'Project census unavailable.'
      : `${unlocked.toLocaleString('en-US')} unlocked of ${total.toLocaleString('en-US')} projects.`;

    return `
      <div class="ut-footer">
        <span>${escapeHtml(census)}</span>
        <span>${shownCount.toLocaleString('en-US')} shown of ${totalCount.toLocaleString('en-US')} matching${
          omittedCount > 0
            ? ` — ${omittedCount.toLocaleString('en-US')} omitted by the ${RENDER_CAP}-row display cap; narrow the search to see them`
            : ''
        }.</span>
      </div>`;
  }

  function paint() {
    if (!state.container) return;
    const active = document.activeElement;
    const hadFocus = active && active.id === 'unlockedTechQuery';
    const selectionStart = hadFocus ? active.selectionStart : null;

    state.container.innerHTML = `${renderControls()}${renderBody()}`;
    bind();

    if (hadFocus) {
      const input = state.container.querySelector('#unlockedTechQuery');
      if (input) {
        input.focus();
        if (selectionStart !== null) {
          try { input.setSelectionRange(selectionStart, selectionStart); } catch (_) { /* not selectable */ }
        }
      }
    }
  }

  function bind() {
    const input = state.container.querySelector('#unlockedTechQuery');
    if (input) {
      input.addEventListener('input', () => {
        state.query = input.value;
        if (state.debounceTimer) clearTimeout(state.debounceTimer);
        state.debounceTimer = setTimeout(refresh, DEBOUNCE_MS);
      });
    }
    state.container.querySelectorAll('.ut-scope-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const scope = btn.dataset.scope;
        if (!scope || scope === state.scope) return;
        state.scope = scope;
        refresh();
      });
    });
  }

  async function load(observerId, mode, container) {
    if (!container) return;
    const changed = state.observer !== observerId || state.mode !== mode;
    state.container = container;
    if (changed) {
      state.observer = observerId;
      state.mode = mode;
      state.projects = null;
      state.results = null;
      state.totalProjects = null;
      state.unlockedCount = null;
    }
    await refresh();
  }

  global.MissionControlUnlockedTech = { load };
})(window);
