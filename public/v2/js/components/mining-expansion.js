/*
 * Mining Expansion Board Component
 * --------------------------------
 * Answers three core strategic questions:
 *   1. How much mining capacity do I have left? (Mine limit, headroom, quadratic MC & hate cost)
 *   2. Which sites are open? (Unowned sites, reachability filtered)
 *   3. Which of those are worth taking? (Need-weighted saturating marginal utility scoring)
 */
(function exposeMiningExpansion(global) {
  'use strict';

  const shared = global.MissionControlShared || {};
  const escapeHtml = shared.escapeHtml || (value => String(value ?? ''));

  function num(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function fmt(value, decimals = 1) {
    const parsed = num(value);
    return parsed === null ? '—' : parsed.toFixed(decimals);
  }

  function formatYields(yields) {
    if (!yields || typeof yields !== 'object') return '—';
    const parts = [];
    if (yields.water?.monthly > 0) parts.push(`W: +${yields.water.monthly}`);
    if (yields.volatiles?.monthly > 0) parts.push(`V: +${yields.volatiles.monthly}`);
    if (yields.metals?.monthly > 0) parts.push(`M: +${yields.metals.monthly}`);
    if (yields.nobleMetals?.monthly > 0) parts.push(`N: +${yields.nobleMetals.monthly}`);
    if (yields.fissiles?.monthly > 0) parts.push(`F: +${yields.fissiles.monthly}`);
    return parts.length ? parts.join(' · ') : 'Trace yields';
  }

  async function fetchMiningExpansion(observerId = 4712, mode = 'player') {
    try {
      const res = await fetch(`/api/intel/mining-expansion?observer=${observerId}&mode=${mode}`);
      if (!res.ok) return null;
      return await res.json();
    } catch (err) {
      console.warn('[MiningExpansion] Failed to fetch expansion data:', err);
      return null;
    }
  }

  function render(root, payload) {
    if (!root) return;

    const expansion = payload?.miningExpansion || payload;
    const capacity = expansion?.capacity;
    const available = Array.isArray(expansion?.available) ? expansion.available : [];
    const techGated = Array.isArray(expansion?.techGated) ? expansion.techGated : [];
    const unreachable = expansion?.unreachable || {};
    const runways = expansion?.resourceRunways || {};

    if (!capacity) {
      root.innerHTML = '<div class="alien-hate-econ-empty">MINING EXPANSION DATA UNAVAILABLE</div>';
      return;
    }

    const minesBuilt = num(capacity.minesBuilt) ?? 0;
    const mineLimit = num(capacity.mineLimit) ?? 0;
    const headroom = num(capacity.headroom) ?? 0;
    const overLimit = capacity.overLimit;
    const penaltyMC = num(capacity.penaltyMC) ?? 0;
    const penaltyHate = num(capacity.penaltyHate) ?? 0;
    const warFloorDist = num(capacity.mcWarFloorDistance);

    let statusTone = 'is-safe';
    let statusLabel = `${minesBuilt} / ${mineLimit} MINES`;
    let statusNote = `${headroom} mine(s) headroom remaining before quadratic MC penalty.`;

    if (overLimit) {
      statusTone = 'is-danger';
      statusLabel = `OVER LIMIT (+${penaltyMC} MC / +${fmt(penaltyHate, 1)} HATE)`;
      statusNote = `Quadratic penalty active. Next mine costs +${capacity.marginalNextMinePenaltyMC} MC (+${fmt(capacity.marginalNextMinePenaltyHate, 1)} hate).`;
    } else if (headroom <= 2) {
      statusTone = 'is-warning';
      statusLabel = `${minesBuilt} / ${mineLimit} MINES (CAPACITY TIGHT)`;
      statusNote = `Only ${headroom} mine slot(s) left before penalty. Next mission tech unlocks +3 to +6.`;
    }

    const runwaysSummary = Object.values(runways).map(r => {
      const label = r.key.charAt(0).toUpperCase() + r.key.slice(1);
      const rw = r.runwayMonths !== null ? `${r.runwayMonths}mo` : (r.status.includes('surplus') ? 'Surplus' : '—');
      const badgeClass = r.status === 'critical' ? 'is-danger' : (r.status === 'tight' ? 'is-warning' : 'is-safe');
      return `<span class="mining-runway-pill ${badgeClass}"><strong>${label}:</strong> ${rw}</span>`;
    }).join(' ');

    const availableRows = available.slice(0, 8).map(c => {
      const hateBadge = c.hateCost === 0
        ? '<span class="mining-tag mining-tag--free">FREE</span>'
        : `<span class="mining-tag mining-tag--hate">+${fmt(c.hateCost, 2)} hate</span>`;

      return `
        <tr class="mining-candidate-row" data-site-id="${c.siteId}">
          <td class="mining-site-cell">
            <strong class="mining-site-name">${escapeHtml(c.displayName)}</strong>
            <small class="mining-site-body">${escapeHtml(c.parentBodyName)} (${escapeHtml(c.spaceTheaterKey?.toUpperCase() || '')})</small>
          </td>
          <td class="mining-yields-cell">
            <div class="mining-yields-text">${formatYields(c.yields)}</div>
            <small class="mining-density">Density: ${fmt(c.siteDensity, 2)}x</small>
          </td>
          <td class="mining-value-cell">
            <strong class="mining-value-score">${fmt(c.siteValue, 2)}</strong>
            <small class="mining-value-label">net utility</small>
          </td>
          <td class="mining-cost-cell">
            <div>${hateBadge}</div>
            <small class="mining-mc-cost">${c.mcCost} MC · ${c.buildTimeDays}d</small>
          </td>
        </tr>
      `;
    }).join('');

    const techGatedCards = techGated.slice(0, 4).map(g => `
      <div class="mining-gated-item">
        <div class="mining-gated-header">
          <strong class="mining-gated-tech">${escapeHtml(g.missingTechName)}</strong>
          <span class="mining-gated-count">${g.siteCount} sites</span>
        </div>
        <div class="mining-gated-meta">
          <span>Top site value: <strong>${fmt(g.bestSiteValue, 2)}</strong></span>
          <small class="mining-gated-sub">Research argument</small>
        </div>
      </div>
    `).join('');

    root.innerHTML = `
      <div class="mining-expansion-board">
        <div class="alien-hate-econ-statusbar">
          <div>
            <span class="alien-hate-econ-eyebrow">MINING CAPACITY</span>
            <strong class="alien-hate-econ-status ${statusTone}">${escapeHtml(statusLabel)}</strong>
          </div>
          <div class="alien-hate-econ-sub">${escapeHtml(statusNote)}</div>
        </div>

        <div class="mining-runways-bar">
          <span class="mining-runways-label">RUNWAYS:</span>
          ${runwaysSummary}
          ${warFloorDist !== null ? `<span class="mining-war-floor-pill">War Floor: <strong>${fmt(warFloorDist, 1)} MC</strong> away</span>` : ''}
        </div>

        <div class="mining-section-title">
          <span>AVAILABLE EXPANSION SITES (${available.length})</span>
          <small>Ranked by saturating utility per unit of alien hate</small>
        </div>

        <div class="mining-table-wrap">
          <table class="mining-table">
            <thead>
              <tr>
                <th>Site &amp; Body</th>
                <th>Resource Yields</th>
                <th>Utility Value</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody>
              ${availableRows || '<tr><td colspan="4" class="mining-empty-cell">No unowned reachable sites available in current theater.</td></tr>'}
            </tbody>
          </table>
        </div>

        ${techGated.length > 0 ? `
          <div class="mining-section-title mining-section-title--gated">
            <span>TECH-GATED OPPORTUNITIES (${techGated.reduce((acc, g) => acc + g.siteCount, 0)} sites)</span>
            <small>Requires destination or mine module research</small>
          </div>
          <div class="mining-gated-grid">
            ${techGatedCards}
          </div>
        ` : ''}

        ${unreachable.totalSites > 0 ? `
          <div class="mining-unreachable-summary">
            <small>${unreachable.totalSites} outer system / unprobed sites currently unreachable without deep system mission projects.</small>
          </div>
        ` : ''}
      </div>
    `;
  }

  global.MissionControlMiningExpansion = {
    render,
    fetchMiningExpansion
  };
})(window);
