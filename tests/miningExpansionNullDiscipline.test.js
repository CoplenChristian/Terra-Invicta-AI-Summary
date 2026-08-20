/**
 * Mining expansion: one implementation, and absent stays null on the LIVE
 * endpoint path.
 *
 * `server/miningExpansion.js` used to carry a full second copy of the
 * capacity / runway / scoring model while the endpoint the dashboard actually
 * calls (`/api/intel/mining-expansion`) was served by `miningExpansionResource`
 * in `shared/intelResources.mjs`. The two had diverged: every null-honesty fix
 * landed in the copy the user never saw, and the live one still wrote
 * `?? 0.3` for difficulty, `?? 0` for resource rates and `hateCost = 0` for an
 * unknown multiplier.
 */

const test = require('node:test');
const assert = require('node:assert');

const miningExpansionModule = require('../server/miningExpansion');
const sharedIntel = require('../shared/intelResources.mjs');

const {
  buildMiningCapacity,
  buildResourceRunways,
  evaluateUtility,
  scoreSiteCandidate,
  buildMiningExpansion
} = miningExpansionModule;

const {
  miningExpansionResource,
  miningResourceRow,
  habSiteResourceRow,
  alienThreatResource
} = sharedIntel;

// ---------------------------------------------------------------------------
// ONE implementation
// ---------------------------------------------------------------------------

test('the server mining module delegates to the shared implementation rather than duplicating it', () => {
  assert.strictEqual(buildMiningCapacity, sharedIntel.buildMiningCapacity);
  assert.strictEqual(buildResourceRunways, sharedIntel.buildMiningResourceRunways);
  assert.strictEqual(evaluateUtility, sharedIntel.evaluateSaturatingUtility);
  assert.strictEqual(scoreSiteCandidate, sharedIntel.scoreMiningSiteCandidate);
  assert.strictEqual(miningExpansionModule.compareMiningCandidates, sharedIntel.compareMiningCandidates);
});

test('buildMiningExpansion returns exactly what the live endpoint builder returns', () => {
  const snapshot = {
    metadata: { difficulty: 'Normal' },
    factions: [{
      ID: 4712,
      displayName: 'the Initiative',
      missionControlUsage: 100,
      completedProjects: ['Project_OutpostMiningComplex'],
      resources: { Water: 100, Volatiles: 100, Metals: 100, NobleMetals: 100, Fissiles: 100 },
      monthlyIncome: { Water: 50, Volatiles: 50, Metals: 50, NobleMetals: 50, Fissiles: 50 },
      monthlyNet: { Water: -50, Volatiles: -50, Metals: -50, NobleMetals: -50, Fissiles: -50 }
    }],
    techTree: { finishedTechsNames: ['MissiontotheAsteroids'] },
    habSites: [{
      ID: 9001, displayName: 'Test Site', parentBodyName: 'Ceres', spaceTheaterKey: 'belt',
      factionId: null, factionName: 'Unclaimed', siteDensity: 2,
      water: 1, volatiles: 1, metals: 1, nobleMetals: 1, fissiles: 1
    }]
  };

  const viaServerModule = buildMiningExpansion({ snapshot, observerId: 4712 });
  const viaLiveEndpoint = miningExpansionResource(snapshot, { observerId: 4712 });
  assert.deepStrictEqual(viaServerModule, viaLiveEndpoint);
  assert.strictEqual(viaServerModule.available.length, 1);
});

test('the destination-tech resolver labels the main-belt fallback as an assumption', () => {
  assert.deepStrictEqual(
    sharedIntel.resolveBodyDestinationTech('Luna', 'sol'),
    { tech: 'MissiontotheMoon', source: 'body name' }
  );
  assert.deepStrictEqual(
    sharedIntel.resolveBodyDestinationTech('Ganymede', 'jupiter'),
    { tech: 'MissiontoJupiter', source: 'space theater' }
  );
  // ~100 of the 296 unowned sites on a live save are numbered main-belt rocks
  // the space-theater table does not name. The answer is right for those and a
  // guess for anything else that lands there, so it is labelled.
  const guessed = sharedIntel.resolveBodyDestinationTech('18 Melpomene', 'unassigned');
  assert.strictEqual(guessed.tech, 'MissiontotheAsteroids');
  assert.match(guessed.source, /^assumed/);
});

// ---------------------------------------------------------------------------
// Difficulty is not cosmetic: it selects the alien hate floor multiplier.
// ---------------------------------------------------------------------------

test('an absent difficulty leaves the mining hate cost unavailable on the live endpoint path', () => {
  const expansion = miningExpansionResource({
    metadata: {},                                   // no difficulty at all
    factions: [{ ID: 4712, displayName: 'the Initiative', missionControlUsage: 100 }],
    habSites: []
  }, { observerId: 4712 });

  assert.strictEqual(expansion.capacity.baseHateMultiplier, null, 'must not fall back to Normal (0.3)');
  assert.strictEqual(expansion.capacity.difficultyMultiplier, null);
  assert.strictEqual(expansion.capacity.difficulty, null);
  assert.strictEqual(expansion.capacity.hateCostAvailable, false);
  assert.strictEqual(expansion.capacity.penaltyHate, null);
  assert.strictEqual(expansion.capacity.marginalNextMinePenaltyHate, null);
  assert.ok(
    expansion.assumptions.some(note => note.includes('UNAVAILABLE')),
    'the board states the hate cost is unpriceable rather than quietly using Normal'
  );
});

test('a measured difficulty still produces the wiki multipliers', () => {
  for (const [difficulty, multiplier] of Object.entries({
    Cinematic: 0.05, Normal: 0.30, Veteran: 0.60, Brutal: 1.00
  })) {
    const expansion = miningExpansionResource({
      metadata: { difficulty },
      factions: [{ ID: 4712, displayName: 'the Initiative', missionControlUsage: 100 }],
      habSites: []
    }, { observerId: 4712 });
    assert.strictEqual(expansion.capacity.difficultyMultiplier, multiplier, `${difficulty} multiplier`);
    assert.strictEqual(expansion.capacity.hateCostAvailable, true);
  }
});

test('alienThreatResource does not invent Normal difficulty when the save carries none', () => {
  const withDifficulty = alienThreatResource({
    metadata: { difficulty: 'Brutal' },
    factions: [{ ID: 4712, displayName: 'the Initiative', missionControlUsage: 100 }]
  }, 4712);
  assert.strictEqual(withDifficulty.difficulty, 'Brutal');
  assert.strictEqual(withDifficulty.difficultyMultiplier, 1.0);
  assert.strictEqual(withDifficulty.difficultyMeasured, true);

  const without = alienThreatResource({
    metadata: {},
    factions: [{ ID: 4712, displayName: 'the Initiative', missionControlUsage: 100 }]
  }, 4712);
  assert.strictEqual(without.difficulty, null, 'must not report "Normal" for a save that does not say so');
  assert.strictEqual(without.difficultyMultiplier, null);
  assert.strictEqual(without.difficultyMeasured, false);
  assert.strictEqual(without.minimumHate, null, 'an unpriceable hate floor is null, not a number');
});

// ---------------------------------------------------------------------------
// Per-resource columns follow the same rule as effectiveMonthlyOutput.
// ---------------------------------------------------------------------------

test('unmeasured per-resource rates stay null on the mining and hab-sites endpoints', () => {
  const site = {
    ID: 4730, displayName: 'Tolkien Crater', parentBodyName: 'Mercury',
    habId: 48030, habName: 'Piri Reis Base', factionId: 4712, factionName: 'the Initiative',
    water: 0.5, volatiles: null, metals: undefined, nobleMetals: '', fissiles: 0
  };

  const mining = miningResourceRow(site);
  assert.strictEqual(mining.water, 0.5, 'a measured rate is reported');
  assert.strictEqual(mining.fissiles, 0, 'a measured zero is still a zero');
  assert.strictEqual(mining.volatiles, null, 'an absent rate must not print as 0');
  assert.strictEqual(mining.metals, null);
  assert.strictEqual(mining.nobles, null);
  assert.strictEqual(mining.effectiveMonthlyOutputMeasured, false);
  assert.strictEqual(mining.measuredResourceCount, 2);

  const habSite = habSiteResourceRow(site);
  assert.strictEqual(habSite.water, 0.5);
  assert.strictEqual(habSite.volatiles, null);
  assert.strictEqual(habSite.metals, null);
  assert.strictEqual(habSite.nobleMetals, null);
  assert.strictEqual(habSite.resourceRatesMeasured, false);

  const complete = miningResourceRow({ ...site, volatiles: 1, metals: 2, nobleMetals: 3 });
  assert.strictEqual(complete.effectiveMonthlyOutputMeasured, true);
  assert.strictEqual(complete.measuredResourceCount, 5);
});

test('infrastructure mine output reports an absent rate as null, not as zero tonnes mined', () => {
  const detail = sharedIntel.infrastructureResource({
    habs: [{ ID: 48030, displayName: 'Piri Reis Base', factionId: 4712, orbitBody: 'Mercury', tier: 2 }],
    habSites: [{ ID: 4730, habId: 48030, displayName: 'Tolkien Crater', parentBodyName: 'Mercury',
      water: 0.5, volatiles: null, metals: 2, nobleMetals: null, fissiles: 0 }],
    habModules: []
  }, 4712);

  const hab = detail.find(entry => Number(entry.habId) === 48030);
  assert.ok(hab, 'the hab is present');
  assert.strictEqual(hab.mineOutput.water, 15);
  assert.strictEqual(hab.mineOutput.metals, 60);
  assert.strictEqual(hab.mineOutput.fissiles, 0, 'a measured zero rate is still zero output');
  assert.strictEqual(hab.mineOutput.volatiles, null, 'an absent rate must not read as 0 t/month');
  assert.strictEqual(hab.mineOutput.nobles, null);
  assert.strictEqual(hab.mineOutput.measured, false);
});

// ---------------------------------------------------------------------------
// Unknown value, unknown cost, and their effect on ranking.
// ---------------------------------------------------------------------------

test('a site the runway model cannot evaluate at all scores null, never a confident zero', () => {
  const capacity = { headroom: 4, marginalNextMinePenaltyMC: 0, baseHateMultiplier: 0.3 };
  const nothingMeasured = scoreSiteCandidate(
    { ID: 1, displayName: 'Unreadable', parentBodyName: 'Ceres', spaceTheaterKey: 'belt', siteDensity: 1 },
    {},
    capacity
  );
  assert.strictEqual(nothingMeasured.siteValue, null, '0 would read as "measured and worthless"');
  assert.strictEqual(nothingMeasured.siteValueMeasured, false);
  assert.strictEqual(nothingMeasured.valuePerHate, null);

  // Measured-but-barren is still a real zero.
  const runways = {
    water: { key: 'water', stock: 100, income: 20, net: 5, consumption: 15 },
    volatiles: { key: 'volatiles', stock: 100, income: 20, net: 5, consumption: 15 },
    metals: { key: 'metals', stock: 100, income: 20, net: 5, consumption: 15 },
    nobleMetals: { key: 'nobleMetals', stock: 100, income: 20, net: 5, consumption: 15 },
    fissiles: { key: 'fissiles', stock: 100, income: 20, net: 5, consumption: 15 }
  };
  const barren = scoreSiteCandidate(
    { ID: 2, displayName: 'Barren', parentBodyName: 'Ceres', spaceTheaterKey: 'belt', siteDensity: 1,
      water: 0, volatiles: 0, metals: 0, nobleMetals: 0, fissiles: 0 },
    runways,
    capacity
  );
  assert.strictEqual(barren.siteValue, 0);
  assert.strictEqual(barren.siteValueMeasured, true);
});

test('an unassessable site never sorts as though it were free or worthless', () => {
  const unknownCost = { siteValue: 9, hateCost: null, valuePerHate: null };
  const freeSite = { siteValue: 1, hateCost: 0, valuePerHate: 1 };
  const pricedSite = { siteValue: 5, hateCost: 0.3, valuePerHate: 16.7 };
  const unscored = { siteValue: null, hateCost: 0.3, valuePerHate: null };

  const sorted = [unknownCost, unscored, pricedSite, freeSite].sort(sharedIntel.compareMiningCandidates);
  assert.strictEqual(sorted[0], freeSite, 'a hate-free site still ranks first');
  assert.strictEqual(sorted[1], pricedSite);
  assert.strictEqual(sorted[2], unscored, 'a priced-but-unscored site outranks an unpriceable one');
  assert.strictEqual(sorted[3], unknownCost, 'an unpriceable site sorts last, not first');
});

test('a tech-gated group with no scoreable site reports a null best value, not 0', () => {
  const expansion = miningExpansionResource({
    metadata: { difficulty: 'Normal' },
    factions: [{
      ID: 4712, displayName: 'the Initiative', missionControlUsage: 100,
      completedProjects: ['Project_OutpostMiningComplex']
    }],
    // No mission tech for Saturn, so the site is gated. No runway inputs at
    // all, so it cannot be scored either.
    techTree: { finishedTechsNames: [] },
    habSites: [{
      ID: 9002, displayName: 'Gated', parentBodyName: 'Titan', spaceTheaterKey: 'saturn',
      factionId: null, factionName: 'Unclaimed', siteDensity: 1,
      water: 1, volatiles: 1, metals: 1, nobleMetals: 1, fissiles: 1
    }]
  }, { observerId: 4712 });

  assert.strictEqual(expansion.techGated.length, 1);
  const group = expansion.techGated[0];
  assert.strictEqual(group.missingTech, 'MissiontoSaturn');
  assert.strictEqual(group.siteCount, 1);
  assert.strictEqual(group.unmeasuredSiteCount, 1);
  assert.strictEqual(group.bestSiteValue, null, 'Math.max(0, null) would publish a confident 0');
});

test('the available list reports its true total and how many entries were omitted', () => {
  const habSites = Array.from({ length: 5 }, (_, i) => ({
    ID: 9100 + i, displayName: `Site ${i}`, parentBodyName: 'Ceres', spaceTheaterKey: 'belt',
    factionId: null, factionName: 'Unclaimed', siteDensity: 1,
    water: 1 + i, volatiles: 0, metals: 0, nobleMetals: 0, fissiles: 0
  }));
  const snapshot = {
    metadata: { difficulty: 'Normal' },
    factions: [{
      ID: 4712, displayName: 'the Initiative', missionControlUsage: 100,
      completedProjects: ['Project_OutpostMiningComplex'],
      resources: { Water: 100 }, monthlyIncome: { Water: 50 }, monthlyNet: { Water: -50 }
    }],
    techTree: { finishedTechsNames: ['MissiontotheAsteroids'] },
    habSites
  };

  const capped = miningExpansionResource(snapshot, { observerId: 4712, limit: 2 });
  assert.strictEqual(capped.available.length, 2);
  assert.strictEqual(capped.availableTotalCount, 5, 'the true total travels with the capped view');
  assert.strictEqual(capped.availableOmittedCount, 3);

  const uncapped = miningExpansionResource(snapshot, { observerId: 4712 });
  assert.strictEqual(uncapped.availableTotalCount, 5);
  assert.strictEqual(uncapped.availableOmittedCount, 0);
});
