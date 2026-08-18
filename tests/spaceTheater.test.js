const { test } = require('node:test');
const assert = require('node:assert');

const spaceTheater = require('../server/spaceTheater');

test('classifyBody maps known bodies to theaters', () => {
  assert.strictEqual(spaceTheater.classifyBody('Ceres'), 'belt');
  assert.strictEqual(spaceTheater.classifyBody('3 Ceres'), 'belt');
  assert.strictEqual(spaceTheater.classifyBody('Earth'), 'sol');
  assert.strictEqual(spaceTheater.classifyBody('Luna'), 'sol');
  assert.strictEqual(spaceTheater.classifyBody('Mars'), 'mars');
  assert.strictEqual(spaceTheater.classifyBody('Europa'), 'jupiter');
  assert.strictEqual(spaceTheater.classifyBody('Titan'), 'saturn');
  assert.strictEqual(spaceTheater.classifyBody('Triton'), 'outer');
});

test('classifyBody falls back to unassigned for unknown bodies', () => {
  assert.strictEqual(spaceTheater.classifyBody('Nowhere'), 'unassigned');
  assert.strictEqual(spaceTheater.classifyBody(''), 'unassigned');
});

test('normalizeBodyName strips numeric prefixes and collapses whitespace', () => {
  assert.strictEqual(spaceTheater.normalizeBodyName('12 Europa'), 'europa');
  assert.strictEqual(spaceTheater.normalizeBodyName('  Ceres  '), 'ceres');
});

test('theaterForBody returns the theater object', () => {
  const theater = spaceTheater.theaterForBody('Jupiter');
  assert.strictEqual(theater.key, 'jupiter');
  assert.ok(theater.name.length > 0);
});