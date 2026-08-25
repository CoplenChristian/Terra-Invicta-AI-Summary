// tests/fixtures/ensureBundle.js
//
// Purpose: ensures public/v2/app/bundle.js is present and up-to-date before running browser tests.

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
      timeout: 60000
    });
  } catch (err) {
    const errorMsg = `[ensureBundle] FATAL: Production build failed during bundle provisioning: ${err.message}`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }
}

module.exports = { ensureBundleBuilt, isBundleStale, getSourceMtimeFloor, BUNDLE_PATH };
