// shared/fleetEngagement.mjs
//
// Purpose: per-fleet engagement estimates — what force each specific alien
//   fleet would cost to beat, gated on whether the observer can reach it.
//
// Spec: docs/fleet-engagement-spec.md.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS: A PER-SHIP TIER IS NOT A FLEET
// ---------------------------------------------------------------------------
//
// `server/commentary/simulation.js` already answers "how many hulls do I need",
// but it answers it about ARCHETYPES -- one median escort, one typical
// combatant, two of them, one heavy capital, three of them. The largest tier is
// three ships. Measured on the live save at campaign date 1/1/2035, omniscient:
//
//   57 alien fleets, 420 alien ships, 4 observer fleets, 38 observer hulls
//   fleet sizes  34, 26, 25, 24, 23, 22, 21, 20, 19, 18, 16, 14, 13, 13, 10,
//                10, 9, 8, 7, 7, 6, 5, 4x4, 7x3, 9x2, 15x1
//   26 of 57 fleets exceed the largest existing tier of three ships
//    3 of 57 exceed the entire 24-hull sweep the tiers use
//
// "A heavy capital costs 7 hulls" says nothing useful about a fleet holding
// three of them plus fifteen escorts. So the opponent rating here is built from
// EACH FLEET'S OWN SHIPS -- its real hull mix, ship by ship -- never from N
// copies of a representative one. Victor-620 is 34 ships across 17 distinct
// hull templates, and its composed rating (805,662 omniscient) is neither
// 34x its weakest member (120,830) nor 34x its strongest (2,897,984).
//
// ---------------------------------------------------------------------------
// THE SWEEP CEILING, AND WHY "NOT WINNABLE" IS NOT A CONCLUSION
// ---------------------------------------------------------------------------
//
// `MAX_SIMULATED_HULLS` is 24 and the commentary tiers keep it. Against real
// fleets it binds hard and it binds WRONG: at a ceiling of 24, five of the six
// largest alien fleets report "not winnable", when the truth is 28-48 hulls.
//
// This module therefore sweeps to a ceiling DERIVED FROM THE MODEL rather than
// picked. `guaranteedWinHullCount` reads the count above which every trial is
// an outright win straight off `simulateEngagement`'s own arithmetic, so the
// sweep is guaranteed to terminate with a real band whenever that count is
// affordable to compute. Above `MAX_ENGAGEMENT_HULLS` the answer is reported as
// BEYOND THE MODELLED RANGE -- explicitly distinct from "not winnable", which
// this model cannot conclude at all because the exchange is monotone in hull
// count. Runtime measured 2026-08-22 on the live save: all 57 fleets at a
// ceiling of 400 took 40 ms, against 32 ms at the old ceiling of 24. The
// ceiling is not runtime-bound.
//
// ---------------------------------------------------------------------------
// REACHABILITY GATES IT
// ---------------------------------------------------------------------------
//
// The observer has 4 fleets and 38 hulls against 57 alien fleets across 6
// theatres. For most of them the honest answer is not a hull count at all.
// Reachability is computed FIRST, from `shared/intel/mobility.mjs` -- the
// repo's existing delta-V destination table, called rather than copied, so
// there is exactly one such table. Its tri-state is preserved:
//
//   co-located      an observer fleet is already at the engagement point.
//                   MEASURED; no transfer needed.
//   reachable       the point is in the modelled table and at least one
//                   observer fleet's measured delta-V meets it. ESTIMATE.
//   beyond-delta-v  the point is in the table and no observer fleet meets it.
//                   ESTIMATE. NO HULL COUNT IS PRINTED -- an engagement you
//                   cannot reach is not an option, and printing a number for
//                   it implies one.
//   unknown         the point could not be resolved, is not in the modelled
//                   table, or no observer fleet has a measured delta-V.
//
// `unknown` is NOT `reachable` and it is NOT `beyond-delta-v`. It still
// receives a hull count, deliberately: withholding the number would make the
// panel fail toward "you are fine", which for a threat display is the worst
// possible direction. The row says the reachability could not be evaluated.
//
// ---------------------------------------------------------------------------
// WHAT IS MEASURED AND WHAT IS MODELLED
// ---------------------------------------------------------------------------
//
// Measured, read from the save: every fleet's ship count, hull mix, weapon
// loadout, armour, delta-V and acceleration; the observer's own designs and
// their combat values; every fleet's position, destination and arrival date.
//
// Modelled, and labelled as such on every row: the opponent rating, the hull
// requirement band, and (except for co-location) reachability. The band is
// Monte Carlo spread across seeds and NOTHING ELSE -- see
// `shared/engagementModel.mjs`. None of it is a measurement.
//
// `combatPower` is never read. It is null on every fleet and every ship in
// both modes and `combatPowerSource` says "not present in save";
// `tests/fleetEngagement.test.js` greps this module for the identifier.
//
// Plain ESM, no Node built-ins -- the hosted worker cannot `require` CommonJS.

import { DEFAULT_OBSERVER_FACTION_ID } from './constants.mjs';
import { asArray, round, sameId, toFiniteNumber as toFinite, MS_PER_DAY } from './util.mjs';
import { findAlienFaction, normalizeBody } from './intel/common.mjs';
import { mobilityResource } from './intel/mobility.mjs';
import { samplePercentile } from './prng.mjs';
import {
  MAX_SIMULATED_HULLS,
  findRequiredHullsForTier,
  guaranteedWinHullCount,
  hullBandLabel
} from './engagementModel.mjs';

/**
 * The practical ceiling on a per-fleet sweep.
 *
 * A stated judgement, not a measurement. Its justification is measured though:
 * the largest fleet on the live save needs 45-48 hulls in omniscient and 69-72
 * in player mode, so 200 leaves roughly 3x headroom over the worst case this
 * save produces, and the whole 57-fleet sweep at a ceiling of 400 measured 40 ms
 * (2026-08-22), so nothing here is runtime-bound. Above it the requirement stops
 * being a plan and is reported as beyond the modelled range.
 */
export const MAX_ENGAGEMENT_HULLS = 200;

/** Default number of ranked rows emitted. The rest are counted, not hidden. */
export const DEFAULT_ENGAGEMENT_ROWS = 12;

/**
 * Can the observer put hulls at the engagement point?
 *
 * Four outcomes, and `unknown` is a distinct answer from `beyond-delta-v` for
 * the same reason `REACHABILITY_STATES.unknown` is distinct from
 * `beyond-horizon` in `shared/researchReachability.mjs`: the first says the
 * check could not be evaluated, the second says it was evaluated and failed.
 * Collapsing them would report an unevaluated target as measured-and-refused.
 */
export const FLEET_REACHABILITY_STATES = Object.freeze({
  coLocated: 'co-located',
  reachable: 'reachable',
  beyondDeltaV: 'beyond-delta-v',
  unknown: 'unknown'
});

/**
 * What the hull requirement resolved to.
 *
 * `beyondModelledRange` and `notWinnable` are deliberately separate. The
 * exchange model is monotone in hull count -- see `shared/engagementModel.mjs`
 * -- so `notWinnable` should be unreachable in practice, and it is emitted only
 * if a sweep somehow fails at or above the count the model guarantees a win at.
 * Reporting "not winnable" where the truth is "not modelled" is the specific
 * error this split exists to prevent.
 */
export const ENGAGEMENT_VERDICTS = Object.freeze({
  band: 'band',
  beyondModelledRange: 'beyond-modelled-range',
  notWinnable: 'not-winnable',
  unknown: 'unknown',
  withheldUnreachable: 'withheld-unreachable'
});

/**
 * How the emitted rows are ordered, in the words the response reports.
 *
 * The second key deliberately changes what the third one is. A fleet closing on
 * an observer asset is urgent, so those rows lead with time-to-impact; a fleet
 * that threatens nothing the observer owns is not urgent at all, so those rows
 * lead with mass. Ordering the whole list on arrival buried the largest hostile
 * concentration in the game -- 34 ships -- below four-ship transfers to a body
 * the observer does not hold.
 */
export const ENGAGEMENT_ORDERED_BY =
  'threat to observer assets first, then urgency inside that group and mass outside it. The tuple is '
  + '[an engageable reachability state before beyond-delta-v; then whether the fleet is closing on an '
  + 'observer hab or an observer-held body; then, for fleets that are, soonest arrival before most ships, '
  + 'and for fleets that are not, most ships before soonest arrival; then fleet id]. Reachability is '
  + 'evaluated BEFORE the hull count, so a fleet the observer cannot reach never displaces one it can.';

const ALIEN_ORBIT_SUFFIX = /\s+orbit$/i;

/**
 * Bodies that are a position in transit rather than a place two fleets can
 * meet. `shared/markdownExports.mjs` already excludes both from the observer's
 * orbit set for the same reason: every fleet reported at "Sol" on the live save
 * carries `mission: "Transfer"`, a destination and an arrival date, so it is
 * mid-flight in heliocentric space, not parked somewhere reachable.
 */
const NON_RENDEZVOUS_BODIES = new Set(['sol', 'deep space']);

/** Body key that treats "Earth", "Earth orbit" and "Earth Orbit" as one place. */
const bodyKey = (value) => normalizeBody(String(value ?? '').replace(ALIEN_ORBIT_SUFFIX, ''));

/** Total weapon systems on a ship, or null when the loadout is not carried. */
function weaponSystemCount(ship) {
  const loadout = asArray(ship?.weaponLoadout);
  if (loadout.length === 0) return null;
  let total = 0;
  let counted = 0;
  for (const group of loadout) {
    const count = toFinite(group?.count);
    if (count === null) continue;
    total += count;
    counted += 1;
  }
  // Absent stays null: a loadout whose every group has an uncountable size is
  // not a ship with zero weapons.
  return counted === 0 ? null : total;
}

const median = (values) => {
  const sorted = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  return samplePercentile(sorted, 0.5);
};

/**
 * The observer's own side of the comparison.
 *
 * NO DEFAULT RATING. `runMonteCarloSimulation` falls back to `ownRating = 5000`
 * when the observer has no design carrying a combat value, which is a confident
 * number for an unmeasured quantity; here an observer with nothing rated yields
 * `rating: null` and the whole resource reports unavailable instead.
 */
function readOwnForce(snapshot, observerId) {
  const designs = asArray(snapshot.shipDesigns).filter(d => sameId(d.factionId, observerId));
  const rated = designs
    .map(d => ({ design: d, cv: toFinite(d._unnormalizedCombatValue) }))
    .filter(entry => entry.cv !== null && entry.cv > 0)
    .sort((a, b) => b.cv - a.cv);

  const fleets = asArray(snapshot.fleets).filter(f => sameId(f.factionId, observerId));
  const ships = fleets.flatMap(f => asArray(f.ships));
  const weaponCounts = ships.map(weaponSystemCount).filter(n => n !== null && n > 0);
  const hulls = fleets.reduce((sum, f) => {
    const count = toFinite(f.shipsCount);
    return count === null ? sum : sum + count;
  }, 0);

  const best = rated[0] || null;

  return {
    rating: best ? best.cv : null,
    ratingSource: best
      ? 'the highest combat value among the observer\'s own ship designs, as carried in the snapshot'
      : null,
    bestDesignName: best ? (best.design._displayName || best.design.friendlyName || best.design.hullName || null) : null,
    bestHullName: best ? (best.design.hullName || null) : null,
    ratedDesignCount: rated.length,
    designCount: designs.length,
    referenceWeaponSystems: weaponCounts.length > 0 ? median(weaponCounts) : null,
    totalHulls: fleets.length === 0 ? null : hulls,
    fleetCount: fleets.length,
    fleets: fleets.map(f => ({
      fleetId: f.ID ?? null,
      fleetName: f.displayName ?? null,
      orbitBody: f.orbitBody ?? null,
      shipsCount: toFinite(f.shipsCount),
      deltaVKps: toFinite(f.lowestDeltaVKps),
      combatAccelerationMps2: toFinite(f.lowestCombatAccelerationMps2)
    }))
  };
}

/**
 * How each mode composes a fleet's opponent rating, in the words the response
 * reports. Both are assumptions; neither is a measurement of alien combat
 * performance.
 */
export const COMPOSITION_BASIS = Object.freeze({
  omniscient:
    'the sum of each ship\'s own design combat value, joined ship-by-ship through the hull template the '
    + 'save records for it. The values are READ rather than invented, but treating a combat value as the '
    + 'exchange currency of a Lanchester-style model is still an assumption, and the sum assumes a fleet is '
    + 'worth its parts under a model linear in count.',
  player:
    'UNCALIBRATED ASSUMPTION, composed per ship. Alien designs are redacted in player mode, so each alien '
    + 'ship is rated at (observer\'s best design combat value) x1.5 x (that ship\'s observed weapon systems / '
    + 'the median weapon systems on the observer\'s own ships), and the fleet is the sum. The x1.5 is the '
    + 'same invented "typical alien combatant" constant server/commentary/simulation.js already uses -- no '
    + 'game source states it. What is observed is each ship\'s weapon loadout and the observer\'s own ships; '
    + 'the scaling between them is not.'
});

/**
 * Why weapon systems and not armour.
 *
 * Measured 2026-08-22 against the live save, omniscient, 420 alien ships joined
 * to their designs: correlation between a ship's design combat value and its
 * weapon-system count is +0.798, and against its `armorMedian` it is -0.077 --
 * armour carries essentially no signal about combat value. Scoring the player
 * view on armour under-rated one fleet by 5.5x against its omniscient rating
 * (ratio 0.183) where the weapon-system anchor never fell below 0.81x. In a
 * threat display, under-rating the enemy is the dangerous direction.
 *
 * This is one save's measurement used to choose a model's shape, not a per-save
 * calibration constant: nothing here is fitted to this campaign, and the code
 * path reads only fields player mode legitimately carries.
 */
export const PLAYER_ANCHOR_EVIDENCE = Object.freeze({
  measuredOn: '2026-08-22, live save, campaign date 1/1/2035, 420 alien ships joined to their designs',
  weaponSystemsVsCombatValue: 0.798,
  armorMedianVsCombatValue: -0.077,
  chosenAnchor: 'weapon systems',
  reason: 'armour carries essentially no signal about combat value on the measured save, and an '
    + 'armour-anchored player rating under-rated one fleet by 5.5x against its omniscient rating. '
    + 'Under-rating the enemy is the dangerous direction for a threat display.',
  isJudgement: true
});

/** The same invented "typical alien combatant" multiplier simulation.js uses. */
const PLAYER_TYPICAL_ALIEN_MULTIPLIER = 1.5;

/**
 * Compose one fleet's opponent rating from its own ships.
 *
 * Ships that cannot be rated are COUNTED, never treated as zero. A partial sum
 * under-states the enemy, so it is flagged `isLowerBound` and the requirement
 * built on it is reported as a floor rather than a band. A fleet with nothing
 * rateable yields `rating: null`.
 */
function composeFleetRating(fleet, { mode, designByTemplate, ownForce }) {
  const ships = asArray(fleet.ships);
  const hullTypes = new Set();
  let rating = 0;
  let ratedShips = 0;
  let unratedShips = 0;

  for (const ship of ships) {
    if (ship?.hullName) hullTypes.add(ship.hullName);

    if (mode === 'omniscient') {
      const design = designByTemplate.get(ship?.hullName);
      const cv = toFinite(design?._unnormalizedCombatValue);
      if (cv === null || !(cv > 0)) { unratedShips += 1; continue; }
      rating += cv;
      ratedShips += 1;
      continue;
    }

    const weapons = weaponSystemCount(ship);
    if (weapons === null || !(weapons > 0)
      || ownForce.rating === null || ownForce.referenceWeaponSystems === null
      || !(ownForce.referenceWeaponSystems > 0)) {
      unratedShips += 1;
      continue;
    }
    rating += ownForce.rating * PLAYER_TYPICAL_ALIEN_MULTIPLIER
      * (weapons / ownForce.referenceWeaponSystems);
    ratedShips += 1;
  }

  // `shipsCount` and the embedded ship array can disagree if the projection
  // truncated one of them; the larger is reported so a reader is never told the
  // fleet is smaller than the save says.
  const declaredShips = toFinite(fleet.shipsCount);
  const shipsCount = declaredShips === null
    ? (ships.length || null)
    : Math.max(declaredShips, ships.length);

  return {
    opponentRating: ratedShips === 0 ? null : rating,
    ratedShips,
    unratedShips,
    shipsCount,
    distinctHullTypes: hullTypes.size || null,
    // A rating summed over only some of the fleet is a FLOOR on its strength,
    // so the hull requirement derived from it is a floor too.
    isLowerBound: ratedShips > 0 && unratedShips > 0,
    basis: mode === 'omniscient' ? COMPOSITION_BASIS.omniscient : COMPOSITION_BASIS.player,
    reason: ratedShips === 0
      ? (ships.length === 0
        ? 'this snapshot carries no per-ship detail for this fleet, so its composition cannot be rated'
        : 'no ship in this fleet could be rated, so no opponent rating was formed')
      : null
  };
}

/**
 * Where the engagement would happen.
 *
 * A fleet under way is met at its DESTINATION, not at the heliocentric position
 * it currently occupies -- on the live save all 21 fleets reported at "Sol"
 * carry `mission: "Transfer"` with a destination and an arrival date, and
 * "Sol" is where they are passing through, not somewhere anyone can be
 * intercepted.
 */
function resolveEngagementPoint(fleet, { habsById, fleetsById }) {
  const unresolved = (reason) => ({ body: null, bodyKey: null, source: null, reason });

  if (fleet.destination) {
    if (String(fleet.destinationType) === 'hab') {
      const hab = habsById.get(String(fleet.destinationId));
      if (hab?.orbitBody) {
        return { body: hab.orbitBody, bodyKey: bodyKey(hab.orbitBody), source: 'destination hab orbit', reason: null };
      }
      return unresolved(`this fleet is under way to the station ${fleet.destination}, which this snapshot `
        + 'does not carry, so the body it would be met at is unknown');
    }
    if (String(fleet.destinationType) === 'fleet') {
      const target = fleetsById.get(String(fleet.destinationId));
      const targetBody = target?.orbitBody;
      if (targetBody && !NON_RENDEZVOUS_BODIES.has(bodyKey(targetBody))) {
        return { body: targetBody, bodyKey: bodyKey(targetBody), source: 'orbit of the fleet it is joining', reason: null };
      }
      return unresolved('this fleet is under way to another fleet that is itself in transit, so there is '
        + 'no body the engagement can be located at');
    }
    const key = bodyKey(fleet.destination);
    if (key && !NON_RENDEZVOUS_BODIES.has(key)) {
      return {
        body: String(fleet.destination).replace(ALIEN_ORBIT_SUFFIX, ''),
        bodyKey: key,
        source: 'destination orbit',
        reason: null
      };
    }
    return unresolved('this fleet\'s destination is heliocentric space rather than a body');
  }

  const key = bodyKey(fleet.orbitBody);
  if (key && !NON_RENDEZVOUS_BODIES.has(key)) {
    return { body: fleet.orbitBody, bodyKey: key, source: 'current orbit', reason: null };
  }
  return unresolved('this fleet is in heliocentric space with no destination recorded, so there is no '
    + 'body the engagement can be located at');
}

/**
 * Reachability of one engagement point, over the observer's fleets.
 *
 * The delta-V table is `shared/intel/mobility.mjs`'s, reached by CALLING it once
 * per observer fleet rather than by copying its rows. Its per-destination
 * `feasible` is already tri-state, and the tri-state is combined here the only
 * way that keeps "unknown" out of "unreachable": any one fleet that can make it
 * settles the question; otherwise an unmeasured fleet leaves it unknown; only
 * when every observer fleet is measured AND short is the point beyond delta-V.
 */
function resolveReachability(point, { observerMobility }) {
  const states = FLEET_REACHABILITY_STATES;

  if (point.bodyKey === null) {
    return {
      state: states.unknown,
      reason: point.reason,
      isEstimate: false,
      requiredDeltaVKps: null,
      observerFleetsAble: null,
      observerFleetsShort: null,
      observerFleetsUnmeasured: null,
      hullsAtEngagementPoint: null
    };
  }

  const coLocated = observerMobility.filter(entry => entry.bodyKey === point.bodyKey);
  if (coLocated.length > 0) {
    const hulls = coLocated.reduce((sum, entry) => sum + (entry.shipsCount ?? 0), 0);
    return {
      state: states.coLocated,
      reason: null,
      // Co-location is read from the save, not modelled -- the only branch here
      // that is a measurement.
      isEstimate: false,
      requiredDeltaVKps: 0,
      observerFleetsAble: coLocated.length,
      observerFleetsShort: 0,
      observerFleetsUnmeasured: 0,
      hullsAtEngagementPoint: coLocated.some(entry => entry.shipsCount === null) ? null : hulls
    };
  }

  let required = null;
  let able = 0;
  let short = 0;
  let unmeasured = 0;
  let ableHulls = 0;
  let ableHullsMeasurable = true;
  let modelled = false;

  for (const entry of observerMobility) {
    const row = entry.transfersByBody.get(point.bodyKey);
    if (!row) continue;
    modelled = true;
    if (required === null) required = toFinite(row.deltaVRequired);
    if (row.feasible === true) {
      able += 1;
      if (entry.shipsCount === null) ableHullsMeasurable = false;
      else ableHulls += entry.shipsCount;
    } else if (row.feasible === false) {
      short += 1;
    } else {
      unmeasured += 1;
    }
  }

  if (!modelled) {
    return {
      state: states.unknown,
      reason: `${point.body} is not one of the destinations the shared delta-V table models, so whether the `
        + 'observer can reach it cannot be evaluated. A body absent from that table is NOT an unreachable one.',
      isEstimate: true,
      requiredDeltaVKps: null,
      observerFleetsAble: null,
      observerFleetsShort: null,
      observerFleetsUnmeasured: null,
      hullsAtEngagementPoint: null
    };
  }

  if (able > 0) {
    return {
      state: states.reachable,
      reason: null,
      isEstimate: true,
      requiredDeltaVKps: required,
      observerFleetsAble: able,
      observerFleetsShort: short,
      observerFleetsUnmeasured: unmeasured,
      hullsAtEngagementPoint: ableHullsMeasurable ? ableHulls : null
    };
  }

  if (unmeasured > 0) {
    return {
      state: states.unknown,
      reason: `no observer fleet with a measured delta-V budget was found for ${point.body}; `
        + `${unmeasured} observer fleet(s) carry no delta-V, so falling short cannot be established`,
      isEstimate: true,
      requiredDeltaVKps: required,
      observerFleetsAble: 0,
      observerFleetsShort: short,
      observerFleetsUnmeasured: unmeasured,
      hullsAtEngagementPoint: null
    };
  }

  return {
    state: states.beyondDeltaV,
    reason: `every observer fleet is short of the ${required === null ? 'required' : `${required} km/s`} `
      + `delta-V budget the shared table models for ${point.body}`,
    isEstimate: true,
    requiredDeltaVKps: required,
    observerFleetsAble: 0,
    observerFleetsShort: short,
    observerFleetsUnmeasured: 0,
    hullsAtEngagementPoint: 0
  };
}

/**
 * The hull requirement for one composed rating.
 *
 * Never returns an empty band. Every branch names a verdict, and the
 * beyond-modelled-range branch carries the lower bound rather than a number
 * pinned at the ceiling.
 */
function resolveRequirement({ ownRating, composition, seed, reachability }) {
  const verdicts = ENGAGEMENT_VERDICTS;
  const blank = (verdict, reason) => ({
    verdict,
    reason,
    p20: null,
    p80: null,
    bandLabel: null,
    hullsAtLeast: null,
    maxHullsSwept: null,
    guaranteedWinAt: null,
    isLowerBound: false,
    isEstimate: true,
    uncertainty: null
  });

  if (reachability.state === FLEET_REACHABILITY_STATES.beyondDeltaV) {
    return blank(
      verdicts.withheldUnreachable,
      `no hull count is given: ${reachability.reason}. An engagement the observer cannot reach is not an `
        + 'option, and printing a force requirement for it would imply one.'
    );
  }

  if (ownRating === null) {
    return blank(verdicts.unknown, 'the observer has no ship design carrying a combat value in this '
      + 'snapshot, so there is nothing to rate an engagement against');
  }
  if (composition.opponentRating === null) {
    return blank(verdicts.unknown, composition.reason);
  }

  const guaranteed = guaranteedWinHullCount(ownRating, composition.opponentRating);
  if (guaranteed === null) {
    return blank(verdicts.unknown, 'the ratings on one side of this comparison are not positive finite '
      + 'numbers, so no hull count can be swept for it');
  }

  if (guaranteed > MAX_ENGAGEMENT_HULLS) {
    return {
      verdict: verdicts.beyondModelledRange,
      reason: `this fleet rates above what ${MAX_ENGAGEMENT_HULLS} of the observer's best hull can be `
        + 'modelled against, so the requirement is reported as a floor rather than swept. This is NOT '
        + '"not winnable": the exchange model is monotone in hull count, so some count always wins; it is '
        + 'past the range this panel models.',
      p20: null,
      p80: null,
      bandLabel: `more than ${MAX_ENGAGEMENT_HULLS} hulls`,
      hullsAtLeast: MAX_ENGAGEMENT_HULLS + 1,
      maxHullsSwept: null,
      guaranteedWinAt: guaranteed,
      isLowerBound: true,
      isEstimate: true,
      uncertainty: null
    };
  }

  // One count of headroom above the guaranteed-win bound, so the sweep can
  // never report "not winnable" merely because it stopped one short.
  const ceiling = Math.min(MAX_ENGAGEMENT_HULLS, guaranteed + 1);
  const swept = findRequiredHullsForTier(ownRating, composition.opponentRating, seed, {
    opponentRatingBasis: composition.basis,
    maxHulls: ceiling
  });

  if (!swept.winnable) {
    // Unreachable by construction: at `guaranteed` hulls every trial is an
    // outright win, so a sweep to `guaranteed + 1` cannot fail. Kept as a real
    // branch rather than an assertion so a future model change surfaces here
    // instead of silently reporting a band it did not compute.
    return {
      verdict: verdicts.notWinnable,
      reason: `the sweep reached ${ceiling} hulls -- at or above the count this model guarantees an `
        + `outright win at (${guaranteed}) -- without meeting the target win probability. That should be `
        + 'impossible for a model monotone in hull count, so this verdict indicates the model changed, not '
        + 'that the engagement cannot be won.',
      p20: null,
      p80: null,
      bandLabel: swept.bandLabel,
      hullsAtLeast: null,
      maxHullsSwept: ceiling,
      guaranteedWinAt: guaranteed,
      isLowerBound: false,
      isEstimate: true,
      uncertainty: swept.uncertainty
    };
  }

  // The band, in words. This file used to carry its own copy of the pluralised
  // arithmetic, because `findRequiredHullsForTier` rendered "1 hulls" and
  // correcting it there would have changed strategic-commentary strings and
  // invalidated the byte-identity proving the sweep's move into `shared/`
  // changed nothing. That proof is banked and the label now lives in one place.
  return {
    verdict: verdicts.band,
    reason: null,
    p20: swept.p20,
    p80: swept.p80,
    // A rating summed over only part of the fleet is a floor, so the hull count
    // it produces is a floor too and says so in its own label.
    bandLabel: hullBandLabel(swept.p20, swept.p80, composition.isLowerBound ? 'at least ' : ''),
    hullsAtLeast: composition.isLowerBound ? swept.p20 : null,
    maxHullsSwept: ceiling,
    guaranteedWinAt: guaranteed,
    isLowerBound: composition.isLowerBound,
    isEstimate: true,
    uncertainty: swept.uncertainty
  };
}

/**
 * Can the observer actually field the requirement?
 *
 * Tri-state, and the "no" case is the actionable half: the observer has 4
 * fleets and 38 hulls on the live save, and most requirements are larger than
 * anything it can put at the engagement point.
 */
function resolveFieldable({ requirement, reachability, ownForce }) {
  const needed = requirement.hullsAtLeast ?? requirement.p80 ?? null;
  const atPoint = reachability.hullsAtEngagementPoint;

  if (needed === null) {
    return {
      verdict: 'unknown',
      reason: 'no hull requirement was formed for this fleet, so there is nothing to compare the '
        + 'observer\'s strength against',
      hullsNeeded: null,
      hullsAtEngagementPoint: atPoint,
      hullsTotal: ownForce.totalHulls
    };
  }
  if (atPoint === null) {
    return {
      verdict: 'unknown',
      reason: 'how many observer hulls could be brought to this engagement point could not be measured, '
        + 'so whether the requirement can be met is unknown -- not "yes"',
      hullsNeeded: needed,
      hullsAtEngagementPoint: null,
      hullsTotal: ownForce.totalHulls
    };
  }
  return {
    verdict: atPoint >= needed ? 'sufficient' : 'insufficient',
    reason: atPoint >= needed
      ? null
      : `${atPoint} observer hull(s) can reach this engagement point against a requirement of ${needed}`,
    hullsNeeded: needed,
    hullsAtEngagementPoint: atPoint,
    hullsTotal: ownForce.totalHulls
  };
}

/**
 * Alien mobility, carried but NOT used as an input to the hull count.
 *
 * `docs/model-verification-review.md` "Resolution of Claim 1" measured the
 * modelled combat acceleration disagreeing with the save on 263 of 416 alien
 * ships, with no field in the snapshot that selects the affected designs. The
 * figure reported here is the one the SAVE states, not a modelled one, so the
 * discrepancy does not apply to it -- and the caveat travels anyway, because a
 * reader comparing acceleration across the two sides needs to know the modelled
 * column for aliens is contested. Nothing in the requirement depends on it.
 */
function readMobility(fleet, ownForce) {
  const alienAccel = toFinite(fleet.lowestCombatAccelerationMps2);
  const ownAccel = ownForce.fleets
    .map(f => f.combatAccelerationMps2)
    .filter(v => v !== null)
    .sort((a, b) => b - a)[0] ?? null;

  return {
    alienLowestCombatAccelerationMps2: alienAccel,
    alienLowestDeltaVKps: toFinite(fleet.lowestDeltaVKps),
    observerBestCombatAccelerationMps2: ownAccel,
    // Tri-state. `null` where either side is unmeasured -- never "we are faster".
    observerCanOutrun: (alienAccel === null || ownAccel === null) ? null : ownAccel > alienAccel,
    figuresAreSaveReported: true,
    usedInRequirement: false,
    modelledAccelerationConfidence: 'contradicted-for-alien-hulls',
    caveat: 'the acceleration figures here are the ones the save reports. The propulsion MODEL\'s combat '
      + 'acceleration disagrees with the save on 263 of 416 alien ships and no correction is applied, so a '
      + 'modelled alien acceleration is contested; the save-reported one is preferred and is what is shown. '
      + 'No part of the hull requirement is computed from either.',
    citation: 'docs/model-verification-review.md, "Resolution of Claim 1" (measured 2026-08-21)'
  };
}

/**
 * Per-fleet engagement estimates for one snapshot.
 *
 * @param {object} snapshot filtered snapshot
 * @param {object} [options]
 * @param {number} [options.observerId]
 * @param {string} [options.mode] 'player' | 'enhanced' | 'omniscient'
 * @param {number|null} [options.limit] rows emitted; the rest are counted
 */
export function buildFleetEngagement(snapshot, {
  observerId = DEFAULT_OBSERVER_FACTION_ID,
  mode = 'player',
  limit = DEFAULT_ENGAGEMENT_ROWS
} = {}) {
  const requestedLimit = toFinite(limit);
  const rowLimit = requestedLimit === null || requestedLimit < 1
    ? DEFAULT_ENGAGEMENT_ROWS
    : Math.floor(requestedLimit);

  const unavailable = (reason) => ({
    available: false,
    reason,
    mode,
    observerFactionId: observerId,
    isEstimate: true,
    orderedBy: ENGAGEMENT_ORDERED_BY,
    fleetsTotalCount: 0,
    fleetsOmittedCount: 0,
    verdictTotals: {},
    reachabilityTotals: {},
    ownForce: null,
    items: []
  });

  const alienFaction = findAlienFaction(snapshot);
  if (!alienFaction) {
    return unavailable('no alien faction is present in this intelligence picture, so there is no fleet to '
      + 'estimate an engagement against');
  }

  const alienFleets = asArray(snapshot.fleets).filter(f => sameId(f.factionId, alienFaction.ID));
  if (alienFleets.length === 0) {
    return unavailable('no alien fleet is visible in this intelligence picture. That is not a statement '
      + 'that none exists -- only that none is observed here.');
  }

  const ownForce = readOwnForce(snapshot, observerId);
  if (ownForce.rating === null) {
    return {
      ...unavailable('the observer has no ship design carrying a combat value in this snapshot, so there '
        + 'is no own-side rating to compare any alien fleet against. No default rating is substituted.'),
      ownForce,
      fleetsTotalCount: alienFleets.length
    };
  }

  // Omniscient joins each alien ship to its own design; player mode carries no
  // alien designs at all, which is exactly why the two modes rate differently.
  const designByTemplate = new Map();
  for (const design of asArray(snapshot.shipDesigns)) {
    if (!sameId(design.factionId, alienFaction.ID)) continue;
    if (design.dataName) designByTemplate.set(design.dataName, design);
  }

  const habsById = new Map(asArray(snapshot.habs).map(h => [String(h.ID), h]));
  const fleetsById = new Map(asArray(snapshot.fleets).map(f => [String(f.ID), f]));

  const observerHabBodies = new Set(
    asArray(snapshot.habs)
      .filter(h => sameId(h.factionId, observerId))
      .map(h => bodyKey(h.orbitBody))
      .filter(key => key && !NON_RENDEZVOUS_BODIES.has(key))
  );
  const observerFleetBodies = new Set(
    ownForce.fleets.map(f => bodyKey(f.orbitBody)).filter(key => key && !NON_RENDEZVOUS_BODIES.has(key))
  );

  // The delta-V table, read once per observer fleet through the existing
  // mobility resource rather than duplicated here.
  const observerMobility = ownForce.fleets.map(f => {
    const mobility = f.fleetId === null ? null : mobilityResource(snapshot, f.fleetId, observerId);
    const transfersByBody = new Map();
    for (const row of asArray(mobility?.transfers)) {
      transfersByBody.set(bodyKey(row.destination), row);
    }
    return {
      fleetId: f.fleetId,
      fleetName: f.fleetName,
      bodyKey: bodyKey(f.orbitBody),
      shipsCount: f.shipsCount,
      deltaVKps: f.deltaVKps,
      transfersByBody
    };
  });

  const destinationsModelled = observerMobility.reduce(
    (max, entry) => Math.max(max, entry.transfersByBody.size), 0
  );

  const gameDate = snapshot.metadata?.gameTimeString ? new Date(snapshot.metadata.gameTimeString) : null;
  const gameTime = gameDate && !Number.isNaN(gameDate.getTime()) ? gameDate.getTime() : null;
  const snapshotId = snapshot.snapshotId || snapshot.saveHash || snapshot.metadata?.gameTimeString || 'engagement';

  const rows = [];
  for (const fleet of alienFleets) {
    const composition = composeFleetRating(fleet, { mode, designByTemplate, ownForce });
    const point = resolveEngagementPoint(fleet, { habsById, fleetsById });
    const reachability = resolveReachability(point, { observerMobility });
    const requirement = resolveRequirement({
      ownRating: ownForce.rating,
      composition,
      // Seeded off the save and the fleet, never the clock, so the same save
      // renders the same band on every refresh.
      seed: `${snapshotId}-fleet-${fleet.ID}`,
      reachability
    });

    let daysToArrival = null;
    if (fleet.arrivalDate && gameTime !== null) {
      const arrival = new Date(fleet.arrivalDate);
      if (!Number.isNaN(arrival.getTime())) {
        daysToArrival = Math.max(0, Math.round((arrival.getTime() - gameTime) / MS_PER_DAY));
      }
    }

    const threatensObserverAsset = point.bodyKey !== null
      && (observerHabBodies.has(point.bodyKey) || observerFleetBodies.has(point.bodyKey));

    rows.push({
      fleetId: fleet.ID ?? null,
      fleetName: fleet.displayName ?? null,
      shipsCount: composition.shipsCount,
      distinctHullTypes: composition.distinctHullTypes,
      orbitBody: fleet.orbitBody ?? null,
      spaceTheaterKey: fleet.spaceTheaterKey ?? null,
      spaceTheaterName: fleet.spaceTheaterName ?? null,
      dominantWeaponType: fleet.dominantWeaponType ?? null,
      weaponSummary: fleet.weaponSummary ?? null,
      mission: fleet.mission ?? null,
      destination: fleet.destination ?? null,
      destinationType: fleet.destinationType ?? null,
      arrivalDate: fleet.arrivalDate ?? null,
      daysToArrival,
      threatensObserverAsset,
      engagementPoint: point,
      reachability,
      composition: {
        opponentRating: composition.opponentRating === null ? null : round(composition.opponentRating, 1),
        ratedShips: composition.ratedShips,
        unratedShips: composition.unratedShips,
        isLowerBound: composition.isLowerBound,
        basis: composition.basis,
        reason: composition.reason
      },
      requirement,
      fieldable: resolveFieldable({ requirement, reachability, ownForce }),
      mobility: readMobility(fleet, ownForce)
    });
  }

  // The rank tuple ENGAGEMENT_ORDERED_BY describes, built per row so the order
  // is one comparison of one array rather than a chain that can drift from the
  // sentence describing it.
  const rankOf = (row) => {
    const engageable = row.reachability.state === FLEET_REACHABILITY_STATES.beyondDeltaV ? 1 : 0;
    const threatens = row.threatensObserverAsset ? 0 : 1;
    const days = row.daysToArrival ?? Number.MAX_SAFE_INTEGER;
    const mass = -(row.shipsCount ?? 0);
    return threatens === 0
      ? [engageable, threatens, days, mass]
      : [engageable, threatens, mass, days];
  };

  rows.sort((a, b) => {
    const left = rankOf(a);
    const right = rankOf(b);
    for (let i = 0; i < left.length; i += 1) {
      if (left[i] !== right[i]) return left[i] - right[i];
    }
    return String(a.fleetId).localeCompare(String(b.fleetId));
  });

  const countBy = (key, read) => rows.reduce((totals, row) => {
    const value = read(row);
    totals[value] = (totals[value] || 0) + 1;
    return totals;
  }, {});

  const emitted = rows.slice(0, rowLimit);

  return {
    available: true,
    reason: null,
    mode,
    observerFactionId: observerId,
    // The whole surface is an estimate. It is never a measurement and no
    // consumer may render a band as one.
    isEstimate: true,
    orderedBy: ENGAGEMENT_ORDERED_BY,
    ownForce: {
      rating: round(ownForce.rating, 1),
      ratingSource: ownForce.ratingSource,
      bestDesignName: ownForce.bestDesignName,
      bestHullName: ownForce.bestHullName,
      ratedDesignCount: ownForce.ratedDesignCount,
      referenceWeaponSystems: ownForce.referenceWeaponSystems,
      fleetCount: ownForce.fleetCount,
      totalHulls: ownForce.totalHulls,
      fleets: ownForce.fleets
    },
    compositionModel: {
      basis: mode === 'omniscient' ? COMPOSITION_BASIS.omniscient : COMPOSITION_BASIS.player,
      composedPerShip: true,
      note: 'the opponent rating for a fleet is composed over that fleet\'s OWN ships, one at a time. It '
        + 'is not N copies of a representative ship, and it is not any archetype tier.',
      playerAnchorEvidence: mode === 'omniscient' ? null : PLAYER_ANCHOR_EVIDENCE
    },
    reachabilityModel: {
      states: Object.values(FLEET_REACHABILITY_STATES),
      source: 'shared/intel/mobility.mjs',
      destinationsModelled,
      isEstimate: true,
      note: 'reachability other than co-location is a HEURISTIC ESTIMATE from a fixed delta-V table, not a '
        + 'measurement. Only the destinations that table models can be evaluated; a body absent from it is '
        + 'reported unknown, and an unknown body is NOT an unreachable one.',
      gatesRequirement: 'a fleet beyond every observer fleet\'s delta-V gets no hull count. A fleet whose '
        + 'reachability is unknown still gets one, labelled unknown, because withholding it would make an '
        + 'unevaluated threat read as no threat.'
    },
    sweep: {
      maxEngagementHulls: MAX_ENGAGEMENT_HULLS,
      commentaryTierCeiling: MAX_SIMULATED_HULLS,
      ceilingBasis: 'per fleet, one hull above the count this model guarantees an outright win at, capped '
        + `at ${MAX_ENGAGEMENT_HULLS}. The commentary tiers keep their ${MAX_SIMULATED_HULLS}-hull ceiling; `
        + 'sweeping real fleets that low reported "not winnable" for five of the six largest alien fleets '
        + 'when the truth was 28-48 hulls.',
      notWinnableIsNotAConclusion: 'the exchange model is monotone in hull count, so some count always '
        + 'wins. A requirement past the ceiling is reported as beyond the modelled range, never as an '
        + 'engagement that cannot be won.'
    },
    fleetsTotalCount: rows.length,
    fleetsOmittedCount: rows.length - emitted.length,
    shipsTotalCount: rows.reduce((sum, row) => sum + (row.shipsCount ?? 0), 0),
    verdictTotals: countBy('verdict', row => row.requirement.verdict),
    reachabilityTotals: countBy('reachability', row => row.reachability.state),
    fieldableTotals: countBy('fieldable', row => row.fieldable.verdict),
    items: emitted
  };
}
