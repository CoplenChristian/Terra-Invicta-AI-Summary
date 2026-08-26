// tests/factionIntelRendering.test.js
//
// Purpose: characterisation coverage for
//   src/v2/panels/FactionIntel.jsx. The dossier is an overlay fed
//   when opened; these tests pin its visible records, mode-specific
//   redaction, controller selection, and close cleanup after the React
//   migration.
//
// ENTRY-POINT CONTRACT (confirmed against public/v2/index.html call sites):
//   window.FactionIntelScreen = { render }
//   render(container, snapshot, briefing, observerId) mounts the dossier into
//     container and returns a controller with { select, getSelectedFaction,
//     getSelectedId, destroy }.
//
// Harness: real browser via tests/fixtures/factionIntelBrowser.js and
//   public/v2/primitives-harness.html?scene=factionIntel. The scene renders
//   <FactionIntel controller={...} /> and publishes that controller on
//   window.__FACTION_INTEL_CONTROLLER__, so select / getSelectedId / destroy
//   below drive the real production controller, not a test double.
//
//   `node --test` cannot render a React component out of the Vite bundle
//   (Minified React error #327), which is why every assertion here runs in a
//   real browser rather than against a mock DOM.
//
// MODE LABELS:
//   - 'player'      -> 'PLAYER INTEL' + 'OBSERVER' + 'VISIBLE' / 'PARTIAL'
//   - 'omniscient'  -> 'OMNISCIENT'  + 'RAW SAVE ONLY'
//   - 'enhanced'    -> 'ENHANCED'    + 'ENHANCED'
//   - any other     -> normalizeVisibility(raw) | 'UNKNOWN VIEW'
//
// NULLABLE MAP (every no-data affordance, with the input that produces it):
//   'UNAVAILABLE' (literal, from UNKNOWN_VALUE constant):
//     - metricValue(...) when hasMetricValue(value) is false (every metric in
//       relationshipMetrics / powerMetrics / earth.metrics / space.metrics /
//       research.metrics) — this is the load-bearing one
//     - buildHeader OBSERVER meta when observer faction is missing
//     - councilor name / location when firstValue returns undefined
//     - formatPower when power is null
//     - getFactionName when no displayName / name / factionName / templateName
//     - cleanRelationshipValue when value is null / blank / one of
//       MISSING_VALUES labels ('UNAVAILABLE', 'UNKNOWN', 'N/A', 'NA', 'NULL')
//     - councilorTopSkill when no measurable maskedAttributes / attributes
//   'UNKNOWN' (literal, from UNKNOWN_RELATIONSHIP constant):
//     - getFactionName when no name fields
//     - relationshipMetrics Summary when neither theirs nor ours is present
//     - displayRelationship when value is null / undefined
//     - getMode when mode field is missing entirely (returns 'UNKNOWN VIEW')
//   Visibility-tag normalization (normalizeVisibility) maps:
//     raw_save_only / raw_save -> 'RAW SAVE ONLY'
//     unavailable -> 'UNAVAILABLE'
//     unknown -> 'UNKNOWN'
//     partial -> 'PARTIAL'
//     estimated -> 'ESTIMATED'
//     confirmed -> 'CONFIRMED'
//     visible / available -> 'VISIBLE'
//     enhanced -> 'ENHANCED'
//     snapshot_flag -> 'SNAPSHOT FLAG'
//     anything else (after trim+upper) -> upper-cased literal
//   Visibility tags on the detail pane:
//     - RELATION (relationship.visibility)
//     - HATE OF US (theirsVisibility) — observer-relative only, hidden for observer
//     - OUR HATE (oursVisibility) — observer-relative only, hidden for observer
//     - ALIEN HATE (hate.visibility)
//     - EARTH (earth.visibility)
//     - SPACE (space.visibility)
//     - RESEARCH (research.visibility)
//     - VISIBILITY (for power, from visibilityForPower)
//   Councilor row affordances (councilorRowFields):
//     - name null -> 'UNAVAILABLE' (UNKNOWN_VALUE)
//     - location null -> 'UNAVAILABLE'
//     - profession null -> 'Councilor' literal fallback
//     - mission null -> 'No active mission' literal fallback
//     - skill measurable -> 'SKILL / ABBR value'
//     - skill no source -> 'SKILL / UNAVAILABLE'
//     - status normalizeVisibility('unknown') -> 'UNKNOWN' when no value
//   Councilor visibility (councilorVisibility):
//     - mode === 'OMNISCIENT' -> 'RAW SAVE ONLY'
//     - observer faction -> 'CONFIRMED'
//     - any councilor.visibility === 'detected' -> 'PARTIAL'
//     - any councilor.isTurnedMole === true -> 'CONFIRMED'
//     - otherwise: 'VISIBLE' if councilors.length > 0 else 'UNAVAILABLE'
//   Action-plan affordances (deriveActions):
//     - observer: research throughput / terrestrial / space branches
//     - non-observer: relationship / terrestrial / space branches
//     - always: hate branch with requiredProject vs visible signal
//     - 4 actions max (slice(0, 4))
//   Empty / absent states:
//     - factions = []           -> 'No selectable factions were supplied.'
//     - absent snapshot         -> 'No faction data is present in the current snapshot.'
//     - no faction selected     -> 'No faction is selected.'
//     - councilors.length === 0 -> 'No councilors are visible for this faction
//                                   in the current intelligence mode.'
//     - default note (no visibilityNote, no hate.note) -> 'Data discipline'
//   Notes:
//     - faction.visibilityNote present -> 'Visibility note' note
//     - hate.note present (when hate requiredProject) -> 'Alien-hate access' note
//     - neither present -> default 'Data discipline' note
//
// RED PROOF (2026-08-26, re-run after the React migration): replaced the
//   explicit-declaration guard in visibilityForMetric
//   (src/v2/panels/factionIntelUtils.js) with the pre-fix
//   `hasMetricValue(explicit.value)` — i.e. deliberately reopened live-defect
//   #11. The run went 35 pass / 1 fail: 'EARTH visibility tag respects an
//   explicit UNAVAILABLE / UNKNOWN / VISIBLE declaration' failed on
//   "declared earthVisibility: 'unavailable' must surface as EARTH UNAVAILABLE,
//   NOT EARTH VISIBLE", with the dumped render showing EARTH VISIBLE on a
//   faction whose snapshot declared the opposite. Restoring isExplicitlyEmpty
//   returned all 36 to green. That one test is the only guard on #11 — do not
//   weaken it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  withFactionIntelHarnessPage,
  getHarnessText,
  selectFaction,
  getSelectedId,
  destroyController,
  harnessChildCount,
  installSelectionRecorder,
  readSelections,
  fetchCalls,
} = require('./fixtures/factionIntelBrowser');
const { loadFixtureFilteredSnapshot } = require('./fixtures/frozenSnapshots');

const repoRoot = path.resolve(__dirname, '..');
const shellPath = path.join(repoRoot, 'public', 'v2', 'index.html');

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

/**
 * Mounts the dossier and hands the page to `run`. The vanilla suite stubbed a
 * fetch seam here; the browser fixture installs a fetch spy instead, so
 * "never reaches the network" is still an assertion rather than an assumption.
 */
function renderFaction(snapshot, observerId = 4712, run) {
  return withFactionIntelHarnessPage({ snapshot, briefing: null, observerId }, run);
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
 * A fully-measured faction dossier snapshot. Three factions (observer +
 * rival + alien), full councilor rosters, full telemetry on every metric,
 * and complete relationship data. Nulling one field at a time produces a
 * render in which the unavailable token sits among measured neighbours.
 */
function measuredFactionDossierSnapshot(overrides = {}) {
  const base = {
    mode: 'player',
    observerFactionId: 4712,
    metadata: { gameTimeString: 'MEASURED INPUT' },
    factions: [
      {
        ID: 4712,
        displayName: 'the Initiative',
        color: '#ff0000',
        controlPointsCount: 24,
        totalGdp: 45000000000000,
        totalPopulation: 1850.5,
        powerScore: { overall: 70, earthEconomy: 80, earthPolitics: 75, research: 65, spaceEconomy: 55, fleet: 40, military: 30, isEstimate: true },
        totalResearch: 950,
        completedProjects: ['Project_Solid-FuelSpaceRockets'],
        currentProjects: [{ displayName: 'Project_Cryogenic', percent: 30 }],
        availableProjectsCount: 12,
        combatPower: 2400,
        combatPowerAvailable: true,
        earthVisibility: 'visible',
        spaceVisibility: 'visible',
        researchVisibility: 'visible',
        powerVisibility: 'visible',
        alienHate: { visibility: 'visible', actual: 12.5, visibleEstimate: '■■■□□', requiredProject: null }
      },
      {
        ID: 4713,
        displayName: 'the Servants',
        color: '#800080',
        controlPointsCount: 18,
        nationsCount: 12,
        totalGdp: 22000000000000,
        totalPopulation: 1200.0,
        powerScore: { overall: 35, earthEconomy: 40, earthPolitics: 50, research: 30, spaceEconomy: 25, fleet: 20, military: 15 },
        totalResearch: 420,
        completedProjects: ['Project_Solid-FuelSpaceRockets'],
        currentProjects: [],
        availableProjectsCount: 8,
        habsCount: 2,
        fleetsCount: 1,
        shipsCount: 3,
        combatPower: 1200,
        combatPowerAvailable: true,
        earthVisibility: 'visible',
        spaceVisibility: 'visible',
        researchVisibility: 'visible',
        powerVisibility: 'visible',
        alienHate: { visibility: 'visible', actual: 7.8, visibleEstimate: '■■□□□', requiredProject: null }
      },
      {
        ID: 4717,
        displayName: 'the Aliens',
        color: '#00ff00',
        controlPointsCount: 9,
        totalGdp: 0,
        totalPopulation: 0,
        powerScore: { overall: 50, earthEconomy: 10, earthPolitics: 5, research: 90, spaceEconomy: 80, fleet: 70, military: 95 },
        totalResearch: 2200,
        completedProjects: ['Project_LifeScienceLab'],
        currentProjects: [],
        availableProjectsCount: 2,
        combatPower: 5400,
        combatPowerAvailable: true,
        earthVisibility: 'unavailable',
        spaceVisibility: 'unavailable',
        researchVisibility: 'raw_save_only',
        powerVisibility: 'raw_save_only',
        alienHate: { visibility: 'raw_save_only', actual: 42.65, playerVisible: false }
      }
    ],
    factionRelationships: [
      { sourceFactionId: 4713, targetFactionId: 4712, hate: 4.5, relationship: 'HATE 4.50', visibility: 'observer faction telemetry' },
      { sourceFactionId: 4712, targetFactionId: 4713, hate: 2.1, relationship: 'HATE 2.10', visibility: 'observer faction telemetry' },
      { sourceFactionId: 4717, targetFactionId: 4712, hate: 42.65, relationship: 'HATE 42.65', visibility: 'observer faction telemetry' },
      { sourceFactionId: 4712, targetFactionId: 4717, hate: 0, relationship: 'HATE 0.00', visibility: 'observer faction telemetry' }
    ],
    councilors: [
      {
        ID: 100,
        factionId: 4712,
        displayName: 'Director Hayes',
        typeTemplateName: 'Administrator',
        locationName: 'Earth',
        activeMissionName: 'Observe the council',
        activeMissionTarget: null,
        status: 'Active',
        totalSkills: 18,
        visibility: 'visible',
        maskedAttributes: {
          Administration: { visible: 7 },
          Persuasion: { visible: 5 },
          Investigation: { visible: 4 },
          Espionage: { visible: 3 },
          Command: { visible: 4 },
          Science: { visible: 5 },
          Security: { visible: 4 }
        }
      },
      {
        ID: 200,
        factionId: 4713,
        displayName: 'Prophet Vance',
        typeTemplateName: 'Propagandist',
        locationName: 'United States',
        activeMissionName: 'Spread the word',
        status: 'Active',
        totalSkills: 14,
        visibility: 'detected',
        maskedAttributes: {
          Administration: { visible: 4 },
          Persuasion: { visible: 8 },
          Espionage: { visible: 5 }
        }
      },
      {
        ID: 300,
        factionId: 4717,
        displayName: 'Alien Overseer',
        typeTemplateName: 'HiveCoordinator',
        locationName: 'Mars',
        activeMissionName: 'Observe humanity',
        status: 'Active',
        totalSkills: 22,
        isAlien: true,
        visibility: 'raw_save_only',
        attributes: {
          Administration: 8, Persuasion: 6, Investigation: 9,
          Espionage: 7, Command: 10, Science: 9, Security: 8
        }
      }
    ]
  };
  for (const key of Object.keys(overrides)) {
    base[key] = overrides[key];
  }
  return base;
}

// ---------------------------------------------------------------------------
// Normal render: both modes, including the open-time fetch seam.
// ---------------------------------------------------------------------------

test('faction dossier renders the normal player snapshot without reaching the network', async () => {
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'player' });

  await renderFaction(snapshot, 4712, async (page) => {
    const text = await getHarnessText(page);

    assert.strictEqual((await fetchCalls(page)).length, 0, 'the open-time fetch seam must be stubbed, never sent to the network by the unit test');
    assert.ok(text.includes('Faction intelligence'));
    assert.ok(text.includes('PLAYER INTEL'));
    assert.ok(text.includes('the Initiative'));
    assert.ok(text.includes('Faction roster'));
    assert.ok(text.includes('Earth footprint'));
    assert.ok(text.includes('Space posture'));
    assert.ok(text.includes('Research posture'));
    assert.ok(text.includes('Councilor roster'));
    assert.ok(text.includes('Plan of action'));
    assert.strictEqual(await getSelectedId(page), 4712);
  });
});

test('faction dossier renders the omniscient snapshot and an alien faction selection', async () => {
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'omniscient' });
  const alien = firstAlien(snapshot);
  assert.ok(alien, 'the frozen omniscient fixture must contain an alien councilor');

  await renderFaction(snapshot, 4712, async (page) => {
    assert.ok(await selectFaction(page, 4717));
    const text = await getHarnessText(page);

    assert.ok(text.includes('OMNISCIENT'));
    assert.ok(text.includes('the Aliens'));
    assert.ok(text.includes(alien.displayName));
    assert.ok(text.includes('ALIEN HATE'));
    assert.ok(text.includes('RAW SAVE ONLY'));
    assert.strictEqual(await getSelectedId(page), 4717);
  });
});

// ---------------------------------------------------------------------------
// Player redaction: maskedAttributes is the visible source for rivals.
// ---------------------------------------------------------------------------

test('faction dossier keeps an observed enemy councilor in player mode', async () => {
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'player' });
  const target = firstObservedEnemy(snapshot);
  assert.ok(target, 'the frozen player fixture must contain an observed enemy');
  assert.equal(target.attributes, undefined, 'the raw enemy attributes must be absent in player mode');

  await renderFaction(snapshot, 4712, async (page) => {
    assert.ok(await selectFaction(page, target.factionId));
    const text = await getHarnessText(page);

    assert.ok(text.includes(target.displayName), 'an attributes-only filter would silently drop this player-visible councilor');
    assert.ok(text.includes(expectedMaskedTopSkill(target)), 'the dossier must read the visible skill from maskedAttributes');
  });
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

test('faction dossier renders UNAVAILABLE when faction metrics are not measured', async () => {
  await renderFaction(sparseSnapshot(), 4712, async (page) => {
    const text = await getHarnessText(page);
    assert.ok(text.includes('UNAVAILABLE'), 'missing hate, power, Earth, space, and research metrics must remain UNAVAILABLE');
  });
});

test('faction dossier renders UNKNOWN for an unmeasured relationship', async () => {
  await renderFaction(sparseSnapshot(), 4712, async (page) => {
    const text = await getHarnessText(page);
    assert.ok(text.includes('UNKNOWN'), 'an absent observer-relative relationship must remain UNKNOWN');
  });
});

test('faction dossier preserves an explicit em dash visibility marker', async () => {
  const snapshot = sparseSnapshot();
  snapshot.factions[0].earthVisibility = '—';
  await renderFaction(snapshot, 4712, async (page) => {
    const text = await getHarnessText(page);
    assert.ok(text.includes('EARTH —'), 'an explicitly unmeasured visibility marker must remain an em dash');
  });
});

test('faction dossier empty and absent inputs remain distinct', async () => {
  await renderFaction({ mode: 'player', factions: [], councilors: [] }, 4712, async (page) => {
    const text = await getHarnessText(page);
    assert.ok(text.includes('No selectable factions were supplied.'));
    assert.ok(text.includes('0 entries'));
  });

  await renderFaction(undefined, 4712, async (page) => {
    const text = await getHarnessText(page);
    assert.ok(text.includes('No faction data is present in the current snapshot.'));
    assert.ok(text.includes('No selectable factions were supplied.'));
  });
});

// ---------------------------------------------------------------------------
// Selection, open/close mount contract, and no silent list loss.
// ---------------------------------------------------------------------------

test('faction selection emits the selected record and destroy closes the overlay mount', async () => {
  const snapshot = loadFixtureFilteredSnapshot({ mode: 'omniscient' });

  await renderFaction(snapshot, 4712, async (page) => {
    await installSelectionRecorder(page);

    assert.ok(await selectFaction(page, 4717));
    const { handoffs } = await readSelections(page);
    assert.strictEqual(handoffs.length, 1);
    assert.strictEqual(handoffs[0].factionId, 4717);
    assert.strictEqual(handoffs[0].observerId, 4712);
    assert.strictEqual(await getSelectedId(page), 4717);

    await destroyController(page);
    assert.strictEqual(await harnessChildCount(page), 0, 'destroy must remove the dossier shell from the overlay mount');
    await destroyController(page);
    assert.strictEqual(await harnessChildCount(page), 0, 'destroy must be idempotent');
  });
});

test('faction dossier overlay has open mount and close controls in the shipped shell', async () => {
  const shell = fs.readFileSync(shellPath, 'utf8');
  assert.match(shell, /id="openFactionIntelBtn"/);
  assert.match(shell, /id="closeFactionIntelBtn"/);
  assert.match(shell, /data-faction-intel-close/);
  assert.match(shell, /id="factionIntelRoot"/);

  await renderFaction(loadFixtureFilteredSnapshot({ mode: 'player' }), 4712, async (page) => {
    const marker = await page.evaluate(() => {
      const el = document.querySelector('[data-faction-intel-component="true"]');
      return el ? el.getAttribute('data-faction-intel-component') : null;
    });
    assert.strictEqual(marker, 'true');
  });
});

// ---------------------------------------------------------------------------
// Per-metric nullable assertions. Each test nulls ONE metric and asserts the
// unavailable affordance appears for it while its measured neighbours remain.
// ---------------------------------------------------------------------------

const RIVAL = 4713;

async function renderRival(snap) {
  const text = await renderFaction(snap, 4712, async (page) => {
    assert.ok(await selectFaction(page, RIVAL), `controller.select(${RIVAL}) must succeed`);
    return getHarnessText(page);
  });
  return { text };
}

test('null Hate of us leaves Our hate measured and Summary tracking', async () => {
  const snap = measuredFactionDossierSnapshot();
  setPath(snap, ['factionRelationships', 0, 'relationship'], null);
  const { text } = await renderRival(snap);
  assert.ok(text.includes('Hate of us UNAVAILABLE'), 'the incoming relationship reads UNAVAILABLE');
  assert.ok(text.includes('Our hate 2.10'), 'the outgoing relationship stays measured');
  assert.ok(text.includes('Summary ONE DIRECTION RECORDED'), 'Summary reflects the remaining direction');
  assertNoRuntimePlaceholders(text, 'Hate of us null');
});

test('null Our hate leaves Hate of us measured', async () => {
  const snap = measuredFactionDossierSnapshot();
  setPath(snap, ['factionRelationships', 1, 'relationship'], null);
  const { text } = await renderRival(snap);
  assert.ok(text.includes('Our hate UNAVAILABLE'));
  assert.ok(text.includes('Hate of us 4.50'));
  assert.ok(text.includes('Summary ONE DIRECTION RECORDED'));
  assertNoRuntimePlaceholders(text, 'Our hate null');
});

test('null both directions yields Summary UNKNOWN and two UNAVAILABLE rows', async () => {
  const snap = measuredFactionDossierSnapshot();
  setPath(snap, ['factionRelationships', 0, 'relationship'], null);
  setPath(snap, ['factionRelationships', 1, 'relationship'], null);
  const { text } = await renderRival(snap);
  assert.ok(text.includes('Hate of us UNAVAILABLE'));
  assert.ok(text.includes('Our hate UNAVAILABLE'));
  assert.ok(text.includes('Summary UNKNOWN'), 'both null -> Summary UNKNOWN');
  assertNoRuntimePlaceholders(text, 'both relationships null');
});

test('null Composite score estimate leaves Military score measured', async () => {
  const snap = measuredFactionDossierSnapshot();
  setPath(snap, ['factions', 1, 'powerScore', 'overall'], null);
  const { text } = await renderRival(snap);
  assert.ok(text.includes('Composite score estimate UNAVAILABLE'));
  assert.ok(text.includes('Military score 15 / 100'));
  assertNoRuntimePlaceholders(text, 'Composite null');
});

test('null Military score leaves Composite score estimate measured', async () => {
  const snap = measuredFactionDossierSnapshot();
  setPath(snap, ['factions', 1, 'powerScore', 'military'], null);
  const { text } = await renderRival(snap);
  assert.ok(text.includes('Military score UNAVAILABLE'));
  assert.ok(text.includes('Composite score estimate 35 / 100'));
  assertNoRuntimePlaceholders(text, 'Military null');
});

test('null powerScore entirely makes Estimated read UNAVAILABLE', async () => {
  const snap = measuredFactionDossierSnapshot();
  setPath(snap, ['factions', 1, 'powerScore'], null);
  const { text } = await renderRival(snap);
  assert.ok(text.includes('Estimated UNAVAILABLE'), 'a null powerScore cannot default Estimated to NO');
  assert.ok(text.includes('Composite score estimate UNAVAILABLE'));
  assertNoRuntimePlaceholders(text, 'powerScore null');
});

test('null Control points leaves Nations and GDP measured', async () => {
  const snap = measuredFactionDossierSnapshot();
  setPath(snap, ['factions', 1, 'controlPointsCount'], null);
  const { text } = await renderRival(snap);
  assert.ok(text.includes('Control points UNAVAILABLE'));
  assert.ok(text.includes('GDP $22T'));
  assert.ok(text.includes('Population 1,200'));
  assertNoRuntimePlaceholders(text, 'Control points null');
});

test('null GDP leaves Control points and Population measured', async () => {
  const snap = measuredFactionDossierSnapshot();
  setPath(snap, ['factions', 1, 'totalGdp'], null);
  const { text } = await renderRival(snap);
  assert.ok(text.includes('GDP UNAVAILABLE'));
  assert.ok(text.includes('Control points 18'));
  assert.ok(text.includes('Population 1,200'));
  assertNoRuntimePlaceholders(text, 'GDP null');
});

test('null Population leaves GDP and Economy score measured', async () => {
  const snap = measuredFactionDossierSnapshot();
  setPath(snap, ['factions', 1, 'totalPopulation'], null);
  const { text } = await renderRival(snap);
  assert.ok(text.includes('Population UNAVAILABLE'));
  assert.ok(text.includes('GDP $22T'));
  assert.ok(text.includes('Economy score 40 / 100'));
  assertNoRuntimePlaceholders(text, 'Population null');
});

test('null Economy score leaves Politics score measured', async () => {
  const snap = measuredFactionDossierSnapshot();
  setPath(snap, ['factions', 1, 'powerScore', 'earthEconomy'], null);
  const { text } = await renderRival(snap);
  assert.ok(text.includes('Economy score UNAVAILABLE'));
  assert.ok(text.includes('Politics score 50 / 100'));
  assertNoRuntimePlaceholders(text, 'Economy score null');
});

test('null Politics score leaves Economy score measured', async () => {
  const snap = measuredFactionDossierSnapshot();
  setPath(snap, ['factions', 1, 'powerScore', 'earthPolitics'], null);
  const { text } = await renderRival(snap);
  assert.ok(text.includes('Politics score UNAVAILABLE'));
  assert.ok(text.includes('Economy score 40 / 100'));
  assertNoRuntimePlaceholders(text, 'Politics score null');
});

test('null Habs leaves Fleets and Ships measured', async () => {
  const snap = measuredFactionDossierSnapshot();
  setPath(snap, ['factions', 1, 'habsCount'], null);
  const { text } = await renderRival(snap);
  assert.ok(text.includes('Habs / stations UNAVAILABLE'));
  assert.ok(text.includes('Fleets 1'));
  assert.ok(text.includes('Ships 3'));
  assertNoRuntimePlaceholders(text, 'Habs null');
});

test('null Ships leaves Combat power and Space score measured', async () => {
  const snap = measuredFactionDossierSnapshot();
  setPath(snap, ['factions', 1, 'shipsCount'], null);
  const { text } = await renderRival(snap);
  assert.ok(text.includes('Ships UNAVAILABLE'));
  assert.ok(text.includes('Combat power 1,200'));
  assert.ok(text.includes('Space score 25 / 100'));
  assertNoRuntimePlaceholders(text, 'Ships null');
});

test('null Combat power leaves Ships and Fleet score measured', async () => {
  const snap = measuredFactionDossierSnapshot();
  setPath(snap, ['factions', 1, 'combatPowerAvailable'], false);
  const { text } = await renderRival(snap);
  assert.ok(text.includes('Combat power UNAVAILABLE'));
  assert.ok(text.includes('Ships 3'));
  assert.ok(text.includes('Fleet score 20 / 100'));
  assertNoRuntimePlaceholders(text, 'Combat power null');
});

test('null Space score leaves Fleet score measured', async () => {
  const snap = measuredFactionDossierSnapshot();
  setPath(snap, ['factions', 1, 'powerScore', 'spaceEconomy'], null);
  const { text } = await renderRival(snap);
  assert.ok(text.includes('Space score UNAVAILABLE'));
  assert.ok(text.includes('Fleet score 20 / 100'));
  assertNoRuntimePlaceholders(text, 'Space score null');
});

test('null Research output leaves Projects listed and Available projects measured', async () => {
  const snap = measuredFactionDossierSnapshot();
  setPath(snap, ['factions', 1, 'totalResearch'], null);
  const { text } = await renderRival(snap);
  assert.ok(text.includes('Research output UNAVAILABLE'));
  assert.ok(text.includes('Projects listed 1 listed'));
  assert.ok(text.includes('Available projects 8'));
  assertNoRuntimePlaceholders(text, 'Research output null');
});

test('null Projects listed leaves Research output measured', async () => {
  const snap = measuredFactionDossierSnapshot();
  setPath(snap, ['factions', 1, 'completedProjects'], null);
  const { text } = await renderRival(snap);
  assert.ok(text.includes('Projects listed UNAVAILABLE'));
  assert.ok(text.includes('Research output 420 / cycle'));
  assertNoRuntimePlaceholders(text, 'Projects listed null');
});

test('null Available projects leaves Active projects listed measured', async () => {
  const snap = measuredFactionDossierSnapshot();
  setPath(snap, ['factions', 1, 'availableProjectsCount'], null);
  const { text } = await renderRival(snap);
  assert.ok(text.includes('Available projects UNAVAILABLE'));
  assert.ok(text.includes('Active projects listed 0'));
  assertNoRuntimePlaceholders(text, 'Available projects null');
});

// ---------------------------------------------------------------------------
// Councilor row: each null field produces a distinct visible affordance.
// ---------------------------------------------------------------------------

test('null councilor displayName renders UNAVAILABLE while location stays measured', async () => {
  const snap = measuredFactionDossierSnapshot();
  setPath(snap, ['councilors', 1, 'displayName'], null);
  const { text } = await renderRival(snap);
  assert.ok(text.includes('UNAVAILABLE'));
  assert.ok(text.includes('LOCATION / United States'));
  assertNoRuntimePlaceholders(text, 'councilor name null');
});

test('null councilor locationName renders LOCATION / UNAVAILABLE while name stays measured', async () => {
  const snap = measuredFactionDossierSnapshot();
  setPath(snap, ['councilors', 1, 'locationName'], null);
  const { text } = await renderRival(snap);
  assert.ok(text.includes('LOCATION / UNAVAILABLE'));
  assert.ok(text.includes('Prophet Vance'));
  assertNoRuntimePlaceholders(text, 'councilor location null');
});

test('null councilor activeMissionName renders the No active mission fallback', async () => {
  const snap = measuredFactionDossierSnapshot();
  setPath(snap, ['councilors', 1, 'activeMissionName'], null);
  const { text } = await renderRival(snap);
  assert.ok(text.includes('MISSION / No active mission'));
  assert.ok(text.includes('Prophet Vance'));
  assertNoRuntimePlaceholders(text, 'councilor mission null');
});

test('null councilor maskedAttributes renders SKILL / UNAVAILABLE', async () => {
  const snap = measuredFactionDossierSnapshot();
  setPath(snap, ['councilors', 1, 'maskedAttributes'], null);
  const { text } = await renderRival(snap);
  assert.ok(text.includes('SKILL / UNAVAILABLE'));
  assert.ok(text.includes('Prophet Vance'));
  assertNoRuntimePlaceholders(text, 'councilor skill null');
});

// ---------------------------------------------------------------------------
// Partial render: several metrics measured and several null in the same
// render. The dossier must not collapse to the absent-input banner.
// ---------------------------------------------------------------------------

test('partial render keeps measured values beside independently absent values in the same render', async () => {
  const snap = measuredFactionDossierSnapshot();
  setPath(snap, ['factionRelationships', 0, 'hate'], null);
  setPath(snap, ['factions', 1, 'controlPointsCount'], null);
  setPath(snap, ['factions', 1, 'shipsCount'], null);
  setPath(snap, ['factions', 1, 'totalResearch'], null);
  setPath(snap, ['factions', 1, 'powerScore', 'overall'], null);
  const { text } = await renderRival(snap);
  assertIncludesAll(text, [
    'Hate of us 4.50',
    'Our hate 2.10',
    'Control points UNAVAILABLE',
    'GDP $22T',
    'Ships UNAVAILABLE',
    'Combat power 1,200',
    'Research output UNAVAILABLE',
    'Available projects 8',
    'Composite score estimate UNAVAILABLE',
    'Military score 15 / 100'
  ], 'mixed measured/unavailable render');
  assert.ok(!text.includes('No faction data is present'), 'partial data must not collapse to the absent banner');
  assertNoRuntimePlaceholders(text, 'partial render');
});

// ---------------------------------------------------------------------------
// Visibility tag surface: enumerated per normalizeVisibility mapping.
// ---------------------------------------------------------------------------

test('RELATION visibility tag reads UNAVAILABLE when both relationship entries are missing', async () => {
  const snap = measuredFactionDossierSnapshot();
  for (const idx of [0, 1]) setPath(snap, ['factionRelationships', idx, 'hate'], null);
  const { text } = await renderRival(snap);
  assert.ok(text.includes('RELATION OBSERVER FACTION TELEMETRY'));
  assert.ok(text.includes('HATE OF US OBSERVER FACTION TELEMETRY'));
  assert.ok(text.includes('OUR HATE OBSERVER FACTION TELEMETRY'));
  assertNoRuntimePlaceholders(text, 'RELATION UNAVAILABLE');
});

test('EARTH visibility tag respects an explicit UNAVAILABLE / UNKNOWN / VISIBLE declaration', async () => {
  // The dossier used to read `if (explicit.found && hasMetricValue(explicit.value))`
  // for the EARTH / SPACE / RESEARCH / VISIBILITY tags. Because MISSING_VALUES
  // contains both 'UNAVAILABLE' and 'UNKNOWN', any value that uppercased to
  // either of those strings failed the guard and fell through to the
  // data-inference branch — meaning an explicit earthVisibility: 'unavailable'
  // (or 'UNAVAILABLE') rendered as EARTH VISIBLE on a faction that had
  // earth metrics. That inverted an explicit negative into a positive claim.
  // The fix routes the guard through isExplicitlyEmpty so only truly absent
  // or empty-string values fall back; every declared string (including the
  // UNAVAILABLE / UNKNOWN sentinels) is normalised and shown. Three classes
  // must remain under test: a positive declared label, a declared UNAVAILABLE
  // sentinel (the bug case), and a declared UNKNOWN sentinel.
  for (const [raw, label] of [
    ['visible', 'VISIBLE'],
    ['partial', 'PARTIAL'],
    ['confirmed', 'CONFIRMED'],
    ['available', 'AVAILABLE'],
    ['enhanced', 'ENHANCED']
  ]) {
    const snap = measuredFactionDossierSnapshot();
    snap.factions[1].earthVisibility = raw;
    const { text } = await renderRival(snap);
    assert.ok(text.includes(`EARTH ${label}`),
      `declared earthVisibility: '${raw}' must surface as EARTH ${label}\n${text}`);
  }

  // Explicit UNAVAILABLE — bug case. Used to read 'EARTH VISIBLE' because the
  // 'unavailable' string uppercased into the MISSING_VALUES set and the guard
  // treated it as "no declaration", then fell through to VISIBLE on a faction
  // with earth data. After the fix, normalizeVisibility('unavailable') returns
  // 'UNAVAILABLE' and the EARTH tag surfaces that exactly. Both lowercase and
  // uppercase spellings of the sentinel must take the same path.
  for (const raw of ['unavailable', 'UNAVAILABLE']) {
    const snap = measuredFactionDossierSnapshot();
    snap.factions[1].earthVisibility = raw;
    const { text } = await renderRival(snap);
    assert.ok(text.includes('EARTH UNAVAILABLE'),
      `declared earthVisibility: '${raw}' must surface as EARTH UNAVAILABLE, NOT EARTH VISIBLE\n${text}`);
    assert.ok(!text.match(/EARTH VISIBLE/),
      `declared earthVisibility: '${raw}' must NOT render as EARTH VISIBLE\n${text}`);
  }

  // Explicit UNKNOWN — same family. The fix routes both sentinels through
  // normalizeVisibility, which already maps 'unknown' to 'UNKNOWN'.
  for (const raw of ['unknown', 'UNKNOWN']) {
    const snap = measuredFactionDossierSnapshot();
    snap.factions[1].earthVisibility = raw;
    const { text } = await renderRival(snap);
    assert.ok(text.includes('EARTH UNKNOWN'),
      `declared earthVisibility: '${raw}' must surface as EARTH UNKNOWN, NOT EARTH VISIBLE\n${text}`);
    assert.ok(!text.match(/EARTH VISIBLE/),
      `declared earthVisibility: '${raw}' must NOT render as EARTH VISIBLE\n${text}`);
  }

  // Distinct from the explicit-sentinel case: a faction with earth data but
  // no declared earthVisibility field at all still falls through to the
  // data-inference branch and reads EARTH VISIBLE (the legacy behaviour for
  // absent declarations, not the bug). This is the regression guard for the
  // other side of the change — make sure the fix did not over-correct and
  // start rendering truly absent declarations as UNAVAILABLE.
  const snap = measuredFactionDossierSnapshot();
  delete snap.factions[1].earthVisibility;
  const { text } = await renderRival(snap);
  assert.ok(text.includes('EARTH VISIBLE'),
    `an absent earthVisibility on a faction with earth data must still fall back to EARTH VISIBLE\n${text}`);
});

// ---------------------------------------------------------------------------
// Action-plan branches: observer vs non-observer take distinct paths.
// ---------------------------------------------------------------------------

test('observer action plan reacts to a null alien-hate value with the requiredProject branch', async () => {
  const snap = measuredFactionDossierSnapshot();
  setPath(snap, ['factions', 0, 'alienHate'], { visibility: 'unavailable', value: null, requiredProject: 'Project_TheirOperations', playerVisible: false });
  await renderFaction(snap, 4712, async (page) => {
    assert.strictEqual(await getSelectedId(page), 4712);
    const text = await getHarnessText(page);
    assert.ok(text.includes('Alien-hate access'), 'a null alien-hate with requiredProject triggers the hate note');
    assert.ok(text.includes('Project_TheirOperations'), 'the requiredProject must surface in the plan');
    assert.ok(!text.includes('Treat alien-hate posture as unknown'));
    assertNoRuntimePlaceholders(text, 'hate requiredProject');
  });
});

test('non-observer action plan keeps the surveillance wording and surfaces relationship posture', async () => {
  const snap = measuredFactionDossierSnapshot();
  await renderFaction(snap, 4712, async (page) => {
    assert.ok(await selectFaction(page, RIVAL));
    const text = await getHarnessText(page);
    assert.ok(text.includes('Plan of action'));
    assert.ok(/surveillance|relationship|Hate of us/i.test(text), 'non-observer branch surfaces relationship / surveillance text');
    assertNoRuntimePlaceholders(text, 'non-observer plan');
  });
});
