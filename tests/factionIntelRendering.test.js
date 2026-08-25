//
// Purpose: characterization coverage for public/v2/js/components/faction-intel.js.
// The dossier is an overlay fed when opened; these tests pin its visible
// records, mode-specific redaction, controller selection, and close cleanup
// before the React migration.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { runComponent, visibleText } = require('./fixtures/renderHarness');
const { loadFixtureFilteredSnapshot } = require('./fixtures/frozenSnapshots');
const { DOMNode, createMockEnvironment, serializeNode } = require('./fixtures/mockDom');

const repoRoot = path.resolve(__dirname, '..');
const componentPath = path.join(repoRoot, 'public', 'v2', 'js', 'components', 'faction-intel.js');
const shellPath = path.join(repoRoot, 'public', 'v2', 'index.html');

// FactionIntelScreen uses a few native DOM conveniences that are not needed by
// the older SVG tests. Keep the additions local to this characterization file;
// renderHarness still supplies the shipped shared.js implementation.
function installComponentDomProperties() {
  if (!Object.prototype.hasOwnProperty.call(DOMNode.prototype, 'childNodes')) {
    Object.defineProperty(DOMNode.prototype, 'childNodes', {
      configurable: true,
      get() { return this.children; }
    });
  }

  if (!Object.prototype.hasOwnProperty.call(DOMNode.prototype, 'nodeType')) {
    Object.defineProperty(DOMNode.prototype, 'nodeType', {
      configurable: true,
      get() { return this.tagName === '#TEXT' ? 3 : 1; }
    });
  }

  if (!Object.prototype.hasOwnProperty.call(DOMNode.prototype, 'classList')) {
    Object.defineProperty(DOMNode.prototype, 'classList', {
      configurable: true,
      get() {
        const node = this;
        const getClasses = () => new Set((node.getAttribute('class') || '').split(/\s+/).filter(Boolean));
        const save = classes => node.setAttribute('class', [...classes].join(' '));
        return {
          contains(className) { return getClasses().has(className); },
          add(...classNames) {
            const classes = getClasses();
            classNames.forEach(className => classes.add(className));
            save(classes);
          },
          remove(...classNames) {
            const classes = getClasses();
            classNames.forEach(className => classes.delete(className));
            save(classes);
          },
          toggle(className, force) {
            const classes = getClasses();
            const shouldHave = force === undefined ? !classes.has(className) : Boolean(force);
            if (shouldHave) classes.add(className); else classes.delete(className);
            save(classes);
            return shouldHave;
          }
        };
      }
    });
  }

  const styleDescriptor = Object.getOwnPropertyDescriptor(DOMNode.prototype, 'style');
  if (styleDescriptor && !styleDescriptor.get.__factionIntelPatched) {
    const getStyle = styleDescriptor.get;
    const patchedGetStyle = function patchedStyle() {
      const base = getStyle.call(this);
      const node = this;
      return new Proxy({
        setProperty(name, value) {
          base[name] = value;
        },
        removeProperty(name) {
          delete node._style[name];
        }
      }, {
        get(target, property) {
          if (property in target) return target[property];
          return base[property];
        },
        set(target, property, value) {
          base[property] = value;
          return true;
        }
      });
    };
    Object.defineProperty(patchedGetStyle, '__factionIntelPatched', { value: true });
    Object.defineProperty(DOMNode.prototype, 'style', { ...styleDescriptor, get: patchedGetStyle });
  }
}

installComponentDomProperties();

function firstObservedEnemy(snapshot) {
  return snapshot.councilors.find(councilor =>
    String(councilor.factionId) !== '4712'
      && councilor.maskedAttributes
      && !councilor.attributes
      && String(councilor.status || 'Active').toLowerCase() === 'active'
  );
}

function firstAlien(snapshot) {
  return snapshot.councilors.find(councilor => councilor.isAlien
    && String(councilor.status || 'Active').toLowerCase() === 'active');
}

function expectedMaskedTopSkill(councilor) {
  const abbreviations = {
    Administration: 'ADM',
    Persuasion: 'PER',
    Investigation: 'INV',
    Espionage: 'ESP',
    Command: 'CMD',
    Science: 'SCI',
    Security: 'SEC',
    Loyalty: 'LOY'
  };
  const entries = Object.entries(councilor.maskedAttributes)
    .map(([key, field]) => [key, field && field.visible])
    .filter(([, value]) => Number.isFinite(Number(value)));
  entries.sort((left, right) => Number(right[1]) - Number(left[1]));
  const [key, value] = entries[0];
  return `SKILL / ${abbreviations[key] || key.slice(0, 3).toUpperCase()} ${value}`;
}

function renderFaction(snapshot, observerId = 4712) {
  const fetchCalls = [];
  const fetchStub = (url, options) => {
    fetchCalls.push({ url, options });
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: snapshot })
    });
  };
  const { document, window } = createMockEnvironment({ fetch: fetchStub });
  document.createTextNode = text => {
    const node = document.createElement('#text');
    node.textContent = text;
    return node;
  };
  const sandbox = runComponent(componentPath, { document, window, fetch: fetchStub });
  const root = document.createElement('div');
  const controller = sandbox.window.FactionIntelScreen.render(root, snapshot, null, observerId);
  const html = serializeNode(root);
  return { controller, document, fetchCalls, html, root, text: visibleText(html) };
}

// ---------------------------------------------------------------------------
// Normal render: both modes, including the open-time fetch seam.
// ---------------------------------------------------------------------------

test('faction dossier renders the normal player snapshot without reaching the network', () => {
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'player' });
  const rendered = renderFaction(snapshot);

  assert.strictEqual(rendered.fetchCalls.length, 0, 'the open-time fetch seam must be stubbed, never sent to the network by the unit test');
  assert.ok(rendered.text.includes('Faction intelligence'));
  assert.ok(rendered.text.includes('PLAYER INTEL'));
  assert.ok(rendered.text.includes('the Initiative'));
  assert.ok(rendered.text.includes('Faction roster'));
  assert.ok(rendered.text.includes('Earth footprint'));
  assert.ok(rendered.text.includes('Space posture'));
  assert.ok(rendered.text.includes('Research posture'));
  assert.ok(rendered.text.includes('Councilor roster'));
  assert.ok(rendered.text.includes('Plan of action'));
  assert.strictEqual(rendered.controller.getSelectedId(), 4712);
});

test('faction dossier renders the omniscient snapshot and an alien faction selection', () => {
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'omniscient' });
  const alien = firstAlien(snapshot);
  assert.ok(alien, 'the frozen omniscient fixture must contain an alien councilor');

  const rendered = renderFaction(snapshot);
  assert.ok(rendered.controller.select(4717));
  const text = visibleText(serializeNode(rendered.root));

  assert.ok(text.includes('OMNISCIENT'));
  assert.ok(text.includes('the Aliens'));
  assert.ok(text.includes(alien.displayName));
  assert.ok(text.includes('ALIEN HATE'));
  assert.ok(text.includes('RAW SAVE ONLY'));
  assert.strictEqual(rendered.controller.getSelectedId(), 4717);
});

// ---------------------------------------------------------------------------
// Player redaction: maskedAttributes is the visible source for rivals.
// ---------------------------------------------------------------------------

test('faction dossier keeps an observed enemy councilor in player mode', () => {
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'player' });
  const target = firstObservedEnemy(snapshot);
  assert.ok(target, 'the frozen player fixture must contain an observed enemy');
  assert.equal(target.attributes, undefined, 'the raw enemy attributes must be absent in player mode');

  const rendered = renderFaction(snapshot);
  assert.ok(rendered.controller.select(target.factionId));
  const text = visibleText(serializeNode(rendered.root));

  assert.ok(text.includes(target.displayName), 'an attributes-only filter would silently drop this player-visible councilor');
  assert.ok(text.includes(expectedMaskedTopSkill(target)), 'the dossier must read the visible skill from maskedAttributes');
});

// ---------------------------------------------------------------------------
// Every unavailable representation used by the dossier.
// ---------------------------------------------------------------------------

function sparseSnapshot() {
  return {
    mode: 'player',
    observerFactionId: 4712,
    factions: [{ ID: 9001, displayName: 'Sparse faction', color: '#777777' }],
    councilors: []
  };
}

test('faction dossier renders UNAVAILABLE when faction metrics are not measured', () => {
  const rendered = renderFaction(sparseSnapshot());
  assert.ok(rendered.text.includes('UNAVAILABLE'), 'missing hate, power, Earth, space, and research metrics must remain UNAVAILABLE');
});

test('faction dossier renders UNKNOWN for an unmeasured relationship', () => {
  const rendered = renderFaction(sparseSnapshot());
  assert.ok(rendered.text.includes('UNKNOWN'), 'an absent observer-relative relationship must remain UNKNOWN');
});

test('faction dossier preserves an explicit em dash visibility marker', () => {
  const snapshot = sparseSnapshot();
  snapshot.factions[0].earthVisibility = '—';
  const rendered = renderFaction(snapshot);
  assert.ok(rendered.text.includes('EARTH —'), 'an explicitly unmeasured visibility marker must remain an em dash');
});

test('faction dossier empty and absent inputs remain distinct', () => {
  const empty = renderFaction({ mode: 'player', factions: [], councilors: [] });
  assert.ok(empty.text.includes('No selectable factions were supplied.'));
  assert.ok(empty.text.includes('0 entries'));

  const absent = renderFaction(undefined);
  assert.ok(absent.text.includes('No faction data is present in the current snapshot.'));
  assert.ok(absent.text.includes('No selectable factions were supplied.'));
});

// ---------------------------------------------------------------------------
// Selection, open/close mount contract, and no silent list loss.
// ---------------------------------------------------------------------------

test('faction selection emits the selected record and destroy closes the overlay mount', () => {
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'omniscient' });
  const selected = [];
  const rendered = renderFaction(snapshot);
  rendered.root.onFactionIntelSelect = detail => selected.push(detail);

  assert.ok(rendered.controller.select(4717));
  assert.strictEqual(selected.length, 1);
  assert.strictEqual(selected[0].factionId, 4717);
  assert.strictEqual(selected[0].observerId, 4712);
  assert.strictEqual(rendered.controller.getSelectedId(), 4717);

  rendered.controller.destroy();
  assert.strictEqual(rendered.root.children.length, 0, 'destroy must remove the dossier shell from the overlay mount');
  rendered.controller.destroy();
  assert.strictEqual(rendered.root.children.length, 0, 'destroy must be idempotent');
});

test('faction dossier overlay has open mount and close controls in the shipped shell', () => {
  const shell = fs.readFileSync(shellPath, 'utf8');
  assert.match(shell, /id="openFactionIntelBtn"/);
  assert.match(shell, /id="closeFactionIntelBtn"/);
  assert.match(shell, /data-faction-intel-close/);
  assert.match(shell, /id="factionIntelRoot"/);

  const rendered = renderFaction(loadFixtureFilteredSnapshot({ mode: 'player' }));
  assert.strictEqual(rendered.root.querySelector('[data-faction-intel-component="true"]').getAttribute('data-faction-intel-component'), 'true');
});
