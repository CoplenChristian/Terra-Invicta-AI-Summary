/**
 * scripts/verify_bundle_size.js
 *
 * Purpose: measures the raw and gzipped byte sizes of the bundled React + MUI
 *   distribution in public/v2/app/ and enforces the bundle size budget.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const APP_DIR = path.resolve(__dirname, '../public/v2/app');

// Bundle size budget:
// Measured baseline floor (React 18 + React-DOM + MUI v6 + Emotion in production mode):
// - Raw: 302.81 KB (310,082 bytes)
// - Gzip: 82.69 KB (84,672 bytes)
// Budget set strictly to measured baseline floor + 15% headroom:
// - Max Gzipped: 96 KB (98,304 bytes) [82.69 KB * 1.15 = 95.09 KB]
// - Max Uncompressed: 350 KB (358,400 bytes) [302.81 KB * 1.15 = 348.23 KB]
// NOTE: Each component migration phase may raise the budget explicitly in its commit
// with the documented justification.
const BUDGET = {
  maxGzipBytes: 96 * 1024,
  maxRawBytes: 350 * 1024
};

// Allowed build artifact patterns emitted by Vite
const ALLOWED_EXTENSIONS = new Set(['.js', '.css', '.map']);

function isBuildArtifact(filePath) {
  const base = path.basename(filePath);
  const ext = path.extname(base);
  if (!ALLOWED_EXTENSIONS.has(ext)) return false;
  if (base.endsWith('.disabled') || base.endsWith('.bak') || base.endsWith('.tmp')) return false;
  return true;
}

function formatKb(bytes) {
  return `${(bytes / 1024).toFixed(2)} KB (${bytes.toLocaleString()} bytes)`;
}

function measureBundle(options = {}) {
  const allowMissing = options.allowMissing || process.argv.includes('--allow-missing');

  if (!fs.existsSync(APP_DIR)) {
    if (allowMissing) {
      console.warn(`[verify_bundle_size] Directory ${APP_DIR} does not exist (skipped via --allow-missing).`);
      return { files: [], totalRaw: 0, totalGzip: 0, passed: true, skipped: true };
    }
    console.error(`[verify_bundle_size] ERROR: Bundle directory ${APP_DIR} is absent.`);
    console.error('Cannot evaluate bundle size budget. Run `npm run build` first, or pass --allow-missing if intentional.');
    return { files: [], totalRaw: 0, totalGzip: 0, passed: false, skipped: false, missing: true };
  }

  const fileList = [];
  function walk(dir) {
    for (const item of fs.readdirSync(dir)) {
      const full = path.join(dir, item);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (stat.isFile() && isBuildArtifact(full)) {
        fileList.push(full);
      }
    }
  }
  walk(APP_DIR);

  if (fileList.length === 0) {
    if (allowMissing) {
      console.warn(`[verify_bundle_size] No build artifacts found in ${APP_DIR} (skipped via --allow-missing).`);
      return { files: [], totalRaw: 0, totalGzip: 0, passed: true, skipped: true };
    }
    console.error(`[verify_bundle_size] ERROR: No valid build artifacts found in ${APP_DIR}.`);
    console.error('Cannot evaluate bundle size budget. Run `npm run build` first.');
    return { files: [], totalRaw: 0, totalGzip: 0, passed: false, skipped: false, missing: true };
  }

  let totalRaw = 0;
  let totalGzip = 0;
  const results = [];

  for (const file of fileList) {
    const content = fs.readFileSync(file);
    const rawSize = content.length;
    const gzipSize = zlib.gzipSync(content).length;

    totalRaw += rawSize;
    totalGzip += gzipSize;

    const relative = path.relative(APP_DIR, file).replace(/\\/g, '/');
    results.push({ file: relative, rawSize, gzipSize });
  }

  const passedRaw = totalRaw <= BUDGET.maxRawBytes;
  const passedGzip = totalGzip <= BUDGET.maxGzipBytes;
  const passed = passedRaw && passedGzip;

  return {
    files: results,
    totalRaw,
    totalGzip,
    passed,
    skipped: false
  };
}

function printReport(result) {
  if (result.skipped) {
    console.log('[verify_bundle_size] Bundle check skipped (no build output present, --allow-missing passed).');
    return;
  }

  if (result.missing) {
    process.exit(1);
  }

  console.log('========================================================');
  console.log('         REACT + MUI BUNDLE SIZE MEASUREMENT            ');
  console.log('========================================================');
  for (const f of result.files) {
    console.log(`  - ${f.file.padEnd(25)} Raw: ${formatKb(f.rawSize).padEnd(28)} Gzip: ${formatKb(f.gzipSize)}`);
  }
  console.log('--------------------------------------------------------');
  console.log(`Total Uncompressed : ${formatKb(result.totalRaw)} (Budget: < ${formatKb(BUDGET.maxRawBytes)})`);
  console.log(`Total Gzipped      : ${formatKb(result.totalGzip)} (Budget: < ${formatKb(BUDGET.maxGzipBytes)})`);
  console.log('========================================================');

  if (!result.passed) {
    console.error('❌ FAIL: Bundle size exceeded budget!');
    process.exit(1);
  } else {
    console.log('✔ PASS: Bundle size is within budget.');
  }
}

if (require.main === module) {
  const res = measureBundle();
  printReport(res);
}

module.exports = { measureBundle, BUDGET, isBuildArtifact };
