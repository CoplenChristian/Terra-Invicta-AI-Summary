// shared/benchSelection.mjs
//
// Purpose: the bench cap's selection rule — one row per (mission, target)
//   sibling group, so the carried rows are distinct OPTIONS rather than
//   several spellings of one, each carrying how many of its members share the
//   representative's risk-floor and budget verdicts.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// ---------------------------------------------------------------------------
//
// The bench cap answers two separable questions -- WHICH entries survive, and
// IN WHAT ORDER they are emitted -- and a third that neither of them covers:
// whether the survivors are different from each other.
//
// Selecting the highest-scoring eight individuals was measured on frozen
// `ExitSave.gz` (md5 `5c0d9ef98213c91d8187ae11bf885d57`) to carry **2 distinct
// mission shapes across 8 rows** in omniscient mode: five "Purge the
// Protectorate hold on … in China" siblings of the primary recommendation
// itself, then three India purges. Truthful -- those really were the best
// hidden alternatives -- and close to useless, because the reader was shown
// one option five times while 419 rows stayed hidden.
//
// Selecting the highest-scoring eight GROUPS carries 8 distinct shapes over the
// same 8 rows, and those rows account for 33 of the 427 candidates rather than
// 8. The best candidate no row stands for rises from 50.64 to 23.74.
//
// ---------------------------------------------------------------------------
// THE GROUPING RULE, AND THE ONE THAT WAS REJECTED
// ---------------------------------------------------------------------------
//
// The key is `missionType` + the COARSE TARGET ENTITY -- the nation, hab,
// councilor or faction the mission acts on, NOT the individual control point
// within it. Five China purges differ only in which control point they take;
// that is the axis worth collapsing.
//
// Grouping by candidate FAMILY instead was measured and rejected. It produced
// *identical emitted rows* on this save, so there is no measured basis to
// prefer it, and it merges `Investigate Councilor` with `Turn Councilor`
// (family `council`) and `Control Nation` with `Purge` (family `expansion`) --
// two genuinely different actions presented as one option. Adding the holder
// faction to the key was also measured: it drops to 6 distinct shapes for no
// gain, because the holder differs INSIDE 3 of the 7 collapsed groups.
//
// Player mode is unaffected: 46 groups from 46 candidates, nothing collapses,
// and the emitted bench is byte-identical to selecting individuals.
//
// ---------------------------------------------------------------------------
// DELIBERATELY PLAIN ESM
// ---------------------------------------------------------------------------
//
// No Node built-ins and no imports outside `shared/` -- see the header of
// `shared/util.mjs`. The hosted Cloudflare Worker cannot `require` CommonJS,
// and Node's `require(esm)` support lets `server/engine/assignment.js` import
// this file unchanged.

import { looksUnresolved } from './util.mjs';

/**
 * How many bench ROWS the plan carries -- now groups, not individuals.
 *
 * The cap bounds the payload; the true total and the number omitted travel
 * beside the list so eight rows are never mistaken for the whole bench. On the
 * live save the bench runs to 427 (omniscient) and 46 (player), so the cap is
 * load-bearing rather than theoretical.
 */
export const BENCH_SELECTION_LIMIT = 8;

/**
 * Which preposition reads correctly for a scope of this kind.
 *
 * `controlPoint` scopes to the nation the control point sits in, so it takes
 * the nation's preposition rather than one of its own.
 */
const SCOPE_PREPOSITION = Object.freeze({
  controlPoint: 'in',
  nation: 'in',
  hab: 'at',
  councilor: 'against',
  capability: 'against'
});

/**
 * The coarse target entity a candidate acts on, by target kind.
 *
 * `councilorName` is deliberately NOT a fallback for a missing `councilorId`:
 * two councilors can share a display name, and merging them would be a
 * FABRICATED identity -- the same class of error as a `"undefined"` dedupe key,
 * one step subtler because the resulting key looks entirely plausible. Measured
 * on the frozen save: 33 of 33 omniscient council candidates carry
 * `councilorId`, so requiring it costs nothing.
 *
 * A kind not listed here is UNGROUPABLE. That is the safe direction -- an
 * unrecognised shape becomes a group of one and is carried on its own merits,
 * never folded into somebody else's group.
 */
function scopeForTarget(kind, target) {
  switch (kind) {
    case 'controlPoint':
      return { prefix: 'nation', value: target.nation, label: target.nation };
    case 'councilor':
      return { prefix: 'councilor', value: target.councilorId, label: target.councilorName };
    case 'nation':
      return { prefix: 'nation', value: target.id ?? target.name, label: target.displayName ?? target.name };
    case 'hab':
      return { prefix: 'hab', value: target.id ?? target.name, label: target.displayName ?? target.name };
    case 'capability':
      return { prefix: 'capability', value: target.faction, label: target.faction };
    default:
      return null;
  }
}

/**
 * The group a candidate belongs to, or null when it belongs to no group.
 *
 * NULL MEANS UNGROUPABLE, WHICH MEANS A GROUP OF ONE. It does not mean "put it
 * with the other unreadable ones": an unreadable key is not a shared key, and
 * two records nobody could identify are not evidence that they are the same
 * thing. `selectBenchRows` gives every ungroupable record its own group.
 *
 * Every component must be readable -- the mission name, the target kind, the
 * scope id, and the label that names the scope to a reader. `looksUnresolved`
 * rejects absent, blank, and the literal `undefined` / `null` / `NaN` tokens
 * that `${a || b}` produces on a record carrying neither; that string is a
 * perfectly valid `Map` key and has silently collapsed records twice in this
 * repo's history.
 *
 * @param {Object} candidate A normalized candidate (server/engine/candidates/normalize.js).
 * @returns {{ key: string, kind: string, label: string, missionType: string }|null}
 */
export function benchGroupIdentity(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;

  const missionType = candidate.missionType;
  if (typeof missionType !== 'string') return null;
  const mission = missionType.trim();
  if (mission === '' || looksUnresolved(mission)) return null;

  const target = (candidate.target && typeof candidate.target === 'object' && !Array.isArray(candidate.target))
    ? candidate.target
    : null;
  if (!target) return null;

  // `normalizeCandidate` mirrors `kind` and `type` onto each other, but a
  // hand-built candidate may carry only one of them.
  const kindRaw = target.kind ?? target.type;
  if (looksUnresolved(kindRaw)) return null;
  const kind = String(kindRaw).trim();

  const scope = scopeForTarget(kind, target);
  if (scope === null) return null;
  if (looksUnresolved(scope.value)) return null;
  if (looksUnresolved(scope.label)) return null;

  return {
    key: `${mission}|${scope.prefix}:${String(scope.value).trim()}`,
    kind,
    label: String(scope.label).trim(),
    missionType: mission
  };
}

/**
 * Orders bench records for SELECTION against BENCH_SELECTION_LIMIT. It decides
 * WHICH entries survive the cap; it does not decide the order they are emitted
 * in, which is restored to generation order immediately afterwards.
 *
 * Used at both levels of the selection -- to find each group's representative,
 * and then to rank the groups by their representatives -- so the two decisions
 * cannot disagree about what "better" means.
 *
 * Three properties, in the order they are applied:
 *
 *   1. Highest `selectionScore` first, so the cap keeps the best few rather
 *      than whatever the candidate generators emitted first.
 *   2. Ties break on generation index. Ties are the COMMON case here -- 39 of
 *      the 427 omniscient bench entries score exactly 3 -- so leaving this to
 *      sort stability would leave the rule unstated. Two runs of one save must
 *      agree or the frozen-save harness reports a phantom diff.
 *   3. A null `selectionScore` sorts after every readable one. It means "no
 *      readable score", not "a score of zero": a candidate nobody could score
 *      must not take a place from one that was measured, and must not be pushed
 *      below genuinely negative scores either -- it is unranked, so it is last.
 *      Two nulls hold generation order between themselves.
 *
 * Moved here from `server/engine/assignment.js` on 2026-08-22, semantics
 * unchanged, so the browser-facing and worker-facing halves of the repo can
 * read the same rule instead of duplicating it.
 *
 * @param {{ record: { selectionScore: number|null }, index: number }} a
 * @param {{ record: { selectionScore: number|null }, index: number }} b
 * @returns {number}
 */
export function compareBenchSelection(a, b) {
  const left = a.record.selectionScore;
  const right = b.record.selectionScore;
  if (left === null && right === null) return a.index - b.index;
  if (left === null) return 1;
  if (right === null) return -1;
  if (left !== right) return right - left;
  return a.index - b.index;
}

/** Two decimals, matching the emitted `score` field exactly. */
const toScore = (value) => Number(value.toFixed(2));
const formatScore = (value) => value.toFixed(2);

/**
 * The one-line note that tells a reader what a collapsed row stands for.
 *
 * IT DESCRIBES THE GROUP, NOT THE REPRESENTATIVE. Measured on the frozen save,
 * the holder faction differs INSIDE 3 of the 7 collapsed omniscient groups
 * (India = Servants + Protectorate, United Malay Nation = Protectorate +
 * Project Exodus, Russia = Protectorate + Resistance), so a note phrased off
 * the representative's own title -- "+4 more like Purge the Servants hold on
 * … " -- would claim all five siblings share one holder. The note names only
 * what the whole group provably shares: the mission and the target entity.
 *
 * The score range is the group's own, and it is NULL when no member carried a
 * readable score. Never 0: `Number(null) === 0` would report an unscored group
 * as a measured zero. A partially readable group says how many were unread
 * rather than presenting the range as covering everything.
 *
 * @param {{ identity: Object|null, count: number, scoreLow: number|null,
 *           scoreHigh: number|null, unreadableScoreCount?: number }} group
 * @returns {string|null} null when there is nothing to describe.
 */
export function describeBenchGroup(group) {
  if (!group || typeof group !== 'object') return null;
  const identity = group.identity;
  if (!identity || typeof identity.label !== 'string' || identity.label === '') return null;
  if (typeof identity.missionType !== 'string' || identity.missionType === '') return null;

  const count = Number.isFinite(group.count) ? group.count : null;
  if (count === null || count < 2) return null;
  const more = count - 1;

  const preposition = SCOPE_PREPOSITION[identity.kind] || 'for';
  const head = `+${more} more ${identity.missionType} option${more === 1 ? '' : 's'} `
    + `${preposition} ${identity.label}`;

  const low = typeof group.scoreLow === 'number' && Number.isFinite(group.scoreLow) ? group.scoreLow : null;
  const high = typeof group.scoreHigh === 'number' && Number.isFinite(group.scoreHigh) ? group.scoreHigh : null;
  const unread = Number.isFinite(group.unreadableScoreCount) ? group.unreadableScoreCount : 0;

  if (low === null || high === null) return `${head}; their scores could not be read`;

  // "all scoring X" is a claim about every member, so it is only available when
  // every member was actually read.
  const range = low === high
    ? (unread > 0 ? `scoring ${formatScore(high)}` : `all scoring ${formatScore(high)}`)
    : `scoring ${formatScore(high)} down to ${formatScore(low)}`;
  const caveat = unread > 0
    ? `; ${unread} of the group carried no readable score`
    : '';
  return `${head}, ${range}${caveat}`;
}

/**
 * Selects the bench rows: one row per group, best groups first, emitted in
 * candidate-generation order.
 *
 * Four steps, and the order of the last two is the whole point:
 *
 *   1. GROUP by `identity.key`. A record with a null identity forms its own
 *      group of one -- it never joins another group, and two ungroupable
 *      records never merge with each other.
 *   2. REPRESENT each group by its best member under `compareBenchSelection`
 *      (highest score, ties to the earliest generated).
 *   3. RANK the groups by their representatives under the same comparator and
 *      take `limit`.
 *   4. RESTORE the generation order of the surviving representatives. Emission
 *      order stays candidate-generation order, which is a property an existing
 *      test pins: the emitted sequence is the best few, NOT a ranking.
 *
 * @param {Array<{ selectionScore: number|null, identity: Object|null, entry: Object }>} records
 *        In candidate-generation order.
 * @param {{ limit?: number }} [options]
 * @returns {{ rows: Array<Object>, representedCount: number }}
 *        `representedCount` is the number of candidates the RETURNED rows
 *        account for -- the sum of their `groupCount`s, never the whole bench.
 */
export function selectBenchRows(records, { limit = BENCH_SELECTION_LIMIT } = {}) {
  const list = Array.isArray(records) ? records : [];
  const cap = Number.isFinite(limit) && limit >= 0 ? limit : BENCH_SELECTION_LIMIT;

  const wrapped = list.map((record, index) => ({ record, index }));

  const groupsByKey = new Map();
  const groups = [];
  for (const item of wrapped) {
    const key = item.record?.identity?.key;
    // An UNGROUPABLE record is its own group. Note there is no shared bucket
    // for them and no `else` that could become one: the absence of a key is not
    // a key, so each one is pushed straight onto `groups` without ever touching
    // the map.
    if (typeof key !== 'string' || key === '') {
      groups.push({ identity: null, members: [item] });
      continue;
    }
    const existing = groupsByKey.get(key);
    if (existing) {
      existing.members.push(item);
      continue;
    }
    const group = { identity: item.record.identity, members: [item] };
    groupsByKey.set(key, group);
    groups.push(group);
  }

  const ranked = groups
    // A copy, so the group keeps its members in generation order for the
    // score-range and risk-floor tallies below.
    .map((group) => ({ group, representative: [...group.members].sort(compareBenchSelection)[0] }))
    .sort((a, b) => compareBenchSelection(a.representative, b.representative))
    .slice(0, cap)
    .sort((a, b) => a.representative.index - b.representative.index);

  let representedCount = 0;
  const rows = ranked.map(({ group, representative }) => {
    const count = group.members.length;
    representedCount += count;

    // Absent stays null. An unreadable score is skipped, never coerced -- a
    // group of unscored candidates reports a null range, not a range of zero.
    const readable = group.members
      .map((member) => member.record.selectionScore)
      .filter((score) => typeof score === 'number' && Number.isFinite(score));
    const scoreLow = readable.length > 0 ? toScore(Math.min(...readable)) : null;
    const scoreHigh = readable.length > 0 ? toScore(Math.max(...readable)) : null;
    const unreadableScoreCount = count - readable.length;

    // `riskFloorHeld` on the row describes the REPRESENTATIVE only, so a mixed
    // group would otherwise read as uniform. This count is what stops that.
    const riskFloorHeldCount = group.members
      .filter((member) => member.record.entry?.riskFloorHeld === true)
      .length;

    // The same problem, for the same reason, one row down: `displacedBy` and
    // `budgetRefusal` also describe the REPRESENTATIVE only. A group whose
    // members were held back for different reasons must not present one
    // member's reason as the group's, so the count of members a budget
    // actually refused travels beside it. When it equals `groupCount` the
    // representative's sentence is true of every member; when it is between 1
    // and count-1 the group is MIXED and a consumer must say so; when it is 0
    // no member was refused by a budget at all.
    //
    // Counted off `budgetRefusal` rather than off `displacementCause`, because
    // a member can carry a recorded refusal while a nearer obstacle bound its
    // stated cause -- the refusal is the measurement, the cause is the choice.
    const budgetDisplacedCount = group.members
      .filter((member) => {
        const refusal = member.record.entry?.budgetRefusal;
        return refusal !== null && refusal !== undefined;
      })
      .length;

    return {
      ...representative.record.entry,
      groupCount: count,
      groupOmittedCount: count - 1,
      groupNote: count > 1
        ? describeBenchGroup({ identity: group.identity, count, scoreLow, scoreHigh, unreadableScoreCount })
        : null,
      groupScoreLow: scoreLow,
      groupScoreHigh: scoreHigh,
      groupRiskFloorHeldCount: riskFloorHeldCount,
      groupBudgetDisplacedCount: budgetDisplacedCount
    };
  });

  return { rows, representedCount };
}
