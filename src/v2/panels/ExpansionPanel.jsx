/**
 * src/v2/panels/ExpansionPanel.jsx
 *
 * Purpose: EXPANSION view shell — two-column MUI grid with static mount points for
 *   the four registered panels. Mount once; imperative panel renders fill the ids.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ThemeProvider } from '@mui/material/styles';
import { Panel } from '../components/Panel.jsx';
import { TwoColumnGrid, TwoColumnGridItem } from '../components/TwoColumnGrid.jsx';
import initiativeTheme from '../theme.js';

export function ExpansionPanel() {
  return (
    <ThemeProvider theme={initiativeTheme}>
      <TwoColumnGrid data-view="expansion">
        <TwoColumnGridItem span>
          <Panel
            title="MINING EXPANSION BOARD"
            headerAside="CAPACITY, RUNWAYS & SITE VALUE PER UNIT OF HATE"
          >
            <div id="miningExpansion" aria-live="polite">
              <div className="alien-hate-econ-empty">LOADING MINING EXPANSION…</div>
            </div>
          </Panel>
        </TwoColumnGridItem>

        <TwoColumnGridItem>
          <Panel title="MC BUDGET PLANNER" headerAside="FLEET COST VS HATE FLOOR">
            <div id="mcBudget" aria-live="polite">
              <div className="alien-hate-econ-empty">LOADING MC BUDGET…</div>
            </div>
          </Panel>
        </TwoColumnGridItem>

        <TwoColumnGridItem>
          <Panel title="WARTIME LOGISTICS" headerAside="STOCKPILE + OUTPUT" modifier="quiet">
            <div id="resourceFlowChart" className="chart-container-box" />
          </Panel>
        </TwoColumnGridItem>

        <TwoColumnGridItem span>
          <Panel
            title="NATION ACTION QUEUE"
            headerAside="EARTH HOLDINGS"
            modifier="quiet"
            bodyStyle={{ padding: 0 }}
          >
            <div id="holdingsBubbleMatrix" className="bubble-matrix-container" />
          </Panel>
        </TwoColumnGridItem>
      </TwoColumnGrid>
    </ThemeProvider>
  );
}

const expansionPanelRoots = typeof WeakMap !== 'undefined' ? new WeakMap() : new Map();

/**
 * Mount the EXPANSION shell once. Re-rendering would wipe imperative panel content
 * written into the mount ids by mission-control.js.
 */
export function renderExpansionPanel(container) {
  if (!container) return;
  if (expansionPanelRoots.has(container)) return;

  const root = createRoot(container);
  expansionPanelRoots.set(container, root);
  flushSync(() => {
    root.render(<ExpansionPanel />);
  });
}

export default ExpansionPanel;
