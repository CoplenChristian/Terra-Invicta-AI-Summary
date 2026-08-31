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
import Box from '@mui/material/Box';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@mui/material/styles';
import { Panel } from '../components/Panel.jsx';
import { DataTable } from '../components/DataTable.jsx';
import { TruncationNote } from '../components/TruncationNote.jsx';
import { Value } from '../components/Value.jsx';
import initiativeTheme from '../theme.js';
import {
  STATE_LABEL,
  STATE_MODIFIER,
  STATE_BODY,
  stateTokenFor,
  destinationRows,
  truncationInfo,
  summaryCells,
  formatDays,
  formatCount,
  present
} from './hostileMovementPanelUtils.mjs';

// MUI owns the panel's layout and spacing. The hostile-movement stylesheet
// continues to own type, colour, borders and surfaces; these values mirror its
// current geometry exactly so the migration has no visual side effects.
const layout = {
  empty: { padding: '12px 14px' },
  banner: (theme) => ({
    display: 'grid',
    gap: theme.initiative.space.md,
    padding: `${theme.initiative.space.lg} 14px 12px`,
  }),
  state: (theme) => ({ padding: `${theme.initiative.space.sm} ${theme.initiative.space.lg}` }),
  body: { margin: 0 },
  summary: (theme) => ({
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: theme.initiative.space.md,
    marginTop: theme.initiative.space.xs,
  }),
  summaryItem: (theme) => ({
    display: 'grid',
    gap: '2px',
    padding: `${theme.initiative.space.md} ${theme.initiative.space.lg}`,
  }),
  offboard: (theme) => ({ marginTop: theme.initiative.space.xl }),
  heading: (theme) => ({
    display: 'flex',
    alignItems: 'baseline',
    gap: theme.initiative.space.md,
    padding: `${theme.initiative.space.sm} 14px`,
  }),
  arrival: { whiteSpace: 'nowrap' },
  date: { display: 'block' },
};

function StatusHeader({ state, observed, toward, untracked, unresolved }) {
  if (!state) return null;
  return (
    <Box className="hm-banner" sx={layout.banner}>
      <Box
        component="div"
        className={`hm-banner__state hm-banner__state--${state}`}
        sx={layout.state}
      >
        {STATE_LABEL[state] || state}
      </Box>
      <Box component="p" className="hm-banner__body" sx={layout.body}>
        {STATE_BODY[state] || ''}
      </Box>
      <Box className="hm-summary" sx={layout.summary}>
        <Box className="hm-summary__item" sx={layout.summaryItem}>
          <small>OBSERVED</small>
          <strong><Value value={observed?.transfers} format={formatCount} present={present(observed?.transfers)} /></strong>
          <small>transfer(s) · <Value value={observed?.ships} format={formatCount} present={present(observed?.ships)} /> ship(s)</small>
        </Box>
        <Box className="hm-summary__item" sx={layout.summaryItem}>
          <small>TOWARD TRACKED THEATERS</small>
          <strong><Value value={toward?.transfers} format={formatCount} present={present(toward?.transfers)} /></strong>
          <small>transfer(s) · <Value value={toward?.ships} format={formatCount} present={present(toward?.ships)} /> ship(s)</small>
        </Box>
        <Box className="hm-summary__item" sx={layout.summaryItem}>
          <small>TOWARD UNTRACKED BODIES</small>
          <strong><Value value={untracked?.transfers} format={formatCount} present={present(untracked?.transfers)} /></strong>
          <small>transfer(s) · <Value value={untracked?.ships} format={formatCount} present={present(untracked?.ships)} /> ship(s)</small>
        </Box>
        <Box className="hm-summary__item" sx={layout.summaryItem}>
          <small>UNRESOLVED DESTINATIONS</small>
          <strong><Value value={unresolved?.transfers} format={formatCount} present={present(unresolved?.transfers)} /></strong>
          <small>transfer(s) · <Value value={unresolved?.ships} format={formatCount} present={present(unresolved?.ships)} /> ship(s)</small>
        </Box>
      </Box>
    </Box>
  );
}

function ArrivalCell({ days, date }) {
  return (
    <Box component="span" className="hm-cell hm-cell--arrival" sx={layout.arrival}>
      <Value value={days} format={formatDays} absentLabel="ETA unknown" present={present(days)} />
      {date ? <Box component="small" className="hm-cell__date" sx={layout.date}>arr. {date}</Box> : null}
    </Box>
  );
}

function DestinationRow({ row }) {
  return (
    <tr className="hm-row">
      <td className="hm-cell hm-cell--faction">{row.faction}</td>
      <Value
        as="td"
        className="hm-cell hm-cell--fleet"
        value={row.fleet}
        present={row.fleetPresent}
        format={String}
      />
      <td className="hm-cell hm-cell--ships"><Value value={row.shipCount} format={formatCount} present={present(row.shipCount)} /></td>
      <td className="hm-cell hm-cell--resolved">{row.resolvedLabel}</td>
      <Value
        as="td"
        className="hm-cell hm-cell--via"
        value={row.viaText}
        present={row.viaPresent}
        format={String}
      />
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
    <Box className="hm-offboard" sx={layout.offboard}>
      <Box className="hm-offboard__heading" sx={layout.heading}>
        <span className="hm-offboard__title">OFF-BOARD HOSTILE MOVEMENT</span>
        <small className="hm-offboard__sub">destinations outside the 12 tracked theaters</small>
      </Box>
      <DestinationTable rows={rows} />
      <TruncationNote
        totalCount={total}
        omittedCount={omitted}
        shownCount={shown}
        formatTruncated={({ shown: s, omitted: om, total: t }) =>
          (s != null ? `${formatCount(s)} shown · ${formatCount(om)} omitted` : `${formatCount(om)} omitted`) +
          (t != null ? ` (${formatCount(t)} total)` : '')
        }
      />
    </Box>
  );
}

export function HostileMovementPanel({ data }) {
  if (!data || typeof data !== 'object') {
    return (
      <ThemeProvider theme={initiativeTheme}>
        <Box className="hm-empty" sx={layout.empty} data-primitive="hostile-movement">
          HOSTILE MOVEMENT UNAVAILABLE — the endpoint could not be read.
        </Box>
      </ThemeProvider>
    );
  }
  const state = data.state;
  if (!state) {
    return (
      <ThemeProvider theme={initiativeTheme}>
        <Box className="hm-empty" sx={layout.empty} data-primitive="hostile-movement">
          HOSTILE MOVEMENT STATE UNAVAILABLE — the read did not name a state.
        </Box>
      </ThemeProvider>
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
    <ThemeProvider theme={initiativeTheme}>
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
    </ThemeProvider>
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
