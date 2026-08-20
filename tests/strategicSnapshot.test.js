const { test } = require('node:test');
const assert = require('node:assert');

const {
  buildStrategicSnapshot,
  deriveEvents,
  STRATEGIC_SNAPSHOT_SCHEMA,
  MINE_LIMIT_GRANTS
} = require('../shared/strategicSnapshot.mjs');

const OBSERVER = 4712;

// Minimal raw snapshot in the shape snapshotBuilder produces.
function rawSnapshot(overrides = {}) {
  return {
    metadata: {
      fileName: 'Autosave.gz',
      lastModified: '2026-08-19T21:34:42.607Z',
      gameTimeString: '6/1/2032 12:00:00 AM',
      difficulty: 'Normal',
      campaignStartYear: 2022
    },
    factions: [
      {
        ID: OBSERVER,
        displayName: 'the Initiative',
        controlPointsCount: 24, nationsCount: 5, habsCount: 2,
        fleetsCount: 1, shipsCount: 3, totalGdp: 44260000000000, totalResearch: 2022,
        assessedAlienHateOfMe: 34.6664,
        missionControlUsage: 67, missionControlCapacity: 151,
        resources: { Money: 53828, Boost: 1760.1, Water: 1050.67, Volatiles: 8166.22,
                     Metals: 2980.49, NobleMetals: 3074.53, Fissiles: 312.41,
                     Antimatter: 0, Exotics: 4.67 },
        monthlyNet: { Research: 2609, Water: 71.1, Volatiles: 93.75, Metals: 296.64,
                      NobleMetals: 96.85, Fissiles: 2.88, Antimatter: 0, Exotics: 0 },
        completedProjects: [],
        currentProjects: [{ projectId: 'Project_AudienceResearch', accumulatedResearch: 43, totalCost: 100 }]
      },
      { ID: 4717, displayName: 'the Aliens', habsCount: 24, fleetsCount: 54, shipsCount: 161 }
    ],
    globalResearch: {
      finishedTechsNames: ['MissiontotheMoon', 'MissiontoMars', 'MissiontotheAsteroids'],
      activeSlots: [{ techId: 'DeuteriumTritiumFusion', accumulatedResearch: 19495, totalCost: 50000 }]
    },
    fleets: [
      { ID: 900, factionId: OBSERVER, shipsCount: 3, orbitBody: 'Mars',
        lowestDeltaVKps: 21.8, lowestCombatAccelerationMps2: 9.7, mission: 'Stationary / Patrol',
        ships: [
          { id: 1, hullName: 'Patapsco' },
          { id: 2, hullName: 'Patapsco' },
          { id: 3, hullName: 'Cimarron' }
        ] },
      { ID: 901, factionId: 4717, shipsCount: 19, orbitBody: 'Earth',
        destination: 'Mars', destinationId: 700, destinationType: 'hab',
        arrivalDate: '2031-10-26',
        weaponBreakdown: [
          { role: 'Point Defense', count: 11, systems: [] },
          { role: 'Laser', count: 9, systems: [] }
        ] },
      { ID: 902, factionId: 4714, shipsCount: 2, orbitBody: 'Venus', destination: 'Mercury' }
    ],
    habs: [
      { ID: 700, factionId: OBSERVER, orbitBody: 'Mars', tier: 2 },
      { ID: 701, factionId: OBSERVER, orbitBody: 'Luna', tier: 1 },
      { ID: 800, factionId: 4717, orbitBody: 'Earth', tier: 3 }
    ],
    habModules: [
      { id: 10, habId: 700, factionId: OBSERVER, templateName: 'Shipyard', isShipyard: true,
        constructionStatus: 'operational', constructionCompleted: true },
      { id: 11, habId: 700, factionId: OBSERVER, templateName: 'ColonyMiningComplex',
        constructionStatus: 'operational', constructionCompleted: true },
      { id: 12, habId: 701, factionId: OBSERVER, templateName: 'Shipyard', isShipyard: true,
        constructionStatus: 'under_construction', constructionCompleted: false,
        completionDate: '2032-09-02', orbitBody: 'Luna' }
    ],
    habSites: [
      { ID: 50, displayName: 'Hertha', factionId: OBSERVER, mineModuleId: 11, mineTier: 3 },
      { ID: 51, displayName: 'Aspasia', factionId: 4714, mineModuleId: 99, mineTier: 2 }
    ],
    shipyardQueues: [
      { id: 'q1', factionId: OBSERVER, design: 'Patapsco', orbitBody: 'Mars', completionDate: '2032-10-17' }
    ],
    // Static data that must never reach the compact document.
    techTree: { nodes: new Array(500).fill({ id: 'x', cost: 1 }) },
    shipHullStats: { Escort: { missionControl: 1 } },
    nations: new Array(200).fill({ id: 1, name: 'A' }),
    councilors: new Array(40).fill({ id: 1, name: 'B' }),
    ...overrides
  };
}

const build = (overrides, opts) =>
  buildStrategicSnapshot(rawSnapshot(overrides), { observerFactionId: OBSERVER, campaignKey: 'initiative', ...opts });

test('produces a versioned, self-describing document', () => {
  const doc = build();
  assert.strictEqual(doc.schema, STRATEGIC_SNAPSHOT_SCHEMA);
  assert.strictEqual(doc.meta.campaignKey, 'initiative');
  assert.strictEqual(doc.meta.difficulty, 'Normal');
  assert.strictEqual(doc.summary.observerFactionId, OBSERVER);
});

test('excludes static template data entirely', () => {
  const doc = build();
  const json = JSON.stringify(doc);
  for (const banned of ['techTree', 'shipHullStats', 'councilors', 'nations']) {
    assert.ok(!Object.hasOwn(doc, banned), `${banned} must not be a top-level key`);
  }
  // The fixture's static blobs would be unmistakable if they leaked.
  assert.ok(!json.includes('DeuteriumTritiumFusion"') || doc.research.global.length > 0,
    'only research progress may reference tech ids');
  assert.ok(json.length < 250 * 1024, 'hard size ceiling');
});

test('stays far under the size budget', () => {
  const bytes = Buffer.byteLength(JSON.stringify(build()));
  assert.ok(bytes < 100 * 1024, `expected < 100 KB, got ${(bytes / 1024).toFixed(1)} KB`);
});

test('records economy as [stockpile, monthlyNet] tuples', () => {
  const { economy } = build();
  assert.deepStrictEqual(economy.resources.nobles, [3074.5, 96.9]);
  assert.deepStrictEqual(economy.mc, { used: 67, cap: 151, minePenalty: 0 });
});

test('computes the mine limit from completed mission techs', () => {
  // Fixture completes Moon (3) + Mars (6) + Asteroids (6) = 15.
  const { economy } = build();
  assert.strictEqual(economy.mines.limit, 15);
  assert.strictEqual(economy.mines.count, 1, 'only observer-owned mined sites count');
  assert.strictEqual(economy.mc.minePenalty, 0, 'under the limit, no penalty');
});

test('applies the quadratic mine penalty past the limit', () => {
  const sites = [];
  for (let i = 0; i < 25; i++) {
    sites.push({ ID: i, displayName: `Site${i}`, factionId: OBSERVER, mineModuleId: i, mineTier: 1 });
  }
  const { economy } = build({ habSites: sites });
  assert.strictEqual(economy.mines.count, 25);
  assert.strictEqual(economy.mines.limit, 15);
  // excess 10 -> Max(1, Floor(100/2)) = 50
  assert.strictEqual(economy.mc.minePenalty, 50);
});

test('mine limit grants match the verified 1.0 totals', () => {
  const missionTechs = Object.entries(MINE_LIMIT_GRANTS)
    .filter(([id]) => id.startsWith('Missionto'))
    .reduce((sum, [, grant]) => sum + grant, 0);
  assert.strictEqual(missionTechs, 36, 'seven mission techs total 36');
  assert.strictEqual(missionTechs + MINE_LIMIT_GRANTS.Project_GoldRush, 42, 'Project Exodus reaches 42');
});

test('alien threat uses the corrected hate model', () => {
  const { alienThreat } = build();
  assert.strictEqual(alienThreat.usedMC, 67);
  assert.strictEqual(alienThreat.minimumHate, 20.1, '67 x 0.30');
  assert.strictEqual(alienThreat.warThreshold, 50);
  assert.strictEqual(alienThreat.mcWarFloor, 166, 'wiki table, Normal, no concealment');
  assert.strictEqual(alienThreat.retaliationActive, false, '34.67 is below 50');
  assert.strictEqual(alienThreat.yearsElapsed, 10, '2032 minus 2022');
});

test('theaters aggregate [ships, fleets, habs] per faction per body', () => {
  const mars = build().theaters.find((t) => t.body === 'Mars');
  assert.deepStrictEqual(mars.f[OBSERVER], [3, 1, 1]);
  const earth = build().theaters.find((t) => t.body === 'Earth');
  assert.deepStrictEqual(earth.f[4717], [19, 1, 1]);
});

test('ship ledger lists living ships as [id, design, fleet]', () => {
  const { ships } = build();
  assert.strictEqual(ships.length, 3);
  assert.deepStrictEqual(ships[0], [1, 'Patapsco', 900]);
});

test('friendly fleets carry compact design manifests', () => {
  const [fleet] = build().friendlyFleets;
  assert.strictEqual(fleet.id, 900);
  assert.deepStrictEqual(fleet.designs.sort(), [['Cimarron', 1], ['Patapsco', 2]].sort());
});

test('hostile weapon mix is collapsed to counts', () => {
  const contact = build().hostileContacts.find((c) => c.id === 901);
  assert.deepStrictEqual(contact.weaponMix, { pd: 11, laser: 9 });
  // The verbose source array must not survive.
  assert.ok(!JSON.stringify(contact).includes('systems'));
});

test('transfers keep only our movements and inbound threats', () => {
  const { transfers } = build();
  const ids = transfers.map((t) => t.fleet);
  assert.ok(ids.includes(901), 'alien fleet inbound to our Mars hab is kept');
  assert.ok(!ids.includes(902), 'unrelated Venus->Mercury traffic is dropped');
});

test('infrastructure counts only operational modules', () => {
  const mars = build().infrastructure.find((h) => h.id === 700);
  assert.strictEqual(mars.yards, 1);
  assert.strictEqual(mars.mine, 1);
  const luna = build().infrastructure.find((h) => h.id === 701);
  assert.strictEqual(luna.yards, 0, 'under-construction shipyard is not counted as capacity');
});

test('construction includes in-flight ships and modules', () => {
  const { construction } = build();
  assert.ok(construction.some((c) => c.type === 'ship' && c.design === 'Patapsco'));
  assert.ok(construction.some((c) => c.type === 'module' && c.template === 'Shipyard'));
});

// --- events ----------------------------------------------------------------

test('derives ship losses by design', () => {
  const previous = build();
  const current = build({
    fleets: [{ ID: 900, factionId: OBSERVER, shipsCount: 1, orbitBody: 'Mars',
               ships: [{ id: 1, hullName: 'Patapsco' }] }]
  });
  const loss = deriveEvents(previous, current).find((e) => e.type === 'ship_loss');
  assert.strictEqual(loss.count, 2);
  assert.deepStrictEqual(loss.designs.sort(), [['Cimarron', 1], ['Patapsco', 1]].sort());
});

test('derives hab loss', () => {
  const previous = build();
  const current = build({ habs: [{ ID: 700, factionId: OBSERVER, orbitBody: 'Mars', tier: 2 }] });
  const lost = deriveEvents(previous, current).find((e) => e.type === 'hab_lost');
  assert.strictEqual(lost.id, 701);
});

test('flags crossing the alien war threshold in both directions', () => {
  const below = build();
  const above = build({
    factions: [{ ...rawSnapshot().factions[0], assessedAlienHateOfMe: 62.4 }, rawSnapshot().factions[1]]
  });

  const up = deriveEvents(below, above).find((e) => e.type === 'hate_threshold_crossed');
  assert.strictEqual(up.direction, 'up');
  assert.strictEqual(up.threshold, 50);

  const down = deriveEvents(above, below).find((e) => e.type === 'hate_threshold_crossed');
  assert.strictEqual(down.direction, 'down');
});

test('no events on the first snapshot', () => {
  assert.deepStrictEqual(build().events, []);
});

test('each snapshot is independently readable', () => {
  // Round-trips through JSON with no reference to any other snapshot.
  const doc = build();
  const revived = JSON.parse(JSON.stringify(doc));
  assert.strictEqual(revived.schema, STRATEGIC_SNAPSHOT_SCHEMA);
  assert.strictEqual(revived.alienThreat.minimumHate, 20.1);
  assert.strictEqual(revived.theaters.length, doc.theaters.length);
});

test('absent source fields report unknown rather than zero', () => {
  // Snapshots published by older parser versions have no missionControlUsage.
  // Coercing that to 0 would claim the faction ran no mission control, which
  // is the "unknown as zero" fault this project explicitly forbids.
  const base = rawSnapshot();
  const observer = { ...base.factions[0] };
  delete observer.missionControlUsage;
  delete observer.missionControlCapacity;
  delete observer.resources.NobleMetals;

  const { economy } = build({ factions: [observer, base.factions[1]] });
  assert.strictEqual(economy.mc.used, null);
  assert.strictEqual(economy.mc.cap, null);
  assert.deepStrictEqual(economy.resources.nobles, [null, 96.9]);
  // A real zero must still read as zero.
  assert.deepStrictEqual(economy.resources.antimatter, [0, 0]);
});

test('redacted alien hate reports unknown, not zero', () => {
  // Player-mode snapshots redact assessedAlienHateOfMe. Number(null) is 0, so
  // a naive finite check would publish a confident "hate: 0".
  const base = rawSnapshot();
  const redacted = { ...base.factions[0], assessedAlienHateOfMe: null };
  const { alienThreat } = build({ factions: [redacted, base.factions[1]] });
  assert.strictEqual(alienThreat.hate, null);
  assert.strictEqual(alienThreat.retaliationActive, null, 'war status is unknowable without hate');
  // The floor is still computable from used MC alone.
  assert.strictEqual(alienThreat.minimumHate, 20.1);
});

// --- Total war state ---------------------------------------------------------
// Nothing used to emit `alienThreat.totalWar`, so strategicDelta's total-war
// check was reading a field that never existed and its narration was dead code.

const { buildStrategicDelta } = require('../shared/strategicDelta.mjs');

test('the compact snapshot records total war state, not just hate', () => {
  const { alienThreat } = build();
  assert.ok(alienThreat.totalWar, 'the field the delta reads must actually be emitted');
  // Normal difficulty gates total war at 20 years; the fixture is 10 years in
  // with 34.67 hate, so both conditions are unmet.
  assert.strictEqual(alienThreat.totalWar.state, 'safe');
  assert.strictEqual(alienThreat.totalWar.yearsThreshold, 20);
  assert.strictEqual(alienThreat.totalWar.yearsRemaining, 10);
  assert.strictEqual(alienThreat.totalWar.hateThreshold, 200);
  assert.strictEqual(alienThreat.yearsElapsedAssumed, false, 'the fixture measures its start year');
});

test('a declaration between two real snapshots reaches the narration', () => {
  const before = build();
  const base = rawSnapshot();
  const after = build({
    metadata: { ...base.metadata, gameTimeString: '6/1/2045 12:00:00 AM' },
    factions: [{ ...base.factions[0], assessedAlienHateOfMe: 240 }, base.factions[1]]
  });

  assert.strictEqual(after.alienThreat.totalWar.state, 'active',
    '23 years elapsed and 240 hate clears both gates');
  const delta = buildStrategicDelta(before, after);
  assert.strictEqual(delta.hate.totalWarDeclared, true);
  assert.ok(delta.events.includes('ALIEN TOTAL WAR DECLARED'));
});

test('an unmeasured campaign start year is used but labelled, not silently trusted', () => {
  // TIMetadataState carries no campaignStartYear; snapshotBuilder reports the
  // measured field as null and offers an explicitly assumed value. Refusing to
  // use it would leave total war permanently unevaluable; using it unlabelled
  // would present an assumption as a measurement.
  const base = rawSnapshot();
  const { alienThreat } = build({
    metadata: { ...base.metadata, campaignStartYear: null, assumedCampaignStartYear: 2022 }
  });
  assert.strictEqual(alienThreat.yearsElapsed, 10);
  assert.strictEqual(alienThreat.yearsElapsedAssumed, true);
  assert.strictEqual(alienThreat.totalWar.yearsElapsedAssumed, true);
  assert.strictEqual(alienThreat.totalWar.state, 'safe');
});

test('no start year at all leaves total war unevaluable rather than safe', () => {
  const base = rawSnapshot();
  const { alienThreat } = build({
    metadata: { ...base.metadata, campaignStartYear: null }
  });
  assert.strictEqual(alienThreat.yearsElapsed, null);
  assert.strictEqual(alienThreat.totalWar.state, 'unavailable', 'unknown is not safe');
});

// --- Completed project ledger -----------------------------------------------

test('the snapshot records which projects are complete, not only a hash', () => {
  const base = rawSnapshot();
  const observer = { ...base.factions[0], completedProjects: ['Project_B', 'Project_A', 'Project_A'] };
  const { research } = build({ factions: [observer, base.factions[1]] });
  assert.deepStrictEqual(research.completedProjects, ['Project_A', 'Project_B'],
    'deduplicated and sorted for a stable diff');
  assert.ok(research.completedProjectHash, 'the cheap change check is kept too');
});

test('an absent completed-project array stays absent rather than becoming empty', () => {
  const base = rawSnapshot();
  const observer = { ...base.factions[0] };
  delete observer.completedProjects;
  const { research } = build({ factions: [observer, base.factions[1]] });
  assert.strictEqual(research.completedProjects, null,
    'null lets the delta say "unknown"; [] would claim "nothing completed"');
});

test('a completed project is named in the snapshot events', () => {
  const base = rawSnapshot();
  const previous = build();
  const current = build(
    { factions: [{ ...base.factions[0], completedProjects: ['Project_Exodus'] }, base.factions[1]] },
    { previous }
  );
  const completed = current.events.filter((e) => e.type === 'project_completed');
  assert.deepStrictEqual(completed, [{ type: 'project_completed', id: 'Project_Exodus' }]);
});

// --- One diff, two renderings ------------------------------------------------

test('snapshot events and delta narration are derived from the same diff', () => {
  // deriveEvents used to re-implement the whole diff. The two copies drifted,
  // which is how total war and completed projects ended up dead on one side.
  const base = rawSnapshot();
  const previous = build();
  const current = build({
    fleets: [{ ID: 900, factionId: OBSERVER, shipsCount: 1, orbitBody: 'Mars',
               ships: [{ id: 1, hullName: 'Patapsco' }] }],
    habs: [{ ID: 700, factionId: OBSERVER, orbitBody: 'Mars', tier: 2 }, base.habs[2]]
  });

  const structured = deriveEvents(previous, current);
  const narrated = buildStrategicDelta(previous, current).events;

  const loss = structured.find((e) => e.type === 'ship_loss');
  assert.strictEqual(loss.count, 2);
  assert.ok(narrated.some((line) => /Lost 1x Cimarron/.test(line)));

  assert.ok(structured.some((e) => e.type === 'hab_lost' && e.id === 701));
  assert.ok(narrated.some((line) => /Lost hab 701/.test(line)));

  // Structured events stay objects; narration stays strings. The two contracts
  // are deliberately different and must not bleed into each other.
  assert.ok(structured.every((e) => typeof e === 'object' && typeof e.type === 'string'));
  assert.ok(narrated.every((line) => typeof line === 'string'));
});

// --- Shipyards are not construction modules ---------------------------------

test('a shipyard counts as a yard and not also as a construction module', () => {
  // Verified against TIHabModuleTemplate.json in the installed 1.0 templates
  // (read 2026-08-20): exactly six modules carry `allowsShipConstruction`
  // (SpaceDock/Shipyard/Spaceworks + alien equivalents) and six different ones
  // carry a `CanFoundTierNHabs` rule (ConstructionModule/Nanofactory/
  // NanofacturingComplex + alien equivalents). The two sets do not overlap.
  const modules = [
    { id: 1, habId: 700, factionId: OBSERVER, templateName: 'Shipyard', isShipyard: true,
      constructionStatus: 'operational', constructionCompleted: true },
    { id: 2, habId: 700, factionId: OBSERVER, templateName: 'Spaceworks', isShipyard: true,
      constructionStatus: 'operational', constructionCompleted: true },
    { id: 3, habId: 700, factionId: OBSERVER, templateName: 'ConstructionModule',
      constructionStatus: 'operational', constructionCompleted: true }
  ];
  const mars = build({ habModules: modules }).infrastructure.find((h) => h.id === 700);
  assert.strictEqual(mars.yards, 2, 'Shipyard and Spaceworks build ships');
  assert.strictEqual(mars.construction, 1, 'only ConstructionModule founds habs');
});

test('tier-2 and tier-3 construction modules are counted at all', () => {
  // The old name regex matched only /Construction|Shipyard|Spaceworks|Dock/,
  // so a hab whose construction capacity came from a Nanofactory or a
  // NanofacturingComplex reported construction: 0.
  const modules = ['Nanofactory', 'NanofacturingComplex', 'AlienAssembler'].map((templateName, i) => ({
    id: i + 1, habId: 700, factionId: OBSERVER, templateName,
    constructionStatus: 'operational', constructionCompleted: true
  }));
  const mars = build({ habModules: modules }).infrastructure.find((h) => h.id === 700);
  assert.strictEqual(mars.construction, 3);
  assert.strictEqual(mars.yards, 0);
});

// --- Absent stays null -------------------------------------------------------

test('an unknown mine limit is not reported as a zero penalty', () => {
  // Mines standing with no readable mine-limit grant means the mission-control
  // penalty is UNKNOWN. Reporting 0 would claim a verified "no penalty".
  const base = rawSnapshot();
  const { economy } = build({ globalResearch: { finishedTechsNames: [], activeSlots: [] } });
  assert.strictEqual(economy.mines.limit, null);
  assert.strictEqual(economy.mines.count, 1);
  assert.strictEqual(economy.mc.minePenalty, null, 'unknown, not "no penalty"');

  // Zero mines is answerable without the limit.
  const noMines = build({
    globalResearch: { finishedTechsNames: [], activeSlots: [] },
    habSites: [base.habSites[1]]
  });
  assert.strictEqual(noMines.economy.mc.minePenalty, 0);
});

test('an absent faction ship count stays null in the summary rows', () => {
  const base = rawSnapshot();
  const alien = { ...base.factions[1] };
  delete alien.shipsCount;
  const doc = build({ factions: [base.factions[0], alien] });
  const row = doc.summary.factions.find((f) => f.id === 4717);
  assert.strictEqual(row.ships, null, 'absent stays null');
  assert.strictEqual(doc.summary.factions.find((f) => f.id === OBSERVER).ships, 3);

  // And the delta must not invent a fleet that vanished.
  const delta = buildStrategicDelta(doc, build());
  assert.strictEqual(delta.military.alienShips.delta, null);
});
