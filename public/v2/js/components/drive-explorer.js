/*
 * Drive Explorer Panel
 * --------------------
 * Purpose: renders the DRIVES view — every drive in the catalogue rated against
 * one of the observer's designs, from /api/intel/drive-explorer, and opens the
 * research path behind a clicked drive from /api/intel/tech-path.
 *
 * THE ONE RULE THIS PANEL EXISTS TO ENFORCE
 * -----------------------------------------
 * Delta-V, combat acceleration and cruise acceleration are MEASURED: the
 * propulsion model held against this hull's own measured dry mass and tank
 * capacity. Destination reachability is an ESTIMATE from a fixed heuristic
 * table, and only nine destinations are modelled.
 *
 * CRUISE IS NOT A NEAR-SUBSTITUTE FOR COMBAT
 * ------------------------------------------
 * `combat / cruise` is exactly each drive's own `thrustCap`, which runs 1 to 160
 * across the catalogue. Only 72 of 541 drives have the two equal (measured
 * 2026-08-22 on the live save), so for the other 469 the combat figure overstates
 * sustained transit acceleration -- by 60x on VASIMR x1, which reads 0.01010778
 * combat against 0.00016846 cruise. Both columns are therefore on screen; the
 * panel offered a CRUISE ACCEL sort with no cruise column for a while, which
 * reordered the table by an invisible key.
 *
 * The magnitudes span five orders, so the two acceleration columns are rendered
 * to SIGNIFICANT FIGURES rather than to a fixed number of decimals. `toFixed(3)`
 * printed the smallest drives as `0.000`, which reads as a measured zero and is
 * the defect class the rest of this panel exists to avoid.
 *
 * They are therefore rendered in two different registers and never in one:
 *
 *   measured   .de-measured — mono, full-contrast --text, upright
 *   estimate   .de-estimate — italic, --text-dim, dashed left rule, and a
 *              literal "ESTIMATE" caption above the column
 *
 * Putting them at the same visual weight would launder the estimate into a
 * measurement. tests/driveExplorer.test.js pins the two rule sets, and
 * scripts/verify_drive_explorer.js reads them back off the rendered DOM with
 * getComputedStyle rather than trusting this file.
 *
 * Rendering rules, as elsewhere in v2:
 *   1. Nothing is interpolated raw; absent renders as an em dash, never 0.
 *   2. Only strings this file authors reach the DOM. Upstream reasons are
 *      escaped into title attributes.
 *   3. Truncation announces itself: the shown/total/omitted counts are on
 *      screen, and so is every drive the endpoint could not resolve.
 */
(function exposeDriveExplorer(global) {
  'use strict';

  const shared = global.MissionControlShared || {};
  const escapeHtml = shared.escapeHtml || (value => String(value ?? ''));

  const UNAVAILABLE = '—';

  /** Availability buckets, mirroring shared/intel/driveExplorer.mjs. */
  const BUCKETS = Object.freeze({
    fittable: 'fittable',
    researchable: 'researchable',
    never: 'never',
    unresolved: 'unresolved'
  });

  const BUCKET_LABEL = Object.freeze({
    fittable: 'FITTABLE NOW',
    researchable: 'RESEARCHABLE',
    never: 'NEVER',
    unresolved: 'UNRESOLVED'
  });

  const BUCKET_TITLE = Object.freeze({
    fittable: 'The project that gates this drive is completed, or the drive is not gated at all. It can be fitted today.',
    researchable: 'Locked behind research. The chain cost is the remaining cost of the cheapest satisfying prerequisite path, from the same walk /api/intel/tech-path performs.',
    never: 'Not researchable by this faction at all — either the researchCost -1 sentinel, or a faction restriction. It is listed so you know it exists, not offered.',
    unresolved: 'Availability could not be determined from this snapshot. Listed below the table with its reason rather than shown as a blank row.'
  });

  const SORTS = Object.freeze([
    { key: 'delta-v', label: 'ΔV' },
    { key: 'combat-acceleration', label: 'COMBAT ACCEL' },
    { key: 'cruise-acceleration', label: 'CRUISE ACCEL' },
    { key: 'availability', label: 'AVAILABILITY' },
    { key: 'name', label: 'NAME' }
  ]);

  const REACTOR_FILTERS = Object.freeze([
    { key: 'all', label: 'ANY REACTOR FIT' },
    { key: 'compatible', label: 'REACTOR-COMPATIBLE ONLY' },
    { key: 'incompatible', label: 'REACTOR-INCOMPATIBLE ONLY' }
  ]);

  // A display cap keeps 541 table rows from being laid out at once, but it is
  // the reader's to lift -- a cap nobody can raise is pagination with extra
  // steps, and the spec asked for sorting and filtering instead.
  const ROW_CAPS = Object.freeze([60, 120, 250, 1000]);

  const ESTIMATE_CAPTION = 'ESTIMATE — heuristic, not a measurement';

  /**
   * The minimum-threshold controls, mirroring `DRIVE_THRESHOLD_FILTERS` in
   * shared/requestValidation.mjs.
   *
   * `measure` is the field on `row.measured` each one tests, so the predicate
   * below and the endpoint's are reading the same number by the same name. The
   * unit is on the control's own label AND in its placeholder: "> 10" is
   * ambiguous between km/s and m/s², which is the same defect as the missing
   * column this table just gained.
   */
  const THRESHOLDS = Object.freeze([
    { key: 'minDeltaV', measure: 'deltaVKps', label: 'MIN ΔV (km/s)', unit: 'km/s', placeholder: 'e.g. 10 km/s' },
    {
      key: 'minCombatAcceleration',
      measure: 'combatAccelerationMps2',
      label: 'MIN COMBAT ACCEL (m/s²)',
      unit: 'm/s²',
      placeholder: 'e.g. 20 m/s²'
    },
    {
      key: 'minCruiseAcceleration',
      measure: 'cruiseAccelerationMps2',
      label: 'MIN CRUISE ACCEL (m/s²)',
      unit: 'm/s²',
      placeholder: 'e.g. 0.5 m/s²'
    }
  ]);

  // Panel-local view state. Sorting and filtering happen here because the whole
  // catalogue is already in hand; only a design change costs a fetch.
  const state = {
    payload: null,
    designId: null,
    sort: 'delta-v',
    bucket: 'all',
    reactor: 'all',
    search: '',
    // Raw, as typed. Parsed by `parseThreshold` on every paint so a half-typed
    // value is a rejected one and never a coerced one.
    thresholds: { minDeltaV: '', minCombatAcceleration: '', minCruiseAcceleration: '' },
    limit: 120,
    container: null,
    observer: null,
    mode: null
  };

  function num(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  /** Absent renders as an em dash. Never as 0, and never as a blank cell. */
  function dec(value, places) {
    const parsed = num(value);
    return parsed === null ? UNAVAILABLE : parsed.toFixed(places === undefined ? 2 : places);
  }

  function int(value) {
    const parsed = num(value);
    return parsed === null ? UNAVAILABLE : Math.round(parsed).toLocaleString('en-US');
  }

  function mult(value) {
    const parsed = num(value);
    if (parsed === null) return UNAVAILABLE;
    const abs = Math.abs(parsed);
    if (abs >= 1000) return `${Math.round(parsed).toLocaleString('en-US')}×`;
    if (abs >= 10) return `${parsed.toFixed(1)}×`;
    return `${parsed.toFixed(2)}×`;
  }

  /**
   * An acceleration, to three significant figures.
   *
   * Measured cruise acceleration on the live catalogue runs from 0.00016846 to
   * 20.59560406 -- five orders of magnitude. `toFixed(3)` renders the bottom of
   * that range as `0.000`, which a reader cannot tell from a measured zero, so
   * this keeps three significant figures instead of three decimal places.
   *
   * A measured 0 stays `0`: it is a real measurement, and it is NOT what an
   * absent value renders as. Absent is the em dash, as everywhere else here.
   */
  function accel(value) {
    const parsed = num(value);
    if (parsed === null) return UNAVAILABLE;
    if (parsed === 0) return '0';
    const abs = Math.abs(parsed);
    if (abs >= 1000) return Math.round(parsed).toLocaleString('en-US');
    // `Number(...)` drops the trailing zeros `toPrecision` pads with, so 20.6
    // does not read as 20.600 beside 0.000168.
    return String(Number(parsed.toPrecision(3)));
  }

  /** A magnitude that spans nine orders on this data set. */
  function power(value) {
    const parsed = num(value);
    if (parsed === null) return UNAVAILABLE;
    if (parsed === 0) return '0';
    if (Math.abs(parsed) >= 1e6) return `${(parsed / 1e6).toFixed(1)}M`;
    if (Math.abs(parsed) >= 1e3) return `${(parsed / 1e3).toFixed(1)}k`;
    if (Math.abs(parsed) < 1) return parsed.toFixed(3);
    return parsed.toFixed(1);
  }

  function attr(value) {
    return escapeHtml(value === null || value === undefined ? '' : String(value));
  }

  /** Splits Snake_Case reactor and drive class ids into readable words. */
  function words(value) {
    if (!value) return UNAVAILABLE;
    return escapeHtml(String(value).replace(/_/g, ' '));
  }

  function chip(text, cls, title) {
    return `<span class="de-chip ${cls}"${title ? ` title="${attr(title)}"` : ''}>${escapeHtml(text)}</span>`;
  }

  // ------------------------------------------------------------------------
  // Filtering and sorting, over the catalogue already fetched.
  //
  // WHY THE NUMERIC FILTER RUNS HERE AS WELL AS ON THE ENDPOINT
  // ----------------------------------------------------------
  // `/api/intel/drive-explorer` honours `minDeltaV`, `minCombatAcceleration` and
  // `minCruiseAcceleration` -- that is not optional, because a filter that exists
  // only in the browser is invisible to every agent reading the endpoint, and
  // being agent-readable is half the point of this project.
  //
  // The panel nevertheless applies the SAME rules client-side rather than
  // re-fetching, because it already holds all 541 rows and already sorts and
  // filters them here: a fetch per keystroke would re-transfer the whole
  // catalogue to answer a question the page can already answer. That buys
  // responsiveness at the cost of a second implementation of the rule, so
  // tests/driveExplorer.test.js runs both against the live save over a matrix of
  // thresholds and fails if the two sets or the two counts ever differ.
  //
  // ABSENT STAYS NULL, and it is the whole risk here. `Number(null) === 0`, so a
  // null measurement tested against `>= 10` becomes `0 >= 10` and the row is
  // dropped as though it had been measured and found wanting. The three outcomes
  // below are the same three-valued logic the endpoint uses.
  // ------------------------------------------------------------------------

  const OUTCOME = Object.freeze({ pass: 'pass', below: 'below', untestable: 'untestable' });

  /**
   * Parses one typed threshold. Mirrors `parseMinimumThreshold`.
   *
   * Absent -> no filter. Malformed or negative -> no filter AND a rejection the
   * reader is shown, never a coercion: `Number('abc')` is NaN and `Number('')`
   * is 0, and either would silently answer a different question.
   */
  function parseThreshold(raw) {
    if (raw === null || raw === undefined) return { applied: null, rejected: null };
    const text = String(raw).trim();
    if (text === '') return { applied: null, rejected: null };
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return { applied: null, rejected: text };
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) return { applied: null, rejected: text };
    return { applied: parsed, rejected: null };
  }

  /** Every typed threshold, parsed. `active` is what actually filters. */
  function activeThresholds() {
    const applied = {};
    const active = [];
    const rejected = [];
    THRESHOLDS.forEach(entry => {
      const result = parseThreshold(state.thresholds[entry.key]);
      applied[entry.key] = result.applied;
      if (result.applied !== null) active.push(entry);
      if (result.rejected !== null) rejected.push({ ...entry, value: result.rejected });
    });
    return { applied, active, rejected };
  }

  /**
   * One row against the active minimums.
   *
   * A definite failure on any TESTABLE minimum is a failure whatever else is
   * unmeasured -- the AND is then definitely false. Only when every testable
   * minimum passes and something is missing is the answer unknown, and an
   * unknown row is excluded and counted apart from the genuine failures.
   */
  function thresholdOutcome(row, active) {
    let unmeasured = 0;
    for (const entry of active) {
      const value = num(row.measured ? row.measured[entry.measure] : null);
      if (value === null) unmeasured += 1;
      else if (value < entry.applied) return OUTCOME.below;
    }
    return unmeasured > 0 ? OUTCOME.untestable : OUTCOME.pass;
  }

  /**
   * The rows to show, plus WHY the rest are not shown.
   *
   * Returns the matched rows and the two exclusion counts separately, because
   * "408 filtered out" cannot be read: a drive that failed the minimum and a
   * drive nobody could measure are different facts and the reader needs both.
   */
  function visibleRows(items) {
    const term = state.search.trim().toLowerCase();
    const request = activeThresholds();
    const active = request.active.map(entry => ({
      ...entry,
      applied: request.applied[entry.key]
    }));

    const matched = [];
    const untestable = [];
    let belowThresholdCount = 0;

    for (const row of items) {
      if (state.bucket !== 'all' && row.availability.bucket !== state.bucket) continue;
      if (state.reactor === 'compatible' && row.reactor.compatible !== true) continue;
      if (state.reactor === 'incompatible' && row.reactor.compatible !== false) continue;
      if (term) {
        const haystack = `${row.displayName || ''} ${row.driveId || ''} ${row.classification || ''} ${row.propellant || ''}`.toLowerCase();
        if (!haystack.includes(term)) continue;
      }
      const outcome = thresholdOutcome(row, active);
      if (outcome === OUTCOME.pass) matched.push(row);
      else if (outcome === OUTCOME.untestable) untestable.push(row);
      else belowThresholdCount += 1;
    }

    return {
      rows: matched,
      belowThresholdCount,
      untestableCount: untestable.length,
      untestableDrives: untestable,
      thresholds: request
    };
  }

  function sortRows(rows) {
    const byName = (a, b) => String(a.displayName || a.driveId).localeCompare(String(b.displayName || b.driveId));
    const numeric = (read) => (a, b) => {
      const x = num(read(a));
      const y = num(read(b));
      // Uncomputable is not zero and never ranks as zero: it sorts last.
      if (x === null && y === null) return byName(a, b);
      if (x === null) return 1;
      if (y === null) return -1;
      if (x !== y) return y - x;
      return byName(a, b);
    };
    const bucketRank = { fittable: 0, researchable: 1, never: 2, unresolved: 3 };

    const sorted = rows.slice();
    if (state.sort === 'name') sorted.sort(byName);
    else if (state.sort === 'availability') {
      sorted.sort((a, b) => {
        const rankA = bucketRank[a.availability.bucket] ?? 99;
        const rankB = bucketRank[b.availability.bucket] ?? 99;
        if (rankA !== rankB) return rankA - rankB;
        return numeric(row => row.measured.deltaVKps)(a, b);
      });
    } else if (state.sort === 'combat-acceleration') sorted.sort(numeric(row => row.measured.combatAccelerationMps2));
    else if (state.sort === 'cruise-acceleration') sorted.sort(numeric(row => row.measured.cruiseAccelerationMps2));
    else sorted.sort(numeric(row => row.measured.deltaVKps));
    return sorted;
  }

  // ------------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------------

  function renderDesignPicker(payload) {
    const options = (payload.designs || []).map(design => {
      const selected = design.designId === payload.selectedDesign.designId ? ' selected' : '';
      const hulls = num(design.shipsInService);
      const suffix = hulls === null ? '' : ` — ${hulls} hull${hulls === 1 ? '' : 's'}`;
      return `<option value="${attr(design.designId)}"${selected}>${escapeHtml(design.displayName)}${escapeHtml(suffix)}</option>`;
    }).join('');
    return `
      <label class="de-control">
        <span class="de-control__label">DESIGN</span>
        <select class="de-select" data-de-design>${options}</select>
      </label>`;
  }

  function renderDesignSummary(payload) {
    const design = payload.selectedDesign;
    const fitted = design.fittedDrivePerformance;
    const reactorClass = design.reactor.powerPlantClass;
    const notMeasured = design.baselineMeasured === false;

    return `
      <div class="de-summary">
        <div class="de-summary__row">
          <div class="de-summary__cell">
            <div class="de-summary__label">HULL</div>
            <div class="de-summary__value">${escapeHtml(design.hullName || UNAVAILABLE)}</div>
          </div>
          <div class="de-summary__cell">
            <div class="de-summary__label">IN SERVICE</div>
            <div class="de-summary__value">${int(design.shipsInService)}</div>
          </div>
          <div class="de-summary__cell">
            <div class="de-summary__label">REACTOR</div>
            <div class="de-summary__value"${design.reactor.resolvedReason ? ` title="${attr(design.reactor.resolvedReason)}"` : ''}>${words(reactorClass)}</div>
            <div class="de-summary__sub">${num(design.reactor.maxOutputGW) === null ? 'output unavailable' : `${dec(design.reactor.maxOutputGW, 1)} GW`}</div>
          </div>
          <div class="de-summary__cell">
            <div class="de-summary__label">FITTED DRIVE</div>
            <div class="de-summary__value">${escapeHtml(design.fittedDrive.displayName || UNAVAILABLE)}</div>
            <div class="de-summary__sub">${words(design.fittedDrive.classification)}</div>
          </div>
          <div class="de-summary__cell de-measured">
            <div class="de-summary__label">FITTED ΔV <span class="de-tag de-tag--measured">MEASURED</span></div>
            <div class="de-summary__value de-measured__value">${dec(fitted.deltaVKps, 2)}<span class="de-unit"> km/s</span></div>
          </div>
          <div class="de-summary__cell de-measured">
            <div class="de-summary__label">FITTED COMBAT ACCEL <span class="de-tag de-tag--measured">MEASURED</span></div>
            <div class="de-summary__value de-measured__value">${accel(fitted.combatAccelerationMps2)}<span class="de-unit"> m/s²</span></div>
          </div>
          <div class="de-summary__cell de-measured">
            <div class="de-summary__label">FITTED CRUISE ACCEL <span class="de-tag de-tag--measured">MEASURED</span></div>
            <div class="de-summary__value de-measured__value">${accel(fitted.cruiseAccelerationMps2)}<span class="de-unit"> m/s²</span></div>
            <div class="de-summary__sub">the baseline every × fitted in the CRUISE ACCEL column is measured against</div>
          </div>
        </div>
        ${notMeasured ? `<div class="de-notice de-notice--warn" title="${attr(design.baselineUnmeasuredReason)}">
          NO MEASURED BASELINE FOR THIS DESIGN — every ΔV and acceleration below is reported as unavailable rather than guessed. Reactor fit, power draw and research state are still real.
        </div>` : ''}
      </div>`;
  }

  function renderLegend(payload) {
    const model = payload.destinationModel || {};
    const modelled = num(model.destinationsModelled);
    // An unavailable table is NOT "0 destinations are modelled". A confident
    // zero for something that was never evaluated is the exact failure the rest
    // of this panel is built to avoid, so the two states read differently.
    const scope = model.available === true && modelled !== null
      ? `Only ${escapeHtml(String(modelled))} destinations are modelled — a body absent from that list is not an unreachable one.`
      : 'No destination table could be read for this design, so no destination is evaluated here — which is not the same as none being reachable.';
    return `
      <div class="de-legend">
        <div class="de-legend__item de-measured">
          <span class="de-tag de-tag--measured">MEASURED</span>
          <span class="de-legend__text">ΔV and acceleration, from the propulsion model held against this hull's own measured dry mass and tank capacity.</span>
        </div>
        <div class="de-legend__item de-estimate">
          <span class="de-tag de-tag--estimate">ESTIMATE</span>
          <span class="de-legend__text de-estimate__text">Destination reachability, from a fixed heuristic ΔV table. Not a measurement. ${scope}</span>
        </div>
      </div>`;
  }

  function renderControls(payload, shownCount, outcome) {
    const matchedCount = outcome.rows.length;
    const census = payload.availabilityCensus || {};
    const reactorCensus = payload.reactorCompatibilityCensus || {};
    const bucketOptions = [
      `<option value="all"${state.bucket === 'all' ? ' selected' : ''}>ALL AVAILABILITY (${int(payload.driveCatalogue.rated)})</option>`,
      ...Object.keys(BUCKETS).map(key => {
        const count = num(census[key]);
        return `<option value="${attr(key)}"${state.bucket === key ? ' selected' : ''}>${escapeHtml(BUCKET_LABEL[key])} (${count === null ? UNAVAILABLE : count})</option>`;
      })
    ].join('');

    const reactorOptions = REACTOR_FILTERS.map(entry => {
      const count = entry.key === 'all'
        ? num(payload.driveCatalogue.rated)
        : num(reactorCensus[entry.key]);
      return `<option value="${attr(entry.key)}"${state.reactor === entry.key ? ' selected' : ''}>${escapeHtml(entry.label)} (${count === null ? UNAVAILABLE : count})</option>`;
    }).join('');

    const sortOptions = SORTS.map(entry =>
      `<option value="${attr(entry.key)}"${state.sort === entry.key ? ' selected' : ''}>${escapeHtml(entry.label)}</option>`).join('');

    // The unit is on the label AND in the placeholder. A bare "> 10" does not
    // say km/s from m/s², and the reader has no way to find out from the box.
    //
    // `type="text"` with `inputmode="decimal"`, deliberately, NOT `type="number"`.
    // A number input returns `''` from `.value` for anything it considers
    // invalid, so typing a leading `-` or a half-finished `1e` silently wipes the
    // field -- and it makes the rejection branch below unreachable in a browser
    // while it stays reachable through the endpoint. Same keypad on mobile, and
    // an honest "that is not a number" instead of a value that vanishes.
    const thresholdControls = THRESHOLDS.map(entry => `
        <label class="de-control de-control--threshold">
          <span class="de-control__label">${escapeHtml(entry.label)}</span>
          <input class="de-input de-input--number" type="text" inputmode="decimal"
            data-de-threshold="${attr(entry.key)}" value="${attr(state.thresholds[entry.key])}"
            placeholder="${attr(entry.placeholder)}"
            aria-label="${attr(`Minimum ${entry.measure === 'deltaVKps' ? 'delta-V' : entry.label.toLowerCase()}, in ${entry.unit}`)}"
            title="${attr(`Shows only drives measuring at least this much, in ${entry.unit}. A drive with no measured value for it is excluded and counted separately — it could not be tested, which is not the same as failing.`)}">
        </label>`).join('');

    return `
      <div class="de-controls">
        <label class="de-control">
          <span class="de-control__label">SORT BY</span>
          <select class="de-select" data-de-sort>${sortOptions}</select>
        </label>
        ${thresholdControls}
        <label class="de-control">
          <span class="de-control__label">AVAILABILITY</span>
          <select class="de-select" data-de-bucket>${bucketOptions}</select>
        </label>
        <label class="de-control">
          <span class="de-control__label">REACTOR FIT</span>
          <select class="de-select" data-de-reactor>${reactorOptions}</select>
        </label>
        <label class="de-control">
          <span class="de-control__label">SEARCH</span>
          <input class="de-input" type="search" data-de-search value="${attr(state.search)}" placeholder="drive, class or propellant">
        </label>
        <label class="de-control">
          <span class="de-control__label">ROWS SHOWN</span>
          <select class="de-select" data-de-rows>${ROW_CAPS.map(cap =>
    `<option value="${cap}"${state.limit === cap ? ' selected' : ''}>${cap >= 1000 ? 'ALL' : cap}</option>`).join('')}</select>
        </label>
        <div class="de-control de-control--count">
          <span class="de-control__label">SHOWING</span>
          <span class="de-count" data-de-count>${int(shownCount)} of ${int(matchedCount)} matched · ${int(payload.driveCatalogue.total)} in catalogue</span>
        </div>
      </div>
      ${renderThresholdNotice(outcome)}`;
  }

  /**
   * What the minimums did, on screen rather than only in the payload.
   *
   * Two things must be visible and are separate facts: a rejected minimum did
   * NOT filter (so the list is wider than the reader typed), and an untestable
   * drive was excluded without having failed (so the list is narrower than the
   * matches alone explain, for a reason that is not a verdict on the drive).
   */
  function renderThresholdNotice(outcome) {
    const rejected = outcome.thresholds.rejected;
    const active = outcome.thresholds.active;
    const blocks = [];

    if (rejected.length > 0) {
      blocks.push(`<div class="de-notice de-notice--warn">
        ${escapeHtml(rejected.map(entry => `${entry.label} = "${entry.value}"`).join('; '))}
        — not a non-negative number, so ${rejected.length === 1 ? 'it was' : 'they were'} IGNORED rather than
        treated as zero. Nothing was filtered on ${rejected.length === 1 ? 'it' : 'them'}.
      </div>`);
    }

    if (active.length > 0) {
      const summary = active.map(entry =>
        `${entry.label.replace(/^MIN /, '')} ≥ ${escapeHtml(String(outcome.thresholds.applied[entry.key]))}`).join(' AND ');
      blocks.push(`<div class="de-notice de-notice--filters">
        MINIMUMS ACTIVE: ${summary}. ${int(outcome.rows.length)} drive(s) meet them;
        ${int(outcome.belowThresholdCount)} were measured and fall short.
        ${outcome.untestableCount > 0
    ? `${int(outcome.untestableCount)} could NOT be tested — they have no measured value for a filtered column,
           so they are excluded and counted here rather than counted as failures.`
    : 'Every drive in scope had a measured value for every filtered column, so none was excluded as untestable.'}
      </div>`);
    }

    return blocks.join('');
  }

  function renderReactorCell(row, payload) {
    const designClass = payload.selectedDesign.reactor.powerPlantClass;
    if (row.reactor.compatible === true) {
      return `<td class="de-cell de-cell--reactor">${chip('FITS', 'de-chip--ok',
        `This drive accepts ${row.reactor.requiredPowerPlant === 'Any_General' ? 'any reactor class' : `the ${String(row.reactor.requiredPowerPlant).replace(/_/g, ' ')} class`}, which this design's reactor provides.`)}</td>`;
    }
    if (row.reactor.compatible === false) {
      return `<td class="de-cell de-cell--reactor">${chip('NEEDS ' + String(row.reactor.requiredPowerPlant || '').replace(/_/g, ' ').toUpperCase(), 'de-chip--block',
        `Not an option on this design. It requires a ${String(row.reactor.requiredPowerPlant).replace(/_/g, ' ')} reactor and this design carries ${designClass ? String(designClass).replace(/_/g, ' ') : 'an unrecorded reactor class'}.`)}</td>`;
    }
    return `<td class="de-cell de-cell--reactor">${chip('UNKNOWN', 'de-chip--unknown',
      'Reactor compatibility could not be evaluated: either the drive states no required class or this design\'s reactor class is not recorded in this snapshot. Unknown is not the same as compatible.')}</td>`;
  }

  function renderAvailabilityCell(row) {
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
    return `<td class="de-cell de-cell--availability">
      ${chip(BUCKET_LABEL[bucket] || 'UNKNOWN', cls, BUCKET_TITLE[bucket] || '')}
      ${costLabel ? `<div class="de-cell__sub">${escapeHtml(costLabel)}</div>` : ''}
    </td>`;
  }

  function renderRow(row, payload) {
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
      ? ` title="${attr(measured.reason
        || 'this drive has no measured cruise acceleration against this design — unavailable, which is not the same as zero')}"`
      : '';

    const caveatMark = measured.dryMassCaveat
      ? `<span class="de-caveat" title="${attr(measured.dryMassCaveat)}">MASS CAVEAT</span>`
      : '';
    const disabledMark = row.disabledInTemplates
      ? `<span class="de-caveat de-caveat--muted" title="This drive is disabled in the shipped game templates and cannot be built. It is listed so the catalogue count reconciles.">DISABLED</span>`
      : '';
    const fittedMark = row.isFittedDrive
      ? `<span class="de-caveat de-caveat--fitted" title="The drive currently fitted to this design. Every multiple in this table is measured against it.">FITTED</span>`
      : '';

    // The name is a real <button>, not a tabindex on the <tr>: the row keeps its
    // row semantics for assistive technology while the control that opens the
    // path modal is a control. Mouse users get the whole row (see bindControls);
    // keyboard users get this, in the tab order, with an accessible name.
    return `
      <tr class="de-row${row.isFittedDrive ? ' de-row--fitted' : ''}${uncomputable ? ' de-row--uncomputable' : ''}" data-de-drive="${attr(row.driveId)}">
        <td class="de-cell de-cell--name">
          <button type="button" class="de-name-btn" data-de-path="${attr(row.driveId)}"
            aria-label="${attr(`${row.displayName || row.driveId}: show the research path that unlocks this drive`)}"
            title="Show the global techs and faction projects that unlock this drive, and which of them are already done.">
            <span class="de-name">${escapeHtml(row.displayName || row.driveId)}</span>
          </button>
          <div class="de-cell__sub">${words(row.classification)} · ${words(row.propellant)} ${fittedMark}${disabledMark}${caveatMark}</div>
        </td>
        <td class="de-cell de-measured de-cell--number de-cell--dv"${uncomputable ? ` title="${attr(measured.reason || 'not computable against this design')}"` : ''}>
          <div class="de-measured__value">${dec(measured.deltaVKps, 2)}</div>
          <div class="de-cell__sub">${uncomputable ? 'UNAVAILABLE' : `${mult(measured.deltaVMultipleVsFitted)} fitted`}</div>
        </td>
        <td class="de-cell de-measured de-cell--number"${uncomputable ? ` title="${attr(measured.reason || 'not computable against this design')}"` : ''}>
          <div class="de-measured__value">${accel(measured.combatAccelerationMps2)}</div>
          <div class="de-cell__sub">${uncomputable ? 'UNAVAILABLE' : `${mult(measured.combatAccelerationMultipleVsFitted)} fitted`}</div>
        </td>
        <td class="de-cell de-measured de-cell--number"${cruiseTitle}>
          <div class="de-measured__value">${accel(measured.cruiseAccelerationMps2)}</div>
          <div class="de-cell__sub">${cruiseUnavailable
    ? 'UNAVAILABLE'
    : `${mult(measured.cruiseAccelerationMultipleVsFitted)} fitted`}</div>
        </td>
        ${renderReactorCell(row, payload)}
        <td class="de-cell de-cell--number de-cell--power" title="Power draw is information, never a veto: the game scales thrust by min(1, plant output / required draw) rather than refusing an underpowered design. The acceleration figures in this table do not have that scaling applied.">
          <div>${power(row.power.driveDrawGW)}<span class="de-unit"> GW</span></div>
          <div class="de-cell__sub">${num(row.power.thrustScalingFactor) === null ? 'scaling unavailable' : `thrust ×${dec(row.power.thrustScalingFactor, 3)}`}</div>
        </td>
        ${renderAvailabilityCell(row)}
        <td class="de-cell de-estimate de-cell--estimate">
          <div class="de-estimate__value">${estimate.evaluated === true ? `${int(estimate.reachableCount)} reachable` : 'NOT EVALUATED'}</div>
          <div class="de-estimate__text">${opened.length > 0
    ? `opens ${escapeHtml(opened.join(', '))}`
    : (estimate.evaluated === true ? 'opens nothing new' : escapeHtml(estimate.reason || 'no destination table'))}</div>
        </td>
      </tr>`;
  }

  function renderTable(payload, rows, outcome) {
    if (rows.length === 0) {
      const untestable = outcome && outcome.untestableCount > 0
        ? ` ${escapeHtml(String(outcome.untestableCount))} drive(s) could not be tested against the active minimums — they carry no measured value for a filtered column, so they are excluded rather than failed.`
        : '';
      return `<div class="de-notice">No drive matches the current filters. ${escapeHtml(String(payload.driveCatalogue.rated))} drives are rated in this catalogue; widen the filters to see them.${untestable}</div>`;
    }
    return `
      <div class="de-table-wrap">
        <table class="de-table">
          <thead>
            <tr>
              <th class="de-th">DRIVE</th>
              <th class="de-th de-th--measured">ΔV km/s<span class="de-th__caption">MEASURED</span></th>
              <th class="de-th de-th--measured" title="Peak acceleration in combat: thrust at the drive's own thrustCap multiplier. It is NOT the acceleration a transfer burn sustains — see CRUISE ACCEL.">COMBAT ACCEL m/s²<span class="de-th__caption">MEASURED</span></th>
              <th class="de-th de-th--measured" title="Sustained acceleration outside combat: thrust at 1x, which is what a transfer burn actually gets. Combat divided by cruise is exactly this drive's thrustCap, and only 72 of 541 drives have the two equal.">CRUISE ACCEL m/s²<span class="de-th__caption">MEASURED</span></th>
              <th class="de-th">REACTOR</th>
              <th class="de-th">POWER DRAW</th>
              <th class="de-th">AVAILABILITY</th>
              <th class="de-th de-th--estimate">DESTINATIONS<span class="de-th__caption de-th__caption--estimate">${escapeHtml(ESTIMATE_CAPTION)}</span></th>
            </tr>
          </thead>
          <tbody>${rows.map(row => renderRow(row, payload)).join('')}</tbody>
        </table>
      </div>
      <div class="de-scroll-hint">SWIPE HORIZONTALLY — DRIVE NAME STAYS PINNED</div>`;
  }

  function renderFooter(payload, shownCount, outcome) {
    const matchedCount = outcome.rows.length;
    const unresolved = Array.isArray(payload.unresolvedDrives) ? payload.unresolvedDrives : [];
    // A cap announces itself, and it announces the control that lifts it.
    const omitted = Math.max(0, matchedCount - shownCount);
    const model = payload.destinationModel || {};
    const destinationList = Array.isArray(model.destinations) ? model.destinations : [];

    const destinationTable = model.available
      ? `<div class="de-estimate de-destination-table">
          <div class="de-destination-table__head">
            <span class="de-tag de-tag--estimate">ESTIMATE</span>
            <span class="de-estimate__text">Modelled destinations from ${escapeHtml(model.origin || 'this fleet\'s current orbit')} — ${escapeHtml(String(destinationList.length))} of them, and no others.</span>
          </div>
          <div class="de-destination-table__rows">
            ${destinationList.map(entry => `<span class="de-destination">${escapeHtml(entry.destination)} <span class="de-destination__dv">${dec(entry.deltaVRequired, 1)} km/s</span></span>`).join('')}
          </div>
          <div class="de-estimate__text">${escapeHtml(model.travelDaysBasis || '')}</div>
        </div>`
      : `<div class="de-notice">Destination estimates unavailable: ${escapeHtml(model.reason || 'no destination table for this design')}.</div>`;

    const unresolvedBlock = unresolved.length > 0
      ? `<div class="de-notice de-notice--warn">
          ${escapeHtml(String(unresolved.length))} drive(s) were dropped because their availability could not be resolved, each with its reason:
          <ul class="de-unresolved">${unresolved.slice(0, 20).map(entry =>
    `<li title="${attr(entry.reason)}">${escapeHtml(entry.displayName || entry.driveId)}</li>`).join('')}</ul>
          ${unresolved.length > 20 ? `<div>${escapeHtml(String(unresolved.length - 20))} further unresolved drive(s) not listed here; the full set is on /api/intel/drive-explorer.</div>` : ''}
        </div>`
      : '';

    return `
      ${destinationTable}
      ${unresolvedBlock}
      <div class="de-reconcile">
        ${int(payload.driveCatalogue.total)} drives in the catalogue = ${int(payload.driveCatalogue.rated)} rated + ${int(payload.unresolvedCount)} unresolved.
        ${int(matchedCount)} match the current filters, ${int(shownCount)} shown${omitted > 0 ? `, ${int(omitted)} omitted by the ${int(state.limit)}-row display cap — raise it with ROWS SHOWN` : ''}.
        ${outcome.thresholds.active.length > 0
    ? `Of the rest, ${int(outcome.belowThresholdCount)} were measured and fell below an active minimum and
       ${int(outcome.untestableCount)} could not be tested at all — an untestable drive is excluded, never counted as a failure.`
    : ''}
        ${int(payload.driveCatalogue.disabledInTemplates)} of them are disabled in the shipped templates and cannot be built.
      </div>`;
  }

  // ------------------------------------------------------------------------
  // The path modal: click a drive, see what unlocks it.
  //
  // Everything below reads /api/intel/tech-path for the drive's GATE PROJECT.
  // The endpoint already makes the split this modal is about -- `type` is
  // `faction_project` or `global_tech` -- and already picks the cheapest
  // satisfying route through the alternate prerequisites, reporting the road not
  // taken. Nothing here re-derives any of that.
  //
  // Two things it must never do:
  //   * present a `researchCost: -1` sentinel as a cost. It marks a project that
  //     is never researched, so a path containing one has NO honest total.
  //   * imply that a cleared path is a startable one. Availability is rolled
  //     monthly, not derived (docs/research-advisor-spec.md 3b), and the caveat
  //     travels on the payload so this panel cannot forget to say so.
  // ------------------------------------------------------------------------

  const pathCache = new Map();

  const STATUS_LABEL = Object.freeze({
    completed: 'DONE',
    researching: 'RESEARCHING',
    available: 'AVAILABLE',
    locked: 'LOCKED',
    unknown: 'UNKNOWN'
  });

  const STATUS_TONE = Object.freeze({
    completed: 'ok',
    researching: 'warn',
    available: 'ok',
    locked: 'block',
    unknown: 'unknown'
  });

  /** Research points, or an honest UNKNOWN. -1 is a sentinel, never a number. */
  function rp(value) {
    const parsed = num(value);
    if (parsed === null) return UNAVAILABLE;
    if (parsed < 0) return 'NEVER RESEARCHED';
    return `${Math.round(parsed).toLocaleString('en-US')} RP`;
  }

  function statusText(node) {
    const label = STATUS_LABEL[node.status] || 'UNKNOWN';
    const pct = num(node.progressPercent);
    if (node.status === 'researching' && pct !== null) return `${label} ${pct.toFixed(1)}%`;
    return label;
  }

  function pathRow(node) {
    return {
      label: node.displayName || node.id,
      sublabel: node.category ? String(node.category).replace(/([a-z])([A-Z])/g, '$1 $2') : null,
      status: statusText(node),
      statusTone: STATUS_TONE[node.status] || 'unknown',
      meta: rp(node.cost)
    };
  }

  // A node before the nodes that depend on it -- a path, not a set.
  //
  // `remainingPath` is a PRE-order walk, so reversing it is NOT a dependency
  // order: on the live save `Exotic Hybrid Systems` and `Exotics` are siblings
  // under one parent while the first also needs the second, and the reversed
  // pre-order lists the dependent first. The endpoint carries the real
  // topological order as `remainingPathDependencyOrder` (ids), so this sorts by
  // position in it. A node the order does not mention keeps its emitted
  // position at the end rather than being dropped.
  function inDependencyOrder(nodes, order) {
    const index = new Map((Array.isArray(order) ? order : []).map((id, position) => [id, position]));
    return nodes
      .map((node, position) => ({ node, position }))
      .sort((a, b) => {
        const rankA = index.has(a.node.id) ? index.get(a.node.id) : Number.POSITIVE_INFINITY;
        const rankB = index.has(b.node.id) ? index.get(b.node.id) : Number.POSITIVE_INFINITY;
        if (rankA !== rankB) return rankA - rankB;
        return a.position - b.position;
      })
      .map(entry => entry.node);
  }

  function routeSection(routes) {
    const list = Array.isArray(routes) ? routes : [];
    if (list.length === 0) return null;
    return {
      title: 'ROUTE CHOSEN',
      caption: `${list.length} node(s) on this path had an alternate prerequisite`,
      rows: list.map(route => ({
        label: route.nodeDisplayName || route.nodeId,
        sublabel: `via ${route.chosenRoute?.displayName || route.chosenRoute?.id || 'an unnamed prerequisite'}`
          + ` rather than ${route.alternativeRoute?.displayName || route.alternativeRoute?.id || 'an unnamed alternative'}`,
        status: num(route.savings) === null ? 'SAVINGS UNKNOWN' : `SAVES ${rp(route.savings)}`,
        statusTone: num(route.savings) === null ? 'unknown' : 'ok',
        meta: `${rp(route.chosenRoute?.cost)} vs ${rp(route.alternativeRoute?.cost)}`
      })),
      empty: 'No node on this path had an alternate prerequisite.'
    };
  }

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

  /** Facts and sections for a drive whose gate is resolved and whose path loaded. */
  function pathPanelOptions(row, payload) {
    const drive = row.displayName || row.driveId;
    const gateId = row.availability.gateProjectId;
    const gateName = row.availability.gateProjectName || payload?.target?.displayName || gateId;

    const facts = [
      { label: 'DRIVE', value: drive },
      { label: 'GATE PROJECT', value: gateName ? `${gateName} (${gateId})` : 'none — this drive names no gating project' },
      { label: 'AVAILABILITY', value: BUCKET_LABEL[row.availability.bucket] || 'UNKNOWN' }
    ];

    if (payload?.unavailable) {
      return {
        eyebrow: 'RESEARCH PATH',
        title: drive,
        summary: 'The research path behind this drive could not be read from this snapshot.',
        facts,
        notes: [payload.reason || 'No reason was reported.']
      };
    }

    const remaining = Array.isArray(payload.remainingPath) ? payload.remainingPath : [];
    const satisfied = Array.isArray(payload.satisfiedPrerequisites) ? payload.satisfiedPrerequisites : [];
    const order = payload.remainingPathDependencyOrder;
    const factionNodes = inDependencyOrder(remaining.filter(n => n.type === 'faction_project'), order);
    const globalNodes = inDependencyOrder(remaining.filter(n => n.type === 'global_tech'), order);
    const otherNodes = inDependencyOrder(
      remaining.filter(n => n.type !== 'faction_project' && n.type !== 'global_tech'), order);
    const satisfiedFaction = satisfied.filter(n => n.type === 'faction_project').length;
    const satisfiedGlobal = satisfied.filter(n => n.type === 'global_tech').length;

    const totalCost = payload.researchCostComplete === true
      ? rp(payload.totalRemainingResearchCost)
      : 'UNKNOWN — a step on this path is never researched';

    facts.push(
      { label: 'REMAINING', value: `${remaining.length} step(s)` },
      { label: 'FACTION RESEARCH', value: payload.remainingFactionResearchCost === null ? 'UNKNOWN' : rp(payload.remainingFactionResearchCost) },
      { label: 'GLOBAL RESEARCH', value: payload.remainingGlobalResearchCost === null ? 'UNKNOWN' : rp(payload.remainingGlobalResearchCost) },
      { label: 'TOTAL REMAINING', value: totalCost },
      { label: 'ALREADY SATISFIED', value: `${payload.satisfiedPrerequisiteTotalCount ?? satisfied.length} prerequisite(s)` }
    );

    const sections = [
      {
        title: 'FACTION PROJECTS',
        caption: `${factionNodes.length} remaining · ${payload.remainingFactionResearchCost === null ? 'cost unknown' : rp(payload.remainingFactionResearchCost)}`,
        rows: factionNodes.map(pathRow),
        empty: 'No faction project remains on this path.'
      },
      {
        title: 'GLOBAL TECHS',
        caption: `${globalNodes.length} remaining · ${payload.remainingGlobalResearchCost === null ? 'cost unknown' : rp(payload.remainingGlobalResearchCost)}`,
        rows: globalNodes.map(pathRow),
        empty: 'No global tech remains on this path.'
      }
    ];

    // Neither of the two types the endpoint reports. Shown rather than dropped:
    // a node silently absent from both sections would make the counts lie.
    if (otherNodes.length > 0) {
      sections.push({
        title: 'OTHER NODES',
        caption: `${otherNodes.length} node(s) the endpoint classified as neither a faction project nor a global tech`,
        rows: otherNodes.map(pathRow),
        empty: 'None.'
      });
    }

    sections.push({
      title: 'ALREADY SATISFIED',
      caption: `${satisfied.length} shown · ${satisfiedFaction} faction, ${satisfiedGlobal} global · already researched, nothing further to pay`,
      rows: satisfied.map(pathRow),
      empty: 'No prerequisite on this path is satisfied yet.'
    });

    const routes = routeSection(payload.routesEvaluated);
    if (routes) sections.push(routes);

    const notes = [payload.availabilityCaveat].filter(Boolean);
    const omitted = num(payload.satisfiedPrerequisiteOmittedCount);
    if (omitted !== null && omitted > 0) {
      notes.push(`${omitted} further satisfied prerequisite(s) are not listed here: the endpoint caps the list at ${satisfied.length}. The full set is on /api/intel/tech-path?target=${gateId}.`);
    }
    if (Array.isArray(payload.uncostedNodes) && payload.uncostedNodes.length > 0) {
      notes.push(`${payload.uncostedNodes.length} node(s) on this path carry no readable cost, so no total for it is honest: ${payload.uncostedNodes.join(', ')}.`);
    }

    return {
      eyebrow: 'RESEARCH PATH',
      title: drive,
      summary: `${remaining.length} step(s) remain to unlock ${gateName || 'this drive'}, and ${payload.satisfiedPrerequisiteTotalCount ?? satisfied.length} prerequisite(s) on the route are already done. The route is the cheapest satisfying one, from the same walk /api/intel/tech-path performs.`,
      facts,
      sections,
      notes
    };
  }

  /** Opens the modal for one drive row. Every branch opens SOMETHING. */
  async function openDrivePath(driveId, trigger) {
    const panel = global.MissionControlDetailPanel;
    if (!panel || typeof panel.open !== 'function') return;
    const payloadRows = (state.payload && state.payload.items) || [];
    const row = payloadRows.find(entry => entry.driveId === driveId);
    if (!row) return;

    const gateId = row.availability.gateProjectId;
    const drive = row.displayName || row.driveId;

    if (!gateId) {
      // Ungated is a fact about the drive, not a missing value.
      panel.open({
        eyebrow: 'RESEARCH PATH',
        title: drive,
        facts: [
          { label: 'DRIVE', value: drive },
          { label: 'GATE PROJECT', value: 'none — this drive names no gating project' },
          { label: 'AVAILABILITY', value: BUCKET_LABEL[row.availability.bucket] || 'UNKNOWN' }
        ],
        summary: 'This drive is not gated by any project, so there is no research path to it. What makes it usable is whatever mounts it.',
        notes: ['Nothing unlocks this drive because nothing needs to. 33 of the 125 laser templates and a handful of hulls, armours, reactors and radiators are the same.']
      });
      return;
    }

    if (trigger) trigger.setAttribute('aria-busy', 'true');
    const payload = await fetchTechPath(gateId);
    if (trigger) trigger.removeAttribute('aria-busy');
    panel.open(pathPanelOptions(row, payload));
  }

  function renderUnavailable(container, message) {
    container.innerHTML = `
      <div class="tech-card init-view__span">
        <div class="tech-card-header">
          <div class="tech-card-title">DRIVE EXPLORER</div>
          <span>UNAVAILABLE</span>
        </div>
        <div class="tech-card-body">
          <div class="de-notice de-notice--warn">${escapeHtml(message)}</div>
        </div>
      </div>`;
  }

  function paint() {
    const container = state.container;
    const payload = state.payload;
    if (!container) return;
    if (!payload) {
      renderUnavailable(container, 'Drive explorer data could not be loaded from /api/intel/drive-explorer.');
      return;
    }
    if (!payload.driveCatalogue || !payload.driveCatalogue.available || !payload.selectedDesign) {
      renderUnavailable(container, payload.reason
        || (payload.driveCatalogue && payload.driveCatalogue.reason)
        || 'No drive catalogue or observer ship design is present in this snapshot.');
      return;
    }

    const outcome = visibleRows(payload.items || []);
    const sorted = sortRows(outcome.rows);
    const capped = sorted.slice(0, state.limit);
    // The fitted drive survives the display cap whenever the current filters
    // still admit it: every multiple in the table is measured against that row,
    // and a baseline you cannot see is a baseline you cannot check.
    const fittedRow = sorted.find(row => row.isFittedDrive) || null;
    const shown = (fittedRow && capped.indexOf(fittedRow) === -1) ? [fittedRow, ...capped] : capped;

    container.innerHTML = `
      <div class="tech-card init-view__span">
        <div class="tech-card-header">
          <div class="tech-card-title">DRIVE EXPLORER</div>
          <span>${escapeHtml(payload.selectedDesign.displayName)}</span>
        </div>
        <div class="tech-card-body">
          <div class="de-picker">${renderDesignPicker(payload)}</div>
          ${renderDesignSummary(payload)}
          ${renderLegend(payload)}
          ${renderControls(payload, shown.length, outcome)}
          ${renderTable(payload, shown, outcome)}
          ${renderFooter(payload, shown.length, outcome)}
        </div>
      </div>`;

    bindControls(container);
  }

  function bindControls(container) {
    const design = container.querySelector('[data-de-design]');
    if (design) {
      design.addEventListener('change', () => {
        // A different design is a different measured baseline, so it is the one
        // control that costs a fetch.
        state.designId = design.value;
        load(state.observer, state.mode, state.container, state.designId);
      });
    }
    const sort = container.querySelector('[data-de-sort]');
    if (sort) sort.addEventListener('change', () => { state.sort = sort.value; paint(); });
    const bucket = container.querySelector('[data-de-bucket]');
    if (bucket) bucket.addEventListener('change', () => { state.bucket = bucket.value; paint(); });
    const reactor = container.querySelector('[data-de-reactor]');
    if (reactor) reactor.addEventListener('change', () => { state.reactor = reactor.value; paint(); });
    const rows = container.querySelector('[data-de-rows]');
    if (rows) rows.addEventListener('change', () => { state.limit = Number(rows.value) || 120; paint(); });
    const search = container.querySelector('[data-de-search]');
    if (search) {
      search.addEventListener('input', () => {
        state.search = search.value;
        paint();
        const next = state.container.querySelector('[data-de-search]');
        if (next) { next.focus(); next.setSelectionRange(next.value.length, next.value.length); }
      });
    }

    // The whole catalogue is already in hand, so a minimum filters without a
    // fetch. Focus is restored after the repaint the same way SEARCH does it --
    // a repaint that drops the caret makes a numeric field untypeable.
    const thresholdInputs = container.querySelectorAll('[data-de-threshold]');
    if (thresholdInputs && thresholdInputs.forEach) {
      thresholdInputs.forEach(input => {
        input.addEventListener('input', () => {
          const key = input.getAttribute('data-de-threshold');
          state.thresholds[key] = input.value;
          paint();
          const next = state.container.querySelector(`[data-de-threshold="${key}"]`);
          if (next) next.focus();
        });
      });
    }

    // One delegated listener on the table body, so a re-paint (every sort,
    // filter and search keystroke rebuilds it) cannot leave rows inert.
    const table = container.querySelector('.de-table tbody');
    if (table) {
      table.addEventListener('click', (event) => {
        // The name button is the accessible control; the rest of the row is a
        // mouse convenience on top of it. Either way the same handler runs.
        const button = event.target.closest('[data-de-path]');
        const tableRow = event.target.closest('[data-de-drive]');
        const driveId = button?.getAttribute('data-de-path') || tableRow?.getAttribute('data-de-drive');
        if (!driveId) return;
        event.preventDefault();
        openDrivePath(driveId, button || tableRow.querySelector('[data-de-path]'));
      });
    }
  }

  async function fetchDriveExplorer(observerId, mode, designId) {
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
   * Fetches and paints. Called on first activation of the DRIVES view and
   * whenever the observer or mode changes while it is active, rather than on
   * every dashboard load: the catalogue response is the largest on the site and
   * nothing else on the page needs it.
   */
  async function load(observerId, mode, container, designId) {
    if (!container) return;
    // A design id belongs to one observer. Carrying it across an observer
    // change would ask for a design this faction does not own and get an
    // "unavailable" panel for no reason, so it is cleared rather than reused.
    if (!designId && (state.observer !== observerId || state.mode !== mode)) {
      state.designId = null;
    }
    state.container = container;
    state.observer = observerId;
    state.mode = mode;
    container.innerHTML = `
      <div class="tech-card init-view__span">
        <div class="tech-card-header"><div class="tech-card-title">DRIVE EXPLORER</div><span>LOADING</span></div>
        <div class="tech-card-body"><div class="de-notice">Rating every drive in the catalogue against this design…</div></div>
      </div>`;
    const payload = await fetchDriveExplorer(observerId, mode, designId || state.designId);
    state.payload = payload;
    if (payload && payload.selectedDesign) state.designId = payload.selectedDesign.designId;
    paint();
  }

  /** Renders an already-fetched payload. Used by tests and by re-paints. */
  function render(container, payload) {
    state.container = container;
    state.payload = payload;
    paint();
  }

  global.MissionControlDriveExplorer = {
    load,
    render,
    fetchDriveExplorer,
    openDrivePath,
    // Exposed so the layout verifier and the unit tests exercise the same
    // filtering, sorting and path-modal shaping the panel does, rather than a
    // copy of it.
    _internals: {
      state,
      visibleRows,
      sortRows,
      pathPanelOptions,
      inDependencyOrder,
      rp,
      accel,
      parseThreshold,
      BUCKETS,
      THRESHOLDS,
      ESTIMATE_CAPTION
    }
  };
})(window);
