/**
 * src/v2/panels/FleetPanel.jsx
 *
 * Purpose: FLEET view shell — two-column MUI grid with static mount points for
 *   the registered panel. Mount once; imperative panel renders fill the ids.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ThemeProvider } from '@mui/material/styles';
import { TwoColumnGrid, TwoColumnGridItem } from '../components/TwoColumnGrid.jsx';
import initiativeTheme from '../theme.js';

export function FleetPanel() {
  return (
    <ThemeProvider theme={initiativeTheme}>
      <TwoColumnGrid data-view="fleet">
        <TwoColumnGridItem span>
          <div className="tech-card init-view__span">
            <div id="fleetProcurement" aria-live="polite">
              <div className="alien-hate-econ-empty">LOADING FLEET PROCUREMENT…</div>
            </div>
          </div>
        </TwoColumnGridItem>
      </TwoColumnGrid>
    </ThemeProvider>
  );
}

const fleetPanelRoots = typeof WeakMap !== 'undefined' ? new WeakMap() : new Map();

/**
 * Mount the FLEET shell once. Re-rendering would wipe imperative panel content
 * written into the mount ids by mission-control.js.
 */
export function renderFleetPanel(container) {
  if (!container) return;
  if (fleetPanelRoots.has(container)) return;

  const root = createRoot(container);
  fleetPanelRoots.set(container, root);
  flushSync(() => {
    root.render(<FleetPanel />);
  });
}

export default FleetPanel;
