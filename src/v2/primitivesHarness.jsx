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
import {
  HostileMovementPanel,
  fetchHostileMovement,
  renderHostileMovement,
} from './panels/HostileMovementPanel.jsx';
import { MiningExpansion } from './panels/MiningExpansion.jsx';
import { CouncilOrders } from './panels/CouncilOrders.jsx';
import { DirectiveBoard } from './panels/DirectiveBoard.jsx';
import { ResearchAdvisor } from './panels/ResearchAdvisor.jsx';
import {
  fetchResearchRanking,
  openFullRanking as openResearchFullRanking,
  slotFacts as researchSlotFacts,
} from './panels/researchAdvisorUtils.mjs';
import { FleetProcurement } from './panels/FleetProcurement.jsx';
import {
  fetchProcurement as fetchFleetProcurement,
  openProcurementDetails,
  openRefitDetails,
} from './panels/fleetProcurementUtils.mjs';
import { UnlockedTech } from './panels/UnlockedTech.jsx';
import { WorldMap } from './panels/WorldMap.jsx';
import { FactionLedgerBoard } from './panels/ExecutiveBoards.jsx';
import { FactionIntel, createFactionIntelController } from './panels/FactionIntel.jsx';
import {
  DriveExplorer,
  driveExplorerInternals,
  fetchDriveExplorer,
  loadDriveExplorer,
  openDrivePath,
  renderDriveExplorer,
} from './panels/DriveExplorer.jsx';
import {
  close as closeDetailPanel,
  detailPanelInternals,
  open as openDetailPanel,
  syncPageInert as syncDetailPanelPageInert,
} from './panels/DetailPanel.jsx';
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
  renderDirectiveBoard,
  renderResearchAdvisor,
  renderFleetProcurement,
  renderRefitDesignCard,
  loadUnlockedTech,
  renderAlienHateEconomics,
  renderIntelligenceLibrary,
  renderFactionIntel,
  renderWorldMap,
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
  window.MissionControlHostileMovement = {
    render: renderHostileMovement,
    fetch: fetchHostileMovement,
  };
  window.IntelligenceLibrary = { render: renderIntelligenceLibrary };
  window.FactionIntelScreen = { render: renderFactionIntel };
  window.MissionControlCouncilOrders = { render: renderCouncilOrders };
  window.MissionControlDirectiveBoard = { render: renderDirectiveBoard };
  window.MissionControlResearchAdvisor = {
    render: renderResearchAdvisor,
    fetchResearchRanking,
    openFullRanking: openResearchFullRanking,
    slotFacts: researchSlotFacts,
  };
  window.MissionControlFleetProcurement = {
    render: renderFleetProcurement,
    fetchProcurement: fetchFleetProcurement,
    renderRefitDesignCard,
    openProcurementDetails,
    openRefitDetails,
  };
  window.MissionControlUnlockedTech = { load: loadUnlockedTech };
  window.WorldTheaterMap = { render: renderWorldMap };
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
  // main.jsx installs this too; restated here so the harness publishes the same
  // surface, and so a fixture that swaps the global out and back (see
  // tests/fixtures/driveExplorerBrowser.js) restores the real panel, not undefined.
  window.MissionControlDetailPanel = {
    open: openDetailPanel,
    close: closeDetailPanel,
    syncPageInert: syncDetailPanelPageInert,
    _internals: detailPanelInternals,
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
  valueSvg: ValueSvgScene,
  truncation: TruncationScene,
  cascade: CascadeScene,
  mcBudget: McBudgetScene,
  strategicCommentary: StrategicCommentaryScene,
  fleetEngagement: FleetEngagementScene,
  miningExpansion: MiningExpansionScene,
  councilOrders: CouncilOrdersScene,
  directiveBoard: DirectiveBoardScene,
  researchAdvisor: ResearchAdvisorScene,
  fleetProcurement: FleetProcurementScene,
  unlockedTech: UnlockedTechScene,
  intelligenceLibrary: IntelligenceLibraryScene,
  alienHateEconomics: AlienHateEconomicsScene,
  hostileMovement: HostileMovementScene,
  executiveBoards: ExecutiveBoardsScene,
  factionIntel: FactionIntelScene,
  driveExplorer: DriveExplorerScene,
  worldMap: WorldMapScene,
  detailPanel: DetailPanelScene,
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
  const variants = ['de', 'mc-board', 'fe', 'mining', 'intel-library', 'hostile-movement', 'commentary-sim'];
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

/**
 * The `as` escape hatch, inside a real SVG (defect #19).
 *
 * TWO HOSTS WITH IDENTICAL CONTENT, differing only in `as`, because the failure
 * this guards against is INVISIBLE to text scraping: a `<span>` created in the
 * SVG namespace still contributes its characters to `innerHTML` and to
 * `textContent`, so `visibleText()` reports the figure a reader cannot see. The
 * only honest discriminator is geometry — the tspan host renders wider than the
 * span host because the span's glyphs are never painted.
 *
 * The third host proves the absent affordance survives the hop: `—` must be a
 * real painted glyph, not a dash the DOM merely holds.
 */
function ValueSvgScene() {
  return (
    <div data-testid="harness-value-svg">
      <svg viewBox="0 0 320 160" width="320" height="160" data-testid="value-svg-canvas">
        <text
          x={10}
          y={30}
          fontFamily="monospace"
          fontSize={16}
          data-testid="svg-host-tspan"
        >
          {'H '}
          <Value as="tspan" present value={0} data-testid="svg-value-tspan" />
        </text>
        <text
          x={10}
          y={70}
          fontFamily="monospace"
          fontSize={16}
          data-testid="svg-host-span"
        >
          {'H '}
          <Value present value={0} data-testid="svg-value-span" />
        </text>
        <text
          x={10}
          y={110}
          fontFamily="monospace"
          fontSize={16}
          data-testid="svg-host-absent"
        >
          {'H '}
          <Value as="tspan" present={false} value={0} data-testid="svg-value-absent" />
        </text>
      </svg>
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

function DirectiveBoardScene() {
  const payload = window.__DIRECTIVE_BOARD_PAYLOAD__;
  return (
    <div data-testid="directive-board-harness">
      {/* The production mount. public/v2/index.html owns <div id="directiveBoard">
          and CouncilOrders.jsx resolves assignment cards THROUGH that id, so the
          real panel is rendered inside it here rather than beside it — otherwise
          the cross-panel selector would be tested against a hand-written mirror
          instead of against what this component actually emits. */}
      <div id="directiveBoard" aria-live="polite">
        <DirectiveBoard payload={payload} />
      </div>
      {/* A second mount the bench suite re-renders into, so nineteen cycle plans
          cost one browser rather than nineteen. */}
      <div id="directive-board-test-root" />
    </div>
  );
}

function ResearchAdvisorScene() {
  const payload = window.__RESEARCH_ADVISOR_PAYLOAD__;
  return (
    <div data-testid="research-advisor-harness">
      {/* #researchAdvisor is the mount id public/v2/index.html owns and the
          VIEWS registry drives, so the production path is what renders here. */}
      <div id="researchAdvisor" aria-live="polite">
        <ResearchAdvisor payload={payload} />
      </div>
      {/* A second mount the ported suite re-renders into through the same
          window.MissionControlResearchAdvisor bridge mission-control.js calls.
          Thirty-one payloads then cost one browser rather than thirty-one. */}
      <div id="research-advisor-test-root" />
    </div>
  );
}

/**
 * The FLEET procurement + refit advisor panel.
 *
 * THREE MOUNTS, DELIBERATELY:
 *
 *   #fleetProcurement            — the PRODUCTION mount id public/v2/index.html
 *                                  owns and the VIEWS registry drives, so the
 *                                  production path is what renders here. Fed by
 *                                  `window.__FLEET_PROCUREMENT_PAYLOAD__`.
 *   #fleet-procurement-test-root — the bench the ported suite re-renders whole
 *                                  panels into through the bridge.
 *   #fleet-procurement-card-root — one refit card in isolation, standing in for
 *                                  the vanilla's `renderRefitDesignCard(design)`
 *                                  string return.
 *
 * Fifty-odd payloads then cost one browser rather than fifty.
 */
function FleetProcurementScene() {
  const payload = window.__FLEET_PROCUREMENT_PAYLOAD__;
  const refitPayload = window.__FLEET_PROCUREMENT_REFIT_PAYLOAD__ || null;
  return (
    <div data-testid="fleet-procurement-harness">
      <div id="fleetProcurement">
        <FleetProcurement payload={payload} refitPayload={refitPayload} />
      </div>
      <div id="fleet-procurement-test-root" />
      <div id="fleet-procurement-card-root" />
    </div>
  );
}

/**
 * The RECORDS unlocked-technology panel.
 *
 * It takes no payload: it reads /api/intel/tech-tree and /api/intel/tech-search
 * itself, so the scene supplies only the observer and the mode and the tests
 * stub the two endpoints with page.route. #unlockedTech is the id
 * public/v2/index.html owns and the VIEWS registry mounts into, so the real
 * panel is rendered INSIDE it here rather than beside it.
 */
function UnlockedTechScene() {
  const config = window.__UNLOCKED_TECH_CONFIG__ || {};
  return (
    <div data-testid="unlocked-tech-harness">
      <div id="unlockedTech" className="unlocked-tech" aria-live="polite">
        <UnlockedTech
          observerId={config.observerId ?? 4712}
          mode={config.mode ?? 'player'}
        />
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

/**
 * The whole-board hostile-movement panel. #hostileMovement is the id
 * public/v2/index.html owns and mission-control.js drives through
 * `window.MissionControlHostileMovement.render(...)` on the THREAT view, so the
 * real panel renders inside it here exactly as it does there. The payload is
 * the `hostileMovement` bucket the fetch hands the render call.
 */
function HostileMovementScene() {
  const payload = window.__HOSTILE_MOVEMENT_PAYLOAD__;
  return (
    <div id="hostileMovement" data-testid="hostile-movement-harness" aria-live="polite">
      <HostileMovementPanel data={payload} />
    </div>
  );
}

/**
 * The dossier is driven by an imperative controller, so the scene creates one,
 * renders the panel against it, and hands the wrapper element back as the
 * dispatch target for `faction-intel-select`. The controller is published on
 * window so a test can call select / getSelectedId / destroy on the real thing.
 */
function FactionIntelScene() {
  const payload = window.__FACTION_INTEL_PAYLOAD__ || {};
  const wrapperRef = React.useRef(null);
  const [controller] = React.useState(() => createFactionIntelController({
    snapshot: payload.snapshot,
    briefing: payload.briefing,
    observerId: payload.observerId,
  }));

  React.useLayoutEffect(() => {
    controller.setContainer(wrapperRef.current);
    window.__FACTION_INTEL_CONTROLLER__ = controller;
    return () => controller.setContainer(null);
  }, [controller]);

  return (
    <div data-testid="faction-intel-harness" ref={wrapperRef}>
      <FactionIntel controller={controller} />
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

function DriveExplorerScene() {
  // The panel is store-driven — scripts/verify_drive_explorer.js reads
  // `_internals.state` and the vanilla panel it replaces worked the same way —
  // so the payload prop SEEDS the store and the tests then drive it with
  // `_internals.setPayload` / `_internals.patchState` against this one instance.
  // #driveExplorer is the id the VIEWS registry mounts into on the real shell.
  const payload = window.__DRIVE_EXPLORER_PAYLOAD__;
  return (
    <div data-testid="drive-explorer-harness">
      <div id="driveExplorer">
        <DriveExplorer payload={payload} />
      </div>
    </div>
  );
}

/**
 * The map is fed a payload and an options bag, exactly as
 * `WorldTheaterMap.render(container, theaters, options)` was. `onSelect` cannot
 * cross the Playwright boundary as a function, so the scene installs one that
 * records every selected record on `window.__WORLD_MAP_SELECTIONS__`; the Node
 * fixture drains that list and calls the test's own callback with it.
 */
function WorldMapScene() {
  const payload = window.__WORLD_MAP_PAYLOAD__ || {};
  const options = { ...(payload.options || {}) };
  if (!window.__WORLD_MAP_SELECTIONS__) window.__WORLD_MAP_SELECTIONS__ = [];
  options.onSelect = (record) => { window.__WORLD_MAP_SELECTIONS__.push(record); };
  return (
    <div data-testid="world-map-harness" style={{ width: 720 }}>
      <div className="init-map-container">
        <WorldMap theaters={payload.theaters} options={options} />
      </div>
    </div>
  );
}

/**
 * The shared dialog does not mount into the scene — it appends `#mcDetailPanel`
 * to `document.body` itself, exactly as it does on the real shell. So the scene
 * supplies the PAGE AROUND IT: the topbar, two `.init-view` sections, `main`,
 * and the two sibling overlay shells whose ids `syncPageInert` keys on. Without
 * those there is nothing for the inert bookkeeping to act on and the part of
 * this component most likely to break silently would go untested.
 *
 * The panel is opened from `window.__DETAIL_PANEL_PAYLOAD__` on mount, so the
 * scene really does render it. The open is deferred to a microtask because
 * `open()` commits with `flushSync`, and calling that from inside a React effect
 * is a warning — the trigger button and the tests' own
 * `MissionControlDetailPanel.open(…)` calls reach it the way a real caller does.
 */
function DetailPanelScene() {
  const payload = window.__DETAIL_PANEL_PAYLOAD__;
  const opened = React.useRef(false);

  React.useEffect(() => {
    if (opened.current || !payload) return;
    opened.current = true;
    queueMicrotask(() => openDetailPanel(payload));
  }, [payload]);

  return (
    <div data-testid="detail-panel-harness">
      <header className="init-topbar">
        <button
          id="detailPanelHarnessTrigger"
          className="init-btn"
          type="button"
          onClick={() => openDetailPanel(window.__DETAIL_PANEL_PAYLOAD__ || {})}
        >
          Open detail
        </button>
      </header>
      <main>
        <section id="view-command" className="init-view" aria-hidden="false">
          <p>COMMAND view content</p>
        </section>
        <section id="view-records" className="init-view" hidden aria-hidden="true">
          <p>RECORDS view content</p>
        </section>
      </main>
      <section id="factionIntelScreen" className="faction-intel-screen" hidden aria-hidden="true">
        <div className="faction-intel-screen__dialog">Faction dossier</div>
      </section>
      <section
        id="intelligenceLibraryScreen"
        className="intelligence-library-screen"
        hidden
        aria-hidden="true"
      >
        <div className="intelligence-library-screen__dialog">Intelligence library</div>
      </section>
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
