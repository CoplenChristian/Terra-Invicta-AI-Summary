const { test } = require('node:test');
const assert = require('node:assert');

const requestValidation = require('../server/requestValidation');
const { RequestValidationError } = requestValidation;

test('parseMode defaults to player and accepts all supported modes', () => {
  assert.strictEqual(requestValidation.parseMode(undefined), 'player');
  assert.strictEqual(requestValidation.parseMode(''), 'player');
  assert.strictEqual(requestValidation.parseMode('player'), 'player');
  assert.strictEqual(requestValidation.parseMode('enhanced'), 'enhanced');
  assert.strictEqual(requestValidation.parseMode('omniscient'), 'omniscient');
});

test('parseMode rejects unsupported modes', () => {
  assert.throws(() => requestValidation.parseMode('cheat'), (err) => {
    assert.ok(err instanceof RequestValidationError);
    assert.strictEqual(err.statusCode, 400);
    return true;
  });
});

test('parseObserverId validates numeric input', () => {
  assert.strictEqual(requestValidation.parseObserverId('4712'), 4712);
  assert.strictEqual(requestValidation.parseObserverId(undefined), 4712);
  assert.throws(() => requestValidation.parseObserverId('abc'), RequestValidationError);
  assert.throws(() => requestValidation.parseObserverId('-5'), RequestValidationError);
  assert.throws(() => requestValidation.parseObserverId('1.5'), RequestValidationError);
});

test('assertKnownObserver requires the observer to exist in the save', () => {
  const snapshot = { factions: [{ ID: 4712 }, { ID: 4713 }] };
  assert.strictEqual(requestValidation.assertKnownObserver(snapshot, 4712), 4712);
  assert.throws(() => requestValidation.assertKnownObserver(snapshot, 999), (err) => {
    assert.ok(err instanceof RequestValidationError);
    assert.strictEqual(err.statusCode, 404);
    return true;
  });
});

test('resolveSavePath rejects unsafe or malformed save names', () => {
  const parserStub = { resolveSaveFolder: () => 'C:/saves' };
  assert.throws(() => requestValidation.resolveSavePath(parserStub, '..\\secret.gz'), RequestValidationError);
  assert.throws(() => requestValidation.resolveSavePath(parserStub, 'sub/folder.gz'), RequestValidationError);
  assert.throws(() => requestValidation.resolveSavePath(parserStub, 'notes.txt'), RequestValidationError);
  assert.throws(() => requestValidation.resolveSavePath(parserStub, 'name.gz\u0000'), RequestValidationError);
  assert.strictEqual(requestValidation.resolveSavePath(parserStub, undefined), null);
});

test('parseOptionalNumericQuery and parseBodyQuery guard their inputs', () => {
  assert.strictEqual(requestValidation.parseOptionalNumericQuery(undefined, 'faction'), null);
  assert.strictEqual(requestValidation.parseOptionalNumericQuery('4712', 'faction'), 4712);
  assert.throws(() => requestValidation.parseOptionalNumericQuery('abc', 'faction'), RequestValidationError);

  assert.strictEqual(requestValidation.parseBodyQuery(undefined), null);
  assert.strictEqual(requestValidation.parseBodyQuery('  Ceres '), 'Ceres');
  assert.throws(() => requestValidation.parseBodyQuery('x'.repeat(100)), RequestValidationError);
  assert.throws(() => requestValidation.parseBodyQuery('bad\u0007name'), RequestValidationError);
});

test('parseBoundedIntegerQuery validates focused resource limits', () => {
  assert.equal(requestValidation.parseBoundedIntegerQuery('10', 'limit'), 10);
  assert.equal(requestValidation.parseBoundedIntegerQuery(undefined, 'limit'), null);
  assert.throws(() => requestValidation.parseBoundedIntegerQuery('0', 'limit'), RequestValidationError);
  assert.throws(() => requestValidation.parseBoundedIntegerQuery('101', 'limit'), RequestValidationError);
  assert.throws(() => requestValidation.parseBoundedIntegerQuery('ten', 'limit'), RequestValidationError);
});
