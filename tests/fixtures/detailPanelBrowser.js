// tests/fixtures/detailPanelBrowser.js
//
// Purpose: Playwright + Express setup for the shared detail-panel React browser
//   tests, driving `window.MissionControlDetailPanel` exactly as the five
//   production callers do.
//
// ONE SESSION, NOT ONE PER TEST. The panel is a module-level singleton that
// appends `#mcDetailPanel` to `document.body` on first open, so a single page
// can be re-opened on a new option bag without re-mounting the scene.
// `closeDetailPanelHarness()` is called from an `after()` hook in the test file.
//
// `readModal` below is deliberately the SAME shape
// `scripts/verify_drive_path_modal.js` reads off the live shell, so a difference
// between the two surfaces shows up as a field-by-field diff rather than as a
// vague "the modal looks wrong".

const http = require('node:http');
const { chromium } = require('playwright');
const { ensurePrimitivesHarnessBuilt } = require('./ensurePrimitivesHarness.js');

const HARNESS_PATH = '/v2/primitives-harness.html';

/** What the scene opens on mount, so the panel is rendered before a test runs. */
const MOUNT_PAYLOAD = {
  eyebrow: 'HARNESS',
  title: 'Mounted on scene load',
  summary: 'The scene opens the shared dialog itself, so this is a real mount.',
  facts: [{ label: 'SOURCE', value: 'window.__DETAIL_PANEL_PAYLOAD__' }],
};

let session = null;

async function getDetailPanelHarnessPage() {
  if (session) return session.page;

  ensurePrimitivesHarnessBuilt();
  const app = require('../../server/index.js');
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1660, height: 950 } });
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  // The scene opens the panel from this global on mount, so the harness really
  // does render the dialog rather than an empty wrapper the tests then fill.
  await page.addInitScript((payload) => { window.__DETAIL_PANEL_PAYLOAD__ = payload; }, MOUNT_PAYLOAD);
  await page.goto(`http://127.0.0.1:${port}${HARNESS_PATH}?scene=detailPanel`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForSelector('[data-testid="detail-panel-harness"]', { timeout: 30000 });
  await page.waitForSelector('#mcDetailPanel:not([hidden])', { timeout: 30000 });

  session = { server, browser, page, port, consoleErrors };
  return page;
}

async function closeDetailPanelHarness() {
  if (!session) return;
  const { server, browser } = session;
  session = null;
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

/** Console errors seen so far. React logs its warnings through console.error. */
function consoleErrors() {
  return session ? session.consoleErrors.slice() : [];
}

/** Everything the modal is currently showing, read off the live DOM. */
const READ_MODAL = () => {
  const panel = document.getElementById('mcDetailPanel');
  if (!panel) return { present: false };
  const text = (selector) => panel.querySelector(selector)?.textContent.replace(/\s+/g, ' ').trim() || null;
  const sectionsRoot = panel.querySelector('#detailPanelSections');
  const notesRoot = panel.querySelector('#detailPanelNotes');
  return {
    present: true,
    hidden: panel.hidden,
    inert: panel.hasAttribute('inert'),
    ariaHidden: panel.getAttribute('aria-hidden'),
    bodyClassOpen: document.body.classList.contains('detail-panel-open'),
    eyebrow: text('#detailPanelEyebrow'),
    title: text('#detailPanelTitle'),
    summary: text('#detailPanelSummary'),
    sectionsHidden: sectionsRoot ? sectionsRoot.hidden : null,
    notesHidden: notesRoot ? notesRoot.hidden : null,
    facts: Array.from(panel.querySelectorAll('.detail-panel__fact')).map((node) => ({
      label: node.querySelector('dt')?.textContent.trim(),
      value: node.querySelector('dd')?.textContent.trim(),
    })),
    sections: Array.from(panel.querySelectorAll('.detail-panel__section')).map((node) => ({
      title: node.querySelector('.detail-panel__section-title')?.textContent.trim(),
      caption: node.querySelector('.detail-panel__section-caption')?.textContent.replace(/\s+/g, ' ').trim(),
      empty: node.querySelector('.detail-panel__empty')?.textContent.trim() || null,
      rows: Array.from(node.querySelectorAll('.detail-panel__row')).map((row) => ({
        label: row.querySelector('.detail-panel__row-label')?.textContent.trim(),
        sublabel: row.querySelector('.detail-panel__row-sub')?.textContent.replace(/\s+/g, ' ').trim() || null,
        status: row.querySelector('.detail-panel__status')?.textContent.trim(),
        statusClass: row.querySelector('.detail-panel__status')?.className || null,
        meta: row.querySelector('.detail-panel__row-meta')?.textContent.trim(),
      })),
    })),
    notes: Array.from(panel.querySelectorAll('.detail-panel__note')).map((node) => node.textContent.replace(/\s+/g, ' ').trim()),
    actions: Array.from(panel.querySelectorAll('#detailPanelActions button')).map((node) => ({
      label: node.textContent.trim(),
      className: node.className,
    })),
    bodyText: panel.querySelector('.detail-panel__body')?.textContent.replace(/\s+/g, ' ').trim() || '',
    activeElement: document.activeElement
      ? `${document.activeElement.tagName}${document.activeElement.id ? `#${document.activeElement.id}` : ''}`
        + `${document.activeElement.hasAttribute('data-detail-close') ? '[data-detail-close]' : ''}`
      : null,
  };
};

/** The `inert` attribute across every element syncPageInert is responsible for. */
const READ_INERT = () => ({
  topbar: document.querySelector('.init-topbar')?.hasAttribute('inert') ?? null,
  main: document.querySelector('main')?.hasAttribute('inert') ?? null,
  views: Array.from(document.querySelectorAll('.init-view')).map((section) => ({
    id: section.id,
    hidden: section.hidden,
    inert: section.hasAttribute('inert'),
  })),
});

async function readModal(page) {
  return page.evaluate(READ_MODAL);
}

async function readInert(page) {
  return page.evaluate(READ_INERT);
}

/** Opens the shared panel on `options` and reads back what it rendered. */
async function openPanel(page, options) {
  return page.evaluate((opts) => {
    window.MissionControlDetailPanel.open(opts);
  }, options);
}

async function closePanel(page) {
  return page.evaluate(() => { window.MissionControlDetailPanel.close(); });
}

/** Drops the shell entirely, so the next scenario starts from first-open. */
async function resetPanel(page) {
  return page.evaluate(() => { window.MissionControlDetailPanel._internals.reset(); });
}

/** Shows or hides one of the two sibling overlays and re-runs the inert sweep. */
async function setSiblingOverlay(page, id, open) {
  return page.evaluate((args) => {
    const el = document.getElementById(args.id);
    if (!el) throw new Error(`sibling overlay #${args.id} is not in the scene`);
    el.hidden = !args.open;
    window.MissionControlDetailPanel.syncPageInert();
  }, { id, open });
}

module.exports = {
  getDetailPanelHarnessPage,
  closeDetailPanelHarness,
  consoleErrors,
  readModal,
  readInert,
  openPanel,
  closePanel,
  resetPanel,
  setSiblingOverlay,
  HARNESS_PATH,
};
