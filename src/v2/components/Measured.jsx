/**
 * src/v2/components/Measured.jsx
 *
 * Purpose: the measured register — mono, upright, full-contrast text for values
 * read off the save. Maps the three legacy naming schemes (de / fe / mining) onto
 * one component vocabulary.
 */

import React from 'react';

const MEASURED_CLASSES = {
  de: { root: 'de-measured', value: 'de-measured__value' },
  fe: { root: 'fe-meas', value: 'fe-meas__value' },
  mining: { root: null, value: 'mining-meas__value' },
};

/**
 * @param {object} props
 * @param {React.ReactNode} props.children — rendered value when `value` is omitted
 * @param {string|number} [props.value]
 * @param {'de'|'fe'|'mining'} [props.register='de']
 * @param {string} [props.className] — extra classes on the value span
 * @param {string} [props.as] — host tag for the value wrapper (span | strong | small)
 */
export function Measured({
  children,
  value,
  register = 'de',
  className,
  as: ValueTag = 'span',
  ...rest
}) {
  const classes = MEASURED_CLASSES[register] || MEASURED_CLASSES.de;
  const content = children ?? value;
  const valueClass = [classes.value, className].filter(Boolean).join(' ');

  if (classes.root) {
    return (
      <span className={classes.root} data-primitive="measured" data-register={register} {...rest}>
        <ValueTag className={valueClass}>{content}</ValueTag>
      </span>
    );
  }

  return (
    <ValueTag
      className={valueClass}
      data-primitive="measured"
      data-register={register}
      {...rest}
    >
      {content}
    </ValueTag>
  );
}
