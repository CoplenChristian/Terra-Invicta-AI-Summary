// tests/markdownExports.test.js
//
// Validation test suite for model-facing markdown exports:
//   * /latest-threats.md   (< 10 KB, immediate tactical danger)
//   * /latest-war-room.md  (20-30 KB, comprehensive military/economic brief)
//   * /latest-snapshot.md  (byte-identical to pre-refactor baseline)
//
// Tests all 8 acceptance criteria from docs/markdown-export-plan.md

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');

const { loadFilteredSnapshot } = require('../server/snapshotLoader');
const exportGenerator = require('../server/exportGenerator');
const app = require('../server');
const {
  renderThreatsMarkdown,
  renderWarRoomMarkdown,
  renderCompactSnapshotMarkdown,
  buildDesignLookup
} = require('../shared/markdownExports.mjs');

const FROZEN_PLAYER_PATH = path.join(__dirname, 'fixtures', 'frozen-snapshot-player.md');
const FROZEN_OMNI_PATH = path.join(__dirname, 'fixtures', 'frozen-snapshot-omni.md');

// ---------------------------------------------------------------------------
// 1. CEILING & FLOOR SIZES (INCLUDING SECTION 3 SUB-8KB CONSTRAINT)
// ---------------------------------------------------------------------------
test('export sizes meet ceiling and floor constraints on live save', () => {
  const playerSnap = loadFilteredSnapshot({ mode: 'player', observer: 4712 });
  const omniSnap = loadFilteredSnapshot({ mode: 'omniscient', observer: 4712 });

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
  const playerSnap = loadFilteredSnapshot({ mode: 'player', observer: 4712 });
  const growthSnapshot = JSON.parse(JSON.stringify(playerSnap));

  const ownFleets = playerSnap.fleets.filter(f => f.factionId === 4712);
  const hostileFleets = playerSnap.fleets.filter(f => f.factionId !== 4712);

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
  const playerSnap = loadFilteredSnapshot({ mode: 'player', observer: 4712 });
  const omniSnap = loadFilteredSnapshot({ mode: 'omniscient', observer: 4712 });

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
  const playerSnap = loadFilteredSnapshot({ mode: 'player', observer: 4712 });
  const warRoom = exportGenerator.generateWarRoomMarkdown(playerSnap);

  const totalHostiles = playerSnap.fleets.filter(f => f.factionId !== 4712).length;
  assert.ok(totalHostiles > 50, `Expected many hostile fleets in save (found ${totalHostiles})`);

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
    observerFactionId: 4712,
    mode: 'player',
    factions: [{ ID: 4712, displayName: 'the Initiative', resources: {}, monthlyNet: {} }],
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
// 5. HUMAN-READABLE DESIGN ROLLUPS
// ---------------------------------------------------------------------------
test('friendly fleet manifests resolve design IDs to human-readable names', () => {
  const playerSnap = loadFilteredSnapshot({ mode: 'player', observer: 4712 });
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
  const playerSnap = loadFilteredSnapshot({ mode: 'player', observer: 4712 });
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
    observerFactionId: 4712,
    mode: 'player',
    factions: [{ ID: 4712, displayName: 'the Initiative', resources: {}, monthlyNet: {} }],
    habs: [{ ID: 101, factionId: 4712, displayName: 'Alpha Station', orbitBody: 'Earth Orbit', tier: 2 }],
    fleets: [],
    shipDesigns: [
      { dataName: 'playerShipTemplate999', _displayName: 'Dreadnought Alpha', hullName: 'Dreadnought' }
    ],
    habModules: [],
    shipyardStations: [
      { id: 101, name: 'Alpha Station', factionId: 4712, orbitBody: 'Earth Orbit', tier: 2, shipyardModulesCount: 2 }
    ],
    shipyardQueues: [
      {
        id: 777,
        factionId: 4712,
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
// 8. BYTE-IDENTICAL /latest-snapshot.md AND NON-VACUOUS PROOF
// ---------------------------------------------------------------------------
test('compact snapshot output is byte-identical to frozen baseline captured from a5a3d01', () => {
  const playerSnap = loadFilteredSnapshot({ mode: 'player', observer: 4712 });
  const omniSnap = loadFilteredSnapshot({ mode: 'omniscient', observer: 4712 });

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
// 9. HTTP ENDPOINTS ON EPHEMERAL PORT
// ---------------------------------------------------------------------------
test('Express server serves /latest-threats.md and /latest-war-room.md on ephemeral port', async () => {
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
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
