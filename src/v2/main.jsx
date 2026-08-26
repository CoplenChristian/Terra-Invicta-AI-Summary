/**
 * src/v2/main.jsx
 *
 * Purpose: React + MUI entry point for Mission Control (v2) dashboard.
 *
 * Phase 0: Establishes the Vite + React + MUI runtime and mount plumbing.
 *   Contains the coexistence proof component, which demonstrates mounting via
 *   createRoot(document.getElementById(panelId)) from the VIEWS registry table,
 *   reading global state without disrupting unmigrated vanilla panels.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { McBudget } from './panels/McBudget.jsx';
import { StrategicCommentary } from './panels/StrategicCommentary.jsx';
import { FleetEngagement } from './panels/FleetEngagement.jsx';
import { AlienHateEconomics, renderHudAlienHateEconomics } from './panels/AlienHateEconomics.jsx';
import { IntelligenceLibrary } from './panels/IntelligenceLibrary.jsx';
import { MiningExpansion } from './panels/MiningExpansion.jsx';
import { CouncilOrders } from './panels/CouncilOrders.jsx';
import { ResearchAdvisor } from './panels/ResearchAdvisor.jsx';
import {
  fetchResearchRanking,
  openFullRanking as openResearchFullRanking,
  slotFacts as researchSlotFacts,
} from './panels/researchAdvisorUtils.mjs';
import { WorldMap } from './panels/WorldMap.jsx';
import {
  DriveExplorer,
  driveExplorerInternals,
  fetchDriveExplorer,
  loadDriveExplorer,
  openDrivePath,
  renderDriveExplorer,
  setDriveExplorerMount,
} from './panels/DriveExplorer.jsx';
import { DirectiveBoard } from './panels/DirectiveBoard.jsx';
import { UnlockedTech } from './panels/UnlockedTech.jsx';
import {
  FactionIntel,
  createEmptyController,
  createFactionIntelController,
} from './panels/FactionIntel.jsx';
import {
  CapabilityMatrixBoard,
  FactionLedgerBoard,
  LogisticsBoard,
  NationQueueBoard,
  OperationsBoard,
  ResearchWatchlistBoard,
  TheaterBoard,
} from './panels/ExecutiveBoards.jsx';

/**
 * Throwaway Phase 0 Coexistence Proof Component.
 * Reads a value from the existing global state and renders a minimal indicator
 * when explicitly enabled via `?react_proof=1` or `window.__ENABLE_REACT_PROOF__`.
 */
export function CoexistenceProof({ targetPanelId }) {
  const [saveDate, setSaveDate] = React.useState(null);

  React.useEffect(() => {
    // Read from global window state or MissionControlShared
    const date = window.state?.rawSnapshot?.metadata?.gameTimeString ||
      window.MissionControlShared?.formatGameDate?.(window.state?.rawSnapshot?.metadata?.gameTime) ||
      'State Loaded';
    setSaveDate(date);
  }, []);

  return (
    <Box
      data-testid="react-coexistence-proof"
      sx={{
        p: 1,
        m: 1,
        border: '1px solid var(--accent, #64ffda)',
        borderRadius: '4px',
        backgroundColor: 'rgba(100, 255, 218, 0.08)',
        color: 'var(--text, #e6f1ff)',
        fontSize: '11px',
        fontFamily: 'monospace'
      }}
    >
      <Typography variant="caption" sx={{ fontWeight: 'bold', color: 'var(--accent, #64ffda)' }}>
        [React Coexistence Proof]
      </Typography>
      <Typography variant="body2" sx={{ fontSize: '11px' }}>
        Mounted in #{targetPanelId} · Live Save Date: {saveDate || 'Reading...'}
      </Typography>
    </Box>
  );
}

const activeRoots = new Map();

/**
 * Mounts a React component into a specified DOM node.
 * Follows the strangler migration pattern used across Phases 2..N.
 *
 * @param {string|HTMLElement} target - Element ID or DOM node from VIEWS registry
 * @param {React.ReactElement} element - React component element to render
 * @returns {import('react-dom/client').Root}
 */
export function mountReactPanel(target, element) {
  const container = typeof target === 'string' ? document.getElementById(target) : target;
  if (!container) {
    console.warn(`[React Mount] Target container '#${target}' not found in DOM.`);
    return null;
  }

  let root = activeRoots.get(container);
  if (!root) {
    root = createRoot(container);
    activeRoots.set(container, root);
  }

  root.render(element);
  return root;
}

/**
 * Unmounts a React component from a container.
 */
export function unmountReactPanel(target) {
  const container = typeof target === 'string' ? document.getElementById(target) : target;
  if (!container) return;

  const root = activeRoots.get(container);
  if (root) {
    root.unmount();
    activeRoots.delete(container);
  }
}

/**
 * Mounts the throwaway proof component into a VIEWS-registered container.
 */
export function mountCoexistenceProof(targetPanelId = 'strategicCommentary') {
  const mountEl = document.getElementById(targetPanelId);
  if (!mountEl) {
    console.warn(`[React Proof] Container #${targetPanelId} not found in DOM.`);
    return null;
  }

  let wrapper = document.getElementById('reactProofWrapper');
  if (!wrapper) {
    wrapper = document.createElement('div');
    wrapper.id = 'reactProofWrapper';
    mountEl.prepend(wrapper);
  }

  return mountReactPanel(wrapper, <CoexistenceProof targetPanelId={targetPanelId} />);
}

/**
 * Strangler bridge matching window.MissionControlMcBudget.render(root, payload).
 */
export function renderMcBudget(root, payload) {
  if (!root) return;
  mountReactPanel(root, <McBudget payload={payload} />);
}

/**
 * Strangler bridge matching window.MissionControlStrategicCommentary.renderStrategicCommentary.
 * Accepts a container id string (not an element) — the registry adapter absorbs that difference.
 */
export function renderStrategicCommentary(commentaryData, containerId = 'strategicCommentary') {
  const container = typeof containerId === 'string'
    ? document.getElementById(containerId)
    : containerId;
  if (!container) return;
  mountReactPanel(container, <StrategicCommentary data={commentaryData} />);
}

/**
 * Strangler bridge matching window.MissionControlFleetEngagement.fetchFleetEngagement.
 */
export async function fetchFleetEngagement(observerId = 4712, mode = 'player') {
  try {
    const res = await fetch(`/api/intel/fleet-engagement?observer=${observerId}&mode=${mode}&limit=12`);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn('[FleetEngagement] Failed to fetch engagement estimates:', err);
    return null;
  }
}

/**
 * Strangler bridge matching window.MissionControlFleetEngagement.render(root, data).
 */
export function renderFleetEngagement(root, data) {
  if (!root) return;
  mountReactPanel(root, <FleetEngagement data={data} />);
}

/**
 * Strangler bridge matching window.MissionControlMiningExpansion.fetchMiningExpansion.
 */
export async function fetchMiningExpansion(observerId = 4712, mode = 'player') {
  try {
    const res = await fetch(`/api/intel/mining-expansion?observer=${observerId}&mode=${mode}`);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn('[MiningExpansion] Failed to fetch expansion data:', err);
    return null;
  }
}

/**
 * Strangler bridge matching window.MissionControlMiningExpansion.render(root, payload).
 */
export function renderMiningExpansion(root, data) {
  if (!root) return;
  mountReactPanel(root, <MiningExpansion data={data} />);
}

/**
 * Strangler bridge matching window.MissionControlCouncilOrders.render(root, payload).
 */
export function renderCouncilOrders(root, payload) {
  if (!root) return;
  mountReactPanel(root, <CouncilOrders payload={payload} />);
}

/**
 * Strangler bridge matching window.MissionControlResearchAdvisor.render(root, payload).
 *
 * `payload` may be null — mission-control.js renders the result of the fetch
 * unconditionally, and null is a supported input that produces the honest
 * "ranking endpoint did not answer" state rather than a placeholder ranking.
 */
export function renderResearchAdvisor(root, payload) {
  if (!root) return;
  mountReactPanel(root, <ResearchAdvisor payload={payload} />);
}

export { fetchResearchRanking, openResearchFullRanking, researchSlotFacts };

/**
 * Strangler bridge matching window.MissionControlUnlockedTech.load(observerId, mode, container).
 *
 * Not `render(root, payload)`: the RECORDS panel takes no payload object at all
 * and reads its own two endpoints, so mission-control.js hands it the observer,
 * the mode and the container it is to own. The call site is the lazy `records`
 * branch of loadLazyViewPanels, guarded by a per-view load key.
 */
export function loadUnlockedTech(observerId, mode, container) {
  const target = typeof container === 'string' ? document.getElementById(container) : container;
  if (!target) return;
  mountReactPanel(target, <UnlockedTech observerId={observerId} mode={mode} />);
}

/**
 * Strangler bridge matching window.WorldTheaterMap.render(container, theaters, options).
 *
 * `container` may be a selector string or an element — mission-control.js resolves
 * `.init-map-container` itself and hands the element over, but the vanilla panel
 * accepted either and the signature is kept.
 *
 * The mount owns a `.world-map-fallback` child reading "REAL WORLD MAP
 * INITIALIZING…" (public/v2/index.html). That fallback is the controller's
 * absent-data affordance and it must survive until the map actually mounts, so it
 * is removed here on the first render rather than left to React's container
 * clearing.
 */
export function renderWorldMap(container, theaters, options = {}) {
  const target = typeof container === 'string' ? document.querySelector(container) : container;
  if (!target) return;
  const fallback = typeof target.querySelector === 'function'
    ? target.querySelector('.world-map-fallback')
    : null;
  if (fallback && typeof fallback.remove === 'function') fallback.remove();
  mountReactPanel(target, <WorldMap theaters={theaters} options={options} />);
}

/**
 * Strangler bridge matching window.MissionControlDirectiveBoard.render(root, payload).
 *
 * `root` is #directiveBoard, the mount id CouncilOrders.jsx cross-navigates to.
 * The payload keeps the vanilla shape — `engineDirectives`, `riskFloorPreference`
 * (null = "no stored choice", NOT 0) and `onRiskFloorChange`.
 */
export function renderDirectiveBoard(root, payload) {
  if (!root) return;
  mountReactPanel(root, <DirectiveBoard payload={payload} />);
}

/**
 * Strangler bridge matching window.IntelligenceLibrary.render(container, snapshot, briefing, observerId, options).
 */
export function renderIntelligenceLibrary(container, snapshot, briefing, observerId, options = {}) {
  if (!container) return;
  mountReactPanel(
    container,
    <IntelligenceLibrary
      snapshot={snapshot}
      briefing={briefing}
      observerId={observerId}
      options={options}
    />,
  );
}

/**
 * Strangler bridge matching window.FactionIntelScreen.render(container, snapshot, briefing, observerId).
 *
 * Returns the same imperative controller the vanilla dossier did — mission-control.js
 * calls `.select(id)` on the line after this one, and `root.render()` has not
 * committed by then, so selection state lives in the controller rather than in
 * a React ref. `container` may be a selector string or an element.
 */
export function renderFactionIntel(container, snapshot, briefing, observerId) {
  const target = typeof container === 'string'
    ? document.querySelector(container)
    : (container && typeof container.nodeType === 'number' ? container : null);
  if (!target) return createEmptyController();

  const controller = createFactionIntelController({
    container: target,
    snapshot,
    briefing,
    observerId,
  });
  controller.setUnmount(() => unmountReactPanel(target));
  mountReactPanel(target, <FactionIntel controller={controller} />);
  return controller;
}

/**
 * Strangler bridge matching window.MissionControlHateEconomics.render(root, economics).
 */
export function renderAlienHateEconomics(root, economics) {
  if (!root) return;
  mountReactPanel(root, <AlienHateEconomics economics={economics} />);
}

export function renderFactionLedger(container, snapshot) {
  if (!container) return;
  mountReactPanel(container, <FactionLedgerBoard snapshot={snapshot} />);
}

export function renderLogisticsBoard(container, snapshot, strategic) {
  if (!container) return;
  mountReactPanel(container, <LogisticsBoard snapshot={snapshot} strategic={strategic} />);
}

export function renderCapabilityMatrix(container, snapshot, briefing) {
  if (!container) return;
  // Unguarded dereference preserved from the vanilla panel so absent snapshots throw synchronously.
  void snapshot.observerFactionId;
  mountReactPanel(container, <CapabilityMatrixBoard snapshot={snapshot} briefing={briefing} />);
}

export function renderTheaterBoard(container, snapshot, strategic) {
  if (!container) return;
  mountReactPanel(container, <TheaterBoard snapshot={snapshot} strategic={strategic} />);
}

export function renderOperationsBoard(container, snapshot, strategic) {
  if (!container) return;
  mountReactPanel(container, <OperationsBoard snapshot={snapshot} strategic={strategic} />);
}

export function renderNationQueue(container, snapshot, briefing) {
  if (!container) return;
  void snapshot.observerFactionId;
  mountReactPanel(container, <NationQueueBoard snapshot={snapshot} briefing={briefing} />);
}

export function renderResearchWatchlist(container, snapshot) {
  if (!container) return;
  void snapshot.observerFactionId;
  mountReactPanel(container, <ResearchWatchlistBoard snapshot={snapshot} />);
}

// The DRIVES panel owns a module-level store (scripts/verify_drive_explorer.js
// reads it), so it mounts itself rather than being handed a fresh element on
// every change. It only needs the mount function.
setDriveExplorerMount(mountReactPanel);

export { renderHudAlienHateEconomics };

// Expose mounting registry on window for strangler migration interoperability
if (typeof window !== 'undefined') {
  window.MissionControlMcBudget = { render: renderMcBudget };
  window.MissionControlStrategicCommentary = { renderStrategicCommentary };
  window.MissionControlFleetEngagement = {
    render: renderFleetEngagement,
    fetchFleetEngagement,
  };
  window.MissionControlMiningExpansion = {
    render: renderMiningExpansion,
    fetchMiningExpansion,
  };
  window.MissionControlHateEconomics = {
    render: renderAlienHateEconomics,
    renderHud: renderHudAlienHateEconomics,
  };
  window.MissionControlCouncilOrders = { render: renderCouncilOrders };
  window.MissionControlDirectiveBoard = { render: renderDirectiveBoard };
  window.MissionControlResearchAdvisor = {
    render: renderResearchAdvisor,
    fetchResearchRanking,
    openFullRanking: openResearchFullRanking,
    slotFacts: researchSlotFacts,
  };
  window.MissionControlUnlockedTech = { load: loadUnlockedTech };
  window.WorldTheaterMap = { render: renderWorldMap };
  window.IntelligenceLibrary = { render: renderIntelligenceLibrary };
  window.FactionIntelScreen = { render: renderFactionIntel };
  window.MissionControlDriveExplorer = {
    load: loadDriveExplorer,
    render: renderDriveExplorer,
    fetchDriveExplorer,
    openDrivePath,
    _internals: driveExplorerInternals,
  };
  window.MissionControlBoards = {
    renderFactionLedger,
    renderLogisticsBoard,
    renderCapabilityMatrix,
    renderTheaterBoard,
    renderOperationsBoard,
    renderNationQueue,
    renderResearchWatchlist,
  };

  window.MissionControlReact = {
    mountReactPanel,
    unmountReactPanel,
    mountCoexistenceProof,
    mountMcBudget: renderMcBudget,
    mountStrategicCommentary: renderStrategicCommentary,
    mountFleetEngagement: renderFleetEngagement,
    mountMiningExpansion: renderMiningExpansion,
    mountCouncilOrders: renderCouncilOrders,
    mountDirectiveBoard: renderDirectiveBoard,
    mountResearchAdvisor: renderResearchAdvisor,
    mountUnlockedTech: loadUnlockedTech,
    mountWorldMap: renderWorldMap,
    mountAlienHateEconomics: renderAlienHateEconomics,
    renderHudAlienHateEconomics,
    mountIntelligenceLibrary: renderIntelligenceLibrary,
    mountFactionIntel: renderFactionIntel,
    mountDriveExplorer: renderDriveExplorer,
    renderFactionLedger,
    renderLogisticsBoard,
    renderCapabilityMatrix,
    renderTheaterBoard,
    renderOperationsBoard,
    renderNationQueue,
    renderResearchWatchlist,
    fetchFleetEngagement,
    fetchMiningExpansion,
    CoexistenceProof,
    McBudget,
    StrategicCommentary,
    FleetEngagement,
    MiningExpansion,
    CouncilOrders,
    DirectiveBoard,
    ResearchAdvisor,
    UnlockedTech,
    WorldMap,
    AlienHateEconomics,
    IntelligenceLibrary,
    FactionIntel,
    DriveExplorer,
    FactionLedgerBoard,
    LogisticsBoard,
    CapabilityMatrixBoard,
    TheaterBoard,
    OperationsBoard,
    NationQueueBoard,
    ResearchWatchlistBoard,
  };

  const urlParams = new URLSearchParams(window.location.search);
  const enableProof = urlParams.get('react_proof') === '1' || window.__ENABLE_REACT_PROOF__ === true;

  if (enableProof) {
    let proofMounted = false;
    const interval = setInterval(() => {
      const el = document.getElementById('strategicCommentary');
      if (el && !document.getElementById('reactProofWrapper')) {
        mountCoexistenceProof('strategicCommentary');
      }
    }, 400);

    // Stop polling after 15 seconds
    setTimeout(() => clearInterval(interval), 15000);
  }
}
