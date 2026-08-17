// Main Application Controller
let state = {
  mode: 'player',
  observerId: 4712,
  activeTab: 'overview',
  snapshot: null,
  nationFilter: 'all',
  nationSearch: '',
  councilorSearch: '',
  councilorFactionFilter: 'all',
  earthSubView: 'nations',
  spaceSubView: 'mining',
  techSubView: 'global',
  dossierFactionId: 4712
};

document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  loadData();
});

function initEventListeners() {
  // Mode Switcher
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      state.mode = e.target.dataset.mode;
      updateOmniBanner();
      loadData();
    });
  });

  // Observer Selector
  const observerSelect = document.getElementById('observerSelect');
  observerSelect.addEventListener('change', (e) => {
    state.observerId = parseInt(e.target.value, 10);
    state.dossierFactionId = state.observerId;
    document.getElementById('factionDossierSelect').value = state.observerId;
    loadData();
  });

  // Refresh Button
  document.getElementById('btnRefresh').addEventListener('click', async () => {
    showToast('Refreshing save from disk...');
    try {
      const res = await API.refresh(state.mode, state.observerId);
      if (res.success) {
        state.snapshot = res.data;
        renderAll();
        showToast('Latest save loaded successfully!');
      } else {
        showToast('Error: ' + res.error);
      }
    } catch (err) {
      showToast('Refresh failed: ' + err.message);
    }
  });

  // Sidebar Navigation
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const targetTab = item.dataset.tab;
      switchTab(targetTab);
    });
  });

  // Earth Sub-views
  document.querySelectorAll('[data-earth-view]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('[data-earth-view]').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      state.earthSubView = e.target.dataset.earthView;
      renderEarthSubView();
    });
  });

  // Space Sub-views
  document.querySelectorAll('[data-space-view]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('[data-space-view]').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      state.spaceSubView = e.target.dataset.spaceView;
      renderSpaceSubView();
    });
  });

  // Technology Sub-views
  document.querySelectorAll('[data-tech-view]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('[data-tech-view]').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      state.techSubView = e.target.dataset.techView;
      renderTechSubView();
    });
  });

  // Nation Filters
  document.querySelectorAll('[data-nation-filter]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('[data-nation-filter]').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      state.nationFilter = e.target.dataset.nationFilter;
      renderNationsTable();
    });
  });

  // Nation Search
  document.getElementById('nationSearch').addEventListener('input', (e) => {
    state.nationSearch = e.target.value.toLowerCase();
    renderNationsTable();
  });

  // Councilor Search
  document.getElementById('councilorSearch').addEventListener('input', (e) => {
    state.councilorSearch = e.target.value.toLowerCase();
    renderCouncilorsGrid();
  });

  // Councilor Faction Filter
  document.getElementById('councilorFactionFilter').addEventListener('change', (e) => {
    state.councilorFactionFilter = e.target.value;
    renderCouncilorsGrid();
  });

  // Faction Dossier Selector
  document.getElementById('factionDossierSelect').addEventListener('change', (e) => {
    state.dossierFactionId = parseInt(e.target.value, 10);
    renderFactionDossier();
  });

  // Export Buttons
  document.getElementById('btnCopyCompactExport').addEventListener('click', async () => {
    const res = await API.getExport('chatgpt', state.mode, state.observerId);
    if (res.success) {
      navigator.clipboard.writeText(res.markdown);
      showToast('Compact Snapshot copied to clipboard!');
    }
  });

  document.getElementById('btnCopyFullExport').addEventListener('click', async () => {
    const res = await API.getExport('full', state.mode, state.observerId);
    if (res.success) {
      navigator.clipboard.writeText(res.markdown);
      showToast('Full Snapshot report copied to clipboard!');
    }
  });
}

function updateOmniBanner() {
  const banner = document.getElementById('omniBanner');
  if (state.mode === 'omniscient' || state.mode === 'enhanced') {
    banner.classList.remove('hidden');
    banner.style.background = state.mode === 'omniscient' ? 'rgba(255, 23, 68, 0.15)' : 'rgba(245, 158, 11, 0.15)';
    banner.style.borderColor = state.mode === 'omniscient' ? 'rgba(255, 23, 68, 0.4)' : 'rgba(245, 158, 11, 0.4)';
    banner.style.color = state.mode === 'omniscient' ? '#ff80ab' : '#fbbf24';
  } else {
    banner.classList.add('hidden');
  }
}

function switchTab(tabId) {
  state.activeTab = tabId;
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.tab === tabId);
  });
  document.querySelectorAll('.content-section').forEach(sec => {
    sec.classList.toggle('active', sec.id === `section-${tabId}`);
  });
  if (tabId === 'export') {
    renderExportPreview();
  }
}

async function loadData() {
  try {
      const res = await API.getSnapshot(state.mode, state.observerId);
      if (res.success) {
        if (res.staticOnly && state.mode !== 'player') {
          state.mode = 'player';
          document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === 'player');
          });
          updateOmniBanner();
          showToast('Hosted view provides Player Intel snapshots only.');
        }
        state.snapshot = res.data;
      renderAll();
    } else {
      showToast('Error loading snapshot: ' + res.error);
    }
  } catch (err) {
    showToast('Failed to connect to server: ' + err.message);
  }
}

function renderAll() {
  if (!state.snapshot) return;

  renderMetadata();
  renderOverview();
  renderEarth();
  renderSpace();
  renderFactionDossier();
  renderTechnology();
  renderIntelligence();
  if (state.activeTab === 'export') {
    renderExportPreview();
  }
}

function renderMetadata() {
  const meta = state.snapshot.metadata;
  document.getElementById('metaDate').textContent = meta.gameTimeString || 'Unknown';
  document.getElementById('metaSaveName').textContent = meta.fileName || 'Save';
  document.getElementById('metaDifficulty').textContent = meta.difficulty || 'Normal';
  document.getElementById('metaMtime').textContent = meta.lastModified ? new Date(meta.lastModified).toLocaleTimeString() : '--';
}

function renderOverview() {
  const factions = state.snapshot.factions;
  const observer = factions.find(f => f.ID === state.snapshot.observerFactionId) || factions[0];

  // Threat badge in header
  const hateBadgeArea = document.getElementById('overviewAlienHateBadge');
  const hate = observer?.alienHate;
  if (hate) {
    if (hate.visibility === 'unavailable') {
      hateBadgeArea.innerHTML = `<span class="chip chip-dim" title="Requires Alien Operations research">Threat Estimate: UNAVAILABLE</span>`;
    } else if (hate.visibility === 'estimated') {
      hateBadgeArea.innerHTML = `<span class="chip chip-danger" title="Game-visible estimated threat level">Assessed Threat: ${hate.visibleEstimate}</span>`;
    } else {
      hateBadgeArea.innerHTML = `<span class="chip chip-danger" title="Raw Save Alien Hate">Alien Hate (Raw): ${hate.actual.toFixed(2)}</span>`;
    }
  }

  // Faction Cards Grid
  const cardsGrid = document.getElementById('factionCardsGrid');
  cardsGrid.innerHTML = factions.map(f => {
    const gdpT = ((f.totalGdp || 0) / 1e12).toFixed(1);
    const resK = ((f.totalResearch || 0) / 1e3).toFixed(1);
    const isObserver = f.ID === state.snapshot.observerFactionId;

    return `
      <div class="card" style="border-top: 3px solid ${f.color}; ${isObserver ? 'box-shadow: 0 0 10px rgba(0, 229, 255, 0.2);' : ''}">
        <div class="card-header">
          <div class="card-title">
            <span class="faction-indicator" style="background: ${f.color};"></span>
            <span>${f.displayName}</span>
          </div>
          <span class="card-badge" style="background: rgba(255,255,255,0.06); color: ${f.color};">
            Dashboard estimate: ${f.powerScore?.overall ?? 'UNKNOWN'}
          </span>
        </div>

        <div class="stat-row">
          <span class="stat-label">Controlled Nations</span>
          <span class="stat-value">${f.nationsCount}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Control Points</span>
          <span class="stat-value">${f.controlPointsCount}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">GDP</span>
          <span class="stat-value">$${gdpT}T</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Monthly Research</span>
          <span class="stat-value">${resK}k / mo</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Habs / Stations</span>
          <span class="stat-value">${formatVisibleMetric(f.habsCount, f.spaceVisibility)}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Fleet Ships / Power</span>
          <span class="stat-value">${formatVisibleMetric(f.shipsCount, f.spaceVisibility)} ships (${formatVisibleMetric(f.combatPowerAvailable ? f.combatPower : null, f.spaceVisibility)})</span>
        </div>
      </div>
    `;
  }).join('');

  // Balance Matrix Table
  const matrixBody = document.getElementById('balanceMatrixBody');
  matrixBody.innerHTML = factions.map(f => {
    const gdpT = ((f.totalGdp || 0) / 1e12).toFixed(1);
    const resK = ((f.totalResearch || 0) / 1e3).toFixed(1);
    const hateVal = f.alienHate?.visibility === 'unavailable'
      ? '<span style="color:var(--text-dim);">Unavailable</span>'
      : (f.alienHate?.visibleEstimate || '0');

    return `
      <tr>
        <td style="font-weight: 700; color: ${f.color};">
          <span class="faction-indicator" style="background: ${f.color}; margin-right: 6px;"></span>
          ${f.displayName}
        </td>
        <td><strong style="color: var(--color-initiative);">${f.powerScore?.overall ?? 'UNKNOWN'}</strong>${f.powerScore?.overall !== null && f.powerScore?.overall !== undefined ? '/100' : ''}</td>
        <td>${f.nationsCount}</td>
        <td>${f.controlPointsCount}</td>
        <td>$${gdpT}T</td>
        <td>${resK}k</td>
        <td>${formatVisibleMetric(f.habsCount, f.spaceVisibility)}</td>
        <td>${formatVisibleMetric(f.shipsCount, f.spaceVisibility)}</td>
        <td>${formatVisibleMetric(f.combatPowerAvailable ? f.combatPower : null, f.spaceVisibility)}</td>
        <td>${hateVal}</td>
      </tr>
    `;
  }).join('');
}

function renderEarth() {
  renderNationsTable();
  renderCouncilorsGrid();
  renderServantTargets();
}

function renderEarthSubView() {
  document.getElementById('earthNationsView').style.display = state.earthSubView === 'nations' ? 'block' : 'none';
  document.getElementById('earthCouncilorsView').style.display = state.earthSubView === 'councilors' ? 'block' : 'none';
  document.getElementById('earthTargetsView').style.display = state.earthSubView === 'targets' ? 'block' : 'none';
}

function renderNationsTable() {
  const tbody = document.getElementById('nationsTableBody');
  let nations = state.snapshot.nations || [];

  // Filter
  if (state.nationFilter === 'major') {
    nations = nations.filter(n => (n.GDP || 0) >= 1e12);
  } else if (state.nationFilter === 'nuclear') {
    nations = nations.filter(n => (n.nukes || 0) > 0);
  } else if (state.nationFilter === 'servants') {
    nations = nations.filter(n => n.controlPoints.some(cp => cp.factionName === 'the Servants'));
  } else if (state.nationFilter === 'aliens') {
    nations = nations.filter(n => n.executiveFactionName === 'the Aliens');
  }

  // Search
  if (state.nationSearch) {
    nations = nations.filter(n => n.displayName.toLowerCase().includes(state.nationSearch));
  }

  tbody.innerHTML = nations.slice(0, 100).map(n => {
    const gdpB = ((n.GDP || 0) / 1e9).toFixed(0);
    const gdpStr = (n.GDP || 0) >= 1e12 ? `$${((n.GDP || 0) / 1e12).toFixed(2)}T` : `$${gdpB}B`;
    const execColor = getFactionColorByName(n.executiveFactionName);

    return `
      <tr>
        <td style="font-weight: 600;">${n.displayName}</td>
        <td style="color: ${execColor}; font-weight: 700;">${n.executiveFactionName}</td>
        <td>${n.controlPoints.length} CPs</td>
        <td>${gdpStr}</td>
        <td>${(n.milTech || 0).toFixed(1)}</td>
        <td>${n.armies}</td>
        <td>${n.nukes > 0 ? `<span class="chip chip-danger">☢ ${n.nukes}</span>` : '0'}</td>
        <td>${(n.unrest || 0).toFixed(1)}</td>
        <td>${(n.cohesion || 0).toFixed(1)}</td>
        <td>${(n.boost || 0).toFixed(2)}</td>
        <td>${n.missionControl || 0}</td>
      </tr>
    `;
  }).join('');
}

function renderCouncilorsGrid() {
  const grid = document.getElementById('councilorsGrid');
  let councilors = state.snapshot.councilors || [];

  // Update faction filter options
  const filterSelect = document.getElementById('councilorFactionFilter');
  const knownFactions = Array.from(new Set(councilors.map(c => c.factionName))).filter(Boolean);
  filterSelect.innerHTML = `<option value="all">All Known Factions (${councilors.length})</option>` +
    knownFactions.map(f => `<option value="${f}" ${state.councilorFactionFilter === f ? 'selected' : ''}>${f}</option>`).join('');

  if (state.councilorFactionFilter !== 'all') {
    councilors = councilors.filter(c => c.factionName === state.councilorFactionFilter);
  }

  if (state.councilorSearch) {
    councilors = councilors.filter(c =>
      c.displayName.toLowerCase().includes(state.councilorSearch) ||
      c.orgs.some(o => o.displayName.toLowerCase().includes(state.councilorSearch))
    );
  }

  grid.innerHTML = councilors.map(c => {
    const fColor = getFactionColorByName(c.factionName);
    const isMole = c.isTurnedMole;

    return `
      <div class="card" style="border-left: 3px solid ${isMole ? '#d500f9' : fColor};">
        <div class="card-header">
          <div>
            <div class="card-title">${c.displayName}</div>
            <div style="font-size: 11px; color: ${fColor}; font-family: var(--font-mono);">${c.factionName} (${c.typeTemplateName})</div>
          </div>
          <div>
            ${isMole ? `<span class="chip chip-mole">TURNED MOLE</span>` : ''}
            ${c.isAlien ? `<span class="chip chip-danger">HYDRA</span>` : ''}
            <span class="chip chip-info">${c.status}</span>
          </div>
        </div>

        <div class="stat-row">
          <span class="stat-label">Location</span>
          <span class="stat-value">${c.locationName}</span>
        </div>

        <div style="margin: 10px 0; font-size: 11px; font-family: var(--font-mono); display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px;">
          <div>ADM: <strong>${formatAttr(c.maskedAttributes?.Administration)}</strong></div>
          <div>PER: <strong>${formatAttr(c.maskedAttributes?.Persuasion)}</strong></div>
          <div>INV: <strong>${formatAttr(c.maskedAttributes?.Investigation)}</strong></div>
          <div>ESP: <strong>${formatAttr(c.maskedAttributes?.Espionage)}</strong></div>
          <div>CMD: <strong>${formatAttr(c.maskedAttributes?.Command)}</strong></div>
          <div>SCI: <strong>${formatAttr(c.maskedAttributes?.Science)}</strong></div>
          <div>SEC: <strong>${formatAttr(c.maskedAttributes?.Security)}</strong></div>
          <div>LOY: <strong>${formatAttr(c.maskedAttributes?.Loyalty)}</strong></div>
        </div>

        ${c.orgs?.length > 0 ? `
          <div style="font-size: 11px; color: var(--text-muted); margin-top: 6px;">
            <strong>Orgs:</strong> ${c.orgs.map(o => o.displayName).join(', ')}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

function formatAttr(attrObj) {
  if (!attrObj) return '?';
  if (attrObj.visibility === 'unknown' || attrObj.visibility === 'unavailable') return '?';
  return attrObj.visible !== null ? attrObj.visible : '?';
}

function renderServantTargets() {
  const grid = document.getElementById('servantTargetsGrid');
  const targets = state.snapshot.servantTargets || [];
  const targetFaction = state.snapshot.priorityTargetFaction?.name || 'the Servants';
  const heading = document.getElementById('priorityTargetsHeading');
  if (heading) {
    heading.textContent = `🎯 ${targetFaction.toUpperCase()} HOLDINGS — PRIORITY STRATEGIC TARGETS`;
  }

  if (targets.length === 0) {
    grid.innerHTML = `<div style="color: var(--text-muted); font-size: 13px;">No major ${targetFaction} targets currently scored.</div>`;
    return;
  }

  grid.innerHTML = targets.slice(0, 12).map(t => {
    return `
      <div class="card" style="border-top: 3px solid #d500f9;">
        <div class="card-header">
          <div class="card-title">${t.nationName}</div>
          <span class="card-badge" style="background: rgba(213, 0, 249, 0.2); color: #e040fb;">
            Score: ${t.score}/100
          </span>
        </div>

        <div class="stat-row">
          <span class="stat-label">${targetFaction} Holdings</span>
          <span class="stat-value" style="color: ${getFactionColorByName(targetFaction)};">${t.targetCPCount ?? t.servantCPCount} / ${t.totalCPCount} CPs</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Economy (GDP)</span>
          <span class="stat-value">$${t.gdpTrillion}T</span>
        </div>
        ${t.nukes > 0 ? `
          <div class="stat-row">
            <span class="stat-label">Nuclear Arsenal</span>
            <span class="stat-value" style="color: #ff1744;">${t.nukes} Barrage(s)</span>
          </div>
        ` : ''}

        <div style="margin-top: 8px; font-size: 11px; color: #cbd5e1;">
          <strong>Strategic Rationale:</strong>
          <ul style="margin-left: 16px; margin-top: 4px;">
            ${t.reasons.map(r => `<li>${r}</li>`).join('')}
          </ul>
        </div>
      </div>
    `;
  }).join('');
}

function renderSpace() {
  renderSpaceSubView();
  renderMiningTable();
  renderHabsTable();
  renderFleetsTable();
}

function renderSpaceSubView() {
  document.getElementById('spaceMiningView').style.display = state.spaceSubView === 'mining' ? 'block' : 'none';
  document.getElementById('spaceHabsView').style.display = state.spaceSubView === 'habs' ? 'block' : 'none';
  document.getElementById('spaceFleetsView').style.display = state.spaceSubView === 'fleets' ? 'block' : 'none';
}

function renderMiningTable() {
  const tbody = document.getElementById('miningTableBody');
  const sites = state.snapshot.habSites || [];

  tbody.innerHTML = sites.slice(0, 100).map(s => {
    const fColor = getFactionColorByName(s.factionName);
    return `
      <tr>
        <td style="font-weight: 600;">${s.displayName}</td>
        <td>${s.parentBodyName}</td>
        <td style="color: ${fColor}; font-weight: 700;">${s.factionName}</td>
        <td>${Number(s.water || 0).toFixed(2)}</td>
        <td>${Number(s.volatiles || 0).toFixed(2)}</td>
        <td>${Number(s.metals || 0).toFixed(2)}</td>
        <td>${Number(s.nobleMetals || 0).toFixed(2)}</td>
        <td>${Number(s.fissiles || 0).toFixed(2)}</td>
      </tr>
    `;
  }).join('');
}

function renderHabsTable() {
  const tbody = document.getElementById('habsTableBody');
  const habs = state.snapshot.habs || [];

  tbody.innerHTML = habs.map(h => {
    const fColor = getFactionColorByName(h.factionName);
    return `
      <tr>
        <td style="font-weight: 600;">${h.displayName}</td>
        <td style="color: ${fColor}; font-weight: 700;">${h.factionName}</td>
        <td>${h.habType}</td>
        <td>Tier ${h.tier}</td>
        <td>${h.orbitBody}</td>
        <td>${h.inEarthLEO ? 'LEO' : 'Deep Orbit'}</td>
        <td>${h.inCombat ? '<span class="chip chip-danger">COMBAT</span>' : '<span class="chip chip-success">Operational</span>'}</td>
      </tr>
    `;
  }).join('');
}

function renderFleetsTable() {
  const tbody = document.getElementById('fleetsTableBody');
  const fleets = state.snapshot.fleets || [];

  tbody.innerHTML = fleets.map(fl => {
    const fColor = getFactionColorByName(fl.factionName);
    return `
      <tr>
        <td style="font-weight: 600;">${fl.displayName}</td>
        <td style="color: ${fColor}; font-weight: 700;">${fl.factionName}</td>
        <td>${fl.shipsCount}</td>
        <td><strong>${fl.combatPower ?? 'Unavailable'}</strong></td>
        <td>${fl.weaponSummary || fl.dominantWeaponType || 'Unknown'}</td>
        <td>${fl.orbitBody}</td>
        <td>${fl.mission}</td>
        <td>${fl.destination}</td>
        <td>${fl.arrivalDate ? `${fl.arrivalDate.year}-${fl.arrivalDate.month}-${fl.arrivalDate.day}` : 'Stationary'}</td>
      </tr>
    `;
  }).join('');
}

function renderFactionDossier() {
  const container = document.getElementById('factionDossierContent');
  const faction = (state.snapshot.factions || []).find(f => f.ID === state.dossierFactionId) || state.snapshot.factions[0];
  if (!faction) return;

  const gdpT = ((faction.totalGdp || 0) / 1e12).toFixed(1);
  const resK = ((faction.totalResearch || 0) / 1e3).toFixed(1);

  container.innerHTML = `
    <div class="card" style="border-top: 4px solid ${faction.color}; margin-bottom: 20px;">
      <div class="card-header">
        <div class="card-title" style="font-size: 18px;">
          <span class="faction-indicator" style="background: ${faction.color}; width: 14px; height: 14px;"></span>
          ${faction.displayName} Intelligence Summary
        </div>
        <span class="card-badge" style="background: ${faction.color}; color: #000; font-size: 12px;">
          Dashboard estimate: ${faction.powerScore?.overall ?? 'UNKNOWN'}${faction.powerScore?.overall !== null && faction.powerScore?.overall !== undefined ? '/100' : ''}
        </span>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin: 16px 0;">
        <div class="card" style="background: #0d1424;">
          <div class="stat-label">Earth Economy</div>
          <div style="font-size: 18px; font-weight: 800; color: #fff;">$${gdpT}T GDP</div>
          <div style="font-size: 11px; color: var(--text-dim);">${faction.controlPointsCount} CPs across ${faction.nationsCount} Nations</div>
        </div>
        <div class="card" style="background: #0d1424;">
          <div class="stat-label">Research Rate</div>
          <div style="font-size: 18px; font-weight: 800; color: #fff;">${resK}k / mo</div>
          <div style="font-size: 11px; color: var(--text-dim);">${faction.completedProjects?.length || 0} Projects Completed</div>
        </div>
        <div class="card" style="background: #0d1424;">
          <div class="stat-label">Space Fleet Power (save value)</div>
          <div style="font-size: 18px; font-weight: 800; color: #fff;">${formatVisibleMetric(faction.combatPowerAvailable ? faction.combatPower : null, faction.spaceVisibility)} Power</div>
          <div style="font-size: 11px; color: var(--text-dim);">${formatVisibleMetric(faction.shipsCount, faction.spaceVisibility)} Ships in ${formatVisibleMetric(faction.fleetsCount, faction.spaceVisibility)} Fleets</div>
        </div>
        <div class="card" style="background: #0d1424;">
          <div class="stat-label">Space Infrastructure</div>
          <div style="font-size: 18px; font-weight: 800; color: #fff;">${formatVisibleMetric(faction.habsCount, faction.spaceVisibility)} Habs / Stations</div>
          <div style="font-size: 11px; color: var(--text-dim);">${faction.resources?.Boost || 0} Boost Stockpile</div>
        </div>
      </div>

      <div class="section-title" style="font-size: 13px; margin: 16px 0 8px; color: var(--text-muted);">
        RESOURCE STOCKPILES
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; font-family: var(--font-mono); font-size: 12px;">
        <div style="background: #090e1a; padding: 6px 10px; border-radius: 4px;">Money: <strong>$${(faction.resources?.Money || 0).toLocaleString()}</strong></div>
        <div style="background: #090e1a; padding: 6px 10px; border-radius: 4px;">Influence: <strong>${(faction.resources?.Influence || 0).toLocaleString()}</strong></div>
        <div style="background: #090e1a; padding: 6px 10px; border-radius: 4px;">Ops: <strong>${(faction.resources?.Operations || 0).toLocaleString()}</strong></div>
        <div style="background: #090e1a; padding: 6px 10px; border-radius: 4px;">Boost: <strong>${faction.resources?.Boost || 0}</strong></div>
        <div style="background: #090e1a; padding: 6px 10px; border-radius: 4px;">Water: <strong>${(faction.resources?.Water || 0).toLocaleString()}</strong></div>
        <div style="background: #090e1a; padding: 6px 10px; border-radius: 4px;">Volatiles: <strong>${(faction.resources?.Volatiles || 0).toLocaleString()}</strong></div>
        <div style="background: #090e1a; padding: 6px 10px; border-radius: 4px;">Metals: <strong>${(faction.resources?.Metals || 0).toLocaleString()}</strong></div>
        <div style="background: #090e1a; padding: 6px 10px; border-radius: 4px;">Nobles: <strong>${(faction.resources?.NobleMetals || 0).toLocaleString()}</strong></div>
        <div style="background: #090e1a; padding: 6px 10px; border-radius: 4px;">Fissiles: <strong>${(faction.resources?.Fissiles || 0).toLocaleString()}</strong></div>
      </div>
    </div>
  `;
}

function renderTechnology() {
  renderTechSubView();
  renderGlobalTechSlots();
  renderTechMatrix();
  renderTechInspector();
}

function renderTechSubView() {
  document.getElementById('techGlobalView').style.display = state.techSubView === 'global' ? 'block' : 'none';
  document.getElementById('techMatrixView').style.display = state.techSubView === 'matrix' ? 'block' : 'none';
  document.getElementById('techInspectorView').style.display = state.techSubView === 'inspector' ? 'block' : 'none';
}

function renderGlobalTechSlots() {
  const grid = document.getElementById('globalTechSlotsGrid');
  const slots = state.snapshot.globalResearch?.activeSlots || [];

  grid.innerHTML = slots.map(s => {
    return `
      <div class="card" style="border-top: 3px solid var(--color-initiative);">
        <div class="card-header">
          <div class="card-title">Slot ${s.slotNumber}: ${s.displayName}</div>
          <span class="chip chip-info">${s.percent}%</span>
        </div>

        <div style="margin-bottom: 8px;">
          <div class="progress-bar-container">
            <div class="progress-fill" style="width: ${s.percent}%;"></div>
          </div>
        </div>

        <div class="stat-row">
          <span class="stat-label">Progress</span>
          <span class="stat-value">${s.accumulatedResearch.toLocaleString()} / ${s.totalCost.toLocaleString()}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Leading Contributor</span>
          <span class="stat-value" style="color: var(--color-initiative);">${s.leadFactionName} (${s.leadContribution.toLocaleString()})</span>
        </div>

        <div style="margin-top: 8px; font-size: 11px; color: var(--text-muted);">
          <strong>Faction Contributions:</strong>
          <div style="display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px;">
            ${s.contributions.map(c => `<span class="chip chip-dim">${c.factionName.replace('the ', '')}: ${c.contribution.toLocaleString()}</span>`).join('')}
          </div>
        </div>
      </div>
    `;
  }).join('');

  const completedBox = document.getElementById('completedTechsContainer');
  const completed = state.snapshot.globalResearch?.finishedTechsNames || [];
  completedBox.innerHTML = completed.map(t => `<span class="chip chip-success">✓ ${t}</span>`).join('');
}

function renderTechMatrix() {
  const thead = document.getElementById('techMatrixHeader');
  const tbody = document.getElementById('techMatrixBody');
  const matrix = state.snapshot.techMatrix || [];
  const factions = state.snapshot.factions || [];

  thead.innerHTML = `
    <tr>
      <th>Strategic Project</th>
      ${factions.map(f => `<th style="color: ${f.color}; text-align: center;">${f.displayName.replace('the ', '')}</th>`).join('')}
    </tr>
  `;

  tbody.innerHTML = matrix.map(row => {
    return `
      <tr>
        <td style="font-weight: 600;">${row.displayName}</td>
        ${factions.map(f => {
          const st = row.factions[f.ID]?.status || 'locked';
          let icon = '—';
          let chipClass = 'chip-dim';
          if (st === 'completed') { icon = '✓ Researched'; chipClass = 'chip-success'; }
          else if (st === 'researching') { icon = '◐ Researching'; chipClass = 'chip-info'; }
          else if (st === 'available') { icon = '○ Available'; chipClass = 'chip-warning'; }
          else if (st === 'unknown') { icon = '? Unknown'; chipClass = 'chip-dim'; }
          return `<td style="text-align: center;"><span class="chip ${chipClass}">${icon}</span></td>`;
        }).join('')}
      </tr>
    `;
  }).join('');
}

async function renderTechInspector() {
  const container = document.getElementById('techEffectsInspectorList');
  try {
    const res = await API.getEffectsInfo();
    if (res.success) {
      container.innerHTML = `
        <div style="margin-bottom: 12px; font-size: 12px; color: var(--text-muted);">
          Templates Source: <code>${res.templatesPath || 'StreamingAssets/Templates'}</code> (${res.techCount} techs, ${res.projectCount} projects, ${res.effectCount} effects loaded)
        </div>
        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th>Game Data ID</th>
                <th>Type</th>
                <th>Target Effect ID</th>
                <th>Validation Status</th>
              </tr>
            </thead>
            <tbody>
              ${res.validation.map(v => `
                <tr>
                  <td style="font-family: var(--font-mono); font-weight: 700;">${v.targetId}</td>
                  <td>${v.targetType}</td>
                  <td style="font-family: var(--font-mono); color: var(--color-initiative);">${v.expectedEffect}</td>
                  <td>${v.valid ? '<span class="chip chip-success">✓ VALIDATED IN TEMPLATE</span>' : '<span class="chip chip-danger">⚠ MISSING</span>'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }
  } catch (err) {
    container.innerHTML = `Failed loading effects inspection: ${err.message}`;
  }
}

function renderIntelligence() {
  const grid = document.getElementById('alienStagesGrid');
  const stages = state.snapshot.alienIntelligenceStage;
  if (!stages) return;

  grid.innerHTML = `
    <div class="card" style="border-top: 3px solid ${stages.abductions.active ? 'var(--color-success)' : 'var(--color-dim)'};">
      <div class="card-header">
        <div class="card-title">Stage 1: Abductions</div>
        <span class="chip ${stages.abductions.active ? 'chip-success' : 'chip-dim'}">${stages.abductions.status}</span>
      </div>
      <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 6px;"><strong>${stages.abductions.name}</strong></div>
      <div style="font-size: 11px; color: var(--text-dim);">${stages.abductions.description}</div>
    </div>

    <div class="card" style="border-top: 3px solid ${stages.contacts.active ? 'var(--color-success)' : 'var(--color-dim)'};">
      <div class="card-header">
        <div class="card-title">Stage 2: Contacts & Enthrall</div>
        <span class="chip ${stages.contacts.active ? 'chip-success' : 'chip-dim'}">${stages.contacts.status}</span>
      </div>
      <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 6px;"><strong>${stages.contacts.name}</strong></div>
      <div style="font-size: 11px; color: var(--text-dim);">${stages.contacts.description}</div>
    </div>

    <div class="card" style="border-top: 3px solid ${stages.operations.active ? 'var(--color-success)' : 'var(--color-dim)'};">
      <div class="card-header">
        <div class="card-title">Stage 3: Alien Operations</div>
        <span class="chip ${stages.operations.active ? 'chip-success' : 'chip-dim'}">${stages.operations.status}</span>
      </div>
      <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 6px;"><strong>${stages.operations.name}</strong></div>
      <div style="font-size: 11px; color: var(--text-dim);">${stages.operations.description}</div>
    </div>

    <div class="card" style="border-top: 3px solid ${stages.operatives.active ? 'var(--color-success)' : 'var(--color-dim)'};">
      <div class="card-header">
        <div class="card-title">Stage 4: Alien Operatives</div>
        <span class="chip ${stages.operatives.active ? 'chip-success' : 'chip-dim'}">${stages.operatives.status}</span>
      </div>
      <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 6px;"><strong>${stages.operatives.name}</strong></div>
      <div style="font-size: 11px; color: var(--text-dim);">${stages.operatives.description}</div>
       <div style="margin-top: 8px; font-size: 11px; font-weight: 700; color: var(--color-initiative);">Detected: ${stages.operatives.active ? (stages.operatives.detectedCount ?? 0) : 'UNAVAILABLE'}</div>
    </div>
  `;

  const xenoBody = document.getElementById('xenoformingTableBody');
  const xenos = state.snapshot.activeXenoforming || [];
  xenoBody.innerHTML = xenos.map(x => `
    <tr>
      <td style="font-weight: 600;">${x.regionName}</td>
      <td><strong>${x.level}</strong></td>
      <td><span class="chip chip-warning">Monitored Alien Activity</span></td>
    </tr>
  `).join('');
}

async function renderExportPreview() {
  const preview = document.getElementById('exportMarkdownPreview');
  const res = await API.getExport('chatgpt', state.mode, state.observerId);
  if (res.success) {
    preview.textContent = res.markdown;
  }
}

function getFactionColorByName(name) {
  const map = {
    'the Initiative': '#00e5ff',
    'the Resistance': '#2979ff',
    'Humanity First': '#ff1744',
    'the Academy': '#ffd600',
    'Project Exodus': '#ff9100',
    'the Protectorate': '#78909c',
    'the Servants': '#d500f9',
    'the Aliens': '#00e676'
  };
  return map[name] || '#94a3b8';
}

function formatVisibleMetric(value, visibility = 'confirmed') {
  if (value === null || value === undefined || visibility === 'unavailable') {
    return '<span style="color: var(--text-dim);">UNKNOWN</span>';
  }
  if (visibility === 'partial') {
    return `<span title="Known assets only">${value} visible</span>`;
  }
  return value;
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}
