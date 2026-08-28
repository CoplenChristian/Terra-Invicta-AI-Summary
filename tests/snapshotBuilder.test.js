const { test } = require('node:test');
const assert = require('node:assert');

const snapshotBuilder = require('../server/snapshotBuilder');
const saveParser = require('../server/saveParser');
const templateLoader = require('../server/templateLoader');
const intelligenceFilter = require('../server/intelligenceFilter');
const { makeSaveData } = require('./fixtures/syntheticSave');

test('buildRawSnapshot builds factions with derived power metrics', () => {
  const raw = snapshotBuilder.buildRawSnapshot(makeSaveData({ money: 100 }));
  assert.strictEqual(raw.factions.length, 3);

  const initiative = raw.factions.find(f => f.ID === 4712);
  assert.ok(initiative, 'Initiative faction present');
  assert.strictEqual(initiative.resources.Money, 100);
  assert.strictEqual(initiative.assessedAlienHateOfMe, 5);
  assert.strictEqual(initiative.controlPointsCount, 2);
  assert.strictEqual(initiative.nationsCount, 1);
  assert.strictEqual(initiative.totalGdp, 20e12);
  assert.strictEqual(initiative.shipsCount, 1);
  assert.strictEqual(initiative.missionControlUsage, 10);
  assert.strictEqual(initiative.missionControlCapacity, 8);
  assert.ok(Number.isFinite(initiative.powerScore.overall), 'composite power computed from visible fleet power');
  assert.ok(initiative.powerScore.fleet > 0, 'fleet power component derived from combat power');

  const servants = raw.factions.find(f => f.ID === 4713);
  assert.strictEqual(servants.nationsCount, 1);
});

test('buildRawSnapshot captures nations, councilors and control points', () => {
  const raw = snapshotBuilder.buildRawSnapshot(makeSaveData());
  assert.strictEqual(raw.nations.length, 2);

  const usa = raw.nations.find(n => n.ID === 1);
  assert.strictEqual(usa.executiveFactionId, 4712);
  assert.strictEqual(usa.GDP, 20e12);
  assert.strictEqual(usa.missionControl, 8);
  assert.strictEqual(usa.controlPoints.length, 2);
  assert.strictEqual(usa.regionsCount, 2);

  const china = raw.nations.find(n => n.ID === 2);
  assert.strictEqual(china.executiveFactionId, 4713);

  assert.strictEqual(raw.councilors.length, 3);
  const own = raw.councilors.find(c => c.ID === 100);
  assert.strictEqual(own.factionName, 'the Initiative');
  assert.strictEqual(own.totalSkills, 70);
  assert.strictEqual(own.attributes.Persuasion, 10);
});

test('buildRawSnapshot preserves control-point defense state and expiry', () => {
  const save = makeSaveData();
  const controlPoints = save.gamestates['PavonisInteractive.TerraInvicta.TIControlPoint'];
  controlPoints[0].Value.defended = true;
  controlPoints[0].Value.defendExpiration = {
    year: 2032,
    month: 12,
    day: 31,
    hour: 23,
    minute: 59,
    second: 0,
    millisecond: 0
  };
  const raw = snapshotBuilder.buildRawSnapshot(save);
  const ownCp = raw.nations.find(n => n.ID === 1).controlPoints.find(cp => cp.id === 11);
  assert.strictEqual(ownCp.defended, true);
  assert.deepStrictEqual(ownCp.defendExpiration, controlPoints[0].Value.defendExpiration);
});

test('buildRawSnapshot resolves space assets and theater classification', () => {
  const raw = snapshotBuilder.buildRawSnapshot(makeSaveData({ ships: 2 }));
  assert.strictEqual(raw.fleets.length, 1);
  const fleet = raw.fleets[0];
  assert.strictEqual(fleet.shipsCount, 2);
  assert.strictEqual(fleet.orbitBody, 'Ceres');
  assert.strictEqual(fleet.spaceTheaterKey, 'belt');
  assert.strictEqual(fleet.combatPower, 100, '2 ships x 50 combat power');

  assert.strictEqual(raw.habs.length, 1);
  assert.strictEqual(raw.habs[0].orbitBody, 'Ceres');
  assert.strictEqual(raw.habs[0].inEarthLEO, true);

  assert.strictEqual(raw.habSites.length, 1);
  const site = raw.habSites[0];
  assert.strictEqual(site.parentBodyName, 'Ceres');
  assert.strictEqual(site.water, 10);
  assert.strictEqual(site.factionName, 'the Initiative');
});

test('fleet names and fleet destinations resolve for the observing faction', () => {
  const save = makeSaveData();
  const fleetState = save.gamestates['PavonisInteractive.TerraInvicta.TISpaceFleetState'];
  const fleet = fleetState[0].Value;
  fleet.displayName = '';
  fleet.displayNameByFaction = [
    { Key: { value: 4712 }, Value: 'Mars Defense' },
    { Key: { value: 4717 }, Value: 'Initiative-private-name' }
  ];
  fleet.trajectory = { destinationFleet: { value: 601 } };
  fleetState.push({
    Value: {
      ID: { value: 601 },
      displayName: '',
      displayNameByFaction: [
        { Key: { value: 4712 }, Value: 'Victor-8' },
        { Key: { value: 4717 }, Value: 'Alien-private-name' }
      ],
      faction: { value: 4717 },
      ships: [],
      orbitState: { value: 500 },
      inCombat: false
    }
  });

  // Build once for a different observer to prove filtering does not inherit
  // the name that happened to be present when the shared raw snapshot ran.
  const raw = snapshotBuilder.buildRawSnapshot(save, { observerId: 4717 });
  assert.strictEqual(raw.fleets[0].displayName, 'Initiative-private-name');
  assert.strictEqual(raw.fleets[0].destination, 'Alien-private-name');

  for (const mode of ['player', 'omniscient']) {
    const filtered = intelligenceFilter.applyFilter(raw, mode, 4712);
    const ownFleet = filtered.fleets.find(item => item.ID === 600);
    assert.ok(ownFleet, `${mode} includes the observer fleet`);
    assert.strictEqual(ownFleet.displayName, 'Mars Defense');
    assert.strictEqual(ownFleet.destination, 'Victor-8');
    assert.strictEqual(ownFleet.currentOrders.destination, 'Victor-8');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(ownFleet, 'displayNameByFaction'), false);
    assert.ok(!JSON.stringify(filtered).includes('Alien-private-name'),
      `${mode} must not leak another faction's private fleet name`);
  }

  const absentSave = makeSaveData();
  const absentFleet = absentSave.gamestates['PavonisInteractive.TerraInvicta.TISpaceFleetState'][0].Value;
  delete absentFleet.displayName;
  absentFleet.displayNameByFaction = [{ Key: { value: 4717 }, Value: 'Not-visible-to-observer' }];
  const absent = snapshotBuilder.buildRawSnapshot(absentSave, { observerId: 4712 });
  assert.strictEqual(absent.fleets[0].displayName, null);
  assert.strictEqual(
    intelligenceFilter.applyFilter(absent, 'omniscient', 4712).fleets[0].displayName,
    null
  );

  absentFleet.displayName = 'Auto Designation';
  const fallback = snapshotBuilder.buildRawSnapshot(absentSave, { observerId: 4712 });
  assert.strictEqual(fallback.fleets[0].displayName, 'Auto Designation');
});

test('buildRawSnapshot builds faction relationships from factionHate maps', () => {
  const raw = snapshotBuilder.buildRawSnapshot(makeSaveData());
  assert.strictEqual(raw.factionRelationships.length, 2);
  const relation = raw.factionRelationships.find(r => r.sourceFactionId === 4713);
  assert.ok(relation);
  assert.strictEqual(relation.targetFactionId, 4712);
  assert.strictEqual(relation.hate, 90);
});

test('buildRawSnapshot handles empty game state collections', () => {
  const empty = snapshotBuilder.buildRawSnapshot({ gamestates: {} });
  assert.strictEqual(empty.factions.length, 0);
  assert.strictEqual(empty.councilors.length, 0);
  assert.strictEqual(empty.fleets.length, 0);
  assert.ok(empty.techMatrix.length > 0, 'tech matrix still present from template keys');
});

// Research output. The KPI read Earth nations only, so every orbital lab was
// missing from it. These pin the four rules that fix took: hab modules count,
// only completed ones count, an unreadable module is null rather than zero,
// and a rate the save states outranks anything we recompute.
//
// The module's research value is injected into the template index rather than
// read from a game install, so the assertions hold on a clean checkout.
const RESEARCH_MODULE = 'TestScienceInstitute';
const RESEARCH_PER_MODULE = 40;

function withResearchTemplate(run) {
  templateLoader.templates.habModules.set(RESEARCH_MODULE, {
    dataName: RESEARCH_MODULE,
    friendlyName: 'Test Science Institute',
    incomeResearch_month: RESEARCH_PER_MODULE
  });
  try {
    return run();
  } finally {
    templateLoader.templates.habModules.delete(RESEARCH_MODULE);
  }
}

test('faction research totals more than its Earth nations once research habs are counted', () => {
  withResearchTemplate(() => {
    const raw = snapshotBuilder.buildRawSnapshot(makeSaveData({
      habModules: [
        { id: 351, templateName: RESEARCH_MODULE },
        { id: 352, templateName: RESEARCH_MODULE }
      ]
    }));
    const initiative = raw.factions.find(f => f.ID === 4712);
    const breakdown = initiative.researchBreakdown;

    assert.strictEqual(breakdown.habModuleCount, 2);
    assert.strictEqual(breakdown.habModules, 2 * RESEARCH_PER_MODULE);
    assert.ok(
      initiative.totalResearch > breakdown.earthControlPointShare,
      `expected ${initiative.totalResearch} to exceed the Earth-only ${breakdown.earthControlPointShare}`
    );
    assert.strictEqual(
      initiative.totalResearch,
      breakdown.earthControlPointShare + 2 * RESEARCH_PER_MODULE
    );

    // A faction with no research habs is unchanged by the correction.
    const servants = raw.factions.find(f => f.ID === 4713);
    assert.strictEqual(servants.researchBreakdown.habModules, 0);
    assert.strictEqual(servants.totalResearch, servants.researchBreakdown.earthControlPointShare);
  });
});

test('a hab module still under construction produces no research', () => {
  withResearchTemplate(() => {
    const raw = snapshotBuilder.buildRawSnapshot(makeSaveData({
      habModules: [
        { id: 351, templateName: RESEARCH_MODULE },
        { id: 352, templateName: RESEARCH_MODULE, constructionCompleted: false }
      ]
    }));
    const breakdown = raw.factions.find(f => f.ID === 4712).researchBreakdown;
    assert.strictEqual(breakdown.habModuleCount, 1, 'only the completed module counts');
    assert.strictEqual(breakdown.habModules, RESEARCH_PER_MODULE);
  });
});

test('a hab module with no resolvable template reports null research, never zero', () => {
  withResearchTemplate(() => {
    const raw = snapshotBuilder.buildRawSnapshot(makeSaveData({
      habModules: [
        { id: 351, templateName: RESEARCH_MODULE },
        { id: 352, templateName: 'ModuleFromAnUnknownMod' }
      ]
    }));
    const initiative = raw.factions.find(f => f.ID === 4712);
    assert.strictEqual(initiative.researchBreakdown.habModulesUnresolved, 1);
    assert.strictEqual(initiative.researchBreakdown.habModules, null);
    assert.strictEqual(initiative.researchBreakdown.computedMonthly, null);
    assert.strictEqual(initiative.totalResearch, null, 'a missing template must not shrink the total');
    assert.strictEqual(initiative.powerScore.research, null);
  });
});

test('the rate the save reports outranks the recomputed research sum', () => {
  withResearchTemplate(() => {
    const raw = snapshotBuilder.buildRawSnapshot(makeSaveData({
      habModules: [{ id: 351, templateName: RESEARCH_MODULE }],
      factionOptions: { 4712: { cachedYearlyRevenue: { Research: 36000 } } }
    }));
    const initiative = raw.factions.find(f => f.ID === 4712);
    const breakdown = initiative.researchBreakdown;
    assert.strictEqual(breakdown.reportedMonthly, 3000);
    assert.strictEqual(breakdown.computedMonthly, breakdown.earthControlPointShare + RESEARCH_PER_MODULE);
    assert.strictEqual(initiative.totalResearch, 3000);
    assert.match(breakdown.source, /cachedYearlyRevenue/);
  });
});

test('nation research is split between its control points, not handed out whole', () => {
  const save = makeSaveData();
  // A rival takes a third control point in the USA, so our two points now earn
  // two thirds of its research instead of all of it.
  save.gamestates['PavonisInteractive.TerraInvicta.TIControlPoint'].push({
    Value: { ID: { value: 13 }, faction: { value: 4713 }, nation: { value: 1 }, controlPointType: 'Standard' }
  });
  const raw = snapshotBuilder.buildRawSnapshot(save);
  const initiative = raw.factions.find(f => f.ID === 4712);
  assert.strictEqual(initiative.researchBreakdown.earthControlPointShare, 533.33, '800 x 2/3');

  // A crackdown'd point keeps its share of the nation but stops paying out.
  const disabled = makeSaveData();
  disabled.gamestates['PavonisInteractive.TerraInvicta.TIControlPoint'][1].Value.benefitsDisabled = true;
  const disabledRaw = snapshotBuilder.buildRawSnapshot(disabled);
  const crippled = disabledRaw.factions.find(f => f.ID === 4712);
  assert.strictEqual(crippled.researchBreakdown.earthControlPointShare, 400, '800 x 1/2');
});

test('saveParser getStateCollection unwraps Value-wrapped entries', () => {
  const save = makeSaveData();
  const states = save.gamestates;
  const factionState = saveParser.getStateCollection(states, 'PavonisInteractive.TerraInvicta.TIFactionState');
  assert.strictEqual(factionState.length, 3);
  assert.ok(factionState[0].ID.value, 'entries are unwrapped');
});
