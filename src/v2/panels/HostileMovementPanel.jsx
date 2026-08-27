/**
 * src/v2/panels/HostileMovementPanel.jsx
 *
 * Purpose: read-only surface for `theaterBoardResource(...).hostileMovement`.
 *   The twelve-body theater table silently reports nothing when the hostile
 *   movement is aimed at an orbit or untracked hab, so this panel exists to
 *   separate "no hostile movement anywhere" from "hostile movement, none of it
 *   toward a tracked theater". Those are completely different situations and
 *   must not render alike. The four-state ordering from
 *   `HOSTILE_MOVEMENT_STATE` carries the difference.
 *
 *   The render decisions live in `hostileMovementPanelUtils.mjs` so the unit
 *   tests can exercise them without bringing the vite bundle into Node.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { Panel } from '../components/Panel.jsx';
import { DataTable } from '../components/DataTable.jsx';
import { TruncationNote } from '../components/TruncationNote.jsx';
import { Value } from '../components/Value.jsx';
import {
  STATE_LABEL,
  STATE_MODIFIER,
  STATE_BODY,
  stateTokenFor,
  destinationRows,
  truncationInfo,
  summaryCells,
  formatDays
} from './hostileMovementPanelUtils.mjs';

function fmt(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US');
}

// Explicit presence for <Value>, which renders its absent affordance whenever
// `present` is not true. A count that was not read must stay an em dash; a
// measured 0 must not.
function present(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

function StatusHeader({ state, observed, toward, untracked, unresolved }) {
  if (!state) return null;
  return (
    <div className="hm-banner">
      <div className={`hm-banner__state hm-banner__state--${state}`}>
        {STATE_LABEL[state] || state}
      </div>
      <p className="hm-banner__body">{STATE_BODY[state] || ''}</p>
      <div className="hm-summary">
        <div className="hm-summary__item">
          <small>OBSERVED</small>
          <strong><Value value={observed?.transfers} format={fmt} present={present(observed?.transfers)} /></strong>
          <small>transfer(s) · <Value value={observed?.ships} format={fmt} present={present(observed?.ships)} /> ship(s)</small>
        </div>
        <div className="hm-summary__item">
          <small>TOWARD TRACKED THEATERS</small>
          <strong><Value value={toward?.transfers} format={fmt} present={present(toward?.transfers)} /></strong>
          <small>transfer(s) · <Value value={toward?.ships} format={fmt} present={present(toward?.ships)} /> ship(s)</small>
        </div>
        <div className="hm-summary__item">
          <small>TOWARD UNTRACKED BODIES</small>
          <strong><Value value={untracked?.transfers} format={fmt} present={present(untracked?.transfers)} /></strong>
          <small>transfer(s) · <Value value={untracked?.ships} format={fmt} present={present(untracked?.ships)} /> ship(s)</small>
        </div>
        <div className="hm-summary__item">
          <small>UNRESOLVED DESTINATIONS</small>
          <strong><Value value={unresolved?.transfers} format={fmt} present={present(unresolved?.transfers)} /></strong>
          <small>transfer(s) · <Value value={unresolved?.ships} format={fmt} present={present(unresolved?.ships)} /> ship(s)</small>
        </div>
      </div>
    </div>
  );
}

function ArrivalCell({ days, date }) {
  return (
    <span className="hm-cell hm-cell--arrival">
      <Value value={days} format={formatDays} absentLabel="ETA unknown" present={present(days)} />
      {date ? <small className="hm-cell__date">arr. {date}</small> : null}
    </span>
  );
}

function DestinationRow({ row }) {
  return (
    <tr className="hm-row">
      <td className="hm-cell hm-cell--faction">{row.faction}</td>
      <td className="hm-cell hm-cell--fleet">{row.fleet}</td>
      <td className="hm-cell hm-cell--ships"><Value value={row.shipCount} format={fmt} present={present(row.shipCount)} /></td>
      <td className="hm-cell hm-cell--resolved">{row.resolvedLabel}</td>
      <td className="hm-cell hm-cell--via">{row.viaText}</td>
      <td className="hm-cell hm-cell--arrival"><ArrivalCell days={row.daysRemaining} date={row.arrival} /></td>
    </tr>
  );
}

function DestinationTable({ rows }) {
  const columns = [
    { key: 'faction', label: 'FACTION' },
    { key: 'fleet', label: 'FLEET' },
    { key: 'ships', label: 'SHIPS' },
    { key: 'resolved', label: 'OFF-BOARD RESOLUTION' },
    { key: 'via', label: 'PATH' },
    { key: 'arrival', label: 'ETA' }
  ];
  return (
    <DataTable variant="hostile-movement" columns={columns} hintText="Swipe horizontally to inspect all columns">
      <tbody>
        {rows.length > 0 ? (
          rows.map((row) => <DestinationRow key={row.key} row={row} />)
        ) : (
          <tr>
            <td colSpan={columns.length} className="hm-empty-cell">
              No hostile off-board destinations to list.
            </td>
          </tr>
        )}
      </tbody>
    </DataTable>
  );
}

function OffBoardSection({ movement }) {
  const rows = destinationRows(movement);
  const { total, omitted, shown } = truncationInfo(movement);
  return (
    <div className="hm-offboard">
      <div className="hm-offboard__heading">
        <span className="hm-offboard__title">OFF-BOARD HOSTILE MOVEMENT</span>
        <small className="hm-offboard__sub">destinations outside the 12 tracked theaters</small>
      </div>
      <DestinationTable rows={rows} />
      <TruncationNote
        totalCount={total}
        omittedCount={omitted}
        shownCount={shown}
        formatTruncated={({ shown: s, omitted: om, total: t }) =>
          (s != null ? `${fmt(s)} shown · ${fmt(om)} omitted` : `${fmt(om)} omitted`) +
          (t != null ? ` (${fmt(t)} total)` : '')
        }
      />
    </div>
  );
}

export function HostileMovementPanel({ data }) {
  if (!data || typeof data !== 'object') {
    return (
      <div className="hm-empty" data-primitive="hostile-movement">
        HOSTILE MOVEMENT UNAVAILABLE — the endpoint could not be read.
      </div>
    );
  }
  const state = data.state;
  if (!state) {
    return (
      <div className="hm-empty" data-primitive="hostile-movement">
        HOSTILE MOVEMENT STATE UNAVAILABLE — the read did not name a state.
      </div>
    );
  }
  const modifier = STATE_MODIFIER[state] || 'quiet';
  const headerAside = (
    <Value
      value={data.nearestArrivalDays}
      format={formatDays}
      absentLabel="ETA unknown"
      present={present(data.nearestArrivalDays)}
    />
  );
  const cells = summaryCells(data);

  return (
    <Panel
      title="HOSTILE MOVEMENT BEYOND THE TWELVE THEATERS"
      headerAside={headerAside}
      modifier={modifier}
      data-state={state}
      data-primitive="hostile-movement"
    >
      <StatusHeader state={state} {...cells} />
      <OffBoardSection movement={data} />
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Mount helpers used by src/v2/main.jsx and the existing VIEWS lazy-loader.
// The `hostileMovement` field rides beside the twelve theater rows on
// /api/intel/theaters, so the fetch reads the same endpoint the old theater
// table did and hands the panel just the bucket it actually renders.
// ---------------------------------------------------------------------------

const hostileMovementRoots = typeof WeakMap !== 'undefined' ? new WeakMap() : new Map();

function mountInto(container, element) {
  let root = hostileMovementRoots.get(container);
  if (!root) {
    root = createRoot(container);
    hostileMovementRoots.set(container, root);
  }
  root.render(element);
}

function readHostileMovementPayload(data) {
  if (!data) return null;
  if (data && typeof data === 'object' && 'hostileMovement' in data) {
    return data.hostileMovement || null;
  }
  return data;
}

export async function fetchHostileMovement(observerId = 4712, mode = 'player') {
  const url = `/api/intel/theaters?observer=${encodeURIComponent(observerId)}&mode=${encodeURIComponent(mode)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`theaters endpoint returned ${res.status}`);
  const body = await res.json();
  return readHostileMovementPayload(body);
}

export function renderHostileMovement(container, data) {
  if (!container) return;
  const movement = readHostileMovementPayload(data);
  mountInto(container, <HostileMovementPanel data={movement} />);
}

// Test-only token — re-exported so unit tests can use the same state
// classification this panel uses, without importing the JSX module.
export { stateTokenFor };

export default HostileMovementPanel;
