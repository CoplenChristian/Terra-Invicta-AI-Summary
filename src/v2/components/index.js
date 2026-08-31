/**
 * src/v2/components/index.js
 *
 * Purpose: barrel export for shared React primitives and executive KPI behavior.
 */

export { Panel } from './Panel.jsx';
export { DataTable, syncOneScrollHint, measureScrollable } from './DataTable.jsx';
export { TABLE_VARIANTS, DEFAULT_SCROLL_HINT_TEXT } from './tableVariants.js';
export { Measured } from './Measured.jsx';
export { Estimated } from './Estimated.jsx';
export { Value, resolveValue, ABSENT_LABEL, UNAVAILABLE_LABEL } from './Value.jsx';
export { KpiBand, publishKpiMetrics } from './KpiBand.jsx';
export { KpiValue, useKpiMotion, usePrefersReducedMotion } from './KpiValue.jsx';
export { TruncationNote } from './TruncationNote.jsx';
export { TwoColumnGrid, TwoColumnGridItem } from './TwoColumnGrid.jsx';
