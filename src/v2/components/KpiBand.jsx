/**
 * src/v2/components/KpiBand.jsx
 *
 * Purpose: render the four executive KPI figures and keep their update stream
 * separate from the COMMAND shell layout. The vanilla save poller publishes
 * new metric readings here; KpiValue owns the per-figure motion state.
 */

import React from 'react';
import { KpiValue } from './KpiValue.jsx';

export const DEFAULT_KPI_METRICS = Object.freeze([
  Object.freeze({
    id: 'kpiMoney',
    label: 'TREASURY',
    value: null,
    state: 'absent',
    text: '$0',
    subText: '+0/mo Flow',
  }),
  Object.freeze({
    id: 'kpiGdp',
    label: 'TERRESTRIAL GDP',
    value: null,
    state: 'absent',
    text: '$0T',
    subText: '0 Control Points',
  }),
  Object.freeze({
    id: 'kpiResearch',
    label: 'RESEARCH OUTPUT',
    value: null,
    state: 'absent',
    text: '0 pts',
    subText: 'R&D Leadership',
  }),
  Object.freeze({
    id: 'kpiPower',
    label: 'STRATEGIC SCORE (EST.)',
    value: null,
    state: 'absent',
    text: '0/100',
    subText: 'Global Rank #1',
  }),
]);

const KPI_IDS = DEFAULT_KPI_METRICS.map((metric) => metric.id);
const metricListeners = new Set();
let latestKpiMetrics = DEFAULT_KPI_METRICS;

function normaliseMetric(metric, previous) {
  if (!metric || !KPI_IDS.includes(metric.id)) return previous;

  const value = Number.isFinite(metric.value) ? metric.value : null;
  const state = value === null
    ? (metric.state === 'unavailable' ? 'unavailable' : 'absent')
    : 'measured';

  return {
    ...previous,
    ...metric,
    value,
    state,
    text: metric.text == null ? previous.text : String(metric.text),
    subText: metric.subText == null ? previous.subText : String(metric.subText),
  };
}

function mergeMetrics(current, incoming) {
  const updates = Array.isArray(incoming) ? incoming : [];
  const byId = new Map(updates.map((metric) => [metric?.id, metric]));
  return current.map((previous) => normaliseMetric(byId.get(previous.id), previous));
}

/**
 * Publish the four KPI readings from the existing save poller. This is a
 * small bridge, not a second data source: the poller still owns all figure and
 * measurement decisions, while the component owns only presentation state.
 */
export function publishKpiMetrics(metrics) {
  latestKpiMetrics = mergeMetrics(latestKpiMetrics, metrics);
  for (const listener of metricListeners) listener(latestKpiMetrics);
}

export function getLatestKpiMetrics() {
  return latestKpiMetrics;
}

function useKpiMetrics() {
  const [metrics, setMetrics] = React.useState(() => latestKpiMetrics);

  React.useEffect(() => {
    metricListeners.add(setMetrics);
    // A poll can land between the initial state read and subscription setup.
    // Re-read the module store so that first paint cannot miss it.
    setMetrics(latestKpiMetrics);
    return () => metricListeners.delete(setMetrics);
  }, []);

  return metrics;
}

export function KpiBand() {
  const metrics = useKpiMetrics();

  return (
    <div className="init-kpi-banner">
      {metrics.map((metric) => (
        <div className="init-kpi-item" key={metric.id}>
          <div className="init-kpi-label">{metric.label}</div>
          <KpiValue
            id={metric.id}
            value={metric.value}
            state={metric.state}
            text={metric.text}
            format={metric.format}
          />
          <div id={`${metric.id}Sub`} className="init-kpi-sub">{metric.subText}</div>
        </div>
      ))}
    </div>
  );
}

