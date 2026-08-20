// server/directives/index.js
//
// The policyRank directive ladder -- the v1 hand-tuned board that runs
// alongside server/directiveEngine.js rather than being replaced by it.
//
// The 2026-08-20 code review said the four directive builders "belong beside
// directiveEngine", and this is where they live now: a sibling directory to
// `server/engine/`, not a section of the briefing generator. They are kept
// separate from the engine itself because they are a different kind of thing.
// The engine generates candidates and scores them against data-driven rules;
// these produce ranked prose directives from a hand-tuned ladder, they are
// still needed because the engine does not yet cover space, research or
// mining, and folding them into `server/engine/` would put presentation strings
// inside a module documented as pure and I/O-free.

const { attachHateEstimate, buildGeopoliticalDirectives } = require('./geopolitical');
const { buildCouncilDirectives } = require('./council');
const { buildSpaceDirectives } = require('./space');
const { buildResearchDirectives } = require('./research');
const { buildHoldGroundDirective } = require('./holdGround');

module.exports = {
  attachHateEstimate,
  buildHoldGroundDirective,
  buildGeopoliticalDirectives,
  buildCouncilDirectives,
  buildSpaceDirectives,
  buildResearchDirectives
};
