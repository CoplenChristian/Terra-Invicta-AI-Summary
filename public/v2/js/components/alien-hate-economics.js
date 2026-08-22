/*
 * Alien Hate Economics
 * --------------------
 * Purpose: renders the save-derived Mission Control hate floor without
 *   embedding the floor calculation in the dashboard.
 * Renders the save-derived Mission Control hate floor without embedding the
 * calculation in the page controller. The API owns the numbers; this module
 * only presents them and makes the derivation expandable.
 */
(function exposeAlienHateEconomics(global) {
  'use strict';

  const shared = global.MissionControlShared || {};
  const escapeHtml = shared.escapeHtml || (value => String(value ?? ''));
  const formatNumber = shared.formatNumber || ((value, decimals = 2) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed.toFixed(decimals) : 'UNAVAILABLE';
  });

  function value(value, decimals = 2) {
    return value === null || value === undefined ? 'UNAVAILABLE' : formatNumber(value, decimals);
  }

  function statusClass(text) {
    const normalized = String(text || '').toLowerCase();
    if (normalized.includes('below') || normalized.includes('not completed')) return 'is-safe';
    if (normalized.includes('exceeded') || normalized.includes('reached')) return 'is-danger';
    return '';
  }

  // Total war requires BOTH >=200 hate AND >=X elapsed years (Normal 20).
  // Two independent gates, so a single bar would mislead -- render both.
  const TOTAL_WAR_COPY = {
    active: { label: 'TOTAL WAR DECLARED', tone: 'is-danger',
      note: 'Hate venting is severely restricted. This war is effectively permanent.' },
    armed: { label: 'ARMED — HATE GATE ONLY', tone: 'is-warning',
      note: 'The year gate has passed. Only the hate ceiling now prevents total war.' },
    pending: { label: 'PENDING — YEAR GATE ONLY', tone: 'is-warning',
      note: 'Hate is already past 200. Total war lands the moment the years elapse.' },
    safe: { label: 'BOTH GATES CLOSED', tone: 'is-safe', note: '' },
    armed_hate_unknown: { label: 'ARMED — HATE UNKNOWN', tone: 'is-warning',
      note: 'The year gate has passed; current hate is not exposed in this view.' },
    safe_hate_unknown: { label: 'YEAR GATE CLOSED', tone: '',
      note: 'Current hate is not exposed in this view.' },
    unavailable: { label: 'UNAVAILABLE', tone: '',
      note: 'Campaign duration or difficulty missing from this snapshot.' }
  };

  // `yearsElapsedSource` sits on the economics object rather than on totalWar,
  // so it is passed in explicitly instead of being read off the wrong object --
  // which would silently render nothing.
  function renderTotalWar(totalWar, yearsElapsedSource = null) {
    if (!totalWar) return '';
    const copy = TOTAL_WAR_COPY[totalWar.state] || TOTAL_WAR_COPY.unavailable;
    // The save's Alien Progression Speed IS now read (2026-08-21), so this
    // branch is reached on every real save and the old wording -- "the slider
    // is not read from the save" -- became false the moment it started firing.
    // The caveat is inverted rather than deleted: a fixture or a pre-1.0 save
    // still has no setting to read, and that case must keep saying so.
    const speedCaveat = totalWar.progressionSpeedAssumed === false
      ? `<small>Year gate scaled by the save's Alien Progression Speed of ${value(totalWar.alienProgressionSpeed, 2)}×.</small>`
      : '<small>Assumes default Alien Progression Speed; this snapshot carries no campaign-settings block to read it from.</small>';
    // Elapsed campaign time is the other input to the year gate and is just as
    // capable of being an assumption, so it is shown beside the gate rather
    // than left to the API. Absent stays absent: no source, no line.
    const ageCaveat = typeof yearsElapsedSource === 'string' && yearsElapsedSource
      ? `<small>Campaign age: ${escapeHtml(yearsElapsedSource)}.</small>`
      : '';

    return `
      <div class="alien-hate-econ-section">
        <div class="alien-hate-econ-section-heading">
          <span>TOTAL WAR PROXIMITY</span>
          <small class="alien-hate-econ-status ${copy.tone}">${escapeHtml(copy.label)}</small>
        </div>
        <div class="alien-hate-econ-mc-grid">
          ${metric('Hate gate', value(totalWar.hateThreshold, 0),
            totalWar.hateRemaining === null ? 'current hate unknown' : `${value(totalWar.hateRemaining, 1)} to go`)}
          ${metric('Year gate', value(totalWar.yearsThreshold, 0) + ' yrs',
            totalWar.yearsRemaining === null ? 'duration unknown'
              : totalWar.yearsRemaining === 0 ? 'PASSED' : `${value(totalWar.yearsRemaining, 1)} yrs to go`,
            totalWar.yearsRemaining === 0 ? 'is-emphasis' : '')}
          ${metric('Maximum hate', value(totalWar.maximumAlienHate, 0), 'ceiling, grows yearly')}
        </div>
        ${copy.note ? `<p class="alien-hate-econ-note">${escapeHtml(copy.note)}</p>` : ''}
        ${speedCaveat}
        ${ageCaveat}
      </div>
    `;
  }

  function metric(label, metricValue, note, className = '') {
    return `
      <div class="alien-hate-econ-metric ${className}">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(metricValue)}</strong>
        <small>${escapeHtml(note || '')}</small>
      </div>
    `;
  }

  function render(root, economics) {
    if (!root) return;
    if (!economics) {
      root.innerHTML = '<div class="alien-hate-econ-empty">ALIEN HATE ECONOMICS UNAVAILABLE</div>';
      return;
    }

    if (!economics.applicable) {
      root.innerHTML = `
        <div class="alien-hate-econ-empty">
          <strong>MINIMUM HATE FLOOR NOT APPLICABLE</strong>
          <span>The alien Mission Control floor does not apply to ${escapeHtml(economics.factionName || 'this faction')}.</span>
        </div>
      `;
      return;
    }

    const actual = economics.actualAlienHate;
    const actualValue = actual !== null && actual !== undefined
      ? value(actual)
      : economics.visibleHateEstimate || 'UNAVAILABLE';
    const actualNote = actual !== null && actual !== undefined
      ? 'raw save value'
      : economics.visibleHateEstimate
        ? 'game-visible estimate'
        : 'requires available alien threat intel';
    // Hate above the floor is NOT automatically recoverable. Venting requires
    // all of: not at total war, asset not trespassing, and the aliens having
    // targeted it. Showing a bare number here reads as "this will drain away".
    const ventBlocked = economics.ventingBlockedByTotalWar === true;
    const ventCapacityValue = ventBlocked
      ? 'VOIDED'
      : (actual !== null && actual !== undefined ? value(economics.hateAboveFloor) : 'RAW-ONLY');
    const ventCapacityNote = ventBlocked
      ? 'total war — venting restricted'
      : (actual !== null && actual !== undefined ? 'conditional · ±20%' : 'requires raw hate');
    const ventClass = ventBlocked ? 'is-danger' : 'is-emphasis';
    const projects = (economics.reductionProjects || []).filter(project => project.applicable);
    const currentStatus = economics.currentWarStatus || 'UNAVAILABLE';
    const floorStatus = economics.minimumFloorStatus || 'UNAVAILABLE';

    root.innerHTML = `
      <div class="alien-hate-econ">
        <div class="alien-hate-econ-statusbar">
          <div>
            <span class="alien-hate-econ-eyebrow">MINIMUM-HATE FLOOR</span>
            <strong class="alien-hate-econ-status ${statusClass(floorStatus)}">${escapeHtml(floorStatus)}</strong>
          </div>
          <div class="alien-hate-econ-war-status ${statusClass(currentStatus)}">
            <span>CURRENT HATE</span>
            <strong>${escapeHtml(currentStatus)}</strong>
          </div>
        </div>

        <div class="alien-hate-econ-grid">
          ${metric('Actual hate', actualValue, actualNote)}
          ${metric('Minimum hate', value(economics.minimumAlienHate), 'floor from used MC')}
          ${metric('Hate vent capacity', ventCapacityValue, ventCapacityNote, ventClass)}
          ${metric('War threshold', value(economics.warThreshold), 'alien threshold')}
        </div>

        <details class="alien-hate-econ-formula">
          <summary>WHEN DOES HATE ACTUALLY VENT?</summary>
          <div class="alien-hate-econ-formula-body">
            <p>The aliens only shed hate when they destroy one of our assets, and only if <strong>all three</strong> hold:</p>
            <ul>
              <li>We are <strong>not at Total War</strong>.</li>
              <li>The asset is <strong>not Trespassing</strong> — at or beyond Jupiter, or anywhere the aliens hold a hab, except Earth.</li>
              <li>The aliens <strong>actually targeted</strong> it. Kills made in self-defence vent nothing.</li>
            </ul>
            <p>Amounts: a ship vents its hull Construction Tier; a complete hab module vents Tier² (+Tier if a Mining Complex or Construction Module), divided by 3 on Normal. Every hate modifier is also scaled by a random 0.8–1.2, so treat any figure here as ±20%.</p>
          </div>
        </details>

        ${renderTotalWar(economics.totalWar, economics.yearsElapsedSource)}

        <div class="alien-hate-econ-section">
          <div class="alien-hate-econ-section-heading">
            <span>MISSION CONTROL</span>
            <small>USED MC DRIVES HATE · CAPACITY DOES NOT</small>
          </div>
          <div class="alien-hate-econ-mc-grid">
            ${metric('Used', value(economics.usedMissionControl, 0), 'space footprint')}
            ${metric('Capacity', value(economics.missionControlCapacity, 0), 'context only')}
            ${metric('MC war floor', value(economics.mcWarFloor, 1), 'used MC at 50 hate')}
          </div>
        </div>

        <div class="alien-hate-econ-section">
          <div class="alien-hate-econ-section-heading">
            <span>CONCEALMENT MODIFIERS</span>
            <small>${escapeHtml(String(economics.completedReductionProjectCount || 0))} ACTIVE</small>
          </div>
          <div class="alien-hate-econ-projects">
            ${projects.length ? projects.map(project => `
              <div class="alien-hate-econ-project">
                <span>${escapeHtml(project.label)}</span>
                <strong class="${project.completed ? 'is-complete' : 'is-missing'}">${project.completed ? 'YES · ×0.80' : 'NO'}</strong>
              </div>
            `).join('') : '<div class="alien-hate-econ-empty">NO APPLICABLE PROJECT MODIFIERS</div>'}
          </div>
        </div>

        <details class="alien-hate-econ-formula">
          <summary>WHY? SHOW CALCULATION</summary>
          <div class="alien-hate-econ-formula-body">
            <code>${escapeHtml(economics.formula?.text || 'UNAVAILABLE')}</code>
            <p>Only used Mission Control is multiplied by difficulty and the completed concealment projects. Mission Control capacity is shown for context and is excluded from this calculation.</p>
            <div>Minimum-hate headroom: <strong>${escapeHtml(value(economics.minimumHateHeadroom))}</strong> · Reduction multiplier: <strong>${escapeHtml(value(economics.concealmentMultiplier))}</strong></div>
          </div>
        </details>
      </div>
    `;
  }

  global.MissionControlHateEconomics = { render, renderHud };

  function finiteOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function pipCount(estimate) {
    const text = String(estimate || '');
    if (!text || text === 'UNAVAILABLE' || text === 'UNKNOWN') return null;
    if (!/■|□/.test(text)) return null;
    return (text.match(/■/g) || []).length;
  }

  function renderHud(root, economics, observerHate) {
    if (!root) return;
    const fill = root.querySelector('#hudHateFill');
    const floorMark = root.querySelector('#hudHateFloor');
    const valueNode = root.querySelector('#hudHateValue');
    const statusNode = root.querySelector('#hudHateStatus');
    const warThreshold = Number(economics?.warThreshold) > 0 ? Number(economics.warThreshold) : 50;

    const actual = finiteOrNull(economics?.actualAlienHate);
    const pips = observerHate?.pips ?? pipCount(observerHate?.visibleEstimate || economics?.visibleHateEstimate);
    const estimate = observerHate?.visibleEstimate || economics?.visibleHateEstimate || null;
    const numeric = actual !== null
      ? actual
      : (Number.isFinite(pips) ? pips * 10 : null);
    const floor = finiteOrNull(economics?.minimumAlienHate);
    const applicable = economics?.applicable !== false;
    const unavailable = !applicable
      || (numeric === null && (!estimate || estimate === 'UNAVAILABLE'));

    let tone = 'is-unknown';
    let status = 'UNAVAILABLE';
    let valueText = 'UNAVAILABLE';

    if (!applicable) {
      tone = 'is-unknown';
      status = 'NOT APPLICABLE';
      valueText = '—';
    } else if (unavailable) {
      tone = 'is-unknown';
      status = observerHate?.requiredProject ? 'INTEL GATED' : 'UNAVAILABLE';
      valueText = 'UNAVAILABLE';
    } else if (actual !== null) {
      valueText = `${actual.toFixed(actual >= 10 ? 0 : 1)} / ${warThreshold}`;
      if (numeric >= warThreshold) {
        tone = 'is-danger';
        status = 'WAR THRESHOLD';
      } else if (floor !== null && floor >= warThreshold) {
        tone = 'is-danger';
        status = 'PERM. WAR FLOOR';
      } else if (numeric >= warThreshold * 0.7) {
        tone = 'is-warning';
        status = 'APPROACHING WAR';
      } else {
        tone = 'is-safe';
        status = 'BELOW WAR';
      }
    } else {
      valueText = String(estimate);
      if (pips >= 5) {
        tone = 'is-danger';
        status = 'MAX ESTIMATE';
      } else if (pips >= 4) {
        tone = 'is-warning';
        status = 'HIGH ESTIMATE';
      } else {
        tone = 'is-safe';
        status = 'GAME ESTIMATE';
      }
    }

    root.classList.remove('is-safe', 'is-warning', 'is-danger', 'is-unknown');
    root.classList.add(tone);
    if (valueNode) valueNode.textContent = valueText;
    if (statusNode) statusNode.textContent = status;

    const fillPct = unavailable ? 0 : Math.max(0, Math.min(100, ((numeric ?? 0) / warThreshold) * 100));
    if (fill) fill.style.width = `${fillPct}%`;
    if (floorMark) {
      if (floor === null || unavailable) {
        floorMark.hidden = true;
      } else {
        floorMark.hidden = false;
        floorMark.style.left = `${Math.max(0, Math.min(100, (floor / warThreshold) * 100))}%`;
        floorMark.title = `Minimum hate floor ${floor.toFixed(1)}`;
      }
    }

    const parts = [
      `Alien hate ${valueText}`,
      status,
      floor !== null ? `MC floor ${floor.toFixed(1)}` : null,
      'Open full hate economics'
    ].filter(Boolean);
    root.title = parts.join(' · ');
    root.setAttribute('aria-label', `Alien hate ${valueText}, ${status}. Open full economics.`);
    root.setAttribute('aria-valuemin', '0');
    root.setAttribute('aria-valuemax', String(warThreshold));
    if (numeric !== null) root.setAttribute('aria-valuenow', String(Math.round(numeric)));
    else root.removeAttribute('aria-valuenow');
  }
})(window);

