/**
 * tests/miningBoardRendering.test.js
 *
 * Purpose: preserve the shell and hosted-asset integration around the mining
 * board after its renderer moved from a classic script into the React bundle.
 * Browser rendering regressions now live in tests/mining-expansion.test.js.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const v2ShellPath = path.join(repoRoot, 'public', 'v2', 'index.html');
const v1ShellPath = path.join(repoRoot, 'public', 'index.html');
const expansionPanelPath = path.join(repoRoot, 'src', 'v2', 'panels', 'ExpansionPanel.jsx');

const ASSET_EXTENSIONS = /\.(html|css|js|mjs|json|geojson|png|svg|webp|woff2?)$/i;

function localReferences(htmlPath, baseDir) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  return [...new Set(
    [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
      .map((match) => match[1].trim())
      .filter((reference) => reference && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(reference))
      .map((reference) => reference.split(/[?#]/)[0])
      .filter((reference) => ASSET_EXTENSIONS.test(reference))
      .map((reference) => (reference.startsWith('/')
        ? reference.replace(/^\/+/, '')
        : `${baseDir}${reference}`))
  )];
}

test('every local asset the v2 and v1 shells reference exists on disk', () => {
  for (const [shellPath, baseDir, label] of [
    [v2ShellPath, 'v2/', 'public/v2/index.html'],
    [v1ShellPath, '', 'public/index.html'],
  ]) {
    for (const reference of localReferences(shellPath, baseDir)) {
      assert.ok(
        fs.existsSync(path.join(repoRoot, 'public', reference)),
        `${label} references a file that does not exist: ${reference}`,
      );
    }
  }
});

test('the v2 shell mounts mining expansion through the React bundle, not a legacy component script', () => {
  const html = fs.readFileSync(v2ShellPath, 'utf8');
  assert.ok(!html.includes('/v2/js/components/mining-expansion.js'),
    'the deleted classic mining renderer must not be loaded');
  // Control: proves the assertion above is not vacuously true, i.e. that this
  // test can actually detect a script the shell loads. It deliberately names
  // mission-control.js -- the shell itself -- rather than a component, because
  // the previous control named council-orders.js and broke the moment that
  // component was migrated one wave later. A control must outlive the thing it
  // is controlling for.
  assert.ok(html.includes('/v2/js/mission-control.js'),
    'the shell controller is loaded, so a missing-script assertion is meaningful');
  assert.ok(html.includes('/v2/app/bundle.js'), 'the React bundle must be loaded');
  assert.ok(/id="expansionPlanner"/.test(html),
    'the expansion view needs its #expansionPlanner mount element');
  const expansionPanel = fs.readFileSync(expansionPanelPath, 'utf8');
  assert.ok(/id="miningExpansion"/.test(expansionPanel),
    'the mining board mount id must live in the React expansion shell');

  const missionControl = fs.readFileSync(
    path.join(repoRoot, 'public', 'v2', 'js', 'mission-control.js'),
    'utf8',
  );
  assert.ok(
    missionControl.includes("getElementById('miningExpansion')"),
    'mission-control.js must still mount the board on the id the shell provides',
  );
});
test('the hosted asset manifest is derived from the shells, not hand-maintained beside them', () => {
  const buildScript = fs.readFileSync(
    path.join(repoRoot, 'scripts', 'build_static_snapshot.js'),
    'utf8',
  );
  assert.ok(
    buildScript.includes('readReferencedAssets'),
    'the manifest must be derived from the HTML shells',
  );
  assert.ok(
    !/embeddedAssetPaths\s*=\s*\[\s*\n\s*'index\.html'/.test(buildScript),
    'the manifest must not be a hard-coded parallel list of shell assets',
  );
});
