/**
 * server/engine/assignment.js
 *
 * Implements the cycle plan assignment allocator:
 * 1. Greedy expected-value allocation under shared portfolio budgets.
 * 2. Persistent assignment recognition (Advise, Surveil Location, Protect Councilor).
 * 3. Local pairwise swaps to optimize aggregate team value.
 * 4. Opportunity cost and switching penalty computation for every assignment.
 * 5. Benched and budget-displaced alternative tracking with explicit reasons.
 * 6. Free-action assignment suggestions for unallocated councilors.
 */

const { BudgetPoolManager } = require('./budgets');
const { computeStrategicClocks } = require('./clocks');
const { isCouncilorFree } = require('./feasibility');
const { generateAllPairings, resolveCouncilorId } = require('./pairing');
const {
  computeAdviseNationBonuses,
  computeAdviseHabBonuses,
  evaluateAdviseValue
} = require('./adviseEconomics');

const FREE_ACTIONS = Object.freeze(['Surveil Location', 'Protect Councilor', 'Go To Ground']);

const PERSISTENT_MISSIONS = new Set(['Advise', 'Surveil Location', 'Protect Councilor']);
const PERSISTENT_HORIZON_TURNS = 2; // Stated heuristic planning horizon

const UNASSIGNED_REASON_DETAIL = Object.freeze({
  'no-feasible-candidate': 'Every candidate this cycle failed feasibility for this operative.',
  'all-candidates-claimed': 'Feasible candidates existed, but higher-value pairings claimed all of them.',
  'budget-exhausted': 'Feasible and unclaimed candidates remained, but no resource pool could pay for them.'
});

/**
 * Extracts active mission details from a councilor object.
 * Distinguishes "Prior: <Mission>" (completed previous cycle) from active persistent assignments.
 */
function getActiveMissionInfo(councilor) {
  if (!councilor) return { isPersistent: false, missionName: null, targetName: null, isPrior: false };
  const rawName = councilor.activeMissionName || councilor.activeMission || councilor.mission || '';
  const targetName = councilor.activeMissionTarget || councilor.targetName || null;

  if (typeof rawName === 'string' && rawName.startsWith('Prior: ')) {
    return {
      isPersistent: false,
      missionName: rawName.replace('Prior: ', '').trim(),
      targetName: null,
      isPrior: true
    };
  }

  const norm = String(rawName).trim();
  if (!norm || norm === 'Idle / Standby' || norm === 'Idle' || norm === 'Standby') {
    return {
      isPersistent: false,
      missionName: 'Idle / Standby',
      targetName: null,
      isPrior: false
    };
  }

  const isPersistent = PERSISTENT_MISSIONS.has(norm);
  return {
    isPersistent,
    missionName: norm,
    targetName,
    isPrior: false
  };
}

/**
 * Assign each councilor a planning key that is guaranteed distinct.
 */
function buildRoster(ownCouncilors) {
  const seen = new Set();
  return (Array.isArray(ownCouncilors) ? ownCouncilors : []).map((councilor, index) => {
    const resolved = resolveCouncilorId(councilor);
    let key = resolved !== null ? String(resolved) : `slot-${index}`;
    if (seen.has(key)) key = `${key}::${index}`;
    seen.add(key);

    const needsSynthetic = key !== String(resolved);
    return {
      key,
      councilor: needsSynthetic ? { ...councilor, ID: key, id: key } : councilor
    };
  });
}

function classifyUnassigned(ownPairings, claimedCandidateIds) {
  if (ownPairings.length === 0) return 'no-feasible-candidate';
  if (ownPairings.every((p) => claimedCandidateIds.has(p.candidateId))) return 'all-candidates-claimed';
  return 'budget-exhausted';
}

/**
 * Computes ongoing benefit destroyed if a councilor is pulled off their active mission.
 *
 * `measured` distinguishes a real priced benefit from one we could not price.
 * The previous version returned a hard-coded { perTurnValue: 50,
 * gainResearch: 50, gainIP: 2 } whenever the Advise target could not be found
 * in the world -- inventing a research figure that reads exactly like a
 * measured one and then charging a switching penalty derived from it. An
 * unpriceable commitment now says so.
 */
function computeOngoingMissionBenefit(councilor, activeInfo, world = {}) {
  if (!activeInfo || !activeInfo.isPersistent) {
    return { perTurnValue: 0, gainResearch: 0, gainIP: 0, measured: true };
  }

  if (activeInfo.missionName === 'Advise') {
    const nations = Array.isArray(world.nations) ? world.nations : [];
    const targetNation = nations.find(n =>
      (n.displayName && n.displayName === activeInfo.targetName) ||
      (n.name && n.name === activeInfo.targetName)
    );

    if (targetNation) {
      const bonuses = computeAdviseNationBonuses(councilor, targetNation);
      const evalRes = evaluateAdviseValue(bonuses, 'nation');
      return {
        perTurnValue: evalRes.perTurnValue,
        gainResearch: bonuses.gainResearch,
        gainIP: bonuses.gainIP,
        targetName: targetNation.displayName || targetNation.name,
        measured: true
      };
    }

    const habs = Array.isArray(world.habs) ? world.habs : [];
    const targetHab = habs.find(h =>
      (h.displayName && h.displayName === activeInfo.targetName) ||
      (h.name && h.name === activeInfo.targetName)
    );

    if (targetHab) {
      const bonuses = computeAdviseHabBonuses(councilor, targetHab);
      const evalRes = evaluateAdviseValue(bonuses, 'hab');
      // The hab is in the world but nothing about it was measurable: the cost
      // of breaking this commitment is still unknown, so it says so rather
      // than reporting the 1.0 score floor as a measured benefit.
      if (evalRes.measured === false) {
        return {
          perTurnValue: null,
          gainResearch: null,
          gainIP: null,
          targetName: targetHab.displayName || targetHab.name,
          measured: false,
          unmeasuredReason: evalRes.unmeasuredReason
        };
      }
      return {
        perTurnValue: evalRes.perTurnValue,
        gainResearch: bonuses.gainResearch,
        gainIP: 0,
        targetName: targetHab.displayName || targetHab.name,
        measured: true,
        unmeasuredInputs: bonuses.unmeasuredInputs || []
      };
    }

    // The Advise target is not in this world snapshot -- most often because
    // the councilor is advising a hab and `world.habs` was never populated.
    // Null, not a placeholder: the cost of breaking this commitment is
    // unknown, and an unknown cost must not be rendered as a confident number.
    return {
      perTurnValue: null,
      gainResearch: null,
      gainIP: null,
      targetName: activeInfo.targetName || null,
      measured: false,
      unmeasuredReason: `Advise target ${activeInfo.targetName ? `"${activeInfo.targetName}" ` : ''}is not present `
        + 'in this snapshot, so the per-turn output this commitment produces could not be priced.'
    };
  }

  // Surveil Location / Protect Councilor. ASSUMPTION -- a nominal holding
  // value, not a measured output; these missions produce positioning rather
  // than a quantity the save records.
  return {
    perTurnValue: 10,
    gainResearch: 0,
    gainIP: 0,
    targetName: activeInfo.targetName || 'In-Theater',
    measured: true,
    estimateClass: 'heuristic'
  };
}

/*
 * The capitalisation bridge that used to live here (mapping `Influence` ->
 * `influence` before constructing the pool manager) is gone: BudgetPoolManager
 * reads both spellings itself, so every caller gets the measured pools, not
 * just this one. Fixing it at the call site left the placeholder caps in place
 * for anything that did not route through here.
 */

function allocateCyclePlan(candidates = [], ownCouncilors = [], world = {}, options = {}) {
  const clocks = computeStrategicClocks(world);
  const budgets = new BudgetPoolManager(world, options);

  const roster = buildRoster(ownCouncilors);
  
  // Categorize councilors into unavailable, committed, and assignable (§4e.6)
  //
  // `committed` USED TO mean "is currently running a persistent mission", and
  // was filled here, before the allocator ran. That produced a plan that said
  // both things at once: the same five councilors appeared under `committed`
  // ("committed to active Advise on the USA") and under `assignments` with
  // assignmentType 'reassign' ("move them off it"). Two contradictory
  // instructions for one operative.
  //
  // `committed` now means: THE PLAN KEEPS THIS COUNCILOR ON THEIR ACTIVE
  // PERSISTENT MISSION. It is therefore computed after allocation, and a
  // councilor the plan reassigns is removed from it and appears only in
  // `assignments` -- where the reassignment is priced. A councilor whose
  // continuation the plan re-affirms appears in `committed` AND in
  // `assignments` with assignmentType 'continue'; those two statements agree,
  // so they are not a contradiction. `reassignedFromCommitment` keeps the
  // broken commitments visible instead of dropping them silently.
  const unavailable = [];
  const persistentRoster = [];
  const assignable = [];

  for (const entry of roster) {
    const councilor = entry.councilor;
    if (!isCouncilorFree(councilor)) {
      unavailable.push({
        councilorId: resolveCouncilorId(councilor),
        name: councilor.displayName || councilor.name || 'Councilor',
        status: councilor.status || 'Unavailable',
        reason: 'no-mission-slot',
        reasonDetail: 'Detained or otherwise out of action -- holds no mission slot this cycle.',
        suggestedFreeAction: null,
        freeActionOptions: []
      });
      continue;
    }

    const activeInfo = getActiveMissionInfo(councilor);
    if (activeInfo.isPersistent) {
      persistentRoster.push({
        key: entry.key,
        councilorId: resolveCouncilorId(councilor),
        name: councilor.displayName || councilor.name || 'Councilor',
        activeMissionName: activeInfo.missionName,
        activeMissionTarget: activeInfo.targetName,
        ongoingBenefit: computeOngoingMissionBenefit(councilor, activeInfo, world)
      });
    }

    // Both assignable and committed councilors enter the active pool for pairing evaluation
    assignable.push(entry);
  }

  // Pairings the engine could not price at all are recorded here rather than
  // vanishing -- a gap the reader cannot see reads as "there was nothing there".
  const droppedPairings = [];
  const pairings = generateAllPairings(
    candidates,
    assignable.map((entry) => entry.councilor),
    world,
    clocks,
    droppedPairings
  );

  // Apply persistent-mission continuity and switching penalty logic
  for (const pairing of pairings) {
    const activeInfo = getActiveMissionInfo(pairing.rawCouncilor);
    if (activeInfo.isPersistent) {
      const targetName = pairing.candidate?.target?.name || pairing.candidate?.target?.nation || pairing.candidate?.target?.hab;
      const isSameMission = pairing.candidate?.missionType === activeInfo.missionName;
      const isSameTarget = !activeInfo.targetName || targetName === activeInfo.targetName;

      if (isSameMission && isSameTarget) {
        pairing.isContinue = true;
        pairing.cost = { ...pairing.cost, amount: 0 }; // No new cost to continue
        pairing.expectedValue = Number((pairing.expectedValue + 1.0).toFixed(2)); // Continuity preference
      } else {
        // Switching penalty: deducting lost ongoing value across horizon.
        const ongoing = computeOngoingMissionBenefit(pairing.rawCouncilor, activeInfo, world);
        pairing.ongoingBenefit = ongoing;
        if (Number.isFinite(ongoing.perTurnValue)) {
          const switchingPenalty = Number(((ongoing.perTurnValue * PERSISTENT_HORIZON_TURNS) / 20.0).toFixed(2));
          pairing.switchingPenalty = switchingPenalty;
          // NOT clamped at zero. The old `Math.max(0, ...)` floored every
          // value-destroying switch at exactly 0, which made "this move is
          // worth nothing net" indistinguishable from "this move breaks even"
          // -- and the greedy pass accepts any pairing, so a reassignment that
          // burned 27 research/turn for no gain still got recommended.
          pairing.expectedValue = Number((pairing.expectedValue - switchingPenalty).toFixed(2));
          if (pairing.expectedValue <= 0) {
            pairing.switchRejected = true;
            pairing.switchRejectedReason = `Net expected value after the switching penalty is `
              + `${pairing.expectedValue.toFixed(2)}: breaking the active ${activeInfo.missionName} on `
              + `${activeInfo.targetName || 'target'} costs more than this mission returns.`;
          }
        } else {
          // The commitment we would break could not be priced. Charging 0
          // would make the switch look free, so record the gap instead and
          // let it surface on the card rather than vanish into the score.
          pairing.switchingPenalty = null;
          pairing.switchingPenaltyUnknown = true;
          // An unpriceable switch cannot be shown to be worth making, so the
          // commitment is held rather than broken on an unmeasured cost.
          pairing.switchRejected = true;
          pairing.switchRejectedReason = `The cost of breaking the active ${activeInfo.missionName} could not be `
            + `priced: ${ongoing.unmeasuredReason || 'the active mission target is not in this snapshot.'} `
            + 'An unmeasured cost is not a low one, so the commitment is held.';
          if (Array.isArray(pairing.why)) {
            pairing.why.push(`Reassigning off ${activeInfo.missionName} has an unpriced cost: `
              + `${ongoing.unmeasuredReason || 'the active mission target is not in this snapshot.'}`);
          }
        }
      }
    }
  }

  // Deterministic sort: expectedValue DESC, councilorId ASC, candidateId ASC
  pairings.sort((a, b) => {
    if (b.expectedValue !== a.expectedValue) {
      return b.expectedValue - a.expectedValue;
    }
    const cComp = String(a.councilorId).localeCompare(String(b.councilorId));
    if (cComp !== 0) return cComp;
    return String(a.candidateId).localeCompare(String(b.candidateId));
  });

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
  // Pools whose caps the snapshot does not carry, so their affordability
  // checks were skipped rather than passed.
  const budgetChecksUnevaluated = [];

  // 1. Greedy assignment pass
  const heldCommitments = [];
  for (const pairing of pairings) {
    const councilorKey = String(pairing.councilorId);
    if (assignedCouncilorIds.has(councilorKey)) continue;
    if (claimedCandidateIds.has(pairing.candidateId)) continue;
    // A switch that destroys more than it returns, or whose cost could not be
    // priced at all, is not an action -- keeping the councilor where they are
    // is strictly better. Recorded so the rejected trade stays visible.
    if (pairing.switchRejected) {
      heldCommitments.push({
        councilorId: pairing.councilorId,
        name: pairing.councilor?.name,
        rejectedTitle: pairing.candidate?.title || pairing.candidate?.friendlyName || pairing.candidate?.missionType,
        netExpectedValue: pairing.expectedValue,
        switchingPenalty: pairing.switchingPenalty,
        reason: pairing.switchRejectedReason
      });
      continue;
    }

    // A pairing whose hate row is not in the snapshot has no number to charge.
    // It is not charged 0 as though it were free -- `hateUnknown` rides along
    // on the assignment so the card can say the exposure is unmeasured. The
    // engine's hate/total-war-budget veto is what keeps such a candidate out
    // of `surviving` in the first place.
    const hateCharge = typeof pairing.hateForBudget === 'number'
      ? pairing.hateForBudget
      : (typeof pairing.expectedHate === 'number' ? pairing.expectedHate : 0);

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

    // An affordability check that could not be RUN is not the same as one that
    // passed. The assignment carries the pools whose caps the snapshot does
    // not measure, so a card can say the budget was never verified rather than
    // implying it cleared.
    if (affordability.evaluated === false) {
      pairing.budgetCheckEvaluated = false;
      pairing.unmeasuredBudgetPools = affordability.unmeasuredPools;
      for (const pool of affordability.unmeasuredPools) {
        if (!budgetChecksUnevaluated.includes(pool)) budgetChecksUnevaluated.push(pool);
      }
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

        const swappedA = pairings.find(p => p.councilorId === b.councilorId && p.candidateId === a.candidateId);
        const swappedB = pairings.find(p => p.councilorId === a.councilorId && p.candidateId === b.candidateId);

        if (swappedA && swappedB && !swappedA.switchRejected && !swappedB.switchRejected) {
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

  // 3. Compute opportunity costs and assignment types (§4e.5)
  for (const assignment of assignments) {
    const activeInfo = getActiveMissionInfo(assignment.rawCouncilor);
    const targetName = assignment.candidate?.target?.name || assignment.candidate?.target?.nation || assignment.candidate?.target?.hab;
    const isSameMission = assignment.candidate?.missionType === activeInfo.missionName;
    const isSameTarget = !activeInfo.targetName || targetName === activeInfo.targetName;

    if (activeInfo.isPersistent && isSameMission && isSameTarget) {
      assignment.assignmentType = 'continue';
      assignment.isContinue = true;
      assignment.opportunityCost = 'Continues active persistent assignment (zero switching cost)';
    } else if (activeInfo.isPersistent) {
      assignment.assignmentType = 'reassign';
      assignment.isReassign = true;
      const loss = computeOngoingMissionBenefit(assignment.rawCouncilor, activeInfo, world);
      assignment.ongoingBenefit = loss;
      const lossTxt = loss.measured === false
        ? 'an unpriced amount (the active mission target is not in this snapshot)'
        : (loss.gainResearch > 0
          ? `−${loss.gainResearch} research/turn`
          : `−${loss.perTurnValue} value/turn`);
      assignment.opportunityCost = `Moving ${assignment.councilor.name} off ${activeInfo.missionName} (${activeInfo.targetName || 'target'}) costs ${lossTxt}.`;
    } else {
      assignment.assignmentType = 'new';
      assignment.isNew = true;
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
  }

  // 3b. Resolve the persistent roster against what the plan actually decided,
  // so `committed` and `assignments` can never disagree about one councilor.
  const assignmentByCouncilorKey = new Map();
  for (const assignment of assignments) {
    assignmentByCouncilorKey.set(String(assignment.councilorId), assignment);
  }

  const committed = [];
  const reassignedFromCommitment = [];
  for (const entry of persistentRoster) {
    const assignment = assignmentByCouncilorKey.get(String(entry.key))
      || assignmentByCouncilorKey.get(String(entry.councilorId));
    const isReassigned = Boolean(assignment) && assignment.assignmentType === 'reassign';

    if (isReassigned) {
      reassignedFromCommitment.push({
        councilorId: entry.councilorId,
        name: entry.name,
        droppedMissionName: entry.activeMissionName,
        droppedMissionTarget: entry.activeMissionTarget,
        ongoingBenefit: entry.ongoingBenefit,
        replacedBy: assignment.candidate?.title
          || assignment.candidate?.friendlyName
          || assignment.candidate?.missionType
          || 'a higher-value mission',
        opportunityCost: assignment.opportunityCost,
        reasonDetail: `The plan moves ${entry.name} off ${entry.activeMissionName} `
          + `(${entry.activeMissionTarget || 'target'}) this cycle, so this commitment is NOT kept.`
      });
      continue;
    }

    const planDecision = assignment && assignment.assignmentType === 'continue' ? 'continue' : 'hold';
    // The best switch that was considered and turned down, so the held
    // commitment shows its reasoning rather than reading as inertia.
    const rejectedSwitches = heldCommitments
      .filter((h) => String(h.councilorId) === String(entry.councilorId))
      .sort((a, b) => (b.netExpectedValue ?? -Infinity) - (a.netExpectedValue ?? -Infinity));

    committed.push({
      councilorId: entry.councilorId,
      name: entry.name,
      activeMissionName: entry.activeMissionName,
      activeMissionTarget: entry.activeMissionTarget,
      ongoingBenefit: entry.ongoingBenefit,
      planDecision,
      rejectedSwitch: rejectedSwitches[0] || null,
      reasonDetail: planDecision === 'continue'
        ? `The plan keeps ${entry.name} on ${entry.activeMissionName} `
          + `(${entry.activeMissionTarget || 'target'}); the continuation is re-affirmed in this cycle's orders.`
        : rejectedSwitches.length > 0
          ? `The plan leaves ${entry.name} on ${entry.activeMissionName} `
            + `(${entry.activeMissionTarget || 'target'}). ${rejectedSwitches[0].reason}`
          : `The plan leaves ${entry.name} on ${entry.activeMissionName} `
            + `(${entry.activeMissionTarget || 'target'}); no higher-value reassignment cleared this cycle.`
    });
  }
  const committedCouncilorKeys = new Set(committed.map((c) => String(c.councilorId)));

  // 4. Benched Candidates
  const benched = [];
  for (const candidate of candidates) {
    const candId = candidate.id || candidate.key || candidate.title;
    if (!claimedCandidateIds.has(candId)) {
      const bestPairing = pairings.find(p => p.candidateId === candId);
      const score = Number(candidate.score ?? candidate.baseValue ?? bestPairing?.expectedValue ?? 0);

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

  // 5. Unassigned councilors
  const unassigned = [];
  for (const entry of assignable) {
    if (assignedCouncilorIds.has(entry.key)) continue;
    // A councilor the plan is deliberately holding on a persistent mission is
    // committed, not idle -- listing them under `unassigned` with "no feasible
    // candidate" would contradict the commitment the plan just affirmed.
    if (committedCouncilorKeys.has(entry.key)
      || committedCouncilorKeys.has(String(resolveCouncilorId(entry.councilor)))) continue;

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
    unavailable,
    committed,
    reassignedFromCommitment,
    heldCommitments,
    benched: benched.slice(0, 8),
    budgetDisplaced,
    budgets: budgets.getSummary(),
    budgetChecksUnevaluated,
    droppedPairings,
    clocks,
    horizon,
    totalExpectedValue
  };
}

module.exports = {
  allocateCyclePlan,
  getActiveMissionInfo,
  computeOngoingMissionBenefit
};
