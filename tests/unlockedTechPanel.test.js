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
    await page.addStyleTag({ path: cssPath });
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

/**
 * Run the real panel against stubbed endpoints.
 *
 * `routes` maps a URL fragment to the payload that endpoint should answer with.
 * Returns the panel API plus a live view of what it painted.
 */
function mountUnlockedTechPanel(routes) {
  const js = fs.readFileSync(panelJsPath, 'utf8');
  const handlers = {};
  const input = {
    id: 'unlockedTechQuery',
    value: '',
    selectionStart: 0,
    addEventListener: (type, fn) => { handlers[type] = fn; },
    focus: () => {},
    setSelectionRange: () => {}
  };
  const container = {
    innerHTML: '',
    querySelector: sel => (sel === '#unlockedTechQuery' ? input : null),
    querySelectorAll: () => []
  };

  // The debounce is collapsed rather than waited on, and the promise `refresh`
  // returns is captured so the assertions run against a finished paint.
  let pending = null;
  const sandbox = {
    window: {},
    document: { activeElement: null },
    console,
    setTimeout: fn => { pending = fn(); return 1; },
    clearTimeout: () => {},
    fetch: url => {
      const route = Object.keys(routes).find(fragment => String(url).includes(fragment));
      if (!route) return Promise.reject(new Error(`no stub for ${url}`));
      return Promise.resolve({ ok: true, json: () => Promise.resolve(routes[route]) });
    }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(js, sandbox, { filename: panelJsPath });

  return {
    panel: sandbox.window.MissionControlUnlockedTech,
    container,
    type: async (value) => {
      input.value = value;
      handlers.input();
      await pending;
    }
  };
}

test('an unreadable project census says so, and never prints a confident 0 of 0', async () => {
  // The graph is a static parse of the game templates, so no faction_project
  // nodes is the census failing to arrive, not a faction with no research.
  // `nodes` missing entirely and `nodes` arriving empty are the same state.
  for (const [label, treePayload] of [['missing', {}], ['empty', { nodes: [] }]]) {
    const searchHit = {
      items: [{ id: 'Project_Laser', displayName: 'Basic Lasers', status: 'completed', researchCost: 100, unlocks: [] }]
    };
    const mounted = mountUnlockedTechPanel({
      '/api/intel/tech-tree': treePayload,
      '/api/intel/tech-search': searchHit
    });

    await mounted.panel.load(4712, 'player', mounted.container);

    // No query: the panel must not report the faction has completed nothing on
    // the strength of a graph it could not read.
    assert.ok(
      !/has not completed any research projects/.test(mounted.container.innerHTML),
      `nodes ${label}: an unread graph must not be reported as a faction with no research`
    );
    assert.match(
      mounted.container.innerHTML,
      /census is unavailable/,
      `nodes ${label}: the empty state must say the census could not be read`
    );

    // With rows on screen from the separate search endpoint, the footer census
    // is what lied: "0 unlocked of 0 projects" beneath a list of real projects.
    await mounted.type('laser');
    assert.match(mounted.container.innerHTML, /Basic Lasers/, `nodes ${label}: the search results must still render`);
    assert.ok(
      !/0 unlocked of 0 projects/.test(mounted.container.innerHTML),
      `nodes ${label}: an absent census must not be coerced to zero`
    );
    assert.match(
      mounted.container.innerHTML,
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
  const mounted = mountUnlockedTechPanel({ '/api/intel/tech-tree': { nodes } });

  await mounted.panel.load(4712, 'omniscient', mounted.container);

  assert.match(mounted.container.innerHTML, /1 unlocked of 3 projects\./, 'a measured census must be reported as measured');
  assert.ok(
    !/census is unavailable|census unavailable/.test(mounted.container.innerHTML),
    'a readable census must not be reported as unavailable'
  );
});
