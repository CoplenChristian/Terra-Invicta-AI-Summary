// server/engine/candidates/controlPoints.js
//
// Purpose: the open control-point candidate generator — neutral control points
//   the observer can take.
//
// (a) Open control points -- server/snapshotBuilder.js nations[].controlPoints[]
// where factionId is null (neutral).
//
// Every neutral CP becomes a candidate, including the ones that will be
// vetoed. Nothing is silently dropped at generation time: the territory and
// executive-last filters run as real veto rules (legality/no-territory,
// legality/executive-last) so their rejections are recorded with a reason,
// not filtered away before the pipeline sees them. The one exception is the
// `territoryClass: 'unformed'` case, which the top-level `runEngine` orchestration
// moves from `rejected` into `futureOpportunities` after the veto fires --
// see the comment on that reclassification in directiveEngine.js for why.
//
// Measured on the 2026-08-20 live save (136 unclaimed CPs; the plan's
// write-up from the previous day cites 120/8, one day of campaign drift
// off the 121/7 measured here):
//   121 unformed nations   (0 regions, 0 population -- e.g. Aceh, Alaska)
//     7 absorbed nations   (0 regions, population on record -- e.g. Italy,
//                           East Germany; territory folded into a bloc)
//     4 executive CPs genuinely blocked by executive-last
//     4 actually takeable  (Malawi, Honduras, Madagascar, Namibia)

const { toFiniteNumber, sameId } = require('../../../shared/util.mjs');
const { marginalControlPointCost } = require('../../../shared/controlPointCap.mjs');

function buildControlNationCandidate(nation, cp, allCpsInNation, world) {
  const regionsCount = toFiniteNumber(nation.regionsCount);
  const population = toFiniteNumber(nation.population);
  const gdpRaw = toFiniteNumber(nation.GDP);
  const gdpBn = gdpRaw === null ? null : gdpRaw / 1e9;
  const hasTerritory = regionsCount !== null && regionsCount > 0;
  // Both unformed and absorbed nations report 0 regions; population is the
  // only field that tells them apart (absorbed nations keep a real
  // population on record even though their territory has been folded into a
  // bloc -- Italy 58.9M, East Germany 82.8M). When regionsCount itself is
  // unmeasurable, classification is left null rather than guessed.
  const territoryClass = regionsCount === null
    ? null
    : hasTerritory
      ? 'real'
      : (population !== null && population > 0 ? 'absorbed' : 'unformed');
  // sameId, not `!==`: strict inequality between a string id and a numeric one
  // marks a control point as "other" when it is in fact this same one, and two
  // absent ids collapse every CP in the nation onto this one -- which then
  // makes `allOtherCpsOwnedByObserver` a confident `true` over an empty list.
  const otherCps = allCpsInNation.filter((c) => !sameId(c.id, cp.id));
  const allOtherCpsOwnedByObserver = world.observerId === null || world.observerId === undefined
    ? null
    : otherCps.every((c) => sameId(c.factionId, world.observerId));

  return {
    id: `control-nation:${nation.displayName}:${cp.controlPointType}`,
    family: 'expansion',
    missionType: 'Control Nation',
    title: `Take the ${cp.controlPointType} control point in ${nation.displayName}`,
    target: {
      kind: 'controlPoint',
      nation: nation.displayName,
      faction: null,
      controlPointType: cp.controlPointType,
      isExecutive: cp.isExecutive === true
    },
    hate: {
      toAliens: { low: 0, high: 0 },
      note: 'TIMissionTemplate Control Nation (GainInfluence) hate row is [0,0,0,0,0,0] -- zero on every outcome slot.'
    },
    // No verified flat or bonus resource price for GainInfluence exists in
    // the sources this repo has checked (TIMissionTemplate is not present in
    // this repo; only the Notion-verified hate row and Defend Interests'
    // flat cost are confirmed). Absent stays null rather than invented.
    cost: null,
    value: {
      gdpBn,
      isExecutive: cp.isExecutive === true,
      cpCountInNation: allCpsInNation.length,
      nationName: nation.displayName,
      regionsCount,
      population,
      territoryClass,
      allOtherCpsOwnedByObserver,
      // What this control point would add to the observer's control-point
      // maintenance: the nation's total cost divided by the nation's own
      // control-point count (wiki Nations, "Cost of Control Points", raw
      // wikitext read 2026-08-22). Madagascar's Executive costs ~3 cp;
      // one of the USA's six costs ~39.
      //
      // AN ANNOTATION, NOT A RULE, DELIBERATELY. No rule reads it and no score
      // moves because of it. The cap it would have to be checked against does
      // not reconcile against the save's own recorded overage
      // (shared/controlPointCap.mjs), so there is no honest threshold to veto
      // or price against -- and a veto built on a fabricated ceiling would
      // reject real recommendations. What IS sound is the relative figure: a
      // reader can compare two candidate control points without any claim about
      // affordability, because the per-control-point cost does not depend on
      // the unresolved base cap.
      //
      // Null-safe by construction: an unpriceable nation yields
      // `{ available: false, cost: null, reason }` rather than a zero that
      // would read as a free control point.
      controlPointMaintenance: marginalControlPointCost(nation)
    },
    score: null,
    provenance: {
      source: 'snapshot nations[].controlPoints[]; hate row from TIMissionTemplate GainInfluence',
      estimateClass: 'exact'
    },
    unmetPreconditions: []
  };
}

function generateOpenControlPointCandidates(world) {
  const candidates = [];
  for (const nation of world.nations) {
    const cps = Array.isArray(nation.controlPoints) ? nation.controlPoints : [];
    const neutralCps = cps.filter((cp) => cp.factionId === null || cp.factionId === undefined);
    for (const cp of neutralCps) {
      candidates.push(buildControlNationCandidate(nation, cp, cps, world));
    }
  }
  return candidates;
}

module.exports = { buildControlNationCandidate, generateOpenControlPointCandidates };
