// Regression tests for the "absent stays null" rule.
//
// Every case here removes a field the save can legitimately omit and asserts
// the pipeline reports it as unknown rather than as a measured value. Each one
// corresponds to a site where a fabricated default had been shipped:
// `Number(null) === 0`, `x || 0`, `x ?? 0`, `x || 'Normal'`, `Math.min(100, x/0)`.
//
// The rule the repo works to (CLAUDE.md): rendering an unmeasured value as a
// confident zero is the most repeated bug class here, a check that cannot be
// evaluated must report unknown rather than falling through to "safe", and an
// honest "unavailable" beats mock content that looks real.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const snapshotBuilder = require('../server/snapshotBuilder');
const snapshotIdentity = require('../server/snapshotIdentity');
const intelligenceFilter = require('../server/intelligenceFilter');
const exportGenerator = require('../server/exportGenerator');
const opportunityScorer = require('../server/opportunityScorer');
const saveParser = require('../server/saveParser');
const miningExpansion = require('../server/miningExpansion');
const techGraph = require('../shared/techGraph.mjs');
const { buildCouncilorAttributes, rankByAttribute } = require('../shared/councilorAttributes.mjs');
const { makeSaveData } = require('./fixtures/syntheticSave');

const OBSERVER = 4712;

const factionState = (save) => save.gamestates['PavonisInteractive.TerraInvicta.TIFactionState'];
const nationState = (save) => save.gamestates['PavonisInteractive.TerraInvicta.TINationState'];
const habSiteState = (save) => save.gamestates['PavonisInteractive.TerraInvicta.TIHabSiteState'];

function filtered(save, mode) {
  const raw = snapshotBuilder.buildRawSnapshot(save);
  const identity = snapshotIdentity.createSnapshotIdentity(
    { fullPath: 'synthetic.gz', lastModified: new Date('2025-01-01T00:00:00Z'), saveHash: 'x' },
    'initiative'
  );
  return intelligenceFilter.applyFilter({ ...raw, ...identity }, mode, OBSERVER);
}

// ---------------------------------------------------------------------------
// Alien hate: the single place where "unknown read as safe" matters most.
// ---------------------------------------------------------------------------

test('an absent alien hate stays null instead of becoming a confident 0', () => {
  const save = makeSaveData();
  delete factionState(save)[0].Value.assessedAlienHateOfMe;

  const raw = snapshotBuilder.buildRawSnapshot(save);
  const initiative = raw.factions.find(f => f.ID === OBSERVER);
  assert.strictEqual(initiative.assessedAlienHateOfMe, null,
    'an unmeasured faction must not be reported at 0 hate, which is the most reassuring value the field can take');

  // A genuinely measured zero is still a zero, and must stay distinguishable.
  const servants = raw.factions.find(f => f.ID === 4713);
  assert.strictEqual(typeof servants.assessedAlienHateOfMe, 'number');
});

test('player mode reports an absent alien hate as unavailable, not an empty threat meter', () => {
  const save = makeSaveData();
  for (const entry of factionState(save)) delete entry.Value.assessedAlienHateOfMe;

  const snap = filtered(save, 'player');
  const observer = snap.factions.find(f => f.ID === OBSERVER);
  const hate = observer.alienHate;

  assert.strictEqual(hate.status, 'unavailable');
  assert.strictEqual(hate.visibility, 'unavailable');
  assert.notStrictEqual(hate.visibleEstimate, '□□□□□',
    'an empty 5-pip meter reads as "the aliens have no grievance with you"');
  assert.ok(hate.pips === null || hate.pips === undefined, 'pip count must be unknown, not 0');
});

test('a measured zero alien hate still renders a real empty meter in player mode', () => {
  const save = makeSaveData();
  // The Initiative holds Project_TheirOperations in the fixture, which is what
  // grants the threat-estimate capability, so this exercises the pip branch.
  factionState(save)[0].Value.assessedAlienHateOfMe = 0;

  const snap = filtered(save, 'player');
  const observer = snap.factions.find(f => f.ID === OBSERVER);
  assert.strictEqual(observer.alienHate.status, 'available');
  assert.strictEqual(observer.alienHate.pips, 0);
  assert.strictEqual(observer.alienHate.visibleEstimate, '□□□□□');
});

test('enhanced mode prints UNKNOWN rather than a confident 0.00 for absent hate', () => {
  const save = makeSaveData();
  for (const entry of factionState(save)) delete entry.Value.assessedAlienHateOfMe;

  const snap = filtered(save, 'enhanced');
  for (const faction of snap.factions) {
    assert.notStrictEqual(faction.alienHate.visibleEstimate, '0.00',
      `${faction.displayName} printed a measured-looking 0.00 from no data`);
  }
});

test('omniscient mode reports an absent alien hate as UNKNOWN', () => {
  const save = makeSaveData();
  for (const entry of factionState(save)) delete entry.Value.assessedAlienHateOfMe;

  const snap = filtered(save, 'omniscient');
  const observer = snap.factions.find(f => f.ID === OBSERVER);
  assert.strictEqual(observer.alienHate.actual, null);
  assert.strictEqual(observer.alienHate.visibleEstimate, 'UNKNOWN');
  assert.strictEqual(observer.alienHate.visibility, 'unavailable');
});

test('the export renders an absent alien hate without throwing, in both modes', () => {
  const save = makeSaveData();
  for (const entry of factionState(save)) delete entry.Value.assessedAlienHateOfMe;

  for (const mode of ['player', 'enhanced', 'omniscient']) {
    const snap = filtered(save, mode);
    // `hateInfo.actual !== null` let an *undefined* actual reach .toFixed and
    // threw; this is the crash path that the ?? 0 upstream used to mask.
    const text = exportGenerator.generateCompactSnapshot(snap);
    assert.ok(typeof text === 'string' && text.length > 0, `${mode} export produced no text`);
    assert.ok(!/\bNaN\b/.test(text), `${mode} export leaked NaN`);
    assert.ok(!/\bnull\b/.test(text), `${mode} export printed a raw null`);
    assert.ok(!/\bundefined\b/.test(text), `${mode} export printed a raw undefined`);
  }
});

test('the export survives an alienHate object whose actual is undefined', () => {
  // The exact shape that used to throw: visibility is neither 'unavailable'
  // nor 'estimated', so the raw-save branch runs, and `actual` is undefined.
  const snap = {
    metadata: { gameTimeString: '1/1/2030' },
    mode: 'omniscient',
    observerFactionId: OBSERVER,
    factions: [{
      ID: OBSERVER,
      displayName: 'the Initiative',
      alienHate: { visibility: 'raw_save_only', visibleEstimate: 'UNKNOWN' },
      controlPointsCount: 0,
      habsCount: 0,
      shipsCount: 0,
      currentProjects: []
    }],
    councilors: [],
    fleets: [],
    globalResearch: { activeSlots: [] },
    servantTargets: [],
    techMatrix: []
  };
  const text = exportGenerator.generateCompactSnapshot(snap);
  assert.match(text, /\*\*Alien Hate \(Raw Save\):\*\* UNKNOWN/);
});

// ---------------------------------------------------------------------------
// Mining rates.
// ---------------------------------------------------------------------------

test('a hab site with no rate fields reports unavailable rates, not five zeros', () => {
  const save = makeSaveData();
  const site = habSiteState(save)[0].Value;
  for (const key of ['water_day', 'volatiles_day', 'metals_day', 'nobles_day', 'fissiles_day']) delete site[key];

  const raw = snapshotBuilder.buildRawSnapshot(save);
  const built = raw.habSites.find(s => s.ID === site.ID.value);

  for (const key of ['water', 'volatiles', 'metals', 'nobleMetals', 'fissiles']) {
    assert.strictEqual(built[key], null, `${key} was fabricated as a measured value`);
  }
  assert.strictEqual(built.resourceRatesAvailable, false);
  assert.strictEqual(built.resourceRatesComplete, false);
  assert.deepStrictEqual(
    built.unmeasuredResourceRates.slice().sort(),
    ['fissiles', 'metals', 'nobleMetals', 'volatiles', 'water']
  );
});

test('a partially measured hab site names only the absent rates', () => {
  const save = makeSaveData();
  const site = habSiteState(save)[0].Value;
  delete site.nobles_day;
  delete site.fissiles_day;

  const raw = snapshotBuilder.buildRawSnapshot(save);
  const built = raw.habSites.find(s => s.ID === site.ID.value);

  assert.strictEqual(built.water, 10, 'a measured rate is still reported');
  assert.strictEqual(built.volatiles, 0, 'a measured zero is still a zero');
  assert.strictEqual(built.nobleMetals, null);
  assert.strictEqual(built.fissiles, null);
  assert.strictEqual(built.resourceRatesAvailable, true);
  assert.strictEqual(built.resourceRatesComplete, false);
  assert.deepStrictEqual(built.unmeasuredResourceRates.slice().sort(), ['fissiles', 'nobleMetals']);
});

test('the mining scorer treats an unmeasured site yield as unknown, not as zero yield', () => {
  const runways = {
    water: { key: 'water', stock: 100, income: 20, net: 5, consumption: 15 },
    volatiles: { key: 'volatiles', stock: 100, income: 20, net: 5, consumption: 15 },
    metals: { key: 'metals', stock: 100, income: 20, net: 5, consumption: 15 },
    nobleMetals: { key: 'nobleMetals', stock: 100, income: 20, net: 5, consumption: 15 },
    fissiles: { key: 'fissiles', stock: 100, income: 20, net: 5, consumption: 15 }
  };
  const capacity = { headroom: 4, marginalNextMinePenaltyMC: 0, baseHateMultiplier: 0.3 };

  const measuredSite = { ID: 1, displayName: 'Measured', parentBodyName: 'Ceres', siteDensity: 1, water: 2, volatiles: 0, metals: 0, nobleMetals: 0, fissiles: 0 };
  const absentSite = { ID: 2, displayName: 'Absent', parentBodyName: 'Ceres', siteDensity: 1, water: null, volatiles: null, metals: null, nobleMetals: null, fissiles: null };

  const measured = miningExpansion.scoreSiteCandidate(measuredSite, runways, capacity);
  const absent = miningExpansion.scoreSiteCandidate(absentSite, runways, capacity);

  assert.strictEqual(measured.yields.volatiles.daily, 0, 'a measured zero yield stays 0');
  assert.strictEqual(measured.yields.volatiles.measured, true);
  assert.strictEqual(measured.scoreInputsComplete, true);

  assert.strictEqual(absent.yields.water.daily, null, 'an absent yield must not be coerced to 0/day');
  assert.strictEqual(absent.yields.water.measured, false);
  assert.strictEqual(absent.scoreInputsComplete, false);
  assert.deepStrictEqual(absent.unmeasuredResources.slice().sort(),
    ['fissiles', 'metals', 'nobleMetals', 'volatiles', 'water']);
});

test('an unresolved site density no longer multiplies the whole site value to zero', () => {
  // `Number.isFinite(Number(null))` is true, so a null density used to become
  // 0 and zero out every site whose template could not be joined.
  const runways = {
    water: { key: 'water', stock: 10, income: 20, net: -5, consumption: 25 },
    volatiles: { key: 'volatiles', stock: 10, income: 20, net: -5, consumption: 25 },
    metals: { key: 'metals', stock: 10, income: 20, net: -5, consumption: 25 },
    nobleMetals: { key: 'nobleMetals', stock: 10, income: 20, net: -5, consumption: 25 },
    fissiles: { key: 'fissiles', stock: 10, income: 20, net: -5, consumption: 25 }
  };
  const capacity = { headroom: 4, marginalNextMinePenaltyMC: 0, baseHateMultiplier: 0.3 };
  const site = { ID: 3, displayName: 'No template', parentBodyName: 'Ceres', siteDensity: null, water: 5, volatiles: 0, metals: 0, nobleMetals: 0, fissiles: 0 };

  const scored = miningExpansion.scoreSiteCandidate(site, runways, capacity);
  assert.strictEqual(scored.siteDensity, 1.0);
  assert.strictEqual(scored.siteDensityMeasured, false);
  assert.match(scored.siteDensitySource, /assumed/);
  assert.ok(scored.siteValue > 0, 'a site with real yield must not score 0 just because its density was unresolved');
});

test('an unknown difficulty makes the mining hate cost unavailable, not free', () => {
  const capacity = miningExpansion.buildMiningCapacity({
    observer: { ID: OBSERVER, displayName: 'the Initiative', missionControlUsage: 100 },
    completedProjects: [],
    completedTechs: [],
    difficulty: null,
    habSites: []
  });
  assert.strictEqual(capacity.baseHateMultiplier, null);
  assert.strictEqual(capacity.penaltyHate, null, 'an unknown hate multiplier must not report a costless penalty');
  assert.strictEqual(capacity.marginalNextMinePenaltyHate, null);

  const scored = miningExpansion.scoreSiteCandidate(
    { ID: 4, displayName: 'X', parentBodyName: 'Ceres', siteDensity: 1, water: 1, volatiles: 0, metals: 0, nobleMetals: 0, fissiles: 0 },
    {},
    capacity
  );
  assert.strictEqual(scored.hateCost, null);
  assert.strictEqual(scored.hateCostAvailable, false);
  assert.strictEqual(scored.valuePerHate, null);
});

// ---------------------------------------------------------------------------
// Alien facilities, power scores, research costs, mission control.
// ---------------------------------------------------------------------------

test('an alien facility with no HP reading is unknown, not a pristine 100', () => {
  const save = makeSaveData();
  save.gamestates['PavonisInteractive.TerraInvicta.TIRegionAlienFacilityState'] = [
    { Value: { ID: { value: 900 }, region: { value: 11 }, built: true } },
    { Value: { ID: { value: 901 }, region: { value: 12 }, built: true, currentHP: 40 } }
  ];

  const raw = snapshotBuilder.buildRawSnapshot(save);
  const unknown = raw.builtAlienFacilities.find(f => f.id === 900);
  const measured = raw.builtAlienFacilities.find(f => f.id === 901);

  assert.strictEqual(unknown.currentHP, null, 'inventing 100 HP understates how close it is to destruction');
  assert.strictEqual(unknown.currentHPAvailable, false);
  assert.strictEqual(measured.currentHP, 40);
  assert.strictEqual(measured.currentHPAvailable, true);
});

test('a zero or absent power-score normalizer yields null, never a fabricated 100', () => {
  // Math.min(100, x/0) is Infinity-clamped to 100; Math.min(100, 0/0) is NaN.
  assert.strictEqual(snapshotBuilder.normalizedScore(5, 0), null);
  assert.strictEqual(snapshotBuilder.normalizedScore(5, undefined), null);
  assert.strictEqual(snapshotBuilder.normalizedScore(5, null), null);
  assert.strictEqual(snapshotBuilder.normalizedScore(0, 0), null);
  assert.strictEqual(snapshotBuilder.normalizedScore(null, 10), null);
  assert.strictEqual(snapshotBuilder.normalizedScore(undefined, 10), null);
  // A measured value against a real normalizer still scores.
  assert.strictEqual(snapshotBuilder.normalizedScore(5, 10), 50);
  assert.strictEqual(snapshotBuilder.normalizedScore(0, 10), 0);
  assert.strictEqual(snapshotBuilder.normalizedScore(500, 10), 100);
});

test('completionPercent reports null rather than leaking NaN or Infinity', () => {
  assert.strictEqual(snapshotBuilder.completionPercent(10, 0), null);
  assert.strictEqual(snapshotBuilder.completionPercent(0, 0), null);
  assert.strictEqual(snapshotBuilder.completionPercent(10, null), null);
  assert.strictEqual(snapshotBuilder.completionPercent(null, 100), null);
  assert.strictEqual(snapshotBuilder.completionPercent(25, 100), 25);
});

test('sumOrNull refuses to present a partial total as a complete one', () => {
  assert.strictEqual(snapshotBuilder.sumOrNull([1, 2, 3]), 6);
  assert.strictEqual(snapshotBuilder.sumOrNull([1, null, 3]), null);
  assert.strictEqual(snapshotBuilder.sumOrNull([1, undefined]), null);
  assert.strictEqual(snapshotBuilder.sumOrNull([]), null);
  assert.strictEqual(snapshotBuilder.sumOrNull(null), null);
});

test('lastFiniteNumber returns null when a history carries no numbers', () => {
  assert.strictEqual(snapshotBuilder.lastFiniteNumber([]), null);
  assert.strictEqual(snapshotBuilder.lastFiniteNumber(undefined), null);
  assert.strictEqual(snapshotBuilder.lastFiniteNumber([null, undefined]), null);
  assert.strictEqual(snapshotBuilder.lastFiniteNumber([1, 2]), 2);
});

test('firstNumeric is gone so the zero-returning helper cannot be reused', () => {
  assert.strictEqual(typeof snapshotBuilder.firstNumeric, 'undefined');
});

test('a nation with no mission control reading makes faction capacity unknown', () => {
  const save = makeSaveData();
  for (const entry of nationState(save)) {
    delete entry.Value.missionControl;
    delete entry.Value.historyMissionControl;
  }

  const raw = snapshotBuilder.buildRawSnapshot(save);
  assert.strictEqual(raw.nations[0].missionControl, null,
    'Number(null) === 0 previously reported an unmeasured nation as having 0 MC');

  const initiative = raw.factions.find(f => f.ID === OBSERVER);
  assert.strictEqual(initiative.missionControlCapacity, null,
    'a capacity summed over unmeasured nations must not be presented as complete');
});

test('an unresolved research template leaves cost and percent unknown', () => {
  const save = makeSaveData();
  save.gamestates['PavonisInteractive.TerraInvicta.TIGlobalResearchState'] = [{
    Value: {
      finishedTechsNames: [],
      techProgress: [{ techTemplateName: 'Tech_ThatDoesNotExist', accumulatedResearch: 500, factionContributions: [] }]
    }
  }];
  factionState(save)[0].Value.currentProjectProgress = [
    { projectTemplateName: 'Project_ThatDoesNotExist', accumulatedResearch: 250 }
  ];

  const raw = snapshotBuilder.buildRawSnapshot(save);
  const slot = raw.globalResearch.activeSlots[0];
  assert.strictEqual(slot.totalCost, null, 'a round 10000 default made an invented percentage look measured');
  assert.strictEqual(slot.totalCostAvailable, false);
  assert.strictEqual(slot.percent, null);

  const project = raw.factions.find(f => f.ID === OBSERVER).currentProjects[0];
  assert.strictEqual(project.totalCost, null);
  assert.strictEqual(project.totalCostAvailable, false);
  assert.strictEqual(project.percent, null);
});

test('the export prints UNKNOWN for an unresolved research cost instead of throwing', () => {
  const save = makeSaveData();
  save.gamestates['PavonisInteractive.TerraInvicta.TIGlobalResearchState'] = [{
    Value: {
      finishedTechsNames: [],
      techProgress: [{ techTemplateName: 'Tech_ThatDoesNotExist', accumulatedResearch: 500, factionContributions: [] }]
    }
  }];

  for (const mode of ['player', 'omniscient']) {
    const text = exportGenerator.generateCompactSnapshot(filtered(save, mode));
    assert.match(text, /UNKNOWN%/, `${mode} export should name the unknown percentage`);
    assert.ok(!/\bNaN\b/.test(text), `${mode} export leaked NaN`);
  }
});

// ---------------------------------------------------------------------------
// Save metadata: difficulty selects the alien hate floor multiplier.
// ---------------------------------------------------------------------------

test('an absent difficulty stays null rather than silently becoming Normal', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ti-absent-'));
  const file = path.join(dir, 'nodifficulty.json');
  fs.writeFileSync(file, JSON.stringify({
    gamestates: {
      'PavonisInteractive.TerraInvicta.TIMetadataState': [
        { Value: { gameTimeString: '1/1/2030 12:00:00 AM' } }
      ]
    }
  }));

  try {
    const parsed = saveParser.readSaveJson(file);
    // Cinematic 0.05 / Normal 0.30 / Veteran 0.60 / Brutal 1.00 -- guessing
    // Normal is a hate floor wrong by up to 20x with nothing to indicate it.
    assert.strictEqual(parsed.difficulty, null);
    assert.strictEqual(parsed.difficultyAvailable, false);
    assert.strictEqual(parsed.campaignStartYear, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a present difficulty is still read through unchanged', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ti-absent-'));
  const file = path.join(dir, 'difficulty.json');
  fs.writeFileSync(file, JSON.stringify({
    gamestates: {
      'PavonisInteractive.TerraInvicta.TIMetadataState': [
        { Value: { gameTimeString: '1/1/2030 12:00:00 AM', difficulty: 'Brutal', campaignStartYear: 2024 } }
      ]
    }
  }));

  try {
    const parsed = saveParser.readSaveJson(file);
    assert.strictEqual(parsed.difficulty, 'Brutal');
    assert.strictEqual(parsed.difficultyAvailable, true);
    assert.strictEqual(parsed.campaignStartYear, 2024);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an absent campaign start year is labelled as an assumption, not reported as measured', () => {
  const save = makeSaveData();
  save.campaignStartYear = null;
  // `metadata.gameTimeString` is read from the top-level parsed field, and the
  // elapsed-years regex expects the game's M/D/YYYY form.
  save.gameTimeString = '1/1/2030 12:00:00 AM';
  save.gamestates['PavonisInteractive.TerraInvicta.TIMetadataState'] = [
    { Value: { gameTimeString: '1/1/2030 12:00:00 AM', difficulty: 'Veteran' } }
  ];

  const raw = snapshotBuilder.buildRawSnapshot(save);
  assert.strictEqual(raw.metadata.campaignStartYear, null);
  assert.strictEqual(raw.metadata.campaignStartYearAvailable, false);
  assert.strictEqual(raw.metadata.assumedCampaignStartYear, 2022);
  assert.match(raw.metadata.campaignStartYearSource, /assumed/);

  for (const mode of ['player', 'omniscient']) {
    const snap = filtered(save, mode);
    assert.strictEqual(snap.alienHateEconomics.campaignStartYearMeasured, false);
    assert.match(snap.alienHateEconomics.yearsElapsedSource, /assumed/,
      `${mode} must state that elapsed years rest on an assumed start year`);
  }
});

// ---------------------------------------------------------------------------
// Opportunity scoring.
// ---------------------------------------------------------------------------

test('a nation with no GDP scores no economic points and says the input was absent', () => {
  const controlPoints = [
    { factionId: 4713, isExecutive: true },
    { factionId: 4713, isExecutive: false }
  ];
  const withGdp = opportunityScorer.scoreNationTarget(
    { ID: 1, displayName: 'Japan', GDP: 6e12, nukes: 0, missionControl: 0, boost: 0, unrest: 0, cohesion: 5, research: 0 },
    controlPoints, OBSERVER, 4713
  );
  const withoutGdp = opportunityScorer.scoreNationTarget(
    { ID: 2, displayName: 'Unmeasured', nukes: 0, missionControl: 0, boost: 0, unrest: 0, cohesion: 5, research: 0 },
    controlPoints, OBSERVER, 4713
  );

  assert.ok(withGdp.score > withoutGdp.score, 'a measured superpower must outscore an unmeasured nation');
  assert.strictEqual(withoutGdp.gdpTrillion, null, '(nation.GDP || 0) rendered "$0.00T", a real finding rather than a gap');
  assert.strictEqual(withoutGdp.gdpAvailable, false);
  assert.strictEqual(withoutGdp.scoreInputsComplete, false);
  assert.ok(withoutGdp.unmeasuredInputs.includes('GDP'));
  assert.ok(withoutGdp.reasons.some(r => /UNAVAILABLE/.test(r)));

  assert.strictEqual(withGdp.gdpAvailable, true);
  assert.strictEqual(withGdp.scoreInputsComplete, true);
  assert.deepStrictEqual(withGdp.unmeasuredInputs, []);
});

test('an unmeasured cohesion is not judged politically solid', () => {
  const controlPoints = [{ factionId: 4713, isExecutive: false }];
  const scored = opportunityScorer.scoreNationTarget(
    { ID: 3, displayName: 'Unmeasured', GDP: 1e11, nukes: 0, missionControl: 0, boost: 0, unrest: 0, research: 0 },
    controlPoints, OBSERVER, 4713
  );
  // The old default of 5 sat above the vulnerability threshold, so an
  // unmeasured nation silently read as cohesive.
  assert.ok(scored.unmeasuredInputs.includes('cohesion'));
  assert.strictEqual(scored.scoreInputsComplete, false);
});

test('the export prints GDP UNAVAILABLE rather than $0.0T', () => {
  const snap = {
    metadata: { gameTimeString: '1/1/2030' },
    mode: 'player',
    observerFactionId: OBSERVER,
    factions: [{
      ID: OBSERVER,
      displayName: 'the Initiative',
      alienHate: { visibility: 'unavailable' },
      controlPointsCount: 1,
      habsCount: 1,
      shipsCount: 1,
      currentProjects: [],
      powerScore: { overall: null }
      // totalGdp and totalResearch deliberately absent
    }],
    councilors: [],
    fleets: [],
    globalResearch: { activeSlots: [] },
    servantTargets: [],
    techMatrix: []
  };
  const text = exportGenerator.generateCompactSnapshot(snap);
  assert.match(text, /UNAVAILABLE GDP/);
  assert.ok(!/\$0\.0T/.test(text), 'an unmeasured economy printed as $0.0T reads as a collapsed state');
  assert.match(text, /Dashboard Power Estimate: UNKNOWN/);
});

// ---------------------------------------------------------------------------
// Tech graph: NaN escaping through Math.min(100, NaN).
// ---------------------------------------------------------------------------

test('a zero-cost research node reports an unknown percent instead of NaN', () => {
  const graph = {
    nodes: [
      { id: 'T1', displayName: 'Zero cost tech', type: 'global_tech', category: 'General', researchCost: null, researchProgress: 0, researchPercent: null, contributors: [], prerequisites: [], effects: [], unlocks: [] },
      { id: 'P1', displayName: 'Zero cost project', type: 'faction_project', category: 'General', researchCost: null, researchProgress: 0, researchPercent: null, contributors: [], prerequisites: [], effects: [], unlocks: [] }
    ]
  };
  graph.byId = new Map(graph.nodes.map(n => [n.id, n]));

  const applied = techGraph.applySaveState(graph, {
    finishedTechs: [],
    globalActive: [{ techId: 'T1', accumulatedResearch: 0, totalCost: 0, contributors: [] }],
    faction: {
      completedProjects: [],
      availableProjectNames: [],
      currentProjects: [{ projectId: 'P1', accumulatedResearch: 0, totalCost: 0 }]
    }
  });

  for (const id of ['T1', 'P1']) {
    const node = applied.byId.get(id);
    assert.strictEqual(node.status, 'researching');
    // Math.min(100, NaN) is NaN, not 100, so NaN used to escape here.
    assert.ok(!Number.isNaN(node.researchPercent), `${id} leaked NaN into researchPercent`);
    assert.strictEqual(node.researchPercent, null);
  }
});

test('a measured research cost still produces a real percent', () => {
  const graph = {
    nodes: [{ id: 'T2', displayName: 'Real tech', type: 'global_tech', category: 'General', researchCost: 1000, researchProgress: 0, researchPercent: 0, contributors: [], prerequisites: [], effects: [], unlocks: [] }]
  };
  graph.byId = new Map(graph.nodes.map(n => [n.id, n]));
  const applied = techGraph.applySaveState(graph, {
    finishedTechs: [],
    globalActive: [{ techId: 'T2', accumulatedResearch: 250, totalCost: 1000, contributors: [] }],
    faction: { completedProjects: [], availableProjectNames: [], currentProjects: [] }
  });
  assert.strictEqual(applied.byId.get('T2').researchPercent, 25);
});

test('a tech path containing an uncosted node says so instead of undercounting', () => {
  const nodes = [
    { id: 'A', displayName: 'A', type: 'global_tech', category: 'General', researchCost: 100, researchProgress: 0, researchPercent: 0, status: 'available', prerequisites: [], effects: [], unlocks: [], contributors: [] },
    { id: 'B', displayName: 'B', type: 'faction_project', category: 'General', researchCost: null, researchProgress: 0, researchPercent: null, status: 'available', prerequisites: [{ id: 'A', type: 'global_tech' }], effects: [], unlocks: [], contributors: [] }
  ];
  const graph = { nodes, byId: new Map(nodes.map(n => [n.id, n])) };

  const result = techGraph.buildTechPath(graph, graph.byId, ['B']);
  assert.strictEqual(result.researchCostComplete, false);
  assert.ok(result.uncostedNodes.includes('B'), 'an uncosted node must be named, not silently counted as free');
  assert.strictEqual(result.remainingGlobalResearchCost, 100, 'the measured part is still reported');
});

// ---------------------------------------------------------------------------
// Councilor attributes: masked enemies in player mode.
// ---------------------------------------------------------------------------

test('a masked enemy councilor reports unknown base attributes, not zero skill', () => {
  // In player mode an observed enemy carries `maskedAttributes`, not
  // `attributes`, so every base stat is legitimately unknown.
  const masked = {
    ID: 500,
    displayName: 'Observed Enemy',
    factionId: 4713,
    maskedAttributes: { Persuasion: { visible: null } },
    orgs: [{ id: 1, displayName: 'Org', tier: 2, statBonuses: { per: 3 } }],
    traits: []
  };
  const resolved = buildCouncilorAttributes(masked);

  assert.strictEqual(resolved.baseAttributesAvailable, false);
  assert.strictEqual(resolved.attributesComplete, false);
  assert.strictEqual(resolved.baseMeasured.Persuasion, false);
  assert.strictEqual(resolved.unmeasuredAttributes.length, 8);
  assert.strictEqual(resolved.totalEffectiveSkillsComplete, false);
  // Administration is unknown, so capacity cannot be evaluated and must not
  // fall through to "within capacity".
  assert.strictEqual(resolved.orgCapacity.capacityEvaluable, false);
  assert.strictEqual(resolved.orgCapacity.withinCapacity, null);
  assert.strictEqual(resolved.orgCapacity.spare, null);
});

test('a measured councilor still reports complete attributes and a real capacity verdict', () => {
  const known = {
    ID: 501,
    displayName: 'Own Councilor',
    factionId: OBSERVER,
    attributes: { Persuasion: 5, Investigation: 5, Espionage: 5, Command: 5, Administration: 6, Science: 5, Security: 5, Loyalty: 5 },
    orgs: [{ id: 1, displayName: 'Org', tier: 2, statBonuses: { per: 3 } }],
    traits: []
  };
  const resolved = buildCouncilorAttributes(known);

  assert.strictEqual(resolved.attributesComplete, true);
  assert.strictEqual(resolved.baseMeasured.Administration, true);
  assert.strictEqual(resolved.orgCapacity.capacityEvaluable, true);
  assert.strictEqual(resolved.orgCapacity.withinCapacity, true);
  assert.strictEqual(resolved.orgCapacity.spare, 4);
});

test('an org with an unmeasured tier makes capacity unknown rather than compliant', () => {
  const councilor = {
    ID: 502,
    attributes: { Persuasion: 5, Investigation: 5, Espionage: 5, Command: 5, Administration: 3, Science: 5, Security: 5, Loyalty: 5 },
    orgs: [{ id: 1, displayName: 'Untiered', statBonuses: {} }],
    traits: []
  };
  const resolved = buildCouncilorAttributes(councilor);
  assert.strictEqual(resolved.orgCapacity.untieredOrgs, 1);
  assert.strictEqual(resolved.orgCapacity.capacityEvaluable, false);
  assert.strictEqual(resolved.orgCapacity.withinCapacity, null);
});

test('ranking marks an unknown base as a lower bound rather than a measured zero', () => {
  const ranked = rankByAttribute([
    { ID: 1, displayName: 'Known', factionId: OBSERVER, attributes: { Persuasion: 8, Investigation: 0, Espionage: 0, Command: 0, Administration: 0, Science: 0, Security: 0, Loyalty: 0 }, orgs: [], traits: [] },
    { ID: 2, displayName: 'Masked', factionId: OBSERVER, orgs: [{ id: 9, tier: 1, statBonuses: { per: 4 } }], traits: [] }
  ], 'Persuasion');

  const known = ranked.find(r => r.name === 'Known');
  const masked = ranked.find(r => r.name === 'Masked');

  assert.strictEqual(known.base, 8);
  assert.strictEqual(known.baseMeasured, true);
  assert.strictEqual(known.effectiveIsLowerBound, false);

  assert.strictEqual(masked.base, null, 'a masked base printed as 0 reads as genuinely zero skill');
  assert.strictEqual(masked.baseMeasured, false);
  assert.strictEqual(masked.effectiveIsLowerBound, true);
});
