// tests/fixtures/unlockedTechBrowser.js
//
// Purpose: Playwright + Express setup for unlocked-technology browser tests —
//   owns the server/browser lifecycle, the stubbed /api/intel/tech-tree and
//   /api/intel/tech-search routes, the settle helpers, and the graph builders
//   shared by every scenario.
//
// WHY THE ENDPOINTS ARE STUBBED RATHER THAN READ FROM A FIXTURE SNAPSHOT
// ---------------------------------------------------------------------
// docs/react-component-contracts-detail.md records (measured 2026-08-24) that
// `queryFixtureIntel({ endpoint: 'tech-tree' })` returns `nodes: []` in BOTH
// modes, because tests/fixtures/snapshot-*-intel.json carry no `techTree`. A
// characterisation test driven off the committed fixtures would therefore
// exercise exactly one of the panel's eight states — the unreadable-census one —
// and silently pass over the other seven. The graphs below are synthetic and
// named so each scenario states which state it is proving.
//
// DRIVER
// ------
// `mountUnlockedTech` is the ONLY implementation-aware function in this file.
// It drove the vanilla IIFE at public/v2/js/components/unlocked-tech.js while
// the characterisation was captured, and now drives the React panel through the
// primitives harness. Every assertion in tests/unlockedTechRendering.test.js was
// written and confirmed green against the vanilla driver BEFORE the port, and
// none of them changed when the driver was repointed.

const http = require('node:http');
const { chromium } = require('playwright');
const { ensurePrimitivesHarnessBuilt } = require('./ensurePrimitivesHarness.js');
const { visibleText } = require('./renderHarness.js');

const HARNESS_PATH = '/v2/primitives-harness.html';
const PANEL_SELECTOR = '#unlockedTech';

/* ------------------------------------------------------------------ *
 * Graph builders
 * ------------------------------------------------------------------ */

/** A tech-tree node. `type` defaults to faction_project — the only type read. */
function project(overrides = {}) {
  return {
    type: 'faction_project',
    id: 'Project_Unnamed',
    displayName: 'Unnamed',
    status: 'completed',
    researchCost: 100,
    unlocks: [],
    ...overrides,
  };
}

function unlock(id, displayName) {
  return { id, displayName };
}

/** `count` completed projects named Bulk 001 … Bulk NNN, for cap scenarios. */
function bulkProjects(count, prefix = 'Bulk') {
  return Array.from({ length: count }, (_, i) => project({
    id: `Project_${prefix}${String(i + 1).padStart(3, '0')}`,
    displayName: `${prefix} ${String(i + 1).padStart(3, '0')}`,
    researchCost: 10 + i,
  }));
}

/* ------------------------------------------------------------------ *
 * Server + browser lifecycle
 * ------------------------------------------------------------------ */

let server = null;
let browser = null;
let baseUrl = null;

async function startUnlockedTechHarness() {
  if (browser && server) return; // idempotent: two test files share this module
  ensurePrimitivesHarnessBuilt();
  const app = require('../../server/index.js');
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
}

async function stopUnlockedTechHarness() {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  browser = null;
  server = null;
  baseUrl = null;
}

/* ------------------------------------------------------------------ *
 * Route stubbing
 * ------------------------------------------------------------------ */

/**
 * Install the two endpoint stubs on a page.
 *
 * `routes.tree` / `routes.search` each accept either a payload object (answered
 * 200) or `{ status, body, delayMs, error }`. An endpoint with no stub answers
 * 500 with an explicit body, so "the panel called something we did not model"
 * shows up as an error state rather than as a silent hang.
 *
 * Returns the recorded request URLs, live.
 */
async function installRoutes(page, routes = {}) {
  const calls = { tree: [], search: [] };

  const answer = async (route, spec, kind, url) => {
    calls[kind].push(url);
    if (!spec) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: `no stub for ${kind}` }),
      });
      return;
    }
    const resolved = typeof spec === 'function' ? spec(url) : spec;
    const status = resolved && typeof resolved.status === 'number' ? resolved.status : 200;
    const body = resolved && Object.prototype.hasOwnProperty.call(resolved, 'body')
      ? resolved.body
      : resolved;
    if (resolved && resolved.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, resolved.delayMs));
    }
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  };

  await page.route('**/api/intel/tech-tree*', (route) => answer(
    route, routes.tree, 'tree', route.request().url(),
  ));
  await page.route('**/api/intel/tech-search*', (route) => answer(
    route, routes.search, 'search', route.request().url(),
  ));

  return calls;
}

/* ------------------------------------------------------------------ *
 * Driver — the one implementation-aware function
 * ------------------------------------------------------------------ */

/**
 * Open a page with the panel mounted and its endpoints stubbed.
 *
 * @param {object} options
 * @param {object} [options.routes]   tree/search stubs, see installRoutes
 * @param {number} [options.observer] observer faction id (default 4712)
 * @param {string} [options.mode]     'player' | 'omniscient'
 * @param {boolean} [options.settle]  await the first paint (default true)
 */
async function mountUnlockedTech(options = {}) {
  const {
    routes = {},
    observer = 4712,
    mode = 'player',
    settle = true,
  } = options;

  const page = await browser.newPage();
  const calls = await installRoutes(page, routes);

  await page.addInitScript((config) => {
    window.__UNLOCKED_TECH_CONFIG__ = config;
  }, { observerId: observer, mode });

  // vite.config.mjs sets emptyOutDir on public/v2/app, which the primitives
  // harness also writes to, so a CONCURRENT `npm run build` deletes
  // primitives-harness.js mid-run. Measured 2026-08-26: the file was absent for
  // ~4 seconds during one of these runs. The page then mounts nothing and the
  // waits below time out with the exact signature of a broken scene. Recording
  // the bundle's status turns that into a diagnosis instead of a mystery.
  let harnessStatus = null;
  page.on('response', (response) => {
    if (response.url().endsWith('/v2/app/primitives-harness.js')) harnessStatus = response.status();
  });

  await page.goto(`${baseUrl}${HARNESS_PATH}?scene=unlockedTech`, {
    waitUntil: 'domcontentloaded',
  });
  try {
    await page.waitForSelector('[data-testid="unlocked-tech-harness"]', { timeout: 15000 });
    await page.waitForSelector(PANEL_SELECTOR, { timeout: 15000 });
  } catch (err) {
    if (harnessStatus !== 200) {
      throw new Error(
        `the primitives harness bundle answered ${harnessStatus === null ? 'nothing' : harnessStatus}, `
        + 'so no scene could mount. A concurrent `npm run build` empties public/v2/app; '
        + 'rebuild with `npx vite build --config vite.primitives.config.mjs` and re-run '
        + 'before looking at the scene.',
      );
    }
    throw err;
  }

  if (settle) await waitForStable(page);
  return { page, calls };
}

/* ------------------------------------------------------------------ *
 * Settle + read helpers — implementation-agnostic
 * ------------------------------------------------------------------ */

/**
 * Wait until the panel's markup stops changing.
 *
 * Deliberately not "wait for network idle" and not a fixed sleep: the panel
 * debounces keystrokes for 220ms and only then fires a request, so an idle
 * check can return during the debounce window — before the request that the
 * assertion is about has even been made.
 */
async function waitForStable(page, { quietMs = 320, timeoutMs = 15000 } = {}) {
  const started = Date.now();
  let last = null;
  let lastChangedAt = Date.now();
  for (;;) {
    const html = await getPanelHtml(page);
    if (html !== last) {
      last = html;
      lastChangedAt = Date.now();
    } else if (Date.now() - lastChangedAt >= quietMs) {
      return html;
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`unlocked-tech panel never settled within ${timeoutMs}ms`);
    }
    await page.waitForTimeout(40);
  }
}

async function getPanelHtml(page) {
  return page.evaluate((selector) => {
    const el = document.querySelector(selector);
    return el ? el.innerHTML : '';
  }, PANEL_SELECTOR);
}

async function getPanelText(page) {
  return visibleText(await getPanelHtml(page));
}

/** Type into the search box the way a reader does, then wait for the result. */
async function typeQuery(page, value) {
  await page.fill('#unlockedTechQuery', value);
  await waitForStable(page);
}

/** Click a scope button (`unlocked` | `all`), then wait for the result. */
async function clickScope(page, scope) {
  await page.click(`.ut-scope-btn[data-scope="${scope}"]`);
  await waitForStable(page);
}

/** The visible text of every rendered row, in render order. */
async function getRowTexts(page) {
  const rows = await page.evaluate(() => Array.from(
    document.querySelectorAll('#unlockedTech .ut-row'),
  ).map((el) => el.innerHTML));
  return rows.map(visibleText);
}

/** The visible text of the footer, or null when no footer is rendered. */
async function getFooterText(page) {
  const html = await page.evaluate(() => {
    const el = document.querySelector('#unlockedTech .ut-footer');
    return el ? el.innerHTML : null;
  });
  return html === null ? null : visibleText(html);
}

module.exports = {
  HARNESS_PATH,
  PANEL_SELECTOR,
  bulkProjects,
  clickScope,
  getFooterText,
  getPanelHtml,
  getPanelText,
  getRowTexts,
  mountUnlockedTech,
  project,
  startUnlockedTechHarness,
  stopUnlockedTechHarness,
  typeQuery,
  unlock,
  visibleText,
  waitForStable,
};
