/**
 * src/v2/panels/CommandPanel.jsx
 *
 * Purpose: COMMAND view shell — two-column MUI grid with static mount points for
 *   the nine registered panels plus the executive KPI band and theater map.
 *   Mount once; imperative panel renders fill the ids.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import Box from '@mui/material/Box';
import { ThemeProvider } from '@mui/material/styles';
import { Panel } from '../components/Panel.jsx';
import { TwoColumnGrid, TwoColumnGridItem } from '../components/TwoColumnGrid.jsx';
import initiativeTheme from '../theme.js';

function CommandStackItem({ order, children }) {
  return (
    <Box sx={{ width: '100%', order: { xs: order, md: 0 } }}>
      {children}
    </Box>
  );
}

export function CommandPanel() {
  return (
    <ThemeProvider theme={initiativeTheme}>
      <div className="init-command-layout">
        <div className="init-kpi-banner">
          <div className="init-kpi-item">
            <div className="init-kpi-label">TREASURY</div>
            <div id="kpiMoney" className="init-kpi-val">$0</div>
            <div id="kpiMoneySub" className="init-kpi-sub">+0/mo Flow</div>
          </div>
          <div className="init-kpi-item">
            <div className="init-kpi-label">TERRESTRIAL GDP</div>
            <div id="kpiGdp" className="init-kpi-val">$0T</div>
            <div id="kpiGdpSub" className="init-kpi-sub">0 Control Points</div>
          </div>
          <div className="init-kpi-item">
            <div className="init-kpi-label">RESEARCH OUTPUT</div>
            <div id="kpiResearch" className="init-kpi-val">0 pts</div>
            <div id="kpiResearchSub" className="init-kpi-sub">R&amp;D Leadership</div>
          </div>
          <div className="init-kpi-item">
            <div className="init-kpi-label">STRATEGIC SCORE (EST.)</div>
            <div id="kpiPower" className="init-kpi-val">0/100</div>
            <div id="kpiPowerSub" className="init-kpi-sub">Global Rank #1</div>
          </div>
        </div>

        <TwoColumnGrid
          data-view="command"
          spacing={1.25}
          sx={{
            padding: 0,
            maxWidth: '100%',
          }}
        >
          <TwoColumnGridItem sx={{ display: { xs: 'contents', md: 'block' } }}>
            <Box className="init-command-col" sx={{ display: { xs: 'contents', md: 'flex' } }}>
              <CommandStackItem order={1}>
                <Panel title="THEATERS" headerAside="6 REGIONS" modifier="featured">
                <div className="init-map-container">
                  <div className="world-map-fallback" role="status">REAL WORLD MAP INITIALIZING…</div>
                </div>
                <div id="mapSectorsList" className="init-sector-list" />
                </Panel>
              </CommandStackItem>

              <CommandStackItem order={2}>
                <Panel title="COUNCIL ORDERS" headerAside="EVERY COUNCILOR, THIS CYCLE" modifier="priority">
                <div id="councilOrders" aria-live="polite">
                  <div className="council-orders__empty">LOADING COUNCIL ORDERS…</div>
                </div>
                </Panel>
              </CommandStackItem>

              <CommandStackItem order={3}>
                <Panel title="THREAT PICTURE" headerAside="TOP SIGNALS" modifier="alert">
                  <div id="threatBoard" className="threat-board" aria-live="polite" />
                </Panel>
              </CommandStackItem>

              <CommandStackItem order={4}>
                <Panel title="RESEARCH ADVISOR" headerAside="VALUE PER RESEARCH POINT" modifiers={['priority', 'dense']}>
                <div id="researchAdvisor" aria-live="polite">
                  <p className="research-advisor__empty">LOADING RESEARCH RANKING…</p>
                </div>
                </Panel>
              </CommandStackItem>

              <CommandStackItem order={8}>
                <Panel title="DIRECTIVE ENGINE" headerAside="RECOMMENDED ACTION &amp; DECISION REASONING">
                <div id="directiveBoard" aria-live="polite">
                  <div className="alien-hate-econ-empty">LOADING DIRECTIVE ENGINE…</div>
                </div>
                </Panel>
              </CommandStackItem>
            </Box>
          </TwoColumnGridItem>

          <TwoColumnGridItem sx={{ display: { xs: 'contents', md: 'block' } }}>
            <Box className="init-command-col" sx={{ display: { xs: 'contents', md: 'flex' } }}>
              <CommandStackItem order={5}>
                <Panel title="PRIORITY BRIEF" headerAside="ONE ACTION FIRST" modifier="priority">
                <div id="priorityBriefCard" className="init-hologram-stage">
                  <div className="holo-core-content">
                    <div className="holo-core-badge" />
                    <div id="holoPrimaryTitle" className="holo-core-title">Awaiting priority brief</div>
                    <div id="holoPrimaryStatement" className="holo-core-statement">
                      Maintain network surveillance until a higher-priority order is available.
                    </div>
                    <p id="priorityPolicyNote" className="priority-policy-note" hidden />
                  </div>
                  <dl id="priorityOpsMeta" className="priority-ops-meta">
                    <div><dt>Mission</dt><dd id="priorityMissionType">UNAVAILABLE</dd></div>
                    <div><dt>Window</dt><dd id="priorityWindow">This cycle</dd></div>
                    <div><dt>Success</dt><dd id="prioritySuccess">UNAVAILABLE</dd></div>
                    <div><dt>Mission cost</dt><dd id="priorityMissionCost">UNAVAILABLE</dd></div>
                  </dl>
                  <p id="priorityExpectedHate" className="priority-hate-band" hidden />
                  <div id="priorityOperatives" className="priority-ops-roster" />
                  <div className="priority-ops-actions">
                    <button id="openPriorityDetailsBtn" className="init-btn init-btn-cyan" type="button">Open details</button>
                    <button id="openCouncilorRosterBtn" className="init-btn" type="button">Open councilor roster</button>
                  </div>
                  <div className="holo-node-grid">
                    <div className="holo-node">
                      <div className="holo-node-label">GDP under command</div>
                      <div id="node1Val" className="holo-node-status">$39.4T GDP</div>
                    </div>
                    <div className="holo-node">
                      <div className="holo-node-label">Councilors</div>
                      <div id="node2Val" className="holo-node-status">5 Active</div>
                    </div>
                    <div className="holo-node">
                      <div className="holo-node-label">Orbital sites</div>
                      <div id="node3Val" className="holo-node-status">18 Habs</div>
                    </div>
                    <div className="holo-node">
                      <div className="holo-node-label">Research position</div>
                      <div id="node4Val" className="holo-node-status">Leading</div>
                    </div>
                    <div className="holo-node">
                      <div className="holo-node-label">Xenoforming sites</div>
                      <div id="node5Val" className="holo-node-status">DEFCON 2</div>
                    </div>
                  </div>
                </div>
                </Panel>
              </CommandStackItem>

              <CommandStackItem order={6}>
                <Panel
                  title="STRATEGIC COMMENTARY"
                  modifier="commentary"
                  headerAside={(
                    <span id="commentaryModeBadge" className="commentary-mode-tag">CAMPAIGN READ</span>
                  )}
                >
                <div id="strategicCommentary" aria-live="polite">
                  <div className="commentary-empty">ANALYZING STRATEGIC COMMENTARY…</div>
                </div>
                </Panel>
              </CommandStackItem>

              <CommandStackItem order={7}>
                <Panel title="OPERATIONS BOARD" headerAside="ACTIVE COUNCILORS">
                  <div id="opLeaderboardList" className="operative-leaderboard" />
                </Panel>
              </CommandStackItem>

              <CommandStackItem order={9}>
                <Panel
                  title="EXECUTIVE BRIEF &amp; DIRECTIVES"
                  modifier="quiet"
                  headerAside={(
                    <button id="btnCopySitrep" className="init-btn" type="button">Copy SITREP</button>
                  )}
                >
                <div id="sitrepSummary" className="sitrep-summary" aria-live="polite">
                  <p>Generating the current executive situation report...</p>
                </div>
                <div id="directivesStreamList" />
                </Panel>
              </CommandStackItem>
            </Box>
          </TwoColumnGridItem>
        </TwoColumnGrid>
      </div>
    </ThemeProvider>
  );
}

const commandPanelRoots = typeof WeakMap !== 'undefined' ? new WeakMap() : new Map();

/**
 * Mount the COMMAND shell once. Re-rendering would wipe imperative panel content
 * written into the mount ids by mission-control.js.
 */
export function renderCommandPanel(container) {
  if (!container) return;
  if (commandPanelRoots.has(container)) return;

  const root = createRoot(container);
  commandPanelRoots.set(container, root);
  flushSync(() => {
    root.render(<CommandPanel />);
  });
}

export default CommandPanel;
