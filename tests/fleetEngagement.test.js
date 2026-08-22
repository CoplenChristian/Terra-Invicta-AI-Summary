// tests/fleetEngagement.test.js
//
// Purpose: pins the per-fleet engagement estimates — composition over a fleet's
//   real hull mix, the reachability gate, the four verdicts, and the labelling
//   that keeps a modelled band from reading as a measurement.
//
// Two things this file exists to defend:
//
//   1. A hull requirement must never fail toward "you are fine". An unrateable
//      fleet, an unreachable one and one past the modelled range each report
//      their own state; none of them reports a small confident number, and
//      `Number(null) === 0` never reaches a band.
//   2. A per-fleet figure must be composed over that fleet's OWN ships. The
//      shipped commentary tiers top out at three ships while 26 of 57 alien
//      fleets are larger, so "N copies of a representative ship" is the
//      specific error being tested against.
//
// Live-save independence: every live-save assertion is a PROPERTY ("the counts
// reconcile", "the largest fleet's rating is not n x any member's"). No fleet,
// body or theatre name is hardcoded -- docs/research-advisor-spec.md section 0
// forbids it, and a campaign-specific test would pass here and fail next save.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const snapshotLoader = require('../server/snapshotLoader');
const { buildResourceProjection, INTEL_ENDPOINT_INDEX, SUPPORTED_RESOURCES } =
  require('../shared/intel/registry.mjs');
const {
  COMPOSITION_BASIS,
  DEFAULT_ENGAGEMENT_ROWS,
  ENGAGEMENT_ORDERED_BY,
  ENGAGEMENT_VERDICTS,
  FLEET_REACHABILITY_STATES,
  MAX_ENGAGEMENT_HULLS,
  buildFleetEngagement
} = require('../shared/fleetEngagement.mjs');
const {
  GUARANTEED_WIN_MARGIN,
  MAX_SIMULATED_HULLS,
  findRequiredHullsForTier,
  guaranteedWinHullCount,
  simulateEngagement
} = require('../shared/engagementModel.mjs');
const { createPrng } = require('../shared/prng.mjs');
const { THREATS_BYTE_BUDGET, renderThreatsMarkdown } = require('../shared/markdownExports.mjs');
const commentarySimulation = require('../server/commentary/simulation');
const commentaryPrng = require('../server/commentary/prng');

const OBSERVER = 4712;
const ALIEN = 4717;

const liveCache = new Map();
function live(mode) {
  if (!liveCache.has(mode)) {
    liveCache.set(mode, snapshotLoader.loadFilteredSnapshot({ latest: true, mode, observer: OBSERVER }));
  }
  return liveCache.get(mode);
}

const engagement = (mode, options = {}) =>
  buildFleetEngagement(live(mode), { observerId: OBSERVER, mode, limit: 500, ...options });

/** The same cap the threats export uses, so its truncation notice is checkable. */
const engagement12 = (mode) =>
  buildFleetEngagement(live(mode), { observerId: OBSERVER, mode, limit: 8 });

// ---------------------------------------------------------------------------
// A synthetic snapshot, so the branches the live save happens not to exercise
// are still pinned. Built as plain snapshot-shaped objects rather than through
// the save parser because the model reads the snapshot, not the save.
// ---------------------------------------------------------------------------

const alienShip = (id, weapons, hullName) => ({
  id,
  displayName: `Hostile ${id}`,
  hullName,
  weaponLoadout: weapons === null ? [] : [{ role: 'Laser', category: 'Laser', count: weapons, systems: ['x'] }],
  armorMedian: 5
});

function syntheticSnapshot({
  observerDeltaV = 50,
  observerShips = 6,
  alienFleets = [],
  alienDesigns = [],
  observerDesignCv = 10000,
  observerBody = 'Mars'
} = {}) {
  return {
    snapshotId: 'synthetic-engagement',
    metadata: { gameTimeString: '1/1/2035 12:00:00 AM' },
    factions: [
      { ID: OBSERVER, displayName: 'the Initiative' },
      { ID: ALIEN, displayName: 'the Aliens' }
    ],
    habs: [{ ID: 900, factionId: OBSERVER, displayName: 'Home', orbitBody: observerBody }],
    shipDesigns: [
      ...(observerDesignCv === null ? [] : [{
        factionId: OBSERVER,
        hullName: 'OwnHull',
        _displayName: 'Own Best',
        dataName: 'ownDesign1',
        _unnormalizedCombatValue: observerDesignCv
      }]),
      ...alienDesigns
    ],
    fleets: [
      {
        ID: 1,
        displayName: 'Own Fleet',
        factionId: OBSERVER,
        shipsCount: observerShips,
        orbitBody: observerBody,
        spaceTheaterKey: 'inner',
        lowestDeltaVKps: observerDeltaV,
        lowestCombatAccelerationMps2: 2,
        ships: Array.from({ length: observerShips }, (_, i) => ({
          id: 100 + i,
          hullName: 'OwnHull',
          weaponLoadout: [{ role: 'Laser', category: 'Laser', count: 3, systems: ['x'] }],
          armorMedian: 3
        }))
      },
      ...alienFleets
    ]
  };
}

const hostileFleet = ({
  ID = 50,
  shipsCount = 3,
  orbitBody = 'Titan',
  destination = null,
  weapons = [3, 3, 3],
  hullNames = null
} = {}) => ({
  ID,
  displayName: `Victor-${ID}`,
  factionId: ALIEN,
  shipsCount,
  orbitBody,
  destination,
  spaceTheaterKey: 'saturn',
  lowestDeltaVKps: 100,
  lowestCombatAccelerationMps2: 10,
  ships: weapons.map((w, i) => alienShip(200 + i, w, (hullNames && hullNames[i]) || `AlienHull${i}`))
});

// ---------------------------------------------------------------------------
// 1. The refactor: one model, re-exported not re-implemented
// ---------------------------------------------------------------------------

test('the commentary sweep and the shared engagement model are the same function objects', () => {
  assert.strictEqual(commentarySimulation.simulateEngagement, simulateEngagement,
    'server/commentary/simulation.js must re-export the shared simulateEngagement, not a copy');
  assert.strictEqual(commentarySimulation.findRequiredHullsForTier, findRequiredHullsForTier,
    'server/commentary/simulation.js must re-export the shared sweep, not a copy');
  assert.strictEqual(commentaryPrng.createPrng, createPrng,
    'server/commentary/prng.js must re-export the shared PRNG, not a copy');
  assert.strictEqual(commentarySimulation.MAX_SIMULATED_HULLS, MAX_SIMULATED_HULLS);
});

test('the default sweep ceiling is unchanged, so every commentary tier sweeps the range it always did', () => {
  // Pinned against the literal, not against the imported constant: comparing
  // the constant to itself would pass however the constant moved, and moving it
  // silently reshuffles every threshold the strategic commentary already prints.
  assert.strictEqual(MAX_SIMULATED_HULLS, 24,
    'the commentary tier ceiling is published contract; raising it changes shipped prose');
  const result = findRequiredHullsForTier(10000, 30000, 'ceiling-check');
  assert.strictEqual(result.uncertainty.maxHullsSwept, 24,
    'an unparameterised call must still sweep to 24 hulls');
  assert.ok(result.uncertainty.bandExcludes.some(text => text.includes('24 hulls')),
    'the default exclusions must still name the 24-hull ceiling verbatim');
  const notWinnable = findRequiredHullsForTier(1, 1e9, 'ceiling-label');
  assert.strictEqual(notWinnable.bandLabel, 'Not winnable at any count simulated (≤24)',
    'and the not-winnable label the commentary renders must be byte-identical');
});

// ---------------------------------------------------------------------------
// 2. The guaranteed-win bound: why "not winnable" is not a conclusion
// ---------------------------------------------------------------------------

test('guaranteedWinHullCount is a real bound: at that count every trial wins, across many ratios', () => {
  for (const ratio of [0.5, 1, 3, 7, 19, 40, 137]) {
    const ownRating = 12345;
    const opponentRating = ownRating * ratio;
    const count = guaranteedWinHullCount(ownRating, opponentRating);
    assert.ok(count !== null && count >= 1, `a positive ratio ${ratio} must yield a bound`);
    const prng = createPrng(`bound-${ratio}`);
    assert.strictEqual(simulateEngagement(count, ownRating, opponentRating, prng), 1,
      `every trial must be an outright win at ${count} hulls against a ratio of ${ratio}`);
  }
  assert.ok(Math.abs(GUARANTEED_WIN_MARGIN - 1.65) < 1e-12,
    'the margin is read off the model arithmetic: 1.1 * 1.2 / 0.8');
});

test('an unmeasurable rating on either side yields no bound, never a confident small count', () => {
  assert.strictEqual(guaranteedWinHullCount(null, 1000), null);
  assert.strictEqual(guaranteedWinHullCount(1000, null), null);
  assert.strictEqual(guaranteedWinHullCount(0, 1000), null);
  assert.strictEqual(guaranteedWinHullCount(1000, 0), null);
  assert.strictEqual(guaranteedWinHullCount(1000, ''), null,
    'the empty string coerces to 0 and must not become a bound');
});

// ---------------------------------------------------------------------------
// 3. Composition is built from the fleet's own hull mix
// ---------------------------------------------------------------------------

for (const mode of ['player', 'omniscient']) {
  test(`${mode}: the largest fleet's rating is composed over its real ships, not n copies of one`, () => {
    const result = engagement(mode);
    assert.ok(result.available, result.reason || 'the live save must produce an engagement estimate');

    const largest = result.items
      .filter(row => row.composition.opponentRating !== null && row.shipsCount > 1)
      .sort((a, b) => b.shipsCount - a.shipsCount)[0];
    assert.ok(largest, 'the live save must carry at least one multi-ship alien fleet with a rating');
    assert.ok(largest.distinctHullTypes > 1,
      'the largest alien fleet must be a mix of hull types, which is the whole point of composing it');

    // Every per-ship contribution, recomputed independently from the snapshot so
    // the assertion is about the composition and not about the model's own sum.
    const snapshot = live(mode);
    const fleet = snapshot.fleets.find(f => String(f.ID) === String(largest.fleetId));
    const perShip = [];
    if (mode === 'omniscient') {
      const byTemplate = new Map(snapshot.shipDesigns
        .filter(d => String(d.factionId) === String(ALIEN) && d.dataName)
        .map(d => [d.dataName, Number(d._unnormalizedCombatValue)]));
      for (const ship of fleet.ships) perShip.push(byTemplate.get(ship.hullName));
    } else {
      for (const ship of fleet.ships) {
        const weapons = (ship.weaponLoadout || []).reduce((sum, g) => sum + Number(g.count || 0), 0);
        perShip.push(result.ownForce.rating * 1.5 * (weapons / result.ownForce.referenceWeaponSystems));
      }
    }
    const finite = perShip.filter(Number.isFinite);
    assert.strictEqual(finite.length, largest.composition.ratedShips,
      'every rated ship must have a recomputable contribution');

    const n = finite.length;
    const min = Math.min(...finite);
    const max = Math.max(...finite);
    assert.ok(max > min, 'a mixed fleet must not have identical members, or composition proves nothing');
    const rating = largest.composition.opponentRating;

    // The direct property: the rating IS the sum over this fleet's own ships.
    // Asserting only "it is not n x the weakest or strongest" is too weak --
    // n copies of any middling member also lands between those bounds.
    const sum = finite.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(rating - sum) <= Math.max(1, Math.abs(sum) * 1e-6),
      `the fleet rating (${rating}) must be the sum over its own ships (${sum})`);

    // And it must not coincide with n copies of ANY single member, which is the
    // shape the existing archetype tiers use and the one being replaced.
    for (const member of new Set(finite)) {
      assert.ok(Math.abs(rating - n * member) > Math.max(1, Math.abs(rating) * 1e-6),
        `the fleet rating (${rating}) must not equal ${n} copies of any one member (${n * member})`);
    }
    assert.ok(rating > n * min && rating < n * max,
      'the composed rating must sit strictly between n x weakest and n x strongest');
  });
}

test('a fleet larger than the biggest commentary tier still gets a real requirement', () => {
  const result = engagement('omniscient');
  const oversize = result.items.filter(row => row.shipsCount > 3);
  assert.ok(oversize.length > 0, 'the live save must carry fleets past the three-ship tier ceiling');
  for (const row of oversize) {
    assert.notStrictEqual(row.requirement.verdict, ENGAGEMENT_VERDICTS.notWinnable,
      `${row.fleetName} must not report "not winnable": the model is monotone in hull count`);
    const answered = row.requirement.bandLabel !== null || row.requirement.reason !== null;
    assert.ok(answered, `${row.fleetName} must carry either a band or a stated reason, never an empty band`);
  }
});

test('a fleet past the modelled range says so, with a floor, and never a band pinned at the ceiling', () => {
  // A rating far beyond what MAX_ENGAGEMENT_HULLS of the observer's best hull
  // can be swept against. Synthetic because the live save does not reach it.
  const snapshot = syntheticSnapshot({
    observerDesignCv: 10,
    alienFleets: [hostileFleet({ shipsCount: 3, weapons: [400, 400, 400], orbitBody: 'Titan' })]
  });
  const result = buildFleetEngagement(snapshot, { observerId: OBSERVER, mode: 'player' });
  const row = result.items[0];
  assert.strictEqual(row.requirement.verdict, ENGAGEMENT_VERDICTS.beyondModelledRange);
  assert.strictEqual(row.requirement.p20, null, 'no percentile may be reported past the modelled range');
  assert.strictEqual(row.requirement.p80, null);
  assert.strictEqual(row.requirement.hullsAtLeast, MAX_ENGAGEMENT_HULLS + 1,
    'the verdict must carry a floor above the ceiling, not a number pinned at it');
  assert.ok(row.requirement.reason.includes('NOT'),
    'the reason must distinguish this from "not winnable" explicitly');
  assert.notStrictEqual(row.requirement.verdict, ENGAGEMENT_VERDICTS.notWinnable);
});

// ---------------------------------------------------------------------------
// 4. Reachability gates the estimate
// ---------------------------------------------------------------------------

test('a fleet beyond every observer fleet delta-V gets NO hull count and says why', () => {
  const snapshot = syntheticSnapshot({
    observerDeltaV: 1.0, // below every destination the shared table models
    observerBody: 'Mars',
    alienFleets: [hostileFleet({ orbitBody: 'Titan' })]
  });
  const result = buildFleetEngagement(snapshot, { observerId: OBSERVER, mode: 'player' });
  const row = result.items[0];
  assert.strictEqual(row.reachability.state, FLEET_REACHABILITY_STATES.beyondDeltaV);
  assert.strictEqual(row.requirement.verdict, ENGAGEMENT_VERDICTS.withheldUnreachable);
  assert.strictEqual(row.requirement.p20, null);
  assert.strictEqual(row.requirement.p80, null);
  assert.strictEqual(row.requirement.bandLabel, null,
    'an unreachable fleet must show no hull count at all');
  assert.ok(row.requirement.reason && row.requirement.reason.length > 20,
    'and must say why, rather than rendering an empty cell');
  assert.strictEqual(row.fieldable.verdict, 'unknown');
});

test('an unmeasured observer delta-V leaves reachability unknown, never reachable and never beyond', () => {
  const snapshot = syntheticSnapshot({
    observerDeltaV: null,
    observerBody: 'Mars',
    alienFleets: [hostileFleet({ orbitBody: 'Titan' })]
  });
  const result = buildFleetEngagement(snapshot, { observerId: OBSERVER, mode: 'player' });
  const row = result.items[0];
  assert.strictEqual(row.reachability.state, FLEET_REACHABILITY_STATES.unknown);
  assert.notStrictEqual(row.reachability.state, FLEET_REACHABILITY_STATES.reachable);
  assert.notStrictEqual(row.reachability.state, FLEET_REACHABILITY_STATES.beyondDeltaV);
  assert.ok(row.reachability.reason.includes('delta-V'));
  // Unknown still gets a number: withholding it would make an unevaluated
  // threat read as no threat.
  assert.strictEqual(row.requirement.verdict, ENGAGEMENT_VERDICTS.band);
  assert.strictEqual(row.fieldable.verdict, 'unknown',
    'and whether the observer could field it must be unknown, not "sufficient"');
});

test('a body the shared delta-V table does not model is unknown, and says an absent body is not unreachable', () => {
  const snapshot = syntheticSnapshot({
    observerBody: 'Mars',
    alienFleets: [hostileFleet({ orbitBody: '9999 Nowhere' })]
  });
  const row = buildFleetEngagement(snapshot, { observerId: OBSERVER, mode: 'player' }).items[0];
  assert.strictEqual(row.reachability.state, FLEET_REACHABILITY_STATES.unknown);
  assert.ok(/NOT an unreachable one/i.test(row.reachability.reason));
});

test('co-location is a measurement, not an estimate, and needs no delta-V', () => {
  const snapshot = syntheticSnapshot({
    observerDeltaV: 0.1,
    observerBody: 'Mars',
    alienFleets: [hostileFleet({ orbitBody: 'Mars' })]
  });
  const row = buildFleetEngagement(snapshot, { observerId: OBSERVER, mode: 'player' }).items[0];
  assert.strictEqual(row.reachability.state, FLEET_REACHABILITY_STATES.coLocated);
  assert.strictEqual(row.reachability.isEstimate, false,
    'co-location is read from the save; only the delta-V branches are estimates');
  assert.strictEqual(row.reachability.hullsAtEngagementPoint, 6);
});

test('a fleet in heliocentric transit is met at its destination, not at the point it is passing through', () => {
  const snapshot = syntheticSnapshot({
    observerBody: 'Mars',
    alienFleets: [hostileFleet({ orbitBody: 'Sol', destination: 'Mars orbit' })]
  });
  const row = buildFleetEngagement(snapshot, { observerId: OBSERVER, mode: 'player' }).items[0];
  assert.strictEqual(row.engagementPoint.source, 'destination orbit');
  assert.strictEqual(row.reachability.state, FLEET_REACHABILITY_STATES.coLocated,
    'the engagement point is the destination, where the observer already is');
  assert.strictEqual(row.threatensObserverAsset, true);
});

test('a fleet in heliocentric space with no destination has no engagement point at all', () => {
  const snapshot = syntheticSnapshot({
    alienFleets: [hostileFleet({ orbitBody: 'Sol', destination: null })]
  });
  const row = buildFleetEngagement(snapshot, { observerId: OBSERVER, mode: 'player' }).items[0];
  assert.strictEqual(row.engagementPoint.body, null);
  assert.strictEqual(row.reachability.state, FLEET_REACHABILITY_STATES.unknown);
  assert.strictEqual(row.reachability.isEstimate, false,
    'an unresolvable point is not an estimate that failed; nothing was estimated');
});

// ---------------------------------------------------------------------------
// 5. Absent stays null
// ---------------------------------------------------------------------------

test('a fleet whose ships cannot be rated reports unknown, never zero and never a small number', () => {
  const snapshot = syntheticSnapshot({
    observerBody: 'Mars',
    alienFleets: [hostileFleet({ orbitBody: 'Mars', weapons: [null, null, null] })]
  });
  const row = buildFleetEngagement(snapshot, { observerId: OBSERVER, mode: 'player' }).items[0];
  assert.strictEqual(row.composition.opponentRating, null,
    'an unrateable fleet must not be rated 0 -- Number(null) === 0 is the defect this guards');
  assert.strictEqual(row.requirement.verdict, ENGAGEMENT_VERDICTS.unknown);
  assert.strictEqual(row.requirement.p20, null);
  assert.strictEqual(row.requirement.bandLabel, null);
  assert.ok(row.requirement.reason);
  assert.strictEqual(row.fieldable.verdict, 'unknown',
    'and must not fall through to "the observer has enough hulls"');
});

test('a partly rateable fleet yields a FLOOR, flagged as one, never a plain band', () => {
  const snapshot = syntheticSnapshot({
    observerBody: 'Mars',
    alienFleets: [hostileFleet({ orbitBody: 'Mars', weapons: [6, null, 6] })]
  });
  const row = buildFleetEngagement(snapshot, { observerId: OBSERVER, mode: 'player' }).items[0];
  assert.strictEqual(row.composition.ratedShips, 2);
  assert.strictEqual(row.composition.unratedShips, 1);
  assert.strictEqual(row.composition.isLowerBound, true);
  assert.strictEqual(row.requirement.isLowerBound, true);
  assert.ok(/^at least /.test(row.requirement.bandLabel),
    `a floor must be labelled as one, got "${row.requirement.bandLabel}"`);
  assert.ok(row.requirement.hullsAtLeast !== null);
});

test('an observer with no rated design reports unavailable rather than a substituted default rating', () => {
  const snapshot = syntheticSnapshot({
    observerDesignCv: null,
    alienFleets: [hostileFleet({ orbitBody: 'Mars' })]
  });
  const result = buildFleetEngagement(snapshot, { observerId: OBSERVER, mode: 'player' });
  assert.strictEqual(result.available, false);
  assert.ok(/no default rating is substituted/i.test(result.reason));
  assert.strictEqual(result.ownForce.rating, null);
  assert.strictEqual(result.items.length, 0);
  assert.strictEqual(result.fleetsTotalCount, 1,
    'the fleets are still counted, so the reader knows what was not estimated');
});

test('no alien presence reports that none is OBSERVED, not that none exists', () => {
  const result = buildFleetEngagement(syntheticSnapshot({ alienFleets: [] }), {
    observerId: OBSERVER, mode: 'player'
  });
  assert.strictEqual(result.available, false);
  assert.ok(/not a statement that none exists/i.test(result.reason));
});

// ---------------------------------------------------------------------------
// 6. combatPower is never read
// ---------------------------------------------------------------------------

test('the engagement model never reads combatPower', () => {
  for (const relative of ['../shared/fleetEngagement.mjs', '../shared/intel/fleetEngagement.mjs']) {
    const source = fs.readFileSync(path.join(__dirname, relative), 'utf8');
    // Prose about the field is allowed; a property read of it is not.
    const reads = source.match(/\.combatPower\b|\[['"]combatPower['"]\]|combatPowerAvailable/g) || [];
    assert.deepStrictEqual(reads, [],
      `${relative} must not read combatPower -- it is null on every fleet and ship in every mode`);
  }
});

test('no engagement row carries a combatPower field to a consumer', () => {
  for (const mode of ['player', 'omniscient']) {
    const json = JSON.stringify(engagement(mode).items);
    assert.ok(!json.includes('"combatPower"'),
      `${mode}: no emitted row may carry combatPower`);
  }
});

// ---------------------------------------------------------------------------
// 7. Every band is labelled as a model, never as a measurement
// ---------------------------------------------------------------------------

for (const mode of ['player', 'omniscient']) {
  test(`${mode}: the uncertainty block travels per fleet and no band renders as a measurement`, () => {
    const result = engagement(mode);
    assert.strictEqual(result.isEstimate, true);
    const banded = result.items.filter(row => row.requirement.verdict === ENGAGEMENT_VERDICTS.band);
    assert.ok(banded.length > 0, 'the live save must produce at least one banded row');
    for (const row of banded) {
      assert.ok(row.requirement.uncertainty, `${row.fleetName} must carry its own uncertainty block`);
      assert.strictEqual(row.requirement.uncertainty.isMeasurement, false);
      assert.strictEqual(row.requirement.uncertainty.opponentRatingCalibrated, false);
      assert.ok(Array.isArray(row.requirement.uncertainty.bandExcludes)
        && row.requirement.uncertainty.bandExcludes.length === 3);
      assert.strictEqual(row.requirement.isEstimate, true);
      assert.strictEqual(row.requirement.uncertainty.opponentRatingBasis, row.composition.basis,
        'the basis on the band must be the basis the fleet was actually composed with');
    }
  });

  test(`${mode}: the composition basis names the mode it was built in`, () => {
    const result = engagement(mode);
    const expected = mode === 'omniscient' ? COMPOSITION_BASIS.omniscient : COMPOSITION_BASIS.player;
    assert.strictEqual(result.compositionModel.basis, expected);
    if (mode === 'player') {
      assert.ok(/UNCALIBRATED ASSUMPTION/.test(expected),
        'player mode must be visibly labelled as the weaker, assumption-based path');
      assert.ok(result.compositionModel.playerAnchorEvidence.isJudgement);
    } else {
      assert.strictEqual(result.compositionModel.playerAnchorEvidence, null);
    }
  });

  test(`${mode}: alien mobility travels with its confidence and is not an input to the requirement`, () => {
    const result = engagement(mode);
    for (const row of result.items) {
      assert.strictEqual(row.mobility.usedInRequirement, false);
      assert.strictEqual(row.mobility.figuresAreSaveReported, true);
      assert.strictEqual(row.mobility.modelledAccelerationConfidence, 'contradicted-for-alien-hulls');
      assert.ok(row.mobility.citation.includes('model-verification-review'));
      const both = row.mobility.alienLowestCombatAccelerationMps2 !== null
        && row.mobility.observerBestCombatAccelerationMps2 !== null;
      assert.strictEqual(row.mobility.observerCanOutrun === null, !both,
        'an unmeasured side must leave the comparison null, never "we are faster"');
    }
  });
}

// ---------------------------------------------------------------------------
// 8. Truncation announces itself
// ---------------------------------------------------------------------------

test('truncation carries a true total and an omitted count that reconcile', () => {
  const full = engagement('omniscient');
  const capped = buildFleetEngagement(live('omniscient'), {
    observerId: OBSERVER, mode: 'omniscient', limit: 3
  });
  assert.strictEqual(capped.items.length, 3);
  assert.strictEqual(capped.fleetsTotalCount, full.fleetsTotalCount);
  assert.strictEqual(capped.fleetsOmittedCount, full.fleetsTotalCount - 3);
  assert.strictEqual(capped.items.length + capped.fleetsOmittedCount, capped.fleetsTotalCount);
  // The totals are over EVERY fleet, not over the emitted page, or the counts
  // would describe a slice while reading as a census.
  const sumVerdicts = Object.values(capped.verdictTotals).reduce((a, b) => a + b, 0);
  assert.strictEqual(sumVerdicts, capped.fleetsTotalCount);
  const sumReach = Object.values(capped.reachabilityTotals).reduce((a, b) => a + b, 0);
  assert.strictEqual(sumReach, capped.fleetsTotalCount);
  assert.strictEqual(capped.shipsTotalCount, full.shipsTotalCount);
});

test('the default row cap is stated and applied', () => {
  const defaulted = buildFleetEngagement(live('player'), { observerId: OBSERVER, mode: 'player' });
  assert.strictEqual(defaulted.items.length, Math.min(DEFAULT_ENGAGEMENT_ROWS, defaulted.fleetsTotalCount));
});

// ---------------------------------------------------------------------------
// 9. Ordering
// ---------------------------------------------------------------------------

test('the response states its ordering basis and the rows obey it', () => {
  const result = engagement('omniscient');
  assert.strictEqual(result.orderedBy, ENGAGEMENT_ORDERED_BY);
  assert.ok(/threat to observer assets/.test(result.orderedBy));

  const items = result.items;
  // Unreachable rows are last.
  const lastEngageable = items.map(r => r.reachability.state === FLEET_REACHABILITY_STATES.beyondDeltaV)
    .lastIndexOf(false);
  const firstUnreachable = items.map(r => r.reachability.state === FLEET_REACHABILITY_STATES.beyondDeltaV)
    .indexOf(true);
  if (firstUnreachable !== -1) {
    assert.ok(firstUnreachable > lastEngageable,
      'a fleet the observer cannot reach must never displace one it can');
  }
  // Asset-threatening rows lead, ordered by time-to-impact.
  const threatening = items.filter(r => r.threatensObserverAsset);
  const rest = items.filter(r => !r.threatensObserverAsset);
  if (threatening.length > 0 && rest.length > 0) {
    assert.ok(items.indexOf(threatening[threatening.length - 1]) < items.indexOf(rest[0]),
      'every asset-threatening fleet must precede every fleet that threatens nothing owned');
  }
  for (let i = 1; i < threatening.length; i += 1) {
    const prev = threatening[i - 1].daysToArrival ?? Number.MAX_SAFE_INTEGER;
    const here = threatening[i].daysToArrival ?? Number.MAX_SAFE_INTEGER;
    assert.ok(prev <= here, 'asset-threatening fleets must be ordered soonest arrival first');
  }
  for (let i = 1; i < rest.length; i += 1) {
    assert.ok((rest[i - 1].shipsCount ?? 0) >= (rest[i].shipsCount ?? 0),
      'fleets threatening nothing owned must be ordered by mass, so the largest is never buried');
  }
});

// ---------------------------------------------------------------------------
// 10. Both modes, and no raw null on the wire
// ---------------------------------------------------------------------------

test('player mode is a different and more pessimistic answer than omniscient, not a missing one', () => {
  const player = engagement('player');
  const omniscient = engagement('omniscient');
  assert.ok(player.available && omniscient.available);
  assert.strictEqual(player.fleetsTotalCount, omniscient.fleetsTotalCount,
    'the same fleets must be visible in both modes; only the rating basis differs');

  const omniById = new Map(omniscient.items.map(row => [String(row.fleetId), row]));
  let compared = 0;
  let playerHeavier = 0;
  for (const row of player.items) {
    const other = omniById.get(String(row.fleetId));
    if (!other) continue;
    if (row.composition.opponentRating === null || other.composition.opponentRating === null) continue;
    compared += 1;
    if (row.composition.opponentRating >= other.composition.opponentRating) playerHeavier += 1;
  }
  assert.ok(compared > 0, 'the two modes must be comparable on at least one fleet');
  assert.ok(playerHeavier / compared >= 0.5,
    'player mode must not be systematically more optimistic than omniscient; not knowing the enemy '
    + 'has a cost and it must fall on the pessimistic side');
});

for (const mode of ['player', 'omniscient']) {
  test(`${mode}: nothing renders as a raw null, undefined or NaN on the wire`, () => {
    const json = JSON.stringify(engagement(mode));
    assert.ok(!json.includes('NaN'), 'NaN must never reach a consumer');
    assert.ok(!json.includes('"undefined"'), 'the string "undefined" must never reach a consumer');
    assert.ok(!/:\s*"null"/.test(json), 'the string "null" must never reach a consumer as a value');
  });

  test(`${mode}: every emitted row answers with a band, a floor or a stated reason`, () => {
    for (const row of engagement(mode).items) {
      const hasNumber = row.requirement.bandLabel !== null;
      const hasReason = typeof row.requirement.reason === 'string' && row.requirement.reason.length > 0;
      assert.ok(hasNumber || hasReason,
        `${row.fleetName} rendered neither a requirement nor a reason`);
      assert.ok(Object.values(ENGAGEMENT_VERDICTS).includes(row.requirement.verdict));
      assert.ok(Object.values(FLEET_REACHABILITY_STATES).includes(row.reachability.state));
    }
  });
}

// ---------------------------------------------------------------------------
// 11. The AI surface
//
// A figure that exists only in the browser is invisible to every LLM consumer,
// which is half the point of this project. These assert the estimates actually
// reach /latest-threats.md, and that they reach it labelled.
// ---------------------------------------------------------------------------

for (const mode of ['player', 'omniscient']) {
  test(`${mode}: the threats export carries the engagement estimates, labelled as a model`, () => {
    const markdown = renderThreatsMarkdown(live(mode));
    assert.ok(markdown.includes('Per-Fleet Engagement Estimates'),
      'the estimates must reach /latest-threats.md, not only the browser');
    assert.ok(/MODELLED, NOT MEASURED/.test(markdown),
      'the heading itself must say the section is a model');
    assert.ok(/Hulls needed:/.test(markdown), 'each entry must carry a hull requirement line');
    assert.ok(/Observer can field:/.test(markdown),
      'and whether the observer can meet it, which is the actionable half');
    assert.ok(/Reach:/.test(markdown), 'and its reachability state');
    assert.ok(/composed over \d+ of \d+ ship/.test(markdown),
      'and how much of the fleet the rating was composed over');
  });

  test(`${mode}: the threats export announces its truncation and stays inside the byte budget`, () => {
    const markdown = renderThreatsMarkdown(live(mode));
    const bytes = Buffer.byteLength(markdown, 'utf8');
    assert.ok(bytes < THREATS_BYTE_BUDGET,
      `/latest-threats.md must stay under ${THREATS_BYTE_BUDGET} bytes, measured ${bytes}`);
    const engagement = engagement12(mode);
    if (engagement.fleetsOmittedCount > 0) {
      assert.ok(markdown.includes(`of ${engagement.fleetsTotalCount} hostile fleets shown`),
        'a capped list must name the true total, not present a page as the whole set');
      assert.ok(/omitted by the ranking, not by the budget/.test(markdown),
        'and must say which kind of omission it was');
    }
  });

  test(`${mode}: the threats export renders no raw null, undefined or NaN`, () => {
    const markdown = renderThreatsMarkdown(live(mode));
    assert.ok(!/\bnull\b/.test(markdown), 'the text "null" must never be published');
    assert.ok(!/\bundefined\b/.test(markdown), 'the text "undefined" must never be published');
    assert.ok(!/\bNaN\b/.test(markdown), 'the text "NaN" must never be published');
  });
}

test('an unreachable fleet publishes no hull count in the threats export either', () => {
  const snapshot = {
    ...syntheticSnapshot({
      observerDeltaV: 1.0,
      observerBody: 'Mars',
      alienFleets: [hostileFleet({ orbitBody: 'Titan' })]
    }),
    observerFactionId: OBSERVER,
    mode: 'player'
  };
  const markdown = renderThreatsMarkdown(snapshot);
  const needLine = markdown.split('\n').find(line => line.includes('Hulls needed:'));
  assert.ok(needLine, 'the export must carry a hull-requirement line for the fleet');
  assert.ok(needLine.includes('NONE'),
    `the export must publish the withheld verdict, not a number: "${needLine}"`);
  assert.ok(needLine.includes(ENGAGEMENT_VERDICTS.withheldUnreachable.toUpperCase()),
    'and must name which verdict withheld it');
  assert.ok(!/\d+ hulls/.test(needLine), 'and must not publish any hull count at all');
});

// ---------------------------------------------------------------------------
// 12. The endpoint
// ---------------------------------------------------------------------------

test('fleet-engagement is a registry row, routed and dispatched like every other resource', () => {
  assert.strictEqual(INTEL_ENDPOINT_INDEX.fleetEngagement, '/api/intel/fleet-engagement');
  assert.ok(SUPPORTED_RESOURCES.has('fleet-engagement'));
  for (const mode of ['player', 'omniscient']) {
    const projected = buildResourceProjection(live(mode), 'fleet-engagement', {
      mode, observerId: OBSERVER, limit: 5
    });
    assert.strictEqual(projected.count, projected.items.length);
    assert.strictEqual(projected.items.length, 5);
    assert.ok(projected.fleetsTotalCount > projected.items.length);
    assert.strictEqual(projected.fleetsOmittedCount, projected.fleetsTotalCount - projected.items.length);
  }
});
