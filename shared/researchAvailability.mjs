// shared/researchAvailability.mjs
//
// Purpose: which projects a faction can actually research, in the three states
//   the game distinguishes.
//
// Which projects a faction can actually research, in the three states the game
// distinguishes and one widespread mistake does not.
//
// ---------------------------------------------------------------------------
// PREREQUISITES MET IS NOT RESEARCHABLE
// ---------------------------------------------------------------------------
//
// Every one of the 750 projects carries `initialUnlockChance`,
// `deltaUnlockChance` and `maxUnlockChance`. Once its prerequisites hold, a
// project ROLLS each month: starting at the initial chance, rising by the delta,
// capped at the maximum. 351 projects cap at 100%, 249 at 50%, and 92 lower
// still -- so a project whose prerequisites have been satisfied for years may
// never have appeared, and may never appear.
//
// Measured on the live save, deriving availability from prerequisites instead of
// reading it: of 274 uncompleted projects with every prerequisite met, 104 were
// NOT actually available (38% wrongly offered), and 5 available projects had
// unmet prerequisites (wrongly hidden).
//
// The authoritative source is therefore the save: `availableProjectNames` on the
// faction record, surfaced on the snapshot as `techTree.factionStatus[id]`.
// This module reads it. It never recomputes it, and it never infers it from
// `globalResearch.finishedTechsNames` -- that set describes the world, not this
// faction.
//
// (Global tech COMPLETION is a different question from project AVAILABILITY.
// `finishedTechsNames` is the correct and only source for whether a global-tech
// prerequisite is satisfied, because global techs genuinely are world state.
// It is used below for exactly that and for nothing else.)
//
// ---------------------------------------------------------------------------
// THE THREE STATES
// ---------------------------------------------------------------------------
//
//   researchable-now  in `availableProjectNames`      -> offer it
//   prereq-clear      prereqs met, absent from list   -> "not yet available;
//                                                        up to N%/month, cap M%"
//   prereq-blocked    prereqs unmet                   -> name what is missing
//
// Collapsing the middle state into either neighbour is the failure mode.
// Reporting it as researchable offers something the player cannot select;
// reporting it as blocked hides a target they should be steering toward.
//
// Plain ESM, no Node built-ins, no imports outside `shared/`.

import { asArray, round, sameId, toFiniteNumber as toFinite } from './util.mjs';
import { observerGraph } from './techGraph.mjs';

export const AVAILABILITY_STATES = Object.freeze({
  completed: 'completed',
  researching: 'researching',
  researchableNow: 'researchable-now',
  prereqClearUnrolled: 'prereq-clear-but-unrolled',
  prereqBlocked: 'prereq-blocked',
  // Not one of §3b's three, and deliberately so: 103 projects carry a
  // `factionPrereq` naming the faction templates they belong to, and a further
  // handful carry `researchCost: -1` and are never researched at all. Both are
  // unreachable for reasons that have nothing to do with prerequisites or the
  // monthly roll. Folding them into `prereq-clear-but-unrolled` reported the
  // alien master projects as prerequisite-clear with a 100%/month roll -- an
  // unreachable target rendered as imminent, which is the same class of error
  // §3b exists to prevent.
  factionRestricted: 'faction-restricted',
  // Added while building phase 2, and for the same reason the two states above
  // it exist: 33 of the 125 laser templates and a handful of hulls, armours and
  // reactors carry NO `requiredProjectName` at all. They are not gated behind
  // research and never were. Reporting them as `completed` would claim the
  // observer finished a project that does not exist, and `unknown` would hide
  // that they cost nothing -- both of which are the state-collapsing error
  // section 3b exists to prevent. This state means "needs no research".
  ungated: 'ungated',
  unknown: 'unknown'
});

/**
 * Candidate prerequisite branches for a node.
 * Under Terra Invicta game mechanics, altPrereq0 substitutes for prerequisites[0] only;
 * prerequisites[1..n] (component/tier lineage) still strictly bind across all branches.
 *
 * @param {Object} node
 * @returns {Array<Array<{id: string, type: string, isAlternate?: boolean}>>}
 */
export function getPrerequisiteBranches(node) {
  const prereqs = asArray(node?.prerequisites);
  const alternates = asArray(node?.alternatePrerequisites);

  if (prereqs.length === 0) {
    if (alternates.length > 0) {
      return [alternates.map(alt => ({ ...alt, isAlternate: true }))];
    }
    return [[]];
  }

  const p0 = prereqs[0];
  const rest = prereqs.slice(1);
  const primaryBranch = [p0, ...rest];

  if (alternates.length === 0) {
    return [primaryBranch];
  }

  // Each alternate substitutes for prereqs[0] while keeping prereqs[1..n]
  const alternateBranches = alternates.map(alt => [
    { ...alt, isAlternate: true },
    ...rest
  ]);

  return [primaryBranch, ...alternateBranches];
}

/**
 * A resolver over the observer's tech graph, built once and queried per project.
 *
 * Returns `{ available: false, reason }` when the snapshot carries no tech tree,
 * rather than an empty resolver that would answer `prereq-blocked` for
 * everything and look like a campaign that had researched nothing.
 */
export function buildAvailabilityResolver(snapshot, mode, observerId) {
  const tree = snapshot?.techTree;
  if (!tree || !Array.isArray(tree.nodes) || tree.nodes.length === 0) {
    return {
      available: false,
      reason: 'this snapshot carries no tech tree; re-publish with the techTree payload to resolve research availability',
      availabilitySource: null,
      availabilityKnown: false,
      availableProjectCount: null,
      resolve: (projectId) => ({
        projectId,
        displayName: projectId,
        state: AVAILABILITY_STATES.unknown,
        reason: 'no tech tree on this snapshot',
        researchCost: null,
        researchProgress: null,
        remainingResearchCost: null,
        missingPrerequisites: null,
        unlockChance: null
      })
    };
  }

  const graph = observerGraph(snapshot, mode, observerId);
  const byId = graph.byId;

  // Read from the faction record when it is present, because that is where the
  // save puts it; fall back to the tech tree's own per-faction overlay. Both are
  // the same list. Neither is recomputed.
  const faction = asArray(snapshot.factions).find(entry => sameId(entry?.ID, observerId)) || null;
  const factionStatus = (tree.factionStatus || {})[observerId] || {};
  const availableNames = asArray(faction?.availableProjectNames).length > 0
    ? asArray(faction.availableProjectNames)
    : asArray(factionStatus.availableProjectNames);
  const availableSet = new Set(availableNames);
  const availabilitySource = asArray(faction?.availableProjectNames).length > 0
    ? 'factions[observer].availableProjectNames'
    : 'techTree.factionStatus[observer].availableProjectNames';

  // Player mode redacts other factions' project lists. An observer whose own
  // list is genuinely absent must be reported as unresolvable, not as a faction
  // with nothing available -- those render identically and mean opposite things.
  // A count of exactly 0 IS a measurement (a turn-1 faction that has unlocked
  // nothing), so it counts as known; an absent count does not.
  const availabilityKnown = availableNames.length > 0 ||
    toFinite(faction?.availableProjectsCount) === 0;

  // Faction restriction and non-researchable cost, from the baked template
  // gating. An absent row means the project carries neither restriction.
  const gating = snapshot?.projectGating || {};
  const observerTemplate = faction?.templateName || null;
  const restrictionFor = (projectId) => {
    const row = gating[projectId];
    if (!row) return null;
    if (row.researchable === false) {
      return `this project carries no research cost (researchCost ${row.researchCost}); it is never researched`;
    }
    if (Array.isArray(row.factionPrereq) && row.factionPrereq.length > 0) {
      if (!observerTemplate) {
        // Cannot evaluate. Say so rather than assuming the observer qualifies.
        return `restricted to ${row.factionPrereq.join(', ')}, and this observer's faction template is not recorded in this snapshot, so eligibility cannot be evaluated`;
      }
      if (!row.factionPrereq.includes(observerTemplate)) {
        return `restricted to ${row.factionPrereq.join(', ')}; this observer is ${observerTemplate}`;
      }
    }
    return null;
  };

  const isSatisfied = (id) => {
    const node = byId.get(id);
    if (!node) return null; // unknown prerequisite: not satisfied, not unsatisfied
    return node.completed === true;
  };

  const resolve = (projectId) => {
    const node = byId.get(projectId);
    if (!node) {
      return {
        state: AVAILABILITY_STATES.unknown,
        reason: `project '${projectId}' is not in this snapshot's tech tree`,
        researchCost: null,
        researchProgress: null,
        remainingResearchCost: null,
        missingPrerequisites: null,
        unlockChance: null
      };
    }

    const rawCost = toFinite(node.researchCost);
    // A negative cost is a marker, not a cost. `Math.max(0, -1 - 0)` is 0,
    // which renders as "already paid for" -- the opposite of the truth.
    const researchCost = rawCost === null || rawCost < 0 ? null : rawCost;
    const researchProgress = toFinite(node.researchProgress);
    const remaining = researchCost === null
      ? null
      : Math.max(0, researchCost - (researchProgress ?? 0));

    const chance = node.availability && node.availability.known
      ? {
        initialPercent: toFinite(node.availability.initialPercent),
        deltaPercentPerMonth: toFinite(node.availability.deltaPercent),
        maxPercent: toFinite(node.availability.maxPercent),
        expectedMonths: toFinite(node.availability.expectedMonths),
        certain: toFinite(node.availability.maxPercent) === 100
      }
      : null;

    const common = {
      projectId,
      displayName: node.displayName || projectId,
      researchCost,
      researchProgress,
      remainingResearchCost: remaining,
      unlockChance: chance
    };

    if (node.completed === true) {
      return { ...common, state: AVAILABILITY_STATES.completed, reason: null, missingPrerequisites: [] };
    }
    if (node.researching === true) {
      return { ...common, state: AVAILABILITY_STATES.researching, reason: null, missingPrerequisites: [] };
    }

    if (!availabilityKnown) {
      return {
        ...common,
        state: AVAILABILITY_STATES.unknown,
        reason: `availability is unresolvable: ${availabilitySource} is absent for this observer in this mode`,
        missingPrerequisites: null
      };
    }

    if (availableSet.has(projectId)) {
      return { ...common, state: AVAILABILITY_STATES.researchableNow, reason: null, missingPrerequisites: [] };
    }

    // Checked AFTER the available list, never before it: if the save says the
    // observer can research it, the save wins over anything derived from the
    // templates. This branch only ever explains an absence.
    const restriction = restrictionFor(projectId);
    if (restriction) {
      return {
        ...common,
        state: AVAILABILITY_STATES.factionRestricted,
        missingPrerequisites: null,
        reason: restriction
      };
    }

    // Not available. Now -- and only now -- prerequisites decide WHICH of the
    // two remaining states this is. Prerequisites are never used to decide
    // whether it is available; the list above already decided that.
    const branches = getPrerequisiteBranches(node);
    const mappedBranches = branches.map((branch, branchIndex) => {
      const missing = branch.filter(prereq => isSatisfied(prereq?.id) !== true).map(prereq => ({
        id: prereq?.id ?? null,
        type: prereq?.type ?? null,
        displayName: byId.get(prereq?.id)?.displayName || prereq?.id || null,
        known: byId.has(prereq?.id)
      }));
      return {
        branchIndex,
        isAlternateBranch: branchIndex > 0,
        missing
      };
    });

    const clearBranch = mappedBranches.find(b => b.missing.length === 0);
    if (clearBranch) {
      return {
        ...common,
        state: AVAILABILITY_STATES.prereqClearUnrolled,
        missingPrerequisites: [],
        alternateSatisfied: clearBranch.isAlternateBranch,
        reason: chance
          ? `prerequisites are met but the project has not yet been offered; it rolls monthly from ${chance.initialPercent}% rising ${chance.deltaPercentPerMonth}%/month to a cap of ${chance.maxPercent}%${chance.certain ? '' : ' — a cap below 100% may never land in this campaign'}`
          : 'prerequisites are met but the project has not yet been offered, and this snapshot carries no unlock-chance data for it'
      };
    }

    // Pick the branch closest to being satisfied (fewest missing prerequisites)
    const sortedBranches = [...mappedBranches].sort((a, b) => a.missing.length - b.missing.length);
    const closestBranch = sortedBranches[0];

    return {
      ...common,
      state: AVAILABILITY_STATES.prereqBlocked,
      missingPrerequisites: closestBranch.missing,
      alternateSatisfied: false,
      reason: `blocked on ${closestBranch.missing.length} unmet prerequisite(s): ${closestBranch.missing.map(entry => entry.displayName || entry.id).join(', ')}`
    };
  };

  return {
    available: true,
    reason: null,
    availabilitySource,
    availabilityKnown,
    availableProjectCount: availableNames.length,
    resolve
  };
}

/** Tallies resolved rows by state, for a census a caller can sanity-check. */
export function tallyAvailabilityStates(rows) {
  const counts = Object.fromEntries(Object.values(AVAILABILITY_STATES).map(state => [state, 0]));
  for (const row of asArray(rows)) {
    const state = row?.availability?.state || row?.state;
    if (state && counts[state] !== undefined) counts[state] += 1;
  }
  return counts;
}

/** Months of research at a measured income, or null when income is unmeasured. */
export function monthsAtIncome(remainingCost, monthlyIncome) {
  const cost = toFinite(remainingCost);
  const income = toFinite(monthlyIncome);
  if (cost === null || income === null || !(income > 0)) return null;
  return round(cost / income, 1);
}
