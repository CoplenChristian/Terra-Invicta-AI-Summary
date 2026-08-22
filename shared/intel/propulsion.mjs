// shared/intel/propulsion.mjs
//
// Purpose: /api/intel/propulsion — phase 1 of the research advisor, pairing the
//   unlock index with the propulsion model.
//
// `/api/intel/propulsion` -- phase 1 of the research advisor.
//
// Two things, and deliberately not a third: the unlock index (what research
// gates what) and the propulsion model (what the observer's hulls do now, and
// what each candidate drive would do to them). Economic valuation, slot
// allocation and the UI panel are later phases and are not here.
//
// Everything is read from the snapshot at request time. Nothing about this
// campaign is baked in: the baseline is whatever the observer's designs
// actually fly, the candidate set is whatever the snapshot says exists, and the
// ranking floor is the design's own measured performance. A turn-1 observer
// flying nothing, with only chemical drives unlocked, gets the same code path
// and a truthful empty-fleet answer rather than a crash or a fabricated best.

import { DEFAULT_OBSERVER_FACTION_ID } from '../constants.mjs';
import { asArray, round, sameId, toFiniteNumber as toFinite } from '../util.mjs';
import {
  DESIGN_ROLES,
  PROPULSION_FORMULAE,
  inferDesignRole,
  rankRefits,
  refitOntoDrive,
  shipPropulsion
} from '../propulsion.mjs';
import {
  AVAILABILITY_STATES,
  buildAvailabilityResolver,
  tallyAvailabilityStates
} from '../researchAvailability.mjs';
import {
  MEASURED_INCOME_BASIS,
  buildResearchCategoryBonuses,
  categoryBonusSummary,
  priceResearchDuration,
  researchDurationFields
} from '../researchCategoryBonus.mjs';
import { allocationPricingSummary, buildResearchAllocationPricing } from '../researchAllocationPricing.mjs';
import { gatesForFamily, unlockIndexCensus } from '../unlockIndex.mjs';
import { findAlienFaction } from './common.mjs';

/** Candidate drives listed per design, before the caller's own limit. */
const DEFAULT_REFIT_LIMIT = 12;
const MAX_REFIT_LIMIT = 100;

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
 * Every ship belonging to `factionId`, with its fleet's identity attached.
 *
 * Ships carry no faction of their own; the fleet does. Reading the ship alone
 * would silently return every faction's hulls.
 */
const shipsOfFaction = (snapshot, factionId) => asArray(snapshot.fleets)
  .filter(fleet => sameId(fleet?.factionId, factionId))
  .flatMap(fleet => asArray(fleet.ships).map(ship => ({ ship, fleet })));

/**
 * The observer's fielded propulsion baseline, per design in service.
 *
 * Grouped by design because that is the unit a refit applies to: a hundred
 * hulls of one design share one answer, and the per-ship rows underneath are
 * what prove the model against the save.
 */
function buildBaseline(snapshot, observerId) {
  const designsById = new Map(asArray(snapshot.shipDesigns).map(design => [design?.dataName, design]).filter(([key]) => key));
  const driveStats = snapshot.driveStats || {};
  const propellantModules = snapshot.propellantModules || {};

  const byDesign = new Map();
  const unresolved = [];

  for (const { ship, fleet } of shipsOfFaction(snapshot, observerId)) {
    const design = ship?.hullName ? designsById.get(ship.hullName) || null : null;
    const record = shipPropulsion({ ship, design, driveStats, propellantModules });
    const row = {
      ...record,
      fleetId: fleet?.ID ?? null,
      fleetName: fleet?.displayName || null,
      orbitBody: fleet?.orbitBody || null,
      // Kept for role inference only -- `weaponLoadout` is the one place that
      // separates point defence from offensive armament. Dropped before the
      // response is assembled.
      rawShip: ship
    };
    if (!record.resolved) {
      // Reported, never silently skipped. A design that cannot be resolved is a
      // finding about the snapshot, not an absence of ships.
      unresolved.push({
        shipId: row.shipId,
        shipName: row.shipName,
        designId: row.designId,
        reason: record.unresolvedReason,
        measured: record.measured
      });
      continue;
    }
    const key = record.designId;
    if (!byDesign.has(key)) {
      byDesign.set(key, { design, ships: [] });
    }
    byDesign.get(key).ships.push(row);
  }

  const designs = [...byDesign.entries()].map(([designId, { design, ships }]) => {
    const exemplar = ships[0];
    const role = inferDesignRole(design, exemplar?.rawShip);
    const hullStats = (snapshot.shipHullStats || {})[design?.hullName] || null;
    const agreementRows = ships.map(ship => ship.agreement?.allAgree).filter(value => value !== null);
    return {
      designId,
      // Non-enumerable so the design template travels to the refit step without
      // being serialised into the response a second time.
      designRecord: design,
      displayName: design?._displayName || design?.friendlyName || designId,
      hullName: design?.hullName || null,
      hullMissionControl: hullStats ? hullStats.missionControl : null,
      shipCount: ships.length,
      role,
      drive: exemplar.drive,
      propellantTanks: toFinite(design?.propellantTanks),
      // Rated figures are the save's own, taken from the hulls in service.
      rated: {
        source: 'save',
        maxDeltaVKps: median(ships.map(ship => ship.measured.maxDeltaVKps)),
        cruiseAccelerationMps2: median(ships.map(ship => ship.measured.cruiseAccelerationMps2)),
        combatAccelerationMps2: median(ships.map(ship => ship.measured.combatAccelerationMps2)),
        basis: 'median across this design\'s hulls in service'
      },
      modelAgreement: {
        shipsCompared: agreementRows.length,
        shipsAgreeing: agreementRows.filter(Boolean).length,
        allAgree: agreementRows.length === 0 ? null : agreementRows.every(Boolean)
      },
      ships
    };
  }).sort((a, b) => b.shipCount - a.shipCount || String(a.designId).localeCompare(String(b.designId)));

  return { designs, unresolved };
}

/**
 * The candidate drive set: every drive in the templates, with the research state
 * of the project that gates it.
 *
 * Not filtered to "good" drives, and not filtered to what is already unlocked --
 * both would be a judgement this phase does not make. The states come from
 * §3b and are kept distinct; the caller decides what to do with each.
 */
function buildCandidateDrives(snapshot, resolver) {
  const driveStats = snapshot.driveStats || {};
  const rows = [];
  for (const [driveId, drive] of Object.entries(driveStats)) {
    const gateId = drive.requiredProjectName || null;
    const availability = gateId
      ? resolver.resolve(gateId)
      : {
        projectId: null,
        displayName: null,
        state: AVAILABILITY_STATES.unknown,
        reason: 'this drive names no gating project',
        researchCost: null,
        researchProgress: null,
        remainingResearchCost: null,
        missingPrerequisites: null,
        unlockChance: null
      };
    rows.push({ driveId, drive, gateId, availability });
  }
  return rows;
}

/**
 * The alien propulsion benchmark, degrading honestly by mode.
 *
 * Alien `shipDesigns` are redacted in player mode -- 0 rows against 82 in
 * omniscient -- so the drive-level comparison is unavailable there. Observed
 * FLEET metrics survive redaction, so the benchmark falls back to those and
 * labels the basis, the same way `summarizeFleetCapability` already does for
 * the Hold Ground posture.
 */
function buildAlienBenchmark(snapshot, observerBaseline, mode) {
  const alien = findAlienFaction(snapshot);
  if (!alien) {
    return { available: false, reason: 'no alien faction is present in this snapshot', basis: null };
  }

  const alienShips = shipsOfFaction(snapshot, alien.ID);
  const alienDesignCount = asArray(snapshot.shipDesigns).filter(design => sameId(design?.factionId, alien.ID)).length;

  const observed = {
    ships: alienShips.length,
    medianMaxDeltaVKps: median(alienShips.map(({ ship }) => ship?.currentMaxDeltaVKps)),
    medianCombatAccelerationMps2: median(alienShips.map(({ ship }) => ship?.combatAccelerationMps2)),
    medianCruiseAccelerationMps2: median(alienShips.map(({ ship }) => ship?.cruiseAccelerationMps2))
  };

  const ownDeltaV = median(observerBaseline.designs.map(design => design.rated.maxDeltaVKps));
  const ownCombat = median(observerBaseline.designs.map(design => design.rated.combatAccelerationMps2));

  // Tri-state ratios: null where either side is unmeasured. A missing alien
  // reading must not render as parity.
  const ratio = (own, theirs) => (own === null || theirs === null || own === 0 ? null : round(theirs / own, 3));

  return {
    available: observed.ships > 0,
    reason: observed.ships > 0 ? null : 'no alien hulls are observable in this snapshot',
    basis: alienDesignCount > 0
      ? 'alien ship designs are visible in this mode, so drive attribution is possible'
      : 'alien ship designs are redacted in this mode; the comparison uses observed fleet performance only',
    designAttributionAvailable: alienDesignCount > 0,
    alienDesignsVisible: alienDesignCount,
    mode,
    observed,
    observer: { medianMaxDeltaVKps: ownDeltaV, medianCombatAccelerationMps2: ownCombat },
    gap: {
      maxDeltaVMultiple: ratio(ownDeltaV, observed.medianMaxDeltaVKps),
      combatAccelerationMultiple: ratio(ownCombat, observed.medianCombatAccelerationMps2)
    }
  };
}

/**
 * 30. Propulsion: the unlock index and the delta-V / acceleration model.
 */
export const propulsionResource = (snapshot, {
  observerId = DEFAULT_OBSERVER_FACTION_ID,
  mode = 'player',
  designId = null,
  limit = null
} = {}) => {
  const requestedLimit = toFinite(limit);
  const refitLimit = requestedLimit === null
    ? DEFAULT_REFIT_LIMIT
    : Math.max(1, Math.min(MAX_REFIT_LIMIT, Math.trunc(requestedLimit)));

  const census = unlockIndexCensus(snapshot);
  const driveStats = snapshot.driveStats || {};
  const driveStatsAvailable = Object.keys(driveStats).length > 0;

  const resolver = buildAvailabilityResolver(snapshot, mode, observerId);
  const baseline = buildBaseline(snapshot, observerId);
  const alienBenchmark = buildAlienBenchmark(snapshot, baseline, mode);

  const observerFaction = asArray(snapshot.factions).find(faction => sameId(faction?.ID, observerId)) || null;
  const monthlyResearch = toFinite(observerFaction?.totalResearch);
  // Built once for the whole design sweep: it walks every hab module and
  // councilor the observer holds, and every refit row reads from it.
  const categoryBonuses = buildResearchCategoryBonuses(snapshot, { observerId });
  // Built once for the same reason: it reads the observer's slot layout and
  // Projects figures, neither of which varies by refit row.
  const allocationPricing = buildResearchAllocationPricing(snapshot, { observerId });

  const candidates = driveStatsAvailable ? buildCandidateDrives(snapshot, resolver) : [];

  // Per design: what each candidate drive would do to it, ranked by the role's
  // own metric with the other axis as a stated floor. Never one blended score.
  const designs = baseline.designs
    .filter(design => !designId || String(design.designId) === String(designId))
    .map(design => {
      const exemplar = design.ships[0];
      const refits = candidates.map(candidate => {
        const refit = refitOntoDrive({
          baseline: exemplar,
          design: design.designRecord,
          candidateDriveId: candidate.driveId,
          candidateDrive: candidate.drive,
          propellantModules: snapshot.propellantModules || {}
        });
        const remaining = candidate.availability.remainingResearchCost;
        // Priced through the allocation the gate project's own slot receives --
        // or, when it is not in a slot, through a LABELLED assumed one with the
        // fastest case beside it. Category and node type both come off the
        // resolver, so neither is guessed here.
        const duration = priceResearchDuration({
          remainingCost: remaining,
          monthlyIncome: monthlyResearch,
          categoryBonuses,
          allocationPricing,
          itemId: candidate.gateId,
          category: candidate.availability.category ?? null,
          type: candidate.availability.type ?? null
        });
        return {
          ...refit,
          isFittedDrive: candidate.driveId === design.drive?.id,
          research: {
            gateProjectId: candidate.gateId,
            gateProjectName: candidate.availability.displayName,
            state: candidate.availability.state,
            reason: candidate.availability.reason,
            researchCost: candidate.availability.researchCost,
            remainingResearchCost: remaining,
            // Absent stays null, and there are exactly two reasons for it: no
            // measured research income, or a slot carrying no pips -- which
            // receives nothing and so has no time to complete at all.
            ...researchDurationFields(duration),
            missingPrerequisites: candidate.availability.missingPrerequisites,
            unlockChance: candidate.availability.unlockChance
          }
        };
      });

      const { ranked, ranking } = rankRefits(refits, {
        role: design.role.role,
        deltaVFloorKps: design.rated.maxDeltaVKps,
        accelerationFloorMps2: design.rated.combatAccelerationMps2
      });

      // "Best available" is not the same as "an improvement", and on this save
      // the two come apart hard: the top researchable-now drive for a fitted
      // warship offers 4.5x the reach and one sixth of the combat acceleration.
      // Every row therefore carries its multiple against the drive actually
      // fitted, so a caller cannot read a ranking position as an upgrade.
      const fittedRow = ranked.find(row => row.isFittedDrive) || null;
      const fittedRank = toFinite(fittedRow?.rankValue);
      const withComparison = ranked.map(row => {
        const value = toFinite(row.rankValue);
        const multiple = (value === null || fittedRank === null || fittedRank === 0)
          ? null
          : round(value / fittedRank, 4);
        return {
          ...row,
          vsFittedDrive: {
            rankMetricMultiple: multiple,
            // Tri-state: null means the comparison could not be made, which is
            // not the same as "no improvement".
            improvesRankMetric: multiple === null ? null : multiple > 1,
            deltaVMultiple: (toFinite(row.deltaVKps) === null || !toFinite(fittedRow?.deltaVKps))
              ? null
              : round(toFinite(row.deltaVKps) / toFinite(fittedRow.deltaVKps), 4),
            combatAccelerationMultiple: (toFinite(row.combatAccelerationMps2) === null || !toFinite(fittedRow?.combatAccelerationMps2))
              ? null
              : round(toFinite(row.combatAccelerationMps2) / toFinite(fittedRow.combatAccelerationMps2), 4)
          }
        };
      });

      // The ranked list is ordered by capability, so its head is dominated by
      // drives behind hundreds of thousands of research points. That is the
      // honest ordering and it stays -- but on this save not one of the 108
      // researchable-now drives appears in the top 100 rows, so a caller
      // reading only the head would conclude there is nothing to do.
      //
      // `bestByState` is a projection of the SAME ranking, not a second one:
      // the top-ranked row within each availability state. `completed` matters
      // most of all, because a refit onto an already-finished project costs no
      // research at all.
      const bestByState = {};
      for (const state of Object.values(AVAILABILITY_STATES)) {
        const best = withComparison.find(row => row.research.state === state && !row.isFittedDrive && row.rankValue !== null);
        bestByState[state] = best
          ? {
            driveId: best.driveId,
            displayName: best.displayName,
            rankValue: best.rankValue,
            deltaVKps: best.deltaVKps,
            cruiseAccelerationMps2: best.cruiseAccelerationMps2,
            combatAccelerationMps2: best.combatAccelerationMps2,
            clearsFloor: best.clearsFloor,
            floorReason: best.floorReason,
            // Carried here too, because this is the row a caller is most
            // likely to read on its own -- and "best in this state" says
            // nothing about whether it beats what is already fitted.
            vsFittedDrive: best.vsFittedDrive,
            gateProjectId: best.research.gateProjectId,
            remainingResearchCost: best.research.remainingResearchCost,
            monthsAtCurrentIncome: best.research.monthsAtCurrentIncome,
            // Why that duration is what it is, and the second end of the range
            // when the allocation had to be assumed. Both travel because this
            // is the row `research-ranking` reads: dropping them here made the
            // advisor print a headline "one pip" figure with no `all-in`
            // beside it, which is a single confident number for a quantity
            // that spans 7x -- exactly what the two scenarios exist to avoid.
            monthsAtCurrentIncomeState: best.research.monthsAtCurrentIncomeState,
            monthsFastestAllocation: best.research.monthsFastestAllocation,
            monthsAreUpperBound: best.research.monthsAreUpperBound,
            categoryResearchBonus: best.research.categoryResearchBonus,
            flatRateMonths: best.research.flatRateMonths,
            unlockChance: best.research.unlockChance
          }
          // Explicit null with the state's own name attached, so "none in this
          // state" is distinguishable from "this state was not considered".
          : null;
      }

      // `designRecord` is the raw save template, carried through buildBaseline
      // purely so the refit step can read its modules. It is dropped here: the
      // response already reports every field of it that a caller needs, and
      // re-emitting 16 full design records would be dead weight.
      const { designRecord, ...designOut } = design;
      return {
        ...designOut,
        ranking,
        candidateCount: withComparison.length,
        candidateStates: tallyAvailabilityStates(withComparison.map(row => ({ state: row.research.state }))),
        bestByState,
        // The fitted drive always survives the limit, so the baseline the
        // ranking is measured against is visible beside the alternatives.
        refits: [
          ...withComparison.filter(row => row.isFittedDrive),
          ...withComparison.filter(row => !row.isFittedDrive).slice(0, refitLimit)
        ],
        refitsShown: Math.min(refitLimit, withComparison.filter(row => !row.isFittedDrive).length),
        ships: design.ships.map(ship => ({
          // `rawShip` is the save record, carried only so far as the role
          // inference; it is not re-emitted here.
          shipId: ship.shipId,
          shipName: ship.shipName,
          fleetName: ship.fleetName,
          orbitBody: ship.orbitBody,
          measured: ship.measured,
          // The formula table is reported once at the top level, not repeated
          // on every hull.
          modelled: {
            source: ship.modelled.source,
            deltaVKps: ship.modelled.deltaVKps,
            maxDeltaVKps: ship.modelled.maxDeltaVKps,
            cruiseAccelerationMps2: ship.modelled.cruiseAccelerationMps2,
            combatAccelerationMps2: ship.modelled.combatAccelerationMps2,
            // Travels with the figure, not only in `agreement`: a client that
            // reads the modelled acceleration alone must still be able to tell
            // "confirmed against the save" from "contradicted by the save".
            combatAccelerationConfidence: ship.modelled.combatAccelerationConfidence
          },
          mass: ship.mass,
          agreement: ship.agreement
        }))
      };
    });

  const shipsCompared = designs.flatMap(design => design.ships).filter(ship => ship.agreement?.allAgree !== null);

  return {
    resource: 'propulsion',
    observerFactionId: observerId,
    intelMode: mode,
    formulae: PROPULSION_FORMULAE,
    roles: {
      inferredBy: 'weapon mounts fitted on the design; this is our inference, not shipped data',
      values: Object.values(DESIGN_ROLES),
      ranking: {
        [DESIGN_ROLES.warship]: 'ranked by combat acceleration, with delta-V as a floor',
        [DESIGN_ROLES.transport]: 'ranked by delta-V, with combat acceleration as a floor'
      },
      note: 'the two axes are in direct tension and are never blended into one score'
    },
    unlockIndex: {
      ...census,
      driveGates: census.available ? gatesForFamily(snapshot, 'drive').length : null
    },
    research: {
      availabilityResolvable: resolver.available && resolver.availabilityKnown,
      availabilitySource: resolver.availabilitySource,
      availableProjectCount: resolver.availableProjectCount,
      reason: resolver.available
        ? (resolver.availabilityKnown ? null : 'the observer\'s available-project list is absent in this mode')
        : resolver.reason,
      monthlyResearchIncome: monthlyResearch,
      monthlyResearchIncomeBasis: MEASURED_INCOME_BASIS,
      // The observer's per-category research bonuses, with their sources. They
      // are applied inside the allocation multiplier below.
      categoryBonuses: categoryBonusSummary(categoryBonuses),
      // The slot allocation every duration on this response is priced through,
      // plus the campaign research-cost basis its remaining costs are on.
      allocationPricing: allocationPricingSummary(
        allocationPricing, snapshot?.metadata?.researchCostScaling ?? null
      ),
      states: Object.values(AVAILABILITY_STATES)
    },
    driveCatalogue: {
      available: driveStatsAvailable,
      reason: driveStatsAvailable ? null : 'driveStats is not present on this snapshot; re-publish after upgrading',
      drives: Object.keys(driveStats).length,
      candidates: candidates.length
    },
    modelVerification: {
      shipsCompared: shipsCompared.length,
      shipsAgreeing: shipsCompared.filter(ship => ship.agreement.allAgree).length,
      basis: 'each modelled column compared against the same column as reported by the save, for every observer ship whose design resolves'
    },
    fleet: {
      designsInService: designs.length,
      shipsResolved: designs.reduce((sum, design) => sum + design.shipCount, 0),
      shipsUnresolved: baseline.unresolved.length,
      // A turn-1 observer flies nothing. That is an answer, not an error.
      note: designs.length === 0
        ? 'the observer has no hulls in service in this snapshot, so there is no fielded baseline to refit against'
        : null
    },
    alienBenchmark,
    unresolvedShips: baseline.unresolved,
    count: designs.length,
    items: designs
  };
};
