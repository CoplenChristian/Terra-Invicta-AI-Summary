/*
 * Alien Hate Economics
 * --------------------
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
    const ventCapacityValue = actual !== null && actual !== undefined
      ? value(economics.hateAboveFloor)
      : 'RAW-ONLY';
    const ventCapacityNote = actual !== null && actual !== undefined
      ? 'actual − minimum floor'
      : 'requires raw hate';
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
          ${metric('Hate vent capacity', ventCapacityValue, ventCapacityNote, 'is-emphasis')}
          ${metric('War threshold', value(economics.warThreshold), 'alien threshold')}
        </div>

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

  global.MissionControlHateEconomics = { render };
})(window);
