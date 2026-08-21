const { test } = require('node:test');
const assert = require('node:assert');

const snapshotBuilder = require('../server/snapshotBuilder');
const snapshotIdentity = require('../server/snapshotIdentity');
const intelligenceFilter = require('../server/intelligenceFilter');
const localResources = require('../server/intelResources');
const { makeSaveData } = require('./fixtures/syntheticSave');

const OBSERVER = 4712;

function omniscientSnapshot(options) {
  const raw = snapshotBuilder.buildRawSnapshot(makeSaveData(options));
  const identity = snapshotIdentity.createSnapshotIdentity(
    { fullPath: 'synthetic.gz', lastModified: new Date('2025-01-01T00:00:00Z'), saveHash: 'fixture' },
    'initiative'
  );
  snapshotIdentity.attachSnapshotIdentity(raw, identity);
  return intelligenceFilter.applyFilter(raw, 'omniscient', OBSERVER);
}

test('buildResource returns focused faction rows', () => {
  const snapshot = omniscientSnapshot();
  const all = localResources.buildResource(snapshot, 'factions', { mode: 'omniscient' });
  assert.strictEqual(all.success, true);
  assert.strictEqual(all.source, 'local');
  assert.strictEqual(all.count, 3);
  assert.strictEqual(all.items.length, 3);

  const own = localResources.buildResource(snapshot, 'factions', { factionId: OBSERVER, mode: 'omniscient' });
  assert.strictEqual(own.count, 1);
  assert.strictEqual(own.items[0].name, 'the Initiative');
  assert.strictEqual(own.items[0].controlPoints, 2);
});

test('buildResource projects nations and councilors', () => {
  const snapshot = omniscientSnapshot();
  const nations = localResources.buildResource(snapshot, 'nations', { mode: 'omniscient' });
  assert.strictEqual(nations.count, 2);
  const usa = nations.items.find(n => n.id === 1);
  assert.strictEqual(usa.gdp, 20e12);
  assert.strictEqual(usa.executiveFactionId, OBSERVER);

  const councilors = localResources.buildResource(snapshot, 'councilors', { factionId: OBSERVER, mode: 'omniscient' });
  assert.strictEqual(councilors.count, 1);
  assert.strictEqual(councilors.items[0].attributes.Persuasion, 10);
});

test('buildResource reports ships through fleet projection', () => {
  const snapshot = omniscientSnapshot({ ships: 2 });
  const ships = localResources.buildResource(snapshot, 'ships', { mode: 'omniscient', detail: 'full' });
  assert.strictEqual(ships.count, 2);
  assert.strictEqual(ships.items[0].fleetName, 'Belt Patrol');
  assert.ok(ships.items[0].spaceTheaterKey, 'shared ship rows include theater fields');
});

test('buildResource summary aggregates alien posture', () => {
  const snapshot = omniscientSnapshot();
  const summary = localResources.buildResource(snapshot, 'summary', { mode: 'omniscient' });
  assert.strictEqual(summary.factions.length, 3);
  assert.strictEqual(summary.alien.factionId, 4717);
  assert.strictEqual(summary.alien.fleets, 0);
  assert.ok(summary.alien.fleetsByBody, 'empty fleet aggregation is present');
  assert.ok(summary.alienHateEconomics, 'summary includes alien hate economics');
  assert.strictEqual(summary.alienHateEconomics.usedMissionControl, 10);
});

test('unknown resources are rejected', () => {
  const snapshot = omniscientSnapshot();
  assert.strictEqual(localResources.buildResource(snapshot, 'unknown', {}), null);
});

test('API discovery index lists focused routes', () => {
  assert.strictEqual(localResources.INTEL_ENDPOINT_INDEX.logistics, '/api/intel/logistics');
  assert.strictEqual(localResources.INTEL_ENDPOINT_INDEX.techTree, '/api/intel/tech-tree');
  assert.ok(Object.keys(localResources.INTEL_ENDPOINT_INDEX).length >= 30);
});

test('local wrapper and shared ESM module produce identical rows', async () => {
  const shared = await import('../shared/intelResources.mjs');
  const snapshot = omniscientSnapshot({ ships: 2 });
  const localFleetRow = localResources.buildResource(snapshot, 'fleets', { mode: 'omniscient', detail: 'full' }).items[0];
  const sharedFleetRow = shared.fleetResourceRow(snapshot.fleets[0]);
  assert.deepStrictEqual(localFleetRow, sharedFleetRow);

  const localShipRows = localResources.buildResource(snapshot, 'ships', { mode: 'omniscient', detail: 'full' }).items;
  const sharedShipRows = shared.shipResourceRows(snapshot.fleets, null, null);
  assert.deepStrictEqual(localShipRows, sharedShipRows);
});

// --- detail=summary|full ----------------------------------------------------
// `/api/intel/fleets` (909 KB) and `/api/intel/ships` (766 KB) were the only
// two focused endpoints an external analysis client could not consume. The
// default is now a manifest; `full` is the payload that used to be the default.

test('the default detail level is the small one, and full restores the old shape', () => {
  const snapshot = omniscientSnapshot({ ships: 2 });

  const defaulted = localResources.buildResource(snapshot, 'fleets', { mode: 'omniscient' });
  assert.strictEqual(defaulted.detail, 'summary', 'omitting ?detail must NOT return the heavy payload');
  assert.strictEqual(defaulted.query.detail, 'summary', 'the echo names the level that was applied');
  assert.strictEqual(defaulted.items[0].shipManifest, undefined,
    'the per-ship payload is what made this endpoint unusable; it must be opt-in');
  assert.strictEqual(defaulted.items[0].weaponBreakdown, undefined);
  assert.strictEqual(defaulted.shipsTotal, 2, 'the manifest still reports how many ships exist');
  assert.ok(defaulted.omittedInSummary.includes('shipManifest'),
    'a truncated view must announce what it dropped');

  const full = localResources.buildResource(snapshot, 'fleets', { mode: 'omniscient', detail: 'full' });
  assert.strictEqual(full.detail, 'full');
  assert.strictEqual(full.items[0].shipManifest.length, 2, 'full carries the per-ship rows');
  assert.ok(JSON.stringify(full).length > JSON.stringify(defaulted).length,
    'full must be the larger of the two, or the parameter is backwards');
});

test('the ships manifest is a roll-up that never loses a ship', () => {
  const snapshot = omniscientSnapshot({ ships: 2 });
  const summary = localResources.buildResource(snapshot, 'ships', { mode: 'omniscient' });

  assert.strictEqual(summary.detail, 'summary');
  assert.deepStrictEqual(summary.groupedBy, ['factionId', 'hullName', 'orbitBody'],
    'the grouping is stated, so grouped rows cannot be mistaken for truncated ones');
  assert.strictEqual(summary.count, summary.items.length, 'count always counts the rows it returns');
  assert.strictEqual(summary.shipsTotal, 2);
  assert.strictEqual(
    summary.items.reduce((sum, row) => sum + row.ships, 0),
    summary.shipsTotal,
    'the roll-up must account for every ship, not a capped slice'
  );
  assert.strictEqual(summary.items[0].hullName, 'Hull_Corvette');
  assert.strictEqual(summary.items[0].fleets, 1);

  const full = localResources.buildResource(snapshot, 'ships', { mode: 'omniscient', detail: 'full' });
  assert.strictEqual(full.count, summary.shipsTotal, 'full returns one row per ship');
});

test('only the five heavy endpoints honour detail, and the echo says so', async () => {
  const shared = await import('../shared/intelResources.mjs');
  // `military-value` joined fleets and ships on 2026-08-21: its full
  // seventeen-class candidate listing is a 559 KB response against a 146 KB
  // summary, which is the same reason the other two are detail-aware.
  // `economic-value` joined the same day: its full listing carries a per-effect
  // row for every uncompleted node that carries an effect, 603 KB unfiltered
  // against a 75 KB summary.
  // `research-ranking` joined on 2026-08-21 for the same reason it composes:
  // its full listing is every row of every availability group in both tracks
  // plus every candidate that could not be ranked, against a summary that is
  // the head of each group.
  assert.deepStrictEqual(
    Array.from(shared.DETAIL_AWARE_RESOURCES).sort(),
    ['economic-value', 'fleets', 'military-value', 'research-ranking', 'ships']
  );

  const snapshot = omniscientSnapshot();
  const habs = localResources.buildResource(snapshot, 'habs', { mode: 'omniscient', detail: 'full' });
  assert.strictEqual(habs.query.detail, undefined,
    'echoing detail on an endpoint that ignores it would imply the parameter did something');
});

test('a malformed detail level is rejected rather than silently defaulted', async () => {
  const shared = await import('../shared/intelResources.mjs');
  assert.strictEqual(shared.parseDetailLevel(undefined), 'summary', 'absent means the small default');
  assert.strictEqual(shared.parseDetailLevel(''), 'summary');
  assert.strictEqual(shared.parseDetailLevel('full'), 'full');
  assert.strictEqual(shared.parseDetailLevel('FULL'), null, 'the level is case-sensitive');
  assert.strictEqual(shared.parseDetailLevel('everything'), null,
    'answering a smaller question than the caller asked is the failure this endpoint is being fixed for');
});

test('the discovery index carries measured sizes and omits the ones it cannot measure', async () => {
  const shared = await import('../shared/intelResources.mjs');
  const snapshot = omniscientSnapshot({ ships: 2 });
  const measured = shared.measureIntelEndpointSizes(snapshot, { mode: 'omniscient' });

  assert.strictEqual(measured.basis.measurement, 'measured');
  assert.ok(measured.sizes.fleets.bytes > 0);
  assert.strictEqual(
    measured.sizes.fleets.bytes,
    Buffer.byteLength(JSON.stringify(shared.buildResourceProjection(snapshot, 'fleets', { mode: 'omniscient' })), 'utf8'),
    'the published byte count is the real one, not an estimate from a row count'
  );
  assert.strictEqual(measured.sizes.fleets.detail, 'summary');
  assert.ok(measured.sizes.fleets.fullBytes > measured.sizes.fleets.bytes,
    'the opt-in cost of detail=full is published alongside the default');

  // Endpoints with no honest measurement are ABSENT from `sizes`, with a
  // reason, rather than carrying an invented number.
  for (const key of ['mobility', 'productionPlan', 'delta', 'techTree', 'history', 'latestThreats']) {
    assert.strictEqual(measured.sizes[key], undefined, `${key} has no honest unfiltered size`);
    assert.ok(measured.unavailable[key], `${key} must say why its size is missing`);
  }
});

// --- Mining prospects --------------------------------------------------------
// Ranks UNOWNED sites as expansion targets. Two percentiles per resource,
// because "best of its type" and "good in absolute terms" are different
// questions -- conflating them is what led to treating generic Common
// Carbonaceous sites as notable producers.
const { miningProspectsResource } = require('../shared/intelResources.mjs');

function siteFixture() {
  return {
    habSites: [
      // Genuinely rich metallic site, unowned.
      { ID: 1, displayName: 'Hertha', parentBodyName: 'Hertha', spaceTheaterKey: 'belt',
        miningProfileName: 'MetallicMine', factionId: null, factionName: 'Unclaimed',
        water: 0, volatiles: 0, metals: 5.0, nobleMetals: 2.5, fissiles: 0 },
      // Generic carbonaceous, unowned -- shares its profile with many peers.
      { ID: 2, displayName: 'Fortuna', parentBodyName: 'Fortuna', spaceTheaterKey: 'belt',
        miningProfileName: 'CarbonaceousMine', factionId: null, factionName: 'Unclaimed',
        water: 3.5, volatiles: 5.0, metals: 0, nobleMetals: 0, fissiles: 0 },
      { ID: 3, displayName: 'Zelinda', parentBodyName: 'Zelinda', spaceTheaterKey: 'belt',
        miningProfileName: 'CarbonaceousMine', factionId: null, factionName: 'Unclaimed',
        water: 3.5, volatiles: 5.0, metals: 0, nobleMetals: 0, fissiles: 0 },
      // Already ours -- must never be offered as an expansion target.
      { ID: 4, displayName: 'Aspasia', parentBodyName: 'Aspasia', spaceTheaterKey: 'belt',
        miningProfileName: 'MixedCMMine', factionId: 4712, factionName: 'the Initiative',
        water: 2, volatiles: 3, metals: 3, nobleMetals: 1, fissiles: 0 },
      // Different theater.
      { ID: 5, displayName: 'Tolkien Crater', parentBodyName: 'Mercury', spaceTheaterKey: 'inner',
        miningProfileName: 'MercuryPolarMine', factionId: null, factionName: 'Unclaimed',
        water: 1, volatiles: 0, metals: 2, nobleMetals: 0.9, fissiles: 0 }
    ]
  };
}

test('mining prospects exclude owned sites', () => {
  const result = miningProspectsResource(siteFixture());
  const names = result.ranked.map(r => r.name);
  assert.ok(!names.includes('Aspasia'), 'an owned site is not an expansion target');
  assert.strictEqual(result.unownedSites, 4);
  assert.strictEqual(result.totalSites, 5);
});

test('scarcity weighting ranks nobles above raw bulk', () => {
  const [top] = miningProspectsResource(siteFixture()).ranked;
  // Hertha: 5 metals x1 + 2.5 nobles x3 = 12.5
  // Fortuna: 3.5 water x1 + 5 volatiles x1.5 = 11.0
  assert.strictEqual(top.name, 'Hertha');
  assert.strictEqual(top.scarcityScore, 12.5);
});

test('identical generic sites land mid-band in their profile, not top', () => {
  const result = miningProspectsResource(siteFixture());
  const fortuna = result.ranked.find(r => r.name === 'Fortuna');
  assert.strictEqual(fortuna.profilePeerCount, 2, 'Fortuna and Zelinda share a profile');
  // Tied with its only peer, so a midpoint rank puts it at 50, not 100.
  assert.strictEqual(fortuna.resources.water.profilePercentile, 50);

  // Water across all five fixtures: 0, 3.5, 3.5, 2, 1 -> midpoint rank for 3.5
  // is (3 below + 2 equal / 2) / 5 = 80.
  assert.strictEqual(fortuna.resources.water.globalPercentile, 80);
});

test('theater filter keeps unreachable prospects out', () => {
  const belt = miningProspectsResource(siteFixture(), { theater: 'belt' });
  assert.strictEqual(belt.unownedSites, 3);
  assert.ok(belt.ranked.every(r => r.name !== 'Tolkien Crater'));

  const inner = miningProspectsResource(siteFixture(), { theater: 'inner' });
  assert.strictEqual(inner.unownedSites, 1);
  assert.strictEqual(inner.ranked[0].name, 'Tolkien Crater');
});

test('local mining-prospects uses canonical theater and limit parameters', () => {
  const result = localResources.buildResource(siteFixture(), 'mining-prospects', {
    theater: 'belt',
    limit: 1,
    mode: 'omniscient'
  });
  assert.equal(result.query.theater, 'belt');
  assert.equal(result.query.limit, 1);
  assert.equal(result.count, 1);
  assert.equal(result.items[0].name, 'Hertha');
});

test('shared dispatcher and local adapter agree on mining projections', async () => {
  const shared = await import('../shared/intelResources.mjs');
  const snapshot = siteFixture();
  const local = localResources.buildResource(snapshot, 'mining-prospects', { theater: 'belt', limit: 2 }).items;
  const pure = shared.buildResourceProjection(snapshot, 'mining-prospects', { theater: 'belt', limit: 2 }).items;
  assert.deepStrictEqual(local, pure);
});

// --- Production plan: never invent a design, never invent its cost -----------
// This endpoint is documented for external analysis clients, so a confident
// wrong answer propagates straight into someone else's reasoning.

const {
  productionPlanResource,
  mobilityResource,
  summaryResource,
  miningResourceRow,
  shipDesignsResource,
  buildResourceProjection,
  SUPPORTED_RESOURCES,
  INTEL_ENDPOINT_INDEX,
  INTEL_ENDPOINT_EXAMPLES
} = require('../shared/intelResources.mjs');

function productionFixture() {
  return {
    factions: [
      { ID: 4712, displayName: 'the Initiative', resources: { Water: 900, Volatiles: 400, Metals: 2000, NobleMetals: 300, Fissiles: 40 } }
    ],
    shipDesigns: [
      { dataName: 'playerShipTemplate584', _displayName: 'Devilfish Block 2', hullName: 'Escort' },
      { dataName: 'playerShipTemplate58', _displayName: 'Angara', hullName: 'Destroyer' }
    ],
    shipHullStats: { Escort: { missionControl: 1, baseConstructionTimeDays: 90 } },
    habModules: [
      { id: 1, factionId: 4712, isShipyard: true, constructionCompleted: true, habName: 'Anchorage', orbitBody: 'Earth Orbit', habTier: 2 }
    ]
  };
}

test('an unknown ship design is an error, never a fabricated Battlecruiser', () => {
  const plan = productionPlanResource(productionFixture(), 'TotallyMadeUpDesign_XYZ', 4, 4712);

  assert.ok(plan.error, 'an unresolvable design must report an error');
  assert.strictEqual(plan.designAvailable, false);
  assert.strictEqual(plan.designId, null, 'never stamp the requested id onto invented data');
  assert.strictEqual(plan.requestedDesignId, 'TotallyMadeUpDesign_XYZ');
  // The specific fabrication that used to be returned.
  const json = JSON.stringify(plan);
  assert.ok(!/Battlecruiser Standard/.test(json), 'no invented design name');
  assert.ok(!/410/.test(json), 'no invented metals cost');
  assert.ok(plan.availableDesigns.some(d => d.designId === 'playerShipTemplate584'),
    'the caller is told what it could have asked for');
});

test('a missing design id is an error rather than silently picking the first design', () => {
  const plan = productionPlanResource(productionFixture(), null, 1, 4712);
  assert.ok(plan.error);
  assert.strictEqual(plan.designAvailable, false);
  assert.strictEqual(plan.designId, null);
  assert.ok(!/playerShipTemplate584"/.test(JSON.stringify({ designId: plan.designId })),
    'designs[0] is not silently substituted for the request');
});

test('a resolvable design reports UNAVAILABLE costs rather than a constant', () => {
  // Real saves record a design as a component list, not a resource bill. The
  // old code quoted a fixed 180/90/410/102/20 for every design in the game.
  const plan = productionPlanResource(productionFixture(), 'playerShipTemplate584', 4, 4712);

  assert.strictEqual(plan.designAvailable, true);
  assert.strictEqual(plan.designId, 'playerShipTemplate584');
  assert.strictEqual(plan.costAvailable, false);
  assert.strictEqual(plan.unitCost, null, 'absent stays null');
  assert.strictEqual(plan.totalCost, null);
  assert.strictEqual(plan.canAffordNow, null, 'affordability derived from unknown cost is unknown');
  assert.strictEqual(plan.maxAffordableNow, null);
  assert.ok(plan.costUnavailableReason);
  assert.ok(plan.unavailableFields.includes('unitCost'));
  // Build time IS measured, from the hull template.
  assert.strictEqual(plan.buildTimeDays, 90);
  assert.strictEqual(plan.buildTimeSource, 'hull-template');
  assert.strictEqual(plan.earliestCompletionDays, 360, '4 ships / 1 yard x 90 days');
});

test('a design that does carry a cost is still costed normally', () => {
  const snapshot = productionFixture();
  snapshot.shipDesigns[0].constructionCost = { water: 10, metals: 100, nobleMetals: 5 };
  const plan = productionPlanResource(snapshot, 'playerShipTemplate584', 2, 4712);

  assert.strictEqual(plan.costAvailable, true);
  assert.strictEqual(plan.unitCost.metals, 100);
  assert.strictEqual(plan.totalCost.metals, 200);
  assert.strictEqual(plan.canAffordNow, true, '2000 metals covers 200');
  // water 900/10 = 90, metals 2000/100 = 20, nobles 300/5 = 60.
  assert.strictEqual(plan.bottleneckResource, 'metals', 'metals is the tightest ratio');
  assert.strictEqual(plan.maxAffordableNow, 20);
});

test('an unknown stockpile makes affordability unknown, not affordable', () => {
  const snapshot = productionFixture();
  snapshot.shipDesigns[0].constructionCost = { metals: 100 };
  delete snapshot.factions[0].resources.Metals;
  const plan = productionPlanResource(snapshot, 'playerShipTemplate584', 1, 4712);
  assert.strictEqual(plan.canAffordNow, null, 'unknown stock is neither enough nor zero');
});

test('ship designs report an unavailable construction cost, not an invented one', () => {
  const [escort] = shipDesignsResource(productionFixture());
  assert.strictEqual(escort.constructionCost, null);
  assert.strictEqual(escort.constructionCostAvailable, false);
  assert.strictEqual(escort.isEstimatedCost, false, 'a constant is not an estimate');
  assert.strictEqual(escort.buildTimeDays, 90);
});

// --- Mobility: answer about the fleet that was asked about, or not at all ----

function mobilityFixture() {
  return {
    metadata: { gameTimeString: '5/1/2033 12:00:00 AM' },
    fleets: [
      { ID: 43752, displayName: 'India-211', factionId: 4712, orbitBody: 'Luna',
        lowestDeltaVKps: 20.1, lowestCombatAccelerationMps2: 0.33 },
      { ID: 46207, displayName: 'Sierra-9', factionId: 4712, orbitBody: 'Mars',
        lowestDeltaVKps: 8.0, lowestCombatAccelerationMps2: 1.1 },
      { ID: 99001, displayName: 'Alien Swarm', factionId: 4717, orbitBody: 'Earth' }
    ]
  };
}

test('an unknown fleet id is an error, not some other fleet', () => {
  const mob = mobilityResource(mobilityFixture(), '999999999', 4712);

  assert.ok(mob.error, 'an unresolvable fleet must report an error');
  assert.strictEqual(mob.fleetId, null, 'never relabel a different fleet with the requested id');
  assert.strictEqual(mob.requestedFleetId, '999999999');
  assert.deepStrictEqual(mob.transfers, [], 'no travel numbers for a fleet we did not find');
  const json = JSON.stringify(mob);
  assert.ok(!/India-211/.test(json), 'the first observer fleet is not substituted');
  assert.deepStrictEqual(mob.availableFleetIds, [43752, 46207], 'only the observer\'s own fleets are offered');
});

test('an omitted fleet id is an error rather than a default fleet', () => {
  const mob = mobilityResource(mobilityFixture(), null, 4712);
  assert.ok(mob.error);
  assert.strictEqual(mob.fleetId, null);
  assert.deepStrictEqual(mob.transfers, []);
});

test('a known fleet still resolves, including when the id arrives as a string', () => {
  const numeric = mobilityResource(mobilityFixture(), 46207, 4712);
  const stringy = mobilityResource(mobilityFixture(), '46207', 4712);
  assert.strictEqual(numeric.fleetId, 46207);
  assert.strictEqual(stringy.fleetId, 46207, 'query-string ids are numbers too');
  assert.strictEqual(numeric.fleetName, 'Sierra-9');
  assert.strictEqual(numeric.performanceMeasured, true);
});

test('an unmeasured fleet reports feasibility as unknown, never as feasible', () => {
  // The old code substituted 25 km/s of delta-V and 1.2 m/s^2 for an
  // unmeasured fleet, which declared it capable of reaching Titan.
  const mob = mobilityResource(mobilityFixture(), 99001, 4717);
  assert.strictEqual(mob.fleetDeltaVKps, null, 'absent stays null');
  assert.strictEqual(mob.fleetCombatAccelerationMps2, null);
  assert.strictEqual(mob.performanceMeasured, false);
  const titan = mob.transfers.find(t => t.destination === 'Titan');
  assert.strictEqual(titan.feasible, null, 'unknown is not the same as feasible');
  assert.strictEqual(titan.travelDays, null);
  assert.strictEqual(titan.arrivalDate, null);
  assert.match(titan.warning, /UNAVAILABLE/);
});

// --- Id type collisions ------------------------------------------------------

test('string faction ids still match the alien order of battle', () => {
  // Snapshots reach these projections from the parser, from Supabase JSON and
  // from query strings. A strict === between '4717' and 4717 returns EMPTY
  // rather than erroring, which reads as "the aliens have no forces".
  const snapshot = {
    factions: [
      { ID: 4712, displayName: 'the Initiative' },
      { ID: '4717', displayName: 'the Aliens' }
    ],
    fleets: [{ ID: 1, factionId: 4717, shipsCount: 19, orbitBody: 'Earth' }],
    habs: [{ ID: 2, factionId: '4717', orbitBody: 'Earth' }],
    habSites: [{ ID: 3, factionId: 4717, parentBodyName: 'Earth' }],
    councilors: [{ ID: 4, factionId: '4717' }]
  };

  const summary = summaryResource(snapshot);
  assert.strictEqual(summary.alien.fleets, 1, 'a string faction id must still match');
  assert.strictEqual(summary.alien.ships, 19);
  assert.strictEqual(summary.alien.habs, 1);
  assert.strictEqual(summary.alien.councilors, 1);

  const alien = buildResourceProjection(snapshot, 'alien', {});
  assert.strictEqual(alien.alienFactionResolved, true);
  assert.strictEqual(alien.fleets.length, 1);
  assert.strictEqual(alien.habs.length, 1);
  assert.strictEqual(alien.habSites.length, 1);
  assert.strictEqual(alien.councilors.length, 1);
});

// --- Absent stays null -------------------------------------------------------

test('a site with no measured rates reports unmeasured output, not zero', () => {
  const unmeasured = miningResourceRow({ ID: 1, displayName: 'Unsurveyed', resourceRateUnit: 'day' });
  assert.strictEqual(unmeasured.effectiveMonthlyOutput, null,
    'an unsurveyed site is not a barren site');
  assert.strictEqual(unmeasured.effectiveMonthlyOutputMeasured, false);

  const barren = miningResourceRow({
    ID: 2, displayName: 'Barren', resourceRateUnit: 'day',
    water: 0, volatiles: 0, metals: 0, nobleMetals: 0, fissiles: 0
  });
  assert.strictEqual(barren.effectiveMonthlyOutput, 0, 'a measured zero must still read as zero');
  assert.strictEqual(barren.effectiveMonthlyOutputMeasured, true);

  const measured = miningResourceRow({
    ID: 3, displayName: 'Hertha', resourceRateUnit: 'day',
    water: 1, volatiles: 1, metals: 1, nobleMetals: 1, fissiles: 1
  });
  assert.strictEqual(measured.effectiveMonthlyOutput, 150, '5 x 30 days');
});

test('redacted alien hate produces no delta rather than a delta from zero', () => {
  // Player mode can withhold assessedAlienHateOfMe. `?? 0` turned that into a
  // confident "hate 0" -- an unmeasured value rendered as "no threat at all".
  const withHate = {
    metadata: { gameTimeString: '5/1/2033 12:00:00 AM' },
    factions: [{ ID: 4712, displayName: 'the Initiative', shipsCount: 20, assessedAlienHateOfMe: 49.4, resources: {} },
               { ID: 4717, displayName: 'the Aliens', shipsCount: 300 }]
  };
  const redacted = JSON.parse(JSON.stringify(withHate));
  delete redacted.factions[0].assessedAlienHateOfMe;

  const delta = buildResourceProjection(redacted, 'delta', { previousSnapshot: withHate });
  assert.strictEqual(delta.changes.alienHate.to, null, 'absent stays null');
  assert.strictEqual(delta.changes.alienHate.diff, null, 'no fabricated -49.4 collapse');
  assert.strictEqual(delta.changes.alienHate.available, false);
  assert.ok(delta.events.some(e => /UNAVAILABLE/.test(e)),
    'an unevaluable check must say so, not fall through to "unchanged"');

  const known = buildResourceProjection(withHate, 'delta', { previousSnapshot: withHate });
  assert.strictEqual(known.changes.alienHate.diff, 0, 'a genuinely unchanged value still reads as 0');
});

test('an absent previous ship count is uncomparable, not unchanged', () => {
  const current = {
    metadata: { gameTimeString: '5/1/2033 12:00:00 AM' },
    factions: [{ ID: 4712, shipsCount: 20, resources: {} }]
  };
  const previous = { metadata: { gameTimeString: '4/1/2033 12:00:00 AM' }, factions: [{ ID: 4712, resources: {} }] };
  const delta = buildResourceProjection(current, 'delta', { previousSnapshot: previous });
  assert.strictEqual(delta.changes.initiativeShips.from, null);
  assert.strictEqual(delta.changes.initiativeShips.diff, null, 'never a fabricated zero change');
});

// --- One endpoint registry ---------------------------------------------------

test('the endpoint registry, resource set and examples cannot drift apart', () => {
  // These were three separately hand-maintained lists; mining-expansion had
  // already reached two of them and not the third.
  for (const resource of SUPPORTED_RESOURCES) {
    const key = Object.keys(INTEL_ENDPOINT_INDEX)
      .find(k => INTEL_ENDPOINT_INDEX[k] === `/api/intel/${resource}`);
    assert.ok(key, `${resource} is dispatchable but missing from the discovery index`);
    assert.ok(INTEL_ENDPOINT_EXAMPLES[key], `${resource} has no example query`);
  }
  assert.deepStrictEqual(
    Object.keys(INTEL_ENDPOINT_INDEX),
    Object.keys(INTEL_ENDPOINT_EXAMPLES),
    'index and examples must describe exactly the same endpoints'
  );
  assert.ok(SUPPORTED_RESOURCES.has('mining-expansion'));
  assert.strictEqual(INTEL_ENDPOINT_INDEX.miningExpansion, '/api/intel/mining-expansion');
  assert.ok(INTEL_ENDPOINT_EXAMPLES.miningExpansion, 'the drift this registry exists to prevent');
});

// The dispatcher was the THIRD hand-maintained list -- an if/switch chain that
// a `switch` statement made impossible to derive from the table. It is a
// per-row `project` handler now, and `projected` is derived from that handler's
// existence, so an endpoint cannot be advertised as dispatchable without one.

/** Populated enough that every handler has something to project. */
function dispatchFixture() {
  return {
    observerFactionId: OBSERVER,
    metadata: { gameTimeString: '5/1/2033 12:00:00 AM', difficulty: 'Normal' },
    factions: [
      { ID: OBSERVER, displayName: 'the Initiative', resources: { Metals: 10 } },
      { ID: 4717, displayName: 'the Servants' }
    ],
    nations: [{ ID: 1, displayName: 'USA', executiveFactionId: OBSERVER }],
    councilors: [{ ID: 7, displayName: 'Agent', factionId: OBSERVER }],
    habs: [{ ID: 2, displayName: 'Anchorage', factionId: OBSERVER, orbitBody: 'Earth' }],
    habSites: [{
      ID: 3, displayName: 'Hertha', factionId: null, factionName: 'Unclaimed',
      parentBodyName: 'Hertha', spaceTheaterKey: 'belt',
      water: 1, volatiles: 1, metals: 1, nobleMetals: 1, fissiles: 1
    }],
    habModules: [{ id: 4, factionId: OBSERVER, habId: 2, isShipyard: true, constructionCompleted: true, orbitBody: 'Earth' }],
    fleets: [{
      ID: 5, displayName: 'India-211', factionId: OBSERVER, orbitBody: 'Luna',
      destination: 'Mars', arrivalDate: '6/1/2033 12:00:00 AM',
      shipsCount: 1, ships: [{ id: 6, displayName: 'Devilfish' }]
    }],
    shipyardQueues: [{ id: 8, factionId: OBSERVER, orbitBody: 'Earth', design: 'playerShipTemplate584', constructionStatus: 'building' }],
    shipyardStations: [{ id: 9, name: 'Yard', factionId: OBSERVER, orbitBody: 'Earth' }],
    shipDesigns: [{ dataName: 'playerShipTemplate584', _displayName: 'Devilfish', hullName: 'Escort', factionId: OBSERVER }],
    globalResearch: { activeSlots: [{ slotNumber: 1, projectId: 'p', displayName: 'P' }], finishedTechsNames: ['MissiontotheAsteroids'] },
    capabilities: { skywatch: true }
  };
}

test('the dispatcher is derived from the endpoint table, not a third list', () => {
  // Only the endpoints the ADAPTERS serve themselves carry no handler: history
  // and strategic-delta need snapshot storage, and the tech-graph family needs
  // shared/techGraph.mjs plus a published techTree payload.
  const adapterServed = Object.keys(INTEL_ENDPOINT_INDEX)
    .filter(key => !SUPPORTED_RESOURCES.has(INTEL_ENDPOINT_INDEX[key].replace('/api/intel/', '')));
  assert.deepStrictEqual(adapterServed, [
    'history', 'strategicDelta', 'techTree', 'techPath', 'techSearch',
    'techMilestones', 'techMatrix', 'techOpportunities', 'researchQueue',
    'latestThreats', 'latestWarRoom', 'latestSnapshot'
  ], 'every other endpoint must reach a projection handler');

  // The bare two-key envelope is what an UNRECOGNISED resource gets...
  assert.deepStrictEqual(
    buildResourceProjection({ factions: [] }, 'no-such-resource', {}),
    { count: 0, items: [] }
  );

  // ...so no advertised resource may produce it. A resource that silently fell
  // out of the dispatch table would land here rather than 404, which is how the
  // three lists hid their drift in the first place.
  for (const resource of SUPPORTED_RESOURCES) {
    const projection = buildResourceProjection(dispatchFixture(), resource, {
      mode: 'omniscient',
      fleetId: 5,
      designId: 'playerShipTemplate584'
    });
    assert.ok(projection && typeof projection === 'object', `${resource} must dispatch`);
    assert.notDeepStrictEqual(projection, { count: 0, items: [] },
      `${resource} fell through to the unknown-resource fallback`);
  }
});
