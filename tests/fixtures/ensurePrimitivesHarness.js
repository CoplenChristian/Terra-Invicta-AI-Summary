// tests/fixtures/ensurePrimitivesHarness.js
//
// Purpose: builds public/v2/app/primitives-harness.js when src/v2 primitives
// change, without touching the production bundle entry.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '../..');
const HARNESS_PATH = path.resolve(ROOT_DIR, 'public/v2/app/primitives-harness.js');
const SRC_DIR = path.resolve(ROOT_DIR, 'src/v2');
const VITE_CONFIG = path.resolve(ROOT_DIR, 'vite.primitives.config.mjs');

function getNewestMtime(dir) {
  let newest = 0;
  if (!fs.existsSync(dir)) return newest;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, getNewestMtime(full));
    } else if (entry.isFile()) {
      newest = Math.max(newest, fs.statSync(full).mtimeMs);
    }
  }
  return newest;
}

function isHarnessStale() {
  if (!fs.existsSync(HARNESS_PATH)) return true;
  const harnessMtime = fs.statSync(HARNESS_PATH).mtimeMs;
  const srcMtime = getNewestMtime(SRC_DIR);
  const configMtime = fs.existsSync(VITE_CONFIG) ? fs.statSync(VITE_CONFIG).mtimeMs : 0;
  return harnessMtime < Math.max(srcMtime, configMtime);
}

function ensurePrimitivesHarnessBuilt() {
  if (!isHarnessStale()) return;

  console.log('[ensurePrimitivesHarness] Building primitives test harness...');
  execSync('npx vite build --config vite.primitives.config.mjs', {
    stdio: 'inherit',
    cwd: ROOT_DIR,
    timeout: 120000,
  });
}

module.exports = {
  ensurePrimitivesHarnessBuilt,
  isHarnessStale,
  HARNESS_PATH,
};
