/*
 * Strategic Commentary Component v2
 * ---------------------------------
 * Renders the non-LLM 4-layer Strategic Commentary Engine output
 * (server/commentary) beneath Hold Ground / Priority Brief in COMMAND view.
 */
(function exposeStrategicCommentary(global) {
  'use strict';

  const shared = global.MissionControlShared || {};
  const escapeHtml = shared.escapeHtml || (value => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;'));

  function renderStrategicCommentary(commentaryData, containerId = 'strategicCommentary') {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!commentaryData || commentaryData.available === false) {
      container.innerHTML = `
        <div class="commentary-empty">
          ${escapeHtml(commentaryData?.reason || 'Strategic commentary telemetry unavailable for this save.')}
        </div>`;
      return;
    }

    const badgeEl = document.getElementById('commentaryModeBadge');
    if (badgeEl) {
      badgeEl.textContent = commentaryData.mode === 'omniscient'
        ? 'OMNISCIENT BLUEPRINTS'
        : 'OBSERVED TELEMETRY';
    }

    const beatsHtml = Array.isArray(commentaryData.beats) && commentaryData.beats.length > 0
      ? `
        <div class="commentary-beats-grid">
          ${commentaryData.beats.map(b => `
            <div class="commentary-beat-chip commentary-beat-chip--${escapeHtml(b.severity || 'standard')}" title="${escapeHtml(b.summary || '')}">
              <strong>${escapeHtml(b.name || b.id)}</strong>
              <span>&bull; ${escapeHtml(b.severity || 'info')}</span>
            </div>
          `).join('')}
        </div>`
      : '';

    const sim = commentaryData.simulation || {};
    let simTableHtml = '';
    if (sim.available && Array.isArray(sim.tiers) && sim.tiers.length > 0) {
      simTableHtml = `
        <div class="commentary-sim-section">
          <div class="commentary-sim-header">
            <span>COMBAT THRESHOLDS (${escapeHtml(sim.ownBestDesign || sim.ownBestHull || 'Force')})</span>
            <span class="commentary-sim-badge">P(WIN) &ge; 80% &bull; MONTE CARLO SIMULATED</span>
          </div>
          <table class="commentary-sim-table">
            <thead>
              <tr>
                <th>Opponent Force Tier</th>
                <th>Observed Target Signature</th>
                <th style="text-align: right;">Threshold Required</th>
              </tr>
            </thead>
            <tbody>
              ${sim.tiers.map(tier => `
                <tr>
                  <td><strong>${escapeHtml(tier.label)}</strong></td>
                  <td><small style="color: var(--text-dim);">${escapeHtml(tier.description || '')}</small></td>
                  <td style="text-align: right;">
                    ${tier.winnable
                      ? `<em>${escapeHtml(tier.bandLabel)}</em>`
                      : '<span style="color: var(--danger); font-family: var(--mono); font-size: 9px;">UNWINNABLE</span>'
                    }
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>`;
    }

    // Projections
    const proj = sim.projections || {};
    const projCards = [];

    if (proj.hateVent && proj.hateVent.available) {
      projCards.push(`
        <div class="commentary-proj-card">
          <div class="commentary-proj-label">HATE VENT HORIZON</div>
          <div class="commentary-proj-val">${escapeHtml(proj.hateVent.bandLabel)}</div>
          <small style="color: var(--text-dim); font-size: 9px;">To cross below war threshold</small>
        </div>
      `);
    }

    if (proj.rebuildClock && proj.rebuildClock.available) {
      projCards.push(`
        <div class="commentary-proj-card">
          <div class="commentary-proj-label">PRODUCTION THROUGHPUT</div>
          <div class="commentary-proj-val">~${escapeHtml(String(proj.rebuildClock.monthlyThroughputEst))} hulls/mo</div>
          <small style="color: var(--text-dim); font-size: 9px;">${escapeHtml(proj.rebuildClock.targetHull)} (${escapeHtml(String(proj.rebuildClock.activeShipyardQueues))} active yards)</small>
        </div>
      `);
    }

    const projectionsHtml = projCards.length > 0
      ? `<div class="commentary-projections">${projCards.join('')}</div>`
      : '';

    container.innerHTML = `
      <div class="commentary-content">
        <div class="commentary-headline">${escapeHtml(commentaryData.headline || 'Strategic Assessment')}</div>
        <blockquote class="commentary-prose">${escapeHtml(commentaryData.prose || '')}</blockquote>
        ${beatsHtml}
        ${simTableHtml}
        ${projectionsHtml}
      </div>
    `;
  }

  global.MissionControlStrategicCommentary = {
    renderStrategicCommentary
  };

})(typeof window !== 'undefined' ? window : global);
