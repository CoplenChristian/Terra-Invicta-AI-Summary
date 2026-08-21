// server/engine/rules/index.js
//
// Purpose: the rule registry — the one ordered list whose sequence is
//   load-bearing for veto collection and score breakdown, plus the
//   candidate/pairing scope each rule is evaluated against.
//
// The rule registry.
//
// A veto rule returns one of THREE outcomes, never collapsed to two:
//   'pass'    - the candidate is unaffected by this rule
//   'veto'    - the candidate is rejected outright
//   'unknown' - the input this rule needs is unmeasurable from this
//               snapshot/mode. The candidate survives but moves to the
//               `uncertain` bucket, confidence-downgraded, carrying a reason
//               naming what could not be measured. `unknown` must never be
//               read as `pass`.
//
// A score rule returns a number, positive for value and negative for cost.
//
// A rule also declares its SCOPE, defaulting to 'candidate' when it does not
// say. A 'candidate' rule is evaluated by `applyRules` against a bare
// candidate; a 'pairing' rule is evaluated by `applyPairingRules` against a
// (candidate, councilor) pairing, because what it reads -- success odds --
// does not exist until a councilor is named. Both walk THIS list in order, so
// the two passes cannot disagree about sequence.
//
// ORDER IS LOAD-BEARING. `applyRules` collects veto reasons in registry order
// and `scoreCandidates` emits `scoreBreakdown` in registry order, so both
// appear in a briefing in exactly this sequence. It is NOT grouped by family:
// `readiness/unmet-preconditions` sits in the middle of the value rules,
// which is where it has always been. The list below is written out one rule
// per line rather than spread per module so that the order is visible here
// and cannot drift when a module gains a rule.
// `tests/directiveEngine.test.js` pins this exact sequence.
//
// `risk/success-floor` is APPENDED rather than slotted beside the other
// vetoes: like `cost/affordability` it is a veto that reads after every score,
// and it is the last thing a reader should see because it answers "and are you
// willing to take this bet" about an action that already cleared everything
// else. Appending also leaves the twelve existing positions untouched, which
// is what keeps every existing explanation reading exactly as it did.

const hate = require('./hate');
const legality = require('./legality');
const value = require('./value');
const readiness = require('./readiness');
const portfolio = require('./portfolio');
const risk = require('./risk');

const RULES = Object.freeze([
  hate.totalWarBudget,
  hate.warThresholdCrossing,
  legality.executiveLast,
  legality.noTerritory,
  legality.storyGate,
  value.gdpPerCpCost,
  value.defendInterests,
  value.counterCouncilor,
  readiness.unmetPreconditions,
  value.unblockAlienResponse,
  value.advisoryPotential,
  portfolio.affordability,
  risk.successFloor
]);

/** A rule that does not declare a scope is evaluated against a candidate. */
const DEFAULT_RULE_SCOPE = 'candidate';

function ruleScope(rule) {
  return rule?.scope || DEFAULT_RULE_SCOPE;
}

module.exports = { RULES, DEFAULT_RULE_SCOPE, ruleScope };
