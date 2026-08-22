/*
 * Per-Fleet Engagement Estimates — THREAT view
 * -------------------------------------------
 * Purpose: renders the per-fleet engagement estimates — what force each alien
 *   fleet would cost, gated on whether the observer can reach it.
 *
 * TWO RENDERING RULES, both load-bearing.
 *
 * 1. THE ESTIMATED REGISTER IS VISIBLY DIFFERENT FROM THE MEASURED ONE.
 *    Ship counts, hull-type counts, locations and arrival dates are read from
 *    the save. The hull band, the opponent rating and (except co-location)
 *    reachability are MODELLED. The two are set in different type -- `.fe-meas`
 *    is upright mono, `.fe-est` is italic sans -- the same split
 *    scripts/verify_drive_explorer.js asserts by computed style on the DRIVES
 *    view. A reader must never have to guess which half of a row is a reading.
 *
 * 2. A RAW null MUST NEVER REACH A TEMPLATE LITERAL. The payload emits null for
 *    everything it could not measure, so every value goes through `int` / `fmt`
 *    / `txt` first. The mining board once shipped "1 MC · nulld" on 109 rows
 *    because a null went straight into `${...}`. An em dash with a title
 *    explaining why is an honest unavailable state; the text "null" is a bug.
 */
(function exposeFleetEngagement(global) {
  'use strict';

  const shared = global.MissionControlShared || {};
  const escapeHtml = shared.escapeHtml || (value => String(value ?? ''));

  const UNAVAILABLE = '—';

  function num(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  const int = (value) => {
    const parsed = num(value);
    return parsed === null ? UNAVAILABLE : String(Math.round(parsed));
  };

  const count = (value) => {
    const parsed = num(value);
    return parsed === null ? UNAVAILABLE : Math.round(parsed).toLocaleString();
  };

  /** A string, or the unavailable dash. Never the text "null". */
  const txt = (value) => {
    if (value === null || value === undefined || value === '') return UNAVAILABLE;
    return escapeHtml(String(value));
  };

  const attr = (value) => escapeHtml(String(value === null || value === undefined ? '' : value));

  /** "1 type" / "3 types" / "— types" — never "1 types". */
  const plural = (value, singular, pluralWord) => {
    const parsed = num(value);
    if (parsed === null) return `${UNAVAILABLE} ${pluralWord}`;
    const rounded = Math.round(parsed);
    return `${rounded} ${rounded === 1 ? singular : pluralWord}`;
  };

  const REACHABILITY_LABEL = {
    'co-located': 'CO-LOCATED',
    reachable: 'REACHABLE',
    'beyond-delta-v': 'BEYOND ΔV',
    unknown: 'REACH UNKNOWN'
  };

  const VERDICT_LABEL = {
    band: 'MODELLED BAND',
    'beyond-modelled-range': 'BEYOND MODELLED RANGE',
    'not-winnable': 'NOT WINNABLE AS SWEPT',
    unknown: 'CANNOT BE ESTIMATED',
    'withheld-unreachable': 'WITHHELD — UNREACHABLE'
  };

  const FIELDABLE_LABEL = {
    sufficient: 'CAN FIELD',
    insufficient: 'CANNOT FIELD',
    unknown: 'UNKNOWN'
  };

  async function fetchFleetEngagement(observerId = 4712, mode = 'player') {
    try {
      const res = await fetch(`/api/intel/fleet-engagement?observer=${observerId}&mode=${mode}&limit=12`);
      if (!res.ok) return null;
      return await res.json();
    } catch (err) {
      console.warn('[FleetEngagement] Failed to fetch engagement estimates:', err);
      return null;
    }
  }

  function renderUnavailable(container, message) {
    container.innerHTML = `<div class="fe-empty">${escapeHtml(message)}</div>`;
  }

  /**
   * The hull requirement cell.
   *
   * Four shapes, and none of them is a bare number: a band, a floor, a
   * withheld verdict, and an un-estimable one. The verdict word is always
   * present so a reader can never mistake an absent number for a small one.
   */
  function requirementCell(row) {
    const req = row.requirement || {};
    const label = VERDICT_LABEL[req.verdict] || 'UNKNOWN';
    if (req.bandLabel) {
      return `
        <div class="fe-need">
          <span class="fe-est__value">${escapeHtml(String(req.bandLabel))}</span>
          <small class="fe-est__text" title="${attr(req.reason || 'Monte Carlo spread of a model across seeded runs; not a measurement.')}">${escapeHtml(label)}</small>
        </div>`;
    }
    return `
      <div class="fe-need fe-need--none">
        <span class="fe-est__text">${UNAVAILABLE}</span>
        <small class="fe-est__text" title="${attr(req.reason || 'no requirement was formed for this fleet')}">${escapeHtml(label)}</small>
      </div>`;
  }

  function reachabilityCell(row) {
    const reach = row.reachability || {};
    const label = REACHABILITY_LABEL[reach.state] || 'REACH UNKNOWN';
    // Co-location is read from the save; every other state is modelled. The
    // class carries that difference, not just the words.
    const registerClass = reach.isEstimate ? 'fe-est__text' : 'fe-meas__value';
    const point = row.engagementPoint && row.engagementPoint.body;
    return `
      <div class="fe-reach fe-reach--${attr(reach.state || 'unknown')}">
        <span class="${registerClass}" title="${attr(reach.reason || (reach.isEstimate ? 'estimated from the shared delta-V destination table' : 'read from the save'))}">${escapeHtml(label)}</span>
        <small class="fe-est__text">${point ? escapeHtml(String(point)) : 'no engagement point'}</small>
      </div>`;
  }

  function fieldableCell(row) {
    const fieldable = row.fieldable || {};
    const label = FIELDABLE_LABEL[fieldable.verdict] || 'UNKNOWN';
    const needed = fieldable.hullsNeeded;
    const have = fieldable.hullsAtEngagementPoint;
    // Spelled out rather than left as "38 / 12": which side of a bare ratio is
    // the requirement is exactly the thing a reader should not have to guess.
    const detail = (needed === null || needed === undefined || have === null || have === undefined)
      ? UNAVAILABLE
      : `${int(have)} reachable / ${int(needed)} needed`;
    return `
      <div class="fe-field fe-field--${attr(fieldable.verdict || 'unknown')}">
        <span class="fe-est__value" title="${attr(fieldable.reason || 'reachable observer hulls against the modelled requirement')}">${escapeHtml(label)}</span>
        <small class="fe-meas__value">${detail}</small>
      </div>`;
  }

  function fleetRow(row) {
    const composition = row.composition || {};
    const composed = (composition.ratedShips || 0) + (composition.unratedShips || 0);
    const compositionTitle = composition.unratedShips > 0
      ? `${composition.ratedShips} of ${composed} ships could be rated, so the requirement is a floor`
      : `composed over all ${composed} of this fleet's own ships, not N copies of a representative one`;
    const movement = row.destination
      ? `→ ${txt(row.destination)}${row.daysToArrival === null || row.daysToArrival === undefined ? '' : ` · ${int(row.daysToArrival)}d`}`
      : 'stationary';

    return `
      <tr class="fe-row${row.threatensObserverAsset ? ' fe-row--threat' : ''}">
        <td class="fe-cell fe-cell--fleet">
          <strong class="fe-meas__value">${txt(row.fleetName)}</strong>
          <small class="fe-meas">${txt(row.orbitBody)} ${escapeHtml(movement)}</small>
        </td>
        <td class="fe-cell fe-cell--mass">
          <span class="fe-meas__value">${int(row.shipsCount)}</span>
          <small class="fe-meas" title="${attr(compositionTitle)}">${escapeHtml(plural(row.distinctHullTypes, 'type', 'types'))}</small>
        </td>
        <td class="fe-cell fe-cell--reach">${reachabilityCell(row)}</td>
        <td class="fe-cell fe-cell--estimate">${requirementCell(row)}</td>
        <td class="fe-cell fe-cell--estimate">${fieldableCell(row)}</td>
      </tr>`;
  }

  function render(container, data) {
    if (!container) return;
    if (!data) {
      renderUnavailable(container, 'ENGAGEMENT ESTIMATES UNAVAILABLE — the endpoint could not be read.');
      return;
    }
    if (!data.available) {
      renderUnavailable(container, `NO ENGAGEMENT ESTIMATE — ${data.reason || 'reason unavailable'}`);
      return;
    }

    const own = data.ownForce || {};
    const rows = Array.isArray(data.items) ? data.items : [];
    const totals = data.reachabilityTotals || {};
    const reachSummary = Object.keys(totals).length === 0
      ? 'reachability not evaluated'
      : Object.keys(totals).map(key => `${totals[key]} ${REACHABILITY_LABEL[key] || key}`).join(' · ');

    container.innerHTML = `
      <div class="fe-board">
        <div class="fe-banner">
          <span class="fe-banner__tag">ESTIMATE</span>
          <span class="fe-est__text">Hull bands are a MODEL, not a reading of the save. The band is
          run-to-run spread of that model and nothing else; the opponent rating behind it is uncalibrated.
          Ship counts, locations and arrival times are measured.</span>
        </div>

        <div class="fe-summary">
          <div class="fe-summary__item">
            <small>OWN FORCE</small>
            <strong class="fe-meas__value">${int(own.totalHulls)} hulls / ${int(own.fleetCount)} fleets</strong>
            <small class="fe-meas" title="${attr(own.ratingSource || '')}">best design ${txt(own.bestDesignName)} · ${count(own.rating)}</small>
          </div>
          <div class="fe-summary__item">
            <small>HOSTILE FLEETS</small>
            <strong class="fe-meas__value">${int(data.fleetsTotalCount)} fleets / ${int(data.shipsTotalCount)} ships</strong>
            <small class="fe-est__text">${escapeHtml(reachSummary)}</small>
          </div>
          <div class="fe-summary__item">
            <small>SHOWING</small>
            <strong class="fe-meas__value">${int(rows.length)} of ${int(data.fleetsTotalCount)}</strong>
            <small class="fe-est__text">${data.fleetsOmittedCount > 0
              ? `${int(data.fleetsOmittedCount)} ranked lower and omitted`
              : 'every tracked fleet shown'}</small>
          </div>
        </div>

        <div class="fe-ordered" title="${attr(data.orderedBy || '')}">ORDERED BY THREAT TO OBSERVER ASSETS, THEN MASS — HOVER FOR THE FULL BASIS</div>

        <div class="fe-table-wrap">
          <table class="fe-table">
            <thead>
              <tr>
                <th class="fe-th fe-th--measured">FLEET</th>
                <th class="fe-th fe-th--measured">SHIPS</th>
                <th class="fe-th fe-th--estimate">REACHABILITY</th>
                <th class="fe-th fe-th--estimate">HULLS NEEDED</th>
                <th class="fe-th fe-th--estimate">OBSERVER CAN FIELD</th>
              </tr>
            </thead>
            <tbody>
              ${rows.length > 0
                ? rows.map(fleetRow).join('')
                : '<tr><td colspan="5" class="fe-empty-cell">No hostile fleet could be estimated in this intelligence picture.</td></tr>'}
            </tbody>
          </table>
        </div>
        <div class="fe-scroll-hint" role="note">Swipe horizontally to inspect all columns</div>

        <div class="fe-footnote fe-est__text">
          <p>${escapeHtml((data.reachabilityModel && data.reachabilityModel.note) || '')}</p>
          <p>${escapeHtml((data.sweep && data.sweep.notWinnableIsNotAConclusion) || '')}</p>
        </div>
      </div>`;
  }

  global.MissionControlFleetEngagement = {
    render,
    fetchFleetEngagement
  };
})(window);
