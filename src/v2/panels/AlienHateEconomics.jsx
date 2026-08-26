/**
 * src/v2/panels/AlienHateEconomics.jsx
 *
 * Purpose: renders the save-derived Mission Control hate floor and Total War
 * proximity in THREAT view, plus imperative HUD hate meter updates.
 */

import React from 'react';
import { parseNumeric } from '../components/parseNumeric.js';
import { Value } from '../components/Value.jsx';

export function fmtNumber(value, decimals = 2) {
  const parsed = parseNumeric(value);
  if (parsed === null) return 'UNAVAILABLE';
  return parsed.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function statusClass(text) {
  const normalized = String(text || '').toLowerCase();
  if (normalized.includes('below') || normalized.includes('not completed')) return 'is-safe';
  if (normalized.includes('exceeded') || normalized.includes('reached')) return 'is-danger';
  return '';
}

const TOTAL_WAR_COPY = {
  active: {
    label: 'TOTAL WAR DECLARED',
    tone: 'is-danger',
    note: 'Hate venting is severely restricted. This war is effectively permanent.',
  },
  armed: {
    label: 'ARMED — HATE GATE ONLY',
    tone: 'is-warning',
    note: 'The year gate has passed. Only the hate ceiling now prevents total war.',
  },
  pending: {
    label: 'PENDING — YEAR GATE ONLY',
    tone: 'is-warning',
    note: 'Hate is already past 200. Total war lands the moment the years elapse.',
  },
  safe: { label: 'BOTH GATES CLOSED', tone: 'is-safe', note: '' },
  armed_hate_unknown: {
    label: 'ARMED — HATE UNKNOWN',
    tone: 'is-warning',
    note: 'The year gate has passed; current hate is not exposed in this view.',
  },
  safe_hate_unknown: {
    label: 'YEAR GATE CLOSED',
    tone: '',
    note: 'Current hate is not exposed in this view.',
  },
  unavailable: {
    label: 'UNAVAILABLE',
    tone: '',
    note: 'Campaign duration or difficulty missing from this snapshot.',
  },
};

function MetricTile({ label, metricValue, note, className = '' }) {
  return (
    <div className={`alien-hate-econ-metric ${className}`.trim()}>
      <span>{label}</span>
      <strong>{metricValue}</strong>
      <small>{note || ''}</small>
    </div>
  );
}

function TotalWarSection({ totalWar, yearsElapsedSource }) {
  if (!totalWar) return null;
  const copy = TOTAL_WAR_COPY[totalWar.state] || TOTAL_WAR_COPY.unavailable;

  const speedCaveat = totalWar.progressionSpeedAssumed === false ? (
    <small>
      Year gate scaled by the save&apos;s Alien Progression Speed of{' '}
      {fmtNumber(totalWar.alienProgressionSpeed, 2)}×.
    </small>
  ) : (
    <small>
      Assumes default Alien Progression Speed; this snapshot carries no campaign-settings block to read it from.
    </small>
  );

  const ageCaveat = typeof yearsElapsedSource === 'string' && yearsElapsedSource ? (
    <small>Campaign age: {yearsElapsedSource}.</small>
  ) : null;

  const hateGateNote = totalWar.hateRemaining === null
    ? 'current hate unknown'
    : totalWar.hateRemaining === undefined
      ? 'UNAVAILABLE to go'
      : `${fmtNumber(totalWar.hateRemaining, 1)} to go`;

  const yearGateNote = totalWar.yearsRemaining === null
    ? 'duration unknown'
    : totalWar.yearsRemaining === undefined
      ? 'UNAVAILABLE yrs to go'
      : totalWar.yearsRemaining === 0
        ? 'PASSED'
        : `${fmtNumber(totalWar.yearsRemaining, 1)} yrs to go`;

  return (
    <div className="alien-hate-econ-section">
      <div className="alien-hate-econ-section-heading">
        <span>TOTAL WAR PROXIMITY</span>
        <small className={`alien-hate-econ-status ${copy.tone}`.trim()}>{copy.label}</small>
      </div>
      <div className="alien-hate-econ-mc-grid">
        <MetricTile
          label="Hate gate"
          metricValue={
            <Value
              present={totalWar.hateThreshold !== null && totalWar.hateThreshold !== undefined}
              value={totalWar.hateThreshold}
              decimals={0}
              absentLabel="UNAVAILABLE"
              format={(v) => fmtNumber(v, 0)}
            />
          }
          note={hateGateNote}
        />
        <MetricTile
          label="Year gate"
          metricValue={
            <>
              <Value
                present={totalWar.yearsThreshold !== null && totalWar.yearsThreshold !== undefined}
                value={totalWar.yearsThreshold}
                decimals={0}
                absentLabel="UNAVAILABLE"
                format={(v) => fmtNumber(v, 0)}
              />{' '}
              yrs
            </>
          }
          note={yearGateNote}
          className={totalWar.yearsRemaining === 0 ? 'is-emphasis' : ''}
        />
        <MetricTile
          label="Maximum hate"
          metricValue={
            <Value
              present={totalWar.maximumAlienHate !== null && totalWar.maximumAlienHate !== undefined}
              value={totalWar.maximumAlienHate}
              decimals={0}
              absentLabel="UNAVAILABLE"
              format={(v) => fmtNumber(v, 0)}
            />
          }
          note="ceiling, grows yearly"
        />
      </div>
      {copy.note ? <p className="alien-hate-econ-note">{copy.note}</p> : null}
      {speedCaveat}
      {ageCaveat}
    </div>
  );
}

export function AlienHateEconomics({ economics }) {
  if (!economics) {
    return <div className="alien-hate-econ-empty">ALIEN HATE ECONOMICS UNAVAILABLE</div>;
  }

  if (!economics.applicable) {
    return (
      <div className="alien-hate-econ-empty">
        <strong>MINIMUM HATE FLOOR NOT APPLICABLE</strong>
        <span>
          The alien Mission Control floor does not apply to {economics.factionName || 'this faction'}.
        </span>
      </div>
    );
  }

  const actual = economics.actualAlienHate;
  const hasActual = actual !== null && actual !== undefined;
  const actualValue = hasActual
    ? fmtNumber(actual, 2)
    : economics.visibleHateEstimate || 'UNAVAILABLE';
  const actualNote = hasActual
    ? 'raw save value'
    : economics.visibleHateEstimate
      ? 'game-visible estimate'
      : 'requires available alien threat intel';

  const ventBlocked = economics.ventingBlockedByTotalWar === true;
  const ventCapacityValue = ventBlocked
    ? 'VOIDED'
    : hasActual
      ? fmtNumber(economics.hateAboveFloor, 2)
      : 'RAW-ONLY';
  const ventCapacityNote = ventBlocked
    ? 'total war — venting restricted'
    : hasActual
      ? 'conditional · ±20%'
      : 'requires raw hate';
  const ventClass = ventBlocked ? 'is-danger' : 'is-emphasis';

  const projects = (economics.reductionProjects || []).filter((project) => project.applicable);
  const currentStatus = economics.currentWarStatus || 'UNAVAILABLE';
  const floorStatus = economics.minimumFloorStatus || 'UNAVAILABLE';

  return (
    <div className="alien-hate-econ">
      <div className="alien-hate-econ-statusbar">
        <div>
          <span className="alien-hate-econ-eyebrow">MINIMUM-HATE FLOOR</span>
          <strong className={`alien-hate-econ-status ${statusClass(floorStatus)}`.trim()}>
            {floorStatus}
          </strong>
        </div>
        <div className={`alien-hate-econ-war-status ${statusClass(currentStatus)}`.trim()}>
          <span>CURRENT HATE</span>
          <strong>{currentStatus}</strong>
        </div>
      </div>

      <div className="alien-hate-econ-grid">
        <MetricTile label="Actual hate" metricValue={actualValue} note={actualNote} />
        <MetricTile
          label="Minimum hate"
          metricValue={
            <Value
              present={economics.minimumAlienHate !== null && economics.minimumAlienHate !== undefined}
              value={economics.minimumAlienHate}
              decimals={2}
              absentLabel="UNAVAILABLE"
              format={(v) => fmtNumber(v, 2)}
            />
          }
          note="floor from used MC"
        />
        <MetricTile
          label="Hate vent capacity"
          metricValue={ventCapacityValue}
          note={ventCapacityNote}
          className={ventClass}
        />
        <MetricTile
          label="War threshold"
          metricValue={
            <Value
              present={economics.warThreshold !== null && economics.warThreshold !== undefined}
              value={economics.warThreshold}
              decimals={2}
              absentLabel="UNAVAILABLE"
              format={(v) => fmtNumber(v, 2)}
            />
          }
          note="alien threshold"
        />
      </div>

      <details className="alien-hate-econ-formula">
        <summary>WHEN DOES HATE ACTUALLY VENT?</summary>
        <div className="alien-hate-econ-formula-body">
          <p>
            The aliens only shed hate when they destroy one of our assets, and only if{' '}
            <strong>all three</strong> hold:
          </p>
          <ul>
            <li>
              We are <strong>not at Total War</strong>.
            </li>
            <li>
              The asset is <strong>not Trespassing</strong> — at or beyond Jupiter, or anywhere the
              aliens hold a hab, except Earth.
            </li>
            <li>
              The aliens <strong>actually targeted</strong> it. Kills made in self-defence vent nothing.
            </li>
          </ul>
          <p>
            Amounts: a ship vents its hull Construction Tier; a complete hab module vents Tier² (+Tier
            if a Mining Complex or Construction Module), divided by 3 on Normal. Every hate modifier is
            also scaled by a random 0.8–1.2, so treat any figure here as ±20%.
          </p>
        </div>
      </details>

      <TotalWarSection
        totalWar={economics.totalWar}
        yearsElapsedSource={economics.yearsElapsedSource}
      />

      <div className="alien-hate-econ-section">
        <div className="alien-hate-econ-section-heading">
          <span>MISSION CONTROL</span>
          <small>USED MC DRIVES HATE · CAPACITY DOES NOT</small>
        </div>
        <div className="alien-hate-econ-mc-grid">
          <MetricTile
            label="Used"
            metricValue={
              <Value
                present={economics.usedMissionControl !== null && economics.usedMissionControl !== undefined}
                value={economics.usedMissionControl}
                decimals={0}
                absentLabel="UNAVAILABLE"
                format={(v) => fmtNumber(v, 0)}
              />
            }
            note="space footprint"
          />
          <MetricTile
            label="Capacity"
            metricValue={
              <Value
                present={economics.missionControlCapacity !== null && economics.missionControlCapacity !== undefined}
                value={economics.missionControlCapacity}
                decimals={0}
                absentLabel="UNAVAILABLE"
                format={(v) => fmtNumber(v, 0)}
              />
            }
            note="context only"
          />
          <MetricTile
            label="MC war floor"
            metricValue={
              <Value
                present={economics.mcWarFloor !== null && economics.mcWarFloor !== undefined}
                value={economics.mcWarFloor}
                decimals={1}
                absentLabel="UNAVAILABLE"
                format={(v) => fmtNumber(v, 1)}
              />
            }
            note="used MC at 50 hate"
          />
        </div>
      </div>

      <div className="alien-hate-econ-section">
        <div className="alien-hate-econ-section-heading">
          <span>CONCEALMENT MODIFIERS</span>
          <small>{String(economics.completedReductionProjectCount || 0)} ACTIVE</small>
        </div>
        <div className="alien-hate-econ-projects">
          {projects.length ? (
            projects.map((project) => (
              <div key={project.label || project.dataName} className="alien-hate-econ-project">
                <span>{project.label}</span>
                <strong className={project.completed ? 'is-complete' : 'is-missing'}>
                  {project.completed ? 'YES · ×0.80' : 'NO'}
                </strong>
              </div>
            ))
          ) : (
            <div className="alien-hate-econ-empty">NO APPLICABLE PROJECT MODIFIERS</div>
          )}
        </div>
      </div>

      <details className="alien-hate-econ-formula">
        <summary>WHY? SHOW CALCULATION</summary>
        <div className="alien-hate-econ-formula-body">
          <code>{economics.formula?.text || 'UNAVAILABLE'}</code>
          <p>
            Only used Mission Control is multiplied by difficulty and the completed concealment
            projects. Mission Control capacity is shown for context and is excluded from this
            calculation.
          </p>
          <div>
            Minimum-hate headroom:{' '}
            <strong>
              <Value
                present={economics.minimumHateHeadroom !== null && economics.minimumHateHeadroom !== undefined}
                value={economics.minimumHateHeadroom}
                decimals={2}
                absentLabel="UNAVAILABLE"
                format={(v) => fmtNumber(v, 2)}
              />
            </strong>{' '}
            · Reduction multiplier:{' '}
            <strong>
              <Value
                present={economics.concealmentMultiplier !== null && economics.concealmentMultiplier !== undefined}
                value={economics.concealmentMultiplier}
                decimals={2}
                absentLabel="UNAVAILABLE"
                format={(v) => fmtNumber(v, 2)}
              />
            </strong>
          </div>
        </div>
      </details>
    </div>
  );
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function pipCount(estimate) {
  const text = String(estimate || '');
  if (!text || text === 'UNAVAILABLE' || text === 'UNKNOWN') return null;
  if (!/■|□/.test(text)) return null;
  return (text.match(/■/g) || []).length;
}

export function renderHudAlienHateEconomics(root, economics, observerHate) {
  if (!root) return;
  const fill = root.querySelector('#hudHateFill');
  const floorMark = root.querySelector('#hudHateFloor');
  const valueNode = root.querySelector('#hudHateValue');
  const statusNode = root.querySelector('#hudHateStatus');
  const warThreshold = Number(economics?.warThreshold) > 0 ? Number(economics.warThreshold) : 50;

  const actual = finiteOrNull(economics?.actualAlienHate);
  const pips = observerHate?.pips ?? pipCount(observerHate?.visibleEstimate || economics?.visibleHateEstimate);
  const estimate = observerHate?.visibleEstimate || economics?.visibleHateEstimate || null;
  const numeric = actual !== null
    ? actual
    : (Number.isFinite(pips) ? pips * 10 : null);
  const floor = finiteOrNull(economics?.minimumAlienHate);
  const applicable = economics?.applicable !== false;
  const unavailable = !applicable
    || (numeric === null && (!estimate || estimate === 'UNAVAILABLE' || estimate === 'UNKNOWN'));

  let tone = 'is-unknown';
  let status = 'UNAVAILABLE';
  let valueText = 'UNAVAILABLE';

  if (!applicable) {
    tone = 'is-unknown';
    status = 'NOT APPLICABLE';
    valueText = '—';
  } else if (unavailable) {
    tone = 'is-unknown';
    status = observerHate?.requiredProject ? 'INTEL GATED' : 'UNAVAILABLE';
    valueText = 'UNAVAILABLE';
  } else if (actual !== null) {
    valueText = `${actual.toFixed(actual >= 10 ? 0 : 1)} / ${warThreshold}`;
    if (numeric >= warThreshold) {
      tone = 'is-danger';
      status = 'WAR THRESHOLD';
    } else if (floor !== null && floor >= warThreshold) {
      tone = 'is-danger';
      status = 'PERM. WAR FLOOR';
    } else if (numeric >= warThreshold * 0.7) {
      tone = 'is-warning';
      status = 'APPROACHING WAR';
    } else {
      tone = 'is-safe';
      status = 'BELOW WAR';
    }
  } else {
    valueText = String(estimate);
    if (pips >= 5) {
      tone = 'is-danger';
      status = 'MAX ESTIMATE';
    } else if (pips >= 4) {
      tone = 'is-warning';
      status = 'HIGH ESTIMATE';
    } else {
      tone = 'is-safe';
      status = 'GAME ESTIMATE';
    }
  }

  root.classList.remove('is-safe', 'is-warning', 'is-danger', 'is-unknown');
  root.classList.add(tone);
  if (valueNode) valueNode.textContent = valueText;
  if (statusNode) statusNode.textContent = status;

  const fillPct = unavailable ? 0 : Math.max(0, Math.min(100, ((numeric ?? 0) / warThreshold) * 100));
  if (fill) fill.style.width = `${fillPct}%`;
  if (floorMark) {
    if (floor === null || unavailable) {
      floorMark.hidden = true;
    } else {
      floorMark.hidden = false;
      floorMark.style.left = `${Math.max(0, Math.min(100, (floor / warThreshold) * 100))}%`;
      floorMark.title = `Minimum hate floor ${floor.toFixed(1)}`;
    }
  }

  const parts = [
    `Alien hate ${valueText}`,
    status,
    floor !== null ? `MC floor ${floor.toFixed(1)}` : null,
    'Open full hate economics',
  ].filter(Boolean);
  root.title = parts.join(' · ');
  root.setAttribute('aria-label', `Alien hate ${valueText}, ${status}. Open full economics.`);
  root.setAttribute('aria-valuemin', '0');
  root.setAttribute('aria-valuemax', String(warThreshold));
  if (numeric !== null) root.setAttribute('aria-valuenow', String(Math.round(numeric)));
  else root.removeAttribute('aria-valuenow');
}
