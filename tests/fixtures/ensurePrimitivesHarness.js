// tests/fixtures/ensurePrimitivesHarness.js
//
// Purpose: provisions the React primitives harness for browser tests — builds
// build/harness/primitives-harness.js when src/v2 changes, and mounts it at
// /v2/harness on the shared Express app so every harness fixture can reach it.
//
// WHY THE ARTEFACT IS NOT IN public/v2/app ANY MORE
// -------------------------------------------------
// It was, and vite.config.mjs sets `emptyOutDir: true` on that directory, so
// every `npm run build` deleted it. Measured 2026-08-26: gone 2.06s into a
// 2.71s build and never restored. A browser test navigating in that window
// failed with a Playwright `waitForSelector` timeout — indistinguishable from a
// broken harness scene, and written off as flake more than once. The two builds
// now own disjoint trees, so neither can name the other's files.
//
// The mount lives here rather than in server/index.js because this is a
// test-only artefact and server/index.js serves the product. Every fixture that
// loads /v2/primitives-harness.html calls ensurePrimitivesHarnessBuilt() first,
// and they all share one Express app instance through the require cache, so one
// registration here covers all of them. It is appended after
// express.static(public), which is fine: nothing under public/ answers
// /v2/harness, so static falls through to it.

const fs = require('fs');
const path = require('path');
const express = require('express');
const { execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '../..');
const HARNESS_DIR = path.resolve(ROOT_DIR, 'build/harness');
const HARNESS_PATH = path.resolve(HARNESS_DIR, 'primitives-harness.js');
const HARNESS_ROUTE = '/v2/harness';
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

/**
 * Stale on absence, on a zero-byte file, and on `<=` rather than `<`.
 *
 * The comparison was `harnessMtime < max(srcMtime, configMtime)`, which reads
 * an EQUAL timestamp as fresh. A tie is exactly the case where a source edit
 * and a build landed in the same filesystem tick, and calling that fresh serves
 * a harness that predates the edit. `<=` costs at most one redundant rebuild in
 * a tie and can never serve stale bytes.
 *
 * The size check is the same discipline one level down: a truncated or
 * interrupted write leaves a 0-byte file with a NEW mtime, which the timestamp
 * comparison would happily call fresh. An unreadable artefact is not a current
 * one.
 */
function isHarnessStale() {
  if (!fs.existsSync(HARNESS_PATH)) return true;
  const stats = fs.statSync(HARNESS_PATH);
  if (stats.size === 0) return true;
  const srcMtime = getNewestMtime(SRC_DIR);
  const configMtime = fs.existsSync(VITE_CONFIG) ? fs.statSync(VITE_CONFIG).mtimeMs : 0;
  return stats.mtimeMs <= Math.max(srcMtime, configMtime);
}

let harnessRouteMounted = false;

/**
 * Serve build/harness at /v2/harness on the shared app, once.
 *
 * Idempotent by flag: every fixture calls the ensure function, and stacking a
 * fresh express.static per call would leak middleware across a test file's many
 * server instances.
 */
function mountHarnessRoute() {
  if (harnessRouteMounted) return;
  const app = require('../../server/index.js');
  app.use(HARNESS_ROUTE, express.static(HARNESS_DIR));
  harnessRouteMounted = true;
}

function ensurePrimitivesHarnessBuilt() {
  if (isHarnessStale()) {
    console.log('[ensurePrimitivesHarness] Building primitives test harness...');
    execSync('npx vite build --config vite.primitives.config.mjs', {
      stdio: 'inherit',
      cwd: ROOT_DIR,
      timeout: 120000,
    });
  }

  // Fail loudly rather than let a fixture navigate to a page whose script 404s
  // and time out on a scene selector — the symptom that made the emptyOutDir
  // race so hard to read.
  if (!fs.existsSync(HARNESS_PATH)) {
    throw new Error(
      `[ensurePrimitivesHarness] harness absent after build: ${HARNESS_PATH}. `
      + 'Check that no other build writes to build/harness.'
    );
  }

  mountHarnessRoute();
}

module.exports = {
  ensurePrimitivesHarnessBuilt,
  isHarnessStale,
  HARNESS_PATH,
  HARNESS_DIR,
  HARNESS_ROUTE,
};
