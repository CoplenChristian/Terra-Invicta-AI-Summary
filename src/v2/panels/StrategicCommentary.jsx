/**
 * src/v2/panels/StrategicCommentary.jsx
 *
 * Purpose: renders the non-LLM four-layer Strategic Commentary Engine output
 * beneath Hold Ground / Priority Brief in COMMAND view.
 */

import React from 'react';
import { DataTable } from '../components/DataTable.jsx';
import { MAX_SIMULATED_HULLS } from '../../../shared/engagementModel.mjs';

function useCommentaryModeBadge(commentaryData) {
  React.useEffect(() => {
    const badgeEl = document.getElementById('commentaryModeBadge');
    if (!badgeEl || !commentaryData || commentaryData.available === false) return;
    badgeEl.textContent = commentaryData.mode === 'omniscient'
      ? 'OMNISCIENT BLUEPRINTS'
      : 'OBSERVED TELEMETRY';
  }, [commentaryData?.available, commentaryData?.mode]);
}

function ThresholdCell({ tier }) {
  if (tier.winnable === true) {
    const unc = tier.uncertainty;
    const partialNote = unc && typeof unc.winnableRatio === 'number' && unc.winnableRatio < 1
      ? ` — band over ${Math.round(unc.winnableRatio * 100)}% of seeds only`
      : '';
    return (
      <>
        <em title={unc?.bandCovers || undefined}>{tier.bandLabel}</em>
        {unc ? (
          <small
            className="commentary-band-qualifier"
            style={{ color: 'var(--text-dim)', fontSize: 'var(--fs-tag)' }}
            title={unc.bandCovers}
          >
            {' '}
            (p20–p80 over {unc.seedsSimulated} seeds{partialNote})
          </small>
        ) : null}
      </>
    );
  }

  if (tier.winnable === false) {
    const maxHulls = tier.uncertainty?.maxHullsSwept ?? MAX_SIMULATED_HULLS;
    return (
      <span
        className="commentary-threshold-beyond"
        style={{
          color: 'var(--danger)',
          fontFamily: 'var(--mono)',
          fontSize: 'var(--fs-tag)',
        }}
        title="Requirement is beyond the modelled range, not an impossibility verdict"
      >
        more than {maxHulls} hulls
      </span>
    );
  }

  return (
    <span
      className="commentary-threshold-unknown"
      style={{ color: 'var(--text-dim)', fontFamily: 'var(--mono)', fontSize: 'var(--fs-tag)' }}
    >
      UNAVAILABLE
    </span>
  );
}

function SimUncertaintyFootnote({ tiers }) {
  const unc = (tiers || []).find((tier) => tier?.uncertainty)?.uncertainty;
  if (!unc) return null;

  return (
    <details className="commentary-sim-uncertainty">
      <summary>What these hull counts mean (simulated band, not a measured requirement)</summary>
      <div className="commentary-sim-uncertainty-body">
        <p>{unc.bandCovers}</p>
        {Array.isArray(unc.bandExcludes) && unc.bandExcludes.length > 0 ? (
          <ul>
            {unc.bandExcludes.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}
        {typeof unc.winnableRatio === 'number' && unc.winnableRatio < 1 ? (
          <p>
            Band computed over {unc.bandComputedOver}; only{' '}
            {Math.round(unc.winnableRatio * 100)}% of seeds reached the target, so the spread is
            understated.
          </p>
        ) : null}
      </div>
    </details>
  );
}

function CommentaryBeats({ beats }) {
  if (!Array.isArray(beats) || beats.length === 0) return null;

  return (
    <div className="commentary-beats-grid">
      {beats.map((beat) => (
        <div
          key={beat.id || beat.name}
          className={`commentary-beat-chip commentary-beat-chip--${beat.severity || 'standard'}`}
          title={beat.summary || ''}
        >
          <strong>{beat.name || beat.id}</strong>
          <span> • {beat.severity || 'info'}</span>
        </div>
      ))}
    </div>
  );
}

function SimSection({ sim }) {
  if (sim.available === false) {
    return (
      <div className="commentary-sim-section">
        <div className="commentary-sim-header">
          <span>COMBAT THRESHOLDS</span>
          <span className="commentary-sim-badge">NOT SIMULATED</span>
        </div>
        <div className="commentary-empty">
          {sim.reason
            || 'The combat-threshold simulation did not run and gave no reason; no hull count is reported.'}
        </div>
      </div>
    );
  }

  if (!sim.available || !Array.isArray(sim.tiers) || sim.tiers.length === 0) {
    return null;
  }

  const columns = [
    { key: 'tier', label: 'Opponent Force Tier' },
    { key: 'signature', label: 'Observed Target Signature' },
    { key: 'threshold', label: 'Threshold Required', align: 'right' },
  ];

  const rows = sim.tiers.map((tier) => ({
    key: tier.id || tier.label,
    tier: <strong>{tier.label}</strong>,
    signature: (
      <small style={{ color: 'var(--text-dim)' }}>{tier.description || ''}</small>
    ),
    threshold: <ThresholdCell tier={tier} />,
  }));

  return (
    <div className="commentary-sim-section">
      <div className="commentary-sim-header">
        <span>
          COMBAT THRESHOLDS ({sim.ownBestDesign || sim.ownBestHull || 'Force'})
        </span>
        <span className="commentary-sim-badge">P(WIN) ≥ 80% • MONTE CARLO SIMULATED</span>
      </div>
      <DataTable variant="commentary-sim" columns={columns} rows={rows} />
      <SimUncertaintyFootnote tiers={sim.tiers} />
    </div>
  );
}

function formatRebuildHeadline(clock) {
  const rate = Number(clock.monthlyThroughputEst);
  const days = Number(clock.daysPerHullEst);
  const subMonthly = Number.isFinite(rate) && rate > 0 && rate < 1 && Number.isFinite(days);
  const floor = clock.throughputBound === 'lower' ? '≥ ' : '';

  if (!Number.isFinite(rate)) return 'UNAVAILABLE';
  if (subMonthly) return `1 per ${days} days`;
  return `${floor}${rate} hulls/mo`;
}

function formatRebuildRateDetail(clock) {
  const rate = Number(clock.monthlyThroughputEst);
  const days = Number(clock.daysPerHullEst);
  const subMonthly = Number.isFinite(rate) && rate > 0 && rate < 1 && Number.isFinite(days);
  const floor = clock.throughputBound === 'lower' ? '≥ ' : '';

  if (!Number.isFinite(rate)) {
    return clock.throughputUnavailableReason || 'no build time was readable';
  }
  if (subMonthly) {
    return `${floor}${rate} hulls/mo — under one a month`;
  }
  return Number.isFinite(days) ? `1 per ${days} days` : 'nothing is building';
}

function formatYardDetail(clock) {
  const building = Number(clock.concurrentBuilds);
  const waiting = Number(clock.waitingBehindCount);
  const yards = Number(clock.shipyardCount);

  if (Number.isFinite(yards)) {
    return `${building} of ${yards} yard(s) building, ${waiting} waiting`;
  }
  return `${building} building, ${waiting} waiting — yard count unread`;
}

function formatNextDetail(clock) {
  const next = Number(clock.nextCompletionDays);
  return Number.isFinite(next) ? `next in ${next}d` : 'no horizon read';
}

function CommentaryProjections({ projections }) {
  const proj = projections || {};
  const cards = [];

  if (proj.hateVent && proj.hateVent.available) {
    cards.push(
      <div key="hate-vent" className="commentary-proj-card">
        <div className="commentary-proj-label">HATE VENT HORIZON</div>
        <div className="commentary-proj-val">{proj.hateVent.bandLabel}</div>
        <small style={{ color: 'var(--text-dim)', fontSize: 'var(--fs-tag)' }}>
          To cross below war threshold
        </small>
      </div>,
    );
  } else if (proj.hateVent && proj.hateVent.reason) {
    cards.push(
      <div key="hate-vent-unavailable" className="commentary-proj-card">
        <div className="commentary-proj-label">HATE VENT HORIZON</div>
        <div className="commentary-proj-val">UNAVAILABLE</div>
        <small style={{ color: 'var(--text-dim)', fontSize: 'var(--fs-tag)' }}>
          {proj.hateVent.reason}
        </small>
      </div>,
    );
  }

  if (proj.rebuildClock && proj.rebuildClock.available) {
    const clock = proj.rebuildClock;
    cards.push(
      <div key="rebuild-clock" className="commentary-proj-card">
        <div className="commentary-proj-label">PRODUCTION THROUGHPUT</div>
        <div className="commentary-proj-val">{formatRebuildHeadline(clock)}</div>
        <small style={{ color: 'var(--text-dim)', fontSize: 'var(--fs-tag)' }}>
          {clock.targetHull} — {formatRebuildRateDetail(clock)} ({formatYardDetail(clock)};{' '}
          {formatNextDetail(clock)}; one hull per yard, measured)
        </small>
      </div>,
    );
  } else if (proj.rebuildClock && proj.rebuildClock.reason) {
    cards.push(
      <div key="rebuild-clock-unavailable" className="commentary-proj-card">
        <div className="commentary-proj-label">PRODUCTION THROUGHPUT</div>
        <div className="commentary-proj-val">UNAVAILABLE</div>
        <small style={{ color: 'var(--text-dim)', fontSize: 'var(--fs-tag)' }}>
          {proj.rebuildClock.reason}
        </small>
      </div>,
    );
  }

  if (cards.length === 0) return null;

  return <div className="commentary-projections">{cards}</div>;
}

export function StrategicCommentary({ data }) {
  useCommentaryModeBadge(data);

  if (!data || data.available === false) {
    return (
      <div className="commentary-empty">
        {data?.reason || 'Strategic commentary telemetry unavailable for this save.'}
      </div>
    );
  }

  return (
    <div className="commentary-content">
      <div className="commentary-headline">{data.headline || 'Strategic Assessment'}</div>
      <blockquote className="commentary-prose">{data.prose || ''}</blockquote>
      <CommentaryBeats beats={data.beats} />
      <SimSection sim={data.simulation || {}} />
      <CommentaryProjections projections={data.simulation?.projections} />
    </div>
  );
}
