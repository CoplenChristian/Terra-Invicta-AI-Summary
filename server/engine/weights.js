// server/engine/weights.js
//
// Purpose: the engine's tunable weights, kept in one exported config object per
//   the plan's instruction.
//
// The engine's tunable weights, in one place per the plan's instruction
// ("Weights live in ONE exported config object, not scattered literals"), plus
// the per-world override merge.
//
// Two families:
//  - Verified game constants get their own source comment at the point of
//    use (TIMissionTemplate rows, wiki citations) rather than living here,
//    because they are not tunable -- changing them would make the model
//    wrong, not differently calibrated.
//  - Everything below IS a judgement call (plan §2, §8 open question 1) and
//    is deliberately collected here so a future balance pass touches one
//    object instead of hunting through rule bodies.

const WEIGHTS = Object.freeze({
  // Spend at most this fraction of the remaining Total War headroom on any
  // single candidate. ASSUMPTION -- the plan flags the weighting itself as
  // judgement, not derived; 0.5 leaves room for more than one action per
  // cycle before the irreversible 200-hate line.
  TOTAL_WAR_SAFETY_MARGIN: 0.5,

  // Cost ladder for crossing a hate threshold, keyed by reversibility
  // (plan §2): staying under the war threshold is cheap and recoverable;
  // crossing 50 starts an asset hunt (recoverable by venting); crossing 200
  // is permanent. ASSUMPTION -- these multipliers are tunable config, not a
  // verified game formula.
  HATE_CROSSING: Object.freeze({
    staysUnder50: 1,
    crossing50: 3,
    crossing200: 10
  }),

  // Scales the weighted-hate cost term in the objective function
  // (score = value - hateCost - resourceCost) into the same units as value.
  HATE_POINTS: 1,

  // Scales the GDP/CP-cost value-density term. See value/gdp-per-cp-cost for
  // the formula itself.
  //
  // RECALIBRATED 2026-08-22, from 1 to 0.5, in the same change that corrected
  // that rule's arithmetic. Read this before touching it, because 0.5 is not a
  // round number someone liked:
  //
  // The rule used to charge one control point the WHOLE nation's control-point
  // cost while dividing its output by the nation's control-point count. The
  // wiki divides both sides, so the count cancels and the corrected density is
  // `2 * GDP_Bn^0.4` -- between 1x and 6x larger than the old figure, depending
  // on how many control points the nation happens to have. That is a SHAPE
  // error, not a scale one: measured on ExitSave.gz (1/1/2035), it put 921 of
  // 11,781 nation pairs (7.8%) in the wrong order, ranking Russia above the
  // larger United Malay Nation and Belgium-Luxembourg above Pakistan and Egypt.
  // No value of this scalar can un-invert those pairs, so "keep the old
  // ranking" was never on the table -- the ordering had to move, and it did.
  //
  // What this scalar CAN choose is the family's scale against the other four,
  // and that is a genuine judgement call: the rule's own source note says the
  // ordering is what the formula establishes and the absolute scale is
  // unverified. Every other weight in this object is documented as calibrated
  // against "a mid-value CP grab", so the choice is between re-deriving eight
  // weights against a new expansion scale or restoring the one scale they were
  // all set against. 0.5 does the latter, and it holds the MODAL nation exactly
  // fixed: 81 of the 154 nations on the board have two control points, for which
  // the old bug was a factor of exactly 2. Nations move only by how far their
  // control-point count differs from that 2 -- a pure de-biasing.
  //
  // Measured on ExitSave.gz, both modes, across 1 / 0.5 / 0.2:
  //   1.0 -- expansion runs 2.5..143.5 against 3..10 for every other family, so
  //          the allocator stacks TWO councilors on China (a second, long-odds
  //          Purge at EV 16.6 out-earns a certain Defend at EV 0.9) and Defend
  //          Interests in Madagascar falls off the plan entirely.
  //   0.2 -- a small-nation control point (2.25) drops below Investigate (3),
  //          and the plan loses an Advise continuation to a China Purge.
  //   0.5 -- every councilor keeps the assignment the rest of the model already
  //          endorsed, and the corrected top target (Purge the Protectorate hold
  //          in China, 68.75) becomes the primary instead of Advise USA (7.00).
  //
  // Note the relative: `DEFENSE.gdpDensityPoints` (0.2) scales the SAME density
  // expression. The two are deliberately different -- defending is mostly worth
  // the act (DEFENSE.base), so density modifies a flat base there, while for
  // expansion the density IS the whole value. Change one and re-read the other.
  VALUE_POINTS: 0.5,

  // Value for the non-expansion families. Expansion value falls out of a
  // real formula (GDP density); nothing comparable exists for taking an
  // enemy councilor off the board or for unblocking the alien-response
  // axis, so these are calibrated judgement, not derived quantities --
  // every rule using them is marked estimateClass 'heuristic'.
  //
  // Calibration point: a takeable control point in a small nation scores
  // 4.4-5.5, so these are set to make a councilor Turn comparable to a
  // mid-value CP grab rather than automatically beating or losing to it.
  // Change them here, not at the call sites.
  //
  // That anchor is what VALUE_POINTS was re-set to preserve on 2026-08-22, and
  // it still holds: the one takeable control point on ExitSave.gz (Madagascar's
  // Executive, $75.1Bn across 2 control points) scores 5.63, the same figure it
  // scored before the arithmetic fix, against a Turn at 6. Re-measure it here
  // before changing VALUE_POINTS, because these four families are calibrated
  // against it and nothing else pins them.
  COUNCIL: Object.freeze({
    // Turn is the payoff -- it removes a councilor from the enemy board and
    // puts an agent inside their faction, at zero alien hate on success.
    turn: 6,
    // Investigate is the enabler, not the prize: it feeds Turn's secrets
    // precondition and is the only way to read a masked Loyalty. Valued
    // below Turn so it never outranks the thing it exists to unlock.
    investigate: 3,
    // Notion 02: "Protectorate must be treated as a real strategic
    // adversary." Proxy factions also feed alien hate, so denying them a
    // councilor is worth more than denying a neutral human faction.
    proxyTargetBonus: 3
  }),

  // Per unconfirmable precondition. Small on purpose: these are unverifiable
  // rather than known-unmet, so this breaks ties toward actions we can
  // confirm are available without burying a genuinely better option.
  UNMET_PRECONDITION_PENALTY: 0.75,

  INTELLIGENCE: Object.freeze({
    // Holding alien-tracking capability with zero sightings blocks every
    // downstream alien action -- Detain, interception, facility response.
    // A blocker is worth more than any single action it gates.
    unblockSightings: 5,
    // Under escalate-late the fleet cannot absorb what it cannot see, so
    // the blocker gets worse, not better, the more fragile we are.
    escalateLateBonus: 4,
    // Removing an alien operative from Earth, before hate cost is applied
    // by the hate rules.
    detainAlien: 7
  }),

  // Core holding defense (Defend Interests).
  DEFENSE: Object.freeze({
    base: 5,
    gdpDensityPoints: 0.2,
    escalateLateBonus: 3
  }),

  // Advise (persistent output mission). The exact value is computed per
  // councilor in server/engine/adviseEconomics.js; these only rank advisory
  // candidates against each other before a councilor is chosen. ASSUMPTION --
  // calibrated to sit near a mid-value CP grab (4.4-5.5, the anchor VALUE_POINTS
  // preserves) rather than to dominate or be dominated by one.
  ADVISORY: Object.freeze({
    base: 4,
    // Per point of the target's MEASURED research/turn.
    researchPoints: 0.002,
    // Ceiling on the research term so one superpower cannot crowd out every
    // other axis on the board.
    researchCap: 3
  }),

  // Scales resourceCost = spend / stock in the objective function.
  RESOURCE_POINTS: 1,

  // How many lowest-Loyalty enemy councilors to generate Investigate/Turn
  // candidates for. Not a game constant -- just keeps the candidate list
  // bounded. Tunable.
  TOP_N_COUNCIL_TARGETS: 3
});

function getWeights(world) {
  const configured = world?.directiveWeights;
  if (!configured) return WEIGHTS;
  return {
    ...WEIGHTS,
    TOTAL_WAR_SAFETY_MARGIN: configured.totalWarSafetyMargin ?? WEIGHTS.TOTAL_WAR_SAFETY_MARGIN,
    HATE_CROSSING: { ...WEIGHTS.HATE_CROSSING, ...(configured.hateCrossing || {}) },
    HATE_POINTS: configured.hatePoints ?? WEIGHTS.HATE_POINTS,
    VALUE_POINTS: configured.valuePoints ?? WEIGHTS.VALUE_POINTS,
    COUNCIL: { ...WEIGHTS.COUNCIL, ...(configured.council || {}) },
    UNMET_PRECONDITION_PENALTY: configured.unmetPreconditionPenalty ?? WEIGHTS.UNMET_PRECONDITION_PENALTY,
    INTELLIGENCE: { ...WEIGHTS.INTELLIGENCE, ...(configured.intelligence || {}) },
    DEFENSE: { ...WEIGHTS.DEFENSE, ...(configured.defense || {}) },
    ADVISORY: { ...WEIGHTS.ADVISORY, ...(configured.advisory || {}) },
    RESOURCE_POINTS: configured.resourcePoints ?? WEIGHTS.RESOURCE_POINTS,
    TOP_N_COUNCIL_TARGETS: configured.topNCouncilTargets ?? WEIGHTS.TOP_N_COUNCIL_TARGETS
  };
}

module.exports = { WEIGHTS, getWeights };
