// scripts/run_unit_tests.js
//
// Purpose: run the deterministic unit test suite — every tests/**/*.test.js file
//   except tests/live/, which contacts the current campaign via npm run test:live.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const testsRoot = path.join(__dirname, '..', 'tests');
const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'live') continue;
      walk(full);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.test.js')) {
      files.push(full);
    }
  }
}

walk(testsRoot);
files.sort();

const result = spawnSync(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
  env: process.env
});

process.exit(result.status ?? 1);
