/**
 * Every `var(--x)` in the v2 stylesheet must name a token that exists.
 *
 * WHY THIS EXISTS
 * ---------------
 * `25-hostile-movement.css` shipped in `fb2a6ab` using thirteen distinct custom
 * properties, EIGHT of which were never defined anywhere -- `--text-meta`,
 * `--rule-dim`, `--rule-strong`, `--text-body`, `--surface-1`, `--surface-2`,
 * `--accent-warn`, `--accent-alert`. Every one is a plausible-sounding neighbour
 * of a real token (`--text-muted`, `--line`, `--line-strong`, `--text`,
 * `--surface-inset`, `--surface-raised`, `--warning`, `--danger`). Live defect
 * register #24.
 *
 * **A stylesheet is the one place where a typo neither throws nor blanks.** CSS
 * is specified to treat an unresolvable custom property as valid at parse time
 * and INVALID AT COMPUTED-VALUE TIME, which means the declaration still wins the
 * cascade and then resolves to `inherit` (or the property's initial value for a
 * non-inherited property). So `color: var(--text-meta)` did not fail -- it fell
 * through to the inherited body colour, and `.hm-summary__item small` computed
 * to `rgb(230, 238, 234)`, full body brightness, where the design called for the
 * dimmed `rgb(145, 162, 155)`. A reader saw confident, primary-weight text where
 * the panel meant to whisper. Nothing errored and nothing logged.
 *
 * This is the same mechanism `tests/typeScale.test.js` check 2 already guards for
 * `--fs-*` tokens alone, after `--fs-label` was referenced twice and defined
 * nowhere. That guard was scoped to font sizes; this one covers every property.
 *
 * WHAT IT CHECKS, AND WHY EACH PART IS LOAD-BEARING
 * ------------------------------------------------
 * 1. Every `var(--x)` with NO fallback resolves to a definition somewhere under
 *    `public/v2/css/`. These are the invisible ones: they render as inheritance.
 *
 * 2. Every `var(--x, fallback)` ALSO resolves. A fallback renders, so the page
 *    looks fine -- but the token system is not in control of that value, and the
 *    fallback silently disagrees with the design system it was copied from.
 *    `--accent-warn, #d68a3a` rendered a more saturated orange than the
 *    `--warning: #d4a35e` every other panel uses. Reported as its own group so
 *    the two failure modes are never confused, never silently passed.
 *
 * 3. The scan proves it actually read something. A guard that passes because it
 *    found nothing to check is the failure mode this repo has hit twice (the
 *    SERVICE_ROLE scan after a file split, and typeScale check 3 after the React
 *    migration moved every component to .jsx). So: the scanned set must equal the
 *    directory listing, every file must be non-empty and contain a rule block,
 *    and the definition and reference totals must clear a floor.
 *
 * 4. Anything it CANNOT parse fails loudly rather than counting as clean. An
 *    unterminated block comment throws; a `var(` whose argument the reference
 *    regex could not read is reported by file and line. Reporting "no problems
 *    found" for a construct it failed to read is the same defect class as the one
 *    being fixed.
 *
 * RUNTIME-DEFINED PROPERTIES
 * --------------------------
 * A handful of custom properties are legitimately set from JavaScript rather than
 * from a stylesheet. They are exempt -- but the exemption is itself verified
 * against the source file that is supposed to set them, so a property that stops
 * being set in JS fails here rather than becoming a permanent hole. See
 * RUNTIME_DEFINED below.
 *
 * REGISTERED GAPS
 * ---------------
 * The first run of this guard found FOUR MORE invented names, in three panels
 * nobody had looked at -- see REGISTERED_GAPS. They are pinned, not excused: the
 * assertion below compares the unresolved set against that list by exact
 * file+property+count, so a NEW unresolved reference fails immediately AND a
 * pinned one that gets fixed fails until its entry is deleted. There is no way
 * for this list to grow quietly or to outlive what it describes.
 *
 * They are pinned rather than fixed because choosing each replacement token is a
 * visual design decision in a panel this change was not scoped to, and a
 * confident wrong colour is the exact failure being fixed here. Each entry
 * records what is on screen today so the decision can be made from evidence.
 *
 * Comments are blanked before scanning (spaces substituted, newlines kept) so a
 * `var()` inside a comment is neither counted nor mis-numbered.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  CSS_DIR,
  stylesheetSources,
  assertStylesheetManifest
} = require('./fixtures/missionControlCss');

const REPO_ROOT = path.resolve(__dirname, '..');

/**
 * Custom properties set from JavaScript at runtime, not from a stylesheet.
 *
 * Each entry names the source that assigns it. The test asserts that assignment
 * still exists, so an exemption cannot outlive the code it describes -- the
 * "guard that outlives its target" failure recorded in CLAUDE.md.
 */
const RUNTIME_DEFINED = [
  {
    property: '--faction-intel-accent',
    source: 'src/v2/panels/FactionIntel.jsx',
    reason: 'per-faction accent written onto the panel element as an inline style'
  }
];

/**
 * Unresolved references that exist TODAY and are knowingly left unfixed, pinned
 * by file, property and exact count. Live defect register #24, second half.
 *
 * These are not exemptions. The assertion demands an EXACT match against this
 * list, so:
 *   - a new unresolved reference anywhere fails, because it is not listed;
 *   - a seventh `var(--border)` in the directive board fails, because the count
 *     moves;
 *   - fixing one fails until its entry is deleted, so the list cannot rot.
 *
 * Every one of these renders as `unset`, which for a non-inherited property means
 * the INITIAL value -- so the declaration is not merely ignored, the author's
 * intent is silently absent. `consequence` records what is actually on screen.
 */
const REGISTERED_GAPS = [
  {
    file: 'public/v2/css/07-hate-economics.css',
    property: '--panel',
    count: 1,
    consequence:
      '.mc-budget-hulls uses the grid-gap hairline pattern -- container background var(--line), '
      + '1px gaps, opaque cells. With --panel unresolved every .mc-budget-hull cell is TRANSPARENT, '
      + 'so the block renders as one solid #263837 slab instead of hairline-separated rows. '
      + 'Needs an opaque surface token; --surface / --surface-raised / --surface-inset all read plausibly.'
  },
  {
    file: 'public/v2/css/17-directive-board.css',
    property: '--border',
    count: 2,
    consequence:
      '.directive-board-chip has no border and .directive-board-row has no top rule, because an '
      + 'unresolved border shorthand computes to `medium none currentColor`. Every other 1px border '
      + 'in this file names --line (four instances), which is the obvious candidate.'
  },
  {
    file: 'public/v2/css/18-mining-expansion.css',
    property: '--surface-subtle',
    count: 2,
    consequence:
      '.mining-runways-bar and .mining-gated-item render as bordered boxes with no fill.'
  },
  {
    file: 'public/v2/css/18-mining-expansion.css',
    property: '--surface-hover',
    count: 1,
    consequence:
      '.mining-candidate-row:hover has no effect at all; the transition animates nothing. '
      + '01-tokens-and-base.css already aliases --bg-card-hover to --surface-raised.'
  }
];

/**
 * Floors that make a vacuous pass impossible. Deliberately far below the
 * measured values (26 files, 63 definitions, 1,980 references on 2026-08-27) so
 * ordinary edits never trip them, but a scanner that silently read nothing does.
 */
const MIN_FILES = 20;
const MIN_DEFINITIONS = 40;
const MIN_REFERENCES = 200;

/**
 * Replace every block comment with spaces, keeping newlines, so byte offsets and
 * therefore line numbers survive. CSS comments do not nest, so a non-greedy scan
 * is exact -- but an UNTERMINATED comment is a parse failure and must throw
 * rather than silently swallowing the rest of the file.
 */
function blankComments(text, relativePath) {
  let out = '';
  let index = 0;
  while (index < text.length) {
    const open = text.indexOf('/*', index);
    if (open === -1) {
      out += text.slice(index);
      break;
    }
    out += text.slice(index, open);
    const close = text.indexOf('*/', open + 2);
    if (close === -1) {
      throw new Error(
        `${relativePath}: unterminated /* block comment opened at offset ${open}. `
        + 'The scanner cannot read this file, so it reports a parse failure rather than zero problems.'
      );
    }
    const body = text.slice(open, close + 2);
    out += body.replace(/[^\n]/g, ' ');
    index = close + 2;
  }
  return out;
}

/** Offsets at which each line starts, for turning an index into a line number. */
function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function lineAt(starts, index) {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid] <= index) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

// A definition is `--name:` in declaration position: at start of line, or after
// `{`, `;`, `}` or whitespace. `var(--name, ...)` never matches -- the name is
// preceded by `(` or `,` and followed by `,` or `)`, not by a colon.
const DEFINITION_RE = /(?:^|[{};\s])(--[A-Za-z0-9_-]+)\s*:/gm;

// A reference is `var(--name` followed by `,` (a fallback follows) or `)`.
const REFERENCE_RE = /var\(\s*(--[A-Za-z0-9_-]+)\s*([,)])/g;

// Every `var(` occurrence, so the count can be reconciled against the parsed
// references. A `var(` the reference regex could not read is a hole in the scan.
const ANY_VAR_RE = /var\(/g;

/**
 * Scan one stylesheet. Returns its definitions, its references with file:line,
 * and any `var(` the reference regex failed to parse.
 */
function scanStylesheet({ relativePath, text }) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error(`${relativePath}: read as empty; the scan would report zero problems for a file it never read`);
  }

  const source = blankComments(text, relativePath);
  if (!source.includes('{')) {
    throw new Error(
      `${relativePath}: contains no rule block outside comments. `
      + 'Either it is not CSS or the comment blanker consumed it; either way the scan cannot vouch for it.'
    );
  }

  const starts = lineStarts(source);
  const definitions = [];
  const references = [];

  DEFINITION_RE.lastIndex = 0;
  for (let m = DEFINITION_RE.exec(source); m; m = DEFINITION_RE.exec(source)) {
    definitions.push({ property: m[1], line: lineAt(starts, m.index) });
  }

  REFERENCE_RE.lastIndex = 0;
  for (let m = REFERENCE_RE.exec(source); m; m = REFERENCE_RE.exec(source)) {
    references.push({
      property: m[1],
      line: lineAt(starts, m.index),
      hasFallback: m[2] === ',',
      relativePath
    });
  }

  ANY_VAR_RE.lastIndex = 0;
  const varOccurrences = (source.match(ANY_VAR_RE) || []).length;

  return { relativePath, definitions, references, varOccurrences };
}

/** Every stylesheet scanned, plus the reconciliation totals. */
function scanAll() {
  const sources = stylesheetSources();
  const scans = sources.map(scanStylesheet);

  const defined = new Set();
  for (const scan of scans) {
    for (const def of scan.definitions) defined.add(def.property);
  }

  const references = scans.flatMap(scan => scan.references);
  const varOccurrences = scans.reduce((sum, scan) => sum + scan.varOccurrences, 0);

  return { scans, defined, references, varOccurrences };
}

function formatGroup(rows) {
  return rows
    .map(row => `    ${row.relativePath}:${row.line}  var(${row.property}${row.hasFallback ? ', …' : ''})`)
    .join('\n');
}

test('the scan actually reads every v2 stylesheet, and says so if it cannot', () => {
  const linked = assertStylesheetManifest();
  const onDisk = fs.readdirSync(CSS_DIR).filter(name => name.endsWith('.css')).sort();

  const { scans, defined, references, varOccurrences } = scanAll();

  const scannedNames = scans.map(scan => path.posix.basename(scan.relativePath)).sort();
  assert.deepStrictEqual(
    scannedNames,
    onDisk,
    'the scanned set must be the whole of public/v2/css/, or the guard is vouching for files it never opened'
  );
  assert.strictEqual(scannedNames.length, linked.length, 'scanned set and linked set must be the same size');
  assert.ok(
    scannedNames.length >= MIN_FILES,
    `only ${scannedNames.length} stylesheets scanned; expected at least ${MIN_FILES}. `
    + 'A guard that passes because it found nothing to check is the failure mode.'
  );

  assert.ok(
    defined.size >= MIN_DEFINITIONS,
    `only ${defined.size} distinct custom properties defined across public/v2/css/; expected at least ${MIN_DEFINITIONS}`
  );
  assert.ok(
    references.length >= MIN_REFERENCES,
    `only ${references.length} var() references found; expected at least ${MIN_REFERENCES}`
  );

  // Reconcile: every `var(` in the source must have been parsed into a reference.
  // An unparsed one is a blind spot, not a clean file.
  assert.strictEqual(
    references.length,
    varOccurrences,
    `${varOccurrences - references.length} of ${varOccurrences} var( occurrences were not parseable by the reference `
    + 'scanner. The scan cannot vouch for those declarations; fix the scanner rather than accepting the gap.'
  );

  // Reported, not asserted against a pinned number: the totals are the evidence
  // this guard is measuring the same surface the defect register measured.
  console.log(
    `[cssCustomProperties] ${scannedNames.length} stylesheets, `
    + `${defined.size} distinct tokens defined, ${references.length} var() references`
  );
});

test('every custom property named in a stylesheet is defined by a runtime source that still sets it', () => {
  for (const entry of RUNTIME_DEFINED) {
    const file = path.join(REPO_ROOT, entry.source);
    assert.ok(fs.existsSync(file), `${entry.source} is listed as defining ${entry.property} at runtime but does not exist`);
    const src = fs.readFileSync(file, 'utf8');
    // Whole-token match, not `includes`. A substring test passes when the property
    // is RENAMED to something with the old name as a prefix -- measured: renaming
    // to `--faction-intel-accent-RENAMED` kept `includes` green, which is exactly
    // the stale exemption this check exists to catch.
    const wholeToken = new RegExp(`${entry.property.replace(/[-]/g, '\\-')}(?![A-Za-z0-9_-])`);
    assert.ok(
      wholeToken.test(src),
      `${entry.source} no longer mentions ${entry.property}, so the runtime exemption for it is stale. `
      + 'Remove the exemption or restore the assignment; do not leave a permanent hole in the scan.'
    );
  }
});

/** Unresolved references keyed `file|--property`, so counts can be compared exactly. */
function tally(rows) {
  const counts = new Map();
  for (const row of rows) {
    const key = `${row.relativePath}|${row.property}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

test('no v2 stylesheet references a custom property that is not defined', () => {
  const { defined, references } = scanAll();

  const runtimeDefined = new Set(RUNTIME_DEFINED.map(entry => entry.property));
  const unresolved = references.filter(
    ref => !defined.has(ref.property) && !runtimeDefined.has(ref.property)
  );

  const registered = new Map(REGISTERED_GAPS.map(gap => [`${gap.file}|${gap.property}`, gap.count]));
  const found = tally(unresolved);

  // Unregistered: a reference nobody has looked at. This is the guard.
  const unexpected = unresolved.filter(ref => !registered.has(`${ref.relativePath}|${ref.property}`));

  // Count drift on a registered gap: more references of a known-bad name.
  const drifted = [];
  for (const [key, count] of found) {
    if (!registered.has(key)) continue;
    if (registered.get(key) !== count) drifted.push({ key, expected: registered.get(key), actual: count });
  }

  // Stale pin: a registered gap that no longer occurs. Failing here is the point
  // -- it forces the entry to be deleted when the reference is fixed, so the list
  // can never quietly become a permanent allowlist.
  const stale = [...registered.keys()].filter(key => !found.has(key));

  if (unexpected.length === 0 && drifted.length === 0 && stale.length === 0) return;

  const lines = [];

  if (unexpected.length) {
    const silent = unexpected.filter(ref => !ref.hasFallback);
    const fallenBack = unexpected.filter(ref => ref.hasFallback);
    const names = [...new Set(unexpected.map(ref => ref.property))].sort();

    lines.push(
      `${unexpected.length} var() references name ${names.length} custom properties that are defined nowhere `
      + `under public/v2/css/: ${names.join(', ')}.`,
      ''
    );

    if (silent.length) {
      lines.push(
        `  UNRESOLVED, NO FALLBACK (${silent.length}) — these render as INHERITANCE, not as nothing.`,
        '  The declaration wins the cascade and then resolves to the inherited value (or the initial value',
        '  for a non-inherited property), so the element looks deliberately styled while disagreeing with',
        '  the design system.',
        formatGroup(silent),
        ''
      );
    }

    if (fallenBack.length) {
      lines.push(
        `  UNRESOLVED, FALLBACK USED (${fallenBack.length}) — these render, but they render the hard-coded`,
        '  fallback, which means the token system does not control that value. Still a failure.',
        formatGroup(fallenBack),
        ''
      );
    }

    lines.push(
      '  The vocabulary is right and the names are wrong: fix the reference to name a real token.',
      '  Do NOT add the invented name to 01-tokens-and-base.css to make it resolve.',
      ''
    );
  }

  for (const row of drifted) {
    lines.push(
      `  REGISTERED GAP MOVED: ${row.key.replace('|', '  ')} — pinned at ${row.expected} reference(s), found ${row.actual}.`,
      '  A known-undefined token must not spread. Fix the new one, or fix them all and delete the pin.',
      ''
    );
  }

  for (const key of stale) {
    lines.push(
      `  STALE PIN: ${key.replace('|', '  ')} is registered as an unresolved gap but no longer occurs.`,
      '  Good news — delete its entry from REGISTERED_GAPS so the list keeps describing reality.',
      ''
    );
  }

  assert.fail(lines.join('\n'));
});

test('the registered gaps are still reported out loud rather than silently tolerated', () => {
  const total = REGISTERED_GAPS.reduce((sum, gap) => sum + gap.count, 0);
  assert.ok(total >= 0);
  if (total === 0) return;
  console.log(
    `[cssCustomProperties] ${total} unresolved var() references remain, pinned and unfixed `
    + `(live defect register #24): ${REGISTERED_GAPS.map(g => `${g.property} ×${g.count} in ${path.posix.basename(g.file)}`).join('; ')}`
  );
});
