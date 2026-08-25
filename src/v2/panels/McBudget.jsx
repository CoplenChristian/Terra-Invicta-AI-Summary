/**
 * src/v2/panels/McBudget.jsx
 *
 * Purpose: Mission Control budget planner — MC is the sole input to the alien
 * minimum-hate floor, so fleet staging is also a diplomacy decision.
 */

import React from 'react';
import { parseNumeric } from '../components/parseNumeric.js';
import { Value } from '../components/Value.jsx';

const HULL_ORDER = [
  'Escort', 'Frigate', 'Monitor', 'Destroyer',
  'Cruiser', 'Battlecruiser', 'Battleship', 'Lancer',
];

function fmtFixed(value, decimals = 1) {
  const parsed = parseNumeric(value);
  if (parsed === null) return 'UNAVAILABLE';
  return parsed.toFixed(decimals);
}

function orderedHulls(hullStats) {
  const known = Object.keys(hullStats || {});
  const lead = HULL_ORDER.filter((name) => known.includes(name));
  return lead.length ? lead : known.slice(0, 8);
}

function computeMultiplier(economics) {
  const diffMult = parseNumeric(economics.difficultyMultiplier);
  const concealMult = parseNumeric(economics.concealmentMultiplier);
  if (diffMult === null) return null;
  return diffMult * (concealMult === null ? 1 : concealMult);
}

function McBudgetBody({ economics, shipHullStats, staged, onStageChange, onReset }) {
  const hullStats = shipHullStats || {};
  const used = parseNumeric(economics.usedMissionControl);
  const cap = parseNumeric(economics.missionControlCapacity);
  const warFloor = parseNumeric(economics.mcWarFloor);
  const multiplier = computeMultiplier(economics);

  const hulls = orderedHulls(hullStats);
  const stagedMc = hulls.reduce((total, hull) => {
    const count = parseNumeric(staged[hull]) ?? 0;
    const perHull = parseNumeric(hullStats[hull]?.missionControl);
    return total + (perHull === null ? 0 : perHull * count);
  }, 0);
  const stagedShips = hulls.reduce(
    (total, hull) => total + (parseNumeric(staged[hull]) ?? 0),
    0,
  );

  const projectedUsed = used === null ? null : used + stagedMc;
  const projectedFloor =
    projectedUsed === null || multiplier === null ? null : projectedUsed * multiplier;

  const capExceeded = cap !== null && projectedUsed !== null && projectedUsed > cap;
  const warExceeded = warFloor !== null && projectedUsed !== null && projectedUsed > warFloor;

  let verdict = { label: 'WITHIN BUDGET', tone: 'is-safe', note: '' };
  if (capExceeded && warExceeded) {
    verdict = {
      label: 'EXCEEDS BOTH CEILINGS',
      tone: 'is-danger',
      note: 'This fleet cannot be built and would guarantee permanent alien war.',
    };
  } else if (capExceeded) {
    verdict = {
      label: 'EXCEEDS MC CAPACITY',
      tone: 'is-danger',
      note: 'Capacity binds before the hate floor does. Raise MC capacity or cut the build.',
    };
  } else if (warExceeded) {
    verdict = {
      label: 'CROSSES PERMANENT-WAR FLOOR',
      tone: 'is-danger',
      note: 'Used MC would push the minimum hate floor past 50 — peace becomes impossible.',
    };
  } else if (stagedShips > 0) {
    verdict = {
      label: 'WITHIN BUDGET',
      tone: 'is-safe',
      note: `${stagedShips} ship(s) · +${stagedMc} MC · floor ${fmtFixed(projectedFloor)}`,
    };
  }

  const capHeadroom = cap !== null && used !== null ? cap - used : null;
  const warHeadroom = warFloor !== null && used !== null ? warFloor - used : null;

  const stepHull = (hull, step) => {
    const next = Math.max(0, (parseNumeric(staged[hull]) ?? 0) + step);
    onStageChange(hull, next);
  };

  return (
    <div className="mc-budget">
      <div className="alien-hate-econ-statusbar">
        <div>
          <span className="alien-hate-econ-eyebrow">MISSION CONTROL BUDGET</span>
          <strong className={`alien-hate-econ-status ${verdict.tone}`}>{verdict.label}</strong>
        </div>
        <div className="alien-hate-econ-war-status">
          <span>PROJECTED FLOOR</span>
          <strong>{fmtFixed(projectedFloor)}</strong>
        </div>
      </div>

      <div className="alien-hate-econ-mc-grid">
        <div className="alien-hate-econ-metric">
          <span>Used now</span>
          <strong>
            <Value
              present
              value={used}
              decimals={0}
              format={(v) => fmtFixed(v, 0)}
            />
          </strong>
          <small>
            of{' '}
            <Value
              present
              value={cap}
              decimals={0}
              format={(v) => fmtFixed(v, 0)}
            />{' '}
            capacity
          </small>
        </div>
        <div className="alien-hate-econ-metric">
          <span>Headroom to cap</span>
          <strong>
            <Value
              present
              value={capHeadroom}
              decimals={0}
              format={(v) => fmtFixed(v, 0)}
            />
          </strong>
          <small>hard build limit</small>
        </div>
        <div
          className={[
            'alien-hate-econ-metric',
            warHeadroom !== null && capHeadroom !== null && warHeadroom < capHeadroom
              ? 'is-emphasis'
              : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <span>Headroom to war floor</span>
          <strong>
            <Value
              present
              value={warHeadroom}
              decimals={0}
              format={(v) => fmtFixed(v, 0)}
            />
          </strong>
          <small>used MC at 50 hate</small>
        </div>
        <div className={['alien-hate-econ-metric', stagedMc > 0 ? 'is-emphasis' : '']
          .filter(Boolean)
          .join(' ')}
        >
          <span>Staged build</span>
          <strong>+{stagedMc}</strong>
          <small>{stagedShips} ship(s)</small>
        </div>
      </div>

      {verdict.note ? <p className="alien-hate-econ-note">{verdict.note}</p> : null}

      <div className="alien-hate-econ-section">
        <div className="alien-hate-econ-section-heading">
          <span>STAGE A BUILD</span>
          <small>PER-HULL MC FROM GAME TEMPLATES</small>
        </div>
        <div className="mc-budget-hulls">
          {hulls.map((hull) => {
            const stats = hullStats[hull] || {};
            const perHull = parseNumeric(stats.missionControl);
            const count = parseNumeric(staged[hull]) ?? 0;
            const days = stats.baseConstructionTimeDays;
            return (
              <div key={hull} className="mc-budget-hull">
                <span className="mc-budget-hull-name">{hull}</span>
                <span className="mc-budget-hull-cost">
                  {perHull === null ? '?' : perHull} MC
                  {days ? ` · ${days}d` : ''}
                </span>
                <span className="mc-budget-hull-controls">
                  <button
                    type="button"
                    data-mc-hull={hull}
                    data-mc-step="-1"
                    aria-label={`Remove one ${hull}`}
                    onClick={() => stepHull(hull, -1)}
                  >
                    −
                  </button>
                  <output>{count}</output>
                  <button
                    type="button"
                    data-mc-hull={hull}
                    data-mc-step="1"
                    aria-label={`Add one ${hull}`}
                    onClick={() => stepHull(hull, 1)}
                  >
                    +
                  </button>
                </span>
              </div>
            );
          })}
        </div>
        {stagedShips > 0 ? (
          <button type="button" className="mc-budget-reset" data-mc-reset onClick={onReset}>
            CLEAR STAGED BUILD
          </button>
        ) : null}
      </div>

      <details className="alien-hate-econ-formula">
        <summary>WHY DOES BUILDING RAISE ALIEN HATE?</summary>
        <div className="alien-hate-econ-formula-body">
          <p>
            The alien minimum-hate floor is{' '}
            <code>used MC × difficulty × 0.8 per concealment project</code>. Only{' '}
            <strong>used</strong> Mission Control counts — capacity never does. Every hull
            consumes MC permanently while it exists, so fleet size sets a hate floor you
            cannot vent below.
          </p>
          <p>
            Mines compete for the same budget: past the mine limit (36, or 42 for Project
            Exodus) each excess mine adds <code>Max(1, Floor(excess² / 2))</code> MC.
          </p>
        </div>
      </details>
    </div>
  );
}

export function McBudget({ payload }) {
  const [staged, setStaged] = React.useState({});

  const economics = payload?.economics;
  const shipHullStats = payload?.shipHullStats;

  if (!economics || !economics.applicable) {
    return <div className="alien-hate-econ-empty">MC BUDGET UNAVAILABLE</div>;
  }

  const handleStageChange = (hull, next) => {
    setStaged((prev) => ({ ...prev, [hull]: next }));
  };

  const handleReset = () => {
    setStaged({});
  };

  return (
    <McBudgetBody
      economics={economics}
      shipHullStats={shipHullStats}
      staged={staged}
      onStageChange={handleStageChange}
      onReset={handleReset}
    />
  );
}

