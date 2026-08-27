// src/v2/panels/theaterDefencePanelUtils.mjs
//
// Purpose: testable render helpers behind src/v2/panels/TheaterDefencePanel.jsx.
//   The JSX panel is a thin renderer over these, so every decision that could
//   render an absent reading as a confident one — the contact clock, the build
//   race, the citation trail — is exercised under plain Node + node:test without
//   bringing the vite bundle in.
//
// THE THREE READINGS THIS FILE REFUSES TO COLLAPSE
// ------------------------------------------------
//   1. `threat.arrivalTimingKnown` is `null` — NOT `false` — when nothing is
//      inbound: there is no timing to know. `false` means something IS inbound
//      and carries no date. Those are different claims and `contactReading`
//      returns different states for them. A `null` flag beside an inbound or
//      unreadable fleet count is a third thing again: the flag itself was not
//      read, which is not "nothing inbound" and never renders as one.
//   2. `buildRace === null` on a body with nothing inbound is "no race applies",
//      while `buildRace === null` on a threatened body is "the race could not be
//      run" and the refusals say why. `buildRaceReading` needs the contact
//      reading to tell them apart, so it takes it.
//   3. A finding list that is empty because the cap dropped everything is not
//      an empty board. `emptyReason` reads `findingsTotalCount` before it says
//      "no theater is at issue".
//
// The build race is run against the FASTEST hull each body's yards can lay down,
// which is not the most useful one — it answers "can production here change the
// board at all". The hull is therefore on every race row: a margin without its
// hull invites reading it as a recommendation.

import { STATE_LABEL, STATE_MODIFIER } from './hostileMovementPanelUtils.mjs';

/** Re-exported so the panel has one state vocabulary, not a second copy. */
export { STATE_LABEL, STATE_MODIFIER };

/**
 * The five postures from server/engine/theaterDefence.js. `CANNOT_ADVISE` is
 * not a failure of the other four — it is the answer whenever the reading a
 * posture would rest on is absent.
 */
export const POSTURE_LABEL = Object.freeze({
  REINFORCE: 'REINFORCE',
  BUILD: 'BUILD',
  WITHDRAW: 'WITHDRAW',
  HOLD: 'HOLD',
  CANNOT_ADVISE: 'CANNOT ADVISE'
});

/** Emitted order for the posture tally. Most actionable first, refusals last. */
export const POSTURE_ORDER = Object.freeze([
  'BUILD',
  'REINFORCE',
  'WITHDRAW',
  'HOLD',
  'CANNOT_ADVISE'
]);

/** CSS modifier per posture; drives colour only, never meaning. */
export const POSTURE_MODIFIER = Object.freeze({
  BUILD: 'act',
  REINFORCE: 'act',
  WITHDRAW: 'urgent',
  HOLD: 'quiet',
  CANNOT_ADVISE: 'refused'
});

/**
 * What each posture claims, restated from `decidePosture` rather than invented.
 * Kept short: the row's own numbers are the evidence, this is the reading.
 */
export const POSTURE_BODY = Object.freeze({
  BUILD: 'this body\'s own yards can lay down a hull that lands before contact',
  REINFORCE: 'fixed holdings here and no ships of ours to fight for them',
  WITHDRAW: 'nothing laid down here lands before contact — the ships here are the force that meets it',
  HOLD: 'no production race applies and nothing here changes the answer this cycle',
  CANNOT_ADVISE: 'a reading this posture rests on is absent — the refused checks are named on the row'
});

/** Verdict wording for a race that actually ran. */
export const VERDICT_LABEL = Object.freeze({
  'build-lands-first': 'BUILD LANDS FIRST',
  'arrival-first': 'ARRIVAL FIRST',
  simultaneous: 'SIMULTANEOUS'
});

/** Absent stays null: a count is a finite number or it is nothing. */
export function count(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Explicit presence for `<Value present={...}>`. Never inferred from falsiness. */
export function present(value) {
  return count(value) !== null;
}

export function formatCount(value) {
  if (count(value) === null) return 'UNAVAILABLE';
  return value.toLocaleString('en-US');
}

export function formatDays(days) {
  if (count(days) === null) return 'UNAVAILABLE';
  return `${days.toLocaleString('en-US')} day${days === 1 ? '' : 's'}`;
}

/** A signed margin reads as a margin; an unsigned one reads as a duration. */
export function formatMargin(days) {
  if (count(days) === null) return 'UNAVAILABLE';
  const sign = days > 0 ? '+' : '';
  return `${sign}${days.toLocaleString('en-US')} day${Math.abs(days) === 1 ? '' : 's'}`;
}

/** ISO instant to the campaign-facing date. Absent stays absent. */
export function formatDate(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

/**
 * The contact clock for one finding.
 *
 * States, and why each is its own:
 *   `nothing-inbound` — the flag is null AND the inbound fleet count is a
 *       measured 0. There is no timing because there is nothing under way.
 *   `unknown`         — the flag is `false`. Something IS inbound and carries no
 *       arrival date. An unknown arrival is not a distant one.
 *   `unread`          — the flag is null beside an inbound or unreadable fleet
 *       count, or the flag says the timing is known and no day count came with
 *       it. The reading is missing; that is not "nothing inbound".
 *   `measured`        — days, and the date when one was carried.
 */
export function contactReading(threat) {
  const known = threat?.arrivalTimingKnown === undefined ? null : threat.arrivalTimingKnown;
  const days = count(threat?.nearestArrivalDays);
  const fleets = count(threat?.hostileFleets);

  if (known === null) {
    if (fleets === 0) {
      return { state: 'nothing-inbound', label: 'nothing inbound', days: null, date: null };
    }
    return { state: 'unread', label: 'arrival timing not read', days: null, date: null };
  }
  if (known === false) {
    return { state: 'unknown', label: 'arrival time unknown', days: null, date: null };
  }
  if (days === null) {
    return { state: 'unread', label: 'arrival days not read', days: null, date: null };
  }
  return { state: 'measured', label: null, days, date: formatDate(threat?.nearestArrivalDate) };
}

/**
 * The build race for one finding, given its contact reading.
 *
 * `not-applicable` and `not-run` are deliberately separate: the first is a body
 * with nothing under way to race against, the second is a threatened body whose
 * race could not be evaluated — and the refusals on that row say which of the
 * two reasons applies (no yard here at all, versus yards that produced no
 * measured build time).
 */
export function buildRaceReading(finding, contact = contactReading(finding?.threat)) {
  const race = finding?.buildRace ?? null;

  if (race === null) {
    if (contact.state === 'nothing-inbound') {
      return {
        state: 'not-applicable',
        label: 'no race — nothing inbound',
        hullName: null,
        shipyardId: null,
        verdict: null,
        verdictLabel: null,
        buildDays: null,
        daysUntilArrival: null,
        marginDays: null,
        reason: null
      };
    }
    return {
      state: 'not-run',
      label: 'race not run',
      hullName: null,
      shipyardId: null,
      verdict: null,
      verdictLabel: null,
      buildDays: null,
      daysUntilArrival: null,
      marginDays: null,
      reason: null
    };
  }

  const hullName = typeof race.hullName === 'string' && race.hullName.trim() !== ''
    ? race.hullName
    : null;
  const shipyardId = race.shipyardId ?? null;

  if (race.available !== true) {
    return {
      state: 'refused',
      label: 'race unevaluable',
      hullName,
      shipyardId,
      verdict: null,
      verdictLabel: null,
      buildDays: count(race.buildDays),
      daysUntilArrival: count(race.daysUntilArrival),
      marginDays: null,
      reason: race.reason ?? null
    };
  }

  const verdict = race.verdict ?? null;
  return {
    state: 'measured',
    label: null,
    hullName,
    shipyardId,
    verdict,
    verdictLabel: verdict === null
      ? null
      : (VERDICT_LABEL[verdict] || `UNRECOGNISED VERDICT (${verdict})`),
    buildDays: count(race.buildDays),
    daysUntilArrival: count(race.daysUntilArrival),
    marginDays: count(race.marginDays),
    reason: null
  };
}

/** `source.field`, the identity a citation is deduplicated and compared on. */
export function citationKey(citation) {
  const source = citation?.source;
  const field = citation?.field;
  if (typeof source !== 'string' || source.trim() === '') return null;
  if (typeof field !== 'string' || field.trim() === '') return null;
  return `${source}.${field}`;
}

function citationKeys(finding) {
  const list = Array.isArray(finding?.citations) ? finding.citations : [];
  const keys = [];
  for (const citation of list) {
    const key = citationKey(citation);
    // A citation that cannot be identified is dropped rather than turned into
    // the string "undefined.undefined", which would dedupe every one of them
    // onto the same key. `citationsUnreadable` reports how many that was.
    if (key !== null && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

/**
 * The readings EVERY finding cites — a genuine intersection, so the section-level
 * basis line can never claim a citation that some row lacks. Empty when there
 * are no findings: an intersection over nothing is nothing, not everything.
 */
export function sharedCitations(defence) {
  const findings = Array.isArray(defence?.findings) ? defence.findings : [];
  if (findings.length === 0) return [];
  let shared = citationKeys(findings[0]);
  for (const finding of findings.slice(1)) {
    const keys = new Set(citationKeys(finding));
    shared = shared.filter((key) => keys.has(key));
  }
  return shared;
}

/** The readings THIS row cites beyond the shared basis. */
export function extraCitations(finding, shared = []) {
  const sharedSet = new Set(shared);
  return citationKeys(finding).filter((key) => !sharedSet.has(key));
}

/**
 * Rows for the findings table, as plain objects both the React table and
 * node:test can read. Row identity comes from the finding's own `id`; a finding
 * with no usable id gets an index key and is counted in `identityFallbacks`
 * rather than keyed on the string "undefined".
 */
export function findingRows(defence) {
  const findings = Array.isArray(defence?.findings) ? defence.findings : [];
  const shared = sharedCitations(defence);

  return findings.map((finding, index) => {
    const id = typeof finding?.id === 'string' && finding.id.trim() !== '' ? finding.id : null;
    const contact = contactReading(finding?.threat);
    const race = buildRaceReading(finding, contact);
    const citations = Array.isArray(finding?.citations) ? finding.citations : [];
    const readable = citationKeys(finding);

    return {
      key: id ?? `theater-defence-row-${index}`,
      identityFallback: id === null,
      body: typeof finding?.body === 'string' && finding.body.trim() !== '' ? finding.body : null,
      spaceTheaterKey: finding?.spaceTheaterKey ?? null,
      theaterStatus: finding?.theaterStatus ?? null,
      posture: finding?.posture ?? null,
      postureLabel: finding?.posture ? (POSTURE_LABEL[finding.posture] || finding.posture) : null,
      postureModifier: finding?.posture ? (POSTURE_MODIFIER[finding.posture] || 'quiet') : 'quiet',
      postureBody: finding?.posture ? (POSTURE_BODY[finding.posture] || null) : null,
      inboundFleets: count(finding?.threat?.hostileFleets),
      inboundShips: count(finding?.threat?.hostileShips),
      presentFleets: count(finding?.threat?.presentHostileFleets),
      presentShips: count(finding?.threat?.presentHostileShips),
      contact,
      ourShips: count(finding?.friendly?.ships),
      ourShipyards: count(finding?.friendly?.shipyards),
      ourHabs: count(finding?.friendly?.habs),
      ourMines: count(finding?.friendly?.mines),
      // Only meaningful where a race against an arrival exists. A body with
      // nothing inbound has no contact to complete before, and printing
      // "0 completing before contact" there would report a race never run.
      completing: contact.state === 'nothing-inbound'
        ? null
        : count(finding?.friendly?.shipsCompletingBeforeThreatArrival),
      completionBasis: finding?.friendly?.completionBasis ?? null,
      race,
      refusals: Array.isArray(finding?.refusals) ? finding.refusals : [],
      citationCount: readable.length,
      citationsUnreadable: citations.length - readable.length,
      extraCitations: extraCitations(finding, shared)
    };
  });
}

/** Posture tally for the banner, in POSTURE_ORDER. Zero counts are dropped. */
export function postureCounts(defence) {
  const findings = Array.isArray(defence?.findings) ? defence.findings : [];
  const tally = new Map();
  let unrecognised = 0;
  for (const finding of findings) {
    const posture = finding?.posture;
    if (typeof posture !== 'string' || posture.trim() === '') {
      unrecognised += 1;
      continue;
    }
    tally.set(posture, (tally.get(posture) ?? 0) + 1);
  }
  const rows = POSTURE_ORDER
    .filter((posture) => tally.has(posture))
    .map((posture) => ({
      posture,
      label: POSTURE_LABEL[posture] || posture,
      modifier: POSTURE_MODIFIER[posture] || 'quiet',
      count: tally.get(posture)
    }));
  // A posture the engine emits that this file does not know about is shown as
  // itself rather than silently dropped from the tally.
  for (const [posture, value] of tally) {
    if (POSTURE_ORDER.includes(posture)) continue;
    rows.push({ posture, label: posture, modifier: 'quiet', count: value });
  }
  return { rows, unrecognised };
}

/** Total / omitted / shown for the truncation note. Absent counts stay null. */
export function truncationInfo(defence) {
  const findings = Array.isArray(defence?.findings) ? defence.findings : [];
  return {
    total: count(defence?.findingsTotalCount),
    omitted: count(defence?.findingsOmittedCount),
    shown: findings.length
  };
}

/**
 * Why the table is empty — never "no theater is at issue" without having read
 * the total first. All rows dropped by the cap is a different fact entirely.
 */
export function emptyReason(defence) {
  const findings = Array.isArray(defence?.findings) ? defence.findings : [];
  if (findings.length > 0) return null;
  const total = count(defence?.findingsTotalCount);
  if (total === null) {
    return 'NO FINDINGS ON RECORD AND NO TOTAL TO CHECK THEM AGAINST — whether any theater is at issue could not be read.';
  }
  if (total > 0) {
    return `NO ROWS SHOWN — all ${total.toLocaleString('en-US')} finding(s) were omitted by the block's own cap.`;
  }
  return 'NO THEATER IS AT ISSUE — no hostile force is inbound to, or present in, any tracked theater.';
}

/**
 * The panel's top-level state, as one token. Used by tests to assert that the
 * unavailable renderings differ from each other and from a real board.
 */
export function stateTokenFor(defence) {
  if (defence === null || defence === undefined) return 'UNAVAILABLE_READ';
  if (typeof defence !== 'object') return 'UNAVAILABLE_READ';
  if (defence.available !== true) return 'UNAVAILABLE_BLOCK';
  if (!defence.state) return 'AVAILABLE_NO_MOVEMENT_STATE';
  return STATE_LABEL[defence.state] || `UNKNOWN_STATE_${defence.state}`;
}

/** The block's own notes, as a plain array. Never fabricated. */
export function notesOf(defence) {
  return Array.isArray(defence?.notes) ? defence.notes.filter(Boolean) : [];
}

/**
 * Plain-text description of the whole panel, so a test can compare renderings
 * without a DOM. Mirrors what the JSX prints, in the same order.
 */
export function describePanel(defence) {
  const token = stateTokenFor(defence);
  if (token === 'UNAVAILABLE_READ') {
    return ['UNAVAILABLE: THEATER DEFENCE UNAVAILABLE — the briefing did not carry the block.'];
  }
  if (token === 'UNAVAILABLE_BLOCK') {
    const reason = defence?.unavailableReason;
    return [
      `UNAVAILABLE: THEATER DEFENCE UNAVAILABLE — ${reason || 'no reason was recorded'}`,
      ...notesOf(defence).map((note) => `NOTE: ${note}`)
    ];
  }

  const lines = [`STATE: ${token}`];
  const { rows: postures, unrecognised } = postureCounts(defence);
  lines.push(`POSTURES: ${postures.length > 0
    ? postures.map((row) => `${row.label} ${row.count}`).join(', ')
    : 'none'}`);
  if (unrecognised > 0) lines.push(`POSTURE_UNREAD: ${unrecognised}`);

  const { total, omitted, shown } = truncationInfo(defence);
  lines.push(`FINDINGS: ${shown} shown, ${omitted === null ? 'UNAVAILABLE' : omitted} omitted, `
    + `${total === null ? 'UNAVAILABLE' : total} total`);

  const empty = emptyReason(defence);
  if (empty) lines.push(`EMPTY: ${empty}`);

  for (const row of findingRows(defence)) {
    lines.push(`ROW: ${row.body ?? 'UNNAMED BODY'} | ${row.postureLabel ?? 'POSTURE NOT READ'} | `
      + `status ${row.theaterStatus ?? 'UNAVAILABLE'} | inbound `
      + `${row.inboundFleets === null ? 'UNAVAILABLE' : row.inboundFleets} fleet(s) / `
      + `${row.inboundShips === null ? 'UNAVAILABLE' : row.inboundShips} ship(s) | contact `
      + `${row.contact.state === 'measured' ? formatDays(row.contact.days) : row.contact.label} | `
      + `race ${row.race.state === 'measured'
        ? `${row.race.verdictLabel} (${row.race.hullName ?? 'HULL NOT READ'}, `
          + `${formatDays(row.race.buildDays)} vs ${formatDays(row.race.daysUntilArrival)}, `
          + `margin ${formatMargin(row.race.marginDays)})`
        : row.race.label} | `
      + `${row.refusals.length} refusal(s) | ${row.citationCount} citation(s)`);
    for (const refusal of row.refusals) {
      lines.push(`  REFUSED ${refusal?.check ?? 'unnamed check'}: ${refusal?.reason ?? 'no reason recorded'}`);
    }
  }

  const shared = sharedCitations(defence);
  if (shared.length > 0) lines.push(`BASIS: ${shared.join(', ')}`);
  if (defence?.offBoardNote) lines.push(`OFF_BOARD: ${defence.offBoardNote}`);
  for (const note of notesOf(defence)) lines.push(`NOTE: ${note}`);
  return lines;
}
