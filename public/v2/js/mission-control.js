/**
 * THE INITIATIVE // EXECUTIVE BRIEFING CLIENT
 * The server generates a fresh briefing for every save/mode/observer request.
 */

const state = {
  mode: 'player',
  observer: 4712,
  briefing: null,
  rawSnapshot: null,
  activeSector: null,
  isLoading: false,
  runtime: {
    supportedModes: ['player', 'enhanced', 'omniscient'],
    defaultMode: 'player'
  }
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  loadRuntime().finally(loadData);
});

async function loadRuntime() {
  try {
    const res = await fetch('/api/runtime');
    const runtime = await res.json();
    if (!runtime.success) return;
    state.runtime = runtime;
    applyRuntimeCapabilities();
  } catch (err) {
    // The dashboard can still load with its local defaults if the capability
    // probe is unavailable.
    console.warn('[Mission Control] Runtime capability check failed:', err);
  }
}

function applyRuntimeCapabilities() {
  const supported = Array.isArray(state.runtime.supportedModes)
    ? state.runtime.supportedModes
    : ['player', 'enhanced', 'omniscient'];

  document.querySelectorAll('.init-mode-btn').forEach((button) => {
    const mode = button.dataset.mode;
    const available = supported.includes(mode);
    button.hidden = !available;
    button.disabled = !available;
  });

  if (!supported.includes(state.mode)) {
    state.mode = state.runtime.defaultMode || supported[0] || 'player';
  }
  syncModeButtons();
}

function syncModeButtons() {
  document.querySelectorAll('.init-mode-btn').forEach((button) => {
    button.classList.toggle('init-btn-cyan', button.dataset.mode === state.mode);
  });
}

function initEventListeners() {
  // Mode switcher
  document.querySelectorAll('.init-mode-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      if (btn.disabled || btn.hidden) return;
      document.querySelectorAll('.init-mode-btn').forEach(b => b.classList.remove('init-btn-cyan'));
      btn.classList.add('init-btn-cyan');
      state.mode = btn.dataset.mode;
      loadData();
    });
  });

  // Observer select
  const obsSelect = document.getElementById('initObserverSelect');
  if (obsSelect) {
    obsSelect.addEventListener('change', (e) => {
      state.observer = parseInt(e.target.value, 10);
      loadData();
    });
  }

  // Refresh button
  const refreshBtn = document.getElementById('initRefreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.textContent = 'Refreshing…';
      try {
        await fetch(`/api/refresh?mode=${state.mode}&observer=${state.observer}`, { method: 'POST' });
        await loadData();
        showToast('Telemetry refreshed from the newest save.');
      } catch (err) {
        showToast('Refresh failed: ' + err.message);
      } finally {
        refreshBtn.textContent = 'Refresh save';
      }
    });
  }

  // Copy SITREP Button
  const copyBtn = document.getElementById('btnCopySitrep');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      if (!state.briefing) return;
      const text = `[THE INITIATIVE // STRATEGIC SITREP]\nDate: ${state.briefing.campaignDate}\nPower Index: ${state.briefing.powerScore}/100\nDEFCON: ${state.briefing.sitrep?.defcon}\n\n${state.briefing.sitrep?.summaryParagraphs?.join('\n\n')}`;
      navigator.clipboard.writeText(text);
      showToast('Executive SITREP copied to clipboard.');
    });
  }

  const openFactionBtn = document.getElementById('openFactionIntelBtn');
  const factionScreen = document.getElementById('factionIntelScreen');
  const closeFactionBtn = document.getElementById('closeFactionIntelBtn');
  const factionRoot = document.getElementById('factionIntelRoot');
  const closeFactionScreen = () => {
    if (!factionScreen) return;
    factionScreen.hidden = true;
    document.body.classList.remove('faction-intel-open');
  };
  const openFactionScreen = () => {
    if (!factionScreen || !factionRoot || !state.rawSnapshot) return;
    if (window.FactionIntelScreen) {
      window.FactionIntelScreen.render(factionRoot, state.rawSnapshot, state.briefing, state.observer);
    }
    factionScreen.hidden = false;
    document.body.classList.add('faction-intel-open');
    closeFactionBtn?.focus();
  };
  openFactionBtn?.addEventListener('click', openFactionScreen);
  closeFactionBtn?.addEventListener('click', closeFactionScreen);
  factionScreen?.addEventListener('click', (event) => {
    if (event.target.closest('[data-faction-intel-close]')) closeFactionScreen();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && factionScreen && !factionScreen.hidden) closeFactionScreen();
  });

  const priorityCard = document.getElementById('priorityBriefCard');
  const openPriorityDetails = () => {
    if (!window.MissionControlDetailPanel || !state.briefing) return;
    const directives = state.briefing.directives || {};
    const directive = directives.geopolitical?.[0] || directives.council?.[0] || directives.space?.[0];
    if (!directive) return;
    window.MissionControlDetailPanel.open({
      eyebrow: 'PRIMARY DIRECTIVE',
      title: directive.title,
      summary: directive.statement,
      facts: [
        { label: 'Department', value: directive.category || 'Unassigned' },
        { label: 'Severity', value: directive.severity || 'Unspecified' },
        { label: 'Recommended action', value: directive.action || 'No action specified' },
        { label: 'Success factor', value: directive.successFactor || 'Not assessed' }
      ]
    });
  };
  priorityCard?.addEventListener('click', openPriorityDetails);
  priorityCard?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openPriorityDetails();
    }
  });
}

async function loadData() {
  state.isLoading = true;
  try {
    const res = await fetch(`/api/v2/briefing?mode=${state.mode}&observer=${state.observer}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Failed to load telemetry');

    state.briefing = json.briefing;
    state.rawSnapshot = json.data;
    document.getElementById('initTelemetryBanner')?.remove();

    populateObserverSelect(state.rawSnapshot.factions || []);
    renderDashboard();
    const factionScreen = document.getElementById('factionIntelScreen');
    const factionRoot = document.getElementById('factionIntelRoot');
    if (factionScreen && !factionScreen.hidden && factionRoot && window.FactionIntelScreen) {
      window.FactionIntelScreen.render(factionRoot, state.rawSnapshot, state.briefing, state.observer);
    }
  } catch (err) {
    console.error('[Mission Control] Error loading telemetry:', err);
    state.briefing = null;
    state.rawSnapshot = null;
    renderTelemetryUnavailable(err.message);
    showToast('Telemetry error: ' + err.message);
  } finally {
    state.isLoading = false;
  }
}

function renderTelemetryUnavailable(message) {
  let banner = document.getElementById('initTelemetryBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'initTelemetryBanner';
    banner.className = 'init-telemetry-banner';
    banner.setAttribute('role', 'status');
    const main = document.querySelector('.init-grid-layout');
    if (main) main.prepend(banner);
  }
  banner.textContent = `LIVE TELEMETRY UNAVAILABLE — ${message || 'The current snapshot could not be loaded.'} Existing figures may be stale.`;
}

function populateObserverSelect(factions) {
  const select = document.getElementById('initObserverSelect');
  if (!select || select.options.length > 1) return;

  select.innerHTML = factions.map(f => `
    <option value="${escapeHtml(f.ID)}" ${f.ID === state.observer ? 'selected' : ''}>${escapeHtml(f.displayName)}</option>
  `).join('');
}

function renderDashboard() {
  if (!state.briefing || !state.rawSnapshot) return;

  renderTopHUD();
  renderHeroKPIs();
  renderHolographicCore();
  renderGeopoliticalMapAndSectors();
  renderFactionDonut();
  renderResourceFlowChart();
  renderPowerTrajectoryChart();
  renderDualAssetRings();
  renderOperativeLeaderboard();
  renderHoldingsBubbleMatrix();
  renderDirectivesStream();
}

function renderTopHUD() {
  const { campaignDate, observerName, powerScore, sitrep = {} } = state.briefing;
  const meta = state.rawSnapshot?.metadata || {};

  document.getElementById('hudDate').textContent = campaignDate;
  document.getElementById('hudSave').textContent = meta.activeSaveFileName || 'Latest';
  document.getElementById('hudFaction').textContent = observerName;
  document.getElementById('hudPower').textContent = `${powerScore}/100`;

  const defcon = document.getElementById('hudDefcon');
  if (defcon) {
    defcon.textContent = sitrep.defcon || 'UNSPECIFIED';
    defcon.className = sitrep.defcon?.includes('DEFCON 2') ? 'alert-critical' : 'alert-elevated';
  }
}

function renderHeroKPIs() {
  const obs = (state.rawSnapshot.factions || []).find(f => f.ID === state.observer) || {};
  const res = obs.resources || {};
  const totalGdp = toFiniteNumber(obs.totalGdp);
  const gdpTrillionValue = totalGdp === null ? toFiniteNumber(obs.gdpTrillion) : totalGdp / 1e12;
  const researchPts = toFiniteNumber(obs.totalResearch ?? obs.monthlyResearch);
  const money = toFiniteNumber(res.Money);
  const boost = toFiniteNumber(res.Boost);
  const operations = toFiniteNumber(res.Operations);
  const controlPoints = toFiniteNumber(obs.controlPointsCount);
  const nations = toFiniteNumber(obs.nationsCount);
  const completedProjects = Array.isArray(obs.completedProjects) ? obs.completedProjects.length : null;
  const powerScore = toFiniteNumber(state.briefing.powerScore);

  // Money
  document.getElementById('kpiMoney').textContent = money === null ? 'UNAVAILABLE' : `$${money.toLocaleString()}`;
  document.getElementById('kpiMoneySub').textContent = `Boost: ${boost === null ? 'UNAVAILABLE' : Math.round(boost)} | Ops: ${operations === null ? 'UNAVAILABLE' : operations}`;

  // GDP
  document.getElementById('kpiGdp').textContent = gdpTrillionValue === null ? 'UNAVAILABLE' : `$${gdpTrillionValue.toFixed(1)}T`;
  document.getElementById('kpiGdpSub').textContent = `${controlPoints === null ? 'UNAVAILABLE' : controlPoints} CPs in ${nations === null ? 'UNAVAILABLE' : nations} Nations`;

  // Research
  document.getElementById('kpiResearch').textContent = researchPts === null ? 'UNAVAILABLE' : `${Math.round(researchPts).toLocaleString()} pts`;
  document.getElementById('kpiResearchSub').textContent = `${completedProjects === null ? 'UNAVAILABLE' : completedProjects} Completed Projects`;

  // Power Score
  document.getElementById('kpiPower').textContent = powerScore === null ? 'UNAVAILABLE' : `${powerScore}/100`;
  document.getElementById('kpiPowerSub').textContent = state.briefing.observerRank
    ? `Rank #${state.briefing.observerRank} of Global Factions`
    : 'Rank unavailable';
}

function renderHolographicCore() {
  const directives = state.briefing.directives || {};
  const topDirective = directives.geopolitical?.[0] || directives.council?.[0] || {
    title: 'Consolidate holdings',
    statement: 'Maintain network surveillance until a higher-priority order is available.'
  };

  document.getElementById('holoPrimaryTitle').textContent = topDirective.title;
  document.getElementById('holoPrimaryStatement').textContent = topDirective.statement;

  // 5 Orbiting Tactical Nodes
  const obs = (state.rawSnapshot.factions || []).find(f => f.ID === state.observer) || {};
  const ownCouncilors = (state.rawSnapshot.councilors || []).filter(c =>
    c.isOwnCouncilor || String(c.factionId) === String(state.observer)
  );
  const ownHabs = (state.rawSnapshot.habs || []).filter(h => h.factionId === state.observer);
  const xeno = Array.isArray(state.rawSnapshot.activeXenoforming) ? state.rawSnapshot.activeXenoforming : [];
  const activeSlot = state.rawSnapshot.globalResearch?.activeSlots?.[0];

  const gdp = toFiniteNumber(obs.totalGdp);
  document.getElementById('node1Val').textContent = gdp === null ? 'UNAVAILABLE' : `$${(gdp / 1e12).toFixed(1)}T`;
  document.getElementById('node2Val').textContent = `${ownCouncilors.length} Agents`;
  document.getElementById('node3Val').textContent = `${ownHabs.length} Habs`;
  document.getElementById('node4Val').textContent = activeSlot
    ? `${activeSlot.leadFactionName || 'UNAVAILABLE'} / ${Number(activeSlot.percent || 0).toFixed(1)}%`
    : 'UNAVAILABLE';
  document.getElementById('node5Val').textContent = `${xeno.length} Xeno Sites`;
}

function renderGeopoliticalMapAndSectors() {
  const sectorsContainer = document.getElementById('mapSectorsList');
  if (!sectorsContainer || !state.briefing.theaters) return;

  const mapContainer = document.querySelector('.init-map-container');
  if (mapContainer && window.WorldTheaterMap) {
    window.WorldTheaterMap.render(mapContainer, state.briefing.theaters, {
      observerName: state.briefing.observerName,
      onSelect: (theater) => showTheaterDetail(theater)
    });
  }

  sectorsContainer.innerHTML = state.briefing.theaters.map(t => {
    let toneClass = 'sector-neutral';
    if (t.hostileCount > 0) {
      toneClass = 'sector-danger';
    } else if (t.ownCount > 0) {
      toneClass = 'sector-success';
    }

    return `
      <button class="init-sector-item ${toneClass}" type="button" data-theater-id="${escapeHtml(t.id)}">
        <div>
          <div class="init-sector-name">${escapeHtml(t.name)}</div>
          <div>$${escapeHtml(t.gdpTrillion)}T combined GDP &bull; ${escapeHtml(t.nationsCount)} nations</div>
        </div>
        <span class="init-sector-badge">${escapeHtml(t.statusTone)}</span>
      </button>
    `;
  }).join('');

  sectorsContainer.querySelectorAll('[data-theater-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const theater = state.briefing.theaters.find(t => String(t.id) === button.dataset.theaterId);
      if (theater) showTheaterDetail(theater);
    });
  });
}

function showTheaterDetail(theater) {
  if (!window.MissionControlDetailPanel) return;
  const keyNations = (theater.keyNations || []).map(n => `${n.name}: ${n.executive || 'Independent'} / $${n.gdpTrillion}T GDP`).join('; ');
  window.MissionControlDetailPanel.open({
    eyebrow: 'THEATER DETAIL',
    title: theater.name,
    summary: `${theater.statusTone}. ${theater.xenoformingActive ? `${theater.xenoCount} xenoforming site(s) are visible in this theater.` : 'No visible xenoforming sites are reported in this theater.'}`,
    facts: [
      { label: 'Combined GDP', value: `$${theater.gdpTrillion}T` },
      { label: 'Nations', value: theater.nationsCount },
      { label: 'Observer control', value: theater.ownCount },
      { label: 'Priority rival control', value: theater.hostileCount },
      { label: 'Key holdings', value: keyNations || 'No nation detail available' }
    ]
  });
}

function renderFactionDonut() {
  const container = document.getElementById('factionDonutContainer');
  if (!container || !Array.isArray(state.rawSnapshot.factions)) return;

  const factions = state.rawSnapshot.factions;
  const getPower = (faction) => {
    const value = typeof faction.powerScore === 'number' ? faction.powerScore : faction.powerScore?.overall;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  };
  const knownFactions = factions.filter(faction => getPower(faction) !== null);
  const totalPower = knownFactions.reduce((sum, faction) => sum + getPower(faction), 0) || 1;

  const colors = ['var(--accent)', 'var(--danger)', 'var(--blue)', 'var(--gold)', 'var(--success)', 'var(--purple)'];
  let cumulativeAngle = 0;

  const paths = knownFactions.length <= 1
    ? `<circle cx="55" cy="55" r="36.5" fill="none" stroke="${knownFactions.length ? colors[0] : 'var(--line-strong)'}" stroke-width="17" opacity="0.9"/>`
    : knownFactions.map((f, i) => {
    const pVal = getPower(f);
    const sliceAngle = (pVal / totalPower) * 360;
    const startAngle = cumulativeAngle;
    const endAngle = cumulativeAngle + sliceAngle;
    cumulativeAngle = endAngle;

    const rad = Math.PI / 180;
    const rOuter = 45;
    const rInner = 28;
    const cx = 55;
    const cy = 55;

    const x1 = cx + rOuter * Math.cos(startAngle * rad);
    const y1 = cy + rOuter * Math.sin(startAngle * rad);
    const x2 = cx + rOuter * Math.cos(endAngle * rad);
    const y2 = cy + rOuter * Math.sin(endAngle * rad);

    const x3 = cx + rInner * Math.cos(endAngle * rad);
    const y3 = cy + rInner * Math.sin(endAngle * rad);
    const x4 = cx + rInner * Math.cos(startAngle * rad);
    const y4 = cy + rInner * Math.sin(startAngle * rad);

    const largeArc = sliceAngle > 180 ? 1 : 0;
    const d = `M ${x1} ${y1} A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} A ${rInner} ${rInner} 0 ${largeArc} 0 ${x4} ${y4} Z`;

      return `<path d="${d}" fill="${colors[i % colors.length]}" opacity="0.9"/>`;
    }).join('');

  container.innerHTML = `
    <div class="donut-wrapper">
      <div class="donut-svg-box">
        <svg viewBox="0 0 110 110" style="width: 100%; height: 100%;">
          ${paths}
          <circle cx="55" cy="55" r="24" fill="#070d1e" />
          <text x="55" y="58" text-anchor="middle" fill="#fff" font-family="var(--font-mono)" font-size="9" font-weight="800">POWER</text>
        </svg>
      </div>
      <div class="donut-legend">
        ${factions.map((f, i) => `
          <div class="donut-legend-item">
            <span><span class="donut-legend-color" style="background: ${getPower(f) === null ? 'var(--line-strong)' : colors[knownFactions.indexOf(f) % colors.length]};"></span>${escapeHtml(f.displayName)}</span>
          <strong>${getPower(f) === null ? 'UNAVAILABLE' : getPower(f)}</strong>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderResourceFlowChart() {
  const container = document.getElementById('resourceFlowChart');
  if (!container || !Array.isArray(state.rawSnapshot.factions)) return;

  const obs = state.rawSnapshot.factions.find(f => f.ID === state.observer) || {};
  const res = obs.resources || {};

  const resources = [
    { label: 'Water', val: toFiniteNumber(res.Water), color: 'var(--accent)' },
    { label: 'Volatiles', val: toFiniteNumber(res.Volatiles), color: 'var(--success)' },
    { label: 'Metals', val: toFiniteNumber(res.Metals), color: 'var(--gold)' },
    { label: 'Nobles', val: toFiniteNumber(res.NobleMetals), color: 'var(--init-pink)' },
    { label: 'Fissiles', val: toFiniteNumber(res.Fissiles), color: 'var(--purple)' }
  ];

  const maxVal = Math.max(...resources.map(r => r.val === null ? 0 : r.val), 1);

  const bars = resources.map((r, i) => {
    const x = 30 + i * 85;
    const known = r.val !== null;
    const h = known ? Math.max(0, (r.val / maxVal) * 100) : 0;
    const y = 130 - h;
    return `
      ${known ? `<rect x="${x}" y="${y}" width="28" height="${h}" fill="${r.color}" opacity="0.9"/>` : ''}
      ${known ? `<circle cx="${x + 14}" cy="${y}" r="3" fill="var(--text)" stroke="${r.color}" stroke-width="2"/>` : ''}
      <text x="${x + 14}" y="148" text-anchor="middle" fill="var(--text-muted)" font-family="var(--font-mono)" font-size="10">${r.label}</text>
      <text x="${x + 14}" y="${Math.max(12, y - 8)}" text-anchor="middle" fill="var(--text)" font-family="var(--font-mono)" font-size="10" font-weight="700">${known ? r.val : 'UNAVAILABLE'}</text>
    `;
  }).join('');

  // Connecting glow line
  const points = resources
    .filter(r => r.val !== null)
    .map((r) => `${44 + resources.indexOf(r) * 85},${130 - (r.val / maxVal) * 100}`)
    .join(' ');

  container.innerHTML = `
    <svg viewBox="0 0 460 160" style="width: 100%; height: 100%;">
      <line x1="20" y1="130" x2="440" y2="130" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
      <line x1="20" y1="80" x2="440" y2="80" stroke="rgba(255,255,255,0.04)" stroke-dasharray="3,3"/>
      <line x1="20" y1="30" x2="440" y2="30" stroke="rgba(255,255,255,0.04)" stroke-dasharray="3,3"/>
      <polyline points="${points}" fill="none" stroke="var(--accent)" stroke-width="1.5" opacity="0.6"/>
      ${bars}
    </svg>
  `;
}

function renderPowerTrajectoryChart() {
  const container = document.getElementById('powerTrajectoryChart');
  if (!container) return;

  const factions = (state.rawSnapshot.factions || [])
    .map(f => ({
      name: f.displayName || 'Unknown faction',
      id: f.ID,
      score: typeof f.powerScore === 'number' ? f.powerScore : f.powerScore?.overall
    }))
    .filter(f => Number.isFinite(f.score))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  if (factions.length === 0) {
    container.innerHTML = '<div class="chart-empty">Faction power is unavailable in this intelligence mode.</div>';
    return;
  }

  const rows = factions.map((f, index) => {
    const y = 17 + index * 23;
    const barWidth = Math.max(2, Math.round(Math.min(100, Math.max(0, f.score)) * 1.55));
    const isObserver = f.id === state.observer;
    return `
      <text x="0" y="${y + 4}" fill="${isObserver ? 'var(--accent-strong)' : 'var(--text-muted)'}" font-family="var(--font-sans)" font-size="9">${escapeHtml(f.name)}</text>
      <rect x="126" y="${y - 5}" width="155" height="8" fill="var(--line)"/>
      <rect x="126" y="${y - 5}" width="${barWidth}" height="8" fill="${isObserver ? 'var(--accent)' : 'var(--line-strong)'}"/>
      <text x="292" y="${y + 4}" fill="var(--text)" font-family="var(--font-mono)" font-size="9" text-anchor="end">${Math.round(f.score)}</text>
    `;
  }).join('');

  container.innerHTML = `
    <svg viewBox="0 0 300 140" style="width: 100%; height: 100%;" role="img" aria-label="Current faction power profile">
      ${rows}
      <line x1="126" y1="132" x2="281" y2="132" stroke="var(--line-strong)"/>
      <text x="126" y="139" fill="var(--text-dim)" font-family="var(--font-mono)" font-size="8">0</text>
      <text x="281" y="139" fill="var(--text-dim)" font-family="var(--font-mono)" font-size="8" text-anchor="end">100</text>
    </svg>
  `;
}

function renderDualAssetRings() {
  const container = document.getElementById('dualAssetRings');
  if (!container) return;

  const observer = (state.rawSnapshot.factions || []).find(f => f.ID === state.observer) || {};
  const metrics = [
    { label: 'Control points', value: observer.controlPointsCount ?? '—' },
    { label: 'Orbital sites', value: observer.habsCount ?? '—' },
    { label: 'Fleets', value: observer.fleetsCount ?? '—' }
  ];

  container.innerHTML = `
    <div class="asset-posture-grid">
      ${metrics.map(metric => `
        <div class="asset-posture-metric">
          <strong>${escapeHtml(metric.value)}</strong>
          <span>${escapeHtml(metric.label)}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function renderOperativeLeaderboard() {
  const container = document.getElementById('opLeaderboardList');
  if (!container || !state.briefing.operatives) return;

  const operatives = [...state.briefing.operatives].sort((a, b) => b.totalSkills - a.totalSkills).slice(0, 4);

  container.innerHTML = operatives.map(op => {
    const pct = Math.min(100, (op.totalSkills / 50) * 100);
    return `
      <div class="op-bar-row">
        <div class="op-bar-header">
          <span class="op-bar-name">${escapeHtml(op.name)} (${escapeHtml(op.profession)})</span>
          <span class="op-bar-score">${escapeHtml(op.topSkill)}</span>
        </div>
        <div class="op-bar-track">
          <div class="op-bar-fill" style="width: ${pct}%;"></div>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 9.5px; color: var(--text-dim); margin-top: 1px;">
          <span>Location: ${escapeHtml(op.location)}</span>
          <span>Assignment: ${escapeHtml(op.activeMission)}</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderHoldingsBubbleMatrix() {
  const container = document.getElementById('holdingsBubbleMatrix');
  if (!container || !state.rawSnapshot.nations) return;

  const topNations = [...state.rawSnapshot.nations].sort((a, b) => (b.GDP || 0) - (a.GDP || 0)).slice(0, 5);

  const colors = ['var(--blue)', 'var(--accent)', 'var(--init-pink)', 'var(--gold)', 'var(--success)'];

  container.innerHTML = topNations.map((n, i) => {
    const gdpTrill = ((n.GDP || 0) / 1e12).toFixed(1);
    const size = 42 + i * 4;
    return `
      <div class="holding-bubble" style="--bubble-accent: ${colors[i % colors.length]}; width: ${size}px; height: ${size}px; font-size: ${size < 48 ? '8.5px' : '9.5px'};" title="${escapeHtml(n.displayName)}: $${escapeHtml(gdpTrill)}T (${escapeHtml(n.executiveFactionName || 'Independent')})">
        <div style="font-weight: 900; line-height: 1;">${escapeHtml(n.displayName.slice(0, 5))}</div>
        <div style="font-size: 8px; opacity: 0.85;">$${escapeHtml(gdpTrill)}T</div>
      </div>
    `;
  }).join('');
}

function renderDirectivesStream() {
  const container = document.getElementById('directivesStreamList');
  renderExecutiveSitrep();
  if (!container || !state.briefing?.directives) return;

  const { geopolitical, council, space, research } = state.briefing.directives;
  const list = [...geopolitical, ...council, ...space, ...research].slice(0, 4);

  container.innerHTML = list.map(d => {
    let badgeClass = 'badge-standard';
    if (d.severity === 'CRITICAL') badgeClass = 'badge-critical';
    else if (d.severity === 'HIGH') badgeClass = 'badge-high';

    return `
      <div class="directive-pill-card">
        <div class="directive-left">
          <div class="directive-title-row">
            <span class="directive-badge ${badgeClass}">${escapeHtml(d.severity)}</span>
            <strong>${escapeHtml(d.title)}</strong>
            <span>&bull; ${escapeHtml(d.category)}</span>
          </div>
          <div>${escapeHtml(d.statement)}</div>
        </div>
        <div class="directive-order-box">
          <div>EXECUTIVE DIRECTIVE</div>
          <div>${escapeHtml(d.action)}</div>
        </div>
      </div>
    `;
  }).join('');
}

function renderExecutiveSitrep() {
  const container = document.getElementById('sitrepSummary');
  if (!container) return;
  const paragraphs = state.briefing?.sitrep?.summaryParagraphs || [];
  if (paragraphs.length === 0) {
    container.innerHTML = '<p><span>No SITREP is available for this intelligence view.</span></p>';
    return;
  }
  container.innerHTML = paragraphs.map((paragraph, index) => `
    <p data-index="${String(index + 1).padStart(2, '0')}">
      <span>${escapeHtml(paragraph)}</span>
    </p>
  `).join('');
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function showToast(msg) {
  const toast = document.getElementById('mcToast');
  if (!toast) return;
  toast.textContent = msg;
  toast.style.display = 'block';
  setTimeout(() => { toast.style.display = 'none'; }, 3500);
}
