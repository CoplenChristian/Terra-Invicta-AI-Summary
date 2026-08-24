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
// Budget set with deliberate headroom for the 16 components to be migrated in Phases 2..17:
// - Max Gzipped: 250 KB (256,000 bytes)
// - Max Uncompressed: 1,000 KB (1,024,000 bytes)
const BUDGET = {
  maxGzipBytes: 250 * 1024,
  maxRawBytes: 1000 * 1024
};

function formatKb(bytes) {
  return `${(bytes / 1024).toFixed(2)} KB (${bytes.toLocaleString()} bytes)`;
}

function measureBundle() {
  if (!fs.existsSync(APP_DIR)) {
    console.warn(`[verify_bundle_size] Directory ${APP_DIR} does not exist (run 'npm run build' first).`);
    return { files: [], totalRaw: 0, totalGzip: 0, passed: true, skipped: true };
  }

  const fileList = [];
  function walk(dir) {
    for (const item of fs.readdirSync(dir)) {
      const full = path.join(dir, item);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (stat.isFile()) {
        fileList.push(full);
      }
    }
  }
  walk(APP_DIR);

  if (fileList.length === 0) {
    console.warn(`[verify_bundle_size] No files found in ${APP_DIR}.`);
    return { files: [], totalRaw: 0, totalGzip: 0, passed: true, skipped: true };
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
    console.log('[verify_bundle_size] Bundle check skipped (no build output present).');
    return;
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

module.exports = { measureBundle, BUDGET };
