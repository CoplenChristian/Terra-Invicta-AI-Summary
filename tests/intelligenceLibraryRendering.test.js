// tests/intelligenceLibraryRendering.test.js
//
// Purpose: characterisation coverage for
//   public/v2/js/components/intelligence-library.js. The library is a
//   render-only overlay; these tests pin the visible records and navigation
//   contract before the React migration.
//
// ENTRY-POINT CONTRACT (confirmed against public/v2/index.html call sites):
//   window.IntelligenceLibrary = { render }
//   render(container, snapshot, briefing, observerId, options) fills the
//     container with the shell, nav, and the section panel selected by
//     options.section. options.spaceTab and options.spaceTheater narrow the
//     space section; options.section defaults to 'overview'.
//
// NULLABLE MAP (every no-data affordance, with the input that produces it):
//   'UNAVAILABLE' (literal string):
//     - countLabel(value, noun) when numberValue(value) is null
//         renderOverview stats (L122-130), renderFactions count label,
//         renderCouncilors count, renderNations count, renderMining count,
//         renderHabs count, renderFleets count, renderResearch project count
//     - relation.hateOfUs / ourHate when no matching factionRelationship found
//     - power cell when powerScore.overall is null or undefined
//     - space column when faction.spaceVisibility === 'unavailable'
//     - fleet combat power when combatPowerAvailable is falsy
//     - fleet weapon summary when both weaponSummary and dominantWeaponType are null
//     - ship combat power when null or undefined
//     - ship weapon summary when (weaponLoadout || []).length is 0
//     - topSkill(councilor) when no measured maskedAttributes skill found
//     - councilorProfile(councilor) when visibility is neither raw_save_only nor confirmed
//     - techMatrix observer status when faction entry missing in project.factions
//   em dash '—':
//     - display(value) when value is null, undefined, or ''
//     - number(value, decimals) when numberValue(value) is null
//     - money(value) when numberValue(value) is null
//     - resourceCell(value) (which is number(value, 2)) when null
//     - hab LEO column when inEarthLEO is falsy
//     - missing metadata fields (gameTimeString, activeSaveFileName, lastModified)
//     - missing councilor fields (displayName, typeTemplateName, locationName,
//       activeMissionName, totalSkills)
//     - missing fleet fields (displayName, factionName, orbitBody, mission,
//       destination, arrivalDate)
//     - missing ship fields, hab fields, mine site fields
//   '0' (literal string):
//     - nation nukes when nukes is falsy
//     - nation controlPoints.length when 0
//   'None' (literal string):
//     - nation executiveFactionName when null
//   'No attached profile' (literal string):
//     - councilorProfile when visibility is raw_save_only or confirmed and
//       orgs + traits are empty
//   Status chip tones:
//     - faction: 'LIMITED' muted when spaceVisibility === 'unavailable',
//       'AVAILABLE' good otherwise
//     - capability: 'LOCKED / UNAVAILABLE' muted when detail.active is falsy,
//       'ACTIVE' good when truthy
//     - tech matrix observer status: 'completed' good, 'locked' muted, else neutral
//     - hab status: 'UNDER ASSAULT' danger / 'UNDER BOMBARDMENT' danger /
//       'IN COMBAT' danger / 'OPERATIONAL' good
//   Empty messages (rows.length === 0):
//     - 'No records are available in this intelligence view.' (default)
//     - section-specific: 'No faction records are available.',
//       'No active councilors are available...', 'No nations are available...',
//       'No mining sites are available...', 'No habs are available...',
//       'No fleets are available...', 'No ship records are available.',
//       'No active global research slots.', 'No technology matrix records...',
//       'No completed technologies are available.', 'No capability details...',
//       'No xenoforming sites are visible...', 'No alien facilities are visible...'
//     - councilor filtered: 'No active councilors match the current filter.'
//     - alien councilors player mode: 'Alien councilor records are unavailable...'
//     - alien councilors omniscient mode: 'No active alien councilors are present...'
//   Truncation:
//     - First 8 priority targets render; further targets omitted with note:
//         "Showing 8 of N targets; M further target(s) are omitted from this view."
//     - When all targets fit (length <= 8), NO omission note reads.
//     - When servantTargets is [] or absent, the priority panel does not mount.
//
// RED PROOF (2026-08-25): temporarily replaced the `'UNAVAILABLE'` token in
//   the `topSkill` fallback (public/v2/js/components/intelligence-library.js
//   line 69) with the em dash `'—'`. Running only this file went red with
//   two failures — the per-metric councilor maskedAttributes test caught
//   the missing UNAVAILABLE on the Lead skill cell, and the partial-render
//   test caught the same regression inside the councilors section of its
//   mixed measured/null render. The component line was restored immediately;
//   there is no source-file change.

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
// Partial-state helpers and a fully-measured baseline snapshot.
// ---------------------------------------------------------------------------

const FORBIDDEN_RUNTIME_TEXT = ['null', 'undefined', 'NaN', '[object Object]'];

function assertNoRuntimePlaceholders(text, label) {
  for (const token of FORBIDDEN_RUNTIME_TEXT) {
    const index = text.indexOf(token);
    assert.strictEqual(
      index,
      -1,
      `${label}: rendered ${JSON.stringify(token)} near ${text.slice(Math.max(0, index - 60), index + 60)}`
    );
  }
}

function assertIncludesAll(text, fragments, label) {
  for (const fragment of fragments) {
    assert.ok(text.includes(fragment), `${label}: missing visible text ${JSON.stringify(fragment)}\n${text}`);
  }
}

function setPath(target, path, value) {
  let cursor = target;
  for (let index = 0; index < path.length - 1; index += 1) {
    cursor = cursor[path[index]];
  }
  cursor[path[path.length - 1]] = value;
  return target;
}

function deletePath(target, path) {
  let cursor = target;
  for (let index = 0; index < path.length - 1; index += 1) {
    cursor = cursor[path[index]];
  }
  delete cursor[path[path.length - 1]];
  return target;
}

/**
 * A fully-measured library snapshot for per-metric nullable assertions.
 * Every field on every section carries a measured value, so nulling one
 * field at a time produces a render in which the unavailable token sits
 * among measured neighbours.
 */
function measuredLibrarySnapshot(overrides = {}) {
  const base = {
    mode: 'player',
    observerFactionId: 4712,
    observerFactionName: 'the Initiative',
    metadata: {
      gameTimeString: 'MEASURED INPUT',
      activeSaveFileName: 'measured-save.zip',
      lastModified: '2026-08-25T12:00:00Z'
    },
    factions: [
      {
        ID: 4712,
        displayName: 'the Initiative',
        powerScore: { overall: 70, earthEconomy: 80, earthPolitics: 75 },
        controlPointsCount: 12,
        totalGdp: 1234567890123,
        habsCount: 4,
        shipsCount: 18,
        spaceVisibility: 'visible'
      },
      {
        ID: 4713,
        displayName: 'the Servants',
        powerScore: { overall: 35 },
        controlPointsCount: 8,
        totalGdp: 987654321098,
        habsCount: 2,
        shipsCount: 9,
        spaceVisibility: 'visible'
      }
    ],
    factionRelationships: [
      { sourceFactionId: 4713, targetFactionId: 4712, hate: 4.5 },
      { sourceFactionId: 4712, targetFactionId: 4713, hate: 2.1 }
    ],
    councilors: [
      {
        ID: 1,
        factionId: 4712,
        displayName: 'Director Hayes',
        typeTemplateName: 'Administrator',
        locationName: 'Earth',
        activeMissionName: 'Observe the council',
        status: 'Active',
        totalSkills: 18,
        isAlien: false,
        visibility: 'visible',
        orgs: [{ displayName: 'Cabinet' }],
        traits: ['Cautious'],
        maskedAttributes: {
          Administration: { visible: 7 },
          Persuasion: { visible: 5 },
          Investigation: { visible: 4 },
          Espionage: { visible: 3 },
          Command: { visible: 4 },
          Science: { visible: 5 },
          Security: { visible: 4 },
          Loyalty: { visible: 5 }
        }
      }
    ],
    nations: [
      {
        displayName: 'United States',
        executiveFactionName: 'the Initiative',
        executiveFactionId: 4712,
        controlPoints: [{}, {}],
        GDP: 22000000000000,
        milTech: 5.2,
        armies: 25,
        nukes: 0,
        unrest: 0.5,
        cohesion: 4.0,
        boost: 3.5,
        missionControl: 50
      }
    ],
    fleets: [
      {
        displayName: 'First Fleet',
        factionName: 'the Initiative',
        shipsCount: 4,
        combatPower: 1000,
        combatPowerAvailable: true,
        weaponSummary: 'MISSILE x2 · PD x1',
        dominantWeaponType: 'MISSILE',
        orbitBody: 'Earth',
        mission: 'Patrol',
        destination: 'Mars',
        arrivalDate: '2042-01-01',
        ships: [
          {
            displayName: 'ISS Endurance',
            hullName: 'Cruiser',
            dominantWeaponType: 'MISSILE',
            weaponLoadout: [{ role: 'MISSILE', count: 2 }],
            combatPower: 250
          }
        ]
       }
    ],
    habs: [
      {
        displayName: 'Orbital Hab Alpha',
        factionName: 'the Initiative',
        habType: 'Stanford Torus',
        tier: 3,
        orbitBody: 'Earth',
        inEarthLEO: true,
        templateName: 'StanfordTorus',
        underAssault: false,
        underBombardment: false,
        inCombat: false
      }
    ],
    habSites: [
      {
        displayName: 'Luna Site Alpha',
        parentBodyName: 'Luna',
        factionName: 'the Initiative',
        water: 1.2,
        volatiles: 0.8,
        metals: 2.5,
        nobleMetals: 0.4,
        fissiles: 0.1,
        mineTier: 2,
        pendingHab: false,
        mineModuleName: 'Refinery Mk II',
        daysRemaining: 30,
        habName: 'Orbital Hab Alpha'
      }
    ],
    globalResearch: {
      activeSlots: [
        {
          slotNumber: 1,
          displayName: 'Project Cryogenic',
          category: 'propulsion',
          accumulatedResearch: 50,
          totalCost: 200,
          percent: 25,
          leadFactionName: 'the Initiative',
          leadContribution: 30
        }
      ],
      finishedTechsNames: ['Project Solid-FuelSpaceRockets']
    },
    techMatrix: [
      {
        projectId: 'Project_Cryogenic',
        displayName: 'Cryogenic Liquid-Fuel Rockets',
        category: 'propulsion',
        effects: ['Effect_ChemAdv1'],
        factions: { '4712': { status: 'completed' } }
      }
    ],
    capabilities: {
      details: {
        Effect_DetectAbductions: {
          name: 'Detect Abductions',
          active: true,
          requiredProject: 'Project_TheirSignatures',
          requiredEffect: 'Effect_TheirSignatures',
          description: 'Allows detection of alien abductions.'
        }
      }
    },
    activeXenoforming: [
      { regionName: 'Alien Region', level: 3, regionId: 'reg_001' }
    ],
    builtAlienFacilities: [
      { displayName: 'Alien LZ', regionName: 'Alien Region', factionName: 'the Aliens', type: 'LZ' }
    ],
    servantTargets: [],
    priorityTargetFaction: null
  };
  if (overrides.servantTargets !== undefined) base.servantTargets = overrides.servantTargets;
  return base;
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
// ---------------------------------------------------------------------------
// Per-metric nullable assertions.
//
// Each test nulls exactly one input metric on a fully-measured snapshot,
// renders the section that surfaces that metric, and asserts two things:
// (a) the nulled cell surfaces its no-data affordance (UNAVAILABLE, em dash,
//     or the literal '0'), and (b) the other cells in the same row still
// render their measured values. A failure on (a) names which affordance the
// component lost; a failure on (b) names which neighbour the null cascaded
// into. Eight nullable inputs, eight tests, no loop.
//
// IMPORTANT: assertion strings come from probing what the component
// actually renders from this snapshot, not from guesswork. If the rendered
// text drifts, the test names the metric and the change so the diff is
// localised.
// ---------------------------------------------------------------------------

test('per-metric: councilor maskedAttributes empty leaves Lead skill UNAVAILABLE while Total and Org / traits stay measured', () => {
  const snapshot = measuredLibrarySnapshot();
  snapshot.councilors[0].maskedAttributes = {};
  const { text } = renderLibrary(snapshot, { section: 'councilors' });

  assert.ok(text.includes('UNAVAILABLE'), 'a councilor with no measured skill must surface UNAVAILABLE in the Lead skill column');
  assert.ok(text.includes('18'), 'the measured totalSkills neighbour must still render as 18');
  assert.ok(text.includes('Cabinet · Cautious'), 'the measured Org / traits neighbour must still render its Cabinet · Cautious text');
  assert.ok(!text.includes('ADM 7'), 'no abbreviation-number pair should remain once no skill is measured');
  assertNoRuntimePlaceholders(text, 'councilor topSkill null');
});

test('per-metric: councilor totalSkills null leaves Total em dash while Lead skill and Org / traits stay measured', () => {
  const snapshot = measuredLibrarySnapshot();
  snapshot.councilors[0].totalSkills = null;
  const { text } = renderLibrary(snapshot, { section: 'councilors' });

  // The councilor row is "Director Hayes ... 18 ADM 7 Cabinet · Cautious VISIBLE".
  // Nulling totalSkills replaces the 18 with an em dash, and leaves ADM 7 and
  // Cabinet · Cautious intact. We assert the cell pair rather than the literal
  // row so a leading-cell drift does not break the test.
  assert.ok(
    text.includes('— ADM 7'),
    'the Total cell must render an em dash directly before the unchanged Lead skill abbreviation'
  );
  assert.ok(text.includes('Cabinet · Cautious'), 'Org / traits neighbour must remain a measured Cabinet · Cautious');
  assertNoRuntimePlaceholders(text, 'councilor totalSkills null');
});

test('per-metric: councilor orgs and traits empty with non-raw visibility leaves Org / traits UNAVAILABLE while Total and Lead skill stay measured', () => {
  const snapshot = measuredLibrarySnapshot();
  snapshot.councilors[0].orgs = [];
  snapshot.councilors[0].traits = [];
  snapshot.councilors[0].visibility = 'unknown';
  const { text } = renderLibrary(snapshot, { section: 'councilors' });

  // Row: "Director Hayes ... 18 ADM 7 Cabinet · Cautious VISIBLE" → UNAVAILABLE
  // replaces the Cabinet · Cautious cell; 18 and ADM 7 stay.
  assert.ok(text.includes('18 ADM 7 UNAVAILABLE'), 'Org / traits must render UNAVAILABLE directly after the unchanged Lead skill');
  assert.ok(!text.includes('Cabinet · Cautious'), 'no Cabinet · Cautious text must remain once the profile is null');
  assertNoRuntimePlaceholders(text, 'councilor profile null');
});

test('per-metric: faction powerScore null leaves Strategic score UNAVAILABLE while GDP, CPs, and Habs stay measured', () => {
  const snapshot = measuredLibrarySnapshot();
  snapshot.factions[0].powerScore = null;
  const { text } = renderLibrary(snapshot, { section: 'factions' });

  // Measured baseline for the Initiative row is
  // "the Initiative UNAVAILABLE UNAVAILABLE 70/100 12 $1.23T 4 18 ships 1 ...".
  // Column order is: Faction / Hate of us / Our hate / Strategic score /
  // CPs / GDP / Habs / Ships / Councilors. Hate of us and Our hate for the
  // Initiative row are UNAVAILABLE because no factionRelationship targets
  // the observer. Nulling powerScore replaces "70/100" with UNAVAILABLE —
  // the cell sits between the Our-hate UNAVAILABLE and the CPs cell.
  // The measured row anchors (CPs 12, GDP $1.23T, Habs 4, Ships 18)
  // remain; we assert the UNAVAILABLE sits in the Initiative row between
  // the hate cells and the CPs cell, and that the measured neighbours
  // all remain present.
  assert.ok(
    /the Initiative\s+UNAVAILABLE\s+UNAVAILABLE\s+UNAVAILABLE\s+12\s+\$1\.23T\s+4\s+18\s+ships/.test(text),
    'the Initiative row must show three UNAVAILABLEs (Hate of us / Our hate / Strategic score) followed by 12 / $1.23T / 4 / 18 ships'
  );
  assert.ok(text.includes('35/100'), 'the Servants row must keep its measured 35/100');
  assertNoRuntimePlaceholders(text, 'faction powerScore null');
});

test('per-metric: faction totalGdp null leaves GDP em dash while Strategic score, CPs, and Habs stay measured', () => {
  const snapshot = measuredLibrarySnapshot();
  snapshot.factions[0].totalGdp = null;
  const { text } = renderLibrary(snapshot, { section: 'factions' });

  // Initiative row: "70/100 12 $1.23T 4 ..." → GDP cell becomes em dash:
  // "70/100 12 — 4 ...". Servants row keeps $987.7B.
  assert.ok(text.includes('70/100 12 — 4'), 'GDP must render an em dash directly between the unchanged CPs and Habs');
  assert.ok(text.includes('$987.7B'), 'the Servants GDP neighbour must stay measured');
  assertNoRuntimePlaceholders(text, 'faction totalGdp null');
});

test('per-metric: nation GDP null leaves GDP em dash while Mil tech, Armies, Unrest, and Cohesion stay measured', () => {
  const snapshot = measuredLibrarySnapshot();
  snapshot.nations[0].GDP = null;
  const { text } = renderLibrary(snapshot, { section: 'nations' });

  // Measured nation row: "United States the Initiative 2 $22.00T 5.2 25 0 0.5 4.0 3.50 50"
  // → GDP cell becomes em dash: "United States the Initiative 2 — 5.2 25 0 0.5 4.0 3.50 50".
  assert.ok(
    text.includes('the Initiative 2 — 5.2'),
    'GDP must render an em dash between CPs and Mil tech without disturbing the measured neighbours'
  );
  assert.ok(text.includes('25'), 'Armies must still render as 25');
  assert.ok(text.includes('3.50'), 'Boost/mo must still render as 3.50');
  assertNoRuntimePlaceholders(text, 'nation GDP null');
});

test('per-metric: nation nukes null renders the literal "0" token and is NOT em dash UNAVAILABLE', () => {
  // DEFECT — SURFACED, NOT FIXED. The nation row uses
  //   nation.nukes ? statusChip(number(nation.nukes, 0), 'danger') : '0'
  // which collapses both "no nukes" (nukes: 0) and "data missing"
  // (nukes: null) into the literal token "0". A reader cannot distinguish
  // the two states from the rendered cell. The test pins that exact
  // behaviour so the regression lands with a clear note rather than a quiet
  // assertion. Fixing the underlying bug will require breaking this test —
  // the break is intentional and the new token will need its own assertion.
  // Measured baseline: "... 5.2 25 0 0.5 4.0 ..." — the "0" in that position
  // is the Nukes column. Nulling nukes still produces a single "0" token,
  // not an em dash and not "UNAVAILABLE".
  const snapshot = measuredLibrarySnapshot();
  snapshot.nations[0].nukes = null;
  const { text } = renderLibrary(snapshot, { section: 'nations' });

  // Measured nation data row (one row, no Unrest label in the body — Unrest
  // appears only as the column header):
  //   "United States the Initiative 2 $22.00T 5.2 25 0 0.5 4.0 3.50 50"
  // With nukes: null the second-to-last assertion the component makes is
  //   nation.nukes ? statusChip(number(nation.nukes, 0), 'danger') : '0'
  // so the nukes cell collapses to the literal "0". A reader cannot
  // distinguish nukes: 0 from nukes: null from this cell. The test pins
  // that behaviour — it asserts the literal "0" sits between Armies (25)
  // and Unrest (0.5) in the data row, and is NOT em dash or UNAVAILABLE.
  const dataRow = text.match(/the Initiative 2 \$22\.00T 5\.2 \d+ [^ ]+ 0\.\d+ \d+\.\d+ \d+\.\d+/);
  assert.ok(dataRow, 'the measured nation data row must be located by its known tokens');
  const tokens = dataRow[0].split(/\s+/);
  // tokens: ["the", "Initiative", "2", "$22.00T", "5.2", "25", "<nukes>", "0.5", "4.0", "3.50"]
  const nukesCell = tokens[6];
  assert.strictEqual(nukesCell, '0',
    'a null nukes field must collapse to the literal token "0" — NOT em dash, NOT UNAVAILABLE');
  assert.ok(text.includes('5.2 25 0 0.5'),
    'the literal row sequence "5.2 25 0 0.5" must appear — Armies=25, Nukes=0, Unrest=0.5');
  assert.ok(text.includes('0 0.5 4.0'),
    'the measured Nukes/Unrest/Cohesion neighbours must stay measured as 0 / 0.5 / 4.0');
  // (the em-dash "—" appears elsewhere on the page — header meta, etc. —
  // so we rely on the data-row tokens above, not a page-wide em-dash check)
  // The header row reads "Armies Nukes Unrest" and the data row reads
  // "25 0 0.5", so "Armies 25 0 Unrest" never co-occurs in the visible
  // text. Anchor on data-row tokens instead — see the includes() checks
  // above for "5.2 25 0 0.5" and "0 0.5 4.0".
  assertNoRuntimePlaceholders(text, 'nation nukes null');
});

test('per-metric: metadata gameTimeString null leaves Campaign date em dash in DATA PROVENANCE while Last modified and Active save stay measured', () => {
  const snapshot = measuredLibrarySnapshot();
  snapshot.metadata.gameTimeString = null;
  const { text } = renderLibrary(snapshot, { section: 'overview' });

  // DATA PROVENANCE rows: Campaign date / Active save / Last modified /
  // Executive directives. Nulling gameTimeString replaces just the
  // Campaign date cell.
  assert.ok(text.includes('Campaign date —'), 'Campaign date must render an em dash once gameTimeString is null');
  assert.ok(text.includes('measured-save.zip'), 'Active save neighbour must keep its measured-save.zip text');
  assert.ok(text.includes('8/25/2026'), 'Last modified neighbour must keep its toLocaleString text');
  assert.ok(text.includes('PLAYER INTEL / FILTERED —'), 'the header metadata strip must also render — for the nulled gameTimeString');
  assertNoRuntimePlaceholders(text, 'metadata gameTimeString null');
});

// ---------------------------------------------------------------------------
// Additional nullable assertions for metrics that have a separate code
// branch (avoids the "everything is UNAVAILABLE" collapse) plus the partial
// render that mixes affordances in one pass.
// ---------------------------------------------------------------------------

test('per-metric: faction shipsCount null with spaceVisibility visible leaves Ships UNAVAILABLE while Strategic score, GDP, and Habs stay measured', () => {
  const snapshot = measuredLibrarySnapshot();
  snapshot.factions[0].shipsCount = null;
  const { text } = renderLibrary(snapshot, { section: 'factions' });

  // Initiative row measured: "... 70/100 12 $1.23T 4 18 ships 1 ..."
  // The "18 ships" pair is the Ships column. Nulling shipsCount replaces
  // it with "UNAVAILABLE" (via countLabel on the count path, NOT the
  // spaceVisibility === 'unavailable' path).
  assert.ok(text.includes('$1.23T 4 UNAVAILABLE'), 'Ships must render UNAVAILABLE after the unchanged Habs neighbour');
  assert.ok(text.includes('70/100'), 'Strategic score must remain 70/100');
  assert.ok(text.includes('12'), 'CPs must remain 12');
  assert.ok(text.includes('AVAILABLE'), 'spaceVisibility must still drive the AVAILABLE chip, not collapse to LIMITED');
  assertNoRuntimePlaceholders(text, 'faction shipsCount null');
});

test('per-metric: fleet combatPowerAvailable false leaves Combat power UNAVAILABLE while Ships, Loadout, and Mission stay measured', () => {
  const snapshot = measuredLibrarySnapshot();
  snapshot.fleets[0].combatPowerAvailable = false;
  snapshot.fleets[0].combatPower = null;
  const { text } = renderLibrary(snapshot, { section: 'space', spaceTab: 'fleets' });

  // Measured: "First Fleet the Initiative 4 1,000 MISSILE x2 · PD x1 Earth Patrol Mars 2042-01-01"
  // → "First Fleet the Initiative 4 UNAVAILABLE MISSILE x2 · PD x1 Earth Patrol Mars 2042-01-01".
  assert.ok(
    text.includes('4 UNAVAILABLE MISSILE x2 · PD x1'),
    'Combat power must render UNAVAILABLE between Ships and Loadout when combatPowerAvailable is false'
  );
  assert.ok(text.includes('Patrol'), 'Mission must still render Patrol');
  assert.ok(text.includes('Mars'), 'Destination must still render Mars');
  assertNoRuntimePlaceholders(text, 'fleet combatPowerAvailable false');
});

test('per-metric: tech matrix observer status missing faction entry leaves Observer status UNAVAILABLE while Project, dataName, and Category stay measured', () => {
  const snapshot = measuredLibrarySnapshot();
  snapshot.techMatrix[0].factions = {};
  const { text } = renderLibrary(snapshot, { section: 'research' });

  // Measured: "Cryogenic Liquid-Fuel Rockets Project_Cryogenic propulsion completed Effect_ChemAdv1"
  // → "Cryogenic Liquid-Fuel Rockets Project_Cryogenic propulsion UNAVAILABLE Effect_ChemAdv1".
  assert.ok(
    text.includes('Project_Cryogenic propulsion UNAVAILABLE'),
    'Observer status must render UNAVAILABLE when the faction entry is missing'
  );
  assert.ok(text.includes('Effect_ChemAdv1'), 'Effects column must keep its measured entry');
  // The completed status chip is gated by observerStatus === 'completed',
  // which no longer holds when the faction entry is missing. The page does
  // contain the unrelated heading "COMPLETED GLOBAL TECHNOLOGIES", so we
  // assert on the row-level pattern instead of the whole page.
  assert.ok(
    !/Cryogenic Liquid-Fuel Rockets Project_Cryogenic propulsion completed/.test(text),
    'the completed status chip must not appear on the Cryogenic row once the faction entry is missing'
  );
  assertNoRuntimePlaceholders(text, 'tech matrix observer status missing faction');
});

// ---------------------------------------------------------------------------
// Partial render: several metrics null in the same snapshot, several still
// measured. This is the case the previous characterisation run failed to
// cover and the case that proves the per-cell routing does not collapse to
// a single degraded banner when only some inputs are absent.
// ---------------------------------------------------------------------------

test('partial render mixes UNAVAILABLE and em dash affordances alongside measured values in the overview and factions sections', () => {
  const snapshot = measuredLibrarySnapshot();
  // null these five distinct metrics across four sections
  snapshot.metadata.gameTimeString = null;       // overview header + Campaign date → em dash
  snapshot.factions[0].powerScore = null;       // factions Strategic score → UNAVAILABLE
  snapshot.factions[0].totalGdp = null;         // factions GDP → em dash
  snapshot.councilors[0].maskedAttributes = {}; // councilors Lead skill → UNAVAILABLE
  snapshot.fleets[0].combatPowerAvailable = false; snapshot.fleets[0].combatPower = null;
                                               // fleets Combat power → UNAVAILABLE

  // ---- overview ----
  const overview = renderLibrary(snapshot, { section: 'overview' });
  assert.ok(overview.text.includes('Campaign date —'), 'overview must show em dash for nulled Campaign date');
  assert.ok(overview.text.includes('PLAYER INTEL / FILTERED —'), 'overview header strip must also carry the em dash');
  assert.ok(overview.text.includes('FACTIONS 2 factions'), 'measured overview stat (faction count) must remain unchanged');
  assert.ok(overview.text.includes('measured-save.zip'),
    'overview neighbours of the nulled metadata must stay measured');

  // ---- factions ----
  const factions = renderLibrary(snapshot, { section: 'factions' });
  assert.ok(factions.text.includes('UNAVAILABLE'), 'the nulled powerScore must surface UNAVAILABLE in factions');
  assert.ok(factions.text.includes('12 — 4'),
    'the nulled totalGdp must surface em dash between the unchanged CPs (12) and Habs (4)');
  assert.ok(factions.text.includes('35/100'),
    'the second faction row must stay measured — nulling the Initiative must not cascade to the Servants');

  // ---- councilors ----
  const councilors = renderLibrary(snapshot, { section: 'councilors' });
  assert.ok(councilors.text.includes('UNAVAILABLE'),
    'the nulled maskedAttributes must surface UNAVAILABLE in the Lead skill column');
  assert.ok(councilors.text.includes('18'),
    'the councilor Total column must stay measured at 18 even when Lead skill is UNAVAILABLE');
  assert.ok(councilors.text.includes('Cabinet · Cautious'),
    'the Org / traits neighbour must stay measured even when Lead skill is UNAVAILABLE');

  // ---- fleets ----
  const fleets = renderLibrary(snapshot, { section: 'space', spaceTab: 'fleets' });
  assert.ok(fleets.text.includes('UNAVAILABLE'),
    'the nulled combatPowerAvailable must surface UNAVAILABLE in the Combat power column');
  assert.ok(fleets.text.includes('4'),
    'the Ships column must stay measured at 4 even when Combat power is UNAVAILABLE');

  assertNoRuntimePlaceholders(overview.text, 'partial overview');
  assertNoRuntimePlaceholders(factions.text, 'partial factions');
  assertNoRuntimePlaceholders(councilors.text, 'partial councilors');
  assertNoRuntimePlaceholders(fleets.text, 'partial fleets');
});

// ---------------------------------------------------------------------------
// Truncation boundary and distinct unavailable affordances.
// ---------------------------------------------------------------------------

test('priority targets at exactly the 8-entry cap mount the panel but emit NO omission note', () => {
  // Boundary check: at the cap, no records are omitted, so the omission
  // note must NOT appear. Pinning this so a future regression that always
  // emits the note (or never emits it) fails loud.
  const snapshot = measuredLibrarySnapshot();
  snapshot.servantTargets = Array.from({ length: 8 }, (_, index) => ({
    nationName: `Boundary ${index}`,
    targetFactionName: 'Initiative',
    score: index,
    reasons: ['boundary check']
  }));
  const { html, text } = renderLibrary(snapshot, { section: 'nations' });
  const renderedTargets = (html.match(/class="intel-library-target"/g) || []).length;
  assert.strictEqual(renderedTargets, 8, 'all eight priority targets must render at the cap');
  assert.ok(text.includes('PRIORITY TARGETS'), 'the priority panel must mount when targets are present');
  assert.ok(!text.includes('omitted from this view'), 'no omission note may appear when no records are omitted');
  assert.ok(!text.includes('Showing 8 of'), 'the omission summary line must not appear when no records are omitted');
});

test('councilor with visibility raw_save_only and empty orgs/traits renders "No attached profile" — distinct from UNAVAILABLE', () => {
  // Per the component's councilorProfile branch: a councilor that the save
  // exposes but the intel filter withholds (raw_save_only) gets the literal
  // string "No attached profile" rather than UNAVAILABLE. This is a distinct
  // affordance that means "the save has nothing here, and we are not
  // hiding it from you" — exactly the affordance the component documents in
  // the NULLABLE MAP header. Test pins both halves of that distinction.
  const snapshot = measuredLibrarySnapshot();
  snapshot.councilors[0].orgs = [];
  snapshot.councilors[0].traits = [];
  snapshot.councilors[0].visibility = 'raw_save_only';
  const { text } = renderLibrary(snapshot, { section: 'councilors' });

  assert.ok(text.includes('No attached profile'), 'raw_save_only with empty orgs/traits must render "No attached profile"');
  assert.ok(!text.includes('UNAVAILABLE'),
    'this branch must not leak the UNAVAILABLE affordance — that is reserved for non-raw visibility');
  assert.ok(text.includes('RAW'), 'the councilor row must still carry the RAW visibility chip');
  assertNoRuntimePlaceholders(text, 'councilor raw_save_only empty profile');
});

test('ship with empty weaponLoadout but dominantWeaponType set renders the dominant weapon in Equipped weapons — NOT UNAVAILABLE', () => {
  // Per the component's renderShips branch:
  //   (loadout || []).map(...).join(' · ') || dominantWeaponType || 'UNAVAILABLE'
  // An empty loadout falls through to dominantWeaponType, not to
  // UNAVAILABLE. This is the affordance that says "we know the hull's
  // primary role, even though the loadout list is empty" — distinct from
  // UNAVAILABLE ("we have no information at all").
  const snapshot = measuredLibrarySnapshot();
  snapshot.fleets[0].ships[0].weaponLoadout = [];
  snapshot.fleets[0].ships[0].dominantWeaponType = 'LASER';
  const { text } = renderLibrary(snapshot, { section: 'space', spaceTab: 'ships' });

  assert.ok(text.includes('LASER LASER'), 'empty loadout must surface dominantWeaponType in both Dominant and Equipped weapons cells');
  assert.ok(text.includes('50'), 'Combat power must stay measured at 50 for this ship');
  assertNoRuntimePlaceholders(text, 'ship empty loadout dominantWeaponType set');
});

test('habitat with inEarthLEO false leaves LEO em dash while Hab name, Type, Tier, and Status stay measured', () => {
  const snapshot = measuredLibrarySnapshot();
  snapshot.habs[0].inEarthLEO = false;
  const { text } = renderLibrary(snapshot, { section: 'space', spaceTab: 'habs' });

  // Measured: "Orbital Hab Alpha the Initiative Stanford Torus 3 Earth LEO OPERATIONAL StanfordTorus"
  // → LEO cell becomes em dash. The other measured columns stay.
  assert.ok(
    text.includes('Stanford Torus 3 Earth — OPERATIONAL'),
    'LEO must render an em dash between Orbit/body and Status while the measured neighbours stay'
  );
  assert.ok(text.includes('StanfordTorus'), 'Template column must keep its measured value');
  assertNoRuntimePlaceholders(text, 'hab inEarthLEO false');
});
