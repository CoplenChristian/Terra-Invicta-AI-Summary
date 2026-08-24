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
 * world-map.js.
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

const COMPONENT_DIR = path.join(__dirname, '..', 'public', 'v2', 'js');

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

test('no component script writes a font-size literal into an inline style', () => {
  const offenders = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.js')) continue;
      const src = fs.readFileSync(full, 'utf8');
      src.split(/\r?\n/).forEach((line, index) => {
        // `font-size: 9px` inside a style="" attribute. SVG presentation
        // attributes (`'font-size': 8`) are user units and are exempt.
        if (/font-size:\s*(?!var\()[0-9.]+(px|rem|em)/.test(line)) {
          offenders.push(`${path.relative(COMPONENT_DIR, full)}:${index + 1}`);
        }
      });
    }
  };
  walk(COMPONENT_DIR);

  assert.deepStrictEqual(
    offenders,
    [],
    'an inline font-size literal is invisible to the stylesheet and to this scale'
  );
});
