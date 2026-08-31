/**
 * tests/kpiMotion.test.js
 *
 * Purpose: pins the executive KPI motion contract — refreshes with no numeric
 * delta stay still, presence changes swap discretely, and reduced-motion users
 * keep a visible change cue without a numeric tween.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  KPI_TWEEN_DURATION_MS,
  KPI_STANDARD_EASING,
  easeKpiProgress,
  planKpiMotion,
} = require('../src/v2/components/kpiMotion.mjs');

const measured = (value) => ({ state: 'measured', value });
const absent = () => ({ state: 'absent', value: null });

test('an unchanged measured value stays still on re-render', () => {
  const plan = planKpiMotion(measured(68.74), measured(68.74));

  assert.equal(plan.type, 'steady');
  assert.equal(plan.animate, false);
  assert.equal(plan.highlight, false);
});

test('measured to absent is a discrete swap, never a numeric tween', () => {
  const plan = planKpiMotion(measured(68.74), absent());

  assert.equal(plan.type, 'swap');
  assert.equal(plan.animate, false);
  assert.equal(plan.from, null, 'a state swap must not expose an old number as an animation start');
  assert.equal(plan.to, null);
});

test('reduced motion swaps to the final number and keeps one highlight cue', () => {
  const normalPlan = planKpiMotion(measured(68.74), measured(72.11));
  const plan = planKpiMotion(measured(68.74), measured(72.11), true);

  assert.equal(normalPlan.type, 'tween');
  assert.equal(normalPlan.animate, true);
  assert.equal(normalPlan.from, 68.74);
  assert.equal(normalPlan.to, 72.11);

  assert.equal(plan.type, 'highlight');
  assert.equal(plan.animate, false);
  assert.equal(plan.highlight, true);
  assert.equal(plan.to, 72.11);
  assert.equal(KPI_TWEEN_DURATION_MS, 300);
  assert.equal(KPI_STANDARD_EASING, 'cubic-bezier(0.2, 0, 0, 1)');

  const easingSamples = [0, 0.25, 0.5, 0.75, 1].map(easeKpiProgress);
  assert.ok(easingSamples.every((sample) => sample >= 0 && sample <= 1));
  assert.ok(easingSamples.every((sample, index) => index === 0 || sample >= easingSamples[index - 1]));
});
