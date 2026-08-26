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

// Expose mounting registry on window for strangler migration interoperability
if (typeof window !== 'undefined') {
  window.MissionControlMcBudget = { render: renderMcBudget };
  window.MissionControlStrategicCommentary = { renderStrategicCommentary };
  window.MissionControlFleetEngagement = {
    render: renderFleetEngagement,
    fetchFleetEngagement,
  };

  window.MissionControlReact = {
    mountReactPanel,
    unmountReactPanel,
    mountCoexistenceProof,
    mountMcBudget: renderMcBudget,
    mountStrategicCommentary: renderStrategicCommentary,
    mountFleetEngagement: renderFleetEngagement,
    fetchFleetEngagement,
    CoexistenceProof,
    McBudget,
    StrategicCommentary,
    FleetEngagement,
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
