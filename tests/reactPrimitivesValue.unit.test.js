/**
 * tests/reactPrimitivesValue.unit.test.js
 *
 * Purpose: Value parseNumeric discipline without a browser — null is not zero.
 * Imports the same parseNumeric.js the component ships, so the tested function
 * and the shipped function cannot diverge.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseNumeric } = require('../src/v2/components/parseNumeric.js');

test('parseNumeric treats null as absent, not zero', () => {
  assert.equal(parseNumeric(null), null);
  assert.equal(parseNumeric(0), 0);
  assert.equal(parseNumeric(''), null);
  assert.equal(parseNumeric(undefined), null);
  assert.equal(parseNumeric('12.4'), 12.4);
  assert.equal(parseNumeric('nope'), null);
});

test('parseNumeric guards absence before Number coercion', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../src/v2/components/parseNumeric.js'),
    'utf8'
  );
  assert.match(src, /value === null/);
  assert.doesNotMatch(src, /Number\(value\)\s*\?\?/);

  const valueSrc = fs.readFileSync(
    path.resolve(__dirname, '../src/v2/components/Value.jsx'),
    'utf8'
  );
  assert.match(valueSrc, /from ['"]\.\/parseNumeric\.js['"]/, 'Value must import the shared parseNumeric');
  assert.doesNotMatch(valueSrc, /Number\(value\)\s*\?\?/);
});

// ---------------------------------------------------------------------------
// Defect #19: ONE implementation of the contract, not two.
//
// These name their three files explicitly rather than walking a directory. A
// guard that walks narrows silently when code relocates — that is registered as
// defect #18 in docs/live-defect-register.md and it has happened twice in this
// repo already.
// ---------------------------------------------------------------------------

const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

test('Value renders through resolveValue, so the string form and the element form cannot drift', () => {
  const valueSrc = read('src/v2/components/Value.jsx');

  assert.match(valueSrc, /export function resolveValue\s*\(/,
    'the presence decision must be exported for hosts that can take no element at all');
  assert.match(valueSrc, /as:\s*Host\s*=\s*'span'/,
    "the `as` escape hatch must default to 'span' — the 15 existing panels depend on it");

  // The component must not re-decide anything: exactly one call, and the three
  // states must not be constructed a second time inside the JSX.
  const resolveCalls = (valueSrc.match(/(?<!function )resolveValue\(\{/g) || []).length;
  assert.equal(resolveCalls, 1, 'Value must resolve once and render the result, not branch again');
  assert.doesNotMatch(valueSrc, /data-value-state="/,
    'the state must come from resolveValue, never be hard-coded per branch');
});

test('world-map uses the primitive rather than restating it', () => {
  const utils = read('src/v2/panels/worldMapUtils.js');
  const panel = read('src/v2/panels/WorldMap.jsx');

  assert.doesNotMatch(utils, /export function countLabel\b/,
    'countLabel was <Value> restated for SVG; <Value as="tspan"> replaces it');
  assert.doesNotMatch(utils, /export function valueState\b/,
    'valueState was <Value>\'s data-value-state restated; resolveValue replaces it');
  assert.match(utils, /from ['"]\.\.\/components\/Value\.jsx['"]/,
    'the presence contract on this surface must be the shared one');

  // EVERY <Value> on this surface, not merely one. The whole panel is inside a
  // single <svg>, so a <Value> without `as` renders nothing at all — and an
  // assertion that only demanded one `as="tspan"` passed while a sibling was
  // silently blanked (measured while writing this test).
  const panelJsx = panel.replace(/\/\*[\s\S]*?\*\//g, '');
  const valueTags = panelJsx.match(/<Value\b[^>]*>/g) || [];
  assert.ok(valueTags.length >= 2, `world-map must emit its figures through <Value> (found ${valueTags.length})`);
  for (const tag of valueTags) {
    assert.match(tag, /\bas="tspan"/,
      `every <Value> inside this SVG needs the SVG-native host or it renders nothing: ${tag}`);
  }

  assert.doesNotMatch(panel, /valueState\(/,
    'no local presence signal may survive beside the primitive');
});
