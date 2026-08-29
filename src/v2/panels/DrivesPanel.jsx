/**
 * src/v2/panels/DrivesPanel.jsx
 *
 * Purpose: DRIVES view shell — two-column MUI grid with static mount point for
 *   the lazy-loaded drive explorer panel. Mount once; imperative panel renders
 *   fill the id.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ThemeProvider } from '@mui/material/styles';
import { TwoColumnGrid, TwoColumnGridItem } from '../components/TwoColumnGrid.jsx';
import initiativeTheme from '../theme.js';

export function DrivesPanel() {
  return (
    <ThemeProvider theme={initiativeTheme}>
      <TwoColumnGrid data-view="drives">
        <TwoColumnGridItem span>
          <div id="driveExplorer" aria-live="polite" />
        </TwoColumnGridItem>
      </TwoColumnGrid>
    </ThemeProvider>
  );
}

const drivesPanelRoots = typeof WeakMap !== 'undefined' ? new WeakMap() : new Map();

/**
 * Mount the DRIVES shell once. Re-rendering would wipe imperative panel content
 * written into the mount id by mission-control.js.
 */
export function renderDrivesPanel(container) {
  if (!container) return;
  if (drivesPanelRoots.has(container)) return;

  const root = createRoot(container);
  drivesPanelRoots.set(container, root);
  flushSync(() => {
    root.render(<DrivesPanel />);
  });
}

export default DrivesPanel;
