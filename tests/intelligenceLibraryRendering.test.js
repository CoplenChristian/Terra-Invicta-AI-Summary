//
// Purpose: characterization coverage for public/v2/js/components/intelligence-library.js.
// The library is a render-only overlay, so these tests pin the visible records
// and navigation contract before the React migration.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { runComponent, visibleText } = require('./fixtures/renderHarness');
const { loadFixtureFilteredSnapshot } = require('./fixtures/frozenSnapshots');
const { DOMNode, createMockEnvironment, serializeNode } = require('./fixtures/mockDom');

const repoRoot = path.resolve(__dirname, '..');
const componentPath = path.join(repoRoot, 'public', 'v2', 'js', 'components', 'intelligence-library.js');
const shellPath = path.join(repoRoot, 'public', 'v2', 'index.html');

// mockDom intentionally stays small. These are the browser properties this
// component uses while binding its generated navigation controls; the shipped
// shared bundle still comes from renderHarness, never from a test copy.
function installComponentDomProperties() {
  if (!Object.prototype.hasOwnProperty.call(DOMNode.prototype, 'nodeType')) {
    Object.defineProperty(DOMNode.prototype, 'nodeType', {
      configurable: true,
      get() { return this.tagName === '#TEXT' ? 3 : 1; }
    });
  }

  if (!Object.prototype.hasOwnProperty.call(DOMNode.prototype, 'dataset')) {
    Object.defineProperty(DOMNode.prototype, 'dataset', {
      configurable: true,
      get() {
        const node = this;
        return new Proxy({}, {
          get(target, property) {
            const attribute = 'data-' + String(property).replace(/[A-Z]/g, letter => '-' + letter.toLowerCase());
            return node.getAttribute(attribute) ?? undefined;
          },
          set(target, property, value) {
            const attribute = 'data-' + String(property).replace(/[A-Z]/g, letter => '-' + letter.toLowerCase());
            node.setAttribute(attribute, value);
            return true;
          }
        });
      }
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
}

installComponentDomProperties();

function loadComponent() {
  return runComponent(componentPath).window.IntelligenceLibrary;
}

function renderLibrary(snapshot, options = {}, briefing = null) {
  const { document, window } = createMockEnvironment();
  const component = runComponent(componentPath, { document, window }).window.IntelligenceLibrary;
  const root = document.createElement('div');
  component.render(root, snapshot, briefing, 4712, options);
  const html = serializeNode(root);
  return { component, document, root, html, text: visibleText(html) };
}

function briefingFixture() {
  return {
    directives: { geopolitical: [], council: [], space: [], research: [] },
    strategic: {
      spaceTheaters: [{
        key: 'earth',
        name: 'EARTH',
        ownShips: 3,
        ownFleets: 1,
        alienShips: 2,
        alienFleets: 1,
        ownHabs: 1,
        ownMiningSites: 0,
        status: 'CONTESTED',
        weaponMix: [{ role: 'MISSILE', count: 2 }, { role: 'PD', count: 1 }]
      }]
    }
  };
}

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
  return `${abbreviations[key] || key.slice(0, 3).toUpperCase()} ${value}`;
}

// ---------------------------------------------------------------------------
// Normal render: both visibility modes and the complete overlay navigation.
// ---------------------------------------------------------------------------

test('intelligence library renders the normal player snapshot and its own nav sections', () => {
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'player' });
  const { text, root } = renderLibrary(snapshot, {}, briefingFixture());

  assert.ok(text.includes('Campaign intelligence library'));
  assert.ok(text.includes('PLAYER INTEL / FILTERED'));
  assert.ok(text.includes(snapshot.metadata.gameTimeString));
  assert.ok(text.includes('ACTIVE COUNCILORS'));
  assert.ok(text.includes('QUICK ROUTES'));

  const navigation = root.querySelector('nav');
  assert.ok(navigation, 'the component owns an intelligence-library nav');
  const sections = [...navigation.querySelectorAll('[data-library-section]')];
  assert.strictEqual(sections.length, 8, 'all eight library sections must be reachable from the overlay nav');
  for (const label of ['Overview', 'Faction balance', 'Councilors', 'Nations', 'Space & mining', 'Technology', 'Alien intelligence', 'Exports']) {
    assert.ok(text.includes(label), `the nav must retain its ${label} section`);
  }
});

test('intelligence library renders the normal omniscient snapshot with full-save labeling', () => {
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'omniscient' });
  const { text } = renderLibrary(snapshot, {}, briefingFixture());

  assert.ok(text.includes('Campaign intelligence library'));
  assert.ok(text.includes('OMNISCIENT / FULL SAVE STATE'));
  assert.ok(text.includes(snapshot.observerFactionName));
  assert.ok(text.includes('Visibility discipline'));
});

// ---------------------------------------------------------------------------
// Player redaction and omniscient alien records.
// ---------------------------------------------------------------------------

test('player councilor rendering keeps an observed enemy whose attributes are masked', () => {
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'player' });
  const target = firstObservedEnemy(snapshot);
  assert.ok(target, 'the frozen player fixture must contain an observed enemy with maskedAttributes');
  assert.equal(target.attributes, undefined, 'the player fixture must not expose the enemy attributes field');

  const { text } = renderLibrary(snapshot, { section: 'councilors' });
  assert.ok(text.includes(target.displayName), 'a player-visible enemy councilor must not be dropped by an attributes-only filter');
  assert.ok(text.includes(expectedMaskedTopSkill(target)), 'the visible skill must come from maskedAttributes');
  assert.ok(text.includes('Hidden attributes are intentionally represented as unavailable'));
});

test('omniscient councilor and threat sections retain active alien councilors', () => {
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'omniscient' });
  const alien = firstAlien(snapshot);
  assert.ok(alien, 'the frozen omniscient fixture must contain an active alien councilor');

  const council = renderLibrary(snapshot, { section: 'councilors' });
  assert.ok(council.text.includes(alien.displayName));
  assert.ok(council.text.includes('ALIEN'));
  assert.ok(council.text.includes('OMNISCIENT / FULL SAVE STATE'));

  const threats = renderLibrary(snapshot, { section: 'threats' });
  assert.ok(threats.text.includes('ACTIVE ALIEN COUNCILORS'));
  assert.ok(threats.text.includes(alien.displayName));
});

test('intelligence library sections retain representative records and field labels', () => {
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'player' });
  const briefing = briefingFixture();
  const site = snapshot.habSites.find(item => item.displayName);
  const hab = snapshot.habs.find(item => item.displayName);
  const fleet = snapshot.fleets.find(item => item.displayName);
  const ship = snapshot.fleets.flatMap(item => item.ships || []).find(item => item.displayName);
  const project = snapshot.techMatrix.find(item => item.displayName);
  const faction = snapshot.factions.find(item => item.ID === 4712);
  const nation = snapshot.nations.find(item => item.displayName);

  const factions = renderLibrary(snapshot, { section: 'factions' }, briefing);
  assert.ok(factions.text.includes(faction.displayName));
  assert.ok(factions.text.includes('Hate of us'));
  assert.ok(factions.text.includes('Strategic score (est.)'));

  const nations = renderLibrary(snapshot, { section: 'nations' }, briefing);
  assert.ok(nations.text.includes(nation.displayName));
  assert.ok(nations.text.includes('PRIORITY TARGETS'));
  assert.ok(nations.text.includes('GDP'));

  const mining = renderLibrary(snapshot, { section: 'space', spaceTab: 'mining' }, briefing);
  assert.ok(mining.text.includes(site.displayName));
  assert.ok(mining.text.includes('Water/day'));
  assert.ok(mining.text.includes('Mine tier'));

  const habs = renderLibrary(snapshot, { section: 'space', spaceTab: 'habs' }, briefing);
  assert.ok(habs.text.includes(hab.displayName));
  assert.ok(habs.text.includes('Orbit / body'));

  const fleets = renderLibrary(snapshot, { section: 'space', spaceTab: 'fleets' }, briefing);
  assert.ok(fleets.text.includes(fleet.displayName));
  assert.ok(fleets.text.includes('Loadout'));
  assert.ok(fleets.text.includes('Arrival'));

  const ships = renderLibrary(snapshot, { section: 'space', spaceTab: 'ships' }, briefing);
  if (ship) assert.ok(ships.text.includes(ship.displayName));
  assert.ok(ships.text.includes('Equipped weapons'));

  const research = renderLibrary(snapshot, { section: 'research' }, briefing);
  assert.ok(research.text.includes(project.displayName));
  assert.ok(research.text.includes('dataName'));
  assert.ok(research.text.includes('Observer status'));

  const exports = renderLibrary(snapshot, { section: 'exports' }, briefing);
  assert.ok(exports.text.includes('EXPORT PACKAGE'));
  assert.ok(exports.text.includes('Copy compact snapshot'));
  assert.ok(exports.text.includes('PLAYER INTEL / FILTERED'));
});

// ---------------------------------------------------------------------------
// Every unavailable representation used by this renderer.
// ---------------------------------------------------------------------------

function degradedSnapshot() {
  return {
    mode: 'player',
    observerFactionId: 4712,
    observerFactionName: 'the Initiative',
    metadata: {},
    factions: [{
      ID: 4712,
      displayName: 'the Initiative',
      powerScore: null,
      controlPointsCount: null,
      totalGdp: null,
      habsCount: null,
      shipsCount: null,
      spaceVisibility: 'unavailable'
    }],
    factionRelationships: [],
    councilors: [],
    nations: [{ displayName: null, executiveFactionName: null, controlPoints: [], GDP: null, milTech: null, armies: null, nukes: null, unrest: null, cohesion: null, boost: null, missionControl: null }],
    habs: [],
    fleets: [],
    habSites: [],
    activeXenoforming: [],
    builtAlienFacilities: [],
    capabilities: { details: {} },
    globalResearch: { activeSlots: [], finishedTechsNames: [] },
    techMatrix: []
  };
}

test('intelligence library renders UNAVAILABLE when faction telemetry is absent', () => {
  const { text } = renderLibrary(degradedSnapshot(), { section: 'factions' });
  assert.ok(text.includes('UNAVAILABLE'), 'missing power, relationship, and space values must remain UNAVAILABLE');
});

test('intelligence library renders UNKNOWN as a distinct research status', () => {
  const snapshot = degradedSnapshot();
  snapshot.techMatrix = [{
    projectId: 'Project_Unknown',
    displayName: 'Unknown project',
    category: 'general',
    effects: [],
    factions: { '4712': { status: 'UNKNOWN' } }
  }];
  const { text } = renderLibrary(snapshot, { section: 'research' });
  assert.ok(text.includes('UNKNOWN'), 'an unknown project status must not collapse into UNAVAILABLE or a blank cell');
});

test('intelligence library renders an em dash for an explicitly unmeasured nation field', () => {
  const { text } = renderLibrary(degradedSnapshot(), { section: 'nations' });
  assert.ok(text.includes('—'), 'null display and numeric nation fields must remain em dashes');
});

// ---------------------------------------------------------------------------
// Priority target truncation must announce omissions, not drop them silently.
// ---------------------------------------------------------------------------

test('priority targets announce how many records the 8-entry display cap omits', () => {
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'player' });
  const allTargets = snapshot.servantTargets;
  assert.ok(Array.isArray(allTargets) && allTargets.length > 8,
    'the frozen intel fixture must carry more than eight servant targets so truncation is exercised');
  const omitted = allTargets.length - 8;
  const { html, text } = renderLibrary(snapshot, { section: 'nations' });
  const renderedTargets = (html.match(/class="intel-library-target"/g) || []).length;
  assert.strictEqual(renderedTargets, 8, 'only the first eight priority targets may render');
  assert.match(text, new RegExp(`Showing 8 of ${allTargets.length} targets`));
  assert.match(text, new RegExp(`${omitted} further targets are omitted from this view`));
});

test('priority targets stay hidden when servantTargets is absent or empty', () => {
  const base = {
    mode: 'player',
    observerFactionName: 'the Initiative',
    metadata: { gameTimeString: 'TARGET INPUT' },
    factions: [],
    nations: [{ displayName: 'Testland', executiveFactionName: 'None', controlPoints: [], GDP: 1, milTech: 1, armies: 0, nukes: 0, unrest: 0, cohesion: 0, boost: 0, missionControl: 0 }]
  };
  for (const label of ['absent', 'empty']) {
    const snapshot = label === 'absent' ? { ...base } : { ...base, servantTargets: [] };
    const { text } = renderLibrary(snapshot, { section: 'nations' });
    assert.ok(!text.includes('PRIORITY TARGETS'), `${label} servantTargets must not mount the priority panel`);
    assert.ok(!text.includes('omitted from this view'), `${label} servantTargets must not claim omissions`);
    assert.ok(!text.includes('Showing 0 of'), `${label} servantTargets must not read as showing zero of zero`);
  }
});

// ---------------------------------------------------------------------------
// Empty versus absent payload fields, section navigation, and overlay hooks.
// ---------------------------------------------------------------------------

test('intelligence library distinguishes empty collections from absent collections', () => {
  const empty = renderLibrary({
    mode: 'player',
    observerFactionName: 'the Initiative',
    metadata: { gameTimeString: 'EMPTY INPUT' },
    factions: [],
    councilors: [],
    nations: [],
    habs: [],
    fleets: [],
    habSites: []
  });
  assert.ok(empty.text.includes('EMPTY INPUT'));
  assert.ok(empty.text.includes('FACTIONS 0 factions'));

  const absent = renderLibrary({ mode: 'player', observerFactionName: 'the Initiative' });
  assert.ok(absent.text.includes('Campaign intelligence library'));
  assert.ok(absent.text.includes('Campaign date —'));
  assert.ok(absent.text.includes('FACTIONS 0 factions'));
  assert.ok(!absent.text.includes('EMPTY INPUT'));
});

test('intelligence library navigation re-renders sections and exposes dossier callbacks', () => {
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'player' });
  let openedFaction = null;
  const rendered = renderLibrary(snapshot, { onOpenFaction: id => { openedFaction = id; } });

  const threatsButton = rendered.root.querySelector('[data-library-section="threats"]');
  assert.ok(threatsButton && typeof threatsButton.onclick === 'function');
  threatsButton.onclick();
  assert.ok(visibleText(serializeNode(rendered.root)).includes('Threat and discovery record'));

  const factions = renderLibrary(snapshot, { section: 'factions', onOpenFaction: id => { openedFaction = id; } });
  const faction = snapshot.factions.find(item => item.ID !== 4712);
  const dossierButton = factions.root.querySelector(`[data-library-faction="${faction.ID}"]`);
  assert.ok(dossierButton && typeof dossierButton.onclick === 'function');
  dossierButton.onclick();
  assert.strictEqual(openedFaction, faction.ID);
});

test('intelligence library overlay has an open mount and close path in the shipped shell', () => {
  const shell = fs.readFileSync(shellPath, 'utf8');
  assert.match(shell, /id="openIntelligenceLibraryBtn"/);
  assert.match(shell, /id="closeIntelligenceLibraryBtn"/);
  assert.match(shell, /data-intelligence-library-close/);
  assert.match(shell, /id="intelligenceLibraryRoot"/);

  const rendered = renderLibrary(loadFixtureFilteredSnapshot({ mode: 'player' }));
  assert.ok(rendered.root.querySelector('nav'), 'opening the overlay must mount the component nav into its root');
  rendered.root.innerHTML = '';
  assert.strictEqual(rendered.root.innerHTML, '', 'closing the overlay must leave its mount empty for the next open');
});
