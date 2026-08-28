/**
 * server/engine/theaterDefence.js
 * Purpose: the theater-defence block — build, reinforce or withdraw at each
 *   threatened body, whether production there could land a hull before contact,
 *   and an explicit refusal wherever a reading the verdict depends on is
 *   absent.
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
 * The five POSTURES rest on the production race and on what is present at each
 * body -- never on whether the force there could win. They are also independent
 * of any hull count: BUILD means the fastest hull this body can lay down lands
 * before contact, not "build N of design X". A posture survives the absence of
 * a hull recommendation.
 *
 * It also makes NO hate-based inference. "Hate is 25, so this fleet is probably
 * not aimed at you" is deliberately unimplemented and recorded in `notes`: it is
 * the one inference that can tell a player they are safe.
 *
 * NO HULL COUNT, IN EITHER MODE
 * -----------------------------
 * A hull count is not emitted anywhere in this block. Not in `recommendation`,
 * which is null on every finding in both modes; not in `force`, where each
 * fleet's `requirement` is nulled with `requirementWithheldReason` naming the
 * gate. The reasoning is in `docs/engagement-matchup-spec.md`: a scalar combat
 * value cannot express a matchup, the own-force rating is the observer's best
 * design applied to every hull present, and the player-mode bridge is an
 * invented constant. All three faults apply in omniscient mode as well as
 * player mode -- "5-6 hulls" is precise-looking and rests on the same broken
 * currency. The number must be removed, not captioned: two numbers where one
 * is known to be wrong is worse than one, because the reader believes
 * whichever agrees with them.
 *
 * The band still lives where it was read: on
 * `world.military.theaterForce[].opponentFleets[].requirement`, with its own
 * provenance and its own calibration caveat. This block withholds the CLAIM;
 * it does not destroy the READING. A consumer that wants the raw number goes
 * to `world.military` directly and inherits the same caveat.
 *
 * THE GATES THAT MUST HOLD BEFORE A HULL COUNT CAN BE SPOKEN
 * ----------------------------------------------------------
 * For context only -- these checks are no longer reachable from this file,
 * since the universal refusal sits before all of them. They are documented
 * here because a future model that fixes the underlying currency will need
 * them back, and removing them would lose the rationale. Two are exercised
 * today: `forceReading` (no force row) and one of `ratingCalibration` (player
 * mode) or `forceComparisonUnmodelled` (omniscient).
 *
 *   0. A force row exists for this body and reports itself available, with its
 *      hostile-fleet list established (`opponentFleets !== null`).
 *   1. `calibrated === true` AND a model exists that can express a matchup.
 *      See THE PLAYER-MODE REFUSAL and THE OMNISCIENT-MODE REFUSAL below.
 *   2. A requirement band exists -- a fleet whose `requirement.verdict` is
 *      `band` or `beyond-modelled-range` -- AND the design that band counts is
 *      named. A hull count with no unit is not a hull count.
 *   3. `nearestArrivalDays` is measured. No deadline, no race.
 *   4. This body carries a `buildOptions` row for THAT DESIGN'S OWN HULL.
 *   5. The arithmetic completes: a positive build time, and a finite count of
 *      hulls that a production line here could land before contact.
 *
 * THE PLAYER-MODE REFUSAL
 * -----------------------
 * Player mode is what the dashboard defaults to, and in player mode every force
 * row is `calibrated: false`. Measured on the live save 2026-08-27, the same
 * fleets under the same model:
 *
 *     Callisto  player 48-51 hulls   omniscient 5-6      Ganymede  17-18 vs 2
 *     Earth     player 3             omniscient 1        Luna       6-7  vs 1
 *
 * The player rating rests on an invented x1.5 constant no game source states,
 * and its error is an ORDER OF MAGNITUDE with a spread that is not consistent
 * between bodies (9.01x at Callisto against 15.65x at Earth). "Build fifty
 * hulls for Callisto" when six would do is campaign-ruining in a game about
 * scarce boost and shipyard time, and it is not made into advice by a caption.
 *
 * So no hull count is emitted anywhere in this block when `calibrated` is
 * false -- not in `recommendation`, and not in `force`, where each fleet's
 * `requirement` is nulled with `requirementWithheldReason` naming the gate
 * and pointing at `world.military.theaterForce`, which still carries the band
 * with its own provenance. The reading is not withdrawn; the CLAIM is refused.
 *
 * THE OMNISCIENT-MODE REFUSAL HAS THE SAME SHAPE
 * ----------------------------------------------
 * Combat value is broken as a model in BOTH modes. Three independent faults
 * (docs/engagement-matchup-spec.md) -- a scalar cannot express a matchup, the
 * own-force rating is the observer's best design applied to every hull
 * present, and the player-mode bridge is invented -- are all properties of
 * the currency itself, not of the mode. So a calibrated row receives the same
 * refusal, with a reason that points at the spec rather than restating the
 * argument. Two refusal CHECKS, one underlying cause: the field that says
 * WHICH was tested is preserved so a future fix can tell them apart, but the
 * conclusion is the same.
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
const { buildBeatsArrival, SHIP_BUILD_EXCLUDED_TERMS } = require('../../shared/shipBuildTime.mjs');
// ENGAGEMENT_VERDICTS was only consumed by the now-deleted `compareDelivery` --
// the verdicts catalogue was a string lookup over that enum. The export
// `DELIVERY_VERDICTS` survives as a string catalogue; nothing in this file
// still needs the enum.
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
 * Named checks for the BUILD RECOMMENDATION, kept separate from
 * `DEFENCE_CHECKS` because they gate a different claim. Those decide a posture
 * from the production race; these decide whether a hull count may be spoken
 * at all. Today only two are reachable -- `forceReading` (no force row) and
 * one of `ratingCalibration` (player mode) or `forceComparisonUnmodelled`
 * (omniscient) -- because the universal hull-count removal (see header and
 * `docs/engagement-matchup-spec.md`) sits before the rest. The remaining
 * four are retained as named gates a future model that fixes the currency
 * can route back through; they are not currently exercised and exporting them
 * unchanged is part of the contract.
 */
const RECOMMENDATION_CHECKS = Object.freeze({
  forceReading: 'force-reading',
  ratingCalibration: 'rating-calibration',
  hullRequirement: 'hull-requirement',
  arrivalClock: 'arrival-clock',
  buildCapacity: 'required-design-build-capacity',
  buildArithmetic: 'build-arithmetic',
  forceComparisonUnmodelled: 'force-comparison-unmodelled'
});

/**
 * What a body's production says about ONE fleet's requirement.
 *
 * `indeterminate` is not a soft "probably fine". It is the answer wherever the
 * requirement is a FLOOR -- `beyond-modelled-range`, or a band composed from
/**
 * What a body's production says about ONE fleet's requirement.
 *
 * RETAINED AS A STRING CATALOGUE: it is still exported in case a consumer
 * outside this file matches on the verdict strings (the panel utils do not),
 * but the only internal caller -- the deleted `compareDelivery` -- is gone.
 * The verdicts themselves are no longer emitted anywhere in this block: the
 * universal hull-count removal (see header) sits before any delivery
 * comparison can run, so the corresponding `recommendation.perFleet[].delivery`
 * object is no longer in the output. `indeterminate`'s rationale survives in
 * the refusal text on the recommendation itself.
 */
const DELIVERY_VERDICTS = Object.freeze({
  fallsShort: 'falls-short-of-requirement',
  withinBand: 'inside-the-band',
  meetsBand: 'meets-the-band',
  indeterminate: 'indeterminate'
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
  + 'what is present at each body -- NOT on whether the force there could win. The block does not '
  + 'emit a hull count in either mode: combat value is broken as a model in BOTH modes, not just '
  + 'player mode (docs/engagement-matchup-spec.md), and an honest absent comparison is preferred to a '
  + 'confident number derived from a broken currency. The reading still lives on '
  + '`world.military.theaterForce[].opponentFleets[].requirement`, with its own provenance and its own '
  + 'calibration caveat.';

const NOTE_NO_HATE_INFERENCE =
  'No hate-based inference is made here. "Hate is low, so this fleet is probably not aimed at you" '
  + 'is deliberately unimplemented: it is the one inference that can tell a player they are safe, '
  + 'and it is a separate task. `world.military.hate` is read by nothing in this block.';

const NOTE_FASTEST_HULL =
  'The build race is run against the FASTEST hull each body\'s own yards can lay down, which is not '
  + 'necessarily the most useful one. It answers "can production at this body change the board '
  + 'before contact at all", and the hull it used is named on every race row.';

/**
 * Replaces `NOTE_NO_FORCE_COMPARISON` on any board where a requirement band was
 * actually carried. The old note said the conversion was "omitted entirely",
 * and leaving that standing beside a carried band would be a false statement in
 * the output -- the one thing worse than an absent comparison.
 *
 * The postures sentence survives verbatim because it is still true: nothing
 * below feeds `decidePosture`.
 */
const NOTE_FORCE_COMPARISON_CARRIED =
  'The POSTURES rest on the production race and on what is present at each body -- NOT on whether the '
  + 'force there could win; nothing in the recommendation block feeds them. The hull requirements beside '
  + 'them come from shared/fleetEngagement.mjs and are carried BY REFERENCE, never recomposed: `p20`, '
  + '`p80` and `isLowerBound` travel intact, `beyond-modelled-range` means "above the ceiling I swept" '
  + 'and never "cannot be won", and a delivery that clears a floor is reported indeterminate rather than '
  + 'sufficient (docs/live-defect-register.md #13).';
/*
 * NOTES DELIBERATELY NOT ADDED. After the universal hull-count removal the
 * notes budget reasons have shifted: every finding now carries the same
 * `recommendationRefusal.reason`, and the per-finding refusal text already
 * points at `docs/engagement-matchup-spec.md` -- so a block-level note saying
 * "no hull count is emitted here" would just repeat what the consumer of the
 * panel cannot miss. The original budget argument still stands: `notes` is
 * rendered into war-room section 1c by `shared/markdownExports.mjs`, and
 * that document was measured on 2026-08-22 at 94.6% of its 30,720-byte
 * ceiling. Per-byte, the new first note (`NOTE_NO_FORCE_COMPARISON`) does the
 * job and nothing extra needs to ride on `notes`.
 */

/**
 * Two reason strings, one per mode. The hull requirement is WITHHELD in BOTH
 * modes today -- the block never emits a count -- and the reason a consumer
 * sees depends on which gate fired: in player mode the rating is scaled off
 * the observer's own best hull by an invented x1.5 constant; in omniscient
 * mode the rating is calibrated but the underlying currency is still broken
 * (docs/engagement-matchup-spec.md). Both name `world.military.theaterForce`,
 * the surface the band still lives on with its own provenance, so the
 * withholding is never mistaken for the reading having been destroyed.
 */
const REQUIREMENT_WITHHELD_UNCALIBRATED =
  'the hull requirement for this fleet is WITHHELD from the advice block: this body\'s force row reports '
  + '`calibrated: false`, so the count rests on an opponent rating scaled off the observer\'s own best '
  + 'hull by invented constants. It is not deleted -- the band, its p20/p80, its verdict and its own '
  + 'calibration caveat are carried unchanged on '
  + '`world.military.theaterForce[].opponentFleets[].requirement`, where they are a reading with a stated '
  + 'provenance rather than a recommendation.';

const REQUIREMENT_WITHHELD_UNMODELLED =
  'the hull requirement for this fleet is WITHHELD from the advice block: a calibrated rating is not the '
  + 'same as a model that can answer the question. Combat value is a scalar and a scalar cannot express a '
  + 'matchup (the player\'s example: a missile monitor at ~1,900 loses to a laser lancer at ~80, on '
  + 'loadout), the own-force rating applies the observer\'s best design to every hull present, and the '
  + 'player-mode bridge that an omniscient path would have to share with player mode is an invented '
  + 'constant -- three independent faults detailed in `docs/engagement-matchup-spec.md`. The reading is '
  + 'not destroyed; the band, its p20/p80, its verdict and its calibration caveat are carried unchanged '
  + 'on `world.military.theaterForce[].opponentFleets[].requirement`, where they are a reading with a '
  + 'stated provenance rather than a recommendation.';

// Legacy alias. Tests and external callers that imported the old single
// constant still resolve; the uncalibrated (player-mode) text was the only
// path that ever used it.
const REQUIREMENT_WITHHELD = REQUIREMENT_WITHHELD_UNCALIBRATED;

/**
 * The board's hostile counts and the force model's fleet rows are DIFFERENT
 * SETS, and the difference between them is not a count of anything.
 *
 * Measured 2026-08-27 on the committed omniscient fixture: the board reports 10
 * hostile fleets present at Mars and the force model rates 0, because every one
 * of them belongs to the Servants rather than to the aliens. At Earth the
 * board reports 1 and the model rates 2, because the board buckets on
 * `normalizeBody(orbitBody)` while the force model strips a trailing " orbit"
 * first, so an alien fleet at "Earth Orbit" reaches one set and not the other.
 * Subtracting one from the other would produce a confident count of unrated
 * fleets that is sometimes negative.
 */
const COVERAGE_NOT_COMPARABLE =
  'these two counts are NOT comparable and must not be subtracted. `ratedHostileFleets` counts ALIEN '
  + 'fleets that shared/fleetEngagement.mjs bucketed to this body after stripping a trailing " orbit"; '
  + '`boardHostileFleetsPresent` counts fleets of EVERY faction hostile to the observer, matched by '
  + 'shared/intel/theaters.mjs on the unstripped body name. Different factions, different matching rule. '
  + 'Where `boardHostileFactions` names a faction other than the aliens, this body holds hostile force no '
  + 'requirement below is sized against -- each recommendation answers for the one named fleet on its '
  + 'own row and for nothing else.';

/**
 * RECOMMENDATION_EXCLUDED_TERMS lived here: a list of caveats attached to the
 * deleted `recommendation.production.excludes` field (parallel yards,
 * resource cost). The field is no longer emitted and the only call site
 * (`recommendation.production.excludes = [...SHIP_BUILD_EXCLUDED_TERMS,
 * ...RECOMMENDATION_EXCLUDED_TERMS]`) is gone. The SHIP_BUILD_EXCLUDED_TERMS
 * import is still used by `buildRace` for the verdict, so that stays.
 */

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

/** The force row the military read-model composed for one body, or null. */
function forceRowAt(theaterForce, body) {
  const key = normalizeBody(body);
  return theaterForce.find(row => normalizeBody(row?.body) === key) ?? null;
}

/**
 * One hostile fleet, projected into the advice block.
 *
 * The `requirement` is WITHHELD in both modes: this block never emits a hull
 * count, so the count is replaced by null with a named reason. The reason
 * depends on which gate fired -- `calibrated === false` (player mode) gets
 * the uncalibrated text that names the x1.5 invented constant; a calibrated
 * row gets the unmodelled text that points at `docs/engagement-matchup-spec.md`.
 * Both name `world.military.theaterForce`, the surface the band still lives
 * on with its own provenance, so the withholding is never mistaken for the
 * reading having been destroyed.
 */
function projectFleetRow(row, calibrated) {
  const requirement = row?.requirement ?? null;
  const withheld = requirement !== null;
  return {
    fleetId: row?.fleetId ?? null,
    fleetName: row?.fleetName ?? null,
    orbitBody: row?.orbitBody ?? null,
    // Absent stays null on all four. An uncounted fleet is not an empty one.
    shipsCount: countOrNull(row?.shipsCount),
    ratedShips: countOrNull(row?.ratedShips),
    unratedShips: countOrNull(row?.unratedShips),
    opponentRating: countOrNull(row?.opponentRating),
    requirement: withheld ? null : requirement,
    // Two different nulls, kept apart. `requirementUnavailableReason` is the
    // read-model's own: the resource emitted no requirement at all.
    // `requirementWithheldReason` is this block's: one exists and may not be
    // repeated here. Collapsing them would lose which of the two happened.
    requirementUnavailableReason: row?.requirementUnavailableReason ?? null,
    requirementWithheldReason: withheld
      ? (calibrated ? REQUIREMENT_WITHHELD_UNMODELLED : REQUIREMENT_WITHHELD_UNCALIBRATED)
      : null,
    calibrated: row?.calibrated ?? null,
    basis: row?.basis ?? null,
    calibrationCaveat: row?.calibrationCaveat ?? null
  };
}

/**
 * The force readings for one body, emitted whether or not advice follows.
 *
 * A refusal that hides its inputs is an empty panel, so this is built on every
 * finding in every mode. The calibration gate no longer filters anything here:
 * `requirement` is withheld in both modes by `projectFleetRow` (see above).
 * `calibrated` is carried so a consumer can still tell which mode it is.
 */
function projectForce(row, theater) {
  const hostile = theater?.hostile ?? {};
  const coverage = {
    ratedHostileFleets: countOrNull(row?.opponentFleetsCount),
    boardHostileFleetsPresent: countOrNull(hostile.fleets),
    boardHostileFactions: asArray(hostile.factions),
    countsAreComparable: false,
    note: COVERAGE_NOT_COMPARABLE
  };

  if (!row) {
    return {
      available: false,
      unavailableReason: 'the military read-model carried no force row for this body, so neither side\'s '
        + 'strength here was composed. That is an absent reading, not a reading of zero.',
      calibrated: null,
      basis: null,
      isEstimate: true,
      own: null,
      opponent: null,
      fleets: null,
      fleetsCount: null,
      fleetsUnavailableReason: 'no force row exists for this body, so which hostile fleets are here was '
        + 'never determined',
      composedRequirement: null,
      composedRequirementReason: null,
      coverage
    };
  }

  const calibrated = row.calibrated === true;
  const rows = row.opponentFleets === null || row.opponentFleets === undefined
    ? null
    : asArray(row.opponentFleets).map(fleet => projectFleetRow(fleet, calibrated));

  return {
    available: row.available === true,
    unavailableReason: row.unavailableReason ?? null,
    calibrated,
    basis: row.opponent?.basis ?? null,
    isEstimate: row.isEstimate === undefined ? true : row.isEstimate,
    own: {
      rating: countOrNull(row.own?.rating),
      ratedShips: countOrNull(row.own?.ratedShips),
      unratedShips: countOrNull(row.own?.unratedShips),
      source: row.own?.source ?? null,
      // The unit every hull count on this board is denominated in.
      bestDesignName: row.own?.bestDesignName ?? null,
      bestHullName: row.own?.bestHullName ?? null
    },
    opponent: {
      rating: countOrNull(row.opponent?.rating),
      ratedShips: countOrNull(row.opponent?.ratedShips),
      unratedShips: countOrNull(row.opponent?.unratedShips),
      source: row.opponent?.source ?? null
    },
    // NULL, not [], where the read-model never established the list -- an empty
    // array would state that no hostile fleet is here.
    fleets: rows,
    fleetsCount: rows === null ? null : rows.length,
    fleetsUnavailableReason: row.opponentFleetsUnavailableReason ?? null,
    // Carried through, always null, with the read-model's own reason. Restated
    // here rather than dropped so nobody adds the rows up.
    composedRequirement: null,
    composedRequirementReason: row.composedRequirementReason ?? null,
    coverage
  };
}

/**
 * Can this body lay down the hull the requirement is denominated in?
 *
 * NOT "can this body build anything" -- that is `buildRace`, which takes the
 * fastest hull on offer and answers a different question. This asks for one
 * named hull, and a body that can build a Gunship when the requirement counts
 * Battlecruisers refuses. Substituting the hull it CAN build would silently
 * convert between hull types at an exchange rate nothing measured.
 */
function requiredDesignBuildAt(model, body, hullName, yards) {
  const base = {
    designName: null,
    hullName: hullName ?? null,
    available: false,
    unavailableReason: null,
    fastestDays: null,
    shipyardId: null,
    shipyardModuleTier: null,
    yardsConsidered: null,
    yardsAtBody: yards.length
  };

  if (!hullName) {
    return {
      ...base,
      unavailableReason: 'the force reading names no design for the requirement to be denominated in, so '
        + 'there is no hull to price a build against'
    };
  }

  const key = normalizeBody(body);
  const option = model.buildOptions.find(
    row => normalizeBody(row?.body) === key && row?.hullName === hullName
  ) ?? null;

  if (option !== null) {
    const days = countOrNull(option.fastestDays);
    if (days === null) {
      return {
        ...base,
        unavailableReason: `the build option for ${hullName} at ${body} carries no measured day count; an `
          + 'unmeasured build time is never defaulted to zero, to "fast", or to the arrival date'
      };
    }
    return {
      ...base,
      available: true,
      fastestDays: days,
      shipyardId: option.shipyardId ?? null,
      shipyardModuleTier: countOrNull(option.shipyardModuleTier),
      yardsConsidered: countOrNull(option.yardsConsidered)
    };
  }

  // NO YARD HERE IS A MEASUREMENT; NO MEASURED BUILD TIME IS NOT. The two are
  // kept apart here for exactly the reason `buildFinding` keeps them apart, and
  // NEITHER of them is answered by pointing at another body's yards: nothing in
  // this model carries transit time, so naming a yard at Mars for a threat at
  // Callisto would imply a delivery it cannot promise.
  if (yards.length === 0) {
    return {
      ...base,
      unavailableReason: `the observer holds no shipyard at ${body}, so no hull can be laid down here -- a `
        + 'measured absence of build capacity, not an unmeasured build time. Production at another body is '
        + 'NOT offered in its place: reinforcement from elsewhere is a transit problem and no transit time '
        + 'is modelled anywhere in this block.'
    };
  }

  const refusal = model.buildRefusals.find(
    row => normalizeBody(row?.body) === key && row?.hullName === hullName
  ) ?? null;
  return {
    ...base,
    unavailableReason: `the observer holds ${yards.length} yard(s) at ${body}, but none of them produced a `
      + `measured build time for ${hullName} (${refusal?.reason ?? 'no reason recorded'}) -- and no other `
      + 'hull is substituted for it, because the requirement counts copies of one named design and this '
      + 'model carries no exchange rate between hull types'
  };
}

/**
 * `serialDeliverable` and `compareDelivery` lived here: the former divided the
 * deadline by the build time for one serial line, the latter translated a
 * delivery count into one of `falls-short / within-band / meets-band /
 * indeterminate`. Both are DEAD CODE after the universal hull-count removal:
 * `buildRecommendation` always refuses before either could be reached, and
 * `recommendation.production.serialDeliverableBeforeContact` /
 * `recommendation.perFleet[].delivery` are no longer emitted. They were the
 * only callers of `ENGAGEMENT_VERDICTS` and `DELIVERY_VERDICTS` (other than
 * the export), so the imports are dropped and the verdicts constant is now
 * a string catalogue with no internal users.
 */

/**
 * The build recommendation for one finding, or the named refusal in its place.
 *
 * Returns both keys every time, exactly one of them non-null. Two refusal
 * paths remain reachable after the universal hull-count removal:
 *
 *   - `forceReading`: no force row OR no fleet list at this body. The reading
 *     itself is absent, so the refusal names what was missing.
 *   - `ratingCalibration` (player mode) OR `forceComparisonUnmodelled`
 *     (omniscient): the force row exists, but a hull count would be derived
 *     from combat value, which is broken in both modes (see header and
 *     `docs/engagement-matchup-spec.md`). Player mode gets the uncalibrated
 *     reason; omniscient gets the unmodelled reason. Two checks, one outcome.
 *
 * The remaining gates in this file's header are documented but no longer
 * reached; a future model that fixes the currency can route back through them
 * by replacing the universal refusal with a per-check return.
 */
function buildRecommendation({ body, force, build, inbound, inboundFleets, arrivalDays, arrivalDate }) {
  const refuse = (check, reason) => ({
    recommendation: null,
    recommendationRefusal: { check, reason }
  });

  // 0. Is there a force reading at all?
  if (force.available !== true) {
    return refuse(RECOMMENDATION_CHECKS.forceReading,
      `no force reading is available for ${body}, so nothing here can be sized: `
      + `${force.unavailableReason ?? 'no reason recorded'}`);
  }
  if (force.fleets === null) {
    return refuse(RECOMMENDATION_CHECKS.forceReading,
      `which hostile fleets are at ${body} was never established, so there is no requirement to size `
      + `production against: ${force.fleetsUnavailableReason ?? 'no reason recorded'}`);
  }

  // 1. Universal hull-count refusal. A calibrated row is not the same as a
  // model that can answer the question; an uncalibrated row is worse. Both are
  // refused here. The check name preserves which gate fired; the conclusion is
  // the same and points at the spec rather than restating the argument.
  if (force.calibrated === true) {
    return refuse(RECOMMENDATION_CHECKS.forceComparisonUnmodelled,
      'no hull count is recommended at this body: combat value is broken as a model in OMINISCIENT mode '
      + 'too, not just player mode. A calibrated rating does not say how many hulls to build. The reasoning '
      + 'is in `docs/engagement-matchup-spec.md` -- a scalar cannot express a matchup, the own-force '
      + 'rating applies the observer\'s best design to every hull present, and the player-mode bridge '
      + 'any path would have to share is an invented constant. A count derived from it would be wrong in '
      + 'a direction that spends boost and shipyard time the campaign does not have. The readings still '
      + 'live in `force` (sans the band itself) and on `world.military.theaterForce`, with their own '
      + 'provenance. The CLAIM is refused; the READING is not destroyed.');
  }
  return refuse(RECOMMENDATION_CHECKS.ratingCalibration,
    'no hull count is recommended: this body\'s opponent rating is scaled off the observer\'s own best '
    + 'hull by invented constants rather than read from the aliens\' designs, and measured on the live '
    + 'save 2026-08-27 that runs 9.01x to 15.65x the omniscient reading -- an order of magnitude, '
    + 'OVER-rating the enemy, by a factor that is not consistent between bodies. A count derived from it '
    + 'would be wrong by roughly ten times, in a direction that spends boost and shipyard time the '
    + 'campaign does not have. The readings it would rest on are still carried in `force` and '
    + '`requiredDesignBuild`, and each fleet\'s band remains on world.military.theaterForce. '
    + 'Combat value is broken in omniscient mode too (docs/engagement-matchup-spec.md) -- the reason '
    + 'player mode is refused is a special case of why any path through combat value is refused.');
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

  // The readings layer, built in BOTH modes and whether or not advice follows.
  // `decidePosture` above has already run and reads none of it: the postures
  // are unchanged by everything below.
  const force = projectForce(forceRowAt(military.theaterForce, body), theater);
  const requiredDesignBuild = requiredDesignBuildAt(
    military, body, force.own?.bestHullName ?? null, yards
  );
  const { recommendation, recommendationRefusal } = buildRecommendation({
    body,
    force,
    build: requiredDesignBuild,
    inbound,
    inboundFleets,
    arrivalDays,
    arrivalDate: incoming.nearestArrivalDate ?? null
  });

  // NO CITATION ROWS ARE ADDED FOR THE RECOMMENDATION, DELIBERATELY, AND THIS
  // IS A BUDGET DECISION RATHER THAN AN OVERSIGHT.
  //
  // `citations` is the POSTURE's trail, and it is rendered into war-room
  // section 1c by shared/markdownExports.mjs. Measured 2026-08-27 against the
  // committed fixtures, adding the four readings below as citation rows cost
  // +153 bytes in player mode -- taking a 30,720-byte document from 645 bytes
  // of headroom to 492 -- to cite readings that document does not yet render.
  // Pure cost, no reader.
  //
  // The provenance is not lost by leaving them out: it travels ON the objects
  // instead, and more completely than a citation line would carry it --
  // `force.own.source`, `force.opponent.source`, `force.opponent.basis`, each
  // fleet's own `calibrationCaveat`, `recommendation.design.ratingSource`,
  // `.deadline.source`, `.production.model` and `.production.excludes`. The
  // citation rows belong to the task that actually surfaces this block, where
  // the bytes can be budgeted for alongside the lines they explain.

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
    // The force readings the recommendation rests on, carried either way so a
    // refusal is auditable rather than blank.
    force,
    // NOT `buildRace`: that races the FASTEST hull this body can lay down and
    // answers "can production here change the board at all". This one prices
    // the ONE hull the requirement is denominated in, and refuses where that
    // hull specifically cannot be built here.
    requiredDesignBuild,
    // Exactly one of these two is non-null on every finding, in every mode.
    recommendation,
    recommendationRefusal,
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
    buildRefusals: asArray(military.buildRefusals),
    // Absent on an older or hand-built world, which is a reading of "no force
    // was composed" and produces a named refusal per finding -- never a
    // recommendation assembled from nothing.
    theaterForce: asArray(military.theaterForce)
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

  // The first note states what the block does NOT claim, so it has to track
  // what it actually did. After the universal hull-count removal, the block
  // never carries a band: `recommendation` is always null and `requirement` is
  // always null in `force.fleets[]`. The first note is therefore always
  // `NOTE_NO_FORCE_COMPARISON`, and the conditional that used to switch to
  // `NOTE_FORCE_COMPARISON_CARRIED` is dead -- the constant is kept as a
  // backward-compat export but no longer has a call site.
  const notes = [
    NOTE_NO_FORCE_COMPARISON,
    NOTE_NO_HATE_INFERENCE
  ];
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
  RECOMMENDATION_CHECKS,
  DELIVERY_VERDICTS,
  THEATER_DEFENCE_FINDING_LIMIT
};
