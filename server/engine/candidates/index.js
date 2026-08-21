// server/engine/candidates/index.js
//
// Purpose: the generation pass — run every generator, attach mission specs,
//   add catalogue-derived candidates, then normalise and dedupe.
//
// The generation pass: run every generator, attach the mission spec each
// hand-written candidate names but does not carry, add the catalogue-derived
// candidates, then normalise and dedupe.
//
// Generator order is load-bearing. `generateCandidates` returns the list in
// emission order, dedupe keeps the FIRST candidate for a given id, and the
// downstream lists (`rejected`, `uncertain`, `futureOpportunities`) are sliced
// from it -- so reordering the generators would reorder the board.

const { MissionCatalogue } = require('../missionCatalogue');
const { generateMissionCandidatesFromSpecs } = require('./missions');
const { generateOpenControlPointCandidates } = require('./controlPoints');
const { generateDefendInterestsCandidates } = require('./defense');
const { generateCouncilCandidates } = require('./council');
const { generateIntelligenceCandidates } = require('./intelligence');
const { looksUnresolved, normalizeCandidate } = require('./normalize');

/**
 * @param {object} world
 * @param {Array} [diagnostics] optional sink recording every candidate dropped
 *   before the rules ran, and why. Surfaced on the engine result as
 *   `droppedCandidates` so a dropped target is visible rather than absent.
 */
function generateCandidates(world, diagnostics = null) {
  const existing = [
    ...generateOpenControlPointCandidates(world),
    ...generateDefendInterestsCandidates(world),
    ...generateCouncilCandidates(world),
    ...generateIntelligenceCandidates(world)
  ];

  if (world.missionSpecs && typeof world.missionSpecs === 'object') {
    const catalogue = new MissionCatalogue(world.missionSpecs);

    // The hand-written generators name their mission but carry none of its
    // rules, so the odds layer saw no spec and reported odds unavailable even
    // on a snapshot shipping all 43 templates. The catalogue indexes by
    // friendlyName as well as dataName, which is what `missionType` holds.
    //
    // Defend Interests is the case that shows why this matters: its spec says
    // `contested: false`, which is the difference between "100%, automatic"
    // and "there is no roll here to compute".
    for (const candidate of existing) {
      if (candidate.missionSpec || candidate.templateApplies === false) continue;
      const spec = catalogue.get(candidate.missionType);
      if (spec) candidate.missionSpec = spec;
    }

    existing.push(...generateMissionCandidatesFromSpecs(world, catalogue, diagnostics));
  }

  // Normalise first, then dedupe. An id is the dedupe key, so a candidate
  // whose identity did not resolve must be DROPPED with a reason rather than
  // colliding with every other candidate that failed to resolve the same way.
  const seenIds = new Set();
  const normalized = [];
  for (const raw of existing) {
    const candidate = normalizeCandidate(raw);
    if (looksUnresolved(candidate.id)) {
      if (Array.isArray(diagnostics)) {
        diagnostics.push({
          missionType: candidate.missionType,
          reason: 'unresolvable-candidate-id',
          detail: `Candidate id ${JSON.stringify(candidate.id)} did not resolve to a real target identity, `
            + 'so it cannot be deduplicated or referenced. Dropped rather than merged with other unresolved targets.'
        });
      }
      continue;
    }
    if (seenIds.has(candidate.id)) continue;
    seenIds.add(candidate.id);
    normalized.push(candidate);
  }

  return normalized;
}

module.exports = { generateCandidates };
