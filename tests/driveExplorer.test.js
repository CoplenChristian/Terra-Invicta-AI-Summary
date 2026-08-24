// tests/driveExplorer.test.js
//
// Purpose: pins /api/intel/drive-explorer and the DRIVES panel — the measured
//   half, the estimated half, the reactor gate, and the four availability
//   states — against the live save and a turn-1 faction.
//
// The distinction this file exists to defend: delta-V and acceleration are
// MEASURED (the propulsion model against this hull's own measured mass);
// destination reachability is an ESTIMATE from a labelled heuristic table. Every
// assertion about the estimate half checks that it is marked as one.
//
// Live-save independence: assertions here are either PROPERTIES ("the counts
// reconcile", "an incompatible drive names the class it needs") or are made
// against the synthetic turn-1 snapshot. No drive, design or destination name
// is hardcoded -- docs/research-advisor-spec.md section 0 forbids it, and a
// campaign-specific test would pass here and fail on the next save.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const snapshotBuilder = require('../server/snapshotBuilder');
const snapshotIdentity = require('../server/snapshotIdentity');
const intelligenceFilter = require('../server/intelligenceFilter');
const { makeSaveData } = require('./fixtures/syntheticSave');
const { loadFixtureFilteredSnapshot } = require('./fixtures/frozenSnapshots');
const { MISSION_CONTROL_SHARED } = require('./fixtures/renderHarness');
const { buildResourceProjection, INTEL_ENDPOINT_INDEX, INTEL_ENDPOINT_EXAMPLES, SUPPORTED_RESOURCES } =
  require('../shared/intel/registry.mjs');
const { DRIVE_AVAILABILITY, DRIVE_SORTS, MEASUREMENT_BASIS, driveExplorerResource } =
  require('../shared/intel/driveExplorer.mjs');
const { AVAILABILITY_STATES } = require('../shared/researchAvailability.mjs');
const templateLoader = require('../server/templateLoader');

const OBSERVER = 4712;

const liveCache = new Map();
function live(mode) {
  if (!liveCache.has(mode)) {
    liveCache.set(mode, loadFixtureFilteredSnapshot({ mode, observer: OBSERVER }));
  }
  return liveCache.get(mode);
}

const project = (snapshot, options = {}) =>
  buildResourceProjection(snapshot, 'drive-explorer', { mode: 'player', ...options });

/** Every row, so a census assertion is about the catalogue and not a page of it. */
const allRows = (snapshot, options = {}) => project(snapshot, { limit: 1000, ...options });

function filtered(save, mode) {
  const raw = snapshotBuilder.buildRawSnapshot(save);
  const identity = snapshotIdentity.createSnapshotIdentity(
    { fullPath: 'synthetic.gz', lastModified: new Date('2025-01-01T00:00:00Z'), saveHash: 'x' },
    'initiative'
  );
  return intelligenceFilter.applyFilter({ ...raw, ...identity }, mode, OBSERVER);
}

// ---------------------------------------------------------------------------
// 1. REGISTRATION
// ---------------------------------------------------------------------------

test('the endpoint is registered the same way every other intel endpoint is', () => {
  assert.ok(SUPPORTED_RESOURCES.has('drive-explorer'), 'the dispatcher must answer drive-explorer');
  assert.strictEqual(INTEL_ENDPOINT_INDEX.driveExplorer, '/api/intel/drive-explorer');
  assert.ok(INTEL_ENDPOINT_EXAMPLES.driveExplorer.includes('observer='),
    'the discovery index must publish a usable example');
});

// ---------------------------------------------------------------------------
// 2. THE COUNTS RECONCILE -- every drive is represented or accounted for
// ---------------------------------------------------------------------------

test('every drive in the catalogue is rated or explicitly accounted for', () => {
  for (const mode of ['player', 'omniscient']) {
    const payload = allRows(live(mode), { mode });
    const catalogue = payload.driveCatalogue;
    assert.ok(catalogue.available, `[${mode}] the drive catalogue must be present on the live save`);
    assert.strictEqual(
      catalogue.rated + payload.unresolvedCount,
      catalogue.total,
      `[${mode}] rated + unresolved must equal the whole catalogue`
    );
    assert.strictEqual(catalogue.reconciles, true, `[${mode}] the endpoint must report its own reconciliation`);
    assert.strictEqual(
      payload.itemsShownCount + payload.itemsOmittedCount,
      payload.itemsTotalCount,
      `[${mode}] shown + omitted must equal the filtered total`
    );
    assert.strictEqual(
      payload.itemsTotalCount + payload.filters.filteredOutCount,
      catalogue.rated,
      `[${mode}] filtered + filtered-out must equal the rated set`
    );

    const census = payload.availabilityCensus;
    const censusTotal = Object.values(census).reduce((sum, value) => sum + value, 0);
    assert.strictEqual(censusTotal, catalogue.total,
      `[${mode}] the four availability buckets must partition the whole catalogue`);
  }
});

test('a cap announces itself rather than presenting a slice as the whole set', () => {
  const capped = project(live('player'), { limit: 5 });
  assert.ok(capped.itemsTotalCount > capped.itemsShownCount, 'the fixture must actually be truncated');
  assert.strictEqual(capped.itemsOmittedCount, capped.itemsTotalCount - capped.itemsShownCount);
  assert.ok(capped.itemsOmittedCount > 0, 'a truncated response must report a non-zero omitted count');
});

// ---------------------------------------------------------------------------
// 3. THE FOUR AVAILABILITY STATES
// ---------------------------------------------------------------------------

test('the four availability buckets are all populated and none is silently dropped', () => {
  const payload = allRows(live('player'));
  const census = payload.availabilityCensus;

  assert.deepStrictEqual(
    Object.keys(census).sort(),
    ['fittable', 'never', 'researchable', 'unresolved'],
    'exactly the four documented buckets, no more and no fewer'
  );
  assert.ok(census.fittable > 0, 'the observer must have at least one drive it can fit today');
  assert.ok(census.researchable > 0, 'locked drives must be listed, not hidden');
  assert.ok(census.never > 0, 'never-researchable drives must be listed, not hidden');

  // Locked is labelled, not offered: every researchable row carries a state and
  // a chain, and none of them is presented as fittable.
  for (const row of payload.items.filter(r => r.availability.bucket === DRIVE_AVAILABILITY.researchable)) {
    assert.notStrictEqual(row.availability.state, AVAILABILITY_STATES.completed);
    assert.notStrictEqual(row.availability.state, AVAILABILITY_STATES.ungated);
  }
  // Never-researchable rows are the faction-restricted / researchCost -1 set.
  for (const row of payload.items.filter(r => r.availability.bucket === DRIVE_AVAILABILITY.never)) {
    assert.strictEqual(row.availability.state, AVAILABILITY_STATES.factionRestricted);
  }
});

test('an unresolved drive is dropped with a recorded reason, never as a blank row', () => {
  // Force the unresolved path by removing the tech tree the resolver reads.
  const snapshot = { ...live('player'), techTree: null };
  const payload = allRows(snapshot);

  assert.ok(payload.unresolvedCount > 0, 'without a tech tree every gated drive must be unresolved');
  assert.strictEqual(payload.items.length, payload.driveCatalogue.rated);
  assert.strictEqual(
    payload.driveCatalogue.rated + payload.unresolvedCount,
    payload.driveCatalogue.total,
    'the unresolved rows must still reconcile against the catalogue'
  );
  for (const entry of payload.unresolvedDrives) {
    assert.ok(entry.driveId, 'an unresolved entry must name the drive');
    assert.ok(typeof entry.reason === 'string' && entry.reason.length > 0,
      'an unresolved entry must carry a reason, not a blank');
  }
});

test('the -1 research-cost sentinel is never summed into a chain cost', () => {
  const payload = allRows(live('omniscient'), { mode: 'omniscient', detail: 'full' });
  const sentinelGated = payload.items.filter(row => row.availability.bucket === DRIVE_AVAILABILITY.never);
  assert.ok(sentinelGated.length > 0, 'the fixture must contain never-researchable drives');
  for (const row of sentinelGated) {
    assert.strictEqual(row.availability.chain, null,
      'a drive that is never researchable must not be quoted a research chain');
    assert.strictEqual(row.availability.researchCost, null,
      'the -1 sentinel must surface as null, never as a cost');
  }
  // And where a chain IS quoted, an incomplete one says so rather than
  // reporting a total that silently excludes an uncosted node.
  for (const row of payload.items.filter(r => r.availability.chain)) {
    if (row.availability.chain.costComplete === false) {
      assert.strictEqual(row.availability.chain.totalRemainingResearchCost, null,
        'an incomplete chain must report null, not a partial sum presented as a total');
      assert.ok(row.availability.chain.uncostedNodes.length > 0,
        'an incomplete chain must name the nodes it could not cost');
    } else {
      assert.ok(Number.isFinite(row.availability.chain.totalRemainingResearchCost));
    }
  }
});

// ---------------------------------------------------------------------------
// 4. THE REACTOR GATE
// ---------------------------------------------------------------------------

test('the reactor rule pins across every design in the save', () => {
  const snapshot = live('omniscient');
  const drives = snapshot.driveStats || {};
  const plants = (snapshot.componentStats || {}).power_plant || {};
  let pass = 0;
  let fail = 0;
  let unresolved = 0;

  for (const design of snapshot.shipDesigns) {
    const drive = drives[design.driveName];
    const plant = plants[design.powerPlantName];
    if (!drive?.requiredPowerPlant || !plant?.powerPlantClass) { unresolved += 1; continue; }
    if (drive.requiredPowerPlant === 'Any_General' || drive.requiredPowerPlant === plant.powerPlantClass) pass += 1;
    else fail += 1;
  }

  assert.ok(pass > 0, 'the save must contain designs to check the rule against');
  assert.strictEqual(fail, 0, 'no shipped design may violate the reactor-class rule');
  assert.strictEqual(unresolved, 0, 'every shipped design must resolve both halves of the rule');
});

test('a reactor-incompatible drive is shown, marked, and names the class it would need', () => {
  const snapshot = live('player');
  const payload = allRows(snapshot);
  const designClass = payload.selectedDesign.reactor.powerPlantClass;
  assert.ok(designClass, 'the selected design must resolve a reactor class');

  const incompatible = payload.items.filter(row => row.reactor.compatible === false);
  assert.ok(incompatible.length > 0, 'the catalogue must contain drives this design cannot power');

  for (const row of incompatible) {
    assert.strictEqual(row.reactor.verdict, 'fail');
    assert.ok(row.reactor.requiredPowerPlant, 'an incompatible row must name the class it needs');
    assert.notStrictEqual(row.reactor.requiredPowerPlant, designClass);
    assert.notStrictEqual(row.reactor.requiredPowerPlant, 'Any_General');
    // Shown, not hidden: the row still carries its measured figures.
    assert.ok('deltaVKps' in row.measured, 'an incompatible drive keeps its performance figures');
  }

  // Non-vacuous the other way: every compatible row either matches the class or
  // is the Any_General sentinel.
  for (const row of payload.items.filter(r => r.reactor.compatible === true)) {
    assert.ok(row.reactor.requiredPowerPlant === 'Any_General'
      || row.reactor.requiredPowerPlant === designClass,
    'a row marked compatible must actually satisfy the rule');
  }
});

test('the verdict is design-specific: switching designs moves drives across the gate', () => {
  const snapshot = live('player');
  const classes = new Map();
  for (const design of snapshot.shipDesigns) {
    const plant = ((snapshot.componentStats || {}).power_plant || {})[design.powerPlantName];
    if (plant?.powerPlantClass) classes.set(plant.powerPlantClass, design.dataName);
  }
  assert.ok(classes.size >= 2, 'the observer must fly at least two reactor classes for this comparison');

  const [firstDesign, secondDesign] = [...classes.values()];
  const a = allRows(snapshot, { designId: firstDesign });
  const b = allRows(snapshot, { designId: secondDesign });
  assert.notStrictEqual(a.selectedDesign.reactor.powerPlantClass, b.selectedDesign.reactor.powerPlantClass);

  const compatA = new Set(a.items.filter(r => r.reactor.compatible === true).map(r => r.driveId));
  const compatB = new Set(b.items.filter(r => r.reactor.compatible === true).map(r => r.driveId));
  const movedEitherWay = [...compatA].some(id => !compatB.has(id)) || [...compatB].some(id => !compatA.has(id));
  assert.ok(movedEitherWay, 'a different reactor class must admit a different set of drives');
});

test('power is information, never a veto', () => {
  const payload = allRows(live('player'), { detail: 'full' });
  const overdrawn = payload.items.filter(row => {
    const factor = row.power.thrustScalingFactor;
    return factor !== null && factor < 1;
  });
  assert.ok(overdrawn.length > 0, 'the catalogue must contain drives that outdraw this design\'s plant');
  for (const row of overdrawn.slice(0, 25)) {
    assert.strictEqual(row.power.informational, true, 'the power reading must be labelled informational');
    assert.ok(row.power.driveDrawGW > row.power.plantOutputGW,
      'the scaling factor must only be below 1 when the draw genuinely exceeds the plant');
    // Present, ranked, and never removed on power grounds.
    assert.ok(payload.items.includes(row));
  }
});

// ---------------------------------------------------------------------------
// 5. PARSING TRAPS
// ---------------------------------------------------------------------------

test('req power parses comma-safe: a thousands separator never becomes zero draw', () => {
  templateLoader.load();
  const snapshot = live('player');
  const drives = snapshot.driveStats || {};

  let commaDrives = 0;
  for (const template of templateLoader.templates.drives.values()) {
    const raw = template['req power'];
    if (typeof raw !== 'string' || !raw.includes(',')) continue;
    commaDrives += 1;
    const baked = drives[template.dataName]?.reqPowerGW;
    const expected = Number(raw.replace(/,/g, '').trim());
    assert.ok(Number.isFinite(expected) && expected > 0, `${template.dataName} must have a real power figure`);
    assert.strictEqual(baked, expected,
      `${template.dataName}: '${raw}' must parse to ${expected}, not NaN and not 0`);
    assert.notStrictEqual(baked, 0, `${template.dataName} must not be scored as drawing zero power`);
  }
  assert.ok(commaDrives >= 90, `at least 90 drives carry a comma-formatted power figure (found ${commaDrives})`);

  // And the figure survives all the way to the endpoint rather than being
  // re-parsed on the way out.
  const payload = allRows(snapshot, { detail: 'full' });
  const commaRow = payload.items.find(row => {
    const template = templateLoader.templates.drives.get(row.driveId);
    return typeof template?.['req power'] === 'string' && template['req power'].includes(',');
  });
  assert.ok(commaRow, 'at least one comma-formatted drive must appear in the response');
  assert.ok(commaRow.power.driveDrawGW > 0, 'its draw must reach the response as a real number');
});

test('a zero fixed drive mass is a real value, not a missing one', () => {
  const snapshot = live('player');
  const zeroMass = Object.entries(snapshot.driveStats)
    .filter(([, drive]) => drive.flatMass_tons === 0);
  assert.ok(zeroMass.length > 0, 'the templates must contain drives with a genuine zero fixed mass');

  const payload = allRows(snapshot, { detail: 'full' });
  for (const [driveId] of zeroMass.slice(0, 20)) {
    const row = payload.items.find(item => item.driveId === driveId);
    assert.ok(row, `${driveId} must be present in the catalogue`);
    assert.strictEqual(row.measured.flatMassTons, 0,
      'a measured zero fixed mass must be reported as 0, not as unavailable');
  }

  // The caveat is raised by a DIFFERENCE in fixed mass, so it must fire when the
  // candidate is heavy and the fitted drive is not -- and stay silent when both
  // are the same. Both directions are asserted so the caveat is not vacuous.
  const withCaveat = payload.items.filter(row => row.measured.dryMassCaveat !== null);
  const withoutCaveat = payload.items.filter(row => row.measured.dryMassCaveat === null && row.measured.computable);
  assert.ok(withCaveat.length > 0, 'some drives must raise the constant-dry-mass caveat');
  assert.ok(withoutCaveat.length > 0, 'and some must not');
  for (const row of withCaveat.slice(0, 10)) {
    assert.match(row.measured.dryMassCaveat, /constant-dry-mass refit/);
  }
});

// ---------------------------------------------------------------------------
// 5b. CRUISE ACCELERATION IS A SECOND MEASUREMENT, NOT A RESTATEMENT
//
// `combat = cruise * thrustCap` by construction (shared/propulsion.mjs), and
// `thrustCap` runs 1 to 160 across the shipped catalogue. Every assertion here
// is a PROPERTY of that relationship rather than a named drive or a fixed
// figure: which drive tops the cruise ordering depends on the design being rated
// (a heavier drive raises the hull's wet mass), so a hardcoded name or value
// would pass on this campaign and fail on the next. The named figures the spec
// quotes are checked in scripts/verify_drive_explorer.js against whatever the
// live save actually holds, by reading the payload rather than a constant.
// ---------------------------------------------------------------------------

test('cruise acceleration travels on the compact row, in the measured register', () => {
  for (const mode of ['player', 'omniscient']) {
    const payload = allRows(live(mode), { mode });
    for (const row of payload.items.slice(0, 60)) {
      assert.ok('cruiseAccelerationMps2' in row.measured,
        `[${mode}] ${row.driveId}: cruise acceleration must be on the summary row, not only under detail=full`);
      assert.ok('cruiseAccelerationMultipleVsFitted' in row.measured,
        `[${mode}] ${row.driveId}: the cruise column needs its own multiple against the fitted drive`);
      assert.strictEqual(row.measured.basis, MEASUREMENT_BASIS.measured);
    }
    assert.ok('cruiseAccelerationMps2' in payload.selectedDesign.fittedDrivePerformance,
      `[${mode}] the fitted baseline the column is compared against must be reported too`);
  }
});

test('combat acceleration is cruise times this drive\'s own thrust cap, so the two are not near-substitutes', () => {
  const payload = allRows(live('player'), { detail: 'full' });
  const computable = payload.items.filter(row => row.measured.computable
    && row.measured.cruiseAccelerationMps2 !== null
    && row.measured.combatAccelerationMps2 !== null
    && row.measured.thrustCap !== null);
  assert.ok(computable.length > 100, 'the fixture must carry a real catalogue');

  let equalCount = 0;
  for (const row of computable) {
    const ratio = row.measured.combatAccelerationMps2 / row.measured.cruiseAccelerationMps2;
    assert.ok(Math.abs(ratio - row.measured.thrustCap) <= 1e-3 * Math.max(1, row.measured.thrustCap),
      `${row.driveId}: combat / cruise must be this drive's thrustCap (${ratio} vs ${row.measured.thrustCap})`);
    if (row.measured.thrustCap === 1) equalCount += 1;
  }
  // Both directions: some drives really do have the two equal, and most do not.
  // If they were near-substitutes the column would not be worth its width.
  assert.ok(equalCount > 0, 'some drives must have cruise equal to combat');
  assert.ok(equalCount < computable.length / 2,
    'and most must not, or the second column would be a restatement of the first');
});

test('sorting by cruise acceleration orders by cruise, and unknown never ranks as zero', () => {
  for (const mode of ['player', 'omniscient']) {
    const payload = allRows(live(mode), { mode, sort: 'cruise-acceleration' });
    assert.strictEqual(payload.sorts.applied, 'cruise-acceleration');
    const values = payload.items.map(row => row.measured.cruiseAccelerationMps2);
    const measured = values.filter(value => value !== null);
    for (let i = 1; i < measured.length; i += 1) {
      assert.ok(measured[i - 1] >= measured[i],
        `[${mode}] the cruise sort must be descending (${measured[i - 1]} then ${measured[i]})`);
    }
    const firstNull = values.indexOf(null);
    if (firstNull !== -1) {
      assert.ok(values.slice(firstNull).every(value => value === null),
        `[${mode}] an unmeasured cruise acceleration must sort last, never as zero`);
    }
    // The ordering is genuinely different from the combat one, or the sort key
    // would be redundant with a column already on screen.
    const byCombat = allRows(live(mode), { mode, sort: 'combat-acceleration' });
    assert.notDeepStrictEqual(
      payload.items.map(row => row.driveId),
      byCombat.items.map(row => row.driveId),
      `[${mode}] the cruise ordering must not be the combat ordering`
    );
  }
});

// ---------------------------------------------------------------------------
// 5c. MINIMUM THRESHOLDS -- AND AN UNTESTABLE ROW IS NOT A FAILED ONE
// ---------------------------------------------------------------------------

const thresholded = (snapshot, thresholds, options = {}) =>
  allRows(snapshot, { thresholds, ...options });

test('the minimum filters return only rows meeting every one of them, in both modes', () => {
  for (const mode of ['player', 'omniscient']) {
    const snapshot = live(mode);
    const unfiltered = allRows(snapshot, { mode });
    const payload = thresholded(snapshot, { minDeltaV: '10', minCombatAcceleration: '20' }, { mode });

    assert.deepStrictEqual(payload.thresholds.applied, {
      minDeltaV: 10,
      minCombatAcceleration: 20,
      minCruiseAcceleration: null
    }, `[${mode}] the applied minimums must be echoed as parsed numbers`);
    assert.deepStrictEqual(payload.thresholds.rejected, [], `[${mode}] nothing well-formed may be rejected`);

    assert.ok(payload.items.length > 0, `[${mode}] the fixture must leave something to look at`);
    assert.ok(payload.items.length < unfiltered.items.length, `[${mode}] and the filter must actually remove rows`);
    for (const row of payload.items) {
      assert.ok(row.measured.deltaVKps >= 10, `[${mode}] ${row.driveId} is below the delta-V minimum`);
      assert.ok(row.measured.combatAccelerationMps2 >= 20,
        `[${mode}] ${row.driveId} is below the combat-acceleration minimum`);
    }

    // Every drive the filter removed is accounted for as exactly one of the
    // three exclusion reasons.
    const exclusions = payload.filters.thresholdExclusions;
    assert.strictEqual(
      payload.filters.matched
      + payload.filters.excludedByStatusOrFamilyCount
      + exclusions.belowThresholdCount
      + exclusions.untestableCount,
      payload.driveCatalogue.rated,
      `[${mode}] the four filter outcomes must partition the rated catalogue`
    );
    assert.strictEqual(payload.filters.reconciles, true,
      `[${mode}] the endpoint must report its own filter reconciliation`);
    assert.strictEqual(payload.filters.matched + payload.filters.filteredOutCount, payload.driveCatalogue.rated);
  }
});

test('a minimum on cruise acceleration selects a different set than the same minimum on combat', () => {
  const snapshot = live('player');
  const byCruise = thresholded(snapshot, { minCruiseAcceleration: '1' });
  const byCombat = thresholded(snapshot, { minCombatAcceleration: '1' });
  assert.ok(byCruise.items.length > 0 && byCombat.items.length > 0, 'both minimums must match something');
  assert.ok(byCruise.items.length < byCombat.items.length,
    'cruise is combat divided by thrustCap, so the same minimum on cruise is strictly the harder test');
  for (const row of byCruise.items) {
    assert.ok(row.measured.cruiseAccelerationMps2 >= 1, `${row.driveId} is below the cruise minimum`);
  }
});

test('a row with no measured value for a filtered field is excluded as UNTESTABLE, not counted as a failure', () => {
  // Proven twice: on a synthetic row, and on the live save's own unflown design,
  // which has no measured baseline for anything.
  const snapshot = live('player');
  const base = allRows(snapshot);
  const fittedId = base.selectedDesign.fittedDrive.driveId;

  // (a) synthetic: one drive stripped of its cruise measurement, everything else
  //     left measurable and comfortably above the minimum.
  const strippedId = base.items.find(row =>
    row.driveId !== fittedId && row.measured.cruiseAccelerationMps2 >= 1).driveId;
  const synthetic = {
    ...snapshot,
    driveStats: {
      ...snapshot.driveStats,
      [strippedId]: { ...snapshot.driveStats[strippedId], thrust_N: null, thrustRating_GW: null }
    }
  };
  const syntheticPayload = thresholded(synthetic, { minCruiseAcceleration: '1' });
  const exclusions = syntheticPayload.filters.thresholdExclusions;
  assert.ok(exclusions.untestableCount >= 1,
    'a drive with no measurable cruise acceleration must be counted as untestable');
  assert.ok(exclusions.untestableDrives.some(entry => entry.driveId === strippedId),
    'and named, with the measurement that was missing');
  const named = exclusions.untestableDrives.find(entry => entry.driveId === strippedId);
  assert.deepStrictEqual(named.unmeasuredFields, ['cruiseAccelerationMps2']);
  assert.ok(named.reason.length > 0, 'an untestable row must carry the reason it could not be tested');
  assert.ok(!syntheticPayload.items.some(row => row.driveId === strippedId),
    'and it must not be shown as though it had passed either');

  // (b) the live save: a design nobody flies has no measured mass, so EVERY row
  //     is untestable and NONE of them is a failure. `Number(null) === 0` would
  //     report all 541 as below the threshold instead.
  const unflown = base.designs.find(design => design.shipsInService === 0);
  assert.ok(unflown, 'the observer must own a design with no hull in service');
  const unmeasurable = thresholded(snapshot, { minDeltaV: '10' }, { designId: unflown.designId });
  const unmeasured = unmeasurable.filters.thresholdExclusions;
  assert.strictEqual(unmeasurable.items.length, 0, 'nothing can match a minimum nothing can be tested against');
  assert.strictEqual(unmeasured.belowThresholdCount, 0,
    'not one row may be reported as having failed a test that could not be run');
  assert.strictEqual(unmeasured.untestableCount, unmeasurable.driveCatalogue.rated,
    'every rated drive must be counted as untestable instead');
  // The list of them truncates and says so.
  assert.strictEqual(
    unmeasured.untestableDrives.length + unmeasured.untestableOmittedCount,
    unmeasured.untestableTotalCount,
    'the named-untestable list must reconcile with its own total'
  );
  assert.ok(unmeasured.untestableOmittedCount > 0, 'the fixture must actually truncate that list');
});

test('a malformed or negative minimum is rejected and echoed, never coerced', () => {
  const snapshot = live('player');
  const unfiltered = allRows(snapshot);

  for (const value of ['abc', '-5', '1e400', 'NaN', 'Infinity', '10px', '', ' ']) {
    const payload = thresholded(snapshot, { minDeltaV: value });
    assert.strictEqual(payload.thresholds.applied.minDeltaV, null,
      `minDeltaV='${value}' must not become a filter`);
    assert.strictEqual(payload.items.length, unfiltered.items.length,
      `minDeltaV='${value}' must leave the result set untouched, not silently filter on 0 or NaN`);
    assert.strictEqual(payload.filters.thresholdExclusions.belowThresholdCount, 0);
    assert.strictEqual(payload.filters.thresholdExclusions.untestableCount, 0);

    const isBlank = value.trim() === '';
    if (isBlank) {
      assert.deepStrictEqual(payload.thresholds.rejected, [],
        'an empty value is absent, not malformed');
    } else {
      assert.strictEqual(payload.thresholds.rejected.length, 1,
        `minDeltaV='${value}' must be echoed as rejected rather than ignored silently`);
      assert.strictEqual(payload.thresholds.rejected[0].parameter, 'minDeltaV');
      assert.strictEqual(payload.thresholds.rejected[0].value, value.trim());
      assert.ok(payload.thresholds.rejected[0].reason.length > 0);
    }
  }

  // A zero minimum is a real filter, not an absent one: nothing measured fails
  // it, but nothing UNMEASURED can be shown to pass it either.
  const zero = thresholded(snapshot, { minDeltaV: '0' });
  assert.strictEqual(zero.thresholds.applied.minDeltaV, 0);
  assert.deepStrictEqual(zero.thresholds.active, ['minDeltaV']);
});

test('the units each minimum is in travel on the response', () => {
  const payload = allRows(live('player'));
  assert.strictEqual(payload.thresholds.fields.minDeltaV.unit, 'km/s');
  assert.strictEqual(payload.thresholds.fields.minDeltaV.measure, 'deltaVKps');
  assert.strictEqual(payload.thresholds.fields.minCombatAcceleration.unit, 'm/s2');
  assert.strictEqual(payload.thresholds.fields.minCruiseAcceleration.measure, 'cruiseAccelerationMps2');
  assert.match(payload.thresholds.semantics, /could not be tested/,
    'the response must state what happens to an unmeasured row, not leave it to be guessed');
});

test('the local route parses the minimums off the query string, in both modes', async () => {
  // The projection is proven above; this is the OTHER half -- that the Express
  // route actually reads `?minDeltaV=` and hands it through. A filter parsed
  // nowhere is a filter no agent can use, and no unit test of the projection
  // would notice.
  const app = require('../server');
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const mode of ['player', 'omniscient']) {
      const query = `observer=${OBSERVER}&mode=${mode}&limit=1000`;
      const [plain, filteredResponse, rejectedResponse] = await Promise.all([
        fetch(`${base}/api/intel/drive-explorer?${query}`).then(response => response.json()),
        fetch(`${base}/api/intel/drive-explorer?${query}&minDeltaV=10&minCombatAcceleration=20`).then(response => response.json()),
        fetch(`${base}/api/intel/drive-explorer?${query}&minDeltaV=abc`).then(response => response.json())
      ]);

      assert.strictEqual(filteredResponse.success, true, `[${mode}] the filtered request must succeed`);
      assert.strictEqual(filteredResponse.thresholds.applied.minDeltaV, 10,
        `[${mode}] the route must hand ?minDeltaV= through to the projection`);
      assert.strictEqual(filteredResponse.thresholds.applied.minCombatAcceleration, 20);
      assert.ok(filteredResponse.items.length > 0 && filteredResponse.items.length < plain.items.length,
        `[${mode}] and it must actually narrow the answer`);
      for (const row of filteredResponse.items) {
        assert.ok(row.measured.deltaVKps >= 10 && row.measured.combatAccelerationMps2 >= 20,
          `[${mode}] ${row.driveId} does not meet the minimums the route was given`);
      }
      // Echoed on the query block for this resource, so a caller can see what
      // the server thought it was asked.
      assert.strictEqual(filteredResponse.query.minDeltaV, '10');
      assert.strictEqual(filteredResponse.query.minCruiseAcceleration, null);

      // A malformed minimum answers 200 with the rejection echoed -- the same
      // treatment an unrecognised ?sort= gets -- and does NOT filter.
      assert.strictEqual(rejectedResponse.success, true);
      assert.strictEqual(rejectedResponse.thresholds.applied.minDeltaV, null);
      assert.strictEqual(rejectedResponse.thresholds.rejected[0].parameter, 'minDeltaV');
      assert.strictEqual(rejectedResponse.items.length, plain.items.length,
        `[${mode}] a rejected minimum must not silently filter on 0`);
    }

    // The echo appears only on the resource that honours the parameters.
    const fleets = await fetch(`${base}/api/intel/fleets?observer=${OBSERVER}&minDeltaV=10`).then(r => r.json());
    assert.ok(!('minDeltaV' in fleets.query),
      'an endpoint that ignores the minimums must not echo them as though it applied them');
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('the threshold filters compose with the categorical ones rather than replacing them', () => {
  const snapshot = live('player');
  const payload = thresholded(snapshot, { minDeltaV: '10' }, { status: DRIVE_AVAILABILITY.fittable });
  assert.ok(payload.filters.excludedByStatusOrFamilyCount > 0, 'the status filter must still remove rows');
  assert.ok(payload.filters.thresholdExclusions.belowThresholdCount > 0, 'and the minimum must remove more');
  for (const row of payload.items) {
    assert.strictEqual(row.availability.bucket, DRIVE_AVAILABILITY.fittable);
    assert.ok(row.measured.deltaVKps >= 10);
  }
  assert.strictEqual(payload.filters.reconciles, true);
});

// ---------------------------------------------------------------------------
// 6. THE TWO REGISTERS -- MEASURED VS ESTIMATE
// ---------------------------------------------------------------------------

test('the measured half and the estimated half are labelled as such on every row', () => {
  for (const mode of ['player', 'omniscient']) {
    const payload = allRows(live(mode), { mode });
    assert.strictEqual(payload.basisLegend[MEASUREMENT_BASIS.measured] !== undefined, true);
    assert.match(payload.basisLegend[MEASUREMENT_BASIS.estimate], /estimate/i);
    assert.match(payload.basisLegend[MEASUREMENT_BASIS.estimate], /not a measurement/i);

    assert.strictEqual(payload.destinationModel.isEstimate, true,
      `[${mode}] the destination model must declare itself an estimate`);
    assert.strictEqual(payload.destinationModel.basis, MEASUREMENT_BASIS.estimate);
    assert.match(payload.destinationModel.note, /not an unreachable one/,
      `[${mode}] the model must state that an absent body is not an unreachable one`);
    assert.match(payload.destinationModel.note, /HEURISTIC ESTIMATE/,
      `[${mode}] the model must state that it is a heuristic`);

    for (const row of payload.items.slice(0, 40)) {
      assert.strictEqual(row.measured.basis, MEASUREMENT_BASIS.measured);
      assert.strictEqual(row.estimatedDestinations.basis, MEASUREMENT_BASIS.estimate);
      assert.strictEqual(row.estimatedDestinations.isEstimate, true);
    }
  }
});

test('only the nine modelled destinations are reported, and travel time is not re-derived per drive', () => {
  const payload = allRows(live('player'));
  const model = payload.destinationModel;
  assert.ok(model.available, 'the live save must resolve a destination table');
  assert.strictEqual(model.destinationsModelled, model.destinations.length);
  assert.strictEqual(model.destinationsModelled, 9,
    'the mobility table filters the fleet\'s own body, leaving nine modelled destinations');
  assert.match(model.travelDaysBasis, /AS CURRENTLY FITTED/,
    'travel days must state that they are the fitted fleet\'s, not the candidate drive\'s');

  for (const row of payload.items) {
    assert.ok(!('travelDays' in row.estimatedDestinations),
      'no per-drive travel time may be invented for a candidate drive');
    if (row.estimatedDestinations.evaluated) {
      assert.ok(row.estimatedDestinations.reachableCount <= model.destinationsModelled);
      assert.strictEqual(
        row.estimatedDestinations.reachableCount + row.estimatedDestinations.blockedCount
          + row.estimatedDestinations.unknownCount,
        model.destinationsModelled,
        'reachable + blocked + unknown must account for every modelled destination'
      );
    }
  }
});

test('reachability follows the delta-V it is computed from, in both directions', () => {
  const payload = allRows(live('player'));
  const required = payload.destinationModel.destinations
    .map(entry => entry.deltaVRequired)
    .sort((a, b) => a - b);

  for (const row of payload.items.filter(r => r.estimatedDestinations.evaluated)) {
    const dv = row.measured.deltaVKps;
    const expected = required.filter(value => dv >= value).length;
    assert.strictEqual(row.estimatedDestinations.reachableCount, expected,
      `${row.driveId}: reachability must be exactly the destinations its delta-V clears`);
  }
});

// ---------------------------------------------------------------------------
// 7. ABSENT STAYS NULL
// ---------------------------------------------------------------------------

test('an uncomputable delta-V is unknown with a reason, never zero', () => {
  const snapshot = live('player');
  // A design the observer owns but flies no hull of has no measured mass.
  const unflown = allRows(snapshot).designs.find(design => design.shipsInService === 0);
  assert.ok(unflown, 'the observer must own at least one design with no hull in service');

  const payload = allRows(snapshot, { designId: unflown.designId });
  assert.strictEqual(payload.selectedDesign.baselineMeasured, false);
  assert.ok(payload.selectedDesign.baselineUnmeasuredReason.length > 0);

  for (const row of payload.items) {
    assert.strictEqual(row.measured.computable, false);
    assert.strictEqual(row.measured.deltaVKps, null, 'an unmeasurable refit reports null, never 0');
    assert.strictEqual(row.measured.combatAccelerationMps2, null);
    assert.ok(row.measured.reason.length > 0, 'and it carries the reason it could not be computed');
    // The row still renders: reactor fit and research state are still real.
    assert.ok(row.reactor.verdict);
    assert.ok(row.availability.bucket);
    // Reachability is not evaluated rather than reported as zero destinations.
    assert.strictEqual(row.estimatedDestinations.evaluated, false);
    assert.strictEqual(row.estimatedDestinations.reachableCount, null);
  }
});

test('a multiple against the fitted drive is null when either side is unmeasured, never 1.0', () => {
  const snapshot = live('player');
  const unflown = allRows(snapshot).designs.find(design => design.shipsInService === 0);
  const payload = allRows(snapshot, { designId: unflown.designId });
  for (const row of payload.items.slice(0, 40)) {
    assert.strictEqual(row.measured.deltaVMultipleVsFitted, null,
      'an unmeasurable comparison must be null, not a defaulted parity');
    assert.strictEqual(row.measured.combatAccelerationMultipleVsFitted, null);
  }
});

// ---------------------------------------------------------------------------
// 8. BOTH MODES, AND A FACTION THAT FLIES NOTHING
// ---------------------------------------------------------------------------

test('player mode is a full answer, not a degraded one, for the observer\'s own designs', () => {
  const player = allRows(live('player'), { mode: 'player' });
  const omni = allRows(live('omniscient'), { mode: 'omniscient' });

  assert.strictEqual(player.designCount, omni.designCount,
    'the observer\'s own designs are visible in both modes');
  assert.strictEqual(player.selectedDesign.designId, omni.selectedDesign.designId);
  assert.deepStrictEqual(player.availabilityCensus, omni.availabilityCensus);
  assert.deepStrictEqual(player.reactorCompatibilityCensus, omni.reactorCompatibilityCensus);
  assert.strictEqual(player.items.length, omni.items.length);
  assert.strictEqual(player.items[0].measured.deltaVKps, omni.items[0].measured.deltaVKps);
});

test('a turn-1 observer that flies nothing gets an honest empty answer, not a fabricated one', () => {
  const snapshot = filtered(makeSaveData({ ships: 0 }), 'player');
  snapshot.fleets = [];
  snapshot.shipDesigns = [];

  const payload = allRows(snapshot);
  assert.strictEqual(payload.designCount, 0);
  assert.strictEqual(payload.selectedDesign, null);
  assert.strictEqual(payload.count, 0);
  assert.match(payload.reason, /no ship designs/,
    'the empty answer must say why it is empty rather than rendering as a failure');
  // The catalogue itself is still real: this is an absence of hulls, not of drives.
  assert.ok(payload.driveCatalogue.total > 0);
});

test('a snapshot with no drive catalogue says so rather than reporting an empty catalogue', () => {
  const snapshot = { ...live('player'), driveStats: {} };
  const payload = allRows(snapshot);
  assert.strictEqual(payload.driveCatalogue.available, false);
  assert.match(payload.driveCatalogue.reason, /re-publish/);
  assert.strictEqual(payload.count, 0);
});

// ---------------------------------------------------------------------------
// 9. SORTING AND FILTERING
// ---------------------------------------------------------------------------

test('sorting orders by the requested axis and never ranks an unknown as a zero', () => {
  const snapshot = live('player');
  for (const sort of DRIVE_SORTS) {
    const payload = allRows(snapshot, { sort });
    assert.strictEqual(payload.sorts.applied, sort);
    assert.strictEqual(payload.sorts.rejected, null);
  }

  const byDeltaV = allRows(snapshot, { sort: 'delta-v' }).items.filter(row => !row.isFittedDrive);
  const values = byDeltaV.map(row => row.measured.deltaVKps);
  const firstNull = values.indexOf(null);
  if (firstNull !== -1) {
    assert.ok(values.slice(firstNull).every(value => value === null),
      'uncomputable rows must all sort after the computable ones');
  }
  const measuredValues = values.filter(value => value !== null);
  assert.ok(measuredValues.every((value, i) => i === 0 || measuredValues[i - 1] >= value),
    'delta-V must be ordered descending');
});

test('an unrecognised sort key is reported rather than silently honoured', () => {
  const payload = allRows(live('player'), { sort: 'by-vibes' });
  assert.strictEqual(payload.sorts.applied, 'delta-v');
  assert.strictEqual(payload.sorts.rejected, 'by-vibes');
});

test('filters narrow the set and report what they removed', () => {
  const snapshot = live('player');
  const all = allRows(snapshot);
  const fittable = allRows(snapshot, { status: DRIVE_AVAILABILITY.fittable });

  assert.ok(fittable.itemsTotalCount < all.itemsTotalCount, 'the filter must actually narrow the set');
  assert.strictEqual(fittable.filters.status, DRIVE_AVAILABILITY.fittable);
  assert.strictEqual(
    fittable.itemsTotalCount + fittable.filters.filteredOutCount,
    all.driveCatalogue.rated
  );
  for (const row of fittable.items) {
    assert.strictEqual(row.availability.bucket, DRIVE_AVAILABILITY.fittable);
  }

  const family = all.items[0].classification;
  const byFamily = allRows(snapshot, { family });
  assert.ok(byFamily.itemsTotalCount > 0);
  for (const row of byFamily.items) {
    assert.strictEqual(String(row.classification).toLowerCase(), String(family).toLowerCase());
  }
});

test('detail=full adds explanation and detail=summary stays scannable', () => {
  const snapshot = live('player');
  const summary = project(snapshot, { limit: 5 });
  const full = project(snapshot, { limit: 5, detail: 'full' });

  const summaryRow = summary.items.find(row => row.availability.bucket === DRIVE_AVAILABILITY.researchable);
  const fullRow = full.items.find(row => row.driveId === summaryRow.driveId);
  assert.ok(fullRow, 'the same drive must be present at both detail levels');

  assert.strictEqual(summaryRow.availability.reason, undefined,
    'the compact row omits prose rather than emitting it empty');
  assert.ok(typeof fullRow.availability.reason === 'string' && fullRow.availability.reason.length > 0);
  assert.ok(Array.isArray(fullRow.availability.missingPrerequisites));
  assert.ok(fullRow.reactor.reason.length > 0);
  assert.ok(Array.isArray(fullRow.estimatedDestinations.reachable));

  // The figures themselves are identical: detail changes the shape, not the answer.
  assert.strictEqual(summaryRow.measured.deltaVKps, fullRow.measured.deltaVKps);
  assert.strictEqual(summaryRow.measured.combatAccelerationMps2, fullRow.measured.combatAccelerationMps2);
});

// ---------------------------------------------------------------------------
// 10. THE MARKDOWN EXPORT REACHES THE AI SURFACES
// ---------------------------------------------------------------------------

test('the war room carries the drive explorer, in both registers', async () => {
  const { renderWarRoomMarkdown, utf8ByteLength, WAR_ROOM_BYTE_BUDGET } =
    await import('../shared/markdownExports.mjs');

  for (const mode of ['player', 'omniscient']) {
    const markdown = renderWarRoomMarkdown(live(mode));
    assert.match(markdown, /## 9\. Drive Explorer/, `[${mode}] the section must render`);
    assert.match(markdown, /Fitted drive \(MEASURED\)/, `[${mode}] the measured half must be labelled`);
    assert.match(markdown, /ESTIMATE, not a measurement/, `[${mode}] the estimated half must be labelled`);
    assert.match(markdown, /absent from that list is not an unreachable one/,
      `[${mode}] the export must state that an absent body is not unreachable`);
    assert.match(markdown, /fittable today, .* researchable, .* never researchable, .* unresolved/,
      `[${mode}] the four availability states must be reported`);
    assert.match(markdown, /need a different reactor class and are shown marked rather than hidden/,
      `[${mode}] the reactor gate must be reported`);
    assert.match(markdown, /\/api\/intel\/drive-explorer/, `[${mode}] the export must name the full endpoint`);
    assert.ok(utf8ByteLength(markdown) < WAR_ROOM_BYTE_BUDGET,
      `[${mode}] the war room must stay inside its byte budget with the new section`);
  }
});

test('the war room degrades honestly when the snapshot carries no drive catalogue', async () => {
  const { renderWarRoomMarkdown } = await import('../shared/markdownExports.mjs');
  const markdown = renderWarRoomMarkdown({ ...live('player'), driveStats: {} });
  assert.match(markdown, /## 9\. Drive Explorer/, 'the heading survives so the absence is visible');
  assert.match(markdown, /Drive Explorer unavailable/, 'and the body says the data is missing');
  assert.ok(!/Fitted drive \(MEASURED\)/.test(markdown), 'no fabricated figures may be rendered');
});

test('the war room never reports an unreadable destination table as zero destinations', async () => {
  const { renderWarRoomMarkdown } = await import('../shared/markdownExports.mjs');
  // Strip the observer's fleets: the designs survive, so the catalogue still
  // rates, but no fleet remains to read a destination table from.
  const snapshot = { ...live('player'), fleets: [] };
  const markdown = renderWarRoomMarkdown(snapshot);
  assert.match(markdown, /## 9\. Drive Explorer/);
  assert.ok(!/Only 0 destination\(s\) are modelled/.test(markdown),
    'an unreadable table must not render as a confident zero');
  assert.match(markdown, /NOT EVALUATED \(which is not the same as none being reachable\)/,
    'the absence must be stated as an absence of measurement');
  assert.match(markdown, /not an unreachable one/,
    'the absent-body caveat survives even when the table cannot be read');
});

// ---------------------------------------------------------------------------
// 11. THE PANEL
// ---------------------------------------------------------------------------

function loadPanel() {
  const code = fs.readFileSync(path.join(__dirname, '..', 'public', 'v2', 'js', 'components', 'drive-explorer.js'), 'utf8');
  const sandbox = {
    console,
    // The SHIPPED bundle, not a hand-copy of its escaper. The copy that used to
    // sit here was faithful, so nothing was wrong with it -- but it was a second
    // thing to keep in step with `public/v2/js/shared.js`, and the harness
    // executes that file rather than reproducing it.
    MissionControlShared: MISSION_CONTROL_SHARED,
    fetch: () => Promise.reject(new Error('no network in this test'))
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'drive-explorer.js' });
  return sandbox.window.MissionControlDriveExplorer;
}

test('the panel renders both registers, the estimate caption, and no null placeholders', () => {
  const panel = loadPanel();
  const payload = allRows(live('player'));
  const container = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };

  panel.render(container, payload);
  const html = container.innerHTML;

  assert.match(html, /de-measured__value/, 'measured figures must carry the measured register class');
  assert.match(html, /de-estimate__value/, 'estimate figures must carry the estimate register class');
  assert.match(html, /de-tag--measured/, 'the MEASURED tag must render');
  assert.match(html, /de-tag--estimate/, 'the ESTIMATE tag must render');
  assert.ok(html.includes(panel._internals.ESTIMATE_CAPTION),
    'the destinations column must carry its estimate caption');
  assert.match(html, /not a measurement/, 'the legend must say the estimate is not a measurement');
  assert.match(html, /is not an unreachable one/, 'the legend must carry the absent-body caveat');
  assert.match(html, /NEEDS /, 'reactor-incompatible drives must name the class they need');
  assert.match(html, /RESEARCHABLE/, 'locked drives must be labelled');
  assert.match(html, /in catalogue/, 'the reconciliation line must render');

  // Nothing renders the literal words a null coercion would leave behind.
  const stripped = html.replace(/<[^>]*>/g, ' ');
  assert.ok(!/\bnull\b/.test(stripped), 'no null may reach the rendered text');
  assert.ok(!/\bundefined\b/.test(stripped), 'no undefined may reach the rendered text');
  assert.ok(!/\bNaN\b/.test(stripped), 'no NaN may reach the rendered text');
});

test('the panel renders the cruise column it already offered a sort for', () => {
  const panel = loadPanel();
  const payload = allRows(live('player'));
  const container = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };

  panel.render(container, payload);
  const html = container.innerHTML;

  assert.match(html, /CRUISE ACCEL m\/s²/, 'the cruise column must have a header');
  assert.match(html, /COMBAT ACCEL m\/s²/, 'beside the combat one, not instead of it');
  // In the MEASURED register, exactly like its two neighbours: three measured
  // header cells and three measured value cells on every row.
  const measuredHeaders = (html.match(/de-th--measured/g) || []).length;
  assert.strictEqual(measuredHeaders, 3, 'delta-V, combat and cruise are all measured columns');
  const firstRow = html.match(/<tr class="de-row[\s\S]*?<\/tr>/)[0];
  const cells = [...firstRow.matchAll(/de-measured__value">([^<]*)</g)].map(match => match[1]);
  assert.strictEqual(cells.length, 3, 'every row must carry three measured figures');

  // The three columns are in the order the header declares them.
  const headerOrder = [...html.matchAll(/<th class="de-th[^"]*"[^>]*>([^<]*)</g)].map(match => match[1].trim());
  assert.deepStrictEqual(headerOrder.slice(0, 4),
    ['DRIVE', 'ΔV km/s', 'COMBAT ACCEL m/s²', 'CRUISE ACCEL m/s²']);

  // The smallest measured accelerations must survive the trip to the screen as
  // numbers. `toFixed(3)` renders them as `0.000`, which is indistinguishable
  // from a measured zero -- the exact defect the rest of this panel avoids.
  const smallest = payload.items
    .filter(row => row.measured.cruiseAccelerationMps2 !== null && row.measured.cruiseAccelerationMps2 < 0.001)
    .slice(0, 5);
  assert.ok(smallest.length > 0, 'the live catalogue must carry accelerations below 0.001 for this to test anything');
  const bySmallest = { ...payload, items: smallest };
  panel.render(container, bySmallest);
  const smallRows = [...container.innerHTML.matchAll(/<tr class="de-row[\s\S]*?<\/tr>/g)].map(match => match[0]);
  for (const rendered of smallRows) {
    const cells = [...rendered.matchAll(/de-measured__value">([^<]*)</g)].map(match => match[1]);
    for (const index of [1, 2]) {
      assert.notStrictEqual(cells[index], '0.000',
        'a measured acceleration below 0.001 must not render as a confident 0.000');
      assert.ok(Number(cells[index]) > 0,
        `a measured acceleration must render as a positive number, got '${cells[index]}'`);
    }
  }
});

test('a small acceleration renders as a small number, never as a confident 0.000', () => {
  const { accel } = loadPanel()._internals;
  // The live catalogue's smallest measured acceleration. `toFixed(3)` printed
  // this as `0.000`, which a reader cannot tell from a measured zero.
  assert.strictEqual(accel(0.00016846), '0.000168');
  assert.strictEqual(accel(0.01010778), '0.0101');
  assert.strictEqual(accel(20.59560406), '20.6');
  assert.strictEqual(accel(606.46655067), '606');
  // A measured zero is still a zero; an ABSENT value is the em dash.
  assert.strictEqual(accel(0), '0');
  assert.strictEqual(accel(null), '—');
  assert.strictEqual(accel(undefined), '—');
  assert.strictEqual(accel(''), '—');
  assert.strictEqual(accel('not a number'), '—');
});

test('a null cruise acceleration renders as unavailable and sorts last, never as zero', () => {
  const panel = loadPanel();
  const live_ = allRows(live('player'));
  const container = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };

  // A synthetic row: computable overall, with only the cruise measurement absent.
  // shared/propulsion.mjs and shared/intel/driveExplorer.mjs both have paths that
  // produce exactly this, and the live catalogue currently has none of them.
  const rows = live_.items.slice(0, 6).map(row => JSON.parse(JSON.stringify(row)));
  rows[0] = {
    ...rows[0],
    driveId: 'SyntheticNullCruise',
    displayName: 'Synthetic Null Cruise',
    isFittedDrive: false,
    measured: {
      ...rows[0].measured,
      computable: true,
      cruiseAccelerationMps2: null,
      cruiseAccelerationMultipleVsFitted: null
    }
  };
  const payload = { ...live_, items: rows };

  panel._internals.state.sort = 'cruise-acceleration';
  panel._internals.state.thresholds = { minDeltaV: '', minCombatAcceleration: '', minCruiseAcceleration: '' };
  try {
    panel.render(container, payload);
    const rendered = [...container.innerHTML.matchAll(/<tr class="de-row[\s\S]*?<\/tr>/g)].map(match => match[0]);
    const synthetic = rendered.find(row => /Synthetic Null Cruise/.test(row));
    assert.ok(synthetic, 'the synthetic row must render at all');

    const cells = [...synthetic.matchAll(/de-measured__value">([^<]*)</g)].map(match => match[1]);
    assert.strictEqual(cells[2], '—', 'an unmeasured cruise acceleration renders as an em dash, never as 0');
    assert.match(synthetic, /UNAVAILABLE/, 'and says so in the sub-line rather than showing a multiple');

    assert.strictEqual(rendered.indexOf(synthetic), rendered.length - 1,
      'and it sorts last under the cruise sort rather than as though it were zero');

    // Filtered on, it is untestable rather than a failure.
    panel._internals.state.thresholds.minCruiseAcceleration = '1';
    const outcome = panel._internals.visibleRows(rows);
    assert.strictEqual(outcome.untestableCount, 1);
    assert.strictEqual(outcome.untestableDrives[0].driveId, 'SyntheticNullCruise');
    assert.ok(!outcome.rows.some(row => row.driveId === 'SyntheticNullCruise'));
  } finally {
    panel._internals.state.sort = 'delta-v';
    panel._internals.state.thresholds = { minDeltaV: '', minCombatAcceleration: '', minCruiseAcceleration: '' };
  }
});

test('the panel and the endpoint reach the same answer for the same minimums', () => {
  // The panel filters client-side because it already holds all 541 rows, so the
  // rule exists twice. This is what stops the two drifting: same thresholds,
  // same rows, same three counts, in both modes.
  const panel = loadPanel();
  const matrix = [
    { minDeltaV: '10' },
    { minCombatAcceleration: '20' },
    { minCruiseAcceleration: '1' },
    { minDeltaV: '10', minCombatAcceleration: '20' },
    { minDeltaV: '10', minCombatAcceleration: '20', minCruiseAcceleration: '0.5' },
    { minDeltaV: '0' },
    { minDeltaV: '1e-4' },
    { minDeltaV: '999999' },
    { minDeltaV: 'abc' },
    { minDeltaV: '-5' }
  ];

  for (const mode of ['player', 'omniscient']) {
    const snapshot = live(mode);
    // Three populations, because the live catalogue on its own has no null
    // measurement and would leave the untestable branch of both implementations
    // unexercised -- a `Number(null)` reintroduced on either side would pass.
    //
    //   flown       every row measured
    //   unflown     no row measured at all (a design with no hull in service)
    //   partial     one row stripped of its thrust, so only IT is unmeasured
    const base = allRows(snapshot, { mode });
    const unflownId = base.designs.find(design => design.shipsInService === 0).designId;
    const strippedId = base.items.find(row =>
      !row.isFittedDrive && row.measured.cruiseAccelerationMps2 >= 1).driveId;
    const partialSnapshot = {
      ...snapshot,
      driveStats: {
        ...snapshot.driveStats,
        [strippedId]: { ...snapshot.driveStats[strippedId], thrust_N: null, thrustRating_GW: null }
      }
    };
    const scenarios = [
      { label: 'flown', snapshot, options: {} },
      { label: 'unflown', snapshot, options: { designId: unflownId } },
      { label: 'partial', snapshot: partialSnapshot, options: {} }
    ];

    for (const scenario of scenarios) {
      const unfiltered = allRows(scenario.snapshot, { mode, ...scenario.options });
      for (const thresholds of matrix) {
      const endpoint = allRows(scenario.snapshot, { mode, ...scenario.options, thresholds });
      panel._internals.state.thresholds = {
        minDeltaV: thresholds.minDeltaV ?? '',
        minCombatAcceleration: thresholds.minCombatAcceleration ?? '',
        minCruiseAcceleration: thresholds.minCruiseAcceleration ?? ''
      };
      const browser = panel._internals.visibleRows(unfiltered.items);
      const label = `[${mode}/${scenario.label}] ${JSON.stringify(thresholds)}`;

      // `Array.from` and not `.map`: the panel runs in a vm realm, so an array
      // it builds carries THAT realm's Array.prototype and `deepStrictEqual`
      // compares prototypes. Without this the assertion fails on two arrays
      // whose contents are identical, which is a very confusing way to be red.
      assert.deepStrictEqual(
        Array.from(browser.rows, row => row.driveId).sort(),
        endpoint.items.map(row => row.driveId).sort(),
        `${label}: the panel and the endpoint must admit the same drives`
      );
      assert.strictEqual(browser.belowThresholdCount,
        endpoint.filters.thresholdExclusions.belowThresholdCount,
        `${label}: the below-threshold counts must agree`);
      assert.strictEqual(browser.untestableCount,
        endpoint.filters.thresholdExclusions.untestableCount,
        `${label}: the untestable counts must agree`);
      assert.deepStrictEqual(
        Array.from(browser.thresholds.rejected, entry => entry.key),
        endpoint.thresholds.rejected.map(entry => entry.parameter),
        `${label}: the two must reject exactly the same inputs`
      );
      }
    }

    // The matrix is only worth running if the untestable branch is genuinely
    // reached on both sides. Asserted rather than assumed, because a live save
    // with no null measurement would leave `Number(null) === 0` undetected.
    panel._internals.state.thresholds = { minDeltaV: '10', minCombatAcceleration: '', minCruiseAcceleration: '' };
    const unflownRows = allRows(snapshot, { mode, designId: unflownId }).items;
    assert.ok(panel._internals.visibleRows(unflownRows).untestableCount > 0,
      `[${mode}] the unflown scenario must actually exercise the untestable branch`);
    panel._internals.state.thresholds = { minDeltaV: '', minCombatAcceleration: '', minCruiseAcceleration: '1' };
    const partialRows = allRows(partialSnapshot, { mode }).items;
    const partialOutcome = panel._internals.visibleRows(partialRows);
    assert.strictEqual(partialOutcome.untestableCount, 1,
      `[${mode}] the partial scenario must leave exactly the stripped drive untestable`);
    assert.ok(partialOutcome.belowThresholdCount > 0,
      `[${mode}] and must still have genuine failures beside it, or the two are not distinguished`);
  }
  panel._internals.state.thresholds = { minDeltaV: '', minCombatAcceleration: '', minCruiseAcceleration: '' };
});

test('the panel labels the unit on every minimum control, and says what an untestable row means', () => {
  const panel = loadPanel();
  const payload = allRows(live('player'));
  const container = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };

  panel.render(container, payload);
  const html = container.innerHTML;
  // "> 10" is ambiguous between km/s and m/s², so each control names its unit.
  assert.match(html, /MIN ΔV \(km\/s\)/);
  assert.match(html, /MIN COMBAT ACCEL \(m\/s²\)/);
  assert.match(html, /MIN CRUISE ACCEL \(m\/s²\)/);
  for (const entry of panel._internals.THRESHOLDS) {
    assert.ok(html.includes(`data-de-threshold="${entry.key}"`), `${entry.key} must have a control`);
    assert.ok(html.includes(entry.placeholder), `${entry.key}'s placeholder must state its unit too`);
  }

  panel._internals.state.thresholds = { minDeltaV: '10', minCombatAcceleration: '', minCruiseAcceleration: '' };
  try {
    panel.render(container, payload);
    const filteredHtml = container.innerHTML;
    assert.match(filteredHtml, /MINIMUMS ACTIVE/, 'an active minimum must announce itself');
    assert.match(filteredHtml, /measured and fall short/, 'the failures must be counted on screen');
    assert.match(filteredHtml, /untestable/i, 'and the untestable exclusions named as a separate category');

    panel._internals.state.thresholds.minDeltaV = 'abc';
    panel.render(container, payload);
    assert.match(container.innerHTML, /IGNORED rather than/,
      'a rejected minimum must say it was ignored, not silently behave as no filter');
    const stripped = container.innerHTML.replace(/<[^>]*>/g, ' ');
    assert.ok(!/\bNaN\b/.test(stripped), 'and must not leak a NaN while doing it');
  } finally {
    panel._internals.state.thresholds = { minDeltaV: '', minCombatAcceleration: '', minCruiseAcceleration: '' };
  }
});

test('the panel distinguishes an unavailable destination table from zero destinations', () => {
  const panel = loadPanel();
  const snapshot = live('player');
  const unflown = allRows(snapshot).designs.find(design => design.shipsInService === 0);
  const payload = allRows(snapshot, { designId: unflown.designId });
  const container = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };

  panel.render(container, payload);
  const html = container.innerHTML;
  assert.ok(!/Only 0 destinations are modelled/.test(html),
    'an unreadable destination table must never render as a confident zero');
  assert.match(html, /which is not the same as none being reachable/,
    'the unavailable state must say what it is not');
  assert.match(html, /NOT EVALUATED/, 'per-row reachability must read as unevaluated, not as unreachable');
  assert.match(html, /NO MEASURED BASELINE FOR THIS DESIGN/,
    'the missing measured baseline must be stated rather than filled in');
});

test('the panel says so honestly when there is nothing to render', () => {
  const panel = loadPanel();
  const container = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };

  panel.render(container, null);
  assert.match(container.innerHTML, /UNAVAILABLE/);
  assert.ok(!/de-table/.test(container.innerHTML), 'no fabricated table may be rendered');

  panel.render(container, allRows({ ...live('player'), driveStats: {} }));
  assert.match(container.innerHTML, /UNAVAILABLE/);
  assert.match(container.innerHTML, /re-publish/, 'the reason must reach the reader');
});

// ---------------------------------------------------------------------------
// 12. THE TWO REGISTERS ARE ACTUALLY DIFFERENT RULES
//
// A computed-style check lives in scripts/verify_drive_explorer.js, which reads
// the rendered document. This is the cheap guard that runs in the suite: the
// two rule sets must differ on the properties that carry the distinction.
// ---------------------------------------------------------------------------

test('the measured and estimate CSS registers differ on font, style and colour', () => {
  // Every part the shell links, concatenated in cascade order: the rule has to
  // be reachable by the browser, not merely present in one file of the set.
  const css = require('./fixtures/missionControlCss').readMissionControlCss();
  const ruleFor = (selector) => {
    const match = css.match(new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`));
    assert.ok(match, `${selector} must exist in the v2 stylesheet`);
    return Object.fromEntries(match[1].split(';')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const index = line.indexOf(':');
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
      }));
  };

  const measured = ruleFor('.de-measured__value');
  const estimate = ruleFor('.de-estimate__value');

  for (const property of ['font-family', 'font-style', 'font-weight', 'color']) {
    assert.ok(measured[property], `.de-measured__value must set ${property} rather than inheriting it`);
    assert.ok(estimate[property], `.de-estimate__value must set ${property} rather than inheriting it`);
    assert.notStrictEqual(measured[property], estimate[property],
      `.de-measured__value and .de-estimate__value must differ on ${property}`);
  }

  const estimateCell = ruleFor('.de-cell--estimate');
  assert.match(estimateCell['border-left'], /dashed/,
    'the estimate column must be separated by a dashed rule');
});
