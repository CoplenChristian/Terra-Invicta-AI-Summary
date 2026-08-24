// tests/fixtures/frozenSnapshots.js
//
// Purpose: the committed filtered snapshots the unit test suite reads instead of
//   the live save folder. Every intel test that used to call
//   loadFilteredSnapshot() without an explicit savePath belongs here.
//
// Fixtures are produced by scripts/derive_intel_fixtures.js from a named save
// and carry provenance in their header. The trimmed snapshot-player.json /
// snapshot-omniscient.json pair remains for markdown byte-identical exports
// only — do not use those for intel tests.

const fs = require('node:fs');
const path = require('node:path');
const { queryIntel } = require('../../server/snapshotLoader');

const PLAYER_PATH = path.join(__dirname, 'snapshot-player-intel.json');
const OMNI_PATH = path.join(__dirname, 'snapshot-omniscient-intel.json');
const OBSERVER = 4712;

const cache = { player: null, omniscient: null };

function loadFixtureFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Missing fixture ${path.relative(path.join(__dirname, '..', '..'), filePath)}. ` +
      'Run node scripts/derive_intel_fixtures.js to generate it.'
    );
  }
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return { provenance: data.provenance || null, snapshot: stripProvenance(data) };
}

function stripProvenance(data) {
  const out = { ...data };
  delete out.provenance;
  return out;
}

/**
 * A committed filtered snapshot for the unit suite.
 *
 * @param {{ mode?: 'player'|'omniscient', observer?: number }} [options]
 */
function loadFixtureFilteredSnapshot({ mode = 'player', observer = OBSERVER } = {}) {
  if (observer !== OBSERVER) {
    throw new Error(`fixture snapshots are captured for observer ${OBSERVER}, not ${observer}`);
  }
  const key = mode === 'omniscient' ? 'omniscient' : 'player';
  if (!cache[key]) {
    const filePath = key === 'omniscient' ? OMNI_PATH : PLAYER_PATH;
    cache[key] = loadFixtureFile(filePath);
  }
  const snap = cache[key].snapshot;
  if (snap.mode !== mode) {
    throw new Error(`fixture mode mismatch: requested ${mode}, file carries ${snap.mode}`);
  }
  return snap;
}

/** Provenance block from the fixture header (save name, md5, campaign date). */
function fixtureProvenance(mode = 'player') {
  const key = mode === 'omniscient' ? 'omniscient' : 'player';
  if (!cache[key]) loadFixtureFilteredSnapshot({ mode });
  return cache[key].provenance;
}

/** queryIntel against a committed fixture instead of the live save. */
function queryFixtureIntel({ endpoint, mode = 'player', observer = OBSERVER, snapshot, ...rest }) {
  return queryIntel({
    snapshot: snapshot || loadFixtureFilteredSnapshot({ mode, observer }),
    endpoint,
    mode,
    observer,
    ...rest
  });
}

module.exports = {
  OBSERVER,
  PLAYER_PATH,
  OMNI_PATH,
  loadFixtureFilteredSnapshot,
  fixtureProvenance,
  queryFixtureIntel,
  stripProvenance
};
