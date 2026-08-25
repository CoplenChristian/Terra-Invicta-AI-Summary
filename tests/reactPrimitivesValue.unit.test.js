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
