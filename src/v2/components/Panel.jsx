/**
 * src/v2/components/Panel.jsx
 *
 * Purpose: React replacement for `.tech-card` — header, title, body, and all six
 * modifiers. Keeps global class names so migrated panels inherit the live cascade.
 */

import React from 'react';

const MODIFIER_CLASS = {
  priority: 'tech-card--priority',
  alert: 'tech-card--alert',
  featured: 'tech-card--featured',
  quiet: 'tech-card--quiet',
  dense: 'tech-card--dense',
  commentary: 'tech-card--commentary',
};

function modifierClasses(modifiers) {
  const list = modifiers == null
    ? []
    : Array.isArray(modifiers)
      ? modifiers
      : [modifiers];
  return list
    .filter(Boolean)
    .map((key) => MODIFIER_CLASS[key] || `tech-card--${key}`);
}

/**
 * @param {object} props
 * @param {string|React.ReactNode} [props.title]
 * @param {React.ReactNode} [props.headerAside] — right side of `.tech-card-header`
 * @param {string|string[]} [props.modifier] — priority | alert | featured | quiet | dense | commentary
 * @param {boolean} [props.span=false] — full-width row in `.init-view__grid` / {@link TwoColumnGrid}
 * @param {string} [props.className]
 * @param {object} [props.bodyStyle] — inline style on `.tech-card-body`
 * @param {React.ReactNode} props.children — body content
 */
export function Panel({
  title,
  headerAside,
  modifier,
  modifiers,
  span = false,
  className,
  bodyStyle,
  children,
  ...rest
}) {
  const modifierList = modifiers ?? modifier;
  const classes = [
    'tech-card',
    ...modifierClasses(modifierList),
    span ? 'init-view__span' : null,
    className,
  ].filter(Boolean).join(' ');

  const showHeader = title != null || headerAside != null;

  return (
    <section className={classes} data-primitive="panel" {...rest}>
      {showHeader && (
        <div className="tech-card-header">
          {title != null && (
            <div className="tech-card-title">{title}</div>
          )}
          {headerAside != null && <span>{headerAside}</span>}
        </div>
      )}
      <div className="tech-card-body" style={bodyStyle}>{children}</div>
    </section>
  );
}
