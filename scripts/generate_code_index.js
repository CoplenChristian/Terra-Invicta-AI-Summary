#!/usr/bin/env node
// scripts/generate_code_index.js
//
// Purpose: Generate docs/code-index.md, the required-reading map of what lives
//   where, from the source tree. Everything derivable is derived; the only
//   hand-written piece is each module's `Purpose:` line, and a test fails when
//   that is missing so the index cannot rot silently.
//
// Run with `npm run index`. Output is deterministic: the same tree always
// produces byte-identical docs/code-index.md, which tests/codeIndex.test.js
// pins as the staleness guard.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_PATH = path.join(ROOT, 'docs', 'code-index.md');

// Directories whose source modules the index lists, in display order.
const SOURCE_ROOTS = [
  { dir: 'server', runtime: 'Node (CommonJS)' },
  { dir: 'shared', runtime: 'Node + Cloudflare worker (ESM)' },
  { dir: 'site/worker', runtime: 'Cloudflare worker only (ESM)' },
  { dir: 'src', runtime: 'Browser (React JSX)' },
  { dir: 'public/v2', runtime: 'Browser (classic, global IIFE)' },
  { dir: 'public/js', runtime: 'Browser (legacy, non-module)' },
  { dir: 'scripts', runtime: 'Node (CommonJS)' }
];

const EXTENSIONS = new Set(['.js', '.mjs', '.jsx']);

// v2 stylesheet parts are indexed separately: order is read from the shell's
// <link> tags (the cascade), not from readdir. Purpose text is parsed from each
// part's header comment rather than a duplicate Purpose: line — every part
// already opens with what it styles and its source range; coupling the parser
// to that one format is cheaper than maintaining 24 parallel purpose strings.
const CSS_SHELL = path.join(ROOT, 'public', 'v2', 'index.html');
const CSS_HREF_PREFIX = '/v2/css/';

// The four barrels the spec names. Classified by heuristic; these are pinned so
// the heuristic cannot silently regress (tests/codeIndex.test.js asserts all
// four are barrels and a spot-check of implementations is not).
const KNOWN_BARRELS = new Set([
  'server/snapshotBuilder.js',
  'shared/intelResources.mjs',
  'server/index.js',
  'server/requestValidation.js'
]);

function walk(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const full = path.join(dir, name);
    const rel = normalizePath(full);
    if (rel === 'public/v2/app' || rel === 'dist' || rel.startsWith('dist/')) continue;
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      out.push(...walk(full));
    } else if (EXTENSIONS.has(path.extname(name))) {
      out.push(full);
    }
  }
  return out;
}

function normalizePath(abs) {
  return path.relative(ROOT, abs).split(path.sep).join('/');
}

function isEsm(abs, rel) {
  if (rel.endsWith('.mjs')) return true;
  if (rel.startsWith('site/worker/')) return true;
  const src = fs.readFileSync(abs, 'utf8');
  if (/\bimport\s+[^'"]+from\s+['"]/.test(src) || /^\s*export\s+(?:const|let|var|function|class|\{|\*)/m.test(src)) return true;
  return false;
}

// Leading comment block: the contiguous `//` lines and/or the first `/* ... */`
// block before any executable code.
function leadingComment(src) {
  const lines = src.split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    const t = line.trim();
    if (t === '') continue;
    if (t.startsWith('#!')) continue;
    if (t.startsWith('//')) {
      out.push(t.replace(/^\/\//, '').trim());
      continue;
    }
    if (t.startsWith('/*')) {
      const rest = line.slice(line.indexOf('/*') + 2);
      out.push(...blockLines(rest));
      // consume until closing */
      let idx = lines.indexOf(line);
      while (!lines[idx].includes('*/')) {
        idx += 1;
        out.push(lines[idx].replace(/\*\//, '').replace(/^\s*\* ?/, '').trim());
      }
      break;
    }
    // Executable code reached.
    break;
  }
  return out;
}

function blockLines(firstRest) {
  // First line after /* : if it ends with */ strip it; else push and continue
  if (firstRest.includes('*/')) {
    return [firstRest.replace(/\*\/.*$/, '').replace(/^\s*\* ?/, '').trim()];
  }
  return [firstRest.replace(/^\s*\* ?/, '').trim()];
}

// Purpose line: text after `Purpose:` in the leading comment. Returns null when
// the module has no hand-written purpose line (the test fails on this).
function readPurpose(src) {
  for (const line of leadingComment(src)) {
    const m = line.match(/^Purpose:\s*(.+)$/i);
    if (m && m[1].trim()) return m[1].trim();
  }
  return null;
}

// Exported names, best-effort for ESM and CJS.
function exportedNames(src, rel, esm) {
  const names = new Set();
  if (esm) {
    for (const m of src.matchAll(/export\s+(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) {
      names.add(m[1]);
    }
    for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop().split(':').pop().trim();
        if (name && /^[A-Za-z_$]/.test(name)) names.add(name);
      }
    }
  } else {
    const objStart = src.search(/module\.exports\s*=\s*\{/);
    if (objStart !== -1) {
      const brace = src.indexOf('{', objStart);
      const inner = matchBraces(src, brace);
      for (const key of inner.matchAll(/(?:^|[,{])\s*([A-Za-z_$][\w$]*)\s*(?=\s*[:}|,]|$)/g)) {
        names.add(key[1]);
      }
    }
    for (const m of src.matchAll(/Object\.assign\([^,]*,\s*\{([\s\S]*?)\}\)/g)) {
      for (const key of m[1].matchAll(/(?:^|[,{])\s*([A-Za-z_$][\w$]*)\s*(?=\s*[:}|,]|$)/g)) {
        names.add(key[1]);
      }
    }
    // Direct property exports.
    for (const m of src.matchAll(/exports\.([A-Za-z_$][\w$]*)\s*=/g)) {
      names.add(m[1]);
    }
  }
  return [...names].sort();
}

// Returns the text inside the brace-delimited block that opens at `openIdx`,
// matching balanced braces/arrays (handles nested object/array literals).
function matchBraces(src, openIdx) {
  let depth = 0;
  let i = openIdx;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ']') depth -= 1;
    if (depth === 0) break;
  }
  return src.slice(openIdx + 1, i);
}

// Local (same-tree) import count.
function localImportCount(src, esm) {
  const pattern = esm
    ? /from\s+['"]\.{1,2}\/[^'"]+['"]/g
    : /require\(['"]\.{1,2}\/[^'"]+['"]\)/g;
  const matches = src.match(pattern) || [];
  return new Set(matches.map(m => m)).size;
}

// Own (module-level) function/class definitions, excluding Object.assign of
// imported objects and excluding inline arrow callbacks inside route/middleware.
function ownFunctionCount(src, esm) {
  let count = 0;
  for (const m of src.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) {
    if (m[1] !== 'module' && m[1] !== 'require') count += 1;
  }
  for (const m of src.matchAll(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\([^)]*\)\s*=>|\(\)\s*=>)/gm)) {
    count += 1;
  }
  for (const m of src.matchAll(/^class\s+([A-Za-z_$][\w$]*)/gm)) {
    count += 1;
  }
  return count;
}

// Barrel classification. Verified against the four known barrels and a spot
// check of implementations (tests/codeIndex.test.js).
function isBarrel(src, rel, esm) {
  if (esm) {
    const reexports = (src.match(/\bexport\s+[^;]*?\bfrom\s+['"]/g) || []).length;
    if (reexports === 0) return false;
    const localDefs = (src.match(/\bexport\s+(?:const|let|var|function|class)\s+/g) || []).length;
    return reexports > 0 && localDefs === 0;
  }
  const localImports = localImportCount(src, esm);
  const own = ownFunctionCount(src, esm);
  if (localImports < 2 || own > 2) return false;
  const exported = exportedNames(src, rel, esm);
  // Composition root with no own functions and no named exports (e.g.
  // server/index.js exporting the Express app): a barrel by construction.
  if (own === 0 && exported.length === 0) return true;
  if (exported.length === 0) return false;
  // A barrel re-exports most of its surface. Count the share of exported names
  // that are re-exported rather than defined here: the module.exports value is
  // a bare identifier, a shorthand, or a member expression on an imported
  // module -- NOT an inline function body. An implementation (commentary/
  // index.js, rules/index.js) defines its own exports as real bodies.
  const local = locallyDefinedNames(src);
  const reexported = exported.filter(name => isReexportedName(src, name, local)).length;
  return reexported / exported.length >= 0.5;
}

// Names bound to a declaration at module scope in this file.
function locallyDefinedNames(src) {
  const names = new Set();
  for (const m of src.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^class\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  return names;
}

// True for an exported name whose module.exports binding is a re-export: the
// shorthand form, a bare identifier, or `module.member` -- as opposed to an
// inline function/arrow body that defines the value here. A name defined at
// module scope in this file is never a re-export, even in shorthand form.
function isReexportedName(src, name, local) {
  if (local.has(name)) return false;
  const re = new RegExp(`(?:^|,|\\{)\\s*${name}\\s*(?::\\s*[A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)*|,|\\}|$)`, 'm');
  const m = src.match(re);
  if (!m) return false;
  // The captured value (if any) must be a bare identifier / member expression,
  // which the regex above already guarantees: it only matches a `:` followed by
  // an identifier chain. A value of `name: (…) =>`, `name: {`, `name: function`
  // does not match, so those count as local definitions.
  return true;
}

// Test file for a module, if one exists.
function testFile(rel) {
  const base = path.basename(rel, path.extname(rel));
  const candidate = path.join(ROOT, 'tests', `${base}.test.js`);
  return fs.existsSync(candidate) ? `tests/${base}.test.js` : null;
}

function moduleSystem(src, rel, esm) {
  if (esm) return 'E';
  if (rel.startsWith('public/')) return 'BS'; // browser script, not a module
  if (/\brequire\s*\(|module\.exports/.test(src)) return 'C';
  return 'C';
}

function lineCount(abs) {
  return fs.readFileSync(abs, 'utf8').split(/\r?\n/).length;
}

/** Stylesheet hrefs from the v2 shell, in document (cascade) order. */
function linkedCssHrefs() {
  const html = fs.readFileSync(CSS_SHELL, 'utf8');
  const hrefs = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/rel\s*=\s*["']stylesheet["']/i.test(tag)) continue;
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (href) hrefs.push(href[1]);
  }
  return hrefs.filter(href => href.startsWith(CSS_HREF_PREFIX));
}

/**
 * First descriptive paragraph in a v2 CSS part header — the text between the
 * filename line and the provenance `Source:` line.
 */
function readCssPurpose(src) {
  const header = src.match(/^\/\*\s*=+\s*\n([\s\S]*?)\*\//);
  if (!header) return null;
  const lines = header[1].split(/\r?\n/).map(line => line.replace(/^\s*\*?\s?/, '').trim());
  let i = 0;
  while (i < lines.length && !/\.css$/i.test(lines[i])) i += 1;
  if (i >= lines.length) return null;
  i += 1;
  while (i < lines.length && lines[i] === '') i += 1;
  const parts = [];
  while (i < lines.length) {
    const line = lines[i];
    if (line === '' || /^Source:/i.test(line)) break;
    parts.push(line);
    i += 1;
  }
  if (!parts.length) return null;
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function collectCssParts() {
  const parts = [];
  let order = 0;
  for (const href of linkedCssHrefs()) {
    order += 1;
    const rel = ('public' + href).split(path.sep).join('/');
    const abs = path.join(ROOT, 'public', href.slice(1));
    const src = fs.readFileSync(abs, 'utf8');
    parts.push({
      rel,
      order,
      lines: lineCount(abs),
      purpose: readCssPurpose(src)
    });
  }
  return parts;
}

function collect() {
  const modules = [];
  for (const { dir, runtime } of SOURCE_ROOTS) {
    const absRoot = path.join(ROOT, dir);
    if (!fs.existsSync(absRoot)) continue;
    for (const abs of walk(absRoot)) {
      const rel = normalizePath(abs);
      const src = fs.readFileSync(abs, 'utf8');
      const esm = isEsm(abs, rel);
      modules.push({
        rel,
        runtime,
        esm,
        sys: moduleSystem(src, rel, esm),
        lines: lineCount(abs),
        purpose: readPurpose(src),
        exports: exportedNames(src, rel, esm),
        barrel: isBarrel(src, rel, esm),
        testFile: testFile(rel)
      });
    }
  }
  // public/index.html is the legacy v1 dashboard shell. It is not a module the
  // index parses, but it must be listed and marked do-not-edit so an agent does
  // not mistake it for the live v2 entry point.
  const legacyShell = path.join(ROOT, 'public', 'index.html');
  if (fs.existsSync(legacyShell)) {
    modules.push({
      rel: 'public/index.html',
      runtime: 'Browser (legacy v1)',
      esm: false,
      sys: '—',
      lines: lineCount(legacyShell),
      purpose: 'legacy v1 dashboard shell -- DO NOT EDIT',
      exports: [],
      barrel: false,
      testFile: null
    });
  }
  modules.sort((a, b) => a.rel.localeCompare(b.rel));
  return { modules, cssParts: collectCssParts() };
}

function renderIndex({ modules, cssParts }) {
  const lines = [];
  lines.push('# Code Index');
  lines.push('');
  lines.push('A required-reading map of what lives where, so an agent stops guessing.');
  lines.push('');
  lines.push('> Generated by `npm run index` from `scripts/generate_code_index.js`. Everything');
  lines.push('> here is derived from the source tree except each module\'s `Purpose:` line, which');
  lines.push('> is hand-written and enforced by `tests/codeIndex.test.js` -- a source module with');
  lines.push('> no purpose line fails the suite, and the checked-in index failing to match a');
  lines.push('> fresh generation fails it too. Stylesheet parts carry a parsed purpose from');
  lines.push('> their header comment; the shell\'s `<link>` order is load-bearing cascade order.');
  lines.push('');
  lines.push('Legend: **B** = barrel (re-exports another module\'s surface); **E** = ESM; **C** = CommonJS; **BS** = browser script (no module system).');
  lines.push('');
  lines.push(`**${modules.length} JS modules** and **${cssParts.length} stylesheet parts** (${modules.length + cssParts.length} indexed files).`);
  lines.push('');

  let currentDir = null;
  for (const m of modules) {
    const dir = m.rel.split('/')[0];
    if (dir !== currentDir) {
      if (currentDir !== null) lines.push('');
      lines.push(`## \`${dir}/\``);
      lines.push('');
      lines.push('| module | B/E/C | runtime | lines | purpose | exports | test |');
      lines.push('| :-- | :--: | :-- | --: | :-- | :-- | :-- |');
      currentDir = dir;
    }
    const sys = m.sys;
    const barrel = m.barrel ? '**B** ' : '';
    const purpose = m.purpose ? m.purpose.replace(/\|/g, '\\|') : '**MISSING**';
    const test = m.testFile ? `\`${m.testFile}\`` : '—';
    const exportsCell = m.exports.length
      ? '`' + m.exports.slice(0, 12).join(', ') + (m.exports.length > 12 ? `, …(+${m.exports.length - 12})` : '') + '`'
      : '—';
    lines.push(`| \`${m.rel}\` | ${barrel}${sys} | ${m.runtime} | ${m.lines} | ${purpose} | ${exportsCell} | ${test} |`);
  }

  lines.push('');
  lines.push('## `public/v2/css/`');
  lines.push('');
  lines.push('The v2 stylesheet in **cascade order** — the numeric prefix and the shell\'s');
  lines.push('`<link>` tags agree, and **reordering these parts changes what the reader sees**');
  lines.push('(for example `05-view-grid.css` must load before `15-responsive.css`).');
  lines.push('');
  lines.push('| order | module | lines | purpose |');
  lines.push('| --: | :-- | --: | :-- |');
  for (const part of cssParts) {
    const purpose = part.purpose ? part.purpose.replace(/\|/g, '\\|') : '**MISSING**';
    lines.push(`| ${part.order} | \`${part.rel}\` | ${part.lines} | ${purpose} |`);
  }
  lines.push('');
  return lines.join('\n') + '\n';
}

/** @deprecated alias — prefer renderIndex */
function render(payload) {
  if (Array.isArray(payload)) {
    return renderIndex({ modules: payload, cssParts: collectCssParts() });
  }
  return renderIndex(payload);
}

if (require.main === module) {
  const { modules, cssParts } = collect();
  const missingJs = modules.filter(m => !m.purpose).map(m => m.rel);
  const missingCss = cssParts.filter(m => !m.purpose).map(m => m.rel);
  const content = renderIndex({ modules, cssParts });
  fs.writeFileSync(OUT_PATH, content);
  console.log(`Wrote ${OUT_PATH} (${modules.length} JS modules, ${cssParts.length} CSS parts).`);
  const missing = [...missingJs, ...missingCss];
  if (missing.length) {
    console.warn(`\nWarning: ${missing.length} file(s) have no purpose line:\n  ${missing.join('\n  ')}`);
  }
  process.exit(missing.length ? 2 : 0);
}

module.exports = { collect, render, renderIndex, readCssPurpose, linkedCssHrefs };
