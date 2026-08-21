/*
 * Council Orders
 * --------------
 * Purpose: renders the at-a-glance answer to "what should each councilor do
 *   this cycle".
 * The at-a-glance answer to "what should each councilor do this cycle".
 *
 * The full DIRECTIVE ENGINE card (components/directive-board.js) carries the
 * reasoning, budgets, clocks and benched alternatives, but it sits inside the
 * collapsed Supporting-records disclosure thousands of pixels down the page.
 * This panel renders one row per councilor high on the dashboard and links
 * back into that card for the detail; it deliberately does not repeat it.
 *
 * Reads briefing.engineDirectives.cyclePlan -- `assignments`, `unassigned` and
 * `unavailable` together cover every own councilor by the allocator's contract
 * (server/engine/assignment.js), so every councilor gets a row.
 *
 * Absent stays absent. `odds.chance` is null whenever the TIMissionTemplate is
 * not in the snapshot, and `expectedHate` is null whenever the outcome weights
 * that produce it are. Neither is coerced to a number here -- they render as
 * "ODDS UNAVAILABLE" and "unknown". A guaranteed mission is labelled
 * GUARANTEED rather than 100%, because `contested: false` is a rule of the
 * mission and a 100% is the top of a roll.
 */
(function exposeCouncilOrders(global) {
  'use strict';

  const shared = global.MissionControlShared || {};
  const escapeHtml = shared.escapeHtml || (value => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;'));

  function num(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  const FAMILY_LABEL = {
    expansion: 'EXPANSION',
    council: 'COUNCIL',
    intelligence: 'INTEL',
    intel: 'INTEL',
    security: 'SECURITY',
    space: 'SPACE',
    research: 'RESEARCH',
    defense: 'DEFENSE'
  };

  function missionLabel(candidate) {
    const c = candidate || {};
    const label = c.friendlyName || c.missionType || c.missionSpec?.friendlyName || c.title;
    return label ? String(label) : null;
  }

  /**
   * Targets arrive in two shapes: the directive engine's `{ kind, nation,
   * faction, controlPointType, councilorName }` and the mission generator's
   * `{ type, name, nation, councilor }`. The directive board reads only
   * `target.name || target.nation`, which is undefined/null for every
   * councilor- and capability-targeted candidate in the live plan, so those
   * rows all read "Designated Target". Both shapes are read here, and a target
   * that genuinely resolves to nothing says so rather than being named.
   */
  function targetLabel(candidate) {
    const t = (candidate && candidate.target) || {};
    const kind = t.kind || t.type || null;
    const councilorName = t.councilorName || t.name || t.councilor?.displayName || t.councilor?.name || null;
    const faction = t.faction || t.factionName || t.councilor?.factionName || null;
    const nation = t.nation || t.name || null;

    switch (kind) {
      case 'controlPoint':
        if (t.controlPointType && nation) return `${t.controlPointType} · ${nation}`;
        return nation || t.controlPointType || null;
      case 'councilor':
      case 'alienCouncilor':
        if (councilorName && faction) return `${councilorName} · ${faction}`;
        return councilorName || faction || null;
      case 'nation':
        return nation || null;
      case 'capability':
        return faction || nation || null;
      case 'none':
        return null;
      default:
        return t.name || t.nation || t.councilorName || t.faction || null;
    }
  }

  /**
   * `automatic`, `unavailable` and `roll` are three different readings and the
   * panel must not blur them. `point === 100` off a contested roll is a
   * rounding artefact of a 99.75% chance, not a guarantee, so it prints >99%.
   */
  function readOdds(odds) {
    if (odds && (odds.automatic === true || odds.isAutomatic === true)) {
      return { kind: 'automatic', basis: odds.basis || 'Mission is uncontested — it cannot fail.' };
    }
    const chance = typeof odds?.chance === 'number' ? odds.chance * 100 : null;
    const point = num(odds?.point ?? chance);
    if (point === null) {
      return {
        kind: 'unavailable',
        basis: odds?.basis || 'mission rules unavailable for this snapshot'
      };
    }
    const band = Array.isArray(odds?.band) && odds.band.length === 2
      ? [num(odds.band[0]), num(odds.band[1])]
      : [null, null];
    return {
      kind: 'roll',
      point: Math.round(point),
      band: (band[0] !== null && band[1] !== null) ? band : null,
      basis: odds?.basis || null
    };
  }

  function renderOddsCell(odds) {
    const reading = readOdds(odds);
    if (reading.kind === 'automatic') {
      return `<span class="council-orders__tag council-orders__tag--auto" title="${escapeHtml(reading.basis)}">GUARANTEED</span>`;
    }
    if (reading.kind === 'unavailable') {
      return `<span class="council-orders__tag council-orders__tag--unknown" title="${escapeHtml(reading.basis)}">ODDS UNAVAILABLE</span>`;
    }
    const pt = reading.point;
    let tone = 'council-orders__pct--good';
    if (pt < 50) tone = 'council-orders__pct--low';
    else if (pt < 75) tone = 'council-orders__pct--mid';
    const shown = pt >= 100 ? '&gt;99%' : `${pt}%`;
    const band = reading.band ? `<small>[${reading.band[0]}–${reading.band[1]}%]</small>` : '';
    const title = reading.basis ? ` title="${escapeHtml(reading.basis)}"` : '';
    return `<span class="council-orders__pct ${tone}"${title}><strong>${shown}</strong>${band}</span>`;
  }

  /**
   * `expectedHate` is an outcome-weighted sum and is null whenever the outcome
   * weights are. `Number(null)` is 0, and a mission whose hate cost was never
   * measured is not a mission that costs nothing.
   */
  function renderHateCell(expectedHate) {
    const hate = num(expectedHate);
    if (hate === null) {
      return '<span class="council-orders__hate council-orders__hate--unknown" title="Expected hate is an outcome-weighted sum; it is not computable without success odds.">unknown</span>';
    }
    if (hate === 0) {
      return '<span class="council-orders__hate">0 hate</span>';
    }
    const sign = hate > 0 ? '+' : '';
    return `<span class="council-orders__hate council-orders__hate--warn">${sign}${hate.toFixed(2)} hate</span>`;
  }

  function renderPerson(name, meta) {
    return `
      <div class="council-orders__who">
        <span class="council-orders__name">${escapeHtml(name || 'Councilor')}</span>
        ${meta ? `<span class="council-orders__meta">${escapeHtml(meta)}</span>` : ''}
      </div>`;
  }

  function personMeta(source) {
    const parts = [source?.profession, source?.location].filter(Boolean);
    return parts.length ? parts.join(' · ') : '';
  }

  function renderAssignmentRow(assignment, index) {
    const councilor = assignment.councilor || {};
    const candidate = assignment.candidate || {};
    const mission = missionLabel(candidate);
    const target = targetLabel(candidate);
    const family = String(candidate.family || '').toLowerCase();
    const familyLabel = FAMILY_LABEL[family] || (family ? family.toUpperCase() : '');

    return `
      <button type="button" class="council-orders__row council-orders__row--order"
        data-council-order-index="${index}"
        title="Open this assignment in the Directive Engine card">
        ${renderPerson(councilor.name, personMeta(councilor))}
        <div class="council-orders__order">
          <span class="council-orders__mission">
            ${escapeHtml(mission || 'Mission unnamed in this snapshot')}
            ${familyLabel ? `<span class="council-orders__family council-orders__family--${escapeHtml(family)}">${escapeHtml(familyLabel)}</span>` : ''}
          </span>
          <span class="council-orders__target">${target ? escapeHtml(target) : 'No fixed target'}</span>
        </div>
        <div class="council-orders__cell council-orders__cell--odds">${renderOddsCell(assignment.odds)}</div>
        <div class="council-orders__cell council-orders__cell--hate">${renderHateCell(assignment.expectedHate)}</div>
      </button>`;
  }

  function renderIdleRow(entry) {
    const councilor = entry.councilor || entry;
    const reason = entry.reasonDetail || entry.reason
      || 'No positive expected-value action matched this operative this cycle.';
    const free = entry.suggestedFreeAction || councilor.suggestedFreeAction || null;
    const alternates = Array.isArray(entry.freeActionOptions)
      ? entry.freeActionOptions.filter(option => option && option !== free)
      : [];

    return `
      <div class="council-orders__row council-orders__row--idle">
        ${renderPerson(councilor.name, personMeta(councilor))}
        <div class="council-orders__order council-orders__order--wide">
          <span class="council-orders__mission council-orders__mission--idle">No mission assigned</span>
          <span class="council-orders__reason">${escapeHtml(reason)}</span>
          ${free
            ? `<span class="council-orders__free">Free action: <strong>${escapeHtml(free)}</strong>${
                alternates.length ? ` <small>(or ${escapeHtml(alternates.join(', '))})</small>` : ''
              }</span>`
            : ''}
        </div>
      </div>`;
  }

  function renderUnavailableRow(entry) {
    const councilor = entry.councilor || entry;
    const reason = entry.reasonDetail || entry.reason || 'Holds no mission slot this cycle.';
    const status = entry.status || councilor.status || null;

    return `
      <div class="council-orders__row council-orders__row--out">
        ${renderPerson(councilor.name, personMeta(councilor))}
        <div class="council-orders__order council-orders__order--wide">
          <span class="council-orders__mission council-orders__mission--idle">
            No mission slot${status ? ` — ${escapeHtml(status)}` : ''}
          </span>
          <span class="council-orders__reason">${escapeHtml(reason)}</span>
        </div>
      </div>`;
  }

  function emptyState(message) {
    return `<div class="council-orders__empty">${escapeHtml(message)}</div>`;
  }

  /**
   * Rows are the compact view; the reasoning lives in the DIRECTIVE ENGINE
   * card. Clicking a row navigates to the Command view and scrolls
   * to the matching assignment card.
   */
  function focusDirectiveBoard(index) {
    if (window.MissionControlViews?.setActiveView) {
      window.MissionControlViews.setActiveView('command', true);
    }

    requestAnimationFrame(() => {
      const board = document.getElementById('directiveBoard');
      const card = Number.isInteger(index)
        ? board?.querySelector(`.directive-assignment-card[data-assignment-index="${index}"]`)
        : null;
      const target = card || board?.closest('.tech-card') || board;
      if (!target) return;
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (card) {
        card.classList.add('directive-assignment-card--focused');
        setTimeout(() => card.classList.remove('directive-assignment-card--focused'), 2200);
      }
    });
  }

  function render(root, payload) {
    if (!root) return;
    const cyclePlan = payload && payload.engineDirectives && payload.engineDirectives.cyclePlan;

    if (!cyclePlan) {
      root.innerHTML = emptyState(
        'Cycle plan unavailable for this snapshot — no per-councilor orders can be stated. '
        + 'The Directive Engine card explains what the engine could and could not evaluate.'
      );
      return;
    }

    const assignments = Array.isArray(cyclePlan.assignments) ? cyclePlan.assignments : [];
    const unassigned = Array.isArray(cyclePlan.unassigned) ? cyclePlan.unassigned : [];
    const unavailable = Array.isArray(cyclePlan.unavailable) ? cyclePlan.unavailable : [];
    const total = assignments.length + unassigned.length + unavailable.length;

    if (total === 0) {
      root.innerHTML = emptyState('No councilors are reported in this cycle plan.');
      return;
    }

    const tally = [
      `${assignments.length} on mission`,
      `${unassigned.length} idle`,
      `${unavailable.length} without a slot`
    ].join(' · ');

    root.innerHTML = `
      <div class="council-orders">
        <div class="council-orders__status">
          <span class="council-orders__count">${total} COUNCILOR${total === 1 ? '' : 'S'} ACCOUNTED FOR</span>
          <span class="council-orders__tally">${escapeHtml(tally)}</span>
        </div>
        <div class="council-orders__head" aria-hidden="true">
          <span>Councilor</span>
          <span>Order</span>
          <span>Success odds</span>
          <span>Expected alien hate</span>
        </div>
        <div class="council-orders__list">
          ${assignments.map(renderAssignmentRow).join('')}
          ${unassigned.map(renderIdleRow).join('')}
          ${unavailable.map(renderUnavailableRow).join('')}
        </div>
        <p class="council-orders__foot">
          Reasoning, benched alternatives, cycle budgets and clocks are in the
          <button type="button" class="council-orders__link" data-council-orders-open-board>Directive Engine</button>
          card below.
        </p>
      </div>`;

    root.querySelectorAll('[data-council-order-index]').forEach(row => {
      row.addEventListener('click', () => {
        focusDirectiveBoard(Number(row.getAttribute('data-council-order-index')));
      });
    });
    root.querySelector('[data-council-orders-open-board]')?.addEventListener('click', () => {
      focusDirectiveBoard(null);
    });
  }

  global.MissionControlCouncilOrders = { render };
})(window);
