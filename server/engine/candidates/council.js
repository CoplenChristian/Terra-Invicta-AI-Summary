// server/engine/candidates/council.js
//
// Purpose: the council candidate generator — Investigate then Turn, the
//   zero-hate offensive.
//
// (b) Council: Investigate -> Turn -- the zero-hate offensive.
//
// Verified from TIMissionTemplate (six-slot outcome array; slot 4 = normal
// success, slot 5 = critical success), per server/directiveAdvisor.js's own
// header sourcing convention:
//   Turn Councilor:        [0,3,3,0,0,0] -- zero on success, 3 on the two
//                           failure slots. Attack Persuasion, defence
//                           Loyalty. Cost: Influence (bonus).
//   Investigate Councilor: [0,0,0,0,0,0] -- zero on every outcome. Attack
//                           Investigation, defence Espionage. Cost: Ops
//                           (bonus).
//
// Targets are ranked by low Loyalty (resolvedAttributes.effective.Loyalty
// when present, else the base attributes.Loyalty; a councilor with neither
// is left out of the ranking rather than sorted as if Loyalty were 0).
//
// Turn's real preconditions are HasSpySlot and HasIntelOnCouncilorSecrets.
// Neither is present in the snapshot: investigationConfidence
// (server/intelligenceFilter.js) reports the snapshot MODE (e.g.
// "OMNISCIENT"), not per-councilor secret depth, and is not a substitute.
// Turn candidates carry both as unmetPreconditions and say so in the title,
// per the plan -- "do not pretend they are satisfiable."

const directiveAdvisor = require('../../directiveAdvisor');
const { toFiniteNumber, sameId } = require('../../../shared/util.mjs');
const { getWeights } = require('../weights');

/**
 * Is this faction one of the alien proxies? Routed through directiveAdvisor
 * so there is one definition of "proxy" in the codebase -- it already knows
 * the Servants/Protectorate template names and display-name spellings.
 */
function isProxyFaction(factionName) {
  if (!factionName) return false;
  const kind = directiveAdvisor.classifyProxy({ displayName: factionName }).kind;
  return kind === 'servants' || kind === 'protectorate';
}

function loyaltyOf(councilor) {
  const effective = toFiniteNumber(councilor?.resolvedAttributes?.effective?.Loyalty);
  if (effective !== null) return effective;
  const base = toFiniteNumber(councilor?.attributes?.Loyalty);
  if (base !== null) return base;
  // Player mode strips `attributes` from observed enemies and exposes
  // `maskedAttributes` instead, where an unresolved stat is
  // { visible: null, visibility: 'unknown' }. Read the masked view rather
  // than treating the whole councilor as unrankable -- but keep returning
  // null when `visible` really is null, because that is the honest answer.
  return toFiniteNumber(councilor?.maskedAttributes?.Loyalty?.visible);
}

function buildInvestigateCandidate(councilor, loyalty) {
  return {
    id: `investigate-councilor:${councilor.ID}`,
    family: 'council',
    missionType: 'Investigate Councilor',
    title: `Investigate ${councilor.displayName} (${councilor.factionName})`,
    target: {
      kind: 'councilor',
      nation: null,
      faction: councilor.factionName,
      controlPointType: null,
      isExecutive: null,
      councilorId: councilor.ID,
      councilorName: councilor.displayName,
      loyalty
    },
    hate: {
      toAliens: { low: 0, high: 0 },
      note: 'TIMissionTemplate Investigate Councilor hate row is [0,0,0,0,0,0] -- zero on every outcome.'
    },
    cost: { resource: 'Operations', amount: null, kind: 'bonus' },
    value: {
      targetLoyalty: loyalty,
      // Servants and Protectorate both feed alien hate and are the factions
      // Notion 02 names as real adversaries, so denying them a councilor is
      // worth more than denying a neutral human faction.
      targetIsProxy: isProxyFaction(councilor.factionName)
    },
    score: null,
    provenance: {
      source: 'TIMissionTemplate Investigate Councilor outcome array',
      estimateClass: 'exact'
    },
    unmetPreconditions: []
  };
}

function buildTurnCandidate(councilor, loyalty) {
  return {
    id: `turn-councilor:${councilor.ID}`,
    family: 'council',
    missionType: 'Turn Councilor',
    title: `Turn ${councilor.displayName} (${councilor.factionName}) -- pending spy slot & secrets intel`,
    target: {
      kind: 'councilor',
      nation: null,
      faction: councilor.factionName,
      controlPointType: null,
      isExecutive: null,
      councilorId: councilor.ID,
      councilorName: councilor.displayName,
      loyalty
    },
    hate: {
      toAliens: { low: 0, high: 3 },
      note: 'TIMissionTemplate Turn Councilor hate row is [0,3,3,0,0,0] -- zero on normal and critical '
        + 'success (slots 4-5), 3 on failure (slots 1-2). Without success odds, the failure-risk branch '
        + 'carries up to 3 alien hate.'
    },
    // Bonus-cost mission: the amount scales with the roll and is genuinely
    // unfillable without a success-odds calculator (plan §4 / Notion 09,14),
    // which is out of scope for v1. Absent stays null.
    cost: { resource: 'Influence', amount: null, kind: 'bonus' },
    value: {
      targetLoyalty: loyalty,
      // Servants and Protectorate both feed alien hate and are the factions
      // Notion 02 names as real adversaries, so denying them a councilor is
      // worth more than denying a neutral human faction.
      targetIsProxy: isProxyFaction(councilor.factionName)
    },
    score: null,
    provenance: {
      source: 'TIMissionTemplate Turn Councilor outcome array, slots 1-2 & 4-5',
      estimateClass: 'exact'
    },
    unmetPreconditions: [
      'HasSpySlot is not present in this snapshot -- cannot confirm a free spy slot exists on this target.',
      'HasIntelOnCouncilorSecrets is not present in this snapshot -- investigationConfidence reports the '
        + 'snapshot MODE (e.g. OMNISCIENT), not per-councilor secret depth, and is not a substitute.'
    ]
  };
}

function generateCouncilCandidates(world) {
  const observerId = world.observerId;
  const councilors = Array.isArray(world.councilors) ? world.councilors : [];
  const enemyCouncilors = councilors.filter((c) => c
    && c.isAlien !== true
    && c.isIndependent !== true
    && c.factionId !== null && c.factionId !== undefined
    && !sameId(c.factionId, observerId));

  const scored = enemyCouncilors.map((c) => ({ councilor: c, loyalty: loyaltyOf(c) }));
  // A councilor with no measurable Loyalty is not sorted to the front as if
  // Loyalty were 0.
  const rankable = scored.filter((entry) => entry.loyalty !== null);

  const candidates = [];

  if (rankable.length > 0) {
    const ranked = rankable
      .sort((a, b) => a.loyalty - b.loyalty)
      .slice(0, getWeights(world).TOP_N_COUNCIL_TARGETS);
    for (const { councilor, loyalty } of ranked) {
      candidates.push(buildInvestigateCandidate(councilor, loyalty));
      candidates.push(buildTurnCandidate(councilor, loyalty));
    }
    return candidates;
  }

  // Nobody has readable Loyalty. That is the normal state in player mode,
  // where observed enemies carry maskedAttributes with visible: null -- and
  // dropping the whole council axis there would hide the one offensive that
  // costs no alien hate, in the mode the dashboard actually runs in.
  //
  // Turn is genuinely un-targetable without Loyalty, since Loyalty is the
  // defending stat and there is no basis for choosing between targets. But
  // Investigate Councilor is precisely the mission that resolves that, and it
  // is free on every outcome. So emit Investigate alone and say why.
  for (const { councilor } of scored.slice(0, getWeights(world).TOP_N_COUNCIL_TARGETS)) {
    const candidate = buildInvestigateCandidate(councilor, null);
    candidate.title = `Investigate ${councilor.displayName} (${councilor.factionName}) `
      + '-- Loyalty unreadable, and Turn cannot be targeted without it';
    candidate.unmetPreconditions = [
      ...candidate.unmetPreconditions,
      'Target Loyalty is not observable in this mode, so Turn targets cannot be ranked. '
        + 'Investigate Councilor is the mission that resolves it, and costs no alien hate on any outcome.'
    ];
    candidates.push(candidate);
  }
  return candidates;
}

module.exports = {
  isProxyFaction,
  loyaltyOf,
  buildInvestigateCandidate,
  buildTurnCandidate,
  generateCouncilCandidates
};
