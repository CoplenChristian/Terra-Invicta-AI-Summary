/*
 * Strategic Commentary Component v2
 * ---------------------------------
 * Purpose: renders the non-LLM four-layer Strategic Commentary Engine output.
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
    // A sweep that could not be run says so. Rendering nothing at all is the
    // same defect as printing a confident number: a reader cannot tell "no
    // engagement model was run" from "the panel has nothing to warn about".
    if (sim.available === false) {
      simTableHtml = `
        <div class="commentary-sim-section">
          <div class="commentary-sim-header">
            <span>COMBAT THRESHOLDS</span>
            <span class="commentary-sim-badge">NOT SIMULATED</span>
          </div>
          <div class="commentary-empty">${escapeHtml(sim.reason
            || 'The combat-threshold simulation did not run and gave no reason; no hull count is reported.')}</div>
        </div>`;
    } else if (sim.available && Array.isArray(sim.tiers) && sim.tiers.length > 0) {
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
    } else if (proj.hateVent && proj.hateVent.reason) {
      // Four different reasons used to reach this component as one bare `null`,
      // and the card simply not rendering read as "hostility has no venting
      // story". One of the four is player mode's redaction of the true hate
      // value, under which this projection can never be produced at all -- the
      // opposite of a reassuring finding, and it now says so on the page.
      projCards.push(`
        <div class="commentary-proj-card">
          <div class="commentary-proj-label">HATE VENT HORIZON</div>
          <div class="commentary-proj-val">UNAVAILABLE</div>
          <small style="color: var(--text-dim); font-size: 9px;">${escapeHtml(proj.hateVent.reason)}</small>
        </div>
      `);
    }

    if (proj.rebuildClock && proj.rebuildClock.available) {
      // A SUB-1 RATE IS READ THE OTHER WAY UP.
      //
      // This card printed `~1 hulls/mo` for a computed 0.25 while the model
      // carried a `Math.max(1, Math.round(...))` floor. The floor is gone, so
      // the value arriving here is now the real rate -- and below one hull a
      // month the useful sentence is the reciprocal: "one every 120 days" is
      // actionable where "0.25 hulls/mo" invites a reader to round it back up.
      //
      // The "~" is dropped once the rate is stated exactly. A measured 0 (a
      // queue that was read and is empty) is a reading and prints as 0.
      // THE PARALLELISM IS NOW MEASURED, NOT ASSUMED.
      //
      // This card read "(N ship(s) queued, assumed parallel)". Measured
      // 2026-08-22 across four frozen saves and all eight factions: a shipyard
      // builds ONE hull at a time and yards run concurrently, so the divisor is
      // the number of hulls IN PROGRESS. The card now states the rule and the
      // yards behind it, and the rate it prints is a FLOOR whenever the build
      // time came from the hull template rather than from the save.
      const clock = proj.rebuildClock;
      const rate = Number(clock.monthlyThroughputEst);
      const days = Number(clock.daysPerHullEst);
      const next = Number(clock.nextCompletionDays);
      const building = Number(clock.concurrentBuilds);
      const yards = Number(clock.shipyardCount);
      const waiting = Number(clock.waitingBehindCount);
      const subMonthly = Number.isFinite(rate) && rate > 0 && rate < 1 && Number.isFinite(days);
      const floor = clock.throughputBound === 'lower' ? '≥ ' : '';
      const headline = !Number.isFinite(rate)
        ? 'UNAVAILABLE'
        : (subMonthly ? `1 per ${days} days` : `${floor}${rate} hulls/mo`);
      const rateDetail = !Number.isFinite(rate)
        ? (clock.throughputUnavailableReason || 'no build time was readable')
        : (subMonthly
          ? `${floor}${rate} hulls/mo — under one a month`
          : (Number.isFinite(days) ? `1 per ${days} days` : 'nothing is building'));
      // The measured half: yards working and the next delivery, straight from
      // the save's own countdowns.
      const yardDetail = Number.isFinite(yards)
        ? `${building} of ${yards} yard(s) building, ${waiting} waiting`
        : `${building} building, ${waiting} waiting — yard count unread`;
      const nextDetail = Number.isFinite(next) ? `next in ${next}d` : 'no horizon read';
      projCards.push(`
        <div class="commentary-proj-card">
          <div class="commentary-proj-label">PRODUCTION THROUGHPUT</div>
          <div class="commentary-proj-val">${escapeHtml(headline)}</div>
          <small style="color: var(--text-dim); font-size: 9px;">${escapeHtml(clock.targetHull)} — ${escapeHtml(rateDetail)} (${escapeHtml(yardDetail)}; ${escapeHtml(nextDetail)}; one hull per yard, measured)</small>
        </div>
      `);
    } else if (proj.rebuildClock && proj.rebuildClock.reason) {
      // A projection that could not be run says why, rather than the card
      // simply not appearing beside a card that did run.
      projCards.push(`
        <div class="commentary-proj-card">
          <div class="commentary-proj-label">PRODUCTION THROUGHPUT</div>
          <div class="commentary-proj-val">UNAVAILABLE</div>
          <small style="color: var(--text-dim); font-size: 9px;">${escapeHtml(proj.rebuildClock.reason)}</small>
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
