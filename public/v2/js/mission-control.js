/**
 * THE INITIATIVE // EXECUTIVE BRIEFING CLIENT
 * The server generates a fresh briefing for every save/mode/observer request.
 */

const state = {
  mode: 'player',
  observer: 4712,
  briefing: null,
  rawSnapshot: null,
  snapshotIdentity: null,
  activeSector: null,
  isLoading: false,
  requestSequence: 0,
  abortController: null,
  libraryView: {
    section: 'overview',
    spaceTab: 'mining',
    spaceTheater: null,
    councilorFaction: '',
    councilorSearch: ''
  },
  runtime: {
    supportedModes: ['player', 'enhanced', 'omniscient'],
    defaultMode: 'player'
  }
};

let factionController = null;
let factionModalTrigger = null;
let libraryModalTrigger = null;

function focusableModalNodes(dialog) {
  return Array.from(dialog?.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])') || [])
    .filter(node => !node.disabled && !node.hidden && node.offsetParent !== null);
}

function trapModalFocus(event, screen) {
  if (event.key !== 'Tab' || !screen || screen.hidden) return;
  const dialog = screen.querySelector('[role="dialog"]');
  const nodes = focusableModalNodes(dialog);
  if (!nodes.length) return;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Prefer the shared utility when loaded ahead of this script.
const __shared = window.MissionControlShared;
if (__shared) {
  escapeHtml = __shared.escapeHtml;
}

function brandFactionLabel(displayName) {
  if (!displayName) return 'UNKNOWN';
  const trimmed = String(displayName).trim();
  return (/^the /i.test(trimmed) ? trimmed.slice(4) : trimmed).toUpperCase();
}

function updateFactionLogoSlot(container, faction, className) {
  if (!container) return;
  container.innerHTML = '';
  container.classList.remove('has-faction-logo');
  const appendLogo = __shared?.appendFactionLogo;
  if (!appendLogo) return;
  const img = appendLogo(document, container, faction, className || 'faction-logo');
  if (img) container.classList.add('has-faction-logo');
}

function observerFactionRecord() {
  return (state.rawSnapshot?.factions || []).find(f => String(f.ID) === String(state.observer)) || null;
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
    const configuredObserver = Number(runtime.defaults?.defaultObserverFactionId || runtime.defaultObserverFactionId);
    if (Number.isSafeInteger(configuredObserver) && configuredObserver > 0) {
      state.observer = configuredObserver;
    }
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

  const publishButton = document.getElementById('initPublishBtn');
  if (publishButton) {
    // Publishing is intentionally fail-closed: only the local/dev Express
    // runtime has access to the service-role-backed publisher endpoint.
    const canPublish = ['local', 'dev'].includes(state.runtime.environment)
      && state.runtime.canPublish === true;
    publishButton.hidden = !canPublish;
    publishButton.disabled = !canPublish;
    publishButton.setAttribute('aria-hidden', canPublish ? 'false' : 'true');
  }

  if (!supported.includes(state.mode)) {
    state.mode = state.runtime.defaultMode || supported[0] || 'player';
  }
  syncModeButtons();
}

const MODE_CAPTIONS = {
  player: 'Player Intel: only what this faction has legitimately learned.',
  enhanced: 'Enhanced: player intel plus selected raw metrics that would not appear in-game.',
  omniscient: 'Omniscient: full unredacted campaign state for analysis.'
};

function primaryDirective() {
  const directives = state.briefing?.directives || {};
  return state.briefing?.primaryDirective
    || directives.geopolitical?.[0]
    || directives.council?.[0]
    || directives.space?.[0]
    || directives.research?.[0]
    || null;
}

function formatCampaignDate(value) {
  if (!value || value === 'Unknown' || value === 'UNAVAILABLE') return value || 'UNAVAILABLE';
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function setOverlayOpen(screen, open) {
  if (!screen) return;
  screen.hidden = !open;
  screen.toggleAttribute('inert', !open);
  screen.setAttribute('aria-hidden', open ? 'false' : 'true');
  window.MissionControlDetailPanel?.syncPageInert?.();
}

function syncModeButtons() {
  document.querySelectorAll('.init-mode-btn').forEach((button) => {
    const selected = button.dataset.mode === state.mode;
    button.classList.toggle('init-btn-cyan', selected);
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
  });
  const caption = document.getElementById('initModeCaption');
  if (caption) caption.textContent = MODE_CAPTIONS[state.mode] || MODE_CAPTIONS.player;
}

function initEventListeners() {
  // Mode switcher
  document.querySelectorAll('.init-mode-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      if (btn.disabled || btn.hidden) return;
      state.mode = btn.dataset.mode;
      syncModeButtons();
      loadData();
    });
  });

  const systemMenuBtn = document.getElementById('initSystemMenuBtn');
  const systemMenuPanel = document.getElementById('initSystemMenuPanel');
  const setSystemMenuOpen = (open) => {
    if (!systemMenuBtn || !systemMenuPanel) return;
    systemMenuPanel.hidden = !open;
    systemMenuPanel.toggleAttribute('inert', !open);
    systemMenuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  systemMenuBtn?.addEventListener('click', (event) => {
    event.stopPropagation();
    setSystemMenuOpen(Boolean(systemMenuPanel?.hidden));
  });
  document.addEventListener('click', (event) => {
    if (!systemMenuPanel || systemMenuPanel.hidden) return;
    if (event.target.closest('.init-system-menu')) return;
    setSystemMenuOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && systemMenuPanel && !systemMenuPanel.hidden) {
      setSystemMenuOpen(false);
      systemMenuBtn?.focus();
    }
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
        const refreshResponse = await fetch(`/api/refresh?mode=${state.mode}&observer=${state.observer}`, { method: 'POST' });
        const refreshPayload = await refreshResponse.json().catch(() => ({}));
        if (!refreshResponse.ok || refreshPayload.success === false) {
          throw new Error(refreshPayload.error || `Refresh failed (${refreshResponse.status})`);
        }
        await loadData();
        showToast('Telemetry refreshed from the newest save.');
      } catch (err) {
        showToast('Refresh failed: ' + err.message);
      } finally {
        refreshBtn.textContent = 'Refresh save';
      }
    });
  }

  // Local/dev only: publish the newest save through the existing server-side
  // publisher, then refresh this file-backed view so it shows the same save.
  const publishBtn = document.getElementById('initPublishBtn');
  if (publishBtn) {
    publishBtn.addEventListener('click', async () => {
      if (publishBtn.disabled || publishBtn.hidden) return;

      publishBtn.disabled = true;
      publishBtn.textContent = 'Publishing…';
      showToast('Publishing the newest save to the live site…');

      try {
        const publishResponse = await fetch('/api/publish', {
          method: 'POST',
          headers: { Accept: 'application/json' }
        });
        const publishPayload = await publishResponse.json().catch(() => ({}));
        if (!publishResponse.ok || publishPayload.success === false) {
          throw new Error(publishPayload.error || `Publish failed (${publishResponse.status})`);
        }

        try {
          const refreshResponse = await fetch(`/api/refresh?mode=${state.mode}&observer=${state.observer}`, {
            method: 'POST'
          });
          const refreshPayload = await refreshResponse.json().catch(() => ({}));
          if (!refreshResponse.ok || refreshPayload.success === false) {
            throw new Error(refreshPayload.error || `Local refresh failed (${refreshResponse.status})`);
          }
          await loadData();
        } catch (refreshError) {
          const saveLabel = publishPayload.saveFilename ? ` ${publishPayload.saveFilename}` : ' the newest save';
          showToast(`Live site updated from${saveLabel}, but local refresh failed: ${refreshError.message}`);
          return;
        }

        const details = [
          publishPayload.saveFilename,
          publishPayload.gameTime
        ].filter(Boolean).join(' · ');
        showToast(`Live site updated${details ? ` · ${details}` : ''}.`);
      } catch (err) {
        showToast('Publish failed: ' + err.message);
      } finally {
        publishBtn.disabled = false;
        publishBtn.textContent = 'Publish latest';
      }
    });
  }

  // Copy SITREP Button
  const copyBtn = document.getElementById('btnCopySitrep');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      if (!state.briefing) return;
      const observerLabel = state.briefing.observerName || state.rawSnapshot?.observerFactionName || `Faction ${state.observer}`;
      const modeLabel = String(state.mode || 'player').toUpperCase();
      const text = `INTELLIGENCE MODE: ${modeLabel}\nOBSERVER: ${observerLabel}\n\n[${observerLabel.toUpperCase()} // STRATEGIC SITREP]\nDate: ${state.briefing.campaignDate}\nComposite score estimate: ${state.briefing.powerScore}/100\nDEFCON: ${state.briefing.sitrep?.defcon}\n\n${state.briefing.sitrep?.summaryParagraphs?.join('\n\n')}`;
      copyText(text)
        .then(() => showToast('Executive SITREP copied to clipboard.'))
        .catch((error) => showToast('Copy failed: ' + error.message));
    });
  }

  const openFactionBtn = document.getElementById('openFactionIntelBtn');
  const factionScreen = document.getElementById('factionIntelScreen');
  const closeFactionBtn = document.getElementById('closeFactionIntelBtn');
  const factionRoot = document.getElementById('factionIntelRoot');
  const closeFactionScreen = () => {
    if (!factionScreen) return;
    setOverlayOpen(factionScreen, false);
    document.body.classList.remove('faction-intel-open');
    if (factionModalTrigger && document.contains(factionModalTrigger)) factionModalTrigger.focus();
    factionModalTrigger = null;
  };
  const openFactionScreen = (selectedFactionId) => {
    if (!factionScreen || !factionRoot || !state.rawSnapshot) return;
    factionModalTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (window.FactionIntelScreen) {
      factionController = window.FactionIntelScreen.render(factionRoot, state.rawSnapshot, state.briefing, state.observer);
      if (selectedFactionId !== undefined && selectedFactionId !== null) {
        factionController?.select?.(selectedFactionId);
      }
    }
    setOverlayOpen(factionScreen, true);
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

  const openLibraryBtn = document.getElementById('openIntelligenceLibraryBtn');
  const libraryScreen = document.getElementById('intelligenceLibraryScreen');
  const closeLibraryBtn = document.getElementById('closeIntelligenceLibraryBtn');
  const libraryRoot = document.getElementById('intelligenceLibraryRoot');
  const closeLibraryScreen = () => {
    if (!libraryScreen) return;
    setOverlayOpen(libraryScreen, false);
    document.body.classList.remove('intelligence-library-open');
    if (libraryModalTrigger && document.contains(libraryModalTrigger)) libraryModalTrigger.focus();
    libraryModalTrigger = null;
  };
  const renderLibrary = (section, spaceTab, spaceTheater) => {
    if (!libraryRoot || !state.rawSnapshot || !window.IntelligenceLibrary) return;
    state.libraryView.section = section || state.libraryView.section || 'overview';
    state.libraryView.spaceTab = spaceTab || state.libraryView.spaceTab || 'mining';
    state.libraryView.spaceTheater = spaceTheater === undefined ? state.libraryView.spaceTheater : spaceTheater;
    Object.assign(state.libraryView, {
      onOpenFaction: (factionId) => {
        closeLibraryScreen();
        openFactionScreen(factionId);
      },
      onCopyExport: copyLibraryExport
    });
    window.IntelligenceLibrary.render(libraryRoot, state.rawSnapshot, state.briefing, state.observer, state.libraryView);
  };
  const openLibraryScreen = (section) => {
    if (!libraryScreen || !libraryRoot || !state.rawSnapshot) return;
    libraryModalTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    renderLibrary(section || state.libraryView.section || 'overview', state.libraryView.spaceTab, state.libraryView.spaceTheater);
    setOverlayOpen(libraryScreen, true);
    document.body.classList.add('intelligence-library-open');
    closeLibraryBtn?.focus();
  };
  openLibraryBtn?.addEventListener('click', () => openLibraryScreen());
  closeLibraryBtn?.addEventListener('click', closeLibraryScreen);
  libraryScreen?.addEventListener('click', (event) => {
    if (event.target.closest('[data-intelligence-library-close]')) closeLibraryScreen();
  });
  document.addEventListener('click', (event) => {
    const theaterLink = event.target.closest('[data-board-theater-link]');
    if (!theaterLink || !libraryScreen || !libraryRoot || !state.rawSnapshot) return;
    renderLibrary('space', 'fleets', theaterLink.dataset.boardTheaterLink);
    setOverlayOpen(libraryScreen, true);
    document.body.classList.add('intelligence-library-open');
    closeLibraryBtn?.focus();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && libraryScreen && !libraryScreen.hidden) closeLibraryScreen();
  });
  document.addEventListener('keydown', (event) => {
    trapModalFocus(event, factionScreen);
    trapModalFocus(event, libraryScreen);
  });

  const openPriorityDetails = () => {
    if (!window.MissionControlDetailPanel || !state.briefing) return;
    const directive = primaryDirective();
    if (!directive) return;
    const operatives = Array.isArray(directive.eligibleOperatives) ? directive.eligibleOperatives : [];
    const rosterLabel = operatives.length
      ? operatives.map((op) => `${op.name} (${op.available ? 'idle' : op.mission || 'assigned'}${op.matchSkill ? `, ${op.matchSkill} ${op.matchValue ?? ''}` : ''})`).join('; ')
      : 'No eligible observer councilors are visible in this intelligence picture.';
    window.MissionControlDetailPanel.open({
      eyebrow: 'PRIMARY DIRECTIVE',
      title: directive.title,
      summary: directive.statement,
      facts: [
        { label: 'Department', value: directive.category || 'Unassigned' },
        { label: 'Severity', value: directive.severity || 'Unspecified' },
        { label: 'Mission', value: directive.missionType || 'UNAVAILABLE' },
        { label: 'Window', value: directive.window || 'This cycle' },
        { label: 'Preparation', value: directive.preparation || 'UNAVAILABLE' },
        { label: 'Mission cost', value: directive.missionCost || 'UNAVAILABLE' },
        { label: 'Expected alien hate', value: directive.expectedAlienHate || 'UNAVAILABLE' },
        { label: 'Why this action', value: directive.policyNote || directive.expectedAlienHateNote || 'No campaign-posture note on this directive.' },
        { label: 'Recommended action', value: directive.action || 'No action specified' },
        { label: 'Success factor', value: directive.successFactor || 'Not assessed' },
        { label: 'Eligible operatives', value: rosterLabel }
      ],
      actions: [
        { label: 'Open councilor roster', primary: true, onClick: () => openLibraryScreen('councilors') }
      ]
    });
  };
  document.getElementById('openPriorityDetailsBtn')?.addEventListener('click', openPriorityDetails);
  document.getElementById('openCouncilorRosterBtn')?.addEventListener('click', () => openLibraryScreen('councilors'));
  document.getElementById('priorityOperatives')?.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-open-roster]');
    if (!chip) return;
    openLibraryScreen('councilors');
  });
  document.getElementById('hudHateMeter')?.addEventListener('click', () => {
    const records = document.querySelector('.init-records');
    if (records && !records.open) records.open = true;
    const target = document.getElementById('alienHateEconomics');
    requestAnimationFrame(() => {
      (target?.closest('.tech-card') || target)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });
  document.querySelector('.init-records')?.addEventListener('toggle', (event) => {
    const grid = event.currentTarget.querySelector('.init-records__grid');
    grid?.toggleAttribute('inert', !event.currentTarget.open);
    if (event.currentTarget.open && state.briefing && state.rawSnapshot) renderDashboard();
  });
}

async function loadData() {
  state.isLoading = true;
  const requestId = ++state.requestSequence;
  state.abortController?.abort();
  const controller = new AbortController();
  state.abortController = controller;
  try {
    const res = await fetch(`/api/v2/briefing?mode=${state.mode}&observer=${state.observer}`, { signal: controller.signal });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error || `Failed to load telemetry (${res.status})`);
    if (requestId !== state.requestSequence) return;

    const consistency = verifySnapshotConsistency(json);
    if (!consistency.ok) {
      throw new Error(consistency.message);
    }

    state.briefing = json.briefing;
    state.rawSnapshot = json.data;
    state.snapshotIdentity = consistency.identity;
    document.getElementById('initTelemetryBanner')?.remove();

    populateObserverSelect(state.rawSnapshot.factions || []);
    renderDashboard();
    const factionScreen = document.getElementById('factionIntelScreen');
    const factionRoot = document.getElementById('factionIntelRoot');
    if (factionScreen && !factionScreen.hidden && factionRoot && window.FactionIntelScreen) {
      factionController = window.FactionIntelScreen.render(factionRoot, state.rawSnapshot, state.briefing, state.observer);
    }
    const libraryScreen = document.getElementById('intelligenceLibraryScreen');
    const libraryRoot = document.getElementById('intelligenceLibraryRoot');
    if (libraryScreen && !libraryScreen.hidden && libraryRoot && window.IntelligenceLibrary) {
      Object.assign(state.libraryView, {
        onOpenFaction: (factionId) => {
          setOverlayOpen(libraryScreen, false);
          document.body.classList.remove('intelligence-library-open');
          if (factionScreen && factionRoot && window.FactionIntelScreen) {
            factionController = window.FactionIntelScreen.render(factionRoot, state.rawSnapshot, state.briefing, state.observer);
            factionController?.select?.(factionId);
            setOverlayOpen(factionScreen, true);
            document.body.classList.add('faction-intel-open');
          }
        },
        onCopyExport: copyLibraryExport
      });
      window.IntelligenceLibrary.render(libraryRoot, state.rawSnapshot, state.briefing, state.observer, state.libraryView);
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    console.error('[Mission Control] Error loading telemetry:', err);
    state.briefing = null;
    state.rawSnapshot = null;
    state.snapshotIdentity = null;
    renderTelemetryUnavailable(err.message);
    showToast('Telemetry error: ' + err.message);
  } finally {
    if (state.requestSequence === requestId) {
      state.isLoading = false;
    }
  }
}

function readIdentity(source) {
  const value = source || {};
  return {
    snapshotId: value.snapshotId || value.snapshotIdentity?.snapshotId || value.metadata?.snapshotId || null,
    saveHash: value.saveHash || value.snapshotIdentity?.saveHash || value.metadata?.saveHash || null,
    saveModifiedAt: value.saveModifiedAt || value.snapshotIdentity?.saveModifiedAt || value.metadata?.saveModifiedAt || null,
    generatedAt: value.generatedAt || value.snapshotIdentity?.generatedAt || value.metadata?.generatedAt || null
  };
}

function verifySnapshotConsistency(response) {
  const expected = readIdentity(response);
  const datasets = [
    { label: 'briefing', identity: readIdentity(response.briefing) },
    { label: 'data', identity: readIdentity(response.data) }
  ];
  const required = ['snapshotId', 'saveHash', 'saveModifiedAt', 'generatedAt'];
  const missing = required.filter((key) => !expected[key]);
  if (missing.length) {
    return {
      ok: false,
      message: `MIXED / STALE INTELLIGENCE — response is missing ${missing.join(', ')}. Refresh or republish the current save.`
    };
  }

  for (const dataset of datasets) {
    const mismatches = required.filter((key) => dataset.identity[key] !== expected[key]);
    if (mismatches.length) {
      return {
        ok: false,
        message: `MIXED / STALE INTELLIGENCE — Expected snapshot ${expected.snapshotId}; ${dataset.label} does not match (${mismatches.join(', ')}).`
      };
    }
  }

  return { ok: true, identity: expected };
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

  // The publishing fan-out policy may cover only some factions. Offering an
  // observer with no rows returns 404 and blanks the dashboard, so restrict
  // the list when the runtime advertises one. A null/absent list means no
  // restriction (local runs, or a campaign published before this was tracked).
  const allowed = Array.isArray(state.runtime?.availableObservers)
    ? new Set(state.runtime.availableObservers.map(Number))
    : null;
  const selectable = allowed ? factions.filter(f => allowed.has(Number(f.ID))) : factions;
  if (selectable.length === 0) return;

  select.innerHTML = selectable.map(f => `
    <option value="${escapeHtml(f.ID)}" ${f.ID === state.observer ? 'selected' : ''}>${escapeHtml(f.displayName)}</option>
  `).join('');
}

function renderDashboard() {
  if (!state.briefing || !state.rawSnapshot) return;

  renderTopHUD();
  renderHeroKPIs();
  renderHolographicCore();
  renderThreatBoard();
  renderGeopoliticalMapAndSectors();
  renderFactionDonut();
  renderResourceFlowChart();
  renderPowerTrajectoryChart();
  renderDualAssetRings();
  if (window.MissionControlDirectiveBoard?.render) {
    // The engine guarantees its primary is an action rather than a
    // prohibition, so this board is the one place the dashboard can promise
    // "here is what to do", with the vetoes shown as reasoning beside it.
    window.MissionControlDirectiveBoard.render(
      document.getElementById('directiveBoard'),
      // /api/v2/briefing returns { briefing, data }; the engine output rides
      // on the briefing, not on the raw snapshot.
      { engineDirectives: state.briefing?.engineDirectives }
    );
  }
  if (window.MissionControlMcBudget?.render) {
    // Per-hull Mission Control comes from the game templates via the snapshot;
    // it is what turns the hate floor from a readout into a build decision.
    window.MissionControlMcBudget.render(
      document.getElementById('mcBudget'),
      {
        economics: state.rawSnapshot.alienHateEconomics,
        shipHullStats: state.rawSnapshot.shipHullStats
      }
    );
  }

  if (window.MissionControlHateEconomics?.render) {
    window.MissionControlHateEconomics.render(
      document.getElementById('alienHateEconomics'),
      state.rawSnapshot.alienHateEconomics
    );
  }
  renderOperativeLeaderboard();
  renderHoldingsBubbleMatrix();
  renderResearchWatchlist();
  renderSinceLastSave();
  renderDirectivesStream();
}

function renderTopHUD() {
  const { campaignDate, observerName, powerScore, sitrep = {} } = state.briefing;
  const meta = state.rawSnapshot?.metadata || {};
  const identity = state.snapshotIdentity || state.briefing || {};
  const observerFaction = observerFactionRecord();
  const resolvedObserverName = observerName || observerFaction?.displayName || 'Unknown faction';

  document.getElementById('hudDate').textContent = formatCampaignDate(campaignDate);
  const hudDate = document.getElementById('hudDate');
  if (hudDate) hudDate.title = campaignDate || 'UNAVAILABLE';
  document.getElementById('hudSave').textContent = meta.fileName || meta.activeSaveFileName || 'Latest';

  const brandName = document.getElementById('initBrandFactionName');
  if (brandName) brandName.textContent = brandFactionLabel(resolvedObserverName);
  updateFactionLogoSlot(document.getElementById('initFactionLogo'), observerFaction, 'faction-logo faction-logo--title');
  document.title = `${resolvedObserverName} // Executive Situation Report`;

  const hudName = document.getElementById('hudFactionName');
  if (hudName) hudName.textContent = resolvedObserverName;
  updateFactionLogoSlot(document.getElementById('hudFactionLogo'), observerFaction, 'faction-logo faction-logo--hud');
  updateFactionLogoSlot(document.getElementById('initObserverSelectLogo'), observerFaction, 'faction-logo faction-logo--select');

  document.getElementById('hudPower').textContent = `${powerScore}/100`;
  if (window.MissionControlHateEconomics?.renderHud) {
    window.MissionControlHateEconomics.renderHud(
      document.getElementById('hudHateMeter'),
      state.rawSnapshot.alienHateEconomics,
      observerFaction?.alienHate
    );
  }
  const snapshotHud = document.getElementById('hudSnapshot');
  if (snapshotHud) {
    const generatedDate = identity.generatedAt ? new Date(identity.generatedAt) : null;
    const generatedAgeMinutes = generatedDate && Number.isFinite(generatedDate.getTime()) ? Math.max(0, (Date.now() - generatedDate.getTime()) / 60000) : null;
    const saveDate = identity.saveModifiedAt ? new Date(identity.saveModifiedAt) : null;
    const saveAgeMinutes = saveDate && Number.isFinite(saveDate.getTime()) ? Math.max(0, (Date.now() - saveDate.getTime()) / 60000) : null;
    const ageLabel = generatedAgeMinutes === null ? 'UNAVAILABLE' : generatedAgeMinutes < 1 ? '<1m' : generatedAgeMinutes < 60 ? `${Math.round(generatedAgeMinutes)}m` : `${Math.floor(generatedAgeMinutes / 60)}h ${Math.round(generatedAgeMinutes % 60)}m`;
    const saveAgeLabel = saveAgeMinutes === null ? 'UNAVAILABLE' : saveAgeMinutes < 1 ? '<1m' : saveAgeMinutes < 60 ? `${Math.round(saveAgeMinutes)}m` : `${Math.floor(saveAgeMinutes / 60)}h ${Math.round(saveAgeMinutes % 60)}m`;
    snapshotHud.textContent = generatedDate && Number.isFinite(generatedDate.getTime()) ? `${generatedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} / ${ageLabel}` : 'UNAVAILABLE';
    snapshotHud.title = `Generated ${generatedDate && Number.isFinite(generatedDate.getTime()) ? generatedDate.toLocaleString() : 'unavailable'} · save age ${saveAgeLabel}`;
    const snapshotPill = snapshotHud.closest('.init-hud-pill');
    snapshotPill?.classList.toggle('is-stale', generatedAgeMinutes !== null && generatedAgeMinutes >= 15);
    snapshotPill?.classList.toggle('is-critical', generatedAgeMinutes !== null && generatedAgeMinutes >= 60);
  }

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
    ? `Composite estimate · Rank #${state.briefing.observerRank}`
    : 'Composite estimate · rank unavailable';
}

function renderHolographicCore() {
  const topDirective = primaryDirective() || {
    title: 'Consolidate holdings',
    statement: 'Maintain network surveillance until a higher-priority order is available.',
    missionType: 'UNAVAILABLE',
    window: 'This cycle',
    successFactor: 'UNAVAILABLE',
    missionCost: 'UNAVAILABLE',
    eligibleOperatives: []
  };

  document.getElementById('holoPrimaryTitle').textContent = topDirective.title;
  document.getElementById('holoPrimaryStatement').textContent = topDirective.statement;

  const setMeta = (id, value) => {
    const node = document.getElementById(id);
    if (!node) return;
    const text = value || 'UNAVAILABLE';
    node.textContent = text;
    node.classList.toggle('is-unavailable', String(text).toUpperCase() === 'UNAVAILABLE');
  };
  setMeta('priorityMissionType', topDirective.missionType);
  setMeta('priorityWindow', topDirective.window || 'This cycle');
  setMeta('prioritySuccess', topDirective.successFactor);
  setMeta('priorityMissionCost', topDirective.missionCost || 'UNAVAILABLE');

  const policyNote = document.getElementById('priorityPolicyNote');
  if (policyNote) {
    const note = topDirective.policyNote || '';
    policyNote.hidden = !note;
    policyNote.textContent = note;
  }
  const hateBand = document.getElementById('priorityExpectedHate');
  if (hateBand) {
    const label = topDirective.expectedAlienHate
      ? `Expected alien hate: ${topDirective.expectedAlienHate}`
      : '';
    hateBand.hidden = !label;
    hateBand.textContent = label;
  }

  const roster = document.getElementById('priorityOperatives');
  if (roster) {
    const operatives = Array.isArray(topDirective.eligibleOperatives) ? topDirective.eligibleOperatives.slice(0, 3) : [];
    if (!operatives.length) {
      roster.innerHTML = '<p class="since-save-empty">No eligible observer councilors are visible. Open the roster to inspect the current picture.</p>';
    } else {
      roster.innerHTML = operatives.map((op) => `
        <button class="priority-op ${op.available ? 'is-ready' : ''}" type="button" data-open-roster="${escapeHtml(op.id)}">
          <span>
            <strong>${escapeHtml(op.name)}</strong>
            <span>${escapeHtml(op.profession || 'Councilor')} · ${escapeHtml(op.location || 'Unknown location')}${op.matchSkill ? ` · ${escapeHtml(op.matchSkill)} ${escapeHtml(op.matchValue ?? '')}` : ''}</span>
          </span>
          <em>${op.available ? 'Idle' : escapeHtml(op.mission || 'Assigned')}</em>
        </button>
      `).join('');
    }
  }

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

function renderThreatBoard() {
  const board = document.getElementById('threatBoard');
  if (!board) return;
  const cards = Array.isArray(state.briefing?.sitrep?.threatCards) ? state.briefing.sitrep.threatCards.slice(0, 3) : [];
  if (!cards.length) {
    board.innerHTML = '<p class="since-save-empty">No discrete threat cards are available in this intelligence picture.</p>';
    return;
  }
  board.innerHTML = cards.map((card) => `
    <article class="threat-card">
      <div class="threat-card__kicker severity-${escapeHtml(card.severity || 'WATCH')}">${escapeHtml(card.severity || 'WATCH')}</div>
      <h3 class="threat-card__title">${escapeHtml(card.title)}</h3>
      <p class="threat-card__statement">${escapeHtml(card.statement)}</p>
    </article>
  `).join('');
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
  if (window.MissionControlBoards?.renderFactionLedger) {
    window.MissionControlBoards.renderFactionLedger(container, state.rawSnapshot);
    return;
  }
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
    <div class="donut-wrapper" role="img" aria-label="Faction power estimates: ${escapeHtml(knownFactions.map((f) => `${f.displayName} ${getPower(f)}`).join(', ') || 'No faction power estimates available')}" tabindex="0">
      <div class="donut-svg-box">
        <svg viewBox="0 0 110 110" style="width: 100%; height: 100%;">
          ${paths}
          <circle cx="55" cy="55" r="24" fill="#070d1e" />
          <text x="55" y="58" text-anchor="middle" fill="#fff" font-family="var(--font-mono)" font-size="8" font-weight="800">EST. SCORE</text>
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
  if (window.MissionControlBoards?.renderLogisticsBoard) {
    window.MissionControlBoards.renderLogisticsBoard(container, state.rawSnapshot, state.briefing?.strategic);
    return;
  }
  if (!container) return;
  const position = state.briefing?.strategic?.resourcePosition;
  if (!position || !position.resources) {
    container.innerHTML = '<div class="chart-empty">Resource runway is unavailable in this snapshot.</div>';
    return;
  }

  const resources = Object.values(position.resources);
  const rows = resources.map(resource => {
    const stock = resource.stock === null ? 'UNAVAILABLE' : formatChangeValue(resource.stock);
    const gross = resource.grossPerMonth === null ? 'UNAVAILABLE' : `+${formatChangeValue(resource.grossPerMonth)}`;
    const runway = resource.runwayDays === null ? 'UNAVAILABLE' : `${formatChangeValue(resource.runwayDays)}d`;
    const producer = resource.topProducers?.[0]
      ? `${resource.topProducers[0].site} / +${formatChangeValue(resource.topProducers[0].monthly)}`
      : 'No active producer';
    return `<tr><th scope="row">${escapeHtml(resource.label)}</th><td>${escapeHtml(stock)}</td><td>${escapeHtml(gross)} / mo</td><td>${escapeHtml(runway)}</td><td>${escapeHtml(producer)}</td></tr>`;
  }).join('');

  container.innerHTML = `<div class="resource-position-note"><strong>STOCK / GROSS PRODUCTION</strong><span>Runway and burn remain explicitly unavailable until the save exposes committed consumption.</span></div><div class="resource-position-table-wrap"><table class="resource-position-table"><thead><tr><th>Resource</th><th>Stock</th><th>Gross</th><th>Runway</th><th>Top producer</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderPowerTrajectoryChart() {
  const container = document.getElementById('powerTrajectoryChart');
  if (window.MissionControlBoards?.renderCapabilityMatrix) {
    window.MissionControlBoards.renderCapabilityMatrix(container, state.rawSnapshot, state.briefing);
    return;
  }
  if (!container) return;

  const profiles = state.briefing?.strategic?.powerProfiles || [];
  if (!profiles.length) {
    container.innerHTML = '<div class="chart-empty">Separate power dimensions are unavailable in this intelligence mode.</div>';
    return;
  }

  const visibleProfiles = profiles.slice().sort((a, b) => (b.compositePower ?? b.fleetAssets ?? 0) - (a.compositePower ?? a.fleetAssets ?? 0)).slice(0, 6);
  const dimensions = [
    ['economic', 'Earth'],
    ['research', 'Research'],
    ['industry', 'Industry'],
    ['fleetAssets', 'Fleet assets']
  ];
  container.innerHTML = `<div class="power-profile-note">DIMENSIONS / ECONOMY, RESEARCH, INDUSTRY, FLEET ASSETS <span>Fleet assets are ship-count indices when combat power is unavailable.</span></div><div class="power-profile-list">${visibleProfiles.map(profile => {
    const observerClass = String(profile.factionId) === String(state.observer) ? ' is-observer' : '';
    return `<article class="power-profile-row${observerClass}"><div class="power-profile-name">${escapeHtml(profile.factionName)}${profile.compositePower === null ? '<small>NO COMBAT VALUE</small>' : ''}</div><div class="power-profile-bars">${dimensions.map(([key, label]) => `<div class="power-profile-bar"><span>${escapeHtml(label)}</span><i><b style="width:${profile[key] === null ? 0 : profile[key]}%"></b></i><em>${profile[key] === null ? 'N/A' : profile[key]}</em></div>`).join('')}</div></article>`;
  }).join('')}</div>`;
}

function renderDualAssetRings() {
  const container = document.getElementById('dualAssetRings');
  if (window.MissionControlBoards?.renderTheaterBoard) {
    window.MissionControlBoards.renderTheaterBoard(container, state.rawSnapshot, state.briefing?.strategic);
    return;
  }
  if (!container) return;

  const observer = (state.rawSnapshot.factions || []).find(f => f.ID === state.observer) || {};
  const alien = (state.rawSnapshot.factions || []).find(f => f.ID === 4717 || f.displayName === 'the Aliens') || {};
  const threat = state.briefing?.strategic?.spacePosture || {};
  const metrics = [
    { label: 'Control points', value: observer.controlPointsCount ?? '—' },
    { label: 'Orbital sites', value: observer.habsCount ?? '—' },
    { label: 'Fleets', value: observer.fleetsCount ?? '—' }
  ];
  const threatMetrics = [
    { label: 'Alien hate', value: alien.alienHate?.actual ?? alien.alienHate?.visibleEstimate ?? 'UNAVAILABLE' },
    { label: 'Alien ships / all tracked bodies', value: threat.total?.ships ?? 'UNAVAILABLE' },
    { label: 'Alien ships / orbit body: Sol', value: threat.sol?.ships ?? 'UNAVAILABLE' }
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
    <div class="threat-posture-heading"><span>ALIEN SPACE POSTURE / SCOPE EXPLICIT</span><small>${escapeHtml(threat.confidence || 'UNKNOWN')}</small></div>
    <div class="asset-posture-grid threat-posture-grid">
      ${threatMetrics.map(metric => `
        <div class="asset-posture-metric">
          <strong>${escapeHtml(metric.value)}</strong>
          <span>${escapeHtml(metric.label)}</span>
        </div>
      `).join('')}
    </div>
    ${threat.largestHostileFleet ? `<div class="largest-hostile-fleet"><span>LARGEST HOSTILE CONCENTRATION</span><strong>${escapeHtml(threat.largestHostileFleet.name)} / ${escapeHtml(threat.largestHostileFleet.ships)} ships</strong><small>${escapeHtml(threat.largestHostileFleet.orbitBody || 'Unknown body')} · ${escapeHtml(threat.largestHostileFleet.weaponSummary || 'Loadout unavailable')}</small></div>` : ''}
  `;
}

function renderOperativeLeaderboard() {
  const container = document.getElementById('opLeaderboardList');
  if (window.MissionControlBoards?.renderOperationsBoard) {
    window.MissionControlBoards.renderOperationsBoard(container, state.rawSnapshot, state.briefing?.strategic);
    return;
  }
  if (!container || !state.briefing.operatives) return;

  const operatives = [...state.briefing.operatives].sort((a, b) => b.totalSkills - a.totalSkills).slice(0, 4);
  const capability = state.briefing.strategic?.councilCapabilities;

  const operativeRows = operatives.map(op => {
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
  const roleRows = capability?.missionRoles?.map(role => {
    const best = role.best;
    return `<div class="council-capability-row"><span>${escapeHtml(role.mission)}</span><strong>${escapeHtml(best?.name || 'UNAVAILABLE')}</strong><em>${best?.value === null || best?.value === undefined ? '—' : escapeHtml(best.value)} ${escapeHtml(role.skill.slice(0, 3).toUpperCase())}</em></div>`;
  }).join('') || '';
  const gaps = capability?.gaps?.length ? `<div class="council-capability-gaps">${capability.gaps.map(gap => `<span>⚠ ${escapeHtml(gap)}</span>`).join('')}</div>` : '';
  container.innerHTML = `<div class="operative-leaderboard-label">TOP COUNCILORS / AGGREGATE SKILL</div>${operativeRows}<div class="council-capability-block"><div class="operative-leaderboard-label">MISSION COVERAGE</div>${roleRows}${gaps}</div>`;
}

function renderResearchWatchlist() {
  const container = document.getElementById('researchWatchlist');
  if (window.MissionControlBoards?.renderResearchWatchlist) {
    window.MissionControlBoards.renderResearchWatchlist(container, state.rawSnapshot);
  }
}

function formatChangeValue(value) {
  if (value === null || value === undefined) return 'UNKNOWN';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  if (Math.abs(numeric) >= 1000000000000) return `${(numeric / 1000000000000).toFixed(1)}T`;
  if (Math.abs(numeric) >= 1000000000) return `${(numeric / 1000000000).toFixed(1)}B`;
  if (Math.abs(numeric) >= 1000000) return `${(numeric / 1000000).toFixed(1)}M`;
  return Number.isInteger(numeric) ? numeric.toLocaleString() : numeric.toFixed(2);
}

function changeLine(change) {
  if (!change) return '';
  const isThreat = change.polarity === 'danger';
  const directionClass = isThreat
    ? (change.delta > 0 ? 'is-negative' : 'is-positive')
    : (change.delta > 0 ? 'is-positive' : 'is-negative');
  return `<div class="since-save-change ${isThreat ? 'is-threat' : ''}"><span>${escapeHtml(change.metric)}</span><strong>${escapeHtml(formatChangeValue(change.from))} → ${escapeHtml(formatChangeValue(change.to))}</strong><em class="${directionClass}">${escapeHtml(change.deltaLabel || '')}</em></div>`;
}

function renderSinceLastSave() {
  const container = document.getElementById('sinceLastSave');
  if (!container) return;
  const panel = container.closest('.init-since-save-banner');
  const delta = state.rawSnapshot?.changesSincePrevious || state.briefing?.changesSincePrevious;
  if (!delta || !delta.available) {
    if (panel) panel.hidden = true;
    return;
  }
  if (panel) panel.hidden = false;

  const sections = [];
  const changedFactions = (delta.factions || []).filter(faction => (faction.changes || []).length);
  changedFactions.slice(0, 6).forEach((faction) => {
    sections.push(`<article class="since-save-card"><div class="since-save-card-heading"><span>${escapeHtml(faction.factionName)}</span><small>FACTION POSTURE</small></div>${faction.changes.slice(0, 5).map(changeLine).join('')}</article>`);
  });
  if ((delta.resources || []).length) {
    sections.push(`<article class="since-save-card"><div class="since-save-card-heading"><span>OBSERVER RESOURCES</span><small>STOCKPILE CHANGE</small></div>${delta.resources.slice(0, 6).map(changeLine).join('')}</article>`);
  }
  if ((delta.politics || []).length) {
    sections.push(`<article class="since-save-card"><div class="since-save-card-heading"><span>EXECUTIVE CONTROL</span><small>${delta.politics.length} CHANGE${delta.politics.length === 1 ? '' : 'S'}</small></div>${delta.politics.slice(0, 5).map(change => `<div class="since-save-politics"><strong>${escapeHtml(change.nationName)}</strong><span>${escapeHtml(change.fromFactionName)} → ${escapeHtml(change.toFactionName)}</span></div>`).join('')}</article>`);
  }
  if ((delta.unrest || []).length) {
    sections.push(`<article class="since-save-card since-save-card--threat"><div class="since-save-card-heading"><span>CIVIL STABILITY</span><small>${delta.unrest.length} UNREST CHANGE${delta.unrest.length === 1 ? '' : 'S'}</small></div>${delta.unrest.slice(0, 5).map(entry => `<div class="since-save-politics"><strong>${escapeHtml(entry.nationName)}</strong>${changeLine(entry.change)}</div>`).join('')}</article>`);
  }
  if ((delta.research || []).length) {
    sections.push(`<article class="since-save-card"><div class="since-save-card-heading"><span>RESEARCH MOVEMENT</span><small>${delta.research.length} ACTIVE</small></div>${delta.research.slice(0, 5).map(change => `<div class="since-save-politics"><strong>${escapeHtml(change.projectName || change.projectId || 'Project')}</strong><span>${change.fromPercent === null ? 'NEW' : `${escapeHtml(formatChangeValue(change.fromPercent))}%`} → ${change.toPercent === null ? 'UNKNOWN' : `${escapeHtml(formatChangeValue(change.toPercent))}%`}</span></div>`).join('')}</article>`);
  }
  const threatChanges = Object.values(delta.threat || {}).filter(Boolean);
  if (threatChanges.length) {
    sections.push(`<article class="since-save-card since-save-card--threat"><div class="since-save-card-heading"><span>ALIEN SPACE POSTURE</span><small>ALIEN CONTACTS / ALL TRACKED BODIES · ORBIT BODY: SOL</small></div>${threatChanges.map(changeLine).join('')}</article>`);
  }

  const elapsed = delta.elapsedGameDays === null || delta.elapsedGameDays === undefined ? 'ELAPSED TIME UNKNOWN' : `${formatChangeValue(delta.elapsedGameDays)} GAME DAYS ELAPSED`;
  const previousLabel = formatCampaignDate(delta.previousCampaignDate) || 'previous save unavailable';
  container.innerHTML = `<div class="since-save-meta"><strong>${escapeHtml(elapsed)}</strong><span>Compared with ${escapeHtml(previousLabel)}. Empty categories mean no normalized change was detected.</span></div>${sections.length ? sections.slice(0, 3).join('') : '<div class="since-save-empty"><strong>NO MATERIAL CHANGE DETECTED</strong><span>The current normalized datasets match the immediately previous save.</span></div>'}`;
}

function renderHoldingsBubbleMatrix() {
  const container = document.getElementById('holdingsBubbleMatrix');
  if (window.MissionControlBoards?.renderNationQueue) {
    window.MissionControlBoards.renderNationQueue(container, state.rawSnapshot, state.briefing);
    return;
  }
  if (!container || !state.rawSnapshot.nations) return;

  const topNations = [...state.rawSnapshot.nations].sort((a, b) => (b.GDP || 0) - (a.GDP || 0)).slice(0, 5);

  const colors = ['var(--blue)', 'var(--accent)', 'var(--init-pink)', 'var(--gold)', 'var(--success)'];

  container.setAttribute('role', 'img');
  container.setAttribute('aria-label', 'Largest economies: ' + topNations.map((n) => `${n.displayName}, ${((n.GDP || 0) / 1e12).toFixed(1)} trillion GDP, executive ${n.executiveFactionName || 'Independent'}`).join('; '));
  container.innerHTML = topNations.map((n, i) => {
    const gdpTrill = ((n.GDP || 0) / 1e12).toFixed(1);
    const size = 42 + i * 4;
    return `
      <div class="holding-bubble" role="img" aria-label="${escapeHtml(n.displayName)}: $${escapeHtml(gdpTrill)}T GDP; executive ${escapeHtml(n.executiveFactionName || 'Independent')}" style="--bubble-accent: ${colors[i % colors.length]}; width: ${size}px; height: ${size}px; font-size: ${size < 48 ? '8.5px' : '9.5px'};" title="${escapeHtml(n.displayName)}: $${escapeHtml(gdpTrill)}T (${escapeHtml(n.executiveFactionName || 'Independent')})">
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
if (__shared) {
  toFiniteNumber = __shared.toFiniteNumber;
}

function showToast(msg) {
  const toast = document.getElementById('mcToast');
  if (!toast) return;
  toast.textContent = msg;
  toast.style.display = 'block';
  setTimeout(() => { toast.style.display = 'none'; }, 3500);
}

async function copyLibraryExport(format, statusNode) {
  if (statusNode) statusNode.textContent = 'Preparing current handoff…';
  try {
    const res = await fetch(`/api/export?format=${format === 'full' ? 'full' : 'chatgpt'}&mode=${encodeURIComponent(state.mode)}&observer=${encodeURIComponent(state.observer)}`);
    const payload = await res.json();
    if (!res.ok || !payload.success || !payload.markdown) throw new Error(payload.error || 'Export unavailable');
    await copyText(payload.markdown);
    if (statusNode) statusNode.textContent = `${format === 'full' ? 'Full' : 'Compact'} snapshot copied with ${state.mode.toUpperCase()} visibility labels.`;
    showToast('Snapshot copied to clipboard.');
  } catch (err) {
    if (statusNode) statusNode.textContent = `Export unavailable — ${err.message}`;
    showToast('Snapshot export failed.');
  }
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('Clipboard access is unavailable in this browser.');
}
