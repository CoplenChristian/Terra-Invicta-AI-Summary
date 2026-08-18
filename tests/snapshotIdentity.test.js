const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const snapshotIdentity = require('../server/snapshotIdentity');

function tempFile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ti-snapshot-identity-'));
  const filePath = path.join(dir, 'fixture.gz');
  fs.writeFileSync(filePath, content);
  return filePath;
}

test('createFileFingerprint hashes file content deterministically', () => {
  const filePath = tempFile('hello world');
  const first = snapshotIdentity.createFileFingerprint(filePath);
  const second = snapshotIdentity.createFileFingerprint(filePath);
  assert.strictEqual(first.key, second.key);
  assert.ok(first.saveHash.length === 64, 'sha256 hex digest');
  assert.ok(first.key.includes(first.saveHash));
  assert.strictEqual(first.sizeBytes, 11);
});

test('createFileFingerprint accepts a precomputed hash without re-reading', () => {
  const filePath = tempFile('hello world');
  const full = snapshotIdentity.createFileFingerprint(filePath);
  const viaPrecomputed = snapshotIdentity.createFileFingerprint(filePath, full.saveHash);
  assert.strictEqual(viaPrecomputed.saveHash, full.saveHash);
  assert.strictEqual(viaPrecomputed.key, full.key);
});

test('createSnapshotIdentity is deterministic and reuses a provided saveHash', () => {
  const identity = snapshotIdentity.createSnapshotIdentity(
    { fullPath: 'C:/unused/save.gz', lastModified: new Date('2025-01-01T00:00:00Z'), saveHash: 'abc123' },
    'initiative',
    '2025-01-02T00:00:00.000Z'
  );
  assert.strictEqual(identity.saveHash, 'abc123', 'does not re-hash when provided');
  assert.strictEqual(identity.saveModifiedAt, '2025-01-01T00:00:00.000Z');
  assert.strictEqual(identity.campaignKey, 'initiative');
  assert.ok(identity.snapshotId.length === 24, 'truncated sha256 hex');

  const again = snapshotIdentity.createSnapshotIdentity(
    { fullPath: 'C:/unused/save.gz', lastModified: new Date('2025-01-01T00:00:00Z'), saveHash: 'abc123' },
    'initiative',
    '2025-01-02T00:00:00.000Z'
  );
  assert.strictEqual(identity.snapshotId, again.snapshotId);
});

test('attachSnapshotIdentity and readSnapshotIdentity round-trip', () => {
  const identity = snapshotIdentity.createSnapshotIdentity(
    { fullPath: 'C:/unused/save.gz', lastModified: new Date('2025-01-01T00:00:00Z'), saveHash: 'abc123' }
  );
  const snapshot = { metadata: { gameTimeString: '2025' } };
  snapshotIdentity.attachSnapshotIdentity(snapshot, identity);

  const read = snapshotIdentity.readSnapshotIdentity(snapshot);
  assert.strictEqual(read.snapshotId, identity.snapshotId);
  assert.strictEqual(read.saveHash, 'abc123');
  assert.strictEqual(snapshot.metadata.snapshotId, identity.snapshotId);
  assert.ok(snapshotIdentity.hasCompleteIdentity(snapshot));
});