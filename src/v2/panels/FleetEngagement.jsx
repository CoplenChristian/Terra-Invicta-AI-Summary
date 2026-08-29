/**
 * src/v2/panels/FleetEngagement.jsx
 *
 * Purpose: renders the per-fleet engagement estimates — what force each alien
 *   fleet would cost, gated on whether the observer can reach it. Presence is
 *   resolved through `<Value>`/`resolveValue()`; layout and spacing come from MUI.
 *
 * ---------------------------------------------------------------------------
 * WHY EVERY AFFORDANCE ROUTES THROUGH `<Value>` (live defect #21)
 * ---------------------------------------------------------------------------
 * This panel used to own a private em-dash constant and four private formatters
 * (`int`, `count`, `txt`, `plural`), each re-deciding what an absent value looks
 * like. The text was right and nothing was stamped, so a test could not tell
 * "we measured nothing" from "we rendered nothing" — the property `<Value>`
 * exists to make structural rather than conventional. The affordance now comes
 * from `ABSENT_LABEL` alone; no dash literal is written in this file.
 *
 * Two forms are used, and the choice is forced by the stylesheet, not by taste:
 *
 *   - ELEMENT form (`<Value …/>`, `<Value as={MeasuredValue} …/>`) wherever a
 *     figure owns an element. `as` delegates only the host tag; `<Value>` still
 *     stamps `data-primitive`, `data-value-state` and the `value-*` class, so
 *     the register primitives compose with it at ZERO extra nodes.
 *   - STRING form (`resolveValue().text`) for hosts that can take no element:
 *     `title` attributes, and the composition sentence they carry.
 *
 * `data-primitive` is restored on the register hosts below because `<Value>`
 * would otherwise overwrite it with `"value"`. The node is both things.
 *
 * ---------------------------------------------------------------------------
 * WHAT MUST NOT BE FLATTENED (live defect register #13 / #14)
 * ---------------------------------------------------------------------------
 * `requirement.bandLabel` is ALREADY a band — `hullBandLabel(p20, p80)` renders
 * "19–20 hulls", and a partly rateable fleet is prefixed "at least " because the
 * rating it was swept against covers only part of the opponent. It is rendered
 * verbatim and never recomputed here: collapsing p20–p80 to a point value is
 * defect #13, and reading `winnable: false` as "cannot be won" is #14.
 * `shared/engagementModel.mjs:58` states outright that a sweep returning
 * `winnable: false` means "above the ceiling I swept", NEVER "cannot be won",
 * which is why the beyond-modelled-range row carries the floor
 * "more than 24 hulls" rather than a number pinned at the ceiling.
 *
 * ---------------------------------------------------------------------------
 * PER-METRIC INDEPENDENCE
 * ---------------------------------------------------------------------------
 * Every figure resolves its own `present` from its own input. There is no
 * row-level or panel-level "something was absent" flag, and there must never be
 * one: a previous conversion of a sibling panel hoisted presence to the row and
 * made one absent metric turn unrelated metrics on other rows unavailable.
 * `tests/fleet-engagement.test.js` pins this by `data-value-state`.
 */

import React from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import { ThemeProvider } from '@mui/material/styles';
import { DataTable } from '../components/DataTable.jsx';
import { Measured } from '../components/Measured.jsx';
import { Estimated } from '../components/Estimated.jsx';
import { ABSENT_LABEL, Value, resolveValue } from '../components/Value.jsx';
import { parseNumeric } from '../components/parseNumeric.js';
import initiativeTheme from '../theme.js';

const REACHABILITY_LABEL = {
  'co-located': 'CO-LOCATED',
  reachable: 'REACHABLE',
  'beyond-delta-v': 'BEYOND ΔV',
  unknown: 'REACH UNKNOWN',
};

const VERDICT_LABEL = {
  band: 'MODELLED BAND',
  'beyond-modelled-range': 'BEYOND MODELLED RANGE',
  'not-winnable': 'NOT WINNABLE AS SWEPT',
  unknown: 'CANNOT BE ESTIMATED',
  'withheld-unreachable': 'WITHHELD — UNREACHABLE',
};

const FIELDABLE_LABEL = {
  sufficient: 'CAN FIELD',
  insufficient: 'CANNOT FIELD',
  unknown: 'UNKNOWN',
};

const COLUMNS = [
  { key: 'fleet', label: 'FLEET', headerClassName: 'fe-th--measured', className: 'fe-cell--fleet' },
  { key: 'ships', label: 'SHIPS', headerClassName: 'fe-th--measured', className: 'fe-cell--mass' },
  { key: 'reach', label: 'REACHABILITY', headerClassName: 'fe-th--estimate', className: 'fe-cell--reach' },
  { key: 'need', label: 'HULLS NEEDED', headerClassName: 'fe-th--estimate', className: 'fe-cell--estimate' },
  { key: 'field', label: 'OBSERVER CAN FIELD', headerClassName: 'fe-th--estimate', className: 'fe-cell--estimate' },
];

const TABLE_HINT = 'Swipe horizontally to inspect all columns';

// ---------------------------------------------------------------------------
// Presence and formatting — one decision per figure, taken from its own input
// ---------------------------------------------------------------------------

/** Absent stays null: `Number(null) === 0` and `Number('') === 0`. */
function isNumericPresent(value) {
  return parseNumeric(value) !== null;
}

/** Present text. An empty string is absent, not an empty label. */
function isTextPresent(value) {
  return value !== null && value !== undefined && value !== '';
}

/** A key the label table actually carries. An unrecognised key is absent. */
function isKnownKey(table, key) {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key);
}

function formatInt(value) {
  return String(Math.round(parseNumeric(value)));
}

function formatCount(value) {
  return Math.round(parseNumeric(value)).toLocaleString();
}

/** String form for hosts that can take no element — `title=` and its sentence. */
function intText(value) {
  return resolveValue({ value, present: isNumericPresent(value), format: formatInt }).text;
}

/**
 * `typeof value === 'number'` deliberately, not `parseNumeric`: an omitted
 * count and a count that arrived as a string are different failures, and only
 * the former may read as "every tracked fleet shown".
 */
function isFiniteCount(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

// ---------------------------------------------------------------------------
// Hosts. `as` delegates the element; `<Value>` keeps stamping the contract.
// ---------------------------------------------------------------------------

/** `data-primitive` is restored: this node is a register AND a value. */
function MeasuredValue(props) {
  return <Measured {...props} data-primitive="measured" />;
}

function MeasuredStrongValue(props) {
  return <Measured {...props} as="strong" data-primitive="measured" />;
}

function EstimatedValue(props) {
  return <Estimated {...props} data-primitive="estimated" />;
}

const SmallBox = (props) => <Box component="small" {...props} />;
const SpanBox = (props) => <Box component="span" {...props} />;
const ParagraphBox = (props) => <Box component="p" {...props} />;

/**
 * An inline value inside a `.fe-cell`.
 *
 * `24-fleet-engagement.css` sets `.fe-cell span { display: block }` so the
 * cells' sub-lines stack, which would break a figure composed INTO a sentence.
 * MUI takes the display property back for exactly those nodes; `&&` lifts the
 * Emotion rule to (0,2,0) so it outranks `.fe-cell span` at (0,1,1) without
 * reaching for `!important`, and no CSS is added to `public/v2/css/`.
 */
const InlineSpanBox = (props) => (
  <Box component="span" {...props} sx={{ '&&': { display: 'inline' } }} />
);

/** A round integer, or the absent affordance. */
function Int({ value, ...rest }) {
  return <Value value={value} present={isNumericPresent(value)} format={formatInt} {...rest} />;
}

/** A grouped count (`19,783`), or the absent affordance. */
function Cnt({ value, ...rest }) {
  return <Value value={value} present={isNumericPresent(value)} format={formatCount} {...rest} />;
}

/** Text as read, or the absent affordance. */
function Txt({ value, ...rest }) {
  return <Value value={value} present={isTextPresent(value)} format={String} {...rest} />;
}

/**
 * A count with its noun. Absent keeps the plural noun beside the dash, so the
 * column still says what it counts when it could not count it.
 */
function Plural({ value, singular, plural, ...rest }) {
  return (
    <Value
      value={value}
      present={isNumericPresent(value)}
      absentLabel={`${ABSENT_LABEL} ${plural}`}
      format={(raw) => {
        const rounded = Math.round(parseNumeric(raw));
        return `${rounded} ${rounded === 1 ? singular : plural}`;
      }}
      {...rest}
    />
  );
}

/**
 * A verdict word looked up in one of the label tables.
 *
 * Presence is whether the state was READ, not whether it was good: a payload
 * saying `unknown` resolves `measured`, because the panel did read it. Only an
 * unrecognised or missing key is absent, and it falls back to the same word the
 * hand-written `|| 'UNKNOWN'` produced.
 */
function LabelValue({ table, stateKey, absentLabel, ...rest }) {
  return (
    <Value
      value={stateKey}
      present={isKnownKey(table, stateKey)}
      absentLabel={absentLabel}
      format={(key) => table[key]}
      {...rest}
    />
  );
}

// ---------------------------------------------------------------------------
// Sentences composed from more than one figure
// ---------------------------------------------------------------------------

/**
 * What the requirement was composed over.
 *
 * `?? 0` here is guarded by the both-absent branch above it and is deliberate:
 * with one side read and the other not, the composed total is a floor and the
 * sentence says so. It is a `title`, so the string form is the only form.
 */
function compositionTitle(composition) {
  const rated = parseNumeric(composition?.ratedShips);
  const unrated = parseNumeric(composition?.unratedShips);
  if (rated === null && unrated === null) {
    return 'composition could not be read';
  }
  const ratedCount = rated ?? 0;
  const unratedCount = unrated ?? 0;
  const composed = ratedCount + unratedCount;
  if (unratedCount > 0) {
    return `${intText(composition.ratedShips)} of ${intText(composed)} ships could be rated, so the requirement is a floor`;
  }
  return `composed over all ${intText(composed)} of this fleet's own ships, not N copies of a representative one`;
}

/**
 * Where the fleet is going, as elements so each half keeps its own state.
 *
 * The `· Nd` clause is gated on the day count being carried at all, and the
 * number inside it is resolved separately — an arrival time that is present but
 * unreadable still prints the clause with the absent affordance in it.
 */
function FleetMovement({ row }) {
  if (!row.destination) return 'stationary';
  const hasDays = row.daysToArrival !== null && row.daysToArrival !== undefined;
  return (
    <>
      {'→ '}
      <Txt as={InlineSpanBox} value={row.destination} />
      {hasDays ? (
        <>
          {' · '}
          <Int as={InlineSpanBox} value={row.daysToArrival} />
          {'d'}
        </>
      ) : null}
    </>
  );
}

function reachSummaryText(totals) {
  return Object.keys(totals)
    .map((key) => `${totals[key]} ${REACHABILITY_LABEL[key] || key}`)
    .join(' · ');
}

function omittedText(value) {
  return value > 0
    ? `${intText(value)} ranked lower and omitted`
    : 'every tracked fleet shown';
}

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

function RequirementCell({ row }) {
  const req = row.requirement || {};
  const hasBand = Boolean(req.bandLabel);
  const reasonTitle = req.reason
    || (hasBand
      ? 'Monte Carlo spread of a model across seeded runs; not a measurement.'
      : 'no requirement was formed for this fleet');

  return (
    <Box className={hasBand ? 'fe-need' : 'fe-need fe-need--none'}>
      {hasBand
        // Rendered verbatim. `bandLabel` already carries p20–p80, and the floor
        // prefix when the rating behind it covered only part of the fleet.
        ? <Value as={EstimatedValue} register="fe" present value={req.bandLabel} format={String} />
        : <Value as={SpanBox} className="fe-est__text" present={false} />}
      <LabelValue
        as={SmallBox}
        className="fe-est__text"
        title={reasonTitle}
        table={VERDICT_LABEL}
        stateKey={req.verdict}
        absentLabel="UNKNOWN"
      />
    </Box>
  );
}

function ReachabilityCell({ row }) {
  const reach = row.reachability || {};
  const point = row.engagementPoint && row.engagementPoint.body;
  const title = reach.reason
    || (reach.isEstimate
      ? 'estimated from the shared delta-V destination table'
      : 'read from the save');

  return (
    <Box className={`fe-reach fe-reach--${reach.state || 'unknown'}`}>
      <LabelValue
        as={reach.isEstimate ? SpanBox : MeasuredValue}
        className={reach.isEstimate ? 'fe-est__text' : undefined}
        register={reach.isEstimate ? undefined : 'fe'}
        title={title}
        table={REACHABILITY_LABEL}
        stateKey={reach.state}
        absentLabel="REACH UNKNOWN"
      />
      <Value
        as={SmallBox}
        className="fe-est__text"
        value={point}
        present={Boolean(point)}
        format={String}
        absentLabel="no engagement point"
      />
    </Box>
  );
}

function FieldableCell({ row }) {
  const fieldable = row.fieldable || {};
  const needed = fieldable.hullsNeeded;
  const have = fieldable.hullsAtEngagementPoint;
  const missingSide = needed === null || needed === undefined
    || have === null || have === undefined;

  return (
    <Box className={`fe-field fe-field--${fieldable.verdict || 'unknown'}`}>
      <LabelValue
        as={EstimatedValue}
        register="fe"
        title={fieldable.reason || 'reachable observer hulls against the modelled requirement'}
        table={FIELDABLE_LABEL}
        stateKey={fieldable.verdict}
        absentLabel="UNKNOWN"
      />
      {/*
        Two inputs, one line, so no single `value` fits and the sentence is the
        format. Presence is BOTH sides being carried — a requirement with no
        reachable-hull reading is not "0 reachable", and each side is still
        resolved on its own inside the sentence.
      */}
      <Value
        as={SmallBox}
        className="fe-meas__value"
        present={!missingSide}
        value={null}
        format={() => `${intText(have)} reachable / ${intText(needed)} needed`}
      />
    </Box>
  );
}

function fleetCells(row) {
  const composition = row.composition || {};
  return {
    key: row.fleetId || row.fleetName,
    className: row.threatensObserverAsset ? 'fe-row--threat' : undefined,
    fleet: (
      <>
        <Value
          as={MeasuredStrongValue}
          register="fe"
          value={row.fleetName}
          present={isTextPresent(row.fleetName)}
          format={String}
        />
        <Box component="small" className="fe-meas">
          <Txt as={InlineSpanBox} value={row.orbitBody} />
          {' '}
          <FleetMovement row={row} />
        </Box>
      </>
    ),
    ships: (
      <>
        <Int as={MeasuredValue} register="fe" value={row.shipsCount} />
        <Plural
          as={SmallBox}
          className="fe-meas"
          title={compositionTitle(composition)}
          value={row.distinctHullTypes}
          singular="type"
          plural="types"
        />
      </>
    ),
    reach: <ReachabilityCell row={row} />,
    need: <RequirementCell row={row} />,
    field: <FieldableCell row={row} />,
  };
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

function FleetEngagementBoard({ data }) {
  const own = data.ownForce || {};
  const rows = Array.isArray(data.items) ? data.items : [];
  const totals = data.reachabilityTotals || {};
  const hasRows = rows.length > 0;

  return (
    <Stack
      className="fe-board"
      useFlexGap
      spacing={initiativeTheme.initiative.space.md}
    >
      <Box
        className="fe-banner"
        sx={(theme) => ({
          display: 'flex',
          alignItems: 'flex-start',
          gap: theme.initiative.space.md,
          padding: `${theme.initiative.space.md} ${theme.initiative.space.lg}`,
        })}
      >
        <Box component="span" className="fe-banner__tag">ESTIMATE</Box>
        <Box component="span" className="fe-est__text">
          Hull bands are a MODEL, not a reading of the save. The band is
          run-to-run spread of that model and nothing else; the opponent rating behind it is uncalibrated.
          Ship counts, locations and arrival times are measured.
        </Box>
      </Box>

      <Stack
        className="fe-summary"
        direction="row"
        useFlexGap
        sx={(theme) => ({
          flexWrap: 'wrap',
          gap: `${theme.initiative.space.lg} ${theme.initiative.space['3xl']}`,
          padding: `${theme.initiative.space.md} ${theme.initiative.space.lg}`,
        })}
      >
        <Stack className="fe-summary__item" useFlexGap spacing="1px" sx={{ minWidth: '150px' }}>
          <Box component="small">OWN FORCE</Box>
          <Box component="strong" className="fe-meas__value">
            <Int value={own.totalHulls} /> hulls / <Int value={own.fleetCount} /> fleets
          </Box>
          <Box component="small" className="fe-meas" title={own.ratingSource || ''}>
            best design <Txt value={own.bestDesignName} /> · <Cnt value={own.rating} />
          </Box>
        </Stack>
        <Stack className="fe-summary__item" useFlexGap spacing="1px" sx={{ minWidth: '150px' }}>
          <Box component="small">HOSTILE FLEETS</Box>
          <Box component="strong" className="fe-meas__value">
            <Int value={data.fleetsTotalCount} /> fleets / <Int value={data.shipsTotalCount} /> ships
          </Box>
          <Value
            as={SmallBox}
            className="fe-est__text"
            value={totals}
            present={Object.keys(totals).length > 0}
            format={reachSummaryText}
            absentLabel="reachability not evaluated"
          />
        </Stack>
        <Stack className="fe-summary__item" useFlexGap spacing="1px" sx={{ minWidth: '150px' }}>
          <Box component="small">SHOWING</Box>
          <Box component="strong" className="fe-meas__value">
            <Int value={rows.length} /> of <Int value={data.fleetsTotalCount} />
          </Box>
          <Value
            as={SmallBox}
            className="fe-est__text"
            value={data.fleetsOmittedCount}
            present={isFiniteCount(data.fleetsOmittedCount)}
            format={omittedText}
            absentLabel="omitted count not read — list may be incomplete"
          />
        </Stack>
      </Stack>

      <Box className="fe-ordered" title={data.orderedBy || ''}>
        ORDERED BY THREAT TO OBSERVER ASSETS, THEN MASS — HOVER FOR THE FULL BASIS
      </Box>

      <DataTable
        variant="fe"
        columns={COLUMNS}
        rows={hasRows ? rows.map(fleetCells) : undefined}
        hintText={TABLE_HINT}
      >
        {hasRows ? undefined : (
          <tbody>
            <tr>
              <td colSpan={5} className="fe-empty-cell">
                No hostile fleet could be estimated in this intelligence picture.
              </td>
            </tr>
          </tbody>
        )}
      </DataTable>

      <Box
        className="fe-footnote fe-est__text"
        sx={(theme) => ({ paddingTop: theme.initiative.space.md })}
      >
        <Value
          as={ParagraphBox}
          value={data.reachabilityModel && data.reachabilityModel.note}
          present={isTextPresent(data.reachabilityModel && data.reachabilityModel.note)}
          format={String}
          absentLabel=""
        />
        <Value
          as={ParagraphBox}
          value={data.sweep && data.sweep.notWinnableIsNotAConclusion}
          present={isTextPresent(data.sweep && data.sweep.notWinnableIsNotAConclusion)}
          format={String}
          absentLabel=""
        />
      </Box>
    </Stack>
  );
}

export function FleetEngagement({ data }) {
  if (!data) {
    return (
      <ThemeProvider theme={initiativeTheme}>
        <Box className="fe-empty">
          ENGAGEMENT ESTIMATES UNAVAILABLE — the endpoint could not be read.
        </Box>
      </ThemeProvider>
    );
  }

  if (!data.available) {
    return (
      <ThemeProvider theme={initiativeTheme}>
        <Box className="fe-empty">
          {'NO ENGAGEMENT ESTIMATE — '}
          <Value
            as={SpanBox}
            value={data.reason}
            present={isTextPresent(data.reason)}
            format={String}
            absentLabel="reason unavailable"
          />
        </Box>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme={initiativeTheme}>
      <FleetEngagementBoard data={data} />
    </ThemeProvider>
  );
}
