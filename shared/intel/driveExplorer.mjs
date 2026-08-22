// shared/intel/driveExplorer.mjs
//
// Purpose: /api/intel/drive-explorer — every drive in the catalogue rated
//   against one of the observer's designs, with the measured half and the
//   estimated half kept apart.
//
// `/api/intel/drive-explorer` -- pick one of your designs, see what every drive
// in the game would do to it.
//
// ---------------------------------------------------------------------------
// TWO HALVES, AND THE WHOLE POINT IS THAT THEY ARE NOT THE SAME KIND OF THING
// ---------------------------------------------------------------------------
//
// MEASURED. `refitOntoDrive` (`shared/propulsion.mjs`) rates an unbuilt drive
// against a fitted ship by holding that ship's MEASURED dry mass and tank
// capacity constant and swapping only the drive -- the same comparison the
// game's own rated figures make. The model behind it reproduces the save's own
// delta-V and acceleration on 696 of 698 ships. Every figure in a row's
// `measured` block comes from there and is labelled `basis: 'measured'`.
//
// ESTIMATED. `shared/intel/mobility.mjs` says in its own header that its
// destination table is "a heuristic estimate rather than a measurement", and it
// sets `isEstimate: true` on every response for exactly that reason. Every
// figure in a row's `estimatedDestinations` block comes from there, is labelled
// `basis: 'estimate'`, and carries `isEstimate: true` of its own.
//
// The two group NAMES carry the distinction as well as the `basis` field, so a
// consumer cannot render them in one register without ignoring both.
// Rendering them at equal visual weight would launder the estimate into a
// measurement, which is the failure this endpoint exists not to commit.
//
// The mobility table holds ten bodies and filters the fleet's own, so nine
// destinations are modelled from anywhere in the system. An absent body is NOT
// an unreachable one, and `destinationModel.note` says so on every response.
//
// ---------------------------------------------------------------------------
// REACTOR COMPATIBILITY IS A REAL GATE. POWER IS NOT.
// ---------------------------------------------------------------------------
//
// A drive's `requiredPowerPlant` must equal the design's reactor
// `powerPlantClass`, or be the sentinel `Any_General`. That rule pins on every
// design in the live save. An incompatible drive is NOT an option -- but it is
// still SHOWN, marked, and naming the reactor class it would need, because
// "this needs a Gas Core Fission reactor" is the single most useful thing this
// page can tell a player.
//
// Power draw is reported and never vetoed on: the game scales thrust by
// min(1, plantOutput / requiredDraw) rather than rejecting an underpowered
// design, and a fielded alien design in this save runs 2.13x over its plant.
// `evaluatePowerBudget` carries the scaling factor as information.
//
// ---------------------------------------------------------------------------
// FOUR AVAILABILITY STATES, NOT TWO
// ---------------------------------------------------------------------------
//
//   fittable      completed or ungated -- fittable today, no research needed
//   researchable  locked, with the chain cost from the same optimal-path walk
//                 /api/intel/tech-path uses
//   never         unreachable for a reason that is not a prerequisite: the
//                 `researchCost: -1` sentinel, or a faction restriction
//   unresolved    availability could not be determined; dropped from the rows
//                 with its reason recorded, never rendered as a blank row
//
// A drive the observer cannot build is not hidden and not offered, and the
// counts reconcile in both directions:
//
//   driveCatalogue.rated + unresolvedCount        == driveCatalogue.total
//   itemsShownCount + itemsOmittedCount           == itemsTotalCount
//   itemsTotalCount + filters.filteredOutCount    == driveCatalogue.rated
//
// so a capped or filtered list can always be reconciled back to all 541 drives.
//
// ---------------------------------------------------------------------------
// AN UNTESTABLE ROW IS NOT A FAILED ROW
// ---------------------------------------------------------------------------
//
// `?minDeltaV=`, `?minCombatAcceleration=` and `?minCruiseAcceleration=` are
// inclusive minimums over the MEASURED block, combined with AND. Their whole
// risk is that `Number(null) === 0`: a null measurement tested against `>= 10`
// silently becomes `0 >= 10` and the row is thrown away as though it had been
// measured and found wanting.
//
// So `filters.filteredOutCount` is decomposed rather than left as one number:
//
//   filters.matched
//   + filters.excludedByStatusOrFamilyCount
//   + filters.thresholdExclusions.belowThresholdCount
//   + filters.thresholdExclusions.untestableCount
//   == driveCatalogue.rated
//
// and `filters.reconciles` reports that identity rather than asserting it. The
// untestable drives are NAMED, with the measurement that was missing, capped and
// with the omitted count carried.
//
// Plain ESM, no Node built-ins, no imports outside `shared/`.

import { DEFAULT_OBSERVER_FACTION_ID } from '../constants.mjs';
import { asArray, round, sameId, toFiniteNumber as toFinite } from '../util.mjs';
import {
  PROPULSION_FORMULAE,
  inferDesignRole,
  refitOntoDrive,
  shipPropulsion
} from '../propulsion.mjs';
import {
  AVAILABILITY_STATES,
  buildAvailabilityResolver
} from '../researchAvailability.mjs';
import {
  buildResearchCategoryBonuses,
  priceResearchDuration,
  researchDurationFields
} from '../researchCategoryBonus.mjs';
import { allocationPricingSummary, buildResearchAllocationPricing } from '../researchAllocationPricing.mjs';
import { evaluatePowerBudget, evaluateReactorClass } from '../refitAdvisor.mjs';
import { buildTechPath, observerGraph } from '../techGraph.mjs';
import { mobilityResource } from './mobility.mjs';
import {
  DRIVE_THRESHOLD_FILTERS,
  DRIVE_THRESHOLD_PARAMETERS,
  parseDriveThresholds
} from '../requestValidation.mjs';

/**
 * What kind of statement a figure is. Carried on the response and on every
 * group of figures, so nothing downstream has to infer it from a field name.
 */
export const MEASUREMENT_BASIS = Object.freeze({
  /** Derived from the save's own measured masses by the pinned propulsion model. */
  measured: 'measured',
  /** From the labelled heuristic destination table in shared/intel/mobility.mjs. */
  estimate: 'estimate'
});

/**
 * The four buckets the availability states collapse into for this page.
 *
 * Deliberately coarser than `AVAILABILITY_STATES`, and never INSTEAD of it: the
 * exact state and its reason travel on every row beside the bucket, so nothing
 * is lost. The bucket is what a filter and a colour can be hung off.
 */
export const DRIVE_AVAILABILITY = Object.freeze({
  fittable: 'fittable',
  researchable: 'researchable',
  never: 'never',
  unresolved: 'unresolved'
});

/** Availability state -> bucket. Anything unlisted is `unresolved`. */
const BUCKET_BY_STATE = Object.freeze({
  [AVAILABILITY_STATES.completed]: DRIVE_AVAILABILITY.fittable,
  [AVAILABILITY_STATES.ungated]: DRIVE_AVAILABILITY.fittable,
  [AVAILABILITY_STATES.researching]: DRIVE_AVAILABILITY.researchable,
  [AVAILABILITY_STATES.researchableNow]: DRIVE_AVAILABILITY.researchable,
  [AVAILABILITY_STATES.prereqClearUnrolled]: DRIVE_AVAILABILITY.researchable,
  [AVAILABILITY_STATES.prereqBlocked]: DRIVE_AVAILABILITY.researchable,
  [AVAILABILITY_STATES.factionRestricted]: DRIVE_AVAILABILITY.never
});

/** Sort keys the endpoint understands. `delta-v` is the default. */
export const DRIVE_SORTS = Object.freeze([
  'delta-v',
  'combat-acceleration',
  'cruise-acceleration',
  'availability',
  'name'
]);

export const DEFAULT_DRIVE_SORT = 'delta-v';

/** Bucket ordering for `sort=availability`: what you can fit today comes first. */
const BUCKET_RANK = Object.freeze({
  [DRIVE_AVAILABILITY.fittable]: 0,
  [DRIVE_AVAILABILITY.researchable]: 1,
  [DRIVE_AVAILABILITY.never]: 2,
  [DRIVE_AVAILABILITY.unresolved]: 3
});

// `detail` chooses the ROW SHAPE, `limit` the row COUNT -- the same split
// `military-value` and `economic-value` use.
//
//   summary  the scannable row: the figures a table shows, no prose. Small
//            enough that the whole 541-drive catalogue fits in one response,
//            which is what makes client-side sorting and filtering possible.
//   full     the same row plus every reason, prerequisite, unlock chance and
//            chain record. Roughly 3x the bytes, so its default cap is lower.
const DEFAULT_ROW_LIMIT = 60;
const DEFAULT_VERBOSE_ROW_LIMIT = 25;
const MAX_ROW_LIMIT = 1000;

/**
 * The observer's ships, with the fleet that carries them.
 *
 * Ships have no faction of their own; the fleet does. Reading the ship alone
 * would return every faction's hulls.
 */
const observerShips = (snapshot, observerId) => asArray(snapshot.fleets)
  .filter(fleet => sameId(fleet?.factionId, observerId))
  .flatMap(fleet => asArray(fleet.ships).map(ship => ({ ship, fleet })));

/** Median of measured values only; null when nothing was measured. */
const median = (values) => {
  const measured = asArray(values).map(toFinite).filter(value => value !== null).sort((a, b) => a - b);
  if (measured.length === 0) return null;
  const middle = Math.floor(measured.length / 2);
  return measured.length % 2 === 0
    ? (measured[middle - 1] + measured[middle]) / 2
    : measured[middle];
};

/**
 * `candidate / fitted`, or null when either side is unmeasured.
 *
 * Never 0 and never 1 by default. A missing figure on either side means the
 * comparison could not be made, which is a different statement from "no
 * change" -- and "no change" is what a defaulted 1.0 would read as.
 */
const multipleOf = (candidate, fitted) => {
  const a = toFinite(candidate);
  const b = toFinite(fitted);
  if (a === null || b === null || b === 0) return null;
  return round(a / b, 4);
};

/** `candidate - fitted`, or null when either side is unmeasured. */
const differenceOf = (candidate, fitted, places = 4) => {
  const a = toFinite(candidate);
  const b = toFinite(fitted);
  if (a === null || b === null) return null;
  return round(a - b, places);
};

/**
 * Every design the observer owns, with the hulls flying it.
 *
 * Designs with NO hulls in service are kept. They have no measured mass, so no
 * refit is computable against them -- but their reactor class, their fitted
 * drive and the whole availability picture are still real, and dropping them
 * would silently narrow the picker to the subset currently in space.
 */
function buildDesignIndex(snapshot, observerId) {
  const driveStats = snapshot.driveStats || {};
  const propellantModules = snapshot.propellantModules || {};
  const powerPlants = (snapshot.componentStats || {}).power_plant || {};

  const shipsByDesign = new Map();
  for (const { ship, fleet } of observerShips(snapshot, observerId)) {
    const key = ship?.hullName;
    if (!key) continue;
    if (!shipsByDesign.has(key)) shipsByDesign.set(key, []);
    shipsByDesign.get(key).push({ ship, fleet });
  }

  const designs = [];
  for (const design of asArray(snapshot.shipDesigns)) {
    if (!sameId(design?.factionId, observerId)) continue;
    const designId = design?.dataName || null;
    // An unresolvable identity is dropped with a reason rather than allowed to
    // become the string "undefined" and collide with every other such design.
    if (!designId) continue;

    const fielded = shipsByDesign.get(designId) || [];
    const reactorName = design.powerPlantName || null;
    const reactor = reactorName ? powerPlants[reactorName] || null : null;

    // The exemplar is the first hull whose full-tank mass is derivable, because
    // that is the one a refit can actually be computed against. Falling back to
    // the first hull keeps the unmeasurable reason visible instead of reporting
    // "no ships".
    let baseline = null;
    let exemplar = null;
    for (const entry of fielded) {
      const record = shipPropulsion({ ship: entry.ship, design, driveStats, propellantModules });
      if (baseline === null) { baseline = record; exemplar = entry; }
      if (record.resolved && record.mass?.dryMassKg !== null && record.mass?.fullWetMassKg !== null) {
        baseline = record;
        exemplar = entry;
        break;
      }
    }

    const baselineMeasured = Boolean(
      baseline?.resolved
      && toFinite(baseline.mass?.dryMassKg) !== null
      && toFinite(baseline.mass?.fullWetMassKg) !== null
    );

    designs.push({
      designId,
      displayName: design._displayName || design.friendlyName || designId,
      hullName: design.hullName || null,
      // Shipped data, reported verbatim and never interpreted -- see
      // inferDesignRole's note on why the save's own tag is not the inference.
      roleTagFromSave: design.role || null,
      role: inferDesignRole(design, exemplar?.ship || null),
      shipsInService: fielded.length,
      propellantTanks: toFinite(design.propellantTanks),
      fittedDrive: {
        driveId: design.driveName || null,
        displayName: driveStats[design.driveName]?.displayName || design.driveName || null,
        classification: driveStats[design.driveName]?.driveClassification || null,
        propellant: driveStats[design.driveName]?.propellant || null,
        resolved: Boolean(design.driveName && driveStats[design.driveName])
      },
      reactor: {
        reactorId: reactorName,
        displayName: reactor?.displayName || reactorName,
        powerPlantClass: reactor?.powerPlantClass || null,
        maxOutputGW: toFinite(reactor?.maxOutputGW),
        // Absent stays null and says which half is missing: "the design names
        // no reactor" and "the reactor is not in the baked catalogue" are
        // different facts and neither is "compatible with everything".
        resolvedReason: reactorName
          ? (reactor ? null : `reactor '${reactorName}' is not present in the baked power-plant catalogue`)
          : 'this design names no reactor'
      },
      baselineMeasured,
      baselineUnmeasuredReason: baselineMeasured
        ? null
        : (fielded.length === 0
          ? 'no hull of this design is in service in this snapshot, so there is no measured dry or full-tank mass to refit against'
          : (baseline?.unresolvedReason || baseline?.mass?.unmeasuredReason
            || 'the hulls of this design carry no measurable dry or full-tank mass')),
      // Retained for the refit step; stripped before the response is assembled.
      designRecord: design,
      baselineRecord: baseline,
      exemplarFleetId: exemplar?.fleet?.ID ?? null,
      exemplarFleetName: exemplar?.fleet?.displayName || null,
      exemplarOrbitBody: exemplar?.fleet?.orbitBody || null,
      // The save's own rated figures for the hulls in service, which is the
      // measurement the model is checked against.
      rated: {
        basis: MEASUREMENT_BASIS.measured,
        source: 'save',
        maxDeltaVKps: median(fielded.map(entry => entry.ship?.currentMaxDeltaVKps)),
        cruiseAccelerationMps2: median(fielded.map(entry => entry.ship?.cruiseAccelerationMps2)),
        combatAccelerationMps2: median(fielded.map(entry => entry.ship?.combatAccelerationMps2)),
        note: fielded.length === 0
          ? 'no hull of this design is in service, so the save reports no rated figures for it'
          : 'median across this design\'s hulls in service'
      }
    });
  }

  designs.sort((a, b) =>
    b.shipsInService - a.shipsInService
    || String(a.displayName).localeCompare(String(b.displayName))
    || String(a.designId).localeCompare(String(b.designId)));

  return designs;
}

const DESTINATION_NOTE = 'Destination reachability is a HEURISTIC ESTIMATE from a fixed delta-V table, not a measurement. '
  + 'Only the destinations listed here are modelled; a body absent from this list is not an unreachable one.';

/**
 * The heuristic destination table, read once per design from `mobility.mjs`.
 *
 * The table is fetched for the fleet the exemplar hull actually sits in, so its
 * origin filtering is the real one. `travelDays` and `arrivalDate` are the
 * mobility estimate for the fleet AS CURRENTLY FITTED and are NOT re-derived
 * per candidate drive -- mobility scales them by the fleet's acceleration, and
 * re-implementing that here would be inventing a second heuristic. They are
 * reported once, at design level, with that basis stated.
 *
 * `deltaVRequired` and `propellantCostTons` are properties of the destination
 * rather than of the fleet, so those are the only fields a per-drive row uses.
 */
function buildDestinationModel(snapshot, design, observerId) {
  const unavailable = (reason) => ({
    available: false,
    isEstimate: true,
    basis: MEASUREMENT_BASIS.estimate,
    reason,
    source: 'shared/intel/mobility.mjs',
    destinationsModelled: 0,
    destinations: [],
    origin: null,
    fleetId: null,
    fleetName: null,
    fleetDeltaVKps: null,
    fleetCombatAccelerationMps2: null,
    travelDaysBasis: null,
    note: DESTINATION_NOTE
  });

  if (design.exemplarFleetId === null || design.exemplarFleetId === undefined) {
    return unavailable('no hull of this design is in service, so there is no fleet to read a destination table for');
  }

  const mobility = mobilityResource(snapshot, design.exemplarFleetId, observerId);
  if (mobility.error) return unavailable(mobility.error);

  const destinations = asArray(mobility.transfers).map(row => ({
    destination: row.destination,
    deltaVRequired: row.deltaVRequired,
    propellantCostTons: row.propellantCostTons,
    travelDaysAsFitted: row.travelDays,
    arrivalDateAsFitted: row.arrivalDate,
    feasibleAsFitted: row.feasible,
    warningAsFitted: row.warning
  }));

  return {
    available: destinations.length > 0,
    isEstimate: true,
    basis: MEASUREMENT_BASIS.estimate,
    reason: destinations.length > 0 ? null : 'the destination table returned no rows for this fleet',
    source: 'shared/intel/mobility.mjs',
    destinationsModelled: destinations.length,
    destinations,
    origin: mobility.currentLocation,
    fleetId: mobility.fleetId,
    fleetName: mobility.fleetName,
    fleetDeltaVKps: mobility.fleetDeltaVKps,
    fleetCombatAccelerationMps2: mobility.fleetCombatAccelerationMps2,
    travelDaysBasis: 'travel days and arrival dates are the mobility estimate for this fleet AS CURRENTLY FITTED; '
      + 'they are not re-derived for a candidate drive, because the heuristic scales them by the fleet\'s own acceleration',
    note: DESTINATION_NOTE
  };
}

/**
 * Which of the modelled destinations a given delta-V opens.
 *
 * Tri-state per destination: an uncomputable delta-V yields `unknownCount`, not
 * "unreachable". A drive whose reach cannot be evaluated has not been shown to
 * fall short.
 */
function reachAtDeltaV(destinationModel, deltaVKps, fittedDeltaVKps, verbose) {
  if (!destinationModel.available) {
    return {
      isEstimate: true,
      basis: MEASUREMENT_BASIS.estimate,
      evaluated: false,
      reason: destinationModel.reason,
      reachableCount: null,
      blockedCount: null,
      unknownCount: null,
      opensUp: [],
      ...(verbose ? { reachable: [], closes: [] } : {})
    };
  }

  const dv = toFinite(deltaVKps);
  const fitted = toFinite(fittedDeltaVKps);
  const reachable = [];
  const opensUp = [];
  const closes = [];
  let blocked = 0;
  let unknown = 0;

  for (const row of destinationModel.destinations) {
    const required = toFinite(row.deltaVRequired);
    if (dv === null || required === null) { unknown += 1; continue; }
    const canReach = dv >= required;
    const fittedReaches = (fitted === null || required === null) ? null : fitted >= required;
    if (canReach) {
      reachable.push(row.destination);
      if (fittedReaches === false) opensUp.push(row.destination);
    } else {
      blocked += 1;
      if (fittedReaches === true) closes.push(row.destination);
    }
  }

  return {
    isEstimate: true,
    basis: MEASUREMENT_BASIS.estimate,
    evaluated: dv !== null,
    reason: dv === null ? 'this drive has no computable delta-V, so no destination can be evaluated for it' : null,
    // The denominator is constant across rows and is reported once, on
    // `destinationModel.destinationsModelled`.
    reachableCount: dv === null ? null : reachable.length,
    blockedCount: dv === null ? null : blocked,
    unknownCount: unknown,
    // `opensUp` is the decision -- the destinations this drive adds over the one
    // already fitted -- so it is named even in the compact shape. The full
    // reachable set is derivable from `destinationModel.destinations` and this
    // row's delta-V, so it is only spelled out under `detail=full`.
    opensUp,
    ...(verbose ? { reachable, closes } : {})
  };
}

/**
 * The research chain behind a gate, memoised per gate.
 *
 * The same walk `/api/intel/tech-path` performs, so a chain cost quoted here
 * and one quoted there cannot disagree. `researchCost: -1` is a sentinel and
 * never enters a sum: `buildTechPath` reports `totalRemainingResearchCost:
 * null` and names the uncosted nodes rather than treating -1 as free.
 *
 * Only the SHAPE of the chain travels on a row -- its length, its cost, its
 * next step and where the cost is incomplete. The step-by-step listing is what
 * `/api/intel/tech-path` is for, and re-emitting it on each of ~486 locked
 * drives measured over a megabyte of pure duplication. `pathEndpoint` names the
 * route that carries it.
 */
function buildChainResolver(snapshot, mode, observerId) {
  const tree = snapshot?.techTree;
  if (!tree || !Array.isArray(tree.nodes) || tree.nodes.length === 0) {
    return {
      available: false,
      reason: 'this snapshot carries no tech tree, so no research chain can be costed',
      chainFor: () => null
    };
  }
  const graph = observerGraph(snapshot, mode, observerId);
  const cache = new Map();
  return {
    available: true,
    reason: null,
    chainFor: (gateId) => {
      if (!gateId) return null;
      if (cache.has(gateId)) return cache.get(gateId);
      const path = buildTechPath(graph, graph.byId, [gateId]);
      const remaining = asArray(path.remainingPath);
      const next = remaining[0] || null;
      const chain = {
        steps: remaining.length,
        totalRemainingResearchCost: path.totalRemainingResearchCost,
        // A chain containing a node with the -1 sentinel has NO honest total.
        // The uncosted ids are named so the gap is visible rather than implied.
        costComplete: path.researchCostComplete === true,
        uncostedNodes: asArray(path.uncostedNodes),
        alreadyCompleted: asArray(path.alreadyCompleted).length,
        nextStep: next
          ? { id: next.id, displayName: next.displayName, type: next.type, cost: next.cost, status: next.status }
          : null,
        pathEndpoint: `/api/intel/tech-path?target=${gateId}`
      };
      cache.set(gateId, chain);
      return chain;
    }
  };
}

/** Comparator for a sort key. Uncomputable values always sort last. */
function comparatorFor(sort) {
  const byName = (a, b) => String(a.displayName || a.driveId).localeCompare(String(b.displayName || b.driveId));
  const numeric = (read) => (a, b) => {
    const x = toFinite(read(a));
    const y = toFinite(read(b));
    // Unknown is not zero and must never rank as zero: it sorts last in both
    // directions rather than being folded into the bottom of the scale.
    if (x === null && y === null) return byName(a, b);
    if (x === null) return 1;
    if (y === null) return -1;
    if (x !== y) return y - x;
    return byName(a, b);
  };

  if (sort === 'name') return byName;
  if (sort === 'availability') {
    return (a, b) => {
      const rankA = BUCKET_RANK[a.availability.bucket] ?? 99;
      const rankB = BUCKET_RANK[b.availability.bucket] ?? 99;
      if (rankA !== rankB) return rankA - rankB;
      return numeric(row => row.measured.deltaVKps)(a, b);
    };
  }
  if (sort === 'combat-acceleration') return numeric(row => row.measured.combatAccelerationMps2);
  if (sort === 'cruise-acceleration') return numeric(row => row.measured.cruiseAccelerationMps2);
  return numeric(row => row.measured.deltaVKps);
}

// ---------------------------------------------------------------------------
// MINIMUM THRESHOLDS ON THE MEASURED COLUMNS
//
// `Number(null) === 0`, so a null measurement tested against `>= 10` silently
// becomes `0 >= 10` and the row is discarded as though it had been measured and
// found wanting. A row that could not be tested is NOT a row that failed, and
// the two are counted separately all the way to the consumer.
//
// The three outcomes are three-valued (Kleene) logic over an AND of minimums,
// which is stricter and more useful than "any null makes the row untestable":
//
//   below       at least one threshold was TESTABLE and definitely failed. The
//               conjunction is then definitely false whatever the unknowns are,
//               so this is a real failure and is counted as one.
//   untestable  every testable threshold passed, and at least one field the
//               caller filtered on is unmeasured. The answer is unknown, so the
//               row is excluded and counted as untestable -- never as a failure,
//               and never silently admitted either.
//   pass        every threshold was testable and every one of them was met.
//
// `unmeasuredFields` names WHICH measurement was missing, because "excluded, we
// could not tell" is only actionable if the reader knows what was absent.
// ---------------------------------------------------------------------------

const THRESHOLD_OUTCOME = Object.freeze({
  pass: 'pass',
  below: 'below',
  untestable: 'untestable'
});

/**
 * Tests one row against the active minimums.
 *
 * @param {Object} row      a rated drive row
 * @param {Object} applied  parameter -> minimum, or null where not filtered on
 * @returns {{ outcome: string, unmeasuredFields: string[], failedFields: string[] }}
 */
function testThresholds(row, applied) {
  const unmeasuredFields = [];
  const failedFields = [];
  for (const parameter of DRIVE_THRESHOLD_PARAMETERS) {
    const minimum = applied?.[parameter] ?? null;
    if (minimum === null) continue;
    const { measure } = DRIVE_THRESHOLD_FILTERS[parameter];
    // `toFinite` is the guard: it maps null, '', undefined and NaN alike onto
    // null rather than onto 0, which is the whole point of this branch.
    const value = toFinite(row.measured?.[measure]);
    if (value === null) unmeasuredFields.push(measure);
    else if (value < minimum) failedFields.push(measure);
  }
  if (failedFields.length > 0) {
    return { outcome: THRESHOLD_OUTCOME.below, unmeasuredFields, failedFields };
  }
  if (unmeasuredFields.length > 0) {
    return { outcome: THRESHOLD_OUTCOME.untestable, unmeasuredFields, failedFields };
  }
  return { outcome: THRESHOLD_OUTCOME.pass, unmeasuredFields, failedFields };
}

/** How many untestable drives are named individually before the list truncates. */
const UNTESTABLE_LIST_LIMIT = 20;

/**
 * Drive Explorer: every drive rated against one of the observer's designs.
 *
 * The neighbouring resources carry a leading ordinal from the endpoint list
 * they were specified in. This one deliberately does not: those numbers run
 * 1-12 with a stray 30, so they are not a sequence and inventing the next one
 * would assert an order that does not exist.
 */
export const driveExplorerResource = (snapshot, {
  observerId = DEFAULT_OBSERVER_FACTION_ID,
  mode = 'player',
  designId = null,
  limit = null,
  sort = null,
  status = null,
  family = null,
  // Raw, exactly as the query string carried them. Both runtimes hand the
  // unparsed value straight through and the shared parser decides, so neither
  // can accept a threshold the other rejects.
  thresholds = null,
  detail = 'summary'
} = {}) => {
  const driveStats = snapshot.driveStats || {};
  const driveIds = Object.keys(driveStats);
  const catalogueAvailable = driveIds.length > 0;
  const verbose = detail === 'full';

  const requestedSort = sort === null || sort === undefined || String(sort).trim() === ''
    ? DEFAULT_DRIVE_SORT
    : String(sort).trim().toLowerCase();
  const activeSort = DRIVE_SORTS.includes(requestedSort) ? requestedSort : DEFAULT_DRIVE_SORT;
  const sortRejected = DRIVE_SORTS.includes(requestedSort) ? null : requestedSort;

  // Parsed up here, beside the sort, so a rejected threshold is echoed even on
  // the branch that has no design to rate anything against. A caller who typed
  // `minDeltaV=abc` must be told, not answered as though they had typed nothing.
  const thresholdRequest = parseDriveThresholds(thresholds || {});

  const designs = buildDesignIndex(snapshot, observerId);
  const requestedDesignId = designId === null || designId === undefined || String(designId).trim() === ''
    ? null
    : String(designId).trim();
  const selected = requestedDesignId
    ? designs.find(design => String(design.designId) === requestedDesignId) || null
    // Default to the design with the most hulls flying it: that is the one with
    // a measured baseline and the one a refit decision most likely concerns.
    : designs[0] || null;

  // The picker payload. `designRecord` and `baselineRecord` are save templates
  // carried only so the refit step can read them; they never reach a response.
  const pickerRows = designs.map(({ designRecord, baselineRecord, rated, ...rest }) => ({ ...rest, rated }));

  const shared = {
    resource: 'drive-explorer',
    observerFactionId: observerId,
    intelMode: mode,
    basisLegend: {
      [MEASUREMENT_BASIS.measured]: 'delta-V and acceleration, from the propulsion model held against this hull\'s '
        + 'measured dry mass and tank capacity. The model reproduces the save\'s own figures for the drive actually fitted.',
      [MEASUREMENT_BASIS.estimate]: 'destination reachability, from the heuristic delta-V table in shared/intel/mobility.mjs. '
        + 'It is an estimate, it is not a measurement, and only nine destinations are modelled.'
    },
    // Stated once rather than repeated on 541 rows.
    refitBasis: 'rated performance at full tanks, with dry mass and tank capacity held at the fitted ship\'s measured values',
    powerBasis: 'Power draw is INFORMATION, not a veto: the game scales thrust by min(1, plantOutput / requiredDraw) rather '
      + 'than rejecting an underpowered design. thrustScalingFactor is that multiplier, and the acceleration figures on a row '
      + 'do NOT have it applied.',
    reactorBasis: 'A drive requires a compatible reactor: its requiredPowerPlant must equal the design\'s reactor '
      + 'powerPlantClass, or be the sentinel Any_General. An incompatible drive is shown and marked rather than hidden, '
      + 'and it is not an option however good its figures.',
    formulae: PROPULSION_FORMULAE,
    availabilityBuckets: {
      values: Object.values(DRIVE_AVAILABILITY),
      meaning: {
        [DRIVE_AVAILABILITY.fittable]: 'completed or ungated -- fittable today',
        [DRIVE_AVAILABILITY.researchable]: 'locked, with the remaining chain cost quoted',
        [DRIVE_AVAILABILITY.never]: 'not researchable by this observer at all (the researchCost -1 sentinel, or a faction restriction)',
        [DRIVE_AVAILABILITY.unresolved]: 'availability could not be determined; these are listed under unresolvedDrives with a reason, never as blank rows'
      }
    },
    sorts: { values: DRIVE_SORTS, default: DEFAULT_DRIVE_SORT, applied: activeSort, rejected: sortRejected },
    // What was ASKED for. What it removed is reported under `filters` beside the
    // status and family counts, the same split `sorts` and `filters` already
    // make. `fields` carries the unit each parameter is in, because `> 10` is
    // ambiguous between km/s and m/s2 to a machine reader as much as a human one.
    thresholds: {
      basis: MEASUREMENT_BASIS.measured,
      fields: DRIVE_THRESHOLD_FILTERS,
      applied: thresholdRequest.applied,
      active: thresholdRequest.active,
      // A malformed minimum is ignored AND echoed, never coerced: `Number('abc')`
      // is NaN and `Number('')` is 0, and either would answer a different
      // question than the caller asked.
      rejected: thresholdRequest.rejected,
      semantics: 'Minimums, inclusive, combined with AND. A row whose value for a filtered field is unmeasured is '
        + 'EXCLUDED and counted under filters.thresholdExclusions.untestableCount -- it is a row that could not be '
        + 'tested, never a row that failed. A row that definitely fails any testable minimum is counted as a failure '
        + 'whatever else is unmeasured.'
    },
    designs: pickerRows,
    designCount: pickerRows.length
  };

  if (!catalogueAvailable || !selected) {
    return {
      ...shared,
      selectedDesign: selected
        ? (({ designRecord, baselineRecord, ...rest }) => rest)(selected)
        : null,
      driveCatalogue: {
        available: catalogueAvailable,
        reason: catalogueAvailable
          ? null
          : 'driveStats is not present on this snapshot; re-publish after upgrading',
        total: driveIds.length
      },
      destinationModel: null,
      reason: selected
        ? null
        : (pickerRows.length === 0
          ? 'this observer owns no ship designs in this snapshot, so there is nothing to rate a drive against'
          : `design '${requestedDesignId}' is not one of this observer's designs in this snapshot`),
      unresolvedDrives: [],
      unresolvedCount: 0,
      itemsTotalCount: 0,
      itemsShownCount: 0,
      itemsOmittedCount: 0,
      count: 0,
      items: []
    };
  }

  const resolver = buildAvailabilityResolver(snapshot, mode, observerId);
  const chains = buildChainResolver(snapshot, mode, observerId);
  const destinationModel = buildDestinationModel(snapshot, selected, observerId);
  const observerFaction = asArray(snapshot.factions).find(faction => sameId(faction?.ID, observerId)) || null;
  const monthlyResearch = toFinite(observerFaction?.totalResearch);
  // Durations here used to be the FLAT whole-faction figure via `monthsAtIncome`
  // while the three sibling endpoints priced theirs against the gate project's
  // category. Two accountings of one fact that disagree is the drift this repo
  // has already been bitten by, so this endpoint now goes through the same
  // allocation pricing as the others. Both models are built once for the whole
  // 541-drive sweep.
  const categoryBonuses = buildResearchCategoryBonuses(snapshot, { observerId });
  const allocationPricing = buildResearchAllocationPricing(snapshot, { observerId });
  const propellantModules = snapshot.propellantModules || {};

  // The fitted drive's own refit row is the comparison baseline, computed
  // through the SAME model as every candidate so the deltas are like for like.
  const fittedDriveId = selected.fittedDrive.driveId;
  const fittedRefit = fittedDriveId
    ? refitOntoDrive({
      baseline: selected.baselineRecord,
      design: selected.designRecord,
      candidateDriveId: fittedDriveId,
      candidateDrive: driveStats[fittedDriveId] || null,
      propellantModules
    })
    : null;

  const rows = [];
  const unresolvedDrives = [];

  for (const driveId of driveIds) {
    const drive = driveStats[driveId];
    const gateId = drive?.requiredProjectName || null;
    const availability = gateId
      ? resolver.resolve(gateId)
      : {
        projectId: null,
        displayName: null,
        // No gating project is not "unknown": it means the drive needs no
        // research and is fittable the moment its reactor allows it.
        state: AVAILABILITY_STATES.ungated,
        reason: 'this drive names no gating project, so it needs no research',
        researchCost: null,
        researchProgress: null,
        remainingResearchCost: null,
        missingPrerequisites: null,
        unlockChance: null
      };

    const bucket = BUCKET_BY_STATE[availability.state] || DRIVE_AVAILABILITY.unresolved;
    if (bucket === DRIVE_AVAILABILITY.unresolved) {
      // Dropped from the rows, never rendered blank, and always counted.
      unresolvedDrives.push({
        driveId,
        displayName: drive?.displayName || driveId,
        gateProjectId: gateId,
        state: availability.state,
        reason: availability.reason || 'availability could not be determined for this drive'
      });
      continue;
    }

    const refit = refitOntoDrive({
      baseline: selected.baselineRecord,
      design: selected.designRecord,
      candidateDriveId: driveId,
      candidateDrive: drive,
      propellantModules
    });

    const reactor = evaluateReactorClass(drive, {
      powerPlantClass: selected.reactor.powerPlantClass
    });
    const power = evaluatePowerBudget(drive, { maxOutputGW: selected.reactor.maxOutputGW });

    const chain = bucket === DRIVE_AVAILABILITY.researchable ? chains.chainFor(gateId) : null;

    const missing = asArray(availability.missingPrerequisites);

    rows.push({
      driveId,
      displayName: refit.displayName,
      classification: refit.classification,
      propellant: refit.propellant,
      // 18 of 541 drives are disabled in the shipped templates. Reported, not
      // filtered: a disabled drive is a fact about the game, not about the
      // player, and hiding it would make the catalogue count irreconcilable.
      disabledInTemplates: refit.disabled === true,
      isFittedDrive: driveId === fittedDriveId,
      // The group NAMES carry the distinction the whole page exists to make:
      // `measured` is the propulsion model against this hull's measured mass;
      // `estimatedDestinations` is the labelled heuristic. A consumer that
      // renders them in one register has to ignore both the key and the `basis`
      // inside it to do so.
      measured: {
        basis: MEASUREMENT_BASIS.measured,
        computable: refit.computable === true,
        // Absent stays null WITH its reason: an uncomputable delta-V is
        // unknown, never 0, and the row still renders.
        reason: refit.reason,
        deltaVKps: refit.computable ? refit.deltaVKps : null,
        cruiseAccelerationMps2: refit.computable ? refit.cruiseAccelerationMps2 : null,
        combatAccelerationMps2: refit.computable ? refit.combatAccelerationMps2 : null,
        // Non-null on 54 of 541 drives, and it qualifies every figure on the
        // row, so it travels in both shapes.
        dryMassCaveat: refit.dryMassCaveat ?? null,
        // The delta against the drive actually fitted, because that is the
        // decision. Null where either side is unmeasured -- never a defaulted
        // 1.0, which would read as "no change".
        deltaVKpsVsFitted: differenceOf(refit.deltaVKps, fittedRefit?.deltaVKps),
        deltaVMultipleVsFitted: multipleOf(refit.deltaVKps, fittedRefit?.deltaVKps),
        combatAccelerationMultipleVsFitted: multipleOf(refit.combatAccelerationMps2, fittedRefit?.combatAccelerationMps2),
        // Cruise gets its own multiple rather than borrowing combat's: the two
        // differ by each drive's own `thrustCap`, which runs 1 to 160 across the
        // catalogue, so they are the same number on only 72 of 541 drives.
        cruiseAccelerationMultipleVsFitted: multipleOf(refit.cruiseAccelerationMps2, fittedRefit?.cruiseAccelerationMps2),
        ...(verbose
          ? {
            source: 'model',
            effectiveEvKps: refit.computable ? refit.effectiveEvKps : null,
            evMultiplier: refit.computable ? refit.evMultiplier : null,
            // The EV multiplier is recomputed per candidate, so a
            // hydrogen-tankage module that boosts the fitted drive contributes
            // nothing to a candidate burning something else. That is a real and
            // large effect, so the modules it stops applying to are named.
            inapplicableEvModules: refit.computable ? asArray(refit.inapplicableEvModules) : [],
            thrustN: refit.computable ? refit.thrustN : null,
            thrustCap: refit.computable ? refit.thrustCap : null,
            flatMassTons: toFinite(drive?.flatMass_tons),
            combatAccelerationMps2VsFitted: differenceOf(refit.combatAccelerationMps2, fittedRefit?.combatAccelerationMps2, 6),
            cruiseAccelerationMps2VsFitted: differenceOf(refit.cruiseAccelerationMps2, fittedRefit?.cruiseAccelerationMps2, 6),
            basisNote: refit.basis || null
          }
          : {})
      },
      reactor: {
        // A real gate. `fail` means this drive is not an option on this design
        // however good its numbers -- so the row is shown, marked, and names
        // the class the design would need. The design's own class is reported
        // once on `selectedDesign.reactor`, not repeated on 541 rows.
        verdict: reactor.verdict,
        compatible: reactor.verdict === 'pass' ? true : (reactor.verdict === 'fail' ? false : null),
        requiredPowerPlant: drive?.requiredPowerPlant || null,
        ...(verbose ? { reason: reactor.reason, designReactorId: selected.reactor.reactorId, designReactorClass: selected.reactor.powerPlantClass } : {})
      },
      // Information, never a veto: the game scales thrust rather than rejecting
      // an underpowered design. Plant output is a property of the design and is
      // reported once on `selectedDesign.reactor.maxOutputGW`.
      power: {
        driveDrawGW: power.driveDrawGW,
        thrustScalingFactor: power.thrustScalingFactor,
        ...(verbose ? { informational: true, plantOutputGW: power.plantOutputGW, totalRequiredDrawGW: power.totalRequiredDrawGW, summary: power.summary } : {})
      },
      availability: {
        bucket,
        state: availability.state,
        // The gate travels on the COMPACT row too, because it is the identity a
        // reader needs to ask the follow-up question: /api/intel/tech-path takes
        // this id, and the drive row's path modal opens on it. `null` here means
        // the drive names no gating project, which is a fact, not an absence.
        gateProjectId: availability.projectId ?? gateId ?? null,
        gateProjectName: availability.displayName ?? null,
        remainingResearchCost: availability.remainingResearchCost,
        ...researchDurationFields(priceResearchDuration({
          remainingCost: availability.remainingResearchCost,
          monthlyIncome: monthlyResearch,
          categoryBonuses,
          allocationPricing,
          itemId: availability.projectId ?? gateId ?? null,
          category: availability.category ?? null,
          type: availability.type ?? null
        })),
        missingPrerequisiteCount: availability.missingPrerequisites === null ? null : missing.length,
        // The chain SHAPE in the compact row; the whole record under detail=full.
        chainSteps: chain ? chain.steps : null,
        chainRemainingResearchCost: chain ? chain.totalRemainingResearchCost : null,
        chainCostComplete: chain ? chain.costComplete : null,
        ...(verbose
          ? {
            reason: availability.reason,
            researchCost: availability.researchCost,
            missingPrerequisites: availability.missingPrerequisites,
            unlockChance: availability.unlockChance,
            chain
          }
          : {})
      },
      estimatedDestinations: reachAtDeltaV(
        destinationModel,
        refit.computable ? refit.deltaVKps : null,
        fittedRefit?.deltaVKps,
        verbose
      )
    });
  }

  // ------------------------------------------------------------------------
  // Filters, then sort, then the cap. Every stage announces what it removed.
  // ------------------------------------------------------------------------
  const requestedStatus = status === null || status === undefined || String(status).trim() === ''
    ? null
    : String(status).trim().toLowerCase();
  const requestedFamily = family === null || family === undefined || String(family).trim() === ''
    ? null
    : String(family).trim().toLowerCase();

  const statusMatches = (row) => requestedStatus === null
    || row.availability.bucket === requestedStatus
    || String(row.availability.state).toLowerCase() === requestedStatus;
  const familyMatches = (row) => requestedFamily === null
    || String(row.classification || '').toLowerCase() === requestedFamily;

  // The categorical filters run first, so "untestable" is measured over the
  // population the caller actually asked about. A drive already excluded by its
  // availability bucket is not a drive whose delta-V could not be tested.
  const inScope = rows.filter(row => statusMatches(row) && familyMatches(row));
  const excludedByStatusOrFamilyCount = rows.length - inScope.length;

  const filtered = [];
  const untestableDrives = [];
  let belowThresholdCount = 0;
  for (const row of inScope) {
    const verdict = testThresholds(row, thresholdRequest.applied);
    if (verdict.outcome === THRESHOLD_OUTCOME.pass) {
      filtered.push(row);
    } else if (verdict.outcome === THRESHOLD_OUTCOME.untestable) {
      untestableDrives.push({
        driveId: row.driveId,
        displayName: row.displayName || row.driveId,
        unmeasuredFields: verdict.unmeasuredFields,
        reason: row.measured.reason
          || `this drive has no measured ${verdict.unmeasuredFields.join(' or ')} against this design, so the minimum could not be tested`
      });
    } else {
      belowThresholdCount += 1;
    }
  }
  filtered.sort(comparatorFor(activeSort));

  const requestedLimit = toFinite(limit);
  const rowLimit = requestedLimit === null
    ? Math.min(verbose ? DEFAULT_VERBOSE_ROW_LIMIT : DEFAULT_ROW_LIMIT, filtered.length)
    : Math.max(0, Math.min(MAX_ROW_LIMIT, Math.trunc(requestedLimit)));

  // The fitted drive always survives the cap: the baseline every delta is
  // measured against has to be visible beside the alternatives.
  const capped = filtered.slice(0, rowLimit);
  const fittedRow = filtered.find(row => row.isFittedDrive) || null;
  const items = (fittedRow && !capped.includes(fittedRow)) ? [fittedRow, ...capped] : capped;

  const census = Object.fromEntries(Object.values(DRIVE_AVAILABILITY).map(value => [value, 0]));
  for (const row of rows) census[row.availability.bucket] += 1;
  census[DRIVE_AVAILABILITY.unresolved] = unresolvedDrives.length;

  const reactorCensus = { compatible: 0, incompatible: 0, unknown: 0 };
  for (const row of rows) {
    if (row.reactor.compatible === true) reactorCensus.compatible += 1;
    else if (row.reactor.compatible === false) reactorCensus.incompatible += 1;
    else reactorCensus.unknown += 1;
  }

  const { designRecord, baselineRecord, ...selectedOut } = selected;

  return {
    ...shared,
    selectedDesign: {
      ...selectedOut,
      fittedDrivePerformance: fittedRefit
        ? {
          basis: MEASUREMENT_BASIS.measured,
          source: 'model',
          computable: fittedRefit.computable === true,
          reason: fittedRefit.reason,
          deltaVKps: fittedRefit.computable ? fittedRefit.deltaVKps : null,
          cruiseAccelerationMps2: fittedRefit.computable ? fittedRefit.cruiseAccelerationMps2 : null,
          combatAccelerationMps2: fittedRefit.computable ? fittedRefit.combatAccelerationMps2 : null
        }
        : {
          basis: MEASUREMENT_BASIS.measured,
          source: 'model',
          computable: false,
          reason: 'this design names no drive, so there is no fitted baseline to compare against',
          deltaVKps: null,
          cruiseAccelerationMps2: null,
          combatAccelerationMps2: null
        },
      mass: selected.baselineRecord?.mass || null
    },
    destinationModel,
    driveCatalogue: {
      available: true,
      reason: null,
      total: driveIds.length,
      rated: rows.length,
      unresolved: unresolvedDrives.length,
      disabledInTemplates: rows.filter(row => row.disabledInTemplates).length,
      reconciles: rows.length + unresolvedDrives.length === driveIds.length
    },
    availabilityCensus: census,
    reactorCompatibilityCensus: reactorCensus,
    research: {
      availabilityResolvable: resolver.available && resolver.availabilityKnown,
      availabilitySource: resolver.availabilitySource,
      reason: resolver.available
        ? (resolver.availabilityKnown ? null : 'the observer\'s available-project list is absent in this mode')
        : resolver.reason,
      chainCostsAvailable: chains.available,
      chainCostsReason: chains.reason,
      monthlyResearchIncome: monthlyResearch,
      // The slot allocation every duration on this response is priced through,
      // plus the campaign research-cost basis its remaining costs are on.
      allocationPricing: allocationPricingSummary(
        allocationPricing, snapshot?.metadata?.researchCostScaling ?? null
      )
    },
    filters: {
      status: requestedStatus,
      family: requestedFamily,
      matched: filtered.length,
      // A filter that matched nothing is reported as such rather than
      // presenting an empty list as "there are no drives".
      filteredOutCount: rows.length - filtered.length,
      // The decomposition of that total. Without it "469 filtered out" cannot be
      // read: a reader cannot tell a drive that failed the minimum from a drive
      // nobody could measure, and those are different facts.
      excludedByStatusOrFamilyCount,
      thresholdExclusions: {
        belowThresholdCount,
        untestableCount: untestableDrives.length,
        // Named, not just counted -- "excluded, could not tell" is only
        // actionable when the reader knows which drives and which measurement.
        untestableDrives: untestableDrives.slice(0, UNTESTABLE_LIST_LIMIT),
        untestableTotalCount: untestableDrives.length,
        untestableOmittedCount: Math.max(0, untestableDrives.length - UNTESTABLE_LIST_LIMIT)
      },
      // The four categories partition the rated set. Reported rather than
      // asserted so a consumer can check it instead of trusting it.
      reconciles: filtered.length
        + excludedByStatusOrFamilyCount
        + belowThresholdCount
        + untestableDrives.length === rows.length
    },
    unresolvedDrives,
    unresolvedCount: unresolvedDrives.length,
    itemsTotalCount: filtered.length,
    itemsShownCount: items.length,
    // Truncation announces itself all the way to the consumer.
    itemsOmittedCount: Math.max(0, filtered.length - items.length),
    detail,
    count: items.length,
    items
  };
};
