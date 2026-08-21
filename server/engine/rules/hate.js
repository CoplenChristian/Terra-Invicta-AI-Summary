// server/engine/rules/hate.js
//
// Alien-hate exposure: the one veto that must reach EVERY candidate, and the
// score rule that prices how close an action pushes hate to the next threshold.
//
// `hate/total-war-budget` is a veto for irreversible consequence. Its
// `appliesTo` is deliberately as wide as possible -- an earlier predicate
// required `candidate.hate.toAliens` to be present, so any generator that did
// not emit that exact shape opted its candidates out of the Total War budget
// check entirely and a missing measurement silently bought a pass. Absence is
// now an 'unknown' outcome inside evaluate, where it is recorded and
// confidence-downgraded rather than passed.

const { toFiniteNumber } = require('../../../shared/util.mjs');
const { ALIEN_HATE_WAR_THRESHOLD, ALIEN_TOTAL_WAR_HATE } = require('../../alienHateEconomics');
const { getWeights } = require('../weights');

const totalWarBudget = {
  id: 'hate/total-war-budget',
  // Applies to EVERY candidate, including one whose hate exposure is not in
  // the snapshot at all. The old predicate required `candidate.hate` to be
  // present with a non-null `toAliens`, so any generator that did not emit
  // that exact shape opted its candidates out of the Total War budget check
  // entirely -- a missing measurement silently bought a pass. Absence is now
  // an 'unknown' outcome inside evaluate, where it is recorded and
  // confidence-downgraded.
  kind: 'veto',
  appliesTo: (candidate) => candidate.isFallback !== true,
  evaluate(world, candidate) {
    const envelope = candidate.hate?.toAliens;
    if (!envelope || !Number.isFinite(envelope.high)) return 'unknown';
    // A partially-populated outcome row cannot bound the exposure: knowing
    // success costs 0 says nothing about the failure slot we never read.
    if (Number.isFinite(envelope.measuredSlots)
      && Number.isFinite(envelope.totalSlots)
      && envelope.measuredSlots < envelope.totalSlots) {
      return 'unknown';
    }
    const high = envelope.high;
    // Zero measured exposure can never breach a budget, regardless of
    // whether the budget itself is observable -- this is what keeps
    // Control Nation / Investigate / Turn candidates from being
    // confidence-downgraded by a redacted hate meter they don't expose
    // any hate to in the first place.
    if (!(high > 0)) return 'pass';
    const proximity = world.posture ? world.posture.totalWarProximity : null;
    if (proximity === 'unknown' || proximity === null || proximity === undefined) return 'unknown';
    const headroom = world.posture.totalWarHeadroom;
    if (headroom === null || headroom === undefined || !Number.isFinite(headroom)) return 'unknown';
    const budget = headroom * getWeights(world).TOTAL_WAR_SAFETY_MARGIN;
    return high > budget ? 'veto' : 'pass';
  },
  because(world, candidate) {
    const envelope = candidate.hate?.toAliens;
    if (!envelope || !Number.isFinite(envelope.high)) {
      return `Alien-hate exposure for ${candidate.missionType || 'this action'} is not recorded in this `
        + 'snapshot, so the Total War budget check could not be evaluated -- unknown, not zero.';
    }
    if (Number.isFinite(envelope.measuredSlots)
      && Number.isFinite(envelope.totalSlots)
      && envelope.measuredSlots < envelope.totalSlots) {
      return `Only ${envelope.measuredSlots} of ${envelope.totalSlots} alien-hate outcome slots are recorded `
        + 'for this mission, so its worst branch cannot be bounded.';
    }
    const high = envelope.high;
    if (!(high > 0)) return 'This action carries no measured alien-hate exposure.';
    const proximity = world.posture ? world.posture.totalWarProximity : null;
    const headroom = world.posture ? world.posture.totalWarHeadroom : null;
    if (proximity === 'unknown' || headroom === null || headroom === undefined || !Number.isFinite(headroom)) {
      return 'Distance to Total War (200 hate) is not observable from this save/mode, so the budget check '
        + 'cannot clear this action.';
    }
    const budget = headroom * getWeights(world).TOTAL_WAR_SAFETY_MARGIN;
    return high > budget
      ? `Up to ${high} hate exceeds the safety-margined Total War budget `
        + `(${headroom.toFixed(1)} headroom × ${getWeights(world).TOTAL_WAR_SAFETY_MARGIN} = ${budget.toFixed(1)}).`
      : `Up to ${high} hate is within the safety-margined Total War budget `
        + `(${headroom.toFixed(1)} headroom × ${getWeights(world).TOTAL_WAR_SAFETY_MARGIN} = ${budget.toFixed(1)}).`;
  },
  source: 'wiki Diplomacy § "Alien Total War" (rev 2026-08-11); headroom from directiveAdvisor.assessCampaignPosture.',
  estimateClass: 'heuristic'
};

const warThresholdCrossing = {
  id: 'hate/war-threshold-crossing',
  kind: 'score',
  // A complete measured envelope, in the one canonical shape every
  // generator now emits (see normalizeCandidate). Candidates whose hate is
  // unmeasured are handled by hate/total-war-budget above, which routes them
  // to `uncertain` -- they are never scored as if their exposure were zero.
  appliesTo: (candidate) => Number.isFinite(candidate.hate?.toAliens?.low)
    && Number.isFinite(candidate.hate?.toAliens?.high),
  evaluate(world, candidate) {
    const { low, high } = candidate.hate.toAliens;
    const mid = (low + high) / 2;
    if (!(mid > 0)) return 0;
    const current = world.posture ? world.posture.actualAlienHate : null;
    let weight = getWeights(world).HATE_CROSSING.staysUnder50;
    if (current !== null && current !== undefined && Number.isFinite(current)) {
      const projected = current + high;
      if (current < ALIEN_TOTAL_WAR_HATE && projected >= ALIEN_TOTAL_WAR_HATE) {
        weight = getWeights(world).HATE_CROSSING.crossing200;
      } else if (current < ALIEN_HATE_WAR_THRESHOLD && projected >= ALIEN_HATE_WAR_THRESHOLD) {
        weight = getWeights(world).HATE_CROSSING.crossing50;
      }
    } else {
      // Redacted hate in player mode: evaluate using visible estimate and posture.
      //
      // `totalWarProximity` can also be 'forecast'
      // (server/directiveAdvisor.js:453), which is deliberately NOT handled
      // here. 'forecast' is only reachable via `hateInApproachBand`, which
      // itself requires `actualAlienHate !== null` -- so a 'forecast'
      // posture always takes the measured branch above and never reaches
      // this one. Adding a 'forecast' arm here would be dead code that reads
      // as though it does something.
      //
      // 'active' DOES reach here in player mode: directiveAdvisor derives
      // `totalWarActive` from `totalWarState === 'active'`, which is
      // independent of whether hate itself is visible. So once Total War is
      // declared, the 10x crossing200 weight applies even with hate
      // redacted. Pinned by a regression test -- do not "simplify" it away.
      const pips = toFiniteNumber(world.posture?.pips);
      const totalWarProx = world.posture?.totalWarProximity;
      if (totalWarProx === 'active' || totalWarProx === 'near') {
        weight = getWeights(world).HATE_CROSSING.crossing200;
      } else if (world.posture?.warExceeded || world.posture?.hateHot || world.posture?.hateElevated || (pips !== null && pips >= 4)) {
        weight = getWeights(world).HATE_CROSSING.crossing50;
      } else if (pips !== null && pips < 4) {
        weight = getWeights(world).HATE_CROSSING.staysUnder50;
      } else {
        weight = getWeights(world).HATE_CROSSING.crossing50;
      }
    }
    return -(mid * weight * getWeights(world).HATE_POINTS);
  },
  because(world, candidate) {
    const { low, high } = candidate.hate.toAliens;
    const mid = (low + high) / 2;
    if (!(mid > 0)) return 'No expected alien hate from this action.';
    const current = world.posture ? world.posture.actualAlienHate : null;
    if (current === null || current === undefined || !Number.isFinite(current)) {
      const pips = toFiniteNumber(world.posture?.pips);
      const totalWarProx = world.posture?.totalWarProximity;
      if (totalWarProx === 'active' || totalWarProx === 'near') {
        return `Alien hate is unobservable but Total War proximity is ${totalWarProx} -- scored at 10x crossing200.`;
      }
      if (world.posture?.warExceeded || world.posture?.hateHot || world.posture?.hateElevated || (pips !== null && pips >= 4)) {
        return `Alien hate is unobservable but visible estimate is ${pips !== null ? pips + '/5 diamonds' : 'elevated'} -- scored at 3x crossing50.`;
      }
      if (pips !== null && pips < 4) {
        return `Visible hate meter ${pips}/5 diamonds is below threshold -- scored at 1x stays-under-50.`;
      }
      return 'Alien hate is unobservable; scored conservatively at 3x crossing50.';
    }
    const projected = current + high;
    if (current < ALIEN_TOTAL_WAR_HATE && projected >= ALIEN_TOTAL_WAR_HATE) {
      return `Current hate ${current.toFixed(1)} + up to ${high} would cross the irreversible Total War `
        + `line at ${ALIEN_TOTAL_WAR_HATE} -- scored at 10x.`;
    }
    if (current < ALIEN_HATE_WAR_THRESHOLD && projected >= ALIEN_HATE_WAR_THRESHOLD) {
      return `Current hate ${current.toFixed(1)} + up to ${high} would cross the war threshold at `
        + `${ALIEN_HATE_WAR_THRESHOLD} -- scored at 3x.`;
    }
    return `Current hate ${current.toFixed(1)} + up to ${high} stays clear of the next threshold -- scored at 1x.`;
  },
  source: 'docs/archive/directive-rule-engine-plan.md §2 -- cost ladder is ASSUMPTION, tunable weights, anchored on '
    + 'the war/Total War thresholds from wiki Diplomacy (rev 2026-08-11).',
  estimateClass: 'heuristic'
};

module.exports = { totalWarBudget, warThresholdCrossing };
