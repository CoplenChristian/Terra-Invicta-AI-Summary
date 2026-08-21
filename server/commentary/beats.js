/**
 * server/commentary/beats.js
 *
 * Layer 2 — Deterministic narrative beats and Hold Ground stance coherence.
 *
 * Rules from docs/archive/strategic-commentary-and-layout-plan.md & Review:
 * 1. Strict null-honesty: a beat whose required facts are null or missing MUST NOT fire.
 * 2. Hold Ground Stance Guard: If Hold Ground is active (or fleet cannot contest),
 *    commentary beats cannot contradict Hold Ground (no aggressive or unbacked escalation).
 * 3. 4 core beats evaluated deterministically against current save + single prior save facts.
 */

'use strict';

const BEAT_DEFINITIONS = [
  {
    id: 'forced-fleet-transition',
    name: 'Forced Fleet Transition',
    severity: 'pivotal',
    stance: 'transitional',
    requires: ['shipsLost', 'hateDelta', 'medianLostHullTier', 'medianSurvivingHullTier'],
    when: (f) =>
      f.shipsLost > 0 &&
      f.hateDelta !== null &&
      f.hateDelta < 0 &&
      (f.warStateChange === 'exited' || f.warPressure === 'clear' || f.warPressure === 'on-the-line') &&
      f.medianLostHullTier !== null &&
      f.medianSurvivingHullTier !== null &&
      f.medianSurvivingHullTier > f.medianLostHullTier,
    summary: (f) =>
      `Combat losses (${f.shipsLost} hull(s)) were concentrated in Tier ${f.medianLostHullTier} designs while surviving forces are Tier ${f.medianSurvivingHullTier}, alongside hate venting.`
  },
  {
    id: 'recovery-window',
    name: 'Recovery Window Opened',
    severity: 'high',
    stance: 'bank_hate',
    requires: ['hateDelta', 'warPressure'],
    when: (f) =>
      f.hateDelta !== null &&
      f.hateDelta < 0 &&
      (f.warPressure === 'clear' || f.warStateChange === 'exited'),
    summary: (f) =>
      `Alien hostility dropped (${f.hateDelta > 0 ? '+' : ''}${f.hateDelta.toFixed(1)} hate delta), establishing a defensive recovery window.`
  },
  {
    id: 'hate-budget-banked',
    name: 'Hate Budget Banked',
    severity: 'standard',
    stance: 'constructive',
    requires: ['warPressure'],
    when: (f) => {
      if (f.actualAlienHate !== null && f.warHeadroom !== null) {
        return f.warHeadroom >= 20.0;
      }
      return f.pips !== null && f.pips <= 2 && f.warPressure === 'clear';
    },
    summary: (f) =>
      f.warHeadroom !== null
        ? `Substantial hate budget banked (${f.warHeadroom.toFixed(1)} headroom to 50 war threshold).`
        : `Alien threat meter reads low (${f.pips ?? 0}/5 diamonds) with no imminent war pressure.`
  },
  {
    id: 'capability-gap-closing',
    name: 'Capability Gap Closing',
    severity: 'standard',
    stance: 'constructive',
    requires: ['canContest'],
    when: (f) =>
      f.canContest === true ||
      (f.dominantDeficit && f.dominantDeficit.ratio !== null && f.dominantDeficit.ratio < 3.0),
    summary: (f) =>
      `Fleet capability gap is non-decisive or closing (${f.dominantDeficit ? f.dominantDeficit.label : 'all measured axes'}).`
  },
  {
    id: 'capability-gap-widening',
    name: 'Decisive Force Deficit',
    severity: 'watch',
    stance: 'defensive',
    requires: ['canContest', 'dominantDeficit'],
    when: (f) =>
      f.canContest === false &&
      f.dominantDeficit !== null &&
      f.dominantDeficit.decisive === true,
    summary: (f) =>
      `Decisive deficit on ${f.dominantDeficit.label} (${f.dominantDeficit.text}).`
  }
];

/**
 * Checks whether all required facts are present (non-null and non-undefined).
 */
function hasRequiredFacts(beat, facts) {
  for (const key of beat.requires) {
    const val = facts[key];
    if (val === null || val === undefined) return false;
  }
  return true;
}

/**
 * Hold Ground Stance Guard:
 * When Hold Ground is active or fleet cannot contest, suppress or adjust any stance
 * that would contradict the directive.
 */
function isStanceCoherentWithHoldGround(beat, facts) {
  if (facts.isHoldGroundActive || facts.canContest === false) {
    // When holding, aggressive/offensive beats are incompatible
    if (beat.stance === 'offensive' || beat.stance === 'escalate') {
      return false;
    }
  }
  return true;
}

/**
 * Evaluates active narrative beats from extracted facts.
 */
function evaluateBeats(facts) {
  const activeBeats = [];

  for (const beat of BEAT_DEFINITIONS) {
    if (!hasRequiredFacts(beat, facts)) {
      continue;
    }

    if (!isStanceCoherentWithHoldGround(beat, facts)) {
      continue;
    }

    try {
      if (beat.when(facts)) {
        activeBeats.push({
          id: beat.id,
          name: beat.name,
          severity: beat.severity,
          stance: beat.stance,
          summary: beat.summary(facts)
        });
      }
    } catch (err) {
      // If predicate encounters unexpected missing field, do not fail silently with wrong data
      console.warn(`[StrategicCommentary] Beat predicate error for '${beat.id}':`, err.message);
    }
  }

  // Sort by severity rank (pivotal > high > standard > watch)
  const severityRank = { pivotal: 4, high: 3, standard: 2, watch: 1 };
  activeBeats.sort((a, b) => (severityRank[b.severity] || 0) - (severityRank[a.severity] || 0));

  return activeBeats;
}

module.exports = {
  BEAT_DEFINITIONS,
  evaluateBeats,
  hasRequiredFacts,
  isStanceCoherentWithHoldGround
};
