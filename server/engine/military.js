/**
 * server/engine/military.js
 * Purpose: the military read-model — assemble the observer's military facts into
 *   a `world.military` block the directive engine can reason over.
 *
 * The directive engine is entirely councilor-facing: it had no view of inbound
 * alien fleets, the observer's shipyards, or the hulls those yards could field
 * before a threat arrived. This module is that view. It is a READ-MODEL ONLY --
 * it produces no recommendations. It assembles four facts:
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
const { shipBuildDaysFromSnapshot, SHIP_CONSTRUCTION_MODULES } = require('../../shared/shipBuildTime.mjs');
const { ALIEN_HATE_WAR_THRESHOLD } = require('../../shared/alienHateEconomics.mjs');
const { asArray, sameId, toFiniteNumber } = require('../../shared/util.mjs');

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
    hate: buildHate(snapshot, observerId)
  });
}

module.exports = {
  buildMilitaryWorld,
  resolveModuleTier,
  MODULE_TIER_SOURCE_TABLE,
  MODULE_TIER_SOURCE_UNKNOWN
};
