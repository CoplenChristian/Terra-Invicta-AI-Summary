/**
 * src/v2/components/Estimated.jsx
 *
 * Purpose: the estimated register — italic sans in the dimmer colour for modelled
 * or projected values. Maps de / fe / mining legacy class names onto one API.
 */

import React from 'react';

const ESTIMATED_CLASSES = {
  de: { root: 'de-estimate', value: 'de-estimate__value', text: 'de-estimate__text' },
  fe: { root: 'fe-est', value: 'fe-est__value', text: 'fe-est__text' },
  mining: { root: 'mining-est', value: 'mining-est__value', text: null },
};

/**
 * @param {object} props
 * @param {React.ReactNode} [props.children]
 * @param {string|number} [props.value]
 * @param {React.ReactNode} [props.note] — secondary line (uses *__text when present)
 * @param {'de'|'fe'|'mining'} [props.register='de']
 * @param {string} [props.className]
 * @param {string} [props.as]
 */
export function Estimated({
  children,
  value,
  note,
  register = 'de',
  className,
  as: ValueTag = 'span',
  ...rest
}) {
  const classes = ESTIMATED_CLASSES[register] || ESTIMATED_CLASSES.de;
  const content = children ?? value;
  const valueClass = [classes.value, className].filter(Boolean).join(' ');

  const valueEl = (
    <ValueTag className={valueClass}>{content}</ValueTag>
  );

  const noteEl = note != null && classes.text
    ? <span className={classes.text}>{note}</span>
    : null;

  if (classes.root) {
    return (
      <span className={classes.root} data-primitive="estimated" data-register={register} {...rest}>
        {valueEl}
        {noteEl}
      </span>
    );
  }

  return (
    <span
      className={classes.root}
      data-primitive="estimated"
      data-register={register}
      {...rest}
    >
      {valueEl}
      {noteEl}
    </span>
  );
}
