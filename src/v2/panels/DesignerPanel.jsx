/**
 * src/v2/panels/DesignerPanel.jsx
 *
 * Purpose: DESIGNER view shell — two-column MUI grid with static mount points for
 *   component selection, performance readout, mass/heat breakdown and resource
 *   cost. Mount once; imperative panel renders fill the ids.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ThemeProvider } from '@mui/material/styles';
import { Panel } from '../components/Panel.jsx';
import { TwoColumnGrid, TwoColumnGridItem } from '../components/TwoColumnGrid.jsx';
import initiativeTheme from '../theme.js';

export function DesignerPanel() {
  return (
    <ThemeProvider theme={initiativeTheme}>
      <TwoColumnGrid data-view="designer">
        <TwoColumnGridItem>
          <Panel
            title="COMPONENT SELECTION"
            headerAside="HULL, DRIVE, REACTOR & FITTINGS"
            modifier="quiet"
          >
            <div id="designerComponents" aria-live="polite">
              <div className="alien-hate-econ-empty">Loading component catalogue…</div>
            </div>
          </Panel>
        </TwoColumnGridItem>

        <TwoColumnGridItem>
          <Panel
            title="PERFORMANCE"
            headerAside="CRUISE ACCEL · COMBAT ACCEL · DELTA-V"
            modifier="quiet"
          >
            <div id="designerPerformance" aria-live="polite">
              <div className="alien-hate-econ-empty">Loading performance readout…</div>
            </div>
          </Panel>
        </TwoColumnGridItem>

        <TwoColumnGridItem span>
          <Panel
            title="MASS & HEAT"
            headerAside="MASS BUDGET · POWER · WASTE HEAT · RADIATORS"
            modifier="quiet"
            span
          >
            <div id="designerMassHeat" aria-live="polite">
              <div className="alien-hate-econ-empty">Loading mass and heat breakdown…</div>
            </div>
          </Panel>
        </TwoColumnGridItem>

        <TwoColumnGridItem span>
          <Panel
            title="RESOURCE COST"
            headerAside="SEVEN-MATERIAL BILL · STOCKPILE · BUILD TIME"
            modifier="quiet"
            span
          >
            <div id="designerCost" aria-live="polite">
              <div className="alien-hate-econ-empty">Loading resource cost…</div>
            </div>
          </Panel>
        </TwoColumnGridItem>
      </TwoColumnGrid>
    </ThemeProvider>
  );
}

const designerPanelRoots = typeof WeakMap !== 'undefined' ? new WeakMap() : new Map();

/**
 * Mount the DESIGNER shell once. Re-rendering would wipe imperative panel content
 * written into the mount ids by mission-control.js.
 */
export function renderDesignerPanel(container) {
  if (!container) return;
  if (designerPanelRoots.has(container)) return;

  const root = createRoot(container);
  designerPanelRoots.set(container, root);
  flushSync(() => {
    root.render(<DesignerPanel />);
  });
}

export default DesignerPanel;
