/**
 * src/v2/panels/CouncilOrders.jsx
 *
 * Purpose: React port of public/v2/js/components/council-orders.js. Renders the
 *   at-a-glance answer to "what should each councilor do this cycle" in the
 *   COMMAND view, one row per councilor, with a click-through into the
 *   Directive Engine card for the reasoning.
 *
 * tests/councilOrders.test.js characterises this panel through the browser
 * harness. The cross-component click into #directiveBoard is preserved as an
 * explicit React effect using the same selector emitted by the still-vanilla
 * directive-board.js.
 */

import React from 'react';

// The cross-nav contract: directive-board.js:331 emits
//   <div class="directive-assignment-card" data-assignment-index="${index}">
// so the querySelector below must keep matching it. Changing either side
// breaks both panels.
const DIRECTIVE_BOARD_ID = 'directiveBoard';
const ASSIGNMENT_CARD_SELECTOR_PREFIX = '.directive-assignment-card[data-assignment-index="';
const ASSIGNMENT_CARD_SELECTOR_SUFFIX = '"]';

const FAMILY_LABEL = {
  expansion: 'EXPANSION',
  council: 'COUNCIL',
  intelligence: 'INTEL',
  intel: 'INTEL',
  security: 'SECURITY',
  space: 'SPACE',
  research: 'RESEARCH',
  defense: 'DEFENSE',
};

function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function missionLabel(candidate) {
  const c = candidate || {};
  const label = c.friendlyName || c.missionType || c.missionSpec?.friendlyName || c.title;
  return label ? String(label) : null;
}

/**
 * Targets arrive in two shapes: the directive engine's `{ kind, nation,
 * faction, controlPointType, councilorName }` and the mission generator's
 * `{ type, name, nation, councilor }`. Both shapes are read here, and a target
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
 * panel must not blur them. `point === 100` off a contested roll is a rounding
 * artefact of a 99.75% chance, not a guarantee, so it prints >99%.
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
      basis: odds?.basis || 'mission rules unavailable for this snapshot',
    };
  }
  const band = Array.isArray(odds?.band) && odds.band.length === 2
    ? [num(odds.band[0]), num(odds.band[1])]
    : [null, null];
  return {
    kind: 'roll',
    point: Math.round(point),
    band: band[0] !== null && band[1] !== null ? band : null,
    basis: odds?.basis || null,
  };
}

function riskFloorTag(riskFloor) {
  if (!riskFloor) return '';
  if (riskFloor.outcome === 'unknown') {
    return `<span class="council-orders__tag council-orders__tag--unknown" title="${
      escapeHtml(riskFloor.reason || 'Your risk floor could not be checked against this action.')
    }">FLOOR UNVERIFIED</span>`;
  }
  if (riskFloor.outcome === 'pass' && riskFloor.marginal === true) {
    return `<span class="council-orders__tag council-orders__tag--marginal" title="${
      escapeHtml(riskFloor.reason || '')
    }">MARGINAL</span>`;
  }
  return '';
}

function renderOddsCellHtml(odds, riskFloor) {
  const reading = readOdds(odds);
  const riskTag = riskFloorTag(riskFloor);
  if (reading.kind === 'automatic') {
    return `<span class="council-orders__tag council-orders__tag--auto" title="${escapeHtml(reading.basis)}">GUARANTEED</span>${riskTag}`;
  }
  if (reading.kind === 'unavailable') {
    return `<span class="council-orders__tag council-orders__tag--unknown" title="${escapeHtml(reading.basis)}">ODDS UNAVAILABLE</span>${riskTag}`;
  }
  const pt = reading.point;
  let tone = 'council-orders__pct--good';
  if (pt < 50) tone = 'council-orders__pct--low';
  else if (pt < 75) tone = 'council-orders__pct--mid';
  const shown = pt >= 100 ? '&gt;99%' : `${pt}%`;
  const band = reading.band ? `<small>[${reading.band[0]}–${reading.band[1]}%]</small>` : '';
  const title = reading.basis ? ` title="${escapeHtml(reading.basis)}"` : '';
  return `<span class="council-orders__pct ${tone}"${title}><strong>${shown}</strong>${band}</span>${riskTag}`;
}

function renderHateCellHtml(expectedHate) {
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

function personMeta(source) {
  const parts = [source?.profession, source?.location].filter(Boolean);
  return parts.length ? parts.join(' · ') : '';
}

function renderPersonHtml(name, meta) {
  return `
      <div class="council-orders__who">
        <span class="council-orders__name">${escapeHtml(name || 'Councilor')}</span>
        ${meta ? `<span class="council-orders__meta">${escapeHtml(meta)}</span>` : ''}
      </div>`;
}

function renderAssignmentRowHtml(assignment, index) {
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
        ${renderPersonHtml(councilor.name, personMeta(councilor))}
        <div class="council-orders__order">
          <span class="council-orders__mission">
            ${escapeHtml(mission || 'Mission unnamed in this snapshot')}
            ${familyLabel ? `<span class="council-orders__family council-orders__family--${escapeHtml(family)}">${escapeHtml(familyLabel)}</span>` : ''}
          </span>
          <span class="council-orders__target">${target ? escapeHtml(target) : 'No fixed target'}</span>
        </div>
        <div class="council-orders__cell council-orders__cell--odds">${renderOddsCellHtml(assignment.odds, assignment.riskFloor)}</div>
        <div class="council-orders__cell council-orders__cell--hate">${renderHateCellHtml(assignment.expectedHate)}</div>
      </button>`;
}

function renderIdleRowHtml(entry) {
  const councilor = entry.councilor || entry;
  const reason = entry.reasonDetail || entry.reason
    || 'No positive expected-value action matched this operative this cycle.';
  const free = entry.suggestedFreeAction || councilor.suggestedFreeAction || null;
  const alternates = Array.isArray(entry.freeActionOptions)
    ? entry.freeActionOptions.filter((option) => option && option !== free)
    : [];

  return `
      <div class="council-orders__row council-orders__row--idle">
        ${renderPersonHtml(councilor.name, personMeta(councilor))}
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

function renderUnavailableRowHtml(entry) {
  const councilor = entry.councilor || entry;
  const reason = entry.reasonDetail || entry.reason || 'Holds no mission slot this cycle.';
  const status = entry.status || councilor.status || null;

  return `
      <div class="council-orders__row council-orders__row--out">
        ${renderPersonHtml(councilor.name, personMeta(councilor))}
        <div class="council-orders__order council-orders__order--wide">
          <span class="council-orders__mission council-orders__mission--idle">
            No mission slot${status ? ` — ${escapeHtml(status)}` : ''}
          </span>
          <span class="council-orders__reason">${escapeHtml(reason)}</span>
        </div>
      </div>`;
}

/**
 * Cross-component navigation. The Directive Engine card lives in another
 * panel that this one does not own (directive-board.js is still vanilla), so
 * the click handler stays in the DOM rather than moving into the React tree.
 * The selector below is the contract between the two panels.
 */
function focusDirectiveBoard(index) {
  if (typeof window === 'undefined') return;
  if (window.MissionControlViews?.setActiveView) {
    window.MissionControlViews.setActiveView('command', true);
  }

  const apply = () => {
    const board = document.getElementById(DIRECTIVE_BOARD_ID);
    const card = Number.isInteger(index)
      ? board?.querySelector(`${ASSIGNMENT_CARD_SELECTOR_PREFIX}${index}${ASSIGNMENT_CARD_SELECTOR_SUFFIX}`)
      : null;
    const target = card || board?.closest('.tech-card') || board;
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (card) {
      card.classList.add('directive-assignment-card--focused');
      setTimeout(() => card.classList.remove('directive-assignment-card--focused'), 2200);
    }
  };

  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(apply);
  } else {
    apply();
  }
}

function useDirectiveBoardFocus(request) {
  React.useEffect(() => {
    if (!request) return;
    focusDirectiveBoard(request.index);
  }, [request]);
}

function CouncilOrdersList({ assignments, unassigned, unavailable, onOpenRow }) {
  return (
    <div
      className="council-orders__list"
      dangerouslySetInnerHTML={{
        __html: [
          ...assignments.map((entry, index) => renderAssignmentRowHtml(entry, index)),
          ...unassigned.map((entry) => renderIdleRowHtml(entry)),
          ...unavailable.map((entry) => renderUnavailableRowHtml(entry)),
        ].join(''),
      }}
      onClick={(event) => {
        const row = event.target.closest('[data-council-order-index]');
        if (row && onOpenRow) {
          onOpenRow(Number(row.getAttribute('data-council-order-index')));
        }
      }}
    />
  );
}

function EmptyState({ message }) {
  return <div className="council-orders__empty">{message}</div>;
}

function CouncilOrdersUnavailable() {
  return (
    <EmptyState message="Cycle plan unavailable for this snapshot — no per-councilor orders can be stated. The Directive Engine card explains what the engine could and could not evaluate." />
  );
}

function CouncilOrdersNoCouncilors() {
  return <EmptyState message="No councilors are reported in this cycle plan." />;
}

function CouncilOrdersHead({ total, tally }) {
  return (
    <div className="council-orders__status">
      <span className="council-orders__count">
        {total} COUNCILOR{total === 1 ? '' : 'S'} ACCOUNTED FOR
      </span>
      <span className="council-orders__tally">{tally}</span>
    </div>
  );
}

export function CouncilOrders({ payload }) {
  const [focusRequest, setFocusRequest] = React.useState(null);
  useDirectiveBoardFocus(focusRequest);

  const cyclePlan = payload && payload.engineDirectives && payload.engineDirectives.cyclePlan;

  if (!cyclePlan) return <CouncilOrdersUnavailable />;

  const assignments = Array.isArray(cyclePlan.assignments) ? cyclePlan.assignments : [];
  const unassigned = Array.isArray(cyclePlan.unassigned) ? cyclePlan.unassigned : [];
  const unavailable = Array.isArray(cyclePlan.unavailable) ? cyclePlan.unavailable : [];
  const total = assignments.length + unassigned.length + unavailable.length;

  if (total === 0) return <CouncilOrdersNoCouncilors />;

  const tally = [
    `${assignments.length} on mission`,
    `${unassigned.length} idle`,
    `${unavailable.length} without a slot`,
  ].join(' · ');

  const handleOpenRow = (index) => setFocusRequest({ index });
  const handleOpenBoard = () => setFocusRequest({ index: null });

  return (
    <div className="council-orders">
      <CouncilOrdersHead total={total} tally={tally} />
      <div className="council-orders__head" aria-hidden="true">
        <span>Councilor</span>
        <span>Order</span>
        <span>Success odds</span>
        <span>Expected alien hate</span>
      </div>
      <CouncilOrdersList
        assignments={assignments}
        unassigned={unassigned}
        unavailable={unavailable}
        onOpenRow={handleOpenRow}
      />
      <p className="council-orders__foot">
        Reasoning, benched alternatives, cycle budgets and clocks are in the
        <button
          type="button"
          className="council-orders__link"
          data-council-orders-open-board
          onClick={handleOpenBoard}
        >
          Directive Engine
        </button>
        card below.
      </p>
    </div>
  );
}

export { focusDirectiveBoard };
