/**
 * src/v2/panels/FleetEngagement.jsx
 *
 * Purpose: renders the per-fleet engagement estimates — what force each alien
 *   fleet would cost, gated on whether the observer can reach it.
 */

import React from 'react';
import { DataTable } from '../components/DataTable.jsx';
import { Measured } from '../components/Measured.jsx';
import { Estimated } from '../components/Estimated.jsx';
import { parseNumeric } from '../components/parseNumeric.js';

const UNAVAILABLE = '—';

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

function int(value) {
  const parsed = parseNumeric(value);
  return parsed === null ? UNAVAILABLE : String(Math.round(parsed));
}

function count(value) {
  const parsed = parseNumeric(value);
  return parsed === null ? UNAVAILABLE : Math.round(parsed).toLocaleString();
}

function txt(value) {
  if (value === null || value === undefined || value === '') return UNAVAILABLE;
  return String(value);
}

function plural(value, singular, pluralWord) {
  const parsed = parseNumeric(value);
  if (parsed === null) return `${UNAVAILABLE} ${pluralWord}`;
  const rounded = Math.round(parsed);
  return `${rounded} ${rounded === 1 ? singular : pluralWord}`;
}

function isFiniteCount(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

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
    return `${int(composition.ratedShips)} of ${int(composed)} ships could be rated, so the requirement is a floor`;
  }
  return `composed over all ${int(composed)} of this fleet's own ships, not N copies of a representative one`;
}

function fleetMovement(row) {
  if (!row.destination) return 'stationary';
  let movement = `→ ${txt(row.destination)}`;
  if (row.daysToArrival !== null && row.daysToArrival !== undefined) {
    movement += ` · ${int(row.daysToArrival)}d`;
  }
  return movement;
}

function reachSummary(totals) {
  if (!totals || Object.keys(totals).length === 0) return 'reachability not evaluated';
  return Object.keys(totals)
    .map((key) => `${totals[key]} ${REACHABILITY_LABEL[key] || key}`)
    .join(' · ');
}

function omittedNote(fleetsOmittedCount) {
  if (isFiniteCount(fleetsOmittedCount)) {
    if (fleetsOmittedCount > 0) {
      return `${int(fleetsOmittedCount)} ranked lower and omitted`;
    }
    return 'every tracked fleet shown';
  }
  return 'omitted count not read — list may be incomplete';
}

function RequirementCell({ row }) {
  const req = row.requirement || {};
  const label = VERDICT_LABEL[req.verdict] || 'UNKNOWN';
  const reasonTitle = req.reason
    || (req.bandLabel
      ? 'Monte Carlo spread of a model across seeded runs; not a measurement.'
      : 'no requirement was formed for this fleet');

  if (req.bandLabel) {
    return (
      <div className="fe-need">
        <Estimated register="fe" value={String(req.bandLabel)} />
        <small className="fe-est__text" title={reasonTitle}>{label}</small>
      </div>
    );
  }

  return (
    <div className="fe-need fe-need--none">
      <span className="fe-est__text">{UNAVAILABLE}</span>
      <small className="fe-est__text" title={reasonTitle}>{label}</small>
    </div>
  );
}

function ReachabilityCell({ row }) {
  const reach = row.reachability || {};
  const label = REACHABILITY_LABEL[reach.state] || 'REACH UNKNOWN';
  const point = row.engagementPoint && row.engagementPoint.body;
  const title = reach.reason
    || (reach.isEstimate
      ? 'estimated from the shared delta-V destination table'
      : 'read from the save');

  return (
    <div className={`fe-reach fe-reach--${reach.state || 'unknown'}`}>
      {reach.isEstimate ? (
        <span className="fe-est__text" title={title}>{label}</span>
      ) : (
        <Measured register="fe" value={label} title={title} />
      )}
      <small className="fe-est__text">{point ? String(point) : 'no engagement point'}</small>
    </div>
  );
}

function FieldableCell({ row }) {
  const fieldable = row.fieldable || {};
  const label = FIELDABLE_LABEL[fieldable.verdict] || 'UNKNOWN';
  const needed = fieldable.hullsNeeded;
  const have = fieldable.hullsAtEngagementPoint;
  const missingSide = needed === null || needed === undefined
    || have === null || have === undefined;

  return (
    <div className={`fe-field fe-field--${fieldable.verdict || 'unknown'}`}>
      <Estimated
        register="fe"
        value={label}
        title={fieldable.reason || 'reachable observer hulls against the modelled requirement'}
      />
      <small className="fe-meas__value">
        {missingSide ? UNAVAILABLE : `${int(have)} reachable / ${int(needed)} needed`}
      </small>
    </div>
  );
}

function FleetRow({ row }) {
  const composition = row.composition || {};
  const title = compositionTitle(composition);
  const movement = fleetMovement(row);

  return (
    <tr className={`fe-row${row.threatensObserverAsset ? ' fe-row--threat' : ''}`}>
      <td className="fe-cell fe-cell--fleet">
        <Measured register="fe" as="strong" value={txt(row.fleetName)} />
        <small className="fe-meas">
          {txt(row.orbitBody)} {movement}
        </small>
      </td>
      <td className="fe-cell fe-cell--mass">
        <Measured register="fe" value={int(row.shipsCount)} />
        <small className="fe-meas" title={title}>
          {plural(row.distinctHullTypes, 'type', 'types')}
        </small>
      </td>
      <td className="fe-cell fe-cell--reach">
        <ReachabilityCell row={row} />
      </td>
      <td className="fe-cell fe-cell--estimate">
        <RequirementCell row={row} />
      </td>
      <td className="fe-cell fe-cell--estimate">
        <FieldableCell row={row} />
      </td>
    </tr>
  );
}

function FleetEngagementBoard({ data }) {
  const own = data.ownForce || {};
  const rows = Array.isArray(data.items) ? data.items : [];
  const totals = data.reachabilityTotals || {};
  const summary = reachSummary(totals);

  const columns = [
    { key: 'fleet', label: 'FLEET', headerClassName: 'fe-th--measured' },
    { key: 'ships', label: 'SHIPS', headerClassName: 'fe-th--measured' },
    { key: 'reach', label: 'REACHABILITY', headerClassName: 'fe-th--estimate' },
    { key: 'need', label: 'HULLS NEEDED', headerClassName: 'fe-th--estimate' },
    { key: 'field', label: 'OBSERVER CAN FIELD', headerClassName: 'fe-th--estimate' },
  ];

  return (
    <div className="fe-board">
      <div className="fe-banner">
        <span className="fe-banner__tag">ESTIMATE</span>
        <span className="fe-est__text">
          Hull bands are a MODEL, not a reading of the save. The band is
          run-to-run spread of that model and nothing else; the opponent rating behind it is uncalibrated.
          Ship counts, locations and arrival times are measured.
        </span>
      </div>

      <div className="fe-summary">
        <div className="fe-summary__item">
          <small>OWN FORCE</small>
          <strong className="fe-meas__value">
            {int(own.totalHulls)} hulls / {int(own.fleetCount)} fleets
          </strong>
          <small className="fe-meas" title={own.ratingSource || ''}>
            best design {txt(own.bestDesignName)} · {count(own.rating)}
          </small>
        </div>
        <div className="fe-summary__item">
          <small>HOSTILE FLEETS</small>
          <strong className="fe-meas__value">
            {int(data.fleetsTotalCount)} fleets / {int(data.shipsTotalCount)} ships
          </strong>
          <small className="fe-est__text">{summary}</small>
        </div>
        <div className="fe-summary__item">
          <small>SHOWING</small>
          <strong className="fe-meas__value">
            {int(rows.length)} of {int(data.fleetsTotalCount)}
          </strong>
          <small className="fe-est__text">{omittedNote(data.fleetsOmittedCount)}</small>
        </div>
      </div>

      <div className="fe-ordered" title={data.orderedBy || ''}>
        ORDERED BY THREAT TO OBSERVER ASSETS, THEN MASS — HOVER FOR THE FULL BASIS
      </div>

      <DataTable
        variant="fe"
        columns={columns}
        hintText="Swipe horizontally to inspect all columns"
      >
        <tbody>
          {rows.length > 0 ? (
            rows.map((row) => <FleetRow key={row.fleetId || row.fleetName} row={row} />)
          ) : (
            <tr>
              <td colSpan={5} className="fe-empty-cell">
                No hostile fleet could be estimated in this intelligence picture.
              </td>
            </tr>
          )}
        </tbody>
      </DataTable>

      <div className="fe-footnote fe-est__text">
        <p>{(data.reachabilityModel && data.reachabilityModel.note) || ''}</p>
        <p>{(data.sweep && data.sweep.notWinnableIsNotAConclusion) || ''}</p>
      </div>
    </div>
  );
}

export function FleetEngagement({ data }) {
  if (!data) {
    return (
      <div className="fe-empty">
        ENGAGEMENT ESTIMATES UNAVAILABLE — the endpoint could not be read.
      </div>
    );
  }

  if (!data.available) {
    return (
      <div className="fe-empty">
        {`NO ENGAGEMENT ESTIMATE — ${data.reason || 'reason unavailable'}`}
      </div>
    );
  }

  return <FleetEngagementBoard data={data} />;
}
