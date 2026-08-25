/**
 * src/v2/components/Value.jsx
 *
 * Purpose: render a numeric value or an explicit unavailable/absent state. Never
 * coerce null/undefined/'' to zero — presence is signalled explicitly.
 */

import React from 'react';

function parseNumeric(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function defaultFormat(value, decimals) {
  const num = parseNumeric(value);
  if (num === null) return 'UNAVAILABLE';
  return num.toLocaleString(undefined, {
    minimumFractionDigits: decimals ?? 0,
    maximumFractionDigits: decimals ?? 0,
  });
}

/**
 * @param {object} props
 * @param {string|number|null|undefined} props.value
 * @param {boolean} props.present — explicit presence; do not infer from falsiness
 * @param {number} [props.decimals]
 * @param {(value: string|number) => string} [props.format]
 * @param {string} [props.absentLabel='—']
 * @param {string} [props.unavailableLabel='UNAVAILABLE']
 * @param {string} [props.className]
 */
export function Value({
  value,
  present,
  decimals,
  format,
  absentLabel = '—',
  unavailableLabel = 'UNAVAILABLE',
  className,
  ...rest
}) {
  if (!present) {
    return (
      <span
        className={['value-absent', className].filter(Boolean).join(' ') || undefined}
        data-primitive="value"
        data-value-state="absent"
        {...rest}
      >
        {absentLabel}
      </span>
    );
  }

  const formatter = format ?? ((v) => defaultFormat(v, decimals));
  const text = formatter(value);

  if (text === unavailableLabel || text === 'UNAVAILABLE') {
    return (
      <span
        className={['value-unavailable', className].filter(Boolean).join(' ') || undefined}
        data-primitive="value"
        data-value-state="unavailable"
        {...rest}
      >
        {unavailableLabel}
      </span>
    );
  }

  return (
    <span
      className={['value-measured', className].filter(Boolean).join(' ') || undefined}
      data-primitive="value"
      data-value-state="measured"
      {...rest}
    >
      {text}
    </span>
  );
}
