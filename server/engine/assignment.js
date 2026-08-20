/**
 * server/engine/assignment.js
 *
 * Implements the cycle plan assignment allocator:
 * 1. Greedy expected-value allocation under shared portfolio budgets.
 * 2. Local pairwise swaps to optimize aggregate team value.
 * 3. Opportunity cost computation for every assignment.
 * 4. Benched and budget-displaced alternative tracking with explicit reasons.
 * 5. Free-action assignment suggestions for unallocated councilors.
 */

const { BudgetPoolManager } = require('./budgets');
const { computeStrategicClocks } = require('./clocks');
const { isCouncilorFree } = require('./feasibility');
const { generateAllPairings, resolveCouncilorId } = require('./pairing');

/**
 * Free actions cost no resource and generate no hate (§4a), so an idle mission
 * slot is always fillable and an unassigned councilor with no suggestion is a
 * planning failure rather than a legitimate output. Surveil Location leads
 * because it is the only one of the three that produces something -- intel --
 * so it dominates idling outright; the other two are situational and are
 * offered as the rest of the menu rather than guessed between.
 */
const FREE_ACTIONS = Object.freeze(['Surveil Location', 'Protect Councilor', 'Go To Ground']);

// Plan §4b.6. `reason` is one of these three tokens so consumers can branch on
// it; `reasonDetail` carries the sentence a reader wants.
const UNASSIGNED_REASON_DETAIL = Object.freeze({
  'no-feasible-candidate': 'Every candidate this cycle failed feasibility for this operative.',
  'all-candidates-claimed': 'Feasible candidates existed, but higher-value pairings claimed all of them.',
  'budget-exhausted': 'Feasible and unclaimed candidates remained, but no resource pool could pay for them.'
});

/**
 * Assign each councilor a planning key that is guaranteed distinct.
 *
 * Snapshot councilors key on `ID`, engine fixtures on `id`. The allocator read
 * only `id`, so against a real save every councilor keyed on `undefined`: the
 * first assignment poisoned the `assignedCouncilorIds` set for all six, and the
 * unassigned pass then believed all six were already assigned. One councilor
 * was planned for and five disappeared from the output entirely. Absence has to
 * be detected, not silently used as a key.
 */
function buildRoster(ownCouncilors) {
  const seen = new Set();
  return (Array.isArray(ownCouncilors) ? ownCouncilors : []).map((councilor, index) => {
    const resolved = resolveCouncilorId(councilor);
    let key = resolved !== null ? String(resolved) : `slot-${index}`;
    if (seen.has(key)) key = `${key}::${index}`;
    seen.add(key);

    // A councilor the snapshot gives no identity still occupies a mission slot,
    // so they get a synthetic one stamped onto a copy rather than being dropped.
    const needsSynthetic = key !== String(resolved);
    return {
      key,
      councilor: needsSynthetic ? { ...councilor, ID: key, id: key } : councilor
    };
  });
}

/**
 * Plan §4b.6's three reasons, in the only order they can be distinguished.
 * The greedy walk visits every pairing, so a councilor left unassigned while
 * one of their candidates is still unclaimed can only have been stopped by a
 * budget pool.
 */
function classifyUnassigned(ownPairings, claimedCandidateIds) {
  if (ownPairings.length === 0) return 'no-feasible-candidate';
  if (ownPairings.every((p) => claimedCandidateIds.has(p.candidateId))) return 'all-candidates-claimed';
  return 'budget-exhausted';
}

function allocateCyclePlan(candidates = [], ownCouncilors = [], world = {}, options = {}) {
  const clocks = computeStrategicClocks(world);
  const budgets = new BudgetPoolManager(world, options);

  const roster = buildRoster(ownCouncilors);
  // §4b.1: assignable means own faction and not detained. A detained councilor
  // has no mission slot at all, so they are reported under `unavailable` rather
  // than counted as an idle slot the plan failed to fill.
  const assignable = roster.filter((entry) => isCouncilorFree(entry.councilor));
  const unavailable = roster
    .filter((entry) => !isCouncilorFree(entry.councilor))
    .map((entry) => ({
      councilorId: resolveCouncilorId(entry.councilor),
      name: entry.councilor.displayName || entry.councilor.name || 'Councilor',
      status: entry.councilor.status || 'Unavailable',
      reason: 'no-mission-slot',
      reasonDetail: 'Detained or otherwise out of action -- holds no mission slot this cycle.',
      suggestedFreeAction: null,
      freeActionOptions: []
    }));

  const pairings = generateAllPairings(candidates, assignable.map((entry) => entry.councilor), world, clocks);

  // Deterministic sort: expectedValue DESC, councilorId ASC, candidateId ASC
  pairings.sort((a, b) => {
    if (b.expectedValue !== a.expectedValue) {
      return b.expectedValue - a.expectedValue;
    }
    const cComp = String(a.councilorId).localeCompare(String(b.councilorId));
    if (cComp !== 0) return cComp;
    return String(a.candidateId).localeCompare(String(b.candidateId));
  });

  // Keys are stringified because a snapshot's numeric `ID` and a fixture's
  // string id must not land in different buckets for the same councilor.
  const pairingsByCouncilor = new Map();
  for (const pairing of pairings) {
    const key = String(pairing.councilorId);
    if (!pairingsByCouncilor.has(key)) pairingsByCouncilor.set(key, []);
    pairingsByCouncilor.get(key).push(pairing);
  }

  const assignedCouncilorIds = new Set();
  const claimedCandidateIds = new Set();
  const assignments = [];
  const budgetDisplaced = [];

  // 1. Greedy assignment pass
  for (const pairing of pairings) {
    const councilorKey = String(pairing.councilorId);
    if (assignedCouncilorIds.has(councilorKey)) continue;
    if (claimedCandidateIds.has(pairing.candidateId)) continue;

    // Budgets are charged `hateForBudget`, not `expectedHate`: the latter is
    // null when the mission's odds are unknown, and `Number(null)` is 0, which
    // would let an unmeasurable mission spend nothing from the hate pool.
    const hateCharge = typeof pairing.hateForBudget === 'number'
      ? pairing.hateForBudget
      : pairing.expectedHate;

    const affordability = budgets.canAfford(pairing.cost, hateCharge);
    if (!affordability.affordable) {
      budgetDisplaced.push({
        candidateId: pairing.candidateId,
        councilorId: pairing.councilorId,
        title: pairing.candidate?.title || pairing.candidate?.friendlyName || 'Candidate',
        pool: affordability.pool,
        shortfall: affordability.shortfall
      });
      continue;
    }

    // Accept assignment
    assignedCouncilorIds.add(councilorKey);
    claimedCandidateIds.add(pairing.candidateId);
    budgets.consume(pairing.cost, hateCharge);
    assignments.push(pairing);
  }

  // 2. Local pairwise swap pass
  let improved = true;
  let iterations = 0;
  while (improved && iterations < 5) {
    improved = false;
    iterations++;

    for (let i = 0; i < assignments.length; i++) {
      for (let j = i + 1; j < assignments.length; j++) {
        const a = assignments[i];
        const b = assignments[j];

        // Find candidate pairings for swapped councilors
        const swappedA = pairings.find(p => p.councilorId === b.councilorId && p.candidateId === a.candidateId);
        const swappedB = pairings.find(p => p.councilorId === a.councilorId && p.candidateId === b.candidateId);

        if (swappedA && swappedB) {
          const currentTotal = a.expectedValue + b.expectedValue;
          const swappedTotal = swappedA.expectedValue + swappedB.expectedValue;

          if (swappedTotal > currentTotal + 0.05) {
            assignments[i] = swappedA;
            assignments[j] = swappedB;
            improved = true;
          }
        }
      }
    }
  }

  // 3. Compute opportunity costs
  for (const assignment of assignments) {
    const alternatives = pairings.filter(p =>
      p.councilorId === assignment.councilorId &&
      p.candidateId !== assignment.candidateId &&
      !claimedCandidateIds.has(p.candidateId)
    );

    if (alternatives.length > 0) {
      const nextBest = alternatives.sort((a, b) => b.expectedValue - a.expectedValue)[0];
      const title = nextBest.candidate?.title || nextBest.candidate?.friendlyName || nextBest.candidate?.missionType;
      assignment.opportunityCost = `Displaces ${title}`;
    } else {
      assignment.opportunityCost = 'No competing high-value mission available';
    }
  }

  // 4. Benched Candidates
  const benched = [];
  for (const candidate of candidates) {
    const candId = candidate.id || candidate.key || candidate.title;
    if (!claimedCandidateIds.has(candId)) {
      const bestPairing = pairings.find(p => p.candidateId === candId);
      const score = Number(candidate.score ?? candidate.value ?? bestPairing?.expectedValue ?? 0);

      let displacedBy = 'Displaced by higher expected value allocation across team.';
      if (assignments.length > 0) {
        displacedBy = `Displaced by ${assignments[0].councilor.name} assigned to direct high-priority mission.`;
      }

      benched.push({
        candidateId: candId,
        title: candidate.title || candidate.friendlyName || candidate.missionType || 'Alternative Candidate',
        score: Number(score.toFixed(2)),
        displacedBy
      });
    }
  }

  // 5. Unassigned councilors.
  //
  // Derived from the assignable roster rather than accumulated, so §4b.6's
  // contract -- every own, non-detained councilor appears in exactly one of
  // `assignments` or `unassigned` -- holds by construction.
  const unassigned = [];
  for (const entry of assignable) {
    if (assignedCouncilorIds.has(entry.key)) continue;

    const ownPairings = pairingsByCouncilor.get(entry.key) || [];
    const reason = classifyUnassigned(ownPairings, claimedCandidateIds);

    unassigned.push({
      councilorId: resolveCouncilorId(entry.councilor),
      name: entry.councilor.displayName || entry.councilor.name || 'Councilor',
      profession: entry.councilor.profession || entry.councilor.typeTemplateName || 'Operative',
      location: entry.councilor.location || entry.councilor.locationName || 'Earth',
      reason,
      reasonDetail: UNASSIGNED_REASON_DETAIL[reason],
      suggestedFreeAction: FREE_ACTIONS[0],
      freeActionOptions: [...FREE_ACTIONS]
    });
  }

  // 6. Multi-Cycle Horizon
  const horizon = [
    {
      cycle: 'Cycle +1',
      title: 'Turn Councilor (Targeted Intel Operations)',
      enabler: 'Requires secrets investigation completing this cycle',
      notes: 'Gains turned mole inside rival high council; grants continuous faction intel.'
    },
    {
      cycle: 'Cycle +2',
      title: 'Executive Coup in Contested Regions',
      enabler: 'Requires Unrest buildup and CP integration',
      notes: 'Breaks rival federation hold and secures sovereign energy grid.'
    }
  ];

  const totalExpectedValue = Number(
    assignments.reduce((sum, a) => sum + a.expectedValue, 0).toFixed(2)
  );

  return {
    assignments,
    unassigned,
    // Detained councilors hold no mission slot, so they are neither assigned
    // nor idle -- but they are still reported, because a councilor that appears
    // in none of the three lists is the defect this contract exists to prevent.
    unavailable,
    benched: benched.slice(0, 8),
    budgetDisplaced,
    budgets: budgets.getSummary(),
    clocks,
    horizon,
    totalExpectedValue
  };
}

module.exports = {
  allocateCyclePlan
};
