// tests/fixtures/missionControlCss.js
//
// Purpose: the v2 stylesheet as its readers need it — the ordered set of parts
//   under public/v2/css/, concatenated in the order the browser cascades them.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// ---------------------------------------------------------------------------
//
// `public/v2/css/mission-control.css` was one 9,268-line file until 2026-08-23,
// and six test files read it with a single `fs.readFileSync` on that one path.
// Splitting it without this helper would have quietly weakened every one of
// them: a test that scans one part and finds no `font-size` literal has proved
// nothing about the other twenty-three, which is the "guard that outlives its
// target" failure CLAUDE.md records against the SERVICE_ROLE scan.
//
// Two properties are therefore load-bearing here.
//
//   1. ORDER IS THE CASCADE. `15-responsive.css` beats `05-view-grid.css`
//      because it is loaded after it, and `.mining-meas__value` beats
//      `.mining-yields-text` for the same reason. A helper that concatenated in
//      `readdir` order, or that sorted, would still contain every selector any
//      test looks for and would silently stop proving anything about which rule
//      wins. So the order is read from the ONE place the browser reads it from:
//      the `<link rel="stylesheet">` tags in `public/v2/index.html`, in
//      document order.
//
//   2. A PART ADDED LATER IS INCLUDED WITHOUT EDITING ANY TEST. There is no
//      hand-written list of parts anywhere. `assertStylesheetManifest()` checks
//      the linked set against the directory in both directions, so a new file
//      with no `<link>` fails loudly (it would also render nowhere in the
//      browser, which is the real defect) and a `<link>` with no file fails
//      loudly too. Once linked, every reader below picks it up.
//
// The verification scripts under `scripts/` do NOT use this module. They drive
// a real browser against the real `index.html`, so they read whatever the page
// links — which is the point: a text match cannot see a rule that loses the
// cascade, and `--text-muted` was once defined self-referentially with 164
// rules silently falling back to `inherit` while the source read correctly.

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CSS_DIR = path.join(REPO_ROOT, 'public', 'v2', 'css');
const SHELL_HTML = path.join(REPO_ROOT, 'public', 'v2', 'index.html');

/** Hrefs of the shell's stylesheet links, in document order. */
function linkedHrefs() {
  const html = fs.readFileSync(SHELL_HTML, 'utf8');
  const hrefs = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/rel\s*=\s*["']stylesheet["']/i.test(tag)) continue;
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (href) hrefs.push(href[1]);
  }
  return hrefs;
}

/**
 * The v2 stylesheet parts, absolute paths, in cascade order.
 *
 * Throws rather than returning a short list: an empty or partial result would
 * make every caller pass by finding nothing to complain about.
 */
function stylesheetPaths() {
  const parts = linkedHrefs()
    .filter(href => href.startsWith('/v2/css/'))
    .map(href => path.join(REPO_ROOT, 'public', href.replace(/^\//, '')));

  if (parts.length === 0) {
    throw new Error('public/v2/index.html links no /v2/css/ stylesheet; the shell would render unstyled');
  }
  for (const file of parts) {
    if (!fs.existsSync(file)) {
      throw new Error(`public/v2/index.html links ${path.relative(REPO_ROOT, file)}, which does not exist`);
    }
  }
  return parts;
}

/** `[{ file, relativePath, text }]` in cascade order, so a reader can report file:line. */
function stylesheetSources() {
  return stylesheetPaths().map(file => ({
    file,
    relativePath: path.relative(REPO_ROOT, file).split(path.sep).join('/'),
    text: fs.readFileSync(file, 'utf8')
  }));
}

/**
 * Every part concatenated in cascade order.
 *
 * This is what a `css.indexOf(a) > css.indexOf(b)` ordering assertion has to
 * run against: it is the same byte sequence the browser assembles its CSSOM
 * from, across file boundaries.
 */
function readMissionControlCss() {
  return stylesheetPaths().map(file => fs.readFileSync(file, 'utf8')).join('');
}

/**
 * The linked set and the directory must agree, in both directions.
 *
 * Throws with the offending names. Called by tests/typeScale.test.js so the
 * check runs whether or not the new part happens to contain anything the other
 * guards look for.
 */
function assertStylesheetManifest() {
  const onDisk = fs.readdirSync(CSS_DIR).filter(name => name.endsWith('.css')).sort();
  const linked = linkedHrefs()
    .filter(href => href.startsWith('/v2/css/'))
    .map(href => path.posix.basename(href));

  const unlinked = onDisk.filter(name => !linked.includes(name));
  if (unlinked.length) {
    throw new Error(
      `public/v2/css/ contains ${unlinked.join(', ')} with no <link> in public/v2/index.html; `
      + 'the rules would render nowhere and every stylesheet test would skip them'
    );
  }

  const missing = linked.filter(name => !onDisk.includes(name));
  if (missing.length) {
    throw new Error(`public/v2/index.html links ${missing.join(', ')}, which is not in public/v2/css/`);
  }

  const duplicated = linked.filter((name, i) => linked.indexOf(name) !== i);
  if (duplicated.length) {
    throw new Error(`public/v2/index.html links ${duplicated.join(', ')} more than once; the later copy wins silently`);
  }

  return linked;
}

module.exports = {
  CSS_DIR,
  SHELL_HTML,
  stylesheetPaths,
  stylesheetSources,
  readMissionControlCss,
  assertStylesheetManifest
};
