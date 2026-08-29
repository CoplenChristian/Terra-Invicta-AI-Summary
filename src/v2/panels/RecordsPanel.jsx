/**
 * src/v2/panels/RecordsPanel.jsx
 *
 * Purpose: RECORDS view shell — two-column MUI grid with static mount points for
 *   the four registered panels plus the API access block. Mount once; imperative
 *   panel renders fill the ids.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ThemeProvider } from '@mui/material/styles';
import { Panel } from '../components/Panel.jsx';
import { TwoColumnGrid, TwoColumnGridItem } from '../components/TwoColumnGrid.jsx';
import initiativeTheme from '../theme.js';

export function RecordsPanel() {
  return (
    <ThemeProvider theme={initiativeTheme}>
      <TwoColumnGrid data-view="records">
        <TwoColumnGridItem>
          <Panel
            title="STRATEGIC FACTION LEDGER"
            headerAside="CURRENT STATE"
            modifier="quiet"
          >
            <div id="factionDonutContainer" />
          </Panel>
        </TwoColumnGridItem>

        <TwoColumnGridItem>
          <Panel
            title="TECHNOLOGY WATCH"
            headerAside="RESEARCH + INTELLIGENCE GAPS"
            modifier="quiet"
          >
            <div id="researchWatchlist" className="research-watchlist" aria-live="polite">
              <p className="since-save-empty">Loading research and capability signals…</p>
            </div>
          </Panel>
        </TwoColumnGridItem>

        <TwoColumnGridItem span>
          <Panel
            title="UNLOCKED TECHNOLOGY"
            headerAside="WHAT THIS FACTION HAS RESEARCHED"
            modifier="quiet"
            span
          >
            <div id="unlockedTech" className="unlocked-tech" aria-live="polite">
              <p className="ut-notice">Loading the research graph…</p>
            </div>
          </Panel>
        </TwoColumnGridItem>

        <TwoColumnGridItem span>
          <Panel
            title="SINCE LAST SAVE"
            headerAside="MATERIAL STRATEGIC DELTA"
            modifier="quiet"
            span
          >
            <div
              id="sinceLastSave"
              className="since-save-grid since-save-grid--compact"
              aria-live="polite"
            >
              <p className="since-save-empty">
                Comparing the current snapshot with the immediately previous save…
              </p>
            </div>
          </Panel>
        </TwoColumnGridItem>

        <TwoColumnGridItem span>
          <section className="init-api-access init-view__span" aria-labelledby="initApiAccessTitle">
            <div className="init-api-access__header">
              <div>
                <div className="init-api-access__eyebrow">EXTERNAL ANALYSIS</div>
                <h2 id="initApiAccessTitle">API / AI ACCESS</h2>
              </div>
              <a href="/api/intel" className="init-api-access__directory">
                Open full API directory
              </a>
            </div>
            <div className="init-api-access__links">
              <a href="/api/intel/ship-designs?observer=4712&amp;mode=omniscient&amp;faction=4712">
                Ship designs
              </a>
              <a href="/api/intel/logistics?observer=4712&amp;mode=omniscient">Logistics</a>
              <a href="/api/intel/construction?observer=4712&amp;mode=omniscient">Construction</a>
              <a href="/api/intel/transfers?observer=4712&amp;mode=omniscient">Transfers</a>
              <a href="/api/intel/theaters?observer=4712&amp;mode=omniscient">Theaters</a>
              <a href="/api/intel/tech-tree?observer=4712&amp;mode=omniscient&amp;category=all">
                Tech tree
              </a>
            </div>
          </section>
        </TwoColumnGridItem>
      </TwoColumnGrid>
    </ThemeProvider>
  );
}

const recordsPanelRoots = typeof WeakMap !== 'undefined' ? new WeakMap() : new Map();

/**
 * Mount the RECORDS shell once. Re-rendering would wipe imperative panel content
 * written into the mount ids by mission-control.js.
 */
export function renderRecordsPanel(container) {
  if (!container) return;
  if (recordsPanelRoots.has(container)) return;

  const root = createRoot(container);
  recordsPanelRoots.set(container, root);
  flushSync(() => {
    root.render(<RecordsPanel />);
  });
}

export default RecordsPanel;
