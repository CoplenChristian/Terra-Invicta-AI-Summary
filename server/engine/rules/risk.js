// server/engine/rules/risk.js
//
// Purpose: the configurable success-odds floor — the one veto that reads the
//   odds model, so a player can say how much risk they will tolerate.
//
// The player can tolerate a mission at some success chance and not below. Odds
// were computed and used to weight expected hate, but nothing gated a
// recommendation on them: a 15% mission and a 95% mission competed on expected
// value alone. This rule is where that preference is expressed.
// See docs/risk-tolerance-spec.md.
//
// THREE THINGS MAKE THIS RULE DIFFERENT FROM THE OTHER TWELVE.
//
// 1. It is PAIRING-SCOPED. `computeMissionOdds(candidate, councilor, world)`
//    needs a councilor, so "what are the odds" is not a question a candidate
//    can answer on its own -- the same Purge is 93% for one operative and 40%
//    for another. `scope: 'pairing'` is what keeps `applyRules` from evaluating
//    it at the candidate stage, where it could only ever return 'unknown' and
//    would sweep every candidate into the `uncertain` bucket.
//
// 2. It tests `band[0]`, NOT `point`. `band` is a range, and the low end is the
//    number a floor has to clear: on the live save `purge:3728:3729` reads
//    `point 93, band [89, 96]`, so a 90% floor that tested the point would
//    admit a mission whose true chance may be 89%. Where the band is absent the
//    verdict says so rather than silently substituting `point`.
//
// 3. `available: false` is 'unknown', never 'pass'. `server/engine/pairing.js`
//    substitutes UNKNOWN_ODDS_PLANNING_PRIOR (0.5) for unknown odds when it
//    weights hate; that prior is a ranking convenience and is deliberately NOT
//    reused here. Using it as evidence that a mission clears a risk threshold
//    would be inventing a measurement.
//
// A floor of 0 means NO FLOOR, not "veto everything" -- `Number(null) === 0`,
// and the difference between "the player chose no floor" and "nothing was
// configured" must never be able to reject every action on the board.

const { toFiniteNumber } = require('../../../shared/util.mjs');

/**
 * The floor when nothing has been resolved for this world.
 *
 * Null, not 0: 0 is a value a player can choose ("no floor"), and an absent
 * setting is the absence of a choice. Both end up meaning "no veto" here, but
 * they are reported differently, and the resolution of an absent request
 * parameter to the CONFIGURED default happens at the boundary that can read
 * config (server/briefingGenerator.js), never by coercing null to zero.
 */
const NO_FLOOR = null;

/**
 * How close to the floor still counts as a marginal clearance, in percentage
 * points. ASSUMPTION -- a judgement call, not a measured quantity: a mission
 * clearing a 90% floor at a band low of 91 on an ASSUMED estimate is not the
 * same reassurance as one clearing it at 99, and the card should say so.
 */
const MARGINAL_CLEARANCE_POINTS = 5;

/**
 * The floor in force for this world, or null when there is none.
 *
 * Presence is established before coercion. A floor outside 0..100 is not a
 * floor this rule can act on and resolves to null rather than being clamped
 * into a number the player never asked for.
 */
function resolveRiskFloorPercent(world) {
  const raw = world?.riskFloorPercent;
  if (raw === null || raw === undefined || raw === '') return NO_FLOOR;
  const parsed = toFiniteNumber(raw);
  if (parsed === null) return NO_FLOOR;
  if (parsed < 0 || parsed > 100) return NO_FLOOR;
  return parsed;
}

/** True when a floor is actually in force. 0 is "no floor", not a floor of 0. */
function riskFloorInForce(world) {
  const floor = resolveRiskFloorPercent(world);
  return floor !== null && floor > 0;
}

/**
 * The low end of the odds band, or null when this estimate does not carry one.
 *
 * `point` is NOT substituted. A band is a spread and its low end is the whole
 * reason a floor tests a range instead of a midpoint; falling back to the
 * midpoint would restore exactly the defect the band exists to prevent.
 */
function readBandLow(odds) {
  if (!odds || !Array.isArray(odds.band) || odds.band.length !== 2) return null;
  return toFiniteNumber(odds.band[0]);
}

function readBandHigh(odds) {
  if (!odds || !Array.isArray(odds.band) || odds.band.length !== 2) return null;
  return toFiniteNumber(odds.band[1]);
}

function missionLabel(subject) {
  const candidate = subject?.candidate || subject || {};
  return candidate.friendlyName
    || candidate.missionSpec?.friendlyName
    || candidate.missionType
    || candidate.title
    || 'This mission';
}

/**
 * The structured verdict, computed once and read by `evaluate`, `because` and
 * the cycle plan alike so the three can never disagree about a number.
 *
 * `outcome` is one of 'pass' | 'veto' | 'unknown'. It is never collapsed to two:
 * an estimate that could not be computed is 'unknown', which is neither
 * admitted as clearing the floor nor rejected as failing it.
 */
function assessRiskFloor(world, subject) {
  const floorPercent = resolveRiskFloorPercent(world);

  // Answered before anything is read off the odds. With no floor set there is
  // no risk question to answer, and the allocator runs this over several
  // thousand pairings on a live save -- building a full verdict to say
  // "nothing to check" is work nobody asked for.
  if (floorPercent === null || floorPercent <= 0) {
    return {
      ruleId: 'risk/success-floor',
      outcome: 'pass',
      floorPercent,
      point: null,
      bandLow: null,
      bandHigh: null,
      automatic: subject?.odds?.automatic === true,
      assumed: subject?.odds?.assumed === true,
      unmodeledModifiers: [],
      marginal: false,
      basis: subject?.odds?.basis || null,
      reason: floorPercent === null
        ? 'No success-odds floor is configured, so no action is held back on risk.'
        : 'Your risk floor is 0% — no action is held back on success odds.'
    };
  }

  const odds = subject?.odds || null;
  const point = toFiniteNumber(odds?.point);
  const bandLow = readBandLow(odds);
  const bandHigh = readBandHigh(odds);
  const automatic = odds?.automatic === true;
  const assumed = odds?.assumed === true;
  const unmodeledModifiers = Array.isArray(odds?.unmodeledModifiers) ? [...odds.unmodeledModifiers] : [];
  const mission = missionLabel(subject);

  const base = {
    ruleId: 'risk/success-floor',
    floorPercent,
    point,
    bandLow,
    bandHigh,
    automatic,
    // Carried onto the verdict so a pass on an estimate that rests on
    // unmodelled modifiers is visibly weaker than a measured one.
    assumed,
    unmodeledModifiers,
    marginal: false,
    basis: odds?.basis || null
  };

  // An uncontested mission cannot fail. It clears every floor, and saying "94%
  // clears your 90% floor" about a mission with no roll would present a rule of
  // the game as a risk decision.
  if (automatic) {
    return {
      ...base,
      outcome: 'pass',
      reason: `${mission} is uncontested — it cannot fail, so your ${floorPercent}% floor does not apply to it.`
    };
  }

  // The check cannot be evaluated. Not a pass: pairing.js's 0.5 planning prior
  // ranks an unknown mission, it does not measure one, and a floor answered
  // from a prior would be a fabricated measurement.
  if (odds === null || odds.available === false) {
    return {
      ...base,
      outcome: 'unknown',
      reason: `Success odds for ${mission} could not be computed (${odds?.basis || 'no mission rules in this snapshot'}), `
        + `so your ${floorPercent}% floor could not be checked. Unknown odds, not acceptable odds.`
    };
  }

  if (bandLow === null) {
    return {
      ...base,
      outcome: 'unknown',
      reason: `The odds estimate for ${mission} carries no band, so its low end could not be read and your `
        + `${floorPercent}% floor could not be checked against it. The midpoint is not substituted for the band.`
    };
  }

  const assumedNote = assumed
    ? ' The estimate is assumed rather than measured'
      + (unmodeledModifiers.length ? ` and does not model ${unmodeledModifiers.join(', ')}` : '')
      + '.'
    : '';

  if (bandLow < floorPercent) {
    return {
      ...base,
      outcome: 'veto',
      reason: `${mission} — ${bandLow}% at the low end of its band`
        + (point === null ? '' : ` (midpoint ${point}%)`)
        + `, below your ${floorPercent}% floor.${assumedNote}`
    };
  }

  const marginal = assumed && (bandLow - floorPercent) <= MARGINAL_CLEARANCE_POINTS;
  return {
    ...base,
    outcome: 'pass',
    marginal,
    reason: `${mission} — ${bandLow}% at the low end of its band`
      + (point === null ? '' : ` (midpoint ${point}%)`)
      + `, clearing your ${floorPercent}% floor by ${bandLow - floorPercent} point`
      + (bandLow - floorPercent === 1 ? '' : 's')
      + `.${assumedNote}`
      + (marginal ? ' A marginal clearance on an assumed estimate.' : '')
  };
}

const successFloor = {
  id: 'risk/success-floor',
  kind: 'veto',
  // Pairing-scoped: odds exist only for a (candidate, councilor) pair. See the
  // module header -- `applyRules` skips this rule at the candidate stage.
  scope: 'pairing',
  // Applies to any subject carrying an odds reading -- which, by the scope
  // above, is a pairing and never a bare candidate. The floor itself is NOT
  // tested here because `appliesTo` is given only the subject, never the world;
  // a floor of 0 or an absent floor is handled in `evaluate`, which returns
  // 'pass' for it and can therefore never veto on a floor the player did not
  // set.
  appliesTo: (subject) => Boolean(subject && typeof subject === 'object'
    && subject.odds !== null && subject.odds !== undefined && typeof subject.odds === 'object'),
  // The whole verdict in one derivation. `applyPairingRules` prefers this over
  // calling evaluate/because/detail separately, so outcome, wording and numbers
  // are three views of ONE computation rather than three computations that
  // could drift -- and so the allocator pays for it once per pairing.
  assess(world, subject) {
    return assessRiskFloor(world, subject);
  },
  evaluate(world, subject) {
    return assessRiskFloor(world, subject).outcome;
  },
  because(world, subject) {
    return assessRiskFloor(world, subject).reason;
  },
  // The structured verdict, so the cycle plan and the dashboard read the same
  // numbers the veto decided on rather than recomputing them.
  detail(world, subject) {
    return assessRiskFloor(world, subject);
  },
  source: 'docs/risk-tolerance-spec.md -- player-configured success floor, tested against the low end of '
    + 'the odds band from server/engine/odds.js (Terra Invicta wiki roll curve, +/-2 unmodelled-modifier spread).',
  estimateClass: 'calculated'
};

module.exports = {
  MARGINAL_CLEARANCE_POINTS,
  assessRiskFloor,
  readBandLow,
  resolveRiskFloorPercent,
  riskFloorInForce,
  successFloor
};
