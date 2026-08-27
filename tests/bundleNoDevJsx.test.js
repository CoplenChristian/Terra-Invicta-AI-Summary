/**
 * The built React bundle must contain no development-only `jsxDEV` calls.
 *
 * WHY THIS EXISTS
 * ---------------
 * Live defect register #25. Six verification scripts under `scripts/` set
 * `process.env.NODE_ENV = 'test'` at module scope for their own in-process
 * behaviour, and four of them then call `ensureBundleBuilt()`. That helper used
 * to `execSync('npm run build')` with no `env` option, so the child inherited
 * the mutated variable. Vite copies a caller-supplied NODE_ENV into
 * VITE_USER_NODE_ENV and treats anything but 'production' as a dev build, so
 * `@vitejs/plugin-react` emitted `jsxDEV()` -- while `vite.config.mjs` still
 * `define`s `process.env.NODE_ENV` as `"production"`, resolving React to the
 * runtime that does not export `jsxDEV`. The two disagree and the bundle loses.
 *
 * Measured 2026-08-27, same command, only the ambient variable differing:
 *
 *   npm run build                 1,352,202 bytes      0 jsxDEV
 *   NODE_ENV=test npm run build   1,687,870 bytes  1,836 jsxDEV
 *
 * The symptom is total: every React panel dies with
 * `s.jsxDEV is not a function`, so the dashboard renders nothing.
 *
 * WHY A GUARD AND NOT JUST THE FIX
 * --------------------------------
 * `public/v2/app/` is gitignored, so a poisoned bundle cannot be undone by
 * `git checkout` or `git stash`. Someone who hits this sees a completely broken
 * dashboard next to a clean `git status`, with no artefact in the diff to
 * suspect. The recovery -- rebuild with NODE_ENV unset -- is unguessable unless
 * something names it. This test names it.
 *
 * The fix itself lives at the chokepoint in `tests/fixtures/ensureBundle.js`,
 * which now hands the build an explicit environment. This guard is what catches
 * a regression of that fix, or a poisoned artefact produced some other way.
 *
 * THREE STATES, NOT TWO
 * ---------------------
 * Absent is not clean. A scan that never read a file has proved nothing, and
 * reporting that as a pass is the same defect class this repo keeps fixing
 * elsewhere: an unevaluable check must say so rather than falling through to
 * "fine". The bundle is provisioned first through the same fixture every other
 * bundle-dependent test uses -- `npm test` runs on CI against a clean checkout
 * with no separate build step -- and if it is still missing afterwards that is
 * reported as its own named failure, distinct from contamination.
 */

const { test, before } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { ensureBundleBuilt, BUNDLE_PATH } = require('./fixtures/ensureBundle.js');

const ROOT = path.resolve(__dirname, '..');
const RELATIVE_BUNDLE = path.relative(ROOT, BUNDLE_PATH).split(path.sep).join('/');

// The dev-only JSX runtime entry point. `@vitejs/plugin-react` emits calls to it
// (and imports it from `react/jsx-dev-runtime`) whenever it believes it is
// producing a development build. The production runtime exports `jsx`/`jsxs`
// and nothing named `jsxDEV`.
const DEV_JSX_MARKER = 'jsxDEV';

// The lib build in vite.config.mjs inlines everything into a single bundle.js
// (`fileName: () => 'bundle.js'`), so this one file is the whole emitted entry.
// If that config ever starts emitting real chunks under public/v2/app/chunks/,
// this scan needs to widen to cover them.
function readBundleState() {
  if (!fs.existsSync(BUNDLE_PATH)) {
    return { state: 'absent', bytes: null, occurrences: null, matchingLines: null };
  }

  const source = fs.readFileSync(BUNDLE_PATH, 'utf8');
  const occurrences = (source.match(new RegExp(DEV_JSX_MARKER, 'g')) || []).length;
  const matchingLines = source
    .split('\n')
    .filter(line => line.includes(DEV_JSX_MARKER)).length;

  return {
    state: occurrences > 0 ? 'contaminated' : 'clean',
    bytes: Buffer.byteLength(source, 'utf8'),
    occurrences,
    matchingLines
  };
}

function contaminationReport({ occurrences, matchingLines, bytes }) {
  return [
    '',
    '  THE BUILT BUNDLE IS A DEVELOPMENT BUILD AND CANNOT RUN.',
    '',
    `  ${RELATIVE_BUNDLE}`,
    `    ${occurrences} occurrences of \`${DEV_JSX_MARKER}\` on ${matchingLines} lines, ${bytes} bytes.`,
    '    A clean production build contains 0 and measures ~1,352,202 bytes.',
    '',
    '  WHAT THIS DOES TO THE DASHBOARD',
    '    Every React panel dies with `s.jsxDEV is not a function`. The page',
    '    loads and renders nothing. This is not a subtle regression.',
    '',
    '  WHAT CAUSES IT',
    '    `vite build` ran with NODE_ENV set to something other than',
    '    "production". Vite then emits jsxDEV() calls, while vite.config.mjs',
    '    still resolves React to the production runtime, which has no such',
    '    export. Live defect register #25.',
    '',
    '  HOW TO FIX IT',
    '    Rebuild with NODE_ENV unset (or set to "production"):',
    '',
    '      npm run build',
    '',
    `    \`${RELATIVE_BUNDLE}\` is GITIGNORED, so \`git checkout\` and`,
    '    `git stash` cannot restore it -- rebuilding is the only recovery, and',
    '    `git status` will look clean the whole time.',
    '',
    '  IF THIS FIRED FROM `npm test` ITSELF',
    '    `tests/fixtures/ensureBundle.js` is meant to make this impossible by',
    '    passing an explicit environment to the build. Check that `buildEnv()`',
    '    is still applied to the execSync call there before rebuilding.',
    ''
  ].join('\n');
}

let provisioning = { attempted: false, error: null };

before(() => {
  // Provision through the same fixture the browser suite uses. On a clean
  // checkout (CI does exactly this) the artefact does not exist yet, and the
  // pure-JS pass runs before the browser pass that would otherwise build it.
  // A poisoned bundle is NEWER than its sources, so it is not stale and this
  // call does not rebuild it -- the poison survives to be scanned, which is
  // the entire point.
  provisioning.attempted = true;
  try {
    ensureBundleBuilt();
  } catch (err) {
    provisioning.error = err;
  }
});

test('the bundle artefact exists, so this guard actually read something', () => {
  const { state } = readBundleState();

  assert.notStrictEqual(
    state,
    'absent',
    [
      '',
      `  NOTHING WAS SCANNED: ${RELATIVE_BUNDLE} does not exist.`,
      '',
      '  Absent is not clean. This guard has verified nothing about the bundle,',
      '  and reporting that as a pass would be worse than the defect it exists',
      '  to catch.',
      '',
      provisioning.error
        ? `  Provisioning it failed: ${provisioning.error.message}`
        : '  Provisioning ran without error and still produced no artefact.',
      '',
      '  Build it with `npm run build` and re-run.',
      ''
    ].join('\n')
  );
});

test(`the built bundle contains no development-only \`${DEV_JSX_MARKER}\` calls`, () => {
  const scan = readBundleState();

  if (scan.state === 'absent') {
    assert.fail(
      [
        '',
        `  NOT EVALUATED: ${RELATIVE_BUNDLE} does not exist, so the`,
        `  \`${DEV_JSX_MARKER}\` scan could not run. Absent is not clean.`,
        '',
        provisioning.error
          ? `  Provisioning it failed: ${provisioning.error.message}`
          : '  Provisioning ran without error and still produced no artefact.',
        ''
      ].join('\n')
    );
  }

  assert.strictEqual(scan.occurrences, 0, contaminationReport(scan));
});
