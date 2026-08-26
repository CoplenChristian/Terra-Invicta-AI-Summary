/**
 * Type scale integrity.
 *
 * The v2 stylesheet reached 393 `font-size` declarations carrying 24 distinct
 * rendered sizes, 310 of them raw literals, before this guard existed. Four of
 * those sizes were never written down at all -- they were 5/6 of something
 * else, because an unstyled <small> takes `font-size: smaller` from the UA
 * sheet -- and two were viewport clamps, so the rendered size depended on the
 * window width. This file is the guard that stops the drift returning.
 *
 * Three checks, and the middle one is the one with a scar behind it:
 *
 * 1. Every `font-size` in the v2 stylesheet names a token, not a literal.
 * 2. Every `--fs-*` token a declaration names is DEFINED in :root. `--fs-label`
 *    was referenced twice and defined nowhere, and CSS does not fall back to
 *    the cascade for that: an undefined custom property is valid at parse time
 *    and invalid at computed-value time, so the declaration still WINS and then
 *    resolves to `inherit`. The FLEET procurement heading therefore rendered at
 *    the body's 13px while out-specifying the 10px rule beside it, and looked
 *    deliberate. Nothing failed; it just quietly disagreed with the component
 *    it was supposed to match.
 * 3. No component script writes a font-size literal into an inline style, which
 *    is how five 9px declarations lived outside the stylesheet entirely.
 *
 * SVG font sizes inside a viewBox are user units, not page pixels, and are
 * deliberately exempt -- see the --fs-map-* note in :root and TYPE in
 * worldMapUtils.js.
 *
 * CHECK 3 STOPPED COVERING ANY COMPONENT ON 2026-08-26, AND DID NOT SAY SO.
 * It walked `public/v2/js` and matched only `.js`. The React migration moved all
 * sixteen components to `.jsx` under `src/v2/panels/`, which that walk never
 * reaches, so the guard went on reporting green over an empty component set --
 * live defect register #18. This is the SECOND time in this codebase that code
 * moved out from under a guard that walked a directory (the first was the
 * SERVICE_ROLE scan after a file split), so check 3 now also asserts what it
 * actually inspected: both roots non-empty, and at least the sixteen panels. A
 * guard that passes because it found nothing to check is the failure mode.
 *
 * The stylesheet became an ordered set of parts on 2026-08-23. All three checks
 * read the whole set through tests/fixtures/missionControlCss.js, which takes
 * the order from the shell's <link> tags; a fourth check below asserts that set
 * is the same set as the directory, so a part added later cannot slip past
 * every guard here at once.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  readMissionControlCss,
  stylesheetSources,
  assertStylesheetManifest
} = require('./fixtures/missionControlCss');

const ROOT_DIR = path.join(__dirname, '..');

/**
 * Where component code lives. Both roots, because it lives in both: the vanilla
 * shell never moved, and the sixteen migrated components are under src/v2.
 */
const COMPONENT_ROOTS = [
  'public/v2/js',
  'src/v2'
];

/** Panels covered by the floor assertion below. */
const PANEL_DIR = 'src/v2/panels';
const PANEL_FLOOR = 16;

const COMPONENT_EXTENSIONS = ['.js', '.jsx', '.mjs'];

/**
 * The token source, exempt for the same reason :root is exempt from check 1.
 *
 * theme.js is the React mirror of the :root custom properties -- it DEFINES the
 * scale rather than spending it, and `typography.fontSize: 12.5` is MUI's base
 * size, the one literal the ladder has to start from. It is not on trust:
 * tests/reactThemeParity.test.js compares all 47 token values against
 * getComputedStyle(document.documentElement), so a drift here fails there.
 *
 * Asserted to exist below, so this exemption cannot outlive the file it names.
 */
const TOKEN_SOURCE = 'src/v2/theme.js';

/**
 * The three shapes a font-size literal takes in this codebase.
 *
 * What is deliberately NOT here is the SVG presentation attribute, in either
 * spelling. The vanilla form `'font-size': 8` carries no unit, and pattern 1
 * requires one. The JSX form `fontSize={8}` is an attribute, and patterns 2 and
 * 3 require a `:`. Both are SVG user units inside a viewBox -- 8 units renders
 * near 7px in a 640px card and near 10px in a 900px one -- so they are a
 * different coordinate system, not a page size. world-map sets its type that
 * way on purpose.
 *
 * `style={{ fontSize: 8 }}` on an SVG element is NOT exempt and should not be:
 * React appends `px` to a number in a style object, so that renders 8 page
 * pixels, which is the very confusion the exemption exists to keep separate.
 */
const FONT_SIZE_LITERAL_PATTERNS = [
  // A CSS declaration written into a string or a style="" attribute.
  { label: 'css literal', re: /font-size:\s*(?!var\()[0-9.]+(?:px|rem|em)/ },
  // A React style object with an explicit unit: style={{ fontSize: '9px' }}.
  { label: 'style-object literal', re: /\bfontSize\s*:\s*['"`]\s*[0-9.]+(?:px|rem|em)/ },
  // A React style object with a bare number: style={{ fontSize: 9 }}. React
  // renders that as 9px, so it is the same declaration wearing a different hat.
  { label: 'style-object number', re: /\bfontSize\s*:\s*[0-9.]+/ }
];

/** Declarations that are deliberately not a size on the scale. */
const EXEMPT_VALUES = new Set([
  '0',        // .init-logo-icon -- suppresses the alt text of an icon, not readable type
  'inherit'   // the <small> reset, and anything that defers to its host on purpose
]);

/** Tokens that are page pixels and must be on the scale. */
const SCALE_TOKENS = ['--fs-tag', '--fs-meta', '--fs-metric', '--fs-row', '--fs-section', '--fs-kpi', '--fs-title'];

/** Tokens that are SVG user units inside a viewBox, exempt from the scale. */
const MAP_TOKENS = ['--fs-map-name', '--fs-map-note'];

function readCss() {
  return readMissionControlCss();
}

/**
 * Every `font-size: <value>;` across every part the shell links, in cascade
 * order, with the part and line it sits on.
 *
 * It walks the parts rather than the concatenation for one reason: a line
 * number into 217KB of joined text names nothing a reader can open, and the
 * whole value of this guard is that its failure message points at the
 * declaration. The SET it walks still comes from the shell's link list, so a
 * part added later is covered without this file being touched.
 */
function fontSizeDeclarations() {
  const out = [];
  for (const source of stylesheetSources()) {
    const lines = source.text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const m = lines[i].trim().match(/^font-size:\s*([^;]+);/);
      if (m) out.push({ where: `${source.relativePath}:${i + 1}`, value: m[1].trim() });
    }
  }
  return out;
}

/** The custom properties :root actually defines. */
function definedCustomProperties(css) {
  const defined = new Set();
  for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/gi)) defined.add(m[1]);
  return defined;
}

/**
 * The completeness check the split depends on.
 *
 * Every guard in this file, and in the five other test files that read the v2
 * stylesheet, scans the set of parts `public/v2/index.html` links. A part that
 * exists on disk with no `<link>` would render nowhere in the browser AND be
 * invisible to all six of them at once -- a scan that finds nothing wrong
 * because it never looked. This is the assertion that makes "add a file and it
 * is covered" true instead of hopeful.
 */
test('every stylesheet part on disk is linked by the shell, and every link exists', () => {
  const linked = assertStylesheetManifest();
  assert.ok(linked.length > 0, 'the shell must link at least one v2 stylesheet part');
});

test('every font-size in the v2 stylesheet names a token rather than a literal', () => {
  const decls = fontSizeDeclarations();
  assert.ok(decls.length > 300, `expected the full stylesheet, found only ${decls.length} declarations`);

  const literals = decls.filter(d => {
    const bare = d.value.replace(/\s*!important\s*$/, '').trim();
    if (EXEMPT_VALUES.has(bare)) return false;
    return !/^var\(--fs-[a-z-]+\)$/.test(bare);
  });

  assert.deepStrictEqual(
    literals.map(d => `${d.where}: ${d.value}`),
    [],
    'font-size must name a --fs-* token; a literal here is how the file reached 24 rendered sizes'
  );
});

test('every --fs-* token a declaration names is defined in :root', () => {
  const css = readCss();
  const defined = definedCustomProperties(css);
  const referenced = new Set();
  for (const d of fontSizeDeclarations()) {
    for (const m of d.value.matchAll(/var\((--fs-[a-z-]+)\)/g)) referenced.add(m[1]);
  }

  assert.ok(referenced.size > 0, 'no --fs-* token was referenced at all, so this check proved nothing');

  const undefinedTokens = [...referenced].filter(t => !defined.has(t)).sort();
  assert.deepStrictEqual(
    undefinedTokens,
    [],
    'an undefined custom property does not fall back to the cascade -- it wins and then resolves to inherit'
  );

  // The definition side, so deleting a token is caught as loudly as adding one.
  for (const token of [...SCALE_TOKENS, ...MAP_TOKENS]) {
    assert.ok(defined.has(token), `${token} is not defined in the stylesheet`);
  }
});

test('the scale is seven steps, each visibly larger than the one below it', () => {
  const css = readCss();
  const sizes = SCALE_TOKENS.map(token => {
    const m = css.match(new RegExp(`${token}:\\s*([0-9.]+)px`));
    assert.ok(m, `${token} must be defined as a px value in :root`);
    return { token, px: Number(m[1]) };
  });

  // Declared smallest-first here; the stylesheet declares them largest-first.
  for (let i = 1; i < sizes.length; i += 1) {
    const lower = sizes[i - 1];
    const upper = sizes[i];
    assert.ok(
      upper.px > lower.px,
      `${upper.token} (${upper.px}px) must be larger than ${lower.token} (${lower.px}px)`
    );
    const ratio = upper.px / lower.px;
    assert.ok(
      ratio >= 1.09,
      `${lower.token} -> ${upper.token} is a ${((ratio - 1) * 100).toFixed(1)}% step; `
      + 'adjacent steps closer than ~10% do not read as hierarchy, they read as drift'
    );
  }

  assert.strictEqual(sizes[0].px, 9, 'the floor stays at 9px; nothing on this dashboard renders below it');
});

/** Every component source file under both roots, repo-relative, sorted. */
function componentSources() {
  const found = [];
  const walk = dir => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!COMPONENT_EXTENSIONS.includes(path.extname(entry.name))) continue;
      found.push(path.relative(ROOT_DIR, full).split(path.sep).join('/'));
    }
  };
  for (const root of COMPONENT_ROOTS) walk(path.join(ROOT_DIR, root));
  return found.sort();
}

/**
 * The assertion that makes check 3 mean something.
 *
 * Register #18: any guard that walks a directory rather than a manifest
 * silently narrows as code relocates, and reports green the whole way down.
 * This one cannot any more -- it states the size of the set it inspected, per
 * root, and pins the panel count. Moving the panels somewhere neither root
 * covers now fails here instead of passing quietly.
 */
test('the component walk actually reaches both roots and all sixteen panels', () => {
  const inspected = componentSources();

  assert.ok(inspected.length > 0, 'the component walk inspected no files at all');

  for (const root of COMPONENT_ROOTS) {
    const fromRoot = inspected.filter(rel => rel.startsWith(`${root}/`));
    assert.ok(
      fromRoot.length > 0,
      `${root} contributed no component files -- either it moved or the extension list missed it`
    );
  }

  const panels = inspected.filter(rel => rel.startsWith(`${PANEL_DIR}/`) && rel.endsWith('.jsx'));
  assert.ok(
    panels.length >= PANEL_FLOOR,
    `expected at least ${PANEL_FLOOR} panels under ${PANEL_DIR}, found ${panels.length}. `
    + 'The migration put sixteen there; fewer means they moved and this guard stopped covering them.'
  );

  assert.ok(
    fs.existsSync(path.join(ROOT_DIR, TOKEN_SOURCE)),
    `${TOKEN_SOURCE} is exempt from the literal check but does not exist -- `
    + 'the exemption has outlived its target and is now silently widening the hole'
  );
});

test('no component script writes a font-size literal into an inline style', () => {
  const offenders = [];
  let scanned = 0;

  for (const rel of componentSources()) {
    if (rel === TOKEN_SOURCE) continue;
    scanned += 1;
    const src = fs.readFileSync(path.join(ROOT_DIR, rel), 'utf8');
    src.split(/\r?\n/).forEach((line, index) => {
      for (const { label, re } of FONT_SIZE_LITERAL_PATTERNS) {
        if (re.test(line)) offenders.push(`${rel}:${index + 1} (${label}): ${line.trim()}`);
      }
    });
  }

  assert.ok(scanned > 0, 'no component file was scanned, so this check proved nothing');

  assert.deepStrictEqual(
    offenders,
    [],
    'an inline font-size literal is invisible to the stylesheet and to this scale'
  );
});
