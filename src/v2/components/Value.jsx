/**
 * src/v2/components/Value.jsx
 *
 * Purpose: render a numeric value or an explicit unavailable/absent state. Never
 * coerce null/undefined/'' to zero — presence is signalled explicitly.
 *
 * ---------------------------------------------------------------------------
 * ONE CONTRACT, TWO WAYS IN (defect #19)
 * ---------------------------------------------------------------------------
 * This primitive used to be a `<span>` and nothing else, which made it unusable
 * on the one surface that most needs it. Inside an `<svg>` React creates
 * children in the SVG namespace, so a `<span>` there is a non-rendering element
 * — and every figure `world-map` prints lives in an SVG `<text>`. That panel
 * therefore carried a private restatement of this rule (`countLabel`,
 * `valueState`), which is a second implementation of the repo's most
 * defect-prone contract and free to drift from this one.
 *
 * The escape hatch is deliberately two things, because two different hosts
 * cannot take a `<span>` for two different reasons:
 *
 *   1. `as` — a host that CAN take an element but needs a different one.
 *      `<Value as="tspan" …/>` emits an SVG-native node that renders inside
 *      `<text>` and still carries `data-primitive`, `data-value-state` and the
 *      `value-*` class, so the presence signal stays structural. Only the tag
 *      name is delegated; the contract attributes are still stamped here, which
 *      is what a render-prop would have handed back to each call site to
 *      restate.
 *   2. `resolveValue` — a host that can take NO element at all: an `aria-label`,
 *      an SVG `<title>`, a `data-*` attribute, a composed sentence. It returns
 *      `{ state, text, className }` and is the function `<Value>` itself renders,
 *      so the string form and the element form cannot disagree.
 *
 * `Value` is a thin renderer over `resolveValue`. There is no second copy of the
 * decision anywhere, and re-introducing one is what
 * `tests/reactPrimitivesValue.unit.test.js` fails on.
 */

import React from 'react';
import { parseNumeric } from './parseNumeric.js';

/** The absent affordance. Never a zero, never an empty string. */
export const ABSENT_LABEL = '—';

/** Present, but not readable as a number. Distinct from absent. */
export const UNAVAILABLE_LABEL = 'UNAVAILABLE';

function defaultFormat(value, decimals) {
  const num = parseNumeric(value);
  if (num === null) return 'UNAVAILABLE';
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
export function resolveValue({
  value,
  present,
  decimals,
  format,
  absentLabel = ABSENT_LABEL,
  unavailableLabel = UNAVAILABLE_LABEL,
} = {}) {
  if (!present) {
    return { state: 'absent', text: absentLabel, className: 'value-absent' };
  }

  const formatter = format ?? ((v) => defaultFormat(v, decimals));
  const text = formatter(value);

  if (text === unavailableLabel || text === UNAVAILABLE_LABEL) {
    return { state: 'unavailable', text: unavailableLabel, className: 'value-unavailable' };
  }

  return { state: 'measured', text, className: 'value-measured' };
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
 * @param {string|React.ElementType} [props.as='span'] — the host element. Use
 *   `"tspan"` inside an SVG `<text>`: a `<span>` there is created in the SVG
 *   namespace and does not render.
 */
export function Value({
  value,
  present,
  decimals,
  format,
  absentLabel = ABSENT_LABEL,
  unavailableLabel = UNAVAILABLE_LABEL,
  className,
  as: Host = 'span',
  ...rest
}) {
  const resolved = resolveValue({
    value,
    present,
    decimals,
    format,
    absentLabel,
    unavailableLabel,
  });

  return (
    <Host
      className={[resolved.className, className].filter(Boolean).join(' ') || undefined}
      data-primitive="value"
      data-value-state={resolved.state}
      {...rest}
    >
      {resolved.text}
    </Host>
  );
}
