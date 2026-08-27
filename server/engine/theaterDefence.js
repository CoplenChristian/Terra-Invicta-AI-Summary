/**
 * server/engine/theaterDefence.js
 * Purpose: the theater-defence block — build, reinforce or withdraw at each
 *   threatened body, and an explicit refusal wherever a reading the verdict
 *   depends on is absent.
 *
 * The advisor could recommend councilor missions and nothing else. It could not
 * say "a 105-ship alien fleet reaches Mercury in 57 days, you have 30 ships
 * there, and the fastest hull your Mercury yards can lay down lands 48 days
 * before it arrives -- start now, or move them out." This block is that
 * sentence, produced from `world.military` (server/engine/military.js).
 *
 * A SIBLING BLOCK, NOT A SIXTH CANDIDATE FAMILY
 * ---------------------------------------------
 * `theaterDefence` hangs off the engine result beside `cyclePlan`; it is never
 * pushed through the candidate pipeline. Three reasons, none of them stylistic:
 *
 *   1. Every candidate ends up in `allocateCyclePlan(scored, councilors, world)`
 *      which pairs candidate x councilor. A build order has no councilor.
 *   2. `applyRules` keys every rule's `appliesTo` off `CANDIDATE_FAMILIES` in
 *      candidates/normalize.js -- five families, all councilor-facing. A sixth
 *      means auditing every predicate in a registry whose ORDER IS LOAD-BEARING:
 *      `applyRules` and `scoreCandidates` emit in registry order, so reshuffling
 *      it silently reorders every explanation a reader sees.
 *   3. The odds layer, the hate envelope and `missionSpec` are all inapplicable
 *      to a hull.
 *
 * `server/directives/holdGround.js` is the precedent: the same decision, built
 * beside the engine rather than through it.
 *
 * WHAT THIS BLOCK DOES NOT CLAIM
 * ------------------------------
 * It does NOT say whether the force at a body could win. Converting an opposing
 * force into a required hull count is `shared/engagementModel.mjs`'s job, and
 * that model answers with a p20-p80 band whose `winnable: false` means "above
 * the ceiling I swept", never "cannot be won" (engagementModel.mjs line 58).
 * Defect #13 in docs/live-defect-register.md exists because a consumer rendered
 * that band as though it were the whole uncertainty. Carrying the band cleanly
 * is more than this block holds, so the conversion is OMITTED ENTIRELY and said
 * so in `notes` -- an absent comparison is honest; a confident one that dropped
 * its uncertainty is not.
 *
 * It also makes NO hate-based inference. "Hate is 25, so this fleet is probably
 * not aimed at you" is deliberately unimplemented and recorded in `notes`: it is
 * the one inference that can tell a player they are safe.
 *
 * THE REFUSALS ARE THE POINT, NOT THE EDGE CASE
 * ---------------------------------------------
 * A finding is `CANNOT_ADVISE` with populated `refusals` whenever a reading the
 * verdict rests on is absent:
 *
 *   * An inbound force with no arrival date -- the imminence test cannot be run.
 *     AN UNKNOWN ARRIVAL IS NOT A DISTANT ONE. This file's ancestor carried
 *     `UNKNOWN_ARRIVAL_SORT_DAYS = 999`, documented as sort-only, and it fed a
 *     *reported* arrival figure until it was deleted. No stand-in for a missing
 *     number exists here under any name.
 *   * Yards at the body but no measured build time from any of them -- the race
 *     is unevaluable, and the honest output is "cannot advise: build time
 *     unknown", never a confident "build it". An unknown build time is never
 *     defaulted to zero, to "fast", or to the arrival date.
 *   * `hostileMovement.reconciles === false` -- the buckets do not partition the
 *     observed set, so no count taken from them is trustworthy and every finding
 *     says so.
 *
 * NO YARD HERE IS A MEASUREMENT; NO MEASURED BUILD TIME IS NOT
 * -----------------------------------------------------------
 * These two are deliberately NOT collapsed. A body where the observer holds no
 * shipyard has a measured build capacity of none -- "you cannot build here" is a
 * fact, and reinforcing or withdrawing is still advisable. A body where the
 * observer holds twelve yards and none of them produced a measured build time
 * has an ABSENT reading, and nothing about the race can be said. Rendering the
 * second as the first would be an unevaluable check reporting a confident
 * answer, which is the failure mode this repo keeps re-fixing.
 *
 * YARD-TO-THEATER MATCHING USES THE BOARD'S OWN RULE
 * -------------------------------------------------
 * A build option is matched to a theater with `normalizeBody`, exactly the
 * predicate `theaterBoardResource` uses for `friendly.shipyards`. That keeps a
 * finding's yard count and its build race derived from the same set of yards. It
 * also means a yard filed under a body name the twelve-body board does not track
 * is NOT folded into a theater it was never counted in -- on the live save that
 * is 18 yards at "Earth Orbit", 1 at "34 Circe" and 1 at "2 Pallas". Those are
 * reported in `notes` rather than silently attached to Earth or dropped.
 *
 * Pure module: no I/O, no network, no filesystem. CommonJS, like its siblings in
 * server/engine/.
 */

const { HOSTILE_MOVEMENT_STATE } = require('../../shared/intel/theaters.mjs');
const { normalizeBody } = require('../../shared/intel/common.mjs');
const { buildBeatsArrival } = require('../../shared/shipBuildTime.mjs');
const { asArray, toFiniteNumber } = require('../../shared/util.mjs');

/**
 * The five postures. `CANNOT_ADVISE` is not a failure mode of the other four --
 * it is the answer whenever the reading a posture would rest on is absent.
 */
const THEATER_POSTURE = Object.freeze({
  reinforce: 'REINFORCE',
  build: 'BUILD',
  withdraw: 'WITHDRAW',
  hold: 'HOLD',
  cannotAdvise: 'CANNOT_ADVISE'
});

/** Named checks, so a refusal says WHICH test could not be run. */
const DEFENCE_CHECKS = Object.freeze({
  hostileCounts: 'hostile-movement-counts',
  imminence: 'threat-imminence',
  buildRace: 'build-race'
});

/**
 * Cap on the emitted findings, with the omitted count reported beside it.
 * The board is twelve bodies, so this has never fired; it exists because a
 * capped list that does not announce its cap is the same defect class as
 * fabricating the entries it dropped.
 */
const THEATER_DEFENCE_FINDING_LIMIT = 12;

/**
 * Urgency order, taken from the board's OWN status ladder rather than invented
 * a second time here. `THREAT_INBOUND_ARRIVAL_UNKNOWN` outranks `CONTESTED`
 * for the same reason it does there: it is the case where the imminence test
 * cannot be run at all.
 */
const STATUS_RANK = Object.freeze({
  THREAT_IMMINENT: 0,
  THREAT_INBOUND_ARRIVAL_UNKNOWN: 1,
  CONTESTED: 2,
  SECURE: 3,
  UNCONTESTED: 4
});

const NOTE_NO_FORCE_COMPARISON =
  'No force-strength comparison is made here. These postures rest on the production race and on '
  + 'what is present at each body -- NOT on whether the force there could win. Converting an '
  + 'opposing force into a required hull count is shared/engagementModel.mjs, whose answer is a '
  + 'p20-p80 band and whose `winnable: false` means "above the ceiling I swept", never "cannot be '
  + 'won"; carrying that band through is a separate task, and an absent comparison is honest where '
  + 'a confident one that dropped its uncertainty is not (docs/live-defect-register.md #13).';

const NOTE_NO_HATE_INFERENCE =
  'No hate-based inference is made here. "Hate is low, so this fleet is probably not aimed at you" '
  + 'is deliberately unimplemented: it is the one inference that can tell a player they are safe, '
  + 'and it is a separate task. `world.military.hate` is read by nothing in this block.';

const NOTE_FASTEST_HULL =
  'The build race is run against the FASTEST hull each body\'s own yards can lay down, which is not '
  + 'necessarily the most useful one. It answers "can production at this body change the board '
  + 'before contact at all", and the hull it used is named on every race row.';

/** Absent stays null: a count is a number or it is nothing. Never `Number(x)`. */
const countOrNull = (value) => toFiniteNumber(value);

/** A body name that cannot key a finding is not turned into the string "undefined". */
const findingIdFor = (body) => `theater-defence:${normalizeBody(body).replace(/\s+/g, '-')}`;

/**
 * The fastest measured build option among the observer's own yards at one body.
 *
 * Ties break on hull name so the row is stable across runs. Returns null when
 * no option at that body carries a measured day count -- there is no "fastest"
 * among nothing, and inventing one is the bug this whole block guards.
 */
function fastestBuildOptionAt(buildOptions, body) {
  const key = normalizeBody(body);
  let best = null;
  for (const option of buildOptions) {
    if (normalizeBody(option?.body) !== key) continue;
    const days = countOrNull(option?.fastestDays);
    if (days === null) continue;
    if (best === null || days < best.days
      || (days === best.days && String(option.hullName) < String(best.option.hullName))) {
      best = { days, option };
    }
  }
  return best;
}

/** Every refusal the military model recorded for one body, deduplicated by reason. */
function refusalReasonsAt(buildRefusals, body) {
  const key = normalizeBody(body);
  const reasons = new Set();
  for (const refusal of buildRefusals) {
    if (normalizeBody(refusal?.body) !== key) continue;
    if (refusal?.reason) reasons.add(String(refusal.reason));
  }
  return [...reasons];
}

/** How many of the observer's own yards sit at one body, by the board's own rule. */
function yardsAt(shipyards, body) {
  const key = normalizeBody(body);
  return shipyards.filter(yard => normalizeBody(yard?.orbitBody) === key);
}

/**
 * Decides the posture from readings that are already present-or-null.
 *
 * Order matters and is the whole discipline: every unevaluable check is taken
 * BEFORE any check that would produce a reassuring answer, so an absent reading
 * can never fall through to "fine".
 */
function decidePosture({ reconciles, inbound, arrivalDays, race, yardCount, ships, fixedAssets }) {
  if (reconciles === false) return THEATER_POSTURE.cannotAdvise;
  if (inbound === null) return THEATER_POSTURE.cannotAdvise;
  if (inbound && arrivalDays === null) return THEATER_POSTURE.cannotAdvise;
  // Yards here, but not one of them produced a measured build time: the race is
  // unevaluable. A body with NO yard is a different thing -- that is a measured
  // "you cannot build here" and falls through to the presence tests below.
  if (inbound && race === null && yardCount > 0) return THEATER_POSTURE.cannotAdvise;
  if (inbound && race !== null && race.available !== true) return THEATER_POSTURE.cannotAdvise;
  if (inbound && race !== null && race.verdict === 'build-lands-first') return THEATER_POSTURE.build;
  if (inbound) {
    // Nothing this body can lay down lands before contact. The force present at
    // contact is the force present now.
    if (ships !== null && ships > 0) return THEATER_POSTURE.withdraw;
    if (fixedAssets !== null && fixedAssets > 0) return THEATER_POSTURE.reinforce;
    return THEATER_POSTURE.hold;
  }
  // Nothing inbound: a hostile force is already in the theater and no arrival
  // clock applies, so there is no production race to run.
  if ((ships === null || ships === 0) && fixedAssets !== null && fixedAssets > 0) {
    return THEATER_POSTURE.reinforce;
  }
  return THEATER_POSTURE.hold;
}

/** One finding for one theater. Returns null when the theater is not at issue. */
function buildFinding(theater, military, reconciles) {
  const incoming = theater?.incoming ?? {};
  const hostile = theater?.hostile ?? {};
  const friendly = theater?.friendly ?? {};
  const production = theater?.production ?? {};

  const inboundFleets = countOrNull(incoming.hostileFleets);
  const presentHostileShips = countOrNull(hostile.ships);
  const presentHostileFleets = countOrNull(hostile.fleets);

  // A theater is at issue when a hostile force is inbound or already there. A
  // null fleet count is "at issue" too: an unreadable count is not a zero.
  const atIssue = inboundFleets === null || inboundFleets > 0
    || presentHostileShips === null || presentHostileShips > 0;
  if (!atIssue) return null;

  const body = theater?.body;
  if (!body || String(body).trim() === '') return null;

  const arrivalDays = countOrNull(incoming.nearestArrivalDays);
  const inbound = inboundFleets === null ? null : inboundFleets > 0;

  const yards = yardsAt(military.shipyards, body);
  const spaceTheaterKey = yards.find(yard => yard?.spaceTheaterKey)?.spaceTheaterKey ?? null;
  const fastest = inbound === true ? fastestBuildOptionAt(military.buildOptions, body) : null;

  const citations = [
    { source: 'intel/theaters', field: 'incoming.hostileShips' },
    { source: 'intel/theaters', field: 'incoming.hostileFleets' },
    { source: 'intel/theaters', field: 'incoming.nearestArrivalDays' },
    { source: 'intel/theaters', field: 'incoming.arrivalTimingKnown' },
    { source: 'intel/theaters', field: 'hostile.ships' },
    { source: 'intel/theaters', field: 'friendly.ships' },
    { source: 'intel/theaters', field: 'friendly.shipyards' },
    { source: 'intel/theaters', field: 'production.shipsCompletingBeforeThreatArrival' },
    { source: 'intel/theaters', field: 'hostileMovement.reconciles' }
  ];
  const refusals = [];

  if (reconciles === false) {
    refusals.push({
      check: DEFENCE_CHECKS.hostileCounts,
      reason: 'the toward/elsewhere/unresolved buckets do not partition the observed hostile '
        + 'transfers, so no count taken from them is trustworthy'
    });
  }
  if (inboundFleets === null) {
    refusals.push({
      check: DEFENCE_CHECKS.hostileCounts,
      reason: 'the inbound hostile fleet count is not on record for this body; an unreadable count '
        + 'is not a zero'
    });
  }
  if (inbound === true && arrivalDays === null) {
    refusals.push({
      check: DEFENCE_CHECKS.imminence,
      reason: `${inboundFleets} inbound hostile fleet(s) carry no arrival date on record, so the `
        + 'imminence test cannot be run -- an unknown arrival is not a distant one'
    });
  }

  let buildRace = null;
  if (fastest !== null && arrivalDays !== null) {
    buildRace = {
      hullName: fastest.option.hullName ?? null,
      shipyardId: fastest.option.shipyardId ?? null,
      ...buildBeatsArrival({ buildDays: fastest.days, daysUntilArrival: arrivalDays })
    };
    citations.push({ source: 'engine/military', field: 'buildOptions[].fastestDays' });
    citations.push({ source: 'engine/military', field: 'buildOptions[].shipyardId' });
    citations.push({ source: 'shared/shipBuildTime', field: 'buildBeatsArrival.verdict' });
    if (buildRace.available !== true) {
      refusals.push({
        check: DEFENCE_CHECKS.buildRace,
        reason: `the build race could not be run: ${buildRace.reason ?? 'reason not recorded'}`
      });
    }
  } else if (inbound === true && arrivalDays !== null) {
    // buildRace stays null. Which of the two reasons applies is the distinction
    // between a measured absence and an absent measurement, so it is named.
    const reasons = refusalReasonsAt(military.buildRefusals, body);
    refusals.push({
      check: DEFENCE_CHECKS.buildRace,
      reason: yards.length === 0
        ? `the observer holds no shipyard at ${body}, so no hull can be laid down here -- a `
          + 'measured absence of build capacity, not an unmeasured build time'
        : `the observer holds ${yards.length} yard(s) at ${body} but none produced a measured build `
          + `time for any hull (${reasons.length > 0 ? reasons.join(', ') : 'no reason recorded'}); `
          + 'an unknown build time makes the comparison unevaluable'
    });
    citations.push({ source: 'engine/military', field: 'buildRefusals[].reason' });
  }

  const ships = countOrNull(friendly.ships);
  const habs = countOrNull(friendly.habs);
  const shipyardCount = countOrNull(friendly.shipyards);
  const mines = countOrNull(friendly.mines);
  const fixedParts = [habs, shipyardCount, mines].filter(value => value !== null);
  // Absent stays null: with no readable holding count there is no "0 assets".
  const fixedAssets = fixedParts.length === 0
    ? null
    : fixedParts.reduce((sum, value) => sum + value, 0);

  const posture = decidePosture({
    reconciles,
    inbound,
    arrivalDays,
    race: buildRace,
    yardCount: yards.length,
    ships,
    fixedAssets
  });

  return {
    id: findingIdFor(body),
    body,
    spaceTheaterKey,
    // The board's own status, carried so the emitted order below is auditable
    // rather than asserted.
    theaterStatus: theater?.status ?? null,
    posture,
    threat: {
      hostileShips: countOrNull(incoming.hostileShips),
      hostileFleets: inboundFleets,
      // The force already in this theater, as opposed to the force under way to
      // it. REINFORCE and HOLD are decided off these, so they are on the row.
      presentHostileShips,
      presentHostileFleets,
      nearestArrivalDays: arrivalDays,
      nearestArrivalDate: incoming.nearestArrivalDate ?? null,
      // Carried verbatim from the board, which reports null -- not false -- when
      // nothing is inbound: there is no timing to know. A fabricated `false`
      // there would read as "the arrival time is unknown".
      arrivalTimingKnown: incoming.arrivalTimingKnown ?? null
    },
    friendly: {
      ships,
      shipyards: shipyardCount,
      habs,
      mines,
      shipsCompletingBeforeThreatArrival: countOrNull(production.shipsCompletingBeforeThreatArrival),
      completionBasis: production.shipsCompletingBeforeThreatArrivalBasis ?? null
    },
    buildRace,
    refusals,
    citations
  };
}

/** Hostile movement aimed somewhere this twelve-body board does not answer for. */
function buildOffBoardNote(hostileMovement) {
  const unresolved = hostileMovement?.unresolvedDestinations ?? null;
  const elsewhere = hostileMovement?.towardUntrackedBodies ?? null;
  const omitted = countOrNull(hostileMovement?.offBoardDestinationsOmittedCount);
  const parts = [];

  if (unresolved && countOrNull(unresolved.transfers) > 0) {
    parts.push(`${unresolved.transfers} hostile transfer(s) carrying ${unresolved.ships} ship(s) `
      + 'could not be resolved to a destination -- with an unresolved destination in the set, '
      + '"none of it is coming here" is not a claim this data supports');
  } else if (hostileMovement?.state === HOSTILE_MOVEMENT_STATE.partlyUnresolved) {
    // The state says destinations went unresolved while the bucket says none did.
    // Reporting the reassuring half would be exactly backwards.
    parts.push('the hostile-movement summary reports unresolved destinations while its unresolved '
      + 'bucket is empty; some destinations did not resolve and the counts disagree');
  }
  if (elsewhere && countOrNull(elsewhere.transfers) > 0) {
    parts.push(`${elsewhere.transfers} hostile transfer(s) carrying ${elsewhere.ships} ship(s) are `
      + 'aimed at bodies this twelve-body board does not track');
  }
  if (omitted !== null && omitted > 0) {
    parts.push(`${omitted} off-board destination row(s) were omitted by the board's own cap`);
  }
  if (parts.length === 0) return null;
  return `${parts.join('; ')}.`;
}

/** The unavailable shape. Never mock findings -- an empty board that says why. */
function unavailable(reason) {
  return {
    available: false,
    unavailableReason: reason,
    state: null,
    findings: [],
    findingsTotalCount: 0,
    findingsOmittedCount: 0,
    offBoardNote: null,
    notes: [NOTE_NO_FORCE_COMPARISON, NOTE_NO_HATE_INFERENCE]
  };
}

/**
 * The theater-defence block for one frozen world.
 *
 * Reads `world.military` and nothing else, so it runs identically in the engine,
 * in tests and against a snapshot loaded straight off disk.
 */
function buildTheaterDefence(world) {
  const military = world?.military ?? null;
  if (!military) return unavailable('world.military was not supplied');
  if (military.available !== true) {
    return unavailable(military.unavailableReason
      ? `world.military is unavailable: ${military.unavailableReason}`
      : 'world.military reports itself unavailable');
  }
  const theaters = asArray(military.theaters);
  if (theaters.length === 0) {
    return unavailable('world.military carries no theater board');
  }

  const hostileMovement = military.hostileMovement ?? null;
  const reconciles = hostileMovement?.reconciles === undefined ? null : hostileMovement.reconciles;
  const model = {
    shipyards: asArray(military.shipyards),
    buildOptions: asArray(military.buildOptions),
    buildRefusals: asArray(military.buildRefusals)
  };

  const all = theaters
    .map(theater => buildFinding(theater, model, reconciles))
    .filter(finding => finding !== null)
    .sort((a, b) => {
      const rankDelta = (STATUS_RANK[a.theaterStatus] ?? 5) - (STATUS_RANK[b.theaterStatus] ?? 5);
      if (rankDelta !== 0) return rankDelta;
      // Soonest measured arrival first, unknown arrivals last -- written as an
      // explicit null-last comparator, never by substituting a large stand-in.
      const left = a.threat.nearestArrivalDays;
      const right = b.threat.nearestArrivalDays;
      if (left !== null && right !== null && left !== right) return left - right;
      if (left === null && right !== null) return 1;
      if (right === null && left !== null) return -1;
      return String(a.body).localeCompare(String(b.body));
    });

  const findings = all.slice(0, THEATER_DEFENCE_FINDING_LIMIT);

  const notes = [NOTE_NO_FORCE_COMPARISON, NOTE_NO_HATE_INFERENCE];
  if (findings.some(finding => finding.buildRace !== null)) notes.push(NOTE_FASTEST_HULL);
  if (reconciles === false) {
    notes.push('The hostile-movement buckets do not partition the observed set '
      + '(`hostileMovement.reconciles === false`), so no count derived from them is trustworthy and '
      + 'every finding below carries that refusal.');
  } else if (reconciles === null) {
    notes.push('The hostile-movement summary carried no `reconciles` flag, so whether its buckets '
      + 'partition the observed set could not be checked.');
  }

  const trackedKeys = new Set(theaters.map(theater => normalizeBody(theater?.body)));
  const untrackedYards = model.shipyards.filter(
    yard => !trackedKeys.has(normalizeBody(yard?.orbitBody))
  );
  if (untrackedYards.length > 0) {
    const byBody = new Map();
    for (const yard of untrackedYards) {
      const name = yard?.orbitBody ?? 'an unrecorded body';
      byBody.set(name, (byBody.get(name) ?? 0) + 1);
    }
    const listed = [...byBody.entries()].map(([name, count]) => `${count} at ${name}`).join(', ');
    notes.push(`${untrackedYards.length} of the observer's yards sit at bodies this twelve-body `
      + `board does not track (${listed}). They are deliberately not folded into any theater's `
      + 'build race: a yard the board did not count toward a body must not silently reinforce it.');
  }

  return {
    available: true,
    unavailableReason: null,
    state: hostileMovement?.state ?? null,
    findings,
    findingsTotalCount: all.length,
    findingsOmittedCount: all.length - findings.length,
    offBoardNote: buildOffBoardNote(hostileMovement),
    notes
  };
}

module.exports = {
  buildTheaterDefence,
  THEATER_POSTURE,
  DEFENCE_CHECKS,
  THEATER_DEFENCE_FINDING_LIMIT
};
