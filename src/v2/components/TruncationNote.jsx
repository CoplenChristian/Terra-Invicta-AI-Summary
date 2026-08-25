/**
 * src/v2/components/TruncationNote.jsx
 *
 * Purpose: announce capped lists with total and omitted counts. An absent omitted
 * count is unknown — never treated as zero or "showing all".
 */

import React from 'react';

function isFiniteCount(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

/**
 * @param {object} props
 * @param {number|null|undefined} props.totalCount
 * @param {number|null|undefined} props.omittedCount — absent means unknown, not zero
 * @param {number|null|undefined} [props.shownCount] — optional; derived when omitted is known
 * @param {string} [props.className]
 * @param {function} [props.formatCount] — locale formatter
 */
export function TruncationNote({
  totalCount,
  omittedCount,
  shownCount,
  className,
  formatCount = (n) => n.toLocaleString('en-US'),
  unknownLabel = 'Truncation count not read — total may be incomplete.',
  allShownLabel = 'All entries shown.',
  ...rest
}) {
  const hasOmitted = isFiniteCount(omittedCount);
  const hasTotal = isFiniteCount(totalCount);

  if (!hasOmitted) {
    return (
      <div
        className={['truncation-note truncation-note--unknown', className].filter(Boolean).join(' ') || undefined}
        data-primitive="truncation-note"
        data-truncation-state="unknown"
        {...rest}
      >
        {unknownLabel}
      </div>
    );
  }

  if (omittedCount <= 0) {
    const totalText = hasTotal ? formatCount(totalCount) : null;
    return (
      <div
        className={['truncation-note truncation-note--complete', className].filter(Boolean).join(' ') || undefined}
        data-primitive="truncation-note"
        data-truncation-state="complete"
        {...rest}
      >
        {totalText != null ? `${allShownLabel} (${formatCount(totalCount)} total).` : allShownLabel}
      </div>
    );
  }

  const shown = isFiniteCount(shownCount)
    ? shownCount
    : (hasTotal ? totalCount - omittedCount : null);

  return (
    <div
      className={['truncation-note truncation-note--truncated', className].filter(Boolean).join(' ') || undefined}
      data-primitive="truncation-note"
      data-truncation-state="truncated"
      {...rest}
    >
      {shown != null
        ? `${formatCount(shown)} shown · ${formatCount(omittedCount)} omitted`
        : `${formatCount(omittedCount)} omitted`}
      {hasTotal ? ` (${formatCount(totalCount)} total)` : ''}
    </div>
  );
}
