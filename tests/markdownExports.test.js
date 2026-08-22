// tests/markdownExports.test.js
//
// Validation test suite for model-facing markdown exports:
//   * /latest-threats.md   (< 10 KB, immediate tactical danger)
//   * /latest-war-room.md  (20-30 KB, comprehensive military/economic brief)
//   * /latest-snapshot.md  (byte-identical to pre-refactor baseline)
//
// Tests all 8 acceptance criteria from docs/archive/markdown-export-plan.md.
//
// Live-save independence (docs/archive/live-save-test-dependency-spec.md):
//   * The byte-identical snapshot test is a VALUE assertion, so it reads a
//     committed, mechanically-trimmed fixture (tests/fixtures/snapshot-*.json,
//     derived by scripts/derive_snapshot_fixtures.js), never the live save.
//   * The size ceilings and rendering behaviour are PROPERTY assertions --
//     "output satisfies a bound" -- so they run against a synthetic snapshot
//     (tests/fixtures/syntheticMarkdownSnapshot.js) whose volume is grown by
//     cloning fleets. A bound is not a value, so synthetic data is safe here,
//     and it states its own preconditions.
//   * The one remaining HTTP smoke test reads the live save but skips cleanly
//     when no save is available; it must never fail on live-save state.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');

const { loadFilteredSnapshot } = require('../server/snapshotLoader');
const exportGenerator = require('../server/exportGenerator');
const app = require('../server');
const { makeMarkdownSnapshot, OBSERVER_ID } = require('./fixtures/syntheticMarkdownSnapshot');
const {
  renderThreatsMarkdown,
  renderWarRoomMarkdown,
  renderCompactSnapshotMarkdown
} = require('../shared/markdownExports.mjs');

const FROZEN_PLAYER_PATH = path.join(__dirname, 'fixtures', 'frozen-snapshot-player.md');
const FROZEN_OMNI_PATH = path.join(__dirname, 'fixtures', 'frozen-snapshot-omni.md');
const PLAYER_FIXTURE_PATH = path.join(__dirname, 'fixtures', 'snapshot-player.json');
const OMNI_FIXTURE_PATH = path.join(__dirname, 'fixtures', 'snapshot-omniscient.json');

// Load a committed fixture, stripping the provenance header the derive script
// attaches (it is metadata about the fixture, not snapshot data).
function loadFixture(filePath) {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  delete data.provenance;
  return data;
}

// ---------------------------------------------------------------------------
// 1. CEILING & FLOOR SIZES (INCLUDING SECTION 3 SUB-8KB CONSTRAINT)
// ---------------------------------------------------------------------------
test('export sizes meet ceiling and floor constraints on the synthetic snapshot', () => {
  const playerSnap = makeMarkdownSnapshot('player');
  const omniSnap = makeMarkdownSnapshot('omniscient');

  const playerThreats = exportGenerator.generateThreatsMarkdown(playerSnap);
  const omniThreats = exportGenerator.generateThreatsMarkdown(omniSnap);
  const playerWarRoom = exportGenerator.generateWarRoomMarkdown(playerSnap);
  const omniWarRoom = exportGenerator.generateWarRoomMarkdown(omniSnap);

  const ptSize = Buffer.byteLength(playerThreats, 'utf8');
  const otSize = Buffer.byteLength(omniThreats, 'utf8');
  const pwSize = Buffer.byteLength(playerWarRoom, 'utf8');
  const owSize = Buffer.byteLength(omniWarRoom, 'utf8');

  // /latest-threats.md strictly < 10 KB (10,240 bytes)
  assert.ok(ptSize < 10240, `Player threats size (${ptSize} bytes) must be < 10 KB`);
  assert.ok(otSize < 10240, `Omni threats size (${otSize} bytes) must be < 10 KB`);

  // /latest-war-room.md Section 3 strictly < 8 KB (8,192 bytes)
  const s3Match = playerWarRoom.match(/## 3\. Hostile Relevant Fleets[\s\S]*?(?=## 4\. Incoming Threats)/);
  assert.ok(s3Match, 'Section 3 must exist in War Room export');
  const s3Size = Buffer.byteLength(s3Match[0], 'utf8');
  assert.ok(s3Size < 8192, `Section 3 size (${s3Size} bytes) must be < 8 KB`);

  // /latest-war-room.md strictly <= 30 KB (30,720 bytes) and >= 12 KB
  assert.ok(pwSize >= 12288, `Player war room size (${pwSize} bytes) must be >= 12 KB`);
  assert.ok(pwSize <= 30720, `Player war room size (${pwSize} bytes) must be <= 30 KB`);
  assert.ok(owSize >= 12288, `Omni war room size (${owSize} bytes) must be >= 12 KB`);
  assert.ok(owSize <= 30720, `Omni war room size (${owSize} bytes) must be <= 30 KB`);
});

test('war room stays under 30 KB ceiling under 3x observer and 2x hostile fleet growth', () => {
  const playerSnap = makeMarkdownSnapshot('player');
  const growthSnapshot = JSON.parse(JSON.stringify(playerSnap));

  const ownFleets = playerSnap.fleets.filter(f => f.factionId === OBSERVER_ID);
  const hostileFleets = playerSnap.fleets.filter(f => f.factionId !== OBSERVER_ID);

  growthSnapshot.fleets = [
    ...ownFleets,
    ...ownFleets.map(f => ({ ...f, id: f.id + 10000, displayName: f.displayName + ' II' })),
    ...ownFleets.map(f => ({ ...f, id: f.id + 20000, displayName: f.displayName + ' III' })),
    ...hostileFleets,
    ...hostileFleets.map(f => ({ ...f, id: f.id + 30000, displayName: f.displayName + ' Copy' }))
  ];

  const growthWarRoom = exportGenerator.generateWarRoomMarkdown(growthSnapshot);
  const growthSize = Buffer.byteLength(growthWarRoom, 'utf8');

  assert.ok(
    growthSize <= 30720,
    `Growth war room size (${growthSize} bytes) must stay under 30 KB ceiling (30,720 bytes)`
  );
});

// ---------------------------------------------------------------------------
// 2. MARKDOWN INTEGRITY (NO CORRUPTION TOKENS)
// ---------------------------------------------------------------------------
test('markdown exports contain no corruption tokens (null, undefined, NaN, [object Object])', () => {
  const playerSnap = makeMarkdownSnapshot('player');
  const omniSnap = makeMarkdownSnapshot('omniscient');

  const exports = [
    { name: 'player threats', text: exportGenerator.generateThreatsMarkdown(playerSnap) },
    { name: 'omni threats', text: exportGenerator.generateThreatsMarkdown(omniSnap) },
    { name: 'player war room', text: exportGenerator.generateWarRoomMarkdown(playerSnap) },
    { name: 'omni war room', text: exportGenerator.generateWarRoomMarkdown(omniSnap) },
    { name: 'player compact', text: exportGenerator.generateCompactSnapshot(playerSnap) },
    { name: 'omni compact', text: exportGenerator.generateCompactSnapshot(omniSnap) }
  ];

  const forbidden = ['null', 'undefined', 'NaN', '[object Object]'];

  for (const exp of exports) {
    for (const token of forbidden) {
      assert.ok(
        !exp.text.includes(token),
        `${exp.name} contains forbidden corruption token '${token}'`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 3. HOSTILE RELEVANCE FILTERING & OMITTED COUNT
// ---------------------------------------------------------------------------
test('war room filters hostile fleets by relevance and reports omitted count', () => {
  const playerSnap = makeMarkdownSnapshot('player');
  const warRoom = exportGenerator.generateWarRoomMarkdown(playerSnap);

  const totalHostiles = playerSnap.fleets.filter(f => f.factionId !== OBSERVER_ID).length;
  assert.ok(totalHostiles > 50, `Expected many hostile fleets in synthetic snapshot (found ${totalHostiles})`);

  // Assert that omitted count is explicitly reported in markdown
  assert.match(
    warRoom,
    /\*\d+\s+hostile fleets omitted \(below relevance threshold/,
    'War room must report omitted hostile fleet count banner'
  );

  const omittedMatch = warRoom.match(/\*(\d+)\s+hostile fleets omitted/);
  assert.ok(omittedMatch, 'Omitted count match found');
  const omittedCount = parseInt(omittedMatch[1], 10);
  assert.ok(omittedCount > 0, 'Omitted count must be greater than zero');
  assert.ok(omittedCount < totalHostiles, 'Some hostiles should be relevant');

  // Assert non-hostile human patrols are not treated as genuine hostile entries
  const s3Match = warRoom.match(/## 3\. Hostile Relevant Fleets[\s\S]*?(?=## 4\. Incoming Threats)/);
  assert.ok(s3Match, 'Section 3 exists');
  const s3Text = s3Match[0];
  assert.ok(!s3Text.includes('the Resistance'), 'Non-hostile human fleets (Resistance) must not appear in hostile section');
  assert.ok(!s3Text.includes('Project Exodus'), 'Non-hostile human fleets (Project Exodus) must not appear in hostile section');
});

// ---------------------------------------------------------------------------
// 4. DETECTION COVERAGE VS NO THREATS DISTINCTION
// ---------------------------------------------------------------------------
test('threats report distinguishes unobserved space from absence of threats', () => {
  const blindSnapshot = {
    metadata: { gameTimeString: '2027-01-01T00:00:00Z', difficulty: 'Normal' },
    observerFactionId: OBSERVER_ID,
    mode: 'player',
    factions: [{ ID: OBSERVER_ID, displayName: 'the Initiative', resources: {}, monthlyNet: {} }],
    habs: [],
    fleets: [],
    shipDesigns: [],
    habModules: [],
    shipyardStations: [],
    shipyardQueues: [],
    capabilities: { deepSkywatch: false, skywatch: false },
    alienIntelligenceStage: { operations: { active: false, status: 'UNKNOWN' } }
  };

  const threatsMd = renderThreatsMarkdown(blindSnapshot);
  assert.match(
    threatsMd,
    /NO DETECTION COVERAGE/,
    'Must state NO DETECTION COVERAGE when no skywatch capability is active'
  );
  assert.ok(
    !threatsMd.includes('No hostile transfers inbound to observer assets detected within 365 days under active detection coverage'),
    'Must not report all-clear when space is unobserved'
  );
});

// ---------------------------------------------------------------------------
// 4b. THE ALIEN TOTAL WAR GATE ON THE TACTICAL DOCUMENT
//
// /latest-threats.md reports contacts inbound within 365 days. On the live
// save the total-war YEAR gate is 1.09 years -- roughly 398 days -- away, so a
// reader planning that window is planning inside the window the gate opens in,
// and the document said nothing about it. /latest-war-room.md §1 keeps the
// derivation; this is one line.
// ---------------------------------------------------------------------------
const gateSnapshot = (totalWar, extra = {}) => ({
  metadata: { gameTimeString: '1/1/2035 12:00:00 AM', difficulty: 'Normal' },
  observerFactionId: OBSERVER_ID,
  mode: 'player',
  factions: [{ ID: OBSERVER_ID, displayName: 'the Initiative', resources: {}, monthlyNet: {} }],
  habs: [],
  fleets: [],
  shipDesigns: [],
  habModules: [],
  shipyardStations: [],
  shipyardQueues: [],
  capabilities: { deepSkywatch: true, skywatch: true },
  alienIntelligenceStage: { operations: { active: true, status: 'ACTIVE' } },
  alienHateEconomics: { applicable: true, totalWar, ...extra }
});

test('the tactical threats document carries the alien total-war gate', () => {
  // Live-save figures, read off the snapshot's own block: 10-year gate at 200%
  // Alien Progression Speed, 8.91 years elapsed, 1.09 remaining.
  const md = renderThreatsMarkdown(gateSnapshot({
    state: 'safe',
    hateThreshold: 200,
    yearsThreshold: 10,
    yearsElapsed: 8.91,
    hateRemaining: 157.13747,
    yearsRemaining: 1.09,
    maximumAlienHate: 2782,
    progressionSpeedAssumed: false,
    alienProgressionSpeed: 2
  }));

  assert.match(md, /\*\*Alien Total War Gate:\*\* SAFE — 1\.09 yrs to the year gate/);
  assert.match(md, /10\.0 yr gate, 2\.00× progression/);
  assert.match(md, /hate distance 157\.1/);
  assert.match(md, /derivation in \/latest-war-room\.md §1/);
});

test('a redacted hate half leaves the year gate readable and never fabricates a distance', () => {
  const md = renderThreatsMarkdown(gateSnapshot({
    state: 'safe_hate_unknown',
    hateThreshold: 200,
    yearsThreshold: 10,
    yearsElapsed: 8.91,
    hateRemaining: null,
    yearsRemaining: 1.09,
    maximumAlienHate: 2782,
    progressionSpeedAssumed: false,
    alienProgressionSpeed: 2
  }));

  assert.match(md, /SAFE_HATE_UNKNOWN — 1\.09 yrs to the year gate/);
  // Number(null) is 0, so the failure mode to pin is "hate distance 0.0" --
  // which reads as total war being one point of hate away.
  assert.match(md, /hate distance UNAVAILABLE/);
  assert.ok(!/hate distance 0/.test(md), 'a redacted hate distance must not render as 0');
});

test('a snapshot with no gate says UNAVAILABLE, never safe', () => {
  // The committed fixtures were derived before the gate was computed, which is
  // exactly the shape of a snapshot published by an older publisher.
  for (const fixturePath of [PLAYER_FIXTURE_PATH, OMNI_FIXTURE_PATH]) {
    const snap = loadFixture(fixturePath);
    assert.strictEqual(
      snap.alienHateEconomics?.totalWar,
      undefined,
      'fixture precondition: this snapshot predates the total-war gate'
    );
    const md = renderThreatsMarkdown(snap);
    assert.match(md, /\*\*Alien Total War Gate:\*\* UNAVAILABLE — this snapshot carries no total-war gate/);
    assert.ok(!/Alien Total War Gate:\*\* SAFE/.test(md), 'an absent gate must not read as safe');
  }
});

test('the gate is reported NOT APPLICABLE for an exempt faction', () => {
  // Servants and Protectorate are exempt from the alien hate model entirely;
  // showing them a year countdown would be an invented threat.
  const snap = gateSnapshot(null);
  snap.alienHateEconomics = { applicable: false, totalWar: null };
  assert.match(renderThreatsMarkdown(snap), /\*\*Alien Total War Gate:\*\* NOT APPLICABLE to /);
});

test('the threats and war-room documents report one gate, not two', () => {
  // Both renderers read `alienHateEconomics.totalWar`, so they cannot disagree
  // on a value -- this pins that they are in fact both reading it, and that
  // the tactical line agrees with the strategic block on the same snapshot.
  const totalWar = {
    state: 'safe_hate_unknown',
    hateThreshold: 200,
    yearsThreshold: 10,
    yearsElapsed: 8.91,
    hateRemaining: null,
    yearsRemaining: 1.09,
    maximumAlienHate: 2782,
    progressionSpeedAssumed: false,
    alienProgressionSpeed: 2
  };
  const playerSnap = makeMarkdownSnapshot('player');
  playerSnap.alienHateEconomics = {
    ...playerSnap.alienHateEconomics,
    totalWar,
    yearsElapsedSource: 'measured: save TITimeState.daysInCampaign = 3256 (365.25 days/year)'
  };

  const threats = renderThreatsMarkdown(playerSnap);
  const warRoom = renderWarRoomMarkdown(playerSnap);

  assert.ok(threats.includes('**Alien Total War Gate:** SAFE_HATE_UNKNOWN'), 'threats state');
  assert.ok(warRoom.includes('State: SAFE_HATE_UNKNOWN'), 'war-room state');
  // The year distance, rendered on both surfaces from the same field.
  assert.ok(threats.includes('1.09 yrs to the year gate'), 'threats year distance');
  assert.ok(warRoom.includes('Year Distance: 1.1 yrs'), 'war-room year distance');
  // Neither document may turn the redacted hate half into a number.
  assert.ok(threats.includes('hate distance UNAVAILABLE'), 'threats hate distance');
  assert.ok(warRoom.includes('Hate Distance: UNAVAILABLE'), 'war-room hate distance');
});

// ---------------------------------------------------------------------------
// 5. HUMAN-READABLE DESIGN ROLLUPS
// ---------------------------------------------------------------------------
test('friendly fleet manifests resolve design IDs to human-readable names', () => {
  const playerSnap = makeMarkdownSnapshot('player');
  const warRoom = exportGenerator.generateWarRoomMarkdown(playerSnap);

  // Raw hull template names like playerShipTemplate584 must not appear in the ship manifest
  assert.ok(
    !warRoom.includes('playerShipTemplate'),
    'Design rollups must resolve template names, never print playerShipTemplate...'
  );

  // Must contain resolved design names like Patapsco or Xingu
  assert.match(warRoom, /Patapsco|Xingu|Escort|Monitor|Corvette|Destroyer/);
});

// ---------------------------------------------------------------------------
// 6. NO FABRICATED FALLBACKS (INTERCEPTION STATE UNAVAILABLE)
// ---------------------------------------------------------------------------
test('fleet pursuit and interception state explicitly renders as UNAVAILABLE', () => {
  const playerSnap = makeMarkdownSnapshot('player');
  const warRoom = exportGenerator.generateWarRoomMarkdown(playerSnap);
  const threats = exportGenerator.generateThreatsMarkdown(playerSnap);

  assert.match(
    warRoom,
    /Interception State:\*{0,2}\s*UNAVAILABLE/i,
    'War room must explicitly label interception state UNAVAILABLE'
  );
  assert.match(
    threats,
    /Interception \/ Pursuit State:\*{0,2}\s*UNAVAILABLE/i,
    'Threats must explicitly label interception state UNAVAILABLE'
  );
});

// ---------------------------------------------------------------------------
// 7. SYNTHETIC SHIPYARD QUEUE TEST (OBSERVER QUEUE SURVIVAL & RENDERING)
// ---------------------------------------------------------------------------
test('synthetic observer-owned shipyard queues survive and render resolved design names', () => {
  const syntheticSnapshot = {
    metadata: { gameTimeString: '2027-06-01T00:00:00Z', difficulty: 'Normal' },
    observerFactionId: OBSERVER_ID,
    mode: 'player',
    factions: [{ ID: OBSERVER_ID, displayName: 'the Initiative', resources: {}, monthlyNet: {} }],
    habs: [{ ID: 101, factionId: OBSERVER_ID, displayName: 'Alpha Station', orbitBody: 'Earth Orbit', tier: 2 }],
    fleets: [],
    shipDesigns: [
      { dataName: 'playerShipTemplate999', _displayName: 'Dreadnought Alpha', hullName: 'Dreadnought' }
    ],
    habModules: [],
    shipyardStations: [
      { id: 101, name: 'Alpha Station', factionId: OBSERVER_ID, orbitBody: 'Earth Orbit', tier: 2, shipyardModulesCount: 2 }
    ],
    shipyardQueues: [
      {
        id: 777,
        factionId: OBSERVER_ID,
        orbitBody: 'Earth Orbit',
        design: 'playerShipTemplate999',
        completionDate: '2027-08-15T00:00:00Z',
        constructionStatus: 'building'
      }
    ]
  };

  const warRoom = renderWarRoomMarkdown(syntheticSnapshot);

  assert.match(
    warRoom,
    /Dreadnought Alpha \(Dreadnought\)/,
    'Ship construction section must render resolved design name from shipDesigns'
  );
  assert.match(warRoom, /2027-08-15/, 'Must render completion date');
  assert.match(warRoom, /Queue ID:\s*777/, 'Must render queue ID');
});

// ---------------------------------------------------------------------------
// 7b. UNLOCKED-TECHNOLOGY CENSUS REACHES THE AI SURFACES
// ---------------------------------------------------------------------------
test('war room carries the unlocked-technology census and its lookup route', () => {
  const snapshot = {
    metadata: { gameTimeString: '2030-01-01T00:00:00Z' },
    observerFactionId: 4712,
    mode: 'player',
    factions: [{
      ID: 4712,
      displayName: 'Initiative',
      completedProjects: ['Project_A', 'Project_B', 'Project_C'],
      completedProjectsCount: 3
    }],
    techTree: { finishedTechsNames: ['Tech_A', 'Tech_B'] }
  };

  const warRoom = renderWarRoomMarkdown(snapshot);

  assert.match(warRoom, /3 faction projects completed/, 'the census must report the completed project count');
  assert.match(warRoom, /2 global techs finished/, 'the census must report the finished tech count');
  assert.match(
    warRoom,
    /\/api\/intel\/tech-search\?observer=4712/,
    'the census must name the route an agent can search with, not just the number'
  );
});

test('an absent unlocked-technology set says so rather than reporting zero unlocked', () => {
  // Number(undefined) is NaN and [].length on a missing array throws, but the
  // tempting `?? []` would render "0 faction projects completed" -- a faction
  // that has researched nothing, which is a different and false claim.
  const snapshot = {
    metadata: { gameTimeString: '2030-01-01T00:00:00Z' },
    observerFactionId: 4712,
    mode: 'player',
    factions: [{ ID: 4712, displayName: 'Initiative' }]
  };

  const warRoom = renderWarRoomMarkdown(snapshot);

  assert.match(
    warRoom,
    /Unlocked-technology census unavailable in this snapshot\./,
    'a missing census must be reported as unavailable'
  );
  assert.ok(
    !/0 faction projects completed/.test(warRoom),
    'an absent project list must never render as zero completed projects'
  );
});

// ---------------------------------------------------------------------------
// 8. BYTE-IDENTICAL /latest-snapshot.md AND NON-VACUOUS PROOF
// ---------------------------------------------------------------------------
test('compact snapshot output is byte-identical to frozen baseline captured from a5a3d01', () => {
  const playerSnap = loadFixture(PLAYER_FIXTURE_PATH);
  const omniSnap = loadFixture(OMNI_FIXTURE_PATH);

  const currentPlayerData = exportGenerator.generateCompactSnapshot(playerSnap);
  const currentOmniData = exportGenerator.generateCompactSnapshot(omniSnap);

  const frozenPlayer = fs.readFileSync(FROZEN_PLAYER_PATH, 'utf8');
  const frozenOmni = fs.readFileSync(FROZEN_OMNI_PATH, 'utf8');

  assert.strictEqual(
    currentPlayerData,
    frozenPlayer,
    'Player compact snapshot must be byte-for-byte identical to frozen pre-change baseline'
  );
  assert.strictEqual(
    currentOmniData,
    frozenOmni,
    'Omniscient compact snapshot must be byte-for-byte identical to frozen pre-change baseline'
  );

  // Non-vacuous test proof: deliberately mutating the snapshot output causes the assertion to fail
  const mutated = currentPlayerData + '\n<!-- mutation -->';
  assert.notStrictEqual(
    mutated,
    frozenPlayer,
    'Mutated snapshot must NOT match frozen baseline (proves test is non-vacuous)'
  );
});

// ---------------------------------------------------------------------------
// 9. HTTP ENDPOINTS ON EPHEMERAL PORT (smoke -- skips cleanly without a save)
// ---------------------------------------------------------------------------
function hasLiveSave() {
  try {
    const raw = loadFilteredSnapshot({ mode: 'player', observer: OBSERVER_ID });
    return !!(raw && raw.metadata);
  } catch {
    return false;
  }
}

test('Express server serves /latest-threats.md and /latest-war-room.md on ephemeral port', async (t) => {
  if (!hasLiveSave()) {
    t.skip('Skipping HTTP smoke test: no live save available');
    return;
  }

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const fetchEndpoint = (route) => new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${route}`, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    }).on('error', reject);
  });

  try {
    const threatsRes = await fetchEndpoint('/latest-threats.md?observer=4712&mode=player');
    assert.strictEqual(threatsRes.status, 200);
    assert.match(threatsRes.headers['content-type'], /text\/markdown/);
    assert.strictEqual(threatsRes.headers['cache-control'], 'no-store');
    assert.ok(threatsRes.body.includes('# TI Tactical Threat Assessment'));

    const warRoomRes = await fetchEndpoint('/latest-war-room.md?observer=4712&mode=player');
    assert.strictEqual(warRoomRes.status, 200);
    assert.match(warRoomRes.headers['content-type'], /text\/markdown/);
    assert.strictEqual(warRoomRes.headers['cache-control'], 'no-store');
    assert.ok(warRoomRes.body.includes('# TI Strategic War Room Briefing'));

    // The engine's PRIMARY recommendation has to survive the route, not just
    // the renderer. `primary` is engine output like the cycle plan is, so this
    // runtime has to hand it over -- and dropping it from the route call is a
    // silent regression the renderer's own tests cannot see. Both modes,
    // because the two plans genuinely differ rather than one being a redaction
    // of the other.
    for (const mode of ['player', 'omniscient']) {
      const res = await fetchEndpoint(`/latest-war-room.md?observer=4712&mode=${mode}`);
      assert.strictEqual(res.status, 200, `${mode}: war room must serve`);
      const primaryLine = res.body.split('\n').find(line => line.startsWith('- **Primary'));
      assert.ok(primaryLine, `${mode}: section 10 must carry a primary line`);
      assert.ok(!/UNAVAILABLE — this plan carries no primary/.test(primaryLine),
        `${mode}: the route must hand the primary over, not leave the renderer to report it missing — got: ${primaryLine}`);
      assert.match(primaryLine, /score -?[\d,.]+, EV -?[\d,.]+ \| whole-cycle totalExpectedValue -?[\d,.]+/,
        `${mode}: score, EV and the cycle total must all be measured — got: ${primaryLine}`);
      assert.ok(!/undefined|null|NaN/.test(primaryLine),
        `${mode}: no placeholder token may reach the line — got: ${primaryLine}`);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// ---------------------------------------------------------------------------
// 10. WAR-ROOM SECTIONS 8 (CHAIN PROMOTION), 9 (CRUISE) AND 10 (CYCLE PLAN)
//
// Tracker items 1b and 3e. Four figures existed only in the browser and on the
// JSON endpoints -- `riskFloor`, the chain promotion, its reachability gate and
// `benchedOmittedCount` -- and section 9 quoted combat acceleration alone, which
// is the burst figure and overstates transit acceleration on most drives.
//
// The cycle plan is engine output, not snapshot data, so it reaches this file
// two ways and both are pinned below: `options.cyclePlan` (what the Express
// route passes) and `snapshot.missionControlBriefing` (what a published row
// carries, which is how the Cloudflare Worker gets it with no worker change).
// ---------------------------------------------------------------------------

const { accelOr } = require('../shared/markdownExports.mjs');

const EXPORT_MODES = ['player', 'omniscient'];

/** A cycle plan shaped exactly like `allocateCyclePlan`'s return value. */
function makeCyclePlan(overrides = {}) {
  return {
    assignments: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    unassigned: [],
    committed: [{ id: 'x' }],
    benched: new Array(8).fill(null).map((_, i) => ({ id: `bench-${i}` })),
    benchedTotalCount: 46,
    benchedOmittedCount: 38,
    riskFloor: { percent: 0, inForce: false, configured: true },
    riskFloorVetoed: [],
    riskFloorVetoedTotalCount: 0,
    riskFloorVetoedOmittedCount: 0,
    riskFloorUnverified: [],
    riskFloorUnverifiedTotalCount: 0,
    riskFloorUnverifiedOmittedCount: 0,
    ...overrides
  };
}

const sectionTen = (doc) => {
  const i = doc.indexOf('## 10.');
  return i < 0 ? '' : doc.slice(i);
};
const chainBlock = (doc) => {
  const i = doc.indexOf('### Research Chain Promotion');
  return i < 0 ? '' : doc.slice(i, doc.indexOf('## 9.'));
};
const sectionNine = (doc) => {
  const i = doc.indexOf('## 9.');
  return i < 0 ? '' : doc.slice(i, doc.indexOf('## 10.'));
};

test('accelOr keeps three SIGNIFICANT figures, so the smallest measured acceleration is never a confident 0.000', () => {
  // The catalogue's smallest measured cruise acceleration. `toFixed(3)` prints
  // this as "0.000", which a reader cannot tell from a measured zero -- the
  // defect fixed on the DRIVES panel in 7352a44 and inherited by this export.
  assert.strictEqual(accelOr(0.00016846), '0.000168');
  assert.strictEqual(accelOr(0.01010778), '0.0101');
  assert.strictEqual(accelOr(20.59560406), '20.6');
  assert.strictEqual(accelOr(606.46655067), '606');
  // A measured zero is a reading and stays a reading.
  assert.strictEqual(accelOr(0), '0');
  // Absence is not zero, in any of its shapes.
  assert.strictEqual(accelOr(null), 'UNAVAILABLE');
  assert.strictEqual(accelOr(undefined), 'UNAVAILABLE');
  assert.strictEqual(accelOr(''), 'UNAVAILABLE');
  assert.strictEqual(accelOr(Number.NaN), 'UNAVAILABLE');
});

for (const exportMode of EXPORT_MODES) {
  test(`section 10 reports the risk floor and the bench truncation from options.cyclePlan (${exportMode} mode)`, () => {
    const snapshot = makeMarkdownSnapshot(exportMode);
    const rendered = renderWarRoomMarkdown(snapshot, { cyclePlan: makeCyclePlan() });
    const section = sectionTen(rendered);

    assert.ok(section.includes('## 10. Council Cycle Plan'), 'section 10 must exist');
    // A floor of 0 that WAS configured is the player choosing no floor. It is
    // not an unset floor and it is not a floor that rejects everything.
    assert.match(section, /\*\*Risk floor:\*\* 0% — CONFIGURED but NOT IN FORCE/);
    // Truncation announces itself: carried, total and omitted all present.
    assert.match(section, /\*\*Bench:\*\* 8 of 46 candidate action\(s\) carried, 38 omitted/);
    // And it says WHICH eight, because the slice is generation order.
    assert.match(section, /NOT the highest-value few/);
    assert.match(section, /\*\*Assigned this cycle:\*\* 3 councilor\(s\); 0 unassigned, 1 already committed/);
    assert.ok(section.includes(`/api/v2/briefing?observer=4712&mode=${exportMode}`),
      'section 10 must name the endpoint carrying the full plan');
  });

  test(`section 10 falls back to the published snapshot's own briefing, which is how the hosted worker gets it (${exportMode} mode)`, () => {
    const snapshot = makeMarkdownSnapshot(exportMode);
    // Exactly the shape scripts/publish/rows.js writes onto a published row.
    snapshot.missionControlBriefing = {
      engineDirectives: { cyclePlan: makeCyclePlan({ benchedTotalCount: 427, benchedOmittedCount: 419 }) }
    };
    const section = sectionTen(renderWarRoomMarkdown(snapshot));
    assert.match(section, /\*\*Bench:\*\* 8 of 427 candidate action\(s\) carried, 419 omitted/);
    assert.ok(!section.includes('UNAVAILABLE in this runtime'),
      'a published snapshot carrying a briefing must not report the plan as unavailable');
  });

  test(`section 10 says the plan was not read rather than printing a floor of zero and an empty bench (${exportMode} mode)`, () => {
    const section = sectionTen(renderWarRoomMarkdown(makeMarkdownSnapshot(exportMode)));
    assert.match(section, /Cycle plan UNAVAILABLE in this runtime/);
    assert.match(section, /This is NOT a plan with no risk floor and an empty bench/);
    // `Number(null) === 0` would have produced all three of these.
    assert.ok(!/\*\*Risk floor:\*\* 0%/.test(section), 'an unread floor must not render as 0%');
    assert.ok(!/\*\*Bench:\*\* 0 of 0/.test(section), 'an unread bench must not render as 0 of 0');
    assert.ok(!/0 councilor\(s\)/.test(section), 'an unread assignment list must not render as 0 councilors');
  });

  test(`section 10 tells an unset risk floor apart from a floor set to zero, and from one in force (${exportMode} mode)`, () => {
    const snapshot = makeMarkdownSnapshot(exportMode);
    const render = (riskFloor) =>
      sectionTen(renderWarRoomMarkdown(snapshot, { cyclePlan: makeCyclePlan({ riskFloor }) }));

    assert.match(render({ percent: null, inForce: false, configured: false }),
      /\*\*Risk floor:\*\* NOT CONFIGURED/);
    assert.match(render({ percent: 0, inForce: false, configured: true }),
      /\*\*Risk floor:\*\* 0% — CONFIGURED but NOT IN FORCE/);
    assert.match(render({ percent: 90, inForce: true, configured: true }),
      /\*\*Risk floor:\*\* 90% — IN FORCE; an action is vetoed when the LOW end of its odds band is below it/);
    // No floor record at all is a fourth, distinct state.
    assert.match(render(null), /\*\*Risk floor:\*\* UNAVAILABLE — this plan carries no risk-floor record/);
  });

  test(`section 10 names the primary recommendation, its score and both expected values (${exportMode} mode)`, () => {
    // Counts alone are not the recommendation. `b5ca8dd` changed the omniscient
    // primary and took totalExpectedValue from 21.41 to 66.13, and all three
    // markdown exports rendered BYTE-IDENTICAL across it in both modes, because
    // none of those figures reached any export.
    const snapshot = makeMarkdownSnapshot(exportMode);
    const section = sectionTen(renderWarRoomMarkdown(snapshot, {
      cyclePlan: makeCyclePlan({ totalExpectedValue: 66.13 }),
      primary: {
        title: 'Purge the Protectorate hold on ExtractiveSector in China',
        score: 68.74825331372958,
        assignment: { expectedValue: 45.93 }
      }
    }));
    assert.match(section,
      /\*\*Primary:\*\* Purge the Protectorate hold on ExtractiveSector in China — score 68\.75, EV 45\.93 \| whole-cycle totalExpectedValue 66\.13/);
  });

  test(`section 10 reads the primary off a published snapshot the same way it reads the plan (${exportMode} mode)`, () => {
    // `primary` is a SIBLING of `cyclePlan` on `engineDirectives`, which is what
    // lets the hosted worker pick it up with no worker change at all.
    const snapshot = makeMarkdownSnapshot(exportMode);
    snapshot.missionControlBriefing = {
      engineDirectives: {
        cyclePlan: makeCyclePlan({ totalExpectedValue: 19.3 }),
        primary: {
          title: 'Advise Government: United States of North America',
          score: 6.997422015983501,
          assignment: { expectedValue: 10.03 }
        }
      }
    };
    assert.match(sectionTen(renderWarRoomMarkdown(snapshot)),
      /\*\*Primary:\*\* Advise Government: United States of North America — score 7\.00, EV 10\.03 \| whole-cycle totalExpectedValue 19\.30/);
  });

  test(`an unmeasured primary, score, EV or total renders UNAVAILABLE and never a confident zero (${exportMode} mode)`, () => {
    const snapshot = makeMarkdownSnapshot(exportMode);

    // A plan with no primary at all says so, rather than naming one.
    const noPrimary = sectionTen(renderWarRoomMarkdown(snapshot, { cyclePlan: makeCyclePlan() }));
    assert.match(noPrimary, /\*\*Primary recommendation:\*\* UNAVAILABLE — this plan carries no primary action/);
    assert.ok(!/EV 0\.00/.test(noPrimary), 'an unread expected value must not render as 0.00');
    assert.ok(!/score 0\.00/.test(noPrimary), 'an unread score must not render as 0.00');

    // A primary with no assignment has a score and NO expected value: the EV
    // only exists once the action is paired with a councilor whose odds are
    // computable, so it is UNAVAILABLE rather than 0.
    const unpaired = sectionTen(renderWarRoomMarkdown(snapshot, {
      cyclePlan: makeCyclePlan({ totalExpectedValue: null }),
      primary: { title: 'Something', score: 12.5, assignment: null }
    }));
    assert.match(unpaired, /\*\*Primary:\*\* Something — score 12\.50, EV UNAVAILABLE \| whole-cycle totalExpectedValue UNAVAILABLE/);

    // An untitled primary is named as untitled rather than rendered blank or
    // as the string "undefined".
    const untitled = sectionTen(renderWarRoomMarkdown(snapshot, {
      cyclePlan: makeCyclePlan(), primary: { title: '   ', score: null }
    }));
    assert.match(untitled, /\*\*Primary:\*\* UNAVAILABLE \(the primary action carries no title\) — score UNAVAILABLE/);
    assert.ok(!/undefined/.test(untitled), 'no rendered token may read "undefined"');

    // And with no plan read at all there is no primary line: the section says
    // once, above, that nothing was read.
    const nothingRead = sectionTen(renderWarRoomMarkdown(snapshot));
    assert.match(nothingRead, /Cycle plan UNAVAILABLE in this runtime/);
    assert.ok(!/\*\*Primary/.test(nothingRead),
      'a runtime that read no plan must not print a primary line at all');
  });

  test(`an absent bench list renders UNAVAILABLE rather than a count of zero (${exportMode} mode)`, () => {
    const section = sectionTen(renderWarRoomMarkdown(makeMarkdownSnapshot(exportMode), {
      cyclePlan: makeCyclePlan({
        benched: undefined,
        benchedTotalCount: undefined,
        benchedOmittedCount: undefined,
        assignments: undefined
      })
    }));
    assert.match(section, /\*\*Bench:\*\* UNAVAILABLE of UNAVAILABLE candidate action\(s\) carried, UNAVAILABLE omitted/);
    assert.match(section, /\*\*Assigned this cycle:\*\* UNAVAILABLE councilor\(s\)/);
  });

  test(`the chain-promotion block keeps its horizon and its counts even with no chains to list (${exportMode} mode)`, () => {
    const block = chainBlock(renderWarRoomMarkdown(makeMarkdownSnapshot(exportMode)));
    assert.ok(block.length > 0, 'the chain-promotion block must render even when empty');
    // The horizon and the refusal counts live in the trailing note precisely so
    // that a budget pass which empties the list still leaves them.
    assert.match(block, /Planning horizon/);
    assert.match(block, /chain\(s\) promoted/);
    assert.match(block, /omitted by the endpoint's group limit/);
    assert.match(block, /ordered under the step you would START/);
    assert.ok(block.includes('/api/intel/research-ranking?observer=4712&detail=full'),
      'the block must name the endpoint carrying the full set');
  });
}

// ---------------------------------------------------------------------------
// Live-save property assertions. No drive, project or chain name is asserted --
// docs/research-advisor-spec.md section 0 forbids campaign-specific tests -- and
// each skips cleanly rather than failing on live-save state.
// ---------------------------------------------------------------------------
for (const exportMode of EXPORT_MODES) {
  test(`section 9 quotes cruise acceleration beside combat on every measured line (${exportMode} mode, live save)`, (t) => {
    if (!hasLiveSave()) {
      t.skip('Skipping: no live save available');
      return;
    }
    const snapshot = loadFilteredSnapshot({ mode: exportMode, observer: OBSERVER_ID });
    const section = sectionNine(renderWarRoomMarkdown(snapshot));
    if (section.includes('Drive Explorer unavailable')) {
      t.skip('Skipping: this save carries no drive catalogue');
      return;
    }

    assert.match(section, /\*\*Fitted drive \(MEASURED\):\*\*.*m\/s² combat accel, .*m\/s² cruise accel/,
      'the fitted-drive line must carry both accelerations, not the burst figure alone');
    assert.match(section, /\*\*Best fittable today by ΔV \(MEASURED\):\*\*.*m\/s² cruise accel/,
      'the best-by-delta-V line must carry cruise acceleration');
    assert.match(section, /\*\*Best fittable today by cruise acceleration \(MEASURED\):\*\*/,
      'cruise acceleration must be its own ranking, not only a column on the combat one');
    assert.match(section, /combat \/ cruise is that drive's own thrust cap/,
      'the section must say what the two figures are and which overstates transit');
    assert.ok(section.includes('&sort=cruise-acceleration'),
      'the endpoint line must name the sort key that ranks the whole catalogue by cruise');
  });

  test(`section 8 carries the chain promotion, its reachability gate and its omitted count (${exportMode} mode, live save)`, (t) => {
    if (!hasLiveSave()) {
      t.skip('Skipping: no live save available');
      return;
    }
    const snapshot = loadFilteredSnapshot({ mode: exportMode, observer: OBSERVER_ID });
    const block = chainBlock(renderWarRoomMarkdown(snapshot));
    const counts = block.match(/\*([\d,]+) chain\(s\) promoted \((\d+) carried here, ([\d,]+) omitted/);
    assert.ok(counts, 'the block must state promoted, carried and omitted counts');
    const promoted = Number(counts[1].replace(/,/g, ''));
    if (promoted === 0) {
      t.skip('Skipping: this save promoted no chain, so there is no row to inspect');
      return;
    }
    // Truncation reconciles: carried + omitted == the true total.
    assert.strictEqual(
      Number(counts[2]) + Number(counts[3].replace(/,/g, '')),
      promoted,
      'carried + omitted must equal the promoted total'
    );
    // Every listed chain names the reachability state it was gated on, and at
    // least one names the step the player would actually start.
    const rows = block.split('\n').filter(l => l.startsWith('- '));
    assert.ok(rows.length > 0, 'at least one chain row must be listed');
    for (const row of rows) {
      assert.match(row, /WITHIN-HORIZON|BEYOND-HORIZON|UNKNOWN/,
        `every chain row must name its reachability state: ${row}`);
    }
    assert.ok(rows.some(r => /start \*\*/.test(r)),
      'a promoted chain must name the step the player would start, not only the project it delivers');
  });
}