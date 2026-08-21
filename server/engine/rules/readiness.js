// server/engine/rules/readiness.js
//
// Can we actually do this right now? A precondition the snapshot cannot
// confirm is a discount, not a veto -- the action may well be available
// in-game, so burying it would hide a real option, but an equally valuable
// action we KNOW is actionable should win the tie.

const { getWeights } = require('../weights');

const unmetPreconditions = {
  id: 'readiness/unmet-preconditions',
  kind: 'score',
  appliesTo: (candidate) => Array.isArray(candidate.unmetPreconditions) && candidate.unmetPreconditions.length > 0,
  evaluate(world, candidate) {
    // A discount, not a veto: the precondition is unverifiable rather than
    // known-unmet, so the action may well be available in-game. But
    // "recommended right now" should prefer something we can confirm is
    // actionable when values are otherwise close.
    return -(getWeights(world).UNMET_PRECONDITION_PENALTY * candidate.unmetPreconditions.length);
  },
  because(world, candidate) {
    const n = candidate.unmetPreconditions.length;
    return `${n} precondition${n === 1 ? '' : 's'} cannot be confirmed from this snapshot, so this ranks `
      + 'below an equally valuable action we know is available.';
  },
  source: 'docs/archive/directive-rule-engine-plan.md §4 -- Turn\'s HasSpySlot and HasIntelOnCouncilorSecrets are '
    + 'not in the snapshot and must not be presented as satisfiable.',
  estimateClass: 'heuristic'
};

module.exports = { unmetPreconditions };
