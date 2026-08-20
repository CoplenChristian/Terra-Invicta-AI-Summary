const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  loadSnapshot,
  resolveObserverId,
  UnknownObserverError,
  clearCache
} = require('../server/snapshotLoader');
const requestValidation = require('../server/requestValidation');
const { DEFAULT_OBSERVER_FACTION_ID } = require('../shared/constants.mjs');

const SAVE = {
  factions: [
    { ID: 4712, displayName: 'the Initiative', templateName: 'Faction_Initiative' },
    { ID: 4710, displayName: 'the Resistance', templateName: 'Faction_Resistance' },
    { ID: 4717, displayName: 'the Aliens', templateName: 'Faction_Aliens' }
  ]
};

test('an unmatched observer name is reported, not silently answered as the default', () => {
  // intelligenceFilter.applyFilter falls back to the Initiative (then to
  // factions[0]) for an unknown id, so a silent fallback here does not produce
  // an empty answer -- it produces a confident answer about the wrong faction.
  assert.throws(
    () => resolveObserverId(SAVE, 'Directorate'),
    (error) => error instanceof UnknownObserverError &&
      error.statusCode === 404 &&
      /did not match any faction/.test(error.message),
    'an unmatched name must not resolve to the default observer'
  );
  assert.throws(() => resolveObserverId(SAVE, 'thee Initiative'), UnknownObserverError);
});

test('an observer id absent from the save is reported exactly as the HTTP path reports it', () => {
  const loaderError = (() => {
    try { resolveObserverId(SAVE, 9999); return null; } catch (error) { return error; }
  })();
  const httpError = (() => {
    try { requestValidation.assertKnownObserver(SAVE, 9999); return null; } catch (error) { return error; }
  })();

  assert.ok(loaderError, 'the loader path rejects the unknown id');
  assert.ok(httpError, 'the HTTP path rejects the unknown id');
  assert.equal(loaderError.statusCode, httpError.statusCode);
  assert.equal(loaderError.statusCode, 404);
});

test('valid observers still resolve, and absent still means the configured default', () => {
  assert.equal(resolveObserverId(SAVE, 4712), 4712);
  assert.equal(resolveObserverId(SAVE, '4712'), 4712);
  assert.equal(resolveObserverId(SAVE, 4717), 4717);
  assert.equal(resolveObserverId(SAVE, 'the Initiative'), 4712);
  assert.equal(resolveObserverId(SAVE, 'Resistance'), 4710);
  assert.equal(resolveObserverId(SAVE, 'Faction_Aliens'), 4717);
  assert.equal(resolveObserverId(SAVE, null), DEFAULT_OBSERVER_FACTION_ID);
  assert.equal(resolveObserverId(SAVE, undefined), DEFAULT_OBSERVER_FACTION_ID);
  assert.equal(resolveObserverId(SAVE, ''), DEFAULT_OBSERVER_FACTION_ID);
});

test('a snapshot with no faction list cannot assert membership, so a numeric id passes through', () => {
  // "Unknown" must not be reported as a match, but it must not be reported as a
  // mismatch either: with nothing to check against, the id is returned as given.
  assert.equal(resolveObserverId({}, 4712), 4712);
  assert.equal(resolveObserverId({ factions: [] }, 4712), 4712);
  assert.throws(() => resolveObserverId({ factions: [] }, 'the Initiative'), UnknownObserverError);
  assert.throws(() => resolveObserverId(SAVE, '0'), UnknownObserverError);
});

// --- cache identity ---------------------------------------------------------

const { makeSaveData } = require('./fixtures/syntheticSave');

// Two saves whose serialized JSON is byte-for-byte the same length (the money
// figure differs only in its leading digit) but whose contents differ. Stamped
// with the same mtime this reproduces exactly what restoring a backup over a
// save, or copying one save over another, produces on disk.
const writeSave = (target, money, mtime) => {
  const raw = JSON.stringify({ gamestates: makeSaveData({ money }).gamestates });
  fs.writeFileSync(target, raw, 'utf8');
  fs.utimesSync(target, mtime, mtime);
  return raw.length;
};

test('the parsed-save cache keys on content, not on size and mtime alone', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ti-cache-'));
  const savePath = path.join(folder, 'CacheProbe.json');
  const mtime = new Date('2026-01-05T00:00:00Z');

  try {
    const firstLength = writeSave(savePath, 100, mtime);
    const firstStats = fs.statSync(savePath);

    clearCache();
    const first = loadSnapshot({ savePath });
    assert.ok(first.saveHash, 'the first load produced an identity');

    // An untouched file must still hit the cache -- keying on the hash must not
    // turn every request into a re-parse.
    const cached = loadSnapshot({ savePath });
    assert.equal(cached, first, 'an unchanged save is served from cache');

    const secondLength = writeSave(savePath, 900, mtime);
    const secondStats = fs.statSync(savePath);
    assert.equal(secondLength, firstLength, 'the two writes are the same byte length');
    assert.equal(secondStats.size, firstStats.size);
    assert.equal(secondStats.mtimeMs, firstStats.mtimeMs, 'the two writes share an mtime');

    // The old key was `size:mtimeMs`, which is identical across those writes and
    // would have served the first parse for the second file's contents.
    const second = loadSnapshot({ savePath });
    assert.notEqual(second.saveHash, first.saveHash, 'a changed save must not serve the cached parse');
    assert.notEqual(second.snapshotId, first.snapshotId);

    const observer = (snapshot) => (snapshot.factions || []).find(faction => faction.ID === 4712);
    assert.notEqual(
      observer(second)?.resources?.Money,
      observer(first)?.resources?.Money,
      'the second load reflects the new file contents, not the cached ones'
    );
  } finally {
    clearCache();
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

test('the loader still refuses a save that changes while it is being parsed', () => {
  const snapshotLoader = require('../server/snapshotLoader');
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'snapshotLoader.js'), 'utf8');
  // The 503 mid-write guard is what CLAUDE.md documents; keying the cache on
  // the same fingerprint must not have removed it.
  assert.ok(source.includes('statusCode = 503'), 'the mid-write guard is still present');
  assert.ok(
    source.includes('afterFingerprint.key !== beforeFingerprint.key'),
    'the guard still compares the fingerprint before and after the parse'
  );
  assert.equal(typeof snapshotLoader.selectPreviousRawSnapshot, 'function');
});

// --- template path resolution ----------------------------------------------

test('a usable configured templates path wins before any drive probing', () => {
  const TemplateLoader = require('../server/templateLoader').constructor;
  const fixturePath = path.join(__dirname, 'fixtures', 'templates');
  const baseConfig = {
    paths: { templatesPath: fixturePath },
    analysis: { effects: {}, strategicProjects: [], rules: {} }
  };

  let probed = 0;
  const originalDiscover = TemplateLoader.prototype.discoverTemplatesPath;
  TemplateLoader.prototype.discoverTemplatesPath = function patched() {
    probed++;
    return originalDiscover.call(this);
  };
  try {
    const loader = new TemplateLoader(baseConfig);
    assert.equal(loader.templatesPath, fixturePath);
    assert.equal(probed, 0, 'a usable configured path must not trigger discovery');

    // Repeated construction with no configured path must reuse the memoized
    // discovery result rather than walking the drive letters again.
    const noPath = {
      paths: { templatesPath: null },
      analysis: { effects: {}, strategicProjects: [], rules: {} }
    };
    const before = probed;
    new TemplateLoader(noPath);
    new TemplateLoader(noPath);
    new TemplateLoader(noPath);
    assert.ok(probed - before <= 1, `discovery ran ${probed - before} times for three loaders`);
  } finally {
    TemplateLoader.prototype.discoverTemplatesPath = originalDiscover;
  }
});
