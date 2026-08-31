/**
 * src/v2/components/KpiValue.jsx
 *
 * Purpose: own the executive KPI value's stateful change cue. Numeric values
 * tween only between two measured readings; presence changes swap immediately.
 */

import React from 'react';
import {
  easeKpiProgress,
  KPI_TWEEN_DURATION_MS,
  planKpiMotion,
} from './kpiMotion.mjs';

const DEFAULT_FORMAT = (value) => String(value);
const useIsomorphicLayoutEffect = typeof window !== 'undefined'
  ? React.useLayoutEffect
  : React.useEffect;

function isMeasuredValue(state, value) {
  return state === 'measured' && Number.isFinite(value);
}

function requestMotionFrame(callback) {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    return { kind: 'raf', id: window.requestAnimationFrame(callback) };
  }
  return { kind: 'timeout', id: setTimeout(() => callback(Date.now()), 16) };
}

function cancelMotionFrame(frame) {
  if (!frame) return;
  if (frame.kind === 'raf' && typeof window !== 'undefined') {
    window.cancelAnimationFrame(frame.id);
  } else {
    clearTimeout(frame.id);
  }
}

function readReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Subscribe to the platform preference so a preference change takes effect on
 * the next real KPI delta without requiring a page reload.
 */
export function usePrefersReducedMotion() {
  const [reduced, setReduced] = React.useState(readReducedMotion);

  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;

    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (event) => setReduced(Boolean(event.matches));
    if (typeof media.addEventListener === 'function') media.addEventListener('change', onChange);
    else if (typeof media.addListener === 'function') media.addListener(onChange);

    return () => {
      if (typeof media.removeEventListener === 'function') media.removeEventListener('change', onChange);
      else if (typeof media.removeListener === 'function') media.removeListener(onChange);
    };
  }, []);

  return reduced;
}

/**
 * @param {{value: number|null, state: string, text: string, format?: Function}} input
 * @returns {{displayedValue: number|null, motion: string}}
 */
export function useKpiMotion({ value, state, text, format = DEFAULT_FORMAT }) {
  const formatRef = React.useRef(format);
  formatRef.current = format || DEFAULT_FORMAT;

  const initialValue = isMeasuredValue(state, value) ? value : null;
  const [displayedValue, setDisplayedValue] = React.useState(initialValue);
  const [motion, setMotion] = React.useState('initial');
  const previousRef = React.useRef(null);
  const displayedRef = React.useRef(initialValue);
  const frameRef = React.useRef(null);
  const reducedMotion = usePrefersReducedMotion();

  const cancelFrame = React.useCallback(() => {
    cancelMotionFrame(frameRef.current);
    frameRef.current = null;
  }, []);

  const setMotionState = React.useCallback((nextMotion) => {
    setMotion(nextMotion);
  }, []);

  useIsomorphicLayoutEffect(() => {
    const next = {
      state,
      value: isMeasuredValue(state, value) ? value : null,
    };
    const plan = planKpiMotion(previousRef.current, next, reducedMotion);
    previousRef.current = next;
    cancelFrame();

    if (plan.type === 'initial') {
      displayedRef.current = next.value;
      setDisplayedValue(next.value);
      setMotionState('initial');
      return cancelFrame;
    }

    if (plan.type === 'steady') {
      // This branch is also reached if the OS preference changes while a
      // tween is in flight. The current target remains authoritative, so end
      // at it cleanly instead of leaving a cancelled tween half-rendered.
      if (displayedRef.current !== next.value) {
        displayedRef.current = next.value;
        setDisplayedValue(next.value);
      }
      setMotionState('steady');
      return cancelFrame;
    }

    if (plan.type === 'swap' || plan.type === 'highlight') {
      displayedRef.current = next.value;
      setDisplayedValue(next.value);
      setMotionState(plan.type);
      frameRef.current = requestMotionFrame(() => {
        frameRef.current = null;
        setMotionState('steady');
      });
      return cancelFrame;
    }

    const start = Number.isFinite(displayedRef.current) ? displayedRef.current : plan.from;
    const end = plan.to;
    const startTime = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();

    displayedRef.current = start;
    setDisplayedValue(start);
    setMotionState('tween');

    const tick = (timestamp) => {
      const elapsed = Math.max(0, timestamp - startTime);
      const progress = Math.min(1, elapsed / KPI_TWEEN_DURATION_MS);
      const eased = easeKpiProgress(progress);
      const current = start + ((end - start) * eased);
      displayedRef.current = current;
      setDisplayedValue(current);

      if (progress < 1) {
        frameRef.current = requestMotionFrame(tick);
        return;
      }

      // Never leave a rounded/interpolated float as the final display. The
      // formatter receives the exact measured target on completion.
      displayedRef.current = end;
      setDisplayedValue(end);
      frameRef.current = null;
      setMotionState('steady');
    };

    frameRef.current = requestMotionFrame(tick);
    return cancelFrame;
  }, [cancelFrame, reducedMotion, setMotionState, state, value]);

  React.useEffect(() => cancelFrame, [cancelFrame]);

  const atMeasuredTarget = isMeasuredValue(state, value) && displayedValue === value;
  const renderedText = atMeasuredTarget
    ? text
    : displayedValue === null
      ? text
      : formatRef.current(displayedValue);
  const isChanging = motion === 'tween' || motion === 'swap' || motion === 'highlight';

  return {
    renderedText,
    motion,
    isChanging,
  };
}

/**
 * The value node deliberately does not stamp `data-value-state`: these four
 * KPI figures were not part of the existing Value primitive census. Motion is
 * a separate behavior signal, so the measurement-state counts remain stable.
 */
export function KpiValue({
  id,
  value,
  state,
  text,
  format,
}) {
  const result = useKpiMotion({ value, state, text, format });
  const className = ['init-kpi-val', result.isChanging ? 'is-kpi-changing' : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      id={id}
      className={className}
      data-kpi-motion={result.motion}
    >
      {result.renderedText}
    </div>
  );
}
