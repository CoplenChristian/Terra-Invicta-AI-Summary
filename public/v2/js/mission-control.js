/**
 * Terra Invicta // Mission Control v2 Frontend Logic
 * Live Tactical Briefing & Actionable Directive Hub
 */

const state = {
  mode: 'player',
  observer: 4712,
  activeTab: 'all',
  briefing: null,
  rawSnapshot: null,
  isLoading: false
};

document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  loadBriefing();
});

function initEventListeners() {
  // Mode switcher
  document.querySelectorAll('.mc-mode-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.mc-mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.mode = btn.dataset.mode;
      loadBriefing();
    });
  });

  // Observer select
  const obsSelect = document.getElementById('mcObserverSelect');
  if (obsSelect) {
    obsSelect.addEventListener('change', (e) => {
      state.observer = parseInt(e.target.value, 10);
      loadBriefing();
    });
  }

  // Refresh button
  const refreshBtn = document.getElementById('mcRefreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.textContent = '⏳ CYCLING...';
      try {
        await fetch(`/api/refresh?mode=${state.mode}&observer=${state.observer}`, { method: 'POST' });
        await loadBriefing();
        showToast('✓ Telemetry uplink refreshed from latest save.');
      } catch (err) {
        showToast('⚠️ Refresh failed: ' + err.message);
      } finally {
        refreshBtn.innerHTML = '⟳ Refresh Telemetry';
      }
    });
  }

  // Directives Tabs
  document.querySelectorAll('.mc-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mc-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.activeTab = btn.dataset.tab;
      renderDirectives();
    });
  });

  // Copy SITREP Button
  const copyBtn = document.getElementById('btnCopySitrep');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      if (!state.briefing) return;
      const text = `[TERRA INVICTA // MISSION CONTROL SITREP]\nDate: ${state.briefing.campaignDate}\nObserver: ${state.briefing.observerName}\nDEFCON: ${state.briefing.sitrep?.defcon}\n\n${state.briefing.sitrep?.summaryParagraphs?.join('\n\n')}`;
      navigator.clipboard.writeText(text);
      showToast('✓ Executive SITREP copied to clipboard.');
    });
  }
}

async function loadBriefing() {
  state.isLoading = true;
  const container = document.getElementById('mcMainContainer');
  if (container) container.style.opacity = '0.6';

  try {
    const res = await fetch(`/api/v2/briefing?mode=${state.mode}&observer=${state.observer}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to fetch briefing');

    state.briefing = data.briefing;
    state.rawSnapshot = data.data;

    populateObserverSelect(state.rawSnapshot.factions || []);
    renderMissionControl();
  } catch (err) {
    console.error('Failed to load Mission Control briefing:', err);
    showToast('⚠️ Error loading telemetry: ' + err.message);
  } finally {
    state.isLoading = false;
    if (container) container.style.opacity = '1';
  }
}

function populateObserverSelect(factions) {
  const select = document.getElementById('mcObserverSelect');
  if (!select || select.options.length > 1) return;

  select.innerHTML = factions.map(f => `
    <option value="${f.ID}" ${f.ID === state.observer ? 'selected' : ''}>${f.displayName}</option>
  `).join('');
}

function renderMissionControl() {
  if (!state.briefing) return;

  renderStatusBar();
  renderSitrepTerminal();
  renderDirectives();
  renderTheaters();
  renderOperativesRoster();
}

function renderStatusBar() {
  const { campaignDate, observerName, powerScore, sitrep } = state.briefing;
  const meta = state.rawSnapshot?.metadata || {};

  document.getElementById('mcStatusDate').textContent = campaignDate;
  document.getElementById('mcStatusSave').textContent = meta.activeSaveFileName || 'Latest';
  document.getElementById('mcStatusObserver').textContent = observerName;
  document.getElementById('mcStatusPower').textContent = `${powerScore}/100`;

  const defconElem = document.getElementById('mcStatusDefcon');
  if (defconElem) {
    defconElem.textContent = sitrep.defcon;
    defconElem.className = 'mc-defcon-badge ' + (sitrep.defcon.includes('DEFCON 2') ? 'defcon-critical' : 'defcon-elevated');
  }
}

function renderSitrepTerminal() {
  const { sitrep, observerName } = state.briefing;
  const terminal = document.getElementById('mcSitrepContent');
  if (!terminal) return;

  terminal.innerHTML = sitrep.summaryParagraphs.map(p => `<p>${p}</p>`).join('');

  // HUD Metrics
  const hud = document.getElementById('mcHudGrid');
  if (hud && sitrep.keyMetrics) {
    hud.innerHTML = Object.entries(sitrep.keyMetrics).map(([key, val]) => `
      <div class="mc-hud-metric">
        <span class="mc-hud-label">${formatLabel(key)}</span>
        <span class="mc-hud-value">${val}</span>
      </div>
    `).join('');
  }
}

function renderDirectives() {
  const container = document.getElementById('mcDirectivesGrid');
  if (!container || !state.briefing?.directives) return;

  const { geopolitical, council, space, research } = state.briefing.directives;
  let list = [];

  if (state.activeTab === 'all') {
    list = [...geopolitical, ...council, ...space, ...research];
  } else if (state.activeTab === 'geo') {
    list = geopolitical;
  } else if (state.activeTab === 'council') {
    list = council;
  } else if (state.activeTab === 'space') {
    list = space;
  } else if (state.activeTab === 'research') {
    list = research;
  }

  if (list.length === 0) {
    container.innerHTML = `<div style="grid-column: 1 / -1; color: var(--mc-text-dim); text-align: center; padding: 30px;">No priority directives for this department.</div>`;
    return;
  }

  container.innerHTML = list.map(d => {
    let sevClass = 'severity-standard';
    if (d.severity === 'CRITICAL') sevClass = 'severity-critical';
    else if (d.severity === 'HIGH') sevClass = 'severity-high';

    return `
      <div class="mc-directive-card">
        <div class="mc-directive-header">
          <div>
            <div style="font-size: 10px; font-family: var(--mc-font-mono); color: var(--mc-text-dim); text-transform: uppercase; margin-bottom: 2px;">${d.category}</div>
            <div class="mc-directive-title">${d.title}</div>
          </div>
          <span class="mc-severity-badge ${sevClass}">${d.severity}</span>
        </div>

        <div class="mc-directive-statement">${d.statement}</div>

        <div class="mc-directive-action-box">
          <div class="mc-directive-action-label">COMMAND DIRECTIVE</div>
          <div>${d.action}</div>
        </div>

        <div class="mc-directive-footer">
          <span>Success Factor: <strong style="color: var(--mc-text-main);">${d.successFactor}</strong></span>
          ${d.target ? `<span>Target: <strong style="color: var(--mc-cyan);">${d.target}</strong></span>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function renderTheaters() {
  const container = document.getElementById('mcTheatersGrid');
  if (!container || !state.briefing?.theaters) return;

  container.innerHTML = state.briefing.theaters.map(t => `
    <div class="mc-theater-card">
      <div class="mc-theater-header">
        <div>
          <div class="mc-theater-name">${t.name}</div>
          <div style="font-size: 10px; font-family: var(--mc-font-mono); color: var(--mc-text-dim);">$${t.gdpTrillion}T Combined GDP</div>
        </div>
        <span class="mc-theater-status" style="background: rgba(0,0,0,0.3); border: 1px solid ${t.statusColor}; color: ${t.statusColor};">${t.statusTone}</span>
      </div>

      <div style="margin-top: 4px;">
        ${t.keyNations.map(n => `
          <div class="mc-theater-nation-row">
            <div>
              <strong style="color: #fff;">${n.name}</strong>
              <span style="font-size: 10px; color: var(--mc-text-dim); margin-left: 4px;">($${n.gdpTrillion}T)</span>
            </div>
            <div style="font-family: var(--mc-font-mono); font-size: 10.5px;">
              ${n.executive ? `<span style="color: ${n.executive.includes('Servant') ? 'var(--mc-crimson)' : 'var(--mc-cyan)'};">${n.executive}</span>` : '<span style="color: var(--mc-text-dim);">Independent</span>'}
              ${n.nukes > 0 ? `<span style="color: #fbbf24; margin-left: 4px;" title="${n.nukes} Nuclear Barrages">☢ ${n.nukes}</span>` : ''}
            </div>
          </div>
        `).join('')}
      </div>

      ${t.xenoformingActive ? `
        <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); padding: 6px 10px; border-radius: 4px; font-size: 11px; color: #fca5a5; font-family: var(--mc-font-mono);">
          ⚠️ ACTIVE XENOFORMING IN SECTOR (${t.xenoCount} Sites)
        </div>
      ` : ''}
    </div>
  `).join('');
}

function renderOperativesRoster() {
  const tbody = document.getElementById('mcOperativesTableBody');
  if (!tbody || !state.briefing?.operatives) return;

  if (state.briefing.operatives.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--mc-text-dim); padding: 24px;">No active operatives on the roster.</td></tr>`;
    return;
  }

  tbody.innerHTML = state.briefing.operatives.map(op => `
    <tr>
      <td>
        <strong style="color: #fff;">${op.name}</strong>
        <div style="font-size: 10px; color: var(--mc-text-dim); font-family: var(--mc-font-mono);">${op.profession}</div>
      </td>
      <td>
        <span class="mc-location-tag">📍 ${op.location}</span>
        <div style="font-size: 9.5px; color: var(--mc-text-dim);">${op.locationType}</div>
      </td>
      <td>
        <div style="font-family: var(--mc-font-mono); color: #fbbf24;">🎯 ${op.activeMission}</div>
        ${op.activeMissionTarget ? `<div style="font-size: 9.5px; color: var(--mc-text-dim);">&rarr; ${op.activeMissionTarget}</div>` : ''}
      </td>
      <td style="font-family: var(--mc-font-mono); color: var(--mc-cyan); font-weight: 700;">
        ${op.topSkill}
        <div style="font-size: 9.5px; color: var(--mc-text-dim);">Sum: ${op.totalSkills}</div>
      </td>
      <td>
        <span style="font-family: var(--mc-font-mono); font-size: 10px; padding: 2px 6px; border-radius: 3px; background: rgba(0,0,0,0.3); border: 1px solid ${op.readinessColor}; color: ${op.readinessColor};">
          ${op.readiness}
        </span>
      </td>
      <td>
        <div class="mc-order-badge">
          <strong>Directive:</strong> ${op.recommendedOrder}
        </div>
      </td>
    </tr>
  `).join('');
}

function formatLabel(str) {
  return str.replace(/([A-Z])/g, ' $1').trim();
}

function showToast(msg) {
  const toast = document.getElementById('mcToast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3500);
}
