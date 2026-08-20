/**
 * server/engine/pairing.js
 *
 * Binds candidates to available councilors, computes success odds via the
 * Wiki roll formula, outcome-weighted expected hate, and net expected value.
 */

const { evaluatePairingFeasibility, isCouncilorFree } = require('./feasibility');
const { computeMissionOdds } = require('./odds');
const { getUrgencyMultiplier } = require('./clocks');

/**
 * Stand-in success probability used ONLY to rank a pairing whose odds could not
 * be computed (§4a: no TIMissionTemplate in this snapshot).
 *
 * It never reaches `odds.chance`, which stays null -- displayed odds are a fact
 * and are not invented. Ranking is a different job: score such a pairing at its
 * full value and every unknown-odds candidate outranks every measured one;
 * score it at zero and a pre-`missionSpecs` snapshot benches the whole
 * catalogue. A coin flip is the maximum-entropy choice between those, it keeps
 * the two populations commensurable, and `why` says out loud that it was used.
 */
const UNKNOWN_ODDS_PLANNING_PRIOR = 0.5;

/**
 * Snapshot councilors carry `ID`; the engine's own fixtures carry `id`. Reading
 * only one of them yields `undefined`, and `undefined` is a perfectly usable Set
 * key -- so six councilors collapsed into one bucket and five of them vanished
 * from the cycle plan without ever being reported. Returns null when there is
 * genuinely no identity, so callers have to decide what to do about it rather
 * than being handed a value that silently collides.
 */
function resolveCouncilorId(councilor) {
  const raw = councilor?.ID ?? councilor?.id ?? councilor?.councilorId ?? null;
  if (raw === null || raw === undefined || raw === '') return null;
  return raw;
}

function buildCouncilorSummary(councilor) {
  if (!councilor) return {};
  const attrs = councilor.resolvedAttributes?.effective || councilor.resolvedAttributes || councilor.attributes || {};
  const topStats = Object.entries(attrs)
    .filter(([k, v]) => typeof v === 'number' && v > 10)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ');

  return {
    id: resolveCouncilorId(councilor),
    name: councilor.displayName || councilor.name || 'Councilor',
    profession: councilor.profession || councilor.typeTemplateName || 'Operative',
    location: councilor.location || councilor.locationName || 'Earth',
    locationType: councilor.locationType || 'earth',
    stat: topStats || 'Assessed'
  };
}

function buildCandidatePairing(candidate, councilor, world = {}, clocks = []) {
  const feasibility = evaluatePairingFeasibility(candidate, councilor, world);
  if (feasibility.status === 'fail') {
    return null;
  }

  const odds = computeMissionOdds(candidate, councilor, world);
  const spec = candidate.missionSpec || {};
  const successHate = typeof spec.successHate === 'number' ? spec.successHate : (candidate.successHate || 0);
  const failureHate = typeof spec.failureHate === 'number' ? spec.failureHate : (candidate.failureHate || 0);

  const oddsKnown = typeof odds.chance === 'number';
  const pSuccess = oddsKnown ? odds.chance : UNKNOWN_ODDS_PLANNING_PRIOR;
  const pFail = 1 - pSuccess;

  // Expected hate is an outcome-weighted sum, so it is only a measurement when
  // the outcome weights are -- with no odds it is reported as null rather than
  // as the number the prior happens to produce.
  //
  // The budget pools still have to be charged something. `Number(null)` is 0,
  // which would let a snapshot carrying no mission rules recommend six
  // hate-generating missions against an empty hate allowance, so the pools are
  // charged the worst branch instead. Conservative where it costs us nothing.
  const weightedHate = Number((pSuccess * successHate + pFail * failureHate).toFixed(2));
  const expectedHate = oddsKnown ? weightedHate : null;
  const hateForBudget = oddsKnown ? weightedHate : Math.max(successHate, failureHate);

  const baseVal = Number(candidate.score ?? candidate.baseValue ?? candidate.value ?? 4.0);
  const urgency = getUrgencyMultiplier(candidate, clocks);
  const adjustedVal = baseVal * urgency;

  const failureCost = candidate.failureCost ?? (failureHate > 0 ? 1.5 : 0.5);
  const hateWeight = Number(world.weights?.HATE_POINTS ?? 1.0);

  const cost = candidate.cost || {
    resource: spec.costResource || null,
    kind: spec.costKind || null,
    amount: typeof spec.costAmount === 'number' ? spec.costAmount : null
  };
  const resourcePenalty = cost.amount ? cost.amount * 0.02 : 0;

  // Expected Value Formula:
  // EV = P(success) * adjustedValue - P(failure) * failureCost - weightedHate * hateWeight - resourcePenalty
  const ev = odds.automatic === true
    ? adjustedVal - successHate * hateWeight - resourcePenalty
    : (pSuccess * adjustedVal) - (pFail * failureCost) - (weightedHate * hateWeight) - resourcePenalty;

  const attackAttr = spec.attack || candidate.attackAttribute || null;

  const why = [];
  if (odds.automatic === true) {
    why.push('100% guaranteed success; automatic resolution.');
  } else if (oddsKnown) {
    why.push(`Operative ${attackAttr} (${odds.offense}) provides ${odds.point}% calculated odds.`);
  } else {
    why.push(`Success odds not computable: ${odds.basis}. Ranked at a nominal `
      + `${Math.round(UNKNOWN_ODDS_PLANNING_PRIOR * 100)}%.`);
  }

  if (expectedHate === null) {
    why.push(`Alien hate exposure is not computable without odds; charged to cycle headroom at its worst `
      + `branch (+${hateForBudget.toFixed(2)}).`);
  } else if (expectedHate === 0) {
    why.push('Generates zero alien hate across all outcome branches.');
  } else {
    why.push(`Expected alien hate (+${expectedHate.toFixed(2)}) factored into cycle headroom.`);
  }

  if (candidate.policyNote) {
    why.push(candidate.policyNote);
  }

  return {
    candidateId: candidate.id || candidate.key || candidate.title,
    candidate,
    councilorId: resolveCouncilorId(councilor),
    councilor: buildCouncilorSummary(councilor),
    rawCouncilor: councilor,
    feasibility: feasibility.status,
    feasibilityReasons: feasibility.reasons,
    odds,
    expectedValue: Number(ev.toFixed(2)),
    expectedHate,
    hateForBudget,
    cost,
    why
  };
}

function generateAllPairings(candidates = [], councilors = [], world = {}, clocks = []) {
  const pairings = [];
  const validCouncilors = councilors.filter(isCouncilorFree);

  for (const candidate of candidates) {
    for (const councilor of validCouncilors) {
      const pairing = buildCandidatePairing(candidate, councilor, world, clocks);
      if (pairing) {
        pairings.push(pairing);
      }
    }
  }

  return pairings;
}

module.exports = {
  UNKNOWN_ODDS_PLANNING_PRIOR,
  resolveCouncilorId,
  buildCouncilorSummary,
  buildCandidatePairing,
  generateAllPairings
};
