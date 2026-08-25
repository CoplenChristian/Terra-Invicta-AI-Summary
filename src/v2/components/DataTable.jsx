/**
 * src/v2/components/DataTable.jsx
 *
 * Purpose: one real `<table>` primitive for all six v2 table systems, with
 * variant/sub-variant class names, the shared wrap where one exists, and scroll
 * hints driven by measured overflow (scrollWidth vs clientWidth), never viewport
 * width.
 */

import React from 'react';
import { TABLE_VARIANTS, DEFAULT_SCROLL_HINT_TEXT } from './tableVariants.js';

function tableClassNames(variantKey, subVariant) {
  const config = TABLE_VARIANTS[variantKey];
  if (!config) {
    throw new Error(`DataTable: unknown variant "${variantKey}"`);
  }
  const classes = [config.table];
  if (subVariant && config.subVariants[subVariant]) {
    classes.push(config.subVariants[subVariant]);
  }
  return classes.join(' ');
}

function resolveWrapper(hintEl, placement, wrapSelector) {
  if (!hintEl) return null;
  if (placement === 'inside') {
    const wrap = hintEl.parentElement;
    return wrap && wrap.matches(wrapSelector) ? wrap : null;
  }
  const wrap = hintEl.previousElementSibling;
  return wrap && wrap.matches(wrapSelector) ? wrap : null;
}

function measureScrollable(wrap) {
  if (!wrap) return false;
  return wrap.scrollWidth > wrap.clientWidth + 1;
}

function syncOneScrollHint(hintEl, wrapSelector, placement) {
  if (!hintEl) return;
  const wrap = resolveWrapper(hintEl, placement, wrapSelector);
  hintEl.classList.toggle('is-scrollable', measureScrollable(wrap));
}

/**
 * @param {object} props
 * @param {'de'|'mc-board'|'fe'|'mining'|'intel-library'|'commentary-sim'} props.variant
 * @param {string} [props.subVariant] — ledger | fleet | upgrades
 * @param {Array<{ key: string, label: React.ReactNode, align?: string, className?: string, headerClassName?: string }>} [props.columns]
 * @param {Array<Record<string, React.ReactNode>>} [props.rows]
 * @param {string} [props.hintText]
 * @param {string} [props.className] — extra classes on the wrap
 * @param {React.ReactNode} [props.children] — custom table body (overrides rows)
 */
export function DataTable({
  variant,
  subVariant,
  columns,
  rows,
  hintText = DEFAULT_SCROLL_HINT_TEXT,
  className,
  children,
  caption,
  ...rest
}) {
  const config = TABLE_VARIANTS[variant];
  const wrapRef = React.useRef(null);
  const hintRef = React.useRef(null);

  const syncHint = React.useCallback(() => {
    if (!config.hint || !hintRef.current || !config.wrap) return;
    syncOneScrollHint(hintRef.current, `.${config.wrap}`, config.hintPlacement);
  }, [config]);

  React.useLayoutEffect(() => {
    syncHint();
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === 'undefined') return undefined;

    const observer = new ResizeObserver(() => syncHint());
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [syncHint, columns, rows, children]);

  const wrapClasses = [config.wrap, className].filter(Boolean).join(' ');
  const tableClasses = tableClassNames(variant, subVariant);
  const bareTable = !config.wrap;

  const thClass = config.th || undefined;
  const rowClass = config.row || undefined;
  const cellClass = config.cell || undefined;

  const hintEl = config.hint
    ? (
      <div
        ref={hintRef}
        className={config.hint}
        data-testid="data-table-scroll-hint"
      >
        {hintText}
      </div>
    )
    : null;

  const tableBody = children ?? (
    <tbody>
      {(rows || []).map((row, rowIndex) => (
        <tr key={row.key ?? rowIndex} className={rowClass}>
          {(columns || []).map((col) => (
            <td
              key={col.key}
              className={[cellClass, col.className].filter(Boolean).join(' ') || undefined}
              style={col.align ? { textAlign: col.align } : undefined}
            >
              {row[col.key]}
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );

  const tableEl = (
    <table className={tableClasses}>
      {caption != null && <caption>{caption}</caption>}
      {columns && columns.length > 0 && (
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={[thClass, col.headerClassName].filter(Boolean).join(' ') || undefined}
                style={col.align ? { textAlign: col.align } : undefined}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
      )}
      {tableBody}
    </table>
  );

  if (bareTable) {
    return (
      <div
        data-primitive="data-table"
        data-variant={variant}
        className={className || undefined}
        {...rest}
      >
        {tableEl}
      </div>
    );
  }

  if (config.hintPlacement === 'inside') {
    return (
      <div
        ref={wrapRef}
        className={wrapClasses}
        data-primitive="data-table"
        data-variant={variant}
        {...rest}
      >
        {hintEl}
        {tableEl}
      </div>
    );
  }

  return (
    <div data-primitive="data-table" data-variant={variant} {...rest}>
      <div ref={wrapRef} className={wrapClasses}>
        {tableEl}
      </div>
      {hintEl}
    </div>
  );
}

export { syncOneScrollHint, measureScrollable };
