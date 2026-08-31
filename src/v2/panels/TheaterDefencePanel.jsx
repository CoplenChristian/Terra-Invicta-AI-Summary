/**
 * src/v2/panels/TheaterDefencePanel.jsx
 *
 * Purpose: read-only surface for `briefing.engineDirectives.theaterDefence`.
 *   The advisor could recommend councilor missions and nothing else; this block
 *   is the one that says "a hostile fleet reaches Mercury in 24 days, the
 *   fastest hull your Mercury yards can lay down lands 15 days before it, start
 *   now". §1c of `/latest-war-room.md` has rendered it for AI readers since
 *   `6208495`; until this panel, no v2 view rendered it for a human.
 *
 * THREE THINGS THIS PANEL DELIBERATELY DOES NOT HIDE
 * --------------------------------------------------
 *   * The refusals. A `CANNOT_ADVISE` finding with its refused checks named is
 *     the feature working, not an empty state to suppress.
 *   * The citation trail. The shared basis is printed once — a genuine
 *     intersection across rows, so it can never claim a reading some row lacks —
 *     and each row carries its own count plus whatever it cites beyond that set.
 *   * The distinction between "nothing inbound" and "arrival time unknown".
 *     `threat.arrivalTimingKnown` is `null`, not `false`, when nothing is under
 *     way, and rendering the two alike would turn "there is no clock" into
 *     "the clock could not be read". See `contactReading`.
 *
 * Presence is resolved through `<Value>`/`resolveValue()`; layout and spacing
 * come from MUI. The stylesheet keeps type, colour, borders and surfaces.
 *
 * The render decisions live in `theaterDefencePanelUtils.mjs` so the unit tests
 * can exercise them without bringing the vite bundle into Node.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import Box from '@mui/material/Box';
import { ThemeProvider } from '@mui/material/styles';
import { Panel } from '../components/Panel.jsx';
import { DataTable } from '../components/DataTable.jsx';
import { TruncationNote } from '../components/TruncationNote.jsx';
import { Value } from '../components/Value.jsx';
import initiativeTheme from '../theme.js';
import {
  STATE_LABEL,
  STATE_MODIFIER,
  present,
  formatCount,
  formatDays,
  formatMargin,
  findingRows,
  postureCounts,
  truncationInfo,
  emptyReason,
  sharedCitations,
  notesOf,
  stateTokenFor
} from './theaterDefencePanelUtils.mjs';

const COLUMNS = [
  { key: 'theater', label: 'THEATER' },
  { key: 'posture', label: 'POSTURE' },
  { key: 'inbound', label: 'INBOUND' },
  { key: 'contact', label: 'CONTACT' },
  { key: 'present', label: 'HOSTILE, PRESENT' },
  { key: 'ours', label: 'OURS AT BODY' },
  { key: 'race', label: 'BUILD RACE' }
];

const layout = {
  banner: (space) => ({
    display: 'grid',
    gap: space.md,
    padding: `${space.lg} 14px ${space.xl}`,
    borderBottom: '1px solid var(--line)',
  }),
  tally: (space) => ({
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
    gap: space.md,
  }),
  tallyItem: (space) => ({
    display: 'grid',
    gap: space['2xs'],
    padding: `${space.md} ${space.lg}`,
  }),
  basis: (space) => ({
    margin: `${space.lg} 0 0`,
    display: 'flex',
    flexWrap: 'wrap',
    gap: `${space.xs} ${space.md}`,
  }),
  notes: (space) => ({
    listStyle: 'none',
    margin: `${space.lg} 0 0`,
    padding: 0,
    display: 'grid',
    gap: space.sm,
  }),
  citations: (space) => ({
    display: 'flex',
    flexWrap: 'wrap',
    gap: `${space.xs} ${space.lg}`,
  }),
  refusals: (space) => ({
    listStyle: 'none',
    margin: `0 0 ${space.md}`,
    padding: `${space.md} ${space.lg}`,
    display: 'grid',
    gap: space.sm,
  }),
  refusalItem: (space) => ({
    display: 'grid',
    gap: space['2xs'],
  }),
};

const InlineSpanBox = (props) => (
  <Box component="span" {...props} sx={{ '&&': { display: 'inline' } }} />
);

function Count({ value, inline = false, ...rest }) {
  return (
    <Value
      as={inline ? InlineSpanBox : undefined}
      value={value}
      format={formatCount}
      present={present(value)}
      {...rest}
    />
  );
}

/**
 * The contact clock. `data-contact-state` carries the four cases structurally,
 * so a test asserts the claim rather than reading a glyph out of the text.
 */
function ContactCell({ contact }) {
  if (contact.state === 'measured') {
    return (
      <span className="td-contact" data-contact-state="measured">
        <Value value={contact.days} format={formatDays} present={present(contact.days)} />
        {contact.date ? <small className="td-contact__date">arr. {contact.date}</small> : null}
      </span>
    );
  }
  return (
    <span className="td-contact" data-contact-state={contact.state}>
      <Value value={null} present={false} absentLabel={contact.label} />
    </span>
  );
}

/**
 * The build race, with the hull always named beside the margin. The race uses
 * the FASTEST hull the body's own yards can lay down, not the most useful one,
 * so a margin shown without its hull invites reading it as a recommendation.
 */
function RaceCell({ race }) {
  if (race.state !== 'measured') {
    return (
      <span className="td-race" data-race-state={race.state}>
        <Value value={null} present={false} absentLabel={race.label} />
        {race.reason ? <small className="td-race__reason">{race.reason}</small> : null}
      </span>
    );
  }
  return (
    <span className="td-race" data-race-state="measured" data-verdict={race.verdict || undefined}>
      <strong className="td-race__verdict">{race.verdictLabel}</strong>
      <small className="td-race__hull">
        fastest hull: {race.hullName ?? <Value value={null} present={false} absentLabel="hull not read" />}
        {race.shipyardId != null ? ` · yard ${race.shipyardId}` : null}
      </small>
      <small className="td-race__figures">
        build <Value as={InlineSpanBox} value={race.buildDays} format={formatDays} present={present(race.buildDays)} />
        {' vs contact '}
        <Value as={InlineSpanBox} value={race.daysUntilArrival} format={formatDays} present={present(race.daysUntilArrival)} />
        {' · margin '}
        <Value as={InlineSpanBox} value={race.marginDays} format={formatMargin} present={present(race.marginDays)} />
      </small>
    </span>
  );
}

function OursCell({ row }) {
  return (
    <span className="td-ours">
      <span className="td-ours__line">
        <Count inline value={row.ourShips} /> ship(s) · <Count inline value={row.ourShipyards} /> yard(s)
      </span>
      <small className="td-ours__line">
        <Count inline value={row.ourHabs} /> hab(s) · <Count inline value={row.ourMines} /> mine(s)
      </small>
      {row.completing !== null ? (
        <small className="td-ours__line td-ours__completing">
          <Count inline value={row.completing} /> completing before contact
          {row.completionBasis ? ` (${row.completionBasis})` : null}
        </small>
      ) : null}
    </span>
  );
}

/** Refusals and the row's own citation trail, under the row they belong to. */
function DetailRow({ row }) {
  const hasRefusals = row.refusals.length > 0;
  const hasExtras = row.extraCitations.length > 0;
  return (
    <tr className="td-row td-row--detail" data-detail-for={row.key}>
      <td className="td-cell td-cell--detail" colSpan={COLUMNS.length}>
        {hasRefusals ? (
          <Box
            component="ul"
            className="td-refusals"
            data-refusal-count={row.refusals.length}
            sx={(theme) => layout.refusals(theme.initiative.space)}
          >
            {row.refusals.map((refusal, index) => (
              <Box
                component="li"
                className="td-refusals__item"
                key={`${row.key}-refusal-${index}`}
                sx={(theme) => layout.refusalItem(theme.initiative.space)}
              >
                <span className="td-refusals__check">{refusal?.check || 'unnamed check'}</span>
                <span className="td-refusals__reason">
                  {refusal?.reason || 'no reason was recorded'}
                </span>
              </Box>
            ))}
          </Box>
        ) : null}
        <Box
          className="td-citations"
          data-citation-count={row.citationCount}
          sx={(theme) => layout.citations(theme.initiative.space)}
        >
          <span className="td-citations__count">
            <Count value={row.citationCount} /> reading(s) cited
          </span>
          {hasExtras ? (
            <span className="td-citations__extra">
              beyond the shared basis: {row.extraCitations.join(', ')}
            </span>
          ) : (
            <span className="td-citations__extra">all from the shared basis below</span>
          )}
          {row.citationsUnreadable > 0 ? (
            <span className="td-citations__unreadable">
              <Count value={row.citationsUnreadable} /> citation(s) carried no readable source/field
              and are not counted above
            </span>
          ) : null}
        </Box>
      </td>
    </tr>
  );
}

function FindingRow({ row }) {
  return (
    <>
      <tr className="td-row" data-body={row.body || undefined} data-posture={row.posture || undefined}>
        <td className="td-cell td-cell--theater">
          <strong className="td-body">
            {row.body ?? <Value value={null} present={false} absentLabel="body not named" />}
          </strong>
          <small className="td-status">
            {row.theaterStatus ?? <Value value={null} present={false} absentLabel="status not read" />}
          </small>
          {row.spaceTheaterKey ? <small className="td-status">{row.spaceTheaterKey}</small> : null}
        </td>
        <td className="td-cell td-cell--posture">
          <span className={`td-posture td-posture--${row.postureModifier}`}>
            {row.postureLabel ?? <Value value={null} present={false} absentLabel="posture not read" />}
          </span>
          {row.postureBody ? <small className="td-posture__body">{row.postureBody}</small> : null}
        </td>
        <td className="td-cell td-cell--inbound">
          <span className="td-pair">
            <Count inline value={row.inboundFleets} /> fleet(s)
          </span>
          <small className="td-pair">
            <Count inline value={row.inboundShips} /> ship(s)
          </small>
        </td>
        <td className="td-cell td-cell--contact"><ContactCell contact={row.contact} /></td>
        <td className="td-cell td-cell--present">
          <span className="td-pair">
            <Count inline value={row.presentFleets} /> fleet(s)
          </span>
          <small className="td-pair">
            <Count inline value={row.presentShips} /> ship(s)
          </small>
        </td>
        <td className="td-cell td-cell--ours"><OursCell row={row} /></td>
        <td className="td-cell td-cell--race"><RaceCell race={row.race} /></td>
      </tr>
      <DetailRow row={row} />
    </>
  );
}

function PostureBanner({ defence }) {
  const state = defence.state;
  const { rows, unrecognised } = postureCounts(defence);
  return (
    <Box className="td-banner" sx={(theme) => layout.banner(theme.initiative.space)}>
      <div className={`td-banner__state td-banner__state--${state || 'UNREAD'}`}>
        {state
          ? (STATE_LABEL[state] || state)
          : 'HOSTILE-MOVEMENT STATE NOT READ — the block carried no whole-board state'}
      </div>
      <Box className="td-tally" sx={(theme) => layout.tally(theme.initiative.space)}>
        {rows.length > 0 ? rows.map((entry) => (
          <Box
            className={`td-tally__item td-tally__item--${entry.modifier}`}
            key={entry.posture}
            sx={(theme) => layout.tallyItem(theme.initiative.space)}
          >
            <small>{entry.label}</small>
            <strong><Count value={entry.count} /></strong>
          </Box>
        )) : (
          <Box
            className="td-tally__item td-tally__item--quiet"
            sx={(theme) => layout.tallyItem(theme.initiative.space)}
          >
            <small>POSTURES</small>
            <strong><Value value={null} present={false} absentLabel="none" /></strong>
          </Box>
        )}
        {unrecognised > 0 ? (
          <Box
            className="td-tally__item td-tally__item--refused"
            sx={(theme) => layout.tallyItem(theme.initiative.space)}
          >
            <small>POSTURE NOT READ</small>
            <strong><Count value={unrecognised} /></strong>
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}

function BasisLine({ defence }) {
  const shared = sharedCitations(defence);
  if (shared.length === 0) return null;
  return (
    <Box component="p" className="td-basis" sx={(theme) => layout.basis(theme.initiative.space)}>
      <span className="td-basis__label">SHARED BASIS</span>
      <span className="td-basis__list">{shared.join(', ')}</span>
    </Box>
  );
}

function Notes({ defence }) {
  const notes = notesOf(defence);
  if (notes.length === 0) return null;
  return (
    <Box component="ul" className="td-notes" sx={(theme) => layout.notes(theme.initiative.space)}>
      {notes.map((note, index) => (
        <Box component="li" className="td-notes__item" key={`td-note-${index}`}>
          {note}
        </Box>
      ))}
    </Box>
  );
}

function PanelBody({ data }) {
  const rows = findingRows(data);
  const { total, omitted, shown } = truncationInfo(data);
  const empty = emptyReason(data);
  const modifier = (data.state && STATE_MODIFIER[data.state]) || 'alert';

  return (
    <Panel
      title="THEATER DEFENCE — BUILD, REINFORCE OR WITHDRAW"
      headerAside={<Count value={total} />}
      modifier={modifier}
      data-state={data.state || 'UNREAD'}
      data-primitive="theater-defence"
    >
      <PostureBanner defence={data} />
      <DataTable
        variant="theater-defence"
        columns={COLUMNS}
        hintText="Swipe horizontally to inspect all columns"
      >
        <tbody>
          {rows.length > 0 ? (
            rows.map((row) => <FindingRow key={row.key} row={row} />)
          ) : (
            <tr>
              <td colSpan={COLUMNS.length} className="td-empty-cell">{empty}</td>
            </tr>
          )}
        </tbody>
      </DataTable>
      <TruncationNote
        totalCount={total}
        omittedCount={omitted}
        shownCount={shown}
        formatTruncated={({ shown: s, omitted: om, total: t }) =>
          (s != null ? `${formatCount(s)} shown · ${formatCount(om)} omitted` : `${formatCount(om)} omitted`)
          + (t != null ? ` (${formatCount(t)} total)` : '')}
        allShownLabel="Every theater at issue is listed."
        unknownLabel="Omitted-finding count not read — this list may be incomplete."
      />
      <BasisLine defence={data} />
      {data.offBoardNote ? <p className="td-offboard">{data.offBoardNote}</p> : null}
      <Notes defence={data} />
    </Panel>
  );
}

export function TheaterDefencePanel({ data }) {
  const token = stateTokenFor(data);

  const content = (() => {
    if (token === 'UNAVAILABLE_READ') {
      return (
        <div className="td-empty" data-primitive="theater-defence" data-state="UNAVAILABLE_READ">
          THEATER DEFENCE UNAVAILABLE — the briefing did not carry the block.
        </div>
      );
    }

    if (token === 'UNAVAILABLE_BLOCK') {
      return (
        <Panel
          title="THEATER DEFENCE"
          headerAside="UNAVAILABLE"
          modifier="alert"
          data-state="UNAVAILABLE_BLOCK"
          data-primitive="theater-defence"
        >
          <div className="td-empty">
            THEATER DEFENCE UNAVAILABLE — {data.unavailableReason || 'no reason was recorded'}
          </div>
          <Notes defence={data} />
        </Panel>
      );
    }

    return <PanelBody data={data} />;
  })();

  return <ThemeProvider theme={initiativeTheme}>{content}</ThemeProvider>;
}

// ---------------------------------------------------------------------------
// Mount helpers used by src/v2/main.jsx and public/v2/js/mission-control.js.
//
// The block rides on the briefing the controller has already fetched, not on a
// second request: `/api/v2/briefing` generates a fresh engine run per call, and
// two calls would be two runs against one save with nothing guaranteeing they
// agree. So the render takes whatever wrapper the caller has to hand and
// unwraps it — and an `engineDirectives` object with no `theaterDefence` on it
// resolves to null, which renders the honest unavailable state rather than an
// empty board.
// ---------------------------------------------------------------------------

const theaterDefenceRoots = typeof WeakMap !== 'undefined' ? new WeakMap() : new Map();

function mountInto(container, element) {
  let root = theaterDefenceRoots.get(container);
  if (!root) {
    root = createRoot(container);
    theaterDefenceRoots.set(container, root);
  }
  root.render(element);
}

export function readTheaterDefencePayload(data) {
  if (!data || typeof data !== 'object') return null;
  if ('theaterDefence' in data) return data.theaterDefence || null;
  if ('engineDirectives' in data) {
    const engine = data.engineDirectives;
    if (!engine || typeof engine !== 'object') return null;
    return engine.theaterDefence || null;
  }
  if ('briefing' in data) {
    const engine = data.briefing?.engineDirectives;
    if (!engine || typeof engine !== 'object') return null;
    return engine.theaterDefence || null;
  }
  return data;
}

export function renderTheaterDefence(container, data) {
  if (!container) return;
  mountInto(container, <TheaterDefencePanel data={readTheaterDefencePayload(data)} />);
}

// Test-only token — re-exported so unit tests classify a payload with the same
// function the panel branches on, without importing the JSX module.
export { stateTokenFor };

export default TheaterDefencePanel;
