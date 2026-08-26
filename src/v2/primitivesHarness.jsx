/**
 * src/v2/primitivesHarness.jsx
 *
 * Purpose: browser-test mount point for Track E primitives — not loaded by the
 * production bundle; served via public/v2/primitives-harness.html.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { styled } from '@mui/material/styles';
import {
  Panel,
  DataTable,
  Measured,
  Estimated,
  Value,
  TruncationNote,
} from './components/index.js';
import { McBudget } from './panels/McBudget.jsx';
import { StrategicCommentary } from './panels/StrategicCommentary.jsx';
import { FleetEngagement } from './panels/FleetEngagement.jsx';
import { IntelligenceLibrary } from './panels/IntelligenceLibrary.jsx';
import { AlienHateEconomics, renderHudAlienHateEconomics } from './panels/AlienHateEconomics.jsx';
import { MiningExpansion } from './panels/MiningExpansion.jsx';
import { CouncilOrders } from './panels/CouncilOrders.jsx';
import { FactionLedgerBoard } from './panels/ExecutiveBoards.jsx';
import {
  renderFactionLedger,
  renderLogisticsBoard,
  renderCapabilityMatrix,
  renderTheaterBoard,
  renderOperationsBoard,
  renderNationQueue,
  renderResearchWatchlist,
} from './main.jsx';
import {
  renderMcBudget,
  renderStrategicCommentary,
  renderFleetEngagement,
  renderMiningExpansion,
  renderCouncilOrders,
  renderAlienHateEconomics,
  renderIntelligenceLibrary,
  fetchFleetEngagement,
  fetchMiningExpansion,
} from './main.jsx';

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
  window.IntelligenceLibrary = { render: renderIntelligenceLibrary };
  window.MissionControlCouncilOrders = { render: renderCouncilOrders };
  window.MissionControlBoards = {
    renderFactionLedger,
    renderLogisticsBoard,
    renderCapabilityMatrix,
    renderTheaterBoard,
    renderOperationsBoard,
    renderNationQueue,
    renderResearchWatchlist,
  };
}

const SCENES = {
  panel: PanelScene,
  panelModifiers: PanelModifiersScene,
  dataTableOverflow: DataTableOverflowScene,
  dataTableFits: DataTableFitsScene,
  dataTableVariants: DataTableVariantsScene,
  registers: RegistersScene,
  value: ValueScene,
  truncation: TruncationScene,
  cascade: CascadeScene,
  mcBudget: McBudgetScene,
  strategicCommentary: StrategicCommentaryScene,
  fleetEngagement: FleetEngagementScene,
  miningExpansion: MiningExpansionScene,
  councilOrders: CouncilOrdersScene,
  intelligenceLibrary: IntelligenceLibraryScene,
  alienHateEconomics: AlienHateEconomicsScene,
  executiveBoards: ExecutiveBoardsScene,
};

const PANEL_MODIFIERS = ['priority', 'alert', 'featured', 'quiet', 'dense', 'commentary'];

function PanelScene() {
  return (
    <Panel title="Probe panel" modifier="priority" data-testid="harness-panel">
      <p>Panel body</p>
    </Panel>
  );
}

function PanelModifiersScene() {
  return (
    <div data-testid="harness-panel-modifiers">
      {PANEL_MODIFIERS.map((mod) => (
        <Panel key={mod} title={`${mod} panel`} modifier={mod} data-testid={`harness-panel-${mod}`}>
          <p>{mod} body</p>
        </Panel>
      ))}
    </div>
  );
}

function DataTableOverflowScene() {
  const columns = [
    { key: 'a', label: 'Alpha' },
    { key: 'b', label: 'Beta' },
    { key: 'c', label: 'Gamma' },
    { key: 'd', label: 'Delta' },
    { key: 'e', label: 'Epsilon' },
    { key: 'f', label: 'Zeta' },
  ];
  const rows = [
  { key: '1', a: '111', b: '222', c: '333', d: '444', e: '555', f: '666' },
  ];
  return (
    <div style={{ width: 200 }} data-testid="harness-table-overflow">
      <DataTable variant="de" columns={columns} rows={rows} />
    </div>
  );
}

function DataTableFitsScene() {
  const columns = [{ key: 'a', label: 'Only' }];
  const rows = [{ key: '1', a: 'fits' }];
  return (
    <div style={{ width: 400 }} data-testid="harness-table-fits">
      <DataTable variant="de" columns={columns} rows={rows} />
    </div>
  );
}

function DataTableVariantsScene() {
  const columns = [{ key: 'a', label: 'Alpha' }, { key: 'b', label: 'Beta' }];
  const rows = [{ key: '1', a: 'A', b: 'B' }];
  const variants = ['de', 'mc-board', 'fe', 'mining', 'intel-library', 'commentary-sim'];
  return (
    <div data-testid="harness-datatable-variants">
      {variants.map((v) => (
        <DataTable key={v} variant={v} columns={columns} rows={rows} />
      ))}
    </div>
  );
}

function RegistersScene() {
  return (
    <div data-testid="harness-registers">
      <Measured register="de" value="12.4" data-testid="meas-de" />
      <Estimated register="de" value="~18" data-testid="est-de" />
      <Measured register="fe" value="4.2" data-testid="meas-fe" />
      <Estimated register="fe" value="~6" data-testid="est-fe" />
      <Measured register="mining" value="1.8" data-testid="meas-mining" />
      <Estimated register="mining" value="~2.1" data-testid="est-mining" />
    </div>
  );
}

function ValueScene() {
  return (
    <div data-testid="harness-value">
      <Value present={true} value={0} data-testid="value-zero" />
      <Value present={false} value={0} data-testid="value-absent" />
      <Value present={true} value={null} data-testid="value-unavailable" />
    </div>
  );
}

function TruncationScene() {
  return (
    <div data-testid="harness-truncation">
      <TruncationNote totalCount={25} omittedCount={5} data-testid="trunc-known" />
      <TruncationNote totalCount={25} data-testid="trunc-unknown" />
      <TruncationNote totalCount={10} omittedCount={0} data-testid="trunc-complete" />
      <TruncationNote omittedCount={0} data-testid="trunc-complete-no-total" />
    </div>
  );
}

/** Cascade probes. Each Emotion rule compiles to .css-*.cascade-order-* at (0,2,0). */
const CascadeEmotionProbe = styled('span')({
  '&.cascade-order-probe': {
    color: 'rgb(40, 50, 60)',
  },
  '&.cascade-order-important': {
    color: 'rgb(60, 70, 80)',
  },
  '&.cascade-order-late': {
    color: 'rgb(70, 80, 90)',
  },
});

function CascadeScene() {
  React.useLayoutEffect(() => {
    // A global rule duplicated in a stylesheet injected AFTER Emotion's runtime
    // <style> tags. At matching (0,2,0) specificity the later source wins.
    const late = document.createElement('style');
    late.setAttribute('data-cascade-late', 'true');
    late.textContent = '.cascade-order-late.cascade-order-late { color: rgb(21, 22, 23); }';
    document.head.appendChild(late);
    document.documentElement.setAttribute('data-cascade-late-applied', '1');
  }, []);

  return (
    <div data-testid="harness-cascade">
      <span className="cascade-order-probe" data-testid="cascade-global">global</span>
      <CascadeEmotionProbe className="cascade-order-probe" data-testid="cascade-emotion">
        emotion
      </CascadeEmotionProbe>

      <span className="cascade-order-important" data-testid="cascade-important-global">
        important global
      </span>
      <CascadeEmotionProbe className="cascade-order-important" data-testid="cascade-important-emotion">
        important emotion
      </CascadeEmotionProbe>

      <span className="cascade-order-late" data-testid="cascade-late-global">late global</span>
      <CascadeEmotionProbe className="cascade-order-late" data-testid="cascade-late-emotion">
        late emotion
      </CascadeEmotionProbe>
    </div>
  );
}

function McBudgetScene() {
  const payload = window.__MC_BUDGET_PAYLOAD__;
  return (
    <div id="mc-budget-harness-mount" data-testid="mc-budget-harness">
      <McBudget payload={payload} />
    </div>
  );
}

function StrategicCommentaryScene() {
  const payload = window.__STRATEGIC_COMMENTARY_PAYLOAD__;
  return (
    <div data-testid="strategic-commentary-harness">
      <span id="commentaryModeBadge" className="commentary-mode-tag">CAMPAIGN READ</span>
      <div id="strategicCommentary" aria-live="polite">
        <StrategicCommentary data={payload} />
      </div>
    </div>
  );
}

function FleetEngagementScene() {
  const payload = window.__FLEET_ENGAGEMENT_PAYLOAD__;
  return (
    <div id="fleetEngagement" data-testid="fleet-engagement-harness" aria-live="polite">
      <FleetEngagement data={payload} />
    </div>
  );
}

function MiningExpansionScene() {
  const payload = window.__MINING_EXPANSION_PAYLOAD__;
  return (
    <div id="miningExpansion" data-testid="mining-expansion-harness" aria-live="polite">
      <MiningExpansion data={payload} />
    </div>
  );
}

function CouncilOrdersScene() {
  const payload = window.__COUNCIL_ORDERS_PAYLOAD__;
  // The Council Orders panel cross-navigates into #directiveBoard, which lives
  // in the (still-vanilla) Directive Engine card. The harness mirrors that DOM
  // here so the click handler has a target to resolve.
  const assignments = payload?.engineDirectives?.cyclePlan?.assignments ?? [];
  return (
    <div data-testid="council-orders-harness">
      <div id="council-orders-scene-root">
        <CouncilOrders payload={payload} />
      </div>
      <div id="council-orders-test-root" />
      <div id="directiveBoard" className="tech-card">
        {assignments.map((entry, index) => (
          <div
            key={index}
            className="directive-assignment-card"
            data-assignment-index={index}
          >
            {entry.councilor?.name || 'Councilor'}
          </div>
        ))}
      </div>
    </div>
  );
}

function IntelligenceLibraryScene() {
  const payload = window.__INTELLIGENCE_LIBRARY_PAYLOAD__ || {};
  const options = { ...(payload.options || {}) };
  if (typeof window.__testOnOpenFaction === 'function') {
    options.onOpenFaction = window.__testOnOpenFaction;
  }
  return (
    <div data-testid="intelligence-library-harness">
      <IntelligenceLibrary
        snapshot={payload.snapshot}
        briefing={payload.briefing}
        observerId={payload.observerId ?? 4712}
        options={options}
      />
    </div>
  );
}

function AlienHateEconomicsScene() {
  const payload = window.__ALIEN_HATE_ECONOMICS_PAYLOAD__;
  return (
    <div id="alienHateEconomics" data-testid="alien-hate-economics-harness">
      <AlienHateEconomics economics={payload} />
    </div>
  );
}

function ExecutiveBoardsScene() {
  const payload = window.__EXECUTIVE_BOARDS_PAYLOAD__;
  return (
    <div data-testid="executive-boards-harness">
      <FactionLedgerBoard snapshot={payload} />
      <div id="executive-board-test-root" />
    </div>
  );
}

function HarnessApp({ scene }) {
  const Scene = SCENES[scene];
  if (!Scene) {
    return <div data-testid="harness-missing">missing scene: {scene}</div>;
  }
  return <Scene />;
}

const params = new URLSearchParams(window.location.search);
const scene = params.get('scene') || 'panel';
const rootEl = document.getElementById('primitives-harness-root');
if (rootEl) {
  createRoot(rootEl).render(<HarnessApp scene={scene} />);
}

export { HarnessApp, SCENES };
