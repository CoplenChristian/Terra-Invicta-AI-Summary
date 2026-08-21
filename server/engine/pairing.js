/**
 * server/engine/pairing.js
 * Purpose: binds candidates to available councilors and computes success odds
 *   via the odds model.
 *
 * Binds candidates to available councilors, computes success odds via the
 * Wiki roll formula, outcome-weighted expected hate, and net expected value.
 */

const { evaluatePairingFeasibility, isCouncilorFree } = require('./feasibility');
const { computeMissionOdds } = require('./odds');
const { getUrgencyMultiplier } = require('./clocks');
const {
  computeAdviseNationBonuses,
  computeAdviseHabBonuses,
  evaluateAdviseValue
} = require('./adviseEconomics');

/**
 * Stand-in success probability used ONLY to rank a pairing whose odds could not
 * be computed (§4a: no TIMissionTemplate in this snapshot).
 */
const UNKNOWN_ODDS_PLANNING_PRIOR = 0.5;

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

function buildCandidatePairing(candidate, councilor, world = {}, clocks = [], diagnostics = null) {
  const feasibility = evaluatePairingFeasibility(candidate, councilor, world);
  if (feasibility.status === 'fail') {
    return null;
  }

  const odds = computeMissionOdds(candidate, councilor, world);
  const spec = candidate.missionSpec || {};
  // `candidate.successHate || 0` turned an absent outcome slot into a
  // confident zero -- the mission then priced as generating no alien hate at
  // all. A slot that is neither on the candidate nor on the spec stays null,
  // and the pairing reports its hate as unknown rather than free.
  const firstNumber = (...values) => {
    for (const value of values) {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
    }
    return null;
  };
  const successHate = firstNumber(spec.successHate, candidate.successHate);
  const failureHate = firstNumber(spec.failureHate, candidate.failureHate);
  const hateKnown = successHate !== null && failureHate !== null;

  const oddsKnown = typeof odds.chance === 'number';
  const pSuccess = oddsKnown ? odds.chance : UNKNOWN_ODDS_PLANNING_PRIOR;
  const pFail = 1 - pSuccess;

  const weightedHate = hateKnown
    ? Number((pSuccess * successHate + pFail * failureHate).toFixed(2))
    : null;
  const expectedHate = oddsKnown && hateKnown ? weightedHate : null;
  // What to charge the cycle hate pool. With odds we charge the weighted
  // value; without odds we charge the worst branch. With no hate row at all
  // there is no number to charge -- flagged via `hateUnknown` so the caller
  // sees an unmeasured exposure instead of a silent zero.
  const hateForBudget = hateKnown
    ? (oddsKnown ? weightedHate : Math.max(successHate, failureHate))
    : null;

  let baseVal = Number(candidate.score ?? candidate.baseValue ?? candidate.value ?? 4.0);
  let adviseBonuses = null;
  let advisePerTurnValue = null;
  // Populated only on the branch that returns null, where it becomes the
  // recorded drop reason. It is deliberately NOT on the returned pairing --
  // a pairing that exists was priced.
  let adviseUnpriceable = null;

  if (candidate.missionType === 'Advise') {
    const targetType = candidate.target?.type || 'nation';
    if (targetType === 'nation') {
      adviseBonuses = computeAdviseNationBonuses(councilor, candidate.target);
    } else {
      adviseBonuses = computeAdviseHabBonuses(councilor, candidate.target);
    }
    const evaluated = evaluateAdviseValue(adviseBonuses, targetType);
    if (evaluated.score === null) {
      // Nothing about this target was measurable. The pairing is dropped
      // rather than scored off the 1.0 floor, which the snapshot cannot
      // support -- and the drop is RECORDED, not silent.
      adviseUnpriceable = evaluated.unmeasuredReason
        || 'The Advise target carries no measurable output in this snapshot.';
      if (Array.isArray(diagnostics)) {
        diagnostics.push({
          missionType: 'Advise',
          reason: 'unpriceable-advise-target',
          candidateId: candidate.id || candidate.key || candidate.title || null,
          detail: adviseUnpriceable
        });
      }
      return null;
    }
    advisePerTurnValue = evaluated.perTurnValue;
    baseVal = evaluated.score;
  }

  const urgency = getUrgencyMultiplier(candidate, clocks);
  const adjustedVal = baseVal * urgency;

  // An unmeasured failure branch is priced at the higher failure cost, not the
  // lower one: "we did not read the failure row" must not rank as safely as
  // "the failure row says zero".
  const failureCost = candidate.failureCost ?? (failureHate === null || failureHate > 0 ? 1.5 : 0.5);
  const hateWeight = Number(world.weights?.HATE_POINTS ?? 1.0);

  const cost = candidate.cost || {
    resource: spec.costResource || null,
    kind: spec.costKind || null,
    amount: typeof spec.costAmount === 'number' ? spec.costAmount : null
  };
  const resourcePenalty = cost.amount ? cost.amount * 0.02 : 0;

  // Expected Value Formula:
  // EV = P(success) * adjustedValue - P(failure) * failureCost - weightedHate * hateWeight - resourcePenalty
  //
  // With no hate row the hate term drops out of the arithmetic (there is no
  // number to subtract), and `hateUnknown` on the returned pairing is what
  // says so -- the score must not be read as "this mission costs no hate".
  const hateTerm = weightedHate === null ? 0 : weightedHate * hateWeight;
  const automaticHateTerm = successHate === null ? 0 : successHate * hateWeight;
  const ev = odds.automatic === true
    ? adjustedVal - automaticHateTerm - resourcePenalty
    : (pSuccess * adjustedVal) - (pFail * failureCost) - hateTerm - resourcePenalty;

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

  if (!hateKnown) {
    why.push('Alien hate exposure is NOT recorded for this mission in this snapshot, so nothing could be '
      + 'charged to cycle headroom. Unknown exposure, not zero exposure.');
  } else if (expectedHate === null) {
    why.push(`Alien hate exposure is not computable without odds; charged to cycle headroom at its worst `
      + `branch (+${hateForBudget.toFixed(2)}).`);
  } else if (expectedHate === 0) {
    why.push('Generates zero alien hate across all outcome branches.');
  } else {
    why.push(`Expected alien hate (+${expectedHate.toFixed(2)}) factored into cycle headroom.`);
  }

  if (adviseBonuses) {
    if (adviseBonuses.targetType === 'nation') {
      why.push(`Advise adds +${adviseBonuses.gainResearch} research/turn, +${adviseBonuses.gainIP} IP/turn, and +${adviseBonuses.gainMiltech} miltech to ${adviseBonuses.targetName}.`);
    } else {
      // A null gain is unmeasured, not zero -- never interpolated raw.
      const researchPhrase = adviseBonuses.gainResearch === null
        ? 'no research reading in this snapshot'
        : `+${adviseBonuses.gainResearch} research/turn`;
      const measuredOutputs = Object.entries(adviseBonuses.outputs || {})
        .filter(([, value]) => value !== null && value !== undefined);
      const outputPhrase = measuredOutputs.length === 0
        ? 'no measured resource outputs'
        : `+${measuredOutputs.reduce((sum, [, value]) => sum + value, 0).toFixed(2)}/turn across `
          + `${measuredOutputs.length} measured resource output(s)`;
      why.push(`Advise adds ${researchPhrase} and ${outputPhrase} to ${adviseBonuses.targetName}.`);
      if ((adviseBonuses.unmeasuredInputs || []).length > 0) {
        why.push(`Unmeasured for this hab: ${adviseBonuses.unmeasuredInputs.join(', ')}.`);
      }
    }
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
    hateUnknown: !hateKnown,
    cost,
    adviseBonuses,
    perTurnValue: advisePerTurnValue,
    // Which Advise inputs the snapshot did not carry, so a card can say the
    // quoted per-turn value stands on a partial reading.
    adviseUnmeasuredInputs: adviseBonuses?.unmeasuredInputs || null,
    why
  };
}

function generateAllPairings(candidates = [], councilors = [], world = {}, clocks = [], diagnostics = null) {
  const pairings = [];
  const validCouncilors = councilors.filter(isCouncilorFree);

  for (const candidate of candidates) {
    for (const councilor of validCouncilors) {
      const pairing = buildCandidatePairing(candidate, councilor, world, clocks, diagnostics);
      if (pairing) {
        pairings.push(pairing);
      }
    }
  }

  return pairings;
}

module.exports = {
  buildCandidatePairing,
  generateAllPairings,
  resolveCouncilorId,
  buildCouncilorSummary
};
