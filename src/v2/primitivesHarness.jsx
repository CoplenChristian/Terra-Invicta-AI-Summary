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
