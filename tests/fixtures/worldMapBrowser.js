// tests/fixtures/worldMapBrowser.js
//
// Purpose: Playwright + Express setup for the WorldMap React panel, exposing a
//   SYNCHRONOUS DOM facade so tests/world-map.test.js keeps its assertions.
//
// ---------------------------------------------------------------------------
// WHY A FACADE RATHER THAN page.evaluate EVERYWHERE
// ---------------------------------------------------------------------------
// The 16 characterisation assertions this fixture serves were written against a
// mock DOM: `container.querySelector('.world-map-heading').getAttribute(...)`,
// `regionLabels.length`, `countryPaths.find(p => p.getAttribute('data-country'))`.
// Rewriting each of those into an awaited `page.evaluate` would have rewritten
// the assertions, which is precisely what the migration protocol forbids.
//
// So the panel is rendered in a REAL browser, its HTML is read back, and that
// HTML is re-parsed with the repo's own mock DOM (tests/fixtures/mockDom.js).
// Every read — querySelector, querySelectorAll, getAttribute — stays synchronous
// and unchanged. Only the three INTERACTIONS became awaited, because no
// synchronous Node API can drive a live page:
//
//     samRegion.click()                    ->  await samRegion.click()
//     eurRegion.dispatchEvent({ ... })     ->  await eurRegion.dispatchEvent({ ... })
//
// Nodes handed out are LIVE: they re-resolve against the newest capture, so a
// reference taken before an interaction reports the state after it, exactly as a
// real DOM node would.
//
// `onSelect` cannot cross the Playwright boundary as a function. The harness
// scene installs its own recorder on `window.__WORLD_MAP_SELECTIONS__`; every
// refresh drains that list and calls the test's Node-side callback with each
// record. `options.selectedTheater` is the one option that cannot survive the
// boundary meaningfully — the page gets a structural copy, so the vanilla panel's
// `record === selectedTheater` identity match cannot be exercised from here. No
// test uses it.

'use strict';

const http = require('node:http');
const { chromium } = require('playwright');
const { ensurePrimitivesHarnessBuilt } = require('./ensurePrimitivesHarness.js');
const { visibleText } = require('./renderHarness');
const { createMockEnvironment } = require('./mockDom');

const HARNESS_PATH = '/v2/primitives-harness.html';
const HARNESS_SELECTOR = '[data-testid="world-map-harness"]';

/** Chromium holds every open page's bundle in memory; the suite opens ~20. */
const MAX_OPEN_PAGES = 3;

let server = null;
let browser = null;
let baseUrl = null;
const openPages = [];

async function startWorldMapHarness() {
  if (browser) return baseUrl;
  ensurePrimitivesHarnessBuilt();
  const app = require('../../server/index.js');
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  return baseUrl;
}

async function stopWorldMapHarness() {
  while (openPages.length) {
    const page = openPages.pop();
    await page.close().catch(() => {});
  }
  if (browser) { await browser.close().catch(() => {}); browser = null; }
  if (server) { await new Promise((resolve) => server.close(resolve)); server = null; }
  baseUrl = null;
}

/** Options minus anything that cannot be structured-cloned into the page. */
function serializableOptions(options) {
  const out = {};
  Object.keys(options || {}).forEach((key) => {
    if (typeof options[key] === 'function') return;
    out[key] = options[key];
  });
  return out;
}

class LiveNode {
  constructor(handle, selector, index) {
    this.handle = handle;
    this.selector = selector;
    this.index = index;
  }

  get node() {
    const matches = this.handle.matchAll(this.selector);
    return matches[this.index] || null;
  }

  getAttribute(name) {
    const node = this.node;
    return node ? node.getAttribute(name) : null;
  }

  get textContent() {
    const node = this.node;
    return node ? node.textContent : '';
  }

  async click() {
    await this.handle.interact(this.selector, this.index, { type: 'click' });
  }

  async dispatchEvent(event) {
    const spec = typeof event === 'string' ? { type: event } : (event || {});
    await this.handle.interact(this.selector, this.index, spec);
  }
}

/**
 * Performs one interaction inside the page.
 *
 * Events are dispatched rather than clicked at a coordinate: the six theater
 * groups overlap in the viewBox and a hit test would be deciding which region a
 * test meant. React listens for BUBBLED events at its root container, so a
 * bubbling event dispatched on the group reaches the same handler a real click
 * would. `mouseenter`/`mouseleave` are translated to `mouseover`/`mouseout`,
 * and `focus`/`blur` to `focusin`/`focusout`, because that is the pair React's
 * delegation actually derives its enter/leave and focus handlers from — a raw
 * `mouseenter` would reach nothing and the test would pass over a dead panel.
 */
async function dispatchInPage(page, selector, index, spec) {
  await page.evaluate(({ harnessSelector, sel, idx, event }) => {
    const scope = document.querySelector(harnessSelector);
    const target = scope ? scope.querySelectorAll(sel)[idx] : null;
    if (!target) throw new Error(`world-map harness: no node for ${sel}[${idx}]`);

    const type = String(event.type || '').toLowerCase();
    if (type === 'click') {
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return;
    }
    if (type === 'keydown' || type === 'keyup' || type === 'keypress') {
      target.dispatchEvent(new KeyboardEvent(type, {
        key: event.key,
        bubbles: true,
        cancelable: true,
      }));
      return;
    }
    if (type === 'mouseenter' || type === 'mouseover') {
      target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: null }));
      return;
    }
    if (type === 'mouseleave' || type === 'mouseout') {
      target.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
      return;
    }
    if (type === 'focus' || type === 'focusin') {
      if (typeof target.focus === 'function') target.focus();
      target.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      return;
    }
    if (type === 'blur' || type === 'focusout') {
      if (typeof target.blur === 'function') target.blur();
      target.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      return;
    }
    target.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
  }, { harnessSelector: HARNESS_SELECTOR, sel: selector, idx: index, event: spec });

  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

async function openWorldMap(theaters, options = {}, harnessOpts = {}) {
  await startWorldMapHarness();

  while (openPages.length >= MAX_OPEN_PAGES) {
    const stale = openPages.shift();
    await stale.close().catch(() => {});
  }

  const page = await browser.newPage();
  openPages.push(page);

  if (harnessOpts.fetchError) {
    const message = harnessOpts.fetchError.message || String(harnessOpts.fetchError);
    await page.addInitScript((errorMessage) => {
      const original = window.fetch.bind(window);
      window.fetch = (input, ...rest) => {
        if (String(input).includes('world.geojson')) return Promise.reject(new Error(errorMessage));
        return original(input, ...rest);
      };
    }, message);
  }

  await page.addInitScript((payload) => {
    window.__WORLD_MAP_PAYLOAD__ = payload;
    window.__WORLD_MAP_SELECTIONS__ = [];
  }, { theaters, options: serializableOptions(options) });

  await page.goto(`${baseUrl}${HARNESS_PATH}?scene=worldMap`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(HARNESS_SELECTOR, { timeout: 20000 });
  await page.waitForSelector(
    `${HARNESS_SELECTOR} .world-map[data-map-state="ready"], ${HARNESS_SELECTOR} .world-map[data-map-state="error"]`,
    { timeout: 20000 },
  );

  const { document: mockDocument } = createMockEnvironment();
  const onSelect = typeof options.onSelect === 'function' ? options.onSelect : null;

  const handle = {
    page,
    html: '',
    text: '',
    selectionCursor: 0,
    _parsed: null,
    _matchCache: new Map(),

    matchAll(selector) {
      if (!this._matchCache.has(selector)) {
        this._matchCache.set(selector, this._parsed.querySelectorAll(selector));
      }
      return this._matchCache.get(selector);
    },

    async refresh() {
      const captured = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        return {
          html: el ? el.innerHTML : '',
          selections: window.__WORLD_MAP_SELECTIONS__ || [],
        };
      }, HARNESS_SELECTOR);

      this.html = captured.html;
      this.text = visibleText(captured.html);
      const parsed = mockDocument.createElement('div');
      parsed.innerHTML = captured.html;
      this._parsed = parsed;
      this._matchCache = new Map();

      const fresh = captured.selections.slice(this.selectionCursor);
      this.selectionCursor = captured.selections.length;
      if (onSelect) fresh.forEach((record) => onSelect(record));
    },

    async interact(selector, index, spec) {
      await dispatchInPage(page, selector, index, spec);
      await this.refresh();
    },
  };

  await handle.refresh();

  const container = {
    querySelector(selector) {
      return handle.matchAll(selector).length ? new LiveNode(handle, selector, 0) : null;
    },
    querySelectorAll(selector) {
      return handle.matchAll(selector).map((_, index) => new LiveNode(handle, selector, index));
    },
  };

  return {
    container,
    root: container.querySelector('.world-map'),
    get html() { return handle.html; },
    get text() { return handle.text; },
    page,
    handle,
  };
}

module.exports = {
  startWorldMapHarness,
  stopWorldMapHarness,
  openWorldMap,
  visibleText,
  HARNESS_PATH,
  HARNESS_SELECTOR,
};
