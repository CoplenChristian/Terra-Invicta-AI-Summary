const test = require('node:test');
const assert = require('node:assert');
const miningExpansionModule = require('../server/miningExpansion');
const {
  buildMiningCapacity,
  buildResourceRunways,
  evaluateUtility,
  scoreSiteCandidate,
  buildMiningExpansion,
  getDestinationTechForBody
} = miningExpansionModule;
const sharedIntel = require('../shared/intelResources.mjs');
const {
  miningExpansionResource,
  miningResourceRow,
  habSiteResourceRow,
  alienThreatResource
} = sharedIntel;
const { loadSnapshot, loadFilteredSnapshot, queryIntel } = require('../server/snapshotLoader');

test('Mining Capacity model computes headroom and quadratic MC penalties correctly', () => {
  const observer = {
    ID: 4712,
    displayName: 'the Initiative',
    missionControlUsage: 45,
    completedProjects: ['Project_GoldRush']
  };
  const completedTechs = ['MissiontotheMoon', 'MissiontoMars', 'MissiontotheAsteroids']; // 3 + 6 + 6 = 15 (+6 GoldRush = 21)

  // 1. Under limit: 18 mines built, limit 21 -> 3 headroom, 0 excess, 0 penalty
  const habSitesUnder = Array.from({ length: 18 }, (_, i) => ({
    ID: 100 + i,
    mineModuleId: 500 + i,
    factionId: 4712
  }));

  const capUnder = buildMiningCapacity({
    observer,
    completedProjects: observer.completedProjects,
    completedTechs,
    difficulty: 'Normal',
    habSites: habSitesUnder
  });

  assert.strictEqual(capUnder.mineLimit, 21);
  assert.strictEqual(capUnder.minesBuilt, 18);
  assert.strictEqual(capUnder.headroom, 3);
  assert.strictEqual(capUnder.overLimit, false);
  assert.strictEqual(capUnder.excess, 0);
  assert.strictEqual(capUnder.penaltyMC, 0);
  assert.strictEqual(capUnder.penaltyHate, 0);

  // 2. Over limit: 25 mines built, limit 21 -> excess = 4
  // Quadratic penalty: Max(1, Floor(4^2 / 2)) = 8 MC
  const habSitesOver = Array.from({ length: 25 }, (_, i) => ({
    ID: 100 + i,
    mineModuleId: 500 + i,
    factionId: 4712
  }));

  const capOver = buildMiningCapacity({
    observer,
    completedProjects: observer.completedProjects,
    completedTechs,
    difficulty: 'Normal',
    habSites: habSitesOver
  });

  assert.strictEqual(capOver.minesBuilt, 25);
  assert.strictEqual(capOver.headroom, 0);
  assert.strictEqual(capOver.overLimit, true);
  assert.strictEqual(capOver.excess, 4);
  assert.strictEqual(capOver.penaltyMC, 8);
  // On normal (0.3 multiplier): 8 * 0.3 = 2.4 hate
  assert.strictEqual(capOver.penaltyHate, 2.4);

  // Marginal cost of 26th mine: next excess 5 -> penalty Max(1, Floor(25/2)) = 12 MC -> delta = 4 MC -> 1.2 hate
  assert.strictEqual(capOver.marginalNextMinePenaltyMC, 4);
  assert.strictEqual(capOver.marginalNextMinePenaltyHate, 1.2);
});

test('Destination tech mapper maps bodies accurately across solar system', () => {
  assert.strictEqual(getDestinationTechForBody('Luna'), 'MissiontotheMoon');
  assert.strictEqual(getDestinationTechForBody('Mercury'), 'MissiontotheInnerPlanets');
  assert.strictEqual(getDestinationTechForBody('Venus'), 'MissiontoVenus');
  assert.strictEqual(getDestinationTechForBody('Mars'), 'MissiontoMars');
  assert.strictEqual(getDestinationTechForBody('Phobos'), 'MissiontoMars');
  assert.strictEqual(getDestinationTechForBody('Ceres'), 'MissiontotheAsteroids');
  assert.strictEqual(getDestinationTechForBody('Vesta'), 'MissiontotheAsteroids');
  assert.strictEqual(getDestinationTechForBody('Ganymede'), 'MissiontoJupiter');
  assert.strictEqual(getDestinationTechForBody('Io'), 'MissiontoJupiter');
  assert.strictEqual(getDestinationTechForBody('Titan'), 'MissiontoSaturn');
  assert.strictEqual(getDestinationTechForBody('Enceladus'), 'MissiontoSaturn');
  assert.strictEqual(getDestinationTechForBody('Titania'), 'MissiontotheOuterPlanets');
  assert.strictEqual(getDestinationTechForBody('Triton'), 'MissiontotheOuterPlanets');
  assert.strictEqual(getDestinationTechForBody('Pluto'), 'MissiontotheOuterPlanets');
});

test('Resource runway calculation respects strict null discipline without magic floors', () => {
  const observer = {
    resources: {
      Water: 100,
      Volatiles: 5000,
      Metals: 1000,
      NobleMetals: null, // absent
      Fissiles: 50
    },
    monthlyIncome: {
      Water: 50,
      Volatiles: 200,
      Metals: 100,
      NobleMetals: 20,
      Fissiles: 10
    },
    monthlyNet: {
      Water: -50, // consumption = 50 - (-50) = 100
      Volatiles: 200, // consumption = 200 - 200 = 0 (surplus)
      Metals: 0, // consumption = 100 - 0 = 100
      NobleMetals: 20,
      Fissiles: -10 // consumption = 10 - (-10) = 20
    }
  };

  const runways = buildResourceRunways(observer);

  // Water: 100 stock / 100 consumption = 1.0 month runway (critical)
  assert.strictEqual(runways.water.stock, 100);
  assert.strictEqual(runways.water.consumption, 100);
  assert.strictEqual(runways.water.runwayMonths, 1.0);
  assert.strictEqual(runways.water.status, 'critical');

  // Volatiles: 5000 stock / 0 consumption = surplus (runway null, not forced to 5000/1)
  assert.strictEqual(runways.volatiles.consumption, 0);
  assert.strictEqual(runways.volatiles.runwayMonths, null);
  assert.strictEqual(runways.volatiles.status, 'surplus / no net consumption');

  // NobleMetals: null stock -> unmeasured
  assert.strictEqual(runways.nobleMetals.stock, null);
  assert.strictEqual(runways.nobleMetals.status, 'unmeasured');
});

test('Marginal utility scoring: zero consumption produces zero artificial urgency, not magic 50 floor', () => {
  const runways = {
    water: { stock: 100, net: 0, consumption: 100 }, // runway 1.0 mo (critical)
    volatiles: { stock: 8000, net: 200, consumption: 0 }, // unbounded surplus (consumption = 0)
    metals: { stock: 1000, net: 0, consumption: 100 },
    nobleMetals: { stock: 500, net: 10, consumption: 10 },
    fissiles: { stock: 300, net: 5, consumption: 0 } // unbounded surplus (consumption = 0)
  };
  const capacity = { headroom: 5, baseHateMultiplier: 0.3, marginalNextMinePenaltyMC: 0 };

  const fissileSite = {
    ID: 10,
    displayName: 'Fissile Rich Site',
    parentBodyName: 'Mars',
    spaceTheaterKey: 'mars',
    siteDensity: 1.0,
    water: 0,
    volatiles: 0,
    metals: 0,
    nobleMetals: 0,
    fissiles: 5.0
  };

  const scored = scoreSiteCandidate(fissileSite, runways, capacity);
  assert.strictEqual(scored.resourceGains.fissiles, 0, 'Zero-consumption resource must yield 0 marginal urgency');
  assert.strictEqual(scored.siteValue, 0, 'Site with only zero-consumption surplus resource must have 0 value');
});

test('Saturating utility scoring: balanced basket beats single-resource spike when critical', () => {
  // Scenario from §4.1:
  // Water is scarce (0.5 mo runway), Metals tight (5.6 mo runway), Volatiles comfortable.
  const runways = {
    water: { stock: 111, net: 34.8, consumption: 215 }, // 0.5 months runway (critical)
    volatiles: { stock: 8646, net: 221.7, consumption: 85 }, // 100 months runway (comfortable surplus)
    metals: { stock: 1641, net: 51.2, consumption: 290 }, // 5.6 months runway (tight)
    nobleMetals: { stock: 2674, net: 43.6, consumption: 60 },
    fissiles: { stock: 305, net: 0.3, consumption: 2 }
  };

  const capacity = { headroom: 5, baseHateMultiplier: 0.3, marginalNextMinePenaltyMC: 0 };

  // Site A: pure water spike (+200/mo water, 0 others)
  const siteSpike = {
    ID: 1,
    displayName: 'Water Spike Site',
    parentBodyName: 'Mars',
    spaceTheaterKey: 'mars',
    siteDensity: 1.0,
    water: 200 / 30,
    volatiles: 0,
    metals: 0,
    nobleMetals: 0,
    fissiles: 0
  };

  // Site B: balanced basket (+100/mo water, +100/mo volatiles, +150/mo metals)
  const siteBalanced = {
    ID: 2,
    displayName: 'Balanced Basket Site',
    parentBodyName: 'Mars',
    spaceTheaterKey: 'mars',
    siteDensity: 1.0,
    water: 100 / 30,
    volatiles: 100 / 30,
    metals: 150 / 30,
    nobleMetals: 0,
    fissiles: 0
  };

  const scoreA = scoreSiteCandidate(siteSpike, runways, capacity);
  const scoreB = scoreSiteCandidate(siteBalanced, runways, capacity);

  // The first 100 water in Site B covers the critical deficit; the extra volatiles and metals
  // push Site B to outscore the saturated single-resource spike of Site A.
  assert(scoreB.siteValue > scoreA.siteValue, `Balanced site (${scoreB.siteValue}) must outscore single-resource spike (${scoreA.siteValue})`);
});

test('Live save integration: mining-expansion endpoint works in both Player and Omniscient modes', (t) => {
  try {
    const raw = loadSnapshot();
    if (!raw) {
      t.skip('Skipping live save test: No raw snapshot available');
      return;
    }

    // Test player mode
    const playerSnap = loadFilteredSnapshot({ mode: 'player', observer: 4712 });
    const expansionPlayer = miningExpansionResource(playerSnap, { observerId: 4712 });

    assert(expansionPlayer.capacity, 'Capacity section present');
    assert(Number.isFinite(expansionPlayer.capacity.minesBuilt), 'minesBuilt is a valid number');
    assert(Number.isFinite(expansionPlayer.capacity.mineLimit), 'mineLimit is a valid number');
    assert(Array.isArray(expansionPlayer.available), 'available is an array');
    assert(Array.isArray(expansionPlayer.techGated), 'techGated is an array');
    assert(expansionPlayer.unreachable, 'unreachable summary is present');

    // Test queryIntel dispatch
    const projected = queryIntel({ snapshot: playerSnap, endpoint: 'mining-expansion', mode: 'player' });
    assert(projected.success, 'queryIntel mining-expansion should succeed');
    assert.strictEqual(projected.resource, 'mining-expansion');

    // Test omniscient mode
    const omniSnap = loadFilteredSnapshot({ mode: 'omniscient', observer: 4712 });
    const expansionOmni = miningExpansionResource(omniSnap, { observerId: 4712 });
assert(expansionOmni.capacity, 'Omniscient capacity present');
    assert.strictEqual(expansionOmni.available.length, expansionPlayer.available.length);
  } catch (err) {
    if (
      err.code === 'EBUSY' ||
      err.code === 'ENOENT' ||
      err.code === 'EPERM' ||
      err.message.includes('EBUSY') ||
      err.message.includes('locked') ||
      err.message.includes('busy') ||
      err.message.includes('No save path configured') ||
      err.message.includes('Save folder not found') ||
      err.message.includes('Save file not found') ||
      err.message.includes('No .gz or .json save files found') ||
      err.message.includes('No save files found')
    ) {
      t.skip('Skipping live save test: Live save unavailable or busy: ' + err.message);
    } else {
      throw err;
    }
  }
});
