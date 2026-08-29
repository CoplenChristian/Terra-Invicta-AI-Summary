//
// Purpose: the ship-designer component catalogue — seven families, unlock
//   joins, player/omniscient gating, drive ladders and reactor compatibility.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildShipComponentCatalogue,
  parseCatalogueNumber,
  verifyDriveThrusterLadders
} = require('../shared/shipComponentCatalogue.mjs');
const { loadFixtureFilteredSnapshot } = require('./fixtures/frozenSnapshots');

const OBSERVER = 4712;
const FAMILIES = ['drives', 'reactors', 'radiators', 'hulls', 'utilityModules', 'armour', 'batteries'];

const fixture = (mode = 'player') => loadFixtureFilteredSnapshot({ mode, observer: OBSERVER });
const catalogue = (mode = 'player', snapshot = fixture(mode)) => buildShipComponentCatalogue(snapshot, {
  mode,
  observerId: OBSERVER
});

const clone = value => structuredClone(value);

test('the catalogue exposes all seven families with truthful source and row counts', () => {
  const result = catalogue('player');

  assert.equal(result.available, true);
  assert.equal(result.complete, true);
  assert.equal(result.unresolvedCount, 0);
  assert.deepEqual(Object.keys(result.families), FAMILIES);
  assert.deepEqual(result.totals, {
    drives: { rows: 96, sourceEntries: 541, sourceOmitted: 0, variants: 541, baseRows: 96, fullLadders: 89, partialLadders: 7 },
    reactors: { rows: 61, sourceEntries: 61, sourceOmitted: 0 },
    radiators: { rows: 13, sourceEntries: 13, sourceOmitted: 0 },
    hulls: { rows: 28, sourceEntries: 28, sourceOmitted: 0 },
    utilityModules: { rows: 57, sourceEntries: 58, sourceOmitted: 1 },
    armour: { rows: 12, sourceEntries: 12, sourceOmitted: 0 },
    batteries: { rows: 10, sourceEntries: 10, sourceOmitted: 0 }
  });
  assert.match(result.families.utilityModules.sourceOmittedReason, /placeholder/);

  // The 58th utility-template row is `Empty`, a slot placeholder rather than
  // a component. It is announced in the census instead of becoming a fake
  // ungated module row.
  assert.equal(result.families.utilityModules.items.some(row => row.id === 'Empty'), false);
  assert.equal(result.items.length, 96 + 61 + 13 + 28 + 57 + 12 + 10);
  assert.equal(
    result.families.drives.items.reduce((sum, row) => sum + row.variants.length, 0),
    541,
    'drive base rows must still account for every source variant'
  );
});

test('every output row carries identity, stats, unlock metadata, and research state', () => {
  const result = catalogue('player');
  const requiredStats = {
    drives: ['EV_kps', 'thrust_N', 'thrustCap', 'flatMass_tons', 'reqPowerGW', 'thrustRatingGW'],
    reactors: ['maxOutputGW', 'specificPowerTGW', 'efficiency', 'crew'],
    radiators: ['specificPowerKWkg', 'specificMassKgM2', 'operatingTempK', 'emissivity', 'vulnerability', 'crew'],
    hulls: ['noseHardpoints', 'hullHardpoints', 'internalModules', 'structuralIntegrity', 'massTons', 'consTier', 'maxOfficers', 'crew'],
    utilityModules: ['massTons', 'powerRequirementMW', 'specialModuleValue', 'minConsTier', 'crew'],
    armour: ['baryonicHalfValueCm', 'xRayHalfValueCm', 'densityKgM3', 'heatOfVaporizationMJkg'],
    batteries: ['energyCapacityGJ', 'massTons', 'rechargeRateGJs', 'hp', 'crew']
  };

  for (const family of FAMILIES) {
    for (const row of result.families[family].items) {
      assert.equal(typeof row.id, 'string', `${family} row id`);
      assert.ok(row.displayName, `${family}:${row.id} display name`);
      assert.equal(row.family, family);
      assert.ok(row.stats && typeof row.stats === 'object', `${family}:${row.id} stats`);
      assert.equal(typeof row.researchStatus, 'string');
      assert.ok(Object.prototype.hasOwnProperty.call(row, 'researched'));
      assert.ok(Object.prototype.hasOwnProperty.call(row, 'buildable'));
      assert.ok(Object.prototype.hasOwnProperty.call(row, 'locked'));
      for (const field of requiredStats[family]) {
        assert.ok(
          row.stats[field] === null || typeof row.stats[field] === 'number',
          `${family}:${row.id}.${field} must be a number or null`
        );
      }
      if (row.unlockProject) {
        assert.equal(typeof row.unlockProject.id, 'string');
        assert.equal(typeof row.unlockProject.name, 'string');
        assert.equal(row.unlockProjectId, row.unlockProject.id);
        assert.equal(row.unlockProjectName, row.unlockProject.name);
      } else {
        assert.equal(row.unlockProjectId, null);
        assert.equal(row.unlockProjectName, null);
      }
    }
  }
});

test('player and omniscient modes follow different buildability paths over the same rows', () => {
  const player = catalogue('player');
  const omniscient = catalogue('omniscient');
  const observer = fixture('player').factions.find(faction => Number(faction.ID) === OBSERVER);
  const completed = new Set(observer.completedProjects);

  assert.equal(player.mode, 'player');
  assert.equal(omniscient.mode, 'omniscient');
  assert.deepEqual(player.driveLadder, omniscient.driveLadder);
  assert.deepEqual(player.compatibility, omniscient.compatibility);

  for (const family of FAMILIES) {
    const playerRows = new Map(player.families[family].items.map(row => [row.id, row]));
    const omniscientRows = new Map(omniscient.families[family].items.map(row => [row.id, row]));
    assert.deepEqual([...playerRows.keys()], [...omniscientRows.keys()], family);
    for (const [id, playerRow] of playerRows) {
      const omniscientRow = omniscientRows.get(id);
      assert.deepEqual(playerRow.unlockProject, omniscientRow.unlockProject, `${family}:${id} gate`);
      assert.equal(playerRow.researched, omniscientRow.researched, `${family}:${id} researched`);

      if (playerRow.unlockProject) {
        assert.equal(playerRow.researched, completed.has(playerRow.unlockProject.id), `${family}:${id} completed-project join`);
        assert.equal(playerRow.buildable, playerRow.researched, `${family}:${id} player gate`);
        assert.equal(playerRow.locked, !playerRow.researched, `${family}:${id} locked state`);
      } else {
        assert.equal(playerRow.researchStatus, 'ungated', `${family}:${id} ungated state`);
        assert.equal(playerRow.researched, null, `${family}:${id} no project is not a fabricated completion`);
        assert.equal(playerRow.buildable, true);
        assert.equal(playerRow.locked, false);
      }

      // Omniscient lists the whole catalogue even when this faction has not
      // completed the gate. The faction's researched fact remains separate.
      assert.equal(omniscientRow.buildable, true, `${family}:${id} omniscient visibility`);
      assert.equal(omniscientRow.locked, false, `${family}:${id} omniscient visibility`);
    }
  }

  const locked = player.items.filter(row => row.locked === true);
  assert.ok(locked.length > 0, 'player mode must retain locked rows');
  assert.ok(locked.every(row => row.unlockProjectId && row.unlockProjectName),
    'every locked row must name the project it needs');
});

test('the drive ladder is verified, and partial ladders remain explicit', () => {
  const result = catalogue('omniscient');
  const ladder = result.driveLadder;

  assert.equal(ladder.status, 'verified');
  assert.equal(ladder.verified, true);
  assert.equal(ladder.sourceVariantCount, 541);
  assert.equal(ladder.baseCount, 96);
  assert.equal(ladder.fullLadderCount, 89);
  assert.equal(ladder.partialLadderCount, 7);
  assert.deepEqual(ladder.expectedThrusterCounts, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(ladder.mismatches, []);
  assert.deepEqual(ladder.unknownChecks, []);
  assert.equal(ladder.idAnomalies.length, 0);
  assert.equal(ladder.fieldSummary.thrust_N.checked, 445);
  assert.equal(ladder.fieldSummary.reqPowerGW.checked, 445);
  assert.equal(ladder.fieldSummary.thrustRatingGW.checked, 445);
  assert.ok(ladder.roundingResidualCount > 0,
    'the report should show that decimal source rounding was observed, not silently erased');

  assert.ok(ladder.partialLadders.every(row => row.thrusterCounts.length === 1 && row.thrusterCounts[0] === 1));
  for (const row of result.families.drives.items) {
    const expectedCounts = row.thrusterRange.fullLadder ? [1, 2, 3, 4, 5, 6] : [1];
    assert.deepEqual(row.thrusterRange.counts, expectedCounts, row.id);
    assert.equal(row.variants.length, expectedCounts.length, row.id);
  }
});

test('drive power strings with separators parse as power, and malformed values stay null/unknown', () => {
  assert.equal(parseCatalogueNumber('2,130.928'), 2130.928);
  assert.equal(parseCatalogueNumber(null), null);
  assert.equal(parseCatalogueNumber('not numeric'), null);
  assert.equal(parseCatalogueNumber(''), null);

  const snapshot = fixture('player');
  const highPowerId = Object.entries(snapshot.driveStats)
    .sort(([, left], [, right]) => (right.reqPowerGW || 0) - (left.reqPowerGW || 0))[0][0];
  const highPower = catalogue('player').families.drives.items
    .flatMap(row => row.variants)
    .find(variant => variant.id === highPowerId);
  assert.ok(highPower.stats.reqPowerGW > 1000, `${highPowerId} must not be scored as zero power`);

  const mutated = clone(snapshot);
  const x1Id = Object.keys(mutated.driveStats).find(id => /x1$/.test(id));
  mutated.driveStats[x1Id] = { ...mutated.driveStats[x1Id], reqPowerGW: 'unparseable power' };
  const mutatedResult = buildShipComponentCatalogue(mutated, { mode: 'player', observerId: OBSERVER });
  const mutatedVariant = mutatedResult.families.drives.items
    .flatMap(row => row.variants)
    .find(variant => variant.id === x1Id);
  assert.equal(mutatedVariant.stats.reqPowerGW, null);
  assert.equal(mutatedResult.driveLadder.status, 'unknown');
  assert.ok(mutatedResult.driveLadder.unknownChecks.some(check => check.variantId === undefined || check.field === 'reqPowerGW'));
});

test('a deliberate thrust mutation is reported as a ladder mismatch', () => {
  const snapshot = fixture('omniscient');
  const mutatedDrives = clone(snapshot.driveStats);
  const targetId = Object.keys(mutatedDrives).find(id => /x2$/.test(id));
  mutatedDrives[targetId] = {
    ...mutatedDrives[targetId],
    thrust_N: mutatedDrives[targetId].thrust_N + 1
  };

  const report = verifyDriveThrusterLadders(mutatedDrives);
  assert.equal(report.status, 'mismatch');
  assert.equal(report.verified, false);
  assert.ok(report.mismatches.some(row => row.variantId === targetId && row.field === 'thrust_N'));
});

test('each drive emits its reactor-compatible set, including the Any_General wildcard', () => {
  const result = catalogue('player');
  const reactors = result.families.reactors.items;
  const reactorIds = reactors.map(row => row.id);
  assert.equal(result.compatibility.reactorCount, 61);
  assert.equal(result.compatibility.wildcard.variantCount, 163);
  assert.equal(result.compatibility.wildcard.baseDriveCount, 33);

  const wildcard = result.families.drives.items.find(row => row.requiredPowerPlantClass === 'Any_General');
  assert.ok(wildcard);
  assert.deepEqual(wildcard.compatibleReactorIds, reactorIds);
  assert.equal(wildcard.reactorCompatibility.status, 'wildcard');

  const named = result.families.drives.items.find(row => row.requiredPowerPlantClass !== 'Any_General');
  assert.ok(named);
  const expected = reactors
    .filter(row => row.stats.powerPlantClass === named.requiredPowerPlantClass)
    .map(row => row.id);
  assert.deepEqual(named.compatibleReactorIds, expected);
  assert.equal(named.reactorCompatibility.status, 'class-match');

  const molten = result.compatibility.reactorClasses
    .find(row => row.powerPlantClass === 'Molten_Salt_Core_Fission');
  assert.ok(molten, 'the reactor class no drive names must remain in the catalogue summary');
  assert.equal(result.compatibility.reactorClassCount, 13);
  assert.equal(result.compatibility.requiredClassNameCount, 12);
  assert.equal(molten.directlyNamedByDriveVariantCount, 0);
  assert.ok(result.compatibility.unreferencedDirectClasses.includes('Molten_Salt_Core_Fission'));
  assert.equal(
    result.families.drives.items.some(row => row.requiredPowerPlantClass === 'Molten_Salt_Core_Fission'),
    false,
    'Molten_Salt_Core_Fission must not be implied as a drive requirement'
  );
});

test('an absent unlock index makes player research state unknown instead of safe-looking locked/available', () => {
  const snapshot = fixture('player');
  const withoutIndex = { ...snapshot };
  delete withoutIndex.unlockIndex;
  const result = buildShipComponentCatalogue(withoutIndex, { mode: 'player', observerId: OBSERVER });

  assert.equal(result.available, false);
  assert.match(result.reason, /unlockIndex/);
  assert.equal(result.unresolvedCount, 0);
  assert.ok(result.families.drives.items.length > 0, 'static rows remain readable while the gate is unavailable');
  assert.ok(result.families.drives.items.every(row => row.researchStatus === 'unknown'));
  assert.ok(result.families.drives.items.every(row => row.buildable === null && row.locked === null));
  assert.ok(result.families.drives.items.every(row => row.unlockProjectId === null));
});

test('a missing family source is announced and its compatibility becomes unknown', () => {
  const snapshot = fixture('player');
  const withoutReactors = {
    ...snapshot,
    componentStats: { ...snapshot.componentStats, power_plant: undefined }
  };
  const result = buildShipComponentCatalogue(withoutReactors, { mode: 'player', observerId: OBSERVER });

  assert.equal(result.available, false);
  assert.match(result.reason, /reactors stats/);
  assert.equal(result.families.reactors.available, false);
  assert.equal(result.families.reactors.totalCount, null);
  assert.equal(result.compatibility.reactorSourceAvailable, false);
  assert.ok(result.families.drives.items.every(row => row.compatibleReactorIds === null));
});

test('a real missing utility row is not mistaken for the known Empty placeholder', () => {
  const snapshot = fixture('player');
  const utilityModules = { ...snapshot.componentStats.utility_module };
  delete utilityModules[Object.keys(utilityModules)[0]];
  const result = buildShipComponentCatalogue({
    ...snapshot,
    componentStats: { ...snapshot.componentStats, utility_module: utilityModules }
  }, { mode: 'player', observerId: OBSERVER });

  assert.equal(result.families.utilityModules.sourceOmittedCount, 2);
  assert.deepEqual(result.families.utilityModules.sourceOmittedIds, []);
  assert.ok(result.unresolved.some(entry => entry.kind === 'component-census'
    && entry.family === 'utilityModules'));
  assert.equal(result.complete, false);
});
