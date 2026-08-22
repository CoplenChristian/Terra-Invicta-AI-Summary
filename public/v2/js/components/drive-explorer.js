/*
 * Drive Explorer Panel
 * --------------------
 * Purpose: renders the DRIVES view — every drive in the catalogue rated against
 * one of the observer's designs, from /api/intel/drive-explorer, and opens the
 * research path behind a clicked drive from /api/intel/tech-path.
 *
 * THE ONE RULE THIS PANEL EXISTS TO ENFORCE
 * -----------------------------------------
 * Delta-V and combat acceleration are MEASURED: the propulsion model held
 * against this hull's own measured dry mass and tank capacity. Destination
 * reachability is an ESTIMATE from a fixed heuristic table, and only nine
 * destinations are modelled.
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

  // Panel-local view state. Sorting and filtering happen here because the whole
  // catalogue is already in hand; only a design change costs a fetch.
  const state = {
    payload: null,
    designId: null,
    sort: 'delta-v',
    bucket: 'all',
    reactor: 'all',
    search: '',
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
  // ------------------------------------------------------------------------

  function visibleRows(items) {
    const term = state.search.trim().toLowerCase();
    return items.filter(row => {
      if (state.bucket !== 'all' && row.availability.bucket !== state.bucket) return false;
      if (state.reactor === 'compatible' && row.reactor.compatible !== true) return false;
      if (state.reactor === 'incompatible' && row.reactor.compatible !== false) return false;
      if (term) {
        const haystack = `${row.displayName || ''} ${row.driveId || ''} ${row.classification || ''} ${row.propellant || ''}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
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
            <div class="de-summary__value de-measured__value">${dec(fitted.combatAccelerationMps2, 3)}<span class="de-unit"> m/s²</span></div>
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

  function renderControls(payload, shownCount, matchedCount) {
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

    return `
      <div class="de-controls">
        <label class="de-control">
          <span class="de-control__label">SORT BY</span>
          <select class="de-select" data-de-sort>${sortOptions}</select>
        </label>
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
      </div>`;
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
        <td class="de-cell de-measured de-cell--number"${uncomputable ? ` title="${attr(measured.reason || 'not computable against this design')}"` : ''}>
          <div class="de-measured__value">${dec(measured.deltaVKps, 2)}</div>
          <div class="de-cell__sub">${uncomputable ? 'UNAVAILABLE' : `${mult(measured.deltaVMultipleVsFitted)} fitted`}</div>
        </td>
        <td class="de-cell de-measured de-cell--number"${uncomputable ? ` title="${attr(measured.reason || 'not computable against this design')}"` : ''}>
          <div class="de-measured__value">${dec(measured.combatAccelerationMps2, 3)}</div>
          <div class="de-cell__sub">${uncomputable ? 'UNAVAILABLE' : `${mult(measured.combatAccelerationMultipleVsFitted)} fitted`}</div>
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

  function renderTable(payload, rows) {
    if (rows.length === 0) {
      return `<div class="de-notice">No drive matches the current filters. ${escapeHtml(String(payload.driveCatalogue.rated))} drives are rated in this catalogue; widen the filters to see them.</div>`;
    }
    return `
      <div class="de-table-wrap">
        <table class="de-table">
          <thead>
            <tr>
              <th class="de-th">DRIVE</th>
              <th class="de-th de-th--measured">ΔV km/s<span class="de-th__caption">MEASURED</span></th>
              <th class="de-th de-th--measured">COMBAT ACCEL m/s²<span class="de-th__caption">MEASURED</span></th>
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

  function renderFooter(payload, shownCount, matchedCount) {
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

    const matched = visibleRows(payload.items || []);
    const sorted = sortRows(matched);
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
          ${renderControls(payload, shown.length, matched.length)}
          ${renderTable(payload, shown)}
          ${renderFooter(payload, shown.length, matched.length)}
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
    _internals: { state, visibleRows, sortRows, pathPanelOptions, inDependencyOrder, rp, BUCKETS, ESTIMATE_CAPTION }
  };
})(window);
