// src/v2/panels/hostileMovementPanelUtils.mjs
//
// Purpose: testable render helpers behind src/v2/panels/HostileMovementPanel.jsx.
//   The JSX panel is a thin renderer over these helpers so the four-state
//   collapse guards can run under plain Node + node:test, without bringing
//   the vite bundle into the unit suite.

import { HOSTILE_MOVEMENT_STATE } from '../../../shared/intelResources.mjs';

export const STATE_LABEL = Object.freeze({
  [HOSTILE_MOVEMENT_STATE.none]: 'NO HOSTILE MOVEMENT OBSERVED',
  [HOSTILE_MOVEMENT_STATE.elsewhere]: 'HOSTILE MOVEMENT — NONE TOWARD TRACKED THEATERS',
  [HOSTILE_MOVEMENT_STATE.partlyUnresolved]: 'HOSTILE MOVEMENT — DESTINATIONS PARTLY UNRESOLVED',
  [HOSTILE_MOVEMENT_STATE.inbound]: 'INBOUND TO TRACKED THEATER'
});

export const STATE_MODIFIER = Object.freeze({
  [HOSTILE_MOVEMENT_STATE.none]: 'quiet',
  [HOSTILE_MOVEMENT_STATE.elsewhere]: 'alert',
  [HOSTILE_MOVEMENT_STATE.partlyUnresolved]: 'alert',
  [HOSTILE_MOVEMENT_STATE.inbound]: 'priority'
});

export const STATE_BODY = Object.freeze({
  [HOSTILE_MOVEMENT_STATE.none]: 'No hostile fleet transfers are currently observed.',
  [HOSTILE_MOVEMENT_STATE.elsewhere]: 'Hostile fleets are moving, but none are heading to any of the 12 tracked theaters. The off-board destinations below are the whole picture.',
  [HOSTILE_MOVEMENT_STATE.partlyUnresolved]: 'Hostile fleets are moving. At least one destination could not be resolved to a tracked body, so the claim "none of this is coming to a tracked theater" cannot be supported. Treat the unresolved rows as the unresolved ones — the war could end up there.',
  [HOSTILE_MOVEMENT_STATE.inbound]: 'At least one hostile fleet is currently inbound to a tracked theater. The off-board destinations below are the rest of the hostile movement that is NOT heading to any of the 12 theaters.'
});

/**
 * The string-token for a rendered state. Returns ONE of:
 *   - "UNAVAILABLE_READ" — payload could not be read
 *   - "UNAVAILABLE_NO_STATE" — payload read but state field is missing
 *   - STATE_LABEL for the state — payload is meaningful and the rendering
 *     differs from any of the others.
 */
export function stateTokenFor(data) {
  if (data === null || data === undefined) return 'UNAVAILABLE_READ';
  if (typeof data !== 'object') return 'UNAVAILABLE_READ';
  if (!data.state) return 'UNAVAILABLE_NO_STATE';
  return STATE_LABEL[data.state] || `UNKNOWN_STATE_${data.state}`;
}

/**
 * Plain-text lines that describe the panel's body for each state. Used by
 * tests to compare renderings without bringing JSX into Node.
 */
export function describePanel(data) {
  if (data === null || data === undefined) {
    return ['UNAVAILABLE: HOSTILE MOVEMENT UNAVAILABLE — the endpoint could not be read.'];
  }
  if (typeof data !== 'object' || !data.state) {
    return ['UNAVAILABLE: HOSTILE MOVEMENT STATE UNAVAILABLE — the read did not name a state.'];
  }
  const label = STATE_LABEL[data.state] || data.state;
  const observedT = data.observed?.transfers ?? 0;
  const observedS = data.observed?.ships ?? 0;
  const towardT = data.towardTrackedTheaters?.transfers ?? 0;
  const towardS = data.towardTrackedTheaters?.ships ?? 0;
  const untrackedT = data.towardUntrackedBodies?.transfers ?? 0;
  const untrackedS = data.towardUntrackedBodies?.ships ?? 0;
  const unresolvedT = data.unresolvedDestinations?.transfers ?? 0;
  const unresolvedS = data.unresolvedDestinations?.ships ?? 0;
  const lines = [
    `STATE: ${label}`,
    `OBSERVED: ${observedT} transfer(s), ${observedS} ship(s)`,
    `TOWARD_TRACKED: ${towardT} transfer(s), ${towardS} ship(s)`,
    `TOWARD_UNTRACKED: ${untrackedT} transfer(s), ${untrackedS} ship(s)`,
    `UNRESOLVED: ${unresolvedT} transfer(s), ${unresolvedS} ship(s)`,
    `NEAREST_ARRIVAL: ${Number.isFinite(data.nearestArrivalDays) ? `${data.nearestArrivalDays} day(s)` : 'ETA unknown'}`,
    `BODY: ${STATE_BODY[data.state] || ''}`
  ];
  return lines;
}

function fmt(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US');
}

function isFiniteCount(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

/**
 * Build the destination rows for the off-board table as plain objects.
 * Returned shape is suited for both the React DataTable and node:test.
 */
export function destinationRows(movement) {
  const rows = Array.isArray(movement?.offBoardDestinations) ? movement.offBoardDestinations : [];
  return rows.map((row, i) => ({
    key: row.fleetId ?? i,
    faction: row.faction || 'Hostile',
    fleet: row.fleet || '—',
    shipCount: row.shipCount,
    resolvedLabel: row.resolved === false
      ? `unresolved (${row.unresolvedReason || 'reason not read'})`
      : `${row.resolvedBody || row.statedDestination || 'unknown'}${row.trackedTheater ? ' (tracked)' : ' (untracked)'}`,
    viaText: row.via && row.via.length > 0 ? row.via.join(' → ') : (row.statedDestination || '—'),
    daysRemaining: row.daysRemaining,
    arrival: row.arrival
  }));
}

/**
 * Build the truncation note strings (total/omitted/shown) for the off-board
 * table. Kept separate so the test can read the values without rendering
 * the React component.
 */
export function truncationInfo(movement) {
  const rows = Array.isArray(movement?.offBoardDestinations) ? movement.offBoardDestinations : [];
  const total = isFiniteCount(movement?.offBoardDestinationsTotalCount)
    ? movement.offBoardDestinationsTotalCount
    : rows.length;
  const omitted = isFiniteCount(movement?.offBoardDestinationsOmittedCount)
    ? movement.offBoardDestinationsOmittedCount
    : null;
  const shown = rows.length;
  return { total, omitted, shown };
}

/**
 * Summary cell values as plain strings, used by both the React panel and
 * the unit tests. Provides stable formatting so the four states produce
 * four distinct renderings.
 */
export function summaryCells(data) {
  return {
    observed: data?.observed,
    toward: data?.towardTrackedTheaters,
    untracked: data?.towardUntrackedBodies,
    unresolved: data?.unresolvedDestinations
  };
}

export function formatDays(days) {
  if (!Number.isFinite(days)) return '—';
  return `${fmt(days)} day${days === 1 ? '' : 's'}`;
}
