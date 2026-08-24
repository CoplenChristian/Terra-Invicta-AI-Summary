#!/usr/bin/env node
// scripts/derive_intel_fixtures.js
//
// Purpose: derive committed full filtered-snapshot fixtures for the unit test
//   suite. Unlike scripts/derive_snapshot_fixtures.js (trimmed for markdown
//   byte-identical exports), these carry the complete filtered snapshot so
//   intel tests never read the live save.
//
// Run deliberately when the schema moves or a fixture must be refreshed —
// never to turn a red test green. The unit suite pins behaviour against these
// files, not against whatever save happens to be newest on disk.
//
// Usage:
//   node scripts/derive_intel_fixtures.js
//   node scripts/derive_intel_fixtures.js --save Autosave.gz
//
// Writes:
//   tests/fixtures/snapshot-player-intel.json
//   tests/fixtures/snapshot-omniscient-intel.json

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadFilteredSnapshot, loadSnapshot, clearCache } = require('../server/snapshotLoader');

const OBSERVER = 4712;
const FIXTURE_DIR = path.join(__dirname, '..', 'tests', 'fixtures');
const PLAYER_OUT = path.join(FIXTURE_DIR, 'snapshot-player-intel.json');
const OMNI_OUT = path.join(FIXTURE_DIR, 'snapshot-omniscient-intel.json');

function parseArgs(argv) {
  const out = { save: null };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--save' && argv[i + 1]) {
      out.save = argv[++i];
    }
  }
  return out;
}

function md5File(filePath) {
  const hash = crypto.createHash('md5');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function writeFixture(snapshot, outPath, mode, meta) {
  const payload = {
    provenance: {
      sourceSave: meta.saveFilename,
      sourceSaveMd5: meta.saveMd5,
      campaignDate: meta.gameTimeString,
      observerFactionId: OBSERVER,
      mode,
      derivedAt: new Date().toISOString().slice(0, 10),
      derivedBy: 'scripts/derive_intel_fixtures.js',
      note: 'Full filtered snapshot for the unit test suite. Do not hand-edit. ' +
        'Re-run derive_intel_fixtures.js deliberately when the snapshot schema ' +
        'moves; regenerating to silence a red test destroys the guarantee these ' +
        'fixtures exist to provide.'
    },
    ...snapshot
  };
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n');
  const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  console.log('wrote', path.relative(process.cwd(), outPath), bytes, 'bytes');
}

function main() {
  const { save } = parseArgs(process.argv);
  clearCache();
  const raw = loadSnapshot(save ? { savePath: save } : {});
  const identity = raw.snapshotIdentity || {};
  const fullPath = identity.saveFullPath || identity.fullPath || null;
  const meta = {
    saveFilename: identity.saveFilename || identity.filename || save || 'latest',
    saveMd5: identity.saveHash || (fullPath && fs.existsSync(fullPath) ? md5File(fullPath) : null),
    gameTimeString: raw.metadata?.gameTimeString || null
  };

  const player = loadFilteredSnapshot({ mode: 'player', observer: OBSERVER, bypassCache: true });
  const omni = loadFilteredSnapshot({ mode: 'omniscient', observer: OBSERVER, bypassCache: true });

  writeFixture(player, PLAYER_OUT, 'player', meta);
  writeFixture(omni, OMNI_OUT, 'omniscient', meta);

  console.log('source:', meta.saveFilename, meta.gameTimeString, 'md5:', meta.saveMd5);
}

main();
