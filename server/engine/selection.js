// server/engine/selection.js
//
// Purpose: the middle two stages of the engine pipeline — applying the rules
//   (candidate-scoped and pairing-scoped) and scoring what survives.
//
// Applying the rules and scoring what survives: the middle two stages of
// `world -> generateCandidates -> applyRules -> scoreCandidates -> primary`.
//
// Also holds the explicit preparation fallback and the decision-reasoning
// block, because both are shaped by what the rules did to the board rather
// than by any one candidate.

const { toFiniteNumber } = require('../../shared/util.mjs');
const { RULES, ruleScope } = require('./rules');
const { getWeights } = require('./weights');

/**
 * Candidate-scoped vetoes only.
 *
 * The scope filter is not decoration. A pairing-scoped rule reads success odds,
 * which do not exist until a councilor is named, so evaluating one here could
 * only ever return 'unknown' -- and that would sweep EVERY candidate into the
 * `uncertain` bucket and out of the cycle plan. The filter is what keeps
 * "this rule cannot be answered yet" from being mistaken for "this rule was
 * answered and the answer was unknown".
 */
function evaluateVetoes(world, candidate) {
  return RULES
    .filter((rule) => rule.kind === 'veto' && ruleScope(rule) === 'candidate' && rule.appliesTo(candidate))
    .map((rule) => ({ rule, outcome: rule.evaluate(world, candidate) }));
}

/**
 * Pairing-scoped vetoes, in the SAME registry order.
 *
 * A pairing is `{ candidate, councilor, odds, ... }` from server/engine/pairing.js.
 * The three outcomes mean here exactly what they mean for a candidate: 'veto'
 * rejects the pairing, 'unknown' means the rule's input was unmeasurable and
 * the pairing survives carrying a reason that says so, 'pass' clears it.
 * `unknown` is NEVER read as `pass`.
 *
 * Each entry also carries the rule's structured `detail` when it publishes one,
 * so a consumer renders the numbers the veto actually decided on instead of
 * recomputing them from the odds and drifting.
 */
function evaluatePairingVetoes(world, pairing) {
  return RULES
    .filter((rule) => rule.kind === 'veto' && ruleScope(rule) === 'pairing' && rule.appliesTo(pairing))
    .map((rule) => {
      // One assessment, not three. A rule offering `assess` computes its
      // outcome, its reason and its structured detail together, so the three
      // can never disagree -- and so the allocator does not pay for the same
      // derivation three times over several thousand pairings.
      const assessment = typeof rule.assess === 'function' ? rule.assess(world, pairing) : null;
      return {
        rule,
        assessment,
        outcome: assessment ? assessment.outcome : rule.evaluate(world, pairing)
      };
    });
}

/**
 * pairing -> { outcome, entries }.
 *
 * `outcome` is 'veto' if any pairing rule vetoes, else 'unknown' if any returns
 * unknown, else 'pass'. It is null when no pairing-scoped rule applied at all,
 * which is a fourth, honest answer: nothing was checked, so nothing may be
 * claimed. Entries stay in registry order.
 */
function applyPairingRules(world, pairing) {
  const results = evaluatePairingVetoes(world, pairing);
  if (results.length === 0) return { outcome: null, entries: [] };

  const entries = results.map(({ rule, outcome, assessment }) => ({
    ruleId: rule.id,
    outcome,
    reason: assessment ? assessment.reason : rule.because(world, pairing),
    source: rule.source,
    detail: assessment || (typeof rule.detail === 'function' ? rule.detail(world, pairing) : null)
  }));

  const outcome = entries.some((entry) => entry.outcome === 'veto')
    ? 'veto'
    : (entries.some((entry) => entry.outcome === 'unknown') ? 'unknown' : 'pass');

  return { outcome, entries };
}

/**
 * candidates -> { surviving, rejected, uncertain }.
 *
 * A candidate is rejected if ANY applicable veto rule returns 'veto'. Absent
 * a veto, it is uncertain if ANY applicable veto rule returns 'unknown' --
 * confidence-downgraded but never silently promoted to surviving, and never
 * silently demoted to rejected. Only when every applicable veto rule passes
 * does the candidate survive.
 */
function applyRules(world, candidates) {
  const surviving = [];
  const rejected = [];
  const uncertain = [];

  for (const candidate of candidates) {
    const results = evaluateVetoes(world, candidate);
    const vetoes = results.filter((r) => r.outcome === 'veto');
    const unknowns = results.filter((r) => r.outcome === 'unknown');

    if (vetoes.length > 0) {
      rejected.push({
        candidate,
        reasons: vetoes.map((v) => ({ ruleId: v.rule.id, reason: v.rule.because(world, candidate), source: v.rule.source }))
      });
    } else if (unknowns.length > 0) {
      uncertain.push({
        candidate: {
          ...candidate,
          provenance: { ...candidate.provenance, confidenceDowngradedBy: unknowns.map((u) => u.rule.id) }
        },
        reasons: unknowns.map((u) => ({ ruleId: u.rule.id, reason: u.rule.because(world, candidate), source: u.rule.source }))
      });
    } else {
      surviving.push({ candidate });
    }
  }

  return { surviving, rejected, uncertain };
}

/**
 * score = value - hateCost - resourceCost (plan §3 objective function).
 * value and hateCost come from the applicable 'score' rules; resourceCost is
 * computed directly here from candidate.cost, since none of the six named
 * rules cover it and it is a straightforward ratio rather than a judgement
 * ladder. It is recorded as a calculated breakdown entry so the explanation
 * can show the cost that lowered a recommendation's score. A candidate whose
 * cost amount is unfillable (Turn/Investigate's
 * bonus cost, per plan §4) or whose stock is unmeasured contributes 0 to
 * resourceCost -- score-neutral, not a claim that the cost is actually zero
 * (the safety-relevant version of "can we afford this" is the
 * cost/affordability VETO above, which correctly returns 'unknown' rather
 * than a number when stock is unmeasured).
 */
function computeResourceCost(world, candidate) {
  if (!candidate.cost || candidate.cost.amount === null || candidate.cost.amount === undefined) return 0;
  const stock = world.resources ? toFiniteNumber(world.resources[candidate.cost.resource]) : null;
  if (stock === null || !(stock > 0)) return 0;
  return (candidate.cost.amount / stock) * getWeights(world).RESOURCE_POINTS;
}

function scoreCandidates(world, candidates) {
  return candidates.map((candidate) => {
    const scoreRules = RULES.filter((rule) => rule.kind === 'score' && rule.appliesTo(candidate));
    const breakdown = scoreRules.map((rule) => ({
      ruleId: rule.id,
      contribution: rule.evaluate(world, candidate),
      reason: rule.because(world, candidate),
      source: rule.source,
      estimateClass: rule.estimateClass
    }));
    const resourceCost = computeResourceCost(world, candidate);
    if (resourceCost > 0) {
      breakdown.push({
        ruleId: 'resource-cost',
        contribution: -resourceCost,
        reason: `Consumes ${resourceCost.toFixed(2)} configured resource-cost points.`,
        source: 'directiveEngine objective function',
        estimateClass: 'calculated'
      });
    }
    const total = breakdown.reduce((sum, entry) => sum + (Number.isFinite(entry.contribution) ? entry.contribution : 0), 0);
    return { ...candidate, score: total, scoreBreakdown: breakdown, resourceCost };
  });
}

/**
 * The explicit fallback when every generated candidate is vetoed. Never
 * null, never an empty state, and its title names a preparation action rather
 * than reading as a bare prohibition -- the same structural fix the plan
 * describes for the old geo-hold directive.
 *
 * `family` doesn't fit the normal expansion/council/intelligence split; it
 * is tagged 'council' as the closest fit (this is posture-level advice, not
 * a specific mission), and callers can key off `isFallback` instead of
 * `family` if they need to distinguish it.
 */
function buildPreparationFallbackCandidate(world, rejected, uncertain) {
  return {
    id: 'prepare-next-action',
    family: 'council',
    missionType: 'Prepare',
    title: 'Protect strategic posture and prepare the next actionable move',
    recommendation: 'Maintain defensive coverage, resolve the missing intelligence, and revisit the highest-value operation next cycle.',
    target: { kind: 'none', nation: null, faction: null, controlPointType: null, isExecutive: null },
    hate: { toAliens: { low: 0, high: 0 }, note: 'Holding spends no hate.' },
    cost: null,
    value: { rejectedCount: rejected.length, uncertainCount: uncertain.length },
    score: null,
    provenance: {
      source: 'directiveEngine preparation fallback -- every generated candidate this cycle was vetoed or is unmeasurable',
      estimateClass: 'exact'
    },
    unmetPreconditions: [],
    isFallback: true
  };
}

function buildDecisionReasoning(primary, alternatives, rejected, uncertain, futureOpportunities, candidateCount) {
  const breakdown = Array.isArray(primary?.scoreBreakdown) ? primary.scoreBreakdown : [];
  const factors = breakdown.filter(entry => Number(entry.contribution) > 0);
  const tradeoffs = breakdown.filter(entry => Number(entry.contribution) < 0);
  const confidenceDowngraded = primary?.isFallback
    ? uncertain.length > 0
    : Boolean(
      primary?.provenance?.confidenceDowngradedBy?.length
      || primary?.unmetPreconditions?.length
    );
  const sources = [...new Set([
    primary?.provenance?.source,
    ...breakdown.map(entry => entry.source),
    ...((primary?.provenance?.confidenceDowngradedBy || []).map(String)),
    ...rejected.flatMap(entry => (entry.vetoReasons || []).map(reason => reason.source)),
    ...uncertain.flatMap(entry => (entry.uncertaintyReasons || []).map(reason => reason.source))
  ].filter(Boolean))];
  const counts = {
    generated: candidateCount,
    recommended: primary && !primary.isFallback ? 1 : 0,
    alternatives: alternatives.length,
    uncertain: uncertain.length,
    rejected: rejected.length,
    future: futureOpportunities.length
  };
  return {
    heading: 'Why this action',
    summary: primary?.isFallback
      ? 'No mission could be fully cleared from the available evidence, so the recommendation is a positive preparation step: protect the current posture and resolve the blockers.'
      : `${primary.title} ranks highest among the candidates that cleared the available safety and legality checks.`,
    selectionMethod: 'The engine combines configured value, alien-hate exposure, resource cost, and readiness. Rejected or unmeasurable candidates are shown as trade-offs, never as recommendations.',
    factors,
    tradeoffs,
    counts,
    confidence: confidenceDowngraded ? 'conditional' : 'supported',
    sources
  };
}

module.exports = {
  evaluateVetoes,
  evaluatePairingVetoes,
  applyPairingRules,
  applyRules,
  computeResourceCost,
  scoreCandidates,
  buildPreparationFallbackCandidate,
  buildDecisionReasoning
};
