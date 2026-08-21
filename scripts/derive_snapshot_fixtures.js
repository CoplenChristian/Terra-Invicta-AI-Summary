// scripts/derive_snapshot_fixtures.js
//
// Derives the committed filtered-snapshot fixtures that the markdown export
// tests use instead of reading the live save.
//
// Why this script exists and why it is committed:
//
//   The byte-identical /latest-snapshot.md test must not read the live save
//   (docs/live-save-test-dependency-spec.md). It asserts the compact renderer
//   is unchanged, so its input must be a stable, committed fixture. A fixture
//   is NOT regenerated to turn a red test green -- that is the exact trap the
//   spec describes. It IS re-derived deliberately when the renderer
//   legitimately changes, and having the script makes that act visible in
//   review (a one-line provenance bump in the diff instead of an opaque
//   hand-edited blob).
//
// What "trim" means here (mechanical, from the spec):
//
//   Property and value assertions have different needs. Only the byte-identical
//   value assertion needs real data. This script greedily drops every
//   top-level key, then every per-entry field, that does not change the output
//   of generateCompactSnapshot at all. The result is the smallest real fixture
//   that still reproduces the frozen /latest-snapshot.md byte-for-byte.
//
//   The war-room / threats property tests (sizes, section survival) do NOT use
//   these fixtures: they grow synthetic fleet volume to breach the caps, so
//   they need no real data at all (see markdownBudget.test.js).
//
// Usage:
//   node scripts/derive_snapshot_fixtures.js
//
// Writes:
//   tests/fixtures/snapshot-player.json
//   tests/fixtures/snapshot-omniscient.json

const fs = require('fs');
const path = require('path');
const { loadFilteredSnapshot } = require('../server/snapshotLoader');
const exportGenerator = require('../server/exportGenerator');

const OBSERVER = 4712;
const FIXTURE_DIR = path.join(__dirname, '..', 'tests', 'fixtures');
const PLAYER_OUT = path.join(FIXTURE_DIR, 'snapshot-player.json');
const OMNI_OUT = path.join(FIXTURE_DIR, 'snapshot-omniscient.json');

const clone = (value) => JSON.parse(JSON.stringify(value));

// Greedily trim `snapshot` so its compact render is byte-identical to baseline.
// Every decision mutates `work` cumulatively, so fallback chains (e.g.
// `targetCPCount ?? servantCPCount`) resolve correctly instead of dropping both
// sides. The renderer is invoked on the same `work` object each time -- no
// cloning, which keeps the multi-megabyte snapshot cheap to probe.
function derive(snapshot) {
  const work = clone(snapshot);

  const get = (pathArr) => {
    let node = work;
    for (const p of pathArr) node = node[p];
    return node;
  };

  // Delete the value at `path` inside `work`, render, and keep the deletion
  // only when the render is unchanged (or keep it restored when it crashes,
  // meaning the field is required). Mutates `work` permanently.
  const probeDrop = (pathArr) => {
    const node = get(pathArr.slice(0, -1));
    const key = pathArr[pathArr.length - 1];
    const saved = node[key];
    delete node[key];
    let ok;
    try {
      ok = exportGenerator.generateCompactSnapshot(work) === baseline;
    } catch {
      ok = false;
    }
    if (ok) return true;
    node[key] = saved;
    return false;
  };

  // 1. Drop whole top-level keys the renderer never reads. This shrinks the
  //    snapshot so the per-field pass below walks a smaller object.
  let baseline = exportGenerator.generateCompactSnapshot(work);
  for (const key of Object.keys(work)) {
    if (key === 'provenance') continue;
    if (probeDrop([key])) delete work[key];
  }
  baseline = exportGenerator.generateCompactSnapshot(work);

  // 2. Trim each remaining top-level subtree (object or array), cumulatively.
  const trimValue = (pathArr) => {
    const v = get(pathArr);
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i += 1) trimValue(pathArr.concat(i));
      return;
    }
    if (v && typeof v === 'object') {
      for (const key of Object.keys(v)) {
        const childPath = pathArr.concat(key);
        if (probeDrop(childPath)) {
          continue; // key droppable, already deleted from work
        }
        // Key is required and was restored; recurse into it if it is a
        // container.
        const child = get(childPath);
        if (child && typeof child === 'object') trimValue(childPath);
      }
    }
  };

  for (const key of Object.keys(work)) {
    if (key === 'provenance') continue;
    if (work[key] && typeof work[key] === 'object') trimValue([key]);
  }

  return work;
}

function writeFixture(snapshot, outPath, mode, source) {
  const provenance = {
    provenance: {
      source,
      derivedFrom: 'filtered live snapshot (mode ' + mode + ', observer ' + OBSERVER + ')',
      derivedBy: 'scripts/derive_snapshot_fixtures.js',
      note: 'Mechanically trimmed to keep generateCompactSnapshot byte-identical. ' +
        'Do not hand-edit. Re-run the script deliberately when the compact renderer ' +
        'legitimately changes; regenerating this to turn a red test green destroys ' +
        'the byte-identical guarantee it exists to provide.'
    }
  };
  const payload = Object.assign({}, provenance, snapshot);
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n');
  console.log('wrote', path.relative(process.cwd(), outPath), Buffer.byteLength(JSON.stringify(payload), 'utf8'), 'bytes');
}

const player = loadFilteredSnapshot({ mode: 'player', observer: OBSERVER });
const omni = loadFilteredSnapshot({ mode: 'omniscient', observer: OBSERVER });

const playerTrim = derive(player);
const omniTrim = derive(omni);

const playerMd = exportGenerator.generateCompactSnapshot(playerTrim);
const omniMd = exportGenerator.generateCompactSnapshot(omniTrim);
const frozenPlayer = fs.readFileSync(path.join(FIXTURE_DIR, 'frozen-snapshot-player.md'), 'utf8');
const frozenOmni = fs.readFileSync(path.join(FIXTURE_DIR, 'frozen-snapshot-omni.md'), 'utf8');

if (playerMd !== frozenPlayer) {
  console.error('ERROR: trimmed player fixture does not reproduce frozen-snapshot-player.md');
  process.exitCode = 1;
} else {
  console.log('player compact matches frozen-snapshot-player.md');
}
if (omniMd !== frozenOmni) {
  console.error('ERROR: trimmed omniscient fixture does not reproduce frozen-snapshot-omni.md');
  process.exitCode = 1;
} else {
  console.log('omniscient compact matches frozen-snapshot-omni.md');
}

writeFixture(playerTrim, PLAYER_OUT, 'player', 'filtered player-mode snapshot from the live save');
writeFixture(omniTrim, OMNI_OUT, 'omniscient', 'filtered omniscient-mode snapshot from the live save');
