// server/engine/rules/value.js
//
// Purpose: the score rules that say what an action is worth.
//
// The score rules that say what an action is WORTH. Only the expansion rule
// falls out of a real formula (GDP value density); the rest are calibrated
// judgement collected in WEIGHTS and marked estimateClass 'heuristic' so a
// reader can tell an estimate from a measurement.
//
// Order note: these four are NOT contiguous in the registry --
// `readiness/unmet-preconditions` sits between `value/counter-councilor` and
// `value/unblock-alien-response`. See rules/index.js; the registry order is
// the emission order of `scoreBreakdown`.

const { toFiniteNumber } = require('../../../shared/util.mjs');
const { nationControlPointCost } = require('../../../shared/controlPointCap.mjs');
const { getWeights } = require('../weights');

// The nation's control-point cost is `GDP_Bn^0.6 / 2` and, per the wiki page
// `Nations` § "Cost of Control Points" (raw wikitext, read 2026-08-22), that
// total "is divided up evenly among all the control points of the nation".
// This rule used to divide the OUTPUT by the control-point count while charging
// one control point the UNDIVIDED national total, which under-valued every
// multi-control-point nation by exactly its control-point count -- 6x on China,
// 2x on Madagascar. Because both sides divide by the same count, the count
// cancels:
//
//     (GDP_Bn / n) / ((GDP_Bn^0.6 / 2) / n)  ==  GDP_Bn / (GDP_Bn^0.6 / 2)
//                                            ==  2 * GDP_Bn^0.4
//
// so the corrected density does not read the count at all. `value/defend-
// interests` below already prices GDP density with that same undivided ratio;
// the two now agree, which they did not before.
//
// The count is still read for the EXPLANATION -- a reader wants the per-point
// figures -- and when it is absent the explanation says so instead of asserting
// 1, which is what the old `|| 1` did.
//
// NOT modelled, deliberately: the same wiki section says control points under a
// Crackdown or abandoned "do not cost any cp". A free control point has an
// unbounded value density, so pricing one that way would hand it an infinite
// score; the honest version of that term needs a cap this repo has not
// established (shared/controlPointCap.mjs refuses the headroom verdict for the
// same reason). Candidates are therefore priced at the paying rate, which
// UNDER-states a crackdown or abandoned target rather than over-stating it.
const gdpPerCpCost = {
  id: 'value/gdp-per-cp-cost',
  kind: 'score',
  appliesTo: (candidate) => candidate.family === 'expansion' && Number.isFinite(candidate.value?.gdpBn),
  evaluate(world, candidate) {
    const gdpBn = candidate.value.gdpBn;
    const nationTotalCost = nationControlPointCost(gdpBn);
    if (nationTotalCost === null) return 0;
    const valueDensity = gdpBn / nationTotalCost;
    return valueDensity * getWeights(world).VALUE_POINTS;
  },
  because(world, candidate) {
    const gdpBn = candidate.value.gdpBn;
    const nationTotalCost = nationControlPointCost(gdpBn);
    if (nationTotalCost === null) {
      return 'GDP is not available for this control point, so no value density can be scored.';
    }
    const cpCount = toFiniteNumber(candidate.value.cpCountInNation);
    const valueDensity = gdpBn / nationTotalCost;
    const split = cpCount !== null && cpCount > 0
      ? `splits both its output and its control-point cost across ${cpCount} control point(s) — `
        + `$${(gdpBn / cpCount).toFixed(1)}Bn against ${(nationTotalCost / cpCount).toFixed(2)} cp each`
      : 'carries no readable control-point count, so the per-point figures cannot be shown';
    return `${candidate.target.nation} ($${gdpBn.toFixed(1)}Bn GDP) ${split}. The nation's whole cost is `
      + `GDP_Bn^0.6/2 = ${nationTotalCost.toFixed(2)}, divided evenly among its control points, so the count `
      + `cancels out of the ratio (wiki Nations, "Cost of Control Points"; absolute scale unverified). `
      + `Value density ${valueDensity.toFixed(3)}.`;
  },
  source: 'wiki Nations § "Cost of Control Points" (raw wikitext, read 2026-08-22) -- output ÷ '
    + '(GDP_Bn^0.6 / 2), both sides divided evenly among the nation\'s control points; '
    + 'shared/controlPointCap.mjs carries the full citation. Scale is WEIGHTS.VALUE_POINTS.',
  estimateClass: 'heuristic'
};

const defendInterests = {
  id: 'value/defend-interests',
  kind: 'score',
  appliesTo: (candidate) => candidate.family === 'defense',
  evaluate(world, candidate) {
    const gdpBn = toFiniteNumber(candidate.value?.gdpBn) || 0;
    const gdpDensity = gdpBn > 0
      ? (gdpBn / (gdpBn ** 0.6 / 2)) * getWeights(world).DEFENSE.gdpDensityPoints
      : 0;
    const escalateLateBonus = world.posture?.escalateLate === true ? getWeights(world).DEFENSE.escalateLateBonus : 0;
    return getWeights(world).DEFENSE.base + gdpDensity + escalateLateBonus;
  },
  because(world, candidate) {
    const nation = candidate.target?.nation || 'core holding';
    const escalateLate = world.posture?.escalateLate === true;
    const unprotected = candidate.value?.unprotectedControlPointCount;
    const unknown = candidate.value?.defenseUnknownCount;
    const coverage = unknown > 0
      ? `${unknown} control point${unknown === 1 ? '' : 's'} have unmeasured existing coverage`
      : unprotected === 0
        ? 'the current ward is approaching renewal'
        : `${unprotected} control point${unprotected === 1 ? '' : 's'} need${unprotected === 1 ? 's' : ''} coverage`;
    return escalateLate
      ? `Defending ${nation} (${coverage}) wards core GDP at 0 alien hate while offensive operations are deferred under escalate-late doctrine.`
      : `Defending ${nation} (${coverage}) wards core GDP at 0 alien hate against rival subversion.`;
  },
  source: 'Notion 09 (Defend Interests protects majors); TIMissionTemplate flat 20 Influence cost.',
  estimateClass: 'heuristic'
};

const counterCouncilor = {
  id: 'value/counter-councilor',
  kind: 'score',
  appliesTo: (candidate) => candidate.family === 'council' && candidate.isFallback !== true,
  evaluate(world, candidate) {
    const base = candidate.missionType === 'Turn Councilor'
      ? getWeights(world).COUNCIL.turn
      : getWeights(world).COUNCIL.investigate;
    return base + (candidate.value?.targetIsProxy === true ? getWeights(world).COUNCIL.proxyTargetBonus : 0);
  },
  because(world, candidate) {
    const who = candidate.target?.councilorName || 'this councilor';
    const proxy = candidate.value?.targetIsProxy === true;
    const stem = candidate.missionType === 'Turn Councilor'
      ? `Turning ${who} takes them off the enemy board and puts an agent inside their faction, at zero alien hate on success`
      : `Investigating ${who} is free on every outcome and unlocks both Turn's secrets precondition and a masked Loyalty`;
    return proxy
      ? `${stem}. Their faction is an alien proxy, which both feeds alien hate and is a real strategic adversary (Notion 02).`
      : `${stem}.`;
  },
  source: 'Notion 02 (Protectorate as a real adversary); TIMissionTemplate zero-hate success rows. '
    + 'Weights are calibrated judgement -- see WEIGHTS.COUNCIL.',
  estimateClass: 'heuristic'
};

const unblockAlienResponse = {
  id: 'value/unblock-alien-response',
  kind: 'score',
  appliesTo: (candidate) => candidate.family === 'intelligence',
  evaluate(world, candidate) {
    if (candidate.value?.capabilityUnlockedUnused === true) {
      const escalateLate = world.posture?.escalateLate === true;
      return getWeights(world).INTELLIGENCE.unblockSightings
        + (escalateLate ? getWeights(world).INTELLIGENCE.escalateLateBonus : 0);
    }
    return getWeights(world).INTELLIGENCE.detainAlien;
  },
  because(world, candidate) {
    if (candidate.value?.capabilityUnlockedUnused !== true) {
      return 'Detaining a sighted alien operative removes them from Earth without triggering retaliation.';
    }
    return world.posture?.escalateLate === true
      ? 'Alien tracking is unlocked and unused, which blocks every downstream alien action. '
        + 'Escalate-late posture makes that worse: the fleet cannot absorb what it cannot see.'
      : 'Alien tracking is unlocked and unused, which blocks every downstream alien action.';
  },
  source: 'docs/archive/directive-rule-engine-plan.md §5; weights are judgement -- see WEIGHTS.INTELLIGENCE.',
  estimateClass: 'heuristic'
};

const advisoryPotential = {
  // Advise is a persistent output mission, so its real worth depends on the
  // councilor's Admin/Science/Command -- which the engine does not know at
  // candidate-scoring time. server/engine/pairing.js prices it exactly, per
  // councilor, via adviseEconomics. This rule exists only so an advisory
  // candidate carries a ranking signal into `surviving` instead of scoring a
  // flat zero, and it is deliberately built from a MEASURED field
  // (the target's research output) rather than a placeholder.
  id: 'value/advisory-potential',
  kind: 'score',
  appliesTo: (candidate) => candidate.family === 'advisory',
  evaluate(world, candidate) {
    const research = toFiniteNumber(candidate.value?.targetResearch);
    if (research === null) return getWeights(world).ADVISORY.base;
    return getWeights(world).ADVISORY.base
      + Math.min(getWeights(world).ADVISORY.researchCap, research * getWeights(world).ADVISORY.researchPoints);
  },
  because(world, candidate) {
    const label = candidate.value?.nationName || candidate.value?.habName || candidate.target?.name || 'this target';
    const research = toFiniteNumber(candidate.value?.targetResearch);
    if (research === null) {
      return `Advising ${label} applies the operative's Administration, Science and Command every turn. `
        + 'This target\'s research output is not in this snapshot, so only the base advisory value is scored; '
        + 'the exact per-turn gain is computed per councilor at pairing time.';
    }
    return `Advising ${label} applies the operative's Administration, Science and Command every turn against a `
      + `measured ${research} research/turn base. The exact per-turn gain is computed per councilor at pairing time.`;
  },
  source: 'TIMissionTemplate Advise (persistentEffect, flat 10 Influence, 0 alien hate); per-councilor value '
    + 'from server/engine/adviseEconomics.js. Weights are judgement -- see WEIGHTS.ADVISORY.',
  estimateClass: 'heuristic'
};

module.exports = {
  gdpPerCpCost,
  defendInterests,
  counterCouncilor,
  unblockAlienResponse,
  advisoryPotential
};
