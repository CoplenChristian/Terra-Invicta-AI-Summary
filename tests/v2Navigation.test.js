/**
 * Automated tests for v2 Dashboard Grouped View Navigation.
 * Pins:
 *  1. Single source of truth VIEWS registry and startup integrity assertion.
 *  2. HTML structure: 4 named view sections, topbar nav buttons, and zero <details class="init-records">.
 *  3. Inactive views maintain hidden and inert attributes.
 *  4. DetailPanel syncPageInert() correctly handles .init-view sections and topbar.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');
const v2IndexHtmlPath = path.join(repoRoot, 'public', 'v2', 'index.html');
const missionControlJsPath = path.join(repoRoot, 'public', 'v2', 'js', 'mission-control.js');
const detailPanelJsPath = path.join(repoRoot, 'public', 'v2', 'js', 'components', 'detail-panel.js');

test('public/v2/index.html defines 4 view sections and topbar navigation without init-records accordion', () => {
  const html = fs.readFileSync(v2IndexHtmlPath, 'utf8');

  // No old accordion
  assert.ok(!html.includes('init-records'), 'public/v2/index.html must not contain old .init-records accordion');

  // Nav buttons
  assert.ok(html.includes('class="init-view-nav"'), 'public/v2/index.html must contain .init-view-nav');
  assert.ok(html.includes('data-view="command"'), 'navigation must include command view button');
  assert.ok(html.includes('data-view="expansion"'), 'navigation must include expansion view button');
  assert.ok(html.includes('data-view="threat"'), 'navigation must include threat view button');
  assert.ok(html.includes('data-view="records"'), 'navigation must include records view button');

  // 4 View sections
  assert.ok(html.includes('id="view-command"'), 'must contain #view-command');
  assert.ok(html.includes('id="view-expansion"'), 'must contain #view-expansion');
  assert.ok(html.includes('id="view-threat"'), 'must contain #view-threat');
  assert.ok(html.includes('id="view-records"'), 'must contain #view-records');

  // Initial inactive view attributes
  assert.ok(/id="view-expansion"\s+hidden\s+inert\s+aria-hidden="true"/.test(html), '#view-expansion must be initially hidden and inert');
  assert.ok(/id="view-threat"\s+hidden\s+inert\s+aria-hidden="true"/.test(html), '#view-threat must be initially hidden and inert');
  assert.ok(/id="view-records"\s+hidden\s+inert\s+aria-hidden="true"/.test(html), '#view-records must be initially hidden and inert');
});

test('VIEWS registry in mission-control.js defines exactly the 4 required views and passes integrity assertion', () => {
  const html = fs.readFileSync(v2IndexHtmlPath, 'utf8');
  const js = fs.readFileSync(missionControlJsPath, 'utf8');

  // Parse DOM elements from index.html
  const idToSection = new Map();
  const sectionIds = ['view-command', 'view-expansion', 'view-threat', 'view-records'];

  for (const sId of sectionIds) {
    const sectionMatch = html.match(new RegExp(`<section[^>]*id="${sId}"[\\s\\S]*?<\\/section>`));
    assert.ok(sectionMatch, `Section #${sId} must exist in index.html`);
    const sectionContent = sectionMatch[0];

    const elementIds = [...sectionContent.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
    for (const elId of elementIds) {
      idToSection.set(elId, sId);
    }
  }

  // Load MissionControlViews from mission-control.js
  const fakeDoc = {
    getElementById: (id) => {
      if (idToSection.has(id) || sectionIds.includes(id)) {
        const ownerSection = idToSection.get(id) || id;
        return {
          id,
          hidden: false,
          contains: (child) => {
            if (!child) return false;
            return idToSection.get(child.id) === id;
          }
        };
      }
      return null;
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    createElement: () => ({ id: '', className: '', setAttribute: () => {}, prepend: () => {} })
  };

  const sandbox = {
    window: {},
    document: fakeDoc,
    console,
    location: { hash: '#/command' },
    addEventListener: () => {},
    MissionControlShared: null,
    fetch: () => Promise.resolve({ json: () => Promise.resolve({}) })
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(js, sandbox, { filename: missionControlJsPath });

  const { VIEWS, assertViewRegistryIntegrity } = sandbox.window.MissionControlViews || {};
  assert.ok(Array.isArray(VIEWS), 'VIEWS must be exported as an array');
  assert.strictEqual(VIEWS.length, 4, 'VIEWS must contain exactly 4 views');

  const viewIds = [...VIEWS.map(v => v.id)];
  assert.deepStrictEqual(viewIds, ['command', 'expansion', 'threat', 'records']);

  // Assert integrity with valid DOM
  assert.doesNotThrow(() => {
    assertViewRegistryIntegrity();
  }, 'assertViewRegistryIntegrity must pass when all registered panels exist in their sections');

  // Verify that missing panel or mismatch throws loudly
  const brokenDoc = {
    ...fakeDoc,
    getElementById: (id) => {
      if (id === 'miningExpansion') return null; // simulate missing mining board
      return fakeDoc.getElementById(id);
    }
  };
  const brokenSandbox = { ...sandbox, document: brokenDoc };
  vm.createContext(brokenSandbox);
  vm.runInContext(js, brokenSandbox, { filename: missionControlJsPath });

  assert.throws(() => {
    brokenSandbox.window.MissionControlViews.assertViewRegistryIntegrity();
  }, /VIEW REGISTRY INTEGRITY ERROR/, 'assertViewRegistryIntegrity must throw loudly when a panel is missing');
});

test('detail-panel syncPageInert manages inert across topbar and all .init-view sections', () => {
  const js = fs.readFileSync(detailPanelJsPath, 'utf8');

  let topbarInert = false;
  let mainInert = false;
  const sections = [
    { id: 'view-command', hidden: false, inert: false },
    { id: 'view-expansion', hidden: true, inert: true },
    { id: 'view-threat', hidden: true, inert: true },
    { id: 'view-records', hidden: true, inert: true }
  ];

  let activeOverlay = null;

  const fakeDoc = {
    querySelector: (sel) => {
      if (sel.includes(':not([hidden])')) {
        return activeOverlay;
      }
      if (sel === '.init-topbar') {
        return {
          toggleAttribute: (attr, val) => {
            if (attr === 'inert') topbarInert = Boolean(val);
          }
        };
      }
      if (sel === 'main') {
        return {
          removeAttribute: (attr) => {
            if (attr === 'inert') mainInert = false;
          },
          toggleAttribute: (attr, val) => {
            if (attr === 'inert') mainInert = Boolean(val);
          }
        };
      }
      return null;
    },
    querySelectorAll: (sel) => {
      if (sel === '.init-view') {
        return sections.map(s => ({
          id: s.id,
          hidden: s.hidden,
          setAttribute: (attr, val) => {
            if (attr === 'inert') s.inert = true;
          },
          toggleAttribute: (attr, val) => {
            if (attr === 'inert') s.inert = Boolean(val);
          }
        }));
      }
      return [];
    }
  };

  const sandbox = { window: {}, document: fakeDoc, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(js, sandbox, { filename: detailPanelJsPath });

  const { syncPageInert } = sandbox.window.MissionControlDetailPanel;
  assert.ok(typeof syncPageInert === 'function');

  // Initial state: no overlay
  syncPageInert();
  assert.strictEqual(topbarInert, false, 'Topbar must not be inert when overlay is closed');
  assert.strictEqual(sections[0].inert, false, 'Active view (command) must not be inert');
  assert.strictEqual(sections[1].inert, true, 'Inactive view (expansion) must remain inert');

  // Overlay opened
  activeOverlay = { id: 'mcDetailPanel' };
  syncPageInert();
  assert.strictEqual(topbarInert, true, 'Topbar must become inert when overlay is open');
  assert.strictEqual(sections[0].inert, true, 'Active view must become inert when overlay is open');
  assert.strictEqual(sections[1].inert, true, 'Inactive view must remain inert when overlay is open');

  // Overlay closed
  activeOverlay = null;
  syncPageInert();
  assert.strictEqual(topbarInert, false, 'Topbar must have inert removed when overlay closes');
  assert.strictEqual(sections[0].inert, false, 'Active view must have inert removed when overlay closes');
  assert.strictEqual(sections[1].inert, true, 'Inactive view must remain inert');
});
