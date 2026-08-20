// server/engine/rules/index.js
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
// ORDER IS LOAD-BEARING. `applyRules` collects veto reasons in registry order
// and `scoreCandidates` emits `scoreBreakdown` in registry order, so both
// appear in a briefing in exactly this sequence. It is NOT grouped by family:
// `readiness/unmet-preconditions` sits in the middle of the value rules,
// which is where it has always been. The list below is written out one rule
// per line rather than spread per module so that the order is visible here
// and cannot drift when a module gains a rule.
// `tests/directiveEngine.test.js` pins this exact sequence.

const hate = require('./hate');
const legality = require('./legality');
const value = require('./value');
const readiness = require('./readiness');
const portfolio = require('./portfolio');

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
  portfolio.affordability
]);

module.exports = { RULES };
