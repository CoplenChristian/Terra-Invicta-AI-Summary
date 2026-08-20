const { test } = require('node:test');
const assert = require('node:assert/strict');

const app = require('../server');
const snapshotBuilder = require('../server/snapshotBuilder');
const intelligenceFilter = require('../server/intelligenceFilter');
const { buildResource, SUPPORTED_RESOURCES } = require('../server/intelResources');
const { alienThreatResource } = require('../shared/intelResources.mjs');
const { makeSaveData } = require('./fixtures/syntheticSave');

const OBSERVER = 4712;

// A sentinel with enough digits that its full-precision rendering cannot occur
// by coincidence anywhere else in a snapshot. The rounded forms CAN collide
// (a mining yield of 63.4 t/month, a tech stat of "63.430"), so those are
// compared leaf by leaf as values instead of searched for as substrings.
const SENTINEL_HATE = 63.4278915;
const SENTINEL_EXACT = String(SENTINEL_HATE);
const SENTINEL_ROUNDED = [
  Number(SENTINEL_HATE.toFixed(2)),
  Number(SENTINEL_HATE.toFixed(1)),
  SENTINEL_HATE.toFixed(2),
  SENTINEL_HATE.toFixed(1)
];

function rawWithSentinelHate() {
  return snapshotBuilder.buildRawSnapshot(makeSaveData({
    factionOptions: { [OBSERVER]: { hate: SENTINEL_HATE } }
  }));
}

/**
 * Finds every place a payload exposes the true alien hate.
 *
 * Deliberately field-agnostic: it walks the whole structure rather than
 * checking the one field that leaked, so the next member of this bug class --
 * a raw save value that survives filtering while its derived twin is nulled --
 * is caught wherever it surfaces.
 */
function findHateLeaks(node, trail = '$', found = []) {
  if (node === null || node === undefined) return found;
  if (Array.isArray(node)) {
    node.forEach((entry, index) => findHateLeaks(entry, `${trail}[${index}]`, found));
    return found;
  }
  if (typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) findHateLeaks(value, `${trail}.${key}`, found);
    return found;
  }
  if (typeof node === 'string' && node.includes(SENTINEL_EXACT)) {
    found.push(`${trail} = ${JSON.stringify(node)}`);
  } else if (typeof node === 'number' && String(node).includes(SENTINEL_EXACT)) {
    found.push(`${trail} = ${node}`);
  } else if (SENTINEL_ROUNDED.some(rounded => node === rounded)) {
    found.push(`${trail} = ${JSON.stringify(node)} (rounded)`);
  }
  return found;
}

test('no player-mode intel response exposes the raw alien hate float', () => {
  const raw = rawWithSentinelHate();
  const player = intelligenceFilter.applyFilter(raw, 'player', OBSERVER);

  // The whole filtered snapshot is what /api/snapshot serves, what the v2
  // dashboard reads, and what the publisher writes to the hosted Player Intel
  // row -- so it is the payload that has to be clean, not just one endpoint.
  assert.deepEqual(
    findHateLeaks(player),
    [],
    'player-mode snapshot must not carry the save\'s true alien hate'
  );

  // Every projected endpoint, not just alien-threat. The leak this guards
  // reached /api/intel/summary, /factions and /resources as well.
  const checked = [];
  for (const resource of SUPPORTED_RESOURCES) {
    let projection;
    try {
      projection = buildResource(player, resource, { mode: 'player' });
    } catch {
      // The synthetic fixture cannot feed every endpoint; an endpoint that
      // cannot be built here is not asserted about, and is named below so a
      // silent loss of coverage is visible rather than assumed away.
      continue;
    }
    if (projection === null) continue;
    checked.push(resource);
    assert.deepEqual(
      findHateLeaks(projection),
      [],
      `/api/intel/${resource} leaked the raw alien hate in player mode`
    );
  }
  assert.ok(
    ['summary', 'factions', 'resources', 'alien-threat', 'delta'].every(r => checked.includes(r)),
    `endpoints known to carry faction telemetry must be covered; checked: ${checked.join(', ')}`
  );
});

test('redacting the raw hate leaves the player-legitimate estimate meter intact', () => {
  const player = intelligenceFilter.applyFilter(rawWithSentinelHate(), 'player', OBSERVER);
  const observer = player.factions.find(f => f.ID === OBSERVER);

  assert.equal(Object.hasOwn(observer, 'assessedAlienHateOfMe'), false, 'raw field stripped');
  assert.equal(observer.alienHate.actual, null);
  assert.equal(observer.alienHate.pips, 5, 'the 5-pip meter is what the player legitimately sees');
  assert.equal(observer.alienHate.visibleEstimate, '■■■■■');
  assert.equal(observer.alienHate.status, 'available', 'the meter is available, not blanked');

  const threat = buildResource(player, 'alien-threat', { mode: 'player' });
  assert.equal(threat.actualHate, null);
  assert.equal(threat.actualHateStatus, 'redacted');
  assert.equal(threat.visibleEstimate, '■■■■■');
  // The floor is the player's own used Mission Control times the difficulty
  // multiplier -- legitimately knowable, so redaction must not take it away.
  assert.ok(Number.isFinite(threat.minimumHate), 'the hate floor stays reported');
  // A threshold check that cannot be evaluated is unknown, never "no war".
  assert.equal(threat.retaliation.retaliationActive, null);
});

test('enhanced and omniscient modes still expose the raw alien hate', () => {
  // Guards the opposite failure: a redaction that quietly deletes the data
  // everywhere would pass the leak test above while breaking both raw views.
  for (const mode of ['enhanced', 'omniscient']) {
    const filtered = intelligenceFilter.applyFilter(rawWithSentinelHate(), mode, OBSERVER);
    const observer = filtered.factions.find(f => f.ID === OBSERVER);
    assert.equal(observer.assessedAlienHateOfMe, SENTINEL_HATE, `${mode} keeps the raw field`);
    assert.equal(observer.alienHate.actual, SENTINEL_HATE, `${mode} keeps alienHate.actual`);
    assert.equal(filtered.alienHateEconomics.actualAlienHate, SENTINEL_HATE, `${mode} keeps the economics`);

    const threat = buildResource(filtered, 'alien-threat', { mode });
    assert.equal(threat.actualHate, Number(SENTINEL_HATE.toFixed(1)), `${mode} alien-threat keeps the value`);
    assert.equal(threat.actualHateStatus, 'available');
  }
});

test('alienThreatResource refuses a value that should have been redacted', () => {
  // Defence in depth. The resource used to document that callers hand it an
  // already-filtered snapshot and read the raw field on that basis; the filter
  // violated the assumption for the observer's own faction. It must now decline
  // to republish a leaked value rather than trust the snapshot it is given.
  const leakedSnapshot = {
    mode: 'player',
    isOmniscient: false,
    observerFactionId: OBSERVER,
    metadata: { difficulty: 'Veteran' },
    factions: [{
      ID: OBSERVER,
      displayName: 'the Initiative',
      missionControlUsage: 10,
      completedProjects: [],
      assessedAlienHateOfMe: SENTINEL_HATE,
      alienHate: { actual: SENTINEL_HATE, visibleEstimate: '■■■■■', pips: 5, maxPips: 5 }
    }]
  };

  for (const requested of ['player', null]) {
    const threat = alienThreatResource(leakedSnapshot, OBSERVER, { mode: requested });
    assert.deepEqual(
      findHateLeaks(threat),
      [],
      `a player-labelled snapshot must not republish the raw hate (requested mode: ${requested})`
    );
    assert.equal(threat.actualHate, null);
    assert.equal(threat.actualHateStatus, 'redacted');
    assert.match(threat.actualHateSource, /redacted/);
    assert.equal(threat.ventableHate, null, 'a figure derived from the redacted value stays null, not 0');
  }

  // A player request against an unlabelled snapshot is redacted on the
  // requested mode alone -- an unknown snapshot is not treated as safe.
  const unlabelled = { ...leakedSnapshot, mode: undefined, isOmniscient: undefined };
  const requestedPlayer = alienThreatResource(unlabelled, OBSERVER, { mode: 'player' });
  assert.equal(requestedPlayer.actualHate, null);
  assert.equal(requestedPlayer.actualHateStatus, 'redacted');
});

test('assertPlayerSnapshotSafe rejects injected faction telemetry', () => {
  const base = () => intelligenceFilter.applyFilter(rawWithSentinelHate(), 'player', OBSERVER);
  assert.equal(intelligenceFilter.assertPlayerSnapshotSafe(base()), true);

  const withRawHate = base();
  withRawHate.factions.find(f => f.ID === OBSERVER).assessedAlienHateOfMe = SENTINEL_HATE;
  assert.throws(() => intelligenceFilter.assertPlayerSnapshotSafe(withRawHate), /hidden faction telemetry/);

  const withEnemyDesigns = base();
  const enemy = withEnemyDesigns.factions.find(f => f.ID !== OBSERVER);
  enemy.shipDesigns = [{ dataName: 'EnemyHull', factionId: enemy.ID }];
  assert.throws(() => intelligenceFilter.assertPlayerSnapshotSafe(withEnemyDesigns), /hidden faction telemetry/);

  const withEconomics = base();
  withEconomics.alienHateEconomics.actualAlienHate = SENTINEL_HATE;
  assert.throws(() => intelligenceFilter.assertPlayerSnapshotSafe(withEconomics), /raw alien hate/);
});

test('local publish endpoint requires the runtime token and same-origin request', async () => {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;
    const runtime = await fetch(`${base}/api/runtime`).then(response => response.json());
    assert.equal(typeof runtime.publishToken, 'string');
    assert.ok(runtime.publishToken.length >= 32);

    const missingToken = await fetch(`${base}/api/publish`, {
      method: 'POST',
      headers: { Origin: base }
    });
    assert.equal(missingToken.status, 403);

    const crossOrigin = await fetch(`${base}/api/publish`, {
      method: 'POST',
      headers: {
        Origin: 'http://malicious.example',
        'X-TI-Publish-Token': runtime.publishToken
      }
    });
    assert.equal(crossOrigin.status, 403);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
