/**
 * src/v2/components/tableVariants.js
 *
 * Purpose: maps DataTable variant keys to the six real table systems in the v2
 * stylesheet — wrap, table, scroll-hint classes and hint placement.
 */

export const TABLE_VARIANTS = {
  de: {
    wrap: 'de-table-wrap',
    table: 'de-table',
    hint: 'de-scroll-hint',
    hintPlacement: 'after',
    th: 'de-th',
    row: 'de-row',
    cell: 'de-cell',
    subVariants: {},
  },
  'mc-board': {
    wrap: 'mc-board-table-wrap',
    table: 'mc-board-table',
    hint: 'mc-board-scroll-hint',
    hintPlacement: 'after',
    th: null,
    row: null,
    cell: null,
    subVariants: {
      ledger: 'mc-board-table--ledger',
      fleet: 'mc-board-table--fleet',
    },
  },
  fe: {
    wrap: 'fe-table-wrap',
    table: 'fe-table',
    hint: 'fe-scroll-hint',
    hintPlacement: 'after',
    th: 'fe-th',
    row: 'fe-row',
    cell: 'fe-cell',
    subVariants: {},
  },
  mining: {
    wrap: 'mining-table-wrap',
    table: 'mining-table',
    hint: null,
    hintPlacement: null,
    th: null,
    row: 'mining-candidate-row',
    cell: null,
    subVariants: {
      upgrades: 'mining-table--upgrades',
    },
  },
  'intel-library': {
    wrap: 'intel-library-table-wrap',
    table: 'intel-library-table',
    hint: 'intel-library-table-scroll-hint',
    hintPlacement: 'inside',
    th: null,
    row: null,
    cell: null,
    subVariants: {},
  },
  'commentary-sim': {
    wrap: null,
    table: 'commentary-sim-table',
    hint: null,
    hintPlacement: null,
    th: null,
    row: null,
    cell: null,
    subVariants: {},
  },
};

export const DEFAULT_SCROLL_HINT_TEXT = 'SWIPE HORIZONTALLY TO SEE MORE COLUMNS';
