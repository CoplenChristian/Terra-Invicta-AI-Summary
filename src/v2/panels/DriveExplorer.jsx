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
import { DataTable, Measured, Estimated } from '../components/index.js';
import { Panel } from '../components/Panel.jsx';
import {
  UNAVAILABLE,
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
    <label className="de-control">
      <span className="de-control__label">DESIGN</span>
      <select
        className="de-select"
        data-de-design=""
        value={payload.selectedDesign.designId}
        onChange={(event) => onChange(event.target.value)}
      >
        {designs.map((design) => {
          const hulls = num(design.shipsInService);
          const suffix = hulls === null ? '' : ` — ${hulls} hull${hulls === 1 ? '' : 's'}`;
          return (
            <option key={design.designId} value={design.designId}>
              {`${design.displayName}${suffix}`}
            </option>
          );
        })}
      </select>
    </label>
  );
}

function DesignSummary({ payload }) {
  const design = payload.selectedDesign;
  const fitted = design.fittedDrivePerformance;
  const reactorClass = design.reactor.powerPlantClass;
  const notMeasured = design.baselineMeasured === false;

  return (
    <div className="de-summary">
      <div className="de-summary__row">
        <div className="de-summary__cell">
          <div className="de-summary__label">HULL</div>
          <div className="de-summary__value">{design.hullName || UNAVAILABLE}</div>
        </div>
        <div className="de-summary__cell">
          <div className="de-summary__label">IN SERVICE</div>
          <div className="de-summary__value">{int(design.shipsInService)}</div>
        </div>
        <div className="de-summary__cell">
          <div className="de-summary__label">REACTOR</div>
          <div className="de-summary__value" title={design.reactor.resolvedReason || undefined}>
            {words(reactorClass)}
          </div>
          <div className="de-summary__sub">
            {num(design.reactor.maxOutputGW) === null
              ? 'output unavailable'
              : `${dec(design.reactor.maxOutputGW, 1)} GW`}
          </div>
        </div>
        <div className="de-summary__cell">
          <div className="de-summary__label">FITTED DRIVE</div>
          <div className="de-summary__value">{design.fittedDrive.displayName || UNAVAILABLE}</div>
          <div className="de-summary__sub">{words(design.fittedDrive.classification)}</div>
        </div>
        <div className="de-summary__cell de-measured">
          <div className="de-summary__label">
            FITTED ΔV <span className="de-tag de-tag--measured">MEASURED</span>
          </div>
          <div className="de-summary__value">
            <Measured register="de" value={dec(fitted.deltaVKps, 2)} />
            <span className="de-unit"> km/s</span>
          </div>
        </div>
        <div className="de-summary__cell de-measured">
          <div className="de-summary__label">
            FITTED COMBAT ACCEL <span className="de-tag de-tag--measured">MEASURED</span>
          </div>
          <div className="de-summary__value">
            <Measured register="de" value={accel(fitted.combatAccelerationMps2)} />
            <span className="de-unit"> m/s²</span>
          </div>
        </div>
        <div className="de-summary__cell de-measured">
          <div className="de-summary__label">
            FITTED CRUISE ACCEL <span className="de-tag de-tag--measured">MEASURED</span>
          </div>
          <div className="de-summary__value">
            <Measured register="de" value={accel(fitted.cruiseAccelerationMps2)} />
            <span className="de-unit"> m/s²</span>
          </div>
          <div className="de-summary__sub">
            the baseline every × fitted in the CRUISE ACCEL column is measured against
          </div>
        </div>
      </div>
      {notMeasured && (
        <div className="de-notice de-notice--warn" title={design.baselineUnmeasuredReason || undefined}>
          NO MEASURED BASELINE FOR THIS DESIGN — every ΔV and acceleration below is reported as unavailable rather than guessed. Reactor fit, power draw and research state are still real.
        </div>
      )}
    </div>
  );
}

function Legend({ payload }) {
  const model = payload.destinationModel || {};
  const modelled = num(model.destinationsModelled);
  // An unavailable table is NOT "0 destinations are modelled". A confident
  // zero for something that was never evaluated is the exact failure the rest
  // of this panel is built to avoid, so the two states read differently.
  const scope = model.available === true && modelled !== null
    ? `Only ${String(modelled)} destinations are modelled — a body absent from that list is not an unreachable one.`
    : 'No destination table could be read for this design, so no destination is evaluated here — which is not the same as none being reachable.';
  return (
    <div className="de-legend">
      <div className="de-legend__item de-measured">
        <span className="de-tag de-tag--measured">MEASURED</span>
        <span className="de-legend__text">
          ΔV and acceleration, from the propulsion model held against this hull&apos;s own measured dry mass and tank capacity.
        </span>
      </div>
      <div className="de-legend__item de-estimate">
        <span className="de-tag de-tag--estimate">ESTIMATE</span>
        <span className="de-legend__text de-estimate__text">
          {`Destination reachability, from a fixed heuristic ΔV table. Not a measurement. ${scope}`}
        </span>
      </div>
    </div>
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
      <div className="de-notice de-notice--warn" key="rejected">
        {`${named}
        — not a non-negative number, so ${rejected.length === 1 ? 'it was' : 'they were'} IGNORED rather than
        treated as zero. Nothing was filtered on ${rejected.length === 1 ? 'it' : 'them'}.`}
      </div>
    );
  }

  if (active.length > 0) {
    const summary = active.map((entry) =>
      `${entry.label.replace(/^MIN /, '')} ≥ ${String(outcome.thresholds.applied[entry.key])}`).join(' AND ');
    const untestable = outcome.untestableCount > 0
      ? `${int(outcome.untestableCount)} could NOT be tested — they have no measured value for a filtered column,
           so they are excluded and counted here rather than counted as failures.`
      : 'Every drive in scope had a measured value for every filtered column, so none was excluded as untestable.';
    blocks.push(
      <div className="de-notice de-notice--filters" key="active">
        {`MINIMUMS ACTIVE: ${summary}. ${int(outcome.rows.length)} drive(s) meet them;
        ${int(outcome.belowThresholdCount)} were measured and fall short.
        ${untestable}`}
      </div>
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
    <label className="de-control de-control--threshold" key={entry.key}>
      <span className="de-control__label">{entry.label}</span>
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
    </label>
  ));

  return (
    <>
      <div className="de-controls">
        <label className="de-control">
          <span className="de-control__label">SORT BY</span>
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
        </label>
        {thresholdControls}
        <label className="de-control">
          <span className="de-control__label">AVAILABILITY</span>
          <select
            className="de-select"
            data-de-bucket=""
            value={state.bucket}
            onChange={(event) => patchState({ bucket: event.target.value })}
          >
            <option value="all">{`ALL AVAILABILITY (${int(payload.driveCatalogue.rated)})`}</option>
            {Object.keys(BUCKETS).map((key) => {
              const count = num(census[key]);
              return (
                <option key={key} value={key}>
                  {`${BUCKET_LABEL[key]} (${count === null ? UNAVAILABLE : count})`}
                </option>
              );
            })}
          </select>
        </label>
        <label className="de-control">
          <span className="de-control__label">REACTOR FIT</span>
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
                <option key={entry.key} value={entry.key}>
                  {`${entry.label} (${count === null ? UNAVAILABLE : count})`}
                </option>
              );
            })}
          </select>
        </label>
        <label className="de-control">
          <span className="de-control__label">SEARCH</span>
          <input
            className="de-input"
            type="search"
            data-de-search=""
            value={state.search}
            placeholder="drive, class or propellant"
            onChange={(event) => patchState({ search: event.target.value })}
          />
        </label>
        <label className="de-control">
          <span className="de-control__label">ROWS SHOWN</span>
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
        </label>
        <div className="de-control de-control--count">
          <span className="de-control__label">SHOWING</span>
          <span className="de-count" data-de-count="">
            {`${int(shownCount)} of ${int(matchedCount)} matched · ${int(payload.driveCatalogue.total)} in catalogue`}
          </span>
        </div>
      </div>
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
      : (chainCost === null ? 'chain cost unavailable' : `${int(chainCost)} RP over ${int(row.availability.chainSteps)} step(s)`))
    : '';
  return (
    <td className="de-cell de-cell--availability">
      <Chip text={BUCKET_LABEL[bucket] || 'UNKNOWN'} cls={cls} title={BUCKET_TITLE[bucket] || ''} />
      {costLabel ? <div className="de-cell__sub">{costLabel}</div> : null}
    </td>
  );
}

function DriveRow({ row, payload, onOpenPath }) {
  const measured = row.measured;
  const estimate = row.estimatedDestinations;
  const uncomputable = measured.computable !== true;
  const opened = Array.isArray(estimate.opensUp) ? estimate.opensUp : [];

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
          {`${words(row.classification)} · ${words(row.propellant)} `}
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
        <Measured register="de" as="div" value={dec(measured.deltaVKps, 2)} />
        <div className="de-cell__sub">
          {uncomputable ? 'UNAVAILABLE' : `${mult(measured.deltaVMultipleVsFitted)} fitted`}
        </div>
      </td>
      <td className="de-cell de-measured de-cell--number" title={uncomputableTitle}>
        <Measured register="de" as="div" value={accel(measured.combatAccelerationMps2)} />
        <div className="de-cell__sub">
          {uncomputable ? 'UNAVAILABLE' : `${mult(measured.combatAccelerationMultipleVsFitted)} fitted`}
        </div>
      </td>
      <td className="de-cell de-measured de-cell--number" title={cruiseTitle}>
        <Measured register="de" as="div" value={accel(measured.cruiseAccelerationMps2)} />
        <div className="de-cell__sub">
          {cruiseUnavailable ? 'UNAVAILABLE' : `${mult(measured.cruiseAccelerationMultipleVsFitted)} fitted`}
        </div>
      </td>
      <ReactorCell row={row} payload={payload} />
      <td
        className="de-cell de-cell--number de-cell--power"
        title="Power draw is information, never a veto: the game scales thrust by min(1, plant output / required draw) rather than refusing an underpowered design. The acceleration figures in this table do not have that scaling applied."
      >
        <div>{power(row.power.driveDrawGW)}<span className="de-unit"> GW</span></div>
        <div className="de-cell__sub">
          {num(row.power.thrustScalingFactor) === null
            ? 'scaling unavailable'
            : `thrust ×${dec(row.power.thrustScalingFactor, 3)}`}
        </div>
      </td>
      <AvailabilityCell row={row} />
      <td className="de-cell de-estimate de-cell--estimate">
        <Estimated
          register="de"
          as="div"
          value={estimate.evaluated === true ? `${int(estimate.reachableCount)} reachable` : 'NOT EVALUATED'}
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
      ? ` ${String(outcome.untestableCount)} drive(s) could not be tested against the active minimums — they carry no measured value for a filtered column, so they are excluded rather than failed.`
      : '';
    return (
      <div className="de-notice">
        {`No drive matches the current filters. ${String(payload.driveCatalogue.rated)} drives are rated in this catalogue; widen the filters to see them.${untestable}`}
      </div>
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
      <div className="de-estimate de-destination-table">
        <div className="de-destination-table__head">
          <span className="de-tag de-tag--estimate">ESTIMATE</span>
          <span className="de-estimate__text">
            {`Modelled destinations from ${model.origin || 'this fleet\'s current orbit'} — ${String(destinationList.length)} of them, and no others.`}
          </span>
        </div>
        <div className="de-destination-table__rows">
          {destinationList.map((entry) => (
            <span className="de-destination" key={entry.destination}>
              {`${entry.destination} `}
              <span className="de-destination__dv">{`${dec(entry.deltaVRequired, 1)} km/s`}</span>
            </span>
          ))}
        </div>
        <div className="de-estimate__text">{model.travelDaysBasis || ''}</div>
      </div>
    )
    : (
      <div className="de-notice">
        {`Destination estimates unavailable: ${model.reason || 'no destination table for this design'}.`}
      </div>
    );

  const unresolvedBlock = unresolved.length > 0
    ? (
      <div className="de-notice de-notice--warn">
        {`${String(unresolved.length)} drive(s) were dropped because their availability could not be resolved, each with its reason:`}
        <ul className="de-unresolved">
          {unresolved.slice(0, 20).map((entry) => (
            <li key={entry.driveId} title={entry.reason}>{entry.displayName || entry.driveId}</li>
          ))}
        </ul>
        {unresolved.length > 20 && (
          <div>
            {`${String(unresolved.length - 20)} further unresolved drive(s) not listed here; the full set is on /api/intel/drive-explorer.`}
          </div>
        )}
      </div>
    )
    : null;

  const thresholdTail = outcome.thresholds.active.length > 0
    ? `Of the rest, ${int(outcome.belowThresholdCount)} were measured and fell below an active minimum and
       ${int(outcome.untestableCount)} could not be tested at all — an untestable drive is excluded, never counted as a failure.`
    : '';

  return (
    <>
      {destinationTable}
      {unresolvedBlock}
      <div className="de-reconcile">
        {`${int(payload.driveCatalogue.total)} drives in the catalogue = ${int(payload.driveCatalogue.rated)} rated + ${int(payload.unresolvedCount)} unresolved.
        ${int(matchedCount)} match the current filters, ${int(shownCount)} shown${omitted > 0 ? `, ${int(omitted)} omitted by the ${int(state.limit)}-row display cap — raise it with ROWS SHOWN` : ''}.
        ${thresholdTail}
        ${int(payload.driveCatalogue.disabledInTemplates)} of them are disabled in the shipped templates and cannot be built.`}
      </div>
    </>
  );
}

function UnavailableCard({ message, status = 'UNAVAILABLE' }) {
  return (
    <Panel className="init-view__span" title="DRIVE EXPLORER" headerAside={status}>
      <div className={status === 'LOADING' ? 'de-notice' : 'de-notice de-notice--warn'}>{message}</div>
    </Panel>
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
  panel.open(pathPanelOptions(row, payload));
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
    <Panel className="init-view__span" title="DRIVE EXPLORER" headerAside={active.selectedDesign.displayName}>
      <div className="de-picker">
        <DesignPicker
          payload={active}
          onChange={(designId) => {
            // A different design is a different measured baseline, so it is the
            // one control that costs a fetch.
            state.designId = designId;
            loadDriveExplorer(state.observer, state.mode, state.container, designId);
          }}
        />
      </div>
      <DesignSummary payload={active} />
      <Legend payload={active} />
      <Controls payload={active} shownCount={shown.length} outcome={outcome} />
      <DriveTable payload={active} rows={shown} outcome={outcome} onOpenPath={openDrivePath} />
      <Footer payload={active} shownCount={shown.length} outcome={outcome} />
    </Panel>
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
