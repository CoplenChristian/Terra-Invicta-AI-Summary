/**
 * server/commentary/index.js
 * Purpose: the strategic commentary engine's top-level orchestrator, combining
 *   the four layers.
 *
 * Strategic Commentary Engine — Top-level Orchestrator.
 *
 * Combines:
 * - Layer 1: Null-honest facts extraction (facts.js)
 * - Layer 2: Deterministic narrative beats with Hold Ground guard (beats.js)
 * - Layer 3: Seeded Monte Carlo combat threshold simulation (simulation.js)
 * - Layer 4: Seeded templated grammar with measured/simulated distinction (grammar.js)
 */

'use strict';

const { extractFacts } = require('./facts');
const { evaluateBeats } = require('./beats');
const { runMonteCarloSimulation } = require('./simulation');
const { generateGrammar } = require('./grammar');

/**
 * Generates the strategic commentary for a snapshot.
 *
 * @param {object} params
 * @param {object} params.snapshot Filtered snapshot
 * @param {object} [params.rawSnapshot] Raw snapshot if available
 * @param {object} [params.campaignPosture] Output of assessCampaignPosture
 * @param {object} [params.holdGround] Output of buildHoldGround
 * @param {object} [params.changesSincePrevious] Output of snapshotDelta / strategicDelta
 * @param {string} [params.snapshotId] Unique identifier for deterministic seeding
 */
function generateStrategicCommentary({
  snapshot = {},
  rawSnapshot = null,
  campaignPosture = {},
  holdGround = {},
  changesSincePrevious = null,
  snapshotId = null
} = {}) {
  const facts = extractFacts({
    snapshot,
    rawSnapshot,
    campaignPosture,
    holdGround,
    changesSincePrevious,
    snapshotId
  });

  const beats = evaluateBeats(facts);
  const simulation = runMonteCarloSimulation(facts);
  const grammar = generateGrammar({ facts, beats, simulation });

  return {
    available: true,
    mode: facts.mode,
    snapshotId: facts.snapshotId,
    headline: grammar.headline,
    prose: grammar.prose,
    advice: grammar.advice,
    beats,
    simulation: {
      available: simulation.available,
      // A simulation that could not be run has to SAY it could not be run.
      // `reason` was built by both unavailable branches and then dropped here,
      // so a consumer saw `available: false` with nothing to render and the
      // combat-threshold panel simply vanished with no explanation.
      reason: simulation.reason ?? null,
      source: simulation.source ?? null,
      ownBestHull: simulation.ownBestHull ?? null,
      ownBestDesign: simulation.ownBestDesign ?? null,
      ownRating: simulation.ownRating ?? null,
      tiers: simulation.tiers || [],
      projections: simulation.projections || {}
    }
  };
}

module.exports = {
  generateStrategicCommentary
};
