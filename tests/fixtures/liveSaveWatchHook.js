// tests/fixtures/liveSaveWatchHook.js
//
// Guard machinery for tests/noLiveSaveInUnitSuite.test.js, installed into
// every test process of the guarded run via NODE_OPTIONS=--require.
//
// The guarded run points TI_SAVE_PATH at a folder that does not exist, so
// config-respecting code that reaches for a save fails loudly on its own (the
// route 500s, the test fails, the guard names the file). This hook covers the
// code that does NOT respect the override: anything that resolves the real
// configured save folder itself and reads it anyway. It watches the real
// folder -- passed by the guard as TI_REAL_SAVE_FOLDER -- and reports any fs
// access at or under it, naming the process's test file and the path, and
// marks the process to exit non-zero so a read the test tolerates still fails
// the guarded run.
//
// When TI_REAL_SAVE_FOLDER is absent (the configured folder could not be
// resolved), the hook is a no-op; the guard reports that the watch was skipped
// rather than claiming coverage it does not have.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const rawTarget = process.env.TI_REAL_SAVE_FOLDER;

if (!rawTarget) {
  module.exports = {};
} else {
  const target = path.resolve(rawTarget).toLowerCase();
  const sep = path.sep;

  function touchesSaveFolder(p) {
    if (typeof p !== 'string' || p.length === 0) return false;
    let resolved;
    try {
      resolved = path.resolve(p).toLowerCase();
    } catch {
      return false;
    }
    return resolved === target || resolved.startsWith(target + sep);
  }

  function report(op, p) {
    const testFile = process.argv.slice(1).find((a) => /\.test\.js$/i.test(a))
      || '(runner or helper process)';
    const frames = (new Error().stack || '').split('\n').slice(2, 5).join('\n    ');
    process.stderr.write(
      `[TI-LIVE-SAVE-READ] ${op} ${p} in ${testFile}\n    ${frames}\n`
    );
    process.exitCode = 1;
  }

  // Sync fs: read, list, stat, probe, and open cover every way a save folder
  // is reached for a read. Write-family calls are included too: the promise is
  // that the unit suite does not touch the live folder at all.
  const SYNC_TARGETS = [
    'readFileSync', 'writeFileSync', 'readdirSync', 'statSync', 'lstatSync',
    'existsSync', 'accessSync', 'openSync', 'unlinkSync', 'rmSync',
    'renameSync', 'createReadStream', 'createWriteStream'
  ];
  for (const name of SYNC_TARGETS) {
    const original = fs[name];
    if (typeof original !== 'function') continue;
    fs[name] = function (...args) {
      const p = args[0];
      if (touchesSaveFolder(p)) report(name, p);
      return original.apply(this, args);
    };
  }

  // The promise variants are separate functions, not properties of fs.
  const PROMISE_TARGETS = [
    'readFile', 'writeFile', 'readdir', 'stat', 'lstat', 'access', 'open',
    'unlink', 'rm', 'rename'
  ];
  for (const name of PROMISE_TARGETS) {
    const original = fs.promises[name];
    if (typeof original !== 'function') continue;
    fs.promises[name] = async function (...args) {
      const p = args[0];
      if (touchesSaveFolder(p)) report(`${name} (promises)`, p);
      return original.apply(this, args);
    };
  }

  module.exports = {};
}
