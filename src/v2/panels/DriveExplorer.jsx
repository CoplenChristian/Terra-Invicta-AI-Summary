/**
 * src/v2/panels/DriveExplorer.jsx
 *
 * Purpose: the DRIVES view in React — every drive in the catalogue rated against
 *   one of the observer's designs, from /api/intel/drive-explorer, and the
 *   research path behind a clicked drive from /api/intel/tech-path.
 *
 * THE ONE RULE THIS PANEL EXISTS TO ENFORCE
 * -----------------------------------------
 * Delta-V, combat acceleration and cruise acceleration are MEASURED: the
 * propulsion model held against this hull's own measured dry mass and tank
 * capacity. Destination reachability is an ESTIMATE from a fixed heuristic
 * table, and only nine destinations are modelled.
 *
 * The two are rendered through the <Measured> and <Estimated> primitives so the
 * register split is structural rather than a class somebody remembered to type:
 *
 *   measured   .de-measured — mono, full-contrast --text, upright
 *   estimate   .de-estimate — italic, --text-dim, dashed left rule, and a
 *              literal "ESTIMATE" caption above the column
 *
 * tests/reactPrimitivesRegisters.test.js pins what those two compute to, and
 * scripts/verify_drive_explorer.js reads them back off the rendered DOM with
 * getComputedStyle rather than trusting this file.
 *
 * DEFECT #6 (docs/live-defect-register.md) IS FIXED HERE, NOT PORTED
 * -----------------------------------------------------------------
 * The vanilla panel rebuilt itself with `container.innerHTML = …` on every
 * client-side re-render — sort, bucket, reactor, search, row cap, threshold
 * keystroke — which replaced the `.de-scroll-hint` element with a fresh one
 * carrying only its base class. `syncScrollHints()` lives in mission-control.js
 * and fired on load, the two fetch paths, resize and overlay open; nothing in
 * the component ever called it. So the first client-side interaction dropped
 * `is-scrollable` and the table went on overflowing by 153px at 900px and 353px
 * at 700px with no affordance saying so, until a resize happened to re-measure.
 *
 * The <DataTable> primitive re-measures `scrollWidth > clientWidth` in a layout
 * effect on every render AND through a ResizeObserver on the wrap, so the hint
 * cannot outlive its measurement. It is still MEASURED OVERFLOW that drives it,
 * never viewport width — the property tests/missionControlLayout.test.js
 * protects.
 *
 * WHY A MODULE-LEVEL STORE RATHER THAN useState
 * ---------------------------------------------
 * scripts/verify_drive_explorer.js reads `_internals.state.payload` and calls
 * `_internals.visibleRows(items)` against whatever is typed in the threshold
 * boxes at that moment, exactly as it did against the vanilla panel. Keeping the
 * view state in one module-level object preserves that contract; React
 * subscribes to it and re-renders.
 */

import React from 'react';
import Box from '@mui/material/Box';
import { ThemeProvider } from '@mui/material/styles';
import { DataTable, Measured, Estimated } from '../components/index.js';
import { Panel } from '../components/Panel.jsx';
import { ABSENT_LABEL, Value, resolveValue } from '../components/Value.jsx';
import initiativeTheme from '../theme.js';
import {
  BUCKETS,
  BUCKET_LABEL,
  BUCKET_TITLE,
  SORTS,
  REACTOR_FILTERS,
  ROW_CAPS,
  ESTIMATE_CAPTION,
  SCROLL_HINT_TEXT,
  THRESHOLDS,
  defaultViewState,
  num,
  dec,
  int,
  mult,
  accel,
  power,
  words,
  parseThreshold,
  visibleRows,
  sortRows,
  rp,
  inDependencyOrder,
  pathPanelOptions,
  ungatedPanelOptions,
} from './driveExplorerUtils.mjs';

// ---------------------------------------------------------------------------
// Presence and formatting — each figure resolves against its own input.
// ---------------------------------------------------------------------------

function isNumericPresent(value) {
  return num(value) !== null;
}

function isTextPresent(value) {
  return value !== null && value !== undefined && value !== '';
}

/** String form for an elementless host: titles and composed sentences. */
function valueText(value, format = String, present = isTextPresent(value), absentLabel = ABSENT_LABEL) {
  return resolveValue({ value, present, format, absentLabel }).text;
}

function numberText(value, format = int, absentLabel = ABSENT_LABEL) {
  return valueText(value, format, isNumericPresent(value), absentLabel);
}

/** A figure whose host is supplied by the call site. */
function Figure({ value, format, present, absentLabel = ABSENT_LABEL, ...rest }) {
  return (
    <Value
      value={value}
      present={present ?? isNumericPresent(value)}
      format={format}
      absentLabel={absentLabel}
      {...rest}
    />
  );
}

/** A text value whose empty string is absent, not a blank label. */
function TextFigure({ value, format = String, present, absentLabel = ABSENT_LABEL, ...rest }) {
  return (
    <Value
      value={value}
      present={present ?? isTextPresent(value)}
      format={format}
      absentLabel={absentLabel}
      {...rest}
    />
  );
}

/** Preserve an existing div/span/option while giving it the Value contract. */
function ExistingDiv({ children, ...rest }) {
  return <div {...rest}>{children}</div>;
}

function ExistingSpan({ children, ...rest }) {
  return <span {...rest}>{children}</span>;
}

function ExistingOption({ children, optionValue, ...rest }) {
  return <option {...rest} value={optionValue}>{children}</option>;
}

/** The old power cell already owns the div and the unit span. */
function PowerValue({ children, ...rest }) {
  return (
    <div {...rest}>
      {children}
      <span className="de-unit"> GW</span>
    </div>
  );
}

/** Keep the register's existing host tag when Value composes with it. */
function MeasuredValue({ valueTag = 'span', ...props }) {
  return <Measured {...props} as={valueTag} data-primitive="measured" />;
}

function EstimatedValue({ valueTag = 'span', ...props }) {
  return <Estimated {...props} as={valueTag} data-primitive="estimated" />;
}

const layout = {
  picker: (space) => ({ marginBottom: space.lg }),
  controls: (space) => ({
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    gap: space.lg,
    padding: `${space.md} 0 ${space.lg}`,
  }),
  control: (space) => ({
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
  }),
  summary: (space) => ({ padding: `${space.md} ${space.lg}` }),
  summaryRow: () => ({ display: 'flex', flexWrap: 'wrap', gap: '18px' }),
  summaryCell: () => ({ minWidth: '110px' }),
  legend: (space) => ({
    display: 'flex',
    flexWrap: 'wrap',
    gap: '14px',
    padding: `${space.md} 0 ${space['2xs']}`,
  }),
  legendItem: () => ({
    display: 'flex',
    alignItems: 'baseline',
    gap: '6px',
    flex: '1 1 280px',
  }),
  notice: () => ({ marginTop: '8px', padding: '6px 8px' }),
  destination: () => ({ marginTop: '10px', padding: '8px 10px' }),
  destinationHead: () => ({
    display: 'flex',
    alignItems: 'baseline',
    gap: '8px',
    marginBottom: '6px',
  }),
  destinationRows: () => ({
    display: 'flex',
    flexWrap: 'wrap',
    gap: '10px',
    marginBottom: '6px',
  }),
  reconcile: () => ({ marginTop: '8px' }),
};

// ---------------------------------------------------------------------------
// Panel-local view state. Sorting and filtering happen here because the whole
// catalogue is already in hand; only a design change costs a fetch.
// ---------------------------------------------------------------------------

const state = defaultViewState();
const listeners = new Set();

function notify() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Assigns into the shared store and wakes every mounted panel. */
function patchState(patch) {
  Object.assign(state, patch);
  notify();
}

function setPayload(payload) {
  state.payload = payload;
  state.loading = false;
  if (payload && payload.selectedDesign) state.designId = payload.selectedDesign.designId;
  notify();
}

function resetViewState() {
  const fresh = defaultViewState();
  state.sort = fresh.sort;
  state.bucket = fresh.bucket;
  state.reactor = fresh.reactor;
  state.search = fresh.search;
  state.thresholds = fresh.thresholds;
  state.limit = fresh.limit;
  notify();
}

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------

function Chip({ text, cls, title }) {
  return <span className={`de-chip ${cls}`} title={title || undefined}>{text}</span>;
}

function DesignPicker({ payload, onChange }) {
  const designs = payload.designs || [];
  return (
    <Box
      component="label"
      className="de-control"
      sx={(theme) => layout.control(theme.initiative.space)}
    >
      <Box component="span" className="de-control__label">DESIGN</Box>
      <select
        className="de-select"
        data-de-design=""
        value={payload.selectedDesign.designId}
        onChange={(event) => onChange(event.target.value)}
      >
        {designs.map((design) => {
          const hulls = num(design.shipsInService);
          return (
            <Value
              key={design.designId}
              as={ExistingOption}
              optionValue={design.designId}
              value={hulls}
              present={hulls !== null}
              format={(raw) => `${design.displayName} — ${raw} hull${raw === 1 ? '' : 's'}`}
              absentLabel={design.displayName}
            />
          );
        })}
      </select>
    </Box>
  );
}

function DesignSummary({ payload }) {
  const design = payload.selectedDesign;
  const fitted = design.fittedDrivePerformance;
  const reactorClass = design.reactor.powerPlantClass;
  const notMeasured = design.baselineMeasured === false;

  return (
    <Box
      className="de-summary"
      sx={(theme) => layout.summary(theme.initiative.space)}
    >
      <Box
        className="de-summary__row"
        sx={(theme) => layout.summaryRow(theme.initiative.space)}
      >
        <Box
          className="de-summary__cell"
          sx={(theme) => layout.summaryCell(theme.initiative.space)}
        >
          <Box component="div" className="de-summary__label">HULL</Box>
          <TextFigure
            as={ExistingDiv}
            className="de-summary__value"
            value={design.hullName}
          />
        </Box>
        <Box
          className="de-summary__cell"
          sx={(theme) => layout.summaryCell(theme.initiative.space)}
        >
          <Box component="div" className="de-summary__label">IN SERVICE</Box>
          <Figure
            as={ExistingDiv}
            className="de-summary__value"
            value={design.shipsInService}
            format={int}
          />
        </Box>
        <Box
          className="de-summary__cell"
          sx={(theme) => layout.summaryCell(theme.initiative.space)}
        >
          <Box component="div" className="de-summary__label">REACTOR</Box>
          <TextFigure
            as={ExistingDiv}
            className="de-summary__value"
            title={design.reactor.resolvedReason || undefined}
            value={reactorClass}
            format={words}
          />
          <Figure
            as={ExistingDiv}
            className="de-summary__sub"
            value={design.reactor.maxOutputGW}
            present={isNumericPresent(design.reactor.maxOutputGW)}
            format={(raw) => `${dec(raw, 1)} GW`}
            absentLabel="output unavailable"
          />
        </Box>
        <Box
          className="de-summary__cell"
          sx={(theme) => layout.summaryCell(theme.initiative.space)}
        >
          <Box component="div" className="de-summary__label">FITTED DRIVE</Box>
          <TextFigure
            as={ExistingDiv}
            className="de-summary__value"
            value={design.fittedDrive.displayName}
          />
          <TextFigure
            as={ExistingDiv}
            className="de-summary__sub"
            value={design.fittedDrive.classification}
            format={words}
          />
        </Box>
        <Box
          className="de-summary__cell de-measured"
          sx={(theme) => layout.summaryCell(theme.initiative.space)}
        >
          <Box component="div" className="de-summary__label">
            FITTED ΔV <span className="de-tag de-tag--measured">MEASURED</span>
          </Box>
          <Box component="div" className="de-summary__value">
            <Figure
              as={MeasuredValue}
              register="de"
              value={fitted.deltaVKps}
              format={(raw) => dec(raw, 2)}
            />
            <span className="de-unit"> km/s</span>
          </Box>
        </Box>
        <Box
          className="de-summary__cell de-measured"
          sx={(theme) => layout.summaryCell(theme.initiative.space)}
        >
          <Box component="div" className="de-summary__label">
            FITTED COMBAT ACCEL <span className="de-tag de-tag--measured">MEASURED</span>
          </Box>
          <Box component="div" className="de-summary__value">
            <Figure
              as={MeasuredValue}
              register="de"
              value={fitted.combatAccelerationMps2}
              format={accel}
            />
            <span className="de-unit"> m/s²</span>
          </Box>
        </Box>
        <Box
          className="de-summary__cell de-measured"
          sx={(theme) => layout.summaryCell(theme.initiative.space)}
        >
          <Box component="div" className="de-summary__label">
            FITTED CRUISE ACCEL <span className="de-tag de-tag--measured">MEASURED</span>
          </Box>
          <Box component="div" className="de-summary__value">
            <Figure
              as={MeasuredValue}
              register="de"
              value={fitted.cruiseAccelerationMps2}
              format={accel}
            />
            <span className="de-unit"> m/s²</span>
          </Box>
          <Box component="div" className="de-summary__sub">
            the baseline every × fitted in the CRUISE ACCEL column is measured against
          </Box>
        </Box>
      </Box>
      {notMeasured && (
        <Box
          className="de-notice de-notice--warn"
          sx={layout.notice}
          title={design.baselineUnmeasuredReason || undefined}
        >
          NO MEASURED BASELINE FOR THIS DESIGN — every ΔV and acceleration below is reported as unavailable rather than guessed. Reactor fit, power draw and research state are still real.
        </Box>
      )}
    </Box>
  );
}

function Legend({ payload }) {
  const model = payload.destinationModel || {};
  const modelled = num(model.destinationsModelled);
  // An unavailable table is NOT "0 destinations are modelled". A confident
  // zero for something that was never evaluated is the exact failure the rest
  // of this panel is built to avoid, so the two states read differently.
  const scope = model.available === true && modelled !== null
    ? `Only ${numberText(modelled, String)} destinations are modelled — a body absent from that list is not an unreachable one.`
    : 'No destination table could be read for this design, so no destination is evaluated here — which is not the same as none being reachable.';
  return (
    <Box className="de-legend" sx={(theme) => layout.legend(theme.initiative.space)}>
      <Box
        className="de-legend__item de-measured"
        sx={(theme) => layout.legendItem(theme.initiative.space)}
      >
        <span className="de-tag de-tag--measured">MEASURED</span>
        <span className="de-legend__text">
          ΔV and acceleration, from the propulsion model held against this hull&apos;s own measured dry mass and tank capacity.
        </span>
      </Box>
      <Box
        className="de-legend__item de-estimate"
        sx={(theme) => layout.legendItem(theme.initiative.space)}
      >
        <span className="de-tag de-tag--estimate">ESTIMATE</span>
        <span className="de-legend__text de-estimate__text">
          {`Destination reachability, from a fixed heuristic ΔV table. Not a measurement. ${scope}`}
        </span>
      </Box>
    </Box>
  );
}

/**
 * What the minimums did, on screen rather than only in the payload.
 *
 * Two things must be visible and are separate facts: a rejected minimum did
 * NOT filter (so the list is wider than the reader typed), and an untestable
 * drive was excluded without having failed (so the list is narrower than the
 * matches alone explain, for a reason that is not a verdict on the drive).
 */
function ThresholdNotice({ outcome }) {
  const rejected = outcome.thresholds.rejected;
  const active = outcome.thresholds.active;
  const blocks = [];

  if (rejected.length > 0) {
    const named = rejected.map((entry) => `${entry.label} = "${entry.value}"`).join('; ');
    blocks.push(
      <Box className="de-notice de-notice--warn" sx={layout.notice} key="rejected">
        {`${named}
        — not a non-negative number, so ${rejected.length === 1 ? 'it was' : 'they were'} IGNORED rather than
        treated as zero. Nothing was filtered on ${rejected.length === 1 ? 'it' : 'them'}.`}
      </Box>
    );
  }

  if (active.length > 0) {
    const summary = active.map((entry) =>
      `${entry.label.replace(/^MIN /, '')} ≥ ${numberText(outcome.thresholds.applied[entry.key], String)}`).join(' AND ');
    const untestable = outcome.untestableCount > 0
      ? `${numberText(outcome.untestableCount)} could NOT be tested — they have no measured value for a filtered column,
           so they are excluded and counted here rather than counted as failures.`
      : 'Every drive in scope had a measured value for every filtered column, so none was excluded as untestable.';
    blocks.push(
      <Box className="de-notice de-notice--filters" sx={layout.notice} key="active">
        {`MINIMUMS ACTIVE: ${summary}. ${numberText(outcome.rows.length)} drive(s) meet them;
        ${numberText(outcome.belowThresholdCount)} were measured and fall short.
        ${untestable}`}
      </Box>
    );
  }

  return <>{blocks}</>;
}

function Controls({ payload, shownCount, outcome }) {
  const matchedCount = outcome.rows.length;
  const census = payload.availabilityCensus || {};
  const reactorCensus = payload.reactorCompatibilityCensus || {};

  // The unit is on the label AND in the placeholder. A bare "> 10" does not
  // say km/s from m/s², and the reader has no way to find out from the box.
  //
  // `type="text"` with `inputmode="decimal"`, deliberately, NOT `type="number"`.
  // A number input returns `''` from `.value` for anything it considers
  // invalid, so typing a leading `-` or a half-finished `1e` silently wipes the
  // field -- and it makes the rejection branch below unreachable in a browser
  // while it stays reachable through the endpoint. Same keypad on mobile, and
  // an honest "that is not a number" instead of a value that vanishes.
  const thresholdControls = THRESHOLDS.map((entry) => (
    <Box
      component="label"
      className="de-control de-control--threshold"
      sx={(theme) => layout.control(theme.initiative.space)}
      key={entry.key}
    >
      <Box component="span" className="de-control__label">{entry.label}</Box>
      <input
        className="de-input de-input--number"
        type="text"
        inputMode="decimal"
        data-de-threshold={entry.key}
        value={state.thresholds[entry.key]}
        placeholder={entry.placeholder}
        aria-label={`Minimum ${entry.measure === 'deltaVKps' ? 'delta-V' : entry.label.toLowerCase()}, in ${entry.unit}`}
        title={`Shows only drives measuring at least this much, in ${entry.unit}. A drive with no measured value for it is excluded and counted separately — it could not be tested, which is not the same as failing.`}
        onChange={(event) => {
          patchState({ thresholds: { ...state.thresholds, [entry.key]: event.target.value } });
        }}
      />
    </Box>
  ));

  return (
    <>
      <Box className="de-controls" sx={(theme) => layout.controls(theme.initiative.space)}>
        <Box
          component="label"
          className="de-control"
          sx={(theme) => layout.control(theme.initiative.space)}
        >
          <Box component="span" className="de-control__label">SORT BY</Box>
          <select
            className="de-select"
            data-de-sort=""
            value={state.sort}
            onChange={(event) => patchState({ sort: event.target.value })}
          >
            {SORTS.map((entry) => (
              <option key={entry.key} value={entry.key}>{entry.label}</option>
            ))}
          </select>
        </Box>
        {thresholdControls}
        <Box
          component="label"
          className="de-control"
          sx={(theme) => layout.control(theme.initiative.space)}
        >
          <Box component="span" className="de-control__label">AVAILABILITY</Box>
          <select
            className="de-select"
            data-de-bucket=""
            value={state.bucket}
            onChange={(event) => patchState({ bucket: event.target.value })}
          >
            <Value
              as={ExistingOption}
              optionValue="all"
              value={payload.driveCatalogue.rated}
              present={isNumericPresent(payload.driveCatalogue.rated)}
              format={(raw) => `ALL AVAILABILITY (${int(raw)})`}
              absentLabel={`ALL AVAILABILITY (${ABSENT_LABEL})`}
            />
            {Object.keys(BUCKETS).map((key) => {
              const count = num(census[key]);
              return (
                <Value
                  key={key}
                  as={ExistingOption}
                  optionValue={key}
                  value={count}
                  present={count !== null}
                  format={(raw) => `${BUCKET_LABEL[key]} (${raw})`}
                  absentLabel={`${BUCKET_LABEL[key]} (${ABSENT_LABEL})`}
                />
              );
            })}
          </select>
        </Box>
        <Box
          component="label"
          className="de-control"
          sx={(theme) => layout.control(theme.initiative.space)}
        >
          <Box component="span" className="de-control__label">REACTOR FIT</Box>
          <select
            className="de-select"
            data-de-reactor=""
            value={state.reactor}
            onChange={(event) => patchState({ reactor: event.target.value })}
          >
            {REACTOR_FILTERS.map((entry) => {
              const count = entry.key === 'all'
                ? num(payload.driveCatalogue.rated)
                : num(reactorCensus[entry.key]);
              return (
                <Value
                  key={entry.key}
                  as={ExistingOption}
                  optionValue={entry.key}
                  value={count}
                  present={count !== null}
                  format={(raw) => `${entry.label} (${raw})`}
                  absentLabel={`${entry.label} (${ABSENT_LABEL})`}
                />
              );
            })}
          </select>
        </Box>
        <Box
          component="label"
          className="de-control"
          sx={(theme) => layout.control(theme.initiative.space)}
        >
          <Box component="span" className="de-control__label">SEARCH</Box>
          <input
            className="de-input"
            type="search"
            data-de-search=""
            value={state.search}
            placeholder="drive, class or propellant"
            onChange={(event) => patchState({ search: event.target.value })}
          />
        </Box>
        <Box
          component="label"
          className="de-control"
          sx={(theme) => layout.control(theme.initiative.space)}
        >
          <Box component="span" className="de-control__label">ROWS SHOWN</Box>
          <select
            className="de-select"
            data-de-rows=""
            value={String(state.limit)}
            onChange={(event) => patchState({ limit: Number(event.target.value) || 120 })}
          >
            {ROW_CAPS.map((cap) => (
              <option key={cap} value={String(cap)}>{cap >= 1000 ? 'ALL' : String(cap)}</option>
            ))}
          </select>
        </Box>
        <Box
          className="de-control de-control--count"
          sx={(theme) => layout.control(theme.initiative.space)}
        >
          <Box component="span" className="de-control__label">SHOWING</Box>
          <Value
            as={ExistingSpan}
            className="de-count"
            data-de-count=""
            value={shownCount}
            present={isNumericPresent(shownCount)
              && isNumericPresent(matchedCount)
              && isNumericPresent(payload.driveCatalogue.total)}
            format={(raw) => `${int(raw)} of ${int(matchedCount)} matched · ${int(payload.driveCatalogue.total)} in catalogue`}
            absentLabel={`${numberText(shownCount)} of ${numberText(matchedCount)} matched · ${numberText(payload.driveCatalogue.total)} in catalogue`}
          />
        </Box>
      </Box>
      <ThresholdNotice outcome={outcome} />
    </>
  );
}

function ReactorCell({ row, payload }) {
  const designClass = payload.selectedDesign.reactor.powerPlantClass;
  if (row.reactor.compatible === true) {
    return (
      <td className="de-cell de-cell--reactor">
        <Chip
          text="FITS"
          cls="de-chip--ok"
          title={`This drive accepts ${row.reactor.requiredPowerPlant === 'Any_General' ? 'any reactor class' : `the ${String(row.reactor.requiredPowerPlant).replace(/_/g, ' ')} class`}, which this design's reactor provides.`}
        />
      </td>
    );
  }
  if (row.reactor.compatible === false) {
    return (
      <td className="de-cell de-cell--reactor">
        <Chip
          text={`NEEDS ${String(row.reactor.requiredPowerPlant || '').replace(/_/g, ' ').toUpperCase()}`}
          cls="de-chip--block"
          title={`Not an option on this design. It requires a ${String(row.reactor.requiredPowerPlant).replace(/_/g, ' ')} reactor and this design carries ${designClass ? String(designClass).replace(/_/g, ' ') : 'an unrecorded reactor class'}.`}
        />
      </td>
    );
  }
  return (
    <td className="de-cell de-cell--reactor">
      <Chip
        text="UNKNOWN"
        cls="de-chip--unknown"
        title={'Reactor compatibility could not be evaluated: either the drive states no required class or this design\'s reactor class is not recorded in this snapshot. Unknown is not the same as compatible.'}
      />
    </td>
  );
}

function AvailabilityCell({ row }) {
  const bucket = row.availability.bucket;
  const cls = bucket === BUCKETS.fittable ? 'de-chip--ok'
    : bucket === BUCKETS.researchable ? 'de-chip--warn'
      : bucket === BUCKETS.never ? 'de-chip--block' : 'de-chip--unknown';
  const chainCost = num(row.availability.chainRemainingResearchCost);
  const costLabel = bucket === BUCKETS.researchable
    ? (row.availability.chainCostComplete === false
      ? 'chain cost incomplete — a step in it is never researched'
      : (chainCost === null ? 'chain cost unavailable' : `${numberText(chainCost)} RP over ${numberText(row.availability.chainSteps)} step(s)`))
    : '';
  return (
    <td className="de-cell de-cell--availability">
      <Chip text={BUCKET_LABEL[bucket] || 'UNKNOWN'} cls={cls} title={BUCKET_TITLE[bucket] || ''} />
      {costLabel ? <Box component="div" className="de-cell__sub">{costLabel}</Box> : null}
    </td>
  );
}

function DriveRow({ row, payload, onOpenPath }) {
  const measured = row.measured;
  const estimate = row.estimatedDestinations;
  const uncomputable = measured.computable !== true;
  const opened = Array.isArray(estimate.opensUp) ? estimate.opensUp : [];
  const classification = valueText(row.classification, words);
  const propellant = valueText(row.propellant, words);

  // Cruise is checked on its own value, not on the row's `computable` flag: a
  // row can be computable overall and still carry a null cruise acceleration
  // (shared/propulsion.mjs and shared/intel/driveExplorer.mjs both set it to
  // null on their own paths), and that cell must read as unavailable rather
  // than borrowing the row's verdict.
  const cruiseUnavailable = num(measured.cruiseAccelerationMps2) === null;
  const cruiseTitle = cruiseUnavailable
    ? (measured.reason
      || 'this drive has no measured cruise acceleration against this design — unavailable, which is not the same as zero')
    : undefined;
  const uncomputableTitle = uncomputable
    ? (measured.reason || 'not computable against this design')
    : undefined;

  const rowClass = `de-row${row.isFittedDrive ? ' de-row--fitted' : ''}${uncomputable ? ' de-row--uncomputable' : ''}`;

  // The name is a real <button>, not a tabindex on the <tr>: the row keeps its
  // row semantics for assistive technology while the control that opens the
  // path modal is a control. Mouse users get the whole row (see the row
  // handler); keyboard users get this, in the tab order, with an accessible
  // name.
  return (
    <tr
      className={rowClass}
      data-de-drive={row.driveId}
      onClick={(event) => {
        const button = event.target.closest('[data-de-path]');
        const tableRow = event.target.closest('[data-de-drive]');
        const driveId = button?.getAttribute('data-de-path') || tableRow?.getAttribute('data-de-drive');
        if (!driveId) return;
        event.preventDefault();
        onOpenPath(driveId, button || (tableRow && tableRow.querySelector('[data-de-path]')));
      }}
    >
      <td className="de-cell de-cell--name">
        <button
          type="button"
          className="de-name-btn"
          data-de-path={row.driveId}
          aria-label={`${row.displayName || row.driveId}: show the research path that unlocks this drive`}
          title="Show the global techs and faction projects that unlock this drive, and which of them are already done."
        >
          <span className="de-name">{row.displayName || row.driveId}</span>
        </button>
        <div className="de-cell__sub">
          {`${classification} · ${propellant} `}
          {row.isFittedDrive && (
            <span
              className="de-caveat de-caveat--fitted"
              title="The drive currently fitted to this design. Every multiple in this table is measured against it."
            >FITTED</span>
          )}
          {row.disabledInTemplates && (
            <span
              className="de-caveat de-caveat--muted"
              title="This drive is disabled in the shipped game templates and cannot be built. It is listed so the catalogue count reconciles."
            >DISABLED</span>
          )}
          {measured.dryMassCaveat && (
            <span className="de-caveat" title={measured.dryMassCaveat}>MASS CAVEAT</span>
          )}
        </div>
      </td>
      <td className="de-cell de-measured de-cell--number de-cell--dv" title={uncomputableTitle}>
        <Figure
          as={MeasuredValue}
          valueTag="div"
          register="de"
          value={measured.deltaVKps}
          format={(raw) => dec(raw, 2)}
        />
        <Figure
          as={ExistingDiv}
          className="de-cell__sub"
          value={measured.deltaVMultipleVsFitted}
          present={!uncomputable && isNumericPresent(measured.deltaVMultipleVsFitted)}
          format={(raw) => `${mult(raw)} fitted`}
          absentLabel={uncomputable ? 'UNAVAILABLE' : `${ABSENT_LABEL} fitted`}
        />
      </td>
      <td className="de-cell de-measured de-cell--number" title={uncomputableTitle}>
        <Figure
          as={MeasuredValue}
          valueTag="div"
          register="de"
          value={measured.combatAccelerationMps2}
          format={accel}
        />
        <Figure
          as={ExistingDiv}
          className="de-cell__sub"
          value={measured.combatAccelerationMultipleVsFitted}
          present={!uncomputable && isNumericPresent(measured.combatAccelerationMultipleVsFitted)}
          format={(raw) => `${mult(raw)} fitted`}
          absentLabel={uncomputable ? 'UNAVAILABLE' : `${ABSENT_LABEL} fitted`}
        />
      </td>
      <td className="de-cell de-measured de-cell--number" title={cruiseTitle}>
        <Figure
          as={MeasuredValue}
          valueTag="div"
          register="de"
          value={measured.cruiseAccelerationMps2}
          format={accel}
        />
        <Figure
          as={ExistingDiv}
          className="de-cell__sub"
          value={measured.cruiseAccelerationMultipleVsFitted}
          present={!cruiseUnavailable && isNumericPresent(measured.cruiseAccelerationMultipleVsFitted)}
          format={(raw) => `${mult(raw)} fitted`}
          absentLabel={cruiseUnavailable ? 'UNAVAILABLE' : `${ABSENT_LABEL} fitted`}
        />
      </td>
      <ReactorCell row={row} payload={payload} />
      <td
        className="de-cell de-cell--number de-cell--power"
        title="Power draw is information, never a veto: the game scales thrust by min(1, plant output / required draw) rather than refusing an underpowered design. The acceleration figures in this table do not have that scaling applied."
      >
        <Figure
          as={PowerValue}
          value={row.power.driveDrawGW}
          format={power}
        />
        <Figure
          as={ExistingDiv}
          className="de-cell__sub"
          value={row.power.thrustScalingFactor}
          format={(raw) => `thrust ×${dec(raw, 3)}`}
          absentLabel="scaling unavailable"
        />
      </td>
      <AvailabilityCell row={row} />
      <td className="de-cell de-estimate de-cell--estimate">
        <Figure
          as={EstimatedValue}
          valueTag="div"
          register="de"
          value={estimate.reachableCount}
          present={estimate.evaluated === true && isNumericPresent(estimate.reachableCount)}
          format={(raw) => `${int(raw)} reachable`}
          absentLabel={estimate.evaluated === true ? `${ABSENT_LABEL} reachable` : 'NOT EVALUATED'}
          note={opened.length > 0
            ? `opens ${opened.join(', ')}`
            : (estimate.evaluated === true ? 'opens nothing new' : (estimate.reason || 'no destination table'))}
        />
      </td>
    </tr>
  );
}

function DriveTable({ payload, rows, outcome, onOpenPath }) {
  if (rows.length === 0) {
    const untestable = outcome && outcome.untestableCount > 0
      ? ` ${numberText(outcome.untestableCount)} drive(s) could not be tested against the active minimums — they carry no measured value for a filtered column, so they are excluded rather than failed.`
      : '';
    return (
      <Box className="de-notice" sx={layout.notice}>
        {`No drive matches the current filters. ${numberText(payload.driveCatalogue.rated)} drives are rated in this catalogue; widen the filters to see them.${untestable}`}
      </Box>
    );
  }

  // The <thead> is authored here rather than handed to DataTable as `columns`
  // because two of the measured headers carry a `title` explaining what the
  // figure is NOT, and that caveat is the point of having both columns.
  return (
    <DataTable variant="de" hintText={SCROLL_HINT_TEXT}>
      <thead>
        <tr>
          <th className="de-th">DRIVE</th>
          <th className="de-th de-th--measured">ΔV km/s<span className="de-th__caption">MEASURED</span></th>
          <th
            className="de-th de-th--measured"
            title="Peak acceleration in combat: thrust at the drive's own thrustCap multiplier. It is NOT the acceleration a transfer burn sustains — see CRUISE ACCEL."
          >COMBAT ACCEL m/s²<span className="de-th__caption">MEASURED</span></th>
          <th
            className="de-th de-th--measured"
            title="Sustained acceleration outside combat: thrust at 1x, which is what a transfer burn actually gets. Combat divided by cruise is exactly this drive's thrustCap, and only 72 of 541 drives have the two equal."
          >CRUISE ACCEL m/s²<span className="de-th__caption">MEASURED</span></th>
          <th className="de-th">REACTOR</th>
          <th className="de-th">POWER DRAW</th>
          <th className="de-th">AVAILABILITY</th>
          <th className="de-th de-th--estimate">
            DESTINATIONS
            <span className="de-th__caption de-th__caption--estimate">{ESTIMATE_CAPTION}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <DriveRow key={row.driveId} row={row} payload={payload} onOpenPath={onOpenPath} />
        ))}
      </tbody>
    </DataTable>
  );
}

function Footer({ payload, shownCount, outcome }) {
  const matchedCount = outcome.rows.length;
  const unresolved = Array.isArray(payload.unresolvedDrives) ? payload.unresolvedDrives : [];
  // A cap announces itself, and it announces the control that lifts it.
  const omitted = Math.max(0, matchedCount - shownCount);
  const model = payload.destinationModel || {};
  const destinationList = Array.isArray(model.destinations) ? model.destinations : [];

  const destinationTable = model.available
    ? (
      <Box
        className="de-estimate de-destination-table"
        sx={layout.destination}
      >
        <Box className="de-destination-table__head" sx={layout.destinationHead}>
          <span className="de-tag de-tag--estimate">ESTIMATE</span>
          <span className="de-estimate__text">
            {`Modelled destinations from ${model.origin || 'this fleet\'s current orbit'} — ${numberText(destinationList.length, String)} of them, and no others.`}
          </span>
        </Box>
        <Box className="de-destination-table__rows" sx={layout.destinationRows}>
          {destinationList.map((entry) => (
            <span className="de-destination" key={entry.destination}>
              {`${entry.destination} `}
              <Value
                as={ExistingSpan}
                className="de-destination__dv"
                value={entry.deltaVRequired}
                present={isNumericPresent(entry.deltaVRequired)}
                format={(raw) => `${dec(raw, 1)} km/s`}
              />
            </span>
          ))}
        </Box>
        <Box component="div" className="de-estimate__text">{model.travelDaysBasis || ''}</Box>
      </Box>
    )
    : (
      <Box className="de-notice" sx={layout.notice}>
        {`Destination estimates unavailable: ${model.reason || 'no destination table for this design'}.`}
      </Box>
    );

  const unresolvedBlock = unresolved.length > 0
    ? (
      <Box className="de-notice de-notice--warn" sx={layout.notice}>
        {`${numberText(unresolved.length)} drive(s) were dropped because their availability could not be resolved, each with its reason:`}
        <ul className="de-unresolved">
          {unresolved.slice(0, 20).map((entry) => (
            <li key={entry.driveId} title={entry.reason}>{entry.displayName || entry.driveId}</li>
          ))}
        </ul>
        {unresolved.length > 20 && (
          <Box component="div">
            {`${numberText(unresolved.length - 20)} further unresolved drive(s) not listed here; the full set is on /api/intel/drive-explorer.`}
          </Box>
        )}
      </Box>
    )
    : null;

  const thresholdTail = outcome.thresholds.active.length > 0
    ? `Of the rest, ${numberText(outcome.belowThresholdCount)} were measured and fell below an active minimum and
       ${numberText(outcome.untestableCount)} could not be tested at all — an untestable drive is excluded, never counted as a failure.`
    : '';

  return (
    <>
      {destinationTable}
      {unresolvedBlock}
      <Box className="de-reconcile" sx={layout.reconcile}>
        {`${numberText(payload.driveCatalogue.total)} drives in the catalogue = ${numberText(payload.driveCatalogue.rated)} rated + ${numberText(payload.unresolvedCount)} unresolved.
        ${numberText(matchedCount)} match the current filters, ${numberText(shownCount)} shown${omitted > 0 ? `, ${numberText(omitted)} omitted by the ${numberText(state.limit)}-row display cap — raise it with ROWS SHOWN` : ''}.
        ${thresholdTail}
        ${numberText(payload.driveCatalogue.disabledInTemplates)} of them are disabled in the shipped templates and cannot be built.`}
      </Box>
    </>
  );
}

function UnavailableCard({ message, status = 'UNAVAILABLE' }) {
  return (
    <ThemeProvider theme={initiativeTheme}>
      <Panel className="init-view__span" title="DRIVE EXPLORER" headerAside={status}>
        <Box
          className={status === 'LOADING' ? 'de-notice' : 'de-notice de-notice--warn'}
          sx={layout.notice}
        >
          {message}
        </Box>
      </Panel>
    </ThemeProvider>
  );
}

// ---------------------------------------------------------------------------
// The path modal: click a drive, see what unlocks it.
// ---------------------------------------------------------------------------

const pathCache = new Map();

async function fetchTechPath(target) {
  const key = `${state.observer}|${state.mode}|${target}`;
  if (pathCache.has(key)) return pathCache.get(key);
  const params = new URLSearchParams({
    observer: String(state.observer),
    mode: String(state.mode),
    target: String(target)
  });
  try {
    const response = await fetch(`/api/intel/tech-path?${params.toString()}`);
    if (!response.ok) {
      // Unavailable is not empty. The reason travels so the modal can say it.
      const failed = { unavailable: true, reason: `The tech-path endpoint returned HTTP ${response.status}.` };
      pathCache.set(key, failed);
      return failed;
    }
    const payload = await response.json();
    pathCache.set(key, payload);
    return payload;
  } catch (err) {
    console.warn('[DriveExplorer] Failed to fetch tech path:', err);
    return { unavailable: true, reason: 'The tech-path endpoint could not be reached from this browser.' };
  }
}

/** Opens the modal for one drive row. Every branch opens SOMETHING. */
export async function openDrivePath(driveId, trigger) {
  const panel = typeof window !== 'undefined' ? window.MissionControlDetailPanel : null;
  if (!panel || typeof panel.open !== 'function') return;
  const payloadRows = (state.payload && state.payload.items) || [];
  const row = payloadRows.find(entry => entry.driveId === driveId);
  if (!row) return;

  const gateId = row.availability.gateProjectId;

  if (!gateId) {
    // Ungated is a fact about the drive, not a missing value.
    panel.open(ungatedPanelOptions(row));
    return;
  }

  if (trigger) trigger.setAttribute('aria-busy', 'true');
  const payload = await fetchTechPath(gateId);
  if (trigger) trigger.removeAttribute('aria-busy');
  panel.open(pathPanelOptions(row, payload, resolveValue));
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

/**
 * @param {object} props
 * @param {object|null} [props.payload] — seeds the shared store on mount. Once
 *   seeded the store is the source of truth, so the harness and
 *   scripts/verify_drive_explorer.js can drive the panel the same way.
 */
export function DriveExplorer({ payload }) {
  const [, bump] = React.useReducer((tick) => tick + 1, 0);

  React.useEffect(() => subscribe(bump), []);

  React.useLayoutEffect(() => {
    if (payload === undefined) return;
    setPayload(payload);
  }, [payload]);

  const active = state.payload;

  if (state.loading) {
    return (
      <UnavailableCard
        status="LOADING"
        message="Rating every drive in the catalogue against this design…"
      />
    );
  }
  if (!active) {
    return <UnavailableCard message="Drive explorer data could not be loaded from /api/intel/drive-explorer." />;
  }
  if (!active.driveCatalogue || !active.driveCatalogue.available || !active.selectedDesign) {
    return (
      <UnavailableCard
        message={active.reason
          || (active.driveCatalogue && active.driveCatalogue.reason)
          || 'No drive catalogue or observer ship design is present in this snapshot.'}
      />
    );
  }

  const outcome = visibleRows(active.items || [], state);
  const sorted = sortRows(outcome.rows, state.sort);
  const capped = sorted.slice(0, state.limit);
  // The fitted drive survives the display cap whenever the current filters
  // still admit it: every multiple in the table is measured against that row,
  // and a baseline you cannot see is a baseline you cannot check.
  const fittedRow = sorted.find((row) => row.isFittedDrive) || null;
  const shown = (fittedRow && capped.indexOf(fittedRow) === -1) ? [fittedRow, ...capped] : capped;

  return (
    <ThemeProvider theme={initiativeTheme}>
      <Panel className="init-view__span" title="DRIVE EXPLORER" headerAside={active.selectedDesign.displayName}>
        <Box className="de-picker" sx={(theme) => layout.picker(theme.initiative.space)}>
          <DesignPicker
            payload={active}
            onChange={(designId) => {
              // A different design is a different measured baseline, so it is the
              // one control that costs a fetch.
              state.designId = designId;
              loadDriveExplorer(state.observer, state.mode, state.container, designId);
            }}
          />
        </Box>
        <DesignSummary payload={active} />
        <Legend payload={active} />
        <Controls payload={active} shownCount={shown.length} outcome={outcome} />
        <DriveTable payload={active} rows={shown} outcome={outcome} onOpenPath={openDrivePath} />
        <Footer payload={active} shownCount={shown.length} outcome={outcome} />
      </Panel>
    </ThemeProvider>
  );
}

// ---------------------------------------------------------------------------
// Fetch + strangler bridge
// ---------------------------------------------------------------------------

export async function fetchDriveExplorer(observerId, mode, designId) {
  const params = new URLSearchParams({
    observer: String(observerId),
    mode: String(mode),
    // The whole catalogue in one response is what makes client-side sorting
    // and filtering possible; the compact row shape is what makes it small
    // enough to do that.
    detail: 'summary',
    limit: '1000'
  });
  if (designId) params.set('design', String(designId));
  try {
    const response = await fetch(`/api/intel/drive-explorer?${params.toString()}`);
    if (!response.ok) return null;
    return await response.json();
  } catch (err) {
    console.warn('[DriveExplorer] Failed to fetch drive explorer data:', err);
    return null;
  }
}

/**
 * The mount function, injected by main.jsx so this module carries no import
 * cycle back to the entry point. One mount is enough: the panel subscribes to
 * the store, so every later change re-renders the instance already there.
 */
let mountPanel = null;
export function setDriveExplorerMount(fn) { mountPanel = fn; }

/** Renders an already-fetched payload into `container`. */
export function renderDriveExplorer(container, payload) {
  if (!container) return;
  state.container = container;
  state.loading = false;
  if (mountPanel) mountPanel(container, <DriveExplorer />);
  setPayload(payload);
}

/**
 * Fetches and paints. Called on first activation of the DRIVES view and
 * whenever the observer or mode changes while it is active, rather than on
 * every dashboard load: the catalogue response is the largest on the site and
 * nothing else on the page needs it.
 */
export async function loadDriveExplorer(observerId, mode, container, designId) {
  if (!container) return null;
  // A design id belongs to one observer. Carrying it across an observer
  // change would ask for a design this faction does not own and get an
  // "unavailable" panel for no reason, so it is cleared rather than reused.
  if (!designId && (state.observer !== observerId || state.mode !== mode)) {
    state.designId = null;
  }
  state.container = container;
  state.observer = observerId;
  state.mode = mode;
  state.loading = true;
  if (mountPanel) mountPanel(container, <DriveExplorer />);
  notify();

  const payload = await fetchDriveExplorer(observerId, mode, designId || state.designId);
  state.loading = false;
  setPayload(payload);
  return payload;
}

/**
 * Exposed so the layout verifier and the unit tests exercise the same
 * filtering, sorting and path-modal shaping the panel does, rather than a
 * copy of it.
 */
export const driveExplorerInternals = {
  state,
  visibleRows: (items) => visibleRows(items, state),
  sortRows: (rows) => sortRows(rows, state.sort),
  pathPanelOptions,
  inDependencyOrder,
  rp,
  accel,
  parseThreshold,
  BUCKETS,
  THRESHOLDS,
  ESTIMATE_CAPTION,
  // Test-only handles. The store is the panel's source of truth, so a browser
  // test drives it the same way a click does rather than re-mounting.
  setPayload,
  patchState,
  resetViewState,
  subscribe,
};
