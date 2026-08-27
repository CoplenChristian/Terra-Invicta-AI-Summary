/**
 * server/engine/military.js
 * Purpose: the military read-model — assemble the observer's military facts into
 *   a `world.military` block the directive engine can reason over.
 *
 * The directive engine is entirely councilor-facing: it had no view of inbound
 * alien fleets, the observer's shipyards, or the hulls those yards could field
 * before a threat arrived. This module is that view. It is a READ-MODEL ONLY --
 * it produces no recommendations. It assembles five facts:
 *
 *   * `hostileMovement` and `theaters` -- the shared theater board, verbatim.
 *   * `shipyards` -- the OBSERVER'S OWN yards, with each one's MODULE tier
 *     (resolved from `templateName` through `SHIP_CONSTRUCTION_MODULES`, never
 *     from the hab's `habTier`, which is a different number and would put the
 *     wrong tier in a build-time formula).
 *   * `buildOptions` / `buildRefusals` -- for each (body, hull) the observer can
 *     attempt at one of their own yards, the fastest measured build time, or an
 *     honest refusal when none of their yards can produce a measured figure.
 *   * `hate` -- the alien-hate block: the actual reading when it is observable,
 *     the war threshold, and the measured minimum-hate floor.
 *   * `theaterForce` -- per body, the composed strength of the force PRESENT on
 *     each side, taken from `shared/fleetEngagement.mjs`. `world` is frozen and
 *     data-only and the engine never sees the raw snapshot, so a rating can
 *     only be composed HERE, where the snapshot still is. Nothing consumes it
 *     yet, by design: see docs/theater-defence-engagement-spec.md, which is
 *     also where the reason lives that no hull count is emitted from it.
 *
 * The disciplines this repo enforces apply here exactly as everywhere else:
 *   * Absent stays null. An unmeasured build time is a refusal row, never a 0,
 *     never "fast".
 *   * Unknown is not safe. A check that cannot be evaluated reports that; it
 *     never falls through to the reassuring answer.
 *   * Player mode is a different code path. The actual hate reading is redacted
 *     there, so `hate.actual` is null with `redacted: true` -- not a zero, not an
 *     omitted key.
 *   * A capped list announces its cap. Nothing here is capped -- the bounded
 *     worst case (12 bodies x 28 hulls) is small enough to emit whole -- but if
 *     a list ever were capped it would carry *TotalCount and *OmittedCount
 *     beside it, because a truncated list presented as a whole one is the same
 *     defect class as fabricating data.
 *
 * Pure module: no I/O, no network, no filesystem. Requires only the shared intel
 * and build-time modules, so it runs identically in tests, the local server and
 * any future export path.
 */

const { theaterBoardResource } = require('../../shared/intel/theaters.mjs');
const { normalizeBody } = require('../../shared/intel/common.mjs');
const { shipBuildDaysFromSnapshot, SHIP_CONSTRUCTION_MODULES } = require('../../shared/shipBuildTime.mjs');
const { ALIEN_HATE_WAR_THRESHOLD } = require('../../shared/alienHateEconomics.mjs');
const { buildFleetEngagement, COMPOSITION_BASIS } = require('../../shared/fleetEngagement.mjs');
const { asArray, round, sameId, toFiniteNumber } = require('../../shared/util.mjs');

/**
 * Why a yard row carries no module tier. `SHIP_CONSTRUCTION_MODULES` is the only
 * place a module tier lives (the row's `habTier` is the HAB's, not the module's),
 * so a template name absent from that table is an unknown module -- not a default
 * tier 1.
 */
const MODULE_TIER_SOURCE_TABLE = 'module-table';
const MODULE_TIER_SOURCE_UNKNOWN = 'unknown-module-template';

/**
 * Resolves a yard's MODULE tier from its template name.
 *
 * Deliberately never reads `habTier`: that is the hab's tier, and putting it in
 * a build-time calculation would scale the wrong number. Returns the tier plus a
 * source string explaining how it was resolved, or null plus the reason it is
 * null when the template is not a known ship-construction module.
 */
function resolveModuleTier(templateName) {
  const module = SHIP_CONSTRUCTION_MODULES[templateName];
  if (!module) {
    return { moduleTier: null, moduleTierSource: MODULE_TIER_SOURCE_UNKNOWN };
  }
  return { moduleTier: module.tier, moduleTierSource: MODULE_TIER_SOURCE_TABLE };
}

/**
 * The observer's own yards, shaped for the read-model.
 *
 * A yard row is included only when it belongs to the observer. Each row carries
 * the module tier resolved from the template name, never the hab tier.
 * `factionId` is carried verbatim so a downstream check can verify the filter
 * itself; emitting a row without the identity it was filtered on is the same
 * defect class as a redaction that cannot be inspected.
 */
function buildShipyards(snapshot, observerId) {
  return asArray(snapshot?.shipyardStations)
    .filter(station => sameId(station.factionId, observerId))
    .map(station => {
      const { moduleTier, moduleTierSource } = resolveModuleTier(station.templateName);
      return {
        id: station.id ?? null,
        factionId: station.factionId ?? null,
        habName: station.habName ?? null,
        orbitBody: station.orbitBody ?? null,
        spaceTheaterKey: station.spaceTheaterKey ?? null,
        spaceTheaterName: station.spaceTheaterName ?? null,
        templateName: station.templateName ?? null,
        moduleTier,
        moduleTierSource
      };
    });
}

/**
 * One measured build option for a (body, hull): the fastest of the yards the
 * observer holds on that body, and how many yards were considered.
 */
function buildOptionsForBody(bodyName, yardsOnBody, snapshot, observerId, hullNames, options, refusals) {
  for (const hullName of hullNames) {
    let fastest = null;
    let yardsConsidered = 0;
    let firstRefusalReason = null;
    for (const yard of yardsOnBody) {
      yardsConsidered += 1;
      const result = shipBuildDaysFromSnapshot(snapshot, {
        hullName,
        shipyardId: yard.id,
        factionId: observerId
      });
      if (result.available === true) {
        if (fastest === null || result.days < fastest.days) {
          fastest = {
            days: result.days,
            shipyardId: yard.id,
            shipyardModuleTier: yard.moduleTier
          };
        }
      } else if (firstRefusalReason === null) {
        firstRefusalReason = result.reason ?? 'unmeasured-build-time';
      }
    }
    if (fastest !== null) {
      options.push({
        body: bodyName,
        spaceTheaterKey: yardsOnBody[0].spaceTheaterKey ?? null,
        hullName,
        fastestDays: fastest.days,
        shipyardId: fastest.shipyardId,
        shipyardModuleTier: fastest.shipyardModuleTier,
        yardsConsidered
      });
    } else {
      refusals.push({
        body: bodyName,
        hullName,
        reason: firstRefusalReason ?? 'no-observer-shipyard-on-body'
      });
    }
  }
}

/**
 * The build options and refusals for every (body, hull) the observer can attempt.
 *
 * A body enters only when the observer holds a yard there -- a body with no yard
 * is not a body they can build on. Each (body, hull) pair is one row: a
 * `buildOptions` row when at least one of those yards produces a measured build
 * time (taking the fastest), or a `buildRefusals` row when none of them can.
 * `fastestDays` is never null -- an unmeasured pair is a refusal, not a row with
 * a null day count.
 */
function buildOptionsAndRefusals(snapshot, observerId, shipyards) {
  const hullNames = Object.keys(snapshot?.shipHullStats ?? {});
  const byBody = new Map();
  for (const yard of shipyards) {
    const body = yard.orbitBody ?? null;
    if (body === null || body === undefined) continue;
    if (!byBody.has(body)) byBody.set(body, []);
    byBody.get(body).push(yard);
  }

  const options = [];
  const refusals = [];
  for (const [bodyName, yardsOnBody] of byBody) {
    buildOptionsForBody(bodyName, yardsOnBody, snapshot, observerId, hullNames, options, refusals);
  }
  return { buildOptions: options, buildRefusals: refusals };
}

/**
 * The alien-hate block.
 *
 * `actual` is the observer's raw hate reading. In player mode that reading is
 * redacted to null -- which is CORRECT, not a bug -- so `redacted` is true and
 * `actual` stays null. The threshold is the shared war threshold, and `floor` is
 * the measured minimum-hate floor from the hate economics block (null when that
 * block is absent, never a zero).
 */
function buildHate(snapshot, observerId) {
  const observer = asArray(snapshot?.factions).find(faction => sameId(faction.ID, observerId)) ?? null;
  const rawActual = observer?.alienHate?.actual ?? null;
  const actual = toFiniteNumber(rawActual);
  const economics = snapshot?.alienHateEconomics ?? null;
  const floor = economics ? toFiniteNumber(economics.minimumAlienHate) : null;
  return {
    actual,
    redacted: actual === null,
    threshold: ALIEN_HATE_WAR_THRESHOLD,
    floor
  };
}

/**
 * Rows requested from the fleet-engagement resource.
 *
 * `buildFleetEngagement` emits `items` CAPPED at `limit` (default
 * `DEFAULT_ENGAGEMENT_ROWS` = 12) and counts the remainder in
 * `fleetsOmittedCount`; the live save carries 59 alien fleets. Bucketing per
 * body off that capped slice would silently drop fleets and present a partial
 * opponent rating as a whole one -- the same defect class as fabricating the
 * rows it dropped. So every row is requested here, AND `buildTheaterForce`
 * still asserts `fleetsOmittedCount === 0` before reading them: if the resource
 * ever caps regardless of the request, every body reports unavailable with that
 * reason rather than a rating composed from part of the board.
 */
const ENGAGEMENT_ROW_REQUEST = Number.MAX_SAFE_INTEGER;

/**
 * "<Body> Orbit" and "<Body>" are one place.
 *
 * `shared/fleetEngagement.mjs` unifies the two spellings with this same rule
 * (its private `bodyKey`), and the ratings bucketed here come from that module,
 * so the two must agree about where a fleet is.
 *
 * This deliberately differs from `theaters[].friendly.ships` /
 * `theaters[].hostile.ships`, which match on `normalizeBody` alone: measured on
 * the live save 2026-08-27, that leaves one observer hull and one alien hull
 * parked at "Earth Orbit" outside the Earth row. Under-reporting a hostile hull
 * at a body is the dangerous direction for a threat display, so this surface
 * counts it -- and this comment records the divergence rather than leaving a
 * reader to find it as an unexplained off-by-one.
 */
const ORBIT_SUFFIX = /\s+orbit$/i;
const theaterBodyKey = (value) => normalizeBody(String(value ?? '').replace(ORBIT_SUFFIX, ''));

/** Zero force present is a reading; it is not a failure to measure one. */
const OWN_FORCE_NONE_PRESENT =
  'no observer fleet is present at this body, so there is no own force here to rate';
const OPPONENT_FORCE_NONE_OBSERVED =
  'no hostile fleet is observed at this body in this intelligence picture. That is not a statement that '
  + 'none exists -- only that none is observed here';

/**
 * How the own side is rated, in the words the row reports.
 *
 * The optimism is named because it is real and it runs in the reassuring
 * direction: the engagement model asks how many of the observer's BEST hull an
 * engagement takes, and the observer fields a mix.
 */
const ownForceSource = (ratingSource) =>
  `${ratingSource || 'the observer\'s own-side rating as carried by shared/fleetEngagement.mjs'}, applied `
  + 'to every observer hull present at this body -- the same convention the hull requirement in '
  + 'shared/fleetEngagement.mjs uses, and an OPTIMISTIC one: the observer fields a mix of designs, not N '
  + 'copies of its best. Counts force PRESENT at this body only.';

const OPPONENT_FORCE_SOURCE =
  'the sum of the per-fleet opponent ratings composed by shared/fleetEngagement.mjs for the hostile fleets '
  + 'orbiting this body. Counts force PRESENT at this body only: a fleet under way to it is counted where '
  + 'it currently orbits, not here -- what is inbound is carried per fleet, with days remaining, in '
  + 'theaters[].incoming.';

/**
 * Per-body force ratings, composed from the fleet-engagement resource.
 *
 * A PURE function of that resource's PUBLIC return value plus the board's body
 * list. It never re-derives a rating: `readOwnForce` and `composeFleetRating`
 * are private to `shared/fleetEngagement.mjs`, and a second copy of the rating
 * rule is exactly the drift this repo keeps paying for.
 *
 * WHAT A ROW MEANS. Force PRESENT at the body, on both sides. A hostile fleet
 * under way is counted at the body it currently orbits, never at its
 * destination: a row carries no arrival date, so folding a fleet 362 days out
 * into "the force at Callisto" would report as present something that is not.
 * What is on the way is already modelled next door, per fleet and with days
 * remaining, in `theaters[].incoming`.
 *
 * WHAT A ROW IS NOT. Not a measurement -- `isEstimate` is true on every row,
 * carried from a resource whose own comment forbids any consumer rendering a
 * band as one. And not a hull count: `calibrated` is false wherever the alien
 * ratings are scaled off the observer's own best hull by invented constants,
 * which is every mode but omniscient. The gate that turns a rating into
 * "build N" belongs in the consumer, not here.
 *
 * WHICH BASIS. Two live in this repo and they are NOT interchangeable.
 * `OPPONENT_RATING_BASIS` (shared/engagementModel.mjs, read by
 * server/commentary/simulation.js) anchors the player view on ARMOUR, and that
 * anchor is the one measured to under-rate a fleet by 5.5x -- which is why
 * shared/fleetEngagement.mjs rejected it. What is carried here is
 * `COMPOSITION_BASIS` from that module, anchored on observed WEAPON SYSTEMS,
 * whose measured ratio never fell below 0.81x on the same save. Both are
 * assumptions and neither is calibrated; quoting the wrong one beside this
 * number would mis-state its error and its direction. docs/theater-defence-
 * engagement-spec.md quotes the older armour basis and predates that change.
 *
 * NO DEFAULT RATING. A body whose rating cannot be composed reports null with a
 * named reason. `runMonteCarloSimulation`'s `ownRating = 5000` fallback is not
 * reintroduced here under any name, and an unrateable body is never a zero.
 */
function buildTheaterForce(engagement, bodies) {
  const bodyList = asArray(bodies);

  // The basis is carried VERBATIM. When the resource produced no reading there
  // is no basis on it to copy, so the mode's own frozen constant is used -- the
  // same string object, never a restatement of it.
  const modeKey = engagement?.mode === 'omniscient' ? 'omniscient' : 'player';
  const basis = engagement?.compositionModel?.basis ?? COMPOSITION_BASIS[modeKey];
  // True ONLY where the alien ratings are read from the aliens' own designs.
  // Derived from the basis actually used rather than by re-deciding the rule,
  // so `calibrated` cannot drift away from the string printed beside it.
  const calibrated = basis === COMPOSITION_BASIS.omniscient;

  const unavailableRow = (body, reason) => ({
    body,
    own: { rating: null, ratedShips: 0, unratedShips: 0, source: null },
    opponent: { rating: null, ratedShips: 0, unratedShips: 0, source: null, basis },
    calibrated,
    isEstimate: true,
    available: false,
    unavailableReason: reason
  });

  if (!engagement || engagement.available !== true) {
    const reason = engagement && engagement.reason
      ? `force ratings unavailable: ${engagement.reason}`
      : 'force ratings unavailable: the fleet-engagement resource produced no reading';
    return bodyList.map(body => unavailableRow(body, reason));
  }

  // THE TRAP, guarded. An absent omitted-count is not a zero one: a check that
  // cannot be evaluated must say so rather than fall through to the reassuring
  // answer, so `null` refuses here exactly as a positive count does.
  const omitted = toFiniteNumber(engagement.fleetsOmittedCount);
  if (omitted !== 0) {
    const total = toFiniteNumber(engagement.fleetsTotalCount);
    return bodyList.map(body => unavailableRow(body,
      'force ratings unavailable: the fleet-engagement resource reported '
      + `${omitted === null ? 'no omitted-fleet count' : `${omitted} omitted fleet(s)`} against a total of `
      + `${total === null ? 'an unstated number of' : total} fleets, so an opponent rating bucketed from its `
      + 'emitted rows would be composed from part of the board and presented as the whole of it'));
  }

  const perHullRating = toFiniteNumber(engagement.ownForce?.rating);
  if (perHullRating === null) {
    return bodyList.map(body => unavailableRow(body,
      'force ratings unavailable: the fleet-engagement resource carries no own-side rating, so there is '
      + 'nothing to rate the observer\'s hulls at. No default rating is substituted.'));
  }

  // A fleet whose complement the snapshot does not carry cannot be counted, and
  // an uncounted ship cannot be expressed as `unratedShips` either -- how many
  // there are is precisely what is unknown. Those bodies report unavailable
  // rather than rating the countable part and letting it read as the whole.
  const ownByBody = new Map();
  for (const fleet of asArray(engagement.ownForce?.fleets)) {
    const key = theaterBodyKey(fleet?.orbitBody);
    if (!key) continue;
    const entry = ownByBody.get(key) ?? { ships: 0, uncountableFleets: 0 };
    const ships = toFiniteNumber(fleet?.shipsCount);
    if (ships === null) entry.uncountableFleets += 1;
    else entry.ships += ships;
    ownByBody.set(key, entry);
  }

  const opponentByBody = new Map();
  for (const row of asArray(engagement.items)) {
    const key = theaterBodyKey(row?.orbitBody);
    if (!key) continue;
    const entry = opponentByBody.get(key)
      ?? { fleets: 0, ratedFleets: 0, rating: 0, ratedShips: 0, unratedShips: 0, uncountableFleets: 0 };
    entry.fleets += 1;
    opponentByBody.set(key, entry);

    const declared = toFiniteNumber(row?.shipsCount);
    const rated = toFiniteNumber(row?.composition?.ratedShips);
    const unrated = toFiniteNumber(row?.composition?.unratedShips);
    if (declared === null || rated === null || unrated === null) {
      entry.uncountableFleets += 1;
      continue;
    }

    entry.ratedShips += rated;
    // Ships the fleet DECLARES but carries no per-ship detail for were never
    // offered to the rating, so they are unrated too. `shipsCount` upstream is
    // already the larger of the declared count and the carried ship list, so
    // this term is never negative.
    entry.unratedShips += unrated + Math.max(0, declared - (rated + unrated));

    const fleetRating = toFiniteNumber(row?.composition?.opponentRating);
    if (fleetRating !== null && rated > 0) {
      entry.rating += fleetRating;
      entry.ratedFleets += 1;
    }
  }

  return bodyList.map(body => {
    const key = theaterBodyKey(body);
    const own = ownByBody.get(key) ?? { ships: 0, uncountableFleets: 0 };
    const opponent = opponentByBody.get(key)
      ?? { fleets: 0, ratedFleets: 0, rating: 0, ratedShips: 0, unratedShips: 0, uncountableFleets: 0 };

    const reasons = [];

    let ownRating = null;
    let ownSource = OWN_FORCE_NONE_PRESENT;
    if (own.uncountableFleets > 0) {
      reasons.push(`${own.uncountableFleets} observer fleet(s) at ${body} carry no ship complement in this `
        + 'snapshot, so the force present cannot be counted and any rating formed here would be a floor of '
        + 'unknown depth');
      ownSource = 'not composed: at least one observer fleet at this body carries no ship count';
    } else if (own.ships > 0) {
      ownRating = round(perHullRating * own.ships, 1);
      ownSource = ownForceSource(engagement.ownForce?.ratingSource);
    }

    let opponentRating = null;
    let opponentSource = OPPONENT_FORCE_NONE_OBSERVED;
    if (opponent.uncountableFleets > 0) {
      reasons.push(`${opponent.uncountableFleets} hostile fleet(s) at ${body} carry no countable ship `
        + 'complement, so the opposing force present cannot be composed');
      opponentSource = 'not composed: at least one hostile fleet at this body carries no countable ship '
        + 'complement';
    } else if (opponent.fleets > 0 && opponent.ratedFleets === 0) {
      reasons.push(`no ship in the ${opponent.fleets} hostile fleet(s) at ${body} could be rated, so no `
        + 'opposing force rating was formed');
      opponentSource = 'not composed: no ship in the hostile fleet(s) at this body could be rated';
    } else if (opponent.ratedFleets > 0) {
      opponentRating = round(opponent.rating, 1);
      opponentSource = OPPONENT_FORCE_SOURCE;
    }

    return {
      body,
      own: {
        rating: ownRating,
        // "Rated" means folded into the rating beside it. Where no rating was
        // formed, the ships that were counted are reported as UNRATED rather
        // than credited to a number that does not exist.
        ratedShips: ownRating === null ? 0 : own.ships,
        unratedShips: ownRating === null ? own.ships : 0,
        source: ownSource
      },
      opponent: {
        rating: opponentRating,
        ratedShips: opponentRating === null ? 0 : opponent.ratedShips,
        unratedShips: opponentRating === null
          ? opponent.ratedShips + opponent.unratedShips
          : opponent.unratedShips,
        source: opponentSource,
        // VERBATIM from the composition model. A rating whose basis is
        // paraphrased is a rating whose provenance has been edited.
        basis
      },
      calibrated,
      // Carried from the source. The whole surface is an estimate and no
      // consumer may render it as a measurement.
      isEstimate: true,
      available: reasons.length === 0,
      unavailableReason: reasons.length === 0 ? null : reasons.join('; ')
    };
  });
}

/**
 * The fleet-engagement resource for this snapshot, or an unavailable stand-in.
 *
 * Wrapped because `buildTheaterForce` is an addition to a read-model the
 * directive engine already depends on: a throw inside the engagement resource
 * must cost the board its force ratings, not its shipyards and build options.
 * The mode is read the way `server/briefingGenerator.js` and
 * `server/commentary/facts.js` already read it -- player mode composes alien
 * ratings by a different rule, so guessing it wrong would silently swap the
 * model.
 */
function readEngagement(snapshot, observerId) {
  // Seeded with the mode that claims the LESS: an unreadable mode must not
  // leave a refusal row labelled `calibrated: true`.
  let mode = 'player';
  try {
    mode = snapshot?.mode || (snapshot?.isOmniscient ? 'omniscient' : 'player');
    return buildFleetEngagement(snapshot, { observerId, mode, limit: ENGAGEMENT_ROW_REQUEST });
  } catch (error) {
    return {
      available: false,
      mode,
      reason: `the fleet-engagement resource threw: ${error && error.message ? error.message : String(error)}`
    };
  }
}

/**
 * Assembles the whole military read-model for one observer.
 *
 * `available` is false only when the theater board itself could not be built at
 * all -- everything downstream of that board is then `null` rather than a
 * plausible-looking mock. A missing theater board is the one case the model has
 * nothing to say; every other absent measurement is expressed inside the shape
 * (null hate, refusal rows) rather than by toggling `available`.
 */
function buildMilitaryWorld(snapshot, observerId) {
  let board;
  try {
    board = theaterBoardResource(snapshot, observerId);
  } catch (error) {
    return Object.freeze({
      available: false,
      unavailableReason: `military-board-unavailable: ${error && error.message ? error.message : String(error)}`,
      hostileMovement: null,
      theaters: null,
      shipyards: [],
      buildOptions: [],
      buildRefusals: [],
      // No board means no bodies, so there is no row to report a force for.
      // An empty list here is the absence of theaters, not a claim that every
      // theater is empty.
      theaterForce: [],
      hate: Object.freeze({
        actual: null,
        redacted: true,
        threshold: ALIEN_HATE_WAR_THRESHOLD,
        floor: null
      })
    });
  }

  const shipyards = buildShipyards(snapshot, observerId);
  const { buildOptions, buildRefusals } = buildOptionsAndRefusals(snapshot, observerId, shipyards);

  return Object.freeze({
    available: true,
    unavailableReason: null,
    hostileMovement: board.hostileMovement,
    theaters: board.theaters,
    shipyards,
    buildOptions,
    buildRefusals,
    // Row-for-row aligned with `theaters` by construction: the body list comes
    // from the board itself, so the two arrays can never disagree about which
    // twelve bodies exist or in what order.
    theaterForce: buildTheaterForce(readEngagement(snapshot, observerId), board.theaters.map(t => t.body)),
    hate: buildHate(snapshot, observerId)
  });
}

module.exports = {
  buildMilitaryWorld,
  buildTheaterForce,
  resolveModuleTier,
  MODULE_TIER_SOURCE_TABLE,
  MODULE_TIER_SOURCE_UNKNOWN
};
