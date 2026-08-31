/**
 * src/v2/components/kpiMotion.mjs
 *
 * Purpose: decide whether an executive KPI update is steady, a discrete state
 * swap, or a measured numeric motion cue.
 */

export const KPI_TWEEN_DURATION_MS = 300;
export const KPI_STANDARD_EASING = 'cubic-bezier(0.2, 0, 0, 1)';

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

// Solve the x component of Material 3's standard cubic-bezier so the
// interpolated figure follows the same low-bounce easing as its CSS cue.
// Both y control points (0 and 1) keep the result monotonic: it cannot display
// a value beyond either measured endpoint.
function cubicBezierCoordinate(t, firstControl, secondControl) {
  const inverse = 1 - t;
  return (3 * inverse * inverse * t * firstControl)
    + (3 * inverse * t * t * secondControl)
    + (t * t * t);
}

export function easeKpiProgress(progress) {
  const targetX = clamp(progress);
  let low = 0;
  let high = 1;

  for (let iteration = 0; iteration < 10; iteration += 1) {
    const midpoint = (low + high) / 2;
    const x = cubicBezierCoordinate(midpoint, 0.2, 0);
    if (x < targetX) low = midpoint;
    else high = midpoint;
  }

  return cubicBezierCoordinate((low + high) / 2, 0, 1);
}

export function planKpiMotion(previous, next, prefersReducedMotion = false) {
  const oldState = previous?.state ?? null;
  const newState = next?.state ?? null;
  const oldValue = previous?.value ?? null;
  const newValue = next?.value ?? null;
  const oldMeasured = oldState === 'measured' && Number.isFinite(previous?.value);
  const newMeasured = newState === 'measured' && Number.isFinite(next?.value);

  if (!previous) {
    return { type: 'initial', animate: false, highlight: false, from: null, to: newValue };
  }

  // Presence is categorical. There is no meaningful numeric path from a
  // measured number to an absent/unavailable reading (or back again).
  if (!oldMeasured || !newMeasured) {
    if (oldState === newState && oldValue === newValue) {
      return { type: 'steady', animate: false, highlight: false, from: null, to: newValue };
    }
    return { type: 'swap', animate: false, highlight: true, from: null, to: newValue };
  }

  // This is the load-bearing gate: a poll that repeats the same measurement
  // must not restart a tween or its attention cue.
  if (newValue !== oldValue) {
    if (prefersReducedMotion) {
      return { type: 'highlight', animate: false, highlight: true, from: null, to: newValue };
    }
    return { type: 'tween', animate: true, highlight: true, from: oldValue, to: newValue };
  }

  return { type: 'steady', animate: false, highlight: false, from: null, to: newValue };
}
