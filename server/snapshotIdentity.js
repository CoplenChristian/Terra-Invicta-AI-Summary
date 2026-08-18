const crypto = require('crypto');
const fs = require('fs');

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function createFileFingerprint(filePath, precomputedHash = null) {
  const stats = fs.statSync(filePath);
  const saveHash = precomputedHash || hashFile(filePath);
  return {
    saveHash,
    sizeBytes: stats.size,
    mtimeMs: stats.mtimeMs,
    key: `${stats.size}:${stats.mtimeMs}:${saveHash}`
  };
}

function createSnapshotIdentity(saveFile, campaignKey = 'initiative', generatedAt = new Date().toISOString()) {
  const stats = saveFile?.lastModified
    ? null
    : (saveFile?.fullPath ? fs.statSync(saveFile.fullPath) : null);
  const saveModifiedAt = new Date(saveFile?.lastModified || stats?.mtimeMs || 0).toISOString();
  const saveHash = saveFile?.saveHash || hashFile(saveFile.fullPath);
  const snapshotId = crypto.createHash('sha256')
    .update(`${campaignKey}|${saveModifiedAt}|${saveHash}`)
    .digest('hex')
    .slice(0, 24);

  return {
    snapshotId,
    saveHash,
    saveModifiedAt,
    generatedAt,
    campaignKey
  };
}

function attachSnapshotIdentity(snapshot, identity) {
  if (!snapshot || !identity) return snapshot;

  snapshot.snapshotId = identity.snapshotId;
  snapshot.saveHash = identity.saveHash;
  snapshot.saveModifiedAt = identity.saveModifiedAt;
  snapshot.generatedAt = identity.generatedAt;
  snapshot.snapshotIdentity = { ...identity };
  snapshot.metadata = {
    ...(snapshot.metadata || {}),
    snapshotId: identity.snapshotId,
    saveHash: identity.saveHash,
    saveModifiedAt: identity.saveModifiedAt,
    generatedAt: identity.generatedAt
  };
  return snapshot;
}

function readSnapshotIdentity(snapshot = {}) {
  const identity = snapshot.snapshotIdentity || {};
  return {
    snapshotId: snapshot.snapshotId || identity.snapshotId || snapshot.metadata?.snapshotId || null,
    saveHash: snapshot.saveHash || identity.saveHash || snapshot.metadata?.saveHash || null,
    saveModifiedAt: snapshot.saveModifiedAt || identity.saveModifiedAt || snapshot.metadata?.saveModifiedAt || snapshot.metadata?.lastModified || null,
    generatedAt: snapshot.generatedAt || identity.generatedAt || snapshot.metadata?.generatedAt || null,
    campaignKey: snapshot.campaignKey || identity.campaignKey || null
  };
}

function hasCompleteIdentity(snapshot = {}) {
  const identity = readSnapshotIdentity(snapshot);
  return Boolean(identity.snapshotId && identity.saveHash && identity.saveModifiedAt && identity.generatedAt);
}

module.exports = {
  hashFile,
  createFileFingerprint,
  createSnapshotIdentity,
  attachSnapshotIdentity,
  readSnapshotIdentity,
  hasCompleteIdentity
};
