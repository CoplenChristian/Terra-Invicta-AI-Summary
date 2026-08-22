/**
 * Unlocked Technology panel + mobile overflow guards.
 *
 * The browser-measured evidence for the overflow fix lives in
 * scripts/verify_mobile_overflow.js, which reads getBoundingClientRect and
 * getComputedStyle off a live DOM. These are the cheap regression tripwires that
 * run in CI without a browser: they pin the wiring and the honesty rules that a
 * later edit could quietly undo.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.join(__dirname, '..');
const cssPath = path.join(repoRoot, 'public/v2/css/mission-control.css');
const htmlPath = path.join(repoRoot, 'public/v2/index.html');
const missionControlJsPath = path.join(repoRoot, 'public/v2/js/mission-control.js');
const panelJsPath = path.join(repoRoot, 'public/v2/js/components/unlocked-tech.js');

function readCss() {
  return fs.readFileSync(cssPath, 'utf8');
}

/** Pull the body of the first `@media (max-width: 900px)` block. */
function narrowMediaBlock(css) {
  const start = css.indexOf('@media (max-width: 900px)');
  assert.ok(start >= 0, 'the max-width: 900px block must exist');
  let depth = 0;
  let i = css.indexOf('{', start);
  const open = i;
  for (; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open, i + 1);
    }
  }
  throw new Error('unterminated media block');
}

test('the narrow-viewport block un-shrink-wraps the view grid, which is what let DRIVES clip', () => {
  const block = narrowMediaBlock(readCss());

  // The block turns .init-view__grid into a column flex container, so the base
  // rule's `align-items: start` would otherwise size items to max-content on the
  // cross axis -- measured at 937px inside a 375px viewport.
  assert.match(
    block,
    /\.init-view__grid,\s*\n\s*\.init-grid-layout\s*\{\s*\n\s*align-items:\s*stretch;/,
    'the narrow block must stretch view-grid children, or a wide table widens the whole page'
  );
  assert.match(
    block,
    /\.init-view__grid\s*>\s*\*,\s*\n\s*\.init-grid-layout\s*>\s*\*\s*\{\s*\n\s*min-width:\s*0;/,
    'view-grid children must be allowed to shrink below their content width'
  );
  assert.ok(
    /\.de-table-wrap/.test(block),
    'the drive table wrapper must be constrained at narrow widths so its overflow-x: auto engages'
  );
});

// NOTE: there is deliberately no test pinning `min-width: 0` on
// `.init-view__span`. That declaration is defensive rather than load-bearing --
// removing it and re-measuring left the drive table wrapper scrolling correctly
// at 910px and 940px -- so a test asserting it would fail for a change that
// causes no defect, which is the "guard that pins a non-fact" pattern CLAUDE.md
// warns about. The load-bearing rule is the narrow-block one above, and it is
// pinned by both that test and scripts/verify_mobile_overflow.js.

test('scroll hints are driven by measured overflow, never by viewport width alone', () => {
  const css = readCss();

  // Base state is hidden, and the ONLY reveal is the measured class. A width-only
  // reveal put "SWIPE HORIZONTALLY" above tables measuring 698/698.
  assert.match(
    css,
    /\.mc-board-scroll-hint\.is-scrollable,\s*\n\s*\.de-scroll-hint\.is-scrollable\s*\{\s*\n\s*display:\s*block;/,
    'the hints must be revealed by the is-scrollable class'
  );

  const block = narrowMediaBlock(css);
  assert.ok(
    !/\.mc-board-scroll-hint\s*\{\s*display:\s*block/.test(block),
    'the narrow block must not reveal the board scroll hint by width'
  );
  assert.ok(
    !/\.de-scroll-hint\s*\{\s*display:\s*block/.test(block),
    'the narrow block must not reveal the drive scroll hint by width'
  );
});

test('syncScrollHints toggles on scrollWidth vs clientWidth, not on window size', () => {
  const js = fs.readFileSync(missionControlJsPath, 'utf8');

  const makeHint = () => {
    const classes = new Set();
    return {
      classList: {
        toggle: (name, on) => { if (on) classes.add(name); else classes.delete(name); },
        has: name => classes.has(name)
      },
      previousElementSibling: null
    };
  };

  const overflowing = makeHint();
  overflowing.previousElementSibling = {
    matches: sel => sel === '.mc-board-table-wrap',
    scrollWidth: 780,
    clientWidth: 313
  };

  const fitting = makeHint();
  fitting.previousElementSibling = {
    matches: sel => sel === '.mc-board-table-wrap',
    scrollWidth: 698,
    clientWidth: 698
  };

  const orphan = makeHint(); // no wrapper before it at all

  const fakeDoc = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: (sel) => (sel === '.mc-board-scroll-hint' ? [overflowing, fitting, orphan] : []),
    addEventListener: () => {},
    createElement: () => ({ id: '', className: '', setAttribute: () => {}, prepend: () => {} })
  };

  const sandbox = {
    window: {},
    document: fakeDoc,
    console,
    location: { hash: '#/command' },
    addEventListener: () => {},
    fetch: () => Promise.resolve({ json: () => Promise.resolve({}) })
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(js, sandbox, { filename: missionControlJsPath });

  const { syncScrollHints } = sandbox.window.MissionControlViews || {};
  assert.strictEqual(typeof syncScrollHints, 'function', 'syncScrollHints must be exported');

  syncScrollHints(fakeDoc);

  assert.ok(overflowing.classList.has('is-scrollable'), 'a wrapper that overflows must show its hint');
  assert.ok(!fitting.classList.has('is-scrollable'), 'a wrapper that fits must not claim it can be swiped');
  assert.ok(!orphan.classList.has('is-scrollable'), 'a hint with no wrapper must not claim scrollability');
});

test('the unlocked technology panel is registered in RECORDS and mounted inside that section', () => {
  const js = fs.readFileSync(missionControlJsPath, 'utf8');
  const html = fs.readFileSync(htmlPath, 'utf8');

  const recordsSection = html.match(/<section[^>]*id="view-records"[\s\S]*?<\/section>/);
  assert.ok(recordsSection, '#view-records must exist');
  assert.ok(
    /id="unlockedTech"/.test(recordsSection[0]),
    'the panel element must live inside #view-records, or assertViewRegistryIntegrity throws'
  );

  const recordsEntry = js.match(/id:\s*'records'[\s\S]*?panels:\s*\[([\s\S]*?)\]/);
  assert.ok(recordsEntry, "the records entry in VIEWS must declare panels");
  assert.ok(
    /'unlockedTech'/.test(recordsEntry[1]),
    'unlockedTech must be listed in the records view registry entry'
  );

  assert.ok(
    /<script src="\/v2\/js\/components\/unlocked-tech\.js"><\/script>/.test(html),
    'the panel script must be loaded by the shell'
  );
});

test('the panel caps its rows and announces the omission rather than truncating silently', () => {
  const js = fs.readFileSync(panelJsPath, 'utf8');
  assert.match(js, /RENDER_CAP\s*=\s*\d+/, 'the render cap must be a named constant');
  assert.match(js, /omitted by the \$\{RENDER_CAP\}-row display cap/, 'the cap must name itself in the footer');
  assert.match(js, /shown of \$\{totalCount/, 'the footer must report shown-of-total');
});

test('an absent research cost renders as unavailable, never as zero', () => {
  const js = fs.readFileSync(panelJsPath, 'utf8');
  const fn = js.match(/function costLabel\(project\)\s*\{[\s\S]*?\n  \}/);
  assert.ok(fn, 'costLabel must exist');

  // Number(null) === 0, so the guard has to be on presence, before coercion.
  assert.match(fn[0], /=== null \|\| cost === undefined/, 'costLabel must guard on presence');
  assert.match(fn[0], /Number\.isFinite\(numeric\)/, 'a non-numeric cost must not become a number');
  assert.ok(
    /return null;/.test(fn[0]),
    'an absent cost must return null so the row can say UNAVAILABLE'
  );
  assert.match(js, /RESEARCH COST UNAVAILABLE/, 'the row must render an explicit unavailable state');
});

test('the match explanation keys on the display name only, since ids leak the query term', () => {
  const js = fs.readFileSync(panelJsPath, 'utf8');
  const fn = js.match(/function matchingUnlocks\(project, query\)\s*\{[\s\S]*?\n  \}/);
  assert.ok(fn, 'matchingUnlocks must exist');

  // Project_CopperheadMissileBay's ID contains "Copperhead" while its display
  // name (Hydrolox High Explosive Missiles) does not. Testing the id here
  // suppressed the chip that explains why the row matched -- the panel's whole
  // reason for existing.
  assert.ok(
    !/normalise\(project\.id\)/.test(fn[0]),
    'matchingUnlocks must not treat an internal-id match as a self-evident name match'
  );
  assert.match(fn[0], /normalise\(project\.displayName\)\.includes\(q\)/, 'the display name is the self-evident match');
});

test('the panel searches server-side and never reimplements matching', () => {
  const js = fs.readFileSync(panelJsPath, 'utf8');
  assert.match(js, /\/api\/intel\/tech-search\?observer=/, 'typed queries must go to the tech-search endpoint');
  assert.match(js, /\/api\/intel\/tech-tree\?observer=/, 'the default list must come from the tech-tree endpoint');
});
