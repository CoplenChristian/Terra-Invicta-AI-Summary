/**
 * Unlocked Technology panel + mobile overflow guards.
 *
 * The browser-measured evidence for the overflow fix lives in
 * scripts/verify_mobile_overflow.js, which reads getBoundingClientRect and
 * getComputedStyle off a live DOM. These are the cheap regression tripwires that
 * run in CI without a browser: they pin the wiring and the honesty rules that a
 * later edit could quietly undo.
 *
 * REACT MIGRATION (2026-08-26). The panel moved from the vanilla IIFE at
 * public/v2/js/components/unlocked-tech.js to src/v2/panels/UnlockedTech.jsx
 * plus src/v2/panels/unlockedTechUtils.js. Nothing here was dropped:
 *
 *   - The four source-text guards below (render cap, absent cost, display-name
 *     -only match, server-side search) now read the React sources. They were
 *     always source assertions rather than render assertions; the corresponding
 *     RENDERED behaviour is pinned by tests/unlockedTechRendering.test.js, which
 *     was written and confirmed green against the VANILLA component before the
 *     port so it could not pass by construction.
 *   - The shell-registration test now asserts the DELETED script tag stays
 *     deleted and that the React bundle supplies window.MissionControlUnlockedTech
 *     — the vanilla file, its script tag and the old global all had to go
 *     together, and this is the guard that says so.
 *   - The two census tests kept every assertion and every message; only the
 *     mount changed, from a `vm` sandbox to the real browser harness, because
 *     `node --test` cannot render a React component out of the Vite bundle.
 */

const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.join(__dirname, '..');
const htmlPath = path.join(repoRoot, 'public/v2/index.html');
const missionControlJsPath = path.join(repoRoot, 'public/v2/js/mission-control.js');
const panelJsxPath = path.join(repoRoot, 'src/v2/panels/UnlockedTech.jsx');
const panelUtilsPath = path.join(repoRoot, 'src/v2/panels/unlockedTechUtils.js');
const reactBridgePath = path.join(repoRoot, 'src/v2/main.jsx');

// The v2 stylesheet is an ordered set of parts. Both the text scans below and
// the live-DOM test have to see ALL of them: the scroll-hint check derives the
// set of styled *scroll-hint classes from the stylesheet and requires every one
// to be registered in syncScrollHints, so reading one part would silently
// shrink the set it checks -- a guard that passes because it stopped looking.
const { readMissionControlCss, stylesheetPaths } = require('./fixtures/missionControlCss');

function readCss() {
  return readMissionControlCss();
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

/**
 * The intelligence library's hint is the third one on the page and was left on
 * the width-only rule when the other two were converted. Measured 2026-08-21
 * against the live save: at 905-1040px the library table ran 840px inside a
 * 637-772px wrapper and the hint was suppressed, so real scrollable content was
 * unannounced; below 900px the reveal was unconditional and true only because
 * `.intel-library-table` sets `min-width: 840px`, i.e. by construction rather
 * than by measurement.
 *
 * Measured on a live DOM rather than read out of the stylesheet: this file's
 * other CSS assertions are text matches, and a text match cannot see a rule that
 * loses the cascade or a custom property that resolves to nothing. `--text-muted`
 * was once defined self-referentially and 164 rules silently fell back to
 * `inherit` with the source text still reading correctly.
 */
test('the intelligence-library scroll hint is revealed by measurement, not by viewport width', async () => {
  const { chromium } = require('playwright');

  // The wrappers are pinned to a fixed width so "overflows" and "fits" are
  // properties of the fixture rather than of the viewport under test.
  const fixture = `
    <div id="narrow" style="width: 340px">
      <div class="intel-library-table-wrap">
        <div class="intel-library-table-scroll-hint" id="hintOverflow" role="note">Swipe horizontally to inspect all columns</div>
        <table class="intel-library-table"><tbody><tr><td>wide</td></tr></tbody></table>
      </div>
    </div>
    <div id="fits" style="width: 340px">
      <div class="intel-library-table-wrap">
        <div class="intel-library-table-scroll-hint" id="hintFits" role="note">Swipe horizontally to inspect all columns</div>
        <table class="intel-library-table" style="min-width: 0; width: 100%"><tbody><tr><td>x</td></tr></tbody></table>
      </div>
    </div>`;

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await context.newPage();
    await page.setContent(fixture, { waitUntil: 'domcontentloaded' });
    // One <style> per part, in link order, so the page cascades them the way
    // the shell does. A single addStyleTag would silently drop 23 of the 24.
    for (const part of stylesheetPaths()) await page.addStyleTag({ path: part });
    await page.addScriptTag({ path: missionControlJsPath });

    const displayOf = id => page.evaluate(
      elementId => getComputedStyle(document.getElementById(elementId)).display,
      id
    );
    const measure = () => page.evaluate(() => {
      if (!window.MissionControlViews || typeof window.MissionControlViews.syncScrollHints !== 'function') {
        throw new Error('syncScrollHints must be exported for the library hint to be measurable');
      }
      window.MissionControlViews.syncScrollHints(document);
      const wrap = document.querySelector('#narrow .intel-library-table-wrap');
      return {
        overflowClassed: document.getElementById('hintOverflow').classList.contains('is-scrollable'),
        fitsClassed: document.getElementById('hintFits').classList.contains('is-scrollable'),
        overflowScrollWidth: wrap.scrollWidth,
        overflowClientWidth: wrap.clientWidth
      };
    });

    // Unmeasured is hidden. The width-only rule made this `block` at 375px for
    // both wrappers, which is the affordance lying about the data surface.
    assert.strictEqual(await displayOf('hintFits'), 'none', 'an unmeasured library hint must be hidden at 375px');
    assert.strictEqual(await displayOf('hintOverflow'), 'none', 'a library hint must not appear before anything measures it');

    const narrow = await measure();
    assert.ok(
      narrow.overflowScrollWidth > narrow.overflowClientWidth + 1,
      `the wide fixture must actually overflow (${narrow.overflowScrollWidth}/${narrow.overflowClientWidth})`
    );
    assert.ok(narrow.overflowClassed, 'syncScrollHints must register the library hint and mark the overflowing one');
    assert.ok(!narrow.fitsClassed, 'a library table that fits must not be marked scrollable');

    assert.strictEqual(await displayOf('hintOverflow'), 'block', 'the measured overflowing hint must render');
    assert.strictEqual(await displayOf('hintFits'), 'none', 'a library table that fits must not claim it can be swiped');

    // The other half of the same defect: the width-only rule stopped at 900px,
    // so a library table that overflowed on a desktop got no hint at all.
    await page.setViewportSize({ width: 1280, height: 800 });
    const wide = await measure();
    assert.ok(wide.overflowClassed, 'an overflowing library table must be announced above 900px too');
    assert.strictEqual(await displayOf('hintOverflow'), 'block', 'the hint must render above 900px when the table overflows');
    assert.strictEqual(await displayOf('hintFits'), 'none', 'a fitting library table stays silent at any width');
  } finally {
    await browser.close();
  }
});

test('every scroll hint the page renders is registered for measurement', () => {
  const js = fs.readFileSync(missionControlJsPath, 'utf8');
  const cssClasses = new Set(
    (readCss().match(/\.[a-z0-9-]*scroll-hint(?![a-z0-9-])/g) || []).map(match => match.slice(1))
  );
  assert.ok(cssClasses.size >= 3, 'the stylesheet must still carry the known hint classes');

  const registered = new Set(
    (js.match(/'\.([a-z0-9-]*scroll-hint)'/g) || []).map(match => match.slice(2, -1))
  );

  for (const hintClass of cssClasses) {
    assert.ok(
      registered.has(hintClass),
      `.${hintClass} is styled but never registered in syncScrollHints, so it is revealed by something other than measurement`
    );
  }
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

  // The vanilla file, its script tag and the old global had to go together. A
  // lane on an earlier wave shipped all three still in place, so the vanilla
  // panel was what actually rendered and the React one was never reached.
  assert.ok(
    !/components\/unlocked-tech\.js/.test(html),
    'the deleted vanilla panel must not still be loaded by the shell'
  );
  assert.ok(
    !fs.existsSync(path.join(repoRoot, 'public/v2/js/components/unlocked-tech.js')),
    'the vanilla panel file must be gone, so the global can only come from the bundle'
  );
  assert.match(
    fs.readFileSync(reactBridgePath, 'utf8'),
    /window\.MissionControlUnlockedTech\s*=\s*\{\s*load:\s*loadUnlockedTech\s*\}/,
    'the React bundle must supply the load(observerId, mode, container) global mission-control.js calls'
  );
});

test('the panel caps its rows and announces the omission rather than truncating silently', () => {
  const utils = fs.readFileSync(panelUtilsPath, 'utf8');
  const jsx = fs.readFileSync(panelJsxPath, 'utf8');
  assert.match(utils, /RENDER_CAP\s*=\s*\d+/, 'the render cap must be a named constant');
  assert.match(utils, /omitted by the \$\{RENDER_CAP\}-row display cap/, 'the cap must name itself in the footer');
  assert.match(utils, /shown of \$\{totalCount/, 'the footer must report shown-of-total');
  // ...and the cap must reach the reader through the primitive that carries
  // both counts, rather than through a sentence this file could stop printing.
  assert.match(jsx, /<TruncationNote/, 'the announced cap must be rendered by TruncationNote');
});

test('an absent research cost renders as unavailable, never as zero', () => {
  const utils = fs.readFileSync(panelUtilsPath, 'utf8');
  const jsx = fs.readFileSync(panelJsxPath, 'utf8');
  const fn = utils.match(/export function costLabel\(project\)\s*\{[\s\S]*?\n\}/);
  assert.ok(fn, 'costLabel must exist');

  // Number(null) === 0, so the guard has to be on presence, before coercion.
  assert.match(fn[0], /=== null \|\| cost === undefined/, 'costLabel must guard on presence');
  assert.match(fn[0], /Number\.isFinite\(numeric\)/, 'a non-numeric cost must not become a number');
  assert.ok(
    /return null;/.test(fn[0]),
    'an absent cost must return null so the row can say UNAVAILABLE'
  );
  assert.match(jsx, /RESEARCH COST UNAVAILABLE/, 'the row must render an explicit unavailable state');
  // In React `{cost}` with cost === null renders nothing at all — silently, and
  // indistinguishably from a measured empty. <Value> carries the presence signal.
  assert.match(
    jsx,
    /<Value[\s\S]{0,400}present=\{cost !== null\}/,
    'the nullable cost must go through <Value> with an explicit presence flag'
  );
});

test('the match explanation keys on the display name only, since ids leak the query term', () => {
  const utils = fs.readFileSync(panelUtilsPath, 'utf8');
  const fn = utils.match(/export function matchingUnlocks\(project, query\)\s*\{[\s\S]*?\n\}/);
  assert.ok(fn, 'matchingUnlocks must exist');

  // Project_CopperheadMissileBay's ID contains "Copperhead" while its display
  // name (Hydrolox High Explosive Missiles) does not. Testing the id here
  // suppressed the chip that explains why the row matched -- the panel's whole
  // reason for existing.
  assert.ok(
    !/normalise\(project\.id\)/.test(fn[0]),
    'matchingUnlocks must not treat an internal-id match as a self-evident name match'
  );
  assert.match(
    fn[0],
    /normalise\(project && project\.displayName\)\.includes\(q\)/,
    'the display name is the self-evident match'
  );
});

test('the panel searches server-side and never reimplements matching', () => {
  const utils = fs.readFileSync(panelUtilsPath, 'utf8');
  assert.match(utils, /\/api\/intel\/tech-search\?observer=/, 'typed queries must go to the tech-search endpoint');
  assert.match(utils, /\/api\/intel\/tech-tree\?observer=/, 'the default list must come from the tech-tree endpoint');
});

/**
 * Run the real panel against stubbed endpoints.
 *
 * `routes` maps an endpoint to the payload it should answer with. Returns a
 * reader for what the panel painted, plus a `type` that drives the search box.
 *
 * PORTED, NOT REWRITTEN. This used to run the vanilla IIFE inside a `vm`
 * sandbox with a fake container and a collapsed debounce. `node --test` cannot
 * render a React component out of the Vite bundle -- three earlier runs died on
 * `Minified React error #327` -- so the mount is now the real browser harness.
 * The two tests below kept every assertion and every message; only `container
 * .innerHTML` became `await mounted.html()`.
 */
async function mountUnlockedTechPanel(routes, { observer = 4712, mode = 'player' } = {}) {
  await browserHarness.startUnlockedTechHarness();
  const { page } = await browserHarness.mountUnlockedTech({
    observer,
    mode,
    routes: { tree: routes['/api/intel/tech-tree'], search: routes['/api/intel/tech-search'] },
  });
  openPages.push(page);
  return {
    html: () => browserHarness.getPanelHtml(page),
    type: (value) => browserHarness.typeQuery(page, value),
  };
}

const browserHarness = require('./fixtures/unlockedTechBrowser.js');
const openPages = [];

after(async () => {
  for (const page of openPages) await page.close().catch(() => {});
  await browserHarness.stopUnlockedTechHarness();
});

test('an unreadable project census says so, and never prints a confident 0 of 0', async () => {
  // The graph is a static parse of the game templates, so no faction_project
  // nodes is the census failing to arrive, not a faction with no research.
  // `nodes` missing entirely and `nodes` arriving empty are the same state.
  for (const [label, treePayload] of [['missing', {}], ['empty', { nodes: [] }]]) {
    const searchHit = {
      items: [{ id: 'Project_Laser', displayName: 'Basic Lasers', status: 'completed', researchCost: 100, unlocks: [] }]
    };
    const mounted = await mountUnlockedTechPanel({
      '/api/intel/tech-tree': treePayload,
      '/api/intel/tech-search': searchHit
    });

    // No query: the panel must not report the faction has completed nothing on
    // the strength of a graph it could not read.
    assert.ok(
      !/has not completed any research projects/.test(await mounted.html()),
      `nodes ${label}: an unread graph must not be reported as a faction with no research`
    );
    assert.match(
      await mounted.html(),
      /census is unavailable/,
      `nodes ${label}: the empty state must say the census could not be read`
    );

    // With rows on screen from the separate search endpoint, the footer census
    // is what lied: "0 unlocked of 0 projects" beneath a list of real projects.
    await mounted.type('laser');
    assert.match(await mounted.html(), /Basic Lasers/, `nodes ${label}: the search results must still render`);
    assert.ok(
      !/0 unlocked of 0 projects/.test(await mounted.html()),
      `nodes ${label}: an absent census must not be coerced to zero`
    );
    assert.match(
      await mounted.html(),
      /Project census unavailable\./,
      `nodes ${label}: the footer must declare the census unavailable`
    );
  }
});

test('a readable census is still reported as measured', async () => {
  const nodes = [
    { id: 'Project_A', type: 'faction_project', displayName: 'Alpha', status: 'completed', researchCost: 10, unlocks: [] },
    { id: 'Project_B', type: 'faction_project', displayName: 'Bravo', status: 'available', researchCost: 20, unlocks: [] },
    { id: 'Project_C', type: 'faction_project', displayName: 'Charlie', status: 'available', researchCost: 30, unlocks: [] },
    { id: 'tech_root', type: 'tech', displayName: 'Not a project', status: 'completed' }
  ];
  const mounted = await mountUnlockedTechPanel(
    { '/api/intel/tech-tree': { nodes } },
    { mode: 'omniscient' }
  );

  assert.match(await mounted.html(), /1 unlocked of 3 projects\./, 'a measured census must be reported as measured');
  assert.ok(
    !/census is unavailable|census unavailable/.test(await mounted.html()),
    'a readable census must not be reported as unavailable'
  );
});
