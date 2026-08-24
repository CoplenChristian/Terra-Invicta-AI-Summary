// Guard: unit tests must not read the live save folder.
//
// Bucket A files use tests/fixtures/frozenSnapshots.js. Bucket C live
// integration tests live under tests/live/ and run via `npm run test:live`.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const testsRoot = path.join(__dirname);

const FORBIDDEN = [
  { name: 'loadFilteredSnapshot', pattern: /\bloadFilteredSnapshot\b/ },
  { name: 'loadSnapshot() with no args', pattern: /\bloadSnapshot\s*\(\s*\)/ },
  { name: 'latest: true', pattern: /latest\s*:\s*true/ }
];

const EXCLUDED_REL = new Set([
  path.join('live'),
  'noLiveSaveInUnitSuite.test.js'
]);

function listUnitTestFiles(dir = testsRoot, rel = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryRel = rel ? path.join(rel, entry.name) : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'live') continue;
      out.push(...listUnitTestFiles(full, entryRel));
      continue;
    }
    if (!entry.name.endsWith('.test.js')) continue;
    if (EXCLUDED_REL.has(entryRel) || EXCLUDED_REL.has(entry.name)) continue;
    out.push({ full, rel: entryRel.replace(/\\/g, '/') });
  }
  return out;
}

test('unit suite files do not call live save loaders', () => {
  const violations = [];
  for (const file of listUnitTestFiles()) {
    const text = fs.readFileSync(file.full, 'utf8');
    for (const rule of FORBIDDEN) {
      if (rule.pattern.test(text)) {
        violations.push(`${file.rel}: forbidden ${rule.name}`);
      }
    }
  }
  assert.deepStrictEqual(
    violations,
    [],
    `Unit tests must use loadFixtureFilteredSnapshot / queryFixtureIntel instead of live loaders:\n${violations.join('\n')}`
  );
});

test('the guard would fail on a probe file containing forbidden patterns', () => {
  const probe = `
    const { loadFilteredSnapshot, loadSnapshot } = require('../server/snapshotLoader');
    loadSnapshot();
    loadFilteredSnapshot({ latest: true, mode: 'player', observer: 4712 });
  `;
  const hits = FORBIDDEN.filter((rule) => rule.pattern.test(probe));
  assert.strictEqual(hits.length, FORBIDDEN.length,
    'probe must trip every forbidden pattern so the guard stays honest');
});
