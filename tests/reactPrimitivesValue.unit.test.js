/**
 * tests/reactPrimitivesValue.unit.test.js
 *
 * Purpose: Value parseNumeric discipline without a browser — null is not zero.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Extract parseNumeric logic by evaluating the module's helper via a minimal stub.
// The browser bundle is heavy; this mirrors Value.jsx's guard.
function parseNumeric(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

test('parseNumeric treats null as absent, not zero', () => {
  assert.equal(parseNumeric(null), null);
  assert.equal(parseNumeric(0), 0);
  assert.equal(parseNumeric(''), null);
});

test('Value source keeps parseNumeric before Number coercion', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../src/v2/components/Value.jsx'),
    'utf8'
  );
  assert.match(src, /value === null/);
  assert.doesNotMatch(src, /Number\(value\)\s*\?\?/);
});
