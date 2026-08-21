// public/js/app.js
//
// Purpose: the legacy v1 dashboard controller — renders the old UI and must not
//   be edited.
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
  councilorMainSearch: '',
  councilorMainFaction: 'all',
  councilorProfession: 'all',
  councilorStatus: 'all',
  councilorSort: 'totalSkills',
  councilorViewMode: 'cards',
  councilorTableSort: { col: 'total', asc: false },
  councilorsDatasetKey: '',
  earthSubView: 'nations',
  spaceSubView: 'mining',
  techSubView: 'global',
  dossierFactionId: 4712,
  renderedTabs: new Set(['overview'])
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
  initializeRuntime()
    .catch(error => console.warn('[Runtime] Capability probe failed:', error.message))
    .finally(loadData);
});

async function initializeRuntime() {
  const publishButton = document.getElementById('btnPublishLatest');

  // Keep the control hidden unless the server explicitly identifies itself as
  // the local/dev runtime and opts into publishing.
  if (publishButton) publishButton.classList.add('hidden');
  const runtime = await API.getRuntime();
  const configuredObserver = Number(runtime?.defaults?.defaultObserverFactionId || runtime?.defaultObserverFactionId);
  if (Number.isSafeInteger(configuredObserver) && configuredObserver > 0) {
    state.observerId = configuredObserver;
    state.dossierFactionId = configuredObserver;
  }
  const localRuntime = runtime?.success && ['local', 'dev'].includes(runtime.environment);
  if (publishButton) publishButton.classList.toggle('hidden', !(localRuntime && runtime.canPublish === true));
}

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

  // Local/dev only: publish the newest save, then refresh the file-backed
  // dashboard so its in-memory snapshot matches what was just uploaded.
  document.getElementById('btnPublishLatest')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const originalLabel = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<span>⟳</span> Publishing...';
    showToast('Publishing the newest save to hosted Supabase...');

    try {
      const published = await API.publishLatest();
      if (!published.success) {
        throw new Error(published.error || 'Publish failed.');
      }

      const refreshed = await API.refresh(state.mode, state.observerId);
      if (refreshed.success) {
        state.snapshot = refreshed.data;
        renderAll();
      }

      const saveLabel = published.saveFilename ? ` (${published.saveFilename})` : '';
      showToast(`Published latest save${saveLabel}.`);
    } catch (err) {
      showToast('Publish failed: ' + err.message);
    } finally {
      button.disabled = false;
      button.innerHTML = originalLabel;
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

  // Dedicated Councilor Screen: View Mode Toggles (Cards / Table)
  document.getElementById('btnCouncilorViewCards')?.addEventListener('click', () => {
    state.councilorViewMode = 'cards';
    document.getElementById('btnCouncilorViewCards').classList.add('active');
    document.getElementById('btnCouncilorViewTable').classList.remove('active');
    document.getElementById('councilorsMainCardsView').style.display = 'grid';
    document.getElementById('councilorsMainTableView').style.display = 'none';
  });

  document.getElementById('btnCouncilorViewTable')?.addEventListener('click', () => {
    state.councilorViewMode = 'table';
    document.getElementById('btnCouncilorViewTable').classList.add('active');
    document.getElementById('btnCouncilorViewCards').classList.remove('active');
    document.getElementById('councilorsMainCardsView').style.display = 'none';
    document.getElementById('councilorsMainTableView').style.display = 'block';
  });

  // Dedicated Councilor Screen: Filters & Sorts
  document.getElementById('councilorMainSearch')?.addEventListener('input', (e) => {
    state.councilorMainSearch = e.target.value.toLowerCase();
    renderCouncilorsScreen();
  });

  document.getElementById('councilorMainFactionFilter')?.addEventListener('change', (e) => {
    state.councilorMainFaction = e.target.value;
    renderCouncilorsScreen();
  });

  document.getElementById('councilorProfessionFilter')?.addEventListener('change', (e) => {
    state.councilorProfession = e.target.value;
    renderCouncilorsScreen();
  });

  document.getElementById('councilorStatusFilter')?.addEventListener('change', (e) => {
    state.councilorStatus = e.target.value;
    renderCouncilorsScreen();
  });

  document.getElementById('councilorSortSelect')?.addEventListener('change', (e) => {
    state.councilorSort = e.target.value;
    renderCouncilorsScreen();
  });

  // Dedicated Councilor Screen: Table Header Sorting
  document.querySelectorAll('#councilorsSkillsTable th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (state.councilorTableSort.col === col) {
        state.councilorTableSort.asc = !state.councilorTableSort.asc;
      } else {
        state.councilorTableSort.col = col;
        state.councilorTableSort.asc = false;
      }
      renderCouncilorsScreen();
    });
  });

  // Modal Handlers
  document.getElementById('btnCloseCouncilorModal')?.addEventListener('click', closeCouncilorModal);
  document.getElementById('councilorModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'councilorModal') closeCouncilorModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeCouncilorModal();
  });

  // Delegated councilor detail opens (no inline onclick attributes).
  document.getElementById('councilorsMainCardsView')?.addEventListener('click', onCouncilorCardClick);
  document.getElementById('councilorsMainTableBody')?.addEventListener('click', onCouncilorCardClick);

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

  // Councilor Search (Earth tab)
  document.getElementById('councilorSearch').addEventListener('input', (e) => {
    state.councilorSearch = e.target.value.toLowerCase();
    renderCouncilorsGrid();
  });

  // Councilor Faction Filter (Earth tab)
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
  renderTab(tabId);
}

// Render a section's content on demand. Sections are rebuilt once per data
// load, so switching tabs never triggers wasted work for hidden panels.
function renderTab(tabId) {
  if (state.renderedTabs.has(tabId)) return;
  state.renderedTabs.add(tabId);
  switch (tabId) {
    case 'councilors': renderCouncilorsScreen(); break;
    case 'earth': renderEarth(); break;
    case 'space': renderSpace(); break;
    case 'factions': renderFactionDossier(); break;
    case 'technology': renderTechnology(); break;
    case 'intelligence': renderIntelligence(); break;
    case 'export': renderExportPreview(); break;
  }
}

// Keep the observer and dossier selectors in sync with the save's actual
// faction roster instead of the static option lists in the markup.
function populateObserverSelects() {
  const factions = state.snapshot?.factions || [];
  if (!factions.length) return;
  const optionHtml = factions.map(f =>
    `<option value="${escapeHtml(f.ID)}">${escapeHtml(f.displayName)}</option>`
  ).join('');

  const observerSelect = document.getElementById('observerSelect');
  if (observerSelect) {
    if (!factions.some(f => String(f.ID) === String(state.observerId))) {
      state.observerId = factions[0].ID;
      state.dossierFactionId = state.observerId;
    }
    observerSelect.innerHTML = optionHtml;
    observerSelect.value = String(state.observerId);
  }

  const dossierSelect = document.getElementById('factionDossierSelect');
  if (dossierSelect) {
    if (!factions.some(f => String(f.ID) === String(state.dossierFactionId))) {
      state.dossierFactionId = state.observerId;
    }
    dossierSelect.innerHTML = optionHtml;
    dossierSelect.value = String(state.dossierFactionId);
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
  populateObserverSelects();
  renderOverview();
  // A fresh data load invalidates every cached section.
  state.renderedTabs = new Set(['overview']);
  renderTab(state.activeTab);
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
      <div class="card" style="border-top: 3px solid ${escapeHtml(f.color)}; ${isObserver ? 'box-shadow: 0 0 10px rgba(0, 229, 255, 0.2);' : ''}">
        <div class="card-header">
          <div class="card-title">
            <span class="faction-indicator" style="background: ${escapeHtml(f.color)};"></span>
            <span>${escapeHtml(f.displayName)}</span>
          </div>
          <span class="card-badge" style="background: rgba(255,255,255,0.06); color: ${escapeHtml(f.color)};">
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
        <td style="font-weight: 700; color: ${escapeHtml(f.color)};">
          <span class="faction-indicator" style="background: ${escapeHtml(f.color)}; margin-right: 6px;"></span>
          ${escapeHtml(f.displayName)}
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
    // Alien activity is a region-level signal; match nations whose name
    // overlaps a xenoforming or alien-facility region (same heuristic the
    // briefing uses for theater status).
    const alienRegionNames = [
      ...(state.snapshot.activeXenoforming || []).map(x => String(x.regionName || '')),
      ...(state.snapshot.builtAlienFacilities || []).map(x => String(x.regionName || ''))
    ].map(name => name.toLowerCase()).filter(Boolean);
    nations = nations.filter(n => {
      if (n.executiveFactionName === 'the Aliens') return true;
      const name = String(n.displayName || '').toLowerCase();
      return alienRegionNames.some(region => region.includes(name) || name.includes(region));
    });
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
        <td style="font-weight: 600;">${escapeHtml(n.displayName)}</td>
        <td style="color: ${escapeHtml(execColor)}; font-weight: 700;">${escapeHtml(n.executiveFactionName)}</td>
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
    knownFactions.map(f => `<option value="${escapeHtml(f)}" ${state.councilorFactionFilter === f ? 'selected' : ''}>${escapeHtml(f)}</option>`).join('');

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
      <div class="card" style="border-left: 3px solid ${isMole ? '#d500f9' : escapeHtml(fColor)};">
        <div class="card-header">
          <div>
            <div class="card-title">${escapeHtml(c.displayName)}</div>
            <div style="font-size: 11px; color: ${escapeHtml(fColor)}; font-family: var(--font-mono);">${escapeHtml(c.factionName)} (${escapeHtml(c.typeTemplateName)})</div>
          </div>
          <div>
            ${isMole ? `<span class="chip chip-mole">TURNED MOLE</span>` : ''}
            ${c.isAlien ? `<span class="chip chip-danger">HYDRA</span>` : ''}
            <span class="chip chip-info">${escapeHtml(c.status)}</span>
          </div>
        </div>

        <div class="stat-row">
          <span class="stat-label">Location</span>
          <span class="stat-value">${escapeHtml(c.locationName)}</span>
        </div>

        <div style="margin: 10px 0; font-size: 11px; font-family: var(--font-mono); display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px;">
          <div>ADM: <strong>${formatEffectiveAttr(c, 'Administration')}</strong></div>
          <div>PER: <strong>${formatEffectiveAttr(c, 'Persuasion')}</strong></div>
          <div>INV: <strong>${formatEffectiveAttr(c, 'Investigation')}</strong></div>
          <div>ESP: <strong>${formatEffectiveAttr(c, 'Espionage')}</strong></div>
          <div>CMD: <strong>${formatEffectiveAttr(c, 'Command')}</strong></div>
          <div>SCI: <strong>${formatEffectiveAttr(c, 'Science')}</strong></div>
          <div>SEC: <strong>${formatEffectiveAttr(c, 'Security')}</strong></div>
          <div>LOY: <strong>${formatEffectiveAttr(c, 'Loyalty')}</strong></div>
        </div>

        ${c.orgs?.length > 0 ? `
          <div style="font-size: 11px; color: var(--text-muted); margin-top: 6px;">
            <strong>Orgs:</strong> ${c.orgs.map(o => escapeHtml(o.displayName)).join(', ')}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

function formatAttr(attrObj) {
  if (!attrObj) return '?';
  if (attrObj.visibility === 'unknown' || attrObj.visibility === 'unavailable') return '?';
  return attrObj.visible !== null && attrObj.visible !== undefined ? attrObj.visible : '?';
}

// The save stores BASE attributes; the game adds equipped-org bonuses when it
// resolves a mission. Showing maskedAttributes alone therefore displays a
// number the player never sees in game -- a councilor listed at 2 SCI may
// actually operate at 11.
//
// Records for observed enemies have no orgs or resolved block (the server
// strips them), so they fall through to the masked estimate unchanged: we do
// not know their orgs and must not imply otherwise.
function attrDetail(councilor, attrName) {
  const resolved = councilor?.resolvedAttributes;
  if (resolved?.effective && resolved.effective[attrName] !== undefined) {
    const base = Number(resolved.base?.[attrName]) || 0;
    const orgBonus = Number(resolved.orgBonuses?.[attrName]) || 0;
    const traitBonus = Number(resolved.traitBonuses?.[attrName]) || 0;
    // The realized increase, which differs from org+trait wherever the 0-25
    // cap clips it. Showing the nominal sum would claim a gain the councilor
    // never actually receives.
    const applied = resolved.appliedBonus?.[attrName];
    return {
      value: Number(resolved.effective[attrName]),
      base,
      orgBonus,
      traitBonus,
      bonus: typeof applied === 'number' ? applied : orgBonus + traitBonus,
      capped: resolved.capped?.[attrName] === true,
      uncapped: Number(resolved.uncapped?.[attrName]),
      orgsInactive: resolved.orgsActive === false,
      known: true
    };
  }

  const masked = councilor?.maskedAttributes?.[attrName];
  const shown = formatAttr(masked);
  const numeric = Number(shown);
  return {
    value: Number.isFinite(numeric) ? numeric : null,
    base: Number.isFinite(numeric) ? numeric : null,
    orgBonus: 0,
    traitBonus: 0,
    bonus: 0,
    orgsInactive: false,
    known: shown !== '?'
  };
}

/** Effective attribute for display, with the org contribution marked. */
function formatEffectiveAttr(councilor, attrName) {
  const detail = attrDetail(councilor, attrName);
  if (!detail.known || detail.value === null) return '?';
  if (detail.bonus !== 0) {
    const parts = [`${detail.base} base`];
    if (detail.orgBonus) parts.push(`${detail.orgBonus > 0 ? '+' : ''}${detail.orgBonus} from equipped orgs`);
    if (detail.traitBonus) parts.push(`${detail.traitBonus > 0 ? '+' : ''}${detail.traitBonus} from traits`);
    if (detail.capped) parts.push(`capped at 25 (would be ${detail.uncapped})`);
    const sign = detail.bonus > 0 ? '+' : '';
    const cls = detail.bonus > 0 ? 'attr-org-bonus' : 'attr-org-bonus is-negative';
    return `${detail.value}<span class="${cls}" title="${parts.join(', ')}">${sign}${detail.bonus}</span>`;
  }
  return String(detail.value);
}

/**
 * Sum of the seven mission attributes using effective values. The snapshot's
 * totalSkills is a base-only sum, so ranking on it while displaying
 * org-inclusive per-attribute values labels councilors with one metric and
 * orders them by another.
 */
function effectiveTotalSkills(councilor) {
  const resolved = councilor?.resolvedAttributes;
  if (typeof resolved?.totalEffectiveSkills === 'number') return resolved.totalEffectiveSkills;
  return Number(councilor?.totalSkills) || 0;
}

/** Numeric effective value for sorting. -1 keeps unknowns at the bottom. */
function effectiveAttrValue(councilor, attrName) {
  const detail = attrDetail(councilor, attrName);
  return detail.known && detail.value !== null ? detail.value : -1;
}

function renderCouncilorsScreen() {
  if (!state.snapshot) return;
  const rawList = state.snapshot.councilors || [];
  let councilors = [...rawList];

  // Filter option lists are rebuilt only when the underlying roster changes,
  // so typing a search no longer rebuilds (and closes) the dropdowns.
  const datasetKey = rawList.map(c => `${c.ID}:${c.factionName}:${c.typeTemplateName}`).join('|');
  if (state.councilorsDatasetKey !== datasetKey) {
    state.councilorsDatasetKey = datasetKey;

    // Update total count badge
    const countBadge = document.getElementById('councilorsTotalCountBadge');
    if (countBadge) {
      countBadge.textContent = `${rawList.length} Discovered Councilor${rawList.length === 1 ? '' : 's'}`;
    }

    // Populate Faction filter options
    const factionSelect = document.getElementById('councilorMainFactionFilter');
    if (factionSelect) {
      const factions = Array.from(new Set(rawList.map(c => c.factionName))).filter(Boolean);
      const currVal = state.councilorMainFaction;
      factionSelect.innerHTML = `<option value="all">All Known Factions (${rawList.length})</option>` +
        factions.map(f => {
          const fCount = rawList.filter(c => c.factionName === f).length;
          return `<option value="${escapeHtml(f)}" ${currVal === f ? 'selected' : ''}>${escapeHtml(f)} (${fCount})</option>`;
        }).join('');
    }

    // Populate Profession filter options
    const profSelect = document.getElementById('councilorProfessionFilter');
    if (profSelect) {
      const profs = Array.from(new Set(rawList.map(c => c.typeTemplateName))).filter(Boolean).sort();
      const currProf = state.councilorProfession;
      profSelect.innerHTML = `<option value="all">All Professions (${profs.length})</option>` +
        profs.map(p => {
          const pCount = rawList.filter(c => c.typeTemplateName === p).length;
          return `<option value="${escapeHtml(p)}" ${currProf === p ? 'selected' : ''}>${escapeHtml(p)} (${pCount})</option>`;
        }).join('');
    }
  }

  // Apply Faction Filter
  if (state.councilorMainFaction !== 'all') {
    councilors = councilors.filter(c => c.factionName === state.councilorMainFaction);
  }

  // Apply Profession Filter
  if (state.councilorProfession !== 'all') {
    councilors = councilors.filter(c => c.typeTemplateName === state.councilorProfession);
  }

  // Apply Status Filter
  if (state.councilorStatus === 'active') {
    councilors = councilors.filter(c => c.status === 'Active');
  } else if (state.councilorStatus === 'moles') {
    councilors = councilors.filter(c => c.isTurnedMole);
  } else if (state.councilorStatus === 'own') {
    councilors = councilors.filter(c => c.isOwnCouncilor);
  } else if (state.councilorStatus === 'aliens') {
    councilors = councilors.filter(c => c.isAlien);
  }

  // Apply Search Query
  if (state.councilorMainSearch) {
    const q = state.councilorMainSearch;
    councilors = councilors.filter(c =>
      c.displayName.toLowerCase().includes(q) ||
      (c.personalName && c.personalName.toLowerCase().includes(q)) ||
      (c.familyName && c.familyName.toLowerCase().includes(q)) ||
      c.typeTemplateName.toLowerCase().includes(q) ||
      c.locationName.toLowerCase().includes(q) ||
      (c.activeMissionName && c.activeMissionName.toLowerCase().includes(q)) ||
      (c.traits && c.traits.some(t => t.toLowerCase().includes(q))) ||
      (c.orgs && c.orgs.some(o => o.displayName.toLowerCase().includes(q)))
    );
  }

  // Sorting
  // Rank on effective values: a councilor with strong orgs outranks one with a
  // higher base and none, and sorting on base alone hides that entirely.
  const getRawAttr = (c, attr) => effectiveAttrValue(c, attr);

  const sortKey = state.councilorViewMode === 'table' ? state.councilorTableSort.col : state.councilorSort;
  const isAsc = state.councilorViewMode === 'table' ? state.councilorTableSort.asc : false;

  councilors.sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'totalSkills' || sortKey === 'total') {
      cmp = effectiveTotalSkills(b) - effectiveTotalSkills(a);
    } else if (sortKey === 'persuasion' || sortKey === 'per') {
      cmp = getRawAttr(b, 'Persuasion') - getRawAttr(a, 'Persuasion');
    } else if (sortKey === 'investigation' || sortKey === 'inv') {
      cmp = getRawAttr(b, 'Investigation') - getRawAttr(a, 'Investigation');
    } else if (sortKey === 'espionage' || sortKey === 'esp') {
      cmp = getRawAttr(b, 'Espionage') - getRawAttr(a, 'Espionage');
    } else if (sortKey === 'command' || sortKey === 'cmd') {
      cmp = getRawAttr(b, 'Command') - getRawAttr(a, 'Command');
    } else if (sortKey === 'administration' || sortKey === 'adm') {
      cmp = getRawAttr(b, 'Administration') - getRawAttr(a, 'Administration');
    } else if (sortKey === 'science' || sortKey === 'sci') {
      cmp = getRawAttr(b, 'Science') - getRawAttr(a, 'Science');
    } else if (sortKey === 'security' || sortKey === 'sec') {
      cmp = getRawAttr(b, 'Security') - getRawAttr(a, 'Security');
    } else if (sortKey === 'loyalty' || sortKey === 'loy') {
      cmp = getRawAttr(b, 'Loyalty') - getRawAttr(a, 'Loyalty');
    } else if (sortKey === 'location') {
      cmp = (a.locationName || '').localeCompare(b.locationName || '');
    } else if (sortKey === 'name') {
      cmp = (a.displayName || '').localeCompare(b.displayName || '');
    } else if (sortKey === 'faction') {
      cmp = (a.factionName || '').localeCompare(b.factionName || '');
    } else if (sortKey === 'profession') {
      cmp = (a.typeTemplateName || '').localeCompare(b.typeTemplateName || '');
    } else if (sortKey === 'status') {
      cmp = (a.status || '').localeCompare(b.status || '');
    }
    return isAsc ? -cmp : cmp;
  });

  renderCouncilorsMainCards(councilors);
  renderCouncilorsMainTable(councilors);
}

function renderCouncilorsMainCards(councilors) {
  const container = document.getElementById('councilorsMainCardsView');
  if (!container) return;

  if (councilors.length === 0) {
    container.innerHTML = `<div style="grid-column: 1 / -1; color: var(--text-muted); font-size: 13px; text-align: center; padding: 40px;">No councilors match the current search or filter criteria.</div>`;
    return;
  }

  container.innerHTML = councilors.map(c => {
    const fColor = getFactionColorByName(c.factionName);
    const isMole = c.isTurnedMole;
    const isOwn = c.isOwnCouncilor;

    const renderSkillPill = (label, attrName) => {
      const val = formatEffectiveAttr(c, attrName);
      const num = typeof val === 'number' ? val : (parseInt(val, 10) || null);
      let colorStyle = '';
      if (num !== null && num >= 15) colorStyle = 'color: #ffd700; font-weight: 800; text-shadow: 0 0 8px rgba(255,215,0,0.4);';
      else if (num !== null && num >= 10) colorStyle = 'color: #38bdf8; font-weight: 700;';
      return `<div style="background: rgba(0,0,0,0.3); padding: 5px 4px; border-radius: 4px; text-align: center; border: 1px solid rgba(255,255,255,0.03);">
        <div style="font-size: 9px; color: var(--text-muted); font-weight: 600;">${label}</div>
        <div style="font-size: 13px; font-family: var(--font-mono); ${colorStyle}">${val}</div>
      </div>`;
    };

    return `
      <div class="card" style="border-left: 4px solid ${isMole ? '#d500f9' : escapeHtml(fColor)}; display: flex; flex-direction: column; cursor: pointer; transition: transform 0.15s ease, box-shadow 0.15s ease;" data-councilor-id="${escapeHtml(c.ID)}">
        <div class="card-header" style="align-items: flex-start; margin-bottom: 8px;">
          <div>
            <div class="card-title" style="font-size: 15px; margin-bottom: 2px;">${escapeHtml(c.displayName)}</div>
            <div style="font-size: 11px; color: ${escapeHtml(fColor)}; font-family: var(--font-mono); font-weight: 600;">
              ${escapeHtml(c.factionName)} &bull; ${escapeHtml(c.typeTemplateName)}
            </div>
          </div>
          <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
            ${isMole ? `<span class="chip chip-mole">TURNED MOLE</span>` : ''}
            ${c.isAlien ? `<span class="chip chip-danger">HYDRA OPERATIVE</span>` : ''}
            ${isOwn ? `<span class="chip chip-success">OWN COUNCIL</span>` : ''}
            <span class="chip chip-info" style="font-size: 10px;">${escapeHtml(c.status)}</span>
          </div>
        </div>

        <div style="display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px;">
          <div style="display: flex; align-items: center; justify-content: space-between; font-size: 11px;">
            <span class="location-chip" title="Current Location">📍 ${escapeHtml(c.locationName)}</span>
            <span style="font-size: 10px; color: var(--text-dim); font-family: var(--font-mono);">${escapeHtml(c.locationType || 'Earth')}</span>
          </div>
          ${c.activeMissionName ? `
            <div class="mission-chip" title="Assigned Mission">
              🎯 ${escapeHtml(c.activeMissionName)}${c.activeMissionTarget ? ' &rarr; ' + escapeHtml(c.activeMissionTarget) : ''}
            </div>
          ` : ''}
        </div>

        <!-- Skills Grid -->
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin-bottom: 10px;">
          ${renderSkillPill('ADM', 'Administration')}
          ${renderSkillPill('PER', 'Persuasion')}
          ${renderSkillPill('INV', 'Investigation')}
          ${renderSkillPill('ESP', 'Espionage')}
          ${renderSkillPill('CMD', 'Command')}
          ${renderSkillPill('SCI', 'Science')}
          ${renderSkillPill('SEC', 'Security')}
          ${renderSkillPill('LOY', 'Loyalty')}
        </div>

        <!-- Total Skills & Traits / Orgs -->
        <div style="margin-top: auto; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.06); font-size: 11px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <span style="color: var(--text-muted);">Active Skills Sum:</span>
            <strong style="color: var(--color-initiative); font-family: var(--font-mono); font-size: 12px;">${effectiveTotalSkills(c)}</strong>
          </div>

          ${c.traits && c.traits.length > 0 ? `
            <div style="margin-bottom: 6px; display: flex; flex-wrap: wrap; gap: 2px;">
              ${c.traits.slice(0, 4).map(t => `<span class="trait-tag">${escapeHtml(t)}</span>`).join('')}
              ${c.traits.length > 4 ? `<span class="trait-tag">+${c.traits.length - 4} more</span>` : ''}
            </div>
          ` : ''}

          ${c.orgs && c.orgs.length > 0 ? `
            <div style="font-size: 11px; color: var(--text-muted); line-height: 1.3;">
              <strong>Orgs (${c.orgs.length}):</strong> ${c.orgs.slice(0, 2).map(o => `${'★'.repeat(o.stars || 1)} ${escapeHtml(o.displayName)}`).join(', ')}${c.orgs.length > 2 ? ` (+${c.orgs.length - 2} more)` : ''}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function renderCouncilorsMainTable(councilors) {
  const tbody = document.getElementById('councilorsMainTableBody');
  if (!tbody) return;

  if (councilors.length === 0) {
    tbody.innerHTML = `<tr><td colspan="17" style="text-align: center; color: var(--text-muted); padding: 30px;">No councilors match criteria.</td></tr>`;
    return;
  }

  tbody.innerHTML = councilors.map(c => {
    const fColor = getFactionColorByName(c.factionName);
    const isMole = c.isTurnedMole;
    const formatCell = (attr) => {
      const val = formatEffectiveAttr(c, attr);
      const num = typeof val === 'number' ? val : (parseInt(val, 10) || null);
      if (num !== null && num >= 15) return `<span style="color: #ffd700; font-weight: 800;">${val}</span>`;
      if (num !== null && num >= 10) return `<span style="color: #38bdf8; font-weight: 700;">${val}</span>`;
      return val;
    };

    return `
      <tr style="cursor: pointer;" data-councilor-id="${escapeHtml(c.ID)}">
        <td>
          <div style="font-weight: 700; color: ${isMole ? '#d500f9' : '#fff'};">${escapeHtml(c.displayName)}</div>
          ${isMole ? `<span class="chip chip-mole" style="font-size: 9px; padding: 1px 4px;">MOLE</span>` : ''}
          ${c.isAlien ? `<span class="chip chip-danger" style="font-size: 9px; padding: 1px 4px;">HYDRA</span>` : ''}
        </td>
        <td style="color: ${escapeHtml(fColor)}; font-weight: 600;">${escapeHtml(c.factionName)}</td>
        <td>${escapeHtml(c.typeTemplateName)}</td>
        <td><span class="chip chip-info" style="font-size: 10px;">${escapeHtml(c.status)}</span></td>
        <td><span class="location-chip">📍 ${escapeHtml(c.locationName)}</span></td>
        <td>${c.activeMissionName ? `<span class="mission-chip">🎯 ${escapeHtml(c.activeMissionName)}${c.activeMissionTarget ? ' &rarr; ' + escapeHtml(c.activeMissionTarget) : ''}</span>` : '<span style="color: var(--text-dim);">-</span>'}</td>
        <td style="text-align: center; font-family: var(--font-mono);">${formatCell('Administration')}</td>
        <td style="text-align: center; font-family: var(--font-mono);">${formatCell('Persuasion')}</td>
        <td style="text-align: center; font-family: var(--font-mono);">${formatCell('Investigation')}</td>
        <td style="text-align: center; font-family: var(--font-mono);">${formatCell('Espionage')}</td>
        <td style="text-align: center; font-family: var(--font-mono);">${formatCell('Command')}</td>
        <td style="text-align: center; font-family: var(--font-mono);">${formatCell('Science')}</td>
        <td style="text-align: center; font-family: var(--font-mono);">${formatCell('Security')}</td>
        <td style="text-align: center; font-family: var(--font-mono);">${formatCell('Loyalty')}</td>
        <td style="text-align: center; font-family: var(--font-mono); font-weight: 700; color: var(--color-initiative);">${effectiveTotalSkills(c)}</td>
        <td style="text-align: center;" title="${(c.orgs || []).map(o => escapeHtml(o.displayName)).join(', ')}">${c.orgs?.length || 0}</td>
        <td title="${(c.traits || []).map(escapeHtml).join(', ')}">${(c.traits || []).slice(0, 2).map(escapeHtml).join(', ')}${c.traits?.length > 2 ? '...' : ''}</td>
      </tr>
    `;
  }).join('');
}

function openCouncilorModal(councilorId) {
  if (!state.snapshot) return;
  const c = state.snapshot.councilors?.find(x => String(x.ID) === String(councilorId));
  if (!c) return;

  const modal = document.getElementById('councilorModal');
  const modalTitle = document.getElementById('councilorModalTitle');
  const modalBody = document.getElementById('councilorModalBody');
  const fColor = getFactionColorByName(c.factionName);

  modalTitle.innerHTML = `
    <span>${escapeHtml(c.displayName)}</span>
    <span style="font-size: 12px; color: ${escapeHtml(fColor)}; font-weight: 600;">[${escapeHtml(c.factionName)} &bull; ${escapeHtml(c.typeTemplateName)}]</span>
  `;

  const renderBar = (label, attrName, color = 'var(--color-initiative)') => {
    const val = formatEffectiveAttr(c, attrName);
    const num = typeof val === 'number' ? val : (parseInt(val, 10) || 0);
    const pct = Math.min(100, Math.max(0, (num / 25) * 100));
    return `
      <div class="skill-bar-container">
        <div class="skill-bar-label">${label}</div>
        <div class="skill-bar-track">
          <div class="skill-bar-fill" style="width: ${val === '?' ? 0 : pct}%; background: ${color};"></div>
        </div>
        <div class="skill-bar-val" style="color: ${val === '?' ? 'var(--text-dim)' : '#fff'};">${val}</div>
      </div>
    `;
  };

  modalBody.innerHTML = `
    <!-- Top Meta Row -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; margin-bottom: 18px; background: rgba(0,0,0,0.25); padding: 12px; border-radius: 6px;">
      <div>
        <div style="font-size: 11px; color: var(--text-muted);">Current Location</div>
        <div style="font-size: 13px; font-weight: 700; color: #38bdf8;">📍 ${escapeHtml(c.locationName)}</div>
        <div style="font-size: 10px; color: var(--text-dim);">${escapeHtml(c.locationType || 'Earth Region')}</div>
      </div>
      <div>
        <div style="font-size: 11px; color: var(--text-muted);">Assigned Mission</div>
        <div style="font-size: 13px; font-weight: 700; color: #fbbf24;">🎯 ${escapeHtml(c.activeMissionName || 'Standby')}</div>
        <div style="font-size: 10px; color: var(--text-dim);">${c.activeMissionTarget ? 'Target: ' + escapeHtml(c.activeMissionTarget) : ''}</div>
      </div>
      <div>
        <div style="font-size: 11px; color: var(--text-muted);">Status & Intel</div>
        <div>
          ${c.isTurnedMole ? `<span class="chip chip-mole">TURNED MOLE</span>` : ''}
          ${c.isAlien ? `<span class="chip chip-danger">HYDRA</span>` : ''}
          <span class="chip chip-info">${escapeHtml(c.status)}</span>
        </div>
        <div style="font-size: 10px; color: var(--text-dim); margin-top: 2px;">Intel Confidence: <strong>${escapeHtml(c.investigationConfidence || 'CONFIRMED')}</strong></div>
      </div>
      <div>
        <div style="font-size: 11px; color: var(--text-muted);">Home & Background</div>
        <div style="font-size: 12px; font-weight: 600;">${c.homeRegionName ? 'Home: ' + escapeHtml(c.homeRegionName) : ''}</div>
        <div style="font-size: 10px; color: var(--text-dim);">${escapeHtml(c.gender || '')} ${c.xp ? '&bull; XP: ' + escapeHtml(c.xp) : ''}</div>
      </div>
    </div>

    <!-- Skills Section -->
    <div style="margin-bottom: 20px;">
      <div style="font-size: 13px; font-weight: 700; font-family: var(--font-mono); color: var(--color-initiative); margin-bottom: 10px; display: flex; justify-content: space-between;">
        <span>SKILLS & ATTRIBUTES (0 - 25 SCALE)</span>
        <span>Total Active Skills: ${effectiveTotalSkills(c)}</span>
      </div>
      <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-dim); border-radius: 6px; padding: 12px;">
        ${renderBar('Administration', 'Administration', '#00e5ff')}
        ${renderBar('Persuasion', 'Persuasion', '#ffd600')}
        ${renderBar('Investigation', 'Investigation', '#2979ff')}
        ${renderBar('Espionage', 'Espionage', '#d500f9')}
        ${renderBar('Command', 'Command', '#ff1744')}
        ${renderBar('Science', 'Science', '#00e676')}
        ${renderBar('Security', 'Security', '#ff9100')}
        ${renderBar('Loyalty', 'Loyalty', '#78909c')}
      </div>
    </div>

    <!-- Traits Section -->
    <div style="margin-bottom: 20px;">
      <div style="font-size: 13px; font-weight: 700; font-family: var(--font-mono); color: var(--text-muted); margin-bottom: 8px;">
        TRAITS & PERKS (${c.traits?.length || 0})
      </div>
      <div style="display: flex; flex-wrap: wrap; gap: 4px;">
        ${c.traits && c.traits.length > 0
          ? c.traits.map(t => `<span class="trait-tag" style="padding: 4px 8px; font-size: 12px; background: rgba(0, 229, 255, 0.06); border-color: rgba(0, 229, 255, 0.2);">${escapeHtml(t)}</span>`).join('')
          : '<div style="color: var(--text-dim); font-size: 12px;">No special traits recorded.</div>'}
      </div>
    </div>

    <!-- Organizations Section -->
    <div>
      <div style="font-size: 13px; font-weight: 700; font-family: var(--font-mono); color: var(--text-muted); margin-bottom: 8px;">
        ASSIGNED ORGANIZATIONS (${c.orgs?.length || 0})
      </div>
      <div>
        ${c.orgs && c.orgs.length > 0
          ? c.orgs.map(o => `
            <div class="org-item-card">
              <div>
                <div style="font-weight: 700; color: #fff;">${'★'.repeat(o.stars || 1)} ${escapeHtml(o.displayName)}</div>
                <div style="font-size: 11px; color: var(--color-initiative);">${escapeHtml(o.bonusesText || 'Operational support')}</div>
              </div>
              <span class="chip chip-dim" style="font-size: 10px;">Tier ${escapeHtml(o.tier || 1)}</span>
            </div>
          `).join('')
          : '<div style="color: var(--text-dim); font-size: 12px;">No organizations currently assigned.</div>'}
      </div>
    </div>
  `;

  modal.classList.remove('hidden');
}

function closeCouncilorModal() {
  const modal = document.getElementById('councilorModal');
  if (modal) modal.classList.add('hidden');
}

// Delegated handler powering the councilor cards/table (no inline onclick).
function onCouncilorCardClick(event) {
  const target = event.target.closest('[data-councilor-id]');
  if (!target) return;
  openCouncilorModal(target.dataset.councilorId);
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
          <div class="card-title">${escapeHtml(t.nationName)}</div>
          <span class="card-badge" style="background: rgba(213, 0, 249, 0.2); color: #e040fb;">
            Score: ${t.score}/100
          </span>
        </div>

        <div class="stat-row">
          <span class="stat-label">${escapeHtml(targetFaction)} Holdings</span>
          <span class="stat-value" style="color: ${escapeHtml(getFactionColorByName(targetFaction))};">${t.targetCPCount ?? t.servantCPCount} / ${t.totalCPCount} CPs</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Economy (GDP)</span>
          <span class="stat-value">$${escapeHtml(t.gdpTrillion)}T</span>
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
            ${t.reasons.map(r => `<li>${escapeHtml(r)}</li>`).join('')}
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
        <td style="font-weight: 600;">${escapeHtml(s.displayName)}</td>
        <td>${escapeHtml(s.parentBodyName)}</td>
        <td style="color: ${escapeHtml(fColor)}; font-weight: 700;">${escapeHtml(s.factionName)}</td>
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
        <td style="font-weight: 600;">${escapeHtml(h.displayName)}</td>
        <td style="color: ${escapeHtml(fColor)}; font-weight: 700;">${escapeHtml(h.factionName)}</td>
        <td>${escapeHtml(h.habType)}</td>
        <td>Tier ${escapeHtml(h.tier)}</td>
        <td>${escapeHtml(h.orbitBody)}</td>
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
        <td style="font-weight: 600;">${escapeHtml(fl.displayName)}</td>
        <td style="color: ${escapeHtml(fColor)}; font-weight: 700;">${escapeHtml(fl.factionName)}</td>
        <td>${fl.shipsCount}</td>
        <td><strong>${escapeHtml(fl.combatPower ?? 'Unavailable')}</strong></td>
        <td>${escapeHtml(fl.weaponSummary || fl.dominantWeaponType || 'Unknown')}</td>
        <td>${escapeHtml(fl.orbitBody)}</td>
        <td>${escapeHtml(fl.mission)}</td>
        <td>${escapeHtml(fl.destination)}</td>
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
          <span class="faction-indicator" style="background: ${escapeHtml(faction.color)}; width: 14px; height: 14px;"></span>
          ${escapeHtml(faction.displayName)} Intelligence Summary
        </div>
        <span class="card-badge" style="background: ${escapeHtml(faction.color)}; color: #000; font-size: 12px;">
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
          <div class="card-title">Slot ${s.slotNumber}: ${escapeHtml(s.displayName)}</div>
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
          <span class="stat-value" style="color: var(--color-initiative);">${escapeHtml(s.leadFactionName)} (${s.leadContribution.toLocaleString()})</span>
        </div>

        <div style="margin-top: 8px; font-size: 11px; color: var(--text-muted);">
          <strong>Faction Contributions:</strong>
          <div style="display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px;">
            ${s.contributions.map(c => `<span class="chip chip-dim">${escapeHtml(c.factionName.replace('the ', ''))}: ${c.contribution.toLocaleString()}</span>`).join('')}
          </div>
        </div>
      </div>
    `;
  }).join('');

  const completedBox = document.getElementById('completedTechsContainer');
  const completed = state.snapshot.globalResearch?.finishedTechsNames || [];
  completedBox.innerHTML = completed.map(t => `<span class="chip chip-success">✓ ${escapeHtml(t)}</span>`).join('');
}

function renderTechMatrix() {
  const thead = document.getElementById('techMatrixHeader');
  const tbody = document.getElementById('techMatrixBody');
  const matrix = state.snapshot.techMatrix || [];
  const factions = state.snapshot.factions || [];

  thead.innerHTML = `
    <tr>
      <th>Strategic Project</th>
      ${factions.map(f => `<th style="color: ${escapeHtml(f.color)}; text-align: center;">${escapeHtml(f.displayName.replace('the ', ''))}</th>`).join('')}
    </tr>
  `;

  tbody.innerHTML = matrix.map(row => {
    return `
      <tr>
        <td style="font-weight: 600;">${escapeHtml(row.displayName)}</td>
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
          Templates Source: <code>${escapeHtml(res.templatesPath || 'StreamingAssets/Templates')}</code> (${res.techCount} techs, ${res.projectCount} projects, ${res.effectCount} effects loaded)
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
                  <td style="font-family: var(--font-mono); font-weight: 700;">${escapeHtml(v.targetId)}</td>
                  <td>${escapeHtml(v.targetType)}</td>
                  <td style="font-family: var(--font-mono); color: var(--color-initiative);">${escapeHtml(v.expectedEffect)}</td>
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
      <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 6px;"><strong>${escapeHtml(stages.abductions.name)}</strong></div>
      <div style="font-size: 11px; color: var(--text-dim);">${escapeHtml(stages.abductions.description)}</div>
    </div>

    <div class="card" style="border-top: 3px solid ${stages.contacts.active ? 'var(--color-success)' : 'var(--color-dim)'};">
      <div class="card-header">
        <div class="card-title">Stage 2: Contacts & Enthrall</div>
        <span class="chip ${stages.contacts.active ? 'chip-success' : 'chip-dim'}">${stages.contacts.status}</span>
      </div>
      <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 6px;"><strong>${escapeHtml(stages.contacts.name)}</strong></div>
      <div style="font-size: 11px; color: var(--text-dim);">${escapeHtml(stages.contacts.description)}</div>
    </div>

    <div class="card" style="border-top: 3px solid ${stages.operations.active ? 'var(--color-success)' : 'var(--color-dim)'};">
      <div class="card-header">
        <div class="card-title">Stage 3: Alien Operations</div>
        <span class="chip ${stages.operations.active ? 'chip-success' : 'chip-dim'}">${stages.operations.status}</span>
      </div>
      <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 6px;"><strong>${escapeHtml(stages.operations.name)}</strong></div>
      <div style="font-size: 11px; color: var(--text-dim);">${escapeHtml(stages.operations.description)}</div>
    </div>

    <div class="card" style="border-top: 3px solid ${stages.operatives.active ? 'var(--color-success)' : 'var(--color-dim)'};">
      <div class="card-header">
        <div class="card-title">Stage 4: Alien Operatives</div>
        <span class="chip ${stages.operatives.active ? 'chip-success' : 'chip-dim'}">${stages.operatives.status}</span>
      </div>
      <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 6px;"><strong>${escapeHtml(stages.operatives.name)}</strong></div>
      <div style="font-size: 11px; color: var(--text-dim);">${escapeHtml(stages.operatives.description)}</div>
       <div style="margin-top: 8px; font-size: 11px; font-weight: 700; color: var(--color-initiative);">Detected: ${stages.operatives.active ? (stages.operatives.detectedCount ?? 0) : 'UNAVAILABLE'}</div>
    </div>
  `;

  const xenoBody = document.getElementById('xenoformingTableBody');
  const xenos = state.snapshot.activeXenoforming || [];
  xenoBody.innerHTML = xenos.map(x => `
    <tr>
      <td style="font-weight: 600;">${escapeHtml(x.regionName)}</td>
      <td><strong>${escapeHtml(x.level)}</strong></td>
      <td><span class="chip chip-warning">Monitored Alien Activity</span></td>
    </tr>
  `).join('');
}

async function renderExportPreview() {
  const preview = document.getElementById('exportMarkdownPreview');
  if (!preview) return;
  try {
    const res = await API.getExport('chatgpt', state.mode, state.observerId);
    if (res.success) {
      preview.textContent = res.markdown;
    } else {
      preview.textContent = 'Export unavailable: ' + (res.error || 'unknown error');
    }
  } catch (err) {
    preview.textContent = 'Export unavailable: ' + err.message;
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
