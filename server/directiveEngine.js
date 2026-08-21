/**
 * Directive Rule Engine — orchestration and public entry point.
 * Purpose: the v2 directive rule engine orchestration and public entry point —
 *   turning a frozen world snapshot into ranked directives.
 *
 * Turns a frozen "world" snapshot into a ranked set of concrete action
 * candidates, using data-driven rules instead of the hand-tuned policyRank
 * ladder in briefingGenerator.js. See docs/archive/directive-rule-engine-plan.md for
 * the v1 design and docs/archive/directive-engine-v2-plan.md §1 for this layout.
 *
 * Architecture (plan §3):
 *   world -> generateCandidates -> applyRules -> scoreCandidates -> primary
 *
 * A veto rule returns one of THREE outcomes, never collapsed to two:
 *   'pass'    - the candidate is unaffected by this rule
 *   'veto'    - the candidate is rejected outright
 *   'unknown' - the input this rule needs is unmeasurable from this
 *               snapshot/mode. The candidate survives but moves to the
 *               `uncertain` bucket, confidence-downgraded, carrying a reason
 *               naming what could not be measured. `unknown` must never be
 *               read as `pass` -- that would render an absent measurement as
 *               a confident "safe", which is the failure mode this codebase
 *               exists to avoid (see server/directiveAdvisor.js and
 *               shared/alienHateEconomics.mjs for the same discipline).
 *
 * `primary` is always drawn from `surviving` candidates, so it is always an
 * action. If every generated candidate is vetoed, a positive preparation
 * action is returned explicitly -- never a negative prohibition. Rejected and
 * uncertain candidates remain explanatory evidence under decisionReasoning.
 *
 * Pure module: no I/O, no network, no filesystem. Only requires the modules
 * under ./engine, ./directiveAdvisor, ./alienHateEconomics, ../shared/util.mjs
 * and node builtins, so the same logic runs identically in tests, the local
 * server, and any future export path.
 *
 * ---------------------------------------------------------------------------
 * This file used to BE the engine -- 1,731 lines holding the weights, four
 * hand-written generators, the candidate schema, twelve rules, the selection
 * pass and the orchestration. The 2026-08-20 code review (section D) flagged
 * it as a multi-functional file, so the bodies moved into `server/engine/`
 * following the layout docs/archive/directive-engine-v2-plan.md §1 sketches, and this
 * file kept only `buildWorld` and `runEngine`.
 *
 * Every export below is the SAME function or object the module exports,
 * re-exported rather than wrapped, so `runEngine`'s signature and result shape
 * are untouched and no caller changed: server/briefingGenerator.js and the
 * four engine test suites are unmodified.
 *
 *   engine/weights.js            WEIGHTS + the per-world override merge
 *   engine/campaignDate.js       date parsing and the 4-state ward status
 *   engine/candidates/
 *     controlPoints.js           neutral control points (Control Nation)
 *     defense.js                 Defend Interests over owned holdings
 *     council.js                 the zero-hate Investigate -> Turn axis
 *     intelligence.js            sightings gap and alien Detain
 *     missions.js                generic MissionSpec x targets (pre-existing)
 *     normalize.js               the one candidate schema + dedupe predicates
 *     index.js                   generation order, spec join, dedupe
 *   engine/rules/
 *     hate.js legality.js value.js readiness.js portfolio.js
 *     index.js                   the registry -- ORDER IS LOAD-BEARING
 *   engine/selection.js          applyRules, scoreCandidates, fallback,
 *                                decisionReasoning
 *
 * Where the plan's §1 sketch and this layout differ, and why:
 *  - The plan lists `candidates/{build,research,fleet}.js`. Those generators
 *    do not exist yet, so no empty files were created for them.
 *  - The plan does not name `candidates/normalize.js` or `engine/weights.js`.
 *    Both earned a module: the schema normaliser is what makes a rule's
 *    `appliesTo` predicate correct for every generator, and the weights are
 *    read by both the council generator and five rules, so leaving them in
 *    the orchestration file would have made it a dependency of its own
 *    children.
 *  - `campaignDate.js` is likewise unlisted; `defenseStatus` is a three-state
 *    answer shared by the defense generator and worth isolating from it.
 * ---------------------------------------------------------------------------
 */

const directiveAdvisor = require('./directiveAdvisor');
const { sameId } = require('../shared/util.mjs');
const { allocateCyclePlan } = require('./engine/assignment');
const { WEIGHTS } = require('./engine/weights');
const { RULES } = require('./engine/rules');
const { generateCandidates } = require('./engine/candidates');
const { generateOpenControlPointCandidates } = require('./engine/candidates/controlPoints');
const { generateDefendInterestsCandidates } = require('./engine/candidates/defense');
const { generateCouncilCandidates } = require('./engine/candidates/council');
const { generateIntelligenceCandidates } = require('./engine/candidates/intelligence');
const {
  applyRules,
  scoreCandidates,
  buildPreparationFallbackCandidate,
  buildDecisionReasoning
} = require('./engine/selection');

/**
 * How many entries of each explanatory list (`rejected`, `uncertain`,
 * `futureOpportunities`) the engine result carries. These lists exist to show
 * a reader WHY something was not recommended; several hundred near-identical
 * entries do not explain better than the highest-scoring few plus a count, and
 * they cost megabytes on the wire. Every capped list is emitted alongside its
 * true total and the number omitted -- a bounded view, not a quiet truncation.
 */
const EXPLANATORY_LIST_LIMIT = 25;

/**
 * Wraps a set of already-computed snapshot-derived inputs into the frozen
 * world object the rest of this module reads. `posture` is expected to be
 * the output of directiveAdvisor.assessCampaignPosture -- computed once by
 * the caller (briefingGenerator already does this for its own directives),
 * not recomputed here, per "reuse posture/proxy logic, not replace."
 */
function buildWorld({
  observerId = null,
  observerName = null,
  posture = null,
  campaignDate = null,
  resources = null,
  nations = [],
  councilors = [],
  // Advise applies to owned habs as well as nations (+Adm% resource outputs,
  // +Sci% research, +Cmd% marine combat). This parameter did not exist, and
  // briefingGenerator did not pass it, so `advise-hab:*` candidates were
  // unreachable on a live save and the "councilor is currently advising a hab"
  // commitment could never be priced -- both paths were unit-tested only.
  habs = [],
  capabilities = {},
  alienIntelligenceStage = null,
  directiveWeights = null,
  missionSpecs = null,
  alienHate = null,
  alienThreat = null,
  // The computed hate economics block. It carries the measured minimum-hate
  // FLOOR (and used/available Mission Control) even in player mode, where the
  // raw assessed hate is redacted -- without it the cycle hate budget had no
  // measured input at all in the mode the dashboard defaults to.
  alienHateEconomics = null,
  usedMC = null,
  mcCapacity = null
} = {}) {
  return Object.freeze({
    observerId,
    observerName,
    posture: posture || {},
    campaignDate,
    resources: resources || null,
    nations: Array.isArray(nations) ? nations : [],
    councilors: Array.isArray(councilors) ? councilors : [],
    habs: Array.isArray(habs) ? habs : [],
    capabilities: capabilities || {},
    directiveWeights: directiveWeights || null,
    // Survives player-mode filtering when the raw alien councilor list does
    // not, so it is the only signal for "capability on, nothing sighted".
    alienIntelligenceStage: alienIntelligenceStage || null,
    missionSpecs: missionSpecs || null,
    alienHate: alienHate || null,
    alienThreat: alienThreat || null,
    alienHateEconomics: alienHateEconomics || null,
    usedMC: usedMC === null || usedMC === undefined ? null : usedMC,
    mcCapacity: mcCapacity === null || mcCapacity === undefined ? null : mcCapacity
  });
}

/**
 * generateCandidates -> applyRules -> scoreCandidates -> primary = max(surviving).
 *
 * Reclassification: a candidate rejected specifically because it is an
 * unformed nation (legality/no-territory, territoryClass === 'unformed') is
 * moved out of `rejected` and into `futureOpportunities`. Per the plan, an
 * unformed nation's unclaimed CP is not a takeable-but-blocked action, it is
 * a DIFFERENT kind of advice -- "this becomes available once a formation
 * project fires" -- so it does not belong on the same "here's what we
 * rejected and why" board as a genuinely illegal move. Absorbed nations
 * (population > 0, 0 regions) stay in `rejected`: their territory is gone
 * for good, there is no future project that un-absorbs them.
 */
function runEngine(world) {
  // Anything dropped before the rules ran is recorded, not silently absent --
  // a target the engine could not identify is a gap in the board, and a gap
  // the reader cannot see reads as "there was nothing there".
  const droppedCandidates = [];
  const candidates = generateCandidates(world, droppedCandidates);
  const { surviving, rejected, uncertain } = applyRules(world, candidates);

  const finalRejected = [];
  const futureOpportunities = [];
  for (const entry of rejected) {
    if (entry.candidate.value?.territoryClass === 'unformed') {
      futureOpportunities.push({
        ...entry.candidate,
        unmetPreconditions: [
          ...entry.candidate.unmetPreconditions,
          `${entry.candidate.target.nation} has not formed yet (0 regions, 0 population) -- this control `
            + 'point becomes takeable only after its formation project or event fires.'
        ]
      });
    } else {
      finalRejected.push(entry);
    }
  }

  const scoredSurviving = scoreCandidates(world, surviving.map((e) => e.candidate));

  // Every list is a flat array of candidates, and a candidate carries its own
  // reasons. The alternative -- candidates in some lists and { candidate,
  // reasons } wrappers in others -- makes every consumer branch on which list
  // it happens to be reading.
  const scoredUncertain = scoreCandidates(world, uncertain.map((e) => e.candidate))
    .map((candidate, i) => ({ ...candidate, uncertaintyReasons: uncertain[i].reasons }));
  const rejectedCandidates = finalRejected.map((entry) => ({
    ...entry.candidate,
    vetoReasons: entry.reasons
  }));

  const ownCouncilors = Array.isArray(world.councilors)
    ? world.councilors.filter((c) => !world.observerId || sameId(c.factionId, world.observerId) || c.isObserver)
    : [];

  const cyclePlan = allocateCyclePlan(scoredSurviving, ownCouncilors, world);

  let primary;
  let alternatives;
  if (cyclePlan.assignments.length > 0) {
    primary = {
      ...cyclePlan.assignments[0].candidate,
      assignedCouncilor: cyclePlan.assignments[0].councilor,
      assignment: cyclePlan.assignments[0]
    };
    alternatives = cyclePlan.assignments.slice(1).map((a) => a.candidate);
  } else if (scoredSurviving.length > 0) {
    const sorted = [...scoredSurviving].sort((a, b) => b.score - a.score);
    [primary, ...alternatives] = sorted;
  } else {
    primary = buildPreparationFallbackCandidate(world, rejectedCandidates, scoredUncertain);
    alternatives = [];
  }

  // Correct candidate ids took the board from 5 catalogue candidates to ~400,
  // and in player mode every hate-bearing one lands in `uncertain` for the
  // same reason (Total War proximity is unobservable there). Emitting all of
  // them verbatim pushed the briefing payload past 1.3 MB of near-identical
  // entries. The lists are capped for transport; the FULL counts stay in
  // decisionReasoning.counts and in the explicit `*OmittedCount` fields, so
  // this is a bounded view of a known total, never a silently shortened one.
  // Tallied BEFORE the transport caps are applied, because the caps exist to
  // bound the payload, not to change the count. A Hold Ground directive that
  // says "3 Purge candidates deferred" when 41 were held would be reporting a
  // slice as a total -- the same defect class as fabricating the number.
  // Only hate-bearing candidates count: deferring a zero-hate mission is not
  // something a hate hold did.
  const heldHateBearingByMission = {};
  for (const entry of [...rejectedCandidates, ...scoredUncertain]) {
    const high = entry?.hate?.toAliens?.high;
    if (!(typeof high === 'number' && Number.isFinite(high) && high > 0)) continue;
    const key = entry.missionType || 'Unattributed mission';
    heldHateBearingByMission[key] = (heldHateBearingByMission[key] || 0) + 1;
  }

  const byScoreDesc = (a, b) => (Number.isFinite(b.score) ? b.score : -Infinity)
    - (Number.isFinite(a.score) ? a.score : -Infinity);
  const cappedUncertain = [...scoredUncertain].sort(byScoreDesc).slice(0, EXPLANATORY_LIST_LIMIT);
  const cappedRejected = rejectedCandidates.slice(0, EXPLANATORY_LIST_LIMIT);
  const cappedFuture = futureOpportunities.slice(0, EXPLANATORY_LIST_LIMIT);

  return {
    primary,
    alternatives,
    rejected: cappedRejected,
    rejectedTotalCount: rejectedCandidates.length,
    rejectedOmittedCount: rejectedCandidates.length - cappedRejected.length,
    uncertain: cappedUncertain,
    uncertainTotalCount: scoredUncertain.length,
    uncertainOmittedCount: scoredUncertain.length - cappedUncertain.length,
    futureOpportunities: cappedFuture,
    futureOpportunitiesTotalCount: futureOpportunities.length,
    futureOpportunitiesOmittedCount: futureOpportunities.length - cappedFuture.length,
    droppedCandidates,
    // missionType -> how many hate-bearing candidates the rules held back this
    // cycle (rejected or unmeasurable). Uncapped; a mission with none held gets
    // no key rather than a 0.
    heldHateBearingByMission,
    cyclePlan,
    decisionReasoning: buildDecisionReasoning(
      primary,
      alternatives,
      rejectedCandidates,
      scoredUncertain,
      futureOpportunities,
      candidates.length
    )
  };
}

module.exports = {
  WEIGHTS,
  RULES,
  buildWorld,
  generateOpenControlPointCandidates,
  generateDefendInterestsCandidates,
  generateCouncilCandidates,
  generateIntelligenceCandidates,
  generateCandidates,
  applyRules,
  scoreCandidates,
  runEngine,
  buildDecisionReasoning,
  // Exposed for tests and for callers (e.g. a future UI) that want the
  // shared posture formatter without re-deriving it.
  formatShipPosture: directiveAdvisor.formatShipPosture
};
