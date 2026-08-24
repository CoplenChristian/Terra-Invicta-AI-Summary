// tests/fixtures/ensureBundle.js
//
// Purpose: ensures public/v2/app/bundle.js is built before running browser tests on clean checkouts.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BUNDLE_PATH = path.resolve(__dirname, '../../public/v2/app/bundle.js');

function ensureBundleBuilt() {
  if (!fs.existsSync(BUNDLE_PATH)) {
    console.log('[ensureBundle] Bundle absent on clean checkout; building Vite distribution...');
    execSync('npm run build', { stdio: 'inherit', cwd: path.resolve(__dirname, '../..') });
  }
}

module.exports = { ensureBundleBuilt, BUNDLE_PATH };
