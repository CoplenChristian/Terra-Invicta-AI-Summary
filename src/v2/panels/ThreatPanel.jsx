/**
 * src/v2/panels/ThreatPanel.jsx
 *
 * Purpose: THREAT view shell — two-column MUI grid with static mount points for
 *   the six registered panels. Mount once; imperative panel renders fill the ids.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ThemeProvider } from '@mui/material/styles';
import { Panel } from '../components/Panel.jsx';
import { TwoColumnGrid, TwoColumnGridItem } from '../components/TwoColumnGrid.jsx';
import initiativeTheme from '../theme.js';

export function ThreatPanel() {
  return (
    <ThemeProvider theme={initiativeTheme}>
      <TwoColumnGrid data-view="threat">
        <TwoColumnGridItem span>
          <Panel title="ALIEN HATE ECONOMICS" headerAside="MC THREAT FLOOR" modifier="quiet">
            <div id="alienHateEconomics" aria-live="polite">
              <div className="alien-hate-econ-empty">LOADING HATE ECONOMICS…</div>
            </div>
          </Panel>
        </TwoColumnGridItem>

        <TwoColumnGridItem>
          <Panel title="ALIEN FORCE POSTURE" headerAside="LOCATION + FRAGMENTATION" modifier="quiet">
            <div id="dualAssetRings" />
          </Panel>
        </TwoColumnGridItem>

        <TwoColumnGridItem>
          <Panel title="CAPABILITY MATRIX" headerAside="DISCRETE SIGNALS" modifier="quiet">
            <div
              id="powerTrajectoryChart"
              className="chart-container-box power-profile-container"
            />
          </Panel>
        </TwoColumnGridItem>

        <TwoColumnGridItem span>
          <Panel
            title="PER-FLEET ENGAGEMENT ESTIMATES"
            headerAside="MODELLED / REACHABILITY-GATED"
            modifier="quiet"
          >
            <div id="fleetEngagement" aria-live="polite">
              <div className="fe-empty">LOADING ENGAGEMENT ESTIMATES…</div>
            </div>
          </Panel>
        </TwoColumnGridItem>

        <TwoColumnGridItem span>
          <Panel
            title="HOSTILE MOVEMENT BEYOND THE TWELVE THEATERS"
            headerAside="WHOLE-BOARD POSTURE"
            modifier="quiet"
          >
            <div id="hostileMovement" aria-live="polite">
              <div className="hm-empty">LOADING HOSTILE MOVEMENT…</div>
            </div>
          </Panel>
        </TwoColumnGridItem>

        <TwoColumnGridItem span>
          <Panel title="THEATER DEFENCE" headerAside="BUILD / REINFORCE / WITHDRAW" modifier="quiet">
            <div id="theaterDefence" aria-live="polite">
              <div className="td-empty">LOADING THEATER DEFENCE…</div>
            </div>
          </Panel>
        </TwoColumnGridItem>
      </TwoColumnGrid>
    </ThemeProvider>
  );
}

const threatPanelRoots = typeof WeakMap !== 'undefined' ? new WeakMap() : new Map();

/**
 * Mount the THREAT shell once. Re-rendering would wipe imperative panel content
 * written into the mount ids by mission-control.js.
 */
export function renderThreatPanel(container) {
  if (!container) return;
  if (threatPanelRoots.has(container)) return;

  const root = createRoot(container);
  threatPanelRoots.set(container, root);
  flushSync(() => {
    root.render(<ThreatPanel />);
  });
}

export default ThreatPanel;
