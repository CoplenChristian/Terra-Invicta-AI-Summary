/**
 * src/v2/components/valueResolution.mjs
 *
 * Purpose: DOM-free presence resolution shared by the React <Value> primitive
 * and string-building panel utilities. Keeping this core free of JSX lets
 * Node-side callers use the same absent/measured/unavailable contract.
 */

import { parseNumeric } from './parseNumeric.js';

/** The absent affordance. Never a zero, never an empty string. */
export const ABSENT_LABEL = '—';

/** Present, but not readable as a number. Distinct from absent. */
export const UNAVAILABLE_LABEL = 'UNAVAILABLE';

function defaultFormat(value, decimals, numericParser) {
  const num = numericParser(value);
  if (num === null) return UNAVAILABLE_LABEL;
  return num.toLocaleString(undefined, {
    minimumFractionDigits: decimals ?? 0,
    maximumFractionDigits: decimals ?? 0,
  });
}

/**
 * The presence contract as data, for hosts that cannot take an element.
 *
 * @param {object} input
 * @param {string|number|null|undefined} input.value
 * @param {boolean} input.present — explicit presence; do not infer from falsiness
 * @param {number} [input.decimals]
 * @param {(value: string|number) => string} [input.format]
 * @param {string} [input.absentLabel='—']
 * @param {string} [input.unavailableLabel='UNAVAILABLE']
 * @returns {{state: 'absent'|'unavailable'|'measured', text: string, className: string}}
 */
export function resolveValue(options = {}, numericParser = parseNumeric) {
  const {
    value,
    present,
    decimals,
    format,
    absentLabel = ABSENT_LABEL,
    unavailableLabel = UNAVAILABLE_LABEL,
  } = options;

  if (!present) {
    return { state: 'absent', text: absentLabel, className: 'value-absent' };
  }

  const formatter = format ?? ((v) => defaultFormat(v, decimals, numericParser));
  const text = formatter(value);

  if (text === unavailableLabel || text === UNAVAILABLE_LABEL) {
    return { state: 'unavailable', text: unavailableLabel, className: 'value-unavailable' };
  }

  return { state: 'measured', text, className: 'value-measured' };
}
