// tests/fixtures/ensureBundle.js
//
// Purpose: ensures public/v2/app/bundle.js is present and up-to-date before running browser tests.
//
// WHY THE BUILD GETS AN EXPLICIT ENVIRONMENT
// ------------------------------------------
// Defect #25 (docs/live-defect-register.md). Four verification scripts set
// `process.env.NODE_ENV = 'test'` at module scope for their OWN in-process
// behaviour, before calling ensureBundleBuilt(). This function used to shell out
// with no `env` option, so the child `vite build` inherited that value. Vite
// copies a caller-supplied NODE_ENV into VITE_USER_NODE_ENV and treats anything
// but 'production' as a dev build, so @vitejs/plugin-react emitted jsxDEV()
// calls -- while vite.config.mjs's `define` still resolved React to the
// production runtime, which does not export jsxDEV. Every React panel then died
// with `s.jsxDEV is not a function`.
//
// Measured 2026-08-27, same command, only the ambient variable differing:
//
//   npm run build                 1,352,202 bytes      0 jsxDEV
//   NODE_ENV=test npm run build   1,687,870 bytes  1,836 jsxDEV (1,682 lines)
//
// The fix belongs here rather than at the call sites: vite.config.mjs is
// unconditionally `mode: 'production'`, so there is no case in which a caller's
// NODE_ENV should influence this build, and moving four assignments would leave
// the fifth script someone writes next month broken the same way. buildEnv()
// therefore forwards the real environment -- PATH and the rest of it are needed
// to run npm at all -- and overrides only the variables that select the build
// mode. tests/bundleNoDevJsx.test.js is the guard that catches a poisoned
// artefact if this ever regresses.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '../..');
const BUNDLE_PATH = path.resolve(ROOT_DIR, 'public/v2/app/bundle.js');
const SRC_DIR = path.resolve(ROOT_DIR, 'src/v2');
const VITE_CONFIG_PATH = path.resolve(ROOT_DIR, 'vite.config.mjs');

function getNewestSourceMtime(dir = SRC_DIR) {
  let newest = 0;
  if (!fs.existsSync(dir)) return newest;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, getNewestSourceMtime(fullPath));
    } else if (entry.isFile()) {
      const stats = fs.statSync(fullPath);
      newest = Math.max(newest, stats.mtimeMs);
    }
  }
  return newest;
}

function getSourceMtimeFloor() {
  let newest = getNewestSourceMtime(SRC_DIR);
  if (fs.existsSync(VITE_CONFIG_PATH)) {
    const configStats = fs.statSync(VITE_CONFIG_PATH);
    newest = Math.max(newest, configStats.mtimeMs);
  }
  return newest;
}

function isBundleStale() {
  if (!fs.existsSync(BUNDLE_PATH)) return true;
  const bundleStats = fs.statSync(BUNDLE_PATH);
  const newestSourceMtime = getSourceMtimeFloor();
  return bundleStats.mtimeMs < newestSourceMtime;
}

/**
 * The environment the production build is run in.
 *
 * Everything the caller has is forwarded -- npm needs PATH, and wiping the
 * environment wholesale would break the build far more visibly than #25 did.
 * Only the two variables that choose the build mode are overridden:
 *
 *   NODE_ENV            set to 'production', the value vite.config.mjs already
 *                       hard-codes into `define`, so the plugin's JSX transform
 *                       and the React runtime it resolves cannot disagree.
 *   VITE_USER_NODE_ENV  removed. This is Vite's own carrier for a
 *                       caller-supplied NODE_ENV; it is normally internal, but
 *                       a build launched from inside another Vite process would
 *                       inherit it and it outranks the default.
 */
function buildEnv(sourceEnv = process.env) {
  const env = { ...sourceEnv };
  env.NODE_ENV = 'production';
  delete env.VITE_USER_NODE_ENV;
  return env;
}

function ensureBundleBuilt() {
  if (!isBundleStale()) return;

  const reason = !fs.existsSync(BUNDLE_PATH)
    ? 'Bundle absent on clean checkout'
    : 'Bundle is stale (src/v2 source modified)';
  console.log(`[ensureBundle] ${reason}; building Vite distribution...`);

  try {
    execSync('npm run build', {
      stdio: 'inherit',
      cwd: ROOT_DIR,
      timeout: 60000,
      // Not inherited: see buildEnv() and defect #25.
      env: buildEnv()
    });
  } catch (err) {
    const errorMsg = `[ensureBundle] FATAL: Production build failed during bundle provisioning: ${err.message}`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }
}

module.exports = {
  ensureBundleBuilt,
  isBundleStale,
  getSourceMtimeFloor,
  buildEnv,
  BUNDLE_PATH
};
