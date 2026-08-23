/**
 * server/engine/assignment.js
 * Purpose: the cycle-plan assignment allocator that binds candidates to
 *   councilors across the allocation cycle, including the pairing-scoped
 *   success-odds floor, the sibling-grouped bench cap, and the measured reason
 *   each benched candidate was not taken.
 *
 * Implements the cycle plan assignment allocator:
 * 1. Greedy expected-value allocation under shared portfolio budgets.
 * 2. Persistent assignment recognition (Advise, Surveil Location, Protect Councilor).
 * 3. Local pairwise swaps to optimize aggregate team value.
 * 4. Opportunity cost and switching penalty computation for every assignment.
 * 5. Benched and budget-displaced alternative tracking with explicit reasons.
 *    The bench cap SELECTS the highest-scoring few GROUPS of siblings -- one
 *    row per (mission, target) group, each carrying how many candidates it
 *    stands for -- and then EMITS them in candidate-generation order, so the
 *    carried list is the best few DISTINCT options without its sequence
 *    becoming a ranking (see shared/benchSelection.mjs). Each row states the
 *    obstacle that actually bound it, taken from what the allocator measured
 *    (see `classifyDisplacement`), and the bench as a whole reports how many of
 *    its rows could be taken TOGETHER against the pool that refused them (see
 *    `summariseBenchBudget`) -- eight rows sharing one budget are not eight
 *    independent options.
 * 6. Free-action assignment suggestions for unallocated councilors.
 * 7. The player's configured success-odds floor, applied as a pairing-scoped
 *    veto (server/engine/rules/risk.js) once odds exist -- which is here,
 *    because odds need a councilor and a candidate alone does not have one.
 */

const { BudgetPoolManager } = require('./budgets');
const { computeStrategicClocks } = require('./clocks');
const { isCouncilorFree } = require('./feasibility');
const { generateAllPairings, resolveCouncilorId } = require('./pairing');
const { applyPairingRules } = require('./selection');
const { resolveRiskFloorPercent, riskFloorInForce } = require('./rules/risk');
const {
  computeAdviseNationBonuses,
  computeAdviseHabBonuses,
  evaluateAdviseValue
} = require('./adviseEconomics');
// The one id-matching idiom. `resolveCouncilorId` yields null for a councilor
// whose identity could not be resolved, and `String(null) === String(null)` is
// true -- so the `String()`-comparison this replaced would have paired every
// unidentified councilor with every other one. `sameId` treats an absent id as
// matching nothing, which is the whole point of the helper.
const { sameId } = require('../../shared/util.mjs');
// The bench cap's selection rule. It lives under `shared/` rather than here
// because `public/v2/js/components/directive-board.js` must not re-decide it --
// the board renders every row it is handed -- and because a rule stated in two
// places is a rule waiting to drift.
const {
  BENCH_SELECTION_LIMIT,
  benchGroupIdentity,
  selectBenchRows
} = require('../../shared/benchSelection.mjs');

const FREE_ACTIONS = Object.freeze(['Surveil Location', 'Protect Councilor', 'Go To Ground']);

const PERSISTENT_MISSIONS = new Set(['Advise', 'Surveil Location', 'Protect Councilor']);
const PERSISTENT_HORIZON_TURNS = 2; // Stated heuristic planning horizon

const UNASSIGNED_REASON_DETAIL = Object.freeze({
  'no-feasible-candidate': 'Every candidate this cycle failed feasibility for this operative.',
  'all-candidates-claimed': 'Feasible candidates existed, but higher-value pairings claimed all of them.',
  'budget-exhausted': 'Feasible and unclaimed candidates remained, but no resource pool could pay for them.',
  // The floor is a deliberate choice, so an empty slot caused by it must say so
  // rather than reading as "nothing was available" -- and must never fall back
  // to a below-floor suggestion.
  'risk-floor': 'No action clears your risk floor for this operative this cycle.'
});

/**
 * How many risk-floor entries the plan carries per list. These exist to show a
 * reader WHY an action is missing; several hundred near-identical rows do not
 * explain better than the highest-value few plus a count. Every capped list is
 * emitted with its true total and the number omitted -- a bounded view, never a
 * quiet truncation.
 */
const RISK_FLOOR_LIST_LIMIT = 25;

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

/**
 * The risk floor is checked FIRST among the causes, because it is the only one
 * the player set themselves. A councilor whose every option was held back by
 * the floor has not "run out of candidates" -- reporting that would hide the
 * setting that actually emptied the slot.
 */
function classifyUnassigned(ownPairings, claimedCandidateIds) {
  if (ownPairings.length === 0) return 'no-feasible-candidate';
  if (ownPairings.every((p) => p.riskFloorVetoed === true)) return 'risk-floor';
  if (ownPairings.every((p) => claimedCandidateIds.has(p.candidateId))) return 'all-candidates-claimed';
  return 'budget-exhausted';
}

/**
 * WHY A BENCHED CANDIDATE IS BENCHED, taken from what the allocator measured
 * rather than from what is easy to say.
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT THIS REPLACES
 * ---------------------------------------------------------------------------
 *
 * Every bench row that was not risk-floor held used to read
 * `Displaced by ${assignments[0].councilor.name} assigned to direct
 * high-priority mission.` -- the FIRST assignment's councilor, named regardless
 * of whether that operative had anything to do with this candidate. Measured
 * 2026-08-23 on frozen `ExitSave.gz` (md5 5c0d9ef98213c91d8187ae11bf885d57):
 *
 *   * OMNISCIENT: all 8 rows said "Displaced by Hemaraj Pavanaja". All 8 were
 *     in fact refused by the alienHate budget, each charging 4.57 hate against
 *     3.16 left in a 7.90 cycle cap -- and the operative the refusal names is
 *     Mahangeet Pakimor, not Hemaraj Pavanaja. The engine had computed the
 *     pool, the charge and the 1.41 shortfall and thrown all three away.
 *   * PLAYER: all 8 rows said "Displaced by Beth Hofmann". Seven of the eight
 *     had EVERY way of running them refused as a value-destroying switch, and
 *     Beth Hofmann was the WORST-scoring operative on all eight lists. The
 *     eighth was genuine contention -- by Brad Lester and Mahangeet Pakimor.
 *
 * That is worse than no reason at all, because a reader acts on it: "free up a
 * councilor and I can do this" is exactly the wrong conclusion when a budget
 * refused an operative who was already free.
 *
 * ---------------------------------------------------------------------------
 * WHICH REASON BINDS WHEN SEVERAL APPLY
 * ---------------------------------------------------------------------------
 *
 * A candidate has one pairing per operative and each pairing hit its own
 * obstacle, so "the reason" is a choice. The rule is THE OBSTACLE NEAREST TO
 * TAKEABLE -- the one a reader would have to move first -- and the order is
 * stated here rather than left to fall out of the loop:
 *
 *   1. BUDGET. A refused pairing had already passed every other gate: its
 *      councilor was free, unclaimed, above the floor and not switch-rejected,
 *      and the pool still said no. Nothing but the budget stands in the way, so
 *      it binds over anything else and it REFUTES the councilor reading.
 *   2. CONTENTION. An operative could have run it and was taken by higher-value
 *      work. Actionable, and the work that took them is named.
 *   3. SWITCH-REJECTED. Every way of running it would break a posting worth
 *      more than the mission returns.
 *   4. RISK FLOOR. Every way of running it was below the player's own floor.
 *      Checked through `allBelowFloor`, which the caller computes, so the
 *      existing wording and its test are untouched.
 *   5. MIXED. More than one of (3) and (4) applies and neither covers it. The
 *      tally is stated instead of one member's reason being generalised.
 *   6. NO PRICEABLE OPERATIVE. There were no pairings at all -- see
 *      `droppedPairings` for what could not be priced.
 *
 * ABSENT STAYS NULL. There is no fallback branch that names an unrelated
 * councilor, and `undetermined` is a reachable outcome that says so in words.
 * `obstacles` always tallies every pairing, so `undetermined` can be recognised
 * as a classification gap rather than a property of the save.
 *
 * @param {Object} input
 * @returns {{ cause: string, displacedBy: string, obstacles: Object,
 *             budgetRefusal: Object|null }}
 */
function classifyDisplacement({
  candidateId,
  ownPairings,
  allBelowFloor,
  budgetRefusal,
  budgetRefusedPairKeys,
  assignedCouncilorIds,
  assignmentByCouncilorKey,
  riskFloorPercent
}) {
  // Per-pairing tally. A recorded refusal is a FACT and is read first; the rest
  // are properties of the pairing itself, and contention is last because it is
  // the only one that depends on what the rest of the plan happened to do.
  const contended = [];
  const switchRejected = [];
  const floorVetoed = [];
  const budgetRefused = [];
  const unclassified = [];
  for (const pairing of ownPairings) {
    if (budgetRefusedPairKeys.has(`${candidateId}|${pairing.councilorId}`)) {
      budgetRefused.push(pairing);
    } else if (pairing.riskFloorVetoed === true) {
      floorVetoed.push(pairing);
    } else if (pairing.switchRejected) {
      switchRejected.push(pairing);
    } else if (assignedCouncilorIds.has(String(pairing.councilorId))) {
      contended.push(pairing);
    } else {
      unclassified.push(pairing);
    }
  }
  const obstacles = {
    pairingCount: ownPairings.length,
    budgetRefusedCount: budgetRefused.length,
    contendedCount: contended.length,
    switchRejectedCount: switchRejected.length,
    riskFloorVetoedCount: floorVetoed.length,
    unclassifiedCount: unclassified.length
  };

  if (ownPairings.length === 0) {
    return {
      cause: 'no-priceable-operative',
      obstacles,
      budgetRefusal: null,
      displacedBy: 'No operative could be priced for this action, so no way of running it was '
        + 'evaluated — it was not weighed against the plan and lost.'
    };
  }

  if (allBelowFloor) {
    const bandLows = ownPairings
      .map((pairing) => (typeof pairing.riskFloor?.bandLow === 'number' ? pairing.riskFloor.bandLow : null))
      .filter((value) => value !== null);
    const closest = bandLows.length > 0 ? Math.max(...bandLows) : null;
    return {
      cause: 'risk-floor',
      obstacles,
      budgetRefusal: null,
      displacedBy: `Held back by your ${riskFloorPercent}% risk floor`
        + (closest === null
          ? ' — no operative produced a readable odds band for it.'
          : ` — the best available operative reads ${closest}% at the low end of its band.`)
    };
  }

  if (budgetRefusal) {
    return {
      cause: 'budget',
      obstacles,
      budgetRefusal,
      displacedBy: describeBudgetRefusal(budgetRefusal)
    };
  }

  if (contended.length > 0) {
    // The operative whose pairing scored highest -- `pairings` is sorted by
    // expected value descending, so the first contended entry is that one.
    const best = contended[0];
    const took = assignmentByCouncilorKey.get(String(best.councilorId)) || null;
    const tookTitle = took?.candidate?.title || took?.candidate?.friendlyName || null;
    const others = contended.length - 1;
    // Both values are `fixedOr`-style: an unreadable expected value says so
    // rather than printing 0.00, which is a real and different verdict.
    const ev = (value) => (typeof value === 'number' && Number.isFinite(value)
      ? value.toFixed(2)
      : 'an unreadable value');
    const tookText = tookTitle === null
      ? ', who the plan assigned elsewhere this cycle'
      : `, assigned instead to ${tookTitle} (EV ${ev(took?.expectedValue)})`;
    return {
      cause: 'councilor-contention',
      obstacles,
      budgetRefusal: null,
      displacedBy: `Displaced by ${best.councilor?.name || 'an operative'}${tookText}, `
        + `which outscored the ${ev(best.expectedValue)} this action returns in their hands`
        + (others > 0
          ? ` — ${others} further operative${others === 1 ? ' was' : 's were'} likewise taken.`
          : '.')
    };
  }

  if (switchRejected.length === ownPairings.length) {
    const closest = switchRejected
      .map((pairing) => (typeof pairing.expectedValue === 'number' ? pairing : null))
      .filter((pairing) => pairing !== null)[0] || null;
    return {
      cause: 'switch-rejected',
      obstacles,
      budgetRefusal: null,
      displacedBy: `Held by active commitments — all ${ownPairings.length} way`
        + `${ownPairings.length === 1 ? '' : 's'} of running it would break a posting worth more than the `
        + 'mission returns'
        + (closest === null
          ? ', and none carried a readable net value.'
          : `; the closest is ${closest.councilor?.name || 'an operative'} at net `
            + `${closest.expectedValue.toFixed(2)}.`)
    };
  }

  if (switchRejected.length > 0 || floorVetoed.length > 0) {
    const parts = [];
    if (floorVetoed.length > 0) parts.push(`${floorVetoed.length} by your ${riskFloorPercent}% risk floor`);
    if (switchRejected.length > 0) {
      parts.push(`${switchRejected.length} as a switch that costs more than the mission returns`);
    }
    if (unclassified.length > 0) parts.push(`${unclassified.length} for a reason the plan did not record`);
    return {
      cause: 'mixed',
      obstacles,
      budgetRefusal: null,
      displacedBy: `Held for more than one reason across the ${ownPairings.length} ways of running it: `
        + `${parts.join(', ')}. No single obstacle accounts for it.`
    };
  }

  // Reachable only if the allocator grows a path this function does not know
  // about. It says so rather than borrowing a neighbouring row's reason.
  return {
    cause: 'undetermined',
    obstacles,
    budgetRefusal: null,
    displacedBy: `Not taken this cycle, and the plan did not record which of the `
      + `${ownPairings.length} ways of running it was refused. This is an unrecorded reason, `
      + 'not an absent one.'
  };
}

/**
 * HOW MANY OF THE SHOWN OPTIONS COULD ACTUALLY BE TAKEN TOGETHER.
 *
 * The bench presents its rows as a list of alternatives, which invites the
 * reading that they are independently available. On the frozen save's
 * omniscient plan they are not: all eight draw on ONE cycle hate budget, each
 * charges 4.57 against 3.16 remaining, and the honest answer is that none of
 * them can be added to the committed plan. A reader shown eight purges and no
 * budget would reasonably conclude they could take several.
 *
 * WHAT THIS IS ALLOWED TO USE. Only charges the allocator actually MEASURED --
 * that is, the ones on recorded refusals. A row the budget never evaluated has
 * no charge, and inventing one from its best pairing would be exactly the
 * fabrication this file's null discipline exists to stop. Such a row is counted
 * under `unpricedRowCount` and is never counted as fitting.
 *
 * WHY CHEAPEST-FIRST. For a single pool, taking the cheapest options first
 * maximises how MANY fit, so the count is the largest honest answer rather than
 * an arbitrary one. It is still an UPPER BOUND, because only the pool that
 * refused was priced for these rows: another pool could refuse one of them and
 * this function would not know.
 *
 * MORE THAN ONE POOL REFUSES. Then the question is a multi-dimensional knapsack
 * over charges most of which were never measured, and the answer is null with
 * the pools named -- not a single-pool figure presented as the whole answer.
 *
 * @param {Array<Object>} rows The EMITTED bench rows, which are what a reader sees.
 * @param {Object} summary `BudgetPoolManager#getSummary()` AFTER allocation.
 * @returns {Object}
 */
function summariseBenchBudget(rows, summary) {
  const list = Array.isArray(rows) ? rows : [];
  const priced = list
    .map((row) => row?.budgetRefusal || null)
    .filter((refusal) => refusal !== null
      && refusal.chargeMeasured !== false
      && typeof refusal.charge === 'number'
      && Number.isFinite(refusal.charge));
  const pools = [...new Set(list
    .map((row) => row?.budgetRefusal?.pool)
    .filter((pool) => typeof pool === 'string' && pool !== ''))];

  const base = {
    rowCount: list.length,
    pricedRowCount: priced.length,
    unpricedRowCount: list.length - priced.length,
    pools,
    pool: pools.length === 1 ? pools[0] : null,
    // Absent stays null in all three: no pool, several pools, and an unmeasured
    // cap each give null rather than a number that would read as measured.
    jointlyAffordableCount: null,
    jointlyAffordableIsUpperBound: null,
    cap: null,
    used: null,
    remaining: null,
    unit: null,
    capMeasured: null,
    reason: null
  };

  if (pools.length === 0) {
    return {
      ...base,
      reason: 'No bench row on this plan was refused by a budget, so no row carries a measured '
        + 'charge and the number that jointly fit was not computed. That is not a finding that '
        + 'they all fit: their budgets were never tested.'
    };
  }
  if (pools.length > 1) {
    return {
      ...base,
      reason: `Bench rows were refused by more than one pool (${pools.join(', ')}), and only the pool `
        + 'that refused each row was priced, so no joint total can be computed without inventing the '
        + 'charges that were never measured.'
    };
  }

  const pool = pools[0];
  const poolSummary = summary?.[pool] || null;
  const cap = typeof poolSummary?.cap === 'number' && Number.isFinite(poolSummary.cap) ? poolSummary.cap : null;
  const used = typeof poolSummary?.used === 'number' && Number.isFinite(poolSummary.used) ? poolSummary.used : null;
  if (cap === null || used === null) {
    return {
      ...base,
      pool,
      unit: poolSummary?.unit ?? null,
      capMeasured: poolSummary?.capMeasured ?? null,
      reason: `The ${pool} pool refused bench rows but its cap or usage could not be read after `
        + 'allocation, so what remains — and therefore how many rows fit it — is unknown, not zero.'
    };
  }

  const remaining = Math.max(0, Number((cap - used).toFixed(2)));
  let running = 0;
  let fits = 0;
  for (const refusal of [...priced].sort((a, b) => a.charge - b.charge)) {
    if (Number((running + refusal.charge).toFixed(2)) > remaining) break;
    running = Number((running + refusal.charge).toFixed(2));
    fits += 1;
  }

  return {
    ...base,
    pool,
    cap,
    used,
    remaining,
    unit: poolSummary?.unit ?? null,
    capMeasured: poolSummary?.capMeasured ?? null,
    jointlyAffordableCount: fits,
    // Cheapest-first is the maximum for one pool, and only one pool was priced.
    jointlyAffordableIsUpperBound: true,
    reason: base.unpricedRowCount > 0
      ? `${fits} of the ${priced.length} priced row(s) fit the ${remaining} ${poolSummary?.unit || pool} `
        + `remaining; ${base.unpricedRowCount} further row(s) carry no measured charge and are neither `
        + 'counted as fitting nor as refused.'
      : `${fits} of the ${list.length} row(s) shown fit the ${remaining} ${poolSummary?.unit || pool} `
        + `left of a ${cap} cycle cap after the plan's committed ${used}.`
  };
}

/**
 * The refusal, in words, with every number a reader needs to act on it.
 *
 * It states the CHARGE and what was LEFT as well as the shortfall, because
 * "1.41 short" alone cannot answer "would a cheaper option have fitted?" -- and
 * it names the operative who was free, because that is the fact which refutes
 * "free up a councilor and I could do this".
 *
 * ABSENT STAYS NULL: a charge nobody could price is reported as unpriced, never
 * printed as a number, and a pool that could not be checked at all is named
 * beside the one that refused rather than being left to read as fine.
 */
function describeBudgetRefusal(refusal) {
  const n = (value, digits = 2) => (typeof value === 'number' && Number.isFinite(value)
    ? value.toFixed(digits)
    : 'UNAVAILABLE');
  const unit = refusal.unit || refusal.pool;
  const chargeText = refusal.chargeMeasured === false
    ? `an UNPRICED ${unit} charge`
    : `${n(refusal.charge)} ${unit}`;
  const who = refusal.councilorName
    ? `${refusal.councilorName} was free to run it`
    : 'an operative was free to run it';
  const alsoUnmeasured = Array.isArray(refusal.unmeasuredPools) && refusal.unmeasuredPools.length > 0
    ? ` The ${refusal.unmeasuredPools.join(' and ')} pool${refusal.unmeasuredPools.length === 1 ? '' : 's'} `
      + `could not be checked at all, so ${refusal.unmeasuredPools.length === 1 ? 'it is' : 'they are'} `
      + 'unverified rather than clear.'
    : '';
  return `Displaced by the ${refusal.pool} budget, not by a busy councilor — it charges ${chargeText} `
    + `against ${n(refusal.remaining)} left of a ${n(refusal.cap)} cycle cap `
    + `(${n(refusal.used)} already committed), ${n(refusal.shortfall)} short. `
    + `${who}, so freeing another operative does not make this affordable.${alsoUnmeasured}`;
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

  // Pairing-scoped rules (currently only risk/success-floor). Odds belong to a
  // councilor doing a mission, not to the mission, so this is the first point
  // in the pipeline where they can be judged at all -- `applyRules` ran before
  // any councilor was named.
  //
  // It sits AFTER the continuity/switching pass so the expected value recorded
  // on a held-back action is the final one a reader would have seen, and
  // BEFORE the greedy allocation so a below-floor pairing never reaches it.
  //
  // The registry walk runs unconditionally, even with no floor set, so the
  // decision always comes from the rule rather than from a shortcut here that
  // could disagree with it. The verdict is only ATTACHED to a pairing when a
  // floor is actually in force, so a default plan carries no extra payload and
  // reads exactly as it did before this rule existed.
  const riskFloorPercent = resolveRiskFloorPercent(world);
  const floorInForce = riskFloorInForce(world);
  const riskFloorVetoed = [];
  const riskFloorUnverified = [];
  for (const pairing of pairings) {
    const verdict = applyPairingRules(world, pairing);
    const riskEntry = verdict.entries.find((entry) => entry.ruleId === 'risk/success-floor') || null;
    pairing.riskFloorVetoed = verdict.outcome === 'veto';
    if (!floorInForce) continue;

    pairing.riskFloor = riskEntry ? riskEntry.detail : null;
    const held = {
      candidateId: pairing.candidateId,
      councilorId: pairing.councilorId,
      councilorName: pairing.councilor?.name || null,
      title: pairing.candidate?.title || pairing.candidate?.friendlyName || pairing.candidate?.missionType || 'Candidate',
      expectedValue: pairing.expectedValue,
      floorPercent: riskFloorPercent,
      point: riskEntry?.detail?.point ?? null,
      bandLow: riskEntry?.detail?.bandLow ?? null,
      bandHigh: riskEntry?.detail?.bandHigh ?? null,
      assumed: riskEntry?.detail?.assumed ?? null,
      unmodeledModifiers: riskEntry?.detail?.unmodeledModifiers || [],
      reason: riskEntry?.reason || null
    };

    if (verdict.outcome === 'veto') {
      riskFloorVetoed.push({
        ...held,
        reason: held.reason || 'Held back by the configured success-odds floor.'
      });
    } else if (verdict.outcome === 'unknown') {
      // Neither admitted as clearing the floor nor rejected as failing it. The
      // pairing stays eligible -- an unmeasured chance is not a proven bad one,
      // and pairing.js's 0.5 planning prior is a ranking convenience, not
      // evidence -- but it is recorded here and stated on the card, so the
      // admission is never silent.
      riskFloorUnverified.push({
        ...held,
        reason: held.reason || 'Success odds could not be computed, so the floor could not be checked.'
      });
      if (Array.isArray(pairing.why) && held.reason) pairing.why.push(held.reason);
    } else if (riskEntry?.detail?.marginal === true && Array.isArray(pairing.why) && held.reason) {
      pairing.why.push(held.reason);
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
    // Below the player's success floor. Already recorded above with the two
    // numbers that decided it, so the veto stays explicable rather than
    // becoming a silently missing row.
    if (pairing.riskFloorVetoed === true) continue;
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
    //
    // `hateChargeMeasured` is what stops the 0 on that fallback branch being
    // read back as a measurement. It is the difference between "this action
    // generates no hate" and "nobody could price the hate it generates", and
    // the second must never be counted as fitting a hate budget.
    const hateChargeMeasured = typeof pairing.hateForBudget === 'number'
      || typeof pairing.expectedHate === 'number';
    const hateCharge = typeof pairing.hateForBudget === 'number'
      ? pairing.hateForBudget
      : (typeof pairing.expectedHate === 'number' ? pairing.expectedHate : 0);

    const affordability = budgets.canAfford(pairing.cost, hateCharge);
    if (!affordability.affordable) {
      // A refusal is a MEASUREMENT, and it is the only place the engine ever
      // learns why an action it wanted could not be taken. It used to record
      // the pool and the shortfall and throw the rest away, which left every
      // consumer able to say "refused" and unable to say by how much, out of
      // what, or whether a second option would have fitted beside the first.
      //
      // `councilorName` matters more than it looks: this pairing reached the
      // affordability check, so its councilor was FREE and willing at that
      // moment and the budget still said no. That is what makes "free up a
      // councilor and you could do this" a false reading of the refusal, and
      // naming the operative is what lets a card say so.
      budgetDisplaced.push({
        candidateId: pairing.candidateId,
        councilorId: pairing.councilorId,
        councilorName: pairing.councilor?.name || null,
        title: pairing.candidate?.title || pairing.candidate?.friendlyName || 'Candidate',
        expectedValue: pairing.expectedValue,
        pool: affordability.pool,
        shortfall: affordability.shortfall,
        charge: affordability.charge,
        // Only the hate pool can be charged from an unmeasured source; a
        // resource cost is a number on the candidate or it is 0.
        chargeMeasured: affordability.pool === 'alienHate' ? hateChargeMeasured : true,
        cap: affordability.cap,
        used: affordability.used,
        remaining: affordability.remaining,
        unit: affordability.unit,
        // A pool that refused says nothing about a pool that could not be
        // checked. Both travel, so "refused by hate" never implies "and the
        // money was fine".
        unmeasuredPools: affordability.unmeasuredPools
      });
      for (const pool of affordability.unmeasuredPools) {
        if (!budgetChecksUnevaluated.includes(pool)) budgetChecksUnevaluated.push(pool);
      }
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

        // A swap must not smuggle a below-floor pairing into the plan through
        // the back door: the greedy pass refuses them, so the optimiser has to
        // as well.
        if (swappedA && swappedB
          && !swappedA.switchRejected && !swappedB.switchRejected
          && swappedA.riskFloorVetoed !== true && swappedB.riskFloorVetoed !== true) {
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
      .filter((h) => sameId(h.councilorId, entry.councilorId))
      .sort((a, b) => (b.netExpectedValue ?? -Infinity) - (a.netExpectedValue ?? -Infinity));

    // "No higher-value reassignment cleared this cycle" would be the wrong
    // reason when the player's own floor is what cleared the board. Naming
    // value where risk was the cause hides the setting that produced the plan.
    const ownPairings = pairingsByCouncilor.get(String(entry.key))
      || pairingsByCouncilor.get(String(entry.councilorId))
      || [];
    const allAlternativesBelowFloor = floorInForce
      && ownPairings.length > 0
      && ownPairings.every((pairing) => pairing.riskFloorVetoed === true);

    committed.push({
      councilorId: entry.councilorId,
      name: entry.name,
      activeMissionName: entry.activeMissionName,
      activeMissionTarget: entry.activeMissionTarget,
      ongoingBenefit: entry.ongoingBenefit,
      planDecision,
      rejectedSwitch: rejectedSwitches[0] || null,
      riskFloorHeld: allAlternativesBelowFloor
        ? { floorPercent: riskFloorPercent, heldCount: ownPairings.length }
        : null,
      reasonDetail: planDecision === 'continue'
        ? `The plan keeps ${entry.name} on ${entry.activeMissionName} `
          + `(${entry.activeMissionTarget || 'target'}); the continuation is re-affirmed in this cycle's orders.`
        : allAlternativesBelowFloor
          ? `The plan leaves ${entry.name} on ${entry.activeMissionName} `
            + `(${entry.activeMissionTarget || 'target'}); no action clears your ${riskFloorPercent}% risk floor `
            + `for this operative (${ownPairings.length} held back).`
          : rejectedSwitches.length > 0
            ? `The plan leaves ${entry.name} on ${entry.activeMissionName} `
              + `(${entry.activeMissionTarget || 'target'}). ${rejectedSwitches[0].reason}`
            : `The plan leaves ${entry.name} on ${entry.activeMissionName} `
              + `(${entry.activeMissionTarget || 'target'}); no higher-value reassignment cleared this cycle.`
    });
  }
  const committedCouncilorKeys = new Set(committed.map((c) => String(c.councilorId)));

  // 4. Benched Candidates
  //
  // Each entry is recorded beside the keys it will be SELECTED by rather than
  // carrying them in the payload: `selectionScore` is an ordering input and
  // `identity` a grouping input, and neither is a figure any consumer reads.
  // Only `record.entry` reaches the payload, as `cappedBenched` below --
  // widened there with the group counts the row stands for.

  // The refusals, indexed for the bench loop. Keyed on the candidate for the
  // reason a row states, and on the (candidate, councilor) pair for the tally
  // that classifies every way of running it.
  //
  // `pairings` is sorted by expected value descending and the greedy pass walks
  // it in that order, so the FIRST refusal recorded for a candidate is the one
  // its best-valued free operative hit. That is the refusal a reader is asking
  // about, and taking the first makes the choice deterministic rather than
  // leaving it to whichever entry a later filter happened to reach.
  const budgetRefusalByCandidate = new Map();
  const budgetRefusedPairKeys = new Set();
  for (const refusal of budgetDisplaced) {
    if (!budgetRefusalByCandidate.has(refusal.candidateId)) {
      budgetRefusalByCandidate.set(refusal.candidateId, refusal);
    }
    budgetRefusedPairKeys.add(`${refusal.candidateId}|${refusal.councilorId}`);
  }

  // `assignmentByCouncilorKey` (built in 3b, after the swap pass) is what lets
  // a row displaced by contention name the work that took the operative rather
  // than asserting one. It is deliberately the SAME map `committed` resolves
  // against: a second one built here could disagree with it about one
  // councilor, which is the contradiction 3b exists to prevent.

  const benchedRecords = [];
  for (const candidate of candidates) {
    const candId = candidate.id || candidate.key || candidate.title;
    if (!claimedCandidateIds.has(candId)) {
      const ownPairings = pairings.filter(p => p.candidateId === candId);
      const bestPairing = ownPairings[0];
      // One chain, read twice, because display and ordering want different
      // answers to "no readable score".
      //
      // `score` keeps its existing display contract exactly -- an entry nobody
      // could score renders 0.00, which is what `?? 0` produced before and what
      // every consumer of this field already expects.
      //
      // `selectionScore` refuses that coercion. It is null when no source value
      // was present, and null when one was present but unreadable, so a
      // candidate nobody could score never takes a bench place from one that
      // was measured -- `Number(null) === 0` would have ranked it above every
      // negative-scoring candidate on the board. Measured on the live save
      // 2026-08-22 (frozen `ExitSave.gz`): 0 of 427 omniscient and 0 of 46
      // player bench entries have an unreadable score, so this is a guard
      // against a shape that does not occur today, not a live correction.
      const rawScore = candidate.score ?? candidate.baseValue ?? bestPairing?.expectedValue ?? null;
      const score = rawScore === null ? 0 : Number(rawScore);
      const selectionScore = Number.isFinite(score) && rawScore !== null ? score : null;

      // "Displaced by a higher-value allocation" is a claim about VALUE. When
      // the risk floor is what removed every way of running this mission,
      // saying that instead would name the wrong cause and hide the setting
      // the player chose.
      const allBelowFloor = floorInForce
        && ownPairings.length > 0
        && ownPairings.every((pairing) => pairing.riskFloorVetoed === true);

      const budgetRefusal = budgetRefusalByCandidate.get(candId) || null;
      const displacement = classifyDisplacement({
        candidateId: candId,
        ownPairings,
        allBelowFloor,
        budgetRefusal,
        budgetRefusedPairKeys,
        assignedCouncilorIds,
        assignmentByCouncilorKey,
        riskFloorPercent
      });
      const displacedBy = displacement.displacedBy;

      benchedRecords.push({
        selectionScore,
        // The (mission, coarse target) group this candidate belongs to, or null
        // when any component of that identity is unreadable. Null means a group
        // of ONE -- never a shared "unknown" bucket, because an unreadable key
        // is not a shared key. See shared/benchSelection.mjs.
        identity: benchGroupIdentity(candidate),
        entry: {
          candidateId: candId,
          title: candidate.title || candidate.friendlyName || candidate.missionType || 'Alternative Candidate',
          score: Number(score.toFixed(2)),
          // True only when the floor removed EVERY way of running this mission,
          // so a consumer can separate a risk hold from a value trade-off.
          riskFloorHeld: allBelowFloor,
          displacedBy,
          // The machine-readable form of the same verdict, so a consumer never
          // has to parse the sentence. `cause` is the obstacle that actually
          // bound; `obstacles` is the tally across every way of running it.
          displacementCause: displacement.cause,
          displacementObstacles: displacement.obstacles,
          // The refusal itself when a budget is what bound -- pool, charge,
          // what was left, and by how much it fell short. Null when no budget
          // refused this candidate, which is NOT the same as it being free:
          // a candidate no pairing ever priced never reached a budget at all.
          budgetRefusal: displacement.budgetRefusal
        }
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

    // An empty slot the floor caused names the floor, the number of actions it
    // held, and the closest one -- so the player can see what lowering it would
    // buy them. It deliberately does NOT name the closest action as a
    // suggestion: offering a below-floor mission is the fallback this whole
    // rule exists to prevent.
    let reasonDetail = UNASSIGNED_REASON_DETAIL[reason];
    let riskFloorHeld = null;
    if (reason === 'risk-floor') {
      const bandLows = ownPairings
        .map((p) => (typeof p.riskFloor?.bandLow === 'number' ? p.riskFloor.bandLow : null))
        .filter((value) => value !== null);
      const closest = bandLows.length > 0 ? Math.max(...bandLows) : null;
      riskFloorHeld = {
        floorPercent: riskFloorPercent,
        heldCount: ownPairings.length,
        closestBandLow: closest
      };
      reasonDetail = `No action clears your ${riskFloorPercent}% risk floor for this operative this cycle. `
        + `${ownPairings.length} action${ownPairings.length === 1 ? '' : 's'} were held back`
        + (closest === null
          ? ', and none of them carried a readable odds band.'
          : `; the closest read ${closest}% at the low end of its band.`);
    }

    unassigned.push({
      councilorId: resolveCouncilorId(entry.councilor),
      name: entry.councilor.displayName || entry.councilor.name || 'Councilor',
      profession: entry.councilor.profession || entry.councilor.typeTemplateName || 'Operative',
      location: entry.councilor.location || entry.councilor.locationName || 'Earth',
      reason,
      reasonDetail,
      riskFloorHeld,
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

  // Highest expected value first, so the bounded view shows the actions the
  // floor cost the most rather than an arbitrary slice of generation order.
  const byExpectedValueDesc = (a, b) => (Number.isFinite(b.expectedValue) ? b.expectedValue : -Infinity)
    - (Number.isFinite(a.expectedValue) ? a.expectedValue : -Infinity);
  const cappedRiskFloorVetoed = [...riskFloorVetoed].sort(byExpectedValueDesc).slice(0, RISK_FLOOR_LIST_LIMIT);
  const cappedRiskFloorUnverified = [...riskFloorUnverified].sort(byExpectedValueDesc).slice(0, RISK_FLOOR_LIST_LIMIT);

  // The bench is capped for the same reason and reported the same way, but the
  // cap answers three separable questions and answers them differently. The
  // rule itself lives in `shared/benchSelection.mjs`; what follows is why it is
  // shaped the way it is.
  //
  // WHICH ENTRIES SURVIVE: the highest-scoring GROUPS of siblings, one row per
  // group. Two earlier answers were measured on the live save 2026-08-22
  // (frozen `ExitSave.gz`, md5 5c0d9ef98213c91d8187ae11bf885d57) and both were
  // worse. A plain slice of generation order showed one 5.63, six score-3
  // Investigate/Turn rows and one 9, while five 68.75 purges sat among the 419
  // hidden -- a reader would conclude their alternatives were all score-3
  // investigations, which is false. Selecting the best eight INDIVIDUALS fixed
  // the scores and broke the variety: 2 distinct mission shapes across 8 rows,
  // five of them siblings of the primary recommendation itself, so the bench
  // read "five more of the thing you were already told to do". Selecting the
  // best eight GROUPS gives 8 distinct shapes over the same 8 rows, accounting
  // for 33 of the 427 candidates rather than 8, and drops the best candidate no
  // row stands for from 50.64 to 23.74.
  //
  // IN WHAT ORDER THEY ARE EMITTED: generation order, unchanged. Registry
  // emission order is load-bearing for every explanation the reader sees. That
  // property governs how explanations are BUILT, by `applyRules` and
  // `scoreCandidates` firing in registry order; it says nothing about which
  // rows survive a display cap. Selecting by score and then restoring
  // generation order keeps both, and neither `applyRules` nor
  // `scoreCandidates` is touched.
  //
  // A consequence worth stating rather than leaving implied: the emitted list
  // is therefore NOT in descending score order, and must not be read as a
  // ranking. It is the best few, in the order the engine produced them.
  //
  // TIES break on generation index, which is the common case and not an edge
  // one -- 39 of the 427 omniscient entries score exactly 3. The tiebreak is
  // stated explicitly rather than left to sort stability so that two runs of
  // one save can never disagree, which the frozen-save harness would catch.
  //
  // AN UNREADABLE SCORE SORTS LAST, never as 0. See `selectionScore` above.
  // AN UNREADABLE GROUP KEY makes a record its own group of one, never a member
  // of a shared "unknown" group -- an unreadable key is not a shared key.
  const { rows: cappedBenched, representedCount: benchedRepresentedCount } =
    selectBenchRows(benchedRecords, { limit: BENCH_SELECTION_LIMIT });

  // Computed over the EMITTED rows rather than the whole bench, because the
  // question it answers -- "how many of these can I actually take?" -- is asked
  // about the list the reader is looking at. The group counts beside each row
  // say how many further siblings it stands for; those siblings draw on the
  // same pool, so taking one of a group is taking one of the shown options.
  const budgetSummary = budgets.getSummary();
  const benchBudget = summariseBenchBudget(cappedBenched, budgetSummary);

  return {
    assignments,
    unassigned,
    unavailable,
    committed,
    reassignedFromCommitment,
    heldCommitments,
    // Capped for transport, with the true total and the number omitted beside
    // it. `committed` and `unassigned` above are deliberately uncapped -- they
    // are bounded by the councilor roster, not by candidate breadth -- so they
    // carry no such counts.
    //
    // Both counts are taken over the WHOLE bench, never over the selected
    // slice: announcing the cap is the only thing they exist for, and reading
    // them off `cappedBenched` would report "8 of 8, 0 omitted" while hiding
    // 419 rows.
    //
    // `benchedOmittedCount` keeps its existing meaning EXACTLY -- rows not
    // carried -- so `benched.length + benchedOmittedCount === benchedTotalCount`
    // still holds and the four existing tests that pin it are untouched. The
    // new figure is a third one beside them rather than a redefinition of
    // either: `benchedRepresentedCount` is how many candidates the carried rows
    // actually ACCOUNT FOR, which is a different question from how many rows
    // there are. Eight rows, 419 not carried, 33 accounted for.
    //
    // Invariants: benched.length <= benchedRepresentedCount <= benchedTotalCount,
    // and benchedRepresentedCount === sum(row.groupCount).
    benched: cappedBenched,
    benchedTotalCount: benchedRecords.length,
    benchedOmittedCount: benchedRecords.length - cappedBenched.length,
    benchedRepresentedCount,
    // What the shown rows cost against the pool that refused them, and how many
    // of them could be taken together. The bench reads as a list of independent
    // alternatives without this; on the frozen save's omniscient plan all eight
    // draw on one 7.90 hate cap with 3.16 left and NONE of them fits.
    benchBudget,
    budgetDisplaced,
    budgets: budgetSummary,
    budgetChecksUnevaluated,
    droppedPairings,
    clocks,
    horizon,
    totalExpectedValue,
    // The floor in force, so a surprising plan is explicable. `inForce` is what
    // separates "the player chose 0, meaning no floor" from "nothing was
    // configured": both hold nothing back, and neither is a floor of zero that
    // rejects everything.
    riskFloor: {
      percent: riskFloorPercent,
      inForce: floorInForce,
      configured: riskFloorPercent !== null
    },
    // Actions held back by the floor, and actions the floor could not be
    // checked against. Both are capped for transport and both carry their true
    // total and the number omitted.
    riskFloorVetoed: cappedRiskFloorVetoed,
    riskFloorVetoedTotalCount: riskFloorVetoed.length,
    riskFloorVetoedOmittedCount: riskFloorVetoed.length - cappedRiskFloorVetoed.length,
    riskFloorUnverified: cappedRiskFloorUnverified,
    riskFloorUnverifiedTotalCount: riskFloorUnverified.length,
    riskFloorUnverifiedOmittedCount: riskFloorUnverified.length - cappedRiskFloorUnverified.length
  };
}

module.exports = {
  allocateCyclePlan,
  getActiveMissionInfo,
  computeOngoingMissionBenefit
};
