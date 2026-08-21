/*
 * Mission Control Budget Planner
 * ------------------------------
 * Purpose: the Mission Control budget planner — MC is the sole input to the
 *   alien minimum-hate floor, so its allocation is shown and budgeted.
 * Mission Control is the sole input to the alien minimum-hate floor, so every
 * build decision is also a diplomacy decision. The hate card states where we
 * are; this states what a planned fleet would do to it.
 *
 * Two ceilings matter and they are not the same:
 *   - MC capacity: hard build limit.
 *   - MC war floor: used MC at which the minimum hate floor reaches 50 and
 *     peace with the aliens becomes impossible.
 * Whichever is lower is the real constraint, and it is often the capacity.
 */
(function exposeMcBudget(global) {
  'use strict';

  const shared = global.MissionControlShared || {};
  const escapeHtml = shared.escapeHtml || (value => String(value ?? ''));

  const state = { staged: {} };

  function num(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function fmt(value, decimals = 1) {
    const parsed = num(value);
    return parsed === null ? 'UNAVAILABLE' : parsed.toFixed(decimals);
  }

  // Hulls worth planning around. Anything the save exposes is offered, but
  // these lead because they are the line-combat decisions.
  const HULL_ORDER = [
    'Escort', 'Frigate', 'Monitor', 'Destroyer',
    'Cruiser', 'Battlecruiser', 'Battleship', 'Lancer'
  ];

  function orderedHulls(hullStats) {
    const known = Object.keys(hullStats || {});
    const lead = HULL_ORDER.filter(name => known.includes(name));
    return lead.length ? lead : known.slice(0, 8);
  }

  function render(root, payload) {
    if (!root) return;
    const economics = payload && payload.economics;
    const hullStats = (payload && payload.shipHullStats) || {};

    if (!economics || !economics.applicable) {
      root.innerHTML = '<div class="alien-hate-econ-empty">MC BUDGET UNAVAILABLE</div>';
      return;
    }

    const used = num(economics.usedMissionControl);
    const cap = num(economics.missionControlCapacity);
    const warFloor = num(economics.mcWarFloor);
    const multiplier = (num(economics.difficultyMultiplier) || 0)
      * (num(economics.concealmentMultiplier) || 1);

    const hulls = orderedHulls(hullStats);
    const stagedMc = hulls.reduce((total, hull) => {
      const count = num(state.staged[hull]) || 0;
      const perHull = num(hullStats[hull] && hullStats[hull].missionControl);
      return total + (perHull === null ? 0 : perHull * count);
    }, 0);
    const stagedShips = hulls.reduce((total, hull) => total + (num(state.staged[hull]) || 0), 0);

    const projectedUsed = used === null ? null : used + stagedMc;
    const projectedFloor = projectedUsed === null ? null : projectedUsed * multiplier;

    // The binding constraint is whichever ceiling is crossed first.
    const capExceeded = cap !== null && projectedUsed !== null && projectedUsed > cap;
    const warExceeded = warFloor !== null && projectedUsed !== null && projectedUsed > warFloor;
    let verdict = { label: 'WITHIN BUDGET', tone: 'is-safe', note: '' };
    if (capExceeded && warExceeded) {
      verdict = { label: 'EXCEEDS BOTH CEILINGS', tone: 'is-danger',
        note: 'This fleet cannot be built and would guarantee permanent alien war.' };
    } else if (capExceeded) {
      verdict = { label: 'EXCEEDS MC CAPACITY', tone: 'is-danger',
        note: 'Capacity binds before the hate floor does. Raise MC capacity or cut the build.' };
    } else if (warExceeded) {
      verdict = { label: 'CROSSES PERMANENT-WAR FLOOR', tone: 'is-danger',
        note: 'Used MC would push the minimum hate floor past 50 — peace becomes impossible.' };
    } else if (stagedShips > 0) {
      verdict = { label: 'WITHIN BUDGET', tone: 'is-safe',
        note: `${stagedShips} ship(s) · +${stagedMc} MC · floor ${fmt(projectedFloor)}` };
    }

    const capHeadroom = cap !== null && used !== null ? cap - used : null;
    const warHeadroom = warFloor !== null && used !== null ? warFloor - used : null;

    root.innerHTML = `
      <div class="mc-budget">
        <div class="alien-hate-econ-statusbar">
          <div>
            <span class="alien-hate-econ-eyebrow">MISSION CONTROL BUDGET</span>
            <strong class="alien-hate-econ-status ${verdict.tone}">${escapeHtml(verdict.label)}</strong>
          </div>
          <div class="alien-hate-econ-war-status">
            <span>PROJECTED FLOOR</span>
            <strong>${escapeHtml(fmt(projectedFloor))}</strong>
          </div>
        </div>

        <div class="alien-hate-econ-mc-grid">
          <div class="alien-hate-econ-metric">
            <span>Used now</span><strong>${escapeHtml(fmt(used, 0))}</strong>
            <small>of ${escapeHtml(fmt(cap, 0))} capacity</small>
          </div>
          <div class="alien-hate-econ-metric">
            <span>Headroom to cap</span><strong>${escapeHtml(fmt(capHeadroom, 0))}</strong>
            <small>hard build limit</small>
          </div>
          <div class="alien-hate-econ-metric ${warHeadroom !== null && capHeadroom !== null && warHeadroom < capHeadroom ? 'is-emphasis' : ''}">
            <span>Headroom to war floor</span><strong>${escapeHtml(fmt(warHeadroom, 0))}</strong>
            <small>used MC at 50 hate</small>
          </div>
          <div class="alien-hate-econ-metric ${stagedMc > 0 ? 'is-emphasis' : ''}">
            <span>Staged build</span><strong>+${escapeHtml(String(stagedMc))}</strong>
            <small>${escapeHtml(String(stagedShips))} ship(s)</small>
          </div>
        </div>

        ${verdict.note ? `<p class="alien-hate-econ-note">${escapeHtml(verdict.note)}</p>` : ''}

        <div class="alien-hate-econ-section">
          <div class="alien-hate-econ-section-heading">
            <span>STAGE A BUILD</span>
            <small>PER-HULL MC FROM GAME TEMPLATES</small>
          </div>
          <div class="mc-budget-hulls">
            ${hulls.map(hull => {
              const stats = hullStats[hull] || {};
              const perHull = num(stats.missionControl);
              const count = num(state.staged[hull]) || 0;
              return `
                <div class="mc-budget-hull">
                  <span class="mc-budget-hull-name">${escapeHtml(hull)}</span>
                  <span class="mc-budget-hull-cost">${perHull === null ? '?' : escapeHtml(String(perHull))} MC${
                    stats.baseConstructionTimeDays ? ` · ${escapeHtml(String(stats.baseConstructionTimeDays))}d` : ''
                  }</span>
                  <span class="mc-budget-hull-controls">
                    <button type="button" data-mc-hull="${escapeHtml(hull)}" data-mc-step="-1" aria-label="Remove one ${escapeHtml(hull)}">−</button>
                    <output>${escapeHtml(String(count))}</output>
                    <button type="button" data-mc-hull="${escapeHtml(hull)}" data-mc-step="1" aria-label="Add one ${escapeHtml(hull)}">+</button>
                  </span>
                </div>
              `;
            }).join('')}
          </div>
          ${stagedShips > 0 ? '<button type="button" class="mc-budget-reset" data-mc-reset>CLEAR STAGED BUILD</button>' : ''}
        </div>

        <details class="alien-hate-econ-formula">
          <summary>WHY DOES BUILDING RAISE ALIEN HATE?</summary>
          <div class="alien-hate-econ-formula-body">
            <p>The alien minimum-hate floor is <code>used MC × difficulty × 0.8 per concealment project</code>. Only <strong>used</strong> Mission Control counts — capacity never does. Every hull consumes MC permanently while it exists, so fleet size sets a hate floor you cannot vent below.</p>
            <p>Mines compete for the same budget: past the mine limit (36, or 42 for Project Exodus) each excess mine adds <code>Max(1, Floor(excess² / 2))</code> MC.</p>
          </div>
        </details>
      </div>
    `;

    root.querySelectorAll('[data-mc-hull]').forEach(button => {
      button.addEventListener('click', () => {
        const hull = button.getAttribute('data-mc-hull');
        const step = Number(button.getAttribute('data-mc-step')) || 0;
        const next = Math.max(0, (num(state.staged[hull]) || 0) + step);
        state.staged[hull] = next;
        render(root, payload);
      });
    });
    const reset = root.querySelector('[data-mc-reset]');
    if (reset) {
      reset.addEventListener('click', () => {
        state.staged = {};
        render(root, payload);
      });
    }
  }

  global.MissionControlMcBudget = { render };
})(window);
