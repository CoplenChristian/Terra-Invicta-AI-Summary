// tests/executiveBoards.test.js
//
// Purpose: characterisation tests for src/v2/panels/ExecutiveBoards.jsx.
//   Captures exactly what the seven executive boards render RIGHT NOW so a later
//   React rewrite that silently drops a field fails loudly. These assertions are
//   a record of current output, not a review of it.
//
// WHAT executive-boards.js EXPOSES (read from the source, then confirmed against
// the call sites in public/v2/js/mission-control.js):
//
//   window.MissionControlBoards = {
//     renderFactionLedger(container, snapshot),              // mission-control.js:1570
//     renderLogisticsBoard(container, snapshot, strategic),  // :1641  strategic = briefing.strategic
//     renderCapabilityMatrix(container, snapshot, briefing), // :1668  briefing = the WHOLE briefing
//     renderTheaterBoard(container, snapshot, strategic),    // :1695
//     renderOperationsBoard(container, snapshot, strategic), // :1739
//     renderNationQueue(container, snapshot, briefing),      // :1840
//     renderResearchWatchlist(container, snapshot)           // :1776
//   }
//
//   There is NO single entry point. Seven panels, seven functions, and THREE
//   different payload shapes (the raw snapshot alone; briefing.strategic; the
//   whole briefing). The strangler mount assumes one entry point per panel, so a
//   migration must map each board to its own function + payload and cannot assume
//   one window global or a shared "payload" argument.
//
// HARNESS NOTE:
//   Drives a real browser through tests/fixtures/executiveBoardsBrowser.js and
//   public/v2/primitives-harness.html?scene=executiveBoards. MissionControlBoards
//   render functions mount the React panel into #executive-board-test-root.
//
// TRUNCATION: none of the seven boards renders a *TotalCount / *OmittedCount
//   pair -- the engine truncation counts live in the Directive Engine card, not
//   here. There is no truncation surface to assert.
//
// EMPTY vs ABSENT (they are different): renderCapabilityMatrix, renderNationQueue
//   and renderResearchWatchlist THROW a TypeError on an absent (undefined)
//   snapshot because they dereference snapshot.* unguarded; renderFactionLedger,
//   renderLogisticsBoard, renderTheaterBoard and renderOperationsBoard degrade to
//   their empty message for both empty and absent input. Both behaviours are
//   pinned below.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { chromium } = require('playwright');

const { ensurePrimitivesHarnessBuilt } = require('./fixtures/ensurePrimitivesHarness.js');
const { renderBoardOnPage, tryBoardOnPage, HARNESS_PATH } = require('./fixtures/executiveBoardsBrowser');
const { loadFixtureFilteredSnapshot } = require('./fixtures/frozenSnapshots');
const briefingGenerator = require('../server/briefingGenerator');
require('./fixtures/executiveBoardsBrowser');

const OBSERVER = 4712;

let server;
let browser;
let page;

before(async () => {
  ensurePrimitivesHarnessBuilt();
  const app = require('../server/index.js');
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}${HARNESS_PATH}?scene=executiveBoards`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForSelector('[data-testid="executive-boards-harness"]', { timeout: 15000 });
});

after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

function briefingFor(mode) {
  const snapshot = loadFixtureFilteredSnapshot({ mode });
  const briefing = briefingGenerator.generateMissionControlBriefing(snapshot, null, { mode, observer: OBSERVER });
  return { snapshot, briefing };
}

async function renderBoard(boardName, snapshot, third) {
  const { text, html } = await renderBoardOnPage(page, boardName, snapshot, third);
  return { text, html };
}

const FORBIDDEN = ['null', 'undefined', 'NaN', '[object Object]'];

function assertNoPlaceholderText(text, label) {
  for (const token of FORBIDDEN) {
    const index = text.indexOf(token);
    assert.strictEqual(
      index,
      -1,
      `${label}: rendered text contains "${token}" near: ${text.slice(Math.max(0, index - 60), index + 60)}`
    );
  }
}

// ---------------------------------------------------------------------------
// renderFactionLedger
// ---------------------------------------------------------------------------

test('faction ledger normal render, player mode: observer leads, hate is redacted to UNAVAILABLE', async () => {
  const { snapshot } = briefingFor('player');
  const { text, html } = await renderBoard('renderFactionLedger', snapshot);

  assert.ok(text.includes('LEDGER / CURRENT STATE'), 'board note must be present');

  // The observer faction sorts first and carries is-observer on its row.
  assert.ok(html.includes('data-board-faction-id="4712"'), 'observer row must carry its faction id');
  const observerRow = html.match(/<tr class="is-observer"[^>]*data-board-faction-id="4712"/);
  assert.ok(observerRow, 'the observer row must carry the is-observer class');
  assert.ok(text.includes('the Initiative'), 'observer displayName must render');

  // Player mode redacts alien-hate estimates: the reader gets UNAVAILABLE.
  assert.ok(text.includes('HATE UNAVAILABLE'), 'player hate must be UNAVAILABLE, never a number');
  assert.ok(!text.includes('HATE 42.7'), 'the omniscient hate figure must not leak into player mode');

  // The four data columns and their subtitles.
  assert.ok(text.includes('GDP Δ +60.0B'), 'observer GDP delta subtitle must render');
  assert.ok(text.includes('Δ ships —'), 'the em-dash ship delta must render for a faction with no ship change');
  assert.ok(text.includes('ORBITAL BUILDUP'), 'a strategic-status chip must render');
  assert.ok(text.includes('ALIEN SPACE MILITARY'), 'the alien faction must read as ALIEN SPACE MILITARY');
  assert.ok(text.includes('EARTH ECONOMIC POWER'), 'the top-GDP faction must read as EARTH ECONOMIC POWER');

  assertNoPlaceholderText(text, 'faction ledger player normal');
});

test('faction ledger normal render, omniscient mode: hate is measured, not UNAVAILABLE', async () => {
  const { snapshot } = briefingFor('omniscient');
  const { text, html } = await renderBoard('renderFactionLedger', snapshot);

  assert.ok(text.includes('the Initiative'), 'observer displayName must render');
  assert.ok(html.includes('data-board-faction-id="4712"'), 'observer row must be present');
  assert.ok(text.includes('HATE 42.7'), 'omniscient mode must show the measured hate estimate');
  assert.ok(!text.includes('HATE UNAVAILABLE'), 'a measured value must not fall back to UNAVAILABLE');
  assert.ok(text.includes('GDP Δ +60.0B'), 'observer GDP delta subtitle must render');
  assert.ok(text.includes('23 / 38'), 'observer habs / ships must render in omniscient');

  assertNoPlaceholderText(text, 'faction ledger omniscient normal');
});

test('faction ledger renders HATE UNAVAILABLE for a null hate estimate, its own assertion', async () => {
  const { text } = await renderBoard('renderFactionLedger', {
    observerFactionId: '1',
    factions: [{
      ID: '1', displayName: 'Initiative', totalGdp: 10,
      alienHate: { visibleEstimate: null }, assessedAlienHateOfMe: null
    }]
  });

  assert.ok(text.includes('HATE UNAVAILABLE'), 'a null hate estimate must render UNAVAILABLE, not 0');
  assertNoPlaceholderText(text, 'faction ledger null hate');
});

test('faction ledger renders an em dash for a missing ship delta', async () => {
  const { text } = await renderBoard('renderFactionLedger', {
    observerFactionId: '1',
    factions: [{ ID: '1', displayName: 'Initiative', totalGdp: 10, shipsCount: 3 }]
  });

  assert.ok(text.includes('Δ ships —'), 'a missing ship delta must render an em dash, never a bare delta');
  assertNoPlaceholderText(text, 'faction ledger em-dash ship delta');
});

test('faction ledger empty factions and absent snapshot both degrade to the empty message', async () => {
  const empty = await renderBoard('renderFactionLedger', { factions: [] });
  assert.ok(empty.text.includes('No faction records are available.'), 'empty factions must show the empty message');

  const absent = await renderBoard('renderFactionLedger', undefined);
  assert.ok(absent.text.includes('No faction records are available.'), 'absent snapshot must show the empty message');

  // For this board empty and absent coincide; pin that both are safe.
  assert.equal(empty.text, absent.text, 'empty and absent must render the same ledger empty state');
});

// ---------------------------------------------------------------------------
// renderLogisticsBoard
// ---------------------------------------------------------------------------

test('logistics board normal render, player and omniscient: spend and runway stay UNAVAILABLE', async () => {
  for (const mode of ['player', 'omniscient']) {
    const { snapshot, briefing } = briefingFor(mode);
    const { text } = await renderBoard('renderLogisticsBoard', snapshot, briefing.strategic);

    assert.ok(text.includes('LOGISTICS / STOCKPILE + OUTPUT'), `${mode}: board note must be present`);
    assert.ok(text.includes('Water'), `${mode}: the water resource row must render`);
    assert.ok(text.includes('Metals'), `${mode}: the metals resource row must render`);
    assert.ok(text.includes('Fissiles'), `${mode}: the fissiles resource row must render`);
    assert.ok(text.includes('Mare Salvatore · +105.4'), `${mode}: the top producer cell must render`);
    assert.ok(text.includes('UNAVAILABLE'), `${mode}: the ledger must carry at least one UNAVAILABLE`);
    assert.ok(text.includes('SWIPE HORIZONTALLY TO VIEW ALL COLUMNS'), `${mode}: the scroll hint must render`);
    assertNoPlaceholderText(text, `logistics ${mode} normal`);
  }
});

test('logistics board renders each unavailable state with its own assertion', async () => {
  const strategic = {
    resourcePosition: {
      resources: {
        wat: {
          label: 'Water', stock: 5, grossPerMonth: 1,
          spendPerMonth: null, underConstruction: [], topProducers: [], runwayDays: null
        }
      }
    }
  };
  const { text } = await renderBoard('renderLogisticsBoard', {}, strategic);

  assert.ok(text.includes('Spent / committed'), 'the column header must render');
  assert.ok(text.includes('UNAVAILABLE'), 'a null spendPerMonth must render UNAVAILABLE');
  assert.ok(text.includes('No visible queue'), 'an empty underConstruction must render No visible queue');
  assert.ok(text.includes('No active producer'), 'an empty topProducers must render No active producer');
  assert.ok(text.includes('Runway'), 'the runway column header must render');
  assertNoPlaceholderText(text, 'logistics unavailable states');
});

test('logistics board with no resources, empty and absent, renders the resource-empty message', async () => {
  const empty = await renderBoard('renderLogisticsBoard', {}, {});
  assert.ok(empty.text.includes('Resource production is unavailable in this snapshot.'), 'empty strategic must show resource-empty');

  const absent = await renderBoard('renderLogisticsBoard', undefined, undefined);
  assert.ok(absent.text.includes('Resource production is unavailable in this snapshot.'), 'absent strategic must show resource-empty');
});

// ---------------------------------------------------------------------------
// renderCapabilityMatrix
// ---------------------------------------------------------------------------

test('capability matrix normal render, player and omniscient: ranks, signals and intel online', async () => {
  for (const mode of ['player', 'omniscient']) {
    const { snapshot, briefing } = briefingFor(mode);
    const { text } = await renderBoard('renderCapabilityMatrix', snapshot, briefing);

    assert.ok(text.includes('CAPABILITY / DISCRETE SIGNALS'), `${mode}: board note must be present`);
    assert.ok(text.includes('Earth GDP rank'), `${mode}: the rank rows must render`);
    assert.ok(text.includes('#2 / 8'), `${mode}: the observed GDP rank must render`);
    assert.ok(text.includes('$47.4T'), `${mode}: the observed GDP must render`);
    assert.ok(text.includes('#4 / 7'), `${mode}: the human ship rank must render against the human-only list`);
    assert.ok(text.includes('Solid-Fuel Space Rockets'), `${mode}: the best-drive signal must render`);
    assert.ok(text.includes('Anaconda Missile Bay'), `${mode}: the best-missile signal must render`);
    assert.ok(text.includes('Point Defense Laser Turret'), `${mode}: the point-defense signal must render`);
    assert.ok(text.includes('OPERATIONS ONLINE'), `${mode}: canDetectAlienOperations true must render OPERATIONS ONLINE`);
    assert.ok(text.includes('Alien Signatures: ONLINE · Alien Methods: ONLINE'), `${mode}: intel detail must render ONLINE states`);
    assertNoPlaceholderText(text, `capability ${mode} normal`);
  }
});

test('capability matrix renders UNAVAILABLE for every unmeasured value, with its own assertion', async () => {
  const { text } = await renderBoard('renderCapabilityMatrix', {
    observerFactionId: '1',
    factions: [{ ID: '1', displayName: 'Initiative' }],
    capabilities: { canDetectAlienOperations: false, details: {} }
  }, {});

  assert.ok(text.includes('UNAVAILABLE / month'), 'unmeasured research must render UNAVAILABLE / month');
  assert.ok(text.includes('UNAVAILABLE ships'), 'unmeasured ship count must render UNAVAILABLE ships');
  assert.ok(text.includes('UNAVAILABLE habs'), 'unmeasured hab count must render UNAVAILABLE habs');
  assert.ok(text.includes('Dominant loadout UNAVAILABLE No fleet loadout visible'), 'no fleet must render UNAVAILABLE loadout');
  assert.ok(text.includes('Best drive signal UNAVAILABLE'), 'no drive project must render UNAVAILABLE');
  assert.ok(text.includes('Best kinetic signal UNAVAILABLE'), 'no kinetic project must render UNAVAILABLE');
  assert.ok(text.includes('Best missile signal UNAVAILABLE'), 'no missile project must render UNAVAILABLE');
  assert.ok(text.includes('Point defense signal UNAVAILABLE'), 'no point-defense project must render UNAVAILABLE');
  assert.ok(text.includes('Alien intelligence OPERATIONS LOCKED UNAVAILABLE'), 'a locked capability and an empty intel-details list must both render');
  assertNoPlaceholderText(text, 'capability unavailable states');
});

test('capability matrix renders UNAVAILABLE rank when the observer is excluded from the ranked list', async () => {
  const { text } = await renderBoard('renderCapabilityMatrix', {
    observerFactionId: '1',
    factions: [{
      ID: '1', displayName: 'the Alien Administration',
      totalGdp: 1, totalResearch: 1, shipsCount: 1, habsCount: 1
    }],
    capabilities: { canDetectAlienOperations: true, details: {} }
  }, {});

  // The human-ship rank ranks humans only, so an alien observer has no rank.
  assert.ok(text.includes('Human ship rank UNAVAILABLE'), 'an alien observer must render UNAVAILABLE for the human-only ship rank');
  assert.ok(text.includes('Earth GDP rank #1 / 1'), 'the all-faction GDP rank must still place the observer');
  assertNoPlaceholderText(text, 'capability unavailable rank');
});

test('capability matrix with no factions still renders the full UNAVAILABLE table; absent snapshot throws', async () => {
  const empty = await renderBoard('renderCapabilityMatrix', { factions: [] }, {});
  assert.ok(empty.text.includes('Earth GDP rank'), 'the rank rows must still render with empty factions');
  assert.ok(empty.text.includes('UNAVAILABLE / month'), 'the unmeasured values must still render UNAVAILABLE');
  assert.ok(!empty.text.includes('No capability records are available.'), 'this board has no empty-record state');

  const message = await tryBoardOnPage(page, 'renderCapabilityMatrix', undefined, undefined);
  assert.match(message, /observerFactionId/, 'an absent snapshot must throw on the unguarded observerFactionId dereference');
});

// ---------------------------------------------------------------------------
// renderTheaterBoard
// ---------------------------------------------------------------------------

test('theater board normal render, player and omniscient: posture, alien force, fleet breakdown', async () => {
  for (const mode of ['player', 'omniscient']) {
    const { snapshot, briefing } = briefingFor(mode);
    const { text } = await renderBoard('renderTheaterBoard', snapshot, briefing.strategic);

    assert.ok(text.includes('SPACE / LOCATION FIRST'), `${mode}: board note must be present`);
    assert.ok(text.includes('57 fleets / 420 ships'), `${mode}: the all-tracked scope must render`);
    assert.ok(text.includes('420 ALIEN SHIPS / ALL TRACKED BODIES'), `${mode}: the alien ship total must render`);
    assert.ok(text.includes('223 / 26 SOL SHIPS / FLEETS'), `${mode}: the Sol ship/fleet pair must render`);
    assert.ok(text.includes('8.6 AVERAGE SOL FLEET'), `${mode}: the average Sol fleet must render`);
    assert.ok(text.includes('LOW SOL FRAGMENTATION'), `${mode}: fragmentation must render LOW`);
    assert.ok(text.includes('THE INITIATIVE FLEET BREAKDOWN'), `${mode}: the observer fleet breakdown must render`);
    assert.ok(text.includes('India-305'), `${mode}: an observer fleet must render`);
    assert.ok(text.includes('35 ships · Mercury · Kinetic · Stationary / Patrol'), `${mode}: a fleet roster detail must render`);
    assert.ok(text.includes('HOSTILE PRESENCE'), `${mode}: a hostile-theater status chip must render`);
    assert.ok(text.includes('NO VISIBLE CONTACT'), `${mode}: an empty-theater status chip must render`);
    assertNoPlaceholderText(text, `theater ${mode} normal`);
  }
});

test('theater board renders UNAVAILABLE average Sol fleet and em dashes for missing largest/inbound', async () => {
  const { text } = await renderBoard('renderTheaterBoard', {
    fleets: [{ factionId: '4717', factionName: 'the Alien Administration', displayName: 'Xeno', shipsCount: 3 }]
  }, {
    spaceTheaters: [{
      key: 'sol', name: 'Sol', ownShips: 0, ownFleets: 0,
      alienShips: 0, alienFleets: 0, ownHabs: 0, ownMiningSites: 0
    }],
    spacePosture: null
  });

  assert.ok(text.includes('UNAVAILABLE AVERAGE SOL FLEET'), 'an empty Sol fleet must render UNAVAILABLE, not 0');
  assert.ok(text.includes('UNAVAILABLE SOL FRAGMENTATION'), 'an unmeasurable fragmentation must render UNAVAILABLE');
  assert.ok(text.includes('No fleet composition is visible for the selected faction.'), 'an observer with no fleets must render the empty fleet message');
  assert.ok(text.includes('NO VISIBLE CONTACT'), 'a theater with no hostile or own ships must render NO VISIBLE CONTACT');
  assertNoPlaceholderText(text, 'theater unavailable states');
});

test('theater board renders the alien-force empty message and the theater empty message', async () => {
  const { text } = await renderBoard('renderTheaterBoard', { fleets: [] }, { spaceTheaters: [], spacePosture: null });

  assert.ok(text.includes('Alien force posture is unavailable in this intelligence mode.'), 'no alien bodies must render the posture-empty message');
  assert.ok(text.includes('No theater posture is available.'), 'no theaters must render the theater-empty message');
  assert.ok(text.includes('No fleet composition is visible for the selected faction.'), 'no observer fleets must render the fleet-empty message');
});

// ---------------------------------------------------------------------------
// renderOperationsBoard
// ---------------------------------------------------------------------------

test('operations board normal render, player and omniscient: active councilors and mission coverage', async () => {
  for (const mode of ['player', 'omniscient']) {
    const { snapshot, briefing } = briefingFor(mode);
    const { text } = await renderBoard('renderOperationsBoard', snapshot, briefing.strategic);

    assert.ok(text.includes('OPERATIONS / ACTIVE COUNCILORS'), `${mode}: board note must be present`);
    assert.ok(text.includes('Beth Hofmann'), `${mode}: an active councilor must render`);
    assert.ok(text.includes('Persuasion'), `${mode}: the operative role must render`);
    assert.ok(text.includes('MISSION COVERAGE'), `${mode}: the coverage section must render`);
    assert.ok(text.includes('Public Campaign Beth Hofmann 25 PER'), `${mode}: a coverage row must render name, value and skill`);
    assert.ok(text.includes('Purge / Assassinate Hemaraj Pavanaja 25 ESP'), `${mode}: the espionage coverage row must render`);
    assertNoPlaceholderText(text, `operations ${mode} normal`);
  }
});

test('operations board renders Unknown, No active mission, em-dash skills and UNAVAILABLE role', async () => {
  const { text } = await renderBoard('renderOperationsBoard', {
    observerFactionId: '1',
    councilors: [{
      factionId: '1', displayName: 'Ghost', attributes: {},
      resolvedAttributes: null
    }]
  }, { councilCapabilities: { missionRoles: [] } });

  assert.ok(text.includes('Ghost'), 'the councilor must render');
  assert.ok(text.includes('Unknown'), 'a missing location must render Unknown, not null');
  assert.ok(text.includes('No active mission'), 'a missing mission must render No active mission');
  assert.ok(text.includes('—'), 'null skill values must render em dashes, never 0');
  assert.ok(text.includes('UNAVAILABLE'), 'a councilor with no measurable skills must render an UNAVAILABLE role');
  assert.ok(!text.includes('MISSION COVERAGE'), 'no missionRoles must render no coverage section');
  assertNoPlaceholderText(text, 'operations unavailable states');
});

test('operations board renders UNAVAILABLE coverage name and em-dash coverage value', async () => {
  const { text } = await renderBoard('renderOperationsBoard', {
    observerFactionId: '1',
    councilors: [{
      factionId: '1', displayName: 'Ghost', attributes: { Persuasion: 5 },
      resolvedAttributes: { effective: { Persuasion: 5 } }
    }]
  }, {
    councilCapabilities: {
      missionRoles: [{ mission: 'Public Campaign', skill: 'Persuasion', best: { name: null, value: null } }]
    }
  });

  assert.ok(text.includes('Public Campaign UNAVAILABLE —'), 'a missing best operative must render UNAVAILABLE name and em-dash value');
  assertNoPlaceholderText(text, 'operations coverage unavailable');
});

test('operations board with no active councilors renders the empty message; absent strategic is fine', async () => {
  const empty = await renderBoard('renderOperationsBoard', { observerFactionId: '1', councilors: [] }, {});
  assert.ok(empty.text.includes('No active councilors are available.'), 'no active councilors must show the empty message');

  const absent = await renderBoard('renderOperationsBoard', { observerFactionId: '1', councilors: [] }, undefined);
  assert.ok(absent.text.includes('No active councilors are available.'), 'absent strategic must still render the empty message');
});

// ---------------------------------------------------------------------------
// renderNationQueue
// ---------------------------------------------------------------------------

test('nation queue normal render, player and omniscient: postures and nukes', async () => {
  for (const mode of ['player', 'omniscient']) {
    const { snapshot, briefing } = briefingFor(mode);
    const { text } = await renderBoard('renderNationQueue', snapshot, briefing);

    assert.ok(text.includes('EARTH / ACTION QUEUE'), `${mode}: board note must be present`);
    assert.ok(text.includes('United States of North America'), `${mode}: the top nation must render`);
    assert.ok(text.includes('CONSOLIDATE'), `${mode}: a friendly-executive nation must render CONSOLIDATE`);
    assert.ok(text.includes('CRACKDOWN'), `${mode}: a priority-faction nation must render CRACKDOWN`);
    assert.ok(text.includes('0 nukes'), `${mode}: the nukes sublabel must render`);
    assert.ok(text.includes('unrest watch'), `${mode}: an unrest >= 2 nation must carry the unrest watch suffix`);
    assertNoPlaceholderText(text, `nation queue ${mode} normal`);
  }
});

test('nation queue renders Independent, No CP detail, and the posture ladder', async () => {
  const { text } = await renderBoard('renderNationQueue', {
    observerFactionId: '1',
    nations: [
      // CP but no executive -> must still render, reading Independent.
      { displayName: 'Freeport', GDP: 9, executiveFactionId: null, controlPoints: [{ factionName: 'the Initiative' }] },
      // Executive (the priority faction) but no CP detail -> No CP detail + CRACKDOWN.
      { displayName: 'Rivalia', GDP: 7, executiveFactionId: '2', controlPoints: [] }
    ]
  }, { priorityTargetFaction: { id: '2' } });

  assert.ok(text.includes('Freeport'), 'a nation with CP but no executive must still render');
  assert.ok(text.includes('Independent'), 'a missing executive must render Independent');
  assert.ok(text.includes('the Initiative 1') || text.includes('Initiative 1'),
    'the CP composition must render the holding faction (the leading "the" is stripped)');
  assert.ok(text.includes('WATCH'), 'a nation with no executive at all must read WATCH');
  assert.ok(text.includes('Rivalia'), 'the rival nation must render');
  assert.ok(text.includes('No CP detail'), 'a nation with no control points must render No CP detail');
  assert.ok(text.includes('CRACKDOWN'), 'the priority-faction executive must read CRACKDOWN');
  assertNoPlaceholderText(text, 'nation queue degraded');
});

test('nation queue with no nations renders the empty message; absent snapshot throws', async () => {
  const empty = await renderBoard('renderNationQueue', { observerFactionId: '1', nations: [] }, {});
  assert.ok(empty.text.includes('No nation holdings are available.'), 'no nations must show the empty message');

  const message = await tryBoardOnPage(page, 'renderNationQueue', undefined, undefined);
  assert.match(message, /observerFactionId/, 'an absent snapshot must throw on the unguarded observerFactionId dereference');
});

// ---------------------------------------------------------------------------
// renderResearchWatchlist
// ---------------------------------------------------------------------------

test('research watchlist normal render, player and omniscient: global, faction projects, availability', async () => {
  for (const mode of ['player', 'omniscient']) {
    const { snapshot } = briefingFor(mode);
    const { text } = await renderBoard('renderResearchWatchlist', snapshot);

    assert.ok(text.includes('GLOBAL RESEARCH'), `${mode}: the global section must render`);
    assert.ok(text.includes('Ultracapacitors 27.9%'), `${mode}: a global slot must render its progress`);
    assert.ok(text.includes('THE INITIATIVE PROJECTS'), `${mode}: the observer project section must render`);
    assert.ok(text.includes('GUARANTEED · ~1.5 mo'), `${mode}: a schedulable project must render GUARANTEED with months`);
    assert.ok(text.includes('RNG 50% CAP · ~4.1 mo'), `${mode}: a capped project must render RNG cap with months`);
    assert.ok(text.includes('INTELLIGENCE GAPS'), `${mode}: the gaps section must render`);
    assert.ok(text.includes('No locked capability records are available.'), `${mode}: no locked capabilities must render the empty message`);
    assertNoPlaceholderText(text, `research watchlist ${mode} normal`);
  }
});

test('research watchlist renders UNAVAILABLE lead, UNKNOWN availability, and GUARANTEED/RNG chips', async () => {
  const unknown = await renderBoard('renderResearchWatchlist', {
    observerFactionId: '1', observerFactionName: 'Initiative',
    factions: [{
      ID: '1', displayName: 'Initiative',
      currentProjects: [{ projectId: 'p1', displayName: 'Mystery', percent: 10, accumulatedResearch: 1, totalCost: 10 }]
    }],
    capabilities: { details: {} },
    globalResearch: { activeSlots: [{ techId: 't1', displayName: 'T1', percent: 50, leadFactionName: null, leadContribution: 3 }] },
    techTree: { nodes: [] }
  }, undefined);
  assert.ok(unknown.text.includes('UNAVAILABLE'), 'a missing lead faction must render UNAVAILABLE');
  assert.ok(unknown.text.includes('UNKNOWN'), 'a project with unknown availability must render UNKNOWN');

  const rng = await renderBoard('renderResearchWatchlist', {
    observerFactionId: '1', observerFactionName: 'Initiative',
    factions: [{
      ID: '1', displayName: 'Initiative',
      currentProjects: [{ projectId: 'p1', displayName: 'Gamble', percent: 10, accumulatedResearch: 1, totalCost: 10 }]
    }],
    capabilities: { details: {} },
    globalResearch: {},
    techTree: { nodes: [{ id: 'p1', availability: { known: true, schedulable: false, maxPercent: 50, expectedMonths: 4 } }] }
  }, undefined);
  assert.ok(rng.text.includes('RNG 50% CAP · ~4 mo'), 'a capped project must render its RNG cap and wait months');

  const gua = await renderBoard('renderResearchWatchlist', {
    observerFactionId: '1', observerFactionName: 'Initiative',
    factions: [{
      ID: '1', displayName: 'Initiative',
      currentProjects: [{ projectId: 'p1', displayName: 'Safe', percent: 10, accumulatedResearch: 1, totalCost: 10 }]
    }],
    capabilities: { details: {} },
    globalResearch: {},
    techTree: { nodes: [{ id: 'p1', availability: { known: true, schedulable: true, expectedMonths: 1 } }] }
  }, undefined);
  assert.ok(gua.text.includes('GUARANTEED · ~1 mo'), 'a schedulable project must render GUARANTEED');
});

test('research watchlist renders all three empty messages; absent snapshot throws', async () => {
  const empty = await renderBoard('renderResearchWatchlist', {
    observerFactionId: '1', observerFactionName: 'Initiative', factions: [],
    capabilities: {}, globalResearch: {}, techTree: { nodes: [] }
  }, undefined);
  assert.ok(empty.text.includes('No global research slots are available.'), 'no global slots must show the empty message');
  assert.ok(empty.text.includes('No active faction projects are available.'), 'no faction projects must show the empty message');
  assert.ok(empty.text.includes('No locked capability records are available.'), 'no locked capabilities must show the empty message');

  const message = await tryBoardOnPage(page, 'renderResearchWatchlist', undefined);
  assert.match(message, /observerFactionId/, 'an absent snapshot must throw on the unguarded observerFactionId dereference');
});